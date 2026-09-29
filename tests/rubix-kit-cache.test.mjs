import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { RubixKitCache } from '../src/instruments/rubix/kit-cache.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

const kit = name => Object.freeze([{ name, duration: 0.5 }, { name: `${name}-hat`, duration: 0.1 }]);

async function prepare(cache, bank, key, buffers = kit(key)) {
  assert.equal(await cache.request(bank, key, async () => buffers), buffers);
  return buffers;
}

test('Rubix kit cache keeps the complete ready kit playable until replacement is complete', async () => {
  const cache = new RubixKitCache();
  const original = await prepare(cache, 'soft-fm', 'original');
  const next = kit('changed');
  const started = deferred();
  const finish = deferred();
  const request = cache.request('soft-fm', 'changed', async current => {
    assert.equal(current(), true);
    started.resolve();
    await finish.promise;
    return next;
  });
  await started.promise;
  assert.equal(cache.buffers.get('soft-fm'), original);
  assert.equal(cache.keys.get('soft-fm'), 'original');
  assert.equal(Array.isArray(cache.buffers.get('soft-fm')), true, 'audio must never see a pending promise');
  finish.resolve();
  assert.equal(await request, next);
  assert.equal(cache.buffers.get('soft-fm'), next);
  assert.equal(cache.keys.get('soft-fm'), 'changed');
});

test('Rubix kit cache coalesces simultaneous requests for the same bank and sound', async () => {
  const cache = new RubixKitCache();
  const finish = deferred();
  const next = kit('same');
  let calls = 0;
  const render = async () => { calls += 1; await finish.promise; return next; };
  const first = cache.request('modal', 'same', render);
  const second = cache.request('modal', 'same', render);
  await nextTurn();
  assert.equal(calls, 1);
  finish.resolve();
  assert.deepEqual(await Promise.all([first, second]), [next, next]);
  assert.equal(cache.buffers.get('modal'), next);
});

test('Rubix kit cache skips superseded queued edits and renders only the newest sound', async () => {
  const cache = new RubixKitCache();
  const calls = [];
  const first = cache.request('analog', 'first', async () => { calls.push('first'); return kit('first'); });
  const second = cache.request('analog', 'second', async () => { calls.push('second'); return kit('second'); });
  const newest = kit('newest');
  const third = cache.request('analog', 'newest', async () => { calls.push('newest'); return newest; });
  assert.deepEqual(await Promise.all([first, second, third]), [null, null, newest]);
  assert.deepEqual(calls, ['newest']);
  assert.equal(cache.buffers.get('analog'), newest);
});

test('Rubix kit cache reversion to the ready sound cancels a running edit without replacing audio', async () => {
  const cache = new RubixKitCache();
  const original = await prepare(cache, 'soft-fm', 'original');
  const started = deferred();
  const finish = deferred();
  let isCurrent;
  const request = cache.request('soft-fm', 'edited', async current => {
    isCurrent = current;
    started.resolve();
    await finish.promise;
    return kit('discarded');
  });
  await started.promise;
  const reverted = cache.request('soft-fm', 'original', async () => assert.fail('ready sound must not render again'));
  assert.equal(await reverted, original);
  assert.equal(isCurrent(), false);
  assert.equal(cache.buffers.get('soft-fm'), original);
  finish.resolve();
  assert.equal(await request, null);
  assert.equal(cache.buffers.get('soft-fm'), original);
  assert.equal(cache.keys.get('soft-fm'), 'original');
});

test('Rubix kit cache serializes rendering across banks', async () => {
  const cache = new RubixKitCache();
  const finishFirst = deferred();
  const firstStarted = deferred();
  const order = [];
  let active = 0;
  let maximumActive = 0;
  const render = (name, gate) => async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push(`${name}:start`);
    if (name === 'fm') firstStarted.resolve();
    if (gate) await gate.promise;
    order.push(`${name}:finish`);
    active -= 1;
    return kit(name);
  };
  const first = cache.request('soft-fm', 'fm', render('fm', finishFirst));
  const second = cache.request('rattlesnake', 'rattle', render('rattle'));
  await firstStarted.promise;
  await nextTurn();
  assert.deepEqual(order, ['fm:start']);
  finishFirst.resolve();
  await Promise.all([first, second]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ['fm:start', 'fm:finish', 'rattle:start', 'rattle:finish']);
});

test('Rubix kit cache retains ready audio after a render error and allows a successful retry', async () => {
  const cache = new RubixKitCache();
  const original = await prepare(cache, 'noise', 'original');
  await assert.rejects(cache.request('noise', 'changed', async () => { throw new Error('offline render failed'); }), /offline render failed/);
  assert.equal(cache.buffers.get('noise'), original);
  assert.equal(cache.keys.get('noise'), 'original');
  const recovered = await prepare(cache, 'noise', 'changed');
  assert.equal(cache.buffers.get('noise'), recovered);
  assert.equal(cache.keys.get('noise'), 'changed');
});

test('Rubix kit cache close discards in-flight buffers and permits a fresh context with the same key', async () => {
  const cache = new RubixKitCache();
  await prepare(cache, 'pitched-morph', 'original');
  const started = deferred();
  const finish = deferred();
  let isCurrent;
  const oldRequest = cache.request('pitched-morph', 'changed', async current => {
    isCurrent = current;
    started.resolve();
    await finish.promise;
    return kit('old-context');
  });
  await started.promise;
  cache.clear();
  assert.equal(isCurrent(), false);
  assert.equal(cache.buffers.size, 0);
  assert.equal(cache.keys.size, 0);
  const fresh = kit('new-context');
  const freshRequest = cache.request('pitched-morph', 'changed', async () => fresh);
  finish.resolve();
  assert.equal(await oldRequest, null);
  assert.equal(await freshRequest, fresh);
  assert.equal(cache.buffers.get('pitched-morph'), fresh);
});

test('Rubix kit cache stale render failure cannot clear a newer queued edit', async () => {
  const cache = new RubixKitCache();
  const original = await prepare(cache, 'modal', 'original');
  const started = deferred();
  const finish = deferred();
  const obsolete = cache.request('modal', 'obsolete', async () => { started.resolve(); return finish.promise; });
  const rejected = assert.rejects(obsolete, /obsolete render failed/);
  await started.promise;
  const newest = kit('newest');
  const replacement = cache.request('modal', 'newest', async () => newest);
  assert.equal(cache.buffers.get('modal'), original);
  finish.reject(new Error('obsolete render failed'));
  await rejected;
  assert.equal(await replacement, newest);
  assert.equal(cache.buffers.get('modal'), newest);
  assert.equal(cache.keys.get('modal'), 'newest');
});
