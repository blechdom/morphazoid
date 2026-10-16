import { DEFAULT_FM_DRUM_VOICES } from "../fm-drums/fm-drums.js";
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
export const DRUM_DEFAULTS = Object.freeze({ placement: "x", count: DRUM_COUNT.default, voice: DRUM_VOICES[0].id, pitch: DRUM_PITCH.default });

export function sanitizeDrum(drum) {
  const source = drum && typeof drum === "object" ? drum : {};
  const count = Number(source.count);
  const pitch = Number(source.pitch);
  return {
    placement: DRUM_PLACEMENTS.includes(source.placement) ? source.placement : DRUM_DEFAULTS.placement,
    count: Number.isFinite(count) ? Math.min(DRUM_COUNT.max, Math.max(DRUM_COUNT.min, Math.round(count))) : DRUM_DEFAULTS.count,
    voice: DRUM_VOICES.some((voice) => voice.id === source.voice) ? source.voice : DRUM_DEFAULTS.voice,
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

/** The kit voice for a trigger, bent by the trigger's height across the box when the row asks for it. */
export function triggerVoice(drum, trigger, settings, view) {
  const base = drumVoiceById(drum.voice);
  if (!drum.pitch) return { ...base };
  const region = readerRegion(settings, view);
  const height = Math.min(1, Math.max(0, (trigger.y - region.yMin) / (region.yMax - region.yMin)));
  const semitones = (height - 0.5) * 2 * drum.pitch;
  return { ...base, frequency: Math.min(12000, Math.max(20, base.frequency * 2 ** (semitones / 12))) };
}
