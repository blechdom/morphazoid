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
const METAL_RATIOS = Object.freeze([1, 2.756, 5.404, 8.933, 13.34]);
function createEngines(rate) {
  return {
    bow: { buffer: new Float32Array(Math.ceil(rate / 25) + 4), write: 0, low: 0 },
    vowel: Array.from({ length: 3 }, () => ({ ic1: 0, ic2: 0, a1: 0, a2: 0, a3: 0, damping: .2 })),
    metal: { modes: METAL_RATIOS.map(() => ({ re: 0, im: 0, c: 1, s: 0, radius: 0, gain: 0 })),
      distance: 0, pending: 0, wasGated: false },
  };
}
function resetEngine(voice, source) {
  if (source === "bowed") { voice.bow.buffer.fill(0); voice.bow.write = 0; voice.bow.low = 0; }
  if (source === "vowel") for (const mode of voice.vowel) mode.ic1 = mode.ic2 = 0;
  if (source === "metal") {
    for (const mode of voice.metal.modes) mode.re = mode.im = 0;
    voice.metal.distance = voice.metal.pending = 0; voice.metal.wasGated = false;
  }
}
// Control-rate coefficients feed stable TPT formants and damped complex modes.
// Every oscillator/filter is kept below Nyquist, including at an 8 kHz rate.
function tuneEngines(voice, rate) {
  const tone = voice.brightness, grain = voice.roughness;
  for (let i = 0; i < 3; i++) {
    // A continuous oo -> ah -> ee trajectory, independent of the finger pitch.
    const position = tone < .5 ? tone * 2 : (tone - .5) * 2;
    const start = tone < .5 ? (i === 0 ? 300 : i === 1 ? 800 : 2300) : (i === 0 ? 750 : i === 1 ? 1200 : 2700);
    const end = tone < .5 ? (i === 0 ? 750 : i === 1 ? 1200 : 2700) : (i === 0 ? 300 : i === 1 ? 2350 : 3100);
    const frequency = Math.min(rate * .38, start + (end - start) * position);
    const mode = voice.vowel[i], g = Math.tan(Math.PI * frequency / rate);
    mode.damping = .12 + grain * .16 + i * .025;
    mode.a1 = 1 / (1 + g * (g + mode.damping)); mode.a2 = g * mode.a1; mode.a3 = g * mode.a2;
  }
  for (let i = 0; i < METAL_RATIOS.length; i++) {
    const mode = voice.metal.modes[i], frequency = voice.frequency * METAL_RATIOS[i];
    const angle = TAU * Math.min(rate * .43, frequency) / rate;
    mode.c = Math.cos(angle); mode.s = Math.sin(angle);
    mode.radius = Math.exp(-1 / (rate * (.14 + (1 - grain) * .9) / (1 + i * .63)));
    // Fade the highest modes before Nyquist instead of folding or pinning them.
    const audible = Math.max(0, Math.min(1, (rate * .44 - frequency) / (rate * .07)));
    mode.gain = audible * (i === 0 ? .63 : (.15 + tone * .8) / (1 + i * .6));
  }
}
function bowed(voice, random, rate) {
  const bow = voice.bow, tone = voice.brightness, grain = voice.roughness;
  const step = voice.frequency / rate;
  const saw = 2 * voice.phase - 1 - polyBlep(voice.phase, step);
  // Synthetic friction-like excitation driving a damped fractional string loop;
  // an expressive bow approximation, not a validated bow/string simulation.
  const pressure = .24 + tone * .4 + voice.excitation * .36;
  const exciter = (saw * (.52 + pressure * .34) + random * grain * (.016 + pressure * .075)) * (voice.gated ? 1 : 0);
  const delay = Math.max(3, Math.min(bow.buffer.length - 2, rate / voice.frequency - .5));
  const read = (bow.write - delay + bow.buffer.length) % bow.buffer.length;
  const index = Math.floor(read), fraction = read - index;
  const delayed = bow.buffer[index] + (bow.buffer[(index + 1) % bow.buffer.length] - bow.buffer[index]) * fraction;
  const returning = (delayed + bow.low) * .5; bow.low = delayed;
  const feedback = Math.exp(-1 / (voice.frequency * (.12 + pressure * .23)));
  const next = returning * feedback + exciter * (1 - feedback);
  bow.buffer[bow.write] = next; bow.write = (bow.write + 1) % bow.buffer.length;
  return next * 1.22 + exciter * (.12 + grain * .13);
}
function vowel(voice, random, rate) {
  const step = voice.frequency / rate;
  const saw = 2 * voice.phase - 1 - polyBlep(voice.phase, step);
  const source = saw * (.86 - voice.roughness * .25) + random * voice.roughness * .18;
  let output = 0;
  for (let i = 0; i < 3; i++) {
    const mode = voice.vowel[i], v3 = source - mode.ic2;
    const v1 = mode.a1 * mode.ic1 + mode.a2 * v3;
    const v2 = mode.ic2 + mode.a2 * mode.ic1 + mode.a3 * v3;
    mode.ic1 = 2 * v1 - mode.ic1; mode.ic2 = 2 * v2 - mode.ic2;
    output += v1 * mode.damping * (i === 0 ? 1.5 : i === 1 ? 1.1 : .62);
  }
  return Math.tanh(output * 2.1) * .88 + .055 * Math.sin(voice.phase * TAU);
}
function metal(voice, rate) {
  const metal = voice.metal, gated = voice.gated;
  let strike = 0;
  if (gated) {
    if (!metal.wasGated) strike = .7;
    strike = Math.max(strike, metal.pending);
    // Joint travel, rather than a second free-running beat clock, owns strikes.
    metal.distance += voice.excitation * 14 / rate;
    if (metal.distance >= 1) { metal.distance -= 1; strike = Math.max(strike, .24 + voice.excitation * .64); }
  }
  metal.wasGated = gated; metal.pending = 0;
  let output = 0;
  for (const mode of metal.modes) {
    const re = mode.re;
    mode.re = (re * mode.c - mode.im * mode.s) * mode.radius + strike;
    mode.im = (re * mode.s + mode.im * mode.c) * mode.radius;
    if (Math.abs(mode.re) < 1e-20) mode.re = 0;
    if (Math.abs(mode.im) < 1e-20) mode.im = 0;
    output += mode.im * mode.gain;
  }
  return Math.tanh(output * .9);
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
  if (source === "bowed") return bowed(voice, random, sampleRate);
  if (source === "vowel") return vowel(voice, random, sampleRate);
  if (source === "metal") return metal(voice, sampleRate);
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
    this.playing = false; this.anchorTime = 0; this.anchorClock = 0; this.clock = 0; this.tremorOffset = 0;
    this.pose = createHandPose(); this.previousPose = createHandPose(); this.targets = createHandVoices();
    this.voices = Array.from({ length: 5 }, (_, i) => ({
      phase: .073 * i, modPhase: .137 * i, frequency: 137, brightness: .4, roughness: .1, pan: 0, level: 0,
      excitation: 0, envelope: 0, auditionUntil: -1, source: VOICE_SOURCES[i], sourceIndex: i, sourceWeights: Float64Array.from(VOICE_SOURCES, (_, j) => i === j ? 1 : 0),
      seed: (0x9e3779b9 ^ (i + 1) * 0x35a89) >>> 0, airLow: 0, airBand: 0,
      filter: 0, lastInput: 0, dc: 0, cutoff: 1000, gated: false, ...createEngines(this.sampleRate),
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
    if (!this.enabled) for (const voice of this.voices) { voice.auditionUntil = -1; voice.metal.pending = 0; }
  }
  setSoundPlaying(playing) { this.soundPlaying = playing === true; }
  setHeldFingers(mask) {
    const next = Math.round(clampHand(mask, 0, 31)), rising = next & ~this.heldFingers;
    for (let i = 0; i < 5; i++) if (rising & (1 << i)) this.voices[i].metal.pending = .7;
    this.heldFingers = next;
  }
  setTransport(value = {}, at = this.clock) {
    const time = this.getMotionTime(at);
    this.anchorClock = clampHand(at, 0, 1e9, this.clock);
    this.anchorTime = clampHand(value?.time, 0, 1e9, time);
    this.tremorOffset = clampHand(value?.tremorOffset, -1e9, 1e9, this.tremorOffset);
    if (typeof value?.playing === "boolean") this.playing = value.playing;
  }
  getMotionTime(at = this.clock) { return this.anchorTime + (this.playing ? Math.max(0, handNumber(at, this.clock) - this.anchorClock) : 0); }
  auditionFinger(index, seconds = .18, at = this.clock) {
    if (!this.enabled || !Number.isInteger(index) || index < 0 || index >= 5) return false;
    this.voices[index].auditionUntil = clampHand(at, 0, 1e9, this.clock) + clampHand(seconds, .015, 2, .18);
    this.voices[index].metal.pending = .68;
    return true;
  }
  updateTargets(at) {
    const time = this.getMotionTime(at);
    evaluateHandVoices(this.config, time, this.targets, this.pose, this.previousPose, time + this.tremorOffset);
    for (let i = 0; i < 5; i++) {
      const voice = this.voices[i], target = this.targets[i];
      if (target.source !== voice.source) {
        voice.source = target.source; voice.sourceIndex = VOICE_SOURCES.indexOf(target.source);
        if (voice.sourceWeights[voice.sourceIndex] === 0) resetEngine(voice, target.source);
      }
      tuneEngines(voice, this.sampleRate);
      if (!this.playing) target.excitation = 0;
      target.frequency = Math.min(target.frequency, this.sampleRate * .17);
    }
  }
  reset() {
    this.updateTargets(this.clock);
    for (let i = 0; i < 5; i++) {
      const voice = this.voices[i], target = this.targets[i];
      voice.envelope = 0; voice.auditionUntil = -1; voice.filter = 0; voice.lastInput = 0; voice.dc = 0;
      voice.airLow = 0; voice.airBand = 0; voice.level = 0; voice.gated = false; this.voiceLevels[i] = 0;
      voice.phase = .073 * i; voice.modPhase = .137 * i;
      voice.seed = (0x9e3779b9 ^ (i + 1) * 0x35a89) >>> 0;
      voice.frequency = target.frequency; voice.brightness = target.brightness; voice.roughness = target.roughness;
      voice.pan = target.pan; voice.excitation = 0; voice.cutoff = 1000;
      voice.sourceWeights.fill(0); voice.sourceWeights[voice.sourceIndex] = 1;
      resetEngine(voice, "bowed"); resetEngine(voice, "vowel"); resetEngine(voice, "metal");
      tuneEngines(voice, this.sampleRate);
    }
    this.delayLeft.fill(0); this.delayRight.fill(0); this.delayWrite = 0; this.space = 0; this.peak = this.rms = 0;
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
        voice.gated = gated;
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
        let raw = 0, cutoff = 0;
        // A persistent mixture preserves every fading source during rapid edits.
        // Each active stateful engine advances exactly once per output sample.
        for (let source = 0; source < VOICE_SOURCES.length; source++) {
          const selected = source === voice.sourceIndex;
          let weight = voice.sourceWeights[source];
          weight += ((selected ? 1 : 0) - weight) * this.smooth;
          if (!selected && weight < 1e-7) weight = 0;
          voice.sourceWeights[source] = weight;
          if (weight === 0) continue;
          const id = VOICE_SOURCES[source];
          raw += waveform(id, voice, random, rate) * weight;
          cutoff += weight * (id === "vowel" ? 1700 + voice.brightness * 4600
            : voice.frequency * (id === "metal" ? 4 + 16 * voice.brightness : 1.9 + 10 * voice.brightness));
        }
        voice.cutoff += (Math.min(rate * .35, cutoff) - voice.cutoff) * this.smooth;
        voice.filter += (raw - voice.filter) * (1 - Math.exp(-TAU * voice.cutoff / rate));
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
