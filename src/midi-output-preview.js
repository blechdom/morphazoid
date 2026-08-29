export const MIDI_OUTPUT_PREVIEW_EVENT = "morphazoid:midi-output-preview";

const NOTE_NAMES = Object.freeze([
  "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B",
]);
const TRANSPORT_STATES = new Set(["start", "continue", "stop"]);
const PREVIEW_KINDS = new Set(["note", "control", "clock", "timebase", "transport"]);
const MAX_RETAINED_SIGNALS = 6;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function text(value, fallback = "") {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  return result || fallback;
}

function signalId(value) {
  return text(value, "signal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "signal";
}

export function midi7(value) {
  return Math.round(clamp(value, 0, 127));
}

export function normalizedMidiValue(value, min = 0, max = 1) {
  const lower = finite(min, 0);
  const upper = finite(max, 1);
  if (upper <= lower) return 0;
  return midi7(((clamp(value, lower, upper) - lower) / (upper - lower)) * 127);
}

export function midiNoteName(note) {
  const number = midi7(note);
  return `${NOTE_NAMES[number % 12]}${Math.floor(number / 12) - 1}`;
}

export function normalizeMidiOutputPreview(detail, timestamp = globalThis.performance?.now?.() ?? Date.now()) {
  if (!detail || typeof detail !== "object") {
    throw new TypeError("MIDI output preview detail must be an object.");
  }
  const kind = text(detail.kind).toLowerCase();
  if (!PREVIEW_KINDS.has(kind)) {
    throw new RangeError(`Unknown MIDI output preview kind: ${kind || "(empty)"}`);
  }

  const source = text(detail.source, "Instrument signal");
  const base = {
    kind,
    source,
    sourceId: text(detail.sourceId, signalId(source)),
    routeId: text(detail.routeId),
    channel: detail.channel == null ? null : Math.round(clamp(detail.channel, 1, 16)),
    timestamp: finite(detail.timestamp, finite(timestamp, 0)),
    mapped: false,
    sent: false,
  };

  if (kind === "note") {
    const note = midi7(detail.note);
    const velocity = midi7(detail.velocity ?? 100);
    return Object.freeze({
      ...base,
      channel: base.channel ?? 1,
      voiceId: text(detail.voiceId, `${base.sourceId}:${note}`),
      note,
      noteName: midiNoteName(note),
      velocity,
      action: detail.action === "off" || velocity === 0 ? "off" : "on",
      frequencyHz: detail.frequencyHz == null
        ? null
        : Math.max(0, finite(detail.frequencyHz, 0)),
      durationMs: detail.durationMs == null
        ? null
        : Math.max(0, finite(detail.durationMs, 0)),
    });
  }

  if (kind === "control") {
    const min = finite(detail.min, 0);
    const max = finite(detail.max, 1);
    const rawValue = clamp(detail.rawValue ?? detail.value ?? min, min, max);
    return Object.freeze({
      ...base,
      label: text(detail.label, base.source),
      rawValue,
      min,
      max,
      value: detail.value7 == null
        ? normalizedMidiValue(rawValue, min, max)
        : midi7(detail.value7),
      unit: text(detail.unit),
      displayValue: text(detail.displayValue ?? detail.formattedValue),
    });
  }

  if (kind === "timebase") {
    return Object.freeze({
      ...base,
      rate: finite(detail.rate, 0),
      unit: text(detail.unit, "units/s"),
      running: detail.running == null ? null : Boolean(detail.running),
      displayValue: text(detail.displayValue ?? detail.formattedValue),
    });
  }

  if (kind === "clock") {
    const bpm = clamp(detail.bpm, 1, 999);
    return Object.freeze({
      ...base,
      bpm,
      ppqn: Math.round(clamp(detail.ppqn ?? 24, 1, 960)),
      running: detail.running == null ? null : Boolean(detail.running),
    });
  }

  const state = text(detail.state, "stop").toLowerCase();
  if (!TRANSPORT_STATES.has(state)) {
    throw new RangeError(`Unknown MIDI transport preview state: ${state}`);
  }
  return Object.freeze({
    ...base,
    state,
    position: detail.position == null ? null : Math.max(0, finite(detail.position, 0)),
  });
}

export function createMidiOutputPreviewState() {
  return Object.freeze({
    note: null,
    activeNotes: Object.freeze([]),
    control: null,
    controls: Object.freeze([]),
    clock: null,
    clocks: Object.freeze([]),
    timebase: null,
    timebases: Object.freeze([]),
    transport: null,
    transports: Object.freeze([]),
    last: null,
    eventCount: 0,
  });
}

function sameSignal(left, right) {
  return left?.routeId === right?.routeId && left?.sourceId === right?.sourceId;
}

function retainSignal(list, event, limit = MAX_RETAINED_SIGNALS) {
  return Object.freeze([
    event,
    ...(Array.isArray(list) ? list : []).filter((entry) => !sameSignal(entry, event)),
  ].slice(0, limit));
}

function retainActiveNotes(list, event) {
  const keyMatches = (entry) => (
    sameSignal(entry, event)
    && entry.voiceId === event.voiceId
  );
  const remaining = (Array.isArray(list) ? list : []).filter((entry) => !keyMatches(entry));
  return Object.freeze(event.action === "on" ? [event, ...remaining] : remaining);
}

export function reduceMidiOutputPreview(state, detail) {
  const current = state && typeof state === "object"
    ? state
    : createMidiOutputPreviewState();
  const event = normalizeMidiOutputPreview(detail);
  const next = {
    ...current,
    [event.kind]: event,
    last: event,
    eventCount: Math.max(0, Math.trunc(finite(current.eventCount, 0))) + 1,
  };
  if (event.kind === "note") next.activeNotes = retainActiveNotes(current.activeNotes, event);
  if (event.kind === "control") next.controls = retainSignal(current.controls, event);
  if (event.kind === "clock") next.clocks = retainSignal(current.clocks, event, 4);
  if (event.kind === "timebase") next.timebases = retainSignal(current.timebases, event, 4);
  if (event.kind === "transport") next.transports = retainSignal(current.transports, event, 4);
  return Object.freeze(next);
}

export function emitMidiOutputPreview(detail, runtime = globalThis) {
  const normalized = normalizeMidiOutputPreview(detail);
  if (typeof runtime?.dispatchEvent !== "function") return normalized;
  const EventConstructor = runtime.CustomEvent ?? globalThis.CustomEvent;
  if (typeof EventConstructor !== "function") return normalized;
  runtime.dispatchEvent(new EventConstructor(MIDI_OUTPUT_PREVIEW_EVENT, {
    detail: normalized,
  }));
  return normalized;
}

const OUTPUT_MONITORS = new WeakMap();

function element(doc, tagName, className = "", value = "") {
  const node = doc.createElement(tagName);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function setText(node, value) {
  const next = String(value ?? "");
  if (node && node.textContent !== next) node.textContent = next;
}

function humanizeIdentifier(value) {
  return text(value, "Instrument value")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nearest(node, predicate) {
  let current = node;
  while (current && typeof current === "object") {
    if (predicate(current)) return current;
    current = current.parentNode;
  }
  return null;
}

function matches(node, selector) {
  try { return Boolean(node?.matches?.(selector)); } catch { return false; }
}

function excludedControl(control) {
  return Boolean(nearest(control, (node) => (
    matches(node, ".midi-output-monitor")
    || matches(node, ".midi-toolbar")
    || matches(node, ".header-settings-menu")
    || matches(node, ".wax-midi-panel")
    || matches(node, ".mobile-instrument-nav")
    || matches(node, ".tools-nav")
    || node.getAttribute?.("data-no-midi-preview") != null
  )));
}

function controlIdentity(control) {
  const voice = nearest(control, (node) => node.getAttribute?.("data-voice-id") != null);
  const voiceId = voice?.getAttribute?.("data-voice-id");
  const parameterKey = control.getAttribute?.("data-parameter-key");
  return text(
    control.getAttribute?.("data-midi-signal")
      ?? control.getAttribute?.("data-parameter-id")
      ?? (voiceId && parameterKey ? `${voiceId}:${parameterKey}` : "")
      ?? control.id
      ?? control.name,
    control.id || control.name || "control",
  );
}

function controlLabel(control) {
  const explicit = control.getAttribute?.("data-midi-label")
    ?? control.getAttribute?.("aria-label");
  if (text(explicit)) return text(explicit);
  const label = nearest(control, (node) => String(node.tagName ?? "").toUpperCase() === "LABEL");
  const heading = label?.querySelector?.("b, .field-label, [data-control-label]");
  return text(heading?.textContent, humanizeIdentifier(controlIdentity(control)));
}

function formattedControlValue(control) {
  const id = text(control.id);
  const doc = control.ownerDocument;
  const associated = id ? doc?.querySelector?.(`output[for="${id}"]`) : null;
  return text(associated?.textContent, text(control.value));
}

function numericControlDetail(control, routeId) {
  if (!control || excludedControl(control)) return null;
  const tagName = String(control.tagName ?? "").toUpperCase();
  if (tagName !== "INPUT" || String(control.type ?? "").toLowerCase() !== "range") return null;
  if (control.disabled || control.getAttribute?.("aria-disabled") === "true") return null;
  const min = finite(control.min, 0);
  const max = finite(control.max, 1);
  if (!(max > min)) return null;
  const label = controlLabel(control);
  return {
    kind: "control",
    routeId,
    source: label,
    sourceId: controlIdentity(control),
    label,
    rawValue: finite(control.value, min),
    min,
    max,
    displayValue: formattedControlValue(control),
  };
}

function displayedNumber(value, pattern) {
  const match = text(value).replace(/−/g, "-").match(pattern);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? { number, unit: text(match[2]) } : null;
}

function clockDetailForControl(control, routeId) {
  const identity = controlIdentity(control);
  const label = controlLabel(control);
  const searchable = `${identity} ${label}`.toLowerCase();
  const displayValue = formattedControlValue(control);
  const bpm = displayedNumber(displayValue, /([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(BPM)\b/i);
  if (bpm) {
    return {
      kind: "clock",
      routeId,
      source: label,
      sourceId: identity,
      bpm: bpm.number,
      ppqn: 24,
      running: null,
    };
  }

  const explicitUnit = text(control.getAttribute?.("data-midi-timebase"));
  const displayedRate = displayedNumber(
    displayValue,
    /([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*((?:cyc(?:le)?s?|steps?|oct(?:ave)?s?|rev(?:olution)?s?)\s*\/\s*s(?:ec(?:ond)?s?)?|Hz)\b/i,
  );
  if (explicitUnit || (displayedRate && /speed|rate|tempo|period|cycle/.test(searchable))) {
    return {
      kind: "timebase",
      routeId,
      source: label,
      sourceId: identity,
      rate: displayedRate?.number ?? finite(control.value, 0),
      unit: displayedRate?.unit || explicitUnit || "units/s",
      running: null,
      displayValue,
    };
  }
  return null;
}

function primaryTransport(doc) {
  return doc.querySelector?.("[data-primary-transport]")
    ?? doc.getElementById?.("playButton")
    ?? doc.querySelector?.("#playButton")
    ?? null;
}

function isRunning(control) {
  return Boolean(
    control?.getAttribute?.("aria-pressed") === "true"
    || control?.dataset?.state === "playing"
    || control?.classList?.contains?.("is-playing"),
  );
}

function formatNumber(value) {
  const number = finite(value, 0);
  if (Math.abs(number) >= 100) return number.toFixed(0);
  if (Math.abs(number) >= 10) return number.toFixed(1).replace(/\.0$/, "");
  return number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function createListCard(doc, kind, title, waiting) {
  const card = element(doc, "section", "midi-output-monitor-card");
  card.dataset.kind = kind;
  const heading = element(doc, "h3", "", title);
  const list = element(doc, "ul", "midi-output-monitor-list");
  const placeholder = element(doc, "li", "is-placeholder", waiting);
  list.append(placeholder);
  card.append(heading, list);
  return { card, list };
}

function listRow(doc, primary, secondary) {
  const item = element(doc, "li");
  item.append(
    element(doc, "span", "midi-output-monitor-value", primary),
    element(doc, "small", "", secondary),
  );
  return item;
}

function insertMonitor(host, monitor) {
  const info = [...(host.children ?? [])].find((child) => (
    child.classList?.contains?.("instrument-page-info")
    || String(child.tagName ?? "").toUpperCase() === "FOOTER"
  ));
  if (info && typeof host.insertBefore === "function") host.insertBefore(monitor, info);
  else host.append?.(monitor);
}

function monitorHost(doc) {
  for (const selector of [
    ".node-inspector",
    ".panel",
    ".linear-control-panel",
    ".paint-inspector",
    ".analysis-rail",
    ".control-rail",
    ".fm-drums-shell",
    "main",
  ]) {
    const host = doc.querySelector?.(selector);
    if (host) return host;
  }
  return doc.body ?? null;
}

/**
 * Install the monitor-only MIDI output inspector for one output-capable page.
 * It never requests MIDI permission, calls manager.send(), or claims a mapping.
 */
export function initializeMidiOutputMonitor(
  doc = globalThis.document,
  runtime = globalThis,
  { routeId = "", capability = null } = {},
) {
  if (!doc || capability?.midiOutput !== true || runtime?.MorphazoidWAX) return null;
  if (OUTPUT_MONITORS.has(doc)) return OUTPUT_MONITORS.get(doc);
  const host = monitorHost(doc);
  if (!host || typeof doc.createElement !== "function") return null;

  const monitor = element(doc, "section", "midi-output-monitor");
  monitor.id = "midiOutputMonitor";
  monitor.dataset.routeId = text(routeId);
  const details = element(doc, "details", "midi-output-monitor-disclosure");
  details.open = true;
  const summary = element(doc, "summary", "midi-output-monitor-summary");
  const titleWrap = element(doc, "span", "midi-output-monitor-title");
  const activity = element(doc, "i", "midi-output-monitor-activity");
  activity.setAttribute("aria-hidden", "true");
  const title = element(doc, "strong", "", "MIDI OUT MONITOR");
  title.id = "midiOutputMonitorTitle";
  titleWrap.append(activity, title);
  const badge = element(doc, "span", "midi-output-monitor-badge", "PREVIEW · NOT ROUTED");
  summary.append(titleWrap, badge);
  monitor.setAttribute("aria-labelledby", title.id);

  const body = element(doc, "div", "midi-output-monitor-body");
  const grid = element(doc, "div", "midi-output-monitor-grid");
  const notes = createListCard(doc, "note", "NOTES", "WAITING FOR INSTRUMENT SIGNAL");
  const controls = createListCard(doc, "control", "LIVE VALUES", "MOVE AN INSTRUMENT CONTROL");
  const timing = createListCard(doc, "timing", "CLOCK / TIMEBASE", "NO CLOCK SOURCE");
  const transports = createListCard(doc, "transport", "TRANSPORT", "NO PRIMARY TRANSPORT");
  grid.append(notes.card, controls.card, timing.card, transports.card);
  const latest = element(doc, "output", "midi-output-monitor-latest", "Waiting for output preview events");
  latest.setAttribute("aria-label", "Latest output preview");
  latest.setAttribute("aria-live", "off");
  const disclosure = element(
    doc,
    "p",
    "midi-output-monitor-disclosure-copy",
    "PREVIEW ONLY · VALUES ARE UNMAPPED · NO MIDI IS SENT",
  );
  body.append(grid, latest, disclosure);
  details.append(summary, body);
  monitor.append(details);
  insertMonitor(host, monitor);
  doc.body?.classList?.add?.("has-midi-output-monitor");

  let state = createMidiOutputPreviewState();
  let renderFrame = null;
  const timers = new Map();
  const noteTimers = new Map();
  const controlSignatures = new WeakMap();
  const eventTarget = typeof runtime?.addEventListener === "function"
    ? runtime
    : doc.defaultView;

  const replaceList = (list, items, fallback) => {
    list.replaceChildren?.(...(items.length ? items : [element(doc, "li", "is-placeholder", fallback)]));
  };
  const pulse = (kind) => {
    const card = kind === "clock" || kind === "timebase"
      ? timing.card
      : kind === "note" ? notes.card
        : kind === "control" ? controls.card
          : transports.card;
    card.classList?.add?.("is-updated");
    const oldTimer = timers.get(card);
    if (oldTimer != null) runtime.clearTimeout?.(oldTimer);
    const timer = runtime.setTimeout?.(() => {
      card.classList?.remove?.("is-updated");
      timers.delete(card);
    }, 180);
    if (timer != null) timers.set(card, timer);
  };
  const render = () => {
    renderFrame = null;
    const visibleNotes = state.activeNotes.length
      ? state.activeNotes.slice(0, 3)
      : state.note ? [state.note] : [];
    const noteRows = visibleNotes.map((entry) => listRow(
      doc,
      `${entry.noteName} · ${entry.note} · VEL ${entry.velocity}`,
      [
        entry.source,
        entry.frequencyHz > 0 ? `${formatNumber(entry.frequencyHz)} HZ` : "",
        entry.durationMs != null ? `GATE ${formatNumber(entry.durationMs)} MS CANDIDATE` : "",
        `${entry.action.toUpperCase()} · CH ${entry.channel}`,
        `${state.activeNotes.length} ACTIVE`,
      ].filter(Boolean).join(" · "),
    ));
    replaceList(notes.list, noteRows, "WAITING FOR INSTRUMENT SIGNAL");

    const controlRows = state.controls.slice(0, 4).map((entry) => listRow(
      doc,
      entry.displayValue || `${formatNumber(entry.rawValue)}${entry.unit ? ` ${entry.unit}` : ""}`,
      `${entry.source} · CC — · ${entry.value}/127 CANDIDATE`,
    ));
    replaceList(controls.list, controlRows, "MOVE AN INSTRUMENT CONTROL");

    const timingRows = [
      ...state.clocks.slice(0, 2).map((entry) => listRow(
        doc,
        `${formatNumber(entry.bpm)} BPM`,
        `${entry.source} · ${entry.ppqn} PPQN CANDIDATE · ${entry.running == null ? "STATE UNASSIGNED" : entry.running ? "RUNNING" : "STOPPED"}`,
      )),
      ...state.timebases.slice(0, 2).map((entry) => listRow(
        doc,
        entry.displayValue || `${formatNumber(entry.rate)} ${entry.unit}`,
        `${entry.source} · TIMEBASE UNMAPPED · ${entry.running == null ? "STATE UNASSIGNED" : entry.running ? "RUNNING" : "STOPPED"}`,
      )),
    ].slice(0, 3);
    replaceList(timing.list, timingRows, "NO CLOCK SOURCE");

    const transportRows = state.transports.slice(0, 3).map((entry) => listRow(
      doc,
      entry.state.toUpperCase(),
      `${entry.source}${entry.position == null ? "" : ` · POSITION ${formatNumber(entry.position)}`} · PREVIEW ONLY`,
    ));
    replaceList(transports.list, transportRows, "NO PRIMARY TRANSPORT");

    setText(badge, state.eventCount > 0 ? "LIVE · NOT ROUTED" : "PREVIEW · NOT ROUTED");
    if (state.last) {
      const lastText = state.last.kind === "note"
        ? `${state.last.source} · ${state.last.noteName} ${state.last.action} · velocity ${state.last.velocity}${state.last.durationMs == null ? "" : ` · ${formatNumber(state.last.durationMs)} ms preview gate`}`
        : state.last.kind === "control"
          ? `${state.last.source} · ${state.last.value}/127 candidate`
          : state.last.kind === "clock"
            ? `${formatNumber(state.last.bpm)} BPM clock candidate`
            : state.last.kind === "timebase"
              ? `${state.last.source} · timebase ${formatNumber(state.last.rate)} ${state.last.unit}`
              : `${state.last.source} · ${state.last.state}`;
      setText(latest, `LAST · ${lastText}`);
    }
  };
  const scheduleRender = () => {
    if (renderFrame != null) return;
    if (typeof runtime?.requestAnimationFrame === "function") {
      renderFrame = runtime.requestAnimationFrame(render);
    } else {
      render();
    }
  };
  const accept = (detail) => {
    if (detail?.routeId && routeId && detail.routeId !== routeId) return null;
    state = reduceMidiOutputPreview(state, detail);
    if (state.last.kind === "note") {
      const noteKey = `${state.last.routeId}:${state.last.sourceId}:${state.last.voiceId}`;
      const previousTimer = noteTimers.get(noteKey);
      if (previousTimer != null) runtime.clearTimeout?.(previousTimer);
      noteTimers.delete(noteKey);
      if (state.last.action === "on" && state.last.durationMs > 0) {
        const onEvent = state.last;
        const timer = runtime.setTimeout?.(() => {
          noteTimers.delete(noteKey);
          accept({
            ...onEvent,
            action: "off",
            velocity: 0,
            durationMs: null,
          });
        }, onEvent.durationMs);
        if (timer != null) noteTimers.set(noteKey, timer);
      }
    }
    pulse(state.last.kind);
    scheduleRender();
    return state.last;
  };
  const handlePreview = (event) => accept(event?.detail);
  const emit = (detail) => emitMidiOutputPreview(detail, eventTarget ?? runtime);

  const handleControl = (event) => {
    if (event?.isTrusted !== true) return;
    const control = event.target;
    const detail = numericControlDetail(control, routeId);
    if (!detail) return;
    const enqueue = runtime?.queueMicrotask ?? globalThis.queueMicrotask;
    const publish = () => {
      const current = numericControlDetail(control, routeId);
      if (!current) return;
      const signature = `${current.rawValue}\u0000${current.displayValue}`;
      if (controlSignatures.get(control) === signature) return;
      controlSignatures.set(control, signature);
      emit(current);
      const timingDetail = clockDetailForControl(control, routeId);
      if (timingDetail) emit(timingDetail);
    };
    if (typeof enqueue === "function") enqueue.call(runtime, publish);
    else Promise.resolve().then(publish);
  };
  eventTarget?.addEventListener?.(MIDI_OUTPUT_PREVIEW_EVENT, handlePreview);
  doc.addEventListener?.("input", handleControl, true);
  doc.addEventListener?.("change", handleControl, true);

  const transport = primaryTransport(doc);
  let transportState = null;
  const publishTransport = () => {
    if (!transport || excludedControl(transport)) return;
    const nextState = isRunning(transport) ? "start" : "stop";
    if (transportState === nextState) return;
    transportState = nextState;
    emit({
      kind: "transport",
      routeId,
      source: controlLabel(transport),
      sourceId: controlIdentity(transport),
      state: nextState,
    });
  };
  if (transport && !excludedControl(transport)) {
    const initial = normalizeMidiOutputPreview({
      kind: "transport",
      routeId,
      source: controlLabel(transport),
      sourceId: controlIdentity(transport),
      state: isRunning(transport) ? "start" : "stop",
    });
    state = Object.freeze({
      ...state,
      transport: initial,
      transports: Object.freeze([initial]),
    });
    transportState = initial.state;
  }
  const Observer = doc?.defaultView?.MutationObserver ?? runtime?.MutationObserver;
  const transportObserver = transport && typeof Observer === "function"
    ? new Observer(publishTransport)
    : null;
  transportObserver?.observe?.(transport, {
    attributes: true,
    attributeFilter: ["aria-pressed", "aria-disabled", "class", "data-state", "data-no-midi-preview"],
  });
  render();

  let destroyed = false;
  let initialTimingTimer = null;
  if (typeof runtime?.setTimeout === "function") {
    initialTimingTimer = runtime.setTimeout(() => {
      initialTimingTimer = null;
      if (destroyed) return;
      for (const candidate of doc.querySelectorAll?.("input[type='range']") ?? []) {
        if (excludedControl(candidate)) continue;
        const timingDetail = clockDetailForControl(candidate, routeId);
        if (timingDetail) emit(timingDetail);
      }
    }, 0);
  }
  let api = null;
  const handlePageHide = (event) => {
    if (!event?.persisted) api?.destroy();
  };
  eventTarget?.addEventListener?.("pagehide", handlePageHide);
  api = Object.freeze({
    monitor,
    details,
    get state() { return state; },
    accept,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      eventTarget?.removeEventListener?.(MIDI_OUTPUT_PREVIEW_EVENT, handlePreview);
      eventTarget?.removeEventListener?.("pagehide", handlePageHide);
      doc.removeEventListener?.("input", handleControl, true);
      doc.removeEventListener?.("change", handleControl, true);
      transportObserver?.disconnect?.();
      if (renderFrame != null) runtime.cancelAnimationFrame?.(renderFrame);
      if (initialTimingTimer != null) runtime.clearTimeout?.(initialTimingTimer);
      initialTimingTimer = null;
      for (const timer of timers.values()) runtime.clearTimeout?.(timer);
      timers.clear();
      for (const timer of noteTimers.values()) runtime.clearTimeout?.(timer);
      noteTimers.clear();
      monitor.remove?.();
      doc.body?.classList?.remove?.("has-midi-output-monitor");
      OUTPUT_MONITORS.delete(doc);
    },
  });
  OUTPUT_MONITORS.set(doc, api);
  return api;
}
