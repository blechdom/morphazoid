// simd-303.js is browser-global-free at import time. Reuse its actual Wasm ABI
// views and configuration writer, rather than maintaining a second synth model.
import { createSimd303KernelViews, writeSimd303Configuration } from "../../../simd-303.js";
import { rubixSimdClock, rubixSimdSwingEdit } from "./rubix-clock.js";
export { rubixSimdClock } from "./rubix-clock.js";

const BLOCK_SIZE = 128;
const MAX_STICKERS = 216;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const unit = (value) => Math.max(0, Math.min(1, finite(value)));

export class RubixSimd303Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.enabled = false;
    this.voices = [];
    this.ids = [];
    this.gains = new Float64Array(MAX_STICKERS);
    this.targets = new Float64Array(MAX_STICKERS);
    this.deltas = new Float64Array(MAX_STICKERS);
    this.remaining = new Uint32Array(MAX_STICKERS);
    this.filters = new Float64Array(MAX_STICKERS);
    this.filterTargets = new Float64Array(MAX_STICKERS);
    this.filterDeltas = new Float64Array(MAX_STICKERS);
    this.pans = new Float64Array(MAX_STICKERS);
    this.panTargets = new Float64Array(MAX_STICKERS);
    this.panDeltas = new Float64Array(MAX_STICKERS);
    this.toneRemaining = new Uint32Array(MAX_STICKERS);
    this.visibility = {};
    this.timbres = {};
    this.beat = 0;
    this.pendingSwing = null;
    this.externalClock = null;
    this.scorePhaseOffset = 0;
    this.elapsed = 0;
    this.startAt = Infinity;
    this.lastStep = -1;
    this.output = 0.7;
    this.blocks = 0;
    this.port.onmessage = ({ data }) => {
      try { this.handleMessage(data); }
      catch (error) {
        this.enabled = false;
        this.port.postMessage({ type: "error", message: error.message });
      }
    };
  }

  configure(faces) {
    if (!Array.isArray(faces) || faces.length !== 6 || new Set(faces.map((f) => f.face)).size !== 6) {
      throw new Error("Rubix SIMD needs six distinct faces.");
    }
    for (const face of faces) {
      if (!Array.isArray(face.stepStickerIds) || face.stepStickerIds.length < 4 || face.stepStickerIds.length > 108) {
        throw new Error("Invalid Rubix SIMD score length.");
      }
    }
    const ids = [...new Set(faces.flatMap((face) => face.stepStickerIds.filter(Boolean)))];
    if (ids.length > MAX_STICKERS) throw new Error("Too many Rubix stickers.");
    const oldGains = new Map(this.ids.map((id, index) => [id, this.gains[index]]));
    const oldTone = new Map(this.ids.map((id, index) => [id, [this.filters[index], this.pans[index]]]));
    const oldBeatCount = this.stepCount ? this.stepCount / this.divisions : null;
    const oldDivisions = this.divisions;
    this.ids = ids;
    this.gains.fill(0);
    this.targets.fill(0);
    this.deltas.fill(0);
    this.remaining.fill(0);
    this.filters.fill(0);
    this.pans.fill(0);
    this.toneRemaining.fill(0);
    this.ids.forEach((id, index) => { this.gains[index] = oldGains.get(id) ?? 0; });
    this.ids.forEach((id, index) => {
      this.filters[index] = oldTone.get(id)?.[0] ?? 0;
      this.pans[index] = oldTone.get(id)?.[1] ?? 0;
    });
    const byId = new Map(ids.map((id, index) => [id, index]));
    for (let index = 0; index < 6; index += 1) {
      const face = faces[index];
      let voice = this.voices[index];
      if (!voice) {
        const kernel = createSimd303KernelViews(new WebAssembly.Instance(this.module));
        kernel.exports.reset();
        voice = { kernel };
      }
      writeSimd303Configuration(voice.kernel, face.configuration);
      voice.face = face.face;
      voice.stepIds = Int16Array.from(face.stepStickerIds.map((id) => byId.get(id) ?? -1));
      voice.baseFilters = Float32Array.from(face.stepStickerIds.map((_, step) => face.configuration.modulationArray[step * 4 + 1]));
      // Swing is driven by the shared surface clock, preserving the Wasm ABI.
      voice.kernel.params[15] = 0;
      this.voices[index] = voice;
    }
    const first = faces[0];
    this.divisions = first.divisions === 3 ? 3 : 1;
    this.stepCount = first.stepStickerIds.length;
    if (this.externalClock) {
      // Score edits retain the host's unbounded beat and global swing parity.
      // An integer offset keeps all note boundaries on the shared grid when
      // changing between parallel steps and three opposite-face subdivisions.
      if (oldDivisions && oldDivisions !== this.divisions) {
        this.scorePhaseOffset = Math.round(this.scorePhaseOffset / oldDivisions * this.divisions);
      }
    } else {
      if (oldBeatCount && oldBeatCount !== this.stepCount / this.divisions) {
        this.beat %= this.stepCount / this.divisions;
        this.pendingSwing = null;
      }
      this.updateTiming(first.configuration.params.timeScale / this.divisions * 15,
        first.configuration.params.swing);
    }
    this.setVisibility(this.visibility);
    this.setTimbres(this.timbres);
  }

  updateTiming(tempo, swing) {
    this.rate = Math.max(2, Math.min(20, finite(tempo, 120) / 15));
    const target = Math.max(0, Math.min(0.42, finite(swing)));
    Object.assign(this, rubixSimdSwingEdit(this.beat, this.swing, this.pendingSwing, target,
      this.enabled && currentTime >= this.startAt));
  }

  applyPendingSwing() {
    if (this.pendingSwing && this.beat >= this.pendingSwing.beat - 1e-8) {
      this.swing = this.pendingSwing.swing;
      this.pendingSwing = null;
    }
  }

  setVisibility(gains = {}) {
    this.visibility = gains;
    const ramp = Math.max(1, Math.round(sampleRate * 0.012));
    for (let index = 0; index < this.ids.length; index += 1) {
      const target = unit(gains[this.ids[index]]);
      if (target === this.targets[index] && (this.remaining[index] > 0 || target === this.gains[index])) continue;
      this.targets[index] = target;
      this.deltas[index] = (target - this.gains[index]) / ramp;
      this.remaining[index] = target === this.gains[index] ? 0 : ramp;
    }
  }

  setTimbres(timbres = {}) {
    this.timbres = timbres;
    const ramp = Math.max(1, Math.round(sampleRate * 0.02));
    for (let index = 0; index < this.ids.length; index += 1) {
      const tone = timbres[this.ids[index]];
      const filter = Math.max(-40, Math.min(40, finite(tone?.filter)));
      const pan = Math.max(-0.85, Math.min(0.85, finite(tone?.pan)));
      if (this.toneRemaining[index] && filter === this.filterTargets[index] && pan === this.panTargets[index]) continue;
      this.filterTargets[index] = filter;
      this.panTargets[index] = pan;
      this.filterDeltas[index] = (filter - this.filters[index]) / ramp;
      this.panDeltas[index] = (pan - this.pans[index]) / ramp;
      this.toneRemaining[index] = ramp;
    }
  }

  handleMessage(message) {
    if (!this.alive) return;
    if (message.type === "install") {
      this.backend = message.simdBytes ? "simd" : "scalar";
      try {
        this.module = new WebAssembly.Module(message.simdBytes ?? message.scalarBytes);
        this.configure(message.faces);
      }
      catch (error) {
        if (!message.simdBytes) throw error;
        this.voices = [];
        this.module = new WebAssembly.Module(message.scalarBytes);
        this.backend = "scalar";
        this.configure(message.faces);
      }
      this.port.postMessage({ type: "ready", backend: this.backend, faceCount: this.voices.length });
    } else if (message.type === "configure") {
      const previousStepCount = this.stepCount;
      const previousDivisions = this.divisions;
      this.configure(message.faces);
      if (previousStepCount !== this.stepCount || previousDivisions !== this.divisions) this.lastStep = -1;
    } else if (message.type === "timing") {
      // A mounted clock remains the sole authority for owned playback.
      if (!this.externalClock) this.updateTiming(message.tempo, message.swing);
    } else if (message.type === "visibility") {
      this.setVisibility(message.gains);
      this.setTimbres(message.timbres);
    } else if (message.type === "output") {
      this.output = unit(message.value) * 0.7;
    } else if (message.type === "playback") {
      this.enabled = Boolean(message.enabled);
      if (!this.enabled && this.pendingSwing) {
        this.swing = this.pendingSwing.swing;
        this.pendingSwing = null;
      }
    } else if (message.type === "clock") {
      const audioTime = finite(message.audioTime, currentTime);
      const beat = finite(message.quarterBeat) * 4;
      const rate = Math.max(2, Math.min(20, finite(message.tempo, 120) / 15));
      const swing = Math.max(0, Math.min(0.42, finite(message.swing)));
      this.externalClock = { audioTime, beat, rate, swing, revision: message.revision };
      this.rate = rate;
      this.beat = beat + (currentTime - audioTime) * rate;
      Object.assign(this, rubixSimdSwingEdit(this.beat, this.swing, this.pendingSwing, swing,
        this.enabled && currentTime >= this.startAt, message.swingAtBeat));
      if (Number.isFinite(message.startAt)) {
        this.startAt = Math.max(currentTime, message.startAt);
      }
      if (Number.isFinite(message.step)) {
        const alignAt = Number.isFinite(message.startAt) ? message.startAt : currentTime;
        const globalBeat = beat + (alignAt - audioTime) * rate;
        const alignSwing = this.pendingSwing && globalBeat >= this.pendingSwing.beat - 1e-8
          ? this.pendingSwing.swing : this.swing;
        const globalPhase = rubixSimdClock(globalBeat, rate, alignSwing, this.divisions).phase;
        this.scorePhaseOffset = message.step - globalPhase;
        // Grid snapshots can accumulate sub-sample floating-point noise.
        if (Math.abs(this.scorePhaseOffset - Math.round(this.scorePhaseOffset)) < 1e-6) {
          this.scorePhaseOffset = Math.round(this.scorePhaseOffset);
        }
        this.lastStep = -1;
      }
      // DSP elapsed time, filters, envelopes and oscillators stay intact.
      this.beat = beat + (currentTime - audioTime) * rate;
    } else if (message.type === "restart") {
      this.externalClock = null;
      this.scorePhaseOffset = 0;
      this.swing = this.pendingSwing?.swing ?? this.swing;
      this.pendingSwing = null;
      this.startAt = Math.max(currentTime, finite(message.startAt, currentTime));
      this.beat = Math.max(0, finite(message.offset)) * this.rate;
      this.elapsed = Math.max(0, finite(message.offset));
      this.lastStep = -1;
      for (const { kernel } of this.voices) kernel.exports.reset();
    } else if (message.type === "dispose") {
      this.alive = false;
      this.enabled = false;
      this.voices = [];
      this.ids = [];
      this.module = null;
    }
  }

  advanceGains(frames) {
    for (let index = 0; index < this.ids.length; index += 1) {
      const count = Math.min(frames, this.remaining[index]);
      this.gains[index] += this.deltas[index] * count;
      this.remaining[index] -= count;
      if (this.remaining[index] === 0) this.gains[index] = this.targets[index];
      const toneCount = Math.min(frames, this.toneRemaining[index]);
      this.filters[index] += this.filterDeltas[index] * toneCount;
      this.pans[index] += this.panDeltas[index] * toneCount;
      this.toneRemaining[index] -= toneCount;
      if (this.toneRemaining[index] === 0) {
        this.filters[index] = this.filterTargets[index];
        this.pans[index] = this.panTargets[index];
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    for (const channel of output ?? []) channel.fill(0);
    if (!this.alive) return false;
    if (!output?.[0] || !this.enabled || !this.voices.length) return true;
    const frames = Math.min(BLOCK_SIZE, output[0].length);
    if (currentTime + frames / sampleRate <= this.startAt) return true;
    let offset = Math.max(0, Math.ceil((this.startAt - currentTime) * sampleRate));
    const left = output[0];
    const right = output[1] ?? left;
    try {
      while (offset < frames) {
        if (this.externalClock) {
          const anchor = this.externalClock;
          this.beat = anchor.beat + (currentTime + offset / sampleRate - anchor.audioTime) * anchor.rate;
        }
        this.applyPendingSwing();
        const clock = rubixSimdClock(this.beat, this.rate, this.swing, this.divisions);
        const scorePhase = clock.phase + this.scorePhaseOffset;
        const count = Math.min(frames - offset, Math.max(1, Math.ceil(clock.secondsToNext * sampleRate - 1e-6)));
        const step = ((Math.floor(scorePhase + 1e-9) % this.stepCount) + this.stepCount) % this.stepCount;
        if (step !== this.lastStep) {
          this.lastStep = step;
          this.port.postMessage({ type: "step", step, time: currentTime + offset / sampleRate });
        }
        for (const { kernel, stepIds, baseFilters } of this.voices) {
          const id = stepIds[step];
          if (id < 0 || (this.gains[id] === 0 && this.targets[id] === 0)) continue;
          kernel.params[3] = clock.slope;
          kernel.params[16] = ((scorePhase % this.stepCount) + this.stepCount) % this.stepCount - this.elapsed * clock.slope;
          const filter = this.filters[id] + this.filterDeltas[id] * Math.min(count * 0.5, this.toneRemaining[id]);
          kernel.stepModulation[step * 4 + 1] = baseFilters[step] + filter;
          kernel.exports.process(count, sampleRate, this.elapsed);
          for (let i = 0; i < count; i += 1) {
            const gain = this.gains[id] + this.deltas[id] * Math.min(i + 1, this.remaining[id]);
            const pan = this.pans[id] + this.panDeltas[id] * Math.min(i + 1, this.toneRemaining[id]);
            left[offset + i] += finite(kernel.outputLeft[i]) * gain * this.output * Math.sqrt(1 - pan);
            right[offset + i] += finite(kernel.outputRight[i]) * gain * this.output * Math.sqrt(1 + pan);
          }
        }
        this.advanceGains(count);
        this.beat += count / sampleRate * this.rate;
        this.elapsed += count / sampleRate;
        offset += count;
      }
    } catch (error) {
      for (const channel of output) channel.fill(0);
      this.enabled = false;
      this.port.postMessage({ type: "error", message: error.message });
    }
    if (++this.blocks % 16 === 0) {
      this.port.postMessage({
        type: "status", backend: this.backend, faceCount: this.voices.length,
        step: this.lastStep, beat: this.beat, time: currentTime + frames / sampleRate,
        clockRevision: this.externalClock?.revision ?? null, scorePhaseOffset: this.scorePhaseOffset,
        gates: this.voices.map(({ face, stepIds }) => {
          const index = stepIds[this.lastStep];
          return {
            face, id: this.ids[index] ?? null, gain: this.gains[index] ?? 0, target: this.targets[index] ?? 0,
            filter: this.filters[index] ?? 0, pan: this.pans[index] ?? 0,
          };
        }),
      });
    }
    return true;
  }
}

registerProcessor("morphazoid-rubix-simd-303", RubixSimd303Processor);
