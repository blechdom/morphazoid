import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { percussionEnvelopePreset, percussionEnvelopeTimeMs } from "../src/audio.js";
import { SHAPE_FULL_PRESETS } from "../src/instruments/shape-synth/full-presets.js";
import { recordNativeStrike, renderNativeStrikeReference, scheduledEnvelopeAt } from "./helpers/strike-reference.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/preset-audition-before-20260921.json", import.meta.url)));
const flagged = ["uneven-drum-wheel", "clustered-marimba", "orbiting-knuckles", "low-corner-kit", "insect-clock", "corner-storm"];
const preset = id => SHAPE_FULL_PRESETS.find(p => p.id === id).snapshot.parameters;

test("smooth attack is opt-in; existing percussion retains its original exponential automation", () => {
  const envelopePoints = percussionEnvelopePreset("pluck");
  const before = recordNativeStrike({ envelopePoints }).strike;
  assert.deepEqual(before.gain.gain.calls.map(([kind]) => kind),
    ["value", "exponential", "exponential", "exponential", "exponential", "value"]);
  const smooth = recordNativeStrike({ envelopePoints, attackCurve: "smooth" }).strike;
  assert.equal(smooth.attackEndsAt, before.attackEndsAt);
  assert.equal(smooth.endedAt, before.endedAt);
  assert.equal(smooth.oscillator.startTime, before.oscillator.startTime);
  assert.equal(smooth.oscillator.stopTime, before.oscillator.stopTime);
  assert.equal(smooth.gain.gain.calls.filter(([kind]) => kind === "linear").length, 24);
  assert.deepEqual(smooth.gain.gain.calls.slice(-4), before.gain.gain.calls.slice(-4),
    "decay/sustain/release and final silence are not rewritten");
  assert.equal(scheduledEnvelopeAt(smooth.gain.gain.calls, smooth.attackEndsAt), 0.5);
  assert.equal(scheduledEnvelopeAt(smooth.gain.gain.calls, smooth.endedAt + 0.02), 0);
});

test("all flagged Shape presets have longer, less abrupt onsets and reduced attack noise", () => {
  for (const id of flagged) {
    const before = fixture.shape.find(p => p.id === id).parameters;
    const after = preset(id);
    assert.equal(after.soundMode, "percussion", "do not hide the defect by replacing percussion with another engine");
    assert.ok(after.percussionAttackNoise < before.percussionAttackNoise, id);
    const attackMs = percussionEnvelopeTimeMs(after.percussionEnvelopePoints[1].x);
    assert.ok(attackMs >= 8 - 1e-9 && attackMs <= 14 + 1e-9, `${id}: deliberate short rounded attack`);
    for (const sampleRate of [44100, 48000, 96000]) {
      for (const frequency of [55, 110, 440, 880]) {
        const oldRender = renderNativeStrikeReference({
          envelopePoints: before.percussionEnvelopePoints, attackNoise: before.percussionAttackNoise,
          sampleRate, frequency,
        });
        const newRender = renderNativeStrikeReference({
          envelopePoints: after.percussionEnvelopePoints, attackNoise: after.percussionAttackNoise,
          attackCurve: "smooth", sampleRate, frequency,
        });
        assert.ok(newRender.samples.every(Number.isFinite));
        assert.ok(newRender.summary.peak <= 0.5 + 1e-7);
        assert.ok(newRender.summary.rms > 0.001);
        assert.ok(newRender.summary.maximumNormalizedAttackSlope < oldRender.summary.maximumNormalizedAttackSlope * 0.5,
          `${id}/${sampleRate}: onset must measurably soften, not merely get quieter`);
        assert.ok(newRender.summary.noisePeak <= oldRender.summary.noisePeak);
        const tail = newRender.samples.slice(-Math.round(sampleRate * 0.01));
        assert.ok(tail.every(value => value === 0), `${id}: exact ended silence`);
      }
    }
  }
});

test("smooth attacks still reserve their full peak and use the existing retrigger release", () => {
  const { pool, context, strike } = recordNativeStrike({
    envelopePoints: preset("clustered-marimba").percussionEnvelopePoints, attackCurve: "smooth",
  });
  context.currentTime = strike.attackEndsAt / 2;
  assert.ok(Math.abs(pool.availableStrikeHeadroom() - 0.28) < 1e-10);
  context.currentTime = 0.04;
  const accepted = pool.strike({ key: "reference", frequency: 330, gain: 0.2 },
    { envelopePoints: preset("clustered-marimba").percussionEnvelopePoints, attackCurve: "smooth", retriggerMode: "crossfade" });
  assert.equal(accepted, true);
  assert.ok(strike.gain.gain.calls.some(([kind]) => kind === "hold"));
  assert.ok(strike.endedAt < 0.1);
  assert.equal(pool.activeStrikes.size, 2, "old tail releases rather than disappearing immediately");
});

test("the densest presets retain clear repeated strikes instead of thousands of events per second", () => {
  const estimate = p => p.sides * (p.closedShapeType === "star" ? 2 : 1) * p.heads
    * ((p.playing ? p.speed * (p.motionMode === "pingpong" ? 2 : 1) : 0)
      + (p.autoRotate && p.playMethod === "radial" ? p.rotationSpeed * (p.rotationMotionMode === "pingpong" ? 2 : 1) : 0));
  for (const id of ["insect-clock", "corner-storm"]) {
    const before = estimate(fixture.shape.find(p => p.id === id).parameters), after = estimate(preset(id));
    assert.ok(after < before / 4, `${id}: density cut`);
    assert.ok(after >= 20 && after < 60, `${id}: still a busy rhythm, not the old overloaded cluster`);
  }
});

test("only Shape explicitly enables the rounded attack; its gain and voice bounds stay in place", async () => {
  const app = await readFile(new URL("../src/instruments/shape-synth/shape-synth-app.js", import.meta.url), "utf8");
  assert.match(app, /attackCurve: "smooth"/);
  assert.match(app, /STRIKE_BATCH_CEILING = 0\.78/);
  assert.match(app, /normalizeStrikeGains\(/);
  assert.match(app, /availableStrikeHeadroom/);
});
