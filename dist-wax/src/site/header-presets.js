import { anchorChoosePickerPanel, createChoosePickerShell } from "../ui/patterns/choose-picker-shell.js";

const registrations = new WeakMap();

/** Read-only diagnostic seam for state-continuity/recall tests. */
export function captureHeaderPresetState(doc = globalThis.document) {
  const controller = registrations.get(doc);
  if (!controller) return null;
  controller.refresh();
  return {
    instrumentId: controller.id, selectedId: controller.selectedId,
    presetCount: controller.bank.length,
    snapshot: JSON.parse(presetStateKey(controller.capture())),
  };
}

/** Stable JSON comparison also rejects non-serializable and non-finite state. */
export function presetStateKey(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(presetStateKey).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${presetStateKey(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Preset state must contain only finite JSON data");
}

export function validateFullPresetBank(presets) {
  if (!Array.isArray(presets) || presets.length < 12) throw new Error("At least 12 full-instrument presets are required");
  const ids = new Set();
  for (const preset of presets) {
    if (!preset?.id || typeof preset.id !== "string" || ids.has(preset.id) || !preset.label) {
      throw new Error("Preset IDs must be nonempty and unique, with readable labels");
    }
    ids.add(preset.id);
    presetStateKey(preset.snapshot);
  }
  if (new Set(presets.map(preset => presetStateKey(preset.snapshot))).size < 12) {
    throw new Error("At least 12 distinct full-instrument states are required");
  }
}

export function presetArrowDirection(event, { withinPicker = false } = {}) {
  if (event.defaultPrevented || event.repeat || event.isComposing
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key] ?? 0;
  if (!direction) return 0;
  const target = event.target;
  if (target?.closest?.("input,select,textarea,[contenteditable]:not([contenteditable='false'])")) return 0;
  if (!withinPicker && target?.closest?.(
    "button,a,summary,canvas,audio,video,[role='grid'],[role='slider'],[role='listbox'],[role='dialog'],[tabindex]:not([tabindex='-1'])",
  )) return 0;
  return direction;
}

/**
 * Register an instrument-owned, synchronous complete-state adapter.
 * Does not own Audio, transport, state schemas, storage or sample buffers.
 * The menu only selects full scenes; its adjacent dice uses an instrument-owned
 * pure randomizer. Local sub-preset editors stay in the page.
 * Call after initialization; registration never applies a preset on page load.
 */
export function registerHeaderPresets({
  id, presets, capture, apply, randomize, random = Math.random,
  document: doc = globalThis.document, runtime = globalThis,
}) {
  validateFullPresetBank(presets);
  if (typeof capture !== "function" || typeof apply !== "function") throw new TypeError("A complete-state capture/apply adapter is required");
  if (typeof randomize !== "function" || typeof random !== "function") throw new TypeError("An instrument-owned preset-parameter randomizer is required");
  const bank = JSON.parse(JSON.stringify(presets));
  presetStateKey(capture());
  registrations.get(doc)?.destroy();
  const controller = { id, bank, capture, apply, randomize, random, runtime, doc, view: null, selectedId: null, hasPresetInteraction: false };
  controller.destroy = () => {
    controller.view?.destroy();
    if (registrations.get(doc) === controller) registrations.delete(doc);
  };
  controller.refresh = () => controller.view?.refresh();
  registrations.set(doc, controller);
  mountHeaderPresets(doc);
  return controller;
}

export function mountHeaderPresets(doc) {
  const controller = registrations.get(doc);
  if (!controller || controller.view) return;
  const meter = doc.querySelector?.(".header-output-meter-shell");
  if (!meter?.parentNode) return;
  const { bank, capture, apply, runtime } = controller;
  const abort = new runtime.AbortController();
  const listen = (node, type, handler, options = {}) => node.addEventListener(type, handler, { ...options, signal: abort.signal });
  const shell = createChoosePickerShell(doc, {
    current: "Select Preset", label: "Choose full-instrument preset", title: "Full-instrument presets",
    panelId: "header-preset-panel", placeholder: "Type a preset", filterLabel: "Filter presets", listLabel: "Full-instrument presets",
  });
  const { details, summary, currentLabel, panel, search, searchInput, list } = shell;
  const root = doc.createElement("div");
  root.className = "header-preset-controls";
  root.dataset.instrumentId = controller.id;
  details.classList.add("header-preset-picker");
  summary.setAttribute("aria-keyshortcuts", "ArrowRight ArrowLeft ArrowDown ArrowUp");
  const next = doc.createElement("button");
  next.type = "button";
  next.className = "instrument-picker-next header-preset-next";
  next.title = "Next full-instrument preset";
  next.setAttribute("aria-label", next.title);
  const arrow = doc.createElement("span");
  arrow.textContent = "▶";
  arrow.setAttribute("aria-hidden", "true");
  next.append(arrow);
  const dice = doc.createElement("button");
  dice.type = "button";
  dice.className = "instrument-picker-next header-preset-random";
  dice.title = "Randomize instrument parameters";
  dice.setAttribute("aria-label", dice.title);
  // Monochrome inline icon, not a platform-dependent colored emoji.
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const outline = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [key, value] of Object.entries({ x: 3, y: 3, width: 18, height: 18, rx: 2, fill: "none", stroke: "currentColor", "stroke-width": 1.6 })) {
    outline.setAttribute(key, String(value));
  }
  svg.append(outline);
  for (const [cx, cy] of [[7.5, 7.5], [16.5, 7.5], [12, 12], [7.5, 16.5], [16.5, 16.5]]) {
    const pip = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
    for (const [key, value] of Object.entries({ cx, cy, r: 1.4, fill: "currentColor" })) pip.setAttribute(key, String(value));
    svg.append(pip);
  }
  dice.append(svg);
  const status = doc.createElement("p");
  status.className = "sr-only";
  status.setAttribute("role", "status");
  root.append(details, next, dice, status);
  const masthead = doc.querySelector(".masthead");
  const midiToolbar = meter.parentNode.querySelector(".midi-toolbar");
  // Retain the original MIDI node, parent, listeners and enabled state.
  // Presets precede MIDI and the meters in visual and keyboard order; without
  // MIDI, presets simply precede the meters.
  const presetAnchor = midiToolbar?.parentNode === meter.parentNode ? midiToolbar : meter;
  const buttons = [];
  const keys = new Map(bank.map(preset => [preset.id, presetStateKey(preset.snapshot)]));
  let applying = false;
  let destroyed = false;
  const refresh = () => {
    if (applying || destroyed) return;
    const key = presetStateKey(capture());
    const selected = controller.hasPresetInteraction
      ? bank.find(preset => preset.id === controller.lastPresetId && keys.get(preset.id) === key)
      : null;
    controller.selectedId = selected?.id ?? null;
    root.dataset.presetId = selected?.id ?? (controller.hasPresetInteraction ? "custom" : "unselected");
    const label = controller.hasPresetInteraction ? selected?.label ?? "Preset · Custom" : "Select Preset";
    if (currentLabel.textContent !== label) currentLabel.textContent = label;
    summary.title = controller.hasPresetInteraction ? selected?.label ?? "Custom instrument settings" : "Select Preset";
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.presetId === selected?.id));
  };
  const transact = (prepare, success, failure, onApplied = () => {}) => {
    if (applying || destroyed) return;
    const previous = JSON.parse(presetStateKey(capture()));
    applying = true;
    let attemptedApply = false;
    try {
      const snapshot = prepare(JSON.parse(presetStateKey(previous)));
      const expected = presetStateKey(snapshot);
      attemptedApply = true;
      apply(JSON.parse(expected));
      // Catch incomplete adapters rather than falsely labelling a half-recall.
      if (presetStateKey(capture()) !== expected) throw new Error("Preset recall did not restore its complete musical state");
      onApplied();
      status.textContent = success;
    } catch (error) {
      if (attemptedApply) {
        try { apply(previous); } catch { /* Report the failed recall without swallowing its cause. */ }
      }
      status.textContent = `${failure}: ${error.message}`;
      runtime.console?.error?.(`${failure} for ${controller.id}`, error);
    } finally {
      applying = false;
      refresh();
    }
  };
  const select = id => {
    const preset = bank.find(item => item.id === id);
    if (preset) transact(() => preset.snapshot, `${preset.label} loaded`, "Preset not loaded",
      () => { controller.lastPresetId = id; controller.hasPresetInteraction = true; });
  };
  const randomize = () => transact(previous => {
    const result = controller.randomize(previous, controller.random);
    const key = presetStateKey(result);
    if (key === presetStateKey(capture()) || [...keys.values()].includes(key)) {
      throw new Error("Randomization must create new parameter settings, not select an existing preset");
    }
    return result;
  }, "Instrument parameters randomized. Custom settings.", "Parameters not randomized",
  () => { controller.hasPresetInteraction = true; });
  const cycle = direction => {
    refresh();
    // Generative scores and manual edits legitimately become Custom. Keep the
    // tour's place so the next arrow does not repeatedly return to preset one.
    const index = bank.findIndex(item => item.id === (controller.selectedId ?? controller.lastPresetId));
    const nextIndex = index < 0 ? (direction > 0 ? 0 : bank.length - 1) : (index + direction + bank.length) % bank.length;
    select(bank[nextIndex].id);
  };
  for (const preset of bank) {
    const row = doc.createElement("div");
    row.className = "instrument-picker-row";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "instrument-picker-link";
    button.dataset.presetId = preset.id;
    button.dataset.fullPreset = "";
    button.textContent = preset.label;
    button.title = preset.description ?? preset.label;
    button.setAttribute("aria-pressed", "false");
    listen(button, "click", () => { select(preset.id); details.open = false; summary.focus(); });
    row.append(button); list.append(row); buttons.push(button);
  }
  const empty = doc.createElement("p");
  empty.className = "instrument-picker-empty";
  empty.textContent = "No presets found";
  empty.hidden = true;
  list.append(empty);
  const filter = () => {
    const query = searchInput.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const button of buttons) {
      const visible = !query || `${button.textContent} ${button.title}`.toLocaleLowerCase().includes(query);
      button.parentNode.hidden = !visible;
      if (visible) count++;
    }
    empty.hidden = count > 0;
  };
  listen(searchInput, "input", filter);
  listen(next, "click", () => cycle(1));
  listen(dice, "click", () => { randomize(); details.open = false; });
  listen(details, "toggle", () => {
    if (!details.open && searchInput.value) { searchInput.value = ""; filter(); }
  });
  listen(doc, "pointerdown", event => { if (details.open && !root.contains(event.target)) details.open = false; });
  listen(root, "keydown", event => {
    // Do not let legacy performance shortcuts turn a header key into a note.
    event.stopPropagation();
    if (event.key === "Escape" && details.open) {
      event.preventDefault();
      if (searchInput.value) { searchInput.value = ""; filter(); searchInput.focus(); }
      else { details.open = false; summary.focus(); }
    }
  });
  listen(doc, "keydown", event => {
    const direction = presetArrowDirection(event, { withinPicker: event.target === summary || event.target === next || event.target === dice });
    if (!direction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cycle(direction);
  }, { capture: true });
  for (const type of ["input", "change", "click", "pointerup", "keyup"]) {
    listen(doc, type, () => runtime.queueMicrotask(refresh));
  }
  panel.append(search, list);
  details.append(summary, panel);
  presetAnchor.before(root);
  masthead?.classList.add("has-header-presets");
  const anchoredPanel = anchorChoosePickerPanel(shell, runtime);
  controller.view = {
    refresh, select, randomize,
    destroy() {
      destroyed = true;
      abort.abort();
      anchoredPanel.destroy();
      root.remove();
      masthead?.classList.remove("has-header-presets");
    },
  };
  listen(runtime, "pagehide", event => { if (!event.persisted) controller.destroy(); });
  refresh();
}
