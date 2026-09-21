// Freeze Point domain model. Browser-free.
//
// A lattice of resonators whose site frequencies are randomly detuned. Below a
// disorder threshold an excitation spreads across the grid; above it the modes
// localize and energy stays trapped near where it entered. The threshold is the
// identity of the instrument, so the model exposes it directly.

export const MAX_SIDE = 12;
export const MAX_SOUNDING = 48;

export function seededRandom(seed) {
  let s = (Math.round(seed) >>> 0) || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Build a square lattice with reproducible per-site detuning. */
export function createLattice({ side = 8, seed = 11, baseHz = 180, spanOctaves = 2.4 } = {}) {
  const n = Math.max(2, Math.min(MAX_SIDE, Math.round(side)));
  const rand = seededRandom(seed);
  const sites = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const t = (x + y) / Math.max(1, 2 * (n - 1));
      sites.push({
        index: y * n + x,
        x, y,
        baseHz: baseHz * (2 ** (t * spanOctaves)),
        offset: rand() * 2 - 1,   // fixed disorder pattern, scaled at read time
        energy: 0,
      });
    }
  }
  return Object.freeze({ side: n, seed, sites });
}

/** Site frequency at a given disorder strength. */
export function siteFrequency(site, disorder) {
  return site.baseHz * (2 ** (site.offset * disorder * 0.5));
}

/**
 * Effective transfer between neighbours. Coupling only moves energy when the
 * two sites are close enough in frequency; disorder detunes them apart, so
 * transfer collapses as disorder rises. This is the mechanism that produces a
 * threshold rather than a gradual dulling.
 */
export function transfer(siteA, siteB, disorder, coupling) {
  const fa = siteFrequency(siteA, disorder);
  const fb = siteFrequency(siteB, disorder);
  const detuneOctaves = Math.abs(Math.log2(Math.max(1e-6, fb / fa)));
  const overlap = 1 / (1 + (detuneOctaves / Math.max(1e-4, coupling * 0.35)) ** 2);
  return Math.max(0, Math.min(1, coupling * overlap));
}

export function neighbours(lattice, index) {
  const { side } = lattice;
  const x = index % side;
  const y = Math.floor(index / side);
  const out = [];
  if (x > 0) out.push(index - 1);
  if (x < side - 1) out.push(index + 1);
  if (y > 0) out.push(index - side);
  if (y < side - 1) out.push(index + side);
  return out;
}

/**
 * Spread a unit excitation and report how far it reaches. Returns the
 * participation ratio: roughly the number of sites sharing the energy. Low
 * values mean localized, high values mean extended. This is what the readout
 * shows and what the threshold is measured against.
 */
export function participationRatio(lattice, originIndex, disorder, coupling, steps = 48) {
  const amp = new Float64Array(lattice.sites.length);
  amp[originIndex] = 1;
  const next = new Float64Array(amp.length);
  for (let step = 0; step < steps; step += 1) {
    next.set(amp);
    for (let i = 0; i < amp.length; i += 1) {
      if (amp[i] < 1e-9) continue;
      for (const j of neighbours(lattice, i)) {
        const t = transfer(lattice.sites[i], lattice.sites[j], disorder, coupling) * 0.22;
        next[j] += amp[i] * t;
        next[i] -= amp[i] * t;
      }
    }
    amp.set(next);
  }
  let sum = 0, sumSq = 0;
  for (let i = 0; i < amp.length; i += 1) { const p = amp[i] * amp[i]; sum += p; sumSq += p * p; }
  if (sumSq <= 0) return 1;
  return (sum * sum) / sumSq;
}

/** Locate the disorder value where spreading collapses, for the readout. */
export function findThreshold(lattice, originIndex, coupling, { lo = 0, hi = 3, passes = 14 } = {}) {
  const extendedAt = participationRatio(lattice, originIndex, lo, coupling);
  const target = Math.max(2, extendedAt * 0.25);
  let a = lo, b = hi;
  for (let i = 0; i < passes; i += 1) {
    const mid = (a + b) / 2;
    if (participationRatio(lattice, originIndex, mid, coupling) > target) a = mid; else b = mid;
  }
  return (a + b) / 2;
}
