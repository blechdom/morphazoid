// Exceptional domain model. Browser-free.
//
// The standard 2x2 non-Hermitian form: two modes at the same centre frequency,
// coupled by kappa, with balanced gain and loss +/- gamma. Eigenvalues split by
// sqrt(kappa^2 - gamma^2). At gamma = kappa the two eigenvalues and their
// eigenvectors coalesce: the exceptional point. Beyond it the split becomes
// purely imaginary and the modes stop being distinguishable in frequency.

/**
 * @param {number} centreHz mean frequency of both modes
 * @param {number} kappaHz coupling, in Hz of splitting
 * @param {number} gammaHz gain/loss imbalance, same units
 */
export function eigenmodes(centreHz, kappaHz, gammaHz) {
  const k = Math.max(0, kappaHz);
  const g = Math.max(0, gammaHz);
  const disc = k * k - g * g;
  if (disc >= 0) {
    // Below the exceptional point: two distinct real frequencies, equal decay.
    const split = Math.sqrt(disc);
    return {
      broken: false,
      atEP: disc === 0,
      modes: [
        { hz: centreHz - split, growth: 0 },
        { hz: centreHz + split, growth: 0 },
      ],
      split,
    };
  }
  // Beyond it: one frequency, two different decay rates. One mode grows.
  const imag = Math.sqrt(-disc);
  return {
    broken: true,
    atEP: false,
    modes: [
      { hz: centreHz, growth: -imag },
      { hz: centreHz, growth: imag },
    ],
    split: 0,
  };
}

/**
 * Sensitivity to a perturbation. Away from the EP the response is linear in
 * epsilon; approaching it the response goes as sqrt(epsilon). This asymmetry of
 * feel is the instrument's identity, so it is exposed as a number.
 */
export function responseToPerturbation(kappaHz, gammaHz, epsilon) {
  const gap = Math.abs(kappaHz - gammaHz);
  const e = Math.max(0, epsilon);
  if (gap < 1e-6) return Math.sqrt(e) * Math.sqrt(Math.max(1, kappaHz));
  return (e * Math.max(1, kappaHz)) / Math.sqrt(gap * Math.max(1, kappaHz));
}

/** Proximity to the exceptional point, 0 far and 1 exactly on it. */
export function proximity(kappaHz, gammaHz) {
  const k = Math.max(1e-6, kappaHz);
  return Math.max(0, Math.min(1, 1 - Math.abs(k - Math.max(0, gammaHz)) / k));
}

/**
 * Safe gain ceiling. Beyond the EP one mode grows without bound, so the model
 * reports the largest gamma that keeps growth under a chosen headroom.
 */
export function safeGamma(kappaHz, maxGrowthHz = 6) {
  return Math.max(0, kappaHz + maxGrowthHz);
}

/** Ring time for a mode, bounded so a preset can never hang. */
export function decaySeconds(growthHz, baseDecay = 2.2, maxDecay = 12) {
  const scaled = baseDecay / Math.max(0.05, 1 - Math.min(0.94, growthHz / 8));
  return Math.max(0.05, Math.min(maxDecay, scaled));
}
