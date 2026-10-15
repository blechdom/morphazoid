const READ_BYTES = 1024 * 1024;
const MAX_UINT32 = 0xffff_ffff;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function ascii(bytes, offset, length) {
  return decoder.decode(bytes.subarray(offset, offset + length));
}

function tag(bytes, offset, value) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function safeName(value, fallback) {
  return String(value || "").normalize("NFKD")
    .replace(/\.(?:wav|zip)$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "").slice(0, 100) || fallback;
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid recording date.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function requireBlob(blob) {
  if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0 || typeof blob.slice !== "function") {
    throw new TypeError("The recorded audio is unavailable.");
  }
}

async function readBytes(blob, offset, length) {
  return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}

async function pcmData(capture) {
  const { blob, frames, sampleRate, channelCount } = capture;
  requireBlob(blob);
  if (!Number.isSafeInteger(frames) || frames < 0
    || !Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32
    || !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 768_000) {
    throw new Error("Invalid recording format.");
  }
  const header = await readBytes(blob, 0, 12);
  if (header.length !== 12 || ascii(header, 0, 4) !== "RIFF" || ascii(header, 8, 4) !== "WAVE") {
    throw new Error("The recording is not a RIFF WAV file.");
  }
  const end = new DataView(header.buffer).getUint32(4, true) + 8;
  if (end > blob.size || end < 12) throw new Error("The recording WAV is incomplete.");
  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= end;) {
    const chunk = await readBytes(blob, offset, 8);
    const length = new DataView(chunk.buffer).getUint32(4, true);
    const start = offset + 8;
    if (start + length + (length & 1) > end) throw new Error("The recording WAV contains a truncated chunk.");
    const id = ascii(chunk, 0, 4);
    if (id === "fmt ") {
      if (format || length < 16) throw new Error("The recording WAV has an invalid format chunk.");
      const bytes = await readBytes(blob, start, Math.min(40, length));
      const view = new DataView(bytes.buffer);
      const encoding = view.getUint16(0, true);
      const extendedPcm = encoding === 0xfffe && length >= 40
        && view.getUint16(16, true) >= 22 && view.getUint16(18, true) === 24
        && view.getUint32(24, true) === 1 && view.getUint32(28, true) === 0x0010_0000
        && view.getUint32(32, true) === 0xaa00_0080 && view.getUint32(36, true) === 0x719b_3800;
      format = (encoding === 1 || extendedPcm)
        && view.getUint16(2, true) === channelCount && view.getUint32(4, true) === sampleRate
        && view.getUint32(8, true) === sampleRate * channelCount * 3
        && view.getUint16(12, true) === channelCount * 3 && view.getUint16(14, true) === 24;
      if (!format) throw new Error("The recording must contain matching 24-bit PCM channels.");
    } else if (id === "data") {
      if (data) throw new Error("The recording contains multiple audio data chunks.");
      data = { offset: start, length };
    }
    offset = start + length + (length & 1);
  }
  if (!format || !data || data.length !== frames * channelCount * 3) {
    throw new Error("The recording frame count does not match its audio data.");
  }
  return data;
}

function monoHeader(sampleRate, frames) {
  const dataBytes = frames * 3;
  if (dataBytes + 36 + (dataBytes & 1) > MAX_UINT32) throw new Error("This track exceeds the WAV size limit.");
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  tag(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes + (dataBytes & 1), true);
  tag(bytes, 8, "WAVE");
  tag(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 3, true);
  view.setUint16(32, 3, true);
  view.setUint16(34, 24, true);
  tag(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** Split a physical-channel capture into sample-aligned mono WAV files. */
export async function buildSpartialTracks(capture, metadata = {}) {
  const data = await pcmData(capture);
  const { blob, frames, sampleRate, channelCount } = capture;
  const namePrefix = safeName(metadata.namePrefix, 'spartial');
  const name = safeName(metadata.name, `${namePrefix}-${timestamp(metadata.createdAt)}`);
  const instrumentName = String(metadata.instrumentName || 'SPARTIAL').replace(/[\r\n]+/g, ' ');
  const speakers = new Map();
  for (const speaker of metadata.speakers ?? []) {
    if (!Number.isInteger(speaker.channel) || speaker.channel < 1 || speaker.channel > channelCount || speakers.has(speaker.channel)) {
      throw new Error("The recording channel map is invalid.");
    }
    speakers.set(speaker.channel, speaker);
  }
  const parts = Array.from({ length: channelCount }, () => [monoHeader(sampleRate, frames)]);
  const blockAlign = channelCount * 3;
  const chunkBytes = Math.floor(READ_BYTES / blockAlign) * blockAlign;
  // Only one bounded block of input and its deinterleaved bytes live in JS at a
  // time. Blob parts keep the complete take out of a single large ArrayBuffer.
  for (let offset = 0; offset < data.length; offset += chunkBytes) {
    const input = await readBytes(blob, data.offset + offset, Math.min(chunkBytes, data.length - offset));
    for (let channel = 0; channel < channelCount; channel += 1) {
      const output = new Uint8Array(input.length / channelCount);
      for (let source = channel * 3, target = 0; source < input.length; source += blockAlign, target += 3) {
        output[target] = input[source];
        output[target + 1] = input[source + 1];
        output[target + 2] = input[source + 2];
      }
      parts[channel].push(new Blob([output]));
    }
  }
  const lines = [
    `Morphazoid ${instrumentName} multitrack recording`,
    `Take: ${name}`,
    `Layout: ${metadata.layoutName || metadata.layoutId || "Custom"}`,
    `Layout ID: ${metadata.layoutId || "custom"}`,
    `Sample rate: ${sampleRate} Hz`,
    `Frames: ${frames}`,
    `Duration: ${(frames / sampleRate).toFixed(6)} s`,
    "Format: 24-bit PCM; one synchronized mono WAV per physical output",
    "Tap point: post-spatial output and master volume, before stereo preview or device processing",
    `Omit LFE: ${metadata.omitLfe ? "on; the LFE output remains a silent track" : "off"}`,
    "Import all tracks at the same start time; do not normalize them separately.",
    "",
    "Physical channel map:",
  ];
  const files = parts.map((channelParts, index) => {
    const speaker = speakers.get(index + 1);
    const label = String(speaker?.label || `S${index + 1}`).replace(/[\r\n]+/g, " ");
    const number = String(index + 1).padStart(2, "0");
    const filename = `${number}-${safeName(label, `S${index + 1}`)}.wav`;
    lines.push(`${number}  ${label}  ${filename}${metadata.omitLfe && speaker?.kind === "lfe" ? "  (omitted; silent)" : ""}`);
    if ((frames * 3) & 1) channelParts.push(new Uint8Array(1));
    return { name: filename, blob: new Blob(channelParts, { type: "audio/wav" }) };
  });
  files.push({ name: "channel-map.txt", blob: new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" }) });
  return { name, files };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

async function blobCrc32(blob) {
  let crc = MAX_UINT32;
  for (let offset = 0; offset < blob.size; offset += READ_BYTES) {
    const bytes = await readBytes(blob, offset, Math.min(READ_BYTES, blob.size - offset));
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  }
  return (crc ^ MAX_UINT32) >>> 0;
}

function exportFiles(files) {
  const entries = Array.from(files ?? []);
  const names = new Set();
  if (!entries.length || entries.length > 65_535) throw new Error("Invalid number of recording files.");
  for (const file of entries) {
    if (!file.name || /[\\/:\x00-\x1f]/.test(file.name) || file.name === "." || file.name === ".." || names.has(file.name.toLowerCase())) {
      throw new Error("Recording filenames must be distinct names without folder paths.");
    }
    names.add(file.name.toLowerCase());
    requireBlob(file.blob);
  }
  return entries;
}

/** A stored ZIP assembles Blob references instead of copying the entire take. */
export async function createSpartialZip(files, folderName) {
  const entries = exportFiles(files);
  const folder = safeName(folderName, "spartial-recording");
  const local = [];
  const central = [];
  let offset = 0;
  let centralBytes = 0;
  for (const file of entries) {
    const name = encoder.encode(`${folder}/${file.name}`);
    if (name.length > 65_535 || file.blob.size > MAX_UINT32 || offset > MAX_UINT32) throw new Error("This take exceeds the ZIP size limit.");
    const crc = await blobCrc32(file.blob);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x0403_4b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(12, 33, true); // 1980-01-01; the take name carries its timestamp.
    view.setUint32(14, crc, true);
    view.setUint32(18, file.blob.size, true);
    view.setUint32(22, file.blob.size, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    local.push(header, file.blob);
    const directory = new Uint8Array(46 + name.length);
    const entry = new DataView(directory.buffer);
    entry.setUint32(0, 0x0201_4b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 33, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.blob.size, true);
    entry.setUint32(24, file.blob.size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    centralBytes += directory.length;
    offset += header.length + file.blob.size;
  }
  if (offset + centralBytes + 22 > MAX_UINT32) throw new Error("This take exceeds the ZIP size limit.");
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x0605_4b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, centralBytes, true);
  view.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: "application/zip" });
}

function abortWritable(writable) {
  try { void Promise.resolve(writable?.abort?.()).catch(() => {}); } catch { /* Keep the original failure. */ }
}

async function folderOperation(operation, timeoutMs, onLateResult) {
  let timer;
  let timedOut = false;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).then(value => {
        if (timedOut) onLateResult?.(value);
        return value;
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("Saving the recording timed out. The take is still available; retry or download ZIP."));
        }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Save into a fresh child folder; failures never consume or modify the take. */
export async function saveSpartialFolder(directoryHandle, files, folderName, { timeoutMs = 15_000 } = {}) {
  const entries = exportFiles(files);
  if (typeof directoryHandle?.getDirectoryHandle !== "function") throw new Error("Choose a writable recording folder.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid folder save timeout.");
  const run = (operation, onLateResult) => folderOperation(operation, timeoutMs, onLateResult);
  const base = safeName(folderName, "spartial-recording");
  let folder;
  let name;
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    name = suffix === 1 ? base : `${base}-${suffix}`;
    try {
      await run(() => directoryHandle.getDirectoryHandle(name));
      continue;
    } catch (error) {
      if (error?.name === "TypeMismatchError") continue; // An existing file also occupies this name.
      if (error?.name !== "NotFoundError") throw error;
    }
    folder = await run(() => directoryHandle.getDirectoryHandle(name, { create: true }));
    // Creation has no exclusive flag. Recheck before writing in case another
    // actor created/populated this folder after the lookup above.
    const occupied = await run(async () => {
      for await (const unused of folder.values()) { void unused; return true; }
      return false;
    });
    if (!occupied) break;
    folder = null;
  }
  if (!folder) throw new Error("Could not create a new recording folder.");
  for (const file of entries) {
    let writable;
    try {
      const handle = await run(() => folder.getFileHandle(file.name, { create: true }));
      writable = await run(() => handle.createWritable(), abortWritable);
      await run(() => writable.write(file.blob));
      await run(() => writable.close());
    } catch (error) {
      // A broken filesystem may also leave abort pending. Recovery must still
      // release the UI so the unchanged take can be downloaded or saved again.
      abortWritable(writable);
      throw error;
    }
  }
  return name;
}
