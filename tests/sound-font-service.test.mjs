import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { inspectSoundFont, MAX_SOUNDFONT_BYTES, createSoundFontService, createSoundFontSelection } from '../src/sound-fonts/bank-service.js';
import { temporaryLibrary } from '../src/sound-fonts/library.js';
import { temporaryLibrary as legacyLibrary } from '../src/site/sound-fonts/library.js';

const data = await readFile(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url));
const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const banks = JSON.parse(await readFile(new URL('../assets/sound-fonts/catalog.json', import.meta.url)));
const bank = banks.find(entry => entry.id === 'timgm6mb');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test('shared inspection identifies real GM coverage without decoding samples and preserves the old storage export', () => {
  assert.equal(legacyLibrary, temporaryLibrary);
  const info = inspectSoundFont(data);
  assert.equal(info.format, 'sf2'); assert.equal(info.presetCount, 136); assert.equal(info.sampleCount, 520);
  assert.equal(new Set(info.presets.filter(preset => preset.bank === 0).map(preset => preset.program)).size, 128);
  assert.ok(info.presets.some(preset => preset.bank === 128));
  assert.throws(() => inspectSoundFont(bytes.slice(0, -1)), /truncated|length/);
  assert.throws(() => inspectSoundFont(new TextEncoder().encode('PK ZIP archive content')), /not an SF2 or SF3/);
  assert.throws(() => inspectSoundFont(new ArrayBuffer(MAX_SOUNDFONT_BYTES + 1)), /128 MiB/);
  const compressed = bytes.slice(0), offset = data.indexOf(Buffer.from('ifil')) + 8;
  new DataView(compressed).setUint16(offset, 3, true);
  assert.equal(inspectSoundFont(compressed).format, 'sf3', 'SF3 metadata can be inspected without PCM decoding');
});

test('metadata listing is lazy; bundled bytes are verified before load and persisted only when accepted', async () => {
  const library = temporaryLibrary(), requested = [];
  const service = createSoundFontService({ library, crypto: webcrypto, fetch: async url => {
    requested.push(String(url)); return { ok: true, json: async () => [bank], arrayBuffer: async () => bytes };
  } });
  assert.equal((await service.list())[0].id, 'bundled-timgm6mb'); assert.equal(requested.length, 1);
  const result = await service.resolve('bundled-timgm6mb'); assert.equal(result.format, 'sf2'); assert.equal(requested.length, 2);
  assert.equal((await library.list()).length, 0);
  await service.save(result); assert.equal((await library.list()).length, 1);
  assert.equal((await service.list()).length, 1, 'a saved built-in is not duplicated');
  assert.equal((await service.resolve(result.id)).bytes, bytes); assert.equal(requested.length, 2);
  service.dispose();
});

test('corrupt downloads, missing saved data, malformed imports and oversize files fail before consumption', async () => {
  const library = temporaryLibrary(), corrupt = bytes.slice(0); new Uint8Array(corrupt)[1000] ^= 1;
  const service = createSoundFontService({ library, crypto: webcrypto, fetch: async () => ({ ok: true, json: async () => [bank], arrayBuffer: async () => corrupt }) });
  await assert.rejects(service.resolve('bundled-timgm6mb'), /integrity/);
  await library.put({ id: 'missing', name: 'Missing', kind: 'imported' });
  await assert.rejects(service.resolve('missing'), /missing/);
  let read = false;
  await assert.rejects(service.importFile({ size: MAX_SOUNDFONT_BYTES + 1, arrayBuffer() { read = true; } }), /128 MiB/);
  assert.equal(read, false);
  await assert.rejects(service.importFile({ size: 20, arrayBuffer: async () => new ArrayBuffer(20) }), /not an SF2 or SF3/);
  service.dispose();
});

test('imports become available across consumers through the same library, including format metadata', async () => {
  const library = temporaryLibrary(), fetch = async () => ({ ok: true, json: async () => [] });
  const first = createSoundFontService({ library, crypto: webcrypto, fetch }), second = createSoundFontService({ library, crypto: webcrypto, fetch });
  let notifications = 0; const off = await second.subscribe(() => notifications++);
  const imported = await first.importFile({ name: 'My Bank.sf2', size: bytes.byteLength, arrayBuffer: async () => bytes });
  await first.save(imported);
  assert.equal(notifications, 1); assert.equal((await second.list())[0].id, imported.id);
  const resolved = await second.resolve(imported.id); assert.equal(resolved.format, 'sf2'); assert.deepEqual(resolved.bytes, bytes);
  off(); first.dispose(); second.dispose();
});

test('latest selection wins slow downloads, failed replacement retains the working bank, and disposal cancels work', async () => {
  const slow = deferred(), pending = deferred(), loads = [], states = [];
  const result = id => ({ id, name: id, bytes, entry: { id } });
  const service = { resolve: id => id === 'slow' ? slow.promise : id === 'pending' ? pending.promise : Promise.resolve(result(id)), save: async () => {} };
  const selection = createSoundFontSelection({ service, onLoad: async value => { if (value.id === 'bad') throw new Error('Invalid sample bank'); loads.push(value.id); }, onState: value => states.push(value) });
  const older = selection.select('slow'); await selection.select('new'); slow.resolve(result('slow')); await older;
  assert.deepEqual(loads, ['new']); assert.equal(selection.current.id, 'new');
  await selection.select('bad'); assert.equal(selection.current.id, 'new'); assert.match(states.at(-1).error.message, /Invalid sample/);
  const cancelled = selection.select('pending'); selection.dispose(); pending.resolve(result('pending')); await cancelled;
  assert.deepEqual(loads, ['new']);
});

test('consumer commits are serialized and failed new selection reports an already committing predecessor accurately', async () => {
  const ack = deferred(), loads = [], states = [];
  const service = { resolve: async id => { if (id === 'bad') throw new Error('Unavailable'); return { id, name: id }; }, save: async () => {} };
  const selection = createSoundFontSelection({ service, onLoad: async result => { loads.push(result.id); if (result.id === 'first') await ack.promise; }, onState: value => states.push(value) });
  const first = selection.select('first'); await tick(); assert.deepEqual(loads, ['first']);
  const bad = selection.select('bad'); await tick(); ack.resolve(); await Promise.all([first, bad]);
  assert.equal(states.at(-1).current.id, 'first'); assert.match(states.at(-1).error.message, /Unavailable/);
  await selection.select('last'); assert.deepEqual(loads, ['first', 'last']); assert.equal(selection.current.id, 'last'); selection.dispose();
});
