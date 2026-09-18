// Shared application boundary for the wave-physics instruments.
// Owns: explicit Audio arm, shared output connection, microphone lifecycle,
// recording buffer, transport separation, and teardown.
// Follows contracts/audio-transport-v1.md: Play never arms Audio.
import { connectAudioOutput } from "./audio-output-manager.js";

const MAX_RECORD_SECONDS = 8;
const MIN_RECORD_SECONDS = 0.12;

export function createWaveLabShell({
  audioButtonId = "audioButton",
  playButtonId = "playButton",
  recordButtonId = "recordButton",
  statusId = "liveStatus",
  errorId = "audioError",
  onArm = async () => {},
  onDisarm = () => {},
  onTransport = () => {},
  onRecording = () => {},
  onMicNode = () => {},
  maxRecordSeconds = MAX_RECORD_SECONDS,
} = {}) {
  const $ = (id) => document.getElementById(id);
  const audioButton = $(audioButtonId);
  const playButton = $(playButtonId);
  const recordButton = $(recordButtonId);
  const statusEl = $(statusId);
  const errorEl = $(errorId);

  const state = {
    context: null,
    armed: false,
    running: false,
    recording: false,
    micReady: false,
  };

  let graphInput = null;   // instrument-provided entry node
  let dryGain = null;
  let micStream = null;
  let micSource = null;
  let micTrim = null;
  let recorder = null;
  let chunks = [];
  let recordStartedAt = 0;

  const say = (text) => { if (statusEl) statusEl.textContent = text; };
  const fail = (text) => { if (errorEl) { errorEl.hidden = false; errorEl.textContent = text; } };
  const clearError = () => { if (errorEl) errorEl.hidden = true; };

  function paintAudio() {
    if (!audioButton) return;
    audioButton.disabled = false;
    // nav.js observes aria-pressed and renders the speaker icon and labels.
    audioButton.setAttribute("aria-pressed", String(state.armed));
  }
  function paintPlay() {
    if (!playButton) return;
    playButton.setAttribute("aria-pressed", String(state.running));
    playButton.textContent = state.running ? "Pause" : "Play";
  }
  function paintRecord() {
    if (!recordButton) return;
    recordButton.setAttribute("aria-pressed", String(state.recording));
    recordButton.textContent = state.recording ? "Stop recording" : "Record";
  }

  async function arm() {
    clearError();
    try {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) throw new Error("Web Audio is unavailable in this browser.");
      if (!state.context) state.context = new Ctx({ latencyHint: "interactive" });
      if (state.context.state === "suspended") await state.context.resume();
      const built = await onArm(state.context);
      if (built?.input) graphInput = built.input;
      if (built?.dry) dryGain = built.dry;
      state.armed = true;
      paintAudio();
      say(state.running ? "Audio on." : "Audio on — press Play, or hold Record and make a sound.");
      if (micSource && graphInput) routeMic();
    } catch (error) {
      fail(error?.message ? `Audio could not start: ${error.message}` : "Audio could not start.");
    }
  }

  function disarm() {
    state.armed = false;
    onDisarm();
    paintAudio();
    say("Audio off — transport and recorded material are kept.");
  }

  function routeMic() {
    if (!micSource || !state.context) return;
    if (!micTrim) {
      micTrim = state.context.createGain();
      micTrim.gain.value = 0.9;
    }
    try { micSource.disconnect(); } catch { /* not connected */ }
    micSource.connect(micTrim);
    if (graphInput) { try { micTrim.disconnect(graphInput); } catch { /* fresh */ } micTrim.connect(graphInput); }
    // A recorder must let the performer hear themselves.
    if (dryGain) { try { micTrim.disconnect(dryGain); } catch { /* fresh */ } micTrim.connect(dryGain); }
    state.micReady = true;
    onMicNode(micTrim);
  }

  async function enableMic() {
    if (!state.context) {
      say("Turn Audio on first — the microphone joins the running graph.");
      return false;
    }
    if (state.micReady) return true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      micSource = state.context.createMediaStreamSource(micStream);
      routeMic();
      say("Microphone on. Use headphones — this monitors live input.");
      return true;
    } catch (error) {
      fail(`Microphone unavailable: ${error?.message ?? "permission denied"}`);
      return false;
    }
  }

  async function startRecording() {
    if (!state.armed) { say("Turn Audio on before recording."); return; }
    if (!(await enableMic())) return;
    const ctx = state.context;
    chunks = [];
    recordStartedAt = ctx.currentTime;
    // Capture through a worklet-free tap so the recorded buffer is raw input.
    const tap = ctx.createScriptProcessor?.(2048, 1, 1) ?? ctx.createJavaScriptNode?.(2048, 1, 1);
    if (!tap) { fail("Recording is unavailable in this browser."); return; }
    const sink = ctx.createGain();
    sink.gain.value = 0;
    tap.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      if (ctx.currentTime - recordStartedAt > maxRecordSeconds) stopRecording();
    };
    micTrim.connect(tap);
    tap.connect(sink).connect(ctx.destination);
    recorder = { tap, sink };
    state.recording = true;
    paintRecord();
    say("Recording…");
  }

  function stopRecording() {
    if (!state.recording || !recorder) return;
    const ctx = state.context;
    const seconds = ctx.currentTime - recordStartedAt;
    try { micTrim.disconnect(recorder.tap); } catch { /* already */ }
    try { recorder.tap.disconnect(); recorder.sink.disconnect(); } catch { /* already */ }
    recorder.tap.onaudioprocess = null;
    recorder = null;
    state.recording = false;
    paintRecord();
    if (seconds < MIN_RECORD_SECONDS || !chunks.length) {
      say("That take was too short to keep.");
      chunks = [];
      return;
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buffer = ctx.createBuffer(1, total, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let at = 0;
    for (const c of chunks) { data.set(c, at); at += c.length; }
    // 6 ms edge fades so a take never clicks.
    const fade = Math.min(Math.floor(ctx.sampleRate * 0.006), Math.floor(total / 4));
    for (let i = 0; i < fade; i += 1) {
      data[i] *= i / fade;
      data[total - 1 - i] *= i / fade;
    }
    chunks = [];
    onRecording(buffer);
    say(`Kept ${seconds.toFixed(2)} s.`);
  }

  function releaseMic() {
    try { micSource?.disconnect(); } catch { /* already */ }
    try { micTrim?.disconnect(); } catch { /* already */ }
    for (const track of micStream?.getTracks?.() ?? []) track.stop();
    micStream = null; micSource = null; state.micReady = false;
  }

  function teardown() {
    stopRecording();
    releaseMic();
    onDisarm();
    try { state.context?.close(); } catch { /* already closed */ }
    state.context = null;
    state.armed = false;
  }

  audioButton?.addEventListener("click", () => { if (state.armed) disarm(); else arm(); });
  playButton?.addEventListener("click", () => {
    state.running = !state.running;
    paintPlay();
    onTransport(state.running);
    if (!state.armed) say("Audio is off — turn it on to hear playback.");
  });
  recordButton?.addEventListener("click", () => {
    if (state.recording) stopRecording(); else startRecording();
  });
  globalThis.addEventListener("pagehide", teardown);

  paintAudio(); paintPlay(); paintRecord();

  return {
    state, say, fail, clearError, enableMic, teardown,
    get context() { return state.context; },
    get armed() { return state.armed; },
    get running() { return state.running; },
    connectOutput(node) {
      if (!state.context) return () => {};
      return connectAudioOutput(state.context, node, { runtime: globalThis });
    },
    setGraphInput(node) { graphInput = node; if (micSource) routeMic(); },
    setDry(node) { dryGain = node; if (micSource) routeMic(); },
  };
}
