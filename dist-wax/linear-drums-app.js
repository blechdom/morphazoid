import {
  LINEAR_DRUM_DEFAULTS,
  LINEAR_DRUM_MODELS,
  LINEAR_DRUM_PARAMETER_SPECS,
  LINEAR_DRUM_PITCHED_ARCHETYPES,
  LINEAR_DRUM_PRESETS,
  LinearDrumAudio,
  cloneDefaultLinearDrumParameterMaps,
  linearDrumBlendLabel,
  linearDrumFrequencyAtPosition,
  linearDrumMappedParameterValues,
  linearDrumMappingAmount,
  linearDrumMorphWeights,
  linearDrumParameterPosition,
  linearDrumParameterValue,
  linearDrumParameters,
  linearDrumPitchedMorphWeights,
  linearDrumPositionAtFrequency,
  sanitizeLinearDrumSettings,
} from "./src/linear-drums.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
const audio = new LinearDrumAudio(globalThis);
const modelById = new Map(LINEAR_DRUM_MODELS.map((model) => [model.id, model]));
const parameterSpecById = new Map(
  LINEAR_DRUM_PARAMETER_SPECS.map((specification) => [specification.id, specification]),
);
const pitchedArchetypeById = new Map(
  LINEAR_DRUM_PITCHED_ARCHETYPES.map((archetype) => [archetype.id, archetype]),
);
const FAMILY_COLORS = Object.freeze({
  kick: [255, 112, 88],
  tom: [242, 202, 88],
  hand: [97, 223, 169],
  air: [116, 169, 255],
  harp: [94, 224, 192],
  harpsichord: [242, 202, 88],
  piano: [208, 140, 255],
  marimba: [255, 132, 96],
  xylophone: [92, 205, 224],
  kalimba: [126, 169, 255],
});
const CONTROL_SPECS = Object.freeze([
  { id: "kickTom", key: "kickTomHz", format: (value) => formatFrequency(value) },
  { id: "tomHand", key: "tomHandHz", format: (value) => formatFrequency(value) },
  { id: "handAir", key: "handAirHz", format: (value) => formatFrequency(value) },
  { id: "morphWidth", key: "morphWidth", format: (value) => `${value.toFixed(2)} oct` },
  {
    id: "attack", key: "attack", format: (value) => formatEnvelopeTime(value),
    read: (value) => linearDrumParameterValue("attack", value),
    write: (value) => linearDrumParameterPosition("attack", value),
  },
  {
    id: "decay", key: "decay", format: (value) => formatEnvelopeTime(value),
    read: (value) => linearDrumParameterValue("decay", value),
    write: (value) => linearDrumParameterPosition("decay", value),
  },
  { id: "pitchFall", key: "pitchFall", format: formatPercent },
  { id: "strikeNoise", key: "strikeNoise", format: formatPercent },
  { id: "brightness", key: "brightness", format: formatPercent },
  { id: "inharmonicity", key: "inharmonicity", format: formatPercent },
  { id: "hardness", key: "hardness", format: formatPercent },
  { id: "sweepRate", key: "sweepRate", format: formatSweepRate },
  { id: "sweepSpeed", key: "sweepSpeed", format: formatSweepSpeed },
]);
const controlSpecByKey = new Map(CONTROL_SPECS.map((specification) => [
  specification.key,
  specification,
]));

const state = {
  ...LINEAR_DRUM_DEFAULTS,
  parameterMaps: cloneDefaultLinearDrumParameterMaps(),
  position: linearDrumPositionAtFrequency(100, 20, 16_000),
  performanceY: .5,
  output: .62,
  sweepMode: "pendulum",
  sweepDirection: 1,
  sweeping: false,
  audioOn: false,
  selectedPresetId: "natural-line",
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let sweepTimer = 0;
let audioLifecycleGeneration = 0;
let audioStartPromise = null;
let pointerActive = false;
let lastPointerPosition = state.position;
let lastPointerY = state.performanceY;
let lastPointerHitAt = 0;
let lastRailHitAt = 0;
let pulses = [];
let analyserData = null;
let paintedScaleMaximum = 0;

function formatFrequency(frequency) {
  if (frequency >= 10_000) return `${(frequency / 1_000).toFixed(frequency % 1_000 ? 1 : 0)} kHz`;
  if (frequency >= 1_000) return `${(frequency / 1_000).toFixed(frequency % 1_000 ? 2 : 0)} kHz`;
  if (frequency >= 100) return `${Math.round(frequency)} Hz`;
  return `${frequency.toFixed(frequency < 30 ? 1 : 0)} Hz`;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatEnvelopeTime(seconds) {
  if (seconds < .1) return `${Number((seconds * 1_000).toFixed(seconds < .01 ? 1 : 0))} ms`;
  return `${Number(seconds.toFixed(2))} s`;
}

function formatSweepRate(value) {
  return `${Number(value.toFixed(value % 1 ? 1 : 0))} /s`;
}

function formatSweepSpeed(value) {
  return `${Number(value.toFixed(2))} oct/s`;
}

function formatParameterValue(parameterId, value) {
  return controlSpecByKey.get(parameterId)?.format(value) ?? String(value);
}

function currentFrequency() {
  return linearDrumFrequencyAtPosition(state.position, state.rangeMin, state.rangeMax);
}

function synthSettings() {
  return sanitizeLinearDrumSettings(state);
}

function blendColor(weights, alpha = 1) {
  const rgb = [0, 1, 2].map((channel) => Math.round(
    Object.entries(FAMILY_COLORS).reduce(
      (total, [family, color]) => total + (weights[family] ?? 0) * color[channel],
      0,
    ),
  ));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function colorWithAlpha(hexColor, alpha) {
  const color = String(hexColor).replace("#", "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function setAudioState(enabled) {
  state.audioOn = enabled;
  $("audioButton").setAttribute("aria-pressed", String(enabled));
  $("audioState").textContent = enabled ? "on" : "off";
  $("sampleRateState").textContent = enabled && audio.context
    ? `${Math.round(audio.context.sampleRate / 1_000)} KHZ`
    : "AUDIO OFF";
  audio.setOutput(enabled ? state.output : 0);
  scheduleFrame();
}

function enableAudio() {
  if (state.audioOn && audio.context) return Promise.resolve(true);
  if (audioStartPromise) return audioStartPromise;
  const lifecycleGeneration = audioLifecycleGeneration;
  $("audioError").hidden = true;
  let pending;
  pending = audio.start().then((audioContext) => {
    if (
      lifecycleGeneration !== audioLifecycleGeneration
      || audioContext !== audio.context
    ) return false;
    setAudioState(true);
    return true;
  }).catch((error) => {
    if (
      lifecycleGeneration !== audioLifecycleGeneration
      || error?.name === "AbortError"
    ) return false;
    showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
  });
  audioStartPromise = pending;
  return pending;
}

function addPulse(parameters, velocity = .8) {
  pulses.push({
    position: linearDrumPositionAtFrequency(
      parameters.frequency,
      state.rangeMin,
      state.rangeMax,
    ),
    startedAt: performance.now(),
    velocity,
    color: blendColor(parameters.bodyWeights),
  });
  if (pulses.length > 36) pulses = pulses.slice(-36);
  scheduleFrame();
}

async function strikeFrequency(frequency, { velocity = .82, delay = 0, announceHit = false } = {}) {
  const lifecycleGeneration = audioLifecycleGeneration;
  if (!state.audioOn || !audio.context) return null;
  if (lifecycleGeneration !== audioLifecycleGeneration) return null;
  try {
    const parameters = await audio.trigger(frequency, synthSettings(), {
      velocity,
      delay,
      performanceY: state.performanceY,
    });
    if (lifecycleGeneration !== audioLifecycleGeneration) return null;
    addPulse(parameters, velocity);
    if (announceHit) {
      announce(`${formatFrequency(parameters.frequency)}. ${linearDrumBlendLabel(parameters.bodyWeights)}.`);
    }
    return parameters;
  } catch (error) {
    if (
      lifecycleGeneration === audioLifecycleGeneration
      && error?.name !== "AbortError"
    ) showError(error);
    return null;
  }
}

function setPosition(position, { strike = false, velocity = .82, announceHit = false } = {}) {
  state.position = clamp(Number(position) || 0, 0, 1);
  $("frequency").value = String(state.position);
  paintReadouts();
  scheduleFrame();
  if (strike) void strikeFrequency(currentFrequency(), { velocity, announceHit });
}

function paintMorphLabels() {
  if (state.model !== "pitched") {
    $("morphOneLabel").textContent = "Kick to tom";
    $("morphTwoLabel").textContent = "Tom to hand";
    $("morphThreeLabel").textContent = "Hand to air";
    return;
  }
  const labels = state.pitchedOrder.map((id) => pitchedArchetypeById.get(id)?.label ?? id);
  $("morphOneLabel").textContent = `${labels[0]} to ${labels[1]}`;
  $("morphTwoLabel").textContent = `${labels[1]} to ${labels[2]}`;
  $("morphThreeLabel").textContent = `${labels[2]} air onset`;
}

function paintReadouts() {
  const frequency = currentFrequency();
  const parameters = linearDrumParameters(frequency, synthSettings(), {
    vertical: state.performanceY,
  });
  const formatted = formatFrequency(frequency);
  const color = blendColor(parameters.bodyWeights);
  const model = modelById.get(state.model) ?? LINEAR_DRUM_MODELS[0];
  $("frequencyReadout").textContent = formatted;
  $("frequencyOut").textContent = formatted;
  $("cursorReadout").textContent = formatted;
  $("blendReadout").textContent = linearDrumBlendLabel(parameters.bodyWeights);
  $("modelReadout").textContent = model.label;
  $("modelSummary").textContent = model.label.toUpperCase();
  paintMorphLabels();
  stageWrap.style.setProperty("--cursor-position", `${state.position * 100}%`);
  stageWrap.style.setProperty("--cursor-color", color);
  stageWrap.style.setProperty("--performance-y", state.performanceY);
  $("frequency").style.setProperty("--cursor-color", color);
  $("morphSummary").textContent = [state.kickTomHz, state.tomHandHz, state.handAirHz]
    .map(formatFrequency)
    .join(" / ");
  $("rangeSummary").textContent = `${formatFrequency(state.rangeMin)} - ${formatFrequency(state.rangeMax)}`;
  $("rangeMaxOut").textContent = formatFrequency(state.rangeMax);
  $("footerRange").textContent = formatFrequency(state.rangeMax).toUpperCase();
  paintMappedControlOutputs(parameters.mappedValues);
  $("envelopeSummary").textContent = [parameters.mappedValues.attack, parameters.mappedValues.decay]
    .map(formatEnvelopeTime)
    .join(" / ");
  paintFrequencyScale();
}

function paintFrequencyScale() {
  if (Math.abs(paintedScaleMaximum - state.rangeMax) < .01) return;
  paintedScaleMaximum = state.rangeMax;
  for (const label of document.querySelectorAll(".linear-frequency-scale span")) {
    const isMaximum = label.hasAttribute("data-range-maximum");
    const frequency = isMaximum ? state.rangeMax : Number(label.dataset.frequency);
    label.hidden = !isMaximum && frequency >= state.rangeMax * .94;
    label.style.setProperty(
      "--position",
      linearDrumPositionAtFrequency(frequency, state.rangeMin, state.rangeMax),
    );
    if (isMaximum) label.textContent = formatFrequency(state.rangeMax);
  }
}

function markPresetCustom() {
  state.selectedPresetId = null;
  $("presetSummary").textContent = "CUSTOM";
  for (const button of $("presetBank").querySelectorAll(".linear-preset-button")) {
    button.classList.remove("is-active");
    button.removeAttribute("aria-current");
  }
}

function refreshControl(specification) {
  const input = $(specification.id);
  const output = $(`${specification.id}Out`);
  input.value = String(specification.write
    ? specification.write(state[specification.key])
    : state[specification.key]);
  const mapping = state.parameterMaps[specification.key];
  const mapped = Boolean(mapping?.enabled);
  input.disabled = mapped;
  const wrapper = document.querySelector(`[data-parameter-control="${specification.key}"]`);
  const mapSpecification = parameterSpecById.get(specification.key);
  wrapper?.classList.toggle("is-mapped", mapped);
  if (mapSpecification) wrapper?.style.setProperty("--map-color", mapSpecification.color);
  const button = document.querySelector(`[data-map-parameter="${specification.key}"]`);
  if (button) {
    button.setAttribute("aria-pressed", String(mapped));
    button.style.setProperty("--map-color", mapSpecification?.color ?? "var(--accent)");
  }
  output.textContent = specification.format(state[specification.key]);
}

function paintMappedControlOutputs(mappedValues) {
  for (const specification of CONTROL_SPECS) {
    const output = $(`${specification.id}Out`);
    const mapping = state.parameterMaps[specification.key];
    output.textContent = specification.format(
      mapping?.enabled ? mappedValues[specification.key] : state[specification.key],
    );
  }
}

function bindControls() {
  for (const specification of CONTROL_SPECS) {
    const input = $(specification.id);
    refreshControl(specification);
    input.addEventListener("input", () => {
      state[specification.key] = specification.read
        ? specification.read(Number(input.value))
        : Number(input.value);
      markPresetCustom();
      paintReadouts();
      scheduleFrame();
    });
  }

  $("output").addEventListener("input", () => {
    state.output = Number($("output").value);
    $("outputOut").textContent = formatPercent(state.output);
    audio.setOutput(state.audioOn ? state.output : 0);
  });
  $("rangeMax").value = String(linearDrumPositionAtFrequency(state.rangeMax, 4_000, 20_000));
  $("rangeMax").addEventListener("input", () => {
    state.rangeMax = linearDrumFrequencyAtPosition(Number($("rangeMax").value), 4_000, 20_000);
    markPresetCustom();
    paintReadouts();
    scheduleFrame();
  });

  for (const button of document.querySelectorAll("[data-map-parameter]")) {
    button.addEventListener("click", () => {
      const parameterId = button.dataset.mapParameter;
      const mapping = state.parameterMaps[parameterId];
      if (!mapping) return;
      mapping.enabled = !mapping.enabled;
      markPresetCustom();
      refreshControl(controlSpecByKey.get(parameterId));
      renderMappingLanes();
      paintReadouts();
      scheduleFrame();
    });
  }

  for (const input of document.querySelectorAll('input[name="bodyModel"]')) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      state.model = input.value;
      markPresetCustom();
      paintReadouts();
      scheduleFrame();
      void strikeFrequency(currentFrequency(), { velocity: .7 });
    });
  }
  for (const input of document.querySelectorAll('input[name="sweepMode"]')) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      state.sweepMode = input.value;
      if (state.sweepMode === "up") state.sweepDirection = 1;
      if (state.sweepMode === "down") state.sweepDirection = -1;
    });
  }
}

function mappingCurveText(curve) {
  if (Math.abs(curve) < .035) return "LINEAR";
  return `${curve < 0 ? "EARLY" : "LATE"} ${Math.round(Math.abs(curve) * 100)}%`;
}

function mappingCurvePath(lowPosition, highPosition, curve) {
  const points = [];
  for (let index = 0; index <= 32; index += 1) {
    const source = index / 32;
    const amount = linearDrumMappingAmount(source, curve);
    const value = lowPosition + (highPosition - lowPosition) * amount;
    points.push(`${index ? "L" : "M"}${(source * 100).toFixed(2)},${((1 - value) * 100).toFixed(2)}`);
  }
  return points.join(" ");
}

function updateMapping(specification, mapping, lane) {
  markPresetCustom();
  paintMappingCurve(lane, specification, mapping);
  paintReadouts();
  scheduleFrame();
}

function bindMappingHandle(button, plot, lane, specification, mapping, handle) {
  let dragging = false;
  let dragStartY = 0;
  let dragStartCurve = 0;
  let dragDirection = 1;

  const setEndpointFromPointer = (event) => {
    const bounds = plot.getBoundingClientRect();
    const position = 1 - clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1);
    mapping[handle] = linearDrumParameterValue(specification.id, position);
    updateMapping(specification, mapping, lane);
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    button.setPointerCapture?.(event.pointerId);
    if (handle === "curve") {
      const low = linearDrumParameterPosition(specification.id, mapping.low);
      const high = linearDrumParameterPosition(specification.id, mapping.high);
      dragStartY = event.clientY;
      dragStartCurve = mapping.curve;
      dragDirection = Math.sign(high - low) || 1;
    } else {
      setEndpointFromPointer(event);
    }
  });

  button.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    if (handle === "curve") {
      const bounds = plot.getBoundingClientRect();
      mapping.curve = clamp(
        dragStartCurve + ((event.clientY - dragStartY) / Math.max(1, bounds.height)) * 3 * dragDirection,
        -1,
        1,
      );
      updateMapping(specification, mapping, lane);
    } else {
      setEndpointFromPointer(event);
    }
  });

  const releaseHandle = (event) => {
    dragging = false;
    try { button.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  };
  button.addEventListener("pointerup", releaseHandle);
  button.addEventListener("pointercancel", releaseHandle);

  button.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End", "0"].includes(event.key)) return;
    event.preventDefault();
    if (handle === "curve") {
      const low = linearDrumParameterPosition(specification.id, mapping.low);
      const high = linearDrumParameterPosition(specification.id, mapping.high);
      const direction = Math.sign(high - low) || 1;
      if (event.key === "0") mapping.curve = 0;
      else if (event.key === "Home") mapping.curve = -1;
      else if (event.key === "End") mapping.curve = 1;
      else mapping.curve = clamp(
        mapping.curve + (event.key === "ArrowDown" ? .06 : -.06) * direction,
        -1,
        1,
      );
    } else {
      let position = linearDrumParameterPosition(specification.id, mapping[handle]);
      if (event.key === "Home") position = 0;
      else if (event.key === "End") position = 1;
      else if (event.key === "ArrowUp") position += .02;
      else if (event.key === "ArrowDown") position -= .02;
      mapping[handle] = linearDrumParameterValue(specification.id, clamp(position, 0, 1));
    }
    updateMapping(specification, mapping, lane);
  });

  if (handle === "curve") {
    button.addEventListener("dblclick", () => {
      mapping.curve = 0;
      updateMapping(specification, mapping, lane);
    });
  }
}

function createCurveHandle(plot, lane, specification, mapping, handle) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mapping-curve-handle is-${handle}`;
  button.dataset.mapHandle = handle;
  button.setAttribute("role", "slider");
  button.setAttribute("aria-orientation", "vertical");
  plot.append(button);
  bindMappingHandle(button, plot, lane, specification, mapping, handle);
}

function paintMappingCurve(lane, specification, mapping) {
  const lowPosition = linearDrumParameterPosition(specification.id, mapping.low);
  const highPosition = linearDrumParameterPosition(specification.id, mapping.high);
  const midpointAmount = linearDrumMappingAmount(.5, mapping.curve);
  const midpointPosition = lowPosition + (highPosition - lowPosition) * midpointAmount;
  const sourceButton = lane.querySelector(".mapping-source-button");
  sourceButton.textContent = mapping.source === "vertical" ? "Y POSITION" : "PITCH";
  sourceButton.title = mapping.source === "vertical"
    ? `${specification.label}: canvas height`
    : `${specification.label}: low to high pitch`;
  lane.querySelector('[data-domain-label="low"]').textContent = mapping.source === "vertical"
    ? "BOTTOM"
    : "LOW";
  lane.querySelector('[data-domain-label="high"]').textContent = mapping.source === "vertical"
    ? "TOP"
    : "HIGH";
  lane.querySelector('[data-map-value="low"]').textContent = formatParameterValue(
    specification.id,
    mapping.low,
  );
  lane.querySelector('[data-map-value="high"]').textContent = formatParameterValue(
    specification.id,
    mapping.high,
  );
  lane.querySelector('[data-map-value="curve"]').textContent = mappingCurveText(mapping.curve);
  lane.querySelector(".mapping-curve-path").setAttribute(
    "d",
    mappingCurvePath(lowPosition, highPosition, mapping.curve),
  );

  const handlePositions = {
    low: [0, lowPosition],
    curve: [.5, midpointPosition],
    high: [1, highPosition],
  };
  for (const [handle, [x, y]] of Object.entries(handlePositions)) {
    const button = lane.querySelector(`[data-map-handle="${handle}"]`);
    button.style.left = `${x * 100}%`;
    button.style.top = `${(1 - y) * 100}%`;
    if (handle === "curve") {
      button.setAttribute("aria-label", `${specification.label} curve`);
      button.setAttribute("aria-valuemin", "-100");
      button.setAttribute("aria-valuemax", "100");
      button.setAttribute("aria-valuenow", String(Math.round(mapping.curve * 100)));
      button.setAttribute("aria-valuetext", mappingCurveText(mapping.curve));
      button.title = `${specification.label}: ${mappingCurveText(mapping.curve).toLowerCase()}`;
    } else {
      const value = mapping[handle];
      const domain = handle === "low"
        ? (mapping.source === "vertical" ? "bottom" : "low pitch")
        : (mapping.source === "vertical" ? "top" : "high pitch");
      button.setAttribute("aria-label", `${specification.label} at ${domain}`);
      button.setAttribute("aria-valuemin", "0");
      button.setAttribute("aria-valuemax", "100");
      button.setAttribute("aria-valuenow", String(Math.round(y * 100)));
      button.setAttribute("aria-valuetext", formatParameterValue(specification.id, value));
      button.title = `${domain}: ${formatParameterValue(specification.id, value)}`;
    }
  }
}

function renderMappingLanes() {
  const activeSpecifications = LINEAR_DRUM_PARAMETER_SPECS.filter(
    ({ id }) => state.parameterMaps[id]?.enabled,
  );
  const dock = $("mappingDock");
  dock.hidden = activeSpecifications.length === 0;
  $("mappingCount").textContent = String(activeSpecifications.length);
  $("yCursor").hidden = !activeSpecifications.some(
    ({ id }) => state.parameterMaps[id].source === "vertical",
  );

  const fragment = document.createDocumentFragment();
  for (const specification of activeSpecifications) {
    const mapping = state.parameterMaps[specification.id];
    const lane = document.createElement("article");
    lane.className = "linear-mapping-lane";
    lane.dataset.mappingParameter = specification.id;
    lane.style.setProperty("--map-color", specification.color);
    const header = document.createElement("header");
    const title = document.createElement("b");
    title.textContent = specification.shortLabel;
    const sourceButton = document.createElement("button");
    sourceButton.type = "button";
    sourceButton.className = "mapping-source-button";
    sourceButton.setAttribute("aria-label", `Change ${specification.label} mapping source`);
    sourceButton.addEventListener("click", () => {
      mapping.source = mapping.source === "pitch" ? "vertical" : "pitch";
      markPresetCustom();
      renderMappingLanes();
      paintReadouts();
      scheduleFrame();
    });
    header.append(sourceButton, title);

    const body = document.createElement("div");
    body.className = "mapping-curve-frame";
    const plot = document.createElement("div");
    plot.className = "mapping-curve-plot";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("mapping-curve-svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("mapping-curve-path");
    svg.append(path);
    plot.append(svg);
    for (const handle of ["low", "curve", "high"]) {
      createCurveHandle(plot, lane, specification, mapping, handle);
    }
    body.append(plot);

    const values = document.createElement("div");
    values.className = "mapping-curve-values";
    for (const valueId of ["low", "curve", "high"]) {
      const value = document.createElement("span");
      const label = document.createElement("b");
      label.textContent = valueId === "curve" ? "CURVE" : valueId.toUpperCase();
      if (valueId !== "curve") label.dataset.domainLabel = valueId;
      const output = document.createElement("output");
      output.dataset.mapValue = valueId;
      value.append(label, output);
      values.append(value);
    }
    lane.append(header, body, values);
    fragment.append(lane);
    paintMappingCurve(lane, specification, mapping);
  }
  $("mappingLanes").replaceChildren(fragment);
  requestAnimationFrame(resizeCanvas);
}

function paintPresetSelection() {
  for (const button of $("presetBank").querySelectorAll(".linear-preset-button")) {
    const selected = button.dataset.presetId === state.selectedPresetId;
    button.classList.toggle("is-active", selected);
    if (selected) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
  const preset = LINEAR_DRUM_PRESETS.find(({ id }) => id === state.selectedPresetId);
  $("presetSummary").textContent = preset ? preset.name.toUpperCase() : "CUSTOM";
}

function applyPreset(preset, { audition = true } = {}) {
  Object.assign(state, preset.settings);
  state.parameterMaps = Object.fromEntries(Object.entries(preset.settings.parameterMaps).map(
    ([key, mapping]) => [key, { ...mapping }],
  ));
  state.selectedPresetId = preset.id;
  for (const specification of CONTROL_SPECS) refreshControl(specification);
  $("rangeMax").value = String(linearDrumPositionAtFrequency(state.rangeMax, 4_000, 20_000));
  const modelInput = document.querySelector(`input[name="bodyModel"][value="${state.model}"]`);
  if (modelInput) modelInput.checked = true;
  paintedScaleMaximum = 0;
  renderMappingLanes();
  paintPresetSelection();
  paintReadouts();
  scheduleFrame();
  if (audition) void strikeFrequency(currentFrequency(), { velocity: .76 });
}

function renderPresetBank() {
  const fragment = document.createDocumentFragment();
  LINEAR_DRUM_PRESETS.forEach((preset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linear-preset-button";
    button.dataset.presetId = preset.id;
    button.textContent = `${String(index + 1).padStart(2, "0")} ${preset.name}`;
    button.title = preset.name;
    button.addEventListener("click", () => applyPreset(preset));
    fragment.append(button);
  });
  $("presetBank").replaceChildren(fragment);
  paintPresetSelection();
}

function paintSweepButton() {
  $("sweepButton").setAttribute("aria-pressed", String(state.sweeping));
  $("sweepIcon").textContent = state.sweeping ? "\u25a0" : "\u25b6";
  $("sweepLabel").textContent = state.sweeping ? "Stop" : "Sweep";
}

function mappedTransport() {
  const values = linearDrumMappedParameterValues(currentFrequency(), synthSettings(), {
    vertical: state.performanceY,
  });
  return { sweepRate: values.sweepRate, sweepSpeed: values.sweepSpeed };
}

function advanceSweep() {
  const transport = mappedTransport();
  const octaveRange = Math.max(.001, Math.log2(state.rangeMax / state.rangeMin));
  const positionStep = transport.sweepSpeed / transport.sweepRate / octaveRange;
  let next = state.position + positionStep * state.sweepDirection;
  if (state.sweepMode === "pendulum") {
    if (next > 1) {
      next = 2 - next;
      state.sweepDirection = -1;
    } else if (next < 0) {
      next = -next;
      state.sweepDirection = 1;
    }
  } else if (state.sweepMode === "up") {
    state.sweepDirection = 1;
    if (next > 1) next -= 1;
  } else {
    state.sweepDirection = -1;
    if (next < 0) next += 1;
  }
  setPosition(next);
}

function scheduleSweep() {
  if (!state.sweeping) return;
  const interval = 1_000 / mappedTransport().sweepRate;
  sweepTimer = window.setTimeout(() => {
    if (!state.sweeping) return;
    advanceSweep();
    void strikeFrequency(currentFrequency(), { velocity: .66 });
    scheduleSweep();
  }, interval);
}

function startSweep() {
  if (state.sweeping) return;
  state.sweeping = true;
  if (state.sweepMode === "up") state.sweepDirection = 1;
  if (state.sweepMode === "down") state.sweepDirection = -1;
  paintSweepButton();
  void strikeFrequency(currentFrequency(), { velocity: .66 });
  scheduleSweep();
  scheduleFrame();
  announce(state.audioOn
    ? "Linear drum sweep started."
    : "Linear drum sweep started silently. Turn Audio on to hear it.");
}

function stopSweep() {
  if (sweepTimer) window.clearTimeout(sweepTimer);
  sweepTimer = 0;
  if (!state.sweeping) return;
  state.sweeping = false;
  paintSweepButton();
  scheduleFrame();
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    position: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
    vertical: 1 - clamp((event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
  };
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  pointerActive = true;
  canvas.setPointerCapture?.(event.pointerId);
  const point = canvasPoint(event);
  lastPointerPosition = point.position;
  lastPointerY = point.vertical;
  state.performanceY = point.vertical;
  lastPointerHitAt = performance.now();
  setPosition(lastPointerPosition, { strike: true, velocity: .84 });
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerActive) return;
  const point = canvasPoint(event);
  const movement = Math.hypot(
    point.position - lastPointerPosition,
    point.vertical - lastPointerY,
  );
  const now = performance.now();
  state.performanceY = point.vertical;
  setPosition(point.position);
  if (now - lastPointerHitAt >= 28 && movement >= .0015) {
    const velocity = clamp(.46 + movement * 8, .46, .92);
    void strikeFrequency(currentFrequency(), { velocity });
    lastPointerHitAt = now;
    lastPointerPosition = point.position;
    lastPointerY = point.vertical;
  }
});

const releasePointer = (event) => {
  pointerActive = false;
  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* capture already released */ }
};
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

$("frequency").addEventListener("input", () => {
  const now = performance.now();
  setPosition(Number($("frequency").value));
  if (now - lastRailHitAt >= 30) {
    void strikeFrequency(currentFrequency(), { velocity: .68 });
    lastRailHitAt = now;
  }
});

$("strikeButton").addEventListener("click", () => {
  void strikeFrequency(currentFrequency(), { velocity: .86, announceHit: true });
});

$("sweepButton").addEventListener("click", () => {
  if (state.sweeping) {
    stopSweep();
    announce("Linear drum sweep stopped.");
  } else {
    startSweep();
  }
});

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Rattlesnake audio off.");
  } else if (await enableAudio()) {
    announce("Rattlesnake audio on.");
  }
});

$("resetAll").addEventListener("click", () => {
  stopSweep();
  state.position = linearDrumPositionAtFrequency(100, 20, 16_000);
  state.performanceY = .5;
  state.sweepMode = "pendulum";
  state.sweepDirection = 1;
  document.querySelector('input[name="sweepMode"][value="pendulum"]').checked = true;
  applyPreset(LINEAR_DRUM_PRESETS[0], { audition: false });
  setPosition(state.position);
  announce("Rattlesnake parameters reset.");
});

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(2_800_000 / (cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(drawStage);
}

function drawFamilyCurves(settings) {
  const pitched = settings.model === "pitched";
  const families = pitched ? settings.pitchedOrder : ["kick", "tom", "hand", "air"];
  families.forEach((family, familyIndex) => {
    context.beginPath();
    for (let x = 0; x <= cssWidth; x += 4) {
      const position = x / cssWidth;
      const frequency = linearDrumFrequencyAtPosition(position, state.rangeMin, state.rangeMax);
      const weights = pitched
        ? linearDrumPitchedMorphWeights(frequency, settings)
        : linearDrumMorphWeights(frequency, settings);
      const baseline = cssHeight * (.2 + familyIndex * (.54 / Math.max(1, families.length - 1)));
      const y = baseline - weights[family] * cssHeight * .11;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    const color = FAMILY_COLORS[family];
    context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, .72)`;
    context.lineWidth = 1.4;
    context.stroke();
  });
}

function drawParameterMapCurves() {
  const mappings = LINEAR_DRUM_PARAMETER_SPECS.filter(({ id }) => (
    state.parameterMaps[id]?.enabled && state.parameterMaps[id].source === "pitch"
  ));
  context.save();
  context.setLineDash([2, 5]);
  context.lineWidth = 1;
  for (const specification of mappings) {
    const mapping = state.parameterMaps[specification.id];
    const low = linearDrumParameterPosition(specification.id, mapping.low);
    const high = linearDrumParameterPosition(specification.id, mapping.high);
    context.strokeStyle = colorWithAlpha(specification.color, .45);
    context.beginPath();
    for (let index = 0; index <= 64; index += 1) {
      const source = index / 64;
      const amount = linearDrumMappingAmount(source, mapping.curve);
      const value = low + (high - low) * amount;
      const x = source * cssWidth;
      const y = cssHeight * (.92 - value * .82);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  context.restore();
}

function drawMorphMarkers(settings) {
  let markers;
  if (settings.model === "pitched") {
    const labels = settings.pitchedOrder.map((id) => (
      pitchedArchetypeById.get(id)?.label.toUpperCase() ?? id.toUpperCase()
    ));
    markers = [
      [settings.kickTomHz, `${labels[0]} / ${labels[1]}`],
      [settings.tomHandHz, `${labels[1]} / ${labels[2]}`],
      [settings.handAirHz, `${labels[2]} / AIR`],
    ];
  } else {
    markers = [
      [settings.kickTomHz, "KICK / TOM"],
      [settings.tomHandHz, "TOM / HAND"],
      [settings.handAirHz, "HAND / AIR"],
    ];
  }
  context.save();
  context.setLineDash([3, 5]);
  context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  for (const [frequency, label] of markers) {
    if (frequency >= state.rangeMax) continue;
    const position = linearDrumPositionAtFrequency(frequency, state.rangeMin, state.rangeMax);
    const x = position * cssWidth;
    context.strokeStyle = "rgba(218, 229, 225, .22)";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, cssHeight);
    context.stroke();
    context.fillStyle = "rgba(218, 229, 225, .48)";
    context.fillText(label, x, cssHeight - 13);
  }
  context.restore();
}

function drawAnalyser() {
  if (!state.audioOn || !audio.analyser) return;
  if (!analyserData || analyserData.length !== audio.analyser.frequencyBinCount) {
    analyserData = new Uint8Array(audio.analyser.frequencyBinCount);
  }
  audio.analyser.getByteTimeDomainData(analyserData);
  context.beginPath();
  analyserData.forEach((value, index) => {
    const x = index / Math.max(1, analyserData.length - 1) * cssWidth;
    const y = cssHeight * .84 + (value / 255 - .5) * cssHeight * .18;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = "rgba(218, 229, 225, .36)";
  context.lineWidth = 1;
  context.stroke();
}

function drawStage(timestamp) {
  scheduledFrame = 0;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#080b0c";
  context.fillRect(0, 0, cssWidth, cssHeight);

  const settings = synthSettings();
  const pitched = settings.model === "pitched";
  for (let x = 0; x < cssWidth; x += 8) {
    const position = x / cssWidth;
    const frequency = linearDrumFrequencyAtPosition(position, state.rangeMin, state.rangeMax);
    const weights = pitched
      ? linearDrumPitchedMorphWeights(frequency, settings)
      : linearDrumMorphWeights(frequency, settings);
    context.fillStyle = blendColor(weights, .045);
    context.fillRect(x, 0, 8, cssHeight);
  }

  context.strokeStyle = "rgba(218, 229, 225, .07)";
  context.lineWidth = 1;
  for (let index = 0; index <= 48; index += 1) {
    const x = index / 48 * cssWidth;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, cssHeight);
    context.stroke();
  }
  for (let index = 1; index < 6; index += 1) {
    const y = index / 6 * cssHeight;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(cssWidth, y);
    context.stroke();
  }

  drawFamilyCurves(settings);
  drawParameterMapCurves();
  drawMorphMarkers(settings);
  drawAnalyser();

  const cursorX = state.position * cssWidth;
  const weights = pitched
    ? linearDrumPitchedMorphWeights(currentFrequency(), settings)
    : linearDrumMorphWeights(currentFrequency(), settings);
  context.strokeStyle = blendColor(weights, .94);
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(cursorX, 0);
  context.lineTo(cursorX, cssHeight);
  context.stroke();

  pulses = pulses.filter(({ startedAt }) => timestamp - startedAt < 720);
  for (const pulse of pulses) {
    const age = (timestamp - pulse.startedAt) / 720;
    const x = pulse.position * cssWidth;
    const radius = 6 + age * 54 * pulse.velocity;
    context.strokeStyle = pulse.color;
    context.globalAlpha = 1 - age;
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(x, cssHeight * .5, radius, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;

  if (pulses.length || state.sweeping) scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
renderPresetBank();
bindControls();
renderMappingLanes();
paintSweepButton();
setPosition(state.position);
resizeCanvas();

window.addEventListener("pagehide", () => {
  stopSweep();
  audioLifecycleGeneration += 1;
  setAudioState(false);
  void audio.close();
});
