import { DEFAULT_FM_DRUM_VOICES } from "../fm-drums/fm-drums.js";
import { generateKarplusStrongSamples } from "../karplus-strong/karplus-strong.js";
import { crossesPeriodicTarget, crossesPingPongTarget } from "../../articulation.js";
import { wrap01 } from "../../geometry.js";
import { horizontalProbe, probeHits, verticalProbe } from "./geometry.js";
import { arclength, clippedItem, pointAlongRun, readerRegion, regionCenter } from "./readers.js";

const TAU = Math.PI * 2;

export const ROW_ROLES = Object.freeze(["contour", "drums"]);
export const DRUM_PLACEMENTS = Object.freeze(["x", "y", "xy", "equidistant"]);
export const DRUM_COUNT = Object.freeze({ min: 1, max: 64, default: 8 });
export const DRUM_PITCH = Object.freeze({ min: 0, max: 24, default: 0 });
export const DRUM_VOICES = DEFAULT_FM_DRUM_VOICES;
/** Pitched strikes: their frequency follows the trigger's height across the box over the Pitch range, like a contour. */
export const PITCHED_VOICES = Object.freeze([
  Object.freeze({ id: "pluck", name: "Pluck (Karplus-Strong)", kind: "pluck" }),
  Object.freeze({ id: "rattle", name: "Rattlesnake", kind: "rattle" }),
  Object.freeze({ id: "bar", name: "Marimba Bar", kind: "bar" }),
  Object.freeze({ id: "chime-fm", name: "FM Chime", kind: "chime" }),
  Object.freeze({ id: "zap", name: "Pitched Zap", kind: "zap" }),
]);
export const TRIGGER_VOICE_GROUPS = Object.freeze([
  Object.freeze({ label: "Pitched (height sets the note)", voices: PITCHED_VOICES }),
  Object.freeze({ label: "Drum kit", voices: DRUM_VOICES }),
]);
export const isPitchedVoice = (id) => PITCHED_VOICES.some((voice) => voice.id === id);
export const DRUM_DEFAULTS = Object.freeze({ placement: "x", count: DRUM_COUNT.default, voice: DRUM_VOICES[0].id, pitch: DRUM_PITCH.default });

export function sanitizeDrum(drum) {
  const source = drum && typeof drum === "object" ? drum : {};
  const count = Number(source.count);
  const pitch = Number(source.pitch);
  return {
    placement: DRUM_PLACEMENTS.includes(source.placement) ? source.placement : DRUM_DEFAULTS.placement,
    count: Number.isFinite(count) ? Math.min(DRUM_COUNT.max, Math.max(DRUM_COUNT.min, Math.round(count))) : DRUM_DEFAULTS.count,
    voice: DRUM_VOICES.some((voice) => voice.id === source.voice) || isPitchedVoice(source.voice) ? source.voice : DRUM_DEFAULTS.voice,
    pitch: Number.isFinite(pitch) ? Math.min(DRUM_PITCH.max, Math.max(DRUM_PITCH.min, Math.round(pitch))) : DRUM_DEFAULTS.pitch,
  };
}

export const drumVoiceById = (id) => DRUM_VOICES.find((voice) => voice.id === id) ?? DRUM_VOICES[0];

/** Branch index and 0..1 arclength fraction of the run point nearest (x, y). */
export function arcFractionAt(item, x, y) {
  const { runs } = arclength(item);
  let best = null;
  runs.forEach((run, branch) => {
    const { segment, lengths } = run;
    for (let i = 2; i < segment.length; i += 2) {
      const ax = segment[i - 2], ay = segment[i - 1], bx = segment[i], by = segment[i + 1];
      const dx = bx - ax, dy = by - ay;
      const span = dx * dx + dy * dy;
      const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / span)) : 0;
      const distance = Math.hypot(ax + t * dx - x, ay + t * dy - y);
      if (!best || distance < best.distance) {
        const local = lengths[i / 2 - 1] + t * (lengths[i / 2] - lengths[i / 2 - 1]);
        best = { distance, branch, s: lengths[lengths.length - 1] > 0 ? local / lengths[lengths.length - 1] : 0 };
      }
    }
  });
  return best ? { branch: best.branch, s: best.s } : null;
}

/**
 * Where a drum row's triggers sit: at the curve's crossings of x and/or y grid subdivisions of the
 * reader box, or equally spaced along each branch inside it. Each trigger knows its branch and
 * arclength fraction so Points heads can reach it too.
 */
export function rowTriggers(item, drum, settings, view) {
  const region = readerRegion(settings, view);
  const clipped = clippedItem(item, settings, view);
  if (!clipped.segments.length) return [];
  const triggers = [];
  const push = (x, y, index) => {
    const along = arcFractionAt(clipped, x, y);
    if (along) triggers.push({ id: `${item.id}:${index}`, index, x, y, branch: along.branch, s: along.s });
  };
  if (drum.placement === "equidistant") {
    const { runs } = arclength(clipped);
    runs.forEach((run, branch) => {
      for (let k = 0; k < drum.count; k++) {
        const point = pointAlongRun(clipped, branch, (k + 0.5) / drum.count);
        if (point) triggers.push({ id: `${item.id}:${branch}:${k}`, index: k, x: point.x, y: point.y, branch, s: (k + 0.5) / drum.count });
      }
    });
    return triggers;
  }
  let index = 0;
  if (drum.placement === "x" || drum.placement === "xy") {
    for (let k = 0; k < drum.count; k++) {
      const x = region.xMin + (k / drum.count) * (region.xMax - region.xMin);
      for (const entry of probeHits([clipped], verticalProbe(x, region))) for (const hit of entry.hits) push(hit.x, hit.y, index++);
    }
  }
  if (drum.placement === "y" || drum.placement === "xy") {
    for (let k = 0; k < drum.count; k++) {
      const y = region.yMax - (k / drum.count) * (region.yMax - region.yMin);
      for (const entry of probeHits([clipped], horizontalProbe(y, region))) for (const hit of entry.hits) push(hit.x, hit.y, index++);
    }
  }
  return triggers;
}

/** The reader phase at which a head meets a trigger, in the head's own travel units. */
export function triggerPhase(trigger, settings, view, head) {
  const region = readerRegion(settings, view);
  if (settings.playback === "line") {
    if (head.guide.axis === "horizontal") return (region.yMax - trigger.y) / (region.yMax - region.yMin);
    return (trigger.x - region.xMin) / (region.xMax - region.xMin);
  }
  if (settings.playback === "radar") {
    const center = regionCenter(settings, view);
    return wrap01((Math.PI / 2 - Math.atan2(trigger.y - center.y, trigger.x - center.x)) / TAU);
  }
  return trigger.s;
}

/** Triggers each head passed between two readings, in reading order. */
export function crossedTriggers(triggers, settings, view, previousHeads, heads) {
  const fired = [];
  if (!previousHeads || !triggers.length) return fired;
  for (const head of heads) {
    const previous = previousHeads[head.index];
    if (!previous || previous.travel === head.travel) continue;
    for (const trigger of triggers) {
      const target = triggerPhase(trigger, settings, view, head);
      if (!Number.isFinite(target) || target < -1e-9 || target > 1 + 1e-9) continue;
      const crossed = settings.motion === "pingpong"
        ? crossesPingPongTarget(previous.travel, head.travel, target)
        : crossesPeriodicTarget(previous.travel, head.travel, target);
      if (crossed) fired.push({ trigger, head: head.index });
    }
  }
  return fired;
}

/** Frequency of a pitched strike: the contour mapping, 220 Hz rising over the Pitch range with height. */
export function pitchedTriggerFrequency(trigger, settings, view, baseHz = 220) {
  const region = readerRegion(settings, view);
  const height = Math.min(1, Math.max(0, (trigger.y - region.yMin) / (region.yMax - region.yMin)));
  return baseHz * 2 ** ((settings.traceOctaves ?? 2) * height);
}

/** Short pitched strikes rendered on the shared context: plucks, rattles, bars, chimes and zaps. */
export class PitchedPercussion {
  constructor(context, destination) {
    this.context = context;
    this.destination = destination;
    this.pluckCache = new Map();
  }

  trigger(kind, frequency, { pan = 0, level = 0.5, when = this.context.currentTime } = {}) {
    const context = this.context;
    const out = context.createGain();
    out.gain.value = level;
    const panner = context.createStereoPanner ? context.createStereoPanner() : null;
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); out.connect(panner); panner.connect(this.destination); } else out.connect(this.destination);
    const hz = Math.min(8000, Math.max(30, frequency));
    const stopAt = kind === "pluck" ? this.pluck(out, hz, when) : kind === "rattle" ? this.rattle(out, hz, when) : kind === "bar" ? this.bar(out, hz, when) : kind === "chime" ? this.chime(out, hz, when) : this.zap(out, hz, when);
    setTimeout(() => { try { out.disconnect(); panner?.disconnect(); } catch { /* released */ } }, Math.max(50, (stopAt - context.currentTime) * 1000 + 100));
    return stopAt;
  }

  pluck(out, hz, when) {
    const key = Math.round(hz);
    if (!this.pluckCache.has(key)) {
      const samples = generateKarplusStrongSamples({ sampleRate: this.context.sampleRate, frequency: hz, decay: 1.6, brightness: 0.7, damping: 0.4 });
      const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.pluckCache.set(key, buffer);
      if (this.pluckCache.size > 64) this.pluckCache.delete(this.pluckCache.keys().next().value);
    }
    const source = this.context.createBufferSource();
    source.buffer = this.pluckCache.get(key);
    source.connect(out);
    source.start(when);
    return when + source.buffer.duration;
  }

  rattle(out, hz, when) {
    const context = this.context;
    const length = Math.ceil(context.sampleRate * 0.35);
    const noise = context.createBuffer(1, length, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    const source = context.createBufferSource();
    source.buffer = noise;
    const band = context.createBiquadFilter();
    band.type = "bandpass"; band.Q.value = 18;
    band.frequency.setValueAtTime(hz * 1.6, when);
    band.frequency.exponentialRampToValueAtTime(hz, when + 0.12);
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(1.6, when + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    source.connect(band); band.connect(env); env.connect(out);
    source.start(when); source.stop(when + 0.36);
    return when + 0.36;
  }

  bar(out, hz, when) {
    const context = this.context;
    const partials = [[1, 1, 1.1], [3.93, 0.45, 0.45], [9.54, 0.22, 0.25]];
    let end = when;
    for (const [ratio, gain, decay] of partials) {
      if (hz * ratio > context.sampleRate * 0.45) continue;
      const osc = context.createOscillator();
      osc.type = "sine"; osc.frequency.value = hz * ratio;
      const env = context.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(gain * 0.8, when + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      osc.connect(env); env.connect(out);
      osc.start(when); osc.stop(when + decay + 0.02);
      end = Math.max(end, when + decay + 0.02);
    }
    return end;
  }

  chime(out, hz, when) {
    const context = this.context;
    const carrier = context.createOscillator(), modulator = context.createOscillator(), index = context.createGain(), env = context.createGain();
    carrier.frequency.value = hz; modulator.frequency.value = hz * 1.41;
    index.gain.setValueAtTime(hz * 2.5, when); index.gain.exponentialRampToValueAtTime(hz * 0.05, when + 0.6);
    modulator.connect(index); index.connect(carrier.frequency);
    env.gain.setValueAtTime(0.0001, when); env.gain.exponentialRampToValueAtTime(0.7, when + 0.003); env.gain.exponentialRampToValueAtTime(0.0001, when + 1.2);
    carrier.connect(env); env.connect(out);
    carrier.start(when); modulator.start(when); carrier.stop(when + 1.25); modulator.stop(when + 1.25);
    return when + 1.25;
  }

  zap(out, hz, when) {
    const context = this.context;
    const osc = context.createOscillator(), env = context.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(hz * 4, when); osc.frequency.exponentialRampToValueAtTime(hz, when + 0.09);
    const filter = context.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.setValueAtTime(hz * 6, when); filter.frequency.exponentialRampToValueAtTime(hz * 1.5, when + 0.15);
    env.gain.setValueAtTime(0.0001, when); env.gain.exponentialRampToValueAtTime(0.6, when + 0.002); env.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    osc.connect(filter); filter.connect(env); env.connect(out);
    osc.start(when); osc.stop(when + 0.25);
    return when + 0.25;
  }
}

/** The kit voice for a trigger, bent by the trigger's height across the box when the row asks for it. */
export function triggerVoice(drum, trigger, settings, view) {
  const base = drumVoiceById(drum.voice);
  if (!drum.pitch) return { ...base };
  const region = readerRegion(settings, view);
  const height = Math.min(1, Math.max(0, (trigger.y - region.yMin) / (region.yMax - region.yMin)));
  const semitones = (height - 0.5) * 2 * drum.pitch;
  return { ...base, frequency: Math.min(12000, Math.max(20, base.frequency * 2 ** (semitones / 12))) };
}
