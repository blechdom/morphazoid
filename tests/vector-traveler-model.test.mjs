import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraceBank, readerGuide, sampleTraceLayer, sampleReaderLayer, TRACE_TABLE_SIZE, READER_BEAD_LIMIT } from '../src/instruments/vector-fractals/trace-model.js';

const TAU = 2 * Math.PI;
const view = { x: -.5, y: .1, width: 3.4, aspect: 1 };
const square = [[-.4, -.4], [.4, -.4], [.4, .4], [-.4, .4]];
function geometry(points, closed = true) {
  return { points: new Float32Array(points.flat()), offsets: new Uint32Array([0, points.length]), closed: new Uint8Array([Number(closed)]), view, depth: 12 };
}
function bankFor(points = square, options = {}, closed = true) {
  const source = geometry(points, closed);
  return createTraceBank([source, source, source], { contourReader: 'traveler', ...options });
}
function near(a, b, tolerance = 1e-5) {
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
}
function nearArrays(a, b, tolerance = 1e-5) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) near(a[i], b[i], tolerance);
}
function subdivide(points, divisions, closed = true) {
  const dense = [];
  for (let i = 0; i < points.length - Number(!closed); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = 0; j < divisions; j++) dense.push([a[0] + (b[0] - a[0]) * j / divisions, a[1] + (b[1] - a[1]) * j / divisions]);
  }
  if (!closed) dense.push(points.at(-1));
  return dense;
}

test('Traveler starts at the top, accumulates four right turns, and shares its table with the sounding contact', () => {
  const bank = bankFor(), layer = bank.layers[2];
  assert.equal(bank.reader, 'traveler');
  assert.equal(bank.travelerDirection, 'clockwise');
  assert.equal(readerGuide(bank, .25), null);
  near(layer.x[0], .4); near(layer.y[0], .4);
  near(layer.x[1], .4); assert.ok(layer.y[1] < layer.y[0]);
  assert.equal(layer.turn.length, TRACE_TABLE_SIZE);
  assert.equal(layer.turn[0], 0);
  near(layer.turnPerLap, -TAU);
  assert.equal(layer.contacts[0].turn, layer.turn);
  assert.equal(layer.contacts[0].turnPerLap, layer.turnPerLap);
  for (const phase of [0, .25, .5, .75, 1, 2, -1]) {
    const sample = sampleTraceLayer(layer, phase);
    near(sample.turn, -TAU * phase);
    near(sampleReaderLayer(layer, phase)[0].turn, sample.turn);
  }
});

test('Traveler direction options leave the established Trace reader unchanged', () => {
  const source = geometry(square);
  const clockwise = createTraceBank([source, source, source], { contourReader: 'trace', travelerDirection: 'clockwise' });
  const counterclockwise = createTraceBank([source, source, source], { contourReader: 'trace', travelerDirection: 'counterclockwise' });
  assert.deepEqual(clockwise, counterclockwise);
  assert.ok(clockwise.layers[2].x[1] < clockwise.layers[2].x[0]);
});

test('circle accumulated turning advances one full revolution per lap, independent of source ordering and direction', () => {
  const circle = Array.from({ length: 4096 }, (_, i) => [.35 * Math.cos(TAU * i / 4096), .35 * Math.sin(TAU * i / 4096)]);
  for (const travelerDirection of ['clockwise', 'counterclockwise']) {
    const sign = travelerDirection === 'clockwise' ? -1 : 1;
    const layer = bankFor(circle, { travelerDirection }).layers[2];
    const reversed = bankFor(circle.toReversed(), { travelerDirection }).layers[2];
    near(layer.x[0], 0); near(layer.y[0], .35);
    assert.ok(sign * layer.x[1] < 0);
    near(layer.turnPerLap, sign * TAU);
    for (const key of ['x', 'y', 'turn']) nearArrays(layer[key], reversed[key]);
    for (let i = 0; i <= 32; i++) near(sampleTraceLayer(layer, i / 16).turn, sign * TAU * i / 16, 3e-5);
  }
});

test('concave outlines retain left turns among right turns instead of accumulating absolute curvature', () => {
  const outline = [[-.4, .4], [.4, .4], [.4, -.4], [0, -.4], [0, 0], [-.4, 0]];
  const layer = bankFor(outline, { featureSize: .025 }).layers[2];
  near(layer.turnPerLap, -TAU);
  const changes = Array.from(layer.turn, (turn, i) => i ? turn - layer.turn[i - 1] : 0);
  assert.ok(changes.some(value => value > .01), 'left turns locally raise signed angle (and lower mapped pitch)');
  assert.ok(changes.some(value => value < -.01), 'right turns locally lower signed angle (and raise mapped pitch)');
  near(sampleTraceLayer(layer, 1).turn, -TAU);
});

test('arc-length smoothing and drum timing survive subdivisions, duplicates, source rotation and source reversal', () => {
  const outline = [[-.4, -.3], [.3, -.3], [.4, .2], [.1, .08], [-.3, .4]];
  const dense = subdivide(outline, 31);
  const rotated = [...dense.slice(17), ...dense.slice(0, 17)].reverse();
  const duplicated = rotated.flatMap((point, i) => i % 7 === 0 ? [point, point] : [point]);
  duplicated.push(duplicated[0]);
  const a = bankFor(outline, { featureSize: .04, drumSpacing: .04 }).layers[2];
  const b = bankFor(duplicated, { featureSize: .04, drumSpacing: .04 }).layers[2];
  near(a.turnPerLap, b.turnPerLap);
  for (const key of ['x', 'y', 'turn']) nearArrays(a[key], b[key], 3e-5);
  assert.equal(a.events.length, b.events.length);
  a.events.forEach((event, i) => {
    for (const key of ['phase', 'x', 'y', 'turn']) near(event[key], b.events[i][key], 3e-5);
  });
});

test('Feature size broadens corner responses without changing the total signed turning or position', () => {
  const fine = bankFor(square, { featureSize: .005 }).layers[2];
  const broad = bankFor(square, { featureSize: .12 }).layers[2];
  const changing = layer => Array.from(layer.turn).filter((value, i) => i && Math.abs(value - layer.turn[i - 1]) > 1e-5).length;
  assert.ok(changing(broad) > 10 * changing(fine));
  assert.deepEqual(fine.x, broad.x); assert.deepEqual(fine.y, broad.y);
  near(fine.turnPerLap, broad.turnPerLap);
  for (const layer of [fine, broad]) for (const phase of [.25, .5, .75, 1]) near(sampleTraceLayer(layer, phase).turn, -TAU * phase);
});

test('turn interpolation crosses seams continuously and accounts for positive and negative complete laps', () => {
  const layer = bankFor().layers[2];
  const sample = phase => sampleTraceLayer(layer, phase);
  const before = sample(1 - .25 / TRACE_TABLE_SIZE), after = sample(1 + .25 / TRACE_TABLE_SIZE);
  assert.ok(before.turn > -TAU && after.turn < -TAU);
  assert.ok(Math.abs(after.turn - before.turn) < .06, 'seam is another smooth piece of the turn');
  const offset = .17325, origin = sample(offset);
  for (const lap of [-11, -2, 1, 9]) {
    const point = sample(offset + lap);
    near(point.x, origin.x); near(point.y, origin.y);
    near(point.turn, origin.turn + lap * layer.turnPerLap);
  }
  const last = layer.turn.at(-1), phase = 1 - .5 / TRACE_TABLE_SIZE;
  near(sample(phase).turn, (last + layer.turn[0] + layer.turnPerLap) / 2);
});

test('open crops retrace signed turns, hold pitch at reversals and never invent a closing turn', () => {
  const points = [[-.4, -.2], [-.4, .2], [.4, .2], [.4, -.2]];
  const layer = bankFor(points, { featureSize: .02 }, false).layers[2];
  const reversed = bankFor(points.toReversed(), { travelerDirection: 'counterclockwise', featureSize: .02 }, false).layers[2];
  assert.equal(layer.closed, false); assert.equal(layer.turnPerLap, 0);
  assert.deepEqual(layer.turn, reversed.turn);
  near(sampleTraceLayer(layer, 0).turn, 0);
  for (const phase of [.49, .5, .51]) near(sampleTraceLayer(layer, phase).turn, -Math.PI);
  near(sampleTraceLayer(layer, 1).turn, 0);
  for (let i = 1; i < TRACE_TABLE_SIZE / 2; i++) near(layer.turn[i], layer.turn[TRACE_TABLE_SIZE - i]);
  for (const bead of layer.beads) for (const phase of bead.phases) {
    const point = sampleReaderLayer(layer, phase)[0];
    near(point.x, bead.x, .001); near(point.y, bead.y, .001); near(point.turn, bead.turn, .005);
  }
  const straight = bankFor([[-.4, -.3], [.4, .2]], {}, false).layers[2];
  assert.ok(straight.turn.every(value => value === 0));
});

test('each layer begins at its own top, while an explicit anchor selects the same projected seam for tones and beads', () => {
  const shifted = square.map(([x, y]) => [x * .6 - .1, y * .6 + .05]);
  const bank = createTraceBank([geometry(shifted), geometry(shifted), geometry(square)], { contourReader: 'traveler' });
  near(bank.layers[0].y[0], .29); near(bank.layers[0].x[0], .14);
  near(bank.layers[2].y[0], .4); near(bank.layers[2].x[0], .4);
  const anchor = { x: view.x + .4 * view.width, y: view.y + .1 * view.width };
  for (const travelerDirection of ['clockwise', 'counterclockwise']) {
    const selected = bankFor(square, { anchor, travelerDirection }).layers[2];
    near(selected.x[0], .4); near(selected.y[0], .1);
    assert.equal(selected.turn[0], 0);
    for (const event of selected.events) {
      const point = sampleReaderLayer(selected, event.phase)[0];
      near(point.x, event.x, .001); near(point.y, event.y, .001); near(point.turn, event.turn, .005);
    }
  }
});

test('dense source geometry preserves multiple turns instead of forcing every closed path to one revolution', () => {
  // More than half the table size in turns exposes the aliasing that occurs
  // when a reader unwraps headings only after bounded position resampling.
  const count = 16000, turns = 1300;
  const points = Array.from({ length: count }, (_, i) => {
    const angle = turns * TAU * i / count;
    return [.3 * Math.cos(angle), .3 * Math.sin(angle)];
  });
  const layer = bankFor(points, { featureSize: .00005, drumSpacing: .006 }).layers[2];
  near(layer.turnPerLap, -turns * TAU);
  near(sampleTraceLayer(layer, 1).turn, -turns * TAU);
  assert.equal(layer.contacts.length, 1);
  assert.ok(layer.beads.length <= READER_BEAD_LIMIT);
  assert.ok(layer.events.length <= 2 * READER_BEAD_LIMIT);
  for (const key of ['x', 'y', 'turn', 'bend', 'fold']) {
    assert.equal(layer[key].length, TRACE_TABLE_SIZE);
    assert.ok(layer[key].every(Number.isFinite));
  }
  assert.ok(layer.events.every(event => Number.isFinite(event.turn)));
});

test('empty Traveler results remain empty and invalid options fall back to finite defaults', () => {
  const bank = createTraceBank([null, null, null], { contourReader: 'traveler', travelerDirection: 'invalid', featureSize: NaN });
  assert.equal(bank.travelerDirection, 'clockwise');
  for (const layer of bank.layers) {
    assert.equal(layer.turn.length, 0); assert.equal(layer.turnPerLap, 0);
    assert.deepEqual(layer.contacts, []); assert.deepEqual(layer.events, []);
    assert.deepEqual(sampleReaderLayer(layer, .5), []);
  }
});
