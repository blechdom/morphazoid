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
function fixture(options = {}) {
  const doc = { defaultView: { Event }, createElement() { return new Node(doc); } };
  const field = doc.createElement(), input = doc.createElement();
  Object.assign(input, { type: "range", id: "original-level", min: "0", max: "0.9", step: "0.01", value: "0.56", disabled: false }, options);
  field.append(input);
  const events = [];
  input.addEventListener("input", event => events.push([event.type, input.value, event.bubbles]));
  input.addEventListener("change", event => events.push([event.type, input.value, event.bubbles]));
  let disconnected = 0;
  const runtime = { MutationObserver: class { observe() {} disconnect() { disconnected++; } } };
  const knob = enhanceRangeKnob(input, { runtime });
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
