import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeSoundFont, parseSoundFont, generateSample } from '../src/site/sound-fonts/soundfont.js';

const utf8 = new TextEncoder();
const ascii = (bytes, start, count) => new TextDecoder().decode(bytes.subarray(start, start + count)).replace(/\0.*$/s, '');
function children(buffer, start = 12, end = buffer.byteLength) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), result = new Map();
  for (let offset = start; offset < end;) {
    const tag = ascii(bytes, offset, 4), size = view.getUint32(offset + 4, true);
    const type = tag === 'LIST' ? ascii(bytes, offset + 8, 4) : tag;
    result.set(type, { offset: offset + 8, size, tag });
    offset += 8 + size + size % 2;
    assert.ok(offset <= end, 'chunk stays inside its container');
  }
  return result;
}
function tables(buffer) {
  const pdta = children(buffer).get('pdta');
  return children(buffer, pdta.offset + 4, pdta.offset + pdta.size);
}
function generatedBank(extra = {}) {
  return encodeSoundFont({ name: 'Test glass', author: 'Morphazoid', license: 'CC0-1.0', samples: [{ name: 'Glass C4', data: generateSample({ duration: 0.15 }) }], ...extra });
}

// A separately authored, small SF2 fixture exercises features the writer does not
// emit: preset/global zones, instrument/global zones, velocities and cents.
function externalFixture() {
  function concat(...parts) { return Buffer.concat(parts.map((part) => Buffer.from(part))); }
  function riffChunk(tag, data) {
    const head = Buffer.alloc(8); head.write(tag); head.writeUInt32LE(data.length, 4);
    return concat(head, data, data.length % 2 ? Buffer.alloc(1) : []);
  }
  function group(type, ...parts) { return riffChunk('LIST', concat(utf8.encode(type), ...parts)); }
  function gens(records) {
    const bytes = Buffer.alloc(records.length * 4);
    records.forEach(([op, amount], i) => { bytes.writeUInt16LE(op, i * 4); bytes.writeInt16LE(amount, i * 4 + 2); });
    return bytes;
  }
  const sample = Buffer.alloc((96 + 46) * 2);
  for (let i = 0; i < 96; i += 1) sample.writeInt16LE(Math.round(Math.sin(i * Math.PI / 16) * 20000), i * 2);
  const shdr = Buffer.alloc(92); shdr.write('Fixture A4'); shdr.writeUInt32LE(96, 24); shdr.writeUInt32LE(8, 28); shdr.writeUInt32LE(88, 32); shdr.writeUInt32LE(22050, 36); shdr[40] = 69; shdr.writeInt8(-7, 41); shdr.writeUInt16LE(1, 44); shdr.write('EOS', 46);
  const phdr = Buffer.alloc(76); phdr.write('External preset'); phdr.writeUInt16LE(17, 20); phdr.writeUInt16LE(3, 22); phdr.write('EOP', 38); phdr.writeUInt16LE(2, 62);
  const inst = Buffer.alloc(44); inst.write('External instrument'); inst.write('EOI', 22); inst.writeUInt16LE(2, 42);
  const pbag = gens([[0, 0], [2, 0], [5, 0]]);
  const pgen = gens([[17, -100], [34, 2400], [43, 40 | (100 << 8)], [34, 1200], [41, 0], [0, 0]]);
  const ibag = gens([[0, 0], [4, 0], [10, 0]]);
  const igen = gens([[34, -2400], [38, -1200], [17, 200], [48, 120], [43, 50 | (80 << 8)], [44, 30 | (110 << 8)], [52, -9], [58, 69], [54, 1], [53, 0], [0, 0]]);
  const info = group('INFO', riffChunk('ifil', Buffer.from([2, 0, 1, 0])), riffChunk('INAM', utf8.encode('Independent fixture\0')), riffChunk('isng', utf8.encode('EMU8000\0')));
  const pdta = group('pdta', ...[['phdr', phdr], ['pbag', pbag], ['pmod', Buffer.alloc(10)], ['pgen', pgen], ['inst', inst], ['ibag', ibag], ['imod', Buffer.alloc(10)], ['igen', igen], ['shdr', shdr]].map(([tag, data]) => riffChunk(tag, data)));
  const result = riffChunk('RIFF', concat(utf8.encode('sfbk'), info, group('sdta', riffChunk('smpl', sample)), pdta));
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}

test('SF2 export has standard ordered RIFF lists, hydra records and PCM guard frames', () => {
  const data = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5) * 0.4);
  const buffer = generatedBank({ samples: [{ data, name: 'One', rootKey: 48, lowKey: 0, highKey: 59 }, { data, name: 'Two', rootKey: 72, lowKey: 60, highKey: 127 }] });
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), root = children(buffer), pdta = tables(buffer);
  assert.equal(ascii(bytes, 0, 4), 'RIFF'); assert.equal(ascii(bytes, 8, 4), 'sfbk');
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8);
  assert.deepEqual([...root.keys()], ['INFO', 'sdta', 'pdta']);
  assert.deepEqual([...pdta.keys()], ['phdr', 'pbag', 'pmod', 'pgen', 'inst', 'ibag', 'imod', 'igen', 'shdr']);
  for (const [tag, size] of Object.entries({ phdr: 38, pbag: 4, pmod: 10, pgen: 4, inst: 22, ibag: 4, imod: 10, igen: 4, shdr: 46 })) assert.equal(pdta.get(tag).size % size, 0, tag);
  assert.equal(ascii(bytes, pdta.get('phdr').offset + 38, 20), 'EOP');
  assert.equal(ascii(bytes, pdta.get('inst').offset + 22, 20), 'EOI');
  assert.equal(ascii(bytes, pdta.get('shdr').offset + 92, 20), 'EOS');
  assert.equal(view.getUint16(pdta.get('phdr').offset + 62, true), 1);
  assert.equal(view.getUint16(pdta.get('inst').offset + 42, true), 2);
  assert.equal(view.getUint16(pdta.get('ibag').offset + 8, true), 12);
  const sdta = root.get('sdta'), smpl = children(buffer, sdta.offset + 4, sdta.offset + sdta.size).get('smpl');
  for (let sample = 0; sample < 2; sample += 1) {
    const at = pdta.get('shdr').offset + sample * 46, end = view.getUint32(at + 24, true);
    assert.equal(view.getUint32(at + 20, true), sample * 174);
    assert.equal(view.getUint16(at + 44, true), 1);
    for (let guard = 0; guard < 46; guard += 1) assert.equal(view.getInt16(smpl.offset + (end + guard) * 2, true), 0);
  }
});

test('SF2 roundtrip preserves metadata, key zones, sample pitch, loops and PCM within 16-bit accuracy', () => {
  const data = generateSample({ kind: 'warm', rootKey: 57, duration: 0.3 });
  const parsed = parseSoundFont(generatedBank({ attack: 0.04, release: 0.75, samples: [{ data, name: 'Warm A3', sampleRate: 22050, rootKey: 57, lowKey: 36, highKey: 84, loopStart: 400, loopEnd: 1600 }] }));
  assert.equal(parsed.name, 'Test glass'); assert.equal(parsed.author, 'Morphazoid'); assert.equal(parsed.license, 'CC0-1.0');
  assert.deepEqual(parsed.warnings, []);
  const zone = parsed.presets[0].zones[0], sample = parsed.samples[0];
  assert.equal(zone.rootKey, 57); assert.equal(zone.lowKey, 36); assert.equal(zone.highKey, 84);
  assert.equal(zone.loop, true); assert.equal(zone.loopStart, 400); assert.equal(zone.loopEnd, 1600);
  assert.ok(Math.abs(zone.attack - 0.04) < 0.00002); assert.ok(Math.abs(zone.release - 0.75) < 0.0003);
  assert.equal(sample.name, 'Warm A3'); assert.equal(sample.sampleRate, 22050); assert.equal(sample.data.length, data.length);
  for (let i = 0; i < data.length; i += 1) assert.ok(Math.abs(sample.data[i] - data[i]) < 0.00005);
});

test('independently authored SF2 applies global overrides, preset additions, ranges and pitch correction', () => {
  const result = parseSoundFont(externalFixture()), preset = result.presets[0], zone = preset.zones[0];
  assert.equal(result.name, 'Independent fixture'); assert.equal(preset.program, 17); assert.equal(preset.bank, 3);
  assert.equal(zone.attack, 0.5, 'local preset attack replaces the global value and adds to instrument attack');
  assert.equal(zone.release, 0.5); assert.equal(zone.pan, 0.2); assert.equal(zone.attenuation, 12); assert.equal(zone.tune, -16);
  assert.equal(zone.lowKey, 50); assert.equal(zone.highKey, 80); assert.equal(zone.lowVelocity, 30); assert.equal(zone.highVelocity, 110);
  assert.equal(zone.loop, true); assert.equal(zone.loopStart, 8); assert.equal(zone.loopEnd, 88);
  assert.equal(result.samples[0].data[8], 20000 / 32768);
  assert.deepEqual(result.warnings, []);
});

test('accepts an ArrayBuffer view without reading unrelated prefix/suffix bytes', () => {
  const bank = new Uint8Array(externalFixture()), wrapped = new Uint8Array(bank.length + 27);
  wrapped.set(bank, 11);
  assert.equal(parseSoundFont(wrapped.subarray(11, 11 + bank.length)).name, 'Independent fixture');
});

test('rejects truncated headers, non-SF2 bytes and invalid RIFF chunk sizes with useful errors', () => {
  const bank = generatedBank();
  assert.throws(() => parseSoundFont(new ArrayBuffer(4)), /truncated/);
  assert.throws(() => parseSoundFont(utf8.encode('not a soundfont at all')), /not a SoundFont/);
  assert.throws(() => parseSoundFont(bank.slice(0, -1)), /truncated/);
  const broken = bank.slice(0); new DataView(broken).setUint32(16, 0xfffffff0, true);
  assert.throws(() => parseSoundFont(broken), /truncated.*chunk/);
  assert.throws(() => parseSoundFont('x'), /ArrayBuffer/);
});

test('rejects bad sample bounds and invalid hydra references instead of indexing arbitrary bytes', () => {
  const badSample = externalFixture(), sh = tables(badSample).get('shdr');
  new DataView(badSample).setUint32(sh.offset + 24, 0xfffffff0, true);
  assert.throws(() => parseSoundFont(badSample), /bounds/);
  const badTable = externalFixture(), ib = tables(badTable).get('ibag');
  new DataView(badTable).setUint16(ib.offset + 8, 65535, true);
  assert.throws(() => parseSoundFont(badTable), /index/);
  const missingSample = externalFixture(), ig = tables(missingSample).get('igen');
  new DataView(missingSample).setUint16(ig.offset + 9 * 4 + 2, 42, true);
  assert.throws(() => parseSoundFont(missingSample), /missing sample/);
});

test('rejects SF3 compressed samples explicitly', () => {
  const compressed = externalFixture(), sh = tables(compressed).get('shdr');
  new DataView(compressed).setUint16(sh.offset + 44, 0x11, true);
  assert.throws(() => parseSoundFont(compressed), /compressed SF3/);
  const version3 = externalFixture(), info = children(version3).get('INFO'), ifil = children(version3, info.offset + 4, info.offset + info.size).get('ifil');
  new DataView(version3).setUint16(ifil.offset, 3, true);
  assert.throws(() => parseSoundFont(version3), /compressed SF3/);
});

test('disables unsafe loop bounds and reports unsupported preview features', () => {
  const buffer = externalFixture(), map = tables(buffer), view = new DataView(buffer);
  view.setUint32(map.get('shdr').offset + 32, 100000, true);
  // Replace fine-tuning with a filter cutoff generator, leaving a playable zone.
  view.setUint16(map.get('igen').offset + 6 * 4, 8, true);
  const result = parseSoundFont(buffer);
  assert.equal(result.presets[0].zones[0].loop, false);
  assert.ok(result.warnings.some((warning) => warning.includes('invalid sample loop')));
  assert.ok(result.warnings.some((warning) => warning.includes('filter')));
});

test('omits unsupported zones while retaining playable neighbors', () => {
  const data = generateSample({ duration: 0.05 });
  const buffer = generatedBank({ samples: [{ data, lowKey: 0, highKey: 59 }, { data, lowKey: 60, highKey: 127 }] });
  const igen = tables(buffer).get('igen'), view = new DataView(buffer);
  // First sample begins one frame into the original header. That generator is
  // deliberately unsupported by this preview; the untouched second zone works.
  view.setUint16(igen.offset + 4, 0, true); view.setInt16(igen.offset + 6, 1, true);
  const parsed = parseSoundFont(buffer);
  assert.equal(parsed.presets[0].zones.length, 1);
  assert.equal(parsed.presets[0].zones[0].sampleIndex, 1);
  assert.ok(parsed.warnings.some((warning) => warning.includes('start/end offsets')));
  const allUnsupported = externalFixture(), shdr = tables(allUnsupported).get('shdr');
  new DataView(allUnsupported).setUint16(shdr.offset + 44, 0x8001, true);
  assert.throws(() => parseSoundFont(allUnsupported), /no supported playable/);
});

test('writer rejects nonfinite samples and invalid mapping or loops, and clips finite PCM', () => {
  const data = new Float32Array(100); data[0] = NaN;
  assert.throws(() => generatedBank({ samples: [{ data }] }), /non-finite/);
  data[0] = Infinity; assert.throws(() => generatedBank({ samples: [{ data }] }), /non-finite/);
  data[0] = 0;
  assert.throws(() => generatedBank({ samples: [{ data, lowKey: 90, highKey: 70 }] }), /High key/);
  assert.throws(() => generatedBank({ samples: [{ data, loopStart: 90, loopEnd: 100 }] }), /Loop start/);
  assert.throws(() => generatedBank({ samples: [{ data, sampleRate: 0 }] }), /Sample rate/);
  assert.throws(() => generatedBank({ attack: Infinity }), /Attack/);
  data[0] = -2; data[1] = 2;
  const parsed = parseSoundFont(generatedBank({ samples: [{ data }] }));
  assert.equal(parsed.samples[0].data[0], -1); assert.equal(parsed.samples[0].data[1], 32767 / 32768);
  assert.equal(data[0], -2, 'export does not mutate source audio');
});

test('original sample templates are deterministic, distinct, finite, bounded and fade to silence', () => {
  const banks = ['glass', 'warm', 'pluck'].map((kind) => generateSample({ kind, duration: 1 }));
  assert.deepEqual(banks[0], generateSample({ kind: 'glass', duration: 1 }));
  for (const data of banks) {
    assert.equal(data.length, 22050); assert.equal(data[0], 0); assert.equal(Math.abs(data.at(-1)), 0);
    let energy = 0;
    for (const value of data) { assert.ok(Number.isFinite(value)); assert.ok(Math.abs(value) <= 0.621); energy += value * value; }
    assert.ok(energy / data.length > 0.001, 'audible energy remains');
  }
  for (let i = 0; i < banks.length; i += 1) for (let j = i + 1; j < banks.length; j += 1) {
    let difference = 0;
    for (let k = 0; k < banks[i].length; k += 1) difference += (banks[i][k] - banks[j][k]) ** 2;
    assert.ok(difference / banks[i].length > 0.001, 'templates have distinct waveforms');
  }
});

test('brightness changes overtones, root key changes pitch, and invalid generation requests fail', () => {
  const dark = generateSample({ kind: 'pluck', brightness: 0, rootKey: 69 }), bright = generateSample({ kind: 'pluck', brightness: 1, rootKey: 69 });
  let difference = 0;
  for (let i = 0; i < dark.length; i += 1) difference += (dark[i] - bright[i]) ** 2;
  assert.ok(difference / dark.length > 0.0005);
  function crossings(data) { let count = 0; for (let i = 2205; i < 19845; i += 1) if (data[i - 1] <= 0 && data[i] > 0) count += 1; return count; }
  const octave = generateSample({ kind: 'pluck', brightness: 0, rootKey: 81 });
  assert.ok(Math.abs(crossings(octave) / crossings(dark) - 2) < 0.01);
  for (const options of [{ kind: 'unknown' }, { duration: NaN }, { sampleRate: Infinity }, { brightness: -1 }, { rootKey: 127, sampleRate: 8000 }]) assert.throws(() => generateSample(options), /SoundFont:/);
});
