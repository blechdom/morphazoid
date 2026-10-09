import assert from "node:assert/strict";
import test from "node:test";
import {
  SPARTIAL_DEFAULTS, randomSpartialInstrument, sanitizeSpartialSettings,
} from "../src/instruments/spartial/spartial.js";

function currentState(playing = true) {
  return {
    settings: sanitizeSpartialSettings({ ...SPARTIAL_DEFAULTS, level: 0.37, speakerCount: 4 }),
    mode: "single", chord: "minor", motion: "off", beatsPerTurn: 16, routingMode: "spread",
    root: 61, keyboardBase: 60, tempo: 117, phase: 0.413, playing,
    audioOn: true, layout: "4-ring", forcePreview: true,
  };
}

test("instrument dice are pure, reproducible and retain performer state", () => {
  const current = currentState();
  const before = structuredClone(current);
  Object.freeze(current.settings.gains); Object.freeze(current.settings); Object.freeze(current);
  const next = randomSpartialInstrument(current, 834);
  assert.deepEqual(next, randomSpartialInstrument(current, 834));
  assert.deepEqual(current, before);
  assert.notEqual(next.settings, current.settings);
  assert.notEqual(next.settings.gains, current.settings.gains);
  for (const key of ["root", "keyboardBase", "tempo", "phase", "playing", "audioOn", "layout", "forcePreview"]) {
    assert.equal(next[key], current[key], `${key} belongs to the performer`);
  }
  assert.equal(next.settings.level, current.settings.level);
  assert.equal(next.settings.speakerCount, current.settings.speakerCount);
});

test("instrument dice cover every independently editable musical field", () => {
  const current = currentState();
  const scenes = Array.from({ length: 256 }, (_, index) => randomSpartialInstrument(current, 173 + 101 * index));
  for (const key of ["mode", "chord", "motion", "beatsPerTurn", "routingMode"]) {
    assert.ok(new Set(scenes.map(scene => scene[key])).size > 1, `${key} must not be frozen`);
  }
  for (const key of ["partials", "rolloff", "attack", "release", "cascade", "cascadeStart", "cascadeCurve", "cascadeVariation", "cascadeOrder", "pattern", "cycles", "stretch", "inharmonicity", "target", "offset", "seed", "lock", "rotation", "counterRotate"]) {
    assert.ok(new Set(scenes.map(scene => scene.settings[key])).size > 1, `${key} must not be frozen`);
  }
  for (let partial = 0; partial < 32; partial += 1) {
    assert.ok(new Set(scenes.map(scene => scene.settings.gains[partial])).size > 1, `partial ${partial + 1} must vary`);
  }
});

test("instrument dice keep routing, motion and UI values valid without starting playback", () => {
  for (const playing of [false, true]) for (let index = 0; index < 128; index += 1) {
    const current = currentState(playing);
    const next = randomSpartialInstrument(current, 173 + 101 * index);
    const settings = next.settings;
    assert.deepEqual(settings, sanitizeSpartialSettings(settings));
    assert.equal(next.playing, playing);
    assert.equal(settings.spread, 1, "the exposed cycles parameter owns distribution span");
    assert.equal(settings.lock, next.routingMode === "focus" ? 1 : 0);
    assert.ok(settings.target >= 0 && settings.target < settings.speakerCount);
    assert.equal(settings.counterRotate, next.motion === "counter");
    const running = playing && next.motion !== "off" && next.routingMode !== "focus";
    assert.equal(settings.rotation, running ? current.tempo / 60 / next.beatsPerTurn * (next.motion === "ccw" ? -1 : 1) : 0);
    assert.ok(settings.attack >= 0.005 && settings.attack <= 2);
    assert.ok(settings.release >= 0.02 && settings.release <= 5);
    assert.ok(settings.offset >= 0 && settings.offset <= 0.995 + 1e-12);
    assert.ok(settings.gains[0] >= 0.65, "random timbres retain a playable fundamental");
    for (const key of ["cascade", "cascadeStart"]) assert.ok(Math.abs(settings[key] * 1000 - Math.round(settings[key] * 1000)) < 1e-8);
  }
});
