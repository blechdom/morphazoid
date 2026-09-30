import { USER_PRESET_RECORDS } from '../src/instruments/fractal-signals/user-presets.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, PARAMS, MAX_POINTS, MAX_EVENTS, MODE_PARAMETERS, ENGINE_OPTIONS, PARAM_HELP, getParameterInfo, createDefaultState, sanitizeState, generateStructure, fractalValue, waveformValue, analyzeTexture } from '../src/instruments/fractal-signals/model.js';
import { FACTORY_PRESETS, randomizeState } from '../src/instruments/fractal-signals/presets.js';

function checkStructure(structure) {
  assert.ok(structure.points.length > 0 && structure.points.length <= MAX_POINTS);
  assert.ok(structure.events.length > 0 && structure.events.length <= MAX_EVENTS);
  for (const point of structure.points) {
    for (const key of ['x', 'y', 'phase']) assert.ok(Number.isFinite(point[key]) && point[key] >= 0 && point[key] <= 1, key);
    assert.ok(Number.isInteger(point.depth) && point.depth >= 0 && point.depth <= PARAMS.depth.max);
  }
  for (const [a, b] of structure.edges) {
    assert.ok(Number.isInteger(a) && a >= 0 && a < structure.points.length);
    assert.ok(Number.isInteger(b) && b >= 0 && b < structure.points.length && b !== a);
  }
  let previousPhase = -1;
  for (const event of structure.events) {
    assert.ok(Number.isFinite(event.freq) && event.freq >= 20 && event.freq <= 20000);
    assert.ok(Number.isFinite(event.amp) && event.amp >= 0 && event.amp <= 1);
    assert.ok(Number.isFinite(event.duration) && event.duration >= .001 && event.duration <= 16);
    assert.ok(Number.isFinite(event.pan) && event.pan >= -1 && event.pan <= 1);
    assert.ok(event.phase >= previousPhase && event.phase <= 1);
    assert.ok(Number.isInteger(event.point) && event.point >= 0 && event.point < structure.points.length);
    assert.equal(structure.points[event.point].phase, event.phase);
    previousPhase = event.phase;
  }
  for (const value of structure.waveform || []) assert.ok(Number.isFinite(value) && Math.abs(value) <= 1);
}

test('state validation handles missing, hostile and extreme scalar values without mutable shared defaults', () => {
  for (const mode of MODES) {
    const baseline = createDefaultState(mode.id), dirty = { mode: mode.id, synthesis: 'unknown' };
    for (const key of Object.keys(PARAMS)) dirty[key] = NaN;
    assert.deepEqual(sanitizeState(dirty), baseline);
    const low = sanitizeState({ ...baseline, ...Object.fromEntries(Object.keys(PARAMS).map(key => [key, -1e20])) });
    const high = sanitizeState({ ...baseline, ...Object.fromEntries(Object.keys(PARAMS).map(key => [key, 1e20])) });
    for (const [key, spec] of Object.entries(PARAMS)) {
      if (key === 'branchAngle') { assert.equal(low[key], 80); assert.equal(high[key], 280); }
      else { assert.equal(low[key], spec.min); assert.equal(high[key], spec.max); }
    }
    baseline.base = 999;
    assert.notEqual(createDefaultState(mode.id).base, 999);
  }
  assert.equal(sanitizeState(null).mode, 'wander');
  assert.equal(sanitizeState({ mode: '__proto__' }).mode, 'wander');
  assert.equal(sanitizeState({ depth: 3.7, phrase: 10.3, seed: 53.8, direction: 0 }).depth, 4);
  assert.equal(sanitizeState({ direction: 0 }).direction, 1);
});

test('all six deterministic scores stay finite and bounded at defaults, extremes and seeded random scenes', () => {
  for (const mode of MODES) {
    const base = createDefaultState(mode.id);
    const extremes = ['min', 'max'].map(edge => ({ ...base, ...Object.fromEntries(Object.entries(PARAMS).map(([key, spec]) => [key, spec[edge]])) }));
    const candidates = [base, ...extremes];
    let step = 0;
    for (let scene = 0; scene < 16; scene++) candidates.push(randomizeState(base, () => ((++step * 16807) % 9973) / 9973));
    for (const state of candidates) {
      const structure = generateStructure(state);
      checkStructure(structure);
      assert.deepEqual(generateStructure(state), structure);
    }
  }
});

test('six modes have different geometry and both gesture axes change the audible score', () => {
  const signatures = new Set();
  for (const mode of MODES) {
    const base = createDefaultState(mode.id), original = generateStructure(base);
    signatures.add(JSON.stringify(original.points));
    for (const key of ['x', 'y']) {
      const changed = generateStructure({ ...base, [key]: base[key] < .5 ? .96 : .04 });
      assert.notDeepEqual(changed.points, original.points, `${mode.id} gesture ${key} geometry`);
      assert.notDeepEqual(changed.events, original.events, `${mode.id} gesture ${key} score`);
    }
    const lowRoot = generateStructure({ ...base, depth: 3, span: 1, base: 320 });
    const highRoot = generateStructure({ ...base, depth: 3, span: 1, base: 640 });
    assert.equal(lowRoot.events.length, highRoot.events.length);
    for (let i = 0; i < lowRoot.events.length; i++) assert.ok(Math.abs(highRoot.events[i].freq / lowRoot.events[i].freq - 2) < 1e-10, `${mode.id} continuous frequency`);
    const slowEvents = generateStructure({ ...base, rate: .5 }).events.map(e => ({ ...e, onsetSeconds: e.phase * base.phrase / .5 }));
    const fastEvents = generateStructure({ ...base, rate: 7 }).events.map(e => ({ ...e, onsetSeconds: e.phase * base.phrase / 7 }));
    assert.notDeepEqual(slowEvents, fastEvents, `${mode.id} rate alters physical timing`);
    assert.notDeepEqual(generateStructure({ ...base, direction: -1 }).events, generateStructure({ ...base, direction: 1 }).events, `${mode.id} reverse traversal`);
  }
  assert.equal(signatures.size, 6);
});

test('rewritten grammar and grains expose actual parent-child topology and recursion changes descendants', () => {
  for (const mode of ['grammar', 'grains']) {
    const state = { ...createDefaultState(mode), branch: .85, seed: 17713 };
    const shallow = generateStructure({ ...state, depth: 2 }), deep = generateStructure({ ...state, depth: 5 });
    assert.ok(deep.points.length > shallow.points.length, mode);
    const children = new Map();
    for (const [a] of deep.edges) children.set(a, (children.get(a) || 0) + 1);
    assert.ok([...children.values()].some(count => count >= 2), `${mode} actually branches`);
    assert.ok(deep.events.some(event => event.depth > 2));
  }
  const sparse = generateStructure({ ...createDefaultState('grammar'), branch: .1, depth: 5 });
  const dense = generateStructure({ ...createDefaultState('grammar'), branch: .9, depth: 5 });
  assert.ok(dense.points.length > sparse.points.length);
});

test('fractal modulation is bounded, correlated at short distances and roughness adds detail', () => {
  const smooth = [], rough = [];
  for (let i = 0; i < 1000; i++) {
    const t = i / 100;
    const a = fractalValue(t, 317, .08, 7), b = fractalValue(t, 317, .92, 7);
    assert.ok(Math.abs(a) <= 1 && Math.abs(b) <= 1);
    assert.equal(a, fractalValue(t, 317, .08, 7));
    smooth.push(a); rough.push(b);
  }
  const differenceEnergy = values => values.slice(1).reduce((sum, value, i) => sum + (value - values[i]) ** 2, 0);
  assert.ok(differenceEnergy(rough) > differenceEnergy(smooth) * 3);
  assert.ok(Math.abs(fractalValue(2, 17, .5, 4) - fractalValue(2.0001, 17, .5, 4)) < .002);
  assert.notEqual(fractalValue(1.2, 17, .5, 4), fractalValue(1.2, 18, .5, 4));
  for (const t of [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE]) assert.ok(Number.isFinite(fractalValue(t)));
});

test('waveform curve is periodic, bounded and shares the defined octave family', () => {
  const state = createDefaultState('waveform'), { waveform } = generateStructure(state);
  assert.ok(Math.abs(waveform[0] - waveform.at(-1)) < 1e-12);
  assert.ok(Math.abs(waveformValue(.25, state, 1) - 1) < 1e-12);
  const shallow = generateStructure({ ...state, depth: 1 }).waveform;
  assert.notDeepEqual(shallow, waveform);
  assert.notDeepEqual(generateStructure({ ...state, roughness: .1 }).waveform, generateStructure({ ...state, roughness: .9 }).waveform);
});

test('presets cover different sound regions and randomization covers every scene field', () => {
  assert.equal(FACTORY_PRESETS.length, 54);
  assert.equal(new Set(FACTORY_PRESETS.map(preset => preset.id)).size, FACTORY_PRESETS.length);
  const stateKeys = Object.keys(createDefaultState()).sort();
  for (const mode of MODES) {
    const presets = FACTORY_PRESETS.filter(preset => preset.snapshot.mode === mode.id);
    assert.equal(presets.length, ({ wander: 5, grammar: 3, grains: 2, waveform: 4, echoes: 4, texture: 5 }[mode.id]) + USER_PRESET_RECORDS.filter(record => record.snapshot.mode === mode.id).length);
    assert.ok(new Set(presets.map(p => p.snapshot.engine)).size >= 2, `${mode.id} engine contrast`);
    assert.ok(presets.every(preset => ENGINE_OPTIONS[mode.id].some(engine => engine.value === preset.snapshot.engine)));
    for (const preset of presets) {
      assert.deepEqual(Object.keys(preset.snapshot).sort(), stateKeys);
      assert.deepEqual(sanitizeState(preset.snapshot), preset.snapshot);
      checkStructure(generateStructure(preset.snapshot));
    }
    for (const key of ['base', 'rate', 'span', 'index', 'roughness', 'depth', 'attack', 'release', 'x', 'y']) {
      assert.ok(new Set(presets.map(preset => preset.snapshot[key])).size >= 3, `${mode.id} ${key} contrast`);
    }
    const base = createDefaultState(mode.id), before = JSON.stringify(base);
    const low = randomizeState(base, () => 0), high = randomizeState(base, () => .999999);
    for (const key of stateKeys.filter(key => key !== 'mode')) assert.notEqual(low[key], high[key], `randomizer must vary ${key}`);
    assert.equal(low.mode, mode.id); assert.equal(high.mode, mode.id);
    assert.equal(JSON.stringify(base), before);
    assert.deepEqual(randomizeState(base, () => NaN), randomizeState(base, () => .5));
  }
});

test('texture analysis measures spectral placement and temporal envelope, including silence', () => {
  const sr = 48000, count = 24000;
  const sine = frequency => Float32Array.from({ length: count }, (_, i) => .4 * Math.sin(2 * Math.PI * frequency * i / sr));
  const low = analyzeTexture(sine(180), sr), high = analyzeTexture(sine(4200), sr);
  const peak = profile => profile.bands.indexOf(Math.max(...profile.bands));
  assert.ok(peak(high) > peak(low) + 5);
  assert.deepEqual(analyzeTexture(sine(180), sr), low);
  const gated = sine(700);
  gated.fill(0, count / 2);
  const temporal = analyzeTexture(gated, sr);
  assert.ok(temporal.envelope.slice(0, 30).every(value => value > .9));
  assert.ok(temporal.envelope.slice(33).every(value => value === 0));
  for (const profile of [low, high, temporal, analyzeTexture(new Float32Array(3000), sr), analyzeTexture([], sr), analyzeTexture([NaN, Infinity, -.1], NaN)]) {
    assert.equal(profile.bands.length, 16); assert.equal(profile.envelope.length, 64);
    for (const value of [...profile.bands, ...profile.envelope]) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    assert.ok(Number.isFinite(profile.slope)); assert.ok(profile.roughness >= .05 && profile.roughness <= .95);
  }
});


test('requested names, expanded ranges, ADSR and per-mode engines have complete performer help', () => {
  assert.deepEqual(MODES.map(mode => mode.label), ['paths', 'branches', 'grains', 'waves', 'echoes', 'textures']);
  const bounds = { base: [20,8000], rate: [.0625,64], phrase: [1,512], depth: [1,48], roughness: [.01,3], branch: [0,64], span: [0,8], ratio: [.03125,32], index: [0,32], memory: [0,.96], attack: [.0002,4], decay: [.001,8], sustain: [0,1], release: [.005,16] };
  for (const [key, [min, max]] of Object.entries(bounds)) { assert.equal(PARAMS[key].min, min); assert.equal(PARAMS[key].max, max); }
  for (const key of [...Object.keys(PARAMS), 'engine', 'synthesis']) {
    assert.ok(PARAM_HELP[key].length > 35, key);
    assert.ok(getParameterInfo(key, 'wander').description.length > 35, key);
  }
  assert.equal(createDefaultState().base, 440);
  for (const mode of MODES) {
    for (const key of MODE_PARAMETERS[mode.id]) assert.ok(PARAMS[key] && PARAM_HELP[key]);
    for (const engine of ENGINE_OPTIONS[mode.id]) {
      assert.equal(sanitizeState({ mode: mode.id, engine: engine.value }).engine, engine.value);
      assert.ok(engine.description.length > 25);
    }
    assert.equal(sanitizeState({ mode: mode.id, engine: 'unknown' }).engine, ENGINE_OPTIONS[mode.id][0].value);
  }
  assert.equal(getParameterInfo('x', 'grammar').label, 'Branch spread');
});

test('branches start on the left and every retained generation advances right even at maximum branching', () => {
  for (const branch of [0, .5, 1.5, 2.5]) {
    const state = { ...createDefaultState('grammar'), depth: 12, branch, turns: 11.7, y: .93 };
    const structure = generateStructure(state);
    checkStructure(structure);
    assert.equal(structure.points[0].x, .06);
    for (const [a, b] of structure.edges) assert.ok(structure.points[b].x > structure.points[a].x, 'every child is right of its parent');
    const pointGenerations = new Set(structure.points.map(p => p.depth));
    const eventGenerations = new Set(structure.events.map(e => e.depth));
    for (let generation = 1; generation <= 12; generation++) {
      assert.ok(pointGenerations.has(generation), `visible generation ${generation}`);
      assert.ok(eventGenerations.has(generation), `sounding generation ${generation}`);
    }
    assert.ok(structure.points.filter(p => p.depth === 12).every(p => p.x > .93));
  }
  const loss = generateStructure({ ...createDefaultState('grammar'), generationLoss: 1 });
  assert.ok(loss.events.some(e => e.depth === 1 && e.amp > 0));
  assert.ok(loss.events.filter(e => e.depth > 1).every(e => e.amp === 0));
});

test('mode-specific mathematical controls change their intended score or source curve', () => {
  const cases = [
    ['wander', 'chaos', 0, 2], ['grammar', 'turns', .3, 8], ['grammar', 'generationLoss', .05, .8],
    ['grains', 'grainSize', .01, .8], ['grains', 'spray', 0, 1], ['grains', 'scan', .1, .8],
    ['waveform', 'partialRatio', 1.2, 2.7], ['waveform', 'fold', 0, 5],
    ['echoes', 'echoTime', .03, .7], ['echoes', 'echoRatio', .5, 1.9], ['echoes', 'sweepRate', .1, 2.7],
    ['texture', 'bandQ', .5, 20], ['texture', 'tilt', -2.5, 2.5],
  ];
  for (const [mode, key, low, high] of cases) {
    const state = { ...createDefaultState(mode), ...(key === 'fold' ? { engine: 'folded' } : {}) };
    assert.notDeepEqual(generateStructure({ ...state, [key]: low }), generateStructure({ ...state, [key]: high }), `${mode} ${key}`);
  }
  const wave = createDefaultState('waveform');
  const curves = ENGINE_OPTIONS.waveform.map(engine => generateStructure({ ...wave, engine: engine.value }).waveform);
  assert.equal(new Set(curves.map(curve => JSON.stringify(curve))).size, 3);
});

test('remaining original Paths scenes occupy audible registers and include real gaps instead of continuous gates', () => {
  const presets = FACTORY_PRESETS.filter(preset => preset.snapshot.mode === 'wander' && !preset.id.includes('-user-'));
  const signatures = new Set(), medians = [];
  for (const preset of presets) {
    const s = preset.snapshot, events = generateStructure(s).events, phraseSeconds = s.phrase / s.rate;
    assert.ok(s.base >= 300 && s.base <= 1600, preset.label);
    assert.ok(events.length >= 2, preset.label);
    assert.ok(events.every(e => e.amp > .05), preset.label);
    const frequencies = events.map(e => e.freq).sort((a, b) => a - b);
    const median = frequencies[Math.floor(frequencies.length / 2)];
    assert.ok(median >= 200 && median <= 4000, `${preset.label} register`); medians.push(median);
    assert.ok(events.some((event, i) => {
      const next = i + 1 < events.length ? events[i + 1].phase : events[0].phase + 1;
      return (next - event.phase) * phraseSeconds > event.duration + s.attack + s.release + .005;
    }), `${preset.label} has space after a released gate`);
    signatures.add(JSON.stringify(events.map(e => [e.phase, e.duration, e.amp])));
  }
  assert.equal(signatures.size, 5);
  assert.ok(Math.max(...medians) / Math.min(...medians) > 2); // Remaining scenes span more than an octave.
});
