export const ESI_BANK_TYPE = "morphazoid-esi-32";
export const ESI_BANK_VERSION = 1;
export const ESI_BANK_MAX_BYTES = 48 * 1024 * 1024;
export const ESI_BANK_MAX_SAMPLE_BYTES = 32 * 1024 * 1024;
const SLOT_COUNT = 8;
const MAX_PATCH_FIELDS = 256;
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);

function invalid(message) {
  throw new RangeError(`Invalid ESI-32 bank: ${message}`);
}

function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

// Count UTF-8 without allocating a second copy of an untrusted bank string.
function checkTextSize(text) {
  if (typeof text !== "string") throw new TypeError("An ESI-32 bank must be JSON text.");
  if (text.length > ESI_BANK_MAX_BYTES) invalid("file exceeds the 48 MiB limit.");
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > ESI_BANK_MAX_BYTES) invalid("file exceeds the 48 MiB limit.");
  }
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid(`${label} must be a plain object.`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  if (Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) invalid(`${label} has unsupported fields.`);
}

// Patches remain model-owned. This boundary permits bounded JSON data only;
// the caller applies its musical parameter normalization before committing it.
function copyPatch(value) {
  plainObject(value, "patch");
  let fieldCount = 0;
  function copy(item, depth) {
    fieldCount += 1;
    if (depth > 6 || fieldCount > MAX_PATCH_FIELDS) invalid("patch is too complex.");
    if (typeof item === "boolean" || item === null) return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item) || Math.abs(item) > 1e9) invalid("patch numbers must be finite and bounded.");
      return item;
    }
    if (typeof item === "string") {
      if (item.length > 256) invalid("patch text is too long.");
      return item;
    }
    if (Array.isArray(item)) {
      if (item.length > 64) invalid("patch array is too long.");
      return Array.from(item, (entry) => copy(entry, depth + 1));
    }
    plainObject(item, "patch value");
    const output = {};
    for (const [key, entry] of Object.entries(item)) {
      if (unsafeKeys.has(key) || key.length > 64) invalid("unsupported patch field.");
      output[key] = copy(entry, depth + 1);
    }
    return output;
  }
  return copy(value, 0);
}

function copyState(state) {
  exactKeys(state, ["patches", "selectedSlot", "octave", "names"], "state");
  if (!Array.isArray(state.patches) || state.patches.length !== SLOT_COUNT) {
    invalid("exactly eight patches are required.");
  }
  if (!Array.isArray(state.names) || state.names.length !== SLOT_COUNT) {
    invalid("exactly eight sample names are required.");
  }
  return {
    patches: Array.from(state.patches, copyPatch),
    selectedSlot: integer(state.selectedSlot, 0, SLOT_COUNT - 1, "selected slot"),
    octave: integer(state.octave, -2, 2, "octave"),
    names: Array.from(state.names, (name) => {
      if (typeof name !== "string" || !name.trim() || name.length > 96 || /[\u0000-\u001f\u007f]/u.test(name)) {
        invalid("sample names must contain 1–96 printable characters.");
      }
      return name;
    }),
  };
}

function sampleLayout(buffer) {
  if (!buffer || typeof buffer.getChannelData !== "function") {
    throw new TypeError("WAV export requires an AudioBuffer-compatible sample.");
  }
  const channels = integer(buffer.numberOfChannels, 1, 2, "sample channel count");
  const rate = integer(buffer.sampleRate, 8_000, 192_000, "sample rate");
  const frames = integer(buffer.length, 1, rate * 60, "sample frames (maximum 60 seconds)");
  return { channels, rate, frames, bytes: 44 + frames * channels * 2 };
}

function writeFourCC(view, offset, text) {
  for (let index = 0; index < 4; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

/** Export normalized [start, end) trim bounds to interleaved, 16-bit PCM WAV. */
export function encodeWav(buffer, { start = 0, end = 1, reverse = false } = {}) {
  const { channels, rate, frames } = sampleLayout(buffer);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || start >= end) {
    throw new RangeError("WAV trim bounds must satisfy 0 ≤ start < end ≤ 1.");
  }
  if (typeof reverse !== "boolean") throw new TypeError("WAV reverse must be a boolean.");
  const first = Math.floor(start * frames);
  const last = Math.ceil(end * frames);
  const count = last - first;
  const dataBytes = count * channels * 2;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);
  writeFourCC(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeFourCC(view, 8, "WAVE");
  writeFourCC(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeFourCC(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    if (!(data instanceof Float32Array) || data.length !== frames) {
      throw new TypeError("Sample channels must be Float32Arrays matching the sample length.");
    }
    for (let frame = 0; frame < count; frame += 1) {
      const raw = data[reverse ? last - frame - 1 : first + frame];
      const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      const pcm = Math.min(32_767, Math.round(sample * 32_768));
      view.setInt16(44 + (frame * channels + channel) * 2, pcm, true);
    }
  }
  return output;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }
  return btoa(chunks.join(""));
}

function fromBase64(text, remainingBytes) {
  if (typeof text !== "string" || !text.length || text.length % 4 !== 0 || /\s/u.test(text)) {
    invalid("sample WAV must be padded base64 without whitespace.");
  }
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const size = text.length / 4 * 3 - padding;
  if (size < 44 || size > remainingBytes) invalid("sample data exceeds the 32 MiB bank limit.");
  let decoded;
  try { decoded = atob(text); } catch { invalid("sample contains invalid base64."); }
  if (decoded.length !== size) invalid("sample base64 length does not match.");
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = decoded.charCodeAt(index);
  validateWav(bytes);
  return bytes.buffer;
}

function validateWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourCC = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (fourCC(0) !== "RIFF" || fourCC(8) !== "WAVE" || view.getUint32(4, true) + 8 !== bytes.length) {
    invalid("sample is not a complete RIFF/WAVE file.");
  }
  let format = null;
  let dataSize = null;
  let offset = 12;
  let chunks = 0;
  while (offset < bytes.length) {
    if (++chunks > 128 || offset + 8 > bytes.length) invalid("WAV chunk layout is invalid.");
    const id = fourCC(offset);
    const size = view.getUint32(offset + 4, true);
    const begin = offset + 8;
    const next = begin + size + (size % 2);
    if (next > bytes.length) invalid("WAV chunk extends beyond the file.");
    if (id === "fmt ") {
      if (format || size !== 16 || view.getUint16(begin, true) !== 1 || view.getUint16(begin + 14, true) !== 16) {
        invalid("bank samples must use ordinary 16-bit PCM WAV.");
      }
      const channels = integer(view.getUint16(begin + 2, true), 1, 2, "WAV channels");
      const rate = integer(view.getUint32(begin + 4, true), 8_000, 192_000, "WAV sample rate");
      const align = channels * 2;
      if (view.getUint16(begin + 12, true) !== align || view.getUint32(begin + 8, true) !== rate * align) {
        invalid("WAV byte rate or frame alignment is invalid.");
      }
      format = { align, rate };
    } else if (id === "data") {
      if (!format || dataSize !== null || size === 0 || size % format.align !== 0) {
        invalid("WAV sample frames are invalid.");
      }
      if (size / format.align > format.rate * 60) invalid("samples must be no longer than 60 seconds.");
      dataSize = size;
    }
    offset = next;
  }
  if (!format || dataSize === null) invalid("WAV is missing its format or sample data.");
}

/** Save full source samples, retaining reversible trim/loop/reverse in patches. */
export function serializeBank(state, samples) {
  const safeState = copyState(state);
  if (!(samples instanceof Map) || samples.size !== SLOT_COUNT) {
    invalid("exactly eight sample slots are required.");
  }
  let byteCount = 0;
  const entries = [...samples.entries()].sort(([left], [right]) => left - right);
  for (const [slot, buffer] of entries) {
    integer(slot, 0, SLOT_COUNT - 1, "sample slot");
    byteCount += sampleLayout(buffer).bytes;
    if (byteCount > ESI_BANK_MAX_SAMPLE_BYTES) invalid("sample data exceeds the 32 MiB bank limit.");
  }
  const text = JSON.stringify({
    type: ESI_BANK_TYPE,
    version: ESI_BANK_VERSION,
    state: safeState,
    samples: entries.map(([slot, buffer]) => ({ slot, wav: toBase64(encodeWav(buffer)) })),
  });
  checkTextSize(text);
  return text;
}

/** Validate without creating audio nodes or changing any live bank state. */
export function parseBank(text) {
  checkTextSize(text);
  let bank;
  try { bank = JSON.parse(text); } catch { invalid("file is not valid JSON."); }
  exactKeys(bank, ["type", "version", "state", "samples"], "bank");
  if (bank.type !== ESI_BANK_TYPE || bank.version !== ESI_BANK_VERSION) invalid("unsupported bank type or version.");
  const state = copyState(bank.state);
  if (!Array.isArray(bank.samples) || bank.samples.length !== SLOT_COUNT) {
    invalid("exactly eight sample slots are required.");
  }
  const seen = new Set();
  let byteCount = 0;
  const samples = bank.samples.map((sample) => {
    exactKeys(sample, ["slot", "wav"], "sample");
    const slot = integer(sample.slot, 0, SLOT_COUNT - 1, "sample slot");
    if (seen.has(slot)) invalid("sample slots must be unique.");
    seen.add(slot);
    const bytes = fromBase64(sample.wav, ESI_BANK_MAX_SAMPLE_BYTES - byteCount);
    byteCount += bytes.byteLength;
    return { slot, bytes };
  });
  return { state, samples };
}
