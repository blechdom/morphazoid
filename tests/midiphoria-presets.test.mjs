import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiphoriaModel, DEFAULT_VISUALS } from '../src/instruments/midiphoria/midiphoria-model.js';
import { MIDIPHORIA_PRESETS, MIDIPHORIA_VIEWS, MIDIPHORIA_PALETTES, MIDIPHORIA_COLOR_SOURCES,
  MIDIPHORIA_REFLECTIONS, MIDIPHORIA_FLOWS,
  DEFAULT_RENDER_OPTIONS, MIDIPHORIA_MODEL_KEYS, MIDIPHORIA_RENDER_KEYS,
  captureMidiphoriaPreset, applyMidiphoriaPreset, randomizeMidiphoriaPreset,
  sanitizeMidiphoriaPreset, isValidMidiphoriaPreset,
} from '../src/instruments/midiphoria/midiphoria-presets.js';
import { MidiphoriaRenderer, midiphoriaBlendRgb, midiColorHue,
  midiphoriaReflectionTransforms, midiphoriaTravelFraction,
} from '../src/instruments/midiphoria/midiphoria-renderer.js';

function canvas(width = 1440, height = 900) {
  const commands = [], strokes = [], layers = [];
  const context = {};
  for (const name of ['setTransform', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke',
    'arc', 'fill', 'fillText', 'bezierCurveTo', 'clearRect', 'save', 'restore', 'transform',
    'translate', 'drawImage', 'rect', 'clip']) context[name] = (...args) => commands.push([name, ...args]);
  context.stroke = () => {
    commands.push(['stroke']);
    strokes.push({ alpha: context.globalAlpha, color: context.strokeStyle, width: context.lineWidth });
  };
  context.createRadialGradient = (...args) => {
    commands.push(['gradient', ...args]);
    return { addColorStop() {} };
  };
  return { width: 0, height: 0, commands, strokes, layers, context, getContext: () => context,
    ownerDocument: { createElement() { const layer = canvas(width, height); layers.push(layer); return layer; } },
    getBoundingClientRect: () => ({ width, height }) };
}

function randomSeed(seed = 631) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

test('factory scenes are complete, distinct, immutable and recall without changing accepted notes or routing', () => {
  assert.equal(MIDIPHORIA_PRESETS.length, 16);
  assert.equal(new Set(MIDIPHORIA_PRESETS.map(preset => preset.id)).size, 16);
  assert.equal(new Set(MIDIPHORIA_PRESETS.map(preset => JSON.stringify(preset.snapshot))).size, 16);
  assert.deepEqual(new Set(MIDIPHORIA_PRESETS.map(preset => preset.snapshot.render.view)), new Set(MIDIPHORIA_VIEWS));
  assert.deepEqual(new Set(MIDIPHORIA_PRESETS.map(preset => preset.snapshot.render.palette)), new Set(MIDIPHORIA_PALETTES));
  assert.deepEqual(new Set(MIDIPHORIA_PRESETS.map(preset => preset.snapshot.render.colorSource)), new Set(MIDIPHORIA_COLOR_SOURCES));
  assert.equal(DEFAULT_RENDER_OPTIONS.colorSource, 'voice');
  assert.equal(MIDIPHORIA_RENDER_KEYS.includes('voiceLayout'), false);
  assert.ok(MIDIPHORIA_PRESETS.every(preset => !Object.hasOwn(preset.snapshot.render, 'voiceLayout')));
  assert.equal(MIDIPHORIA_PRESETS.filter(preset => preset.snapshot.render.colorSource === 'voice').length, 10);
  const symmetric = MIDIPHORIA_PRESETS.filter(({ snapshot: { render } }) => render.view === 'mirror'
    || render.reflection !== 'none' || (['radial', 'orbit'].includes(render.view) && render.symmetry > 1));
  assert.ok(symmetric.length <= MIDIPHORIA_PRESETS.length / 4, 'at least 75% of factory looks have no mirror/repeated geometry');
  assert.ok(MIDIPHORIA_PRESETS.filter(preset => preset.snapshot.render.reflection === 'none').length >= 12);
  assert.ok(symmetric.every(preset => preset.snapshot.render.width <= 0.65), 'reflected looks use thin trails');
  assert.equal(MIDIPHORIA_VIEWS.includes('mask'), false);
  assert.deepEqual(new Set(MIDIPHORIA_PRESETS.map(preset => preset.snapshot.render.flow)), new Set(MIDIPHORIA_FLOWS));
  const model = new MidiphoriaModel({ channel: 7, trigger: 'mapped', mappedNumber: 72, mappedChannel: 7 });
  model.handleMessage({ type: 'noteOn', note: 72, channel: 7, velocity: 100, sourceId: 'keyboard' }, 1);
  const renderer = new MidiphoriaRenderer(canvas());
  const notes = model.sample(1.1).activeNotes;
  renderer.capture(model.sample(1.1), 1.1);
  const originalTrail = renderer.trails[0];
  for (const preset of MIDIPHORIA_PRESETS) {
    assert.ok(Object.isFrozen(preset.snapshot.model));
    assert.ok(isValidMidiphoriaPreset(preset.snapshot));
    assert.deepEqual(Object.keys(preset.snapshot.model), MIDIPHORIA_MODEL_KEYS);
    assert.deepEqual(Object.keys(preset.snapshot.render), MIDIPHORIA_RENDER_KEYS);
    applyMidiphoriaPreset(model, renderer, preset.snapshot, 1.1);
    assert.deepEqual(captureMidiphoriaPreset(model.options, renderer.options), preset.snapshot);
    assert.deepEqual(model.sample(1.1).activeNotes, notes);
    assert.equal(model.options.channel, 7);
    assert.equal(model.options.trigger, 'mapped');
    assert.equal(model.options.mappedNumber, 72);
    assert.equal(renderer.trails[0], originalTrail);
  }
});

test('sanitization bounds all fields and strips external state; validation rejects incomplete or malformed recalls', () => {
  const value = sanitizeMidiphoriaPreset({ model: { attack: -20, decay: 20, release: 8, sustain: Infinity,
    hueSpeed: 5, velocity: 'true', invert: true, channel: 3, volume: 1, audio: true },
  render: { view: 'broken', trailSeconds: 99, hueOffset: -4, saturation: 7, glow: NaN, width: -9, motion: 8,
    colorSource: 'broken', fadeCurve: 0, spin: -99, symmetry: 2.6, reflection: 'broken', flow: 'broken' } });
  assert.equal(value.model.attack, 0); assert.equal(value.model.decay, 3); assert.equal(value.model.release, 5);
  assert.equal(value.model.sustain, DEFAULT_VISUALS.sustain); assert.equal(value.model.hueSpeed, 1);
  assert.equal(value.model.velocity, DEFAULT_VISUALS.velocity); assert.equal(value.model.invert, true);
  assert.equal(value.render.view, 'trails'); assert.equal(value.render.trailSeconds, 12);
  assert.equal(value.render.hueOffset, 0); assert.equal(value.render.saturation, 1);
  assert.equal(value.render.glow, DEFAULT_RENDER_OPTIONS.glow); assert.equal(value.render.width, 0.3);
  assert.equal(value.render.motion, 2);
  assert.equal(value.render.colorSource, DEFAULT_RENDER_OPTIONS.colorSource); assert.equal(value.render.fadeCurve, 0.25);
  assert.equal(value.render.spin, -2); assert.equal(value.render.symmetry, 3);
  assert.equal(value.render.reflection, 'none'); assert.equal(value.render.flow, 'classic');
  assert.equal(isValidMidiphoriaPreset({ ...value, render: { ...value.render, symmetry: 2.6 } }), false);
  assert.equal('channel' in value.model, false); assert.equal('audio' in value.model, false);
  assert.equal(isValidMidiphoriaPreset({ version: 1, model: {}, render: {} }), false);
  assert.equal(isValidMidiphoriaPreset({ ...value, version: 2 }), false);
  const model = new MidiphoriaModel(), renderer = new MidiphoriaRenderer(canvas());
  const before = captureMidiphoriaPreset(model.options, renderer.options);
  assert.throws(() => applyMidiphoriaPreset(model, renderer, { version: 1, model: {}, render: {} }, 0), TypeError);
  assert.deepEqual(captureMidiphoriaPreset(model.options, renderer.options), before);
});

test('seeded randomization is pure and covers every visual field, boolean, palette and geometry', () => {
  const original = MIDIPHORIA_PRESETS[0].snapshot;
  assert.deepEqual(randomizeMidiphoriaPreset(original, randomSeed()), randomizeMidiphoriaPreset(original, randomSeed()));
  const random = randomSeed();
  const values = { model: {}, render: {} };
  for (const [section, keys] of [['model', MIDIPHORIA_MODEL_KEYS], ['render', MIDIPHORIA_RENDER_KEYS]]) {
    for (const key of keys) values[section][key] = new Set();
  }
  for (let index = 0; index < 1000; index += 1) {
    const result = randomizeMidiphoriaPreset(original, random);
    assert.ok(isValidMidiphoriaPreset(result));
    assert.equal(Object.hasOwn(result.render, 'voiceLayout'), false);
    for (const section of ['model', 'render']) {
      for (const key of Object.keys(values[section])) values[section][key].add(result[section][key]);
    }
  }
  for (const section of ['model', 'render']) for (const [key, choices] of Object.entries(values[section])) {
    assert.ok(choices.size > 1, `${section}.${key} must vary`);
  }
  assert.equal(values.render.view.size, MIDIPHORIA_VIEWS.length);
  assert.equal(values.render.palette.size, MIDIPHORIA_PALETTES.length);
  assert.equal(values.render.colorSource.size, MIDIPHORIA_COLOR_SOURCES.length);
  assert.equal(values.render.reflection.size, MIDIPHORIA_REFLECTIONS.length);
  assert.equal(values.render.flow.size, MIDIPHORIA_FLOWS.length);
  assert.deepEqual([...values.render.symmetry].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok([...values.render.spin].some(value => value < 0));
  assert.ok([...values.render.spin].some(value => value > 0));
  assert.equal(values.model.hueMode.size, 3);
  assert.deepEqual(original, MIDIPHORIA_PRESETS[0].snapshot);
  for (const extreme of [-10, 0, 1, 8, NaN, Infinity]) {
    assert.ok(isValidMidiphoriaPreset(randomizeMidiphoriaPreset(original, () => extreme)));
  }
});

test('neutral color blend preserves original RGB; hue, palette and saturation affect ambient light', () => {
  const model = new MidiphoriaModel({ attack: 0, decay: 0, sustain: 1, velocity: false });
  model.handleMessage({ type: 'noteOn', note: 30, channel: 0, velocity: 127 }, 0);
  const sample = model.sample(1);
  const pitchOptions = { ...DEFAULT_RENDER_OPTIONS, colorSource: 'pitch' };
  const original = midiphoriaBlendRgb(sample, model.options, pitchOptions);
  assert.deepEqual(original, sample.rgb);
  const changed = [
    { ...pitchOptions, palette: 'ice' },
    { ...pitchOptions, hueOffset: 110 },
    { ...pitchOptions, saturation: 0 },
  ].map(options => midiphoriaBlendRgb(sample, model.options, options));
  for (const rgb of changed) {
    assert.notDeepEqual(rgb, original);
    assert.ok(rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
  assert.equal(changed[2][0], changed[2][1]); assert.equal(changed[2][1], changed[2][2]);
  model.configure({ invert: true }, 1);
  const inverse = model.sample(1);
  assert.deepEqual(midiphoriaBlendRgb(inverse, model.options, pitchOptions), inverse.rgb);
  const recoloredInverse = midiphoriaBlendRgb(inverse, model.options, { ...pitchOptions, palette: 'ice' });
  assert.deepEqual(recoloredInverse, changed[0].map(value => 1 - value));
});

test('renderer captures bounded event histories independent of drawing and expires released notes at configured lifetime', () => {
  const renderer = new MidiphoriaRenderer(canvas());
  const notes = Array.from({ length: 400 }, (_, index) => ({ note: index % 128, channel: index % 16,
    sourceId: `source-${index}`, velocity: 100 }));
  renderer.capture({ activeNotes: notes }, 0);
  assert.equal(renderer.held.size, 400); assert.equal(renderer.trails.length, 400);
  renderer.capture({ activeNotes: [] }, 0.1);
  renderer.capture({ activeNotes: notes.map(note => ({ ...note, sourceId: `${note.sourceId}-new` })) }, 0.2);
  assert.equal(renderer.trails.length, 800); assert.equal(renderer.held.size, 400);
  renderer.configure({ trailSeconds: 0.3 });
  renderer.capture({ activeNotes: [] }, 0.3);
  renderer.capture({ activeNotes: [] }, 0.7);
  assert.equal(renderer.trails.length, 0); assert.equal(renderer.held.size, 0);
  renderer.clear(); assert.equal(renderer.trails.length, 0);
});

test('five views produce distinct bounded finite paths with no per-note shadow effects', () => {
  const signatures = new Set();
  for (const view of MIDIPHORIA_VIEWS) {
    const surface = canvas(), renderer = new MidiphoriaRenderer(surface);
    renderer.configure({ view });
    const model = new MidiphoriaModel({ attack: 0 });
    for (const note of [32, 60, 77, 89]) model.handleMessage({ type: 'noteOn', note, channel: 0, velocity: 100 }, 0);
    renderer.draw(model.sample(0), 0, model.options);
    surface.commands.length = 0;
    renderer.draw(model.sample(1), 1, model.options);
    assert.ok(surface.width * surface.height <= 2_005_000);
    assert.ok(surface.commands.length < 300);
    assert.equal('shadowBlur' in surface.context, false);
    assert.ok(surface.commands.flat().filter(value => typeof value === 'number').every(Number.isFinite));
    signatures.add(JSON.stringify(surface.commands));
    assert.equal(renderer.view, view);
  }
  assert.equal(signatures.size, MIDIPHORIA_VIEWS.length);
});


test('note color follows pitch, channel or attack velocity independently and recolors the light strip', () => {
  const first = { note: 32, channel: 3, velocity: 25 };
  const second = { note: 81, channel: 3, velocity: 25 };
  assert.notEqual(midiColorHue(first), midiColorHue(second));
  assert.equal(midiColorHue(first, 'channel'), midiColorHue(second, 'channel'));
  assert.notEqual(midiColorHue(first, 'channel'), midiColorHue({ ...first, channel: 12 }, 'channel'));
  assert.equal(midiColorHue(first, 'velocity'), midiColorHue(second, 'velocity'));
  assert.notEqual(midiColorHue(first, 'velocity'), midiColorHue({ ...first, velocity: 127 }, 'velocity'));
  const model = new MidiphoriaModel({ attack: 0, decay: 0, sustain: 1, release: 2, velocity: false });
  model.handleMessage({ type: 'noteOn', ...first }, 0);
  const sample = model.sample(1);
  const colors = MIDIPHORIA_COLOR_SOURCES.map(colorSource =>
    midiphoriaBlendRgb(sample, model.options, { ...DEFAULT_RENDER_OPTIONS, colorSource }));
  assert.equal(new Set(colors.map(rgb => JSON.stringify(rgb))).size, MIDIPHORIA_COLOR_SOURCES.length);
  for (const rgb of colors) assert.ok(rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  const surface = canvas(), renderer = new MidiphoriaRenderer(surface);
  renderer.configure({ view: 'trails', colorSource: 'channel' });
  renderer.draw(sample, 1, model.options);
  model.handleMessage({ type: 'noteOff', ...first }, 1);
  const release = model.sample(2);
  renderer.draw(release, 2, model.options);
  const expected = colors[MIDIPHORIA_COLOR_SOURCES.indexOf('channel')].map(value => Math.round(value * release.level * 255));
  assert.equal(surface.context.fillStyle, `rgb(${expected.join(' ')})`);
});

test('trail fade changes released opacity while preserving note geometry and the full lifetime', () => {
  const surface = canvas(), renderer = new MidiphoriaRenderer(surface);
  renderer.configure({ motion: 0, glow: 0, trailSeconds: 4 });
  const sample = { activeNotes: [{ note: 60, channel: 0, velocity: 127 }], rgb: [1, 0, 0], level: 1 };
  renderer.capture(sample, 0);
  renderer.capture({ ...sample, activeNotes: [] }, 1);
  const alpha = [], paths = [];
  for (const fadeCurve of [0.25, 1, 4]) {
    renderer.configure({ fadeCurve });
    surface.strokes.length = 0; surface.commands.length = 0;
    renderer.draw({ ...sample, activeNotes: [] }, 3, { ...DEFAULT_VISUALS, velocity: false });
    alpha.push(surface.strokes.at(-2).alpha);
    paths.push(JSON.stringify(surface.commands));
    assert.equal(renderer.trails.length, 1);
  }
  assert.ok(alpha[0] > alpha[1] && alpha[1] > alpha[2]);
  assert.equal(alpha[1], 0.5);
  assert.equal(new Set(paths).size, 1);
  renderer.draw({ ...sample, activeNotes: [] }, 5, DEFAULT_VISUALS);
  assert.equal(renderer.trails.length, 0);
});

test('circular spin reverses without a phase jump and symmetry adds bounded copies of actual notes', () => {
  const surface = canvas(), renderer = new MidiphoriaRenderer(surface);
  renderer.configure({ view: 'radial', motion: 0, spin: 1, glow: 0 });
  const sample = { activeNotes: [{ note: 32, channel: 0, velocity: 127 }], rgb: [1, 0, 0], level: 1 };
  const head = now => {
    surface.commands.length = 0;
    renderer.draw(sample, now, DEFAULT_VISUALS);
    return surface.commands.find(command => command[0] === 'moveTo').slice(1);
  };
  const origin = head(0), turned = head(10);
  assert.notDeepEqual(turned, origin);
  renderer.configure({ spin: -1 });
  assert.deepEqual(head(10), turned);
  const returned = head(20);
  for (let axis = 0; axis < 2; axis += 1) assert.ok(Math.abs(returned[axis] - origin[axis]) < 1e-9);
  renderer.configure({ symmetry: 8 });
  head(20);
  assert.equal(surface.commands.filter(command => command[0] === 'lineTo').length, 9);
  assert.equal(renderer.trails.length, 1); // Copies are geometry, never new MIDI notes.
  assert.equal(renderer.held.size, 1);

  for (const view of ['radial', 'orbit']) {
    renderer.clear(); renderer.configure({ view, symmetry: 8, glow: 1, spin: 2, width: 3 });
    const notes = Array.from({ length: 192 }, (_, index) => ({ note: index % 128,
      channel: index % 16, velocity: 127, sourceId: `dense-${index}` }));
    renderer.capture({ ...sample, activeNotes: notes }, 20);
    renderer.capture({ ...sample, activeNotes: [] }, 20.1);
    surface.commands.length = 0;
    renderer.draw({ ...sample, activeNotes: notes.map(note => ({ ...note, sourceId: `${note.sourceId}-next` })) }, 20.2, DEFAULT_VISUALS);
    assert.equal(renderer.trails.length, 384);
    assert.ok(surface.commands.length < 18000, `${view} must bound drawing even at eight copies`);
    assert.ok(surface.commands.flat().filter(value => typeof value === 'number').every(Number.isFinite));
    assert.equal('shadowBlur' in surface.context, false);
  }
});

test('version 1 split layouts are ignored while their colors, trails and live notes survive recall', () => {
  const expected = MIDIPHORIA_PRESETS[1].snapshot;
  const model = new MidiphoriaModel({ channel: 2 });
  const renderer = new MidiphoriaRenderer(canvas());
  model.handleMessage({ type: 'noteOn', note: 72, channel: 2, velocity: 100, sourceId: 'keyboard' }, 0);
  const notes = model.sample(0).activeNotes;
  for (const voiceLayout of ['lanes', 'panels', 'overlay', undefined, 'obsolete']) {
    const legacy = structuredClone(expected);
    legacy.render.voiceLayout = voiceLayout;
    const stored = structuredClone(legacy);
    assert.ok(isValidMidiphoriaPreset(legacy));
    assert.deepEqual(sanitizeMidiphoriaPreset(legacy), expected);
    assert.deepEqual(captureMidiphoriaPreset(legacy.model, legacy.render), expected);
    assert.deepEqual(applyMidiphoriaPreset(model, renderer, legacy, 0), expected);
    assert.equal(Object.hasOwn(renderer.options, 'voiceLayout'), false);
    assert.deepEqual(model.sample(0).activeNotes, notes);
    assert.equal(model.options.channel, 2);
    assert.deepEqual(legacy, stored, 'recall must not mutate the saved scene');
  }
});

test('older complete version 1 snapshots recall Classic and None without inheriting current geometry', () => {
  const older = structuredClone(MIDIPHORIA_PRESETS[0].snapshot);
  delete older.render.flow; delete older.render.reflection;
  const model = new MidiphoriaModel(), renderer = new MidiphoriaRenderer(canvas());
  renderer.configure({ reflection: 'all', flow: 'inward' });
  assert.ok(isValidMidiphoriaPreset(older));
  const applied = applyMidiphoriaPreset(model, renderer, older, 0);
  assert.equal(applied.render.flow, 'classic'); assert.equal(applied.render.reflection, 'none');
  assert.equal('flow' in older.render, false); // Migration never mutates stored data.
  for (const key of ['flow', 'reflection']) {
    assert.equal(isValidMidiphoriaPreset({ ...older, render: { ...older.render, [key]: undefined } }), false);
    assert.equal(isValidMidiphoriaPreset({ ...older, render: { ...older.render, [key]: 'invalid' } }), false);
  }
  delete older.render.trailSeconds;
  assert.equal(isValidMidiphoriaPreset(older), false);
});

test('reflection axes preserve physical distances and add only the intended unique images', () => {
  const point = [117, 43];
  const expected = {
    none: [[117, 43]], vertical: [[117, 43], [-117, 43]], horizontal: [[117, 43], [117, -43]],
    both: [[117, 43], [-117, 43], [117, -43], [-117, -43]],
    diagonal: [[117, 43], [43, 117]], 'anti-diagonal': [[117, 43], [-43, -117]],
    diagonals: [[117, 43], [43, 117], [-43, -117], [-117, -43]],
    all: [[117, 43], [-117, 43], [117, -43], [-117, -43], [43, 117], [-43, -117], [-43, 117], [43, -117]],
  };
  for (const reflection of MIDIPHORIA_REFLECTIONS) {
    const transforms = midiphoriaReflectionTransforms({ ...DEFAULT_RENDER_OPTIONS, reflection });
    const points = transforms.map(([a, b, c, d]) => [a * point[0] + c * point[1], b * point[0] + d * point[1]]);
    assert.deepEqual(points, expected[reflection]);
    for (const [x, y] of points) assert.equal(x * x + y * y, point[0] ** 2 + point[1] ** 2);
    assert.equal(new Set(points.map(value => value.join(','))).size, points.length);
  }
  for (const view of ['radial', 'orbit']) {
    assert.equal(midiphoriaReflectionTransforms({ ...DEFAULT_RENDER_OPTIONS, view, reflection: 'all', symmetry: 8 }).length, 2);
    assert.equal(midiphoriaReflectionTransforms({ ...DEFAULT_RENDER_OPTIONS, view, reflection: 'all', symmetry: 7 }).length, 8);
    assert.equal(midiphoriaReflectionTransforms({ ...DEFAULT_RENDER_OPTIONS, view, reflection: 'both', symmetry: 4 }).length, 2);
  }
  assert.equal(midiphoriaReflectionTransforms({ ...DEFAULT_RENDER_OPTIONS, view: 'mirror', reflection: 'both' }).length, 1);
  assert.equal(midiphoriaReflectionTransforms({ ...DEFAULT_RENDER_OPTIONS, view: 'mirror', reflection: 'all' }).length, 2);
});

test('released note heads move from center to edge or edge to center in every geometric view', () => {
  assert.equal(midiphoriaTravelFraction(-2, 'outward'), 0);
  assert.equal(midiphoriaTravelFraction(3, 'inward'), 0);
  assert.equal(midiphoriaTravelFraction(Infinity, 'inward'), 1);
  for (const view of MIDIPHORIA_VIEWS) {
    for (const flow of ['outward', 'inward']) {
      const surface = canvas(640, 400), renderer = new MidiphoriaRenderer(surface);
      renderer.configure({ view, flow, motion: 0, glow: 0, trailSeconds: 4, spin: 0 });
      const sample = { activeNotes: [{ note: 25, channel: 0, velocity: 127 }], rgb: [1, 0, 0], level: 1 };
      renderer.capture(sample, 0); renderer.capture({ ...sample, activeNotes: [] }, 1);
      const distances = [];
      for (const now of [1.1, 2, 3.5]) {
        surface.commands.length = 0;
        renderer.draw({ ...sample, activeNotes: [] }, now, DEFAULT_VISUALS);
        // Isolate the actual note stroke between the last guide and CC strip.
        const starts = surface.commands.map((command, index) => command[0] === 'beginPath' ? index : -1).filter(index => index >= 0);
        const path = surface.commands.slice(starts.at(-2) + 1, starts.at(-1));
        let point;
        if (view === 'radial' || view === 'mirror') point = path.find(command => command[0] === 'moveTo').slice(1);
        else if (view === 'trails') point = path.find(command => command[0] === 'lineTo').slice(1);
        else point = path.filter(command => command[0] === 'bezierCurveTo').at(-1).slice(-2);
        distances.push(Math.hypot(point[0] - 320, point[1] - 200));
      }
      if (flow === 'outward') assert.ok(distances[0] < distances[1] && distances[1] < distances[2], `${view} must expand`);
      else assert.ok(distances[0] > distances[1] && distances[1] > distances[2], `${view} must converge`);
    }
  }
});

test('reflection composites the bounded history once and reuses its canvas through live edits and resize', () => {
  for (const view of ['radial', 'orbit', 'mirror', 'ribbons', 'trails']) {
    const surface = canvas(), renderer = new MidiphoriaRenderer(surface);
    renderer.configure({ view, reflection: 'all', flow: 'inward', symmetry: 8, glow: 1, spin: 2, width: 3 });
    const notes = Array.from({ length: 192 }, (_, index) => ({ note: index % 128,
      channel: index % 16, velocity: 127, sourceId: `dense-${index}` }));
    const sample = { activeNotes: notes, rgb: [1, 0, 0], level: 1 };
    renderer.capture(sample, 0); renderer.capture({ ...sample, activeNotes: [] }, 0.1);
    renderer.draw({ ...sample, activeNotes: notes.map(note => ({ ...note, sourceId: `${note.sourceId}-next` })) }, 0.2, DEFAULT_VISUALS);
    assert.equal(renderer.trails.length, 384); assert.equal(renderer.held.size, 192);
    assert.equal(surface.layers.length, 1);
    const layer = surface.layers[0];
    assert.ok(layer.width * layer.height <= 2_005_000);
    assert.ok(layer.commands.length < 25000, `${view} must draw one bounded note layer`);
    assert.ok(surface.commands.length < 180, `${view} reflection cannot multiply vector commands`);
    const images = surface.commands.filter(command => command[0] === 'drawImage');
    assert.equal(images.length, midiphoriaReflectionTransforms(renderer.options).length);
    for (const image of images) assert.equal(image[1], layer);
    assert.ok(layer.commands.flat().filter(value => typeof value === 'number').every(Number.isFinite));
    assert.ok(surface.commands.flat().filter(value => typeof value === 'number').every(Number.isFinite));
    assert.equal('shadowBlur' in layer.context, false);
    assert.deepEqual(layer.commands.find(command => command[0] === 'translate'), ['translate', 270, 0]);
    renderer.configure({ reflection: 'vertical', flow: 'outward' });
    renderer.draw(sample, 0.3, DEFAULT_VISUALS);
    renderer.resize();
    assert.equal(surface.layers.length, 1); assert.equal(layer.width, surface.width); assert.equal(layer.height, surface.height);
    renderer.clear(); assert.equal(renderer.trails.length, 0); assert.equal(renderer.held.size, 0);
  }
});

test('diagonal reflection keeps extreme-pitch centerlines inside its undistorted square at maximum motion', () => {
  for (const view of MIDIPHORIA_VIEWS) {
    for (const flow of MIDIPHORIA_FLOWS) {
      const surface = canvas(1000, 300), renderer = new MidiphoriaRenderer(surface);
      renderer.configure({ view, flow, reflection: 'all', symmetry: 8, motion: 2, glow: 1 });
      const sample = { activeNotes: [0, 127].map(note => ({ note, channel: 0, velocity: 127 })), rgb: [1, 0, 0], level: 1 };
      renderer.capture(sample, 0);
      renderer.draw(sample, 7, DEFAULT_VISUALS);
      for (const command of surface.layers[0].commands) {
        let coords = [];
        if (['moveTo', 'lineTo', 'bezierCurveTo'].includes(command[0])) coords = command.slice(1);
        else if (command[0] === 'arc') coords = command.slice(1, 3);
        for (const coord of coords) assert.ok(coord >= 0 && coord <= 300,
          `${view}/${flow} ${command[0]} ${coord} must fit the centered square`);
      }
    }
  }
});
