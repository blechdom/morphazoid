const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const EXTENSIBLE_GUID_TAIL = Object.freeze([
  0x00, 0x00, 0x10, 0x00, 0x80, 0x00,
  0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

function invalid(message) {
  throw new RangeError(`Invalid PCM WAV: ${message}`);
}

function asBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("decodePcmWav requires an ArrayBuffer or an ArrayBuffer view");
}

function fourCc(bytes, offset) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function parseChunks(bytes, view) {
  if (bytes.byteLength < RIFF_HEADER_BYTES) invalid("file is shorter than a RIFF/WAVE header");
  if (fourCc(bytes, 0) !== "RIFF") {
    invalid("expected little-endian RIFF; RIFX and RF64 are not supported");
  }
  if (fourCc(bytes, 8) !== "WAVE") invalid("RIFF form type is not WAVE");

  const riffSize = view.getUint32(4, true);
  if (riffSize < 4) invalid("RIFF size is too small for the WAVE form type");
  const riffEnd = 8 + riffSize;
  if (riffEnd > bytes.byteLength) invalid("RIFF size extends beyond the supplied bytes");

  let formatChunk = null;
  const dataChunks = [];
  let offset = RIFF_HEADER_BYTES;
  while (offset < riffEnd) {
    if (riffEnd - offset < CHUNK_HEADER_BYTES) invalid("truncated chunk header");
    const id = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + CHUNK_HEADER_BYTES;
    const dataEnd = dataOffset + size;
    if (dataEnd > riffEnd) invalid(`${id || "unnamed"} chunk extends beyond RIFF bounds`);

    if (id === "fmt ") {
      if (formatChunk) invalid("multiple fmt chunks are ambiguous");
      formatChunk = { dataOffset, size };
    } else if (id === "data") {
      dataChunks.push({ dataOffset, size });
    }

    const paddedEnd = dataEnd + (size & 1);
    if (paddedEnd > riffEnd) invalid(`${id || "unnamed"} chunk is missing its pad byte`);
    offset = paddedEnd;
  }
  if (offset !== riffEnd) invalid("chunk layout does not match the declared RIFF size");
  if (!formatChunk) invalid("missing fmt chunk");
  if (!dataChunks.length) invalid("missing data chunk");
  return { formatChunk, dataChunks, riffSize };
}

function hasExtensibleGuidTail(bytes, offset) {
  for (let index = 0; index < EXTENSIBLE_GUID_TAIL.length; index += 1) {
    if (bytes[offset + index] !== EXTENSIBLE_GUID_TAIL[index]) return false;
  }
  return true;
}

function parseFormat(bytes, view, chunk) {
  if (chunk.size < 16) invalid("fmt chunk is shorter than WAVEFORMATEX");
  const offset = chunk.dataOffset;
  const sourceFormatTag = view.getUint16(offset, true);
  const numberOfChannels = view.getUint16(offset + 2, true);
  const sampleRate = view.getUint32(offset + 4, true);
  const byteRate = view.getUint32(offset + 8, true);
  const blockAlign = view.getUint16(offset + 12, true);
  const bitsPerSample = view.getUint16(offset + 14, true);
  let effectiveFormatTag = sourceFormatTag;
  let validBitsPerSample = bitsPerSample;
  let channelMask = null;
  let extensible = false;

  if (sourceFormatTag === WAVE_FORMAT_EXTENSIBLE) {
    extensible = true;
    if (chunk.size < 40) invalid("WAVE_FORMAT_EXTENSIBLE fmt chunk is shorter than 40 bytes");
    const extensionSize = view.getUint16(offset + 16, true);
    if (extensionSize < 22 || 18 + extensionSize > chunk.size) {
      invalid("invalid WAVE_FORMAT_EXTENSIBLE extension size");
    }
    validBitsPerSample = view.getUint16(offset + 18, true) || bitsPerSample;
    channelMask = view.getUint32(offset + 20, true);
    if (!hasExtensibleGuidTail(bytes, offset + 28)) {
      invalid("unsupported WAVE_FORMAT_EXTENSIBLE subformat GUID");
    }
    effectiveFormatTag = view.getUint32(offset + 24, true);
  }

  if (effectiveFormatTag !== WAVE_FORMAT_PCM && effectiveFormatTag !== WAVE_FORMAT_IEEE_FLOAT) {
    invalid(`unsupported format tag 0x${effectiveFormatTag.toString(16).padStart(4, "0")}`);
  }
  if (!numberOfChannels || numberOfChannels > 64) invalid("channel count must be between 1 and 64");
  if (!sampleRate) invalid("sample rate must be greater than zero");

  const supportedBits = effectiveFormatTag === WAVE_FORMAT_PCM
    ? [8, 16, 24, 32]
    : [32, 64];
  if (!supportedBits.includes(bitsPerSample)) {
    invalid(`${effectiveFormatTag === WAVE_FORMAT_PCM ? "PCM" : "IEEE float"} ${bitsPerSample}-bit samples are not supported`);
  }
  if (!validBitsPerSample || validBitsPerSample > bitsPerSample) {
    invalid("valid bits per sample must fit inside the sample container");
  }
  if (effectiveFormatTag === WAVE_FORMAT_IEEE_FLOAT && validBitsPerSample !== bitsPerSample) {
    invalid("IEEE float valid bits must equal its container size");
  }

  const bytesPerSample = bitsPerSample / 8;
  const expectedBlockAlign = numberOfChannels * bytesPerSample;
  if (blockAlign !== expectedBlockAlign) {
    invalid(`block alignment ${blockAlign} does not match ${expectedBlockAlign}`);
  }
  const expectedByteRate = sampleRate * blockAlign;
  if (byteRate !== expectedByteRate) {
    invalid(`byte rate ${byteRate} does not match ${expectedByteRate}`);
  }

  return {
    sourceFormatTag,
    effectiveFormatTag,
    encoding: effectiveFormatTag === WAVE_FORMAT_PCM ? "pcm" : "ieee-float",
    numberOfChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bytesPerSample,
    bitsPerSample,
    validBitsPerSample,
    channelMask,
    extensible,
  };
}

function createSampleReader(view, format) {
  const { effectiveFormatTag, bitsPerSample, validBitsPerSample } = format;
  if (effectiveFormatTag === WAVE_FORMAT_IEEE_FLOAT) {
    const readFloat = bitsPerSample === 32
      ? (offset) => view.getFloat32(offset, true)
      : (offset) => view.getFloat64(offset, true);
    return (offset) => {
      const sample = readFloat(offset);
      if (!Number.isFinite(sample)) invalid("IEEE float data contains NaN or infinity");
      return sample;
    };
  }

  const paddingBits = bitsPerSample - validBitsPerSample;
  const scale = 2 ** (validBitsPerSample - 1);
  if (bitsPerSample === 8) {
    return (offset) => ((view.getUint8(offset) >> paddingBits) - scale) / scale;
  }
  if (bitsPerSample === 16) {
    return paddingBits
      ? (offset) => (view.getInt16(offset, true) >> paddingBits) / scale
      : (offset) => view.getInt16(offset, true) / scale;
  }
  if (bitsPerSample === 24) {
    return (offset) => {
      let sample = bytesAt24(view, offset);
      if (paddingBits) sample >>= paddingBits;
      return sample / scale;
    };
  }
  return paddingBits
    ? (offset) => (view.getInt32(offset, true) >> paddingBits) / scale
    : (offset) => view.getInt32(offset, true) / scale;
}

function bytesAt24(view, offset) {
  const sample = view.getUint8(offset)
    | (view.getUint8(offset + 1) << 8)
    | (view.getUint8(offset + 2) << 16);
  return sample & 0x800000 ? sample - 0x1000000 : sample;
}

function countFrames(dataChunks, blockAlign) {
  let frameCount = 0;
  let dataByteLength = 0;
  for (const chunk of dataChunks) {
    if (chunk.size % blockAlign !== 0) invalid("data chunk ends inside an interleaved sample frame");
    frameCount += chunk.size / blockAlign;
    dataByteLength += chunk.size;
  }
  if (!frameCount) invalid("data chunks contain no sample frames");
  if (!Number.isSafeInteger(frameCount) || frameCount > 0x7fffffff) {
    invalid("sample frame count is too large to decode safely");
  }
  return { frameCount, dataByteLength };
}

function channelLevels(dataChunks, format, readSample, frameCount) {
  const scales = new Float64Array(format.numberOfChannels);
  const sumsOfSquares = new Float64Array(format.numberOfChannels).fill(1);
  for (const chunk of dataChunks) {
    const chunkFrames = chunk.size / format.blockAlign;
    for (let frame = 0; frame < chunkFrames; frame += 1) {
      const frameOffset = chunk.dataOffset + frame * format.blockAlign;
      for (let channel = 0; channel < format.numberOfChannels; channel += 1) {
        const sample = readSample(frameOffset + channel * format.bytesPerSample);
        const magnitude = Math.abs(sample);
        if (!magnitude) continue;
        if (scales[channel] < magnitude) {
          const ratio = scales[channel] / magnitude;
          sumsOfSquares[channel] = 1 + sumsOfSquares[channel] * ratio * ratio;
          scales[channel] = magnitude;
        } else {
          const ratio = magnitude / scales[channel];
          sumsOfSquares[channel] += ratio * ratio;
        }
      }
    }
  }
  return Array.from(scales, (scale, channel) => (
    scale ? scale * Math.sqrt(sumsOfSquares[channel] / frameCount) : 0
  ));
}

function decodeChannel(dataChunks, format, readSample, frameCount, channelIndex) {
  const samples = new Float32Array(frameCount);
  let outputIndex = 0;
  for (const chunk of dataChunks) {
    const chunkFrames = chunk.size / format.blockAlign;
    for (let frame = 0; frame < chunkFrames; frame += 1) {
      const offset = chunk.dataOffset
        + frame * format.blockAlign
        + channelIndex * format.bytesPerSample;
      samples[outputIndex] = readSample(offset);
      if (!Number.isFinite(samples[outputIndex])) {
        invalid("sample value cannot be represented as Float32");
      }
      outputIndex += 1;
    }
  }
  return samples;
}

/**
 * Decode an uncompressed little-endian RIFF/WAVE file without resampling.
 * Multichannel input is reduced by selecting the channel with the greatest
 * raw RMS energy, which avoids destructive phase cancellation.
 */
export function decodePcmWav(input) {
  const bytes = asBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = parseChunks(bytes, view);
  const format = parseFormat(bytes, view, chunks.formatChunk);
  const { frameCount, dataByteLength } = countFrames(chunks.dataChunks, format.blockAlign);
  const readSample = createSampleReader(view, format);
  const channelRms = channelLevels(chunks.dataChunks, format, readSample, frameCount);
  let selectedChannelIndex = 0;
  for (let channel = 1; channel < channelRms.length; channel += 1) {
    if (channelRms[channel] > channelRms[selectedChannelIndex]) selectedChannelIndex = channel;
  }
  const samples = decodeChannel(
    chunks.dataChunks,
    format,
    readSample,
    frameCount,
    selectedChannelIndex,
  );

  return Object.freeze({
    samples,
    sampleRate: format.sampleRate,
    numberOfChannels: format.numberOfChannels,
    selectedChannelIndex,
    channelRms: Object.freeze(channelRms),
    frameCount,
    durationSeconds: frameCount / format.sampleRate,
    encoding: format.encoding,
    sourceFormatTag: format.sourceFormatTag,
    extensible: format.extensible,
    bitsPerSample: format.bitsPerSample,
    validBitsPerSample: format.validBitsPerSample,
    channelMask: format.channelMask,
    blockAlign: format.blockAlign,
    byteRate: format.byteRate,
    dataByteLength,
  });
}
