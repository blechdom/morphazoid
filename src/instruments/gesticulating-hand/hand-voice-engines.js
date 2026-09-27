// Compact, continuously playable adaptations of existing Morphazoid voices.
// Choir: Hiccup Head's LF glottis (matching Throatazoid) and the vowel centers
// of Puggler's sung layer. Marimba: Linear Drums' pitched marimba archetype.
// These are synthesis approximations; no recordings or new audio clocks.
const TAU = 2 * Math.PI;
const HARMONICS = 48;

// Liljencrants–Fant coefficients from hiccup-head-processor.js. Project its
// glottal pulse onto harmonics once, so high notes can omit inaudible partials
// instead of aliasing a directly sampled pulse. No DFT runs in process().
function glottalSpectrum(tenseness) {
  const rd = Math.max(.5, Math.min(2.7, 3 * (1 - tenseness)));
  const ra = -.01 + .048 * rd, rk = .224 + .118 * rd;
  const rg = ((rk / 4) * (.5 + 1.2 * rk)) / (.11 * rd - ra * (.5 + 1.2 * rk));
  const tp = 1 / (2 * rg), te = tp * (1 + rk), epsilon = 1 / ra;
  const shift = Math.exp(-epsilon * (1 - te)), delta = 1 - shift;
  const rhs = ((shift - 1) / epsilon + (1 - te) * shift) / delta;
  const upperIntegral = (te - tp) / 2 - rhs, omega = Math.PI / tp;
  const sineAtClosure = Math.sin(omega * te);
  const alpha = Math.log(Math.max(1e-8, -Math.PI * sineAtClosure * upperIntegral / (tp * 2))) / (tp / 2 - te);
  const e0 = -1 / (sineAtClosure * Math.exp(alpha * te));
  const cosine = new Float64Array(HARMONICS), sine = new Float64Array(HARMONICS), count = 1024;
  for (let sample = 0; sample < count; sample++) {
    const phase = sample / count;
    const value = phase > te ? (-Math.exp(-epsilon * (phase - te)) + shift) / delta
      : e0 * Math.exp(alpha * phase) * Math.sin(omega * phase);
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic++) {
      cosine[harmonic - 1] += value * Math.cos(TAU * phase * harmonic) * 2 / count;
      sine[harmonic - 1] += value * Math.sin(TAU * phase * harmonic) * 2 / count;
    }
  }
  return { cosine, sine };
}
const SOFT_GLOTTIS = glottalSpectrum(.45), CLEAR_GLOTTIS = glottalSpectrum(.72);
// Puggler era-vocals: oo, ah, and the brighter sung vowel, with the same
// independent source pitch / fixed vowel-center relationship.
const VOWELS = [[330, 730, 2180], [740, 1120, 2480], [440, 1720, 2600]];
const BANDWIDTHS = [110, 150, 220], FORMANT_GAINS = [1, .72, .34];
export function createChoirState(rate) {
  return { cosine: new Float64Array(HARMONICS), sine: new Float64Array(HARMONICS),
    targetCosine: new Float64Array(HARMONICS), targetSine: new Float64Array(HARMONICS),
    smooth: 1 - Math.exp(-1 / (rate * .006)), breath: 0 };
}
export function tuneChoir(voice, rate) {
  const state = voice.choir, tone = voice.brightness, grain = voice.roughness;
  const first = tone < .5 ? 0 : 1, mix = tone < .5 ? tone * 2 : tone * 2 - 1;
  const f1 = VOWELS[first][0] + (VOWELS[first + 1][0] - VOWELS[first][0]) * mix;
  const f2 = VOWELS[first][1] + (VOWELS[first + 1][1] - VOWELS[first][1]) * mix;
  const f3 = VOWELS[first][2] + (VOWELS[first + 1][2] - VOWELS[first][2]) * mix;
  let energy = 0;
  for (let index = 0; index < HARMONICS; index++) {
    const frequency = voice.frequency * (index + 1);
    const fade = Math.max(0, Math.min(1, (rate * .43 - frequency) / (rate * .08)));
    let resonance = index === 0 ? .34 : .025;
    for (let band = 0; band < 3; band++) {
      const center = band === 0 ? f1 : band === 1 ? f2 : f3;
      const width = BANDWIDTHS[band] * (1 + grain * .6), offset = (frequency - center) / width;
      resonance += FORMANT_GAINS[band] * 4 / (1 + offset * offset);
    }
    const c = (SOFT_GLOTTIS.cosine[index] + (CLEAR_GLOTTIS.cosine[index] - SOFT_GLOTTIS.cosine[index]) * grain) * resonance * fade;
    const s = (SOFT_GLOTTIS.sine[index] + (CLEAR_GLOTTIS.sine[index] - SOFT_GLOTTIS.sine[index]) * grain) * resonance * fade;
    state.targetCosine[index] = c; state.targetSine[index] = s; energy += c * c + s * s;
  }
  const gain = .62 / Math.sqrt(Math.max(energy, 1e-12));
  for (let index = 0; index < HARMONICS; index++) {
    state.targetCosine[index] *= gain; state.targetSine[index] *= gain;
  }
}
export function resetChoir(state) {
  state.cosine.fill(0); state.sine.fill(0); state.targetCosine.fill(0); state.targetSine.fill(0); state.breath = 0;
}
export function sampleChoir(voice, random, rate) {
  const state = voice.choir, angle = TAU * voice.phase, c = Math.cos(angle), s = Math.sin(angle);
  let cosine = c, sine = s, output = 0;
  for (let index = 0; index < HARMONICS; index++) {
    const a = state.cosine[index] += (state.targetCosine[index] - state.cosine[index]) * state.smooth;
    const b = state.sine[index] += (state.targetSine[index] - state.sine[index]) * state.smooth;
    // Also fade from the live (pitch-smoothed) frequency: a rising pitch cannot
    // carry an old nonzero harmonic across Nyquist before the next tuning pass.
    const fade = Math.max(0, Math.min(1, (rate * .47 - voice.frequency * (index + 1)) / (rate * .04)));
    output += (a * cosine + b * sine) * fade;
    const next = cosine * c - sine * s; sine = sine * c + cosine * s; cosine = next;
  }
  state.breath += (random - state.breath) * .12;
  return output + state.breath * voice.roughness * .09;
}

// Linear Drums' marimba ratios/gains, decayScale=1.18 and highDamping=.5.
// Its node-per-partial exponential envelopes become fixed complex modes here.
const MARIMBA_RATIOS = [1, 4, 9.88, 19, 21, 30, 42, 55];
const MARIMBA_GAINS = [1, .5, .24, .105, .065, .038, .021, .012];
export function createMarimbaState(rate) {
  return { modes: MARIMBA_RATIOS.map(() => ({ re: 0, im: 0, c: 1, s: 0, radius: 0, gain: 0 })),
    distance: 0, pending: 0, wasGated: false, impact: 0, noise: 0,
    impactDecay: Math.exp(-1 / (rate * .003)) };
}
export function tuneMarimba(voice, rate) {
  const tone = voice.brightness, grain = voice.roughness;
  for (let index = 0; index < MARIMBA_RATIOS.length; index++) {
    const mode = voice.marimba.modes[index], frequency = voice.frequency * MARIMBA_RATIOS[index];
    const angle = TAU * Math.min(rate * .43, frequency) / rate;
    mode.c = Math.cos(angle); mode.s = Math.sin(angle);
    const duration = (.55 + (1 - grain) * 1.55) * 1.18 / (1 + index * (.5 + grain) * .48);
    mode.radius = Math.exp(-6.9 / (rate * duration));
    const fade = Math.max(0, Math.min(1, (rate * .44 - frequency) / (rate * .08)));
    mode.gain = MARIMBA_GAINS[index] * fade * (index === 0 ? 1 : .24 + tone * 1.4);
  }
}
export function resetMarimba(state) {
  for (const mode of state.modes) mode.re = mode.im = 0;
  state.distance = state.pending = state.impact = state.noise = 0; state.wasGated = false;
}
export function sampleMarimba(voice, random, rate) {
  const state = voice.marimba;
  let strike = 0;
  if (voice.gated) {
    if (!state.wasGated) strike = .76;
    strike = Math.max(strike, state.pending);
    state.distance += voice.excitation * 12 / rate;
    if (state.distance >= 1) { state.distance -= 1; strike = Math.max(strike, .3 + voice.excitation * .5); }
  }
  state.wasGated = voice.gated; state.pending = 0;
  state.impact = Math.max(state.impact * state.impactDecay, strike);
  state.noise += (random - state.noise) * (.15 + voice.brightness * .5);
  let output = state.noise * state.impact * (.035 + voice.roughness * .12);
  for (const mode of state.modes) {
    const re = mode.re;
    mode.re = (re * mode.c - mode.im * mode.s) * mode.radius + strike;
    mode.im = (re * mode.s + mode.im * mode.c) * mode.radius;
    if (Math.abs(mode.re) < 1e-20) mode.re = 0;
    if (Math.abs(mode.im) < 1e-20) mode.im = 0;
    output += mode.im * mode.gain;
  }
  return output * .92;
}
