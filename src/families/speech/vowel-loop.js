// Match positive-going periods in the steady vowel body. Held vowels use the
// audio source's sample-clock loop; no JavaScript timer sustains the sound.
export function sustainPoints(samples, rate) {
  const crossings = [];
  for (let i = Math.floor(samples.length * .25); i < samples.length * .72; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings.push(i);
  }
  let best = null;
  for (let i = 0; i < crossings.length; i++) for (let j = i + 1; j < crossings.length; j++) {
    const start = crossings[i], end = crossings[j], length = end - start;
    if (length < rate * .025 || length > rate * .08) continue;
    let error = 0;
    for (let k = -12; k <= 12; k++) error += (samples[start + k] - samples[end + k]) ** 2;
    if (!best || error < best.error) best = { start, end, error };
  }
  return best ? { sustainStart: best.start / rate, sustainEnd: best.end / rate } : { sustainStart: 0, sustainEnd: 0 };
}
