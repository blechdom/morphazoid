import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { parse } from "acorn";
import { planShapeCornerStrikes } from "../src/instruments/shape-synth/percussion-scheduling.js";
import { normalizeStrikeGains, percussionEnvelopePreset } from "../src/audio.js";
import { recordNativeStrike, scheduledEnvelopeAt } from "./helpers/strike-reference.mjs";

const intents = count => Array.from({ length: count }, (_, index) => ({
  spec: { key: `hit-${index}`, frequency: 110, gain: 0.3 },
  envelope: {}, time01: (index + 1) / count,
}));

test("ordinary Shape frames retain their strike spacing, with one absolute audio-clock anchor", () => {
  for (const span of [0, 1 / 120, 1 / 60, 0.03]) {
    const input = intents(4), output = planShapeCornerStrikes(input, span, 10);
    assert.equal(output.length, input.length);
    output.forEach((item, index) => assert.equal(item.startAt, 10 + input[index].time01 * span));
    assert.ok(input.every(item => !Object.hasOwn(item, "startAt")));
  }
});

test("a delayed frame drops stale attacks instead of squeezing a second of hits into 30ms", () => {
  for (const span of [0.1, 0.25, 1]) {
    const input = intents(100);
    const output = planShapeCornerStrikes(input, span, 7);
    assert.ok(output.length < input.length / 2);
    assert.ok(output.every(item => item.time01 * span >= span - 0.03 - 1e-9));
    for (let index = 1; index < output.length; index++) {
      assert.ok(Math.abs(output[index].startAt - output[index - 1].startAt - span / 100) < 1e-9);
    }
    assert.ok(output.every(item => item.startAt >= 7 && item.startAt <= 7.03 + 1e-9));
  }
});

test("the authored Shape flush discards stale hits before gain normalization and preserves native peak bounds", async () => {
  const source = await readFile(new URL("../src/instruments/shape-synth/shape-synth-app.js", import.meta.url), "utf8");
  const declaration = parse(source, { sourceType: "module", ecmaVersion: "latest" }).body
    .find(node => node.type === "FunctionDeclaration" && node.id.name === "flushCornerStrikes");
  const played = [];
  const context = vm.createContext({
    pendingCornerStrikes: intents(100), STRIKE_BATCH_CEILING: 0.78,
    planShapeCornerStrikes, normalizeStrikeGains,
    pool: { context: { currentTime: 10 }, availableStrikeHeadroom: () => 0.3, strike(spec, envelope) { played.push({ spec, envelope }); } },
  });
  vm.runInContext(`${source.slice(declaration.start, declaration.end)}; flushCornerStrikes(1);`, context);
  assert.equal(played.length, 4);
  assert.ok(Math.abs(played.reduce((sum, hit) => sum + hit.spec.gain, 0) - 0.3) < 1e-9);
  assert.ok(played.every(hit => Number.isFinite(hit.envelope.startAt) && !("startDelaySeconds" in hit.envelope)));
  assert.equal(context.pendingCornerStrikes.length, 0);
});

test("native noise retrigger holds its in-flight envelope instead of cancelling a ramp underneath it", () => {
  const { pool, context, strike } = recordNativeStrike({
    envelopePoints: percussionEnvelopePreset("note"), attackNoise: 0.5, attackCurve: "smooth",
  });
  context.currentTime = 0.02;
  const calls = strike.noiseGain.gain.calls.length;
  pool.strike({ key: "reference", frequency: 110, gain: 0.2 },
    { envelopePoints: percussionEnvelopePreset("note"), attackNoise: 0.5, retriggerMode: "crossfade" });
  assert.deepEqual(strike.noiseGain.gain.calls[calls], ["hold", 0.02]);
  assert.equal(strike.noiseGain.gain.calls[calls + 1][0], "linear");
  assert.equal(strike.noiseGain.gain.calls[calls + 1][1], 0);
});

test("fallback noise release reconstructs the exact level on both sides of the peak and on repeated release", () => {
  for (const now of [0.002, 0.007, 0.012, 0.024, 0.036]) {
    const { pool, context, strike } = recordNativeStrike({
      envelopePoints: percussionEnvelopePreset("note"), attackNoise: 0.5, attackCurve: "smooth",
    });
    const parameter = strike.noiseGain.gain;
    const expected = scheduledEnvelopeAt(parameter.calls, now);
    delete parameter.cancelAndHoldAtTime;
    context.currentTime = now;
    const oldLength = parameter.calls.length;
    pool.silence();
    assert.deepEqual(parameter.calls[oldLength], ["cancel", now]);
    assert.ok(Math.abs(parameter.calls[oldLength + 1][1] - expected) < 1e-12);
    assert.deepEqual(parameter.calls[oldLength + 1], ["linear", expected, now]);
    assert.ok(strike.noiseEnvelope.at(-1).time <= 0.04 + 1e-9);
    const release = strike.noiseEnvelope.slice(-2);
    const nextTime = (release[0].time + release[1].time) / 2;
    context.currentTime = nextTime;
    const start = parameter.calls.length;
    pool.silence();
    assert.ok(Math.abs(parameter.calls[start + 1][1] - expected / 2) < 1e-12);
  }
});

test("other strike callers retain their previous noise-release automation", () => {
  const { pool, context, strike } = recordNativeStrike({
    envelopePoints: percussionEnvelopePreset("note"), attackNoise: 0.5,
  });
  const parameter = strike.noiseGain.gain, index = parameter.calls.length;
  context.currentTime = 0.02;
  pool.silence();
  assert.deepEqual(parameter.calls.slice(index), [["cancel", 0.02], ["target", 0, 0.02, 0.006]]);
});
