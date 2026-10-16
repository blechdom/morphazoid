import { MAX_SOUNDFONT_BYTES } from '../../sound-fonts/bank-format.js';
import { sanitizeMidiNoteEffects } from '../../midi-note-effects.js';
import { connectAudioOutput } from '../../audio-output-manager.js';
import { parseMidi, clamp, defaultDeckConfig, sanitizeDeckConfig, loopLength, loopBounds, deckPosition, defaultWeaveConfig, sanitizeWeaveConfig, weavePosition, MIDI_SAMPLE_LIMITS, MAX_MIDI_MIXER_TEMPO } from './midi-mixer-model.js';
import { sanitizeMidiParameters, sanitizeMidiSynthEffects, mergeMidiParameters } from './midi-mixer-parameters.js';
import { reverseMidiAnalysis, buildMidiStateHistories, getMidiNoteGates, midiStateMessages } from './midi-mixer-reverse.js';
import { compileSampleTempoMap, advanceSampleTiming, sampleReplacementBoundary, sampleTempoAt, sampleSecondsAt } from './midi-mixer-clock.js';
import { transformMidiStamp } from './midi-mixer-score-transform.js';
import { MidiAutomataClock, captureAutomataMidi } from './midi-mixer-automata.js';
export { MIDI_SAMPLE_LIMITS } from './midi-mixer-model.js';

const WORKLET_URL = new URL('./midi-mixer-processor.js', import.meta.url);
const SOUNDFONT_URL = new URL('../../../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url);
const safeCall = (callback, value) => { try { callback?.(value); } catch { /* Display callbacks cannot break audio. */ } };
const emptyDeck = () => ({ name: '', analysis: null, sourceAnalysis: null, config: defaultDeckConfig(), channels: [], token: 0, loaded: false });
export const MAX_MIDI_CHASE_MESSAGES = 4096;
/** Compact channel histories support seeks without replaying past attacks. */
export function compileDeck(analysis) {
  if (!analysis.ppq) analysis = { ...analysis, ppq: 480 };
  const histories = new Map();
  for (const event of analysis.events) {
    if (event.kind === 8 || event.kind === 9) continue;
    const key = `${event.channel}:${event.kind}:${event.kind === 11 || event.kind === 10 ? event.a : 0}`;
    if (!histories.has(key)) histories.set(key, []);
    histories.get(key).push(event);
  }
  const stateHistories = { ppq: analysis.ppq, channels: [...buildMidiStateHistories(analysis)].map(([channel, state]) => ({ channel, lanes: [...state.lanes.values()] })) };
  const chaseMessages = stateHistories.channels.reduce((sum, channel) => sum + channel.lanes.reduce((count, lane) => count + Math.max(1, lane.current === undefined ? 0 : midiStateMessages(lane, lane.current).length), 0), 0);
  if (chaseMessages > MAX_MIDI_CHASE_MESSAGES) throw new Error('This MIDI needs more than 4,096 controller restoration messages; the current source is unchanged.');
  if (analysis.events.some(event => event.kind === 11 && event.a === 66 && event.b >= 64)) {
    const warning = 'The browser SoundFont engine does not sustain continuous forward CC66 notes. Rejoined held gates and Reverse + controllers preserve recorded sostenuto lengths.';
    analysis.warnings = [...new Set([...(analysis.warnings ?? []), warning])];
  }
  for (const channel of stateHistories.channels) for (const lane of channel.lanes) if (lane.kind === 'cc' && lane.number === 66) {
    let rise = -Infinity, riseOrder = -Infinity;
    for (const change of lane.changes) {
      if (change.previous < 64 && change.value >= 64) { rise = change.tick; riseOrder = change.order; }
      change.rise = rise; change.riseOrder = riseOrder;
    }
  }
  const gates = getMidiNoteGates(analysis);
  const count = gates.length, held = { keyEndOrder: new Float64Array(count), keyEnd: new Float64Array(count), stateHistories, start: new Float64Array(count), end: new Float64Array(count), maxEnd: new Float64Array(count), info: new Uint32Array(count), ids: new Uint32Array(count) };
  for (let index = 0; index < count; index++) {
    const note = gates[index]; held.start[index] = note.start / analysis.ppq; held.end[index] = note.end / analysis.ppq; held.keyEnd[index] = note.keyEnd / analysis.ppq; held.keyEndOrder[index] = note.keyEndOrder ?? Infinity;
    held.info[index] = (note.channel << 14) | (note.note << 7) | note.velocity;
    held.ids[index] = note.id ?? index;
  }
  const augment = (low, high) => {
    if (low >= high) return -Infinity;
    const middle = (low + high) >>> 1;
    return held.maxEnd[middle] = Math.max(held.end[middle], augment(low, middle), augment(middle + 1, high));
  };
  augment(0, count);
  return { tempoMap: compileSampleTempoMap(analysis.tempoMap), events: analysis.events, channels: analysis.channels, stateHistories, controllers: [...histories.values()], held, loopBeats: loopLength(analysis), durationBeats: analysis.durationBeats };
}

export class MidiMixerEngine {
  constructor({ onState, onNotes, runtime = globalThis, connectOutput = connectAudioOutput, maxTempo = 300 } = {}) {
    this.runtime = runtime; this.onState = onState; this.onNotes = onNotes; this._connectOutput = connectOutput;
    this.context = null; this.node = null; this._gain = null; this._preamp = null; this._compressor = null; this._ceiling = null;
    this._filter = null; this._delay = null; this._dry = null; this._wet = null; this._feedback = null;
    this._effects = { filterHz: 20000, delayMix: 0, delayBeats: 0.5, feedback: 0.3, synth: {} };
    this._font = null; this._fontName = 'TimGM6mb'; this._fontWaits = new Map(); this._fontSelection = 0;
    this._releaseOutput = null; this._promise = null; this._ready = false; this._disposed = false; this._serial = 0;
    this._externalSources = new Map();
    this._maxTempo = clamp(maxTempo, 30, MAX_MIDI_MIXER_TEMPO, 300);
    this._playing = false; this._desiredAudio = false; this._audioEnabled = false; this._volume = 0.6; this._tempo = 120; this._crossfade = 0;
    this._beat = 0; this._anchor = this._now(); this._audioAnchor = null; this._audioTempo = 120;
    this._sampleTime = 0; this._sampleBeat = 0; this._sampleAnchor = this._anchor; this._sampleAudioAnchor = null; this._samples = []; this._finishedSamples = []; this._completedSampleSources = new WeakSet(); this._sampleMidi = {}; this._noteSubscribers = new Set();
    this._sampleBuffers = new WeakMap();
    this._sampleNoteCount = 0; this._sampleNoteLedger = new WeakMap(); this._generatedNoteBaseline = 0;
    this._decks = [emptyDeck(), emptyDeck()]; this._compiled = [null, null]; this._sources = [null, null]; this._weave = defaultWeaveConfig(); this._weavePhase = { startBeat: 0, deckBeats: [0, 0] }; this._error = null; this._abort = null;
    this._skippedEvents = 0; this._voices = 0; this._droppedVisualEvents = 0; this._listeners = []; this._waitCancel = null;
    this._noteEffects = sanitizeMidiNoteEffects();
    this._automata = new MidiAutomataClock(); this._automataAnchor = this._now(); this._automataRevision = 0; this._automataWaits = new Map(); this._automataSkippedSilentBeats = 0;
    this._onPageHide = () => { void this.dispose(); }; this.runtime.addEventListener?.('pagehide', this._onPageHide);
  }
  _now() { return (this.runtime.performance?.now?.() ?? Date.now()) / 1000; }
  get state() {
    this._advanceAutomata();
    let beat = this._beat;
    const sampleBeat = this._sampleBeat + (this._ready && this._sampleAudioAnchor !== null && this.context
      ? Math.max(0, this.context.currentTime - this._sampleAudioAnchor) * this._audioTempo / 60
      : Math.max(0, this._now() - this._sampleAnchor) * this._tempo / 60);
    const sampleTime = this._sampleTime + (this._ready && this._sampleAudioAnchor !== null && this.context
      ? Math.max(0, this.context.currentTime - this._sampleAudioAnchor) : Math.max(0, this._now() - this._sampleAnchor));
    if (this._playing) {
      if (this._ready && this._audioAnchor !== null && this.context) beat += Math.max(0, this.context.currentTime - this._audioAnchor) * this._audioTempo / 60;
      else beat += Math.max(0, this._now() - this._anchor) * this._tempo / 60;
    }
    const weave = weavePosition(beat, this._weave, this._weavePhase);
    this._finishedSamples = this._finishedSamples.filter(sample => sample.finishedAt > sampleTime - 30 && sample.finishedAt <= sampleTime);
    return { weave: { ...this._weave }, weaveStep: weave.step, currentWeaveDeck: weave.deck, ready: this._ready, loading: Boolean(this._promise), audioEnabled: this._audioEnabled && this.context?.state === 'running', playing: this._playing,
      tempo: this._tempo, beat, sampleBeat, sampleTime, automata: { ...this._automata.snapshot(), skippedSilentBeats: this._automataSkippedSilentBeats }, samples: this._samples.flatMap(sample => {
        const timing = this._sampleTiming(sample, sampleBeat, sampleTime);
        if (timing.ended) { this._rememberFinishedSample(sample, timing, sampleBeat, sampleTime); return []; }
        const { compiled, sent, timing: stored, timingBeat, timingTime, quantize, pendingReplacement, ...visible } = sample;
        return [{ ...visible, effectiveMuted: sample.muted || this._samples.some(other => other.solo && !this._sampleTiming(other, sampleBeat, sampleTime).ended) && !sample.solo, ...(pendingReplacement ? { pendingReplacement: { name: pendingReplacement.name, analysis: pendingReplacement.analysis, token: pendingReplacement.token } } : {}), midi: sanitizeMidiParameters(sample.midi), positionBeats: timing.positionBeats, cycle: timing.cycle, pendingBeats: timing.pendingBeats, pending: timing.pendingBeats > 1e-9, tempo: sample.sync ? this._tempo : sampleTempoAt(compiled, timing.positionBeats) }];
      }), finishedSamples: this._finishedSamples.map(sample => ({ ...sample, midi: sanitizeMidiParameters(sample.midi) })), sampleMidi: sanitizeMidiParameters(this._sampleMidi), noteEffects: { ...this._noteEffects }, effects: { ...this._effects, synth: sanitizeMidiSynthEffects(this._effects.synth) }, soundfontName: this._fontName, volume: this._volume, crossfade: this._crossfade, error: this._error,
      generatedNoteCount: Math.max(0, this._sampleNoteCount + this._automata.serial - this._generatedNoteBaseline),
      skippedEvents: this._skippedEvents, voices: this._voices, droppedVisualEvents: this._droppedVisualEvents,
      decks: this._decks.map((deck, index) => ({ ...deck, config: { ...deck.config, midi: sanitizeMidiParameters(deck.config.midi) }, channels: deck.channels.map(channel => ({ ...channel, midi: sanitizeMidiParameters(channel.midi) })), weaveActive: weave.active[index], positionBeats: deckPosition(weave.deckBeats[index], deck.analysis, deck.config), sourcePositionBeats: deck.config.reverse === 'off' ? deckPosition(weave.deckBeats[index], deck.analysis, deck.config) : Math.max(0, (deck.sourceAnalysis?.durationBeats ?? 0) - deckPosition(weave.deckBeats[index], deck.analysis, deck.config)), loopBeats: loopBounds(deck.analysis, deck.config).length, loopStartBeats: loopBounds(deck.analysis, deck.config).start, loopEndBeats: loopBounds(deck.analysis, deck.config).end })) };
  }
  subscribeNotes(callback) { if (typeof callback !== 'function') return () => {}; this._noteSubscribers.add(callback); return () => this._noteSubscribers.delete(callback); }
  _publishNotes(notes) { if (!notes.length) return; safeCall(this.onNotes, notes); for (const callback of this._noteSubscribers) safeCall(callback, notes); }
  /** Count source-score attacks crossed by the layer clocks, before MIDI FX,
   * voice limits or display thinning. The weak ledger retains no expired score;
   * each active source needs only a binary search, even after many missed loops.
   */
  _countSampleNotes(sample, timing) {
    if (sample.paused || timing.pendingBeats > 1e-9 || timing.unavailable) return;
    let ledger = this._sampleNoteLedger.get(sample);
    if (!ledger) { ledger = { firstCycle: 0, counted: 0 }; this._sampleNoteLedger.set(sample, ledger); }
    const starts = sample.compiled.held.start;
    let low = 0, high = starts.length;
    while (low < high) { const middle = (low + high) >>> 1; if (starts[middle] <= timing.positionBeats) low = middle + 1; else high = middle; }
    const count = Math.max(0, (timing.cycle ?? 0) - ledger.firstCycle) * starts.length + low;
    // Late worklet telemetry may precede an already observed playhead. It must
    // neither subtract notes nor count that same interval again when it catches up.
    if (count > ledger.counted) { this._sampleNoteCount += count - ledger.counted; ledger.counted = count; }
  }
  resetNoteCount() {
    if (this._disposed) return false;
    // Settle each source at its current clock without seeking, replaying or
    // clearing it. The cumulative ledger survives the visible counter reset.
    void this.state;
    this._generatedNoteBaseline = this._sampleNoteCount + this._automata.serial;
    this._publish(); return true;
  }
  _advanceAutomata() {
    const now = this._now();
    if (!this._ready && !this._disposed && this._automata.playing) {
      // A hidden silent tab may return hours later. Evolve only its retained
      // 16-beat window; discard older idle time instead of replaying a backlog
      // or fabricating descendants. Audio rendering never takes this path.
      const beats = Math.max(0, now - this._automataAnchor) * this._tempo / 60;
      this._automataSkippedSilentBeats += Math.max(0, beats - 16);
      this._automata.advance(Math.min(beats, 16), this._tempo);
    }
    this._automataAnchor = now;
  }
  configureAutomata(settings = {}) {
    if (this._disposed) return false;
    this._advanceAutomata(); this._automata.configure(settings);
    this._post({ type: 'automataConfigure', settings: this._automata.settings, revision: ++this._automataRevision });
    this._publish(); return this.state.automata;
  }
  setAutomataPlaying(playing) {
    if (this._disposed) return false;
    this._advanceAutomata(); this._automata.setPlaying(playing);
    this._post({ type: 'automataPlaying', playing: Boolean(playing), revision: ++this._automataRevision });
    this._publish(); return this.state.automata;
  }
  restartAutomata() {
    if (this._disposed) return false;
    this._advanceAutomata(); this._automata.restart();
    this._post({ type: 'automataRestart', revision: ++this._automataRevision });
    this._publish(); return this.state.automata;
  }
  reseedAutomata() {
    if (this._disposed) return false;
    this._advanceAutomata(); this._automata.reseed();
    this._post({ type: 'automataReseed', revision: ++this._automataRevision });
    this._publish(); return this.state.automata;
  }
  async captureAutomata(beats = 4) {
    if (this._disposed) throw new Error('Automatapoeia has closed.');
    this._advanceAutomata();
    if (!this._ready) return captureAutomataMidi(this._automata.snapshot(true), beats);
    const token = ++this._serial;
    const state = await new Promise((resolve, reject) => {
      const timer = this.runtime.setTimeout(() => { this._automataWaits.delete(token); reject(new Error('Automatapoeia capture timed out.')); }, 5000);
      this._automataWaits.set(token, { resolve, reject, timer }); this._post({ type: 'automataCapture', token });
    });
    return captureAutomataMidi(state, beats);
  }
  _sampleTiming(sample, beat, seconds) {
    const beats = Math.max(0, beat - sample.timingBeat), elapsed = Math.max(0, seconds - sample.timingTime);
    const boundary = sample.pendingReplacement ? sampleReplacementBoundary(sample.timing, sample.compiled, sample, beats, elapsed) : null;
    if (boundary !== null) this._applySampleReplacement(sample, sample.pendingReplacement, sample.timingBeat + beats * boundary, sample.timingTime + elapsed * boundary, 0, sample.timing.cycle + 1);
    const timing = advanceSampleTiming(sample.timing, sample.compiled, sample, Math.max(0, beat - sample.timingBeat), Math.max(0, seconds - sample.timingTime));
    this._countSampleNotes(sample, timing); return timing;
  }
  _applySampleReplacement(sample, replacement, beat, seconds, pendingBeats = 0, cycle = sample.timing.cycle) {
    this._countSampleNotes(sample, cycle > sample.timing.cycle
      ? { positionBeats: sample.analysis.durationBeats, cycle: cycle - 1, pendingBeats: 0 }
      : sample.timing);
    // Keep one bounded finished-score record, so a skipped display frame can
    // still reconstruct gates that actually played before this replacement.
    if (!sample.timing.pendingBeats && (cycle > sample.timing.cycle || sample.timing.positionBeats > 0)) {
      const { compiled, sent, timing, timingBeat, timingTime, pendingReplacement, ...visible } = sample;
      const positionBeats = cycle > timing.cycle ? sample.analysis.durationBeats : timing.positionBeats;
      this._finishedSamples.push({ ...visible, positionBeats, cycle: cycle > timing.cycle ? cycle - 1 : cycle, pending: false, ended: true, replaced: true, finishedAt: sample.paused ? sample.pausedAt : seconds, tempo: sample.sync ? this._tempo : sampleTempoAt(compiled, positionBeats) });
      if (this._finishedSamples.length > 8) this._finishedSamples.shift();
    }
    if (replacement.sourceBuffer) this._sampleBuffers.set(sample, replacement.sourceBuffer);
    sample.analysis = replacement.analysis; sample.compiled = replacement.compiled; sample.name = replacement.name;
    sample.scoreVersion = sample.scoreRevision = replacement.token; sample.replacedAt = seconds; sample.replacedEpoch = sample.playbackEpoch; sample.pendingReplacement = null;
    sample.playbackEpoch++; sample.resumedPositionBeats = 0; sample.resumedCycle = cycle;
    sample.timing = { positionBeats: 0, cycle, pendingBeats: Math.max(pendingBeats, replacement.delayBeats ?? 0), ended: false }; sample.timingBeat = beat; sample.timingTime = seconds;
    this._sampleNoteLedger.set(sample, { firstCycle: cycle, counted: 0 });
  }
  // Completion metadata is display-only. Explicit stops and stolen slots never
  // enter this bounded window, so a renderer cannot turn canceled forecasts into
  // performed history. Source scores expire with the last eight completions.
  _rememberFinishedSample(sample, timing, beat, seconds) {
    if (this._completedSampleSources.has(sample) && !Number.isFinite(timing.finishedAt)) return;
    this._completedSampleSources.add(sample);
    const tempo = this._ready ? this._audioTempo : this._tempo;
    const elapsedBeats = Math.max(0, beat - sample.timingBeat);
    const delay = Math.min(sample.timing.pendingBeats, elapsedBeats);
    const overshoot = sample.sync
      ? Math.max(0, sample.timing.positionBeats + elapsedBeats - delay - sample.analysis.durationBeats) * 60 / tempo
      : Math.max(0, sampleSecondsAt(sample.compiled, sample.timing.positionBeats) + Math.max(0, seconds - sample.timingTime)
        * (elapsedBeats > 0 ? 1 - delay / elapsedBeats : 1) - sampleSecondsAt(sample.compiled, sample.analysis.durationBeats));
    const finishedAt = Number.isFinite(timing.finishedAt) ? timing.finishedAt : Math.max(sample.timingTime, seconds - overshoot);
    if (finishedAt <= seconds - 30 || finishedAt > seconds || this._disposed) return;
    const { compiled, sent, timing: stored, timingBeat, timingTime, quantize, ...visible } = sample;
    const finished = { ...visible, midi: sanitizeMidiParameters(sample.midi), positionBeats: sample.analysis.durationBeats,
      cycle: timing.cycle ?? sample.timing.cycle, pending: false, ended: true, finishedAt,
      tempo: sample.sync ? tempo : sampleTempoAt(compiled, sample.analysis.durationBeats) };
    const index = this._finishedSamples.findIndex(item => item.id === sample.id && item.scoreVersion === sample.scoreVersion);
    if (index >= 0) this._finishedSamples[index] = finished;
    else { this._finishedSamples.push(finished); if (this._finishedSamples.length > 8) this._finishedSamples.shift(); }
  }
  _receiveSampleTimings(timings, beat, seconds) {
    for (const timing of timings) {
      const sample = this._samples.find(item => item.id === timing.id && item.revision === timing.revision);
      if (!sample) continue;
      if (sample.pendingReplacement && timing.scoreVersion === sample.pendingReplacement.token) {
        const at = Number.isFinite(timing.replacedAt) ? timing.replacedAt : seconds;
        this._applySampleReplacement(sample, sample.pendingReplacement, beat, at, 0, timing.resumedCycle ?? timing.cycle);
      }
      if (Number.isInteger(timing.scoreVersion) && timing.scoreVersion < (sample.scoreVersion ?? 0)) continue;
      this._countSampleNotes(sample, timing);
      if (timing.ended) {
        if (!timing.unavailable) this._rememberFinishedSample(sample, timing, beat, seconds);
        this._samples = this._samples.filter(item => item.id !== timing.id); continue;
      }
      if (sample) {
        sample.timing = { positionBeats: timing.positionBeats, pendingBeats: timing.pendingBeats, cycle: timing.cycle, ended: timing.ended }; sample.timingBeat = beat; sample.timingTime = seconds;
        if (Number.isFinite(timing.pausedAt)) sample.pausedAt = timing.pausedAt;
        if (Number.isInteger(timing.pausedEpoch)) sample.pausedEpoch = timing.pausedEpoch;
        if (Number.isFinite(timing.replacedAt)) sample.replacedAt = timing.replacedAt;
        if (Number.isInteger(timing.replacedEpoch)) sample.replacedEpoch = timing.replacedEpoch;
        if (Number.isInteger(timing.playbackEpoch) && timing.playbackEpoch === sample.playbackEpoch) {
          sample.resumedPositionBeats = timing.resumedPositionBeats; sample.resumedCycle = timing.resumedCycle;
        }
      }
    }
  }
  triggerSample(buffer, { name = 'MIDI sample', program = null, gain = 0.8, midi = {}, loop = false, sync = true, delayBeats = 0, quantize = true, source = '', channel = null, transpose = 0, muted = false, solo = false, pan = 0 } = {}) {
    if (this._disposed) return false;
    if ((buffer?.byteLength ?? 0) > MIDI_SAMPLE_LIMITS.fileBytes) throw new Error('MIDI stamps must be 2 MB or smaller.');
    const sourceBuffer = buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const analysis = channel == null ? parseMidi(sourceBuffer) : transformMidiStamp(sourceBuffer, { channel }).analysis;
    if (analysis.notes.length > MIDI_SAMPLE_LIMITS.notes || analysis.events.length > MIDI_SAMPLE_LIMITS.events || analysis.channels.length > MIDI_SAMPLE_LIMITS.channels || analysis.durationBeats > MIDI_SAMPLE_LIMITS.beats) throw new Error('Use a stamp of at most 512 beats, 32,768 notes and 16 channels.');
    const compiled = compileDeck(analysis), state = this.state, startBeat = state.sampleBeat;
    sync = Boolean(sync); loop = Boolean(loop);
    delayBeats = clamp(delayBeats, 0, 512, 0);
    const quantizedBeats = quantize && sync && state.playing ? Math.max(0, Math.ceil(state.beat - 1e-9) - state.beat) : 0;
    const pendingBeats = delayBeats + quantizedBeats;
    this._samples = this._samples.filter(sample => !this._sampleTiming(sample, state.sampleBeat, state.sampleTime).ended);
    const used = new Set(this._samples.map(sample => sample.slot));
    let slot = Array.from({ length: MIDI_SAMPLE_LIMITS.clips }, (_, index) => index).find(index => !used.has(index));
    if (slot === undefined) {
      const oldestPlaying = this._samples.findIndex(sample => !sample.paused);
      if (oldestPlaying < 0) throw new Error('All four layers are paused. Stop a layer before dropping another.');
      slot = this._samples.splice(oldestPlaying, 1)[0].slot;
    }
    const sample = { muted: Boolean(muted), solo: Boolean(solo), pan: clamp(pan, -1, 1, 0), id: ++this._serial, slot, name: String(name).slice(0, 128), analysis, compiled, startBeat, loop, sync, paused: false, pausedAt: null, revision: 0, scoreVersion: 0, scoreRevision: 0, playbackEpoch: 0, resumedPositionBeats: 0, resumedCycle: 0, quantize: Boolean(quantizedBeats && state.audioEnabled), delayBeats, source: String(source).slice(0, 64), channel: channel == null ? null : Math.round(clamp(channel, 0, 15, 0)), transpose: Math.round(clamp(transpose, -127, 127, 0)), timing: { positionBeats: 0, cycle: 0, pendingBeats, ended: false }, timingBeat: state.sampleBeat, timingTime: state.sampleTime, gain: clamp(gain, 0, 1, 0.8), midi: mergeMidiParameters(this._sampleMidi, midi), program: program == null ? null : Math.round(clamp(program, 0, 127)), sent: false };
    this._sampleBuffers.set(sample, sourceBuffer);
    this._samples.push(sample); this._sendSamples(); this._publish(); return this.state.samples.find(item => item.id === sample.id);
  }
  replaceSample(id, buffer, { name, when = 'next-loop', delayBeats = 0 } = {}) {
    if (this._disposed) return false;
    const sample = this._samples.find(item => item.id === id); if (!sample) return false;
    if ((buffer?.byteLength ?? 0) > MIDI_SAMPLE_LIMITS.fileBytes) throw new Error('MIDI stamps must be 2 MB or smaller.');
    const sourceBuffer = buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const analysis = sample.channel == null ? parseMidi(sourceBuffer) : transformMidiStamp(sourceBuffer, { channel: sample.channel }).analysis;
    if (analysis.notes.length > MIDI_SAMPLE_LIMITS.notes || analysis.events.length > MIDI_SAMPLE_LIMITS.events || analysis.channels.length > MIDI_SAMPLE_LIMITS.channels || analysis.durationBeats > MIDI_SAMPLE_LIMITS.beats) throw new Error('Use a stamp of at most 512 beats, 32,768 notes and 16 channels.');
    const compiled = compileDeck(analysis), state = this.state, timing = this._sampleTiming(sample, state.sampleBeat, state.sampleTime);
    if (timing.ended || !sample.loop && !sample.paused && !timing.pendingBeats && timing.positionBeats > 0 && when !== 'restart') return false;
    sample.timing = timing; sample.timingBeat = state.sampleBeat; sample.timingTime = state.sampleTime;
    const previousScoreVersion = sample.scoreVersion;
    const replacement = { sourceBuffer, analysis, compiled, name: String(name ?? sample.name).slice(0, 128), token: ++sample.revision, delayBeats: clamp(delayBeats, 0, 64, 0) };
    const immediate = when !== 'cycle-boundary' && (when === 'restart' || sample.paused || timing.pendingBeats > 0 || timing.positionBeats === 0 && timing.cycle === 0);
    if (immediate) this._applySampleReplacement(sample, replacement, state.sampleBeat, state.sampleTime, timing.pendingBeats);
    else sample.pendingReplacement = replacement;
    if (sample.sent) this._post({ type: 'sampleReplacement', slot: sample.slot, id: sample.id, revision: sample.revision, scoreVersion: previousScoreVersion,
      replacement: { data: compiled, name: replacement.name, token: replacement.token, delayBeats: replacement.delayBeats }, program: sample.program, restart: immediate, defer: when === 'cycle-boundary' });
    this._publish(); return this.state.samples.find(item => item.id === id) ?? false;
  }
  /** Grow a first-pass live drawing without releasing held notes or replaying its past.
   * Existing notes/controllers are immutable; only future attacks may be added. */
  appendSample(id, buffer) {
    if (this._disposed) return false;
    const sample = this._samples.find(item => item.id === id); if (!sample) return false;
    const state = this.state, timing = this._sampleTiming(sample, state.sampleBeat, state.sampleTime);
    if (sample.loop || timing.ended || timing.cycle || sample.pendingReplacement) return false;
    if ((buffer?.byteLength ?? 0) > MIDI_SAMPLE_LIMITS.fileBytes) throw new Error('MIDI stamps must be 2 MB or smaller.');
    const sourceBuffer = buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const analysis = sample.channel == null ? parseMidi(sourceBuffer) : transformMidiStamp(sourceBuffer, { channel: sample.channel }).analysis;
    if (analysis.notes.length > MIDI_SAMPLE_LIMITS.notes || analysis.events.length > MIDI_SAMPLE_LIMITS.events || analysis.channels.length > MIDI_SAMPLE_LIMITS.channels || analysis.durationBeats > MIDI_SAMPLE_LIMITS.beats) throw new Error('This drawing reached its MIDI limit.');
    if (sample.paused && analysis.notes.length !== sample.analysis.notes.length) return false;
    if (analysis.durationBeats <= timing.positionBeats || analysis.channels.map(channel => channel.channel).join(',') !== sample.analysis.channels.map(channel => channel.channel).join(',')) return false;
    const controls = value => value.events.filter(event => event.kind !== 8 && event.kind !== 9).map(({ beat, kind, channel, a, b }) => [beat, kind, channel, a, b]);
    if (JSON.stringify(controls(analysis)) !== JSON.stringify(controls(sample.analysis))) return false;
    const key = note => [note.channel, note.note, note.beat, note.duration, note.velocity].join(':');
    const previous = new Map(); let serial = 0;
    for (const note of sample.analysis.notes) { const signature = key(note); if (!previous.has(signature)) previous.set(signature, []); previous.get(signature).push(note.id); serial = Math.max(serial, note.id + 1); }
    const ids = new Map();
    for (const note of analysis.notes) {
      const retained = previous.get(key(note));
      if (!retained?.length && note.beat < timing.positionBeats + 1e-9 && !timing.pendingBeats) return false;
      ids.set(note.id, retained?.length ? retained.shift() : serial++);
    }
    if ([...previous.values()].some(remaining => remaining.length)) return false;
    for (const note of analysis.notes) note.id = ids.get(note.id);
    for (const event of analysis.events) if (event.noteId !== undefined) event.noteId = ids.get(event.noteId);
    const compiled = compileDeck(analysis);
    sample.analysis = analysis; sample.compiled = compiled; this._sampleBuffers.set(sample, sourceBuffer);
    sample.timing = timing; sample.timingBeat = state.sampleBeat; sample.timingTime = state.sampleTime;
    sample.scoreRevision = ++sample.revision;
    if (sample.sent) this._post({ type: 'sampleAppend', slot: sample.slot, id: sample.id, revision: sample.revision, data: compiled });
    this._publish(); return this.state.samples.find(item => item.id === id) ?? false;
  }
  configureSamples({ midi, gain, loop, sync } = {}) {
    const state = this.state;
    this._samples = this._samples.filter(sample => !this._sampleTiming(sample, state.sampleBeat, state.sampleTime).ended);
    this._sampleMidi = sanitizeMidiParameters(midi, this._sampleMidi);
    for (const sample of this._samples) {
      sample.timing = this._sampleTiming(sample, state.sampleBeat, state.sampleTime); sample.timingBeat = state.sampleBeat; sample.timingTime = state.sampleTime;
      if (loop !== undefined) { sample.loop = Boolean(loop); if (!sample.loop) sample.pendingReplacement = null; }
      if (sync !== undefined) { sample.sync = Boolean(sync); if (!sample.sync) sample.timing.pendingBeats = 0; }
      sample.scoreRevision = ++sample.revision;
      sample.midi = sanitizeMidiParameters(midi, sample.midi);
      if (gain !== undefined) sample.gain = clamp(gain, 0, 1, sample.gain);
      if (sample.sent) this._post({ type: 'sampleParameters', slot: sample.slot, id: sample.id, midi: sample.midi, gain: sample.gain, loop: sample.loop, sync: sample.sync, revision: sample.revision, ...(sample.scoreVersion ? { scoreVersion: sample.scoreVersion } : {}) });
    }
    this._publish(); return sanitizeMidiParameters(this._sampleMidi);
  }
  configureSample(id, { loop, sync, gain, midi, muted, solo, pan, channel, program } = {}) {
    if (this._disposed) return false;
    const sample = this._samples.find(item => item.id === id); if (!sample) return false;
    const state = this.state, timing = this._sampleTiming(sample, state.sampleBeat, state.sampleTime);
    if (timing.ended) return false;
    // Rebase only this clip before changing its timebase. The other clips and
    // decks retain their clocks; turning Loop off finishes this current pass.
    sample.timing = timing; sample.timingBeat = state.sampleBeat; sample.timingTime = state.sampleTime;
    if (loop !== undefined) { sample.loop = Boolean(loop); if (!sample.loop) sample.pendingReplacement = null; }
    if (sync !== undefined) { sample.sync = Boolean(sync); if (!sample.sync) sample.timing.pendingBeats = 0; }
    if (gain !== undefined) sample.gain = clamp(gain, 0, 1, sample.gain);
    if (midi !== undefined) sample.midi = sanitizeMidiParameters(midi, sample.midi);
    if (muted !== undefined) sample.muted = Boolean(muted);
    if (solo !== undefined) sample.solo = Boolean(solo);
    if (pan !== undefined) sample.pan = clamp(pan, -1, 1, sample.pan);
    if (program !== undefined) sample.program = program == null ? null : Math.round(clamp(program, 0, 127, sample.program ?? 0));
    const nextChannel = channel === undefined ? sample.channel : channel == null ? null : Math.round(clamp(channel, 0, 15, sample.channel ?? 0));
    let routing;
    if (nextChannel !== sample.channel) {
      const sourceBuffer = this._sampleBuffers.get(sample);
      const analysis = nextChannel == null ? parseMidi(sourceBuffer) : transformMidiStamp(sourceBuffer, { channel: nextChannel }).analysis;
      const compiled = compileDeck(analysis);
      let pendingReplacement = sample.pendingReplacement;
      if (pendingReplacement) {
        const next = nextChannel == null ? parseMidi(pendingReplacement.sourceBuffer) : transformMidiStamp(pendingReplacement.sourceBuffer, { channel: nextChannel }).analysis;
        pendingReplacement = { ...pendingReplacement, analysis: next, compiled: compileDeck(next) };
      }
      sample.channel = nextChannel; sample.analysis = analysis; sample.compiled = compiled; sample.pendingReplacement = pendingReplacement;
      routing = { data: compiled, pendingReplacement: pendingReplacement ? { data: pendingReplacement.compiled, name: pendingReplacement.name, token: pendingReplacement.token, delayBeats: pendingReplacement.delayBeats } : null };
    }
    sample.scoreRevision = ++sample.revision;
    if (sample.sent) this._post({ type: 'sampleParameters', slot: sample.slot, id: sample.id, midi: sample.midi,
      gain: sample.gain, loop: sample.loop, sync: sample.sync, revision: sample.revision, ...(sample.scoreVersion ? { scoreVersion: sample.scoreVersion } : {}),
      ...(muted !== undefined ? { muted: sample.muted } : {}), ...(solo !== undefined ? { solo: sample.solo } : {}), ...(pan !== undefined ? { pan: sample.pan } : {}), ...(program !== undefined || routing ? { program: sample.program } : {}), ...(routing ? { routing } : {}) });
    this._publish(); return this.state.samples.find(item => item.id === id) ?? false;
  }
  stopSample(id) {
    if (this._disposed) return false;
    const index = this._samples.findIndex(sample => sample.id === id); if (index < 0) return false;
    void this.state;
    const [sample] = this._samples.splice(index, 1);
    if (sample.sent) this._post({ type: 'stopSample', slot: sample.slot, id: sample.id });
    this._publish(); return true;
  }
  setSamplePaused(id, paused) {
    if (this._disposed) return false;
    const sample = this._samples.find(item => item.id === id); if (!sample) return false;
    const state = this.state, timing = this._sampleTiming(sample, state.sampleBeat, state.sampleTime);
    if (timing.ended) return false;
    paused = Boolean(paused);
    if (sample.paused === paused) return state.samples.find(item => item.id === id) ?? false;
    sample.timing = timing; sample.timingBeat = state.sampleBeat; sample.timingTime = state.sampleTime;
    sample.paused = paused; sample.revision++;
    if (paused) { sample.pausedAt = state.sampleTime; sample.pausedEpoch = sample.playbackEpoch; }
    if (!paused) { sample.playbackEpoch++; sample.resumedPositionBeats = timing.positionBeats; sample.resumedCycle = timing.cycle; }
    if (sample.sent) this._post({ type: 'samplePaused', slot: sample.slot, id: sample.id, paused, revision: sample.revision, ...(sample.scoreVersion ? { scoreVersion: sample.scoreVersion } : {}) });
    this._publish(); return this.state.samples.find(item => item.id === id) ?? false;
  }
  sendChannelController(index, channel, controller, value = 0) {
    this._checkIndex(index); return this._sendMidiAction({ index, channel }, { kind: 'cc', controller, value });
  }
  sendChannelParameter(index, channel, parameter) {
    this._checkIndex(index); return this._sendMidiAction({ index, channel }, { ...parameter, kind: 'parameter' });
  }
  sendSampleController(controller, value = 0) { return this._sendMidiAction({ samples: true }, { kind: 'cc', controller, value }); }
  sendSampleParameter(parameter) { return this._sendMidiAction({ samples: true }, { ...parameter, kind: 'parameter' }); }
  _sendMidiAction(target, action) {
    if (this._disposed || !this._audioEnabled) return false;
    if (target.samples ? !this.state.samples.length : !this._decks[target.index]?.analysis || target.channel != null && !this._decks[target.index].analysis.channels.some(item => item.channel === Number(target.channel))) return false;
    if (target.channel != null && (!Number.isInteger(Number(target.channel)) || Number(target.channel) < 0 || Number(target.channel) > 4095)) return false;
    const normalized = action.kind === 'cc'
      ? { kind: 'cc', controller: Math.round(clamp(action.controller, 0, 127)), value: Math.round(clamp(action.value, 0, 127)) }
      : { kind: 'parameter', registered: action.registered !== false, parameter: Math.round(clamp(action.parameter, 0, 16383)), value: Math.round(clamp(action.value, 0, 16383)) };
    this._post({ type: 'midiAction', ...target, action: normalized }); return true;
  }
  stopSamples() { if (this._samples.length) void this.state; this._samples = []; this._post({ type: 'stopSamples' }); this._publish(); }
  _sendSamples() {
    if (!this._audioEnabled) return;
    const state = this.state;
    this._samples = this._samples.filter(sample => !this._sampleTiming(sample, state.sampleBeat, state.sampleTime).ended);
    for (const sample of this._samples) if (!sample.sent) {
      this._post({ type: 'sample', id: sample.id, slot: sample.slot, name: sample.name, data: sample.compiled, startBeat: sample.startBeat, timing: this._sampleTiming(sample, state.sampleBeat, state.sampleTime), loop: sample.loop, sync: sample.sync, paused: sample.paused, pausedAt: sample.pausedAt, pausedEpoch: sample.pausedEpoch, revision: sample.revision, scoreVersion: sample.scoreVersion, replacedAt: sample.replacedAt, replacedEpoch: sample.replacedEpoch, pendingReplacement: sample.pendingReplacement ? { data: sample.pendingReplacement.compiled, name: sample.pendingReplacement.name, token: sample.pendingReplacement.token, delayBeats: sample.pendingReplacement.delayBeats } : null, playbackEpoch: sample.playbackEpoch, resumedPositionBeats: sample.resumedPositionBeats, resumedCycle: sample.resumedCycle, quantize: sample.quantize, delayBeats: sample.delayBeats, muted: sample.muted, solo: sample.solo, pan: sample.pan, gain: sample.gain, program: sample.program, midi: sample.midi }); sample.sent = true;
    }
  }
  async loadDeck(index, buffer, name = 'MIDI file', { reverse } = {}) {
    this._checkIndex(index); if (this._disposed) return false;
    let analysis;
    try { analysis = parseMidi(buffer); } catch (error) { this._error = error.message; this._publish(); throw error; }
    const previous = this._decks[index];
    const config = sanitizeDeckConfig({ ...(reverse === undefined ? {} : { reverse }), ...(previous.analysis ? { loopStartBeats: null, loopEndBeats: null } : {}) }, previous.config);
    const bytes = buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const sourceAnalysis = analysis, source = { buffer: bytes, analysis, cache: new Map() };
    if (config.reverse !== 'off') analysis = this._effectiveSource(index, config.reverse, source).analysis;
    const compiled = compileDeck(analysis);
    const deck = { name: String(name).slice(0, 256), analysis, sourceAnalysis, config, channels: analysis.channels.map(channel => ({ channel: channel.channel, mute: false, solo: false, program: null, midi: {}, ...previous.channels.find(setting => setting.channel === channel.channel) })), token: ++this._serial, loaded: false };
    this._sources[index] = source; this._decks[index] = deck; this._compiled[index] = compiled; this._error = null;
    this._sendDeck(index); this._publish(); return this.state.decks[index];
  }
  _effectiveSource(index, mode, source = this._sources[index]) { if (!source) return null;
    if (mode === 'off') return source;
    if (!source.cache.has(mode)) {
      const reversed = reverseMidiAnalysis(source.buffer, { mode });
      reversed.analysis.warnings = [...new Set([...(reversed.analysis.warnings ?? []), ...reversed.warnings])];
      source.cache.set(mode, reversed);
    }
    return source.cache.get(mode);
  }
  getDeckMidi(index) { this._checkIndex(index); return this._effectiveSource(index, this._decks[index].config.reverse)?.buffer.slice(0) ?? null; }
  configureWeave(partial = {}) {
    const state = this.state, progress = weavePosition(state.beat, this._weave, this._weavePhase);
    this._weavePhase = { startBeat: state.beat, deckBeats: [...progress.deckBeats] };
    this._weave = sanitizeWeaveConfig(partial, this._weave);
    this._post({ type: 'weave', config: this._weave, phase: this._weavePhase }); this._publish(); return { ...this._weave };
  }
  async enableAudio() {
    if (this._disposed) return false;
    this._desiredAudio = true; this._error = null; const wasReady = this._ready;
    try {
      if (this.context?.state === 'closed') await this._close();
      if (!this.context) {
        const AudioContext = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
        if (!AudioContext) throw new Error('Web Audio is unavailable in this browser.');
        this.context = new AudioContext({ latencyHint: 'interactive' });
        const context = this.context;
        const onState = () => {
          if (this.context !== context || this._disposed) return;
          this._audioEnabled = this._desiredAudio && this._ready && context.state === 'running';
          if (context.state === 'closed') { this._error = 'Audio stopped. Turn Audio on to restart it.'; this._freezeClock(); this._ready = false; }
          this._updateGain(); this._publish();
        };
        context.addEventListener('statechange', onState); this._listeners.push(() => context.removeEventListener('statechange', onState));
      }
      const context = this.context;
      // Resume stays directly in the explicit Audio gesture, before imports/fetches.
      const resumed = context.resume();
      if (!this._ready && !this._promise) this._promise = this._initialize(context).finally(() => { if (this.context === context) this._promise = null; });
      this._publish(); await Promise.all([resumed, this._promise]);
      if (this._disposed || this.context !== context) return false;
      this._audioEnabled = this._desiredAudio && this._ready && context.state === 'running';
      this._post({ type: 'audibility', enabled: this._audioEnabled, volume: this._volume });
      if (wasReady && this._audioEnabled) this._post({ type: 'rejoin' });
      this._sendSamples();
      this._updateGain(); this._publish(); return this._audioEnabled;
    } catch (error) {
      if (!this._disposed) { this._error = error.message || 'Could not start MIDI audio.'; this._desiredAudio = false; await this._close(); this._publish(); }
      return false;
    }
  }
  setAudioEnabled(enabled) {
    const wasEnabled = this._audioEnabled;
    this._desiredAudio = Boolean(enabled);
    this._audioEnabled = this._desiredAudio && this._ready && this.context?.state === 'running';
    this._post({ type: 'audibility', enabled: this._audioEnabled, volume: this._volume });
    if (!this._audioEnabled) { this.stopSamples(); this._post({ type: 'release' }); }
    else if (!wasEnabled) this._post({ type: 'rejoin' });
    this._sendSamples();
    this._updateGain(); this._publish(); return this._audioEnabled;
  }
  play() {
    if (this._disposed || !this._decks.some(deck => deck.analysis)) return false;
    if (this._playing) return true;
    this._anchor = this._now(); this._audioAnchor = this._ready ? this.context.currentTime : null; this._audioTempo = this._tempo;
    this._playing = true; this._post({ type: 'transport', playing: true, beat: this._beat }); this._publish(); return true;
  }
  pause() {
    this._freezeClock(); this._playing = false; this.stopSamples(); this._post({ type: 'transport', playing: false, beat: this._beat }); this._publish();
  }
  stop() { this._weavePhase = { startBeat: 0, deckBeats: [0, 0] }; this._beat = 0; this._playing = false; this._anchor = this._now(); this._audioAnchor = this.context?.currentTime ?? null; this.stopSamples(); this._post({ type: 'transport', playing: false, beat: 0 }); this._post({ type: 'weave', config: this._weave, phase: this._weavePhase }); this._publish(); }
  setTempo(value) {
    this._freezeClock(); this._tempo = clamp(value, 30, this._maxTempo, this._tempo); this._audioTempo = this._tempo;
    this._post({ type: 'tempo', tempo: this._tempo }); this._updateEffects(); this._publish(); return this._tempo;
  }
  configureDeck(index, partial) {
    this._checkIndex(index); const deck = this._decks[index], next = sanitizeDeckConfig(partial, deck.config);
    const changed = next.reverse !== deck.config.reverse && deck.sourceAnalysis;
    const effective = changed ? this._effectiveSource(index, next.reverse) : null;
    const compiled = changed ? compileDeck(effective.analysis) : null;
    const state = this.state, progress = weavePosition(state.beat, this._weave, this._weavePhase).deckBeats[index];
    if (next.rate !== deck.config.rate && !Object.hasOwn(partial, 'offsetBeats')) next.offsetBeats = deck.config.offsetBeats + progress * ((deck.config.rate ?? 1) - next.rate);
    if (changed) {
      if ((next.reverse === 'off') !== (deck.config.reverse === 'off')) {
        const span = deck.sourceAnalysis.durationBeats, position = state.decks[index].positionBeats;
        if (!Object.hasOwn(partial, 'loopStartBeats') && !Object.hasOwn(partial, 'loopEndBeats') && ((deck.config.loopStartBeats ?? 0) !== 0 || deck.config.loopEndBeats !== null)) {
          const bounds = loopBounds(deck.analysis, deck.config);
          next.loopStartBeats = Math.max(0, span - Math.min(span, bounds.end));
          next.loopEndBeats = Math.max(next.loopStartBeats + 1 / 32, span - Math.min(span, bounds.start));
        }
        const target = !this._playing && Math.abs(position) < 1e-9 ? 0 : Math.max(0, span - position);
        if (!Object.hasOwn(partial, 'offsetBeats')) next.offsetBeats = target - loopBounds(effective.analysis, next).start - progress * next.rate;
      }
      deck.analysis = effective.analysis; this._compiled[index] = compiled; deck.token = ++this._serial;
    }
    deck.config = next;
    if (changed) this._sendDeck(index); else this._post({ type: 'deck', index, config: deck.config, channels: deck.channels });
    this._publish(); return { ...deck.config, midi: sanitizeMidiParameters(deck.config.midi) };
  }
  seekDeck(index, sourceBeat) {
    this._checkIndex(index); const deck = this._decks[index], bounds = loopBounds(deck.analysis, deck.config);
    const target = clamp(sourceBeat, bounds.start, bounds.end, bounds.start) - bounds.start;
    let offset = target - weavePosition(this.state.beat, this._weave, this._weavePhase).deckBeats[index] * (deck.config.rate ?? 1);
    if (deck.config.loop) offset = ((offset + bounds.length / 2) % bounds.length + bounds.length) % bounds.length - bounds.length / 2;
    return this.configureDeck(index, { offsetBeats: offset });
  }
  configureEffects(partial = {}) {
    const ranges = { filterHz: [60, 20000], delayMix: [0, 0.75], delayBeats: [0.125, 4], feedback: [0, 0.8] };
    for (const [name, [low, high]] of Object.entries(ranges)) if (name in partial) this._effects[name] = clamp(partial[name], low, high, this._effects[name]);
    if ('synth' in partial) this._effects.synth = sanitizeMidiSynthEffects(partial.synth, this._effects.synth);
    this._post({ type: 'effects', synth: this._effects.synth });
    this._updateEffects(); this._publish(); return { ...this._effects, synth: sanitizeMidiSynthEffects(this._effects.synth) };
  }
  async loadSoundFont(buffer, name = 'Imported SoundFont') {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12 || buffer.byteLength > MAX_SOUNDFONT_BYTES) throw new Error('Choose a SoundFont (.sf2 or .sf3) of 128 MiB or smaller.');
    const view = new DataView(buffer);
    if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x7366626b) throw new Error('This is not an SF2 or SF3 SoundFont.');
    const selection = ++this._fontSelection;
    // Validate the full preset/instrument/sample graph before accepting a bank,
    // including while Audio is off. Loading the parser creates no audio context.
    const { SoundBankLoader } = await import('./vendor/spessasynth-core.js');
    if (this._disposed || selection !== this._fontSelection) throw new DOMException('SoundFont selection was superseded.', 'AbortError');
    const parsed = SoundBankLoader.fromArrayBuffer(buffer);
    if (!parsed.presets.length) throw new Error('The SoundFont contains no instrument presets.');
    const font = { buffer: buffer.slice(0), name: String(name).slice(0, 128) };
    if (!this._ready) { this._font = font; this._fontName = font.name; this._publish(); return true; }
    return this._uploadSoundFont(font, true);
  }
  _uploadSoundFont(font, commitSelection = false) {
    const token = ++this._serial;
    return new Promise((resolve, reject) => {
      const timer = this.runtime.setTimeout(() => { this._fontWaits.delete(token); reject(new Error('The SoundFont took too long to load.')); }, 90000);
      this._fontWaits.set(token, { resolve, reject, font, timer, commitSelection });
      const copy = font.buffer.slice(0); this.node.port.postMessage({ type: 'soundfont', soundfont: copy, token }, [copy]);
    });
  }
  configureChannel(index, channel, partial) {
    this._checkIndex(index); const deck = this._decks[index];
    if (!Number.isInteger(Number(channel)) || Number(channel) < 0 || Number(channel) > 4095) return false;
    let setting = deck.channels.find(item => item.channel === Number(channel));
    if (!setting) { setting = { channel: Number(channel), mute: false, solo: false, program: null, midi: {} }; deck.channels.push(setting); }
    if ('midi' in partial) setting.midi = sanitizeMidiParameters(partial.midi, setting.midi);
    if ('mute' in partial) setting.mute = Boolean(partial.mute);
    if ('solo' in partial) setting.solo = Boolean(partial.solo);
    if ('program' in partial) setting.program = partial.program === null || Number(partial.program) < 0 ? null : Math.round(clamp(partial.program, 0, 127));
    this._post({ type: 'deck', index, config: deck.config, channels: deck.channels }); this._publish(); return { ...setting, midi: sanitizeMidiParameters(setting.midi) };
  }
  setNoteEffects(input) { this._noteEffects = sanitizeMidiNoteEffects(input); this._post({ type: 'noteEffects', config: this._noteEffects }); this._publish(); return { ...this._noteEffects }; }
  setCrossfade(value) { this._crossfade = clamp(value, -1, 1, this._crossfade); this._post({ type: 'crossfade', value: this._crossfade }); this._publish(); return this._crossfade; }
  setVolume(value) { this._volume = clamp(value, 0, 1, this._volume); this._post({ type: 'audibility', enabled: this._audioEnabled, volume: this._volume }); this._updateGain(); this._publish(); return this._volume; }
  /** Mix another source through this instrument's filter, effects, master gain
   * and final peak ceiling. The caller keeps transport/context ownership. */
  connectExternalSource(context, source, { gain = 1 } = {}) {
    if (this._disposed || !this._ready || context !== this.context || context?.state === 'closed' || !this._filter) throw new Error('The shared MIDI audio engine is not ready.');
    if (!source || typeof source.connect !== 'function' || typeof source.disconnect !== 'function' || source.context && source.context !== context) throw new Error('The external source must use the shared audio context.');
    if (this._externalSources.has(source)) throw new Error('This source is already connected.');
    if (this._externalSources.size >= 4) throw new Error('Up to four external MIDI sources can be mixed.');
    const input = context.createGain(); input.gain.value = clamp(gain, 0, 1, 1);
    try { source.connect(input); input.connect(this._filter); }
    catch (error) { try { source.disconnect(input); } catch {} input.disconnect(); throw error; }
    let released = false;
    const release = () => {
      if (released) return; released = true; this._externalSources.delete(source);
      try { source.disconnect(input); } catch { /* Caller may already have released its source. */ }
      input.disconnect();
    };
    this._externalSources.set(source, release); return release;
  }
  _checkIndex(index) { if (index !== 0 && index !== 1) throw new Error('Choose MIDI deck A or B.'); }
  _freezeClock() { const state = this.state; this._beat = state.beat; this._sampleBeat = state.sampleBeat; this._sampleTime = state.sampleTime; this._anchor = this._sampleAnchor = this._now(); this._audioAnchor = this._sampleAudioAnchor = this._ready ? this.context?.currentTime ?? null : null; }
  _post(message) { if (this._ready && !this._disposed) this.node?.port.postMessage(message); }
  _sendDeck(index) {
    const deck = this._decks[index]; if (!deck.analysis) return;
    this._post({ type: 'load', index, data: this._compiled[index], config: deck.config, channels: deck.channels, token: deck.token });
  }
  async _initialize(context) {
    this._abort = new AbortController();
    const requestedFont = this._font;
    const response = requestedFont ? Promise.resolve(requestedFont.buffer.slice(0)) : this.runtime.fetch(SOUNDFONT_URL.href, { signal: this._abort.signal }).then(async response => { if (!response.ok) throw new Error(`Could not load the SoundFont (${response.status}).`); return response.arrayBuffer(); });
    const resources = Promise.all([context.audioWorklet.addModule(WORKLET_URL.href), response]);
    const [, soundfont] = await this._wait(resources, 'The MIDI audio resources took too long to load.');
    if (this._disposed || this.context !== context) throw new Error('MIDI mixer initialization cancelled.');
    const node = new this.runtime.AudioWorkletNode(context, 'morphazoid-midi-mixer', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }); this.node = node;
    this._preamp = context.createGain(); this._preamp.gain.value = 8;
    this._compressor = context.createDynamicsCompressor();
    this._compressor.threshold.value = -6; this._compressor.knee.value = 0; this._compressor.ratio.value = 20; this._compressor.attack.value = 0; this._compressor.release.value = 0.1;
    this._gain = context.createGain(); this._gain.gain.value = 0;
    this._ceiling = context.createWaveShaper(); this._ceiling.curve = new Float32Array([-0.98, 0.98]); this._ceiling.oversample = 'none';
    this._filter = context.createBiquadFilter(); this._filter.type = 'lowpass'; this._filter.Q.value = 0.707;
    this._delay = context.createDelay(8); this._dry = context.createGain(); this._wet = context.createGain(); this._feedback = context.createGain();
    node.connect(this._filter); this._filter.connect(this._preamp); this._preamp.connect(this._compressor);
    this._compressor.connect(this._dry); this._dry.connect(this._gain);
    this._compressor.connect(this._delay); this._delay.connect(this._wet); this._wet.connect(this._gain);
    this._delay.connect(this._feedback); this._feedback.connect(this._delay); this._gain.connect(this._ceiling); this._updateEffects();
    this._releaseOutput = this._connectOutput(context, this._ceiling, { runtime: this.runtime });
    let resolveReady, rejectReady;
    const initialized = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const onError = () => { const error = new Error('The MIDI audio processor stopped. Turn Audio on to restart it.'); rejectReady(error); this._processorFailed(error); };
    node.addEventListener('processorerror', onError); this._listeners.push(() => node.removeEventListener('processorerror', onError));
    node.port.onmessage = ({ data }) => {
      if (this._disposed || this.context !== context) return;
      if (data.type === 'ready') resolveReady();
      else if (data.type === 'soundfont') {
        const request = this._fontWaits.get(data.token); if (!request) return;
        this.runtime.clearTimeout(request.timer); this._fontWaits.delete(data.token);
        if (data.error) request.reject(new Error(data.error));
        else {
          // Initialization uploads must not overwrite a newer pending choice.
          if (request.commitSelection) { this._font = request.font; this._fontName = request.font.name; }
          request.resolve(true); this._publish();
        }
      }
      else if (data.type === 'error') { const error = new Error(data.message); rejectReady(error); this._processorFailed(error); }
      else if (data.type === 'automataCapture') {
        const request = this._automataWaits.get(data.token); if (!request) return;
        this._automataWaits.delete(data.token); this.runtime.clearTimeout(request.timer); request.resolve(data.state);
      }
      else if (data.type === 'state') {
        // Until startup transfers the silent transport phase, processor beat 0
        // describes an unstarted clock, including intermediate bank uploads.
        if (!this._ready) return;
        if (data.automata && data.automataRevision === this._automataRevision) {
          const notes = new Map([...this._automata.notes, ...(data.automataNotes ?? [])].map(note => [note.id, note]));
          this._automata.restore({ ...data.automata, notes: [...notes.values()].filter(note => note.endBeat === null || note.endBeat > data.automata.beat - 16) });
        }
        // The audio thread is authoritative; rendering only interpolates telemetry.
        this._beat = data.beat; this._audioAnchor = data.at; this._audioTempo = data.tempo;
        if (Number.isFinite(data.sampleBeat)) { this._sampleBeat = data.sampleBeat; this._sampleAudioAnchor = data.at; }
        if (Number.isFinite(data.sampleTime)) this._sampleTime = data.sampleTime;
        this._receiveSampleTimings(data.samples ?? [], data.sampleBeat, data.sampleTime);
        this._skippedEvents = data.skippedEvents; this._voices = data.voices; this._droppedVisualEvents = data.droppedVisualEvents; this._publish();
      } else if (data.type === 'notes') this._publishNotes(this._audioEnabled ? data.notes : data.notes.filter(note => note.type === 'noteOff'));
      else if (data.type === 'loaded' && this._decks[data.index]?.token === data.token) { this._decks[data.index].loaded = true; this._publish(); }
    };
    // A selection may have changed while the worklet or default bank fetched.
    // Descriptor identity is its revision; keep the graph muted until the latest
    // requested revision is acknowledged by the processor.
    let activeFont = this._font;
    const initialBank = activeFont !== requestedFont ? activeFont.buffer.slice(0) : soundfont;
    node.port.postMessage({ type: 'initialize', soundfont: initialBank }, [initialBank]);
    await this._wait(initialized, 'The MIDI sound engine did not become ready.');
    while (!this._disposed && this.context === context && this._font !== activeFont) {
      const pendingFont = this._font;
      try { await this._uploadSoundFont(pendingFont); activeFont = pendingFont; }
      catch (error) {
        if (this._disposed || this.context !== context) throw error;
        // A bad replacement must leave the already validated bank usable.
        if (this._font === pendingFont) {
          this._font = activeFont; this._fontName = activeFont?.name ?? 'TimGM6mb'; this._error = error.message;
        }
      }
    }
    if (this._disposed || this.context !== context) throw new Error('MIDI mixer initialization cancelled.');
    this._freezeClock(); this._ready = true; this._audioAnchor = this._sampleAudioAnchor = context.currentTime; this._audioTempo = this._tempo;
    this._post({ type: 'sampleClock', beat: this._sampleBeat, seconds: this._sampleTime });
    this._post({ type: 'weave', config: this._weave, phase: this._weavePhase });
    this._post({ type: 'tempo', tempo: this._tempo }); this._post({ type: 'crossfade', value: this._crossfade });
    this._post({ type: 'effects', synth: this._effects.synth });
    this._post({ type: 'noteEffects', config: this._noteEffects });
    this._post({ type: 'audibility', enabled: this._desiredAudio, volume: this._volume });
    this._post({ type: 'automataRestore', state: this._automata.snapshot(true), revision: this._automataRevision });
    for (let index = 0; index < 2; index++) this._sendDeck(index);
    this._post({ type: 'transport', playing: this._playing, beat: this._beat });
  }
  _wait(promise, message, timeoutMs = 90000) {
    return new Promise((resolve, reject) => {
      const timeout = this.runtime.setTimeout(() => reject(new Error(message)), timeoutMs);
      const cancel = () => reject(new Error('MIDI mixer initialization cancelled.')); this._waitCancel = cancel;
      Promise.resolve(promise).then(resolve, reject).finally(() => { this.runtime.clearTimeout(timeout); if (this._waitCancel === cancel) this._waitCancel = null; });
    });
  }
  _processorFailed(error) {
    if (this._disposed || !this._ready) return;
    this._error = error.message; this._desiredAudio = false; void this._close().then(() => this._publish());
  }
  _updateGain() {
    if (!this._gain || !this.context) return;
    const gain = this._gain.gain, now = this.context.currentTime;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now); else { gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now); }
    gain.linearRampToValueAtTime(this._audioEnabled ? this._volume : 0, now + 0.02);
  }
  _updateEffects() {
    if (!this.context || !this._filter) return;
    const now = this.context.currentTime, ramp = (parameter, value) => {
      parameter.cancelScheduledValues(now); parameter.setTargetAtTime(value, now, 0.02);
    };
    ramp(this._filter.frequency, Math.min(this._effects.filterHz, this.context.sampleRate * 0.45));
    ramp(this._delay.delayTime, this._effects.delayBeats * 60 / this._tempo);
    ramp(this._dry.gain, Math.cos(this._effects.delayMix * Math.PI / 2));
    ramp(this._wet.gain, Math.sin(this._effects.delayMix * Math.PI / 2));
    ramp(this._feedback.gain, this._effects.feedback);
  }
  async _close() {
    this._freezeClock(); this.stopSamples(); this._ready = false; this._audioEnabled = false; this._audioAnchor = this._sampleAudioAnchor = null;
    const context = this.context; this.context = null; this._promise = null;
    this._abort?.abort(); this._abort = null; this._waitCancel?.(); this._waitCancel = null;
    for (const request of this._fontWaits.values()) { this.runtime.clearTimeout(request.timer); request.reject(new Error('SoundFont load cancelled.')); } this._fontWaits.clear();
    for (const request of this._automataWaits.values()) { this.runtime.clearTimeout(request.timer); request.reject(new Error('Automatapoeia capture cancelled.')); } this._automataWaits.clear();
    for (const remove of this._listeners.splice(0)) remove();
    for (const release of [...this._externalSources.values()]) release();
    if (this.node) { this.node.port.onmessage = null; this.node.port.postMessage({ type: 'dispose' }); this.node.disconnect(); this.node.port.close?.(); this.node = null; }
    this._releaseOutput?.(); this._releaseOutput = null;
    for (const key of ['_preamp', '_compressor', '_gain', '_ceiling', '_filter', '_delay', '_dry', '_wet', '_feedback']) { this[key]?.disconnect(); this[key] = null; }
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
  async dispose() { if (this._disposed) return; this._automata.setPlaying(false); this._disposed = true; this._playing = false; this._desiredAudio = false; this.runtime.removeEventListener?.('pagehide', this._onPageHide); await this._close(); this._decks = [emptyDeck(), emptyDeck()]; this._compiled = [null, null]; this._finishedSamples = []; this._noteSubscribers.clear(); }
  _publish() { if (!this._disposed) safeCall(this.onState, this.state); }
}
export const createMixerEngine = options => new MidiMixerEngine(options);
