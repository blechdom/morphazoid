// Crab Loom domain model. Browser-free: no Web Audio, DOM, or Canvas.
//
// A Mobius band is a loop plus an involution: a transform T with T*T = identity.
// That constraint is why an odd-twist band has a two-lap period, and it is the
// same structure as a crab canon, where a line sounds against its own retrograde.

export const INVOLUTIONS = Object.freeze([
  Object.freeze({ id: "retrograde", label: "Retrograde", note: "lap two plays the line backwards — the crab canon" }),
  Object.freeze({ id: "inversion", label: "Inversion", note: "lap two mirrors the line about its centre pitch" }),
  Object.freeze({ id: "table", label: "Retrograde + inversion", note: "both at once — what a physical strip does" }),
  Object.freeze({ id: "lane", label: "Track-lane swap", note: "lap two reads the other recorded lane, as real Mobius cartridges did" }),
  Object.freeze({ id: "polarity", label: "Polarity flip", note: "lap two is phase-inverted and cancels against lap one" }),
  Object.freeze({ id: "stereo", label: "Left/right swap", note: "the stereo image mirrors" }),
  Object.freeze({ id: "tritone", label: "Tritone transpose", note: "a tritone is its own inverse, so two laps return home" }),
]);

export const INVOLUTION_IDS = Object.freeze(INVOLUTIONS.map((v) => v.id));

export function involutionById(id) {
  return INVOLUTIONS.find((v) => v.id === id) ?? INVOLUTIONS[0];
}

/** A band with an odd number of half-twists is one-sided, so its period doubles. */
export function isOneSided(halfTwists) {
  return Math.abs(Math.round(halfTwists)) % 2 === 1;
}

/** Laps required before the band returns to its exact starting state. */
export function lapsPerPeriod(halfTwists) {
  return isOneSided(halfTwists) ? 2 : 1;
}

/**
 * Cutting a band lengthwise. The classic results, which are deliberately
 * counter-intuitive: centre-cutting a Mobius band yields ONE band of double
 * length, not two halves.
 *
 * @param {number} halfTwists integer count of half twists
 * @param {number} offset 0 for a centre cut, up to 0.49 toward the edge
 * @returns {{pieces: Array<{lengthRatio:number, halfTwists:number}>, linked:boolean, description:string}}
 */
export function cutBand(halfTwists, offset = 0) {
  const h = Math.abs(Math.round(halfTwists));
  const centre = Math.abs(offset) < 0.08;
  if (isOneSided(h)) {
    if (centre) {
      return {
        pieces: [{ lengthRatio: 2, halfTwists: 2 * h + 2 }],
        linked: false,
        description: "One band, twice as long. A centre cut does not halve a one-sided band.",
      };
    }
    return {
      pieces: [
        { lengthRatio: 1, halfTwists: h },
        { lengthRatio: 2, halfTwists: 2 * h + 2 },
      ],
      linked: true,
      description: "Two linked bands of different lengths — a ratio you did not choose.",
    };
  }
  if (centre) {
    return {
      pieces: [
        { lengthRatio: 1, halfTwists: h },
        { lengthRatio: 1, halfTwists: h },
      ],
      linked: h > 0,
      description: h > 0 ? "Two equal bands, linked." : "Two separate equal bands.",
    };
  }
  return {
    pieces: [
      { lengthRatio: 1 - Math.abs(offset) * 2, halfTwists: h },
      { lengthRatio: 1, halfTwists: h },
    ],
    linked: h > 0,
    description: "Two bands of unequal width running at related lengths.",
  };
}

/** Composite period in laps for a set of pieces with integer length ratios. */
export function compositePeriod(pieces) {
  const laps = pieces.map((p) => Math.max(1, Math.round(p.lengthRatio)) * lapsPerPeriod(p.halfTwists));
  return laps.reduce((a, b) => lcm(a, b), 1);
}

function gcd(a, b) { return b === 0 ? Math.abs(a) : gcd(b, a % b); }
function lcm(a, b) { return Math.abs(a * b) / Math.max(1, gcd(a, b)); }

/**
 * Read position and transform for a head, given the band phase.
 * Returns the fraction along the recording to read and which involution stage
 * applies. Stage 0 is untransformed; stage 1 has the involution applied.
 */
export function headState(phase01, headOffset01, halfTwists) {
  const laps = lapsPerPeriod(halfTwists);
  const total = ((phase01 + headOffset01) % 1 + 1) % 1;
  if (laps === 1) return { read01: total, stage: 0 };
  // Over a two-lap period the band presents each point twice, once per face.
  const wrapped = ((phase01 + headOffset01) % laps + laps) % laps;
  const stage = wrapped >= 1 ? 1 : 0;
  return { read01: wrapped % 1, stage };
}

/** Where the involution is applied, as a fraction around the band. */
export function seamCrossed(previousPhase, nextPhase, seam01) {
  const a = ((previousPhase % 1) + 1) % 1;
  const b = ((nextPhase % 1) + 1) % 1;
  if (b >= a) return seam01 > a && seam01 <= b;
  return seam01 > a || seam01 <= b;
}
