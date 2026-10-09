import { CASCADING_PM_RHYTHM_PRESETS } from "../../families/cascading/rhythm-presets.js";

// Preserve stable IDs/order, but voice the AM bank for immediate sound demos.
// Low PM carriers and very slow nested modulation were poor AM starting points.
// Every root moves at least twice per second; audio-rate scenes expose AM's
// harmonic/inharmonic sidebands without a long evolution or additional effects.
const voicings = {
  "slow-steps": ["Neon Chop", 2, 2, 150, 0.99, 1,
    "A clear 300 Hz tone chopped twice per second. Start here for an immediate, deep amplitude pulse."],
  "simple-sway": ["Quick Sway", 2, 5, 66, 0.9, 1,
    "A quick five-per-second tremolo on a 330 Hz tone. Pull AM depth down to hear the steady carrier underneath."],
  "nested-sway": ["Flutter Coil", 3, 3, 10, 0.98, 1.5,
    "A 3 Hz pulse reshapes a rough 30 Hz flutter around a 300 Hz tone. Two layers of movement are audible immediately."],
  "pocket-pulse": ["Strobe", 2, 11, 40, 1, 1,
    "An 11 Hz amplitude shutter turns a 440 Hz sine into a fast, chattering tone."],
  "triplet-walk": ["Harmonic Buzz", 3, 36, 3, 1, 1,
    "Tripled oscillator frequencies build a compact harmonic buzz. AM depth moves between the clear 324 Hz carrier and its surrounding partials."],
  "skipping-stones": ["Tin Teeth", 3, 41, 3.37, 0.96, 1.3,
    "Uneven frequency spacing gives the 466 Hz carrier a thin metallic edge. Adjust the ratio to shift the inharmonic sidebands."],
  "drifting-beats": ["Steel Cluster", 4, 82, 1.52, 0.98, 0.95,
    "Closely spaced operators create a wide cluster above and below the 288 Hz carrier. A dense metallic tone from the first moment."],
  "long-short": ["Wire Choir", 4, 60, 2.1, 0.92, 1.4,
    "Four amplitude stages surround a 556 Hz carrier with unevenly spaced partials. Depth taper changes the strength of the layered edge."],
  "slow-tide": ["Hollow Reed", 3, 75, 2, 0.99, 1.4,
    "Octave-spaced operators add lower and upper partials around a 300 Hz sine, making a hollow, reedy tone."],
  "quick-feet": ["Motor", 2, 90, 8, 0.96, 1,
    "A 90 Hz amplitude modulator puts a fast buzz around a bright 720 Hz carrier. This is audio-rate AM rather than slow tremolo."],
  "off-centre": ["Bellwire", 4, 87, 2.27, 0.97, 1.15,
    "Inharmonic sidebands surround a bright 1018 Hz carrier with a sustained, bell-like edge. The tone begins immediately."],
  "busy-weave": ["Arc Weld", 5, 110, 1.83, 0.96, 1.05,
    "Five audio-rate stages form a bright 1234 Hz metallic cluster. Move the cascade ratio for a direct change in the partial spacing."],
};

export const CASCADING_AM_RHYTHM_PRESETS = Object.freeze(CASCADING_PM_RHYTHM_PRESETS.map(preset => {
  const [label, stages, rootHz, cascadeRatio, modulationDepth, depthTaper, description] = voicings[preset.id];
  return Object.freeze({ ...preset, label, description,
    motion: rootHz < 20 ? "rhythmic" : "timbral",
    settings: Object.freeze({ stages, rootHz, cascadeRatio, modulationDepth, depthTaper }),
  });
}));
