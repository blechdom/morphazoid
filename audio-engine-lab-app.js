import {
  DEFAULT_ENGINE_SETTINGS,
  ENGINE_DEFINITIONS,
  formatPitch,
  formatStretch,
  formatTapeStretch,
  playbackStatsSnapshot,
  prepareMicLoop,
} from "./src/audio-engine-lab.js";
import { createEngineAdapter } from "./src/audio-engine-adapters.js";
import { benchmarkOfflineEngine } from "./src/audio-engine-benchmark.js";

const byId = (id) => document.getElementById(id);
const engineCards = new Map(
  [...document.querySelectorAll("[data-engine-card]")]
    .map((card) => [card.dataset.engineCard, card]),
);
const engineSettings = new Map(
  ENGINE_DEFINITIONS.map((engine) => [engine.id, { ...DEFAULT_ENGINE_SETTINGS }]),
);

const ui = {
  statusLight: byId("labStatusLight"),
  state: byId("labState"),
  captureButton: byId("captureButton"),
  captureButtonLabel: byId("captureButtonLabel"),
  captureButtonHint: byId("captureButtonHint"),
  captureLength: byId("captureLength"),
  captureLengthOut: byId("captureLengthOut"),
  clearLoopButton: byId("clearLoopButton"),
  outputLevel: byId("outputLevel"),
  outputLevelOut: byId("outputLevelOut"),
  waveform: byId("loopWaveform"),
  waveformEmpty: byId("waveformEmpty"),
  waveformTime: byId("waveformTime"),
  captureProgress: byId("captureProgress"),
  captureProgressBar: byId("captureProgressBar"),
  error: byId("labError"),
  stopButton: byId("stopButton"),
  dspCpu: byId("labDspCpu"),
  audioHealth: byId("labAudioHealth"),
  gpuDsp: byId("labGpuDsp"),
  liveStatus: byId("labLiveStatus"),
};

let loop = null;
let loopRevision = 0;
let captureActive = false;
let activeEngineId = null;
let switchRevision = 0;
let waveformFrame = 0;
let updateFrame = 0;
let resizeObserver = null;
let telemetryCapacity = null;
let telemetryTimer = 0;
let telemetryRevision = 0;
let activeBenchmark = null;
let idleBenchmarkTimer = 0;
let idleBenchmarkRevision = 0;
let idleBenchmarkDraining = false;
let adapterRevision = 0;

const adapters = new Map();
const adapterPromises = new Map();
const pendingUpdates = new Set();
const pendingBenchmarkIds = new Set();
const engineMetricStates = new Map(
  ENGINE_DEFINITIONS.map((engine) => [engine.id, {
    live: null,
    benchmark: null,
    benchmarkKey: "",
  }]),
);

function formatLoad(value) {
  if (!Number.isFinite(value)) return "N/A";
  const percent = Math.max(0, value) * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

function formatMilliseconds(seconds) {
  if (!Number.isFinite(seconds)) return "N/A";
  const milliseconds = Math.max(0, seconds) * 1_000;
  return `${milliseconds < 10 ? milliseconds.toFixed(1) : Math.round(milliseconds)} ms`;
}

function formatOfflineCost(mode) {
  const percent = Number(mode?.offlineBudgetPercent);
  const speed = Number(mode?.speed);
  if (!Number.isFinite(percent) || !Number.isFinite(speed)) return "N/A";
  const percentText = percent < 10 ? percent.toFixed(1) : Math.round(percent);
  const speedText = speed >= 10 ? Math.round(speed) : speed.toFixed(1);
  return `${percentText}% RT · ${speedText}×`;
}

function cardMetric(engineId, name) {
  return engineCards.get(engineId)?.querySelector(`[data-engine-metric="${name}"]`) ?? null;
}

function setCardMetric(engineId, name, value, title = "") {
  const output = cardMetric(engineId, name);
  if (!output) return;
  output.textContent = value;
  if (title) output.title = title;
  else output.removeAttribute("title");
}

function createEngineMetricPanels() {
  for (const [engineId, card] of engineCards) {
    if (card.querySelector("[data-engine-cost]")) continue;
    const definition = ENGINE_DEFINITIONS.find((engine) => engine.id === engineId);
    const independent = definition?.controls.pitch && definition?.controls.time
      && !definition?.controls.coupled;
    const combinedLabel = engineId === "raw"
      ? "Baseline"
      : engineId === "native-tape"
        ? "Coupled tape"
        : "Pitch + time";
    const latencyLabel = engineId === "hybrid-soundtouch-signalsmith"
      ? "Pitch lat"
      : engineId === "soundtouch-phase-vocoder"
        ? "FFT window"
        : "Alg lat";
    const latencyTitle = engineId === "hybrid-soundtouch-signalsmith"
      ? "Signalsmith pitch-stage latency. SoundTouch time-stage latency is not exposed."
      : engineId === "soundtouch-phase-vocoder"
        ? "One 2048-sample FFT analysis window. Total perceptual latency may be higher."
        : "Algorithm latency. Unknown stages are shown as N/A.";
    const panel = document.createElement("section");
    panel.className = "engine-cost";
    panel.dataset.engineCost = "";
    panel.dataset.modeCount = independent ? "3" : "1";
    panel.setAttribute("aria-label", `${definition?.shortName ?? engineId} processing measurements`);
    panel.innerHTML = `
      <div class="engine-cost-heading">
        <b>Path throughput</b>
        <span data-engine-metric="cost-status">Listen to measure</span>
      </div>
      <div class="engine-live-cost" title="Share of the real-time audio callback deadline used by this engine's isolated AudioContext. 100% exhausts the deadline. This is not whole-device CPU usage.">
        <span><small>Live path avg</small><output data-engine-metric="live-average">N/A</output></span>
        <span><small>Live path peak</small><output data-engine-metric="live-peak">N/A</output></span>
        <span><small>Deadline miss</small><output data-engine-metric="deadline-miss">N/A</output></span>
      </div>
      <div class="engine-offline-cost" title="Full engine-path throughput under each setting: offline render wall time divided by rendered audio duration. Lower is faster; 25% RT is four times faster than real time. Integrated stages are not individually timed, and this is not live CPU usage.">
        <span${independent ? "" : " hidden"}><small>Pitch setting</small><output data-engine-metric="offline-pitch">N/A</output></span>
        <span${independent ? "" : " hidden"}><small>Time setting</small><output data-engine-metric="offline-time">N/A</output></span>
        <span><small>${combinedLabel}</small><output data-engine-metric="offline-combined">N/A</output></span>
      </div>
      <div class="engine-health-cost">
        <span title="${latencyTitle}"><small>${latencyLabel}</small><output data-engine-metric="algorithm-latency">N/A</output></span>
        <span title="Browser-reported output-device latency estimate."><small>Out lat</small><output data-engine-metric="output-latency">N/A</output></span>
        <span title="Browser-reported output underrun events since this listen began."><small>Audio XRUN</small><output data-engine-metric="audio-xrun">N/A</output></span>
        <span title="Cumulative blocks where this processor could not fill its output buffer since the engine was created. This is not a browser audio XRUN."><small>DSP underflow</small><output data-engine-metric="dsp-underflow">N/A</output></span>
        <span title="One-time graph, module, or WASM initialization time; excluded from offline render cost."><small>Setup</small><output data-engine-metric="setup-time">N/A</output></span>
      </div>
    `;
    card.querySelector("footer")?.before(panel);
  }
}

function invalidateEngineBenchmark(engineId, message = "Listen to measure") {
  const state = engineMetricStates.get(engineId);
  if (state) {
    state.benchmark = null;
    state.benchmarkKey = "";
    if (state.live) {
      const adapter = adapters.get(engineId);
      if (engineId === activeEngineId) adapter?.resetEngineMetrics?.();
      const stats = playbackStatsSnapshot(adapter?.context);
      const processorMetrics = adapter?.getEngineMetrics?.();
      Object.assign(state.live, {
        windows: 0,
        measuredWindows: 0,
        averageTotal: 0,
        peak: null,
        underrunRatio: null,
        underrunRatioTotal: 0,
        underrunRatioWindows: 0,
        xrunBaseline: stats.supported ? stats.underrunEvents : null,
        underflowBaseline: processorMetrics ? 0 : null,
      });
      setCardMetric(engineId, "audio-xrun", stats.supported ? "0" : "N/A");
      setCardMetric(engineId, "dsp-underflow", processorMetrics ? "0" : "N/A");
    }
  }
  if (activeBenchmark?.engineId === engineId) activeBenchmark.controller.abort();
  if (engineId === activeEngineId) {
    ui.dspCpu.textContent = "N/A";
    ui.dspCpu.title = "The current settings have not been measured yet.";
  }
  setCardMetric(engineId, "live-average", engineId === activeEngineId ? "warming…" : "N/A");
  setCardMetric(engineId, "live-peak", engineId === activeEngineId ? "warming…" : "N/A");
  setCardMetric(engineId, "deadline-miss", engineId === activeEngineId ? "warming…" : "N/A");
  setCardMetric(engineId, "offline-pitch", "N/A");
  setCardMetric(engineId, "offline-time", "N/A");
  setCardMetric(engineId, "offline-combined", "N/A");
  setCardMetric(engineId, "cost-status", message);
  if (adapters.has(engineId)) {
    pendingBenchmarkIds.add(engineId);
    if (!activeEngineId) scheduleIdleBenchmarks();
  }
}

function cancelActiveBenchmark() {
  activeBenchmark?.controller.abort();
}

async function interruptIdleBenchmarks({ clearQueue = false } = {}) {
  idleBenchmarkRevision += 1;
  clearTimeout(idleBenchmarkTimer);
  idleBenchmarkTimer = 0;
  const current = activeBenchmark;
  current?.controller.abort();
  if (current) await current.promise.catch(() => {});
  if (clearQueue) pendingBenchmarkIds.clear();
}

function benchmarkKey(engineId) {
  const settings = engineSettings.get(engineId);
  return [
    loop?.sampleRate ?? 0,
    loop?.samples?.length ?? 0,
    loopRevision,
    Number(settings?.pitch ?? 0).toFixed(3),
    Number(settings?.stretch ?? 1).toFixed(4),
  ].join(":");
}

function showOfflineBenchmark(engineId, result) {
  const { pitchOnly, timeOnly, combined } = result.modes;
  for (const [name, mode] of [
    ["offline-pitch", pitchOnly],
    ["offline-time", timeOnly],
    ["offline-combined", combined],
  ]) {
    setCardMetric(
      engineId,
      name,
      formatOfflineCost(mode),
      `Median of three ${result.renderSeconds.toFixed(2)} second offline renders: `
        + `${mode.renderMs.toFixed(1)} ms wall time, ${mode.speed.toFixed(1)}× real-time, `
        + `output RMS ${mode.rms.toFixed(4)}. Setup is excluded.`,
    );
  }
  setCardMetric(engineId, "cost-status", "Offline RTF · median of 3");
}

async function ensureOfflineBenchmark(engineId) {
  if (!loop) return null;
  const state = engineMetricStates.get(engineId);
  const key = benchmarkKey(engineId);
  if (state?.benchmark && state.benchmarkKey === key) return state.benchmark;

  if (activeBenchmark) {
    activeBenchmark.controller.abort();
    await activeBenchmark.promise.catch(() => {});
  }

  const settings = { ...engineSettings.get(engineId) };
  const sourceLoop = loop;
  const controller = new AbortController();
  const modeNames = {
    "pitch-only": "pitch",
    "time-only": "time",
    combined: "combined",
  };
  const promise = benchmarkOfflineEngine(engineId, sourceLoop, {
    ...settings,
    onProgress({ mode, phase, run, total }) {
      const phaseText = phase === "warmup" ? "warming" : `${run}/${total}`;
      setCardMetric(
        engineId,
        "cost-status",
        `Measuring ${modeNames[mode] ?? mode} · ${phaseText}`,
      );
      setEngineStatus(engineId, `measuring ${modeNames[mode] ?? mode} cost…`);
    },
    signal: controller.signal,
  });
  const current = {
    controller,
    engineId,
    promise,
  };
  activeBenchmark = current;

  try {
    const result = await promise;
    if (
      controller.signal.aborted
      || loop !== sourceLoop
      || benchmarkKey(engineId) !== key
    ) return null;
    state.benchmark = result;
    state.benchmarkKey = key;
    showOfflineBenchmark(engineId, result);
    return result;
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) {
      const status = cardMetric(engineId, "cost-status");
      if (status?.textContent.startsWith("Measuring")) {
        setCardMetric(engineId, "cost-status", "Listen to measure");
      }
      return null;
    }
    state.benchmark = Object.freeze({ unavailable: true });
    state.benchmarkKey = key;
    setCardMetric(
      engineId,
      "cost-status",
      "Offline RTF unavailable",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  } finally {
    if (activeBenchmark === current) activeBenchmark = null;
  }
}

function scheduleIdleBenchmarks(delay = 550) {
  if (
    idleBenchmarkDraining
    || idleBenchmarkTimer
    || activeEngineId
    || captureActive
    || !loop
    || !pendingBenchmarkIds.size
  ) return;
  const revision = idleBenchmarkRevision;
  idleBenchmarkTimer = setTimeout(() => {
    idleBenchmarkTimer = 0;
    void drainIdleBenchmarks(revision);
  }, delay);
}

async function drainIdleBenchmarks(revision) {
  if (
    idleBenchmarkDraining
    || revision !== idleBenchmarkRevision
    || activeEngineId
    || captureActive
    || !loop
  ) return;
  idleBenchmarkDraining = true;
  try {
    while (
      revision === idleBenchmarkRevision
      && !activeEngineId
      && !captureActive
      && loop
      && pendingBenchmarkIds.size
    ) {
      const engineId = pendingBenchmarkIds.values().next().value;
      setHeaderState(`measuring ${engineName(engineId)}`, "busy");
      setCardMetric(engineId, "cost-status", "Queued offline measurement");
      await ensureOfflineBenchmark(engineId);
      if (
        revision !== idleBenchmarkRevision
        || activeEngineId
        || captureActive
        || !loop
      ) return;
      pendingBenchmarkIds.delete(engineId);
      if (adapters.has(engineId)) setEngineStatus(engineId, "ready · suspended");
    }
  } finally {
    idleBenchmarkDraining = false;
    if (revision === idleBenchmarkRevision && !activeEngineId && loop) {
      setHeaderState("loop ready", "ready");
      scheduleIdleBenchmarks();
    }
  }
}

function resetEngineMetrics() {
  idleBenchmarkRevision += 1;
  clearTimeout(idleBenchmarkTimer);
  idleBenchmarkTimer = 0;
  pendingBenchmarkIds.clear();
  cancelActiveBenchmark();
  for (const engine of ENGINE_DEFINITIONS) {
    const state = engineMetricStates.get(engine.id);
    if (state) {
      state.live = null;
      state.benchmark = null;
      state.benchmarkKey = "";
    }
    for (const metric of [
      "live-average",
      "live-peak",
      "deadline-miss",
      "offline-pitch",
      "offline-time",
      "offline-combined",
      "algorithm-latency",
      "output-latency",
      "audio-xrun",
      "dsp-underflow",
      "setup-time",
    ]) {
      setCardMetric(engine.id, metric, "N/A");
    }
    setCardMetric(engine.id, "cost-status", "Listen to measure");
  }
}

function setHeaderState(message, state = "") {
  ui.state.textContent = message;
  ui.statusLight.classList.toggle("is-ready", state === "ready");
  ui.statusLight.classList.toggle("is-busy", state === "busy");
}

function announce(message) {
  ui.liveStatus.textContent = message;
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  ui.error.textContent = message;
  ui.error.hidden = false;
  setHeaderState("needs attention");
  announce(message);
}

function clearError() {
  ui.error.hidden = true;
  ui.error.textContent = "";
}

function engineName(engineId) {
  return ENGINE_DEFINITIONS.find((engine) => engine.id === engineId)?.shortName ?? engineId;
}

function setEngineStatus(engineId, message) {
  const output = engineCards.get(engineId)?.querySelector("[data-engine-status]");
  if (output) output.textContent = message;
}

function resetTelemetry() {
  ui.dspCpu.textContent = "N/A";
  ui.dspCpu.title = "This browser does not expose Web Audio render-capacity load.";
  ui.audioHealth.textContent = "IDLE";
  ui.audioHealth.title = "No audio engine is running.";
  ui.gpuDsp.textContent = "OFF";
  ui.gpuDsp.title = "The listed engines do not submit GPU DSP work.";
}

function stopTelemetry() {
  telemetryRevision += 1;
  clearInterval(telemetryTimer);
  telemetryTimer = 0;
  if (telemetryCapacity) {
    try {
      telemetryCapacity.stop?.();
    } catch {
      // Closing an AudioContext may already have stopped collection.
    }
    telemetryCapacity.onupdate = null;
  }
  telemetryCapacity = null;
  resetTelemetry();
}

function startTelemetry(adapter, engineId) {
  stopTelemetry();
  const revision = ++telemetryRevision;
  const context = adapter.context;
  const metricState = engineMetricStates.get(engineId);
  const initialStats = playbackStatsSnapshot(context);
  const initialEngineMetrics = adapter.getEngineMetrics?.();
  const telemetryState = {
    windows: 0,
    measuredWindows: 0,
    averageTotal: 0,
    peak: null,
    underrunRatio: null,
    underrunRatioTotal: 0,
    underrunRatioWindows: 0,
    xrunBaseline: initialStats.supported ? initialStats.underrunEvents : null,
    underflowBaseline: initialEngineMetrics ? 0 : null,
  };
  metricState.live = telemetryState;
  const offlineCombined = metricState.benchmark?.modes?.combined;
  if (Number.isFinite(offlineCombined?.offlineBudgetPercent)) {
    const percent = offlineCombined.offlineBudgetPercent;
    ui.dspCpu.textContent = `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}% RT`;
    ui.dspCpu.title = "Offline render real-time factor for the current pitch + time settings. This is a throughput fallback, not live or whole-device CPU usage.";
  }
  setCardMetric(engineId, "live-average", "warming…");
  setCardMetric(engineId, "live-peak", "warming…");
  setCardMetric(engineId, "deadline-miss", "warming…");
  setCardMetric(
    engineId,
    "algorithm-latency",
    formatMilliseconds(adapter.getAlgorithmLatency?.()),
  );

  try {
    const capacity = context?.renderCapacity;
    if (capacity && typeof capacity.start === "function") {
      capacity.onupdate = (event) => {
        if (revision !== telemetryRevision) return;
        const averageLoad = Number(event?.averageLoad);
        const peakLoad = Number(event?.peakLoad);
        if (!Number.isFinite(averageLoad)) return;
        telemetryState.windows += 1;
        if (telemetryState.windows <= 2) return;
        telemetryState.measuredWindows += 1;
        telemetryState.averageTotal += Math.max(0, averageLoad);
        telemetryState.peak = Number.isFinite(peakLoad)
          ? Math.max(telemetryState.peak ?? 0, Math.max(0, peakLoad))
          : telemetryState.peak;
        const underrunRatio = Number(event?.underrunRatio);
        if (Number.isFinite(underrunRatio)) {
          telemetryState.underrunRatioTotal += Math.max(0, underrunRatio);
          telemetryState.underrunRatioWindows += 1;
          telemetryState.underrunRatio = telemetryState.underrunRatioTotal
            / telemetryState.underrunRatioWindows;
        }
        const sessionAverage = telemetryState.averageTotal / telemetryState.measuredWindows;
        ui.dspCpu.textContent = formatLoad(sessionAverage);
        ui.dspCpu.title = Number.isFinite(peakLoad)
          ? `Web Audio deadline load: ${formatLoad(sessionAverage)} average, ${formatLoad(telemetryState.peak)} peak. Not whole-device CPU.`
          : `Web Audio deadline load: ${formatLoad(sessionAverage)} average. Not whole-device CPU.`;
        setCardMetric(
          engineId,
          "live-average",
          formatLoad(sessionAverage),
          "Average share of the audio callback deadline used during this listening session.",
        );
        setCardMetric(
          engineId,
          "live-peak",
          formatLoad(telemetryState.peak),
          "Highest observed share of the audio callback deadline during this listening session.",
        );
        setCardMetric(
          engineId,
          "deadline-miss",
          Number.isFinite(telemetryState.underrunRatio)
            ? formatLoad(telemetryState.underrunRatio)
            : "N/A",
          "Share of callbacks that exceeded the browser's real-time audio deadline.",
        );
      };
      capacity.start({ updateInterval: 0.5 });
      telemetryCapacity = capacity;
    } else {
      setCardMetric(engineId, "live-average", "N/A");
      setCardMetric(engineId, "live-peak", "N/A");
      setCardMetric(engineId, "deadline-miss", "N/A");
    }
  } catch {
    telemetryCapacity = null;
    setCardMetric(engineId, "live-average", "N/A");
    setCardMetric(engineId, "live-peak", "N/A");
    setCardMetric(engineId, "deadline-miss", "N/A");
  }

  const refreshAudioHealth = () => {
    if (revision !== telemetryRevision) return;
    const stats = playbackStatsSnapshot(context);
    const engineMetrics = adapter.getEngineMetrics?.();
    if (telemetryState.underflowBaseline === null && engineMetrics) {
      telemetryState.underflowBaseline = 0;
    }
    const xrunDelta = stats.supported && telemetryState.xrunBaseline !== null
      ? Math.max(0, stats.underrunEvents - telemetryState.xrunBaseline)
      : null;
    const underflowDelta = engineMetrics && telemetryState.underflowBaseline !== null
      ? Math.max(
        0,
        (Number(engineMetrics.underrunCount) || 0) - telemetryState.underflowBaseline,
      )
      : null;
    setCardMetric(
      engineId,
      "audio-xrun",
      Number.isFinite(xrunDelta) ? String(xrunDelta) : "N/A",
    );
    setCardMetric(
      engineId,
      "dsp-underflow",
      Number.isFinite(underflowDelta) ? String(underflowDelta) : "N/A",
    );
    setCardMetric(
      engineId,
      "output-latency",
      stats.latency > 0 ? formatMilliseconds(stats.latency) : "N/A",
    );
    const deadlineMissRatio = Number.isFinite(telemetryState.underrunRatio)
      ? telemetryState.underrunRatio
      : null;
    if (!stats.supported && !engineMetrics && deadlineMissRatio === null) {
      ui.audioHealth.textContent = "N/A";
      ui.audioHealth.title = "This browser and processor do not expose underrun counters.";
      return;
    }
    if (Number.isFinite(xrunDelta) && xrunDelta > 0) {
      ui.audioHealth.textContent = `XRUN ${xrunDelta}`;
      ui.audioHealth.title = `${xrunDelta} browser audio deadline failure${xrunDelta === 1 ? "" : "s"} since listening began.`;
    } else if (deadlineMissRatio !== null && deadlineMissRatio > 0) {
      ui.audioHealth.textContent = `MISS ${formatLoad(deadlineMissRatio)}`;
      ui.audioHealth.title = `${formatLoad(deadlineMissRatio)} of callbacks missed the real-time audio deadline across the measured render-capacity windows.`;
    } else if (Number.isFinite(underflowDelta) && underflowDelta > 0) {
      ui.audioHealth.textContent = `BUF ${underflowDelta}`;
      ui.audioHealth.title = `${underflowDelta} cumulative processor buffer underflow${underflowDelta === 1 ? "" : "s"} since this engine was created; these are not browser XRUNs.`;
    } else if (!stats.supported && deadlineMissRatio === null && engineMetrics) {
      ui.audioHealth.textContent = "BUF OK";
      ui.audioHealth.title = "No processor buffer underflows since this engine was created. Browser XRUN counters are unavailable.";
    } else {
      ui.audioHealth.textContent = "OK";
      ui.audioHealth.title = "No reported browser deadline failures in this session and no processor buffer underflows since this engine was created.";
    }
  };
  refreshAudioHealth();
  telemetryTimer = setInterval(refreshAudioHealth, 500);
}

function setControlsEnabled(enabled) {
  ui.clearLoopButton.disabled = !enabled;
  ui.stopButton.disabled = !enabled;
  for (const card of engineCards.values()) {
    for (const input of card.querySelectorAll("[data-control]")) input.disabled = !enabled;
    const listen = card.querySelector("[data-engine-listen]");
    if (listen) listen.disabled = !enabled;
  }
}

function resizeCanvas() {
  const rect = ui.waveform.getBoundingClientRect();
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(2, Math.round(rect.width * ratio));
  const height = Math.max(2, Math.round(rect.height * ratio));
  if (ui.waveform.width !== width || ui.waveform.height !== height) {
    ui.waveform.width = width;
    ui.waveform.height = height;
  }
  drawWaveform();
}

function drawBufferWaveform(context, samples, width, height) {
  if (!samples?.length) return;
  const center = height * 0.5;
  const amplitude = height * 0.37;
  const columns = Math.max(1, Math.floor(width));
  const samplesPerColumn = samples.length / columns;
  context.beginPath();
  for (let x = 0; x < columns; x += 1) {
    const start = Math.floor(x * samplesPerColumn);
    const end = Math.max(start + 1, Math.floor((x + 1) * samplesPerColumn));
    let low = 1;
    let high = -1;
    for (let index = start; index < end && index < samples.length; index += 1) {
      low = Math.min(low, samples[index]);
      high = Math.max(high, samples[index]);
    }
    context.moveTo(x + 0.5, center - high * amplitude);
    context.lineTo(x + 0.5, center - low * amplitude);
  }
  context.strokeStyle = "rgba(85, 217, 255, 0.55)";
  context.lineWidth = 1;
  context.stroke();
}

function drawLiveWaveform(context, analyser, width, height) {
  if (!analyser) return;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  const center = height * 0.5;
  const amplitude = height * 0.42;
  context.beginPath();
  for (let index = 0; index < data.length; index += 1) {
    const x = index / (data.length - 1) * width;
    const y = center - data[index] * amplitude;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(255, 243, 214, 0.9)");
  gradient.addColorStop(0.45, "rgba(85, 217, 255, 0.95)");
  gradient.addColorStop(1, "rgba(199, 155, 255, 0.78)");
  context.strokeStyle = gradient;
  context.lineWidth = Math.max(1.25, width / 900);
  context.shadowColor = "rgba(85, 217, 255, 0.42)";
  context.shadowBlur = 9;
  context.stroke();
  context.shadowBlur = 0;
}

function drawWaveform() {
  const context = ui.waveform.getContext("2d");
  if (!context) return;
  const { width, height } = ui.waveform;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "rgba(214, 232, 226, 0.055)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height * 0.5);
  context.lineTo(width, height * 0.5);
  context.stroke();
  if (loop) drawBufferWaveform(context, loop.samples, width, height);
  const active = activeEngineId ? adapters.get(activeEngineId) : null;
  if (active?.context?.state === "running") drawLiveWaveform(context, active.analyser, width, height);
}

function animateWaveform() {
  cancelAnimationFrame(waveformFrame);
  if (!activeEngineId) {
    waveformFrame = 0;
    drawWaveform();
    return;
  }
  const frame = () => {
    drawWaveform();
    if (activeEngineId) waveformFrame = requestAnimationFrame(frame);
  };
  waveformFrame = requestAnimationFrame(frame);
}

function updateListeningUi() {
  for (const [engineId, card] of engineCards) {
    const listening = engineId === activeEngineId;
    card.classList.toggle("is-listening", listening);
    const button = card.querySelector("[data-engine-listen]");
    if (button) {
      button.textContent = listening ? "Listening" : "Listen";
      button.setAttribute("aria-pressed", String(listening));
    }
    if (listening) setEngineStatus(engineId, "listening");
    else if (adapters.has(engineId)) setEngineStatus(engineId, "ready · suspended");
  }
  ui.stopButton.disabled = !activeEngineId;
  if (!activeEngineId) {
    setHeaderState(loop ? "loop ready" : "capture a loop", loop ? "ready" : "");
  } else {
    setHeaderState(`playing ${engineName(activeEngineId)}`, "ready");
  }
}

async function ensureAdapter(engineId) {
  if (!loop) throw new Error("Record a microphone loop first.");
  if (adapters.has(engineId)) return adapters.get(engineId);
  if (adapterPromises.has(engineId)) return adapterPromises.get(engineId);

  setEngineStatus(engineId, "loading renderer…");
  const started = performance.now();
  const revision = adapterRevision;
  const sourceLoop = loop;
  let promise;
  promise = createEngineAdapter(engineId, sourceLoop, {
    level: Number(ui.outputLevel.value),
  }).then(async (adapter) => {
    if (revision !== adapterRevision || loop !== sourceLoop) {
      await adapter.dispose();
      const error = new Error("Audio engine setup was superseded by a new loop.");
      error.name = "AbortError";
      throw error;
    }
    await adapter.update(engineSettings.get(engineId));
    adapters.set(engineId, adapter);
    if (adapterPromises.get(engineId) === promise) adapterPromises.delete(engineId);
    const loadTime = Math.max(1, Math.round(performance.now() - started));
    setCardMetric(
      engineId,
      "setup-time",
      `${loadTime} ms`,
      "One-time graph, module, or WASM initialization time. Excluded from offline render cost.",
    );
    setEngineStatus(engineId, `ready · ${loadTime} ms setup`);
    return adapter;
  }).catch((error) => {
    if (adapterPromises.get(engineId) === promise) adapterPromises.delete(engineId);
    if (error?.name !== "AbortError") setEngineStatus(engineId, "unavailable");
    throw error;
  });
  adapterPromises.set(engineId, promise);
  return promise;
}

async function stopListening({ immediate = false } = {}) {
  switchRevision += 1;
  await interruptIdleBenchmarks();
  const stoppedEngineId = activeEngineId;
  const active = activeEngineId ? adapters.get(activeEngineId) : null;
  activeEngineId = null;
  stopTelemetry();
  if (active) await active.suspend({ immediate });
  animateWaveform();
  updateListeningUi();
  if (stoppedEngineId) {
    pendingBenchmarkIds.add(stoppedEngineId);
    setCardMetric(stoppedEngineId, "cost-status", "Idle · measuring shortly");
    scheduleIdleBenchmarks(immediate ? 750 : 350);
  }
}

async function listenTo(engineId) {
  if (!loop) return;
  clearError();
  const revision = ++switchRevision;
  setHeaderState(`loading ${engineName(engineId)}`, "busy");
  try {
    await interruptIdleBenchmarks();
    if (revision !== switchRevision) return;
    const target = await ensureAdapter(engineId);
    if (revision !== switchRevision) return;
    const previousId = activeEngineId;
    if (previousId) {
      activeEngineId = null;
      stopTelemetry();
      await adapters.get(previousId)?.suspend();
      if (revision !== switchRevision) return;
      animateWaveform();
      updateListeningUi();
      pendingBenchmarkIds.add(previousId);
      if (!engineMetricStates.get(previousId)?.benchmark) {
        setCardMetric(previousId, "cost-status", "Queued · Stop to measure");
      }
    }
    target.resetEngineMetrics?.();
    await target.resume();
    if (revision !== switchRevision) {
      await target.suspend({ immediate: true });
      return;
    }
    activeEngineId = engineId;
    startTelemetry(target, engineId);
    if (!engineMetricStates.get(engineId)?.benchmark) {
      setCardMetric(engineId, "cost-status", "Listening · Stop to measure split");
    }
    updateListeningUi();
    animateWaveform();
    announce(`Listening to ${engineName(engineId)}.`);
  } catch (error) {
    if (revision === switchRevision) {
      activeEngineId = null;
      updateListeningUi();
      showError(error);
    }
  }
}

async function disposeAdapters() {
  switchRevision += 1;
  adapterRevision += 1;
  await interruptIdleBenchmarks({ clearQueue: true });
  activeEngineId = null;
  stopTelemetry();
  cancelAnimationFrame(waveformFrame);
  waveformFrame = 0;
  await Promise.allSettled([...adapters.values()].map((adapter) => adapter.dispose()));
  adapters.clear();
  adapterPromises.clear();
  for (const engine of ENGINE_DEFINITIONS) setEngineStatus(engine.id, "not loaded");
  resetEngineMetrics();
  updateListeningUi();
}

function scheduleEngineUpdate(engineId) {
  pendingUpdates.add(engineId);
  if (updateFrame) return;
  updateFrame = requestAnimationFrame(async () => {
    updateFrame = 0;
    const engineIds = [...pendingUpdates];
    pendingUpdates.clear();
    for (const id of engineIds) {
      const adapter = adapters.get(id);
      if (!adapter) continue;
      try {
        await adapter.update(engineSettings.get(id));
        if (id !== activeEngineId) setEngineStatus(id, "ready · suspended");
      } catch (error) {
        setEngineStatus(id, "parameter update failed");
        showError(error);
      }
    }
    if (activeEngineId) updateListeningUi();
  });
}

function bindEngineCards() {
  for (const [engineId, card] of engineCards) {
    const settings = engineSettings.get(engineId);
    const pitch = card.querySelector('[data-control="pitch"]');
    const duration = card.querySelector('[data-control="duration"]');
    const pitchOut = card.querySelector('[data-value="pitch"]');
    const durationOut = card.querySelector('[data-value="duration"]');

    pitch?.addEventListener("input", () => {
      settings.pitch = Number(pitch.value);
      pitchOut.textContent = formatPitch(settings.pitch);
      invalidateEngineBenchmark(engineId, "Changed · listen to remeasure");
      scheduleEngineUpdate(engineId);
    });
    duration?.addEventListener("input", () => {
      settings.stretch = Number(duration.value);
      durationOut.textContent = engineId === "native-tape"
        ? formatTapeStretch(settings.stretch)
        : formatStretch(settings.stretch);
      invalidateEngineBenchmark(engineId, "Changed · listen to remeasure");
      scheduleEngineUpdate(engineId);
    });
    card.querySelector("[data-engine-listen]")?.addEventListener("click", () => {
      void listenTo(engineId);
    });
  }
}

async function recordMicSamples(seconds) {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) throw new Error("Microphone capture is not available in this browser.");

  let stream = null;
  let context = null;
  let source = null;
  let captureNode = null;
  let silentGain = null;
  let timeout = 0;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    context = new Context({ latencyHint: "interactive" });
    await context.audioWorklet.addModule(
      new URL("./src/mic-loop-capture-processor.js", import.meta.url),
    );
    const sampleCount = Math.round(seconds * context.sampleRate);
    captureNode = new AudioWorkletNode(context, "morphazoid-mic-loop-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { sampleCount },
    });
    source = context.createMediaStreamSource(stream);
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(captureNode);
    captureNode.connect(silentGain);
    silentGain.connect(context.destination);

    const result = await new Promise((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Microphone capture timed out. Please try again.")),
        seconds * 1_000 + 4_000,
      );
      captureNode.port.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "progress") {
          const progress = Math.max(0, Math.min(1, message.captured / message.total));
          ui.captureProgressBar.style.width = `${progress * 100}%`;
          ui.captureButtonHint.textContent = `${(progress * seconds).toFixed(1)} / ${seconds.toFixed(1)} seconds`;
        }
        if (message?.type === "complete" && message.buffer instanceof ArrayBuffer) {
          resolve({
            samples: new Float32Array(message.buffer),
            sampleRate: Number(message.sampleRate) || context.sampleRate,
          });
        }
      };
      captureNode.onprocessorerror = () => {
        reject(new Error("The microphone capture worklet stopped unexpectedly."));
      };
    });
    return result;
  } finally {
    clearTimeout(timeout);
    if (captureNode?.port) captureNode.port.onmessage = null;
    try { source?.disconnect(); } catch { /* already disconnected */ }
    try { captureNode?.disconnect(); } catch { /* already disconnected */ }
    try { silentGain?.disconnect(); } catch { /* already disconnected */ }
    for (const track of stream?.getTracks?.() ?? []) track.stop();
    try { await context?.close(); } catch { /* already closed */ }
  }
}

async function captureLoop() {
  if (captureActive) return;
  captureActive = true;
  clearError();
  await stopListening({ immediate: true });
  await disposeAdapters();

  const seconds = Number(ui.captureLength.value);
  ui.captureButton.disabled = true;
  ui.captureButton.classList.add("is-recording");
  ui.captureButtonLabel.textContent = "Recording…";
  ui.captureButtonHint.textContent = `0.0 / ${seconds.toFixed(1)} seconds`;
  ui.captureProgress.hidden = false;
  ui.captureProgressBar.style.width = "0%";
  setControlsEnabled(false);
  setHeaderState("capturing microphone", "busy");
  announce(`Recording a ${seconds.toFixed(1)} second microphone loop.`);

  try {
    const captured = await recordMicSamples(seconds);
    loop = prepareMicLoop(captured.samples, captured.sampleRate);
    loopRevision += 1;
    ui.waveformEmpty.hidden = true;
    ui.waveformTime.textContent = `${loop.duration.toFixed(2)} s · ${(loop.sampleRate / 1_000).toFixed(1)} kHz`;
    setControlsEnabled(true);
    drawWaveform();
    updateListeningUi();
    setHeaderState("loop ready", "ready");
    announce(`Microphone loop ready. Duration ${loop.duration.toFixed(2)} seconds.`);
  } catch (error) {
    loop = null;
    loopRevision += 1;
    ui.waveformEmpty.hidden = false;
    ui.waveformTime.textContent = "0.00 s";
    setControlsEnabled(false);
    drawWaveform();
    if (error?.name === "NotAllowedError") {
      showError(new Error("Microphone access was not allowed. Enable it for this page and record again."));
    } else {
      showError(error);
    }
  } finally {
    captureActive = false;
    ui.captureButton.disabled = false;
    ui.captureButton.classList.remove("is-recording");
    ui.captureButtonLabel.textContent = loop ? "Replace test loop" : "Record test loop";
    ui.captureButtonHint.textContent = loop ? "records a new common source" : "microphone permission required";
    ui.captureProgress.hidden = true;
  }
}

async function clearLoop() {
  await stopListening({ immediate: true });
  await disposeAdapters();
  loop = null;
  loopRevision += 1;
  ui.waveformEmpty.hidden = false;
  ui.waveformTime.textContent = "0.00 s";
  ui.captureButtonLabel.textContent = "Record test loop";
  ui.captureButtonHint.textContent = "microphone permission required";
  setControlsEnabled(false);
  clearError();
  drawWaveform();
  updateListeningUi();
  announce("Microphone loop cleared.");
}

ui.captureLength.addEventListener("input", () => {
  ui.captureLengthOut.textContent = `${Number(ui.captureLength.value).toFixed(1)} s`;
});
ui.outputLevel.addEventListener("input", () => {
  const value = Number(ui.outputLevel.value);
  ui.outputLevelOut.textContent = `${Math.round(value * 100)}%`;
  for (const adapter of adapters.values()) adapter.setOutputLevel(value);
});
ui.captureButton.addEventListener("click", () => void captureLoop());
ui.clearLoopButton.addEventListener("click", () => void clearLoop());
ui.stopButton.addEventListener("click", () => void stopListening());

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "Escape") void stopListening({ immediate: true });
});

window.addEventListener("pagehide", () => {
  cancelActiveBenchmark();
  for (const adapter of adapters.values()) void adapter.dispose();
});

createEngineMetricPanels();
bindEngineCards();
setControlsEnabled(false);
resetTelemetry();
resetEngineMetrics();
resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(ui.waveform);
resizeCanvas();
updateListeningUi();
