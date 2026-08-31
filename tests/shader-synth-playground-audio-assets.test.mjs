import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SHADER_SYNTH_PLAYGROUND_AUDIO_ASSET_SPECS,
  formatShaderSynthPlaygroundAudioAsset,
  prepareShaderSynthPlaygroundAudioAsset,
  shaderSynthPlaygroundAudioAssetSpec,
} from "../src/shader-synth-playground-audio-assets.js";

const ROOT = new URL("../", import.meta.url);

function fakeAudioBuffer(channels, sampleRate = 44100) {
  return {
    sampleRate,
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    getChannelData(index) { return channels[index]; },
  };
}

test("only resident-audio modules expose file asset specifications", () => {
  assert.deepEqual(Object.keys(SHADER_SYNTH_PLAYGROUND_AUDIO_ASSET_SPECS), [
    "uploaded-wavetable",
    "gpu-sampler-granulator",
    "convolution-space",
  ]);
  assert.equal(shaderSynthPlaygroundAudioAssetSpec("oscillator"), null);
  assert.deepEqual(shaderSynthPlaygroundAudioAssetSpec("uploaded-wavetable").selector, {
    paramId: "table",
    value: 5,
  });
  assert.deepEqual(shaderSynthPlaygroundAudioAssetSpec("convolution-space").selector, {
    paramId: "ir",
    value: 6,
  });
});

test("sampler audio is resampled, made stereo, and capped at eight seconds", () => {
  const sourceRate = 48000;
  const source = Float32Array.from(
    { length: sourceRate * 10 },
    (_value, index) => Math.sin(index * 0.01),
  );
  const asset = prepareShaderSynthPlaygroundAudioAsset(
    fakeAudioBuffer([source], sourceRate),
    "gpu-sampler-granulator",
    44100,
  );
  assert.equal(asset.frameCount, 44100 * 8);
  assert.equal(asset.left.length, asset.right.length);
  assert.equal(asset.channelCount, 1);
  assert.equal(asset.duration, 8);
  assert.equal(asset.left[1200], asset.right[1200]);
  assert.equal(formatShaderSynthPlaygroundAudioAsset(asset), "8.00 s mono sample");
});

test("wavetable preparation removes DC and closes the repeated boundary", () => {
  const left = Float32Array.from({ length: 4096 }, (_value, index) => 0.4 + index / 4096);
  const right = Float32Array.from({ length: 4096 }, (_value, index) => 0.2 - index / 8192);
  const asset = prepareShaderSynthPlaygroundAudioAsset(
    fakeAudioBuffer([left, right]),
    "uploaded-wavetable",
    44100,
  );
  assert.equal(asset.frameCount, 2048);
  assert.equal(asset.channelCount, 1);
  assert.ok(Math.abs(asset.left[0] - asset.left.at(-1)) < 1e-5);
  const average = asset.left.reduce((sum, sample) => sum + sample, 0) / asset.frameCount;
  assert.ok(Math.abs(average) < 1e-5);
  assert.ok(Math.max(...asset.left.map(Math.abs)) <= 0.980001);
  assert.deepEqual(asset.left, asset.right);
  assert.equal(formatShaderSynthPlaygroundAudioAsset(asset), "2,048-sample table");
});

test("uploaded convolution responses stay within the GPU upload partition", () => {
  const left = new Float32Array(70000);
  const right = new Float32Array(70000);
  left[0] = 1;
  right[24] = 0.5;
  const asset = prepareShaderSynthPlaygroundAudioAsset(
    fakeAudioBuffer([left, right]),
    "convolution-space",
    44100,
  );
  assert.equal(asset.frameCount, 65536);
  assert.equal(asset.left[0], 1);
  assert.equal(asset.right[24], 0.5);
  assert.equal(asset.channelCount, 2);
  assert.match(formatShaderSynthPlaygroundAudioAsset(asset), /stereo response$/);
});

test("the inspector routes decoded files through the lazy audio engine", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("shader-synth-playground.html", ROOT), "utf8"),
    readFile(new URL("shader-synth-playground.css", ROOT), "utf8"),
    readFile(new URL("shader-synth-playground-app.js", ROOT), "utf8"),
  ]);
  for (const id of [
    "nodeAssetSection", "nodeAssetTitle", "nodeAssetFile", "nodeAssetFileLabel",
    "nodeAssetClear", "nodeAssetStatus",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /nodeAssetFile[^>]+type="file"[^>]+accept="audio\/\*/);
  assert.match(css, /\.node-asset-actions/);
  assert.match(app, /prepareShaderSynthPlaygroundAudioAsset\(decoded, module\.id, targetSampleRate\)/);
  assert.match(app, /state\.engine\?\.setNodeAsset\?\.\(nodeId, asset\.left, asset\.right\)/);
  assert.match(app, /nextEngine\.setNodeAsset\?\.\(nodeId, asset\.left, asset\.right\)/);
  assert.match(app, /state\.engine\?\.clearNodeAsset\?\.\(node\.id\)/);
});
