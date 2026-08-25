import {
  COMBO_GEOMETRIES,
  COMBO_NATIVE_INSTRUMENTS,
  comboInstrumentFor,
  sanitizeComboFocus,
} from "./src/combo-host.js";
import { SHAPES_BRIDGE_PROPERTY } from "./src/shapes-native-bridge.js";

const STORAGE_KEY = "morphazoid:combo:native-focus:v1";
const rack = document.getElementById("comboRack");
const shell = document.getElementById("nativeInstrumentShell");
const loading = document.getElementById("nativeLoading");
const focusTitle = document.getElementById("focusTitle");
const liveStatus = document.getElementById("liveStatus");
const frames = new Map();
const nativePluginLayouts = new WeakMap();
const nativeRouteToolbars = new WeakMap();
const frameReadyWaiters = new WeakMap();
const frameReadinessPolls = new WeakMap();
const frameTransitionOwners = new WeakMap();
const sharedInstrumentState = {};
const dimensionInstrumentState = {};
const HANDOFF_MILLISECONDS = 90;
const BRIDGE_WAIT_MILLISECONDS = 2_000;
const CONTROL_BANKS = Object.freeze(["play", "form", "rotation", "mapping"]);
const CONTROL_BANK_LABELS = Object.freeze({
  play: "Main",
  form: "Form",
  rotation: "Rotation",
  mapping: "Mapping",
});
let transitionSerial = 0;
let sharedStateCapturedAt = 0;
let activeControlBank = "play";
let localTopologyGeometry = null;

function readStoredInstrument() {
  try {
    return sanitizeComboFocus(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return COMBO_NATIVE_INSTRUMENTS["shape-synth"];
  }
}

function persistInstrument(instrument) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      geometry: instrument.geometry,
      sound: instrument.sound,
    }));
  } catch {
    // Device-local focus persistence is optional.
  }
}

function routeFromLocation() {
  const parameters = new URLSearchParams(window.location.search);
  if (!parameters.has("geometry") && !parameters.has("sound")) return null;
  return comboInstrumentFor(parameters.get("geometry"), parameters.get("sound"));
}

let activeInstrument = routeFromLocation() ?? readStoredInstrument();

function instrumentFrame(instrument) {
  const existing = frames.get(instrument.id);
  if (existing) return existing;

  const frame = document.createElement("iframe");
  frame.title = instrument.title;
  frame.allow = "autoplay; microphone; midi";
  frame.loading = "eager";
  frame.dataset.instrument = instrument.id;
  frame.hidden = true;
  frame.addEventListener("load", () => enhanceNativeFrame(frame, instrument));
  frame.src = `${instrument.href}?combo-embed=1`;
  frames.set(instrument.id, frame);
  shell.append(frame);
  watchNativeFrameReadiness(frame, instrument);
  return frame;
}

function finishFrameEnhancement(frame, instrument, label, enhance) {
  try {
    enhance();
  } catch (error) {
    console.warn(`Shapes could not install ${label} for ${instrument.title}`, error);
  }
}

function finishFrameLoad(frame, instrument) {
  if (frame.dataset.ready === "true") return;
  try {
    finishFrameEnhancement(frame, instrument, "shared form controls", () => {
      installSharedProfileControls(frame, instrument);
    });
    finishFrameEnhancement(frame, instrument, "canonical control banks", () => {
      normalizeNativeControlBanks(frame, instrument);
    });
    finishFrameEnhancement(frame, instrument, "top-bar controls", () => {
      installNativeRouteToolbar(frame, instrument);
    });
    finishFrameEnhancement(frame, instrument, "plugin control banks", () => {
      installNativePluginLayout(frame, instrument);
    });
    finishFrameEnhancement(frame, instrument, "control mirrors", () => {
      bindNativeControlMirrors(frame, instrument);
    });
    finishFrameEnhancement(frame, instrument, "initial control state", () => {
      syncNativeControls(frame, instrument);
    });
  } finally {
    frame.dataset.ready = "true";
    clearTimeout(frameReadinessPolls.get(frame));
    frameReadinessPolls.delete(frame);
    for (const resolve of frameReadyWaiters.get(frame) ?? []) resolve(frame);
    frameReadyWaiters.delete(frame);
  }
  if (instrument.id !== activeInstrument.id) return;
  shell.classList.remove("is-loading");
  shell.removeAttribute("aria-busy");
  loading.textContent = "";
  liveStatus.textContent = `${instrument.title} loaded from ${instrument.href}`;
}

function enhanceNativeFrame(frame, instrument) {
  const nativeDocument = frame.contentDocument;
  if (!nativeDocument?.documentElement || !nativeDocument.body) {
    return;
  }

  nativeDocument.documentElement.classList.add("combo-native-embed");
  nativeDocument.body.classList.add("combo-native-embed");
  const existing = nativeDocument.querySelector('link[data-combo-embed-style]');
  if (existing) {
    finishFrameLoad(frame, instrument);
    return;
  }

  const stylesheet = nativeDocument.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("combo-embed.css", window.location.href).href;
  stylesheet.dataset.comboEmbedStyle = "";
  const refit = () => fitNativePluginPanel(frame);
  stylesheet.addEventListener("load", refit, { once: true });
  stylesheet.addEventListener("error", refit, { once: true });
  nativeDocument.head.append(stylesheet);
  // The native bridge and controls are usable before unrelated picker images
  // finish loading. CSS may settle a frame later; the resize/refit path handles it.
  finishFrameLoad(frame, instrument);
}

function nativeBridge(frame) {
  return frame?.contentWindow?.[SHAPES_BRIDGE_PROPERTY] ?? null;
}

function frameHasExpectedDocument(frame, instrument) {
  const nativeDocument = frame?.contentDocument;
  if (!nativeDocument?.documentElement || !nativeDocument.body) return false;
  try {
    const expected = new URL(instrument.href, window.location.href);
    const actual = new URL(nativeDocument.URL);
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function watchNativeFrameReadiness(frame, instrument) {
  if (!frame || frame.dataset.ready === "true" || frameReadinessPolls.has(frame)) return;
  const poll = () => {
    frameReadinessPolls.delete(frame);
    if (frame.dataset.ready === "true") return;
    if (frameHasExpectedDocument(frame, instrument) && nativeBridge(frame)) {
      enhanceNativeFrame(frame, instrument);
      if (frame.dataset.ready === "true") return;
    }
    frameReadinessPolls.set(frame, setTimeout(poll, 24));
  };
  frameReadinessPolls.set(frame, setTimeout(poll, 0));
}

function silenceFrame(frame) {
  const bridge = nativeBridge(frame);
  if (bridge) {
    bridge.disableAudio();
    return;
  }
  const audioButton = frame?.contentDocument?.getElementById("audioButton");
  if (audioButton?.getAttribute("aria-pressed") === "true") audioButton.click();
}

function whenFrameReady(frame) {
  if (frame?.dataset.ready === "true") return Promise.resolve(frame);
  return new Promise((resolve) => {
    const waiters = frameReadyWaiters.get(frame) ?? [];
    waiters.push(resolve);
    frameReadyWaiters.set(frame, waiters);
  });
}

function whenNativeBridgeReady(frame, timeoutMilliseconds = BRIDGE_WAIT_MILLISECONDS) {
  const readyBridge = nativeBridge(frame);
  if (readyBridge) return Promise.resolve(readyBridge);
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const poll = () => {
      const bridge = nativeBridge(frame);
      if (bridge || performance.now() - startedAt >= timeoutMilliseconds) {
        resolve(bridge);
        return;
      }
      setTimeout(poll, 24);
    };
    poll();
  });
}

function cloneStateValue(value) {
  if (Array.isArray(value)) return value.map(cloneStateValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneStateValue(nested)]));
  }
  return value;
}

function mergeSharedState(snapshot = {}, geometry = activeInstrument.geometry) {
  for (const key of ["playback", "audio", "topology", "synth", "drums"]) {
    if (!snapshot[key] || typeof snapshot[key] !== "object") continue;
    if (key === "topology") {
      if (snapshot.topology.lift === "local") localTopologyGeometry = geometry;
      else if (localTopologyGeometry && localTopologyGeometry !== geometry) continue;
      else localTopologyGeometry = null;
    }
    sharedInstrumentState[key] = {
      ...(sharedInstrumentState[key] ?? {}),
      ...cloneStateValue(snapshot[key]),
    };
  }
  if (snapshot.dimension && typeof snapshot.dimension === "object") {
    dimensionInstrumentState[geometry] = {
      ...(dimensionInstrumentState[geometry] ?? {}),
      ...cloneStateValue(snapshot.dimension),
    };
  }
  sharedStateCapturedAt = performance.now();
}

function captureTopologyIntent(frame, instrument) {
  const snapshot = nativeBridge(frame)?.captureState?.();
  if (!snapshot?.topology) return;
  localTopologyGeometry = snapshot.topology.lift === "local" ? instrument.geometry : null;
  sharedInstrumentState.topology = cloneStateValue(snapshot.topology);
  if (snapshot.dimension && typeof snapshot.dimension === "object") {
    dimensionInstrumentState[instrument.geometry] = cloneStateValue(snapshot.dimension);
  }
}

function stateForHandoff(targetGeometry = activeInstrument.geometry) {
  const snapshot = Object.fromEntries(Object.entries(sharedInstrumentState).map(([key, value]) => (
    [key, cloneStateValue(value)]
  )));
  if (dimensionInstrumentState[targetGeometry]) {
    snapshot.dimension = cloneStateValue(dimensionInstrumentState[targetGeometry]);
  }
  const playback = snapshot.playback;
  if (!playback?.playing || !Number.isFinite(playback.continuousPosition)) return snapshot;
  const elapsed = Math.max(0, performance.now() - sharedStateCapturedAt) / 1000;
  playback.continuousPosition += (playback.direction < 0 ? -1 : 1)
    * Math.max(0, Number(playback.speed) || 0)
    * elapsed;
  playback.position = ((playback.continuousPosition % 1) + 1) % 1;
  return snapshot;
}

function waitForVisualFrame(frame) {
  return new Promise((resolve) => {
    const nativeWindow = frame?.contentWindow;
    if (!nativeWindow?.requestAnimationFrame) {
      resolve();
      return;
    }
    nativeWindow.requestAnimationFrame(() => nativeWindow.requestAnimationFrame(resolve));
  });
}

function waitMilliseconds(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function dimensionalProfileName(profile = {}, geometry = "solid") {
  const sides = Math.max(2, Math.round(Number(profile.sides) || 4));
  if (profile.kind !== "star" && sides === 4) return geometry === "hyper" ? "Tesseract" : "Cube";
  const base = profile.kind === "star"
    ? `${sides}-point star`
    : sides === 3 ? "Triangular" : sides === 2 ? "Line" : `${sides}-sided polygon`;
  return `${base} ${geometry === "hyper" ? "hyperprism" : "prism"}`;
}

function syncSharedProfileControls(frame) {
  const nativeDocument = frame?.contentDocument;
  const controls = nativeDocument?.querySelector("[data-combo-shared-profile]");
  const typeSelect = nativeDocument?.getElementById(
    frame?.dataset.instrument?.startsWith("solid-") ? "solidType" : "hyperShape",
  );
  if (!controls || !typeSelect) return;

  const snapshot = nativeBridge(frame)?.captureState?.() ?? {};
  const profile = snapshot.topology ?? {};
  const sides = Math.max(1, Math.min(32, Math.round(Number(profile.sides) || 4)));
  const kind = profile.kind === "star" ? "star" : "polygon";
  const starDepth = Math.max(0.05, Math.min(0.82, Number(profile.starDepth) || 0.48));
  const sidesInput = controls.querySelector("[data-profile-sides]");
  const sidesOutput = controls.querySelector("[data-profile-sides-output]");
  const depthInput = controls.querySelector("[data-profile-depth]");
  const depthOutput = controls.querySelector("[data-profile-depth-output]");
  if (sidesInput) sidesInput.value = String(sides);
  if (sidesOutput) sidesOutput.textContent = String(sides);
  if (depthInput) depthInput.value = String(starDepth);
  if (depthOutput) depthOutput.textContent = `${Math.round(starDepth * 100)}%`;
  for (const button of controls.querySelectorAll("[data-profile-kind]")) {
    button.setAttribute("aria-pressed", String(button.dataset.profileKind === kind));
  }
  controls.dataset.profileKind = kind;
  controls.hidden = typeSelect.value !== "profile";
  controls.querySelector("[data-profile-depth-control]")?.toggleAttribute("hidden", kind !== "star");
  if (typeSelect.value === "profile") {
    const geometry = frame.dataset.instrument.startsWith("hyper-") ? "hyper" : "solid";
    const summary = nativeDocument.getElementById("formSummary");
    if (summary) summary.textContent = dimensionalProfileName({ sides, kind, starDepth }, geometry);
  }
}

function installSharedProfileControls(frame, instrument) {
  if (instrument.geometry === "shape") return;
  const nativeDocument = frame?.contentDocument;
  const typeSelect = nativeDocument?.getElementById(
    instrument.geometry === "solid" ? "solidType" : "hyperShape",
  );
  const formBody = typeSelect?.closest("details[data-section=\"form\"]")
    ?.querySelector(":scope > .group-body");
  if (!typeSelect || !formBody || formBody.querySelector("[data-combo-shared-profile]")) return;

  if (!typeSelect.querySelector('option[value="profile"]')) {
    const option = createNativeOption(
      nativeDocument,
      "profile",
      instrument.geometry === "hyper" ? "Polygon / star hyperprism" : "Polygon / star prism",
    );
    typeSelect.append(option);
  }

  const controls = nativeDocument.createElement("div");
  controls.className = "combo-shared-profile-controls";
  controls.dataset.comboSharedProfile = "";
  controls.innerHTML = `
    <div class="combo-profile-kind choice-switch" role="group" aria-label="Profile shape">
      <button type="button" data-profile-kind="polygon" aria-pressed="true">Polygon</button>
      <button type="button" data-profile-kind="star" aria-pressed="false">Star</button>
    </div>
    <label class="control" for="comboProfileSides">
      <span><b>Points</b><output data-profile-sides-output for="comboProfileSides">4</output></span>
      <input id="comboProfileSides" data-profile-sides type="range" min="2" max="32" step="1" value="4" />
    </label>
    <label class="control" data-profile-depth-control for="comboProfileDepth" hidden>
      <span><b>Star depth</b><output data-profile-depth-output for="comboProfileDepth">48%</output></span>
      <input id="comboProfileDepth" data-profile-depth type="range" min="0.05" max="0.82" step="0.01" value="0.48" />
    </label>
  `;
  typeSelect.closest("label")?.insertAdjacentElement("afterend", controls);

  const publishProfile = () => {
    const sides = Number(controls.querySelector("[data-profile-sides]")?.value) || 4;
    const starDepth = Number(controls.querySelector("[data-profile-depth]")?.value) || 0.48;
    const kind = controls.dataset.profileKind === "star" ? "star" : "polygon";
    typeSelect.value = "profile";
    nativeDocument.dispatchEvent(new frame.contentWindow.CustomEvent("morphazoid:shapes-profile", {
      detail: { sides, kind, starDepth },
    }));
    dispatchNativeControl(typeSelect, ["change"]);
    controls.querySelector("[data-profile-sides-output]").textContent = String(sides);
    controls.querySelector("[data-profile-depth-output]").textContent = `${Math.round(starDepth * 100)}%`;
    controls.querySelector("[data-profile-depth-control]")?.toggleAttribute("hidden", kind !== "star");
    syncNativeControls(frame, instrument);
    fitNativePluginPanel(frame);
  };

  for (const button of controls.querySelectorAll("[data-profile-kind]")) {
    button.addEventListener("click", () => {
      controls.dataset.profileKind = button.dataset.profileKind;
      for (const choice of controls.querySelectorAll("[data-profile-kind]")) {
        choice.setAttribute("aria-pressed", String(choice === button));
      }
      publishProfile();
    });
  }
  controls.querySelector("[data-profile-sides]")?.addEventListener("input", publishProfile);
  controls.querySelector("[data-profile-depth]")?.addEventListener("input", publishProfile);
  typeSelect.addEventListener("change", () => syncSharedProfileControls(frame));
  syncSharedProfileControls(frame);
}

function setNativeBankTitle(section, title) {
  const heading = section?.querySelector(":scope > summary .group-title");
  if (heading) heading.textContent = title;
}

function createNativeControlBank(nativeDocument, instrument, bank) {
  const section = nativeDocument.createElement("details");
  const summary = nativeDocument.createElement("summary");
  const title = nativeDocument.createElement("h2");
  const state = nativeDocument.createElement("span");
  const body = nativeDocument.createElement("div");
  section.className = "group control-section";
  section.id = `combo-${instrument.id}-${bank}-section`;
  section.dataset.section = bank;
  summary.className = "group-summary";
  title.className = "group-title";
  title.textContent = CONTROL_BANK_LABELS[bank];
  state.className = "section-state";
  state.textContent = bank === "rotation" ? "paused" : "";
  body.className = "group-body";
  summary.append(title, state);
  section.append(summary, body);
  return section;
}

function markNativeControlAsMirrored(control) {
  control?.closest("label, .control, .select-control")?.classList.add("combo-host-mirrored-control");
}

function normalizeNativeControlBanks(frame, instrument) {
  const nativeDocument = frame?.contentDocument;
  const panel = nativeDocument?.querySelector(".shell > .panel");
  if (!panel || panel.dataset.comboBanksNormalized === "true") return;

  if (instrument.geometry === "shape" && !panel.querySelector(':scope > [data-section="rotation"]')) {
    const rotationSection = createNativeControlBank(nativeDocument, instrument, "rotation");
    const rotationBody = rotationSection.querySelector(":scope > .group-body");
    const playSection = panel.querySelector(':scope > [data-section="play"]');
    for (const selector of [".rotation-position-row", "#rotationControls"]) {
      const control = playSection?.querySelector(selector);
      if (control) rotationBody.append(control);
    }
    const reference = panel.querySelector(':scope > [data-section="sound"], :scope > [data-section="mapping"]');
    panel.insertBefore(rotationSection, reference ?? panel.querySelector(":scope > .reset-all-row"));
  }

  if (instrument.geometry === "solid") {
    const rotationBody = panel.querySelector(':scope > [data-section="rotation"] > .group-body');
    const targetSwitch = nativeDocument.querySelector(".solid-target-switch");
    if (rotationBody && targetSwitch) rotationBody.prepend(targetSwitch);
  }

  if (instrument.sound === "synth") {
    const soundSection = panel.querySelector(':scope > [data-section="sound"]');
    if (instrument.geometry === "shape") {
      const mappingSection = panel.querySelector(':scope > [data-section="mapping"]');
      const soundBody = soundSection?.querySelector(":scope > .group-body");
      const mappingBody = mappingSection?.querySelector(":scope > .group-body");
      if (soundSection && mappingSection && soundBody && mappingBody) {
        mappingBody.prepend(...soundBody.children);
        // Keep the empty native section connected because app.js continues to
        // write its #soundSummary telemetry after the controls move.
        soundSection.classList.add("combo-plugin-supplementary");
        mappingSection.dataset.comboResetBanks = "sound mapping";
        mappingSection.dataset.comboMergedMapping = "true";
      }
    } else if (soundSection) {
      soundSection.dataset.section = "mapping";
      soundSection.dataset.comboResetBanks = "sound";
      setNativeBankTitle(soundSection, "Mapping");
    }
  }

  for (const bank of CONTROL_BANKS) {
    const section = panel.querySelector(`:scope > [data-section="${bank}"]`);
    if (!section) continue;
    setNativeBankTitle(section, CONTROL_BANK_LABELS[bank]);
    section.dataset.comboResetBanks ||= bank;
  }

  panel.querySelector(':scope > [data-section="output"]')?.classList.add("combo-plugin-supplementary");
  markNativeControlAsMirrored(nativeDocument.getElementById("soundMode"));
  markNativeControlAsMirrored(nativeDocument.getElementById("mappingMode"));
  const subdivisions = nativeSubdivisionControl(frame, instrument);
  markNativeControlAsMirrored(subdivisions);
  for (const descriptionId of (subdivisions?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
    nativeDocument.getElementById(descriptionId)?.classList.add("combo-host-mirrored-control");
  }
  panel.dataset.comboBanksNormalized = "true";
}

function createNativeOption(nativeDocument, value, label) {
  const option = nativeDocument.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function createNativeRouteSelect(nativeDocument, label, className, options) {
  const wrapper = nativeDocument.createElement("label");
  const select = nativeDocument.createElement("select");
  wrapper.className = `combo-native-route-select ${className}`;
  select.setAttribute("aria-label", label);
  select.append(...options.map(({ value, label: optionLabel }) => (
    createNativeOption(nativeDocument, value, optionLabel)
  )));
  wrapper.append(select);
  return { wrapper, select };
}

function createNativeRouteKnob(nativeDocument, label, className, {
  minimum = 1,
  maximum = 16,
  value = 2,
  format = (nextValue) => String(nextValue),
} = {}) {
  const wrapper = nativeDocument.createElement("div");
  const button = nativeDocument.createElement("button");
  const caption = nativeDocument.createElement("span");
  const readout = nativeDocument.createElement("span");
  wrapper.className = `combo-native-route-knob ${className}`;
  button.type = "button";
  button.className = "combo-native-knob-dial";
  button.setAttribute("role", "slider");
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-valuemin", String(minimum));
  button.setAttribute("aria-valuemax", String(maximum));
  caption.className = "combo-native-knob-caption";
  caption.textContent = "Div";
  readout.className = "combo-native-knob-readout";
  wrapper.append(button, caption, readout);

  let currentValue = value;
  let drag = null;
  const api = {
    wrapper,
    button,
    value: currentValue,
    disabled: false,
    onInput: null,
    setValue(nextValue) {
      currentValue = Math.max(minimum, Math.min(maximum, Math.round(Number(nextValue) || minimum)));
      api.value = currentValue;
      const ratio = (currentValue - minimum) / Math.max(1, maximum - minimum);
      button.style.setProperty("--combo-knob-turn", `${-135 + ratio * 270}deg`);
      button.setAttribute("aria-valuenow", String(currentValue));
      button.setAttribute("aria-valuetext", `${currentValue} regions per side`);
      readout.textContent = format(currentValue);
    },
    setDisabled(disabled) {
      api.disabled = Boolean(disabled);
      button.disabled = api.disabled;
      wrapper.classList.toggle("is-disabled", api.disabled);
    },
  };

  const emit = (commit = false) => api.onInput?.(currentValue, commit);
  button.addEventListener("keydown", (event) => {
    const keyValues = {
      Home: minimum,
      End: maximum,
      PageDown: currentValue - 4,
      PageUp: currentValue + 4,
      ArrowDown: currentValue - 1,
      ArrowLeft: currentValue - 1,
      ArrowUp: currentValue + 1,
      ArrowRight: currentValue + 1,
    };
    if (!(event.key in keyValues)) return;
    event.preventDefault();
    api.setValue(keyValues[event.key]);
    emit(true);
  });
  button.addEventListener("pointerdown", (event) => {
    if (button.disabled) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, startY: event.clientY, startValue: currentValue };
    button.setPointerCapture?.(event.pointerId);
    wrapper.classList.add("is-dragging");
  });
  button.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const before = currentValue;
    api.setValue(drag.startValue + Math.round((drag.startY - event.clientY) / 7));
    if (before !== currentValue) emit(false);
  });
  const finishDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    wrapper.classList.remove("is-dragging");
    emit(true);
  };
  button.addEventListener("pointerup", finishDrag);
  button.addEventListener("pointercancel", finishDrag);
  api.setValue(value);
  return api;
}

function prepareNativeInstrumentPicker(nativeDocument) {
  const pickerNav = nativeDocument.querySelector(".masthead > .tabs");
  if (!pickerNav) return;

  const wordmark = nativeDocument.querySelector(".masthead > .wordmark");
  if (wordmark) wordmark.target = "_top";

  pickerNav.classList.add("combo-native-picker");
  const picker = pickerNav.querySelector(".instrument-picker");
  const trigger = picker?.querySelector(".instrument-picker-trigger");
  if (picker) {
    const enforceShapesLabel = () => {
      const current = picker.querySelector(".instrument-picker-current");
      if (current && current.textContent !== "Shapes") current.textContent = "Shapes";
    };
    enforceShapesLabel();
    const NativeMutationObserver = nativeDocument.defaultView?.MutationObserver;
    if (NativeMutationObserver) {
      new NativeMutationObserver(enforceShapesLabel).observe(picker, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }
  if (trigger) {
    trigger.setAttribute("aria-label", "Choose Morphazoid instrument. Current: Shapes");
    trigger.setAttribute("title", "Choose Morphazoid instrument");
  }

  for (const link of picker?.querySelectorAll(".instrument-picker-link") ?? []) {
    link.classList.remove("is-current");
    link.removeAttribute("aria-current");
    link.target = "_top";
  }
  const shapesLink = picker?.querySelector('[data-tool-id="combo"]');
  shapesLink?.classList.add("is-current");
  shapesLink?.setAttribute("aria-current", "page");
}

function syncNativeRouteToolbar(frame, instrument) {
  const toolbar = nativeRouteToolbars.get(frame);
  const nativeDocument = frame?.contentDocument;
  if (!toolbar || !nativeDocument) return;

  const geometry = COMBO_GEOMETRIES[instrument.geometry];
  toolbar.dimension.value = instrument.geometry;
  nativeDocument.documentElement.style.setProperty("--combo-native-accent", geometry.color);

  if (instrument.sound === "synth") {
    const nativeVoiceEngine = nativeDocument.getElementById("soundMode");
    toolbar.system.value = nativeVoiceEngine?.value === "percussion" ? "notes" : "continuous";
    if (nativeVoiceEngine) {
      toolbar.voice.value = nativeVoiceEngine.value;
      toolbar.voice.disabled = nativeVoiceEngine.disabled;
    }
    syncNativeRotationToggle(frame);
    return;
  }

  toolbar.system.value = "triggers";
  const nativeMapping = nativeDocument.getElementById("mappingMode");
  if (nativeMapping) copyNativeOptions(nativeMapping, toolbar.mapping);
  const nativeSubdivisions = nativeSubdivisionControl(frame, instrument);
  if (nativeSubdivisions) {
    toolbar.subdivisions.setValue(nativeSubdivisions.value);
    toolbar.subdivisions.setDisabled(nativeSubdivisions.disabled);
  }
  syncNativeRotationToggle(frame);
}

function nativeRotationButtons(frame) {
  return [...(frame?.contentDocument?.querySelectorAll(
    "#rotationPlayButton, .axis-play-button[id^=\"rotation\"]",
  ) ?? [])];
}

function syncNativeRotationToggle(frame) {
  const toggle = nativeRouteToolbars.get(frame)?.rotation;
  if (!toggle) return;
  const buttons = nativeRotationButtons(frame);
  const activeCount = buttons.filter((button) => button.getAttribute("aria-pressed") === "true").length;
  const active = activeCount > 0;
  toggle.setAttribute("aria-pressed", String(active));
  toggle.setAttribute("aria-label", active ? "Stop shape rotation" : "Start shape rotation");
  toggle.querySelector("span:last-child").textContent = active ? "Rotating" : "Rotate";
}

function createNativeRotationToggle(nativeDocument, frame) {
  const button = nativeDocument.createElement("button");
  const glyph = nativeDocument.createElement("span");
  const label = nativeDocument.createElement("span");
  button.type = "button";
  button.className = "combo-live-rotation";
  button.setAttribute("aria-pressed", "false");
  glyph.textContent = "⟳";
  glyph.setAttribute("aria-hidden", "true");
  label.textContent = "Rotate";
  button.append(glyph, label);
  button.addEventListener("click", () => {
    const buttons = nativeRotationButtons(frame);
    const shouldPlay = !buttons.some((candidate) => candidate.getAttribute("aria-pressed") === "true");
    for (const candidate of buttons) {
      if ((candidate.getAttribute("aria-pressed") === "true") !== shouldPlay) candidate.click();
    }
    syncNativeRotationToggle(frame);
  });
  return button;
}

async function selectNativePerformanceMode(mode, geometry = activeInstrument.geometry) {
  const target = comboInstrumentFor(geometry, mode === "triggers" ? "drums" : "synth");
  await activateInstrument(target);
  if (mode === "triggers") return;
  const targetFrame = frames.get(target.id);
  const voice = targetFrame?.contentDocument?.getElementById("soundMode");
  if (!voice) return;
  if (mode === "notes") voice.value = "percussion";
  else if (voice.value === "percussion") voice.value = "sine";
  dispatchNativeControl(voice, ["change"]);
  syncNativeControls(targetFrame, target);
}

function installNativeRouteToolbar(frame, instrument) {
  const nativeDocument = frame?.contentDocument;
  const masthead = nativeDocument?.querySelector(".masthead");
  const panel = nativeDocument?.querySelector(".shell > .panel");
  if (!masthead || !panel || nativeRouteToolbars.has(frame)) return;

  const route = nativeDocument.createElement("div");
  route.className = "combo-native-route";
  route.setAttribute("role", "group");
  route.setAttribute("aria-label", "Shapes dimension");
  const rail = nativeDocument.createElement("div");
  rail.className = "combo-control-rail";
  rail.setAttribute("role", "toolbar");
  rail.setAttribute("aria-label", "Shapes sound and parameter controls");

  prepareNativeInstrumentPicker(nativeDocument);
  const dimensionField = createNativeRouteSelect(nativeDocument, "Dimension", "combo-native-dimension-select", [
    { value: "shape", label: "2D" },
    { value: "solid", label: "3D" },
    { value: "hyper", label: "4D" },
  ]);
  const systemField = createNativeRouteSelect(nativeDocument, "Performance mode", "combo-native-system-select", [
    { value: "continuous", label: "Continuous" },
    { value: "notes", label: "Notes" },
    { value: "triggers", label: "Triggers" },
  ]);

  const controls = {
    route,
    rail,
    dimension: dimensionField.select,
    system: systemField.select,
    systemWrapper: systemField.wrapper,
    voice: null,
    voiceWrapper: null,
    mapping: null,
    mappingWrapper: null,
    subdivisions: null,
    rotation: null,
  };

  route.append(dimensionField.wrapper);

  if (instrument.sound === "synth") {
    const voiceField = createNativeRouteSelect(nativeDocument, "Voice engine", "combo-native-mode-select", [
      { value: "sine", label: "Sine" },
      { value: "fm", label: "FM" },
      { value: "pm", label: "PM" },
      { value: "shepard", label: "Shepard" },
      { value: "percussion", label: "Percussive" },
    ]);
    controls.voice = voiceField.select;
    controls.voiceWrapper = voiceField.wrapper;
  } else {
    const mappingField = createNativeRouteSelect(nativeDocument, "Trigger mapping", "combo-native-mapping-select", []);
    const subdivisionKnob = createNativeRouteKnob(
      nativeDocument,
      "Trigger regions per side",
      "combo-native-subdivision-knob",
      { minimum: 1, maximum: 16, value: 2, format: (nextValue) => `${nextValue}×` },
    );
    controls.mapping = mappingField.select;
    controls.mappingWrapper = mappingField.wrapper;
    controls.subdivisions = subdivisionKnob;
  }

  const ioControls = masthead.querySelector(":scope > .header-io-controls")
    ?? masthead.querySelector(":scope > .audio-strip");
  masthead.insertBefore(route, ioControls ?? null);
  panel.prepend(rail);
  nativeRouteToolbars.set(frame, controls);

  controls.dimension.addEventListener("change", () => selectNativePerformanceMode(
    controls.system.value,
    controls.dimension.value,
  ));
  controls.system.addEventListener("change", () => selectNativePerformanceMode(controls.system.value));
  controls.voice?.addEventListener("change", () => {
    const nativeVoiceEngine = nativeDocument.getElementById("soundMode");
    if (!nativeVoiceEngine) return;
    nativeVoiceEngine.value = controls.voice.value;
    dispatchNativeControl(nativeVoiceEngine, ["change"]);
    activateNativeBank(frame, "mapping");
  });
  controls.mapping?.addEventListener("change", () => {
    const nativeMapping = nativeDocument.getElementById("mappingMode");
    if (!nativeMapping) return;
    nativeMapping.value = controls.mapping.value;
    dispatchNativeControl(nativeMapping, ["change"]);
    activateNativeBank(frame, "mapping");
  });
  if (controls.subdivisions) controls.subdivisions.onInput = (value, commit) => {
    const nativeSubdivisions = nativeSubdivisionControl(frame, instrument);
    if (!nativeSubdivisions) return;
    nativeSubdivisions.value = String(value);
    dispatchNativeControl(nativeSubdivisions, commit ? ["input", "change"] : ["input"]);
    fitNativePluginPanel(frame);
  };

  syncNativeRouteToolbar(frame, instrument);
}

function fitNativePluginPanel(frame) {
  const layout = nativePluginLayouts.get(frame);
  if (!layout) return;
  const nativeWindow = frame.contentWindow;
  nativeWindow?.cancelAnimationFrame(layout.fitRequest ?? 0);
  layout.fitRequest = nativeWindow?.requestAnimationFrame(() => {
    const activeBody = layout.sections.find((section) => section.dataset.comboBankActive === "true")
      ?.querySelector(":scope > .group-body");
    if (!activeBody) return;
    activeBody.style.removeProperty("zoom");
    layout.panel.removeAttribute("data-combo-overflow");
    if (nativeWindow.matchMedia("(max-width: 960px)").matches) {
      layout.panel.dataset.comboDensity = "normal";
      return;
    }
    for (const density of ["normal", "compact", "tight"]) {
      layout.panel.dataset.comboDensity = density;
      if (activeBody.scrollHeight <= activeBody.clientHeight + 2) break;
    }
    if (activeBody.scrollHeight > activeBody.clientHeight + 2) {
      const requiredScale = activeBody.clientHeight / activeBody.scrollHeight;
      const scale = Math.max(0.62, requiredScale);
      activeBody.style.zoom = scale.toFixed(3);
      if (requiredScale < 0.62) layout.panel.dataset.comboOverflow = "scroll";
    }
  });
}

function canonicalControlBank(sectionName) {
  if (["sound", "engine"].includes(sectionName)) return "mapping";
  return CONTROL_BANKS.includes(sectionName) ? sectionName : "play";
}

function activateNativeBank(frame, sectionName, { focus = false, remember = true } = {}) {
  const layout = nativePluginLayouts.get(frame);
  if (!layout) return;
  const resolvedSectionName = canonicalControlBank(sectionName);
  const targetIndex = Math.max(0, layout.sections.findIndex((section) => (
    section.dataset.section === resolvedSectionName || section.id === resolvedSectionName
  )));

  layout.sections.forEach((section, index) => {
    const active = index === targetIndex;
    section.open = active;
    section.dataset.comboBankActive = String(active);
    section.setAttribute("aria-hidden", String(!active));
    layout.buttons[index].setAttribute("aria-selected", String(active));
    layout.buttons[index].tabIndex = active ? 0 : -1;
  });
  if (remember && frame.dataset.instrument === activeInstrument.id) {
    activeControlBank = canonicalControlBank(layout.sections[targetIndex].dataset.section || resolvedSectionName);
  }
  const activeLabel = CONTROL_BANK_LABELS[resolvedSectionName] ?? "current bank";
  layout.resetButton?.setAttribute("aria-label", `Reset ${activeLabel} controls`);
  if (focus) layout.buttons[targetIndex].focus();
  layout.buttons[targetIndex].scrollIntoView?.({ block: "nearest", inline: "nearest" });
  fitNativePluginPanel(frame);
}

function resetNativeControlBank(frame, instrument, section) {
  const bridge = nativeBridge(frame);
  if (!bridge?.resetBank) return Promise.resolve(false);
  const banks = (section.dataset.comboResetBanks || section.dataset.section || "")
    .split(/\s+/)
    .filter(Boolean);
  return Promise.all(banks.map((bank) => Promise.resolve(bridge.resetBank(bank))));
}

function installNativePluginLayout(frame, instrument) {
  const nativeDocument = frame?.contentDocument;
  const panel = nativeDocument?.querySelector(".shell > .panel");
  if (!panel || nativePluginLayouts.has(frame)) return;

  const sections = CONTROL_BANKS.map((bank) => (
    panel.querySelector(`:scope > details.control-section[data-section="${bank}"]`)
  )).filter(Boolean);
  if (sections.length !== CONTROL_BANKS.length) return;

  panel.classList.add("combo-plugin-panel");
  const tabs = nativeDocument.createElement("div");
  tabs.className = "combo-bank-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", `${instrument.title} control banks`);

  const buttons = sections.map((section, index) => {
    const bank = section.dataset.section;
    const title = CONTROL_BANK_LABELS[bank] ?? `Bank ${index + 1}`;
    const sectionId = section.id || `combo-bank-${instrument.id}-${index + 1}`;
    const button = nativeDocument.createElement("button");
    section.id = sectionId;
    section.setAttribute("role", "tabpanel");
    button.type = "button";
    button.id = `${sectionId}-tab`;
    button.textContent = title;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", sectionId);
    section.setAttribute("aria-labelledby", button.id);
    button.addEventListener("click", () => activateNativeBank(frame, section.dataset.section || sectionId));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = buttons.indexOf(button);
      const next = event.key === "Home" ? 0
        : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      activateNativeBank(frame, sections[next].dataset.section || sections[next].id, { focus: true });
    });
    tabs.append(button);
    return button;
  });

  const routeToolbar = nativeRouteToolbars.get(frame);
  const playBody = sections.find((section) => section.dataset.section === "play")
    ?.querySelector(":scope > .group-body");
  if (routeToolbar && playBody) {
    const performance = nativeDocument.createElement("div");
    performance.className = "combo-performance-routing";
    performance.setAttribute("role", "group");
    performance.setAttribute("aria-label", "Live sound and rotation");
    routeToolbar.rotation = createNativeRotationToggle(nativeDocument, frame);
    performance.append(
      routeToolbar.systemWrapper,
      routeToolbar.voiceWrapper ?? routeToolbar.mappingWrapper,
      ...(routeToolbar.subdivisions ? [routeToolbar.subdivisions.wrapper] : []),
      routeToolbar.rotation,
    );
    playBody.prepend(performance);
    nativeDocument.getElementById("speed")
      ?.closest("label, .rate-control")
      ?.classList.add("combo-primary-speed-control");
  }
  routeToolbar?.rail.append(tabs);
  const globalReset = panel.querySelector(":scope > .reset-all-row");
  globalReset?.classList.add("combo-plugin-reset");
  if (globalReset) globalReset.hidden = true;
  const resetButton = nativeDocument.createElement("button");
  resetButton.type = "button";
  resetButton.className = "mini-action combo-bank-reset";
  resetButton.textContent = "Reset";
  resetButton.addEventListener("click", (event) => {
    event.preventDefault();
    const section = sections.find((candidate) => candidate.dataset.comboBankActive === "true") ?? sections[0];
    const bank = section.dataset.section;
    resetNativeControlBank(frame, instrument, section).finally(() => {
      if (bank === "form") captureTopologyIntent(frame, instrument);
      syncNativeControls(frame, instrument);
      syncSharedProfileControls(frame);
      fitNativePluginPanel(frame);
    });
  });
  routeToolbar?.rail.append(resetButton);
  for (const child of panel.children) {
    if (child !== routeToolbar?.rail && !sections.includes(child) && !child.classList.contains("combo-plugin-reset")) {
      child.classList.add("combo-plugin-supplementary");
    }
  }

  const NativeResizeObserver = frame.contentWindow?.ResizeObserver;
  const layout = { panel, sections, buttons, tabs, resetButton, resizeObserver: null, fitRequest: 0 };
  nativePluginLayouts.set(frame, layout);
  const NativeMutationObserver = frame.contentWindow?.MutationObserver;
  if (NativeMutationObserver) {
    layout.rotationObserver = new NativeMutationObserver(() => syncNativeRotationToggle(frame));
    for (const button of nativeRotationButtons(frame)) {
      layout.rotationObserver.observe(button, { attributes: true, attributeFilter: ["aria-pressed"] });
    }
  }
  syncNativeRotationToggle(frame);
  if (NativeResizeObserver) {
    layout.resizeObserver = new NativeResizeObserver(() => fitNativePluginPanel(frame));
    layout.resizeObserver.observe(panel);
  }

  const initiallyOpen = sections.find((section) => section.open) ?? sections[0];
  const requestedBank = canonicalControlBank(activeControlBank);
  const initialBank = sections.some((section) => section.dataset.section === requestedBank)
    ? requestedBank
    : initiallyOpen.dataset.section || initiallyOpen.id;
  activateNativeBank(frame, initialBank, { remember: false });
}

function nativeSubdivisionControl(frame, instrument) {
  const id = instrument.geometry === "shape" ? "sideSubdivisions" : "subdivisions";
  return frame?.contentDocument?.getElementById(id) ?? null;
}

function copyNativeOptions(source, target) {
  const targetDocument = target.ownerDocument ?? document;
  const options = [...source.options].map((nativeOption) => {
    const option = targetDocument.createElement("option");
    option.value = nativeOption.value;
    option.textContent = nativeOption.textContent;
    option.disabled = nativeOption.disabled;
    return option;
  });
  target.replaceChildren(...options);
  target.value = source.value;
  target.disabled = source.disabled || options.length === 0;
}

function syncNativeControls(frame, instrument) {
  if (instrument.id !== activeInstrument.id || !frame?.contentDocument) return;

  syncNativeRouteToolbar(frame, instrument);
  syncSharedProfileControls(frame);
}

function bindNativeControlMirrors(frame, instrument) {
  const nativeDocument = frame?.contentDocument;
  if (!nativeDocument?.documentElement || nativeDocument.documentElement.dataset.comboHostControls === "bound") return;
  nativeDocument.documentElement.dataset.comboHostControls = "bound";

  const sync = () => {
    syncNativeControls(frame, instrument);
    fitNativePluginPanel(frame);
  };
  nativeDocument.getElementById("soundMode")?.addEventListener("change", sync);
  nativeDocument.getElementById("mappingMode")?.addEventListener("change", sync);

  const captureTopology = () => queueMicrotask(() => captureTopologyIntent(frame, instrument));
  nativeDocument.getElementById("sides")?.addEventListener("input", captureTopology);
  nativeDocument.getElementById("starDepth")?.addEventListener("input", captureTopology);
  nativeDocument.getElementById("closedShapeType")?.addEventListener("click", captureTopology);
  nativeDocument.getElementById("solidType")?.addEventListener("change", captureTopology);
  nativeDocument.getElementById("hyperShape")?.addEventListener("change", captureTopology);

  nativeDocument.getElementById("audioButton")?.addEventListener("click", () => {
    const audioButton = nativeDocument.getElementById("audioButton");
    if (audioButton?.getAttribute("aria-pressed") === "true") return;
    for (const siblingInstrument of Object.values(COMBO_NATIVE_INSTRUMENTS)) {
      if (siblingInstrument.id === instrument.id || siblingInstrument.sound !== instrument.sound) continue;
      const siblingFrame = frames.get(siblingInstrument.id);
      const siblingBridge = siblingFrame?.dataset.ready === "true" ? nativeBridge(siblingFrame) : null;
      if (!siblingBridge) continue;
      siblingBridge.setHostGain(0);
      Promise.resolve(siblingBridge.prepareAudio({ gain: 0 })).catch(() => undefined);
    }
  }, { capture: true });

  const subdivisions = nativeSubdivisionControl(frame, instrument);
  if (subdivisions) {
    subdivisions.addEventListener("input", sync);
    subdivisions.addEventListener("change", sync);
    const NativeMutationObserver = frame.contentWindow?.MutationObserver;
    if (NativeMutationObserver) {
      new NativeMutationObserver(sync).observe(subdivisions, { attributes: true, attributeFilter: ["disabled"] });
    }
  }
}

function dispatchNativeControl(control, events) {
  if (!control) return false;
  const NativeEvent = control.ownerDocument?.defaultView?.Event ?? Event;
  for (const eventName of events) {
    control.dispatchEvent(new NativeEvent(eventName, { bubbles: true }));
  }
  return true;
}

function updateAddress(instrument) {
  const url = new URL(window.location.href);
  url.searchParams.delete("native");
  url.searchParams.set("geometry", instrument.geometry);
  url.searchParams.set("sound", instrument.sound);
  history.replaceState(null, "", url);
}

function commitInstrumentSelection(instrument, frame, { announce = true, updateUrl = true } = {}) {
  activeInstrument = instrument;
  rack.dataset.geometry = instrument.geometry;
  rack.dataset.sound = instrument.sound;
  rack.style.setProperty("--active-geometry", COMBO_GEOMETRIES[instrument.geometry].color);
  focusTitle.textContent = instrument.title;
  loading.textContent = `Loading the original ${instrument.title}…`;
  persistInstrument(instrument);
  if (updateUrl) updateAddress(instrument);

  if (frame.dataset.ready === "true") {
    activateNativeBank(frame, activeControlBank, { remember: false });
    syncNativeControls(frame, instrument);
    fitNativePluginPanel(frame);
    shell.classList.remove("is-loading");
    shell.removeAttribute("aria-busy");
  } else {
    shell.classList.add("is-loading");
    shell.setAttribute("aria-busy", "true");
  }
  if (announce) liveStatus.textContent = `${instrument.title} selected`;
}

function restoreAfterFailedHandoff(frame, previousFrame, instrument, previousInstrument) {
  frame.hidden = true;
  previousFrame.hidden = false;
  previousFrame.classList.remove("is-handoff-source");
  frame.classList.remove("is-handoff-target");
  syncNativeRouteToolbar(previousFrame, previousInstrument);
  shell.classList.remove("is-loading");
  shell.removeAttribute("aria-busy");
  loading.textContent = "";
  liveStatus.textContent = `${instrument.title} could not be prepared; ${previousInstrument.title} is still playing.`;
}

function transitionOwnsTarget(frame, requestId) {
  return frameTransitionOwners.get(frame) === requestId;
}

function releaseTransitionTarget(frame, requestId) {
  if (transitionOwnsTarget(frame, requestId)) frameTransitionOwners.delete(frame);
}

function parkStaleTarget(frame, bridge, requestId) {
  if (!transitionOwnsTarget(frame, requestId) || frame.dataset.instrument === activeInstrument.id) return;
  bridge.setHostGain(0);
  bridge.parkAudio();
  frame.hidden = true;
  frame.classList.remove("is-handoff-target");
  releaseTransitionTarget(frame, requestId);
}

function sourceCanRetire(frame, requestId) {
  const owner = frameTransitionOwners.get(frame);
  return frame.dataset.instrument !== activeInstrument.id && (owner == null || owner === requestId);
}

async function activateInstrument(instrument, { announce = true, updateUrl = true } = {}) {
  const requestId = ++transitionSerial;
  const previousInstrument = activeInstrument;
  const previousFrame = frames.get(previousInstrument.id);
  const frame = instrumentFrame(instrument);

  if (!previousFrame || previousInstrument.id === instrument.id) {
    frame.hidden = false;
    commitInstrumentSelection(instrument, frame, { announce, updateUrl });
    return;
  }
  frameTransitionOwners.set(frame, requestId);

  let incomingBridge = nativeBridge(frame);
  if (frame.dataset.ready !== "true" || !incomingBridge) {
    liveStatus.textContent = `Preparing ${instrument.title}…`;
    incomingBridge = await whenNativeBridgeReady(frame);
    if (incomingBridge) enhanceNativeFrame(frame, instrument);
    if (frame.dataset.ready !== "true" && incomingBridge) await whenFrameReady(frame);
  }
  if (requestId !== transitionSerial) {
    releaseTransitionTarget(frame, requestId);
    return;
  }

  const outgoingBridge = nativeBridge(previousFrame) ?? await whenNativeBridgeReady(previousFrame);
  incomingBridge ??= nativeBridge(frame);
  if (requestId !== transitionSerial) {
    releaseTransitionTarget(frame, requestId);
    return;
  }
  if (!outgoingBridge || !incomingBridge) {
    restoreAfterFailedHandoff(frame, previousFrame, instrument, previousInstrument);
    releaseTransitionTarget(frame, requestId);
    return;
  }

  let committed = false;
  try {
    mergeSharedState(outgoingBridge.captureState(), previousInstrument.geometry);
    const snapshot = stateForHandoff(instrument.geometry);
    const audioEnabled = Boolean(snapshot.audio?.enabled);
    outgoingBridge.setHostGain(1);
    incomingBridge.setHostGain(0);
    const applyResult = incomingBridge.applyState(snapshot, { suppressTriggers: true });
    const audioResult = audioEnabled
      ? incomingBridge.prepareAudio({ gain: 0 })
      : incomingBridge.disableAudio();
    await Promise.all([Promise.resolve(applyResult), Promise.resolve(audioResult)]);
    if (requestId !== transitionSerial) {
      parkStaleTarget(frame, incomingBridge, requestId);
      return;
    }

    // Audio preparation can take long enough for an audible phase jump. Reapply
    // the same canonical transport at its extrapolated position just before the
    // target is revealed, while retaining its prepared audio context and gate.
    await Promise.resolve(incomingBridge.applyState(stateForHandoff(instrument.geometry), {
      suppressTriggers: true,
    }));
    if (requestId !== transitionSerial) {
      parkStaleTarget(frame, incomingBridge, requestId);
      return;
    }

    frame.hidden = false;
    previousFrame.classList.add("is-handoff-source");
    frame.classList.add("is-handoff-target");
    await waitForVisualFrame(frame);
    if (requestId !== transitionSerial) {
      parkStaleTarget(frame, incomingBridge, requestId);
      previousFrame.classList.remove("is-handoff-source");
      return;
    }

    commitInstrumentSelection(instrument, frame, { announce, updateUrl });
    committed = true;
    syncSharedProfileControls(frame);
    if (audioEnabled) {
      outgoingBridge.setHostGain(0, HANDOFF_MILLISECONDS);
      incomingBridge.setHostGain(1, HANDOFF_MILLISECONDS);
      await waitMilliseconds(HANDOFF_MILLISECONDS);
    } else {
      incomingBridge.setHostGain(1);
    }
    if (requestId !== transitionSerial) {
      if (sourceCanRetire(previousFrame, requestId)) {
        outgoingBridge.setHostGain(0);
        outgoingBridge.parkAudio();
        previousFrame.hidden = true;
      }
      previousFrame.classList.remove("is-handoff-source");
      frame.classList.remove("is-handoff-target");
      releaseTransitionTarget(frame, requestId);
      return;
    }
    outgoingBridge.parkAudio();
    previousFrame.hidden = true;
    previousFrame.classList.remove("is-handoff-source");
    frame.classList.remove("is-handoff-target");
    releaseTransitionTarget(frame, requestId);
  } catch (error) {
    const targetIsCommitted = committed || activeInstrument.id === instrument.id;
    if (targetIsCommitted) {
      try { incomingBridge.setHostGain(1); } catch { /* Keep the committed UI usable. */ }
      if (sourceCanRetire(previousFrame, requestId)) {
        try { outgoingBridge.setHostGain(0); } catch { /* The source is hidden below. */ }
        try { outgoingBridge.parkAudio(); } catch { /* Host gain remains the safety gate. */ }
        previousFrame.hidden = true;
      }
      frame.hidden = false;
      previousFrame.classList.remove("is-handoff-source");
      frame.classList.remove("is-handoff-target");
      releaseTransitionTarget(frame, requestId);
      liveStatus.textContent = `${instrument.title} selected`;
    } else if (requestId === transitionSerial) {
      try { outgoingBridge.setHostGain(1); } catch { /* The source bridge retains its prior intent. */ }
      try { parkStaleTarget(frame, incomingBridge, requestId); } catch { frame.hidden = true; }
      restoreAfterFailedHandoff(frame, previousFrame, instrument, previousInstrument);
      releaseTransitionTarget(frame, requestId);
    } else {
      try { parkStaleTarget(frame, incomingBridge, requestId); } catch { /* A newer owner controls the frame. */ }
    }
    console.warn("Shapes dimension handoff failed", error);
  }
}

const initialFrame = document.getElementById("nativeInstrumentFrame");
if (initialFrame) {
  const defaultInstrument = COMBO_NATIVE_INSTRUMENTS["shape-synth"];
  initialFrame.loading = "eager";
  initialFrame.dataset.instrument = defaultInstrument.id;
  initialFrame.hidden = activeInstrument.id !== defaultInstrument.id;
  initialFrame.addEventListener("load", () => enhanceNativeFrame(initialFrame, defaultInstrument));
  frames.set(defaultInstrument.id, initialFrame);
  watchNativeFrameReadiness(initialFrame, defaultInstrument);
}

window.addEventListener("pagehide", () => {
  for (const frame of frames.values()) silenceFrame(frame);
});

activateInstrument(activeInstrument, { announce: false });

setTimeout(() => {
  const preloadOrder = Object.values(COMBO_NATIVE_INSTRUMENTS).sort((left, right) => (
    Number(right.sound === activeInstrument.sound) - Number(left.sound === activeInstrument.sound)
  ));
  for (const instrument of preloadOrder) instrumentFrame(instrument);
}, 0);

if (initialFrame?.contentDocument?.readyState === "complete") {
  enhanceNativeFrame(initialFrame, COMBO_NATIVE_INSTRUMENTS["shape-synth"]);
}
