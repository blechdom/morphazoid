import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { createFractalDelayEngine } from '../src/instruments/fractal-delay/browser-engine.js';
import { buildNetwork } from '../src/instruments/fractal-delay/model.js';
import { estimateSceneBytes } from '../src/instruments/fractal-delay/wasm-runtime.js';

const artifact = await readFile(new URL('../assets/wasm/fractal-delay.wasm', import.meta.url));

// A held platform Worker makes the scene-admission boundary deterministic.
// There is no AudioContext or DSP in these visual-only engine tests; browser
// acceptance separately checks production Rust PCM and actual install ACKs.
async function fixture() {
  const originals = new Map(), intervals = new Map(); let clock = 0, serial = 0, worker;
  const replace = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace('navigator', { deviceMemory: 8 });
  replace('performance', { now: () => clock });
  replace('fetch', async () => new Response(artifact));
  replace('AudioContext', class { constructor() { assert.fail('visual motion must not create an AudioContext'); } });
  replace('setInterval', callback => { const id = ++serial; intervals.set(id, callback); return id; });
  replace('clearInterval', id => intervals.delete(id));
  replace('Worker', class {
    posts = []; terminated = false; waiters = [];
    constructor() { worker = this; }
    postMessage(data) {
      assert(!this.terminated, 'a disposed engine cannot request another scene');
      this.posts.push({ ...data, parameters: { ...data.parameters } });
      this.waiters.splice(0).forEach(resolve => resolve());
    }
    async waitForPosts(count) {
      while (this.posts.length < count) await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no worker job ${count}`)), 1000);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
    async install(index) {
      const job = this.posts[index], network = buildNetwork(job.parameters, 32);
      const sceneBytes = new TextEncoder().encode(JSON.stringify(network));
      await this.onmessage({ data: { type: 'prepared', revision: job.revision, network, sceneBytes,
        measurement: { cpuLoad: .05 }, requiredDelayBytes: estimateSceneBytes(network, job.sampleRate) } });
      await yieldEventLoop();
    }
    terminate() { this.terminated = true; }
  });
  const engine = createFractalDelayEngine({ parameters: { mode: 'inverse', detail: 2,
    realMotionTempo: 60, imagMotionTempo: 30, realMotionDepth: .035, imagMotionDepth: .035 } });
  const initial = engine.ready(); await worker.waitForPosts(1); await worker.install(0); await initial;
  return { engine, worker, async advance(milliseconds) {
    clock += milliseconds; for (const callback of [...intervals.values()]) callback(); await yieldEventLoop();
  }, async close() {
    await engine.dispose();
    assert.equal(intervals.size, 0, 'dispose removes the motion pump');
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  } };
}

test('the engine holds one visual scene and requests the latest elapsed-time pose after installation', async () => {
  const f = await fixture();
  try {
    const initial = f.engine.getDiagnostics();
    f.engine.setMotionPlaying('real', true); f.engine.setMotionPlaying('imag', true);
    await f.advance(100); await f.worker.waitForPosts(2);
    const waiting = f.worker.posts[1];
    for (let i = 0; i < 6; i++) await f.advance(100);
    assert.equal(f.worker.posts.length, 2, 'held admission cannot accumulate old motion scenes');
    assert.equal(f.engine.getDiagnostics().network.revision, initial.network.revision);
    await f.worker.install(1); await f.advance(100); await f.worker.waitForPosts(3);
    const latest = f.worker.posts[2], motion = f.engine.getDiagnostics().motion;
    assert.notEqual(latest.parameters.cReal, waiting.parameters.cReal);
    assert.notEqual(latest.parameters.cImag, waiting.parameters.cImag);
    assert.equal(latest.parameters.cReal, motion.real.value);
    assert.equal(latest.parameters.cImag, motion.imag.value);
    assert(latest.parameters.cReal >= motion.real.low && latest.parameters.cReal <= motion.real.high);
    assert(latest.parameters.cImag >= motion.imag.low && latest.parameters.cImag <= motion.imag.high);
    assert.equal(f.engine.getDiagnostics().audioDesired, false);
    assert.equal(f.engine.getDiagnostics().contextGeneration, 0);
    await f.worker.install(2);
  } finally { await f.close(); }
});

test('pause holds one axis, tempo preserves its phase, and disposing a held job cannot restart motion', async () => {
  const f = await fixture();
  try {
    f.engine.setMotionPlaying('real', true); f.engine.setMotionPlaying('imag', true);
    await f.advance(200); await f.worker.waitForPosts(2);
    const phase = f.engine.getDiagnostics().motion.real.phase;
    await f.engine.setParameters({ realMotionTempo: 12 });
    assert.equal(f.engine.getDiagnostics().motion.real.phase, phase, 'tempo editing at the same clock time keeps cycle phase');
    f.engine.setMotionPlaying('real', false);
    const paused = f.engine.getDiagnostics().motion.real;
    await f.advance(250);
    const later = f.engine.getDiagnostics();
    assert.equal(later.motion.real.value, paused.value); assert.equal(later.motion.real.phase, paused.phase);
    assert.equal(later.motion.real.playing, false); assert.equal(later.motion.imag.playing, true);
    assert.equal(later.contextState, 'uninitialized'); assert.equal(later.sourceCount, 0);
    const count = f.worker.posts.length; await f.engine.dispose();
    await f.worker.install(1); await f.advance(1000);
    assert.equal(f.worker.posts.length, count, 'late worker completion cannot re-arm disposed motion');
    assert.equal(f.engine.getDiagnostics().audioDesired, false);
  } finally { await f.close(); }
});

test('continuous manual coordinates install completed scenes and coalesce the newest waiting target', async () => {
  const f = await fixture();
  try {
    const initial = f.engine.getDiagnostics().network.revision;
    const first = f.engine.setParameters({ cReal: -.7, cImag: .1 });
    await f.worker.waitForPosts(2);
    const waiting = [];
    for (let i = 0; i < 6; i++) waiting.push(f.engine.setParameters({ cReal: -.6 + i * .02, cImag: .2 + i * .01 }));
    assert.equal(f.worker.posts.length, 2, 'new input cannot cancel or queue work behind the active worker job');
    for (const skipped of waiting.slice(0, -1)) assert.equal(await skipped, false);
    assert.equal(f.engine.getDiagnostics().network.revision, initial);
    await f.worker.install(1);
    assert.equal(await first, true, 'the graph in flight installs even though the pointer has moved ahead');
    await f.worker.waitForPosts(3);
    assert.equal(f.engine.getDiagnostics().network.parameters.cReal, -.7);
    assert.equal(f.engine.getDiagnostics().compiling, true, 'the latest pose is still preparing');
    assert.equal(f.worker.posts[2].parameters.cReal, -.6 + 5 * .02);
    assert.equal(f.worker.posts[2].parameters.cImag, .2 + 5 * .01);
    await f.worker.install(2);
    assert.equal(await waiting.at(-1), true);
    const final = f.engine.getDiagnostics();
    assert.equal(final.network.parameters.cReal, final.parameters.cReal);
    assert.equal(final.network.parameters.cImag, final.parameters.cImag);
    assert.equal(final.compiling, false); assert.equal(final.audioDesired, false);
    assert.equal(final.contextGeneration, 0); assert.equal(final.sourceCount, 0);
  } finally { await f.close(); }
});

test('disposing an active manual edit settles its waiting target and prevents late work from restarting', async () => {
  const f = await fixture();
  try {
    const active = f.engine.setParameters({ cReal: -.5 }); await f.worker.waitForPosts(2);
    const queued = f.engine.setParameters({ cImag: .4 });
    await f.engine.dispose();
    assert.equal(await active, false); assert.equal(await queued, false);
    await f.worker.install(1); await f.advance(1000);
    assert.equal(f.worker.posts.length, 2);
    assert.equal(f.engine.getDiagnostics().audioDesired, false);
  } finally { await f.close(); }
});
