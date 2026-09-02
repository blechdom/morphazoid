import { connectAudioOutput } from "./src/audio-output-manager.js";
import {
  AUDIO_TIMING,
  DEFAULT_TEST_SIGNAL,
  TEST_SIGNALS,
  TEST_TRIM_RANGE,
  channelSummary,
  clamp,
  clampPosition,
  computeSpeakerGains,
  createLfePinkNoiseSamples,
  createPinkNoiseSamples,
  dbfsToGain,
  makeLayouts,
  outputModeFor,
  planAudioEvents,
  projectPoint,
  speakerPan,
} from "./src/surround-field.js";
import {
  MAX_RECORDING_SECONDS,
  SurroundFieldRecorder,
  buildStemArchive,
} from "./src/surround-field-recorder.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const KEY_NOTES = Object.freeze({ KeyA: 48, KeyS: 50, KeyD: 51, KeyF: 55, KeyG: 58, KeyH: 60, KeyJ: 62, KeyK: 63 });
const PHRASE = Object.freeze([48, 55, 58, 63, 60, 58, 51, 55]);

const DEFAULTS = Object.freeze({
  layoutId: "8-circle",
  customCount: 8,
  view: "plan",
  position: Object.freeze({ x: 0.18, y: -0.1, z: 0 }),
  focus: 0.58,
  motion: "manual",
  orbitRate: 0.12,
  voice: "halo",
  color: 0.62,
  release: 0.9,
  level: 0.55,
  forcePreview: false,
  testSignal: DEFAULT_TEST_SIGNAL,
  testTrimDb: TEST_TRIM_RANGE.defaultValue,
});

const state = {
  ...DEFAULTS,
  position: { ...DEFAULTS.position },
  audioOn: false,
  sequenceOn: false,
  transportStarting: false,
  phraseIndex: 0,
  nextPhraseAt: 0,
  sequenceTimers: new Set(),
  motionStartedAt: 0,
  motionPhase: 0,
  dragging: false,
  sweeping: false,
  sweepTimers: [],
  padEnergy: new Map(),
  testEnergy: [],
  gains: [],
  recording: false,
  recordingStarting: false,
  recordingFinishing: false,
  recordingStartedAt: 0,
  recordingStopTimer: 0,
  recordingClockTimer: 0,
  recordingElapsed: 0,
  recordingDownloadUrl: "",
  recordingFilename: "",
  lastRecording: null,
  recordingLayout: null,
  fileLoading: false,
};

class SurroundAudio {
  constructor() {
    this.context = null;
    this.voiceInput = null;
    this.patchInput = null;
    this.toneFilter = null;
    this.compressor = null;
    this.master = null;
    this.speakerRoutes = [];
    this.releaseOutput = null;
    this.outputNode = null;
    this.previewBus = null;
    this.previewLimiter = null;
    this.captureBus = null;
    this.recorder = null;
    this.loadedFileBuffer = null;
    this.loadedFileName = "";
    this.fileSource = null;
    this.pinkNoiseBuffer = null;
    this.lfePinkNoiseBuffer = null;
    this.onFileStateChange = null;
    this.enabled = false;
    this.startPromise = null;
    this.level = state.level;
    this.color = state.color;
    this.mode = "unprobed";
    this.deviceChannels = null;
    this.routeSignature = "";
    this.activeVoices = new Set();
    this.activeTests = new Set();
    this.activity = 0;
    this.suspendToken = 0;
  }

  buildBaseGraph() {
    const context = this.context;
    this.voiceInput = context.createGain();
    this.patchInput = context.createGain();
    this.toneFilter = context.createBiquadFilter();
    this.compressor = context.createDynamicsCompressor();
    this.master = context.createGain();

    this.voiceInput.gain.value = 0.82;
    this.voiceInput.channelCount = 1;
    this.voiceInput.channelCountMode = "explicit";
    this.voiceInput.channelInterpretation = "speakers";
    this.patchInput.gain.value = 1;
    this.patchInput.channelCount = 1;
    this.patchInput.channelCountMode = "explicit";
    this.patchInput.channelInterpretation = "speakers";
    this.toneFilter.type = "lowpass";
    this.toneFilter.Q.value = 1.1;
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.16;
    this.master.gain.value = 0.0001;

    this.voiceInput.connect(this.toneFilter).connect(this.compressor).connect(this.master);
    this.setColor(this.color);
  }

  start(layout, forcePreview) {
    if (this.startPromise) return this.startPromise;
    const startPromise = (async () => {
      if (!this.context || this.context.state === "closed") {
        const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
        this.context = new AudioContextClass({ latencyHint: "interactive" });
        this.deviceChannels = Math.max(1, Number(this.context.destination.maxChannelCount) || 2);
        this.buildBaseGraph();
      }
      this.suspendToken += 1;
      await this.context.resume();
      this.enabled = true;
      this.rebuildRoutes(layout, forcePreview);
      this.setLevel(this.level);
      return this.context;
    })();
    this.startPromise = startPromise;
    return startPromise.finally(() => {
      if (this.startPromise === startPromise) this.startPromise = null;
    });
  }

  disable() {
    this.enabled = false;
    this.stopFile();
    this.cancelScheduledTests(null, true);
    const token = ++this.suspendToken;
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0.0001, now, 0.018);
    window.setTimeout(() => {
      if (token !== this.suspendToken || this.enabled || this.context?.state !== "running") return;
      void this.context.suspend();
    }, 110);
  }

  teardownRoutes() {
    this.releaseOutput?.();
    this.releaseOutput = null;
    try { this.master?.disconnect(); } catch { /* The old route may already be detached. */ }
    try { this.patchInput?.disconnect(); } catch { /* The old patch route may already be detached. */ }
    for (const route of this.speakerRoutes) {
      for (const node of route.nodes) {
        try { node.disconnect(); } catch { /* Best-effort graph teardown. */ }
      }
    }
    try { this.captureBus?.disconnect(); } catch { /* The capture bus may already be detached. */ }
    try { this.outputNode?.disconnect(); } catch { /* Best-effort graph teardown. */ }
    try { this.previewBus?.disconnect(); } catch { /* Best-effort graph teardown. */ }
    try { this.previewLimiter?.disconnect(); } catch { /* Best-effort graph teardown. */ }
    this.speakerRoutes = [];
    this.captureBus = null;
    this.outputNode = null;
    this.previewBus = null;
    this.previewLimiter = null;
  }

  rebuildRoutes(layout, forcePreview) {
    if (!this.context || !this.master) return;
    this.deviceChannels = Math.max(
      1,
      Number(this.context.destination.maxChannelCount) || this.deviceChannels || 2,
    );
    const signature = `${layout.id}:${layout.speakers.length}:${forcePreview}:${this.deviceChannels}`;
    if (signature === this.routeSignature && this.speakerRoutes.length === layout.speakers.length) return;
    this.teardownRoutes();

    const context = this.context;
    let mode = outputModeFor(this.deviceChannels, layout.speakers.length, forcePreview);
    if (mode === "discrete") {
      try {
        context.destination.channelCount = layout.speakers.length;
        context.destination.channelInterpretation = "discrete";
      } catch {
        mode = "preview";
      }
    }

    const virtualBus = context.createChannelMerger(layout.speakers.length);
    virtualBus.channelInterpretation = "discrete";
    this.captureBus = virtualBus;
    let stereoBus = null;
    if (mode === "preview") {
      try {
        context.destination.channelCount = Math.min(2, this.deviceChannels);
        context.destination.channelInterpretation = "speakers";
      } catch {
        // Some destinations expose fixed channel configuration; stereo nodes still down-mix safely.
      }
      stereoBus = context.createGain();
      stereoBus.channelCount = 2;
      stereoBus.channelCountMode = "explicit";
      stereoBus.channelInterpretation = "speakers";
      stereoBus.gain.value = 0.92;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      stereoBus.connect(limiter);
      this.previewBus = stereoBus;
      this.previewLimiter = limiter;
    }

    layout.speakers.forEach((speaker) => {
      const targetIndex = Math.round(clamp(speaker.channel - 1, 0, layout.speakers.length - 1));
      const spatialGain = context.createGain();
      const channelBus = context.createGain();
      spatialGain.gain.value = 0;
      channelBus.gain.value = 1;
      channelBus.channelCount = 1;
      channelBus.channelCountMode = "explicit";
      channelBus.channelInterpretation = "speakers";
      const nodes = [spatialGain, channelBus];
      this.master.connect(spatialGain);
      this.patchInput.connect(spatialGain);

      if (speaker.kind === "lfe") {
        const lowpass = context.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 120;
        lowpass.Q.value = 0.7;
        spatialGain.connect(lowpass).connect(channelBus);
        nodes.push(lowpass);
      } else {
        spatialGain.connect(channelBus);
      }

      channelBus.connect(virtualBus, 0, targetIndex);
      if (stereoBus) {
        const panner = context.createStereoPanner();
        panner.pan.value = speaker.kind === "lfe" ? 0 : speakerPan(speaker);
        channelBus.connect(panner).connect(stereoBus);
        nodes.push(panner);
      }
      this.speakerRoutes.push({ spatialGain, channelBus, testTarget: channelBus, nodes, targetIndex });
    });

    this.outputNode = mode === "discrete" ? virtualBus : this.previewLimiter;
    this.releaseOutput = connectAudioOutput(context, this.outputNode);

    this.mode = mode;
    this.routeSignature = signature;
    this.setSpatialGains(state.gains);
  }

  setSpatialGains(gains, when = null) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const requestedTime = Number(when);
    const scheduled = Number.isFinite(requestedTime) && requestedTime > now;
    const targetTime = scheduled ? requestedTime : now;
    this.speakerRoutes.forEach(({ spatialGain }, index) => {
      const parameter = spatialGain.gain;
      if (!scheduled) {
        try {
          if (typeof parameter.cancelAndHoldAtTime === "function") parameter.cancelAndHoldAtTime(now);
          else {
            const heldValue = parameter.value;
            parameter.cancelScheduledValues(now);
            parameter.setValueAtTime(heldValue, now);
          }
        } catch {
          parameter.cancelScheduledValues(now);
        }
      }
      parameter.setTargetAtTime(clamp(gains[index] ?? 0, 0, 1), targetTime, 0.018);
    });
  }

  setLevel(value) {
    this.level = clamp(value, 0, 1);
    if (!this.context || !this.master || !this.enabled) return;
    this.master.gain.setTargetAtTime(Math.max(0.0001, this.level ** 1.35), this.context.currentTime, 0.025);
  }

  setColor(value) {
    this.color = clamp(value, 0, 1);
    if (!this.context || !this.toneFilter) return;
    this.toneFilter.frequency.setTargetAtTime(520 + this.color ** 1.4 * 10_500, this.context.currentTime, 0.03);
    this.toneFilter.Q.setTargetAtTime(0.7 + this.color * 3.4, this.context.currentTime, 0.03);
  }

  async loadFile(file) {
    if (!this.context || !file) throw new Error("Start audio before loading a patch source.");
    const encoded = await file.arrayBuffer();
    const decoded = await this.context.decodeAudioData(encoded);
    this.stopFile();
    this.loadedFileBuffer = decoded;
    this.loadedFileName = file.name || "loaded audio";
    return Object.freeze({ name: this.loadedFileName, duration: this.loadedFileBuffer.duration });
  }

  playFile() {
    if (!this.enabled || !this.context || !this.loadedFileBuffer || !this.patchInput) return false;
    this.stopFile();
    const source = this.context.createBufferSource();
    source.buffer = this.loadedFileBuffer;
    source.connect(this.patchInput);
    source.onended = () => {
      if (this.fileSource !== source) return;
      try { source.disconnect(); } catch { /* The file source may already be detached. */ }
      this.fileSource = null;
      this.onFileStateChange?.();
    };
    this.fileSource = source;
    source.start(this.context.currentTime + 0.006);
    this.onFileStateChange?.();
    return true;
  }

  stopFile() {
    const source = this.fileSource;
    if (!source) return;
    this.fileSource = null;
    source.onended = null;
    try { source.stop(); } catch { /* The file source may already have ended. */ }
    try { source.disconnect(); } catch { /* The file source may already be detached. */ }
    this.onFileStateChange?.();
  }

  async startRecording(channelCount) {
    if (!this.context || !this.captureBus) throw new Error("Start audio before recording channels.");
    if (!this.recorder || this.recorder.context !== this.context) {
      this.recorder = new SurroundFieldRecorder(this.context);
    }
    await this.recorder.start(this.captureBus, channelCount);
  }

  stopRecording() {
    return this.recorder?.stop() ?? Promise.resolve(null);
  }

  trigger(midi, voice = state.voice, release = state.release, velocity = 0.78, when = null, group = "manual") {
    if (!this.enabled || !this.context || !this.voiceInput || this.activeVoices.size >= 28) return false;
    const context = this.context;
    const requestedTime = Number(when);
    const start = Number.isFinite(requestedTime)
      ? Math.max(context.currentTime + 0.006, requestedTime)
      : context.currentTime + 0.006;
    const duration = clamp(release, 0.18, 2.4);
    const frequency = 440 * 2 ** ((Number(midi) - 69) / 12);
    const envelope = context.createGain();
    const voiceFilter = context.createBiquadFilter();
    const oscillators = [];
    const partials = voice === "glass"
      ? [[1, 0.76, "sine", 0], [2.01, 0.2, "sine", 4], [3.99, 0.08, "sine", -5]]
      : voice === "pulse"
      ? [[1, 0.72, "sawtooth", -5], [1.005, 0.34, "square", 5]]
      : [[1, 0.78, "triangle", -3], [0.501, 0.2, "sine", 3], [2.002, 0.12, "sine", 0]];

    voiceFilter.type = "lowpass";
    voiceFilter.frequency.setValueAtTime(700 + state.color * 7_800, start);
    voiceFilter.frequency.exponentialRampToValueAtTime(350 + state.color * 4_800, start + duration);
    voiceFilter.Q.value = voice === "pulse" ? 2.8 : 1.1;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, velocity * 0.22), start + (voice === "glass" ? 0.004 : 0.018));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    envelope.connect(voiceFilter).connect(this.voiceInput);

    for (const [ratio, amount, type, detune] of partials) {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency * ratio, start);
      oscillator.detune.setValueAtTime(detune, start);
      partialGain.gain.setValueAtTime(amount, start);
      oscillator.connect(partialGain).connect(envelope);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.04);
      oscillators.push({ oscillator, partialGain });
    }

    const record = { oscillators, envelope, voiceFilter, start, group };
    this.activeVoices.add(record);
    oscillators[0].oscillator.onended = () => {
      this.activeVoices.delete(record);
      try { envelope.disconnect(); } catch { /* Voice already collected. */ }
      try { voiceFilter.disconnect(); } catch { /* Voice already collected. */ }
      for (const item of oscillators) {
        try { item.oscillator.disconnect(); item.partialGain.disconnect(); } catch { /* Voice already collected. */ }
      }
    };
    return true;
  }

  cancelScheduledVoices(group) {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const record of this.activeVoices) {
      if (record.group !== group || record.start <= now + 0.002) continue;
      for (const { oscillator } of record.oscillators) {
        try { oscillator.stop(now); } catch { /* The queued source may already be ending. */ }
      }
    }
  }

  testSpeaker(index, when = null, group = "manual", signalId = state.testSignal, trimDb = state.testTrimDb) {
    if (!this.enabled || !this.context || !this.speakerRoutes[index]) return false;
    const context = this.context;
    const route = this.speakerRoutes[index];
    const speaker = currentLayout().speakers[index];
    const signal = TEST_SIGNALS[signalId] ?? TEST_SIGNALS[DEFAULT_TEST_SIGNAL];
    const requestedTime = Number(when);
    const start = Number.isFinite(requestedTime)
      ? Math.max(context.currentTime + 0.006, requestedTime)
      : context.currentTime + 0.006;
    const duration = signal.durationSeconds;
    const gain = context.createGain();
    let source;
    let targetGain;

    if (signal.id === "pink") {
      const lfe = speaker.kind === "lfe";
      const cachedBuffer = lfe ? this.lfePinkNoiseBuffer : this.pinkNoiseBuffer;
      if (!cachedBuffer || cachedBuffer.sampleRate !== context.sampleRate) {
        const frames = Math.ceil(context.sampleRate * (signal.durationSeconds + 0.05));
        const samples = lfe
          ? createLfePinkNoiseSamples(frames, context.sampleRate, signal.referenceDbfs)
          : createPinkNoiseSamples(frames, signal.referenceDbfs);
        const buffer = context.createBuffer(1, samples.length, context.sampleRate);
        buffer.copyToChannel(samples, 0);
        if (lfe) this.lfePinkNoiseBuffer = buffer;
        else this.pinkNoiseBuffer = buffer;
      }
      source = context.createBufferSource();
      source.buffer = lfe ? this.lfePinkNoiseBuffer : this.pinkNoiseBuffer;
      targetGain = dbfsToGain(clamp(trimDb, TEST_TRIM_RANGE.minimum, TEST_TRIM_RANGE.maximum));
    } else {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      if (signal.id === "tone") {
        oscillator.frequency.setValueAtTime(speaker.kind === "lfe" ? 80 : 1000, start);
      } else {
        oscillator.frequency.setValueAtTime(speaker.kind === "lfe" ? 42 : 360, start);
        oscillator.frequency.exponentialRampToValueAtTime(
          speaker.kind === "lfe" ? 105 : 1800,
          start + duration - 0.04,
        );
      }
      source = oscillator;
      targetGain = dbfsToGain(
        signal.referenceDbfs + clamp(trimDb, TEST_TRIM_RANGE.minimum, TEST_TRIM_RANGE.maximum),
      );
    }

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(targetGain, start + 0.012);
    gain.gain.setValueAtTime(targetGain, start + duration - 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(gain).connect(route.testTarget);
    source.start(start);
    source.stop(start + duration + 0.01);
    const record = { source, gain, start, group };
    this.activeTests.add(record);
    source.onended = () => {
      this.activeTests.delete(record);
      try { source.disconnect(); gain.disconnect(); } catch { /* Test signal already collected. */ }
    };
    return true;
  }

  cancelScheduledTests(group, includeActive = false) {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const record of this.activeTests) {
      if (group && record.group !== group) continue;
      const active = record.start <= now + 0.002;
      if (active && !includeActive) continue;
      if (active) {
        try {
          record.gain.gain.cancelScheduledValues(now);
          record.gain.gain.setTargetAtTime(0.0001, now, 0.004);
        } catch { /* The test envelope may already have ended. */ }
      }
      try { record.source.stop(active ? now + 0.02 : now); } catch { /* The test source may already be ending. */ }
    }
  }
}

const audio = new SurroundAudio();
let audioSchedulerTimer = 0;
let recordingFinalizePromise = null;

function layouts() {
  return makeLayouts(state.customCount);
}

function currentLayout() {
  return layouts()[state.layoutId] ?? layouts()[DEFAULTS.layoutId];
}

function performanceSeconds() {
  return performance.now() / 1000;
}

function motionCyclesAt(time = performanceSeconds()) {
  return state.motionPhase + Math.max(0, time - state.motionStartedAt) * state.orbitRate;
}

function reanchorMotionClock(time = performanceSeconds()) {
  if (state.motion !== "manual") state.motionPhase = motionCyclesAt(time) % 1;
  state.motionStartedAt = time;
}

function motionPositionAt(time) {
  const phase = motionCyclesAt(time) * TAU;
  const position = state.motion === "orbit"
    ? { x: Math.sin(phase) * 0.62, y: -Math.cos(phase) * 0.62, z: state.position.z }
    : { x: Math.sin(phase * 0.91) * 0.63, y: Math.sin(phase * 1.47 + 1.2) * 0.52, z: state.position.z };
  return clampPosition(position);
}

function scheduleAudioTimeline() {
  if (!audio.enabled || !audio.context || audio.context.state !== "running") return;
  const now = audio.context.currentTime;

  if (state.sequenceOn) {
    const plan = planAudioEvents({ nextAt: state.nextPhraseAt, now });
    state.phraseIndex += plan.skipped;
    for (const when of plan.times) {
      const midi = PHRASE[state.phraseIndex % PHRASE.length];
      state.phraseIndex += 1;
      if (audio.trigger(midi, state.voice, state.release, 0.78, when, "sequence")) {
        pulsePadVisualAt(midi, null, when, 0.78, "sequence");
      }
    }
    state.nextPhraseAt = plan.nextAt;
  }

  if (state.motion !== "manual") {
    const spatialAt = now + AUDIO_TIMING.lookaheadSeconds;
    const visualTime = performanceSeconds() + (spatialAt - now);
    const position = motionPositionAt(visualTime);
    const gains = computeSpeakerGains(currentLayout().speakers, position, state.focus);
    audio.setSpatialGains(gains, spatialAt);
  }
}

function stopAudioScheduler() {
  window.clearInterval(audioSchedulerTimer);
  audioSchedulerTimer = 0;
}

function syncAudioScheduler() {
  const shouldRun = state.audioOn && (state.sequenceOn || state.motion !== "manual");
  if (!shouldRun) {
    stopAudioScheduler();
    return;
  }
  if (!audioSchedulerTimer) {
    scheduleAudioTimeline();
    audioSchedulerTimer = window.setInterval(scheduleAudioTimeline, AUDIO_TIMING.schedulerIntervalMs);
  }
}

function setPressed(selector, attribute, value) {
  for (const button of document.querySelectorAll(selector)) {
    button.setAttribute("aria-pressed", String(button.dataset[attribute] === value));
  }
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value);
}

function pointToSvg(point) {
  return { x: point.x * 10, y: point.y * 7.6 };
}

function renderRoomGeometry() {
  const geometry = $("roomGeometry");
  if (state.view === "plan") {
    geometry.innerHTML = `
      <ellipse cx="500" cy="380" rx="386" ry="293" fill="none" stroke="rgba(215,255,82,.18)" stroke-width="1.2" />
      <ellipse cx="500" cy="380" rx="285" ry="216" fill="none" stroke="rgba(215,255,82,.09)" stroke-width="1" stroke-dasharray="4 8" />
      <ellipse cx="500" cy="380" rx="174" ry="132" fill="none" stroke="rgba(215,255,82,.07)" stroke-width="1" />
      <line x1="500" y1="67" x2="500" y2="693" stroke="rgba(215,255,82,.08)" />
      <line x1="92" y1="380" x2="908" y2="380" stroke="rgba(215,255,82,.08)" />
      <path d="M500 67l-7 13h14z" fill="rgba(215,255,82,.38)" />
      <text x="515" y="82" fill="rgba(215,255,82,.28)" font-size="8" letter-spacing="2">0°</text>
      <text x="876" y="366" fill="rgba(215,255,82,.2)" font-size="8" letter-spacing="2">90°</text>
      <text x="104" y="366" fill="rgba(215,255,82,.2)" font-size="8" letter-spacing="2">270°</text>
    `;
    return;
  }

  const corners = [
    { x: -0.92, y: -0.92, z: 0 }, { x: 0.92, y: -0.92, z: 0 },
    { x: 0.92, y: 0.92, z: 0 }, { x: -0.92, y: 0.92, z: 0 },
    { x: -0.92, y: -0.92, z: 1 }, { x: 0.92, y: -0.92, z: 1 },
    { x: 0.92, y: 0.92, z: 1 }, { x: -0.92, y: 0.92, z: 1 },
  ].map((point) => pointToSvg(projectPoint(point, "space")));
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  geometry.innerHTML = edges.map(([from, to], index) =>
    `<line x1="${corners[from].x}" y1="${corners[from].y}" x2="${corners[to].x}" y2="${corners[to].y}" stroke="${index >= 4 && index <= 7 ? "rgba(84,230,208,.18)" : "rgba(215,255,82,.13)"}" stroke-width="1.1" ${index >= 4 && index <= 7 ? 'stroke-dasharray="5 7"' : ""}/>`
  ).join("") + `
    <line x1="500" y1="175" x2="500" y2="608" stroke="rgba(255,112,76,.11)" stroke-dasharray="3 8" />
    <text x="510" y="186" fill="rgba(84,230,208,.3)" font-size="8" letter-spacing="2">UPPER PLANE</text>
    <text x="510" y="595" fill="rgba(215,255,82,.25)" font-size="8" letter-spacing="2">LOWER PLANE</text>
  `;
}

function renderRays(layout = currentLayout()) {
  const source = pointToSvg(projectPoint(state.position, state.view));
  $("signalRays").innerHTML = layout.speakers.map((speaker, index) => {
    const target = pointToSvg(projectPoint(speaker, state.view));
    const gain = state.gains[index] ?? 0;
    const color = speaker.kind === "height" ? "84,230,208" : speaker.kind === "lfe" ? "255,112,76" : "215,255,82";
    return `<line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" stroke="rgba(${color},${0.025 + gain * 0.68})" stroke-width="${0.5 + gain * 2.4}" stroke-dasharray="${speaker.kind === "height" ? "4 7" : "none"}" />`;
  }).join("");
}

function renderSpeakerLayer() {
  const layout = currentLayout();
  const layer = $("speakerLayer");
  layer.replaceChildren();
  layout.speakers.forEach((speaker, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "speaker-node";
    button.dataset.index = String(index);
    button.dataset.kind = speaker.kind;
    button.setAttribute("aria-label", `Test channel ${speaker.channel}, ${speaker.label}${speaker.kind === "height" ? ", height speaker" : speaker.kind === "lfe" ? ", low-frequency speaker" : ""}`);
    button.title = `Test CH ${speaker.channel} · ${speaker.label}`;
    button.innerHTML = `<span class="speaker-channel">${speaker.channel}</span><span class="speaker-label">${speaker.label}</span>`;
    button.addEventListener("click", () => void testSpeaker(index));
    layer.append(button);
  });
  renderMeters();
  updateSpatialDisplay();
}

function renderMeters() {
  const meters = $("channelMeters");
  meters.replaceChildren();
  currentLayout().speakers.forEach((speaker, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "channel-meter";
    row.dataset.index = String(index);
    row.dataset.kind = speaker.kind;
    row.setAttribute("aria-label", `Test channel ${speaker.channel}, ${speaker.label}`);
    row.title = `Test CH ${speaker.channel} · ${speaker.label}`;
    row.innerHTML = `<b>CH ${String(speaker.channel).padStart(2, "0")}</b><span>${speaker.label}</span><i></i>`;
    row.addEventListener("click", () => void testSpeaker(index));
    meters.append(row);
  });
}

function updateSpatialDisplay({ updateAudio = true } = {}) {
  const layout = currentLayout();
  state.position = { ...clampPosition(state.position) };
  state.gains = computeSpeakerGains(layout.speakers, state.position, state.focus);
  if (updateAudio) audio.setSpatialGains(state.gains);

  const emitterPoint = projectPoint(state.position, state.view);
  const listenerPoint = projectPoint({ x: 0, y: 0, z: 0 }, state.view);
  $("emitter").style.left = `${emitterPoint.x}%`;
  $("emitter").style.top = `${emitterPoint.y}%`;
  $("listener").style.left = `${listenerPoint.x}%`;
  $("listener").style.top = `${listenerPoint.y}%`;

  const speakerNodes = document.querySelectorAll(".speaker-node");
  layout.speakers.forEach((speaker, index) => {
    const point = projectPoint(speaker, state.view);
    const node = speakerNodes[index];
    if (!node) return;
    node.style.left = `${point.x}%`;
    node.style.top = `${point.y}%`;
    node.style.setProperty("--gain", String(state.gains[index] ?? 0));
    node.style.setProperty("--speaker-rotation", `${speaker.azimuth ?? 0}deg`);
  });
  renderRays(layout);

  let angle = Math.round((Math.atan2(state.position.x, -state.position.y) * 180) / Math.PI);
  if (angle < 0) angle += 360;
  const radius = Math.round(clamp(Math.hypot(state.position.x, state.position.y) / 0.86, 0, 1) * 100);
  setText("telemetryPosition", `${String(angle).padStart(3, "0")}° · ${String(radius).padStart(2, "0")}%`);
  setText("telemetryHeight", `${Math.round(state.position.z * 100)}%`);
}

function renderOutputStatus() {
  const layout = currentLayout();
  const summary = channelSummary(audio.deviceChannels, layout.speakers.length, state.forcePreview);
  const actualMode = audio.context ? audio.mode : summary.mode;
  const label = actualMode === "discrete" ? "Physical discrete" : actualMode === "preview" ? "Stereo preview" : summary.label;
  const detail = audio.context
    ? actualMode === "discrete"
      ? `${layout.speakers.length} numbered channels are connected directly. Verify the interface mapping by ear.`
      : `${layout.speakers.length} virtual speakers are equal-power folded into ${audio.deviceChannels} device channels.`
    : summary.detail;
  const deviceText = audio.deviceChannels ? String(audio.deviceChannels) : "?";

  $("outputConsole").dataset.mode = actualMode;
  $("stageCapability").dataset.mode = actualMode;
  setText("outputModeLabel", label.toUpperCase());
  setText("stageMode", label.toUpperCase());
  setText("deviceChannels", `${deviceText} CH`);
  setText("hardwareChannels", deviceText);
  setText("patchChannels", layout.speakers.length);
  setText("outputDetail", detail);
  setText("calibrationSummary", `${layout.speakers.length} virtual · ${audio.deviceChannels ? `${audio.deviceChannels} device` : "unprobed"}`);
  setText("audioState", state.audioOn ? `${actualMode} · ${audio.deviceChannels} ch` : audio.deviceChannels ? "off" : "off · probe device");
  setText("sequenceState", state.sequenceOn ? `${state.motion} · playing` : state.audioOn ? "ready · audio on" : "ready · audio off");
  const reportedLatency = audio.context
    ? (Number(audio.context.baseLatency) || 0) + (Number(audio.context.outputLatency) || 0)
    : 0;
  const clockState = state.transportStarting
    ? "STARTING AUDIO"
    : state.sequenceOn
      ? "AUDIO CLOCK · PLAYING"
      : state.audioOn
        ? "AUDIO CLOCK · READY"
        : "AUDIO CLOCK · ARMED";
  setText("timingClock", clockState);
  setText(
    "timingDetail",
    `${AUDIO_TIMING.schedulerIntervalMs} ms scheduler · ${Math.round(AUDIO_TIMING.lookaheadSeconds * 1000)} ms lookahead${reportedLatency > 0 ? ` · ${Math.round(reportedLatency * 1000)} ms reported path` : ""}`,
  );
  if ($("panelTransport")) $("panelTransport").dataset.state = state.sequenceOn ? "playing" : state.audioOn ? "ready" : "off";
}

function renderControls() {
  const layout = currentLayout();
  const signal = TEST_SIGNALS[state.testSignal] ?? TEST_SIGNALS[DEFAULT_TEST_SIGNAL];
  const recordingBusy = state.recording || state.recordingStarting || state.recordingFinishing;
  setPressed("[data-layout]", "layout", state.layoutId);
  setPressed("[data-view]", "view", state.view);
  setPressed("[data-motion]", "motion", state.motion);
  setPressed("[data-voice]", "voice", state.voice);
  setPressed("[data-route]", "route", state.forcePreview ? "preview" : "auto");
  setPressed("[data-test-signal]", "testSignal", state.testSignal);
  $("audioButton").disabled = state.recordingStarting || state.recordingFinishing;
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("sequenceButton").setAttribute("aria-pressed", String(state.sequenceOn));
  $("sequenceButton").disabled = state.transportStarting;
  setText("sequenceIcon", state.sequenceOn ? "■" : "▶");
  setText("speakerCountOut", `${state.customCount} speakers`);
  setText("arraySummary", `${layout.name} · ${layout.speakers.length} channels`);
  setText("motionSummary", `${state.motion} · ${state.position.z > 0.66 ? "upper" : state.position.z > 0.12 ? "raised" : "floor"}`);
  setText("voiceSummary", `${state.voice} · ${Math.round(state.release * 1000)} ms`);
  setText("telemetryPatch", layout.name.toUpperCase());
  setText("telemetryChannels", `${String(layout.speakers.length).padStart(2, "0")} VIRTUAL`);
  setText("orbitRateOut", `${state.orbitRate.toFixed(2)} rev/s`);
  setText("focusOut", `${Math.round(state.focus * 100)}%`);
  setText("elevationOut", `${Math.round(state.position.z * 100)}% · ${state.position.z > 0.66 ? "upper" : state.position.z > 0.12 ? "raised" : "floor"}`);
  setText("colorOut", `${Math.round(state.color * 100)}%`);
  setText("releaseOut", `${Math.round(state.release * 1000)} ms`);
  setText("levelOut", `${Math.round(state.level * 100)}%`);
  setText("testSignalSummary", `${signal.label} · ${signal.referenceDbfs} dBFS ${signal.referenceUnit.toLowerCase()}`);
  setText("testTrimOut", `${state.testTrimDb > 0 ? "+" : ""}${state.testTrimDb} dB`);
  setText("sweepSignal", `${signal.label} · ${signal.referenceDbfs + state.testTrimDb} dBFS ${signal.referenceUnit.toLowerCase()}`);

  $("recordButton").setAttribute("aria-pressed", String(state.recording));
  $("recordButton").disabled = state.recordingStarting || state.recordingFinishing;
  setText("recordIcon", state.recording ? "■" : state.recordingFinishing ? "…" : "●");
  setText("recordLabel", state.recording ? "Stop + prepare stems" : state.recordingFinishing ? "Preparing stems" : "Record channels");
  $("downloadRecording").disabled = !state.recordingDownloadUrl || recordingBusy;
  $("patchFile").disabled = state.fileLoading || recordingBusy;
  $("filePlayButton").disabled = state.fileLoading || !audio.loadedFileBuffer || !state.audioOn;
  $("filePlayButton").setAttribute("aria-pressed", String(Boolean(audio.fileSource)));
  setText("filePlayLabel", audio.fileSource ? "Stop loaded audio" : "Play through field");
  setText(
    "fileSourceState",
    state.fileLoading
      ? "decoding…"
      : audio.loadedFileBuffer
        ? `${audio.loadedFileName} · ${audio.loadedFileBuffer.duration.toFixed(1)} s`
        : "no file loaded",
  );
  setText(
    "recordStatus",
    state.recordingStarting
      ? "starting the synchronized channel tap…"
      : state.recording
        ? `${state.recordingElapsed.toFixed(1)} / ${MAX_RECORDING_SECONDS.toFixed(1)} s · ${layout.speakers.length} channels`
        : state.recordingFinishing
          ? "preparing synchronized mono WAV stems…"
          : state.lastRecording
            ? `${state.lastRecording.channelCount} stems · ${state.lastRecording.duration.toFixed(2)} s · ready`
            : `ready · ${MAX_RECORDING_SECONDS} s maximum`,
  );
  for (const control of document.querySelectorAll("[data-layout], [data-route]")) control.disabled = recordingBusy;
  $("speakerCount").disabled = recordingBusy;
  $("resetAll").disabled = state.recordingStarting || state.recordingFinishing;
  renderOutputStatus();
}

function setLayout(layoutId) {
  if (state.recording || state.recordingStarting || state.recordingFinishing) {
    announce("Stop the channel recording before changing the speaker layout.");
    return;
  }
  stopSweep();
  state.layoutId = layoutId;
  const layout = currentLayout();
  state.view = layout.view;
  state.testEnergy = Array(layout.speakers.length).fill(0);
  state.gains = computeSpeakerGains(layout.speakers, state.position, state.focus);
  if (audio.context) audio.rebuildRoutes(layout, state.forcePreview);
  renderRoomGeometry();
  renderSpeakerLayer();
  renderControls();
  announce(`${layout.name}, ${layout.descriptor}, ${layout.speakers.length} channels.`);
}

function setView(view) {
  state.view = view;
  renderRoomGeometry();
  updateSpatialDisplay();
  renderControls();
}

function setMotion(motion) {
  const now = performanceSeconds();
  if (state.motion !== "manual") reanchorMotionClock(now);
  if (motion !== "manual" && state.motion === "manual") {
    let phase = Math.atan2(state.position.x, -state.position.y) / TAU;
    if (phase < 0) phase += 1;
    state.motionPhase = phase;
  }
  state.motion = motion;
  state.motionStartedAt = now;
  audio.setSpatialGains(state.gains);
  syncAudioScheduler();
  renderControls();
}

function positionFromPointer(event) {
  const rect = $("stageWrap").getBoundingClientRect();
  const screenX = ((event.clientX - rect.left) / rect.width) * 100;
  const screenY = ((event.clientY - rect.top) / rect.height) * 100;
  if (state.view === "space") {
    const y = (screenY - 62 + state.position.z * 29) / 10.5;
    const x = (screenX - 50 - y * 13.5) / 25.5;
    return clampPosition({ x, y, z: state.position.z });
  }
  return clampPosition({ x: (screenX - 50) / 42, y: (screenY - 50) / 42, z: state.position.z });
}

function beginEmitterDrag(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  state.dragging = true;
  setMotion("manual");
  $("emitter").classList.add("is-dragging");
  $("emitter").setPointerCapture?.(event.pointerId);
  state.position = { ...positionFromPointer(event) };
  updateSpatialDisplay();
  renderControls();
}

function moveEmitter(event) {
  if (!state.dragging) return;
  event.preventDefault();
  state.position = { ...positionFromPointer(event) };
  updateSpatialDisplay();
}

function endEmitterDrag(event) {
  if (!state.dragging) return;
  state.dragging = false;
  $("emitter").classList.remove("is-dragging");
  try { $("emitter").releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be released. */ }
  renderControls();
}

async function ensureAudio() {
  try {
    await audio.start(currentLayout(), state.forcePreview);
    state.audioOn = true;
    $("audioError").hidden = true;
    syncAudioScheduler();
    renderControls();
    return true;
  } catch (error) {
    state.audioOn = false;
    stopAudioScheduler();
    $("audioError").hidden = false;
    setText("audioError", error?.message ?? "Unable to start audio.");
    announce(error?.message ?? "Unable to start audio.");
    renderControls();
    return false;
  }
}

function clearRecordingTimers() {
  window.clearTimeout(state.recordingStopTimer);
  window.clearInterval(state.recordingClockTimer);
  state.recordingStopTimer = 0;
  state.recordingClockTimer = 0;
}

function revokeRecordingDownload() {
  if (state.recordingDownloadUrl) URL.revokeObjectURL(state.recordingDownloadUrl);
  state.recordingDownloadUrl = "";
  state.recordingFilename = "";
}

function updateRecordingClock() {
  if (!state.recording) return;
  state.recordingElapsed = Math.min(
    MAX_RECORDING_SECONDS,
    Math.max(0, performanceSeconds() - state.recordingStartedAt),
  );
  setText(
    "recordStatus",
    `${state.recordingElapsed.toFixed(1)} / ${MAX_RECORDING_SECONDS.toFixed(1)} s · ${state.recordingLayout?.speakers.length ?? currentLayout().speakers.length} channels`,
  );
}

function handleRecordingError(error) {
  clearRecordingTimers();
  state.recording = false;
  state.recordingStarting = false;
  state.recordingFinishing = false;
  state.recordingLayout = null;
  const message = error?.message ?? "Unable to record the channel buses.";
  setText("audioError", message);
  $("audioError").hidden = false;
  announce(message);
  renderControls();
}

function finalizeChannelRecording(capture) {
  if (recordingFinalizePromise) return recordingFinalizePromise;
  recordingFinalizePromise = (async () => {
    clearRecordingTimers();
    state.recording = false;
    state.recordingStarting = false;
    state.recordingFinishing = true;
    renderControls();

    try {
      if (!capture || capture.frames <= 0) throw new Error("The channel recording did not contain any audio frames.");
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const layout = state.recordingLayout ?? currentLayout();
      const archive = buildStemArchive(capture, layout.speakers, layout.name, new Date());
      revokeRecordingDownload();
      const blob = new Blob([archive.bytes], { type: "application/zip" });
      state.recordingDownloadUrl = URL.createObjectURL(blob);
      state.recordingFilename = archive.filename;
      state.lastRecording = Object.freeze({
        channelCount: archive.channelCount,
        duration: archive.duration,
        clippedSamples: archive.clippedSamples,
        peaks: capture.peaks,
        reason: capture.reason,
      });
      announce(
        `${archive.channelCount} synchronized channel stems are ready to download${archive.clippedSamples ? `; ${archive.clippedSamples} samples exceeded full scale` : ""}.`,
      );
    } catch (error) {
      handleRecordingError(error);
    } finally {
      state.recordingLayout = null;
      state.recordingFinishing = false;
      recordingFinalizePromise = null;
      renderControls();
    }
  })();
  return recordingFinalizePromise;
}

async function startChannelRecording() {
  if (state.recording || state.recordingStarting || state.recordingFinishing) return;
  state.recordingStarting = true;
  state.recordingElapsed = 0;
  renderControls();
  try {
    if (!state.audioOn && !(await ensureAudio())) {
      state.recordingStarting = false;
      renderControls();
      return;
    }
    const layout = currentLayout();
    state.recordingLayout = Object.freeze({
      name: layout.name,
      speakers: Object.freeze([...layout.speakers]),
    });
    await audio.startRecording(state.recordingLayout.speakers.length);
    audio.recorder.onfinish = (capture) => void finalizeChannelRecording(capture);
    audio.recorder.onerror = handleRecordingError;
    revokeRecordingDownload();
    state.lastRecording = null;
    state.recordingStarting = false;
    state.recording = true;
    state.recordingStartedAt = performanceSeconds();
    state.recordingClockTimer = window.setInterval(updateRecordingClock, 100);
    state.recordingStopTimer = window.setTimeout(
      () => void stopChannelRecording("limit"),
      MAX_RECORDING_SECONDS * 1000 - 150,
    );
    renderControls();
    announce(`Recording ${state.recordingLayout.speakers.length} synchronized virtual output channels.`);
  } catch (error) {
    state.recordingLayout = null;
    handleRecordingError(error);
  }
}

async function stopChannelRecording(reason = "manual") {
  if (state.recordingFinishing) return recordingFinalizePromise;
  if (!state.recording && !state.recordingStarting && !audio.recorder?.active) return null;
  clearRecordingTimers();
  updateRecordingClock();
  state.recording = false;
  state.recordingStarting = false;
  state.recordingFinishing = true;
  renderControls();
  try {
    let capture = await audio.stopRecording();
    if (capture && reason === "limit" && capture.reason === "stopped") {
      capture = Object.freeze({ ...capture, reason: "limit" });
    }
    return await finalizeChannelRecording(capture);
  } catch (error) {
    handleRecordingError(error);
    return null;
  }
}

async function toggleChannelRecording() {
  if (state.recording) await stopChannelRecording();
  else await startChannelRecording();
}

function downloadChannelRecording() {
  if (!state.recordingDownloadUrl || !state.recordingFilename) return;
  const anchor = document.createElement("a");
  anchor.href = state.recordingDownloadUrl;
  anchor.download = state.recordingFilename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  announce(`Downloading ${state.recordingFilename}.`);
}

async function loadPatchFile(file) {
  if (!file || state.fileLoading) return;
  if (!state.audioOn && !(await ensureAudio())) return;
  state.fileLoading = true;
  renderControls();
  try {
    const loaded = await audio.loadFile(file);
    announce(`${loaded.name} loaded. Play it through the coral source, then move the source to route it.`);
  } catch (error) {
    const message = error?.message ?? "Unable to decode that audio file.";
    setText("audioError", message);
    $("audioError").hidden = false;
    announce(message);
  } finally {
    state.fileLoading = false;
    renderControls();
  }
}

async function togglePatchFilePlayback() {
  if (audio.fileSource) {
    audio.stopFile();
    announce("Loaded audio stopped.");
    return;
  }
  if (!state.audioOn && !(await ensureAudio())) return;
  if (audio.playFile()) announce("Loaded audio is playing through the movable sound source.");
}

async function disableAudio() {
  if (state.recordingStarting) {
    announce("Wait for channel recording to finish starting before turning audio off.");
    return;
  }
  if (state.recordingFinishing && recordingFinalizePromise) await recordingFinalizePromise;
  state.sequenceOn = false;
  clearSequenceVisuals();
  audio.cancelScheduledVoices("sequence");
  stopAudioScheduler();
  stopSweep();
  audio.stopFile();
  if (state.recording || audio.recorder?.active) await stopChannelRecording();
  state.audioOn = false;
  audio.disable();
  renderControls();
}

function clearSequenceVisuals() {
  for (const timer of state.sequenceTimers) window.clearTimeout(timer);
  state.sequenceTimers.clear();
}

function pulsePadVisualAt(midi, pad = null, when = null, velocity = 0.78, group = "manual") {
  const pulse = () => {
    const key = String(midi);
    state.padEnergy.set(key, 1);
    audio.activity = Math.max(audio.activity, velocity);
    const button = pad ?? document.querySelector(`[data-note="${midi}"]`);
    button?.classList.add("is-playing");
    window.setTimeout(() => button?.classList.remove("is-playing"), 120);
  };
  const delay = audio.context && Number.isFinite(Number(when))
    ? Math.max(0, (Number(when) - audio.context.currentTime) * 1000)
    : 0;
  if (delay > 1) {
    const timer = window.setTimeout(() => {
      state.sequenceTimers.delete(timer);
      pulse();
    }, delay);
    if (group === "sequence") state.sequenceTimers.add(timer);
  } else pulse();
}

async function triggerNote(midi, pad = null, velocity = 0.78) {
  if (!state.audioOn && !(await ensureAudio())) return;
  if (audio.trigger(midi, state.voice, state.release, clamp(velocity, 0.1, 1))) {
    pulsePadVisualAt(midi, pad, null, clamp(velocity, 0.1, 1));
  }
}

async function testSpeaker(index) {
  if (!state.audioOn && !(await ensureAudio())) return;
  if (!audio.testSpeaker(index)) return;
  state.testEnergy[index] = 1;
  audio.activity = Math.max(audio.activity, 0.62);
  const nodes = document.querySelectorAll(`[data-index="${index}"].speaker-node, [data-index="${index}"].channel-meter`);
  for (const node of nodes) node.classList.add("is-testing");
  const signal = TEST_SIGNALS[state.testSignal] ?? TEST_SIGNALS[DEFAULT_TEST_SIGNAL];
  window.setTimeout(() => {
    for (const node of nodes) node.classList.remove("is-testing");
  }, signal.durationSeconds * 1000 + 60);
  const speaker = currentLayout().speakers[index];
  announce(`Testing channel ${speaker.channel}, ${speaker.label}, with ${signal.label} at ${signal.referenceDbfs + state.testTrimDb} dBFS ${signal.referenceUnit.toLowerCase()}.`);
}

function stopSweep() {
  state.sweeping = false;
  for (const timer of state.sweepTimers) window.clearTimeout(timer);
  state.sweepTimers = [];
  audio.cancelScheduledTests("sweep", true);
  $("sweepButton")?.setAttribute("aria-pressed", "false");
}

function scheduleSweepVisual(index, when) {
  const delay = Math.max(0, (when - audio.context.currentTime) * 1000);
  const timer = window.setTimeout(() => {
    if (!state.sweeping) return;
    state.testEnergy[index] = 1;
    audio.activity = Math.max(audio.activity, 0.62);
    const nodes = document.querySelectorAll(`[data-index="${index}"].speaker-node, [data-index="${index}"].channel-meter`);
    for (const node of nodes) node.classList.add("is-testing");
    const signal = TEST_SIGNALS[state.testSignal] ?? TEST_SIGNALS[DEFAULT_TEST_SIGNAL];
    window.setTimeout(() => {
      for (const node of nodes) node.classList.remove("is-testing");
    }, signal.durationSeconds * 1000 + 60);
  }, delay);
  state.sweepTimers.push(timer);
}

async function toggleSweep() {
  if (state.sweeping) {
    stopSweep();
    announce("Channel sweep stopped.");
    return;
  }
  if (!state.audioOn && !(await ensureAudio())) return;
  state.sweeping = true;
  $("sweepButton").setAttribute("aria-pressed", "true");
  const signal = TEST_SIGNALS[state.testSignal] ?? TEST_SIGNALS[DEFAULT_TEST_SIGNAL];
  const start = audio.context.currentTime + AUDIO_TIMING.minimumLeadSeconds;
  currentLayout().speakers.forEach((_, index) => {
    const when = start + index * signal.sweepStepSeconds;
    audio.testSpeaker(index, when, "sweep", state.testSignal, state.testTrimDb);
    scheduleSweepVisual(index, when);
  });
  const duration = (currentLayout().speakers.length - 1) * signal.sweepStepSeconds + signal.durationSeconds + 0.06;
  const completionTimer = window.setTimeout(() => {
    if (!state.sweeping) return;
    stopSweep();
    announce("Channel sweep complete.");
  }, duration * 1000);
  state.sweepTimers.push(completionTimer);
}

async function toggleSequence() {
  if (state.transportStarting) return;
  if (state.sequenceOn) {
    state.sequenceOn = false;
    clearSequenceVisuals();
    audio.cancelScheduledVoices("sequence");
    syncAudioScheduler();
    renderControls();
    return;
  }
  state.transportStarting = true;
  renderControls();
  try {
    if (!state.audioOn && !(await ensureAudio())) return;
    if (state.motion === "manual") setMotion("orbit");
    state.sequenceOn = true;
    state.nextPhraseAt = audio.context.currentTime + AUDIO_TIMING.startLeadSeconds;
    scheduleAudioTimeline();
    syncAudioScheduler();
  } finally {
    state.transportStarting = false;
    renderControls();
  }
}

function announce(message) {
  setText("liveStatus", message);
}

async function resetAll() {
  if (state.recordingStarting) {
    announce("Wait for channel recording to finish starting before resetting.");
    return;
  }
  if (state.recordingFinishing && recordingFinalizePromise) await recordingFinalizePromise;
  if (state.recording || audio.recorder?.active) await stopChannelRecording();
  stopSweep();
  clearSequenceVisuals();
  audio.cancelScheduledVoices("sequence");
  stopAudioScheduler();
  state.layoutId = DEFAULTS.layoutId;
  state.customCount = DEFAULTS.customCount;
  state.view = DEFAULTS.view;
  state.position = { ...DEFAULTS.position };
  state.focus = DEFAULTS.focus;
  state.motion = DEFAULTS.motion;
  state.motionStartedAt = performanceSeconds();
  state.motionPhase = 0;
  state.orbitRate = DEFAULTS.orbitRate;
  state.voice = DEFAULTS.voice;
  state.color = DEFAULTS.color;
  state.release = DEFAULTS.release;
  state.level = DEFAULTS.level;
  state.forcePreview = DEFAULTS.forcePreview;
  state.testSignal = DEFAULTS.testSignal;
  state.testTrimDb = DEFAULTS.testTrimDb;
  state.sequenceOn = false;
  state.transportStarting = false;
  $("speakerCount").value = String(state.customCount);
  $("orbitRate").value = String(state.orbitRate);
  $("focus").value = String(state.focus);
  $("elevation").value = String(state.position.z);
  $("color").value = String(state.color);
  $("release").value = String(state.release);
  $("level").value = String(state.level);
  $("testTrim").value = String(state.testTrimDb);
  audio.stopFile();
  audio.setLevel(state.level);
  audio.setColor(state.color);
  setLayout(state.layoutId);
  announce("Surround Field reset.");
}

function bindControls() {
  $("audioButton").addEventListener("click", () => {
    if (state.audioOn) void disableAudio();
    else void ensureAudio();
  });
  $("sequenceButton").addEventListener("click", () => void toggleSequence());
  $("sweepButton").addEventListener("click", () => void toggleSweep());
  $("resetAll").addEventListener("click", () => void resetAll());
  $("centerSource").addEventListener("click", () => {
    setMotion("manual");
    state.position = { x: 0, y: 0, z: state.position.z };
    updateSpatialDisplay();
    renderControls();
  });

  for (const button of document.querySelectorAll("[data-layout]")) {
    button.addEventListener("click", () => setLayout(button.dataset.layout));
  }
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  for (const button of document.querySelectorAll("[data-motion]")) {
    button.addEventListener("click", () => setMotion(button.dataset.motion));
  }
  for (const button of document.querySelectorAll("[data-voice]")) {
    button.addEventListener("click", () => {
      state.voice = button.dataset.voice;
      renderControls();
      void triggerNote(55);
    });
  }
  for (const button of document.querySelectorAll("[data-route]")) {
    button.addEventListener("click", () => {
      state.forcePreview = button.dataset.route === "preview";
      if (audio.context) audio.rebuildRoutes(currentLayout(), state.forcePreview);
      renderControls();
    });
  }
  for (const button of document.querySelectorAll("[data-test-signal]")) {
    button.addEventListener("click", () => {
      stopSweep();
      state.testSignal = button.dataset.testSignal;
      renderControls();
      announce(`${TEST_SIGNALS[state.testSignal].label} selected for speaker tests.`);
    });
  }
  for (const button of document.querySelectorAll("[data-note]")) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      void triggerNote(Number(button.dataset.note), button);
    });
  }

  $("speakerCount").addEventListener("input", (event) => {
    state.customCount = Math.round(Number(event.target.value));
    setLayout("custom");
  });
  $("orbitRate").addEventListener("input", (event) => {
    reanchorMotionClock();
    state.orbitRate = Number(event.target.value);
    audio.setSpatialGains(state.gains);
    scheduleAudioTimeline();
    renderControls();
  });
  $("focus").addEventListener("input", (event) => {
    state.focus = Number(event.target.value);
    updateSpatialDisplay();
    renderControls();
  });
  $("elevation").addEventListener("input", (event) => {
    state.position.z = Number(event.target.value);
    updateSpatialDisplay();
    renderControls();
  });
  $("color").addEventListener("input", (event) => {
    state.color = Number(event.target.value);
    audio.setColor(state.color);
    renderControls();
  });
  $("release").addEventListener("input", (event) => {
    state.release = Number(event.target.value);
    renderControls();
  });
  $("level").addEventListener("input", (event) => {
    state.level = Number(event.target.value);
    audio.setLevel(state.level);
    renderControls();
  });
  $("testTrim").addEventListener("input", (event) => {
    state.testTrimDb = clamp(
      Number(event.target.value),
      TEST_TRIM_RANGE.minimum,
      TEST_TRIM_RANGE.maximum,
    );
    renderControls();
  });

  $("recordButton").addEventListener("click", () => void toggleChannelRecording());
  $("downloadRecording").addEventListener("click", downloadChannelRecording);
  $("patchFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) void loadPatchFile(file);
  });
  $("filePlayButton").addEventListener("click", () => void togglePatchFilePlayback());

  $("emitter").addEventListener("pointerdown", beginEmitterDrag);
  $("emitter").addEventListener("pointermove", moveEmitter);
  $("emitter").addEventListener("pointerup", endEmitterDrag);
  $("emitter").addEventListener("pointercancel", endEmitterDrag);
  $("emitter").addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.08 : 0.025;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    setMotion("manual");
    if (event.key === "ArrowLeft") state.position.x -= step;
    if (event.key === "ArrowRight") state.position.x += step;
    if (event.key === "ArrowUp") state.position.y -= step;
    if (event.key === "ArrowDown") state.position.y += step;
    updateSpatialDisplay();
    renderControls();
  });

  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    const midi = KEY_NOTES[event.code];
    if (midi) {
      event.preventDefault();
      void triggerNote(midi);
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      void toggleSequence();
    }
    if (event.code === "Escape" && state.audioOn) void disableAudio();
  });

  window.addEventListener("morphazoid:midi-input", (event) => {
    if (event.detail?.routeId !== "surround-field") return;
    const message = event.detail?.message;
    if (message?.type === "noteOn") {
      event.preventDefault();
      void triggerNote(message.note, null, (Number(message.velocity) || 100) / 127);
    } else if (message?.type === "noteOff") {
      // Voices are deliberately one-shot, but claim the exact page mapping so
      // the universal adapter does not start an unrelated fallback control.
      event.preventDefault();
    }
  });

  window.addEventListener("pagehide", () => {
    clearRecordingTimers();
    audio.recorder?.cancel();
    audio.stopFile();
    revokeRecordingDownload();
  });
}

function animate(timestamp) {
  if (animate.lastPaint !== undefined && timestamp - animate.lastPaint < 1000 / 30) {
    requestAnimationFrame(animate);
    return;
  }
  animate.lastPaint = timestamp;
  const now = timestamp / 1000;
  const delta = Math.min(0.05, Math.max(0, now - (animate.lastTime ?? now)));
  animate.lastTime = now;

  if (state.motion !== "manual" && !state.dragging) {
    state.position = { ...motionPositionAt(now) };
    updateSpatialDisplay({ updateAudio: false });
  }

  audio.activity *= Math.exp(-delta * 3.3);
  $("emitter").classList.toggle("is-sounding", audio.activity > 0.035);
  const speakerNodes = document.querySelectorAll(".speaker-node");
  const meterNodes = document.querySelectorAll(".channel-meter");
  state.gains.forEach((gain, index) => {
    state.testEnergy[index] = (state.testEnergy[index] ?? 0) * Math.exp(-delta * 5.2);
    const meter = clamp(gain * audio.activity * 1.4 + state.testEnergy[index], 0, 1);
    speakerNodes[index]?.style.setProperty("--gain", String(clamp(gain * 0.78 + state.testEnergy[index] * 0.7, 0, 1)));
    meterNodes[index]?.style.setProperty("--meter", String(meter));
  });
  for (const [midi, energy] of state.padEnergy) {
    const next = energy * Math.exp(-delta * 7);
    if (next < 0.01) state.padEnergy.delete(midi);
    else state.padEnergy.set(midi, next);
    document.querySelector(`[data-note="${midi}"]`)?.style.setProperty("--pad-energy", String(next));
  }

  requestAnimationFrame(animate);
}

function exposeDebugState() {
  window.__SURROUND_FIELD_DEBUG__ = Object.freeze({
    getState: () => Object.freeze({
      layoutId: state.layoutId,
      speakerCount: currentLayout().speakers.length,
      view: state.view,
      position: Object.freeze({ ...state.position }),
      outputMode: audio.mode,
      deviceChannels: audio.deviceChannels,
      audioOn: state.audioOn,
      sequenceOn: state.sequenceOn,
      audioSchedulerRunning: Boolean(audioSchedulerTimer),
      nextPhraseAt: state.nextPhraseAt,
      gainCount: state.gains.length,
      testSignal: state.testSignal,
      testTrimDb: state.testTrimDb,
      recording: state.recording,
      recordingFinishing: state.recordingFinishing,
      routeTargetIndices: Object.freeze(audio.speakerRoutes.map(({ targetIndex }) => targetIndex)),
      lastRecording: state.lastRecording,
    }),
    selectLayout: setLayout,
  });
}

function initialize() {
  state.motionStartedAt = performanceSeconds();
  state.testEnergy = Array(currentLayout().speakers.length).fill(0);
  state.gains = computeSpeakerGains(currentLayout().speakers, state.position, state.focus);
  audio.onFileStateChange = renderControls;
  bindControls();
  renderRoomGeometry();
  renderSpeakerLayer();
  renderControls();
  exposeDebugState();
  requestAnimationFrame(animate);
}

initialize();
