import { dispatchNativeEvent } from "../internal.js";

const knobs = new WeakMap();

/** Rotary presentation for an existing native range; its owner keeps the value and events. */
export function enhanceRangeKnob(input, { runtime = input.ownerDocument?.defaultView ?? globalThis, wrap = false, interactionRange = null, scale = "linear" } = {}) {
  if (knobs.has(input)) return knobs.get(input);
  const field = input.parentNode;
  if (input.type !== "range" || !field) throw new TypeError("A mounted native range is required");
  if (!["linear", "log"].includes(scale)) throw new TypeError("A knob scale must be linear or log");
  const logarithmic = scale === "log";
  // Some owners retain exact values beyond the normal dial span. This optional
  // fixed range controls gestures and the needle without changing their input.
  const fixedRange = interactionRange === null ? null : {
    min: Number(interactionRange.min), max: Number(interactionRange.max),
  };
  if (fixedRange && (!Number.isFinite(fixedRange.min) || !Number.isFinite(fixedRange.max) || fixedRange.max < fixedRange.min)) {
    throw new TypeError("A knob interaction range needs finite ordered bounds");
  }
  const doc = input.ownerDocument;
  const dial = doc.createElement("span");
  dial.className = "mz-range-knob__dial";
  dial.setAttribute("aria-hidden", "true");
  const needle = doc.createElement("i");
  dial.append(needle);
  const modulationNeedle = doc.createElement("b");
  modulationNeedle.className = "mz-range-knob__modulation";
  modulationNeedle.hidden = true;
  dial.append(modulationNeedle);
  field.append(dial);
  field.classList.add("mz-range-knob");
  const removers = [];
  let drag = null;
  const limits = () => ({
    min: fixedRange?.min ?? (input.min === "" ? 0 : Number(input.min)),
    max: fixedRange?.max ?? (input.max === "" ? 100 : Number(input.max)),
    step: input.step === "any" ? 0 : Number(input.step) || 1,
  });
  const wrapped = (value, min, max) => max > min ? min + ((value - min) % (max - min) + max - min) % (max - min) : min;
  // log1p keeps zero in the complete native range, including very large counts.
  // Scaling changes gestures and presentation only; the owner retains its bounds.
  const fractionFromValue = (value, min, max) => max > min
    ? Math.max(0, Math.min(1, logarithmic
      ? Math.log1p(Math.max(0, value - min)) / Math.log1p(max - min)
      : (value - min) / (max - min))) : 0;
  const valueFromFraction = (fraction, min, max) => {
    if (fraction <= 0 || max <= min) return min;
    if (fraction >= 1) return max;
    return Math.max(min, Math.min(max, min + Math.expm1(fraction * Math.log1p(max - min))));
  };
  const update = () => {
    const { min, max } = limits();
    const fraction = fractionFromValue(Number(input.value), min, max);
    needle.setAttribute("style", `transform: rotate(${wrap ? fraction * 360 : -135 + fraction * 270}deg)`);
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
    const value = Number(input.value);
    // Merely taking hold must preserve an exact value outside the normal span.
    // The first vertical movement begins at its nearest normal endpoint.
    const raw = fixedRange ? Math.max(fixedRange.min, Math.min(fixedRange.max, value)) : value;
    drag = { id: event.pointerId, y: event.clientY, raw, start: input.value };
    if (logarithmic) { const { min, max } = limits(); drag.fraction = fractionFromValue(raw, min, max); }
    input.setPointerCapture?.(event.pointerId);
  });
  listen(input, "pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (input.disabled) { end(event); return; }
    if (event.clientY === drag.y) return;
    const { min, max, step } = limits();
    if (logarithmic) {
      const next = drag.fraction + (drag.y - event.clientY) / (event.shiftKey ? 1200 : 120);
      drag.fraction = wrap ? next : Math.max(0, Math.min(1, next));
      drag.raw = valueFromFraction(wrap ? wrapped(drag.fraction, 0, 1) : drag.fraction, min, max);
    } else {
      const next = drag.raw + (drag.y - event.clientY) * (max - min) / (event.shiftKey ? 1200 : 120);
      drag.raw = wrap ? next : Math.max(min, Math.min(max, next));
    }
    drag.y = event.clientY;
    const value = step ? min + Math.round((drag.raw - min) / step) * step : drag.raw;
    const before = input.value;
    const bounded = wrap ? wrapped(value, min, max) : Math.max(min, Math.min(max, value));
    // Preserve exact integer endpoints such as Number.MAX_SAFE_INTEGER in log mode.
    input.value = String(logarithmic ? bounded : Number(bounded.toPrecision(12)));
    update();
    if (input.value !== before) dispatchNativeEvent(input, "input", doc);
  });
  if (wrap) listen(input, "keydown", event => {
    const directions = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    if (!(event.key in directions) || input.disabled) return;
    event.preventDefault();
    const { min, max, step } = limits();
    input.value = String(wrapped(Number(input.value) + directions[event.key] * (step || 1) * (event.shiftKey ? 10 : 1), min, max));
    update(); dispatchNativeEvent(input, "input", doc); dispatchNativeEvent(input, "change", doc);
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
    cancelGesture() { end(null, false); },
    setModulation(value) {
      modulationNeedle.hidden = !Number.isFinite(value);
      if (!Number.isFinite(value)) return;
      const { min, max } = limits();
      const fraction = fractionFromValue(value, min, max);
      modulationNeedle.setAttribute("style", `transform: rotate(${wrap ? fraction * 360 : -135 + fraction * 270}deg)`);
    },
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
