import { createKnobControl } from "./knob.js";

/** Conventional linear ADSR editor. Owns UI only; sustain lasts until note-off. */
const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULTS = Object.freeze({ attack: 0.018, decay: 0.22, sustain: 0.8, release: 0.35 });
const STAGES = Object.freeze([
  { id: "attack", letter: "A", label: "Attack", min: 0.001, max: 12, step: 0.001, unit: "s" },
  { id: "decay", letter: "D", label: "Decay", min: 0.002, max: 12, step: 0.002, unit: "s" },
  { id: "sustain", letter: "S", label: "Sustain", min: 0, max: 1, step: 0.01, unit: "%" },
  { id: "release", letter: "R", label: "Release", min: 0.003, max: 16, step: 0.003, unit: "s" },
]);
const HEIGHT = 184, TOP = 28, BASE = 136, PAD = 28, HANDLE = 48;
let nextId = 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rounded = value => Number(value.toFixed(6));
const numberText = value => String(rounded(value));
const secondsText = value => value < 1 ? `${numberText(value * 1000)} milliseconds` : `${numberText(value)} seconds`;

function normalized(input, fallback = DEFAULTS) {
  return Object.fromEntries(STAGES.map(stage => {
    const value = Number(input?.[stage.id]);
    return [stage.id, Number.isFinite(value) ? clamp(value, stage.min, stage.max) : fallback[stage.id]];
  }));
}

function element(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.append(node);
  return node;
}

function svgElement(tag, attributes, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
}

/**
 * Append an accessible graph editor to host.
 * setValue never emits; onChange receives a fresh {attack, decay, sustain, release}.
 * Cancellation restores the gesture's starting value. destroy removes only this UI.
 */
export function createEnvelopeEditor(host, { onChange = () => {} } = {}) {
  if (!host?.append) throw new TypeError("An envelope editor needs a host element.");
  const id = `synth-envelope-${++nextId}`;
  const abort = new AbortController();
  const listen = (target, type, callback) => target.addEventListener(type, callback, { signal: abort.signal });
  let value = { ...DEFAULTS }, gesture = null, destroyed = false;
  let width = 360, geometry;
  const root = element("div", "synth-envelope", host);
  const graph = element("div", "synth-envelope__graph", root);
  const svg = svgElement("svg", { class: "synth-envelope__drawing", role: "img", "aria-describedby": `${id}-help` }, graph);
  const heldArea = svgElement("rect", { class: "synth-envelope__held", y: TOP, height: BASE - TOP }, svg);
  const grid = svgElement("path", { class: "synth-envelope__grid" }, svg);
  const noteOff = svgElement("path", { class: "synth-envelope__note-off" }, svg);
  const curve = svgElement("path", { class: "synth-envelope__curve" }, svg);
  const leaderLines = STAGES.map(() => svgElement("path", { class: "synth-envelope__leader" }, svg));
  const knots = STAGES.map(() => svgElement("circle", { class: "synth-envelope__knot", r: 3 }, svg));
  const levelOne = svgElement("text", { x: 7, y: TOP + 4, class: "synth-envelope__axis" }, svg);
  levelOne.textContent = "1";
  const levelZero = svgElement("text", { x: 7, y: BASE + 4, class: "synth-envelope__axis" }, svg);
  levelZero.textContent = "0";
  const zeroTime = svgElement("text", { x: PAD, y: HEIGHT - 8, class: "synth-envelope__axis" }, svg);
  zeroTime.textContent = "0 s";
  const endTime = svgElement("text", { y: HEIGHT - 8, "text-anchor": "end", class: "synth-envelope__axis" }, svg);
  const heldText = svgElement("text", { y: BASE + 20, "text-anchor": "middle", class: "synth-envelope__axis" }, svg);
  heldText.textContent = "held";

  const handles = STAGES.map(stage => {
    const button = element("button", "synth-envelope__handle", graph);
    button.type = "button";
    button.dataset.stage = stage.id;
    button.setAttribute("role", "slider");
    button.setAttribute("aria-label", `${stage.label} ${stage.id === "sustain" ? "level" : "time"}`);
    button.setAttribute("aria-orientation", stage.id === "sustain" ? "vertical" : "horizontal");
    button.setAttribute("aria-valuemin", stage.min);
    button.setAttribute("aria-valuemax", stage.max);
    button.setAttribute("aria-describedby", `${id}-help`);
    const badge = element("span", "synth-envelope__badge", button);
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = stage.letter;
    listen(button, "pointerdown", event => beginGesture(event, stage, button));
    listen(button, "pointermove", moveGesture);
    listen(button, "pointerup", event => finishGesture(event, false));
    listen(button, "pointercancel", event => finishGesture(event, true));
    listen(button, "lostpointercapture", event => finishGesture(event, true));
    listen(button, "keydown", event => keyChange(event, stage));
    return button;
  });

  const fields = element("div", "synth-envelope__fields", root);
  const knobs = STAGES.map(stage => {
    const percent = stage.id === "sustain";
    const knob = createKnobControl({ id: id + "-" + stage.id, label: stage.label,
      min: stage.min, max: percent ? 100 : stage.max, step: percent ? .1 : "any", unit: stage.unit,
      scale: percent ? "linear" : "log", value: value[stage.id] * (percent ? 100 : 1),
      formatValue: raw => percent ? Number(raw.toFixed(1)) + "%" : raw < 1 ? Number((raw * 1000).toFixed(1)) + " ms" : Number(raw.toFixed(3)) + " s",
      onInput: raw => update(stage.id, raw / (percent ? 100 : 1)) });
    knob.editor.classList.add("synth-envelope__number");
    knob.editor.dataset.stage = stage.id;
    knob.input.dataset.stage = stage.id;
    fields.append(knob);
    return knob;
  });
  const help = element("p", "synth-envelope__help", root);
  help.id = `${id}-help`;
  help.textContent = "Drag A, D or R sideways; drag S up/down. Arrows adjust a focused handle. The shaded hold lasts until note off; its drawn length is illustrative.";

  function layout() {
    width = Math.max(220, graph.getBoundingClientRect().width || host.getBoundingClientRect().width || 360);
    const sum = value.attack + value.decay + value.release;
    const hold = gesture?.hold ?? Math.max(0.03, sum * 0.25);
    const total = sum + hold;
    const axisMax = gesture?.axisMax ?? Math.max(0.05, total * 1.25);
    const plotWidth = width - 2 * PAD;
    const x = time => PAD + time / axisMax * plotWidth;
    const y = level => BASE - level * (BASE - TOP);
    const decayEnd = value.attack + value.decay;
    const sustainEnd = decayEnd + hold;
    return { hold, total, axisMax, plotWidth, x, y, points: [
      { x: x(value.attack), y: TOP },
      { x: x(decayEnd), y: y(value.sustain) },
      { x: x(sustainEnd), y: y(value.sustain) },
      { x: x(total), y: BASE },
    ] };
  }

  function render(forceFields = false) {
    if (destroyed) return;
    geometry = layout();
    const { points, axisMax } = geometry;
    svg.setAttribute("viewBox", `0 0 ${width} ${HEIGHT}`);
    svg.setAttribute("aria-label", `Linear ADSR envelope: attack ${secondsText(value.attack)}, decay ${secondsText(value.decay)}, sustain ${numberText(value.sustain * 100)} percent until note off, release ${secondsText(value.release)}.`);
    grid.setAttribute("d", `M${PAD},${TOP}H${width - PAD}M${PAD},${(TOP + BASE) / 2}H${width - PAD}M${PAD},${BASE}H${width - PAD}`);
    curve.setAttribute("d", `M${PAD},${BASE}L${points.map(point => `${point.x},${point.y}`).join("L")}`);
    heldArea.setAttribute("x", points[1].x);
    heldArea.setAttribute("width", Math.max(0, points[2].x - points[1].x));
    noteOff.setAttribute("d", `M${points[2].x},${TOP - 9}V${BASE + 7}`);
    endTime.setAttribute("x", width - PAD);
    endTime.textContent = `${numberText(Number(axisMax.toPrecision(3)))} s`;
    heldText.setAttribute("x", (points[1].x + points[2].x) / 2);

    // Very short stages can share almost the same time coordinate. Separate the
    // full-size native hit targets horizontally and draw leaders to exact knots.
    const centres = points.map(point => clamp(point.x, HANDLE / 2, width - HANDLE / 2));
    for (let i = 1; i < centres.length; i++) centres[i] = Math.max(centres[i], centres[i - 1] + HANDLE + 2);
    centres[3] = Math.min(centres[3], width - HANDLE / 2);
    for (let i = 2; i >= 0; i--) centres[i] = Math.min(centres[i], centres[i + 1] - HANDLE - 2);
    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i], point = points[i], current = value[stage.id];
      const button = handles[i];
      button.style.left = `${centres[i] / width * 100}%`;
      button.style.top = `${point.y / HEIGHT * 100}%`;
      button.setAttribute("aria-valuenow", numberText(current));
      button.setAttribute("aria-valuetext", stage.id === "sustain" ? `${numberText(current * 100)} percent, held until note off` : secondsText(current));
      button.title = `${stage.label}: ${stage.id === "sustain" ? `${numberText(current * 100)}%` : `${numberText(current)} s`}`;
      leaderLines[i].setAttribute("d", `M${point.x},${point.y}H${centres[i]}`);
      knots[i].setAttribute("cx", point.x);
      knots[i].setAttribute("cy", point.y);
      knobs[i].setValue(current * (stage.id === "sustain" ? 100 : 1));
    }
  }

  function update(id, next) {
    if (destroyed || !Number.isFinite(next)) return;
    const stage = STAGES.find(stage => stage.id === id);
    const bounded = rounded(clamp(next, stage.min, stage.max));
    if (bounded === value[id]) return;
    value = { ...value, [id]: bounded };
    render();
    onChange({ ...value });
  }

  function beginGesture(event, stage, button) {
    if (destroyed || gesture || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    button.focus({ preventScroll: true });
    gesture = { pointerId: event.pointerId, stage, button, startX: event.clientX, startY: event.clientY,
      startValue: { ...value }, axisMax: geometry.axisMax, hold: geometry.hold, plotWidth: geometry.plotWidth };
    button.classList.add("is-dragging");
    button.setPointerCapture(event.pointerId);
  }

  function moveGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    const { stage, startValue, startX, startY, axisMax, plotWidth, hold } = gesture;
    if (stage.id === "sustain") update(stage.id, startValue.sustain - (event.clientY - startY) / (BASE - TOP));
    else {
      const otherTimes = value.attack + value.decay + value.release - value[stage.id];
      // Preserve a fixed, genuinely linear time scale for the entire gesture.
      // A fresh gesture refits the axis, while number fields give the full range.
      const available = Math.max(stage.min, axisMax - hold - otherTimes);
      update(stage.id, Math.min(available, startValue[stage.id] + (event.clientX - startX) / plotWidth * axisMax));
    }
  }

  function clearGesture() {
    if (!gesture) return null;
    const old = gesture;
    gesture = null;
    old.button.classList.remove("is-dragging");
    if (old.button.hasPointerCapture(old.pointerId)) old.button.releasePointerCapture(old.pointerId);
    return old;
  }

  function finishGesture(event, cancel) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const old = clearGesture();
    const changed = STAGES.some(stage => value[stage.id] !== old.startValue[stage.id]);
    if (cancel && changed) value = old.startValue;
    render(true);
    if (cancel && changed) onChange({ ...value });
  }

  function keyChange(event, stage) {
    const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[event.key];
    if (direction === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    clearGesture();
    const next = event.key === "Home" ? stage.min : event.key === "End" ? stage.max
      : value[stage.id] + direction * stage.step * (event.shiftKey ? 10 : 1);
    update(stage.id, next);
  }

  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => render()) : null;
  resize?.observe(graph);
  if (!resize) listen(window, "resize", () => render());
  listen(window, "blur", () => { if (gesture) finishGesture({ pointerId: gesture.pointerId }, true); });
  render(true);
  return Object.freeze({
    setValue(envelope) {
      if (destroyed) return;
      const next = normalized(envelope, value);
      if (gesture && STAGES.some(stage => next[stage.id] !== value[stage.id])) clearGesture();
      value = next;
      render(true);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearGesture();
      abort.abort();
      resize?.disconnect();
      knobs.forEach(knob => knob.destroy());
      root.remove();
    },
  });
}
