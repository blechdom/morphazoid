import { SEQUENCE_STUDIES, getSequenceStudy } from './sequence-catalog.js';

const MAX_SEQUENCE_STEPS = 64;
const MAX_SEED = 0xffffffff;
export const MAX_GESTURE_POINTS = 64;
const ORDER_CHOICES = Object.freeze([
  Object.freeze({ value: 'up', label: 'Low to high' }),
  Object.freeze({ value: 'down', label: 'High to low' }),
  Object.freeze({ value: 'pendulum', label: 'Up then down' }),
  Object.freeze({ value: 'inside-out', label: 'Inside out' }),
  Object.freeze({ value: 'outside-in', label: 'Outside in' }),
  Object.freeze({ value: 'played', label: 'As recorded' }),
]);
const PITCH_MODE_CHOICES = Object.freeze([
  Object.freeze({ value: 'nearest', label: 'Nearest tuning note' }),
  Object.freeze({ value: 'contour', label: 'Continuous tuning contour' }),
  Object.freeze({ value: 'original', label: 'Original pitch contour' }),
]);
const PHRASE_ORDER_CHOICES = Object.freeze([
  Object.freeze({ value: 'forward', label: 'Forward' }),
  Object.freeze({ value: 'reverse', label: 'Reverse' }),
  Object.freeze({ value: 'pendulum', label: 'Forward + reverse' }),
]);

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const clone = value => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  }
  return value;
};

const finite = (value, fallback) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() && value.length < 64) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));
const whole = (value, min, max, fallback) => Math.round(clamp(value, min, max, fallback));
const pitch = value => clamp(value, -96, 96, 0);
const modulo = (value, length) => length > 0 ? ((value % length) + length) % length : 0;
const stepped = (value, min, max, step, fallback) => {
  const lower = finite(min, 0);
  const upper = Math.max(lower, finite(max, lower));
  const increment = finite(step, 0);
  const bounded = clamp(value, lower, upper, fallback);
  if (!(increment > 0)) return bounded;
  const requestedUnits = Math.round(Number(((bounded - lower) / increment).toPrecision(12)));
  const maximumUnits = Math.floor(Number(((upper - lower) / increment).toPrecision(12)));
  const units = Math.max(0, Math.min(maximumUnits, requestedUnits));
  return Number((lower + units * increment).toPrecision(12));
};
const canonicalRotationBounds = length => {
  const count = Math.max(1, Math.round(finite(length, 1)));
  const negative = -Math.floor((count - 1) / 2);
  return Object.freeze({
    min: Object.is(negative, -0) ? 0 : negative,
    max: Math.ceil((count - 1) / 2),
  });
};
const greatestCommonDivisor = (left, right) => {
  let a = Math.abs(Math.round(finite(left, 0)));
  let b = Math.abs(Math.round(finite(right, 0)));
  while (b) [a, b] = [b, a % b];
  return a;
};
const leastCommonMultiple = (left, right) => {
  const a = Math.max(1, Math.round(finite(left, 1)));
  const b = Math.max(1, Math.round(finite(right, 1)));
  return a / Math.max(1, greatestCommonDivisor(a, b)) * b;
};
const fundamentalArrayPeriod = values => {
  if (!Array.isArray(values) || values.length < 2) return 1;
  for (let period = 1; period <= values.length; period += 1) {
    if (values.length % period !== 0) continue;
    if (values.every((value, index) => Object.is(value, values[index % period]))) return period;
  }
  return values.length;
};
const ratioCanonPeriod = (voices, periodScale) => (Array.isArray(voices) ? voices : [])
  .reduce((period, voice) => leastCommonMultiple(
    period,
    whole(finite(voice?.period, 1) * periodScale, 1, MAX_SEQUENCE_STEPS, 1),
  ), 1);
const maximumRatioCanonPeriod = voices => {
  let maximum = 1;
  for (let scale = .25; scale <= 4; scale += .25) maximum = Math.max(maximum, ratioCanonPeriod(voices, scale));
  return maximum;
};
const traversalLength = (values, order) => {
  const count = Math.max(1, Array.isArray(values) ? values.length : 1);
  if (order !== 'pendulum') return count;
  return count > 2 ? count * 2 - 2 : count;
};

const asBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'on') return true;
  if (value === 0 || value === '0' || value === 'false' || value === 'off' || value === '') return false;
  return fallback;
};

const sanitizeVoltageGates = (study, input) => {
  if (!Array.isArray(input) || !input.length) return null;
  const gates = study.config.gates || study.config.pitch.map(() => 1);
  return gates.slice(0, MAX_SEQUENCE_STEPS)
    .map((value, index) => asBoolean(input[index], Boolean(value)) ? 1 : 0);
};

const resolveStudy = studyOrId => {
  if (studyOrId == null) return SEQUENCE_STUDIES[0];
  const id = typeof studyOrId === 'string'
    ? studyOrId
    : studyOrId && typeof studyOrId === 'object' && typeof studyOrId.id === 'string'
      ? studyOrId.id
      : null;
  if (!id) throw new TypeError('Sequence study must be a catalog ID or catalog study');
  const study = getSequenceStudy(id);
  if (!study) throw new RangeError(`Unknown sequence study: ${id}`);
  return study;
};

const numberDefinition = (id, label, defaultValue, min, max, step, help, unit = '') => ({
  id, label, type: 'number', group: 'mechanism', default: stepped(defaultValue, min, max, step, min), min, max, step, help, ...(unit ? { unit } : {}),
});
const selectDefinition = (id, label, defaultValue, choices, help) => ({
  id, label, type: 'select', group: 'mechanism', default: defaultValue, choices, help,
});
const booleanDefinition = (id, label, defaultValue, help) => ({
  id, label, type: 'boolean', group: 'mechanism', default: defaultValue, help,
});
const rotationDefinition = (id, label, defaultValue, length, help, unit = 'steps') => {
  const { min, max } = canonicalRotationBounds(length);
  return numberDefinition(id, label, clamp(defaultValue, min, max, 0), min, max, 1, help, unit);
};

const commonDefinitions = study => [
  { ...numberDefinition('steps', 'Rendered steps', study.defaults.steps, 1, MAX_SEQUENCE_STEPS, 1, 'Number of scheduled positions rendered before the cycle repeats.', 'steps'), group: 'cycle' },
  { ...numberDefinition('stepBeats', 'Step length', study.defaults.stepBeats, 1 / 64, 4, 1 / 64, 'Length of each position in quarter-note beats.', 'beats'), group: 'cycle' },
  { ...numberDefinition('transpose', 'Transpose', study.defaults.transpose, -96, 96, .1, 'Moves the authored pitch coordinate before tuning translation.', 'semitones'), group: 'cycle' },
  { ...numberDefinition('density', 'Output density', study.defaults.density, 0, 1, .01, 'Probability that each generated note is retained at the output.', '%'), group: 'cycle' },
  { ...numberDefinition('swing', 'Swing', 0, -.49, .49, .01, 'Lengthens one step of each pair and shortens the other.', '%'), group: 'cycle' },
  { ...numberDefinition('gate', 'Gate', .72, .01, 1, .01, 'Scales each note articulation without changing the sequence clock.', '%'), group: 'cycle' },
  { ...numberDefinition('seed', 'Seed', study.defaults.seed, 0, MAX_SEED, 1, 'Changes only reproducible chance, mutation and output-thinning choices.'), group: 'cycle' },
  {
    ...selectDefinition(
      'pitchMode',
      'Pitch mapping',
      ['gesture', 'drawn-rows'].includes(study.archetype) ? 'contour' : 'nearest',
      PITCH_MODE_CHOICES,
      'Snaps to tuning notes, follows a continuous tuned contour or preserves the original pitch contour.',
    ),
    group: 'cycle',
  },
];

const mechanismDefinitions = study => {
  const config = study.config;
  switch (study.archetype) {
    case 'ordered-chord':
      return [
        selectDefinition('order', 'Traversal', config.order || 'up', ORDER_CHOICES, 'Changes how the held intervals are visited.'),
        numberDefinition('octaves', 'Octave span', finite(config.octaves, 1), 1, 8, 1, 'Repeats the interval set through this many octaves.', 'octaves'),
        numberDefinition('intervalSpread', 'Interval spread', 1, .25, 2, .01, 'Compresses or expands every interval around the root.', '×'),
      ];
    case 'ratio-canon': {
      const { min: phaseMin, max: phaseMax } = canonicalRotationBounds(maximumRatioCanonPeriod(config.voices));
      return [
        numberDefinition('periodScale', 'Pulse spacing', 1, .25, 4, .25, 'Scales the independent pulse periods.', '×'),
        numberDefinition('phaseShift', 'Phase shift', 0, phaseMin, phaseMax, 1, 'Offsets every canon voice against the cycle.', 'steps'),
        numberDefinition('ratioSpread', 'Ratio spread', 1, .25, 2, .01, 'Compresses or expands the pitch ratios around unison.', '×'),
        numberDefinition('ramp', 'Speed ramp', finite(config.ramp, 0), -.9, .9, .01, 'Changes event duration across the cycle.'),
      ];
    }
    case 'drawn-rows':
      return [
        numberDefinition('contourScale', 'Contour height', 1, .25, 2, .01, 'Compresses or expands the drawn pitch contour.', '×'),
        booleanDefinition('reverseContour', 'Reverse drawing', false, 'Reads each drawn control row from right to left.'),
        ...(Array.isArray(config.masks) ? [booleanDefinition('invertMasks', 'Invert cutouts', false, 'Swaps sounding and empty cells in authored row masks.')] : []),
      ];
    case 'parameter-rows':
      return [
        numberDefinition('durationScale', 'Duration row', 1, .25, 4, .01, 'Scales the authored duration lane.', '×'),
        numberDefinition('velocityScale', 'Velocity row', 1, .1, 2, .01, 'Scales the authored velocity lane.', '×'),
        numberDefinition('gateScale', 'Gate row', 1, .1, 2, .01, 'Scales the authored articulation lane.', '×'),
        booleanDefinition('reverseRows', 'Reverse rows', false, 'Reads every parameter lane in reverse.'),
      ];
    case 'cv-rows':
      return [
        rotationDefinition('addressOffset', 'Address offset', 0, config.pitch?.length, 'Rotates addressed pitch-stage selection.', 'stages'),
        ...(Array.isArray(config.gates) && config.gates.length > 1
          ? [rotationDefinition('gateRotation', 'Gate rotation', 0, fundamentalArrayPeriod(config.gates), 'Moves the gate pattern around the pitch stages.')]
          : []),
        ...(Array.isArray(config.second) ? [booleanDefinition('secondVoice', 'Second voltage row', true, 'Enables or removes the authored parallel pitch-voltage row.')] : []),
        numberDefinition('voltageScale', 'Voltage range', 1, .25, 2, .01, 'Compresses or expands pitch, transpose and second-row voltages.', '×'),
      ];
    case 'gesture':
      return [
        numberDefinition('contourScale', 'Gesture height', 1, .25, 2, .01, 'Compresses or expands the recorded pitch gesture.', '×'),
        numberDefinition('pressureScale', 'Pressure', 1, .1, 2, .01, 'Scales velocity and pressure-controlled density.', '×'),
        booleanDefinition('reverseGesture', 'Reverse gesture', false, 'Mirrors the captured gesture in time.'),
        booleanDefinition('densityFromPressure', 'Pressure controls density', Boolean(config.densityFromPressure), 'Uses captured pressure as the chance of each attack.'),
      ];
    case 'phrase-bank':
      return [
        rotationDefinition('chainRotation', 'Phrase start', 0, fundamentalArrayPeriod(config.chain), 'Rotates which stored phrase starts the chain.', 'phrases'),
        selectDefinition('phraseOrder', 'Phrase direction', 'forward', PHRASE_ORDER_CHOICES, 'Changes event order inside every stored phrase.'),
        numberDefinition('phraseRise', 'Phrase-step rise', 0, -24, 24, .1, 'Adds a cumulative transposition to successive phrases.', 'steps'),
      ];
    case 'accent-pattern':
      return [
        rotationDefinition('patternRotation', 'Pattern rotation', 0, config.notes?.length, 'Rotates notes and their accent positions together.'),
        rotationDefinition('accentShift', 'Accent offset', 0, config.notes?.length, 'Moves accents independently of the note pattern.'),
        booleanDefinition('reversePattern', 'Reverse pattern', false, 'Reads notes and accents backward.'),
      ];
    case 'tracker':
      return [
        rotationDefinition('rowRotation', 'Row start', 0, config.rows?.length, 'Rotates the tracker row that begins the cycle.', 'rows'),
        booleanDefinition('reverseRows', 'Reverse rows', false, 'Reads the tracker rows from bottom to top.'),
        numberDefinition('velocityScale', 'Row velocity', 1, .1, 2, .01, 'Scales velocity locks without flattening their differences.', '×'),
        numberDefinition('gateScale', 'Row gate', 1, .1, 2, .01, 'Scales gate locks without flattening their differences.', '×'),
        ...(Array.isArray(config.remember) && config.remember.length ? [
          booleanDefinition('carryVelocity', 'Carry velocity', config.remember.includes('velocity'), 'Keeps the previous velocity on rows without a velocity lock.'),
          booleanDefinition('carryGate', 'Carry gate', config.remember.includes('gate'), 'Keeps the previous gate on rows without a gate lock.'),
        ] : []),
      ];
    case 'groove':
      return [
        numberDefinition('timingDepth', 'Groove depth', 1, 0, 2, .01, 'Scales each timing deviation around a straight value of one.', '×'),
        rotationDefinition('patternRotation', 'Pattern rotation', 0, config.notes?.length, 'Rotates notes, timing values and accents together.'),
        rotationDefinition('accentShift', 'Accent offset', 0, config.notes?.length, 'Moves accents independently of note timing.'),
        numberDefinition('rotateEvery', 'Evolve every', finite(config.rotateEvery, 0), 0,
          Math.max(0, Math.floor((MAX_SEQUENCE_STEPS - 1) / Math.max(1, config.notes?.length || 1))), 1,
          'Rotates the pattern after this many passes; zero disables evolution.', 'passes'),
      ];
    case 'markov':
      {
        const authoredLeap = Math.max(1, ...(config.transitions || []).map(row => Math.floor((row?.length || 1) / 2)));
        const reachableLeap = Math.max(1, Math.min(Math.max(1, (config.states?.length || 1) - 1), authoredLeap));
      return [
        numberDefinition('maxLeap', 'Maximum leap', clamp(config.maxLeap, 1, reachableLeap, 1), 1, reachableLeap, 1, 'Limits how many neighboring states one transition can cross.', 'states'),
        numberDefinition('transitionFocus', 'Transition focus', 1, .25, 4, .01, 'Sharpens or flattens the authored transition weights.', '×'),
        numberDefinition('stateSpread', 'State spread', 1, .25, 2, .01, 'Compresses or expands the pitch-state field.', '×'),
        booleanDefinition('reverseStates', 'Reverse state field', false, 'Mirrors the pitch assigned to each state.'),
      ];
      }
    case 'euclidean':
      return [
        numberDefinition('pulses', 'Pulses', finite(config.pulses, 5), 0, MAX_SEQUENCE_STEPS, 1, 'Distributes this many attacks as evenly as possible.', 'pulses'),
        numberDefinition('euclideanSteps', 'Euclidean slots', finite(config.steps, 16), 1, MAX_SEQUENCE_STEPS, 1, 'Sets the length of the Euclidean gate pattern.', 'slots'),
        numberDefinition('rotation', 'Pattern rotation', finite(config.rotation, 0), -31, 32, 1, 'Rotates the distributed attacks around the pattern.', 'steps'),
        numberDefinition('pitchRotation', 'Pitch rotation', 0, -31, 32, 1, 'Rotates the pitch or chord stream independently.', 'events'),
      ];
    case 'polymeter':
      return [
        numberDefinition('periodScale', 'Lane periods', 1, .25, 4, .25, 'Scales every lane period while preserving their relationship.', '×'),
        numberDefinition('phaseShift', 'Lane phase', 0, -16, 16, 1, 'Offsets all lanes against the shared cycle.', 'steps'),
        numberDefinition('laneSpacing', 'Lane spacing', 0, -24, 24, .1, 'Fans lanes apart above and below the center lane.', 'steps'),
        ...(config.lanes?.some(lane => Array.isArray(lane.notes) && lane.notes.length > 1)
          ? [booleanDefinition('reverseLanes', 'Reverse lane notes', false, 'Reads each independent lane backward.')]
          : []),
      ];
    case 'mutating-loop':
      {
        const maximumGenerations = Math.max(1, Math.ceil(MAX_SEQUENCE_STEPS / Math.max(1, config.base?.length || 1)));
      return [
        numberDefinition('mutationChance', 'Mutation chance', finite(config.probability, .2), 0, 1, .01, 'Sets the chance that each cell changes at a loop boundary.', '%'),
        numberDefinition('generations', 'Generations', finite(config.generations, 4), 1, maximumGenerations, 1, 'Sets how many mutation states form the larger cycle.', 'loops'),
        numberDefinition('mirrorEvery', 'Mirror every', finite(config.mirrorEvery, 0), 0, Math.max(0, maximumGenerations - 1), 1, 'Reverses the mutable line at this generation interval; zero disables it.', 'generations'),
        numberDefinition('mutationSpread', 'Mutation spread', 1, .25, 2, .01, 'Compresses or expands the mutation pitch pool.', '×'),
      ];
      }
    case 'conditional-steps':
      return [
        numberDefinition('probabilityScale', 'Chance scale', 1, 0, 2, .01, 'Scales per-cell probability, including otherwise certain cells.', '×'),
        ...(config.cells?.some(cell => cell.every != null) ? [
          numberDefinition('periodScale', 'Recurrence spacing', 1, .25, 4, .25, 'Scales each cell recurrence period.', '×'),
          numberDefinition('offsetShift', 'Condition offset', 0, -16, 16, 1, 'Moves recurrence conditions against the cycle.', 'steps'),
        ] : []),
        numberDefinition('breathe', 'Density breath', finite(config.breathe, 0), 0, 1, .01, 'Shapes probability up and back down across the cycle.', '%'),
      ];
    case 'phrase-arp':
      return [
        selectDefinition('order', 'Traversal', config.order || 'up', ORDER_CHOICES, 'Changes how each held chord is traversed.'),
        numberDefinition('repeats', 'Chord repeats', finite(config.repeats, 1), 1, 8, 1, 'Repeats each chord traversal before advancing.', 'passes'),
        booleanDefinition('strum', 'Opening chord', Boolean(config.strum), 'Plays the whole chord at the start of each traversal.'),
        ...(Array.isArray(config.rests) ? [numberDefinition('restShift', 'Rest offset', 0, -31, 32, 1, 'Moves authored rests through the generated phrase.', 'steps')] : []),
        ...(Array.isArray(config.velocityCycle) ? [numberDefinition('velocityDepth', 'Velocity depth', 1, 0, 2, .01, 'Compresses or expands the authored velocity differences around their mean.', '×')] : []),
      ];
    default:
      throw new RangeError(`Unsupported sequence archetype: ${study.archetype}`);
  }
};

/** Return immutable UI descriptors for the common cycle and selected mechanism. */
export function getSequenceParameterDefinitions(studyOrId) {
  const study = resolveStudy(studyOrId);
  return deepFreeze([...commonDefinitions(study), ...mechanismDefinitions(study)]);
}

const sanitizeValue = (definition, value, bounds = definition) => {
  if (definition.type === 'boolean') return asBoolean(value, definition.default);
  if (definition.type === 'select') {
    const candidate = typeof value === 'string' ? value : definition.default;
    return definition.choices.some(choice => choice.value === candidate) ? candidate : definition.default;
  }
  return stepped(value, bounds.min, bounds.max, definition.step, definition.default);
};

const dependentBounds = (study, definition, values) => {
  let { min, max } = definition;
  const renderedSteps = whole(values.steps, 1, MAX_SEQUENCE_STEPS, study.defaults.steps);
  if (study.archetype === 'ordered-chord' && definition.id === 'octaves'
    && ['up', 'played', 'pendulum'].includes(values.order)) {
    max = Math.max(1, Math.min(8, Math.ceil(renderedSteps / Math.max(1, study.config.intervals?.length || 1))));
  } else if (study.archetype === 'ratio-canon' && definition.id === 'phaseShift') {
    const scale = stepped(values.periodScale, .25, 4, .25, 1);
    ({ min, max } = canonicalRotationBounds(ratioCanonPeriod(study.config.voices, scale)));
  } else if (study.archetype === 'cv-rows' && definition.id === 'gateRotation') {
    const gates = sanitizeVoltageGates(study, values.stageGates) || study.config.gates;
    ({ min, max } = canonicalRotationBounds(fundamentalArrayPeriod(gates)));
  } else if (study.archetype === 'euclidean' && definition.id === 'pulses') {
    max = whole(values.euclideanSteps, 1, renderedSteps, Math.min(study.config.steps, renderedSteps));
  } else if (study.archetype === 'euclidean' && definition.id === 'euclideanSteps') {
    min = Math.max(1, whole(values.pulses, 0, renderedSteps, Math.min(study.config.pulses, renderedSteps)));
    max = renderedSteps;
  } else if (study.archetype === 'euclidean' && definition.id === 'rotation') {
    const slots = whole(values.euclideanSteps, 1, renderedSteps, Math.min(study.config.steps, renderedSteps));
    const pulses = whole(values.pulses, 0, slots, Math.min(study.config.pulses, slots));
    const period = pulses === 0 || pulses === slots ? 1 : slots / greatestCommonDivisor(slots, pulses);
    ({ min, max } = canonicalRotationBounds(period));
  } else if (study.archetype === 'euclidean' && definition.id === 'pitchRotation') {
    ({ min, max } = canonicalRotationBounds(study.config.pitches?.length));
  } else if (study.archetype === 'groove' && definition.id === 'rotateEvery') {
    max = Math.max(0, Math.floor((renderedSteps - 1)
      / Math.max(1, study.config.notes?.length || 1)));
  } else if (study.archetype === 'mutating-loop' && ['generations', 'mirrorEvery'].includes(definition.id)) {
    const loops = Math.max(1, Math.ceil(renderedSteps / Math.max(1, study.config.base?.length || 1)));
    if (definition.id === 'generations') max = loops;
    else max = Math.max(0, Math.min(loops - 1, whole(values.generations, 1, loops, finite(study.config.generations, 4)) - 1));
  } else if (study.archetype === 'phrase-arp' && definition.id === 'repeats') {
    const order = ORDER_CHOICES.some(choice => choice.value === values.order) ? values.order : study.config.order;
    const firstChord = Array.isArray(study.config.chords?.[0]) ? study.config.chords[0] : [0];
    max = Math.max(1, Math.min(8, Math.ceil(renderedSteps / traversalLength(firstChord, order))));
  } else if (study.archetype === 'phrase-arp' && definition.id === 'restShift') {
    ({ min, max } = canonicalRotationBounds(renderedSteps));
  }
  return { min, max };
};

/** Current effective range for controls whose useful domain depends on cycle settings. */
export function getSequenceParameterBounds(studyOrId, parameterId, values = {}) {
  const study = resolveStudy(studyOrId);
  const definitions = getSequenceParameterDefinitions(study);
  const definition = definitions.find(candidate => candidate.id === parameterId);
  if (!definition || definition.type !== 'number') return null;
  const source = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const context = Object.fromEntries(definitions.map(candidate => [
    candidate.id,
    sanitizeValue(candidate, source[candidate.id]),
  ]));
  if (study.archetype === 'cv-rows') context.stageGates = sanitizeVoltageGates(study, source.stageGates);
  return deepFreeze(dependentBounds(study, definition, context));
}

/** Sanitize a flat UI value map, discarding unknown or malformed entries. */
export function createSequenceParameterValues(studyOrId, input = {}) {
  const study = resolveStudy(studyOrId);
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const values = {};
  const definitions = getSequenceParameterDefinitions(study);
  for (const definition of definitions) {
    // An edited gate drawing can have a longer fundamental period than the
    // historical default. Do not clip its saved phase to the old descriptor.
    const bounds = study.archetype === 'cv-rows' && definition.id === 'gateRotation'
      ? dependentBounds(study, definition, source) : definition;
    values[definition.id] = sanitizeValue(definition, source[definition.id], bounds);
  }
  // Optional authored data belongs to the same saved parameter snapshot as the
  // scalar controls. Omitting it keeps legacy/default snapshots byte-compatible.
  if (study.archetype === 'gesture' && Array.isArray(source.gesturePoints)) {
    const points = sanitizeGesturePoints(source.gesturePoints);
    if (points) values.gesturePoints = points;
  }
  if (study.archetype === 'cv-rows') {
    if (Array.isArray(source.stagePitches) && source.stagePitches.length) {
      values.stagePitches = study.config.pitch.slice(0, MAX_SEQUENCE_STEPS)
        .map((value, index) => pitch(finite(source.stagePitches[index], value)));
    }
    const gates = sanitizeVoltageGates(study, source.stageGates);
    if (gates) values.stageGates = gates;
  }
  for (const definition of definitions) {
    if (definition.type !== 'number') continue;
    const { min, max } = dependentBounds(study, definition, values);
    values[definition.id] = sanitizeValue(definition, values[definition.id], { min, max });
  }
  return deepFreeze(values);
}

/** Bounded editable time functions. Null means use the study's original data. */
export function sanitizeGesturePoints(input) {
  if (!Array.isArray(input)) return null;
  const points = input.slice(0, MAX_GESTURE_POINTS).flatMap(point => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return [];
    if (![point.time, point.note, point.pressure].every(value => Number.isFinite(finite(value, NaN)))) return [];
    return [{ time: clamp(point.time, 0, 1, 0), note: pitch(point.note), pressure: clamp(point.pressure, 0, 1, .7) }];
  }).sort((left, right) => left.time - right.time);
  const unique = points.filter((point, index) => !index || point.time - points[index - 1].time >= .0001);
  if (unique.length < 2) return null;
  unique[0].time = 0;
  unique[unique.length - 1].time = 1;
  return deepFreeze(unique);
}

const rotate = (values, amount) => {
  if (!Array.isArray(values) || values.length < 2 || amount === 0) return Array.isArray(values) ? [...values] : values;
  const offset = modulo(Math.round(amount), values.length);
  return offset === 0 ? [...values] : [...values.slice(-offset), ...values.slice(0, -offset)];
};

const mapPitches = (value, transform) => {
  if (Array.isArray(value)) return value.map(child => mapPitches(child, transform));
  return typeof value === 'number' && Number.isFinite(value) ? pitch(transform(value)) : value;
};

const mapAccents = (accents, length, transform) => Array.isArray(accents)
  ? accents.map(value => modulo(transform(whole(value, -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 0)), Math.max(1, length)))
  : accents;

const applyMechanismValues = (study, config, values) => {
  switch (study.archetype) {
    case 'ordered-chord':
      config.order = values.order;
      config.octaves = values.octaves;
      if (values.intervalSpread !== 1) config.intervals = mapPitches(config.intervals, note => note * values.intervalSpread);
      break;
    case 'ratio-canon':
      if (values.periodScale !== 1 || values.phaseShift !== 0 || values.ratioSpread !== 1) {
        config.voices = config.voices.map(voice => {
          const changed = { ...voice };
          if (values.periodScale !== 1) changed.period = whole(voice.period * values.periodScale, 1, MAX_SEQUENCE_STEPS, 1);
          if (values.phaseShift !== 0) {
            const period = whole(changed.period, 1, MAX_SEQUENCE_STEPS, 1);
            changed.phase = modulo(finite(voice.phase, 0) + values.phaseShift, period);
          }
          if (values.ratioSpread !== 1) changed.pitchRatio = clamp(Math.pow(Math.max(1 / 256, finite(voice.pitchRatio, 1)), values.ratioSpread), 1 / 256, 256, 1);
          return changed;
        });
      }
      if (Object.hasOwn(config, 'ramp') || values.ramp !== 0) config.ramp = values.ramp;
      break;
    case 'drawn-rows':
      if (values.contourScale !== 1) config.rows = mapPitches(config.rows, note => note * values.contourScale);
      if (values.reverseContour) {
        config.rows = config.rows.map(row => [...row].reverse());
        if (Array.isArray(config.masks)) config.masks = config.masks.map(row => [...row].reverse());
        if (Array.isArray(config.velocities)) config.velocities = config.velocities.map(row => [...row].reverse());
      }
      if (values.invertMasks && Array.isArray(config.masks)) config.masks = config.masks.map(row => row.map(cell => cell ? 0 : 1));
      break;
    case 'parameter-rows':
      if (values.durationScale !== 1) config.duration = config.duration.map(value => clamp(value * values.durationScale, 1 / 16, 16, 1));
      if (values.velocityScale !== 1) config.velocity = config.velocity.map(value => clamp(value * values.velocityScale, .01, 1, .72));
      if (values.gateScale !== 1) config.gate = config.gate.map(value => clamp(value * values.gateScale, .01, 1, .72));
      if (values.reverseRows) {
        for (const key of ['pitch', 'velocity', 'gate', 'duration']) if (Array.isArray(config[key])) config[key].reverse();
      }
      break;
    case 'cv-rows': {
      const pitchCount = Math.max(1, config.pitch.length);
      if (values.addressOffset !== 0) {
        const addresses = Array.isArray(config.address) ? config.address : config.pitch.map((_, index) => index);
        config.address = addresses.map(value => modulo(whole(value, 0, pitchCount - 1, 0) + values.addressOffset, pitchCount));
      }
      if (values.gateRotation !== 0 && Array.isArray(config.gates)) config.gates = rotate(config.gates, values.gateRotation);
      if (!values.secondVoice) {
        if (Array.isArray(config.second)) delete config.second;
      } else if (!Array.isArray(config.second)) {
        config.second = config.pitch.map(note => typeof note === 'number' ? pitch(note + 7) : null);
      }
      if (values.voltageScale !== 1) {
        for (const key of ['pitch', 'transpose', 'second']) {
          if (Array.isArray(config[key])) config[key] = mapPitches(config[key], note => note * values.voltageScale);
        }
      }
      break;
    }
    case 'gesture':
      config.points = config.points.map(point => ({
        ...point,
        note: values.contourScale === 1 ? point.note : pitch(point.note * values.contourScale),
        pressure: values.pressureScale === 1 ? point.pressure : clamp(point.pressure * values.pressureScale, 0, 1, .7),
      }));
      if (values.reverseGesture) config.points = config.points.map(point => ({ ...point, time: 1 - point.time })).reverse();
      if (Object.hasOwn(config, 'densityFromPressure') || values.densityFromPressure) config.densityFromPressure = values.densityFromPressure;
      break;
    case 'phrase-bank':
      if (values.chainRotation !== 0) config.chain = rotate(config.chain, values.chainRotation);
      if (values.phraseOrder !== 'forward') {
        config.phrases = config.phrases.map(phrase => {
          const reversed = [...phrase].reverse();
          return values.phraseOrder === 'reverse' || phrase.length < 2
            ? reversed
            : [...phrase, ...reversed.slice(1)];
        });
      }
      if (values.phraseRise !== 0) {
        const transpositions = Array.isArray(config.phraseTranspose) ? config.phraseTranspose : [];
        config.phraseTranspose = config.chain.map((_, index) => pitch(finite(transpositions[index], 0) + index * values.phraseRise));
      }
      break;
    case 'accent-pattern': {
      const length = Math.max(1, config.notes.length);
      if (values.reversePattern) {
        config.notes.reverse();
        config.accents = mapAccents(config.accents, length, value => length - 1 - value);
      }
      if (values.patternRotation !== 0) {
        config.notes = rotate(config.notes, values.patternRotation);
        config.accents = mapAccents(config.accents, length, value => value + values.patternRotation);
      }
      if (values.accentShift !== 0) config.accents = mapAccents(config.accents, length, value => value + values.accentShift);
      break;
    }
    case 'tracker':
      if (values.rowRotation !== 0) config.rows = rotate(config.rows, values.rowRotation);
      if (values.reverseRows) config.rows.reverse();
      if (values.velocityScale !== 1 || values.gateScale !== 1) {
        config.rows = config.rows.map(row => ({
          ...row,
          ...(Number.isFinite(row.velocity) && values.velocityScale !== 1 ? { velocity: clamp(row.velocity * values.velocityScale, .01, 1, .72) } : {}),
          ...(Number.isFinite(row.gate) && values.gateScale !== 1 ? { gate: clamp(row.gate * values.gateScale, .01, 1, .72) } : {}),
        }));
      }
      if (Object.hasOwn(values, 'carryVelocity') || Object.hasOwn(values, 'carryGate')) {
        const selected = new Set([values.carryVelocity ? 'velocity' : null, values.carryGate ? 'gate' : null].filter(Boolean));
        const existing = Array.isArray(config.remember) ? config.remember.filter(key => selected.delete(key)) : [];
        config.remember = [...existing, ...selected];
      }
      break;
    case 'groove': {
      const length = Math.max(1, config.notes.length);
      if (values.timingDepth !== 1 && Array.isArray(config.timing)) config.timing = config.timing.map(value => clamp(1 + (value - 1) * values.timingDepth, 1 / 16, 16, 1));
      if (values.patternRotation !== 0) {
        config.notes = rotate(config.notes, values.patternRotation);
        if (Array.isArray(config.timing)) config.timing = rotate(config.timing, values.patternRotation);
        config.accents = mapAccents(config.accents, length, value => value + values.patternRotation);
      }
      if (values.accentShift !== 0) config.accents = mapAccents(config.accents, length, value => value + values.accentShift);
      if (Object.hasOwn(config, 'rotateEvery') || values.rotateEvery !== 0) config.rotateEvery = values.rotateEvery;
      break;
    }
    case 'markov':
      config.maxLeap = values.maxLeap;
      if (values.transitionFocus !== 1) config.transitions = config.transitions.map(row => row.map(weight => Math.pow(Math.max(0, finite(weight, 0)), values.transitionFocus)));
      if (values.stateSpread !== 1) config.states = mapPitches(config.states, note => note * values.stateSpread);
      if (values.reverseStates) config.states.reverse();
      break;
    case 'euclidean':
      config.pulses = values.pulses;
      config.steps = values.euclideanSteps;
      config.rotation = values.rotation;
      if (values.pitchRotation !== 0) config.pitches = rotate(config.pitches, values.pitchRotation);
      break;
    case 'polymeter': {
      const center = (config.lanes.length - 1) / 2;
      config.lanes = config.lanes.map((lane, index) => {
        const changed = { ...lane, notes: [...lane.notes] };
        if (values.periodScale !== 1) changed.period = whole(lane.period * values.periodScale, 1, MAX_SEQUENCE_STEPS, 1);
        if (values.phaseShift !== 0) changed.phase = whole(finite(lane.phase, 0) + values.phaseShift, -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 0);
        if (values.laneSpacing !== 0) changed.notes = mapPitches(changed.notes, note => note + (index - center) * values.laneSpacing);
        if (values.reverseLanes) changed.notes.reverse();
        return changed;
      });
      break;
    }
    case 'mutating-loop':
      config.probability = values.mutationChance;
      if (Object.hasOwn(config, 'generations') || values.generations !== 4) config.generations = values.generations;
      if (Object.hasOwn(config, 'mirrorEvery') || values.mirrorEvery !== 0) config.mirrorEvery = values.mirrorEvery;
      if (values.mutationSpread !== 1) config.mutationSet = mapPitches(config.mutationSet, note => note * values.mutationSpread);
      break;
    case 'conditional-steps':
      if (values.probabilityScale !== 1 || values.periodScale !== 1 || values.offsetShift !== 0) {
        config.cells = config.cells.map(cell => {
          const changed = { ...cell };
          if (values.probabilityScale !== 1) changed.probability = clamp(finite(cell.probability, 1) * values.probabilityScale, 0, 1, 1);
          if (values.periodScale !== 1 && cell.every != null) changed.every = whole(cell.every * values.periodScale, 1, MAX_SEQUENCE_STEPS, 1);
          if (values.offsetShift !== 0 && cell.every != null) changed.offset = whole(finite(cell.offset, 0) + values.offsetShift, -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 0);
          return changed;
        });
      }
      if (Object.hasOwn(config, 'breathe') || values.breathe !== 0) config.breathe = values.breathe;
      break;
    case 'phrase-arp':
      config.order = values.order;
      if (Object.hasOwn(config, 'repeats') || values.repeats !== 1) config.repeats = values.repeats;
      if (Object.hasOwn(config, 'strum') || values.strum) config.strum = values.strum;
      if (values.restShift !== 0 && Array.isArray(config.rests)) {
        const length = Math.max(1, values.steps);
        config.rests = config.rests.map(index => modulo(index + values.restShift, length));
      }
      if (Array.isArray(config.velocityCycle) && values.velocityDepth !== 1) {
        const mean = config.velocityCycle.reduce((sum, value) => sum + finite(value, .72), 0) / config.velocityCycle.length;
        config.velocityCycle = config.velocityCycle.map(value => clamp(mean + (finite(value, mean) - mean) * values.velocityDepth, .01, 1, mean));
      }
      break;
    default:
      throw new RangeError(`Unsupported sequence archetype: ${study.archetype}`);
  }
};

/**
 * Apply sanitized controls to a detached config clone and compiler option map.
 * The catalog study and caller-owned input are never retained or mutated.
 */
export function applySequenceParameterValues(studyOrId, input = {}) {
  const study = resolveStudy(studyOrId);
  const values = createSequenceParameterValues(study, input);
  const config = clone(study.config);
  if (values.gesturePoints) config.points = clone(values.gesturePoints);
  if (values.stagePitches) config.pitch = [...values.stagePitches];
  if (values.stageGates) config.gates = [...values.stageGates];
  applyMechanismValues(study, config, values);
  const options = {
    steps: values.steps,
    stepBeats: values.stepBeats,
    transpose: values.transpose,
    density: values.density,
    swing: values.swing,
    gate: values.gate,
    seed: values.seed,
    pitchMode: values.pitchMode,
  };
  return deepFreeze({ config, options, values });
}
