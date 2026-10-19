import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_NAMES, MAX_FILE_BYTES, decodeLocalSource, decodeLocalSources,
  demoSource, sampleSource, waveformOf,
} from "../src/instruments/globule-damacy/sources.js";
import { SLICE_CELLS, collectSweep, cutRibbon } from "../src/instruments/globule-damacy/model.js";

test("the eight original offline sources contain distinct, finite, real PCM and visible dynamics", () => {
  const sources = Array.from({ length: SOURCE_NAMES.length }, (_, index) => demoSource(index));
  assert.equal(new Set(sources.map(source => source.name)).size, 8);
  assert.ok(sources.every(source => source.kind === "demo" && source.duration === 6.4
    && source.channels.length === 2 && source.channels[0].length === 16000 * 6.4
    && source.waveform.length === 128 && source.waveform.every(peak => peak >= 0 && peak <= 1)
    && source.waveform.some(peak => peak > .05)));
  assert.notDeepEqual(sources[0].channels[0].slice(16000, 16100),
    sources[1].channels[0].slice(16000, 16100));
  assert.notDeepEqual(waveformOf([new Float32Array(10)]), waveformOf([Float32Array.from({ length: 10 }, () => 1)]));
  const picked = collectSweep([], { phase: .15, lane: 0 }, { phase: .85, lane: 7 });
  assert.equal(new Set(picked.added.map(item => item.sourceIndex)).size, 8);
  for (const item of picked.added) {
    const sound = cutRibbon(sources[item.sourceIndex], item.cell);
    assert.equal(sound.channels[0].length > 0, true);
    assert.equal(sound.channels.every(channel => channel.every(Number.isFinite)), true);
  }
  assert.throws(() => demoSource(8), /Unknown source/);
  assert.equal(sampleSource(6).kind, "sample");
  assert.equal(sampleSource(6).name, SOURCE_NAMES[6]);
  assert.equal(SLICE_CELLS, 160);
});

test("an offline local file changes only the chosen floor ribbon, not a PCM capture already stuck on the ball", async () => {
  const sources = Array.from({ length: 8 }, (_, index) => demoSource(index, 8000));
  const captured = cutRibbon(sources[0], 16);
  const expected = Float32Array.from(captured.channels[0]);
  let decoded = 0;
  class OfflineDecoder {
    async decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 5);
      decoded++;
      const data = Float32Array.from({ length: 8000 }, (_, frame) => .7 * Math.sin(frame * .1));
      return { sampleRate: 8000, numberOfChannels: 1, length: data.length,
        getChannelData() { return data; } };
    }
  }
  const file = { name: "own-tape.wav", size: 5500, async arrayBuffer() { return new ArrayBuffer(5); } };
  const replacement = await decodeLocalSource(file, 0, sources, OfflineDecoder);
  assert.equal(decoded, 1);
  assert.equal(replacement.name, "own-tape.wav");
  assert.equal(replacement.kind, "file");
  assert.equal(replacement.channels.length, 1);
  assert.equal(replacement.bytes, 8000 * 4);
  sources[0] = replacement;
  replacement.channels[0].fill(0); // Even mutating the new source cannot rewrite the old capture.
  assert.deepEqual(captured.channels[0], expected);
  assert.notDeepEqual(cutRibbon(sources[0], 16).channels[0], expected);
  await assert.rejects(decodeLocalSource({ ...file, size: MAX_FILE_BYTES + 1 }, 0, sources, OfflineDecoder),
    /12 MiB/);
  await assert.rejects(decodeLocalSource(file, 8, sources, OfflineDecoder), /source ribbon/);
  assert.equal(decoded, 1, "invalid input is rejected before decoding");
});

test("several local tracks wrap around the floor and commit only after the whole batch decodes", async () => {
  const sources = Array.from({ length: 8 }, (_, index) => demoSource(index, 8000));
  class OfflineDecoder {
    async decodeAudioData(bytes) {
      if (bytes.byteLength === 13) throw new Error("damaged audio");
      const data = new Float32Array(8000).fill(bytes.byteLength / 100);
      return { sampleRate: 8000, numberOfChannels: 1, length: data.length,
        getChannelData() { return data; } };
    }
  }
  const file = (name, bytes) => ({
    name, size: 1500, async arrayBuffer() { return new ArrayBuffer(bytes); },
  });
  const placements = await decodeLocalSources([
    file("last.wav", 5), file("first.wav", 6), file("second.wav", 7),
  ], 7, sources, OfflineDecoder);
  assert.deepEqual(placements.map(({ index, source }) => [index, source.name]),
    [[7, "last.wav"], [0, "first.wav"], [1, "second.wav"]]);
  assert.ok(sources.every(source => source.kind === "demo"),
    "staging must not mutate the live floor");
  assert.ok(Math.abs(placements[1].source.channels[0][0] - .06) < 1e-6);
  await assert.rejects(decodeLocalSources([
    file("valid.wav", 5), file("broken.wav", 13),
  ], 2, sources, OfflineDecoder), /damaged audio/);
  assert.ok(sources.every(source => source.kind === "demo"),
    "a bad second file cannot half-commit the first");
  await assert.rejects(decodeLocalSources([file("ok.wav", 5),
    { ...file("too-big.wav", 5), size: MAX_FILE_BYTES + 1 },
  ], 0, sources, OfflineDecoder), /12 MiB/);
  await assert.rejects(decodeLocalSources(Array(9).fill(file("ok.wav", 5)),
    0, sources, OfflineDecoder), /one and eight/);
  const mic = await decodeLocalSource(file("recorded.webm", 5), 3, sources, OfflineDecoder,
    { name: "Mic take 04", kind: "mic" });
  assert.equal(mic.name, "Mic take 04");
  assert.equal(mic.kind, "mic");
});
