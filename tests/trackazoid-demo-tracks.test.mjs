import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DEMO_TRACKS, createDemoFile, createDemoWav } from "../src/instruments/trackazoid/demo-tracks.js";

const hash = (bytes) => createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const renders = new Map(DEMO_TRACKS.map((track) => [track.id, createDemoWav(track.id)]));

function inspect(track, bytes) {
  const view = new DataView(bytes), frames = (bytes.byteLength - 44) / 4;
  let energy = 0, sideEnergy = 0, peak = 0, mean = 0, changes = 0, previous = 0;
  const bars = Array(track.beats / 4).fill(0), barCounts = bars.map(() => 0);
  const profile = Array(16).fill(0), profileCounts = profile.map(() => 0);
  for (let i = 0; i < frames; i++) {
    const left = view.getInt16(44 + i * 4, true) / 32768, right = view.getInt16(46 + i * 4, true) / 32768;
    const mid = (left + right) / 2, beat = i / 24000 * track.bpm / 60;
    energy += (left * left + right * right) / 2; sideEnergy += (left - right) ** 2;
    peak = Math.max(peak, Math.abs(left), Math.abs(right)); mean += mid;
    changes += (mid - previous) ** 2; previous = mid;
    const bar = Math.min(bars.length - 1, Math.floor(beat / 4)), eighth = Math.floor(beat * 2) % 16;
    bars[bar] += mid * mid; barCounts[bar]++;
    profile[eighth] += mid * mid; profileCounts[eighth]++;
  }
  return { frames, peak, rms: Math.sqrt(energy / frames), stereoRms: Math.sqrt(sideEnergy / frames), mean: mean / frames,
    brightness: Math.sqrt(changes / energy), bars: bars.map((value, i) => Math.sqrt(value / barCounts[i])),
    profile: profile.map((value, i) => Math.sqrt(value / profileCounts[i])) };
}

test("six immutable named demos expose honest tempos, integer bars and a zero beat anchor", () => {
  assert.equal(DEMO_TRACKS.length, 6);
  assert.equal(new Set(DEMO_TRACKS.map(({ id }) => id)).size, 6);
  assert.equal(new Set(DEMO_TRACKS.map(({ name }) => name)).size, 6);
  assert.deepEqual(DEMO_TRACKS.map(({ bpm }) => bpm), [120, 126, 110, 90, 116, 174]);
  assert.ok(Object.isFrozen(DEMO_TRACKS));
  for (const track of DEMO_TRACKS) {
    assert.ok(Object.isFrozen(track)); assert.ok(track.name && track.description);
    assert.ok([32, 64].includes(track.beats)); assert.equal(track.beatOffset, 0);
  }
  for (const id of ["", "missing", null, undefined, 0, {}]) {
    assert.throws(() => createDemoWav(id), RangeError);
    assert.throws(() => createDemoFile(id), RangeError);
  }
});

test("every demo is a bounded stereo PCM WAV with exact declared tempo duration", () => {
  const decoder = new TextDecoder();
  for (const track of DEMO_TRACKS) {
    const bytes = renders.get(track.id), view = new DataView(bytes);
    const text = (from, to) => decoder.decode(bytes.slice(from, to));
    assert.equal(text(0, 4), "RIFF"); assert.equal(text(8, 16), "WAVEfmt "); assert.equal(text(36, 40), "data");
    assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
    assert.equal(view.getUint32(16, true), 16); assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(24, true), 24000);
    assert.equal(view.getUint32(28, true), 96000); assert.equal(view.getUint16(32, true), 4); assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(40, true), bytes.byteLength - 44);
    const frames = (bytes.byteLength - 44) / 4, seconds = frames / 24000;
    assert.equal(frames, Math.ceil(track.beats * 60 / track.bpm * 24000));
    assert.ok(seconds > 15 && seconds <= 35, `${track.id}: ${seconds} seconds`);
    assert.ok(bytes.byteLength < 3.4 * 1024 * 1024);
  }
});

test("all bars contain moderate unclipped signal with stereo detail and quiet file edges", () => {
  for (const track of DEMO_TRACKS) {
    const bytes = renders.get(track.id), stats = inspect(track, bytes), view = new DataView(bytes);
    assert.ok(stats.peak > 0.2 && stats.peak < 0.8, `${track.id}: peak ${stats.peak}`);
    assert.ok(stats.rms > 0.025 && stats.rms < 0.15, `${track.id}: RMS ${stats.rms}`);
    assert.ok(stats.stereoRms > 0.001 && stats.stereoRms < 0.05, `${track.id}: stereo ${stats.stereoRms}`);
    assert.ok(Math.abs(stats.mean) < 0.002, `${track.id}: DC ${stats.mean}`);
    assert.ok(stats.bars.every((rms) => rms > 0.025), `${track.id}: no silent bars`);
    assert.equal(view.getInt16(44, true), 0); assert.equal(view.getInt16(46, true), 0);
    assert.ok(Math.abs(view.getInt16(bytes.byteLength - 4, true)) < 100);
    assert.ok(Math.abs(view.getInt16(bytes.byteLength - 2, true)) < 100);
  }
});

test("new demos differ in beat-normalized groove and measured timbre, beyond a tempo change", () => {
  const tracks = DEMO_TRACKS.slice(2).map((track) => ({ ...track, ...inspect(track, renders.get(track.id)) }));
  const normalized = (values) => { const mean = values.reduce((a, b) => a + b) / values.length; return values.map((value) => value / mean); };
  for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
    const a = normalized(tracks[i].profile), b = normalized(tracks[j].profile);
    const difference = Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) / a.length);
    assert.ok(difference > 0.2, `${tracks[i].id} / ${tracks[j].id}: groove difference ${difference}`);
  }
  assert.ok(tracks[3].brightness > tracks[1].brightness * 1.2, "Rolling drum & bass has more high-frequency motion than downtempo");
  assert.ok(tracks[1].rms < tracks[3].rms * 0.7, "The spacious arrangement has a distinct density");
});

test("rendering is repeatable, returns fresh buffers, and preserves original demo bytes", async () => {
  const originalHashes = [
    "7f4c96cf7996a66c59cfd4fd708033fcef60db4577f54dd40f824c9ad34e05fa",
    "20ca1786fde480621466c6c9eee526873d12763b7a479481ba11592c301e9abe",
  ];
  for (const [index, track] of DEMO_TRACKS.entries()) {
    const original = renders.get(track.id), next = createDemoWav(track.id);
    assert.notEqual(original, next); assert.equal(hash(original), hash(next));
    new Uint8Array(next)[44] = 99;
    assert.equal(new Uint8Array(original)[44], 0, "Callers cannot alter another render");
    if (index < 2) assert.equal(hash(original), originalHashes[index], "Initial release PCM identity is retained");
    const file = createDemoFile(track.id);
    assert.equal(file.name, `${track.name} — ${track.bpm} BPM.wav`);
    assert.equal(file.type, "audio/wav"); assert.equal(file.lastModified, 1); assert.equal(file.size, original.byteLength);
    assert.equal(hash(await file.arrayBuffer()), hash(original));
  }
});
