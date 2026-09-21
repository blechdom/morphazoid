// Historical fixture names mapped to current source locations.
import { readFileSync } from "node:fs";
const modelMoves = JSON.parse(readFileSync(new URL("../../docs/source-module-layout.json", import.meta.url), "utf8")).moves;
export const relocatedSources = Object.freeze({
  "loop-network-app.js": "src/families/starting-instruments/loop-network-app.js",
  "app.js": "src/instruments/shape-synth/shape-synth-app.js",
  "shape-drums-app.js": "src/instruments/shape-drum-machine/shape-drum-machine-app.js",
  "solid-app.js": "src/instruments/solid-synth/solid-synth-app.js",
  "solid-drums-app.js": "src/instruments/solid-drum-machine/solid-drum-machine-app.js",
  "hyper-app.js": "src/instruments/hyper-synth/hyper-synth-app.js",
  "hyper-drums-app.js": "src/instruments/hyper-drum-machine/hyper-drum-machine-app.js",
  "nonorientable-app.js": "src/families/nonorientable/nonorientable-app.js",
  "l-system-app.js": "src/instruments/l-system/l-system-app.js",
  "l-system-drums-app.js": "src/instruments/l-system-drum-machine/l-system-drum-machine-app.js",
  "l-systems-app.js": "src/instruments/l-systems/l-systems-app.js",
  "lattice-app.js": "src/instruments/lattice/lattice-app.js",
  "lattice-drums-app.js": "src/instruments/lattice-drum-machine/lattice-drum-machine-app.js",
  "spiral-app.js": "src/instruments/spiral/spiral-app.js",
  "spiral-drums-app.js": "src/instruments/spiral-drum-machine/spiral-drum-machine-app.js",
  "graph-synth-app.js": "src/instruments/graph-synth/graph-synth-app.js",
  "graph-drums-app.js": "src/instruments/graph-drum-machine/graph-drum-machine-app.js",
  "graph-delay-app.js": "src/instruments/graph-delay/graph-delay-app.js",
  "graphs-app.js": "src/instruments/graphs/graphs-app.js",
  "annealogue-app.js": "src/instruments/annealogue/annealogue-app.js",
  "bell-square-app.js": "src/instruments/bell-square/bell-square-app.js",
  "cascading-fm-app.js": "src/instruments/cascading-fm/cascading-fm-app.js",
  "cascading-pm-app.js": "src/instruments/cascading-pm/cascading-pm-app.js",
  "chaotic-fm-app.js": "src/instruments/chaotic-fm/chaotic-fm-app.js",
  "chaotic-pm-app.js": "src/instruments/chaotic-pm/chaotic-pm-app.js",
  "digestazoid-app.js": "src/instruments/digestazoid/digestazoid-app.js",
  "enveloper-app.js": "src/instruments/enveloper/enveloper-app.js",
  "karplus-carpet-app.js": "src/instruments/karplus-carpet/karplus-carpet-app.js",
  "karplus-strong-app.js": "src/instruments/karplus-strong/karplus-strong-app.js",
  "linear-drums-app.js": "src/instruments/linear-drums/linear-drums-app.js",
  "linear-drums-machine-app.js": "src/instruments/rattlesnake-skin/rattlesnake-skin-app.js",
  "lumber-app.js": "src/instruments/lumber/lumber-app.js",
  "physics-app.js": "src/families/physics/physics-app.js",
  "plasma-ball-app.js": "src/instruments/plasma-ball/plasma-ball-app.js",
  "quantum-square-dance-app.js": "src/instruments/quantum-square-dance/quantum-square-dance-app.js",
  "recursion-app.js": "src/instruments/recursion/recursion-app.js",
  "recursive-fm-app.js": "src/instruments/recursive-fm/recursive-fm-app.js",
  "recursive-pm-app.js": "src/instruments/recursive-pm/recursive-pm-app.js",
  "throat-singing-app.js": "src/instruments/throat-singing/throat-singing-app.js",
  "weierstrass-app.js": "src/instruments/weierstrass/weierstrass-app.js",
  "throatazoid-app.js": "src/instruments/throatazoid/throatazoid-app.js",
  "alien-larynx-app.js": "src/instruments/alien-larynx/alien-larynx-app.js"
});

export function currentSourcePath(file) {
  const controller = relocatedSources[file] ?? file;
  return modelMoves[controller] ?? controller;
}
