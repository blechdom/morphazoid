import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS, resolveActiveTool } from "../nav.js";
import {
  BLOWHOLE_CALLS,
  BLOWHOLE_CALL_LOOKUP,
  BLOWHOLE_DEFAULTS,
  BLOWHOLE_GESTURE_LANES,
  BLOWHOLE_LIMITS,
  BLOWHOLE_SOURCE_FAMILIES,
  blowholeCall,
  createBlowholeRandom,
  createBlowholeState,
  createBlowholeVoicePlan,
  deriveBlowholeGeometry,
  deriveBlowholeReadout,
  evaluateBlowholeGesture,
  interpolateBlowholeLane,
  mapPhysicalToAudible,
  randomizeBlowholeState,
  sanitizeBlowholeState,
} from "../src/blowhole.js";
import { instrumentById } from "../src/instrument-catalog.js";
import {
  PAGE_KEYBOARD_INSTRUMENT_IDS,
  instrumentMidiCapabilityForId,
} from "../src/instrument-midi-capabilities.js";

const root = new URL("../", import.meta.url);
const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const EXPECTED_CALL_IDS = Object.freeze([
  "bottlenose-signature-whistle",
  "dolphin-search-clicks",
  "dolphin-terminal-buzz",
  "orca-pulsed-call",
  "sperm-whale-coda",
  "humpback-moan",
  "humpback-two-voice-phrase",
  "blue-whale-b-call",
]);
const PUBLIC_STATE_KEYS = Object.freeze([
  "callId",
  "pressure",
  "tension",
  "closure",
  "asymmetry",
  "recycle",
  "focus",
  "scale",
  "roughness",
  "pulseRateHz",
  "depthM",
  "monitorMode",
  "level",
]);

function assertClose(actual, expected, message, epsilon = 1e-12) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function assertFiniteTree(value, label = "value", seen = new Set()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    for (let index = 0; index < value.length; index += 1) {
      assert.ok(Number.isFinite(value[index]), `${label}[${index}] must be finite`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== "function") assertFiniteTree(child, `${label}.${key}`, seen);
  }
}

function assertInRange(value, range, label) {
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  assert.ok(
    value >= range[0] && value <= range[1],
    `${label} must stay inside ${range[0]}..${range[1]}, received ${value}`,
  );
}

function assertStateBounds(state, label) {
  assert.deepEqual(Object.keys(state), PUBLIC_STATE_KEYS, `${label} must expose only public controls`);
  for (const key of PUBLIC_STATE_KEYS.filter((candidate) => BLOWHOLE_LIMITS[candidate])) {
    assertInRange(state[key], BLOWHOLE_LIMITS[key], `${label}.${key}`);
  }
  assert.ok(["audible", "physical"].includes(state.monitorMode));
  assert.ok(BLOWHOLE_CALL_LOOKUP[state.callId], `${label} must select a known call`);
  assertFiniteTree(state, label);
}

function assertGestureBounds(gesture, call, label) {
  assertInRange(gesture.phase, [0, 1], `${label}.phase`);
  for (const lane of BLOWHOLE_GESTURE_LANES) {
    assertInRange(gesture[lane], [0, 1], `${label}.${lane}`);
    assert.equal(gesture.lanes[lane], gesture[lane]);
  }
  assertInRange(gesture.asymmetryBipolar, [-1, 1], `${label}.asymmetryBipolar`);
  assertInRange(
    gesture.physicalFrequencyHz,
    call.physicalRange.frequencyHz,
    `${label}.physicalFrequencyHz`,
  );
  if (call.physicalRange.pulseRateHz[1] === 0) {
    assert.equal(gesture.pulseRateHz, 0, `${label} must not invent a pulse train`);
  } else {
    assertInRange(
      gesture.pulseRateHz,
      call.physicalRange.pulseRateHz,
      `${label}.pulseRateHz`,
    );
  }
  assertFiniteTree(gesture, label);
}

function assertPlanBounds(plan, call, label) {
  assert.equal(plan.callId, call.id);
  assert.equal(plan.underwater, true);
  assert.equal(plan.blowholeSealed, true);
  assert.equal(plan.externalBlowholeAperture, 0);
  assertInRange(plan.phase, [0, 1], `${label}.phase`);
  assertInRange(
    plan.physicalFrequencyHz,
    call.physicalRange.frequencyHz,
    `${label}.physicalFrequencyHz`,
  );
  assertInRange(
    plan.audibleFrequencyHz,
    BLOWHOLE_LIMITS.audibleFrequencyHz,
    `${label}.audibleFrequencyHz`,
  );
  assertInRange(
    plan.monitorFrequencyHz,
    BLOWHOLE_LIMITS.audibleFrequencyHz,
    `${label}.monitorFrequencyHz`,
  );
  assertInRange(plan.focus, [0, 1], `${label}.focus`);
  assertInRange(plan.level, [0, 1], `${label}.level`);
  assert.ok(plan.voices.length >= 1 && plan.voices.length <= 2);
  for (const [index, voice] of plan.voices.entries()) {
    assertInRange(
      voice.physicalFrequencyHz,
      BLOWHOLE_LIMITS.physicalFrequencyHz,
      `${label}.voices[${index}].physicalFrequencyHz`,
    );
    assertInRange(
      voice.monitorFrequencyHz,
      BLOWHOLE_LIMITS.audibleFrequencyHz,
      `${label}.voices[${index}].monitorFrequencyHz`,
    );
    assertInRange(voice.gain, [0, 1], `${label}.voices[${index}].gain`);
    assertInRange(voice.closure, [0, 1], `${label}.voices[${index}].closure`);
    assertInRange(voice.roughness, [0, 1], `${label}.voices[${index}].roughness`);
    assertInRange(voice.pulseRateHz, BLOWHOLE_LIMITS.pulseRateHz, `${label}.voices[${index}].pulseRateHz`);
    assertInRange(voice.phaseOffsetCycles, [0, 1], `${label}.voices[${index}].phaseOffsetCycles`);
    assertInRange(voice.bandwidthHz, [0.1, 180_000], `${label}.voices[${index}].bandwidthHz`);
  }
  assertFiniteTree(plan, label);
}

function tagWithId(source, tagName, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`<${tagName}\\b[^>]*\\bid=["']${escaped}["'][^>]*>`, "i"))?.[0] ?? "";
}

test("Blowhole defines exactly eight calls across the two anatomically distinct source families", () => {
  assert.deepEqual(BLOWHOLE_CALLS.map(({ id }) => id), EXPECTED_CALL_IDS);
  assert.equal(Object.keys(BLOWHOLE_CALL_LOOKUP).length, EXPECTED_CALL_IDS.length);
  assert.equal(new Set(BLOWHOLE_CALLS.map(({ id }) => id)).size, EXPECTED_CALL_IDS.length);
  assert.deepEqual(
    new Set(BLOWHOLE_CALLS.map(({ sourceFamily }) => sourceFamily)),
    new Set(Object.values(BLOWHOLE_SOURCE_FAMILIES)),
  );
  assert.deepEqual(
    BLOWHOLE_CALLS.reduce((counts, call) => ({
      ...counts,
      [call.family]: (counts[call.family] ?? 0) + 1,
    }), {}),
    { odontocete: 5, mysticete: 3 },
  );

  for (const call of BLOWHOLE_CALLS) {
    assert.equal(blowholeCall(call.id), call);
    assert.ok(Object.isFrozen(call), `${call.id} must be immutable`);
    assert.ok(call.label.length > 8 && call.description.length > 70);
    assert.ok(call.species.length > 3 && call.register.length > 5);
    assert.match(call.anatomy.externalBlowhole, /sealed underwater/i);
    assert.doesNotMatch(call.anatomy.generator, /external blowhole/i);
    assert.equal(call.sourcePath.at(-1), "seawater");
    assert.equal(call.sourcePath.some((stage) => /external blowhole/i.test(stage)), false);
    assertInRange(call.durationMs, BLOWHOLE_LIMITS.durationMs, `${call.id}.durationMs`);
    assertInRange(
      call.durationMs / 1_000,
      call.physicalRange.durationSeconds,
      `${call.id}.durationSeconds`,
    );
    assert.deepEqual(Object.keys(call.lanes), BLOWHOLE_GESTURE_LANES);
    for (const lane of BLOWHOLE_GESTURE_LANES) {
      const points = call.lanes[lane];
      assert.ok(Object.isFrozen(points));
      assert.ok(points.length >= 2, `${call.id}.${lane} needs a contour`);
      points.forEach(([phase, value], index) => {
        assertInRange(phase, [0, 1], `${call.id}.${lane}[${index}].phase`);
        assertInRange(value, [0, 1], `${call.id}.${lane}[${index}].value`);
        if (index > 0) assert.ok(phase >= points[index - 1][0]);
        assertClose(
          interpolateBlowholeLane(call, lane, phase),
          value,
          `${call.id}.${lane}[${index}] interpolation`,
        );
      });
    }
    if (call.id === "sperm-whale-coda") {
      assert.equal(call.sourceFamily, BLOWHOLE_SOURCE_FAMILIES.ODONTOCETE);
      assert.equal(call.anatomy.blowholeCount, 1);
      assert.match(call.anatomy.generator, /single right.*phonic-lip/i);
      assert.match(call.anatomy.resonator, /spermaceti/i);
      assert.match(call.anatomy.projector, /junk/i);
      assert.doesNotMatch(call.anatomy.projector, /melon/i);
    } else if (call.family === "odontocete") {
      assert.equal(call.sourceFamily, BLOWHOLE_SOURCE_FAMILIES.ODONTOCETE);
      assert.equal(call.anatomy.blowholeCount, 1);
      assert.match(call.anatomy.generator, /phonic lips/i);
      assert.match(call.anatomy.projector, /melon/i);
    } else {
      assert.equal(call.sourceFamily, BLOWHOLE_SOURCE_FAMILIES.MYSTICETE);
      assert.equal(call.anatomy.blowholeCount, 2);
      assert.match(call.anatomy.generator, /U-fold/i);
      assert.match(call.anatomy.generator, /cricoid-cushion mucosa/i);
      assert.match(call.anatomy.resonator, /laryngeal sac/i);
    }
  }

  assert.equal(blowholeCall("not-a-call").id, BLOWHOLE_DEFAULTS.callId);
});

test("Blowhole starts on a conservative mid-register call at a quiet master level", () => {
  assert.equal(BLOWHOLE_DEFAULTS.callId, "orca-pulsed-call");
  assert.equal(BLOWHOLE_DEFAULTS.level, 0.34);

  const defaultState = createBlowholeState();
  assert.equal(defaultState.callId, "orca-pulsed-call");
  assert.equal(defaultState.level, 0.34);

  const monitorFrequencies = Array.from({ length: 101 }, (_, index) => (
    createBlowholeVoicePlan(defaultState, index / 100).monitorFrequencyHz
  ));
  assert.ok(Math.min(...monitorFrequencies) >= 800);
  assert.ok(Math.max(...monitorFrequencies) <= 4_000);
});

test("the external blowhole stays sealed throughout every underwater sounding plan and geometry", () => {
  for (const call of BLOWHOLE_CALLS) {
    const state = createBlowholeState(call.id, {
      pressure: 1,
      closure: 0,
      recycle: 1,
      focus: 1,
    });
    for (const phase of [0, 0.2, 0.5, 0.8, 1]) {
      const geometry = deriveBlowholeGeometry(state, phase);
      const plan = createBlowholeVoicePlan(state, phase);
      assert.equal(geometry.underwater, true, `${call.id} geometry must remain underwater`);
      assert.equal(geometry.blowholeSealed, true, `${call.id} geometry must seal the blowhole`);
      assert.equal(geometry.externalBlowholeSeal, 1);
      assert.equal(geometry.externalBlowholeAperture, 0);
      assert.equal(plan.underwater, true);
      assert.equal(plan.blowholeSealed, true);
      assert.equal(plan.externalBlowholeAperture, 0);
    }
  }
});

test("the sperm-whale coda retains five exact authored collision times", () => {
  const call = blowholeCall("sperm-whale-coda");
  const plan = createBlowholeVoicePlan(createBlowholeState(call.id), 0);
  assert.deepEqual(call.pulseTimes, [0, 0.12, 0.28, 0.57, 0.86]);
  assert.strictEqual(call.pulsePattern, call.pulseTimes);
  assert.deepEqual(plan.pulseTimes, call.pulseTimes);
  [0, 0.192, 0.448, 0.912, 1.376].forEach((seconds, index) => {
    assertClose(plan.eventTimesSeconds[index], seconds, `coda event ${index}`);
  });
  assert.deepEqual(
    plan.eventTimesSeconds.map((seconds) => Math.round(seconds * SAMPLE_RATE)),
    [0, 9_216, 21_504, 43_776, 66_048],
  );
  assert.equal(plan.durationSeconds, 1.6);
  assert.equal(plan.voices.length, 1);
  assert.match(plan.voices[0].anatomicalSource, /single right phonic lips/i);
  assert.equal(plan.generatorType, "single-right-phonic-lips");
  assert.equal(plan.resonatorType, "spermaceti-case-bent-horn");
  assert.equal(plan.radiatorType, "junk-terminal-acoustic-window");
  assert.ok(plan.headReflectionDelaySeconds > 0);

  call.pulseTimes.forEach((phase, index) => {
    const gesture = evaluateBlowholeGesture(call, phase, createBlowholeState(call.id));
    assert.equal(gesture.nearestPulseIndex, index);
    assert.equal(gesture.nearestPulsePhase, phase);
    assert.equal(gesture.pulse, 1);
  });
});

test("authored unilateral dolphin sources stay selected in the public voice plan", () => {
  const cases = [
    ["bottlenose-signature-whistle", "single-left-phonic-lips", /left phonic lips/i],
    ["dolphin-search-clicks", "single-right-phonic-lips", /right phonic lips/i],
    ["dolphin-terminal-buzz", "single-right-phonic-lips", /right phonic lips/i],
  ];
  for (const [callId, generatorType, sourcePattern] of cases) {
    for (const asymmetry of [-1, 0, 1]) {
      const plan = createBlowholeVoicePlan(createBlowholeState(callId, { asymmetry }), 0.5);
      assert.equal(plan.voices.length, 1);
      assert.equal(plan.generatorType, generatorType);
      assert.match(plan.voices[0].anatomicalSource, sourcePattern);
      assert.ok(plan.voices[0].gain > 0, `${callId} must not mute when laterality is hostile`);
    }
  }
});

test("hostile controls and phases sanitize to finite bounded states, gestures, and audible plans", () => {
  const hostileValues = [-1e300, 1e300, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  const numericKeys = PUBLIC_STATE_KEYS.filter((key) => BLOWHOLE_LIMITS[key]);

  for (const [callIndex, call] of BLOWHOLE_CALLS.entries()) {
    const hostile = { callId: call.id, monitorMode: "not-a-monitor" };
    numericKeys.forEach((key, index) => {
      hostile[key] = hostileValues[(callIndex + index) % hostileValues.length];
    });
    const fallback = createBlowholeState(call.id);
    const snapshot = structuredClone(fallback);
    const state = sanitizeBlowholeState(hostile, fallback);
    assertStateBounds(state, call.id);
    assert.equal(state.callId, call.id);
    assert.equal(state.monitorMode, fallback.monitorMode);
    assert.deepEqual(fallback, snapshot, "sanitation must not mutate its fallback");
    assert.ok(Object.isFrozen(state));

    for (const phase of [-1e300, -1, 0, 0.125, 0.5, 0.875, 1, 2, 1e300, Number.NaN]) {
      const gesture = evaluateBlowholeGesture(call, phase, state);
      const plan = createBlowholeVoicePlan(state, phase);
      assertGestureBounds(gesture, call, `${call.id}@${String(phase)}`);
      assertPlanBounds(plan, call, `${call.id}@${String(phase)}`);
      assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.voices));
    }
  }

  assertStateBounds(sanitizeBlowholeState(null), "null state");
  assertStateBounds(sanitizeBlowholeState([]), "array state");
  assertStateBounds(
    sanitizeBlowholeState({ pressure: Symbol("hostile"), tension: { valueOf() { throw new Error("no"); } } }),
    "coercion-resistant state",
  );
});

test("audible monitoring octave-folds only the monitor pitch and preserves factual frequency", () => {
  const cases = [
    { physical: 15, audible: 60, octaves: 2 },
    { physical: 40, audible: 40, octaves: 0 },
    { physical: 440, audible: 440, octaves: 0 },
    { physical: 20_000, audible: 10_000, octaves: -1 },
    { physical: 130_000, audible: 8_125, octaves: -4 },
    { physical: 200_000, audible: 6_250, octaves: -5 },
  ];
  for (const expected of cases) {
    const mapped = mapPhysicalToAudible(expected.physical, "audible");
    assert.equal(mapped.physicalFrequencyHz, expected.physical);
    assert.equal(mapped.audibleFrequencyHz, expected.audible);
    assert.equal(mapped.monitorFrequencyHz, expected.audible);
    assert.equal(mapped.shiftOctaves, expected.octaves);
    assert.equal(mapped.shiftSemitones, expected.octaves * 12);
    assert.equal(mapped.transpositionRatio, 2 ** expected.octaves);
    assert.equal(mapped.transposed, expected.octaves !== 0);
  }

  const physical = mapPhysicalToAudible(130_000, "physical");
  assert.equal(physical.physicalFrequencyHz, 130_000);
  assert.equal(physical.audibleFrequencyHz, 8_125);
  assert.equal(physical.monitorFrequencyHz, 130_000);
  assert.equal(physical.monitorMode, "physical");
  assert.equal(physical.physicallyAudible, false);

  const blue = deriveBlowholeReadout(
    createBlowholeState("blue-whale-b-call", { monitorMode: "audible" }),
    0,
  );
  assert.ok(blue.physicalFrequencyHz < BLOWHOLE_LIMITS.audibleFrequencyHz[0]);
  assertInRange(blue.monitorFrequencyHz, BLOWHOLE_LIMITS.audibleFrequencyHz, "blue monitor");
  assert.notEqual(blue.monitorFrequencyHz, blue.physicalFrequencyHz);

  for (const call of BLOWHOLE_CALLS) {
    const shifts = new Set();
    for (let index = 0; index <= 100; index += 1) {
      const plan = createBlowholeVoicePlan(createBlowholeState(call.id), index / 100);
      shifts.add(plan.audibleShiftOctaves);
      if (plan.voices.length < 2) continue;
      assertClose(
        plan.voices[1].monitorFrequencyHz / plan.voices[0].monitorFrequencyHz,
        plan.voices[1].physicalFrequencyHz / plan.voices[0].physicalFrequencyHz,
        `${call.id}@${index / 100} shared monitor shift`,
        1e-10,
      );
    }
    assert.equal(shifts.size, 1, `${call.id} must use one shift across its complete contour`);
  }
});

test("the manual pulse-rate control does not rewrite authored call contours", () => {
  for (const call of BLOWHOLE_CALLS.filter(({ physicalRange }) => physicalRange.pulseRateHz[1] > 0)) {
    const slow = createBlowholeState(call.id, { pulseRateHz: 0 });
    const fast = createBlowholeState(call.id, { pulseRateHz: BLOWHOLE_LIMITS.pulseRateHz[1] });
    for (const phase of [0, 0.2, 0.5, 0.8, 1]) {
      assert.equal(
        evaluateBlowholeGesture(call, phase, slow).pulseRateHz,
        evaluateBlowholeGesture(call, phase, fast).pulseRateHz,
        `${call.id}@${phase} must retain its authored pulse contour`,
      );
    }
  }
});

test("the orca M1 preset locks pulse repetition to f0 and leaves source side unassigned", () => {
  const call = blowholeCall("orca-pulsed-call");
  assert.equal(call.pulseLockedToFundamental, true);
  assert.deepEqual(call.physicalRange.frequencyHz, [500, 10_000]);
  assert.deepEqual(call.physicalRange.pulseRateHz, call.physicalRange.frequencyHz);
  for (const phase of [0, 0.2, 0.5, 0.8, 1]) {
    const gesture = evaluateBlowholeGesture(call, phase, createBlowholeState(call.id));
    const plan = createBlowholeVoicePlan(createBlowholeState(call.id), phase);
    assertClose(gesture.pulseRateHz, gesture.physicalFrequencyHz, `orca M1@${phase} f0`);
    assert.equal(plan.voices.length, 1);
    assert.equal(plan.voices[0].pulseRateHz, plan.voices[0].physicalFrequencyHz);
    assert.equal(plan.voices[0].excitation, "self-oscillating-m1-pulse-register");
    assert.equal(plan.generatorType, "side-unspecified-phonic-lip-m1-register");
  }
  const geometry = deriveBlowholeGeometry(createBlowholeState(call.id), 0.5);
  assert.equal(geometry.activeNasalSource, "side-unassigned");
  assert.equal(geometry.phonicLipActiveCount, 1);
  assert.equal(geometry.leftPhonicLipActive, false);
  assert.equal(geometry.rightPhonicLipActive, false);
  assert.ok(geometry.unassignedPhonicLipGap > 0);
});

test("family geometry and readouts expose depth without confusing sources, resonators, or radiators", () => {
  const odontocete = createBlowholeState("dolphin-search-clicks", {
    depthM: 1_500,
    recycle: 0.8,
    focus: 0.9,
  });
  const mysticete = createBlowholeState("humpback-moan", {
    depthM: 3_000,
    recycle: 0.8,
    focus: 0.9,
  });
  const nasal = deriveBlowholeGeometry(odontocete, 0.5);
  const laryngeal = deriveBlowholeGeometry(mysticete, 0.5);

  assert.equal(nasal.sourceFamily, BLOWHOLE_SOURCE_FAMILIES.ODONTOCETE);
  assert.equal(nasal.blowholeCount, 1);
  assert.equal(nasal.depthNormalized, 0.5);
  assert.equal(nasal.activeNasalSource, "right");
  assert.equal(nasal.leftPhonicLipActive, false);
  assert.equal(nasal.rightPhonicLipActive, true);
  assert.equal(nasal.leftPhonicLipGap, 0);
  assert.ok(nasal.rightPhonicLipGap > 0);
  assert.ok(nasal.nasalAirSacInflation > 0 && nasal.melonFocus > 0);
  assert.equal(nasal.uFoldOpening, 0);
  assert.equal(nasal.fatCushionContact, 0);
  assert.equal(nasal.laryngealSacInflation, 0);

  assert.equal(laryngeal.sourceFamily, BLOWHOLE_SOURCE_FAMILIES.MYSTICETE);
  assert.equal(laryngeal.blowholeCount, 2);
  assert.equal(laryngeal.depthNormalized, 1);
  assert.ok(laryngeal.depthDriveGain < 0.01);
  assert.ok(laryngeal.internalPressure < 0.01);
  assert.equal(laryngeal.leftPhonicLipGap, 0);
  assert.equal(laryngeal.rightPhonicLipGap, 0);
  assert.equal(laryngeal.nasalAirSacInflation, 0);
  assert.equal(laryngeal.melonFocus, 0);
  assert.ok(laryngeal.uFoldOpening > 0);
  assert.ok(laryngeal.fatCushionContact > 0);
  assert.ok(laryngeal.laryngealSacInflation > 0);
  assert.ok(laryngeal.laryngealSacInflation < 0.01);
  assert.ok(laryngeal.tissueRadiationFocus > 0);

  for (const [state, geometry] of [[odontocete, nasal], [mysticete, laryngeal]]) {
    const readout = deriveBlowholeReadout(state, 0.5);
    assert.equal(readout.blowholeSealed, true);
    assert.equal(readout.depthM, state.depthM);
    assertClose(
      readout.ambientPressureKPa,
      101.325 + state.depthM * 10.06,
      `${readout.callId} ambient pressure`,
      1e-9,
    );
    assert.equal(readout.generator, blowholeCall(state.callId).anatomy.generator);
    assert.equal(readout.resonator, blowholeCall(state.callId).anatomy.resonator);
    assert.equal(readout.projector, blowholeCall(state.callId).anatomy.projector);
    assertFiniteTree(readout, `${state.callId}.readout`);
    assertFiniteTree(geometry, `${state.callId}.geometry`);
  }
});

test("seeded randomization is deterministic, immutable, selector-preserving, and call-bounded", () => {
  const input = createBlowholeState("dolphin-terminal-buzz", {
    monitorMode: "physical",
    depthM: 800,
  });
  const snapshot = structuredClone(input);
  const first = randomizeBlowholeState(input, "same-seed");
  const second = randomizeBlowholeState(input, "same-seed");
  const different = randomizeBlowholeState(input, "different-seed");
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.deepEqual(input, snapshot);
  assert.notStrictEqual(first, input);
  assert.equal(first.callId, input.callId);
  assert.equal(first.monitorMode, input.monitorMode);
  assertStateBounds(first, "randomized buzz");
  assertInRange(
    first.pulseRateHz,
    blowholeCall(first.callId).physicalRange.pulseRateHz,
    "randomized buzz pulse rate",
  );

  const whistle = randomizeBlowholeState("bottlenose-signature-whistle", 42);
  assert.equal(whistle.pulseRateHz, 0);
  assert.equal(whistle.callId, "bottlenose-signature-whistle");

  const a = createBlowholeRandom("repeatable");
  const b = createBlowholeRandom("repeatable");
  const sequenceA = Array.from({ length: 16 }, a);
  const sequenceB = Array.from({ length: 16 }, b);
  assert.deepEqual(sequenceA, sequenceB);
  assert.equal(sequenceA.every((value) => value >= 0 && value < 1), true);
  assert.ok(new Set(sequenceA).size > 12);
});

test("the worklet renders silence, tonal calls, exact coda clicks, vent noise, and depth-limited song safely", async () => {
  const prior = new Map([
    ["sampleRate", { owned: Object.hasOwn(globalThis, "sampleRate"), value: globalThis.sampleRate }],
    ["AudioWorkletProcessor", { owned: Object.hasOwn(globalThis, "AudioWorkletProcessor"), value: globalThis.AudioWorkletProcessor }],
    ["registerProcessor", { owned: Object.hasOwn(globalThis, "registerProcessor"), value: globalThis.registerProcessor }],
  ]);
  let Processor;
  class MockAudioWorkletProcessor {
    constructor() {
      const messages = [];
      this.messages = messages;
      this.port = {
        onmessage: null,
        postMessage(message) { messages.push(message); },
        start() {},
        close() {},
      };
    }
  }

  globalThis.sampleRate = SAMPLE_RATE;
  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (name, Constructor) => {
    assert.equal(name, "blowhole-physical-model");
    assert.equal(Processor, undefined, "the worklet must register exactly once");
    Processor = Constructor;
  };

  const send = (processor, message) => {
    assert.equal(typeof processor.port.onmessage, "function");
    processor.port.onmessage({ data: message });
  };
  const render = (processor, blockCount) => {
    let peak = 0;
    let squareSum = 0;
    let sampleCount = 0;
    for (let block = 0; block < blockCount; block += 1) {
      const left = new Float32Array(BLOCK_SIZE);
      const right = new Float32Array(BLOCK_SIZE);
      assert.equal(processor.process([], [[left, right]]), true);
      for (let index = 0; index < BLOCK_SIZE; index += 1) {
        const leftSample = left[index];
        const rightSample = right[index];
        assert.ok(Number.isFinite(leftSample), `block ${block} left ${index} must be finite`);
        assert.ok(Number.isFinite(rightSample), `block ${block} right ${index} must be finite`);
        assert.ok(Math.abs(leftSample) <= 0.580001, `left output must stay soft-bounded`);
        assert.ok(Math.abs(rightSample) <= 0.580001, `right output must stay soft-bounded`);
        peak = Math.max(peak, Math.abs(leftSample), Math.abs(rightSample));
        squareSum += leftSample ** 2 + rightSample ** 2;
        sampleCount += 2;
      }
    }
    return { peak, rms: Math.sqrt(squareSum / Math.max(1, sampleCount)) };
  };
  const assertTelemetry = (processor, label) => {
    const messages = processor.messages.filter(({ type }) => type === "telemetry");
    assert.ok(messages.length >= 1, `${label} must report telemetry`);
    for (const [index, message] of messages.entries()) {
      assert.ok(BLOWHOLE_CALL_LOOKUP[message.callId]);
      assert.ok(["odontocete", "mysticete"].includes(message.family));
      assert.equal(typeof message.active, "boolean");
      assert.equal(typeof message.playing, "boolean");
      assert.equal(typeof message.manual, "boolean");
      assert.equal(typeof message.loop, "boolean");
      assert.equal(typeof message.valveOpen, "boolean");
      assertInRange(message.phase, [0, 1], `${label}.telemetry[${index}].phase`);
      assertInRange(message.pressure, [0, 1], `${label}.telemetry[${index}].pressure`);
      assertInRange(message.pulseRateHz, BLOWHOLE_LIMITS.pulseRateHz, `${label}.telemetry[${index}].pulseRateHz`);
      assertInRange(message.peak, [0, 0.580001], `${label}.telemetry[${index}].peak`);
      assertInRange(message.rms, [0, 0.580001], `${label}.telemetry[${index}].rms`);
      assert.ok(message.physicalFrequencyHz > 0 && Number.isFinite(message.physicalFrequencyHz));
      assert.ok(message.monitorFrequencyHz > 0 && Number.isFinite(message.monitorFrequencyHz));
    }
    return messages;
  };

  try {
    await import(`../src/blowhole-processor.js?blowhole-test=${Date.now()}`);
    assert.equal(typeof Processor, "function", "the physical model processor must register");

    const silent = new Processor();
    const silence = render(silent, 24);
    assert.deepEqual(silence, { peak: 0, rms: 0 });
    const silentTelemetry = assertTelemetry(silent, "silence").at(-1);
    assert.equal(silentTelemetry.active, false);
    assert.equal(silentTelemetry.valveOpen, false);

    const delayed = new Processor({
      processorOptions: { configuration: createBlowholeState("sperm-whale-coda") },
    });
    send(delayed, { type: "play", callId: "sperm-whale-coda", delaySeconds: 0.05 });
    assert.deepEqual(render(delayed, 18), { peak: 0, rms: 0 }, "scheduled playback must stay silent before its start frame");
    assert.ok(render(delayed, 8).peak > 0, "scheduled playback must begin after its delay");

    const tonal = new Processor({
      processorOptions: {
        configuration: createBlowholeState("bottlenose-signature-whistle", { level: 0.8 }),
      },
    });
    send(tonal, { type: "manual", active: true });
    const tone = render(tonal, 180);
    assert.ok(tone.rms > 0.002, `tonal source must sound, received rms ${tone.rms}`);
    assert.ok(tone.peak > 0.01);
    const tonalTelemetry = assertTelemetry(tonal, "tonal").at(-1);
    assert.equal(tonalTelemetry.active, true);
    assert.equal(tonalTelemetry.manual, true);
    send(tonal, { type: "panic" });
    assert.deepEqual(render(tonal, 12), { peak: 0, rms: 0 });
    assert.equal(assertTelemetry(tonal, "panicked tonal").at(-1).active, false);

    const lowTensionM1 = new Processor({
      processorOptions: {
        configuration: createBlowholeState("orca-pulsed-call", {
          pulseRateHz: 2_000,
          tension: 0.2,
        }),
      },
    });
    const highTensionM1 = new Processor({
      processorOptions: {
        configuration: createBlowholeState("orca-pulsed-call", {
          pulseRateHz: 2_000,
          tension: 0.8,
        }),
      },
    });
    for (const processor of [lowTensionM1, highTensionM1]) {
      send(processor, { type: "manual", active: true });
      render(processor, 2);
      assertClose(
        processor.lastPlan.pulseRateHz,
        processor.lastPlan.physicalFrequencyHz,
        "manual M1 rate must remain its f0",
      );
    }
    assert.ok(
      lowTensionM1.currentPhysicalFrequencyHz < highTensionM1.currentPhysicalFrequencyHz,
      "M1 tension must bend the manual base f0",
    );

    const hostileClickRate = new Processor({
      processorOptions: {
        configuration: createBlowholeState("dolphin-search-clicks", { pulseRateHz: 10_000 }),
      },
    });
    send(hostileClickRate, { type: "manual", active: true });
    render(hostileClickRate, 2);
    assert.equal(hostileClickRate.lastPlan.pulseRateHz, 35);

    const coda = new Processor({
      processorOptions: { configuration: createBlowholeState("sperm-whale-coda") },
    });
    const triggerFrames = [];
    const originalPulseTrigger = coda._pulseTrigger.bind(coda);
    coda._pulseTrigger = (phase) => {
      const triggered = originalPulseTrigger(phase);
      if (triggered) triggerFrames.push(Math.round(phase * 1.6 * SAMPLE_RATE));
      return triggered;
    };
    send(coda, { type: "play", callId: "sperm-whale-coda" });
    const clicks = render(coda, 612);
    assert.deepEqual(triggerFrames, [0, 9_216, 21_504, 43_776, 66_048]);
    assert.ok(clicks.rms > 1e-7, `coda clicks must sound, received rms ${clicks.rms}`);
    assert.ok(clicks.peak > 1e-5);
    const codaTelemetry = assertTelemetry(coda, "coda");
    assert.equal(codaTelemetry.some(({ playing }) => playing), true);
    assert.equal(codaTelemetry.at(-1).playing, false);
    assert.equal(codaTelemetry.at(-1).phase, 1, "one-shot completion must retain terminal phase");
    assert.ok(clicks.peak > 0.08, `coda clicks need a usable output level (${clicks.peak})`);

    for (const callId of ["dolphin-search-clicks", "dolphin-terminal-buzz"]) {
      const clickTrain = new Processor({
        processorOptions: { configuration: createBlowholeState(callId) },
      });
      send(clickTrain, { type: "play", callId });
      const result = render(clickTrain, 260);
      assert.ok(result.peak > 0.08, `${callId} needs a usable output level (${result.peak})`);
      assertTelemetry(clickTrain, callId);
    }

    const widePulse = new Processor({
      processorOptions: {
        configuration: createBlowholeState("dolphin-search-clicks", {
          closure: 0,
          pulseRateHz: 35,
        }),
      },
    });
    const narrowPulse = new Processor({
      processorOptions: {
        configuration: createBlowholeState("dolphin-search-clicks", {
          closure: 1,
          pulseRateHz: 35,
        }),
      },
    });
    send(widePulse, { type: "manual", active: true });
    send(narrowPulse, { type: "manual", active: true });
    render(widePulse, 40);
    render(narrowPulse, 40);
    assert.ok(widePulse.clickPulseFrameLength > narrowPulse.clickPulseFrameLength);
    assert.equal(narrowPulse.clickPulseFrameLength, 1);

    const noRecycle = new Processor({
      processorOptions: {
        configuration: createBlowholeState("bottlenose-signature-whistle", { recycle: 0 }),
      },
    });
    const fullRecycle = new Processor({
      processorOptions: {
        configuration: createBlowholeState("bottlenose-signature-whistle", { recycle: 1 }),
      },
    });
    for (const processor of [noRecycle, fullRecycle]) {
      send(processor, { type: "manual", active: true });
      render(processor, 40);
      send(processor, { type: "manual", active: false });
      render(processor, 8);
    }
    assert.ok(
      fullRecycle.pneumaticReservoir > noRecycle.pneumaticReservoir * 1.5,
      "nasal recycling must retain pneumatic drive instead of acting only as an audio echo",
    );

    const vent = new Processor();
    send(vent, { type: "vent", strength: 1 });
    const whoosh = render(vent, 120);
    assert.ok(whoosh.rms > 0.001, `surface vent must sound, received rms ${whoosh.rms}`);
    assert.ok(whoosh.peak > 0.005);
    const ventTelemetry = assertTelemetry(vent, "vent");
    assert.equal(ventTelemetry.some(({ valveOpen }) => valveOpen), true);
    assert.equal(ventTelemetry.every(({ active }) => !active), true, "venting is breathing, not underwater calling");

    const dolphinValve = new Processor({
      processorOptions: { configuration: createBlowholeState("dolphin-search-clicks") },
    });
    send(dolphinValve, { type: "manual", active: true });
    render(dolphinValve, 2);
    send(dolphinValve, { type: "vent", strength: 1 });
    assert.equal(dolphinValve.manualGate, false, "opening a dolphin valve must stop underwater phonation");
    assert.ok(dolphinValve.ventEnvelope > 0);
    send(dolphinValve, { type: "manual", active: true });
    assert.equal(dolphinValve.ventEnvelope, 0, "restarting a dolphin source must close the surface valve");

    const spermSurface = new Processor({
      processorOptions: { configuration: createBlowholeState("sperm-whale-coda") },
    });
    send(spermSurface, { type: "play", callId: "sperm-whale-coda" });
    send(spermSurface, { type: "vent", strength: 1 });
    assert.equal(spermSurface.playing, true, "the isolated sperm-whale right passage can click while breathing");
    assert.ok(spermSurface.ventEnvelope > 0);

    const renderHumpback = (depthM) => {
      const processor = new Processor({
        processorOptions: {
          configuration: createBlowholeState("humpback-moan", { depthM, level: 0.8 }),
        },
      });
      send(processor, { type: "play", callId: "humpback-moan" });
      const result = render(processor, 300);
      assertTelemetry(processor, `humpback ${depthM}m`);
      return result;
    };
    const shallowSong = renderHumpback(20);
    const deepSong = renderHumpback(1_500);
    assert.ok(shallowSong.rms > 0.001, `shallow U-fold model must sound (${shallowSong.rms})`);
    assert.ok(
      deepSong.rms < shallowSong.rms * 0.2,
      `depth attenuation must reduce mysticete drive (${deepSong.rms} vs ${shallowSong.rms})`,
    );

    const extreme = new Processor({
      processorOptions: {
        configuration: {
          callId: "blue-whale-b-call",
          pressure: 1e300,
          tension: -1e300,
          closure: 1e300,
          asymmetry: -1e300,
          recycle: 1e300,
          focus: -1e300,
          scale: 1e300,
          roughness: 1e300,
          pulseRateHz: 1e300,
          depthM: -1e300,
          monitorMode: "audible",
          level: 1e300,
        },
      },
    });
    send(extreme, { type: "manual", active: true });
    assert.ok(render(extreme, 48).peak <= 0.580001);
    assertFiniteTree(extreme, "extreme processor");
    assertTelemetry(extreme, "extreme processor");
  } finally {
    for (const [key, { owned, value }] of prior) {
      if (owned) globalThis[key] = value;
      else delete globalThis[key];
    }
  }
});

test("the page, app, and styles expose the complete accessible physical-instrument contract", async () => {
  const [html, app, css, processor, model] = await Promise.all([
    readFile(new URL("blowhole.html", root), "utf8"),
    readFile(new URL("blowhole-app.js", root), "utf8"),
    readFile(new URL("blowhole.css", root), "utf8"),
    readFile(new URL("src/blowhole-processor.js", root), "utf8"),
    readFile(new URL("src/blowhole.js", root), "utf8"),
  ]);

  assert.match(html, /<body class="blowhole-page">/);
  assert.match(html, /TWO SOUND ORGANS \/ ONE BREATHING VALVE/);
  assert.match(html, /The blowhole breathes\. The hidden tissue sings\./);
  assert.match(html, /id="valveState" data-state="sealed"/);
  assert.match(html, /sealed underwater/);
  assert.match(html, /id="blowholeFact">sealed underwater/);
  assert.match(tagWithId(html, "select", "callSelect"), /\bname="call-preset"/i);

  const labeledControls = [
    "level",
    "callSelect",
    "pressure",
    "tension",
    "closure",
    "asymmetry",
    "recycle",
    "focus",
    "scale",
    "roughness",
    "pulseRateHz",
    "depthM",
    "monitorMode",
  ];
  for (const id of labeledControls) {
    assert.ok(tagWithId(html, id === "callSelect" || id === "monitorMode" ? "select" : "input", id));
    assert.match(html, new RegExp(`<label\\b[^>]*\\bfor=["']${id}["']`, "i"), `${id} needs a label`);
  }
  for (const id of [
    "audioButton",
    "playButton",
    "loopButton",
    "holdPad",
    "ventButton",
    "odontoceteTab",
    "mysticeteTab",
    "resetButton",
  ]) {
    const tag = tagWithId(html, "button", id);
    assert.ok(tag, `${id} must be a semantic button`);
    assert.match(tag, /\btype="button"/i);
  }
  for (const id of ["audioButton", "playButton", "loopButton", "holdPad"]) {
    assert.match(tagWithId(html, "button", id), /\baria-pressed=/i);
  }
  for (const id of ["odontoceteTab", "mysticeteTab"]) {
    assert.match(tagWithId(html, "button", id), /\baria-pressed=/i);
    assert.doesNotMatch(tagWithId(html, "button", id), /\brole="tab"/i);
  }
  for (const id of ["stage", "timeline"]) {
    const tag = tagWithId(html, "canvas", id);
    assert.match(tag, /\brole="img"/i);
    assert.match(tag, /\baria-label=/i);
    assert.doesNotMatch(tag, /\btabindex=/i, `${id} must not create a dead keyboard tab stop`);
  }
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  assert.match(html, /id="audioError" role="alert" hidden/);
  assert.match(html, /data-primary-transport/);
  assert.match(html, /data-reset-all data-reset-in-place/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>[\s\S]*<script type="module" src="blowhole-app\.js"><\/script>/);

  assert.match(app, /new AudioWorkletNode\(context, "blowhole-physical-model"/);
  assert.match(app, /const startup = createAudioGraph\(\)/);
  assert.match(app, /await audioStartupPromise/);
  assert.doesNotMatch(app, /if \(startingAudio\) return false/);
  assert.match(app, /numberOfInputs:\s*0/);
  assert.match(app, /outputChannelCount:\s*\[2\]/);
  assert.match(app, /type:\s*"vent", strength:/);
  assert.match(app, /type:\s*"stopVent"/);
  assert.match(app, /surfaceValveOpen \? "blowhole \/ open to breathe"/);
  assert.match(app, /surfaceValveOpen \? "left airway \/ open to breathe"/);
  assert.match(app, /surfaceValveOpen \? "paired blowholes \/ open"/);
  assert.match(app, /underwater calls use the hidden internal source/);
  assert.match(app, /event\.code === "Space"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "b"/);
  assert.match(app, /input, select, textarea, button, a\[href\], summary/);
  assert.match(app, /holdPad\.addEventListener\("keydown"/);
  assert.match(app, /number >= 1 && number <= BLOWHOLE_CALLS\.length/);
  assert.match(app, /pointercancel/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /onprocessorerror/);

  assert.match(css, /#stage:focus-visible,[\s\S]*#timeline:focus-visible/);
  assert.match(css, /\.blowhole-transport button:focus-visible/);
  assert.match(css, /\.blowhole-page input:focus-visible/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  const sampleFreeSources = [html, app, css, processor, model].join("\n");
  assert.doesNotMatch(sampleFreeSources, /\.(?:wav|mp3|ogg|flac|aiff?)\b/i);
  assert.doesNotMatch(sampleFreeSources, /assets\/audio|<audio\b|decodeAudioData|createBufferSource/i);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  assert.match(processor, /class DampedMode/);
  assert.match(processor, /class AcousticDelayLine/);
  assert.match(processor, /pulseWidthMicroseconds \* this\.rate \/ 1_000_000/);
  assert.match(processor, /pneumaticReservoir/);
  assert.match(processor, /headReflectionDelaySeconds/);
  assert.match(processor, /_renderOdontocete/);
  assert.match(processor, /_renderMysticete/);
  assert.match(processor, /registerProcessor\("blowhole-physical-model"/);
});

test("Blowhole is integrated into the voice catalogue, navigation, and shared MIDI classification", () => {
  const voiceGroup = TOOL_GROUPS.find(({ id }) => id === "voice-synths");
  const navigationEntry = voiceGroup?.tools.find(({ id }) => id === "blowhole");
  assert.deepEqual(navigationEntry, {
    id: "blowhole",
    label: "Blowhole",
    href: "blowhole.html",
  });
  assert.equal(resolveActiveTool(new URL("blowhole.html", root).href)?.id, "blowhole");

  const catalogue = instrumentById("blowhole");
  assert.equal(catalogue?.label, "Blowhole");
  assert.equal(catalogue?.href, "blowhole.html");
  assert.equal(catalogue?.kind, "Cetacean physical-model instrument");
  assert.match(catalogue?.description ?? "", /external blowhole remains a valve rather than the underwater sound source/);
  for (const feature of ["Built-in source", "Pointer", "Computer keys", "Physical-model DSP", "MIDI"]) {
    assert.ok(catalogue?.features.includes(feature), `catalogue needs ${feature}`);
  }

  const midi = instrumentMidiCapabilityForId("blowhole");
  assert.deepEqual(midi, {
    id: "blowhole",
    midiInput: true,
    midiInputMode: "universal-control",
    noteMode: "pitched",
    audioInput: false,
    midiOutput: false,
    startsAudio: true,
    computerKeyboardMode: "page",
  });
  assert.ok(PAGE_KEYBOARD_INSTRUMENT_IDS.includes("blowhole"));
});
