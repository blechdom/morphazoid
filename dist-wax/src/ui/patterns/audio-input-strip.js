import { defineApi, dispatchNativeEvent, nextId, requireDocument } from "../internal.js";
import { enhanceRangeKnob } from "../primitives/range-knob.js";
import { createStereoMeter } from "./level-meter.js";

const MIC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4"/><path d="m10 11 5 3-5 3z"/></svg>';

/** Compact input UI. Capture, gain routing and audio state remain outside UI. */
export function createAudioInputStrip(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const root = doc.createElement("div");
  root.className = "mz-audio-input-strip";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Audio input");

  const button = options.button ?? doc.createElement("button");
  button.type = "button";
  button.classList.remove("audio-button", "audio-toggle");
  button.classList.add("mz-input-toggle");
  const icon = doc.createElement("span");
  icon.className = "mz-input-toggle__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = MIC_ICON;
  // Preserve old labels/IDs for the instrument's own paint functions.
  const keepIcon = () => {
    for (const child of Array.from(button.childNodes)) {
      if (child.nodeType === 3 && child.textContent.trim()) {
        const label = doc.createElement("span");
        label.textContent = child.textContent;
        button.replaceChild(label, child);
      }
    }
    if (icon.parentNode !== button) button.append(icon);
  };
  button.append(icon);
  keepIcon();

  const meter = createStereoMeter({ ariaLabel: "Audio input levels", active: false }, doc);
  meter.classList.add("mz-input-meter");
  meter.classList.remove("header-output-meter-shell");
  for (const element of [meter.leftMeter, meter.rightMeter]) element.classList.remove("header-output-meter");
  meter.leftMeter.setAttribute("aria-label", "Left audio input level");
  meter.rightMeter.setAttribute("aria-label", "Right audio input level");

  const gainInput = options.gainInput ?? doc.createElement("input");
  const adoptedGain = Boolean(options.gainInput);
  if (adoptedGain && gainInput.parentNode?.classList.contains("mz-range-knob")) enhanceRangeKnob(gainInput).destroy();
  gainInput.type = "range";
  if (!gainInput.id) gainInput.id = options.gainId ?? nextId("mz-input-gain", doc);
  if (!adoptedGain) {
    gainInput.min = String(options.gainMin ?? 0);
    gainInput.max = String(options.gainMax ?? 4);
    gainInput.step = String(options.gainStep ?? 0.01);
    gainInput.value = String(options.gainValue ?? 1);
  }
  gainInput.setAttribute("aria-label", "Input gain");
  const gainField = doc.createElement("label");
  gainField.className = "mz-input-gain";
  gainField.htmlFor = gainInput.id;
  gainField.title = "Input gain";
  const gainHeading = doc.createElement("span");
  const gainLabel = doc.createElement("b");
  gainLabel.textContent = "Gain";
  const gainOutput = options.gainOutput ?? doc.createElement("output");
  gainOutput.setAttribute("for", gainInput.id);
  gainHeading.append(gainLabel, gainOutput);
  gainField.append(gainHeading, gainInput);
  const knob = enhanceRangeKnob(gainInput);
  const paintGain = () => {
    const value = Number(gainInput.value);
    if (options.gainFormat || !options.gainOutput) {
      const text = options.gainFormat?.(value) ?? `${Number(value.toFixed(2))}×`;
      gainOutput.value = String(text);
      gainOutput.textContent = String(text);
    }
    knob.update();
    return value;
  };
  gainInput.addEventListener("input", paintGain);
  gainInput.addEventListener("change", paintGain);
  root.append(gainField, meter, button);

  let sourceSelect = options.sourceSelect ?? null;
  if (!sourceSelect && options.sources?.length) {
    sourceSelect = doc.createElement("select");
    for (const source of options.sources) {
      const option = doc.createElement("option");
      option.value = String(source.value);
      option.textContent = String(source.label);
      sourceSelect.append(option);
    }
    sourceSelect.value = String(options.sourceValue ?? options.sources[0].value);
  }
  if (sourceSelect) {
    sourceSelect.classList.add("mz-input-source");
    sourceSelect.setAttribute("aria-label", "Input source");
    root.append(sourceSelect);
  }
  const fileInput = options.fileInput ?? null;
  let fileButton = null;
  const chooseFile = () => fileInput?.click();
  if (fileInput) {
    fileInput.hidden = true;
    root.append(fileInput);
    fileButton = doc.createElement("button");
    fileButton.type = "button";
    fileButton.className = "mz-input-file";
    fileButton.setAttribute("aria-label", "Choose audio file");
    fileButton.title = "Choose audio file";
    fileButton.textContent = "↥";
    fileButton.addEventListener("click", chooseFile);
    root.append(fileButton);
  }
  const error = doc.createElement("div");
  error.className = "mz-input-error";
  error.setAttribute("role", "group");
  error.setAttribute("aria-label", "Input error");
  error.hidden = true;
  const errorMessage = doc.createElement("span");
  errorMessage.setAttribute("role", "alert");
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.className = "mz-input-error__retry";
  retry.textContent = "Retry";
  retry.setAttribute("aria-label", "Retry audio input");
  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.className = "mz-input-error__dismiss";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", "Dismiss input error");
  error.append(errorMessage, retry, dismiss);
  root.append(error);
  const runtime = options.runtime ?? doc.defaultView ?? globalThis;
  const topLayer = typeof error.showPopover === "function";
  if (topLayer) error.setAttribute("popover", "manual");
  let lastError = "";
  const placeError = () => {
    if (error.hidden || !button.getBoundingClientRect) return;
    const viewport = runtime.visualViewport;
    const width = viewport?.width ?? (doc.documentElement?.clientWidth || runtime.innerWidth || 390);
    const height = viewport?.height ?? (doc.documentElement?.clientHeight || runtime.innerHeight || 844);
    const x = viewport?.offsetLeft ?? 0;
    const y = viewport?.offsetTop ?? 0;
    error.style.maxWidth = `${Math.min(280, Math.max(0, width - 16))}px`;
    error.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const anchor = button.getBoundingClientRect();
    const box = error.getBoundingClientRect();
    const left = Math.max(x + 8, Math.min(anchor.right - box.width, x + width - 8 - box.width));
    const below = anchor.bottom + 6;
    const above = anchor.top - 6 - box.height;
    const top = below + box.height > y + height - 8 && above >= y + 8 ? above : below;
    error.style.left = `${left}px`;
    error.style.top = `${Math.max(y + 8, Math.min(top, y + height - 8 - box.height))}px`;
  };
  const dismissError = (restoreFocus = false) => {
    if (topLayer && error.matches(":popover-open")) error.hidePopover();
    error.hidden = true;
    if (restoreFocus) button.focus?.({ preventScroll: true });
  };
  const retryError = () => {
    dismissError(true);
    lastError = "";
    button.click();
  };
  const closeError = () => dismissError(true);
  const outsideError = (event) => {
    if (!error.hidden && !error.contains(event.target) && !button.contains(event.target)) dismissError();
  };
  const escapeError = (event) => {
    if (event.key === "Escape" && !error.hidden) dismissError(error.contains(doc.activeElement));
  };
  const scrollError = (event) => { if (!error.contains(event.target)) placeError(); };
  retry.addEventListener("click", retryError);
  dismiss.addEventListener("click", closeError);
  doc.addEventListener?.("pointerdown", outsideError);
  doc.addEventListener?.("keydown", escapeError);
  doc.addEventListener?.("scroll", scrollError, { capture: true, passive: true });
  runtime.addEventListener?.("resize", placeError);
  runtime.visualViewport?.addEventListener("resize", placeError);
  runtime.visualViewport?.addEventListener("scroll", placeError);
  const popupObserver = typeof runtime.ResizeObserver === "function" ? new runtime.ResizeObserver(placeError) : null;
  popupObserver?.observe(button);
  let source = String(options.sourceValue ?? sourceSelect?.value ?? "mic");
  let paintedSource = "";

  const setSource = (value) => {
    source = String(value ?? "mic");
    const file = /file|upload/i.test(source);
    const nextIcon = file ? "file" : "mic";
    if (paintedSource !== nextIcon) { icon.innerHTML = file ? FILE_ICON : MIC_ICON; paintedSource = nextIcon; }
    root.setAttribute("data-input-source", file ? "file" : "mic");
    if (sourceSelect && options.sources) sourceSelect.value = source;
    if (fileButton) fileButton.hidden = !file;
  };
  const setInputState = ({ active = false, pending = false, supported = true } = {}) => {
    keepIcon();
    const file = /file|upload/i.test(source);
    const name = file ? "file input" : "microphone input";
    button.disabled = !supported;
    retry.disabled = !supported;
    button.setAttribute("aria-pressed", String(Boolean(active)));
    button.setAttribute("aria-busy", String(Boolean(pending)));
    button.setAttribute("data-input-state", pending ? "starting" : active ? "on" : "off");
    const label = !supported ? "Input is unavailable in this mode" : pending ? `Cancel ${name} request` : `${active ? "Deactivate" : "Activate"} ${name}`;
    button.setAttribute("aria-label", label);
    button.title = label;
    meter.setActive(active);
    if (!active) meter.setLevels(0, 0);
  };
  const setChannels = (count) => {
    const channels = Number(count) === 2 ? 2 : 1;
    meter.setAttribute("data-channels", String(channels));
    meter.rightChannel.hidden = channels !== 2;
    meter.leftLabel.textContent = channels === 2 ? "L" : "IN";
    meter.leftMeter.setAttribute("aria-label", channels === 2 ? "Left audio input level" : "Mono audio input level");
    meter.setAttribute("aria-label", channels === 2 ? "Stereo audio input levels" : "Mono audio input level");
  };
  const setError = (message) => {
    const full = String(message ?? "");
    // A dismissed error stays dismissed while the controller refreshes meters.
    if (full === lastError) return;
    lastError = full;
    if (!full) { dismissError(); errorMessage.textContent = ""; return; }
    errorMessage.textContent = /denied|blocked|notallowed/i.test(full) ? "Mic blocked" : "Input unavailable";
    error.title = full;
    // Mount outside the strip so errors cannot resize or clip its controls.
    if (doc.body && error.parentNode !== doc.body) doc.body.append(error);
    error.hidden = false;
    if (topLayer && !error.matches(":popover-open")) error.showPopover();
    placeError();
  };
  const fileChange = () => setError("");
  fileInput?.addEventListener("change", fileChange);
  paintGain();
  setChannels(options.channels ?? 1);
  setSource(source);
  setInputState();
  defineApi(root, {
    button, meter, gainInput, gainOutput, gainField, sourceSelect, fileInput, errorPopup: error,
    setInputState, setChannels, setSource, setError,
    repositionError: placeError,
    setLevels: meter.setLevels,
    setGain(value, { emit = false } = {}) {
      gainInput.value = String(value);
      paintGain();
      if (emit) dispatchNativeEvent(gainInput, "input", doc);
    },
    destroy() {
      dismissError();
      popupObserver?.disconnect();
      retry.removeEventListener("click", retryError);
      dismiss.removeEventListener("click", closeError);
      doc.removeEventListener?.("pointerdown", outsideError);
      doc.removeEventListener?.("keydown", escapeError);
      doc.removeEventListener?.("scroll", scrollError, { capture: true });
      runtime.removeEventListener?.("resize", placeError);
      runtime.visualViewport?.removeEventListener("resize", placeError);
      runtime.visualViewport?.removeEventListener("scroll", placeError);
      error.remove();
      knob.destroy();
      gainInput.removeEventListener("input", paintGain);
      gainInput.removeEventListener("change", paintGain);
      fileButton?.removeEventListener("click", chooseFile);
      fileInput?.removeEventListener("change", fileChange);
    },
  });
  return root;
}
