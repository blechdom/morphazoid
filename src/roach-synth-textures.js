// Small, fixed-budget textures for Roach Synth. The fractional delay and lossy
// feedback adapt karplus-strong.js / SIMD Resonator's waveguide; alternating
// polarity and noninteger periods give a short wire rasp, not a tuned mallet.
// This implementation is scalar JavaScript, not a SIMD/WASM execution claim.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const SAMPLE_IDS = ['vivarium_scuttle', 'vivarium_rustle', 'vivarium_contact'];
const MAX_RECORDINGS = 3;
const MAX_SAMPLE_VOICES = 6;

export class RoachZing {
  constructor(sampleRate) {
    this.rate = sampleRate;
    this.size = 4096; this.mask = this.size - 1; this.cursor = 0;
    this.lines = [new Float32Array(this.size), new Float32Array(this.size)];
    this.low = new Float64Array(2); this.dc = new Float64Array(2);
    this.periods = new Float64Array([41, 63]);
    this.feedback = .88; this.damping = .5; this.burst = 0; this.energy = 0;
    this.burstDecay = Math.exp(-1 / (sampleRate * .0045));
    this.energyDecay = Math.exp(-1 / (sampleRate * .046));
  }
  tune(pitch, brightness, resonance, shape) {
    const frequency = 290 + pitch * 1.7 + shape * 170;
    this.periods[0] = clamp(this.rate / frequency, 3, this.size - 3);
    this.periods[1] = clamp(this.rate / (frequency * 1.437), 3, this.size - 3);
    this.feedback = .72 + resonance * .22; // Strictly < 1 even at hostile limits.
    this.damping = .24 + brightness * .56;
  }
  excite(strength) {
    this.burst = Math.min(1, this.burst + strength * .65);
    this.energy = Math.min(1, this.energy + strength);
  }
  sample(noise, friction) {
    this.burst *= this.burstDecay; this.energy *= this.energyDecay;
    const excitation = noise * (this.burst * .7 + friction * .065);
    let output = 0;
    for (let i = 0; i < 2; i += 1) {
      let read = this.cursor - this.periods[i];
      if (read < 0) read += this.size;
      const index = Math.floor(read); const fraction = read - index;
      const line = this.lines[i];
      const delayed = line[index] * (1 - fraction) + line[(index + 1) & this.mask] * fraction;
      this.low[i] += (delayed - this.low[i]) * this.damping;
      this.dc[i] += (this.low[i] - this.dc[i]) * .006;
      // The odd branch inverts at its boundary. Noise contacts repeatedly
      // disturb both loops, avoiding a long musical string note after each foot.
      const feedback = (this.low[i] - this.dc[i]) * this.feedback * (i ? -1 : 1);
      line[this.cursor] = Math.tanh(feedback + excitation * (i ? -.71 : 1));
      output += (delayed - this.dc[i]) * (i ? .8 : 1);
    }
    this.cursor = (this.cursor + 1) & this.mask;
    return output;
  }
}

export class RoachRecordingGrains {
  constructor(sampleRate) {
    this.rate = sampleRate; this.bank = []; this.events = 0; this.cooldown = 0;
    this.voices = Array.from({ length: MAX_SAMPLE_VOICES }, () => ({
      recording: null, position: 0, increment: 1, age: 0, frames: 0, gain: 0,
    }));
  }
  setBank(source, { transferred = false } = {}) {
    if (!Array.isArray(source) || source.length > MAX_RECORDINGS) throw new Error('Roach recordings exceed the three-source budget.');
    // Metadata validation is O(3 + 64 cues). The processor adopts buffers that
    // the main thread sanitized and transferred: copying 456k floats here would
    // block many audio quanta. Direct/offline callers get defensive copies.
    // No buffers/voices are allocated by trigger() or sample().
    const bank = source.map((item) => {
      const rate = Number(item?.sampleRate);
      if (!SAMPLE_IDS.includes(item?.id) || !(item?.data instanceof Float32Array)
        || !Number.isFinite(rate) || rate < 8000 || rate > 192000
        || item.data.length < 2 || item.data.length > Math.floor(rate * 8)) {
        throw new Error('Invalid or oversized Roach recording.');
      }
      const data = transferred ? item.data : Float32Array.from(item.data, (value) => Number.isFinite(value) ? clamp(value, -1, 1) : 0);
      const cues = Array.isArray(item.cues) ? item.cues.slice(0, 64).filter((cue) => Number.isFinite(cue) && cue >= 0 && cue < data.length / rate) : [];
      return { id: item.id, data, sampleRate: rate, cues };
    });
    if (new Set(bank.map(({ id }) => id)).size !== bank.length) throw new Error('Duplicate Roach recording ID.');
    this.bank = bank;
    for (const voice of this.voices) voice.recording = null;
  }
  trigger(kind, strength, variation) {
    if (this.cooldown > 0 || !this.bank.length || strength <= 0) return;
    let recording = this.bank[0];
    for (let i = 0; i < this.bank.length; i += 1) if (this.bank[i].id === SAMPLE_IDS[kind]) recording = this.bank[i];
    let voice = null;
    for (let i = 0; i < this.voices.length; i += 1) {
      if (!this.voices[i].recording) { voice = this.voices[i]; break; }
    }
    // Six overlapping fragments already form a dense texture. Skip excess
    // requests instead of discontinuously stealing a full-level rustle.
    if (!voice) return;
    const duration = (kind === 1 ? .18 : .075) + variation * (kind === 1 ? .24 : .12);
    voice.frames = Math.max(1, Math.round(duration * this.rate));
    voice.increment = recording.sampleRate / this.rate * (.87 + variation * .25);
    const available = Math.max(0, recording.data.length - voice.frames * voice.increment - 2);
    const cue = recording.cues.length ? recording.cues[Math.min(recording.cues.length - 1, Math.floor(variation * recording.cues.length))] : null;
    voice.recording = recording; voice.position = cue == null ? available * variation : clamp((cue - .007) * recording.sampleRate, 0, available); voice.age = 0;
    voice.gain = clamp(strength, 0, 1) * (kind === 2 ? .9 : .75);
    this.cooldown = Math.round(this.rate * .037); this.events += 1;
  }
  sample() {
    if (this.cooldown > 0) this.cooldown -= 1;
    let output = 0;
    for (let i = 0; i < this.voices.length; i += 1) {
      const voice = this.voices[i]; if (!voice.recording) continue;
      const data = voice.recording.data; const index = Math.floor(voice.position);
      if (voice.age >= voice.frames || index + 1 >= data.length) { voice.recording = null; continue; }
      const mix = voice.position - index;
      const envelope = Math.min(1, voice.age / (this.rate * .004), (voice.frames - voice.age) / (this.rate * .028));
      output += (data[index] * (1 - mix) + data[index + 1] * mix) * envelope * voice.gain;
      voice.position += voice.increment; voice.age += 1;
    }
    return output;
  }
}
