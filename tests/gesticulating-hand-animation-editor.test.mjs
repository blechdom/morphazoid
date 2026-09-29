import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandContourEditor } from '../src/instruments/gesticulating-hand/hand-contour-editor.js';
import { evaluateHandPose, normalizeHandConfig, handAnimationBounds, handAnimationValue,
  handMotionPeriod, getHandAnimationEdit, setHandAnimationEdit } from '../src/instruments/gesticulating-hand/hand-model.js';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const clone = value => structuredClone(value);
const WIDTH = 256, HEIGHT = 100;

function harness(t, initial) {
  const saved = Object.fromEntries(['document', 'window', 'Option'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const elements = new Map();
  const context = new Proxy({}, { get(target, key) { return target[key] ?? (() => {}); } });
  class Element {
    constructor(id) { this.id = id; this.handlers = new Map(); this.attrs = new Map(); this.style = {}; this.children = [];
      this.clientWidth = WIDTH; this.clientHeight = HEIGHT; this.value = ''; this.textContent = ''; this.disabled = true; }
    setAttribute(key, value) { this.attrs.set(key, value); }
    getAttribute(key) { return this.attrs.get(key); }
    replaceChildren(...children) { this.children = children; }
    getBoundingClientRect() { return {left: 0, top: 0, width: WIDTH, height: HEIGHT}; }
    getContext() { return context; }
    focus() { globalThis.document.activeElement = this; }
    setPointerCapture(id) { this.pointer = id; }
    hasPointerCapture(id) { return this.pointer === id; }
    releasePointerCapture() { this.pointer = undefined; }
    dispatch(type, data = {}) {
      const event = {button: 0, pointerId: 7, preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; }, ...data};
      for (const handler of this.handlers.get(type) ?? []) handler(event);
      return event;
    }
  }
  for (let index = 0; index < 7; index++) for (const prefix of ['contour', 'contour-joint', 'contour-value']) {
    const id = `${prefix}-${index}`; elements.set(id, new Element(id));
  }
  globalThis.document = {getElementById: id => elements.get(id), activeElement: null};
  globalThis.window = {devicePixelRatio: 1};
  globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  let config = normalizeHandConfig(initial), commits = 0;
  const selections = [];
  const editor = createHandContourEditor({
    read: () => config,
    commit(next) { config = normalizeHandConfig(next); commits++; editor.sync(config); },
    listen(element, type, handler) { const handlers = element.handlers.get(type) ?? []; handlers.push(handler); element.handlers.set(type, handlers); },
    selectFinger(index, joint) { selections.push([index, joint]); },
  });
  editor.sync(config);
  const element = id => elements.get(id);
  return {
    editor, element, selections, get config() { return config; }, get commits() { return commits; },
    change(callback) { const next = clone(config); callback(next); config = normalizeHandConfig(next); editor.sync(config); },
    key(index, key, shiftKey = false, modifiers = {}) {
      const canvas = element(`contour-${index}`); canvas.focus();
      return canvas.dispatch('keydown', {key, shiftKey, ...modifiers});
    },
    pointer(index, type, point, angle, joint = element(`contour-joint-${index}`).value) {
      const [low, high] = handAnimationBounds(config.form, index, joint);
      element(`contour-${index}`).dispatch(type, {clientX: point / 16 * WIDTH, clientY: 5 + (high - angle) / (high - low) * (HEIGHT - 10)});
    },
    release(index) { element(`contour-${index}`).dispatch('pointerup'); },
    undo(index = 0, modifier = 'ctrlKey') { return this.key(index, 'z', false, {[modifier]: true}); },
  };
}

function performance(config, time, tremorOffset = 0) { return evaluateHandPose(config, time, undefined, time + tremorOffset); }
function omitEdits(config) { const result = clone(config); delete result.motion.edits; return result; }
function editMap(config) { return clone(config.motion.edits); }

test('dragging interpolates physical joint targets over one frozen native loop and preserves every other channel', t => {
  const initial = normalizeHandConfig({motion: {id: 'source-grasp', amount: .83, tempo: 83, speed: 1.2},
    tremor: {amount: 7, rate: 6.3, finger: 'all', joint: 'tip', phaseSpread: .4},
    sound: {rhythm: 'walk', noteLength: .37}});
  setHandAnimationEdit(initial, 1, 'dip', Array(16).fill(.1));
  setHandAnimationEdit(initial, 2, 'spread', Array(16).fill(-.08));
  const h = harness(t, initial), original = clone(h.config), period = handMotionPeriod(original.motion), offset = .413;
  h.editor.draw(period * .72, period * .72 + offset);
  h.editor.select(1, 'dip');
  h.pointer(1, 'pointerdown', 0, 10);
  h.change(config => { config.sound.brightness = .91; });
  // A new playback loop and a changed tremor anchor must not move the stroke's baseline.
  h.editor.draw(period * 2.3, period * 2.3 + 1.67);
  h.pointer(1, 'pointermove', 15, 52);
  h.release(1);
  const expectedSettings = clone(original); expectedSettings.sound.brightness = .91;
  assert.deepEqual(omitEdits(h.config), omitEdits(expectedSettings));
  assert.deepEqual(getHandAnimationEdit(h.config, 2, 'spread'), getHandAnimationEdit(original, 2, 'spread'));
  for (let point = 0; point < 16; point++) {
    const time = point / 16 * period, before = performance(original, time, offset), after = performance(h.config, time, offset);
    close(after.fingers[1].dip, 10 + (52 - 10) * point / 15);
    after.fingers[1].dip = before.fingers[1].dip;
    assert.deepEqual(after, before, 'source quaternion metadata and unrelated physical channels survive');
  }
});

for (const modifier of ['ctrlKey', 'metaKey']) test(`${modifier} + Z reverses one whole stroke while preserving controls changed later`, t => {
  const h = harness(t, {motion: {id: 'finger-roll', amount: .7}}), originalEdits = editMap(h.config);
  h.editor.draw(.5);
  h.pointer(0, 'pointerdown', 1, 20);
  h.pointer(0, 'pointermove', 7, 45);
  h.pointer(0, 'pointermove', 14, 15);
  h.release(0);
  assert.ok(h.commits >= 3);
  h.change(config => { config.motion.tempo = 194; config.voices[2].level = .123; });
  const event = h.undo(0, modifier);
  assert.equal(event.defaultPrevented, true); assert.equal(event.propagationStopped, true);
  assert.deepEqual(h.config.motion.edits, originalEdits);
  assert.equal(h.config.motion.tempo, 194);
  assert.equal(h.config.voices[2].level, .123);
  const commits = h.commits; h.undo(0, modifier);
  assert.equal(h.commits, commits, 'the whole multi-point stroke consumed one history entry');
});

test('Home removes the selected point correction and restores original procedural performance exactly', t => {
  const h = harness(t, {motion: {id: 'count', tempo: 120}, tremor: {amount: 8, rate: 13.1}, sound: {rhythm: 'broken'}});
  h.change(config => setHandAnimationEdit(config, 3, 'spread', Array(16).fill(.04)));
  const original = clone(h.config), period = handMotionPeriod(original.motion);
  h.editor.draw(.23);
  h.pointer(0, 'pointerdown', 4, 39); h.release(0);
  assert.ok(getHandAnimationEdit(h.config, 0, 'mcp'));
  h.key(0, 'Home');
  assert.deepEqual(h.config, original);
  for (let point = 0; point <= 48; point++) assert.deepEqual(performance(h.config, point / 48 * period, .91), performance(original, point / 48 * period, .91));
});

test('keyboard uses physical range increments and Home/Delete reset only the selected correction point', t => {
  const h = harness(t, {motion: {id: 'still', amount: 0}, pose: {fingers: [{mcp: 18}]}});
  h.editor.draw(0);
  const bounds = handAnimationBounds('hand', 0, 'mcp'), span = bounds[1] - bounds[0];
  h.key(0, 'ArrowUp');
  close(handAnimationValue(performance(h.config, 0), 0, 'mcp'), 18 + span * .025);
  h.key(0, 'ArrowUp', true);
  close(handAnimationValue(performance(h.config, 0), 0, 'mcp'), 18 + span * .125);
  h.key(0, 'ArrowRight'); h.key(0, 'ArrowDown');
  close(getHandAnimationEdit(h.config, 0, 'mcp')[1], -.025);
  h.key(0, 'Home');
  close(getHandAnimationEdit(h.config, 0, 'mcp')[1], 0);
  close(getHandAnimationEdit(h.config, 0, 'mcp')[0], .125);
  const canvas = h.element('contour-0');
  assert.equal(canvas.getAttribute('aria-valuemin'), String(bounds[0]));
  assert.equal(canvas.getAttribute('aria-valuemax'), String(bounds[1]));
  assert.equal(canvas.getAttribute('aria-valuetext'), 'Point 2 of 16, 18 degrees');
  assert.equal(h.element('contour-value-0').textContent, '18°');
  h.key(0, 'ArrowLeft'); h.key(0, 'Delete');
  assert.equal(getHandAnimationEdit(h.config, 0, 'mcp'), undefined);
  close(handAnimationValue(performance(h.config, 0), 0, 'mcp'), 18);
});

test('wrist, ankle, and foot shape are editable, with percent units for stretch and valid form-specific joints', t => {
  const h = harness(t, {motion: {id: 'still', amount: 0}});
  h.editor.draw(0);
  h.editor.select(5, 'twist');
  assert.equal(h.selections.length, 0, 'programmatic selection does not recurse into the viewport callback');
  h.pointer(5, 'pointerdown', 4, -27); h.release(5);
  close(performance(h.config, handMotionPeriod(h.config.motion) / 4).wrist.twist, -27);
  assert.equal(h.element('contour-5').getAttribute('aria-label'), 'Wrist Turn animation');
  h.change(config => { config.form = 'foot'; });
  assert.ok(!h.element('contour-joint-0').children.some(option => option.value === 'pip'));
  h.editor.select(5, 'side'); h.pointer(5, 'pointerdown', 0, 12); h.release(5);
  close(performance(h.config, 0).wrist.side, 12);
  assert.equal(h.element('contour-5').getAttribute('aria-label'), 'Ankle Side to side animation');
  h.editor.select(6, 'stretch'); h.pointer(6, 'pointerdown', 0, .12); h.release(6);
  close(performance(h.config, 0).foot.stretch, .12);
  assert.equal(h.element('contour-value-6').textContent, '12%');
  assert.equal(h.element('contour-6').getAttribute('aria-valuetext'), 'Point 1 of 16, 12 percent stretch');
  assert.deepEqual(h.selections.at(-1), [6, 'stretch']);
});

test('legacy drawn contours stay native and exact selected readouts include tremor and note taps', t => {
  const initial = normalizeHandConfig({motion: {id: 'count', custom: true, tempo: 89, amount: .4},
    tremor: {amount: 8, rate: 17.123, finger: 'all', joint: 'tip'}, sound: {rhythm: 'three-four'}});
  initial.motion.contours[1].dip = Array.from({length: 16}, (_, point) => Math.sin(point * Math.PI / 8) * .3);
  delete initial.motion.edits;
  const h = harness(t, JSON.parse(JSON.stringify(initial))), original = clone(h.config), period = handMotionPeriod(h.config.motion), offset = .147;
  assert.deepEqual(h.config.motion.edits, {}, 'legacy saved configuration receives an empty correction map');
  assert.deepEqual(h.config.motion.contours, initial.motion.contours);
  assert.equal(h.config.motion.custom, true);
  h.editor.draw(period * 1.3, period * 1.3 + offset);
  h.editor.select(1, 'dip');
  for (let point = 0; point < 5; point++) h.key(1, 'ArrowRight');
  const actual = performance(original, period + 5 / 16 * period, offset).fingers[1].dip;
  close(Number(h.element('contour-1').getAttribute('aria-valuenow')), actual, .000051);
  assert.equal(h.element('contour-value-1').textContent, `${Math.round(actual)}°`);
  h.pointer(1, 'pointerdown', 5, 36); h.release(1);
  close(performance(h.config, period + 5 / 16 * period, offset).fingers[1].dip, 36);
  assert.deepEqual(omitEdits(h.config), omitEdits(original));
  h.key(1, 'Delete');
  assert.deepEqual(h.config, original);
});

test('clearing history finishes an in-progress stroke and makes keyboard undo inert after sync', t => {
  const h = harness(t, {motion: {id: 'still', amount: 0}});
  h.editor.draw(0); h.pointer(0, 'pointerdown', 2, 33);
  assert.equal(h.element('contour-0').hasPointerCapture(7), true);
  h.editor.clearHistory();
  assert.equal(h.element('contour-0').hasPointerCapture(7), false);
  const after = clone(h.config), commits = h.commits;
  h.pointer(0, 'pointermove', 7, 50); h.undo();
  assert.deepEqual(h.config, after); assert.equal(h.commits, commits);
});


test('joint selection and keyboard edits finish active pointer strokes without transferring corrections', t => {
  const h = harness(t, {motion: {id: 'still', amount: 0}});
  h.editor.draw(0); h.pointer(0, 'pointerdown', 2, 33);
  const mcp = clone(getHandAnimationEdit(h.config, 0, 'mcp'));
  h.editor.select(0, 'dip');
  assert.equal(h.element('contour-0').hasPointerCapture(7), false);
  h.pointer(0, 'pointermove', 7, 50);
  assert.deepEqual(getHandAnimationEdit(h.config, 0, 'mcp'), mcp);
  assert.equal(getHandAnimationEdit(h.config, 0, 'dip'), undefined);
  h.pointer(0, 'pointerdown', 4, 21);
  const dip = clone(getHandAnimationEdit(h.config, 0, 'dip'));
  h.key(0, 'ArrowUp');
  assert.equal(h.element('contour-0').hasPointerCapture(7), false);
  const afterKeyboard = clone(h.config);
  h.pointer(0, 'pointermove', 8, 54);
  assert.deepEqual(h.config, afterKeyboard);
  h.undo();
  assert.deepEqual(getHandAnimationEdit(h.config, 0, 'dip'), dip);
  h.undo();
  assert.equal(getHandAnimationEdit(h.config, 0, 'dip'), undefined);
  assert.deepEqual(getHandAnimationEdit(h.config, 0, 'mcp'), mcp);
});


test('foot joint selectors edit other toes independently while the big toe excludes a middle joint', t => {
  const h = harness(t, {form: 'foot', motion: {id: 'still', amount: 0}, tremor: {amount: 0}});
  const original = clone(h.config), pose = performance(original, 0);
  h.editor.draw(0);
  assert.deepEqual(h.element('contour-joint-0').children.map(option => option.value), ['mcp', 'dip', 'spread']);
  for (let index = 1; index < 5; index++) {
    const selector = h.element(`contour-joint-${index}`);
    assert.ok(selector.children.some(option => option.value === 'pip'));
    selector.value = 'pip'; selector.dispatch('change');
    assert.deepEqual(h.selections.at(-1), [index, 'pip']);
    h.key(index, 'ArrowUp');
    const edited = performance(h.config, 0);
    assert.ok(edited.fingers[index].pip > pose.fingers[index].pip);
    edited.fingers[index].pip = pose.fingers[index].pip;
    assert.deepEqual(edited, pose, 'all other toe joints, ankle and foot shape are unchanged');
    h.key(index, 'Home'); assert.deepEqual(h.config, original);
  }
});
