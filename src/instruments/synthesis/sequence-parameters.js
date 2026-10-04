import { SEQUENCE_STUDIES, getSequenceStudy } from './sequence-catalog.js';

const MAX_SEQUENCE_STEPS = 64;
const MAX_SEED = 0xffffffff;
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

const asBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'on') return true;
  if (value === 0 || value === '0' || value === 'false' || value === 'off' || value === '') return false;
  return fallback;
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
  id, label, type: 'number', group: 'mechanism', default: defaultValue, min, max, step, help, ...(unit ? { unit } : {}),
});
const selectDefinition = (id, label, defaultValue, choices, help) => ({
  id, label, type: 'select', group: 'mechanism', default: defaultValue, choices, help,
});
const booleanDefinition = (id, label, defaultValue, help) => ({
  id, label, type: 'boolean', group: 'mechanism', default: defaultValue, help,
});

const commonDefinitions = study => [
  { ...numberDefinition('steps', 'Cycle steps', study.defaults.steps, 1, MAX_SEQUENCE_STEPS, 1, 'Number of scheduled positions before the cycle repeats.', 'steps'), group: 'cycle' },
  { ...numberDefinition('stepBeats', 'Step length', study.defaults.stepBeats, 1 / 64, 4, 1 / 64, 'Length of each position in quarter-note beats.', 'beats'), group: 'cycle' },
  { ...numberDefinition('transpose', 'Transpose', study.defaults.transpose, -96, 96, .1, 'Moves the entire generated line before tuning translation.', 'steps'), group: 'cycle' },
  { ...numberDefinition('density', 'Density', study.defaults.density, 0, 1, .01, 'Probability that each generated note is retained.', '%'), group: 'cycle' },
  { ...numberDefinition('swing', 'Swing', 0, -.49, .49, .01, 'Lengthens one step of each pair and shortens the other.', '%'), group: 'cycle' },
  { ...numberDefinition('gate', 'Gate', .72, .01, 1, .01, 'Scales each note articulation without changing the sequence clock.', '%'), group: 'cycle' },
  { ...numberDefinition('seed', 'Seed', study.defaults.seed, 0, MAX_SEED, 1, 'Reproduces chance, mutation and thinning choices.'), group: 'cycle' },
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
    case 'ratio-canon':
      return [
        numberDefinition('periodScale', 'Pulse spacing', 1, .25, 4, .25, 'Scales the independent pulse periods.', '×'),
        numberDefinition('phaseShift', 'Phase shift', 0, -16, 16, 1, 'Offsets every canon voice against the cycle.', 'steps'),
        numberDefinition('ratioSpread', 'Ratio spread', 1, .25, 2, .01, 'Compresses or expands the pitch ratios around unison.', '×'),
        numberDefinition('ramp', 'Speed ramp', finite(config.ramp, 0), -.9, .9, .01, 'Changes event duration across the cycle.'),
      ];
    case 'drawn-rows':
      return [
        numberDefinition('contourScale', 'Contour height', 1, .25, 2, .01, 'Compresses or expands the drawn pitch contour.', '×'),
        booleanDefinition('reverseContour', 'Reverse drawing', false, 'Reads each drawn control row from right to left.'),
        booleanDefinition('invertMasks', 'Invert cutouts', false, 'Swaps sounding and empty cells in authored row masks.'),
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
        numberDefinition('addressOffset', 'Address offset', 0, -16, 16, 1, 'Rotates addressed pitch-stage selection.', 'stages'),
        numberDefinition('gateRotation', 'Gate rotation', 0, -16, 16, 1, 'Moves the gate pattern around the pitch stages.', 'steps'),
        booleanDefinition('secondVoice', 'Second voltage row', Array.isArray(config.second), 'Enables or removes a parallel pitch-voltage row.'),
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
        numberDefinition('chainRotation', 'Phrase start', 0, -16, 16, 1, 'Rotates which stored phrase starts the chain.', 'phrases'),
        selectDefinition('phraseOrder', 'Phrase direction', 'forward', PHRASE_ORDER_CHOICES, 'Changes event order inside every stored phrase.'),
        numberDefinition('phraseRise', 'Phrase-step rise', 0, -24, 24, .1, 'Adds a cumulative transposition to successive phrases.', 'steps'),
      ];
    case 'accent-pattern':
      return [
        numberDefinition('patternRotation', 'Pattern rotation', 0, -32, 32, 1, 'Rotates notes and their accent positions together.', 'steps'),
        numberDefinition('accentShift', 'Accent offset', 0, -32, 32, 1, 'Moves accents independently of the note pattern.', 'steps'),
        booleanDefinition('reversePattern', 'Reverse pattern', false, 'Reads notes and accents backward.'),
      ];
    case 'tracker':
      return [
        numberDefinition('rowRotation', 'Row start', 0, -32, 32, 1, 'Rotates the tracker row that begins the cycle.', 'rows'),
        booleanDefinition('reverseRows', 'Reverse rows', false, 'Reads the tracker rows from bottom to top.'),
        numberDefinition('velocityScale', 'Row velocity', 1, .1, 2, .01, 'Scales velocity locks without flattening their differences.', '×'),
        numberDefinition('gateScale', 'Row gate', 1, .1, 2, .01, 'Scales gate locks without flattening their differences.', '×'),
      ];
    case 'groove':
      return [
        numberDefinition('timingDepth', 'Groove depth', 1, 0, 2, .01, 'Scales each timing deviation around a straight value of one.', '×'),
        numberDefinition('patternRotation', 'Pattern rotation', 0, -32, 32, 1, 'Rotates notes, timing values and accents together.', 'steps'),
        numberDefinition('accentShift', 'Accent offset', 0, -32, 32, 1, 'Moves accents independently of note timing.', 'steps'),
        numberDefinition('rotateEvery', 'Evolve every', finite(config.rotateEvery, 0), 0, MAX_SEQUENCE_STEPS, 1, 'Rotates the pattern after this many passes; zero disables evolution.', 'passes'),
      ];
    case 'markov':
      return [
        numberDefinition('maxLeap', 'Maximum leap', finite(config.maxLeap, 1), 1, 16, 1, 'Limits how many neighboring states one transition can cross.', 'states'),
        numberDefinition('transitionFocus', 'Transition focus', 1, .25, 4, .01, 'Sharpens or flattens the authored transition weights.', '×'),
        numberDefinition('stateSpread', 'State spread', 1, .25, 2, .01, 'Compresses or expands the pitch-state field.', '×'),
        booleanDefinition('reverseStates', 'Reverse state field', false, 'Mirrors the pitch assigned to each state.'),
      ];
    case 'euclidean':
      return [
        numberDefinition('pulses', 'Pulses', finite(config.pulses, 5), 0, Math.max(1, whole(config.steps, 1, MAX_SEQUENCE_STEPS, 16)), 1, 'Distributes this many attacks as evenly as possible.', 'pulses'),
        numberDefinition('euclideanSteps', 'Pattern slots', finite(config.steps, 16), 1, MAX_SEQUENCE_STEPS, 1, 'Sets the length of the Euclidean gate pattern.', 'slots'),
        numberDefinition('rotation', 'Pattern rotation', finite(config.rotation, 0), -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 1, 'Rotates the distributed attacks around the pattern.', 'steps'),
        numberDefinition('pitchRotation', 'Pitch rotation', 0, -16, 16, 1, 'Rotates the pitch or chord stream independently.', 'events'),
      ];
    case 'polymeter':
      return [
        numberDefinition('periodScale', 'Lane periods', 1, .25, 4, .25, 'Scales every lane period while preserving their relationship.', '×'),
        numberDefinition('phaseShift', 'Lane phase', 0, -16, 16, 1, 'Offsets all lanes against the shared cycle.', 'steps'),
        numberDefinition('laneSpacing', 'Lane spacing', 0, -24, 24, .1, 'Fans lanes apart above and below the center lane.', 'steps'),
        booleanDefinition('reverseLanes', 'Reverse lane notes', false, 'Reads each independent lane backward.'),
      ];
    case 'mutating-loop':
      return [
        numberDefinition('mutationChance', 'Mutation chance', finite(config.probability, .2), 0, 1, .01, 'Sets the chance that each cell changes at a loop boundary.', '%'),
        numberDefinition('generations', 'Generations', finite(config.generations, 4), 1, MAX_SEQUENCE_STEPS, 1, 'Sets how many mutation states form the larger cycle.', 'loops'),
        numberDefinition('mirrorEvery', 'Mirror every', finite(config.mirrorEvery, 0), 0, MAX_SEQUENCE_STEPS, 1, 'Reverses the mutable line at this generation interval; zero disables it.', 'generations'),
        numberDefinition('mutationSpread', 'Mutation spread', 1, .25, 2, .01, 'Compresses or expands the mutation pitch pool.', '×'),
      ];
    case 'conditional-steps':
      return [
        numberDefinition('probabilityScale', 'Chance scale', 1, 0, 2, .01, 'Scales per-cell probability, including otherwise certain cells.', '×'),
        numberDefinition('periodScale', 'Recurrence spacing', 1, .25, 4, .25, 'Scales each cell recurrence period.', '×'),
        numberDefinition('offsetShift', 'Condition offset', 0, -16, 16, 1, 'Moves recurrence conditions against the cycle.', 'steps'),
        numberDefinition('breathe', 'Density breath', finite(config.breathe, 0), 0, 1, .01, 'Shapes probability down and back up across the cycle.', '%'),
      ];
    case 'phrase-arp':
      return [
        selectDefinition('order', 'Traversal', config.order || 'up', ORDER_CHOICES, 'Changes how each held chord is traversed.'),
        numberDefinition('repeats', 'Chord repeats', finite(config.repeats, 1), 1, 8, 1, 'Repeats each chord traversal before advancing.', 'passes'),
        booleanDefinition('strum', 'Chord on first step', Boolean(config.strum), 'Plays the whole chord at the start of each traversal.'),
        numberDefinition('restShift', 'Rest offset', 0, -32, 32, 1, 'Moves authored rests through the generated phrase.', 'steps'),
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

const sanitizeValue = (definition, value) => {
  if (definition.type === 'boolean') return asBoolean(value, definition.default);
  if (definition.type === 'select') {
    const candidate = typeof value === 'string' ? value : definition.default;
    return definition.choices.some(choice => choice.value === candidate) ? candidate : definition.default;
  }
  const sanitized = clamp(value, definition.min, definition.max, definition.default);
  return definition.step >= 1 ? Math.round(sanitized) : sanitized;
};

/** Sanitize a flat UI value map, discarding unknown or malformed entries. */
export function createSequenceParameterValues(studyOrId, input = {}) {
  const study = resolveStudy(studyOrId);
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const values = {};
  for (const definition of getSequenceParameterDefinitions(study)) {
    values[definition.id] = sanitizeValue(definition, source[definition.id]);
  }
  if (study.archetype === 'euclidean') values.pulses = Math.min(values.pulses, values.euclideanSteps);
  return deepFreeze(values);
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
          if (values.phaseShift !== 0) changed.phase = whole(finite(voice.phase, 0) + values.phaseShift, -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 0);
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
      break;
    case 'groove': {
      const length = Math.max(1, config.notes.length);
      if (values.timingDepth !== 1 && Array.isArray(config.timing)) config.timing = config.timing.map(value => clamp(1 + (value - 1) * values.timingDepth, 1 / 16, 16, 1));
      if (values.patternRotation !== 0) {
        config.notes = rotate(config.notes, values.patternRotation);
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
