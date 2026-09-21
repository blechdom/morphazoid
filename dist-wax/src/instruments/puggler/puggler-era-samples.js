// Original, stylized era instruments; no recordings or runtime audio nodes.
// Plucked partials with faster upper-partial decay and light body resonances are
// inspired by Smith's Physical Audio Signal Processing and Valimaki et al.'s
// harpsichord model, but this is not their full physical-model implementation:
// https://www.dsprelated.com/freebooks/pasp/Virtual_Musical_Instruments.html
// https://www.ee.columbia.edu/~dpwe/e6820/papers/ValPK04-harpsi.pdf
const TAU = Math.PI * 2;
const E1 = 41.2034446;
const DRUMS = ['kick', 'snare', 'crash', 'tom', 'hat'];
// The saved role IDs above remain stable while each era maps them to a different
// performance family. These names are synthesis intentions, not sampled or
// ethnographically authentic instrument reconstructions.
export const ERA_IMPACT_MODELS = Object.freeze({
  history: Object.freeze({ kick: 'timpani', snare: 'cello-pizzicato', crash: 'balinese-gong', tom: 'hand-drum', hat: 'bronze-cymbals' }),
  future: Object.freeze({ kick: 'volt-pulse', snare: 'vector-zap', crash: 'plasma-bloom', tom: 'goo-cell', hat: 'bit-swarm' }),
});
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
function harpsichord(output, owner, at, duration, frequency, accent, rate, seed) {
  const quill = owner === 2, count = [14, 17, 20][owner];
  const pick = [.23, .18, .115][owner], power = [1.2, 1.3, .98][owner], decay = [.12, .14, .15][owner];
  for (let k = 1; k <= count; k++) {
    const f = frequency * k * Math.sqrt(1 + (quill ? .00008 : .00002) * k * k);
    let amp = Math.sin(Math.PI * k * pick) / k ** power;
    mode(output, at, duration, f, amp * accent, decay / (1 + k * (quill ? .045 : .09)), rate, quill ? k * k * .11 : k * .025);
  }
  // Quill contact and a small soundboard resonance: enough bite to read as a
  // plucked keyboard, without borrowing the punk kit's broadband transients.
  mode(output, at, Math.min(duration, .13), 280 + owner * 130, accent * .05, .035, rate);
  if (owner === 1) mode(output, at + .003, Math.max(.01, duration - .003), frequency * 1.004, accent * .10, decay * .8, rate);
  if (quill) mode(output, at, duration, frequency * 2.002, accent * .11, .075, rate);
  noiseBurst(output, at, .014, accent * (quill ? .075 : .04), .0028, rate, seed, quill ? .74 : .18);
}
function bowedCello(output, owner, at, duration, frequency, accent, rate, seed) {
  const start = Math.round(at * rate), n = Math.min(Math.round(duration * rate), output.length - start);
  const phase = new Float64Array(9), rosinNoise = random(seed);
  const attack = Math.max(1, rate * [.018, .026, .034][owner]), release = Math.max(1, Math.min(rate * .038, n * .3));
  let rosin = 0;
  for (let i = 0; i < n; i++) {
    const time = i / rate, vibrato = 2 ** (([.08, .15, .23][owner] * Math.sin(TAU * (4.4 + owner * .45) * time)) / 12);
    let bowed = 0;
    for (let k = 1; k < phase.length; k++) {
      const harmonic = frequency * k * vibrato;
      if (harmonic >= rate * .43) continue;
      phase[k] += TAU * harmonic / rate; phase[k] -= Math.floor(phase[k] / TAU) * TAU;
      bowed += Math.sin(phase[k] + k * owner * .07) * (k % 2 ? 1 : .72) / k ** [1.7, 1.48, 1.04][owner];
    }
    rosin += .075 * (rosinNoise() - rosin);
    const edge = Math.min(1, i / attack, (n - 1 - i) / release);
    const bow = .74 + .26 * (1 - Math.exp(-i / Math.max(1, rate * .09)));
    output[start + i] += (bowed * .50 + rosin * .018) * accent * edge * bow;
  }
  mode(output, at, duration, 108 + owner * 31, accent * .06, .18, rate);
}
function acoustic(output, owner, bass, at, duration, frequency, accent, rate, seed) {
  if (bass) bowedCello(output, owner, at, duration, frequency, accent, rate, seed);
  else harpsichord(output, owner, at, duration, frequency, accent, rate, seed);
}

// Four coupled oscillator lanes make the future skin sound packetized and
// synthetic. This is a deterministic SIMD-style sound design gesture in JS;
// it does not claim that the browser executes this particular loop as SIMD.
function vectorPacket(output, at, duration, frequency, amplitude, decay, rate, options = {}) {
  const start = Math.round(at * rate), n = Math.min(Math.round(duration * rate), output.length - start);
  const ratios = options.ratios ?? [1, 1.503, 2.011, 3.97], phase = new Float64Array(4), tone = new Float64Array(4);
  const loss = Math.exp(-1 / (Math.max(.012, decay) * rate)), bendLoss = Math.exp(-1 / (.045 * rate));
  const attack = Math.max(1, rate * .0015), release = Math.max(1, Math.min(rate * .018, n * .3));
  const buzz = options.buzz ?? .35, cross = options.cross ?? .4;
  let envelope = 1, bend = options.bend ?? 0;
  for (let i = 0; i < n; i++) {
    for (let lane = 0; lane < 4; lane++) tone[lane] = Math.sin(phase[lane] + cross * Math.sin(phase[(lane + 1) & 3]));
    let packet = 0;
    for (let lane = 0; lane < 4; lane++) {
      const hz = frequency * ratios[lane] * Math.max(.08, 1 + bend);
      if (hz < rate * .43) {
        packet += tone[lane] * [.42, .31, .22, .16][lane];
        if (hz * 3 < rate * .43) packet += Math.sin(phase[lane] * 3 + lane * .4) * buzz * .13;
        phase[lane] += TAU * hz / rate; phase[lane] -= Math.floor(phase[lane] / TAU) * TAU;
      }
    }
    const edge = Math.min(1, i / attack, (n - 1 - i) / release);
    output[start + i] += Math.tanh(packet * (1.1 + buzz)) * amplitude * envelope * edge;
    envelope *= loss; bend *= bendLoss;
  }
}

// A continuously swept resonant low-pass turns the lane packets into a wet,
// elastic filter gesture. Coefficients follow the RBJ cookbook and remain
// bounded across the supported 8–96 kHz render rates.
function gooFilter(output, rate, lowHz, highHz, cycles, q = 1.5, drive = 1.8, phase = 0) {
  lowHz = Math.max(45, Math.min(lowHz, rate * .38)); highHz = Math.max(lowHz, Math.min(highHz, rate * .38));
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < output.length; i++) {
    const progress = i / Math.max(1, output.length - 1), motion = .5 - .5 * Math.cos(TAU * (cycles * progress + phase));
    const cutoff = lowHz * (highHz / lowHz) ** motion, w = TAU * cutoff / rate;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
    const b0 = (1 - cos) / (2 * a0), b1 = (1 - cos) / a0, b2 = b0;
    const a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
    const dry = Math.tanh(output[i] * drive) / Math.tanh(drive);
    const wet = b0 * dry + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = dry; y2 = y1; y1 = Number.isFinite(wet) ? wet : 0;
    output[i] = Math.tanh((dry * .12 + y1 * .96) * 1.35) / Math.tanh(1.35);
  }
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
  }
  vectorPacket(output, at, duration, frequency * (bass ? 1 : 1.01), accent * (bass ? [.20, .82, .34][owner] : .14),
    bass ? .13 : .09, rate, { ratios: bass ? [[1, 2, 3, 4], [1, 3.7, 7.1, 11.3], [1, 2.76, 5.43, 8.91]][owner] : undefined,
      buzz: [.32, .58, .82][owner], cross: [.25, .62, .91][owner], bend: bass ? [.08, -.07, .13][owner] : [.03, .09, -.06][owner] });
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
  if (skin === 'future') {
    const low = bass ? [58, 120, 62][identity] : [180, 260, 135][identity];
    const high = bass ? [820, 3200, 1050][identity] : [4200, 6100, 3300][identity];
    gooFilter(output, rate, low, high, [2.25, 3.5, 1.75][identity], [1.35, 2.1, 2.65][identity], [1.7, 2.25, 2.8][identity], identity * .17);
  }
  return finish(output, rate);
}

/** Era-specific impact accents. All tails are finite, at most 1.2 seconds. */
export function renderEraDrum(skin, drum, sampleRate = 22050) {
  checkSkin(skin);
  if (!DRUMS.includes(drum)) throw new RangeError('Unknown era drum');
  const rate = rateFor(sampleRate), index = DRUMS.indexOf(drum);
  const duration = [.50, .36, 1.2, .48, .24][index], output = new Float32Array(Math.round(rate * duration));
  const seed = 0xdecaf + index * 487;
  if (skin === 'history') {
    if (drum === 'kick') {
      // Timpani: a pitched membrane family and a soft mallet contact.
      for (const [i, ratio] of [1, 1.50, 1.99, 2.44, 3.02].entries()) {
        mode(output, 0, duration, 58 * ratio, [1, .31, .18, .10, .055][i], .25 / (1 + i * .36), rate, i * .13);
      }
      noiseBurst(output, 0, .016, .045, .0035, rate, seed, .08);
    } else if (drum === 'snare') {
      // A low cello string plucked near the bridge, deliberately not a snare analogue.
      for (let harmonic = 1; harmonic <= 13; harmonic++) {
        const stiff = 98 * harmonic * Math.sqrt(1 + .00012 * harmonic * harmonic);
        mode(output, 0, duration, stiff, Math.sin(Math.PI * harmonic * .18) / harmonic ** 1.32,
          .21 / (1 + harmonic * .07), rate, harmonic * .04);
      }
      mode(output, 0, .24, 191, .12, .09, rate);
      noiseBurst(output, 0, .010, .025, .0022, rate, seed, .12);
    } else if (drum === 'crash') {
      // Stylized Balinese bronze color: a beating, inharmonic gong family.
      for (const [i, ratio] of [1, 1.023, 1.52, 2.14, 2.76, 3.61, 4.48, 5.73].entries()) {
        mode(output, 0, duration, 188 * ratio, .34 / (1 + i * .31), .62 / (1 + i * .09), rate, i * .63);
      }
      noiseBurst(output, 0, .012, .035, .0028, rate, seed, .3);
    } else if (drum === 'tom') {
      // A dry hand-drum voice with pitched skin modes and a brief finger contact.
      for (const [i, ratio] of [1, 1.59, 2.14, 2.92, 4.06].entries()) {
        mode(output, 0, duration, 126 * ratio, [1, .32, .17, .08, .035][i], .17 / (1 + i * .45), rate, i * .17);
      }
      noiseBurst(output, 0, .018, .065, .004, rate, seed, .13);
    } else {
      // Paired bronze cymbals: finite modal shimmer, without a hi-hat noise bed.
      for (const [i, ratio] of [1, 1.39, 1.91, 2.68, 3.55, 4.72, 6.08].entries()) {
        mode(output, 0, duration, 930 * ratio, .30 / (1 + i * .38), .095 / (1 + i * .08), rate, i * .51);
      }
    }
  } else if (drum === 'kick') {
    vectorPacket(output, 0, duration, 43, 1, .20, rate,
      { ratios: [1, 1.007, 2.01, 3.03], bend: 1.65, buzz: .48, cross: .72 });
    vectorPacket(output, .018, .22, 91, .25, .055, rate,
      { ratios: [1, 1.5, 2.17, 4.02], bend: -.38, buzz: .72, cross: .45 });
    gooFilter(output, rate, 72, 2300, .62, 1.9, 2.5);
  } else if (drum === 'snare') {
    for (const [i, at] of [0, .012, .029].entries()) vectorPacket(output, at, duration - at, 310 + i * 113, [.72, .58, .44][i], .065, rate,
      { ratios: [1, 1.414, 2.71, 4.03], bend: [.46, -.31, .18][i], buzz: .95, cross: 1.15 });
    gooFilter(output, rate, 260, 6200, 2.8, 2.35, 3.1, .11);
  } else if (drum === 'crash') {
    vectorPacket(output, 0, duration, 184, .84, .54, rate,
      { ratios: [1, 1.307, 2.173, 3.891], bend: .19, buzz: .86, cross: 1.2 });
    vectorPacket(output, .027, duration - .027, 367, .37, .41, rate,
      { ratios: [1, 1.619, 2.037, 4.707], bend: -.08, buzz: 1, cross: .93 });
    gooFilter(output, rate, 230, 6800, 1.45, 2.7, 3.2, .24);
  } else if (drum === 'tom') {
    vectorPacket(output, 0, duration, 104, 1, .17, rate,
      { ratios: [1, 1.021, 2.76, 5.39], bend: .72, buzz: .68, cross: .88 });
    vectorPacket(output, .024, .28, 227, .24, .085, rate,
      { ratios: [1, 1.503, 2.23, 3.97], bend: -.22, buzz: .92, cross: .72 });
    gooFilter(output, rate, 88, 3600, 1.9, 2.45, 2.8, .31);
  } else {
    for (const [i, at] of [0, .015, .037, .061].entries()) vectorPacket(output, at, duration - at, 980 + i * 271, [.42, .34, .28, .22][i], .044, rate,
      { ratios: [1, 1.113, 1.731, 2.607], bend: [0, .13, -.09, .19][i], buzz: 1.15, cross: 1.3 });
    gooFilter(output, rate, 820, 7000, 3.7, 2.15, 3.4, .07);
  }
  return finish(output, rate, .18);
}
