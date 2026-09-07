import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";
import {
  createHocketNoiseBuffer,
  HOCKET_MARKER_SOURCE_LIMIT,
  hocketMarkerPlan,
  scheduleHocketMarker,
} from "./src/hocket-loom-audio.js";
import {
  HOCKET_PRESETS,
  HOCKET_VOICE_COLORS,
  analyzeHocketState,
  createHocketState,
  editHocketCell,
  effectiveHocketCell,
  hocketEventsAtStep,
  hocketFocusGain,
  hocketStepDurationSeconds,
  presetForHocket,
  resizeHocketPattern,
  rotateHocketPattern,
  sanitizeHocketState,
  tightenHocketPattern,
} from "./src/hocket-loom.js";

const $ = (selector) => document.querySelector(selector);
const dom = {
  audioButton: $("#audioButton"),
  audioState: $("#audioState"),
  audioError: $("#audioError"),
  level: $("#level"),
  levelOut: $("#levelOut"),
  playButton: $("#playButton"),
  playLabel: $("#playLabel"),
  playState: $("#playState"),
  stageState: $("#stageState"),
  stageStateText: $("#stageStateText"),
  presetSelect: $("#presetSelect"),
  presetStatus: $("#presetStatus"),
  presetDescription: $("#presetDescription"),
  presetSource: $("#presetSource"),
  voiceCount: $("#voiceCount"),
  cycleLength: $("#cycleLength"),
  shiftVoice: $("#shiftVoice"),
  shiftBack: $("#shiftBack"),
  shiftForward: $("#shiftForward"),
  phaseControls: $("#phaseControls"),
  tightenButton: $("#tightenButton"),
  clearButton: $("#clearButton"),
  tempoBpm: $("#tempoBpm"),
  tempoOut: $("#tempoOut"),
  swing: $("#swing"),
  swingOut: $("#swingOut"),
  pulseLength: $("#pulseLength"),
  pulseLengthOut: $("#pulseLengthOut"),
  soundSet: $("#soundSet"),
  focusMode: $("#focusMode"),
  structureSummary: $("#structureSummary"),
  timeSummary: $("#timeSummary"),
  soundSummary: $("#soundSummary"),
  pulseTool: $("#pulseTool"),
  restTool: $("#restTool"),
  preserveComposite: $("#preserveComposite"),
  voiceGrid: $("#voiceGrid"),
  compositeRail: $("#compositeRail"),
  voicePads: $("#voicePads"),
  coverageOut: $("#coverageOut"),
  handoffOut: $("#handoffOut"),
  gapOut: $("#gapOut"),
  collisionOut: $("#collisionOut"),
  resetButton: $("#resetButton"),
  liveStatus: $("#liveStatus"),
  canvas: $("#loomCanvas"),
  canvasWrap: $("#canvasWrap"),
  playheadLabel: $("#playheadLabel"),
};

const transport = {
  playing: false,
  position: 0,
  lastPerformanceMs: performance.now(),
  scheduleCursor: 0,
  scheduleCurrentStep: false,
};

let state = createHocketState();
let editTool = "pulse";
let selected = { voice: 0, step: 0 };
let currentPaintedStep = -1;
let drawDirty = true;
let animationFrame = 0;
let schedulerTimer = 0;
let resizeObserver = null;
let pointerDragKey = "";
let destroyed = false;

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

class HocketAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.analyser = null;
    this.releaseOutput = null;
    this.noiseBuffer = null;
    this.groups = new Set();
    this.generation = 0;
    this.closing = false;
    this.stateChangeHandler = null;
    this.scheduledSteps = [];
    this.activeSourceCount = 0;
    this.strikeHistory = [];
  }

  get armed() {
    return Boolean(this.context && !this.closing && this.context.state !== "closed");
  }

  async start(settings) {
    this.closing = false;
    const generation = this.generation;
    if (!this.context || this.context.state === "closed") {
      const AudioContextClass = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.build(settings);
    }
    const context = this.context;
    unlockAudioContext(context);
    if (context.state === "suspended") await context.resume();
    if (generation !== this.generation || context !== this.context || context.state === "closed") {
      const error = new Error("Audio start was cancelled.");
      error.name = "AbortError";
      throw error;
    }
    this.update(settings);
    return context;
  }

  build(settings) {
    const context = this.context;
    this.stateChangeHandler = () => handleAudioContextStateChange(context);
    context.addEventListener?.("statechange", this.stateChangeHandler);
    this.master = context.createGain();
    this.master.gain.value = settings.level;

    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 10;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.12;

    this.master.connect(this.compressor);
    this.releaseOutput = connectAudioOutput(context, this.compressor, { runtime: this.runtime });

    this.noiseBuffer = createHocketNoiseBuffer(context);
  }

  update(settings) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(settings.level, now, 0.018);
  }

  pruneEnded(cutoff = this.context?.currentTime ?? 0) {
    for (const group of [...this.groups]) {
      if (group.endTime <= cutoff) this.releaseGroup(group);
    }
  }

  markerPlan(event, settings, peak) {
    return hocketMarkerPlan({
      soundSet: settings.soundSet,
      pulseLengthMs: settings.pulseLengthMs,
      voice: event.voice,
      tone: event.tone,
      voiceCount: settings.voiceCount,
      peak: Math.min(0.3, peak),
    });
  }

  schedule(events, when, settings, absoluteStep) {
    const context = this.context;
    if (!context || context.state !== "running" || when < context.currentTime - 0.02) return;
    this.pruneEnded(context.currentTime);
    const safeEvents = events.slice(0, 4);
    const normalization = 1 / Math.sqrt(Math.max(1, safeEvents.length));
    const prepared = safeEvents.map((event) => {
      const focus = hocketFocusGain(
        settings.focusMode,
        event.voice,
        absoluteStep,
        settings.voiceCount
      );
      const peak = 0.18 * normalization * focus;
      return {
        event,
        peak,
        plan: this.markerPlan(event, settings, peak),
      };
    });
    const requiredSources = prepared.reduce((total, entry) => total + entry.plan.sourceCount, 0);
    if (
      !prepared.length ||
      this.groups.size + prepared.length > 96 ||
      this.activeSourceCount + requiredSources > HOCKET_MARKER_SOURCE_LIMIT
    ) {
      return;
    }
    this.scheduledSteps.push(absoluteStep);
    if (this.scheduledSteps.length > 64) this.scheduledSteps.shift();
    prepared.forEach(({ event, peak, plan }) => {
      this.strike(event, when, settings, peak, plan);
    });
  }

  strike(event, when, settings, peak = 0.18, preparedPlan = null) {
    if (!this.context || this.context.state !== "running") return;
    const context = this.context;
    this.pruneEnded(context.currentTime);
    if (this.groups.size >= 96) return;
    const start = Math.max(context.currentTime + 0.001, when);
    const plan = preparedPlan ?? this.markerPlan(event, settings, peak);
    if (this.activeSourceCount + plan.sourceCount > HOCKET_MARKER_SOURCE_LIMIT) return;
    const scheduled = scheduleHocketMarker(context, this.master, plan, {
      when: start,
      noiseBuffer: this.noiseBuffer,
    });
    const group = {
      startTime: scheduled.startTime,
      endTime: scheduled.endTime,
      voice: event.voice,
      material: plan.material,
      sourceKinds: [...plan.sourceKinds],
      sources: scheduled.sources,
      nodes: scheduled.nodes,
      safetyGain: scheduled.safetyGain,
      sourceCost: plan.sourceCount,
      pendingSources: new Set(scheduled.sources),
      released: false,
      releasing: false,
    };
    this.groups.add(group);
    this.activeSourceCount += plan.sourceCount;
    this.strikeHistory.push({
      material: plan.material,
      voice: plan.voice,
      tone: plan.tone,
      sourceKinds: [...plan.sourceKinds],
      sourceCount: plan.sourceCount,
      durationMs: Math.round(plan.durationSeconds * 1000),
      startTime: scheduled.startTime,
      endTime: scheduled.endTime,
    });
    if (this.strikeHistory.length > 48) this.strikeHistory.shift();
    group.sources.forEach((source) => {
      source.onended = () => {
        group.pendingSources.delete(source);
        if (!group.pendingSources.size) this.releaseGroup(group);
      };
    });
  }

  releaseGroup(group) {
    if (!group || group.released) return;
    group.released = true;
    this.activeSourceCount = Math.max(0, this.activeSourceCount - group.sourceCost);
    group.sources.forEach((source) => {
      source.onended = null;
    });
    group.pendingSources.clear();
    group.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // Nodes may already have been disconnected during teardown.
      }
    });
    this.groups.delete(group);
  }

  cancelFuture(cutoff = this.context?.currentTime ?? 0) {
    for (const group of [...this.groups]) {
      if (group.startTime < cutoff + 0.008) continue;
      group.sources.forEach((source) => {
        try {
          source.stop(cutoff + 0.003);
        } catch {
          // A scheduled source can already have ended.
        }
      });
      this.releaseGroup(group);
    }
  }

  panic() {
    if (!this.context) return;
    const now = this.context.currentTime;
    const releaseAt = now + 0.012;
    for (const group of [...this.groups]) {
      if (group.releasing) continue;
      group.releasing = true;
      const gain = group.safetyGain?.gain;
      if (gain) {
        try {
          if (typeof gain.cancelAndHoldAtTime === "function") {
            gain.cancelAndHoldAtTime(now);
          } else {
            const heldGain = Math.max(0.0001, Number(gain.value) || 0.0001);
            gain.cancelScheduledValues(now);
            gain.setValueAtTime(heldGain, now);
          }
          gain.exponentialRampToValueAtTime(0.0001, releaseAt);
        } catch {
          // The context may already be closing.
        }
      }
      group.sources.forEach((source) => {
        try {
          source.stop(releaseAt + 0.002);
        } catch {
          // Best-effort teardown.
        }
      });
      this.runtime.setTimeout(() => this.releaseGroup(group), 24);
    }
  }

  async close() {
    this.generation += 1;
    this.closing = true;
    const context = this.context;
    if (context && this.stateChangeHandler) {
      context.removeEventListener?.("statechange", this.stateChangeHandler);
    }
    this.stateChangeHandler = null;
    const releasingGroups = this.groups.size > 0;
    this.panic();
    if (context && releasingGroups && context.state === "running") {
      await new Promise((resolve) => this.runtime.setTimeout(resolve, 18));
    }
    this.releaseOutput?.();
    this.releaseOutput = null;
    for (const group of [...this.groups]) this.releaseGroup(group);
    this.activeSourceCount = 0;
    this.strikeHistory = [];

    this.noiseBuffer = null;
    this.scheduledSteps = [];
    this.master = null;
    this.compressor = null;
    this.analyser = null;
    this.context = null;
    this.closing = false;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // The browser may close the context concurrently.
      }
    }
  }
}

const audio = new HocketAudio();

function handleAudioContextStateChange(context) {
  if (context !== audio.context || audio.closing) return;
  if (context.state !== "running") {
    audio.panic();
    return;
  }
  transport.lastPerformanceMs = performance.now();
  if (transport.playing) {
    resyncScheduler();
    schedulerTick();
  }
  drawDirty = true;
}

function currentStep() {
  return mod(Math.floor(transport.position), state.length);
}

function updateTransport(nowMs = performance.now()) {
  if (!transport.playing) {
    transport.lastPerformanceMs = nowMs;
    return;
  }
  let remainingMs = Math.max(0, Math.min(10_000, nowMs - transport.lastPerformanceMs));
  transport.lastPerformanceMs = nowMs;
  let guard = 0;

  while (remainingMs > 0.001 && guard < 128) {
    const stepInteger = Math.floor(transport.position);
    const fraction = transport.position - stepInteger;
    const durationMs = hocketStepDurationSeconds(state, stepInteger) * 1000;
    const toBoundaryMs = durationMs * (1 - fraction);
    if (remainingMs < toBoundaryMs) {
      transport.position += remainingMs / durationMs;
      remainingMs = 0;
    } else {
      transport.position = stepInteger + 1;
      remainingMs -= toBoundaryMs;
    }
    guard += 1;
  }
}

function secondsFromPositionTo(targetStep) {
  let cursor = transport.position;
  let seconds = 0;
  let guard = 0;
  while (cursor < targetStep - 0.000001 && guard < 64) {
    const stepInteger = Math.floor(cursor);
    const segmentEnd = Math.min(targetStep, stepInteger + 1);
    seconds += hocketStepDurationSeconds(state, stepInteger) * (segmentEnd - cursor);
    cursor = segmentEnd;
    guard += 1;
  }
  return seconds;
}

function resyncScheduler() {
  updateTransport();
  audio.cancelFuture();
  transport.scheduleCurrentStep = false;
  transport.scheduleCursor = Math.max(
    Math.ceil(transport.position - 0.000001),
    Math.floor(transport.position)
  );
}

function schedulerTick() {
  if (!transport.playing || !audio.armed || document.hidden) return;
  updateTransport();
  const context = audio.context;
  if (!context || context.state !== "running") return;
  audio.update(state);
  const horizon = 0.12;
  let scheduled = 0;
  const scheduleCurrentStep = transport.scheduleCurrentStep;
  transport.scheduleCurrentStep = false;
  if (!scheduleCurrentStep) {
    transport.scheduleCursor = Math.max(
      transport.scheduleCursor,
      Math.ceil(transport.position - 0.000001)
    );
  }

  while (scheduled < 32) {
    const delay = secondsFromPositionTo(transport.scheduleCursor);
    if (delay > horizon) break;
    const events = hocketEventsAtStep(state, mod(transport.scheduleCursor, state.length));
    audio.schedule(events, context.currentTime + Math.max(0.003, delay), state, transport.scheduleCursor);
    transport.scheduleCursor += 1;
    scheduled += 1;
  }
}

function setLiveStatus(message) {
  dom.liveStatus.textContent = message;
}

function showAudioError(error) {
  dom.audioError.textContent = error?.message || "Audio could not start.";
  dom.audioError.hidden = false;
}

function hideAudioError() {
  dom.audioError.hidden = true;
}

async function toggleAudio() {
  hideAudioError();
  if (audio.armed) {
    dom.audioButton.disabled = true;
    await audio.close();
    dom.audioButton.disabled = false;
    dom.audioButton.setAttribute("aria-pressed", "false");
    dom.audioState.textContent = "off";
    setLiveStatus("Audio off. The visual transport is unchanged.");
    return;
  }

  dom.audioButton.disabled = true;
  dom.audioState.textContent = "starting";
  try {
    await audio.start(state);
    dom.audioButton.setAttribute("aria-pressed", "true");
    dom.audioState.textContent = "on";
    resyncScheduler();
    schedulerTick();
    setLiveStatus(
      transport.playing ? "Audio joined the running rhythm." : "Audio on. Transport remains stopped."
    );
  } catch (error) {
    await audio.close();
    if (error?.name !== "AbortError") showAudioError(error);
    dom.audioButton.setAttribute("aria-pressed", "false");
    dom.audioState.textContent = "error";
  } finally {
    dom.audioButton.disabled = false;
  }
}

function setTransport(playing) {
  updateTransport();
  transport.playing = playing;
  transport.lastPerformanceMs = performance.now();
  if (playing) {
    transport.scheduleCursor = Math.floor(transport.position + 0.000001);
    transport.scheduleCurrentStep = true;
    schedulerTick();
  } else {
    transport.scheduleCurrentStep = false;
    audio.panic();
    transport.position = 0;
    transport.scheduleCursor = 0;
  }
  renderTransport();
  drawDirty = true;
  setLiveStatus(playing ? "Hocket Luigi transport running." : "Hocket Luigi transport stopped.");
}

function renderTransport() {
  const playing = transport.playing;
  dom.playButton.setAttribute("aria-pressed", String(playing));
  dom.playLabel.textContent = playing ? "Stop the loom" : "Run the loom";
  dom.playState.textContent = playing ? "space · rhythm running" : "space · stopped";
  dom.stageState.dataset.state = playing ? "playing" : "ready";
  dom.stageStateText.textContent = playing ? "weaving" : "ready";
  dom.playButton.querySelector(".hocket-play-icon").textContent = playing ? "■" : "▶";
}

function markVariation(nextState) {
  return { ...nextState, variation: true };
}

function focusedDynamicControl() {
  const active = document.activeElement;
  if (active?.matches?.(".hocket-step")) {
    return `.hocket-step[data-voice="${active.dataset.voice}"][data-step="${active.dataset.step}"]`;
  }
  if (active?.matches?.("[data-phase-voice]")) {
    return `[data-phase-voice="${active.dataset.phaseVoice}"]`;
  }
  return null;
}

function restoreDynamicFocus(selector) {
  if (!selector) return;
  document.querySelector(selector)?.focus({ preventScroll: true });
}

function commit(nextState, message, { resync = true } = {}) {
  const focusTarget = focusedDynamicControl();
  state = sanitizeHocketState(nextState);
  selected.voice = Math.min(selected.voice, state.voiceCount - 1);
  selected.step = mod(selected.step, state.length);
  if (resync && transport.playing && audio.armed) resyncScheduler();
  renderState();
  restoreDynamicFocus(focusTarget);
  drawDirty = true;
  if (message) setLiveStatus(message);
}

function populatePresetOptions() {
  dom.presetSelect.replaceChildren(
    ...HOCKET_PRESETS.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = `${preset.name} · ${preset.region}`;
      return option;
    })
  );
}

function renderPreset() {
  const preset = presetForHocket(state.presetId);
  dom.presetSelect.value = state.presetId;
  dom.presetStatus.textContent = state.variation ? `${preset.status} · your variation` : preset.status;
  dom.presetDescription.textContent = preset.description;
  dom.presetSource.href = preset.source.url;
  dom.presetSource.textContent = `Source: ${preset.source.title}`;
  dom.presetSource.target = preset.source.url.startsWith("http") ? "_blank" : "";
  dom.presetSource.rel = preset.source.url.startsWith("http") ? "noreferrer" : "";
}

function renderMetrics() {
  const analysis = analyzeHocketState(state);
  dom.coverageOut.value = `${Math.round(analysis.coverage * 100)}%`;
  dom.handoffOut.value = String(analysis.handoffs);
  dom.gapOut.value = String(analysis.gaps);
  dom.collisionOut.value = String(analysis.collisions);
}

function makeStepButton(voice, step) {
  const button = document.createElement("button");
  const active = effectiveHocketCell(state, voice, step);
  button.type = "button";
  button.className = `hocket-step${active ? " is-on" : ""}`;
  button.dataset.voice = String(voice);
  button.dataset.step = String(step);
  button.style.setProperty("--voice-color", HOCKET_VOICE_COLORS[voice]);
  button.setAttribute("aria-pressed", String(Boolean(active)));
  button.setAttribute(
    "aria-label",
    `${state.names[voice]}, pulse ${step + 1}: ${active ? `tone ${active}` : "rest"}`
  );
  return button;
}

function renderGrid() {
  dom.voiceGrid.style.setProperty("--step-count", state.length);
  const fragment = document.createDocumentFragment();
  for (let voice = 0; voice < state.voiceCount; voice += 1) {
    const row = document.createElement("div");
    row.className = "hocket-voice-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", state.names[voice]);
    const label = document.createElement("div");
    label.className = "hocket-lane-label";
    label.style.setProperty("--voice-color", HOCKET_VOICE_COLORS[voice]);
    label.setAttribute("aria-hidden", "true");
    label.innerHTML = `<i aria-hidden="true"></i><span>${state.names[voice]}</span>`;
    row.append(label);
    for (let step = 0; step < state.length; step += 1) {
      row.append(makeStepButton(voice, step));
    }
    fragment.append(row);
  }
  dom.voiceGrid.replaceChildren(fragment);

  dom.compositeRail.style.setProperty("--step-count", state.length);
  dom.compositeRail.replaceChildren(
    ...Array.from({ length: state.length }, (_, step) => {
      const events = hocketEventsAtStep(state, step);
      const cell = document.createElement("div");
      cell.className = "hocket-composite-step";
      cell.dataset.step = String(step);
      cell.textContent = events.length
        ? events.map((event) => event.tone).join("+")
        : "—";
      if (!events.length) cell.classList.add("is-gap");
      if (events.length > 1) cell.classList.add("is-collision");
      cell.setAttribute(
        "aria-label",
        `Composite pulse ${step + 1}: ${events.length ? cell.textContent : "silent"}`
      );
      return cell;
    })
  );
}

function renderVoiceControls() {
  const selectedShiftVoice = Math.min(
    Number(dom.shiftVoice.value) || 0,
    state.voiceCount - 1
  );
  dom.shiftVoice.replaceChildren(
    ...Array.from({ length: state.voiceCount }, (_, voice) => {
      const option = document.createElement("option");
      option.value = String(voice);
      option.textContent = state.names[voice];
      return option;
    })
  );
  dom.shiftVoice.value = String(selectedShiftVoice);

  dom.phaseControls.replaceChildren(
    ...Array.from({ length: state.voiceCount }, (_, voice) => {
      const label = document.createElement("label");
      label.className = "hocket-phase-control";
      label.style.setProperty("--voice-color", HOCKET_VOICE_COLORS[voice]);
      const phase = mod(state.phases[voice], state.length);
      label.innerHTML = `
        <span>${state.names[voice]}</span>
        <input type="range" min="0" max="${state.length - 1}" step="1"
          value="${phase}" data-phase-voice="${voice}"
          aria-label="${state.names[voice]} phase shift" />
        <output>+${phase}</output>
      `;
      return label;
    })
  );

  dom.voicePads.replaceChildren(
    ...Array.from({ length: state.voiceCount }, (_, voice) => {
      const button = document.createElement("button");
      button.className = "hocket-voice-pad";
      button.type = "button";
      button.dataset.auditionVoice = String(voice);
      button.style.setProperty("--voice-color", HOCKET_VOICE_COLORS[voice]);
      button.textContent = state.names[voice];
      button.setAttribute("aria-label", `Audition ${state.names[voice]}`);
      return button;
    })
  );
}

function renderControls() {
  dom.voiceCount.value = String(state.voiceCount);
  dom.cycleLength.value = String(state.length);
  dom.tempoBpm.value = String(state.tempoBpm);
  dom.swing.value = String(state.swing);
  dom.pulseLength.value = String(state.pulseLengthMs);
  dom.soundSet.value = state.soundSet;
  dom.focusMode.value = state.focusMode;
  dom.preserveComposite.checked = state.preserveComposite;
  dom.level.value = String(state.level);

  dom.tempoOut.value = `${Math.round(state.tempoBpm)} BPM`;
  dom.swingOut.value = `${Math.round(state.swing * 100)}%`;
  dom.pulseLengthOut.value = `${Math.round(state.pulseLengthMs)} ms`;
  dom.levelOut.value = `${Math.round(state.level * 100)}%`;
  dom.structureSummary.value = `${state.voiceCount} voices · ${state.length} pulses`;
  dom.timeSummary.value = `${Math.round(state.tempoBpm)} BPM · ${
    state.swing < 0.01 ? "straight" : `${Math.round(state.swing * 100)}% swing`
  }`;
  const soundLabel = dom.soundSet.selectedOptions[0]?.textContent || state.soundSet;
  dom.soundSummary.value = `${soundLabel} · ${state.focusMode.replace("-", " ")}`;
  dom.pulseTool.setAttribute("aria-pressed", String(editTool === "pulse"));
  dom.restTool.setAttribute("aria-pressed", String(editTool === "rest"));
}

function renderState() {
  renderPreset();
  renderMetrics();
  renderGrid();
  renderVoiceControls();
  renderControls();
  paintPlayhead(currentStep(), true);
}

function applyEdit(voice, step, tool = editTool) {
  const preserveComposite = state.preserveComposite;
  const next = editHocketCell(state, voice, step, {
    tool,
    preserveComposite,
  });
  selected = { voice, step };
  commit(
    next,
    `${state.names[voice]} pulse ${step + 1} ${tool === "rest" ? "rested" : "placed"}.`
  );
  if (tool === "rest" && !preserveComposite) return;
  hocketEventsAtStep(state, step).forEach((event) => {
    auditionVoice(event.voice, event.tone, 0.13);
  });
}

function auditionVoice(voice, tone = 1, peak = 0.2) {
  if (!audio.armed || audio.context?.state !== "running") return false;
  audio.update(state);
  audio.strike({ voice, tone }, audio.context.currentTime + 0.004, state, peak);
  return true;
}

function paintPlayhead(step, force = false) {
  if (!force && step === currentPaintedStep) return;
  currentPaintedStep = step;
  document.querySelectorAll(".hocket-step.is-current, .hocket-composite-step.is-current").forEach(
    (element) => element.classList.remove("is-current")
  );
  document
    .querySelectorAll(`.hocket-step[data-step="${step}"], .hocket-composite-step[data-step="${step}"]`)
    .forEach((element) => element.classList.add("is-current"));
  dom.playheadLabel.textContent = String(step + 1).padStart(2, "0");
}

function canvasDimensions() {
  const rect = dom.canvas.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    centerX: rect.width / 2,
    centerY: rect.height / 2,
    outerRadius: Math.min(rect.width, rect.height) * 0.405,
  };
}

function ringRadius(voice, dimensions) {
  const spacing = Math.min(51, dimensions.outerRadius / Math.max(4.5, state.voiceCount + 0.7));
  return dimensions.outerRadius - voice * spacing;
}

function pointFor(voice, step, dimensions, radiusOffset = 0) {
  const angle = (step / state.length) * Math.PI * 2 - Math.PI / 2;
  const radius = ringRadius(voice, dimensions) + radiusOffset;
  return {
    x: dimensions.centerX + Math.cos(angle) * radius,
    y: dimensions.centerY + Math.sin(angle) * radius,
  };
}

function resizeCanvas() {
  const width = Math.max(320, dom.canvasWrap.clientWidth);
  const height = Math.max(330, Math.min(620, width * 0.66));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  dom.canvas.style.height = `${height}px`;
  if (dom.canvas.width !== Math.round(width * dpr) || dom.canvas.height !== Math.round(height * dpr)) {
    dom.canvas.width = Math.round(width * dpr);
    dom.canvas.height = Math.round(height * dpr);
  }
  drawDirty = true;
}

function drawCanvas() {
  const context = dom.canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const dimensions = canvasDimensions();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  const analysis = analyzeHocketState(state);
  const playStep = currentStep();
  const phase = transport.position - Math.floor(transport.position);

  const halo = context.createRadialGradient(
    dimensions.centerX,
    dimensions.centerY,
    dimensions.outerRadius * 0.08,
    dimensions.centerX,
    dimensions.centerY,
    dimensions.outerRadius * 1.15
  );
  halo.addColorStop(0, "rgba(255, 209, 92, 0.055)");
  halo.addColorStop(0.72, "rgba(85, 230, 207, 0.018)");
  halo.addColorStop(1, "rgba(9, 7, 15, 0)");
  context.fillStyle = halo;
  context.fillRect(0, 0, dimensions.width, dimensions.height);

  for (let step = 0; step < state.length; step += 1) {
    const outer = pointFor(0, step, dimensions, 18);
    context.fillStyle = step % state.pulsesPerBeat === 0
      ? "rgba(255, 209, 92, 0.78)"
      : "rgba(255, 255, 255, 0.22)";
    context.beginPath();
    context.arc(outer.x, outer.y, step % state.pulsesPerBeat === 0 ? 2.6 : 1.4, 0, Math.PI * 2);
    context.fill();
  }

  for (let voice = 0; voice < state.voiceCount; voice += 1) {
    const radius = ringRadius(voice, dimensions);
    context.strokeStyle = "rgba(255, 255, 255, 0.105)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(dimensions.centerX, dimensions.centerY, radius, 0, Math.PI * 2);
    context.stroke();

    for (let step = 0; step < state.length; step += 1) {
      const point = pointFor(voice, step, dimensions);
      const tone = effectiveHocketCell(state, voice, step);
      const selectedCell = selected.voice === voice && selected.step === step;
      if (selectedCell) {
        context.strokeStyle = "#ffd15c";
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(point.x, point.y, 12, 0, Math.PI * 2);
        context.stroke();
      }

      context.fillStyle = tone ? HOCKET_VOICE_COLORS[voice] : "rgba(255,255,255,0.08)";
      context.beginPath();
      context.arc(point.x, point.y, tone ? 6.2 + Math.min(2, tone * 0.3) : 2.2, 0, Math.PI * 2);
      context.fill();
      if (tone) {
        context.strokeStyle = "rgba(9, 7, 15, 0.72)";
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineWidth = 2.2;
  context.strokeStyle = "rgba(255, 209, 92, 0.28)";
  context.beginPath();
  let started = false;
  for (let step = 0; step < state.length; step += 1) {
    const events = analysis.eventsByStep[step];
    if (!events.length) continue;
    const point = pointFor(events[0].voice, step, dimensions);
    if (!started) {
      context.moveTo(point.x, point.y);
      started = true;
    } else {
      context.lineTo(point.x, point.y);
    }
  }
  if (started) {
    const firstNonEmpty = analysis.eventsByStep.findIndex((events) => events.length);
    if (firstNonEmpty >= 0) {
      const firstEvent = analysis.eventsByStep[firstNonEmpty][0];
      const first = pointFor(firstEvent.voice, firstNonEmpty, dimensions);
      context.lineTo(first.x, first.y);
    }
    context.stroke();
  }
  context.restore();

  analysis.eventsByStep.forEach((events, step) => {
    if (events.length < 2) return;
    events.forEach((event) => {
      const point = pointFor(event.voice, step, dimensions);
      context.strokeStyle = "#ffd15c";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(point.x, point.y, 10.5, 0, Math.PI * 2);
      context.stroke();
    });
  });

  const angle = ((playStep + phase) / state.length) * Math.PI * 2 - Math.PI / 2;
  context.strokeStyle = transport.playing
    ? "rgba(85, 230, 207, 0.82)"
    : "rgba(255, 255, 255, 0.17)";
  context.lineWidth = transport.playing ? 2 : 1;
  context.beginPath();
  context.moveTo(dimensions.centerX, dimensions.centerY);
  context.lineTo(
    dimensions.centerX + Math.cos(angle) * (dimensions.outerRadius + 13),
    dimensions.centerY + Math.sin(angle) * (dimensions.outerRadius + 13)
  );
  context.stroke();

  const centerRadius = Math.max(50, ringRadius(state.voiceCount - 1, dimensions) - 34);
  context.fillStyle = "#0b0911";
  context.strokeStyle = "rgba(255, 209, 92, 0.2)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(dimensions.centerX, dimensions.centerY, centerRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f7f3ff";
  context.font = `700 ${Math.max(15, centerRadius * 0.32)}px system-ui, sans-serif`;
  context.fillText(`${Math.round(analysis.coverage * 100)}%`, dimensions.centerX, dimensions.centerY - 7);
  context.fillStyle = "#a8a0b8";
  context.font = "700 9px system-ui, sans-serif";
  context.fillText("COMPOSITE COVERAGE", dimensions.centerX, dimensions.centerY + 16);
}

function canvasCellFromEvent(event) {
  const rect = dom.canvas.getBoundingClientRect();
  const dimensions = canvasDimensions();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const dx = x - dimensions.centerX;
  const dy = y - dimensions.centerY;
  const distance = Math.hypot(dx, dy);
  let bestVoice = 0;
  let bestDistance = Infinity;
  for (let voice = 0; voice < state.voiceCount; voice += 1) {
    const delta = Math.abs(distance - ringRadius(voice, dimensions));
    if (delta < bestDistance) {
      bestDistance = delta;
      bestVoice = voice;
    }
  }
  if (bestDistance > 30) return null;
  const angle = mod(Math.atan2(dy, dx) + Math.PI / 2, Math.PI * 2);
  const step = mod(Math.round((angle / (Math.PI * 2)) * state.length), state.length);
  return { voice: bestVoice, step };
}

function handleCanvasEdit(event) {
  const cell = canvasCellFromEvent(event);
  if (!cell) return;
  const key = `${cell.voice}:${cell.step}:${editTool}`;
  selected = cell;
  if (key === pointerDragKey) {
    drawDirty = true;
    return;
  }
  pointerDragKey = key;
  applyEdit(cell.voice, cell.step);
}

function frame(nowMs) {
  if (destroyed) return;
  updateTransport(nowMs);
  paintPlayhead(currentStep());
  if (transport.playing || drawDirty) {
    drawCanvas();
    drawDirty = false;
  }
  animationFrame = requestAnimationFrame(frame);
}

function clearPattern() {
  commit(
    markVariation({
      ...state,
      patterns: Array.from({ length: state.voiceCount }, () => Array(state.length).fill(0)),
    }),
    "All voice lanes cleared."
  );
}

function loadPreset(presetId, message = "") {
  const level = state.level;
  state = createHocketState(presetId);
  state.level = level;
  commit(state, message || `${presetForHocket(presetId).name} loaded.`);
}

dom.audioButton.addEventListener("click", toggleAudio);
dom.playButton.addEventListener("click", () => setTransport(!transport.playing));

dom.presetSelect.addEventListener("change", () => loadPreset(dom.presetSelect.value));

dom.voiceGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".hocket-step");
  if (!button) return;
  applyEdit(Number(button.dataset.voice), Number(button.dataset.step));
});

dom.pulseTool.addEventListener("click", () => {
  editTool = "pulse";
  renderControls();
  setLiveStatus("Pulse tool selected.");
});

dom.restTool.addEventListener("click", () => {
  editTool = "rest";
  renderControls();
  setLiveStatus("Rest tool selected.");
});

dom.preserveComposite.addEventListener("change", () => {
  commit(
    markVariation({ ...state, preserveComposite: dom.preserveComposite.checked }),
    dom.preserveComposite.checked
      ? "Preserve composite on: edits move existing pulse ownership."
      : "Free weave on: edits can create gaps and collisions.",
    { resync: false }
  );
});

dom.voiceCount.addEventListener("change", () => {
  commit(
    markVariation({ ...state, voiceCount: Number(dom.voiceCount.value) }),
    `${dom.voiceCount.value}-voice loom ready.`
  );
});

dom.cycleLength.addEventListener("change", () => {
  commit(
    resizeHocketPattern(state, Number(dom.cycleLength.value)),
    `Cycle resized to ${dom.cycleLength.value} pulses.`
  );
});

dom.shiftBack.addEventListener("click", () => {
  const voice = Number(dom.shiftVoice.value);
  commit(rotateHocketPattern(state, voice, -1), `${state.names[voice]} shifted one pulse earlier.`);
});

dom.shiftForward.addEventListener("click", () => {
  const voice = Number(dom.shiftVoice.value);
  commit(rotateHocketPattern(state, voice, 1), `${state.names[voice]} shifted one pulse later.`);
});

dom.phaseControls.addEventListener("input", (event) => {
  const input = event.target.closest("[data-phase-voice]");
  if (!input) return;
  const output = input.closest("label")?.querySelector("output");
  if (output) output.value = `+${input.value}`;
});

dom.phaseControls.addEventListener("change", (event) => {
  const input = event.target.closest("[data-phase-voice]");
  if (!input) return;
  const voice = Number(input.dataset.phaseVoice);
  const phases = [...state.phases];
  phases[voice] = Number(input.value);
  commit(markVariation({ ...state, phases }), `${state.names[voice]} phase: +${input.value}.`);
});

dom.tightenButton.addEventListener("click", () => {
  const before = analyzeHocketState(state);
  const next = tightenHocketPattern(state);
  const after = analyzeHocketState(next);
  commit(
    next,
    before.gaps === after.gaps
      ? "No collision could be moved into a gap."
      : `Moved ${before.gaps - after.gaps} collision ${before.gaps - after.gaps === 1 ? "pulse" : "pulses"} into gaps.`
  );
});

dom.clearButton.addEventListener("click", clearPattern);

for (const [element, key, format] of [
  [dom.tempoBpm, "tempoBpm", (value) => `${Math.round(value)} BPM`],
  [dom.swing, "swing", (value) => `${Math.round(value * 100)}% swing`],
  [dom.pulseLength, "pulseLengthMs", (value) => `${Math.round(value)} ms`],
  [dom.level, "level", (value) => `${Math.round(value * 100)}% output`],
]) {
  element.addEventListener("input", () => {
    const value = Number(element.value);
    commit(markVariation({ ...state, [key]: value }), format(value), {
      resync: key !== "level" && key !== "pulseLengthMs",
    });
    audio.update(state);
  });
}

dom.soundSet.addEventListener("change", () => {
  commit(
    markVariation({ ...state, soundSet: dom.soundSet.value }),
    `${dom.soundSet.selectedOptions[0].text} markers selected.`
  );
});

dom.focusMode.addEventListener("change", () => {
  commit(
    markVariation({ ...state, focusMode: dom.focusMode.value }),
    `${dom.focusMode.selectedOptions[0].text} listening focus selected.`
  );
});

dom.voicePads.addEventListener("click", (event) => {
  const button = event.target.closest("[data-audition-voice]");
  if (!button) return;
  const voice = Number(button.dataset.auditionVoice);
  const firstTone = state.patterns[voice].find((tone) => tone > 0) || voice + 1;
  const heard = auditionVoice(voice, firstTone, 0.22);
  setLiveStatus(heard ? `${state.names[voice]} auditioned.` : "Audio is off; the voice pad stayed silent.");
});

dom.resetButton.addEventListener("click", () => {
  loadPreset(state.presetId, `${presetForHocket(state.presetId).name} reset.`);
});

dom.canvas.addEventListener("pointerdown", (event) => {
  const cell = canvasCellFromEvent(event);
  if (!cell) return;
  event.preventDefault();
  dom.canvas.setPointerCapture?.(event.pointerId);
  pointerDragKey = "";
  handleCanvasEdit(event);
});

dom.canvas.addEventListener("pointermove", (event) => {
  if (!dom.canvas.hasPointerCapture?.(event.pointerId)) return;
  event.preventDefault();
  handleCanvasEdit(event);
});

for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  dom.canvas.addEventListener(eventName, (event) => {
    pointerDragKey = "";
    if (eventName === "pointerup" && dom.canvas.hasPointerCapture?.(event.pointerId)) {
      dom.canvas.releasePointerCapture?.(event.pointerId);
    }
  });
}

dom.canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    selected.step = mod(selected.step + (event.key === "ArrowRight" ? 1 : -1), state.length);
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    selected.voice = mod(
      selected.voice + (event.key === "ArrowDown" ? 1 : -1),
      state.voiceCount
    );
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    applyEdit(selected.voice, selected.step);
    return;
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    applyEdit(selected.voice, selected.step, "rest");
    return;
  } else {
    return;
  }
  drawDirty = true;
  setLiveStatus(`${state.names[selected.voice]}, pulse ${selected.step + 1} selected.`);
});


globalThis.__HOCKET_LOOM__ = Object.freeze({
  suspendAudio: () => audio.context?.suspend(),
  resumeAudio: () => audio.context?.resume(),
  getDebugState: () => Object.freeze({
    audioArmed: audio.armed,
    audioClosing: audio.closing,
    audioContextState: audio.context?.state ?? "closed",
    audioCurrentTime: audio.context?.currentTime ?? 0,
    activeGroups: audio.groups.size,
    activeSourceCount: audio.activeSourceCount,
    masterGain: audio.master?.gain?.value ?? 0,
    groupStarts: [...audio.groups].map((group) => group.startTime),
    groupVoices: [...audio.groups].map((group) => group.voice),
    groupEnvelopeGains: [...audio.groups].map((group) => group.safetyGain?.gain?.value ?? null),
    groupSourceCount: [...audio.groups].map((group) => group.sources.length),
    transportPlaying: transport.playing,
    transportPosition: transport.position,
    scheduleCursor: transport.scheduleCursor,
    scheduledSteps: [...audio.scheduledSteps],
    strikeHistory: audio.strikeHistory.map((strike) => ({
      ...strike,
      sourceKinds: [...strike.sourceKinds],
    })),
  }),
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    updateTransport();
    audio.panic();
    return;
  }
  transport.lastPerformanceMs = performance.now();
  if (transport.playing && audio.armed) resyncScheduler();
  drawDirty = true;
});

function teardown() {
  if (destroyed) return;
  destroyed = true;
  clearInterval(schedulerTimer);
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  audio.close();
}

window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    updateTransport();
    audio.panic();
    return;
  }
  teardown();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  transport.lastPerformanceMs = performance.now();
  if (transport.playing && audio.armed) resyncScheduler();
  drawDirty = true;
});

populatePresetOptions();
renderState();
renderTransport();
resizeCanvas();
resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(dom.canvasWrap);
schedulerTimer = window.setInterval(schedulerTick, 24);
animationFrame = requestAnimationFrame(frame);
