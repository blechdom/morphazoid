import assert from "node:assert/strict";
import test from "node:test";
import { decodePcmWav } from "../src/pcm-wav-decoder.js";
import {
  ESI_BANK_MAX_BYTES,
  encodeWav,
  parseBank,
  serializeBank,
} from "../src/instruments/esi-32/esi-32-files.js";

function buffer(channels = [[-1, -.5, 0, .5, 1]], sampleRate = 44_100) {
  const data = channels.map((channel) => Float32Array.from(channel));
  return {
    numberOfChannels: data.length,
    length: data[0].length,
    sampleRate,
    getChannelData: (channel) => data[channel],
  };
}

function fixture() {
  return {
    state: {
      patches: Array.from({ length: 8 }, (_, sampleSlot) => ({ sampleSlot, rootNote: 60, start: .1, end: .9, reverse: false })),
      selectedSlot: 3,
      octave: -1,
      names: Array.from({ length: 8 }, (_, index) => `Sample ${index + 1}`),
    },
    samples: new Map(Array.from({ length: 8 }, (_, slot) => [slot, buffer()])),
  };
}

function bankObject() {
  const { state, samples } = fixture();
  return JSON.parse(serializeBank(state, samples));
}

function mutatedBank(mutate) {
  const bank = bankObject();
  mutate(bank);
  return JSON.stringify(bank);
}

function replaceWav(bank, mutate) {
  const text = atob(bank.samples[0].wav);
  const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0));
  mutate(new DataView(bytes.buffer), bytes);
  bank.samples[0].wav = btoa(String.fromCharCode(...bytes));
}

test("PCM16 export round-trips sample rate, signed endpoints and bounded quantization", () => {
  const original = buffer([[-2, -1, -.5, 0, .5, 1, 2, NaN, Infinity]], 22_050);
  const wav = encodeWav(original);
  assert.ok(wav instanceof ArrayBuffer);
  const decoded = decodePcmWav(wav);
  assert.equal(decoded.sampleRate, 22_050);
  assert.equal(decoded.bitsPerSample, 16);
  assert.equal(decoded.numberOfChannels, 1);
  assert.equal(decoded.samples.length, original.length);
  const expected = [-1, -1, -.5, 0, .5, 1, 1, 0, 0];
  decoded.samples.forEach((sample, index) => assert.ok(Math.abs(sample - expected[index]) <= 1 / 32_768));
  assert.deepEqual(encodeWav(buffer([decoded.samples], decoded.sampleRate)), wav, "repeated save/open must not erode PCM levels");
});

test("stereo PCM remains interleaved and trim/reverse applies identically to both channels", () => {
  const wav = encodeWav(buffer([[0, .25, .5, .75], [0, -.25, -.5, -.75]], 48_000), {
    start: .25, end: .75, reverse: true,
  });
  const view = new DataView(wav);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(28, true), 48_000 * 4);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([44, 46, 48, 50].map((offset) => view.getInt16(offset, true)), [16384, -16384, 8192, -8192]);
  assert.equal(decodePcmWav(wav).frameCount, 2);
});

test("WAV export rejects invalid layouts, empty selections and oversized samples before reading channels", () => {
  for (const options of [{ start: -.1 }, { end: 2 }, { start: .5, end: .5 }, { start: NaN }, { reverse: "yes" }]) {
    assert.throws(() => encodeWav(buffer(), options));
  }
  for (const override of [{ numberOfChannels: 3 }, { length: 0 }, { sampleRate: 0 }, { sampleRate: 44_100.1 }, { length: 44_100 * 61 }]) {
    assert.throws(() => encodeWav({ ...buffer(), ...override, getChannelData() { assert.fail("invalid metadata must reject before reading"); } }));
  }
  assert.throws(() => encodeWav({ ...buffer(), getChannelData: () => new Float32Array(1) }), /matching/);
});

test("banks retain all eight full samples, Unicode names, and independent parameter state", () => {
  const { state, samples } = fixture();
  state.names[0] = "Ému 🎹";
  state.patches[0].reverse = true;
  const snapshot = structuredClone(state);
  const text = serializeBank(state, samples);
  const restored = parseBank(text);
  assert.deepEqual(restored.state, snapshot);
  assert.equal(restored.samples.length, 8);
  for (const { slot, bytes } of restored.samples) {
    const decoded = decodePcmWav(bytes);
    assert.equal(decoded.frameCount, samples.get(slot).length, "bank export must retain audio beyond the trim");
    assert.equal(decoded.samples[0], -1, "reverse must remain a patch setting");
  }
  restored.state.patches[0].rootNote = 12;
  assert.deepEqual(state, snapshot);
  assert.equal(text, serializeBank(state, samples), "identical banks serialize deterministically");
});

test("bank structure rejects unsupported versions, incomplete slots and out-of-range state", () => {
  const edits = [
    (bank) => { bank.version = 999; },
    (bank) => { bank.type = "other"; },
    (bank) => { bank.unrecognized = true; },
    (bank) => { bank.state.selectedSlot = 8; },
    (bank) => { bank.state.octave = 3; },
    (bank) => { bank.state.octave = -3; },
    (bank) => { bank.state.patches.pop(); },
    (bank) => { bank.state.names.pop(); },
    (bank) => { bank.state.names[0] = ""; },
    (bank) => { bank.state.names[0] = "a".repeat(97); },
    (bank) => { bank.state.names[0] = "bad\nname"; },
    (bank) => { bank.samples.pop(); },
    (bank) => { bank.samples.push(bank.samples[0]); },
    (bank) => { bank.samples[0].slot = 8; },
    (bank) => { bank.samples[0].slot = 1; },
  ];
  for (const edit of edits) assert.throws(() => parseBank(mutatedBank(edit)), /Invalid ESI-32 bank/);
  const { state, samples } = fixture();
  samples.delete(7);
  assert.throws(() => serializeBank(state, samples), /eight sample/);
  for (const text of ["null", "[]", "{", "true", "undefined"]) assert.throws(() => parseBank(text));
  assert.throws(() => parseBank(new Uint8Array()), /JSON text/);
});

test("untrusted patch data cannot install prototype properties, functions, infinities or excessive nesting", () => {
  const text = JSON.stringify(bankObject());
  assert.throws(() => parseBank(text.replace('"rootNote":60', '"__proto__":{"polluted":true}')), /unsupported patch/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => parseBank(text.replace('"rootNote":60', '"constructor":{"prototype":{"polluted":true}}')), /unsupported patch/);
  assert.throws(() => parseBank(text.replace('"rootNote":60', '"rootNote":1e400')), /finite/);
  assert.throws(() => parseBank(mutatedBank((bank) => { bank.state.patches[0] = { x: { x: { x: { x: { x: { x: { x: {} } } } } } } }; })), /complex/);
  assert.throws(() => parseBank(mutatedBank((bank) => { bank.state.patches[0] = { x: new Array(65).fill(0) }; })), /array/);
  const { state, samples } = fixture();
  state.patches[0].fn = () => 1;
  assert.throws(() => serializeBank(state, samples), /plain object/);
});

test("bank limits count UTF-8 bytes and reject oversized text before JSON parsing", () => {
  assert.throws(() => parseBank(" ".repeat(ESI_BANK_MAX_BYTES + 1)), /48 MiB/);
  assert.throws(() => parseBank("\u0800".repeat(Math.floor(ESI_BANK_MAX_BYTES / 3) + 1)), /48 MiB/);
});

test("save preflights the combined sample budget before allocating WAV or reading samples", () => {
  const { state, samples } = fixture();
  for (let slot = 0; slot < 8; slot += 1) {
    samples.set(slot, { ...buffer(), length: 44_100 * 60, getChannelData() { assert.fail("budget must reject before reading"); } });
  }
  assert.throws(() => serializeBank(state, samples), /32 MiB/);
});

test("corrupt base64, non-WAV input and malformed PCM headers are rejected", () => {
  for (const wav of ["", "!!!!", "AAAA", "YWJj ZA==", "data:audio/wav;base64,AAAA"]) {
    assert.throws(() => parseBank(mutatedBank((bank) => { bank.samples[0].wav = wav; })));
  }
  const edits = [
    (view) => view.setUint32(0, 0),
    (view) => view.setUint32(4, 1, true),
    (view) => view.setUint32(16, 1_000, true),
    (view) => view.setUint16(20, 3, true),
    (view) => view.setUint16(22, 0, true),
    (view) => view.setUint32(24, 0, true),
    (view) => view.setUint32(28, 1, true),
    (view) => view.setUint16(32, 1, true),
    (view) => view.setUint16(34, 32, true),
    (view) => view.setUint32(40, 1, true),
    (view) => view.setUint32(40, 0, true),
    (view) => view.setUint32(36, 0),
  ];
  for (const edit of edits) assert.throws(() => parseBank(mutatedBank((bank) => replaceWav(bank, edit))));
});

test("a bad late sample does not mutate the supplied state or return a partial bank", () => {
  const { state, samples } = fixture();
  const original = structuredClone(state);
  const bank = JSON.parse(serializeBank(state, samples));
  bank.samples[7].wav = "AAAA";
  assert.throws(() => parseBank(JSON.stringify(bank)));
  assert.deepEqual(state, original);
  assert.equal(samples.size, 8);
});
