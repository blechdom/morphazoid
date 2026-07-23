import {
  MAX_THROATS,
  SPECIMENS,
  anatomyLayout,
  clamp,
  specimenState,
  throatVoiceParameters,
  waveformLevel,
} from "./src/throatazoid.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const drawing = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const DEFAULTS = Object.freeze({
  ...specimenState("triune"),
  inputTrim: 0.88,
  wet: 0.88,
  dry: 0.08,
  spread: 0.82,
  level: 0.46,
  mic: false,
  starting: false,
  recording: false,
});

const state = {
  ...DEFAULTS,
  throats: DEFAULTS.throats.map((throat) => ({ ...throat })),
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let currentLayout = anatomyLayout(900, 600, state);
let selectedThroat = 0;
let pointerDrag = null;
let audioContext = null;
let graph = null;
let mediaStream = null;
let microphoneSource = null;
let microphoneGeneration = 0;
let audioChanging = false;
let audioDirty = false;
let inputWave = new Float32Array(2048);
let outputWave = new Float32Array(2048);
let safetyWave = new Float32Array(1024);
let inputLevel = { rms: 0, peak: 0 };
let outputLevel = { rms: 0, peak: 0 };
let inputPeakHold = 0;
let hotSince = 0;
let lastMeterUpdate = 0;
let recorder = null;
let recordingStartedAt = 0;
let recordingMimeType = "";
let recordedChunks = [];
let lastTakeUrl = "";
let lastTakeDuration = 0;
let lastTakeMimeType = "";
let frameHandle = 0;

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function percentage(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatDecibels(rms) {
  const decibels = 20 * Math.log10(Math.max(0.00001, Number(rms) || 0));
  return decibels < -58 ? "silent" : `${Math.round(decibels)} dB`;
}

function specimenLabel() {
  return SPECIMENS[state.specimen]?.name ?? "Mutant";
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function showError(message) {
  $("audioError").textContent = message;
  $("audioError").hidden = false;
  $("listenSection").open = true;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function microphoneErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Microphone access was blocked. Allow it for this site, then awaken again.";
  }
  if (error?.name === "NotFoundError") return "No microphone organism was found.";
  if (error?.name === "NotReadableError") return "The microphone is occupied by another application.";
  if (error?.name === "OverconstrainedError") return "This microphone could not provide a live signal.";
  return error instanceof Error ? error.message : "The microphone could not awaken.";
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

function releaseMicrophone() {
  try {
    microphoneSource?.disconnect();
  } catch {
    // A device-level end may have already disconnected the source.
  }
  stopStream(mediaStream);
  microphoneSource = null;
  mediaStream = null;
}

function makeSoftClipCurve(size = 4096, drive = 1.55) {
  const curve = new Float32Array(size);
  const normalization = Math.tanh(drive);
  for (let index = 0; index < size; index += 1) {
    const value = index / (size - 1) * 2 - 1;
    curve[index] = Math.tanh(value * drive) / normalization;
  }
  return curve;
}

function makeCeilingCurve(size = 4096) {
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const value = index / (size - 1) * 2 - 1;
    curve[index] = clamp(value, -0.94, 0.94);
  }
  return curve;
}

function createShaper(audio, curve) {
  if (typeof audio.createWaveShaper !== "function") return audio.createGain();
  const shaper = audio.createWaveShaper();
  shaper.curve = curve;
  shaper.oversample = "2x";
  return shaper;
}

function createPanner(audio, pan = 0) {
  if (typeof audio.createStereoPanner !== "function") return audio.createGain();
  const panner = audio.createStereoPanner();
  panner.pan.value = pan;
  return panner;
}

function connect(source, destination) {
  source.connect(destination);
  return destination;
}

function configureCompressor(compressor, now) {
  compressor.threshold?.setValueAtTime?.(-14, now);
  compressor.knee?.setValueAtTime?.(5, now);
  compressor.ratio?.setValueAtTime?.(16, now);
  compressor.attack?.setValueAtTime?.(0.003, now);
  compressor.release?.setValueAtTime?.(0.16, now);
}

function buildThroat(audio, index, wetBus) {
  const inlet = audio.createGain();
  const highpass = audio.createBiquadFilter();
  const formants = Array.from({ length: 4 }, () => audio.createBiquadFilter());
  const lowpass = audio.createBiquadFilter();
  const drive = audio.createGain();
  const shaper = createShaper(audio, makeSoftClipCurve());
  const normalGain = audio.createGain();
  const ringCarrier = audio.createGain();
  const ringDepth = audio.createGain();
  const mix = audio.createGain();
  const panner = createPanner(audio);
  const oscillator = typeof audio.createOscillator === "function" ? audio.createOscillator() : null;

  highpass.type = "highpass";
  highpass.frequency.value = 60;
  highpass.Q.value = 0.7;
  for (const filter of formants) {
    filter.type = "peaking";
    filter.frequency.value = 800;
    filter.Q.value = 5;
    filter.gain.value = 8;
  }
  lowpass.type = "lowpass";
  lowpass.frequency.value = 8_000;
  lowpass.Q.value = 0.7;
  inlet.gain.value = 0;
  drive.gain.value = 1;
  normalGain.gain.value = 1;
  ringCarrier.gain.value = 0;
  ringDepth.gain.value = 0;
  mix.gain.value = 0.72;

  connect(inlet, highpass);
  let tail = highpass;
  for (const filter of formants) tail = connect(tail, filter);
  connect(tail, lowpass);
  connect(lowpass, drive);
  connect(drive, shaper);
  connect(shaper, normalGain);
  connect(normalGain, mix);
  connect(shaper, ringCarrier);
  connect(ringCarrier, mix);
  connect(mix, panner);
  connect(panner, wetBus);

  if (oscillator) {
    oscillator.type = index % 2 ? "triangle" : "sine";
    oscillator.frequency.value = 45 + index * 17;
    oscillator.connect(ringDepth);
    ringDepth.connect(ringCarrier.gain);
    oscillator.start();
  }

  return {
    inlet,
    highpass,
    formants,
    lowpass,
    drive,
    normalGain,
    ringCarrier,
    ringDepth,
    mix,
    panner,
    oscillator,
  };
}

function buildAudioGraph(audio) {
  const input = audio.createGain();
  const highpass = audio.createBiquadFilter();
  const inputAnalyser = audio.createAnalyser();
  const dryGain = audio.createGain();
  const wetBus = audio.createGain();
  const wetGain = audio.createGain();
  const mixBus = audio.createGain();
  const sacs = Array.from({ length: 2 }, (_, index) => {
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = createPanner(audio, index === 0 ? -0.55 : 0.55);
    filter.type = "bandpass";
    filter.frequency.value = index === 0 ? 330 : 610;
    filter.Q.value = 6;
    gain.gain.value = 0;
    inputAnalyser.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(wetBus);
    return { filter, gain, panner };
  });
  const safetyAnalyser = audio.createAnalyser();
  const compressor = audio.createDynamicsCompressor();
  const ceiling = createShaper(audio, makeCeilingCurve());
  const masterGain = audio.createGain();
  const outputAnalyser = audio.createAnalyser();
  const recorderDestination = typeof audio.createMediaStreamDestination === "function"
    ? audio.createMediaStreamDestination()
    : null;

  input.gain.value = 0;
  highpass.type = "highpass";
  highpass.frequency.value = 55;
  highpass.Q.value = 0.707;
  inputAnalyser.fftSize = 2048;
  inputAnalyser.smoothingTimeConstant = 0.68;
  outputAnalyser.fftSize = 2048;
  outputAnalyser.smoothingTimeConstant = 0.7;
  safetyAnalyser.fftSize = 1024;
  safetyAnalyser.smoothingTimeConstant = 0.45;
  dryGain.gain.value = 0;
  wetGain.gain.value = 0;
  masterGain.gain.value = 0;

  connect(input, highpass);
  connect(highpass, inputAnalyser);
  connect(inputAnalyser, dryGain);
  connect(dryGain, mixBus);
  const throats = Array.from(
    { length: MAX_THROATS },
    (_, index) => buildThroat(audio, index, wetBus),
  );
  for (const throat of throats) inputAnalyser.connect(throat.inlet);
  connect(wetBus, wetGain);
  connect(wetGain, mixBus);
  connect(mixBus, safetyAnalyser);
  connect(safetyAnalyser, compressor);
  configureCompressor(compressor, audio.currentTime);
  connect(compressor, ceiling);
  connect(ceiling, masterGain);
  connect(masterGain, outputAnalyser);
  outputAnalyser.connect(audio.destination);
  if (recorderDestination) outputAnalyser.connect(recorderDestination);

  return {
    input,
    inputAnalyser,
    dryGain,
    throats,
    sacs,
    wetGain,
    safetyAnalyser,
    masterGain,
    outputAnalyser,
    recorderDestination,
  };
}

async function ensureAudioGraph() {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextClass();
    graph = buildAudioGraph(audioContext);
    inputWave = new Float32Array(graph.inputAnalyser.fftSize);
    outputWave = new Float32Array(graph.outputAnalyser.fftSize);
    safetyWave = new Float32Array(graph.safetyAnalyser.fftSize);
    audioContext.addEventListener?.("statechange", updateUi);
  }
  if (audioContext.state !== "running") await audioContext.resume();
  return audioContext;
}

function setAudioParam(parameter, value, immediate = false, timeConstant = 0.025) {
  if (!parameter || !audioContext) return;
  const now = audioContext.currentTime;
  parameter.cancelScheduledValues?.(now);
  if (immediate) parameter.setValueAtTime?.(value, now);
  else parameter.setTargetAtTime?.(value, now, timeConstant);
}

function applyAudioParameters(immediate = false) {
  if (!graph || !audioContext) return;
  const live = state.mic;
  const sampleRate = audioContext.sampleRate || 48_000;
  setAudioParam(graph.input.gain, live ? state.inputTrim : 0, immediate);
  setAudioParam(graph.dryGain.gain, live ? state.dry : 0, immediate);
  setAudioParam(graph.wetGain.gain, live ? state.wet : 0, immediate);
  setAudioParam(graph.masterGain.gain, live ? Math.sqrt(state.level) : 0, immediate);

  for (let index = 0; index < MAX_THROATS; index += 1) {
    const voice = throatVoiceParameters(state, index, sampleRate);
    const throat = graph.throats[index];
    const active = live && index < state.throatCount;
    setAudioParam(throat.inlet.gain, active ? voice.gain : 0, immediate);
    setAudioParam(throat.highpass.frequency, voice.highpass, immediate);
    setAudioParam(throat.highpass.Q, 0.68 + state.tension * 0.45, immediate);
    for (let formantIndex = 0; formantIndex < throat.formants.length; formantIndex += 1) {
      const filter = throat.formants[formantIndex];
      setAudioParam(filter.frequency, voice.formants[formantIndex], immediate);
      setAudioParam(filter.Q, voice.resonance * (1 - formantIndex * 0.08), immediate);
      setAudioParam(filter.gain, voice.peakGains[formantIndex], immediate);
    }
    setAudioParam(throat.lowpass.frequency, voice.lowpass, immediate);
    setAudioParam(throat.drive.gain, 0.72 + state.tension * 0.72 + state.mutation * 0.46, immediate);
    setAudioParam(throat.normalGain.gain, voice.normalMix, immediate);
    setAudioParam(throat.ringDepth.gain, voice.ringMix, immediate);
    setAudioParam(throat.oscillator?.frequency, voice.ringFrequency, immediate, 0.04);
    setAudioParam(throat.panner.pan, voice.pan * state.spread, immediate);
  }

  const sacFrequencies = [
    180 + (1 - state.bodyLength) * 380 + state.mutation * 95,
    430 + state.tension * 520 + state.mutation * 180,
  ];
  for (let index = 0; index < graph.sacs.length; index += 1) {
    const sac = graph.sacs[index];
    setAudioParam(sac.filter.frequency, sacFrequencies[index], immediate);
    setAudioParam(sac.filter.Q, 3.4 + state.tension * 8 + index * 1.4, immediate);
    setAudioParam(
      sac.gain.gain,
      live ? state.coupling * (index === 0 ? 0.17 : 0.12) : 0,
      immediate,
    );
    setAudioParam(sac.panner.pan, (index === 0 ? -0.5 : 0.5) * state.spread, immediate);
  }
  audioDirty = false;
}

function markAudioDirty() {
  audioDirty = true;
}

async function startMicrophone() {
  if (audioChanging || state.mic) return;
  audioChanging = true;
  state.starting = true;
  const generation = ++microphoneGeneration;
  clearError();
  updateUi();

  try {
    const audio = await ensureAudioGraph();
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error("Microphone input requires HTTPS or localhost.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      },
    });
    if (generation !== microphoneGeneration) {
      stopStream(stream);
      return;
    }
    releaseMicrophone();
    mediaStream = stream;
    microphoneSource = audio.createMediaStreamSource(stream);
    microphoneSource.connect(graph.input);
    for (const track of stream.getAudioTracks?.() ?? stream.getTracks?.() ?? []) {
      track.addEventListener?.("ended", () => {
        if (generation !== microphoneGeneration) return;
        void severAudio("Microphone disconnected.");
      }, { once: true });
    }
    state.mic = true;
    state.starting = false;
    applyAudioParameters(true);
    announce("Throatazoid awake. Drag a diamond chamber to deform its voice.");
  } catch (error) {
    if (generation === microphoneGeneration) {
      releaseMicrophone();
      state.mic = false;
      state.starting = false;
      showError(microphoneErrorMessage(error));
      announce("Throatazoid could not access the microphone.");
    }
  } finally {
    audioChanging = false;
    updateUi();
  }
}

async function severAudio(message = "Throatazoid severed.") {
  microphoneGeneration += 1;
  state.starting = false;
  state.mic = false;
  if (recorder?.state === "recording") recorder.stop();
  if (graph && audioContext) {
    setAudioParam(graph.input.gain, 0, true);
    setAudioParam(graph.masterGain.gain, 0, true);
  }
  releaseMicrophone();
  inputLevel = { rms: 0, peak: 0 };
  outputLevel = { rms: 0, peak: 0 };
  try {
    await audioContext?.suspend?.();
  } catch {
    // Some browsers reject suspension during a page lifecycle transition.
  }
  updateUi();
  announce(message);
}

function toggleMicrophone() {
  if (state.mic || state.starting) void severAudio();
  else void startMicrophone();
}

function chooseRecorderMimeType() {
  if (!globalThis.MediaRecorder) return "";
  const choices = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function recorderExtension(mimeType) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

function clearLastTake() {
  if (lastTakeUrl) URL.revokeObjectURL?.(lastTakeUrl);
  lastTakeUrl = "";
  lastTakeDuration = 0;
  lastTakeMimeType = "";
  $("lastTake").hidden = true;
  $("downloadTake").removeAttribute("href");
}

function startRecording() {
  if (!state.mic || !graph?.recorderDestination || !globalThis.MediaRecorder) return;
  clearLastTake();
  recordingMimeType = chooseRecorderMimeType();
  recordedChunks = [];
  try {
    recorder = recordingMimeType
      ? new MediaRecorder(graph.recorderDestination.stream, { mimeType: recordingMimeType })
      : new MediaRecorder(graph.recorderDestination.stream);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) recordedChunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      const mimeType = recorder?.mimeType || recordingMimeType || "audio/webm";
      const blob = new Blob(recordedChunks, { type: mimeType });
      if (blob.size) {
        lastTakeMimeType = mimeType;
        lastTakeDuration = Math.max(0, performance.now() / 1000 - recordingStartedAt);
        lastTakeUrl = URL.createObjectURL(blob);
        const extension = recorderExtension(mimeType);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        $("downloadTake").href = lastTakeUrl;
        $("downloadTake").download = `throatazoid-${stamp}.${extension}`;
        $("lastTakeOut").textContent = `${formatTime(lastTakeDuration)} · ${extension.toUpperCase()}`;
        $("lastTake").hidden = false;
      }
      state.recording = false;
      recorder = null;
      updateUi();
    });
    recordingStartedAt = performance.now() / 1000;
    recorder.start();
    state.recording = true;
    announce("Recording the organism.");
    updateUi();
  } catch (error) {
    showError(error instanceof Error ? error.message : "Recording could not start.");
  }
}

function toggleRecording() {
  if (recorder?.state === "recording") {
    recorder.stop();
    return;
  }
  startRecording();
}

function applySpecimen(name) {
  const next = specimenState(name);
  state.specimen = next.specimen;
  state.throatCount = next.throatCount;
  state.bodyLength = next.bodyLength;
  state.tension = next.tension;
  state.mutation = next.mutation;
  state.coupling = next.coupling;
  state.growl = next.growl;
  state.throats = next.throats.map((throat) => ({ ...throat }));
  selectedThroat = Math.min(selectedThroat, state.throatCount - 1);
  markAudioDirty();
  updateUi();
  announce(`${SPECIMENS[name].name} specimen loaded with ${state.throatCount} throats.`);
}

function updateSelectedThroatUi() {
  selectedThroat = Math.round(clamp(selectedThroat, 0, state.throatCount - 1));
  const throat = state.throats[selectedThroat];
  $("selectedThroatName").textContent = `THROAT ${String(selectedThroat + 1).padStart(2, "0")}`;
  $("selectedAperture").value = String(throat.aperture);
  $("selectedApertureOut").textContent = percentage(throat.aperture);
  $("selectedLength").value = String(throat.length);
  $("selectedLengthOut").textContent = percentage(throat.length);
  setPressed($("muteThroatButton"), throat.muted);
  $("muteThroatButton").textContent = throat.muted ? "UNMUTE" : "MUTE";
}

function updateUi() {
  const live = state.mic;
  const starting = state.starting;
  $("audioState").textContent = live ? "on" : "off";
  setPressed($("audioButton"), live);
  setPressed($("micButton"), live);
  setPressed($("awakenButton"), live);
  $("audioButton").disabled = starting;
  $("micButton").disabled = starting;
  $("awakenButton").disabled = starting;
  $("stopButton").disabled = !live && !starting;
  $("panicButton").disabled = !live && !starting;
  $("micButtonLabel").textContent = starting ? "Listening…" : live ? "Awake" : "Awaken";
  $("micButtonHint").textContent = starting
    ? "waiting for permission"
    : live
      ? "microphone is the source"
      : "allow microphone access";
  $("awakenLabel").textContent = starting ? "Listening" : live ? "Awake" : "Awaken";

  $("level").value = String(state.level);
  $("levelOut").textContent = percentage(state.level);
  $("inputTrim").value = String(state.inputTrim);
  $("inputTrimOut").textContent = `${Math.round(state.inputTrim * 100)}%`;
  $("throatCount").value = String(state.throatCount);
  $("throatCountOut").textContent = String(state.throatCount);
  $("bodyLength").value = String(state.bodyLength);
  $("bodyLengthOut").textContent = percentage(state.bodyLength);
  $("tension").value = String(state.tension);
  $("tensionOut").textContent = percentage(state.tension);
  $("mutation").value = String(state.mutation);
  $("mutationOut").textContent = percentage(state.mutation);
  $("wet").value = String(state.wet);
  $("wetOut").textContent = percentage(state.wet);
  $("dry").value = String(state.dry);
  $("dryOut").textContent = percentage(state.dry);
  $("growl").value = String(state.growl);
  $("growlOut").textContent = percentage(state.growl);
  $("coupling").value = String(state.coupling);
  $("couplingOut").textContent = percentage(state.coupling / 0.72);
  $("spread").value = String(state.spread);
  $("spreadOut").textContent = percentage(state.spread);

  for (const button of $("specimenButtons").querySelectorAll("[data-specimen]")) {
    setPressed(button, button.dataset.specimen === state.specimen);
  }
  const name = specimenLabel();
  $("listenSummary").textContent = starting ? "requesting microphone" : live ? "organism awake" : "organism dormant";
  $("anatomySummary").textContent = `${name} · ${state.throatCount} throat${state.throatCount === 1 ? "" : "s"}`;
  $("voiceSummary").textContent = `${percentage(state.wet)} organism · ${percentage(state.dry)} human`;
  $("stateMetric").textContent = starting ? "listening" : live ? "awake" : "dormant";
  $("specimenMetric").textContent = name.toLowerCase();
  const signalState = live
    ? inputLevel.rms < 0.002
      ? "SILENT"
      : "VOCAL"
    : "DORMANT";
  $("stageReadout").textContent = `${signalState} · ${name.toUpperCase()} · ${state.throatCount} THROAT${state.throatCount === 1 ? "" : "S"}`;
  updateSelectedThroatUi();

  const canRecord = live && Boolean(graph?.recorderDestination) && Boolean(globalThis.MediaRecorder);
  $("recordButton").disabled = !canRecord;
  setPressed($("recordButton"), state.recording);
  $("recordLabel").textContent = state.recording ? "Stop recording" : "Record organism";
  $("recordHint").textContent = state.recording ? "capturing live anatomy" : "processed stereo output";
  $("recordingBadge").hidden = !state.recording;
  $("captureSummary").textContent = state.recording ? "recording" : lastTakeUrl ? "specimen captured" : "ready";
}

function resizeStage() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  const requestedRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  const pixelBudget = 3_200_000;
  pixelRatio = Math.min(
    requestedRatio,
    Math.sqrt(pixelBudget / Math.max(1, cssWidth * cssHeight)),
  );
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  currentLayout = anatomyLayout(cssWidth, cssHeight, state);
}

function pathPolygon(points) {
  drawing.beginPath();
  points.forEach((point, index) => {
    if (index === 0) drawing.moveTo(point.x, point.y);
    else drawing.lineTo(point.x, point.y);
  });
  drawing.closePath();
}

function drawDiamond(point, radius, color, fill = "#020302") {
  drawing.beginPath();
  drawing.moveTo(point.x, point.y - radius);
  drawing.lineTo(point.x + radius, point.y);
  drawing.lineTo(point.x, point.y + radius);
  drawing.lineTo(point.x - radius, point.y);
  drawing.closePath();
  drawing.fillStyle = fill;
  drawing.fill();
  drawing.strokeStyle = color;
  drawing.stroke();
}

function interpolatePoint(points, progress) {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const segmentProgress = clamp(progress) * (points.length - 1);
  const segment = Math.min(points.length - 2, Math.floor(segmentProgress));
  const local = segmentProgress - segment;
  const from = points[segment];
  const to = points[segment + 1];
  return {
    x: from.x + (to.x - from.x) * local,
    y: from.y + (to.y - from.y) * local,
  };
}

function drawVoidGeometry(time) {
  const centerX = cssWidth * 0.54;
  const centerY = cssHeight * 0.5;
  const radius = Math.min(cssWidth, cssHeight) * 0.31;
  drawing.save();
  drawing.translate(centerX, centerY);
  drawing.rotate(prefersReducedMotion ? -0.18 : time * 0.000018);
  for (let ring = 0; ring < 3; ring += 1) {
    const sides = 7 + ring * 2;
    const ringRadius = radius * (0.74 + ring * 0.31);
    drawing.beginPath();
    for (let index = 0; index < sides; index += 1) {
      const angle = index / sides * Math.PI * 2 + ring * 0.28;
      const warp = 1 + Math.sin(index * 2.31 + ring) * 0.08;
      const x = Math.cos(angle) * ringRadius * warp;
      const y = Math.sin(angle) * ringRadius * warp * 0.68;
      if (index === 0) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.closePath();
    drawing.strokeStyle = `rgba(232, 237, 223, ${0.016 + ring * 0.008})`;
    drawing.lineWidth = 1;
    drawing.stroke();
  }
  drawing.restore();
}

function gulletGeometry(layout, time) {
  const stations = 8;
  const upper = [];
  const lower = [];
  const activity = clamp(inputLevel.rms * 8);
  for (let index = 0; index < stations; index += 1) {
    const progress = index / (stations - 1);
    const x = layout.root.x + (layout.junction.x - layout.root.x) * progress;
    const base = Math.sin(progress * Math.PI);
    const jag = (index % 2 ? -1 : 1) * layout.bodyRadius * state.mutation * 0.14;
    const breath = prefersReducedMotion
      ? 0
      : Math.sin(time * 0.0022 + index * 0.9) * activity * layout.shortSide * 0.0025;
    const width = layout.shortSide * 0.012 + layout.bodyRadius * base + jag + breath;
    upper.push({ x, y: layout.centerY - width });
    lower.push({ x, y: layout.centerY + width });
  }
  return { upper, lower, polygon: [...upper, ...lower.reverse()] };
}

function drawGullet(layout, time, liveAlpha) {
  const gullet = gulletGeometry(layout, time);
  pathPolygon(gullet.polygon);
  drawing.fillStyle = "#030403";
  drawing.fill();
  drawing.strokeStyle = `rgba(232, 237, 223, ${0.28 + liveAlpha * 0.38})`;
  drawing.lineWidth = 1.15;
  drawing.stroke();

  for (let index = 1; index < gullet.upper.length - 1; index += 1) {
    drawing.beginPath();
    drawing.moveTo(gullet.upper[index].x, gullet.upper[index].y);
    drawing.lineTo(gullet.lower[gullet.lower.length - 1 - index].x, gullet.lower[gullet.lower.length - 1 - index].y);
    drawing.strokeStyle = `rgba(232, 237, 223, ${0.07 + liveAlpha * 0.05})`;
    drawing.lineWidth = 1;
    drawing.stroke();
  }

  if (state.mic && inputWave.length) {
    drawing.beginPath();
    const samples = Math.min(90, inputWave.length);
    for (let index = 0; index < samples; index += 1) {
      const progress = index / (samples - 1);
      const sample = inputWave[Math.floor(progress * (inputWave.length - 1))] || 0;
      const x = layout.root.x + (layout.junction.x - layout.root.x) * progress;
      const y = layout.centerY + sample * layout.bodyRadius * 0.62;
      if (index === 0) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.strokeStyle = `rgba(216, 255, 87, ${0.12 + liveAlpha * 0.52})`;
    drawing.lineWidth = 1;
    drawing.stroke();
  }
}

function drawSacs(layout, time, liveAlpha) {
  const sacs = [
    { x: layout.root.x + (layout.junction.x - layout.root.x) * 0.48, y: layout.centerY - layout.bodyRadius * 1.45, size: 0.72 },
    { x: layout.root.x + (layout.junction.x - layout.root.x) * 0.7, y: layout.centerY + layout.bodyRadius * 1.55, size: 0.54 },
  ];
  sacs.forEach((sac, sacIndex) => {
    const anchor = {
      x: layout.root.x + (layout.junction.x - layout.root.x) * (sacIndex ? 0.68 : 0.45),
      y: layout.centerY + (sacIndex ? 1 : -1) * layout.bodyRadius * 0.56,
    };
    drawing.beginPath();
    drawing.moveTo(anchor.x, anchor.y);
    drawing.lineTo(sac.x, sac.y);
    drawing.strokeStyle = `rgba(232, 237, 223, ${0.16 + liveAlpha * state.coupling * 0.5})`;
    drawing.lineWidth = 1;
    drawing.stroke();

    const radius = layout.bodyRadius * sac.size * (0.7 + state.coupling * 0.35);
    drawing.beginPath();
    for (let index = 0; index < 7; index += 1) {
      const angle = index / 7 * Math.PI * 2 - Math.PI / 2;
      const pulse = prefersReducedMotion
        ? 1
        : 1 + Math.sin(time * 0.0016 + sacIndex * 2 + index) * inputLevel.rms * 0.6;
      const x = sac.x + Math.cos(angle) * radius * pulse;
      const y = sac.y + Math.sin(angle) * radius * 0.72 * pulse;
      if (index === 0) drawing.moveTo(x, y);
      else drawing.lineTo(x, y);
    }
    drawing.closePath();
    drawing.fillStyle = "#030403";
    drawing.fill();
    drawing.strokeStyle = `rgba(232, 237, 223, ${0.14 + state.coupling * 0.35})`;
    drawing.stroke();
    drawDiamond(sac, 2.5, `rgba(216, 255, 87, ${0.18 + liveAlpha * state.coupling})`);
  });
}

function drawBranch(branch, liveAlpha) {
  pathPolygon(branch.polygon);
  drawing.fillStyle = branch.muted ? "rgba(3, 4, 3, 0.4)" : "#030403";
  drawing.fill();
  drawing.strokeStyle = branch.muted
    ? "rgba(105, 112, 95, 0.18)"
    : `rgba(232, 237, 223, ${0.32 + liveAlpha * 0.46})`;
  drawing.lineWidth = selectedThroat === branch.index ? 1.5 : 1;
  drawing.stroke();

  const upperJunction = branch.polygon[0];
  const upperBend = branch.polygon[1];
  const upperMouth = branch.polygon[2];
  const lowerMouth = branch.polygon[3];
  const lowerBend = branch.polygon[4];
  drawing.beginPath();
  drawing.moveTo(upperBend.x, upperBend.y);
  drawing.lineTo(lowerBend.x, lowerBend.y);
  drawing.moveTo(upperMouth.x, upperMouth.y);
  drawing.lineTo(lowerMouth.x, lowerMouth.y);
  drawing.moveTo(upperJunction.x, upperJunction.y);
  drawing.lineTo(branch.polygon[5].x, branch.polygon[5].y);
  drawing.strokeStyle = branch.muted
    ? "rgba(105, 112, 95, 0.11)"
    : `rgba(232, 237, 223, ${0.09 + liveAlpha * 0.09})`;
  drawing.lineWidth = 1;
  drawing.stroke();

  const mouthNormal = branch.normal;
  drawing.beginPath();
  drawing.moveTo(upperMouth.x, upperMouth.y);
  drawing.lineTo(
    upperMouth.x + branch.direction.x * 10 + mouthNormal.x * 3,
    upperMouth.y + branch.direction.y * 10 + mouthNormal.y * 3,
  );
  drawing.moveTo(lowerMouth.x, lowerMouth.y);
  drawing.lineTo(
    lowerMouth.x + branch.direction.x * 10 - mouthNormal.x * 3,
    lowerMouth.y + branch.direction.y * 10 - mouthNormal.y * 3,
  );
  drawing.strokeStyle = branch.muted ? "rgba(105,112,95,.18)" : "rgba(232,237,223,.52)";
  drawing.stroke();

  drawDiamond(
    branch.handle,
    selectedThroat === branch.index ? 5.5 : 4,
    selectedThroat === branch.index ? "#d8ff57" : "rgba(232, 237, 223, .62)",
    selectedThroat === branch.index ? "rgba(216,255,87,.08)" : "#020302",
  );

  if (branch.muted) {
    drawing.beginPath();
    drawing.moveTo(upperMouth.x, upperMouth.y);
    drawing.lineTo(lowerMouth.x, lowerMouth.y);
    drawing.strokeStyle = "#ff745f";
    drawing.lineWidth = 1.4;
    drawing.stroke();
  }
}

function drawPressure(layout, time, liveAlpha) {
  if (!state.mic || liveAlpha < 0.015 || prefersReducedMotion) return;
  const packetCount = 3 + Math.round(liveAlpha * 4);
  for (const branch of layout.branches) {
    if (branch.muted) continue;
    const points = [layout.root, layout.larynx, layout.junction, branch.bend, branch.mouth];
    for (let packet = 0; packet < packetCount; packet += 1) {
      const progress = (time * (0.00022 + inputLevel.rms * 0.0007) + packet / packetCount + branch.index * 0.073) % 1;
      const point = interpolatePoint(points, progress);
      const radius = 1.3 + liveAlpha * 2.6 * (1 - progress * 0.35);
      drawing.beginPath();
      drawing.moveTo(point.x, point.y - radius);
      drawing.lineTo(point.x + radius, point.y);
      drawing.lineTo(point.x, point.y + radius);
      drawing.lineTo(point.x - radius, point.y);
      drawing.closePath();
      drawing.fillStyle = `rgba(216, 255, 87, ${0.16 + liveAlpha * 0.64})`;
      drawing.shadowColor = "#d8ff57";
      drawing.shadowBlur = 5 + liveAlpha * 8;
      drawing.fill();
      drawing.shadowBlur = 0;
    }
  }
}

function drawStage(time) {
  drawing.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawing.clearRect(0, 0, cssWidth, cssHeight);
  currentLayout = anatomyLayout(cssWidth, cssHeight, state);
  const liveAlpha = clamp(inputLevel.rms * 10);
  drawVoidGeometry(time);
  drawSacs(currentLayout, time, liveAlpha);
  drawGullet(currentLayout, time, liveAlpha);
  for (const branch of currentLayout.branches) drawBranch(branch, liveAlpha);
  drawPressure(currentLayout, time, liveAlpha);

  drawDiamond(
    currentLayout.root,
    4.4,
    state.mic ? "#d8ff57" : "rgba(216,255,87,.38)",
    state.mic ? "#d8ff57" : "#020302",
  );
  drawDiamond(currentLayout.junction, 4, "rgba(232,237,223,.52)");
}

function readAnalyser(analyser, samples) {
  if (!analyser?.getFloatTimeDomainData) return { rms: 0, peak: 0 };
  analyser.getFloatTimeDomainData(samples);
  return waveformLevel(samples);
}

function updateMeters(time) {
  if (graph && state.mic) {
    inputLevel = readAnalyser(graph.inputAnalyser, inputWave);
    outputLevel = readAnalyser(graph.outputAnalyser, outputWave);
    const safety = readAnalyser(graph.safetyAnalyser, safetyWave);
    if (safety.peak > 0.96 || safety.rms > 0.54) {
      if (!hotSince) hotSince = time;
      if (time - hotSince > 900) {
        state.inputTrim = Math.max(0.18, state.inputTrim * 0.78);
        applyAudioParameters();
        showError("The organism was overfed; input hunger was reduced automatically.");
        hotSince = time + 2_000;
      }
    } else {
      hotSince = 0;
    }
  } else {
    inputLevel = { rms: inputLevel.rms * 0.82, peak: inputLevel.peak * 0.82 };
    outputLevel = { rms: outputLevel.rms * 0.82, peak: outputLevel.peak * 0.82 };
  }

  if (time - lastMeterUpdate < 70) return;
  lastMeterUpdate = time;
  const meterValue = clamp(inputLevel.rms * 5.5);
  inputPeakHold = Math.max(inputPeakHold * 0.94, clamp(inputLevel.peak * 2.8));
  $("inputMeterBar").style.width = `${meterValue * 100}%`;
  $("inputPeakMarker").style.left = `${inputPeakHold * 100}%`;
  $("stageInputMeter").style.width = `${meterValue * 100}%`;
  $("inputMeterOut").textContent = formatDecibels(inputLevel.rms);
  $("outputMetric").textContent = formatDecibels(outputLevel.rms);
  if (state.recording) {
    $("stageRecordTime").textContent = formatTime(time / 1000 - recordingStartedAt);
  }
  updateUi();
}

function frame(time) {
  if (audioDirty) applyAudioParameters();
  updateMeters(time);
  drawStage(time);
  frameHandle = requestAnimationFrame(frame);
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function nearestBranchHandle(point, maximumDistance = 42) {
  let match = null;
  let distance = maximumDistance;
  for (const branch of currentLayout.branches) {
    const nextDistance = Math.hypot(point.x - branch.handle.x, point.y - branch.handle.y);
    if (nextDistance < distance) {
      distance = nextDistance;
      match = branch;
    }
  }
  return match;
}

function showHandleReadout(branch) {
  const readout = $("handleReadout");
  $("handleName").textContent = `THROAT ${String(branch.index + 1).padStart(2, "0")}`;
  const throat = state.throats[branch.index];
  $("handleValue").textContent = `${percentage(throat.aperture)} OPEN · ${percentage(throat.length)} LONG`;
  const left = clamp(branch.handle.x + 18, 8, cssWidth - 150);
  const top = clamp(branch.handle.y - 44, 8, cssHeight - 54);
  readout.style.left = `${left}px`;
  readout.style.top = `${top}px`;
  readout.hidden = false;
}

function hideHandleReadout() {
  $("handleReadout").hidden = true;
}

function beginDrag(event) {
  const point = pointerPosition(event);
  const branch = nearestBranchHandle(point);
  if (!branch) return;
  event.preventDefault();
  selectedThroat = branch.index;
  const throat = state.throats[selectedThroat];
  pointerDrag = {
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    aperture: throat.aperture,
    length: throat.length,
    outerSign: branch.outerSign,
  };
  canvas.setPointerCapture?.(event.pointerId);
  canvas.classList.add("is-dragging");
  showHandleReadout(branch);
  updateSelectedThroatUi();
  announce(`Throat ${selectedThroat + 1} selected. Aperture ${percentage(throat.aperture)}, length ${percentage(throat.length)}.`);
}

function continueDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  event.preventDefault();
  const point = pointerPosition(event);
  const throat = state.throats[selectedThroat];
  throat.length = clamp(pointerDrag.length + (point.x - pointerDrag.startX) / (cssWidth * 0.24));
  throat.aperture = clamp(
    pointerDrag.aperture + (point.y - pointerDrag.startY) * pointerDrag.outerSign / (cssHeight * 0.15),
    0.05,
    1,
  );
  state.specimen = "mutant";
  markAudioDirty();
  updateSelectedThroatUi();
  currentLayout = anatomyLayout(cssWidth, cssHeight, state);
  showHandleReadout(currentLayout.branches[selectedThroat]);
}

function endDrag(event) {
  if (!pointerDrag || (event.pointerId !== undefined && event.pointerId !== pointerDrag.pointerId)) return;
  canvas.releasePointerCapture?.(pointerDrag.pointerId);
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  hideHandleReadout();
  updateUi();
}

function selectNearbyHandle(event) {
  const branch = nearestBranchHandle(pointerPosition(event));
  if (!branch) return;
  selectedThroat = branch.index;
  const reset = specimenState(SPECIMENS[state.specimen] ? state.specimen : "triune");
  state.throats[selectedThroat] = { ...reset.throats[selectedThroat] };
  markAudioDirty();
  updateUi();
  announce(`Throat ${selectedThroat + 1} returned to its specimen anatomy.`);
}

function adjustSelected({ aperture = 0, length = 0 }) {
  const throat = state.throats[selectedThroat];
  throat.aperture = clamp(throat.aperture + aperture, 0.05, 1);
  throat.length = clamp(throat.length + length);
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
  announce(`Throat ${selectedThroat + 1}: ${percentage(throat.aperture)} open, ${percentage(throat.length)} long.`);
}

function handleCanvasKey(event) {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    selectedThroat = (selectedThroat + direction + state.throatCount) % state.throatCount;
    updateSelectedThroatUi();
    announce(`Throat ${selectedThroat + 1} selected.`);
    return;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    adjustSelected({ aperture: event.key === "ArrowUp" ? 0.04 : -0.04 });
    return;
  }
  if (event.key === "[" || event.key === "]") {
    event.preventDefault();
    adjustSelected({ length: event.key === "]" ? 0.04 : -0.04 });
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    state.throats[selectedThroat].muted = !state.throats[selectedThroat].muted;
    markAudioDirty();
    updateUi();
    announce(`Throat ${selectedThroat + 1} ${state.throats[selectedThroat].muted ? "sealed" : "opened"}.`);
    return;
  }
  const presets = ["triune", "oracle", "hive", "razor"];
  if (/^[1-4]$/.test(event.key)) {
    event.preventDefault();
    applySpecimen(presets[Number(event.key) - 1]);
  }
}

function bindRange(id, property, options = {}) {
  $(id).addEventListener("input", () => {
    state[property] = clamp(
      Number($(id).value),
      options.minimum ?? 0,
      options.maximum ?? 1,
    );
    if (options.custom) state.specimen = "mutant";
    markAudioDirty();
    updateUi();
  });
}

for (const button of $("specimenButtons").querySelectorAll("[data-specimen]")) {
  button.addEventListener("click", () => applySpecimen(button.dataset.specimen));
}

$("throatCount").addEventListener("input", () => {
  state.throatCount = Math.round(clamp(Number($("throatCount").value), 1, MAX_THROATS));
  selectedThroat = Math.min(selectedThroat, state.throatCount - 1);
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
});

bindRange("level", "level");
bindRange("inputTrim", "inputTrim", { maximum: 1.35 });
bindRange("bodyLength", "bodyLength", { custom: true });
bindRange("tension", "tension", { custom: true });
bindRange("mutation", "mutation", { custom: true });
bindRange("wet", "wet");
bindRange("dry", "dry", { maximum: 0.5 });
bindRange("growl", "growl");
bindRange("coupling", "coupling", { maximum: 0.72 });
bindRange("spread", "spread");

$("selectedAperture").addEventListener("input", () => {
  state.throats[selectedThroat].aperture = clamp(Number($("selectedAperture").value), 0.05, 1);
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
});

$("selectedLength").addEventListener("input", () => {
  state.throats[selectedThroat].length = clamp(Number($("selectedLength").value));
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
});

$("muteThroatButton").addEventListener("click", () => {
  state.throats[selectedThroat].muted = !state.throats[selectedThroat].muted;
  markAudioDirty();
  updateUi();
});

for (const button of [$("audioButton"), $("awakenButton"), $("micButton")]) {
  button.addEventListener("click", toggleMicrophone);
}
$("stopButton").addEventListener("click", () => void severAudio());
$("panicButton").addEventListener("click", () => void severAudio());
$("recordButton").addEventListener("click", toggleRecording);
$("clearTake").addEventListener("click", clearLastTake);

canvas.addEventListener("pointerdown", beginDrag);
canvas.addEventListener("pointermove", continueDrag);
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("dblclick", selectNearbyHandle);
canvas.addEventListener("keydown", handleCanvasKey);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void severAudio("Emergency sever complete.");
    return;
  }
  const target = event.target;
  const editing = target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement;
  if (!editing && event.key.toLowerCase() === "m") {
    event.preventDefault();
    toggleMicrophone();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && (state.mic || state.starting)) void severAudio("Audio stopped while the page was hidden.");
});

globalThis.addEventListener?.("pagehide", () => {
  void severAudio();
  clearLastTake();
  for (const throat of graph?.throats ?? []) {
    try {
      throat.oscillator?.stop?.();
    } catch {
      // Oscillators can only be stopped once.
    }
  }
  cancelAnimationFrame(frameHandle);
});

new ResizeObserver(resizeStage).observe(stageWrap);
resizeStage();
updateUi();
frameHandle = requestAnimationFrame(frame);
