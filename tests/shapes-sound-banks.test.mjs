import assert from "node:assert/strict";
import test from "node:test";
import { createShapesState, SHAPES_TRIGGER_SOUND_BANKS } from "../src/instruments/shapes/shapes-state.js";
import { shapesControlAvailability } from "../src/instruments/shapes/control-availability.js";
import { buildShapesScene } from "../src/instruments/shapes/shapes-scene.js";
import { originalSynthSpecs } from "../src/instruments/shapes/original-audio.js";
import { SHAPES_FULL_PRESETS, captureShapesPreset, applyShapesPreset, randomizeShapesPreset } from "../src/instruments/shapes/full-presets.js";
import { ShapesKitAudio, shapesKitVoice } from "../src/instruments/shapes/kit-audio.js";
import { SHAPES_PREPARED_KITS } from "../src/instruments/shapes/trigger-banks.js";

for (const [dimension, forms] of Object.entries({
  "3d": ["profile", "cube", "pyramid", "octahedron", "prism", "cone", "cylinder", "sphere", "torus"],
  "4d": ["profile", "tesseract", "hypersphere", "hyperpyramid", "klein"],
})) test(`${dimension}: hide profile controls only where geometry does not use them`, () => {
  for (const representation of forms) {
    const state = createShapesState({ selection: { dimension }, profile: { kind: "star", sides: 5, starDepth: 0.1 }, dimension: { [dimension]: { representation } } });
    const original = JSON.stringify(state), scene = buildShapesScene(state);
    assert.equal(shapesControlAvailability(state).profile, representation === "profile");
    assert.equal(shapesControlAvailability(state).starDepth, representation === "profile");
    assert.equal(JSON.stringify(state), original, "visibility must not rewrite hidden settings");
    for (const [key, value] of Object.entries({ sides: 17, kind: "polygon", starDepth: 0.8 })) {
      const next = structuredClone(state); next.profile[key] = value;
      assert.equal(JSON.stringify(buildShapesScene(next).geometry) !== JSON.stringify(scene.geometry), representation === "profile", `${representation} ${key}`);
    }
    state.dimension[dimension].representation = "profile";
    assert.equal(state.profile.starDepth, 0.1);
    assert.equal(shapesControlAvailability(state).starDepth, true);
  }
});

test("FM/PM controls follow the actual 2D and higher-dimensional parameter paths", () => {
  for (const dimension of ["2d", "3d", "4d"]) for (const engine of ["fm", "pm"]) {
    const state = createShapesState({ selection: { dimension }, voice: { engine }, synthesis: { model: "geometry" } });
    const scene = buildShapesScene(state), before = JSON.stringify(originalSynthSpecs(scene, state));
    const available = shapesControlAvailability(state);
    for (const key of ["fmIndex", "fmRatio", "pmIndex", "pmRatio"]) {
      const next = structuredClone(state); next.synthesis.tone[key] += 1;
      const affects = JSON.stringify(originalSynthSpecs(scene, next)) !== before;
      assert.equal(affects, key.startsWith("fm") ? available.fm : available.pm, `${dimension} ${engine} ${key}`);
    }
  }
});

test("Character and Shepard turn controls are conditional, never removed or zeroed", () => {
  for (const dimension of ["2d", "3d", "4d"]) for (const mode of ["continuous", "notes", "triggers"]) for (const engine of ["sine", "triangle", "square", "saw", "fm", "pm", "shepard"]) {
    const state = createShapesState({ selection: { dimension, playingMode: mode }, voice: { engine, character: 0.82 }, synthesis: { model: "shapes", tone: { shepardMapping: "turn", shepardTurnGlide: 0.76 } } });
    assert.equal(shapesControlAvailability(state).character, mode === "continuous" && ["fm", "pm", "shepard"].includes(engine));
    assert.equal(state.voice.character, 0.82);
    assert.equal(state.synthesis.tone.shepardTurnGlide, 0.76);
    state.dimension["2d"].reader = "radar";
    assert.equal(shapesControlAvailability(state).shepardTurnGlide, false);
    state.dimension["2d"].reader = "points";
    assert.equal(shapesControlAvailability(state).shepardTurnGlide, dimension === "2d");
  }
});

test("all Morphazoid banks survive snapshots, have factory scenes and participate in dice", () => {
  let seed = 719, current = captureShapesPreset(createShapesState());
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const picked = new Set();
  for (let i = 0; i < 500; i++) { current = randomizeShapesPreset(current, random); if (current.parameters.selection.playingMode === "triggers") picked.add(current.parameters.trigger.soundBank); }
  assert.deepEqual([...picked].sort(), SHAPES_TRIGGER_SOUND_BANKS.map(b => b.id).sort());
  for (const bank of SHAPES_TRIGGER_SOUND_BANKS) {
    const state = createShapesState({ selection: { playingMode: "triggers" }, trigger: { soundBank: bank.id, tuningDepth: 24, hitCap: 16, characterDepth: 1 } });
    const restored = applyShapesPreset(createShapesState(), captureShapesPreset(state));
    assert.deepEqual(restored.trigger, state.trigger);
    assert.ok(SHAPES_FULL_PRESETS.some(p => p.snapshot.parameters.selection.playingMode === "triggers" && p.snapshot.parameters.trigger.soundBank === bank.id));
  }
  assert.equal(SHAPES_TRIGGER_SOUND_BANKS.find(b => b.id === "fm-kit").label, "Soft FM kit", "old saved ID now selects the soft recipe");
  for (const bank of SHAPES_PREPARED_KITS) for (let index = 0; index < 16; index++) {
    const voice = shapesKitVoice(bank.id, index);
    assert.equal(voice.voiceIndex, index);
    assert.ok(voice.frequency > 0);
    if (["karplus-strong", "pitched-morph"].includes(bank.id)) assert.ok(voice.frequency >= 110 && voice.frequency <= 880);
  }
});

function param() { return { value: 0, events: [], setValueAtTime(...v) { this.events.push(["set", ...v]); this.value = v[0]; }, linearRampToValueAtTime(...v) { this.events.push(["ramp", ...v]); }, cancelScheduledValues(...v) { this.events.push(["cancel", ...v]); }, cancelAndHoldAtTime(...v) { this.events.push(["hold", ...v]); } }; }
function fakeKit() {
  const audio = new ShapesKitAudio({});
  const nodes = [];
  const node = properties => { const value = { connect(to) { return to; }, disconnect() { this.disconnected = true; }, ...properties }; nodes.push(value); return value; };
  audio.context = { state: "running", currentTime: 2, sampleRate: 48000,
    createBufferSource: () => node({ playbackRate: param(), start(...args) { this.started = args; }, stop(at) { this.stopped = at; } }),
    createGain: () => node({ gain: param() }), createBiquadFilter: () => node({ frequency: param(), Q: param() }), createStereoPanner: () => node({ pan: param() }),
  };
  audio.input = node({}); audio.readyBank = "fm-kit";
  audio.buffers.set("fm-kit", Array.from({ length: 16 }, () => ({ duration: 0.5 })));
  return { audio, nodes };
}

test("prepared triggers schedule ahead, preserve active tails on takeover and bound bursts", async () => {
  const { audio } = fakeKit(), voice = shapesKitVoice("fm-kit", 0);
  assert.equal((await audio.trigger(voice, { startAt: 1 })).reason, "late");
  assert.equal((await audio.trigger(voice, { bank: "modal" })).reason, "preparing");
  await audio.trigger(voice); await audio.trigger(voice, { startAt: 2.06 });
  const [sounding, future] = [...audio.activeHits];
  assert.deepEqual(future.source.started, [2.06]);
  audio.cancelScheduledHits();
  assert.equal(audio.activeHits.has(sounding), true);
  assert.equal(audio.activeHits.has(future), false);
  assert.equal(future.source.disconnected, true);
  for (let i = 0; i < 200; i++) await audio.trigger(voice);
  assert.ok(audio.activeHits.size <= 24);
  assert.equal((await audio.trigger(voice)).reason, "budget");
  audio.silence();
  assert.ok(sounding.gain.gain.events.some(e => e[0] === "ramp" && e[1] === 0 && e[2] === 2.015));
  for (const hit of [...audio.activeHits]) hit.source.onended();
  assert.equal(audio.activeHits.size, 0);
});

test("shared drum renderer preserves the original Rubix recipes exactly", async () => {
  const { readFile } = await import("node:fs/promises");
  const changes = JSON.parse(await readFile(new URL("../docs/shapes-sound-banks-runtime-changes.json", import.meta.url))).changes;
  const rubix = changes.find(c => c.file === "src/instruments/rubix/rubix-app.js");
  const before = rubix.replacements.find(c => c.before.includes("  scheduleFmDrum(")).before;
  const original = before.slice(before.indexOf("  scheduleFmDrum("), before.indexOf("  async close()"));
  const shared = await readFile(new URL("../src/families/percussion/drum-renderer.js", import.meta.url), "utf8");
  assert.equal(shared.slice(shared.indexOf("  scheduleFmDrum("), shared.lastIndexOf("}")), original.replaceAll("Math.random()", "this.random()"));
});

test("feature reversal rejects missing or duplicated edits rather than weakening proofs", async () => {
  const {readFile} = await import("node:fs/promises");
  const {restoreShapesSoundBanks,shapesSoundBankChanges} = await import("./helpers/shapes-sound-banks-reference.mjs");
  const change = shapesSoundBankChanges[0];
  const source = await readFile(new URL(`../${change.file}`,import.meta.url),"utf8");
  const block = change.replacements[0].after;
  assert.notEqual(restoreShapesSoundBanks(source,change.file),source);
  assert.throws(() => restoreShapesSoundBanks(source.replace(block,""),change.file));
  assert.throws(() => restoreShapesSoundBanks(source+block,change.file));
  assert.equal(restoreShapesSoundBanks("unrelated","other.js"),"unrelated");
});
