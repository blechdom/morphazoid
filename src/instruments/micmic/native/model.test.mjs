import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { generationTopology, generationVoiceSpecs, timeFoldFromSlider, sliderFromTimeFold } from '../micmic.js';
import { MICMIC_FULL_PRESETS } from '../../../families/branch-presets/full-presets.js';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, PARAMETER_LIMITS, L_SYSTEM_TYPES, sanitizeParameters,
  sanitizePerformance, presetState, randomState, gestureParameters, isVoiceActive,
  buildPreview, interpolateParameters, topologyBounds, fitTransform, captureScene, visualBudget, nativePreviewNodes, interpolatePreviewNodes,
  admittedPreviewNodes, tapActivityFrame, activityEnergy, smoothActivity, branchWavePoints } from './model.js';
import { DEFAULT_MASTERING, MASTERING_LIMITS, MASTERING_PROFILES, sanitizeMastering, captureMastering,
  cutoffFromSlider, sliderFromCutoff, masteringProfileId } from './mastering.js';
const presets = JSON.parse(fs.readFileSync(new URL('./presets.json', import.meta.url)));
// Compare the original musical mix independently of the live gain controls.
const withoutMastering = snapshot => {
  const { mastering, ...performance } = snapshot.performance;
  return { ...snapshot, performance };
};
const legacyScene = scene => withoutMastering(captureScene(scene.parameters, scene.performance));

test('native bank preserves the sound settings in all sixteen original scenes', () => {
  for (const reference of MICMIC_FULL_PRESETS) {
    const preset = presets.find(p => p.id === reference.id);
    assert.ok(preset, reference.id);
    const original = reference.snapshot.parameters, scene = presetState(preset, DEFAULT_PERFORMANCE);
    assert.deepEqual(sanitizeParameters(scene.parameters), scene.parameters);
    assert.deepEqual(scene.parameters, { lSystemType: original.lSystemType, generations: original.generations,
      intervalMs: original.interval, timeRatio: original.timeRatio, angle: original.generationAngle,
      asymmetry: original.generationAsymmetry, mutation: original.mutation, pitchScale: original.generationPitchScale,
      pruningBias: original.pruningBias, depth: original.depth, spread: original.spread }, preset.id);
    assert.deepEqual(legacyScene(scene).performance, {
      wet: original.wet, dry: original.dry,
    }, `${preset.id} mix`);
    assert.equal(preset.label, reference.label);
    assert.deepEqual(legacyScene(scene), withoutMastering(preset.snapshot));
    assert.deepEqual(captureScene(scene.parameters, scene.performance).performance.mastering, captureMastering(DEFAULT_MASTERING));
  }
});
test('full preset recall preserves live gains, input, clocks and device policy', () => {
  const mastering = { ...DEFAULT_MASTERING, highpassHz: 160, lowpassHz: 6200, thresholdDb: -23, ratio: 3.5, makeupDb: 1.5 };
  const live = { ...DEFAULT_PERFORMANCE, mastering, source: 'mic', frozen: true, frequency: 311, pulseRate: .7, inputGain: 4, level: .22, voiceCeiling: 512, automatic: false };
  const before = structuredClone(live);
  for (const preset of presets) {
    const scene = presetState(preset, live);
    assert.deepEqual(legacyScene(scene), withoutMastering(preset.snapshot), preset.id);
    assert.deepEqual(scene.performance.mastering, { ...DEFAULT_MASTERING, makeupDb: mastering.makeupDb }, `${preset.id} recalls Original filters and compression`);
    for (const key of ['source', 'frozen', 'frequency', 'pulseRate', 'inputGain', 'level', 'voiceCeiling', 'automatic']) assert.equal(scene.performance[key], live[key]);
  }
  assert.deepEqual(live, before);
});
test('additional factory scenes retain every grammar in the single full-preset menu', () => {
  const originalIds = new Set(MICMIC_FULL_PRESETS.map(p => p.id));
  const additions = presets.filter(p => !originalIds.has(p.id));
  assert.equal(additions.length, 10);
  assert.equal(new Set(presets.map(p => p.id)).size, presets.length);
  assert.equal(new Set(presets.map(p => JSON.stringify(p.snapshot))).size, presets.length);
  assert.deepEqual(new Set(presets.map(p => p.snapshot.parameters.lSystemType)), new Set(L_SYSTEM_TYPES));
  const html = fs.readFileSync(new URL('../../../pages/l-mic-rust.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /data-generation-preset|id="generationPresets"/);
  for (const preset of additions) {
    assert.ok(preset.label.includes(' · '), preset.id);
    assert.ok(preset.snapshot.parameters.generations > 13, `${preset.id} explores the native generation range`);
    assert.deepEqual(Object.keys(preset.snapshot.parameters).sort(), ['lSystemType', ...Object.keys(PARAMETER_LIMITS)].sort());
    assert.deepEqual(Object.keys(preset.snapshot.performance).sort(), ['dry', 'mastering', 'wet']);
    assert.deepEqual(preset.snapshot.performance.mastering, captureMastering(DEFAULT_MASTERING));
  }
});
test('complete randomization preserves live audio, seed clock, master level and device policy', () => {
  const live = { ...DEFAULT_PERFORMANCE, source: 'mic', frozen: true, frequency: 311, pulseRate: .7, inputGain: 4, level: .22,
    mastering: { ...DEFAULT_MASTERING, makeupDb: 24 }, voiceCeiling: 512, automatic: false };
  let seed = 428733; const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0xffffffff);
  const scenes = [];
  for (let i = 0; i < 50; i++) scenes.push(randomState(DEFAULT_PARAMETERS, live, rng));
  for (const scene of scenes) {
    for (const key of ['source', 'frozen', 'frequency', 'pulseRate', 'inputGain', 'level', 'voiceCeiling', 'automatic']) assert.equal(scene.performance[key], live[key]);
    assert.equal(scene.performance.mastering.makeupDb, live.mastering.makeupDb);
  }
  for (const key of [...Object.keys(PARAMETER_LIMITS), 'lSystemType']) assert.ok(new Set(scenes.map(s => s.parameters[key])).size > 3, key);
  for (const key of ['wet', 'dry']) assert.ok(new Set(scenes.map(s => s.performance[key])).size > 3, key);
  for (const key of Object.keys(MASTERING_LIMITS).filter(key => key !== 'makeupDb')) {
    assert.ok(new Set(scenes.map(s => s.performance.mastering[key])).size > 3, `mastering/${key}`);
  }
  for (const key of ['compressorEnabled', 'autoMakeup']) {
    assert.deepEqual(new Set(scenes.map(s => s.performance.mastering[key])), new Set([false, true]), `mastering/${key}`);
  }
});
test('original Time fold curve retains its three physical timing regions', () => {
  assert.deepEqual([0, 150, 300, 900, 1000].map(timeFoldFromSlider), [1, 50, 240, 1000, 3000]);
  for (const ms of [1, 50, 240, 1000, 3000]) assert.equal(timeFoldFromSlider(sliderFromTimeFold(ms)), ms);
});
test('native preview retains the original binary rewrite without its 128-per-generation cap', () => {
  const p = { ...DEFAULT_PARAMETERS, generations: 13 }, tree = buildPreview(p, generationTopology);
  assert.equal(tree.length, 16383); assert.equal(tree.filter(n => n.generation === 13).length, 8192);
  const small = { ...p, generations: 6, mutation: .33, timeRatio: .83, angle: 67, asymmetry: .2 };
  const actual = buildPreview(small, generationTopology), original = generationTopology({ generations: 6, branching: 1, mutation: .33, timeRatio: .83, angle: 67, asymmetry: .2 });
  for (let i = 0; i < actual.length; i++) for (const key of ['x', 'y', 'startX', 'startY', 'timeScale', 'headingDegrees']) {
    if (i === 0 && key === 'timeScale') continue;
    assert.ok(Math.abs(actual[i][key] - original[i][key]) < 1e-10, `${i}/${key}`);
  }
});
test('all eleven native grammar previews use original canonical turtle geometry', () => {
  for (const lSystemType of L_SYSTEM_TYPES.filter(id => id !== 'pythagorean')) {
    const p = { ...DEFAULT_PARAMETERS, lSystemType, generations: 7, mutation: .2, angle: 73, asymmetry: -.17, timeRatio: 1.4 };
    const actual = buildPreview(p, generationTopology), expected = generationTopology({ ...p, branching: 1 });
    assert.equal(actual.length, expected.length, lSystemType);
    for (let i = 0; i < actual.length; i++) for (const key of ['x', 'y', 'startX', 'startY', 'timeScale', 'turnDegrees']) assert.equal(actual[i][key], expected[i][key], `${lSystemType}/${i}/${key}`);
    assert.ok(actual.every(n => [n.x, n.y, n.delay, n.rate, n.gain].every(Number.isFinite)));
  }
});
test('breadth/depth pruning keeps every active prefix connected across silent gaps', () => {
  for (const pruningBias of [0, .35, .65, 1]) {
    const nodes = buildPreview({ ...DEFAULT_PARAMETERS, generations: 7, pruningBias }, generationTopology);
    const selected = nodes.filter(n => isVoiceActive(n, 37)), ids = new Set(['trunk', ...selected.map(n => n.id)]);
    assert.equal(selected.length, 37); assert.ok(selected.every(n => ids.has(n.parentId)));
    assert.ok(nodes.every(n => !isVoiceActive(n, 0)));
  }
  const zero = buildPreview({ ...DEFAULT_PARAMETERS, depth: 0 }, generationTopology);
  assert.equal(zero.filter(n => isVoiceActive(n, 16384)).length, 0);
});
test('continuous preview interpolates locally and locked fit stays independent of timing', () => {
  const from = DEFAULT_PARAMETERS, to = { ...from, angle: 75, timeRatio: .91 };
  const frames = [0, .25, .5, .75, 1].map(t => interpolateParameters(from, to, t));
  assert.deepEqual(frames[0], from); assert.deepEqual(frames.at(-1), to);
  assert.equal(new Set(frames.map(p => p.angle)).size, 5);
  for (const p of frames) assert.ok(p.angle >= 45 && p.angle <= 75);
  const a = buildPreview(from, generationTopology), b = buildPreview({ ...from, intervalMs: 3000 }, generationTopology);
  assert.deepEqual(fitTransform(topologyBounds(a), 1000, 700), fitTransform(topologyBounds(b), 1000, 700));
  assert.deepEqual(gestureParameters(from, 0, 0, 1000, 700), from);
  const moved = gestureParameters(from, 100, -100, 1000, 700); assert.ok(moved.angle > from.angle && moved.intervalMs > from.intervalMs);
});
test('parameter sanitization retains finite controls and native limits', () => {
  assert.equal(sanitizeParameters({ angle: NaN }).angle, 45);
  assert.equal(sanitizeParameters({ generations: 20, pruningBias: -1 }).generations, 20);
  assert.equal(sanitizePerformance({ dry: 1, inputGain: 4 }).dry, .5);
  assert.equal(sanitizePerformance({ dry: 1, inputGain: 4 }).inputGain, 4);
  assert.equal(sanitizePerformance({ inputGain: 5 }).inputGain, 4);
});

test('mastering sanitization bounds every musical field and rejects non-finite cutoffs', () => {
  assert.deepEqual(sanitizeMastering(), DEFAULT_MASTERING);
  assert.deepEqual(sanitizeMastering(null), DEFAULT_MASTERING);
  const ranges = {
    inputHighpassHz: [0, 2000], highpassHz: [0, 2000], lowpassHz: [0, 20000],
    thresholdDb: [-60, 0], kneeDb: [0, 40], ratio: [1, 20], attackMs: [.1, 100],
    releaseMs: [10, 1500], makeupDb: [-12, 24],
  };
  assert.deepEqual(MASTERING_LIMITS, ranges);
  for (const [key, [low, high]] of Object.entries(ranges)) {
    assert.equal(sanitizeMastering({ [key]: -Infinity })[key], DEFAULT_MASTERING[key], key);
    assert.equal(sanitizeMastering({ [key]: NaN })[key], DEFAULT_MASTERING[key], key);
    assert.equal(sanitizeMastering({ [key]: low - 1000 })[key], low, key);
    assert.equal(sanitizeMastering({ [key]: high + 1000 })[key], high, key);
    assert.equal(sanitizeMastering({ [key]: (low + high) / 2 })[key], (low + high) / 2, key);
  }
  const candidate = { ...DEFAULT_MASTERING, compressorEnabled: false, autoMakeup: false };
  const copy = structuredClone(candidate);
  assert.deepEqual(sanitizePerformance({ mastering: candidate }).mastering, candidate);
  assert.deepEqual(candidate, copy, 'Sanitizing must not mutate a captured master bus');
  assert.deepEqual(sanitizePerformance({ mastering: null }).mastering, DEFAULT_MASTERING);
});

test('filter sliders reserve Off and cover the audible cutoff range continuously', () => {
  for (const maximum of [2000, 20000]) {
    assert.equal(cutoffFromSlider(0, maximum), 0);
    assert.equal(sliderFromCutoff(0, maximum), 0);
    assert.equal(cutoffFromSlider(1, maximum), 20);
    assert.equal(cutoffFromSlider(1000, maximum), maximum);
    let previous = 0;
    for (let position = 1; position <= 1000; position += 37) {
      const hz = cutoffFromSlider(position, maximum);
      assert.ok(hz > previous && hz <= maximum);
      // Cutoff values are rounded to six decimal Hz before native transport.
      assert.ok(Math.abs(sliderFromCutoff(hz, maximum) - position) < 1e-5);
      previous = hz;
    }
  }
  assert.equal(cutoffFromSlider(0, 20000, true), 20);
  assert.equal(cutoffFromSlider(999, 20000, true), 20000);
  assert.equal(cutoffFromSlider(1000, 20000, true), 0);
  assert.equal(sliderFromCutoff(0, 20000, true), 1000);
  assert.equal(sliderFromCutoff(20, 20000, true), 0);
  assert.equal(sliderFromCutoff(20000, 20000, true), 999);
  let previous = 0;
  for (let position = 0; position <= 999; position += 37) {
    const hz = cutoffFromSlider(position, 20000, true);
    assert.ok(hz > previous && hz <= 20000);
    assert.ok(Math.abs(sliderFromCutoff(hz, 20000, true) - position) < 1e-5);
    previous = hz;
  }
});

test('mastering profiles cover filters and compression while complete scenes own their settings', () => {
  assert.deepEqual(MASTERING_PROFILES.map(profile => profile.label),
    ['Original', 'Transparent', 'Gentle', 'Dense', 'Warm', 'Airy', 'Telephone']);
  assert.equal(new Set(MASTERING_PROFILES.map(profile => profile.id)).size, 7);
  assert.equal(new Set(MASTERING_PROFILES.map(profile => JSON.stringify(profile.settings))).size, 7);
  assert.deepEqual(MASTERING_PROFILES[0].settings, captureMastering(DEFAULT_MASTERING));
  for (const profile of MASTERING_PROFILES) {
    assert.deepEqual(captureMastering(profile.settings), profile.settings, profile.id);
    assert.equal(masteringProfileId(profile.settings), profile.id);
    for (const makeupDb of [-12, 0, 24]) assert.equal(masteringProfileId({ ...profile.settings, makeupDb }), profile.id);
  }
  const live = { ...DEFAULT_PERFORMANCE, source: 'seed', level: .17, frozen: true,
    frequency: 311, pulseRate: .7, automatic: false, voiceCeiling: 512,
    mastering: MASTERING_PROFILES.find(profile => profile.label === 'Telephone').settings };
  const parameters = { ...DEFAULT_PARAMETERS, lSystemType: 'dragon', intervalMs: 611 };
  const saved = captureScene(parameters, live);
  assert.deepEqual(saved.performance.mastering, live.mastering);
  assert.notEqual(saved.performance.mastering, live.mastering, 'Saved mastering must be an independent snapshot');
  const changed = { ...live, mastering: DEFAULT_MASTERING, wet: .12, source: 'mic', frozen: false };
  const recalled = presetState({ snapshot: saved }, changed);
  assert.deepEqual(captureScene(recalled.parameters, recalled.performance), saved);
  for (const key of ['source', 'frozen', 'frequency', 'pulseRate', 'voiceCeiling', 'automatic']) {
    assert.equal(recalled.performance[key], changed[key], `Saved recall preserves live ${key}`);
  }
  const legacy = structuredClone(saved);
  delete legacy.performance.mastering;
  const legacyRecall = presetState({ snapshot: legacy }, changed);
  assert.deepEqual(legacyRecall.performance.mastering, DEFAULT_MASTERING, 'Older scenes reset absent mastering to Original');
  assert.deepEqual(legacyScene(legacyRecall), legacy);
});

test('native Choose keeps the complete original catalogue, grouping and icon provenance', async () => {
  const { TOOL_GROUPS, FAVE_TOOL_IDS } = await import('../../../site/instrument-registry.js');
  const originalGroups = TOOL_GROUPS.flatMap(group => {
    const tools = group.tools.filter(tool => group.picker !== false || tool.picker === true);
    return tools.length ? [{ id: group.id, label: group.label, tools: tools.map(tool => ({ id: tool.id, label: tool.label,
      href: tool.href, imageHref: tool.imageHref ?? `assets/instruments/${tool.id}.webp` })) }] : [];
  });
  const byId = new Map(TOOL_GROUPS.flatMap(group => group.tools).map(tool => [tool.id, { id: tool.id, label: tool.label, href: tool.href, imageHref: tool.imageHref ?? `assets/instruments/${tool.id}.webp` }]));
  originalGroups.unshift({ id: 'faves', label: 'Faves', tools: FAVE_TOOL_IDS.map(id => byId.get(id)).filter(Boolean) });
  const html = fs.readFileSync(new URL('../../../pages/l-mic-rust.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /nativeNavigationData/, 'Choose never bakes an outdated catalogue');
  assert.match(app, /FAVE_TOOL_IDS, TOOL_GROUPS/, 'Choose consumes the shared registry');
  assert.ok(originalGroups[0].tools.some(tool => tool.id === 'synthesis'), 'Faves includes the owner-selected lab even outside base picker groups');
  const { nextPickerTool } = await import('../../../../nav.js');
  const expectedTour = []; let cursor = null;
  do { cursor = nextPickerTool(cursor)?.id; if (expectedTour.includes(cursor)) break; expectedTour.push(cursor); } while (cursor);
  const actualTour = [...new Set(originalGroups.flatMap(group => group.tools).map(tool => tool.id))];
  assert.deepEqual(actualTour, expectedTour, 'Original native navigation tour preserves all choices and Faves order');
});


test('classic preview highlights the same budgeted branches as original and native pruning', () => {
  for (const lSystemType of L_SYSTEM_TYPES.filter(id => id !== 'pythagorean')) for (const pruningBias of [0, .35, .65, 1]) {
    const p = { ...DEFAULT_PARAMETERS, lSystemType, generations: 13, pruningBias };
    const actual = buildPreview(p, generationTopology).filter(n => isVoiceActive(n, 48)).sort((a, b) => a.priority - b.priority).map(n => n.id);
    const expected = generationVoiceSpecs({ ...p, branching: 1, interval: p.intervalMs, maximumVoices: 48 }).map(n => n.key.replace(/^generation:/, ''));
    assert.deepEqual(actual, expected, `${lSystemType}/${pruningBias}`);
  }
});


test('audio demand and user ceilings can exceed the old voice guard while preview remains bounded', () => {
  assert.equal(DEFAULT_PERFORMANCE.source, 'mic');
  assert.equal(DEFAULT_PERFORMANCE.voiceCeiling, 0);
  assert.equal(sanitizePerformance({ voiceCeiling: 100000 }).voiceCeiling, 100000);
  const tree = buildPreview({ ...DEFAULT_PARAMETERS, generations: 20 }, generationTopology);
  assert.equal(tree.length, 16383);
});


test('graphics back off before audio deadlines while gestures retain smooth interpolation', () => {
  assert.deepEqual(visualBudget(.3, .5, false), { fps: 30, branches: 640, pressure: 0 });
  const reduced = visualBudget(.7, .86, false);
  assert.equal(reduced.fps, 15); assert.equal(reduced.branches, 160);
  const severe = visualBudget(.9, .96, false);
  assert.equal(severe.fps, 8); assert.equal(severe.branches, 64);
  assert.equal(visualBudget(.9, .96, true).fps, 30);
});


test('authoritative preview retains native priorities and interpolates endpoints', () => {
  const nodes = nativePreviewNodes([{ key: 'generation:trunk/B', parentKey: 'generation:trunk', generation: 14, priority: 1, voiceIndex: 100, x: 3, y: 2, startX: 1, startY: 0 }]);
  assert.equal(nodes[0].id, 'trunk/B'); assert.equal(nodes[0].priority, 1);
  const previous = new Map([[nodes[0].id, { ...nodes[0], x: 1 }]]);
  assert.equal(interpolatePreviewNodes(nodes, previous, .5)[0].x, 2);
});

test('tap meters retain native pool slots across grammar ordering and pruning changes', () => {
  for (const lSystemType of L_SYSTEM_TYPES) {
    const breadth = buildPreview({ ...DEFAULT_PARAMETERS, generations: 7, lSystemType }, generationTopology);
    const depth = buildPreview({ ...DEFAULT_PARAMETERS, generations: 7, lSystemType, pruningBias: 1 }, generationTopology);
    assert.deepEqual(breadth.map(n => [n.id, n.voiceIndex]), depth.map(n => [n.id, n.voiceIndex]), lSystemType);
    assert.ok(breadth.every((n, i) => n.voiceIndex === i - 1), lSystemType);
    assert.equal(new Set(breadth.map(n => n.voiceIndex)).size, breadth.length);
  }
  const parameters = { ...DEFAULT_PARAMETERS, generations: 7 };
  const reply = { parameters, topologyRevision: 12, status: { topologyRevision: 12, wetBusGain: .5,
    tapVoiceIndices: [44, 0, -1], tapActivity: [.8, 0, 1], generationActivity: [1, 1, 1] } };
  const frame = tapActivityFrame(reply, parameters);
  assert.equal(frame.levels.get(44), .4); assert.equal(frame.levels.get(0), 0);
  assert.equal(frame.levels.has(-1), false);
  // Changing rank order cannot assign a loud sibling to the silent slot.
  const remapped = tapActivityFrame({ ...reply, status: { ...reply.status, tapVoiceIndices: [0, 44], tapActivity: [0, .8] } }, parameters);
  assert.equal(remapped.levels.get(44), .4); assert.equal(remapped.levels.get(0), 0);
  const muted = tapActivityFrame({ ...reply, status: { ...reply.status, wetBusGain: 0 } }, parameters);
  assert.ok([...muted.levels.values()].every(level => level === 0));
});

test('tap coloring rejects stale renderer revisions and different visible topology identities', () => {
  const parameters = { ...DEFAULT_PARAMETERS, generations: 6 };
  const reply = { parameters, topologyRevision: 4, status: { topologyRevision: 4, wetBusGain: 1, tapVoiceIndices: [3], tapActivity: [.2] } };
  assert.equal(tapActivityFrame(reply, parameters).levels.get(3), .2);
  assert.equal(tapActivityFrame({ ...reply, status: { ...reply.status, topologyRevision: 3 } }, parameters), null);
  assert.equal(tapActivityFrame(reply, { ...parameters, generations: 7 }), null);
  assert.equal(tapActivityFrame(reply, { ...parameters, lSystemType: 'cantor' }), null);
  for (const [key, value] of Object.entries({ intervalMs: 1200, angle: 132, timeRatio: 1.42,
    pitchScale: 2.9, asymmetry: -.44, spread: .07, pruningBias: .8, depth: .12, mutation: .91 })) {
    assert.notEqual(parameters[key], value);
    assert.equal(tapActivityFrame(reply, { ...parameters, [key]: value }), null,
      `${key}: old meters cannot color a recalled scene with the same grammar and generation count`);
  }
  assert.equal(tapActivityFrame({ ...reply, status: { ...reply.status, tapActivity: undefined } }, parameters), null);
  assert.equal(tapActivityFrame({ ...reply, topologyRevision: undefined }, parameters), null);
});

test('audio pressure changes frame detail while retaining every admitted branch eligible for signal response', () => {
  const nodes = buildPreview({ ...DEFAULT_PARAMETERS, generations: 10 }, generationTopology), limit = 1000;
  const expected = new Set(nodes.filter(n => n.generation === 0 || isVoiceActive(n, limit)).map(n => n.id));
  for (const [load, peak] of [[.1, .2], [.7, .86], [.9, .96]]) {
    const budget = visualBudget(load, peak);
    const actual = admittedPreviewNodes(nodes, limit);
    assert.equal(actual.length, 1001);
    assert.deepEqual(new Set(actual.map(n => n.id)), expected);
    assert.ok(actual.length > budget.branches, 'detail budget never slices admission coverage');
  }
});

test('tap brightness responds continuously to faint sound and smoothly releases between meter packets', () => {
  assert.equal(activityEnergy(0), 0); assert.ok(activityEnergy(1e-8) > 0);
  assert.ok(activityEnergy(.1) > activityEnergy(.01));
  const target = activityEnergy(.2), attack = smoothActivity(0, target, 16);
  assert.ok(attack > 0 && attack < target);
  const release = smoothActivity(attack, 0, 50);
  assert.ok(release > 0 && release < attack);
  assert.ok(Math.abs(smoothActivity(release, 0, 50) - smoothActivity(attack, 0, 100)) < 1e-12);
  assert.equal(smoothActivity(0, target, 0), 0);
  assert.equal(smoothActivity(1e-6, 0, 100), 0);
});

test('all grammar waves retain an interior bend at maximum density and every graphics pressure tier', () => {
  for (const lSystemType of L_SYSTEM_TYPES) {
    const nodes = buildPreview({ ...DEFAULT_PARAMETERS, lSystemType }, generationTopology);
    const fit = fitTransform(topologyBounds(nodes), 1000, 700);
    const measured = nodes.filter(n => isVoiceActive(n, 2048));
    assert.ok(measured.length > 0, lSystemType);
    for (const [load, peak] of [[.1, .2], [.7, .86], [.9, .96]]) {
      const budget = visualBudget(load, peak);
      // Includes the former endpoint-only fallback for dense classic curves.
      const detail = Math.max(1, Math.min(14, Math.floor(budget.branches * 8 / measured.length)));
      for (const node of measured) {
        const start = { x: node.startX * fit.scale + fit.x, y: -node.startY * fit.scale + fit.y };
        const end = { x: node.x * fit.scale + fit.x, y: -node.y * fit.scale + fit.y };
        const points = branchWavePoints(node, start, end, .18, detail);
        assert.ok(points.length >= 6);
        assert.deepEqual(points[0], start); assert.deepEqual(points.at(-1), end);
        const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
        const deviation = Math.max(...points.map(p => Math.abs((p.x - start.x) * dy - (p.y - start.y) * dx) / length));
        assert.ok(deviation > .01, `${lSystemType}/${node.id}/${budget.pressure}: real activity must have visible curve geometry`);
        for (const reducedMotion of [false, true]) {
          const silent = branchWavePoints(node, start, end, reducedMotion ? .18 : 0, detail, reducedMotion);
          assert.ok(silent.every(p => Math.abs((p.x - start.x) * dy - (p.y - start.y) * dx) / length < 1e-8));
        }
      }
    }
  }
});

test('screen-space magnification makes ordinary sounding branches visible, stays bounded and continuous, and preserves quiet endpoints', () => {
  const start = { x: 0, y: 0 }, energy = activityEnergy(.0005);
  const node = { generation: 3, voiceIndex: 4, measuredEnergy: energy, startDelay: 0, delay: .07 };
  for (const length of [12, 33, 60, 100, 160]) {
    const end = { x: length, y: 0 };
    const sweep = Array.from({ length: 20 }, (_, i) => branchWavePoints(node, start, end, () => 0, 14, false, i / 20));
    const maximum = Math.max(...sweep.flat().map(p => Math.abs(p.y)));
    assert.ok(maximum >= 1, `${length}px: ordinary measured audio makes a clearly visible wave`);
    assert.ok(maximum <= 16, `${length}px: visual response remains bounded`);
    assert.ok(sweep.every(points => points[0].x === start.x && points[0].y === start.y
      && points.at(-1).x === end.x && points.at(-1).y === end.y), 'joined endpoints remain fixed');
    const silent = branchWavePoints({ ...node, measuredEnergy: 0 }, start, end, () => .03, 14, false, .37);
    assert.ok(silent.every(point => point.y === 0 && point.energy === 0), 'measured silence remains exactly straight with zero signal energy');
  }
  for (const length of [1.5, 23.999, 24.001, 35.999, 36.001, 63.999, 64.001, 100]) {
    const a = branchWavePoints(node, start, { x: length, y: 0 }, energy, 4);
    const b = branchWavePoints(node, start, { x: length + .001, y: 0 }, energy, 4);
    assert.ok(a.every((p, i) => Math.abs(p.y - b[i].y) < .001));
  }
});
