import { connectAudioOutput } from '../../audio-output-manager.js';
import { parseMidi, clamp, defaultDeckConfig, sanitizeDeckConfig, loopLength, loopBounds, deckPosition } from './midi-mixer-model.js';

const WORKLET_URL = new URL('./midi-mixer-processor.js', import.meta.url);
const SOUNDFONT_URL = new URL('../../../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url);
const safeCall = (callback, value) => { try { callback?.(value); } catch { /* Display callbacks cannot break audio. */ } };
const emptyDeck = () => ({ name: '', analysis: null, config: defaultDeckConfig(), channels: [], token: 0, loaded: false });
export const MIDI_SAMPLE_LIMITS = Object.freeze({ clips: 4, fileBytes: 2 * 1024 * 1024, notes: 32768, events: 131072, channels: 16, beats: 512 });
/** Compact channel histories support seeks without replaying past attacks. */
export function compileDeck(analysis) {
  const histories = new Map();
  for (const event of analysis.events) {
    if (event.kind === 8 || event.kind === 9 || event.kind === 10) continue;
    const key = `${event.channel}:${event.kind}:${event.kind === 11 ? event.a : 0}`;
    if (!histories.has(key)) histories.set(key, []);
    histories.get(key).push(event);
  }
  const count = analysis.notes.length, held = { start: new Float64Array(count), end: new Float64Array(count), maxEnd: new Float64Array(count), info: new Uint32Array(count), ids: new Uint32Array(count) };
  for (let index = 0; index < count; index++) {
    const note = analysis.notes[index]; held.start[index] = note.beat; held.end[index] = note.beat + note.duration;
    held.info[index] = (note.channel << 14) | (note.note << 7) | note.velocity;
    held.ids[index] = note.id ?? index;
  }
  const augment = (low, high) => {
    if (low >= high) return -Infinity;
    const middle = (low + high) >>> 1;
    return held.maxEnd[middle] = Math.max(held.end[middle], augment(low, middle), augment(middle + 1, high));
  };
  augment(0, count);
  return { events: analysis.events, channels: analysis.channels, controllers: [...histories.values()], held, loopBeats: loopLength(analysis), durationBeats: analysis.durationBeats };
}

export class MidiMixerEngine {
  constructor({ onState, onNotes, runtime = globalThis, connectOutput = connectAudioOutput } = {}) {
    this.runtime = runtime; this.onState = onState; this.onNotes = onNotes; this._connectOutput = connectOutput;
    this.context = null; this.node = null; this._gain = null; this._preamp = null; this._compressor = null; this._ceiling = null;
    this._filter = null; this._delay = null; this._dry = null; this._wet = null; this._feedback = null;
    this._effects = { filterHz: 20000, delayMix: 0, delayBeats: 0.5, feedback: 0.3 };
    this._font = null; this._fontName = 'TimGM6mb'; this._fontWaits = new Map();
    this._releaseOutput = null; this._promise = null; this._ready = false; this._disposed = false; this._serial = 0;
    this._playing = false; this._desiredAudio = false; this._audioEnabled = false; this._volume = 0.6; this._tempo = 120; this._crossfade = 0;
    this._beat = 0; this._anchor = this._now(); this._audioAnchor = null; this._audioTempo = 120;
    this._sampleBeat = 0; this._sampleAnchor = this._anchor; this._sampleAudioAnchor = null; this._samples = []; this._noteSubscribers = new Set();
    this._decks = [emptyDeck(), emptyDeck()]; this._compiled = [null, null]; this._error = null; this._abort = null;
    this._skippedEvents = 0; this._voices = 0; this._droppedVisualEvents = 0; this._listeners = []; this._waitCancel = null;
    this._onPageHide = () => { void this.dispose(); }; this.runtime.addEventListener?.('pagehide', this._onPageHide);
  }
  _now() { return (this.runtime.performance?.now?.() ?? Date.now()) / 1000; }
  get state() {
    let beat = this._beat;
    const sampleBeat = this._sampleBeat + (this._ready && this._sampleAudioAnchor !== null && this.context
      ? Math.max(0, this.context.currentTime - this._sampleAudioAnchor) * this._audioTempo / 60
      : Math.max(0, this._now() - this._sampleAnchor) * this._tempo / 60);
    if (this._playing) {
      if (this._ready && this._audioAnchor !== null && this.context) beat += Math.max(0, this.context.currentTime - this._audioAnchor) * this._audioTempo / 60;
      else beat += Math.max(0, this._now() - this._anchor) * this._tempo / 60;
    }
    return { ready: this._ready, loading: Boolean(this._promise), audioEnabled: this._audioEnabled && this.context?.state === 'running', playing: this._playing,
      tempo: this._tempo, beat, sampleBeat, samples: this._samples.filter(sample => sampleBeat < sample.startBeat + sample.analysis.durationBeats).map(({ compiled, sent, ...sample }) => ({ ...sample, positionBeats: Math.max(0, sampleBeat - sample.startBeat) })), effects: { ...this._effects }, soundfontName: this._fontName, volume: this._volume, crossfade: this._crossfade, error: this._error,
      skippedEvents: this._skippedEvents, voices: this._voices, droppedVisualEvents: this._droppedVisualEvents,
      decks: this._decks.map(deck => ({ ...deck, config: { ...deck.config }, channels: deck.channels.map(channel => ({ ...channel })), positionBeats: deckPosition(beat, deck.analysis, deck.config), loopBeats: loopBounds(deck.analysis, deck.config).length, loopStartBeats: loopBounds(deck.analysis, deck.config).start, loopEndBeats: loopBounds(deck.analysis, deck.config).end })) };
  }
  subscribeNotes(callback) { if (typeof callback !== 'function') return () => {}; this._noteSubscribers.add(callback); return () => this._noteSubscribers.delete(callback); }
  _publishNotes(notes) { if (!notes.length) return; safeCall(this.onNotes, notes); for (const callback of this._noteSubscribers) safeCall(callback, notes); }
  triggerSample(buffer, { name = 'MIDI sample', program = null, gain = 0.8 } = {}) {
    if (this._disposed) return false;
    if ((buffer?.byteLength ?? 0) > MIDI_SAMPLE_LIMITS.fileBytes) throw new Error('One-shot MIDI samples must be 2 MB or smaller.');
    const analysis = parseMidi(buffer);
    if (analysis.notes.length > MIDI_SAMPLE_LIMITS.notes || analysis.events.length > MIDI_SAMPLE_LIMITS.events || analysis.channels.length > MIDI_SAMPLE_LIMITS.channels || analysis.durationBeats > MIDI_SAMPLE_LIMITS.beats) throw new Error('Use a one-shot of at most 512 beats, 32,768 notes and 16 channels.');
    const startBeat = this.state.sampleBeat;
    this._samples = this._samples.filter(sample => startBeat < sample.startBeat + sample.analysis.durationBeats);
    const used = new Set(this._samples.map(sample => sample.slot));
    let slot = Array.from({ length: MIDI_SAMPLE_LIMITS.clips }, (_, index) => index).find(index => !used.has(index));
    if (slot === undefined) slot = this._samples.shift().slot;
    const sample = { id: ++this._serial, slot, name: String(name).slice(0, 128), analysis, compiled: compileDeck(analysis), startBeat, gain: clamp(gain, 0, 1, 0.8), program: program == null ? null : Math.round(clamp(program, 0, 127)), sent: false };
    this._samples.push(sample); this._sendSamples(); this._publish(); return this.state.samples.find(item => item.id === sample.id);
  }
  stopSamples() { this._samples = []; this._post({ type: 'stopSamples' }); this._publish(); }
  _sendSamples() {
    if (!this._audioEnabled) return;
    const beat = this.state.sampleBeat;
    this._samples = this._samples.filter(sample => beat < sample.startBeat + sample.analysis.durationBeats);
    for (const sample of this._samples) if (!sample.sent) {
      this._post({ type: 'sample', id: sample.id, slot: sample.slot, name: sample.name, data: sample.compiled, startBeat: sample.startBeat, gain: sample.gain, program: sample.program }); sample.sent = true;
    }
  }
  async loadDeck(index, buffer, name = 'MIDI file') {
    this._checkIndex(index); if (this._disposed) return false;
    let analysis;
    try { analysis = parseMidi(buffer); } catch (error) { this._error = error.message; this._publish(); throw error; }
    const previous = this._decks[index];
    const deck = { name: String(name).slice(0, 256), analysis, config: { ...previous.config, ...(previous.analysis ? { loopStartBeats: null, loopEndBeats: null } : {}) }, channels: analysis.channels.map(channel => ({ channel: channel.channel, mute: false, solo: false, program: null, ...previous.channels.find(setting => setting.channel === channel.channel) })), token: ++this._serial, loaded: false };
    this._decks[index] = deck; this._compiled[index] = compileDeck(analysis); this._error = null;
    this._sendDeck(index); this._publish(); return this.state.decks[index];
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
      if (wasReady && this._audioEnabled) this._post({ type: 'rejoin' });
      this._post({ type: 'audibility', enabled: this._audioEnabled, volume: this._volume }); this._sendSamples();
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
    if (!this._audioEnabled) { this.stopSamples(); this._post({ type: 'release' }); }
    else if (!wasEnabled) this._post({ type: 'rejoin' });
    this._post({ type: 'audibility', enabled: this._audioEnabled, volume: this._volume }); this._sendSamples();
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
  stop() { this._beat = 0; this._playing = false; this._anchor = this._now(); this._audioAnchor = this.context?.currentTime ?? null; this.stopSamples(); this._post({ type: 'transport', playing: false, beat: 0 }); this._publish(); }
  setTempo(value) {
    this._freezeClock(); this._tempo = clamp(value, 30, 300, this._tempo); this._audioTempo = this._tempo;
    this._post({ type: 'tempo', tempo: this._tempo }); this._updateEffects(); this._publish(); return this._tempo;
  }
  configureDeck(index, partial) {
    this._checkIndex(index); const deck = this._decks[index], next = sanitizeDeckConfig(partial, deck.config);
    if (next.rate !== deck.config.rate && !Object.hasOwn(partial, 'offsetBeats')) next.offsetBeats = deck.config.offsetBeats + this.state.beat * ((deck.config.rate ?? 1) - next.rate);
    deck.config = next;
    this._post({ type: 'deck', index, config: deck.config, channels: deck.channels }); this._publish(); return { ...deck.config };
  }
  seekDeck(index, sourceBeat) {
    this._checkIndex(index); const deck = this._decks[index], bounds = loopBounds(deck.analysis, deck.config);
    const target = clamp(sourceBeat, bounds.start, bounds.end, bounds.start) - bounds.start;
    let offset = target - this.state.beat * (deck.config.rate ?? 1);
    if (deck.config.loop) offset = ((offset + bounds.length / 2) % bounds.length + bounds.length) % bounds.length - bounds.length / 2;
    return this.configureDeck(index, { offsetBeats: offset });
  }
  configureEffects(partial = {}) {
    const ranges = { filterHz: [60, 20000], delayMix: [0, 0.75], delayBeats: [0.125, 4], feedback: [0, 0.8] };
    for (const [name, [low, high]] of Object.entries(ranges)) if (name in partial) this._effects[name] = clamp(partial[name], low, high, this._effects[name]);
    this._updateEffects(); this._publish(); return { ...this._effects };
  }
  async loadSoundFont(buffer, name = 'Imported SoundFont') {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12 || buffer.byteLength > 32 * 1024 * 1024) throw new Error('Choose a SoundFont (.sf2 or .sf3) of 32 MB or smaller.');
    const view = new DataView(buffer);
    if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x7366626b) throw new Error('This is not an SF2 or SF3 SoundFont.');
    const font = { buffer: buffer.slice(0), name: String(name).slice(0, 128) };
    if (!this._ready) { this._font = font; this._fontName = font.name; this._publish(); return true; }
    return this._uploadSoundFont(font, true);
  }
  _uploadSoundFont(font, commitSelection = false) {
    const token = ++this._serial;
    return new Promise((resolve, reject) => {
      const timer = this.runtime.setTimeout(() => { this._fontWaits.delete(token); reject(new Error('The SoundFont took too long to load.')); }, 30000);
      this._fontWaits.set(token, { resolve, reject, font, timer, commitSelection });
      const copy = font.buffer.slice(0); this.node.port.postMessage({ type: 'soundfont', soundfont: copy, token }, [copy]);
    });
  }
  configureChannel(index, channel, partial) {
    this._checkIndex(index); const deck = this._decks[index];
    if (!Number.isInteger(Number(channel)) || Number(channel) < 0 || Number(channel) > 4095) return false;
    let setting = deck.channels.find(item => item.channel === Number(channel));
    if (!setting) { setting = { channel: Number(channel), mute: false, solo: false, program: null }; deck.channels.push(setting); }
    if ('mute' in partial) setting.mute = Boolean(partial.mute);
    if ('solo' in partial) setting.solo = Boolean(partial.solo);
    if ('program' in partial) setting.program = partial.program === null || Number(partial.program) < 0 ? null : Math.round(clamp(partial.program, 0, 127));
    this._post({ type: 'deck', index, config: deck.config, channels: deck.channels }); this._publish(); return { ...setting };
  }
  setCrossfade(value) { this._crossfade = clamp(value, -1, 1, this._crossfade); this._post({ type: 'crossfade', value: this._crossfade }); this._publish(); return this._crossfade; }
  setVolume(value) { this._volume = clamp(value, 0, 1, this._volume); this._post({ type: 'audibility', enabled: this._audioEnabled, volume: this._volume }); this._updateGain(); this._publish(); return this._volume; }
  _checkIndex(index) { if (index !== 0 && index !== 1) throw new Error('Choose MIDI deck A or B.'); }
  _freezeClock() { const state = this.state; this._beat = state.beat; this._sampleBeat = state.sampleBeat; this._anchor = this._sampleAnchor = this._now(); this._audioAnchor = this._sampleAudioAnchor = this._ready ? this.context?.currentTime ?? null : null; }
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
      else if (data.type === 'state') {
        // Until startup transfers the silent transport phase, processor beat 0
        // describes an unstarted clock, including intermediate bank uploads.
        if (!this._ready) return;
        // The audio thread is authoritative; rendering only interpolates telemetry.
        this._beat = data.beat; this._audioAnchor = data.at; this._audioTempo = data.tempo;
        if (Number.isFinite(data.sampleBeat)) { this._sampleBeat = data.sampleBeat; this._sampleAudioAnchor = data.at; }
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
    this._post({ type: 'sampleClock', beat: this._sampleBeat });
    this._post({ type: 'tempo', tempo: this._tempo }); this._post({ type: 'crossfade', value: this._crossfade });
    for (let index = 0; index < 2; index++) this._sendDeck(index);
    this._post({ type: 'transport', playing: this._playing, beat: this._beat });
  }
  _wait(promise, message) {
    return new Promise((resolve, reject) => {
      const timeout = this.runtime.setTimeout(() => reject(new Error(message)), 30000);
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
    for (const remove of this._listeners.splice(0)) remove();
    if (this.node) { this.node.port.onmessage = null; this.node.port.postMessage({ type: 'dispose' }); this.node.disconnect(); this.node.port.close?.(); this.node = null; }
    this._releaseOutput?.(); this._releaseOutput = null;
    for (const key of ['_preamp', '_compressor', '_gain', '_ceiling', '_filter', '_delay', '_dry', '_wet', '_feedback']) { this[key]?.disconnect(); this[key] = null; }
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
  async dispose() { if (this._disposed) return; this._disposed = true; this._playing = false; this._desiredAudio = false; this.runtime.removeEventListener?.('pagehide', this._onPageHide); await this._close(); this._decks = [emptyDeck(), emptyDeck()]; this._compiled = [null, null]; this._noteSubscribers.clear(); }
  _publish() { if (!this._disposed) safeCall(this.onState, this.state); }
}
export const createMixerEngine = options => new MidiMixerEngine(options);
