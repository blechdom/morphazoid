import { createSpiderWeb, normalizeSpiderWeb, spiderWebGeometryKey, serializeSpiderWeb } from './spider-synth-web.js?v=ba050afc7c8e';
import { SpiderSynthWorld } from './spider-synth-world.js?v=ba050afc7c8e';
import { connectAudioOutput } from './audio-output-manager.js';
import { SPELLING_DIPHONE_ATLAS_URL, SPELLING_DIPHONE_CLIPS } from './spelling-diphone-atlas.js';
import { loadSpellingPronunciations, spellingPhoneDefinition, spellingPronunciationTokens } from './spelling-pronunciation.js';
import { normalizeSpiderSound, SPIDER_SOUND_DEFAULTS, normalizeSpiderBodyMix, createDefaultSpiderBodyMix } from './spider-synth-dsp.js?v=ba050afc7c8e';
import { SpiderMidiPerformance, normalizeSpiderMidiMessage } from './spider-synth-midi.js?v=ba050afc7c8e';
import { SPIDER_RECORDINGS } from './spider-synth-recordings.js?v=ba050afc7c8e';

export { SPIDER_SOUND_DEFAULTS, SPIDER_SOUND_PRESETS, SPIDER_BODY_GROUPS, SPIDER_BODY_SOURCES,
  normalizeSpiderSound, createDefaultSpiderBodyMix, normalizeSpiderBodyMix, createRandomSpiderSound,
  SPIDER_MOTION_SOUND_PRESETS, getSpiderMotionSound, getSpiderBodyGroupId } from './spider-synth-dsp.js?v=ba050afc7c8e';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const safeCall = (callback, value) => { try { callback?.(value); } catch {} };
const cancelled = () => Object.assign(new Error('Audio start was cancelled.'), { name: 'AbortError' });
const midiScope = (scope) => scope && typeof scope === 'object' ? {
  ...(scope.sourceId != null ? { sourceId: String(scope.sourceId).slice(0, 128) } : {}),
  ...(scope.channel != null ? { channel: Math.round(Math.max(0, Math.min(15, finite(scope.channel)))) } : {}),
} : undefined;
// Small phone units and CMU pronunciations come from the same locally bundled
// KAL16 atlas as Spelling Synthesizer/Vocalzoid; all playback and joins occur in
// the worklet, so animation or layout stalls cannot interrupt a spoken phrase.
export function createSpiderSpeechPlan(text, pronunciations) {
  const phones = [];
  for (const token of spellingPronunciationTokens(String(text ?? '').slice(0, 180), pronunciations)) {
    if (token.type === 'boundary') {
      phones.push({ offset: 0, duration: /[.!?;:]/.test(token.source) ? .19 : .075, gain: 0, silence: true });
      continue;
    }
    for (const phone of token.phones) {
      const definition = spellingPhoneDefinition(phone.id);
      const clip = SPELLING_DIPHONE_CLIPS[definition?.sampleKey];
      if (!clip) continue;
      const duration = clip.kind === 'vowel' ? Math.min(clip.duration, phone.stress ? .21 : .15)
        : clip.kind === 'glide' ? Math.min(.32, clip.duration) : clip.duration;
      // Preserve glides and consonant attacks. Sustained monophthongs use the
      // stable central body, avoiding a long sampled lead-in for every vowel.
      const offset = clip.offset + (clip.kind === 'vowel' ? Math.max(0, Math.min(clip.sustainStart - .025, clip.duration - duration)) : 0);
      phones.push({ offset, duration, gain: clip.gain * (phone.stress ? 1.06 : 1), silence: false });
      if (phones.length >= 96) break;
    }
    if (phones.length >= 96) break;
  }
  return phones.slice(0, 96);
}

/** Explicitly armed, one-context/one-worklet instrument with an audio clock. */
export class SpiderSynthAudio {
  constructor({ onStatus, onTelemetry, onSamples, getWorldSnapshot, runtime = globalThis } = {}) {
    this.runtime = runtime; this.onStatus = onStatus; this.onTelemetry = onTelemetry; this.onSamples = onSamples; this.getWorldSnapshot=getWorldSnapshot; this.worldSnapshot=null;
    this.context = null; this.node = null; this.master = null; this.releaseOutput = null;
    this.enabled = false; this.ready = false; this.disposed = false;
    this.generation = 0; this.speechGeneration = 0; this.buildPromise = null;
    this.atlasPromise = null; this.atlasReady = false; this.speechAbort = null;
    this.samplesPromise = null; this.samplesStatus = 'unloaded'; this.samplesLoaded = 0; this.samplesAbort = null;

    this.preparedWebKey=null;
    this.state = { playing: false, soundPlaying: false, sound: { ...SPIDER_SOUND_DEFAULTS }, bodyMix: createDefaultSpiderBodyMix() };
    this.anchorTime = 0; this.anchorClock = this.clock();
    this.midiPerformance = new SpiderMidiPerformance();
    this.telemetry = { rms: 0, peak: 0, speechEnvelope: 0, renderedFrames: 0, soundTime: 0, recentEvents: [] };
  }
  clock() { return this.context ? this.context.currentTime : finite(this.runtime.performance?.now?.(), Date.now()) / 1000; }
  getTime() { return this.anchorTime + (this.state.playing ? Math.max(0, this.clock() - this.anchorClock) : 0); }
  getState() {
    return { ...this.telemetry, enabled: this.enabled, ready: this.ready,
      contextState: this.context?.state ?? 'uninitialized', time: this.getTime(),
      playing: this.state.playing, soundPlaying: this.state.soundPlaying, disposed: this.disposed,
      midi: this.getMidiState(), world:this.worldSnapshot, samplesStatus:this.samplesStatus, samplesLoaded:this.samplesLoaded };
  }
  getMidiState() { return this.midiPerformance.getState(this.clock()); }
  applyMidiPose(pose, joints, tempo = this.state.motion?.tempo ?? 120, intensity = this.state.motion?.intensity ?? 1) {
    if (this.disposed) return pose;
    return this.midiPerformance.applyPose(pose, joints, this.clock(), tempo, intensity);
  }
  midiEventTime(value) {
    const now = this.clock(); const timestamp = value?.timestamp;
    const performanceNow = this.runtime.performance?.now?.();
    if (timestamp == null || !Number.isFinite(Number(timestamp)) || !Number.isFinite(performanceNow)) return now;
    // MIDIManager uses DOMHighResTimeStamp milliseconds. Preserve past event
    // timing across UI stalls; never schedule a release into the future.
    return now - Math.min(60, Math.max(0, (performanceNow - Number(timestamp)) / 1000));
  }
  midi(value) {
    if (this.disposed) return false;
    const message = normalizeSpiderMidiMessage(value); if (!message) return false;
    const audioTime = this.midiEventTime(value);
    const accepted = this.midiPerformance.handle(message, audioTime);
    if (accepted) this.post({ type: 'midi', message, audioTime });
    return accepted;
  }
  midiControl(groupId, axis, value, scope) {
    if (this.disposed) return false;
    const audioTime = this.clock(); const normalized = Math.max(-1, Math.min(1, finite(value)));
    const owner = midiScope(scope);
    const accepted = this.midiPerformance.setControl(groupId, axis, normalized, audioTime, owner);
    if (accepted) this.post({ type: 'midi-control', groupId, axis, value: normalized, scope: owner, audioTime });
    return accepted;
  }
  resetMidi(scope) {
    if (this.disposed) return;
    const audioTime = this.clock(); const owner = midiScope(scope);
    this.midiPerformance.reset(audioTime, owner);
    this.post({ type: 'midi-reset', scope: owner, audioTime });
  }
  worldCommand(value={}) {
    if(this.disposed||!['send-prey','hunt','clear-silk','reset','home','move','pluck-silk'].includes(value.type))return false;
    const command={type:value.type};if(value.id!=null)command.id=typeof value.id==='number'?Math.round(finite(value.id)):String(value.id).slice(0,96);
    if(value.silkId!=null)command.silkId=Math.round(finite(value.silkId));
    for(const key of ['u','velocity','strength'])if(value[key]!=null)command[key]=Math.max(0,Math.min(1,finite(value[key])));
    for(const key of ['x','z'])if(value[key]!=null)command[key]=Math.max(-.55,Math.min(.55,finite(value[key])));
    if(value.angle!=null)command.angle=finite(value.angle);
    this.post({type:'world-command',command,audioTime:this.clock()});return true;
  }
  restoreWorld(snapshot,timeOffset=0) {
    if(this.disposed||!snapshot||typeof snapshot!=='object')return false;
    this.worldSnapshot=new SpiderSynthWorld().restore(snapshot,finite(timeOffset)).snapshot();this.post({type:'world-state',snapshot,timeOffset:finite(timeOffset),audioTime:this.clock()});return true;
  }
  pluck(value = {}) {
    if(value.source==='silk')return this.worldCommand({...value,type:'pluck-silk'});
    if (this.disposed) return false;
    this.post({ type: 'pluck', pluck: { segmentId: Math.round(finite(value.segmentId,-1)), u: Math.max(0,Math.min(1,finite(value.u,.5))),
      velocity: Math.max(0,Math.min(1,finite(value.velocity,.65))), angle: finite(value.angle,Math.PI/2), source: value.source === 'prey' ? 'prey' : 'gesture' }, audioTime: this.clock() });
    return this.enabled;
  }
  post(data, transfer) { if (this.node && !this.disposed) this.node.port.postMessage(data, transfer ?? []); }
  postState(changes) {
    this.post({ type: 'state', state: changes, audioTime: this.context?.currentTime ?? 0 });
  }
  update(changes = {}) {
    if (this.disposed) return;
    const next = { ...changes };
    if ('time' in changes || 'playing' in changes) {
      this.anchorTime = Math.max(0, finite(changes.time, this.getTime()));
      this.anchorClock = this.clock();
      if ('playing' in changes) this.state.playing = changes.playing === true;
      next.time = this.anchorTime; next.playing = this.state.playing;
    }
    if ('soundPlaying' in changes) next.soundPlaying = changes.soundPlaying === true;
    if (changes.sound) next.sound = normalizeSpiderSound({ ...this.state.sound, ...changes.sound });
    if ('bodyMix' in changes) next.bodyMix = normalizeSpiderBodyMix(changes.bodyMix);
    if(changes.webSettings){
      next.webSettings=normalizeSpiderWeb({...this.state.webSettings,...changes.webSettings});
      const key=spiderWebGeometryKey(next.webSettings);
      if(key!==this.preparedWebKey){
        if(changes.preparedWeb&&spiderWebGeometryKey(changes.preparedWeb)!==key)throw new TypeError('Prepared web does not match its settings.');
        next.preparedWeb=changes.preparedWeb??serializeSpiderWeb(createSpiderWeb(next.webSettings));this.preparedWebKey=key;
      }else delete next.preparedWeb;
    }
    Object.assign(this.state, next);
    // Reset is an edge, never a sticky part of future full-state publications.
    delete this.state.resetActivity;
    this.postState(next);
  }
  setLevel(value) { this.update({ sound: { level: value } }); }
  interact({ jointId, active = false, velocity = 0 } = {}) {
    if (this.disposed) return;
    this.post({ type: 'interact', interaction: { jointId: String(jointId ?? '').slice(0, 120),
      active: active === true, velocity: Math.max(0, Math.min(1, finite(velocity))) } });
  }
  ensureContext() {
    if (this.context?.state !== 'closed' && this.context) return this.context;
    const Audio = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    if (typeof Audio !== 'function') throw new Error('This browser does not support Web Audio.');
    const time = this.getTime(); const previousClock = this.clock();
    const context = new Audio({ latencyHint: 'interactive' });
    this.midiPerformance.rebaseTime(context.currentTime - previousClock);
    this.context = context; this.anchorTime = time; this.anchorClock = context.currentTime;
    return context;
  }
  async build(context) {
    if (this.ready && this.node) return;
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = (async () => {
      if (!context.audioWorklet?.addModule || typeof this.runtime.AudioWorkletNode !== 'function') {
        throw new Error('Spider Synth requires AudioWorklet support.');
      }
      await context.audioWorklet.addModule(new URL('./spider-synth-processor.js?v=ba050afc7c8e', import.meta.url));
      if (this.disposed || this.context !== context || context.state === 'closed') throw cancelled();
      const node = new this.runtime.AudioWorkletNode(context, 'spider-synth', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
        processorOptions: {preparedWeb:this.state.preparedWeb},
      });
      const master = context.createGain(); master.gain.value = 0;
      node.connect(master);
      this.node = node; this.master = master;
      this.releaseOutput = connectAudioOutput(context, master, { runtime: this.runtime });
      node.port.onmessage = ({ data }) => {
        if (this.disposed) return;
        if (data?.type === 'telemetry') {
          if(data.world&&typeof data.world==='object')this.worldSnapshot=data.world;
          this.telemetry = { rms: finite(data.rms), peak: finite(data.peak), speechEnvelope: finite(data.speechEnvelope),
            audioTime: finite(data.audioTime, this.clock()),
            renderedFrames: finite(data.renderedFrames), motionTime: finite(data.motionTime), soundTime: finite(data.soundTime),
            pullEvents:finite(data.pullEvents),footReleaseEvents:finite(data.footReleaseEvents),lateFootEvents:finite(data.lateFootEvents),droppedFootEvents:finite(data.droppedFootEvents),droppedStringEvents:finite(data.droppedStringEvents),maxFootLateness:finite(data.maxFootLateness),lastContactAudioTime:finite(data.lastContactAudioTime,-1),propagationEvents:finite(data.propagationEvents),voiceReplacements:finite(data.voiceReplacements),shortenedAttacks:finite(data.shortenedAttacks),
            contactEvents: finite(data.contactEvents), lastContactTime: finite(data.lastContactTime, -1),
            pluckEvents: finite(data.pluckEvents), activeStrings: finite(data.activeStrings),
            recordingEvents:finite(data.recordingEvents),activeRecordings:finite(data.activeRecordings),droppedRecordings:finite(data.droppedRecordings),
            recentEvents: Array.isArray(data.recentEvents) ? data.recentEvents.slice(0,16).map(e=>({id:finite(e.id),segmentId:finite(e.segmentId),u:finite(e.u),velocity:finite(e.velocity),audioTime:finite(e.audioTime,-1),source:String(e.source??'contact').slice(0,20),silkId:e.silkId==null||finite(e.silkId,-1)<0?null:Math.round(finite(e.silkId)),graphVersion:Math.max(0,Math.round(finite(e.graphVersion))),footSerial:e.footSerial==null?null:Math.max(0,Math.round(finite(e.footSerial))),legIndex:Math.round(finite(e.legIndex,-1)),kind:e.kind==null?null:String(e.kind).slice(0,12),manual:e.manual===true,sourceTime:finite(e.sourceTime,-1),frequency:finite(e.frequency)})) : [],
            metronomeEvents: finite(data.metronomeEvents), lastMetronomeTime: finite(data.lastMetronomeTime, -1),
            midiActive: finite(data.midiActive), midiEvents: finite(data.midiEvents),
            midiNotes: Array.from(data.midiNotes ?? [], value => finite(value, -1)),
            midiGates: Array.from(data.midiGates ?? [], value => finite(value)),
            midiFrequencies: Array.from(data.midiFrequencies ?? [], value => finite(value)),
            midiExpressions: Array.from(data.midiExpressions ?? [], value => finite(value)),
            interactionPeak: finite(data.interactionPeak) };
          safeCall(this.onTelemetry, { ...this.getState() });
        } else if (data?.type === 'error') safeCall(this.onStatus, `Sound: ${data.message}`);
      };
      node.onprocessorerror = () => {
        if (this.disposed) return;
        this.disable(); this.ready = false;
        safeCall(this.onStatus, 'The sound processor stopped. Turn Audio on to restart it.');
        this.releaseOutput?.(); this.releaseOutput = null;
        node.disconnect(); node.port.onmessage = null;
        this.master?.disconnect(); this.master = null; this.node = null;
        this.atlasReady = false; this.atlasPromise = null;
        this.samplesAbort?.abort(); this.samplesAbort = null; this.samplesPromise = null; this.samplesStatus = 'unloaded'; this.samplesLoaded = 0;

      };
      this.ready = true;
      this.postState({ ...this.state, time: this.getTime(), enabled: false });
    })();
    try { await this.buildPromise; }
    finally { this.buildPromise = null; }
  }
  async enable(changes = {}) {
    if (this.disposed) throw new Error('This Spider Synth has been disposed.');
    this.update(changes);
    const generation = ++this.generation;
    // Creation/resume precedes every await, preserving the explicit user gesture.
    const context = this.ensureContext();
    const resume = context.state !== 'running' ? context.resume() : Promise.resolve();
    safeCall(this.onStatus, 'Starting spider sound…');
    try {
      await Promise.all([resume, this.build(context)]);
      if (this.disposed || generation !== this.generation || this.context !== context) throw cancelled();
      if (context.state !== 'running') throw new Error('Audio is suspended. Tap Audio again.');
      this.enabled = true;
      // Restore current ownership, not an event queue. A note released during
      // module loading must not play late; notes still held keep their phase.
      this.midiPerformance.sample(context.currentTime, this.state.motion?.tempo ?? 120);
      this.post({ type: 'midi-state', snapshot: this.midiPerformance.serialize(), audioTime: context.currentTime });
      const worldSnapshot=this.getWorldSnapshot?.();
      if(worldSnapshot)this.restoreWorld(worldSnapshot,context.currentTime-finite(worldSnapshot.clock,context.currentTime));
      this.postState({ ...this.state, time: this.getTime(), enabled: true });
      const now = context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(1, now, .015);
      safeCall(this.onStatus, 'Spider sound ready.');
      // Recording I/O and decoding never delay Audio, either transport, or speech.
      void this.loadSamples();

      return this;
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        this.enabled = false;
        if (this.master) this.master.gain.setTargetAtTime(0, context.currentTime, .01);
        safeCall(this.onStatus, error.message || 'Audio could not start.');
      }
      throw error;
    }
  }
  disable() {
    if (this.disposed) return;
    this.generation += 1; this.speechGeneration += 1; this.enabled = false;
    // Audio is a mute, not MIDI panic: held notes and CC still animate.
    this.postState({ enabled: false }); this.post({ type: 'stop-speech' });
    if (this.master && this.context?.state !== 'closed') {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now); this.master.gain.setTargetAtTime(0, now, .012);
    }
    safeCall(this.onStatus, 'Audio off.');
  }
  async loadSamples() {
    if (this.disposed || !this.node || !this.context || this.samplesStatus === 'ready') return;
    if (this.samplesPromise) return this.samplesPromise;
    const context = this.context; const node = this.node;
    const controller = new AbortController(); this.samplesAbort = controller;
    this.samplesStatus = 'loading';
    safeCall(this.onSamples, { status: 'loading', loaded: 0 });
    const task = (async () => {
      try {
        const results = await Promise.allSettled(SPIDER_RECORDINGS.map(async ({ id, url, duration }) => {
          const response = await this.runtime.fetch(new URL(url, import.meta.url), { signal: controller.signal });
          if (!response.ok) throw new Error('Spider recording could not load.');
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength > 256 * 1024) throw new Error('Spider recording exceeds its fixed budget.');
          const buffer = await context.decodeAudioData(bytes);
          if (Math.abs(buffer.duration - duration) > .01 || buffer.numberOfChannels !== 1) throw new Error('Unexpected spider recording format.');
          // Sanitize on the main thread, then transfer ownership. The worklet
          // adopts these buffers without a long copy during an audio deadline.
          const data = new Float32Array(buffer.getChannelData(0));
          for (let i = 0; i < data.length; i += 1) data[i] = Number.isFinite(data[i]) ? Math.max(-1, Math.min(1, data[i])) : 0;
          return { id, data, sampleRate: buffer.sampleRate };
        }));
        if (this.disposed || controller.signal.aborted || this.context !== context || this.node !== node) return;
        const samples = results.filter(result => result.status === 'fulfilled').map(result => result.value);
        this.samplesLoaded = samples.length;
        this.samplesStatus = samples.length === SPIDER_RECORDINGS.length ? 'ready' : samples.length ? 'partial' : 'unavailable';
        if (samples.length) this.post({ type: 'sample-bank', samples }, samples.map(sample => sample.data.buffer));
        safeCall(this.onSamples, { status: this.samplesStatus, loaded: this.samplesLoaded });
      } catch {
        if (!this.disposed && !controller.signal.aborted && this.node === node) {
          this.samplesStatus = 'unavailable'; safeCall(this.onSamples, { status: 'unavailable', loaded: 0 });
        }
      }
    })();
    this.samplesPromise = task;
    try { await task; }
    finally {
      if (this.samplesPromise === task) this.samplesPromise = null;
      if (this.samplesAbort === controller) this.samplesAbort = null;
    }
  }
  async loadAtlas() {
    if (this.atlasReady) return;
    if (this.atlasPromise) return this.atlasPromise;
    const context = this.context;
    this.speechAbort = new AbortController();
    const signal = this.speechAbort.signal;
    this.atlasPromise = (async () => {
      const response = await this.runtime.fetch(SPELLING_DIPHONE_ATLAS_URL, { signal });
      if (!response.ok) throw new Error('The bundled KAL16 speech atlas could not load.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Speech atlas exceeds its fixed budget.');
      const buffer = await context.decodeAudioData(bytes);
      if (this.disposed || !this.node || this.context !== context) throw cancelled();
      const requiredDuration = Math.max(...Object.values(SPELLING_DIPHONE_CLIPS).map((clip) => clip.offset + clip.duration));
      if (buffer.duration > 16 || buffer.duration + .002 < requiredDuration) throw new Error('The speech atlas has an unexpected duration.');
      const samples = new Float32Array(buffer.getChannelData(0));
      this.post({ type: 'atlas', samples, sampleRate: buffer.sampleRate }, [samples.buffer]);
      this.atlasReady = true;
    })();
    try { await this.atlasPromise; }
    finally { this.atlasPromise = null; this.speechAbort = null; }
  }
  async speak(value) {
    if (!this.enabled || !this.ready || this.disposed) {
      safeCall(this.onStatus, 'Turn Audio on before asking the spider to speak.'); return false;
    }
    const text = String(value ?? '').trim().slice(0, 180);
    if (!text) return false;
    const generation = ++this.speechGeneration;
    safeCall(this.onStatus, 'Preparing spider speech…');
    try {
      const [pronunciations] = await Promise.all([
        loadSpellingPronunciations(text, { fetcher: this.runtime.fetch?.bind(this.runtime) }), this.loadAtlas(),
      ]);
      if (!this.enabled || this.disposed || generation !== this.speechGeneration) return false;
      this.post({ type: 'speak', phones: createSpiderSpeechPlan(text, pronunciations) });
      safeCall(this.onStatus, 'The spider is speaking.'); return true;
    } catch (error) {
      if (!this.disposed && generation === this.speechGeneration && error.name !== 'AbortError') {
        safeCall(this.onStatus, `Speech unavailable: ${error.message}. The other sound layers remain playable.`);
      }
      return false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disable(); this.resetMidi(); this.post({ type: 'dispose' });
    this.disposed = true; this.generation += 1; this.speechGeneration += 1;
    this.speechAbort?.abort(); this.speechAbort = null; this.samplesAbort?.abort(); this.samplesAbort = null;
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null; this.node.disconnect(); this.node.port.close?.(); }
    this.releaseOutput?.(); this.releaseOutput = null;
    this.master?.disconnect(); this.master = null; this.node = null; this.ready = false;
    this.context?.close().catch(() => {});
  }
}
