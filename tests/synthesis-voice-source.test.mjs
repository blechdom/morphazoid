import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceInputSource } from '../src/instruments/synthesis/voice-source.js';
import { defaultScene } from '../src/instruments/voicesaurus/native-model.js';

const abort = () => Object.assign(new Error('Render cancelled.'), { name: 'AbortError' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const value = (text = 'A local voice', engine = 'espeak') => ({ scene: defaultScene(engine), text });

/** Device-free double for NativeVoiceAudio's render/store and playback boundary.
 * Jobs remain pending until explicitly completed; cancellation rejects them and
 * late completion cannot mutate the retained phrase.
 */
class Player {
  enabled = false; playing = false; auditioning = false; loop = false;
  buffer = null; engine = null; position = 0; jobs = []; enables = []; plays = []; auditions = [];
  async enable(graph) { this.enables.push(graph); if (this.enableWait) await this.enableWait.promise; this.enabled = true; }
  setLevel(level) { this.level = level; }
  setLoop(loop) { this.loop = loop; }
  currentPosition() { return this.position; }
  cancelRender() { this.pending?.fail(abort()); }
  stopAudition() { this.auditioning = false; if (this.pending?.store === false) this.cancelRender(); }
  pause() { this.playing = false; this.stopAudition(); }
  async disable() { this.enabled = false; this.cancelRender(); this.pause(); }
  async close() { await this.disable(); this.closed = true; }
  render(request, { store = true } = {}) {
    this.cancelRender(); this.stopAudition();
    const task = deferred();
    const job = { request, store, settled: false,
      complete: (data = {}) => {
        if (job.settled) return;
        job.settled = true; if (this.pending === job) this.pending = null;
        const buffer = data.buffer ?? { duration: 4 };
        if (store) {
          const fraction = this.buffer?.duration ? this.position / this.buffer.duration : 0;
          this.pause(); this.buffer = buffer; this.engine = request.engine; this.position = fraction * buffer.duration;
        }
        task.resolve({ ...data, buffer, engine: request.engine });
      },
      fail: error => {
        if (job.settled) return;
        job.settled = true; if (this.pending === job) this.pending = null; task.reject(error);
      },
    };
    this.pending = job; this.jobs.push(job); return task.promise;
  }
  play(options = {}) {
    this.stopAudition();
    if (!this.enabled || !this.buffer) return false;
    if (options.offset !== undefined) this.position = options.offset;
    else if (options.restart || this.position >= this.buffer.duration) this.position = 0;
    this.plays.push(options); this.playing = true; return true;
  }
  audition(result) {
    if (!this.enabled) return false;
    this.auditions.push(result); this.auditioning = true; return true;
  }
  finish() { this.playing = false; this.position = this.buffer.duration; this.onEnded?.(); }
  finishAudition() { this.auditioning = false; this.onAuditionEnded?.(); }
}

function harness() {
  const host = { armed: true, context: { state: 'running' }, input: { analyser: {} } };
  const player = new Player(), changes = [], errors = [], activities = [], endings = [];
  const source = new VoiceInputSource({ host: () => host, player,
    changed: state => changes.push(state), error: error => errors.push(error),
    activity: active => activities.push(active), ended: () => endings.push(true),
  });
  return { host, player, source, changes, errors, activities, endings };
}

async function loaded(h, state = value(), options = {}, result = {}) {
  const pending = h.source.update(state, options); await tick();
  assert.ok(h.player.pending, 'an uncached voice requests native rendering');
  h.player.pending.complete(result); assert.equal(await pending, true); return h.player.buffer;
}

test('voice update, audition and seeking require armed, running host Audio and an input route', async () => {
  for (const unavailable of ['unarmed', 'suspended', 'missing-context', 'missing-input']) {
    const h = harness();
    if (unavailable === 'unarmed') h.host.armed = false;
    if (unavailable === 'suspended') h.host.context.state = 'suspended';
    if (unavailable === 'missing-context') h.host.context = null;
    if (unavailable === 'missing-input') h.host.input.analyser = null;
    assert.equal(await h.source.update(value(), { playing: true }), false);
    assert.equal(await h.source.audition(value().scene), false); assert.equal(h.source.seek(1), false);
    assert.equal(h.player.enables.length, 0); assert.equal(h.player.jobs.length, 0); assert.equal(h.player.plays.length, 0);
    assert.equal(h.source.wantsPlay, false); assert.equal(h.source.busy, false);
  }
});

test('native requests snapshot scene and text, borrow the host input and preserve paused transport', async () => {
  const h = harness(), state = value('Original text');
  const pending = h.source.update(state); await tick();
  state.scene.values.pitch = 12; state.text = 'Later text';
  assert.equal(h.player.level, .82); assert.deepEqual(h.player.enables, [{ context: h.host.context, destination: h.host.input.analyser }]);
  assert.equal(h.player.pending.request.text, 'Original text'); assert.equal(h.player.pending.request.values.pitch, 50);
  assert.equal(h.source.status().loading, true);
  h.player.pending.complete(); assert.equal(await pending, true);
  assert.equal(h.player.playing, false); assert.equal(h.player.plays.length, 0);
  assert.equal(h.source.status().duration, 4); assert.equal(h.source.status().engine, 'espeak');
  assert.equal(h.source.status().loading, false); assert.deepEqual(h.source.timings, []);
});

test('a replacement render preserves the sounding buffer and position until PCM is ready', async () => {
  const h = harness(), initial = await loaded(h, value('First'), { playing: true });
  h.player.position = 1;
  const pending = h.source.update(value('Replacement'), { playing: true }); await tick();
  assert.equal(h.player.buffer, initial); assert.equal(h.player.playing, true); assert.equal(h.player.plays.length, 1);
  assert.equal(h.source.status().loading, true); assert.equal(h.source.status().position, 1);
  h.player.pending.complete({ buffer: { duration: 8 } }); assert.equal(await pending, true);
  assert.notEqual(h.player.buffer, initial); assert.equal(h.player.position, 2); assert.equal(h.player.playing, true);
  assert.deepEqual(h.player.plays.at(-1), { restart: false }); assert.equal(h.source.busy, false);
});

test('identical pending requests share a render and use the latest playback and loop intention', async () => {
  const h = harness(), state = value();
  const first = h.source.update(state, { playing: false, loop: true }); await tick();
  const second = h.source.update(structuredClone(state), { playing: true, loop: false });
  assert.equal(h.player.jobs.length, 1); assert.equal(h.player.enables.length, 1);
  h.player.pending.complete(); assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(h.player.playing, true); assert.equal(h.player.loop, false); assert.equal(h.player.plays.length, 1);
});

test('explicit restart while an equivalent render is pending starts the replacement at zero', async () => {
  const h = harness();await loaded(h, value('Previous'), {playing:true});h.player.position=2;
  const state=value('Rendering');const first=h.source.update(state,{playing:true});await tick();
  const restarted=h.source.update(state,{playing:true,restart:true});
  assert.equal(h.player.jobs.length,2);h.player.pending.complete({buffer:{duration:8}});
  assert.deepEqual(await Promise.all([first,restarted]),[true,true]);assert.equal(h.player.position,0);
  assert.deepEqual(h.player.plays.at(-1),{restart:true});
});

test('a forced rerender cancels the equivalent pending job and ignores its late PCM', async () => {
  const h = harness(), state = value();
  const first = h.source.update(state, { playing: true }); await tick();const old = h.player.pending;
  const second = h.source.update(state, { playing: true, force: true }); await tick();
  assert.equal(await first, false); assert.equal(old.settled, true); assert.equal(h.player.jobs.length, 2);
  old.complete({ buffer: { duration: 99 } }); assert.equal(h.player.buffer, null);
  h.player.pending.complete(); assert.equal(await second, true); assert.equal(h.player.buffer.duration, 4); assert.deepEqual(h.errors, []);
});

test('returning to the cached voice cancels a different render before it can replace the selection', async () => {
  const h = harness(), state = value('Keep this voice'), original = await loaded(h, state, { playing: true });
  const replacement = h.source.update(value('Discard this voice'), { playing: true }); await tick();const stale = h.player.pending;
  assert.equal(await h.source.update(state, { playing: true }), true);
  stale.complete({ buffer: { duration: 99 } }); assert.equal(await replacement, false);
  assert.equal(h.player.buffer, original); assert.equal(h.player.playing, true); assert.equal(h.source.busy, false);
  assert.equal(h.player.jobs.length, 2); assert.deepEqual(h.errors, []);
});

for (const action of ['pause', 'deactivate', 'destroy']) test(`${action} cancels pending voice work and prevents late restart`, async () => {
  const h = harness(), initial = await loaded(h, value('Initial'), { playing: true });
  const pending = h.source.update(value('Late'), { playing: true }); await tick();const stale = h.player.pending;
  await h.source[action](); stale.complete(); assert.equal(await pending, false);
  assert.equal(h.player.buffer, initial); assert.equal(h.player.playing, false); assert.equal(h.source.wantsPlay, false); assert.equal(h.source.preview, false);
  assert.equal(h.source.busy, false); assert.equal(h.source.pending, null); assert.equal(h.source.pendingKey, null);
  assert.equal(h.activities.at(-1), false); assert.deepEqual(h.errors, []);
  if (action !== 'pause') assert.equal(h.player.enabled, false);
  if (action === 'destroy') assert.equal(h.player.closed, true);
});

test('pause during host attachment prevents rendering or playback after enable resolves', async () => {
  const h = harness(); h.player.enableWait = deferred();
  const pending = h.source.update(value(), { playing: true }); h.source.pause();
  h.player.enableWait.resolve(); assert.equal(await pending, false);
  assert.equal(h.player.jobs.length, 0); assert.equal(h.player.plays.length, 0); assert.equal(h.source.busy, false);
});

test('changing away from voice input during attachment cannot start a worker', async () => {
  const h = harness();h.player.enableWait = deferred();
  const pending = h.source.update(value(), { playing: true }); h.host.armed = false;
  h.player.enableWait.resolve(); assert.equal(await pending, false);
  assert.equal(h.player.jobs.length, 0); assert.equal(h.player.playing, false); assert.equal(h.source.busy, false);
});

test('native render errors retain the previous audio and a later edit can recover', async () => {
  const h = harness(), original = await loaded(h, value('Good'), { playing: true });
  const pending = h.source.update(value('Rejected native settings'), { playing: true }); await tick();
  const failure = new Error('Native synthesis failed.'); h.player.pending.fail(failure);
  assert.equal(await pending, false); assert.deepEqual(h.errors, [failure]);
  assert.equal(h.player.buffer, original); assert.equal(h.player.playing, true); assert.equal(h.source.busy, false);
  await loaded(h, value('Recovered'), { playing: true }); assert.notEqual(h.player.buffer, original); assert.equal(h.player.playing, true);
});

test('host attachment errors clear pending state and permit retry', async () => {
  const h = harness();h.player.enableWait = deferred();
  const pending = h.source.update(value(), { playing: true }); const failure = new Error('Host route unavailable.');
  h.player.enableWait.reject(failure); assert.equal(await pending, false); assert.deepEqual(h.errors, [failure]);
  assert.equal(h.source.busy, false); assert.equal(h.source.pending, null); assert.equal(h.player.jobs.length, 0);
  h.player.enableWait = null; await loaded(h, value(), { playing: true });
});

test('cached attachment failures use the same recoverable error callback as uncached failures', async () => {
  const h=harness(),state=value(),original=await loaded(h,state);h.source.deactivate();await tick();
  h.player.enableWait=deferred();const pending=h.source.update(state,{playing:true}),failure=new Error('Cached host route unavailable.');
  h.player.enableWait.reject(failure);assert.equal(await pending,false);assert.deepEqual(h.errors,[failure]);
  assert.equal(h.player.buffer,original);assert.equal(h.player.playing,false);assert.equal(h.source.busy,false);
  h.player.enableWait=null;assert.equal(await h.source.update(state,{playing:true}),true);assert.equal(h.player.jobs.length,1);
});

test('paused previews play once and the next primary Play restores the selected loop policy', async () => {
  const h = harness(), state = value();await loaded(h, state, { audition: true, restart: true, loop: true });
  assert.equal(h.source.wantsPlay, false); assert.equal(h.source.preview, true); assert.equal(h.player.loop, false); assert.equal(h.player.playing, true);
  h.player.finish(); assert.equal(h.source.preview, false); assert.equal(h.activities.at(-1), false); assert.equal(h.endings.length, 1);
  assert.equal(await h.source.update(state, { playing: true, loop: true }), true);
  assert.equal(h.player.jobs.length, 1); assert.equal(h.player.loop, true); assert.equal(h.player.playing, true); assert.equal(h.player.position, 0);
});

test('cached resume after pause or input deactivation keeps the buffer and current phase without rendering', async () => {
  for (const action of ['pause', 'deactivate']) {
    const h = harness(), state = value(), original = await loaded(h, state, { playing: true });h.player.position = 1.5;
    h.source[action](); await tick();assert.equal(h.player.playing, false);
    assert.equal(await h.source.update(state, { playing: true, loop: true }), true);
    assert.equal(h.player.buffer, original); assert.equal(h.player.jobs.length, 1); assert.equal(h.player.position, 1.5); assert.equal(h.player.playing, true);
  }
});

test('isolated note audition preserves cached phrase and loop, reports activity, and is cancellable', async () => {
  const h = harness(), state = value(), original = await loaded(h, state);h.player.position = 1.25;
  const request = defaultScene('singer'), audition = h.source.audition(request);await tick();
  assert.equal(h.player.pending.store, false);h.player.pending.complete({ buffer: { duration: .3 } });assert.equal(await audition, true);
  assert.equal(h.player.buffer, original);assert.equal(h.player.position, 1.25);assert.equal(h.player.loop, true);assert.equal(h.player.playing, false);
  assert.equal(h.source.status().auditioning, true);assert.equal(h.activities.at(-1), true);
  h.player.finishAudition();assert.equal(h.activities.at(-1), false);assert.equal(h.endings.length, 0);
  const cancelled = h.source.audition(request);await tick();const stale=h.player.pending;h.source.pause();stale.complete();assert.equal(await cancelled, false);
  assert.equal(h.player.auditions.length, 1);assert.equal(h.player.buffer, original);assert.equal(h.source.busy, false);
});

test('invalidating an active audition removes its activity without changing the cached phrase', async () => {
  const h = harness(), original = await loaded(h);const audition=h.source.audition(defaultScene('singer'));await tick();h.player.pending.complete();await audition;
  h.source.invalidate();assert.equal(h.player.auditioning, false);assert.equal(h.activities.at(-1), false);assert.equal(h.player.buffer, original);
});

test('seek cancels pending edits and follows cached audio without regenerating it', async () => {
  const h = harness(), original = await loaded(h, value('Cached'), { playing: true });
  const pending=h.source.update(value('Pending'), { playing: true });await tick();const stale=h.player.pending;
  assert.equal(h.source.seek(2.25), true);stale.complete();assert.equal(await pending, false);
  assert.equal(h.player.buffer, original);assert.deepEqual(h.player.plays.at(-1), { offset: 2.25 });assert.equal(h.source.status().position, 2.25);assert.equal(h.source.wantsPlay, true);
});

test('seeking from a one-shot preview restores primary playback and the selected Loop setting', async () => {
  for(const loop of [true,false]){
    const h=harness();await loaded(h,value(),{audition:true,loop});assert.equal(h.source.preview,true);assert.equal(h.player.loop,false);
    assert.equal(h.source.seek(1),true);assert.equal(h.source.preview,false);assert.equal(h.source.wantsPlay,true);assert.equal(h.player.loop,loop);
    assert.equal(h.player.position,1);assert.equal(h.player.jobs.length,1);
  }
});

test('native note timings win over nominal score projections', async () => {
  const h = harness(), noteTimings = [{ index: 0, start: .12, end: .68 }];
  await loaded(h, value('', 'singer'), {}, { noteTimings, scoreOffsetSeconds: 10 });assert.deepEqual(h.source.timings, noteTimings);
});

test('Sinsy timing fallback includes the native score offset and score tempo', async () => {
  const h = harness(), state=value('', 'sinsy');
  state.scene.input={tempo:120,notes:[{midi:60,beats:1,lyric:'あ'},{midi:null,beats:2,lyric:'',rest:true}]};
  await loaded(h, state, {}, { scoreOffsetSeconds: .125 });
  assert.deepEqual(h.source.timings, [{index:0,start:.125,end:.625},{index:1,start:.625,end:1.625}]);
});

test('musical phrase timing fallback follows each native duration including rests', async () => {
  const h=harness(),state=value('', 'singer');
  state.scene.input.phrase={tempo:90,notes:[{rest:false,input:{phone:'aah'},values:{...state.scene.values,duration:.4}},{rest:true,input:{phone:'aah'},values:{...state.scene.values,duration:.7}}]};
  await loaded(h,state,{}, {scoreOffsetSeconds:.05});
  assert.equal(h.source.timings[0].start,.05);assert.equal(h.source.timings[0].end,.45);
  assert.equal(h.source.timings[1].start,.45);assert.ok(Math.abs(h.source.timings[1].end-1.15)<1e-12);
});
