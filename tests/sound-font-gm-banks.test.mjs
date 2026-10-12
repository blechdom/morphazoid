import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectSoundFont, MAX_SOUNDFONT_BYTES } from '../src/sound-fonts/bank-format.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('assets/sound-fonts/catalog.json', root), 'utf8'));
const expectedBanks = [
  { id: 'generaluser-gs', format: 'sf2' },
  { id: 'fluidr3mono-gm', format: 'sf3' },
  { id: 'fluidr3-gm', format: 'sf3' },
];

// Read only the standardized directory records independently of the runtime
// inspector. Sample decoding and synthesis are exercised in the browser suite.
function riffDirectory(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'sfbk');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'the complete RIFF file is shipped');
  const lists = new Map();
  for (let offset = 12; offset < bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
    assert.ok(end <= bytes.length, 'RIFF chunk stays inside the downloaded file');
    if (bytes.toString('ascii', offset, offset + 4) === 'LIST') {
      const chunks = new Map();
      for (let child = offset + 12; child < end;) {
        const length = bytes.readUInt32LE(child + 4), stop = child + 8 + length;
        assert.ok(stop <= end, 'LIST child stays inside its parent');
        chunks.set(bytes.toString('ascii', child, child + 4), bytes.subarray(child + 8, stop));
        child = stop + (length & 1);
      }
      lists.set(bytes.toString('ascii', offset + 8, offset + 12), chunks);
    }
    offset = end + (size & 1);
  }
  const presets = lists.get('pdta').get('phdr'), samples = lists.get('pdta').get('shdr');
  assert.equal(presets.length % 38, 0);
  assert.equal(samples.length % 46, 0);
  assert.equal(presets.toString('ascii', presets.length - 38, presets.length - 35), 'EOP');
  assert.equal(samples.toString('ascii', samples.length - 46, samples.length - 43), 'EOS');
  const addresses = [];
  for (let offset = 0; offset < presets.length - 38; offset += 38) {
    addresses.push({ bank: presets.readUInt16LE(offset + 22), program: presets.readUInt16LE(offset + 20) });
  }
  let compressedSamples = 0;
  for (let offset = 0; offset < samples.length - 46; offset += 46) {
    if (samples.readUInt16LE(offset + 44) & 0x10) compressedSamples += 1;
  }
  return {
    addresses,
    version: lists.get('INFO').get('ifil').readUInt16LE(0),
    sampleCount: samples.length / 46 - 1,
    compressedSamples,
    sampleSignature: lists.get('sdta').get('smpl').toString('ascii', 0, 4),
  };
}

const address = ({ bank, program }) => `${bank}:${program}`;

for (const expected of expectedBanks) {
  test(`${expected.id} ships a verified ${expected.format.toUpperCase()} with all GM programs and percussion`, async () => {
    const matches = catalog.filter(bank => bank.id === expected.id);
    assert.equal(matches.length, 1, 'the requested bank has one catalog entry');
    const [bank] = matches, bytes = await readFile(new URL(bank.file, root));
    assert.equal(bank.format, expected.format);
    assert.equal(bank.fileExtension, `.${expected.format}`);
    assert.ok(bank.file.toLowerCase().endsWith(`.${expected.format}`), 'download extension identifies the real encoding');
    assert.ok(bytes.length > 1_000_000 && bytes.length <= MAX_SOUNDFONT_BYTES, 'the actual bank fits the common import limit');
    assert.equal(bytes.length, bank.bytes, 'advertised download size');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), bank.sha256, 'exact redistributed bank bytes');
    const actual = riffDirectory(bytes), inspected = inspectSoundFont(bytes);
    assert.equal(inspected.format, expected.format, 'runtime metadata follows content, not the filename');
    assert.equal(inspected.presetCount, actual.addresses.length);
    assert.equal(inspected.presetCount, bank.presetCount);
    assert.equal(inspected.sampleCount, actual.sampleCount);
    assert.ok(inspected.sampleCount > 0);
    assert.deepEqual(inspected.presets.map(address).sort(), actual.addresses.map(address).sort());
    assert.deepEqual(bank.presets.map(address).sort(), actual.addresses.map(address).sort(), 'Explore exposes every native bank/program address');

    const gm = new Set(actual.addresses.filter(preset => preset.bank === 0).map(preset => preset.program));
    assert.deepEqual([...gm].sort((a, b) => a - b), Array.from({ length: 128 }, (_, program) => program));
    assert.ok(actual.addresses.some(preset => preset.bank === 128 && preset.program === 0), 'standard GM percussion is available');
    if (expected.format === 'sf3') {
      assert.ok(actual.compressedSamples > 0, 'SF3 really contains compressed sample records');
      assert.equal(actual.sampleSignature, 'OggS', 'compressed payload has an Ogg Vorbis header');
    } else {
      assert.equal(actual.version, 2);
      assert.equal(actual.compressedSamples, 0, 'SF2 contains uncompressed PCM samples');
      assert.notEqual(actual.sampleSignature, 'OggS');
    }
    assert.match(bank.sourceUrl, /^https:\/\//);
    assert.ok(bank.attribution?.trim().length > 20, 'the bank retains its author attribution');
    assert.ok((await readFile(new URL(bank.creditFile, root), 'utf8')).trim().length > 100, 'distribution credits ship with the bank');
    assert.ok((await readFile(new URL(bank.licenseFile, root), 'utf8')).trim().length > 100, 'distribution license ships with the bank');
  });
}
