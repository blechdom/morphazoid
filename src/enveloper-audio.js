import { GraphSynthAudio } from "./graph-synth-audio.js";

export const ENVELOPER_AUDIO_LIMITS = Object.freeze({
  minDurationSeconds: 0.025,
  maxDurationSeconds: 16,
  minFrequencyHz: 20,
  maxFrequencyHz: 20_000,
  maxModulationIndex: 12,
  minModulationRatio: 0.125,
  maxModulationRatio: 8,
});

const DEFAULT_LEVEL = 0.58;

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)));
}

/**
 * Convert one derived leaf event into the Graph Synth voice and ADSR contracts.
 * Gate plus release always equals the bounded timeline duration, so a leaf owns
 * exactly its allotted interval even when that interval becomes very short.
 */
export function deriveEnveloperLeafTrigger(event = {}) {
  const source = event && typeof event === "object" ? event : {};
  const limits = ENVELOPER_AUDIO_LIMITS;
  const durationSeconds = clamp(
    source.durationSeconds,
    limits.minDurationSeconds,
    limits.maxDurationSeconds,
    0.5,
  );
  const frequencyHz = clamp(
    source.frequencyHz,
    limits.minFrequencyHz,
    limits.maxFrequencyHz,
    220,
  );
  const timbre = clamp(source.timbre, 0, 1, 0.5);
  const amplitude = clamp(source.amplitude, 0, 1, 0.28);
  const modulationIndex = clamp(
    source.modulationIndex,
    0,
    limits.maxModulationIndex,
    8 * timbre * timbre,
  );
  const modulationRatio = clamp(
    source.modulationRatio,
    limits.minModulationRatio,
    limits.maxModulationRatio,
    2,
  );
  const brightness = clamp(
    source.brightness,
    0,
    1,
    0.35 + 0.65 * timbre,
  );

  // The minimum duration leaves room for GraphSynthAudio's 15 ms minimum
  // decay, while longer notes receive a compact attack and release cap.
  const releaseSeconds = Math.min(0.1, Math.max(0.006, durationSeconds * 0.16));
  const gateSeconds = durationSeconds - releaseSeconds;
  const attackSeconds = Math.min(0.012, Math.max(0.001, gateSeconds * 0.18));
  const decaySeconds = Math.min(
    0.08,
    Math.max(0.015, gateSeconds * 0.28),
    gateSeconds - attackSeconds,
  );

  return Object.freeze({
    voice: Object.freeze({
      leafId: source.leafId ?? source.id ?? null,
      mode: "fm",
      waveform: "sine",
      frequency: frequencyHz,
      frequencyHz,
      gain: amplitude,
      amplitude,
      pan: clamp(source.pan, -1, 1, 0),
      timbre,
      modulationIndex,
      modulationRatio,
      brightness,
      filterQ: clamp(source.filterQ, 0.1, 18, 0.7),
      durationSeconds,
    }),
    envelope: Object.freeze({
      attackSeconds,
      decaySeconds,
      gateSeconds,
      sustainLevel: clamp(source.sustainLevel, 0, 1, 0.64),
      releaseSeconds,
    }),
  });
}

/** A thin, transport-oriented facade over Morphazoid's one-shot FM renderer. */
export class EnveloperAudio {
  constructor(runtime = globalThis, { engine = null } = {}) {
    this.engine = engine ?? new GraphSynthAudio(runtime);
    this.level = DEFAULT_LEVEL;
    this.engine.setOutput?.(this.level);
  }

  get context() {
    return this.engine.context ?? null;
  }

  get currentTime() {
    return finite(this.context?.currentTime, 0);
  }

  get contextState() {
    return this.context?.state ?? "closed";
  }

  get engineRunning() {
    return this.contextState === "running";
  }

  async start() {
    // GraphSynthAudio creates/resumes its context synchronously up to the first
    // await, so callers should invoke this directly from the Audio button tap.
    const context = await this.engine.start();
    this.engine.setOutput?.(this.level);
    return context;
  }

  setLevel(value) {
    this.level = clamp(value, 0, 1, 0);
    this.engine.setOutput?.(this.level);
    return this.level;
  }

  /**
   * Schedule one leaf on the absolute AudioContext timeline. The second
   * argument accepts either a number or `{ startAt }` for convenient callers.
   */
  triggerLeaf(event, startAtOrOptions = event?.startAt) {
    const startAt = startAtOrOptions && typeof startAtOrOptions === "object"
      ? startAtOrOptions.startAt
      : startAtOrOptions;
    const trigger = deriveEnveloperLeafTrigger(event);
    if (!this.engineRunning) {
      return Promise.resolve(Object.freeze({
        ...trigger.voice,
        startAt: finite(startAt, this.currentTime),
        scheduled: false,
        skipReason: "audio-not-running",
      }));
    }
    return this.engine.trigger(trigger.voice, {
      ...trigger.envelope,
      startAt: finite(startAt, this.currentTime),
    });
  }

  silence() {
    return this.engine.silence?.();
  }

  async close() {
    await this.engine.close?.();
  }
}
