import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpartialTracks,
  createSpartialZip,
  saveSpartialFolder,
} from "../src/instruments/spartial/spartial-recording-export.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function tag(bytes, offset, text) { bytes.set(encoder.encode(text), offset); }

function pcmCapture(channels, { extended = channels.length > 2, ancillary = false, sampleRate = 48_000 } = {}) {
  const channelCount = channels.length;
  const frames = channels[0].length;
  assert.ok(channels.every(channel => channel.length === frames));
  const format = new Uint8Array(extended ? 48 : 24);
  const view = new DataView(format.buffer);
  tag(format, 0, "fmt ");
  view.setUint32(4, format.length - 8, true);
  view.setUint16(8, extended ? 0xfffe : 1, true);
  view.setUint16(10, channelCount, true);
  view.setUint32(12, sampleRate, true);
  view.setUint32(16, sampleRate * channelCount * 3, true);
  view.setUint16(20, channelCount * 3, true);
  view.setUint16(22, 24, true);
  if (extended) {
    view.setUint16(24, 22, true);
    view.setUint16(26, 24, true);
    format.set([1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113], 32);
  }
  const dataBytes = frames * channelCount * 3;
  const data = new Uint8Array(8 + dataBytes + (dataBytes & 1));
  tag(data, 0, "data");
  new DataView(data.buffer).setUint32(4, dataBytes, true);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = channels[channel][frame];
      const offset = 8 + (frame * channelCount + channel) * 3;
      data[offset] = value & 255;
      data[offset + 1] = (value >> 8) & 255;
      data[offset + 2] = (value >> 16) & 255;
    }
  }
  const extra = new Uint8Array(ancillary ? 12 : 0);
  if (ancillary) {
    tag(extra, 0, "JUNK");
    new DataView(extra.buffer).setUint32(4, 3, true);
    extra.set([123, 45, 67], 8);
  }
  const header = new Uint8Array(12);
  tag(header, 0, "RIFF");
  new DataView(header.buffer).setUint32(4, 4 + format.length + extra.length + data.length, true);
  tag(header, 8, "WAVE");
  return { blob: new Blob([header, format, extra, data], { type: "audio/wav" }), frames, sampleRate, channelCount };
}

async function monoSamples(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(decoder.decode(bytes.subarray(0, 4)), "RIFF");
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 24);
  const dataBytes = view.getUint32(40, true);
  assert.equal(bytes.length, 44 + dataBytes + (dataBytes & 1));
  if (dataBytes & 1) assert.equal(bytes.at(-1), 0);
  return Array.from({ length: dataBytes / 3 }, (_, index) => {
    const offset = 44 + index * 3;
    const raw = bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    return raw & 0x800000 ? raw - 0x1000000 : raw;
  });
}

test("stems retain every physical channel, exact PCM24 samples, silence, and odd-frame padding", async () => {
  const samples = [
    [-8_388_608, 0, 8_388_607], [123456, -123456, -1],
    [30, 31, 32], [0, 0, 0], [50, 51, 52], [60, 61, 62], [70, 71, 72], [80, 81, 82],
  ];
  const capture = pcmCapture(samples, { ancillary: true });
  const labels = ["L", "R", "C", "LFE", "LS", "RS", "LRS", "RRS"];
  const result = await buildSpartialTracks(capture, {
    name: "SPARTIAL take.wav", layoutId: "7-4-1", layoutName: "7:4:1", omitLfe: true,
    speakers: labels.map((label, index) => ({ channel: index + 1, label, kind: index === 3 ? "lfe" : "speaker" })).reverse(),
  });
  assert.equal(result.name, "SPARTIAL-take");
  assert.deepEqual(result.files.map(file => file.name), [...labels.map((label, index) => `${String(index + 1).padStart(2, "0")}-${label}.wav`), "channel-map.txt"]);
  for (let index = 0; index < samples.length; index += 1) {
    assert.deepEqual(await monoSamples(result.files[index].blob), samples[index]);
    assert.equal(result.files[index].blob.type, "audio/wav");
  }
  const map = await result.files.at(-1).blob.text();
  assert.match(map, /Layout: 7:4:1/);
  assert.match(map, /Sample rate: 48000 Hz/);
  assert.match(map, /Frames: 3/);
  assert.match(map, /04  LFE  04-LFE.wav  \(omitted; silent\)/);
  assert.match(map, /05  LS  05-LS.wav/);
  assert.match(map, /07  LRS  07-LRS.wav/);
});

test("mono, stereo, and sixteen-channel captures preserve sample rate and synchronized frame counts", async () => {
  for (const channelCount of [1, 2, 16]) {
    const samples = Array.from({ length: channelCount }, (_, channel) => [channel + 1, -channel - 1]);
    const capture = pcmCapture(samples, { sampleRate: 44_100 });
    const result = await buildSpartialTracks(capture, { createdAt: new Date("2026-10-11T12:34:56.000Z") });
    assert.equal(result.name, "spartial-20261011T123456Z");
    assert.equal(result.files.length, channelCount + 1);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const file = result.files[channel];
      assert.deepEqual(await monoSamples(file.blob), samples[channel]);
      const header = new DataView(await file.blob.slice(0, 44).arrayBuffer());
      assert.equal(header.getUint32(24, true), 44_100);
      assert.equal(header.getUint32(28, true), 44_100 * 3);
    }
  }
});

test("stem extraction reads bounded slices and keeps continuity across chunk boundaries", async () => {
  const frames = Math.ceil(1024 * 1024 / 6) + 10;
  const samples = [Int32Array.from({ length: frames }, (_, index) => index), Int32Array.from({ length: frames }, (_, index) => -index)];
  const capture = pcmCapture(samples);
  const original = capture.blob;
  const reads = [];
  capture.blob = {
    size: original.size,
    arrayBuffer() { throw new Error("Must not read the complete capture."); },
    slice(start, end) { reads.push(end - start); return original.slice(start, end); },
  };
  const result = await buildSpartialTracks(capture);
  assert.ok(reads.every(length => length <= 1024 * 1024));
  assert.ok(reads.filter(length => length > 44).length >= 2);
  assert.deepEqual(await monoSamples(result.files[0].blob), [...samples[0]]);
  assert.deepEqual(await monoSamples(result.files[1].blob), [...samples[1]]);
});

test("malformed or mismatched captures and ambiguous channel maps fail before exporting", async () => {
  const capture = pcmCapture([[1], [2], [3]]);
  await assert.rejects(buildSpartialTracks({ ...capture, frames: 2 }), /frame count/);
  await assert.rejects(buildSpartialTracks({ ...capture, channelCount: 2 }), /matching 24-bit/);
  await assert.rejects(buildSpartialTracks({ ...capture, sampleRate: 44_100 }), /matching 24-bit/);
  await assert.rejects(buildSpartialTracks({ ...capture, blob: capture.blob.slice(0, -1) }), /incomplete/);
  await assert.rejects(buildSpartialTracks({ ...capture, blob: new Blob(["not a wave"]) }), /RIFF WAV/);
  await assert.rejects(buildSpartialTracks(capture, { speakers: [{ channel: 1 }, { channel: 1 }] }), /channel map/);
  await assert.rejects(buildSpartialTracks(capture, { speakers: [{ channel: 4 }] }), /channel map/);
  const altered = new Uint8Array(await capture.blob.arrayBuffer());
  altered[44] = 3; // IEEE float subformat is not PCM24.
  await assert.rejects(buildSpartialTracks({ ...capture, blob: new Blob([altered]) }), /matching 24-bit/);
});

function crc32(bytes) {
  let value = 0xffff_ffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (value >>> 1) ^ 0xedb8_8320 : value >>> 1;
  }
  return (value ^ 0xffff_ffff) >>> 0;
}

test("ZIP contains a named take folder, original WAV bytes, valid CRCs, and matching directory offsets", async () => {
  const tracks = await buildSpartialTracks(pcmCapture([[123], [-321]]), { name: "My take" });
  const zip = await createSpartialZip(tracks.files, tracks.name);
  assert.equal(zip.type, "application/zip");
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const entries = [];
  let offset = 0;
  for (const file of tracks.files) {
    const start = offset;
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 8, true), 0);
    const crc = view.getUint32(offset + 14, true);
    const length = view.getUint32(offset + 18, true);
    assert.equal(view.getUint32(offset + 22, true), length);
    const nameLength = view.getUint16(offset + 26, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    assert.equal(name, `My-take/${file.name}`);
    offset += 30 + nameLength;
    const content = bytes.subarray(offset, offset + length);
    assert.deepEqual(content, new Uint8Array(await file.blob.arrayBuffer()));
    assert.equal(crc, crc32(content));
    offset += length;
    entries.push({ start, crc, name, length });
  }
  const directoryStart = offset;
  for (const entry of entries) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint32(offset + 16, true), entry.crc);
    assert.equal(view.getUint32(offset + 20, true), entry.length);
    assert.equal(view.getUint32(offset + 42, true), entry.start);
    const nameLength = view.getUint16(offset + 28, true);
    assert.equal(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)), entry.name);
    offset += 46 + nameLength;
  }
  assert.equal(view.getUint32(offset, true), 0x06054b50);
  assert.equal(view.getUint16(offset + 8, true), entries.length);
  assert.equal(view.getUint32(offset + 12, true), offset - directoryStart);
  assert.equal(view.getUint32(offset + 16, true), directoryStart);
  assert.equal(offset + 22, bytes.length);
});

test("ZIP CRC generation never asks a large track for one complete ArrayBuffer", async () => {
  const file = new Blob([new Uint8Array(1024 * 1024 + 37).fill(91)]);
  const reads = [];
  file.arrayBuffer = () => { throw new Error("Must not read a complete track."); };
  const slice = file.slice.bind(file);
  file.slice = (start, end) => { reads.push(end - start); return slice(start, end); };
  const zip = await createSpartialZip([{ name: "01-S1.wav", blob: file }], "take");
  assert.ok(zip.size > file.size);
  assert.deepEqual(reads, [1024 * 1024, 37]);
});

function directory(name = "root", events = [], failure = null) {
  const children = new Map();
  return {
    kind: "directory", name, children,
    async getDirectoryHandle(childName, options) {
      if (failure?.operation === "directory") throw failure.error;
      let child = children.get(childName);
      if (child?.kind === "file") throw new DOMException("File exists.", "TypeMismatchError");
      if (!child && options?.create) { child = directory(childName, events, failure); children.set(childName, child); }
      if (!child) throw new DOMException("Missing folder.", "NotFoundError");
      return child;
    },
    async *values() { yield* children.values(); },
    async getFileHandle(filename) {
      assert.equal(children.has(filename), false, "Existing files must never be replaced.");
      const child = { kind: "file", blob: null, async createWritable() {
        return {
          async write(blob) {
            events.push(`write:${filename}`);
            if (failure?.operation === "write" && filename === failure.filename) throw failure.error;
            child.blob = blob;
          },
          async close() {
            events.push(`close:${filename}`);
            if (failure?.operation === "close" && filename === failure.filename) throw failure.error;
          },
          async abort() { events.push(`abort:${filename}`); },
        };
      } };
      children.set(filename, child);
      return child;
    },
  };
}

test("folder export skips existing directory and file names, writes every file, and awaits closes", async () => {
  const events = [];
  const root = directory("root", events);
  root.children.set("take", directory("take"));
  root.children.set("take-2", { kind: "file" });
  const files = [{ name: "01-L.wav", blob: new Blob(["left"]) }, { name: "02-R.wav", blob: new Blob(["right"]) }];
  const name = await saveSpartialFolder(root, files, "take");
  assert.equal(name, "take-3");
  assert.deepEqual(events, ["write:01-L.wav", "close:01-L.wav", "write:02-R.wav", "close:02-R.wav"]);
  assert.equal(await root.children.get(name).children.get("01-L.wav").blob.text(), "left");
  assert.equal(await root.children.get(name).children.get("02-R.wav").blob.text(), "right");
  assert.equal(root.children.get("take").children.size, 0);
});

test("folder write/close failures abort the active file and leave all take Blobs available for retry or ZIP", async () => {
  for (const operation of ["write", "close"]) {
    const events = [];
    const error = new DOMException("Storage refused the write.", "NotAllowedError");
    const root = directory("root", events, { operation, filename: "02-R.wav", error });
    const files = [{ name: "01-L.wav", blob: new Blob(["left"]) }, { name: "02-R.wav", blob: new Blob(["right"]) }];
    await assert.rejects(saveSpartialFolder(root, files, "take"), caught => caught === error);
    assert.equal(events.at(-1), "abort:02-R.wav");
    assert.deepEqual(await Promise.all(files.map(file => file.blob.text())), ["left", "right"]);
    assert.ok((await createSpartialZip(files, "take")).size > 9);
    assert.equal(await saveSpartialFolder(directory(), files, "retry"), "retry");
  }
});

test("cancelled folder access is preserved as AbortError and does not alter the capture", async () => {
  const error = new DOMException("Cancelled", "AbortError");
  const root = directory("root", [], { operation: "directory", error });
  const files = [{ name: "01-L.wav", blob: new Blob(["still here"]) }];
  await assert.rejects(saveSpartialFolder(root, files, "take"), caught => caught === error);
  assert.equal(root.children.size, 0);
  assert.equal(await files[0].blob.text(), "still here");
});

test("a permanently pending write or close and abort cannot trap folder export or consume the take", async () => {
  for (const stalled of ["write", "close"]) {
    const root = directory();
    const folder = directory();
    const events = [];
    root.getDirectoryHandle = async (name, options) => {
      if (!options?.create) throw new DOMException("Missing", "NotFoundError");
      return folder;
    };
    folder.getFileHandle = async () => ({ async createWritable() {
      return {
        async write() { events.push("write"); if (stalled === "write") await new Promise(() => {}); },
        async close() { events.push("close"); if (stalled === "close") await new Promise(() => {}); },
        async abort() { events.push("abort"); await new Promise(() => {}); },
      };
    } });
    const files = [{ name: "01-L.wav", blob: new Blob(["recoverable"]) }];
    await assert.rejects(saveSpartialFolder(root, files, "take", { timeoutMs: 10 }), /timed out.*take is still available/);
    assert.equal(events.at(-1), "abort");
    assert.equal(await files[0].blob.text(), "recoverable");
    assert.equal(await saveSpartialFolder(directory(), files, "retry"), "retry");
  }
});

test("folder lookup and writable creation time out, and a late-created writable is aborted", async () => {
  const files = [{ name: "01-L.wav", blob: new Blob(["recoverable"]) }];
  await assert.rejects(saveSpartialFolder({ getDirectoryHandle: () => new Promise(() => {}) }, files, "take", { timeoutMs: 10 }), /timed out/);
  const root = directory();
  const folder = directory();
  root.getDirectoryHandle = async (name, options) => {
    if (!options?.create) throw new DOMException("Missing", "NotFoundError");
    return folder;
  };
  let resolveWritable;
  let aborts = 0;
  folder.getFileHandle = async () => ({ createWritable: () => new Promise(resolve => { resolveWritable = resolve; }) });
  await assert.rejects(saveSpartialFolder(root, files, "take", { timeoutMs: 10 }), /timed out/);
  resolveWritable({ abort() { aborts += 1; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(aborts, 1);
  assert.equal(await files[0].blob.text(), "recoverable");
});

test("unsafe or colliding export names are rejected before touching the destination", async () => {
  const root = directory();
  for (const names of [["../outside.wav"], ["L.wav", "l.wav"], ["a/b.wav"], ["C:\\L.wav"]]) {
    const files = names.map(name => ({ name, blob: new Blob(["audio"]) }));
    await assert.rejects(createSpartialZip(files, "take"), /filenames/);
    await assert.rejects(saveSpartialFolder(root, files, "take"), /filenames/);
  }
  assert.equal(root.children.size, 0);
});
