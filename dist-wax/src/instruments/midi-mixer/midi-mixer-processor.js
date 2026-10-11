import { SpessaSynthProcessor, SoundBankLoader, SpessaLog } from './vendor/spessasynth-core.js';
import { mergeMidiParameters, sanitizeMidiParameters, sanitizeMidiSynthEffects, MIDI_GENERATOR_PARAMETERS, MIDI_SYNTH_EFFECT_PARAMETERS } from './midi-mixer-parameters.js';
import { MidiMixerClock, MidiSampleClock, lowerBound, mixerLoopBounds } from './midi-mixer-clock.js';

/** SoundFont and both sequencers live on this single audio thread and clock. */
class MidiMixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.alive = true; this.ready = false; this.synth = null; this.telemetryFrames = 0;
    this.suppressedNotes = Array.from({ length: 6 }, () => new Set()); this.sourceChannels = new Map(); this.effectiveMidi = new Map(); this.effectDefaults = {}; this.effectOverrides = {};
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
      const core = synth.synthCore, processMessage = core.processMessageInternal.bind(core);
      core.processMessageInternal = (message, offset) => {
        processMessage(message, offset);
        if ((message[0] & 0xf0) === 0xb0 && [6,38,96,97].includes(message[1])) {
          const index = offset + (message[0] & 15), midi = this.effectiveMidi.get(index);
          if (midi?.generators) this.applyGeneratorOverrides(index, midi);
        }
      };
      if (!this.alive) return;
      synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(message.soundfont), 'midi-mixer');
      synth.setSystemParameter('voiceCap', 192);
      synth.setSystemParameter('autoAllocateVoices', false);
      while (synth.midiChannels.length < 192) synth.createMIDIChannel();
      this.captureEffectDefaults();
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
        const config = { gain: Math.max(0, Math.min(1, message.gain)), mute: false, transpose: 0, rate: 1, midi: sanitizeMidiParameters(message.midi) };
        this.prepareSourceChannels(source, message.data.channels);
        const channels = message.data.channels.map(channel => ({ channel: channel.channel, mute: false, solo: false, program: channel.drums ? null : message.program }));
        this.sampleClock.load(slot, { id: message.id, data: message.data, startBeat: message.startBeat, config, channels }); break;
      }
      case 'sampleParameters': {
        const sample = this.sampleClock.samples[message.slot];
        if (!sample || sample.id !== message.id) break;
        const previous = sample.config.midi;
        sample.config = { ...sample.config, gain: message.gain ?? sample.config.gain, midi: sanitizeMidiParameters(message.midi) };
        if (this.midiResync(previous, sample.config.midi)) this.sampleClock.load(message.slot, sample);
        else this.configure(message.slot + 2, sample.config, sample.channels);
        break;
      }
      case 'effects': this.applyEffects(message.synth); break;
      case 'midiAction': this.midiAction(message); break;
      case 'stopSamples': this.sampleClock.stopAll(); break;
      case 'audibility':
        this.audible = Boolean(message.enabled); this.masterVolume = Math.max(0, Math.min(1, message.volume));
        if (!this.audible || !this.masterVolume) for (let source = 0; source < 6; source++) this.releaseVisual(source);
        break;
      case 'load': {
        const map = new Map(message.data.channels.map((channel, i) => [channel.channel, message.index * 64 + i]));
        this.release(message.index); this.deckChannels[message.index] = map;
        for (const channel of message.data.channels) this.synth.midiChannels[map.get(channel.channel)].setDrums(channel.drums);
        this.prepareSourceChannels(message.index, message.data.channels);
        this.clock.load(message.index, message.data, message.config, message.channels);
        this.port.postMessage({ type: 'loaded', index: message.index, token: message.token }); break;
      }
      case 'soundfont': {
        try {
          const bank = SoundBankLoader.fromArrayBuffer(message.soundfont);
          if (!bank.presets.length) throw new Error('The SoundFont contains no instrument presets.');
          this.synth.synthCore.eventQueue.length = 0;
          this.synth.stopAllChannels(true); this.synth.soundBankManager.addSoundBank(bank, 'midi-mixer');
          this.captureEffectDefaults(); this.applyEffects(this.effectOverrides);
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
    const shadow = this.sourceChannels.get(channel);
    if (event.kind !== 8 && event.kind !== 9 && this.updateSource(shadow, event) === false) return;
    const midi = this.effectiveMidi.get(channel) ?? {};
    const patchEvent = event.kind === 12 || event.kind === 11 && (event.a === 0 || event.a === 32);
    if (!restoring && patchEvent && this.patchHeld(midi)) { this.applyMidi(channel, midi, true, 'patch'); return; }
    if (!restoring && event.kind === 10 && midi.polyPressure !== undefined) event = { ...event, b: midi.polyPressure };
    if (event.kind === 9) {
      if (event.sourceBeat === undefined || shadow?.polyPressureAt[event.a] < event.sourceBeat) { shadow.polyPressureValues[event.a] = 0; shadow.polyPressureAt[event.a] = -Infinity; }
      const velocity = Math.max(0, Math.min(127, Math.round(event.b * (midi.velocityScale ?? 1) + (midi.velocityOffset ?? 0))));
      const pitch = event.a + (this.synth.midiChannels[channel].systemParameters.keyShift ?? 0);
      if (!velocity || pitch < 0 || pitch > 127) { this.suppressedNotes[deck].add(event.noteId); return; }
      event = { ...event, b: velocity };
    }
    if (event.kind === 8 && this.suppressedNotes[deck].delete(event.noteId)) return;
    const status = event.kind * 16 + channel % 16;
    const message = event.kind === 12 || event.kind === 13 ? [status, event.a] : [status, event.a, event.b];
    this.synth.processMessage(message, channel - channel % 16, { time: this.synth.currentTime + frame / sampleRate });
    if (event.kind === 11) {
      if (event.a === 7) this.channelVolumes[channel] = (midi.controllers?.[7] ?? event.b) / 127;
      if (event.a === 11) this.channelExpressions[channel] = (midi.controllers?.[11] ?? event.b) / 127;
      if (event.a === 121) this.channelExpressions[channel] = (midi.controllers?.[11] ?? 127) / 127;
      if (event.a === 120 || event.a === 123 || (event.a === 7 || event.a === 11) && (midi.controllers?.[event.a] ?? event.b) === 0) this.releaseVisual(deck, frame, event.channel);
    }
    if (event.kind === 9 && (midi.polyPressure !== undefined || shadow?.polyPressureValues[event.a])) this.synth.processMessage([0xa0 | channel % 16, event.a, midi.polyPressure ?? shadow.polyPressureValues[event.a]], channel - channel % 16, { time: this.synth.currentTime + frame / sampleRate });
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
        note: event.a + this.synth.midiChannels[channel].systemParameters.keyShift, velocity: event.b, gain,
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
    this.suppressedNotes[deck].clear();
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
      for (let cc = 0; cc < 128; cc++) midi.lockController(cc, false);
      for (const key of Object.keys(midi.lockedMIDIParameters)) midi.lockMIDIParameter(key, false);
      midi.resetGeneratorOverrides(); midi.resetGeneratorOffsets();
      const shadow = this.sourceChannels.get(channel), drums = shadow?.sourceDrums;
      if (shadow) { shadow.reset(false); shadow.setDrums(drums); shadow.polyPressureValues.fill(0); shadow.polyPressureAt.fill(-Infinity); }
      this.effectiveMidi.delete(channel);
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
  prepareSourceChannels(deck, channels) {
    for (const info of channels) {
      const index = this.deckChannels[deck].get(info.channel);
      // A control-only channel has no slot in the synthesizer and never gets a
      // note. Its private channel number cannot match any allocated voice.
      const shadow = new this.synth.midiChannels[0].constructor(this.synth.synthCore, this.synth.synthCore.defaultPreset, 4096 + index);
      shadow.polyPressureValues = new Uint8Array(128); shadow.polyPressureAt = new Float64Array(128).fill(-Infinity);
      shadow.reset(false); shadow.sourceDrums = info.drums; shadow.setDrums(info.drums);
      this.sourceChannels.set(index, shadow); this.effectiveMidi.delete(index);
    }
  }
  updateSource(shadow, event) {
    if (!shadow) return;
    try { switch (event.kind) {
      case 10: shadow.polyPressureValues[event.a] = event.b; shadow.polyPressureAt[event.a] = event.beat; break;
      case 11: shadow.controllerChange(event.a, event.b, false); break;
      case 12: shadow.programChange(event.a); break;
      case 13: shadow.setMIDIParameter('pressure', event.a); break;
      case 14: shadow.pitchWheel(event.a | event.b << 7); break;
    } } catch { return false; }
    return true;
  }
  patchHeld(midi) { return ['program','bankMSB','bankLSB','drums'].some(key => midi[key] !== undefined) || midi.controllers?.[0] !== undefined || midi.controllers?.[32] !== undefined; }
  midiResync(previous = {}, next = {}) {
    return previous.transpose !== next.transpose || previous.drums !== next.drums || Object.keys(previous.generators ?? {}).some(key => next.generators?.[key] === undefined);
  }
  applyGeneratorOverrides(index, midi) {
    const channel = this.synth.midiChannels[index];
    for (const [key, value] of Object.entries(midi.generators ?? {})) {
      const id = Number(key), descriptor = MIDI_GENERATOR_PARAMETERS.find(item => item.id === id);
      channel.generators.offsets[id] = 0;
      channel.setGeneratorOverride(id, value, !descriptor.group.includes('envelope') && ![21,23].includes(id));
    }
  }
  applyMidi(index, midi, force = false, only = '') {
    const channel = this.synth.midiChannels[index], source = this.sourceChannels.get(index); if (!source) return;
    const previous = this.effectiveMidi.get(index) ?? {};
    const patchChanged = force || ['program','bankMSB','bankLSB','drums'].some(key => midi[key] !== previous[key]) || midi.controllers?.[0] !== previous.controllers?.[0] || midi.controllers?.[32] !== previous.controllers?.[32];
    if (patchChanged) {
      channel.setSystemParameter('presetLock', false);
      channel.setPatch({ ...source.patch, program: midi.program ?? source.patch.program, bankMSB: midi.bankMSB ?? midi.controllers?.[0] ?? source.patch.bankMSB, bankLSB: midi.bankLSB ?? midi.controllers?.[32] ?? source.patch.bankLSB, isGMGSDrum: midi.drums === undefined ? source.drumChannel : Boolean(midi.drums) });
      channel.setDrums(midi.drums === undefined ? source.drumChannel : Boolean(midi.drums));
      channel.setSystemParameter('presetLock', this.patchHeld(midi));
    }
    if (only === 'patch') return;
    channel.setSystemParameter('pan', midi.pan ?? 0); channel.setSystemParameter('fineTune', midi.fineTune ?? 0);
    for (const cc of new Set([...Object.keys(previous.controllers ?? {}), ...Object.keys(midi.controllers ?? {})].map(Number))) {
      if (cc === 0 || cc === 32 || !force && previous.controllers?.[cc] === midi.controllers?.[cc]) continue;
      channel.lockController(cc, false);
      const parent = cc > 32 && cc < 64 ? cc - 32 : null;
      if (parent !== null) channel.lockController(parent, false);
      if (cc < 32) channel.lockController(cc + 32, false);
      channel.controllerChange(cc, midi.controllers?.[cc] ?? (source.midiControllers[cc] >> 7), false);
      if (cc < 32) channel.controllerChange(cc + 32, midi.controllers?.[cc + 32] ?? (midi.controllers?.[cc] === undefined ? source.midiControllers[cc] & 127 : 0), false);
      channel.lockController(cc, midi.controllers?.[cc] !== undefined || parent !== null && midi.controllers?.[parent] !== undefined);
      if (parent !== null) channel.lockController(parent, midi.controllers?.[parent] !== undefined);
      if (cc < 32) channel.lockController(cc + 32, midi.controllers?.[cc] !== undefined || midi.controllers?.[cc + 32] !== undefined);
    }
    for (const [field, parameter] of [['bend','pitchWheel'],['bendRange','pitchWheelRange'],['pressure','pressure'],['modulationDepth','modulationDepth'],['mono','polyMode']]) {
      if (!force && midi[field] === previous[field]) continue;
      channel.lockMIDIParameter(parameter, false);
      const value = midi[field] === undefined ? source.midiParameters[parameter] : field === 'mono' ? !midi[field] : midi[field];
      channel.setMIDIParameter(parameter, value); channel.lockMIDIParameter(parameter, midi[field] !== undefined);
    }
    if (midi.polyPressure !== previous.polyPressure) for (let note = 0; note < 128; note++) if (channel.playingNotes[note]) channel.polyPressure(note, midi.polyPressure ?? source.polyPressureValues[note]);
    for (const descriptor of MIDI_GENERATOR_PARAMETERS) {
      const id = descriptor.id, value = midi.generators?.[id];
      if (!force && value === previous.generators?.[id]) continue;
      channel.generators.offsets[id] = value === undefined ? source.generators.offsets[id] : 0;
      channel.generators.overrides[id] = value === undefined ? source.generators.overrides[id] : value;
      if (value !== undefined) channel.setGeneratorOverride(id, value, !descriptor.group.includes('envelope') && ![21,23].includes(id));
    }
    channel.generators.offsetsEnabled = channel.generators.offsets.some(value => value !== 0);
    channel.generators.overridesEnabled = channel.generators.overrides.some(value => value !== 32767);
    this.channelVolumes[index] = (midi.controllers?.[7] ?? source.midiControllers[7] / 128) / 127;
    this.channelExpressions[index] = (midi.controllers?.[11] ?? source.midiControllers[11] / 128) / 127;
    this.effectiveMidi.set(index, midi);
  }
  configure(deck, config, channels) {
    this.deckConfigs[deck] = config; this.channelSettings[deck] = channels;
    const solo = channels.some(channel => channel.solo);
    const balance = deck > 1 ? 1 : deck === 0 ? Math.cos((this.crossfade + 1) * Math.PI / 4) : Math.sin((this.crossfade + 1) * Math.PI / 4);
    for (const setting of channels) {
      const index = this.deckChannels[deck].get(setting.channel), channel = this.synth.midiChannels[index]; if (!channel) continue;
      const source = this.sourceChannels.get(index), midi = mergeMidiParameters(config.midi, setting.midi);
      if (source?.sourceDrums && setting.midi?.program === undefined && midi.drums === undefined && midi.bankMSB === undefined && midi.bankLSB === undefined) delete midi.program;
      if (setting.program !== null && setting.program !== undefined) {
        midi.program = setting.program; midi.bankMSB ??= 0; midi.bankLSB ??= 0;
      }
      channel.setSystemParameter('isMuted', config.mute || setting.mute || solo && !setting.solo);
      channel.setSystemParameter('gain', config.gain * balance * (midi.gain ?? 1));
      if (channel.systemParameters.isMuted || channel.systemParameters.gain <= 1e-6) this.releaseVisual(deck, 0, setting.channel);
      channel.setSystemParameter('keyShift', (source?.sourceDrums ? 0 : config.transpose ?? 0) + (midi.transpose ?? 0));
      this.applyMidi(index, midi);
    }
  }
  captureEffectDefaults() {
    for (const descriptor of MIDI_SYNTH_EFFECT_PARAMETERS) {
      const [section, parameter] = descriptor.id.split('.'); this.effectDefaults[descriptor.id] = this.synth[`${section}Processor`][parameter];
    }
  }
  applyEffects(input) {
    const next = sanitizeMidiSynthEffects(input);
    for (const key of new Set([...Object.keys(this.effectOverrides), ...Object.keys(next)])) {
      const [section, parameter] = key.split('.'); this.synth[`${section}Processor`][parameter] = next[key] ?? this.effectDefaults[key];
    }
    this.effectOverrides = next; this.synth.synthCore.updateActiveEffects();
  }
  midiAction(message) {
    const sources = message.samples ? [2,3,4,5].filter(source => this.sampleClock.samples[source - 2]) : [message.index];
    for (const source of sources) for (const [original, index] of this.deckChannels[source] ?? []) {
      if (message.channel != null && Number(message.channel) !== original) continue;
      const action = message.action, events = action.kind === 'parameter'
        ? [[action.registered ? 101 : 99, action.parameter >> 7], [action.registered ? 100 : 98, action.parameter & 127], [6, action.value >> 7], [38, action.value & 127], [101,127], [100,127]]
        : [[action.controller, action.value]];
      for (const [cc, value] of events) this.emit(source, { kind:11, channel:original, a:cc, b:value, beat:0 }, 0);
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
