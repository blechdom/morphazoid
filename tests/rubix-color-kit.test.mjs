import assert from "node:assert/strict";
import test from "node:test";
import { RUBIX_COLOR_ORDER, RUBIX_SEQUENCE_ROLES, RUBIX_COLOR_KIT_VOICE_BY_COLOR, RUBIX_DRUM_LEFT_VOICE_BY_COLOR, RUBIX_DRUM_RIGHT_VOICE_BY_COLOR, createRubixSequenceSnapshot, createSolvedRubixCube, turnRubixLayer, rubixDrumVoiceForColor } from "../src/instruments/rubix/rubix.js";
import { DEFAULT_FM_DRUM_VOICES, sanitizeFmDrumVoice } from "../src/instruments/fm-drums/fm-drums.js";
import { RUBIX_FULL_PRESETS, randomizeRubixPreset, validateRubixFullPreset } from "../src/instruments/rubix/full-presets.js";
import { rubixSourceVoice } from "../src/instruments/rubix/rubix-percussion.js";
import { rubixBankDefaults, rubixVoiceWithParams, validateRubixBankParams } from "../src/instruments/rubix/sound-params.js";

const expected = { white: 11, yellow: 7, green: 2, blue: 10, red: 0, orange: 14 };

test("Color kit gives six contrasting voice families stable identities across all face roles", () => {
  assert.deepEqual(RUBIX_COLOR_KIT_VOICE_BY_COLOR, expected);
  assert.ok(Object.isFrozen(RUBIX_COLOR_KIT_VOICE_BY_COLOR));
  assert.equal(new Set(Object.values(expected).map(index => DEFAULT_FM_DRUM_VOICES[index].family)).size, 6);
  for (const color of RUBIX_COLOR_ORDER) for (const role of RUBIX_SEQUENCE_ROLES) {
    assert.equal(rubixDrumVoiceForColor(color, role, "color-kit"), expected[color]);
    for (const bank of ["soft-fm", "analog", "modal", "noise", "rattlesnake", "pitched-morph", "karplus-strong", "shared-sine"]) {
      assert.equal(rubixDrumVoiceForColor(color, role, bank),
        (role === "drumRight" ? RUBIX_DRUM_RIGHT_VOICE_BY_COLOR : RUBIX_DRUM_LEFT_VOICE_BY_COLOR)[color]);
    }
  }
  assert.throws(() => rubixDrumVoiceForColor("pink", "acid", "color-kit"));
  assert.throws(() => rubixDrumVoiceForColor("red", "unknown", "color-kit"));
});

test("Color kit snapshot indices follow colors through middle, outer and whole-cube turns and camera changes", () => {
  let cube = createSolvedRubixCube();
  const moves = [
    { axis: "x", layer: 0, direction: 1 }, { axis: "z", layer: 1, direction: -1 },
    ...[-1, 0, 1].map(layer => ({ axis: "y", layer, direction: 1 })),
  ];
  const cameras = [{ x: 30, y: -45, z: 0 }, { x: -35, y: 132, z: 17 }];
  const originalColors = new Map(cube.stickers.map(sticker => [sticker.id, sticker.color]));
  for (const move of moves) {
    cube = turnRubixLayer(cube, move);
    for (const sticker of cube.stickers) assert.equal(sticker.color, originalColors.get(sticker.id));
    for (const camera of cameras) {
      const snapshot = createRubixSequenceSnapshot(cube, camera, "color-kit");
      for (const [role, key] of [["acid", "drumTopVoiceIndices"], ["drumLeft", "drumLeftVoiceIndices"], ["drumRight", "drumRightVoiceIndices"]]) {
        assert.deepEqual(snapshot.audio[key], snapshot.lanes[role].map(sticker => expected[sticker.color]));
      }
    }
  }
});

test("Color kit source recipes shorten individual envelopes and retain saved edits without changing other banks", () => {
  const decay = { red: .30, green: .16, yellow: .05, blue: .15, white: .22, orange: .20 };
  const params = rubixBankDefaults("color-kit");
  assert.equal(params.decayScale, 1);
  assert.equal(params.pitchSweep, 1);
  for (const [color, index] of Object.entries(expected)) {
    const voice = DEFAULT_FM_DRUM_VOICES[index];
    const source = rubixSourceVoice(voice, index, "color-kit");
    assert.ok(Math.abs(source.decay - decay[color]) < 1e-12);
    assert.equal(source.family, voice.family);
    assert.equal(source.frequency, voice.frequency);
    assert.equal(source.modRatio, voice.modRatio);
    assert.equal(source.pitchBend, voice.pitchBend);
    assert.ok(Math.abs(rubixSourceVoice({ ...voice, decay: voice.decay * 1.5 }, index, "color-kit").decay - decay[color] * 1.5) < 1e-12);
    assert.equal(rubixSourceVoice(voice, index, "soft-fm"), voice);
    const rendered = sanitizeFmDrumVoice(rubixVoiceWithParams(source, params));
    assert.ok(rendered.decay >= .035 && rendered.decay <= .3);
    assert.ok(Object.values(rendered).filter(value => typeof value === "number").every(Number.isFinite));
  }
});

test("Color kit is a legal scrambled 3×3 full preset with every color visible and protected performer levels", () => {
  const preset = RUBIX_FULL_PRESETS.find(preset => preset.id === "color-kit");
  validateRubixFullPreset(preset.snapshot);
  const { cube, camera, settings } = preset.snapshot;
  assert.equal(cube.size, 3); assert.equal(preset.snapshot.shapeId, "cube");
  assert.equal(settings.soundBank, "color-kit"); assert.equal(settings.tempo, 158); assert.equal(settings.swing, .08);
  for (const key of ["output", "acidLevel", "drumLevel"]) assert.equal(Object.hasOwn(settings, key), false);
  let legal = createSolvedRubixCube();
  for (let index = 0; index < 11; index++) legal = turnRubixLayer(legal, { axis: ["x", "y", "z"][(index + 2) % 3], layer: 1, direction: (index + 2) % 2 ? -1 : 1 });
  assert.deepEqual(cube, legal);
  const lanes = Object.values(createRubixSequenceSnapshot(cube, camera, "color-kit").lanes);
  assert.equal(new Set(lanes.flat().map(sticker => sticker.color)).size, 6);
  assert.ok(lanes.every(lane => new Set(lane.map(sticker => sticker.color)).size >= 4));
});

test("full randomization reaches Color kit with complete independently varying bank controls", () => {
  let seed = 93;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const current = RUBIX_FULL_PRESETS.find(preset => preset.id === "color-kit").snapshot;
  const before = JSON.stringify(current), values = new Set();
  let selected = false;
  for (let i = 0; i < 100; i++) {
    const snapshot = randomizeRubixPreset(current, random);
    selected ||= snapshot.settings.soundBank === "color-kit";
    validateRubixBankParams(snapshot.bankParams);
    values.add(snapshot.bankParams.banks["color-kit"].fmDepth);
    for (const key of ["output", "acidLevel", "drumLevel"]) assert.equal(Object.hasOwn(snapshot.settings, key), false);
  }
  assert.ok(selected); assert.equal(values.size, 100); assert.equal(JSON.stringify(current), before);
});
