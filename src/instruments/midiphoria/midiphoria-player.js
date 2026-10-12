import { connectAudioOutput } from '../../audio-output-manager.js';
import { sanitizeMidiNoteEffects } from '../../midi-note-effects.js';
import { inspectSoundFont, MAX_SOUNDFONT_BYTES } from '../../sound-fonts/bank-format.js';

const SOURCE = 'midiphoria:file';
const PAD_SOURCE = 'midiphoria:pads';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PLAYBACK_GAIN = 8; // +18 dB before compression; the volume knob remains 0–100%.
const MAX_PAD_SOURCES = 32;
const LIBRARY_URL = new URL('./vendor/spessasynth.js', import.meta.url);
const WORKLET_URL = new URL('./midiphoria-processor.js', import.meta.url);
const SOUNDFONT_URL = new URL('../../../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url);
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high, fallback = low) => Math.max(low, Math.min(high, finite(value, fallback)));
const safeCall = (callback, ...args) => { try { callback?.(...args); } catch { /* UI callbacks do not own the audio lifecycle. */ } };
const cancelled = () => new Error('MIDI player operation cancelled.');

function validateMidi(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 14) throw new Error('Choose a Standard MIDI file (.mid or .midi).');
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('MIDI files must be 10 MB or smaller.');
  const view = new DataView(buffer);
  if (view.getUint32(0) !== 0x4d546864 || view.getUint32(4) < 6
    || view.getUint32(4) > buffer.byteLength - 8 || view.getUint16(8) > 2
    || view.getUint16(10) === 0 || view.getUint16(12) === 0) {
    throw new Error('This file has an invalid MIDI header.');
  }
}

/**
 * MIDI-file transport scheduled inside SpessaSynth's AudioWorklet. Only
 * enableAudio(), called directly from an Audio gesture, creates/resumes audio.
 * load() before that gesture queues a validated file and returns without playing.
 * Callbacks receive display events, never schedule sound from animation frames.
 */
export class MidiphoriaPlayer {
  constructor({ onMidi, onState, onClear, runtime = globalThis, clock = () => performance.now() / 1000,
    loadLibrary = () => import(LIBRARY_URL.href), connectOutput = connectAudioOutput, getAudioContext } = {}) {
    this.onMidi = onMidi; this.onState = onState; this.onClear = onClear;
    this.runtime = runtime; this._loadLibrary = loadLibrary; this._connectOutput = connectOutput;
    this._getAudioContext = getAudioContext; this._ownsContext = false;
    this._font = null; this._fontName = 'TimGM6mb'; this._fontSelection = 0; this._fontQueue = Promise.resolve(); this._fontUpload = 0;
    this._clock = clock; this._visual = null;
    this.context = null; this._master = null; this._preamp = null; this._compressor = null; this._ceiling = null;
    this._synth = null; this._padSynth = null; this._sequencer = null;
    this._padSources = new Map(); this._padNotes = new Map();
    this._releaseOutput = null; this._enginePromise = null; this._engineReady = false;
    this._listeners = []; this._waits = new Map(); this._fetchController = null;
    this._sources = new Set([SOURCE]);
    this._file = null; this._queued = null; this._activeLoad = null; this._loadTimer = null;
    this._serial = 0; this._readyToken = null; this._playing = false; this._audioEnabled = false;
    this._desiredAudio = false; this._volume = 0.5; this._rate = 1; this._loop = false;
    this._noteEffects = sanitizeMidiNoteEffects({});
    this._time = 0; this._duration = 0; this._seekTime = null; this._error = null; this._disposed = false;
    this._onPageHide = () => { void this.dispose(); };
    this.runtime.addEventListener?.('pagehide', this._onPageHide);
  }

  get state() {
    if (this._visual) {
      const time = this._visualTime(), score = this._visual;
      return { ready: true, hasSong: true, loading: false, playing: score.playing, visualOnly: true,
        audioEnabled: this._audioEnabled && this.context?.state === 'running', time, duration: score.duration,
        rate: this._rate, loop: this._loop, volume: this._volume, fileName: score.name, soundfontName: this._fontName, error: this._error };
    }
    const ready = this._engineReady && Boolean(this._file) && this._readyToken === this._file.token;
    const current = this._seekTime ?? (this._playing ? this._sequencer?.currentTime : this._time);
    return { ready, hasSong: Boolean(this._file), loading: Boolean(this._enginePromise || this._activeLoad),
      playing: this._playing, audioEnabled: this._audioEnabled && this.context?.state === 'running', time: clamp(current, 0, this._duration),
      duration: this._duration, rate: this._rate, loop: this._loop, volume: this._volume,
      fileName: this._file?.fileName ?? '', soundfontName: this._fontName, error: this._error };
  }

  async enableAudio() {
    if (this._disposed) return false;
    // A user gesture can arrive before the browser's queued statechange event.
    if (this.context?.state === 'closed') this._contextStateChanged(this.context);
    this._desiredAudio = true;
    this._error = null;
    if (this._file && !this._activeLoad && !this._queued && this._readyToken !== this._file.token) {
      let resolve;
      const completion = new Promise(done => { resolve = done; });
      this._file = { ...this._file, token: ++this._serial, completion, resolve };
      this._queued = this._file;
    }
    let context;
    try {
      if (!this.context) {
        if (this._getAudioContext !== undefined) {
          const borrowed = this._getAudioContext();
          if (!borrowed || borrowed.state === 'closed' || typeof borrowed.resume !== 'function' || !borrowed.audioWorklet) {
            throw new Error('The shared audio engine is not ready. Turn Audio on again.');
          }
          this.context = borrowed; this._ownsContext = false;
        } else {
          const AudioContext = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
          if (!AudioContext) throw new Error('Web Audio is unavailable in this browser.');
          this.context = new AudioContext({ latencyHint: 'interactive' }); this._ownsContext = true;
        }
        const ownedContext = this.context;
        const onStateChange = () => this._contextStateChanged(ownedContext);
        ownedContext.addEventListener('statechange', onStateChange);
        this._listeners.push(() => ownedContext.removeEventListener('statechange', onStateChange));
      }
      context = this.context;
      // Preserve mobile activation: resume is invoked before import, fetch or await.
      const resumed = context.resume();
      if (!this._engineReady && !this._enginePromise) {
        this._enginePromise = this._initialize(context);
        this._publish();
      }
      await Promise.all([resumed, this._enginePromise]);
      if (this._disposed || context !== this.context) return false;
      while (this._file && this._readyToken !== this._file.token) {
        const pending = this._file;
        this._pumpLoad();
        const loaded = await pending.completion;
        if (this._disposed || context !== this.context) return false;
        if (!loaded && pending === this._file) break;
      }
      this._audioEnabled = this._desiredAudio && context.state === 'running';
      this._updateGain(); this._publish();
      return this._audioEnabled;
    } catch (error) {
      if (this._disposed || (context && context !== this.context)) return false;
      this._error = error?.message || 'Could not start MIDI audio.';
      this._desiredAudio = false; this._audioEnabled = false;
      this._clear('error');
      this._cancelLoads();
      await this._closeEngine();
      this._publish();
      return false;
    }
  }

  setAudioEnabled(enabled) {
    if (this._disposed) return false;
    this._desiredAudio = Boolean(enabled);
    this._audioEnabled = this._desiredAudio && this._engineReady && this.context?.state === 'running';
    if (!this._audioEnabled) this.releasePads();
    this._updateGain(); this._publish();
    return this._audioEnabled;
  }

  setVolume(value) {
    this._volume = clamp(value, 0, 1, this._volume);
    this._updateGain(); this._publish();
    return this._volume;
  }

  setNoteEffects(config) {
    this._noteEffects = sanitizeMidiNoteEffects(config, this._noteEffects);
    if (!this._disposed) for (const synth of [this._synth, this._padSynth]) {
      synth?.worklet?.port?.postMessage({ type: 'midiphoriaNoteEffects', config: this._noteEffects });
    }
    return { ...this._noteEffects };
  }

  /** Validate before replacing either bank. A bank edit never starts audio or
   * changes the sequencer's position, rate, loop or Play/Pause state. */
  async loadSoundFont(buffer, name = 'Imported SoundFont') {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12 || buffer.byteLength > MAX_SOUNDFONT_BYTES) throw new Error('Choose a SoundFont (.sf2 or .sf3) of 128 MiB or smaller.');
    const view = new DataView(buffer);
    if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x7366626b) throw new Error('This is not an SF2 or SF3 SoundFont.');
    inspectSoundFont(buffer);
    const selection = ++this._fontSelection;
    const { SoundBankLoader } = await import('../midi-mixer/vendor/spessasynth-core.js');
    if (this._disposed || selection !== this._fontSelection) throw new DOMException('SoundFont selection was superseded.', 'AbortError');
    const parsed = SoundBankLoader.fromArrayBuffer(buffer);
    if (!parsed.presets.length) throw new Error('The SoundFont contains no instrument presets.');
    const font = { buffer: buffer.slice(0), name: String(name).slice(0, 128) };
    if (!this._engineReady) { this._font = font; this._fontName = font.name; this._publish(); return true; }
    // SpessaSynth has one pending bank acknowledgement per synth. Serialize
    // replacements so a previous response cannot acknowledge a newer upload.
    const context = this.context;
    const operation = this._fontQueue.catch(() => {}).then(async () => {
      if (this._disposed || context !== this.context || selection !== this._fontSelection) throw new DOMException('SoundFont selection was superseded.', 'AbortError');
      const previous = this._font;
      try { await this._uploadSoundFont(font, context); }
      catch (error) {
        if (context === this.context && !this._disposed && previous) {
          if (error.message?.includes('too long')) { this._audioEnabled = false; await this._closeEngine(); }
          else try { await this._uploadSoundFont(previous, context); }
          catch { this._audioEnabled = false; await this._closeEngine(); }
        }
        throw error;
      }
      if (this._disposed || context !== this.context) throw cancelled();
      this._font = font; this._fontName = font.name; this._publish(); return true;
    });
    this._fontQueue = operation.catch(() => {}); return operation;
  }

  async _uploadSoundFont(font, context) {
    const engines = [this._synth, this._padSynth], id = `midiphoria-bank-${++this._fontUpload}`;
    let rejectError;
    const failure = new Promise((_, reject) => { rejectError = reject; });
    for (const synth of engines) synth.eventHandler.addEvent('soundBankError', id,
      data => rejectError(new Error(data?.message || String(data || 'Could not load the SoundFont.'))));
    try {
      const uploaded = Promise.all(engines.map(async synth => {
        await synth.isReady;
        if (this._disposed || context !== this.context) throw cancelled();
        // Same bank ID replaces rather than accumulating banks. Never detach
        // the retained rollback/next-start buffer or the chooser's source.
        await synth.soundBankManager.addSoundBank(font.buffer.slice(0), 'midiphoria');
      }));
      await this._wait(Promise.race([uploaded, failure]), 'The SoundFont took too long to load.');
    } finally { for (const synth of engines) synth.eventHandler.removeEvent('soundBankError', id); }
  }

  padNoteOn(sourceId, note, velocity) {
    // Pads are direct gestures, never queued through Audio initialization or file loading.
    if (this._disposed || !this._audioEnabled || !this._engineReady || !this._padSynth
      || this.context?.state !== 'running' || typeof sourceId !== 'string' || !sourceId.length
      || sourceId.length > 128 || !Number.isInteger(note) || note < 0 || note > 127
      || !Number.isInteger(velocity) || velocity < 1 || velocity > 127) return false;
    if (this._padSources.get(sourceId) === note) return true;
    if (!this._padSources.has(sourceId) && this._padSources.size >= MAX_PAD_SOURCES) return false;
    this.padNoteOff(sourceId);
    const held = this._padNotes.get(note) ?? 0;
    this._padSources.set(sourceId, note); this._padNotes.set(note, held + 1);
    // A second pointer/key holding the same pitch must not cut off the first.
    if (!held) this._padSynth.noteOn(0, note, velocity, { time: this.context.currentTime });
    return true;
  }

  padNoteOff(sourceId) {
    if (!this._padSources.has(sourceId)) return false;
    const note = this._padSources.get(sourceId), remaining = this._padNotes.get(note) - 1;
    this._padSources.delete(sourceId);
    if (remaining > 0) this._padNotes.set(note, remaining);
    else {
      this._padNotes.delete(note);
      this._padSynth?.noteOff(0, note, { time: this.context?.currentTime ?? 0 });
    }
    return true;
  }

  releasePads() {
    this._padSources.clear(); this._padNotes.clear();
    // Release tails as well, so muting and re-arming cannot revive an old gesture.
    try { this._padSynth?.stopAll(true); } catch { /* A failed processor is already being released. */ }
    safeCall(this.onClear, PAD_SOURCE, 'pads-release');
  }

  async load(buffer, fileName = 'MIDI file.mid', { preserveLeadIn = false } = {}) {
    if (this._disposed) return false;
    try { validateMidi(buffer); }
    catch (error) { this._error = error.message; this._publish(); throw error; }
    this.pause();
    this._visual = null;
    this._clear('song-replacement');
    this._queued?.resolve(false);
    this._activeLoad?.resolve(false);
    let resolve;
    const completion = new Promise(done => { resolve = done; });
    const request = { buffer: buffer.slice(0), fileName: String(fileName).slice(0, 256), preserveLeadIn: Boolean(preserveLeadIn),
      token: ++this._serial, completion, resolve };
    this._file = request; this._queued = request;
    this._readyToken = null; this._time = 0; this._duration = 0; this._seekTime = null; this._error = null;
    this._pumpLoad(); this._publish();
    if (!this.context) return this.state;
    return (await completion) ? this.state : false;
  }

  play() {
    if (!this._disposed && this._visual) {
      const score = this._visual;
      this._visualTime();
      if (score.time >= score.duration) score.time = 0;
      if (!score.playing) { score.at = this._clock(); score.playing = true; }
      this._publish(); return true;
    }
    if (this._disposed || !this.state.ready || this.context?.state !== 'running') return false;
    if (this._playing) return true;
    if (this._time >= this._duration) this.seek(0);
    if (!this._file?.preserveLeadIn && this._time === 0 && finite(this._sequencer.midiData?.firstNoteOn) > 0) {
      // MIDI exports can contain seconds of setup before their first note.
      // Skip that lead-in only when starting from zero. Ordered worklet
      // messages retain setup controllers and leave ordinary seeks unchanged.
      this._sequencer.skipToFirstNoteOn = true;
      this._sequencer.currentTime = 0;
      this._sequencer.skipToFirstNoteOn = false;
    }
    this._playing = true;
    this._sequencer.play(); this._error = null; this._publish();
    return true;
  }

  pause() {
    if (this._disposed) return;
    if (this._visual) { this._visualTime(); this._visual.playing = false; }
    this._time = this.state.time; this._playing = false;
    this._sequencer?.pause(); this._synth?.stopAll(true);
    this._clear('pause'); this._publish();
  }

  stop() {
    if (this._disposed) return;
    this.pause(); this.seek(0); this._clear('stop'); this._publish();
  }

  seek(seconds) {
    if (this._disposed || !this.state.ready) return false;
    if (this._visual) {
      this._visual.time = clamp(seconds, 0, this._visual.duration, this.state.time);
      this._visual.at = this._clock(); this._publish(); return true;
    }
    const time = clamp(seconds, 0, this._duration, this.state.time);
    this._clear('seek');
    this._time = time; this._seekTime = time;
    this._sequencer.currentTime = time;
    this._publish(); return true;
  }

  setPlaybackRate(value) {
    if (this._visual) { this._visualTime(); this._visual.at = this._clock(); }
    this._rate = clamp(value, 0.5, 8, this._rate);
    if (this._sequencer) this._sequencer.playbackRate = this._rate;
    this._publish(); return this._rate;
  }

  setLoop(enabled) {
    if (this._visual) { this._visualTime(); this._visual.at = this._clock(); }
    this._loop = Boolean(enabled);
    if (this._sequencer) this._sequencer.loopCount = this._loop ? Infinity : 0;
    this._publish(); return this._loop;
  }

  /** A silent score clock for full decorative files too large for synthesis. */
  async loadVisualTimeline(duration, name = 'Decorative MIDI') {
    if (this._disposed) return false;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('This score has no visual duration.');
    this.pause(); this._clear('song-replacement');
    const loading = Boolean(this._activeLoad);
    this._cancelLoads(); this._file = null; this._error = null;
    this._visual = { duration, name: String(name).slice(0, 256), time: 0, at: this._clock(), playing: false };
    // Song-change events have no request IDs. Retire a pending audio loader so
    // its late completion cannot be mistaken for a subsequently selected file.
    if (loading) { this._audioEnabled = false; await this._closeEngine(); }
    this._publish(); return this.state;
  }

  _visualTime() {
    const score = this._visual;
    if (!score.playing) return score.time;
    const now = this._clock();
    let time = score.time + Math.max(0, now - score.at) * this._rate;
    if (time >= score.duration) {
      if (this._loop) time %= score.duration;
      else { time = score.duration; score.playing = false; }
    }
    score.time = time; score.at = now; return time;
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true; this._playing = false; this._audioEnabled = false; this._desiredAudio = false;
    this._fontSelection++;
    this._visual = null;
    this.runtime.removeEventListener?.('pagehide', this._onPageHide);
    this._cancelLoads(); this._clear('dispose'); this._file = null;
    await this._closeEngine();
  }

  async _initialize(context) {
    const valid = () => { if (this._disposed || context !== this.context) throw cancelled(); };
    this._fetchController = new AbortController();
    const requestedFont = this._font;
    const responsePromise = requestedFont ? Promise.resolve(requestedFont.buffer.slice(0))
      : this.runtime.fetch(SOUNDFONT_URL.href, { signal: this._fetchController.signal }).then(async response => {
        if (!response.ok) throw new Error(`Could not load the SoundFont (${response.status}).`);
        return response.arrayBuffer();
      });
    // Attach rejection handlers immediately even if another initialization stage fails.
    const resources = Promise.all([this._loadLibrary(), responsePromise, context.audioWorklet.addModule(WORKLET_URL.href)]);
    const [library, soundfont] = await this._wait(resources, 'Audio resources took too long to load.');
    valid();
    const audioNodeCreators = {
      worklet: (audioContext, name, options) => {
        const node = new this.runtime.AudioWorkletNode(audioContext, name, options);
        const onError = () => this._processorFailed();
        node.addEventListener('processorerror', onError);
        this._listeners.push(() => node.removeEventListener('processorerror', onError));
        return node;
      },
    };
    const synth = new library.WorkletSynthesizer(context, { eventsEnabled: true, audioNodeCreators });
    this._synth = synth;
    // A separate engine isolates pads from file program changes, MIDI ports,
    // sustain/reset messages, and transport-wide all-notes-off commands.
    const padSynth = new library.WorkletSynthesizer(context, { eventsEnabled: true, audioNodeCreators });
    this._padSynth = padSynth;
    this._master = context.createGain(); this._master.gain.value = 0;
    // Lift the complete SoundFont mix, including effects, before peak control.
    // Boosting after compression would drive dense arrangements into the guard.
    this._preamp = context.createGain(); this._preamp.gain.value = PLAYBACK_GAIN;
    this._compressor = context.createDynamicsCompressor();
    this._compressor.threshold.value = -6; this._compressor.knee.value = 0;
    this._compressor.ratio.value = 20; this._compressor.attack.value = 0;
    this._compressor.release.value = 0.1;
    this._ceiling = context.createWaveShaper();
    // A non-oversampled final guard bounds compressor transients to +/- .98.
    // Its linear center leaves quiet passages unchanged apart from .18 dB headroom.
    this._ceiling.curve = new Float32Array([-0.98, 0.98]);
    this._ceiling.oversample = 'none';
    synth.connect(this._preamp); padSynth.connect(this._preamp); this._preamp.connect(this._compressor);
    this._compressor.connect(this._master);
    this._master.connect(this._ceiling);
    this._releaseOutput = this._connectOutput(context, this._ceiling, { runtime: this.runtime });
    synth.setLogLevel?.(false, false, false);
    synth.setSystemParameter?.('voiceCap', 128);
    padSynth.setLogLevel?.(false, false, false);
    padSynth.setSystemParameter?.('voiceCap', 32);
    // Use the piano's own release, without an effects buffer that could become
    // audible again after Audio off/on has cleared the held pad voices.
    padSynth.setSystemParameter?.('effectsEnabled', false);
    const defaultFont = requestedFont ?? { buffer: soundfont, name: 'TimGM6mb' };
    let activeFont = this._font ?? defaultFont;
    await this._uploadSoundFont(activeFont, context);
    valid();
    // A chooser can finish validating a new selection during resource startup.
    // Keep output muted until the latest accepted bank is uploaded to both synths.
    while (this._font && this._font !== activeFont) { activeFont = this._font; await this._uploadSoundFont(activeFont, context); valid(); }
    this._font = activeFont; this._fontName = activeFont.name;
    valid();
    padSynth.programChange(0, 0); // General MIDI acoustic grand piano.
    this._sequencer = new library.Sequencer(synth, { skipToFirstNoteOn: false, initialPlaybackRate: this._rate });
    // lib 4.3.14 documents -1, but core 4.3.22 implements Infinity (not -1).
    this._sequencer.loopCount = this._loop ? Infinity : 0;
    this._bindEvents();
    this.setNoteEffects(this._noteEffects);
    this._engineReady = true; this._enginePromise = null;
    this._pumpLoad(); this._publish();
  }

  _bindEvents() {
    const forward = (type, data) => {
      if (!this._playing || !this.state.ready || this._disposed) return;
      // Standard MIDI port metadata has one byte: at most 256 x 16 channels.
      if (!Number.isInteger(data?.channel) || data.channel < 0 || data.channel > 4095) return;
      const port = Math.floor(data.channel / 16), channel = data.channel % 16;
      const sourceId = port ? `${SOURCE}:port:${port}` : SOURCE;
      const message = { type, channel, sourceId };
      if (type === 'noteOn' || type === 'noteOff') {
        if (!Number.isInteger(data.midiNote) || data.midiNote < 0 || data.midiNote > 127) return;
        message.note = data.midiNote;
        message.velocity = type === 'noteOff' ? 0 : Math.round(clamp(data.velocity, 0, 127));
        if (!message.velocity) message.type = 'noteOff';
        const patch = this._synth.midiChannels?.[data.channel]?.patch;
        if (message.type === 'noteOn' && typeof patch?.name === 'string') message.voiceName = patch.name.slice(0, 48);
      } else {
        if (!Number.isInteger(data.controller) || data.controller < 0 || data.controller > 127
          || !Number.isInteger(data.value) || data.value < 0 || data.value > 127) return;
        message.controller = data.controller; message.value = data.value;
      }
      this._sources.add(sourceId);
      safeCall(this.onMidi, message);
    };
    const synthEvents = this._synth.eventHandler;
    this._listen(synthEvents, 'noteOn', data => forward('noteOn', data));
    this._listen(synthEvents, 'noteOff', data => forward('noteOff', data));
    this._listen(synthEvents, 'controllerChange', data => forward('controlChange', data));
    this._listen(synthEvents, 'stopAll', data => forward('controlChange', {
      channel: data.channel, controller: data.force ? 120 : 123, value: 0,
    }));
    // Pad graphics now follow the same post-effect native notes as their sound.
    // The app suppresses its immediate raw pad drawing when padNoteOn succeeds;
    // input gestures can still draw directly while Audio is off.
    const padForward = (type, data) => {
      if (this._disposed || !this._engineReady || (type === 'noteOn' && !this._audioEnabled)
        || data?.channel !== 0 || !Number.isInteger(data.midiNote) || data.midiNote < 0 || data.midiNote > 127) return;
      const velocity = type === 'noteOff' ? 0 : Math.round(clamp(data.velocity, 0, 127));
      safeCall(this.onMidi, { type: velocity ? 'noteOn' : 'noteOff', channel: 0, sourceId: PAD_SOURCE,
        note: data.midiNote, velocity, voiceName: 'Piano' });
    };
    this._listen(this._padSynth.eventHandler, 'noteOn', data => padForward('noteOn', data));
    this._listen(this._padSynth.eventHandler, 'noteOff', data => padForward('noteOff', data));
    this._listen(this._padSynth.eventHandler, 'stopAll', () => safeCall(this.onClear, PAD_SOURCE, 'pads-stop'));
    const events = this._sequencer.eventHandler;
    this._listen(events, 'songChange', () => this._finishLoad());
    this._listen(events, 'midiError', error => this._finishLoad(error));
    this._listen(events, 'songEnded', () => {
      if (this._activeLoad || this._disposed || this._visual) return;
      this._playing = false; this._time = this._duration; this._seekTime = null;
      this._clear('ended'); this._publish();
    });
    this._listen(events, 'timeChange', time => {
      if (this._disposed || this._visual) return;
      if (this._playing && this._seekTime === null && finite(time) + 0.05 < this._time) this._clear('loop');
      this._time = clamp(time, 0, this._duration); this._seekTime = null;
      this._publish();
    });
  }

  _pumpLoad() {
    if (!this._engineReady || this._disposed || this._activeLoad || !this._queued) return;
    const request = this._queued; this._queued = null; this._activeLoad = request;
    this._sequencer.pause(); this._synth.stopAll(true);
    this._loadTimer = this.runtime.setTimeout(() => {
      // A late untagged songChange cannot be assigned to a subsequent file safely.
      this._error = 'The MIDI file could not be loaded. Enable Audio again to retry.';
      this._cancelLoads(); this._audioEnabled = false; this._desiredAudio = false;
      void this._closeEngine().then(() => this._publish());
    }, 15000);
    try { this._sequencer.loadNewSongList([{ binary: request.buffer.slice(0), fileName: request.fileName }]); }
    catch (error) { this._finishLoad(error); }
  }

  _finishLoad(error = null) {
    if (!this._activeLoad || this._disposed) return;
    const request = this._activeLoad;
    this.runtime.clearTimeout(this._loadTimer); this._loadTimer = null; this._activeLoad = null;
    this._sequencer.pause();
    const current = request === this._file;
    if (current) {
      const duration = finite(this._sequencer.duration);
      if (!error && duration <= 0) error = new Error('This MIDI file has no playable duration.');
      this._error = error ? error.message || String(error) : null;
      this._duration = error ? 0 : duration; this._time = 0; this._seekTime = null;
      this._readyToken = error ? null : request.token;
      if (!error) {
        this._sequencer.currentTime = 0;
        this._sequencer.loopCount = this._loop ? Infinity : 0;
      }
    }
    request.resolve(current && !error);
    this._pumpLoad(); this._publish();
  }

  _listen(handler, event, callback) {
    const id = `midiphoria-player-${event}`;
    handler.addEvent(event, id, callback);
    this._listeners.push(() => handler.removeEvent(event, id));
  }

  _wait(promise, message) {
    return new Promise((resolve, reject) => {
      const timer = this.runtime.setTimeout(() => { this._waits.delete(timer); reject(new Error(message)); }, 30000);
      this._waits.set(timer, reject);
      Promise.resolve(promise).then(resolve, reject).finally(() => {
        this.runtime.clearTimeout(timer); this._waits.delete(timer);
      });
    });
  }

  _cancelLoads() {
    this.runtime.clearTimeout(this._loadTimer); this._loadTimer = null;
    this._activeLoad?.resolve(false); this._queued?.resolve(false);
    this._activeLoad = null; this._queued = null; this._readyToken = null;
  }

  _processorFailed() {
    if (this._disposed) return;
    this._error = 'The MIDI audio processor stopped. Turn Audio on to restart it.';
    this._audioEnabled = false; this._desiredAudio = false; this._playing = false;
    this._updateGain(); this._cancelLoads(); this._clear('processor-error');
    void this._closeEngine().then(() => this._publish());
  }

  _contextStateChanged(context) {
    if (this._disposed || context !== this.context) return;
    if (context.state === 'closed') {
      this._error = 'Audio stopped. Turn Audio on to restart it.';
      this._audioEnabled = false; this._desiredAudio = false;
      this._cancelLoads(); this._clear('audio-closed');
      void this._closeEngine().then(() => this._publish());
      return;
    }
    // Browser/device interruptions must not leave an apparently armed, silent
    // button. Retain the user's intent and transport so one Audio click resumes
    // the existing score; a native recovery must still respect an explicit mute.
    this._audioEnabled = this._desiredAudio && this._engineReady && context.state === 'running';
    if (!this._audioEnabled) this.releasePads();
    this._updateGain(); this._publish();
  }

  async _closeEngine() {
    const context = this.context, ownsContext = this._ownsContext;
    this.releasePads();
    this.context = null; this._ownsContext = false; this._engineReady = false; this._enginePromise = null; this._playing = false;
    this._fetchController?.abort(); this._fetchController = null;
    for (const [timer, reject] of this._waits) { this.runtime.clearTimeout(timer); reject(cancelled()); }
    this._waits.clear();
    for (const remove of this._listeners.splice(0)) remove();
    try { this._sequencer?.pause(); this._synth?.stopAll(true); } catch { /* An errored processor may already be closed. */ }
    try { this._synth?.destroy(); } catch { /* Release remaining owned nodes below. */ }
    try { this._padSynth?.destroy(); } catch { /* Release remaining owned nodes below. */ }
    this._sequencer = null; this._synth = null; this._padSynth = null;
    this._releaseOutput?.(); this._releaseOutput = null;
    this._master?.disconnect(); this._master = null;
    this._preamp?.disconnect(); this._preamp = null;
    this._compressor?.disconnect(); this._compressor = null;
    this._ceiling?.disconnect(); this._ceiling = null;
    if (ownsContext && context && context.state !== 'closed') await context.close().catch(() => {});
  }

  _updateGain() {
    if (!this._master || !this.context) return;
    const gain = this._master.gain, now = this.context.currentTime;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
    else { gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now); }
    gain.linearRampToValueAtTime(this._audioEnabled ? this._volume : 0, now + 0.02);
  }

  _clear(reason) {
    for (const sourceId of this._sources) safeCall(this.onClear, sourceId, reason);
    this._sources = new Set([SOURCE]);
  }
  _publish() { if (!this._disposed) safeCall(this.onState, this.state); }
}
