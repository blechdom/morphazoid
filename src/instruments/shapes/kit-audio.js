import { unlockAudioContext } from "../../audio.js";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { DEFAULT_FM_DRUM_VOICES } from "../fm-drums/fm-drums.js";
import { MorphazoidDrumRenderer } from "../../families/percussion/drum-renderer.js";
import { renderRubixExtraDrum, normalizeRubixDrumBuffer, trimRubixDrumBuffer } from "../rubix/rubix-percussion.js";

import { SHAPES_PREPARED_KITS } from "./trigger-banks.js";
const kits = new Map(SHAPES_PREPARED_KITS.map(kit => [kit.id, kit]));
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));
const disconnect = node => { try { node?.disconnect(); } catch { /* already detached */ } };

export function shapesKitVoice(bank, index) {
  const voiceIndex = Math.abs(Math.trunc(Number(index) || 0)) % DEFAULT_FM_DRUM_VOICES.length;
  const voice = DEFAULT_FM_DRUM_VOICES[voiceIndex];
  // Keep mallets/strings in a useful register rather than feeding hat pitches
  // into a string delay. The geometry still tunes continuously around this root.
  const frequency = ["pitched-morph", "karplus-strong"].includes(bank)
    ? clamp(130 * Math.sqrt(voice.frequency / 48), 110, 880) : voice.frequency;
  return { ...voice, voiceIndex, frequency };
}

/** Prepared Morphazoid patches with a bounded live graph. No synthesis, fetch,
 * decoding or async preparation occurs in trigger(). Old fm-kit snapshots use
 * Rubix's softer FM recipe without changing the standalone FM Drums instrument. */
export class ShapesKitAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.output = 0.6;
    this.hostGain = 0;
    this.activeHits = new Set();
    this.buffers = new Map();
    this.generation = 0;
    this.preparation = Promise.resolve();
    this.tokens = 24;
    this.tokenTime = 0;
  }

  async start(bank = "fm-kit") {
    const id = kits.has(bank) ? bank : "fm-kit";
    if (!this.context || this.context.state === "closed") {
      const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is unavailable.");
      this.context = new Context({ latencyHint: "interactive" });
      const context = this.context;
      this.input = context.createDynamicsCompressor();
      Object.assign(this.input.threshold, { value: -14 });
      this.input.knee.value = 12; this.input.ratio.value = 6;
      this.input.attack.value = 0.004; this.input.release.value = 0.12;
      // Last-resort bounded output for dense, deliberately extreme manual scenes.
      this.limiter = context.createWaveShaper();
      this.limiter.curve = Float32Array.from({ length: 2049 }, (_, i) => 0.82 * Math.tanh((i / 1024 - 1) / 0.82));
      this.master = context.createGain(); this.master.gain.value = this.output;
      this.hostGate = context.createGain(); this.hostGate.gain.value = this.hostGain;
      this.analyser = context.createAnalyser(); this.analyser.fftSize = 256;
      this.input.connect(this.limiter).connect(this.master).connect(this.hostGate).connect(this.analyser);
      this.releaseOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });
      this.buffers.clear(); this.tokens = 24; this.tokenTime = context.currentTime;
    }
    const context = this.context;
    // Create/resume from the explicit Audio gesture before any offline work.
    unlockAudioContext(context);
    const resumed = context.state === "suspended" ? context.resume() : Promise.resolve();
    const generation = ++this.generation;
    this.requestedBank = id;
    await resumed;
    if (context !== this.context || generation !== this.generation) return context;
    this.preparation = this.preparation.catch(() => {}).then(async () => {
      if (generation !== this.generation || context !== this.context) return;
      if (!this.buffers.has(id)) {
        const Offline = this.runtime.OfflineAudioContext ?? this.runtime.webkitOfflineAudioContext;
        if (!Offline) throw new Error("Drum preparation is unavailable in this browser.");
        const buffers = [];
        for (let index = 0; index < DEFAULT_FM_DRUM_VOICES.length; index += 1) {
          if (generation !== this.generation || context !== this.context) return;
          const voice = shapesKitVoice(id, index), kit = kits.get(id);
          const seconds = kit.method ? Math.min(3.3, Math.max(0.5, voice.attack + voice.decay * 1.35 + 0.1)) : 1.8;
          const offline = new Offline(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
          let buffer;
          if (kit.method) {
            const noise = offline.createBuffer(1, Math.ceil(context.sampleRate * 3.5), context.sampleRate);
            let seed = 0x51a9 + index;
            const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
            const samples = noise.getChannelData(0);
            for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;
            new MorphazoidDrumRenderer(offline, noise, random)[kit.method](voice, 0, 1, offline.destination);
            buffer = await offline.startRendering();
          } else buffer = await renderRubixExtraDrum(offline, voice, id);
          buffers.push(trimRubixDrumBuffer(context, normalizeRubixDrumBuffer(buffer)));
        }
        if (generation !== this.generation || context !== this.context) return;
        // Two warm kits at most; switching cannot accumulate an unbounded bank.
        while (this.buffers.size >= 2) this.buffers.delete(this.buffers.keys().next().value);
        this.buffers.set(id, buffers);
      }
      this.readyBank = id;
    });
    await this.preparation;
    return context;
  }

  isReady(bank) {
    return this.context?.state === "running" && this.readyBank === bank && this.buffers.has(bank);
  }
  setOutput(value) {
    this.output = clamp(value, 0, 1);
    this.master?.gain.setTargetAtTime(this.output, this.context.currentTime, 0.015);
  }
  setHostGain(value, milliseconds = 30) {
    this.hostGain = clamp(value, 0, 1);
    this.hostGate?.gain.setTargetAtTime(this.hostGain, this.context.currentTime, Math.max(0.003, milliseconds / 3000));
  }
  cancelPreparation() { this.generation += 1; }

  async trigger(voice, { startAt, bank = this.readyBank } = {}) {
    if (!this.isReady(bank)) return { scheduled: false, skipped: true, reason: "preparing" };
    const context = this.context, now = context.currentTime;
    const when = Number.isFinite(startAt) ? startAt : now;
    if (when < now - 0.025) return { scheduled: false, skipped: true, reason: "late" };
    this.tokens = Math.min(24, this.tokens + Math.max(0, now - this.tokenTime) * 128);
    this.tokenTime = now;
    if (this.tokens < 1 || this.activeHits.size >= 64) return { scheduled: false, skipped: true, reason: "budget" };
    this.tokens -= 1;
    const base = shapesKitVoice(bank, voice.voiceIndex), at = Math.max(now, when);
    const source = context.createBufferSource();
    source.buffer = this.buffers.get(bank)[base.voiceIndex];
    const rate = clamp(voice.frequency / base.frequency, 0.25, 4);
    source.playbackRate.value = rate;
    const gain = context.createGain(), filter = context.createBiquadFilter(), pan = context.createStereoPanner();
    const level = clamp(voice.level / base.level, 0, 1) * 0.7 / Math.sqrt(1 + this.activeHits.size * 0.12);
    const duration = source.buffer.duration / rate, end = at + duration;
    // Baked attack remains intact; these tiny guards prevent discontinuities
    // during rate changes and early cancellation, not a second musical ADSR.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.002);
    gain.gain.setValueAtTime(level, Math.max(at + 0.002, end - 0.015));
    gain.gain.linearRampToValueAtTime(0, end);
    filter.type = "lowpass"; filter.Q.value = 0.6;
    filter.frequency.value = Math.min(context.sampleRate * 0.44, 1000 * 12 ** clamp(voice.tone, 0, 1));
    pan.pan.value = clamp(voice.pan, -1, 1);
    source.connect(filter).connect(gain).connect(pan).connect(this.input);
    const hit = { source, gain, filter, pan, startsAt: at, stopAt: end, stopping: false };
    this.activeHits.add(hit);
    source.onended = () => this.cleanup(hit);
    source.start(at); source.stop(end + 0.005);
    return { scheduled: true, skipped: false };
  }
  cleanup(hit) {
    if (!this.activeHits.delete(hit)) return;
    for (const node of [hit.source, hit.gain, hit.filter, hit.pan]) disconnect(node);
  }
  release(hit, now) {
    if (hit.stopping) return;
    hit.stopping = true;
    if (hit.startsAt > now) {
      hit.gain.gain.cancelScheduledValues(now); hit.gain.gain.setValueAtTime(0, now);
      try { hit.source.stop(now); } catch { /* ended */ }
      this.cleanup(hit);
    } else {
      const param = hit.gain.gain;
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
      else { const current = param.value; param.cancelScheduledValues(now); param.setValueAtTime(current, now); }
      param.linearRampToValueAtTime(0, now + 0.015);
      try { hit.source.stop(now + 0.02); } catch { /* ended */ }
    }
  }
  cancelScheduledHits() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const hit of [...this.activeHits]) if (hit.startsAt > now) this.release(hit, now);
  }
  silence() {
    if (!this.context) return;
    for (const hit of [...this.activeHits]) this.release(hit, this.context.currentTime);
  }
  async close() {
    this.cancelPreparation(); this.silence();
    const context = this.context; this.context = null; this.readyBank = null;
    this.releaseOutput?.(); this.releaseOutput = null;
    for (const hit of [...this.activeHits]) this.cleanup(hit);
    for (const key of ["input", "limiter", "master", "hostGate", "analyser"]) { disconnect(this[key]); this[key] = null; }
    this.buffers.clear();
    if (context && context.state !== "closed") await context.close();
  }
}
