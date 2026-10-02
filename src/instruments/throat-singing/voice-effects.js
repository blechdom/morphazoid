import { glottalHarmonics } from "../../families/tract/throatazoid.js";

const clamp = (value, minimum, maximum, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : fallback))
);
const EXTRA_PITCH_INTERVALS = Object.freeze([-1, 1, 0.5]);
const REVERB_SECONDS = 1.6;

function roomImpulse(audio) {
  const sampleRate = audio.sampleRate;
  const length = Math.ceil(sampleRate * REVERB_SECONDS);
  const buffer = audio.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = buffer.getChannelData(channel);
    let seed = 0x27f31a4b ^ (channel * 0x5f356495);
    let energy = 0;
    for (let index = Math.round(sampleRate * (0.018 + channel * 0.003)); index < length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const time = index / sampleRate;
      const envelope = Math.exp(-time * 4.4) * Math.pow(1 - time / REVERB_SECONDS, 2);
      const sample = ((seed >>> 0) / 0xffffffff * 2 - 1) * envelope;
      samples[index] = sample;
      energy += sample * sample;
    }
    const normalization = 0.75 / Math.sqrt(Math.max(energy, 1e-12));
    for (let index = 0; index < length; index += 1) samples[index] *= normalization;
  }
  return buffer;
}

/**
 * Main voices enter input; only post-tract sound enters overtoneInput. The
 * helper inserts dry/room/echo paths between input and output and returns extra
 * voices to that same input. Audio arming and master level remain caller-owned.
 */
export function createVoiceEffects(audio, { input, overtoneInput, output }) {
  const nodes = [];
  const oscillators = [];
  const externalConnections = [];
  const own = (node) => { nodes.push(node); return node; };
  const connectExternal = (from, to) => {
    from.connect(to);
    externalConnections.push([from, to]);
  };
  const gain = (value = 0) => {
    const node = own(audio.createGain());
    node.gain.value = value;
    return node;
  };
  const filter = (type, frequency, q = 0.7) => {
    const node = own(audio.createBiquadFilter());
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const oscillator = () => {
    const node = own(audio.createOscillator());
    oscillators.push(node);
    return node;
  };
  const nyquistLimit = Math.min(16_000, audio.sampleRate * 0.45);
  const dryGain = gain(1);
  connectExternal(input, dryGain);
  dryGain.connect(output);

  const delay = own(audio.createDelay(1.5));
  delay.delayTime.value = 0.32;
  const delayWet = gain();
  const feedbackHighpass = filter("highpass", 110);
  const feedbackLowpass = filter("lowpass", Math.min(5_500, nyquistLimit));
  const feedback = gain();
  connectExternal(input, delay);
  delay.connect(delayWet);
  delayWet.connect(output);
  delay.connect(feedbackHighpass);
  feedbackHighpass.connect(feedbackLowpass);
  feedbackLowpass.connect(feedback);
  feedback.connect(delay);

  const roomHighpass = filter("highpass", 150);
  const reverb = own(audio.createConvolver());
  reverb.normalize = false;
  reverb.buffer = roomImpulse(audio);
  const reverbWet = gain();
  connectExternal(input, roomHighpass);
  roomHighpass.connect(reverb);
  reverb.connect(reverbWet);
  reverbWet.connect(output);

  // A fixed glottal spectrum makes phrase scheduling entirely AudioParam-based.
  // Tenseness changes each voice's smooth spectral focus and low-pass cutoff.
  const spectrum = glottalHarmonics(0.65, 72, 1024);
  const wave = audio.createPeriodicWave(spectrum.real, spectrum.imaginary, { disableNormalization: false });
  const instability = oscillator();
  instability.type = "triangle";
  instability.frequency.value = 0.63;
  const pitchedVoices = EXTRA_PITCH_INTERVALS.map((interval) => {
    const source = oscillator();
    source.setPeriodicWave(wave);
    const focus = filter("peaking", 1_400, 9);
    const lowpass = filter("lowpass", Math.min(9_000, nyquistLimit));
    const level = gain();
    const wobble = gain();
    instability.connect(wobble);
    wobble.connect(source.detune);
    source.connect(focus);
    focus.connect(lowpass);
    lowpass.connect(level);
    level.connect(input);
    return { source, focus, lowpass, level, wobble, interval };
  });
  const overtoneVoices = Array.from({ length: 3 }, () => {
    const focus = filter("bandpass", 2_000, 12);
    const level = gain();
    connectExternal(overtoneInput, focus);
    focus.connect(level);
    level.connect(input);
    return { focus, level };
  });
  for (const source of oscillators) source.start();

  let destroyed = false;
  function update(performance = {}, atTime = audio.currentTime, glideSeconds = 0.04, { replaceScheduled = false } = {}) {
    if (destroyed) return;
    const extras = performance.extras ?? {};
    const now = Math.max(0, Number(audio.currentTime) || 0);
    const start = Math.max(now, clamp(atTime, 0, Number.MAX_SAFE_INTEGER, now));
    const timeConstant = clamp(glideSeconds, 0.006, 0.3, 0.04) / 3;
    // A scheduled frame appends targets. A direct edit replaces the stale
    // lookahead while holding the present value, matching the caller's source.
    const set = (parameter, value) => {
      if (replaceScheduled) {
        try {
          if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(start);
          else parameter.cancelScheduledValues(start);
        } catch {
          const held = parameter.value;
          parameter.cancelScheduledValues(start);
          parameter.setValueAtTime(held, start);
        }
      }
      parameter.setTargetAtTime(value, start, timeConstant);
    };
    const hz = clamp(performance.trueFoldHz, 40, 1_000, 110);
    const overtoneFundamental = clamp(performance.heardDroneHz, 20, 1_000, hz);
    const tenseness = clamp(performance.foldTenseness, 0, 1, 0.65);
    const harmonic = clamp(performance.harmonicNumber, 1, 32, 8);
    const focusQ = clamp(performance.focusQ, 1, 32, 12);
    const voicedLevel = clamp(performance.intensity, 0, 1, 0.55)
      * clamp(performance.voiceGain, 0, 1, 1);
    const pitchCount = Math.round(clamp(extras.pitchVoices, 1, 4, 1)) - 1;
    const overtoneCount = Math.round(clamp(extras.overtoneVoices, 1, 4, 1)) - 1;
    const spread = clamp(extras.pitchSpreadSemitones, 0, 24, 7);
    const overtoneSpread = clamp(extras.overtoneSpread, 1, 6, 1);
    const sourceInstability = clamp(extras.sourceInstability, 0, 1);
    pitchedVoices.forEach((voice, index) => {
      const frequency = clamp(hz * 2 ** (voice.interval * spread / 12), 40, 1_000);
      const formant = clamp(frequency * harmonic, 120, nyquistLimit);
      set(voice.source.frequency, frequency);
      set(voice.wobble.gain, sourceInstability * voice.interval * 34);
      set(voice.focus.frequency, formant);
      set(voice.focus.Q, focusQ * 0.75);
      set(voice.focus.gain, 5 + tenseness * 11);
      set(voice.lowpass.frequency, clamp(Math.max(formant * 1.3, frequency * (8 + tenseness * 24)), 400, nyquistLimit));
      set(voice.level.gain, index < pitchCount ? voicedLevel * 0.095 / Math.sqrt(pitchCount) : 0);
    });
    overtoneVoices.forEach((voice, index) => {
      set(voice.focus.frequency, clamp(overtoneFundamental * (harmonic + (index + 1) * overtoneSpread), 120, nyquistLimit));
      set(voice.focus.Q, focusQ);
      set(voice.level.gain, index < overtoneCount ? 0.28 / Math.sqrt(overtoneCount) : 0);
    });
    const reverbMix = clamp(extras.reverbMix, 0, 0.65);
    const delayMix = clamp(extras.delayMix, 0, 0.6);
    const delayFeedback = clamp(extras.delayFeedback, 0, 0.65, 0.24);
    set(dryGain.gain, 1 - reverbMix * 0.28 - delayMix * 0.18);
    set(reverbWet.gain, reverbMix * 0.6);
    set(delayWet.gain, delayMix * 0.58 * (1 - delayFeedback * 0.6));
    set(delay.delayTime, clamp(extras.delayTimeSeconds, 0.06, 1.5, 0.32));
    set(feedback.gain, delayFeedback);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const source of oscillators) {
      try { source.stop(); } catch { /* An already-stopped source is released below. */ }
    }
    for (const [from, to] of externalConnections) {
      try { from.disconnect(to); } catch { /* Caller may have disconnected its graph first. */ }
    }
    for (const node of nodes) node.disconnect();
    reverb.buffer = null;
  }
  return { update, destroy };
}
