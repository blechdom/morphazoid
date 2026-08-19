import {
  ALGORITHMIC_INSTRUMENTS,
  ALGORITHMIC_SCORE_PRESETS,
  algorithmicInstrumentById,
  clamp,
  deriveAlgorithmicEventVoices,
  describeAlgorithmicEvent,
  generateAlgorithmicScore,
  sanitizeAlgorithmicScoreParams,
} from "./src/algorithmic-scores.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";

const $ = (id) => document.getElementById(id);
const FRAME_INTERVAL = 1_000 / 30;
const requestedInstrumentId = document.body?.dataset.algorithm;
const fixedInstrument = ALGORITHMIC_INSTRUMENTS.some(({ id }) => id === requestedInstrumentId)
  ? algorithmicInstrumentById(requestedInstrumentId)
  : null;
const instrument = fixedInstrument ?? algorithmicInstrumentById("dijkstra");
const BASE_DEFAULTS = sanitizeAlgorithmicScoreParams({
  ...instrument.defaults,
  seed: 0x51c0ffee,
});

const hashAlgorithm = globalThis.location?.hash?.slice(1);
const DEFAULTS = {
  ...BASE_DEFAULTS,
  algorithmId: fixedInstrument?.id
    ?? (ALGORITHMIC_SCORE_PRESETS.some(({ id }) => id === hashAlgorithm)
    ? hashAlgorithm
    : BASE_DEFAULTS.algorithmId),
};

const canvas = $("stage");
const context2d = canvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
});
const stageWrap = $("stageWrap");
const audioButton = $("audioButton");
const audioState = $("audioState");
const audioError = $("audioError");
const liveStatus = $("liveStatus");
const stageReadout = $("stageReadout");
const headingAlgorithm = $("headingAlgorithm");

const controls = {
  output: $("output"),
  outputOut: $("outputOut"),
  scoreProgress: $("scoreProgress"),
  scoreProgressOut: $("scoreProgressOut"),
  loop: $("loopScore"),
  complexity: $("complexity"),
  complexityOut: $("complexityOut"),
  tempo: $("tempo"),
  tempoOut: $("tempoOut"),
  swing: $("swing"),
  swingOut: $("swingOut"),
  intensity: $("intensity"),
  intensityOut: $("intensityOut"),
  brightness: $("brightness"),
  brightnessOut: $("brightnessOut"),
  roughness: $("roughness"),
  roughnessOut: $("roughnessOut"),
  space: $("space"),
  spaceOut: $("spaceOut"),
  baseFrequency: $("baseFrequency"),
  baseFrequencyOut: $("baseFrequencyOut"),
  pitchSpan: $("pitchSpan"),
  pitchSpanOut: $("pitchSpanOut"),
};

const readouts = {
  algorithmSummary: $("algorithmSummary"),
  transportSummary: $("transportSummary"),
  structureSummary: $("structureSummary"),
  grooveSummary: $("grooveSummary"),
  timbreSummary: $("timbreSummary"),
  presetDescription: $("presetDescription"),
  family: $("familyReadout"),
  score: $("scoreReadout"),
  event: $("eventReadout"),
  step: $("stepReadout"),
  rhythm: $("rhythmReadout"),
  timbre: $("timbreReadout"),
  loopState: $("loopState"),
};

const buttons = {
  mutate: $("mutateScore"),
  play: $("playButton"),
  step: $("stepButton"),
  restart: $("restartScore"),
  reset: $("resetScores"),
};

const state = {
  settings: { ...DEFAULTS },
  score: generateAlgorithmicScore(DEFAULTS),
  cursor: -1,
  playing: false,
  nextEventAt: 0,
  rhythmParity: 0,
  audioOn: false,
  audioStarting: false,
  audioContext: null,
  masterGain: null,
  compressor: null,
  dryBus: null,
  delayInput: null,
  delayNode: null,
  delayFilter: null,
  delayWet: null,
  delayFeedback: null,
  outputRelease: null,
  noiseBuffer: null,
  cssWidth: 1,
  cssHeight: 1,
  pixelRatio: 1,
  lastDrawTime: -Infinity,
  dragging: false,
  lastScrubTone: -Infinity,
  disposed: false,
};

let frameId = null;

function compactNumber(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function percent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function activeEvent() {
  if (state.cursor < 0) return null;
  return state.score.events[state.cursor] ?? null;
}

function setText(element, value) {
  if (element) element.textContent = String(value);
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function setError(message = "") {
  setText(audioError, message);
  audioError.hidden = !message;
}

function createRandomSeed() {
  const values = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(values);
  return values[0] || Math.floor(Math.random() * 0xffff_ffff) || 1;
}

function updateAccent() {
  document.body.style.setProperty("--score-accent", state.score.preset.accent);
}

function updateAudioGraph() {
  if (!state.audioContext) return;
  const now = state.audioContext.currentTime;
  const patch = instrument.audio;
  state.masterGain?.gain.setTargetAtTime(
    state.audioOn ? state.settings.output : 0,
    now,
    0.018,
  );
  state.delayNode?.delayTime.setTargetAtTime(
    patch.delayBase + state.settings.space * patch.delayRange,
    now,
    0.025,
  );
  state.delayFeedback?.gain.setTargetAtTime(
    Math.min(0.72, state.settings.space * patch.feedbackScale),
    now,
    0.025,
  );
  state.delayWet?.gain.setTargetAtTime(
    state.settings.space * patch.wetScale,
    now,
    0.025,
  );
  state.delayFilter?.frequency.setTargetAtTime(
    patch.filterBase + state.settings.brightness * patch.filterRange,
    now,
    0.025,
  );
}

function updateAudioStatus() {
  setPressed(audioButton, state.audioOn);
  audioButton.disabled = state.audioStarting;
  setText(audioState, state.audioOn ? "on" : "off");
  updateAudioGraph();
}

function updateControls() {
  const settings = state.settings;
  controls.output.value = String(settings.output);
  controls.outputOut.value = percent(settings.output);
  controls.scoreProgress.max = String(Math.max(0, state.score.events.length - 1));
  controls.scoreProgress.value = String(Math.max(0, state.cursor));
  controls.scoreProgressOut.value = state.cursor < 0
    ? "ready"
    : `${state.cursor + 1}/${state.score.events.length}`;
  controls.loop.checked = settings.loop;
  controls.complexity.value = String(settings.complexity);
  controls.complexityOut.value = `${settings.complexity} / 8`;
  controls.tempo.value = String(settings.tempoBpm);
  controls.tempoOut.value = `${Math.round(settings.tempoBpm)} BPM`;
  controls.swing.value = String(settings.swing);
  controls.swingOut.value = percent(settings.swing);
  controls.intensity.value = String(settings.intensity);
  controls.intensityOut.value = percent(settings.intensity);
  controls.brightness.value = String(settings.brightness);
  controls.brightnessOut.value = percent(settings.brightness);
  controls.roughness.value = String(settings.roughness);
  controls.roughnessOut.value = percent(settings.roughness);
  controls.space.value = String(settings.space);
  controls.spaceOut.value = percent(settings.space);
  controls.baseFrequency.value = String(settings.baseFrequencyHz);
  controls.baseFrequencyOut.value = `${Math.round(settings.baseFrequencyHz)} Hz`;
  controls.pitchSpan.value = String(settings.pitchSpanOctaves);
  controls.pitchSpanOut.value = `${compactNumber(settings.pitchSpanOctaves)} oct`;
}

function updateReadouts() {
  const event = activeEvent();
  const preset = state.score.preset;
  const complete = state.cursor === state.score.events.length - 1;
  const progress = state.cursor < 0
    ? "READY"
    : complete
      ? "END"
      : `STEP ${state.cursor + 1}/${state.score.events.length}`;
  const intensityLabel = state.settings.intensity >= 0.72
    ? "intense"
    : state.settings.intensity >= 0.4
      ? "driven"
      : "spare";

  setText(headingAlgorithm, preset.label);
  setText(readouts.algorithmSummary, `${preset.shortLabel} - ${state.score.events.length} events`);
  setText(readouts.transportSummary, state.playing ? "running" : complete ? "end" : "paused");
  setText(readouts.structureSummary, state.score.complexityLabel);
  setText(readouts.grooveSummary, `${Math.round(state.settings.tempoBpm)} BPM - ${intensityLabel}`);
  setText(readouts.timbreSummary, `${percent(state.settings.brightness)} bright - ${percent(state.settings.roughness)} rough`);
  setText(readouts.presetDescription, preset.description);
  setText(readouts.family, preset.family);
  setText(readouts.score, state.score.summary);
  setText(readouts.event, describeAlgorithmicEvent(event));
  setText(readouts.step, state.cursor < 0 ? "ready" : `${state.cursor + 1} of ${state.score.events.length}`);
  setText(readouts.rhythm, `${Math.round(state.settings.tempoBpm)} BPM / ${percent(state.settings.swing)} swing`);
  setText(readouts.timbre, preset.signature);
  setText(readouts.loopState, state.settings.loop ? "on" : "off");
  setText(stageReadout, `${preset.shortLabel.toUpperCase()} - ${progress} - AUDIO ${state.audioOn ? "ON" : "OFF"}`);
  setText(liveStatus, `${preset.label}: ${describeAlgorithmicEvent(event)}`);
  setPressed(buttons.play, state.playing);
  document.querySelectorAll("button[data-algorithm]").forEach((button) => {
    setPressed(button, button.dataset.algorithm === state.settings.algorithmId);
  });
  canvas.setAttribute(
    "aria-label",
    `Interactive ${preset.label} score. ${describeAlgorithmicEvent(event)}. Audio ${state.audioOn ? "on" : "off"}.`,
  );
  updateControls();
  updateAudioStatus();
}

function stopPlayback({ update = true } = {}) {
  state.playing = false;
  state.nextEventAt = 0;
  state.rhythmParity = 0;
  if (update) updateReadouts();
}

function regenerateScore({ keepCursor = false } = {}) {
  state.settings = { ...sanitizeAlgorithmicScoreParams(state.settings) };
  state.score = generateAlgorithmicScore(state.settings);
  if (keepCursor) {
    state.cursor = Math.min(state.cursor, state.score.events.length - 1);
  } else {
    state.cursor = -1;
  }
  updateAccent();
  updateReadouts();
}

function setSettings(patch, { regenerate = false, keepCursor = false } = {}) {
  state.settings = {
    ...sanitizeAlgorithmicScoreParams({
      ...state.settings,
      ...patch,
    }),
  };
  if (regenerate) regenerateScore({ keepCursor });
  else updateReadouts();
}

function eventIntervalMs(event) {
  const base = (event?.beat ?? 0.25) * (60_000 / state.settings.tempoBpm);
  const swingDirection = state.rhythmParity % 2 === 0 ? -1 : 1;
  state.rhythmParity += 1;
  return Math.max(18, base * (1 + swingDirection * state.settings.swing));
}

function advanceTo(index, { audible = false } = {}) {
  const lastIndex = state.score.events.length - 1;
  state.cursor = Math.max(0, Math.min(lastIndex, Math.round(index)));
  const event = activeEvent();
  if (audible && event) playAlgorithmEvent(event);
  updateReadouts();
}

function stepOnce() {
  stopPlayback({ update: false });
  const nextIndex = state.cursor >= state.score.events.length - 1
    ? 0
    : state.cursor + 1;
  advanceTo(nextIndex, { audible: true });
}

function restartScore() {
  stopPlayback({ update: false });
  state.cursor = -1;
  updateReadouts();
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback();
    return;
  }
  if (state.cursor >= state.score.events.length - 1) state.cursor = -1;
  state.playing = true;
  state.nextEventAt = 0;
  state.rhythmParity = 0;
  updateReadouts();
}

function mutateScore() {
  stopPlayback({ update: false });
  setSettings({ seed: createRandomSeed() }, { regenerate: true });
}

function createNoiseBuffer(audioContext) {
  const length = Math.max(1, Math.floor(audioContext.sampleRate * 0.75));
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  let previous = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    previous = previous * 0.82 + white * 0.18;
    data[index] = previous;
  }
  return buffer;
}

async function ensureAudioContext() {
  if (state.audioContext) return state.audioContext;
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
  const audioContext = new AudioContextClass();
  const masterGain = audioContext.createGain();
  const compressor = audioContext.createDynamicsCompressor();
  const dryBus = audioContext.createGain();
  const delayInput = audioContext.createGain();
  const delayNode = audioContext.createDelay(1.5);
  const delayFilter = audioContext.createBiquadFilter();
  const delayWet = audioContext.createGain();
  const delayFeedback = audioContext.createGain();

  masterGain.gain.value = 0;
  dryBus.gain.value = instrument.audio.dry;
  compressor.threshold.value = instrument.audio.compressorThreshold;
  compressor.knee.value = 14;
  compressor.ratio.value = instrument.audio.compressorRatio;
  compressor.attack.value = 0.003;
  compressor.release.value = instrument.audio.compressorRelease;
  delayFilter.type = "lowpass";

  dryBus.connect(compressor);
  delayInput.connect(delayNode);
  delayNode.connect(delayFilter);
  delayFilter.connect(delayWet).connect(compressor);
  delayFilter.connect(delayFeedback).connect(delayNode);
  compressor.connect(masterGain);
  state.outputRelease = connectAudioOutput(audioContext, masterGain);

  state.audioContext = audioContext;
  state.masterGain = masterGain;
  state.compressor = compressor;
  state.dryBus = dryBus;
  state.delayInput = delayInput;
  state.delayNode = delayNode;
  state.delayFilter = delayFilter;
  state.delayWet = delayWet;
  state.delayFeedback = delayFeedback;
  state.noiseBuffer = createNoiseBuffer(audioContext);
  updateAudioGraph();
  return audioContext;
}

async function toggleAudio() {
  if (state.audioOn) {
    state.audioOn = false;
    updateReadouts();
    return;
  }
  state.audioStarting = true;
  setError();
  updateReadouts();
  try {
    const audioContext = await ensureAudioContext();
    await audioContext.resume?.();
    state.audioOn = true;
  } catch (error) {
    state.audioOn = false;
    setError(error instanceof Error ? error.message : "Audio could not start.");
  } finally {
    state.audioStarting = false;
    updateReadouts();
  }
}

function connectVoiceOutput(node, voice) {
  const audioContext = state.audioContext;
  let outputNode = node;
  if (audioContext.createStereoPanner) {
    const panner = audioContext.createStereoPanner();
    panner.pan.value = voice.pan;
    node.connect(panner);
    outputNode = panner;
  }
  outputNode.connect(state.dryBus);
  if (voice.delaySend > 0.001) {
    const send = audioContext.createGain();
    send.gain.value = voice.delaySend;
    outputNode.connect(send).connect(state.delayInput);
  }
}

function playOscillatorVoice(voice, startTime) {
  const audioContext = state.audioContext;
  const carrier = audioContext.createOscillator();
  const modulator = audioContext.createOscillator();
  const modulationGain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const envelope = audioContext.createGain();
  const endTime = startTime + voice.durationSeconds;
  const attackEnd = Math.min(endTime - 0.003, startTime + voice.attackSeconds);

  carrier.type = voice.wave;
  carrier.frequency.setValueAtTime(voice.frequencyHz, startTime);
  carrier.detune.setValueAtTime(voice.detuneCents, startTime);
  modulator.type = "sine";
  modulator.frequency.setValueAtTime(
    Math.max(0.1, voice.frequencyHz * voice.modulationRatio),
    startTime,
  );
  modulationGain.gain.setValueAtTime(
    Math.min(3_000, voice.frequencyHz * voice.modulationIndex),
    startTime,
  );
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(voice.filterHz, startTime);
  filter.Q.value = 0.6 + state.settings.roughness * 3.5;
  envelope.gain.setValueAtTime(0.0001, startTime);
  envelope.gain.exponentialRampToValueAtTime(voice.gain, Math.max(startTime + 0.001, attackEnd));
  envelope.gain.exponentialRampToValueAtTime(0.0001, endTime);

  modulator.connect(modulationGain).connect(carrier.frequency);
  carrier.connect(filter).connect(envelope);
  connectVoiceOutput(envelope, voice);
  modulator.start(startTime);
  carrier.start(startTime);
  modulator.stop(endTime + 0.03);
  carrier.stop(endTime + 0.03);
}

function playNoiseVoice(voice, startTime) {
  const audioContext = state.audioContext;
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const envelope = audioContext.createGain();
  const endTime = startTime + voice.durationSeconds;
  const attackEnd = Math.min(endTime - 0.002, startTime + voice.attackSeconds);
  source.buffer = state.noiseBuffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(voice.filterHz, startTime);
  filter.Q.value = 1.2 + state.settings.roughness * 7;
  envelope.gain.setValueAtTime(0.0001, startTime);
  envelope.gain.exponentialRampToValueAtTime(voice.gain, Math.max(startTime + 0.001, attackEnd));
  envelope.gain.exponentialRampToValueAtTime(0.0001, endTime);
  source.connect(filter).connect(envelope);
  connectVoiceOutput(envelope, voice);
  source.start(startTime);
  source.stop(endTime + 0.02);
}

function playAlgorithmEvent(event) {
  if (!state.audioOn || !state.audioContext) return;
  const startTime = state.audioContext.currentTime + 0.006;
  const voices = deriveAlgorithmicEventVoices(event, state.settings);
  voices.forEach((voice) => {
    if (voice.type === "noise") playNoiseVoice(voice, startTime);
    else playOscillatorVoice(voice, startTime);
  });
}

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width || 1));
  const height = Math.max(1, Math.floor(rect.height || 1));
  const pixelRatio = Math.min(
    2,
    Math.max(1, globalThis.devicePixelRatio || globalThis.window?.devicePixelRatio || 1),
  );
  if (
    canvas.width !== Math.floor(width * pixelRatio)
    || canvas.height !== Math.floor(height * pixelRatio)
  ) {
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
  }
  state.cssWidth = width;
  state.cssHeight = height;
  state.pixelRatio = pixelRatio;
  context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function colorWithAlpha(color, alpha) {
  const hex = color.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawText(text, x, y, color, size = 9, align = "left") {
  context2d.fillStyle = color;
  context2d.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context2d.textAlign = align;
  context2d.textBaseline = "middle";
  context2d.fillText(text, x, y);
}

function stagePlot() {
  const compact = state.cssWidth <= 620;
  const left = compact ? 25 : Math.max(44, state.cssWidth * 0.055);
  const right = state.cssWidth - left;
  const top = compact ? 105 : Math.max(118, state.cssHeight * 0.16);
  const bottom = state.cssHeight - (compact ? 62 : 72);
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function drawDijkstra(plot, event, now) {
  const { width, height, weights, start, goal } = state.score.scene;
  const settled = new Set(event?.settled ?? []);
  const frontier = new Set(event?.frontier ?? []);
  const path = new Set(event?.path ?? []);
  const accent = state.score.preset.accent;
  const gold = "#e8c46b";
  const coral = "#ff826f";
  const green = "#75ef9d";
  const pulse = 0.7 + Math.sin(now * 0.012) * 0.2;
  const xFor = (node) => plot.left + ((node % width) / Math.max(1, width - 1)) * plot.width;
  const yFor = (node) => plot.top + (Math.floor(node / width) / Math.max(1, height - 1)) * plot.height;

  context2d.lineWidth = 1;
  for (let node = 0; node < weights.length; node += 1) {
    const x = xFor(node);
    const y = yFor(node);
    context2d.strokeStyle = "rgba(219, 228, 224, 0.08)";
    if (node % width < width - 1) {
      context2d.beginPath();
      context2d.moveTo(x, y);
      context2d.lineTo(xFor(node + 1), yFor(node + 1));
      context2d.stroke();
    }
    if (Math.floor(node / width) < height - 1) {
      context2d.beginPath();
      context2d.moveTo(x, y);
      context2d.lineTo(xFor(node + width), yFor(node + width));
      context2d.stroke();
    }
  }

  if (event?.path?.length > 1) {
    context2d.strokeStyle = gold;
    context2d.lineWidth = 2.5;
    context2d.beginPath();
    event.path.forEach((node, index) => {
      const x = xFor(node);
      const y = yFor(node);
      if (index === 0) context2d.moveTo(x, y);
      else context2d.lineTo(x, y);
    });
    context2d.stroke();
  }

  for (let node = 0; node < weights.length; node += 1) {
    const x = xFor(node);
    const y = yFor(node);
    const radius = 2 + weights[node] * 0.3;
    const current = event?.node === node;
    context2d.fillStyle = node === start
      ? green
      : node === goal
        ? coral
        : path.has(node)
          ? gold
          : current
            ? accent
            : frontier.has(node)
              ? colorWithAlpha(accent, 0.62)
              : settled.has(node)
                ? "rgba(199, 155, 255, 0.46)"
                : "rgba(219, 228, 224, 0.2)";
    context2d.beginPath();
    context2d.arc(x, y, current ? radius * (1.5 + pulse * 0.25) : radius, 0, Math.PI * 2);
    context2d.fill();
  }
  drawText("S", xFor(start), yFor(start) + 14, green, 9, "center");
  drawText("G", xFor(goal), yFor(goal) - 14, coral, 9, "center");
}

function drawHanoi(plot, event, now) {
  const { disks, initialStacks } = state.score.scene;
  const stacks = event?.stacks ?? initialStacks;
  const pegXs = [0.18, 0.5, 0.82].map((ratio) => plot.left + plot.width * ratio);
  const baseY = plot.bottom - 4;
  const pegTop = plot.top + plot.height * 0.16;
  const diskHeight = Math.max(7, Math.min(17, (plot.height * 0.68) / disks));
  const palette = ["#69e7ff", "#e8c46b", "#ff826f", "#75ef9d", "#c79bff"];
  const pulse = 0.65 + Math.sin(now * 0.014) * 0.22;

  context2d.strokeStyle = "rgba(219, 228, 224, 0.28)";
  context2d.lineWidth = 2;
  context2d.beginPath();
  context2d.moveTo(plot.left, baseY);
  context2d.lineTo(plot.right, baseY);
  context2d.stroke();
  pegXs.forEach((x, index) => {
    context2d.strokeStyle = event?.to === index
      ? colorWithAlpha(state.score.preset.accent, pulse)
      : "rgba(219, 228, 224, 0.2)";
    context2d.beginPath();
    context2d.moveTo(x, baseY);
    context2d.lineTo(x, pegTop);
    context2d.stroke();
    drawText(String(index + 1), x, baseY + 18, "rgba(219, 228, 224, 0.42)", 9, "center");
  });

  stacks.forEach((stack, peg) => {
    stack.forEach((disk, level) => {
      const diskWidth = 28 + (disk / disks) * Math.min(plot.width * 0.24, 190);
      const x = pegXs[peg] - diskWidth / 2;
      const y = baseY - (level + 1) * (diskHeight + 2);
      context2d.fillStyle = colorWithAlpha(palette[(disk - 1) % palette.length], 0.72);
      context2d.fillRect(x, y, diskWidth, diskHeight);
      if (diskHeight >= 11) drawText(String(disk), pegXs[peg], y + diskHeight / 2, "#07090b", 8, "center");
    });
  });

  if (event?.kind === "move") {
    const fromX = pegXs[event.from];
    const toX = pegXs[event.to];
    context2d.strokeStyle = colorWithAlpha(state.score.preset.accent, pulse);
    context2d.lineWidth = 1.5;
    context2d.beginPath();
    context2d.moveTo(fromX, pegTop + 18);
    context2d.quadraticCurveTo((fromX + toX) / 2, plot.top, toX, pegTop + 18);
    context2d.stroke();
  }
}

function minimaxPosition(node, depth, plot) {
  const nodeDepth = Math.floor(Math.log2(node + 1));
  const first = (2 ** nodeDepth) - 1;
  const position = node - first;
  return {
    x: plot.left + ((position + 0.5) / (2 ** nodeDepth)) * plot.width,
    y: plot.top + (nodeDepth / depth) * plot.height,
  };
}

function drawMinimax(plot, event, now) {
  const { depth, nodeCount, leafValues } = state.score.scene;
  const states = event?.states ?? Array(nodeCount).fill(0);
  const values = event?.resolvedValues ?? Array(nodeCount).fill(null);
  const pulse = 0.7 + Math.sin(now * 0.013) * 0.2;
  const accent = state.score.preset.accent;
  for (let node = 1; node < nodeCount; node += 1) {
    const parent = Math.floor((node - 1) / 2);
    const from = minimaxPosition(parent, depth, plot);
    const to = minimaxPosition(node, depth, plot);
    context2d.strokeStyle = states[node] === 3
      ? "rgba(255, 130, 111, 0.14)"
      : "rgba(219, 228, 224, 0.11)";
    context2d.lineWidth = states[node] === 3 ? 1.5 : 1;
    context2d.beginPath();
    context2d.moveTo(from.x, from.y);
    context2d.lineTo(to.x, to.y);
    context2d.stroke();
  }

  for (let node = 0; node < nodeCount; node += 1) {
    const position = minimaxPosition(node, depth, plot);
    const current = event?.node === node;
    const nodeDepth = Math.floor(Math.log2(node + 1));
    const value = values[node] ?? leafValues[node];
    context2d.fillStyle = states[node] === 3
      ? "rgba(255, 130, 111, 0.2)"
      : current
        ? colorWithAlpha(accent, pulse)
        : states[node] === 2
          ? "rgba(232, 196, 107, 0.6)"
          : states[node] === 1
            ? "rgba(199, 155, 255, 0.45)"
            : "rgba(219, 228, 224, 0.18)";
    context2d.beginPath();
    context2d.arc(position.x, position.y, current ? 6.5 : nodeDepth === depth ? 3.2 : 4.2, 0, Math.PI * 2);
    context2d.fill();
    if (states[node] === 3) {
      context2d.strokeStyle = "rgba(255, 130, 111, 0.65)";
      context2d.beginPath();
      context2d.moveTo(position.x - 4, position.y - 4);
      context2d.lineTo(position.x + 4, position.y + 4);
      context2d.moveTo(position.x + 4, position.y - 4);
      context2d.lineTo(position.x - 4, position.y + 4);
      context2d.stroke();
    }
    if (value !== null && (state.cssWidth > 700 || nodeDepth < 2)) {
      drawText(Number(value).toFixed(2), position.x, position.y - 11, "rgba(219, 228, 224, 0.48)", 7, "center");
    }
  }
}

function drawNQueens(plot, event, now) {
  const size = state.score.scene.size;
  const queens = event?.queens ?? Array(size).fill(-1);
  const side = Math.max(1, Math.min(plot.width, plot.height));
  const cell = side / size;
  const left = plot.left + (plot.width - side) / 2;
  const top = plot.top + (plot.height - side) / 2;
  const accent = state.score.preset.accent;
  const pulse = 0.68 + Math.sin(now * 0.014) * 0.2;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const attempted = event?.row === row && event?.column === column;
      context2d.fillStyle = attempted
        ? event.kind === "conflict"
          ? "rgba(255, 130, 111, 0.28)"
          : colorWithAlpha(accent, 0.2)
        : (row + column) % 2 === 0
          ? "rgba(219, 228, 224, 0.055)"
          : "rgba(199, 155, 255, 0.035)";
      context2d.fillRect(left + column * cell, top + row * cell, cell, cell);
      context2d.strokeStyle = "rgba(219, 228, 224, 0.1)";
      context2d.strokeRect(left + column * cell, top + row * cell, cell, cell);
    }
  }

  queens.forEach((column, row) => {
    if (column < 0) return;
    const x = left + (column + 0.5) * cell;
    const y = top + (row + 0.5) * cell;
    const current = event?.row === row && event?.column === column;
    context2d.fillStyle = current ? colorWithAlpha(accent, pulse) : "rgba(232, 196, 107, 0.78)";
    context2d.beginPath();
    context2d.arc(x, y, cell * 0.29, 0, Math.PI * 2);
    context2d.fill();
    drawText("Q", x, y, "#07090b", Math.max(8, Math.min(16, cell * 0.34)), "center");
  });

  if (event?.kind === "conflict" && event.conflictRow >= 0) {
    const fromX = left + (event.column + 0.5) * cell;
    const fromY = top + (event.row + 0.5) * cell;
    const toX = left + (event.conflictColumn + 0.5) * cell;
    const toY = top + (event.conflictRow + 0.5) * cell;
    context2d.strokeStyle = "rgba(255, 130, 111, 0.82)";
    context2d.lineWidth = 2;
    context2d.beginPath();
    context2d.moveTo(fromX, fromY);
    context2d.lineTo(toX, toY);
    context2d.stroke();
  }
}

function drawEuclid(plot, event, now) {
  const { initialA, history } = state.score.scene;
  const visibleHistory = event?.history ?? [];
  const rowCount = history.length;
  const rowGap = Math.max(5, Math.min(12, plot.height * 0.025));
  const rowHeight = Math.max(14, (plot.height - rowGap * (rowCount - 1)) / rowCount);
  const accent = state.score.preset.accent;
  const pulse = 0.68 + Math.sin(now * 0.015) * 0.22;

  history.forEach((record, index) => {
    const y = plot.top + index * (rowHeight + rowGap);
    const active = event?.division === index;
    const revealed = index < visibleHistory.length;
    const aWidth = plot.width * (record.a / initialA);
    const bWidth = plot.width * (record.b / initialA);
    const remainderWidth = plot.width * (record.remainder / initialA);
    context2d.fillStyle = revealed ? "rgba(219, 228, 224, 0.1)" : "rgba(219, 228, 224, 0.035)";
    context2d.fillRect(plot.left, y, aWidth, rowHeight);
    context2d.fillStyle = active ? colorWithAlpha(accent, pulse) : "rgba(199, 155, 255, 0.34)";
    context2d.fillRect(plot.left, y, bWidth, rowHeight * 0.62);
    context2d.fillStyle = active ? "rgba(232, 196, 107, 0.72)" : "rgba(232, 196, 107, 0.28)";
    context2d.fillRect(plot.left, y + rowHeight * 0.68, remainderWidth, rowHeight * 0.32);

    const pulseCount = Math.min(12, record.quotient);
    const pulseSize = Math.max(2, Math.min(7, (plot.width * 0.22) / pulseCount));
    for (let pulseIndex = 0; pulseIndex < pulseCount; pulseIndex += 1) {
      const lit = active && event?.kind === "quotient" && pulseIndex <= event.pulse;
      context2d.fillStyle = lit ? "#ff826f" : "rgba(255, 130, 111, 0.22)";
      context2d.fillRect(plot.right - (pulseCount - pulseIndex) * (pulseSize + 2), y, pulseSize, pulseSize);
    }
    if (state.cssWidth > 520) {
      drawText(
        `${record.a} = ${record.quotient} x ${record.b} + ${record.remainder}`,
        plot.left + 6,
        y + rowHeight / 2,
        revealed ? "rgba(219, 228, 224, 0.66)" : "rgba(219, 228, 224, 0.22)",
        8,
      );
    } else {
      drawText(
        `${record.quotient} / ${record.remainder}`,
        plot.right - 3,
        y + rowHeight / 2,
        "rgba(219, 228, 224, 0.55)",
        7,
        "right",
      );
    }
  });
}

function drawEventRail() {
  const left = Math.max(28, state.cssWidth * 0.055);
  const right = state.cssWidth - left;
  const y = state.cssHeight - 36;
  const events = state.score.events;
  const markerCount = Math.min(180, events.length);
  context2d.strokeStyle = "rgba(219, 228, 224, 0.14)";
  context2d.lineWidth = 1;
  context2d.beginPath();
  context2d.moveTo(left, y);
  context2d.lineTo(right, y);
  context2d.stroke();
  for (let marker = 0; marker < markerCount; marker += 1) {
    const eventIndex = Math.round((marker * (events.length - 1)) / Math.max(1, markerCount - 1));
    const event = events[eventIndex];
    const x = left + ((right - left) * marker) / Math.max(1, markerCount - 1);
    context2d.fillStyle = eventIndex <= state.cursor
      ? event.accent
        ? "#e8c46b"
        : event.kind === "prune" || event.kind === "conflict"
          ? "#ff826f"
          : state.score.preset.accent
      : "rgba(219, 228, 224, 0.18)";
    context2d.beginPath();
    context2d.arc(x, y, event.accent ? 3.5 : 2, 0, Math.PI * 2);
    context2d.fill();
  }
  if (state.cursor >= 0) {
    const x = left + ((right - left) * state.cursor) / Math.max(1, events.length - 1);
    context2d.strokeStyle = "#ffffff";
    context2d.beginPath();
    context2d.arc(x, y, 6, 0, Math.PI * 2);
    context2d.stroke();
  }
  drawText(describeAlgorithmicEvent(activeEvent()).toUpperCase(), left, state.cssHeight - 16, "rgba(219, 228, 224, 0.76)", 8);
  drawText(`${events.length} EVENTS`, right, state.cssHeight - 16, "rgba(219, 228, 224, 0.42)", 8, "right");
}

function drawStage(now) {
  resizeCanvas();
  context2d.clearRect(0, 0, state.cssWidth, state.cssHeight);
  context2d.save();
  const plot = stagePlot();
  const event = activeEvent();
  if (state.score.preset.id === "dijkstra") drawDijkstra(plot, event, now);
  else if (state.score.preset.id === "hanoi") drawHanoi(plot, event, now);
  else if (state.score.preset.id === "minimax") drawMinimax(plot, event, now);
  else if (state.score.preset.id === "nqueens") drawNQueens(plot, event, now);
  else drawEuclid(plot, event, now);
  drawEventRail();
  context2d.restore();
}

function animationFrame(now) {
  frameId = null;
  if (state.disposed) return;
  if (state.playing) {
    if (!state.nextEventAt) state.nextEventAt = now;
    let guard = 0;
    while (now >= state.nextEventAt && state.playing && guard < 6) {
      guard += 1;
      let nextIndex = state.cursor + 1;
      if (nextIndex >= state.score.events.length) {
        if (!state.settings.loop) {
          stopPlayback();
          break;
        }
        nextIndex = 0;
      }
      advanceTo(nextIndex, { audible: true });
      state.nextEventAt += eventIntervalMs(activeEvent());
    }
  }
  if (now - state.lastDrawTime >= FRAME_INTERVAL || state.playing || state.dragging) {
    drawStage(now);
    state.lastDrawTime = now;
  }
  frameId = requestAnimationFrame(animationFrame);
}

function scrubFromPointer(event, audible) {
  const rect = canvas.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1, 0);
  const index = Math.round(ratio * (state.score.events.length - 1));
  const now = performance.now();
  const shouldSound = audible && now - state.lastScrubTone >= 42;
  advanceTo(index, { audible: shouldSound });
  if (shouldSound) state.lastScrubTone = now;
}

function installEventHandlers() {
  audioButton.addEventListener("click", toggleAudio);
  buttons.mutate.addEventListener("click", mutateScore);
  buttons.play.addEventListener("click", togglePlayback);
  buttons.step.addEventListener("click", stepOnce);
  buttons.restart.addEventListener("click", restartScore);
  buttons.reset.addEventListener("click", () => {
    stopPlayback({ update: false });
    state.settings = { ...DEFAULTS };
    regenerateScore();
  });

  document.querySelectorAll("button[data-algorithm]").forEach((button) => {
    button.addEventListener("click", () => {
      const algorithmId = button.dataset.algorithm;
      stopPlayback({ update: false });
      setSettings({ algorithmId }, { regenerate: true });
      globalThis.history?.replaceState?.(null, "", `#${algorithmId}`);
    });
  });

  controls.scoreProgress.addEventListener("input", () => {
    stopPlayback({ update: false });
    advanceTo(Number(controls.scoreProgress.value), { audible: false });
  });
  controls.loop.addEventListener("change", () => {
    setSettings({ loop: controls.loop.checked });
  });
  controls.complexity.addEventListener("input", () => {
    stopPlayback({ update: false });
    setSettings({ complexity: Number(controls.complexity.value) }, { regenerate: true });
  });

  const soundBindings = [
    [controls.tempo, "tempoBpm"],
    [controls.swing, "swing"],
    [controls.intensity, "intensity"],
    [controls.brightness, "brightness"],
    [controls.roughness, "roughness"],
    [controls.space, "space"],
    [controls.baseFrequency, "baseFrequencyHz"],
    [controls.pitchSpan, "pitchSpanOctaves"],
    [controls.output, "output"],
  ];
  soundBindings.forEach(([control, key]) => {
    control.addEventListener("input", () => {
      setSettings({ [key]: Number(control.value) });
    });
  });

  canvas.addEventListener("pointerdown", (event) => {
    stopPlayback({ update: false });
    state.dragging = true;
    canvas.setPointerCapture?.(event.pointerId);
    scrubFromPointer(event, true);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    scrubFromPointer(event, true);
  });
  const endDrag = (event) => {
    state.dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const tagName = String(target?.tagName ?? "").toUpperCase();
    const role = String(target?.getAttribute?.("role") ?? "").toLowerCase();
    const keyboardOwned = ["A", "BUTTON", "INPUT", "SELECT", "SUMMARY", "TEXTAREA"].includes(tagName)
      || target?.isContentEditable
      || ["button", "checkbox", "combobox", "link", "slider", "spinbutton", "switch", "textbox"].includes(role);
    if (
      keyboardOwned
      || event.defaultPrevented
      || event.repeat
      || event.isComposing
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stepOnce();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stopPlayback({ update: false });
      advanceTo(Math.max(0, state.cursor - 1), { audible: true });
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      mutateScore();
    } else if (event.key === "Escape" && state.audioOn) {
      state.audioOn = false;
      updateReadouts();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPlayback();
  });
  globalThis.addEventListener?.("pagehide", () => {
    state.disposed = true;
    if (frameId !== null) cancelAnimationFrame(frameId);
    state.audioOn = false;
    state.outputRelease?.();
    state.outputRelease = null;
    state.audioContext?.close?.();
  });
}

function populateLabels() {
  buttons.mutate.textContent = instrument.mutationLabel;
  document.querySelectorAll("button[data-algorithm]").forEach((button) => {
    const preset = ALGORITHMIC_SCORE_PRESETS.find(({ id }) => id === button.dataset.algorithm);
    button.title = `${preset.label}: ${preset.signature}`;
  });
}

function start() {
  populateLabels();
  installEventHandlers();
  updateAccent();
  updateReadouts();
  resizeCanvas();
  drawStage(0);
  frameId = requestAnimationFrame(animationFrame);
}

start();
