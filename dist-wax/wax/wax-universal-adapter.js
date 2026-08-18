import { getSharedMidiManager } from "../src/midi-manager.js";
import { waxSupportForId } from "../src/wax-instrument-roles.js";
import {
  UNIVERSAL_MIDI_CC_KEYWORDS,
  applyBrowserMidiClockTempo,
  browserMidiControls,
  browserMidiNoteValue,
  browserMidiPitchControl,
  browserPitchBendValue,
  dispatchBrowserControlValue,
  isBrowserMidiControl,
  universalMidiControlText,
} from "../src/browser-midi-adapter.js";
import {
  MidiClockTempoTracker,
  PpqMidiOutputScheduler,
  normalizeWaxRoutingState,
  normalizedControlValue,
} from "../src/wax-midi-routing.js";

const EXISTING_MIDI_CLIENTS = new Set([
  "shape",
  "chaotic-fm",
  "recursive-fm",
  "chaotic-pm",
  "recursive-pm",
  "fm-drums",
  "sample-drums",
]);

const ROUTE_ALIASES = Object.freeze({
  "algorithmic-sequencers": "sorting-algorithms",
  "l-mic": "micmic",
});

const PLAY_SELECTORS = [
  "#playButton",
  "#playToggle",
  "#transportButton",
  "#transportPlay",
  "#synthPlayButton",
];

const AUDIO_SELECTORS = ["#audioButton", "#audioToggle"];
const TEMPO_SELECTORS = ["#tempo", "#bpm", "input[name='tempo']", "input[name='bpm']"];

const CC_KEYWORDS = UNIVERSAL_MIDI_CC_KEYWORDS;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function titleCase(value) {
  return String(value || "")
    .split("-")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : "")
    .join(" ");
}

export function routeIdForLocation(locationLike) {
  const pathname = String(locationLike?.pathname || "").replace(/\/+$/, "");
  const filename = pathname.split("/").at(-1) || "index.html";
  const basename = filename.replace(/\.html?$/i, "");
  if (basename === "index" && /\/morphazoidical(?:\/|$)/.test(pathname)) return "morphazoidical";
  return ROUTE_ALIASES[basename] || basename || "index";
}

function isPressed(element) {
  if (!element) return false;
  if (element.matches?.("input[type='checkbox']")) return Boolean(element.checked);
  return element.getAttribute?.("aria-pressed") === "true"
    || element.dataset?.state === "playing"
    || element.classList?.contains("is-playing");
}

function firstElement(documentObject, selectors) {
  for (const selector of selectors) {
    const element = documentObject.querySelector?.(selector);
    if (element) return element;
  }
  return null;
}

function setPressedControl(element, pressed) {
  if (!element || isPressed(element) === pressed) return false;
  element.click?.();
  return true;
}

export function shouldDriveNativeAudio(routingState) {
  return routingState?.outputMode !== "midi";
}

function controlText(control, documentObject) {
  return universalMidiControlText(control, documentObject);
}

export function isUniversalMidiControl(control) {
  return isBrowserMidiControl(control);
}

function mappableControls(documentObject) {
  return [...(documentObject.querySelectorAll?.(
    "input[type='range']:not([disabled]), select:not([disabled])",
  ) || [])].filter(isUniversalMidiControl);
}

function dispatchControlValue(runtime, control, value) {
  return dispatchBrowserControlValue(runtime, control, value);
}

function setControlNormalized(runtime, control, normalized) {
  if (!control) return false;
  if (control.tagName === "SELECT") {
    const options = [...control.options];
    if (!options.length) return false;
    const index = Math.round(clamp(normalized, 0, 1) * (options.length - 1));
    return dispatchControlValue(runtime, control, options[index].value);
  }
  const value = normalizedControlValue(normalized, {
    min: control.min,
    max: control.max,
    step: control.step,
  });
  return dispatchControlValue(runtime, control, value);
}

function semanticControl(documentObject, keywords, controls = mappableControls(documentObject)) {
  for (const keyword of keywords) {
    const wanted = String(keyword).toLowerCase().trim();
    const match = controls.find((control) => {
      const text = controlText(control, documentObject);
      return wanted.includes(" ")
        ? ` ${text} `.includes(` ${wanted} `)
        : text.split(" ").includes(wanted);
    });
    if (match) return match;
  }
  return null;
}

function standardControllerForControl(control, documentObject) {
  const tokens = controlText(control, documentObject).split(" ");
  for (const [controller, keywords] of Object.entries(CC_KEYWORDS)) {
    if (keywords.some((keyword) => tokens.includes(keyword))) return Number(controller);
  }
  return null;
}

export function automationMessageForControl(control, index, documentObject, channel = 0) {
  if (!control) return null;
  const channelNumber = clamp(Math.round(finite(channel, 0)), 0, 15);
  if (control.tagName === "SELECT" && /\b(preset|program|patch)\b/.test(
    controlText(control, documentObject),
  )) {
    const options = [...(control.options || [])];
    const program = Math.max(0, options.indexOf(control.selectedOptions?.[0] || options[control.selectedIndex]));
    return Object.freeze([0xc0 | channelNumber, clamp(program, 0, 127)]);
  }
  const controller = standardControllerForControl(control, documentObject)
    ?? (index < 8 ? 14 + index : null);
  if (controller === null) return null;
  let normalized;
  if (control.tagName === "SELECT") {
    const count = control.options?.length || 0;
    normalized = count > 1 ? clamp(finite(control.selectedIndex, 0) / (count - 1), 0, 1) : 0;
  } else {
    const minimum = finite(control.min, 0);
    const maximum = finite(control.max, 1);
    normalized = maximum === minimum
      ? 0
      : clamp((finite(control.value, minimum) - minimum) / (maximum - minimum), 0, 1);
  }
  return Object.freeze([
    0xb0 | channelNumber,
    controller,
    Math.round(normalized * 127),
  ]);
}

export function midiNoteValueForControl(control, note, description = "") {
  return browserMidiNoteValue(control, note, description);
}

export function pitchBendValueForControl(control, baseValue, normalizedBend, description = "") {
  return browserPitchBendValue(control, baseValue, normalizedBend, description);
}

function dispatchMidiEvent(runtime, message) {
  if (typeof runtime.dispatchEvent !== "function" || typeof runtime.CustomEvent !== "function") {
    return false;
  }
  const event = new runtime.CustomEvent("morphazoid:midi-input", {
    cancelable: true,
    detail: { message, source: "wax" },
  });
  runtime.dispatchEvent(event);
  return event.defaultPrevented;
}

function choosePreset(documentObject, runtime, index) {
  const select = documentObject.querySelector?.(
    "select[id*='preset' i], select[name*='preset' i], select[id*='program' i]",
  );
  if (select?.options?.length) {
    const option = select.options[index % select.options.length];
    return dispatchControlValue(runtime, select, option.value);
  }
  const buttons = [...(documentObject.querySelectorAll?.(
    "[id*='preset' i] button, [class*='preset' i] button, button[data-preset]",
  ) || [])].filter((button) => !button.closest?.(".wax-midi-panel"));
  const button = buttons[index % Math.max(1, buttons.length)];
  button?.click?.();
  return Boolean(button);
}

function triggerNoteFallback(documentObject, runtime, support, message, state, bendBases) {
  const midiOnly = !shouldDriveNativeAudio(state);
  const audioButton = firstElement(documentObject, AUDIO_SELECTORS);
  if (!midiOnly && support.roles.includes("instrument") && !isPressed(audioButton)) {
    audioButton?.click?.();
  }

  if (support.noteMode === "drums") {
    if (midiOnly) return false;
    const pads = [...(documentObject.querySelectorAll?.(
      "#padGrid button, [class*='pad-grid' i] button, button[data-pad-index], button[data-note], button[data-voice-index]",
    ) || [])].filter((button) => !button.closest?.(".wax-midi-panel"));
    if (pads.length) {
      pads[((message.note - 36) % pads.length + pads.length) % pads.length]?.click?.();
      return true;
    }
  }

  const pitchControl = browserMidiPitchControl(
    documentObject,
    runtime,
    browserMidiControls(documentObject, { rangesOnly: true }),
  );
  let pitchApplied = false;
  if (pitchControl) {
    const value = midiNoteValueForControl(
      pitchControl,
      message.note,
      controlText(pitchControl, documentObject),
    );
    pitchApplied = dispatchControlValue(runtime, pitchControl, value);
    if (pitchApplied) bendBases.set(pitchControl, { base: value, applied: value });
  }

  if (midiOnly) return pitchApplied;

  if (support.noteMode === "sequence") {
    const step = firstElement(documentObject, ["#stepButton", "[data-midi-trigger='step']"]);
    if (step) {
      step.click?.();
      return true;
    }
  } else if (support.noteMode === "drums") {
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

function applyGenericMidi(
  documentObject,
  runtime,
  support,
  message,
  routingState,
  clockTracker,
  tempoDispatchState,
  bendBases,
) {
  if (dispatchMidiEvent(runtime, message)) return true;

  if (message.type === "noteOn") {
    return triggerNoteFallback(documentObject, runtime, support, message, routingState, bendBases);
  }
  if (message.type === "pitchBend") {
    const controls = browserMidiControls(documentObject, { rangesOnly: true });
    const target = browserMidiPitchControl(documentObject, runtime, controls);
    if (!target) return false;
    const current = finite(target.value, 0.5);
    const existing = bendBases.get(target);
    const base = existing && Math.abs(current - existing.applied) < 1e-7
      ? existing.base
      : current;
    const next = pitchBendValueForControl(
      target,
      base,
      message.normalized,
      controlText(target, documentObject),
    );
    const applied = dispatchControlValue(runtime, target, next);
    if (applied) bendBases.set(target, { base, applied: next });
    return applied;
  }
  if (message.type === "controlChange") {
    if ([120, 121, 123].includes(message.controller)) return false;
    const controls = browserMidiControls(documentObject, { rangesOnly: true });
    const macroIndex = message.logical?.type === "macro" ? message.logical.index : null;
    const target = Number.isInteger(macroIndex)
      ? controls[macroIndex] ?? null
      : semanticControl(documentObject, CC_KEYWORDS[message.controller] || [], controls);
    return setControlNormalized(runtime, target, finite(message.value, 0) / 127);
  }
  if (message.type === "programChange") {
    return choosePreset(documentObject, runtime, message.program || 0);
  }
  if (message.type === "channelPressure" || message.type === "polyPressure") {
    const controls = browserMidiControls(documentObject, { rangesOnly: true });
    const target = semanticControl(documentObject, ["pressure", "intensity", "force", "level"], controls);
    return setControlNormalized(runtime, target, finite(message.pressure, 0) / 127);
  }
  if (message.type === "timingClock") {
    if (!routingState.hostSync) return false;
    return applyBrowserMidiClockTempo({
      documentObject,
      runtime,
      message,
      clockTracker,
      tempoDispatchState,
    });
  }
  if (message.type === "start" || message.type === "continue") {
    if (routingState.hostSync && shouldDriveNativeAudio(routingState)) {
      return setPressedControl(firstElement(documentObject, PLAY_SELECTORS), true);
    }
  }
  if (message.type === "stop") {
    clockTracker.reset();
    tempoDispatchState.lastTimestamp = Number.NEGATIVE_INFINITY;
    tempoDispatchState.lastValue = null;
    if (routingState.hostSync && shouldDriveNativeAudio(routingState)) {
      return setPressedControl(firstElement(documentObject, PLAY_SELECTORS), false);
    }
  }
  return false;
}

function addStylesheet(documentObject) {
  if (documentObject.querySelector?.("link[data-morphazoid-wax-midi-style]")) return;
  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./wax-universal-adapter.css", import.meta.url).href;
  link.dataset.morphazoidWaxMidiStyle = "";
  documentObject.head?.append?.(link);
}

function option(value, label, selected = false) {
  return `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
}

function createPanel(documentObject, support, initialState) {
  const panel = documentObject.createElement("aside");
  panel.className = "wax-midi-panel";
  panel.setAttribute("aria-label", "Morphazoid WAX routing");
  const modeOptions = [];
  const canAudio = support.roles.includes("instrument") || support.roles.includes("audio-fx");
  const canMidi = support.roles.includes("midi-fx");
  if (canAudio) modeOptions.push(option("audio", "Audio", initialState.outputMode === "audio"));
  if (canAudio && canMidi) modeOptions.push(option("both", "Audio + MIDI", initialState.outputMode === "both"));
  if (canMidi) modeOptions.push(option("midi", "MIDI only", initialState.outputMode === "midi"));
  panel.innerHTML = `
    <details>
      <summary><span>WAX</span><b>${titleCase(support.recommended)}</b><i data-wax-midi-led></i></summary>
      <div class="wax-midi-panel-body">
        <p>${support.summary}</p>
        <label><span>Output mode</span><select data-wax-output-mode>${modeOptions.join("")}</select></label>
        ${canMidi ? `
          <label><span>MIDI destination</span><select data-wax-output-port><option value="">Auto host output</option></select></label>
          <div class="wax-midi-panel-grid">
            <label><span>Channel</span><input data-wax-channel type="number" min="1" max="16" value="${initialState.channel + 1}"></label>
            <label><span>Root note</span><input data-wax-root type="number" min="0" max="127" value="${initialState.rootNote}"></label>
            <label><span>Division</span><select data-wax-division>${["1/4", "1/8", "1/16", "1/32"].map((division) => option(division, division, division === initialState.division)).join("")}</select></label>
            <label><span>Gate</span><input data-wax-gate type="range" min="0.05" max="0.98" step="0.01" value="${initialState.gate}"></label>
          </div>
        ` : ""}
        <label class="wax-midi-panel-check"><input data-wax-host-sync type="checkbox"${initialState.hostSync ? " checked" : ""}><span>Follow DAW play, stop, BPM, and PPQ</span></label>
        <button type="button" data-wax-panic>All notes off</button>
        <output data-wax-status>Waiting for WAX MIDI…</output>
        ${support.caveat ? `<small>${support.caveat}</small>` : ""}
      </div>
    </details>`;
  documentObject.body?.append?.(panel);
  return panel;
}

function pageControlSignature(documentObject) {
  let signature = 0;
  for (const [index, control] of mappableControls(documentObject).slice(0, 8).entries()) {
    const minimum = finite(control.min, 0);
    const maximum = finite(control.max, 1);
    const normalized = maximum === minimum ? 0 : (finite(control.value, minimum) - minimum) / (maximum - minimum);
    signature = (signature + Math.round(clamp(normalized, 0, 1) * 127) * (index + 3)) % 997;
  }
  return signature;
}

export function updateSelectOutputs(select, status, wantedId) {
  if (!select) return;
  const outputs = Array.isArray(status?.outputs) ? status.outputs : [];
  // Keep Auto represented as Auto even when it currently resolves to a real
  // port. Otherwise the next unrelated panel edit would persist that port as
  // an explicit choice and silently disable automatic hot-plug fallback.
  const selection = String(wantedId || "");
  select.replaceChildren();
  const automatic = select.ownerDocument.createElement("option");
  automatic.value = "";
  automatic.textContent = "Auto host output";
  select.append(automatic);
  for (const output of outputs) {
    const item = select.ownerDocument.createElement("option");
    item.value = output.id;
    item.textContent = [output.manufacturer, output.name].filter(Boolean).join(" · ") || output.id;
    select.append(item);
  }
  if (selection && ![...select.options].some(({ value }) => value === selection)) {
    const missing = select.ownerDocument.createElement("option");
    missing.value = selection;
    missing.textContent = `Missing output · ${selection}`;
    missing.disabled = true;
    select.append(missing);
  }
  select.value = [...select.options].some(({ value }) => value === selection) ? selection : "";
}

export function installUniversalWaxAdapter(runtime = globalThis, documentObject = runtime.document) {
  if (!runtime?.MorphazoidWAX || !documentObject?.body) return null;
  const routeId = routeIdForLocation(runtime.location);
  const support = waxSupportForId(routeId);
  if (!support) return null;

  addStylesheet(documentObject);
  const manager = getSharedMidiManager(runtime);
  let routingState = normalizeWaxRoutingState({}, support);
  const panel = createPanel(documentObject, support, routingState);
  const outputMode = panel.querySelector("[data-wax-output-mode]");
  const outputPort = panel.querySelector("[data-wax-output-port]");
  const channel = panel.querySelector("[data-wax-channel]");
  const root = panel.querySelector("[data-wax-root]");
  const division = panel.querySelector("[data-wax-division]");
  const gate = panel.querySelector("[data-wax-gate]");
  const hostSync = panel.querySelector("[data-wax-host-sync]");
  const statusOutput = panel.querySelector("[data-wax-status]");
  const led = panel.querySelector("[data-wax-midi-led]");
  const stateListeners = new Set();
  const controlOutputCleanups = [];
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

  const panicOutput = (reason = "user-panic") => {
    if (typeof manager.clearOutput === "function") manager.clearOutput();
    if (typeof manager.panic === "function") manager.panic();
    else if (typeof manager.resetOutput === "function") manager.resetOutput();
    else if (typeof manager.panicOutput === "function") manager.panicOutput(reason, routingState.channel);
  };
  const scheduler = new PpqMidiOutputScheduler({
    send: (bytes, timestamp) => manager.send?.(bytes, timestamp),
    clear: () => manager.clearOutput?.(),
    panic: panicOutput,
  });

  const readState = () => normalizeWaxRoutingState({
    outputMode: outputMode?.value,
    outputId: outputPort?.value,
    channel: finite(channel?.value, 1) - 1,
    rootNote: root?.value,
    division: division?.value,
    gate: gate?.value,
    hostSync: Boolean(hostSync?.checked),
  }, support);

  const applyRoutingState = (next, source = "user") => {
    const previous = routingState;
    routingState = normalizeWaxRoutingState({ ...routingState, ...next }, support);
    if (outputMode) outputMode.value = routingState.outputMode;
    if (channel) channel.value = String(routingState.channel + 1);
    if (root) root.value = String(routingState.rootNote);
    if (division) division.value = routingState.division;
    if (gate) gate.value = String(routingState.gate);
    if (hostSync) hostSync.checked = routingState.hostSync;
    if (documentObject.documentElement?.dataset) {
      documentObject.documentElement.dataset.morphazoidWaxOutputMode = routingState.outputMode;
    }
    if (outputPort && routingState.outputId !== outputPort.value) outputPort.value = routingState.outputId;
    const availableOutputIds = new Set((manager.status?.().outputs || []).map(({ id }) => id));
    if (!routingState.outputId || availableOutputIds.has(routingState.outputId)) {
      manager.selectOutput?.(routingState.outputId || null);
    }
    scheduler.configure(routingState, { ...support, id: routeId });
    scheduler.setEnabled(
      routingState.hostSync && ["midi", "both"].includes(routingState.outputMode),
    );
    if (routingState.outputMode === "midi") {
      setPressedControl(firstElement(documentObject, AUDIO_SELECTORS), false);
    }
    if (previous.outputMode !== routingState.outputMode && source !== "wax-hydration") {
      panicOutput("output-mode-change");
    }
    if (source !== "wax-hydration") {
      for (const listener of stateListeners) listener(routingState, source);
    }
    return routingState;
  };

  const refreshFromUi = () => applyRoutingState(readState(), "user");
  for (const control of [outputMode, outputPort, channel, root, division, gate, hostSync]) {
    control?.addEventListener?.("change", refreshFromUi);
  }
  panel.querySelector("[data-wax-panic]")?.addEventListener?.("click", () => {
    if (scheduler.wasPlaying || scheduler.lastScheduledStep !== null) scheduler.stop("user-panic");
    else panicOutput("user-panic");
  });

  const onMidiMessage = (message) => {
    const hostTransportAvailable = runtime.MorphazoidWAX.capabilities?.().playhead;
    if (
      routingState.outputMode === "midi"
      && support.midiOutput
      && message.type === "noteOn"
    ) {
      applyRoutingState({ ...routingState, rootNote: message.note }, "midi");
    }
    if (
      EXISTING_MIDI_CLIENTS.has(routeId)
      && !["timingClock", "start", "continue", "stop", "songPosition", "programChange", "polyPressure", "channelPressure"].includes(message.type)
    ) return;
    if (hostTransportAvailable && ["timingClock", "start", "continue", "stop", "songPosition"].includes(message.type)) {
      dispatchMidiEvent(runtime, message);
      return;
    }
    const clockState = clockStateFor(message);
    applyGenericMidi(
      documentObject,
      runtime,
      support,
      message,
      routingState,
      clockState.clockTracker,
      clockState.tempoDispatchState,
      bendBases,
    );
  };

  const unregisterMidi = manager.registerClient({
    id: `wax-universal:${routeId}`,
    computerKeyboard: support.computerKeyboardMode !== "midi"
      ? false
      : support.noteMode === "drums"
        ? { layout: "pad-grid", baseNote: 36, velocity: 100 }
        : { layout: "piano", baseNote: 48, velocity: 100 },
    onMessage: onMidiMessage,
  });

  mappableControls(documentObject).forEach((control, index) => {
    const eventType = control.tagName === "SELECT" ? "change" : "input";
    const onUserControl = (event) => {
      if (event?.isTrusted !== true || !["midi", "both"].includes(routingState.outputMode)) return;
      const message = automationMessageForControl(
        control,
        index,
        documentObject,
        routingState.channel,
      );
      if (message) manager.send?.(message);
    };
    control.addEventListener?.(eventType, onUserControl);
    controlOutputCleanups.push(() => control.removeEventListener?.(eventType, onUserControl));
  });

  const unsubscribeStatus = manager.subscribeStatus?.((status) => {
    if (
      routingState.outputId
      && status.outputSelectionId !== routingState.outputId
      && status.outputs.some(({ id }) => id === routingState.outputId)
    ) {
      manager.selectOutput?.(routingState.outputId);
      return;
    }
    updateSelectOutputs(outputPort, status, routingState.outputId);
    const outputReady = Boolean(status.selectedOutput);
    const ready = status.enabled && (routingState.outputMode === "audio" || outputReady);
    led?.classList?.toggle("is-ready", ready);
    if (statusOutput) {
      const inputText = status.enabled
        ? `${status.inputCount || 0} MIDI input${status.inputCount === 1 ? "" : "s"}`
        : "MIDI waiting";
      const outputText = support.roles.includes("midi-fx")
        ? outputReady ? "host output ready" : "no MIDI output yet"
        : "audio route";
      statusOutput.textContent = `${inputText} · ${outputText}`;
    }
  });

  const playControl = (pressed) => {
    if (!routingState.hostSync || !shouldDriveNativeAudio(routingState)) return;
    setPressedControl(firstElement(documentObject, PLAY_SELECTORS), pressed);
  };
  const setTempo = (bpm) => {
    if (!routingState.hostSync) return;
    const tempo = firstElement(documentObject, TEMPO_SELECTORS);
    if (!tempo) return;
    const next = clamp(
      finite(bpm, finite(tempo.value, 120)),
      Math.min(finite(tempo.min, 20), finite(tempo.max, 400)),
      Math.max(finite(tempo.min, 20), finite(tempo.max, 400)),
    );
    if (Math.abs(finite(tempo.value, next) - next) < 0.001) return;
    dispatchControlValue(runtime, tempo, next);
  };

  const unregisterWax = runtime.MorphazoidWAX.register({
    id: `${routeId}:midi-routing`,
    stateVersion: 1,
    getState: () => routingState,
    applyState: (state) => applyRoutingState(state, "wax-hydration"),
    subscribeState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    enableMidi: () => manager.enable(),
    transport: {
      bpm: setTempo,
      play: () => playControl(true),
      stop: () => {
        playControl(false);
        scheduler.stop("host-stop");
      },
      playheadIntervalMs: 24,
      playhead(playhead) {
        if (!routingState.hostSync) return;
        if (playhead.bpm) setTempo(playhead.bpm);
        const signature = pageControlSignature(documentObject);
        const events = scheduler.update(playhead, (step, fallback) => ({
          note: clamp(fallback.note + (signature % 5) - 2, 0, 127),
          velocity: clamp(fallback.velocity + (signature % 17) - 8, 1, 127),
        }));
        for (const event of events) {
          if (typeof runtime.CustomEvent === "function") {
            runtime.dispatchEvent?.(new runtime.CustomEvent("morphazoid:wax-midi-output", {
              detail: { ...event, routeId, source: "companion-sequencer" },
            }));
          }
        }
      },
    },
  });

  applyRoutingState(routingState, "wax-hydration");
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    scheduler.stop("pagehide");
    unregisterWax?.();
    unregisterMidi?.();
    unsubscribeStatus?.();
    for (const remove of controlOutputCleanups.splice(0)) remove();
    documentObject.documentElement?.removeAttribute?.("data-morphazoid-wax-output-mode");
    runtime.removeEventListener?.("pagehide", onPageHide);
  };
  const onPageHide = (event) => {
    if (event?.persisted) {
      scheduler.stop("pagehide");
    } else {
      cleanup();
    }
  };
  runtime.addEventListener?.("pagehide", onPageHide);

  return Object.freeze({
    cleanup,
    get state() { return routingState; },
    manager,
    panel,
    routeId,
    scheduler,
    support,
  });
}

function start() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const install = () => {
    try {
      installUniversalWaxAdapter(window, document);
    } catch (error) {
      window.console?.error?.("Morphazoid WAX: universal MIDI adapter failed", error);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else queueMicrotask(install);
}

start();
