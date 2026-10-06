import { MorphazoidContourSynth } from '../../contour-synth-processor.js';
import { createShapeReaderModel } from '../../families/geometry-presets/shape-readers.js';
import { createShapeSoundModel } from '../../families/geometry-presets/shape-sound.js';
import { cornerStrikePeak, limitVoicePeakSum, percussionEnvelopeTimeMs, reduceVoiceContacts } from '../../audio.js';
import { pingPong01, pointAtPath, wrap01 } from '../../geometry.js';
import { performanceState } from './parameters.js';
import { rotatePath } from './paths.js';

const TAU = Math.PI * 2;
const CONTROL_SECONDS = .008;
const MAX_BLOBS = 6;
const MAX_PATHS = MAX_BLOBS * 8;
const VOICE_LIMIT = 32;
const SHEPARD_LIMIT = 8;
const MAX_STRIKES = 32;
const MAX_NOISE = 16;
const EPSILON = 1e-8;
const bounded = (value, low, high) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));

function validPath(path) {
  return typeof path?.closed === 'boolean' && Number.isFinite(path.totalLength) && path.totalLength > 0
    && Array.isArray(path.points) && path.points.length >= (path.closed ? 3 : 2) && path.points.length <= 256
    && path.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    && Array.isArray(path.vertexIndices) && path.vertexIndices.length <= 32
    && Array.isArray(path.vertexDistances) && path.vertexDistances.length === path.vertexIndices.length
    && Array.isArray(path.cornerStrengths) && Array.isArray(path.cornerTurns)
    && Array.isArray(path.cumulativeLengths) && path.cumulativeLengths.length === path.points.length;
}

function rotatedContact(contact, degrees) {
  const angle = degrees * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  const rotate = point => ({ x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine });
  const tangent = rotate(contact.tangent ?? { x: 1, y: 0 });
  return { ...contact, ...rotate(contact), tangent, tangentAngle: Math.atan2(tangent.y, tangent.x) };
}

// Estimate reader work without constructing PathContacts. Dense contours may
// expose hundreds of intersections to one head; the audible pool can only
// retain a small fraction, so reserve its head budget before doing that work.
function readerComplexity(path) {
  let scan = 2, radial = 1;
  const segmentCount = path.closed ? path.points.length : path.points.length - 1;
  for (const axis of ['x', 'y']) for (const fraction of [.25, .5, .75]) {
    const minimum = axis === 'x' ? path.bounds.minX : path.bounds.minY;
    const span = axis === 'x' ? path.bounds.width : path.bounds.height;
    const coordinate = minimum + fraction * span;
    let count = 0;
    for (let i = 0; i < segmentCount; i++) {
      const a = path.points[i][axis] - coordinate, b = path.points[(i + 1) % path.points.length][axis] - coordinate;
      if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) count++;
    }
    scan = Math.max(scan, count);
  }
  for (let ray = 0; ray < 12; ray++) {
    const angle = ray * TAU / 12, dx = Math.cos(angle), dy = Math.sin(angle);
    let count = 0;
    for (let i = 0; i < segmentCount; i++) {
      const a = path.points[i], b = path.points[(i + 1) % path.points.length];
      const ex = b.x - a.x, ey = b.y - a.y, denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-9) continue;
      const along = (a.x * ey - a.y * ex) / denominator;
      const segment = (a.x * dy - a.y * dx) / denominator;
      if (along >= 0 && segment >= 0 && segment < 1) count++;
    }
    radial = Math.max(radial, count);
  }
  return { trace: 1, scan, radial };
}

// Solve moving playhead/vertex crossings over a short audio-clock interval.
// Half-open intervals exclude the old endpoint, so adjacent windows never
// double-trigger a corner. Ping-pong tests both legs, including circular seams.
function crossingFractions(before, after, targetBefore, targetAfter, motion, circular) {
  const result = [];
  const pingpong = motion === 'pingpong';
  const period = pingpong ? 2 : 1;
  const aliases = pingpong && circular ? [-1, 0, 1] : [0];
  for (const alias of aliases) {
    for (const polarity of pingpong ? [1, -1] : [1]) {
      const a = before - polarity * (targetBefore + alias);
      const b = after - polarity * (targetAfter + alias);
      if (Math.abs(b - a) < EPSILON) continue;
      const first = Math.ceil((Math.min(a, b) - EPSILON) / period);
      const last = Math.floor((Math.max(a, b) + EPSILON) / period);
      for (let cycle = first; cycle <= last && cycle < first + 4; cycle++) {
        const fraction = (cycle * period - a) / (b - a);
        if (fraction <= EPSILON || fraction > 1 + EPSILON) continue;
        const phase = pingpong ? pingPong01(before + (after - before) * fraction) : wrap01(before + (after - before) * fraction);
        const target = targetBefore + (targetAfter - targetBefore) * fraction;
        const difference = Math.abs(phase - (circular ? wrap01(target) : target));
        if (pingpong && Math.min(difference, circular ? Math.abs(1 - difference) : difference) > 1e-6) continue;
        if (!result.some(value => Math.abs(value - fraction) < EPSILON)) result.push(bounded(fraction, 0, 1));
      }
    }
  }
  return result.sort((a, b) => a - b);
}

class BlobsProcessor extends MorphazoidContourSynth {
  constructor(options = {}) {
    super({ ...options, processorOptions: { ...options.processorOptions, maxVoices: VOICE_LIMIT + 8, smoothVoiceStealing: true } });
    this.runtimeLimit = VOICE_LIMIT;
    this.params = {};
    this.paths = [];
    this.pathComplexities = [];
    this.pathAdmission = null;
    this.cachedVoices = null;
    this.clock = { phase: 0, rotationPhase: 0, time: 0, playing: false, rotating: false };
    this.controlRemaining = 0;
    this.engineMode = null;
    this.transportStopped = true;
    this.noiseVoices = [];
    this.noiseSeed = 0x6d2b79f5;
    this.alive = true;
    const inheritedMessage = this.port.onmessage;
    this.port.onmessage = event => {
      const data = event.data;
      if (data?.type === 'dispose') { this.alive = false; return; }
      if (data?.type !== 'scene') { inheritedMessage?.(event); return; }
      this.params = data.params ?? {};
      this.paths = (Array.isArray(data.paths) ? data.paths : []).slice(0, MAX_PATHS).filter(validPath);
      this.pathComplexities = new Array(this.paths.length);
      this.pathAdmission = null;
      this.cachedVoices = null;
      this.clock = { ...this.clock, ...data.clock };
      // Geometry edits replace the future. Notes that have already started
      // retain their release tails, and sustained oscillator phases stay live.
      this.noteQueue = [];
      this.noiseVoices = this.noiseVoices.filter(voice => voice.start <= this.renderedSamples);
      this.controlRemaining = 0;
    };
  }

  releaseSound() {
    this.cachedVoices = null;
    this.noteQueue = [];
    this.setVoiceTargets([], [], 0);
    for (const voice of this.voices.values()) {
      voice.note = null;
      voice.target = { ...voice.target, gain: 0, gainSmoothingSeconds: .018 };
      voice.nextTarget = voice.target;
    }
    for (const voice of this.noiseVoices) voice.releaseAt ??= this.renderedSamples;
  }

  pathKey(index) {
    const key = this.paths[index]?.pathKey;
    return typeof key === 'string' && key.length > 0 && key.length <= 128 ? key : `blob:${index}`;
  }

  sourceIndex(index) {
    const source = this.paths[index]?.sourceIndex;
    return Number.isInteger(source) && source >= 0 && source < MAX_BLOBS ? source : index;
  }

  admittedPaths(state) {
    const limit = state.soundMode === 'shepard' ? SHEPARD_LIMIT : VOICE_LIMIT;
    if (this.pathAdmission?.limit === limit) return this.pathAdmission.indices;
    let indices = this.paths.map((_, index) => index);
    if (indices.length > limit) {
      const sources = new Map(), reflections = [];
      for (const index of indices) {
        const source = this.sourceIndex(index);
        const reflection = this.paths[index].reflectionId ?? 'identity';
        if (!sources.has(source)) sources.set(source, []);
        sources.get(source).push({ index, reflection });
        if (!reflections.includes(reflection)) reflections.push(reflection);
      }
      const groups = [...sources.entries()].sort((a, b) => a[0] - b[0]).map(([, group]) => group);
      const selected = new Set(); indices = [];
      // Round-robin source admission and evenly distributed reflection slots
      // cover both axes of a large bank (e.g. eight Shepard voices still reach
      // all six source blobs and all eight D4 reflections).
      for (let slot = 0; slot < limit; slot++) {
        const target = Math.floor(slot * reflections.length / limit);
        let admitted = null;
        for (let sourceOffset = 0; sourceOffset < groups.length && admitted === null; sourceOffset++) {
          const group = groups[(slot + sourceOffset) % groups.length];
          for (let offset = 0; offset < reflections.length && admitted === null; offset++) {
            const reflection = reflections[(target + offset) % reflections.length];
            const candidate = group.find(path => path.reflection === reflection && !selected.has(path.index));
            if (candidate) admitted = candidate.index;
          }
        }
        if (admitted === null) break;
        selected.add(admitted); indices.push(admitted);
      }
    }
    const budgets = new Map(indices.map((index, rank) => [index,
      Math.floor(limit / Math.max(1, indices.length)) + (rank < limit % Math.max(1, indices.length) ? 1 : 0),
    ]));
    this.pathAdmission = { limit, indices, budgets };
    return indices;
  }

  audibleHeads(state, blobIndex) {
    this.admittedPaths(state);
    const budget = this.pathAdmission.budgets.get(blobIndex) ?? 0;
    if (budget <= 0) return [];
    this.pathComplexities[blobIndex] ??= readerComplexity(this.paths[blobIndex]);
    const complexity = this.pathComplexities[blobIndex][state.playMethod] ?? 1;
    const count = Math.min(state.heads, Math.max(1, Math.floor(budget / complexity)));
    if (count === state.heads) return Array.from({ length: count }, (_, i) => i);
    // Spread a bounded audible selection across the authored layout; rotate
    // that selection between blobs so the same early heads do not win every
    // pool slot. The performer's actual head count and phases remain intact.
    return Array.from({ length: count }, (_, i) => (Math.floor(i * state.heads / count) + this.sourceIndex(blobIndex)) % state.heads).sort((a, b) => a - b);
  }

  continuousVoices(state) {
    const sound = createShapeSoundModel(state);
    let openSound;
    const groups = [];
    for (const blobIndex of this.admittedPaths(state)) {
      const base = this.paths[blobIndex];
      // An open trace reverses at its endpoints; the reader, envelopes and
      // Shepard mapping all follow that same physical traversal.
      const pathState = this.stateForPath(state, base);
      const pathSound = pathState === state ? sound : (openSound ??= createShapeSoundModel(pathState));
      const indices = this.audibleHeads(state, blobIndex);
      const readerState = { ...pathState, heads: indices.length };
      for (const key of ['headOffsets', 'scanLineAxes', 'traceHeadDirections', 'radialHeadDirections', 'traceHeadDirectionAdjustments', 'radialHeadDirectionAdjustments']) {
        readerState[key] = indices.map(i => state[key][i]);
      }
      const reader = createShapeReaderModel(readerState);
      // Trace distance, corner intervals and signed turning do not change
      // during rotation. Rotate just contacts to retain cached turn profiles.
      const path = state.playMethod === 'trace' ? base : rotatePath(base, state.rotation);
      const allContacts = reader.collectContacts(path, state.continuousPosition).contacts;
      const byHead = Array.from({ length: state.heads }, () => []);
      for (const contact of allContacts) {
        const headIndex = indices[contact.headIndex];
        const voiceKey = contact.voiceKey.split(':'); voiceKey[state.playMethod === 'scan' ? 2 : 1] = String(headIndex);
        byHead[headIndex].push({ ...contact, headIndex, voiceKey: voiceKey.join(':') });
      }
      const contacts = [];
      for (let rank = 0; rank < VOICE_LIMIT && contacts.length < VOICE_LIMIT; rank++) {
        let found = false;
        for (const head of byHead) if (head[rank]) { contacts.push(head[rank]); found = true; }
        if (!found) break;
      }
      const positioned = state.playMethod === 'trace'
        ? contacts.map(contact => rotatedContact(contact, state.rotation)) : contacts;
      groups.push(pathSound.continuousSynthVoices(positioned.slice(0, VOICE_LIMIT), path)
        .map(voice => ({ ...voice, key: `${this.pathKey(blobIndex)}:${voice.key}` })));
    }
    // Equal-strength contacts enter in blob/head order, rather than filling
    // the whole pool from the first contour before considering the others.
    const voices = [];
    for (let rank = 0; rank < VOICE_LIMIT; rank++) for (const group of groups) if (group[rank]) voices.push(group[rank]);
    const limit = state.soundMode === 'shepard' ? SHEPARD_LIMIT : VOICE_LIMIT;
    return limitVoicePeakSum(reduceVoiceContacts(voices, limit), state.soundMode === 'shepard' ? .4 : .72);
  }

  headTravel(state, headIndex) {
    if (state.playMethod === 'scan') return state.continuousPosition + (state.headOffsets[headIndex] ?? headIndex / state.heads);
    const radial = state.playMethod === 'radial';
    const directions = radial ? state.radialHeadDirections : state.traceHeadDirections;
    const adjustments = radial ? state.radialHeadDirectionAdjustments : state.traceHeadDirectionAdjustments;
    return (directions[headIndex] < 0 ? -1 : 1) * state.continuousPosition
      + (state.headOffsets[headIndex] ?? headIndex / state.heads) + (adjustments[headIndex] ?? 0);
  }

  stateForPath(state, path) {
    return !path.closed && state.playMethod === 'trace' && state.motionMode !== 'pingpong' ? { ...state, motionMode: 'pingpong' } : state;
  }

  vertexTarget(path, vertexIndex, state, headIndex) {
    if (state.playMethod === 'trace') return path.vertexDistances[vertexIndex] / path.totalLength;
    const point = path.points[path.vertexIndices[vertexIndex]];
    if (state.playMethod === 'radial') return Math.hypot(point.x, point.y) > 1e-6 ? wrap01(Math.atan2(point.y, point.x) / TAU + .25) : null;
    const horizontal = state.scanLineAxes[headIndex] === 'horizontal';
    const minimum = horizontal ? path.bounds.minY : path.bounds.minX;
    const span = horizontal ? path.bounds.height : path.bounds.width;
    return span > 1e-9 ? bounded(((horizontal ? point.y : point.x) - minimum) / span, 0, 1) : null;
  }

  percussionIntents(now, duration, state, future) {
    // Short substeps resolve scan extrema and radar seams during fast rotation.
    const motion = Math.max(Math.abs(future.continuousPosition - state.continuousPosition), Math.abs(future.continuousRotation - state.continuousRotation));
    const steps = Math.min(8, Math.max(1, Math.ceil(motion / .012)));
    const intents = [];
    const pathIndices = this.admittedPaths(state);
    const heads = pathIndices.map(index => this.audibleHeads(state, index));
    let before = state;
    let beforePaths = pathIndices.map(index => before.playMethod === 'trace' ? this.paths[index] : rotatePath(this.paths[index], before.rotation));
    for (let step = 1; step <= steps; step++) {
      const after = step === steps ? future : performanceState(this.params, this.clock, now + duration * step / steps);
      const afterPaths = pathIndices.map(index => after.playMethod === 'trace' ? this.paths[index] : rotatePath(this.paths[index], after.rotation));
      for (let admitted = 0; admitted < pathIndices.length; admitted++) {
        const blob = pathIndices[admitted];
        const base = this.paths[blob], previousPath = beforePaths[admitted], nextPath = afterPaths[admitted];
        const pathState = this.stateForPath(state, base);
        const circular = state.playMethod === 'radial' || (state.playMethod === 'trace' && base.closed);
        for (const head of heads[admitted]) {
          const from = this.headTravel(before, head), to = this.headTravel(after, head);
          for (let vertex = 0; vertex < base.vertexIndices.length; vertex++) {
            if (!(base.cornerStrengths[vertex] > 0)) continue;
            const targetFrom = this.vertexTarget(previousPath, vertex, before, head);
            let targetTo = this.vertexTarget(nextPath, vertex, after, head);
            if (targetFrom === null || targetTo === null) continue;
            if (state.playMethod === 'radial') targetTo = targetFrom + ((targetTo - targetFrom + 1.5) % 1 - .5);
            for (const fraction of crossingFractions(from, to, targetFrom, targetTo, pathState.motionMode, circular)) {
              intents.push({ blob, head, vertex, at: now + duration * ((step - 1 + fraction) / steps) });
            }
          }
        }
      }
      before = after; beforePaths = afterPaths;
    }
    return intents.sort((a, b) => a.at - b.at).slice(0, MAX_STRIKES);
  }

  queueCorner(intent, now) {
    const path = this.paths[intent.blob];
    const state = this.stateForPath(performanceState(this.params, this.clock, intent.at), path);
    const sound = createShapeSoundModel(state);
    const contact = {
      ...rotatedContact(pointAtPath(path, path.vertexDistances[intent.vertex] / path.totalLength), state.rotation),
      cornerIndex: intent.vertex,
      cornerStrength: path.cornerStrengths[intent.vertex],
      cornerTurn: path.cornerTurns[intent.vertex],
      headIndex: intent.head,
      headTravel: this.headTravel(state, intent.head),
      scanAxis: state.playMethod === 'radial' ? 'radial' : state.playMethod === 'scan' ? state.scanLineAxes[intent.head] : undefined,
    };
    const gain = cornerStrikePeak(sound.percussionLevelValue(contact, path, intent.head), state.percussionStrikeLevel);
    if (!(gain > 0)) return;
    const mapping = sound.mappingForContact(contact, path, intent.head);
    const spec = { key: `${this.pathKey(intent.blob)}:corner:${intent.head}:${intent.vertex}`, mode: 'sine', frequency: sound.synthFrequencyForMapping(mapping), gain, pan: mapping.pan };
    this.queueNotes({
      voices: [spec], startAt: intent.at, voiceLimit: VOICE_LIMIT,
      envelope: state.percussionEnvelopePoints.map(point => ({ time: percussionEnvelopeTimeMs(point.x) / 1000, level: point.y })),
    });
    if (state.percussionAttackNoise > 0 && this.noiseVoices.length < MAX_NOISE) {
      this.noiseVoices.push({
        start: this.renderedSamples + Math.round(Math.max(0, intent.at - now) * sampleRate),
        gain: gain * bounded(state.percussionAttackNoise, 0, 1) * .35,
        left: Math.cos((mapping.pan + 1) * Math.PI / 4), right: Math.sin((mapping.pan + 1) * Math.PI / 4),
      });
    }
  }

  updateControl(now, duration) {
    const state = performanceState(this.params, this.clock, now);
    const moving = Boolean(this.clock.playing || this.clock.rotating) && this.paths.length > 0;
    if (state.soundMode !== this.engineMode) {
      this.releaseSound();
      this.engineMode = state.soundMode;
    }
    if (!moving) {
      if (!this.transportStopped) this.releaseSound();
      this.transportStopped = true;
      return;
    }
    this.transportStopped = false;
    const future = performanceState(this.params, this.clock, now + duration);
    if (state.soundMode === 'percussion') {
      for (const intent of this.percussionIntents(now, duration, state, future)) this.queueCorner(intent, now);
    } else {
      this.runtimeLimit = state.soundMode === 'shepard' ? SHEPARD_LIMIT : VOICE_LIMIT;
      this.requestedMode = state.soundMode;
      const voices = this.cachedVoices && Math.abs(this.cachedVoices.time - now) < .5 / sampleRate
        ? this.cachedVoices.voices : this.continuousVoices(state);
      const nextVoices = this.continuousVoices(future);
      this.cachedVoices = { time: now + duration, voices: nextVoices };
      this.requestedVoiceCount = voices.length;
      this.setVoiceTargets(voices, nextVoices, duration);
    }
  }

  renderNoise(channels, atSample) {
    if (!this.noiseVoices.length) return;
    const left = channels[0], right = channels[1] ?? left;
    const duration = sampleRate * .04, attack = sampleRate * .001;
    for (let index = 0; index < left.length; index++) {
      let l = 0, r = 0, budget = 0;
      for (const voice of this.noiseVoices) {
        const age = atSample + index - voice.start;
        if (age < 0 || age >= duration) continue;
        const release = voice.releaseAt === undefined ? 1 : bounded(1 - (atSample + index - voice.releaseAt) / (sampleRate * .006), 0, 1);
        const gain = voice.gain * Math.min(1, age / attack) * Math.exp(-age / (sampleRate * .006)) * release;
        this.noiseSeed = (Math.imul(this.noiseSeed, 1664525) + 1013904223) >>> 0;
        const sample = (this.noiseSeed / 0x80000000 - 1) * gain;
        l += sample * voice.left; r += sample * voice.right; budget += gain;
      }
      const scale = Math.min(1, .15 / Math.max(.15, budget));
      left[index] += l * scale;
      if (right !== left) right[index] += r * scale;
    }
    this.noiseVoices = this.noiseVoices.filter(voice => atSample + left.length - voice.start < duration
      && (voice.releaseAt === undefined || atSample + left.length - voice.releaseAt < sampleRate * .006));
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const channels = outputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    if (this.controlRemaining <= 0) {
      const controlFrames = Math.max(frames, Math.ceil(sampleRate * CONTROL_SECONDS / frames) * frames);
      const now = Number.isFinite(globalThis.currentTime) ? globalThis.currentTime : this.renderedSamples / sampleRate;
      this.updateControl(now, controlFrames / sampleRate);
      this.controlRemaining = controlFrames;
    }
    const atSample = this.renderedSamples;
    super.process(inputs, outputs);
    this.renderNoise(channels, atSample);
    // The normal bus is peak-budgeted; this soft ceiling only catches release
    // overlap when a performer changes engines or geometry at an extreme.
    for (const channel of channels) for (let index = 0; index < channel.length; index++) {
      const value = channel[index], magnitude = Math.abs(value);
      if (!Number.isFinite(value)) channel[index] = 0;
      else if (magnitude > .95) channel[index] = Math.sign(value) * (.95 + .05 * Math.tanh((magnitude - .95) / .05));
    }
    this.controlRemaining -= frames;
    return true;
  }
}

registerProcessor('blobs', BlobsProcessor);
