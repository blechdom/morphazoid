// "Afterimage": an original, rendered eight-second music track. These voices
// are mixed into PCM once; the tape heads read the finished recording, not
// sequencer events or sounds fired by contact with the ribbon.
export const ORIGINAL_TRACK_SECONDS = 8;
export const ORIGINAL_TRACK_RATE = 24000;
const TAU = Math.PI * 2;
const roots = [110, 130.81, 98, 130.81];

function pad(root, t) {
  return .13 * Math.sin(TAU * root * t + .12 * Math.sin(TAU * .3 * t))
    + .09 * Math.sin(TAU * root * 1.2 * t)
    + .07 * Math.sin(TAU * root * 1.5 * t + .28 * Math.sin(TAU * .17 * t))
    + .023 * Math.sin(TAU * root * 3 * t);
}

export function renderTapezoidTrack(sampleRate = ORIGINAL_TRACK_RATE) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError("Unsupported track sample rate");
  }
  const samples = new Float32Array(Math.floor(ORIGINAL_TRACK_SECONDS * sampleRate));
  let seed = 1947, previousNoise = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    const bar = Math.floor(t / 2), withinBar = t - bar * 2;
    const blend = Math.min(1, withinBar / .13);
    const harmony = pad(roots[(bar + 3) % 4], t) * (1 - blend) + pad(roots[bar], t) * blend;

    const beat = Math.floor(t * 2), beatAge = t - beat * .5;
    const kickPhase = 48 * beatAge + 2.4 * (1 - Math.exp(-beatAge * 32));
    const kick = .26 * Math.sin(TAU * kickPhase) * Math.exp(-beatAge * 19);
    const bassNotes = [1, 1, 1.5, 1, 1, 1.2, 1.5, 1];
    const bassFrequency = roots[bar] * .5 * bassNotes[beat % 8];
    const bass = .15 * (Math.sin(TAU * bassFrequency * t) + .24 * Math.sin(TAU * bassFrequency * 2 * t))
      * (1 - Math.exp(-beatAge * 140)) * Math.exp(-beatAge * 4);

    const step = Math.floor(t * 4), stepAge = t - step * .25;
    const leadNotes = [2, 2.4, 3, 2.4, 2, 1.8, 1.5, 1.8];
    const leadFrequency = roots[bar] * leadNotes[step % 8];
    const lead = .044 * (Math.sin(TAU * leadFrequency * t) + .19 * Math.sin(TAU * leadFrequency * 2.01 * t))
      * (1 - Math.exp(-stepAge * 160)) * Math.exp(-stepAge * 11);

    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const highNoise = noise - previousNoise * .72;
    previousNoise = noise;
    const snare = (beat % 4 === 1 || beat % 4 === 3)
      ? .10 * highNoise * Math.exp(-beatAge * 31) : 0;
    const hat = .027 * highNoise * Math.exp(-stepAge * 52);
    const fade = Math.min(1, t * 125, (ORIGINAL_TRACK_SECONDS - t) * 125);
    samples[i] = Math.tanh((harmony + kick + bass + lead + snare + hat + noise * .002) * 1.2)
      * Math.max(0, fade);
  }
  return samples;
}
