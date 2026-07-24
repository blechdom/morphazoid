import {
  ARTICULATIONS,
  CONSONANTS,
  MAX_NOSES,
  MAX_THROATS,
  MAX_TONGUES,
  PHONEMES,
  SPECIMENS,
  anatomyLayout,
  articulationKey,
  clamp,
  consonantVoiceParameters,
  fricationOpening,
  glottalHarmonics,
  keyboardArticulation,
  noseVoiceParameters,
  oralOpening,
  smoothEnvelope,
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
  inputStability: 0.72,
  sourceMode: "mic",
  phoneme: "a",
  articulationPlace: 0.48,
  articulationAperture: 0.96,
  articulationVoicing: 0.94,
  glottalClosure: 0,
  nasalCoupling: 0,
  articulationManner: "vowel",
  typingMode: false,
  awake: false,
  mic: false,
  starting: false,
  recording: false,
});

const state = {
  ...DEFAULTS,
  throats: DEFAULTS.throats.map((throat) => ({ ...throat })),
  tongues: DEFAULTS.tongues.map((tongue) => ({ ...tongue })),
  noses: DEFAULTS.noses.map((nose) => ({ ...nose })),
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let currentLayout = anatomyLayout(900, 600, state);
let selectedThroat = 0;
let selectedTongue = 0;
let selectedNose = 0;
let currentTongues = [];
let currentNoses = [];
let currentBodyHandles = [];
let currentTract = null;
let pointerDrag = null;
let audioContext = null;
let graph = null;
let mediaStream = null;
let microphoneSource = null;
let microphoneGeneration = 0;
let audioDirty = false;
let periodicWaveCache = new Map();
let inputWave = new Float32Array(2048);
let outputWave = new Float32Array(2048);
let safetyWave = new Float32Array(1024);
let inputLevel = { rms: 0, peak: 0 };
let outputLevel = { rms: 0, peak: 0 };
let rawInputLevel = { rms: 0, peak: 0 };
let rawOutputLevel = { rms: 0, peak: 0 };
let inputPeakHold = 0;
let inputPeakHeldUntil = 0;
let signalIsVocal = false;
let quietSince = 0;
let lastEnvelopeTime = 0;
let lastMeterUpdate = 0;
let recorder = null;
let recordingStartedAt = 0;
let recordingMimeType = "";
let recordedChunks = [];
let lastTakeUrl = "";
let lastTakeDuration = 0;
let lastTakeMimeType = "";
let frameHandle = 0;
let phonemeReleaseTimer = 0;
let tractPressure = 0;
let fallbackPressure = 0;
let closureStartedAt = 0;
let burstFlashUntil = 0;
let burstFlashPlace = 0.5;
const heldPhonemeKeys = new Map();

const SOURCE_LABELS = Object.freeze({
  mic: "Mic",
  glottis: "Glottis",
  hybrid: "Hybrid",
});

function isAwake() {
  return Boolean(state.awake);
}

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
  const stream = mediaStream;
  try {
    microphoneSource?.disconnect();
  } catch {
    // A device-level end may have already disconnected the source.
  }
  microphoneSource = null;
  mediaStream = null;
  stopStream(stream);
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

function configureInputCompressor(compressor, now) {
  compressor.threshold?.setValueAtTime?.(-32, now);
  compressor.knee?.setValueAtTime?.(18, now);
  compressor.ratio?.setValueAtTime?.(3.5, now);
  compressor.attack?.setValueAtTime?.(0.012, now);
  compressor.release?.setValueAtTime?.(0.24, now);
}

function createNoiseSource(audio, seconds = 2) {
  if (
    typeof audio.createBuffer !== "function"
    || typeof audio.createBufferSource !== "function"
  ) return null;
  const sampleRate = audio.sampleRate || 48_000;
  const buffer = audio.createBuffer(1, Math.ceil(sampleRate * seconds), sampleRate);
  const samples = buffer.getChannelData?.(0);
  if (!samples) return null;
  let seed = 0x5eedc0de;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    samples[index] = seed / 0x8000_0000 - 1;
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}

function createInternalExciter(audio, wetBus) {
  const internalBus = audio.createGain();
  const pulseGain = audio.createGain();
  const pulseLowpass = audio.createBiquadFilter();
  const pulse = typeof audio.createOscillator === "function" ? audio.createOscillator() : null;
  const vibrato = typeof audio.createOscillator === "function" ? audio.createOscillator() : null;
  const vibratoDepth = audio.createGain();
  const wobble = typeof audio.createOscillator === "function" ? audio.createOscillator() : null;
  const wobbleDepth = audio.createGain();
  const breathHighpass = audio.createBiquadFilter();
  const breathLowpass = audio.createBiquadFilter();
  const breathGain = audio.createGain();
  const turbulenceFilter = audio.createBiquadFilter();
  const turbulenceBus = audio.createGain();
  const transientFilter = audio.createBiquadFilter();
  const transientGain = audio.createGain();
  const noise = createNoiseSource(audio);

  internalBus.gain.value = 1;
  pulseGain.gain.value = 0;
  pulseLowpass.type = "lowpass";
  pulseLowpass.frequency.value = 6_500;
  pulseLowpass.Q.value = 0.72;
  vibratoDepth.gain.value = 0;
  wobbleDepth.gain.value = 0;
  breathHighpass.type = "highpass";
  breathHighpass.frequency.value = 350;
  breathHighpass.Q.value = 0.707;
  breathLowpass.type = "lowpass";
  breathLowpass.frequency.value = 8_000;
  breathLowpass.Q.value = 0.707;
  breathGain.gain.value = 0;
  turbulenceFilter.type = "bandpass";
  turbulenceFilter.frequency.value = 3_200;
  turbulenceFilter.Q.value = 0.72;
  turbulenceBus.gain.value = 0.42;
  transientFilter.type = "bandpass";
  transientFilter.frequency.value = 1_150;
  transientFilter.Q.value = 1.4;
  transientGain.gain.value = 0;

  if (pulse) {
    pulse.type = "sawtooth";
    pulse.frequency.value = state.exciterPitch;
    connect(pulse, pulseLowpass);
    connect(pulseLowpass, pulseGain);
    connect(pulseGain, internalBus);
    if (vibrato) {
      vibrato.type = "sine";
      vibrato.frequency.value = 5.2;
      vibrato.connect(vibratoDepth);
      vibratoDepth.connect(pulse.frequency);
      vibrato.start();
    }
    if (wobble) {
      wobble.type = "sine";
      wobble.frequency.value = 0.43;
      wobble.connect(wobbleDepth);
      wobbleDepth.connect(pulse.frequency);
      wobble.start();
    }
    pulse.start();
  }

  if (noise) {
    noise.connect(breathHighpass);
    connect(breathHighpass, breathLowpass);
    connect(breathLowpass, breathGain);
    connect(breathGain, internalBus);
    noise.connect(turbulenceFilter);
    connect(turbulenceFilter, turbulenceBus);
    noise.connect(transientFilter);
    connect(transientFilter, transientGain);
    connect(transientGain, wetBus);
  }

  return {
    internalBus,
    pulse,
    pulseGain,
    pulseLowpass,
    vibrato,
    vibratoDepth,
    wobble,
    wobbleDepth,
    breathGain,
    turbulenceFilter,
    turbulenceBus,
    transientFilter,
    transientGain,
    noise,
    waveKey: "",
  };
}

function buildThroat(audio, index, wetBus) {
  const inlet = audio.createGain();
  const highpass = audio.createBiquadFilter();
  const formants = Array.from({ length: 4 }, () => audio.createBiquadFilter());
  const lowpass = audio.createBiquadFilter();
  const drive = audio.createGain();
  const shaper = createShaper(audio, makeSoftClipCurve());
  const delay = typeof audio.createDelay === "function" ? audio.createDelay(0.08) : audio.createGain();
  const turbulenceFilter = audio.createBiquadFilter();
  const turbulenceGain = audio.createGain();
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
  turbulenceFilter.type = "bandpass";
  turbulenceFilter.frequency.value = 3_200;
  turbulenceFilter.Q.value = 0.8;
  turbulenceGain.gain.value = 0;
  ringCarrier.gain.value = 0;
  ringDepth.gain.value = 0;
  mix.gain.value = 0.72;

  connect(inlet, highpass);
  connect(turbulenceFilter, turbulenceGain);
  connect(turbulenceGain, highpass);
  let tail = highpass;
  for (const filter of formants) tail = connect(tail, filter);
  connect(tail, lowpass);
  connect(lowpass, drive);
  connect(drive, shaper);
  connect(shaper, delay);
  connect(delay, normalGain);
  connect(normalGain, mix);
  connect(delay, ringCarrier);
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
    delay,
    turbulenceFilter,
    turbulenceGain,
    normalGain,
    ringCarrier,
    ringDepth,
    mix,
    panner,
    oscillator,
  };
}

async function createPhysicalTract(audio) {
  if (
    !audio?.audioWorklet?.addModule
    || typeof globalThis.AudioWorkletNode !== "function"
  ) return null;
  try {
    await audio.audioWorklet.addModule(
      new URL("./src/throatazoid-tract-processor.js", import.meta.url),
    );
    const processor = new globalThis.AudioWorkletNode(
      audio,
      "throatazoid-tract",
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 1,
        channelCountMode: "explicit",
      },
    );
    processor.port.onmessage = (event) => {
      if (event.data?.type === "pressure") {
        tractPressure = clamp(event.data.value);
      }
    };
    return processor;
  } catch (error) {
    console.warn("THROATAZOID physical tract unavailable; using resonator fallback.", error);
    return null;
  }
}

function buildAudioGraph(audio, physicalTract = null) {
  const input = audio.createGain();
  const micHighpass = audio.createBiquadFilter();
  const micCompressor = audio.createDynamicsCompressor();
  const micSelect = audio.createGain();
  const sourceBus = audio.createGain();
  const internalSelect = audio.createGain();
  const inputTrim = audio.createGain();
  const highpass = audio.createBiquadFilter();
  const inputAnalyser = audio.createAnalyser();
  const dryGain = audio.createGain();
  const wetBus = audio.createGain();
  const wetGain = audio.createGain();
  const mixBus = audio.createGain();
  const exciter = createInternalExciter(audio, wetBus);
  const noses = Array.from({ length: MAX_NOSES }, (_, index) => {
    const gate = audio.createGain();
    const lowpass = audio.createBiquadFilter();
    const pole = audio.createBiquadFilter();
    const notch = audio.createBiquadFilter();
    const delay = typeof audio.createDelay === "function"
      ? audio.createDelay(0.06)
      : audio.createGain();
    const panner = createPanner(audio, index === 1 ? 0.55 : -0.55 + index * 0.3);
    gate.gain.value = 0;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 4_800;
    lowpass.Q.value = 0.707;
    pole.type = "peaking";
    pole.frequency.value = 310 + index * 180;
    pole.Q.value = 5;
    pole.gain.value = 9;
    notch.type = "notch";
    notch.frequency.value = 900 + index * 430;
    notch.Q.value = 3.5;
    inputAnalyser.connect(gate);
    connect(gate, lowpass);
    connect(lowpass, pole);
    connect(pole, notch);
    connect(notch, delay);
    connect(delay, panner);
    connect(panner, wetBus);
    return { gate, lowpass, pole, notch, delay, panner };
  });
  const safetyAnalyser = audio.createAnalyser();
  const compressor = audio.createDynamicsCompressor();
  const ceiling = createShaper(audio, makeCeilingCurve());
  const masterGain = audio.createGain();
  const outputAnalyser = audio.createAnalyser();
  const recorderDestination = typeof audio.createMediaStreamDestination === "function"
    ? audio.createMediaStreamDestination()
    : null;

  input.gain.value = 1;
  micSelect.gain.value = 0;
  internalSelect.gain.value = 0;
  inputTrim.gain.value = 0;
  micHighpass.type = "highpass";
  micHighpass.frequency.value = 70;
  micHighpass.Q.value = 0.707;
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

  connect(input, micHighpass);
  connect(micHighpass, micCompressor);
  configureInputCompressor(micCompressor, audio.currentTime);
  connect(micCompressor, micSelect);
  connect(micSelect, sourceBus);
  connect(exciter.internalBus, internalSelect);
  connect(internalSelect, sourceBus);
  connect(sourceBus, inputTrim);
  connect(inputTrim, highpass);
  connect(highpass, inputAnalyser);
  connect(inputAnalyser, dryGain);
  connect(dryGain, mixBus);
  const throats = Array.from(
    { length: MAX_THROATS },
    (_, index) => buildThroat(audio, index, wetBus),
  );
  for (const throat of throats) {
    inputAnalyser.connect(throat.inlet);
    exciter.noise?.connect?.(throat.turbulenceFilter);
  }
  if (physicalTract) {
    inputAnalyser.connect(physicalTract);
    physicalTract.connect(wetBus);
  }
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
    micHighpass,
    micCompressor,
    micSelect,
    sourceBus,
    internalSelect,
    inputTrim,
    inputAnalyser,
    dryGain,
    physicalTract,
    throats,
    noses,
    wetGain,
    exciter,
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
    periodicWaveCache = new Map();
    const physicalTract = await createPhysicalTract(audioContext);
    graph = buildAudioGraph(audioContext, physicalTract);
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
  if (typeof parameter.cancelAndHoldAtTime === "function") parameter.cancelAndHoldAtTime(now);
  else parameter.cancelScheduledValues?.(now);
  if (immediate) parameter.setValueAtTime?.(value, now);
  else parameter.setTargetAtTime?.(value, now, timeConstant);
}

function updateGlottalWaveform() {
  const oscillator = graph?.exciter?.pulse;
  if (
    !oscillator?.setPeriodicWave
    || typeof audioContext?.createPeriodicWave !== "function"
  ) return;
  const key = (Math.round(clamp(state.exciterTenseness) * 24) / 24).toFixed(3);
  if (graph.exciter.waveKey === key) return;
  try {
    let wave = periodicWaveCache.get(key);
    if (!wave) {
      const { real, imaginary } = glottalHarmonics(Number(key), 48, 1_024);
      wave = audioContext.createPeriodicWave(real, imaginary, { disableNormalization: false });
      periodicWaveCache.set(key, wave);
    }
    oscillator.setPeriodicWave(wave);
    graph.exciter.waveKey = key;
  } catch {
    oscillator.type = "sawtooth";
  }
}

function physicalTractState(sounding) {
  return {
    throatCount: state.throatCount,
    bodyLength: state.bodyLength,
    spread: state.spread,
    oralClosure: state.oralClosure,
    articulationPlace: state.articulationPlace,
    articulationAperture: state.articulationAperture,
    articulationVoicing: state.articulationVoicing,
    glottalClosure: state.glottalClosure,
    nasalCoupling: state.nasalCoupling,
    exciterIntensity: state.exciterIntensity,
    performanceGate: sounding ? 1 : 0,
    throats: state.throats.map((throat) => ({
      aperture: throat.aperture,
      length: throat.length,
      muted: Boolean(throat.muted),
    })),
    tongues: state.tongues.map((tongue) => ({
      position: tongue.position,
      height: tongue.height,
      curl: tongue.curl,
    })),
    noses: state.noses.map((nose) => ({
      openness: nose.openness,
      length: nose.length,
      resonance: nose.resonance,
    })),
  };
}

function applyAudioParameters(immediate = false) {
  if (!graph || !audioContext) return;
  const live = isAwake();
  const sounding = live && (!state.typingMode || heldPhonemeKeys.size > 0);
  const oralClosure = clamp(state.oralClosure);
  const mouthGain = oralOpening(oralClosure);
  const fricationGain = fricationOpening(oralClosure);
  const micLive = live
    && state.mic
    && (state.sourceMode === "mic" || state.sourceMode === "hybrid");
  const glottisLive = live
    && (state.sourceMode === "glottis" || state.sourceMode === "hybrid");
  const sampleRate = audioContext.sampleRate || 48_000;
  const hybridScale = state.sourceMode === "hybrid" ? 0.68 : 1;
  setAudioParam(graph.micSelect.gain, micLive ? hybridScale : 0, immediate, 0.035);
  setAudioParam(graph.internalSelect.gain, glottisLive ? hybridScale : 0, immediate, 0.035);
  setAudioParam(graph.inputTrim.gain, live ? state.inputTrim : 0, immediate);
  setAudioParam(
    graph.dryGain.gain,
    sounding ? state.dry * mouthGain * (1 - clamp(state.glottalClosure)) : 0,
    immediate,
  );
  setAudioParam(graph.wetGain.gain, live ? state.wet : 0, immediate);
  setAudioParam(graph.masterGain.gain, live ? Math.sqrt(state.level) : 0, immediate);
  setAudioParam(graph.micCompressor.threshold, -27 - state.inputStability * 9, immediate);
  setAudioParam(graph.micCompressor.ratio, 2.2 + state.inputStability * 3.1, immediate);
  setAudioParam(graph.micCompressor.release, 0.14 + state.inputStability * 0.42, immediate);

  updateGlottalWaveform();
  const pitch = clamp(state.exciterPitch, 40, 420);
  const intensity = clamp(state.exciterIntensity);
  const tenseness = clamp(state.exciterTenseness);
  const breath = clamp(state.exciterBreath);
  const vibratoCents = clamp(state.exciterVibrato) * 72;
  const wobbleCents = clamp(state.exciterWobble) * 145;
  setAudioParam(graph.exciter.pulse?.frequency, pitch, immediate, 0.035);
  setAudioParam(
    graph.exciter.pulseGain.gain,
    intensity
      * (0.2 + tenseness * 0.32)
      * (0.12 + clamp(state.articulationVoicing) * 0.88),
    immediate,
    0.05,
  );
  setAudioParam(
    graph.exciter.breathGain.gain,
    intensity * breath * (0.18 + (1 - tenseness) * 0.82) * 0.42,
    immediate,
    0.06,
  );
  setAudioParam(
    graph.exciter.vibratoDepth.gain,
    pitch * (Math.pow(2, vibratoCents / 1_200) - 1),
    immediate,
    0.08,
  );
  setAudioParam(
    graph.exciter.wobbleDepth.gain,
    pitch * (Math.pow(2, wobbleCents / 1_200) - 1),
    immediate,
    0.12,
  );
  setAudioParam(
    graph.exciter.pulseLowpass.frequency,
    3_800 + tenseness * 5_700,
    immediate,
  );

  const consonantAudio = consonantVoiceParameters(
    state.phoneme,
    "hold",
    sampleRate,
  );
  const unvoicedCarrier = consonantAudio
    && !consonantAudio.voiced
    && (consonantAudio.manner === "fricative" || consonantAudio.manner === "stop")
    ? 0.06
    : 1;

  for (let index = 0; index < MAX_THROATS; index += 1) {
    const voice = throatVoiceParameters(state, index, sampleRate);
    const throat = graph.throats[index];
    const active = sounding && index < state.throatCount;
    setAudioParam(
      throat.inlet.gain,
      active
        ? voice.gain
          * (voice.oralGain ?? 1)
          * (graph.physicalTract ? 0.1 : 1)
          * unvoicedCarrier
          * (1 - clamp(state.glottalClosure))
        : 0,
      immediate,
    );
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
    setAudioParam(throat.delay?.delayTime, voice.delay, immediate, 0.045);
    setAudioParam(throat.normalGain.gain, voice.normalMix, immediate);
    setAudioParam(throat.ringDepth.gain, voice.ringMix, immediate);
    setAudioParam(throat.oscillator?.frequency, voice.ringFrequency, immediate, 0.04);
    setAudioParam(throat.panner.pan, voice.pan * state.spread, immediate);
    const aperture = state.throats[index]?.aperture ?? 1;
    const constriction = clamp((0.34 - aperture) / 0.29);
    const contact = clamp(voice.contact ?? 0);
    const tongueNoise = contact * (1 - contact * 0.82);
    setAudioParam(
      throat.turbulenceFilter.frequency,
      consonantAudio?.fricationGain > 0
        ? consonantAudio.fricationFrequency
        : voice.turbulenceFrequency ?? 3_200,
      immediate,
      0.04,
    );
    setAudioParam(
      throat.turbulenceFilter.Q,
      consonantAudio?.fricationGain > 0
        ? consonantAudio.fricationQ
        : 0.65 + contact * 5.5,
      immediate,
    );
    setAudioParam(
      throat.turbulenceGain.gain,
      active && voice.gain > 0
        ? Math.max(
          constriction * (0.012 + state.mutation * 0.055),
          tongueNoise * 0.11,
          (consonantAudio?.fricationGain ?? 0) * 0.16,
        ) * fricationGain * voice.gain
        : 0,
      immediate,
      0.045,
    );
  }

  for (let index = 0; index < graph.noses.length; index += 1) {
    const nose = graph.noses[index];
    const voice = noseVoiceParameters(state, index, sampleRate);
    const active = sounding && index < state.noseCount;
    setAudioParam(
      nose.gate.gain,
      active
        ? voice.gain
          * (graph.physicalTract ? 0.08 : 1)
          * (1 - clamp(state.glottalClosure))
        : 0,
      immediate,
      0.045,
    );
    setAudioParam(nose.lowpass.frequency, voice.lowpass, immediate);
    setAudioParam(nose.pole.frequency, voice.poleFrequency, immediate);
    setAudioParam(nose.pole.Q, voice.poleQ, immediate);
    setAudioParam(nose.pole.gain, 5 + voice.poleQ * 0.72, immediate);
    setAudioParam(nose.notch.frequency, voice.notchFrequency, immediate);
    setAudioParam(nose.notch.Q, voice.notchQ, immediate);
    setAudioParam(nose.delay?.delayTime, voice.delay ?? 0.008, immediate, 0.05);
    setAudioParam(nose.panner.pan, voice.pan, immediate);
  }
  graph.physicalTract?.port?.postMessage?.({
    type: "configure",
    state: physicalTractState(sounding),
  });
  audioDirty = false;
}

function markAudioDirty() {
  audioDirty = true;
}

function triggerReleaseBurst(index = selectedThroat, options = {}) {
  burstFlashUntil = (globalThis.performance?.now?.() ?? Date.now()) + 150;
  burstFlashPlace = clamp(options.place ?? state.articulationPlace);
  if (state.nasalCoupling >= 0.55) return;
  const gain = graph?.exciter?.transientGain?.gain;
  if (!gain || !audioContext || !isAwake()) return;
  const voice = throatVoiceParameters(state, index, audioContext.sampleRate || 48_000);
  const frequency = clamp(
    options.frequency ?? voice.formants[1],
    120,
    (audioContext.sampleRate || 48_000) * 0.45,
  );
  setAudioParam(graph.exciter.transientFilter?.frequency, frequency, true);
  setAudioParam(graph.exciter.transientFilter?.Q, options.q ?? 1.4, true);
  const now = audioContext.currentTime;
  const halfLife = clamp(options.halfLife ?? 0.005, 0.002, 0.025);
  const tail = Math.max(0.025, halfLife * 12);
  const physicalScale = graph.physicalTract ? 0.18 : 1;
  const peak = (0.11 + state.mutation * 0.07)
    * clamp(options.strength ?? 1, 0.1, 1.5)
    * physicalScale;
  gain.cancelScheduledValues?.(now);
  gain.setValueAtTime?.(0.0001, now);
  if (typeof gain.linearRampToValueAtTime === "function") {
    gain.linearRampToValueAtTime(peak, now + 0.001);
    gain.exponentialRampToValueAtTime?.(0.0001, now + tail);
  } else {
    gain.setTargetAtTime?.(0, now + 0.002, halfLife / Math.LN2);
  }
}

function sourceUsesMicrophone(mode = state.sourceMode) {
  return mode === "mic" || mode === "hybrid";
}

async function activateSource(mode = state.sourceMode) {
  const target = SOURCE_LABELS[mode] ? mode : "mic";
  const previousMode = state.sourceMode;
  const previousAwake = state.awake;
  const previousMic = state.mic;
  state.sourceMode = target;
  state.starting = true;
  const generation = ++microphoneGeneration;
  clearError();
  updateUi();

  try {
    const audio = await ensureAudioGraph();
    if (sourceUsesMicrophone(target) && !mediaStream) {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
        throw new Error("Microphone input requires HTTPS or localhost.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
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
          if (mediaStream !== stream) return;
          releaseMicrophone();
          state.mic = false;
          if (state.sourceMode === "hybrid" && state.awake) {
            state.sourceMode = "glottis";
            applyAudioParameters();
            updateUi();
            announce("Microphone shed. The internal glottis continues.");
          } else {
            void severAudio("Microphone disconnected.");
          }
        }, { once: true });
      }
    }

    if (generation !== microphoneGeneration) return;
    if (target === "glottis") {
      releaseMicrophone();
      state.mic = false;
    } else {
      state.mic = Boolean(mediaStream);
    }
    state.awake = true;
    state.starting = false;
    applyAudioParameters();
    announce(`${SOURCE_LABELS[target]} excitation awake. Drag a diamond chamber to deform it.`);
  } catch (error) {
    if (generation === microphoneGeneration) {
      state.sourceMode = previousMode;
      state.awake = previousAwake;
      state.mic = previousMic && Boolean(mediaStream);
      state.starting = false;
      showError(microphoneErrorMessage(error));
      if (previousAwake) applyAudioParameters();
      announce(previousAwake
        ? "Microphone unavailable. The previous excitation continues."
        : "Throatazoid could not access the microphone.");
    }
  } finally {
    if (generation === microphoneGeneration) updateUi();
  }
}

async function severAudio(message = "Throatazoid severed.") {
  microphoneGeneration += 1;
  if (heldPhonemeKeys.size) {
    clearHeldPhonemes({ burst: false });
  }
  if (phonemeReleaseTimer) {
    clearTimeout(phonemeReleaseTimer);
    phonemeReleaseTimer = 0;
    if (isStopArticulation(state.phoneme)) {
      state.oralClosure = Math.min(state.oralClosure, 0.06);
      state.articulationAperture = Math.max(state.articulationAperture, 0.94);
      state.glottalClosure = 0;
      if (state.tongues[0]) {
        state.tongues[0].height = Math.min(state.tongues[0].height, 0.72);
      }
      state.phoneme = "";
      markAudioDirty();
    }
  }
  state.starting = false;
  state.awake = false;
  state.mic = false;
  if (recorder?.state === "recording") recorder.stop();
  if (graph && audioContext) {
    setAudioParam(graph.micSelect.gain, 0, true);
    setAudioParam(graph.internalSelect.gain, 0, true);
    setAudioParam(graph.inputTrim.gain, 0, true);
    setAudioParam(graph.masterGain.gain, 0, true);
  }
  releaseMicrophone();
  inputLevel = { rms: 0, peak: 0 };
  outputLevel = { rms: 0, peak: 0 };
  rawInputLevel = { rms: 0, peak: 0 };
  rawOutputLevel = { rms: 0, peak: 0 };
  inputPeakHold = 0;
  inputPeakHeldUntil = 0;
  signalIsVocal = false;
  quietSince = 0;
  lastEnvelopeTime = 0;
  try {
    await audioContext?.suspend?.();
  } catch {
    // Some browsers reject suspension during a page lifecycle transition.
  }
  updateUi();
  announce(message);
}

function toggleAudio() {
  if (isAwake() || state.starting) void severAudio();
  else void activateSource(state.sourceMode);
}

function selectSourceMode(mode) {
  if (!SOURCE_LABELS[mode]) return;
  if (state.starting && mode === state.sourceMode) return;
  clearError();
  if (isAwake() || state.starting) {
    void activateSource(mode);
  } else {
    state.sourceMode = mode;
    updateUi();
  }
}

function toggleMicrophone() {
  if (isAwake() && state.sourceMode === "mic") {
    void severAudio();
    return;
  }
  state.sourceMode = "mic";
  void activateSource("mic");
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
  if (!isAwake() || !graph?.recorderDestination || !globalThis.MediaRecorder) return;
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
  state.wet = next.wet;
  state.dry = next.dry;
  state.spread = next.spread;
  state.exciterPitch = next.exciterPitch;
  state.exciterIntensity = next.exciterIntensity;
  state.exciterTenseness = next.exciterTenseness;
  state.exciterBreath = next.exciterBreath;
  state.exciterVibrato = next.exciterVibrato;
  state.exciterWobble = next.exciterWobble;
  state.tongueCount = next.tongueCount;
  state.noseCount = next.noseCount;
  state.oralClosure = next.oralClosure;
  state.articulationPlace = next.tongues[0]?.position ?? 0.48;
  state.articulationAperture = 1 - next.oralClosure;
  state.articulationVoicing = 0.92;
  state.glottalClosure = 0;
  state.nasalCoupling = next.noses
    .slice(0, next.noseCount)
    .reduce((sum, nose) => sum + clamp(nose.openness), 0) / Math.max(1, next.noseCount);
  state.articulationManner = "vowel";
  state.throats = next.throats.map((throat) => ({ ...throat }));
  state.tongues = next.tongues.map((tongue) => ({ ...tongue }));
  state.noses = next.noses.map((nose) => ({ ...nose }));
  state.phoneme = name === "triune" ? "a" : "";
  selectedThroat = Math.min(selectedThroat, state.throatCount - 1);
  selectedTongue = Math.min(selectedTongue, state.tongueCount - 1);
  selectedNose = Math.min(selectedNose, state.noseCount - 1);
  markAudioDirty();
  updateUi();
  announce(
    `${SPECIMENS[name].name} loaded: ${state.throatCount} throats, `
      + `${state.tongueCount} tongues, ${state.noseCount} noses.`,
  );
}

function isStopArticulation(id) {
  return CONSONANTS[articulationKey(id)]?.manner === "stop";
}

function releaseStopClosure(id = state.phoneme, {
  clearPhoneme = true,
  announceRelease = true,
  burst = true,
} = {}) {
  const key = articulationKey(id);
  const consonant = CONSONANTS[key];
  if (phonemeReleaseTimer) {
    clearTimeout(phonemeReleaseTimer);
    phonemeReleaseTimer = 0;
  }
  const release = consonant
    ? consonantVoiceParameters(key, "release", audioContext?.sampleRate || 48_000)
    : null;
  state.oralClosure = Math.min(state.oralClosure, 0.06);
  state.articulationAperture = Math.max(state.articulationAperture, 0.94);
  state.glottalClosure = 0;
  state.articulationManner = "vowel";
  if (state.tongues[0]) {
    state.tongues[0].height = Math.min(state.tongues[0].height, 0.72);
  }
  if (clearPhoneme && state.phoneme === key) state.phoneme = "";
  if (burst && release?.burstGain > 0 && state.nasalCoupling < 0.55) {
    triggerReleaseBurst(0, {
      frequency: release.burstFrequency,
      q: release.burstQ,
      strength: release.burstGain,
      halfLife: release.burstHalfLife,
      place: consonant.constrictionPosition,
    });
  }
  markAudioDirty();
  updateUi();
  if (announceRelease) announce(`${consonant?.symbol ?? key.toUpperCase()} closure released.`);
}

function releaseKClosure(options = {}) {
  releaseStopClosure("k", options);
}

function applyPhoneme(
  id,
  {
    sustainK = false,
    sustainStop = sustainK,
    announceGesture = true,
  } = {},
) {
  const key = articulationKey(id);
  const articulation = ARTICULATIONS[key];
  const consonant = CONSONANTS[key];
  const gesture = consonant?.gesture ?? articulation;
  if (!gesture) return;
  if (phonemeReleaseTimer) {
    clearTimeout(phonemeReleaseTimer);
    phonemeReleaseTimer = 0;
  }
  state.phoneme = key;
  state.tongueCount = Math.round(clamp(gesture.tongueCount, 1, MAX_TONGUES));
  state.noseCount = Math.round(clamp(gesture.noseCount, 1, MAX_NOSES));
  state.oralClosure = clamp(gesture.oralClosure);
  state.articulationPlace = consonant?.constrictionPosition
    ?? gesture.tongues?.[0]?.position
    ?? state.articulationPlace;
  state.articulationAperture = consonant?.manner === "fricative"
    ? 0.4
    : 1 - state.oralClosure;
  state.articulationVoicing = consonant
    ? consonant.voiced
      ? 0.92
      : 0.04
    : 0.94;
  state.glottalClosure = consonant?.glottalClosure ?? 0;
  state.nasalCoupling = consonant?.nasalCoupling ?? 0;
  state.articulationManner = consonant?.manner ?? "vowel";
  state.tongues = Array.from({ length: MAX_TONGUES }, (_, index) => ({
    ...state.tongues[index],
    ...(gesture.tongues?.[index] ?? {}),
  }));
  state.noses = Array.from({ length: MAX_NOSES }, (_, index) => ({
    ...state.noses[index],
    ...(gesture.noses?.[index] ?? {}),
  }));
  selectedTongue = Math.min(selectedTongue, state.tongueCount - 1);
  selectedNose = Math.min(selectedNose, state.noseCount - 1);
  markAudioDirty();
  updateUi();
  if (announceGesture) {
    announce(`${consonant?.name ?? gesture.name ?? key.toUpperCase()} articulation loaded.`);
  }

  if (isStopArticulation(key) && !sustainStop) {
    phonemeReleaseTimer = globalThis.setTimeout?.(() => {
      phonemeReleaseTimer = 0;
      if (state.phoneme !== key) return;
      releaseStopClosure(key);
    }, key === "glottal" ? 165 : 185) ?? 0;
  }
}

function activeHeldPhoneme() {
  let active = null;
  for (const entry of heldPhonemeKeys.values()) active = entry;
  return active;
}

function typingKeyIdentity(event, phoneme) {
  return typeof event.code === "string" && event.code
    ? event.code
    : `key:${phoneme}`;
}

function isEditableTypingTarget(target) {
  const editableConstructors = [
    globalThis.HTMLInputElement,
    globalThis.HTMLSelectElement,
    globalThis.HTMLTextAreaElement,
  ].filter(Boolean);
  if (editableConstructors.some((Constructor) => target instanceof Constructor)) return true;
  if (target?.isContentEditable) return true;
  return Boolean(target?.closest?.('[contenteditable="true"], [role="textbox"]'));
}

function typingEventIsModified(event) {
  return Boolean(
    event.defaultPrevented
      || event.isComposing
      || event.ctrlKey
      || event.metaKey
      || event.altKey,
  );
}

function handleTypingKeyDown(event) {
  if (!state.typingMode || typingEventIsModified(event)) return false;
  const phoneme = keyboardArticulation(event.key);
  if (!phoneme || isEditableTypingTarget(event.target)) return false;
  event.preventDefault();
  const identity = typingKeyIdentity(event, phoneme);
  if (event.repeat || heldPhonemeKeys.has(identity)) return true;

  const previous = activeHeldPhoneme();
  if (isStopArticulation(previous?.phoneme) && previous.phoneme !== phoneme) {
    releaseStopClosure(previous.phoneme, { announceRelease: false });
  }
  heldPhonemeKeys.set(identity, { identity, phoneme });
  applyPhoneme(phoneme, { sustainStop: true, announceGesture: false });
  announce(
    isAwake()
      ? `${phoneme.toUpperCase()} held. Release the key to end its voice.`
      : `${phoneme.toUpperCase()} formed. Awaken ${SOURCE_LABELS[state.sourceMode]} to hear it.`,
  );
  return true;
}

function handleTypingKeyUp(event) {
  const phoneme = keyboardArticulation(event.key);
  if (!phoneme) return false;
  const identity = typingKeyIdentity(event, phoneme);
  let entry = heldPhonemeKeys.get(identity);
  if (!entry) {
    for (const candidate of heldPhonemeKeys.values()) {
      if (candidate.phoneme === phoneme) entry = candidate;
    }
  }
  if (!entry) return false;
  event.preventDefault();
  const active = activeHeldPhoneme();
  heldPhonemeKeys.delete(entry.identity);

  if (active?.identity !== entry.identity) {
    markAudioDirty();
    updateUi();
    return true;
  }

  if (isStopArticulation(entry.phoneme)) {
    releaseStopClosure(entry.phoneme, { announceRelease: false });
  }
  const next = activeHeldPhoneme();
  if (next) {
    applyPhoneme(next.phoneme, { sustainStop: true, announceGesture: false });
    announce(`${next.phoneme.toUpperCase()} remains held.`);
  } else {
    state.phoneme = "";
    markAudioDirty();
    updateUi();
    announce(`${entry.phoneme.toUpperCase()} released. Type-to-speak is armed.`);
  }
  return true;
}

function clearHeldPhonemes({ burst = true, preserveCurrent = false } = {}) {
  const active = activeHeldPhoneme();
  heldPhonemeKeys.clear();
  if (isStopArticulation(active?.phoneme)) {
    releaseStopClosure(active.phoneme, {
      clearPhoneme: !preserveCurrent,
      announceRelease: false,
      burst,
    });
  } else if (!preserveCurrent) {
    state.phoneme = "";
  }
  markAudioDirty();
  updateUi();
}

function toggleTypingMode() {
  if (state.typingMode) {
    const active = activeHeldPhoneme();
    clearHeldPhonemes({ preserveCurrent: !isStopArticulation(active?.phoneme) });
    state.typingMode = false;
    if (active?.phoneme && !isStopArticulation(active.phoneme)) state.phoneme = active.phoneme;
    markAudioDirty();
    updateUi();
    announce("Type-to-speak off. Continuous articulation restored.");
    return;
  }

  if (isStopArticulation(state.phoneme)) {
    releaseStopClosure(state.phoneme, { announceRelease: false });
  }
  heldPhonemeKeys.clear();
  state.typingMode = true;
  state.phoneme = "";
  markAudioDirty();
  updateUi();
  announce(
    `Type-to-speak armed. Hold A E I O U · K T P · S X F · M N G · Q for ʔ. `
      + `Awaken ${SOURCE_LABELS[state.sourceMode]} first.`,
  );
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

function updateSelectedArticulationUi() {
  selectedTongue = Math.round(clamp(selectedTongue, 0, state.tongueCount - 1));
  selectedNose = Math.round(clamp(selectedNose, 0, state.noseCount - 1));
  const tongue = state.tongues[selectedTongue];
  const nose = state.noses[selectedNose];

  for (const button of $("tongueButtons").querySelectorAll("[data-tongue]")) {
    const index = Number(button.dataset.tongue);
    setPressed(button, index === selectedTongue);
    button.disabled = index >= state.tongueCount;
  }
  $("selectedTonguePosition").value = String(tongue.position);
  $("selectedTonguePositionOut").textContent = percentage(tongue.position);
  $("selectedTongueHeight").value = String(tongue.height);
  $("selectedTongueHeightOut").textContent = percentage(tongue.height);
  $("selectedTongueCurl").value = String(tongue.curl);
  $("selectedTongueCurlOut").textContent = percentage(tongue.curl);

  for (const button of $("noseButtons").querySelectorAll("[data-nose]")) {
    const index = Number(button.dataset.nose);
    setPressed(button, index === selectedNose);
    button.disabled = index >= state.noseCount;
  }
  $("selectedNoseOpenness").value = String(nose.openness);
  $("selectedNoseOpennessOut").textContent = percentage(nose.openness);
  $("selectedNoseLength").value = String(nose.length);
  $("selectedNoseLengthOut").textContent = percentage(nose.length);
  $("selectedNoseResonance").value = String(nose.resonance);
  $("selectedNoseResonanceOut").textContent = percentage(nose.resonance);
}

function updateUi() {
  const live = isAwake();
  const starting = state.starting;
  const sourceName = SOURCE_LABELS[state.sourceMode] ?? "Mic";
  $("audioState").textContent = live ? "on" : "off";
  setPressed($("audioButton"), live);
  setPressed($("micButton"), live);
  setPressed($("awakenButton"), live);
  $("audioButton").disabled = starting;
  $("micButton").disabled = starting;
  $("awakenButton").disabled = starting;
  $("stopButton").disabled = !live && !starting;
  $("panicButton").disabled = !live && !starting;
  $("micButtonLabel").textContent = starting ? "Opening…" : live ? "Awake" : "Awaken";
  $("micButtonHint").textContent = starting
    ? sourceUsesMicrophone()
      ? "requesting raw microphone"
      : "forming internal vocal folds"
    : live
      ? state.sourceMode === "glottis"
        ? "LF pulse + breath · no microphone"
        : state.sourceMode === "hybrid"
          ? "microphone + synthetic folds"
          : "conditioned microphone source"
      : state.sourceMode === "glottis"
        ? "permission-free excitation"
        : state.sourceMode === "hybrid"
          ? "microphone + internal glottis"
          : "allow microphone access";
  $("awakenLabel").textContent = starting ? "Opening" : live ? "Awake" : "Awaken";

  $("level").value = String(state.level);
  $("levelOut").textContent = percentage(state.level);
  $("inputTrim").value = String(state.inputTrim);
  $("inputTrimOut").textContent = `${Math.round(state.inputTrim * 100)}%`;
  $("inputStability").value = String(state.inputStability);
  $("inputStabilityOut").textContent = `${percentage(state.inputStability)} · stabilized`;
  $("throatCount").value = String(state.throatCount);
  $("throatCountOut").textContent = String(state.throatCount);
  $("bodyLength").value = String(state.bodyLength);
  $("bodyLengthOut").textContent = percentage(state.bodyLength);
  $("tension").value = String(state.tension);
  $("tensionOut").textContent = percentage(state.tension);
  $("mutation").value = String(state.mutation);
  $("mutationOut").textContent = percentage(state.mutation);
  $("tongueCount").value = String(state.tongueCount);
  $("tongueCountOut").textContent = String(state.tongueCount);
  $("noseCount").value = String(state.noseCount);
  $("noseCountOut").textContent = String(state.noseCount);
  $("oralClosure").value = String(state.oralClosure);
  $("oralClosureOut").textContent = percentage(state.oralClosure);
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
  $("exciterPitch").value = String(state.exciterPitch);
  $("exciterPitchOut").textContent = `${Math.round(state.exciterPitch)} Hz`;
  $("exciterIntensity").value = String(state.exciterIntensity);
  $("exciterIntensityOut").textContent = percentage(state.exciterIntensity);
  $("exciterTenseness").value = String(state.exciterTenseness);
  $("exciterTensenessOut").textContent = percentage(state.exciterTenseness);
  $("exciterBreath").value = String(state.exciterBreath);
  $("exciterBreathOut").textContent = percentage(state.exciterBreath);
  $("exciterVibrato").value = String(state.exciterVibrato);
  $("exciterVibratoOut").textContent = percentage(state.exciterVibrato);
  $("exciterWobble").value = String(state.exciterWobble);
  $("exciterWobbleOut").textContent = percentage(state.exciterWobble);
  $("articulationPlace").value = String(state.articulationPlace);
  $("articulationPlaceOut").textContent = articulationPlaceLabel();
  $("articulationAperture").value = String(state.articulationAperture);
  $("articulationApertureOut").textContent = percentage(state.articulationAperture);
  $("articulationVoicing").value = String(state.articulationVoicing);
  $("articulationVoicingOut").textContent = percentage(state.articulationVoicing);
  $("articulationPressureOut").textContent = percentage(tractPressure);
  $("articulationPressureBar").style.width = `${clamp(tractPressure) * 100}%`;
  $("articulationPressure").setAttribute(
    "aria-valuenow",
    String(Math.round(clamp(tractPressure) * 100)),
  );
  const articulation = ARTICULATIONS[state.phoneme];
  const symbol = articulation?.symbol ?? articulation?.name ?? "";
  const description = articulation?.manner
    ? `${articulation.place} ${articulation.manner}`
    : articulation
      ? articulation.kind
      : `${articulationPlaceLabel().toLowerCase()} ${articulationMannerLabel().toLowerCase()}`;
  $("articulationGestureOut").textContent = `${symbol || "MANUAL"} · ${description}`.toUpperCase();

  for (const button of $("specimenButtons").querySelectorAll("[data-specimen]")) {
    setPressed(button, button.dataset.specimen === state.specimen);
  }
  for (const button of $("sourceButtons").querySelectorAll("[data-source]")) {
    setPressed(button, button.dataset.source === state.sourceMode);
  }
  const activeTypingPhoneme = activeHeldPhoneme()?.phoneme ?? "";
  const heldPhonemes = new Set(
    [...heldPhonemeKeys.values()].map((entry) => entry.phoneme),
  );
  for (const button of $("phonemeButtons").querySelectorAll("[data-phoneme]")) {
    setPressed(button, button.dataset.phoneme === state.phoneme);
    const held = state.typingMode && heldPhonemes.has(button.dataset.phoneme);
    button.dataset.held = String(held);
    button.classList.toggle("is-held", held);
  }
  $("typingModeButton").setAttribute("aria-checked", String(state.typingMode));
  $("typingModeState").textContent = state.typingMode
    ? activeTypingPhoneme
      ? `${activeTypingPhoneme.toUpperCase()} held`
      : "armed"
    : "off";
  const name = specimenLabel();
  $("sourceSummary").textContent = `${sourceName.toLowerCase()} excitation`;
  $("listenSummary").textContent = starting
    ? sourceUsesMicrophone()
      ? `opening ${sourceName.toLowerCase()}`
      : "forming glottis"
    : live
      ? `${sourceName.toLowerCase()} awake`
      : `${sourceName.toLowerCase()} selected`;
  $("anatomySummary").textContent = `${name} · ${state.throatCount} throat${state.throatCount === 1 ? "" : "s"}`;
  $("articulationSummary").textContent = `${state.tongueCount} tongue${state.tongueCount === 1 ? "" : "s"} · ${state.noseCount} nose${state.noseCount === 1 ? "" : "s"}`;
  $("voiceSummary").textContent = `${percentage(state.wet)} organism · ${percentage(state.dry)} source`;
  $("stateMetric").textContent = starting ? "opening" : live ? "awake" : "dormant";
  $("specimenMetric").textContent = name.toLowerCase();
  const signalState = live
    ? signalIsVocal
      ? "VOCAL"
      : "QUIET"
    : "DORMANT";
  $("stageReadout").textContent = `${signalState} · ${name.toUpperCase()} · ${state.throatCount}T/${state.tongueCount}G/${state.noseCount}N`;
  updateSelectedThroatUi();
  updateSelectedArticulationUi();

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
  currentTongues = tongueGeometry(currentLayout);
  currentNoses = noseGeometry(currentLayout);
  currentBodyHandles = bodyHandleGeometry(currentLayout);
  currentTract = tractGeometry();
}

function pathMembrane(points, roundness = 0.72) {
  drawing.beginPath();
  if (points.length < 3) {
    points.forEach((point, index) => {
      if (index === 0) drawing.moveTo(point.x, point.y);
      else drawing.lineTo(point.x, point.y);
    });
    return;
  }
  const amount = clamp(roundness);
  const midpoint = (from, to) => ({
    x: from.x + (to.x - from.x) * amount * 0.5,
    y: from.y + (to.y - from.y) * amount * 0.5,
  });
  const first = midpoint(points.at(-1), points[0]);
  drawing.moveTo(first.x, first.y);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const nextMidpoint = midpoint(point, next);
    drawing.quadraticCurveTo(
      point.x,
      point.y,
      nextMidpoint.x,
      nextMidpoint.y,
    );
  }
  drawing.closePath();
}

function drawSoftNode(
  point,
  radius,
  color,
  fill = "#020302",
  { selected = false, time = 0, aspect = 1 } = {},
) {
  const wobble = prefersReducedMotion
    ? 0
    : Math.sin(time * 0.0021 + point.x * 0.013 + point.y * 0.017) * 0.055;
  const radiusX = radius * (1 + wobble);
  const radiusY = radius * aspect * (1 - wobble);
  drawing.save();
  drawing.shadowColor = selected ? color : "transparent";
  drawing.shadowBlur = selected ? radius * 2.4 : 0;
  drawing.beginPath();
  drawing.ellipse(point.x, point.y, radiusX, radiusY, wobble * 1.8, 0, Math.PI * 2);
  drawing.fillStyle = fill;
  drawing.fill();
  drawing.strokeStyle = color;
  drawing.lineWidth = selected ? 1.45 : 1;
  drawing.stroke();
  if (selected) {
    drawing.shadowBlur = 0;
    drawing.beginPath();
    drawing.ellipse(
      point.x,
      point.y,
      radiusX + 4,
      radiusY + 4,
      wobble * 1.8,
      0,
      Math.PI * 2,
    );
    drawing.strokeStyle = color;
    drawing.lineWidth = 0.55;
    drawing.stroke();
  }
  drawing.restore();
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

function tractPoint(geometry, progress, diameter = 0) {
  const normalized = clamp(progress);
  const angle = geometry.angleStart + normalized * geometry.angleSpan;
  const radius = geometry.radius - geometry.scale * Math.max(0, diameter);
  return {
    x: geometry.origin.x - radius * Math.cos(angle),
    y: geometry.origin.y - radius * Math.sin(angle),
    angle,
    progress: normalized,
  };
}

function tractDiameterProfile() {
  const diameters = new Float32Array(44);
  for (let index = 0; index < diameters.length; index += 1) {
    diameters[index] = index < 7 ? 0.58 : index < 12 ? 1.08 : 1.5;
  }

  const primary = state.tongues[0] ?? { position: 0.38, height: 0.18 };
  const tongueIndex = 12.9 + clamp(primary.position) * 17.5;
  const tongueDiameter = 3.5 - clamp(primary.height) * 1.45;
  for (let index = 10; index < 39; index += 1) {
    const interpolation = (tongueIndex - index) / 22;
    const angle = 1.1 * Math.PI * interpolation;
    const normalizedDiameter = 2 + (tongueDiameter - 2) / 1.5;
    let curve = (1.5 - normalizedDiameter + 1.7) * Math.cos(angle);
    if (index === 10 || index === 37) curve *= 0.94;
    diameters[index] = Math.min(diameters[index], Math.max(0.12, 1.5 - curve));
  }

  const aperture = clamp(state.articulationAperture);
  if (aperture < 0.92) {
    const center = clamp(12 + clamp(state.articulationPlace) * 30, 2, 42);
    const target = Math.max(0, aperture * 1.38 - 0.035);
    const normalized = center / 44;
    const radius = normalized < 25 / 44
      ? 8.5
      : 8.5 - clamp((normalized - 25 / 44) / (32 / 44 - 25 / 44)) * 4.2;
    for (
      let index = Math.max(1, Math.floor(center - radius - 1));
      index <= Math.min(43, Math.ceil(center + radius + 1));
      index += 1
    ) {
      const offset = Math.max(0, Math.abs(index - center) - 0.5);
      const scalar = offset >= radius
        ? 1
        : 0.5 * (1 - Math.cos(Math.PI * offset / radius));
      const difference = diameters[index] - target;
      if (difference > 0) diameters[index] = Math.max(0, target + difference * scalar);
    }
  }
  return diameters;
}

function tractGeometry() {
  const compact = cssWidth < 680 || cssHeight < 360;
  const radius = Math.min(
    cssWidth * (compact ? 0.44 : 0.45),
    cssHeight * (compact ? 0.62 : 0.6),
  );
  const geometry = {
    origin: {
      x: cssWidth * (compact ? 0.56 : 0.56),
      y: cssHeight * (compact ? 0.78 : 0.73),
    },
    radius,
    scale: Math.max(26, Math.min(radius * 0.125, cssHeight * 0.085)),
    angleStart: -0.12,
    angleSpan: Math.PI * 0.62,
    diameters: tractDiameterProfile(),
  };
  geometry.baseline = Array.from(
    geometry.diameters,
    (_, index) => tractPoint(geometry, index / 43, 0),
  );
  geometry.wall = Array.from(
    geometry.diameters,
    (diameter, index) => tractPoint(geometry, index / 43, diameter),
  );
  geometry.constrictionProgress = clamp((12 + clamp(state.articulationPlace) * 30) / 43);
  const station = Math.round(geometry.constrictionProgress * 43);
  geometry.constriction = tractPoint(
    geometry,
    geometry.constrictionProgress,
    geometry.diameters[station],
  );
  geometry.glottis = tractPoint(geometry, 0.025, geometry.diameters[1] * 0.52);
  geometry.velum = tractPoint(
    geometry,
    17 / 43,
    geometry.diameters[17] + 0.1,
  );
  geometry.lips = tractPoint(geometry, 1, geometry.diameters[43] * 0.48);
  return geometry;
}

function drawTractText(geometry, progress, diameter, label, alpha = 0.54) {
  if (!drawing.fillText) return;
  const point = tractPoint(geometry, progress, diameter);
  drawing.save();
  drawing.translate(point.x, point.y);
  drawing.rotate(point.angle - Math.PI * 0.5);
  drawing.fillStyle = `rgba(232,237,223,${alpha})`;
  drawing.font = "7px monospace";
  drawing.textAlign = "center";
  drawing.fillText(label, 0, 0);
  drawing.restore();
}

function drawPhysicalTract(time, liveAlpha) {
  const geometry = tractGeometry();
  currentTract = geometry;
  const pressure = clamp(tractPressure);
  const aperture = clamp(state.articulationAperture);
  const closed = aperture < 0.04 || state.glottalClosure > 0.84;
  const fricating = aperture > 0.2 && aperture < 0.55;

  drawing.save();
  drawing.lineJoin = "round";
  drawing.lineCap = "round";

  drawing.beginPath();
  geometry.baseline.forEach((point, index) => {
    if (index === 0) drawing.moveTo(point.x, point.y);
    else drawing.lineTo(point.x, point.y);
  });
  for (let index = geometry.wall.length - 1; index >= 0; index -= 1) {
    const point = geometry.wall[index];
    drawing.lineTo(point.x, point.y);
  }
  drawing.closePath();
  const tractGradient = drawing.createLinearGradient?.(
    cssWidth * 0.08,
    cssHeight * 0.82,
    cssWidth * 0.7,
    cssHeight * 0.15,
  );
  if (tractGradient) {
    tractGradient.addColorStop(0, "rgba(51,18,42,.94)");
    tractGradient.addColorStop(0.55, "rgba(31,15,34,.96)");
    tractGradient.addColorStop(1, "rgba(9,12,11,.98)");
    drawing.fillStyle = tractGradient;
  } else {
    drawing.fillStyle = "rgba(31,15,34,.96)";
  }
  drawing.shadowColor = closed ? "rgba(255,116,95,.36)" : "rgba(198,160,255,.2)";
  drawing.shadowBlur = closed ? 26 * pressure : 10 + liveAlpha * 8;
  drawing.fill();
  drawing.shadowBlur = 0;
  drawing.strokeStyle = "rgba(232,237,223,.58)";
  drawing.lineWidth = 1.35;
  drawing.stroke();

  for (let index = 1; index < 43; index += 1) {
    const baseline = geometry.baseline[index];
    const wall = geometry.wall[index];
    const behindClosure = index / 43 < geometry.constrictionProgress;
    const sectionEnergy = isAwake()
      ? 0.06 + liveAlpha * (0.1 + 0.16 * Math.sin(time * 0.004 - index * 0.74) ** 2)
      : 0.04;
    drawing.beginPath();
    drawing.moveTo(baseline.x, baseline.y);
    drawing.lineTo(wall.x, wall.y);
    drawing.strokeStyle = closed && behindClosure
      ? `rgba(255,116,95,${0.07 + pressure * 0.34})`
      : `rgba(198,160,255,${sectionEnergy})`;
    drawing.lineWidth = closed && behindClosure ? 0.8 + pressure * 1.2 : 0.55;
    drawing.stroke();
  }

  drawing.beginPath();
  geometry.wall.forEach((point, index) => {
    if (index === 0) drawing.moveTo(point.x, point.y);
    else drawing.lineTo(point.x, point.y);
  });
  drawing.strokeStyle = "rgba(198,160,255,.82)";
  drawing.lineWidth = 2.3;
  drawing.stroke();

  const tongueStart = tractPoint(geometry, 11 / 43, 1.78);
  const tongueMid = tractPoint(
    geometry,
    clamp((12.9 + clamp(state.tongues[0]?.position) * 17.5) / 43),
    1.84 + clamp(state.tongues[0]?.height) * 0.35,
  );
  const tongueEnd = tractPoint(geometry, 33 / 43, 1.74);
  drawing.beginPath();
  drawing.moveTo(tongueStart.x, tongueStart.y);
  drawing.quadraticCurveTo(tongueMid.x, tongueMid.y, tongueEnd.x, tongueEnd.y);
  drawing.strokeStyle = "rgba(198,160,255,.2)";
  drawing.lineWidth = Math.max(18, geometry.scale * 0.42);
  drawing.stroke();
  drawing.strokeStyle = "rgba(198,160,255,.48)";
  drawing.lineWidth = 1;
  drawing.stroke();

  for (let index = 0; index < state.tongueCount; index += 1) {
    const tongue = state.tongues[index];
    const progress = clamp((12 + clamp(tongue.position) * 29) / 43);
    const point = tractPoint(geometry, progress, 1.74 + clamp(tongue.height) * 0.38);
    drawSoftNode(
      point,
      index === selectedTongue ? 5.8 : 3.5,
      index === selectedTongue ? "#c6a0ff" : "rgba(198,160,255,.52)",
      "#020302",
      { selected: index === selectedTongue && pointerDrag?.type === "tongue", time },
    );
    if (drawing.fillText) {
      drawing.fillStyle = "rgba(198,160,255,.6)";
      drawing.font = "6px monospace";
      drawing.fillText(`T${index + 1}`, point.x + 7, point.y - 5);
    }
  }

  const averageNoseOpen = state.noses
    .slice(0, state.noseCount)
    .reduce((sum, nose) => sum + clamp(nose.openness), 0) / Math.max(1, state.noseCount);
  for (let index = 0; index < state.noseCount; index += 1) {
    const openness = clamp(state.noses[index]?.openness);
    const end = {
      x: geometry.velum.x + geometry.scale * (1.25 + index * 0.36),
      y: geometry.velum.y - geometry.scale * (2.65 + index * 0.7),
    };
    drawing.beginPath();
    drawing.moveTo(geometry.velum.x, geometry.velum.y);
    drawing.quadraticCurveTo(
      geometry.velum.x + geometry.scale * (0.22 + index * 0.14),
      geometry.velum.y - geometry.scale * (1.34 + index * 0.2),
      end.x,
      end.y,
    );
    drawing.strokeStyle = `rgba(121,220,255,${0.16 + openness * 0.58})`;
    drawing.lineWidth = 1.2 + openness * 4.2;
    drawing.stroke();
    drawSoftNode(
      end,
      3.2 + openness * 2.2,
      "#79dcff",
      "#020302",
      { selected: selectedNose === index && pointerDrag?.type === "nose", time },
    );
  }

  const velumColor = averageNoseOpen > 0.55 ? "#79dcff" : "#ff745f";
  drawSoftNode(
    geometry.velum,
    6.4,
    velumColor,
    "#020302",
    { selected: pointerDrag?.type === "tract-velum", time, aspect: 0.78 },
  );
  drawSoftNode(
    geometry.glottis,
    8,
    state.glottalClosure > 0.84 ? "#ff745f" : "#d8ff57",
    "#020302",
    { selected: pointerDrag?.type === "tract-glottis", time, aspect: 1.25 },
  );

  const constrictionColor = closed
    ? "#ff745f"
    : fricating
      ? "#ffcb69"
      : "#d8ff57";
  drawing.beginPath();
  drawing.arc(
    geometry.constriction.x,
    geometry.constriction.y,
    12 + (closed ? pressure * 10 : 0),
    0,
    Math.PI * 2,
  );
  drawing.fillStyle = closed
    ? `rgba(255,116,95,${0.08 + pressure * 0.2})`
    : "rgba(216,255,87,.055)";
  drawing.fill();
  drawing.strokeStyle = constrictionColor;
  drawing.lineWidth = pointerDrag?.type === "tract-constriction" ? 2.5 : 1.35;
  drawing.stroke();
  drawing.beginPath();
  drawing.moveTo(
    geometry.baseline[Math.round(geometry.constrictionProgress * 43)].x,
    geometry.baseline[Math.round(geometry.constrictionProgress * 43)].y,
  );
  drawing.lineTo(geometry.constriction.x, geometry.constriction.y);
  drawing.strokeStyle = colorWithAlpha(constrictionColor, closed ? 0.82 : 0.48);
  drawing.lineWidth = closed ? 2.1 : 1;
  drawing.stroke();

  if (fricating && !prefersReducedMotion) {
    for (let particle = 0; particle < 11; particle += 1) {
      const phase = time * 0.012 + particle * 2.399;
      const distance = 7 + (particle % 4) * 4;
      drawing.beginPath();
      drawing.arc(
        geometry.constriction.x + Math.cos(phase) * distance,
        geometry.constriction.y + Math.sin(phase * 1.17) * distance,
        0.7 + particle % 3 * 0.45,
        0,
        Math.PI * 2,
      );
      drawing.fillStyle = `rgba(255,203,105,${0.2 + liveAlpha * 0.55})`;
      drawing.fill();
    }
  }

  if (time < burstFlashUntil) {
    const elapsed = clamp((burstFlashUntil - time) / 150);
    const flashPoint = tractPoint(
      geometry,
      clamp((12 + burstFlashPlace * 30) / 43),
      0.5,
    );
    drawing.beginPath();
    drawing.arc(flashPoint.x, flashPoint.y, 9 + (1 - elapsed) * 28, 0, Math.PI * 2);
    drawing.strokeStyle = `rgba(255,203,105,${elapsed * 0.78})`;
    drawing.lineWidth = 1.6;
    drawing.stroke();
  }

  drawTractText(geometry, 0.035, -0.34, "GLOTTIS", 0.68);
  drawTractText(geometry, 20 / 43, -0.42, "K · NG", 0.5);
  drawTractText(geometry, 31 / 43, -0.44, "SH", 0.42);
  drawTractText(geometry, 36 / 43, -0.44, "T · S · N", 0.54);
  drawTractText(geometry, 41 / 43, -0.42, "P · F · M", 0.54);
  drawTractText(geometry, 1, 1.82, "LIPS", 0.68);

  if (drawing.fillText) {
    drawing.fillStyle = "rgba(232,237,223,.8)";
    drawing.font = "8px monospace";
    drawing.textAlign = "left";
    drawing.fillText(
      closed ? `SEALED · ${Math.round(pressure * 100)}% PRESSURE` : fricating ? "TURBULENCE WINDOW" : "DRAG PLACE × APERTURE",
      geometry.constriction.x + 18,
      geometry.constriction.y - 15,
    );
  }
  drawing.restore();
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
  pathMembrane(gullet.polygon, 0.82 - state.tension * 0.26);
  drawing.fillStyle = "rgba(64, 28, 51, 0.42)";
  drawing.fill();
  drawing.strokeStyle = `rgba(232, 237, 223, ${0.28 + liveAlpha * 0.38})`;
  drawing.lineWidth = 1.15;
  drawing.stroke();

  drawing.beginPath();
  drawing.moveTo(gullet.upper[0].x, gullet.upper[0].y);
  for (let index = 1; index < gullet.upper.length - 1; index += 1) {
    const point = gullet.upper[index];
    const next = gullet.upper[index + 1];
    drawing.quadraticCurveTo(
      point.x,
      point.y,
      (point.x + next.x) * 0.5,
      (point.y + next.y) * 0.5,
    );
  }
  drawing.lineTo(gullet.upper.at(-1).x, gullet.upper.at(-1).y);
  drawing.strokeStyle = `rgba(255, 208, 220, ${0.065 + liveAlpha * 0.055})`;
  drawing.lineWidth = 0.8;
  drawing.stroke();

  for (let index = 1; index < gullet.upper.length - 1; index += 1) {
    drawing.beginPath();
    drawing.moveTo(gullet.upper[index].x, gullet.upper[index].y);
    drawing.lineTo(gullet.lower[gullet.lower.length - 1 - index].x, gullet.lower[gullet.lower.length - 1 - index].y);
    drawing.strokeStyle = `rgba(232, 237, 223, ${0.07 + liveAlpha * 0.05})`;
    drawing.lineWidth = 1;
    drawing.stroke();
  }

  if (isAwake() && inputWave.length) {
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

function tongueGeometry(layout) {
  const tractWidth = layout.junction.x - layout.root.x;
  return Array.from({ length: state.tongueCount }, (_, index) => {
    const tongue = state.tongues[index];
    const side = index % 2 === 0 ? 1 : -1;
    const anchor = {
      x: layout.root.x + tractWidth * (0.2 + tongue.position * 0.68),
      y: layout.centerY + side * layout.bodyRadius * 0.62,
    };
    const halfBase = layout.shortSide * (0.008 + (1 - tongue.height) * 0.005);
    const reach = layout.bodyRadius * (0.2 + tongue.height * 1.04);
    const handle = {
      x: anchor.x + (tongue.curl - 0.5) * layout.bodyRadius * 1.35,
      y: anchor.y - side * reach,
    };
    const curlHandle = {
      x: anchor.x
        + (handle.x - anchor.x) * 0.7
        + (tongue.curl - 0.5) * layout.bodyRadius * 0.52,
      y: anchor.y
        + (handle.y - anchor.y) * 0.7
        + side * layout.bodyRadius * 0.2,
    };
    const halfTip = Math.max(2.4, halfBase * 0.35);
    const polygon = [
      { x: anchor.x - halfBase, y: anchor.y },
      { x: anchor.x + halfBase, y: anchor.y },
      { x: handle.x + halfTip, y: handle.y + side * halfTip },
      handle,
      { x: handle.x - halfTip, y: handle.y + side * halfTip },
    ];
    return { index, side, anchor, handle, curlHandle, polygon, ...tongue };
  });
}

function noseGeometry(layout) {
  const tractWidth = layout.junction.x - layout.root.x;
  const slots = [
    { progress: 0.38, side: -1 },
    { progress: 0.62, side: 1 },
    { progress: 0.82, side: -1 },
  ];
  return Array.from({ length: state.noseCount }, (_, index) => {
    const nose = state.noses[index];
    const slot = slots[index] ?? slots.at(-1);
    const anchor = {
      x: layout.root.x + tractWidth * slot.progress,
      y: layout.centerY + slot.side * layout.bodyRadius * 0.48,
    };
    const radius = layout.bodyRadius * (0.28 + nose.resonance * 0.34);
    const chamber = {
      x: anchor.x + (nose.length - 0.5) * layout.bodyRadius * 1.15,
      y: layout.centerY + slot.side * layout.bodyRadius * (1.42 + nose.length * 0.72),
    };
    const handle = {
      x: chamber.x,
      y: chamber.y + slot.side * radius * 0.72,
    };
    const resonanceHandle = {
      x: chamber.x + radius * 0.84,
      y: chamber.y,
    };
    return {
      index,
      side: slot.side,
      anchor,
      chamber,
      handle,
      resonanceHandle,
      radius,
      ...nose,
    };
  });
}

function bodyHandleGeometry(layout) {
  return [
    {
      control: "membrane",
      label: "B",
      color: "#e8eddf",
      handle: {
        x: layout.larynx.x,
        y: layout.centerY - layout.bodyRadius * (1 + state.tension * 0.34),
      },
    },
    {
      control: "closure",
      label: "O",
      color: "#ff8e7c",
      handle: {
        x: layout.junction.x - layout.bodyRadius * (0.16 + state.coupling * 0.36),
        y: layout.centerY + layout.bodyRadius * (1 + state.oralClosure * 0.3),
      },
    },
  ];
}

function drawBodyHandles(layout, time) {
  currentBodyHandles = bodyHandleGeometry(layout);
  for (const item of currentBodyHandles) {
    const selected = pointerDrag?.type === `body-${item.control}`;
    const attachment = item.control === "membrane" ? layout.larynx : layout.junction;
    drawing.beginPath();
    drawing.moveTo(attachment.x, attachment.y);
    drawing.lineTo(item.handle.x, item.handle.y);
    drawing.strokeStyle = colorWithAlpha(item.color, selected ? 0.52 : 0.2);
    drawing.lineWidth = 0.8;
    drawing.stroke();
    drawSoftNode(
      item.handle,
      selected ? 6.2 : 4.5,
      item.color,
      selected ? colorWithAlpha(item.color, 0.14) : "#020302",
      { selected, time, aspect: item.control === "closure" ? 0.76 : 1.16 },
    );
    if (drawing.fillText) {
      drawing.fillStyle = colorWithAlpha(item.color, selected ? 0.9 : 0.52);
      drawing.font = "7px monospace";
      drawing.fillText(item.label, item.handle.x + 7, item.handle.y - 5);
    }
  }
}

function colorWithAlpha(color, alpha) {
  if (color === "#e8eddf") return `rgba(232,237,223,${alpha})`;
  if (color === "#ff8e7c") return `rgba(255,142,124,${alpha})`;
  if (color === "#ff745f") return `rgba(255,116,95,${alpha})`;
  if (color === "#ffcb69") return `rgba(255,203,105,${alpha})`;
  if (color === "#d8ff57") return `rgba(216,255,87,${alpha})`;
  return color;
}

function drawNoses(layout, time, liveAlpha) {
  currentNoses = noseGeometry(layout);
  for (const nose of currentNoses) {
    const activeColor = selectedNose === nose.index ? "#79dcff" : "rgba(121,220,255,.56)";
    drawing.beginPath();
    drawing.moveTo(nose.anchor.x, nose.anchor.y);
    drawing.lineTo(nose.chamber.x, nose.chamber.y);
    drawing.strokeStyle = `rgba(121, 220, 255, ${0.1 + nose.openness * 0.52 + liveAlpha * 0.1})`;
    drawing.lineWidth = 0.7 + nose.openness * 2.2;
    drawing.stroke();

    const gateHalfWidth = layout.shortSide * 0.012;
    drawing.beginPath();
    drawing.moveTo(nose.anchor.x - gateHalfWidth, nose.anchor.y);
    drawing.lineTo(
      nose.anchor.x + gateHalfWidth * (1 - nose.openness),
      nose.anchor.y,
    );
    drawing.strokeStyle = nose.openness > 0.72 ? "#79dcff" : "rgba(255,116,95,.62)";
    drawing.lineWidth = 1.1;
    drawing.stroke();

    const chamberPoints = [];
    for (let point = 0; point < 7; point += 1) {
      const angle = point / 7 * Math.PI * 2 - Math.PI / 2;
      const pulse = prefersReducedMotion
        ? 1
        : 1 + Math.sin(time * 0.0017 + nose.index * 2.3 + point) * inputLevel.rms * 0.52;
      const x = nose.chamber.x + Math.cos(angle) * nose.radius * pulse;
      const y = nose.chamber.y + Math.sin(angle) * nose.radius * 0.74 * pulse;
      chamberPoints.push({ x, y });
    }
    pathMembrane(chamberPoints, 0.94);
    drawing.fillStyle = "rgba(12, 34, 38, 0.54)";
    drawing.fill();
    drawing.strokeStyle = `rgba(121,220,255,${0.18 + nose.openness * 0.38})`;
    drawing.lineWidth = selectedNose === nose.index ? 1.45 : 1;
    drawing.stroke();
    drawing.beginPath();
    drawing.ellipse(
      nose.chamber.x - nose.radius * 0.16,
      nose.chamber.y - nose.radius * 0.18,
      nose.radius * 0.3,
      Math.max(1, nose.radius * 0.09),
      -0.32,
      0,
      Math.PI * 2,
    );
    drawing.strokeStyle = "rgba(205,245,255,.12)";
    drawing.lineWidth = 0.65;
    drawing.stroke();
    const selected = selectedNose === nose.index;
    drawSoftNode(
      nose.handle,
      selected ? 5.8 : 4.2,
      activeColor,
      selected ? "rgba(121,220,255,.11)" : "#020302",
      { selected, time },
    );
    if (selected) {
      drawing.beginPath();
      drawing.moveTo(nose.chamber.x, nose.chamber.y);
      drawing.lineTo(nose.resonanceHandle.x, nose.resonanceHandle.y);
      drawing.strokeStyle = "rgba(121,220,255,.28)";
      drawing.lineWidth = 0.8;
      drawing.stroke();
      drawSoftNode(
        nose.resonanceHandle,
        4.8,
        "#79dcff",
        "rgba(121,220,255,.12)",
        { selected: pointerDrag?.type === "nose-resonance", time, aspect: 0.84 },
      );
    }
    if (drawing.fillText) {
      drawing.fillStyle = activeColor;
      drawing.font = "7px monospace";
      drawing.fillText(`N${nose.index + 1}`, nose.handle.x + 8, nose.handle.y - 5);
      if (selected) {
        drawing.fillText("R", nose.resonanceHandle.x + 7, nose.resonanceHandle.y - 5);
      }
    }
  }
}

function drawTongues(layout, time, liveAlpha) {
  currentTongues = tongueGeometry(layout);
  for (const tongue of currentTongues) {
    pathMembrane(tongue.polygon, 0.96);
    drawing.fillStyle = `rgba(198,160,255,${0.055 + tongue.height * 0.1})`;
    drawing.fill();
    const selected = selectedTongue === tongue.index;
    const contact = clamp((tongue.height - 0.56) / 0.44);
    drawing.strokeStyle = selected
      ? "#c6a0ff"
      : `rgba(198,160,255,${0.28 + liveAlpha * 0.22})`;
    drawing.lineWidth = selected ? 1.5 : 1;
    drawing.stroke();

    drawing.beginPath();
    drawing.moveTo(tongue.anchor.x, tongue.anchor.y);
    drawing.lineTo(tongue.handle.x, tongue.handle.y);
    drawing.strokeStyle = `rgba(198,160,255,${0.08 + contact * 0.42})`;
    drawing.lineWidth = 1;
    drawing.stroke();
    drawSoftNode(
      tongue.handle,
      selected ? 6.1 : 4.4,
      contact > 0.82 ? "#ff745f" : selected ? "#c6a0ff" : "rgba(198,160,255,.58)",
      selected ? "rgba(198,160,255,.15)" : "#020302",
      { selected, time, aspect: 1.2 },
    );
    if (selected) {
      drawing.beginPath();
      drawing.moveTo(tongue.handle.x, tongue.handle.y);
      drawing.quadraticCurveTo(
        tongue.curlHandle.x,
        tongue.handle.y,
        tongue.curlHandle.x,
        tongue.curlHandle.y,
      );
      drawing.strokeStyle = "rgba(198,160,255,.3)";
      drawing.lineWidth = 0.8;
      drawing.stroke();
      drawSoftNode(
        tongue.curlHandle,
        4.9,
        "#c6a0ff",
        "rgba(198,160,255,.14)",
        { selected: pointerDrag?.type === "tongue-curl", time, aspect: 0.74 },
      );
    }
    if (drawing.fillText) {
      drawing.fillStyle = selected ? "#c6a0ff" : "rgba(198,160,255,.54)";
      drawing.font = "7px monospace";
      drawing.fillText(`T${tongue.index + 1}`, tongue.handle.x + 8, tongue.handle.y + 3);
      if (selected) {
        drawing.fillText("C", tongue.curlHandle.x + 7, tongue.curlHandle.y + 3);
      }
    }
  }
}

function drawBranch(branch, time, liveAlpha) {
  pathMembrane(branch.polygon, 0.88 - state.tension * 0.3);
  drawing.fillStyle = branch.muted
    ? "rgba(18, 15, 18, 0.32)"
    : selectedThroat === branch.index
      ? "rgba(61, 45, 26, 0.5)"
      : "rgba(47, 24, 39, 0.46)";
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
  if (!branch.muted) {
    drawing.beginPath();
    drawing.moveTo(upperJunction.x, upperJunction.y);
    drawing.quadraticCurveTo(
      upperBend.x,
      upperBend.y,
      upperMouth.x,
      upperMouth.y,
    );
    drawing.strokeStyle = `rgba(255,208,220,${0.055 + liveAlpha * 0.07})`;
    drawing.lineWidth = 0.75;
    drawing.stroke();
  }
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
  const mouthRadius = Math.max(
    3.5,
    Math.hypot(upperMouth.x - lowerMouth.x, upperMouth.y - lowerMouth.y) * 0.5,
  );
  const mouthOpen = 0.18 + oralOpening(state.oralClosure) * 0.82;
  drawing.beginPath();
  drawing.ellipse(
    branch.mouth.x,
    branch.mouth.y,
    mouthRadius * mouthOpen,
    Math.max(3.5, mouthRadius * 0.46),
    Math.atan2(branch.direction.y, branch.direction.x) + Math.PI * 0.5,
    0,
    Math.PI * 2,
  );
  drawing.strokeStyle = branch.muted ? "rgba(105,112,95,.18)" : "rgba(232,237,223,.52)";
  drawing.stroke();

  drawSoftNode(
    branch.handle,
    selectedThroat === branch.index ? 6.4 : 4.8,
    selectedThroat === branch.index ? "#d8ff57" : "rgba(232, 237, 223, .62)",
    selectedThroat === branch.index ? "rgba(216,255,87,.11)" : "#020302",
    { selected: selectedThroat === branch.index, time, aspect: 0.88 },
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
  if (!isAwake() || liveAlpha < 0.015 || prefersReducedMotion) return;
  const packetCount = 3 + Math.round(liveAlpha * 4);
  for (const branch of layout.branches) {
    if (branch.muted) continue;
    const points = [layout.root, layout.larynx, layout.junction, branch.bend, branch.mouth];
    for (let packet = 0; packet < packetCount; packet += 1) {
      const progress = (time * (0.00022 + inputLevel.rms * 0.0007) + packet / packetCount + branch.index * 0.073) % 1;
      const point = interpolatePoint(points, progress);
      const radius = 1.3 + liveAlpha * 2.6 * (1 - progress * 0.35);
      drawing.beginPath();
      drawing.ellipse(
        point.x,
        point.y,
        radius * (1.25 - progress * 0.2),
        radius * 0.82,
        0,
        0,
        Math.PI * 2,
      );
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
  drawing.save();
  drawing.globalAlpha = 0.085;
  drawNoses(currentLayout, time, liveAlpha);
  drawGullet(currentLayout, time, liveAlpha);
  drawTongues(currentLayout, time, liveAlpha);
  drawBodyHandles(currentLayout, time);
  for (const branch of currentLayout.branches) drawBranch(branch, time, liveAlpha);
  drawPressure(currentLayout, time, liveAlpha);
  drawing.restore();
  drawPhysicalTract(time, liveAlpha);

  drawing.save();
  drawing.globalAlpha = 0.38;
  drawSoftNode(
    currentLayout.root,
    5.2,
    isAwake() ? "#d8ff57" : "rgba(216,255,87,.38)",
    isAwake() ? "#d8ff57" : "#020302",
    { selected: isAwake(), time, aspect: 0.9 },
  );
  drawSoftNode(
    currentLayout.junction,
    4.8,
    "rgba(232,237,223,.52)",
    "#020302",
    { time, aspect: 0.9 },
  );
  drawing.restore();
}

function readAnalyser(analyser, samples) {
  if (!analyser?.getFloatTimeDomainData) return { rms: 0, peak: 0 };
  analyser.getFloatTimeDomainData(samples);
  return waveformLevel(samples);
}

function updateMeters(time) {
  const elapsed = lastEnvelopeTime ? clamp(time - lastEnvelopeTime, 0, 250) : 16.67;
  lastEnvelopeTime = time;
  if (graph && isAwake()) {
    rawInputLevel = readAnalyser(graph.inputAnalyser, inputWave);
    rawOutputLevel = readAnalyser(graph.outputAnalyser, outputWave);
    readAnalyser(graph.safetyAnalyser, safetyWave);
  } else {
    rawInputLevel = { rms: 0, peak: 0 };
    rawOutputLevel = { rms: 0, peak: 0 };
  }

  const stability = clamp(state.inputStability);
  inputLevel.rms = smoothEnvelope(
    inputLevel.rms,
    rawInputLevel.rms,
    elapsed,
    30 + stability * 55,
    160 + stability * 360,
  );
  outputLevel.rms = smoothEnvelope(
    outputLevel.rms,
    rawOutputLevel.rms,
    elapsed,
    35,
    260,
  );
  outputLevel.peak = smoothEnvelope(
    outputLevel.peak,
    rawOutputLevel.peak,
    elapsed,
    18,
    420,
  );

  if (rawInputLevel.peak >= inputLevel.peak) {
    inputLevel.peak = rawInputLevel.peak;
    inputPeakHeldUntil = time + 450;
  } else if (time > inputPeakHeldUntil) {
    inputLevel.peak = smoothEnvelope(inputLevel.peak, rawInputLevel.peak, elapsed, 12, 650);
  }

  if (!signalIsVocal && inputLevel.rms > 0.006) {
    signalIsVocal = true;
    quietSince = 0;
  } else if (signalIsVocal && inputLevel.rms < 0.003) {
    if (!quietSince) quietSince = time;
    if (time - quietSince > 250) {
      signalIsVocal = false;
      quietSince = 0;
    }
  } else if (inputLevel.rms >= 0.003) {
    quietSince = 0;
  }

  if (time - lastMeterUpdate < 70) return;
  lastMeterUpdate = time;
  const meterValue = clamp(inputLevel.rms * 5.5);
  inputPeakHold = clamp(inputLevel.peak * 2.8);
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
  updateTractPressure(time);
  updateMeters(time);
  drawStage(time);
  frameHandle = requestAnimationFrame(frame);
}

function updateTractPressure(time) {
  const sealed = state.articulationAperture < 0.08 || state.glottalClosure > 0.84;
  if (sealed) {
    if (!closureStartedAt) closureStartedAt = time;
    const sourceEnergy = isAwake()
      ? clamp(inputLevel.rms * 4 + state.exciterIntensity * 0.72)
      : 0.28;
    const target = clamp((time - closureStartedAt) / 520 * (0.55 + sourceEnergy));
    fallbackPressure = smoothEnvelope(fallbackPressure, target, 16.67, 48, 250);
    tractPressure = Math.max(tractPressure, fallbackPressure * 0.9);
  } else {
    closureStartedAt = 0;
    fallbackPressure = smoothEnvelope(fallbackPressure, 0, 16.67, 20, 155);
    tractPressure = smoothEnvelope(tractPressure, 0, 16.67, 18, 180);
  }
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

function nearestGraphicHandle(point, handles, maximumDistance = 34) {
  let match = null;
  let distance = maximumDistance;
  for (const item of handles) {
    const nextDistance = Math.hypot(point.x - item.handle.x, point.y - item.handle.y);
    if (nextDistance < distance) {
      distance = nextDistance;
      match = item;
    }
  }
  return match;
}

function tractCoordinates(point, geometry = currentTract) {
  if (!geometry) return null;
  const dx = geometry.origin.x - point.x;
  const dy = geometry.origin.y - point.y;
  let angle = Math.atan2(dy, dx);
  while (angle < geometry.angleStart - Math.PI) angle += Math.PI * 2;
  while (angle > geometry.angleStart + Math.PI * 2) angle -= Math.PI * 2;
  const progress = (angle - geometry.angleStart) / geometry.angleSpan;
  const radius = Math.hypot(dx, dy);
  const diameter = (geometry.radius - radius) / geometry.scale;
  return {
    progress,
    diameter,
    place: clamp((progress * 43 - 12) / 30),
    aperture: clamp((diameter + 0.035) / 1.38),
  };
}

function nearestTractControl(point) {
  if (!currentTract) return null;
  for (const [control, handle, distance] of [
    ["glottis", currentTract.glottis, 34],
    ["velum", currentTract.velum, 34],
    ["constriction", currentTract.constriction, 46],
  ]) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) < distance) {
      return { control, handle };
    }
  }
  const position = tractCoordinates(point);
  if (
    position
    && position.progress >= -0.015
    && position.progress <= 1.03
    && position.diameter >= -0.38
    && position.diameter <= 2.2
  ) {
    return { control: "constriction", handle: point, position };
  }
  return null;
}

function nearestTongueControl(point) {
  const targets = currentTongues.map((tongue) => ({
    ...tongue,
    control: "shape",
  }));
  const selected = currentTongues[selectedTongue];
  if (selected) {
    targets.push({
      ...selected,
      control: "curl",
      handle: selected.curlHandle,
    });
  }
  return nearestGraphicHandle(point, targets, 38);
}

function nearestNoseControl(point) {
  const targets = currentNoses.map((nose) => ({
    ...nose,
    control: "shape",
  }));
  const selected = currentNoses[selectedNose];
  if (selected) {
    targets.push({
      ...selected,
      control: "resonance",
      handle: selected.resonanceHandle,
    });
  }
  return nearestGraphicHandle(point, targets, 38);
}

function positionHandleReadout(handle) {
  const readout = $("handleReadout");
  const left = clamp(handle.x + 18, 8, cssWidth - 180);
  const top = clamp(handle.y - 44, 8, cssHeight - 54);
  readout.style.left = `${left}px`;
  readout.style.top = `${top}px`;
  readout.hidden = false;
}

function showThroatHandleReadout(branch) {
  $("handleName").textContent = `THROAT ${String(branch.index + 1).padStart(2, "0")}`;
  const throat = state.throats[branch.index];
  $("handleValue").textContent = `${percentage(throat.aperture)} OPEN · ${percentage(throat.length)} LONG`;
  positionHandleReadout(branch.handle);
}

function showTongueHandleReadout(geometry) {
  const tongue = state.tongues[geometry.index];
  $("handleName").textContent = `TONGUE ${String(geometry.index + 1).padStart(2, "0")}`;
  $("handleValue").textContent = geometry.control === "curl"
    ? `${percentage(tongue.curl)} CURL · DRAG SIDEWAYS`
    : `${percentage(tongue.position)} FRONT · ${percentage(tongue.height)} CONTACT`;
  positionHandleReadout(geometry.handle);
}

function showNoseHandleReadout(geometry) {
  const nose = state.noses[geometry.index];
  $("handleName").textContent = `NOSE ${String(geometry.index + 1).padStart(2, "0")}`;
  $("handleValue").textContent = geometry.control === "resonance"
    ? `${percentage(nose.resonance)} RESONANCE · DRAG OUTWARD`
    : `${percentage(nose.openness)} VELUM · ${percentage(nose.length)} LONG`;
  positionHandleReadout(geometry.handle);
}

function showBodyHandleReadout(geometry) {
  $("handleName").textContent = geometry.control === "membrane"
    ? "BODY MEMBRANE"
    : "ORAL SPHINCTER";
  $("handleValue").textContent = geometry.control === "membrane"
    ? `${percentage(state.bodyLength)} LONG · ${percentage(state.tension)} TAUT`
    : `${percentage(state.oralClosure)} CLOSED · ${percentage(state.coupling)} COUPLED`;
  positionHandleReadout(geometry.handle);
}

function articulationPlaceLabel(value = state.articulationPlace) {
  const place = clamp(value);
  if (place < 0.08) return "GLOTTAL";
  if (place < 0.34) return "BACK / VELAR";
  if (place < 0.78) return "MID / POSTALVEOLAR";
  if (place < 0.95) return "FRONT / ALVEOLAR";
  return "LIPS / LABIAL";
}

function articulationMannerLabel() {
  if (state.glottalClosure > 0.84) return "GLOTTAL STOP";
  if (state.nasalCoupling > 0.55) return "NASAL";
  if (state.articulationAperture < 0.08) return "STOP";
  if (state.articulationAperture < 0.56) return "FRICATIVE";
  return "OPEN";
}

function showTractHandleReadout(geometry) {
  if (geometry.control === "glottis") {
    $("handleName").textContent = "GLOTTAL VALVE · ʔ";
    $("handleValue").textContent = `${percentage(state.glottalClosure)} SEALED · DRAG TO GATE SOURCE`;
  } else if (geometry.control === "velum") {
    $("handleName").textContent = "VELUM · NASAL ARRAY";
    $("handleValue").textContent = `${percentage(state.nasalCoupling)} OPEN · ${state.noseCount} NOSES`;
  } else {
    $("handleName").textContent = `${articulationPlaceLabel()} CONSTRICTION`;
    $("handleValue").textContent = `${percentage(state.articulationAperture)} APERTURE · ${articulationMannerLabel()}`;
  }
  positionHandleReadout(geometry.handle);
}

function hideHandleReadout() {
  $("handleReadout").hidden = true;
}

function hoverNearbyHandle(event) {
  const point = pointerPosition(event);
  const tract = nearestTractControl(point);
  const tongue = nearestTongueControl(point);
  const nose = nearestNoseControl(point);
  const body = nearestGraphicHandle(point, currentBodyHandles, 38);
  const branch = nearestBranchHandle(point);
  const found = tract || tongue || nose || body || branch;
  canvas.classList.toggle("is-handle-hovered", Boolean(found));
  if (tract) showTractHandleReadout(tract);
  else if (tongue) showTongueHandleReadout(tongue);
  else if (nose) showNoseHandleReadout(nose);
  else if (body) showBodyHandleReadout(body);
  else if (branch) showThroatHandleReadout(branch);
  else hideHandleReadout();
}

function beginDrag(event) {
  const point = pointerPosition(event);
  if (!currentTongues.length) currentTongues = tongueGeometry(currentLayout);
  if (!currentNoses.length) currentNoses = noseGeometry(currentLayout);
  if (!currentBodyHandles.length) currentBodyHandles = bodyHandleGeometry(currentLayout);
  if (!currentTract) currentTract = tractGeometry();
  const tractGeometryMatch = nearestTractControl(point);
  const tongueGeometryMatch = nearestTongueControl(point);
  const noseGeometryMatch = nearestNoseControl(point);
  const bodyGeometryMatch = nearestGraphicHandle(point, currentBodyHandles, 38);
  const branch = nearestBranchHandle(point);
  if (
    !tractGeometryMatch
    && !tongueGeometryMatch
    && !noseGeometryMatch
    && !bodyGeometryMatch
    && !branch
  ) return;
  event.preventDefault();
  if (tractGeometryMatch) {
    const position = tractGeometryMatch.position ?? tractCoordinates(point);
    pointerDrag = {
      type: `tract-${tractGeometryMatch.control}`,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      aperture: state.articulationAperture,
      place: state.articulationPlace,
      glottalClosure: state.glottalClosure,
      nasalCoupling: state.nasalCoupling,
      position,
    };
    if (tractGeometryMatch.control === "constriction" && position) {
      setDirectConstriction(position);
    }
    showTractHandleReadout({
      ...tractGeometryMatch,
      handle: currentTract[tractGeometryMatch.control] ?? point,
    });
    announce(
      tractGeometryMatch.control === "constriction"
        ? "Living tract selected. Drag along the arc for place and across it for aperture."
        : tractGeometryMatch.control === "glottis"
          ? "Glottal valve selected. Drag down to seal the excitation source."
          : "Velum selected. Drag upward to open all nasal branches.",
    );
  } else if (tongueGeometryMatch) {
    selectedTongue = tongueGeometryMatch.index;
    const tongue = state.tongues[selectedTongue];
    pointerDrag = {
      type: tongueGeometryMatch.control === "curl" ? "tongue-curl" : "tongue",
      index: selectedTongue,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      position: tongue.position,
      height: tongue.height,
      curl: tongue.curl,
      side: tongueGeometryMatch.side,
    };
    showTongueHandleReadout(tongueGeometryMatch);
    updateSelectedArticulationUi();
    announce(`Tongue ${selectedTongue + 1} selected. Drag sideways for position and vertically for contact.`);
  } else if (noseGeometryMatch) {
    selectedNose = noseGeometryMatch.index;
    const nose = state.noses[selectedNose];
    pointerDrag = {
      type: noseGeometryMatch.control === "resonance" ? "nose-resonance" : "nose",
      index: selectedNose,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      length: nose.length,
      openness: nose.openness,
      resonance: nose.resonance,
      side: noseGeometryMatch.side,
    };
    showNoseHandleReadout(noseGeometryMatch);
    updateSelectedArticulationUi();
    announce(`Nose ${selectedNose + 1} selected. Drag sideways for length and outward to open its velum.`);
  } else if (bodyGeometryMatch) {
    pointerDrag = {
      type: `body-${bodyGeometryMatch.control}`,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      bodyLength: state.bodyLength,
      tension: state.tension,
      oralClosure: state.oralClosure,
      coupling: state.coupling,
    };
    showBodyHandleReadout(bodyGeometryMatch);
    announce(
      bodyGeometryMatch.control === "membrane"
        ? "Body membrane selected. Drag sideways for length and vertically for tension."
        : "Oral sphincter selected. Drag inward to close the mouths and sideways for coupling.",
    );
  } else {
    selectedThroat = branch.index;
    const throat = state.throats[selectedThroat];
    pointerDrag = {
      type: "throat",
      index: selectedThroat,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      aperture: throat.aperture,
      length: throat.length,
      outerSign: branch.outerSign,
    };
    showThroatHandleReadout(branch);
    updateSelectedThroatUi();
    announce(`Throat ${selectedThroat + 1} selected. Aperture ${percentage(throat.aperture)}, length ${percentage(throat.length)}.`);
  }
  canvas.setPointerCapture?.(event.pointerId);
  canvas.classList.add("is-dragging");
}

function setDirectConstriction(position) {
  const previousAperture = state.articulationAperture;
  state.articulationPlace = clamp(position.place);
  state.articulationAperture = clamp(position.aperture);
  state.oralClosure = 1 - state.articulationAperture;
  state.glottalClosure = 0;
  state.nasalCoupling = 0;
  state.articulationManner = state.articulationAperture < 0.08
    ? "stop"
    : state.articulationAperture < 0.56
      ? "fricative"
      : "vowel";
  state.phoneme = "";
  state.specimen = "mutant";
  if (previousAperture < 0.08 && state.articulationAperture > 0.16) {
    triggerReleaseBurst(0, {
      place: state.articulationPlace,
      strength: clamp(0.42 + tractPressure * 0.58),
    });
  }
  currentTract = tractGeometry();
  showTractHandleReadout({
    control: "constriction",
    handle: currentTract.constriction,
  });
  markAudioDirty();
  updateUi();
}

function continueDrag(event) {
  if (!pointerDrag) {
    hoverNearbyHandle(event);
    return;
  }
  if (event.pointerId !== pointerDrag.pointerId) return;
  event.preventDefault();
  const point = pointerPosition(event);
  if (pointerDrag.type === "tract-constriction") {
    const position = tractCoordinates(point);
    if (position) setDirectConstriction(position);
  } else if (pointerDrag.type === "tract-glottis") {
    state.glottalClosure = clamp(
      pointerDrag.glottalClosure
        + (point.y - pointerDrag.startY) / Math.max(70, cssHeight * 0.15),
    );
    state.articulationManner = state.glottalClosure > 0.84 ? "glottal-stop" : "vowel";
    state.phoneme = state.glottalClosure > 0.84 ? "glottal" : "";
    currentTract = tractGeometry();
    showTractHandleReadout({ control: "glottis", handle: currentTract.glottis });
    updateUi();
  } else if (pointerDrag.type === "tract-velum") {
    state.nasalCoupling = clamp(
      pointerDrag.nasalCoupling
        - (point.y - pointerDrag.startY) / Math.max(70, cssHeight * 0.16),
    );
    for (let index = 0; index < state.noseCount; index += 1) {
      state.noses[index].openness = state.nasalCoupling;
    }
    state.articulationManner = state.nasalCoupling > 0.55 ? "nasal" : "vowel";
    state.phoneme = "";
    currentTract = tractGeometry();
    showTractHandleReadout({ control: "velum", handle: currentTract.velum });
    updateUi();
  } else if (pointerDrag.type === "tongue") {
    const tongue = state.tongues[pointerDrag.index];
    const previousHeight = tongue.height;
    tongue.position = clamp(
      pointerDrag.position
        + (point.x - pointerDrag.startX) / Math.max(80, currentLayout.junction.x - currentLayout.root.x),
    );
    tongue.height = clamp(
      pointerDrag.height
        - (point.y - pointerDrag.startY) * pointerDrag.side / Math.max(54, currentLayout.bodyRadius * 1.25),
    );
    if (previousHeight > 0.92 && tongue.height < 0.78) triggerReleaseBurst(pointerDrag.index);
    state.phoneme = "";
    state.specimen = "mutant";
    currentTongues = tongueGeometry(currentLayout);
    showTongueHandleReadout(currentTongues[pointerDrag.index]);
    updateSelectedArticulationUi();
  } else if (pointerDrag.type === "tongue-curl") {
    const tongue = state.tongues[pointerDrag.index];
    tongue.curl = clamp(
      pointerDrag.curl
        + (point.x - pointerDrag.startX) / Math.max(64, currentLayout.bodyRadius * 1.5),
    );
    state.phoneme = "";
    state.specimen = "mutant";
    currentTongues = tongueGeometry(currentLayout);
    showTongueHandleReadout({
      ...currentTongues[pointerDrag.index],
      control: "curl",
      handle: currentTongues[pointerDrag.index].curlHandle,
    });
    updateSelectedArticulationUi();
  } else if (pointerDrag.type === "nose") {
    const nose = state.noses[pointerDrag.index];
    nose.length = clamp(
      pointerDrag.length
        + (point.x - pointerDrag.startX) / Math.max(58, currentLayout.bodyRadius * 1.4),
    );
    nose.openness = clamp(
      pointerDrag.openness
        + (point.y - pointerDrag.startY) * pointerDrag.side / Math.max(58, currentLayout.bodyRadius * 1.5),
    );
    state.phoneme = "";
    state.specimen = "mutant";
    currentNoses = noseGeometry(currentLayout);
    showNoseHandleReadout(currentNoses[pointerDrag.index]);
    updateSelectedArticulationUi();
  } else if (pointerDrag.type === "nose-resonance") {
    const nose = state.noses[pointerDrag.index];
    nose.resonance = clamp(
      pointerDrag.resonance
        + (point.x - pointerDrag.startX) / Math.max(54, currentLayout.bodyRadius * 1.25),
    );
    state.phoneme = "";
    state.specimen = "mutant";
    currentNoses = noseGeometry(currentLayout);
    showNoseHandleReadout({
      ...currentNoses[pointerDrag.index],
      control: "resonance",
      handle: currentNoses[pointerDrag.index].resonanceHandle,
    });
    updateSelectedArticulationUi();
  } else if (pointerDrag.type === "body-membrane") {
    state.bodyLength = clamp(
      pointerDrag.bodyLength
        + (point.x - pointerDrag.startX) / Math.max(90, cssWidth * 0.18),
    );
    state.tension = clamp(
      pointerDrag.tension
        - (point.y - pointerDrag.startY) / Math.max(70, cssHeight * 0.2),
    );
    state.specimen = "mutant";
    currentLayout = anatomyLayout(cssWidth, cssHeight, state);
    currentBodyHandles = bodyHandleGeometry(currentLayout);
    showBodyHandleReadout(currentBodyHandles[0]);
    updateUi();
  } else if (pointerDrag.type === "body-closure") {
    state.oralClosure = clamp(
      pointerDrag.oralClosure
        - (point.y - pointerDrag.startY) / Math.max(70, cssHeight * 0.18),
    );
    state.coupling = clamp(
      pointerDrag.coupling
        - (point.x - pointerDrag.startX) / Math.max(80, cssWidth * 0.16),
      0,
      0.72,
    );
    state.phoneme = "";
    state.specimen = "mutant";
    currentLayout = anatomyLayout(cssWidth, cssHeight, state);
    currentBodyHandles = bodyHandleGeometry(currentLayout);
    showBodyHandleReadout(currentBodyHandles[1]);
    updateUi();
  } else {
    const throat = state.throats[pointerDrag.index];
    throat.length = clamp(pointerDrag.length + (point.x - pointerDrag.startX) / (cssWidth * 0.24));
    throat.aperture = clamp(
      pointerDrag.aperture + (point.y - pointerDrag.startY) * pointerDrag.outerSign / (cssHeight * 0.15),
      0.05,
      1,
    );
    selectedThroat = pointerDrag.index;
    currentLayout = anatomyLayout(cssWidth, cssHeight, state);
    showThroatHandleReadout(currentLayout.branches[selectedThroat]);
    updateSelectedThroatUi();
  }
  state.specimen = "mutant";
  markAudioDirty();
}

function endDrag(event) {
  if (!pointerDrag || (event.pointerId !== undefined && event.pointerId !== pointerDrag.pointerId)) return;
  canvas.releasePointerCapture?.(pointerDrag.pointerId);
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  canvas.classList.remove("is-handle-hovered");
  hideHandleReadout();
  updateUi();
}

function selectNearbyHandle(event) {
  const point = pointerPosition(event);
  const tongue = nearestGraphicHandle(point, currentTongues);
  const nose = nearestGraphicHandle(point, currentNoses);
  const branch = nearestBranchHandle(point);
  const reset = specimenState(SPECIMENS[state.specimen] ? state.specimen : "triune");
  if (tongue) {
    selectedTongue = tongue.index;
    state.tongues[selectedTongue] = { ...reset.tongues[selectedTongue] };
    state.phoneme = "";
    markAudioDirty();
    updateUi();
    announce(`Tongue ${selectedTongue + 1} returned to its specimen anatomy.`);
    return;
  }
  if (nose) {
    selectedNose = nose.index;
    state.noses[selectedNose] = { ...reset.noses[selectedNose] };
    state.phoneme = "";
    markAudioDirty();
    updateUi();
    announce(`Nose ${selectedNose + 1} returned to its specimen anatomy.`);
    return;
  }
  if (!branch) return;
  selectedThroat = branch.index;
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
    const wasMuted = state.throats[selectedThroat].muted;
    state.throats[selectedThroat].muted = !wasMuted;
    if (wasMuted) triggerReleaseBurst(selectedThroat);
    markAudioDirty();
    updateUi();
    announce(`Throat ${selectedThroat + 1} ${state.throats[selectedThroat].muted ? "sealed" : "opened"}.`);
    return;
  }
  const presets = Object.keys(SPECIMENS).slice(0, 9);
  if (/^[1-9]$/.test(event.key) && presets[Number(event.key) - 1]) {
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

for (const button of $("sourceButtons").querySelectorAll("[data-source]")) {
  button.addEventListener("click", () => selectSourceMode(button.dataset.source));
}

for (const button of $("phonemeButtons").querySelectorAll("[data-phoneme]")) {
  button.addEventListener("click", () => applyPhoneme(button.dataset.phoneme));
}

$("typingModeButton").addEventListener("click", toggleTypingMode);

for (const button of $("tongueButtons").querySelectorAll("[data-tongue]")) {
  button.addEventListener("click", () => {
    const index = Number(button.dataset.tongue);
    if (index >= state.tongueCount) return;
    selectedTongue = index;
    updateSelectedArticulationUi();
    announce(`Tongue ${selectedTongue + 1} selected.`);
  });
}

for (const button of $("noseButtons").querySelectorAll("[data-nose]")) {
  button.addEventListener("click", () => {
    const index = Number(button.dataset.nose);
    if (index >= state.noseCount) return;
    selectedNose = index;
    updateSelectedArticulationUi();
    announce(`Nose ${selectedNose + 1} selected.`);
  });
}

$("throatCount").addEventListener("input", () => {
  state.throatCount = Math.round(clamp(Number($("throatCount").value), 1, MAX_THROATS));
  selectedThroat = Math.min(selectedThroat, state.throatCount - 1);
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
});

$("tongueCount").addEventListener("input", () => {
  state.tongueCount = Math.round(clamp(Number($("tongueCount").value), 1, MAX_TONGUES));
  selectedTongue = Math.min(selectedTongue, state.tongueCount - 1);
  state.phoneme = "";
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
});

$("noseCount").addEventListener("input", () => {
  state.noseCount = Math.round(clamp(Number($("noseCount").value), 1, MAX_NOSES));
  selectedNose = Math.min(selectedNose, state.noseCount - 1);
  state.phoneme = "";
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
});

bindRange("level", "level");
bindRange("inputTrim", "inputTrim", { maximum: 1.35 });
bindRange("inputStability", "inputStability");
bindRange("bodyLength", "bodyLength", { custom: true });
bindRange("tension", "tension", { custom: true });
bindRange("mutation", "mutation", { custom: true });
bindRange("wet", "wet");
bindRange("dry", "dry", { maximum: 0.5 });
bindRange("growl", "growl");
bindRange("coupling", "coupling", { maximum: 0.72 });
bindRange("spread", "spread");
bindRange("exciterPitch", "exciterPitch", { minimum: 40, maximum: 420 });
bindRange("exciterIntensity", "exciterIntensity");
bindRange("exciterTenseness", "exciterTenseness");
bindRange("exciterBreath", "exciterBreath");
bindRange("exciterVibrato", "exciterVibrato");
bindRange("exciterWobble", "exciterWobble");

$("articulationPlace").addEventListener("input", () => {
  setDirectConstriction({
    place: clamp(Number($("articulationPlace").value)),
    aperture: state.articulationAperture,
  });
});

$("articulationAperture").addEventListener("input", () => {
  setDirectConstriction({
    place: state.articulationPlace,
    aperture: clamp(Number($("articulationAperture").value)),
  });
});

$("articulationVoicing").addEventListener("input", () => {
  state.articulationVoicing = clamp(Number($("articulationVoicing").value));
  state.phoneme = "";
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
});

function bindSelectedArticulatorRange(id, collection, property, selectedIndex) {
  $(id).addEventListener("input", () => {
    const index = selectedIndex();
    const item = state[collection][index];
    const previous = item[property];
    item[property] = clamp(Number($(id).value));
    if (collection === "tongues" && property === "position" && index === 0) {
      state.articulationPlace = item[property];
    }
    if (collection === "noses" && property === "openness") {
      state.nasalCoupling = state.noses
        .slice(0, state.noseCount)
        .reduce((sum, nose) => sum + clamp(nose.openness), 0) / Math.max(1, state.noseCount);
    }
    if (
      collection === "tongues"
      && property === "height"
      && previous > 0.92
      && item[property] < 0.78
    ) triggerReleaseBurst(index);
    state.phoneme = "";
    state.specimen = "mutant";
    markAudioDirty();
    updateUi();
  });
}

bindSelectedArticulatorRange(
  "selectedTonguePosition",
  "tongues",
  "position",
  () => selectedTongue,
);
bindSelectedArticulatorRange(
  "selectedTongueHeight",
  "tongues",
  "height",
  () => selectedTongue,
);
bindSelectedArticulatorRange(
  "selectedTongueCurl",
  "tongues",
  "curl",
  () => selectedTongue,
);
bindSelectedArticulatorRange(
  "selectedNoseOpenness",
  "noses",
  "openness",
  () => selectedNose,
);
bindSelectedArticulatorRange(
  "selectedNoseLength",
  "noses",
  "length",
  () => selectedNose,
);
bindSelectedArticulatorRange(
  "selectedNoseResonance",
  "noses",
  "resonance",
  () => selectedNose,
);

$("oralClosure").addEventListener("input", () => {
  const previous = state.oralClosure;
  state.oralClosure = clamp(Number($("oralClosure").value));
  state.articulationAperture = 1 - state.oralClosure;
  if (previous > 0.9 && state.oralClosure < 0.35) triggerReleaseBurst(0);
  state.phoneme = "";
  state.specimen = "mutant";
  markAudioDirty();
  updateUi();
});

$("selectedAperture").addEventListener("input", () => {
  const previous = state.throats[selectedThroat].aperture;
  state.throats[selectedThroat].aperture = clamp(Number($("selectedAperture").value), 0.05, 1);
  if (previous <= 0.1 && state.throats[selectedThroat].aperture > 0.13) {
    triggerReleaseBurst(selectedThroat);
  }
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
  const wasMuted = state.throats[selectedThroat].muted;
  state.throats[selectedThroat].muted = !wasMuted;
  if (wasMuted) triggerReleaseBurst(selectedThroat);
  markAudioDirty();
  updateUi();
});

for (const button of [$("audioButton"), $("awakenButton"), $("micButton")]) {
  button.addEventListener("click", toggleAudio);
}
$("stopButton").addEventListener("click", () => void severAudio());
$("panicButton").addEventListener("click", () => void severAudio());
$("recordButton").addEventListener("click", toggleRecording);
$("clearTake").addEventListener("click", clearLastTake);

canvas.addEventListener("pointerdown", beginDrag);
canvas.addEventListener("pointermove", continueDrag);
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("pointerleave", () => {
  if (pointerDrag) return;
  canvas.classList.remove("is-handle-hovered");
  hideHandleReadout();
});
canvas.addEventListener("dblclick", selectNearbyHandle);
canvas.addEventListener("keydown", handleCanvasKey);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void severAudio("Emergency sever complete.");
    return;
  }
  if (handleTypingKeyDown(event)) return;
  if (state.typingMode) return;
  const editing = isEditableTypingTarget(event.target);
  if (!editing && event.key.toLowerCase() === "m") {
    event.preventDefault();
    toggleMicrophone();
  } else if (!editing && event.key.toLowerCase() === "g") {
    event.preventDefault();
    selectSourceMode("glottis");
    if (!isAwake()) void activateSource("glottis");
  } else if (!editing && event.key.toLowerCase() === "h") {
    event.preventDefault();
    selectSourceMode("hybrid");
    if (!isAwake()) void activateSource("hybrid");
  }
});

document.addEventListener("keyup", (event) => {
  handleTypingKeyUp(event);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && (isAwake() || state.starting)) {
    void severAudio("Audio stopped while the page was hidden.");
  } else if (document.hidden && heldPhonemeKeys.size) {
    clearHeldPhonemes({ burst: false });
  }
});

globalThis.addEventListener?.("blur", () => {
  if (heldPhonemeKeys.size) clearHeldPhonemes({ burst: isAwake() });
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
  for (const source of [
    graph?.exciter?.pulse,
    graph?.exciter?.vibrato,
    graph?.exciter?.wobble,
    graph?.exciter?.noise,
  ]) {
    try {
      source?.stop?.();
    } catch {
      // Internal sources are one-shot Web Audio nodes.
    }
  }
  cancelAnimationFrame(frameHandle);
});

new ResizeObserver(resizeStage).observe(stageWrap);
resizeStage();
updateUi();
frameHandle = requestAnimationFrame(frame);
