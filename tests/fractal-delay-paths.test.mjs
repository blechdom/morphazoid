import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWasmNetwork } from '../src/instruments/fractal-delay/wasm-runtime.js';
import { buildNetwork, sanitizeParameters } from '../src/instruments/fractal-delay/model.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/fractal-delay.wasm', import.meta.url)));
const RATE = 48000, BLOCK = 128, zero = new Float32Array(BLOCK);
const performance = { inputGain: 1, inputDriveDb: 0, delayGainDb: 0, wet: 1, dry: 0,
  outputLevel: 1, outputBoostDb: 0, hpfHz: 0, lpfHz: 22000, compressorRatio: 1, compressorMakeupDb: 0 };
const paths = { propagation: 'paths', geometryPitch: 0, tapCoverage: 0, turnTone: 0,
  timeMs: 10, coupling: 1, decay: 1, boundary: 0, pitchOffset: 0 };
const resonance = { ...paths, propagation: 'resonance' };

function scene(points, links, pickupNode = points.length - 1) {
  const nodes = points.map(([x, y], id) => ({ id, x, y }));
  return { nodes, edges: links.map(([a, b], id) => ({ id, a, b,
    length: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) })), inputNode: 0, pickupNode };
}
function render(engine, blocks, source = () => zero) {
  const left = new Float32Array(blocks * BLOCK), right = new Float32Array(left.length);
  for (let block = 0; block < blocks; block++) {
    const output = engine.process(source(block)); left.set(output.left, block * BLOCK); right.set(output.right, block * BLOCK);
  }
  return { left, right };
}
function install(graph, parameters = {}, rawLegacy = false) {
  const engine = createWasmNetwork(module, RATE), values = { ...paths, ...parameters };
  if (rawLegacy) {
    // Old native payloads have no propagation/mapping fields. Exercise actual
    // Rust deserialization rather than the newer JS bridge's default state.
    const { propagation, geometryPitch, tapCoverage, turnTone, ...legacy } = values;
    const bytes = new TextEncoder().encode(JSON.stringify({ parameters: legacy, performance, inputMode: 'media' }));
    const pointer = engine.api.fd_alloc(bytes.length);
    try {
      new Uint8Array(engine.api.memory.buffer, pointer, bytes.length).set(bytes);
      assert.equal(engine.api.fd_controls(engine.engine, pointer, bytes.length), 1);
    } finally { engine.api.fd_free(pointer, bytes.length); }
  } else engine.controls(values, performance, 'media');
  render(engine, 480); engine.prepareScene(graph); render(engine, 480);
  return engine;
}
const impulse = block => { const input = zero.slice(); if (!block) input[0] = .01; return input; };
const first = pcm => pcm.findIndex(value => Math.abs(value) > 1e-7);
const energy = pcm => pcm.reduce((sum, value) => sum + value * value, 0);
const unlimit = value => .94 * Math.atanh(value / .94);
function isolatedArrival(pcm, onset, pressure) {
  // The shared mastering low-pass remains active at its widest setting. A
  // single arriving wave therefore has an analytic one-pole decay, rather
  // than becoming exactly one output sample. Include its 0.45-rate clamp.
  const pole = Math.exp(-2 * Math.PI * Math.min(performance.lpfHz, RATE * .45) / RATE);
  for (let i = 0; i < pcm.length; i++) {
    const filtered = i < onset ? 0 : pressure * (1 - pole) * pole ** (i - onset);
    assert(Math.abs(pcm[i] - .94 * Math.tanh(filtered / .94)) < 1e-8,
      `isolated wave and mastering response at sample ${i}`);
  }
}
function finite(output) {
  for (const pcm of [output.left, output.right]) assert(pcm.every(value => Number.isFinite(value) && Math.abs(value) <= .940001));
}
function tone(engine, frequencies = [173], blocks = 1200) {
  return render(engine, blocks, block => Float32Array.from({ length: BLOCK }, (_, i) =>
    .001 * frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * (block * BLOCK + i) / RATE), 0)));
}
function spectrum(pcm, frequencies) {
  const windowed = Float64Array.from(pcm, (value, i) => value * (.5 - .5 * Math.cos(2 * Math.PI * i / (pcm.length - 1))));
  return frequencies.map(frequency => {
    const ca = Math.cos(2 * Math.PI * frequency / RATE), sa = Math.sin(2 * Math.PI * frequency / RATE);
    let c = 1, s = 0, real = 0, imaginary = 0;
    for (const value of windowed) { real += value * c; imaginary += value * s;
      const next = c * ca - s * sa; s = s * ca + c * sa; c = next; }
    return real * real + imaginary * imaginary;
  });
}
function dominant(pcm, low = 40, high = 450) {
  const frequencies = Array.from({ length: high - low + 1 }, (_, i) => low + i), powers = spectrum(pcm, frequencies);
  return frequencies[powers.indexOf(Math.max(...powers))];
}
const capturedTone = output => output.left.subarray(output.left.length - 192 * BLOCK);
const branch = scene([[0, 0], [0, .1], [0, .3], [.3, .1]], [[0, 1], [1, 2], [1, 3]], 0);

test('old native payloads and explicit Resonance retain the original geometric transit and pressure', () => {
  const graph = scene([[0, 0], [0, .1], [0, .3]], [[0, 1], [1, 2]]);
  const explicit = install(graph, { ...resonance, decay: .9 }), omitted = install(graph, { decay: .9 }, true);
  const retainedMappings = install(graph, { ...resonance, decay: .9, geometryPitch: 24, tapCoverage: 1, turnTone: 1 });
  try {
    const a = render(explicit, 12, impulse), b = render(omitted, 12, impulse); finite(a); finite(b);
    assert.deepEqual(a, b, 'new JS defaults must not change omitted-field legacy Rust controls');
    assert.deepEqual(a, render(retainedMappings, 12, impulse), 'Resonance keeps the original law even when path mapping knobs retain their values');
    assert.equal(first(a.left), 144, 'the original two sequential delays are 48 + 96 samples');
    isolatedArrival(a.left, 144, .01 * .9 ** .3);
  } finally { explicit.dispose(); omitted.dispose(); retainedMappings.dispose(); }
});

test('Paths keep exact cumulative geometric travel when angle pitch and turn tone are disabled', () => {
  const graph = scene([[0, 0], [0, .1], [0, .3]], [[0, 1], [1, 2]]);
  const engines = [install(graph), install(graph, { timeMs: 20 })];
  try {
    const a = render(engines[0], 12, impulse), b = render(engines[1], 12, impulse); finite(a); finite(b);
    assert.equal(first(a.left), 144); assert.equal(first(b.left), 288);
    assert(a.left.subarray(0, 144).every(value => value === 0));
    assert(b.left.subarray(0, 288).every(value => value === 0));
    isolatedArrival(a.left, 144, .01); isolatedArrival(b.left, 288, .01);
  } finally { engines.forEach(engine => engine.dispose()); }
});

test('a closed drawn path repeats at its full circuit time with geometric feedback loss', () => {
  const graph = scene([[0, 0], [.2, 0], [.1, Math.sqrt(3) * .1]], [[0, 1], [1, 2], [2, 0]], 0);
  const engine = install(graph, { decay: .8 });
  try {
    const output = render(engine, 32, impulse); finite(output);
    const circuitFrames = Math.round(graph.edges.reduce((sum, edge) => sum + edge.length, 0) * RATE * paths.timeMs / 1000);
    assert.equal(circuitFrames, 288); assert.equal(first(output.left), circuitFrames);
    const loss = .8 ** graph.edges.reduce((sum, edge) => sum + edge.length, 0);
    for (let lap = 2; lap <= 10; lap++) {
      const previous = unlimit(output.left[(lap - 1) * circuitFrames]), current = unlimit(output.left[lap * circuitFrames]);
      assert(previous > 0 && current > 0, `real circulating arrival at lap ${lap}`);
      assert(Math.abs(current / previous - loss) < 1e-6, 'each circuit applies the drawn total length once to sustain');
    }
    assert.equal(engine.status().activeEdges, graph.edges.length);
    assert(engine.status().edgeLevels.every(value => value > 0), 'every drawn connection carries the continuing impulse');
  } finally { engine.dispose(); }
});

test('nonbacktracking path transfer differs from legacy branch scattering without fake direct input', () => {
  const forward = install(branch), acoustic = install(branch, resonance);
  try {
    const a = render(forward, 24, impulse), b = render(acoustic, 24, impulse); finite(a); finite(b);
    assert(Math.max(...a.left.map(Math.abs)) < .01 * 1e-12,
      'no path returns to the selected root above the 1e-12 control-follower resolution');
    assert.equal(first(b.left), 96, 'legacy degree-three scattering reflects a real signed wave back through the first edge');
    assert(b.left[96] < 0);
    assert.equal(forward.status().activeEdges, 3); assert.equal(acoustic.status().activeEdges, 3);
  } finally { forward.dispose(); acoustic.dispose(); }
});

test('whole-network coverage hears every branch arrival and blends with the selected pickup outside feedback', () => {
  const selected = { ...branch, pickupNode: 2 }, engines = [0, .5, 1].map(tapCoverage => install(selected, { tapCoverage }));
  const whole = install(branch, { tapCoverage: 1 });
  try {
    const pcm = engines.map(engine => render(engine, 24, impulse)), all = render(whole, 24, impulse);
    pcm.forEach(finite); finite(all);
    assert.equal(first(pcm[0].left), 144); assert.equal(first(all.left), 48);
    for (const arrival of [48, 144, 192]) assert(Math.abs(all.left[arrival]) > 1e-7, `whole taps hear the real branch arrival at ${arrival} samples`);
    assert(all.left.subarray(0, 48).every(value => value === 0));
    for (let i = 0; i < pcm[0].left.length; i++)
      assert(Math.abs(unlimit(pcm[1].left[i]) - (unlimit(pcm[0].left[i]) + unlimit(pcm[2].left[i])) * .5) < 1e-7,
        'coverage follows the declared convex receiver blend before the output limiter');
    engines.forEach(engine => tone(engine, [173], 120)); tone(whole, [173], 120);
    assert(engines[0].status().edgeWaveforms.some(value => Math.abs(value) > 1e-7), 'the history comparison contains live travelling pressure');
    assert.deepEqual(engines[0].status().edgeWaveforms, engines[2].status().edgeWaveforms,
      'listening coverage does not alter the circulating wave histories');
    assert(whole.status().edgeLevels.every(value => value > 1e-7), 'all three admitted paths carry actual source pressure');
  } finally { [...engines, whole].forEach(engine => engine.dispose()); }
});

test('equal-length mirrored directions produce persistent reciprocal angle pitch, with a causal bounded grain delay', t => {
  const up = scene([[0, 0], [0, .5]], [[0, 1]]), down = scene([[0, 0], [0, -.5]], [[0, 1]]);
  const flat = [up, down].map(graph => install(graph, { timeMs: 500 }));
  const pitched = [up, down].map(graph => install(graph, { timeMs: 500, geometryPitch: 8 }));
  try {
    const unchanged = flat.map(engine => tone(engine)); assert.deepEqual(unchanged[0], unchanged[1], 'direction alone has no timbral mapping at zero span');
    const shifted = pitched.map(engine => tone(engine)); shifted.forEach(finite);
    const measured = shifted.map(output => dominant(capturedTone(output)));
    for (let i = 0; i < measured.length; i++) {
      const ratio = 2 ** ((i ? -8 : 8) / 12), expected = 173 * ratio;
      // The two-window resampler has hop sidebands. Its adaptive 50 ms
      // grain bounds that spectral spread; include two finite DFT bins.
      const grainSpread = Math.abs(ratio - 1) / .05, bins = 2 * RATE / (192 * BLOCK);
      assert(Math.abs(measured[i] - expected) <= grainSpread + bins,
        `mapped carrier ${expected} Hz must remain within its grain/hop bandwidth, measured ${measured[i]}`);
    }
    assert(measured[0] > 173); assert(measured[1] < 173);
    t.diagnostic(`settled directional carriers: up ${measured[0]} Hz, down ${measured[1]} Hz; zero span 173 Hz`);
  } finally { [...flat, ...pitched].forEach(engine => engine.dispose()); }
  const causal = install(up, { timeMs: 500, geometryPitch: 8 });
  try {
    // A short broadband burst survives granular crossfades more reliably than
    // one isolated sample, while the first output still cannot precede travel.
    const burst = render(causal, 180, block => block < 8 ? Float32Array.from({ length: BLOCK }, (_, i) =>
      .01 * Math.sin((block * BLOCK + i + 1) * 1.371)) : zero); finite(burst);
    const onset = first(burst.left), base = .5 * .5 * RATE;
    assert(onset >= base, 'pitched waves cannot appear before their geometric transit');
    assert(onset <= Math.ceil(base * 1.25) + BLOCK, 'adaptive pitch lookback stays inside reserved 25% travel headroom');
  } finally { causal.dispose(); }
});

test('turn tone changes sustained corner timbre independently of equal-length travel and direction pitch', t => {
  const straight = scene([[-.4, 0], [0, 0], [.4, 0]], [[0, 1], [1, 2]]);
  const corner = scene([[0, 0], [.4, 0], [.4, .4]], [[0, 1], [1, 2]]);
  const bypass = [straight, corner].map(graph => install(graph, { timeMs: 20 }));
  const colored = [straight, corner].map(graph => install(graph, { timeMs: 20, turnTone: 1 }));
  try {
    const uncolored = bypass.map(engine => tone(engine, [173, 8000]));
    assert.deepEqual(uncolored[0], uncolored[1], 'equal transit and pickup pan produce identical PCM at zero turn tone');
    const output = colored.map(engine => tone(engine, [173, 8000])); output.forEach(finite);
    const ratios = output.map(pcm => { const [low, high] = spectrum(capturedTone(pcm), [173, 8000]); return high / low; });
    assert(ratios[1] < ratios[0], 'a right-angle continuation attenuates high frequencies relative to low frequencies');
    t.diagnostic(`turn high/low power: straight ${ratios[0]}, right angle ${ratios[1]}`);
  } finally { [...bypass, ...colored].forEach(engine => engine.dispose()); }
});

test('global pitch transposes mapped path output without changing its geometric pressure or timing', t => {
  const graph = scene([[0, 0], [0, .5]], [[0, 1]]);
  const engines = [0, 12].map(pitchOffset => install(graph, { timeMs: 500, geometryPitch: 8, pitchOffset }));
  try {
    const output = engines.map(engine => tone(engine)); output.forEach(finite);
    const frequency = output.map(pcm => dominant(capturedTone(pcm), 100, 700));
    assert(frequency[1] > frequency[0], 'the global octave control remains audible after directional pitch');
    const angleSpread = Math.abs(2 ** (8 / 12) - 1) / .05, globalSpread = 1 / .11;
    assert(Math.abs(frequency[1] - frequency[0] * 2) <= angleSpread * 2 + globalSpread + 2 * RATE / (192 * BLOCK));
    const a = engines[0].status(), b = engines[1].status();
    assert.deepEqual(a.edgeWaveforms, b.edgeWaveforms, 'global pitch stays downstream of all mapped travelling pressure');
    assert.equal(a.timeTargetMs, b.timeTargetMs); assert.equal(a.sampleClock, b.sampleClock);
    assert.equal(a.activeEdges, b.activeEdges); assert.equal(a.requiredDelayBytes, b.requiredDelayBytes);
    t.diagnostic(`global octave on mapped paths: ${frequency[0]} Hz → ${frequency[1]} Hz`);
  } finally { engines.forEach(engine => engine.dispose()); }
});

test('live path mappings keep histories, admitted edges and sample clock while output remains finite', () => {
  const graph = { ...branch, pickupNode: 2 }, engine = install(graph, { boundary: 1, decay: .9 });
  try {
    tone(engine, [173, 311], 480);
    const before = engine.status(), memory = engine.api.memory.buffer.byteLength;
    for (const next of [
      { geometryPitch: 12, tapCoverage: 1, turnTone: .6 },
      { propagation: 'resonance', geometryPitch: 0, tapCoverage: 0, turnTone: 0 },
      { propagation: 'paths', geometryPitch: 24, tapCoverage: .5, turnTone: 1 },
    ]) {
      const clock = engine.status().sampleClock; engine.controls(next);
      assert.equal(engine.status().sampleClock, clock); assert.equal(engine.status().revision, before.revision);
      const tail = render(engine, 80); finite(tail);
      assert(energy(tail.left) > 0, 'mapping edits do not clear pressure already travelling through the network');
      assert.equal(engine.status().sampleClock, clock + 80 * BLOCK);
      assert.equal(engine.status().activeEdges, before.activeEdges); assert.equal(engine.status().requiredDelayBytes, before.requiredDelayBytes);
      assert.equal(engine.api.memory.buffer.byteLength, memory); assert.equal(engine.status().releasingEdges, 0);
    }
    for (const invalid of [{ propagation: 'unknown' }, { geometryPitch: 24.1 }, { geometryPitch: NaN },
      { tapCoverage: 1.1 }, { tapCoverage: Infinity }, { turnTone: -.1 }]) assert.throws(() => engine.controls(invalid));
    const hot = render(engine, 160, () => new Float32Array(BLOCK).fill(1)); finite(hot);
    assert.equal(engine.status().revision, before.revision); assert.equal(engine.status().activeEdges, before.activeEdges);
  } finally { engine.dispose(); }
});

test('Rabbit orbit geometry stays admitted while whole taps hear both conjugate systems', t => {
  const base = { mode: 'orbits', cReal: -.12256116687665362, cImag: .7448617666197442, detail: 8,
    timeMs: 280, coupling: 1, decay: .92, pitchOffset: 0, propagation: 'paths',
    geometryPitch: 8, turnTone: .3, tapCoverage: 1, pickup: .6, boundary: 0 };
  const graphs = [1, -1].map(sign => buildNetwork(sanitizeParameters({ ...base, cImag: base.cImag * sign }), 256));
  const engines = graphs.map(graph => install(graph, graph.parameters));
  try {
    const output = engines.map(engine => tone(engine)); output.forEach(finite);
    graphs.forEach((graph, i) => {
      assert.equal(engines[i].status().activeEdges, graph.edges.length); assert.equal(engines[i].status().revision, 1);
      assert(engines[i].status().edgeLevels.every(value => value > 0)); assert(energy(output[i].left) > 0);
    });
    assert.notDeepEqual(capturedTone(output[0]), capturedTone(output[1]), 'settled conjugate geometry remains audibly mapped after retiming has ended');
    t.diagnostic(`admitted Rabbit connections: ${graphs.map(graph => graph.edges.length).join(' / ')}`);
  } finally { engines.forEach(engine => engine.dispose()); }
});

test('no-decay traverses 64 serial edges at full arrival strength; decay changes loss but never timing', () => {
  const points=Array.from({length:65},(_,i)=>[0,i*.1]);
  const graph=scene(points,Array.from({length:64},(_,i)=>[i,i+1]));
  for(const decay of [1,.8]) {
    const engine=install(graph,{decay});
    try {
      const output=render(engine,40,impulse);finite(output);
      assert.equal(first(output.left),3072);
      isolatedArrival(output.left,3072,.01*decay**6.4);
    } finally {engine.dispose();}
  }
});

test('no-decay closed path preserves circulating amplitude through successive complete laps', () => {
  const graph=scene([[0,0],[.2,0],[.1,Math.sqrt(3)*.1]],[[0,1],[1,2],[2,0]],0);
  const engine=install(graph,{decay:1});
  try {
    const output=render(engine,100,impulse);finite(output);
    assert.equal(first(output.left),288);
    for(let lap=2;lap<=40;lap++)
      assert(Math.abs(unlimit(output.left[lap*288])/unlimit(output.left[288])-1)<1e-6,`lap ${lap} retains arrival strength`);
  } finally {engine.dispose();}
});
