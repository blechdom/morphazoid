import { dispatchNativeEvent } from "../internal.js";

const knobs = new WeakMap();

/** Rotary presentation for an existing native range; its owner keeps the value and events. */
export function enhanceRangeKnob(input, { runtime = input.ownerDocument?.defaultView ?? globalThis } = {}) {
  if (knobs.has(input)) return knobs.get(input);
  const field = input.parentNode;
  if (input.type !== "range" || !field) throw new TypeError("A mounted native range is required");
  const doc = input.ownerDocument;
  const dial = doc.createElement("span");
  dial.className = "mz-range-knob__dial";
  dial.setAttribute("aria-hidden", "true");
  const needle = doc.createElement("i");
  dial.append(needle);
  field.append(dial);
  field.classList.add("mz-range-knob");
  const removers = [];
  let drag = null;
  const limits = () => ({
    min: input.min === "" ? 0 : Number(input.min),
    max: input.max === "" ? 100 : Number(input.max),
    step: input.step === "any" ? 0 : Number(input.step) || 1,
  });
  const update = () => {
    const { min, max } = limits();
    const fraction = max > min ? Math.max(0, Math.min(1, (Number(input.value) - min) / (max - min))) : 0;
    needle.setAttribute("style", `transform: rotate(${-135 + fraction * 270}deg)`);
    field.classList.toggle("is-disabled", input.disabled);
  };
  const listen = (node, type, callback, options) => {
    node.addEventListener(type, callback, options);
    removers.push(() => node.removeEventListener(type, callback, options));
  };
  const end = (event, emit = true) => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const previous = drag;
    drag = null;
    if (input.hasPointerCapture?.(previous.id)) input.releasePointerCapture(previous.id);
    if (emit && input.value !== previous.start) dispatchNativeEvent(input, "change", doc);
  };
  listen(input, "pointerdown", event => {
    if (input.disabled || drag || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); // A click takes hold of the knob; it must not jump along a hidden slider.
    input.focus({ preventScroll: true });
    drag = { id: event.pointerId, y: event.clientY, raw: Number(input.value), start: input.value };
    input.setPointerCapture?.(event.pointerId);
  });
  listen(input, "pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (input.disabled) { end(event); return; }
    const { min, max, step } = limits();
    drag.raw = Math.max(min, Math.min(max, drag.raw + (drag.y - event.clientY) * (max - min) / (event.shiftKey ? 1200 : 120)));
    drag.y = event.clientY;
    const value = step ? min + Math.round((drag.raw - min) / step) * step : drag.raw;
    const before = input.value;
    input.value = String(Number(Math.max(min, Math.min(max, value)).toPrecision(12)));
    update();
    if (input.value !== before) dispatchNativeEvent(input, "input", doc);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) listen(input, type, end);
  for (const type of ["input", "change"]) listen(input, type, update);
  // Instrument-owned readouts are updated with programmatic level changes.
  // Observe those and range attributes, without polling or replacing .value.
  const observer = typeof runtime.MutationObserver === "function" ? new runtime.MutationObserver(update) : null;
  observer?.observe(field, { childList: true, characterData: true, subtree: true });
  observer?.observe(input, { attributes: true, attributeFilter: ["value", "min", "max", "step", "disabled"] });
  const controller = {
    update,
    destroy() {
      end(null, false);
      observer?.disconnect();
      for (const remove of removers) remove();
      dial.remove();
      field.classList.remove("mz-range-knob");
      knobs.delete(input);
    },
  };
  knobs.set(input, controller);
  update();
  return controller;
}
