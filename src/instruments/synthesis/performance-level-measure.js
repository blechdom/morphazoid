// Static source-level measurement, not a compressor or an integrated-LUFS /
// true-peak meter. The score matches the factory calibrator's transient-aware
// max(K-weighted 400 ms RMS, K-weighted 100 ms RMS - 3 dB).
const db = value => value > 0 ? 20 * Math.log10(value) : -Infinity;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

function weighting(rate) {
  // BS.1770's two filter stages, with the bilinear coefficient parameterization
  // documented by libebur128's ebur128_init_filter. These equations keep the
  // existing 48 kHz calibration weighting at other device sample rates too.
  // https://github.com/jiixyj/libebur128/blob/master/ebur128/ebur128.c
  const k = Math.tan(Math.PI * 1681.974450955533 / rate);
  const q = .7071752369554196, high = 10 ** (3.999843853973347 / 20);
  const middle = high ** .4996667741545416, a0 = 1 + k / q + k * k;
  const shelf = [(high + middle * k / q + k * k) / a0,
    2 * (k * k - high) / a0, (high - middle * k / q + k * k) / a0,
    2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0];
  const r = Math.tan(Math.PI * 38.13547087602444 / rate), rq = .5003270373238773;
  const denominator = 1 + r / rq + r * r;
  return { shelf, highpass: [2 * (r * r - 1) / denominator, (1 - r / rq + r * r) / denominator] };
}

/** Incremental, bounded-memory measurement. Stereo energy is averaged, never summed as audio. */
export function createLevelMeter(rate = 48000) {
  if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) throw new RangeError('Unsupported level-meter sample rate.');
  const { shelf: [b0, b1, b2, a1, a2], highpass: [h1, h2] } = weighting(rate);
  const shortWindow = new Float64Array(Math.round(rate * .1));
  const longWindow = new Float64Array(Math.round(rate * .4));
  const filters = [];
  let frames = 0, energy = 0, peak = 0, nonfinite = 0, channelCount = 0;
  let shortSum = 0, longSum = 0, shortMaximum = 0, longMaximum = 0;
  return {
    push(channels) {
      if (!Array.isArray(channels) || !channels.length) return;
      if (channels.length > 8) throw new RangeError('Level measurement supports at most eight channels.');
      const count = channels[0].length;
      if (!channels.every(channel => channel?.length === count)) throw new RangeError('Level channels must have equal lengths.');
      if (channelCount && channelCount !== channels.length) throw new RangeError('Level channel count changed during measurement.');
      channelCount = channels.length;
      while (filters.length < channelCount) filters.push(new Float64Array(8));
      for (let i = 0; i < count; i++) {
        let raw = 0, weighted = 0;
        for (let c = 0; c < channelCount; c++) {
          let x = channels[c][i];
          if (!Number.isFinite(x)) { nonfinite++; x = 0; }
          peak = Math.max(peak, Math.abs(x));
          raw += x * x;
          const f = filters[c];
          const y = b0 * x + b1 * f[0] + b2 * f[1] - a1 * f[2] - a2 * f[3];
          const z = y - 2 * f[4] + f[5] - h1 * f[6] - h2 * f[7];
          f[1] = f[0]; f[0] = x; f[3] = f[2]; f[2] = y;
          f[5] = f[4]; f[4] = y; f[7] = f[6]; f[6] = z;
          weighted += z * z;
        }
        energy += raw / channelCount;
        weighted /= channelCount;
        const shortAt = frames % shortWindow.length, longAt = frames % longWindow.length;
        shortSum += weighted - shortWindow[shortAt]; shortWindow[shortAt] = weighted;
        longSum += weighted - longWindow[longAt]; longWindow[longAt] = weighted;
        shortMaximum = Math.max(shortMaximum, shortSum);
        longMaximum = Math.max(longMaximum, longSum);
        frames++;
      }
    },
    finish() {
      const shortDb = db(Math.sqrt(shortMaximum / shortWindow.length));
      const longDb = db(Math.sqrt(longMaximum / longWindow.length));
      return { frames, sampleRate: rate, channels: channelCount, duration: frames / rate,
        peak, peakDb: db(peak), rmsDb: db(Math.sqrt(energy / Math.max(1, frames))), nonfinite,
        max100msKWeightedRmsDb: shortDb, max400msKWeightedRmsDb: longDb,
        scoreDb: Math.max(longDb, shortDb - 3), silent: peak < 1e-5 };
    },
  };
}

export function measureLevel(channels, rate = 48000) {
  const meter = createLevelMeter(rate);
  meter.push(channels);
  return meter.finish();
}

/** One fixed gain for the whole phrase; silence and invalid data are never amplified. */
export function gainForLevel(stats, { targetDb = -15, peak = .7, maxDb = 24, safetyDb = 1.5 } = {}) {
  if (!stats || stats.nonfinite || stats.silent || !(stats.peak >= 1e-5) || !Number.isFinite(stats.scoreDb)) return 1;
  const headroom = Math.max(0, finite(safetyDb, 1.5));
  const maximum = Math.max(0, Math.min(84, finite(maxDb, 24)));
  const peakLimit = Math.max(.01, Math.min(.99, finite(peak, .7)));
  const gainDb = Math.min(finite(targetDb, -15) - stats.scoreDb - headroom,
    db(peakLimit / stats.peak) - headroom, maximum);
  return 10 ** (Math.max(-84, gainDb) / 20);
}
