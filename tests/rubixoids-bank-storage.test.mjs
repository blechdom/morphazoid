import assert from 'node:assert/strict';
import test from 'node:test';
import { seedRubixoidsDrumBank, RUBIXOIDS_DRUM_BANK_KEY } from '../src/instruments/rubixoids/bank-storage.js';
import { FM_DRUM_STORAGE_KEY } from '../src/instruments/rubixoids/fm-drums/fm-drums.js';

const legacy = 'morphazoid:fm-drums:bank:v1';
function fixture(entries = []) {
  const values = new Map(entries);
  return { values, localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
}

test('Rubixoids snapshots a saved kit once and never writes or follows the standalone bank', () => {
  const bank = JSON.stringify([{ id: 'kick', frequency: 94, decay: .37 }]);
  const runtime = fixture([[legacy, bank]]);
  assert.equal(FM_DRUM_STORAGE_KEY, RUBIXOIDS_DRUM_BANK_KEY);
  assert.notEqual(FM_DRUM_STORAGE_KEY, legacy);
  seedRubixoidsDrumBank(runtime);
  assert.equal(runtime.values.get(RUBIXOIDS_DRUM_BANK_KEY), bank);
  assert.equal(runtime.values.get(legacy), bank);
  runtime.values.set(legacy, '[]');
  seedRubixoidsDrumBank(runtime);
  assert.equal(runtime.values.get(RUBIXOIDS_DRUM_BANK_KEY), bank);
  runtime.values.set(RUBIXOIDS_DRUM_BANK_KEY, '["edited in Rubixoids"]');
  seedRubixoidsDrumBank(runtime);
  assert.equal(runtime.values.get(RUBIXOIDS_DRUM_BANK_KEY), '["edited in Rubixoids"]');
  assert.equal(runtime.values.get(legacy), '[]');
});

test('an initially absent kit stays independent when the legacy page later saves one', () => {
  const runtime = fixture();
  seedRubixoidsDrumBank(runtime);
  assert.equal(runtime.values.get(RUBIXOIDS_DRUM_BANK_KEY), 'null');
  runtime.values.set(legacy, '[{"id":"kick","frequency":999}]');
  seedRubixoidsDrumBank(runtime);
  assert.equal(runtime.values.get(RUBIXOIDS_DRUM_BANK_KEY), 'null');
});

test('unavailable storage cannot prevent an instrument from starting with its default kit', () => {
  assert.doesNotThrow(() => seedRubixoidsDrumBank({ get localStorage() { throw new Error('unavailable'); } }));
  assert.doesNotThrow(() => seedRubixoidsDrumBank({ localStorage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } }));
});
