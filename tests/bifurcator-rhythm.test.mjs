import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  BifurcatorEngine, DEFAULT_PARAMS, MODELS, PARAM_RANGES, ENUM_PARAMS,
  createPreset, normalizeParams, randomizeParams,
} from '../src/instruments/bifurcator/model.js';
import { PRESETS, captureScene, randomizeScene } from '../src/instruments/bifurcator/presets.js';

const make = (model = 'lorenz', patch = {}, sampleRate = 12000) => {
  const engine = new BifurcatorEngine(sampleRate);
  engine.setParams(createPreset(model, {
    sonification: 'rhythm', headCount: 16, frequency: 90,
    tempo: 120, headRate: .35, pitchSpan: 1.5, ...patch,
  }));
  engine.reset();
  return engine;
};
const run = (engine, seconds) => {
  const frames = Math.round(engine.sampleRate * seconds);
  let energy = 0, leftEnergy = 0, rightEnergy = 0, difference = 0, peak = 0;
  let invalid = false;
  for (let frame = 0; frame < frames; frame++) {
    const mono = engine.sample(), left = engine.left, right = engine.right;
    invalid ||= ![mono, left, right].every(Number.isFinite);
    peak = Math.max(peak, Math.abs(mono), Math.abs(left), Math.abs(right));
    energy += mono * mono; leftEnergy += left * left; rightEnergy += right * right;
    difference += (left - right) ** 2;
  }
  assert.equal(invalid, false, `${engine.params.model}: all actual audio channels are finite`);
  assert.ok(peak <= .8, `${engine.params.model}: output bound ${peak}`);
  return {
    rms: Math.sqrt(energy / frames), leftRms: Math.sqrt(leftEnergy / frames),
    rightRms: Math.sqrt(rightEnergy / frames), differenceRms: Math.sqrt(difference / frames), peak,
  };
};
const clone = value => JSON.parse(JSON.stringify(value));
const clockState = engine => engine.exportState().shape.heads.map(head => ({
  phase: head.phase, secondaryPhase: head.secondaryPhase, beatPhase: head.beatPhase,
  pulseAge: head.pulseAge, pulseEnvelope: head.pulseEnvelope, decayEnvelope: head.decayEnvelope,
  hits: head.hits, rhythmInitialized: head.rhythmInitialized,
}));
const assertJoinedFrames = (original, joined, frames) => {
  for (let frame = 0; frame < frames; frame++) {
    assert.equal(joined.sample(), original.sample(), `mono frame ${frame}`);
    assert.equal(joined.left, original.left, `left frame ${frame}`);
    assert.equal(joined.right, original.right, `right frame ${frame}`);
  }
  assert.deepEqual(joined.exportState(), original.exportState());
};

test('all five real systems drive sixteen audible rhythm heads on the sample clock', () => {
  for (const model of MODELS) {
    const engine = make(model.id, {
      panAxis: 'horizontal', panWidth: .9, tempoAxis: 'height', tempoSpan: 1.5,
      pulseVoice: 'bell', headSpread: 1.4,
    });
    const initial = engine.snapshot().point;
    assert.ok(run(engine, 2).rms > .002, `${model.id}: audible rhythm energy`);
    const state = engine.snapshot();
    assert.notDeepEqual(state.point, initial, `${model.id}: actual mathematics evolves`);
    assert.equal(state.shape.heads.length, 16);
    assert.ok(state.shape.heads.every(head => head.hits > 0), `${model.id}: every head actually strikes`);
    assert.ok(state.shape.heads.every(head => head.beatPhase >= 0 && head.beatPhase < 1));
    assert.ok(state.shape.count > 100 && state.shape.count <= 1024);
    assert.ok(state.diagnostics.integrationSteps <= 8);
  }
});

test('pitch, travel, and rhythm controls do not clock growth of any mathematical system', () => {
  for (const model of MODELS) {
    const slow = make(model.id, { frequency: 55, headRate: .03, tempo: 30, pitchSpan: 0 });
    const fast = make(model.id, {
      frequency: 1200, headRate: 3, tempo: 240, pitchSpan: 3, headSpread: 3,
      tempoAxis: 'depth', tempoSpan: 3, rhythmRatios: 'fibonacci',
      travelAxis: 'height', travelSpan: 3, amplitudeAxis: 'center', amplitudeDepth: .7,
      panAxis: 'angle', panWidth: 1,
    });
    run(slow, 1.25); run(fast, 1.25);
    assert.deepEqual(fast.snapshot().point, slow.snapshot().point, `${model.id}: same real orbit`);
    assert.deepEqual(fast.snapshot().shape.points, slow.snapshot().shape.points, `${model.id}: same retained contour`);
    assert.deepEqual(fast.snapshot().shape.depths, slow.snapshot().shape.depths);
    assert.ok(fast.snapshot().shape.heads[0].hits > slow.snapshot().shape.heads[0].hits,
      `${model.id}: tempo changes actual strikes independently`);
    assert.notEqual(fast.snapshot().shape.heads[0].phase, slow.snapshot().shape.heads[0].phase);
  }
});

test('tempo mapping and two : three : four ratios change actual strikes, whose pulses reach the audio output', () => {
  const slow = make('fold', { growShape: false, headCount: 1, regime: 0,
    tempo: 120, tempoAxis: 'height', tempoSpan: 2, pitchSpan: 0 });
  const fast = make('fold', { growShape: false, headCount: 1, regime: 1,
    tempo: 120, tempoAxis: 'height', tempoSpan: 2, pitchSpan: 0 });
  run(slow, .137); run(fast, .137);
  const slowHits = slow.snapshot().shape.heads[0].hits, fastHits = fast.snapshot().shape.heads[0].hits;
  run(slow, 3); run(fast, 3);
  assert.equal(slow.snapshot().shape.heads[0].tempo, 60);
  assert.equal(fast.snapshot().shape.heads[0].tempo, 240);
  assert.equal(slow.snapshot().shape.heads[0].hits - slowHits, 3);
  assert.equal(fast.snapshot().shape.heads[0].hits - fastHits, 12);

  const ratios = make('fold', { growShape: false, headCount: 3, rhythmRatios: 'two-three-four', tempo: 120 });
  run(ratios, .137);
  const before = ratios.snapshot().shape.heads.map(head => head.hits);
  run(ratios, 3);
  assert.deepEqual(ratios.snapshot().shape.heads.map((head, index) => head.hits - before[index]), [6, 9, 12]);

  const pulse = make('fold', { growShape: false, headCount: 1, tempo: 120,
    frequency: 220, pitchSpan: 0, pulseDecay: .025 });
  run(pulse, .2);
  let quiet = 0, loud = 0, quietFrames = 0, loudFrames = 0, strikeAt = null;
  const initialHits = pulse.snapshot().shape.heads[0].hits;
  for (let frame = 0; frame < 4800; frame++) {
    const value = pulse.sample(), elapsed = (frame + 1) / pulse.sampleRate;
    if (elapsed > .15 && elapsed < .25) { quiet += value * value; quietFrames++; }
    if (elapsed > .31 && elapsed < .36) { loud += value * value; loudFrames++; }
    if (strikeAt === null && pulse.snapshot().shape.heads[0].hits > initialHits) strikeAt = elapsed;
  }
  assert.ok(Math.abs(strikeAt - .3) <= 1 / pulse.sampleRate + 1e-12,
    '120 BPM produces its next sample-owned strike at half a second');
  assert.ok(Math.sqrt(loud / loudFrames) > .02, 'the reported strike produces an audible pulse');
  assert.ok(Math.sqrt(loud / loudFrames) > Math.sqrt(quiet / quietFrames) * 20,
    'audio pulses decay between strikes rather than playing a continuous mislabeled carrier');
});

test('Grow holds the real contour while travel and beats continue; Pause releases and freezes all clocks', () => {
  const engine = make('lorenz', { tempo: 180, headSpread: 1 });
  run(engine, 1.5);
  engine.setParams({ growShape: false });
  const held = engine.snapshot();
  assert.ok(run(engine, .7).rms > .002);
  const moving = engine.snapshot();
  assert.deepEqual(moving.point, held.point);
  assert.deepEqual(moving.shape.points, held.shape.points);
  assert.deepEqual(moving.shape.depths, held.shape.depths);
  assert.notDeepEqual(moving.shape.heads.map(head => head.position), held.shape.heads.map(head => head.position));
  assert.ok(moving.shape.heads.every((head, index) => head.hits > held.shape.heads[index].hits));
  engine.setParams({ playing: false }); run(engine, .3);
  const paused = engine.snapshot(), clocks = clockState(engine);
  assert.equal(paused.diagnostics.paused, true);
  assert.ok(run(engine, .3).rms < 1e-8);
  assert.deepEqual(engine.snapshot().point, paused.point);
  assert.deepEqual(engine.snapshot().shape, paused.shape);
  assert.deepEqual(clockState(engine), clocks);
  assert.equal(engine.snapshot().diagnostics.time, paused.diagnostics.time);
  engine.setParams({ playing: true }); run(engine, .4);
  assert.deepEqual(engine.snapshot().point, held.point, 'held growth survives transport resume');
  assert.ok(engine.snapshot().shape.heads.some((head, index) => head.hits > paused.shape.heads[index].hits));
});

test('a rolling sixteen-head stereo state joins sample-exactly through route and model crossfades', () => {
  const engine = make('lorenz', {
    panAxis: 'depth', panWidth: .9, tempoAxis: 'height', tempoSpan: 2,
    rhythmRatios: 'fibonacci', pulseVoice: 'bell', travelAxis: 'depth', travelSpan: 2,
    amplitudeAxis: 'center', amplitudeDepth: .6, headSpread: 2,
  }, 8000);
  assert.ok(run(engine, 9.2).differenceRms > .001);
  assert.equal(engine.snapshot().shape.count, 1024);
  const joined = new BifurcatorEngine(8000);
  assert.equal(joined.importState(clone(engine.exportState())), true);
  assertJoinedFrames(engine, joined, 1000);
  for (const patch of [
    { panAxis: 'angle', pulseVoice: 'tick', rhythmRatios: 'two-three-four' },
    { sonification: 'shape', pitchAxis: 'bend', travelAxis: 'path' },
    { model: 'rossler', sonification: 'rhythm', pulseVoice: 'kick' },
    { sonification: 'orbit' },
    { sonification: 'rhythm', growShape: true },
  ]) {
    engine.setParams(patch); joined.setParams(patch);
    assertJoinedFrames(engine, joined, 173);
    const recovered = new BifurcatorEngine(8000);
    assert.equal(recovered.importState(clone(engine.exportState())), true);
    assertJoinedFrames(engine, recovered, 211);
    assert.equal(joined.importState(clone(engine.exportState())), true);
  }
});

test('cross-rate stereo recovery retains beat/carrier/envelope state and continues physical seconds', () => {
  const engine = make('lorenz', {
    panAxis: 'height', panWidth: .8, tempo: 120, pulseVoice: 'bell', pitchSpan: .6,
  }, 12000);
  run(engine, .73);
  engine.setParams({ growShape: false });
  run(engine, .02);
  const saved = clone(engine.exportState());
  const recovered = new BifurcatorEngine(48000);
  assert.equal(recovered.importState(saved), true);
  assert.deepEqual(clockState(recovered), clockState(engine));
  assert.deepEqual(recovered.exportState().stereo, saved.stereo);
  assert.deepEqual(recovered.snapshot().point, saved.point);
  assert.deepEqual(recovered.snapshot().shape, engine.snapshot().shape);
  assert.ok(run(engine, .4).rms > .002);
  assert.ok(run(recovered, .4).rms > .002);
  const a = engine.snapshot(), b = recovered.snapshot();
  assert.deepEqual(a.point, b.point);
  for (let index = 0; index < 16; index++) {
    assert.equal(a.shape.heads[index].hits, b.shape.heads[index].hits, `head ${index}: no replayed or lost strike`);
    assert.ok(Math.abs(a.shape.heads[index].beatPhase - b.shape.heads[index].beatPhase) < 1e-10,
      `head ${index}: tempo phase follows seconds at either rate`);
  }
  assert.ok(Math.abs(a.diagnostics.time - b.diagnostics.time) < 1e-10);
});

test('routes, full presets, and model replacement preserve oscillator and beat clocks until Reset', () => {
  const engine = make(); run(engine, .77);
  const originalPoint = [...engine.snapshot().point];
  for (const patch of [
    { pitchAxis: 'depth', travelAxis: 'height', tempoAxis: 'angle', panAxis: 'center' },
    PRESETS.find(preset => preset.id === 'rhythm-glass-sixteen').snapshot,
    { model: 'rossler' },
    { sonification: 'shape' },
    { sonification: 'rhythm' },
  ]) {
    const before = clockState(engine);
    engine.setParams(patch);
    assert.deepEqual(clockState(engine), before, 'parameter messages do not reset real musical clocks');
    assert.equal(engine.params.playing, true);
  }
  assert.equal(engine.snapshot().shape.count, 1);
  assert.notDeepEqual(engine.snapshot().point, originalPoint);
  run(engine, .1); engine.reset();
  assert.ok(clockState(engine).every(head => head.phase === 0 && head.secondaryPhase === 0
    && head.beatPhase === 0 && head.hits === 0 && head.pulseEnvelope === 0));
  assert.equal(engine.snapshot().shape.count, 1);
});

test('continuous Shape suspends hidden pulse clocks and re-entry resumes them without a phantom strike', () => {
  const engine = make('lorenz', { growShape: false }); run(engine, .37);
  engine.setParams({ sonification: 'shape' });
  const before = clockState(engine);
  assert.ok(run(engine, .3).rms > .01);
  const after = clockState(engine);
  for (let index = 0; index < 16; index++) {
    assert.equal(after[index].beatPhase, before[index].beatPhase);
    assert.equal(after[index].hits, before[index].hits);
    assert.equal(after[index].pulseEnvelope, before[index].pulseEnvelope);
    assert.equal(after[index].secondaryPhase, before[index].secondaryPhase);
  }
  assert.notEqual(after[0].phase, before[0].phase, 'continuous carrier is still live');
  engine.setParams({ sonification: 'rhythm' });
  assert.deepEqual(clockState(engine), after);
  engine.sample();
  assert.ok(engine.snapshot().shape.heads.every((head, index) => head.hits === after[index].hits),
    'resuming rhythm does not repeat its initial activation strike');
});

test('legacy four-head v1 state joins the old reference sound with centered stereo exactly', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/bifurcator-v1-reference.json', import.meta.url), 'utf8'));
  assert.equal(fixture.state.shape.version, 1);
  assert.equal(fixture.state.shape.heads.length, 4);
  assert.equal(Object.hasOwn(fixture.state, 'stereo'), false);
  const engine = new BifurcatorEngine(fixture.sampleRate);
  assert.equal(engine.importState(fixture.state), true);
  assert.equal(engine.left, fixture.state.output);
  assert.equal(engine.right, fixture.state.output);
  for (const [index, expected] of fixture.nextSamples.entries()) {
    const mono = engine.sample();
    assert.equal(mono, expected, `unchanged old mono sample ${index}`);
    assert.equal(engine.left, mono, `centered left sample ${index}`);
    assert.equal(engine.right, mono, `centered right sample ${index}`);
  }
});

test('geometry pan routes produce real opposing stereo energy while mono remains the established reference', () => {
  const low = make('fold', { sonification: 'shape', regime: 0, growShape: false,
    headCount: 1, frequency: 110, pitchSpan: 0, panAxis: 'height', panWidth: 1 });
  const high = make('fold', { sonification: 'shape', regime: 1, growShape: false,
    headCount: 1, frequency: 110, pitchSpan: 0, panAxis: 'height', panWidth: 1 });
  run(low, .2); run(high, .2);
  const a = run(low, .2), b = run(high, .2);
  assert.ok(a.leftRms > .05 && a.rightRms < a.leftRms * .001, 'low geometry actually sounds on the left');
  assert.ok(b.rightRms > .05 && b.leftRms < b.rightRms * .001, 'high geometry actually sounds on the right');
  assert.equal(a.rms, b.rms, 'pan does not change the mono reference');
  assertJoinedFrames(low, (() => { const copy = new BifurcatorEngine(12000); copy.importState(clone(low.exportState())); return copy; })(), 50);
});

test('None routes ignore their spans/depths; amplitude mapping changes actual loudness', () => {
  const plain = make('fold', { sonification: 'shape', growShape: false, headCount: 1, pitchSpan: 0 });
  const none = make('fold', { sonification: 'shape', growShape: false, headCount: 1, pitchSpan: 0,
    travelAxis: 'none', travelSpan: 3, amplitudeAxis: 'none', amplitudeDepth: 1,
    panAxis: 'none', panWidth: 1, tempoAxis: 'none', tempoSpan: 3 });
  for (let frame = 0; frame < 4000; frame++) {
    assert.equal(none.sample(), plain.sample(), `None route mono frame ${frame}`);
    assert.equal(none.left, plain.left); assert.equal(none.right, plain.right);
  }
  const loud = make('fold', { sonification: 'shape', growShape: false, headCount: 1,
    regime: 1, pitchSpan: 0, amplitudeAxis: 'height', amplitudeDepth: 1 });
  const quiet = make('fold', { sonification: 'shape', growShape: false, headCount: 1,
    regime: 0, pitchSpan: 0, amplitudeAxis: 'height', amplitudeDepth: 1 });
  run(loud, .2); run(quiet, .2);
  assert.ok(run(loud, .2).rms > run(quiet, .2).rms * 4, 'mapped amplitude is not canceled by voice normalization');
});

test('all fifty presets own every musical parameter, normalize reproducibly, and retain transport', () => {
  const keys = Object.keys(DEFAULT_PARAMS).filter(key => key !== 'playing').sort();
  assert.equal(PRESETS.length, 50);
  assert.equal(new Set(PRESETS.map(preset => preset.id)).size, 50);
  const modes = new Set();
  for (const preset of PRESETS) {
    assert.deepEqual(Object.keys(preset.snapshot).sort(), keys, preset.id);
    assert.deepEqual(captureScene(preset.snapshot), preset.snapshot, `${preset.id}: already normalized`);
    const engine = make('fold', { playing: false, headCount: 16, panWidth: 1, amplitudeDepth: 1 });
    engine.setParams(preset.snapshot);
    assert.equal(engine.params.playing, false, preset.id);
    assert.deepEqual(captureScene(engine.params), preset.snapshot, `${preset.id}: owns previous settings`);
    modes.add(preset.snapshot.sonification);
  }
  assert.deepEqual([...modes].sort(), ['orbit', 'rhythm', 'shape']);
});

test('seeded randomization reaches every enum, model, head count, boolean, and numeric musical control', () => {
  const seen = Object.fromEntries([...Object.keys(PARAM_RANGES), ...Object.keys(ENUM_PARAMS), 'model', 'growShape'].map(key => [key, new Set()]));
  let seed = 98127;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 512; index++) {
    const playing = index % 2 === 0;
    const patch = randomizeParams({ ...DEFAULT_PARAMS, playing, masterGain: .2, outputDevice: 'external', beatPhase: .7 }, random);
    assert.equal(patch.playing, playing);
    assert.deepEqual(normalizeParams(patch), patch);
    assert.deepEqual(Object.keys(patch).sort(), Object.keys(DEFAULT_PARAMS).sort(), 'device/master/runtime clocks are not randomized parameters');
    for (const key of Object.keys(seen)) seen[key].add(patch[key]);
    assert.deepEqual(Object.keys(randomizeScene(patch, random)).sort(), Object.keys(captureScene(DEFAULT_PARAMS)).sort());
  }
  for (const [key, choices] of Object.entries(ENUM_PARAMS)) assert.equal(seen[key].size, choices.length, key);
  assert.equal(seen.model.size, MODELS.length); assert.equal(seen.headCount.size, 16); assert.equal(seen.growShape.size, 2);
  for (const key of Object.keys(PARAM_RANGES)) assert.ok(seen[key].size > 1, `${key}: actually randomized`);
});

test('corrupted stereo or sixteenth-head state is rejected without altering a live engine', () => {
  const engine = make('lorenz', { panAxis: 'depth', panWidth: 1 }); run(engine, .23);
  const before = clone(engine.exportState());
  for (const mutate of [
    state => { state.stereo.filter[7] = NaN; },
    state => { state.stereo.output[1] = .81; },
    state => { state.shape.heads[15].beatPhase = 1; },
    state => { state.shape.heads[15].pulseEnvelope = -1; },
    state => { state.shape.depths.pop(); },
    state => { state.shape.heads.pop(); },
  ]) {
    const invalid = clone(before); mutate(invalid);
    assert.equal(engine.importState(invalid), false);
    assert.deepEqual(engine.exportState(), before);
  }
});

test('Worklet writes actual stereo with one engine advance per frame, and mono fallback is not overwritten', async () => {
  const names = ['AudioWorkletProcessor', 'sampleRate', 'registerProcessor'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let Processor;
  globalThis.sampleRate = 12000;
  globalThis.AudioWorkletProcessor = class {
    constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
  };
  globalThis.registerProcessor = (name, constructor) => { assert.equal(name, 'bifurcator'); Processor = constructor; };
  try {
    await import('../src/instruments/bifurcator/processor.js?rhythm-contract');
    const source = make('fold', { sonification: 'shape', growShape: false,
      regime: 1, headCount: 1, pitchSpan: 0, panAxis: 'height', panWidth: 1 });
    run(source, .15);
    for (const channels of [2, 1]) {
      const processor = new Processor(), reference = new BifurcatorEngine(12000);
      const state = clone(source.exportState());
      processor.port.onmessage({ data: { type: 'seek', state, revision: 37 } });
      assert.equal(reference.importState(state), true);
      let advances = 0;
      const sample = processor.engine.sample.bind(processor.engine);
      processor.engine.sample = () => { advances++; return sample(); };
      const output = Array.from({ length: channels }, () => new Float32Array(512));
      assert.equal(processor.process([], [output]), true);
      assert.equal(advances, 512, 'the mathematical/beat clocks advance once per output frame');
      for (let frame = 0; frame < 512; frame++) {
        const mono = reference.sample();
        assert.equal(output[0][frame], Math.fround(channels === 2 ? reference.left : mono));
        if (channels === 2) assert.equal(output[1][frame], Math.fround(reference.right));
      }
      assert.deepEqual(processor.engine.exportState(), reference.exportState());
      assert.equal(processor.messages.at(-1).revision, 37);
      assert.deepEqual(processor.messages.at(-1).snapshot.channels, [reference.left, reference.right]);
      processor.port.onmessage({ data: { type: 'dispose' } });
      assert.equal(processor.process([], [output]), false);
      assert.equal(advances, 512, 'disposed output never advances clocks');
    }
  } finally {
    for (const name of names) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
  }
});
