import test from "node:test";
import assert from "node:assert/strict";
import { createAudioInputMeter } from "../src/audio-input-meter.js";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { readFile } from "node:fs/promises";
import { pageSourcePath } from "../src/pages/manifest.js";
import { GRAPH_DELAY_FULL_PRESETS, validateGraphDelayPreset } from "../src/families/graph-presets/full-presets.js";
import { L_SYSTEMS_MIC_PRESETS, validateLSystemsPreset, randomizeLSystemsPreset } from "../src/instruments/l-systems/full-presets.js";

function fixture(values) {
  const connections = [], disconnected = [];
  const node = name => ({ name, connect: (...args) => connections.push([name, ...args]), disconnect: (...args) => disconnected.push([name, ...args]) });
  const analysers = [];
  const context = {
    state: "running", destination: node("destination"),
    createChannelSplitter: () => node("splitter"),
    createGain: () => ({ ...node("sink"), gain: { value: 1 } }),
    createAnalyser: () => {
      const index = analysers.length;
      const analyser = { ...node(`channel-${index}`), getFloatTimeDomainData: buffer => buffer.fill(values[index]) };
      analysers.push(analyser);
      return analyser;
    },
  };
  const source = { ...node("input"), context };
  return { source, context, analysers, connections, disconnected };
}

test("stereo metering measures opposed channels independently and applies native DSP gain", () => {
  const f = fixture([0.25, -0.125]);
  const meter = createAudioInputMeter(f.source, { channels: 2 });
  assert.deepEqual(meter.read(), { left: 0.25, right: 0.125 });
  assert.deepEqual(meter.read(2), { left: 0.5, right: 0.25 });
  assert.deepEqual(meter.read(0), { left: 0, right: 0 });
  const sink = f.connections.find(([name]) => name === "channel-0")[1];
  assert.equal(sink.gain.value, 0, "the meter tap never monitors input");
  meter.destroy(); meter.destroy();
  assert.equal(f.disconnected.filter(([name]) => name === "input").length, 1);
  assert.equal(f.disconnected.find(([name]) => name === "input").length, 2, "disconnect only the meter branch, preserving DSP routing");
  assert.deepEqual(meter.read(), { left: 0, right: 0 });
});

test("mono input needs one analyser and closed contexts display silence", () => {
  const f = fixture([0.5]);
  const meter = createAudioInputMeter(f.source);
  assert.equal(f.analysers.length, 1);
  assert.deepEqual(meter.read(), { left: 0.5, right: 0.5 });
  f.context.state = "closed";
  assert.deepEqual(meter.read(), { left: 0, right: 0 });
  meter.destroy();
});

test("soft-vocal gain survives saving and validation in graph and L-Systems mic presets", () => {
  for (const [original, gainPath, validate] of [
    [GRAPH_DELAY_FULL_PRESETS[0].snapshot, "parameters", validateGraphDelayPreset],
    [L_SYSTEMS_MIC_PRESETS[0].snapshot, "mic", validateLSystemsPreset],
  ]) {
    const boosted = structuredClone(original);
    boosted[gainPath].inputTrim = 1.5;
    const saved = JSON.parse(JSON.stringify(boosted));
    assert.deepEqual(validate(saved), boosted);
    if (gainPath === "mic") {
      assert.equal(randomizeLSystemsPreset(saved, () => 0.5).mic.inputTrim, 1.5);
    }
    saved[gainPath].inputTrim = 1.51;
    assert.throws(() => validate(saved), /inputTrim/);
  }
});

test("new shared input files ship before staging and demo-only instruments do not advertise capture", async () => {
  const manifest = await readRuntimeManifest();
  for (const file of ["src/audio-input-control.js", "src/audio-input-meter.js", "src/ui/patterns/audio-input-strip.js", "src/ui/patterns/audio-input-strip.css"]) {
    assert.ok(manifest.worktreeFiles.includes(file), file);
    assert.ok(manifest.requiredFiles.includes(file), file);
  }
  for (const id of ["splice-ring", "onset-atlas", "synaptic-resonance"]) assert.equal(instrumentMidiCapabilityForId(id).audioInput, false);
  assert.equal(instrumentMidiCapabilityForId("gesturama").audioInput, true);
});

test("every page in the testing list exists and its adapter mounts the shared input control", async () => {
  const inventory = JSON.parse(await readFile(new URL("../docs/audio-input-controls.json", import.meta.url)));
  assert.equal(new Set(inventory.controls.map(control => control.route)).size, inventory.controls.length);
  for (const control of inventory.controls) {
    const route = new URL(control.route, "http://localhost/").pathname.slice(1);
    await readFile(new URL(`../${pageSourcePath(route)}`, import.meta.url));
    const source = await readFile(new URL(`../${control.owner}`, import.meta.url), "utf8");
    assert.match(source, /mountAudioInputControl\(/, control.label);
  }
});
