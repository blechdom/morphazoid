import { PARAMS } from './model.js';
import { ENVELOPE_PRESETS, envelopePresetId } from './envelope-presets.js';

const LANES = { attack: [.055, .29], decay: [.36, .58], release: [.77, .975] };
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const fallback = ENVELOPE_PRESETS.find(preset => preset.id === 'sustain').snapshot;
function encode(key, value) {
  const { min, max } = PARAMS[key], [left, right] = LANES[key];
  return left + Math.log(clamp(value, min, max) / min) / Math.log(max / min) * (right - left);
}
function decode(key, position) {
  const { min, max } = PARAMS[key], [left, right] = LANES[key];
  return min * (max / min) ** ((clamp(position, left, right) - left) / (right - left));
}
export function adsrPoints(state) {
  const sustain = clamp(state.sustain, 0, 1);
  return [{ x: 0, y: 0 }, { x: encode('attack', state.attack), y: 1 },
    { x: encode('decay', state.decay), y: sustain }, { x: .675, y: sustain },
    { x: encode('release', state.release), y: 0 }];
}
export function adsrFromPoints(points) {
  const defaults = adsrPoints(fallback);
  return { attack: decode('attack', points?.[1]?.x ?? defaults[1].x),
    decay: decode('decay', points?.[2]?.x ?? defaults[2].x),
    sustain: clamp(points?.[3]?.y ?? fallback.sustain, 0, 1),
    release: decode('release', points?.[4]?.x ?? defaults[4].x) };
}
const time = value => value < 1 ? `${Number((value * 1000).toFixed(2))} ms` : `${Number(value.toFixed(2))} s`;

/** Each stage has its own logarithmic travel so a sub-millisecond attack stays
 * reachable beside a sixteen-second release. The sustain plateau illustrates
 * the score-owned gate; dragging it changes level, never invents a gate time.
 */
export const ADSR_EDITOR_MODEL = Object.freeze({
  labels: ['', 'A', 'D', 'S', 'R'], fixedNodes: [0],
  presetPoints(name) {
    return adsrPoints(ENVELOPE_PRESETS.find(preset => preset.id === name)?.snapshot ?? fallback);
  },
  normalizePoints(points) { return adsrPoints(adsrFromPoints(points)); },
  moveNode(points, index, point) {
    const state = adsrFromPoints(points);
    if (index === 1) state.attack = decode('attack', point.x);
    if (index === 2) { state.decay = decode('decay', point.x); state.sustain = clamp(point.y, 0, 1); }
    if (index === 3) state.sustain = clamp(point.y, 0, 1);
    if (index === 4) state.release = decode('release', point.x);
    return adsrPoints(state);
  },
  describeNode(points, index) {
    const state = adsrFromPoints(points);
    return ['Gate opens', `Attack ${time(state.attack)} · drag left/right`,
      `Decay ${time(state.decay)} · drag left/right; sustain ${Math.round(state.sustain * 100)}% · up/down`,
      `Sustain ${Math.round(state.sustain * 100)}% · drag up/down`,
      `Release ${time(state.release)} · drag left/right`][index];
  },
  axis(points) {
    const state = adsrFromPoints(points);
    return [`A ${time(state.attack)}`, `D ${time(state.decay)}`, `S ${Math.round(state.sustain * 100)}%`, `R ${time(state.release)}`];
  },
  note: 'Drag A/D/R for time · D/S for sustain',
});

export function envelopeEditorState(state) {
  return { enabled: true, swell: false, preset: envelopePresetId(state) ?? 'custom', level: 1, points: adsrPoints(state) };
}
