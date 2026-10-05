import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTH_ADSR_EDITOR_MODEL,
  adsrFromPoints,
  adsrPoints,
  createEnvelopeEditor,
} from '../src/instruments/synthesis/envelope.js';
import { ENVELOPE_PRESETS } from '../src/instruments/synthesis/envelope-presets.js';

const close = (actual, expected, tolerance = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);
};

test('Shape-style T/A/D/S/R points round-trip the full Synthesaurus ADSR range', () => {
  for (const envelope of [
    { attack: .001, decay: .002, sustain: 0, release: .003 },
    { attack: .018, decay: .22, sustain: .8, release: .35 },
    { attack: 12, decay: 12, sustain: 1, release: 16 },
  ]) {
    const points = adsrPoints(envelope);
    assert.equal(points.length, 5);
    assert.deepEqual(SYNTH_ADSR_EDITOR_MODEL.labels, ['T', 'A', 'D', 'S', 'R']);
    const restored = adsrFromPoints(points);
    for (const key of Object.keys(envelope)) close(restored[key], envelope[key]);
  }
});

test('every time and level moves independently without displacing another endpoint', () => {
  const original = adsrPoints({ attack: .02, decay: .4, sustain: .6, release: .8 });
  assert.deepEqual(SYNTH_ADSR_EDITOR_MODEL.fixedNodes, []);
  for (let index = 0; index < 5; index++) {
    const moved = SYNTH_ADSR_EDITOR_MODEL.moveNode(original, index, { x: original[index].x + .012, y: .32 });
    assert.notEqual(moved[index].x, original[index].x);
    close(moved[index].y, .32);
    for (let other = 0; other < 5; other++) if (other !== index) {
      close(moved[other].x, original[other].x); close(moved[other].y, original[other].y);
    }
    assert.equal(SYNTH_ADSR_EDITOR_MODEL.nodeAria(original, index), false);
    assert.match(SYNTH_ADSR_EDITOR_MODEL.describeNode(moved, index), /left\/right time, up\/down level/);
  }
  const movedS = SYNTH_ADSR_EDITOR_MODEL.moveNode(original, 3, { ...original[3], y: .2 });
  close(movedS[2].y, .6); close(movedS[3].y, .2);
});

test('point ordering clamps only the selected endpoint, and shape state round-trips', () => {
  const original = adsrPoints({ attack: .02, decay: .4, sustain: .6, release: .8 });
  for (let index = 0; index < 5; index++) for (const extreme of [-1, 2]) {
    const next = SYNTH_ADSR_EDITOR_MODEL.moveNode(original, index, { x: extreme, y: extreme });
    const state = adsrFromPoints(next);
    for (let at = 1; at < 5; at++) assert.ok(state.points[at].time > state.points[at - 1].time);
    assert.ok(state.points.every(point => point.level >= 0 && point.level <= 1));
    assert.deepEqual(adsrPoints(state), next);
  }
});

function element() {
  const listeners = new Map();
  return {
    listeners, children: [], innerHTML: '', className: '',
    append(...children) { this.children.push(...children); },
    remove() { this.removed = true; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
    setPointerCapture() {}, releasePointerCapture() {},
    querySelector(selector) {
      return selector === '[data-editor]' ? {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      } : null;
    },
  };
}

test('editor has five accessible two-axis controls without duplicate parameter fields', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: element };
  try {
    const host = element(), changes = [];
    const editor = createEnvelopeEditor(host, { onChange: value => changes.push(value) });
    const root = host.children[0], graph = root.children[0].children[0];
    assert.equal(root.children.length, 1, 'only the graph is mounted');
    assert.equal((graph.innerHTML.match(/data-node=/g) ?? []).length, 5);
    assert.doesNotMatch(graph.innerHTML, /data-anchor/);
    assert.doesNotMatch(graph.innerHTML, /<input|data-level/);
    const envelope = { attack: .02, decay: .4, sustain: .6, release: .8 };
    editor.setValue(envelope);
    assert.equal(changes.length, 0, 'preset synchronization does not emit an edit');
    graph.listeners.get('pointerdown')({
      target: { closest: () => ({ dataset: { node: '2' } }) },
      pointerId: 4, button: 0, isPrimary: true, clientX: 50, clientY: 40, preventDefault() {},
    });
    assert.equal(changes.length, 0, 'taking hold does not change a legacy envelope or mark its preset custom');
    graph.listeners.get('pointermove')({ pointerId: 4, clientX: 50, clientY: 95 });
    close(changes[0].points[2].level, .05);
    close(changes[0].sustain, envelope.sustain);
    graph.listeners.get('pointercancel')({ pointerId: 4 });
    for (const key of Object.keys(envelope)) close(changes.at(-1)[key], envelope[key]);
    editor.destroy();
    assert.equal(graph.listeners.size, 0);
    assert.equal(root.removed, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('all preset handles remain separated on phone and desktop without changing the curve', () => {
  for (const preset of ENVELOPE_PRESETS) for (const width of [240, 280, 600]) {
    const points = adsrPoints(preset.envelope), before = structuredClone(points);
    const handles = SYNTH_ADSR_EDITOR_MODEL.handlePoints(points, { width });
    assert.deepEqual(points, before);
    for (let index = 0; index < 5; index++) {
      assert.ok(handles[index].x >= 0 && handles[index].x <= 1, preset.id);
      assert.equal(handles[index].y, points[index].y);
      if (index) assert.ok((handles[index].x - handles[index - 1].x) * width >= 35.99, preset.id);
    }
  }
});
