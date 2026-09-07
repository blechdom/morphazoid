import { FFmpeg } from "./vendor/ffmpeg-wasm/ffmpeg/index.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";
import {
  DEFAULT_SETTINGS,
  FFMPEG_CORE_VERSION,
  FFMPEG_WRAPPER_VERSION,
  MAX_QUEUED_CHUNKS,
  OVERLAP_SECONDS,
  RECIPES,
  bytesToFloat32,
  createFfmpegCommand,
  createFilterGraph,
  downsampleWaveform,
  encodeMonoWav,
  float32ToBytes,
  pushBoundedQueue,
  recipeForId,
  sanitizeSettings,
} from "./src/ffmpeg-wasm.js";

const CORE_CDN_ROOT = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;
const CORE_ASSETS = Object.freeze({
  script: Object.freeze({
    url: `${CORE_CDN_ROOT}/ffmpeg-core.js`,
    type: "text/javascript",
    bytes: 111_804,
    sha256: "67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3",
  }),
  wasm: Object.freeze({
    url: `${CORE_CDN_ROOT}/ffmpeg-core.wasm`,
    type: "application/wasm",
    bytes: 32_232_419,
    sha256: "9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7",
  }),
});
const CAPTURE_WORKLET_URL = new URL("./src/ffmpeg-wasm-capture-processor.js", import.meta.url).href;
const PROCESS_TIMEOUT_MS = 15_000;
const PROCESS_WATCHDOG_MS = 20_000;
const PROCESS_WATCHDOG_MESSAGE = "FFmpeg worker stopped responding.";
const ENGINE_LOAD_TIMEOUT_MS = 90_000;
const START_LEAD_SECONDS = 0.045;
const WAVEFORM_POINTS = 128;

const byId = (id) => document.getElementById(id);
const ui = Object.freeze({
  audioButton: byId("audioButton"),
  audioState: byId("audioState"),
  outputLevel: byId("outputLevel"),
  outputLevelOut: byId("outputLevelOut"),
  loadEngineButton: byId("loadEngineButton"),
  micButton: byId("micButton"),
  micButtonLabel: byId("micButtonLabel"),
  micButtonHint: byId("micButtonHint"),
  resetButton: byId("resetButton"),
  recipeSelect: byId("recipeSelect"),
  recipeDescription: byId("recipeDescription"),
  recipeSummary: byId("recipeSummary"),
  commandPreview: byId("commandPreview"),
  chunkSeconds: byId("chunkSeconds"),
  windowSummary: byId("windowSummary"),
  runSummary: byId("runSummary"),
  audioError: byId("audioError"),
  liveStatus: byId("liveStatus"),
  inputReadout: byId("inputReadout"),
  engineReadout: byId("engineReadout"),
  outputReadout: byId("outputReadout"),
  windowMetric: byId("windowMetric"),
  queueMetric: byId("queueMetric"),
  processMetric: byId("processMetric"),
  latencyMetric: byId("latencyMetric"),
  completeMetric: byId("completeMetric"),
  dropMetric: byId("dropMetric"),
  downloadLast: byId("downloadLast"),
  signalCanvas: byId("signalCanvas"),
  inputStage: document.querySelector('[data-pipeline="input"]'),
  engineStage: document.querySelector('[data-pipeline="engine"]'),
  outputStage: document.querySelector('[data-pipeline="output"]'),
});

let settings = sanitizeSettings(DEFAULT_SETTINGS);
let audioContext = null;
let playbackBus = null;
let masterGain = null;
let limiter = null;
let outputAnalyser = null;
let releaseAudioOutput = null;
let audioEnabled = false;
let workletLoadPromise = null;

let stream = null;
const pendingStreams = new Map();
let micSource = null;
let inputAnalyser = null;
let captureNode = null;
let silentPullGain = null;
let micStarting = false;
let lifecycleGeneration = 0;

let ffmpeg = null;
let loadingFfmpeg = null;
let engineLoadPromise = null;
let engineState = "idle";
let engineLog = "";
let engineDownloadController = null;

let queue = [];
let processing = false;
let jobCounter = 0;
let nextPlaybackTime = 0;
const scheduledSources = new Set();

let inputWaveform = new Float32Array(WAVEFORM_POINTS);
let outputWaveform = new Float32Array(WAVEFORM_POINTS);
let downloadUrl = "";
let animationFrame = 0;
let lastDrawTime = 0;
let disposed = false;

const stats = {
  processingMs: null,
  latencyMs: null,
  completed: 0,
  dropped: 0,
};

function setError(message = "") {
  ui.audioError.textContent = message;
  ui.audioError.hidden = !message;
}

function announce(message) {
  ui.liveStatus.textContent = message;
}

function withTimeout(promise, delayMs, message) {
  let timeoutId = 0;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), delayMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser cannot verify the downloaded FFmpeg core.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function downloadVerifiedCoreAsset(asset, signal) {
  const response = await fetch(asset.url, {
    cache: "force-cache",
    credentials: "omit",
    mode: "cors",
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Core download failed with HTTP ${response.status}.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.bytes) {
    throw new Error("Downloaded FFmpeg core has an unexpected size.");
  }
  const digest = await sha256Hex(bytes);
  if (digest !== asset.sha256) {
    throw new Error("Downloaded FFmpeg core failed its integrity check.");
  }
  return new Blob([bytes], { type: asset.type });
}

async function createCoreObjectUrls(signal) {
  const [scriptBlob, wasmBlob] = await Promise.all([
    downloadVerifiedCoreAsset(CORE_ASSETS.script, signal),
    downloadVerifiedCoreAsset(CORE_ASSETS.wasm, signal),
  ]);
  let coreURL = "";
  try {
    coreURL = URL.createObjectURL(scriptBlob);
    return {
      coreURL,
      wasmURL: URL.createObjectURL(wasmBlob),
    };
  } catch (error) {
    if (coreURL) URL.revokeObjectURL(coreURL);
    throw error;
  }
}

function revokeCoreObjectUrls(urls) {
  for (const url of Object.values(urls ?? {})) {
    if (typeof url === "string" && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
}

function formatEngineState() {
  if (engineState === "loading") return "loading core...";
  if (engineState === "ready") return `ready / core ${FFMPEG_CORE_VERSION}`;
  if (engineState === "error") return "load failed / retry";
  return "not loaded";
}

function updateTelemetry() {
  ui.windowMetric.textContent = `${settings.chunkSeconds.toFixed(2)} s`;
  ui.queueMetric.textContent = `${queue.length} / ${MAX_QUEUED_CHUNKS}`;
  ui.processMetric.textContent = stats.processingMs === null ? "-- ms" : `${Math.round(stats.processingMs)} ms`;
  ui.latencyMetric.textContent = stats.latencyMs === null ? "-- ms" : `${Math.round(stats.latencyMs)} ms`;
  ui.completeMetric.textContent = String(stats.completed);
  ui.dropMetric.textContent = String(stats.dropped);
}

function updateUi() {
  const micActive = Boolean(stream);
  const captureActive = micActive && audioEnabled;
  ui.audioButton.setAttribute("aria-pressed", String(audioEnabled));
  ui.audioState.textContent = audioEnabled ? "on" : "off";
  ui.outputLevelOut.textContent = `${Math.round(settings.outputLevel * 100)}%`;
  ui.outputLevel.value = String(settings.outputLevel);

  ui.loadEngineButton.disabled = engineState === "loading";
  ui.loadEngineButton.textContent = engineState === "ready"
    ? `FFmpeg ${FFMPEG_CORE_VERSION} ready`
    : engineState === "loading"
      ? "Loading FFmpeg..."
      : "Preload FFmpeg · 32 MB";

  ui.micButton.disabled = false;
  ui.micButton.setAttribute("aria-pressed", String(micActive));
  const micLabel = micStarting
    ? "Cancel microphone"
    : micActive
      ? "Turn off microphone"
      : "Turn on microphone";
  const micHint = micStarting
    ? engineState === "loading"
      ? "Loading FFmpeg"
      : "Waiting for permission"
    : micActive
      ? audioEnabled
        ? `${settings.chunkSeconds.toFixed(1)} s windows live`
        : "Audio off · capture paused"
      : audioEnabled
        ? "Browser asks permission"
        : "First turn on Audio above";
  ui.micButtonLabel.textContent = micLabel;
  ui.micButtonHint.textContent = micHint;
  ui.micButton.setAttribute("aria-label", `${micLabel}. ${micHint}.`);

  ui.runSummary.textContent = micStarting
    ? "preparing"
    : micActive
      ? !audioEnabled
        ? "paused / Audio off"
        : processing
        ? `processing / ${queue.length} waiting`
        : "capturing"
      : audioEnabled
        ? "ready"
        : "Audio first";

  const recipe = recipeForId(settings.recipe);
  ui.recipeSummary.textContent = recipe.label.toLowerCase();
  ui.recipeDescription.textContent = recipe.description;
  ui.commandPreview.textContent = createFilterGraph(settings);
  ui.windowSummary.textContent = `${settings.chunkSeconds.toFixed(1)} s / queue ${MAX_QUEUED_CHUNKS}`;

  ui.inputReadout.textContent = micStarting
    ? "requesting permission"
    : captureActive
      ? `capturing ${settings.chunkSeconds.toFixed(1)} s mono windows`
      : micActive
        ? "permission active / capture paused"
        : "microphone off";
  ui.engineReadout.textContent = processing
    ? `running ${recipe.id} / ${queue.length} waiting`
    : engineLog || formatEngineState();
  const outputActive = audioEnabled && scheduledSources.size > 0;
  ui.outputReadout.textContent = audioEnabled
    ? outputActive
      ? "crossfaded processed PCM"
      : stats.completed
        ? "ready / no active window"
        : "armed / waiting for first window"
    : "muted";

  ui.inputStage.dataset.active = String(captureActive);
  ui.engineStage.dataset.active = String(processing || engineState === "loading");
  ui.outputStage.dataset.active = String(outputActive);
  updateTelemetry();
}

function createAudioGraph() {
  if (audioContext) return audioContext;
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("This browser does not provide Web Audio.");

  audioContext = new AudioContextConstructor({ latencyHint: "interactive" });
  playbackBus = audioContext.createGain();
  masterGain = audioContext.createGain();
  limiter = audioContext.createDynamicsCompressor();
  outputAnalyser = audioContext.createAnalyser();

  playbackBus.gain.value = 1;
  masterGain.gain.value = 0;
  limiter.threshold.value = -3;
  limiter.knee.value = 4;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;
  outputAnalyser.fftSize = 2048;
  outputAnalyser.smoothingTimeConstant = 0.65;

  playbackBus.connect(masterGain);
  masterGain.connect(limiter);
  limiter.connect(outputAnalyser);
  releaseAudioOutput = connectAudioOutput(audioContext, outputAnalyser);
  return audioContext;
}

function rampMaster(target, duration = 0.035) {
  if (!audioContext || !masterGain) return;
  const now = audioContext.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(target, now + duration);
}

async function enableAudio() {
  setError("");
  let context;
  try {
    context = createAudioGraph();
    if (context.state !== "running") {
      unlockAudioContext(context);
      await context.resume();
    }
  } catch (error) {
    setError(error?.message || "Audio could not start.");
    announce("Audio could not start.");
    return false;
  }
  audioEnabled = true;
  if (stream) configureCaptureWorklet("start");
  rampMaster(settings.outputLevel);
  updateUi();
  announce("Audio is on. Now turn on the microphone.");
  return true;
}

function stopScheduledPlayback({ fadeSeconds = 0 } = {}) {
  const now = audioContext?.currentTime ?? 0;
  for (const playback of [...scheduledSources]) {
    const { source, envelope } = playback;
    if (fadeSeconds > 0 && audioContext?.state === "running") {
      const stopAt = now + fadeSeconds;
      try {
        if (typeof envelope.gain.cancelAndHoldAtTime === "function") {
          envelope.gain.cancelAndHoldAtTime(now);
        } else {
          envelope.gain.cancelScheduledValues(now);
          envelope.gain.setValueAtTime(envelope.gain.value, now);
        }
        envelope.gain.linearRampToValueAtTime(0, stopAt);
        source.stop(stopAt + 0.005);
        continue;
      } catch {
        // Fall through to immediate cleanup if the source has already ended.
      }
    }
    try {
      source.stop();
    } catch {
      // A source may already have ended.
    }
    try {
      source.disconnect();
      envelope.disconnect();
    } catch {
      // The context may already be closed.
    }
    scheduledSources.delete(playback);
  }
  nextPlaybackTime = now;
}

async function disableAudio({ announceChange = true } = {}) {
  if (!audioContext) {
    audioEnabled = false;
    updateUi();
    return;
  }
  if (micStarting) {
    stopMicrophone({ message: "Microphone start canceled because Audio was turned off." });
  }
  audioEnabled = false;
  lifecycleGeneration += 1;
  stats.dropped += queue.length;
  queue = [];
  configureCaptureWorklet("stop");
  rampMaster(0, 0.025);
  stopScheduledPlayback({ fadeSeconds: 0.025 });
  updateUi();
  if (announceChange) {
    announce(stream
      ? "Audio is off. Microphone permission remains active, but capture is paused."
      : "Audio is off.");
  }
  await new Promise((resolve) => window.setTimeout(resolve, 45));
  if (!audioEnabled && audioContext.state === "running") {
    await audioContext.suspend().catch(() => {});
  }
}

async function toggleAudio() {
  if (audioEnabled) await disableAudio();
  else await enableAudio();
}

function configureCaptureWorklet(type = "configure") {
  if (!captureNode || !audioContext) return;
  captureNode.port.postMessage({
    type,
    chunkFrames: Math.round(audioContext.sampleRate * settings.chunkSeconds),
    overlapFrames: Math.round(audioContext.sampleRate * OVERLAP_SECONDS),
  });
}

async function ensureCaptureWorklet() {
  const context = createAudioGraph();
  if (!context.audioWorklet?.addModule) {
    throw new Error("This browser does not support AudioWorklet microphone capture.");
  }
  if (!workletLoadPromise) {
    workletLoadPromise = context.audioWorklet.addModule(CAPTURE_WORKLET_URL).catch((error) => {
      workletLoadPromise = null;
      throw error;
    });
  }
  await workletLoadPromise;
}

async function ensureEngine() {
  if (ffmpeg?.loaded) return ffmpeg;
  if (engineLoadPromise) return engineLoadPromise;

  engineState = "loading";
  engineLog = "";
  setError("");
  updateUi();
  announce(
    `Downloading and verifying FFmpeg core ${FFMPEG_CORE_VERSION}. `
    + "Microphone audio is not uploaded.",
  );

  const candidate = new FFmpeg();
  candidate.on("log", ({ message }) => {
    const trimmed = String(message ?? "").trim();
    if (!trimmed) return;
    engineLog = trimmed.length > 56 ? `${trimmed.slice(0, 53)}...` : trimmed;
    updateUi();
  });

  const downloadController = new AbortController();
  let candidateCoreObjectUrls = null;
  engineDownloadController = downloadController;
  loadingFfmpeg = candidate;
  const loadCandidate = async () => {
    candidateCoreObjectUrls = await createCoreObjectUrls(downloadController.signal);
    return candidate.load(candidateCoreObjectUrls);
  };
  engineLoadPromise = withTimeout(
    loadCandidate(),
    ENGINE_LOAD_TIMEOUT_MS,
    "FFmpeg core download or load timed out.",
  ).then(() => {
    if (disposed) {
      candidate.terminate();
      throw new Error("The page was closed while FFmpeg was loading.");
    }
    revokeCoreObjectUrls(candidateCoreObjectUrls);
    candidateCoreObjectUrls = null;
    loadingFfmpeg = null;
    ffmpeg = candidate;
    engineState = "ready";
    engineLog = "";
    updateUi();
    announce(`FFmpeg core ${FFMPEG_CORE_VERSION} is ready in its browser worker.`);
    return candidate;
  }).catch((error) => {
    downloadController.abort();
    revokeCoreObjectUrls(candidateCoreObjectUrls);
    candidateCoreObjectUrls = null;
    candidate.terminate();
    if (loadingFfmpeg === candidate) loadingFfmpeg = null;
    if (!disposed) {
      engineState = "error";
      const message = error?.message || String(error) || "FFmpeg core could not load.";
      setError(`FFmpeg core could not load: ${message}`);
      announce("FFmpeg core failed to load. You can retry.");
      updateUi();
    }
    throw error;
  }).finally(() => {
    if (engineDownloadController === downloadController) {
      engineDownloadController = null;
    }
    engineLoadPromise = null;
    if (loadingFfmpeg === candidate) loadingFfmpeg = null;
  });

  return engineLoadPromise;
}

function disposeMicNodes() {
  try {
    if (captureNode) {
      captureNode.port.onmessage = null;
      captureNode.port.postMessage({ type: "dispose" });
      captureNode.port.close?.();
    }
  } catch {
    // Teardown is best-effort.
  }
  for (const node of [micSource, inputAnalyser, captureNode, silentPullGain]) {
    try {
      node?.disconnect();
    } catch {
      // Teardown is best-effort.
    }
  }
  micSource = null;
  inputAnalyser = null;
  captureNode = null;
  silentPullGain = null;
}

function stopTracks(mediaStream) {
  for (const track of mediaStream?.getTracks?.() ?? []) {
    track.onended = null;
    track.stop();
  }
}

function stopMicrophone({ message = "Microphone stopped.", clearError = true } = {}) {
  lifecycleGeneration += 1;
  micStarting = false;
  queue = [];
  const activeStream = stream;
  for (const pendingStream of pendingStreams.values()) {
    if (pendingStream !== activeStream) stopTracks(pendingStream);
  }
  pendingStreams.clear();
  if (activeStream) stopTracks(activeStream);
  stream = null;
  disposeMicNodes();
  stopScheduledPlayback({ fadeSeconds: audioEnabled ? 0.02 : 0 });
  if (clearError) setError("");
  updateUi();
  announce(message);
}

function handleCapturedChunk(data) {
  if (!stream || !data || data.type !== "chunk") return;
  const transferred = data.samples;
  const samples = transferred instanceof Float32Array
    ? transferred
    : new Float32Array(transferred ?? 0);
  if (!samples.length || samples.length > Math.ceil(data.sampleRate * 2.01)) {
    stats.dropped += 1;
    updateUi();
    return;
  }

  inputWaveform = downsampleWaveform(samples, WAVEFORM_POINTS);
  const job = Object.freeze({
    id: jobCounter,
    generation: lifecycleGeneration,
    sequence: Number(data.sequence) || 0,
    sampleRate: Number(data.sampleRate) || audioContext.sampleRate,
    capturedAt: performance.now()
      - (samples.length / (Number(data.sampleRate) || audioContext.sampleRate)) * 1000,
    samples,
    settings,
  });
  jobCounter += 1;

  const bounded = pushBoundedQueue(queue, job, MAX_QUEUED_CHUNKS);
  queue = [...bounded.queue];
  stats.dropped += bounded.dropped.length;
  updateUi();
  void processQueue();
}

async function deleteVirtualFile(client, filename) {
  try {
    await client.deleteFile(filename);
  } catch {
    // The output file may not exist after a failed command.
  }
}

function scheduleProcessedAudio(samples, sampleRate, job) {
  if (!audioContext || !playbackBus || !audioEnabled || job.generation !== lifecycleGeneration) return;
  if (!samples.length) return;

  const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = audioContext.createBufferSource();
  const envelope = audioContext.createGain();
  source.buffer = buffer;
  source.connect(envelope);
  envelope.connect(playbackBus);

  const duration = buffer.duration;
  const overlap = Math.min(OVERLAP_SECONDS, duration * 0.2);
  const earliest = audioContext.currentTime + START_LEAD_SECONDS;
  const startAt = Math.max(earliest, nextPlaybackTime - overlap);
  const endAt = startAt + duration;
  const fade = Math.min(overlap, duration * 0.18);

  envelope.gain.setValueAtTime(0, startAt);
  envelope.gain.linearRampToValueAtTime(1, startAt + fade);
  envelope.gain.setValueAtTime(1, Math.max(startAt + fade, endAt - fade));
  envelope.gain.linearRampToValueAtTime(0, endAt);
  source.start(startAt);
  source.stop(endAt + 0.01);
  nextPlaybackTime = endAt;

  const playback = Object.freeze({ source, envelope });
  scheduledSources.add(playback);
  source.onended = () => {
    scheduledSources.delete(playback);
    try {
      source.disconnect();
      envelope.disconnect();
    } catch {
      // Source graph already released.
    }
    updateUi();
  };

  stats.latencyMs = performance.now() - job.capturedAt
    + Math.max(0, startAt - audioContext.currentTime) * 1000;
}

function exposeDownload(samples, sampleRate) {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  const wav = encodeMonoWav(samples, sampleRate);
  downloadUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  ui.downloadLast.href = downloadUrl;
  ui.downloadLast.hidden = false;
}

async function processJob(job) {
  const client = await ensureEngine();
  const nonce = `${job.generation}-${job.id}-${job.sequence}`;
  const inputName = `mic-${nonce}.f32`;
  const outputName = `processed-${nonce}.f32`;
  const command = createFfmpegCommand({
    inputName,
    outputName,
    sampleRate: job.sampleRate,
    settings: job.settings,
  });
  const startedAt = performance.now();
  const runTransaction = async () => {
    try {
      await client.writeFile(inputName, float32ToBytes(job.samples));
      const exitCode = await client.exec([...command], PROCESS_TIMEOUT_MS);
      if (exitCode !== 0) throw new Error(`FFmpeg exited with status ${exitCode}.`);
      const outputBytes = await client.readFile(outputName);
      const maximumBytes = Math.ceil(job.sampleRate * 2.05) * 4;
      if (!(outputBytes instanceof Uint8Array)
        || outputBytes.byteLength === 0
        || outputBytes.byteLength % 4 !== 0
        || outputBytes.byteLength > maximumBytes) {
        throw new Error("FFmpeg returned an invalid or unbounded PCM window.");
      }
      return bytesToFloat32(outputBytes, Math.ceil(job.sampleRate * 2.05));
    } finally {
      await Promise.all([
        deleteVirtualFile(client, inputName),
        deleteVirtualFile(client, outputName),
      ]);
    }
  };

  let processedSamples;
  try {
    processedSamples = await withTimeout(
      runTransaction(),
      PROCESS_WATCHDOG_MS,
      PROCESS_WATCHDOG_MESSAGE,
    );
  } catch (error) {
    if (error?.message === PROCESS_WATCHDOG_MESSAGE) {
      try {
        client.terminate();
      } catch {
        // The worker may already have failed.
      }
      if (ffmpeg === client) ffmpeg = null;
      if (loadingFfmpeg === client) loadingFfmpeg = null;
      engineState = "error";
      engineLog = "";
      updateUi();
    }
    throw error;
  }

  if (job.generation !== lifecycleGeneration || !stream) {
    stats.dropped += 1;
    return;
  }
  stats.processingMs = performance.now() - startedAt;
  stats.completed += 1;
  outputWaveform = downsampleWaveform(processedSamples, WAVEFORM_POINTS);
  scheduleProcessedAudio(processedSamples, job.sampleRate, job);
  exposeDownload(processedSamples, job.sampleRate);
  setError("");
  if (stats.completed === 1) announce(
    `Processed window ${stats.completed} with ${recipeForId(job.settings.recipe).label}; `
    + `${Math.round(stats.processingMs)} milliseconds in FFmpeg.`,
  );
}

async function processQueue() {
  if (processing || disposed) return;
  processing = true;
  updateUi();
  try {
    while (queue.length && !disposed) {
      const [job, ...rest] = queue;
      queue = rest;
      updateUi();
      try {
        await processJob(job);
      } catch (error) {
        if (!disposed && job.generation === lifecycleGeneration) {
          stats.dropped += 1;
          const message = error?.message || String(error) || "FFmpeg processing failed.";
          setError(`Window ${job.sequence + 1} failed: ${message}`);
          announce("One FFmpeg window failed; capture will continue.");
        }
      }
    }
  } finally {
    processing = false;
    updateUi();
  }
}

async function startMicrophone() {
  if (micStarting || stream) return;
  if (!audioEnabled) {
    const message = "Audio is off \u2014 turn it on to hear playback. Use Audio above, then turn on the microphone.";
    setError(message);
    announce(message);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setError("Microphone capture is unavailable in this browser or insecure context.");
    announce("Microphone capture is unavailable.");
    return;
  }

  setError("");
  micStarting = true;
  const requestGeneration = ++lifecycleGeneration;
  updateUi();
  announce("Requesting microphone permission.");

  let requestedStream;
  try {
    requestedStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    pendingStreams.set(requestGeneration, requestedStream);
    if (requestGeneration !== lifecycleGeneration || !audioEnabled || document.hidden || disposed) {
      stopTracks(requestedStream);
      pendingStreams.delete(requestGeneration);
      return;
    }

    await Promise.all([ensureCaptureWorklet(), ensureEngine()]);
    if (requestGeneration !== lifecycleGeneration || !audioEnabled || document.hidden || disposed) {
      stopTracks(requestedStream);
      pendingStreams.delete(requestGeneration);
      return;
    }

    const context = createAudioGraph();
    micSource = context.createMediaStreamSource(requestedStream);
    inputAnalyser = context.createAnalyser();
    inputAnalyser.fftSize = 2048;
    inputAnalyser.smoothingTimeConstant = 0.55;
    captureNode = new AudioWorkletNode(context, "morphazoid-ffmpeg-wasm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
    });
    silentPullGain = context.createGain();
    silentPullGain.gain.value = 0;

    micSource.connect(inputAnalyser);
    inputAnalyser.connect(captureNode);
    captureNode.connect(silentPullGain);
    silentPullGain.connect(playbackBus);
    captureNode.port.onmessage = ({ data }) => handleCapturedChunk(data);

    stream = requestedStream;
    pendingStreams.delete(requestGeneration);
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (stream) stopMicrophone({ message: "The microphone device stopped." });
      };
    }
    micStarting = false;
    configureCaptureWorklet("start");
    updateUi();
    announce(
      `Microphone on. ${settings.chunkSeconds.toFixed(1)} second windows; ${recipeForId(settings.recipe).label}.`,
    );
  } catch (error) {
    if (requestedStream && requestedStream !== stream) stopTracks(requestedStream);
    pendingStreams.delete(requestGeneration);
    if (requestGeneration === lifecycleGeneration && !disposed) {
      disposeMicNodes();
      micStarting = false;
      const message = error?.name === "NotAllowedError"
        ? "Microphone permission was denied. Nothing was captured."
        : error?.message || "The microphone could not start.";
      setError(message);
      announce(message);
      updateUi();
    }
  }
}

async function toggleMicrophone() {
  if (micStarting) {
    stopMicrophone({ message: "Microphone start canceled." });
  } else if (stream) stopMicrophone();
  else await startMicrophone();
}

function applySettings(nextSettings, { reset = false } = {}) {
  settings = sanitizeSettings(nextSettings);
  ui.recipeSelect.value = settings.recipe;
  ui.chunkSeconds.value = String(settings.chunkSeconds);
  configureCaptureWorklet();
  if (audioEnabled) rampMaster(settings.outputLevel, 0.025);
  updateUi();
  if (reset) {
    announce(stream
      ? "Controls reset. The microphone keeps running; the next window uses the defaults."
      : "Controls reset.");
  }
}

function drawWaveform(context, values, top, height, color, glow) {
  if (!values.length) return;
  const width = context.canvas.width;
  const center = top + height / 2;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, window.devicePixelRatio || 1);
  context.shadowColor = color;
  context.shadowBlur = glow;
  context.beginPath();
  for (let index = 0; index < values.length; index += 1) {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = center - values[index] * height * 0.4;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
}

function drawMonitor(timestamp = 0) {
  animationFrame = requestAnimationFrame(drawMonitor);
  if (timestamp - lastDrawTime < 1000 / 24) return;
  lastDrawTime = timestamp;
  const canvas = ui.signalCanvas;
  if (!canvas || canvas.offsetParent === null) return;
  const rectangle = canvas.getBoundingClientRect();
  const ratio = Math.min(1.5, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rectangle.width * ratio));
  const height = Math.max(1, Math.floor(rectangle.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(3, 10, 9, 0.18)";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(183, 255, 74, 0.09)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();

  drawWaveform(context, inputWaveform, 0, height / 2, "#b7ff4a", 7 * ratio);
  drawWaveform(context, outputWaveform, height / 2, height / 2, "#49e7da", 7 * ratio);

  if (stream) {
    const phase = (timestamp * 0.00013) % 1;
    const x = phase * width;
    context.fillStyle = processing ? "#ff5eaa" : "#b7ff4a";
    context.fillRect(x, 0, Math.max(1, ratio), height);
  }
}

async function dispose() {
  if (disposed) return;
  disposed = true;
  lifecycleGeneration += 1;
  cancelAnimationFrame(animationFrame);
  queue = [];
  stopScheduledPlayback();
  const activeStream = stream;
  for (const pendingStream of pendingStreams.values()) {
    if (pendingStream !== activeStream) stopTracks(pendingStream);
  }
  pendingStreams.clear();
  if (activeStream) stopTracks(activeStream);
  stream = null;
  disposeMicNodes();
  engineDownloadController?.abort();
  engineDownloadController = null;
  loadingFfmpeg?.terminate();
  loadingFfmpeg = null;
  ffmpeg?.terminate();
  ffmpeg = null;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = "";
  releaseAudioOutput?.();
  releaseAudioOutput = null;
  try {
    await audioContext?.close();
  } catch {
    // The context may already be closed.
  }
  audioContext = null;
}

for (const recipe of RECIPES) {
  const option = document.createElement("option");
  option.value = recipe.id;
  option.textContent = recipe.label;
  ui.recipeSelect.append(option);
}

ui.audioButton.addEventListener("click", () => {
  void toggleAudio();
});
ui.loadEngineButton.addEventListener("click", () => {
  void ensureEngine().catch(() => {});
});
ui.micButton.addEventListener("click", () => {
  void toggleMicrophone();
});
ui.outputLevel.addEventListener("input", () => {
  applySettings({ ...settings, outputLevel: Number(ui.outputLevel.value) });
});
ui.recipeSelect.addEventListener("change", () => {
  applySettings({ ...settings, recipe: ui.recipeSelect.value });
  announce(`${recipeForId(settings.recipe).label} will begin with the next captured window.`);
});
ui.chunkSeconds.addEventListener("change", () => {
  applySettings({ ...settings, chunkSeconds: Number(ui.chunkSeconds.value) });
  announce(`${settings.chunkSeconds.toFixed(1)} second capture windows begin now.`);
});
ui.resetButton.addEventListener("click", () => {
  applySettings(DEFAULT_SETTINGS, { reset: true });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  if (stream || micStarting) {
    stopMicrophone({ message: "Microphone stopped because the page was hidden." });
  }
  if (audioEnabled) void disableAudio({ announceChange: false });
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (stream || micStarting) {
      stopMicrophone({ message: "Microphone stopped while the page is cached." });
    }
    if (audioEnabled) void disableAudio({ announceChange: false });
    return;
  }
  void dispose();
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted || disposed || animationFrame) return;
  updateUi();
  animationFrame = requestAnimationFrame(drawMonitor);
});

applySettings(DEFAULT_SETTINGS);
updateUi();
animationFrame = requestAnimationFrame(drawMonitor);

window.MorphazoidFfmpegWasmLab = Object.freeze({
  versions: Object.freeze({
    wrapper: FFMPEG_WRAPPER_VERSION,
    core: FFMPEG_CORE_VERSION,
  }),
  snapshot: () => Object.freeze({
    audioEnabled,
    micActive: Boolean(stream),
    engineState,
    processing,
    queueDepth: queue.length,
    maxQueueDepth: MAX_QUEUED_CHUNKS,
    ...stats,
  }),
});
