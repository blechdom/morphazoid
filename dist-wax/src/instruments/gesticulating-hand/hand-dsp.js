import { HAND_DEFAULTS, VOICE_SOURCES, clampHand, handNumber, normalizeHandConfig, createHandPose, createHandVoices, evaluateHandVoices } from "./hand-model.js";

const TAU = 2 * Math.PI;
const coefficients = (rate, seconds, depth = 1) => 1 - Math.exp(-depth / (rate * seconds));
function polyBlep(phase, step) {
  if (phase < step) { const x = phase / step; return x + x - x * x - 1; }
  if (phase > 1 - step) { const x = (phase - 1) / step; return x * x + x + x + 1; }
  return 0;
}
function noise(voice) {
  let seed = voice.seed;
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  voice.seed = seed >>> 0;
  return voice.seed / 2147483648 - 1;
}
function waveform(source, voice, random, sampleRate) {
  const phase = voice.phase * TAU, tone = voice.brightness, grain = voice.roughness;
  if (source === "glass") return (.74 * Math.sin(phase)
    + (.04 + tone * .28) * Math.sin(voice.modPhase * TAU) * (voice.frequency * 2.731 < sampleRate * .42 ? 1 : 0)
    + tone * .14 * Math.sin(phase * 4) * (voice.frequency * 4 < sampleRate * .42 ? 1 : 0)) / 1.16;
  if (source === "reed") return (.68 * Math.sin(phase + grain * .32 * Math.sin(voice.modPhase * TAU))
    + (.08 + .3 * tone) * Math.sin(phase * 2) * (voice.frequency * 2 < sampleRate * .42 ? 1 : 0)
    + tone * .16 * Math.sin(phase * 3) * (voice.frequency * 3 < sampleRate * .42 ? 1 : 0) + random * grain * .045) / 1.17;
  if (source === "wire") return (.73 * Math.sin(phase + (tone * 1.55 + grain * .7) * Math.sin(voice.modPhase * TAU))
    + tone * .19 * Math.sin(phase * 5) * (voice.frequency * 5 < sampleRate * .42 ? 1 : 0)) / .98;
  if (source === "pulse") {
    const step = voice.frequency / sampleRate, width = .17 + .54 * tone;
    const shifted = (voice.phase + 1 - width) % 1;
    const pulse = (voice.phase < width ? 1 : -1) + polyBlep(voice.phase, step) - polyBlep(shifted, step);
    // Remove the duty-cycle DC term before the common DC blocker.
    return .58 * (pulse - (width * 2 - 1)) + grain * .14 * Math.sin(voice.modPhase * TAU);
  }
  // Air is a pitched, noise-excited band, with a little voiced breath.
  return Math.tanh(voice.airBand * (2.6 + tone * 2.4)) * (.73 + grain * .17)
    + .12 * Math.sin(phase);
}

/** Five fixed voices, bounded stereo delay, no render-loop event queue.
 * Choreography is evaluated here from the audio clock, without display frames.
 */
export class HandDSP {
  constructor(sampleRate = 48000) {
    this.sampleRate = clampHand(sampleRate, 8000, 192000, 48000);
    this.config = normalizeHandConfig(HAND_DEFAULTS);
    this.enabled = false; this.soundPlaying = false; this.heldFingers = 0;
    this.playing = false; this.anchorTime = 0; this.anchorClock = 0; this.clock = 0;
    this.pose = createHandPose(); this.previousPose = createHandPose(); this.targets = createHandVoices();
    this.voices = Array.from({ length: 5 }, (_, i) => ({
      phase: .073 * i, modPhase: .137 * i, frequency: 137, brightness: .4, roughness: .1, pan: 0, level: 0,
      excitation: 0, envelope: 0, auditionUntil: -1, source: VOICE_SOURCES[i], oldSource: VOICE_SOURCES[i], sourceBlend: 1,
      seed: (0x9e3779b9 ^ (i + 1) * 0x35a89) >>> 0, airLow: 0, airBand: 0,
      filter: 0, lastInput: 0, dc: 0,
    }));
    this.smooth = coefficients(this.sampleRate, .014); this.pitchSmooth = coefficients(this.sampleRate, .009);
    this.attackCoefficient = 0; this.releaseCoefficient = 0; this.muteCoefficient = coefficients(this.sampleRate, .025, 6.9);
    this.delayLeft = new Float32Array(Math.ceil(this.sampleRate * .41));
    this.delayRight = new Float32Array(Math.ceil(this.sampleRate * .41));
    this.delayWrite = 0; this.space = 0; this.voiceLevels = new Float32Array(5); this.peak = 0; this.rms = 0;
    this.setConfig(this.config);
    this.updateTargets(0); // Warm source sampler storage before the audio callback.
  }
  setConfig(value) {
    this.config = normalizeHandConfig(value);
    this.attackCoefficient = coefficients(this.sampleRate, this.config.sound.attack, 4.6);
    this.releaseCoefficient = coefficients(this.sampleRate, this.config.sound.release, 6.9);
  }
  setEnabled(enabled) {
    this.enabled = enabled === true;
    if (!this.enabled) for (const voice of this.voices) voice.auditionUntil = -1;
  }
  setSoundPlaying(playing) { this.soundPlaying = playing === true; }
  setHeldFingers(mask) { this.heldFingers = Math.round(clampHand(mask, 0, 31)); }
  setTransport(value = {}, at = this.clock) {
    const time = this.getMotionTime(at);
    this.anchorClock = clampHand(at, 0, 1e9, this.clock);
    this.anchorTime = clampHand(value?.time, 0, 1e9, time);
    if (typeof value?.playing === "boolean") this.playing = value.playing;
  }
  getMotionTime(at = this.clock) { return this.anchorTime + (this.playing ? Math.max(0, handNumber(at, this.clock) - this.anchorClock) : 0); }
  auditionFinger(index, seconds = .18, at = this.clock) {
    if (!this.enabled || !Number.isInteger(index) || index < 0 || index >= 5) return false;
    this.voices[index].auditionUntil = clampHand(at, 0, 1e9, this.clock) + clampHand(seconds, .015, 2, .18);
    return true;
  }
  updateTargets(at) {
    evaluateHandVoices(this.config, this.getMotionTime(at), this.targets, this.pose, this.previousPose);
    for (let i = 0; i < 5; i++) {
      const voice = this.voices[i], target = this.targets[i];
      if (target.source !== voice.source) { voice.oldSource = voice.source; voice.source = target.source; voice.sourceBlend = 0; }
      if (!this.playing) target.excitation = 0;
      target.frequency = Math.min(target.frequency, this.sampleRate * .17);
    }
  }
  reset() {
    for (let i = 0; i < 5; i++) {
      const voice = this.voices[i];
      voice.envelope = 0; voice.auditionUntil = -1; voice.filter = 0; voice.lastInput = 0; voice.dc = 0;
      voice.airLow = 0; voice.airBand = 0; voice.level = 0; this.voiceLevels[i] = 0;
    }
    this.delayLeft.fill(0); this.delayRight.fill(0); this.peak = this.rms = 0;
  }
  process(left, right = left, audioTime = this.clock) {
    if (!left?.length) return;
    const rate = this.sampleRate, now = clampHand(audioTime, 0, 1e9, this.clock);
    const stereo = right !== left, frames = Math.min(left.length, right?.length ?? left.length);
    const delayL = Math.round(rate * .173), delayR = Math.round(rate * .239), delaySize = this.delayLeft.length;
    let energy = 0, peak = 0;
    for (let frame = 0; frame < frames; frame++) {
      const at = now + frame / rate;
      if ((frame & 31) === 0) this.updateTargets(at);
      let mixLeft = 0, mixRight = 0;
      for (let i = 0; i < 5; i++) {
        const voice = this.voices[i], target = this.targets[i];
        voice.frequency += (target.frequency - voice.frequency) * this.pitchSmooth;
        voice.brightness += (target.brightness - voice.brightness) * this.smooth;
        voice.roughness += (target.roughness - voice.roughness) * this.smooth;
        voice.pan += (target.pan - voice.pan) * this.smooth;
        voice.level += (target.level - voice.level) * this.smooth;
        voice.excitation += (target.excitation - voice.excitation) * this.smooth;
        const gated = this.enabled && (this.soundPlaying || (this.heldFingers & (1 << i)) !== 0 || at < voice.auditionUntil);
        const envelopeTarget = gated ? 1 : 0;
        const coefficient = !this.enabled ? this.muteCoefficient : gated ? this.attackCoefficient : this.releaseCoefficient;
        voice.envelope += (envelopeTarget - voice.envelope) * coefficient;
        if (voice.envelope < 1e-8) voice.envelope = 0;
        voice.phase = (voice.phase + voice.frequency / rate) % 1;
        voice.modPhase = (voice.modPhase + voice.frequency * 2.731 / rate) % 1;
        const random = noise(voice);
        const airCoefficient = 2 * Math.sin(Math.PI * Math.min(rate * .11, voice.frequency * (1.2 + voice.brightness * 1.6)) / rate);
        voice.airLow += airCoefficient * voice.airBand;
        voice.airBand += airCoefficient * (random - voice.airLow - (1.25 - voice.roughness * .4) * voice.airBand);
        let raw = waveform(voice.source, voice, random, rate);
        if (voice.sourceBlend < .9999) {
          const old = waveform(voice.oldSource, voice, random, rate);
          voice.sourceBlend += (1 - voice.sourceBlend) * this.smooth;
          raw = old + (raw - old) * voice.sourceBlend;
        }
        const cutoff = Math.min(rate * .35, voice.frequency * (1.9 + 10 * voice.brightness));
        voice.filter += (raw - voice.filter) * (1 - Math.exp(-TAU * cutoff / rate));
        const dc = voice.filter - voice.lastInput + .995 * voice.dc;
        voice.lastInput = voice.filter; voice.dc = dc;
        const activity = .45 + voice.excitation * .55;
        const amplitude = voice.envelope * voice.level * activity * .16;
        this.voiceLevels[i] = voice.envelope * voice.level * activity;
        const sample = dc * amplitude;
        const angle = (voice.pan + 1) * Math.PI / 4;
        mixLeft += sample * Math.cos(angle); mixRight += sample * Math.sin(angle);
      }
      this.space += ((this.enabled ? this.config.sound.space : 0) - this.space) * this.smooth;
      const readL = (this.delayWrite - delayL + delaySize) % delaySize;
      const readR = (this.delayWrite - delayR + delaySize) % delaySize;
      const wetL = this.delayLeft[readL], wetR = this.delayRight[readR];
      // Feedback is fixed below unity; Space changes audible wetness and input.
      this.delayLeft[this.delayWrite] = mixLeft * this.space + wetR * .36;
      this.delayRight[this.delayWrite] = mixRight * this.space + wetL * .36;
      this.delayWrite = (this.delayWrite + 1) % delaySize;
      const outL = .82 * Math.tanh((mixLeft + wetL * this.space * .7) / .82);
      const outR = .82 * Math.tanh((mixRight + wetR * this.space * .7) / .82);
      left[frame] = stereo ? outL : (outL + outR) * .70710678;
      if (stereo) right[frame] = outR;
      energy += (outL * outL + outR * outR) * .5; peak = Math.max(peak, Math.abs(outL), Math.abs(outR));
    }
    this.clock = now + frames / rate; this.rms = Math.sqrt(energy / frames); this.peak = peak;
  }
}
