import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStaircaseField, staircaseFieldContours, matchStaircaseBranches, readStaircaseRhythm,
  STAIRCASE_BRANCH_LIMIT as BRANCHES, STAIRCASE_BRANCH_OFFSET as BRANCH_OFFSET,
  STAIRCASE_FIELD_FRAMES as FRAMES, STAIRCASE_FIELD_STRIDE as STRIDE,
} from '../src/instruments/striped-staircase-rust/field.js';
import { createStaircaseFrame, cameraFromView, viewById } from '../src/instruments/striped-staircase/striped-staircase.js';

const defaultField = buildStaircaseField();
const difference = (left, right) => left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0);
const silentFrame = (field, index) => field.table.subarray(index * STRIDE, index * STRIDE + 534).every(value => value === 0);

test('original default detail provides finite real contours with the fixed Rust ABI', () => {
  assert.equal(defaultField.frames, FRAMES);
  assert.equal(defaultField.stride, STRIDE);
  assert.equal(defaultField.table.length, 64 * 672);
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
    assert.equal(overlay.branches.length, Math.min(BRANCHES, overlay.contours));
    assert.equal(overlay.omitted, Math.max(0, overlay.contours - BRANCHES));
    assert.equal(new Set(overlay.branches.map(branch => branch.slot)).size, overlay.branches.length);
    for (const branch of overlay.branches) {
      const offset = BRANCH_OFFSET + branch.slot * 4;
      assert.equal(record[offset], 1);
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
    for (let branch = 0; branch < BRANCHES; branch++) assert.equal(field.table[index * STRIDE + BRANCH_OFFSET + branch * 4], 0);
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
    assert.equal(transfers.length, 1 + FRAMES + message.overlays.reduce((sum, overlay) => sum + overlay.branches.length, 0));
    assert.equal(new Set(transfers).size, transfers.length);
    assert.equal(transfers[0], message.table.buffer);
  } finally { if (priorSelf === undefined) delete globalThis.self; else globalThis.self = priorSelf; }
});

test('separate measured contours become separate voice records, including real default branching', () => {
  const frame = defaultField.overlays.findIndex(overlay => overlay.contours >= 2 && overlay.contours <= BRANCHES);
  assert.ok(frame >= 0);
  const overlay = defaultField.overlays[frame];
  const record = defaultField.table.subarray(frame * STRIDE, (frame + 1) * STRIDE);
  assert.equal(overlay.branches.length, overlay.contours);
  assert.equal(Array.from({ length: BRANCHES }, (_, slot) => record[BRANCH_OFFSET + slot * 4]).filter(Boolean).length, overlay.contours);
  assert.ok(new Set(overlay.branches.map(branch => branch.cy.toFixed(3))).size > 1, 'separated heights yield distinct pitches');
});

test('branch matching preserves voices through length reordering and allocates split components separately', () => {
  const line = (x, y, height) => ({ points: [{ x, y }, { x, y: y + height / 2 }, { x, y: y + height }], length: height, closed: false });
  const first = matchStaircaseBranches([line(.2, .1, .3), line(.8, .5, .2)]);
  const next = matchStaircaseBranches([line(.79, .49, .4), line(.21, .11, .2), line(.4, .1, .1)], first);
  assert.equal(next[0].slot, first[1].slot);
  assert.equal(next[1].slot, first[0].slot);
  assert.equal(new Set(next.map(branch => branch.slot)).size, 3);
  assert.equal(matchStaircaseBranches(Array.from({ length: 80 }, (_, index) => line(index / 80, .2, .1))).length, BRANCHES);
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
