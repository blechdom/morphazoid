import {
  MICROMORPH_DEFAULTS,
  MICROMORPH_PCM_CHUNK_FRAMES,
  MICROMORPH_PRESETS,
  MicromorphAudio,
  micromorphStageName,
  micromorphStageWeights,
  sanitizeMicromorphParams,
} from "./src/micromorph.js";
import {
  MICROMORPH_MODEL_CLIENT_STATES,
  MicromorphModelClient,
  redactMicromorphEndpoint,
} from "./src/micromorph-model-client.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const audio = new MicromorphAudio(globalThis);
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  ?? false;
const STORAGE_KEY = "morphazoid:micromorph:v1";
const DEFAULT_ENDPOINT = "ws://127.0.0.1:3939/v1/stream";
const CONTROL_IDS = Object.freeze([
  "derivation",
  "material",
  "structure_lock",
  "memory",
  "mutation",
  "continuation",
]);
const STAGE_COLORS = Object.freeze([
  "#8df7c7",
  "#78d9ff",
  "#bca1ff",
  "#ff83bd",
  "#ffbd6d",
]);

const firstPreset = MICROMORPH_PRESETS.find(({ id }) => id === "glass-lung")
  ?? MICROMORPH_PRESETS[0];

const state = {
  parameters: {
    ...sanitizeMicromorphParams({
      ...MICROMORPH_DEFAULTS,
      ...firstPreset.parameters,
    }),
  },
  anchors: { ...firstPreset.anchors },
  preset: firstPreset.id,
  audioOn: false,
  engineStatus: Object.freeze({
    state: MICROMORPH_MODEL_CLIENT_STATES.MODEL_UNAVAILABLE,
    ready: false,
    connected: false,
    lastError: null,
    config: null,
  }),
  telemetry: audio.state.telemetry,
  modelClient: null,
  modelReleases: [],
  engineMessage: "",
  modelBusy: false,
};

let canvasWidth = 1;
let canvasHeight = 1;
let pixelRatio = 1;
let animationFrame = 0;
let disposed = false;
let draggingDerivation = false;
let controlSendFrame = 0;
let conditionSendTimer = 0;
let inputWaveform = new Float32Array(1_024);
let outputWaveform = new Float32Array(1_024);

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function saveLocalState() {
  try {
    let endpoint = DEFAULT_ENDPOINT;
    try {
      endpoint = redactMicromorphEndpoint($("engineUrl").value);
    } catch {
      // Invalid in-progress endpoint edits are never persisted.
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      parameters: state.parameters,
      anchors: state.anchors,
      endpoint,
    }));
  } catch {
    // Private browsing and embedded hosts may reject storage.
  }
}

function restoreLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return;
    state.parameters = {
      ...sanitizeMicromorphParams({
        ...state.parameters,
        ...saved.parameters,
      }),
    };
    if (saved.anchors && typeof saved.anchors === "object") {
      state.anchors = {
        a: String(saved.anchors.a ?? state.anchors.a).slice(0, 512),
        b: String(saved.anchors.b ?? state.anchors.b).slice(0, 512),
      };
    }
    if (typeof saved.endpoint === "string" && saved.endpoint.length <= 512) {
      try {
        $("engineUrl").value = redactMicromorphEndpoint(saved.endpoint);
      } catch {
        $("engineUrl").value = DEFAULT_ENDPOINT;
      }
    }
    state.preset = null;
  } catch {
    // Invalid old state is ignored and replaced on the next interaction.
  }
}

function modelIsReady() {
  return Boolean(state.engineStatus.ready && state.modelClient);
}

function modelPcmIsAudible() {
  return Boolean(modelIsReady() && state.audioOn && state.telemetry.modelPcmActive);
}

function controlValues() {
  return {
    derivation: state.parameters.derivation,
    material: state.parameters.material,
    structure_lock: state.parameters.structureLock,
    memory: state.parameters.memory,
    mutation: state.parameters.mutation,
    continuation: state.parameters.continuation,
  };
}

function scheduleModelControls() {
  if (!modelIsReady() || controlSendFrame) return;
  controlSendFrame = requestAnimationFrame(() => {
    controlSendFrame = 0;
    if (!modelIsReady()) return;
    try {
      state.modelClient.sendControls(controlValues());
    } catch (error) {
      state.engineMessage = error.message;
      updateEngineInterface();
    }
  });
}

function scheduleModelCondition() {
  if (conditionSendTimer) clearTimeout(conditionSendTimer);
  conditionSendTimer = setTimeout(() => {
    conditionSendTimer = 0;
    if (!modelIsReady()) return;
    try {
      state.modelClient.sendCondition?.({
        anchors: state.anchors,
      });
    } catch (error) {
      state.engineMessage = error.message;
      updateEngineInterface();
    }
  }, 180);
}

function updateEngineInterface() {
  const status = state.engineStatus;
  const stateName = status.state;
  const ready = Boolean(status.ready);
  const modelAudible = modelPcmIsAudible();
  const fallbackActive = ready && state.audioOn && !modelAudible;
  const connecting = stateName === MICROMORPH_MODEL_CLIENT_STATES.CONNECTING
    || stateName === MICROMORPH_MODEL_CLIENT_STATES.CONNECTED;
  const failed = Boolean(status.lastError);
  const engineName = status.serverModelId
    ?? status.config?.modelId
    ?? (ready ? "Local diffusion model" : connecting ? "Local model handshake" : "No model connected");
  const latencyFrames = status.algorithmicLatencyFrames;
  const latencyDetail = Number.isInteger(latencyFrames) && status.config?.sampleRate
    ? ` · ${Math.round(latencyFrames / status.config.sampleRate * 1_000)} ms algorithmic latency`
    : "";
  const detail = state.engineMessage
    || status.lastError?.message
    || status.remoteStatus?.message
    || (modelAudible
      ? `${status.config?.sampleRate ?? "—"} Hz · ${status.config?.outputChannels ?? 2} channel PCM${latencyDetail}`
      : ready && state.audioOn
        ? "Model is ready, but no model PCM is currently audible; rehearsal fallback is active."
        : ready
          ? "Model is ready. Start the microphone to begin the local PCM stream."
      : connecting
        ? "Waiting for the server hello and stream configuration."
        : "Deterministic spectral rehearsal is available.");

  $("engineCard").dataset.state = modelAudible ? "live" : ready || connecting ? "connecting" : "unavailable";
  $("engineName").textContent = engineName;
  $("engineDetail").textContent = detail;
  $("enginePill").className = `micromorph-engine-pill ${modelAudible ? "live" : ready ? "ready" : connecting ? "connecting" : "rehearsal"}`;
  $("enginePillText").textContent = modelAudible
    ? `${engineName} · model PCM audible`
    : fallbackActive
      ? "model ready · rehearsal fallback"
      : ready
        ? "model ready · microphone off"
    : connecting
      ? "local model · negotiating"
      : failed
        ? "model unavailable · rehearsal dsp"
        : "rehearsal dsp · no model";
  $("engineSummary").textContent = modelAudible
    ? "model pcm · audible"
    : fallbackActive
      ? "model ready · fallback"
      : ready
        ? "model ready · mic off"
    : connecting
      ? "connecting · rehearsal"
      : "unavailable · rehearsal";
  setPressed($("connectModel"), ready || connecting);
  $("connectModel").textContent = ready || connecting
    ? "Disconnect model"
    : "Connect local model";
  $("signalEngine").textContent = modelAudible ? "Diffusion" : "Rehearsal";
  $("signalEngineDetail").textContent = modelAudible ? "local model PCM" : "bounded DSP";
  $("signalSummary").textContent = modelAudible ? "model pcm audible" : "rehearsal path";
  $("truthNote").classList.toggle("model-live", modelAudible);
  $("truthNote").textContent = modelAudible
    ? "Local model PCM is audible now. Microphone PCM and sample-clocked controls cross only the displayed loopback boundary; inference never runs on the browser audio thread."
    : fallbackActive
      ? "The local model is connected, but model PCM is not currently audible. The bounded deterministic rehearsal is carrying the wet path until the stream recovers."
      : ready
        ? "The local model is ready, but the microphone is off. No PCM is crossing the model boundary and the neural path is not audible."
        : "No neural model is active. The audible wet path is a deterministic spectral rehearsal used to test the instrument and control contract.";
  $("privacyState").textContent = ready && state.audioOn
    ? `Microphone PCM is being sent only to ${status.endpoint ?? "the selected loopback model host"}.`
    : ready
      ? `The local model is connected at ${status.endpoint ?? "the selected loopback host"}, but the microphone is stopped and no PCM is being sent.`
      : "The microphone stays in this browser while no model host is connected.";
  const config = status.config;
  $("controlRate").textContent = config
    ? "sample clock"
    : "—";
  $("inputDrops").textContent = String(status.droppedPcmInputFrames ?? 0);
  audio.setModelActive(state.audioOn && ready);
}

function updateInterface({ drawNow = true, sendControls = true } = {}) {
  const parameters = state.parameters;
  const stageName = micromorphStageName(parameters.derivation);
  setPressed($("audioButton"), state.audioOn);
  $("audioState").textContent = state.audioOn ? "on" : "off";
  $("sourceSummary").textContent = state.audioOn ? "microphone · listening" : "microphone · local";

  for (const id of [
    "derivation",
    "material",
    "structureLock",
    "memory",
    "mutation",
    "continuation",
    "inputGain",
    "outputLevel",
  ]) {
    $(id).value = String(parameters[id]);
  }
  $("anchorA").value = state.anchors.a;
  $("anchorB").value = state.anchors.b;
  $("derivationOut").textContent = percent(parameters.derivation);
  $("materialOut").textContent = `${Math.round(parameters.material * 100)}% B`;
  $("structureLockOut").textContent = percent(parameters.structureLock);
  $("memoryOut").textContent = percent(parameters.memory);
  $("mutationOut").textContent = percent(parameters.mutation);
  $("continuationOut").textContent = percent(parameters.continuation);
  $("inputGainOut").textContent = percent(parameters.inputGain);
  $("outputLevelOut").textContent = percent(parameters.outputLevel);
  $("derivationSummary").textContent = `${percent(parameters.derivation)} · ${stageName}`;
  $("matterSummary").textContent = `${Math.round((1 - parameters.material) * 100)}% A · ${Math.round(parameters.material * 100)}% B`;
  $("behaviorSummary").textContent = `${percent(parameters.structureLock)} structure · ${percent(parameters.memory)} memory`;

  canvas.setAttribute("aria-valuenow", String(Math.round(parameters.derivation * 100)));
  canvas.setAttribute(
    "aria-valuetext",
    `${Math.round(parameters.derivation * 100)} percent, ${stageName}`,
  );
  $("stageReadout").textContent = [
    state.audioOn ? "MIC LIVE" : "MIC OFF",
    `${stageName.toUpperCase()} ${percent(parameters.derivation)}`,
    modelPcmIsAudible() ? "MODEL PCM" : "LOCAL REHEARSAL",
  ].join(" · ");
  $("stageCaption").textContent = modelPcmIsAudible()
    ? `microphone → ${stageName} through local diffusion`
    : `microphone → ${stageName} through rehearsal dsp`;

  for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
    setPressed(button, button.dataset.preset === state.preset);
  }
  audio.setParameters(parameters);
  updateEngineInterface();
  if (sendControls) scheduleModelControls();
  if (drawNow) scheduleDraw();
}

function renderPresets() {
  const fragment = document.createDocumentFragment();
  for (const preset of MICROMORPH_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.preset = preset.id;
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", String(preset.id === state.preset));
    button.addEventListener("click", () => applyPreset(preset.id));
    fragment.append(button);
  }
  $("presetGrid").replaceChildren(fragment);
}

function applyPreset(id) {
  const preset = MICROMORPH_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  state.preset = preset.id;
  state.parameters = {
    ...sanitizeMicromorphParams({
      ...MICROMORPH_DEFAULTS,
      ...preset.parameters,
      inputGain: state.parameters.inputGain,
      outputLevel: state.parameters.outputLevel,
    }),
  };
  state.anchors = { ...preset.anchors };
  state.engineMessage = "";
  updateInterface();
  scheduleModelCondition();
  saveLocalState();
  announce(`${preset.label} organism loaded.`);
}

function markCustom() {
  state.preset = null;
}

function bindRange(id) {
  $(id).addEventListener("input", () => {
    markCustom();
    state.parameters = {
      ...sanitizeMicromorphParams({
        ...state.parameters,
        [id]: Number($(id).value),
      }),
    };
    updateInterface();
    saveLocalState();
  });
}

async function toggleAudio() {
  clearAudioError();
  $("audioButton").disabled = true;
  try {
    if (state.audioOn) {
      await audio.stop();
      state.audioOn = false;
      audio.setModelActive(false);
      announce("Microphone stopped.");
    } else {
      await audio.start();
      state.audioOn = true;
      audio.setModelActive(modelIsReady());
      announce(modelIsReady()
        ? "Microphone is streaming to the local model; rehearsal remains audible until model PCM arrives."
        : "Microphone live through the deterministic rehearsal path. No model is connected.");
    }
  } catch (error) {
    state.audioOn = false;
    audio.setModelActive(false);
    if (error?.code !== "micromorph-audio-cancelled") showAudioError(error);
  } finally {
    if (!disposed) {
      $("audioButton").disabled = false;
      updateInterface({ sendControls: false });
    }
  }
}

async function stopMicrophone(message = "Microphone stopped.") {
  const wasActive = state.audioOn || Boolean(audio.state.starting);
  if (!wasActive) return false;
  await audio.stop();
  state.audioOn = false;
  audio.setModelActive(false);
  updateInterface({ sendControls: false });
  announce(message);
  return true;
}

function releaseModelClient() {
  for (const release of state.modelReleases.splice(0)) release?.();
  state.modelClient?.dispose();
  state.modelClient = null;
  audio.setInputFrameHandler(null);
  state.engineStatus = Object.freeze({
    state: MICROMORPH_MODEL_CLIENT_STATES.DISCONNECTED,
    ready: false,
    connected: false,
    lastError: null,
    config: null,
  });
  state.engineMessage = "";
  audio.setModelActive(false);
}

async function toggleModel() {
  if (state.modelBusy || disposed) return;
  state.modelBusy = true;
  $("connectModel").disabled = true;
  let client = null;
  let endpoint = $("engineUrl").value.trim() || DEFAULT_ENDPOINT;
  try {
    if (state.modelClient) {
      const current = state.modelClient.getStatus();
      if (current.connected
        || current.state === MICROMORPH_MODEL_CLIENT_STATES.CONNECTING) {
        releaseModelClient();
        updateInterface({ sendControls: false });
        announce("Local model disconnected. Rehearsal DSP remains available.");
        return;
      }
      releaseModelClient();
    }

    clearAudioError();
    state.engineMessage = "";
    await audio.initialize();
    if (disposed) return;
    if (!state.audioOn) await audio.stop();
    client = new MicromorphModelClient({
      endpoint,
      config: {
        sampleRate: audio.state.sampleRate ?? 48_000,
        blockSize: MICROMORPH_PCM_CHUNK_FRAMES,
        inputChannels: 1,
        outputChannels: 2,
        pcmFormat: "f32le",
        controls: CONTROL_IDS.map((id) => ({
          id,
          defaultValue: controlValues()[id],
        })),
      },
    });
    state.modelClient = client;
    state.modelReleases = [
      client.subscribeStatus((status) => {
        if (state.modelClient !== client || disposed) return;
        const becameReady = status.ready && !state.engineStatus.ready;
        state.engineStatus = status;
        if (becameReady) {
          state.engineMessage = "";
          audio.configureModelPcm({
            channels: status.config?.outputChannels,
            blockSize: status.config?.blockSize,
          });
          scheduleModelControls();
          scheduleModelCondition();
          announce("Local diffusion model is ready.");
        }
        updateInterface({ sendControls: false });
      }),
      client.subscribePcmOutput((block) => {
        if (state.modelClient !== client || disposed) return;
        const browserSampleRate = audio.state.sampleRate;
        if (browserSampleRate && block.sampleRate !== browserSampleRate) {
          state.engineMessage = `Model PCM is ${block.sampleRate} Hz; this browser is ${browserSampleRate} Hz. Configure the adapter to resample.`;
          updateEngineInterface();
          return;
        }
        if (!audio.enqueueModelPcm(block.samples, { channels: block.channels })) {
          state.engineMessage = "Model PCM block was rejected by the bounded audio renderer.";
          updateEngineInterface();
        }
      }),
      client.subscribeProtocolErrors((detail) => {
        if (state.modelClient !== client || disposed) return;
        state.engineMessage = detail.message;
        updateEngineInterface();
      }),
    ];
    audio.setInputFrameHandler((frame) => {
      if (state.modelClient !== client || !client.getStatus().ready) return;
      try {
        const result = client.sendPcmInput(frame.samples);
        if (result.dropped) $("inputDrops").textContent = String(
          client.getStatus().droppedPcmInputFrames,
        );
      } catch (error) {
        state.engineMessage = error.message;
        updateEngineInterface();
      }
    });
    await client.connect();
    if (state.modelClient !== client || disposed) return;
    saveLocalState();
  } catch (error) {
    if (disposed || (client && state.modelClient !== client)) return;
    const message = error instanceof Error ? error.message : String(error);
    releaseModelClient();
    state.engineMessage = message;
    state.engineStatus = Object.freeze({
      state: MICROMORPH_MODEL_CLIENT_STATES.ERROR,
      ready: false,
      connected: false,
      endpoint,
      lastError: Object.freeze({ code: "connection-failed", message }),
      config: null,
      droppedPcmInputFrames: 0,
    });
    updateInterface({ sendControls: false });
    announce(`Model unavailable. ${message} Rehearsal DSP remains active.`);
  } finally {
    state.modelBusy = false;
    if (!disposed) $("connectModel").disabled = false;
  }
}

function resizeCanvas() {
  const bounds = $("stageWrap").getBoundingClientRect();
  pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  canvasWidth = Math.max(1, Math.round(bounds.width));
  canvasHeight = Math.max(1, Math.round(bounds.height));
  canvas.width = Math.round(canvasWidth * pixelRatio);
  canvas.height = Math.round(canvasHeight * pixelRatio);
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  scheduleDraw();
}

function stageGeometry() {
  const short = Math.min(canvasWidth, canvasHeight);
  return {
    centerX: canvasWidth * (canvasWidth < 620 ? 0.56 : 0.54),
    centerY: canvasHeight * 0.46,
    outerRadius: Math.max(62, Math.min(short * 0.39, canvasWidth * 0.29)),
  };
}

function stageRadius(index, outerRadius) {
  return outerRadius * (1 - index * 0.145);
}

function waveformAt(samples, phase) {
  if (!samples?.length) return 0;
  const index = Math.max(0, Math.min(samples.length - 1, Math.floor(phase * samples.length)));
  return Number.isFinite(samples[index]) ? samples[index] : 0;
}

function drawRing({
  centerX,
  centerY,
  radius,
  color,
  weight,
  stageIndex,
  now,
}) {
  const points = 180;
  const liveWaveform = stageIndex < 2 ? inputWaveform : outputWaveform;
  const amplitude = 1.5 + weight * 9 + state.telemetry.inputRms * 18;
  context2d.beginPath();
  for (let point = 0; point <= points; point += 1) {
    const phase = point / points;
    const angle = phase * Math.PI * 2 - Math.PI * 0.5;
    const wave = waveformAt(liveWaveform, phase);
    const breathing = Math.sin(angle * (3 + stageIndex) + now * 0.00045 * (stageIndex + 1));
    const mutation = state.parameters.mutation * Math.sin(
      angle * (11 + stageIndex * 2) - now * 0.0011,
    );
    const displacedRadius = radius + wave * amplitude + breathing * weight * 1.8 + mutation;
    const x = centerX + Math.cos(angle) * displacedRadius;
    const y = centerY + Math.sin(angle) * displacedRadius;
    if (point === 0) context2d.moveTo(x, y);
    else context2d.lineTo(x, y);
  }
  context2d.closePath();
  context2d.strokeStyle = color;
  context2d.globalAlpha = 0.23 + weight * 0.72;
  context2d.lineWidth = 0.75 + weight * 1.8;
  context2d.shadowColor = color;
  context2d.shadowBlur = weight * 16;
  context2d.stroke();
  context2d.shadowBlur = 0;

  const particleCount = stageIndex + 3;
  for (let particle = 0; particle < particleCount; particle += 1) {
    const phase = (now * 0.000025 * (stageIndex + 1)
      + particle / particleCount
      + stageIndex * 0.087) % 1;
    const angle = phase * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    context2d.beginPath();
    context2d.arc(x, y, 1 + weight * 2.2, 0, Math.PI * 2);
    context2d.fillStyle = color;
    context2d.globalAlpha = 0.25 + weight * 0.7;
    context2d.fill();
  }
}

function scheduleDraw() {
  if (disposed || animationFrame) return;
  animationFrame = requestAnimationFrame(draw);
}

function draw(now = performance.now()) {
  animationFrame = 0;
  if (!context2d || disposed) return;
  if (audio.getWaveforms(inputWaveform, outputWaveform) === false && state.audioOn) {
    inputWaveform.fill(0);
    outputWaveform.fill(0);
  }
  context2d.clearRect(0, 0, canvasWidth, canvasHeight);
  const geometry = stageGeometry();
  const weights = micromorphStageWeights(state.parameters.derivation);

  context2d.save();
  for (let index = 0; index < 5; index += 1) {
    drawRing({
      ...geometry,
      radius: stageRadius(index, geometry.outerRadius),
      color: STAGE_COLORS[index],
      weight: weights[index],
      stageIndex: index,
      now,
    });
  }

  const selectedRadius = geometry.outerRadius
    * (1 - state.parameters.derivation * 4 * 0.145);
  const readerAngle = -Math.PI * 0.16;
  const readerX = geometry.centerX + Math.cos(readerAngle) * selectedRadius;
  const readerY = geometry.centerY + Math.sin(readerAngle) * selectedRadius;
  context2d.beginPath();
  context2d.moveTo(geometry.centerX, geometry.centerY);
  context2d.lineTo(readerX, readerY);
  context2d.strokeStyle = "rgba(230, 244, 239, 0.16)";
  context2d.globalAlpha = 1;
  context2d.lineWidth = 0.75;
  context2d.stroke();
  context2d.beginPath();
  context2d.arc(readerX, readerY, 4.5, 0, Math.PI * 2);
  const selectedIndex = Math.round(state.parameters.derivation * 4);
  context2d.fillStyle = STAGE_COLORS[selectedIndex];
  context2d.shadowColor = STAGE_COLORS[selectedIndex];
  context2d.shadowBlur = 14;
  context2d.fill();
  context2d.restore();

  if (!reducedMotion || state.audioOn || modelIsReady()) {
    scheduleDraw();
  }
}

function derivationFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  const geometry = stageGeometry();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const radius = Math.hypot(x - geometry.centerX, y - geometry.centerY);
  const innerRadius = stageRadius(4, geometry.outerRadius);
  const normalized = 1 - (radius - innerRadius) / Math.max(1, geometry.outerRadius - innerRadius);
  return Math.max(0, Math.min(1, normalized));
}

function setDerivation(value, { announceValue = false } = {}) {
  markCustom();
  state.parameters = {
    ...state.parameters,
    derivation: Math.max(0, Math.min(1, value)),
  };
  updateInterface();
  saveLocalState();
  if (announceValue) {
    announce(`${micromorphStageName(state.parameters.derivation)}, ${percent(state.parameters.derivation)} derivation.`);
  }
}

function bindStage() {
  canvas.addEventListener("pointerdown", (event) => {
    draggingDerivation = true;
    canvas.setPointerCapture?.(event.pointerId);
    setDerivation(derivationFromPointer(event));
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!draggingDerivation) return;
    setDerivation(derivationFromPointer(event));
  });
  canvas.addEventListener("pointerup", (event) => {
    draggingDerivation = false;
    canvas.releasePointerCapture?.(event.pointerId);
    setDerivation(derivationFromPointer(event), { announceValue: true });
  });
  canvas.addEventListener("pointercancel", () => {
    draggingDerivation = false;
  });
  canvas.addEventListener("keydown", (event) => {
    let next = state.parameters.derivation;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= 0.02;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 0.02;
    else if (event.key === "PageDown") next -= 0.1;
    else if (event.key === "PageUp") next += 0.1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    setDerivation(next, { announceValue: true });
  });
}

function resetAll() {
  state.parameters = { ...MICROMORPH_DEFAULTS };
  state.anchors = { ...firstPreset.anchors };
  state.preset = firstPreset.id;
  state.engineMessage = "";
  updateInterface();
  scheduleModelCondition();
  saveLocalState();
  announce("Micromorph parameters reset.");
}

function bindControls() {
  for (const id of [
    "derivation",
    "material",
    "structureLock",
    "memory",
    "mutation",
    "continuation",
    "inputGain",
    "outputLevel",
  ]) bindRange(id);
  for (const [id, key] of [["anchorA", "a"], ["anchorB", "b"]]) {
    $(id).addEventListener("input", () => {
      markCustom();
      state.anchors[key] = $(id).value.slice(0, 512);
      scheduleModelCondition();
      saveLocalState();
      updateInterface({ drawNow: false, sendControls: false });
    });
  }
  $("audioButton").addEventListener("click", toggleAudio);
  $("connectModel").addEventListener("click", toggleModel);
  $("engineUrl").addEventListener("change", saveLocalState);
  document.querySelector("[data-reset-all]")?.addEventListener("click", resetAll);
}

function initialize() {
  restoreLocalState();
  renderPresets();
  bindControls();
  bindStage();
  audio.setTelemetryHandler((telemetry) => {
    const modelPlaybackChanged = Boolean(state.telemetry.modelPcmActive)
      !== Boolean(telemetry.modelPcmActive)
      || Boolean(state.telemetry.modelFallbackActive)
        !== Boolean(telemetry.modelFallbackActive);
    state.telemetry = telemetry;
    $("inputMeter").style.width = `${Math.min(100, Math.sqrt(telemetry.inputRms) * 115)}%`;
    $("outputMeter").style.width = `${Math.min(100, Math.sqrt(telemetry.outputRms) * 115)}%`;
    $("underruns").textContent = String(telemetry.modelUnderflows);
    const sampleRate = audio.state.sampleRate ?? 48_000;
    $("modelLead").textContent = modelIsReady()
      ? `${Math.round(telemetry.modelBufferedFrames / sampleRate * 1_000)} ms`
      : "—";
    if (modelPlaybackChanged) updateEngineInterface();
  });
  const observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(resizeCanvas)
    : null;
  const handleVisibility = () => {
    if (document.hidden) {
      stopMicrophone("Microphone stopped because this tab was hidden.").catch(showAudioError);
    }
  };
  const handleKeydown = (event) => {
    if (event.key !== "Escape" || !state.audioOn) return;
    event.preventDefault();
    stopMicrophone("Microphone stopped with Escape.").catch(showAudioError);
  };
  observer?.observe($("stageWrap"));
  globalThis.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", handleVisibility);
  document.addEventListener("keydown", handleKeydown);
  globalThis.addEventListener("pagehide", () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    if (controlSendFrame) cancelAnimationFrame(controlSendFrame);
    if (conditionSendTimer) clearTimeout(conditionSendTimer);
    observer?.disconnect();
    document.removeEventListener("visibilitychange", handleVisibility);
    document.removeEventListener("keydown", handleKeydown);
    releaseModelClient();
    audio.close().catch(() => {});
  }, { once: true });
  updateInterface({ sendControls: false });
  resizeCanvas();
}

initialize();
