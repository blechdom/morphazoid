import test from 'node:test';
import assert from 'node:assert/strict';
import { VectorDSP } from '../src/instruments/vector-fractals/dsp.js';

const state = { mode: 'explorer', contourReader: 'trace', pitch: 160, traceRate: 1,
  layerEnabled: [true, false, false], layerSustain: [true, true, true], layerDrums: [false, false, false],
  layerVoices: ['sine', 'reed', 'glass'], layerDrumVoices: ['thump', 'wood', 'metal'] };
const rms = array => Math.sqrt(array.reduce((sum, sample) => sum + sample * sample, 0) / array.length);
const delta = (a, b) => rms(a.map((value, index) => value - b[index]));
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const filled = value => new Float32Array(128).fill(value);
function contact({ x = 0, y = 0, bend = 0, fold = 0, presence = 1, slot } = {}) {
  return { x: filled(x), y: filled(y), bend: filled(bend), fold: filled(fold), presence: filled(presence), slot };
}
function event(phase, bead = 0, x = 0, y = 0) { return { phase, bead, x, y, bend: .7, fold: .6 }; }
function bank({ reader = 'trace', contacts = [contact()], events = [], id = 1, radarX = 0, radarY = 0 } = {}) {
  return { id, reader, radarX, radarY, view: { aspect: 1 }, layers: [0, 1, 2].map(() => ({ contacts, events })) };
}
function make(options = {}, input = bank(), sampleRate = 24000) {
  const dsp = new VectorDSP(sampleRate); dsp.setState({ ...state, ...options });
  dsp.setTraceBank(input); dsp.playing = true; dsp.trace.rate = dsp.trace.targetRate;
  return dsp;
}
function render(dsp, duration, block = 128) {
  const length = Math.round(duration * dsp.sampleRate), x = new Float32Array(length), y = new Float32Array(length);
  for (let offset = 0; offset < length; offset += block) {
    dsp.process(x.subarray(offset, Math.min(length, offset + block)), y.subarray(offset, Math.min(length, offset + block)));
  }
  return { x, y };
}
function settled(options, input = bank(), duration = .4) {
  const dsp = make(options, input); render(dsp, .6); return { dsp, ...render(dsp, duration) };
}
const drumsOnly = { layerSustain: [false, false, false], layerDrums: [true, false, false] };

test('all slow readers follow one sample clock and projected readers sound simultaneous stable contact slots', () => {
  for (const reader of ['trace', 'radar', 'scan']) {
    const input = bank({ reader, contacts: [contact({ x: -.3, y: -.2, slot: 0 }), contact({ x: .3, y: .2, slot: 2 })] });
    const dsp = make({ contourReader: reader }, input); const sound = render(dsp, 1.2, 17);
    close(dsp.trace.travel, 1.2); close(dsp.tracePhase, .2); assert.equal(dsp.traceRate, 1);
    assert.ok(rms(sound.x) > .02 && rms(sound.y) > .02);
    assert.ok(dsp.trace.gains[0] > .99 && dsp.trace.gains[6] > .99);
    assert.equal(dsp.trace.gains[3], 0, 'absent slot 1 must not borrow slot 2 identity');
    dsp.setTraceBank(bank({ reader, contacts: [contact({ presence: 0 })] }));
    assert.ok(rms(render(dsp, 1).x.slice(-2048)) < 1e-10);
  }
});

test('Radar pitch follows distance while Trace and Scan follow height; pitch and pan amounts can disable mappings', () => {
  const frequencies = [];
  for (const x of [.1, .4]) {
    const { dsp } = settled({ contourReader: 'radar' }, bank({ reader: 'radar', contacts: [contact({ x, y: .1 })] }));
    frequencies.push(dsp.trace.frequencies[0]);
    close(dsp.trace.frequencies[0], 80 * 2 ** (2 * (2 * Math.hypot(x, .1) / Math.hypot(.5, .5) - 1)), .0001);
  }
  assert.ok(frequencies[1] > frequencies[0] * 2);
  for (const reader of ['trace', 'scan', 'radar']) {
    const input = bank({ reader, contacts: [contact({ x: .5, y: .3 })] });
    const centered = settled({ contourReader: reader, pitchDepth: 0, panWidth: 0 }, input);
    close(centered.dsp.trace.frequencies[0], 80, .0001); assert.ok(delta(centered.x, centered.y) < 1e-8);
    const mapped = settled({ contourReader: reader, pitchDepth: 4, panWidth: 1 }, input);
    assert.ok(rms(mapped.y) > rms(mapped.x) * 1e5);
    assert.ok(delta(centered.y, mapped.y) > .02);
  }
});

test('bend and fold timbre have independent zero-disable and measurable sustained destinations', () => {
  for (const voice of ['sine', 'reed', 'glass', 'shepard']) {
    const options = { layerVoices: [voice, voice, voice], bendTimbre: 0, foldTimbre: 0 };
    const plain = settled(options, bank({ contacts: [contact()] }));
    const featuresOff = settled(options, bank({ contacts: [contact({ bend: 1, fold: 1 })] }));
    assert.equal(delta(plain.x, featuresOff.x), 0, `${voice}: disabled mappings leave the voice unchanged`);
    for (const mapping of ['bendTimbre', 'foldTimbre']) {
      const on = settled({ ...options, [mapping]: 1 }, bank({ contacts: [contact({ bend: 1, fold: 1 })] }));
      const middle = settled({ ...options, [mapping]: .5 }, bank({ contacts: [contact({ bend: 1, fold: 1 })] }));
      assert.ok(delta(featuresOff.x, on.x) > .001, `${voice}: ${mapping} must change the spectrum`);
      assert.ok(delta(middle.x, on.x) > .0001, `${voice}: upper half of ${mapping} remains effective`);
    }
  }
  const on = settled({ toneLevel: 1 }), off = settled({ toneLevel: 0 });
  assert.ok(rms(on.x) > .04); assert.ok(rms(off.x) < 1e-12);
});

test('drum event crossings are once per pass, block-independent, sample-clocked, and report actual bead identities', () => {
  const input = bank({ events: [event(0, 4), event(.1, 1), event(.2, 2), event(.9, 3)], id: 71 });
  const small = make(drumsOnly, input), large = make(drumsOnly, input);
  const a = render(small, 1.11, 7), b = render(large, 1.11, 1024);
  assert.equal(delta(a.x, b.x), 0); assert.deepEqual(Array.from(small.trace.drumTriggerCounts), [5, 0, 0]);
  assert.ok(rms(a.x) > .002);
  const hits = small.trace.drainHits();
  assert.deepEqual(hits.map(hit => hit.bead), [1, 2, 3, 4, 1]);
  assert.deepEqual(hits.map(hit => hit.bankId), [71, 71, 71, 71, 71]);
  for (let i = 0; i < hits.length; i++) close(hits[i].travel, [.1, .2, .9, 1, 1.1][i]);
  assert.deepEqual(small.trace.drainHits(), []);
  const seam = make(drumsOnly, bank({ events: [event(0, 5)] }));
  // Independently accumulated phase/travel after 39 seconds at 48 kHz.
  seam.trace.phase = .9999791667014825;
  seam.trace.crossEvents(3.48e-11, 38.999999999780876);
  assert.equal(seam.trace.drainHits()[0].travel, 39, 'late-run seams retain the actual lap for bead flashes');
  const phase = small.tracePhase; small.playing = false;
  assert.ok(rms(render(small, .9).x.slice(-2048)) < 1e-10); close(small.tracePhase, phase);
  assert.equal(small.trace.drumTriggerCounts[0], 5);
});

test('schedule, mode, spacing and mute edits do not manufacture hits or replay an old bank backlog', () => {
  const dsp = make(drumsOnly, bank({ events: [event(.1, 1), event(.3, 2)] }));
  render(dsp, .2); assert.equal(dsp.trace.drumTriggerCounts[0], 1);
  dsp.trace.drainHits();
  dsp.setTraceBank(bank({ events: [event(.1, 7), event(.25, 8)], id: 2 }));
  dsp.setTraceBank(bank({ events: [event(.15, 9), event(.4, 10)], id: 3 }));
  render(dsp, .15); assert.equal(dsp.trace.drumTriggerCounts[0], 1);
  dsp.setState({ ...state, ...drumsOnly, contourReader: 'radar' });
  render(dsp, .1); assert.equal(dsp.trace.drumTriggerCounts[0], 1, 'stale Trace events must not fire in Radar');
  dsp.setTraceBank(bank({ reader: 'radar', events: [event(.2, 11), event(.5, 12)], id: 4 }));
  render(dsp, .1); assert.equal(dsp.trace.drumTriggerCounts[0], 2);
  assert.deepEqual(dsp.trace.drainHits().map(hit => [hit.bead, hit.bankId]), [[12, 4]]);
  dsp.setState({ ...state, ...drumsOnly, contourReader: 'radar', layerEnabled: [false, false, false] });
  const muted = render(dsp, 1); assert.ok(rms(muted.x.slice(-2048)) < 1e-10);
  assert.equal(dsp.trace.drumTriggerCounts[0], 2);
  dsp.setState({ ...state, ...drumsOnly, contourReader: 'radar' });
  render(dsp, .05); assert.equal(dsp.trace.drumTriggerCounts[0], 2, 'unmute is not a drum strike');
});

test('percussion voice, level, pitch, decay and geometry timbre each change the struck result', () => {
  function take(options = {}) {
    const dsp = make({ ...drumsOnly, ...options }, bank({ events: [event(.7)] }));
    render(dsp, .65); return render(dsp, .35).x;
  }
  const base = take({ bendTimbre: 0, foldTimbre: 0 });
  const sounds = ['thump', 'wood', 'metal'].map(voice => take({ layerDrumVoices: [voice, voice, voice] }));
  for (let i = 0; i < sounds.length; i++) for (let j = i + 1; j < sounds.length; j++) assert.ok(delta(sounds[i], sounds[j]) > .002);
  assert.ok(rms(take({ drumLevel: 0 })) < 1e-12);
  const half = take({ drumLevel: .5 }), full = take({ drumLevel: 1 });
  close(rms(full) / rms(half), 2, .0001);
  assert.ok(delta(take({ drumPitch: 60 }), take({ drumPitch: 600 })) > .004);
  assert.ok(rms(take({ drumDecay: 1 }).slice(-1200)) > rms(take({ drumDecay: .03 }).slice(-1200)) * 100);
  for (const mapping of ['bendTimbre', 'foldTimbre']) assert.ok(delta(base, take({ bendTimbre: 0, foldTimbre: 0, [mapping]: 1 })) > .0003);
});

test('simultaneous drum contacts sum, and arbitrarily dense banks retain bounded voices and hit history', () => {
  const single = make(drumsOnly, bank({ events: [event(.2)] }));
  const chord = make(drumsOnly, bank({ events: [event(.2, 1), event(.2, 2), event(.2, 3)] }));
  const a = render(single, .4), b = render(chord, .4);
  assert.ok(rms(b.x) > rms(a.x) * 2.5); assert.equal(chord.trace.drumTriggerCounts[0], 3);
  const events = Array.from({ length: 800 }, (_, i) => event((i % 512) / 512, i));
  for (const sampleRate of [22050, 48000, 96000]) {
    const dsp = make({ layerEnabled: [true, true, true], layerVoices: ['shepard', 'shepard', 'shepard'],
      layerDrums: [true, true, true], drumLevel: 1, drumDecay: 1.5, drumPitch: 1800, pitchDepth: 4,
      bendTimbre: 1, foldTimbre: 1, shepardWidth: 2, shepardCycles: 4 },
    bank({ contacts: [contact({ bend: 1, fold: 1 }), contact({ x: .4, y: .4 }), contact({ x: -.4, y: -.4 })], events }), sampleRate);
    dsp.level = .8; const sound = render(dsp, 1.05);
    assert.equal(dsp.trace.drumVoices.length, 24); assert.equal(dsp.trace.drainHits().length, 64);
    assert.ok(sound.x.every(value => Number.isFinite(value) && Math.abs(value) <= .721));
    assert.ok(sound.y.every(value => Number.isFinite(value) && Math.abs(value) <= .721));
    assert.ok(rms(sound.x) > .01);
  }
});

test('Shepard uses signed unwrapped travel, recycles octave phases continuously and preserves edits', () => {
  for (const direction of ['rise', 'fall']) {
    const dsp = make({ layerVoices: ['shepard'], shepardDirection: direction, shepardCycles: 1 });
    render(dsp, .5);
    const before = dsp.trace.shepardTravel;
    const sound = render(dsp, 2.2, 31);
    close(dsp.trace.shepardTravel - before, direction === 'rise' ? 2.2 : -2.2, 1e-8);
    assert.ok(rms(sound.x) > .02);
    let jump = 0; for (let i = 1; i < sound.x.length; i++) jump = Math.max(jump, Math.abs(sound.x[i] - sound.x[i - 1]));
    assert.ok(jump < .01, `octave seams have no impulse: max sample delta ${jump}`);
    const phase = dsp.tracePhase, travel = dsp.trace.travel, shepard = dsp.trace.shepardTravel;
    dsp.setState({ ...state, layerVoices: ['shepard'], contourReader: 'scan', shepardDirection: direction, shepardCycles: 3, shepardWidth: 2 });
    close(dsp.tracePhase, phase); close(dsp.trace.travel, travel); close(dsp.trace.shepardTravel, shepard);
    render(dsp, .5); const next = dsp.trace.shepardTravel; render(dsp, .5);
    close(Math.abs(dsp.trace.shepardTravel - next), 1.5, 1e-8);
    dsp.setState({ ...state, layerVoices: ['shepard'], shepardCycles: 0 });
    render(dsp, .5); const frozen = dsp.trace.shepardTravel, readerTravel = dsp.trace.travel;
    const still = render(dsp, .5); close(dsp.trace.shepardTravel, frozen, 1e-10);
    close(dsp.trace.travel - readerTravel, .5); assert.ok(rms(still.x) > .02);
    const octavePosition = dsp.trace.shepardPosition;
    dsp.resetMotion(); close(dsp.trace.shepardTravel, frozen, 1e-10); close(dsp.trace.shepardPosition, octavePosition);
    close(((dsp.trace.shepardTravel % 1) + 1) % 1, octavePosition, 1e-8);
    dsp.playing = false; const paused = dsp.trace.shepardTravel; render(dsp, .1); close(dsp.trace.shepardTravel, paused);
  }
  const narrow = settled({ layerVoices: ['shepard'], shepardWidth: .5 });
  const broad = settled({ layerVoices: ['shepard'], shepardWidth: 2 });
  assert.ok(delta(narrow.x, broad.x) > .005);
});

test('worklet resumes unwrapped reader and Shepard clocks and reports only newly sounded bead hits', async () => {
  const globals = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'];
  const original = Object.fromEntries(globals.map(key => [key, globalThis[key]]));
  let Processor;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { messages: [], postMessage(data) { this.messages.push(data); } }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  globalThis.sampleRate = 48000; globalThis.currentTime = 8;
  try {
    await import('../src/instruments/vector-fractals/processor.js');
    const processor = new Processor({ processorOptions: { state: { ...state, ...drumsOnly, shepardDirection: 'fall' },
      traceTravel: 3.1, tracePhase: .1, shepardTravel: -7.2, playing: true,
      traceBank: bank({ events: [event(.05, 1), event(.12, 2)], id: 19 }) } });
    close(processor.dsp.trace.travel, 3.1); close(processor.dsp.trace.shepardTravel, -7.2);
    const channels = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i < 32; i++) processor.process([], [channels]);
    const first = processor.port.messages[0], last = processor.port.messages.at(-1);
    close(last.traceTravel, 3.1 + 4096 / 48000); close(last.shepardTravel, -7.2 - 4096 / 48000);
    assert.deepEqual(first.recentDrumHits, [{ layer: 0, bead: 2, travel: 3.12, bankId: 19 }]);
    assert.deepEqual(last.recentDrumHits, []); assert.deepEqual(last.drumTriggerCounts, [1, 0, 0]);
    processor.port.onmessage({ data: { type: 'dispose' } }); assert.equal(processor.process([], [channels]), false);
  } finally {
    for (const key of globals) if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key];
  }
});
