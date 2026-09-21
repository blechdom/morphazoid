// Authored guitar/bass synthesis plus arrangement of the licensed OI sample.
// Recorded drums and audience voices: assets/puggler/CREDITS.md.
export const PUNK_DRUMS = Object.freeze(['kick', 'snare', 'crash', 'tom', 'hat']);
export const PUNK_RIFFS = Object.freeze(['guitar', 'bass', 'oi', 'woo']);
export const PHRASE_TEMPO = 240;
const TAU = Math.PI * 2;
const bound = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
}
// Plucked displacement plus pick-noise excites a recirculating string, with
// separate palm damping. Its transient survives amplifier distortion.
function pluck(output, at, duration, frequency, amplitude, muted, sampleRate, seed) {
  const n = Math.max(8, Math.round(sampleRate / frequency));
  const line = new Float32Array(n), noise = random(seed);
  const pickPosition = .19 + (seed % 7) * .008;
  for (let i = 0; i < n; i++) {
    const position = i / n;
    const displacement = position < pickPosition ? position / pickPosition : (1 - position) / (1 - pickPosition);
    line[i] = displacement - .5 + noise() * .028;
  }
  const start = Math.floor(at * sampleRate), length = Math.floor(duration * sampleRate);
  const loss = muted ? .981 : .996;
  for (let i = 0; i < length && start + i < output.length; i++) {
    const index = i % n, v = line[index];
    line[index] = (v + line[(index + 1) % n]) * .5 * loss;
    const time = i / sampleRate;
    const envelope = Math.min(1, time / .0015) * Math.exp(-time / (muted ? .095 : .36));
    const pick = noise() * Math.exp(-time * 260) * .08;
    output[start + i] += (v + pick) * amplitude * envelope;
  }
}
function ampCabinet(data, sampleRate, drive, bass) {
  let low = 0, previousInput = 0, high = 0;
  const lp = 1 - Math.exp(-TAU * (bass ? 2200 : 4800) / sampleRate), hp = Math.exp(-TAU * (bass ? 28 : 65) / sampleRate);
  for (let i = 0; i < data.length; i++) {
    const distorted = Math.tanh(data[i] * drive);
    high = hp * (high + distorted - previousInput); previousInput = distorted;
    low += lp * (high - low); data[i] = low;
  }
}
function synthStrings(role, sampleRate) {
  const output = new Float32Array(sampleRate * 2);
  const bass = role === 'bass', root = bass ? 41.203 : 82.407;
  // Two bars: muted pedal notes, a rising answer, then an intentional rest.
  const notes = bass ? [0, 0, 0, 7, 0, 12, 10, 7, 0, 0, 3, 5, 7, 5, 3, null]
    : [0, 0, 0, null, 3, 5, 0, 0, 0, 0, 7, 5, 3, 0, 0, null];
  notes.forEach((note, i) => {
    if (note === null) return;
    const muted = i % 4 !== 2 || i === 14;
    const tones = bass ? [0, 12] : [0, 7, 12];
    tones.forEach((interval, string) => {
      pluck(output, i * .125 + string * .0018, muted ? .12 : .24,
        root * 2 ** ((note + interval) / 12), bass ? [1, .13][string] : .55,
        muted, sampleRate, 1981 + i * 31 + string * 177 + (bass ? 440 : 0));
    });
  });
  ampCabinet(output, sampleRate, bass ? 5 : 14, bass);
  return output;
}
// Keep the recorded mouth articulation intact. Three full calls with small
// level accents make the phrase; no synthetic vowels or pitch-stacked choir.
export function renderVocalChant(samples, sampleRate = 22050) {
  // decodeAudioData resamples to the device rate, including 192 kHz devices.
  sampleRate = Math.round(bound(sampleRate, 8000, 192000));
  const output = new Float32Array(Math.round(sampleRate * 1.8));
  const length = Math.min(samples.length, Math.round(sampleRate * .55));
  [.92, 1, .86].forEach((level, call) => {
    const offset = Math.round(call * .6 * sampleRate);
    for (let i = 0; i < length; i++) output[offset + i] = bound(samples[i], -1, 1) * level;
  });
  return output;
}
export function renderPunkPhrase(role, sampleRate = 22050) {
  sampleRate = Math.round(bound(sampleRate, 8000, 96000));
  if (!['guitar', 'bass'].includes(role)) throw new Error(`Unknown synthesized phrase: ${role}`);
  const data = synthStrings(role, sampleRate);
  let peak = 0, mean = 0;
  for (const x of data) mean += x;
  mean /= data.length;
  for (let i = 0; i < data.length; i++) { data[i] -= mean; peak = Math.max(peak, Math.abs(data[i])); }
  const edge = Math.round(sampleRate * .004);
  for (let i = 0; i < data.length; i++) {
    const fade = Math.min(1, i / edge, (data.length - 1 - i) / edge);
    data[i] *= .9 / Math.max(.001, peak) * fade;
  }
  return data;
}
