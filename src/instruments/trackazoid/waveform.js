/** Compact, stereo-safe waveform envelopes; this module also runs as a Worker. */
export function peakEnvelope(channels, bins = 8192) {
  const length = channels[0]?.length ?? 0;
  const count = Math.min(length, Math.max(1, Math.floor(bins)));
  const peaks = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    let lo = 0, hi = 0;
    const start = Math.floor(i * length / count), end = Math.floor((i + 1) * length / count);
    for (const channel of channels) {
      for (let j = start; j < end; j++) {
        const value = Number.isFinite(channel[j]) ? channel[j] : 0;
        lo = Math.min(lo, value); hi = Math.max(hi, value);
      }
    }
    peaks[i * 2] = lo; peaks[i * 2 + 1] = hi;
  }
  return peaks;
}

export function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${Math.floor(value % 60).toString().padStart(2, "0")}.${Math.floor((value % 1) * 10)}`;
}

export function beatLoop(position, bpm, offset, beats, duration) {
  const beat = 60 / Math.max(40, Math.min(240, Number(bpm) || 120));
  const count = [1, 2, 4, 8, 16].includes(beats) ? beats : 4;
  const start = Math.max(0, offset + Math.floor((position - offset + 1e-7) / beat) * beat);
  const end = Math.min(duration, start + count * beat);
  return end - start >= 0.05 ? { start, end } : null;
}

export function syncTarget({ position, duration = Infinity, bpm, offset = 0, otherPosition, otherBpm, otherRate, otherOffset = 0 }) {
  const rate = otherBpm * otherRate / bpm;
  if (!Number.isFinite(rate) || rate < 0.84 || rate > 1.16) return null;
  const otherBeat = (otherPosition - otherOffset) * otherBpm / 60;
  const fraction = ((otherBeat % 1) + 1) % 1;
  const thisBeat = (position - offset) * bpm / 60;
  const origin = offset + fraction * 60 / bpm;
  const firstBeat = Math.ceil(-origin * bpm / 60);
  const lastBeat = Math.floor((duration - origin) * bpm / 60);
  if (lastBeat < firstBeat) return null;
  const nearestBeat = Math.max(firstBeat, Math.min(lastBeat, Math.round(thisBeat - fraction)));
  return { rate, position: origin + nearestBeat * 60 / bpm };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = ({ data }) => {
    const peaks = peakEnvelope(data.channels, data.bins);
    globalThis.postMessage({ peaks }, [peaks.buffer]);
  };
}

export class WaveformView {
  constructor(canvas, overview, { color, getState, seek, changeLoop, onError }) {
    Object.assign(this, { canvas, overview, color, getState, seek, changeLoop, onError });
    this.peaks = null; this.worker = null; this.drag = null; this.revision = 0;
    this.abort = new AbortController();
    for (const surface of [canvas, overview]) {
      const on = (name, fn) => surface.addEventListener(name, fn, { signal: this.abort.signal });
      on("pointerdown", (event) => {
        const state = getState();
        if (!state.duration || event.button !== 0) return;
        event.preventDefault(); surface.focus({ preventScroll: true }); surface.setPointerCapture(event.pointerId);
        const bounds = surface.getBoundingClientRect(), window = this.window(state, surface === overview);
        const time = window.start + (event.clientX - bounds.left) / bounds.width * window.span;
        const tolerance = 10 / bounds.width * window.span;
        const mode = state.loop && Math.abs(time - state.loop.start) < tolerance ? "start"
          : state.loop && Math.abs(time - state.loop.end) < tolerance ? "end" : "seek";
        this.drag = { surface, window, bounds, mode, loop: state.loop, pointerId: event.pointerId };
        this.move(event);
      });
      on("pointermove", (event) => { if (this.drag?.surface === surface) this.move(event); });
      on("pointerup", () => { this.drag = null; });
      on("pointercancel", () => { this.drag = null; });
      on("lostpointercapture", () => { this.drag = null; });
      on("keydown", (event) => {
        const state = getState();
        if (!state.duration) return;
        const step = event.shiftKey ? 10 : 60 / (state.bpm || 120);
        const position = event.key === "Home" ? 0 : event.key === "End" ? state.duration
          : event.key === "ArrowLeft" ? state.position - step : event.key === "ArrowRight" ? state.position + step : null;
        if (position !== null) { event.preventDefault(); seek(Math.max(0, Math.min(state.duration, position))); }
      });
    }
  }
  move(event) {
    const drag = this.drag;
    if (!drag) return;
    const state = this.getState();
    const time = Math.max(0, Math.min(state.duration, drag.window.start + (event.clientX - drag.bounds.left) / drag.bounds.width * drag.window.span));
    if (drag.mode === "seek") this.seek(time);
    else if (drag.mode === "start") this.changeLoop(Math.min(time, drag.loop.end - 0.05), drag.loop.end);
    else this.changeLoop(drag.loop.start, Math.max(time, drag.loop.start + 0.05));
  }
  async setBuffer(buffer) {
    const revision = ++this.revision;
    this.worker?.terminate(); this.worker = null; this.peaks = null;
    // Only compact envelopes survive analysis; PCM copies are released with the worker.
    try {
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i).slice());
      const worker = new Worker(new URL("./waveform.js", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = ({ data }) => {
        if (revision === this.revision) this.peaks = data.peaks;
        worker.terminate(); if (this.worker === worker) this.worker = null;
      };
      worker.onerror = () => {
        worker.terminate(); if (this.worker === worker) this.worker = null;
        if (revision === this.revision) this.onError?.(new Error("Waveform preview could not be drawn. Audio playback remains available."));
      };
      worker.postMessage({ channels, bins: 16384 }, channels.map((channel) => channel.buffer));
    } catch (error) { this.worker?.terminate(); this.worker = null; this.onError?.(error); }
  }
  window(state, overview) {
    if (overview || !state.duration) return { start: 0, span: state.duration || 1 };
    const span = Math.min(state.duration, 16 * 60 / (state.bpm || 120));
    return { start: Math.max(0, Math.min(state.duration - span, state.position - span * 0.3)), span };
  }
  draw() {
    const state = this.getState();
    for (const surface of [this.canvas, this.overview]) {
      const bounds = surface.getBoundingClientRect();
      if (bounds.width < 1) continue;
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const width = Math.round(bounds.width * dpr), height = Math.round(bounds.height * dpr);
      if (surface.width !== width || surface.height !== height) { surface.width = width; surface.height = height; }
      const ctx = surface.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = bounds.width, h = bounds.height;
      ctx.clearRect(0, 0, w, h);
      const { start, span } = this.drag?.surface === surface ? this.drag.window : this.window(state, surface === this.overview);
      const x = (time) => (time - start) / span * w;
      ctx.strokeStyle = "#273039"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      if (!state.duration) {
        ctx.fillStyle = "#92a0aa"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
        if (surface !== this.overview) ctx.fillText("Drop an audio file here", w / 2, h / 2 - 12);
        continue;
      }
      if (state.loop) {
        ctx.fillStyle = "#a3ffab20"; ctx.fillRect(x(state.loop.start), 0, x(state.loop.end) - x(state.loop.start), h);
        ctx.strokeStyle = "#c5ed91";
        for (const time of [state.loop.start, state.loop.end]) { ctx.beginPath(); ctx.moveTo(x(time), 0); ctx.lineTo(x(time), h); ctx.stroke(); }
      }
      if (surface !== this.overview && state.gridReady !== false) {
        const beat = 60 / (state.bpm || 120), offset = state.beatOffset || 0;
        for (let n = Math.ceil((start - offset) / beat); n * beat + offset < start + span; n++) {
          const px = x(n * beat + offset);
          ctx.strokeStyle = n % 4 === 0 ? "#53606e" : "#2c3540";
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
          if (n % 4 === 0) { ctx.fillStyle = "#a1adb6"; ctx.font = "10px monospace"; ctx.textAlign = "left"; ctx.fillText(String(Math.floor(n / 4) + 1), px + 4, 13); }
        }
      }
      if (this.peaks?.length) {
        const bins = this.peaks.length / 2;
        ctx.strokeStyle = this.color; ctx.lineWidth = surface === this.overview ? 1 : 1.5;
        ctx.beginPath();
        for (let px = 0; px < w; px += 2) {
          const left = Math.max(0, Math.floor((start + px / w * span) / state.duration * bins));
          const right = Math.min(bins, Math.max(left + 1, Math.ceil((start + (px + 2) / w * span) / state.duration * bins)));
          let lo = 0, hi = 0;
          for (let bin = left; bin < right; bin++) { lo = Math.min(lo, this.peaks[bin * 2]); hi = Math.max(hi, this.peaks[bin * 2 + 1]); }
          ctx.moveTo(px, h / 2 - hi * h * 0.43); ctx.lineTo(px, h / 2 - lo * h * 0.43);
        }
        ctx.stroke();
      }
      for (let i = 0; i < (state.cues?.length || 0); i++) {
        const cue = state.cues[i]; if (cue === null || cue === undefined) continue;
        const px = x(cue); ctx.fillStyle = this.color; ctx.fillRect(px, 0, 2, h);
        if (surface !== this.overview) { ctx.font = "bold 10px monospace"; ctx.textAlign = "left"; ctx.fillText(String(i + 1), px + 5, h - 8); }
      }
      const cursor = x(state.position);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cursor, 0); ctx.lineTo(cursor, h); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(cursor - 4, 0); ctx.lineTo(cursor + 4, 0); ctx.lineTo(cursor, 7); ctx.fill();
      surface.setAttribute("aria-valuemax", String(Math.round(state.duration * 10) / 10));
      surface.setAttribute("aria-valuenow", String(Math.round(state.position * 10) / 10));
      surface.setAttribute("aria-valuetext", formatTime(state.position));
    }
  }
  destroy() { this.revision++; this.worker?.terminate(); this.abort.abort(); }
}
