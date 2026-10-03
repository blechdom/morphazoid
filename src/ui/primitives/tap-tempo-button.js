import { createButton } from "./button.js";
import { createTapTempoTracker } from "../../tap-tempo.js";
import { defineApi } from "../internal.js";

/** A native momentary button. Its owner decides what a beat changes. */
export function createTapTempoButton(options = {}, doc = globalThis.document) {
  const runtime = options.runtime ?? doc.defaultView ?? globalThis;
  const tracker = createTapTempoTracker(options);
  let timer = null;
  let destroyed = false;
  let pointerTap = false;
  const button = createButton({ label: "Tap", variant: "mini", ...options,
    onClick: undefined, className: `mz-tap-tempo ${options.className ?? ""}`,
    ariaLabel: options.ariaLabel ?? "Tap tempo", title: options.title ?? "Tap twice or more to set tempo",
  }, doc);
  const tap = timestamp => {
    if (destroyed || button.disabled) return null;
    options.onBeforeTap?.();
    if (button.disabled) return null;
    const bpm = tracker.tap(timestamp, options.getResetAfter?.() ?? options.resetAfter ?? 4000);
    button.classList.add("is-tapped");
    runtime.clearTimeout?.(timer);
    timer = runtime.setTimeout?.(() => { button.classList.remove("is-tapped"); timer = null; }, 120);
    if (bpm !== null) options.onTempo?.(bpm, button);
    return bpm;
  };
  const now = event => Number.isFinite(event?.timeStamp) ? event.timeStamp : runtime.performance.now();
  const pointer = event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    pointerTap = true; tap(now(event));
  };
  const click = event => {
    // Pointer tempo is measured on contact, rather than after releasing the button.
    if (!pointerTap || event.detail === 0) tap(now(event));
    pointerTap = false;
    event.stopPropagation();
  };
  const key = event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.stopPropagation();
    if (event.repeat) event.preventDefault();
  };
  button.addEventListener("pointerdown", pointer);
  button.addEventListener("click", click);
  button.addEventListener("keydown", key);
  const destroyButton = button.destroy;
  return defineApi(button, {
    tap,
    reset() { tracker.reset(); pointerTap = false; },
    destroy() {
      if (destroyed) return;
      destroyed = true; runtime.clearTimeout?.(timer); tracker.reset();
      button.removeEventListener("pointerdown", pointer);
      button.removeEventListener("click", click);
      button.removeEventListener("keydown", key);
      destroyButton();
    },
  });
}
