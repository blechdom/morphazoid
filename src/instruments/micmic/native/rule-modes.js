/** Complete rule selection and preset ownership for the unified Rust delay. */
import { L_SYSTEM_TYPES, DEFAULT_PARAMETERS, sanitizeParameters, randomState } from './model.js';
import { LAB_KINDS, defaultLab, sanitizeLab, randomLab } from '../../l-system-parametric-lab/model.js';
import { PRESETS as parametricPresets } from '../../l-system-parametric-lab/config.js';
import { PRESETS as experimentPresets, KIND_LABELS } from '../../l-system-experiments/config.js';

export const RULE_MODES = Object.freeze([...L_SYSTEM_TYPES, ...LAB_KINDS.map(kind => `lab:${kind}`)]);
export const RULE_MODE_LABELS = Object.freeze({
  pythagorean: 'Pythagorean tree', plant: 'Branching plant', coral: 'Coral', dragon: 'Dragon curve',
  koch: 'Koch snowflake', sierpinski: 'Sierpiński triangle', hilbert: 'Hilbert curve', gosper: 'Gosper curve',
  cantor: 'Cantor set', levy: 'Lévy C curve', terdragon: 'Terdragon', bush: 'Meadow bush', fan: 'Frond fan',
  fern: 'Ladder fern', whorled: 'Whorled shrub · 3-way', ternary: 'Trident tree · 3-way',
  quaternary: 'Four-way canopy · 4-way', peano: 'Peano weave', arrowhead: 'Sierpiński arrowhead',
  'quadratic-koch': 'Quadratic Koch island', kolam: 'Snake Kolam', dekking: 'Dekking square curve',
  stochastic: 'Stochastic shrub', 'lab:parametric': 'Parametric branches',
  ...Object.fromEntries(Object.entries(KIND_LABELS).map(([kind, label]) => [`lab:${kind}`, label])),
});

export function ruleMode(parameters = {}) {
  const current = sanitizeParameters(parameters);
  return current.lab ? `lab:${current.lab.kind}` : current.lSystemType;
}

/** Rule changes keep the shared sound controls and replace family-owned values.
 * Re-selecting the same rule preserves its edits; changing families starts from
 * complete numeric defaults, so a previous cutoff or ratio cannot leak across. */
export function parametersForRuleMode(parameters, mode) {
  const current = sanitizeParameters(parameters);
  const target = RULE_MODES.includes(mode) ? mode : DEFAULT_PARAMETERS.lSystemType;
  if (target.startsWith('lab:')) {
    const kind = target.slice(4);
    const lab = current.lab?.kind === kind ? sanitizeLab(current.lab) : defaultLab(kind);
    return sanitizeParameters({ ...current, generations: lab.iterations, lab });
  }
  const { lab, ...classic } = current;
  return sanitizeParameters({ ...classic, lSystemType: target });
}

/** Existing preset IDs and ordering stay intact. Prefix the copied banks' IDs
 * because names such as Candelabra already exist in the original delay bank. */
export function combinedPresets(classicBank) {
  const copy = (preset, prefix) => ({ ...preset, id: `${prefix}-${preset.id}`, snapshot: {
    parameters: sanitizeParameters(preset.snapshot.parameters),
    performance: { ...preset.snapshot.performance, mastering: { ...preset.snapshot.performance.mastering } },
  } });
  return [...classicBank, ...parametricPresets.map(preset => copy(preset, 'parametric')),
    ...experimentPresets.map(preset => copy(preset, 'experiment'))];
}

/** Dice covers every rule family and musical control while retaining the live
 * input, gain, device policy, output boost and playback/session state. */
export function randomRuleState(parameters, performance, random = Math.random) {
  const unit = Math.max(0, Math.min(1, Number(random()) || 0));
  const mode = RULE_MODES[Math.min(RULE_MODES.length - 1, Math.floor(unit * RULE_MODES.length))];
  const { lab, ...classic } = sanitizeParameters(parameters);
  const next = randomState(classic, performance, random);
  next.parameters = parametersForRuleMode(next.parameters, mode);
  if (mode.startsWith('lab:')) {
    const values = randomLab(mode.slice(4), random);
    next.parameters = sanitizeParameters({ ...next.parameters, generations: values.iterations, lab: values });
  }
  return next;
}
