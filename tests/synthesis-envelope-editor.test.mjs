import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTH_ADSR_EDITOR_MODEL,
  adsrFromPoints,
  adsrPoints,
  createEnvelopeEditor,
} from '../src/instruments/synthesis/envelope.js';

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

test('ADSR graph keeps T fixed and gives each time its own log lane', () => {
  const original = adsrPoints({ attack: .02, decay: .4, sustain: .6, release: .8 });
  assert.deepEqual(SYNTH_ADSR_EDITOR_MODEL.fixedNodes, [0]);
  const fixedMove = SYNTH_ADSR_EDITOR_MODEL.moveNode(original, 0, { x: 1, y: 1 });
  assert.equal(fixedMove.length, original.length);
  for (const [index, point] of fixedMove.entries()) {
    close(point.x, original[index].x);
    close(point.y, original[index].y);
  }

  const decay = SYNTH_ADSR_EDITOR_MODEL.moveNode(original, 2, { x: .5, y: .23 });
  close(decay[2].y, .6); close(decay[3].y, .6);
  const sustain = SYNTH_ADSR_EDITOR_MODEL.moveNode(decay, 3, { x: 0, y: .91 });
  close(sustain[2].y, .91); close(sustain[3].y, .91);

  const short = adsrPoints({ attack: .001, decay: .002, sustain: .5, release: .003 });
  const long = adsrPoints({ attack: 12, decay: 12, sustain: .5, release: 16 });
  assert.ok(short[1].x < long[1].x);
  assert.ok(short[2].x < long[2].x);
  assert.ok(short[4].x < long[4].x);
});

test('each ADSR handle changes only its own parameter, including off-axis drags', () => {
  const envelope = { attack: .02, decay: .4, sustain: .6, release: .8 };
  const original = adsrPoints(envelope);
  for (const [index, key] of ['attack', 'decay', 'sustain', 'release'].entries()) {
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }]) {
      const next = adsrFromPoints(SYNTH_ADSR_EDITOR_MODEL.moveNode(original, index + 1, point));
      assert.notEqual(next[key], envelope[key], `${key} changes at its extrema`);
      for (const other of Object.keys(envelope).filter(candidate => candidate !== key)) {
        close(next[other], envelope[other]);
      }
    }
    const aria = SYNTH_ADSR_EDITOR_MODEL.nodeAria(original, index + 1);
    close(aria.value, envelope[key]);
    assert.equal(aria.orientation, key === 'sustain' ? 'vertical' : 'horizontal');
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

test('editor has four accessible graphic controls without duplicate parameter fields', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: element };
  try {
    const host = element(), changes = [];
    const editor = createEnvelopeEditor(host, { onChange: value => changes.push(value) });
    const root = host.children[0], graph = root.children[0].children[0];
    assert.equal(root.children.length, 1, 'only the graph is mounted');
    assert.equal((graph.innerHTML.match(/role="slider"/g) ?? []).length, 4);
    assert.doesNotMatch(graph.innerHTML, /<input|data-level/);
    const envelope = { attack: .02, decay: .4, sustain: .6, release: .8 };
    editor.setValue(envelope);
    assert.equal(changes.length, 0, 'preset synchronization does not emit an edit');
    graph.listeners.get('pointerdown')({
      target: { closest: () => ({ dataset: { node: '2' } }) },
      pointerId: 4, button: 0, isPrimary: true, clientX: 50, clientY: 95, preventDefault() {},
    });
    assert.ok(changes[0].decay > envelope.decay);
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
