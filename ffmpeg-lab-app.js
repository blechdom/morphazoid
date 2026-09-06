import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { unlockAudioContext } from "./src/audio.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { decodePcmWav } from "./src/pcm-wav-decoder.js";
import {
  FFMPEG_LAB_DEFAULTS,
  FFMPEG_LAB_FILTER_PRESETS,
  FFMPEG_LAB_VIDEO_FORMATS,
  appendHistory,
  buildFfmpegAudioArgs,
  buildFfmpegVideoArgs,
  chunkFramesForMs,
  concatHistory,
  createPpmFrame,
  createTelemetryFrame,
  createWaveFileHeader,
  filterPresetById,
  floatToPcm16,
  formatMilliseconds,
  formatPercent,
  levelToGain,
  peakLevel,
  rmsLevel,
  sanitizeFfmpegLabState,
} from "./src/ffmpeg-lab.js";

const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.9/dist/esm/ffmpeg-core";
const STORAGE_KEY = "morphazoid:ffmpeg-lab:v1";
const LOG_LIMIT = 16;

const $ = (id) => document.getElementById(id);

const canvas = $("stage");
const context2d = canvas.getContext("2d");
const ffmpeg = new FFmpeg();

const state = {
  ...sanitizeFfmpegLabState(restoreState()),
  audioOn: false,
  micOn: false,
  ffmpegLoaded: false,
  ffmpegLoading: false,
  ffmpegError: "",
  ffmpegProgress: "",
  backlog: [],
  activeChunk: null,
  droppedChunks: 0,
  processing: false,
  processMs: NaN,
  scheduledTime: 0,
  inputMeter: 0,
  outputMeter: 0,
  telemetryHistory: [],
  outputHistory: [],
  logLines: ["FFmpeg log will appear here."],
  browserRecording: null,
  lastExportName: "",
};

let audioContext = null;
let masterGain = null;
let analyser = null;
let recorderDestination = null;
let releaseAudioOutput = null;
let microphoneStream = null;
let microphoneSource = null;
let captureProcessor = null;
let captureMute = null;
let currentChunk = [];
let currentChunkFrames = 0;
let captureGeneration = 0;
let activeSources = new Set();
let rafHandle = 0;
let canvasWidth = 1;
let canvasHeight = 1;
let pixelRatio = 1;
let disposed = false;
let chunkSequence = 0;

function restoreState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      presetId: state.presetId,
      filterGraph: state.filterGraph,
      inputLevel: state.inputLevel,
      outputLevel: state.outputLevel,
      chunkMs: state.chunkMs,
      maxQueue: state.maxQueue,
      clipSeconds: state.clipSeconds,
      videoFps: state.videoFps,
      videoFormat: state.videoFormat,
      historySeconds: state.historySeconds,
    }));
  } catch {
    // Embedded or private contexts may not allow local storage.
  }
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showError(message) {
  $("audioError").textContent = message;
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function appendLog(line) {
  const safeLine = String(line ?? "").trim();
  if (!safeLine) return;
  state.logLines = [...state.logLines.slice(-(LOG_LIMIT - 1)), safeLine];
  $("engineLog").textContent = state.logLines.join("\n");
}

function choosePreset(presetId) {
  const preset = filterPresetById(presetId);
  state.presetId = preset.id;
  state.filterGraph = preset.filterGraph;
  $("preset").value = preset.id;
  $("filterGraph").value = preset.filterGraph;
  persistState();
  updateUi();
}

function populateMenus() {
  const preset = $("preset");
  preset.replaceChildren(...FFMPEG_LAB_FILTER_PRESETS.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    return option;
  }));
  const videoFormat = $("videoFormat");
  videoFormat.replaceChildren(...FFMPEG_LAB_VIDEO_FORMATS.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    return option;
  }));
}

function pickVideoMimeType() {
  if (!globalThis.MediaRecorder) return "";
  const options = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") return options[options.length - 1];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function clampSample(sample) {
  return Math.max(-1, Math.min(1, Number(sample) || 0));
}

function createWaveBytes(samples, sampleRate) {
  const pcm = floatToPcm16(samples);
  const header = createWaveFileHeader(pcm.length, sampleRate);
  const bytes = new Uint8Array(header.length + pcm.length * 2);
  bytes.set(header, 0);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < pcm.length; index += 1) {
    view.setInt16(44 + index * 2, pcm[index], true);
  }
  return bytes;
}

function downloadBytes(bytes, filename, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // Track may already be stopped.
    }
  }
}

function disconnectNode(node) {
  try {
    node?.disconnect?.();
  } catch {
    // Closed graphs can disconnect first.
  }
}

function ensureAudioGraph() {
  if (audioContext && audioContext.state !== "closed") return audioContext;
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
  audioContext = new AudioContextClass();
  masterGain = audioContext.createGain();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  masterGain.gain.value = 0;
  masterGain.connect(analyser);
  releaseAudioOutput = connectAudioOutput(audioContext, analyser, { runtime: globalThis });
  if (typeof audioContext.createMediaStreamDestination === "function") {
    recorderDestination = audioContext.createMediaStreamDestination();
    analyser.connect(recorderDestination);
  }
  return audioContext;
}

async function setAudioEnabled(enabled) {
  if (enabled) {
    const context = ensureAudioGraph();
    if (context.state !== "running") await context.resume();
    unlockAudioContext(context);
    state.audioOn = true;
    masterGain.gain.setTargetAtTime(levelToGain(state.outputLevel), context.currentTime, 0.03);
    announce(state.micOn
      ? "Audio on. FFmpeg Lab can now play processed chunks."
      : "Audio on. Start the microphone to hear chunked FFmpeg processing.");
  } else {
    state.audioOn = false;
    if (masterGain && audioContext) {
      masterGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.03);
    }
    announce("Audio off. The microphone path can remain armed silently.");
  }
  updateUi();
}

async function loadFfmpeg() {
  if (state.ffmpegLoaded || state.ffmpegLoading) return true;
  state.ffmpegLoading = true;
  state.ffmpegError = "";
  appendLog("Loading ffmpeg.wasm core…");
  updateUi();
  try {
    await ffmpeg.load({
      classWorkerURL: "../../vendor/ffmpeg/worker.js",
      coreURL: `${FFMPEG_CORE_BASE}.js`,
      wasmURL: `${FFMPEG_CORE_BASE}.wasm`,
      workerURL: `${FFMPEG_CORE_BASE}.worker.js`,
    });
    state.ffmpegLoaded = true;
    appendLog("ffmpeg core loaded.");
    announce("FFmpeg loaded. Microphone chunks can now pass through the worker.");
    return true;
  } catch (error) {
    state.ffmpegError = error instanceof Error ? error.message : String(error);
    appendLog(`ffmpeg load failed: ${state.ffmpegError}`);
    showError(`FFmpeg could not load: ${state.ffmpegError}`);
    return false;
  } finally {
    state.ffmpegLoading = false;
    updateUi();
  }
}

function updateUi() {
  const queueSize = state.backlog.length + (state.activeChunk ? 1 : 0);
  $("audioState").textContent = state.audioOn ? "on" : "off";
  setPressed($("audioButton"), state.audioOn);
  $("outputLevelOut").textContent = formatPercent(state.outputLevel);
  $("inputLevelOut").textContent = formatPercent(Math.min(1, state.inputLevel / 1));
  $("chunkMsOut").textContent = `${Math.round(state.chunkMs)} ms`;
  $("queueDepthOut").textContent = `${state.maxQueue} chunks`;
  $("chunkSummary").textContent = `${Math.round(state.chunkMs)} ms`;
  $("queueSummary").textContent = `${queueSize} / ${state.maxQueue}`;
  $("inputStats").textContent = formatPercent(state.inputMeter);
  $("outputStats").textContent = formatPercent(state.outputMeter);
  $("processStats").textContent = formatMilliseconds(state.processMs);
  $("dropStats").textContent = String(state.droppedChunks);
  $("sourceSummary").textContent = state.micOn
    ? state.audioOn ? "microphone live" : "microphone armed · audio off"
    : "microphone off";
  $("streamSummary").textContent = state.ffmpegLoaded
    ? queueSize ? "ffmpeg queue active" : "ffmpeg ready"
    : state.ffmpegLoading ? "loading ffmpeg" : "dry queue idle";
  $("engineSummary").textContent = state.ffmpegLoaded
    ? state.processing ? "processing chunks" : "ffmpeg ready"
    : state.ffmpegLoading ? "loading wasm core" : state.ffmpegError ? "load failed" : "not loaded";
  $("engineCard").dataset.state = state.ffmpegError
    ? "error"
    : state.ffmpegLoaded ? (state.processing ? "live" : "ready") : "idle";
  $("engineName").textContent = state.ffmpegLoaded
    ? "FFmpeg worker ready"
    : state.ffmpegLoading ? "Loading ffmpeg.wasm" : "FFmpeg wrapper idle";
  $("engineDetail").textContent = state.ffmpegError
    ? state.ffmpegError
    : state.ffmpegLoaded
      ? "Single-thread core for chunked mic filtering and export."
      : "Load the wasm core on demand.";
  $("micButtonLabel").textContent = state.micOn ? "Stop mic" : "Start mic";
  $("micButtonHint").textContent = state.audioOn ? "chunk capture active" : "capture waits for audio";
  setPressed($("micButton"), state.micOn);
  $("loadButtonLabel").textContent = state.ffmpegLoaded ? "Reload not required" : "Load ffmpeg.wasm";
  $("loadButtonHint").textContent = state.ffmpegLoaded ? "worker ready for chunks" : "downloads core JS, worker, and wasm";
  $("loadButton").disabled = state.ffmpegLoading || state.ffmpegLoaded;
  setPressed($("loadButton"), state.ffmpegLoaded || state.ffmpegLoading);
  $("recordVideoLabel").textContent = state.browserRecording ? "Stop browser clip" : "Record browser clip";
  $("recordVideoHint").textContent = state.browserRecording ? "download on stop" : "canvas + processed audio";
  setPressed($("recordVideoButton"), Boolean(state.browserRecording));
  $("clipSecondsOut").textContent = `${state.clipSeconds.toFixed(1)} s`;
  $("videoFpsOut").textContent = `${state.videoFps} fps`;
  $("videoSummary").textContent = state.browserRecording
    ? "browser recorder live"
    : state.lastExportName || "browser recorder idle";
  $("clipSummary").textContent = state.browserRecording
    ? "browser recorder live"
    : state.lastExportName || "browser recorder idle";
  $("leadSummary").textContent = audioContext && Number.isFinite(state.scheduledTime)
    ? formatMilliseconds(Math.max(0, (state.scheduledTime - audioContext.currentTime) * 1_000))
    : "—";
  $("logSummary").textContent = state.ffmpegProgress || (state.ffmpegLoaded ? "worker ready" : "waiting for engine");
  $("truthNote").textContent = state.ffmpegLoaded
    ? "Prototype boundary: the page uses ffmpeg.wasm as a chunk processor and exporter, so latency is bounded by queued chunk size plus worker time."
    : "Prototype boundary: until ffmpeg loads, the lab can arm audio and the mic but cannot run the intended ffmpeg chunk path.";
}

function resizeCanvas() {
  const bounds = $("stageWrap").getBoundingClientRect();
  pixelRatio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  canvasWidth = Math.max(320, Math.round(bounds.width * pixelRatio));
  canvasHeight = Math.max(240, Math.round(bounds.height * pixelRatio));
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
}

function drawMeters() {
  const width = canvasWidth;
  const height = canvasHeight;
  context2d.setTransform(1, 0, 0, 1, 0, 0);
  context2d.clearRect(0, 0, width, height);
  const gradient = context2d.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#10202a");
  gradient.addColorStop(1, "#050709");
  context2d.fillStyle = gradient;
  context2d.fillRect(0, 0, width, height);

  const columns = Math.max(12, Math.min(state.telemetryHistory.length, 48));
  const start = Math.max(0, state.telemetryHistory.length - columns);
  const entries = state.telemetryHistory.slice(start);
  const columnWidth = width / Math.max(1, columns);
  entries.forEach((entry, index) => {
    const x = index * columnWidth;
    const inputHeight = entry.inputLevel * height * 0.42;
    const outputHeight = entry.outputLevel * height * 0.42;
    const queueHeight = entry.backlogRatio * height * 0.14;
    context2d.fillStyle = "#58d5ff";
    context2d.fillRect(x + columnWidth * 0.12, height - inputHeight, columnWidth * 0.28, inputHeight);
    context2d.fillStyle = "#ffd479";
    context2d.fillRect(x + columnWidth * 0.45, height * 0.5 - outputHeight, columnWidth * 0.28, outputHeight);
    context2d.fillStyle = "#ff73ba";
    context2d.fillRect(x + columnWidth * 0.78, height * 0.18 - queueHeight, columnWidth * 0.14, queueHeight);
  });

  const packetCount = Math.max(1, state.maxQueue);
  const bandY = height * 0.78;
  const bandWidth = width * 0.68;
  const bandStart = width * 0.16;
  context2d.strokeStyle = "rgba(255,255,255,0.12)";
  context2d.lineWidth = Math.max(1, pixelRatio);
  context2d.strokeRect(bandStart, bandY, bandWidth, height * 0.08);
  for (let index = 0; index < packetCount; index += 1) {
    const x = bandStart + index / packetCount * bandWidth;
    context2d.strokeRect(x, bandY, bandWidth / packetCount - 2, height * 0.08);
  }
  const fillCount = state.backlog.length;
  for (let index = 0; index < fillCount; index += 1) {
    const x = bandStart + index / packetCount * bandWidth;
    context2d.fillStyle = "rgba(88,213,255,0.5)";
    context2d.fillRect(x + 1, bandY + 1, Math.max(0, bandWidth / packetCount - 4), height * 0.08 - 2);
  }
  if (state.activeChunk) {
    context2d.fillStyle = "rgba(255,212,121,0.84)";
    context2d.fillRect(width * 0.44, height * 0.26, width * 0.12, height * 0.08);
  }

  context2d.fillStyle = "rgba(224,235,241,0.85)";
  context2d.font = `${Math.max(12, 13 * pixelRatio)}px ui-monospace, monospace`;
  context2d.fillText("MIC PACKETS", bandStart, bandY - 10 * pixelRatio);
  context2d.fillText("FFMPEG", width * 0.45, height * 0.23);
  context2d.fillText("OUTPUT HISTORY", width * 0.04, height * 0.13);
}

function frame() {
  rafHandle = requestAnimationFrame(frame);
  if (disposed) return;
  if (analyser) {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    state.outputMeter = Math.min(1, peakLevel(data));
  }
  drawMeters();
  updateUi();
}

function scheduleProcessedAudio(samples, sampleRate) {
  if (!samples?.length) return;
  const context = ensureAudioGraph();
  const safeRate = Math.round(sampleRate || context.sampleRate || 48_000);
  const buffer = context.createBuffer(1, samples.length, safeRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(masterGain);
  const startAt = Math.max(context.currentTime + 0.03, state.scheduledTime || context.currentTime + 0.03);
  state.scheduledTime = startAt + buffer.duration;
  source.onended = () => {
    activeSources.delete(source);
    disconnectNode(source);
  };
  activeSources.add(source);
  source.start(startAt);
}

function recordTelemetry(inputSamples, outputSamples, processMs) {
  const entry = Object.freeze({
    inputLevel: Math.min(1, peakLevel(inputSamples)),
    outputLevel: Math.min(1, peakLevel(outputSamples)),
    backlogRatio: Math.min(1, state.backlog.length / Math.max(1, state.maxQueue)),
    processMs,
    at: performance.now(),
  });
  state.telemetryHistory = [...state.telemetryHistory.slice(-63), entry];
}

async function processNextChunk() {
  if (state.processing || !state.backlog.length) return;
  const context = ensureAudioGraph();
  const job = state.backlog.shift();
  state.activeChunk = job;
  state.processing = true;
  updateUi();
  const startedAt = performance.now();
  try {
    if (!state.ffmpegLoaded) {
      const ready = await loadFfmpeg();
      if (!ready) throw new Error(state.ffmpegError || "ffmpeg failed to load");
    }
    const inputPath = `input-${job.id}.wav`;
    const outputPath = `output-${job.id}.wav`;
    await ffmpeg.writeFile(inputPath, createWaveBytes(job.samples, context.sampleRate));
    const exitCode = await ffmpeg.exec(buildFfmpegAudioArgs({
      sampleRate: context.sampleRate,
      filterGraph: state.filterGraph,
      inputPath,
      outputPath,
    }));
    if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
    const outputBytes = await ffmpeg.readFile(outputPath);
    const decoded = decodePcmWav(outputBytes);
    state.processMs = performance.now() - startedAt;
    const outputSamples = decoded.samples;
    state.outputHistory = appendHistory(
      state.outputHistory,
      outputSamples,
      Math.round(context.sampleRate * state.historySeconds),
    );
    recordTelemetry(job.samples, outputSamples, state.processMs);
    scheduleProcessedAudio(outputSamples, decoded.sampleRate);
    await Promise.allSettled([
      ffmpeg.deleteFile(inputPath),
      ffmpeg.deleteFile(outputPath),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.ffmpegError = message;
    appendLog(`processing failed: ${message}`);
    showError(`Chunk processing failed: ${message}`);
  } finally {
    state.activeChunk = null;
    state.processing = false;
    updateUi();
    if (state.backlog.length) void processNextChunk();
  }
}

function commitChunk(chunk) {
  if (!chunk?.length) return;
  const next = {
    id: ++chunkSequence,
    samples: chunk,
  };
  if (state.backlog.length >= state.maxQueue) {
    state.backlog.shift();
    state.droppedChunks += 1;
    announce("Queue ceiling reached. The oldest waiting chunk was dropped to bound latency.");
  }
  state.backlog.push(next);
  void processNextChunk();
}

function queueSamples(input) {
  const chunkFrames = chunkFramesForMs(state.chunkMs, audioContext?.sampleRate || 48_000);
  for (let index = 0; index < input.length; index += 1) {
    currentChunk.push(clampSample(input[index] * state.inputLevel));
    currentChunkFrames += 1;
    if (currentChunkFrames >= chunkFrames) {
      commitChunk(Float32Array.from(currentChunk));
      currentChunk = [];
      currentChunkFrames = 0;
    }
  }
}

async function startMic() {
  if (state.micOn) return;
  clearError();
  ensureAudioGraph();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone input is not available in this browser.");
  }
  const generation = ++captureGeneration;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  if (generation !== captureGeneration) {
    stopStream(stream);
    return;
  }
  microphoneStream = stream;
  microphoneSource = audioContext.createMediaStreamSource(stream);
  captureProcessor = audioContext.createScriptProcessor(2048, 1, 1);
  captureMute = audioContext.createGain();
  captureMute.gain.value = 0;
  captureProcessor.onaudioprocess = (event) => {
    if (!state.micOn) return;
    const input = event.inputBuffer.getChannelData(0);
    state.inputMeter = Math.min(1, peakLevel(input));
    queueSamples(input);
  };
  microphoneSource.connect(captureProcessor);
  captureProcessor.connect(captureMute);
  captureMute.connect(audioContext.destination);
  state.micOn = true;
  if (!state.ffmpegLoaded) void loadFfmpeg();
  announce(state.audioOn
    ? "Microphone started. Chunks now queue into ffmpeg."
    : "Microphone armed. Turn Audio on to let the queue render audibly.");
  updateUi();
}

function stopMic() {
  captureGeneration += 1;
  state.micOn = false;
  currentChunk = [];
  currentChunkFrames = 0;
  disconnectNode(microphoneSource);
  disconnectNode(captureProcessor);
  disconnectNode(captureMute);
  stopStream(microphoneStream);
  microphoneStream = null;
  microphoneSource = null;
  captureProcessor = null;
  captureMute = null;
  announce("Microphone stopped.");
  updateUi();
}

async function toggleBrowserRecording() {
  if (state.browserRecording) {
    state.browserRecording.recorder.stop();
    return;
  }
  ensureAudioGraph();
  if (!canvas.captureStream) throw new Error("Canvas captureStream is not available in this browser.");
  if (!recorderDestination) throw new Error("This browser cannot expose processed audio as a MediaStream.");
  if (!globalThis.MediaRecorder) throw new Error("MediaRecorder is not available in this browser.");
  const stream = canvas.captureStream(state.videoFps);
  const audioTrack = recorderDestination.stream.getAudioTracks()[0];
  const combined = new MediaStream([
    ...stream.getVideoTracks(),
    ...(audioTrack ? [audioTrack] : []),
  ]);
  const mimeType = pickVideoMimeType();
  const recorder = mimeType ? new MediaRecorder(combined, { mimeType }) : new MediaRecorder(combined);
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    const type = recorder.mimeType || "video/webm";
    const extension = type.includes("webm") ? "webm" : "bin";
    const filename = `ffmpeg-lab-browser-${Date.now()}.${extension}`;
    downloadBytes(new Uint8Array([]), filename, type);
    const blob = new Blob(chunks, { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    for (const track of combined.getTracks()) track.stop();
    state.browserRecording = null;
    state.lastExportName = filename;
    announce("Browser clip recorded and downloaded.");
    updateUi();
  };
  recorder.start(500);
  state.browserRecording = { recorder, stream: combined };
  announce("Browser clip recording started.");
  updateUi();
}

async function exportFfmpegClip() {
  ensureAudioGraph();
  if (!state.outputHistory.length) throw new Error("No processed audio history is available yet.");
  const ready = state.ffmpegLoaded || await loadFfmpeg();
  if (!ready) throw new Error(state.ffmpegError || "ffmpeg failed to load");
  const clipFrames = Math.round(audioContext.sampleRate * state.clipSeconds);
  const audioSamples = concatHistory(state.outputHistory, clipFrames);
  const audioBytes = createWaveBytes(audioSamples, audioContext.sampleRate);
  const fps = state.videoFps;
  const frameCount = Math.max(1, Math.round(state.clipSeconds * fps));
  const extension = state.videoFormat === "webm" ? "webm" : "mkv";
  const audioPath = "clip-audio.wav";
  const outputPath = `ffmpeg-lab-telemetry.${extension}`;
  const framePaths = [];
  appendLog("Rendering telemetry clip through ffmpeg…");
  await ffmpeg.writeFile(audioPath, audioBytes);
  try {
    for (let index = 0; index < frameCount; index += 1) {
      const filename = `frame-${String(index + 1).padStart(3, "0")}.ppm`;
      framePaths.push(filename);
      const ppm = createTelemetryFrame(state.telemetryHistory, {
        width: 320,
        height: 180,
        frameIndex: index,
        totalFrames: frameCount,
      });
      await ffmpeg.writeFile(filename, ppm);
    }
    const exitCode = await ffmpeg.exec(buildFfmpegVideoArgs({
      fps,
      framePattern: "frame-%03d.ppm",
      audioPath,
      outputPath,
      format: state.videoFormat,
    }));
    if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
    const outputBytes = await ffmpeg.readFile(outputPath);
    const filename = `ffmpeg-lab-telemetry-${Date.now()}.${extension}`;
    downloadBytes(outputBytes, filename, state.videoFormat === "webm" ? "video/webm" : "video/x-matroska");
    state.lastExportName = filename;
    announce("FFmpeg telemetry clip exported.");
  } finally {
    await Promise.allSettled([
      ffmpeg.deleteFile(audioPath),
      ffmpeg.deleteFile(outputPath),
      ...framePaths.map((path) => ffmpeg.deleteFile(path)),
    ]);
    updateUi();
  }
}

function resetLab() {
  state.backlog.length = 0;
  state.activeChunk = null;
  state.droppedChunks = 0;
  state.processMs = NaN;
  state.inputMeter = 0;
  state.outputMeter = 0;
  state.telemetryHistory = [];
  state.outputHistory = [];
  state.scheduledTime = audioContext?.currentTime || 0;
  currentChunk = [];
  currentChunkFrames = 0;
  for (const source of activeSources) {
    try {
      source.stop();
    } catch {
      // Already stopped sources can throw.
    }
  }
  activeSources = new Set();
  choosePreset(FFMPEG_LAB_DEFAULTS.presetId);
  state.inputLevel = FFMPEG_LAB_DEFAULTS.inputLevel;
  state.outputLevel = FFMPEG_LAB_DEFAULTS.outputLevel;
  state.chunkMs = FFMPEG_LAB_DEFAULTS.chunkMs;
  state.maxQueue = FFMPEG_LAB_DEFAULTS.maxQueue;
  state.clipSeconds = FFMPEG_LAB_DEFAULTS.clipSeconds;
  state.videoFps = FFMPEG_LAB_DEFAULTS.videoFps;
  state.videoFormat = FFMPEG_LAB_DEFAULTS.videoFormat;
  $("inputLevel").value = String(state.inputLevel);
  $("outputLevel").value = String(state.outputLevel);
  $("chunkMs").value = String(state.chunkMs);
  $("queueDepth").value = String(state.maxQueue);
  $("clipSeconds").value = String(state.clipSeconds);
  $("videoFps").value = String(state.videoFps);
  $("videoFormat").value = state.videoFormat;
  persistState();
  announce("FFmpeg Lab reset to its default prototype state.");
  updateUi();
}

function bindEvents() {
  $("audioButton").addEventListener("click", async () => {
    try {
      clearError();
      await setAudioEnabled(!state.audioOn);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  $("micButton").addEventListener("click", async () => {
    try {
      clearError();
      if (state.micOn) stopMic();
      else await startMic();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  $("loadButton").addEventListener("click", async () => {
    try {
      clearError();
      await loadFfmpeg();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  $("preset").addEventListener("change", () => {
    choosePreset($("preset").value);
  });

  $("filterGraph").addEventListener("input", () => {
    state.presetId = "custom";
    state.filterGraph = $("filterGraph").value.slice(0, 512);
    $("preset").value = "custom";
    persistState();
    updateUi();
  });

  for (const [id, key] of [
    ["inputLevel", "inputLevel"],
    ["outputLevel", "outputLevel"],
    ["chunkMs", "chunkMs"],
    ["queueDepth", "maxQueue"],
    ["clipSeconds", "clipSeconds"],
    ["videoFps", "videoFps"],
  ]) {
    $(id).addEventListener("input", () => {
      state[key] = Number($(id).value);
      if (id === "outputLevel" && masterGain && audioContext) {
        masterGain.gain.setTargetAtTime(
          state.audioOn ? levelToGain(state.outputLevel) : 0,
          audioContext.currentTime,
          0.03,
        );
      }
      persistState();
      updateUi();
    });
  }

  $("videoFormat").addEventListener("change", () => {
    state.videoFormat = $("videoFormat").value;
    persistState();
    updateUi();
  });

  $("recordVideoButton").addEventListener("click", async () => {
    try {
      clearError();
      await toggleBrowserRecording();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  $("exportVideoButton").addEventListener("click", async () => {
    try {
      clearError();
      await exportFfmpegClip();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  });

  $("resetButton").addEventListener("click", () => {
    resetLab();
  });

  globalThis.addEventListener("pagehide", () => {
    dispose();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !rafHandle) rafHandle = requestAnimationFrame(frame);
  });

  new ResizeObserver(() => {
    resizeCanvas();
  }).observe($("stageWrap"));
}

function installFfmpegTelemetry() {
  ffmpeg.on("log", ({ message }) => {
    appendLog(message);
  });
  ffmpeg.on("progress", ({ progress, time }) => {
    const percent = Number.isFinite(progress) ? `${Math.round(progress * 100)}%` : "working";
    const detail = Number.isFinite(time) ? ` · ${Math.round(time / 1_000)} ms` : "";
    state.ffmpegProgress = `${percent}${detail}`;
    updateUi();
  });
}

function applyInitialState() {
  populateMenus();
  $("preset").value = state.presetId;
  $("filterGraph").value = state.filterGraph;
  $("inputLevel").value = String(state.inputLevel);
  $("outputLevel").value = String(state.outputLevel);
  $("chunkMs").value = String(state.chunkMs);
  $("queueDepth").value = String(state.maxQueue);
  $("clipSeconds").value = String(state.clipSeconds);
  $("videoFps").value = String(state.videoFps);
  $("videoFormat").value = state.videoFormat;
  updateUi();
}

function dispose() {
  if (disposed) return;
  disposed = true;
  if (state.browserRecording) {
    try {
      state.browserRecording.recorder.stop();
    } catch {
      // Recorder may already be stopping.
    }
  }
  stopMic();
  for (const source of activeSources) {
    try {
      source.stop();
    } catch {
      // Ignore already stopped sources.
    }
  }
  activeSources.clear();
  ffmpeg.terminate();
  releaseAudioOutput?.();
  if (audioContext && audioContext.state !== "closed") {
    audioContext.close().catch(() => {});
  }
}

resizeCanvas();
installFfmpegTelemetry();
applyInitialState();
bindEvents();
if (!rafHandle) rafHandle = requestAnimationFrame(frame);
