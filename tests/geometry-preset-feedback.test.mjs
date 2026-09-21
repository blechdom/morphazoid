import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SOLID_FULL_PRESETS, HYPER_FULL_PRESETS, validateGeometryPreset } from "../src/families/geometry-presets/full-presets.js";
import { SHAPE_FULL_PRESETS } from "../src/instruments/shape-synth/full-presets.js";
import { createAmplitudeControl } from "../src/amplitude-control.js";
import { VoicePool } from "../src/audio.js";

for (const [kind, bank] of [["solid", SOLID_FULL_PRESETS], ["hyper", HYPER_FULL_PRESETS]]) {
  test(`${kind}: twenty authored presets include interleaved fast playhead-only and single-axis shape-only examples`, () => {
    assert.equal(bank.length, 20);
    const playhead = bank.filter(p => p.id.startsWith("plane-")), shape = bank.filter(p => p.id.startsWith("shape-"));
    assert.equal(playhead.length, 4);
    assert.equal(shape.length, 4);
    const axes = p => Object.keys(p).filter(key => key.endsWith("Playing") && p[key]);
    for (const preset of playhead) {
      const p = preset.snapshot.parameters;
      assert.equal(p.playing, true);
      assert.equal(axes(p).length, 0);
      assert.ok(p.speed >= 0.6);
      assert.match(preset.label, /^Playhead only/);
    }
    for (const preset of shape) {
      const p = preset.snapshot.parameters;
      assert.equal(p.playing, false);
      assert.equal(axes(p).length, 1);
      assert.match(axes(p)[0], /^rotation/);
      assert.match(preset.label, /^Shape only/);
    }
    assert.ok(bank.slice(0, 10).some(p => p.id.startsWith("shape-")));
    assert.ok(bank.slice(0, 10).some(p => p.id.startsWith("plane-")));
    assert.ok(bank.slice(10).some(p => p.id.startsWith("shape-")));
    assert.ok(bank.slice(10).some(p => p.id.startsWith("plane-")));
    for (const preset of bank) {
      validateGeometryPreset(kind, preset.snapshot);
      assert.ok(preset.snapshot.parameters.playing || axes(preset.snapshot.parameters).length > 0);
    }
  });
}

test("the first studies are fast playable setups, Klein is second, and the paused Shape preset is removed", () => {
  for (const bank of [SOLID_FULL_PRESETS, HYPER_FULL_PRESETS]) {
    assert.equal(bank[0].snapshot.parameters.playing, true);
    assert.ok(bank[0].snapshot.parameters.speed >= 0.4);
    assert.equal(bank[0].snapshot.envelope.enabled, false);
  }
  assert.equal(HYPER_FULL_PRESETS[1].id, "klein-reed");
  assert.equal(SHAPE_FULL_PRESETS.length, 36);
  assert.equal(SHAPE_FULL_PRESETS.some(p => p.id === "hands-on-sketch"), false);
  assert.ok(SHAPE_FULL_PRESETS.every(p => p.snapshot.parameters.playing || p.snapshot.parameters.autoRotate));
});

test("reported envelope holes are removed without replacing the named sound engines", () => {
  const glass = SOLID_FULL_PRESETS.find(p => p.id === "octahedron-chimes").snapshot;
  assert.equal(glass.parameters.soundMode, "pm");
  const amplitude = createAmplitudeControl(null);
  amplitude.applyState(glass.envelope);
  for (const contactPhase of [0, 0.16, 0.3, 0.5, 0.8, 1]) assert.ok(amplitude.sample(contactPhase, 0.3) > 0.2);
  const velvet = HYPER_FULL_PRESETS.find(p => p.id === "velvet-tesseract").snapshot;
  assert.equal(velvet.envelope.enabled, true);
  assert.ok(velvet.parameters.speed >= 0.6);
  assert.equal(velvet.parameters.rotationXWPlaying, false);
  for (const [bank, id] of [[SOLID_FULL_PRESETS, "sphere-shepard"], [HYPER_FULL_PRESETS, "endless-hypersphere"]]) {
    const p = bank.find(p => p.id === id).snapshot;
    assert.equal(p.parameters.soundMode, "shepard");
    assert.equal(p.parameters.voiceLimit, 8);
    assert.equal(p.parameters.playing, true);
    assert.equal(p.envelope.enabled, false);
  }
});

test("the existing voice-pool trajectory honours the smaller render budget", () => {
  const pool = new VoicePool(32, { continuousPeakCeiling: 0.78 });
  let message;
  pool.enabled = true;
  pool.context = { currentTime: 0 };
  pool.synthNode = { port: { postMessage(value) { message = value; } } };
  const voices = Array.from({ length: 32 }, (_, i) => ({ key: `voice-${i}`, frequency: 110 + i, gain: 0.2, mode: "shepard" }));
  pool.setVoiceTrajectory(voices, voices, 0.075, { voiceLimit: 8 });
  assert.equal(message.voices.length, 8);
  assert.equal(message.nextVoices.length, 8);
  assert.equal(message.voiceLimit, 8);
  assert.ok(message.voices.reduce((sum, voice) => sum + voice.gain, 0) <= 0.78 + 1e-9);
});

test("voice budgets are visible native controls and both render paths honour them", async () => {
  for (const [kind, maximum] of [["solid", 32], ["hyper", 20]]) {
    const html = await readFile(new URL(`../${kind}-synth.html`, import.meta.url), "utf8");
    const app = await readFile(new URL(`../src/instruments/${kind}-synth/${kind}-synth-app.js`, import.meta.url), "utf8");
    assert.match(html, new RegExp(`id="voiceLimit"[^>]*min="1"[^>]*max="${maximum}"[^>]*value="${maximum}"`));
    assert.match(app, /voiceLimit: state\.voiceLimit/);
    assert.match(app, /\$\("voiceLimitControl"\)\.hidden = state\.soundMode === "percussion"/);
    assert.match(app, /\["voiceLimit", (?:32|20)\]/, "Reset sound restores the original cap");
    if (kind === "solid") assert.match(app, /reduceVoiceContacts\(contacts\.map\(voiceForContact\), state\.voiceLimit\)/);
    else assert.match(app, /evenlySelect\(contacts, Math\.min\(MAX_HYPER_VOICES, state\.voiceLimit\)\)/);
  }
});
