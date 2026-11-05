import assert from 'node:assert/strict';
import test from 'node:test';
import { WebMidiManager } from '../src/midi-manager.js';
import { getSharedMidiOutputRoutes } from '../src/midi-output-routes.js';
import { mountBlechMidiOutput } from '../src/instruments/blech-midi/blech-midi-output.js';
import { installUniversalWaxAdapter } from '../scripts/wax/wax-universal-adapter.js';
import { createWaxHostBridge } from '../scripts/wax/wax-host-bridge.js';

function fixture({ wax = false, engineReady = null } = {}) {
  let time = 1000, requests = 0, adapter = null, waxRemoved = false;
  const makeOutput = id => ({ id, name: id, state: 'connected', sent: [], clears: 0,
    send(data, timestamp) { this.sent.push({ data: [...data], timestamp }); },
    clear() { this.clears++; },
  });
  const outputs = [makeOutput('synth-a'), makeOutput('synth-b')];
  const listeners = new Set();
  const access = {
    inputs: new Map(), outputs: new Map(outputs.map(output => [output.id, output])),
    addEventListener(type, listener) { listeners.add(listener); },
    removeEventListener(type, listener) { listeners.delete(listener); },
  };
  const runtime = { performance: { now: () => time }, navigator: { requestMIDIAccess: async () => { requests++; return access; } } };
  let bridge = null;
  if (wax === 'bridge') {
    runtime.document = { readyState: 'complete' };
    runtime.PlayheadInfo = { state: { isPlaying: true }, tempo: { bpm: 120 }, timing: { ppqPosition: 48 } };
    bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
    runtime.MorphazoidWAX = { register(value) { adapter = value; const unregister = bridge.register(value); return () => { waxRemoved = true; unregister(); }; } };
    bridge.start(); bridge.handleTransport('play');
  } else if (wax) runtime.MorphazoidWAX = { register(value) { adapter = value; return () => { waxRemoved = true; }; } };
  const manager = new WebMidiManager(runtime);
  const context = { state: 'running', currentTime: 1, getOutputTimestamp: () => ({ contextTime: 1, performanceTime: 1000 }) };
  const producer = () => ({ enabled: false, epoch: 0, listeners: new Set(), error: '',
    async setMidiOutput(enabled, epoch) { this.enabled = enabled; this.epoch = epoch; return enabled; },
    subscribeMidiOutput(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); },
    getMidiOutputError() { return this.error; },
    emit(events, extra = {}) { for (const listener of this.listeners) listener({ epoch: this.epoch, events, ...extra }, context); },
  });
  const engine = producer(), filePlayer = producer(), actions = [];
  if (engineReady) engine.setMidiOutput = async (enabled, epoch) => {
    engine.enabled = enabled; engine.epoch = epoch;
    if (enabled && await engineReady === false) { engine.enabled = false; return false; }
    return enabled;
  };
  let tempo = 120, playing = false;
  const transport = {
    play() { playing = true; actions.push(['play']); }, pause() { playing = false; actions.push(['pause']); },
    stop() { playing = false; actions.push(['stop']); }, getPlaying: () => playing, getTempo: () => tempo,
    setTempo(value) { tempo = value; actions.push(['tempo', value]); },
    seek(ppq, metadata) { actions.push(['seek', ppq, metadata]); },
  };
  const controller = mountBlechMidiOutput({ engine, filePlayer, transport, runtime, manager });
  const route = getSharedMidiOutputRoutes(runtime).get('blech-midi');
  return { controller, manager, route, engine, filePlayer, outputs, access, runtime, context, actions, bridge, transport,
    get requests() { return requests; }, get adapter() { return adapter; }, get waxRemoved() { return waxRemoved; },
    tick(milliseconds) { time += milliseconds; }, change() { for (const listener of listeners) listener(); },
  };
}
const note = (time = 1.1, id = 'n') => ({ type: 'noteOn', source: 'sample', time, id, channel: 2, note: 64, velocity: 92 });
const attacks = output => output.sent.filter(({ data }) => data[0] >> 4 === 9 && data[2] > 0);
const settled = async () => { await Promise.resolve(); await Promise.resolve(); };
const readyTurns = async () => { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); };

test('BLECH requests no permission at mount, and MIDI enable alone does not arm output', async () => {
  const f = fixture();
  assert.equal(f.requests, 0);
  assert.equal(f.route.getState().value, 'off');
  assert.equal(f.engine.enabled, false);
  await f.manager.enable(); await settled();
  assert.equal(f.requests, 1);
  assert.equal(f.manager.status().computerKeyboard.supported, false);
  assert.equal(f.outputs[0].sent.length, 0);
  f.engine.emit([note()]); assert.equal(f.outputs[0].sent.length, 0);
  await f.route.select('port:synth-a');
  assert.equal(f.engine.enabled, true); assert.equal(f.filePlayer.enabled, true);
  f.engine.emit([note(), { ...note(1.2), type: 'noteOff' }]);
  assert.deepEqual(attacks(f.outputs[0]).map(({ data, timestamp }) => ({ data, timestamp })), [{ data: [0x92, 64, 92], timestamp: 1100 }]);
  assert.ok(f.outputs[0].sent.some(({ data, timestamp }) => data[0] === 0x82 && timestamp === 1200));
  f.controller.destroy();
  assert.equal(getSharedMidiOutputRoutes(f.runtime).get('blech-midi'), null);
  assert.equal(f.engine.listeners.size, 0); assert.equal(f.filePlayer.listeners.size, 0);
});

test('port changes clear the former output, reject stale batches, and Off disarms both clocks', async () => {
  const f = fixture(); await f.manager.enable(); await f.route.select('port:synth-a');
  const oldEpoch = f.engine.epoch;
  f.engine.emit([note()]); const clears = f.outputs[0].clears;
  await f.route.select('port:synth-b');
  assert.ok(f.outputs[0].clears > clears);
  assert.ok(f.outputs[0].sent.some(({ data }) => data[0] === 0xb2 && data[1] === 123));
  f.engine.emit([note()], { epoch: oldEpoch });
  assert.equal(attacks(f.outputs[1]).length, 0);
  f.engine.emit([note(1.15, 'next')]); assert.equal(attacks(f.outputs[1]).length, 1);
  await f.route.select('off');
  assert.equal(f.engine.enabled, false); assert.equal(f.filePlayer.enabled, false);
  f.engine.emit([note(1.18, 'off')]); assert.equal(attacks(f.outputs[1]).length, 1);
  f.controller.destroy();
});

test('an explicit disconnected destination never redirects notes to another port', async () => {
  const f = fixture(); await f.manager.enable(); await f.route.select('port:synth-a');
  f.outputs[0].state = 'disconnected'; f.access.outputs.delete('synth-a'); f.change(); await settled();
  assert.equal(f.controller.state.active, false);
  assert.match(f.route.getState().error, /No MIDI output/);
  f.engine.emit([note()]); assert.equal(attacks(f.outputs[1]).length, 0);
  f.outputs[0].state = 'connected'; f.access.outputs.set('synth-a', f.outputs[0]); f.change(); await settled();
  assert.equal(f.controller.state.active, true);
  f.engine.emit([note()]); assert.equal(attacks(f.outputs[0]).length, 1);
  f.controller.destroy();
});

test('native WAX output starts only through host enable and never installs the companion adapter', async () => {
  const f = fixture({ wax: true });
  assert.equal(f.requests, 0, 'a WAX artifact in an ordinary browser stays inert');
  const universal = installUniversalWaxAdapter({ ...f.runtime, location: { pathname: '/blech-midi.html' } }, { body: {} });
  assert.equal(universal, null);
  await f.adapter.enableMidi(); await settled();
  assert.equal(f.requests, 1); assert.equal(f.route.getState().value, 'host');
  assert.equal(f.engine.enabled, true);
  f.adapter.transport.play({ ppqPosition: 48, bpm: 120, isPlaying: true });
  assert.equal(attacks(f.outputs[0]).length, 0, 'host transport must not invent companion notes');
  const initialSeek = f.actions.find(([name]) => name === 'seek');
  assert.equal(initialSeek[2].deltaBeats, 0, 'a DAW offset establishes the origin without skipping the new score');
  f.engine.emit([note()]); assert.equal(attacks(f.outputs[0]).length, 1);
  f.tick(100); f.adapter.transport.playhead({ ppqPosition: 48.2, bpm: 120, isPlaying: true });
  assert.equal(f.actions.filter(([name]) => name === 'seek').length, 1);
  f.tick(100); f.adapter.transport.playhead({ ppqPosition: 44, bpm: 120, isPlaying: true });
  assert.ok(Math.abs(f.actions.at(-1)[2].deltaBeats + 4.4) < 1e-6);
  f.adapter.transport.stop({ ppqPosition: 44.1, bpm: 120 });
  assert.ok(f.actions.some(([name]) => name === 'pause'));
  assert.ok(!f.actions.some(([name]) => name === 'stop'), 'host stop preserves layers for restart');
  f.tick(2000); f.adapter.transport.playhead({ ppqPosition: 40, bpm: 120, isPlaying: false });
  f.adapter.transport.play({ ppqPosition: 40, bpm: 120, isPlaying: true });
  const restart = f.actions.filter(([name]) => name === 'seek').at(-1);
  assert.ok(Math.abs(restart[2].deltaBeats + 4.1) < 1e-6, 'stopped time never advances the host phase');
  f.controller.destroy(); assert.equal(f.waxRemoved, true);
});

test('a fatal stream failure disarms producers and can be recovered with an explicit selection', async () => {
  const f = fixture(); await f.manager.enable(); await f.route.select('port:synth-a');
  f.engine.emit([], { overflow: true }); await settled();
  assert.equal(f.engine.enabled, false); assert.equal(f.filePlayer.enabled, false);
  assert.match(f.route.getState().error, /capacity/);
  await f.route.select('off'); await f.route.select('port:synth-a');
  assert.equal(f.controller.state.active, true); assert.equal(f.route.getState().error, '');
  f.controller.destroy();
});

test('retained WAX Play waits for both clocks, then uses the latest host position once', async () => {
  let resolve; const engineReady = new Promise(done => { resolve = done; });
  const f = fixture({ wax: 'bridge', engineReady });
  await readyTurns();
  assert.equal(f.requests, 1);
  assert.equal(f.controller.state.ready, false);
  assert.equal(f.filePlayer.enabled, false);
  assert.equal(f.actions.filter(([name]) => name === 'play').length, 0);
  f.tick(500); f.adapter.transport.playhead({ ppqPosition: 49, bpm: 120, isPlaying: true });
  assert.equal(f.actions.filter(([name]) => name === 'play').length, 0);
  resolve(); await readyTurns();
  assert.equal(f.controller.state.ready, true);
  assert.equal(f.filePlayer.enabled, true);
  assert.equal(f.actions.filter(([name]) => name === 'play').length, 1);
  const origin = f.actions.find(([name]) => name === 'seek');
  assert.equal(origin[1], 49); assert.equal(origin[2].deltaBeats, 0);
  f.controller.destroy(); f.bridge.dispose();
});

test('WAX Stop during clock preparation cancels the retained start', async () => {
  let resolve; const engineReady = new Promise(done => { resolve = done; });
  const f = fixture({ wax: 'bridge', engineReady }); await readyTurns();
  f.runtime.PlayheadInfo.state.isPlaying = false; f.bridge.handleTransport('stop');
  resolve(); await readyTurns();
  assert.equal(f.controller.state.ready, true);
  assert.equal(f.actions.filter(([name]) => name === 'play').length, 0);
  assert.ok(f.actions.some(([name]) => name === 'pause'));
  f.controller.destroy(); f.bridge.dispose();
});

test('failed clock preparation never launches retained WAX playback', async () => {
  const f = fixture({ wax: 'bridge', engineReady: Promise.resolve(false) }); await readyTurns();
  assert.equal(f.controller.state.ready, false);
  assert.equal(f.controller.state.active, false);
  assert.match(f.route.getState().error, /Could not start the MIDI clock/);
  assert.equal(f.actions.filter(([name]) => name === 'play').length, 0);
  f.controller.destroy(); f.bridge.dispose();
});

test('ordinary host tempo changes preserve held notes and producer epochs', async () => {
  const f = fixture({ wax: true }); await f.adapter.enableMidi();
  f.adapter.transport.play({ ppqPosition: 0, bpm: 120, isPlaying: true });
  f.engine.emit([note()]);
  const epoch = f.engine.epoch, clears = f.outputs[0].clears, fileEpoch = f.filePlayer.epoch;
  f.adapter.transport.bpm(148); await readyTurns();
  assert.equal(f.engine.epoch, epoch); assert.equal(f.filePlayer.epoch, fileEpoch);
  assert.equal(f.outputs[0].clears, clears);
  assert.equal(f.controller.stats.held, 1);
  assert.deepEqual(f.actions.at(-1), ['tempo', 148]);
  f.controller.destroy();
});

test('explicit WAX Stop releases manual playback even when the DAW was already stopped', async () => {
  const f = fixture({ wax: true }); await f.adapter.enableMidi();
  f.adapter.transport.playhead({ ppqPosition: 0, bpm: 120, isPlaying: false });
  f.transport.play(); f.engine.emit([note()]);
  const epoch = f.engine.epoch;
  f.adapter.transport.playhead({ ppqPosition: 0, bpm: 120, isPlaying: false });
  assert.equal(f.transport.getPlaying(), true, 'stopped polling does not cancel a manual drop');
  f.adapter.transport.stop({ ppqPosition: 0, bpm: 120, isPlaying: false });
  assert.equal(f.transport.getPlaying(), false);
  assert.ok(f.engine.epoch > epoch);
  assert.equal(f.controller.stats.held, 0);
  f.controller.destroy();
});
