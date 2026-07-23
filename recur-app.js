import {
  VoicePool,
  clamp,
  pitch01ToFrequency,
  synthParametersForMode,
} from "./src/audio.js";
import {
  RECUR_PROGRAMS,
  buildRecurTimeline,
  programById,
  stackDepthProfile,
} from "./src/recur.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const FUSION_RATE = 18; // steps/second above which discrete events fuse into a tone
const SLOWEST_STEP = 2; // seconds per step at the slow end of the time-scale
const FASTEST_STEP = 0.004; // seconds per step at the fast end
const pool = new VoicePool(32);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });

const state = {
  audio: false,
  playing: false,
  program: "factorial",
  n: 5,
  memoize: false,
  timeScale: 0.18,
  shepardToggle: true,
  synthMode: "shepard",
  returnVoicing: "resolve",
  feedback: 0.55,
  baseFrequency: 110,
  rangeOctaves: 3,
  panSpread: 0.7,
  level: 0.65,
};

let timeline = null;
let profile = [];
let maxDepth = 1;
let playhead = 0; // in event-index units
let eventCursor = 0;
const heldFrames = new Map();
let lastEventLabel = "ready";
let baseFlash = 0;

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let lastAudioTime = null;

// Custom audio nodes (built lazily once the context exists).
let fusedOsc = null;
let fusedGain = null;
let fusedBuilt = false;
let feedbackInput = null;
let feedbackGain = null;
let feedbackBuilt = false;

function announce(message) {
  $("liveStatus").textContent = message;
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(3_000_000 / (cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

function stepSeconds() {
  return SLOWEST_STEP * (FASTEST_STEP / SLOWEST_STEP) ** clamp(state.timeScale, 0, 1);
}

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  input.value = String(state[key]);
  const update = () => {
    if (output) output.textContent = formatter(state[key]);
  };
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    update();
    afterChange?.();
    scheduleFrame();
  });
  update();
}

function rebuild() {
  timeline = buildRecurTimeline(state.program, state.n, { stepSeconds: 1, memoize: state.memoize });
  maxDepth = Math.max(1, timeline.maxDepth);
  profile = stackDepthProfile(timeline);
  playhead = 0;
  eventCursor = 0;
  heldFrames.clear();
  lastEventLabel = "ready";
  if (state.audio) pool.setVoices([]);
}

function applyProgramMeta() {
  const spec = programById(state.program) ?? RECUR_PROGRAMS[0];
  const nInput = $("n");
  nInput.min = String(spec.nMin);
  nInput.max = String(spec.nMax);
  state.n = clamp(state.n, spec.nMin, spec.nMax);
  nInput.value = String(state.n);
  $("nOut").textContent = String(state.n);
  const memoize = $("memoize");
  memoize.hidden = !spec.supportsMemo;
  if (!spec.supportsMemo) state.memoize = false;
  setPressed(memoize, state.memoize);
  memoize.textContent = `Memoize · ${state.memoize ? "on" : "off"}`;
  $("programSummary").textContent = spec.id;
  $("programBlurb").textContent = spec.blurb;
  $("processLabel").textContent = `${spec.id}(${state.n})`;
}

function updateVoicingSummary() {
  const voice = state.shepardToggle ? "shepard" : state.synthMode;
  $("voicingSummary").textContent = `${voice} · ${state.returnVoicing === "feedback" ? "feedback" : "resolve"}`;
}

function panForFrame(frame) {
  const spec = programById(state.program);
  if (!spec || spec.kind === "linear") return 0;
  const direction = frame.branch === 1 ? 1 : frame.branch === 0 ? -1 : 0;
  if (frame.depth === 0) return 0;
  return clamp(direction * state.panSpread * Math.min(1, frame.depth / 2), -1, 1);
}

function shepardPositionForDepth(depth) {
  return ((depth / 6) % 1 + 1) % 1;
}

function heldVoices() {
  const voices = [];
  for (const frame of heldFrames.values()) {
    const pitch01 = 1 - frame.depth / maxDepth;
    const mode = state.shepardToggle
      ? "shepard"
      : state.synthMode === "shepard" ? "sine" : state.synthMode;
    const drive = clamp(frame.depth / maxDepth, 0, 1);
    const synth = synthParametersForMode(mode, drive, {
      fmIndex: 4,
      fmRatio: 2,
      shepardWidth: 4,
      shepardPosition: shepardPositionForDepth(frame.depth),
    });
    voices.push({
      key: `frame:${frame.frameId}`,
      frequency: pitch01ToFrequency(pitch01, state.baseFrequency, state.rangeOctaves),
      gain: 0.5 * 0.86 ** frame.depth,
      pan: panForFrame(frame),
      waveform: "sine",
      ...synth,
    });
  }
  return voices;
}

function ensureFusedNode() {
  const audio = pool.context;
  if (fusedBuilt || !audio || !pool.master) return;
  fusedBuilt = true;
  if (typeof audio.createOscillator !== "function" || typeof audio.createGain !== "function") return;
  fusedOsc = audio.createOscillator();
  fusedOsc.type = fusedTypeForProgram();
  fusedOsc.frequency.setValueAtTime(60, audio.currentTime);
  fusedGain = audio.createGain();
  fusedGain.gain.setValueAtTime(0.0001, audio.currentTime);
  fusedOsc.connect(fusedGain);
  fusedGain.connect(pool.master);
  fusedOsc.start(audio.currentTime);
}

function fusedTypeForProgram() {
  if (state.program === "hanoi") return "square";
  if (state.program === "fibonacci") return "triangle";
  return "sawtooth";
}

// A bounded single-line feedback delay: returns/base events sent here ring and
// erode toward a resonant tail — the mic-free "audio eats itself" voicing.
function ensureFeedbackBus() {
  const audio = pool.context;
  if (feedbackBuilt || !audio || !pool.master) return;
  feedbackBuilt = true;
  if (typeof audio.createDelay !== "function" || typeof audio.createGain !== "function") return;
  feedbackInput = audio.createGain();
  feedbackInput.gain.setValueAtTime(1, audio.currentTime);
  const delay = audio.createDelay(2);
  delay.delayTime.setValueAtTime(0.22, audio.currentTime);
  feedbackGain = audio.createGain();
  feedbackGain.gain.setValueAtTime(clamp(state.feedback, 0, 0.85), audio.currentTime);
  const wetOut = audio.createGain();
  wetOut.gain.setValueAtTime(0.9, audio.currentTime);
  feedbackInput.connect(delay);
  if (typeof audio.createBiquadFilter === "function") {
    const lowpass = audio.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(2600, audio.currentTime);
    delay.connect(lowpass);
    lowpass.connect(feedbackGain);
    lowpass.connect(wetOut);
  } else {
    delay.connect(feedbackGain);
    delay.connect(wetOut);
  }
  feedbackGain.connect(delay);
  wetOut.connect(pool.master);
}

// Small percussive tone for base cases and returns, with an optional send into
// the feedback bus. Rolled here (rather than VoicePool.strike) so returns can
// feed the "eats itself" delay under our own routing control.
function triggerTone(frequency, gain, pan, { type = "sine", attack = 0.004, decay = 0.26, wet = 0 } = {}) {
  const audio = pool.context;
  if (!state.audio || !audio || !pool.master) return;
  if (!Number.isFinite(frequency) || gain <= 0) return;
  if (typeof audio.createOscillator !== "function" || typeof audio.createGain !== "function") return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(clamp(frequency, 20, 12_000), now);
  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  osc.connect(env);
  let tail = env;
  if (typeof audio.createStereoPanner === "function") {
    const panner = audio.createStereoPanner();
    panner.pan.setValueAtTime(clamp(pan, -1, 1), now);
    env.connect(panner);
    tail = panner;
  }
  tail.connect(pool.master);
  ensureFeedbackBus();
  if (wet > 0 && feedbackInput) {
    const send = audio.createGain();
    send.gain.setValueAtTime(clamp(wet, 0, 1), now);
    tail.connect(send);
    send.connect(feedbackInput);
  }
  osc.start(now);
  osc.stop(now + attack + decay + 0.05);
}

function triggerBase(event) {
  const frequency = clamp(state.baseFrequency * 2 ** (state.rangeOctaves + 1.2), 200, 6_000);
  const wet = state.returnVoicing === "feedback" ? clamp(state.feedback / 0.86, 0, 1) * 0.6 : 0;
  triggerTone(frequency, 0.42, 0, { type: "triangle", attack: 0.003, decay: 0.34, wet });
  baseFlash = 1;
}

function triggerReturn(event) {
  const pitch01 = 1 - event.depth / maxDepth;
  const frequency = pitch01ToFrequency(pitch01, state.baseFrequency, state.rangeOctaves) * 2;
  const wet = state.returnVoicing === "feedback" ? clamp(state.feedback / 0.86, 0, 1) : 0;
  triggerTone(frequency, 0.28, panForFrame(event), { type: "sine", attack: 0.005, decay: 0.3, wet });
}

function dispatch(event) {
  if (event.type === "call") {
    heldFrames.set(event.frameId, {
      frameId: event.frameId,
      depth: event.depth,
      branch: event.branch,
      memoHit: event.memoHit,
    });
    lastEventLabel = `call ${event.label}${event.memoHit ? " · memo" : ""}`;
  } else if (event.type === "base") {
    triggerBase(event);
    lastEventLabel = `base ${event.label} = ${event.value}`;
  } else if (event.type === "return") {
    heldFrames.delete(event.frameId);
    triggerReturn(event);
    lastEventLabel = `return ${event.label} → ${event.value}`;
  }
}

function currentDepth() {
  let depth = 0;
  for (const frame of heldFrames.values()) depth = Math.max(depth, frame.depth);
  return heldFrames.size ? depth : 0;
}

function resetClocks() {
  lastFrameTime = performance.now();
  lastAudioTime = pool.context?.currentTime ?? null;
}

function transportDelta(now) {
  const performanceDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const audioTime = state.audio && pool.context?.state === "running" ? pool.context.currentTime : null;
  const audioDelta = Number.isFinite(audioTime) && Number.isFinite(lastAudioTime) && audioTime >= lastAudioTime
    ? audioTime - lastAudioTime
    : 0;
  lastAudioTime = Number.isFinite(audioTime) ? audioTime : null;
  return Math.min(0.5, audioDelta > 1e-6 ? audioDelta : performanceDelta);
}

function advance(delta, fused) {
  if (!timeline) return;
  playhead += delta / stepSeconds();
  if (playhead >= timeline.events.length) {
    playhead = 0;
    eventCursor = 0;
    heldFrames.clear();
  }
  while (eventCursor < timeline.events.length && timeline.events[eventCursor].tIndex <= playhead) {
    const event = timeline.events[eventCursor];
    eventCursor += 1;
    if (!fused) dispatch(event);
  }
  if (fused) heldFrames.clear();
}

function frame(now) {
  scheduledFrame = 0;
  const delta = transportDelta(now);
  const rate = 1 / stepSeconds();
  const fused = rate >= FUSION_RATE;
  if (state.playing) advance(delta, fused);

  if (state.audio) {
    ensureFusedNode();
    const audio = pool.context;
    if (fused) {
      pool.setVoices([]);
      if (fusedGain) fusedGain.gain.setTargetAtTime(0.22, audio.currentTime, 0.05);
      if (fusedOsc) {
        fusedOsc.frequency.setTargetAtTime(clamp(rate * 2, 30, 9_000), audio.currentTime, 0.05);
      }
    } else {
      if (fusedGain) fusedGain.gain.setTargetAtTime(0.0001, audio.currentTime, 0.05);
      const voices = heldVoices();
      pool.setVoiceTrajectory(voices, voices, 0.08, { mode: state.shepardToggle ? "shepard" : state.synthMode });
    }
  }

  baseFlash = Math.max(0, baseFlash - delta * 3);
  draw(fused);
  updateReadouts(rate, fused);
  if (state.playing) scheduleFrame();
}

function updateReadouts(rate, fused) {
  $("timeScaleOut").textContent = `${rate < 10 ? rate.toFixed(2) : Math.round(rate)} steps/s`;
  $("timeScaleSummary").textContent = fused ? "fused tone" : `${rate.toFixed(1)} steps/s`;
  const progress = timeline && timeline.events.length ? clamp(playhead / timeline.events.length, 0, 1) : 0;
  $("position").value = String(progress);
  $("positionOut").textContent = `${Math.round(progress * 100)}%`;
  $("momentReadout").textContent = lastEventLabel;
  $("stageReadout").textContent = `${state.program.toUpperCase()}(${state.n}) · ${fused ? "FUSED" : `DEPTH ${currentDepth()}`} · ${state.audio ? "AUDIO ON" : "AUDIO OFF"}`;
  $("playSummary").textContent = state.playing ? "running" : "paused";
}

function draw(fused) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const pad = 24;
  const width = cssWidth;
  const height = cssHeight;

  if (fused && profile.length > 1) {
    context.beginPath();
    for (let index = 0; index < profile.length; index += 1) {
      const x = pad + (width - 2 * pad) * index / (profile.length - 1);
      const y = height * 0.5 - (profile[index] - 0.5) * height * 0.6;
      if (index) context.lineTo(x, y);
      else context.moveTo(x, y);
    }
    context.strokeStyle = "rgba(125,180,255,.85)";
    context.lineWidth = 1.6;
    context.stroke();
    drawProgress(pad, width, height);
    return;
  }

  const frames = [...heldFrames.values()].sort((a, b) => a.depth - b.depth);
  const rowHeight = (height - 2 * pad) / (maxDepth + 1);
  for (const held of frames) {
    const top = pad + held.depth * rowHeight;
    const centreX = width * 0.5 + panForFrame(held) * (width * 0.5 - pad - 40);
    const barWidth = Math.max(44, (width - 2 * pad) * 0.5 * 0.9 ** held.depth);
    const light = clamp(62 - held.depth * 3, 30, 70);
    context.fillStyle = `hsla(${210 + held.depth * 12}, 70%, ${light}%, 0.5)`;
    context.fillRect(centreX - barWidth / 2, top, barWidth, rowHeight * 0.7);
    context.strokeStyle = "rgba(232,196,107,.55)";
    context.lineWidth = 1;
    context.strokeRect(centreX - barWidth / 2, top, barWidth, rowHeight * 0.7);
  }

  if (baseFlash > 0) {
    context.fillStyle = `rgba(255,243,214,${0.4 * baseFlash})`;
    context.fillRect(0, 0, width, height);
  }
  drawProgress(pad, width, height);
}

function drawProgress(pad, width, height) {
  const progress = timeline && timeline.events.length ? clamp(playhead / timeline.events.length, 0, 1) : 0;
  context.fillStyle = "rgba(125,180,255,.65)";
  context.fillRect(pad, height - pad * 0.6, (width - 2 * pad) * progress, 3);
  context.beginPath();
  context.arc(pad + (width - 2 * pad) * progress, height - pad * 0.6 + 1.5, 4, 0, TAU);
  context.fillStyle = "#fff3d6";
  context.fill();
}

async function toggleAudio() {
  $("audioError").hidden = true;
  if (state.audio) {
    state.audio = false;
    pool.disable();
    if (fusedGain && pool.context) fusedGain.gain.setValueAtTime(0.0001, pool.context.currentTime);
  } else {
    try {
      $("audioState").textContent = "off";
      await pool.enable();
      pool.setLevel(state.level);
      state.audio = true;
    } catch (error) {
      $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
      $("audioError").hidden = false;
    }
  }
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
  scheduleFrame();
}

function paintTransport() {
  setPressed($("playButton"), state.playing);
  $("playSummary").textContent = state.playing ? "running" : "paused";
}

// Controls.
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
bindRange("n", "n", (value) => String(Math.round(value)), () => {
  $("processLabel").textContent = `${state.program}(${state.n})`;
  rebuild();
});
bindRange("timeScale", "timeScale", () => `${(1 / stepSeconds()).toFixed(2)} steps/s`);
bindRange("feedback", "feedback", (value) => value.toFixed(2), () => {
  if (feedbackGain && pool.context) {
    feedbackGain.gain.setTargetAtTime(clamp(state.feedback, 0, 0.85), pool.context.currentTime, 0.02);
  }
});
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("rangeOctaves", "rangeOctaves", (value) => `${value.toFixed(2)} oct`);
bindRange("panSpread", "panSpread", (value) => `${Math.round(value * 100)}%`);

$("program").addEventListener("change", (event) => {
  state.program = event.currentTarget.value;
  applyProgramMeta();
  if (fusedOsc) fusedOsc.type = fusedTypeForProgram();
  rebuild();
  announce(`${state.program} selected.`);
  scheduleFrame();
});

$("synthMode").addEventListener("change", (event) => {
  state.synthMode = event.currentTarget.value;
  updateVoicingSummary();
  scheduleFrame();
});

$("returnVoicing").addEventListener("change", (event) => {
  state.returnVoicing = event.currentTarget.value;
  updateVoicingSummary();
  scheduleFrame();
});

$("memoize").addEventListener("click", () => {
  state.memoize = !state.memoize;
  setPressed($("memoize"), state.memoize);
  $("memoize").textContent = `Memoize · ${state.memoize ? "on" : "off"}`;
  rebuild();
  scheduleFrame();
});

$("shepardToggle").addEventListener("click", () => {
  state.shepardToggle = !state.shepardToggle;
  setPressed($("shepardToggle"), state.shepardToggle);
  $("shepardToggle").textContent = `Shepard descent · ${state.shepardToggle ? "on" : "off"}`;
  updateVoicingSummary();
  scheduleFrame();
});

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  resetClocks();
  paintTransport();
  if (!state.playing && !state.audio) pool.silence();
  announce(state.playing ? "Recursion playing." : "Recursion paused.");
  scheduleFrame();
});

$("stepButton").addEventListener("click", () => {
  if (!timeline) return;
  if (eventCursor >= timeline.events.length) {
    playhead = 0;
    eventCursor = 0;
    heldFrames.clear();
  }
  const event = timeline.events[eventCursor];
  if (event) {
    eventCursor += 1;
    playhead = event.tIndex + 0.001;
    dispatch(event);
  }
  if (state.audio) {
    const voices = heldVoices();
    pool.setVoiceTrajectory(voices, voices, 0.08, { mode: state.shepardToggle ? "shepard" : state.synthMode });
  }
  scheduleFrame();
});

$("restartButton").addEventListener("click", () => {
  playhead = 0;
  eventCursor = 0;
  heldFrames.clear();
  lastEventLabel = "ready";
  if (state.audio) pool.setVoices([]);
  announce("Recursion restarted.");
  scheduleFrame();
});

$("audioButton").addEventListener("click", toggleAudio);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else scheduleFrame();
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) pool.disable();
  else void pool.close();
});

applyProgramMeta();
updateVoicingSummary();
$("shepardToggle").textContent = `Shepard descent · ${state.shepardToggle ? "on" : "off"}`;
rebuild();
paintTransport();
scheduleFrame();
