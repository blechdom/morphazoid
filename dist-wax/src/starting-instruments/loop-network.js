import { Core, clamp, wrap, demoTape, waveform } from "./common.js";

export const MAX_LOOPS = 8;
export const MAX_ROUTES = 24;
export const MAX_TAPE_SECONDS = 12;
export const NETWORK_SIZE = Object.freeze({ width: 1460, height: 1060, radius: 142 });
export function loopLetter(n) {
  let text = "";
  do { text = String.fromCharCode(65 + n % 26) + text; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return text;
}
export function loopPosition(index) {
  return { x: 205 + (index % 3) * 435, y: 205 + Math.floor(index / 3) * 325 };
}

/** Stable identity/storage/capture; the two subclasses own different routing DSP. */
export class LoopNetwork extends Core {
  constructor(rate, defaults, kind) {
    super(rate, defaults);
    this.kind = kind; this.loops = []; this.buffers = []; this.routes = [];
    this.nextLoopId = 0; this.nextRouteId = 0; this.revision = 0; this.mediaVersion = 0;
    this.recording = null; this.lastRecording = null;
    this.loopGain = new Float64Array(MAX_LOOPS);
    this.panLeft = new Float64Array(MAX_LOOPS); this.panRight = new Float64Array(MAX_LOOPS);
    this.hasSolo = false; this.envelopes = []; this.energy = [];
    this.gainSlew = 1 - Math.exp(-1 / (rate * 0.012));
  }
  indexFor(m) {
    if (m.loopId !== undefined) return this.loops.findIndex((l) => l.id === m.loopId);
    const index = Number(m.index);
    return Number.isInteger(index) && index >= 0 && index < this.loops.length ? index : -1;
  }
  addLoop(seconds = 2, demo = false, link = false) {
    if (this.loops.length >= MAX_LOOPS) return null;
    const index = this.loops.length, serial = this.nextLoopId++;
    const loop = { id: `loop-${serial}`, label: loopLetter(serial), ...loopPosition(index),
      paused: false, muted: false, solo: false, level: 0.8, pan: index === 0 ? -0.3 : index === 1 ? 0.3 : 0,
      mode: this.kind === "soup" ? "overdub" : "hold", name: demo ? "Demo recording" : "Empty tape" };
    const length = Math.round(this.rate * clamp(seconds, 0.25, MAX_TAPE_SECONDS, 2));
    this.loops.push(loop);
    this.buffers.push(demo ? demoTape(this.rate, length / this.rate, index % 2) : new Float32Array(length));
    this.loopGain[index] = 0; this.envelopes.push([]); this.energy.push(0); this.updateWave(index);
    this.onAdd?.(index);
    if (link && index > 0) {
      const previous = this.loops[index - 1], first = this.loops[0];
      const closing = this.routes.find((r) => r.from === previous.id && r.to === first.id);
      if (closing) closing.to = loop.id;
      else this.addRoute(previous.id, loop.id);
      this.addRoute(loop.id, first.id);
    }
    this.revision++; this.mediaVersion++; this.compile();
    return loop.id;
  }
  removeLoop(index) {
    if (this.loops.length <= 1 || !this.loops[index]) return false;
    const id = this.loops[index].id;
    this.onBeforeRemove?.(index);
    if (this.recording?.loopId === id) { this.recording = null; this.lastRecording = { loopId: id, accepted: false, removed: true }; }
    this.loops.splice(index, 1); this.buffers.splice(index, 1); this.envelopes.splice(index, 1); this.energy.splice(index, 1);
    this.routes = this.routes.filter((r) => r.from !== id && r.to !== id);
    for (let i = index; i < MAX_LOOPS - 1; i++) this.loopGain[i] = this.loopGain[i + 1];
    this.onRemove?.(index);
    this.revision++; this.mediaVersion++; this.compile();
    return true;
  }
  addRoute(from, to, values = {}) {
    if (from === to || this.routes.length >= MAX_ROUTES ||
      !this.loops.some((l) => l.id === from) || !this.loops.some((l) => l.id === to)) return null;
    const duplicate = this.routes.find((r) => r.from === from && r.to === to);
    if (duplicate) return duplicate.id;
    const route = { id: `route-${this.nextRouteId++}`, from, to, enabled: true,
      departure: this.params.departure ?? 0.72, landing: this.params.landing ?? 0.08,
      fade: 0.025, gain: 1, tone: 0.8, filter: 0, sendGain: 0, a: 0, b: 0 };
    this.routes.push(route); this.updateRoute(route.id, values);
    this.revision++; this.compile(); return route.id;
  }
  updateRoute(id, values) {
    const r = this.routes.find((route) => route.id === id);
    if (!r) return;
    for (const [key, lo, hi] of [["departure", 0.02, 0.98], ["landing", 0, 0.95],
      ["fade", 0.005, 0.15], ["gain", 0, 1], ["tone", 0, 1]]) {
      if (key in values) r[key] = clamp(values[key], lo, hi, r[key]);
    }
    if ("enabled" in values) r.enabled = Boolean(values.enabled);
    this.revision++; this.compile();
  }
  compile() {
    this.hasSolo = this.loops.some((l) => l.solo);
    this.loops.forEach((l, i) => {
      this.panLeft[i] = Math.sqrt((1 - l.pan) / 2); this.panRight[i] = Math.sqrt((1 + l.pan) / 2);
    });
    for (const route of this.routes) {
      route.a = this.loops.findIndex((l) => l.id === route.from);
      route.b = this.loops.findIndex((l) => l.id === route.to);
      route.alpha = 1 - Math.exp(-2 * Math.PI * (120 * (100 ** route.tone)) / this.rate);
    }
  }
  updateWave(index) {
    const data = this.buffers[index]; if (!data) return;
    this.envelopes[index] = waveform(data, 96);
    let sum = 0; const stride = Math.max(1, Math.floor(data.length / 2048));
    for (let j = 0; j < data.length; j += stride) sum += data[j] ** 2;
    this.energy[index] = Math.sqrt(sum / Math.ceil(data.length / stride));
  }
  install(index, samples, name = "Recording") {
    if (!this.loops[index] || !(samples instanceof Float32Array) ||
      samples.length < this.rate * 0.08 || samples.length > this.rate * MAX_TAPE_SECONDS) return false;
    const clean = Float32Array.from(samples, (x) => clamp(x, -0.9, 0.9, 0));
    const fade = Math.min(256, Math.floor(clean.length / 10));
    for (let i = 0; i < fade; i++) { clean[i] *= i / fade; clean[clean.length - 1 - i] *= i / fade; }
    this.buffers[index] = clean; this.loops[index].name = String(name).slice(0, 80);
    this.onInstall?.(index); this.updateWave(index); this.mediaVersion++; return true;
  }
  capture(input) {
    const r = this.recording; if (!r) return;
    const index = this.loops.findIndex((l) => l.id === r.loopId);
    if (index < 0) { this.recording = null; return; }
    if (!r.paused && !this.loops[index].paused && r.count < r.samples.length) {
      r.samples[r.count++] = clamp(input, -0.9, 0.9, 0);
    }
  }
  command(m) {
    super.command(m);
    const i = this.indexFor(m), loop = this.loops[i];
    if (m.type === "add-loop") this.addLoop(m.seconds, false, Boolean(m.connect));
    if (m.type === "remove-loop") this.removeLoop(i);
    if (m.type === "move-loop" && loop) {
      loop.x = clamp(m.x, 160, NETWORK_SIZE.width - 160, loop.x);
      loop.y = clamp(m.y, 160, NETWORK_SIZE.height - 160, loop.y);
    }
    if (m.type === "loop" && loop) {
      const p = m.values ?? {};
      for (const key of ["paused", "muted", "solo"]) if (key in p) loop[key] = Boolean(p[key]);
      for (const [key, lo, hi] of [["level", 0, 1], ["pan", -0.85, 0.85]]) if (key in p) loop[key] = clamp(p[key], lo, hi, loop[key]);
      if (["hold", "overdub"].includes(p.mode)) loop.mode = p.mode;
      this.compile();
    }
    if (m.type === "mode" && loop && ["hold", "overdub"].includes(m.value)) loop.mode = m.value;
    if (m.type === "connect") this.addRoute(m.from, m.to, m.values ?? {});
    if (m.type === "route") this.updateRoute(m.routeId, m.values ?? {});
    if (m.type === "disconnect") {
      this.routes = this.routes.filter((r) => r.id !== m.routeId); this.revision++; this.compile();
    }
    if (m.type === "load" && loop) this.install(i, m.samples, m.name);
    if (m.type === "record" && loop && !this.recording) {
      this.lastRecording = null; loop.paused = false;
      this.recording = { loopId: loop.id, samples: new Float32Array(Math.round(this.rate * MAX_TAPE_SECONDS)), count: 0, paused: false };
    }
    if (m.type === "record-pause" && this.recording) this.recording.paused = Boolean(m.value);
    if (m.type === "cancel-record") this.recording = null;
    if (m.type === "finish-record" && this.recording) {
      const r = this.recording; this.recording = null;
      const index = this.loops.findIndex((l) => l.id === r.loopId);
      const accepted = this.install(index, r.samples.slice(0, r.count), "Microphone recording");
      if (accepted && this.kind === "soup") this.loops[index].mode = "hold";
      this.lastRecording = { loopId: r.loopId, index, accepted, seconds: r.count / this.rate };
    }
    if (m.type === "clear" && loop) { this.buffers[i].fill(0); this.updateWave(i); this.mediaVersion++; }
    if (m.type === "erase" && loop) {
      const data = this.buffers[i], half = Math.ceil(data.length * 0.04), center = Math.floor(wrap(clamp(m.phase, 0, 1)) * data.length);
      for (let j = -half; j <= half; j++) data[(center + j + data.length) % data.length] = 0;
      this.updateWave(i); this.mediaVersion++;
    }
  }
  metadata() {
    return { networkVersion: 1, loops: this.loops.map((l, i) => ({ ...l, duration: this.buffers[i].length / this.rate })),
      routes: this.routes.map(({ filter, a, b, alpha, sendGain, ...r }) => r),
      nextLoopId: this.nextLoopId, nextRouteId: this.nextRouteId, revision: this.revision,
      waves: this.envelopes, energy: this.energy, mediaVersion: this.mediaVersion,
      modes: this.loops.map((l) => l.mode), names: this.loops.map((l) => l.name),
      durations: this.buffers.map((b) => b.length / this.rate),
      recording: this.recording ? { loopId: this.recording.loopId,
        index: this.loops.findIndex((l) => l.id === this.recording.loopId), seconds: this.recording.count / this.rate,
        paused: this.recording.paused || this.loops.find((l) => l.id === this.recording.loopId)?.paused } : null,
      lastRecording: this.lastRecording };
  }
  restoreNetwork(s) {
    if (!Array.isArray(s?.loops) || !s.loops.length || s.loops.length > MAX_LOOPS) return false;
    const ids = s.loops.map((l) => l.id);
    if (ids.some((id) => typeof id !== "string" || !/^loop-\d{1,8}$/.test(id)) || new Set(ids).size !== ids.length) return false;
    this.loops = []; this.buffers = []; this.routes = []; this.envelopes = []; this.energy = []; this.nextLoopId = 0;
    if (this.positions) this.positions = [];
    if (this.modes) this.modes = [];
    s.loops.forEach((l, i) => {
      this.addLoop(l.duration, false);
      Object.assign(this.loops[i], { id: l.id, label: loopLetter(Number(l.id.slice(5))), name: String(l.name ?? "Tape").slice(0, 80) });
      this.command({ type: "loop", index: i, values: l }); this.command({ type: "move-loop", index: i, x: l.x, y: l.y });
      const source = s.tapeData?.[i], target = this.buffers[i];
      if (source instanceof Float32Array && source.length > 0 && source.length <= 192000 * MAX_TAPE_SECONDS) {
        for (let j = 0; j < target.length; j++) {
          const pos = j / target.length * source.length, a = Math.floor(pos), mix = pos - a;
          target[j] = clamp(source[a] * (1 - mix) + source[(a + 1) % source.length] * mix, -0.9, 0.9, 0);
        }
      }
      this.updateWave(i);
    });
    this.nextLoopId = Math.max(Math.max(...ids.map((x) => Number(x.slice(5)))) + 1,
      Math.floor(clamp(s.nextLoopId, 0, 100000000)));
    this.nextRouteId = 0;
    for (const r of (Array.isArray(s.routes) ? s.routes : []).slice(0, MAX_ROUTES)) {
      const id = this.addRoute(r.from, r.to, r), route = this.routes.find((x) => x.id === id);
      if (route && typeof r.id === "string" && /^route-\d{1,8}$/.test(r.id) && !this.routes.some((x) => x !== route && x.id === r.id)) route.id = r.id;
    }
    this.nextRouteId = Math.max(Math.floor(clamp(s.nextRouteId, 0, 100000000)), ...this.routes.map((r) => Number(r.id.slice(6)) + 1));
    this.mediaVersion++; this.revision++; this.compile(); return true;
  }
}
