/**
 * Small, dependency-free SF2 PCM interchange for the Sound Fonts workshop.
 * RIFF and hydra records follow Creative/E-mu's SoundFont Technical Specification:
 * https://www.synthfont.com/sfspec24.pdf (sections 6–8).
 * This is a sample preview reader, not a complete SoundFont synthesizer. Filters,
 * modulators, effects, envelope stages other than attack/release and exclusive
 * classes are not rendered. The reader reports those limitations when present.
 */

export const MAX_SOUNDFONT_BYTES = 128 * 1024 * 1024;
const MAX_ZONES = 65535;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const fail = (message) => { throw new Error(`SoundFont: ${message}`); };
const integer = (value, low, high, label) => {
  if (!Number.isInteger(value) || value < low || value > high) fail(`${label} must be an integer from ${low} to ${high}.`);
  return value;
};
const number = (value, low, high, label) => {
  if (!Number.isFinite(value) || value < low || value > high) fail(`${label} must be from ${low} to ${high}.`);
  return value;
};
const textBytes = (text, limit = 255) => {
  const clean = String(text ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, limit);
  const bytes = new Uint8Array(clean.length + 1);
  for (let i = 0; i < clean.length; i += 1) bytes[i] = clean.charCodeAt(i);
  return bytes;
};
function putName(view, offset, name) {
  const bytes = textBytes(name, 19);
  new Uint8Array(view.buffer, view.byteOffset + offset, bytes.length).set(bytes);
}
function ascii(bytes, start, length) {
  let result = '';
  for (let i = start; i < start + length && bytes[i]; i += 1) result += String.fromCharCode(bytes[i]);
  return result.trim();
}
function join(parts) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  if (size > MAX_SOUNDFONT_BYTES) fail('file exceeds the 128 MiB limit.');
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
function chunk(id, bytes) {
  const result = new Uint8Array(8 + bytes.length + (bytes.length % 2));
  for (let i = 0; i < 4; i += 1) result[i] = id.charCodeAt(i);
  new DataView(result.buffer).setUint32(4, bytes.length, true);
  result.set(bytes, 8);
  return result;
}
const list = (id, chunks) => chunk('LIST', join([textBytes(id, 4).subarray(0, 4), ...chunks]));
const timecents = (seconds) => seconds === 0 ? -32768 : clamp(Math.round(1200 * Math.log2(seconds)), -12000, 8000);

/** Export one preset containing mono PCM sample zones as a standard SF2 bank. */
export function encodeSoundFont({ name = 'Morphazoid', author = '', license = '', samples, attack = 0.01, release = 0.35 } = {}) {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 4096) fail('choose between 1 and 4096 samples.');
  number(attack, 0, 20, 'Attack');
  number(release, 0, 20, 'Release');
  let points = 0;
  const prepared = samples.map((sample, index) => {
    if (!(sample?.data instanceof Float32Array) || sample.data.length < 48) fail(`sample ${index + 1} needs at least 48 Float32 PCM frames.`);
    const sampleRate = integer(sample.sampleRate ?? 22050, 400, 192000, 'Sample rate');
    const rootKey = integer(sample.rootKey ?? 60, 0, 127, 'Root key');
    const lowKey = integer(sample.lowKey ?? 0, 0, 127, 'Low key');
    const highKey = integer(sample.highKey ?? 127, lowKey, 127, 'High key');
    const loop = sample.loopStart != null || sample.loopEnd != null;
    const loopStart = loop ? integer(sample.loopStart, 8, sample.data.length - 40, 'Loop start') : 8;
    const loopEnd = loop ? integer(sample.loopEnd, loopStart + 32, sample.data.length - 8, 'Loop end') : sample.data.length - 8;
    const start = points;
    points += sample.data.length + 46;
    if (points * 2 > MAX_SOUNDFONT_BYTES - 1024 * 1024) fail('sample data exceeds the 128 MiB file limit.');
    for (const value of sample.data) if (!Number.isFinite(value)) fail(`sample ${index + 1} contains non-finite PCM data.`);
    return { ...sample, sampleRate, rootKey, lowKey, highKey, start, loopStart, loopEnd, loop };
  });

  const pcm = new Uint8Array(points * 2), pcmView = new DataView(pcm.buffer);
  const shdr = new Uint8Array((prepared.length + 1) * 46), sh = new DataView(shdr.buffer);
  const ibag = new Uint8Array((prepared.length + 1) * 4), ib = new DataView(ibag.buffer);
  const generators = [];
  for (let i = 0; i < prepared.length; i += 1) {
    const sample = prepared[i], header = i * 46;
    for (let j = 0; j < sample.data.length; j += 1) {
      const value = clamp(sample.data[j], -1, 1);
      pcmView.setInt16((sample.start + j) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    putName(sh, header, sample.name || `Sample ${i + 1}`);
    sh.setUint32(header + 20, sample.start, true);
    sh.setUint32(header + 24, sample.start + sample.data.length, true);
    sh.setUint32(header + 28, sample.start + sample.loopStart, true);
    sh.setUint32(header + 32, sample.start + sample.loopEnd, true);
    sh.setUint32(header + 36, sample.sampleRate, true);
    sh.setUint8(header + 40, sample.rootKey);
    sh.setUint16(header + 44, 1, true); // mono, stored in this file
    ib.setUint16(i * 4, generators.length, true);
    generators.push([43, sample.lowKey | (sample.highKey << 8)], [34, timecents(attack)], [38, timecents(release)], [54, sample.loop ? 1 : 0], [58, sample.rootKey], [53, i]);
  }
  putName(sh, prepared.length * 46, 'EOS');
  ib.setUint16(prepared.length * 4, generators.length, true);
  generators.push([0, 0]); // terminal generator
  const igen = new Uint8Array(generators.length * 4), ig = new DataView(igen.buffer);
  generators.forEach(([operator, amount], index) => {
    ig.setUint16(index * 4, operator, true);
    ig.setInt16(index * 4 + 2, amount, true);
  });
  const phdr = new Uint8Array(76), ph = new DataView(phdr.buffer);
  putName(ph, 0, name);
  putName(ph, 38, 'EOP');
  ph.setUint16(38 + 24, 1, true);
  const pbag = new Uint8Array(8), pb = new DataView(pbag.buffer);
  pb.setUint16(4, 1, true);
  const pgen = new Uint8Array(8), pg = new DataView(pgen.buffer);
  pg.setUint16(0, 41, true); // instrument 0
  const inst = new Uint8Array(44), ins = new DataView(inst.buffer);
  putName(ins, 0, name);
  putName(ins, 22, 'EOI');
  ins.setUint16(42, prepared.length, true);
  const version = new Uint8Array([2, 0, 1, 0]);
  const info = list('INFO', [chunk('ifil', version), chunk('isng', textBytes('EMU8000')), chunk('INAM', textBytes(name)), chunk('IENG', textBytes(author)), chunk('ICOP', textBytes(license, 2000)), chunk('ISFT', textBytes('Morphazoid Sound Fonts'))]);
  const pdta = list('pdta', [chunk('phdr', phdr), chunk('pbag', pbag), chunk('pmod', new Uint8Array(10)), chunk('pgen', pgen), chunk('inst', inst), chunk('ibag', ibag), chunk('imod', new Uint8Array(10)), chunk('igen', igen), chunk('shdr', shdr)]);
  return chunk('RIFF', join([new Uint8Array([115, 102, 98, 107]), info, list('sdta', [chunk('smpl', pcm)]), pdta])).buffer;
}

/** Read SF2 PCM and flatten playable preset/instrument zones for a basic preview. */
export function parseSoundFont(input, { metadataOnly = false } = {}) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes) fail('expected an ArrayBuffer containing an .sf2 file.');
  if (bytes.byteLength > MAX_SOUNDFONT_BYTES) fail('file exceeds the 128 MiB limit.');
  if (bytes.byteLength < 12) fail('file is truncated; a RIFF header is required.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at) => view.getUint16(at, true), s16 = (at) => view.getInt16(at, true), u32 = (at) => view.getUint32(at, true);
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'sfbk') fail('not a SoundFont SF2 RIFF/sfbk file.');
  const end = u32(4) + 8;
  if (end > bytes.length || end < 12) fail('RIFF size is truncated or invalid.');
  const warningSet = new Set();
  const warn = (message) => warningSet.add(message);
  if (end !== bytes.length) warn('Trailing bytes outside the SoundFont RIFF container were ignored.');
  function chunks(start, stop) {
    const found = new Map();
    for (let at = start; at < stop;) {
      if (stop - at < 8) fail('truncated chunk header.');
      const id = ascii(bytes, at, 4), size = u32(at + 4), data = at + 8;
      const next = data + size + size % 2;
      if (next > stop) fail(`truncated ${id || 'unnamed'} chunk.`);
      let key = id;
      if (id === 'LIST') {
        if (size < 4) fail('LIST chunk lacks its type.');
        key = ascii(bytes, data, 4);
      }
      if (found.has(key)) fail(`duplicate ${key} chunk.`);
      found.set(key, { offset: data, size });
      at = next;
    }
    return found;
  }
  const top = chunks(12, end);
  function group(id) {
    const item = top.get(id);
    if (!item || item.size < 4) fail(`missing ${id} LIST.`);
    return chunks(item.offset + 4, item.offset + item.size);
  }
  const info = group('INFO'), sdta = group('sdta'), pdta = group('pdta');
  const infoText = (id, fallback = '') => {
    const item = info.get(id);
    return item ? ascii(bytes, item.offset, Math.min(item.size, 65536)) : fallback;
  };
  const version = info.get('ifil');
  if (!version || version.size !== 4) fail('missing or invalid ifil version.');
  const majorVersion = u16(version.offset);
  if (majorVersion === 3 && !metadataOnly) fail('compressed SF3 is not supported by the PCM reader. Use the shared SoundFont player.');
  if (majorVersion !== 2 && majorVersion !== 3) fail(`unsupported SoundFont version ${majorVersion}.`);
  const smpl = sdta.get('smpl');
  if (!smpl || smpl.size < 2) fail('missing or invalid sample data.');
  const compressed = majorVersion === 3 || ascii(bytes, smpl.offset, Math.min(4, smpl.size)) === 'OggS';
  if (compressed && !metadataOnly) fail('compressed SF3 is not supported by the PCM reader. Use the shared SoundFont player.');
  if (!compressed && smpl.size % 2) fail('invalid 16-bit PCM sample data.');
  const sm24 = sdta.get('sm24');
  if (sm24) warn('24-bit sample low bytes are omitted in this 16-bit preview; the original file is unchanged.');
  function table(id, recordSize, minimum = 1) {
    const item = pdta.get(id);
    if (!item || item.size % recordSize || item.size / recordSize < minimum || item.size / recordSize > 65536) fail(`invalid ${id} record table.`);
    return { ...item, count: item.size / recordSize, recordSize };
  }
  const ph = table('phdr', 38, 2), pb = table('pbag', 4, 2), pm = table('pmod', 10), pg = table('pgen', 4);
  const ins = table('inst', 22, 2), ib = table('ibag', 4, 2), im = table('imod', 10), ig = table('igen', 4), sh = table('shdr', 46, 2);
  function validateIndices(headers, field, bags, generators, modulators) {
    let previous = 0;
    for (let i = 0; i < headers.count; i += 1) {
      const index = u16(headers.offset + i * headers.recordSize + field);
      if (index < previous || index >= bags.count || (i === 0 && index !== 0)) fail('invalid preset/instrument bag index.');
      previous = index;
    }
    if (previous !== bags.count - 1) fail('invalid terminal bag index.');
    let previousGen = 0, previousMod = 0;
    for (let i = 0; i < bags.count; i += 1) {
      const gen = u16(bags.offset + i * 4), mod = u16(bags.offset + i * 4 + 2);
      if (gen < previousGen || mod < previousMod || gen >= generators.count || mod >= modulators.count || (i === 0 && (gen !== 0 || mod !== 0))) fail('invalid generator/modulator index.');
      previousGen = gen; previousMod = mod;
    }
    if (previousGen !== generators.count - 1 || previousMod !== modulators.count - 1) fail('invalid terminal generator/modulator index.');
  }
  validateIndices(ph, 24, pb, pg, pm);
  validateIndices(ins, 20, ib, ig, im);
  if (pm.count > 1 || im.count > 1) warn('Custom SoundFont modulators are not rendered in the preview.');
  const sampleMeta = [], totalFrames = smpl.size / 2;
  for (let i = 0; i < sh.count - 1; i += 1) {
    const at = sh.offset + i * 46, type = u16(at + 44);
    if (type & 0x10 && !metadataOnly) fail('compressed SF3 samples are not supported by the PCM reader.');
    const start = u32(at + 20), stop = u32(at + 24), rate = u32(at + 36);
    const supported = !(type & 0x8000) && [1, 2, 4].includes(type & ~0x10);
    if (supported && (start >= stop || stop > (type & 0x10 ? smpl.size : totalFrames) || rate < 400 || rate > 192000)) fail(`invalid bounds or sample rate for sample ${i + 1}.`);
    if (!supported) warn('ROM and unsupported linked samples are omitted from the preview.');
    sampleMeta.push({ name: ascii(bytes, at, 20) || `Sample ${i + 1}`, start, stop, sampleRate: rate, rootKey: bytes[at + 40] <= 127 ? bytes[at + 40] : 60, correction: view.getInt8(at + 41), loopStart: u32(at + 28) - start, loopEnd: u32(at + 32) - start, type, supported });
  }
  // Decode the pool once: repeated and overlapping shdr ranges share the array.
  const pool = metadataOnly ? null : new Float32Array(totalFrames);
  if (pool) for (let i = 0; i < totalFrames; i += 1) pool[i] = s16(smpl.offset + i * 2) / 32768;
  const samples = sampleMeta.map((sample) => {
    let data;
    return { name: sample.name, sampleRate: sample.sampleRate, rootKey: sample.rootKey, loopStart: sample.loopStart, loopEnd: sample.loopEnd,
      get data() {
        if (data) return data;
        if (!sample.supported || sample.type & 0x10) return data = new Float32Array(0);
        if (pool) return data = pool.subarray(sample.start, sample.stop);
        // A bounded waveform only; the shared audio engine owns full decoding.
        const count = Math.min(4096, sample.stop - sample.start);
        data = new Float32Array(count);
        for (let i = 0; i < count; i++) data[i] = s16(smpl.offset + 2 * (sample.start + Math.floor(i * (sample.stop - sample.start) / count))) / 32768;
        return data;
      },
    };
  });
  const supportedGenerators = new Set([0, 1, 2, 3, 4, 12, 17, 34, 38, 41, 43, 44, 45, 48, 50, 51, 52, 53, 54, 58]);
  const unsupported = new Set();
  function zoneMap(bags, generators, index, terminal) {
    const start = u16(bags.offset + index * 4), stop = u16(bags.offset + (index + 1) * 4), values = new Map();
    for (let i = start; i < stop; i += 1) {
      const at = generators.offset + i * 4, op = u16(at), raw = u16(at + 2);
      if (op === 43 || op === 44) {
        if ((op === 43 && i !== start) || (op === 44 && (i > start + 1 || (i === start + 1 && !values.has(43))))) continue;
        values.set(op, [raw & 255, raw >>> 8]);
      } else values.set(op, [41, 53, 54].includes(op) ? raw : s16(at + 2));
      if (!supportedGenerators.has(op)) unsupported.add(op);
      if (op === terminal) break;
    }
    return values;
  }
  function zones(headers, field, bags, generators, index, terminal) {
    const first = u16(headers.offset + index * headers.recordSize + field), last = u16(headers.offset + (index + 1) * headers.recordSize + field);
    let global = new Map();
    const result = [];
    for (let bag = first; bag < last; bag += 1) {
      const local = zoneMap(bags, generators, bag, terminal);
      if (!local.has(terminal)) {
        if (bag === first) global = local;
        else warn('A zone without an instrument or sample reference was omitted.');
        continue;
      }
      result.push(new Map([...global, ...local]));
    }
    return result;
  }
  const instrumentCache = new Map();
  const presets = [];
  let zoneCount = 0;
  for (let preset = 0; preset < ph.count - 1; preset += 1) {
    const at = ph.offset + preset * 38, presetZones = [];
    for (const p of zones(ph, 24, pb, pg, preset, 41)) {
      const instrument = p.get(41);
      if (instrument >= ins.count - 1) fail('preset refers to a missing instrument.');
      if (!instrumentCache.has(instrument)) instrumentCache.set(instrument, zones(ins, 20, ib, ig, instrument, 53));
      for (const z of instrumentCache.get(instrument)) {
        zoneCount += 1;
        if (zoneCount > MAX_ZONES) fail('too many expanded zones for the browser preview.');
        const sampleIndex = z.get(53), sample = sampleMeta[sampleIndex];
        if (!sample) fail('instrument refers to a missing sample.');
        if (!sample.supported) continue;
        if (!metadataOnly && [0, 1, 4, 12].some((op) => (z.get(op) ?? 0) !== 0)) {
          warn('Zones with sample start/end offsets are omitted from the preview.');
          continue;
        }
        const keyP = p.get(43) ?? [0, 127], keyI = z.get(43) ?? [0, 127], velP = p.get(44) ?? [0, 127], velI = z.get(44) ?? [0, 127];
        const lowKey = Math.max(keyP[0], keyI[0]), highKey = Math.min(keyP[1], keyI[1], 127), lowVelocity = Math.max(velP[0], velI[0]), highVelocity = Math.min(velP[1], velI[1], 127);
        if (lowKey > highKey || lowVelocity > highVelocity) continue;
        const combined = (op, fallback = 0) => (z.get(op) ?? fallback) + (p.get(op) ?? 0);
        const seconds = (op) => {
          if (z.get(op) === -32768) return 0;
          return 2 ** (clamp(combined(op, -12000), -12000, 8000) / 1200);
        };
        const rootOverride = z.get(58);
        const loopStart = sample.loopStart + (z.get(2) ?? 0) + (z.get(45) ?? 0) * 32768;
        const loopEnd = sample.loopEnd + (z.get(3) ?? 0) + (z.get(50) ?? 0) * 32768;
        const mode = (z.get(54) ?? 0) & 3;
        const requestedLoop = mode === 1 || mode === 3;
        const loop = requestedLoop && loopStart >= 0 && loopEnd > loopStart && loopEnd <= sample.stop - sample.start;
        if (requestedLoop && !loop) warn('An invalid sample loop was disabled.');
        if (mode === 3) warn('Loops that end on key release use the preview release envelope.');
        presetZones.push({ sampleIndex, lowKey, highKey, lowVelocity, highVelocity, rootKey: Number.isInteger(rootOverride) && rootOverride >= 0 && rootOverride <= 127 ? rootOverride : sample.rootKey, attack: seconds(34), release: seconds(38), loop, loopStart: loop ? loopStart : 0, loopEnd: loop ? loopEnd : 0, tune: clamp(combined(51) * 100 + combined(52) + sample.correction, -12000, 12000), attenuation: clamp(combined(48), 0, 1440) / 10, pan: clamp(combined(17), -500, 500) / 500 });
      }
    }
    presets.push({ name: ascii(bytes, at, 20) || `Preset ${preset + 1}`, program: u16(at + 20), bank: u16(at + 22), zones: presetZones });
  }
  if (unsupported.size) warn('Some filter, envelope, LFO, tuning or effect generators are not rendered in the preview.');
  if (!presets.some((preset) => preset.zones.length)) fail('this bank has no supported playable PCM zones.');
  return { name: infoText('INAM', 'Untitled SoundFont'), author: infoText('IENG'), license: infoText('ICOP'), format: compressed ? 'sf3' : 'sf2', presets, samples, warnings: metadataOnly ? [] : [...warningSet] };
}

/** Original deterministic additive samples; not recordings or instrument emulations. */
export function generateSample({ kind = 'glass', rootKey = 60, duration = 2, brightness = 0.5, sampleRate = 22050 } = {}) {
  if (!['glass', 'warm', 'pluck'].includes(kind)) fail('unknown sample template.');
  integer(rootKey, 0, 127, 'Root key');
  number(duration, 0.05, 12, 'Duration');
  number(brightness, 0, 1, 'Brightness');
  integer(sampleRate, 8000, 96000, 'Sample rate');
  const frames = Math.round(duration * sampleRate), data = new Float32Array(frames);
  const fundamental = 440 * 2 ** ((rootKey - 69) / 12);
  if (fundamental >= sampleRate * 0.45) fail('root pitch is too high for this sample rate.');
  const partials = kind === 'glass' ? [[1, 1], [2.01, 0.36 * brightness], [2.76, 0.22 * brightness], [4.08, 0.12 * brightness]] : kind === 'warm' ? [[1, 1], [2, 0.23 * brightness], [3, 0.15 * brightness], [5, 0.07 * brightness]] : [[1, 1], [2, 0.5 * brightness], [3, 0.32 * brightness], [4, 0.18 * brightness], [6, 0.11 * brightness]];
  const audible = partials.filter(([ratio]) => ratio * fundamental < sampleRate * 0.45);
  const scale = 0.62 / audible.reduce((sum, [, amplitude]) => sum + amplitude, 0);
  const attack = kind === 'warm' ? 0.08 : 0.004;
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate, progress = i / (frames - 1);
    const fadeIn = Math.min(1, t / attack), fadeOut = Math.min(1, (1 - progress) * duration / 0.06);
    let value = 0;
    for (const [ratio, amplitude] of audible) {
      const decay = kind === 'warm' ? 0.3 : kind === 'glass' ? 1.4 + ratio * 0.16 : 2.4 + ratio * 0.65;
      value += amplitude * Math.sin(2 * Math.PI * fundamental * ratio * t) * Math.exp(-t * decay);
    }
    data[i] = value * scale * fadeIn * fadeOut;
  }
  return data;
}
