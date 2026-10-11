import { SpessaSynthProcessor, SoundBankLoader, SpessaLog } from './vendor/spessasynth-core.js';
import { MidiMixerClock, MidiSampleClock, lowerBound, mixerLoopBounds } from './midi-mixer-clock.js';

/** SoundFont and both sequencers live on this single audio thread and clock. */
class MidiMixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.alive = true; this.ready = false; this.synth = null; this.telemetryFrames = 0;
    this.deckChannels = Array.from({ length: 6 }, () => new Map()); this.channelSettings = Array.from({ length: 6 }, () => []); this.deckConfigs = Array(6).fill(null);
    this.sourceIds = ['deck:0', 'deck:1', '', '', '', '']; this.sampleIds = Array(6).fill(null); this.noteSerial = 0;
    this.activeVisualNotes = Array.from({ length: 6 }, () => new Map()); this.visualCount = 0; this.sampleVisualCount = 0;
    this.channelVolumes = new Float32Array(192).fill(100 / 127); this.channelExpressions = new Float32Array(192).fill(1);
    this.audible = true; this.masterVolume = 1;
    this.crossfade = 0; this.noteEvents = []; this.droppedVisualEvents = 0; this.renderTime = 0;
    this.clock = new MidiMixerClock({
      emit: (deck, event, frame) => this.emit(deck, event, frame),
      release: (deck, frame = 0) => this.release(deck, frame),
      restore: (deck, controllers, beat) => this.restore(deck, controllers, beat),
      configure: (deck, config, channels) => this.configure(deck, config, channels),
    });
    this.sampleClock = new MidiSampleClock({ emit: (source, event, frame) => this.emit(source, event, frame), release: (source, frame = 0) => this.release(source, frame), restore: (source, controllers, beat) => this.restore(source, controllers, beat), configure: (source, config, channels) => this.configure(source, config, channels) });
    this.port.onmessage = ({ data }) => { void this.command(data).catch(error => this.port.postMessage({ type: 'error', message: error.message })); };
  }
  async command(message) {
    if (message.type === 'dispose') { this.sampleClock.stopAll(); this.alive = false; this.synth?.destroySynthProcessor(); this.synth = null; return; }
    if (message.type === 'initialize') {
      SpessaLog.setLogLevel(false, false, false);
      const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false }); this.synth = synth;
      await synth.processorInitialized;
      if (!this.alive) return;
      synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(message.soundfont), 'midi-mixer');
      synth.setSystemParameter('voiceCap', 192);
      synth.setSystemParameter('autoAllocateVoices', false);
      while (synth.midiChannels.length < 192) synth.createMIDIChannel();
      this.ready = true; this.port.postMessage({ type: 'ready' }); return;
    }
    if (!this.ready) return;
    switch (message.type) {
      case 'sampleClock': this.sampleClock.beat = Math.max(0, Number(message.beat) || 0); break;
      case 'sample': {
        const slot = message.slot, source = slot + 2;
        if (!Number.isInteger(slot) || slot < 0 || slot > 3 || message.data.channels.length > 16) break;
        this.sampleClock.stop(slot); this.release(source);
        this.sourceIds[source] = `sample:${message.id}`; this.sampleIds[source] = message.id;
        this.deckChannels[source] = new Map(message.data.channels.map((channel, index) => [channel.channel, 128 + slot * 16 + index]));
        for (const channel of message.data.channels) this.synth.midiChannels[this.deckChannels[source].get(channel.channel)].setDrums(channel.drums);
        const config = { gain: Math.max(0, Math.min(1, message.gain)), mute: false, transpose: 0, rate: 1 };
        const channels = message.data.channels.map(channel => ({ channel: channel.channel, mute: false, solo: false, program: channel.drums ? null : message.program }));
        this.sampleClock.load(slot, { id: message.id, data: message.data, startBeat: message.startBeat, config, channels }); break;
      }
      case 'stopSamples': this.sampleClock.stopAll(); break;
      case 'audibility':
        this.audible = Boolean(message.enabled); this.masterVolume = Math.max(0, Math.min(1, message.volume));
        if (!this.audible || !this.masterVolume) for (let source = 0; source < 6; source++) this.releaseVisual(source);
        break;
      case 'load': {
        const map = new Map(message.data.channels.map((channel, i) => [channel.channel, message.index * 64 + i]));
        this.release(message.index); this.deckChannels[message.index] = map;
        for (const channel of message.data.channels) this.synth.midiChannels[map.get(channel.channel)].setDrums(channel.drums);
        this.clock.load(message.index, message.data, message.config, message.channels);
        this.port.postMessage({ type: 'loaded', index: message.index, token: message.token }); break;
      }
      case 'soundfont': {
        try {
          const bank = SoundBankLoader.fromArrayBuffer(message.soundfont);
          if (!bank.presets.length) throw new Error('The SoundFont contains no instrument presets.');
          this.synth.synthCore.eventQueue.length = 0;
          this.synth.stopAllChannels(true); this.synth.soundBankManager.addSoundBank(bank, 'midi-mixer');
          for (let slot = 0; slot < 4; slot++) { const sample = this.sampleClock.samples[slot]; if (sample) this.sampleClock.load(slot, sample); }
          for (let i = 0; i < 2; i++) this.clock.resync(i);
          this.port.postMessage({ type: 'soundfont', token: message.token });
        } catch (error) { this.port.postMessage({ type: 'soundfont', token: message.token, error: error.message }); }
        break;
      }
      case 'transport': if (!message.playing) this.sampleClock.stopAll(); this.clock.setTransport(message.playing, message.beat); break;
      case 'tempo': this.clock.tempo = Math.max(30, Math.min(300, message.tempo)); break;
      case 'deck': this.clock.setDeck(message.index, message.config, message.channels); break;
      case 'crossfade':
        this.crossfade = Math.max(-1, Math.min(1, message.value));
        for (let i = 0; i < 2; i++) if (this.deckConfigs[i]) this.configure(i, this.deckConfigs[i], this.channelSettings[i]);
        break;
      case 'rejoin': for (let i = 0; i < 2; i++) this.clock.resync(i); break;
      case 'release': this.sampleClock.stopAll(); this.synth.synthCore.eventQueue.length = 0; this.synth.stopAllChannels(true); for (let source = 0; source < 6; source++) this.releaseVisual(source); break;
    }
    this.publish();
  }
  emit(deck, event, frame = 0, restoring = false) {
    const channel = this.deckChannels[deck].get(event.channel); if (channel === undefined) return;
    const setting = this.channelSettings[deck].find(item => item.channel === event.channel);
    // Patch overrides select GM bank 0 and stay in force across embedded changes.
    if (!restoring && setting?.program !== null && setting?.program !== undefined && (event.kind === 12 || event.kind === 11 && (event.a === 0 || event.a === 32))) return;
    const status = event.kind * 16 + channel % 16;
    const message = event.kind === 12 || event.kind === 13 ? [status, event.a] : [status, event.a, event.b];
    this.synth.processMessage(message, channel - channel % 16, { time: this.synth.currentTime + frame / sampleRate });
    if (event.kind === 11) {
      if (event.a === 7) this.channelVolumes[channel] = event.b / 127;
      if (event.a === 11) this.channelExpressions[channel] = event.b / 127;
      if (event.a === 121) this.channelExpressions[channel] = 1;
      if (event.a === 120 || event.a === 123 || (event.a === 7 || event.a === 11) && event.b === 0) this.releaseVisual(deck, frame, event.channel);
    }
    const active = this.activeVisualNotes[deck];
    if (event.kind === 8) {
      const note = active.get(event.noteId);
      if (note) { this.queueVisual({ ...note, type: 'noteOff', at: currentTime + frame / sampleRate, beat: event.beat }); active.delete(event.noteId); this.visualCount--; if (deck > 1) this.sampleVisualCount--; }
    }
    if (!restoring && event.kind === 9) {
      const parameters = this.synth.midiChannels[channel].systemParameters;
      const gain = parameters.gain * this.masterVolume * this.channelVolumes[channel] * this.channelExpressions[channel];
      if (!this.audible || parameters.isMuted || gain <= 1e-6) return;
      // Four drawings can each hold 48 pitches. Reserve their 192 active slots;
      // black-score deck attacks use the other 320, never stealing that reserve.
      if (deck < 2 ? this.visualCount - this.sampleVisualCount >= 320 : this.sampleVisualCount >= 192) { this.droppedVisualEvents++; return; }
      const config = this.deckConfigs[deck], rate = config?.rate ?? 1;
      const boundary = deck < 2 ? mixerLoopBounds(this.clock.decks[deck]).end : this.sampleClock.samples[deck - 2]?.data.durationBeats ?? Infinity;
      const durationBeats = Math.max(0, Math.min(event.durationBeats ?? 0, boundary - event.beat));
      const note = { type: 'noteOn', id: `${this.sourceIds[deck]}:${++this.noteSerial}`, sourceId: this.sourceIds[deck], deck: deck < 2 ? deck : null, sampleId: this.sampleIds[deck], channel: event.channel,
        note: event.a + (event.channel % 16 === 9 ? 0 : config?.transpose ?? 0), velocity: event.b, gain,
        beat: event.beat, at: currentTime + frame / sampleRate, durationBeats, duration: durationBeats * 60 / (this.clock.tempo * rate), published: false };
      if (!this.queueVisual(note)) return;
      if (!active.has(event.noteId)) { this.visualCount++; if (deck > 1) this.sampleVisualCount++; }
      active.set(event.noteId, note);
    }
  }
  queueVisual(note) {
    if (this.noteEvents.length >= 256) {
      const sample = note.sampleId !== null;
      let replace = this.noteEvents.findIndex(event => event.sampleId === null && event.type === 'noteOn');
      if (!sample && note.type === 'noteOn') replace = -1;
      if (sample && replace < 0) replace = this.noteEvents.findIndex(event => event.sampleId === null);
      if (sample && note.type === 'noteOff' && replace < 0) {
        // Never discard a release for a sample attack already sent to the UI.
        // At most 192 such sample gates exist. Any further crowded releases
        // belong to an attack not yet published, so they can yield first.
        replace = this.noteEvents.findIndex(event => !event.published && event.type === 'noteOff');
        if (replace < 0) replace = this.noteEvents.findIndex(event => event.type === 'noteOn');
      }
      if (replace < 0) { this.droppedVisualEvents++; return false; }
      this.noteEvents.splice(replace, 1); this.droppedVisualEvents++;
    }
    this.noteEvents.push(note); return true;
  }
  releaseVisual(source, frame = 0, channel = null) {
    const active = this.activeVisualNotes[source];
    for (const [key, note] of active) if (channel === null || note.channel === channel) {
      this.queueVisual({ ...note, type: 'noteOff', at: currentTime + frame / sampleRate }); active.delete(key); this.visualCount--; if (source > 1) this.sampleVisualCount--;
    }
  }
  release(deck, frame = 0) {
    if (!this.synth) return;
    this.releaseVisual(deck, frame);
    if (frame === 0 && this.synth.synthCore.eventQueue.length) {
      // The bundled core retains sub-quantum messages until its next process
      // call. Cancel those reservations before releasing/reusing this source;
      // otherwise a late attack could arrive after Stop without a matching off.
      const channels = new Set(this.deckChannels[deck].values());
      this.synth.synthCore.eventQueue = this.synth.synthCore.eventQueue.filter(event => !channels.has(event.channelOffset + (event.message[0] & 15)));
    }
    for (const channel of this.deckChannels[deck].values()) {
      const status = 0xb0 | channel % 16, offset = channel - channel % 16;
      this.synth.processMessage([status, 64, 0], offset, { time: this.synth.currentTime + frame / sampleRate });
      this.synth.processMessage([status, 123, 0], offset, { time: this.synth.currentTime + frame / sampleRate });
    }
  }
  restore(deck, controllers, beat) {
    for (const channel of this.deckChannels[deck].values()) {
      const midi = this.synth.midiChannels[channel]; midi.setSystemParameter('presetLock', false);
      this.channelVolumes[channel] = 100 / 127; this.channelExpressions[channel] = 1;
      this.synth.controllerChange(channel, 121, 0); this.synth.controllerChange(channel, 0, 0); this.synth.controllerChange(channel, 32, 0);
      // Added synth channels begin at volume/pan zero; MIDI CC121 intentionally
      // leaves CC7/CC10 alone. Establish normal defaults before source history.
      this.synth.controllerChange(channel, 7, 100); this.synth.controllerChange(channel, 10, 64); this.synth.controllerChange(channel, 11, 127);
      this.synth.programChange(channel, 0); this.synth.pitchWheel(channel, 8192);
    }
    // A bounded set of per-controller histories reconstructs the position with
    // logarithmic lookups; notes before the seek point are never replayed.
    const state = [];
    for (const history of controllers) { const index = lowerBound(history, beat + 1e-9) - 1; if (index >= 0) state.push(history[index]); }
    state.sort((a, b) => a.beat - b.beat || a.order - b.order);
    for (const event of state) this.emit(deck, event, 0, true);
  }
  configure(deck, config, channels) {
    const previous = this.channelSettings[deck];
    this.deckConfigs[deck] = config; this.channelSettings[deck] = channels;
    const solo = channels.some(channel => channel.solo);
    const balance = deck > 1 ? 1 : deck === 0 ? Math.cos((this.crossfade + 1) * Math.PI / 4) : Math.sin((this.crossfade + 1) * Math.PI / 4);
    for (const setting of channels) {
      const index = this.deckChannels[deck].get(setting.channel), channel = this.synth.midiChannels[index]; if (!channel) continue;
      channel.setSystemParameter('isMuted', config.mute || setting.mute || solo && !setting.solo);
      channel.setSystemParameter('gain', config.gain * balance);
      if (channel.systemParameters.isMuted || config.gain * balance <= 1e-6) this.releaseVisual(deck, 0, setting.channel);
      channel.setSystemParameter('keyShift', setting.channel % 16 === 9 ? 0 : config.transpose);
      channel.setSystemParameter('presetLock', false);
      if (setting.program !== null && setting.program !== undefined) {
        this.synth.controllerChange(index, 0, 0); this.synth.controllerChange(index, 32, 0);
        this.synth.programChange(index, setting.program); channel.setSystemParameter('presetLock', true);
      } else if (deck < 2 && previous.find(item => item.channel === setting.channel)?.program != null) {
        const data = this.clock.decks[deck], rawBeat = this.clock.beat * (config.rate ?? 1) + config.offsetBeats;
        const bounds = mixerLoopBounds(data);
        const beat = bounds.start + (config.loop ? ((rawBeat % bounds.length) + bounds.length) % bounds.length : Math.max(0, rawBeat));
        this.synth.controllerChange(index, 0, 0); this.synth.controllerChange(index, 32, 0); this.synth.programChange(index, 0);
        const patches = [];
        for (const history of data.controllers) if (history[0].channel === setting.channel && (history[0].kind === 12 || history[0].kind === 11 && (history[0].a === 0 || history[0].a === 32))) {
          const at = lowerBound(history, beat + 1e-9) - 1; if (at >= 0) patches.push(history[at]);
        }
        patches.sort((a, b) => a.beat - b.beat || a.order - b.order);
        for (const event of patches) this.emit(deck, event, 0, true);
      }
    }
  }
  publish() {
    this.port.postMessage({ type: 'state', beat: this.clock.beat, sampleBeat: this.sampleClock.beat, tempo: this.clock.tempo, playing: this.clock.playing, at: currentTime, skippedEvents: this.clock.skippedEvents + this.sampleClock.skippedEvents, voices: this.synth?.voiceCount ?? 0, droppedVisualEvents: this.droppedVisualEvents });
    if (this.noteEvents.length) {
      for (const note of this.noteEvents) if (note.type === 'noteOn') note.published = true;
      this.port.postMessage({ type: 'notes', notes: this.noteEvents.map(({ published, ...note }) => note) }); this.noteEvents = [];
    }
  }
  process(_inputs, outputs) {
    if (!this.alive) return false;
    const [left, right] = outputs[0] ?? []; if (!left || !this.ready) return true;
    try {
      this.clock.process(left.length, sampleRate);
      this.sampleClock.process(left.length, sampleRate, this.clock.tempo);
      this.synth.process(left, right ?? left);
      this.telemetryFrames += left.length;
      if (this.telemetryFrames >= sampleRate / 30) { this.telemetryFrames = 0; this.publish(); }
    } catch (error) { this.ready = false; left.fill(0); right?.fill(0); this.port.postMessage({ type: 'error', message: error.message }); }
    return true;
  }
}
registerProcessor('morphazoid-midi-mixer', MidiMixerProcessor);
