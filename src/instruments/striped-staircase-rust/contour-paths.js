import {
  STAIRCASE_BRANCH_LIMIT, STAIRCASE_BRANCH_OFFSET, STAIRCASE_BRANCH_STRIDE,
} from './field.js';

const VISIBLE_PRESENCE = .001;
const offsetAt = (field, frame, slot) => frame * field.stride
  + STAIRCASE_BRANCH_OFFSET + slot * STAIRCASE_BRANCH_STRIDE;
const voiceId = value => Number.isInteger(value) && value > 0 ? value : 0;
const measured = (table, at) => table[at] > VISIBLE_PRESENCE && table[at + 3] > 0
  && Number.isFinite(table[at + 1]) && Number.isFinite(table[at + 2]) && voiceId(table[at + 4]);

/** Motion trails of the exact sonified read points, not static contour outlines.
 * Build once when a prepared field is accepted. A run contains consecutive
 * measured frames in one oscillator slot with one identity. Missing geometry,
 * slot changes and identity changes always break a run, even if the old ID
 * returns later. No path is inferred between disconnected measured runs.
 *
 * `points` is packed screen-normalized [x,y,...]; `startFrame`/`endFrame` locate
 * each equally spaced sample in depth. Paired side0 is the circle and side1 the
 * diamond; these are persistent sides, not current screen-left/screen-right.
 */
export function buildStaircaseContourPaths(field) {
  if (!(field?.table instanceof Float32Array) || !Number.isInteger(field.frames)
    || field.frames < 1 || field.frames > 64 || !Number.isInteger(field.stride)
    || field.stride < STAIRCASE_BRANCH_OFFSET + STAIRCASE_BRANCH_LIMIT * STAIRCASE_BRANCH_STRIDE
    || field.table.length !== field.frames * field.stride) throw new TypeError('Invalid staircase path field.');
  const byId = new Map(), paired = field.pitchSource === 1;
  const previous = Array(STAIRCASE_BRANCH_LIMIT).fill(null);
  const lastFrame = Math.max(1, field.frames - 1);
  for (let frame = 0; frame < field.frames; frame++) {
    for (let slot = 0; slot < STAIRCASE_BRANCH_LIMIT; slot++) {
      const at = offsetAt(field, frame, slot);
      if (!measured(field.table, at)) { previous[slot] = null; continue; }
      const id = field.table[at + 4];
      let path = byId.get(id);
      if (!path) {
        path = { id, parentId: voiceId(field.table[at + 5]),
          tendrilId: paired ? Math.ceil(id / 2) : id, side: paired ? (id - 1) % 2 : null,
          runs: [] };
        byId.set(id, path);
      }
      let run = previous[slot]?.id === id ? previous[slot].run : null;
      if (!run) {
        run = { slot, startFrame: frame, endFrame: frame, startDepth: frame / lastFrame,
          endDepth: frame / lastFrame, points: [] };
        path.runs.push(run);
      }
      run.endFrame = frame; run.endDepth = frame / lastFrame;
      run.points.push(field.table[at + 1], field.table[at + 2]);
      previous[slot] = { id, run };
    }
  }
  for (const path of byId.values()) for (const run of path.runs) run.points = new Float32Array(run.points);
  return { byId, paths: [...byId.values()], table: field.table,
    frames: field.frames, stride: field.stride, pitchSource: field.pitchSource ?? 0 };
}

/** Query the same categorical-ID and linear position/presence rule as Rust and
 * readStaircaseRhythm. `id` optionally selects one voice. `segment` is available
 * only when both measured endpoints belong to the same uninterrupted run.
 * A fading birth/death can still have a current marker with segment:null; that
 * does not certify a contour through the missing measurement. Gate/transport
 * state belongs to audio and is deliberately not guessed by this helper.
 */
export function sampleStaircaseContourPaths(paths, progress, id = null) {
  const depth = Math.max(0, Math.min(1, Number.isFinite(Number(progress)) ? Number(progress) : 0));
  const position = depth * (paths.frames - 1), low = Math.floor(position);
  const high = Math.min(paths.frames - 1, low + 1), mix = position - low;
  const nearest = mix < .5 ? low : high, samples = [];
  for (let slot = 0; slot < STAIRCASE_BRANCH_LIMIT; slot++) {
    const a = offsetAt(paths, low, slot), b = offsetAt(paths, high, slot);
    const selected = offsetAt(paths, nearest, slot);
    const currentId = voiceId(paths.table[selected + 4]);
    if (!currentId || (id !== null && currentId !== id)) continue;
    const sameIdentity = paths.table[a + 4] === paths.table[b + 4];
    const value = attribute => sameIdentity
      ? paths.table[a + attribute] * (1 - mix) + paths.table[b + attribute] * mix
      : paths.table[selected + attribute];
    const presence = value(0), length = value(3);
    if (!(presence > VISIBLE_PRESENCE) || !(length > 0)) continue;
    const cx = value(1), cy = value(2);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    const path = paths.byId.get(currentId);
    const run = path?.runs.find(candidate => candidate.slot === slot
      && candidate.startFrame <= low && candidate.endFrame >= high);
    const segment = high > low && sameIdentity && run && measured(paths.table, a) && measured(paths.table, b)
      ? { run, index: low - run.startFrame, mix } : null;
    samples.push({ id: currentId, parentId: voiceId(paths.table[selected + 5]), slot,
      tendrilId: path?.tendrilId ?? (paths.pitchSource === 1 ? Math.ceil(currentId / 2) : currentId),
      side: path?.side ?? (paths.pitchSource === 1 ? (currentId - 1) % 2 : null),
      cx, cy, presence, length, depth, path: path ?? null, segment });
  }
  return samples;
}
