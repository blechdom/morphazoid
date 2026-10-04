import {
  SYNTHESIS_METHODS,
  createDefaultState,
  sanitizeState,
  stateFromPreset,
  randomizeState,
} from './catalog.js';
import { captureSoundState } from './presets.js';
import { SEQUENCE_STUDIES, getSequenceStudy } from './sequence-catalog.js';
import { compileSequence } from './sequence-compiler.js';
import {
  createSequenceParameterValues,
  getSequenceParameterBounds,
  getSequenceParameterDefinitions,
} from './sequence-parameters.js';
import { TUNINGS, sanitizeTuningId } from './tunings.js';

export const MIN_SEQUENCE_TEMPO = 10;
export const MAX_SEQUENCE_TEMPO = 1200;
const MIN_RANDOM_TEMPO = 64;
const MAX_RANDOM_TEMPO = 180;

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const finite = (value, fallback) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));
const unit = rng => clamp(rng(), 0, 1, 0);
const indexFromUnit = (length, value) => Math.min(length - 1, Math.floor(value * length));
const pick = (items, rng) => items[indexFromUnit(items.length, unit(rng))];
const wrap = (index, length) => ((index % length) + length) % length;

const hashText = value => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const resolveStudy = (studyOrId, fallbackId = SEQUENCE_STUDIES[0].id) => {
  const id = typeof studyOrId === 'string' ? studyOrId : studyOrId?.id;
  return getSequenceStudy(id) || getSequenceStudy(fallbackId) || SEQUENCE_STUDIES[0];
};

const resolveSynthesisMethod = methodId => {
  return SYNTHESIS_METHODS.find(method => method.id === methodId) || SYNTHESIS_METHODS[0];
};

const clampTempo = (value, fallback) => Math.round(clamp(
  value,
  MIN_SEQUENCE_TEMPO,
  MAX_SEQUENCE_TEMPO,
  fallback,
));

/** A complete, immutable historical-sequence state with no transport fields. */
export function sanitizeSequencePerformance(value = {}, fallbackId = SEQUENCE_STUDIES[0].id) {
  const source = typeof value === 'string' ? { id: value } : value && typeof value === 'object' ? value : {};
  const study = resolveStudy(source.id ?? source.sequenceId, fallbackId);
  const parameters = createSequenceParameterValues(study, source.parameters ?? source.values ?? {});
  const tempoBpm = clampTempo(source.tempoBpm ?? source.tempo, study.defaults.tempoBpm);
  return deepFreeze({ id: study.id, parameters, tempoBpm });
}

// IDs remain stable for saved performances and the whole-instrument bank.
// Display names and musical recipes belong to the selected mechanism below.
export const SEQUENCE_SETTING_RECIPES = deepFreeze(
  ['original', 'spacious', 'sparse', 'tight', 'dense', 'wild'].map(id => ({ id })),
);

const variation = (label, description, parameters, tempoScale = 1) => ({ label, description, parameters, tempoScale });

// These are authored demonstrations of this compiler's mechanisms, not factory
// patches from the historical instruments which supply the catalog's lineage.
const MECHANISM_VARIATIONS = deepFreeze({
  'ordered-chord': [
    variation('One-octave ascent', 'Visits the held intervals in ascending order within one octave.', { order: 'up', octaves: 1, intervalSpread: 1, stepBeats: .375, gate: .9 }, .85),
    variation('Descending double octave', 'Traverses two octaves from the highest note downward.', { order: 'down', octaves: 2, intervalSpread: .8, stepBeats: .25, gate: .65 }),
    variation('Pendulum turnarounds', 'Reverses direction without repeating the endpoint notes.', { order: 'pendulum', octaves: 1, intervalSpread: 1.25, stepBeats: .25, gate: .55 }, 1.1),
    variation('Inside-out octave braid', 'Alternates around the center of a two-octave held-note field.', { order: 'inside-out', octaves: 2, intervalSpread: 1, stepBeats: .125, gate: .75 }, 1.1),
    variation('Outside-in compressed intervals', 'Pairs the outer notes first, with compressed intervals and swung timing.', { order: 'outside-in', octaves: 2, intervalSpread: .6, stepBeats: .1875, swing: .22, gate: .8 }),
  ],
  'ratio-canon': [
    variation('Separated pulse voices', 'Widens independent pulse periods and retains a long articulation.', { periodScale: 1.5, phaseShift: 2, ratioSpread: 1, ramp: 0, stepBeats: .25, gate: .95 }, .9),
    variation('Offset close-ratio canon', 'Shifts the voice phases while compressing their pitch ratios.', { periodScale: 1, phaseShift: 1, ratioSpread: .55, ramp: 0, stepBeats: .25, gate: .65 }),
    variation('Accelerating punched roll', 'Shortens successive event intervals along a rising speed ramp.', { periodScale: .75, phaseShift: 1, ratioSpread: 1, ramp: .65, stepBeats: .25, gate: .6 }),
    variation('Fast coincident voices', 'Compresses pulse periods so more independently clocked voices coincide.', { periodScale: .5, phaseShift: 0, ratioSpread: 1.4, ramp: 0, stepBeats: .125, gate: .8 }),
    variation('Decelerating ratio fan', 'Expands pitch ratios while the roll progressively slows down.', { periodScale: 1.25, phaseShift: -2, ratioSpread: 1.6, ramp: -.65, stepBeats: .1875, gate: .85 }),
  ],
  'drawn-rows': [
    variation('Low-relief drawing', 'Compresses the pitch drawing with continuous tuning interpolation.', { contourScale: .4, reverseContour: false, pitchMode: 'contour', stepBeats: .375, gate: .95 }, .9),
    variation('Drawing read backward', 'Reads the drawn contours and any cutouts in reverse.', { contourScale: 1, reverseContour: true, stepBeats: .25, gate: .9 }),
    variation('Quantized contour points', 'Turns the drawing into short notes snapped to the tuning map.', { contourScale: .85, reverseContour: false, pitchMode: 'nearest', stepBeats: .1875, gate: .5 }, 1.1),
    variation('High-relief contour', 'Expands the drawing and samples it at a finer event spacing.', { contourScale: 1.6, reverseContour: false, stepBeats: .125, gate: .85, steps: 48 }),
    variation('Mirrored negative space', 'Reverses the contour; masked drawings exchange cutouts and sounding cells.', { contourScale: 1.25, reverseContour: true, invertMasks: true, stepBeats: .25, swing: .16, gate: .8 }),
  ],
  'parameter-rows': [
    variation('Long duration row', 'Stretches the independent duration lane while leaving velocity contrasts intact.', { durationScale: 1.6, velocityScale: 1, gateScale: 1.3, stepBeats: .25, gate: .95 }, .9),
    variation('Quiet velocity counterline', 'Softens the velocity lane against the unchanged pitch and duration rows.', { durationScale: 1, velocityScale: .7, gateScale: 1.1, stepBeats: .25, gate: .9 }),
    variation('Punched staccato cells', 'Compresses the duration row and shortens each programmed articulation.', { durationScale: .7, velocityScale: 1.2, gateScale: .7, stepBeats: .25, gate: .65 }),
    variation('Rapid parameter braid', 'Interlocks unequal lane lengths at twice the base event resolution.', { durationScale: .8, velocityScale: 1.25, gateScale: 1.4, stepBeats: .125, gate: .95 }),
    variation('Retrograde parameter roll', 'Reverses pitch, velocity, gate and duration rows together.', { reverseRows: true, durationScale: 1.1, velocityScale: 1.1, gateScale: 1.2, stepBeats: .1875, gate: .9 }),
  ],
  'cv-rows': [
    variation('Single narrow voltage row', 'Compresses stage voltages and disables the parallel row where present.', { voltageScale: .5, secondVoice: false, addressOffset: 0, gateRotation: 0, stepBeats: .375, gate: .9 }),
    variation('Displaced gate clock', 'Moves gates two positions against the addressed pitch stages.', { voltageScale: 1, addressOffset: 0, gateRotation: 2, stepBeats: .25, gate: .75 }),
    variation('Address jump sequence', 'Offsets pitch addresses independently of the gate pattern.', { voltageScale: .9, addressOffset: 3, gateRotation: -1, stepBeats: .1875, gate: .55 }),
    variation('Wide parallel voltage', 'Expands the voltages and enables the authored second row where available.', { voltageScale: 1.45, secondVoice: true, addressOffset: 1, gateRotation: 0, stepBeats: .125, gate: .85 }),
    variation('Crossed stage and gate offsets', 'Counter-rotates stage addresses and gates with a swung clock.', { voltageScale: 1.15, secondVoice: true, addressOffset: -2, gateRotation: 2, stepBeats: .25, swing: .2, gate: .8 }),
  ],
  gesture: [
    variation('Small continuous gesture', 'Compresses pitch travel and retains every pressure-shaped attack.', { contourScale: .45, pressureScale: 1.2, densityFromPressure: false, stepBeats: .375, gate: .95 }),
    variation('Pressure-carved gesture', 'Lets pressure remove notes as well as shape their velocity.', { contourScale: .9, pressureScale: 1.4, densityFromPressure: true, stepBeats: .25, gate: .8 }),
    variation('Quantized gesture taps', 'Snaps a compact gesture to tuning notes with short gates.', { contourScale: .8, pressureScale: 1.25, densityFromPressure: false, pitchMode: 'nearest', stepBeats: .1875, gate: .5 }),
    variation('Full-height gesture sweep', 'Expands pitch travel and increases the number of sampled gesture points.', { contourScale: 1.6, pressureScale: 1.4, densityFromPressure: false, steps: 48, stepBeats: .125, gate: .9 }),
    variation('Reverse pressure sweep', 'Mirrors the gesture in time and uses its pressure to articulate gaps.', { contourScale: 1.2, pressureScale: 1.6, reverseGesture: true, densityFromPressure: true, stepBeats: .25, gate: .85 }),
  ],
  'phrase-bank': [
    variation('Untransposed phrase chain', 'Reads the stored phrases forward at a relaxed note spacing.', { phraseOrder: 'forward', phraseRise: 0, chainRotation: 0, stepBeats: .375, gate: .9 }, .9),
    variation('Chain from the second phrase', 'Changes the entry point into the bank while retaining each phrase direction.', { phraseOrder: 'forward', phraseRise: 0, chainRotation: 1, stepBeats: .25, gate: .7 }),
    variation('Retrograde phrase memory', 'Reverses the events within every phrase without reversing the bank chain.', { phraseOrder: 'reverse', phraseRise: 0, chainRotation: 0, stepBeats: .1875, gate: .55 }),
    variation('Ascending phrase staircase', 'Raises successive phrases by two pitch-coordinate steps.', { phraseOrder: 'forward', phraseRise: 2, chainRotation: -1, stepBeats: .125, gate: .8 }),
    variation('Pendulum phrase answers', 'Reads each phrase forward and backward, descending between phrases.', { phraseOrder: 'pendulum', phraseRise: -2, chainRotation: 1, stepBeats: .25, swing: .12, gate: .85 }),
  ],
  'accent-pattern': [
    variation('Long accented notes', 'Sustains the authored accent line with the original note and accent alignment.', { patternRotation: 0, accentShift: 0, reversePattern: false, stepBeats: .375, gate: .95 }, .9),
    variation('Accents one step late', 'Offsets accent positions while leaving the pitch line in place.', { patternRotation: 0, accentShift: 1, reversePattern: false, stepBeats: .25, gate: .8 }),
    variation('Rotated staccato line', 'Moves notes and accents together and gives each a short gate.', { patternRotation: 3, accentShift: 0, reversePattern: false, stepBeats: .1875, gate: .45 }),
    variation('Fast offbeat accents', 'Places independent accents against a fast rotated pitch line.', { patternRotation: 1, accentShift: 3, reversePattern: false, stepBeats: .125, gate: .8 }),
    variation('Backward accent call', 'Reverses the line and displaces the accents against swung steps.', { patternRotation: -2, accentShift: -1, reversePattern: true, stepBeats: .25, swing: .24, gate: .75 }),
  ],
  tracker: [
    variation('Held gate memory', 'Lengthens gate locks and carries unlocked gates where the method supports memory.', { gateScale: 1.6, velocityScale: 1, carryGate: true, carryVelocity: false, stepBeats: .375, gate: .95 }),
    variation('Soft velocity locks', 'Preserves per-row velocity contrasts at a reduced level.', { velocityScale: .7, gateScale: 1.2, rowRotation: 1, carryVelocity: true, carryGate: false, stepBeats: .25, gate: .9 }),
    variation('Short row articulations', 'Shortens locked gates and releases memory on unlocked rows where supported.', { gateScale: .65, velocityScale: 1.2, carryGate: false, carryVelocity: false, stepBeats: .25, gate: .7 }),
    variation('Double-time row stream', 'Runs the row cycle quickly while carrying both lock types where supported.', { gateScale: 1.4, velocityScale: 1.2, carryGate: true, carryVelocity: true, stepBeats: .125, gate: .95 }),
    variation('Bottom-to-top pattern', 'Reverses tracker rows from a shifted start row.', { reverseRows: true, rowRotation: -2, gateScale: 1, velocityScale: 1.1, carryGate: false, carryVelocity: true, stepBeats: .1875, gate: .9 }),
  ],
  groove: [
    variation('Straight timing reference', 'Removes the groove deviations while retaining notes, rests and accents.', { timingDepth: 0, rotateEvery: 0, patternRotation: 0, accentShift: 0, stepBeats: .25, gate: .8 }),
    variation('Half-depth groove', 'Applies half the authored timing deviations with displaced accents.', { timingDepth: .5, rotateEvery: 0, patternRotation: 0, accentShift: 1, stepBeats: .25, gate: .75 }),
    variation('Deep pocket accents', 'Exaggerates timing deviations and moves the accented notes.', { timingDepth: 1.7, rotateEvery: 0, patternRotation: 1, accentShift: 2, stepBeats: .25, gate: .6 }),
    variation('Rotating groove passes', 'Rotates the pattern on every pass while retaining its timing shape.', { timingDepth: 1, rotateEvery: 1, patternRotation: 0, accentShift: 0, steps: 48, stepBeats: .125, gate: .85 }),
    variation('Countershifted groove fill', 'Starts the groove from a new cell and evolves it every two passes.', { timingDepth: 1.45, rotateEvery: 2, patternRotation: -2, accentShift: 3, steps: 48, stepBeats: .1875, gate: .8 }),
  ],
  markov: [
    variation('Neighbor-state melody', 'Limits movement to adjacent states with a compressed pitch field.', { maxLeap: 1, transitionFocus: 1, stateSpread: .6, reverseStates: false, stepBeats: .375, gate: .9 }),
    variation('Strong transition habits', 'Emphasizes the most likely state transitions.', { maxLeap: 1, transitionFocus: 3.2, stateSpread: 1, reverseStates: false, stepBeats: .25, gate: .8 }),
    variation('Even-weight wandering', 'Flattens transition weights so less likely moves occur more often.', { maxLeap: 2, transitionFocus: .35, stateSpread: 1, reverseStates: false, stepBeats: .25, gate: .55 }),
    variation('Wide quick state jumps', 'Allows the full reachable leap across an expanded state field.', { maxLeap: 2, transitionFocus: .65, stateSpread: 1.5, reverseStates: false, stepBeats: .125, gate: .85 }),
    variation('Mirrored transition landscape', 'Reverses the pitches assigned to the same weighted state network.', { maxLeap: 2, transitionFocus: 2, stateSpread: 1.15, reverseStates: true, stepBeats: .1875, swing: .16, gate: .8 }),
  ],
  euclidean: [
    variation('Three in eight', 'Distributes three attacks across eight slots, rotated one position.', { steps: 32, pulses: 3, euclideanSteps: 8, rotation: 1, pitchRotation: 0, stepBeats: .25, gate: .9 }),
    variation('Five in twelve', 'Spreads five attacks across twelve slots and offsets the pitch stream.', { steps: 36, pulses: 5, euclideanSteps: 12, rotation: 2, pitchRotation: 1, stepBeats: .25, gate: .75 }),
    variation('Seven in sixteen', 'Fits seven crisp attacks into a sixteen-slot cycle.', { steps: 32, pulses: 7, euclideanSteps: 16, rotation: 3, pitchRotation: 0, stepBeats: .1875, gate: .55 }),
    variation('Eleven in sixteen', 'Creates a busy eleven-pulse cycle with a counter-rotated pitch stream.', { steps: 32, pulses: 11, euclideanSteps: 16, rotation: -2, pitchRotation: -1, stepBeats: .125, gate: .8 }),
    variation('Eight in thirteen', 'Uses an odd thirteen-slot loop, with independent rhythm and pitch rotations.', { steps: 39, pulses: 8, euclideanSteps: 13, rotation: 4, pitchRotation: 2, stepBeats: .25, swing: .12, gate: .85 }),
  ],
  polymeter: [
    variation('Long independent lane periods', 'Spreads the authored lane periods apart while retaining their relationships.', { periodScale: 1.5, phaseShift: 0, laneSpacing: 0, stepBeats: .25, gate: .95 }, .9),
    variation('Offset lane entrances', 'Shifts lane phase without changing the pitches or note ordering.', { periodScale: 1, phaseShift: 2, laneSpacing: 0, stepBeats: .25, gate: .7 }),
    variation('Compressed lane collisions', 'Shortens periods so independently cycling lanes meet more often.', { periodScale: .75, phaseShift: 1, laneSpacing: 2, stepBeats: .1875, gate: .6 }),
    variation('Fast register-separated lanes', 'Spreads lane registers while preserving co-prime event cycles.', { periodScale: 1, phaseShift: 0, laneSpacing: 7, steps: 60, stepBeats: .125, gate: .8 }),
    variation('Reverse-lane counterpoint', 'Reverses lane notes where possible and fans their registers inward.', { periodScale: 1.25, phaseShift: -3, laneSpacing: -5, reverseLanes: true, stepBeats: .25, swing: .14, gate: .85 }),
  ],
  'mutating-loop': [
    variation('Rare cell substitutions', 'Changes a few cells between generations and keeps their mutation range narrow.', { mutationChance: .08, generations: 4, mirrorEvery: 0, mutationSpread: .6, steps: 48, stepBeats: .25, gate: .9 }),
    variation('Two-generation alternation', 'Alternates the base line with one mutated generation.', { mutationChance: .32, generations: 2, mirrorEvery: 0, mutationSpread: 1, steps: 32, stepBeats: .25, gate: .75 }),
    variation('Mirror every generation', 'Reverses each mutated generation before it is played.', { mutationChance: .22, generations: 4, mirrorEvery: 1, mutationSpread: .85, steps: 48, stepBeats: .1875, gate: .55 }),
    variation('Rapid cell replacement', 'Replaces most cells at loop boundaries across a longer evolving cycle.', { mutationChance: .8, generations: 6, mirrorEvery: 0, mutationSpread: 1.3, steps: 64, stepBeats: .125, gate: .85 }),
    variation('Wide mirrored mutations', 'Combines a wide mutation pool with a reversal every second generation.', { mutationChance: .55, generations: 4, mirrorEvery: 2, mutationSpread: 1.65, steps: 64, stepBeats: .25, swing: .18, gate: .8 }),
  ],
  'conditional-steps': [
    variation('Breathing chance field', 'Shapes cell probability into a slow swell and retreat.', { probabilityScale: 1, breathe: .8, periodScale: 1, offsetShift: 0, stepBeats: .25, gate: .95 }, .9),
    variation('Half-chance recurrence', 'Makes conditional cells less frequent while retaining an audible pulse field.', { probabilityScale: .65, breathe: .15, periodScale: 1, offsetShift: 0, stepBeats: .25, gate: .75 }),
    variation('Shifted condition clocks', 'Offsets recurring cells and sharpens their articulation.', { probabilityScale: 1.2, breathe: .25, periodScale: .75, offsetShift: 2, stepBeats: .25, gate: .55 }),
    variation('Frequent condition collisions', 'Increases chance and compresses recurrence periods to produce more coincidences.', { probabilityScale: 1.6, breathe: 0, periodScale: .5, offsetShift: 0, stepBeats: .125, gate: .85 }),
    variation('Staggered probability swell', 'Combines stretched condition periods, shifted entrances and a probability swell.', { probabilityScale: 1.25, breathe: .65, periodScale: 1.25, offsetShift: -2, steps: 48, stepBeats: .1875, swing: .16, gate: .8 }),
  ],
  'phrase-arp': [
    variation('Played-order chord phrases', 'Visits each chord in its entered order without an opening chord strike.', { order: 'played', repeats: 1, strum: false, velocityDepth: .5, restShift: 0, stepBeats: .375, gate: .9 }),
    variation('Descending double passes', 'Reads each chord downward twice before advancing.', { order: 'down', repeats: 2, strum: false, velocityDepth: 1, restShift: 1, stepBeats: .25, gate: .7 }),
    variation('Pendulum chord answers', 'Uses up/down traversal with compact gates and a shifted rest pattern.', { order: 'pendulum', repeats: 1, strum: false, velocityDepth: 1.25, restShift: -1, stepBeats: .1875, gate: .55 }),
    variation('Opening chord fanfare', 'Sounds the full chord at the start, then traverses from its center outward.', { order: 'inside-out', repeats: 1, strum: true, velocityDepth: 1, restShift: 0, stepBeats: .125, gate: .85 }),
    variation('Outside-in velocity waves', 'Pairs outer chord tones with exaggerated velocity changes and swung timing.', { order: 'outside-in', repeats: 3, strum: true, velocityDepth: 1.5, restShift: 2, stepBeats: .25, swing: .18, gate: .8 }),
  ],
});

const authoredPatternLabel = study => {
  const config = study.config;
  switch (study.archetype) {
    case 'ordered-chord': return `${config.order} · ${config.octaves || 1} octave${config.octaves > 1 ? 's' : ''}`;
    case 'ratio-canon': return `${config.voices.map(voice => voice.period).join(' : ')} pulse canon`;
    case 'drawn-rows': return `${config.rows.length} drawn contour${config.rows.length > 1 ? 's' : ''}${config.masks ? ' with cutouts' : ''}`;
    case 'parameter-rows': return `${config.pitch.length} pitches / ${config.duration.length} durations`;
    case 'cv-rows': return `${config.pitch.length}-stage ${config.second ? 'parallel voltage rows' : 'voltage addresses'}`;
    case 'gesture': return `${config.points.length}-point ${config.densityFromPressure ? 'pressure field' : 'captured gesture'}`;
    case 'phrase-bank': return `${config.chain.map(index => String.fromCharCode(65 + index)).join('–')} phrase chain`;
    case 'accent-pattern': return `${config.accents.length} accents in ${config.notes.length} steps`;
    case 'tracker': return `${config.rows.length}-row ${config.remember?.length ? 'carried-lock pattern' : 'note and lock pattern'}`;
    case 'groove': return `${config.notes.length}-cell ${config.rotateEvery ? 'rotating groove' : 'timing template'}`;
    case 'markov': return `${config.states.length}-state weighted walk`;
    case 'euclidean': return `${config.pulses} in ${config.steps} · rotation ${config.rotation}`;
    case 'polymeter': return `${config.lanes.map(lane => lane.period).join(' : ')} lane periods`;
    case 'mutating-loop': return `${config.base.length}-cell evolving loop`;
    case 'conditional-steps': return `${config.cells.length} ${config.cells.some(cell => cell.every != null) ? 'recurrence conditions' : 'weighted chance cells'}`;
    case 'phrase-arp': return `${config.chords.length} chords · ${config.order} traversal`;
    default: return study.label;
  }
};

const recipeFor = recipeOrId => {
  const id = typeof recipeOrId === 'string' ? recipeOrId : recipeOrId?.id;
  const recipe = SEQUENCE_SETTING_RECIPES.find(candidate => candidate.id === id);
  if (!recipe) throw new RangeError(`Unknown sequence-settings recipe: ${id}`);
  return recipe;
};

const quantizeNumber = (definition, value, bounds = definition) => {
  const minimum = finite(bounds.min, definition.min);
  const maximum = Math.max(minimum, finite(bounds.max, definition.max));
  const steps = Math.round((value - minimum) / definition.step);
  const quantized = minimum + steps * definition.step;
  return Number(clamp(quantized, minimum, maximum, definition.default).toFixed(10));
};

const dependencySafeDefinitions = study => {
  const definitions = getSequenceParameterDefinitions(study);
  if (study.archetype !== 'euclidean') return definitions;
  const slots = definitions.findIndex(definition => definition.id === 'euclideanSteps');
  const pulses = definitions.findIndex(definition => definition.id === 'pulses');
  if (slots < 0 || pulses < 0 || slots < pulses) return definitions;
  const ordered = [...definitions];
  const [definition] = ordered.splice(slots, 1);
  ordered.splice(pulses, 0, definition);
  return ordered;
};

const effectiveBounds = (study, definition, values) => (
  getSequenceParameterBounds(study, definition.id, values) || definition
);

/** Build the six complete, mechanism-aware settings presets for one study. */
export function createSequenceSettingsPresets(studyOrId) {
  const study = resolveStudy(studyOrId);
  const original = variation(authoredPatternLabel(study), 'The authored note material, cycle and mechanism values for this study.', {}, 1);
  const variations = [original, ...MECHANISM_VARIATIONS[study.archetype]];
  return deepFreeze(variations.map((preset, index) => {
    const recipe = SEQUENCE_SETTING_RECIPES[index];
    return {
      id: `${study.id}:${recipe.id}`,
      label: preset.label,
      description: preset.description,
      snapshot: sanitizeSequencePerformance({
        id: study.id,
        parameters: index === 0 ? createSequenceParameterValues(study) : {
          ...createSequenceParameterValues(study),
          density: 1,
          seed: hashText(`${study.id}:${recipe.id}`),
          ...preset.parameters,
        },
        tempoBpm: study.defaults.tempoBpm * preset.tempoScale,
      }),
    };
  }));
}

export const SEQUENCE_SETTINGS_PRESETS = deepFreeze(Object.fromEntries(
  SEQUENCE_STUDIES.map(study => [study.id, createSequenceSettingsPresets(study)]),
));

/** Apply one factory settings recipe without changing the selected study. */
export function applySequenceSettingsRecipe(sequence, recipeOrId) {
  const current = sanitizeSequencePerformance(sequence);
  const recipe = recipeFor(recipeOrId);
  return SEQUENCE_SETTINGS_PRESETS[current.id].find(preset => preset.id.endsWith(`:${recipe.id}`)).snapshot;
}

const randomNumberValue = (definition, bounds, rng) => {
  const count = Math.floor(Number(((bounds.max - bounds.min) / definition.step).toPrecision(12)));
  const index = Math.min(count, Math.floor(unit(rng) * (count + 1)));
  return quantizeNumber(definition, bounds.min + index * definition.step, bounds);
};

// Dice explores useful performance ranges. The full control ranges remain
// available for intentional silence, very slow structures and extreme pitches.
const RANDOM_PARAMETER_RANGES = deepFreeze({
  steps: [24, 64], stepBeats: [.125, .375], transpose: [-12, 12],
  density: [.72, 1], swing: [-.12, .28], gate: [.6, 1],
  octaves: [1, 2], intervalSpread: [.55, 1.2],
  periodScale: [.5, 1.5], ratioSpread: [.55, 1.6], ramp: [-.45, .65],
  contourScale: [.55, 1.5], voltageScale: [.55, 1.45],
  durationScale: [.65, 1.35], velocityScale: [.8, 1.3], gateScale: [.8, 1.5],
  pressureScale: [.85, 1.7], phraseRise: [-2, 2],
  timingDepth: [0, 1.7], transitionFocus: [.4, 3.2], stateSpread: [.6, 1.5],
  euclideanSteps: [8, 24], laneSpacing: [-6, 6],
  mutationChance: [.1, .75], mutationSpread: [.55, 1.5],
  probabilityScale: [.85, 1.6], breathe: [0, .65], repeats: [1, 3], velocityDepth: [.25, 1.25],
});

const randomBounds = (study, definition, values) => {
  const live = effectiveBounds(study, definition, values);
  const range = RANDOM_PARAMETER_RANGES[definition.id];
  let min = range ? Math.max(live.min, Math.min(live.max, range[0])) : live.min;
  let max = range ? Math.max(min, Math.min(live.max, range[1])) : live.max;
  if (study.archetype === 'euclidean' && definition.id === 'pulses') {
    min = Math.max(3, Math.ceil(values.euclideanSteps * .3));
    max = Math.max(min, Math.floor(values.euclideanSteps * .8));
  }
  return { min, max };
};

const performanceMeasures = compiled => {
  const sounding = compiled.steps.filter(step => step.notes.length);
  const notes = sounding.flatMap(step => step.notes);
  const gateBeats = sounding.flatMap(step => step.notes.map(note => step.duration * note.gate));
  return {
    sounding,
    notes,
    firstBeat: sounding[0]?.at ?? Infinity,
    notesPerBeat: notes.length / compiled.lengthBeats,
    minimumPitch: notes.length ? Math.min(...notes.map(note => note.semitone)) : 0,
    maximumPitch: notes.length ? Math.max(...notes.map(note => note.semitone)) : 0,
    minimumGateBeats: gateBeats.length ? Math.min(...gateBeats) : 0,
    meanGateBeats: gateBeats.length ? gateBeats.reduce((sum, value) => sum + value, 0) / gateBeats.length : 0,
  };
};

const isPlayablePattern = (compiled, metrics) => (
  metrics.sounding.length >= Math.max(4, Math.ceil(compiled.steps.length * .2))
  && metrics.firstBeat * 60 / MIN_RANDOM_TEMPO <= .75
  && metrics.minimumPitch >= -36 && metrics.maximumPitch <= 36
  && metrics.notes.every(note => note.velocity >= .12)
  && metrics.minimumGateBeats * 60 / MAX_RANDOM_TEMPO >= .004
  && metrics.meanGateBeats * 60 / MAX_RANDOM_TEMPO >= .03
  && metrics.notesPerBeat * MIN_RANDOM_TEMPO / 60 >= .6
  && metrics.notesPerBeat * MAX_RANDOM_TEMPO / 60 <= 24
);

function fitPerformanceRange(study, input) {
  let values = createSequenceParameterValues(study, input);
  let compiled = compileSequence(study, { parameters: values });
  let metrics = performanceMeasures(compiled);
  if (metrics.notes.length) {
    // Retain the randomized register where possible; move it only enough to
    // keep the complete pitch field within three octaves either side of root.
    const low = -36 - metrics.minimumPitch + values.transpose;
    const high = 36 - metrics.maximumPitch + values.transpose;
    const transpose = low <= high ? clamp(values.transpose, low, high, 0) : values.transpose;
    // Bound event load across the entire randomized tempo range, including
    // polyphonic conditional cells and independent simultaneous lanes.
    const minimumLength = values.stepBeats * Math.max(
      metrics.notesPerBeat * MAX_RANDOM_TEMPO / 60 / 24,
      .004 * MAX_RANDOM_TEMPO / 60 / metrics.minimumGateBeats,
      .03 * MAX_RANDOM_TEMPO / 60 / metrics.meanGateBeats,
    );
    const maximumLength = values.stepBeats * metrics.notesPerBeat * MIN_RANDOM_TEMPO / 60 / .6;
    const stepBeats = Math.max(1 / 8, Math.min(.5, Math.max(minimumLength, Math.min(maximumLength, values.stepBeats))));
    values = createSequenceParameterValues(study, {
      ...values,
      transpose,
      stepBeats: Math.ceil(stepBeats * 64 - 1e-9) / 64,
    });
    compiled = compileSequence(study, { parameters: values });
    metrics = performanceMeasures(compiled);
  }
  return { values, compiled, metrics };
}

function playableVoltageGates(gates, values) {
  const repaired = gates.map(value => value ? 1 : 0);
  const count = repaired.length;
  if (!count) return repaired;
  const minimum = Math.ceil(count / 2);
  const longRest = repaired.some((_, index) => [0, 1, 2].every(offset => !repaired[(index + offset) % count]));
  if (repaired.reduce((sum, value) => sum + value, 0) < minimum || longRest) {
    // A rotated, evenly spaced safety lattice prevents long silent stretches
    // without pinning any particular editable gate to ON on every dice throw.
    const offset = ((Math.trunc(values.seed || 0) + Math.trunc(values.gateRotation || 0)) % count + count) % count;
    for (let index = 0; index < minimum; index += 1) repaired[(offset + Math.floor(index * count / minimum)) % count] = 1;
  }
  return repaired;
}

function ensurePlayableRandomPattern(study, sampled) {
  let candidate = { ...sampled };
  // Validation uses the actual compiler: combinations of pressure, chance,
  // masks, independent clocks and output thinning cannot be judged in isolation.
  // Deterministic derived seeds also terminate correctly for constant 0/1 RNGs.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = fitPerformanceRange(study, candidate);
    if (isPlayablePattern(result.compiled, result.metrics)) return result.values;
    candidate = { ...result.values, seed: hashText(`${sampled.seed}:${attempt + 1}`) };
    if (attempt === 3) {
      candidate = {
        ...candidate, density: 1,
        pressureScale: Math.max(1.2, candidate.pressureScale || 1),
        probabilityScale: Math.max(1.1, candidate.probabilityScale || 1),
        periodScale: Math.min(1, candidate.periodScale || 1),
        phaseShift: 0, offsetShift: 0,
      };
    }
    if (attempt === 7) {
      candidate = {
        ...candidate, densityFromPressure: false, density: 1,
        patternRotation: 0, gateRotation: 0, rowRotation: 0,
        chainRotation: 0, restShift: 0, reverseRows: false,
        rotation: 0, breathe: Math.min(.4, candidate.breathe || 0),
      };
    }
  }
  // Restore conservative scalar timing when necessary, but retain the newly
  // drawn musical state: recovery must not silently erase a dice-generated graph.
  const original = createSequenceParameterValues(study);
  const recovery = fitPerformanceRange(study, {
    ...original,
    steps: sampled.steps,
    seed: sampled.seed,
    transpose: sampled.transpose,
    swing: sampled.swing,
    gate: sampled.gate,
    pitchMode: sampled.pitchMode,
    stepBeats: .25,
    density: 1,
    pressureScale: 1.2,
    densityFromPressure: false,
    probabilityScale: 1.6,
    breathe: 0,
    ...(sampled.gesturePoints ? { gesturePoints: sampled.gesturePoints } : {}),
    ...(sampled.stagePitches ? { stagePitches: sampled.stagePitches } : {}),
    ...(sampled.stageGates ? { stageGates: playableVoltageGates(sampled.stageGates, sampled) } : {}),
  });
  return recovery.values;
}

/** Randomize every editable parameter, then validate the resulting event cycle. */
export function randomizeSequenceParameters(studyOrId, inputOrRng = {}, maybeRng = Math.random) {
  const study = resolveStudy(studyOrId);
  const rng = typeof inputOrRng === 'function' ? inputOrRng : maybeRng;
  const input = typeof inputOrRng === 'function' ? {} : inputOrRng;
  const values = { ...createSequenceParameterValues(study, input) };
  for (const definition of dependencySafeDefinitions(study)) {
    if (definition.type === 'number') {
      values[definition.id] = randomNumberValue(definition, randomBounds(study, definition, values), rng);
    }
    else if (definition.type === 'boolean') values[definition.id] = unit(rng) >= .5;
    else values[definition.id] = pick(definition.choices, rng).value;
  }
  // Directly drawn values are musical parameters too, not frozen decorations
  // left over from the last pointer edit. Keep pitches and pressure playable.
  if (study.archetype === 'gesture') {
    const count = 4 + Math.floor(unit(rng) * 4);
    values.gesturePoints = Array.from({ length: count }, (_, index) => ({
      time: index === 0 ? 0 : index === count - 1 ? 1 : (index + (unit(rng) - .5) * .5) / (count - 1),
      note: -6 + unit(rng) * 24,
      pressure: .55 + unit(rng) * .45,
    }));
  } else if (study.archetype === 'cv-rows') {
    values.stagePitches = study.config.pitch.map(() => -6 + unit(rng) * 24);
    values.stageGates = (study.config.gates || study.config.pitch).map(() => unit(rng) > .2 ? 1 : 0);
    values.stageGates = playableVoltageGates(values.stageGates, values);
    const bounds = getSequenceParameterBounds(study, 'gateRotation', values);
    values.gateRotation = bounds.min + Math.min(bounds.max - bounds.min, Math.floor(unit(rng) * (bounds.max - bounds.min + 1)));
  }
  return ensurePlayableRandomPattern(study, createSequenceParameterValues(study, values));
}

/** Randomize settings and tempo while retaining the sequence identity. */
export function randomizeSequenceSettings(sequence, rng = Math.random) {
  const current = sanitizeSequencePerformance(sequence);
  return sanitizeSequencePerformance({
    id: current.id,
    parameters: randomizeSequenceParameters(current.id, current.parameters, rng),
    tempoBpm: MIN_RANDOM_TEMPO + (MAX_RANDOM_TEMPO - MIN_RANDOM_TEMPO) * unit(rng),
  });
}

export function nextSequenceId(currentId, direction = 1) {
  const index = SEQUENCE_STUDIES.findIndex(study => study.id === currentId);
  if (index < 0) return direction < 0 ? SEQUENCE_STUDIES.at(-1).id : SEQUENCE_STUDIES[0].id;
  return SEQUENCE_STUDIES[wrap(index + (direction < 0 ? -1 : 1), SEQUENCE_STUDIES.length)].id;
}

export const randomSequenceId = (rng = Math.random) => pick(SEQUENCE_STUDIES, rng).id;

export function nextTuningId(currentId, direction = 1) {
  const index = TUNINGS.findIndex(tuning => tuning.id === currentId);
  if (index < 0) return direction < 0 ? TUNINGS.at(-1).id : TUNINGS[0].id;
  return TUNINGS[wrap(index + (direction < 0 ? -1 : 1), TUNINGS.length)].id;
}

export const randomTuningId = (rng = Math.random) => pick(TUNINGS, rng).id;

/**
 * Reduce current UI state to the complete musical state owned by a master
 * preset. Output level, mono/poly choice, transport, Audio and device state are
 * intentionally absent.
 */
export function capturePerformanceSnapshot(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const incomingSound = source.sound ?? source.state ?? source;
  const method = resolveSynthesisMethod(incomingSound?.methodId);
  const sound = captureSoundState(sanitizeState({ ...incomingSound, methodId: method.id }));
  const tuningId = sanitizeTuningId(source.tuningId ?? incomingSound?.tuningId);
  const sequence = sanitizeSequencePerformance(source.sequence ?? source.sequenceState ?? {});
  return deepFreeze({ sound, sequence, tuningId });
}

/** Restore a master snapshot while retaining performer-owned output and voicing. */
export function applyPerformanceSnapshot(snapshot, currentSound = {}) {
  const captured = capturePerformanceSnapshot(snapshot);
  const performer = sanitizeState(currentSound);
  const sound = sanitizeState({
    ...captured.sound,
    outputLevel: performer.outputLevel,
    voiceMode: performer.voiceMode,
    tuningId: captured.tuningId,
  });
  return deepFreeze({ sound, sequence: captured.sequence, tuningId: captured.tuningId });
}

export const MASTER_PRESET_RECIPES = deepFreeze([
  ['ratio-sunrise', 'Ratio sunrise', 'additive', 'eight-part-saw', 'perforated-ratio-canon', 'spacious', 'just-5-limit-major'],
  ['euclidean-tines', 'Euclidean tines', 'fm', 'electric-tine', 'rotating-euclidean-chords', 'tight', 'edo-19'],
  ['pythagorean-pluck', 'Pythagorean pluck', 'karplus-strong', 'natural-string-pluck', 'rising-latched-chord', 'original', 'pythagorean-12'],
  ['gesture-reed', 'Gesture reed', 'waveguide', 'soft-breathy-pipe', 'captured-control-gesture', 'spacious', 'japanese-yo-12edo'],
  ['slendro-cloud', 'Sléndro cloud', 'granular', 'frozen-cloud', 'density-breathing-stream', 'sparse', 'javanese-slendro-5edo-model'],
  ['pelog-plate', 'Pélog plate', 'modal', 'metal-plate', 'co-prime-lane-cycle', 'dense', 'javanese-pelog-9edo-model'],
  ['lü-vowel-weave', 'Lü vowel weave', 'fof', 'open-low-vowel', 'multiplexed-phrase-arp', 'spacious', 'chinese-twelve-lu'],
  ['meantone-strings', 'Meantone strings', 'padsynth', 'wide-string-ensemble', 'interlocking-live-streams', 'sparse', 'quarter-comma-meantone'],
  ['timbila-step-light', 'Timbila step light', 'wavetable', 'bright-saw', 'accented-step-line', 'tight', 'chopi-timbila-7edo-model'],
  ['thirty-one-bar', 'Thirty-one division bar', 'physical', 'balanced-elastic-bar', 'pulse-divider-chain', 'dense', 'edo-31'],
  ['ambassel-vector', 'Ambassel vector', 'vector-phase', 'narrow-phase-reed', 'groove-template-shift', 'wild', 'amhara-ambassel-12edo-map'],
  ['tritave-chamber', 'Tritave chamber', 'fdn-resonator', 'long-metal-chamber', 'nested-event-phrases', 'spacious', 'bohlen-pierce-13edt'],
  ['harmonic-formants', 'Harmonic formants', 'formant-voice', 'ah-cascade', 'edited-gesture-loop', 'original', 'harmonic-8-16'],
  ['thirteen-orbit', 'Thirteen division orbit', 'rossler', 'slow-irregular-drone', 'bounded-random-walk', 'sparse', 'edo-13'],
  ['twenty-two-beads', 'Twenty-two division beads', 'particle-shaker', 'dense-maraca-texture', 'recurring-conditional-steps', 'tight', 'edo-22'],
  ['fifty-three-sync', 'Fifty-three division sync', 'hard-sync', 'classic-synced-saw', 'octave-spread-cycle', 'wild', 'edo-53'],
].map(([id, label, methodId, presetId, sequenceId, settingsId, tuningId]) => ({
  id,
  label,
  methodId,
  presetId,
  sequenceId,
  settingsId,
  tuningId,
})));

const createMasterPreset = recipe => {
  const method = SYNTHESIS_METHODS.find(candidate => candidate.id === recipe.methodId);
  if (!method) throw new RangeError(`Master preset ${recipe.id} names unknown synthesis method ${recipe.methodId}`);
  const preset = method.presets.find(candidate => candidate.id === recipe.presetId);
  if (!preset) throw new RangeError(`Master preset ${recipe.id} names unknown sound preset ${recipe.presetId}`);
  const study = getSequenceStudy(recipe.sequenceId);
  if (!study) throw new RangeError(`Master preset ${recipe.id} names unknown sequence ${recipe.sequenceId}`);
  const tuning = TUNINGS.find(candidate => candidate.id === recipe.tuningId);
  if (!tuning) throw new RangeError(`Master preset ${recipe.id} names unknown tuning ${recipe.tuningId}`);
  const settings = SEQUENCE_SETTINGS_PRESETS[study.id].find(candidate => candidate.id.endsWith(`:${recipe.settingsId}`));
  if (!settings) throw new RangeError(`Master preset ${recipe.id} names unknown settings ${recipe.settingsId}`);
  return deepFreeze({
    id: recipe.id,
    label: recipe.label,
    description: `${method.label} · ${study.label} · ${tuning.label}.`,
    snapshot: capturePerformanceSnapshot({
      sound: stateFromPreset(method.id, preset.id),
      sequence: settings.snapshot,
      tuningId: tuning.id,
    }),
  });
};

export const SYNTHESAURUS_MASTER_PRESETS = deepFreeze(MASTER_PRESET_RECIPES.map(createMasterPreset));

const assertFiniteTree = (value, path = 'snapshot') => {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${path}.${key}`);
};

/** Validate the storage and ownership contract expected by the master UI. */
export function validatePerformancePresetBank(bank = SYNTHESAURUS_MASTER_PRESETS) {
  if (!Array.isArray(bank) || bank.length < 12) throw new RangeError('Synthesaurus needs at least 12 complete master presets');
  const ids = new Set();
  const snapshots = new Set();
  for (const preset of bank) {
    if (!preset || typeof preset !== 'object') throw new TypeError('Master presets must be objects');
    if (!preset.id || ids.has(preset.id)) throw new RangeError(`Duplicate or missing master preset ID: ${preset.id}`);
    ids.add(preset.id);
    if (typeof preset.label !== 'string' || !preset.label.trim()) throw new TypeError(`Master preset ${preset.id} needs a label`);
    assertFiniteTree(preset.snapshot, `${preset.id}.snapshot`);
    const captured = capturePerformanceSnapshot(preset.snapshot);
    const encoded = JSON.stringify(captured);
    if (encoded !== JSON.stringify(preset.snapshot)) throw new TypeError(`Master preset ${preset.id} is not a sanitized performance snapshot`);
    if (snapshots.has(encoded)) throw new RangeError(`Master preset ${preset.id} duplicates another snapshot`);
    snapshots.add(encoded);
    if (!SYNTHESIS_METHODS.some(method => method.id === captured.sound.methodId)) throw new TypeError(`Master preset ${preset.id} is not a synthesis scene`);
    for (const key of ['outputLevel', 'voiceMode', 'tuningId', 'source', 'audioEnabled', 'playing', 'transport', 'midi']) {
      if (Object.hasOwn(captured.sound, key) || Object.hasOwn(captured, key) && key !== 'tuningId') {
        throw new TypeError(`Master preset ${preset.id} owns performer/runtime field ${key}`);
      }
    }
  }
  return true;
}

validatePerformancePresetBank();

export function instantiateMasterPreset(presetOrId, currentSound = {}) {
  const id = typeof presetOrId === 'string' ? presetOrId : presetOrId?.id;
  const preset = SYNTHESAURUS_MASTER_PRESETS.find(candidate => candidate.id === id);
  if (!preset) throw new RangeError(`Unknown Synthesaurus master preset: ${id}`);
  return applyPerformanceSnapshot(preset.snapshot, currentSound);
}

/**
 * Full master dice: independently chooses and randomizes synthesis, a
 * historical sequence (including every exposed setting and tempo), and tuning.
 */
export function randomizeMasterPerformance(value = {}, rng = Math.random) {
  const source = value && typeof value === 'object' ? value : {};
  const performer = sanitizeState(source.sound ?? source.state ?? source);
  // Select all three axes first so their identity does not depend on how many
  // parameters a particular synthesis method happens to expose.
  const method = pick(SYNTHESIS_METHODS, rng);
  const study = pick(SEQUENCE_STUDIES, rng);
  const tuning = pick(TUNINGS, rng);
  const voiceMode = pick(['mono', 'poly'], rng);
  const initial = {
    ...createDefaultState(method.id),
    outputLevel: performer.outputLevel,
    voiceMode,
    tuningId: tuning.id,
  };
  const sound = randomizeState(initial, rng);
  const sequence = randomizeSequenceSettings({ id: study.id }, rng);
  return applyPerformanceSnapshot(
    { sound, sequence, tuningId: tuning.id },
    { ...performer, voiceMode },
  );
}
