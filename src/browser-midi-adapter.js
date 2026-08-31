import { getSharedMidiManager } from "./midi-manager.js";
import { MidiClockTempoTracker, midiNoteToFrequency, normalizedControlValue } from "./wax-midi-routing.js";
import { instrumentMidiCapabilityForId } from "./instrument-midi-capabilities.js";

const ADAPTER_KEY = Symbol.for("morphazoid.browserMidiAdapter");

const PLAY_SELECTORS = Object.freeze([
  "[data-primary-transport]",
  "#playButton",
  "#playToggle",
  "#transportButton",
  "#transportPlay",
  "#synthPlayButton",
]);

const AUDIO_SELECTORS = Object.freeze(["#audioButton", "#audioToggle"]);
const TEMPO_SELECTORS = Object.freeze([
  "#tempo",
  "#bpm",
  "input[name='tempo']",
  "input[name='bpm']",
]);
const PITCH_SELECTORS = Object.freeze([
  "#frequency",
  "#carrier",
  "#rootFrequency",
  "#baseFrequency",
  "#seedNote",
  "#rootMidiNote",
  "#rootHz",
  "#root",
  "input[name='frequency']",
  "input[name='pitch']",
]);
const MIDI_CLOCK_UI_INTERVAL_MS = 250;

export const UNIVERSAL_MIDI_CC_KEYWORDS = Object.freeze({
  1: Object.freeze(["mod", "depth", "amount", "morph"]),
  5: Object.freeze(["portamento", "glide", "slew"]),
  7: Object.freeze(["output", "level", "volume", "gain"]),
  10: Object.freeze(["pan", "balance", "stereo"]),
  11: Object.freeze(["expression", "output", "level"]),
  71: Object.freeze(["resonance", "feedback", "q"]),
  72: Object.freeze(["release", "tail"]),
  73: Object.freeze(["attack", "rise"]),
  74: Object.freeze(["cutoff", "brightness", "tone", "filter"]),
  75: Object.freeze(["decay", "fall"]),
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstElement(documentObject, selectors) {
  for (const selector of selectors) {
    const element = documentObject.querySelector?.(selector);
    if (element) return element;
  }
  return null;
}

function isPressed(element) {
  if (!element) return false;
  if (element.matches?.("input[type='checkbox']")) return Boolean(element.checked);
  return element.getAttribute?.("aria-pressed") === "true"
    || element.dataset?.state === "playing"
    || element.classList?.contains("is-playing");
}

function setPressedControl(element, pressed) {
  if (!element || isPressed(element) === pressed) return false;
  element.click?.();
  return true;
}

function escapedId(id, runtime) {
  return runtime?.CSS?.escape?.(id) ?? globalThis.CSS?.escape?.(id) ?? id;
}

export function universalMidiControlText(control, documentObject, runtime = globalThis) {
  const id = String(control?.id || "");
  const label = id
    ? documentObject.querySelector?.(`label[for="${escapedId(id, runtime)}"]`)?.textContent
    : "";
  return [id, control?.name, control?.getAttribute?.("aria-label"), label]
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Keep global navigation, MIDI, and preset selectors outside generic knob mapping. */
export function isBrowserMidiControl(control) {
  if (!control || control.disabled) return false;
  if (control.closest?.(".midi-toolbar, .wax-midi-panel")) return false;
  if (control.tagName === "SELECT" && control.closest?.(
    "header, nav, .masthead, .topbar, .mobile-instrument-nav, .instrument-picker, [data-midi-toolbar]",
  )) return false;
  if (/^(midiProfileSelect|mobileInstrumentSelect)/i.test(String(control.id || ""))) return false;
  return control.matches?.("input[type='range'], select") !== false;
}

export function browserMidiControls(documentObject, { rangesOnly = false } = {}) {
  const selector = rangesOnly
    ? "input[type='range']:not([disabled])"
    : "input[type='range']:not([disabled]), select:not([disabled])";
  return [...(documentObject.querySelectorAll?.(selector) || [])].filter(isBrowserMidiControl);
}

export function dispatchBrowserControlValue(runtime, control, value) {
  if (!control) return false;
  control.value = String(value);
  const EventConstructor = runtime?.Event || globalThis.Event;
  if (typeof EventConstructor === "function") {
    control.dispatchEvent?.(new EventConstructor("input", { bubbles: true }));
    control.dispatchEvent?.(new EventConstructor("change", { bubbles: true }));
  }
  return true;
}

function setControlNormalized(runtime, control, normalized) {
  if (!control) return false;
  if (control.tagName === "SELECT") {
    const options = [...(control.options || [])];
    if (!options.length) return false;
    const index = Math.round(clamp(normalized, 0, 1) * (options.length - 1));
    return dispatchBrowserControlValue(runtime, control, options[index].value);
  }
  const value = normalizedControlValue(normalized, {
    min: control.min,
    max: control.max,
    step: control.step,
  });
  return dispatchBrowserControlValue(runtime, control, value);
}

function semanticControl(
  documentObject,
  runtime,
  keywords,
  controls = browserMidiControls(documentObject, { rangesOnly: true }),
) {
  for (const keyword of keywords) {
    const wanted = String(keyword).toLowerCase().trim();
    const match = controls.find((control) => {
      const text = universalMidiControlText(control, documentObject, runtime);
      return wanted.includes(" ")
        ? ` ${text} `.includes(` ${wanted} `)
        : text.split(" ").includes(wanted);
    });
    if (match) return match;
  }
  return null;
}

export function browserMidiNoteValue(control, note, description = "") {
  const minimum = finite(control?.min, 0);
  const maximum = finite(control?.max, 1);
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  const text = `${control?.id || ""} ${control?.name || ""} ${description}`
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  if (/\b(note|midi)\b/.test(text) && low >= 0 && high <= 127) {
    return clamp(Math.round(note), low, high);
  }
  if (/\b(pitch|transpose|semitone)\b/.test(text) && low < 0 && high > 0 && high <= 127) {
    return clamp(note - 60, low, high);
  }
  if (high <= 2 && low >= -1) return clamp((note - 24) / 84, low, high);
  if (/\b(hz|frequency|carrier|pitch|tone|fundamental)\b/.test(text) && high > 127) {
    return clamp(midiNoteToFrequency(note), low, high);
  }
  return normalizedControlValue((note - 24) / 84, {
    min: low,
    max: high,
    step: control?.step,
  });
}

export function browserPitchBendValue(control, baseValue, normalizedBend, description = "") {
  const low = Math.min(finite(control?.min, 0), finite(control?.max, 1));
  const high = Math.max(finite(control?.min, 0), finite(control?.max, 1));
  const base = clamp(finite(baseValue, (low + high) / 2), low, high);
  const bend = clamp(finite(normalizedBend, 0), -1, 1);
  const text = `${control?.id || ""} ${control?.name || ""} ${description}`
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  if (/\b(note|midi)\b/.test(text) && high <= 127) return clamp(base + bend * 2, low, high);
  if (/\b(pitch|transpose|semitone)\b/.test(text) && low < 0 && high > 0 && high <= 127) {
    return clamp(base + bend * 2, low, high);
  }
  if (/\b(hz|frequency|carrier|tone|fundamental)\b/.test(text) && high > 2) {
    return clamp(base * (2 ** ((bend * 2) / 12)), low, high);
  }
  return clamp(base + bend * (high - low) * (2 / 84), low, high);
}

/**
 * Public event contract for pages that later add an exact native mapping.
 * Calling preventDefault() tells the generic adapter not to apply its fallback.
 */
export function dispatchBrowserMidiEvent(runtime, message, routeId) {
  if (typeof runtime?.dispatchEvent !== "function" || typeof runtime?.CustomEvent !== "function") {
    return false;
  }
  const event = new runtime.CustomEvent("morphazoid:midi-input", {
    cancelable: true,
    detail: Object.freeze({ message, routeId, source: "browser" }),
  });
  runtime.dispatchEvent(event);
  return event.defaultPrevented;
}

export function isWaxWrappedDocument(runtime, documentObject) {
  if (runtime?.MorphazoidWAX) return true;
  if (documentObject?.documentElement?.dataset?.morphazoidWaxOutputMode !== undefined) return true;
  return Boolean(documentObject?.querySelector?.(
    "script[data-morphazoid-wax-bootstrap], script[data-morphazoid-wax-universal-adapter]",
  ));
}

function choosePreset(documentObject, runtime, index) {
  const select = documentObject.querySelector?.(
    "select[id*='preset' i], select[name*='preset' i], select[id*='program' i]",
  );
  if (select?.options?.length && isBrowserMidiControl(select)) {
    const option = select.options[index % select.options.length];
    return dispatchBrowserControlValue(runtime, select, option.value);
  }
  const buttons = [...(documentObject.querySelectorAll?.(
    "[id*='preset' i] button, [class*='preset' i] button, button[data-preset]",
  ) || [])].filter((button) => !button.closest?.(".midi-toolbar, .wax-midi-panel"));
  const button = buttons[index % Math.max(1, buttons.length)];
  button?.click?.();
  return Boolean(button);
}

export function browserMidiPitchControl(
  documentObject,
  runtime = globalThis,
  controls = browserMidiControls(documentObject, { rangesOnly: true }),
) {
  return firstElement(documentObject, PITCH_SELECTORS)
    || semanticControl(
      documentObject,
      runtime,
      ["frequency", "pitch", "carrier", "root"],
      controls,
    )
    || controls.find((control) => {
      if (Math.max(finite(control.min, 0), finite(control.max, 1)) <= 127) return false;
      const text = universalMidiControlText(control, documentObject, runtime).split(" ");
      return text.includes("tone") || text.includes("fundamental");
    })
    || null;
}

function prepareAudio(documentObject, support) {
  if (support?.startsAudio === false) return false;
  const audioButton = firstElement(documentObject, AUDIO_SELECTORS);
  return setPressedControl(audioButton, true);
}

function triggerNoteFallback(documentObject, runtime, support, message, bendBases) {
  prepareAudio(documentObject, support);

  if (support?.noteMode === "drums") {
    const pads = [...(documentObject.querySelectorAll?.(
      "#padGrid button, [class*='pad-grid' i] button, button[data-pad-index], button[data-note], button[data-voice-index]",
    ) || [])].filter((button) => !button.closest?.(".midi-toolbar, .wax-midi-panel"));
    if (pads.length) {
      pads[((message.note - 36) % pads.length + pads.length) % pads.length]?.click?.();
      return true;
    }
  }

  const controls = browserMidiControls(documentObject, { rangesOnly: true });
  const target = browserMidiPitchControl(documentObject, runtime, controls);
  let pitchApplied = false;
  if (target) {
    const value = browserMidiNoteValue(
      target,
      message.note,
      universalMidiControlText(target, documentObject, runtime),
    );
    pitchApplied = dispatchBrowserControlValue(runtime, target, value);
    if (pitchApplied) bendBases.set(target, { base: value, applied: value });
  }

  if (support?.noteMode === "sequence") {
    const step = firstElement(documentObject, ["#stepButton", "[data-midi-trigger='step']"]);
    if (step) {
      step.click?.();
      return true;
    }
  } else if (support?.noteMode === "drums") {
    const strike = firstElement(documentObject, [
      "button[id*='trigger' i]",
      "button[id*='strike' i]",
    ]);
    if (strike) {
      strike.click?.();
      return true;
    }
  }

  const playStarted = setPressedControl(firstElement(documentObject, PLAY_SELECTORS), true);
  return pitchApplied || playStarted;
}

/** Apply a throttled, stepped MIDI-clock tempo update to an explicit tempo control. */
export function applyBrowserMidiClockTempo({
  documentObject,
  runtime = globalThis,
  message,
  clockTracker,
  tempoDispatchState = {},
} = {}) {
  const bpm = clockTracker?.ingest?.(message?.timestamp);
  const tempo = firstElement(documentObject, TEMPO_SELECTORS);
  if (!bpm || !tempo) return false;

  const low = Math.min(finite(tempo.min, 20), finite(tempo.max, 400));
  const high = Math.max(finite(tempo.min, 20), finite(tempo.max, 400));
  const bounded = clamp(bpm, low, high);
  const next = normalizedControlValue(
    high === low ? 0 : (bounded - low) / (high - low),
    { min: low, max: high, step: tempo.step },
  );
  const timestamp = finite(
    message?.timestamp,
    runtime?.performance?.now?.() ?? Date.now(),
  );
  if (
    Number.isFinite(tempoDispatchState.lastTimestamp)
    && timestamp >= tempoDispatchState.lastTimestamp
    && timestamp - tempoDispatchState.lastTimestamp < MIDI_CLOCK_UI_INTERVAL_MS
  ) return false;
  tempoDispatchState.lastTimestamp = timestamp;
  tempoDispatchState.lastValue = next;

  const current = finite(tempo.value, Number.NaN);
  const tolerance = Math.max(1e-7, Math.abs(finite(tempo.step, 0)) / 2);
  if (Number.isFinite(current) && Math.abs(current - next) <= tolerance) return false;
  return dispatchBrowserControlValue(runtime, tempo, next);
}

export function applyBrowserMidiMessage({
  documentObject,
  runtime = globalThis,
  routeId = "instrument",
  support = {},
  message,
  clockTracker = new MidiClockTempoTracker(),
  tempoDispatchState = {},
  bendBases = new WeakMap(),
} = {}) {
  if (!documentObject || !message) return false;
  if (dispatchBrowserMidiEvent(runtime, message, routeId)) return true;

  if (message.type === "noteOn") {
    return triggerNoteFallback(documentObject, runtime, support, message, bendBases);
  }
  // Note-off and panic still reach exact page adapters through the public event.
  // Stopping an unknown page's global audio would be surprising and can cut tails.
  if (message.type === "noteOff") return false;
  if (message.type === "pitchBend") {
    const controls = browserMidiControls(documentObject, { rangesOnly: true });
    const target = browserMidiPitchControl(documentObject, runtime, controls);
    if (!target) return false;
    const current = finite(target.value, 0.5);
    const existing = bendBases.get(target);
    const base = existing && Math.abs(current - existing.applied) < 1e-7
      ? existing.base
      : current;
    const next = browserPitchBendValue(
      target,
      base,
      message.normalized,
      universalMidiControlText(target, documentObject, runtime),
    );
    const applied = dispatchBrowserControlValue(runtime, target, next);
    if (applied) bendBases.set(target, { base, applied: next });
    return applied;
  }
  if (message.type === "controlChange") {
    if ([120, 121, 123].includes(message.controller)) return false;
    const controls = browserMidiControls(documentObject, { rangesOnly: true });
    const macroIndex = message.logical?.type === "macro" ? message.logical.index : null;
    const target = Number.isInteger(macroIndex)
      ? controls[macroIndex] ?? null
      : semanticControl(
        documentObject,
        runtime,
        UNIVERSAL_MIDI_CC_KEYWORDS[message.controller] || [],
        controls,
      );
    return setControlNormalized(runtime, target, finite(message.value, 0) / 127);
  }
  if (message.type === "programChange") {
    return choosePreset(documentObject, runtime, message.program || 0);
  }
  if (message.type === "channelPressure" || message.type === "polyPressure") {
    const controls = browserMidiControls(documentObject, { rangesOnly: true });
    const target = semanticControl(
      documentObject,
      runtime,
      ["pressure", "intensity", "force", "level"],
      controls,
    );
    return setControlNormalized(runtime, target, finite(message.pressure, 0) / 127);
  }
  if (message.type === "timingClock") {
    return applyBrowserMidiClockTempo({
      documentObject,
      runtime,
      message,
      clockTracker,
      tempoDispatchState,
    });
  }
  if (message.type === "start" || message.type === "continue") {
    prepareAudio(documentObject, support);
    return setPressedControl(firstElement(documentObject, PLAY_SELECTORS), true);
  }
  if (message.type === "stop") {
    clockTracker.reset();
    tempoDispatchState.lastTimestamp = Number.NEGATIVE_INFINITY;
    tempoDispatchState.lastValue = null;
    return setPressedControl(firstElement(documentObject, PLAY_SELECTORS), false);
  }
  return false;
}

/** Register the browser fallback that makes the shared top toolbar visible. */
export function installBrowserMidiAdapter(
  runtime = globalThis,
  documentObject = runtime?.document,
  {
    routeId,
    support = instrumentMidiCapabilityForId(routeId),
    manager = getSharedMidiManager(runtime),
  } = {},
) {
  if (!routeId || !support?.midiInput || !documentObject) return null;
  if (isWaxWrappedDocument(runtime, documentObject) || support.midiInputMode === "native") return null;
  if (runtime[ADAPTER_KEY]) return runtime[ADAPTER_KEY];

  const clockTrackers = new Map();
  const tempoDispatchStates = new Map();
  const bendBases = new WeakMap();
  const clockStateFor = (message) => {
    const sourceId = String(message?.sourceId || "default");
    if (!clockTrackers.has(sourceId)) clockTrackers.set(sourceId, new MidiClockTempoTracker());
    if (!tempoDispatchStates.has(sourceId)) tempoDispatchStates.set(sourceId, {});
    return {
      clockTracker: clockTrackers.get(sourceId),
      tempoDispatchState: tempoDispatchStates.get(sourceId),
    };
  };
  const unregister = manager.registerClient({
    id: `browser-universal:${routeId}`,
    computerKeyboard: support.computerKeyboardMode !== "midi"
      ? false
      : support.noteMode === "drums"
        ? { layout: "pad-grid", baseNote: 36, velocity: 100 }
        : { layout: "piano", baseNote: 48, velocity: 100 },
    onPrepareEnable: () => prepareAudio(documentObject, support),
    onMessage: (message) => {
      const clockState = clockStateFor(message);
      return applyBrowserMidiMessage({
        documentObject,
        runtime,
        routeId,
        support,
        message,
        ...clockState,
        bendBases,
      });
    },
  });

  let disposed = false;
  const adapter = Object.freeze({
    routeId,
    support,
    manager,
    dispose() {
      if (disposed) return;
      disposed = true;
      unregister();
      runtime.removeEventListener?.("pagehide", handlePageHide);
      if (runtime[ADAPTER_KEY] === adapter) delete runtime[ADAPTER_KEY];
    },
  });
  const handlePageHide = (event) => {
    if (!event?.persisted) adapter.dispose();
  };
  runtime.addEventListener?.("pagehide", handlePageHide);
  runtime[ADAPTER_KEY] = adapter;
  return adapter;
}
