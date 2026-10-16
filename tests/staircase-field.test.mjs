import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStaircaseField, staircaseFieldContours, matchStaircaseBranches, pairStaircaseBlockEdges, readStaircaseRhythm,
  STAIRCASE_BRANCH_LIMIT as BRANCHES, STAIRCASE_BRANCH_OFFSET as BRANCH_OFFSET, STAIRCASE_BRANCH_STRIDE as BRANCH_STRIDE,
  STAIRCASE_FIELD_FRAMES as FRAMES, STAIRCASE_FIELD_STRIDE as STRIDE,
} from '../src/instruments/striped-staircase-rust/field.js';
import { createStaircaseFrame, cameraFromView, viewById } from '../src/instruments/striped-staircase/striped-staircase.js';

const defaultField = buildStaircaseField();
const difference = (left, right) => left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0);
const silentFrame = (field, index) => field.table.subarray(index * STRIDE, index * STRIDE + 534).every(value => value === 0);

test('original default detail provides finite real contours with the fixed Rust ABI', () => {
  assert.equal(defaultField.frames, FRAMES);
  assert.equal(defaultField.stride, STRIDE);
  assert.equal(defaultField.table.length, 64 * 3616);
  assert.ok(defaultField.stats.activeFrames > FRAMES / 2);
  assert.ok(defaultField.table.every(Number.isFinite));
  assert.ok(defaultField.overlays[Math.round(.12 * (FRAMES - 1))].points.length > 0);
  for (let index = 0; index < FRAMES; index++) {
    const record = defaultField.table.subarray(index * STRIDE, (index + 1) * STRIDE);
    const overlay = defaultField.overlays[index];
    if (!record[532]) { assert.ok(silentFrame(defaultField, index)); continue; }
    assert.equal(overlay.points.length, 512);
    assert.ok(overlay.points.every(value => value >= 0 && value <= 1));
    assert.ok(record.subarray(0, 512).every(value => value >= -1 && value <= 1));
    assert.ok(Math.abs(record.subarray(0, 256).reduce((sum, value) => sum + value, 0)) < 1e-5);
    assert.ok(Math.abs(record.subarray(256, 512).reduce((sum, value) => sum + value, 0)) < 1e-5);
    assert.ok(record[528] >= 0 && record[528] <= 1);
    assert.ok(record[529] > 0 && record[529] <= 1);
    assert.ok(record[533] >= 0 && record[533] <= 1);
    if (record[528] > 0) assert.ok(Math.abs(record.subarray(512, 528).reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
    assert.ok(record.subarray(536, BRANCH_OFFSET).every(value => value === 0));
    assert.equal(overlay.branches.length, Math.min(defaultField.voiceLimit, overlay.contours));
    assert.equal(overlay.omitted, Math.max(0, overlay.contours - defaultField.voiceLimit));
    assert.equal(new Set(overlay.branches.map(branch => branch.slot)).size, overlay.branches.length);
    for (const branch of overlay.branches) {
      const offset = BRANCH_OFFSET + branch.slot * BRANCH_STRIDE;
      assert.equal(record[offset], 1);
      assert.equal(record[offset + 4], branch.id);
      assert.equal(record[offset + 5], branch.parentId);
      assert.ok(branch.id > 0 && branch.id <= BRANCHES * FRAMES);
      assert.ok(Math.abs(record[offset + 1] - branch.cx) < 1e-7);
      assert.ok(Math.abs(record[offset + 2] - branch.cy) < 1e-7);
      assert.ok(record[offset + 3] > 0);
      assert.equal(branch.points.length, 128);
    }
  }
});

test('each table threshold matches the original sliding staircase and its stripe period', () => {
  const field = buildStaircaseField({ settings: { steps: 11, spacingCurve: 2.3, stripePeriod: 4.25 }, resolution: 64 });
  for (let index = 0; index < FRAMES; index++) {
    const original = createStaircaseFrame(index / (FRAMES - 1), field.settings, 'slide');
    const overlay = field.overlays[index];
    assert.equal(overlay.bandLow, original.renderLow);
    assert.equal(overlay.bandHigh, original.renderHigh);
    assert.equal(overlay.threshold, (original.renderLow + original.renderHigh) / 2);
    assert.ok(Math.abs(field.table[index * STRIDE + 534] - overlay.threshold) < 2e-5);
    assert.equal(field.table[index * STRIDE + 535], 4.25);
  }
});

test('unescaped interior is censored and silent instead of an artificial maximum-depth contour', () => {
  const field = buildStaircaseField({ camera: { centerX: 0, centerY: 0, scale: .02 } });
  assert.equal(field.stats.escaped, 0);
  assert.equal(field.stats.activeFrames, 0);
  assert.equal(field.stats.censored, field.stats.samples);
  for (let index = 0; index < FRAMES; index++) {
    assert.ok(silentFrame(field, index));
    assert.equal(field.overlays[index].points.length, 0);
    assert.equal(field.overlays[index].branches.length, 0);
    for (let branch = 0; branch < BRANCHES; branch++) assert.equal(field.table[index * STRIDE + BRANCH_OFFSET + branch * BRANCH_STRIDE], 0);
  }
  // A cell between known exterior and unescaped interior cannot locate a
  // threshold crossing, even if replacing NaN by maxIterations would do so.
  assert.deepEqual(staircaseFieldContours({ columns: 2, rows: 2, depth: new Float64Array([10, NaN, 10, NaN]) }, 20), []);
});

test('whole-set view never sonifies its iteration-cap censoring boundary', () => {
  const field = buildStaircaseField({ camera: cameraFromView(viewById('overview')), resolution: 64 });
  assert.ok(field.stats.censored > 0);
  assert.ok(field.stats.escaped > 0);
  assert.ok(field.stats.activeFrames < FRAMES);
  for (let index = 0; index < FRAMES; index++) {
    if (!field.overlays[index].points.length) assert.ok(silentFrame(field, index));
  }
  assert.ok(silentFrame(field, FRAMES - 1), 'no fabricated high-depth outline around unescaped pixels');
});

test('marching squares joins a real open contour and interpolates its true position', () => {
  const columns = 6, rows = 5;
  const depth = Float64Array.from({ length: columns * rows }, (_, index) => index % columns);
  const contours = staircaseFieldContours({ columns, rows, depth }, 2.5, 1.5);
  assert.equal(contours.length, 1);
  assert.equal(contours[0].closed, false);
  assert.equal(contours[0].points.length, rows);
  assert.ok(Math.abs(contours[0].length - 1) < 1e-12);
  assert.ok(contours[0].points.every(point => point.x === .5));
});

test('open-path oscillator samples retrace measured geometry instead of closing across empty space', () => {
  const index = defaultField.overlays.findIndex(overlay => overlay.points.length && !overlay.closed);
  assert.ok(index >= 0);
  const points = defaultField.overlays[index].points;
  for (let sample = 1; sample < 128; sample++) {
    assert.ok(Math.abs(points[sample * 2] - points[(256 - sample) * 2]) < 1e-7);
    assert.ok(Math.abs(points[sample * 2 + 1] - points[(256 - sample) * 2 + 1]) < 1e-7);
  }
});

test('camera and viewport aspect change the measured contours and densities', () => {
  const camera = cameraFromView();
  const moved = buildStaircaseField({ camera: { ...camera, centerX: camera.centerX + .008 } });
  const portrait = buildStaircaseField({ aspect: .6 });
  assert.ok(difference(defaultField.table, moved.table) > 100);
  assert.ok(difference(defaultField.table, portrait.table) > 100);
  assert.notEqual(defaultField.stats.escaped, moved.stats.escaped);
  assert.notEqual(defaultField.stats.escaped, portrait.stats.escaped);
  const movedGeometry = moved.table.filter((_, index) => index % STRIDE < 512);
  const originalGeometry = defaultField.table.filter((_, index) => index % STRIDE < 512);
  assert.ok(difference(originalGeometry, movedGeometry) > 100);
});

test('hostile numeric parameters remain finite with bounded computation and deterministic results', () => {
  const input = { camera: { centerX: NaN, centerY: Infinity, scale: -1e12 }, aspect: Infinity, resolution: 1e12,
    settings: { maxIterations: Infinity, startIteration: NaN, steps: -999, spacingCurve: 'bad', stripePeriod: -1e12 } };
  const field = buildStaircaseField(input);
  assert.ok(field.table.every(Number.isFinite));
  assert.ok(field.stats.samples <= 192 * 144);
  assert.ok(field.stats.columns <= 192);
  assert.ok(field.stats.rows <= 144);
  assert.deepEqual(buildStaircaseField(input).table, field.table);
  assert.equal(field.settings.stripePeriod, .5);
});

test('worker preserves request revision and transfers every owned numeric buffer', async () => {
  const priorSelf = globalThis.self;
  let message, transfers;
  try {
    globalThis.self = { postMessage(value, transfer) { message = value; transfers = transfer; } };
    await import('../src/instruments/striped-staircase-rust/worker.js');
    globalThis.self.onmessage({ data: { type: 'analyze', revision: 42, resolution: 32 } });
    assert.equal(message.type, 'field');
    assert.equal(message.revision, 42);
    assert.equal(message.table.length, FRAMES * STRIDE);
    assert.equal(transfers.length, 2 + FRAMES + message.overlays.reduce((sum, overlay) => sum + overlay.branches.length, 0));
    assert.equal(new Set(transfers).size, transfers.length);
    assert.equal(transfers[0], message.table.buffer);
    assert.equal(transfers[1], message.features.buffer);
  } finally { if (priorSelf === undefined) delete globalThis.self; else globalThis.self = priorSelf; }
});

test('separate measured contours become separate voice records, including real default branching', () => {
  const frame = defaultField.overlays.findIndex(overlay => overlay.contours >= 2 && overlay.contours <= BRANCHES);
  assert.ok(frame >= 0);
  const overlay = defaultField.overlays[frame];
  const record = defaultField.table.subarray(frame * STRIDE, (frame + 1) * STRIDE);
  assert.equal(overlay.branches.length, overlay.contours);
  assert.equal(Array.from({ length: BRANCHES }, (_, slot) => record[BRANCH_OFFSET + slot * BRANCH_STRIDE]).filter(Boolean).length, overlay.contours);
  assert.ok(new Set(overlay.branches.map(branch => branch.cy.toFixed(3))).size > 1, 'separated heights yield distinct pitches');
});

test('branch matching preserves voices through length reordering and allocates split components separately', () => {
  const line = (x, y, height) => ({ points: [{ x, y }, { x, y: y + height / 2 }, { x, y: y + height }], length: height, closed: false });
  const first = matchStaircaseBranches([line(.2, .1, .3), line(.8, .5, .2)]);
  const next = matchStaircaseBranches([line(.79, .49, .4), line(.21, .11, .2), line(.4, .1, .1)], first);
  assert.equal(next[0].slot, first[1].slot);
  assert.equal(next[1].slot, first[0].slot);
  assert.equal(new Set(next.map(branch => branch.slot)).size, 3);
  assert.equal(matchStaircaseBranches(Array.from({ length: 700 }, (_, index) => line(index / 700, .2, .1))).length, BRANCHES);
});

test('rhythm feedback reads the audio table and distinguishes white notes from black rests', () => {
  for (const progress of [.175, .19, .333, .349]) {
    const reading = readStaircaseRhythm(defaultField, progress);
    const at = progress * (FRAMES - 1), low = Math.floor(at), mix = at - low;
    const threshold = defaultField.table[low * STRIDE + 534] * (1 - mix) + defaultField.table[(low + 1) * STRIDE + 534] * mix;
    assert.equal(reading.threshold, threshold);
    assert.ok(Math.abs((reading.bandLow + reading.bandHigh) / 2 - threshold) < 1e-12);
    assert.equal(reading.white, Math.floor(threshold / defaultField.settings.stripePeriod * 2) % 2 === 1);
    assert.ok(reading.branches.length <= BRANCHES);
    for (const branch of reading.branches) assert.ok(branch.points?.length);
  }
  assert.equal(readStaircaseRhythm(defaultField, .175).white, true);
  assert.equal(readStaircaseRhythm(defaultField, .19).white, false);
});

test('display sweep remains on the audio stripe between prepared frames at narrow stripe widths', () => {
  const field = buildStaircaseField({ settings: { steps: 48, stripePeriod: .5 }, resolution: 64 });
  for (let index = 0; index < 1000; index++) {
    const reading = readStaircaseRhythm(field, (index + .37) / 1000);
    const sweep = (reading.bandLow + reading.bandHigh) / 2;
    assert.equal(Math.floor(sweep / field.settings.stripePeriod * 2) % 2 === 1, reading.white);
  }
});

test('nearby offshoots inherit a parent reference while disconnected births get a fresh reference', () => {
  const line = (x, y, height) => ({ points: [{ x, y }, { x, y: y + height / 2 }, { x, y: y + height }], length: height, closed: false });
  const identity = { nextId: 1 };
  const first = matchStaircaseBranches([line(.4, .2, .6)], [], 1, { identity });
  const split = matchStaircaseBranches([line(.39, .2, .3), line(.41, .55, .25), line(.95, .9, .04)], first, 1, { identity });
  assert.equal(new Set(split.map(branch => branch.id)).size, 3);
  assert.equal(split.filter(branch => branch.id === first[0].id).length, 1);
  assert.equal(split.filter(branch => branch.parentId === first[0].id).length, 1);
  assert.equal(split[2].parentId, 0, 'unrelated component does not inherit a fabricated parent');
  const next = matchStaircaseBranches([line(.4, .22, .3), line(.42, .57, .25), line(.94, .9, .04)], split, 1, { identity });
  assert.deepEqual(next.map(branch => [branch.id, branch.parentId]), split.map(branch => [branch.id, branch.parentId]));
});

test('expanded voice selection retains hundreds of actual components and reports smaller requested budgets', () => {
  const camera = cameraFromView(viewById('double-spiral'));
  const expanded = buildStaircaseField({ camera, resolution: 112, voiceLimit: 512 });
  const reduced = buildStaircaseField({ camera, resolution: 112, voiceLimit: 16 });
  assert.ok(expanded.stats.maxContours > 256);
  assert.ok(expanded.overlays.some(frame => frame.branches.length > 256));
  assert.ok(reduced.overlays.every(frame => frame.branches.length <= 16));
  assert.equal(expanded.stats.maxContours, reduced.stats.maxContours);
  for (const frame of expanded.overlays) assert.equal(frame.omitted, Math.max(0, frame.contours - 512));
  for (const frame of reduced.overlays) assert.equal(frame.omitted, Math.max(0, frame.contours - 16));
});

test('different branch identities never interpolate a fictional reference position between them', () => {
  const field = buildStaircaseField({ resolution: 32, voiceLimit: 1 });
  for (let frame = 0; frame < FRAMES; frame++) {
    field.table.set([1, frame % 2 ? .9 : .1, .4, .1, frame + 1, 0], frame * STRIDE + BRANCH_OFFSET);
  }
  for (const mix of [.25, .75]) {
    const reading = readStaircaseRhythm(field, mix / (FRAMES - 1));
    assert.equal(reading.branches[0].cx, mix < .5 ? Math.fround(.1) : Math.fround(.9));
    assert.equal(reading.branches[0].id, mix < .5 ? 1 : 2);
  }
});

const sampledScalar = (value, columns = 65, rows = 65) => ({ columns, rows,
  depth: Float64Array.from({ length: columns * rows }, (_, index) => value((index % columns) / (columns - 1), Math.floor(index / columns) / (rows - 1))) });
const openLine = (x, y, height) => ({ points: [{ x, y }, { x, y: y + height / 2 }, { x, y: y + height }], length: height, closed: false });

test('block edges measure the two actual band crossings instead of a contour centroid or bounding box', () => {
  // A sloped scalar field gives exact straight boundaries, with an analytic
  // aspect-correct normal and no ambiguity from the Mandelbrot sampling grid.
  const aspect = 2, low = .6, high = 1;
  const field = sampledScalar((x, y) => x + y);
  const paths = staircaseFieldContours(field, .8, aspect);
  const tendrils = matchStaircaseBranches(paths, [], aspect);
  const voices = pairStaircaseBlockEdges(field, tendrils, paths, low, high, aspect);
  assert.equal(voices.length, 2);
  const lower = voices.find(voice => voice.boundary === 'low'), upper = voices.find(voice => voice.boundary === 'high');
  for (const [voice, threshold] of [[lower, low], [upper, high]]) {
    assert.ok(Math.abs(voice.cx + voice.cy - threshold) < 1e-12);
    assert.ok(Math.abs(voice.anchor.x + voice.anchor.y - .8) < 1e-12);
    assert.ok(Math.hypot(voice.cx - tendrils[0].cx, voice.cy - tendrils[0].cy) > .1);
    assert.ok(voice.points.some((x, index) => index % 2 === 0 && Math.abs(x - voice.cx) < 1e-7 && Math.abs(voice.points[index + 1] - voice.cy) < 1e-7), 'local trace includes the exact selected boundary point');
    for (let index = 0; index < voice.points.length; index += 2) assert.ok(Math.abs(voice.points[index] + voice.points[index + 1] - threshold) < 1e-6);
    assert.equal(voice.weight, Math.min(1, tendrils[0].length / 8) / 2);
  }
  assert.ok(Math.abs((upper.cy - lower.cy) / (upper.cx - lower.cx) - aspect ** 2) < 1e-10,
    'normal uses physical viewport distance rather than squashed normalized coordinates');
  // The normalized weight is halved after the original length clamp.
  tendrils[0].length = 20;
  assert.ok(pairStaircaseBlockEdges(field, tendrils, paths, low, high, aspect).every(voice => voice.weight === .5));
});

test('curved ribbons keep inherited side identity when the two edges reverse their screen X order', () => {
  const field = sampledScalar((x, y) => Math.hypot(x - .5, y - .5), 129, 129);
  const paths = staircaseFieldContours(field, .2);
  const first = matchStaircaseBranches(paths);
  const seed = [{ ...first[0], anchor: { x: .7, y: .5 } }];
  const right = pairStaircaseBlockEdges(field, first, paths, .15, .25, 1, seed);
  assert.equal(right.length, 2);
  assert.equal(right[0].boundary, 'low');
  assert.ok(right[0].cx < right[1].cx);
  // Transport the same contour anchor around the measured circular ribbon.
  // Its inherited low/high identity must not be redefined by current screen X.
  const previous = [{ ...first[0], anchor: { x: .3, y: .5 } }];
  const next = matchStaircaseBranches(paths, previous);
  const left = pairStaircaseBlockEdges(field, next, paths, .15, .25, 1, previous);
  assert.equal(left.length, 2);
  assert.deepEqual(left.map(voice => [voice.id, voice.side, voice.boundary]), right.map(voice => [voice.id, voice.side, voice.boundary]));
  assert.ok(left[0].cx > left[1].cx, 'side0 remains the low boundary around the bend');
  for (const voice of [...right, ...left]) {
    const radius = Math.hypot(voice.cx - .5, voice.cy - .5);
    assert.ok(Math.abs(radius - (voice.boundary === 'low' ? .15 : .25)) < .0002);
  }
});

test('a measured split inherits each parent side and emits two independently addressed half-weight voices', () => {
  const field = sampledScalar(x => x), identity = { nextId: 1 };
  const paths = [openLine(.4, .2, .6)];
  const first = matchStaircaseBranches(paths, [], 1, { identity });
  const parentVoices = pairStaircaseBlockEdges(field, first, paths, .3, .5);
  const splitPaths = [openLine(.4, .2, .25), openLine(.4, .55, .25)];
  const split = matchStaircaseBranches(splitPaths, first, 1, { identity });
  const voices = pairStaircaseBlockEdges(field, split, splitPaths, .3, .5, 1, first);
  assert.equal(voices.length, 4);
  const child = split.find(branch => branch.parentId === first[0].id);
  assert.ok(child);
  const pair = voices.filter(voice => voice.tendrilId === child.id);
  for (let side = 0; side < 2; side++) {
    assert.equal(pair[side].slot, 2 * child.slot + side);
    assert.equal(pair[side].id, 2 * child.id - 1 + side);
    assert.equal(pair[side].parentId, parentVoices[side].id);
    assert.equal(pair[side].boundary, parentVoices[side].boundary);
    assert.equal(pair[side].weight, child.length / 16);
    assert.equal(pair[side].anchor.x, .4);
  }
});

test('a missing viewport side, censored crossing, or wrong first boundary rejects the entire pair', () => {
  const field = sampledScalar(x => x);
  const paths = staircaseFieldContours(field, .4);
  const branches = () => matchStaircaseBranches(paths);
  assert.equal(pairStaircaseBlockEdges(field, branches(), paths, .3, .5).length, 2);
  assert.deepEqual(pairStaircaseBlockEdges(field, branches(), paths, -.1, .5), [], 'low edge outside viewport is not invented');
  const censored = sampledScalar(x => x > .43 && x < .47 ? NaN : x);
  assert.deepEqual(pairStaircaseBlockEdges(censored, branches(), paths, .3, .5), [], 'cannot jump unknown cells to a remote visible boundary');
  // The increasing normal meets a local maximum and turns back below the low
  // threshold before a farther high contour. Independent nearest-edge matching
  // would reach across that intervening band exit; the first-hit rule rejects it.
  const folded = sampledScalar(x => x <= .42 ? x : x < .65 ? .42 - 1.5 * (x - .42) : .075 + 3 * (x - .65), 201, 65);
  const local = [openLine(.4, .2, .6)];
  assert.deepEqual(pairStaircaseBlockEdges(folded, matchStaircaseBranches(local), local, .3, .5), []);
});

test('a clipped anchor recovers only along a bounded nearby part of its own middle contour', () => {
  const field = sampledScalar((x, y) => x + y);
  const paths = staircaseFieldContours(field, .8);
  const prior = matchStaircaseBranches(paths);
  prior[0].anchor = { x: 0, y: .8 };
  const next = matchStaircaseBranches(paths, prior);
  const voices = pairStaircaseBlockEdges(field, next, paths, .6, 1, 1, prior);
  assert.equal(voices.length, 2, 'a viewport endpoint does not permanently mute a usable ribbon');
  const anchor = voices[0].anchor;
  assert.ok(Math.abs(anchor.x + anchor.y - .8) < 1e-12, 'fallback remains on the very same mid-contour');
  const traveled = Math.hypot(anchor.x, anchor.y - .8);
  assert.ok(traveled <= .2 && traveled > 0);
  assert.ok(voices.every(voice => Math.abs(voice.cx + voice.cy - (voice.boundary === 'low' ? .6 : 1)) < 1e-12));
});

test('unpaired parents retain a side orientation before their first audible pair and pass it to offspring', () => {
  const identity = { nextId: 1 }, paths = [openLine(.4, .2, .6)];
  const parent = matchStaircaseBranches(paths, [], 1, { identity });
  assert.deepEqual(pairStaircaseBlockEdges(sampledScalar(x => x), parent, paths, -.1, .5), []);
  assert.deepEqual(parent[0].edgeOrder, ['low', 'high']);
  const splitPaths = [openLine(.4, .2, .25), openLine(.4, .55, .25)];
  const split = matchStaircaseBranches(splitPaths, parent, 1, { identity });
  // Increasing scalar now points toward screen left. The parent's earlier
  // orientation survives the gap, so its child's side0 must still mean low.
  const voices = pairStaircaseBlockEdges(sampledScalar(x => 1 - x), split, splitPaths, .5, .7, 1, parent);
  assert.equal(voices.length, 4);
  const child = voices.find(voice => voice.parentId && voice.side === 0);
  assert.ok(child);
  assert.equal(child.parentId, parent[0].id * 2 - 1);
  assert.equal(child.boundary, 'low');
  assert.ok(child.cx > voices.find(voice => voice.id === child.id + 1).cx);
});

test('desktop aspect keeps a usable long pair at a two-tone budget and preserves side ancestry across the whole sweep', () => {
  const options = { pitchSource: 1, resolution: 112, aspect: 1.3788659793814433 };
  const field = buildStaircaseField(options), limited = buildStaircaseField({ ...options, voiceLimit: 2 });
  const reading = readStaircaseRhythm(limited, .175);
  assert.equal(reading.count, 2);
  assert.equal(reading.tendrils, 1);
  const pair = reading.branches.filter(voice => voice.presence > .5);
  assert.ok(Math.hypot((pair[0].cx - pair[1].cx) * options.aspect, pair[0].cy - pair[1].cy) > 1 / field.stats.rows,
    'the locally tracked long component keeps two resolved crossings at least one sample cell apart');
  assert.ok(pair.every(voice => voice.length > .05), 'the selected long component keeps useful voice weight');
  const measuredPair = limited.overlays[11].branches;
  assert.deepEqual(new Set(measuredPair.map(voice => voice.boundary)), new Set(['low', 'high']));
  for (const voice of measuredPair) {
    assert.ok(Array.from({ length: voice.points.length / 2 }, (_, i) => i).some(i =>
      Math.hypot(voice.points[i * 2] - voice.cx, voice.points[i * 2 + 1] - voice.cy) < 1e-6),
    'each crossing lies on its own measured boundary trace');
  }
  const history = new Map();
  let inherited = 0, reversed = 0;
  for (const overlay of field.overlays) for (const voice of overlay.branches) {
    const old = history.get(voice.id);
    if (old) assert.equal(voice.boundary, old.boundary, 'a returning pair never swaps sides');
    const parent = history.get(voice.parentId);
    if (parent) { assert.equal(voice.side, parent.side); assert.equal(voice.boundary, parent.boundary); inherited++; }
    if (voice.side === 0 && old) {
      const partner = overlay.branches.find(other => other.id === voice.id + 1), oldPartner = history.get(voice.id + 1);
      if (partner && oldPartner && (voice.cx - partner.cx) * (old.cx - oldPartner.cx) < 0) reversed++;
    }
    history.set(voice.id, voice);
  }
  assert.ok(inherited > 0 && reversed > 0, 'real measured history contains both offshoots and retained pairs around bends');
  for (const voice of history.values()) if (history.has(voice.parentId)) assert.equal(voice.boundary, history.get(voice.parentId).boundary);
  for (const overlay of limited.overlays) {
    assert.ok(overlay.branches.length <= 2);
    assert.equal(overlay.tendrils + overlay.omitted + overlay.unpaired, overlay.contours);
  }
});

test('real block-edge fields preserve other sonifications and report complete pairs, budgets and unmatched tendrils', () => {
  const options = { resolution: 112, voiceLimit: 8 };
  const centers = buildStaircaseField(options), edges = buildStaircaseField({ ...options, pitchSource: 1 });
  assert.equal(centers.pitchSource, 0);
  assert.equal(edges.pitchSource, 1);
  assert.ok(edges.table.every(Number.isFinite));
  assert.ok(edges.overlays.some(overlay => overlay.tendrils > 0));
  assert.ok(edges.overlays.some(overlay => overlay.unpaired > 0));
  for (let frame = 0; frame < FRAMES; frame++) {
    assert.deepEqual(edges.table.subarray(frame * STRIDE, frame * STRIDE + 536), centers.table.subarray(frame * STRIDE, frame * STRIDE + 536));
    assert.equal(edges.table[frame * STRIDE + 536], 1, 'paired source is explicit for tendril-level power normalization');
    assert.equal(centers.table[frame * STRIDE + 536], 0);
    assert.ok(edges.table.subarray(frame * STRIDE + 537, frame * STRIDE + BRANCH_OFFSET).every(value => value === 0));
    const overlay = edges.overlays[frame];
    assert.ok(overlay.branches.length <= 8);
    assert.equal(overlay.branches.length, overlay.tendrils * 2);
    assert.equal(overlay.tendrils + overlay.unpaired + overlay.omitted, overlay.contours);
    for (let index = 0; index < overlay.branches.length; index += 2) {
      const pair = overlay.branches.slice(index, index + 2);
      assert.equal(pair[0].tendrilId, pair[1].tendrilId);
      assert.deepEqual(pair.map(branch => branch.side), [0, 1]);
      assert.deepEqual(new Set(pair.map(branch => branch.boundary)), new Set(['low', 'high']));
      assert.equal(pair[0].slot % 2, 0);
      assert.equal(pair[1].slot, pair[0].slot + 1);
      for (const branch of pair) {
        const at = frame * STRIDE + BRANCH_OFFSET + branch.slot * BRANCH_STRIDE;
        assert.equal(edges.table[at], 1);
        assert.equal(edges.table[at + 4], 2 * branch.tendrilId - 1 + branch.side);
        assert.equal(edges.table[at + 1], Math.fround(branch.cx));
        assert.equal(edges.table[at + 2], Math.fround(branch.cy));
        assert.equal(edges.table[at + 3], Math.fround(branch.weight));
        assert.ok(branch.points.every(value => Number.isFinite(value) && value >= -1e-7 && value <= 1 + 1e-7));
      }
    }
    const reading = readStaircaseRhythm(edges, frame / (FRAMES - 1));
    assert.equal(reading.pitchSource, 1);
    assert.equal(reading.count, overlay.branches.length);
    assert.equal(reading.tendrils, overlay.tendrils);
    assert.equal(reading.unpaired, overlay.unpaired);
    assert.equal(reading.omitted, overlay.omitted);
  }
  const pairField = buildStaircaseField({ resolution: 112, voiceLimit: 1, pitchSource: 1 });
  assert.equal(pairField.voiceLimit, 2);
  assert.equal(readStaircaseRhythm(pairField, .175).count, 2);
  assert.equal(buildStaircaseField({ resolution: 32, voiceLimit: 7, pitchSource: 1 }).voiceLimit, 6);
  assert.equal(buildStaircaseField({ resolution: 32, voiceLimit: Infinity, pitchSource: 1 }).voiceLimit, 256);
  for (const amount of [.175, .181, .239]) {
    const reading = readStaircaseRhythm(edges, amount);
    assert.equal(reading.count % 2, 0);
    for (const voice of reading.branches) {
      const partner = reading.branches.find(branch => branch.tendrilId === voice.tendrilId && branch.side !== voice.side);
      assert.ok(partner);
      assert.equal(partner.presence, voice.presence);
      assert.ok(voice.points.length && voice.anchor && voice.boundary);
    }
  }
});

test('block-edge worker replies transfer all pair traces without duplicate or hidden typed buffers', async () => {
  const priorSelf = globalThis.self;
  let message, transfers;
  try {
    globalThis.self = { postMessage(value, transfer) { message = value; transfers = transfer; } };
    await import('../src/instruments/striped-staircase-rust/worker.js?paired');
    globalThis.self.onmessage({ data: { type: 'analyze', revision: 43, resolution: 64, pitchSource: 1, voiceLimit: 16 } });
    assert.equal(message.type, 'field');
    assert.equal(message.revision, 43);
    assert.equal(message.pitchSource, 1);
    const buffers = new Set();
    const visit = value => {
      if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(message);
    assert.equal(new Set(transfers).size, transfers.length);
    assert.deepEqual(new Set(transfers), buffers);
    assert.ok(message.overlays.some(overlay => overlay.branches.length));
  } finally { if (priorSelf === undefined) delete globalThis.self; else globalThis.self = priorSelf; }
});
