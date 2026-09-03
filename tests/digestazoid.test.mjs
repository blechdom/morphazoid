import assert from "node:assert/strict";
import test from "node:test";

import {
  DIGESTAZOID_AMOUNT_LIMIT,
  DIGESTAZOID_COMPARTMENTS,
  DIGESTAZOID_DEFAULTS,
  DIGESTAZOID_EVENT_PROFILES,
  DIGESTAZOID_GESTURES,
  DIGESTAZOID_LIMITS,
  DIGESTAZOID_MAX_DELTA_SECONDS,
  DIGESTAZOID_PRESETS,
  DIGESTAZOID_VALVES,
  applyDigestazoidGesture,
  applyDigestazoidInteraction,
  createDigestazoidRuntime,
  digestiveGeometry,
  digestazoidGesture,
  digestazoidPreset,
  digestazoidState,
  digestazoidTelemetry,
  interactionTargetAtPoint,
  mapDigestazoidInteraction,
  sanitizeDigestazoidRuntime,
  sanitizeDigestazoidState,
  stepDigestazoid,
} from "../src/digestazoid.js";

function assertFiniteTree(value, label = "value") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} must be finite`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${label}.${key}`);
}

function run(configuration, seconds, runtime = createDigestazoidRuntime(configuration)) {
  const frames = Math.round(seconds * 240);
  let next = runtime;
  for (let index = 0; index < frames; index += 1) {
    next = stepDigestazoid(next, configuration, 1 / 240);
  }
  return next;
}

function inventory(runtime) {
  const material = runtime.compartments.reduce((totals, part) => ({
    gas: totals.gas + part.gas,
    liquid: totals.liquid + part.liquid,
    sludge: totals.sludge + part.sludge,
  }), { gas: 0, liquid: 0, sludge: 0 });
  return {
    gas: material.gas + runtime.vented.gas,
    liquid: material.liquid + runtime.vented.liquid,
    sludge: material.sludge + runtime.vented.sludge,
  };
}

test("Digestazoid exposes the canonical performance controls with bounded defaults", () => {
  const canonical = [
    "level", "gas", "liquid", "sludge", "viscosity", "bubbleSizeMm",
    "peristalsisRate", "peristalsisDepth", "stomachCompliance", "gutTension",
    "bodyPulse", "upperValve", "pyloricValve", "lowerValve", "outletStretch",
    "turbulence", "wetness", "bodyResonance",
  ];
  for (const key of canonical) {
    assert.ok(key in DIGESTAZOID_DEFAULTS, key);
    assert.ok(key in DIGESTAZOID_LIMITS, key);
    assert.ok(DIGESTAZOID_DEFAULTS[key] >= DIGESTAZOID_LIMITS[key][0], key);
    assert.ok(DIGESTAZOID_DEFAULTS[key] <= DIGESTAZOID_LIMITS[key][1], key);
  }
  assert.equal(DIGESTAZOID_DEFAULTS.listeningMode, "room");
  assert.equal(DIGESTAZOID_DEFAULTS.performing, false);
  assert.equal(DIGESTAZOID_DEFAULTS.bodyPulseBpm, 61);
  assert.equal(DIGESTAZOID_DEFAULTS.upperOutletHz, 131);
  assert.equal(DIGESTAZOID_DEFAULTS.lowerOutletHz, 328);
  assert.ok(Object.isFrozen(DIGESTAZOID_DEFAULTS));
  assert.ok(Object.isFrozen(DIGESTAZOID_LIMITS));
});

test("the medical and reference event atlas preserves measured durations and peaks", () => {
  assert.equal(DIGESTAZOID_EVENT_PROFILES.SB.durationSeconds, 0.12);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.SB.peakFrequencyHz, 78);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.MB.durationSeconds, 1.45);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.MB.peakFrequencyHz, 50);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.CRS.durationSeconds, 0.66);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.CRS.peakFrequencyHz, 252);
  assert.deepEqual(DIGESTAZOID_EVENT_PROFILES.HS.durationRangeSeconds, [0.19, 0.32]);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.HS.peakFrequencyHz, 322);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.WHOOPEE.activeDurationSeconds, 0.85);
  assert.deepEqual(DIGESTAZOID_EVENT_PROFILES.WHOOPEE.fundamentalRangeHz, [328, 453]);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.BURP.activeDurationSeconds, 0.18);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.BURP.peakFrequencyHz, 131);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.BURP.mouthRadiation, "broadband");
  assert.equal(DIGESTAZOID_EVENT_PROFILES.QUICK_FART.peakFrequencyHz, 297);
  assert.equal(DIGESTAZOID_EVENT_PROFILES.HEART.rateBpm, 61);
  for (const profile of Object.values(DIGESTAZOID_EVENT_PROFILES)) {
    assert.ok(Object.isFrozen(profile), profile.id);
    assert.ok(profile.durationSeconds > 0, profile.id);
    assert.ok(profile.peakFrequencyHz > 0, profile.id);
  }
});

test("preset and gesture atlases are unique, immutable, and complete", () => {
  assert.ok(DIGESTAZOID_PRESETS.length >= 6);
  assert.equal(new Set(DIGESTAZOID_PRESETS.map(({ id }) => id)).size, DIGESTAZOID_PRESETS.length);
  for (const preset of DIGESTAZOID_PRESETS) {
    assert.strictEqual(digestazoidPreset(preset.id), preset);
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.settings));
    assertFiniteTree(digestazoidState(preset.id));
  }
  assert.strictEqual(digestazoidPreset("not-a-gut"), DIGESTAZOID_PRESETS[0]);

  assert.deepEqual(
    DIGESTAZOID_GESTURES.map(({ id }) => id),
    ["growl", "burble", "bubble", "slosh", "burp", "burple", "fart", "long-fart"],
  );
  for (const gesture of DIGESTAZOID_GESTURES) {
    const command = digestazoidGesture(gesture.id, Infinity, "bogus");
    assert.equal(command.id, gesture.id);
    assert.equal(command.force, 1);
    assert.equal(command.target, gesture.target);
    assert.ok(DIGESTAZOID_EVENT_PROFILES[command.eventProfileId]);
  }
  assert.equal(digestazoidGesture("swallow").id, "swallow");
  assert.equal(digestazoidGesture("swallow").eventProfileId, "SB");
});

test("state sanitization rejects hostile values and derives solver aliases", () => {
  const state = sanitizeDigestazoidState({
    gas: 99,
    liquid: -99,
    sludge: "0.7",
    viscosity: NaN,
    bubbleSizeMm: Infinity,
    peristalsisRate: 999,
    gutTension: -4,
    bodyPulse: 4,
    upperValve: -1,
    pyloricValve: 2,
    lowerValve: "0.25",
    outletStretch: 0.8,
    turbulence: -Infinity,
    listeningMode: "x-ray",
    wetness: 2,
    bodyResonance: -1,
    performing: "true",
    noiseSeed: 0,
    presetId: "missing",
  });
  assert.equal(state.gas, DIGESTAZOID_LIMITS.gas[1]);
  assert.equal(state.liquid, DIGESTAZOID_LIMITS.liquid[0]);
  assert.equal(state.sludge, 0.7);
  assert.equal(state.peristalsisRate, DIGESTAZOID_LIMITS.peristalsisRate[1]);
  assert.equal(state.gutTension, 0);
  assert.equal(state.bodyPulse, 1);
  assert.equal(state.upperValve, 0);
  assert.equal(state.pyloricValve, 1);
  assert.equal(state.lowerValve, 0.25);
  assert.equal(state.wetness, 1);
  assert.equal(state.bodyResonance, 0);
  assert.equal(state.listeningMode, "room");
  assert.equal(state.performing, false);
  assert.equal(state.noiseSeed, DIGESTAZOID_LIMITS.noiseSeed[0]);
  assert.equal(state.presetId, DIGESTAZOID_PRESETS[0].id);
  assert.equal(state.motilityRateBpm, state.peristalsisRate);
  assert.equal(state.gasLoad, state.gas);
  assert.equal(state.hydration, state.wetness);
  assert.ok(state.analTension > state.pyloricTension);
  assert.ok(state.lowerOutletHz > 400);
  assertFiniteTree(state);

  const inside = sanitizeDigestazoidState({ listeningMode: "inside", performing: true });
  assert.equal(inside.listeningMode, "inside");
  assert.equal(inside.performing, true);
});

test("the runtime is one persistent seven-chamber tract with four named hysteretic valves", () => {
  assert.deepEqual(
    DIGESTAZOID_COMPARTMENTS.map(({ id }) => id),
    ["stomach", "duodenum", "jejunum", "ileum", "cecum", "colon", "rectum"],
  );
  assert.deepEqual(
    DIGESTAZOID_VALVES.map(({ id }) => id),
    ["esophageal", "pyloric", "ileocecal", "anal"],
  );
  const runtime = createDigestazoidRuntime();
  assert.equal(runtime.compartments.length, 7);
  assert.deepEqual(Object.keys(runtime.valves), ["esophageal", "pyloric", "ileocecal", "anal"]);
  for (const part of runtime.compartments) {
    assert.ok(part.gas >= 0 && part.gas <= DIGESTAZOID_AMOUNT_LIMIT);
    assert.ok(part.liquid >= 0 && part.liquid <= DIGESTAZOID_AMOUNT_LIMIT);
    assert.ok(part.sludge >= 0 && part.sludge <= DIGESTAZOID_AMOUNT_LIMIT);
  }
  assertFiniteTree(runtime);
});

test("control-rate evolution is deterministic, finite, and seed-sensitive", () => {
  const configuration = digestazoidState("fizzy-belly", { performing: true });
  const first = run(configuration, 6, createDigestazoidRuntime(configuration, 123456));
  const second = run(configuration, 6, createDigestazoidRuntime(configuration, 123456));
  assert.deepEqual(first, second);
  assertFiniteTree(first);
  assert.equal(first.timeSeconds, second.timeSeconds);
  assert.ok(first.eventSerial > 0);

  const otherSeed = run(configuration, 6, createDigestazoidRuntime(configuration, 654321));
  assert.notEqual(first.seed, otherSeed.seed);
  assert.notDeepEqual(first.event, otherSeed.event);
});

test("material is conserved across chambers and outlets when production is zero", () => {
  const configuration = sanitizeDigestazoidState({
    ...DIGESTAZOID_DEFAULTS,
    gas: 1.35,
    turbulence: 0,
    gasProduction: 0,
    upperValve: 1,
    lowerValve: 1,
    pyloricValve: 1,
    peristalsisDepth: 0.92,
  });
  // Canonical turbulence derives zero production and prevents hidden inflow.
  assert.equal(configuration.gasProduction, 0);
  const initial = createDigestazoidRuntime(configuration);
  const before = inventory(initial);
  const after = run(configuration, 12, initial);
  const final = inventory(after);
  assert.ok(after.vented.gas > 0, "open outlets should vent some compressed gas");
  for (const material of ["gas", "liquid", "sludge"]) {
    assert.ok(Math.abs(final[material] - before[material]) < 1e-8, `${material} inventory drifted`);
  }
});

test("a peristaltic constriction travels through multiple chambers", () => {
  const configuration = digestazoidState("empty-growler", {
    peristalsisRate: 24,
    peristalsisDepth: 0.94,
  });
  let runtime = createDigestazoidRuntime(configuration);
  const leaders = new Set();
  let maximumConstriction = 0;
  for (let frame = 0; frame < 900; frame += 1) {
    runtime = stepDigestazoid(runtime, configuration, 1 / 240);
    leaders.add(runtime.peristalsis.leadingCompartmentId);
    maximumConstriction = Math.max(maximumConstriction, runtime.peristalsis.strength);
  }
  assert.ok(leaders.size >= 5, [...leaders].join(","));
  assert.ok(maximumConstriction > 0.75);
});

test("wall compliance, squeeze force, and body pulse alter chamber pressure without instability", () => {
  const stiff = digestazoidState({ stomachCompliance: 0.18, bodyPulse: 0 });
  const loose = digestazoidState({ stomachCompliance: 2.1, bodyPulse: 0 });
  let stiffRuntime = createDigestazoidRuntime(stiff);
  let looseRuntime = createDigestazoidRuntime(loose);
  const squeeze = { type: "squeeze", target: "stomach", x: 0.38, y: 0.27, force: 1 };
  stiffRuntime = applyDigestazoidInteraction(stiffRuntime, squeeze, stiff);
  looseRuntime = applyDigestazoidInteraction(looseRuntime, squeeze, loose);
  stiffRuntime = stepDigestazoid(stiffRuntime, stiff, 1 / 60);
  looseRuntime = stepDigestazoid(looseRuntime, loose, 1 / 60);
  assert.ok(stiffRuntime.compartments[0].pressure > looseRuntime.compartments[0].pressure);
  assert.ok(stiffRuntime.compartments[0].wallVelocity > 0);

  const pulsed = digestazoidState({ bodyPulse: 1, bodyPulseBpm: 61 });
  const unpulsed = digestazoidState({ bodyPulse: 0, bodyPulseBpm: 61 });
  const pulseRuntime = run(pulsed, 0.25 * 60 / 61);
  const noPulseRuntime = run(unpulsed, 0.25 * 60 / 61);
  assert.ok(pulseRuntime.bodyPulse.pressure > noPulseRuntime.bodyPulse.pressure);
  assert.ok(pulseRuntime.compartments[3].pressure > noPulseRuntime.compartments[3].pressure);
});

test("pressure valves crack open, retain aperture below onset, then close", () => {
  const configuration = digestazoidState({ gas: 1.6, lowerValve: 1, turbulence: 0 });
  let runtime = createDigestazoidRuntime(configuration);
  runtime.compartments.at(-1).gas = 2.5;
  runtime = applyDigestazoidGesture(runtime, "fart", 1.2, "anal", configuration);
  runtime = run(configuration, 0.12, runtime);
  assert.equal(runtime.valves.anal.open, true);
  assert.ok(runtime.valves.anal.aperture > 0.5);
  const openAperture = runtime.valves.anal.aperture;

  runtime.compartments.at(-1).gas = 0;
  runtime.compartments.at(-1).liquid = 0;
  runtime.compartments.at(-1).sludge = 0;
  runtime = stepDigestazoid(runtime, configuration, 1 / 240);
  // The boolean can close promptly, while the compliant aperture retains its
  // previous opening and decays rather than discontinuously snapping to zero.
  assert.ok(runtime.valves.anal.aperture > 0);
  assert.ok(runtime.valves.anal.aperture < openAperture);
  runtime = run(configuration, 0.6, runtime);
  assert.equal(runtime.valves.anal.open, false);
  assert.ok(runtime.valves.anal.aperture < 0.001);
});

test("pinch/release changes valve mechanics while inflation and deflation change gas", () => {
  const configuration = digestazoidState();
  let runtime = createDigestazoidRuntime(configuration);
  const initialGas = runtime.compartments[0].gas;
  runtime = applyDigestazoidInteraction(runtime, {
    type: "inflate", target: "stomach", x: 0.4, y: 0.3, force: 1,
  }, configuration);
  assert.ok(runtime.compartments[0].gas > initialGas);
  runtime = applyDigestazoidInteraction(runtime, {
    type: "deflate", target: "stomach", x: 0.4, y: 0.3, force: 1,
  }, configuration);
  assert.ok(runtime.compartments[0].gas <= initialGas);
  assert.ok(runtime.vented.gas > 0);

  runtime = applyDigestazoidInteraction(runtime, {
    type: "pinch", target: "pyloric", force: 0.8, x: 0.5, y: 0.35,
  }, configuration);
  assert.equal(runtime.valves.pyloric.manualPinch, 0.8);
  runtime = applyDigestazoidInteraction(runtime, {
    type: "release", target: "pyloric", force: 0, x: 0.5, y: 0.35,
  }, configuration);
  assert.equal(runtime.valves.pyloric.manualPinch, 0);
});

test("each named gesture excites the intended material, valve, or wall event", () => {
  const configuration = digestazoidState();
  for (const gesture of DIGESTAZOID_GESTURES) {
    const initial = createDigestazoidRuntime(configuration);
    const runtime = applyDigestazoidGesture(initial, gesture.id, 0.9, null, configuration);
    assert.equal(runtime.event.id, gesture.id);
    assert.equal(runtime.event.profileId, gesture.eventProfileId);
    assert.equal(runtime.event.serial, 1);
    assert.ok(runtime.event.durationSeconds > 0);
    assertFiniteTree(runtime);
  }
  const fart = applyDigestazoidGesture(createDigestazoidRuntime(configuration), "fart", 1.2, null, configuration);
  assert.equal(fart.event.profileId, "WHOOPEE");
  assert.ok(fart.valves.anal.kick > 1);
  assert.ok(fart.outlets.lowerDrive > 1);
  const burp = applyDigestazoidGesture(createDigestazoidRuntime(configuration), "burp", 1, null, configuration);
  assert.equal(burp.event.profileId, "BURP");
  assert.ok(burp.valves.esophageal.kick > 0);
  assert.ok(burp.outlets.upperDrive > 0);
});

test("geometry scales for canvas drawing and hit testing finds chambers and valves", () => {
  const runtime = createDigestazoidRuntime();
  runtime.compartments[0].wallDisplacement = 1;
  const normalized = digestiveGeometry(runtime);
  const pixels = digestiveGeometry(runtime, 800, 600);
  assert.equal(normalized.width, 1);
  assert.equal(pixels.width, 800);
  assert.equal(pixels.height, 600);
  assert.equal(pixels.compartments.length, DIGESTAZOID_COMPARTMENTS.length);
  assert.equal(pixels.valves.length, DIGESTAZOID_VALVES.length);
  assert.equal(pixels.tracts.length, 4);
  assert.equal(pixels.compartments[0].path.length, 24);
  assert.ok(pixels.compartments[0].rx > DIGESTAZOID_COMPARTMENTS[0].rx * 800);
  assert.equal(interactionTargetAtPoint(0.38, 0.27, normalized), "stomach");
  assert.equal(interactionTargetAtPoint(0.5, 0.35, normalized), "pyloric");
  assert.equal(interactionTargetAtPoint(400, 579, pixels), "anal");
  assert.equal(interactionTargetAtPoint(5, 5, pixels), "upper");
  assertFiniteTree(pixels);
});

test("interaction mapping is normalized, target-aware, and force-bounded", () => {
  const mapped = mapDigestazoidInteraction({
    type: "drag", x: Infinity, y: -10, force: 99, dx: -4, dy: 9,
  });
  assert.equal(mapped.type, "drag");
  assert.equal(mapped.x, 0.5);
  assert.equal(mapped.y, 0);
  assert.equal(mapped.force, 1.5);
  assert.equal(mapped.dx, -1);
  assert.equal(mapped.dy, 1);
  assert.ok(mapped.effects.sloshX < 0);
  assert.ok(mapped.effects.sloshY > 0);
  assert.ok(Object.isFrozen(mapped));
  assert.ok(Object.isFrozen(mapped.effects));

  const inferred = mapDigestazoidInteraction({ type: "poke", x: 0.69, y: 0.66, force: 0.4 });
  assert.equal(inferred.target, "cecum");
  assert.ok(inferred.effects.wallImpulse > 0);
});

test("page target and action aliases map onto the physical network without phantom pokes", () => {
  const targets = {
    gasPocket: "stomach",
    smallIntestine: "jejunum",
    upperValve: "esophageal",
    pyloricValve: "pyloric",
    ileocecalValve: "ileocecal",
    lowerValve: "anal",
    outlet: "lower",
  };
  for (const [pageTarget, physicalTarget] of Object.entries(targets)) {
    const mapped = mapDigestazoidInteraction({
      action: "pinch", target: pageTarget, x: 0.5, y: 0.5, force: 0.7,
    });
    assert.equal(mapped.target, physicalTarget, pageTarget);
  }

  const start = mapDigestazoidInteraction({ action: "start", target: "stomach", force: 1 });
  assert.equal(start.type, "start");
  assert.deepEqual(start.effects, {
    compression: 0, wallImpulse: 0, gasDelta: 0, liquidDelta: 0,
    sloshX: 0, sloshY: 0, valvePinch: 0, release: false, outletDrive: 0,
  });
  const knead = mapDigestazoidInteraction({
    action: "knead", target: "smallIntestine", force: 0.8, dx: 0.4, dy: -0.2,
  });
  assert.equal(knead.type, "drag");
  assert.ok(knead.effects.sloshX > 0);
  const stretch = mapDigestazoidInteraction({ action: "stretch", target: "outlet", force: 0.9 });
  assert.equal(stretch.type, "drag");
  assert.equal(stretch.target, "lower");
  assert.equal(stretch.effects.outletDrive, 0.9);
  const releaseAll = mapDigestazoidInteraction({ action: "release-all", force: 0 });
  assert.equal(releaseAll.type, "release");
  assert.equal(releaseAll.target, "body");

  const configuration = digestazoidState();
  let runtime = createDigestazoidRuntime(configuration);
  runtime.valves.esophageal.manualPinch = 1;
  runtime.valves.anal.manualPinch = 1;
  runtime.compartments[0].compression = 1;
  runtime = applyDigestazoidInteraction(runtime, releaseAll, configuration);
  assert.equal(runtime.valves.esophageal.manualPinch, 0);
  assert.equal(runtime.valves.anal.manualPinch, 0);
  assert.equal(runtime.compartments[0].compression, 0);
});

test("large time steps and malformed runtimes remain bounded and finite", () => {
  const configuration = sanitizeDigestazoidState({
    gas: Infinity, liquid: -Infinity, sludge: NaN, peristalsisRate: 1e100,
    peristalsisDepth: -1e100, viscosity: 1e100,
  });
  const malformed = {
    timeSeconds: Infinity,
    seed: NaN,
    compartments: [{ id: "stomach", gas: Infinity, liquid: -2, sludge: "x", pressure: NaN }],
    valves: { anal: { aperture: Infinity, flow: -Infinity, manualPinch: 9 } },
    slosh: { x: Infinity, y: -Infinity, energy: Infinity },
    event: { profileId: "made-up", durationSeconds: Infinity },
  };
  const safe = sanitizeDigestazoidRuntime(malformed, configuration);
  assertFiniteTree(safe);
  assert.equal(safe.compartments.length, 7);
  assert.equal(safe.event, null);
  const advanced = stepDigestazoid(safe, configuration, 999);
  assertFiniteTree(advanced);
  assert.ok(advanced.timeSeconds <= DIGESTAZOID_MAX_DELTA_SECONDS + 1e-12);
  for (const part of advanced.compartments) {
    assert.ok(part.gas <= DIGESTAZOID_AMOUNT_LIMIT);
    assert.ok(part.pressure <= 6);
  }
});

test("telemetry reports every pressure, fill, valve, phase, event, and outlet", () => {
  const configuration = digestazoidState("sludge-bog");
  let runtime = createDigestazoidRuntime(configuration);
  runtime = applyDigestazoidGesture(runtime, "burple", 0.8, null, configuration);
  runtime = stepDigestazoid(runtime, configuration, 1 / 120);
  const telemetry = digestazoidTelemetry(runtime, configuration);
  assert.deepEqual(Object.keys(telemetry.pressures), DIGESTAZOID_COMPARTMENTS.map(({ id }) => id));
  assert.deepEqual(Object.keys(telemetry.fills), DIGESTAZOID_COMPARTMENTS.map(({ id }) => id));
  assert.deepEqual(Object.keys(telemetry.valves), DIGESTAZOID_VALVES.map(({ id }) => id));
  assert.deepEqual(Object.keys(telemetry.peristalsis.constrictions), DIGESTAZOID_COMPARTMENTS.map(({ id }) => id));
  assert.equal(telemetry.event.id, "burple");
  assert.equal(telemetry.event.profileId, "CRS");
  assert.ok(telemetry.gas.total > 0);
  assert.ok(telemetry.liquid.total > 0);
  assert.ok(telemetry.sludge.total > 0);
  assertFiniteTree(telemetry);
});
