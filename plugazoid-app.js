import { connectAudioOutput } from "./src/audio-output-manager.js";
import {
  PLUGAZOID_DEFAULTS,
  PLUGAZOID_LIMITS,
  PLUGAZOID_PRESETS,
  classifyPluginArtifact,
  decibelsToGain,
  meterPercentage,
  outputLevelToGain,
  rmsToDecibels,
  sanitizePlugazoidSettings,
} from "./src/plugazoid.js";

const byId = (id) => document.getElementById(id);

const ui = {
  audioButton: byId("audioButton"),
  audioState: byId("audioState"),
  audioError: byId("audioError"),
  artifactProbe: byId("artifactProbe"),
  artifactReport: byId("artifactReport"),
  bypassButton: byId("bypassButton"),
  drive: byId("drive"),
  driveOut: byId("driveOut"),
  inputLevelOut: byId("inputLevelOut"),
  inputState: byId("inputState"),
  inputSummary: byId("inputSummary"),
  inputTrim: byId("inputTrim"),
  inputTrimOut: byId("inputTrimOut"),
  liveStatus: byId("liveStatus"),
  micButton: byId("micButton"),
  micButtonHint: byId("micButtonHint"),
  micButtonLabel: byId("micButtonLabel"),
  mix: byId("mix"),
  mixOut: byId("mixOut"),
  outputLevel: byId("outputLevel"),
  outputLevelMeterOut: byId("outputLevelMeterOut"),
  outputLevelOut: byId("outputLevelOut"),
  outputState: byId("outputState"),
  pluginModule: byId("pluginModule"),
  pluginState: byId("pluginState"),
  preset: byId("preset"),
  processorRuntime: byId("processorRuntime"),
  processorSummary: byId("processorSummary"),
  rack: document.querySelector(".plugazoid-rack"),
  resetButton: byId("resetButton"),
  runtimePill: byId("runtimePill"),
  runtimeState: byId("runtimeState"),
  stageReadout: byId("stageReadout"),
  testToneButton: byId("testToneButton"),
  tone: byId("tone"),
  toneOut: byId("toneOut"),
  wasmState: byId("wasmState"),
};

const audio = {
  context: null,
  inputGain: null,
  inputAnalyser: null,
  processor: null,
  outputAnalyser: null,
  masterGain: null,
  limiter: null,
  releaseOutput: null,
  microphoneSource: null,
  microphoneStream: null,
  testOscillator: null,
  testGain: null,
};

let settings = sanitizePlugazoidSettings(PLUGAZOID_DEFAULTS);
let audioStarting = false;
let microphoneStarting = false;
let microphoneRequest = 0;
let meterFrame = 0;
let inputSamples = null;
let outputSamples = null;
let inputMode = "none";
let destroyed = false;
let pendingDisarmMessage = "";

function announce(message) {
  ui.liveStatus.textContent = "";
  window.requestAnimationFrame(() => {
    ui.liveStatus.textContent = message;
  });
}

function showError(message = "") {
  ui.audioError.hidden = !message;
  ui.audioError.textContent = message;
}

function formatDecibels(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= -99) return "−∞ dB";
  return (number < 0 ? "−" + Math.abs(number).toFixed(1) : number.toFixed(1)) + " dB";
}

function formatTone(value) {
  const hertz = Number(value);
  return hertz >= 1_000
    ? (hertz / 1_000).toFixed(hertz >= 10_000 ? 1 : 2).replace(/\.0+$/, "") + " kHz"
    : Math.round(hertz) + " Hz";
}

function setAudioParameter(name, value, timeConstant = 0.012) {
  const parameter = audio.processor?.parameters?.get(name);
  if (!parameter || !audio.context) return;
  const now = audio.context.currentTime;
  parameter.cancelScheduledValues(now);
  parameter.setTargetAtTime(value, now, timeConstant);
}

function setGainParameter(parameter, value, timeConstant = 0.012) {
  if (!parameter || !audio.context) return;
  const now = audio.context.currentTime;
  parameter.cancelScheduledValues(now);
  parameter.setTargetAtTime(value, now, timeConstant);
}

function renderSettings() {
  ui.inputTrim.value = String(settings.inputTrimDb);
  ui.drive.value = String(settings.driveDb);
  ui.tone.value = String(settings.toneHz);
  ui.mix.value = String(settings.mix);
  ui.outputLevel.value = String(settings.outputLevel);
  ui.bypassButton.setAttribute("aria-pressed", String(settings.bypassed));
  ui.bypassButton.textContent = settings.bypassed ? "Resume processor" : "Bypass processor";
  ui.pluginModule.classList.toggle("is-bypassed", settings.bypassed);

  let customOption = ui.preset.querySelector('option[value="custom"]');
  if (settings.preset === "custom" && !customOption) {
    customOption = document.createElement("option");
    customOption.value = "custom";
    customOption.textContent = "Custom";
    ui.preset.append(customOption);
  }
  ui.preset.value = settings.preset;

  ui.inputTrimOut.textContent = formatDecibels(settings.inputTrimDb);
  ui.driveOut.textContent = formatDecibels(settings.driveDb);
  ui.toneOut.textContent = formatTone(settings.toneHz);
  ui.mixOut.textContent = Math.round(settings.mix * 100) + "%";
  ui.outputLevelOut.textContent = Math.round(settings.outputLevel * 100) + "%";
  ui.processorSummary.textContent = settings.bypassed
    ? "bypassed"
    : settings.driveDb.toFixed(1).replace(/\.0$/, "") + " dB · " + Math.round(settings.mix * 100) + "% wet";
  ui.pluginState.textContent = "Port Drive · " + (settings.bypassed ? "bypassed" : "active");

  ui.rack.style.setProperty("--drive", String(settings.driveDb / PLUGAZOID_LIMITS.driveDb[1]));
  ui.rack.style.setProperty(
    "--tone",
    String((settings.toneHz - PLUGAZOID_LIMITS.toneHz[0]) / (PLUGAZOID_LIMITS.toneHz[1] - PLUGAZOID_LIMITS.toneHz[0])),
  );
  ui.rack.style.setProperty("--mix", String(settings.mix));

  setGainParameter(audio.inputGain?.gain, decibelsToGain(settings.inputTrimDb));
  setGainParameter(audio.masterGain?.gain, outputLevelToGain(settings.outputLevel), 0.018);
  setAudioParameter("driveDb", settings.driveDb);
  setAudioParameter("toneHz", settings.toneHz);
  setAudioParameter("mix", settings.mix);
  setAudioParameter("bypass", settings.bypassed ? 1 : 0, 0.006);
  renderTransportState();
}

function applySettings(values, { announceChange = false } = {}) {
  settings = sanitizePlugazoidSettings({ ...settings, ...values });
  renderSettings();
  if (announceChange) announce("Port Drive settings updated.");
}

function renderTransportState() {
  const armed = Boolean(audio.context && audio.context.state !== "closed");
  const inputActive = inputMode !== "none";
  ui.audioButton.setAttribute("aria-pressed", String(armed));
  ui.audioButton.classList.toggle("is-on", armed);
  ui.audioState.textContent = armed ? "on" : "off";
  ui.runtimePill.classList.toggle("is-armed", armed);
  ui.runtimeState.textContent = armed
    ? "audio on · worklet active"
    : "audio off · worklet waiting";

  ui.micButton.setAttribute("aria-pressed", String(inputMode === "microphone"));
  ui.micButton.classList.toggle("is-live", inputMode === "microphone");
  ui.micButton.disabled = microphoneStarting || audioStarting;
  ui.micButtonLabel.textContent = microphoneStarting
    ? "Connecting…"
    : inputMode === "microphone"
      ? "Disconnect mic"
      : "Connect mic";
  ui.micButtonHint.textContent = inputMode === "microphone"
    ? "live through Port Drive"
    : armed
      ? "permission on demand"
      : "turn on Audio first";

  ui.testToneButton.setAttribute("aria-pressed", String(inputMode === "test"));
  ui.testToneButton.textContent = inputMode === "test" ? "Stop signal" : "Test signal";
  ui.testToneButton.disabled = audioStarting;
  ui.inputState.textContent = inputMode === "microphone"
    ? "microphone live"
    : inputMode === "test"
      ? "110 Hz reference"
      : "disconnected";
  ui.inputSummary.textContent = microphoneStarting
    ? "requesting permission"
    : inputMode === "microphone"
      ? "microphone live"
      : inputMode === "test"
        ? "test signal live"
        : "microphone off";
  ui.outputState.textContent = armed
    ? inputActive
      ? settings.bypassed ? "direct / bypassed" : "processor live"
      : "ready"
    : "muted";
  ui.rack.classList.toggle("is-flowing", armed && inputActive);
  ui.stageReadout.textContent = [
    "VST3 SOURCE PORT",
    inputMode === "microphone" ? "MIC LIVE" : inputMode === "test" ? "TEST LIVE" : "MIC OFF",
    armed ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
}

function analyserRms(analyser, samples) {
  if (!analyser) return 0;
  const required = analyser.fftSize;
  let target = samples;
  if (!target || target.length !== required) target = new Float32Array(required);
  analyser.getFloatTimeDomainData(target);
  let sum = 0;
  for (let index = 0; index < target.length; index += 1) {
    const sample = Number.isFinite(target[index]) ? target[index] : 0;
    sum += sample * sample;
  }
  return { rms: Math.sqrt(sum / Math.max(1, target.length)), samples: target };
}

function meterTick() {
  meterFrame = 0;
  if (!audio.context || audio.context.state === "closed" || document.hidden) return;

  const inputReading = analyserRms(audio.inputAnalyser, inputSamples);
  const outputReading = analyserRms(audio.outputAnalyser, outputSamples);
  inputSamples = inputReading.samples;
  outputSamples = outputReading.samples;

  const inputLevel = meterPercentage(inputReading.rms) / 100;
  const outputLevel = meterPercentage(outputReading.rms) / 100;
  ui.rack.style.setProperty("--input-level", inputLevel.toFixed(3));
  ui.rack.style.setProperty("--output-level", outputLevel.toFixed(3));
  ui.inputLevelOut.textContent = formatDecibels(rmsToDecibels(inputReading.rms));
  ui.outputLevelMeterOut.textContent = formatDecibels(rmsToDecibels(outputReading.rms));
  meterFrame = window.requestAnimationFrame(meterTick);
}

function startMeter() {
  if (meterFrame || document.hidden) return;
  meterFrame = window.requestAnimationFrame(meterTick);
}

function stopMeter() {
  if (meterFrame) window.cancelAnimationFrame(meterFrame);
  meterFrame = 0;
  inputSamples = null;
  outputSamples = null;
  ui.rack.style.setProperty("--input-level", "0");
  ui.rack.style.setProperty("--output-level", "0");
  ui.inputLevelOut.textContent = "−∞ dB";
  ui.outputLevelMeterOut.textContent = "−∞ dB";
}

function safelyDisconnect(node) {
  try {
    node?.disconnect();
  } catch {
    // The context may already be closing.
  }
}

function stopMicrophone({ render = true } = {}) {
  microphoneRequest += 1;
  microphoneStarting = false;
  safelyDisconnect(audio.microphoneSource);
  audio.microphoneSource = null;
  if (audio.microphoneStream) {
    for (const track of audio.microphoneStream.getTracks()) track.stop();
  }
  audio.microphoneStream = null;
  if (inputMode === "microphone") inputMode = "none";
  if (render) renderTransportState();
}

function stopTestTone({ render = true } = {}) {
  if (audio.testOscillator) {
    try {
      audio.testOscillator.stop();
    } catch {
      // Oscillators are one-shot and may already be stopped.
    }
  }
  safelyDisconnect(audio.testOscillator);
  safelyDisconnect(audio.testGain);
  audio.testOscillator = null;
  audio.testGain = null;
  if (inputMode === "test") inputMode = "none";
  if (render) renderTransportState();
}

function stopInput({ render = true } = {}) {
  stopMicrophone({ render: false });
  stopTestTone({ render: false });
  inputMode = "none";
  if (render) renderTransportState();
}

function configureAnalyser(analyser) {
  analyser.fftSize = 2_048;
  analyser.smoothingTimeConstant = 0;
}

function processorFailure() {
  showError("The realtime processor stopped unexpectedly. Turn Audio off, then on to rebuild it.");
  ui.processorRuntime.textContent = "processor error";
  announce("Port Drive processor error.");
}

async function armAudio() {
  if (audio.context || audioStarting || destroyed) return Boolean(audio.context);
  showError();
  pendingDisarmMessage = "";
  const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextConstructor) {
    showError("This browser does not expose Web Audio.");
    return false;
  }

  audioStarting = true;
  renderTransportState();
  let context = null;
  try {
    context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet || typeof window.AudioWorkletNode !== "function") {
      throw new Error("AudioWorklet is unavailable in this browser.");
    }
    await context.audioWorklet.addModule(new URL("./src/plugazoid-processor.js", import.meta.url));
    if (destroyed || document.hidden || pendingDisarmMessage) {
      const interruption = pendingDisarmMessage;
      pendingDisarmMessage = "";
      await context.close();
      if (interruption) announce(interruption);
      return false;
    }

    const inputGain = context.createGain();
    const inputAnalyser = context.createAnalyser();
    const processor = new AudioWorkletNode(context, "morphazoid-plugazoid-port", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    const outputAnalyser = context.createAnalyser();
    const masterGain = context.createGain();
    const limiter = context.createDynamicsCompressor();

    configureAnalyser(inputAnalyser);
    configureAnalyser(outputAnalyser);
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;

    inputGain.connect(inputAnalyser);
    inputAnalyser.connect(processor);
    processor.connect(outputAnalyser);
    outputAnalyser.connect(masterGain);
    masterGain.connect(limiter);

    audio.context = context;
    audio.inputGain = inputGain;
    audio.inputAnalyser = inputAnalyser;
    audio.processor = processor;
    audio.outputAnalyser = outputAnalyser;
    audio.masterGain = masterGain;
    audio.limiter = limiter;
    audio.releaseOutput = connectAudioOutput(context, limiter);

    processor.onprocessorerror = processorFailure;
    processor.port.onmessage = ({ data }) => {
      if (data?.type !== "ready") return;
      ui.processorRuntime.textContent = data.backend || "AudioWorklet";
      ui.wasmState.textContent = data.wasmSlot ? "adapter seam ready" : "not exposed";
    };

    await context.resume();
    renderSettings();
    startMeter();
    announce("Audio on. Port Drive is ready; the microphone is still disconnected.");
    return true;
  } catch (error) {
    if (context && context.state !== "closed") await context.close().catch(() => {});
    showError(error instanceof Error ? error.message : "Could not start the audio processor.");
    announce("Audio could not start.");
    return false;
  } finally {
    audioStarting = false;
    renderTransportState();
    if (pendingDisarmMessage && audio.context) {
      const interruption = pendingDisarmMessage;
      pendingDisarmMessage = "";
      void disarmAudio(interruption);
    }
  }
}

async function disarmAudio(message = "Audio off.") {
  if (audioStarting) {
    pendingDisarmMessage = message;
    stopInput();
    stopMeter();
    return;
  }
  pendingDisarmMessage = "";
  stopInput({ render: false });
  stopMeter();
  const context = audio.context;
  const releaseOutput = audio.releaseOutput;

  audio.context = null;
  audio.inputGain = null;
  audio.inputAnalyser = null;
  audio.processor = null;
  audio.outputAnalyser = null;
  audio.masterGain = null;
  audio.limiter = null;
  audio.releaseOutput = null;

  releaseOutput?.();
  if (context && context.state !== "closed") await context.close().catch(() => {});
  ui.processorRuntime.textContent = "AudioWorklet JS";
  ui.wasmState.textContent = typeof WebAssembly === "object" ? "adapter seam ready" : "unavailable";
  renderTransportState();
  announce(message);
}

function microphoneErrorMessage(error) {
  if (!window.isSecureContext) {
    return "Microphone access needs HTTPS or localhost.";
  }
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Microphone permission was denied. You can still use the test signal.";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No microphone was found.";
  }
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "The microphone is busy or unavailable to this browser.";
  }
  return "The microphone could not be connected.";
}

async function startMicrophone() {
  if (!audio.context) {
    showError("Turn on Audio first. Connecting the microphone never arms audio implicitly.");
    announce("Turn on Audio before connecting the microphone.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showError("Microphone capture is unavailable here. Use HTTPS or localhost.");
    return;
  }

  stopTestTone({ render: false });
  showError();
  microphoneStarting = true;
  const request = ++microphoneRequest;
  renderTransportState();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
        latency: { ideal: 0.01 },
      },
      video: false,
    });
    if (request !== microphoneRequest || !audio.context || destroyed) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const source = audio.context.createMediaStreamSource(stream);
    source.connect(audio.inputGain);
    audio.microphoneStream = stream;
    audio.microphoneSource = source;
    inputMode = "microphone";
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (audio.microphoneStream === stream) {
          stopMicrophone();
          announce("Microphone disconnected.");
        }
      }, { once: true });
    }
    await audio.context.resume();
    announce("Microphone connected through Port Drive.");
  } catch (error) {
    if (request === microphoneRequest) showError(microphoneErrorMessage(error));
  } finally {
    if (request === microphoneRequest) microphoneStarting = false;
    renderTransportState();
  }
}

async function startTestTone() {
  if (!audio.context) {
    showError("Turn on Audio first. The test signal never arms audio implicitly.");
    announce("Turn on Audio before starting the test signal.");
    return;
  }
  stopMicrophone({ render: false });
  showError();
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 110;
  gain.gain.value = 0.045;
  oscillator.connect(gain);
  gain.connect(audio.inputGain);
  oscillator.start();
  audio.testOscillator = oscillator;
  audio.testGain = gain;
  inputMode = "test";
  await audio.context.resume();
  renderTransportState();
  announce("110 hertz test signal connected through Port Drive.");
}

ui.audioButton.addEventListener("click", () => {
  if (audio.context) void disarmAudio();
  else void armAudio();
});

ui.micButton.addEventListener("click", () => {
  if (inputMode === "microphone" || microphoneStarting) {
    stopMicrophone();
    announce("Microphone disconnected.");
  } else {
    void startMicrophone();
  }
});

ui.testToneButton.addEventListener("click", () => {
  if (inputMode === "test") {
    stopTestTone();
    announce("Test signal stopped.");
  } else {
    void startTestTone();
  }
});

ui.preset.addEventListener("change", () => {
  const preset = PLUGAZOID_PRESETS.find(({ id }) => id === ui.preset.value);
  if (!preset) return;
  applySettings({ ...preset.values, preset: preset.id }, { announceChange: true });
});

for (const [element, key] of [
  [ui.inputTrim, "inputTrimDb"],
  [ui.drive, "driveDb"],
  [ui.tone, "toneHz"],
  [ui.mix, "mix"],
]) {
  element.addEventListener("input", () => {
    applySettings({ [key]: Number(element.value), preset: "custom" });
  });
}

ui.outputLevel.addEventListener("input", () => {
  applySettings({ outputLevel: Number(ui.outputLevel.value) });
});

ui.bypassButton.addEventListener("click", () => {
  applySettings({ bypassed: !settings.bypassed }, { announceChange: true });
});

ui.resetButton.addEventListener("click", () => {
  applySettings(PLUGAZOID_DEFAULTS, { announceChange: true });
  audio.processor?.port.postMessage({ type: "reset", bypassed: false });
});

ui.artifactProbe.addEventListener("change", () => {
  const artifact = classifyPluginArtifact(ui.artifactProbe.files?.[0]?.name);
  ui.artifactReport.textContent = artifact.message;
  announce(artifact.message);
  ui.artifactProbe.value = "";
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || inputMode === "none") return;
  stopInput();
  announce("Live input stopped.");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && audio.context) {
    void disarmAudio("Audio and microphone stopped while the page was hidden.");
  } else if (!document.hidden && audio.context) {
    startMeter();
  }
});

window.addEventListener("pagehide", () => {
  destroyed = true;
  void disarmAudio("");
}, { once: true });

ui.wasmState.textContent = typeof WebAssembly === "object" ? "adapter seam ready" : "unavailable";
renderSettings();
