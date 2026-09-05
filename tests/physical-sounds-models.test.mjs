import assert from "node:assert/strict";
import test from "node:test";

import {
  PHYSICAL_SOUND_DEFAULTS,
  PHYSICAL_SOUND_DEFINITIONS,
  PHYSICAL_SOUND_KINDS,
  PHYSICAL_SOUND_LIMITS,
  PHYSICAL_SOUND_METADATA,
  PHYSICAL_SOUND_OPTIONS,
  PHYSICAL_SOUND_PRESETS,
  buildPhysicalModalBank,
  physicalSoundDefinition,
  physicalSoundPreset,
  sanitizePhysicalSoundState,
  serializePhysicalModalJson,
  tuneAirflowStateToFrequency,
} from "../src/physical-sounds.js";

const EXPECTED_KINDS = [
  "particle-cabinet",
  "impact-ecology",
  "object-forge",
  "bowed-things",
  "airflow-objects",
];

function assertDeepFrozen(value, path = "root") {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} should be frozen`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${path}.${key}`);
  }
}

function assertModalBank(bank, sampleRate, maximumModeCount = 128) {
  const vectors = [
    bank.frequenciesHz,
    bank.t60Seconds,
    bank.gains,
    bank.pans,
    bank.strikeWeights,
  ];
  assert.ok(bank.modeCount >= 1);
  assert.ok(bank.modeCount <= maximumModeCount);
  for (const vector of vectors) {
    assert.ok(vector instanceof Float32Array);
    assert.equal(vector.length, bank.modeCount);
    assert.ok(vector.every(Number.isFinite));
  }
  for (let index = 0; index < bank.modeCount; index += 1) {
    assert.ok(bank.frequenciesHz[index] > 0);
    assert.ok(bank.frequenciesHz[index] < sampleRate / 2);
    assert.ok(bank.t60Seconds[index] >= 0.012 && bank.t60Seconds[index] <= 30);
    assert.ok(bank.pans[index] >= -1 && bank.pans[index] <= 1);
    assert.ok(bank.strikeWeights[index] >= -1 && bank.strikeWeights[index] <= 1);
    if (index > 0) assert.ok(bank.frequenciesHz[index] >= bank.frequenciesHz[index - 1]);
  }
}

function gainNorm(bank) {
  return Math.sqrt(bank.gains.reduce((sum, gain) => sum + gain * gain, 0));
}

test("the five model families expose immutable metadata, presets, defaults, and limits", () => {
  assert.deepEqual(PHYSICAL_SOUND_KINDS, EXPECTED_KINDS);
  assertDeepFrozen(PHYSICAL_SOUND_KINDS, "kinds");
  assertDeepFrozen(PHYSICAL_SOUND_METADATA, "metadata");
  assertDeepFrozen(PHYSICAL_SOUND_PRESETS, "presets");
  assertDeepFrozen(PHYSICAL_SOUND_DEFAULTS, "defaults");
  assertDeepFrozen(PHYSICAL_SOUND_LIMITS, "limits");
  assertDeepFrozen(PHYSICAL_SOUND_OPTIONS, "options");
  assertDeepFrozen(PHYSICAL_SOUND_DEFINITIONS, "definitions");

  for (const kind of EXPECTED_KINDS) {
    const definition = PHYSICAL_SOUND_DEFINITIONS[kind];
    assert.equal(definition.id, kind);
    assert.equal(definition.defaults.presetId, definition.defaultPresetId);
    assert.ok(definition.controls.length >= 9);
    assert.ok(definition.presets.length >= 5);
    assert.equal(definition.presets, PHYSICAL_SOUND_PRESETS[kind]);
    assert.equal(definition.defaults, PHYSICAL_SOUND_DEFAULTS[kind]);
    assert.equal(definition.limits, PHYSICAL_SOUND_LIMITS[kind]);
    assert.equal(definition.presets[0].kind, kind);
  }
});

test("presets cover the requested physical materials, bodies, and airflow regimes", () => {
  assert.deepEqual(
    PHYSICAL_SOUND_PRESETS["particle-cabinet"].map(({ id }) => id),
    ["gourd-maraca", "steel-cabasa", "coin-tin", "pebbles-in-glass", "bamboo-rainstick", "sleigh-bells"],
  );
  assert.deepEqual(
    PHYSICAL_SOUND_PRESETS["impact-ecology"].map(({ settings }) => settings.eventType),
    ["bounce", "bounce", "shatter", "shatter", "crumple", "crumple"],
  );
  assert.deepEqual(
    PHYSICAL_SOUND_PRESETS["object-forge"].map(({ id }) => id),
    ["wood-bar", "glass-bowl", "steel-plate", "ceramic-tile", "bronze-bell"],
  );
  assert.deepEqual(
    PHYSICAL_SOUND_PRESETS["bowed-things"].map(({ id }) => id),
    ["uniform-bar", "tuned-bar", "glass-harmonica", "singing-bowl", "bowed-cymbal"],
  );
  assert.deepEqual(
    new Set(PHYSICAL_SOUND_PRESETS["airflow-objects"].map(({ settings }) => settings.airflowMode)),
    new Set(["cavity", "aeolian", "bottle"]),
  );
  for (const presets of Object.values(PHYSICAL_SOUND_PRESETS)) {
    for (const preset of presets) {
      assert.ok(preset.description.length > 30);
      assert.ok(preset.tags.length >= 3);
      assert.ok(preset.model.modes.length >= 4);
      assert.ok(Object.keys(preset.physical).length >= 2);
    }
  }
});

test("Particle Cabinet presets carry distinct bounded contact-exciter profiles", () => {
  const presets = PHYSICAL_SOUND_PRESETS["particle-cabinet"];
  const signatures = new Set();
  for (const preset of presets) {
    const bank = buildPhysicalModalBank("particle-cabinet", {
      ...preset.settings,
      presetId: preset.id,
    });
    assert.equal(Object.isFrozen(bank.particleExciter), true);
    assert.ok(bank.particleExciter.referenceObjectCount >= 1);
    assert.ok(bank.particleExciter.referenceObjectCount <= 1_024);
    assert.ok(bank.particleExciter.rateScale >= 0.2 && bank.particleExciter.rateScale <= 3);
    assert.ok(bank.particleExciter.impactScale >= 0.2 && bank.particleExciter.impactScale <= 3);
    assert.ok(bank.particleExciter.contactBrightness >= 0 && bank.particleExciter.contactBrightness <= 1);
    assert.ok(bank.particleExciter.contactT60Seconds >= 0.0015);
    assert.ok(bank.particleExciter.contactT60Seconds <= 0.04);
    assert.ok(bank.particleExciter.systemT60Seconds >= 0.04);
    assert.ok(bank.particleExciter.systemT60Seconds <= 2.5);
    assert.ok(bank.particleExciter.scrapeMix >= 0 && bank.particleExciter.scrapeMix <= 1);
    assert.ok(bank.particleExciter.modalMix >= 0.1 && bank.particleExciter.modalMix <= 3);
    assert.ok(bank.particleExciter.contactMix >= 0.1 && bank.particleExciter.contactMix <= 4);
    signatures.add(JSON.stringify(bank.particleExciter));
  }
  assert.equal(signatures.size, presets.length);
});

test("definition and preset lookup accept family aliases and use documented fallbacks", () => {
  assert.equal(physicalSoundDefinition("modal").id, "object-forge");
  assert.equal(physicalSoundDefinition("AIR").id, "airflow-objects");
  assert.equal(physicalSoundDefinition("missing").id, "particle-cabinet");
  assert.equal(physicalSoundPreset("bow", "singing-bowl").id, "singing-bowl");
  assert.equal(physicalSoundPreset("object-forge", "missing").id, "wood-bar");
  assert.equal(physicalSoundPreset("missing", "missing").id, "gourd-maraca");
});

test("sanitization returns finite bounded frozen states with exactly public keys", () => {
  const hostileNumber = { valueOf() { throw new Error("must not coerce objects"); } };
  const particle = sanitizePhysicalSoundState("particle-cabinet", {
    presetId: "steel-cabasa",
    size: "2.5",
    damping: Infinity,
    brightness: -10,
    energy: 40,
    stereoWidth: NaN,
    objectCount: 12.6,
    particleSize: Symbol("hostile"),
    roughness: hostileNumber,
    gravity: 99,
    ignored: 7,
  });
  assert.equal(Object.isFrozen(particle), true);
  assert.deepEqual(Object.keys(particle), [
    "presetId", "size", "damping", "brightness", "energy", "stereoWidth",
    "objectCount", "particleSize", "roughness", "gravity",
  ]);
  assert.equal(particle.presetId, "steel-cabasa");
  assert.equal(particle.size, 2.5);
  assert.equal(particle.damping, physicalSoundPreset("particle-cabinet", "steel-cabasa").settings.damping);
  assert.equal(particle.brightness, 0);
  assert.equal(particle.energy, 1);
  assert.equal(particle.objectCount, 13);
  assert.equal(particle.particleSize, physicalSoundPreset("particle-cabinet", "steel-cabasa").settings.particleSize);
  assert.equal(particle.roughness, physicalSoundPreset("particle-cabinet", "steel-cabasa").settings.roughness);
  assert.equal(particle.gravity, 2);

  const impact = sanitizePhysicalSoundState("impact-ecology", {
    presetId: "window-shatter",
    eventType: "not-an-event",
    restitution: -3,
    eventDensity: 9_999,
    hardness: 9,
    chaos: -2,
    strikePosition: 2,
  });
  assert.equal(impact.eventType, "shatter");
  assert.equal(impact.restitution, 0.02);
  assert.equal(impact.eventDensity, 200);
  assert.equal(impact.hardness, 1);
  assert.equal(impact.chaos, 0);
  assert.equal(impact.strikePosition, 1);
  assert.equal(
    sanitizePhysicalSoundState("impact-ecology", { eventType: "ROLL" }).eventType,
    "roll",
  );
  assert.equal(
    sanitizePhysicalSoundState("impact-ecology", { eventType: "scrape" }).eventType,
    "scrape",
  );

  const object = sanitizePhysicalSoundState("object-forge", {
    baseFrequencyHz: 2,
    stiffness: 8,
    strikePosition: -1,
    pickupPosition: 4,
    modeCount: 9.7,
    modalJson: 123,
  });
  assert.equal(object.baseFrequencyHz, 20);
  assert.equal(object.stiffness, 1);
  assert.equal(object.strikePosition, 0);
  assert.equal(object.pickupPosition, 1);
  assert.equal(object.modeCount, 10);
  assert.equal(object.modalJson, "");

  const bowed = sanitizePhysicalSoundState("bowed-things", {
    bowPressure: -1,
    bowVelocity: 8,
    bowPosition: NaN,
    rosin: Infinity,
  });
  assert.equal(bowed.bowPressure, 0);
  assert.equal(bowed.bowVelocity, 1);
  assert.equal(bowed.bowPosition, PHYSICAL_SOUND_DEFAULTS["bowed-things"].bowPosition);
  assert.equal(bowed.rosin, PHYSICAL_SOUND_DEFAULTS["bowed-things"].rosin);

  const airflow = sanitizePhysicalSoundState("airflow-objects", {
    airflowMode: "AEOLIAN",
    airSpeed: 100,
    diameter: 0,
    cavityDepth: 4,
    aperture: -2,
    turbulence: 7,
    listenerAngle: 1_000,
  });
  assert.equal(airflow.airflowMode, "aeolian");
  assert.equal(airflow.airSpeed, 80);
  assert.equal(airflow.diameter, 0.002);
  assert.equal(airflow.cavityDepth, 2);
  assert.equal(airflow.aperture, 0.01);
  assert.equal(airflow.turbulence, 1);
  assert.equal(airflow.listenerAngle, 180);
});

test("fallback state supports patches while a newly selected preset resets omitted controls", () => {
  const current = sanitizePhysicalSoundState("particle-cabinet", {
    presetId: "gourd-maraca",
    brightness: 0.07,
    objectCount: 7,
  });
  const patch = sanitizePhysicalSoundState("particle-cabinet", { energy: 0.2 }, current);
  assert.equal(patch.presetId, "gourd-maraca");
  assert.equal(patch.brightness, 0.07);
  assert.equal(patch.objectCount, 7);
  assert.equal(patch.energy, 0.2);

  const changed = sanitizePhysicalSoundState(
    "particle-cabinet",
    { presetId: "sleigh-bells" },
    current,
  );
  assert.equal(changed.presetId, "sleigh-bells");
  assert.equal(changed.brightness, physicalSoundPreset("particle-cabinet", "sleigh-bells").settings.brightness);
  assert.equal(changed.objectCount, physicalSoundPreset("particle-cabinet", "sleigh-bells").settings.objectCount);

  const unknown = sanitizePhysicalSoundState(
    "particle-cabinet",
    { presetId: "not-real", energy: 0.4 },
    current,
  );
  assert.equal(unknown.presetId, current.presetId);
  assert.equal(unknown.objectCount, current.objectCount);
  assert.equal(unknown.energy, 0.4);
});

test("throwing accessors and non-object state cannot escape the sanitizer", () => {
  const hostile = new Proxy({}, {
    get() {
      throw new Error("hostile getter");
    },
  });
  for (const kind of EXPECTED_KINDS) {
    assert.deepEqual(sanitizePhysicalSoundState(kind, null), PHYSICAL_SOUND_DEFAULTS[kind]);
    assert.deepEqual(sanitizePhysicalSoundState(kind, []), PHYSICAL_SOUND_DEFAULTS[kind]);
    assert.deepEqual(sanitizePhysicalSoundState(kind, hostile), PHYSICAL_SOUND_DEFAULTS[kind]);
  }
});

test("every authored preset builds deterministic, finite, Nyquist-safe modal vectors", () => {
  for (const kind of EXPECTED_KINDS) {
    for (const preset of PHYSICAL_SOUND_PRESETS[kind]) {
      for (const sampleRate of [8_000, 44_100, 96_000]) {
        const first = buildPhysicalModalBank(kind, preset.settings, { sampleRate, maxModes: 17 });
        const second = buildPhysicalModalBank(kind, preset.settings, { sampleRate, maxModes: 17 });
        assertModalBank(first, sampleRate, 17);
        assert.deepEqual(first.frequenciesHz, second.frequenciesHz);
        assert.deepEqual(first.t60Seconds, second.t60Seconds);
        assert.deepEqual(first.gains, second.gains);
        assert.deepEqual(first.pans, second.pans);
        assert.deepEqual(first.strikeWeights, second.strikeWeights);
        assert.ok(gainNorm(first) <= first.modeCount ** 0.5 + 1e-6);
      }
    }
  }
});

test("modal controls retain their intended physical direction", () => {
  const kind = "object-forge";
  const base = sanitizePhysicalSoundState(kind, {
    presetId: "steel-plate",
    modeCount: 12,
    energy: 0.7,
    strikePosition: 0.37,
    pickupPosition: 0.63,
  });
  const small = buildPhysicalModalBank(kind, { ...base, size: 0.5 });
  const large = buildPhysicalModalBank(kind, { ...base, size: 2 });
  assert.ok(small.frequenciesHz[0] > large.frequenciesHz[0] * 3.9);
  assert.ok(large.t60Seconds[0] > small.t60Seconds[0] * 1.9);

  const dry = buildPhysicalModalBank(kind, { ...base, damping: 1 });
  const ringing = buildPhysicalModalBank(kind, { ...base, damping: 0 });
  assert.ok(ringing.t60Seconds[0] > dry.t60Seconds[0] * 7.9);

  const soft = buildPhysicalModalBank(kind, { ...base, brightness: 0 });
  const bright = buildPhysicalModalBank(kind, { ...base, brightness: 1 });
  const last = Math.min(soft.modeCount, bright.modeCount) - 1;
  const softRatio = Math.abs(soft.gains[last] / soft.gains[0]);
  const brightRatio = Math.abs(bright.gains[last] / bright.gains[0]);
  assert.ok(brightRatio > softRatio * 8);

  const mono = buildPhysicalModalBank(kind, { ...base, stereoWidth: 0 });
  assert.ok(mono.pans.every((pan) => pan === 0));
  const silent = buildPhysicalModalBank(kind, { ...base, energy: 0 });
  assert.ok(silent.gains.every((gain) => gain === 0));
  const half = buildPhysicalModalBank(kind, { ...base, energy: 0.5 });
  const full = buildPhysicalModalBank(kind, { ...base, energy: 1 });
  assert.ok(Math.abs(gainNorm(half) / gainNorm(full) - 0.5) < 1e-5);

  const softStiffness = buildPhysicalModalBank(kind, { ...base, stiffness: 0 });
  const hardStiffness = buildPhysicalModalBank(kind, { ...base, stiffness: 1 });
  assert.notEqual(
    softStiffness.frequenciesHz.at(-1),
    hardStiffness.frequenciesHz.at(-1),
  );
});

test("a performance interface can lock Object Forge pitch without disabling size decay", () => {
  const state = {
    ...PHYSICAL_SOUND_PRESETS["object-forge"][0].settings,
    size: 4,
    baseFrequencyHz: 1_108.73,
  };
  const locked = buildPhysicalModalBank("object-forge", state, {
    fundamentalOverrideHz: 1_108.73,
  });
  const reference = buildPhysicalModalBank("object-forge", { ...state, size: 1 }, {
    fundamentalOverrideHz: 1_108.73,
  });
  assert.ok(Math.abs(locked.fundamentalHz - 1_108.73) < 0.01);
  assert.ok(Math.abs(reference.fundamentalHz - locked.fundamentalHz) < 0.01);
  assert.ok(locked.t60Seconds[0] > reference.t60Seconds[0] * 1.9);
});

test("Object Forge pickup gain approaches nodal endpoints continuously", () => {
  const state = {
    presetId: "wood-bar",
    energy: 0.7,
    strikePosition: 0.37,
  };
  const endpoint = gainNorm(buildPhysicalModalBank("object-forge", {
    ...state,
    pickupPosition: 0,
  }));
  const nearEndpoint = gainNorm(buildPhysicalModalBank("object-forge", {
    ...state,
    pickupPosition: 0.000001,
  }));
  const farther = gainNorm(buildPhysicalModalBank("object-forge", {
    ...state,
    pickupPosition: 0.001,
  }));
  assert.equal(endpoint, 0);
  assert.ok(nearEndpoint > endpoint && nearEndpoint < farther * 0.002);
  assert.ok(farther < 0.03);
});

test("Airflow listener directivity changes amplitude without normalization cancelling it", () => {
  const preset = physicalSoundPreset("airflow-objects", "slot-cavity").settings;
  const onAxis = buildPhysicalModalBank("airflow-objects", {
    ...preset,
    listenerAngle: 0,
  });
  const side = buildPhysicalModalBank("airflow-objects", {
    ...preset,
    listenerAngle: 90,
  });
  assert.ok(Math.abs(gainNorm(side) / gainNorm(onAxis) - 0.25) < 1e-5);
});

test("every Bowed Things preset retains its complete authored modal bank", () => {
  for (const preset of PHYSICAL_SOUND_PRESETS["bowed-things"]) {
    const bank = buildPhysicalModalBank("bowed-things", {
      ...preset.settings,
      presetId: preset.id,
    }, { sampleRate: 48_000, maxModes: 64 });
    assert.equal(bank.modeCount, preset.model.modes.length, preset.id);
    assert.ok(bank.frequenciesHz.every(Number.isFinite), preset.id);
  }
});

test("Object Forge accepts compact modal JSON and rejects malformed or empty imports", () => {
  const modalJson = JSON.stringify({
    name: "Hammer-test triangle",
    modes: [
      { ratio: 3.2, decay: 0.8, gain: 0.25, pan: 0.4, strikeNode: 3 },
      { ratio: -4, decay: 1, gain: 1 },
      { ratio: 1, decay: 2.4, gain: 1, pan: -0.2, strikeNode: 1 },
      { ratio: 2.1, t60Seconds: 1.2, gain: 0.55, strikeNode: 2 },
      { ratio: 4, decay: 0, gain: 0.2 },
      { ratio: 5, decay: 0.2, gain: "not-a-number" },
    ],
  });
  const imported = buildPhysicalModalBank("object-forge", {
    presetId: "steel-plate",
    modalJson,
    baseFrequencyHz: 100,
    size: 1,
    stiffness: 0.5,
    strikePosition: 0.25,
    pickupPosition: 0.4,
    modeCount: 12,
  }, { maxModes: 2 });
  assertModalBank(imported, 48_000, 2);
  assert.equal(imported.source, "custom");
  assert.equal(imported.name, "Hammer-test triangle");
  assert.equal(imported.modeCount, 2);
  assert.ok(Math.abs(imported.frequenciesHz[0] - 100) < 0.001);
  assert.ok(Math.abs(imported.frequenciesHz[1] - 210) < 0.001);

  const malformed = buildPhysicalModalBank("object-forge", {
    presetId: "glass-bowl",
    modalJson: "{broken",
  });
  assert.equal(malformed.source, "preset");
  assert.equal(malformed.name, "Glass Bowl");

  const empty = buildPhysicalModalBank("object-forge", {
    modalJson: JSON.stringify({ modes: [{ ratio: 0, decay: -1, gain: null }] }),
  });
  assert.equal(empty.source, "preset");
});

test("Object Forge custom JSON preserves explicit strike weights", () => {
  const bank = buildPhysicalModalBank("object-forge", {
    presetId: "wood-bar",
    baseFrequencyHz: 100,
    strikePosition: 0.25,
    modeCount: 2,
    modalJson: JSON.stringify({
      name: "Weighted body",
      modes: [
        { ratio: 1, decay: 1, gain: 1, strikeWeight: 0.123 },
        { ratio: 2, decay: 0.5, gain: 0.5, strikeWeight: -0.4 },
      ],
    }),
  });
  assert.equal(bank.name, "Weighted body");
  assert.ok(Math.abs(bank.strikeWeights[0] - 0.123) < 1e-6);
  assert.ok(Math.abs(bank.strikeWeights[1] + 0.4) < 1e-6);
});

test("Object Forge JSON serialization round-trips raw modes without double transforms", () => {
  for (const modalJson of [
    "",
    JSON.stringify({
      name: "Imported glass",
      modes: [
        { ratio: 1, decay: 3.4, gain: 1, pan: -0.36, strikeNode: 1 },
        { ratio: 2.71, decay: 2.2, gain: 0.53, pan: 0.21, strikeWeight: -0.27 },
        { ratio: 5.03, decay: 1.1, gain: 0.22, pan: 0.4, strikeNode: 3 },
      ],
    }),
  ]) {
    const state = sanitizePhysicalSoundState("object-forge", {
      presetId: "glass-bowl",
      modalJson,
      modeCount: 3,
      baseFrequencyHz: 337,
      size: 1.7,
      stiffness: 0.81,
      damping: 0.7,
      brightness: 0.8,
      energy: 0.6,
      stereoWidth: 0.6,
      strikePosition: 0.24,
      pickupPosition: 0.42,
    });
    const before = buildPhysicalModalBank("object-forge", state);
    const serialized = serializePhysicalModalJson(state);
    const reloaded = sanitizePhysicalSoundState("object-forge", {
      ...state,
      modalJson: serialized,
      modeCount: before.modeCount,
    }, state);
    const after = buildPhysicalModalBank("object-forge", reloaded);
    for (const key of ["frequenciesHz", "t60Seconds", "gains", "pans", "strikeWeights"]) {
      assert.deepEqual([...after[key]], [...before[key]], `${key} changed after JSON round-trip`);
    }
  }
});

test("custom modal JSON has no hidden dependency on the previously selected preset", () => {
  const modalJson = JSON.stringify({
    name: "Portable body",
    modes: [
      { ratio: 1, decay: 2, gain: 1, strikeNode: 1 },
      { ratio: 2.8, decay: 1.1, gain: 0.5, strikeNode: 2 },
    ],
  });
  const visibleState = {
    modalJson,
    modeCount: 2,
    baseFrequencyHz: 240,
    size: 1.25,
    stiffness: 0.82,
    damping: 0.31,
    brightness: 0.63,
    energy: 0.58,
    stereoWidth: 0.44,
    strikePosition: 0.29,
    pickupPosition: 0.61,
  };
  const wood = buildPhysicalModalBank("object-forge", {
    ...visibleState,
    presetId: "wood-bar",
  });
  const glass = buildPhysicalModalBank("object-forge", {
    ...visibleState,
    presetId: "glass-bowl",
  });
  for (const key of ["frequenciesHz", "t60Seconds", "gains", "pans", "strikeWeights"]) {
    assert.deepEqual([...glass[key]], [...wood[key]], `${key} retained a preset dependency`);
  }
});

test("modeCount and maxModes bound allocation even for oversized imports", () => {
  const modes = Array.from({ length: 500 }, (_, index) => ({
    ratio: 1 + index * 0.05,
    decay: 1,
    gain: 1 / (index + 1),
  }));
  const bank = buildPhysicalModalBank("object-forge", {
    modalJson: JSON.stringify({ modes }),
    baseFrequencyHz: 30,
    modeCount: 64,
  }, { sampleRate: 384_000, maxModes: 7.8 });
  assertModalBank(bank, 384_000, 8);
  assert.equal(bank.modeCount, 8);
});

test("extreme options still produce a nonempty safe bank below the actual Nyquist frequency", () => {
  for (const kind of EXPECTED_KINDS) {
    const bank = buildPhysicalModalBank(kind, {
      presetId: "missing",
      size: 0,
      baseFrequencyHz: Infinity,
      energy: Infinity,
    }, { sampleRate: -1, maxModes: Infinity });
    assert.equal(bank.sampleRate, 8_000);
    assertModalBank(bank, 8_000, 64);
  }
});

test("airflow fundamentals respond to the documented acoustic geometry", () => {
  const wire = physicalSoundPreset("airflow-objects", "roof-wire").settings;
  const slowWire = buildPhysicalModalBank("airflow-objects", { ...wire, airSpeed: 10 });
  const fastWire = buildPhysicalModalBank("airflow-objects", { ...wire, airSpeed: 20 });
  const wideWire = buildPhysicalModalBank("airflow-objects", { ...wire, airSpeed: 10, diameter: 0.012 });
  assert.ok(Math.abs(fastWire.fundamentalHz / slowWire.fundamentalHz - 2) < 1e-9);
  assert.ok(
    Math.abs(slowWire.fundamentalHz / wideWire.fundamentalHz - 0.012 / wire.diameter) < 1e-9,
  );

  const cavity = physicalSoundPreset("airflow-objects", "slot-cavity").settings;
  const shallow = buildPhysicalModalBank("airflow-objects", { ...cavity, cavityDepth: 0.1 });
  const deep = buildPhysicalModalBank("airflow-objects", { ...cavity, cavityDepth: 0.4 });
  assert.ok(shallow.fundamentalHz > deep.fundamentalHz * 3);

  const bottle = physicalSoundPreset("airflow-objects", "glass-bottle").settings;
  const smallBottle = buildPhysicalModalBank("airflow-objects", { ...bottle, cavityDepth: 0.12 });
  const bigBottle = buildPhysicalModalBank("airflow-objects", { ...bottle, cavityDepth: 0.48 });
  assert.ok(smallBottle.fundamentalHz > bigBottle.fundamentalHz * 1.8);
});

test("every airflow preset tunes keyboard notes by changing physical geometry", () => {
  for (const preset of PHYSICAL_SOUND_PRESETS["airflow-objects"]) {
    for (const targetHz of [130.8128, 261.6256, 523.2511]) {
      const tuned = tuneAirflowStateToFrequency({
        ...preset.settings,
        presetId: preset.id,
      }, targetHz);
      const bank = buildPhysicalModalBank("airflow-objects", tuned, { maxModes: 1 });
      assert.ok(
        Math.abs(bank.fundamentalHz - targetHz) / targetHz < 0.002,
        `${preset.id} produced ${bank.fundamentalHz} Hz for ${targetHz} Hz`,
      );
    }
  }
});
