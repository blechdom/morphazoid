import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("site builder publishes runtime files without development material", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "morphazoid-site-"));
  const output = join(temporary, "public");
  try {
    await execFileAsync("node", ["scripts/build-release-site.mjs", output], {
      cwd: root,
    });

    for (const path of [
      "index.html",
      "midi-guide.html",
      "shapes.html",
      "combo.html",
      "combo.css",
      "combo-embed.css",
      "combo-app.js",
      "src/combo-host.js",
      "src/shapes-state.js",
      "src/shapes-scene.js",
      "src/shapes-rhythm.js",
      "src/shapes-profile.js",
      "src/shapes-native-bridge.js",
      "assets/instruments/combo.webp",
      "shape.html",
      "playhead-paint.html",
      "playhead-paint.css",
      "playhead-paint-app.js",
      "src/playhead-paint.js",
      "src/playhead-paint-audio.js",
      "assets/instruments/playhead-paint.webp",
      "enveloper.html",
      "enveloper.css",
      "enveloper-app.js",
      "src/enveloper.js",
      "src/enveloper-audio.js",
      "assets/instruments/enveloper.webp",
      "alien-larynx.html",
      "alien-larynx.css",
      "alien-larynx-app.js",
      "src/alien-larynx-tract-processor.js",
      "assets/instruments/alien-larynx.webp",
      "alien-larynx-architecture.html",
      "alien-larynx-signal-path.svg",
      "syrinx.html",
      "syrinx.css",
      "syrinx-app.js",
      "syrinx-ui.html",
      "syrinx-ui.css",
      "morphynx.html",
      "morphynx.css",
      "morphynx-app.js",
      "src/morphynx.js",
      "assets/instruments/morphynx.webp",
      "hyper-syrinx.html",
      "hyper-syrinx.css",
      "hyper-syrinx-app.js",
      "assets/instruments/hyper-syrinx.webp",
      "tongued-beasts.html",
      "tongued-beasts.css",
      "assets/instruments/tongued-beasts.webp",
      "hybrinx.html",
      "hybrinx.css",
      "src/hybrinx-timeline.js",
      "assets/instruments/hybrinx.webp",
      "monstrozoid.html",
      "monsterzoid.html",
      "colony-syrinx.html",
      "colony-syrinx.css",
      "colony-syrinx-app.js",
      "src/colony-syrinx-graph.js",
      "src/colony-syrinx.js",
      "src/colony-syrinx-processor.js",
      "src/monstrozoid-body.js",
      "assets/instruments/colony-syrinx.webp",
      "wave-pool.html",
      "wave-pool.css",
      "wave-pool-app.js",
      "src/wave-pool.js",
      "src/wave-pool-processor.js",
      "assets/instruments/wave-pool.webp",
      "WAVE_POOL_RESEARCH.md",
      "vector-flight.html",
      "vector-flight.css",
      "vector-flight-app.js",
      "src/vector-flight.js",
      "assets/instruments/vector-flight.webp",
      "surround-field.html",
      "surround-field.css",
      "surround-field-app.js",
      "src/surround-field.js",
      "src/surround-field-recorder.js",
      "src/surround-field-recorder-processor.js",
      "assets/instruments/surround-field.webp",
      "pink-trombonazoid.html",
      "pink-trombonazoid.css",
      "pink-trombonazoid-app.js",
      "src/pink-trombonazoid.js",
      "assets/instruments/pink-trombonazoid.webp",
      "throat-singing.html",
      "throat-singing.css",
      "throat-singing-app.js",
      "src/throat-singing.js",
      "THROAT_SINGING_RESEARCH.md",
      "assets/instruments/throat-singing.webp",
      "src/syrinx.js",
      "src/syrinx-source-models.js",
      "src/syrinx-processor.js",
      "harmonica.html",
      "harmonica.css",
      "harmonica-app.js",
      "src/harmonica.js",
      "src/harmonica-processor.js",
      "assets/instruments/harmonica.webp",
      "hiccup-head.html",
      "hiccup-head.css",
      "hiccup-head-app.js",
      "src/hiccup-head.js",
      "src/hiccup-head-processor.js",
      "assets/audio/hiccup-head-emt140-warm-plate.wav",
      "assets/audio/hiccup-head-york-minster-warm-hall.wav",
      "assets/audio/HICCUP_HEAD_REVERB_ATTRIBUTION.md",
      "assets/instruments/hiccup-head.webp",
      "digestazoid.html",
      "digestazoid.css",
      "digestazoid-app.js",
      "src/digestazoid.js",
      "src/digestazoid-processor.js",
      "DIGESTAZOID_RESEARCH.md",
      "assets/instruments/digestazoid.webp",
      "src/tongue-physics.js",
      "assets/instruments/syrinx.webp",
      "ANIMAL_VOICE_SYNTHESIS_RESEARCH.md",
      "throatazoid-architecture.html",
      "throatazoid-architecture.css",
      "throatazoid-signal-path.svg",
      "gesturama.html",
      "gesturama.css",
      "gesturama-app.js",
      "src/gesturama-core.js",
      "src/gesturama-audio.js",
      "src/gesturama-zones.js",
      "assets/instruments/gesturama.webp",
      "about.html",
      "about.css",
      "THIRD_PARTY_NOTICES.md",
      "music-rooms.html",
      "music-rooms.css",
      "assets/instruments/room-lobby.webp",
      "vocal-effects-room.html",
      "assets/instruments/vocal-effects-room.webp",
      "instrument-share-room.html",
      "assets/instruments/instrument-share-room.webp",
      "morphazoid-roulette.html",
      "assets/instruments/morphazoid-roulette.webp",
      "assets/instruments/drum-roll-please.webp",
      "assets/instruments/ouroborousel.webp",
      "assets/instruments/ourorourobouroboros.webp",
      "assets/instruments/ouroboros.webp",
      "assets/instruments/ouroboros-borealis.webp",
      "assets/instruments/image-to-instrument-3.webp",
      "image-to-instrument-3.html",
      "image-to-instrument-app.js",
      "wheel-of-organs-app.js",
      "image-to-instrument.css",
      "src/image-to-instrument.js",
      "src/wheel-of-organs.js",
      "src/wheel-of-organs-audio.js",
      "spelling-synthesizer.html",
      "spelling-synthesizer.css",
      "spelling-synthesizer-app.js",
      "src/spelling-synthesizer.js",
      "src/spelling-synthesizer-audio.js",
      "src/spelling-diphone-atlas.js",
      "src/spelling-pronunciation.js",
      "src/spelling-vocoder-processor.js",
      "assets/audio/spelling-diphone-kal16.wav",
      "assets/instruments/spelling-synthesizer.webp",
      "vocalzoid.html",
      "vocalzoid.css",
      "vocalzoid-app.js",
      "src/vocalzoid.js",
      "src/vocalzoid-audio.js",
      "src/vocalzoid-bank.js",
      "src/vocalzoid-open-banks.js",
      "assets/audio/vocalzoid-oddvoices-air.wav",
      "assets/audio/vocalzoid-oddvoices-cicada.wav",
      "assets/audio/vocalzoid-oddvoices-quake.wav",
      "assets/audio/vocalzoid-cmu-arctic-bdl.wav",
      "assets/audio/vocalzoid-cmu-arctic-clb.wav",
      "assets/audio/vocalzoid-cmu-arctic-jmk.wav",
      "assets/audio/vocalzoid-cmu-arctic-ksp.wav",
      "assets/audio/vocalzoid-cmu-arctic-slt.wav",
      "assets/instruments/vocalzoid.webp",
      "vendor/oddvoices/LICENSE",
      "vendor/cmu-arctic/COPYING",
      "vendor/cmu-arctic/COPYING-2005",
      "vendor/cmudict/cmudict-en-us.dict",
      "vendor/cmudict/LICENSE",
      "plugins.html",
      "plugins.css",
      "plugins-app.js",
      "src/plugin-catalog.js",
      "wax.html",
      "wax.css",
      "wax-page.js",
      "src/wax-instrument-roles.js",
      "src/wax-midi-routing.js",
      "dist-wax/wax/wax-universal-adapter.js",
      "dist-wax/micromorph.html",
      "dist-wax/micromorph.css",
      "dist-wax/micromorph-app.js",
      "dist-wax/src/micromorph.js",
      "dist-wax/src/micromorph-model-client.js",
      "dist-wax/assets/instruments/micromorph.webp",
      "dist-wax/karplus-carpet.html",
      "dist-wax/karplus-carpet.css",
      "dist-wax/karplus-carpet-app.js",
      "dist-wax/src/karplus-carpet.js",
      "dist-wax/assets/instruments/karplus-carpet.webp",
      "dist-wax/throat-singing.html",
      "dist-wax/throat-singing.css",
      "dist-wax/throat-singing-app.js",
      "dist-wax/src/throat-singing.js",
      "dist-wax/THROAT_SINGING_RESEARCH.md",
      "dist-wax/assets/instruments/throat-singing.webp",
      "dist-wax/harmonica.html",
      "dist-wax/harmonica.css",
      "dist-wax/harmonica-app.js",
      "dist-wax/src/harmonica.js",
      "dist-wax/src/harmonica-processor.js",
      "dist-wax/assets/instruments/harmonica.webp",
      "dist-wax/hiccup-head.html",
      "dist-wax/hiccup-head.css",
      "dist-wax/hiccup-head-app.js",
      "dist-wax/src/hiccup-head.js",
      "dist-wax/src/hiccup-head-processor.js",
      "dist-wax/assets/audio/hiccup-head-emt140-warm-plate.wav",
      "dist-wax/assets/audio/hiccup-head-york-minster-warm-hall.wav",
      "dist-wax/assets/audio/HICCUP_HEAD_REVERB_ATTRIBUTION.md",
      "dist-wax/assets/instruments/hiccup-head.webp",
      "dist-wax/digestazoid.html",
      "dist-wax/digestazoid.css",
      "dist-wax/digestazoid-app.js",
      "dist-wax/src/digestazoid.js",
      "dist-wax/src/digestazoid-processor.js",
      "dist-wax/DIGESTAZOID_RESEARCH.md",
      "dist-wax/assets/instruments/digestazoid.webp",
      "dist-wax/monstrozoid.html",
      "dist-wax/monsterzoid.html",
      "dist-wax/colony-syrinx.html",
      "dist-wax/colony-syrinx.css",
      "dist-wax/colony-syrinx-app.js",
      "dist-wax/src/colony-syrinx-graph.js",
      "dist-wax/src/colony-syrinx.js",
      "dist-wax/src/colony-syrinx-processor.js",
      "dist-wax/src/monstrozoid-body.js",
      "dist-wax/assets/instruments/colony-syrinx.webp",
      "dist-wax/wave-pool.html",
      "dist-wax/wave-pool.css",
      "dist-wax/wave-pool-app.js",
      "dist-wax/src/wave-pool.js",
      "dist-wax/src/wave-pool-processor.js",
      "dist-wax/assets/instruments/wave-pool.webp",
      "dist-wax/WAVE_POOL_RESEARCH.md",
      "dist-wax/moire-drone.html",
      "dist-wax/moire-drone.css",
      "dist-wax/moire-drone-app.js",
      "dist-wax/src/moire-drone.js",
      "dist-wax/assets/instruments/moire-drone.webp",
      "dist-wax/constellation.html",
      "dist-wax/constellation.css",
      "dist-wax/constellation-app.js",
      "dist-wax/src/constellation-composer.js",
      "dist-wax/src/constellation-audio.js",
      "dist-wax/graph-drums.html",
      "dist-wax/graph-synth.html",
      "dist-wax/graph-instruments.css",
      "dist-wax/graph-drums-app.js",
      "dist-wax/graph-synth-app.js",
      "dist-wax/src/graph-drum-audio.js",
      "dist-wax/src/graph-instrument-app.js",
      "dist-wax/src/graph-instruments.js",
      "dist-wax/src/graph-synth-audio.js",
      "dist-wax/assets/instruments/graph-drums.webp",
      "dist-wax/assets/instruments/graph-synth.webp",
      "dist-wax/GRAPH_INSTRUMENTS_RESEARCH.md",
      "dist-wax/enveloper.html",
      "dist-wax/enveloper.css",
      "dist-wax/enveloper-app.js",
      "dist-wax/src/enveloper.js",
      "dist-wax/src/enveloper-audio.js",
      "dist-wax/assets/instruments/enveloper.webp",
      "dist-wax/ouroborousel.html",
      "dist-wax/ouroborousel.css",
      "dist-wax/ouroborousel-app.js",
      "dist-wax/src/ouroborousel.js",
      "dist-wax/assets/instruments/ouroborousel.webp",
      "dist-wax/ourorourobouroboros.html",
      "dist-wax/ourorourobouroboros.css",
      "dist-wax/ourorourobouroboros-app.js",
      "dist-wax/src/ourorourobouroboros.js",
      "dist-wax/assets/instruments/ourorourobouroboros.webp",
      "dist-wax/ouroboros.html",
      "dist-wax/src/ouroboros.js",
      "dist-wax/ouroboros-borealis.html",
      "dist-wax/ouroboros-borealis.css",
      "dist-wax/ouroboros-borealis-app.js",
      "dist-wax/src/ouroboros-borealis.js",
      "dist-wax/assets/instruments/ouroboros-borealis.webp",
      "dist-wax/src/rubix-webgpu-303.js",
      "dist-wax/sliding-puzzle.html",
      "dist-wax/sliding-puzzle.css",
      "dist-wax/sliding-puzzle-app.js",
      "dist-wax/src/sliding-puzzle.js",
      "dist-wax/assets/instruments/sliding-puzzle.webp",
      "dist-wax/assets/instruments/ouroboros.webp",
      "dist-wax/assets/audio/spelling-diphone-kal16.wav",
      "dist-wax/vendor/signalsmith-stretch/SignalsmithStretch.mjs",
      "src/midi-manager.js",
      "src/midi-output-preview.js",
      "src/shape-midi.js",
      "src/fm-drums-midi.js",
      "sample-drums.html",
      "sample-drums.css",
      "sample-drums-app.js",
      "src/sample-drums.js",
      "karplus-strong.html",
      "karplus-strong.css",
      "karplus-strong-app.js",
      "src/karplus-strong.js",
      "assets/instruments/karplus-strong.webp",
      "karplus-carpet.html",
      "karplus-carpet.css",
      "karplus-carpet-app.js",
      "src/karplus-carpet.js",
      "assets/instruments/karplus-carpet.webp",
      "downloads/plugins/chaotic-fm/0.2.1/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
      "downloads/plugins/chaotic-fm/0.2.2/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
      "downloads/plugins/chaotic-fm/0.2.3/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
      "downloads/plugins/chaotic-fm/0.3.0/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
      "app.js",
      "src/audio.js",
      "src/contour-synth-processor.js",
      "l-mic.html",
      "micmic.html",
      "micmic-app.js",
      "micmic.css",
      "micromorph.html",
      "micromorph.css",
      "micromorph-app.js",
      "src/micromorph.js",
      "src/micromorph-model-client.js",
      "assets/instruments/micromorph.webp",
      "shepard-risset.html",
      "shepard-risset-app.js",
      "src/shepard-risset.js",
      "slippery-resynthesis.html",
      "slippery-resynthesis.css",
      "slippery-resynthesis-app.js",
      "src/slippery-resynthesis.js",
      "assets/instruments/slippery-resynthesis.webp",
      "moire-drone.html",
      "moire-drone.css",
      "moire-drone-app.js",
      "src/moire-drone.js",
      "assets/instruments/moire-drone.webp",
      "drum-roll-please.html",
      "drum-roll-please.css",
      "drum-roll-please-app.js",
      "src/drum-roll-please.js",
      "ouroborousel.html",
      "ouroborousel.css",
      "ouroborousel-app.js",
      "src/ouroborousel.js",
      "ourorourobouroboros.html",
      "ourorourobouroboros.css",
      "ourorourobouroboros-app.js",
      "src/ourorourobouroboros.js",
      "ouroboros.html",
      "ouroboros.css",
      "ouroboros-app.js",
      "src/ouroboros.js",
      "ouroboros-borealis.html",
      "ouroboros-borealis.css",
      "ouroboros-borealis-app.js",
      "src/ouroboros-borealis.js",
      "candy-coil-delay.html",
      "sandy-syrup-delay.html",
      "barber-delay.css",
      "barber-delay-app.js",
      "src/barber-delay.js",
      "recursive-fm.html",
      "recursive-fm-app.js",
      "src/recursive-fm.js",
      "cascading-fm.html",
      "cascading-fm.css",
      "cascading-fm-app.js",
      "src/cascading-fm.js",
      "assets/instruments/cascading-fm.webp",
      "recursive-pm.html",
      "recursive-pm.css",
      "recursive-pm-app.js",
      "src/recursive-pm.js",
      "src/recursive-pm-midi.js",
      "cascading-pm.html",
      "cascading-pm.css",
      "cascading-pm-app.js",
      "src/cascading-pm.js",
      "assets/instruments/cascading-pm.webp",
      "chaotic-fm.html",
      "chaotic-fm.css",
      "chaotic-fm-app.js",
      "chaotic-dsp-reference.html",
      "chaotic-dsp-reference.css",
      "chaotic-dsp-reference-page.js",
      "src/chaotic-fm.js",
      "src/chaotic-dsp-reference.js",
      "src/chaotic-fm-flow.js",
      "chaotic-pm.html",
      "chaotic-pm.css",
      "chaotic-pm-app.js",
      "src/chaotic-pm.js",
      "webgpu-303.html",
      "webgpu-303.css",
      "webgpu-303-app.js",
      "src/webgpu-303.js",
      "webgpu-synths.html",
      "webgpu-synths.css",
      "webgpu-synths-app.js",
      "src/webgpu-synths.js",
      "webgpu-dsp-primitives.html",
      "webgpu-dsp-primitives.css",
      "webgpu-dsp-primitives-app.js",
      "src/webgpu-dsp-primitives.js",
      "src/shader-synth-playground-primitive-coverage.js",
      "shader-synth-playground.html",
      "shader-synth-playground.css",
      "shader-synth-playground-app.js",
      "src/shader-synth-playground.js",
      "src/shader-synth-playground-audio-assets.js",
      "src/shader-synth-playground-extra.js",
      "src/shader-synth-playground-atlas.js",
      "src/shader-synth-playground-atlas-routing.js",
      "src/shader-synth-playground-stateful.js",
      "src/shader-synth-playground-state-engine.js",
      "src/shader-synth-playground-visual-state.js",
      "src/shader-synth-playground-advanced-state.js",
      "src/shader-synth-playground-advanced-state-engine.js",
      "src/shader-synth-playground-found-sounds.js",
      "src/shader-synth-playground-fx.js",
      "src/shader-synth-playground-scenes.js",
      "assets/instruments/webgpu-synths.webp",
      "weierstrass.html",
      "weierstrass.css",
      "weierstrass-app.js",
      "src/weierstrass.js",
      "algorithmic-sequencers.html",
      "algorithmic-sequencers.css",
      "algorithmic-sequencers-app.js",
      "src/algorithmic-sequencers.js",
      "algorithmic-scores.html",
      "algorithmic-scores.css",
      "algorithmic-scores-app.js",
      "src/algorithmic-scores.js",
      "dijkstra.html",
      "hanoi.html",
      "minimax.html",
      "nqueens.html",
      "euclid.html",
      "gravity-walk.html",
      "ricochet.html",
      "rigidity.html",
      "rolling-measure.html",
      "falling-forms.html",
      "charge-garden.html",
      "packing-pressure.html",
      "geodesic-drift.html",
      "kinetic-hull.html",
      "physics.css",
      "physics-app.js",
      "src/physics-common.js",
      "src/physics-scenes-shape.js",
      "src/physics-scenes-advanced.js",
      "src/physics-scenes.js",
      "quantum-synths.css",
      "order-tones.html",
      "order-tones-app.js",
      "src/order-tones.js",
      "bell-square.html",
      "bell-square-app.js",
      "src/bell-square.js",
      "quantum-square-dance.html",
      "quantum-square-dance-app.js",
      "src/quantum-square-dance.js",
      "assets/instruments/quantum-square-dance.webp",
      "annealogue.html",
      "annealogue-app.js",
      "src/annealogue.js",
      "fractal-uncertainty.css",
      "cantor-lock.html",
      "cantor-lock-app.js",
      "src/cantor-lock.js",
      "assets/instruments/cantor-lock.webp",
      "escape-dust.html",
      "escape-dust-app.js",
      "src/escape-dust.js",
      "assets/instruments/escape-dust.webp",
      "linebreaker.html",
      "linebreaker-app.js",
      "src/linebreaker.js",
      "assets/instruments/linebreaker.webp",
      "plasma-ball.html",
      "plasma-ball.css",
      "plasma-ball-app.js",
      "src/plasma-ball.js",
      "assets/instruments/plasma-ball.webp",
      "moire-organ.html",
      "chladni-plate.html",
      "spring-choir.html",
      "gear-ratio-drums.html",
      "automata.html",
      "cellular-automata.html",
      "prime-sieve.html",
      "lissajous-orbits.html",
      "pendulum-wave.html",
      "double-pendulum.html",
      "reaction-diffusion.html",
      "atomic-orbitals.html",
      "dna-translator.html",
      "neural-pulse.html",
      "fourier-epicycles.html",
      "gravity-lens.html",
      "orbital-ferris.html",
      "experiments.css",
      "experiments-app.js",
      "src/orbital-ferris.js",
      "assets/instruments/orbital-ferris.webp",
      "shape-drums.html",
      "shape-drums.css",
      "shape-drums-app.js",
      "src/shape-drums.js",
      "escher-tessellation.html",
      "escher-tessellation.css",
      "escher-tessellation-app.js",
      "src/escher-tessellation.js",
      "src/escher-contours.js",
      "src/escher-performance-audio.js",
      "assets/instruments/escher-tessellation.webp",
      "solid-drums.html",
      "solid-drums.css",
      "solid-drums-app.js",
      "src/solid-drums.js",
      "rubix.html",
      "rubix.css",
      "rubix-app.js",
      "src/rubix.js",
      "src/rubix-webgpu-303.js",
      "src/rubix-visibility.js",
      "assets/instruments/rubix.webp",
      "constellation.html",
      "constellation.css",
      "constellation-app.js",
      "src/constellation-composer.js",
      "src/constellation-audio.js",
      "sliding-puzzle.html",
      "sliding-puzzle.css",
      "sliding-puzzle-app.js",
      "src/sliding-puzzle.js",
      "assets/instruments/sliding-puzzle.webp",
      "hyper-rubix.html",
      "hyper-rubix.css",
      "hyper-rubix-app.js",
      "src/hyper-rubix.js",
      "src/hyper-rubix-webgpu-303.js",
      "assets/instruments/hyper-rubix.webp",
      "hyper-drums.html",
      "hyper-drums.css",
      "hyper-drums-app.js",
      "src/hyper-drums.js",
      "l-system-drums.html",
      "l-system-drums.css",
      "l-system-drums-app.js",
      "src/l-system-drums.js",
      "graph-drums.html",
      "graph-synth.html",
      "graph-instruments.css",
      "graph-drums-app.js",
      "graph-synth-app.js",
      "src/graph-drum-audio.js",
      "src/graph-instrument-app.js",
      "src/graph-instruments.js",
      "src/graph-synth-audio.js",
      "assets/instruments/graph-drums.webp",
      "assets/instruments/graph-synth.webp",
      "GRAPH_INSTRUMENTS_RESEARCH.md",
      "linear-drums.html",
      "linear-drums.css",
      "linear-drums-app.js",
      "src/linear-drums.js",
      "karplus-strong.html",
      "karplus-strong.css",
      "karplus-strong-app.js",
      "src/karplus-strong.js",
      "assets/instruments/karplus-strong.webp",
      "karplus-carpet.html",
      "karplus-carpet.css",
      "karplus-carpet-app.js",
      "src/karplus-carpet.js",
      "assets/instruments/karplus-carpet.webp",
      "linear-drums-machine.html",
      "linear-drums-machine.css",
      "linear-drums-machine-app.js",
      "src/linear-drums-machine.js",
      "assets/lumber-loops-wood-loop.webp",
      "morphazoidical/index.html",
      "morphazoidical/PLAN.md",
      "vendor/signalsmith-stretch/LICENSE",
      "vendor/signalsmith-stretch/SignalsmithStretch.mjs",
      "vendor/tactile/tactile.js",
      "dist-wax/index.html",
      "dist-wax/midi-guide.html",
      "dist-wax/chaotic-fm.html",
      "dist-wax/wax.html",
      "dist-wax/wax/wax-host-bootstrap.js",
      "dist-wax/wax/wax-host-bridge.js",
    ]) {
      assert.equal(await exists(join(output, path)), true, `missing ${path}`);
    }

    const publishedNavigation = await readFile(join(output, "nav.js"), "utf8");
    assert.match(
      publishedNavigation,
      /from "\.\/src\/midi-manager\.js"/,
      "the published navigation must resolve its shared MIDI manager import",
    );

    const waxInstrument = await readFile(join(output, "dist-wax", "chaotic-fm.html"), "utf8");
    assert.match(waxInstrument, /data-morphazoid-wax-bootstrap/);
    assert.equal(
      await exists(join(output, "dist-wax", "dist-wax")),
      false,
      "the WAX artifact must not recursively contain a previous WAX artifact",
    );

    const publishedNotices = await readFile(
      join(output, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    assert.match(
      publishedNotices,
      /CMU Flite \/ KAL16 diphone voice/,
      "the packaged sample atlas must travel with its full third-party notice",
    );
    assert.match(
      publishedNotices,
      /PocketSphinx English pronunciation dictionary/,
      "the packaged pronunciation dictionary must travel with its full third-party notice",
    );

    for (const path of [
      "tests",
      ".github",
      ".storybook",
      "stories",
      "storybook-static",
      "scripts",
      "package.json",
      "README.md",
      ".preview-cdp.ps1",
      ".throatazoid-preview.png",
      "audio-engine-lab.html",
      "src/audio-engine-lab.js",
      "analyzer.html",
      "analyzer-app.js",
      "src/analyzer.js",
      "assets/instruments/image-to-instrument-1.webp",
      "assets/instruments/image-to-instrument-2.webp",
      "image-to-instrument-1.html",
      "image-to-instrument-2.html",
      "striped-sludge-delay.html",
    ]) {
      assert.equal(await exists(join(output, path)), false, `published ${path}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("AWS deploy helper builds the complete default artifact and rejects missing explicit artifacts", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "morphazoid-deploy-helper-"));
  const scriptsDirectory = join(temporary, "scripts");
  const binDirectory = join(temporary, "bin");
  const callLog = join(temporary, "calls.log");

  try {
    await Promise.all([
      mkdir(scriptsDirectory, { recursive: true }),
      mkdir(binDirectory, { recursive: true }),
    ]);
    await Promise.all([
      readFile(new URL("../scripts/deploy-aws-site.sh", import.meta.url), "utf8").then((source) => (
        writeFile(join(scriptsDirectory, "deploy-aws-site.sh"), source, "utf8")
      )),
      writeFile(
        join(binDirectory, "npm"),
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          "printf 'npm %s\\n' \"$*\" >> \"$TEST_LOG\"",
          "if [[ \"$*\" = \"run build:deploy\" ]]; then",
          "  mkdir -p \"$PWD/dist/storybook\"",
          "  touch \"$PWD/dist/storybook/index.html\"",
          "  touch \"$PWD/dist/storybook/iframe.html\"",
          "  touch \"$PWD/dist/storybook/index.json\"",
          "fi",
          "",
        ].join("\n"),
        { mode: 0o755 },
      ),
      writeFile(
        join(binDirectory, "aws"),
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          "printf 'aws %s\\n' \"$*\" >> \"$TEST_LOG\"",
          "",
        ].join("\n"),
        { mode: 0o755 },
      ),
    ]);

    const environment = {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      TEST_LOG: callLog,
      AWS_PROFILE: "",
      AWS_SITE_BUCKET: "test-site-bucket",
      AWS_CLOUDFRONT_DISTRIBUTION_ID: "TESTDISTRIBUTION",
      DRY_RUN: "true",
    };

    const defaultRun = await execFileAsync("bash", ["scripts/deploy-aws-site.sh"], {
      cwd: temporary,
      env: environment,
    });
    assert.match(defaultRun.stdout, /Dry run complete/);
    assert.equal(await exists(join(temporary, "dist")), true);

    const initialCalls = await readFile(callLog, "utf8");
    assert.match(initialCalls, /^npm run build:deploy$/m);
    assert.match(initialCalls, /^aws s3 sync /m);
    assert.ok(
      initialCalls.indexOf("npm run build:deploy") < initialCalls.indexOf("aws s3 sync"),
      "the complete deployment build must finish before the S3 sync",
    );

    await assert.rejects(
      execFileAsync("bash", ["scripts/deploy-aws-site.sh", "missing-custom-artifact"], {
        cwd: temporary,
        env: environment,
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Artifact directory does not exist:/);
        assert.match(error.stderr, /npm run build:deploy/);
        return true;
      },
    );
    assert.equal(
      await readFile(callLog, "utf8"),
      initialCalls,
      "a missing explicit artifact must fail before npm or AWS is invoked",
    );

    const incompleteArtifact = join(temporary, "incomplete-artifact");
    await mkdir(incompleteArtifact);
    await assert.rejects(
      execFileAsync("bash", ["scripts/deploy-aws-site.sh", incompleteArtifact], {
        cwd: temporary,
        env: environment,
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Artifact is incomplete: missing storybook\/index\.html/);
        return true;
      },
    );
    assert.equal(
      await readFile(callLog, "utf8"),
      initialCalls,
      "an incomplete explicit artifact must fail before AWS is invoked",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("AWS bootstrap instructions install locked dependencies before building", async () => {
  const bootstrap = await readFile(
    new URL("../scripts/bootstrap-aws-site.sh", import.meta.url),
    "utf8",
  );
  const instructions = bootstrap.slice(bootstrap.indexOf("Then publish once locally:"));

  assert.match(instructions, /npm ci/);
  assert.match(instructions, /npm run build:deploy/);
  assert.ok(instructions.indexOf("npm ci") < instructions.indexOf("npm run build:deploy"));
});

test("CloudFormation keeps the origin private and CI permissions narrow", async () => {
  const template = await readFile(new URL("../infra/site.yml", import.meta.url), "utf8");

  assert.match(template, /BlockPublicAcls:\s+true/);
  assert.match(template, /ObjectOwnership:\s+BucketOwnerEnforced/);
  assert.match(template, /SigningBehavior:\s+always/);
  assert.match(template, /OriginAccessControlId:/);
  assert.match(template, /ValidationMethod:\s+DNS/);
  assert.match(template, /HostedZoneId:\s+Z2FDTNDATAQYW2/);
  assert.match(template, /Type:\s+AAAA/);
  assert.match(template, /Runtime:\s+cloudfront-js-2\.0/);
  assert.match(template, /request\.uri\.endsWith\('\/'\)/);
  assert.match(template, /request\.uri === '\/storybook'/);
  assert.match(template, /token\.actions\.githubusercontent\.com:sub:\s+!Ref GitHubOidcSubject/);
  assert.match(template, /Header:\s+Permissions-Policy/);
  assert.match(template, /Value:\s+microphone=\(self\), camera=\(self\), geolocation=\(\)/);
  assert.match(template, /PathPattern:\s+\/storybook\/\*/);
  assert.match(template, /ResponseHeadersPolicyId:\s+!Ref StorybookSecurityHeaders/);
  assert.match(template, /FrameOption:\s+SAMEORIGIN/);
  assert.match(template, /ContentSecurityPolicy:\s+"frame-ancestors 'self'"/);
  assert.match(template, /FrameOption:\s+DENY/);
  assert.match(template, /Sid:\s+DenyInsecureTransport/);
  assert.match(template, /cloudfront:CreateInvalidation/);
  assert.doesNotMatch(template, /PolicyName:[\s\S]*?route53:\*/);
  assert.doesNotMatch(template, /PolicyName:[\s\S]*?iam:\*/);
});

test("AWS workflow verifies before OIDC deployment and uses repository variables", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-aws.yml", import.meta.url), "utf8");
  const preflightStart = workflow.indexOf("- name: Verify CloudFront is ready for Storybook");
  const publishStart = workflow.indexOf("- name: Publish static files");
  const s3SyncStart = workflow.indexOf("aws s3 sync");

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\s*\n\s+branches:\s+\[main\]/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /npm run build:deploy/);
  assert.match(workflow, /npm run check:storybook-dist/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v6\.2\.3/);
  assert.match(workflow, /id-token:\s+write/);
  assert.match(workflow, /environment:\s*\n\s*#?\s*name:\s+production/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /vars\.AWS_ACCOUNT_ID/);
  assert.match(workflow, /allowed-account-ids:\s+\$\{\{\s+vars\.AWS_ACCOUNT_ID\s+\}\}/);
  assert.match(workflow, /vars\.AWS_DEPLOY_ROLE_ARN/);
  assert.match(workflow, /vars\.AWS_SITE_BUCKET/);
  assert.match(workflow, /vars\.AWS_CLOUDFRONT_DISTRIBUTION_ID/);
  assert.ok(preflightStart >= 0, "the deploy job must include the CloudFront preflight");
  assert.ok(
    preflightStart < publishStart && preflightStart < s3SyncStart,
    "the CloudFront policy preflight must finish before any S3 publication",
  );
  const preflight = workflow.slice(preflightStart, publishStart);
  assert.match(preflight, /https:\/\/morphazoid\.com\/storybook\/__cloudfront-policy-probe__/);
  assert.match(preflight, /probe object is intentionally/);
  assert.match(preflight, /x-frame-options:[^\n]*DENY/i);
  assert.match(preflight, /x-frame-options:[^\n]*SAMEORIGIN/i);
  assert.match(preflight, /content-security-policy:[^\n]*frame-ancestors/i);
  const probeUrlIndex = preflight.indexOf("__cloudfront-policy-probe__");
  const probeCurlStart = preflight.lastIndexOf("curl ", probeUrlIndex);
  const probeCurl = preflight.slice(probeCurlStart, probeUrlIndex);
  assert.ok(probeCurlStart >= 0, "the Storybook preflight must make an HTTP request");
  assert.match(probeCurl, /--head/);
  assert.doesNotMatch(
    probeCurl,
    /--fail/,
    "an intentionally absent Storybook probe object must not fail on its HTTP status",
  );
  assert.match(workflow, /cloudfront wait invalidation-completed/);
  assert.match(workflow, /https:\/\/morphazoid\.com\/morphazoidical\//);
  assert.match(workflow, /https:\/\/morphazoid\.com\/storybook\//);
  assert.match(workflow, /https:\/\/morphazoid\.com\/storybook\/iframe\.html/);
  assert.match(workflow, /https:\/\/morphazoid\.com\/storybook\/index\.json/);
  assert.match(workflow, /x-frame-options:[^\n]*DENY/i);
  assert.match(workflow, /x-frame-options:[^\n]*SAMEORIGIN/i);
  assert.match(workflow, /content-security-policy:[^\n]*frame-ancestors/i);
  assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
});
