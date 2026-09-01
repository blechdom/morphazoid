import { FmDrumAudio } from "./fm-drums.js";
import { KARPLUS_STRONG_PRESETS } from "./karplus-strong.js";
import {
  L_SYSTEM_DRUM_STYLES,
  styledLSystemDrumVoice,
} from "./l-system-drums.js";
import { LinearDrumAudio } from "./linear-drums.js";

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
};

const KARPLUS_STYLE_BANKS = Object.freeze({
  "karplus-strong": Object.freeze({
    label: "Karplus Strong",
    presets: Object.freeze(["bass", "nylon", "steel", "glass"]),
  }),
  "karplus-tines": Object.freeze({
    label: "Karplus tines",
    presets: Object.freeze(["muted", "kalimba", "banjo", "rubber"]),
  }),
  "karplus-objects": Object.freeze({
    label: "Karplus objects",
    presets: Object.freeze(["prepared", "jawari", "inverted", "frozen"]),
  }),
});

const KARPLUS_PRESET_BY_ID = new Map(
  KARPLUS_STRONG_PRESETS.map((preset) => [preset.id, preset]),
);

export const GRAPH_DRUM_PERCUSSION_STYLES = Object.freeze([
  ...L_SYSTEM_DRUM_STYLES.map((style) => Object.freeze({ ...style, engine: "fm" })),
  Object.freeze({
    id: "rattlesnake-physical",
    label: "Rattlesnake physical",
    engine: "rattlesnake",
  }),
  ...Object.entries(KARPLUS_STYLE_BANKS).map(([id, bank]) => Object.freeze({
    id,
    label: bank.label,
    engine: "karplus-strong",
  })),
]);

const STYLE_BY_ID = new Map(
  GRAPH_DRUM_PERCUSSION_STYLES.map((style) => [style.id, style]),
);

export const MAX_GRAPH_KARPLUS_ATTACKS_PER_FRAME = 4;
export const MAX_GRAPH_PHYSICAL_ATTACKS_PER_FRAME = 24;
export const MAX_GRAPH_FM_ATTACKS_PER_SECOND = 240;
export const MAX_GRAPH_KARPLUS_ATTACKS_PER_SECOND = 24;
export const MAX_GRAPH_RATTLESNAKE_ATTACKS_PER_SECOND = 240;

export function sanitizeGraphDrumPercussionStyle(style) {
  return STYLE_BY_ID.has(style) ? style : "drum-bank";
}

export function graphDrumStyleIsKarplus(style) {
  return Boolean(KARPLUS_STYLE_BANKS[sanitizeGraphDrumPercussionStyle(style)]);
}

export function graphDrumStyleUsesPhysicalEngine(style) {
  const safeStyle = sanitizeGraphDrumPercussionStyle(style);
  return safeStyle === "rattlesnake-physical" || graphDrumStyleIsKarplus(safeStyle);
}

/** Rattlesnake voices use graph-rooted pitch instead of categorical bank tuning. */
export function graphDrumStyleUsesContinuousPitch(style) {
  const safeStyle = sanitizeGraphDrumPercussionStyle(style);
  return safeStyle === "rattlesnake" || safeStyle === "rattlesnake-physical";
}

export function graphDrumPercussionVoice(sourceVoice = {}, { style } = {}) {
  const percussionStyle = sanitizeGraphDrumPercussionStyle(style);
  const voiceIndex = Math.round(clamp(sourceVoice.voiceIndex, 0, 15, 0));
  const bank = KARPLUS_STYLE_BANKS[percussionStyle];
  if (percussionStyle === "rattlesnake-physical") {
    const voice = styledLSystemDrumVoice(sourceVoice, { style: "rattlesnake" });
    return {
      ...voice,
      name: `Physical ${voice.name ?? "Rattle"}`,
      percussionStyle,
    };
  }
  if (!bank) {
    const styledVoice = styledLSystemDrumVoice(sourceVoice, { style: percussionStyle });
    return {
      ...styledVoice,
      // The Graph default is Circuit, but graph arrivals need enough overlap
      // to read as a connected network instead of isolated micro-clicks.
      decay: percussionStyle === "circuit"
        ? clamp((Number(styledVoice.decay) || 0.1) * 2.4, 0.12, 0.6, 0.24)
        : styledVoice.decay,
      percussionStyle,
    };
  }

  const presetId = bank.presets.includes(sourceVoice.karplusPresetId)
    ? sourceVoice.karplusPresetId
    : bank.presets[Math.floor(voiceIndex / 4)] ?? bank.presets[0];
  const preset = KARPLUS_PRESET_BY_ID.get(presetId) ?? KARPLUS_STRONG_PRESETS[0];
  return {
    ...sourceVoice,
    name: preset.name,
    family: "karplus",
    percussionStyle,
    karplusPresetId: preset.id,
    voiceIndex,
  };
}

export function graphDrumTriggerPlan(sourceVoice = {}, { style } = {}) {
  const percussionStyle = sanitizeGraphDrumPercussionStyle(
    style ?? sourceVoice.percussionStyle,
  );
  const frequency = clamp(sourceVoice.frequency, 20, 16_000, 60);
  const velocity = clamp(sourceVoice.level ?? sourceVoice.gain, 0.001, 1, 0.7);
  if (!["rattlesnake-physical", ...Object.keys(KARPLUS_STYLE_BANKS)].includes(percussionStyle)) {
    return Object.freeze({
      engine: "fm",
      frequency,
      percussionStyle,
      velocity,
      voice: sourceVoice,
    });
  }

  const karplusBank = KARPLUS_STYLE_BANKS[percussionStyle];
  const voiceIndex = Math.round(clamp(sourceVoice.voiceIndex, 0, 15, 0));
  const tone = clamp(sourceVoice.tone, 0, 1, 0.5);
  const noise = clamp(sourceVoice.noise, 0, 1, 0.2);
  const modulation = clamp(sourceVoice.modIndex, 0, 20, 3) / 20;
  const ratio = clamp(sourceVoice.modRatio, 0.25, 8, 1) / 8;
  const karplusPresetId = karplusBank
    ? karplusBank.presets.includes(sourceVoice.karplusPresetId)
      ? sourceVoice.karplusPresetId
      : karplusBank.presets[Math.floor(voiceIndex / 4)] ?? karplusBank.presets[0]
    : null;
  const settings = {
    rangeMin: 20,
    rangeMax: 16_000,
    attack: clamp(sourceVoice.attack, 0.001, 0.025, 0.002),
    decay: karplusBank
      ? clamp(0.04 + clamp(sourceVoice.decay, 0.02, 4, 0.2) * 0.015, 0.04, 0.1)
      : clamp(sourceVoice.decay, 0.04, 1.4, 0.28),
    pitchFall: karplusBank ? 0 : clamp(Math.abs(Number(sourceVoice.pitchBend) || 0), 0, 2),
    strikeNoise: clamp(noise * 1.15 + 0.08, 0, 1.6),
    brightness: tone,
    inharmonicity: clamp(ratio * 0.55 + modulation * 0.45),
    hardness: clamp(0.18 + modulation * 0.62 + tone * 0.2),
    model: karplusBank ? "karplus-strong" : "hybrid",
    // Repeat the selected material across the frequency morph so the map label
    // and the rendered string always describe the same physical preset.
    karplusMorphOrder: karplusBank
      ? Object.freeze(Array(4).fill(karplusPresetId))
      : undefined,
  };
  return Object.freeze({
    engine: karplusBank ? "karplus-strong" : "rattlesnake",
    frequency,
    percussionStyle,
    velocity,
    performanceY: 1 - Math.floor(voiceIndex / 4) / 3,
    settings: Object.freeze(settings),
    voice: sourceVoice,
  });
}

export function translateGraphDrumStartAt(startAt, sourceContext, targetContext) {
  const requested = Number(startAt);
  if (!Number.isFinite(requested)) return undefined;
  const sourceNow = Number(sourceContext?.currentTime) || 0;
  const targetNow = Number(targetContext?.currentTime) || 0;
  return targetNow + Math.max(0, requested - sourceNow);
}

function cancelledGraphDrumStart() {
  const error = new Error("Graph Drum audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * Preserve the established FM bank and one graph clock while routing the real
 * Rattlesnake and Karplus models through their existing physical engine.
 */
export class GraphDrumAudio {
  constructor(runtime = globalThis, { fmAudio, physicalAudio } = {}) {
    this.runtime = runtime;
    this.fmAudio = fmAudio ?? new FmDrumAudio(runtime);
    this.physicalAudio = physicalAudio ?? new LinearDrumAudio(runtime);
    this.context = null;
    this.analyser = null;
    this.output = 0.58;
    this.startPromise = null;
    this.lifecycleGeneration = 0;
    this.fmAttackTimes = [];
    this.karplusAttackTimes = [];
    this.rattlesnakeAttackTimes = [];
  }

  async start() {
    if (
      this.context
      && this.context === this.fmAudio.context
      && this.context.state === "running"
      && this.physicalAudio.context?.state === "running"
    ) return this.context;
    if (this.startPromise) return this.startPromise;
    const previousClock = this.context;
    const lifecycleGeneration = ++this.lifecycleGeneration;
    const startPromise = (async () => {
      try {
        const [fmContext, physicalContext] = await Promise.all([
          this.fmAudio.start(),
          this.physicalAudio.start(),
        ]);
        if (lifecycleGeneration !== this.lifecycleGeneration) {
          throw cancelledGraphDrumStart();
        }
        if (
          (fmContext?.state && fmContext.state !== "running")
          || (physicalContext?.state && physicalContext.state !== "running")
        ) throw new Error("Graph Drum audio could not resume both sound engines.");
        if (fmContext !== previousClock) {
          this.fmAttackTimes = [];
          this.karplusAttackTimes = [];
          this.rattlesnakeAttackTimes = [];
        }
        this.context = fmContext;
        this.analyser = this.fmAudio.analyser ?? null;
        this.setOutput(this.output);
        return fmContext;
      } catch (error) {
        if (lifecycleGeneration === this.lifecycleGeneration) {
          this.context = null;
          this.analyser = null;
          await Promise.allSettled([
            this.fmAudio.close?.(),
            this.physicalAudio.close?.(),
          ]);
        }
        throw error;
      } finally {
        if (this.startPromise === startPromise) this.startPromise = null;
      }
    })();
    this.startPromise = startPromise;
    return startPromise;
  }

  setOutput(value) {
    this.output = clamp(value, 0, 0.9, 0.58);
    this.fmAudio.setOutput(this.output);
    this.physicalAudio.setOutput(this.output);
  }

  async trigger(sourceVoice, { startAt } = {}) {
    const plan = graphDrumTriggerPlan(sourceVoice);
    await this.start();
    const allocationTime = Number(this.context?.currentTime) || 0;
    const sourceTime = Number.isFinite(Number(startAt))
      ? Math.max(allocationTime, Number(startAt))
      : allocationTime;
    if (plan.engine === "fm") {
      // Native nodes are allocated when trigger() runs, even for a future
      // startAt, so rate-limit against allocation time rather than musical time.
      this.fmAttackTimes = this.fmAttackTimes.filter((time) => time > allocationTime - 1);
      if (this.fmAttackTimes.length >= MAX_GRAPH_FM_ATTACKS_PER_SECOND) {
        return Object.freeze({
          ...plan,
          scheduled: false,
          skipped: true,
          skipReason: "attack-rate-budget",
        });
      }
      this.fmAttackTimes.push(allocationTime);
      return this.fmAudio.trigger(plan.voice, { startAt });
    }

    const translatedStartAt = translateGraphDrumStartAt(
      startAt,
      this.context,
      this.physicalAudio.context,
    );
    const historyKey = plan.engine === "karplus-strong"
      ? "karplusAttackTimes"
      : "rattlesnakeAttackTimes";
    const maximumAttacks = plan.engine === "karplus-strong"
      ? MAX_GRAPH_KARPLUS_ATTACKS_PER_SECOND
      : MAX_GRAPH_RATTLESNAKE_ATTACKS_PER_SECOND;
    this[historyKey] = this[historyKey].filter((time) => time > sourceTime - 1);
    if (this[historyKey].length >= maximumAttacks) {
      return Object.freeze({
        ...plan,
        scheduled: false,
        skipped: true,
        skipReason: "attack-rate-budget",
      });
    }
    this[historyKey].push(sourceTime);
    return this.physicalAudio.trigger(plan.frequency, plan.settings, {
      engine: plan.engine,
      velocity: plan.velocity,
      minimumVelocity: 0.001,
      performanceY: plan.performanceY,
      preserveDuration: true,
      startAt: translatedStartAt,
    });
  }

  silence() {
    this.fmAttackTimes = [];
    this.karplusAttackTimes = [];
    this.rattlesnakeAttackTimes = [];
    this.fmAudio.silence?.();
    this.physicalAudio.silence?.();
  }

  async close() {
    this.lifecycleGeneration += 1;
    this.silence();
    this.context = null;
    this.analyser = null;
    this.startPromise = null;
    const closing = Promise.allSettled([
      this.fmAudio.close?.(),
      this.physicalAudio.close?.(),
    ]);
    await closing;
  }
}
