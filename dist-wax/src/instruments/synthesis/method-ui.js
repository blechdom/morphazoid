import { formatParameter, normalizedParameter, parameterValue } from "./catalog.js";

const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const XY_INSET = .06;
const XY_SPAN = 1 - XY_INSET * 2;
const CURVE_TOP = 8 / 64;
const CURVE_BOTTOM = 56 / 64;
const CURVE_SPAN = CURVE_BOTTOM - CURVE_TOP;
let nextXyHelpId = 0;
const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** Only parameters that are genuinely coordinates or sampled values receive a
 * composite editor. The ordinary native controls remain present for precision. */
export const METHOD_EDITOR_SCHEMAS = deepFreeze({
  granular: [
    { kind: "xy", label: "Source region", x: "source-position", y: "position-spray", xLabel: "Source position", yLabel: "Position spray" },
    { kind: "xy", label: "Grain overlap", x: "grain-size", y: "density", xLabel: "Grain size", yLabel: "Density" },
  ],
  subtractive: [
    { kind: "xy", label: "Cutoff / resonance", x: "cutoff", y: "resonance", xLabel: "Cutoff", yLabel: "Resonance" },
  ],
  fm: [
    { kind: "xy", label: "Primary FM operator", x: "frequency-ratio", y: "index", xLabel: "Frequency ratio", yLabel: "Modulation index" },
    { kind: "xy", label: "Second FM operator", x: "second-ratio", y: "second-depth", xLabel: "Frequency ratio", yLabel: "Modulation depth" },
  ],
  pm: [
    { kind: "xy", label: "Primary PM operator", x: "frequency-ratio", y: "phase-depth", xLabel: "Frequency ratio", yLabel: "Phase depth" },
    { kind: "xy", label: "Second PM operator", x: "second-ratio", y: "second-depth", xLabel: "Frequency ratio", yLabel: "Phase depth" },
  ],
  waveshaping: [
    { kind: "xy", label: "Transfer drive / bias", x: "drive", y: "asymmetry", xLabel: "Drive", yLabel: "Asymmetry" },
  ],
  "multiple-wavetable": [
    { kind: "xy", label: "Four-corner vector", x: "vector-x", y: "vector-y", xLabel: "Vector X", yLabel: "Vector Y" },
  ],
  "wave-terrain": [
    { kind: "xy", label: "Orbit radii", x: "x-radius", y: "y-radius", xLabel: "X radius", yLabel: "Y radius" },
    { kind: "xy", label: "Terrain origin", x: "x-offset", y: "y-offset", xLabel: "X offset", yLabel: "Y offset" },
  ],
  "waveform-segment": [
    { kind: "xy", label: "Segment breakpoint", x: "breakpoint", y: "segment-level", xLabel: "Time", yLabel: "Level" },
  ],
  graphic: [
    { kind: "curve", label: "Waveform points", ids: ["point-1", "point-2", "point-3", "point-4", "point-5", "point-6", "point-7", "point-8"], style: "line" },
  ],
  additive: [
    { kind: "curve", label: "Partial amplitudes", ids: ["partial-1", "partial-2", "partial-3", "partial-4", "partial-5", "partial-6", "partial-7", "partial-8"], style: "bars" },
  ],
  chebyshev: [
    { kind: "curve", label: "Chebyshev coefficients", ids: ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"], style: "bars" },
  ],
  "phase-distortion": [
    { kind: "xy", label: "Phase-transfer breakpoint", x: "breakpoint", y: "distortion-amount", xLabel: "Breakpoint", yLabel: "Distortion" },
  ],
  physical: [
    { kind: "xy", label: "Excitation / observation positions", x: "strike-position", y: "pickup", xLabel: "Strike along chain", yLabel: "Pickup along chain" },
  ],
  modal: [
    { kind: "xy", label: "Modal material", x: "inharmonicity", y: "modal-decay", xLabel: "Inharmonicity", yLabel: "Modal decay" },
  ],
  "phase-vocoder": [
    { kind: "xy", label: "Spectral passband endpoints", x: "low-cut", y: "high-cut", xLabel: "Endpoint A", yLabel: "Endpoint B" },
  ],
  "vector-phase": [
    { kind: "xy", label: "Vector breakpoint", x: "horizontal-breakpoint", y: "vertical-breakpoint", xLabel: "Horizontal", yLabel: "Vertical" },
  ],
  "neural-latent": [
    { kind: "xy", label: "Latent plane X/Y", x: "latent-x", y: "latent-y", xLabel: "Latent X", yLabel: "Latent Y" },
    { kind: "xy", label: "Latent plane Z/W", x: "latent-z", y: "latent-w", xLabel: "Latent Z", yLabel: "Latent W" },
  ],
  "fdtd-membrane": [
    { kind: "xy", label: "Membrane strike", x: "strike-x", y: "strike-y", xLabel: "Strike X", yLabel: "Strike Y" },
    { kind: "xy", label: "Membrane pickup", x: "pickup-x", y: "pickup-y", xLabel: "Pickup X", yLabel: "Pickup Y" },
  ],
  "formant-voice": [
    { kind: "curve", label: "Formant center frequencies", ids: ["f1", "f2", "f3", "f4"], style: "line", domain: { min: 200, max: 5500, scale: "log", unit: "Hz" } },
    { kind: "curve", label: "Formant bandwidths", ids: ["b1", "b2", "b3", "b4"], style: "bars", domain: { min: 30, max: 800, scale: "log", unit: "Hz" } },
  ],
});

const GROUPS = Object.freeze([
  { id: "source", label: "Source / geometry", match: /(?:^|-)(?:source|wave|waveform|wavetable|wavelet|algorithm|formula|model|topology|mode|response|family|window|distribution|interpolation|boundary|reconstruction|carrier|modulator|corner|playback|loop|direction)(?:-|$)/ },
  { id: "pitch", label: "Pitch / position", match: /(?:^|-)(?:ratio|transpose|tune|detune|position|offset|phase|rotation|breakpoint|shift|interval|pitch|aspect|pickup|strike|latent|vector|radius)(?:-|$)/ },
  { id: "motion", label: "Motion / modulation", match: /(?:^|-)(?:rate|speed|motion|drift|jitter|attack|decay|release|time|duration|delay|damping|feedback|scan|density|hold|flutter|regeneration|history|prediction|orbit|vibrato|envelope|evolve)(?:-|$)/ },
  { id: "quality", label: "Randomness / quality", match: /(?:^|-)(?:seed|quality|resolution|oversampling|bit|bits|dither|order|count|steps|stride|grid|poles|probability|chance|random)(?:-|$)/ },
  { id: "dynamics", label: "Dynamics / level", match: /$^/ },
  { id: "spectrum", label: "Spectrum / body", match: /.*/ },
]);

// Some shared words describe very different jobs in different signal paths.
// Keep those known semantics explicit instead of letting a global token guess
// put, for example, spectral phase reconstruction under pitch position.
const GROUP_OVERRIDES = Object.freeze({
  "lpc:pole-radius": "spectrum",
  "modal:strike-hardness": "spectrum",
  "modal:strike-noise": "spectrum",
  "physical:strike-width": "spectrum",
  "phase-vocoder:phase-diffusion": "quality",
  "phase-vocoder:phase-lock": "quality",
  "padsynth:phase-seed": "quality",
  "single-sideband:shift-motion": "motion",
  "fdtd-membrane:strike-hardness": "spectrum",
  "fx-compressor:ratio": "dynamics",
  "fx-compressor:threshold": "dynamics",
  "fx-compressor:knee": "dynamics",
  "fx-compressor:makeup": "dynamics",
  "fx-compressor:detector": "dynamics",
  "fx-expander:ratio": "dynamics",
  "fx-expander:threshold": "dynamics",
  "fx-expander:maximum-reduction": "dynamics",
  "fx-decimator:sample-rate": "quality",
  "fx-reverb:predelay": "motion",
  "bytebeat:shift-a": "source",
  "bytebeat:shift-b": "source",
  "pm:phase-depth": "motion",
  "phase-vocoder:freeze": "motion",
  "physical:mass-count": "source",
  "modal:mode-detune": "pitch",
  "formant-voice:open-quotient": "source",
  "formant-voice:aspiration": "source",
  "formant-voice:frication": "source",
  "granular:grain-size": "motion",
});

/** Group every method parameter exactly once without changing DSP ordering. */
export function groupMethodControls(method) {
  const buckets = new Map(GROUPS.map(group => [group.id, { id: group.id, label: group.label, indexes: [] }]));
  method.controls.forEach((control, index) => {
    const id = control.id.toLowerCase();
    const override = GROUP_OVERRIDES[`${method.id}:${id}`];
    const group = override ? GROUPS.find(candidate => candidate.id === override) : GROUPS.find(candidate => candidate.match.test(id));
    buckets.get(group.id).indexes.push(index);
  });
  return GROUPS.map(group => buckets.get(group.id)).filter(group => group.indexes.length);
}

function element(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.append(node);
  return node;
}

function controlLookup(method) {
  return new Map(method.controls.map((control, index) => [control.id, { control, index }]));
}

function formatted(entry, normalized) {
  return formatParameter(entry.control, clamp01(normalized));
}

function curvePosition(entry, normalized, domain) {
  if (!domain) return clamp01(normalized);
  const physical = parameterValue(entry.control, clamp01(normalized));
  return clamp01(domain.scale === "log"
    ? Math.log(physical / domain.min) / Math.log(domain.max / domain.min)
    : (physical - domain.min) / (domain.max - domain.min));
}

function normalizedCurveValue(entry, position, domain) {
  if (!domain) return clamp01(position);
  const physical = domain.scale === "log"
    ? domain.min * (domain.max / domain.min) ** clamp01(position)
    : domain.min + (domain.max - domain.min) * clamp01(position);
  return normalizedParameter(entry.control, physical);
}

function createXyEditor(parent, schema, lookup, readValues, emit, listen) {
  const x = lookup.get(schema.x), y = lookup.get(schema.y);
  if (!x || !y) return null;
  const figure = element("section", "synthesis-gesture synthesis-gesture--xy", parent);
  const title = element("h3", "synthesis-gesture-title", figure); title.textContent = schema.label;
  const pad = element("div", "synthesis-xy-pad", figure);
  pad.setAttribute("role", "group"); pad.setAttribute("aria-label", schema.label);
  pad.innerHTML = '<span class="synthesis-xy-grid" aria-hidden="true"></span>';
  const handle = element("button", "synthesis-xy-handle", pad);
  handle.type = "button";
  handle.setAttribute("aria-roledescription", "two-axis control");
  handle.setAttribute("aria-label", `${schema.xLabel} and ${schema.yLabel}`);
  handle.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Home Enter Space");
  const help = element("span", "sr-only", figure);
  help.id = `synthesis-xy-help-${++nextXyHelpId}`;
  help.textContent = "Use the arrow keys to adjust both axes. Hold Shift for larger steps. Press Home, Enter, or Space to center.";
  handle.setAttribute("aria-describedby", help.id);
  const xAxis = element("span", "synthesis-xy-axis synthesis-xy-axis--x", pad); xAxis.textContent = schema.xLabel;
  const yAxis = element("span", "synthesis-xy-axis synthesis-xy-axis--y", pad); yAxis.textContent = schema.yLabel;
  let drag = null;
  const paint = () => {
    const values = readValues(), xv = clamp01(values[x.index]), yv = clamp01(values[y.index]);
    handle.style.left = `${(XY_INSET + xv * XY_SPAN) * 100}%`;
    handle.style.top = `${(XY_INSET + (1 - yv) * XY_SPAN) * 100}%`;
    handle.setAttribute("aria-label", `${schema.xLabel} ${formatted(x, xv)}; ${schema.yLabel} ${formatted(y, yv)}`);
    handle.title = `${schema.xLabel} ${formatted(x, xv)} · ${schema.yLabel} ${formatted(y, yv)}`;
  };
  const point = event => {
    const bounds = pad.getBoundingClientRect();
    const rawX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const rawY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
    return {
      x: clamp01((rawX - XY_INSET) / XY_SPAN),
      y: clamp01((1 - XY_INSET - rawY) / XY_SPAN),
    };
  };
  const update = next => { emit([{ index: x.index, value: next.x }, { index: y.index, value: next.y }]); paint(); };
  listen(handle, "pointerdown", event => {
    if (drag || event.isPrimary === false || event.button > 0) return;
    drag = event.pointerId; handle.setPointerCapture?.(event.pointerId); handle.focus({ preventScroll: true });
    update(point(event)); event.preventDefault();
  });
  listen(handle, "pointermove", event => { if (drag === event.pointerId) { update(point(event)); event.preventDefault(); } });
  const finish = event => {
    if (drag !== event.pointerId) return;
    try { handle.releasePointerCapture?.(drag); } catch { /* automatic release */ }
    drag = null;
  };
  listen(handle, "pointerup", finish); listen(handle, "pointercancel", finish); listen(handle, "lostpointercapture", finish);
  listen(handle, "keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const values = readValues(), amount = event.shiftKey ? .05 : .01;
    const next = ["Home", "Enter", " "].includes(event.key) ? { x: .5, y: .5 } : {
      x: clamp01(values[x.index] + (event.key === "ArrowRight" ? amount : event.key === "ArrowLeft" ? -amount : 0)),
      y: clamp01(values[y.index] + (event.key === "ArrowUp" ? amount : event.key === "ArrowDown" ? -amount : 0)),
    };
    update(next);
  });
  listen(handle, "click", event => {
    // Assistive technology can activate a button without dispatching its
    // keyboard event. Pointer clicks already update on pointerdown.
    if (event.detail === 0) update({ x: .5, y: .5 });
  });
  paint();
  return { paint };
}

function createCurveEditor(parent, schema, lookup, readValues, emit, listen) {
  const entries = schema.ids.map(id => lookup.get(id)).filter(Boolean);
  if (entries.length < 2) return null;
  const figure = element("section", `synthesis-gesture synthesis-gesture--curve is-${schema.style}`, parent);
  const title = element("h3", "synthesis-gesture-title", figure); title.textContent = schema.label;
  const graph = element("div", "synthesis-curve-pad", figure);
  graph.setAttribute("role", "group"); graph.setAttribute("aria-label", schema.label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 64"); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("aria-hidden", "true");
  const grid = document.createElementNS(svg.namespaceURI, "path"); grid.setAttribute("class", "synthesis-curve-grid"); grid.setAttribute("d", "M0 16H100M0 32H100M0 48H100");
  const trace = document.createElementNS(svg.namespaceURI, "path"); trace.setAttribute("class", "synthesis-curve-trace");
  const bars = entries.map(() => {
    const line = document.createElementNS(svg.namespaceURI, "path"); line.setAttribute("class", "synthesis-curve-bar"); svg.append(line); return line;
  });
  svg.prepend(grid); svg.append(trace); graph.append(svg);
  let drag = null;
  const handles = entries.map((entry, index) => {
    const button = element("button", "synthesis-curve-handle", graph);
    button.type = "button"; button.dataset.curveIndex = String(index); button.setAttribute("role", "slider");
    button.setAttribute("aria-orientation", "vertical");
    button.setAttribute("aria-label", entry.control.label); button.setAttribute("aria-valuemin", "0"); button.setAttribute("aria-valuemax", "1");
    const badge = element("span", "synthesis-curve-index", button); badge.textContent = String(index + 1);
    return button;
  });
  const xFor = index => entries.length === 1 ? 50 : 8 + index / (entries.length - 1) * 84;
  const zeroFor = entry => entry.control.min < 0 && entry.control.max > 0 ? normalizedParameter(entry.control, 0) : 0;
  const paint = () => {
    const values = readValues();
    const points = entries.map((entry, index) => ({ x: xFor(index), y: 56 - curvePosition(entry, values[entry.index], schema.domain) * 48 }));
    trace.setAttribute("d", schema.style === "line" ? `M${points.map(point => `${point.x},${point.y}`).join("L")}` : "");
    points.forEach((point, index) => {
      const entry = entries[index], value = clamp01(values[entry.index]);
      const baseline = 56 - (schema.domain ? 0 : zeroFor(entry)) * 48;
      bars[index].setAttribute("d", schema.style === "bars" ? `M${point.x},${baseline}V${point.y}` : "");
      const handle = handles[index]; handle.style.left = `${point.x}%`; handle.style.top = `${point.y / 64 * 100}%`;
      handle.setAttribute("aria-valuenow", String(value)); handle.setAttribute("aria-valuetext", formatted(entry, value));
      handle.title = `${entry.control.label}: ${formatted(entry, value)}`;
    });
  };
  const valueFrom = event => {
    const bounds = graph.getBoundingClientRect();
    const rawY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
    return clamp01((CURVE_BOTTOM - rawY) / CURVE_SPAN);
  };
  handles.forEach((handle, index) => {
    const entry = entries[index];
    listen(handle, "pointerdown", event => {
      if (drag || event.isPrimary === false || event.button > 0) return;
      drag = { pointerId: event.pointerId, index }; handle.setPointerCapture?.(event.pointerId); handle.focus({ preventScroll: true });
      emit([{ index: entry.index, value: normalizedCurveValue(entry, valueFrom(event), schema.domain) }]); paint(); event.preventDefault();
    });
    listen(handle, "pointermove", event => {
      if (drag?.pointerId !== event.pointerId || drag.index !== index) return;
      emit([{ index: entry.index, value: normalizedCurveValue(entry, valueFrom(event), schema.domain) }]); paint(); event.preventDefault();
    });
    const finish = event => {
      if (drag?.pointerId !== event.pointerId || drag.index !== index) return;
      try { handle.releasePointerCapture?.(event.pointerId); } catch { /* automatic release */ }
      drag = null;
    };
    listen(handle, "pointerup", finish); listen(handle, "pointercancel", finish); listen(handle, "lostpointercapture", finish);
    listen(handle, "keydown", event => {
      const direction = { ArrowDown: -1, ArrowLeft: -1, ArrowUp: 1, ArrowRight: 1, PageDown: -10, PageUp: 10 }[event.key];
      if (direction === undefined && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const current = clamp01(readValues()[entry.index]);
      const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : clamp01(current + direction * (event.shiftKey ? .05 : .01));
      emit([{ index: entry.index, value: next }]); paint();
    });
  });
  paint();
  return { paint };
}

/** Mount the technique-shaped direct editor for one method, if it has one. */
export function createMethodGestureEditor(host, method, values, onChange = () => {}) {
  if (!host?.replaceChildren) throw new TypeError("Method editor needs a host element");
  const schema = METHOD_EDITOR_SCHEMAS[method.id] || [];
  let current = [...values];
  const abort = new AbortController();
  const listen = (target, name, handler) => target.addEventListener(name, handler, { signal: abort.signal });
  const root = element("div", "synthesis-gesture-grid");
  const lookup = controlLookup(method);
  const editors = [];
  const emit = changes => {
    current = [...current];
    for (const { index, value } of changes) current[index] = clamp01(value);
    onChange(changes.map(({ index }) => ({ index, value: current[index] })));
  };
  for (const definition of schema) {
    const editor = definition.kind === "xy"
      ? createXyEditor(root, definition, lookup, () => current, emit, listen)
      : createCurveEditor(root, definition, lookup, () => current, emit, listen);
    if (editor) editors.push(editor);
  }
  host.hidden = editors.length === 0;
  host.replaceChildren(...(editors.length ? [root] : []));
  return Object.freeze({
    setValue(next) { current = [...next]; editors.forEach(editor => editor.paint()); },
    destroy() { abort.abort(); root.remove(); host.hidden = true; },
  });
}
