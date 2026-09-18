// Shared scaffold for the graph-tape prototype pages.
// Enforces the repository audio contract: audio is armed only by the explicit
// Audio control. Transport (Play) and pointer gestures never arm it.
export function createProtoShell({
  audioButtonId = "audioButton",
  playButtonId = "playButton",
  statusId = "liveStatus",
  errorId = "audioError",
  onArm = async () => {},
  onDisarm = () => {},
  onTransport = () => {},
} = {}) {
  const $ = (id) => document.getElementById(id);
  const audioButton = $(audioButtonId);
  const playButton = $(playButtonId);
  const statusEl = $(statusId);
  const errorEl = $(errorId);

  const state = { context: null, armed: false, running: false };

  const say = (text) => { if (statusEl) statusEl.textContent = text; };
  const fail = (text) => {
    if (!errorEl) return;
    errorEl.hidden = false;
    errorEl.textContent = text;
  };
  const clearError = () => { if (errorEl) errorEl.hidden = true; };

  function paintAudio() {
    if (!audioButton) return;
    audioButton.disabled = false;
    audioButton.setAttribute("aria-pressed", String(state.armed));
    audioButton.textContent = state.armed ? "Audio on" : "Audio off";
    audioButton.dataset.audioState = state.armed ? "on" : "off";
  }

  function paintPlay() {
    if (!playButton) return;
    playButton.setAttribute("aria-pressed", String(state.running));
    playButton.textContent = state.running ? "Pause" : "Play";
  }

  async function arm() {
    clearError();
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) throw new Error("Web Audio is unavailable in this browser.");
      if (!state.context) state.context = new Ctx({ latencyHint: "interactive" });
      if (state.context.state === "suspended") await state.context.resume();
      await onArm(state.context);
      state.armed = true;
      paintAudio();
      say(state.running ? "Audio on · running." : "Audio on · press Play.");
    } catch (error) {
      fail(error?.message ? `Audio could not start: ${error.message}` : "Audio could not start.");
    }
  }

  function disarm() {
    state.armed = false;
    onDisarm();
    paintAudio();
    say("Audio off · transport and tape state are kept.");
  }

  audioButton?.addEventListener("click", () => { if (state.armed) disarm(); else arm(); });
  playButton?.addEventListener("click", () => {
    state.running = !state.running;
    paintPlay();
    onTransport(state.running);
    if (!state.armed) say("Transport running silently · turn Audio on to hear it.");
    else say(state.running ? "Running." : "Paused.");
  });

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    event.preventDefault();
    playButton?.click();
  });

  paintAudio();
  paintPlay();

  return {
    state,
    say,
    fail,
    clearError,
    get context() { return state.context; },
    get armed() { return state.armed; },
    get running() { return state.running; },
    setRunning(next) { state.running = Boolean(next); paintPlay(); onTransport(state.running); },
  };
}

// Deterministic demo material so every page is playable without a microphone.
export function renderDemoPhrase(context, seconds = 4, seed = 7) {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.floor(seconds * rate), rate);
  const data = buffer.getChannelData(0);
  let s = seed >>> 0 || 1;
  const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  // Four short sung-vowel-ish events with distinct pitch and timbre.
  const events = [
    { at: 0.05, dur: 0.45, f0: 196, bright: 2.0 },
    { at: 0.80, dur: 0.40, f0: 196, bright: 2.1 },
    { at: 1.65, dur: 0.55, f0: 294, bright: 3.4 },
    { at: 2.60, dur: 0.50, f0: 196, bright: 1.8 },
  ];
  for (const ev of events) {
    const start = Math.floor(ev.at * rate);
    const len = Math.floor(ev.dur * rate);
    for (let i = 0; i < len && start + i < data.length; i += 1) {
      const t = i / rate;
      const env = Math.min(1, t / 0.02) * Math.exp(-t * 3.2);
      const vib = 1 + 0.012 * Math.sin(TAU_ * 5.5 * t);
      let v = 0;
      for (let h = 1; h <= 6; h += 1) {
        v += Math.sin(TAU_ * ev.f0 * h * t * vib) / (h ** ev.bright);
      }
      v += (rand() - 0.5) * 0.04 * env;
      data[start + i] += v * env * 0.5;
    }
  }
  return buffer;
}
const TAU_ = Math.PI * 2;
