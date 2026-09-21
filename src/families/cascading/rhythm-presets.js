/**
 * Rhythm-first factory banks, replacing the rejected audio-rate drone banks.
 * Both engines keep their existing equations. Each row chooses an LFO root,
 * ascending time scales and a low/middle audible final sine; only that final
 * stage is heard. FM depths are Hz; PM depths are radians, never interchangeable.
 */
const designs = [
  {
    id: "slow-steps", label: "Slow Steps",
    stages: 4, rootHz: 0.5, cascadeRatio: 5,
    fm: [3, 4], pm: [2.6, 1.5],
    description: "Start here. A two-second sway bends quicker steps into a soft bass pulse. Listen for the slower layer reshaping the faster one.",
  },
  {
    id: "simple-sway", label: "Simple Sway",
    stages: 2, rootHz: 3, cascadeRatio: 32,
    fm: [72, 1], pm: [3.2, 1], pmRatio: 16,
    description: "The simplest example: one 3 Hz LFO bends a low sine. A repeated pitch sway, with no extra operators hiding the relationship.",
  },
  {
    id: "nested-sway", label: "Sway Inside Sway",
    stages: 3, rootHz: 1.5, cascadeRatio: 8,
    fm: [10, 4], pm: [3, 1.5], pmRootHz: 0.75, pmRatio: 10,
    description: "A slow layer reshapes a faster ripple before it reaches the bass. Compare this nested motion with Simple Sway.",
  },
  {
    id: "pocket-pulse", label: "Pocket Pulse",
    stages: 5, rootHz: 0.25, cascadeRatio: 4,
    fm: [1.15, 4], pm: [2, 1.35],
    description: "A four-second phrase contains 1 Hz, 4 Hz and 16 Hz layers. Hear the small pulses change emphasis inside the longer phrase.",
  },
  {
    id: "triplet-walk", label: "Triplet Walk",
    stages: 5, rootHz: 0.65, cascadeRatio: 3,
    fm: [3.1, 3], pm: [2.6, 1.1],
    description: "Each stage runs three times faster than the previous one. Listen for groups of quicker turns leaning against the slow bass motion.",
  },
  {
    id: "skipping-stones", label: "Skipping Stones",
    stages: 6, rootHz: 0.48, cascadeRatio: 2.6,
    fm: [1.8, 2.6], pm: [1.8, 1.15],
    description: "Unequal time scales make the accents shift instead of marching in a straight row. Rounded low-register motion with a changing skip.",
  },
  {
    id: "drifting-beats", label: "Drifting Beats",
    stages: 7, rootHz: 0.92, cascadeRatio: 2.01,
    fm: [2.4, 2.01], pm: [1.6, 1.06],
    description: "Almost-doubled rates gradually slip past one another. Let it run: near-alignments come and go without a programmed drum pattern.",
  },
  {
    id: "long-short", label: "Long / Short",
    stages: 6, rootHz: 0.24, cascadeRatio: 3.2,
    fm: [1.05, 3.2], pm: [2.3, 1.1],
    description: "A little over four seconds in the slow layer, with faster non-integer subdivisions. Listen for stretched gestures and short replies.",
  },
  {
    id: "slow-tide", label: "Slow Tide",
    stages: 6, rootHz: 0.125, cascadeRatio: 4,
    fm: [0.65, 4], pm: [3, 1], pmRatio: 3.4,
    description: "An eight-second root carries several quicker layers toward a low voice. Give the entire slow cycle time to unfold.",
  },
  {
    id: "quick-feet", label: "Quick Feet",
    stages: 5, rootHz: 1.1, cascadeRatio: 3,
    fm: [4.2, 3], pm: [2.05, 1.12],
    description: "A quicker low-frequency root sends changing triples up the chain. A lively bass pattern rather than a bright high-register wall.",
  },
  {
    id: "off-centre", label: "Off-Centre",
    stages: 5, rootHz: 0.45, cascadeRatio: 3.7,
    fm: [2, 3.7], pm: [2.6, 1.1],
    description: "The faster layers do not line up as simple doubles or triples. Follow the moving accents against the relaxed slow sway.",
  },
  {
    id: "busy-weave", label: "Busy Weave",
    stages: 7, rootHz: 1, cascadeRatio: 2.2,
    fm: [2.95, 2.2], pm: [2, 1.04], pmRootHz: 0.7,
    description: "Seven nested time scales form the busiest study in the bank. Moderate depth and a low carrier keep the shifting motion in front.",
  },
];

function compile(kind) {
  return Object.freeze(designs.map(design => {
    const [depth, taper] = design[kind];
    return Object.freeze({
      id: design.id,
      label: design.label,
      description: design.description,
      motion: "rhythmic",
      level: kind === "fm" ? 0.48 : 0.4,
      settings: Object.freeze({
        stages: design.stages,
        rootHz: kind === "pm" ? design.pmRootHz ?? design.rootHz : design.rootHz,
        cascadeRatio: kind === "pm" ? design.pmRatio ?? design.cascadeRatio : design.cascadeRatio,
        ...(kind === "fm" ? { modDepth: depth, depthTaper: taper } : { phaseIndex: depth, indexTaper: taper }),
      }),
    });
  }));
}

export const CASCADING_FM_RHYTHM_PRESETS = compile("fm");
export const CASCADING_PM_RHYTHM_PRESETS = compile("pm");
