import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WEBGPU_CHIPTUNE_DEFAULTS as DEFAULTS,
  WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE as SONG,
  WEBGPU_CHIPTUNE_PERFORMANCE_LANES as SOURCE_LANES,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES as SEQUENCE_LANES,
  applyWebGpuChiptunePerformance,
  createWebGpuChiptunePattern,
  migrateWebGpuChiptunePerformance,
  packWebGpuChiptuneSequence,
  sanitizeWebGpuChiptuneSequence,
  webGpuChiptuneParamArray,
  webGpuChiptuneProceduralLaneValue,
  webGpuChiptuneStageSnapshot,
} from '../src/instruments/webgpu-chiptune/webgpu-chiptune.js';
import {
  SIMD_CHIPTUNE_PERFORMANCE_LANES as LANES,
  SIMD_CHIPTUNE_PERFORMANCE_AXES as AXES,
  SIMD_CHIPTUNE_PERFORMANCE_DEFAULTS as PERFORMANCE,
  applySimdChiptunePerformance,
  applySimdChiptuneDrumMix,
  sanitizeSimdChiptuneDrumMix,
  createSimdChiptunePatternSection,
  migrateSimdChiptunePerformance,
  sanitizeSimdChiptunePerformance,
  simdChiptuneSectionStartBeat,
  simdChiptuneStageSnapshot,
} from '../src/instruments/simd-chiptune/performance.js';

const modules = Object.fromEntries(await Promise.all(['scalar', 'simd'].map(async (type) => [
  type, new WebAssembly.Module(await readFile(new URL(`../assets/wasm/simd-chiptune-${type}.wasm`, import.meta.url))),
])));

function render(params, sequence = SONG, { type = 'simd', seconds = 10.03, preview = false } = {}) {
  const engine = new WebAssembly.Instance(modules[type]).exports;
  engine.reset();
  new Float32Array(engine.memory.buffer, engine.params_ptr(), 154).set(webGpuChiptuneParamArray(params));
  const packed = packWebGpuChiptuneSequence(sequence);
  new Uint8Array(engine.memory.buffer, engine.sequence_meta_ptr(), 192).set(new Uint8Array(packed.meta.buffer));
  new Uint8Array(engine.memory.buffer, engine.sequence_cells_ptr(), 9216).set(new Uint8Array(packed.cells));
  if (preview) new Float32Array(engine.memory.buffer, engine.time_info_ptr(), 4).set([seconds, 0, 12, seconds]);
  const result = new Float32Array(2048);
  const left = new Float32Array(engine.memory.buffer, engine.output_left_ptr(), 128);
  const right = new Float32Array(engine.memory.buffer, engine.output_right_ptr(), 128);
  for (let block = 0; block < 8; block += 1) {
    engine.process(128, 48000, seconds + block * 128 / 48000);
    for (let frame = 0; frame < 128; frame += 1) {
      result[block * 256 + frame * 2] = left[frame];
      result[block * 256 + frame * 2 + 1] = right[frame];
    }
  }
  return result;
}
const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const levels = LANES.flatMap((lane) => AXES[lane].levelKeys);

function allPlayingPattern() {
  const sequence = structuredClone(createWebGpuChiptunePattern());
  for (const lane of SEQUENCE_LANES) {
    sequence.lanes[lane].activeLength = 8;
    sequence.lanes[lane].stepBeats = 0.25;
    sequence.lanes[lane].cells = Array.from({ length: 32 }, () => ({ state: 'note', value: lane === 'arp' ? 0.5 : 1, velocity: 1 }));
  }
  return sanitizeWebGpuChiptuneSequence(sequence);
}

test('old six-voice controls and preset mappings stay neutral and noise gains independent ownership', () => {
  assert.deepEqual(LANES, ['drums', 'bass', 'arp', 'lead', 'upperOne', 'upperTwo', 'noise']);
  assert.deepEqual(applySimdChiptunePerformance(DEFAULTS, PERFORMANCE), DEFAULTS);
  const controls = Object.fromEntries(SOURCE_LANES.map((lane, index) => [lane, { x: index / 5, y: 1 - index / 5 }]));
  assert.deepEqual(applySimdChiptunePerformance(DEFAULTS, controls), applyWebGpuChiptunePerformance(DEFAULTS, controls));
  assert.deepEqual(sanitizeSimdChiptunePerformance(controls).noise, PERFORMANCE.noise);
  assert.ok(Object.isFrozen(sanitizeSimdChiptunePerformance(controls).noise));
  const invalid = sanitizeSimdChiptunePerformance({ noise: { x: Infinity, y: -3, muted: 1, solo: true } }).noise;
  assert.deepEqual(invalid, { x: 0.5, y: 0, muted: false, solo: true, volume: 1 });
  assert.equal(applySimdChiptunePerformance(DEFAULTS, { noise: { y: 0 } }).noiseLevel, 0);
  assert.equal(applySimdChiptunePerformance(DEFAULTS, { noise: { x: 1 } }).textureSweep, 32);
});

test('legacy snapshots migrate all six pads exactly while retaining new noise state', () => {
  for (const performanceVersion of [undefined, 1, 2, 3]) {
    const snapshot = { parameters: { ...DEFAULTS, drumRate: 0.5 }, performanceVersion,
      voicePerformance: { bass: { x: 0.8, y: 0.13, solo: true }, drums: { x: 0.17 }, noise: { muted: true, x: 0.7 } } };
    const original = migrateWebGpuChiptunePerformance(snapshot);
    const migrated = migrateSimdChiptunePerformance(snapshot);
    assert.deepEqual(migrated.parameters, original.parameters);
    for (const lane of SOURCE_LANES) assert.deepEqual(migrated.performance[lane], { ...original.performance[lane], volume: 1 });
    assert.equal(migrated.performance.noise.muted, true);
    assert.equal(migrated.performance.noise.x, 0.7);
  }
});

test('the formerly orphaned sweep is audible alone and muting all seven yields exact kernel silence', () => {
  const mutedSix = Object.fromEntries(SOURCE_LANES.map((lane) => [lane, { muted: true }]));
  const oldResidual = applyWebGpuChiptunePerformance(DEFAULTS, mutedSix);
  const ownedResidual = applySimdChiptunePerformance(DEFAULTS, mutedSix);
  assert.deepEqual(render(ownedResidual), render(oldResidual));
  assert.ok(rms(render(ownedResidual)) > 0.0001);
  const mutedSeven = { ...mutedSix, noise: { muted: true } };
  const silent = applySimdChiptunePerformance(DEFAULTS, mutedSeven);
  for (const type of ['scalar', 'simd']) for (const sequence of [SONG, allPlayingPattern()]) {
    for (const seconds of [0.03, 10.03, 83.125]) {
      assert.equal(rms(render(silent, sequence, { type, seconds, preview: true })), 0);
    }
  }
});

test('every solo isolates its complete stem including echoes and ghost drums', () => {
  const pattern = allPlayingPattern();
  for (const solo of LANES) {
    const actual = applySimdChiptunePerformance(DEFAULTS, { [solo]: { solo: true } });
    const expected = { ...DEFAULTS };
    for (const key of levels) if (!AXES[solo].levelKeys.includes(key)) expected[key] = 0;
    const sequence = solo === 'noise' ? SONG : pattern;
    const samples = render(actual, sequence);
    assert.deepEqual(samples, render(expected, sequence), solo);
    assert.ok(rms(samples) > 0.00001, `${solo} must have audible output`);
    assert.ok(samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.880001));
  }
  const mutedSolo = applySimdChiptunePerformance(DEFAULTS, { noise: { solo: true, muted: true } });
  assert.equal(rms(render(mutedSolo)), 0);
});

test('noise motion uses the texture phase, sweep and decay while original actors retain their data', () => {
  const params = { ...DEFAULTS, texturePeriod: 6, texturePhase: 0.125, textureDecay: 0.8, textureSweep: 2 };
  const time = 8.31;
  const stage = simdChiptuneStageSnapshot(time, params);
  const original = webGpuChiptuneStageSnapshot(time, params);
  assert.deepEqual(stage.actors.map((actor) => actor.key), LANES);
  for (const actor of original.actors) assert.deepEqual(stage.actors.find((entry) => entry.key === actor.key), actor);
  const noise = stage.actors.at(-1);
  const noiseTime = ((time * params.tempo + params.texturePhase * params.texturePeriod) % params.texturePeriod + params.texturePeriod) % params.texturePeriod;
  assert.equal(noise.noiseTime, noiseTime);
  assert.equal(noise.envelope, Math.exp(-noiseTime * params.textureDecay));
  assert.equal(noise.sweepPosition, Math.exp(-noiseTime * params.textureSweep));
  assert.ok(noise.activity > 0);
  const muted = simdChiptuneStageSnapshot(time, { ...params, noiseLevel: 0 }).actors.at(-1);
  assert.equal(muted.activity, 0);
  assert.equal(muted.resting, true);
  const loopNoise = simdChiptuneStageSnapshot(time, params, allPlayingPattern()).actors.at(-1);
  assert.equal(loopNoise.resting, true);
  assert.equal(loopNoise.activity, 0);
  assert.equal(rms(render(applySimdChiptunePerformance(params, { noise: { solo: true } }), allPlayingPattern())), 0);
});

test('independent loops capture later procedural song sections and preserve section zero', () => {
  const first = createSimdChiptunePatternSection(DEFAULTS, SONG, 0);
  assert.deepEqual(first, createWebGpuChiptunePattern(DEFAULTS, SONG));
  const later = createSimdChiptunePatternSection(DEFAULTS, SONG, 1);
  const third = createSimdChiptunePatternSection(DEFAULTS, SONG, 2);
  assert.notDeepEqual(later.lanes.upperOne.cells, first.lanes.upperOne.cells);
  assert.notDeepEqual(third.lanes.upperOne.cells, later.lanes.upperOne.cells);
  assert.equal(simdChiptuneSectionStartBeat(DEFAULTS, 1), 32);
  assert.equal(simdChiptuneSectionStartBeat({ ...DEFAULTS, sectionUnits: 12 }, 3), 36);
  for (const lane of ['upperOne', 'upperTwo', 'bass', 'lead', 'arp']) {
    const expected = webGpuChiptuneProceduralLaneValue(lane,
      32 + 0.5 * later.lanes[lane].stepBeats, DEFAULTS, SONG);
    assert.equal(later.lanes[lane].cells[0].value, expected);
  }
  assert.equal(later.mode, 'pattern');
  assert.ok(rms(render(DEFAULTS, later)) > 0.001);
  assert.notDeepEqual(render(DEFAULTS, later), render(DEFAULTS, first));
  assert.deepEqual(createSimdChiptunePatternSection(DEFAULTS, SONG, -5), first);
  assert.deepEqual(createSimdChiptunePatternSection(DEFAULTS, first, 5), first);
});

test('section captures preserve manual notes, rests, velocities and original song state', () => {
  const source = structuredClone(SONG);
  source.lanes.bass.cells[2] = { state: 'note', value: 17, velocity: 0.35 };
  source.lanes.kick.cells[3] = { state: 'rest', value: 0, velocity: 0.2 };
  source.lanes.lead.activeLength = 12;
  const song = sanitizeWebGpuChiptuneSequence(source);
  const before = JSON.stringify(song);
  const pattern = createSimdChiptunePatternSection(DEFAULTS, song, 3);
  assert.deepEqual(pattern.lanes.bass.cells[2], song.lanes.bass.cells[2]);
  assert.deepEqual(pattern.lanes.kick.cells[3], song.lanes.kick.cells[3]);
  assert.equal(pattern.lanes.lead.activeLength, 12);
  assert.equal(JSON.stringify(song), before);
});


test('mixer trims preserve patch balance and separately attenuate each drum', () => {
  const patch = { ...DEFAULTS, bassPulseLevel: 0.4, bassSineLevel: 1.3 };
  const unity = applySimdChiptunePerformance(patch, { bass: { y: .7 } });
  const quiet = applySimdChiptunePerformance(patch, { bass: { y: .7, volume: .25 } });
  assert.equal(quiet.bassPulseLevel, unity.bassPulseLevel * .25);
  assert.equal(quiet.bassSineLevel, unity.bassSineLevel * .25);
  assert.equal(quiet.leadLevel, unity.leadLevel);
  assert.deepEqual(applySimdChiptuneDrumMix(patch), patch);
  const drums = applySimdChiptuneDrumMix(patch, { snare: { volume: .3 }, kick: { volume: 0 } });
  assert.equal(drums.snareLevel, patch.snareLevel * .3);
  assert.equal(drums.kickLevel, 0);
  assert.equal(drums.hatLevel, patch.hatLevel);
  assert.deepEqual(sanitizeSimdChiptuneDrumMix({ shaker: { volume: -3, solo: true } }).shaker,
    { volume: 0, muted: false, solo: true });
  const migrated = migrateSimdChiptunePerformance({ performanceVersion: 2,
    voicePerformance: { bass: { volume: .2 }, noise: { volume: .4 } } });
  assert.equal(migrated.performance.bass.volume, .2);
  assert.equal(migrated.performance.noise.volume, .4);
  const muted = Object.fromEntries(LANES.map(lane => [lane, { volume: 0 }]));
  assert.equal(rms(render(applySimdChiptunePerformance(patch, muted))), 0);
});
