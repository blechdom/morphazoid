import { connectAudioOutput } from "./audio-output-manager.js";
import {
  PLUGAZOID_DEFAULTS,
  PLUGAZOID_STARTER_WAMS,
  PLUGAZOID_WAM_ENDPOINTS,
  decibelsToGain,
  meterPercentage,
  outputLevelToGain,
  prepareWamCatalog,
  rmsToDecibels,
  sanitizePlugazoidSettings,
} from "./plugazoid.js";

const byId = (id) => document.getElementById(id);

const ui = {
  audioButton: byId("audioButton"),
  audioState: byId("audioState"),
  audioError: byId("audioError"),
  bypassButton: byId("bypassButton"),
  catalogSummary: byId("catalogSummary"),
  inputLevelOut: byId("inputLevelOut"),
  inputState: byId("inputState"),
  inputSummary: byId("inputSummary"),
  inputTrim: byId("inputTrim"),
  inputTrimOut: byId("inputTrimOut"),
  liveStatus: byId("liveStatus"),
  loadWamButton: byId("loadWamButton"),
  micButton: byId("micButton"),
  micButtonHint: byId("micButtonHint"),
  micButtonLabel: byId("micButtonLabel"),
  outputLevel: byId("outputLevel"),
  outputLevelMeterOut: byId("outputLevelMeterOut"),
  outputLevelOut: byId("outputLevelOut"),
  outputState: byId("outputState"),
  pluginModule: byId("pluginModule"),
  pluginState: byId("pluginState"),
  processorName: byId("processorName"),
  processorRuntime: byId("processorRuntime"),
  processorSummary: byId("processorSummary"),
  processorVendor: byId("processorVendor"),
  rack: document.querySelector(".plugazoid-rack"),
  reloadCatalogButton: byId("reloadCatalogButton"),
  runtimePill: byId("runtimePill"),
  runtimeState: byId("runtimeState"),
  stageReadout: byId("stageReadout"),
  testToneButton: byId("testToneButton"),
  unloadWamButton: byId("unloadWamButton"),
  wamApiVersion: byId("wamApiVersion"),
  wamGuiEmpty: byId("wamGuiEmpty"),
  wamGuiHost: byId("wamGuiHost"),
  wamSelect: byId("wamSelect"),
  wamSelectionDescription: byId("wamSelectionDescription"),
  wamSourceLink: byId("wamSourceLink"),
};

const audio = {
  context: null,
  dryGain: null,
  hostGroupId: null,
  inputAnalyser: null,
  inputGain: null,
  limiter: null,
  masterGain: null,
  microphoneSource: null,
  microphoneStream: null,
  outputAnalyser: null,
  releaseOutput: null,
  testGain: null,
  testOscillator: null,
  wam: null,
  wetGain: null,
};

const starterCatalog = prepareWamCatalog(PLUGAZOID_STARTER_WAMS);
const starterIds = new Set(PLUGAZOID_STARTER_WAMS.map(({ identifier }) => identifier));

let settings = sanitizePlugazoidSettings(PLUGAZOID_DEFAULTS);
let catalog = starterCatalog;
let catalogController = null;
let catalogMode = "starter";
let audioStarting = false;
let hostStarting = false;
let hostError = "";
let microphoneStarting = false;
let microphoneRequest = 0;
let wamLoading = false;
let wamLoadRequest = 0;
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

function setGainParameter(parameter, value, timeConstant = 0.012) {
  if (!parameter || !audio.context) return;
  const now = audio.context.currentTime;
  parameter.cancelScheduledValues(now);
  parameter.setTargetAtTime(value, now, timeConstant);
}

function selectedWam() {
  return catalog.effects.find(({ identifier }) => identifier === ui.wamSelect.value) ?? null;
}

function signalPathLabel() {
  if (!audio.wam) return "the dry path";
  if (settings.bypassed) return "the bypassed WAM";
  return audio.wam.name;
}

function renderSelectedWam() {
  const entry = selectedWam();
  if (!entry) {
    ui.wamSelectionDescription.textContent = "No compatible audio effects were found.";
    ui.wamSourceLink.href = "https://www.webaudiomodules.com/community/";
    ui.wamSourceLink.textContent = "Open WAM community site";
    return;
  }
  const categories = entry.category.filter((category) => category !== "Effect").join(" · ");
  ui.wamSelectionDescription.textContent = [
    entry.description || "No description supplied.",
    categories ? "Type: " + categories + "." : "",
  ].filter(Boolean).join(" ");
  ui.wamSourceLink.href = entry.moduleUrl;
  ui.wamSourceLink.textContent = "Open " + entry.name + " module URL";
  ui.wamSourceLink.title = entry.moduleUrl;
}

function renderCatalogOptions() {
  const previous = ui.wamSelect.value;
  const options = document.createDocumentFragment();
  for (const entry of catalog.effects) {
    const option = document.createElement("option");
    option.value = entry.identifier;
    option.textContent = (starterIds.has(entry.identifier) ? "★ " : "") + entry.name + " — " + entry.vendor;
    options.append(option);
  }
  ui.wamSelect.replaceChildren(options);
  ui.wamSelect.disabled = catalog.effects.length === 0 || catalogMode === "loading";
  if (catalog.effects.some(({ identifier }) => identifier === previous)) {
    ui.wamSelect.value = previous;
  }
  renderSelectedWam();
  renderHostState();
}

async function refreshCatalog({ announceChange = true } = {}) {
  catalogController?.abort();
  const controller = new AbortController();
  catalogController = controller;
  catalogMode = "loading";
  ui.catalogSummary.textContent = "loading official list";
  ui.reloadCatalogButton.disabled = true;
  ui.wamSelect.disabled = true;
  renderHostState();

  try {
    const response = await fetch(PLUGAZOID_WAM_ENDPOINTS.catalog, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("The catalogue returned HTTP " + response.status + ".");
    const nextCatalog = prepareWamCatalog(await response.json());
    if (!nextCatalog.effects.length) throw new Error("The catalogue contains no compatible effects.");
    if (controller.signal.aborted || destroyed) return;
    catalog = nextCatalog;
    catalogMode = "remote";
    ui.catalogSummary.textContent = nextCatalog.effectCount + " effects · " + nextCatalog.totalCount + " modules";
    renderCatalogOptions();
    if (announceChange) announce("Official WAM catalogue loaded with " + nextCatalog.effectCount + " audio effects.");
  } catch (error) {
    if (controller.signal.aborted || destroyed) return;
    catalog = starterCatalog;
    catalogMode = "starter";
    ui.catalogSummary.textContent = starterCatalog.effectCount + " starter URLs · registry offline";
    renderCatalogOptions();
    ui.wamSelectionDescription.textContent += " The live registry could not be reached, so Plugazoid is showing its three known official URLs.";
    if (announceChange) announce("The live catalogue is unavailable. Three starter WAM URLs remain available.");
  } finally {
    if (catalogController === controller) {
      catalogController = null;
      ui.reloadCatalogButton.disabled = false;
      renderHostState();
    }
  }
}

function renderLoadedDescriptor() {
  const wam = audio.wam;
  ui.processorName.textContent = wam?.name ?? "No WAM loaded";
  ui.processorVendor.textContent = wam?.vendor ?? "—";
  ui.wamApiVersion.textContent = wam?.apiVersion ?? "—";
}

function routeAudio() {
  const wet = Boolean(audio.wam && !settings.bypassed);
  setGainParameter(audio.dryGain?.gain, wet ? 0 : 1, 0.008);
  setGainParameter(audio.wetGain?.gain, wet ? 1 : 0, 0.008);
}

function renderSettings() {
  ui.inputTrim.value = String(settings.inputTrimDb);
  ui.outputLevel.value = String(settings.outputLevel);
  ui.inputTrimOut.textContent = formatDecibels(settings.inputTrimDb);
  ui.outputLevelOut.textContent = Math.round(settings.outputLevel * 100) + "%";
  ui.bypassButton.setAttribute("aria-pressed", String(settings.bypassed));
  ui.bypassButton.textContent = settings.bypassed ? "Resume loaded WAM" : "Bypass loaded WAM";
  ui.pluginModule.classList.toggle("is-bypassed", Boolean(audio.wam && settings.bypassed));
  ui.rack.style.setProperty("--drive", audio.wam ? "0.76" : "0.08");
  ui.rack.style.setProperty("--tone", audio.wam ? "0.62" : "0.2");
  ui.rack.style.setProperty("--mix", audio.wam && !settings.bypassed ? "1" : "0");
  setGainParameter(audio.inputGain?.gain, decibelsToGain(settings.inputTrimDb));
  setGainParameter(audio.masterGain?.gain, outputLevelToGain(settings.outputLevel), 0.018);
  routeAudio();
  renderHostState();
}

function applySettings(values, { announceChange = false } = {}) {
  settings = sanitizePlugazoidSettings({ ...settings, ...values });
  renderSettings();
  if (announceChange) {
    announce(settings.bypassed ? "Loaded WAM bypassed." : "Loaded WAM resumed.");
  }
}

function renderHostState() {
  const armed = Boolean(audio.context && audio.context.state !== "closed");
  const inputActive = inputMode !== "none";
  const loaded = Boolean(audio.wam);
  const hostReady = Boolean(audio.hostGroupId);

  ui.audioButton.setAttribute("aria-pressed", String(armed));
  ui.audioButton.classList.toggle("is-on", armed);
  ui.audioButton.disabled = audioStarting;
  ui.audioState.textContent = audioStarting ? "starting" : armed ? "on" : "off";
  ui.runtimePill.classList.toggle("is-armed", armed);
  ui.runtimeState.textContent = !armed
    ? "audio off · WAM2 host waiting"
    : wamLoading
      ? "audio on · downloading WAM2"
      : loaded
        ? "audio on · " + audio.wam.name + " live"
        : hostStarting
          ? "audio on · initializing WAM2"
          : hostReady
            ? "audio on · WAM2 host ready"
            : "audio on · WAM2 host unavailable";

  ui.micButton.setAttribute("aria-pressed", String(inputMode === "microphone"));
  ui.micButton.classList.toggle("is-live", inputMode === "microphone");
  ui.micButton.disabled = microphoneStarting || audioStarting;
  ui.micButtonLabel.textContent = microphoneStarting
    ? "Connecting…"
    : inputMode === "microphone"
      ? "Disconnect mic"
      : "Connect mic";
  ui.micButtonHint.textContent = inputMode === "microphone"
    ? "live through " + signalPathLabel()
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
      ? loaded
        ? settings.bypassed ? "dry / bypassed" : "WAM live"
        : "dry / no WAM"
      : "ready"
    : "muted";
  ui.rack.classList.toggle("is-flowing", armed && inputActive);
  ui.pluginState.textContent = loaded
    ? audio.wam.name + " · " + (settings.bypassed ? "bypassed" : "active")
    : wamLoading
      ? "Downloading selected module"
      : "No module loaded";
  ui.processorSummary.textContent = loaded
    ? audio.wam.name + (settings.bypassed ? " · bypassed" : " · live")
    : wamLoading
      ? "loading remote module"
      : "empty slot";
  ui.processorRuntime.textContent = loaded
    ? "remote WAM2 module"
    : armed
      ? hostReady
        ? "WAM2 host ready"
        : hostStarting
          ? "initializing host"
          : "host unavailable"
      : "WAM2 host waiting";
  ui.bypassButton.disabled = !loaded || wamLoading;
  ui.unloadWamButton.disabled = !loaded || wamLoading;
  ui.loadWamButton.disabled = !armed || !hostReady || !selectedWam() || wamLoading;
  ui.loadWamButton.classList.toggle("is-loading", wamLoading);
  ui.loadWamButton.textContent = wamLoading ? "Loading WAM…" : "Load selected WAM";
  ui.wamGuiHost.classList.toggle("is-loaded", loaded);
  ui.wamGuiEmpty.hidden = Boolean(audio.wam?.gui);
  if (loaded && !audio.wam.gui) {
    ui.wamGuiEmpty.hidden = false;
    ui.wamGuiEmpty.textContent = "This WAM is processing audio but did not expose a standard GUI.";
  } else if (!loaded) {
    ui.wamGuiEmpty.textContent = "Load a WAM2 effect to mount its own controls here.";
  }

  ui.stageReadout.textContent = [
    "WAM2 HOST",
    loaded ? audio.wam.name.toUpperCase() : "EMPTY SLOT",
    inputMode === "microphone" ? "MIC LIVE" : inputMode === "test" ? "TEST LIVE" : "INPUT OFF",
    armed ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  renderLoadedDescriptor();
}

function analyserRms(analyser, samples) {
  if (!analyser) return { rms: 0, samples: null };
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
  ui.rack.style.setProperty("--input-level", (meterPercentage(inputReading.rms) / 100).toFixed(3));
  ui.rack.style.setProperty("--output-level", (meterPercentage(outputReading.rms) / 100).toFixed(3));
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

function safelyDisconnect(node, destination) {
  try {
    if (destination) node?.disconnect(destination);
    else node?.disconnect();
  } catch {
    // Nodes may already be disconnected while a context is closing.
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
  if (render) renderHostState();
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
  if (render) renderHostState();
}

function stopInput({ render = true } = {}) {
  stopMicrophone({ render: false });
  stopTestTone({ render: false });
  inputMode = "none";
  if (render) renderHostState();
}

function configureAnalyser(analyser) {
  analyser.fftSize = 2_048;
  analyser.smoothingTimeConstant = 0;
}

async function initializeHost(context) {
  hostStarting = true;
  hostError = "";
  renderHostState();
  try {
    const imported = await import(PLUGAZOID_WAM_ENDPOINTS.sdk);
    if (typeof imported.default !== "function") {
      throw new TypeError("The hosted WAM initializer has no default function export.");
    }
    if (audio.context !== context || context.state === "closed" || destroyed) return;
    const [hostGroupId] = await imported.default(context);
    if (audio.context !== context || context.state === "closed" || destroyed) return;
    audio.hostGroupId = hostGroupId;
    showError();
    announce("Audio on. The WAM2 host is ready; choose an effect and load it.");
  } catch (error) {
    if (audio.context !== context || destroyed) return;
    hostError = error instanceof Error ? error.message : "Unknown WAM host error.";
    showError("Audio is on with a dry path, but the remote WAM2 host runtime could not load. Check the connection and try Audio again.");
    announce("The dry audio path is ready, but the WAM2 host is unavailable.");
  } finally {
    if (audio.context === context) {
      hostStarting = false;
      renderHostState();
    }
  }
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
  renderHostState();
  let context = null;
  try {
    context = new AudioContextConstructor({ latencyHint: "interactive" });
    if (!context.audioWorklet) throw new Error("AudioWorklet is unavailable in this browser.");

    const inputGain = context.createGain();
    const inputAnalyser = context.createAnalyser();
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    const outputAnalyser = context.createAnalyser();
    const masterGain = context.createGain();
    const limiter = context.createDynamicsCompressor();

    configureAnalyser(inputAnalyser);
    configureAnalyser(outputAnalyser);
    dryGain.gain.value = 1;
    wetGain.gain.value = 0;
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;

    inputGain.connect(inputAnalyser);
    inputAnalyser.connect(dryGain);
    dryGain.connect(outputAnalyser);
    wetGain.connect(outputAnalyser);
    outputAnalyser.connect(masterGain);
    masterGain.connect(limiter);

    audio.context = context;
    audio.inputGain = inputGain;
    audio.inputAnalyser = inputAnalyser;
    audio.dryGain = dryGain;
    audio.wetGain = wetGain;
    audio.outputAnalyser = outputAnalyser;
    audio.masterGain = masterGain;
    audio.limiter = limiter;
    audio.releaseOutput = connectAudioOutput(context, limiter);

    await context.resume();
    if (destroyed || document.hidden || pendingDisarmMessage) {
      const interruption = pendingDisarmMessage;
      pendingDisarmMessage = "";
      await disarmAudio(interruption);
      return false;
    }
    renderSettings();
    startMeter();
    announce("Audio on with a dry path. Initializing the remote WAM2 host.");
    void initializeHost(context);
    return true;
  } catch (error) {
    if (context && context.state !== "closed") await context.close().catch(() => {});
    Object.assign(audio, {
      context: null,
      dryGain: null,
      inputAnalyser: null,
      inputGain: null,
      limiter: null,
      masterGain: null,
      outputAnalyser: null,
      releaseOutput: null,
      wetGain: null,
    });
    showError(error instanceof Error ? error.message : "Could not start the audio graph.");
    announce("Audio could not start.");
    return false;
  } finally {
    audioStarting = false;
    renderHostState();
    if (pendingDisarmMessage && audio.context) {
      const interruption = pendingDisarmMessage;
      pendingDisarmMessage = "";
      void disarmAudio(interruption);
    }
  }
}

async function destroyWamRecord(record) {
  if (!record) return;
  safelyDisconnect(audio.inputAnalyser, record.node);
  safelyDisconnect(record.node);
  if (record.gui) {
    try {
      await record.instance.destroyGui?.(record.gui);
    } catch {
      // Third-party GUI cleanup should not block host teardown.
    }
    record.gui.remove();
  }
  try {
    record.node?.destroy?.();
  } catch {
    // A third-party WAM may already have released its worklet.
  }
}

async function detachCurrentWam({ settle = true } = {}) {
  const record = audio.wam;
  if (!record) return;
  setGainParameter(audio.dryGain?.gain, 1, 0.006);
  setGainParameter(audio.wetGain?.gain, 0, 0.006);
  if (settle && audio.context?.state === "running") {
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  }
  if (audio.wam === record) audio.wam = null;
  await destroyWamRecord(record);
  settings = sanitizePlugazoidSettings({ ...settings, bypassed: false });
  renderSettings();
}

function wamLoadError(entry, error) {
  const detail = error instanceof Error ? error.message.trim() : "";
  const reason = detail ? " " + detail.slice(0, 180) : "";
  return "Could not load " + entry.name + "." + reason + " The remote module may be offline, incompatible, or blocked by CORS.";
}

async function loadSelectedWam() {
  const entry = selectedWam();
  if (!audio.context) {
    showError("Turn on Audio first. Loading a WAM never arms audio implicitly.");
    announce("Turn on Audio before loading a WAM.");
    return;
  }
  if (!audio.hostGroupId) {
    showError(hostError
      ? "The WAM2 host runtime is unavailable. Turn Audio off and on to retry."
      : "The WAM2 host is still initializing. Try again in a moment.");
    return;
  }
  if (!entry || wamLoading) return;

  const context = audio.context;
  const groupId = audio.hostGroupId;
  const request = ++wamLoadRequest;
  let instance = null;
  let gui = null;
  wamLoading = true;
  showError();
  renderHostState();

  try {
    await detachCurrentWam();
    if (request !== wamLoadRequest || audio.context !== context || destroyed) return;

    const imported = await import(entry.moduleUrl);
    const WamConstructor = imported.default;
    const isWam = typeof WamConstructor === "function"
      && WamConstructor.isWebAudioModuleConstructor === true
      && typeof WamConstructor.createInstance === "function";
    if (!isWam) throw new TypeError("The module does not expose a WAM2 constructor.");

    instance = await WamConstructor.createInstance(groupId, context);
    if (request !== wamLoadRequest || audio.context !== context || destroyed) {
      await destroyWamRecord({ instance, node: instance?.audioNode, gui: null });
      return;
    }
    const node = instance?.audioNode;
    if (!node || typeof node.connect !== "function" || typeof node.disconnect !== "function") {
      throw new TypeError("The WAM did not provide a connectable audio node.");
    }
    const descriptor = instance.descriptor ?? {};
    if (descriptor.isInstrument === true
      || descriptor.hasAudioInput === false
      || descriptor.hasAudioOutput === false) {
      throw new TypeError("The WAM does not declare an audio effect input and output.");
    }

    try {
      const candidateGui = await instance.createGui?.();
      if (candidateGui instanceof Element) gui = candidateGui;
    } catch {
      gui = null;
    }
    if (request !== wamLoadRequest || audio.context !== context || destroyed) {
      await destroyWamRecord({ instance, node, gui });
      return;
    }

    audio.inputAnalyser.connect(node);
    node.connect(audio.wetGain);
    if (gui) ui.wamGuiHost.append(gui);
    audio.wam = {
      apiVersion: String(descriptor.apiVersion ?? "WAM2"),
      entry,
      gui,
      instance,
      name: String(descriptor.name ?? instance.name ?? entry.name),
      node,
      vendor: String(descriptor.vendor ?? instance.vendor ?? entry.vendor),
    };
    settings = sanitizePlugazoidSettings({ ...settings, bypassed: false });
    renderSettings();
    await context.resume();
    announce(audio.wam.name + " loaded from the web and inserted into the live audio path.");
  } catch (error) {
    if (instance && audio.wam?.instance !== instance) {
      await destroyWamRecord({ instance, node: instance.audioNode, gui });
    }
    if (request === wamLoadRequest && audio.context === context) {
      showError(wamLoadError(entry, error));
      announce(entry.name + " could not be loaded. The dry path remains active.");
      routeAudio();
    }
  } finally {
    if (request === wamLoadRequest) {
      wamLoading = false;
      renderHostState();
    }
  }
}

async function unloadWam({ announceChange = true, settle = true } = {}) {
  if (!audio.wam || wamLoading) return;
  wamLoadRequest += 1;
  await detachCurrentWam({ settle });
  if (announceChange) announce("WAM unloaded. The input remains connected to the dry path.");
}

async function disarmAudio(message = "Audio off.") {
  if (audioStarting) {
    pendingDisarmMessage = message;
    stopInput();
    stopMeter();
    return;
  }
  pendingDisarmMessage = "";
  wamLoadRequest += 1;
  wamLoading = false;
  hostStarting = false;
  hostError = "";
  stopInput({ render: false });
  stopMeter();
  await detachCurrentWam({ settle: false });

  const context = audio.context;
  const releaseOutput = audio.releaseOutput;
  Object.assign(audio, {
    context: null,
    dryGain: null,
    hostGroupId: null,
    inputAnalyser: null,
    inputGain: null,
    limiter: null,
    masterGain: null,
    outputAnalyser: null,
    releaseOutput: null,
    wetGain: null,
  });
  releaseOutput?.();
  if (context && context.state !== "closed") await context.close().catch(() => {});
  renderSettings();
  if (message) announce(message);
}

function microphoneErrorMessage(error) {
  if (!window.isSecureContext) return "Microphone access needs HTTPS or localhost.";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Microphone permission was denied. You can still use the test signal.";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "No microphone was found.";
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
  renderHostState();
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
    announce("Microphone connected through " + signalPathLabel() + ".");
  } catch (error) {
    if (request === microphoneRequest) showError(microphoneErrorMessage(error));
  } finally {
    if (request === microphoneRequest) microphoneStarting = false;
    renderHostState();
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
  renderHostState();
  announce("110 hertz test signal connected through " + signalPathLabel() + ".");
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

ui.wamSelect.addEventListener("change", () => {
  renderSelectedWam();
  renderHostState();
});

ui.loadWamButton.addEventListener("click", () => void loadSelectedWam());
ui.reloadCatalogButton.addEventListener("click", () => void refreshCatalog());
ui.unloadWamButton.addEventListener("click", () => void unloadWam());

ui.inputTrim.addEventListener("input", () => {
  settings = sanitizePlugazoidSettings({ ...settings, inputTrimDb: Number(ui.inputTrim.value) });
  renderSettings();
});

ui.outputLevel.addEventListener("input", () => {
  settings = sanitizePlugazoidSettings({ ...settings, outputLevel: Number(ui.outputLevel.value) });
  renderSettings();
});

ui.bypassButton.addEventListener("click", () => {
  if (!audio.wam) return;
  applySettings({ bypassed: !settings.bypassed }, { announceChange: true });
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || inputMode === "none") return;
  stopInput();
  announce("Live input stopped.");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && audio.context) {
    void disarmAudio("Audio, WAM, and microphone stopped while the page was hidden.");
  } else if (!document.hidden && audio.context) {
    startMeter();
  }
});

window.addEventListener("pagehide", () => {
  destroyed = true;
  catalogController?.abort();
  void disarmAudio("");
}, { once: true });

renderCatalogOptions();
renderSettings();
void refreshCatalog({ announceChange: false });
