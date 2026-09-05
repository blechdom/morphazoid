import assert from "node:assert/strict";
import test from "node:test";

import { decodePcmWav } from "../src/pcm-wav-decoder.js";

function chunk(id, payload, includePadding = true) {
  const padding = includePadding && payload.length % 2 ? 1 : 0;
  const output = Buffer.alloc(8 + payload.length + padding);
  output.write(id, 0, 4, "ascii");
  output.writeUInt32LE(payload.length, 4);
  payload.copy(output, 8);
  return output;
}

function formatPayload({
  tag = 1,
  channels = 1,
  sampleRate = 48_000,
  bits = 16,
  blockAlign = channels * bits / 8,
  byteRate = sampleRate * blockAlign,
  validBits = bits,
  channelMask = 0,
  subtype = null,
  extensionSize = 22,
  corruptGuid = false,
} = {}) {
  const extensible = tag === 0xfffe;
  const payload = Buffer.alloc(extensible ? 40 : 16);
  payload.writeUInt16LE(tag, 0);
  payload.writeUInt16LE(channels, 2);
  payload.writeUInt32LE(sampleRate, 4);
  payload.writeUInt32LE(byteRate, 8);
  payload.writeUInt16LE(blockAlign, 12);
  payload.writeUInt16LE(bits, 14);
  if (extensible) {
    payload.writeUInt16LE(extensionSize, 16);
    payload.writeUInt16LE(validBits, 18);
    payload.writeUInt32LE(channelMask, 20);
    payload.writeUInt32LE(subtype ?? 1, 24);
    payload.writeUInt16LE(0, 28);
    payload.writeUInt16LE(0x0010, 30);
    Buffer.from([0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, corruptGuid ? 0x70 : 0x71])
      .copy(payload, 32);
  }
  return payload;
}

function wave(chunks, { riff = "RIFF", form = "WAVE", declaredSize = null } = {}) {
  const body = Buffer.concat([Buffer.from(form, "ascii"), ...chunks]);
  const output = Buffer.alloc(8 + body.length);
  output.write(riff, 0, 4, "ascii");
  output.writeUInt32LE(declaredSize ?? body.length, 4);
  body.copy(output, 8);
  return output;
}

function pcm16(values) {
  const output = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => output.writeInt16LE(value, index * 2));
  return output;
}

function pcm24(values) {
  const output = Buffer.alloc(values.length * 3);
  values.forEach((value, index) => {
    const unsigned = value < 0 ? value + 0x1000000 : value;
    output.writeUIntLE(unsigned, index * 3, 3);
  });
  return output;
}

function pcm32(values) {
  const output = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => output.writeInt32LE(value, index * 4));
  return output;
}

function floats(values, bits) {
  const bytes = bits / 8;
  const output = Buffer.alloc(values.length * bytes);
  values.forEach((value, index) => {
    if (bits === 32) output.writeFloatLE(value, index * bytes);
    else output.writeDoubleLE(value, index * bytes);
  });
  return output;
}

function decode({ fmt = {}, data, chunks = null }) {
  return decodePcmWav(wave(chunks ?? [
    chunk("fmt ", formatPayload(fmt)),
    chunk("data", data),
  ]));
}

function assertSamples(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `sample ${index}: expected ${expected[index]}, received ${actual[index]}`,
    );
  }
}

test("decodes unsigned PCM8 and signed PCM16/24/32 at the original sample rate", () => {
  const cases = [
    { bits: 8, data: Buffer.from([0, 128, 255]), expected: [-1, 0, 127 / 128] },
    { bits: 16, data: pcm16([-32768, -1, 0, 32767]), expected: [-1, -1 / 32768, 0, 32767 / 32768] },
    { bits: 24, data: pcm24([-8388608, -1, 0, 8388607]), expected: [-1, -1 / 8388608, 0, 8388607 / 8388608] },
    { bits: 32, data: pcm32([-2147483648, -1, 0, 2147483647]), expected: [-1, -1 / 2147483648, 0, 2147483647 / 2147483648] },
  ];
  for (const fixture of cases) {
    const sampleRate = 22_000 + fixture.bits;
    const result = decode({
      fmt: { bits: fixture.bits, sampleRate },
      data: fixture.data,
    });
    assertSamples(result.samples, fixture.expected);
    assert.equal(result.sampleRate, sampleRate);
    assert.equal(result.encoding, "pcm");
    assert.equal(result.bitsPerSample, fixture.bits);
    assert.equal(result.validBitsPerSample, fixture.bits);
    assert.equal(result.frameCount, fixture.expected.length);
    assert.equal(result.durationSeconds, fixture.expected.length / sampleRate);
  }
});

test("decodes IEEE float32 and float64 without normalizing finite samples", () => {
  for (const bits of [32, 64]) {
    const expected = [-1.25, -0.125, 0, 0.75, 1.5];
    const result = decode({
      fmt: { tag: 3, bits },
      data: floats(expected, bits),
    });
    assertSamples(result.samples, expected);
    assert.equal(result.encoding, "ieee-float");
  }
});

test("selects the strongest-RMS channel instead of phase-cancelling a multichannel file", () => {
  const interleaved = pcm16([
    1_000, 20_000,
    -1_000, -20_000,
    500, 10_000,
    -500, -10_000,
  ]);
  const result = decode({
    fmt: { channels: 2, bits: 16 },
    data: interleaved,
  });
  assert.equal(result.numberOfChannels, 2);
  assert.equal(result.selectedChannelIndex, 1);
  assert.equal(result.channelRms.length, 2);
  assert.ok(result.channelRms[1] > result.channelRms[0] * 10);
  assertSamples(result.samples, [20_000, -20_000, 10_000, -10_000].map((value) => value / 32768));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.channelRms), true);
});

test("uses the first channel for an exact RMS tie", () => {
  const result = decode({
    fmt: { channels: 2, bits: 16 },
    data: pcm16([4_000, -4_000, 2_000, -2_000]),
  });
  assert.equal(result.selectedChannelIndex, 0);
  assertSamples(result.samples, [4_000 / 32768, 2_000 / 32768]);
});

test("honors RIFF padding, unknown chunks, data-before-fmt, and multiple data chunks", () => {
  const fmt = chunk("fmt ", formatPayload({ bits: 8, sampleRate: 8_000 }));
  const bytes = wave([
    chunk("JUNK", Buffer.from([9, 8, 7])),
    chunk("data", Buffer.from([0, 64, 128])),
    fmt,
    chunk("LIST", Buffer.from([1])),
    chunk("data", Buffer.from([192, 255])),
  ]);
  const wrapped = Buffer.concat([Buffer.from([4, 3, 2, 1]), bytes, Buffer.from([8, 9])]);
  const view = new Uint8Array(wrapped.buffer, wrapped.byteOffset + 4, bytes.length);
  const result = decodePcmWav(view);
  assertSamples(result.samples, [-1, -0.5, 0, 0.5, 127 / 128]);
  assert.equal(result.sampleRate, 8_000);
  assert.equal(result.dataByteLength, 5);
});

test("decodes WAVE_FORMAT_EXTENSIBLE PCM with left-aligned valid bits", () => {
  const result = decode({
    fmt: {
      tag: 0xfffe,
      subtype: 1,
      bits: 32,
      validBits: 24,
      channelMask: 0x4,
    },
    data: pcm32([-2147483648, 1073741824, 2147483392]),
  });
  assertSamples(result.samples, [-1, 0.5, 8388607 / 8388608]);
  assert.equal(result.extensible, true);
  assert.equal(result.sourceFormatTag, 0xfffe);
  assert.equal(result.validBitsPerSample, 24);
  assert.equal(result.channelMask, 0x4);
});

test("decodes WAVE_FORMAT_EXTENSIBLE IEEE float", () => {
  const expected = [-0.75, 0.25, 1.125];
  const result = decode({
    fmt: { tag: 0xfffe, subtype: 3, bits: 64, validBits: 64, channelMask: 0x3 },
    data: floats(expected, 64),
  });
  assertSamples(result.samples, expected);
  assert.equal(result.extensible, true);
  assert.equal(result.encoding, "ieee-float");
});

test("rejects invalid containers, chunk bounds, and missing required chunks", () => {
  assert.throws(() => decodePcmWav({}), /requires an ArrayBuffer/);
  assert.throws(() => decodePcmWav(Buffer.alloc(11)), /shorter than a RIFF/);
  assert.throws(() => decodePcmWav(wave([], { riff: "RIFX" })), /little-endian RIFF/);
  assert.throws(() => decodePcmWav(wave([], { form: "AVI " })), /not WAVE/);
  assert.throws(() => decodePcmWav(wave([], { declaredSize: 1000 })), /extends beyond/);
  assert.throws(() => decodePcmWav(wave([chunk("data", pcm16([0]))])), /missing fmt/);
  assert.throws(() => decodePcmWav(wave([chunk("fmt ", formatPayload())])), /missing data/);
  assert.throws(
    () => decodePcmWav(wave([
      chunk("fmt ", formatPayload()),
      chunk("data", Buffer.from([128]), false),
    ])),
    /missing its pad byte/,
  );
});

test("rejects unsupported or internally inconsistent format metadata", () => {
  const invalidFormats = [
    [{ tag: 6 }, /unsupported format tag/],
    [{ bits: 12, blockAlign: 2, byteRate: 96_000 }, /12-bit samples/],
    [{ channels: 0, blockAlign: 0, byteRate: 0 }, /channel count/],
    [{ sampleRate: 0, byteRate: 0 }, /sample rate/],
    [{ blockAlign: 3, byteRate: 144_000 }, /block alignment/],
    [{ byteRate: 1 }, /byte rate/],
    [{ tag: 0xfffe, bits: 16, validBits: 17 }, /valid bits/],
    [{ tag: 0xfffe, subtype: 3, bits: 64, validBits: 32 }, /float valid bits/],
    [{ tag: 0xfffe, extensionSize: 2 }, /extension size/],
    [{ tag: 0xfffe, corruptGuid: true }, /subformat GUID/],
    [{ tag: 0xfffe, subtype: 7 }, /unsupported format tag/],
  ];
  for (const [fmt, message] of invalidFormats) {
    assert.throws(() => decode({ fmt, data: pcm16([0, 0]) }), message);
  }
  assert.throws(
    () => decode({ fmt: { channels: 2, bits: 16 }, data: Buffer.alloc(3) }),
    /inside an interleaved sample frame/,
  );
});

test("rejects non-finite float samples and duplicate format chunks", () => {
  assert.throws(
    () => decode({ fmt: { tag: 3, bits: 32 }, data: floats([0, Number.NaN], 32) }),
    /NaN or infinity/,
  );
  assert.throws(
    () => decodePcmWav(wave([
      chunk("fmt ", formatPayload()),
      chunk("fmt ", formatPayload()),
      chunk("data", pcm16([0])),
    ])),
    /multiple fmt chunks/,
  );
});
