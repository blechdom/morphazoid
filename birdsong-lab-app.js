import {
  BIRDSONG_DEMO_PRESETS,
  analysisExport,
  analyzeBirdsong,
  createDemoStrophe,
  encodeMonoWav,
  monoSamples,
  renderBirdsongModel,
} from "./src/birdsong-analysis.js";

const $ = (id) => document.getElementById(id);

const PITCH_RANGES = Object.freeze({
  songbird: Object.freeze({ minimumF0Hz: 180, maximumF0Hz: 5_500 }),
  lowbird: Object.freeze({ minimumF0Hz: 70, maximumF0Hz: 1_800 }),
  ultrahigh: Object.freeze({ minimumF0Hz: 700, maximumF0Hz: 9_000 }),
});

const DEFAULT_MODEL = Object.freeze({
  pitchShiftSemitones: 0,
  drive: 1,
  roughness: 0.04,
  resonanceHz: 3_800,
  resonanceQ: 4.5,
  resonanceMix: 0.42,
  seed: 0x57a0f3,
});

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DURATION_SECONDS = 12;
const BIRDSONG_RECORDING_SOURCES = Object.freeze({
  "recorded-thrush-nightingale": Object.freeze({
    path: "./assets/bioacoustics/thrush-nightingale.ogg",
    label: "Thrush nightingale recording · Luscinia luscinia",
    recordist: "Oona Räisänen (Mysid)",
    license: "public-domain dedication",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Luscinia_luscinia.ogg",
    analysisRange: "songbird",
    note: "Great Tit and Common Magpie are audible behind the target; the one-voice profile may include them.",
  }),
  "recorded-common-blackbird": Object.freeze({
    path: "./assets/bioacoustics/common-blackbird.ogg",
    label: "Common blackbird recording · Turdus merula",
    recordist: "Oona Räisänen (Mysid)",
    license: "public-domain dedication",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Turdus_merula_2.ogg",
    analysisRange: "songbird",
    note: "Car noise was reduced by the recordist, so the spectral fit also reflects that preprocessing.",
  }),
  "recorded-chaffinch": Object.freeze({
    path: "./assets/bioacoustics/chaffinch.ogg",
    label: "Chaffinch recording · Fringilla coelebs",
    recordist: "Oona Räisänen (Mysid)",
    license: "public-domain dedication",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Fringilla_coelebs_short.ogg",
    analysisRange: "songbird",
    note: "The recordist filtered this source; extracted timbre and resonance reflect the filtered file.",
  }),
});

const canvas = $("analysisCanvas");
const drawing = canvas.getContext("2d");
const originalAudio = new Audio();
const modelAudio = new Audio();
originalAudio.preload = "auto";
modelAudio.preload = "auto";

let sourceSamples = null;
let sourceSampleRate = 48_000;
let sourceName = "Synthetic six-syllable strophe";
let analysis = null;
let modelRender = null;
let originalUrl = "";
let modelUrl = "";
let activeAudio = null;
let activeKind = "";
let renderTimer = 0;
let drawingFrame = 0;
let taskVersion = 0;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function status(message, state = "working") {
  $("labStatus").textContent = message;
  $("labStatus").dataset.state = state;
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
    $("source-profile-note").textContent = "The profile expects one mostly tonal voice; noise, overlapping animals, and dense choruses can distort its gesture fit.";
    return;
  }
  attribution.textContent = "Procedural Morphazoid reference · not a wildlife recording.";
  $("source-profile-note").textContent = `${source?.description ?? "Synthetic tonal phrase."} The profile does not identify a species.`;
}

function setBusy(busy) {
  $("renderModel").disabled = busy || !analysis?.voicedFraction;
  $("playOriginal").disabled = busy || !originalUrl;
  $("playModel").disabled = busy || !modelUrl;
  $("downloadWav").disabled = busy || !modelRender;
  $("downloadJson").disabled = busy || !modelRender;
  $("fileDrop").setAttribute("aria-busy", String(busy));
  $("audioFile").disabled = busy;
  $("loadDemo").disabled = busy;
  $("source-preset").disabled = busy;
}

function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

function normalizeForPlayback(samples, targetPeak = 0.76) {
  const output = Float32Array.from(samples);
  let peak = 0;
  for (const sample of output) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 1e-8 ? Math.min(16, targetPeak / peak) : 0;
  for (let index = 0; index < output.length; index += 1) output[index] *= gain;
  return output;
}

function audioUrl(samples, sampleRate) {
  return URL.createObjectURL(new Blob(
    [encodeMonoWav(samples, sampleRate)],
    { type: "audio/wav" },
  ));
}

function modelOptions() {
  return {
    pitchShiftSemitones: Number($("pitchShift").value),
    drive: Number($("drive").value),
    roughness: Number($("roughness").value),
    resonanceHz: Number($("resonance").value),
    resonanceQ: Number($("resonanceQ").value),
    resonanceMix: Number($("resonanceMix").value),
    seed: DEFAULT_MODEL.seed,
  };
}

function updateControlOutputs() {
  const pitch = Number($("pitchShift").value);
  $("pitchShiftOut").textContent = `${pitch > 0 ? "+" : ""}${pitch} st`;
  $("driveOut").textContent = `${Number($("drive").value).toFixed(2)}×`;
  $("roughnessOut").textContent = `${Math.round(Number($("roughness").value) * 100)}%`;
  $("resonanceOut").textContent = `${(Number($("resonance").value) / 1_000).toFixed(1)} kHz`;
  $("resonanceQOut").textContent = `${Number($("resonanceQ").value).toFixed(1)} Q`;
  $("resonanceMixOut").textContent = `${Math.round(Number($("resonanceMix").value) * 100)}%`;
  $("levelOut").textContent = `${Math.round(Number($("level").value) * 100)}%`;
}

function resetModelControls(render = true) {
  $("pitchShift").value = DEFAULT_MODEL.pitchShiftSemitones;
  $("drive").value = DEFAULT_MODEL.drive;
  $("roughness").value = DEFAULT_MODEL.roughness;
  $("resonance").value = DEFAULT_MODEL.resonanceHz;
  $("resonanceQ").value = DEFAULT_MODEL.resonanceQ;
  $("resonanceMix").value = DEFAULT_MODEL.resonanceMix;
  updateControlOutputs();
  if (render && analysis?.voicedFraction) scheduleRender(0);
}

function updateStats() {
  if (!analysis) return;
  $("durationStat").textContent = `${analysis.durationSeconds.toFixed(2)} s`;
  $("syllableStat").textContent = String(analysis.syllables.length);
  $("pitchStat").textContent = analysis.medianF0Hz > 0
    ? `${Math.round(analysis.medianF0Hz)} Hz`
    : "unresolved";
  $("voicedStat").textContent = `${Math.round(analysis.voicedFraction * 100)}%`;
  $("analysisNote").textContent = analysis.warning;
}

function stopPlayback(announce = true) {
  for (const audio of [originalAudio, modelAudio]) {
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // An unloaded audio element has no seekable timeline.
    }
  }
  activeAudio = null;
  activeKind = "";
  $("playOriginal").setAttribute("aria-pressed", "false");
  $("playModel").setAttribute("aria-pressed", "false");
  $("stopPlayback").disabled = true;
  if (announce) status("Playback stopped.");
  drawAnalysis();
}

function startPlayback(kind) {
  const audio = kind === "input" ? originalAudio : modelAudio;
  if (!audio.src) return;
  stopPlayback(false);
  activeAudio = audio;
  activeKind = kind;
  audio.loop = $("loopPlayback").checked;
  audio.volume = clamp(Number($("level").value));
  audio.currentTime = 0;
  const playPromise = audio.play();
  if (playPromise?.catch) {
    playPromise.catch((error) => {
      stopPlayback(false);
      status(`Playback could not start: ${error.message}`, "error");
    });
  }
  $(kind === "input" ? "playOriginal" : "playModel").setAttribute("aria-pressed", "true");
  $("stopPlayback").disabled = false;
  status(kind === "input" ? "Playing the analyzed input." : "Playing the physical resynthesis.", "ready");
  animateCursor();
}

function setAudioSources() {
  stopPlayback(false);
  revokeUrl(originalUrl);
  revokeUrl(modelUrl);
  const cropped = sourceSamples.subarray(0, analysis.sampleCount);
  originalUrl = audioUrl(normalizeForPlayback(cropped), sourceSampleRate);
  modelUrl = modelRender ? audioUrl(modelRender.samples, modelRender.sampleRate) : "";
  originalAudio.src = originalUrl;
  modelAudio.src = modelUrl;
  originalAudio.loop = $("loopPlayback").checked;
  modelAudio.loop = $("loopPlayback").checked;
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function analyzeAndRender() {
  const version = ++taskVersion;
  stopPlayback(false);
  setBusy(true);
  status("Extracting voicing, pitch, amplitude, and syllable islands…");
  await waitForPaint();
  try {
    const range = PITCH_RANGES[$("pitchRange").value] ?? PITCH_RANGES.songbird;
    const nextAnalysis = analyzeBirdsong(sourceSamples, sourceSampleRate, {
      ...range,
      maxDurationSeconds: MAX_DURATION_SECONDS,
    });
    if (version !== taskVersion) return;
    analysis = nextAnalysis;
    updateStats();
    if (!analysis.voicedFraction) {
      modelRender = null;
      setAudioSources();
      setBusy(false);
      drawAnalysis();
      status(analysis.warning, "error");
      return;
    }
    status("Driving the nonlinear bilateral syrinx from those gesture proxies…");
    await waitForPaint();
    modelRender = renderBirdsongModel(analysis, modelOptions());
    if (version !== taskVersion) return;
    setAudioSources();
    setBusy(false);
    drawAnalysis();
    const cropped = sourceSamples.length > analysis.sampleCount ? " First 12 seconds analyzed." : "";
    status(
      `Ready: ${analysis.syllables.length} syllable${analysis.syllables.length === 1 ? "" : "s"}, ${Math.round(analysis.medianF0Hz)} Hz median pitch.${cropped}`,
      "ready",
    );
  } catch (error) {
    if (version !== taskVersion) return;
    setBusy(false);
    status(error?.message || "The audio could not be analyzed.", "error");
  }
}

async function rerenderModel() {
  if (!analysis?.voicedFraction) return;
  const version = ++taskVersion;
  stopPlayback(false);
  setBusy(true);
  status("Rendering the intervention through the physical source and tract…");
  await waitForPaint();
  try {
    const nextRender = renderBirdsongModel(analysis, modelOptions());
    if (version !== taskVersion) return;
    modelRender = nextRender;
    setAudioSources();
    setBusy(false);
    drawAnalysis();
    status("Physical copy rendered. Compare Input and Physical, or export the gesture.", "ready");
  } catch (error) {
    if (version !== taskVersion) return;
    setBusy(false);
    status(error?.message || "The physical copy could not be rendered.", "error");
  }
}

function scheduleRender(delay = 160) {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(rerenderModel, delay);
}

async function loadDemo() {
  const requestedPreset = $("source-preset").value;
  const presetId = BIRDSONG_DEMO_PRESETS.some((preset) => preset.id === requestedPreset)
    ? requestedPreset
    : BIRDSONG_DEMO_PRESETS[0].id;
  const demo = createDemoStrophe(48_000, presetId);
  sourceSamples = demo.samples;
  sourceSampleRate = demo.sampleRate;
  sourceName = demo.label;
  $("source-preset").value = demo.presetId;
  $("pitchRange").value = demo.analysisRange;
  setSourceDetails(demo, "synthetic");
  $("sourceLabel").textContent = sourceName;
  $("audioFile").value = "";
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
    const channels = [];
    for (let index = 0; index < decoded.numberOfChannels; index += 1) {
      channels.push(decoded.getChannelData(index));
    }
    return {
      samples: monoSamples(channels),
      sampleRate: decoded.sampleRate,
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

async function loadBundledRecording(sourceId) {
  const source = BIRDSONG_RECORDING_SOURCES[sourceId];
  if (!source) return loadDemo();
  stopPlayback(false);
  setBusy(true);
  status(`Loading ${source.label} locally…`);
  await waitForPaint();
  try {
    const response = await fetch(source.path);
    if (!response.ok) throw new Error(`local file returned ${response.status}`);
    const decoded = await decodeAudioBytes(await response.arrayBuffer());
    sourceSamples = decoded.samples;
    sourceSampleRate = decoded.sampleRate;
    sourceName = source.label;
    $("sourceLabel").textContent = source.label;
    $("audioFile").value = "";
    $("pitchRange").value = source.analysisRange;
    setSourceDetails(source, "recording");
    await analyzeAndRender();
  } catch (error) {
    setBusy(false);
    status(`Could not load ${source.label}: ${error.message}`, "error");
  }
}

function loadSelectedSource() {
  const sourceId = $("source-preset").value;
  return BIRDSONG_RECORDING_SOURCES[sourceId]
    ? loadBundledRecording(sourceId)
    : loadDemo();
}

async function decodeFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    status("That file is over 64 MB. Choose a shorter recording.", "error");
    return;
  }
  stopPlayback(false);
  setBusy(true);
  status(`Decoding ${file.name} locally…`);
  await waitForPaint();
  try {
    const data = await file.arrayBuffer();
    const decoded = await decodeAudioBytes(data);
    sourceSamples = decoded.samples;
    sourceSampleRate = decoded.sampleRate;
    sourceName = file.name;
    $("source-preset").value = "local";
    setSourceDetails(null, "upload");
    $("sourceLabel").textContent = file.name;
    await analyzeAndRender();
  } catch (error) {
    setBusy(false);
    status(`Could not decode ${file.name}: ${error.message}`, "error");
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
    .toLowerCase() || "strophe";
}

function downloadModelWav() {
  if (!modelRender) return;
  downloadBlob(
    new Blob([encodeMonoWav(modelRender.samples, modelRender.sampleRate)], { type: "audio/wav" }),
    `${safeStem(sourceName)}-physical-syrinx.wav`,
  );
  status("Physical-model WAV exported.", "ready");
}

function downloadGestureJson() {
  if (!analysis || !modelRender) return;
  const exported = analysisExport(analysis, modelRender, sourceName);
  downloadBlob(
    new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: "application/json" }),
    `${safeStem(sourceName)}-gesture.json`,
  );
  status("Control-rate gesture JSON exported.", "ready");
}

function canvasSize() {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(320, Math.round(bounds.width * pixelRatio));
  const height = Math.max(320, Math.round(bounds.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, pixelRatio };
}

function drawLaneLabel(label, x, y, color) {
  drawing.fillStyle = color;
  drawing.font = `${11 * Math.min(2, window.devicePixelRatio || 1)}px ui-monospace, monospace`;
  drawing.fillText(label.toUpperCase(), x, y);
}

function drawWave(samples, left, right, center, height, color, alpha = 1) {
  if (!samples?.length) return;
  const width = Math.max(1, Math.floor(right - left));
  drawing.strokeStyle = color;
  drawing.globalAlpha = alpha;
  drawing.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.85);
  drawing.beginPath();
  for (let pixel = 0; pixel < width; pixel += 1) {
    const start = Math.floor(pixel / width * samples.length);
    const end = Math.max(start + 1, Math.floor((pixel + 1) / width * samples.length));
    let minimum = 1;
    let maximum = -1;
    for (let index = start; index < end && index < samples.length; index += 1) {
      minimum = Math.min(minimum, samples[index]);
      maximum = Math.max(maximum, samples[index]);
    }
    const x = left + pixel + 0.5;
    drawing.moveTo(x, center - maximum * height);
    drawing.lineTo(x, center - minimum * height);
  }
  drawing.stroke();
  drawing.globalAlpha = 1;
}

function drawFrameCurve(frames, key, left, right, top, bottom, color, mapValue = (value) => value) {
  if (!frames?.length) return;
  drawing.strokeStyle = color;
  drawing.lineWidth = Math.max(1.2, (window.devicePixelRatio || 1) * 1.05);
  drawing.lineJoin = "round";
  drawing.beginPath();
  let started = false;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const raw = frame[key];
    if (!Number.isFinite(raw) || (key === "f0Hz" && !frame.voiced)) {
      started = false;
      continue;
    }
    const x = left + index / Math.max(1, frames.length - 1) * (right - left);
    const normalized = clamp(mapValue(raw));
    const y = bottom - normalized * (bottom - top);
    if (!started) drawing.moveTo(x, y);
    else drawing.lineTo(x, y);
    started = true;
  }
  drawing.stroke();
}

function drawAnalysis() {
  const { width, height, pixelRatio } = canvasSize();
  drawing.clearRect(0, 0, width, height);
  drawing.fillStyle = "rgba(2, 9, 8, 0.52)";
  drawing.fillRect(0, 0, width, height);

  const margin = 22 * pixelRatio;
  const left = margin;
  const right = width - margin;
  const top = 48 * pixelRatio;
  const waveformBottom = height * 0.48;
  const pitchTop = height * 0.57;
  const pitchBottom = height * 0.74;
  const controlTop = height * 0.82;
  const controlBottom = height - 20 * pixelRatio;

  drawing.strokeStyle = "rgba(178, 218, 201, 0.13)";
  drawing.lineWidth = 1;
  for (const y of [waveformBottom, pitchTop - 10 * pixelRatio, controlTop - 10 * pixelRatio]) {
    drawing.beginPath();
    drawing.moveTo(left, y);
    drawing.lineTo(right, y);
    drawing.stroke();
  }

  drawLaneLabel("waveform", left, top - 13 * pixelRatio, "rgba(233,243,232,.48)");
  drawLaneLabel("fundamental frequency", left, pitchTop - 14 * pixelRatio, "rgba(244,206,105,.65)");
  drawLaneLabel("effective controls", left, controlTop - 14 * pixelRatio, "rgba(101,225,204,.58)");

  if (!analysis || !sourceSamples) {
    drawing.fillStyle = "rgba(233, 243, 232, 0.55)";
    drawing.font = `${14 * pixelRatio}px system-ui, sans-serif`;
    drawing.fillText("Load a short tonal bird recording or the demo.", left, height * 0.5);
    return;
  }

  for (const [index, syllable] of analysis.syllables.entries()) {
    const start = left + syllable.startSeconds / analysis.durationSeconds * (right - left);
    const end = left + syllable.endSeconds / analysis.durationSeconds * (right - left);
    drawing.fillStyle = index % 2
      ? "rgba(125, 201, 255, 0.035)"
      : "rgba(101, 225, 204, 0.045)";
    drawing.fillRect(start, top, Math.max(1, end - start), controlBottom - top);
    drawing.fillStyle = "rgba(137, 160, 154, 0.48)";
    drawing.font = `${9 * pixelRatio}px ui-monospace, monospace`;
    drawing.fillText(`S${index + 1}`, start + 3 * pixelRatio, top + 11 * pixelRatio);
  }

  const sourceView = sourceSamples.subarray(0, analysis.sampleCount);
  const waveformCenter = (top + waveformBottom) * 0.5;
  const waveformHeight = (waveformBottom - top) * 0.42;
  drawWave(sourceView, left, right, waveformCenter, waveformHeight, "#e9f3e8", 0.42);
  if (modelRender) {
    drawWave(modelRender.samples, left, right, waveformCenter, waveformHeight, "#65e1cc", 0.88);
  }

  const minLog = Math.log(analysis.minimumF0Hz);
  const logRange = Math.log(analysis.maximumF0Hz) - minLog;
  drawFrameCurve(
    analysis.frames,
    "f0Hz",
    left,
    right,
    pitchTop,
    pitchBottom,
    "#f4ce69",
    (value) => (Math.log(value) - minLog) / logRange,
  );
  drawFrameCurve(
    analysis.frames,
    "pressureProxy",
    left,
    right,
    controlTop,
    controlBottom,
    "#ff936d",
  );
  drawFrameCurve(
    analysis.frames,
    "tensionProxy",
    left,
    right,
    controlTop,
    controlBottom,
    "#bca8ff",
  );

  if (activeAudio && Number.isFinite(activeAudio.currentTime)) {
    const position = clamp(activeAudio.currentTime / Math.max(0.001, analysis.durationSeconds));
    const x = left + position * (right - left);
    drawing.strokeStyle = activeKind === "input" ? "rgba(233,243,232,.8)" : "#65e1cc";
    drawing.lineWidth = Math.max(1, pixelRatio);
    drawing.beginPath();
    drawing.moveTo(x, top);
    drawing.lineTo(x, controlBottom);
    drawing.stroke();
  }
}

function animateCursor() {
  cancelAnimationFrame(drawingFrame);
  const tick = () => {
    drawAnalysis();
    if (activeAudio && !activeAudio.paused) drawingFrame = requestAnimationFrame(tick);
  };
  drawingFrame = requestAnimationFrame(tick);
}

for (const audio of [originalAudio, modelAudio]) {
  audio.addEventListener("ended", () => {
    if (audio.loop) return;
    stopPlayback(false);
    status("Playback complete.");
  });
}

$("playOriginal").addEventListener("click", () => startPlayback("input"));
$("playModel").addEventListener("click", () => startPlayback("model"));
$("stopPlayback").addEventListener("click", () => stopPlayback());
$("loopPlayback").addEventListener("change", () => {
  originalAudio.loop = $("loopPlayback").checked;
  modelAudio.loop = $("loopPlayback").checked;
});
$("level").addEventListener("input", () => {
  updateControlOutputs();
  const volume = clamp(Number($("level").value));
  originalAudio.volume = volume;
  modelAudio.volume = volume;
});

$("loadDemo").addEventListener("click", loadSelectedSource);
$("source-preset").addEventListener("change", loadSelectedSource);
$("audioFile").addEventListener("change", (event) => decodeFile(event.target.files?.[0]));
$("pitchRange").addEventListener("change", () => {
  if (sourceSamples) analyzeAndRender();
});
$("renderModel").addEventListener("click", rerenderModel);
$("resetModel").addEventListener("click", () => resetModelControls());
$("downloadWav").addEventListener("click", downloadModelWav);
$("downloadJson").addEventListener("click", downloadGestureJson);

for (const id of ["pitchShift", "drive", "roughness", "resonance", "resonanceQ", "resonanceMix"]) {
  $(id).addEventListener("input", () => {
    updateControlOutputs();
    if (analysis?.voicedFraction) scheduleRender();
  });
}

const fileDrop = $("fileDrop");
fileDrop.addEventListener("click", () => $("audioFile").click());
fileDrop.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  $("audioFile").click();
});
for (const eventName of ["dragenter", "dragover"]) {
  fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDrop.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDrop.classList.remove("is-dragging");
  });
}
fileDrop.addEventListener("drop", (event) => decodeFile(event.dataTransfer?.files?.[0]));

window.addEventListener("resize", drawAnalysis);
window.addEventListener("beforeunload", () => {
  revokeUrl(originalUrl);
  revokeUrl(modelUrl);
});

updateControlOutputs();
drawAnalysis();
requestAnimationFrame(loadDemo);
