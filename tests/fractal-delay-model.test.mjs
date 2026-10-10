import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildNetwork, MODES, DEFAULT_PARAMETERS, PARAMETER_LIMITS, sanitizeParameters, randomizeParameters,
  escapePotential, complexSquareRoot, COMPLEX_COORDINATE_SCALE } from '../src/instruments/fractal-delay/model.js';
import { PRESETS } from '../src/instruments/fractal-delay/presets.js';

function validateGraph(network, budget) {
  assert.ok(network.edges.length > 0 && network.edges.length <= budget);
  assert.ok(network.nodes.length >= 2);
  assert.equal(new Set(network.nodes.map(node => node.id)).size, network.nodes.length);
  assert.equal(new Set(network.edges.map(edge => edge.id)).size, network.edges.length);
  assert.ok(network.nodes.every(node => Number.isInteger(node.id) && node.id >= 0 && Number.isFinite(node.x) && Number.isFinite(node.y)));
  const neighbors = network.nodes.map(() => []);
  for (const edge of network.edges) {
    assert.ok(Number.isInteger(edge.id) && edge.id >= 0);
    assert.ok(Number.isInteger(edge.a) && edge.a >= 0 && edge.a < network.nodes.length);
    assert.ok(Number.isInteger(edge.b) && edge.b >= 0 && edge.b < network.nodes.length);
    assert.notEqual(edge.a, edge.b);
    assert.ok(Number.isFinite(edge.length) && edge.length > 0 && edge.length < 3);
    const a = network.nodes[edge.a], b = network.nodes[edge.b];
    assert.ok(Math.abs(edge.length - Math.max(.0001, Math.hypot(b.x - a.x, b.y - a.y))) < 1e-12);
    neighbors[edge.a].push(edge.b); neighbors[edge.b].push(edge.a);
  }
  const seen = new Set([network.inputNode]), pending = [network.inputNode];
  while (pending.length) for (const neighbor of neighbors[pending.pop()]) if (!seen.has(neighbor)) { seen.add(neighbor); pending.push(neighbor); }
  assert.equal(seen.size, network.nodes.length, 'every visible route belongs to the same playable graph');
  assert.ok(Number.isInteger(network.pickupNode) && network.pickupNode >= 0 && network.pickupNode < network.nodes.length);
  assert.equal(network.metadata.completeGraph, true);
  assert.ok(network.requestedEdges >= network.edges.length || network.metadata.unsupportedInteriorFallback);
  assert.ok(network.nodes.every(node => node.x >= network.bounds.minX && node.x <= network.bounds.maxX && node.y >= network.bounds.minY && node.y <= network.bounds.maxY));
}

test('parameters reject nonfinite input, ignore unrelated gains and remain complete', () => {
  assert.deepEqual(sanitizeParameters(null), DEFAULT_PARAMETERS);
  const parameters = sanitizeParameters({ mode: 'fake', domain: 'fake', cReal: Infinity, cImag: '-20', timeMs: .000001, detail: 14.8, inputGain: 0, decay: 1 });
  assert.equal(parameters.cReal, DEFAULT_PARAMETERS.cReal);
  assert.equal(parameters.cImag, -1.5);
  assert.equal(parameters.timeMs, .05);
  assert.equal(parameters.detail, 12);
  assert.equal(parameters.decay, .98);
  assert.ok(!Object.hasOwn(parameters, 'inputGain'));
  assert.deepEqual(Object.keys(parameters).sort(), Object.keys(DEFAULT_PARAMETERS).sort());
});

test('complex roots square back to their source on both axes and all quadrants', () => {
  for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1], [-2, -.7], [-2, .7], [2, -.7], [2, .7]]) {
    const root = complexSquareRoot(x, y);
    assert.ok(Math.abs(root.x ** 2 - root.y ** 2 - x) < 1e-12);
    assert.ok(Math.abs(2 * root.x * root.y - y) < 1e-12);
  }
});

test('inverse routes are both exact quadratic predecessors with complete depth admission', () => {
  for (const budget of [2, 3, 6, 7, 20, 126, 127, 512, 8190]) {
    const network = buildNetwork({ ...DEFAULT_PARAMETERS, detail: 12 }, budget);
    validateGraph(network, budget);
    assert.equal(network.edges.length, 2 ** (network.metadata.inverseDepth + 1) - 2);
    assert.equal(network.requestedEdges, 8190);
    for (const edge of network.edges) {
      const child = network.nodes[edge.b], parent = network.nodes[edge.a], s = COMPLEX_COORDINATE_SCALE;
      assert.ok(Math.abs((child.x * s) ** 2 - (child.y * s) ** 2 + DEFAULT_PARAMETERS.cReal - parent.x * s) < 2e-12);
      assert.ok(Math.abs(2 * child.x * child.y * s * s + DEFAULT_PARAMETERS.cImag - parent.y * s) < 2e-12);
    }
  }
});

test('inverse node identities and existing lengths remain stable across detail and parameter edits', () => {
  const first = buildNetwork({ ...DEFAULT_PARAMETERS, detail: 4 }, 8190);
  const expanded = buildNetwork({ ...DEFAULT_PARAMETERS, detail: 7 }, 8190);
  assert.deepEqual(expanded.nodes.slice(0, first.nodes.length), first.nodes);
  assert.deepEqual(expanded.edges.slice(0, first.edges.length), first.edges);
  const edited = buildNetwork({ ...DEFAULT_PARAMETERS, detail: 4, cReal: -.81 }, 8190);
  assert.deepEqual(edited.nodes.map(node => node.id), first.nodes.map(node => node.id));
  assert.deepEqual(edited.edges.map(edge => edge.id), first.edges.map(edge => edge.id));
  assert.ok(edited.edges.some((edge, index) => Math.abs(edge.length - first.edges[index].length) > .00001));
});

for (const mode of MODES) {
  test(`${mode.label} returns deterministic complete graphs in both planes, with whole budget admission`, () => {
    for (const domain of ['julia', 'mandelbrot']) for (const budget of [1, 24, 128, 1024]) {
      const parameters = { ...DEFAULT_PARAMETERS, mode: mode.id, domain, detail: 10 };
      const network = buildNetwork(parameters, budget);
      validateGraph(network, budget);
      assert.deepEqual(buildNetwork(parameters, budget), network);
    }
  });
  test(`${mode.label} leaves geometry unchanged for all allocation-free audio scalars`, () => {
    const parameters = { ...DEFAULT_PARAMETERS, mode: mode.id };
    const first = buildNetwork(parameters, 1024);
    const second = buildNetwork({ ...parameters, timeMs: .05, coupling: 0, decay: .98, pitchOffset: 13.72 }, 1024);
    assert.deepEqual(second.nodes, first.nodes);
    assert.deepEqual(second.edges, first.edges);
    assert.equal(second.pickupNode, first.pickupNode);
    assert.equal(second.inputNode, first.inputNode);
  });
}

test('escape potential obeys the quadratic functional equation outside the unit Julia circle', () => {
  const p = { ...DEFAULT_PARAMETERS, cReal: 0, cImag: 0 };
  for (const radius of [1.05, 1.2, 2, 4]) {
    const first = escapePotential(radius, 0, p), second = escapePotential(radius * radius, 0, p);
    assert.ok(Math.abs(first.value - Math.log2(Math.log(radius))) < 1e-12);
    assert.ok(Math.abs(second.value - first.value - 1) < 1e-12);
    assert.equal(first.dx, 1); assert.equal(first.dy, 0);
  }
  assert.equal(escapePotential(.5, .2, p).escaped, false);
});

test('circle equipotentials have their mathematical radii and explicit cross-contour acoustic bridges', () => {
  const network = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'contours', cReal: 0, cImag: 0, detail: 8 }, 4096);
  validateGraph(network, 4096);
  assert.ok(network.metadata.closedLoops >= 3);
  for (const node of network.nodes) {
    const expectedRadius = Math.exp(2 ** network.metadata.contourLevels[node.contour]);
    assert.ok(Math.abs(Math.hypot(node.x, node.y) * COMPLEX_COORDINATE_SCALE - expectedRadius) < .025);
  }
  assert.equal(network.edges.filter(edge => edge.couplingLink).length, network.metadata.closedLoops - 1);
  assert.equal(network.metadata.numericalApproximation, true);
});

test('potential-gradient rays are radial for z² and descend toward the circle', () => {
  const p = { ...DEFAULT_PARAMETERS, mode: 'rays', cReal: 0, cImag: 0, detail: 6 };
  const network = buildNetwork(p, 4096);
  validateGraph(network, 4096);
  const rays = new Map();
  for (const node of network.nodes) if (Number.isInteger(node.ray)) {
    if (!rays.has(node.ray)) rays.set(node.ray, []); rays.get(node.ray).push(node);
  }
  assert.equal(rays.size, 10);
  for (const points of rays.values()) for (let index = 1; index < points.length; index++) {
    assert.ok(Math.hypot(points[index].x, points[index].y) < Math.hypot(points[index - 1].x, points[index - 1].y));
    assert.ok(Math.abs(points[0].x * points[index].y - points[0].y * points[index].x) < 1e-12);
  }
  assert.equal(network.metadata.externalAngleClaim, false);
});

test('period-two and period-three critical orbits become actual return routes', () => {
  const two = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'orbits', cReal: -1, cImag: 0 }, 1024);
  assert.equal(two.nodes.length, 2); assert.equal(two.edges.length, 2); assert.equal(two.metadata.period, 2);
  assert.equal(two.nodes[0].x, 0); assert.equal(two.nodes[1].x * COMPLEX_COORDINATE_SCALE, -1);
  assert.ok(two.edges.some(edge => edge.returnRoute));
  const three = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'orbits', cReal: -.122561, cImag: .744862, detail: 8 }, 1024);
  assert.equal(three.metadata.period, 3);
  assert.ok(three.edges.some(edge => edge.returnRoute));
  validateGraph(three, 1024);
});

test('escaping orbits remain exact finite open routes; fixed critical points disclose perturbation', () => {
  const escaping = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'orbits', cReal: 1, cImag: 1.5 }, 1024);
  assert.equal(escaping.metadata.escaped, true); assert.equal(escaping.metadata.period, 0);
  assert.ok(!escaping.edges.some(edge => edge.returnRoute));
  validateGraph(escaping, 1024);
  const fixed = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'orbits', cReal: 0, cImag: 0 }, 1024);
  assert.equal(fixed.metadata.perturbedFixedPoint, true);
  for (let index = 1; index < fixed.nodes.length; index++) {
    const a = fixed.nodes[index - 1], b = fixed.nodes[index], s = COMPLEX_COORDINATE_SCALE;
    assert.ok(Math.abs(b.x * s - (a.x * s) ** 2 + (a.y * s) ** 2) < 1e-12);
    assert.ok(Math.abs(b.y * s - 2 * a.x * a.y * s * s) < 1e-12);
  }
});

test('filled z² chamber has grid-neighbor waveguides and no fabricated outside cells', () => {
  const network = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'membrane', cReal: 0, cImag: 0, detail: 12 }, 4096);
  validateGraph(network, 4096);
  assert.equal(network.metadata.thickenedBoundary, false);
  assert.ok(network.edges.length > network.nodes.length, 'a mesh has acoustic cycles beyond a tree');
  for (const node of network.nodes) assert.ok(Math.hypot(node.x, node.y) * COMPLEX_COORDINATE_SCALE <= 1 + 1e-12);
  for (const edge of network.edges) {
    const a = network.nodes[edge.a], b = network.nodes[edge.b];
    assert.equal(Math.abs(a.column - b.column) + Math.abs(a.row - b.row), 1);
  }
});

test('dust chambers disclose a finite thickened neighborhood instead of claiming filled interior', () => {
  const network = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'membrane', cReal: .38, cImag: .61, detail: 9 }, 1024);
  validateGraph(network, 1024);
  assert.equal(network.metadata.thickenedBoundary, true);
});

test('Mandelbrot contour geometry is fixed while c selects the excitation point', () => {
  const first = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'contours', domain: 'mandelbrot', cReal: -2, cImag: -1.5 }, 1024);
  const second = buildNetwork({ ...DEFAULT_PARAMETERS, mode: 'contours', domain: 'mandelbrot', cReal: 1, cImag: 1.5 }, 1024);
  assert.deepEqual(first.nodes, second.nodes); assert.deepEqual(first.edges, second.edges);
  assert.notEqual(first.inputNode, second.inputNode);
});

test('pickup changes the actual indexed receiver without altering the graph', () => {
  const first = buildNetwork({ ...DEFAULT_PARAMETERS, pickup: 0 }, 512);
  const last = buildNetwork({ ...DEFAULT_PARAMETERS, pickup: 1 }, 512);
  assert.deepEqual(first.nodes, last.nodes); assert.deepEqual(first.edges, last.edges);
  assert.equal(first.pickupNode, 0); assert.equal(last.pickupNode, last.nodes.length - 1);
});

test('whole-graph memory admission reports requested versus actual geometric length', () => {
  const network = buildNetwork({ ...DEFAULT_PARAMETERS, detail: 10 }, 8190, { maxTotalLength: 20 });
  validateGraph(network, 8190);
  assert.ok(network.metadata.totalLength <= 20);
  assert.ok(network.metadata.requestedTotalLength > 20);
  assert.equal(network.metadata.memoryAdjusted, true);
  assert.equal(network.metadata.admissionUnsupported, false);
  const impossible = buildNetwork(DEFAULT_PARAMETERS, 1, { maxTotalLength: .0001 });
  assert.equal(impossible.metadata.admissionUnsupported, true, 'never claims an impossible fixed-length route fits memory');
});

test('all 20 complete presets are bounded, deterministic and distinguish each mode four ways', () => {
  assert.equal(PRESETS.length, 20); assert.equal(new Set(PRESETS.map(preset => preset.id)).size, 20);
  for (const mode of MODES) assert.equal(PRESETS.filter(preset => preset.parameters.mode === mode.id).length, 4);
  const signatures = new Set();
  for (const preset of PRESETS) {
    assert.deepEqual(sanitizeParameters(preset.parameters), preset.parameters);
    assert.deepEqual(Object.keys(preset.parameters).sort(), Object.keys(DEFAULT_PARAMETERS).sort());
    signatures.add(JSON.stringify(preset.parameters));
    validateGraph(buildNetwork(preset.parameters, 1024), 1024);
  }
  assert.equal(signatures.size, 20);
});

test('randomization varies every complete musical parameter without adding gain or transport', () => {
  let seed = 193;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const states = Array.from({ length: 100 }, () => randomizeParameters(DEFAULT_PARAMETERS, random));
  for (const key of Object.keys(DEFAULT_PARAMETERS)) assert.ok(new Set(states.map(state => state[key])).size > 1, `${key} varies`);
  for (const state of states) {
    assert.deepEqual(sanitizeParameters(state), state);
    for (const [key, [min, max]] of Object.entries(PARAMETER_LIMITS)) assert.ok(state[key] >= min && state[key] <= max);
    assert.ok(!Object.hasOwn(state, 'level')); assert.ok(!Object.hasOwn(state, 'playing'));
  }
});

test('extreme complex parameters produce finite connected routes in every mode', () => {
  for (const mode of MODES) for (const [cReal, cImag] of [[-2, -1.5], [-2, 1.5], [1, -1.5], [1, 1.5]]) {
    validateGraph(buildNetwork({ ...DEFAULT_PARAMETERS, mode: mode.id, cReal, cImag, detail: 8 }, 512), 512);
  }
});

test('geometry worker coalesces queued builds, rejects stale revisions and emits only complete real graphs', () => {
  const source = readFileSync(new URL('../src/instruments/fractal-delay/geometry-worker.js', import.meta.url), 'utf8')
    .replace("import { buildNetwork } from './model.js';", '');
  const scheduled = [], output = []; let receive;
  vm.runInNewContext(source, { buildNetwork, performance,
    setTimeout: callback => scheduled.push(callback),
    self: { addEventListener: (_event, callback) => { receive = callback; }, postMessage: result => output.push(result) } });
  receive({ data: { type: 'build', revision: 1, parameters: { mode: 'inverse', detail: 12 }, budget: 2 } });
  receive({ data: { type: 'build', revision: 3, parameters: { mode: 'orbits', cReal: -1, cImag: 0 }, budget: 128 } });
  receive({ data: { type: 'build', revision: 2, parameters: { mode: 'membrane' }, budget: 512 } });
  assert.equal(scheduled.length, 1); assert.equal(output.length, 0);
  scheduled[0]();
  assert.equal(output.length, 1); assert.equal(output[0].revision, 3); assert.equal(output[0].type, 'network');
  assert.equal(output[0].network.mode, 'orbits'); assert.equal(output[0].network.metadata.period, 2);
  validateGraph(output[0].network, 128);
  receive({ data: { type: 'build', revision: 3, parameters: DEFAULT_PARAMETERS, budget: 512 } });
  assert.equal(scheduled.length, 1, 'duplicate acknowledgments do not recompute an installed scene');
});
