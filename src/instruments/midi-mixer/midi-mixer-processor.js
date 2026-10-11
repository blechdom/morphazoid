import { SpessaSynthProcessor, SoundBankLoader, SpessaLog } from './vendor/spessasynth-core.js';
import { MidiMixerClock, lowerBound, mixerLoopBounds } from './midi-mixer-clock.js';

/** SoundFont and both sequencers live on this single audio thread and clock. */
class MidiMixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.alive = true; this.ready = false; this.synth = null; this.telemetryFrames = 0;
    this.deckChannels = [new Map(), new Map()]; this.channelSettings = [[], []]; this.deckConfigs = [null, null];
    this.crossfade = 0; this.noteEvents = []; this.droppedVisualEvents = 0; this.renderTime = 0;
    this.clock = new MidiMixerClock({
      emit: (deck, event, frame) => this.emit(deck, event, frame),
      release: (deck, frame = 0) => this.release(deck, frame),
      restore: (deck, controllers, beat) => this.restore(deck, controllers, beat),
      configure: (deck, config, channels) => this.configure(deck, config, channels),
    });
    this.port.onmessage = ({ data }) => { void this.command(data).catch(error => this.port.postMessage({ type: 'error', message: error.message })); };
  }
  async command(message) {
    if (message.type === 'dispose') { this.alive = false; this.synth?.destroySynthProcessor(); this.synth = null; return; }
    if (message.type === 'initialize') {
      SpessaLog.setLogLevel(false, false, false);
      const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false }); this.synth = synth;
      await synth.processorInitialized;
      if (!this.alive) return;
      synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(message.soundfont), 'midi-mixer');
      synth.setSystemParameter('voiceCap', 192);
      synth.setSystemParameter('autoAllocateVoices', false);
      while (synth.midiChannels.length < 128) synth.createMIDIChannel();
      this.ready = true; this.port.postMessage({ type: 'ready' }); return;
    }
    if (!this.ready) return;
    switch (message.type) {
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
          this.synth.stopAllChannels(true); this.synth.soundBankManager.addSoundBank(bank, 'midi-mixer');
          for (let i = 0; i < 2; i++) this.clock.resync(i);
          this.port.postMessage({ type: 'soundfont', token: message.token });
        } catch (error) { this.port.postMessage({ type: 'soundfont', token: message.token, error: error.message }); }
        break;
      }
      case 'transport': this.clock.setTransport(message.playing, message.beat); break;
      case 'tempo': this.clock.tempo = Math.max(30, Math.min(300, message.tempo)); break;
      case 'deck': this.clock.setDeck(message.index, message.config, message.channels); break;
      case 'crossfade':
        this.crossfade = Math.max(-1, Math.min(1, message.value));
        for (let i = 0; i < 2; i++) if (this.deckConfigs[i]) this.configure(i, this.deckConfigs[i], this.channelSettings[i]);
        break;
      case 'release': this.synth.stopAllChannels(true); this.noteEvents.length = 0; break;
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
    if (!restoring && event.kind === 9 && !this.synth.midiChannels[channel].systemParameters.isMuted) {
      if (this.noteEvents.length < 256) this.noteEvents.push({ deck, channel: event.channel, note: event.a + (event.channel % 16 === 9 ? 0 : this.deckConfigs[deck]?.transpose ?? 0), velocity: event.b, beat: event.beat, at: currentTime + frame / sampleRate });
      else this.droppedVisualEvents++;
    }
  }
  release(deck, frame = 0) {
    if (!this.synth) return;
    for (const channel of this.deckChannels[deck].values()) {
      const status = 0xb0 | channel % 16, offset = channel - channel % 16;
      this.synth.processMessage([status, 64, 0], offset, { time: this.synth.currentTime + frame / sampleRate });
      this.synth.processMessage([status, 123, 0], offset, { time: this.synth.currentTime + frame / sampleRate });
    }
  }
  restore(deck, controllers, beat) {
    for (const channel of this.deckChannels[deck].values()) {
      const midi = this.synth.midiChannels[channel]; midi.setSystemParameter('presetLock', false);
      this.synth.controllerChange(channel, 121, 0); this.synth.controllerChange(channel, 0, 0); this.synth.controllerChange(channel, 32, 0);
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
    const balance = deck === 0 ? Math.cos((this.crossfade + 1) * Math.PI / 4) : Math.sin((this.crossfade + 1) * Math.PI / 4);
    for (const setting of channels) {
      const index = this.deckChannels[deck].get(setting.channel), channel = this.synth.midiChannels[index]; if (!channel) continue;
      channel.setSystemParameter('isMuted', config.mute || setting.mute || solo && !setting.solo);
      channel.setSystemParameter('gain', config.gain * balance);
      channel.setSystemParameter('keyShift', setting.channel % 16 === 9 ? 0 : config.transpose);
      channel.setSystemParameter('presetLock', false);
      if (setting.program !== null && setting.program !== undefined) {
        this.synth.controllerChange(index, 0, 0); this.synth.controllerChange(index, 32, 0);
        this.synth.programChange(index, setting.program); channel.setSystemParameter('presetLock', true);
      } else if (previous.find(item => item.channel === setting.channel)?.program != null) {
        const data = this.clock.decks[deck], rawBeat = this.clock.beat + config.offsetBeats;
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
    this.port.postMessage({ type: 'state', beat: this.clock.beat, tempo: this.clock.tempo, playing: this.clock.playing, at: currentTime, skippedEvents: this.clock.skippedEvents, voices: this.synth?.voiceCount ?? 0, droppedVisualEvents: this.droppedVisualEvents });
    if (this.noteEvents.length) { this.port.postMessage({ type: 'notes', notes: this.noteEvents }); this.noteEvents = []; }
  }
  process(_inputs, outputs) {
    if (!this.alive) return false;
    const [left, right] = outputs[0] ?? []; if (!left || !this.ready) return true;
    try {
      this.clock.process(left.length, sampleRate);
      this.synth.process(left, right ?? left);
      this.telemetryFrames += left.length;
      if (this.telemetryFrames >= sampleRate / 30) { this.telemetryFrames = 0; this.publish(); }
    } catch (error) { this.ready = false; left.fill(0); right?.fill(0); this.port.postMessage({ type: 'error', message: error.message }); }
    return true;
  }
}
registerProcessor('morphazoid-midi-mixer', MidiMixerProcessor);
