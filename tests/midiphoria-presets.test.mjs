import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiphoriaModel, DEFAULT_VISUALS } from '../src/instruments/midiphoria/midiphoria-model.js';
import { MIDIPHORIA_PRESETS, MIDIPHORIA_VIEWS, MIDIPHORIA_PALETTES, MIDIPHORIA_COLOR_SOURCES,
  DEFAULT_RENDER_OPTIONS, MIDIPHORIA_MODEL_KEYS, MIDIPHORIA_RENDER_KEYS,
  captureMidiphoriaPreset, applyMidiphoriaPreset, randomizeMidiphoriaPreset,
  sanitizeMidiphoriaPreset, isValidMidiphoriaPreset,
} from '../src/instruments/midiphoria/midiphoria-presets.js';
import { MidiphoriaRenderer, midiphoriaMaskRgb, midiColorHue } from '../src/instruments/midiphoria/midiphoria-renderer.js';

function canvas() {
  const commands = [], strokes = [];
  const context = {};
  for (const name of ['setTransform', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke',
    'arc', 'fill', 'fillText', 'bezierCurveTo']) context[name] = (...args) => commands.push([name, ...args]);
  context.stroke = () => {
    commands.push(['stroke']);
    strokes.push({ alpha: context.globalAlpha, color: context.strokeStyle, width: context.lineWidth });
  };
  context.createRadialGradient = (...args) => {
    commands.push(['gradient', ...args]);
    return { addColorStop() {} };
  };
  return { width: 0, height: 0, commands, strokes, context, getContext: () => context,
    getBoundingClientRect: () => ({ width: 1440, height: 900 }) };
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
    colorSource: 'broken', fadeCurve: 0, spin: -99, symmetry: 2.6 } });
  assert.equal(value.model.attack, 0); assert.equal(value.model.decay, 3); assert.equal(value.model.release, 5);
  assert.equal(value.model.sustain, DEFAULT_VISUALS.sustain); assert.equal(value.model.hueSpeed, 1);
  assert.equal(value.model.velocity, DEFAULT_VISUALS.velocity); assert.equal(value.model.invert, true);
  assert.equal(value.render.view, 'trails'); assert.equal(value.render.trailSeconds, 12);
  assert.equal(value.render.hueOffset, 0); assert.equal(value.render.saturation, 1);
  assert.equal(value.render.glow, DEFAULT_RENDER_OPTIONS.glow); assert.equal(value.render.width, 0.3);
  assert.equal(value.render.motion, 2);
  assert.equal(value.render.colorSource, 'pitch'); assert.equal(value.render.fadeCurve, 0.25);
  assert.equal(value.render.spin, -2); assert.equal(value.render.symmetry, 3);
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
  assert.deepEqual([...values.render.symmetry].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok([...values.render.spin].some(value => value < 0));
  assert.ok([...values.render.spin].some(value => value > 0));
  assert.equal(values.model.hueMode.size, 3);
  assert.deepEqual(original, MIDIPHORIA_PRESETS[0].snapshot);
  for (const extreme of [-10, 0, 1, 8, NaN, Infinity]) {
    assert.ok(isValidMidiphoriaPreset(randomizeMidiphoriaPreset(original, () => extreme)));
  }
});

test('mask neutral settings preserve original RGB; hue, palette and saturation visibly affect the mask', () => {
  const model = new MidiphoriaModel({ attack: 0, decay: 0, sustain: 1, velocity: false });
  model.handleMessage({ type: 'noteOn', note: 30, channel: 0, velocity: 127 }, 0);
  const sample = model.sample(1);
  const original = midiphoriaMaskRgb(sample, model.options);
  assert.deepEqual(original, sample.rgb);
  const changed = [
    { ...DEFAULT_RENDER_OPTIONS, palette: 'ice' },
    { ...DEFAULT_RENDER_OPTIONS, hueOffset: 110 },
    { ...DEFAULT_RENDER_OPTIONS, saturation: 0 },
  ].map(options => midiphoriaMaskRgb(sample, model.options, options));
  for (const rgb of changed) {
    assert.notDeepEqual(rgb, original);
    assert.ok(rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
  assert.equal(changed[2][0], changed[2][1]); assert.equal(changed[2][1], changed[2][2]);
  model.configure({ invert: true }, 1);
  const inverse = model.sample(1);
  assert.deepEqual(midiphoriaMaskRgb(inverse, model.options), inverse.rgb);
  const recoloredInverse = midiphoriaMaskRgb(inverse, model.options, { ...DEFAULT_RENDER_OPTIONS, palette: 'ice' });
  assert.deepEqual(recoloredInverse, changed[0].map(value => 1 - value));
});

test('renderer captures bounded event histories independent of drawing and expires released notes at configured lifetime', () => {
  const renderer = new MidiphoriaRenderer(canvas());
  const notes = Array.from({ length: 400 }, (_, index) => ({ note: index % 128, channel: index % 16,
    sourceId: `source-${index}`, velocity: 100 }));
  renderer.capture({ activeNotes: notes }, 0);
  assert.equal(renderer.held.size, 256); assert.equal(renderer.trails.length, 256);
  renderer.capture({ activeNotes: [] }, 0.1);
  renderer.capture({ activeNotes: notes.map(note => ({ ...note, sourceId: `${note.sourceId}-new` })) }, 0.2);
  assert.equal(renderer.trails.length, 384); assert.equal(renderer.held.size, 256);
  renderer.configure({ trailSeconds: 0.3 });
  renderer.capture({ activeNotes: [] }, 0.3);
  renderer.capture({ activeNotes: [] }, 0.7);
  assert.equal(renderer.trails.length, 0); assert.equal(renderer.held.size, 0);
  renderer.clear(); assert.equal(renderer.trails.length, 0);
});

test('six views produce distinct bounded finite paths with no per-note shadow effects', () => {
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


test('note color follows pitch, channel or attack velocity independently and recolors the mask', () => {
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
    midiphoriaMaskRgb(sample, model.options, { ...DEFAULT_RENDER_OPTIONS, colorSource }));
  assert.equal(new Set(colors.map(rgb => JSON.stringify(rgb))).size, 3);
  for (const rgb of colors) assert.ok(rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  const surface = canvas(), renderer = new MidiphoriaRenderer(surface);
  renderer.configure({ view: 'mask', colorSource: 'channel' });
  renderer.draw(sample, 1, model.options);
  model.handleMessage({ type: 'noteOff', ...first }, 1);
  const release = model.sample(2);
  renderer.draw(release, 2, model.options);
  const expected = colors[1].map(value => Math.round(value * release.level * 255));
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
    const notes = Array.from({ length: 400 }, (_, index) => ({ note: index % 128,
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
