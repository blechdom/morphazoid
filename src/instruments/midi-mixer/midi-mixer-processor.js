import { MidiNoteEffects } from '../../midi-note-effects.js';
import { SpessaSynthProcessor, SoundBankLoader, SpessaLog } from './vendor/spessasynth-core.js';
import { mergeMidiParameters, sanitizeMidiParameters, sanitizeMidiSynthEffects, MIDI_GENERATOR_PARAMETERS, MIDI_SYNTH_EFFECT_PARAMETERS } from './midi-mixer-parameters.js';
import { midiStateMessages } from './midi-mixer-reverse.js';
import { MidiMixerClock, MidiSampleClock, sampleSecondsAt, lowerBound, mixerLoopBounds } from './midi-mixer-clock.js';
import { MidiAutomataClock, AUTOMATA_SOURCE } from './midi-mixer-automata.js';

/** SoundFont and both sequencers live on this single audio thread and clock. */
class MidiMixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.alive = true; this.ready = false; this.synth = null; this.telemetryFrames = 0;
    this.suppressedNotes = Array.from({ length: 7 }, () => new Set()); this.sourceChannels = new Map(); this.effectiveMidi = new Map(); this.effectDefaults = {}; this.effectOverrides = {};
    this.deckChannels = Array.from({ length: 7 }, () => new Map()); this.channelSettings = Array.from({ length: 7 }, () => []); this.deckConfigs = Array(7).fill(null);
    this.sourceIds = ['deck:0', 'deck:1', '', '', '', '', 'automata']; this.sampleIds = Array(7).fill(null); this.noteSerial = 0;
    this.activeVisualNotes = Array.from({ length: 7 }, () => new Map()); this.visualCount = 0; this.sampleVisualCount = 0;
    this.channelVolumes = new Float32Array(193).fill(100 / 127); this.channelExpressions = new Float32Array(193).fill(1);
    this.audible = true; this.masterVolume = 1;
    this.crossfade = 0; this.noteEvents = []; this.droppedVisualEvents = 0; this.renderOffset = 0; this.actions = null;
    this.clock = new MidiMixerClock({
      emit: (deck, event, frame) => this.schedule('emit', frame, [deck, event]),
      release: (deck, frame = 0, hard = false) => this.schedule('release', frame, [deck, hard]),
      restore: (deck, controllers, beat, frame = 0) => this.schedule('restore', frame, [deck, controllers, beat]),
      rehydrate: (deck, events, frame = 0) => this.schedule('rehydrate', frame, [deck, events]),
      configure: (deck, config, channels, frame = 0) => this.schedule('configure', frame, [deck, config, channels]),
    });
    this.sampleClock = new MidiSampleClock({
      emit: (source, event, frame) => this.schedule('emit', frame, [source, event]),
      release: (source, frame = 0) => this.schedule('release', frame, [source, false]),
      restore: (source, controllers, beat, frame = 0) => this.schedule('restore', frame, [source, controllers, beat]),
      rehydrate: (source, events, frame = 0) => this.schedule('rehydrate', frame, [source, events]),
      configure: (source, config, channels, frame = 0) => this.schedule('configure', frame, [source, config, channels]),
    });
    this.noteFx = new MidiNoteEffects({ emit: note => this.soundEffectNote(note) });
    this.automataRevision = 0;
    this.automata = new MidiAutomataClock({
      emit: (event, frame) => this.schedule('emit', frame, [AUTOMATA_SOURCE, event]),
      release: () => this.release(AUTOMATA_SOURCE),
      configure: (settings, frame) => this.schedule('configure', frame, [AUTOMATA_SOURCE,
        { gain: settings.gain, mute: false, transpose: 0, rate: 1, midi: {} }, [{ channel: 0, program: settings.program, mute: false, solo: false }]]),
    });
    this.port.onmessage = ({ data }) => { void this.command(data).catch(error => this.port.postMessage({ type: 'error', message: error.message })); };
  }
  schedule(method, frame, args) {
    const action = { method, frame: frame ?? 0, args };
    if (this.actions) this.actions.push(action); else this.runAction(action);
  }
  runAction({ method, args }) {
    if (method === 'release') this.release(args[0], 0, args[1]);
    else this[method](...args, 0);
  }
  async command(message) {
    if (message.type === 'dispose') { this.noteFx.clear(this.synth?.currentTime ?? 0); this.sampleClock.stopAll(); this.alive = false; this.synth?.destroySynthProcessor(); this.synth = null; return; }
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
      this.activeSoundBank = SoundBankLoader.fromArrayBuffer(message.soundfont);
      if (!this.activeSoundBank.presets.length) throw new Error('The SoundFont contains no instrument presets.');
      synth.soundBankManager.addSoundBank(this.activeSoundBank, 'midi-mixer');
      synth.setSystemParameter('voiceCap', 192);
      synth.setSystemParameter('autoAllocateVoices', false);
      while (synth.midiChannels.length < 193) synth.createMIDIChannel();
      this.deckChannels[AUTOMATA_SOURCE] = new Map([[0, 192]]);
      // Newly allocated channels start with zero CC volume until reset/chase.
      synth.midiChannels[192].reset(false); synth.midiChannels[192].setDrums(false);
      this.prepareSourceChannels(AUTOMATA_SOURCE, [{ channel: 0, drums: false }]);
      this.captureEffectDefaults();
      this.ready = true; this.port.postMessage({ type: 'ready' }); return;
    }
    if (!this.ready) return;
    switch (message.type) {
      case 'automataRestore': this.automataRevision = message.revision; this.automata.restore(message.state); this.automata.rejoin(); break;
      case 'automataConfigure': this.automataRevision = message.revision; this.automata.configure(message.settings); break;
      case 'automataPlaying': this.automataRevision = message.revision; this.automata.setPlaying(message.playing); break;
      case 'automataRestart': this.automataRevision = message.revision; this.automata.restart(); break;
      case 'automataCapture': this.port.postMessage({ type: 'automataCapture', token: message.token, state: this.automata.snapshot(true) }); break;
      case 'sampleClock': this.sampleClock.beat = Math.max(0, Number(message.beat) || 0); this.sampleClock.seconds = Math.max(0, Number(message.seconds) || 0); break;
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
        const timing = message.timing ? { ...message.timing } : undefined;
        if (timing && message.quantize && this.clock.playing) timing.pendingBeats = Math.max(0, Math.ceil(this.clock.beat - 1e-9) - this.clock.beat);
        this.sampleClock.load(slot, { id: message.id, revision: message.revision, data: message.data, startBeat: message.startBeat, timing, loop: message.loop, sync: message.sync, config, channels }); break;
      }
      case 'sampleParameters': {
        const sample = this.sampleClock.samples[message.slot];
        if (!sample || sample.id !== message.id) break;
        this.sampleClock.setOptions(message.slot, message);
        const previous = sample.config.midi;
        sample.config = { ...sample.config, gain: message.gain ?? sample.config.gain, midi: sanitizeMidiParameters(message.midi) };
        if (this.midiResync(previous, sample.config.midi)) this.sampleClock.load(message.slot, sample);
        else this.configure(message.slot + 2, sample.config, sample.channels);
        break;
      }
      case 'noteEffects': this.noteFx.configure({ ...message.config, tempo: this.clock.tempo }); break;
      case 'effects': this.applyEffects(message.synth); break;
      case 'midiAction': this.midiAction(message); break;
      case 'stopSample': {
        // An older pad's release must not stop a newer clip that reused its slot.
        if (!Number.isInteger(message.slot) || message.slot < 0 || message.slot >= 4) break;
        const sample = this.sampleClock.samples[message.slot];
        if (sample && sample.id === message.id) this.sampleClock.stop(message.slot);
        break;
      }
      case 'stopSamples': this.sampleClock.stopAll(); break;
      case 'audibility':
        this.audible = Boolean(message.enabled); this.masterVolume = Math.max(0, Math.min(1, message.volume));
        if (!this.audible || !this.masterVolume) for (let source = 0; source < 7; source++) this.releaseVisual(source);
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
        const previous = this.activeSoundBank;
        let replacementStarted = false;
        try {
          // Parse completely before touching the playing bank or releasing voices.
          const bank = SoundBankLoader.fromArrayBuffer(message.soundfont);
          if (!bank.presets.length) throw new Error('The SoundFont contains no instrument presets.');
          replacementStarted = true;
          this.synth.soundBankManager.addSoundBank(bank, 'midi-mixer');
          this.synth.synthCore.eventQueue.length = 0;
          this.synth.stopAllChannels(true);
          this.captureEffectDefaults(); this.applyEffects(this.effectOverrides);
          for (let slot = 0; slot < 4; slot++) { const sample = this.sampleClock.samples[slot]; if (sample) this.sampleClock.load(slot, sample); }
          for (let i = 0; i < 2; i++) this.clock.resync(i);
          this.automata.rejoin();
          this.activeSoundBank = bank;
          this.port.postMessage({ type: 'soundfont', token: message.token });
        } catch (error) {
          if (replacementStarted && previous) {
            this.synth.soundBankManager.addSoundBank(previous, 'midi-mixer');
            for (let i = 0; i < 2; i++) this.clock.resync(i);
            this.automata.rejoin();
          }
          this.port.postMessage({ type: 'soundfont', token: message.token, error: error.message });
        }
        break;
      }
      case 'transport': if (!message.playing) this.sampleClock.stopAll(); this.clock.setTransport(message.playing, message.beat); break;
      case 'tempo': this.clock.tempo = Math.max(30, Math.min(300, message.tempo)); this.noteFx.configure({ tempo: this.clock.tempo }); break;
      case 'weave': this.clock.setWeave(message.config, message.phase); break;
      case 'deck': this.clock.setDeck(message.index, message.config, message.channels); break;
      case 'crossfade':
        this.crossfade = Math.max(-1, Math.min(1, message.value));
        for (let i = 0; i < 2; i++) if (this.deckConfigs[i]) this.configure(i, this.deckConfigs[i], this.channelSettings[i]);
        break;
      case 'rejoin': for (let i = 0; i < 2; i++) this.clock.resync(i); this.automata.rejoin(); break;
      case 'release': this.noteFx.clear(this.synth.currentTime); this.sampleClock.stopAll(); this.synth.synthCore.eventQueue.length = 0; this.synth.stopAllChannels(true); for (let source = 0; source < 7; source++) this.releaseVisual(source); break;
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
    if (event.kind === 8 || event.kind === 9) {
      const at = this.synth.currentTime + frame / sampleRate;
      const meta = { key: `${deck}:${event.noteId}`, source: deck, event, restoring,
        drums: this.synth.midiChannels[channel].drumChannel };
      if (event.kind === 9) this.noteFx.noteOn(channel, event.a, event.b, at, meta);
      else this.noteFx.noteOff(channel, event.a, at, meta);
      return;
    }
    if (!restoring && event.kind === 10) {
      const pitches = this.noteFx.activePitches(channel, event.a);
      for (const pitch of pitches.length ? pitches : [event.a]) this.synth.processMessage([0xa0 | channel % 16, pitch, event.b], channel - channel % 16,
        { time: this.synth.currentTime + frame / sampleRate });
      return;
    }
    const stopsNotes = event.kind === 11 && [120, 123, 124, 125, 126, 127].includes(event.a);
    if (stopsNotes) this.noteFx.clear(this.synth.currentTime, meta => meta.source === deck && meta.event.channel === event.channel);
    const status = event.kind * 16 + channel % 16;
    const message = event.kind === 12 || event.kind === 13 ? [status, event.a] : [status, event.a, event.b];
    this.synth.processMessage(message, channel - channel % 16, { time: this.synth.currentTime + frame / sampleRate });
    if (event.kind === 11) {
      if (event.a === 7) this.channelVolumes[channel] = (midi.controllers?.[7] ?? event.b) / 127;
      if (event.a === 11) this.channelExpressions[channel] = (midi.controllers?.[11] ?? event.b) / 127;
      if (event.a === 121) this.channelExpressions[channel] = (midi.controllers?.[11] ?? 127) / 127;
      if (stopsNotes || (event.a === 7 || event.a === 11) && (midi.controllers?.[event.a] ?? event.b) === 0) this.releaseVisual(deck, frame, event.channel);
    }
  }
  soundEffectNote(note) {
    if (!this.synth) return;
    const { source: deck, event: original, restoring } = note.meta;
    const event = { ...original, kind: note.type === 'noteOn' ? 9 : 8, a: note.note,
      b: note.velocity ?? 0, noteId: note.id };
    const channel = note.channel, frame = 0;
    const midi = this.effectiveMidi.get(channel) ?? {}, shadow = this.sourceChannels.get(channel);
    if (event.kind === 9 || note.release !== false) {
      this.synth.processMessage([event.kind * 16 + channel % 16, event.a, event.b], channel - channel % 16);
    }
    if (event.kind === 9 && (midi.polyPressure !== undefined || shadow?.polyPressureValues[original.a])) this.synth.processMessage([0xa0 | channel % 16, event.a, midi.polyPressure ?? shadow.polyPressureValues[original.a]], channel - channel % 16, { time: this.synth.currentTime + frame / sampleRate });
    const active = this.activeVisualNotes[deck];
    if (event.kind === 8) {
      const note = active.get(event.noteId);
      if (note) { this.queueVisual({ ...note, type: 'noteOff', at: currentTime + (this.renderOffset + frame) / sampleRate, beat: event.beat }); active.delete(event.noteId); this.visualCount--; if (deck > 1) this.sampleVisualCount--; }
    }
    if (!restoring && event.kind === 9) {
      const parameters = this.synth.midiChannels[channel].systemParameters;
      const gain = parameters.gain * this.masterVolume * this.channelVolumes[channel] * this.channelExpressions[channel];
      if (!this.audible || parameters.isMuted || gain <= 1e-6) return;
      // Four drawings can each hold 48 pitches. Reserve their 192 active slots;
      // black-score deck attacks use the other 320, never stealing that reserve.
      const automataCount = this.activeVisualNotes[AUTOMATA_SOURCE].size;
      if (deck === AUTOMATA_SOURCE ? automataCount >= 128 : deck < 2 ? this.visualCount - this.sampleVisualCount >= 320 : this.sampleVisualCount - automataCount >= 192) { this.droppedVisualEvents++; return; }
      const config = this.deckConfigs[deck], rate = config?.rate ?? 1;
      const boundary = deck < 2 ? mixerLoopBounds(this.clock.decks[deck]).end : this.sampleClock.samples[deck - 2]?.data.durationBeats ?? Infinity;
      const durationBeats = Math.max(0, Math.min(event.durationBeats ?? 0, boundary - event.beat));
      const note = { type: 'noteOn', id: `${this.sourceIds[deck]}:${++this.noteSerial}`, sourceId: this.sourceIds[deck], deck: deck < 2 ? deck : null, sampleId: this.sampleIds[deck], channel: event.channel,
        note: event.a + this.synth.midiChannels[channel].systemParameters.keyShift, velocity: event.b, gain,
        beat: event.beat, generation: event.generation, at: currentTime + (this.renderOffset + frame) / sampleRate, durationBeats, duration: event.durationSeconds ?? (deck > 1 && this.sampleClock.samples[deck - 2]?.sync === false ? sampleSecondsAt(this.sampleClock.samples[deck - 2].data, event.beat + durationBeats) - sampleSecondsAt(this.sampleClock.samples[deck - 2].data, event.beat) : durationBeats * 60 / (this.clock.tempo * rate)), published: false };
      if (!this.queueVisual(note)) return;
      if (!active.has(event.noteId)) { this.visualCount++; if (deck > 1) this.sampleVisualCount++; }
      active.set(event.noteId, note);
    }
  }
  queueVisual(note) {
    const limit = this.automata.playing || this.activeVisualNotes[AUTOMATA_SOURCE].size ? 384 : 256;
    if (this.noteEvents.length >= limit) {
      const sample = note.sampleId !== null || note.sourceId === 'automata';
      let replace = this.noteEvents.findIndex(event => event.sampleId === null && event.sourceId !== 'automata' && event.type === 'noteOn');
      if (!sample && note.type === 'noteOn') replace = -1;
      if (sample && replace < 0) replace = this.noteEvents.findIndex(event => event.sampleId === null && event.sourceId !== 'automata');
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
      this.queueVisual({ ...note, type: 'noteOff', at: currentTime + (this.renderOffset + frame) / sampleRate }); active.delete(key); this.visualCount--; if (source > 1) this.sampleVisualCount--;
    }
  }
  release(deck, frame = 0, hard = false) {
    if (!this.synth) return;
    this.noteFx.clear(this.synth.currentTime + frame / sampleRate, meta => meta.source === deck);
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
      this.synth.processMessage([status, 66, 0], offset, { time: this.synth.currentTime + frame / sampleRate });
      this.synth.processMessage([status, hard ? 120 : 123, 0], offset, { time: this.synth.currentTime + frame / sampleRate });
    }
  }
  restore(deck, controllers, beat) {
    for (const channel of this.deckChannels[deck].values()) {
      const midi = this.synth.midiChannels[channel]; midi.setSystemParameter('presetLock', false);
      for (let cc = 0; cc < 128; cc++) midi.lockController(cc, false);
      for (const key of Object.keys(midi.lockedMIDIParameters)) midi.lockMIDIParameter(key, false);
      midi.resetGeneratorOverrides(); midi.resetGeneratorOffsets();
      const shadow = this.sourceChannels.get(channel), drums = shadow?.sourceDrums;
      // CC121 preserves parameter values by design. A seek/source replacement
      // starts from a fresh channel baseline before replaying coherent history.
      midi.reset(false); midi.setDrums(drums ?? false);
      if (shadow) { shadow.reset(false); shadow.setDrums(drums); shadow.polyPressureValues.fill(0); shadow.polyPressureAt.fill(-Infinity); }
      this.effectiveMidi.delete(channel);
      this.channelVolumes[channel] = 100 / 127; this.channelExpressions[channel] = 1;
      this.synth.controllerChange(channel, 121, 0); this.synth.controllerChange(channel, 0, 0); this.synth.controllerChange(channel, 32, 0);
      // Added synth channels begin at volume/pan zero; MIDI CC121 intentionally
      // leaves CC7/CC10 alone. Establish normal defaults before source history.
      this.synth.controllerChange(channel, 7, 100); this.synth.controllerChange(channel, 10, 64); this.synth.controllerChange(channel, 11, 127);
      this.synth.programChange(channel, 0); this.synth.pitchWheel(channel, 8192);
    }
    // Restore complete parameter transactions, latched patch and pending bank
    // separately. Strictly-before avoids replaying procedural data at the cursor.
    if (controllers?.channels) {
      for (const { channel, lanes } of controllers.channels) {
        const selected = lanes.map(lane => {
          let low = 0, high = lane.changes.length;
          while (low < high) { const middle = (low + high) >>> 1; if (lane.changes[middle].tick / controllers.ppq < beat - 1e-9) low = middle + 1; else high = middle; }
          const change = lane.changes[low - 1];
          return { lane, value: change?.value ?? (lane.assumedInitial ? undefined : lane.initial), tick: change?.tick ?? -1, order: change?.order ?? -1 };
        }).filter(item => item.value !== undefined);
        const rank = lane => lane.kind.endsWith('-selector') ? 4 : lane.kind === 'patch' ? 0 : lane.kind === 'bank' ? 1 : 2;
        selected.sort((a, b) => rank(a.lane) - rank(b.lane) || a.tick - b.tick || a.order - b.order);
        for (const { lane, value, tick } of selected) for (const [kind, a, b] of midiStateMessages(lane, value)) this.emit(deck, { channel, kind, a, b, beat: tick / controllers.ppq }, 0, true);
      }
    } else {
      const state = [];
      for (const history of controllers ?? []) { const index = lowerBound(history, beat - 1e-9) - 1; if (index >= 0) state.push(history[index]); }
      state.sort((a, b) => a.beat - b.beat || a.order - b.order);
      for (const event of state) this.emit(deck, event, 0, true);
    }
  }
  rehydrate(deck, events) {
    if (!events.length) return;
    // Sostenuto captures only keys already down at its rising edge. Rebuild that
    // set before adding newer keys, then release keys already sustained by pedals.
    // This SoundFont core lacks CC66 holds: the clock schedules the final release
    // for rejoined sostenuto-only keys while they remain keyed in the native synth.
    const latched = events.filter(event => event.sostenutoHeld), affected = new Set(latched.map(event => event.channel));
    for (const source of affected) this.synth.controllerChange(this.deckChannels[deck].get(source), 66, 0);
    for (const event of latched) this.emit(deck, event);
    for (const source of affected) this.synth.controllerChange(this.deckChannels[deck].get(source), 66, 127);
    for (const event of events) if (!event.sostenutoHeld) this.emit(deck, event);
    for (const event of events) if (event.keyReleased && !event.sostenutoHeld && !this.suppressedNotes[deck].has(event.noteId)) {
      const channel = this.deckChannels[deck].get(event.channel);
      if (channel !== undefined) this.emit(deck, { ...event, kind: 8, b: 0 });
    }
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
    this.port.postMessage({ type: 'state', beat: this.clock.beat, sampleBeat: this.sampleClock.beat, sampleTime: this.sampleClock.seconds, samples: this.sampleClock.snapshot(), automata: this.automata.snapshot(), automataNotes: this.automata.takeNoteChanges(), automataRevision: this.automataRevision, tempo: this.clock.tempo, playing: this.clock.playing, at: currentTime, skippedEvents: this.clock.skippedEvents + this.sampleClock.skippedEvents, voices: this.synth?.voiceCount ?? 0, droppedVisualEvents: this.droppedVisualEvents });
    if (this.noteEvents.length) {
      for (const note of this.noteEvents) if (note.type === 'noteOn') note.published = true;
      this.port.postMessage({ type: 'notes', notes: this.noteEvents.map(({ published, ...note }) => note) }); this.noteEvents = [];
    }
  }
  process(_inputs, outputs) {
    if (!this.alive) return false;
    const [left, right] = outputs[0] ?? []; if (!left || !this.ready) return true;
    try {
      this.actions = [];
      this.clock.process(left.length, sampleRate);
      this.sampleClock.process(left.length, sampleRate, this.clock.tempo);
      this.automata.process(left.length, sampleRate, this.clock.tempo);
      const actions = this.actions; this.actions = null;
      actions.sort((a, b) => a.frame - b.frame);
      let cursor = 0;
      const renderTo = target => {
        while (this.noteFx.nextTime <= this.synth.currentTime + (target - cursor) / sampleRate + 1e-9) {
          const frame = Math.min(target, cursor + Math.max(0, Math.ceil((this.noteFx.nextTime - this.synth.currentTime) * sampleRate - 1e-7)));
          if (frame > cursor) this.synth.process(left, right ?? left, cursor, frame - cursor);
          cursor = frame; this.renderOffset = cursor;
          this.noteFx.advance(this.synth.currentTime + 1e-9);
        }
        if (target > cursor) this.synth.process(left, right ?? left, cursor, target - cursor);
        cursor = target; this.renderOffset = cursor;
      };
      // Native channel state is immediate. Render to each event's sample before
      // applying it, including chased controllers at loop/weave boundaries.
      // Distinct integer frame offsets bound this to at most 128 segments.
      for (const action of actions) {
        const frame = Math.max(0, Math.min(left.length - 1, Math.round(action.frame)));
        renderTo(frame); this.runAction(action);
      }
      renderTo(left.length);
      this.renderOffset = 0;
      this.telemetryFrames += left.length;
      if (this.telemetryFrames >= sampleRate / 30) { this.telemetryFrames = 0; this.publish(); }
    } catch (error) { this.actions = null; this.renderOffset = 0; this.ready = false; left.fill(0); right?.fill(0); this.port.postMessage({ type: 'error', message: error.message }); }
    return true;
  }
}
registerProcessor('morphazoid-midi-mixer', MidiMixerProcessor);
