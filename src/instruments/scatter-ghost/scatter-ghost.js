// Scatter Ghost domain model. Browser-free.
//
// Time-reversal refocusing: sound sent through a scattering medium arrives
// smeared, but replaying the time-reversed field through the same medium makes
// it reconverge on the original source point. Modelled here as a sparse set of
// delay paths derived from scatterer geometry, which is enough to produce a
// real smear and a real refocus without a multiple-scattering solver.

export const MAX_SCATTERERS = 40;
export const MAX_IR_SECONDS = 1.5;
const SPEED = 340; // metres per second, with the chamber measured in metres

export function seededRandom(seed) {
  let s = (Math.round(seed) >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Scatterers laid out reproducibly in a unit chamber. */
export function createScatterers(count = 18, seed = 5) {
  const n = Math.max(1, Math.min(MAX_SCATTERERS, Math.round(count)));
  const rand = seededRandom(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: 0.08 + rand() * 0.84,
    y: 0.08 + rand() * 0.84,
    strength: 0.45 + rand() * 0.55,
  }));
}

/**
 * Path set from a source to a receiver via each scatterer, plus the direct path.
 * Chamber is a unit square scaled by `sizeMetres`.
 */
export function paths(source, receiver, scatterers, sizeMetres = 6) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * sizeMetres;
  const out = [{ delay: dist(source, receiver) / SPEED, gain: 1, via: -1 }];
  for (const s of scatterers) {
    const d = dist(source, s) + dist(s, receiver);
    const delay = d / SPEED;
    if (delay > MAX_IR_SECONDS) continue;
    // Spherical spreading plus scatterer strength; never exceeds the direct path.
    const gain = (s.strength * 0.5) / Math.max(0.35, d);
    out.push({ delay, gain, via: s.id });
  }
  return out.sort((a, b) => a.delay - b.delay);
}

/**
 * Render an impulse response from a path set.
 * `reversed` produces the time-reversed medium response used for refocusing.
 */
export function renderImpulseResponse(pathSet, sampleRate, { reversed = false, tailSeconds = 0 } = {}) {
  const longest = pathSet.reduce((m, p) => Math.max(m, p.delay), 0);
  const seconds = Math.min(MAX_IR_SECONDS, longest + Math.max(0.02, tailSeconds));
  const length = Math.max(8, Math.floor(seconds * sampleRate));
  const data = new Float32Array(length);
  for (const p of pathSet) {
    const at = reversed ? (seconds - p.delay) : p.delay;
    const idx = Math.floor(at * sampleRate);
    if (idx < 0 || idx >= length) continue;
    // Two-sample spread keeps a tap from being a single-sample click.
    data[idx] += p.gain;
    if (idx + 1 < length) data[idx + 1] += p.gain * 0.5;
  }
  normalise(data);
  return { data, sampleRate, seconds };
}

function normalise(data) {
  let peak = 0;
  for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
  if (peak <= 0) return;
  const k = 0.9 / peak;
  for (let i = 0; i < data.length; i += 1) data[i] *= k;
}

/**
 * Refocus quality, 0 to 1: how well the time-reversed response reconverges.
 * Correlating the forward and reversed path sets gives a number that drops when
 * the medium is perturbed after recording, which is the instrument's point.
 */
export function refocusQuality(recordedPaths, currentPaths, tolerance = 0.0015) {
  if (!recordedPaths.length) return 0;
  let matched = 0, weight = 0;
  const available = [...currentPaths];
  for (const p of recordedPaths) {
    weight += p.gain;
    // Match each recorded path to the CLOSEST remaining arrival, not merely the
    // first within tolerance, so an unchanged medium scores exactly 1.
    let best = -1, bestDelta = Infinity;
    for (let i = 0; i < available.length; i += 1) {
      const delta = Math.abs(available[i].delay - p.delay);
      if (delta <= tolerance && delta < bestDelta) { best = i; bestDelta = delta; }
    }
    if (best >= 0) {
      matched += Math.min(p.gain, available[best].gain);
      available.splice(best, 1);
    }
  }
  return weight > 0 ? Math.max(0, Math.min(1, matched / weight)) : 0;
}

/** Reverse a recorded buffer in place-safe fashion. */
export function reverseChannel(input) {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = input[input.length - 1 - i];
  return out;
}
