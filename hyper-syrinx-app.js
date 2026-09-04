import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));
const sum = (items) => items.reduce((total, item) => total + item.value, 0);
const nextId = (() => {
  let value = 0;
  return (prefix) => `${prefix}-${++value}`;
})();

const SPECIES = Object.freeze([
  ["elephant", "Elephant"],
  ["bird", "Bird"],
  ["frog", "Frog"],
  ["whale", "Whale"],
  ["human", "Human"],
  ["machine", "Apparatus"],
  ["hybrid", "Shared / hybrid"],
]);

const SPECIES_FREQUENCY = Object.freeze({
  elephant: 55,
  bird: 440,
  frog: 110,
  whale: 55,
  human: 220,
  machine: 220,
  hybrid: 220,
});

const TENSION_INTERVALS = Object.freeze([-7, -5, -3, 0, 2, 5, 7]);

function tissueFrequency(item) {
  const base = SPECIES_FREQUENCY[item.species] ?? SPECIES_FREQUENCY.hybrid;
  const intervalIndex = Math.round(clamp(item.value) * (TENSION_INTERVALS.length - 1));
  return clamp(base * 2 ** (TENSION_INTERVALS[intervalIndex] / 12), 28, 4_200);
}

function tissueWaveform(species) {
  if (species === "whale") return "sine";
  if (species === "machine") return "sawtooth";
  return "triangle";
}

const STAGES = Object.freeze([
  { id: "air", number: "01", title: "Breath", hint: "pressure sources", color: "#ff7058", parameter: "pressure" },
  { id: "gate", number: "02", title: "Openings", hint: "valves / apertures", color: "#f6d851", parameter: "aperture" },
  { id: "tissue", number: "03", title: "Tissues", hint: "membranes / labia", color: "#e78ae5", parameter: "tension" },
  { id: "apparatus", number: "04", title: "Apparati", hint: "syrinx / larynx", color: "#bb9cff", parameter: "coupling" },
  { id: "trachea", number: "05", title: "Tracheas", hint: "propagation tubes", color: "#5de5e0", parameter: "length" },
  { id: "tract", number: "06", title: "Tracts", hint: "resonant cavities", color: "#70e69d", parameter: "shape" },
  { id: "lips", number: "07", title: "Mouths + lips", hint: "shared radiators", color: "#c7ff3f", parameter: "opening" },
]);

const STAGE_BY_ID = new Map(STAGES.map((stage) => [stage.id, stage]));

function organName(stageId, species) {
  const names = {
    air: {
      elephant: "Bellows lung", bird: "Air-sac lung", frog: "Buccal pump", whale: "Pressure lung",
      human: "Breath lung", machine: "Pneumatic source", hybrid: "Shared bellows",
    },
    gate: {
      elephant: "Trunk valve", bird: "Bronchial gate", frog: "Mouth valve", whale: "Nasal gate",
      human: "Glottal opening", machine: "Variable aperture", hybrid: "Cross-species gate",
    },
    tissue: {
      elephant: "Massive membrane", bird: "Paired labia", frog: "Elastic membrane", whale: "Phonic lips",
      human: "Vocal folds", machine: "Silicone reed", hybrid: "Interlaced tissue",
    },
    apparatus: {
      elephant: "Laryngeal apparatus", bird: "Syringeal apparatus", frog: "Laryngeal drum", whale: "Nasal apparatus",
      human: "Laryngeal apparatus", machine: "Feedback apparatus", hybrid: "Syrinx–larynx",
    },
    trachea: {
      elephant: "Long trachea", bird: "Bird trachea", frog: "Short trachea", whale: "Nasal passage",
      human: "Human trachea", machine: "Coiled tube", hybrid: "Spliced trachea",
    },
    tract: {
      elephant: "Trunk tract", bird: "Oroesophageal cavity", frog: "Vocal sac tract", whale: "Cranial tract",
      human: "Vocal tract", machine: "Alloy cavity", hybrid: "Borrowed tract",
    },
    lips: {
      elephant: "Trunk lips", bird: "Beak + lips", frog: "Wide mouth", whale: "Blowhole lips",
      human: "Human lips", machine: "Speaker mouth", hybrid: "Shared lips",
    },
  };
  return names[stageId]?.[species] ?? "Unknown organ";
}

function module(stage, species, value) {
  return { id: nextId(stage), stage, species, value: clamp(value) };
}

function makePreset(id) {
  const definitions = {
    "elephant-bird": {
      label: "Elephant × Bird",
      equation: "ELEPHANT BREATH + BIRD LABIA → 1 SHARED LIP",
      route: "braid",
      metabolism: 0.34,
      crossCoupling: 0.58,
      breathTexture: 0.06,
      wetness: 0.27,
      modules: {
        air: [["elephant", 0.82], ["bird", 0.54]],
        gate: [["hybrid", 0.64]],
        tissue: [["bird", 0.58], ["elephant", 0.58]],
        apparatus: [["hybrid", 0.61]],
        trachea: [["elephant", 0.78], ["bird", 0.28]],
        tract: [["elephant", 0.73], ["bird", 0.38]],
        lips: [["hybrid", 0.57]],
      },
    },
    murmuration: {
      label: "Murmuration",
      equation: "3 AIR SACS + 6 LABIA → 2 FLOCK MOUTHS",
      route: "all",
      metabolism: 0.62,
      crossCoupling: 0.74,
      breathTexture: 0.12,
      wetness: 0.14,
      modules: {
        air: [["bird", 0.55], ["bird", 0.63], ["bird", 0.7]],
        gate: [["bird", 0.52], ["bird", 0.74]],
        tissue: [["bird", 0.82], ["bird", 0.7], ["bird", 0.61], ["bird", 0.88], ["bird", 0.76], ["bird", 0.67]],
        apparatus: [["bird", 0.36], ["bird", 0.64]],
        trachea: [["bird", 0.24], ["bird", 0.34], ["bird", 0.45]],
        tract: [["bird", 0.28], ["bird", 0.43], ["bird", 0.58]],
        lips: [["bird", 0.4], ["bird", 0.66]],
      },
    },
    hydra: {
      label: "Hydra throat",
      equation: "2 LUNGS × 4 MEMBRANES × 3 TRACTS → 3 ARGUMENTS",
      route: "braid",
      metabolism: 0.48,
      crossCoupling: 0.86,
      breathTexture: 0.09,
      wetness: 0.42,
      modules: {
        air: [["frog", 0.78], ["elephant", 0.68]],
        gate: [["frog", 0.62], ["human", 0.52]],
        tissue: [["frog", 0.34], ["human", 0.46], ["elephant", 0.22], ["bird", 0.72]],
        apparatus: [["frog", 0.57], ["hybrid", 0.77]],
        trachea: [["frog", 0.23], ["human", 0.48]],
        tract: [["frog", 0.64], ["human", 0.45], ["elephant", 0.76]],
        lips: [["frog", 0.72], ["human", 0.38], ["hybrid", 0.55]],
      },
    },
    "soft-machine": {
      label: "Soft machine",
      equation: "WHALE LUNG + SILICONE REEDS → HUMAN + SPEAKER MOUTHS",
      route: "chain",
      metabolism: 0.22,
      crossCoupling: 0.46,
      breathTexture: 0.03,
      wetness: 0.65,
      modules: {
        air: [["whale", 0.75], ["machine", 0.42]],
        gate: [["machine", 0.58], ["human", 0.38]],
        tissue: [["whale", 0.31], ["machine", 0.64], ["human", 0.48]],
        apparatus: [["machine", 0.72], ["hybrid", 0.48]],
        trachea: [["machine", 0.83], ["human", 0.42]],
        tract: [["whale", 0.78], ["machine", 0.56]],
        lips: [["human", 0.48], ["machine", 0.68]],
      },
    },
  };
  const source = definitions[id] ?? definitions["elephant-bird"];
  return {
    presetId: id in definitions ? id : "elephant-bird",
    label: source.label,
    equation: source.equation,
    route: source.route,
    metabolism: source.metabolism,
    crossCoupling: source.crossCoupling,
    breathTexture: source.breathTexture,
    wetness: source.wetness,
    modules: Object.fromEntries(STAGES.map(({ id: stageId }) => [
      stageId,
      source.modules[stageId].map(([species, value]) => module(stageId, species, value)),
    ])),
  };
}

let state = makePreset("elephant-bird");
let audioEnabled = false;
let transportActive = false;
let manualBreath = false;
let pointerBreathHeld = false;
let keyboardBreathHeld = false;
let draggedModuleId = null;
let rebuildTimer = 0;
let lastFrameTime = performance.now();

const field = $("moduleField");
const flowShell = $("flowShell");
const canvas = $("connectionCanvas");
const drawing = canvas.getContext("2d");
const template = $("moduleTemplate");

function speciesLabel(speciesId) {
  return SPECIES.find(([id]) => id === speciesId)?.[1] ?? "Unknown";
}

function formatModuleValue(item) {
  if (item.stage === "tissue") return `${Math.round(tissueFrequency(item))} Hz`;
  if (item.stage === "trachea") return `${(4 + item.value * 76).toFixed(1)} cm`;
  if (item.stage === "tract") return `${(2 + item.value * 58).toFixed(1)} cm`;
  return `${Math.round(item.value * 100)}%`;
}

function routeIndices(sourceCount, targetCount, route = state.route) {
  const edges = [];
  if (!sourceCount || !targetCount) return edges;
  for (let source = 0; source < sourceCount; source += 1) {
    const targets = route === "all"
      ? Array.from({ length: targetCount }, (_, index) => index)
      : route === "chain"
      ? [source % targetCount]
      : [source % targetCount, (source + 1) % targetCount];
    for (const target of new Set(targets)) edges.push([source, target]);
  }
  return edges;
}

function allRouteEdges() {
  return STAGES.slice(0, -1).flatMap((stage, index) => {
    const nextStage = STAGES[index + 1];
    const sources = state.modules[stage.id];
    const targets = state.modules[nextStage.id];
    return routeIndices(sources.length, targets.length).map(([sourceIndex, targetIndex]) => ({
      sourceId: sources[sourceIndex].id,
      targetId: targets[targetIndex].id,
      color: stage.color,
      stageIndex: index,
    }));
  });
}

function countLivingPaths() {
  let counts = new Map(state.modules.air.map((item) => [item.id, 1]));
  for (let stageIndex = 0; stageIndex < STAGES.length - 1; stageIndex += 1) {
    const sourceItems = state.modules[STAGES[stageIndex].id];
    const targetItems = state.modules[STAGES[stageIndex + 1].id];
    const next = new Map(targetItems.map((item) => [item.id, 0]));
    for (const [sourceIndex, targetIndex] of routeIndices(sourceItems.length, targetItems.length)) {
      const sourceCount = counts.get(sourceItems[sourceIndex].id) ?? 0;
      next.set(targetItems[targetIndex].id, Math.min(9999, (next.get(targetItems[targetIndex].id) ?? 0) + sourceCount));
    }
    counts = next;
  }
  return [...counts.values()].reduce((total, count) => Math.min(9999, total + count), 0);
}

function scheduleAudioRebuild(delay = 90) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => engine.rebuild(state), delay);
}

function buildModuleCard(item, stage, index) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.moduleId = item.id;
  card.dataset.stage = stage.id;
  card.style.setProperty("--stage-color", stage.color);
  card.style.setProperty("--organ-value", item.value.toFixed(3));
  card.style.setProperty("--module-bend", `${((item.value - 0.5) * 2.8).toFixed(2)}deg`);
  card.querySelector(".module-index").textContent = `${stage.number}.${String(index + 1).padStart(2, "0")}`;
  card.querySelector(".module-name").textContent = organName(stage.id, item.species);
  card.querySelector(".module-param-label").textContent = stage.parameter;
  card.querySelector(".module-value").textContent = formatModuleValue(item);

  const speciesSelect = card.querySelector(".module-species");
  speciesSelect.innerHTML = SPECIES.map(([id, label]) => `<option value="${id}">${label} material</option>`).join("");
  speciesSelect.value = item.species;
  speciesSelect.addEventListener("change", () => {
    item.species = speciesSelect.value;
    state.presetId = "custom";
    render();
    scheduleAudioRebuild(20);
    announce(`${organName(stage.id, item.species)} installed.`);
  });

  const slider = card.querySelector(".module-slider");
  slider.value = String(item.value);
  slider.setAttribute("aria-label", `${speciesLabel(item.species)} ${organName(stage.id, item.species)} ${stage.parameter}`);
  slider.addEventListener("input", () => {
    item.value = clamp(slider.value);
    card.style.setProperty("--organ-value", item.value.toFixed(3));
    card.style.setProperty("--module-bend", `${((item.value - 0.5) * 2.8).toFixed(2)}deg`);
    card.querySelector(".module-value").textContent = formatModuleValue(item);
    state.presetId = "custom";
    updateReadouts();
    scheduleAudioRebuild();
  });

  card.querySelector(".module-duplicate").addEventListener("click", () => {
    const clone = module(stage.id, item.species, clamp(item.value + (Math.random() - 0.5) * 0.12));
    state.modules[stage.id].splice(index + 1, 0, clone);
    state.presetId = "custom";
    render();
    scheduleAudioRebuild(20);
    announce(`${organName(stage.id, item.species)} multiplied in place.`);
  });

  const removeButton = card.querySelector(".module-remove");
  removeButton.disabled = state.modules[stage.id].length <= 1;
  removeButton.addEventListener("click", () => {
    if (state.modules[stage.id].length <= 1) return;
    state.modules[stage.id].splice(index, 1);
    state.presetId = "custom";
    render();
    scheduleAudioRebuild(20);
    announce(`${stage.title} module removed.`);
  });

  card.addEventListener("dragstart", (event) => {
    draggedModuleId = item.id;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  });
  card.addEventListener("dragend", () => {
    draggedModuleId = null;
    card.classList.remove("is-dragging");
  });
  card.addEventListener("dragover", (event) => event.preventDefault());
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    if (!draggedModuleId || draggedModuleId === item.id) return;
    const items = state.modules[stage.id];
    const fromIndex = items.findIndex(({ id }) => id === draggedModuleId);
    const toIndex = items.findIndex(({ id }) => id === item.id);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    state.presetId = "custom";
    render();
    scheduleAudioRebuild(20);
    announce(`${stage.title} routing order changed.`);
  });
  return card;
}

function render() {
  const columns = STAGES.map((stage) => {
    const column = document.createElement("section");
    column.className = "organ-column";
    column.dataset.stage = stage.id;
    column.style.setProperty("--stage-color", stage.color);
    column.innerHTML = `
      <header class="organ-column-header">
        <small>${stage.number} / ${stage.hint}</small>
        <h2>${stage.title}</h2>
        <button class="organ-column-add" type="button" aria-label="Add another ${stage.title} module">+</button>
      </header>
      <div class="organ-stack"></div>`;
    const stack = column.querySelector(".organ-stack");
    state.modules[stage.id].forEach((item, index) => stack.append(buildModuleCard(item, stage, index)));
    column.querySelector(".organ-column-add").addEventListener("click", () => {
      const reference = state.modules[stage.id].at(-1);
      const speciesIndex = SPECIES.findIndex(([id]) => id === reference?.species);
      const species = SPECIES[(speciesIndex + 1 + SPECIES.length) % SPECIES.length][0];
      state.modules[stage.id].push(module(stage.id, species, clamp((reference?.value ?? 0.5) + (Math.random() - 0.5) * 0.2)));
      state.presetId = "custom";
      render();
      scheduleAudioRebuild(20);
      announce(`Another ${stage.title.toLowerCase()} module entered the organism.`);
    });
    return column;
  });
  field.replaceChildren(...columns);
  updateReadouts();
  requestAnimationFrame(resizeAndDrawConnections);
}

function updateReadouts() {
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.presetId));
  }
  for (const button of document.querySelectorAll("[data-route]")) {
    button.setAttribute("aria-pressed", String(button.dataset.route === state.route));
  }
  $("headlineEquation").textContent = state.equation;
  $("metabolism").value = String(state.metabolism);
  $("crossCoupling").value = String(state.crossCoupling);
  $("breathTexture").value = String(state.breathTexture);
  $("wetness").value = String(state.wetness);
  $("metabolismOut").textContent = `${Math.round(state.metabolism * 100)}%`;
  $("crossCouplingOut").textContent = `${Math.round(state.crossCoupling * 100)}%`;
  $("breathTextureOut").textContent = `${Math.round(state.breathTexture * 100)}%`;
  $("wetnessOut").textContent = `${Math.round(state.wetness * 100)}%`;

  const sumMarkup = STAGES.map((stage) => (
    `<span>Σ ${stage.parameter} <b>${sum(state.modules[stage.id]).toFixed(2)}</b></span>`
  )).join("");
  $("sumReadout").innerHTML = sumMarkup;
  const paths = countLivingPaths();
  $("pathReadout").textContent = `${paths >= 9999 ? "9999+" : String(paths).padStart(2, "0")} LIVING PATHS`;

  const allModules = STAGES.flatMap(({ id }) => state.modules[id]);
  const exits = state.modules.lips.length;
  $("organismReadout").innerHTML = `
    <div><dt>modules</dt><dd>${String(allModules.length).padStart(2, "0")}</dd></div>
    <div><dt>source voices</dt><dd>${String(state.modules.tissue.length).padStart(2, "0")}</dd></div>
    <div><dt>shared exits</dt><dd>${String(exits).padStart(2, "0")}</dd></div>
    <div><dt>routing</dt><dd>${state.route.toUpperCase()}</dd></div>`;

  engine.updateGlobals(state);
}

function resizeAndDrawConnections(time = performance.now()) {
  const width = Math.max(flowShell.clientWidth, field.scrollWidth);
  const height = Math.max(flowShell.clientHeight, field.scrollHeight);
  const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, width, height);
  const shellRect = flowShell.getBoundingClientRect();
  const edges = allRouteEdges();

  for (const [edgeIndex, edge] of edges.entries()) {
    const source = field.querySelector(`[data-module-id="${edge.sourceId}"] .module-port-out`);
    const target = field.querySelector(`[data-module-id="${edge.targetId}"] .module-port-in`);
    if (!source || !target) continue;
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const x1 = sourceRect.left - shellRect.left + flowShell.scrollLeft + sourceRect.width / 2;
    const y1 = sourceRect.top - shellRect.top + flowShell.scrollTop + sourceRect.height / 2;
    const x2 = targetRect.left - shellRect.left + flowShell.scrollLeft + targetRect.width / 2;
    const y2 = targetRect.top - shellRect.top + flowShell.scrollTop + targetRect.height / 2;
    const bend = Math.max(20, (x2 - x1) * 0.48);
    drawing.beginPath();
    drawing.moveTo(x1, y1);
    drawing.bezierCurveTo(x1 + bend, y1, x2 - bend, y2, x2, y2);
    drawing.strokeStyle = `${edge.color}28`;
    drawing.lineWidth = state.route === "all" ? 0.65 : 1;
    drawing.stroke();

    if (transportActive || manualBreath) {
      const phase = ((time * (0.00017 + state.metabolism * 0.00035)) + edgeIndex * 0.071) % 1;
      const inverse = 1 - phase;
      const pointX = inverse ** 3 * x1
        + 3 * inverse ** 2 * phase * (x1 + bend)
        + 3 * inverse * phase ** 2 * (x2 - bend)
        + phase ** 3 * x2;
      const pointY = inverse ** 3 * y1
        + 3 * inverse ** 2 * phase * y1
        + 3 * inverse * phase ** 2 * y2
        + phase ** 3 * y2;
      drawing.beginPath();
      drawing.arc(pointX, pointY, 1.8, 0, Math.PI * 2);
      drawing.fillStyle = edge.color;
      drawing.shadowColor = edge.color;
      drawing.shadowBlur = 8;
      drawing.fill();
      drawing.shadowBlur = 0;
    }
  }
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function setManualBreath(active) {
  manualBreath = active;
  $("breathPad").setAttribute("aria-pressed", String(active));
  engine.setExcitation(transportActive || manualBreath);
  updateStatus();
}

function setTransport(active) {
  transportActive = active;
  $("transportButton").setAttribute("aria-pressed", String(active));
  $("transportIcon").textContent = active ? "■" : "▶";
  $("transportLabel").textContent = active ? "still" : "animate";
  document.querySelectorAll(".organ-module").forEach((card) => card.classList.toggle("is-sounding", active));
  engine.setExcitation(active || manualBreath);
  updateStatus();
}

function updateStatus() {
  const text = !audioEnabled
    ? "Audio sleeps. The anatomy is still editable."
    : manualBreath
    ? "Manual pressure crosses every connected organ."
    : transportActive
    ? `${state.label} is breathing through ${countLivingPaths()} simultaneous routes.`
    : "Audio is awake. Hold the pressure gate or animate the creature.";
  $("statusText").textContent = text;
}

class HyperSyrinxAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.analyser = null;
    this.delay = null;
    this.wetGain = null;
    this.graph = null;
    this.noiseBuffer = null;
    this.releaseOutput = null;
    this.samples = new Float32Array(256);
  }

  async initialize() {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) throw new Error("This browser does not provide Web Audio.");
    this.context = new Context({ latencyHint: "interactive" });
    unlockAudioContext(this.context);
    this.master = this.context.createGain();
    this.master.gain.value = Number($("level").value);
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    this.delay = this.context.createDelay(0.32);
    this.delay.delayTime.value = 0.065;
    this.wetGain = this.context.createGain();
    const feedback = this.context.createGain();
    feedback.gain.value = 0.22;
    this.delay.connect(feedback);
    feedback.connect(this.delay);
    this.delay.connect(this.wetGain);
    this.wetGain.connect(this.master);
    this.master.connect(compressor);
    compressor.connect(this.analyser);
    this.releaseOutput = connectAudioOutput(this.context, this.analyser, { runtime: globalThis });
    this.createNoiseBuffer();
    this.updateGlobals(state);
    this.rebuild(state);
  }

  createNoiseBuffer() {
    const length = Math.max(1, Math.round(this.context.sampleRate * 2));
    this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.76 + white * 0.24;
      data[index] = last;
    }
  }

  makeStageNode(stageId, item, index, total) {
    const context = this.context;
    const input = context.createGain();
    const output = context.createGain();
    const nodes = [input, output];
    if (stageId === "apparatus") {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1_100 + item.value * 5_200;
      filter.Q.value = 0.65 + item.value * 2.2;
      const shaper = context.createWaveShaper();
      const curve = new Float32Array(257);
      const drive = 0.85 + item.value * 1.8;
      for (let curveIndex = 0; curveIndex < curve.length; curveIndex += 1) {
        const x = curveIndex / (curve.length - 1) * 2 - 1;
        curve[curveIndex] = Math.tanh(x * drive) / Math.tanh(drive);
      }
      shaper.curve = curve;
      shaper.oversample = "2x";
      input.connect(shaper);
      shaper.connect(filter);
      filter.connect(output);
      nodes.push(filter, shaper);
    } else if (stageId === "trachea") {
      const delay = context.createDelay(0.012);
      delay.delayTime.value = 0.0004 + item.value * 0.006;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 11_000 - item.value * 7_000;
      filter.Q.value = 0.6 + item.value * 2.2;
      input.connect(delay);
      delay.connect(filter);
      filter.connect(output);
      nodes.push(delay, filter);
    } else if (stageId === "tract") {
      const formantOne = context.createBiquadFilter();
      const formantTwo = context.createBiquadFilter();
      formantOne.type = "peaking";
      formantTwo.type = "peaking";
      formantOne.frequency.value = 220 + (1 - item.value) * 820;
      formantTwo.frequency.value = 900 + item.value * 2_600;
      formantOne.Q.value = 1.8 + item.value * 4.2;
      formantTwo.Q.value = 2.2 + (1 - item.value) * 4;
      formantOne.gain.value = 5;
      formantTwo.gain.value = 3.5;
      input.connect(formantOne);
      formantOne.connect(formantTwo);
      formantTwo.connect(output);
      nodes.push(formantOne, formantTwo);
    } else if (stageId === "lips") {
      const highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 45 + (1 - item.value) * 360;
      highpass.Q.value = 0.7 + item.value * 1.8;
      const pan = context.createStereoPanner?.();
      input.connect(highpass);
      if (pan) {
        pan.pan.value = total <= 1 ? 0 : -0.75 + index / (total - 1) * 1.5;
        highpass.connect(pan);
        pan.connect(output);
        nodes.push(highpass, pan);
      } else {
        highpass.connect(output);
        nodes.push(highpass);
      }
    } else {
      input.connect(output);
    }
    return { input, output, nodes, item };
  }

  connectStages(sources, targets, route, branchNodes) {
    const edges = routeIndices(sources.length, targets.length, route);
    const outCounts = new Map();
    for (const [sourceIndex] of edges) outCounts.set(sourceIndex, (outCounts.get(sourceIndex) ?? 0) + 1);
    for (const [sourceIndex, targetIndex] of edges) {
      const branch = this.context.createGain();
      branch.gain.value = 0.62 / Math.sqrt(outCounts.get(sourceIndex) ?? 1);
      sources[sourceIndex].output.connect(branch);
      branch.connect(targets[targetIndex].input);
      branchNodes.push(branch);
    }
  }

  rebuild(anatomy) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const previous = this.graph;
    const output = this.context.createGain();
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.7, now + 0.035);
    output.connect(this.master);
    output.connect(this.delay);

    const noise = this.context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseFilter = this.context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1_200 + sum(anatomy.modules.gate) * 900;
    noiseFilter.Q.value = 1.4;
    const noiseGain = this.context.createGain();
    const breathDrive = Math.tanh(sum(anatomy.modules.air) * 0.55);
    noiseGain.gain.value = anatomy.breathTexture * breathDrive * 0.012
      / Math.sqrt(Math.max(1, anatomy.modules.tissue.length));
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);

    const sourceNodes = [];
    const tissueNodes = anatomy.modules.tissue.map((item, index) => {
      const input = this.context.createGain();
      const outputNode = this.context.createGain();
      const oscillator = this.context.createOscillator();
      const companion = this.context.createOscillator();
      const primaryGain = this.context.createGain();
      const companionGain = this.context.createGain();
      const frequency = tissueFrequency(item);
      oscillator.type = tissueWaveform(item.species);
      companion.type = "sine";
      oscillator.frequency.value = frequency;
      companion.frequency.value = frequency * 2;
      oscillator.detune.value = (index - (anatomy.modules.tissue.length - 1) / 2) * anatomy.crossCoupling * 7;
      companion.detune.value = -oscillator.detune.value * 0.6;
      primaryGain.gain.value = 0.075 / Math.sqrt(anatomy.modules.tissue.length);
      companionGain.gain.value = 0.011 / Math.sqrt(anatomy.modules.tissue.length);
      oscillator.connect(primaryGain);
      companion.connect(companionGain);
      primaryGain.connect(input);
      companionGain.connect(input);
      noiseGain.connect(input);
      input.connect(outputNode);
      oscillator.start();
      companion.start();
      sourceNodes.push(oscillator, companion);
      return { input, output: outputNode, nodes: [input, outputNode, primaryGain, companionGain], item, oscillator, companion, baseFrequency: frequency };
    });

    const branchNodes = [];
    const apparatusNodes = anatomy.modules.apparatus.map((item, index, items) => this.makeStageNode("apparatus", item, index, items.length));
    const tracheaNodes = anatomy.modules.trachea.map((item, index, items) => this.makeStageNode("trachea", item, index, items.length));
    const tractNodes = anatomy.modules.tract.map((item, index, items) => this.makeStageNode("tract", item, index, items.length));
    const lipNodes = anatomy.modules.lips.map((item, index, items) => this.makeStageNode("lips", item, index, items.length));
    this.connectStages(tissueNodes, apparatusNodes, anatomy.route, branchNodes);
    this.connectStages(apparatusNodes, tracheaNodes, anatomy.route, branchNodes);
    this.connectStages(tracheaNodes, tractNodes, anatomy.route, branchNodes);
    this.connectStages(tractNodes, lipNodes, anatomy.route, branchNodes);
    lipNodes.forEach((node) => node.output.connect(output));
    noise.start();

    this.graph = {
      output,
      noise,
      sourceNodes,
      tissueNodes,
      nodes: [noiseFilter, noiseGain, ...branchNodes, ...apparatusNodes.flatMap(({ nodes }) => nodes), ...tracheaNodes.flatMap(({ nodes }) => nodes), ...tractNodes.flatMap(({ nodes }) => nodes), ...lipNodes.flatMap(({ nodes }) => nodes)],
    };
    this.setExcitation(transportActive || manualBreath);

    if (previous) {
      previous.output.gain.cancelScheduledValues(now);
      previous.output.gain.setValueAtTime(Math.max(0.0001, previous.output.gain.value), now);
      previous.output.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      setTimeout(() => this.destroyGraph(previous), 100);
    }
  }

  destroyGraph(graph) {
    for (const source of [...(graph.sourceNodes ?? []), graph.noise]) {
      try { source?.stop(); } catch {}
      try { source?.disconnect(); } catch {}
    }
    for (const node of [graph.output, ...(graph.nodes ?? [])]) {
      try { node?.disconnect(); } catch {}
    }
  }

  setExcitation(active) {
    if (!this.context || !this.graph) return;
    const now = this.context.currentTime;
    const target = active ? 0.46 : 0.0001;
    this.graph.output.gain.cancelScheduledValues(now);
    this.graph.output.gain.setTargetAtTime(target, now, active ? 0.018 : 0.07);
  }

  updateGlobals(anatomy) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master?.gain.setTargetAtTime(Number($("level").value), now, 0.03);
    this.wetGain?.gain.setTargetAtTime(anatomy.wetness * 0.48, now, 0.05);
    this.delay?.delayTime.setTargetAtTime(0.025 + anatomy.wetness * 0.11, now, 0.05);
  }

  animate(time, anatomy) {
    if (!this.context || !this.graph) return;
    const metabolism = anatomy.metabolism;
    this.graph.tissueNodes.forEach((voice, index) => {
      const motion = Math.sin(time * (0.00035 + index * 0.00007) + index * 1.71);
      const drift = motion * metabolism * (4 + anatomy.crossCoupling * 9);
      voice.oscillator.detune.setTargetAtTime(drift, this.context.currentTime, 0.04);
      voice.companion.detune.setTargetAtTime(-drift * 0.55, this.context.currentTime, 0.05);
    });
  }

  level() {
    if (!this.analyser) return 0;
    if (this.samples.length !== this.analyser.fftSize) this.samples = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(this.samples);
    let peak = 0;
    for (const sample of this.samples) peak = Math.max(peak, Math.abs(sample));
    return clamp(peak * 4.5);
  }

  async suspend() {
    if (this.context?.state === "running") await this.context.suspend();
  }

  close() {
    if (this.graph) this.destroyGraph(this.graph);
    this.releaseOutput?.();
    this.context?.close?.();
  }
}

const engine = new HyperSyrinxAudio();

async function enableAudio() {
  if (audioEnabled) return true;
  try {
    $("audioButton").disabled = true;
    $("audioState").textContent = "waking";
    await engine.initialize();
    audioEnabled = true;
    $("audioButton").setAttribute("aria-pressed", "true");
    $("audioState").textContent = "on";
    $("audioError").hidden = true;
    updateStatus();
    return true;
  } catch (error) {
    $("audioError").hidden = false;
    $("audioError").textContent = error?.message || "The interconnected voice could not start.";
    $("audioState").textContent = "error";
    return false;
  } finally {
    $("audioButton").disabled = false;
  }
}

async function toggleAudio() {
  if (!audioEnabled) {
    await enableAudio();
    return;
  }
  setTransport(false);
  pointerBreathHeld = false;
  keyboardBreathHeld = false;
  setManualBreath(false);
  await engine.suspend();
  audioEnabled = false;
  $("audioButton").setAttribute("aria-pressed", "false");
  $("audioState").textContent = "off";
  updateStatus();
}

function applyPreset(id) {
  const wasActive = transportActive;
  state = makePreset(id);
  render();
  engine.rebuild(state);
  if (wasActive) engine.setExcitation(true);
  announce(`${state.label} anatomy loaded. ${state.equation.toLowerCase()}.`);
}

function mutate() {
  const speciesIds = SPECIES.map(([id]) => id);
  for (const stage of STAGES) {
    const items = state.modules[stage.id];
    for (const item of items) {
      if (Math.random() < 0.46) item.species = speciesIds[Math.floor(Math.random() * speciesIds.length)];
      item.value = clamp(item.value + (Math.random() - 0.5) * 0.46, 0.06, 0.94);
    }
    if (Math.random() < 0.3 && items.length < 6) {
      const source = items[Math.floor(Math.random() * items.length)];
      items.splice(Math.floor(Math.random() * (items.length + 1)), 0, module(stage.id, source.species, clamp(source.value + (Math.random() - 0.5) * 0.2)));
    } else if (Math.random() < 0.2 && items.length > 1) {
      items.splice(Math.floor(Math.random() * items.length), 1);
    }
  }
  state.metabolism = clamp(state.metabolism + (Math.random() - 0.5) * 0.32);
  state.crossCoupling = clamp(state.crossCoupling + (Math.random() - 0.5) * 0.32);
  state.breathTexture = clamp(state.breathTexture + (Math.random() - 0.5) * 0.18, 0, 0.35);
  state.presetId = "custom";
  state.label = "Mutant organism";
  state.equation = `${state.modules.air.length} BREATHS + ${state.modules.tissue.length} TISSUES → ${state.modules.lips.length} SHARED EXIT${state.modules.lips.length === 1 ? "" : "S"}`;
  render();
  engine.rebuild(state);
  announce("Anatomy mutated. Every pressure, tissue, cavity, and exit has been renegotiated.");
}

for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
}

for (const button of document.querySelectorAll("[data-route]")) {
  button.addEventListener("click", () => {
    state.route = button.dataset.route;
    state.presetId = "custom";
    updateReadouts();
    resizeAndDrawConnections();
    engine.rebuild(state);
    announce(`${button.textContent.trim()} routing connected.`);
  });
}

for (const id of ["metabolism", "crossCoupling", "breathTexture", "wetness"]) {
  $(id).addEventListener("input", () => {
    state[id] = clamp($(id).value);
    state.presetId = "custom";
    updateReadouts();
    if (id === "crossCoupling" || id === "breathTexture") scheduleAudioRebuild();
  });
}

$("level").addEventListener("input", () => {
  $("levelOut").textContent = `${Math.round(Number($("level").value) * 100)}%`;
  engine.updateGlobals(state);
});

$("audioButton").addEventListener("click", toggleAudio);
$("transportButton").addEventListener("click", async () => {
  if (!audioEnabled && !(await enableAudio())) return;
  setTransport(!transportActive);
});
$("mutateButton").addEventListener("click", mutate);
$("resetButton").addEventListener("click", () => applyPreset("elephant-bird"));

const breathPad = $("breathPad");
breathPad.addEventListener("pointerdown", async (event) => {
  event.preventDefault();
  pointerBreathHeld = true;
  breathPad.setPointerCapture?.(event.pointerId);
  if (!audioEnabled && !(await enableAudio())) return;
  if (pointerBreathHeld) setManualBreath(true);
});
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"]) {
  breathPad.addEventListener(eventName, () => {
    pointerBreathHeld = false;
    setManualBreath(keyboardBreathHeld);
  });
}

document.addEventListener("keydown", async (event) => {
  if (event.code !== "Space" || event.repeat || /input|select|button|textarea/i.test(event.target?.tagName)) return;
  event.preventDefault();
  keyboardBreathHeld = true;
  if (!audioEnabled && !(await enableAudio())) return;
  if (keyboardBreathHeld) setManualBreath(true);
});
document.addEventListener("keyup", (event) => {
  if (event.code !== "Space") return;
  event.preventDefault();
  keyboardBreathHeld = false;
  setManualBreath(pointerBreathHeld);
});

const resizeObserver = new ResizeObserver(() => requestAnimationFrame(resizeAndDrawConnections));
resizeObserver.observe(flowShell);
flowShell.addEventListener("scroll", () => requestAnimationFrame(resizeAndDrawConnections), { passive: true });

function animate(time) {
  const elapsed = Math.min(80, time - lastFrameTime);
  lastFrameTime = time;
  resizeAndDrawConnections(time);
  engine.animate(time, state);
  const level = engine.level();
  const pressure = transportActive || manualBreath ? Math.max(0.1, level) : 0;
  $("breathMeter").style.width = `${Math.round(pressure * 100)}%`;
  if (elapsed > 0 && (transportActive || manualBreath) && state.metabolism > 0.04) {
    const wave = Math.sin(time * 0.0012) * state.metabolism;
    document.documentElement.style.setProperty("--hyper-metabolic-wave", wave.toFixed(3));
  }
  requestAnimationFrame(animate);
}

globalThis.addEventListener("pagehide", () => {
  resizeObserver.disconnect();
  engine.close();
});

render();
requestAnimationFrame(animate);
