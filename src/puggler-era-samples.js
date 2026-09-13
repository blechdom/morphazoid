// Original, stylized era instruments; no recordings or runtime audio nodes.
// Plucked partials with faster upper-partial decay and light body resonances are
// inspired by Smith's Physical Audio Signal Processing and Valimaki et al.'s
// harpsichord model, but this is not their full physical-model implementation:
// https://www.dsprelated.com/freebooks/pasp/Virtual_Musical_Instruments.html
// https://www.ee.columbia.edu/~dpwe/e6820/papers/ValPK04-harpsi.pdf
const TAU = Math.PI * 2;
const E1 = 41.2034446;
const DRUMS = ['kick', 'snare', 'crash', 'tom', 'hat'];
const rateFor = rate => Math.round(Math.min(96000, Math.max(8000, Number.isFinite(rate) ? rate : 22050)));
const ownerFor = owner => Number.isInteger(owner) && owner >= 0 && owner < 3 ? owner : 0;
function checkSkin(skin) {
  if (skin !== 'history' && skin !== 'future') throw new RangeError('Era samples require history or future');
}
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
}

// Step, E-minor semitones, duration in eighth-note subdivisions, accent.
// A two-second phrase at 240 BPM, including a final quarter-second rest.
const SCORE = {
  history: {
    guitar: [
      [[0,0,1.8,1],[2,0,1,.7],[3,7,1.3,.85],[5,0,1.7,1],[8,3,1.3,1],[9.5,0,1.4,.82],[12,7,1,.9],[13,0,.8,1]],
      [[0,0,1.3,1],[1.5,7,1,.75],[3,10,1.4,.9],[4.5,7,1,.75],[6,3,1.5,1],[8,0,1.5,1],[10,5,1,.8],[11,7,1,.7],[13,0,.8,1]],
      [[0,0,1,1],[1,7,.8,.75],[2,12,1,.85],[3.5,10,1,.8],[5,7,1.3,1],[7,3,1,.9],[8.5,5,1,.85],[10,7,1,.7],[11,12,1,.8],[13,0,.8,1]],
    ],
    bass: [
      [[0,0,2,1],[3,0,1.5,.8],[5,7,2,.9],[8,0,2,1],[11,3,1.4,.8],[13,0,.8,1]],
      [[0,0,1.7,1],[2.5,7,1.5,.8],[4,0,1.8,.9],[7,10,1.4,.8],[9,7,1.8,1],[12,0,1.6,1]],
      [[0,0,1.4,1],[2,12,1.3,.75],[4.5,7,1.7,.9],[7,0,1.4,1],[9,3,1.3,.8],[11,7,1,.75],[13,0,.8,1]],
    ],
  },
  future: {
    guitar: [
      [[0,0,1.2,1],[1.5,0,.8,.7],[3,10,1,.9],[4,7,1.3,1],[6.5,3,1,.8],[8,0,1.3,1],[9.5,12,1,.8],[11,7,1.2,.9],[13,0,.8,1]],
      [[0,12,1.4,1],[.75,7,1.2,.7],[2.5,3,1.8,.9],[5,10,1.3,.85],[6,7,1.2,.7],[8,0,1.8,1],[10.5,5,1.3,.85],[12,7,1,.7],[13,12,.8,1]],
      [[0,0,1.6,1],[2,7,1,.8],[3,3,1.4,.9],[5.5,12,1,.8],[7,10,1,.7],[8,7,1.7,1],[10,3,1.8,.85],[12.5,7,.8,.7],[13.5,0,.5,1]],
    ],
    bass: [
      [[0,0,1.4,1],[1.5,12,.8,.7],[3.5,0,1.6,1],[6,10,1.3,.8],[8,0,1.6,1],[10.5,7,1.3,.85],[13,0,.8,1]],
      [[0,0,1.8,1],[2.5,7,1.2,.8],[4,12,1.6,.85],[7,0,1.4,1],[8.5,3,1.4,.8],[11,7,1.5,.9],[13,0,.8,1]],
      [[0,0,1.8,1],[3,7,1.7,.85],[5.5,0,1.6,.9],[8,12,1.7,1],[10,10,1.5,.8],[12.5,0,1,1]],
    ],
  },
};

// Finite modal oscillators. The recurrence avoids a sin/exp call per partial
// per sample; there is no recirculating signal or potentially unstable feedback.
function mode(output, at, duration, frequency, amplitude, decay, rate, phase = 0, finish = 1) {
  if (frequency >= rate * .43 || frequency < 15) return;
  const start = Math.round(at * rate), n = Math.min(Math.round(duration * rate), output.length - start);
  const angle = TAU * frequency / rate, cs = Math.cos(angle), sn = Math.sin(angle);
  let real = Math.cos(phase), imag = Math.sin(phase), envelope = 1, color = 1;
  const loss = Math.exp(-1 / (Math.max(.008, decay) * rate)), move = Math.exp(-1 / (.045 * rate));
  const attack = Math.max(1, rate * .0018), release = Math.max(1, Math.min(rate * .014, n * .3));
  for (let i = 0; i < n; i++) {
    const edge = Math.min(1, i / attack, (n - 1 - i) / release);
    output[start + i] += imag * amplitude * envelope * (finish + (1 - finish) * color) * edge;
    const next = real * cs - imag * sn; imag = imag * cs + real * sn; real = next;
    envelope *= loss; color *= move;
  }
}
function noiseBurst(output, at, duration, amplitude, decay, rate, seed, brightness = .55) {
  const noise = random(seed), start = Math.round(at * rate), n = Math.min(Math.round(duration * rate), output.length - start);
  let smooth = 0, envelope = 1;
  const bodyFilter = 1 - Math.exp(-TAU * 740 / rate);
  const loss = Math.exp(-1 / (decay * rate)), edge = Math.max(1, rate * .001);
  for (let i = 0; i < n; i++) {
    const raw = noise(); smooth += bodyFilter * (raw - smooth);
    const value = smooth * (1 - brightness) + (raw - smooth) * brightness;
    output[start + i] += value * amplitude * envelope * Math.min(1, i / edge, (n - 1 - i) / edge);
    envelope *= loss;
  }
}
function fmNote(output, at, duration, frequency, amplitude, decay, rate, ratio, index, glide = 0, vibrato = 0) {
  const start = Math.round(at * rate), n = Math.min(Math.round(duration * rate), output.length - start);
  // Conservative sideband budget at the lowest supported sample rate.
  index = Math.max(0, Math.min(index, (rate * .4 / frequency - 1) / Math.max(1, ratio)));
  const step = TAU * frequency / rate, loss = Math.exp(-1 / (decay * rate));
  const indexLoss = Math.exp(-1 / (.07 * rate)), glideLoss = Math.exp(-1 / (.025 * rate));
  let phase = 0, envelope = 1, depth = index, bend = glide;
  for (let i = 0; i < n; i++) {
    const time = i / rate, edge = Math.min(1, i / (rate * .002), (n - 1 - i) / (rate * .012));
    const mod = Math.sin(phase * ratio + vibrato * Math.sin(TAU * 6 * time));
    output[start + i] += Math.sin(phase + depth * mod) * amplitude * envelope * edge;
    phase += step * (1 + bend); bend *= glideLoss; depth *= indexLoss; envelope *= loss;
  }
}
function acoustic(output, owner, bass, at, duration, frequency, accent, rate, seed) {
  const jaw = owner === 0 && !bass, quill = owner === 2;
  const count = jaw ? 20 : bass ? [6, 9, 12][owner] : [14, 15, 18][owner];
  const pick = [.23, .18, .115][owner], power = bass ? [1.7, 1.45, 1.2][owner] : [1.2, 1.3, .95][owner];
  const decay = bass ? [.18, .20, .17][owner] : [.12, .13, .14][owner];
  for (let k = 1; k <= count; k++) {
    const f = frequency * k * Math.sqrt(1 + (quill ? .00008 : .00002) * k * k);
    let amp = Math.sin(Math.PI * k * pick) / k ** power;
    let finish = 1;
    if (jaw) {
      const initial = .16 + 2.5 * Math.exp(-(((f - 650) / 340) ** 2));
      const final = .16 + 2.8 * Math.exp(-(((f - 1300) / 390) ** 2));
      amp *= initial; finish = final / initial;
    }
    mode(output, at, duration, f, amp * accent, decay / (1 + k * (quill ? .045 : .09)), rate,
      jaw ? k * k * .37 : quill ? k * k * .11 : 0, finish);
  }
  // Small resonant body and excitation components stay dry and unamplified.
  mode(output, at, Math.min(duration, .13), bass ? 115 + owner * 37 : 280 + owner * 130,
    accent * (bass ? .07 : .045), .035, rate);
  if (owner === 1) mode(output, at + .003, Math.max(.01, duration - .003), frequency * 1.004, accent * .10, decay * .8, rate);
  if (quill && !bass) mode(output, at, duration, frequency * 2.002, accent * .11, .075, rate);
  noiseBurst(output, at, .018, accent * (quill ? .10 : bass ? .035 : .065), .003, rate, seed, quill ? .78 : .2);
}
function futuristic(output, owner, bass, at, duration, frequency, accent, rate, seed) {
  if (bass) {
    fmNote(output, at, duration, frequency, accent, [.14, .12, .17][owner], rate,
      [2, 1, .5][owner], [2.9, 1.1, 3.4][owner], [0, .27, -.16][owner], owner === 2 ? .35 : 0);
    if (owner === 0) for (const k of [2, 3, 4, 6]) mode(output, at, duration, frequency * k, accent * .32 / k, .08 / k ** .3, rate);
    if (owner === 1) mode(output, at, duration, frequency * 3, accent * .09, .036, rate);
    if (owner === 2) {
      mode(output, at, duration, frequency * 2.013, accent * .2, .08, rate);
      mode(output, at, duration, frequency * 7.13, accent * .30, .055, rate);
    }
  } else if (owner === 0) {
    fmNote(output, at, duration, frequency, accent, .10, rate, 2, 3.5, .025);
    mode(output, at, duration, frequency * 2, accent * .14, .035, rate);
  } else if (owner === 1) {
    fmNote(output, at, duration, frequency, accent * .6, .15, rate, Math.SQRT2, 1.2, .075, .18);
    for (const [i, ratio] of [1, 2.76, 5.4, 8.93].entries()) {
      mode(output, at, duration, frequency * ratio, accent * [.6, .36, .14, .065][i], .16 / (1 + i * .8), rate);
    }
  } else {
    fmNote(output, at, duration, frequency, accent * .7, .11, rate, .5, 1.5, -.12, .35);
    for (const [i, ratio] of [1, 2.76, 5.43].entries()) {
      mode(output, at, duration, frequency * ratio, accent * [.8, .22, .06][i], .09 / (1 + i), rate);
    }
    noiseBurst(output, at, .045, accent * .045, .012, rate, seed, .05);
  }
}
function finish(output, rate, target = .17) {
  // Remove DC with a gentle high-pass; never subtract a constant into rests.
  let previous = 0, high = 0;
  const hp = Math.exp(-TAU * 22 / rate), fade = Math.round(rate * .004);
  let peak = 0, energy = 0;
  for (let i = 0; i < output.length; i++) {
    const input = output[i]; high = hp * (high + input - previous); previous = input;
    const edge = Math.min(1, i / fade, (output.length - 1 - i) / fade);
    const value = Math.abs(high) < 1e-12 ? 0 : high * edge;
    output[i] = value; peak = Math.max(peak, Math.abs(value)); energy += value * value;
  }
  // Smooth offline crest control keeps dry acoustic attacks audible beside the
  // synths without clipping/overdrive. A reverse detector gives 1.5 ms of
  // look-ahead with an 8 ms release, rather than hard sample clipping.
  const rawRms = Math.sqrt(energy / output.length);
  if (peak > rawRms * 4.8 && rawRms > 1e-12) {
    const envelope = new Float32Array(output.length), release = Math.exp(-1 / (rate * .008));
    const lookAhead = Math.exp(-1 / (rate * .0015));
    let level = 0;
    for (let i = 0; i < output.length; i++) { level = Math.max(Math.abs(output[i]), level * release); envelope[i] = level; }
    level = 0;
    for (let i = output.length - 1; i >= 0; i--) { level = Math.max(envelope[i], level * lookAhead); envelope[i] = level; }
    peak = 0; energy = 0;
    for (let i = 0; i < output.length; i++) {
      output[i] *= Math.min(1, (rawRms * 2.1 / Math.max(1e-12, envelope[i])) ** .8);
      peak = Math.max(peak, Math.abs(output[i])); energy += output[i] * output[i];
    }
  }
  const gain = Math.min(target / Math.max(1e-12, Math.sqrt(energy / output.length)), .895 / Math.max(1e-12, peak));
  for (let i = 0; i < output.length; i++) output[i] *= gain;
  return output;
}

/** Deterministic two-second E-minor phrase; rendered once and cached at Audio arm. */
export function renderEraPhrase(skin, role, owner = 0, sampleRate = 22050) {
  checkSkin(skin);
  if (role !== 'guitar' && role !== 'bass') throw new RangeError('Era phrase role must be guitar or bass');
  const rate = rateFor(sampleRate), identity = ownerFor(owner), bass = role === 'bass';
  const output = new Float32Array(rate * 2);
  const root = bass ? E1 : E1 * (skin === 'history' ? [2, 4, 8][identity] : [4, 8, 4][identity]);
  for (const [step, note, gate, accent] of SCORE[skin][role][identity]) {
    const frequency = root * 2 ** (note / 12), at = step * .125, duration = gate * .125;
    const seed = 0x5eed + identity * 311 + Math.round(step * 107) + (bass ? 800 : 0);
    if (skin === 'history') acoustic(output, identity, bass, at, duration, frequency, accent, rate, seed);
    else futuristic(output, identity, bass, at, duration, frequency, accent, rate, seed);
  }
  return finish(output, rate);
}

/** Era-specific impact accents. All tails are finite, at most 1.2 seconds. */
export function renderEraDrum(skin, drum, sampleRate = 22050) {
  checkSkin(skin);
  if (!DRUMS.includes(drum)) throw new RangeError('Unknown era drum');
  const rate = rateFor(sampleRate), future = skin === 'future', index = DRUMS.indexOf(drum);
  const duration = [.46, .36, 1.2, .45, .22][index], output = new Float32Array(Math.round(rate * duration));
  const seed = 0xdecaf + index * 487 + (future ? 997 : 0);
  if (drum === 'kick') {
    if (future) {
      fmNote(output, 0, duration, 48, 1, .16, rate, 1, .8, 1.9);
      mode(output, 0, .16, 96, .12, .035, rate);
      noiseBurst(output, 0, .025, .13, .004, rate, seed, .8);
    } else {
      for (const [i, ratio] of [1, 1.59, 2.14, 2.65].entries()) mode(output, 0, duration, 63 * ratio, [1,.23,.11,.05][i], .15 / (1 + i * .4), rate);
      noiseBurst(output, 0, .045, .14, .009, rate, seed, .14);
    }
  } else if (drum === 'snare') {
    if (future) {
      for (const [i, at] of [0, .011, .026].entries()) noiseBurst(output, at, duration - at, [.65,.8,1][i], .07, rate, seed + i, .9);
      fmNote(output, 0, .16, 410, .27, .037, rate, 1.41, 2.3, -.6);
    } else {
      mode(output, 0, duration, 178, .55, .083, rate);
      mode(output, 0, .24, 283, .25, .06, rate);
      noiseBurst(output, 0, duration, .76, .09, rate, seed, .68);
      noiseBurst(output, .016, .2, .22, .06, rate, seed + 1, .42);
    }
  } else if (drum === 'crash') {
    const ratios = future ? [1,1.33,1.91,2.71,3.87,5.31,6.8,8.17] : [1,1.48,2.09,2.83,3.73,4.92,6.27,7.91];
    const root = future ? 487 : 421;
    for (const [i, ratio] of ratios.entries()) mode(output, 0, duration, root * ratio, .18 / (1 + i * .22), .36 / (1 + i * .08), rate, i * .7);
    noiseBurst(output, 0, duration, future ? .45 : .30, .34, rate, seed, .87);
    if (future) fmNote(output, 0, .68, 620, .20, .19, rate, Math.SQRT2, 2.6, -.32);
  } else if (drum === 'tom') {
    if (future) {
      fmNote(output, 0, duration, 119, 1, .13, rate, 1.5, 1.8, -.48, .4);
      mode(output, .02, .25, 363, .13, .06, rate);
    } else {
      for (const [i, ratio] of [1,2.76,5.4].entries()) mode(output, 0, duration, 137 * ratio, [1,.25,.08][i], .13 / (1 + i), rate);
      noiseBurst(output, 0, .04, .13, .008, rate, seed, .17);
    }
  } else if (future) {
    for (const [i, at] of [0,.018,.041].entries()) {
      fmNote(output, at, duration - at, 1250 + i * 307, .32, .039, rate, 1.63, 1.7);
      noiseBurst(output, at, .09, .2, .025, rate, seed + i, .96);
    }
  } else {
    for (const [i, ratio] of [1,1.47,2.18,3.21].entries()) mode(output, 0, duration, 1360 * ratio, .24 / (1 + i * .5), .068, rate, i * .4);
    noiseBurst(output, 0, .12, .08, .026, rate, seed, .84);
  }
  return finish(output, rate, .18);
}
