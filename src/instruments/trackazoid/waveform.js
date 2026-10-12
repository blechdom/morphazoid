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
  const count = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32].includes(beats) ? beats : 4;
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

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const MIN_RANGE = 0.05;
// Leave a nanosecond of room for subtraction rounding at the engine boundary.
const minimumRange = (duration) => Math.min(duration, MIN_RANGE + 1e-9);

export function snapTime(time, state, bypass = false) {
  if (!bypass && state.snap && state.gridReady && Number.isFinite(state.bpm) && state.bpm > 0) {
    const beat = 60 / state.bpm, offset = state.beatOffset || 0;
    time = offset + Math.round((time - offset) / beat) * beat;
  }
  return clamp(time, 0, state.duration);
}

/** Ordered, bounded selection; short files cannot contain a usable range. */
export function selectionRange(anchor, time, duration) {
  if (!(duration >= MIN_RANGE) || !Number.isFinite(anchor) || !Number.isFinite(time)) return null;
  const minimum = minimumRange(duration);
  let start = clamp(Math.min(anchor, time), 0, duration), end = clamp(Math.max(anchor, time), 0, duration);
  if (end - start < minimum) {
    if (time < anchor) start = Math.max(0, end - minimum);
    else end = Math.min(duration, start + minimum);
    if (end - start < minimum) start = Math.max(0, end - minimum);
    if (end - start < minimum) end = Math.min(duration, start + minimum);
  }
  return { start, end };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = ({ data }) => {
    const peaks = peakEnvelope(data.channels, data.bins);
    globalThis.postMessage({ peaks }, [peaks.buffer]);
  };
}

export class WaveformView {
  constructor(canvas, overview, { color, getState, seek, changeLoop, selectRange, mark, changeCue, onViewChange, onError }) {
    Object.assign(this, { canvas, overview, color, getState, seek, changeLoop, selectRange, mark, changeCue, onViewChange, onError });
    this.peaks = null; this.worker = null; this.drag = null; this.revision = 0; this.disposed = false;
    this.viewport = { start: 0, span: null, following: true }; this.lastView = null;
    this.abort = new AbortController();
    for (const surface of [canvas, overview]) {
      const on = (name, fn) => surface.addEventListener(name, fn, { signal: this.abort.signal });
      on("pointerdown", (event) => this.down(event, surface));
      on("pointermove", (event) => { if (this.drag?.surface === surface) this.move(event); });
      on("pointerup", (event) => { if (this.drag?.surface === surface) this.up(event); });
      for (const name of ["pointercancel", "lostpointercapture"]) on(name, (event) => {
        if (this.drag?.surface === surface && this.drag.pointerId === event.pointerId) this.cancel();
      });
      if (surface === canvas) on("dblclick", (event) => {
        if (this.disposed || event.button !== 0 || event.shiftKey || this.lastGestureWasDrag) return;
        const state = this.getState(), bounds = surface.getBoundingClientRect();
        if (!state.duration || state.loading || !bounds.width) return;
        event.preventDefault();
        const recentClick = this.lastClick && this.lastClick.revision === this.revision &&
          event.timeStamp - this.lastClick.at < 700 && Math.hypot(event.clientX - this.lastClick.x, event.clientY - this.lastClick.y) <= 4;
        // A replacement can occur between pointerup and dblclick. Only a click
        // completed on this buffer may create a marker.
        if (recentClick) this.mark?.(snapTime(this.lastClick.time, state, event.altKey));
      });
      on("keydown", (event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        const state = getState();
        if (!state.duration || state.loading) return;
        const step = event.shiftKey ? 10 : 60 / (state.bpm || 120);
        const position = event.key === "Home" ? 0 : event.key === "End" ? state.duration
          : event.key === "ArrowLeft" ? state.position - step : event.key === "ArrowRight" ? state.position + step : null;
        if (position !== null) { event.preventDefault(); seek(Math.max(0, Math.min(state.duration, position))); }
      });
    }
  }

  down(event, surface) {
    const state = this.getState(), bounds = surface.getBoundingClientRect();
    if (this.disposed || this.drag || state.loading || !state.duration || !bounds.width || event.button !== 0) return;
    event.preventDefault(); surface.focus({ preventScroll: true });
    const window = this.window(state, surface === this.overview);
    const time = clamp(window.start + (event.clientX - bounds.left) / bounds.width * window.span, 0, state.duration);
    const tolerance = 9 / bounds.width * window.span;
    const selection = state.selection && { ...state.selection }, loop = state.loop && { ...state.loop };
    let mode = surface === this.overview ? "navigate" : "select", cueIndex = -1;
    if (event.shiftKey) mode = "pan";
    else if (surface === this.canvas) {
      if (event.clientY - bounds.top >= bounds.height - 24) {
        cueIndex = (state.cues || []).findIndex((cue) => {
          const px = (cue - window.start) / window.span * bounds.width;
          const dx = event.clientX - bounds.left - Math.min(px, bounds.width - 22);
          return cue !== null && cue !== undefined && px >= 0 && px <= bounds.width && dx >= -3 && dx <= 24;
        });
      }
      const range = selection || loop;
      if (cueIndex >= 0 && this.changeCue) mode = "cue";
      else if (range) {
        const startDistance = Math.abs(time - range.start), endDistance = Math.abs(time - range.end);
        if (Math.min(startDistance, endDistance) <= tolerance) {
          mode = `${selection ? "selection" : "loop"}-${startDistance <= endDistance ? "start" : "end"}`;
        }
      }
    }
    this.drag = { surface, bounds, window, mode, pointerId: event.pointerId, revision: this.revision,
      state: { ...state }, selection, loop, cueIndex, cue: state.cues?.[cueIndex],
      startX: event.clientX, startY: event.clientY, time, moved: false, beforeView: this.getViewport(),
      anchor: selection?.start ?? state.selectionAnchor ?? state.position };
    this.lastGestureWasDrag = false;
    surface.setPointerCapture(event.pointerId);
    if (mode === "navigate") this.navigate(time);
  }

  navigate(time) {
    const view = this.getViewport();
    this.viewport = { ...view, start: clamp(time - view.span * 0.3, 0, Math.max(0, this.getState().duration - view.span)) };
    this.seek(time); this.notifyView();
  }

  move(event) {
    const drag = this.drag;
    if (!drag || this.disposed || drag.pointerId !== event.pointerId || drag.revision !== this.revision) return;
    if (this.getState().loading) { this.cancel(); return; }
    event.preventDefault();
    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
    const time = clamp(drag.window.start + (event.clientX - drag.bounds.left) / drag.bounds.width * drag.window.span, 0, drag.state.duration);
    if (drag.mode === "navigate") { this.navigate(time); return; }
    if (!drag.moved) return;
    if (drag.mode === "pan") {
      this.viewport = { ...drag.beforeView, following: false,
        start: clamp(drag.beforeView.start - (event.clientX - drag.startX) / drag.bounds.width * drag.window.span, 0, Math.max(0, drag.state.duration - drag.beforeView.span)) };
      this.notifyView(); return;
    }
    const target = snapTime(drag.mode === "cue" ? drag.cue + time - drag.time : time, drag.state, event.altKey);
    if (drag.mode === "cue") drag.previewCue = target;
    else if (drag.mode === "select") drag.previewRange = selectionRange(snapTime(drag.time, drag.state, event.altKey), target, drag.state.duration);
    else {
      const range = drag.selection || drag.loop, minimum = minimumRange(drag.state.duration);
      drag.previewRange = drag.mode.endsWith("start")
        ? { start: Math.max(0, Math.min(target, range.end - minimum)), end: range.end }
        : { start: range.start, end: Math.min(drag.state.duration, Math.max(target, range.start + minimum)) };
    }
  }

  up(event) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.move(event);
    if (this.drag !== drag) return;
    this.drag = null; this.lastGestureWasDrag = drag.moved;
    this.release(drag); this.notifyView();
    if (this.disposed || drag.revision !== this.revision) return;
    if (drag.mode === "pan") {
      if (!drag.moved && drag.surface === this.canvas) this.selectRange?.(selectionRange(
        drag.selection || Number.isFinite(drag.state.selectionAnchor) ? drag.anchor : snapTime(drag.anchor, drag.state, event.altKey),
        snapTime(drag.time, drag.state, event.altKey), drag.state.duration));
    } else if (drag.mode === "select") {
      if (drag.moved) this.selectRange?.(drag.previewRange);
      else {
        const previous = this.lastClick;
        const sameClick = previous && previous.revision === this.revision && event.timeStamp - previous.at < 700 &&
          Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 4;
        // PointerEvent.detail is 0 even for the second click. Following may
        // already have moved the viewport, so reuse the first timeline target.
        const time = sameClick ? previous.time : drag.time;
        this.lastClick = { time, at: sameClick ? previous.at : event.timeStamp,
          x: event.clientX, y: event.clientY, revision: this.revision };
        this.seek(time);
      }
    } else if (drag.mode === "cue") {
      if (drag.moved) this.changeCue?.(drag.cueIndex, drag.previewCue);
      else if (event.detail !== 2) this.seek(drag.cue);
    } else if (drag.moved && drag.mode.startsWith("selection-")) this.selectRange?.(drag.previewRange);
    else if (drag.moved && drag.mode.startsWith("loop-")) this.changeLoop?.(drag.previewRange.start, drag.previewRange.end);
  }

  release(drag) {
    if (drag?.surface.hasPointerCapture(drag.pointerId)) drag.surface.releasePointerCapture(drag.pointerId);
  }

  cancel(notify = true) {
    const drag = this.drag; this.drag = null;
    if (drag?.mode === "pan") this.viewport = drag.beforeView;
    this.release(drag);
    if (notify) this.notifyView();
  }

  getViewport() {
    const state = this.getState(), duration = state.duration || 1;
    if (this.drag?.surface === this.canvas && this.drag.mode !== "pan") return { ...this.drag.window, following: this.viewport.following };
    const span = clamp(this.viewport.span ?? 16 * 60 / (state.bpm || 120), Math.min(0.25, duration), duration);
    const start = clamp(this.viewport.following ? state.position - span * 0.3 : this.viewport.start, 0, duration - span);
    return { start, span, following: this.viewport.following };
  }

  notifyView() {
    if (this.disposed) return;
    const view = this.getViewport(), old = this.lastView;
    if (!old || old.start !== view.start || old.span !== view.span || old.following !== view.following) {
      this.lastView = view; this.onViewChange?.({ ...view });
    }
  }

  zoom(factor) {
    if (this.disposed || !Number.isFinite(factor) || factor <= 0) return;
    this.cancel(false);
    const view = this.getViewport(), state = this.getState(), duration = state.duration || 1;
    const span = clamp(view.span / factor, Math.min(0.25, duration), duration);
    const anchor = state.position >= view.start && state.position <= view.start + view.span ? state.position : view.start + view.span / 2;
    this.viewport = { ...view, span, start: clamp(anchor - (anchor - view.start) / view.span * span, 0, duration - span) };
    this.notifyView();
  }

  fit() {
    if (this.disposed) return;
    this.cancel(false); this.viewport = { start: 0, span: this.getState().duration || 1, following: false }; this.notifyView();
  }

  follow() {
    if (this.disposed) return;
    this.cancel(false); this.viewport = { ...this.getViewport(), following: true }; this.notifyView();
  }

  reset() {
    if (this.disposed) return;
    this.cancel(false); this.viewport = { start: 0, span: null, following: true }; this.lastGestureWasDrag = false; this.lastClick = null; this.notifyView();
  }
  async setBuffer(buffer) {
    if (this.disposed) return;
    const revision = ++this.revision;
    this.reset();
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
    return this.getViewport();
  }
  draw() {
    if (this.disposed) return;
    const state = this.getState();
    const selection = this.drag?.mode === "select" || this.drag?.mode.startsWith("selection-")
      ? this.drag.previewRange ?? state.selection : state.selection;
    const loop = this.drag?.mode.startsWith("loop-") ? this.drag.previewRange ?? state.loop : state.loop;
    this.notifyView();
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
      const { start, span } = this.window(state, surface === this.overview);
      const x = (time) => (time - start) / span * w;
      ctx.strokeStyle = "#273039"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      if (!state.duration) {
        ctx.fillStyle = "#92a0aa"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
        if (surface !== this.overview) ctx.fillText("Drop an audio file here", w / 2, h / 2 - 12);
        continue;
      }
      if (loop) {
        ctx.fillStyle = "#a3ffab20"; ctx.fillRect(x(loop.start), 0, x(loop.end) - x(loop.start), h);
        ctx.strokeStyle = "#c5ed91"; ctx.setLineDash([4, 3]);
        for (const time of [loop.start, loop.end]) { ctx.beginPath(); ctx.moveTo(x(time), 0); ctx.lineTo(x(time), h); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      if (selection) {
        ctx.fillStyle = "#ffcc8030"; ctx.fillRect(x(selection.start), 0, x(selection.end) - x(selection.start), h);
        ctx.strokeStyle = "#ffcc80"; ctx.lineWidth = 2;
        ctx.strokeRect(x(selection.start), 1, x(selection.end) - x(selection.start), h - 2);
      }
      const handles = selection || loop;
      if (handles && surface !== this.overview) {
        ctx.fillStyle = selection ? "#ffcc80" : "#c5ed91";
        for (const time of [handles.start, handles.end]) ctx.fillRect(x(time) - 4, h / 2 - 10, 8, 20);
      }
      if (surface !== this.overview && state.gridReady !== false) {
        const beat = 60 / (state.bpm || 120), offset = state.beatOffset || 0;
        const stride = Math.max(1, Math.ceil(span / beat / Math.max(1, w / 8)));
        const step = stride > 1 ? Math.ceil(stride / 4) * 4 : 1;
        for (let n = Math.ceil((start - offset) / beat / step) * step; n * beat + offset < start + span; n += step) {
          const px = x(n * beat + offset);
          ctx.strokeStyle = n % 4 === 0 ? "#53606e" : "#2c3540";
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
          if (n % 4 === 0) { ctx.fillStyle = "#a1adb6"; ctx.font = "10px monospace"; ctx.textAlign = "left"; ctx.fillText(String(Math.floor(n / 4) + 1), px + 4, 13); }
        }
      }
      if (Number.isFinite(state.selectionAnchor) && !selection) {
        const px = x(state.selectionAnchor); ctx.strokeStyle = "#ffcc80"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
        if (surface !== this.overview) { ctx.fillStyle = "#ffcc80"; ctx.font = "bold 10px monospace"; ctx.textAlign = "left"; ctx.fillText("In", px + 5, 26); }
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
        const cue = this.drag?.mode === "cue" && this.drag.cueIndex === i ? this.drag.previewCue ?? state.cues[i] : state.cues[i];
        if (cue === null || cue === undefined) continue;
        const px = x(cue); if (px < 0 || px > w) continue;
        const savedLoop = state.pads?.[i]?.type === "loop";
        ctx.fillStyle = savedLoop ? "#c5ed91" : this.color; ctx.fillRect(px, 0, 2, h);
        if (surface !== this.overview) {
          const flag = Math.min(px, w - 22);
          ctx.fillRect(flag, h - 22, 22, 20); ctx.fillStyle = "#111820";
          ctx.font = "bold 11px monospace"; ctx.textAlign = "left"; ctx.fillText(`${i + 1}${savedLoop ? "L" : ""}`, flag + (savedLoop ? 3 : 6), h - 8);
        }
      }
      if (surface === this.overview) {
        const view = this.getViewport();
        ctx.fillStyle = "#ffffff12"; ctx.fillRect(x(view.start), 0, view.span / span * w, h);
        ctx.strokeStyle = "#e4edf1"; ctx.lineWidth = 1;
        ctx.strokeRect(x(view.start) + 0.5, 0.5, Math.max(0, view.span / span * w - 1), h - 1);
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
  destroy() {
    this.disposed = true; this.revision++; this.cancel(false);
    this.worker?.terminate(); this.worker = null; this.abort.abort();
  }
}
