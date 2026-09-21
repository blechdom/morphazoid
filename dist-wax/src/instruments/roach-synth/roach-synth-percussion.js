// Short articulated instruments, not a periodic sequencer. Contacts or actual
// joint displacement strike these fixed voices. FM pitch/index decay follows
// fm-drums.js and Rattlesnake's linear-drums.js; the lossy fractional string
// adapts karplus-strong.js. These are cartoon/physical synthesis proxies.
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class RoachPercussion {
  constructor(rate, legs = false) {
    this.rate = rate; this.legs = legs; this.manualSlot = legs ? 6 : 0;
    this.slots = Array.from({ length: legs ? 8 : 2 }, (_, index) => ({
      envelopes: new Float64Array(6), age: 0, phase: .0, modPhase: .17, tone2: 0, tone3: 0,
      ratio: [.83, 1.12, .94, 1.24, 1.04, 1.34, 1, 1.17][index],
      line: new Float32Array(2048), cursor: 0, filledFrames: 0, low: 0, dc: 0,
      burst: 0, releasing: false, rattleLow: 0, rattleBand: 0,
    }));
    this.decays = new Float64Array(6); this.output = new Float64Array(6);
    this.release = Math.exp(-1 / (rate * .012)); this.burstDecay = Math.exp(-1 / (rate * .002));
    this.cooldown = 0; this.events = 0; this.running = false;
    this.frequency = 220; this.brightness = .4; this.resonance = .4; this.rhythm = 1; this.vowel = .35;
    this.configure(140, .4, .4, 1, .35);
  }
  configure(frequency, brightness, resonance, rhythm, vowel) {
    this.frequency = clamp(frequency, 30, this.rate * .1); this.brightness = brightness;
    this.resonance = resonance; this.rhythm = rhythm; this.vowel = vowel;
    this.decays[0] = Math.exp(-1 / (this.rate * (.024 + resonance * .032)));
    this.decays[1] = Math.exp(-1 / (this.rate * (.032 + resonance * .065)));
    this.decays[2] = Math.exp(-1 / (this.rate * (.042 + resonance * .055)));
    this.decays[3] = Math.exp(-1 / (this.rate * (.052 + resonance * .11)));
    this.decays[4] = Math.exp(-1 / (this.rate * .0032));
    this.decays[5] = Math.exp(-1 / (this.rate * (.009 + resonance * .013)));
  }
  strike(strength, foot = -1) {
    if (!(strength > 0)) return;
    if (foot < 0 && this.cooldown > 0) return;
    const index = this.legs && foot >= 0 ? Math.min(5, foot) : this.manualSlot;
    const voice = this.slots[index]; const amount = clamp(strength, 0, 1);
    // New attacks start from zero phase only once their previous tail is gone.
    // Dense strikes accumulate bounded envelopes, without stealing a live tone.
    if (voice.envelopes[0] < 1e-5) { voice.phase = 0; voice.modPhase = .17; }
    for (let i = 0; i < 6; i += 1) voice.envelopes[i] = Math.min(1.25, voice.envelopes[i] + amount);
    voice.age = 0; voice.burst = Math.min(1, voice.burst + amount); voice.releasing = false;
    if (foot < 0) { this.manualSlot = (this.legs ? 6 : 0) + (1 - (this.manualSlot % 2)); this.cooldown = Math.round(this.rate * .055); }
    this.events += 1; this.running = true;
  }
  releaseAll() { for (const voice of this.slots) voice.releasing = true; }
  clear() {
    for (const voice of this.slots) {
      voice.envelopes.fill(0); voice.burst = 0; voice.cursor = 0; voice.filledFrames = 0;
      voice.low = 0; voice.dc = 0; voice.rattleLow = 0; voice.rattleBand = 0;
    }
    this.output.fill(0); this.running = false; this.cooldown = 0;
  }
  sample(noise, source, previousSource = source) {
    this.output.fill(0); if (this.cooldown > 0) this.cooldown -= 1;
    for (const voice of this.slots) {
      const env = voice.envelopes;
      if (Math.max(env[0], env[1], env[2], env[3], env[4], env[5]) < 1e-12) { env.fill(0); continue; }
      const age = voice.age++ / this.rate;
      const attack = Math.min(1, age / .0018);
      const base = clamp(this.frequency * 2.4 * voice.ratio, 65, this.rate * .085);
      const pitchDrop = 1 + env[0] * .72;
      voice.phase = (voice.phase + base * pitchDrop / this.rate) % 1;
      voice.modPhase = (voice.modPhase + base * (1.37 + this.vowel * 3.1) / this.rate) % 1;
      if (source === 0 || previousSource === 0) {
        // Rounded sole impact, slight pitch fall, and only a tiny friction edge.
        this.output[0] += (Math.sin(TAU * voice.phase) * .33 + noise * voice.burst * .012) * env[0] * attack;
      }
      if (source === 1 || previousSource === 1) {
        const index = (.7 + this.brightness * 5.2) * Math.min(1, env[1] * 4);
        this.output[1] += Math.sin(TAU * voice.phase + Math.sin(TAU * voice.modPhase) * index) * env[1] * attack * .25;
      }
      if (source === 2 || previousSource === 2) {
        // Rattlesnake-style modal/FM body plus a short seed-shell collision
        // cluster; low pitches remain drums, while high poses reveal more air.
        // Internal rattle rate never produces a fresh event after the envelope.
        const coefficient = clamp(TAU * (720 + base * 2.3) / this.rate, .015, .75);
        const collisions = .18 + .82 * Math.max(0, Math.sin(TAU * age * (27 + this.rhythm * 24)));
        const high = noise * collisions - voice.rattleLow - voice.rattleBand * .7;
        voice.rattleBand += coefficient * high; voice.rattleLow += coefficient * voice.rattleBand;
        voice.tone2 = (voice.tone2 + base * 1.57 / this.rate) % 1;
        voice.tone3 = (voice.tone3 + base * 2.83 / this.rate) % 1;
        const air = clamp((base - 220) / 1700 + this.brightness * .2, .08, .72);
        const body = Math.sin(TAU * voice.phase + Math.sin(TAU * voice.modPhase) * env[2] * .6) * .17
          + Math.sin(TAU * voice.tone2) * .085 + Math.sin(TAU * voice.tone3) * .05;
        this.output[2] += (voice.rattleBand * air * .28 + body * (1 - air * .5)) * env[2] * attack;
      }
      if (source === 3 || previousSource === 3) {
        const period = clamp(this.rate / base, 3, 2045);
        let read = voice.cursor - period; if (read < 0) read += 2048;
        const index = Math.floor(read); const fraction = read - index;
        // A cleared voice never reads a previous strike's stale delay memory.
        // The validity length avoids clearing whole delay arrays on audio time.
        const delayed = voice.filledFrames > Math.ceil(period) + 1
          ? voice.line[index] * (1 - fraction) + voice.line[(index + 1) & 2047] * fraction : 0;
        voice.low += (delayed - voice.low) * (.22 + this.brightness * .54);
        voice.dc += (voice.low - voice.dc) * .003;
        const pickPhase = age * base;
        const pick = pickPhase < 1 ? (Math.sin(TAU * pickPhase) * .68 + noise * .16) * Math.sin(Math.PI * pickPhase) * env[3] : 0;
        voice.line[voice.cursor] = Math.tanh((voice.low - voice.dc) * (.76 + this.resonance * .2) + pick + noise * voice.burst * .045);
        voice.cursor = (voice.cursor + 1) & 2047;
        voice.filledFrames = Math.min(2048, voice.filledFrames + 1);
        // Strike strength is already in the excitation. Avoid multiplying two
        // velocity envelopes and making ordinary real contacts nearly silent.
        this.output[3] += (delayed - voice.dc) * Math.min(1, env[3] * 6) * .9;
      }
      if (source === 4 || previousSource === 4) {
        voice.tone2 = (voice.tone2 + Math.min(this.rate * .35, 1000 + base * 3) / this.rate) % 1;
        this.output[4] += (Math.sin(TAU * voice.tone2) * .34 + noise * .055) * env[4] * Math.min(1, age / .00035);
      }
      if (source === 5 || previousSource === 5) {
        voice.tone2 = (voice.tone2 + Math.min(this.rate * .24, base * 3.2) / this.rate) % 1;
        voice.tone3 = (voice.tone3 + Math.min(this.rate * .36, base * 7.3) / this.rate) % 1;
        this.output[5] += (Math.sin(TAU * voice.tone2) * .32 + Math.sin(TAU * voice.tone3) * .11 + noise * voice.burst * .025)
          * env[5] * Math.min(1, age / .0007);
      }
      voice.burst *= this.burstDecay;
      for (let i = 0; i < 6; i += 1) env[i] *= voice.releasing ? this.release : this.decays[i];
    }
    return this.output;
  }
}
