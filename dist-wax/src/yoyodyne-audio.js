import { GraphSynthAudio } from "./graph-synth-audio.js";
import {
  YOYODYNE_LIMITS,
  clampYoyodyne,
  midiToFrequency,
  sanitizeYoyodyneNotes,
} from "./yoyodyne.js";

export const YOYODYNE_AUDIO_LIMITS = Object.freeze({
  minimumDurationSeconds: 0.06,
  maximumDurationSeconds: 4.8,
  previewDurationSeconds: 0.18,
  maximumModulationIndex: 1,
  maximumScoreGainSum: 0.72,
});

export const YOYODYNE_RELAY_VOICES = Object.freeze({
  throat: Object.freeze({
    label: "throat",
    pan: -0.12,
    trim: 1,
    dryMix: 0.25,
    peaks: Object.freeze([
      Object.freeze({ frequency: 430, q: 4.5, weight: 0.48 }),
      Object.freeze({ frequency: 1_000, q: 6.5, weight: 0.27 }),
    ]),
  }),
  mouth: Object.freeze({
    label: "mouth",
    pan: 0,
    trim: 0.94,
    dryMix: 0.18,
    peaks: Object.freeze([
      Object.freeze({ frequency: 640, q: 5, weight: 0.52 }),
      Object.freeze({ frequency: 1_320, q: 7.5, weight: 0.3 }),
    ]),
  }),
  halo: Object.freeze({
    label: "halo",
    pan: 0.12,
    trim: 0.8,
    dryMix: 0.12,
    peaks: Object.freeze([
      Object.freeze({ frequency: 330, q: 6.5, weight: 0.34 }),
      Object.freeze({ frequency: 2_160, q: 9.5, weight: 0.54 }),
    ]),
  }),
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function frequencyAtCents(frequency, cents) {
  return clampYoyodyne(
    frequency * 2 ** (finite(cents, 0) / 1_200),
    20,
    20_000,
    frequency,
  );
}

function triggerGain(note = {}, { preview = false } = {}) {
  const energy = clampYoyodyne(note.energy, 0.2, 1, 0.7);
  const profile = YOYODYNE_RELAY_VOICES[note.voiceRole] ?? YOYODYNE_RELAY_VOICES.mouth;
  return (0.16 + energy * 0.12) * profile.trim * (preview ? 0.82 : 1);
}

function resonancePeaks(profile, character) {
  const frequencyScale = 0.92 + character * 0.16;
  const qScale = 0.76 + character * 0.5;
  return Object.freeze(profile.peaks.map((peak) => Object.freeze({
    frequency: peak.frequency * frequencyScale,
    q: peak.q * qScale,
    weight: peak.weight,
  })));
}

export function yoyodyneScoreGainScale(notes = []) {
  const events = sanitizeYoyodyneNotes(notes).flatMap((note) => {
    const gain = triggerGain(note);
    return [
      { beat: note.startBeat, gain },
      { beat: note.startBeat + note.durationBeats, gain: -gain },
    ];
  });
  events.sort((left, right) => left.beat - right.beat || left.gain - right.gain);

  let activeGain = 0;
  let maximumGain = 0;
  for (const event of events) {
    activeGain = Math.max(0, activeGain + event.gain);
    maximumGain = Math.max(maximumGain, activeGain);
  }
  if (maximumGain <= YOYODYNE_AUDIO_LIMITS.maximumScoreGainSum) return 1;
  return YOYODYNE_AUDIO_LIMITS.maximumScoreGainSum / maximumGain;
}

export function deriveYoyodyneTrigger(note = {}, {
  tempo = 96,
  character = 0.42,
  preview = false,
  gainScale = 1,
} = {}) {
  const safeTempo = clampYoyodyne(
    tempo,
    YOYODYNE_LIMITS.minimumTempo,
    YOYODYNE_LIMITS.maximumTempo,
    96,
  );
  const baseFrequency = midiToFrequency(note.pitch);
  const safeCharacter = clampYoyodyne(character, 0, 1, 0.42);
  const profile = YOYODYNE_RELAY_VOICES[note.voiceRole] ?? YOYODYNE_RELAY_VOICES.mouth;
  const scoreDuration = clampYoyodyne(
    finite(note.durationBeats, 0.75) * 60 / safeTempo,
    YOYODYNE_AUDIO_LIMITS.minimumDurationSeconds,
    YOYODYNE_AUDIO_LIMITS.maximumDurationSeconds,
    0.45,
  );
  const durationSeconds = preview
    ? YOYODYNE_AUDIO_LIMITS.previewDurationSeconds
    : scoreDuration;
  const releaseSeconds = Math.min(0.12, Math.max(0.025, durationSeconds * 0.18));
  const gateSeconds = Math.max(0.025, durationSeconds - releaseSeconds);
  const attackSeconds = Math.min(0.012, Math.max(0.002, gateSeconds * 0.08));
  const decaySeconds = Math.min(0.07, Math.max(0.015, gateSeconds * 0.2));
  const bends = Array.isArray(note.bendCents) ? note.bendCents : [0, 0, 0];
  const frequencyEnvelope = Object.freeze([0, 0.5, 1].map((time, index) => Object.freeze({
    time,
    value: frequencyAtCents(baseFrequency, bends[index]),
  })));
  const safeGainScale = clampYoyodyne(gainScale, 0, 1, 1);

  return Object.freeze({
    voice: Object.freeze({
      cellId: String(note.id ?? ""),
      mode: "fm",
      waveform: "sawtooth",
      voiceRole: profile.label,
      frequency: baseFrequency,
      frequencyEnvelope,
      gain: triggerGain(note, { preview }) * safeGainScale,
      pan: clampYoyodyne(
        profile.pan + (finite(note.pitch, 60) - 60) / 180,
        -0.3,
        0.3,
        profile.pan,
      ),
      modulationIndex: 0.06
        + safeCharacter * safeCharacter * (YOYODYNE_AUDIO_LIMITS.maximumModulationIndex - 0.06),
      modulationRatio: 1.5 + safeCharacter * 0.75,
      brightness: 0.62 + safeCharacter * 0.25,
      filterQ: 0.45 + safeCharacter * 0.85,
      dryMix: profile.dryMix * (1 - safeCharacter * 0.22),
      resonancePeaks: resonancePeaks(profile, safeCharacter),
      durationSeconds,
    }),
    envelope: Object.freeze({
      attackSeconds,
      decaySeconds,
      gateSeconds,
      sustainLevel: 0.72,
      releaseSeconds,
    }),
  });
}

export class YoyodyneAudio {
  constructor(runtime = globalThis, { engine = null } = {}) {
    this.engine = engine ?? new GraphSynthAudio(runtime);
    this.level = 0.34;
    this.engine.setOutput?.(this.level);
  }

  get context() {
    return this.engine.context ?? null;
  }

  get currentTime() {
    return finite(this.context?.currentTime, 0);
  }

  get running() {
    return this.context?.state === "running";
  }

  async arm() {
    const context = await this.engine.start();
    this.engine.setOutput?.(this.level);
    return context;
  }

  setLevel(value) {
    this.level = clampYoyodyne(value, 0, 0.8, 0.34);
    this.engine.setOutput?.(this.level);
    return this.level;
  }

  schedule(note, {
    startAt = this.currentTime,
    tempo = 96,
    character = 0.42,
    gainScale = 1,
  } = {}) {
    const trigger = deriveYoyodyneTrigger(note, { tempo, character, gainScale });
    if (!this.running) {
      return Promise.resolve(Object.freeze({
        ...trigger.voice,
        scheduled: false,
        skipReason: "audio-not-running",
      }));
    }
    return this.engine.trigger(trigger.voice, {
      ...trigger.envelope,
      startAt: finite(startAt, this.currentTime),
    });
  }

  preview(note, { character = 0.42 } = {}) {
    const trigger = deriveYoyodyneTrigger(note, { character, preview: true });
    if (!this.running) {
      return Promise.resolve(Object.freeze({
        ...trigger.voice,
        scheduled: false,
        skipReason: "audio-not-running",
      }));
    }
    return this.engine.trigger(trigger.voice, {
      ...trigger.envelope,
      startAt: this.currentTime + 0.008,
    });
  }

  cancelScheduled() {
    return this.engine.cancelScheduled?.() ?? 0;
  }

  silence() {
    this.engine.silence?.();
  }

  async close() {
    await this.engine.close?.();
  }
}
