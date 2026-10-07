import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, L_SYSTEM_TYPES, PARAMETER_LIMITS,
  captureScene, presetState, sanitizeParameters } from '../src/instruments/micmic/native/model.js';
import { defaultLab, LAB_KINDS, LAB_LIMITS } from '../src/instruments/l-system-parametric-lab/model.js';
import { PRESETS as parametricPresets } from '../src/instruments/l-system-parametric-lab/config.js';
import { PRESETS as experimentPresets } from '../src/instruments/l-system-experiments/config.js';
import { RULE_MODES, RULE_MODE_LABELS, ruleMode, parametersForRuleMode,
  combinedPresets, randomRuleState } from '../src/instruments/micmic/native/rule-modes.js';

const classicBank = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
const bank = combinedPresets(classicBank);
const seeded = (initial = 71) => {
  let seed = initial;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
};
const livePerformance = { ...DEFAULT_PERFORMANCE, source: 'mic', inputGain: 3.25, level: .42,
  automatic: false, voiceCeiling: 12345, frozen: true, frequency: 317, pulseRate: .7,
  mastering: { ...DEFAULT_PERFORMANCE.mastering, makeupDb: 17 },
  inputMode: 'sample', sampleId: 'tabla', sampleTime: 84612, audioDesired: true };
const preserved = ['source', 'inputGain', 'level', 'automatic', 'voiceCeiling', 'frozen', 'frequency',
  'pulseRate', 'inputMode', 'sampleId', 'sampleTime', 'audioDesired'];

test('one rule identity includes every classic grammar and numeric, context, sequence and tiling family', () => {
  assert.deepEqual(RULE_MODES, [...L_SYSTEM_TYPES, ...LAB_KINDS.map(kind => `lab:${kind}`)]);
  assert.equal(new Set(RULE_MODES).size, RULE_MODES.length);
  for (const mode of RULE_MODES) {
    assert.ok(RULE_MODE_LABELS[mode]?.trim(), mode);
    assert.equal(ruleMode(parametersForRuleMode(DEFAULT_PARAMETERS, mode)), mode);
  }
  assert.equal(ruleMode(), 'pythagorean');
});

test('rule selection retains the shared sound and replaces all family-owned numeric fields', () => {
  const original = { ...DEFAULT_PARAMETERS, lSystemType: 'hilbert', generations: 39, intervalMs: 713,
    angle: 81, timeRatio: 1.35, curls: -.6, mutation: .73, grammarSeed: 519 };
  const before = structuredClone(original);
  let current = original;
  for (const kind of LAB_KINDS) {
    current = parametersForRuleMode(current, `lab:${kind}`);
    assert.deepEqual(current.lab, defaultLab(kind), kind);
    assert.equal(current.generations, current.lab.iterations, kind);
    for (const key of Object.keys(DEFAULT_PARAMETERS).filter(key => key !== 'generations')) {
      assert.equal(current[key], original[key], `${kind}: shared ${key}`);
    }
    current.lab.lengthRatio = 1.13;
    current.lab.minLength = .99;
    current.lab.symbolRatio = 3.7;
  }
  assert.deepEqual(original, before, 'selection cannot change the caller');
  for (const type of L_SYSTEM_TYPES) {
    const next = parametersForRuleMode(current, type);
    assert.equal(next.lSystemType, type);
    assert.equal(Object.hasOwn(next, 'lab'), false, `${type}: numeric rules are cleared`);
    assert.equal(next.intervalMs, original.intervalMs);
    assert.deepEqual(sanitizeParameters(next), next);
  }
});

test('re-selecting an edited numeric rule retains it and synchronizes the iteration control', () => {
  const original = { ...DEFAULT_PARAMETERS, generations: 51, lab: { ...defaultLab('parametric'),
    iterations: 21, branchCount: 6, minLength: .004, pitchRatio: 1.17, angleIncrement: 36 } };
  const before = structuredClone(original), next = parametersForRuleMode(original, 'lab:parametric');
  assert.deepEqual(next.lab, original.lab);
  assert.equal(next.generations, 21);
  assert.deepEqual(original, before);
  const invalid = parametersForRuleMode(original, 'arbitrary');
  assert.equal(invalid.lSystemType, DEFAULT_PARAMETERS.lSystemType);
  assert.equal(Object.hasOwn(invalid, 'lab'), false);
});

test('the unified bank keeps the original order and adds complete uniquely identified lab scenes', () => {
  assert.equal(bank.length, classicBank.length + parametricPresets.length + experimentPresets.length);
  assert.equal(bank.length, 210, 'all 186 delay, 12 parametric and 12 experiment scenes are present');
  assert.deepEqual(bank.slice(0, classicBank.length), classicBank);
  for (let index = 0; index < classicBank.length; index++) assert.equal(bank[index], classicBank[index]);
  assert.equal(new Set(bank.map(preset => preset.id)).size, bank.length);
  assert.deepEqual(new Set(bank.map(preset => ruleMode(preset.snapshot.parameters))), new Set(RULE_MODES));
  for (const preset of bank) {
    assert.deepEqual(captureScene(preset.snapshot.parameters, preset.snapshot.performance), preset.snapshot, preset.id);
    assert.deepEqual(Object.keys(preset.snapshot.performance).sort(), ['dry', 'mastering', 'wet'], preset.id);
    assert.equal(Object.hasOwn(preset.snapshot.performance.mastering, 'makeupDb'), false, preset.id);
    if (preset.snapshot.parameters.lab) assert.equal(preset.snapshot.parameters.generations, preset.snapshot.parameters.lab.iterations, preset.id);
  }
  const copied = combinedPresets(classicBank);
  copied[classicBank.length].snapshot.parameters.lab.minLength = 1;
  copied[classicBank.length].snapshot.performance.mastering.thresholdDb = -60;
  assert.notEqual(parametricPresets[0].snapshot.parameters.lab.minLength, 1, 'copied lab scenes own their data');
  assert.notEqual(parametricPresets[0].snapshot.performance.mastering.thresholdDb, -60);
});

test('every preset recalls its entire scene across classic and numeric families while preserving the live session', () => {
  const predecessors = [classicBank.at(-1), ...LAB_KINDS.map(kind => bank.find(preset => preset.snapshot.parameters.lab?.kind === kind))];
  for (const previous of predecessors) for (const target of bank) {
    const live = { ...livePerformance, ...previous.snapshot.performance,
      mastering: { ...previous.snapshot.performance.mastering, makeupDb: 17 } };
    const liveBefore = structuredClone(live), snapshotBefore = structuredClone(target.snapshot);
    const recalled = presetState(target, live);
    assert.deepEqual(captureScene(recalled.parameters, recalled.performance), target.snapshot, `${previous.id} → ${target.id}`);
    for (const key of preserved) assert.equal(recalled.performance[key], live[key], `${target.id}: live ${key}`);
    assert.equal(recalled.performance.mastering.makeupDb, 17, `${target.id}: independent output boost`);
    assert.deepEqual(live, liveBefore);
    assert.deepEqual(target.snapshot, snapshotBefore);
  }
});

test('dice can select each rule family directly and clears inherited numeric rules on classic results', () => {
  const input = { ...DEFAULT_PARAMETERS, lab: { ...defaultLab('sphinx'), iterations: 19, minLength: 1 } };
  for (let index = 0; index < RULE_MODES.length; index++) {
    let first = true;
    const random = seeded(index + 1);
    const next = randomRuleState(input, livePerformance, () => {
      if (first) { first = false; return (index + .5) / RULE_MODES.length; }
      return random();
    });
    assert.equal(ruleMode(next.parameters), RULE_MODES[index]);
    assert.deepEqual(sanitizeParameters(next.parameters), next.parameters);
    if (next.parameters.lab) assert.equal(next.parameters.generations, next.parameters.lab.iterations);
    else assert.equal(Object.hasOwn(next.parameters, 'lab'), false);
    for (const key of preserved) assert.equal(next.performance[key], livePerformance[key], `${RULE_MODES[index]}: live ${key}`);
    assert.equal(next.performance.mastering.makeupDb, 17);
  }
});

test('seeded dice varies every native and numeric parameter without mutating its input or session', () => {
  const parameters = { ...DEFAULT_PARAMETERS, lab: defaultLab('parametric') };
  const before = structuredClone({ parameters, performance: livePerformance });
  const random = seeded(), scenes = Array.from({ length: 900 }, () => randomRuleState(parameters, livePerformance, random));
  assert.deepEqual(new Set(scenes.map(scene => ruleMode(scene.parameters))), new Set(RULE_MODES));
  for (const key of Object.keys(PARAMETER_LIMITS)) assert.ok(new Set(scenes.map(scene => scene.parameters[key])).size > 1, key);
  const modules = scenes.flatMap(scene => scene.parameters.lab ? [scene.parameters.lab] : []);
  for (const key of Object.keys(LAB_LIMITS)) assert.ok(new Set(modules.map(module => module[key])).size > 1, `numeric ${key}`);
  for (const key of ['wet', 'dry']) assert.ok(new Set(scenes.map(scene => scene.performance[key])).size > 1, key);
  for (const key of Object.keys(livePerformance.mastering).filter(key => key !== 'makeupDb')) {
    assert.ok(new Set(scenes.map(scene => scene.performance.mastering[key])).size > 1, `mastering ${key}`);
  }
  assert.deepEqual({ parameters, performance: livePerformance }, before);
  for (const value of [NaN, -Infinity, Infinity, -200, 500]) {
    const next = randomRuleState(parameters, livePerformance, () => value);
    assert.ok(RULE_MODES.includes(ruleMode(next.parameters)));
    assert.deepEqual(sanitizeParameters(next.parameters), next.parameters);
    assert.ok(Object.values(next.parameters).filter(value => typeof value === 'number').every(Number.isFinite));
  }
});
