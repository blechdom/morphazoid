import {
  CRICKET_DEMO_PRESETS,
  analyzeCricketSong,
  createDemoCricketSong,
  cricketGestureExport,
  renderCricketModel,
} from "./src/crickets.js";
import { encodeMonoWav } from "./src/birdsong-analysis.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum))
);

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DURATION_SECONDS = 12;
const CRICKET_RECORDING_SOURCES = Object.freeze({
  "recorded-house-cricket": Object.freeze({
    path: "./assets/bioacoustics/house-cricket.ogg",
    label: "House cricket recording · Acheta domesticus",
    recordist: "Morray (Wikimedia Commons)",
    license: "CC BY 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Acheta-domesticus-Stridulation.ogg",
    note: "Very short source. The tonal-stridulation profile may resolve only a small pulse sample.",
  }),
  "recorded-field-cricket": Object.freeze({
    path: "./assets/bioacoustics/field-cricket.ogg",
    label: "Field cricket recording · Gryllus pennsylvanicus",
    recordist: "Thatcher (Wikimedia Commons)",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Field_cricket_unedited.ogg",
    note: "The source notes slight room reverberation, which can blur or merge inferred closures.",
  }),
  "recorded-european-field-cricket": Object.freeze({
    path: "./assets/bioacoustics/european-field-cricket.ogg",
    label: "European field cricket recording · Gryllus campestris",
    recordist: "Baudewijn Odé",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Gryllus_campestris_-_sound.ogg",
    note: "A different species from the T. oceanicus reference; mechanism values remain effective hypotheses.",
  }),
});
const CONTROL_IDS = Object.freeze([
  "resonance-scale",
  "tooth-rate-ratio",
  "wing-q",
  "coupling",
  "wing-split",
  "plectrum-force",
  "tooth-irregularity",
  "closing-sweep",
  "mirror-mix",
]);

const canvas = $("cricket-stage");
const drawing = canvas.getContext("2d");
const inputAudio = new Audio();
const modelAudio = new Audio();
const manualAudio = new Audio();
for (const audio of [inputAudio, modelAudio, manualAudio]) audio.preload = "auto";

let sourceSamples = null;
let sourceSampleRate = 48_000;
let sourceName = "Synthetic six-chirp cricket gesture";
let analysis = null;
let modelRender = null;
let inputUrl = "";
let modelUrl = "";
let manualUrl = "";
let activeAudio = null;
let activeKind = "";
let renderTimer = 0;
let animationFrame = 0;
let taskVersion = 0;
let pointerGesture = null;
let audioEnabled = false;

function setStatus(message, state = "working") {
  $("status").textContent = message;
  $("status").dataset.state = state;
}

function sourceLink(label, href) {
  const link = document.createElement("a");
  link.textContent = label;
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

function setSourceDetails(source = null, kind = "synthetic") {
  const attribution = $("source-attribution");
  if (kind === "recording" && source) {
    attribution.replaceChildren(
      document.createTextNode(`${source.recordist} · `),
      sourceLink(source.license, source.licenseUrl),
      document.createTextNode(" · "),
      sourceLink("source page", source.sourceUrl),
    );
    $("source-profile-note").textContent = source.note;
    return;
  }
  if (kind === "upload") {
    attribution.textContent = "Local upload · attribution and provenance remain with the user.";
    $("source-profile-note").textContent = "The cricket profile assumes separated tonal stridulation; noise, echoes, and overlapping callers can distort the fit.";
    return;
  }
  attribution.textContent = "Procedural Morphazoid reference · not a field recording.";
  $("source-profile-note").textContent = `${source?.description ?? "Synthetic call pattern."} It does not portray or identify a species.`;
}

function setBusy(busy) {
  const playable = Boolean(analysis?.pulses?.length);
  $("render-model").disabled = busy || !playable;
  $("play-input").disabled = busy || !inputUrl;
  $("play-model").disabled = busy || !modelUrl;
  $("export-wav").disabled = busy || !modelRender;
  $("export-json").disabled = busy || !modelRender;
  $("file-input").disabled = busy;
  $("use-demo").disabled = busy;
  $("source-preset").disabled = busy;
  document.body.dataset.busy = String(busy);
}

function masterLevel() {
  return clamp(Number($("level")?.value ?? 0.62), 0, 0.85);
}

function setAudioEnabled(enabled, announce = true) {
  audioEnabled = Boolean(enabled);
  $("audioButton")?.setAttribute("aria-pressed", String(audioEnabled));
  if ($("audioState")) $("audioState").textContent = audioEnabled ? "on" : "off";
  for (const audio of [inputAudio, modelAudio, manualAudio]) {
    audio.volume = audioEnabled ? masterLevel() : 0;
  }
  if (!audioEnabled) stopPlayback(false);
  if (announce) {
    setStatus(audioEnabled ? "Audio ready." : "Audio off; the fitted mechanism is still visible.", "ready");
  }
}

function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

function normalizedCopy(samples, targetPeak = 0.78) {
  const output = Float32Array.from(samples);
  let peak = 0;
  for (const sample of output) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 1e-8 ? Math.min(32, targetPeak / peak) : 0;
  for (let index = 0; index < output.length; index += 1) output[index] *= gain;
  return output;
}

function wavUrl(samples, sampleRate, targetPeak = 0.78) {
  return URL.createObjectURL(new Blob(
    [encodeMonoWav(normalizedCopy(samples, targetPeak), sampleRate)],
    { type: "audio/wav" },
  ));
}

function chooseAnalysisChannel(buffer) {
  let selected = buffer.getChannelData(0);
  let selectedEnergy = -1;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    let energy = 0;
    const stride = Math.max(1, Math.floor(channel.length / 30_000));
    for (let index = 0; index < channel.length; index += stride) {
      energy += channel[index] ** 2;
    }
    if (energy > selectedEnergy) {
      selected = channel;
      selectedEnergy = energy;
    }
  }
  // Selecting the strongest channel avoids silently cancelling a recording
  // whose microphones captured the two wings with opposing phase.
  return Float32Array.from(selected);
}

function modelOptions(overrides = {}) {
  return {
    resonanceScale: Number($("resonance-scale").value),
    toothRateRatio: Number($("tooth-rate-ratio").value),
    wingQ: Number($("wing-q").value),
    coupling: Number($("coupling").value),
    wingSplitCents: Number($("wing-split").value),
    plectrumForce: Number($("plectrum-force").value),
    toothIrregularity: Number($("tooth-irregularity").value),
    closingSweep: Number($("closing-sweep").value),
    mirrorMix: Number($("mirror-mix").value),
    seed: 0x43524943,
    ...overrides,
  };
}

function updateControlOutputs() {
  const carrier = analysis?.carrierHz || 4_820;
  const scale = Number($("resonance-scale").value);
  $("resonance-scale-value").textContent = `${(carrier * scale / 1_000).toFixed(2)} kHz`;
  $("tooth-rate-ratio-value").textContent = `${Number($("tooth-rate-ratio").value).toFixed(3)}×`;
  $("wing-q-value").textContent = `${Number($("wing-q").value).toFixed(1)} Q`;
  $("coupling-value").textContent = `${Math.round(Number($("coupling").value) * 100)}%`;
  const split = Number($("wing-split").value);
  $("wing-split-value").textContent = `${split > 0 ? "+" : ""}${Math.round(split)} ct`;
  $("plectrum-force-value").textContent = `${Number($("plectrum-force").value).toFixed(2)}×`;
  $("tooth-irregularity-value").textContent = `${Math.round(Number($("tooth-irregularity").value) * 100)}%`;
  const sweep = Number($("closing-sweep").value) * 100;
  $("closing-sweep-value").textContent = `${sweep > 0 ? "+" : ""}${sweep.toFixed(1)}%`;
  $("mirror-mix-value").textContent = `${Math.round(Number($("mirror-mix").value) * 100)}%`;
  if ($("levelOut")) $("levelOut").textContent = `${Math.round(masterLevel() * 100)}%`;
}

function updateStats() {
  if (!analysis) return;
  $("carrier-stat").textContent = analysis.carrierHz
    ? `${(analysis.carrierHz / 1_000).toFixed(2)} kHz`
    : "unresolved";
  $("call-stat").textContent = `${analysis.chirps.length} / ${analysis.pulses.length}`;
  $("stroke-stat").textContent = analysis.wingStrokeRateHz
    ? `${analysis.wingStrokeRateHz.toFixed(1)} Hz`
    : "unresolved";
  $("q-stat").textContent = analysis.effectiveQ
    ? `${analysis.effectiveQ.toFixed(1)} Q*`
    : "unresolved";
  const note = $("analysis-note");
  if (note) note.textContent = analysis.warning;
  const ribbonStatus = document.querySelector(".cricket-call-ribbon > small");
  if (ribbonStatus) {
    ribbonStatus.textContent = `${analysis.chirps.length} chirps · ${analysis.pulses.length} strokes`;
  }
  const ribbon = document.querySelector(".call-ribbon-track");
  if (ribbon) {
    const subset = analysis.pulses.slice(0, 32);
    ribbon.replaceChildren(...subset.map((pulse) => {
      const mark = document.createElement("i");
      mark.style.height = `${Math.round(20 + pulse.strength * 72)}%`;
      mark.title = `${Math.round(pulse.durationSeconds * 1_000)} ms closing stroke`;
      return mark;
    }));
  }
  if ($("fit-state")) $("fit-state").textContent = "fit";
}

function stopPlayback(announce = true) {
  for (const audio of [inputAudio, modelAudio, manualAudio]) {
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // An unloaded media element has no seekable timeline.
    }
  }
  activeAudio = null;
  activeKind = "";
  $("play-input").setAttribute("aria-pressed", "false");
  $("play-model").setAttribute("aria-pressed", "false");
  $("stop-audio").disabled = true;
  if (announce) setStatus("Playback stopped.", "ready");
  drawStage();
}

function play(kind) {
  const next = kind === "input" ? inputAudio : modelAudio;
  if (!next.src) return;
  if (!audioEnabled) setAudioEnabled(true, false);
  const preservedTime = activeAudio && activeKind !== kind && !activeAudio.paused
    ? activeAudio.currentTime
    : 0;
  for (const audio of [inputAudio, modelAudio, manualAudio]) audio.pause();
  activeAudio = next;
  activeKind = kind;
  next.loop = $("loop-toggle").checked;
  next.volume = masterLevel();
  try {
    next.currentTime = Math.min(preservedTime, Math.max(0, analysis.durationSeconds - 0.01));
  } catch {
    // Seeking becomes available as soon as the generated WAV metadata loads.
  }
  next.play().catch((error) => {
    stopPlayback(false);
    setStatus(`Playback could not start: ${error.message}`, "error");
  });
  $("play-input").setAttribute("aria-pressed", String(kind === "input"));
  $("play-model").setAttribute("aria-pressed", String(kind === "model"));
  $("stop-audio").disabled = false;
  setStatus(
    kind === "input" ? "Playing the analyzed call." : "Playing only the reconstructed wing model.",
    "ready",
  );
  animateStage();
}

function setAudioSources() {
  stopPlayback(false);
  revokeUrl(inputUrl);
  revokeUrl(modelUrl);
  const sourceView = sourceSamples.subarray(0, analysis.sampleCount);
  inputUrl = wavUrl(sourceView, sourceSampleRate, 0.76);
  modelUrl = modelRender ? wavUrl(modelRender.samples, modelRender.sampleRate, 0.76) : "";
  inputAudio.src = inputUrl;
  modelAudio.src = modelUrl;
  inputAudio.loop = $("loop-toggle").checked;
  modelAudio.loop = $("loop-toggle").checked;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function analyzeAndRender() {
  const version = ++taskVersion;
  stopPlayback(false);
  setBusy(true);
  setStatus("Listening for the carrier, wing closures, and chirp gaps…");
  await nextPaint();
  try {
    const nextAnalysis = analyzeCricketSong(sourceSamples, sourceSampleRate, {
      maxDurationSeconds: MAX_DURATION_SECONDS,
    });
    if (version !== taskVersion) return;
    analysis = nextAnalysis;
    updateStats();
    updateControlOutputs();
    if (!analysis.pulses.length || !analysis.carrierHz) {
      modelRender = null;
      setAudioSources();
      setBusy(false);
      drawStage();
      setStatus("No separated cricket-like closures were found. Try a cleaner, closer recording.", "error");
      return;
    }
    setStatus("Striking the fitted two-wing body with a new, sample-free tooth train…");
    await nextPaint();
    modelRender = renderCricketModel(analysis, modelOptions());
    if (version !== taskVersion) return;
    setAudioSources();
    setBusy(false);
    drawStage();
    document.documentElement.dataset.cricketsReady = "true";
    const cropped = sourceSamples.length > analysis.sampleCount ? " First 12 seconds used." : "";
    setStatus(
      `Ready: ${analysis.chirps.length} chirps, ${analysis.pulses.length} closing strokes, ${(analysis.carrierHz / 1_000).toFixed(2)} kHz.${cropped}`,
      "ready",
    );
  } catch (error) {
    if (version !== taskVersion) return;
    setBusy(false);
    setStatus(error?.message || "The call could not be analyzed.", "error");
  }
}

async function rerenderModel() {
  if (!analysis?.pulses?.length) return;
  const version = ++taskVersion;
  stopPlayback(false);
  setBusy(true);
  setStatus("Rebuilding the wings from the changed physical controls…");
  await nextPaint();
  try {
    const nextRender = renderCricketModel(analysis, modelOptions());
    if (version !== taskVersion) return;
    modelRender = nextRender;
    setAudioSources();
    setBusy(false);
    drawStage();
    setStatus(
      `Wings rebuilt: ${(nextRender.model.lowModeFrequencyHz / 1_000).toFixed(2)} and ${(nextRender.model.highModeFrequencyHz / 1_000).toFixed(2)} kHz modes.`,
      "ready",
    );
  } catch (error) {
    if (version !== taskVersion) return;
    setBusy(false);
    setStatus(error?.message || "The wings could not be rendered.", "error");
  }
}

function scheduleRender(delay = 170) {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(rerenderModel, delay);
}

async function loadDemo() {
  const requestedPreset = $("source-preset").value;
  const presetId = CRICKET_DEMO_PRESETS.some((preset) => preset.id === requestedPreset)
    ? requestedPreset
    : CRICKET_DEMO_PRESETS[0].id;
  const demo = createDemoCricketSong(48_000, presetId);
  sourceSamples = demo.samples;
  sourceSampleRate = demo.sampleRate;
  sourceName = demo.label;
  $("source-preset").value = demo.presetId;
  setSourceDetails(demo, "synthetic");
  const label = $("source-name") ?? $("source-label");
  if (label) label.textContent = sourceName;
  $("file-input").value = "";
  await analyzeAndRender();
}

async function decodeAudioBytes(bytes) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser does not expose Web Audio decoding.");
  let context;
  try {
    try {
      context = new AudioContextClass({ sampleRate: 48_000 });
    } catch {
      context = new AudioContextClass();
    }
    const decoded = await context.decodeAudioData(bytes.slice(0));
    return {
      samples: chooseAnalysisChannel(decoded),
      sampleRate: decoded.sampleRate,
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

async function loadBundledRecording(sourceId) {
  const source = CRICKET_RECORDING_SOURCES[sourceId];
  if (!source) return loadDemo();
  stopPlayback(false);
  setBusy(true);
  setStatus(`Loading ${source.label} locally…`);
  await nextPaint();
  try {
    const response = await fetch(source.path);
    if (!response.ok) throw new Error(`local file returned ${response.status}`);
    const decoded = await decodeAudioBytes(await response.arrayBuffer());
    sourceSamples = decoded.samples;
    sourceSampleRate = decoded.sampleRate;
    sourceName = source.label;
    $("source-label").textContent = source.label;
    $("file-input").value = "";
    setSourceDetails(source, "recording");
    await analyzeAndRender();
  } catch (error) {
    setBusy(false);
    setStatus(`Could not load ${source.label}: ${error.message}`, "error");
  }
}

function loadSelectedSource() {
  const sourceId = $("source-preset").value;
  return CRICKET_RECORDING_SOURCES[sourceId]
    ? loadBundledRecording(sourceId)
    : loadDemo();
}

async function decodeFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus("That file is over 64 MB. Choose a shorter recording.", "error");
    return;
  }
  stopPlayback(false);
  setBusy(true);
  setStatus(`Decoding ${file.name} locally…`);
  await nextPaint();
  try {
    const bytes = await file.arrayBuffer();
    const decoded = await decodeAudioBytes(bytes);
    sourceSamples = decoded.samples;
    sourceSampleRate = decoded.sampleRate;
    sourceName = file.name;
    $("source-preset").value = "local";
    setSourceDetails(null, "upload");
    const label = $("source-name") ?? $("source-label");
    if (label) label.textContent = file.name;
    await analyzeAndRender();
  } catch (error) {
    setBusy(false);
    setStatus(`Could not decode ${file.name}: ${error.message}`, "error");
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeStem(filename) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "crickets";
}

function exportWav() {
  if (!modelRender) return;
  downloadBlob(
    new Blob([encodeMonoWav(normalizedCopy(modelRender.samples), modelRender.sampleRate)], {
      type: "audio/wav",
    }),
    `${safeStem(sourceName)}-crickets-physical.wav`,
  );
  setStatus("Sample-free physical-model WAV exported.", "ready");
}

function exportJson() {
  if (!analysis || !modelRender) return;
  const artifact = cricketGestureExport(analysis, modelRender, sourceName);
  downloadBlob(
    new Blob([`${JSON.stringify(artifact, null, 2)}\n`], { type: "application/json" }),
    `${safeStem(sourceName)}-crickets-gesture.json`,
  );
  setStatus("Effective closure score and model controls exported as JSON.", "ready");
}

function stageSize() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(320, Math.round(bounds.width * ratio));
  const height = Math.max(360, Math.round(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

function playheadSeconds() {
  if (!activeAudio || activeAudio.paused || !Number.isFinite(activeAudio.currentTime)) return 0;
  return activeAudio.currentTime;
}

function frameAtTime(timeSeconds) {
  if (!analysis?.frames?.length) return { envelope: 0, active: false };
  const index = clamp(
    Math.round(timeSeconds * analysis.sampleRate / analysis.hopSize),
    0,
    analysis.frames.length - 1,
  );
  return analysis.frames[index];
}

function pulseAtTime(timeSeconds) {
  if (!analysis) return null;
  return analysis.pulses.find((pulse) => (
    timeSeconds >= pulse.startSeconds && timeSeconds <= pulse.endSeconds
  )) ?? null;
}

function drawWing(anchorX, anchorY, tipX, tipY, side, energy, phase, colors) {
  const vibration = Math.sin(phase) * energy * 7;
  const upper = anchorY - 112 - vibration * side;
  const lower = anchorY + 88 + vibration * 0.5 * side;
  const gradient = drawing.createLinearGradient(anchorX, anchorY, tipX, tipY);
  gradient.addColorStop(0, colors.fillStrong);
  gradient.addColorStop(1, colors.fillSoft);
  drawing.beginPath();
  drawing.moveTo(anchorX, anchorY - 48);
  drawing.bezierCurveTo(
    anchorX + side * 70,
    upper,
    tipX - side * 28,
    tipY - 42,
    tipX,
    tipY,
  );
  drawing.bezierCurveTo(
    tipX - side * 20,
    tipY + 54,
    anchorX + side * 64,
    lower,
    anchorX,
    anchorY + 46,
  );
  drawing.closePath();
  drawing.fillStyle = gradient;
  drawing.fill();
  drawing.lineWidth = 1.5 + energy * 2.5;
  drawing.strokeStyle = colors.line;
  drawing.stroke();

  drawing.globalAlpha = 0.35 + energy * 0.45;
  drawing.strokeStyle = colors.vein;
  drawing.lineWidth = 1;
  for (let vein = 0; vein < 5; vein += 1) {
    const fraction = (vein + 1) / 6;
    const rootY = anchorY - 34 + fraction * 68;
    const endX = anchorX + (tipX - anchorX) * (0.54 + fraction * 0.06);
    const endY = tipY - 54 + fraction * 104;
    drawing.beginPath();
    drawing.moveTo(anchorX, rootY);
    drawing.quadraticCurveTo(
      anchorX + side * (50 + vein * 8),
      anchorY + (vein - 2) * 10 + vibration,
      endX,
      endY,
    );
    drawing.stroke();
  }
  drawing.globalAlpha = 1;
}

function drawStage() {
  const { width, height, ratio } = stageSize();
  drawing.clearRect(0, 0, width, height);
  const background = drawing.createRadialGradient(
    width * 0.5,
    height * 0.38,
    5,
    width * 0.5,
    height * 0.42,
    width * 0.65,
  );
  background.addColorStop(0, "#12251d");
  background.addColorStop(1, "#06100d");
  drawing.fillStyle = background;
  drawing.fillRect(0, 0, width, height);

  const time = playheadSeconds();
  const frame = frameAtTime(time);
  const pulse = pulseAtTime(time);
  const energy = activeAudio ? clamp(frame.envelope) : 0;
  const phase = time * (analysis?.carrierHz || 4_820) * Math.PI * 2;
  const centerX = width * 0.5;
  const bodyY = Math.min(height * 0.45, height - 185 * ratio);
  const span = Math.min(width * 0.37, 300 * ratio);

  drawing.save();
  if (energy > 0) {
    drawing.shadowBlur = (18 + energy * 32) * ratio;
    drawing.shadowColor = "rgba(137, 225, 94, .34)";
  }
  drawWing(
    centerX - 5 * ratio,
    bodyY,
    centerX - span,
    bodyY - 18 * ratio,
    -1,
    energy,
    phase,
    {
      line: "rgba(111, 225, 210, .9)",
      vein: "rgba(143, 239, 223, .76)",
      fillStrong: `rgba(44, 150, 127, ${0.22 + energy * 0.2})`,
      fillSoft: "rgba(19, 69, 62, .05)",
    },
  );
  drawWing(
    centerX + 5 * ratio,
    bodyY,
    centerX + span,
    bodyY - 18 * ratio,
    1,
    energy * (0.68 + Number($("coupling").value) * 0.32),
    phase + Math.PI * (0.8 - Number($("coupling").value) * 0.55),
    {
      line: "rgba(246, 188, 72, .94)",
      vein: "rgba(255, 211, 116, .8)",
      fillStrong: `rgba(190, 126, 32, ${0.19 + energy * 0.22})`,
      fillSoft: "rgba(79, 49, 15, .05)",
    },
  );
  drawing.restore();

  const fileLeft = centerX - 84 * ratio;
  const fileRight = centerX + 84 * ratio;
  const fileY = bodyY + 68 * ratio;
  drawing.strokeStyle = "rgba(213, 227, 202, .35)";
  drawing.lineWidth = 2 * ratio;
  drawing.beginPath();
  drawing.moveTo(fileLeft, fileY);
  drawing.lineTo(fileRight, fileY);
  drawing.stroke();
  for (let tooth = 0; tooth <= 28; tooth += 1) {
    const x = fileLeft + tooth / 28 * (fileRight - fileLeft);
    const glow = pulse && tooth % 4 === Math.floor(time * 28) % 4;
    drawing.fillStyle = glow ? "#dfff79" : "rgba(222, 238, 207, .58)";
    drawing.fillRect(x - ratio, fileY - (glow ? 7 : 4) * ratio, 1.4 * ratio, 8 * ratio);
  }

  let contactPosition = 0.12;
  if (pulse) {
    contactPosition = clamp((time - pulse.startSeconds) / pulse.durationSeconds);
  } else if (pointerGesture) {
    contactPosition = clamp(pointerGesture.x / Math.max(1, width / ratio));
  }
  const plectrumX = fileLeft + contactPosition * (fileRight - fileLeft);
  drawing.fillStyle = "#e8f4d7";
  drawing.beginPath();
  drawing.moveTo(plectrumX, fileY - 2 * ratio);
  drawing.lineTo(plectrumX - 8 * ratio, fileY - 27 * ratio);
  drawing.lineTo(plectrumX + 7 * ratio, fileY - 25 * ratio);
  drawing.closePath();
  drawing.fill();

  drawing.fillStyle = "rgba(213, 227, 202, .52)";
  drawing.font = `${9 * ratio}px ui-monospace, SFMono-Regular, monospace`;
  drawing.textAlign = "center";
  drawing.fillText("TOOTH FILE  →  CONTACT IMPULSES  →  WING RESONANCE", centerX, fileY + 27 * ratio);

  const scoreLeft = 20 * ratio;
  const scoreRight = width - 20 * ratio;
  const scoreTop = height - 84 * ratio;
  const scoreBottom = height - 25 * ratio;
  drawing.fillStyle = "rgba(3, 10, 8, .58)";
  drawing.fillRect(scoreLeft, scoreTop, scoreRight - scoreLeft, scoreBottom - scoreTop);
  drawing.strokeStyle = "rgba(175, 210, 178, .13)";
  drawing.strokeRect(scoreLeft, scoreTop, scoreRight - scoreLeft, scoreBottom - scoreTop);
  if (analysis?.frames?.length) {
    drawing.beginPath();
    for (let index = 0; index < analysis.frames.length; index += 1) {
      const x = scoreLeft + index / Math.max(1, analysis.frames.length - 1) * (scoreRight - scoreLeft);
      const y = scoreBottom - analysis.frames[index].envelope * (scoreBottom - scoreTop - 7 * ratio);
      if (!index) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.strokeStyle = "rgba(111, 225, 210, .8)";
    drawing.lineWidth = 1.3 * ratio;
    drawing.stroke();
    for (const pulseEvent of analysis.pulses) {
      const x = scoreLeft + pulseEvent.startSeconds / analysis.durationSeconds * (scoreRight - scoreLeft);
      const end = scoreLeft + pulseEvent.endSeconds / analysis.durationSeconds * (scoreRight - scoreLeft);
      drawing.fillStyle = "rgba(246, 188, 72, .18)";
      drawing.fillRect(x, scoreTop, Math.max(ratio, end - x), scoreBottom - scoreTop);
    }
    if (activeAudio) {
      const cursor = scoreLeft + clamp(time / analysis.durationSeconds) * (scoreRight - scoreLeft);
      drawing.strokeStyle = activeKind === "input" ? "#e9f2e5" : "#dfff79";
      drawing.lineWidth = ratio;
      drawing.beginPath();
      drawing.moveTo(cursor, scoreTop);
      drawing.lineTo(cursor, scoreBottom);
      drawing.stroke();
    }
  }
  drawing.textAlign = "left";
  drawing.fillStyle = "rgba(213, 227, 202, .46)";
  drawing.font = `${8 * ratio}px ui-monospace, SFMono-Regular, monospace`;
  drawing.fillText("EFFECTIVE CLOSING-STROKE SCORE", scoreLeft + 6 * ratio, scoreTop + 12 * ratio);
}

function animateStage() {
  cancelAnimationFrame(animationFrame);
  const tick = () => {
    drawStage();
    if (activeAudio && !activeAudio.paused) animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
}

function manualGesture(durationSeconds, force, toothRatio) {
  const sampleRate = analysis?.sampleRate || 48_000;
  const duration = clamp(durationSeconds, 0.045, 0.14);
  const sampleCount = Math.ceil(sampleRate * (duration + 0.035));
  const hopSize = Math.max(32, Math.round(sampleRate * 0.002));
  const frameCount = Math.ceil(sampleCount / hopSize);
  const startSeconds = 0.006;
  const endSeconds = startSeconds + duration;
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const timeSeconds = frameIndex * hopSize / sampleRate;
    const position = (timeSeconds - startSeconds) / duration;
    const attack = clamp(position / 0.14);
    const release = clamp((1 - position) / 0.3);
    const envelope = position > 0 && position < 1
      ? Math.sin(attack * Math.PI * 0.5) * Math.sin(release * Math.PI * 0.5)
      : 0;
    frames.push({ timeSeconds, envelope, active: envelope > 0.025 });
  }
  const pulse = {
    id: "manual-pulse",
    startSeconds,
    endSeconds,
    centerSeconds: (startSeconds + endSeconds) * 0.5,
    durationSeconds: duration,
    strength: force,
  };
  const gesture = {
    version: 1,
    sampleRate,
    sampleCount,
    durationSeconds: sampleCount / sampleRate,
    carrierHz: analysis?.carrierHz || 4_820,
    effectiveQ: analysis?.effectiveQ || 8,
    hopSize,
    frames,
    pulses: [pulse],
    chirps: [{ id: "manual-chirp", startSeconds, endSeconds, pulseCount: 1 }],
  };
  return renderCricketModel(gesture, modelOptions({
    toothRateRatio: toothRatio,
    plectrumForce: force,
  }));
}

function soundPointerGesture(event) {
  if (!pointerGesture || !analysis) return;
  const bounds = canvas.getBoundingClientRect();
  const elapsed = Math.max(0.03, (performance.now() - pointerGesture.startedAt) / 1_000);
  const distance = Math.abs(event.clientX - pointerGesture.startX) / Math.max(1, bounds.width);
  const force = clamp(0.5 + (1 - pointerGesture.y / Math.max(1, bounds.height)) * 0.9, 0.35, 1.35);
  const toothRatio = clamp(0.88 + distance * 0.3 / elapsed * 0.09, 0.78, 1.22);
  const rendered = manualGesture(clamp(0.035 + distance * 0.09, 0.045, 0.13), force, toothRatio);
  if (!audioEnabled) setAudioEnabled(true, false);
  stopPlayback(false);
  revokeUrl(manualUrl);
  manualUrl = wavUrl(rendered.samples, rendered.sampleRate, 0.7);
  manualAudio.src = manualUrl;
  manualAudio.volume = masterLevel();
  activeAudio = manualAudio;
  activeKind = "manual";
  manualAudio.play().catch((error) => setStatus(`Manual stroke could not play: ${error.message}`, "error"));
  $("stop-audio").disabled = false;
  setStatus("Manual closing stroke: teeth excite it; the wings choose the pitch.", "ready");
  animateStage();
}

for (const audio of [inputAudio, modelAudio, manualAudio]) {
  audio.addEventListener("ended", () => {
    if (audio.loop) return;
    activeAudio = null;
    activeKind = "";
    $("play-input").setAttribute("aria-pressed", "false");
    $("play-model").setAttribute("aria-pressed", "false");
    $("stop-audio").disabled = true;
    drawStage();
  });
}

$("play-input").addEventListener("click", () => play("input"));
$("play-model").addEventListener("click", () => play("model"));
$("stop-audio").addEventListener("click", () => stopPlayback());
$("loop-toggle").addEventListener("change", () => {
  inputAudio.loop = $("loop-toggle").checked;
  modelAudio.loop = $("loop-toggle").checked;
});
$("audioButton")?.addEventListener("click", () => setAudioEnabled(!audioEnabled));
$("level")?.addEventListener("input", () => {
  updateControlOutputs();
  for (const audio of [inputAudio, modelAudio, manualAudio]) {
    audio.volume = audioEnabled ? masterLevel() : 0;
  }
});
$("use-demo").addEventListener("click", loadSelectedSource);
$("source-preset").addEventListener("change", loadSelectedSource);
$("file-input").addEventListener("change", (event) => decodeFile(event.target.files?.[0]));
$("render-model").addEventListener("click", rerenderModel);
$("export-wav").addEventListener("click", exportWav);
$("export-json").addEventListener("click", exportJson);

for (const id of CONTROL_IDS) {
  $(id).addEventListener("input", () => {
    updateControlOutputs();
    drawStage();
    if ($("fit-state") && analysis) $("fit-state").textContent = "fit · edited";
    if (analysis?.pulses?.length) scheduleRender();
  });
}

canvas.addEventListener("pointerdown", (event) => {
  const bounds = canvas.getBoundingClientRect();
  canvas.setPointerCapture(event.pointerId);
  pointerGesture = {
    startedAt: performance.now(),
    startX: event.clientX,
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
  drawStage();
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointerGesture) return;
  const bounds = canvas.getBoundingClientRect();
  pointerGesture.x = event.clientX - bounds.left;
  pointerGesture.y = event.clientY - bounds.top;
  drawStage();
});
canvas.addEventListener("pointerup", (event) => {
  soundPointerGesture(event);
  pointerGesture = null;
  drawStage();
});
canvas.addEventListener("pointercancel", () => {
  pointerGesture = null;
  drawStage();
});
canvas.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || !analysis) return;
  event.preventDefault();
  const bounds = canvas.getBoundingClientRect();
  pointerGesture = {
    startedAt: performance.now() - 80,
    startX: bounds.left + bounds.width * 0.28,
    x: bounds.width * 0.72,
    y: bounds.height * 0.33,
  };
  soundPointerGesture({ clientX: bounds.left + bounds.width * 0.72 });
  pointerGesture = null;
});

window.addEventListener("resize", drawStage);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPlayback(false);
});
window.addEventListener("beforeunload", () => {
  revokeUrl(inputUrl);
  revokeUrl(modelUrl);
  revokeUrl(manualUrl);
});

updateControlOutputs();
drawStage();
requestAnimationFrame(loadDemo);
