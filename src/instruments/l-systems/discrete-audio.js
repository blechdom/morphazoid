import { clamp, percussionEnvelopeEditorX, pitch01ToFrequency, synthParametersForMode } from "../../audio.js";
import { advanceLSystemTraversal, branchAngleFrequency } from "../l-system/l-system.js";
import {
  advanceLSystemDrumTraversal, groupedLSystemDrumEvents,
  lSystemDrumEventsForTraversal, lSystemDrumSubdivisionCount,
} from "../l-system-drum-machine/l-system-drum-machine.js";

export const L_SYSTEM_NOTE_VOICES = 128;
export const L_SYSTEM_EVENT_LOOKAHEAD = 0.085;
const LEAD = 0.012;
const BURST = 16;
const STARTS_PER_SECOND = 128;

/** The same subdivision frontier and admission policy feeds Notes and Triggers.
 * Keep audio time independent of paint; never replay an overdue frame's attacks.
 * Existing traversal/model bounds cap each sweep at about 64 samples. */
export class LSystemEventClock {
  constructor({ traces, position, direction, rate, behavior, structureMode, subdivisions, mappingMode, maxPhaseStep, now, includeStart = true, budget = null }) {
    Object.assign(this, { traces, position, direction, rate, behavior, structureMode, subdivisions, mappingMode, maxPhaseStep });
    this.until = now + LEAD;
    this.motion = [{ at: this.until, position, direction, rate, behavior }];
    this.pending = {};
    this.activeEventKeys = new Set();
    this.budget = budget ?? { tokens: BURST, time: this.until };
    this.includeStart = includeStart;
    if (!includeStart) this.seedFrontier();
  }
  positionAt(time) {
    // Keep already-scheduled motion visible until its audio-clock boundary.
    const motion = this.motion.findLast(entry => entry.at <= time) ?? this.motion[0];
    return advanceLSystemTraversal(motion.position, motion.direction,
      Math.max(0, time - motion.at) * motion.rate, motion.behavior);
  }
  configure(settings) {
    // A drag may send many changes between polls. Only the latest values join
    // the next unscheduled window; no cancellation, lost budget, or restart.
    for (const key of ["traces", "rate", "behavior", "structureMode", "subdivisions", "mappingMode", "maxPhaseStep", "position", "direction"]) {
      if (settings[key] !== undefined && settings[key] !== (this.pending[key] ?? this[key])) this.pending[key] = settings[key];
    }
  }
  applyConfiguration(now) {
    const changes = this.pending;
    this.pending = {};
    const changed = key => Object.hasOwn(changes, key) && changes[key] !== this[key];
    const seek = changed("position");
    const motionChanged = seek || ["direction", "rate", "behavior"].some(changed);
    const frontierChanged = ["traces", "structureMode", "subdivisions", "direction", "behavior"].some(changed);
    Object.assign(this, changes);
    if (motionChanged) {
      this.motion.push({ at: this.until, position: this.position, direction: this.direction, rate: this.rate, behavior: this.behavior });
    }
    // Retain only the current audible anchor plus the bounded lookahead.
    while (this.motion.length > 1 && this.motion[1].at <= now) this.motion.shift();
    if (seek) {
      this.activeEventKeys = new Set();
      this.includeStart = true;
    } else if (frontierChanged) this.seedFrontier();
  }
  seedFrontier() {
    this.activeEventKeys = lSystemDrumEventsForTraversal(this.traces,
      [{ position: Math.min(1 - 1e-9, this.position), direction: this.direction }], this).activeEventKeys;
  }
  read(now) {
    if (now > this.until) {
      // UI stall: join the current frontier, not a backlog of missed notes.
      Object.assign(this, this.positionAt(now + LEAD));
      this.until = now + LEAD;
      this.includeStart = false;
      this.seedFrontier();
    }
    const end = now + L_SYSTEM_EVENT_LOOKAHEAD;
    if (end <= this.until) return [];
    this.applyConfiguration(now);
    if (!(this.rate > 0)) {
      this.until = end;
      return [];
    }
    const advanced = advanceLSystemDrumTraversal(this.position, this.direction,
      (end - this.until) * this.rate, { behavior: this.behavior, maxPhaseStep: this.maxPhaseStep });
    const samples = this.includeStart
      ? [{ position: Math.min(1 - 1e-9, this.position), direction: this.direction }, ...advanced.samples]
      : advanced.samples;
    this.includeStart = false;
    let previous = this.position, distance = 0;
    const times = samples.map(sample => {
      distance += sample.boundary === "wrap"
        ? (sample.direction > 0 ? 1 - previous : previous)
        : Math.abs(sample.position - previous);
      previous = sample.position;
      return this.until + distance / this.rate;
    });
    const swept = lSystemDrumEventsForTraversal(this.traces, samples, this);
    this.activeEventKeys = swept.activeEventKeys;
    Object.assign(this, { position: advanced.position, direction: advanced.direction, until: end });
    const groups = groupedLSystemDrumEvents(swept.events, { mode: this.mappingMode, maxEvents: 64 });
    const admitted = [], perSample = new Map();
    for (const entry of groups) {
      const startAt = times[entry.event.transportSampleIndex];
      this.budget.tokens = Math.min(BURST, this.budget.tokens + Math.max(0, startAt - this.budget.time) * STARTS_PER_SECOND);
      this.budget.time = Math.max(this.budget.time, startAt);
      const count = perSample.get(startAt) ?? 0;
      if (this.budget.tokens < 1 || count >= 8) continue;
      this.budget.tokens -= 1;
      perSample.set(startAt, count + 1);
      admitted.push({ ...entry, startAt });
    }
    return admitted;
  }
}

export function lSystemNoteDuration(state, eventCount = 1) {
  const density = lSystemDrumSubdivisionCount(state.drums.subdivisions) * Math.sqrt(Math.max(1, eventCount));
  const interval = 1 / (Math.max(0.015, Math.abs(state.speed)) * density);
  return clamp(interval * (0.58 + state.synth.depthAmount * 0.18), 0.09, 0.7);
}

/** Time-domain note envelopes, never a spatial loop fade at a branch onset. */
export function lSystemNoteEnvelope(duration, amplitude = {}) {
  const points = amplitude.enabled && amplitude.points?.length === 5
    ? amplitude.points : [{ x: 0, y: 0 }, { x: 0.08, y: 1 }, { x: 0.3, y: 0.6 }, { x: 0.65, y: 0.4 }, { x: 1, y: 0 }];
  const times = [0, Math.max(0.008, points[1].x * duration), 0, 0, 0];
  times[2] = Math.max(times[1] + 0.008, points[2].x * duration);
  times[3] = Math.max(times[2], points[3].x * duration);
  times[4] = Math.max(times[3] + 0.02, points[4].x * duration);
  return points.map((point, index) => ({
    x: percussionEnvelopeEditorX(times[index] * 1000),
    y: index === 0 || index === 4 ? 0 : clamp(point.y, 0, 1),
  }));
}

export function lSystemNoteVoice(event, eventCount, state, amplitudeLevel = 1) {
  const depth = (Number(event.depth) || 0) / Math.max(1, Number(event.maxForkDepth) || 1);
  const drive = clamp(depth * state.synth.depthAmount, 0, 1);
  const pitch = state.synth.pitchSource === "depth" ? depth
    : state.synth.pitchSource === "progress" ? Number(event.progress) || 0 : Number(event.normalizedY) || 0;
  const frequency = state.synth.pitchSource === "angle"
    ? branchAngleFrequency(event.cumulativeTurn, state.synth.baseFrequency, state.synth.pitchRange)
    : pitch01ToFrequency(pitch, state.synth.baseFrequency, state.synth.pitchRange);
  return {
    key: `l-system-suite:note:${event.key}`,
    frequency,
    // Leave overlap headroom as well as normalizing simultaneous branches. This does not
    // shorten old tails or turn the first subdivision into an inaudible note.
    gain: clamp((0.16 + drive * 0.16 + Math.sqrt(event.powerShare || 0) * 0.18)
      * amplitudeLevel / Math.sqrt(Math.max(1, eventCount)) * 0.65, 0, 0.36),
    pan: clamp(((Number.isFinite(event.normalizedX) ? event.normalizedX : 0.5) * 2 - 1) * state.synth.stereoSpread, -1, 1),
    waveform: "sine",
    ...synthParametersForMode(state.synth.soundMode, drive, {
      fmIndex: state.synth.modulationIndex, fmRatio: 1.5,
      pmIndex: state.synth.modulationIndex, pmRatio: 1.5,
      shepardRate: state.speed * state.direction, shepardWidth: 4, shepardPosition: Number(event.progress) || 0,
    }),
  };
}
