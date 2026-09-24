/** Approved sheet taxonomy. These tags are descriptions, not capability claims. */
export const CATALOGUE_TAGS = Object.freeze([
  {
    "id": "geometric",
    "label": "Geometric"
  },
  {
    "id": "app",
    "label": "App"
  },
  {
    "id": "tesselation",
    "label": "Tesselation"
  },
  {
    "id": "fractal",
    "label": "Fractal"
  },
  {
    "id": "instrument",
    "label": "Instrument"
  },
  {
    "id": "sequencer",
    "label": "Sequencer"
  },
  {
    "id": "gpu-audio",
    "label": "GPU Audio"
  },
  {
    "id": "simd-audio",
    "label": "SIMD Audio"
  },
  {
    "id": "physical-model",
    "label": "Physical Model"
  },
  {
    "id": "bioacoustic",
    "label": "Bioacoustic"
  },
  {
    "id": "voice",
    "label": "Voice"
  },
  {
    "id": "audio-effect",
    "label": "Audio Effect"
  },
  {
    "id": "infinite-illusion",
    "label": "Infinite Illusion"
  },
  {
    "id": "synthesizer",
    "label": "Synthesizer"
  },
  {
    "id": "noise",
    "label": "Noise"
  },
  {
    "id": "graphic-ui",
    "label": "Graphic-UI"
  },
  {
    "id": "dispersion",
    "label": "Dispersion"
  },
  {
    "id": "algorithmic",
    "label": "Algorithmic"
  },
  {
    "id": "wip",
    "label": "Work in Progress"
  },
  {
    "id": "2d",
    "label": "2D"
  },
  {
    "id": "3d",
    "label": "3D"
  },
  {
    "id": "4d",
    "label": "4D"
  },
  {
    "id": "recursive",
    "label": "Recursive"
  },
  {
    "id": "drum-machine",
    "label": "Drum Machine"
  },
  {
    "id": "puzzle",
    "label": "Puzzle"
  },
  {
    "id": "acid",
    "label": "Acid"
  },
  {
    "id": "303",
    "label": "303"
  },
  {
    "id": "looper",
    "label": "Looper"
  },
  {
    "id": "graph",
    "label": "Graph"
  },
  {
    "id": "shepard",
    "label": "Shepard"
  },
  {
    "id": "risset",
    "label": "Risset"
  },
  {
    "id": "fft",
    "label": "FFT"
  },
  {
    "id": "resynthesis",
    "label": "Resynthesis"
  },
  {
    "id": "delay",
    "label": "Delay"
  },
  {
    "id": "sonification",
    "label": "Sonification"
  },
  {
    "id": "chaotic",
    "label": "Chaotic"
  },
  {
    "id": "nonlinear",
    "label": "Nonlinear"
  },
  {
    "id": "fm",
    "label": "FM"
  },
  {
    "id": "pm",
    "label": "PM"
  },
  {
    "id": "filter",
    "label": "Filter"
  },
  {
    "id": "surround",
    "label": "Surround"
  },
  {
    "id": "spatial",
    "label": "Spatial"
  },
  {
    "id": "routing",
    "label": "Routing"
  },
  {
    "id": "resonator",
    "label": "Resonator"
  }
].map(tag => Object.freeze(tag)));
export const ADDITIONAL_TAG_IDS = Object.freeze(Object.fromEntries(Object.entries({
  "shape-synth": [
    "2d",
    "synthesizer"
  ],
  "solid-synth": [
    "3d",
    "synthesizer"
  ],
  "hyper-synth": [
    "4d",
    "synthesizer"
  ],
  "moebius-synth": [
    "synthesizer",
    "geometric"
  ],
  "klein-bottle-synth": [
    "synthesizer",
    "geometric"
  ],
  "graph-synth": [
    "fractal",
    "recursive"
  ],
  "shapes": [
    "geometric",
    "synthesizer",
    "sequencer",
    "drum-machine",
    "audio-effect",
    "2d",
    "3d",
    "4d"
  ],
  "l-systems": [
    "fractal",
    "recursive",
    "drum-machine",
    "audio-effect"
  ],
  "graphs": [
    "fractal",
    "recursive",
    "drum-machine",
    "audio-effect"
  ],
  "tesselation": [
    "tesselation",
    "sequencer",
    "drum-machine"
  ],
  "algorithmic-mazes": [],
  "paths": [],
  "lattice": [
    "sequencer"
  ],
  "spiral": [
    "sequencer"
  ],
  "lattice-drum-machine": [
    "sequencer"
  ],
  "spiral-drum-machine": [
    "sequencer"
  ],
  "shape-drum-machine": [],
  "solid-drum-machine": [],
  "hyper-drum-machine": [],
  "l-system-drum-machine": [
    "drum-machine",
    "recursive"
  ],
  "l-system": [
    "recursive",
    "sequencer"
  ],
  "graph-drum-machine": [
    "fractal",
    "recursive",
    "drum-machine"
  ],
  "rattlesnake-skin": [
    "drum-machine"
  ],
  "rubixoids": ["sequencer", "drum-machine", "2d", "3d", "4d", "puzzle"],
  "rubix": [
    "drum-machine",
    "3d",
    "puzzle"
  ],
  "sliding-puzzle": [
    "drum-machine",
    "2d"
  ],
  "hocket-loom": [
    "drum-machine",
    "3d"
  ],
  "hyper-rubix": [
    "drum-machine",
    "4d",
    "puzzle"
  ],
  "webgpu-303": [
    "sequencer",
    "synthesizer",
    "acid",
    "303"
  ],
  "simd-303": [
    "sequencer",
    "synthesizer",
    "acid",
    "303"
  ],
  "simd-chiptune": [
    "synthesizer",
    "sequencer"
  ],
  "simd-synth": [
    "synthesizer",
    "sequencer"
  ],
  "webgpu-chiptune": [
    "synthesizer",
    "sequencer"
  ],
  "jaw-jam": [
    "physical-model",
    "instrument",
    "synthesizer"
  ],
  "webgpu-synths": [
    "sequencer",
    "synthesizer"
  ],
  "srtuss": [
    "sequencer",
    "synthesizer"
  ],
  "shader-synth-playground": [
    "synthesizer"
  ],
  "throatazoid": [
    "voice",
    "synthesizer"
  ],
  "pink-trombonazoid": [
    "voice",
    "sequencer",
    "synthesizer"
  ],
  "throat-singing": [
    "voice",
    "synthesizer"
  ],
  "syrinx": [
    "physical-model"
  ],
  "tongued-beasts": [
    "physical-model"
  ],
  "hybrinx": [
    "physical-model"
  ],
  "creaturazoid": [
    "sequencer",
    "physical-model"
  ],
  "quadruped": [
    "sequencer",
    "drum-machine"
  ],
  "roach-synth": [],
  "spider-synth": [],
  "monstroid": [
    "voice",
    "synthesizer"
  ],
  "blowhole": [
    "sequencer"
  ],
  "jaw-harp": [
    "instrument",
    "synthesizer"
  ],
  "harmonica": [
    "instrument",
    "synthesizer"
  ],
  "julie-saw": [
    "instrument",
    "synthesizer"
  ],
  "hiccup-head": [
    "voice",
    "sequencer"
  ],
  "digestazoid": [],
  "breath-atlas": [],
  "spelling-synthesizer": [],
  "vocalzoid": [
    "synthesizer"
  ],
  "lumber": [
    "looper"
  ],
  "micmic": [
    "fractal",
    "recursive"
  ],
  "graph-delay": [
    "graph"
  ],
  "micromorph": [],
  "shepard-risset": [
    "synthesizer",
    "shepard",
    "risset"
  ],
  "slippery-resynthesis": [
    "audio-effect",
    "shepard",
    "risset",
    "fft",
    "resynthesis"
  ],
  "drum-roll-please": [
    "shepard",
    "risset",
    "drum-machine",
    "sequencer"
  ],
  "ouroborousel": [
    "shepard",
    "risset",
    "drum-machine",
    "sequencer"
  ],
  "ourorourobouroboros": [
    "shepard",
    "risset",
    "drum-machine",
    "sequencer"
  ],
  "ouroboros": [
    "shepard",
    "risset",
    "drum-machine",
    "sequencer"
  ],
  "ouroboros-borealis": [
    "shepard",
    "risset",
    "drum-machine",
    "sequencer"
  ],
  "sandy-syrup-delay": [
    "shepard",
    "risset",
    "audio-effect",
    "delay"
  ],
  "candy-coil-delay": [
    "shepard",
    "risset",
    "audio-effect",
    "delay"
  ],
  "recursion": [],
  "enveloper": [],
  "julia": [
    "sonification"
  ],
  "striped-staircase": [
    "sonification"
  ],
  "recursive-fm": [
    "chaotic",
    "nonlinear",
    "recursive",
    "fm"
  ],
  "recursive-pm": [
    "chaotic",
    "nonlinear",
    "recursive",
    "pm"
  ],
  "chaotic-fm": [
    "chaotic",
    "nonlinear",
    "fm"
  ],
  "chaotic-pm": [
    "chaotic",
    "nonlinear",
    "pm"
  ],
  "cascading-fm": [
    "chaotic",
    "nonlinear",
    "fm"
  ],
  "cascading-pm": [
    "chaotic",
    "nonlinear",
    "pm"
  ],
  "weierstrass": [
    "chaotic",
    "nonlinear"
  ],
  "moire-drone": [
    "filter",
    "2d"
  ],
  "playhead-paint": [],
  "boidzoid": [],
  "puggler": [
    "sequencer"
  ],
  "gesticulating-hand": [
    "3d",
    "synthesizer"
  ],
  "vector-flight": [],
  "gesturama": [],
  "image-to-instrument-3": [],
  "orbital-ferris": [],
  "fm-drums": [
    "drum-machine"
  ],
  "linear-drums": [
    "drum-machine"
  ],
  "karplus-strong": [
    "synthesizer",
    "physical-model"
  ],
  "karplus-carpet": [
    "synthesizer",
    "physical-model"
  ],
  "surround-field": [
    "surround",
    "spatial",
    "routing"
  ],
  "sample-drums": [
    "drum-machine"
  ],
  "object-forge": [],
  "cellular-automata": [
    "sequencer"
  ],
  "sorting-algorithms": [
    "sequencer"
  ],
  "dijkstra": [
    "sequencer"
  ],
  "wave-pool": [],
  "penrose-tilings": [],
  "yoyodyne": [],
  "hanoi": [],
  "minimax": [],
  "nqueens": [],
  "euclid": [],
  "alien-larynx": [],
  "hyper-syrinx": [
    "bioacoustic"
  ],
  "morphynx": [],
  "escher-tessellation": [],
  "plasma-ball": [],
  "simd-resonator": [
    "resonator"
  ],
  "order-tones": [],
  "morphazoidical": [],
  "bell-square": [],
  "entanglement-dance": [],
  "quantum-square-dance": [],
  "annealogue": [],
  "gravity-walk": [],
  "ricochet": [],
  "rigidity": [],
  "rolling-measure": [],
  "falling-forms": [],
  "charge-garden": [],
  "packing-pressure": [],
  "geodesic-drift": [],
  "kinetic-hull": [],
  "moire-organ": [],
  "chladni-plate": [],
  "spring-choir": [],
  "gear-ratio-drums": [],
  "prime-sieve": [],
  "lissajous-orbits": [],
  "pendulum-wave": [],
  "double-pendulum": [],
  "reaction-diffusion": [],
  "atomic-orbitals": [],
  "dna-translator": [],
  "neural-pulse": [],
  "fourier-epicycles": [],
  "gravity-lens": [],
  "cantor-lock": [],
  "escape-dust": [],
  "linebreaker": [],
  "acoustic-manifold": [],
  "adaptive-airway": [],
  "birdsong-lab": [],
  "crickets": [],
  "nightingale-manifold": [],
  "syrinx-ui": [],
  "simd-lab": [
    "simd-audio"
  ],
  "tempo-tantrum": [],
  "tape-worm": [],
  "loop-soup": [],
  "habit-habitat": [],
  "hollowphonic": []
}).map(([id, tags]) => [id, Object.freeze(tags)])));
export const LAB_CATALOGUE_DETAILS = Object.freeze(Object.fromEntries(Object.entries({
  "acoustic-manifold": {
    "kind": "Audio lab",
    "description": "Acoustic Manifold maps local bioacoustic occurrences into a playable 3D graph, then resynthesizes and extrapolates their timing, pitch, body, texture, and order.",
    "start": "Open the existing lab and use its source and playback controls.",
    "features": [],
    "pluginHref": null
  },
  "adaptive-airway": {
    "kind": "Audio lab",
    "description": "Adaptive airway lab: modular animal voice source-filter synthesis with explicit trachea and OEC controls.",
    "start": "Open the existing lab and use its source and playback controls.",
    "features": [],
    "pluginHref": null
  },
  "birdsong-lab": {
    "kind": "Audio lab",
    "description": "Strophe Lab is a local analysis-by-synthesis proof of concept for turning tonal bird recordings into effective syrinx gestures.",
    "start": "Open the existing lab and use its source and playback controls.",
    "features": [],
    "pluginHref": null
  },
  "crickets": {
    "kind": "Audio lab",
    "description": "Crickets is a local, sample-free physical-model instrument that turns a recording into tooth-file impulses and two coupled wing modes.",
    "start": "Open the existing lab and use its source and playback controls.",
    "features": [],
    "pluginHref": null
  },
  "nightingale-manifold": {
    "kind": "Audio lab",
    "description": "Nightingale Manifold maps locally analyzed strophe occurrences into a playable 3D acoustic graph with source-aware and physical-model playback.",
    "start": "Open the existing lab and use its source and playback controls.",
    "features": [],
    "pluginHref": null
  },
  "syrinx-ui": {
    "kind": "Audio lab",
    "description": "Syrinx UI is an unlocked, playable physical-model animal voice instrument for Morphazoid.",
    "start": "Open the existing lab and use its source and playback controls.",
    "features": [],
    "pluginHref": null
  },
  "simd-lab": {
    "kind": "Audio lab",
    "description": "Seven playable WebAssembly SIMD audio demonstrations with clear sources, gestures, and audible presets.",
    "start": "Open the existing lab and use its source and playback controls.",
    "features": [],
    "pluginHref": null
  }
}).map(([id, details]) => [id, Object.freeze({ ...details, features: Object.freeze(details.features) })])));
