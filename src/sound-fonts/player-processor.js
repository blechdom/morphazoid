import { SpessaSynthProcessor, SoundBankLoader, SpessaLog } from '../instruments/midi-mixer/vendor/spessasynth-core.js';

class SoundFontPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.synth = null; this.alive = true; this.ready = false; this.held = new Map();
    this.port.onmessage = ({ data }) => { void this.command(data).catch(error => this.port.postMessage({ type: 'error', message: error.message })); };
  }
  async command(message) {
    if (message.type === 'dispose') {
      this.alive = false; this.synth?.destroySynthProcessor(); this.synth = null; this.held.clear(); return;
    }
    if (message.type === 'load') {
      SpessaLog.setLogLevel(false, false, false);
      const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false });
      this.synth = synth;
      await synth.processorInitialized;
      if (!this.alive) return;
      const bank = SoundBankLoader.fromArrayBuffer(message.bytes);
      if (!bank.presets.length) throw new Error('This SoundFont contains no presets.');
      synth.soundBankManager.addSoundBank(bank, 'shared-font');
      synth.setSystemParameter('voiceCap', 64);
      synth.setSystemParameter('autoAllocateVoices', false);
      synth.midiChannels[0].reset(false);
      this.ready = true; this.port.postMessage({ type: 'ready' }); return;
    }
    if (!this.ready || !this.synth || !this.alive) return;
    const channel = this.synth.midiChannels[0];
    switch (message.type) {
      case 'preset': {
        const bank = message.bank;
        if (!Number.isInteger(bank) || bank < 0 || bank > 65535 || !Number.isInteger(message.program) || message.program < 0 || message.program > 127) return;
        // Match the loader's SF2 bank encoding, including bank LSB and GS drums.
        // Changing GS drum mode clears both banks, so do it before applying them.
        const patch = { bankMSB: bank & 127, bankLSB: bank >>> 8, program: message.program, isGMGSDrum: Boolean(bank & 128) };
        channel.setGSDrums(patch.isGMGSDrum);
        channel.setPatch(patch);
        // programChange derives percussion mode from the selected preset; this
        // also preserves XG drum aliases such as GeneralUser's melodic bank 120.
        break;
      }
      case 'on':
        if (!Number.isInteger(message.note) || message.note < 0 || message.note > 127) return;
        this.synth.noteOn(0, message.note, Math.max(0, Math.min(127, message.velocity)));
        this.held.set(message.note, this.synth.currentTime + 15); break;
      case 'off': this.synth.noteOff(0, message.note); this.held.delete(message.note); break;
      case 'stop': this.synth.stopAllChannels(true); this.held.clear(); break;
    }
  }
  process(_inputs, outputs) {
    if (!this.alive) return false;
    const [left, right] = outputs[0] ?? [];
    if (!left || !this.synth || !this.ready) return true;
    try {
      for (const [note, deadline] of this.held) if (this.synth.currentTime >= deadline) { this.synth.noteOff(0, note); this.held.delete(note); }
      this.synth.process(left, right ?? left, 0, left.length);
      for (const channel of outputs[0]) for (let i = 0; i < channel.length; i++) channel[i] = Number.isFinite(channel[i]) ? Math.max(-0.98, Math.min(0.98, channel[i])) : 0;
    } catch (error) {
      left.fill(0); right?.fill(0); this.synth.destroySynthProcessor(); this.synth = null;
      this.port.postMessage({ type: 'error', message: error.message });
    }
    return true;
  }
}
registerProcessor('morphazoid-sound-font-player', SoundFontPlayerProcessor);
