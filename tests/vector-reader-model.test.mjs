import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTraceBank, sampleReaderLayer, readerGuide, TRACE_TABLE_SIZE,
  READER_SEGMENT_LIMIT, READER_CONTACT_LIMIT, READER_BEAD_LIMIT,
} from '../src/instruments/vector-fractals/trace-model.js';

const view = { x: -.5, y: 0, width: 3.4, aspect: 1 };
const square = [[-.4, -.4], [.4, -.4], [.4, .4], [-.4, .4]];
function geometry(paths, sourceView = view) {
  const points = [], offsets = [0], closed = [];
  for (const path of paths) {
    points.push(...path.points.flat()); offsets.push(points.length / 2); closed.push(path.closed ? 1 : 0);
  }
  return { view: sourceView, points: new Float32Array(points), offsets: new Uint32Array(offsets), closed: new Uint8Array(closed), depth: 12 };
}
function subdivide(points, divisions, closed) {
  const result = [];
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = 0; j < divisions; j++) result.push([a[0] + (b[0] - a[0]) * j / divisions, a[1] + (b[1] - a[1]) * j / divisions]);
  }
  if (!closed) result.push(points.at(-1));
  return result;
}
function bankFor(paths, options = {}) {
  const source = geometry(paths);
  return createTraceBank([source, source, source], options);
}
function near(a, b, epsilon = 1e-6) { assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`); }

test('beads use equal geometric arc spacing, unaffected by adding vertices or reversing their order', () => {
  const coarse = bankFor([{ points: square, closed: true }], { drumSpacing: .1 }).layers[2];
  const dense = bankFor([{ points: subdivide(square, 17, true).reverse(), closed: true }], { drumSpacing: .1 }).layers[2];
  assert.equal(coarse.beads.length, 32); assert.equal(dense.beads.length, 32);
  for (let i = 0; i < coarse.beads.length; i++) {
    const a = coarse.beads[i], b = dense.beads[i], next = coarse.beads[(i + 1) % coarse.beads.length];
    near(a.x, b.x); near(a.y, b.y); near(a.bend, b.bend); near(a.fold, b.fold);
    near(Math.hypot(next.x - a.x, next.y - a.y), .1);
    assert.deepEqual(a.phases, [i / 32]);
  }
  const small = geometry([{ points: square.map(([x, y]) => [x / 2, y / 2]), closed: true }]);
  const large = geometry([{ points: square, closed: true }]);
  const layers = createTraceBank([small, small, large], { drumSpacing: .1 }).layers;
  assert.equal(layers[2].beads.length, layers[0].beads.length * 2, 'longer contours have more beads at the same requested spacing');
});

test('closed drum spacing distributes the residual around the seam instead of leaving one shortened interval', () => {
  const layer = bankFor([{ points: square, closed: true }], { drumSpacing: .11 }).layers[0];
  const phases = layer.events.map(event => event.phase);
  for (let i = 0; i < phases.length; i++) near((phases[(i + 1) % phases.length] + (i === phases.length - 1 ? 1 : 0)) - phases[i], 1 / phases.length);
  assert.equal(phases.filter(phase => phase === 0).length, 1);
  assert.ok(phases.every(phase => phase < 1));
});

test('open Trace beads retrace their actual arc, with one strike at each reversal and no artificial closing chord', () => {
  const layer = bankFor([{ points: [[-.4, -.2], [-.4, .2], [.4, .2]], closed: false }], { drumSpacing: .2 }).layers[2];
  assert.equal(layer.beads.length, 7); assert.equal(layer.events.length, 12);
  assert.deepEqual(layer.beads[0].phases, [0]); assert.deepEqual(layer.beads.at(-1).phases, [.5]);
  for (const bead of layer.beads) {
    assert.ok(Math.abs(bead.x + .4) < 1e-6 || Math.abs(bead.y - .2) < 1e-6);
    for (const phase of bead.phases) {
      const point = sampleReaderLayer(layer, phase)[0];
      // Events retain exact arc positions; the established finite Trace table
      // linearly bridges a sub-pixel interval when a bead sits on a sharp corner.
      near(point.x, bead.x, .001); near(point.y, bead.y, .001);
    }
  }
  assert.ok(layer.events.every(event => event.phase >= 0 && event.phase < 1));
});

test('Radar schedules beads by angle, keeps radial coincidences simultaneous and excludes the undefined center', () => {
  const bank = bankFor([{ points: [[0, -.4], [0, 0]], closed: false }], { contourReader: 'radar', drumSpacing: .1 });
  const layer = bank.layers[0];
  assert.equal(layer.beads.length, 5); assert.equal(layer.events.length, 4);
  assert.ok(layer.events.every(event => event.phase === 0));
  assert.deepEqual(layer.beads.at(-1).phases, []);
  const shifted = bankFor([{ points: [[0, -.4], [0, 0]], closed: false }], { contourReader: 'radar', radarX: -.2, drumSpacing: .1 });
  assert.ok(shifted.layers[0].events.every(event => event.phase > 0 && event.phase <= .25));
  assert.ok(new Set(shifted.layers[0].events.map(event => event.phase)).size > 1, 'moving the center changes the rhythm');
});

test('Scan uses one viewport sweep for every layer, with two projected crossings and single endpoint reversals', () => {
  const full = geometry([{ points: [[-.5, 0], [.5, 0]], closed: false }]);
  const part = geometry([{ points: [[-.25, -.2], [.25, -.2]], closed: false }]);
  const bank = createTraceBank([full, part, full], { contourReader: 'scan', drumSpacing: .2 });
  assert.equal(bank.scanMin, -.5); assert.equal(bank.scanMax, .5);
  const layer = bank.layers[0];
  assert.deepEqual(layer.beads[0].phases, [0]); assert.deepEqual(layer.beads.at(-1).phases, [.5]);
  assert.equal(layer.events.length, 2 * layer.beads.length - 2);
  const partial = bank.layers[1];
  assert.deepEqual(partial.beads[0].phases, [.125, .875]);
  assert.deepEqual(partial.beads.at(-1).phases, [.375, .625]);
  const aligned = bankFor([{ points: [[0, -.4], [0, .4]], closed: false }], { contourReader: 'scan', drumSpacing: .1 });
  assert.ok(aligned.layers[0].beads.every(bead => bead.phases[0] === .25 && bead.phases[1] === .75));
});

test('reader guide directions and scan bounds rotate continuously and remain shared in non-square views', () => {
  const source = geometry([{ points: square, closed: true }], { ...view, aspect: 2 });
  const scan = createTraceBank([source, source, source], { contourReader: 'scan', scanAngle: 90 });
  near(scan.scanMin, -.25); near(scan.scanMax, .25);
  const guide = readerGuide(scan, .25);
  assert.equal(guide.type, 'scan'); near(guide.coordinate, 0); near(guide.nx, 0); near(guide.ny, 1);
  near(guide.y1, 0); near(guide.y2, 0);
  const radar = createTraceBank([source, source, source], { contourReader: 'radar', radarX: .1, radarY: -.1 });
  const down = readerGuide(radar, 0), right = readerGuide(radar, .25);
  assert.deepEqual(down.center, { x: .1, y: -.1 }); near(down.dx, 0); near(down.dy, -1); near(right.dx, 1); near(right.dy, 0);
  assert.deepEqual(readerGuide(radar, 1.25), right);
});

test('Radar contacts remain on the ray and retain stable slots through the seam on nested outlines', () => {
  const paths = [.4, .28, .16].map(radius => ({ points: square.map(([x, y]) => [x * radius / .4, y * radius / .4]), closed: true }));
  const bank = bankFor(paths, { contourReader: 'radar' }), layer = bank.layers[0];
  assert.equal(layer.contacts.length, 3);
  for (let i = 0; i < TRACE_TABLE_SIZE; i += 7) {
    const phase = i / TRACE_TABLE_SIZE, guide = readerGuide(bank, phase), contacts = sampleReaderLayer(layer, phase);
    assert.equal(contacts.length, 3);
    for (const point of contacts) {
      near(point.presence, 1); near(point.x * guide.dy - point.y * guide.dx, 0);
      assert.ok(point.x * guide.dx + point.y * guide.dy > 0);
      near(Math.max(Math.abs(point.x), Math.abs(point.y)), [.16, .28, .4][point.slot]);
    }
  }
  for (const contact of layer.contacts) {
    near(contact.presence[0], 1); near(contact.presence.at(-1), 1);
    assert.ok(Math.hypot(contact.x[0] - contact.x.at(-1), contact.y[0] - contact.y.at(-1)) < .003);
  }
});

test('Scan contacts follow the line on both passes without swapping stable branches', () => {
  const paths = [-.3, 0, .3].map(y => ({ points: [[-.45, y], [.45, y]], closed: false }));
  const bank = bankFor(paths, { contourReader: 'scan' }), layer = bank.layers[0];
  for (const phase of [.15, .2, .3, .4, .6, .7, .8, .85]) {
    const guide = readerGuide(bank, phase), contacts = sampleReaderLayer(layer, phase);
    assert.equal(contacts.length, 3);
    for (const point of contacts) { near(point.x, guide.coordinate); near(point.y, [-.3, 0, .3][point.slot]); }
  }
  assert.equal(sampleReaderLayer(layer, 0).length, 0);
  assert.equal(sampleReaderLayer(layer, .5).length, 0);
});

test('subdividing exact polylines does not change projected voices or percussion timing', () => {
  const paths = [.4, .2].map(radius => ({ points: square.map(([x, y]) => [x * radius / .4, y * radius / .4]), closed: true }));
  const dense = paths.map(path => ({ ...path, points: subdivide(path.points, 23, true).reverse() }));
  for (const contourReader of ['radar', 'scan']) {
    const coarse = bankFor(paths, { contourReader }).layers[0], refined = bankFor(dense, { contourReader }).layers[0];
    for (let i = 0; i < TRACE_TABLE_SIZE; i += 47) {
      const a = sampleReaderLayer(coarse, i / TRACE_TABLE_SIZE), b = sampleReaderLayer(refined, i / TRACE_TABLE_SIZE);
      assert.equal(a.length, b.length);
      a.forEach((point, index) => {
        assert.equal(point.slot, b[index].slot);
        for (const key of ['x', 'y', 'bend', 'fold', 'presence']) near(point[key], b[index][key]);
      });
    }
    assert.equal(coarse.events.length, refined.events.length);
    coarse.events.forEach((event, index) => near(event.phase, refined.events[index].phase));
  }
});

test('projected contacts fade when branches appear and disappear rather than gating or teleporting', () => {
  const bank = bankFor([{ points: [[.1, -.2], [.4, -.2], [.4, .2], [.1, .2]], closed: true }], { contourReader: 'radar' });
  const layer = bank.layers[0];
  assert.equal(sampleReaderLayer(layer, .75).length, 0);
  assert.equal(sampleReaderLayer(layer, .25).length, 2);
  for (const contact of layer.contacts) {
    assert.ok(contact.presence.some(value => value > 0 && value < 1));
    for (let i = 0; i < TRACE_TABLE_SIZE; i++) {
      const previous = (i + TRACE_TABLE_SIZE - 1) % TRACE_TABLE_SIZE;
      assert.ok(Math.abs(contact.presence[i] - contact.presence[previous]) <= .125001, 'birth/death ramps remain continuous across the table seam');
      if (contact.presence[i] > .9 && contact.presence[previous] > .9) assert.ok(Math.hypot(contact.x[i] - contact.x[previous], contact.y[i] - contact.y[previous]) < .04);
    }
  }
});

test('fold measures broader indentation and can respond where fine-scale bend is zero', () => {
  const points = [[-.4, -.2], [0, -.2], [0, .2], [.4, .2]];
  const coarse = bankFor([{ points, closed: false }], { featureSize: .1 }).layers[0];
  const dense = bankFor([{ points: subdivide(points, 17, false), closed: false }], { featureSize: .1 }).layers[0];
  assert.ok(coarse.fold.some((fold, i) => fold > .05 && coarse.bend[i] < .001));
  for (let i = 0; i < TRACE_TABLE_SIZE; i++) {
    assert.ok(coarse.fold[i] >= 0 && coarse.fold[i] <= 1); near(coarse.fold[i], dense.fold[i]);
  }
  const straight = bankFor([{ points: [[-.4, -.2], [.4, .2]], closed: false }], { featureSize: .1 }).layers[0];
  assert.ok(straight.fold.every(value => value < 1e-6));
});

test('dense readers have bounded segments, contacts, beads and events without non-finite data', () => {
  const points = Array.from({ length: 6000 }, (_, i) => {
    const angle = i / 6000 * Math.PI * 2, radius = .3 + .04 * Math.sin(angle * 97);
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  const bank = bankFor([{ points, closed: true }], { contourReader: 'radar', drumSpacing: .006 });
  for (const layer of bank.layers) {
    assert.ok(layer.readerSegmentCount <= READER_SEGMENT_LIMIT);
    assert.ok(layer.contacts.length <= READER_CONTACT_LIMIT);
    assert.ok(layer.beads.length <= READER_BEAD_LIMIT);
    assert.ok(layer.events.length <= 2 * READER_BEAD_LIMIT);
    for (const contact of layer.contacts) for (const key of ['x', 'y', 'bend', 'fold', 'presence']) {
      assert.equal(contact[key].length, TRACE_TABLE_SIZE); assert.ok(contact[key].every(Number.isFinite));
    }
  }
});

test('empty projected views and invalid options stay finite, empty and bounded', () => {
  for (const contourReader of ['trace', 'radar', 'scan']) {
    const bank = createTraceBank([null, null, null], { contourReader, radarX: Infinity, radarY: -9, scanAngle: NaN, drumSpacing: 0 });
    assert.equal(bank.radarX, 0); assert.equal(bank.radarY, -.5);
    for (const layer of bank.layers) {
      assert.deepEqual(layer.contacts, []); assert.deepEqual(layer.beads, []); assert.deepEqual(layer.events, []);
      assert.deepEqual(sampleReaderLayer(layer, .5), []);
    }
    const guide = readerGuide(bank, .1);
    if (guide) for (const key of ['x1', 'y1', 'x2', 'y2']) assert.ok(Number.isFinite(guide[key]));
  }
});
