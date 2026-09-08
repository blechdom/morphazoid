import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  HOCKET_MARKER_NODE_LIMIT,
  HOCKET_MARKER_SOURCE_LIMIT,
  hocketMarkerPlan,
} from "../src/hocket-loom-audio.js";
import {
  DEFAULT_HOCKET_STATE,
  HOCKET_PRESETS,
  HOCKET_STEP_OPTIONS,
  advanceHocketTraversal,
  analyzeHocketState,
  compositeHocketTones,
  createHocketState,
  editHocketCell,
  effectiveHocketCell,
  hocketEventsAtStep,
  hocketFocusGain,
  hocketPatternSignature,
  hocketStepDurationSeconds,
  resizeHocketPattern,
  rotateHocketPattern,
  sanitizeHocketState,
  tightenHocketPattern,
} from "../src/hocket-loom.js";

const root = new URL("../", import.meta.url);

test("Hocket Luigi exposes bounded, deeply frozen two- through four-voice studies", () => {
  assert.deepEqual(
    HOCKET_PRESETS.map(({ id }) => id),
    [
      "nyog-cag",
      "cak-telu",
      "olutalo",
      "banda-linda-relay",
      "solkattu-relay",
      "open-weave",
    ]
  );
  assert.deepEqual(HOCKET_STEP_OPTIONS, [8, 12, 16, 24]);
  assert.equal(Object.isFrozen(HOCKET_PRESETS), true);

  for (const preset of HOCKET_PRESETS) {
    const state = createHocketState(preset.id);
    assert.equal(state.presetId, preset.id);
    assert.equal(Object.isFrozen(preset), true);
    assert.equal(Object.isFrozen(preset.patterns), true);
    assert.equal(Object.isFrozen(preset.source), true);
    assert.ok(preset.voiceCount >= 2 && preset.voiceCount <= 4);
    assert.ok(HOCKET_STEP_OPTIONS.includes(preset.length));
    assert.equal(preset.patterns.length, preset.voiceCount);
    assert.equal(preset.patterns.every((row) => Object.isFrozen(row)), true);
    assert.equal(preset.patterns.every((row) => row.length === preset.length), true);
  }

  assert.equal(DEFAULT_HOCKET_STATE.level, 0.32);
  assert.equal(DEFAULT_HOCKET_STATE.soundSet, "relay");
  assert.ok(DEFAULT_HOCKET_STATE.level <= 0.32, "the default output must remain quiet");
  assert.equal(Object.isFrozen(DEFAULT_HOCKET_STATE), true);
  assert.equal(Object.isFrozen(DEFAULT_HOCKET_STATE.patterns), true);
  assert.equal(DEFAULT_HOCKET_STATE.patterns.every(Object.isFrozen), true);
  assert.equal(Object.isFrozen(DEFAULT_HOCKET_STATE.phases), true);
});

test("marker plans give wood, metal, and breath separate bounded mechanisms", () => {
  const soundSets = ["wood", "metal", "breath"];
  for (const soundSet of soundSets) {
    for (const pulseLengthMs of [24, 92, 260]) {
      for (const voice of [0, 1, 2, 3]) {
        for (const tone of [1, 3, 5]) {
          const plan = hocketMarkerPlan({
            soundSet,
            pulseLengthMs,
            voice,
            tone,
            voiceCount: 4,
            peak: 0.2,
          });
          assert.equal(plan.material, soundSet);
          assert.equal(plan.soundSet, soundSet);
          assert.ok(plan.sourceCount > 0);
          assert.ok(plan.sourceCount <= 4);
          assert.ok(plan.sourceCount < HOCKET_MARKER_SOURCE_LIMIT);
          assert.ok(plan.nodeEstimate <= HOCKET_MARKER_NODE_LIMIT);
          assert.ok(plan.durationSeconds >= 0.03 && plan.durationSeconds <= 0.52);
          assert.ok(plan.panStart >= -1 && plan.panStart <= 1);
          assert.ok(plan.panEnd >= -1 && plan.panEnd <= 1);
          for (const oscillator of plan.oscillators) {
            for (const value of [
              oscillator.frequency,
              oscillator.endFrequency,
              oscillator.amplitude,
              oscillator.attack,
              oscillator.duration,
            ]) {
              assert.equal(Number.isFinite(value), true);
              assert.ok(value > 0);
            }
          }
          for (const path of plan.noisePaths) {
            assert.ok(path.filters.length > 0);
            assert.ok(path.duration > 0);
            assert.ok(path.amplitude > 0);
            for (const filter of path.filters) {
              assert.equal(Number.isFinite(filter.frequency), true);
              assert.ok(filter.frequency > 0);
            }
          }
        }
      }
    }
  }

  const relayPlans = Array.from({ length: 4 }, (_, voice) =>
    hocketMarkerPlan({
      soundSet: "relay",
      pulseLengthMs: 92,
      voice,
      tone: voice + 1,
      voiceCount: 4,
      peak: 0.2,
    })
  );
  assert.deepEqual(relayPlans.map(({ material }) => material), ["wood", "metal", "breath", "wood"]);
  assert.equal(relayPlans.every(({ soundSet }) => soundSet === "relay"), true);

  const plans = Object.fromEntries(
    soundSets.map((soundSet) => [
      soundSet,
      hocketMarkerPlan({ soundSet, pulseLengthMs: 92, voice: 1, tone: 3, peak: 0.2 }),
    ])
  );
  assert.ok(plans.wood.durationSeconds < plans.breath.durationSeconds);
  assert.ok(plans.breath.durationSeconds < plans.metal.durationSeconds);
  assert.equal(plans.wood.oscillators.some(({ type }) => type === "triangle"), true);
  assert.equal(plans.metal.oscillators.length, 3);
  assert.equal(plans.breath.oscillators.length, 0);
  assert.equal(plans.breath.noisePaths.length, 3);
  assert.equal(plans.breath.sourceCount, 1);
  assert.equal(new Set(soundSets.map((soundSet) => plans[soundSet].sourceKinds.join("|"))).size, 3);

  const toneFrequencies = [1, 3, 5, 8].map(
    (tone) =>
      hocketMarkerPlan({
        soundSet: "wood",
        voice: 0,
        tone,
      }).oscillators[0].frequency
  );
  assert.equal(new Set(toneFrequencies).size, toneFrequencies.length);
  assert.equal(toneFrequencies.every((frequency, index) =>
    index === 0 || frequency > toneFrequencies[index - 1]), true);

  const metalModalTotals = [0, 1, 2, 3].map((voice) =>
    hocketMarkerPlan({
      soundSet: "metal",
      voice,
      peak: 0.2,
    }).oscillators.reduce((sum, oscillator) => sum + oscillator.amplitude, 0)
  );
  for (const total of metalModalTotals) {
    assert.ok(Math.abs(total - 0.13) < 1e-12);
  }
  assert.ok(Math.abs(Math.max(...metalModalTotals) - Math.min(...metalModalTotals)) < 1e-12);
});

test("Nyog Cag alternates ownership while maintaining one continuous composite", () => {
  const state = createHocketState("nyog-cag");
  const analysis = analyzeHocketState(state);
  assert.equal(state.voiceCount, 2);
  assert.equal(analysis.coverage, 1);
  assert.equal(analysis.gaps, 0);
  assert.equal(analysis.collisions, 0);
  assert.equal(analysis.handoffs, state.length);

  for (let step = 0; step < state.length; step += 1) {
    const events = hocketEventsAtStep(state, step);
    assert.equal(events.length, 1);
    assert.equal(events[0].voice, step % 2);
  }
});

test("handoffs follow circular adjacent owners without bridging silent pulses", () => {
  const base = createHocketState("nyog-cag");
  const sparse = sanitizeHocketState({
    ...base,
    length: 8,
    phases: [0, 0],
    patterns: [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 2, 0, 0, 0, 0, 0],
    ],
  });
  const analysis = analyzeHocketState(sparse);
  assert.equal(analysis.gaps, 6);
  assert.equal(analysis.handoffs, 0);
});

test("the Cak Telu reduction preserves shifted entries and exposes overlap", () => {
  const state = createHocketState("cak-telu");
  const analysis = analyzeHocketState(state);
  assert.equal(state.voiceCount, 3);
  assert.equal(state.length, 16);
  assert.equal(analysis.coverage, 1);
  assert.equal(analysis.gaps, 0);
  assert.equal(analysis.collisions, 2);
  assert.deepEqual(hocketEventsAtStep(state, 7).map(({ voice }) => voice), [1, 2]);
  assert.deepEqual(hocketEventsAtStep(state, 15).map(({ voice }) => voice), [1, 2]);
});

test("Olutalo reproduces the published 24-event analytical pitch cipher", () => {
  const state = createHocketState("olutalo");
  const expected = [4, 1, 3, 5, 4, 2, 3, 1, 3, 5, 3, 2, 4, 1, 3, 5, 4, 2, 4, 1, 2, 5, 2, 2];
  assert.deepEqual(compositeHocketTones(state).map((events) => events[0]), expected);
  assert.deepEqual(
    Array.from({ length: state.length }, (_, step) => hocketEventsAtStep(state, step)[0].voice),
    Array.from({ length: state.length }, (_, step) => step % 2)
  );
  assert.equal(analyzeHocketState(state).coverage, 1);
});

test("preserve mode moves ownership without changing the composite pitch stream", () => {
  const original = createHocketState("nyog-cag");
  const before = compositeHocketTones(original);
  const moved = editHocketCell(original, 1, 0, {
    tool: "pulse",
    preserveComposite: true,
  });
  assert.deepEqual(compositeHocketTones(moved), before);
  assert.deepEqual(hocketEventsAtStep(moved, 0), [{ voice: 1, tone: 1 }]);
  assert.equal(moved.variation, true);

  const movedAgain = editHocketCell(moved, 1, 0, {
    tool: "rest",
    preserveComposite: true,
  });
  assert.deepEqual(compositeHocketTones(movedAgain), before);
  assert.deepEqual(hocketEventsAtStep(movedAgain, 0), [{ voice: 0, tone: 1 }]);
});

test("free weave can create both collisions and genuine gaps", () => {
  const original = createHocketState("nyog-cag");
  const collision = editHocketCell(original, 1, 0, {
    tool: "pulse",
    preserveComposite: false,
  });
  assert.equal(analyzeHocketState(collision).collisions, 1);
  assert.equal(hocketEventsAtStep(collision, 0).length, 2);

  const gap = editHocketCell(original, 0, 0, {
    tool: "rest",
    preserveComposite: false,
  });
  assert.equal(analyzeHocketState(gap).gaps, 1);
  assert.deepEqual(hocketEventsAtStep(gap, 0), []);
});

test("phase, resize, and tighten operations remain deterministic and bounded", () => {
  const original = createHocketState("nyog-cag");
  const shifted = rotateHocketPattern(original, 0, 1);
  assert.equal(effectiveHocketCell(shifted, 0, 1), effectiveHocketCell(original, 0, 0));
  assert.notEqual(hocketPatternSignature(shifted), hocketPatternSignature(original));

  const resized = resizeHocketPattern(createHocketState("olutalo"), 8);
  assert.equal(resized.length, 8);
  assert.equal(resized.patterns.length, 2);
  assert.equal(resized.patterns.every((row) => row.length === 8), true);
  assert.equal(resized.variation, true);

  const porous = createHocketState("open-weave");
  const before = analyzeHocketState(porous);
  const tightened = tightenHocketPattern(porous);
  const after = analyzeHocketState(tightened);
  assert.deepEqual({ gaps: before.gaps, collisions: before.collisions }, { gaps: 1, collisions: 1 });
  assert.deepEqual({ gaps: after.gaps, collisions: after.collisions }, { gaps: 0, collisions: 0 });
});

test("resize preserves interlocking coverage and active voices when reducing the cycle", () => {
  const resized = resizeHocketPattern(createHocketState("nyog-cag"), 8);
  const analysis = analyzeHocketState(resized);
  assert.equal(analysis.coverage, 1);
  assert.equal(analysis.gaps, 0);
  assert.equal(analysis.collisions, 0);
  assert.equal(analysis.handoffs, 8);
  assert.deepEqual(analysis.densities, [4, 4]);
  assert.deepEqual(
    analysis.eventsByStep.map((events) => events[0].voice),
    [0, 1, 0, 1, 0, 1, 0, 1]
  );

  const alignedCollision = rotateHocketPattern(createHocketState("nyog-cag"), 0, 1);
  const collisionResize = analyzeHocketState(resizeHocketPattern(alignedCollision, 8));
  assert.equal(collisionResize.coverage, 1);
  assert.equal(collisionResize.collisions, 8);
  assert.deepEqual(collisionResize.densities, [8, 8]);
});

test("resize applies phase once and keeps every feasible voice across supported grids", () => {
  let phased = rotateHocketPattern(createHocketState("nyog-cag"), 0, 3);
  phased = rotateHocketPattern(phased, 1, -2);
  const expanded = resizeHocketPattern(phased, 24);
  const boundary = (step) => Math.floor((step * 24) / 16 + 0.5);
  assert.deepEqual(expanded.phases, [5, 21]);
  for (let targetStep = 0; targetStep < 24; targetStep += 1) {
    const sourceStep = Array.from({ length: 16 }, (_, step) => step).find(
      (step) => targetStep >= boundary(step) && targetStep < boundary(step + 1)
    );
    assert.notEqual(sourceStep, undefined);
    for (let voice = 0; voice < phased.voiceCount; voice += 1) {
      assert.equal(
        effectiveHocketCell(expanded, voice, targetStep),
        effectiveHocketCell(phased, voice, sourceStep)
      );
    }
  }

  for (const fromLength of HOCKET_STEP_OPTIONS) {
    const source = sanitizeHocketState({
      ...createHocketState("nyog-cag"),
      voiceCount: 4,
      length: fromLength,
      phases: [0, 0, 0, 0],
      patterns: Array.from({ length: 4 }, (_, voice) =>
        Array.from({ length: fromLength }, (_, step) => (step % 4 === voice ? voice + 1 : 0))
      ),
    });
    for (const toLength of HOCKET_STEP_OPTIONS) {
      if (toLength === fromLength) continue;
      const result = analyzeHocketState(resizeHocketPattern(source, toLength));
      assert.equal(result.coverage, 1, `${fromLength}→${toLength} keeps the composite covered`);
      assert.equal(result.collisions, 0, `${fromLength}→${toLength} does not merge relay voices`);
      assert.equal(
        result.densities.every((density) => density > 0),
        true,
        `${fromLength}→${toLength} keeps every active voice`
      );
    }
  }
});

test("hostile state values sanitize to finite limits, valid row shapes, and safe enums", () => {
  const state = sanitizeHocketState({
    presetId: Symbol("unknown"),
    voiceCount: Symbol("voices"),
    length: Symbol("length"),
    pulsesPerBeat: Infinity,
    tempoBpm: Symbol("tempo"),
    swing: -90,
    pulseLengthMs: 99_999,
    level: 7,
    soundSet: "orchestra",
    focusMode: "random",
    phases: [Infinity, -999],
    names: ["A", ""],
    patterns: [[Infinity, -4, 99, "3"], null],
  });
  assert.equal(state.voiceCount, 2);
  assert.ok(HOCKET_STEP_OPTIONS.includes(state.length));
  assert.ok(Number.isFinite(state.tempoBpm));
  assert.ok(state.tempoBpm >= 36 && state.tempoBpm <= 220);
  assert.ok(state.swing >= 0 && state.swing <= 0.46);
  assert.ok(state.pulseLengthMs >= 24 && state.pulseLengthMs <= 260);
  assert.ok(state.level >= 0 && state.level <= 0.62);
  assert.equal(state.soundSet, "relay");
  assert.equal(state.focusMode, "balanced");
  assert.equal(state.patterns.length, state.voiceCount);
  assert.equal(state.patterns.every((row) => row.length === state.length), true);
  assert.equal(
    state.patterns.flat().every((value) => Number.isFinite(value) && value >= 0 && value <= 8),
    true
  );
});

test("loop and ping-pong traversal remain deterministic in both directions", () => {
  const sequence = ({ step, direction, length, mode, count = 8 }) => {
    let cursor = { step, direction };
    const steps = [cursor.step];
    for (let index = 1; index < count; index += 1) {
      cursor = advanceHocketTraversal(cursor.step, cursor.direction, length, mode);
      steps.push(cursor.step);
    }
    return steps;
  };

  assert.deepEqual(sequence({ step: 0, direction: 1, length: 4, mode: "loop" }), [0, 1, 2, 3, 0, 1, 2, 3]);
  assert.deepEqual(sequence({ step: 0, direction: -1, length: 4, mode: "loop" }), [0, 3, 2, 1, 0, 3, 2, 1]);
  assert.deepEqual(sequence({ step: 0, direction: 1, length: 4, mode: "pingpong" }), [0, 1, 2, 3, 2, 1, 0, 1]);
  assert.deepEqual(sequence({ step: 3, direction: -1, length: 4, mode: "pingpong" }), [3, 2, 1, 0, 1, 2, 3, 2]);

  assert.deepEqual(advanceHocketTraversal(0, -1, 1, "pingpong"), {
    step: 0,
    direction: -1,
  });
  assert.deepEqual(
    advanceHocketTraversal(Symbol("step"), Symbol("direction"), Symbol("length"), "pingpong"),
    { step: 0, direction: 1 }
  );
});

test("pair swing preserves total pair duration and focus modes only alter gain", () => {
  const straight = sanitizeHocketState({ ...createHocketState(), tempoBpm: 120, swing: 0 });
  const swung = sanitizeHocketState({ ...straight, swing: 0.4 });
  const straightPair =
    hocketStepDurationSeconds(straight, 0) + hocketStepDurationSeconds(straight, 1);
  const swungPair =
    hocketStepDurationSeconds(swung, 0) + hocketStepDurationSeconds(swung, 1);
  assert.ok(Math.abs(straightPair - swungPair) < 1e-12);
  assert.ok(hocketStepDurationSeconds(swung, 0) > hocketStepDurationSeconds(swung, 1));
  assert.equal(hocketFocusGain("balanced", 2, 8, 4), 1);
  assert.ok(hocketFocusGain("rotating", 2, 8, 4) > hocketFocusGain("rotating", 1, 8, 4));
});

test("page markup exposes one explicit audio arm, one primary transport, and no authored WAX bootstrap", async () => {
  const [html, app, audioModule, research] = await Promise.all([
    readFile(new URL("hocket-loom.html", root), "utf8"),
    readFile(new URL("hocket-loom-app.js", root), "utf8"),
    readFile(new URL("src/hocket-loom-audio.js", root), "utf8"),
    readFile(new URL("HOCKET_LOOM_RESEARCH.md", root), "utf8"),
  ]);
  assert.match(html, /<title>Hocket Luigi · Morphazoid<\/title>/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /class="hocket-canvas-wrap"[^>]*>[\s\S]*<h1 id="pageTitle">HOCKET LUIGI<\/h1>[\s\S]*<canvas/);
  assert.equal((html.match(/id="tempoBpm"/g) || []).length, 1);
  assert.match(html, /<section class="hocket-transport"[^>]*>[\s\S]*id="tempoBpm"[\s\S]*id="motionModeMount"[\s\S]*<\/section>/);
  assert.match(html, /class="audio-button" id="audioButton"[^>]*aria-pressed="false"/);
  assert.equal((html.match(/data-primary-transport/g) || []).length, 1);
  assert.match(html, /id="loomCanvas"[^>]*tabindex="0"[^>]*role="application"/s);
  assert.match(html, /id="preserveComposite" type="checkbox" checked/);
  assert.doesNotMatch(html, /DISTRIBUTED PULSE|COMPOSITE RHYTHM|2–4 VOICES|One cycle, passed from hand to hand|presetRegion/);
  assert.doesNotMatch(html, /hocket-metrics|coverageOut|handoffOut|gapOut|collisionOut/);
  assert.doesNotMatch(html, /wax-host-bootstrap|wax-page\.js|MorphazoidWAX/);
  assert.match(app, /setInterval\(schedulerTick, 24\)/);
  assert.match(app, /const horizon = 0\.12/);
  assert.match(app, /createMotionModeGroup/);
  assert.match(app, /advanceHocketTraversal/);
  assert.match(app, /this\.groups\.size >= 96/);
  assert.match(app, /HOCKET_MARKER_SOURCE_LIMIT/);
  assert.doesNotMatch(app, /Math\.random/);
  assert.match(audioModule, /scheduleHocketMarker/);
  assert.match(research, /^# Hocket Luigi:/);
  assert.match(research, /generic .*monkey chant/i);
  assert.match(research, /not claims of authentic sound or performance/);
});
