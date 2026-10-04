import { getSequenceStudy } from './sequence-catalog.js';
import { applySequenceParameterValues } from './sequence-parameters.js';

export const MAX_SEQUENCE_STEPS = 64;
export const MAX_NOTES_PER_STEP = 8;
export const SEQUENCE_ARCHETYPES = Object.freeze([
  'ordered-chord',
  'ratio-canon',
  'drawn-rows',
  'parameter-rows',
  'cv-rows',
  'gesture',
  'phrase-bank',
  'accent-pattern',
  'tracker',
  'groove',
  'markov',
  'euclidean',
  'polymeter',
  'mutating-loop',
  'conditional-steps',
  'phrase-arp',
]);
export const SEQUENCE_CONFIG_KEYS = Object.freeze({
  'ordered-chord': Object.freeze(['intervals', 'order', 'octaves']),
  'ratio-canon': Object.freeze(['voices', 'ramp']),
  'drawn-rows': Object.freeze(['rows', 'masks', 'velocities']),
  'parameter-rows': Object.freeze(['pitch', 'velocity', 'gate', 'duration']),
  'cv-rows': Object.freeze(['pitch', 'address', 'gates', 'transpose', 'second']),
  gesture: Object.freeze(['points', 'densityFromPressure']),
  'phrase-bank': Object.freeze(['phrases', 'chain', 'phraseTranspose']),
  'accent-pattern': Object.freeze(['notes', 'accents']),
  tracker: Object.freeze(['rows', 'remember']),
  groove: Object.freeze(['notes', 'accents', 'timing', 'rotateEvery']),
  markov: Object.freeze(['states', 'transitions', 'maxLeap']),
  euclidean: Object.freeze(['steps', 'pulses', 'rotation', 'pitches']),
  polymeter: Object.freeze(['lanes']),
  'mutating-loop': Object.freeze(['base', 'mutationSet', 'probability', 'generations', 'mirrorEvery']),
  'conditional-steps': Object.freeze(['cells', 'breathe']),
  'phrase-arp': Object.freeze(['chords', 'order', 'repeats', 'rests', 'strum', 'velocityCycle']),
});

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
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
const item = (values, index, fallback = 0) => Array.isArray(values) && values.length ? values[((index % values.length) + values.length) % values.length] : fallback;

const hashSeed = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value) >>> 0;
  const input = typeof value === 'string' ? value.slice(0, 256) : String(value ?? '1').slice(0, 256);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededRandom = seed => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
};

const resolveStudy = studyOrId => {
  if (studyOrId == null) return getSequenceStudy('perforated-ratio-canon');
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

/**
 * Sanitize runtime controls without retaining caller-owned data.
 * `density` and `gate` are normalized 0..1. `swing` is bipolar, -0.49..0.49,
 * where positive values lengthen even steps and shorten odd steps.
 */
export function sanitizeSequenceOptions(studyOrId, options = {}) {
  const study = resolveStudy(studyOrId);
  const input = options && typeof options === 'object' ? options : {};
  const defaults = study.defaults;
  return deepFreeze({
    seed: hashSeed(input.seed ?? defaults.seed),
    density: clamp(input.density, 0, 1, defaults.density),
    gate: clamp(input.gate, 0.01, 1, 0.72),
    swing: clamp(input.swing, -0.49, 0.49, 0),
    tempo: clamp(input.tempo ?? input.tempoBpm, 10, 1200, defaults.tempoBpm),
    stepBeats: clamp(input.stepBeats, 1 / 64, 16, defaults.stepBeats),
    steps: whole(input.steps, 1, MAX_SEQUENCE_STEPS, defaults.steps),
    transpose: clamp(input.transpose, -96, 96, defaults.transpose),
    velocity: clamp(input.velocity, 0.01, 1, 1),
    maxNotes: whole(input.maxNotes, 1, MAX_NOTES_PER_STEP, MAX_NOTES_PER_STEP),
  });
}

const traversal = (values, order = 'up') => {
  if (!values.length) return [0];
  if (order === 'played') return [...values];
  const sorted = [...values].sort((a, b) => a - b);
  if (order === 'down') return sorted.reverse();
  if (order === 'pendulum') return sorted.length < 3 ? [...sorted, ...sorted.slice(0, -1).reverse()] : [...sorted, ...sorted.slice(1, -1).reverse()];
  if (order === 'inside-out') {
    const result = [];
    let left = Math.floor((sorted.length - 1) / 2), right = left + 1;
    while (left >= 0 || right < sorted.length) {
      if (left >= 0) result.push(sorted[left--]);
      if (right < sorted.length) result.push(sorted[right++]);
    }
    return result;
  }
  if (order === 'outside-in') {
    const result = [];
    let left = 0, right = sorted.length - 1;
    while (left <= right) {
      result.push(sorted[left++]);
      if (left <= right) result.push(sorted[right--]);
    }
    return result;
  }
  return sorted;
};

const asNotes = value => value == null ? [] : Array.isArray(value) ? value : [value];
const semitoneForRatio = ratio => 12 * Math.log2(Math.max(1 / 256, finite(ratio, 1)));

function orderedChord(config, count) {
  const intervals = (Array.isArray(config.intervals) ? config.intervals : [0]).map(value => finite(value, 0));
  const octaves = whole(config.octaves, 1, 8, 1);
  const expanded = [];
  for (let octave = 0; octave < octaves; octave += 1) for (const interval of intervals) expanded.push(interval + octave * 12);
  const ordered = traversal(expanded, config.order);
  return Array.from({ length: count }, (_, index) => ({ notes: [item(ordered, index)] }));
}

function ratioCanon(config, count) {
  const voices = Array.isArray(config.voices) && config.voices.length ? config.voices : [{ period: 1, pitchRatio: 1 }];
  return Array.from({ length: count }, (_, index) => {
    const notes = [];
    for (const voice of voices) {
      const period = whole(voice.period, 1, MAX_SEQUENCE_STEPS, 1);
      const phase = whole(voice.phase, -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 0);
      if (((index - phase) % period + period) % period === 0) notes.push(semitoneForRatio(voice.pitchRatio));
    }
    const ramp = clamp(config.ramp, -0.9, 0.9, 0);
    return { notes, duration: clamp(1 - ramp * index / Math.max(1, count - 1), 0.25, 2, 1) };
  });
}

const interpolate = (values, position) => {
  if (!Array.isArray(values) || !values.length) return 0;
  if (values.length === 1) return finite(values[0], 0);
  const scaled = Math.max(0, Math.min(1, position)) * (values.length - 1);
  const lower = Math.floor(scaled), upper = Math.min(values.length - 1, lower + 1);
  const mix = scaled - lower;
  return finite(values[lower], 0) * (1 - mix) + finite(values[upper], 0) * mix;
};

function drawnRows(config, count) {
  const rows = Array.isArray(config.rows) && config.rows.length ? config.rows : [[0]];
  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : index / (count - 1);
    const notes = rows.flatMap((row, rowIndex) => {
      const mask = Array.isArray(config.masks) ? config.masks[rowIndex] : null;
      if (mask && !item(mask, Math.round(position * Math.max(0, mask.length - 1)), 1)) return [];
      return [interpolate(row, position)];
    });
    const velocities = Array.isArray(config.velocities)
      ? rows.map((_, rowIndex) => interpolate(config.velocities[rowIndex], position))
      : null;
    return { notes, velocities };
  });
}

function parameterRows(config, count) {
  return Array.from({ length: count }, (_, index) => ({
    notes: asNotes(item(config.pitch, index, 0)),
    velocity: item(config.velocity, index, 0.72),
    gate: item(config.gate, index, undefined),
    duration: item(config.duration, index, 1),
  }));
}

function cvRows(config, count) {
  const pitches = Array.isArray(config.pitch) && config.pitch.length ? config.pitch : [0];
  return Array.from({ length: count }, (_, index) => {
    const address = whole(item(config.address, index, index % pitches.length), 0, pitches.length - 1, index % pitches.length);
    if (!finite(item(config.gates, index, 1), 1)) return { notes: [] };
    const base = finite(pitches[address], 0) + finite(item(config.transpose, index, 0), 0);
    const second = item(config.second, address, null);
    return { notes: second == null ? [base] : [base, finite(second, 0)] };
  });
}

function gesture(config, count, random) {
  const points = Array.isArray(config.points) && config.points.length ? [...config.points].sort((a, b) => finite(a.time, 0) - finite(b.time, 0)) : [{ time: 0, note: 0, pressure: .7 }];
  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : index / (count - 1);
    let rightIndex = points.findIndex(point => finite(point.time, 0) >= position);
    if (rightIndex < 0) rightIndex = points.length - 1;
    const right = points[rightIndex], left = points[Math.max(0, rightIndex - 1)];
    const leftTime = finite(left.time, 0), rightTime = finite(right.time, 1);
    const mix = rightTime === leftTime ? 0 : (position - leftTime) / (rightTime - leftTime);
    const note = finite(left.note, 0) + (finite(right.note, 0) - finite(left.note, 0)) * mix;
    const pressure = clamp(finite(left.pressure, .7) + (finite(right.pressure, .7) - finite(left.pressure, .7)) * mix, 0, 1, .7);
    const audible = !config.densityFromPressure || random() <= pressure;
    return { notes: audible ? [note] : [], velocity: pressure };
  });
}

function phraseBank(config, count) {
  const phrases = Array.isArray(config.phrases) && config.phrases.length ? config.phrases : [[0]];
  const chain = Array.isArray(config.chain) && config.chain.length ? config.chain : phrases.map((_, index) => index);
  const result = [];
  let chainIndex = 0;
  while (result.length < count) {
    const phraseIndex = whole(item(chain, chainIndex, 0), 0, phrases.length - 1, 0);
    const phrase = Array.isArray(phrases[phraseIndex]) && phrases[phraseIndex].length ? phrases[phraseIndex] : [0];
    const transposition = finite(item(config.phraseTranspose, chainIndex, 0), 0);
    for (const event of phrase) {
      result.push({ notes: asNotes(event).map(note => finite(note, 0) + transposition) });
      if (result.length >= count) break;
    }
    chainIndex += 1;
  }
  return result;
}

function accentPattern(config, count) {
  const accents = new Set(Array.isArray(config.accents) ? config.accents.map(Number) : []);
  const length = Math.max(1, Array.isArray(config.notes) ? config.notes.length : 1);
  return Array.from({ length: count }, (_, index) => {
    const local = index % length;
    return { notes: asNotes(item(config.notes, local, 0)), accent: accents.has(local) };
  });
}

function tracker(config, count) {
  const rows = Array.isArray(config.rows) && config.rows.length ? config.rows : [{ notes: [0] }];
  const remembered = new Set(Array.isArray(config.remember) ? config.remember : []);
  let lastVelocity = .72, lastGate;
  return Array.from({ length: count }, (_, index) => {
    const row = item(rows, index, {});
    if (Number.isFinite(row.velocity)) lastVelocity = row.velocity;
    else if (!remembered.has('velocity')) lastVelocity = .72;
    if (Number.isFinite(row.gate)) lastGate = row.gate;
    else if (!remembered.has('gate')) lastGate = undefined;
    return { notes: asNotes(row.notes), velocity: lastVelocity, gate: lastGate, accent: Boolean(row.accent) };
  });
}

function groove(config, count) {
  const notes = Array.isArray(config.notes) && config.notes.length ? config.notes : [0];
  const accents = new Set(Array.isArray(config.accents) ? config.accents.map(Number) : []);
  return Array.from({ length: count }, (_, index) => {
    const turn = whole(config.rotateEvery, 1, MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS);
    const rotation = config.rotateEvery ? Math.floor(index / notes.length / turn) : 0;
    const local = (index + rotation) % notes.length;
    return { notes: asNotes(notes[local]), accent: accents.has(local), duration: item(config.timing, local, 1) };
  });
}

const weightedIndex = (weights, random) => {
  const clean = (Array.isArray(weights) && weights.length ? weights : [1]).map(weight => Math.max(0, finite(weight, 0)));
  const total = clean.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return 0;
  let target = random() * total;
  for (let index = 0; index < clean.length; index += 1) {
    target -= clean[index];
    if (target <= 0) return index;
  }
  return clean.length - 1;
};

function markov(config, count, random) {
  const states = Array.isArray(config.states) && config.states.length ? config.states.map(value => finite(value, 0)) : [0];
  let state = Math.floor(states.length / 2);
  return Array.from({ length: count }, () => {
    const note = states[state];
    const weights = item(config.transitions, state, [1]);
    const relative = weightedIndex(weights, random) - Math.floor(weights.length / 2);
    const maxLeap = whole(config.maxLeap, 1, states.length, states.length);
    state = Math.max(0, Math.min(states.length - 1, state + Math.max(-maxLeap, Math.min(maxLeap, relative))));
    return { notes: [note] };
  });
}

function euclideanPattern(pulses, steps) {
  const result = [];
  let bucket = 0;
  for (let index = 0; index < steps; index += 1) {
    bucket += pulses;
    if (bucket >= steps) { bucket -= steps; result.push(1); } else result.push(0);
  }
  return result;
}

function euclidean(config, count) {
  const steps = whole(config.steps, 1, MAX_SEQUENCE_STEPS, 16);
  const pulses = whole(config.pulses, 0, steps, Math.min(5, steps));
  const rotation = whole(config.rotation, -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 0);
  const pattern = euclideanPattern(pulses, steps);
  const pitches = Array.isArray(config.pitches) && config.pitches.length ? config.pitches : [0];
  let pulseIndex = 0;
  return Array.from({ length: count }, (_, index) => {
    const active = pattern[((index - rotation) % steps + steps) % steps];
    if (!active) return { notes: [] };
    const notes = asNotes(item(pitches, pulseIndex++, 0));
    return { notes, accent: pulseIndex % 4 === 1 };
  });
}

function polymeter(config, count) {
  const lanes = Array.isArray(config.lanes) && config.lanes.length ? config.lanes : [{ notes: [0], period: 1 }];
  return Array.from({ length: count }, (_, index) => {
    const notes = [];
    for (const lane of lanes) {
      const laneNotes = Array.isArray(lane.notes) && lane.notes.length ? lane.notes : [0];
      const period = whole(lane.period, 1, MAX_SEQUENCE_STEPS, laneNotes.length);
      const local = ((index + whole(lane.phase, -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 0)) % period + period) % period;
      if (local < laneNotes.length) notes.push(...asNotes(laneNotes[local]));
    }
    return { notes };
  });
}

function mutatingLoop(config, count, random) {
  const base = Array.isArray(config.base) && config.base.length ? config.base : [0];
  const mutationSet = Array.isArray(config.mutationSet) && config.mutationSet.length ? config.mutationSet : [0];
  const probability = clamp(config.probability, 0, 1, .2);
  const generations = whole(config.generations, 1, MAX_SEQUENCE_STEPS, 4);
  const mutable = [...base];
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const local = index % base.length;
    const generation = Math.floor(index / base.length) % generations;
    if (local === 0 && index > 0) {
      if (generation === 0) mutable.splice(0, mutable.length, ...base);
      else {
        for (let cell = 0; cell < mutable.length; cell += 1) if (random() < probability) mutable[cell] = item(mutationSet, Math.floor(random() * mutationSet.length), 0);
        if (config.mirrorEvery && generation % whole(config.mirrorEvery, 1, generations, 2) === 0) mutable.reverse();
      }
    }
    result.push({ notes: asNotes(mutable[local]) });
  }
  return result;
}

function conditionalSteps(config, count, random) {
  const cells = Array.isArray(config.cells) && config.cells.length ? config.cells : [{ note: 0, every: 1 }];
  return Array.from({ length: count }, (_, index) => {
    const notes = [];
    for (const cell of cells) {
      const every = whole(cell.every, 1, MAX_SEQUENCE_STEPS, 1);
      const offset = whole(cell.offset, -MAX_SEQUENCE_STEPS, MAX_SEQUENCE_STEPS, 0);
      const recurring = cell.every == null || ((index - offset) % every + every) % every === 0;
      let probability = clamp(cell.probability, 0, 1, 1);
      const breathe = clamp(config.breathe, 0, 1, 0);
      if (breathe > 0) probability *= 1 - breathe + breathe * (.5 + .5 * Math.sin((index / Math.max(1, count - 1)) * Math.PI));
      if (recurring && random() <= probability) notes.push(...asNotes(cell.note));
    }
    return { notes };
  });
}

function phraseArp(config, count) {
  const chords = Array.isArray(config.chords) && config.chords.length ? config.chords : [[0]];
  const rests = new Set(Array.isArray(config.rests) ? config.rests.map(Number) : []);
  const result = [];
  let chordIndex = 0;
  while (result.length < count) {
    const chord = (Array.isArray(chords[chordIndex % chords.length]) ? chords[chordIndex % chords.length] : [0]).map(value => finite(value, 0));
    const order = config.order === 'played' ? chord : traversal(chord, config.order);
    const repeats = whole(config.repeats, 1, 8, 1);
    for (let repeat = 0; repeat < repeats && result.length < count; repeat += 1) {
      for (let index = 0; index < order.length && result.length < count; index += 1) {
        const outputIndex = result.length;
        const notes = config.strum && index === 0 ? chord : [order[index]];
        result.push({ notes: rests.has(outputIndex) ? [] : notes, velocity: item(config.velocityCycle, outputIndex, .72) });
      }
    }
    chordIndex += 1;
  }
  return result;
}

const BUILDERS = Object.freeze({
  'ordered-chord': orderedChord,
  'ratio-canon': ratioCanon,
  'drawn-rows': drawnRows,
  'parameter-rows': parameterRows,
  'cv-rows': cvRows,
  gesture,
  'phrase-bank': phraseBank,
  'accent-pattern': accentPattern,
  tracker,
  groove,
  markov,
  euclidean,
  polymeter,
  'mutating-loop': mutatingLoop,
  'conditional-steps': conditionalSteps,
  'phrase-arp': phraseArp,
});

const normalizeRawNote = (value, raw, position, settings) => {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const semitone = clamp((object ? object.semitone : value) + settings.transpose, -96, 96, settings.transpose);
  const rowVelocity = Array.isArray(raw.velocities) ? item(raw.velocities, position, raw.velocity) : raw.velocity;
  const velocity = clamp((object?.velocity ?? rowVelocity ?? .72) * settings.velocity * (raw.accent || object?.accent ? 1.18 : 1), 0.01, 1, .72);
  const authoredGate = clamp(object?.gate ?? raw.gate, 0.01, 1, 1);
  const gate = clamp(authoredGate * settings.gate, 0.01, 1, settings.gate);
  return { semitone, velocity, gate, accent: Boolean(raw.accent || object?.accent) };
};

/** Compile one catalog study into a finite, JSON-serializable event cycle. */
export function compileSequence(studyOrId, options = {}) {
  const study = resolveStudy(studyOrId);
  const input = options && typeof options === 'object' ? options : {};
  const applied = applySequenceParameterValues(study, input.parameters);
  const settings = sanitizeSequenceOptions(study, { ...applied.options, ...input });
  const random = seededRandom(settings.seed);
  const builder = BUILDERS[study.archetype] || orderedChord;
  const rawSteps = builder(applied.config, settings.steps, random);
  const steps = [];
  let at = 0;

  for (let index = 0; index < settings.steps; index += 1) {
    const raw = rawSteps[index] && typeof rawSteps[index] === 'object' ? rawSteps[index] : { notes: [] };
    const swingFactor = index % 2 === 0 ? 1 + settings.swing : 1 - settings.swing;
    const duration = clamp(settings.stepBeats * clamp(raw.duration, 1 / 16, 16, 1) * swingFactor, 1 / 1024, 256, settings.stepBeats);
    const sourceNotes = asNotes(raw.notes);
    const notes = [];
    for (let position = 0; position < sourceNotes.length && notes.length < settings.maxNotes; position += 1) {
      if (random() > settings.density) continue;
      notes.push(normalizeRawNote(sourceNotes[position], raw, position, settings));
    }
    steps.push({
      index,
      at,
      duration,
      notes,
    });
    at += duration;
  }

  return deepFreeze({
    version: 1,
    studyId: study.id,
    label: study.label,
    kind: study.kind,
    eraId: study.eraId,
    archetype: study.archetype,
    seed: settings.seed,
    tempo: settings.tempo,
    stepBeats: settings.stepBeats,
    lengthBeats: at,
    settings,
    parameters: applied.values,
    steps,
  });
}
