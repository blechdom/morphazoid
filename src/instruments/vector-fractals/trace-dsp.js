import { clamp, TABLE_SIZE } from './model.js';

const TAU = Math.PI * 2;
const LAYERS = 3, CONTACTS = 3, SLOTS = LAYERS * CONTACTS;
const VOICES = ['sine', 'reed', 'glass'];
const DRUM_VOICES = ['thump', 'wood', 'metal'];
const REGISTERS = [.5, 1, 2];
const GLASS_RATIOS = [2.414213562373095, 3.97, 6.12];
const WOOD_RATIOS = [1, 2.75, 5.1], METAL_RATIOS = [1, 1.59, 2.17, 3.81, 5.43, 7.15];
const SHEPARD_PARTIALS = 11, SHEPARD_CENTER = 5;
const DRUM_SLOTS = 24, HIT_HISTORY = 64, COLORS = 4;
const PARAMS = ['toneLevel', 'drumLevel', 'bendTimbre', 'foldTimbre', 'pitchDepth', 'panWidth', 'shepardCycles', 'shepardWidth', 'shepardDirection', 'travelerOctaves'];
const EMPTY_CONTACT = Object.freeze({ x: new Float32Array(0), y: new Float32Array(0), bend: new Float32Array(0), fold: new Float32Array(0), presence: new Float32Array(0), turn: new Float32Array(0), turnPerLap: 0, turnOffset: 0 });

function boundedContact(contact) {
  const length = contact?.x?.length;
  if (!Number.isInteger(length) || length < 2 || length > TABLE_SIZE
    || contact.y?.length !== length || contact.bend?.length !== length
    || (contact.fold && contact.fold.length !== length)
    || (contact.turn && contact.turn.length !== length)
    || (contact.presence && contact.presence.length !== length)) return EMPTY_CONTACT;
  const result = { x: new Float32Array(length), y: new Float32Array(length), bend: new Float32Array(length),
    fold: new Float32Array(length), presence: new Float32Array(length), turn: new Float32Array(length),
    turnPerLap: clamp(contact.turnPerLap, -TABLE_SIZE * TAU, TABLE_SIZE * TAU, 0), turnOffset: 0 };
  for (let i = 0; i < length; i++) {
    if (!Number.isFinite(contact.x[i]) || !Number.isFinite(contact.y[i]) || !Number.isFinite(contact.bend[i])
      || (contact.fold && !Number.isFinite(contact.fold[i]))
      || (contact.turn && !Number.isFinite(contact.turn[i]))
      || (contact.presence && !Number.isFinite(contact.presence[i]))) return EMPTY_CONTACT;
    result.x[i] = clamp(contact.x[i], -4, 4); result.y[i] = clamp(contact.y[i], -4, 4);
    result.bend[i] = clamp(contact.bend[i], 0, 1); result.fold[i] = clamp(contact.fold?.[i], 0, 1);
    result.presence[i] = clamp(contact.presence?.[i], 0, 1, 1);
    result.turn[i] = clamp(contact.turn?.[i], -TABLE_SIZE * TAU, TABLE_SIZE * TAU, 0);
  }
  return result;
}

function boundedBank(bank) {
  const aspect = clamp(bank?.view?.aspect, .1, 10, 1);
  const radarX = clamp(bank?.radarX, -.5, .5, 0), radarY = clamp(bank?.radarY, -.5, .5, 0);
  return { id: Number.isSafeInteger(bank?.id) ? bank.id : 0,
    reader: ['radar', 'scan', 'traveler'].includes(bank?.reader) ? bank.reader : 'trace', aspect, radarX, radarY,
    radarRadius: Math.hypot(.5 + Math.abs(radarX), .5 / aspect + Math.abs(radarY)),
    layers: Array.from({ length: LAYERS }, (_, index) => {
      const layer = bank?.layers?.[index];
      const contacts = Array(CONTACTS).fill(EMPTY_CONTACT);
      (Array.isArray(layer?.contacts) ? layer.contacts : [layer]).slice(0, CONTACTS).forEach((contact, index) => {
        const slot = Number.isInteger(contact?.slot) && contact.slot >= 0 && contact.slot < CONTACTS ? contact.slot : index;
        contacts[slot] = boundedContact(contact);
      });
      const events = (Array.isArray(layer?.events) ? layer.events : []).slice(0, 512)
        .filter(event => Number.isFinite(event?.phase) && event.phase >= 0 && event.phase < 1
          && Number.isFinite(event.x) && Number.isFinite(event.y))
        .map(event => ({ phase: event.phase, bead: Number.isSafeInteger(event.bead) ? event.bead : -1,
          x: clamp(event.x, -4, 4), y: clamp(event.y, -4, 4),
          bend: clamp(event.bend, 0, 1), fold: clamp(event.fold, 0, 1) }))
        .sort((a, b) => a.phase - b.phase);
      return { contacts, events };
    }) };
}

function pitchPosition(x, y, bank) {
  return bank.reader === 'radar'
    ? clamp(2 * Math.hypot(x - bank.radarX, y - bank.radarY) / bank.radarRadius - 1, -1, 1)
    : clamp(2 * bank.aspect * y, -1, 1);
}

function readTurn(contact, phase, travel) {
  const position = phase * contact.turn.length, index = Math.floor(position);
  const next = (index + 1) % contact.turn.length, fraction = position - index;
  // The endpoint is the first heading plus its winding, never the first angle
  // alone. Round travel-phase so independently accumulated clocks agree at seams.
  const end = contact.turn[next] + (next === 0 ? contact.turnPerLap : 0);
  return contact.turn[index] + (end - contact.turn[index]) * fraction
    + Math.round(travel - phase) * contact.turnPerLap + contact.turnOffset;
}

function readContact(contact, phase, bank, out, travel = phase) {
  if (!contact?.x.length) return 0;
  const position = phase * contact.x.length, index = Math.floor(position);
  const next = (index + 1) % contact.x.length, fraction = position - index;
  const x = contact.x[index] + (contact.x[next] - contact.x[index]) * fraction;
  const y = contact.y[index] + (contact.y[next] - contact.y[index]) * fraction;
  out[0] = clamp(2 * x, -1, 1); out[1] = pitchPosition(x, y, bank);
  out[2] = contact.bend[index] + (contact.bend[next] - contact.bend[index]) * fraction;
  out[3] = contact.fold[index] + (contact.fold[next] - contact.fold[index]) * fraction;
  out[4] = bank.reader === 'traveler' ? readTurn(contact, phase, travel) : 0;
  return contact.presence[index] + (contact.presence[next] - contact.presence[index]) * fraction;
}

// Smoothly remove partials before Nyquist. These sustained and struck voices
// are artistic colors, not physical models of reeds, glass, wood or metal.
function partialGain(frequency, sampleRate) {
  const t = clamp((sampleRate * .42 - frequency) / (sampleRate * .12), 0, 1);
  return t * t * (3 - 2 * t);
}
function softBound(value) {
  const magnitude = Math.abs(value);
  return magnitude <= .8 ? value : Math.sign(value) * (.8 + .1 * Math.tanh((magnitude - .8) * 10));
}

/** Shared sample-clock traversal, nine sustained contacts and 24 bounded tails. */
export class TraceDSP {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.phase = 0; this.travel = 0; this.rate = .1; this.targetRate = .1; this.reader = 'trace';
    this.bank = boundedBank(null); this.eventBank = this.bank; this.previous = null; this.pending = null; this.fade = 1;
    this.smoothing = 1 - Math.exp(-1 / (.012 * sampleRate));
    this.rateSmoothing = 1 - Math.exp(-1 / (.035 * sampleRate));
    this.fadeStep = 1 / (.09 * sampleRate);
    this.enabled = new Uint8Array([1, 1, 1]); this.sustain = new Uint8Array([1, 1, 1]); this.drums = new Uint8Array(LAYERS);
    this.voiceTargets = new Uint8Array([0, 1, 2]); this.drumVoiceTargets = new Uint8Array([0, 1, 2]);
    this.voiceWeights = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    this.gains = new Float64Array(SLOTS); this.drumGains = new Float64Array(LAYERS);
    this.pans = new Float64Array(SLOTS); this.heights = new Float64Array(SLOTS);
    this.bends = new Float64Array(SLOTS); this.folds = new Float64Array(SLOTS);
    this.frequencies = new Float64Array(SLOTS); this.frequencies.set([55, 110, 220]);
    this.carriers = new Float64Array(SLOTS); this.glassPhases = new Float64Array(SLOTS * 3);
    this.shepardPhases = new Float64Array(SLOTS * SHEPARD_PARTIALS);
    this.shepardPosition = 0; this.shepardTravel = 0;
    this.travelerTurns = new Float64Array(SLOTS); this.travelerPitch = new Float64Array(SLOTS);
    this.travelerSmoothedPitch = new Float64Array(SLOTS); this.travelerPositions = new Float64Array(SLOTS);
    this.travelerInitialized = new Uint8Array(SLOTS); this.travelerMix = 0;
    this.travelerPhases = new Float64Array(SLOTS * SHEPARD_PARTIALS);
    this.point = new Float64Array(5); this.oldPoint = new Float64Array(5);
    this.params = { toneLevel: 1, drumLevel: .55, bendTimbre: .5, foldTimbre: 0, pitchDepth: 2,
      panWidth: 1, shepardCycles: 1, shepardWidth: 1, shepardDirection: 1, travelerOctaves: 1 };
    this.targets = { ...this.params }; this.drumDecay = .18; this.drumPitch = 120;
    this.eventCursors = new Uint16Array(LAYERS); this.drumTriggerCounts = new Float64Array(LAYERS);
    this.hitLayers = new Uint8Array(HIT_HISTORY); this.hitBeads = new Int32Array(HIT_HISTORY);
    this.hitTravel = new Float64Array(HIT_HISTORY); this.hitBanks = new Float64Array(HIT_HISTORY);
    this.hitWrite = 0; this.hitCount = 0;
    this.drumVoices = Array.from({ length: DRUM_SLOTS }, () => ({ active: false, layer: 0, voice: 0,
      phases: new Float64Array(6), age: 0, frequency: 120, decay: .18, bend: 0, fold: 0, pan: 0,
      lastLeft: 0, lastRight: 0, residualLeft: 0, residualRight: 0, strength: 1 }));
    this.drumPair = new Float64Array(2);
  }

  setState(state = {}) {
    this.targetRate = clamp(state.traceRate, .01, 1, .1);
    const previousReader = this.reader;
    this.reader = ['radar', 'scan', 'traveler', 'xy'].includes(state.contourReader) ? state.contourReader : 'trace';
    if (this.reader === 'traveler' && previousReader !== 'traveler') this.anchorTraveler();
    this.targets = { toneLevel: clamp(state.toneLevel, 0, 1, 1), drumLevel: clamp(state.drumLevel, 0, 1, .55),
      bendTimbre: clamp(state.bendTimbre, 0, 1, .5), foldTimbre: clamp(state.foldTimbre, 0, 1, 0),
      pitchDepth: clamp(state.pitchDepth, 0, 4, 2), panWidth: clamp(state.panWidth, 0, 1, 1),
      shepardCycles: clamp(state.shepardCycles, 0, 4, 1), shepardWidth: clamp(state.shepardWidth, .5, 2, 1),
      shepardDirection: state.shepardDirection === 'fall' ? -1 : 1,
      travelerOctaves: clamp(state.travelerOctaves, 0, 4, 1) };
    this.drumDecay = clamp(state.drumDecay, .02, 1.5, .18); this.drumPitch = clamp(state.drumPitch, 30, 1800, 120);
    for (let layer = 0; layer < LAYERS; layer++) {
      this.enabled[layer] = state.layerEnabled?.[layer] === false ? 0 : 1;
      this.sustain[layer] = state.layerSustain?.[layer] === false ? 0 : 1;
      this.drums[layer] = state.layerDrums?.[layer] === true ? 1 : 0;
      const voice = state.layerVoices?.[layer] === 'shepard' ? 3 : VOICES.indexOf(state.layerVoices?.[layer]);
      this.voiceTargets[layer] = voice < 0 ? layer : voice;
      const drum = DRUM_VOICES.indexOf(state.layerDrumVoices?.[layer]);
      this.drumVoiceTargets[layer] = drum < 0 ? layer : drum;
    }
  }

  seekEvents() {
    for (let layer = 0; layer < LAYERS; layer++) {
      const events = this.eventBank.layers[layer].events;
      let index = 0;
      // Edits and joining an already-moving transport never replay earlier hits.
      while (index < events.length && events[index].phase <= this.phase + 1e-12) index++;
      this.eventCursors[layer] = index;
    }
  }

  setBank(bank) {
    const next = boundedBank(bank);
    // Percussion takes the latest schedule immediately, independently of the
    // sustained-geometry fade. Abandoned geometry cannot queue a late burst.
    this.eventBank = next; this.seekEvents();
    if (this.previous) { this.pending = next; return; }
    this.activateBank(next);
  }

  activateBank(next) {
    if (next.reader === 'traveler') for (let layer = 0; layer < LAYERS; layer++) {
      for (let contact = 0; contact < CONTACTS; contact++) {
        const slot = contact * LAYERS + layer, target = next.layers[layer].contacts[contact];
        if (!target.x.length) continue;
        const source = this.bank.layers[layer].contacts[contact];
        if (this.bank.reader === 'traveler' && source.x.length) {
          target.turnOffset += readTurn(source, this.phase, this.travel) - readTurn(target, this.phase, this.travel);
        } else if (this.travelerInitialized[slot]) {
          target.turnOffset += this.travelerTurns[slot] - readTurn(target, this.phase, this.travel);
        }
      }
    }
    this.previous = this.bank; this.bank = next; this.fade = 0;
  }

  setPhase(value) {
    this.travel = clamp(value, 0, 1e9, 0); this.phase = this.travel % 1;
    // A transport seek changes the location, not the already accumulated note.
    // Initial startup has no initialized voices and can join any unwrapped lap.
    this.anchorTraveler();
    this.seekEvents();
  }

  anchorTraveler() {
    for (const bank of [this.bank, this.previous]) if (bank?.reader === 'traveler') {
      for (let layer = 0; layer < LAYERS; layer++) for (let contact = 0; contact < CONTACTS; contact++) {
        const slot = contact * LAYERS + layer, point = bank.layers[layer].contacts[contact];
        if (point.x.length && this.travelerInitialized[slot]) {
          point.turnOffset += this.travelerTurns[slot] - readTurn(point, this.phase, this.travel);
        }
      }
    }
  }

  snapshotTraveler() {
    return { version: 1, phase: this.phase, travel: this.travel,
      turns: Array.from(this.travelerTurns), pitch: Array.from(this.travelerPitch),
      smoothedPitch: Array.from(this.travelerSmoothedPitch), initialized: Array.from(this.travelerInitialized) };
  }

  restoreTraveler(snapshot) {
    if (snapshot?.version !== 1 || !['turns', 'pitch', 'smoothedPitch', 'initialized'].every(key =>
      Array.isArray(snapshot[key]) && snapshot[key].length === SLOTS
        && snapshot[key].every(value => Number.isFinite(value) && Math.abs(value) <= 1e14))) return;
    for (let layer = 0; layer < LAYERS; layer++) for (let contact = 0; contact < CONTACTS; contact++) {
      const slot = contact * LAYERS + layer;
      this.travelerInitialized[slot] = snapshot.initialized[slot] ? 1 : 0;
      this.travelerTurns[slot] = snapshot.turns[slot]; this.travelerPitch[slot] = snapshot.pitch[slot];
      this.travelerSmoothedPitch[slot] = snapshot.smoothedPitch[slot];
      this.travelerPositions[slot] = ((snapshot.smoothedPitch[slot] % 1) + 1) % 1;
      const point = this.bank.layers[layer].contacts[contact];
      if (this.bank.reader === 'traveler' && point.x.length && this.travelerInitialized[slot]) {
        // Audio off holds its last note. Visual transport and geometry can move
        // independently, so join the current position without replaying turns.
        point.turnOffset += snapshot.turns[slot] - readTurn(point, this.phase, this.travel);
      }
    }
  }

  reset() {
    this.setPhase(0);
    // Keep Shepard travel and audible octave position together through motion
    // Reset, like carrier phases. Audio off/on can then reconstruct the same tone.
  }

  drainHits() {
    const hits = [];
    const start = (this.hitWrite - this.hitCount + HIT_HISTORY) % HIT_HISTORY;
    for (let i = 0; i < this.hitCount; i++) {
      const index = (start + i) % HIT_HISTORY;
      hits.push({ layer: this.hitLayers[index], bead: this.hitBeads[index], travel: this.hitTravel[index], bankId: this.hitBanks[index] });
    }
    this.hitCount = 0; return hits;
  }

  strike(layer, event, travel) {
    this.drumTriggerCounts[layer]++;
    const index = this.hitWrite;
    this.hitLayers[index] = layer; this.hitBeads[index] = event.bead; this.hitTravel[index] = travel; this.hitBanks[index] = this.eventBank.id;
    this.hitWrite = (index + 1) % HIT_HISTORY; this.hitCount = Math.min(HIT_HISTORY, this.hitCount + 1);
    const first = layer * (DRUM_SLOTS / LAYERS);
    let chosen = this.drumVoices[first], quietest = Infinity;
    for (let i = first; i < first + DRUM_SLOTS / LAYERS; i++) {
      const voice = this.drumVoices[i];
      if (!voice.active) { chosen = voice; break; }
      const remaining = voice.strength * Math.exp(-5 * voice.age / voice.decay);
      if (remaining < quietest) { chosen = voice; quietest = remaining; }
    }
    // At the voice cap coincident attacks add energy to a fresh tail, rather
    // than letting the last event erase earlier attacks in the same sample.
    if (chosen.active && chosen.age === 0) { chosen.strength = Math.min(8, chosen.strength + 1); return; }
    chosen.residualLeft += chosen.lastLeft; chosen.residualRight += chosen.lastRight;
    chosen.lastLeft = 0; chosen.lastRight = 0;
    chosen.active = true; chosen.age = 0; chosen.phases.fill(0); chosen.strength = 1;
    chosen.layer = layer; chosen.voice = this.drumVoiceTargets[layer];
    const pitch = this.eventBank.reader === 'traveler' ? 0 : this.params.pitchDepth * pitchPosition(event.x, event.y, this.eventBank);
    chosen.frequency = clamp(this.drumPitch * REGISTERS[layer] * 2 ** pitch, 12, this.sampleRate * .15, 120);
    chosen.decay = this.drumDecay; chosen.bend = event.bend; chosen.fold = event.fold;
    chosen.pan = clamp(2 * event.x, -1, 1);
  }

  crossEvents(nextPhase, nextTravel) {
    const wrapped = nextPhase < this.phase;
    // Wrapped phase and travel accumulate separate floating-point rounding.
    // Their difference identifies the logical lap even just after a long-run seam.
    const lap = Math.round(nextTravel - nextPhase);
    for (let layer = 0; layer < LAYERS; layer++) {
      const events = this.eventBank.layers[layer].events;
      const enabled = this.enabled[layer] && this.drums[layer] && this.eventBank.reader === this.reader;
      let cursor = this.eventCursors[layer];
      if (wrapped) {
        while (cursor < events.length) {
          const event = events[cursor++];
          if (enabled) this.strike(layer, event, lap - 1 + event.phase);
        }
        cursor = 0;
      }
      while (cursor < events.length && events[cursor].phase <= nextPhase + 1e-12) {
        const event = events[cursor++];
        if (enabled) this.strike(layer, event, lap + event.phase);
      }
      this.eventCursors[layer] = cursor;
    }
  }

  advanceShepard(step) {
    const delta = step * this.params.shepardCycles * this.params.shepardDirection;
    this.shepardTravel += delta; this.shepardPosition += delta;
    if (this.shepardPosition >= 1 || this.shepardPosition < 0) {
      const rising = this.shepardPosition >= 1;
      this.shepardPosition = (this.shepardPosition + 1) % 1;
      // Keep each audible oscillator at its actual frequency through the octave
      // seam. Only a silent edge oscillator is recycled when the ray wraps.
      for (let slot = 0; slot < SLOTS; slot++) {
        const offset = slot * SHEPARD_PARTIALS;
        if (rising) {
          for (let i = SHEPARD_PARTIALS - 1; i > 0; i--) this.shepardPhases[offset + i] = this.shepardPhases[offset + i - 1];
          this.shepardPhases[offset] = 0;
        } else {
          for (let i = 0; i < SHEPARD_PARTIALS - 1; i++) this.shepardPhases[offset + i] = this.shepardPhases[offset + i + 1];
          this.shepardPhases[offset + SHEPARD_PARTIALS - 1] = 0;
        }
      }
    }
  }

  updateTraveler(slot, turn) {
    if (!this.travelerInitialized[slot]) {
      this.travelerInitialized[slot] = 1;
      this.travelerTurns[slot] = turn;
      this.travelerPitch[slot] = -turn / TAU * this.params.travelerOctaves;
      this.travelerSmoothedPitch[slot] = this.travelerPitch[slot];
      this.travelerPositions[slot] = ((this.travelerPitch[slot] % 1) + 1) % 1;
      return;
    }
    // Span edits act on future turning. Re-multiplying historic laps would make
    // a small live edit race through many octaves; zero instead holds the note.
    this.travelerPitch[slot] -= (turn - this.travelerTurns[slot]) / TAU * this.params.travelerOctaves;
    this.travelerTurns[slot] = turn;
    const previous = this.travelerSmoothedPitch[slot];
    const pitch = previous + (this.travelerPitch[slot] - previous) * this.smoothing;
    this.travelerSmoothedPitch[slot] = pitch;
    this.travelerPositions[slot] = ((pitch % 1) + 1) % 1;
    const shift = Math.floor(pitch) - Math.floor(previous), offset = slot * SHEPARD_PARTIALS;
    // Each layer can turn either way independently. Re-index phases so all
    // audible partials keep their frequency/phase through either octave seam.
    // A hostile jump is bounded by eleven writes, never by elapsed lap count.
    if (shift > 0) for (let i = SHEPARD_PARTIALS - 1; i >= 0; i--) {
      this.travelerPhases[offset + i] = i >= shift ? this.travelerPhases[offset + i - shift] : 0;
    }
    else if (shift < 0) for (let i = 0; i < SHEPARD_PARTIALS; i++) {
      this.travelerPhases[offset + i] = i - shift < SHEPARD_PARTIALS ? this.travelerPhases[offset + i - shift] : 0;
    }
  }

  shepard(slot, frequency, color, fold, position = this.shepardPosition, phases = this.shepardPhases) {
    let sum = 0, weightSum = 0;
    const halfWidth = 1 + this.params.shepardWidth + .3 * color + .5 * fold;
    const offset = slot * SHEPARD_PARTIALS;
    for (let i = 0; i < SHEPARD_PARTIALS; i++) {
      const octave = i - SHEPARD_CENTER + position;
      const distance = Math.abs(octave) / halfWidth;
      if (distance >= 1) continue;
      const partial = frequency * 2 ** octave;
      const window = (.5 + .5 * Math.cos(Math.PI * distance)) ** 2;
      const weight = window * partialGain(partial, this.sampleRate) * clamp((partial - 8) / 12, 0, 1);
      const phase = phases[offset + i];
      sum += Math.sin(phase * TAU) * weight; weightSum += weight;
      phases[offset + i] = (phase + partial / this.sampleRate) % 1;
    }
    return .94 * sum / Math.max(1, weightSum);
  }

  renderDrums(out) {
    out[0] = 0; out[1] = 0;
    for (const voice of this.drumVoices) {
      voice.residualLeft *= 1 - this.smoothing * 2; voice.residualRight *= 1 - this.smoothing * 2;
      out[0] += voice.residualLeft; out[1] += voice.residualRight;
      if (!voice.active) continue;
      const age = voice.age, decay = voice.decay * (1 + voice.fold * this.params.foldTimbre * .7);
      const envelope = Math.exp(-5 * age / decay) * Math.min(1, age / .002);
      const color = voice.bend * this.params.bendTimbre * 2;
      const fold = voice.fold * this.params.foldTimbre;
      let value = 0;
      const count = voice.voice === 2 ? 6 : voice.voice === 1 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const ratio = voice.voice === 2 ? METAL_RATIOS[i] : voice.voice === 1 ? WOOD_RATIOS[i] : i + 1;
        const pitchDrop = voice.voice === 0 ? 1 + 1.4 * Math.exp(-age / .025) : 1;
        const frequency = voice.frequency * ratio * pitchDrop;
        const weight = i === 0 ? .8 : (.25 + .3 * color + .2 * fold) / i * Math.exp(-age * i / decay);
        value += Math.sin(voice.phases[i] * TAU) * weight * partialGain(frequency, this.sampleRate);
        voice.phases[i] = (voice.phases[i] + frequency / this.sampleRate) % 1;
      }
      const angle = (voice.pan * this.params.panWidth + 1) * Math.PI / 4;
      const signal = value * envelope * .22 * voice.strength * this.drumGains[voice.layer];
      voice.lastLeft = signal * Math.cos(angle); voice.lastRight = signal * Math.sin(angle);
      out[0] += voice.lastLeft; out[1] += voice.lastRight;
      voice.age += 1 / this.sampleRate;
      if (age > decay * 2.5) { voice.active = false; voice.lastLeft = 0; voice.lastRight = 0; }
    }
    out[0] = .45 * Math.tanh(out[0] / .45) * this.params.drumLevel;
    out[1] = .45 * Math.tanh(out[1] / .45) * this.params.drumLevel;
  }

  /** Writes a stereo sample into a reused pair; allocates no per-sample objects. */
  sample(out, baseFrequency, moving) {
    out[0] = 0; out[1] = 0;
    this.rate += (this.targetRate - this.rate) * this.rateSmoothing;
    for (const key of PARAMS) this.params[key] += (this.targets[key] - this.params[key]) * this.smoothing;
    this.travelerMix += ((this.reader === 'traveler' ? 1 : 0) - this.travelerMix) * this.smoothing;
    const blend = this.fade * this.fade * (3 - 2 * this.fade);
    for (let layer = 0; layer < LAYERS; layer++) {
      for (let voice = 0; voice < COLORS; voice++) {
        const index = layer * COLORS + voice;
        this.voiceWeights[index] += ((this.voiceTargets[layer] === voice ? 1 : 0) - this.voiceWeights[index]) * this.smoothing;
      }
      this.drumGains[layer] += (this.enabled[layer] * this.drums[layer] - this.drumGains[layer]) * this.smoothing;
      let contactGain = 0;
      for (let contact = 0; contact < CONTACTS; contact++) {
        const slot = contact * LAYERS + layer;
        const present = readContact(this.bank.layers[layer].contacts[contact], this.phase, this.bank, this.point, this.travel);
        const oldPresent = this.previous ? readContact(this.previous.layers[layer].contacts[contact], this.phase, this.previous, this.oldPoint, this.travel) : 0;
        let pan = this.pans[slot], height = this.heights[slot], bend = this.bends[slot], fold = this.folds[slot];
        let presence = present;
        if (oldPresent > 0 && present > 0) {
          pan = this.oldPoint[0] + (this.point[0] - this.oldPoint[0]) * blend;
          height = this.oldPoint[1] + (this.point[1] - this.oldPoint[1]) * blend;
          bend = this.oldPoint[2] + (this.point[2] - this.oldPoint[2]) * blend;
          fold = this.oldPoint[3] + (this.point[3] - this.oldPoint[3]) * blend;
        } else if (present > 0 || oldPresent > 0) {
          const point = present > 0 ? this.point : this.oldPoint;
          pan = point[0]; height = point[1]; bend = point[2]; fold = point[3];
        }
        if (this.previous) presence = oldPresent + (present - oldPresent) * blend;
        this.pans[slot] += (pan - this.pans[slot]) * this.smoothing;
        this.heights[slot] += (height - this.heights[slot]) * this.smoothing;
        this.bends[slot] += (bend - this.bends[slot]) * this.smoothing;
        this.folds[slot] += (fold - this.folds[slot]) * this.smoothing;
        this.gains[slot] += (presence * this.enabled[layer] * this.sustain[layer] - this.gains[slot]) * this.smoothing;
        if (this.reader === 'traveler') {
          const currentTurn = present > 0 && this.bank.reader === 'traveler';
          const previousTurn = oldPresent > 0 && this.previous?.reader === 'traveler';
          if (currentTurn || previousTurn) {
            const turn = currentTurn && previousTurn ? this.oldPoint[4] + (this.point[4] - this.oldPoint[4]) * blend
              : currentTurn ? this.point[4] : this.oldPoint[4];
            this.updateTraveler(slot, turn);
          }
        }
        contactGain += this.gains[slot];
      }
      for (let contact = 0; contact < CONTACTS; contact++) {
        const slot = contact * LAYERS + layer;
        // Ordinary voices smoothly reach a four-octave excursion limit. The
        // Shepard voice uses wrapped pitch with a fixed spectral center instead.
        const spatialPitch = this.params.pitchDepth * this.heights[slot];
        const travelerPitch = clamp(this.travelerSmoothedPitch[slot], -4, 4);
        const pitch = spatialPitch + (travelerPitch - spatialPitch) * this.travelerMix;
        const reference = clamp(baseFrequency * REGISTERS[layer], 8, this.sampleRate * .2, 110);
        const frequency = clamp(reference * 2 ** pitch, 8, this.sampleRate * .2, 110);
        this.frequencies[slot] = frequency;
        const theta = this.carriers[slot] * TAU, fundamental = Math.sin(theta);
        const color = this.bends[slot] * this.params.bendTimbre * 2, fold = this.folds[slot] * this.params.foldTimbre;
        const glassIndex = slot * 3;
        let signal = 0;
        if (this.gains[slot] > 1e-10) for (let voice = 0; voice < COLORS; voice++) {
          const weight = this.voiceWeights[layer * COLORS + voice];
          if (weight < 1e-8) continue;
          let value;
          if (voice === 0) {
            value = .94 * fundamental + .06 * color * partialGain(frequency * 2, this.sampleRate) * Math.sin(theta * 2);
          } else if (voice === 1) {
            value = .68 * fundamental
              + (.07 + .09 * color) * partialGain(frequency * 3, this.sampleRate) * Math.sin(theta * 3)
              + (.025 + .075 * color) * partialGain(frequency * 5, this.sampleRate) * Math.sin(theta * 5)
              + (.01 + .05 * color) * partialGain(frequency * 7, this.sampleRate) * Math.sin(theta * 7);
          } else if (voice === 2) {
            value = .62 * fundamental
              + (.08 + .14 * color) * partialGain(frequency * GLASS_RATIOS[0], this.sampleRate) * Math.sin(this.glassPhases[glassIndex] * TAU)
              + (.025 + .075 * color) * partialGain(frequency * GLASS_RATIOS[1], this.sampleRate) * Math.sin(this.glassPhases[glassIndex + 1] * TAU)
              + (.01 + .05 * color) * partialGain(frequency * GLASS_RATIOS[2], this.sampleRate) * Math.sin(this.glassPhases[glassIndex + 2] * TAU);
          } else {
            const spatialFrequency = clamp(reference * 2 ** spatialPitch, 8, this.sampleRate * .2, 110);
            const usual = this.travelerMix < 1 - 1e-8 ? this.shepard(slot, spatialFrequency, color, fold) : 0;
            const traveler = this.travelerMix > 1e-8 ? this.shepard(slot, reference, color, fold, this.travelerPositions[slot], this.travelerPhases) : 0;
            value = usual * (1 - this.travelerMix) + traveler * this.travelerMix;
          }
          // Fold (deviation from a broader local curve) adds an independently
          // controllable hollow spectral color, rather than another bend trigger.
          if (voice !== 3) value = value * (1 - .12 * fold)
            + fold * (.15 * partialGain(frequency * 4, this.sampleRate) * Math.sin(theta * 4)
              + .08 * partialGain(frequency * 9, this.sampleRate) * Math.sin(theta * 9));
          signal += value * weight;
        }
        const angle = (this.pans[slot] * this.params.panWidth + 1) * Math.PI / 4;
        const gain = this.gains[slot] * .3 / Math.max(1, contactGain) * this.params.toneLevel;
        out[0] += signal * gain * Math.cos(angle); out[1] += signal * gain * Math.sin(angle);
        this.carriers[slot] = (this.carriers[slot] + frequency / this.sampleRate) % 1;
        for (let partial = 0; partial < 3; partial++) {
          const index = glassIndex + partial;
          this.glassPhases[index] = (this.glassPhases[index] + frequency * GLASS_RATIOS[partial] / this.sampleRate) % 1;
        }
      }
    }
    this.renderDrums(this.drumPair);
    out[0] = softBound(out[0] + this.drumPair[0]); out[1] = softBound(out[1] + this.drumPair[1]);
    if (this.previous) {
      this.fade = Math.min(1, this.fade + this.fadeStep);
      if (this.fade === 1) {
        this.previous = null;
        if (this.pending) { const next = this.pending; this.pending = null; this.activateBank(next); }
      }
    }
    if (moving) {
      const step = this.rate / this.sampleRate;
      const nextPhase = (this.phase + step) % 1, nextTravel = this.travel + step;
      this.crossEvents(nextPhase, nextTravel); this.advanceShepard(step);
      this.phase = nextPhase; this.travel = nextTravel;
    }
  }
}
