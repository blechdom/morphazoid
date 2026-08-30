import { connectAudioOutput } from "./src/audio-output-manager.js";
import {
  channelSummary,
  clamp,
  clampPosition,
  computeSpeakerGains,
  makeLayouts,
  outputModeFor,
  projectPoint,
  speakerPan,
} from "./src/surround-field.js";

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
  level: 0.28,
  forcePreview: false,
});

const state = {
  ...DEFAULTS,
  position: { ...DEFAULTS.position },
  audioOn: false,
  sequenceOn: false,
  phraseIndex: 0,
  nextPhraseAt: 0,
  motionTime: 0,
  dragging: false,
  sweeping: false,
  sweepTimer: 0,
  padEnergy: new Map(),
  testEnergy: [],
  gains: [],
};

class SurroundAudio {
  constructor() {
    this.context = null;
    this.voiceInput = null;
    this.toneFilter = null;
    this.compressor = null;
    this.master = null;
    this.speakerRoutes = [];
    this.releaseOutput = null;
    this.outputNode = null;
    this.enabled = false;
    this.starting = false;
    this.level = state.level;
    this.color = state.color;
    this.mode = "unprobed";
    this.deviceChannels = null;
    this.routeSignature = "";
    this.activeVoices = new Set();
    this.activity = 0;
    this.suspendToken = 0;
  }

  buildBaseGraph() {
    const context = this.context;
    this.voiceInput = context.createGain();
    this.toneFilter = context.createBiquadFilter();
    this.compressor = context.createDynamicsCompressor();
    this.master = context.createGain();

    this.voiceInput.gain.value = 0.82;
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

  async start(layout, forcePreview) {
    if (this.starting) return this.context;
    this.starting = true;
    try {
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
    } finally {
      this.starting = false;
    }
  }

  disable() {
    this.enabled = false;
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
    for (const route of this.speakerRoutes) {
      for (const node of route.nodes) {
        try { node.disconnect(); } catch { /* Best-effort graph teardown. */ }
      }
    }
    try { this.outputNode?.disconnect(); } catch { /* Best-effort graph teardown. */ }
    this.speakerRoutes = [];
    this.outputNode = null;
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

    if (mode === "discrete") {
      const merger = context.createChannelMerger(layout.speakers.length);
      merger.channelInterpretation = "discrete";
      this.outputNode = merger;
      layout.speakers.forEach((speaker, index) => {
        const spatialGain = context.createGain();
        spatialGain.gain.value = 0;
        const nodes = [spatialGain];
        this.master.connect(spatialGain);
        let routeEntry = spatialGain;
        if (speaker.kind === "lfe") {
          const lowpass = context.createBiquadFilter();
          lowpass.type = "lowpass";
          lowpass.frequency.value = 120;
          lowpass.Q.value = 0.7;
          spatialGain.connect(lowpass);
          routeEntry = lowpass;
          nodes.push(lowpass);
        }
        routeEntry.connect(merger, 0, index);
        this.speakerRoutes.push({ spatialGain, testTarget: routeEntry, nodes, targetIndex: index });
      });
      this.releaseOutput = connectAudioOutput(context, merger);
    } else {
      try {
        context.destination.channelCount = Math.min(2, this.deviceChannels);
        context.destination.channelInterpretation = "speakers";
      } catch {
        // Some destinations expose fixed channel configuration; stereo nodes still down-mix safely.
      }
      const stereoBus = context.createGain();
      stereoBus.channelCount = 2;
      stereoBus.channelCountMode = "explicit";
      stereoBus.channelInterpretation = "speakers";
      stereoBus.gain.value = 0.92;
      this.outputNode = stereoBus;
      layout.speakers.forEach((speaker) => {
        const spatialGain = context.createGain();
        const panner = context.createStereoPanner();
        spatialGain.gain.value = 0;
        panner.pan.value = speaker.kind === "lfe" ? 0 : speakerPan(speaker);
        const nodes = [spatialGain, panner];
        this.master.connect(spatialGain);
        let routeEntry = spatialGain;
        if (speaker.kind === "lfe") {
          const lowpass = context.createBiquadFilter();
          lowpass.type = "lowpass";
          lowpass.frequency.value = 120;
          lowpass.Q.value = 0.7;
          spatialGain.connect(lowpass);
          lowpass.connect(panner);
          routeEntry = lowpass;
          nodes.push(lowpass);
        } else {
          spatialGain.connect(panner);
        }
        panner.connect(stereoBus);
        this.speakerRoutes.push({
          spatialGain,
          testTarget: speaker.kind === "lfe" ? routeEntry : panner,
          nodes,
          targetIndex: 0,
        });
      });
      this.releaseOutput = connectAudioOutput(context, stereoBus);
    }

    this.mode = mode;
    this.routeSignature = signature;
    this.setSpatialGains(state.gains);
  }

  setSpatialGains(gains) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.speakerRoutes.forEach(({ spatialGain }, index) => {
      spatialGain.gain.setTargetAtTime(clamp(gains[index] ?? 0, 0, 1), now, 0.018);
    });
  }

  setLevel(value) {
    this.level = clamp(value, 0, 0.68);
    if (!this.context || !this.master || !this.enabled) return;
    this.master.gain.setTargetAtTime(Math.max(0.0001, this.level ** 1.35), this.context.currentTime, 0.025);
  }

  setColor(value) {
    this.color = clamp(value, 0, 1);
    if (!this.context || !this.toneFilter) return;
    this.toneFilter.frequency.setTargetAtTime(520 + this.color ** 1.4 * 10_500, this.context.currentTime, 0.03);
    this.toneFilter.Q.setTargetAtTime(0.7 + this.color * 3.4, this.context.currentTime, 0.03);
  }

  trigger(midi, voice = state.voice, release = state.release, velocity = 0.78) {
    if (!this.enabled || !this.context || !this.voiceInput || this.activeVoices.size >= 28) return false;
    const context = this.context;
    const start = context.currentTime + 0.004;
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
      oscillator.frequency.value = frequency * ratio;
      oscillator.detune.value = detune;
      partialGain.gain.value = amount;
      oscillator.connect(partialGain).connect(envelope);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.04);
      oscillators.push({ oscillator, partialGain });
    }

    const record = { oscillators, envelope, voiceFilter };
    this.activeVoices.add(record);
    oscillators[0].oscillator.onended = () => {
      this.activeVoices.delete(record);
      try { envelope.disconnect(); } catch { /* Voice already collected. */ }
      try { voiceFilter.disconnect(); } catch { /* Voice already collected. */ }
      for (const item of oscillators) {
        try { item.oscillator.disconnect(); item.partialGain.disconnect(); } catch { /* Voice already collected. */ }
      }
    };
    this.activity = Math.max(this.activity, velocity);
    return true;
  }

  testSpeaker(index) {
    if (!this.enabled || !this.context || !this.speakerRoutes[index]) return false;
    const context = this.context;
    const route = this.speakerRoutes[index];
    const speaker = currentLayout().speakers[index];
    const start = context.currentTime + 0.005;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = speaker.kind === "lfe" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(speaker.kind === "lfe" ? 72 : 430 + (index % 8) * 38, start);
    if (speaker.kind !== "lfe") oscillator.frequency.exponentialRampToValueAtTime(710 + (index % 8) * 42, start + 0.14);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.075, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    oscillator.connect(gain);
    if (this.mode === "discrete") gain.connect(this.outputNode, 0, index);
    else gain.connect(route.testTarget);
    oscillator.start(start);
    oscillator.stop(start + 0.3);
    oscillator.onended = () => {
      try { oscillator.disconnect(); gain.disconnect(); } catch { /* Test chirp already collected. */ }
    };
    this.activity = Math.max(this.activity, 0.62);
    return true;
  }
}

const audio = new SurroundAudio();

function layouts() {
  return makeLayouts(state.customCount);
}

function currentLayout() {
  return layouts()[state.layoutId] ?? layouts()[DEFAULTS.layoutId];
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
    const row = document.createElement("div");
    row.className = "channel-meter";
    row.dataset.index = String(index);
    row.dataset.kind = speaker.kind;
    row.innerHTML = `<b>CH ${String(speaker.channel).padStart(2, "0")}</b><span>${speaker.label}</span><i></i>`;
    meters.append(row);
  });
}

function updateSpatialDisplay() {
  const layout = currentLayout();
  state.position = { ...clampPosition(state.position) };
  state.gains = computeSpeakerGains(layout.speakers, state.position, state.focus);
  audio.setSpatialGains(state.gains);

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
}

function renderControls() {
  const layout = currentLayout();
  setPressed("[data-layout]", "layout", state.layoutId);
  setPressed("[data-view]", "view", state.view);
  setPressed("[data-motion]", "motion", state.motion);
  setPressed("[data-voice]", "voice", state.voice);
  setPressed("[data-route]", "route", state.forcePreview ? "preview" : "auto");
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("sequenceButton").setAttribute("aria-pressed", String(state.sequenceOn));
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
  renderOutputStatus();
}

function setLayout(layoutId) {
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
  state.motion = motion;
  if (motion !== "manual") state.motionTime = performance.now() / 1000;
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
  state.motion = "manual";
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
    renderControls();
    return true;
  } catch (error) {
    state.audioOn = false;
    $("audioError").hidden = false;
    setText("audioError", error?.message ?? "Unable to start audio.");
    announce(error?.message ?? "Unable to start audio.");
    renderControls();
    return false;
  }
}

function disableAudio() {
  state.audioOn = false;
  state.sequenceOn = false;
  stopSweep();
  audio.disable();
  renderControls();
}

async function triggerNote(midi, pad = null, velocity = 0.78) {
  if (!state.audioOn && !(await ensureAudio())) return;
  if (audio.trigger(midi, state.voice, state.release, clamp(velocity, 0.1, 1))) {
    const key = String(midi);
    state.padEnergy.set(key, 1);
    const button = pad ?? document.querySelector(`[data-note="${midi}"]`);
    button?.classList.add("is-playing");
    window.setTimeout(() => button?.classList.remove("is-playing"), 120);
  }
}

async function testSpeaker(index) {
  if (!state.audioOn && !(await ensureAudio())) return;
  if (!audio.testSpeaker(index)) return;
  state.testEnergy[index] = 1;
  const node = document.querySelector(`.speaker-node[data-index="${index}"]`);
  node?.classList.add("is-testing");
  window.setTimeout(() => node?.classList.remove("is-testing"), 310);
  const speaker = currentLayout().speakers[index];
  announce(`Testing channel ${speaker.channel}, ${speaker.label}.`);
}

function stopSweep() {
  state.sweeping = false;
  window.clearTimeout(state.sweepTimer);
  state.sweepTimer = 0;
  $("sweepButton")?.setAttribute("aria-pressed", "false");
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
  let index = 0;
  const step = () => {
    if (!state.sweeping) return;
    void testSpeaker(index);
    index += 1;
    if (index >= currentLayout().speakers.length) {
      state.sweepTimer = window.setTimeout(() => {
        stopSweep();
        announce("Channel sweep complete.");
      }, 440);
      return;
    }
    state.sweepTimer = window.setTimeout(step, 520);
  };
  step();
}

function toggleSequence() {
  state.sequenceOn = !state.sequenceOn;
  if (state.sequenceOn) {
    if (state.motion === "manual") setMotion("orbit");
    state.nextPhraseAt = performance.now();
    void ensureAudio();
  }
  renderControls();
}

function announce(message) {
  setText("liveStatus", message);
}

function resetAll() {
  stopSweep();
  state.layoutId = DEFAULTS.layoutId;
  state.customCount = DEFAULTS.customCount;
  state.view = DEFAULTS.view;
  state.position = { ...DEFAULTS.position };
  state.focus = DEFAULTS.focus;
  state.motion = DEFAULTS.motion;
  state.orbitRate = DEFAULTS.orbitRate;
  state.voice = DEFAULTS.voice;
  state.color = DEFAULTS.color;
  state.release = DEFAULTS.release;
  state.level = DEFAULTS.level;
  state.forcePreview = DEFAULTS.forcePreview;
  state.sequenceOn = false;
  $("speakerCount").value = String(state.customCount);
  $("orbitRate").value = String(state.orbitRate);
  $("focus").value = String(state.focus);
  $("elevation").value = String(state.position.z);
  $("color").value = String(state.color);
  $("release").value = String(state.release);
  $("level").value = String(state.level);
  audio.setLevel(state.level);
  audio.setColor(state.color);
  setLayout(state.layoutId);
  announce("Surround Field reset.");
}

function bindControls() {
  $("audioButton").addEventListener("click", () => {
    if (state.audioOn) disableAudio();
    else void ensureAudio();
  });
  $("sequenceButton").addEventListener("click", toggleSequence);
  $("sweepButton").addEventListener("click", () => void toggleSweep());
  $("resetAll").addEventListener("click", resetAll);
  $("centerSource").addEventListener("click", () => {
    state.motion = "manual";
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
    state.orbitRate = Number(event.target.value);
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

  $("emitter").addEventListener("pointerdown", beginEmitterDrag);
  $("emitter").addEventListener("pointermove", moveEmitter);
  $("emitter").addEventListener("pointerup", endEmitterDrag);
  $("emitter").addEventListener("pointercancel", endEmitterDrag);
  $("emitter").addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.08 : 0.025;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    state.motion = "manual";
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
      toggleSequence();
    }
    if (event.code === "Escape" && state.audioOn) disableAudio();
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
}

function animate(timestamp) {
  const now = timestamp / 1000;
  const delta = Math.min(0.05, Math.max(0, now - (animate.lastTime ?? now)));
  animate.lastTime = now;

  if (state.motion !== "manual" && !state.dragging) {
    state.motionTime += delta;
    const phase = state.motionTime * state.orbitRate * TAU;
    if (state.motion === "orbit") {
      state.position.x = Math.sin(phase) * 0.62;
      state.position.y = -Math.cos(phase) * 0.62;
    } else {
      state.position.x = Math.sin(phase * 0.91) * 0.63;
      state.position.y = Math.sin(phase * 1.47 + 1.2) * 0.52;
    }
    updateSpatialDisplay();
  }

  if (state.sequenceOn && timestamp >= state.nextPhraseAt) {
    const midi = PHRASE[state.phraseIndex % PHRASE.length];
    state.phraseIndex += 1;
    state.nextPhraseAt = timestamp + 310;
    void triggerNote(midi);
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
      gainCount: state.gains.length,
    }),
    selectLayout: setLayout,
  });
}

function initialize() {
  state.testEnergy = Array(currentLayout().speakers.length).fill(0);
  state.gains = computeSpeakerGains(currentLayout().speakers, state.position, state.focus);
  bindControls();
  renderRoomGeometry();
  renderSpeakerLayer();
  renderControls();
  exposeDebugState();
  requestAnimationFrame(animate);
}

initialize();
