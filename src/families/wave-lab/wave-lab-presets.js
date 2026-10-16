import { registerHeaderPresets } from "../../site/header-presets.js";

/**
 * Shared full-instrument preset adapter for the wave-lab recorders. Banks and
 * parameter maps stay per instrument; recall never reaches the shell, so Audio,
 * transport, the microphone, input sources and recorded takes are untouched.
 */
export function registerWaveLabPresets({ id, presets, capture, apply, randomize, document: doc = globalThis.document }) {
  return registerHeaderPresets({
    id, presets, capture, randomize, document: doc,
    apply: snapshot => { apply(snapshot); },
  });
}

/** Drive a page control through its own listener so its readout and engine message stay in step. */
export function setControlValue(id, value, { type = "input", doc = globalThis.document } = {}) {
  const element = doc.getElementById(id);
  if (!element) throw new Error(`Missing control: ${id}`);
  if (element.type === "checkbox") element.checked = Boolean(value);
  else element.value = String(value);
  element.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true }));
}
