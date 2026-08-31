import {
  VoicePool,
  normalizeVoiceGains,
  pitch01ToFrequency,
} from "./src/audio.js";
import {
  clamp,
  createFixedStepper,
  createPainter,
} from "./src/physics-common.js";
import { createPhysicsScene, PHYSICS_SCENE_INDEX } from "./src/physics-scenes.js";
import {
  createChoiceSwitch,
  createRangeField,
  createSelectField,
} from "./src/ui/index.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
const pool = new VoicePool(24);
const sceneId = document.body.dataset.physicsScene;
const scene = createPhysicsScene(sceneId);
const fixedStepper = createFixedStepper();

const globalState = {
  audio: false,
  playing: false,
  level: 0.56,
  baseFrequency: 110,
  pitchRange: 3,
  timeScale: 1,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let lastUiUpdate = -Infinity;
let lastPainter = null;
let pointer = null;

function announce(message) {
  $("liveStatus").textContent = message;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "—");
  if (Math.abs(number) >= 100) return number.toFixed(0);
  if (Math.abs(number) >= 10) return number.toFixed(1);
  return number.toFixed(2);
}

function formatControlValue(control, value) {
  if (typeof control.format === "function") return control.format(value);
  if (typeof control.format === "string") return control.format.replace("{}", formatNumber(value));
  return formatNumber(value);
}

function sceneValue(control) {
  const value = scene.state?.[control.key];
  return value === undefined ? control.value : value;
}

function makeRangeControl(control) {
  return createRangeField({
    id: `physics-${control.key}`,
    label: control.label,
    min: control.min,
    max: control.max,
    step: control.step,
    value: sceneValue(control),
    formatValue: (value) => formatControlValue(control, value),
    onInput(value) {
      scene.setParam(control.key, Number(value));
      scheduleFrame();
    },
  });
}

function makeSelectControl(control) {
  return createSelectField({
    id: `physics-${control.key}`,
    label: control.label,
    options: control.options,
    value: sceneValue(control),
    onChange(value) {
      scene.setParam(control.key, value);
      renderSceneInformation(true);
      scheduleFrame();
    },
  });
}

function makeToggleControl(control) {
  return createChoiceSwitch({
    label: control.label,
    value: Boolean(sceneValue(control)),
    choices: [
      { value: false, label: "Off" },
      { value: true, label: "On" },
    ],
    groupClassName: "physics-toggle",
    onChange(value) {
      scene.setParam(control.key, Boolean(value));
      scheduleFrame();
    },
  });
}

function makeTimeScaleControl() {
  return createRangeField({
    id: "physics-timeScale",
    label: "Time scale",
    min: 0.15,
    max: 2,
    step: 0.05,
    value: globalState.timeScale,
    formatValue: (value) => `${Number(value).toFixed(2)}×`,
    onInput(value) {
      globalState.timeScale = Number(value);
    },
  });
}

function renderPhysicsControls() {
  const fragment = document.createDocumentFragment();
  fragment.append(makeTimeScaleControl());
  const note = document.createElement("p");
  note.className = "physics-control-note";
  note.textContent = "The simulation advances at a fixed 120 Hz; this control changes model time, not numerical step size.";
  fragment.append(note);
  for (const control of scene.controls ?? []) {
    if (control.type === "select") fragment.append(makeSelectControl(control));
    else if (control.type === "toggle") fragment.append(makeToggleControl(control));
    else fragment.append(makeRangeControl(control));
  }
  $("physicsControls").replaceChildren(fragment);
}

function renderMapping() {
  const mapping = $("sceneMapping");
  const fragment = document.createDocumentFragment();
  for (const item of scene.mappings ?? []) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    if (Array.isArray(item)) {
      [term.textContent, definition.textContent] = item;
    } else {
      term.textContent = item.geometry ?? item.source ?? "Geometry";
      definition.textContent = item.sound ?? item.target ?? "Sound";
    }
    row.append(term, definition);
    fragment.append(row);
  }
  mapping.replaceChildren(fragment);
}

function normalizeMetrics(rawMetrics) {
  if (Array.isArray(rawMetrics)) {
    return rawMetrics.map((metric, index) => Array.isArray(metric)
      ? { label: metric[0], value: metric[1] }
      : { label: metric.label ?? `Value ${index + 1}`, value: metric.value });
  }
  return Object.entries(rawMetrics ?? {}).map(([label, value]) => ({ label, value }));
}

function renderMetrics() {
  const metrics = normalizeMetrics(scene.metrics?.());
  const fragment = document.createDocumentFragment();
  for (const metric of metrics) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const definition = document.createElement("dd");
    term.textContent = metric.label;
    definition.textContent = typeof metric.value === "number"
      ? formatNumber(metric.value)
      : String(metric.value ?? "—");
    row.append(term, definition);
    fragment.append(row);
  }
  $("sceneMetrics").replaceChildren(fragment);
  $("physicsSummary").textContent = metrics.slice(0, 2)
    .map((metric) => `${metric.label} ${typeof metric.value === "number" ? formatNumber(metric.value) : metric.value}`)
    .join(" · ") || "live geometry";
  const headline = metrics.slice(0, 3)
    .map((metric) => `${metric.label} ${typeof metric.value === "number" ? formatNumber(metric.value) : metric.value}`)
    .join(" · ");
  $("stageReadout").textContent = `${headline || scene.kicker} · AUDIO ${globalState.audio ? "ON" : "OFF"}`;
}

function renderSceneInformation(rebuildControls = false) {
  document.body.style.setProperty("--accent", scene.color);
  document.body.style.setProperty(
    "--accent-soft",
    `color-mix(in oklab, ${scene.color} 55%, transparent)`,
  );
  document.body.style.setProperty(
    "--accent-glow",
    `color-mix(in oklab, ${scene.color} 22%, transparent)`,
  );
  $("sceneTitle").textContent = scene.title;
  const description = $("sceneDescription");
  if (description) description.textContent = scene.description;
  $("sceneInstruction").textContent = scene.instruction;
  $("sceneLesson").textContent = scene.lesson;
  $("primaryAction").textContent = scene.primaryActionLabel ?? "Impulse";
  $("primaryAction").hidden = typeof scene.primaryAction !== "function";
  if (rebuildControls) renderPhysicsControls();
  renderMapping();
  renderMetrics();
}

function mapVoice(voice, index = 0) {
  return {
    key: typeof voice.key === "string" ? `physics:${scene.id}:${voice.key}` : `physics:${scene.id}:${index}`,
    frequency: pitch01ToFrequency(
      clamp(Number(voice.pitch01)),
      globalState.baseFrequency,
      globalState.pitchRange,
    ),
    gain: clamp(Number(voice.gain), 0, 1),
    pan: clamp(Number(voice.pan), -1, 1),
    waveform: voice.waveform ?? voice.wave ?? "sine",
  };
}

function updateAudio() {
  const continuous = normalizeVoiceGains((scene.voices?.() ?? []).map(mapVoice), 0.72);
  const events = scene.consumeEvents?.() ?? [];
  if (!globalState.audio || document.hidden) {
    pool.setVoices([]);
    return;
  }
  pool.setVoices(continuous);
  for (let index = 0; index < Math.min(events.length, 16); index += 1) {
    const event = events[index];
    pool.strike(mapVoice(event, index), {
      attackSeconds: clamp(Number(event.attackSeconds ?? 0.004), 0.0005, 0.03),
      decaySeconds: clamp(Number(event.decaySeconds ?? 0.12), 0.015, 2),
      attackNoise: clamp(Number(event.attackNoise ?? 0), 0, 1),
      retriggerMode: "crossfade",
    });
  }
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(3_000_000 / (cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

function draw() {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  lastPainter = createPainter(context, cssWidth, cssHeight, scene.color);
  scene.draw(lastPainter);
}

function frame(now) {
  scheduledFrame = 0;
  const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  if (globalState.playing) {
    fixedStepper.advance(deltaSeconds, (step) => scene.step(step), globalState.timeScale);
  }
  draw();
  updateAudio();
  if (now - lastUiUpdate > 80 || !globalState.playing) {
    renderMetrics();
    lastUiUpdate = now;
  }
  if (globalState.playing) scheduleFrame();
}

function paintTransport() {
  setPressed($("playButton"), globalState.playing);
  $("playButton").setAttribute("aria-label", globalState.playing ? "Pause simulation" : "Play simulation");
  $("playSummary").textContent = `${scene.primaryActionLabel ?? "simulation"} · ${globalState.playing ? "playing" : "paused"}`;
}

function setPlaying(playing) {
  globalState.playing = Boolean(playing);
  lastFrameTime = performance.now();
  fixedStepper.reset();
  paintTransport();
  if (!globalState.playing) pool.setVoices([]);
  announce(`${scene.title} ${globalState.playing ? "playing" : "paused"}.`);
  scheduleFrame();
}

$("playButton").addEventListener("click", () => setPlaying(!globalState.playing));

$("resetScene").addEventListener("click", () => {
  scene.reset();
  fixedStepper.reset();
  renderPhysicsControls();
  renderSceneInformation();
  announce(`${scene.title} reset.`);
  scheduleFrame();
});

$("primaryAction").addEventListener("click", () => {
  scene.primaryAction?.();
  if (!globalState.playing) setPlaying(true);
  else scheduleFrame();
  announce(`${scene.primaryActionLabel ?? "Impulse"} applied.`);
});

async function toggleAudio() {
  const button = $("audioButton");
  $("audioError").hidden = true;
  button.disabled = true;
  try {
    if (globalState.audio) {
      globalState.audio = false;
      pool.disable();
    } else {
      await pool.enable();
      pool.setLevel(globalState.level);
      globalState.audio = true;
    }
  } catch (error) {
    globalState.audio = false;
    $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
    $("audioError").hidden = false;
  } finally {
    button.disabled = false;
    setPressed(button, globalState.audio);
    $("audioState").textContent = globalState.audio ? "on" : "off";
    announce(`Audio ${globalState.audio ? "on" : "off"}.`);
    scheduleFrame();
  }
}

$("audioButton").addEventListener("click", toggleAudio);

function bindGlobalRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  input.value = String(globalState[key]);
  const update = () => {
    output.textContent = formatter(globalState[key]);
  };
  input.addEventListener("input", () => {
    globalState[key] = Number(input.value);
    update();
    afterChange?.();
    scheduleFrame();
  });
  update();
}

bindGlobalRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(globalState.level));
bindGlobalRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindGlobalRange("pitchRange", "pitchRange", (value) => `${Number(value).toFixed(2)} oct`);

function pointerPayload(event) {
  if (!lastPainter) lastPainter = createPainter(context, cssWidth, cssHeight, scene.color);
  const bounds = canvas.getBoundingClientRect();
  const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  const world = lastPainter.fromScreen(screen);
  const previous = pointer?.world ?? world;
  return {
    ...world,
    dx: world.x - previous.x,
    dy: world.y - previous.y,
    screenX: screen.x,
    screenY: screen.y,
    time: event.timeStamp / 1000,
    pointerId: event.pointerId,
  };
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const payload = pointerPayload(event);
  pointer = { id: event.pointerId, world: payload, time: payload.time };
  canvas.setPointerCapture?.(event.pointerId);
  stageWrap.classList.add("is-dragging");
  scene.pointerDown?.(payload);
  scheduleFrame();
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointer || event.pointerId !== pointer.id) return;
  event.preventDefault();
  const payload = pointerPayload(event);
  pointer.world = payload;
  pointer.time = payload.time;
  scene.pointerMove?.(payload);
  scheduleFrame();
});

function releasePointer(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  const payload = pointerPayload(event);
  const shouldStart = scene.pointerUp?.(payload) === true;
  pointer = null;
  stageWrap.classList.remove("is-dragging");
  canvas.releasePointerCapture?.(event.pointerId);
  if (shouldStart && !globalState.playing) setPlaying(true);
  else scheduleFrame();
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

canvas.addEventListener("keydown", (event) => {
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    setPlaying(!globalState.playing);
  } else if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    $("resetScene").click();
  } else if (event.key === "Enter" && typeof scene.primaryAction === "function") {
    event.preventDefault();
    $("primaryAction").click();
  }
});

document.querySelector("[data-reset-all]")?.addEventListener("click", () => {
  globalState.level = 0.56;
  globalState.baseFrequency = 110;
  globalState.pitchRange = 3;
  globalState.timeScale = 1;
  $("level").value = String(globalState.level);
  $("baseFrequency").value = String(globalState.baseFrequency);
  $("pitchRange").value = String(globalState.pitchRange);
  $("levelOut").textContent = "56%";
  $("baseFrequencyOut").textContent = "110 Hz";
  $("pitchRangeOut").textContent = "3.00 oct";
  pool.setLevel(globalState.level);
  scene.reset();
  fixedStepper.reset();
  renderPhysicsControls();
  renderSceneInformation();
  announce(`${scene.title} and sound controls reset.`);
  scheduleFrame();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else scheduleFrame();
});

window.addEventListener("pagehide", () => pool.disable(), { once: true });

if (!PHYSICS_SCENE_INDEX.has(sceneId)) {
  throw new Error(`Unknown physics scene: ${sceneId}`);
}

scene.reset();
renderPhysicsControls();
renderSceneInformation();
paintTransport();
scheduleFrame();
