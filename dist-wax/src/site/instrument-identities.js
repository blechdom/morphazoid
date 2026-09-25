/** Public catalogue IDs may change; protocol/storage identities remain compatible. */
export const INSTRUMENT_ID_ALIASES = Object.freeze({
  "shape": "shape-synth",
  "solid": "solid-synth",
  "hyper": "hyper-synth",
  "moebius": "moebius-synth",
  "klein-bottle": "klein-bottle-synth",
  "combo": "shapes",
  "tiles-app": "tesselation",
  "lattice-drums": "lattice-drum-machine",
  "spiral-drums": "spiral-drum-machine",
  "shape-drums": "shape-drum-machine",
  "solid-drums": "solid-drum-machine",
  "hyper-drums": "hyper-drum-machine",
  "l-system-drums": "l-system-drum-machine",
  "graph-drums": "graph-drum-machine",
  "linear-drums-machine": "rattlesnake-skin",
  "colony-syrinx": "monstroid",
  "simd-audio-lab": "simd-lab",
  "tesselation-app": "tesselation"
});
export const LEGACY_INSTRUMENT_IDS = Object.freeze({
  "shape-synth": "shape",
  "solid-synth": "solid",
  "hyper-synth": "hyper",
  "moebius-synth": "moebius",
  "klein-bottle-synth": "klein-bottle",
  "shapes": "combo",
  "tesselation": "tiles-app",
  "lattice-drum-machine": "lattice-drums",
  "spiral-drum-machine": "spiral-drums",
  "shape-drum-machine": "shape-drums",
  "solid-drum-machine": "solid-drums",
  "hyper-drum-machine": "hyper-drums",
  "l-system-drum-machine": "l-system-drums",
  "graph-drum-machine": "graph-drums",
  "rattlesnake-skin": "linear-drums-machine",
  "monstroid": "colony-syrinx",
  "simd-lab": "simd-audio-lab"
});
export const ROUTE_INSTRUMENT_IDS = Object.freeze({
  "gesticules": "gesticulating-hand",
  "shape-synth": "shape-synth",
  "shape": "shape-synth",
  "solid-synth": "solid-synth",
  "solid": "solid-synth",
  "hyper-synth": "hyper-synth",
  "hyper": "hyper-synth",
  "moebius-synth": "moebius-synth",
  "moebius": "moebius-synth",
  "klein-bottle-synth": "klein-bottle-synth",
  "klein-bottle": "klein-bottle-synth",
  "shapes": "shapes",
  "combo": "shapes",
  "tesselation": "tesselation",
  "tiles": "tesselation",
  "lattice-drum-machine": "lattice-drum-machine",
  "lattice-drums": "lattice-drum-machine",
  "spiral-drum-machine": "spiral-drum-machine",
  "spiral-drums": "spiral-drum-machine",
  "shape-drum-machine": "shape-drum-machine",
  "shape-drums": "shape-drum-machine",
  "solid-drum-machine": "solid-drum-machine",
  "solid-drums": "solid-drum-machine",
  "hyper-drum-machine": "hyper-drum-machine",
  "hyper-drums": "hyper-drum-machine",
  "l-system-drum-machine": "l-system-drum-machine",
  "l-system-drums": "l-system-drum-machine",
  "graph-drum-machine": "graph-drum-machine",
  "graph-drums": "graph-drum-machine",
  "rattlesnake-skin": "rattlesnake-skin",
  "linear-drums-machine": "rattlesnake-skin",
  "monstroid": "monstroid",
  "monsterzoid": "monstroid",
  "colony-syrinx": "monstroid",
  "monstrozoid": "monstroid",
  "acoustic-manifold": "acoustic-manifold",
  "adaptive-airway": "adaptive-airway",
  "birdsong-lab": "birdsong-lab",
  "crickets": "crickets",
  "nightingale-manifold": "nightingale-manifold",
  "syrinx-ui": "syrinx-ui",
  "simd-lab": "simd-lab",
  "simd-audio-lab": "simd-lab"
});

export function canonicalInstrumentId(id) {
  return Object.hasOwn(INSTRUMENT_ID_ALIASES, id) ? INSTRUMENT_ID_ALIASES[id] : id;
}

export function legacyInstrumentId(id) {
  const canonical = canonicalInstrumentId(id);
  return Object.hasOwn(LEGACY_INSTRUMENT_IDS, canonical) ? LEGACY_INSTRUMENT_IDS[canonical] : canonical;
}

export function instrumentIdForRouteName(name) {
  return ROUTE_INSTRUMENT_IDS[name] ?? canonicalInstrumentId(name);
}
