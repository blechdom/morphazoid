import assert from "node:assert/strict";
import test from "node:test";
import { enhanceRangeKnob } from "../src/ui/primitives/range-knob.js";

class Node extends EventTarget {
  constructor(doc) {
    super(); this.ownerDocument = doc; this.children = []; this.attributes = new Map(); this.classes = new Set();
    this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name),
      toggle: (name, yes) => yes ? this.classes.add(name) : this.classes.delete(name) };
  }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  remove() { this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  focus() { this.ownerDocument.activeElement = this; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
}
function fixture(options = {}, knobOptions = {}) {
  const doc = { defaultView: { Event }, createElement() { return new Node(doc); } };
  const field = doc.createElement(), input = doc.createElement();
  Object.assign(input, { type: "range", id: "original-level", min: "0", max: "0.9", step: "0.01", value: "0.56", disabled: false }, options);
  field.append(input);
  const events = [];
  input.addEventListener("input", event => events.push([event.type, input.value, event.bubbles]));
  input.addEventListener("change", event => events.push([event.type, input.value, event.bubbles]));
  let disconnected = 0;
  const runtime = { MutationObserver: class { observe() {} disconnect() { disconnected++; } } };
  const knob = enhanceRangeKnob(input, { runtime, ...knobOptions });
  const pointer = (type, data = {}) => input.dispatchEvent(Object.assign(new Event(type, { cancelable: true }),
    { pointerId: 1, button: 0, isPrimary: true, clientY: 100, ...data }));
  return { input, field, events, knob, pointer, doc, disconnected: () => disconnected };
}

test("enhancement preserves the actual input, value, bounds, owner events and one focus target", () => {
  const f = fixture();
  assert.equal(f.field.children[0], f.input);
  assert.deepEqual([f.input.id, f.input.min, f.input.max, f.input.step, f.input.value], ["original-level", "0", "0.9", "0.01", "0.56"]);
  assert.deepEqual(f.events, []);
  assert.equal(enhanceRangeKnob(f.input), f.knob);
  assert.equal(f.field.children.length, 2);
  f.pointer("pointerdown");
  assert.equal(f.input.value, "0.56", "taking hold must not jump to an absolute slider position");
  assert.equal(f.doc.activeElement, f.input);
  f.pointer("pointermove", { clientY: 88 });
  assert.equal(f.input.value, "0.65");
  f.pointer("pointerup", { clientY: 88 });
  assert.deepEqual(f.events, [["input", "0.65", true], ["change", "0.65", true]]);
  assert.equal(f.input.capture, null);
  f.knob.destroy();
});

test("fine adjustment, minimum-relative stepping and clamps retain the native range contract", () => {
  const f = fixture({ min: "0.1", max: "1.1", step: "0.05", value: "0.4" });
  f.pointer("pointerdown");
  f.pointer("pointermove", { clientY: 40, shiftKey: true });
  assert.equal(f.input.value, "0.45");
  f.pointer("pointermove", { clientY: -10000 });
  assert.equal(f.input.value, "1.1");
  f.pointer("pointermove", { clientY: 10000 });
  assert.equal(f.input.value, "0.1");
  f.pointer("pointercancel");
  f.pointer("pointermove", { clientY: -10000 });
  assert.equal(f.input.value, "0.1");
  f.knob.destroy();
});

test("secondary pointers, disabled controls and no-movement holds do not emit value changes", () => {
  const f = fixture();
  f.pointer("pointerdown", { button: 2 }); f.pointer("pointermove", { clientY: 10 });
  f.pointer("pointerdown", { isPrimary: false }); f.pointer("pointermove", { clientY: 10 });
  f.input.disabled = true; f.pointer("pointerdown"); f.pointer("pointermove", { clientY: 10 });
  f.input.disabled = false; f.pointer("pointerdown"); f.pointer("pointermove", { pointerId: 2, clientY: 10 }); f.pointer("pointerup");
  assert.equal(f.input.value, "0.56"); assert.deepEqual(f.events, []);
  f.knob.destroy();
});

test("lost capture ends the gesture and teardown removes only the rotary enhancement", () => {
  const f = fixture();
  f.pointer("pointerdown"); f.pointer("pointermove", { clientY: 88 }); f.pointer("lostpointercapture");
  f.pointer("pointermove", { clientY: 0 }); assert.equal(f.input.value, "0.65");
  f.knob.destroy();
  assert.deepEqual(f.field.children, [f.input]); assert.equal(f.disconnected(), 1);
  f.pointer("pointerdown"); f.pointer("pointermove", { clientY: 0 });
  assert.equal(f.input.value, "0.65");
  f.input.value = "0.2"; f.input.dispatchEvent(new Event("input", { bubbles: true }));
  assert.deepEqual(f.events.at(-1), ["input", "0.2", true], "instrument listeners survive teardown");
});

test("canceling a held gesture releases capture without events and the next grab uses the current value", () => {
  const f = fixture();
  f.pointer("pointerdown"); f.pointer("pointermove", { clientY: 88 });
  assert.equal(f.input.value, "0.65");
  assert.equal(f.input.capture, 1);
  const before = [...f.events];
  f.knob.cancelGesture();
  assert.equal(f.input.capture, null);
  assert.equal(f.input.value, "0.65");
  assert.deepEqual(f.events, before, "cancel must not emit a trailing change");
  f.pointer("pointermove", { clientY: 0 }); f.pointer("pointerup");
  assert.equal(f.input.value, "0.65");
  assert.deepEqual(f.events, before, "old pointer events no longer edit the control");
  f.input.value = "0.2";
  f.knob.update();
  f.pointer("pointerdown"); f.pointer("pointermove", { clientY: 88 }); f.pointer("pointerup");
  assert.equal(f.input.value, "0.29", "new gesture starts from the recalled value");
  assert.deepEqual(f.events.slice(before.length), [["input", "0.29", true], ["change", "0.29", true]]);
  f.knob.cancelGesture();
  assert.equal(f.input.capture, null);
  f.knob.destroy();
});

test('circular knobs wrap across the seam and through repeated pointer turns', () => {
  const f = fixture({ min: '0', max: '360', step: '.1', value: '350' }, { wrap: true });
  f.pointer('pointerdown');
  f.pointer('pointermove', { clientY: 90 });
  assert.equal(Number(f.input.value), 20);
  f.pointer('pointermove', { clientY: -150 });
  assert.equal(Number(f.input.value), 20, 'two full turns return to the same angle');
  f.pointer('pointercancel', { clientY: -150 });
  assert.equal(f.input.capture, null);
  f.input.value = '359.9';
  f.input.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowRight', shiftKey: false }));
  assert.equal(Number(f.input.value), 0);
  f.input.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowLeft', shiftKey: false }));
  assert.ok(Math.abs(Number(f.input.value) - 359.9) < 1e-9);
  f.knob.destroy();
});

test('a modulation indicator observes effective values without changing the manual knob or events', () => {
  const f = fixture();
  const marker = f.field.children[1].children[1];
  f.knob.setModulation(.9);
  assert.equal(marker.hidden, false);
  assert.match(marker.attributes.get('style'), /135deg/);
  assert.equal(f.input.value, '0.56');
  assert.deepEqual(f.events, []);
  f.knob.setModulation(null);
  assert.equal(marker.hidden, true);
  f.knob.destroy();
});

test('optional fixed interaction range preserves raw input but bounds pointer motion and display',()=>{
  const f=fixture({min:'-1000',max:'1000',step:'any',value:'500'},{interactionRange:{min:0,max:100}});
  assert.equal(f.input.value,'500');assert.deepEqual(f.events,[]);
  assert.match(f.field.children[1].children[0].attributes.get('style'),/135deg/);
  f.pointer('pointerdown');f.pointer('pointermove',{clientY:100});f.pointer('pointerup');assert.equal(f.input.value,'500');assert.deepEqual(f.events,[]);
  f.pointer('pointerdown');f.pointer('pointermove',{clientY:112});f.pointer('pointerup');assert.equal(f.input.value,'90');
  assert.deepEqual([f.input.min,f.input.max],['-1000','1000']);
  f.knob.setModulation(500);assert.match(f.field.children[1].children[1].attributes.get('style'),/135deg/);
  f.knob.destroy();
});

test('logarithmic enhancement preserves zero, practical and exact maximum values without events', () => {
  for (const value of [0, 1, 4096, Number.MAX_SAFE_INTEGER]) {
    const f = fixture({ min: '0', max: String(Number.MAX_SAFE_INTEGER), step: '1', value: String(value) }, { scale: 'log' });
    const native = [f.input.min, f.input.max, f.input.step, f.input.value];
    f.knob.update();
    f.pointer('pointerdown'); f.pointer('pointermove', { clientY: 100 }); f.pointer('pointerup');
    assert.deepEqual([f.input.min, f.input.max, f.input.step, f.input.value], native);
    assert.deepEqual(f.events, []);
    assert.equal(f.doc.activeElement, f.input);
    const angle = -135 + Math.log1p(value) / Math.log1p(Number.MAX_SAFE_INTEGER) * 270;
    assert.equal(f.field.children[1].children[0].attributes.get('style'), `transform: rotate(${angle}deg)`);
    f.knob.destroy();
  }
});

test('logarithmic pointer motion reaches small counts and the entire maximum without a cap', () => {
  for (const value of [1, 128, 4096, 131070, 16777216, Number.MAX_SAFE_INTEGER]) {
    const f = fixture({ min: '0', max: String(Number.MAX_SAFE_INTEGER), step: '1', value: '0' }, { scale: 'log' });
    f.pointer('pointerdown');
    const clientY = 100 - 120 * (Math.log1p(value) / Math.log1p(Number.MAX_SAFE_INTEGER));
    f.pointer('pointermove', { clientY }); f.pointer('pointerup', { clientY });
    assert.equal(f.input.value, String(value));
    assert.deepEqual(f.events, [['input', String(value), true], ['change', String(value), true]]);
    assert.deepEqual([f.input.min, f.input.max, f.input.step], ['0', String(Number.MAX_SAFE_INTEGER), '1']);
    f.knob.destroy();
  }
});

test('logarithmic fine motion and saturation retain exact endpoints and integer stepping', () => {
  const f = fixture({ min: '0', max: String(Number.MAX_SAFE_INTEGER), step: '1', value: '0' }, { scale: 'log' });
  f.pointer('pointerdown'); f.pointer('pointermove', { clientY: 40, shiftKey: true });
  assert.equal(f.input.value, '5');
  f.pointer('pointermove', { clientY: -10000 }); f.pointer('pointerup', { clientY: -10000 });
  assert.equal(f.input.value, String(Number.MAX_SAFE_INTEGER));
  assert.deepEqual(f.events.at(-1), ['change', String(Number.MAX_SAFE_INTEGER), true]);
  f.pointer('pointerdown'); f.pointer('pointermove', { clientY: 10000 }); f.pointer('pointercancel', { clientY: 10000 });
  assert.equal(f.input.value, '0');
  assert.deepEqual(f.events.at(-1), ['change', '0', true]);
  f.knob.destroy();
});

test('logarithmic needles follow programmatic values, dynamic bounds and effective modulation without events', () => {
  const f = fixture({ min: '0', max: '100', step: '1', value: '1' }, { scale: 'log' });
  f.input.max = String(Number.MAX_SAFE_INTEGER); f.input.value = '131070'; f.knob.update();
  const angle = -135 + Math.log1p(131070) / Math.log1p(Number.MAX_SAFE_INTEGER) * 270;
  assert.equal(f.field.children[1].children[0].attributes.get('style'), `transform: rotate(${angle}deg)`);
  f.input.max = '131070'; f.knob.update();
  assert.match(f.field.children[1].children[0].attributes.get('style'), /135deg/);
  f.knob.setModulation(0);
  assert.match(f.field.children[1].children[1].attributes.get('style'), /-135deg/);
  assert.equal(f.input.value, '131070'); assert.deepEqual(f.events, []);
  const key = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowLeft' });
  f.input.dispatchEvent(key);
  assert.equal(key.defaultPrevented, false, 'ordinary keyboard stepping remains native');
  f.knob.destroy();
});

test('zero-width logarithmic ranges remain finite and do not emit changes', () => {
  const f = fixture({ min: '0', max: '0', step: '1', value: '0' }, { scale: 'log' });
  f.pointer('pointerdown'); f.pointer('pointermove', { clientY: -1000 }); f.pointer('pointerup');
  assert.equal(f.input.value, '0');
  assert.match(f.field.children[1].children[0].attributes.get('style'), /-135deg/);
  assert.deepEqual(f.events, []);
  f.knob.destroy();
});
