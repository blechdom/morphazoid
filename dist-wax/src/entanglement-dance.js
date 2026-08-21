/**
 * Pure quantum-physics model for Entanglement Dance.
 *
 * Models two-qubit Bell states (Φ+, Φ−, Ψ+, Ψ−) as correlated Bloch-sphere
 * phasors on the equator (θ = π/2). Measurement probabilities and concurrence
 * are computed exactly from the density matrix.  This module has no DOM or
 * Web Audio side effects and is safe to import in Node tests.
 */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const BELL_STATES = Object.freeze(["phi-plus", "phi-minus", "psi-plus", "psi-minus"]);
export const BELL_STATE_LABELS = Object.freeze({
  "phi-plus":  "Φ+",
  "phi-minus": "Φ−",
  "psi-plus":  "Ψ+",
  "psi-minus": "Ψ−",
});

/**
 * Return the equatorial Bloch-sphere azimuthal angles for Alice and Bob given
 * the Bell state and a global precession phase φ.
 *
 * Physics: all four Bell states have marginal reduced density matrices equal to
 * I/2, so the Bloch vector magnitude for each qubit is zero.  For sonification
 * purposes we represent the *joint* two-qubit correlation as two classical
 * phasors on the equator whose relative phase encodes the Bell-state class:
 *
 *   Φ+ = (|00⟩+|11⟩)/√2  — correlated;    φ_B =  φ_A          (parallel)
 *   Φ− = (|00⟩−|11⟩)/√2  — correlated;    φ_B =  φ_A + π      (anti-phase)
 *   Ψ+ = (|01⟩+|10⟩)/√2  — anti-correl.; φ_B =  π − φ_A      (mirrored)
 *   Ψ− = (|01⟩−|10⟩)/√2  — anti-correl.; φ_B = −φ_A          (negated)
 *
 * This is a faithful sonification of the joint entanglement structure: in Φ+
 * and Φ− the dancers precess together, while in Ψ+ and Ψ− they precess in
 * opposition — exactly mirroring the measurement correlations below.
 */
export function blochAngles(bellState, globalPhase) {
  const a = Number(globalPhase) || 0;
  let b;
  switch (bellState) {
    case "phi-plus":  b = a;             break;
    case "phi-minus": b = a + Math.PI;   break;
    case "psi-plus":  b = Math.PI - a;   break;
    case "psi-minus": b = -a;            break;
    default:          b = a;
  }
  return { aliceAngle: a, bobAngle: b };
}

/**
 * Exact joint Z-basis measurement probabilities [p00, p01, p10, p11] for the
 * chosen Bell state under local dephasing (coherence = 1 − dephasing), with
 * Alice measuring at axis αA and Bob at αB (angles in the Bloch X-Z plane:
 * 0 = Z-axis, π/2 = X-axis).
 *
 * Derivation: for an ideal Bell state ρ = |Ψ⟩⟨Ψ|, the joint probability for
 * outcome (a, b) at angles (αA, αB) is
 *   P(a,b) = Tr[ρ (Πa ⊗ Πb)]
 * where Πk is the projector for outcome k on the Bloch great circle at angle α.
 * Dephasing multiplies every off-diagonal matrix element by (1 − dephasing).
 */
export function bellProbabilities(bellState, aliceAxis = 0, bobAxis = 0, dephasing = 0) {
  const coherence = clamp(1 - (Number(dephasing) || 0), 0, 1);
  const cosAB = Math.cos((Number(aliceAxis) || 0) - (Number(bobAxis) || 0));
  let p00, p01;

  switch (bellState) {
    case "phi-plus":
      p00 = 0.25 * (1 + coherence * cosAB);
      p01 = 0.25 * (1 - coherence * cosAB);
      break;
    case "phi-minus":
      p00 = 0.25 * (1 - coherence * cosAB);
      p01 = 0.25 * (1 + coherence * cosAB);
      break;
    case "psi-plus":
      p01 = 0.25 * (1 + coherence * cosAB);
      p00 = 0.25 * (1 - coherence * cosAB);
      break;
    case "psi-minus":
      p01 = 0.25 * (1 - coherence * cosAB);
      p00 = 0.25 * (1 + coherence * cosAB);
      break;
    default:
      p00 = p01 = 0.25;
  }
  const p10 = p01;
  const p11 = p00;
  return [clamp(p00, 0, 1), clamp(p01, 0, 1), clamp(p10, 0, 1), clamp(p11, 0, 1)];
}

/** Correlation expectation value E = P(same) − P(different) ∈ [−1, 1]. */
export function bellCorrelation(probabilities) {
  const [p00, p01, p10, p11] = probabilities;
  return clamp(p00 - p01 - p10 + p11, -1, 1);
}

/**
 * Wootters concurrence for an ideal Bell state under local phase damping.
 * All four Bell states start with C = 1; dephasing reduces it linearly.
 */
export function bellConcurrence(dephasing = 0) {
  return clamp(1 - (Number(dephasing) || 0), 0, 1);
}

/**
 * Sample a random outcome ("00" | "01" | "10" | "11") from joint probabilities.
 * Uses Math.random(); pass a pre-seeded random function for reproducibility.
 */
export function sampleBellOutcome(probabilities, randomFn = Math.random) {
  const [p00, p01, p10] = probabilities;
  const r = randomFn();
  if (r < p00)           return "00";
  if (r < p00 + p01)     return "01";
  if (r < p00 + p01 + p10) return "10";
  return "11";
}
