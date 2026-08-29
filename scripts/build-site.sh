#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_arg="${1:-dist}"

if [[ "$output_arg" = /* ]]; then
  output_dir="$(realpath -m "$output_arg")"
else
  output_dir="$(realpath -m "$repo_root/$output_arg")"
fi

case "$output_dir" in
  /|"$repo_root"|"$repo_root/")
    echo "Refusing to replace unsafe output directory: $output_dir" >&2
    exit 1
    ;;
esac

if [[ "$output_dir" != "$repo_root/"* && "$output_dir" != /tmp/* ]]; then
  echo "Output must be inside the repository or /tmp: $output_dir" >&2
  exit 1
fi

rm -rf -- "$output_dir"
mkdir -p -- "$output_dir"

copy_runtime_file() {
  local source_path="$1"
  local destination="$output_dir/$source_path"
  mkdir -p -- "$(dirname "$destination")"
  cp -- "$repo_root/$source_path" "$destination"
}

while IFS= read -r -d '' source_path; do
  [[ -f "$repo_root/$source_path" ]] || continue

  case "$source_path" in
    .github/*|tests/*|morphazoidical/tests/*|scripts/*|dist/*|dist-wax/*)
      continue
      ;;
  esac

  case "$source_path" in
    *.html|*.css|*.js|*.webp|favicon.svg|THIRD_PARTY_NOTICES.md|morphazoidical/PLAN.md|downloads/plugins/*|\
    vendor/tactile/LICENSE|\
    vendor/cmudict/cmudict-en-us.dict|\
    vendor/cmudict/LICENSE|\
    vendor/signalsmith-stretch/LICENSE|\
    vendor/signalsmith-stretch/SignalsmithStretch.mjs)
      copy_runtime_file "$source_path"
      ;;
  esac
done < <(git -C "$repo_root" ls-files -z)

# Allow new public pages to enter local release artifacts before their first
# commit; after tracking, these copies simply refresh the same paths.
for worktree_runtime_file in \
  breath-atlas.html \
  breath-atlas.css \
  breath-atlas-app.js \
  src/breath-atlas.js \
  src/breath-atlas-processor.js \
  assets/instruments/breath-atlas.webp \
  src/shapes-rhythm.js \
  shape.html \
  playhead-paint.html \
  playhead-paint.css \
  playhead-paint-app.js \
  src/playhead-paint.js \
  src/playhead-paint-audio.js \
  assets/instruments/playhead-paint.webp \
  boidzoid.html \
  boidzoid.css \
  boidzoid-app.js \
  src/boidzoid.js \
  assets/instruments/boidzoid.webp \
  striped-staircase.html \
  striped-staircase.css \
  striped-staircase-app.js \
  src/striped-staircase.js \
  src/striped-staircase-audio.js \
  alien-larynx.html \
  alien-larynx.css \
  alien-larynx-app.js \
  src/alien-larynx-tract-processor.js \
  alien-larynx-architecture.html \
  alien-larynx-signal-path.svg \
  syrinx.html \
  syrinx.css \
  syrinx-app.js \
  syrinx-ui.html \
  syrinx-ui.css \
  morphynx.html \
  morphynx.css \
  morphynx-app.js \
  src/morphynx.js \
  tongued-beasts.html \
  tongued-beasts.css \
  assets/instruments/tongued-beasts.webp \
  hybrinx.html \
  hybrinx.css \
  src/hybrinx-layout.js \
  src/hybrinx-timeline.js \
  assets/instruments/hybrinx.webp \
  pink-trombonazoid.html \
  pink-trombonazoid.css \
  pink-trombonazoid-app.js \
  src/pink-trombonazoid.js \
  assets/instruments/pink-trombonazoid.webp \
  hyper-syrinx.html \
  hyper-syrinx.css \
  hyper-syrinx-app.js \
  assets/instruments/hyper-syrinx.webp \
  src/syrinx.js \
  src/syrinx-source-models.js \
  src/syrinx-processor.js \
  src/tongue-physics.js \
  src/tongue-performance.js \
  ANIMAL_VOICE_SYNTHESIS_RESEARCH.md \
  throatazoid-architecture.html \
  throatazoid-architecture.css \
  throatazoid-signal-path.svg \
  gesturama.html \
  gesturama.css \
  gesturama-app.js \
  src/gesturama-core.js \
  src/gesturama-audio.js \
  src/gesturama-zones.js \
  about.html \
  about.css \
  midi-guide.html \
  THIRD_PARTY_NOTICES.md \
  music-rooms.html \
  music-rooms.css \
  assets/instruments/room-lobby.webp \
  vocal-effects-room.html \
  assets/instruments/vocal-effects-room.webp \
  instrument-share-room.html \
  assets/instruments/instrument-share-room.webp \
  morphazoid-roulette.html \
  assets/instruments/morphazoid-roulette.webp \
  instruments.html \
  instrument-catalog.css \
  instrument-catalog-app.js \
  src/instrument-catalog.js \
  wax.html \
  wax.css \
  wax-page.js \
  src/wax-instrument-roles.js \
  src/wax-midi-routing.js \
  image-to-instrument-3.html \
  image-to-instrument-app.js \
  wheel-of-organs-app.js \
  image-to-instrument.css \
  src/image-to-instrument.js \
  src/wheel-of-organs.js \
  src/wheel-of-organs-audio.js \
  spelling-synthesizer.html \
  spelling-synthesizer.css \
  spelling-synthesizer-app.js \
  src/spelling-synthesizer.js \
  src/spelling-synthesizer-audio.js \
  src/spelling-diphone-atlas.js \
  src/spelling-pronunciation.js \
  src/spelling-vocoder-processor.js \
  assets/audio/spelling-diphone-kal16.wav \
  assets/instruments/spelling-synthesizer.webp \
  vocalzoid.html \
  vocalzoid.css \
  vocalzoid-app.js \
  src/vocalzoid.js \
  src/vocalzoid-audio.js \
  src/vocalzoid-bank.js \
  src/vocalzoid-open-banks.js \
  assets/audio/vocalzoid-oddvoices-air.wav \
  assets/audio/vocalzoid-oddvoices-cicada.wav \
  assets/audio/vocalzoid-oddvoices-quake.wav \
  assets/audio/vocalzoid-cmu-arctic-bdl.wav \
  assets/audio/vocalzoid-cmu-arctic-clb.wav \
  assets/audio/vocalzoid-cmu-arctic-jmk.wav \
  assets/audio/vocalzoid-cmu-arctic-ksp.wav \
  assets/audio/vocalzoid-cmu-arctic-slt.wav \
  assets/instruments/vocalzoid.webp \
  vendor/oddvoices/LICENSE \
  vendor/cmu-arctic/COPYING \
  vendor/cmu-arctic/COPYING-2005 \
  vendor/cmudict/cmudict-en-us.dict \
  vendor/cmudict/LICENSE \
  plugins.html \
  plugins.css \
  plugins-app.js \
  assets/lumber-loops-wood-loop.webp \
  src/plugin-catalog.js \
  src/midi-manager.js \
  src/audio-output-manager.js \
  src/browser-midi-adapter.js \
  src/instrument-midi-capabilities.js \
  src/midi-output-preview.js \
  src/chaotic-viewport-controls.js \
  src/shape-midi.js \
  src/fm-drums-midi.js \
  downloads/plugins/chaotic-fm/0.2.1/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx \
  downloads/plugins/chaotic-fm/0.2.2/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx \
  downloads/plugins/chaotic-fm/0.2.3/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx \
  downloads/plugins/chaotic-fm/0.3.0/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx \
  src/recursive-pm-midi.js \
  vendor/signalsmith-stretch/LICENSE \
  sample-drums.html \
  sample-drums.css \
  sample-drums-app.js \
  src/sample-drums.js \
  shape-drums.html \
  shape-drums.css \
  shape-drums-app.js \
  src/shape-drums.js \
  lattice-drums.html \
  lattice-drums.css \
  lattice-drums-app.js \
  src/lattice-drums.js \
  escher-tessellation.html \
  escher-tessellation.css \
  escher-tessellation-app.js \
  src/escher-tessellation.js \
  src/escher-contours.js \
  src/escher-performance-audio.js \
  assets/instruments/escher-tessellation.webp \
  spiral-drums.html \
  spiral-drums.css \
  spiral-drums-app.js \
  src/spiral-drums.js \
  solid-drums.html \
  solid-drums.css \
  solid-drums-app.js \
  src/solid-drums.js \
  rubix.html \
  rubix.css \
  rubix-app.js \
  src/rubix.js \
  src/rubix-webgpu-303.js \
  src/rubix-visibility.js \
  assets/instruments/rubix.webp \
  hyper-rubix.html \
  hyper-rubix.css \
  hyper-rubix-app.js \
  src/hyper-rubix.js \
  src/hyper-rubix-webgpu-303.js \
  assets/instruments/hyper-rubix.webp \
  hyper-drums.html \
  hyper-drums.css \
  hyper-drums-app.js \
  src/hyper-drums.js \
  l-system-drums.html \
  l-system-drums.css \
  l-system-drums-app.js \
  src/l-system-drums.js \
  linear-drums.html \
  linear-drums.css \
  linear-drums-app.js \
  src/linear-drums.js \
  karplus-strong.html \
  karplus-strong.css \
  karplus-strong-app.js \
  src/karplus-strong.js \
  assets/instruments/karplus-strong.webp \
  karplus-carpet.html \
  karplus-carpet.css \
  karplus-carpet-app.js \
  src/karplus-carpet.js \
  assets/instruments/karplus-carpet.webp \
  linear-drums-machine.html \
  linear-drums-machine.css \
  linear-drums-machine-app.js \
  src/linear-drums-machine.js \
  chaotic-dsp-reference.html \
  chaotic-dsp-reference.css \
  chaotic-dsp-reference-page.js \
  src/chaotic-dsp-reference.js \
  src/chaotic-fm-flow.js \
  cascading-fm.html \
  cascading-fm.css \
  cascading-fm-app.js \
  src/cascading-fm.js \
  cascading-pm.html \
  cascading-pm.css \
  cascading-pm-app.js \
  src/cascading-pm.js \
  slippery-resynthesis.html \
  slippery-resynthesis.css \
  slippery-resynthesis-app.js \
  src/slippery-resynthesis.js \
  assets/instruments/slippery-resynthesis.webp \
  drum-roll-please.html \
  drum-roll-please.css \
  drum-roll-please-app.js \
  src/drum-roll-please.js \
  ouroborousel.html \
  ouroborousel.css \
  ouroborousel-app.js \
  src/ouroborousel.js \
  assets/instruments/ouroborousel.webp \
  ourorourobouroboros.html \
  ourorourobouroboros.css \
  ourorourobouroboros-app.js \
  src/ourorourobouroboros.js \
  assets/instruments/ourorourobouroboros.webp \
  ouroboros.html \
  ouroboros.css \
  ouroboros-app.js \
  src/ouroboros.js \
  assets/instruments/ouroboros.webp \
  ouroboros-borealis.html \
  ouroboros-borealis.css \
  ouroboros-borealis-app.js \
  src/ouroboros-borealis.js \
  assets/instruments/ouroboros-borealis.webp \
  chaotic-pm.html \
  chaotic-pm.css \
  chaotic-pm-app.js \
  src/chaotic-pm.js \
  webgpu-303.html \
  webgpu-303.css \
  webgpu-303-app.js \
  src/webgpu-303.js \
  webgpu-synths.html \
  webgpu-synths.css \
  webgpu-synths-app.js \
  src/webgpu-synths.js \
  webgpu-dsp-primitives.html \
  webgpu-dsp-primitives.css \
  webgpu-dsp-primitives-app.js \
  src/webgpu-dsp-primitives.js \
  shader-synth-playground.html \
  shader-synth-playground.css \
  shader-synth-playground-app.js \
  src/shader-synth-playground.js \
  src/shader-synth-playground-extra.js \
  src/shader-synth-playground-found-sounds.js \
  src/shader-synth-playground-fx.js \
  src/shader-synth-playground-scenes.js \
  assets/instruments/webgpu-synths.webp \
  algorithmic-sequencers.html \
  algorithmic-sequencers.css \
  algorithmic-sequencers-app.js \
  src/algorithmic-sequencers.js \
  algorithmic-scores.html \
  algorithmic-scores.css \
  algorithmic-scores-app.js \
  src/algorithmic-scores.js \
  dijkstra.html \
  hanoi.html \
  minimax.html \
  nqueens.html \
  euclid.html \
  gravity-walk.html \
  ricochet.html \
  rigidity.html \
  rolling-measure.html \
  falling-forms.html \
  charge-garden.html \
  packing-pressure.html \
  geodesic-drift.html \
  kinetic-hull.html \
  physics.css \
  physics-app.js \
  src/physics-common.js \
  src/physics-scenes-shape.js \
  src/physics-scenes-advanced.js \
  src/physics-scenes.js \
  quantum-synths.css \
  order-tones.html \
  order-tones-app.js \
  src/order-tones.js \
  bell-square.html \
  bell-square-app.js \
  src/bell-square.js \
  quantum-square-dance.html \
  quantum-square-dance-app.js \
  src/quantum-square-dance.js \
  assets/instruments/quantum-square-dance.webp \
  annealogue.html \
  annealogue-app.js \
  src/annealogue.js \
  fractal-uncertainty.css \
  cantor-lock.html \
  cantor-lock-app.js \
  src/cantor-lock.js \
  escape-dust.html \
  escape-dust-app.js \
  src/escape-dust.js \
  linebreaker.html \
  linebreaker-app.js \
  src/linebreaker.js \
  plasma-ball.html \
  plasma-ball.css \
  plasma-ball-app.js \
  src/plasma-ball.js \
  moire-organ.html \
  chladni-plate.html \
  spring-choir.html \
  gear-ratio-drums.html \
  automata.html \
  cellular-automata.html \
  prime-sieve.html \
  lissajous-orbits.html \
  pendulum-wave.html \
  double-pendulum.html \
  reaction-diffusion.html \
  atomic-orbitals.html \
  dna-translator.html \
  neural-pulse.html \
  fourier-epicycles.html \
  gravity-lens.html \
  orbital-ferris.html \
  experiments.css \
  experiments-app.js \
  src/orbital-ferris.js \
  assets/instruments/orbital-ferris.webp
do
  [[ -f "$repo_root/$worktree_runtime_file" ]] && copy_runtime_file "$worktree_runtime_file"
done

for catalog_icon in "$repo_root"/assets/instruments/*.webp; do
  [[ -f "$catalog_icon" ]] || continue
  copy_runtime_file "${catalog_icon#"$repo_root/"}"
done

required_files=(
  index.html
  midi-guide.html
  shape.html
  playhead-paint.html
  playhead-paint.css
  playhead-paint-app.js
  src/playhead-paint.js
  src/playhead-paint-audio.js
  assets/instruments/playhead-paint.webp
  boidzoid.html
  boidzoid.css
  boidzoid-app.js
  src/boidzoid.js
  assets/instruments/boidzoid.webp
  striped-staircase.html
  striped-staircase.css
  striped-staircase-app.js
  src/striped-staircase.js
  src/striped-staircase-audio.js
  assets/instruments/striped-staircase.webp
  alien-larynx.html
  alien-larynx.css
  alien-larynx-app.js
  src/alien-larynx-tract-processor.js
  assets/instruments/alien-larynx.webp
  alien-larynx-architecture.html
  alien-larynx-signal-path.svg
  syrinx.html
  syrinx.css
  syrinx-app.js
  syrinx-ui.html
  syrinx-ui.css
  morphynx.html
  morphynx.css
  morphynx-app.js
  src/morphynx.js
  assets/instruments/morphynx.webp
  tongued-beasts.html
  tongued-beasts.css
  assets/instruments/tongued-beasts.webp
  hybrinx.html
  hybrinx.css
  src/hybrinx-layout.js
  src/hybrinx-timeline.js
  assets/instruments/hybrinx.webp
  pink-trombonazoid.html
  pink-trombonazoid.css
  pink-trombonazoid-app.js
  src/pink-trombonazoid.js
  assets/instruments/pink-trombonazoid.webp
  hyper-syrinx.html
  hyper-syrinx.css
  hyper-syrinx-app.js
  assets/instruments/hyper-syrinx.webp
  src/syrinx.js
  src/syrinx-source-models.js
  src/syrinx-processor.js
  src/tongue-physics.js
  src/tongue-performance.js
  assets/instruments/syrinx.webp
  ANIMAL_VOICE_SYNTHESIS_RESEARCH.md
  throatazoid-architecture.html
  throatazoid-architecture.css
  throatazoid-signal-path.svg
  about.html
  about.css
  THIRD_PARTY_NOTICES.md
  music-rooms.html
  music-rooms.css
  assets/instruments/room-lobby.webp
  vocal-effects-room.html
  assets/instruments/vocal-effects-room.webp
  instrument-share-room.html
  assets/instruments/instrument-share-room.webp
  morphazoid-roulette.html
  assets/instruments/morphazoid-roulette.webp
  instruments.html
  instrument-catalog.css
  instrument-catalog-app.js
  src/instrument-catalog.js
  wax.html
  wax.css
  wax-page.js
  src/wax-instrument-roles.js
  src/wax-midi-routing.js
  assets/instruments/shape.webp
  assets/instruments/gesturama.webp
  gesturama.html
  gesturama.css
  gesturama-app.js
  src/gesturama-core.js
  src/gesturama-audio.js
  src/gesturama-zones.js
  assets/instruments/gravity-lens.webp
  assets/instruments/drum-roll-please.webp
  assets/instruments/ouroboros.webp
  assets/instruments/ouroboros-borealis.webp
  assets/instruments/image-to-instrument-3.webp
  image-to-instrument-3.html
  image-to-instrument-app.js
  wheel-of-organs-app.js
  image-to-instrument.css
  src/image-to-instrument.js
  src/wheel-of-organs.js
  src/wheel-of-organs-audio.js
  spelling-synthesizer.html
  spelling-synthesizer.css
  spelling-synthesizer-app.js
  src/spelling-synthesizer.js
  src/spelling-synthesizer-audio.js
  src/spelling-diphone-atlas.js
  src/spelling-pronunciation.js
  src/spelling-vocoder-processor.js
  assets/audio/spelling-diphone-kal16.wav
  assets/instruments/spelling-synthesizer.webp
  vocalzoid.html
  vocalzoid.css
  vocalzoid-app.js
  src/vocalzoid.js
  src/vocalzoid-audio.js
  src/vocalzoid-bank.js
  src/vocalzoid-open-banks.js
  assets/audio/vocalzoid-oddvoices-air.wav
  assets/audio/vocalzoid-oddvoices-cicada.wav
  assets/audio/vocalzoid-oddvoices-quake.wav
  assets/audio/vocalzoid-cmu-arctic-bdl.wav
  assets/audio/vocalzoid-cmu-arctic-clb.wav
  assets/audio/vocalzoid-cmu-arctic-jmk.wav
  assets/audio/vocalzoid-cmu-arctic-ksp.wav
  assets/audio/vocalzoid-cmu-arctic-slt.wav
  assets/instruments/vocalzoid.webp
  vendor/oddvoices/LICENSE
  vendor/cmu-arctic/COPYING
  vendor/cmu-arctic/COPYING-2005
  vendor/cmudict/cmudict-en-us.dict
  vendor/cmudict/LICENSE
  plugins.html
  plugins.css
  plugins-app.js
  src/plugin-catalog.js
  src/midi-manager.js
  src/audio-output-manager.js
  src/browser-midi-adapter.js
  src/instrument-midi-capabilities.js
  src/midi-output-preview.js
  src/shape-midi.js
  src/fm-drums-midi.js
  downloads/plugins/chaotic-fm/0.2.1/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx
  downloads/plugins/chaotic-fm/0.2.2/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx
  downloads/plugins/chaotic-fm/0.2.3/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx
  downloads/plugins/chaotic-fm/0.3.0/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx
  app.js
  style.css
  favicon.svg
  src/audio.js
  src/contour-synth-processor.js
  l-mic.html
  micmic.html
  micmic-app.js
  micmic.css
  shepard-risset.html
  shepard-risset-app.js
  src/shepard-risset.js
  slippery-resynthesis.html
  slippery-resynthesis.css
  slippery-resynthesis-app.js
  src/slippery-resynthesis.js
  assets/instruments/slippery-resynthesis.webp
  drum-roll-please.html
  drum-roll-please.css
  drum-roll-please-app.js
  src/drum-roll-please.js
  ouroborousel.html
  ouroborousel.css
  ouroborousel-app.js
  src/ouroborousel.js
  assets/instruments/ouroborousel.webp
  ourorourobouroboros.html
  ourorourobouroboros.css
  ourorourobouroboros-app.js
  src/ourorourobouroboros.js
  assets/instruments/ourorourobouroboros.webp
  ouroboros.html
  ouroboros.css
  ouroboros-app.js
  src/ouroboros.js
  ouroboros-borealis.html
  ouroboros-borealis.css
  ouroboros-borealis-app.js
  src/ouroboros-borealis.js
  candy-coil-delay.html
  sandy-syrup-delay.html
  barber-delay.css
  barber-delay-app.js
  src/barber-delay.js
  recursive-fm.html
  recursive-fm-app.js
  src/recursive-fm.js
  cascading-fm.html
  cascading-fm.css
  cascading-fm-app.js
  src/cascading-fm.js
  assets/instruments/cascading-fm.webp
  recursive-pm.html
  recursive-pm.css
  recursive-pm-app.js
  src/recursive-pm.js
  src/recursive-pm-midi.js
  cascading-pm.html
  cascading-pm.css
  cascading-pm-app.js
  src/cascading-pm.js
  assets/instruments/cascading-pm.webp
  chaotic-fm.html
  chaotic-fm.css
  chaotic-fm-app.js
  chaotic-dsp-reference.html
  chaotic-dsp-reference.css
  chaotic-dsp-reference-page.js
  src/chaotic-fm.js
  src/chaotic-dsp-reference.js
  src/chaotic-fm-flow.js
  chaotic-pm.html
  chaotic-pm.css
  chaotic-pm-app.js
  src/chaotic-pm.js
  webgpu-303.html
  webgpu-303.css
  webgpu-303-app.js
  src/webgpu-303.js
  webgpu-synths.html
  webgpu-synths.css
  webgpu-synths-app.js
  src/webgpu-synths.js
  webgpu-dsp-primitives.html
  webgpu-dsp-primitives.css
  webgpu-dsp-primitives-app.js
  src/webgpu-dsp-primitives.js
  shader-synth-playground.html
  shader-synth-playground.css
  shader-synth-playground-app.js
  src/shader-synth-playground.js
  src/shader-synth-playground-extra.js
  src/shader-synth-playground-found-sounds.js
  src/shader-synth-playground-fx.js
  src/shader-synth-playground-scenes.js
  assets/instruments/webgpu-synths.webp
  weierstrass.html
  weierstrass.css
  weierstrass-app.js
  src/weierstrass.js
  algorithmic-sequencers.html
  algorithmic-sequencers.css
  algorithmic-sequencers-app.js
  src/algorithmic-sequencers.js
  algorithmic-scores.html
  algorithmic-scores.css
  algorithmic-scores-app.js
  src/algorithmic-scores.js
  dijkstra.html
  hanoi.html
  minimax.html
  nqueens.html
  euclid.html
  gravity-walk.html
  ricochet.html
  rigidity.html
  rolling-measure.html
  falling-forms.html
  charge-garden.html
  packing-pressure.html
  geodesic-drift.html
  kinetic-hull.html
  physics.css
  physics-app.js
  src/physics-common.js
  src/physics-scenes-shape.js
  src/physics-scenes-advanced.js
  src/physics-scenes.js
  quantum-synths.css
  order-tones.html
  order-tones-app.js
  src/order-tones.js
  bell-square.html
  bell-square-app.js
  src/bell-square.js
  quantum-square-dance.html
  quantum-square-dance-app.js
  src/quantum-square-dance.js
  assets/instruments/quantum-square-dance.webp
  annealogue.html
  annealogue-app.js
  src/annealogue.js
  fractal-uncertainty.css
  cantor-lock.html
  cantor-lock-app.js
  src/cantor-lock.js
  escape-dust.html
  escape-dust-app.js
  src/escape-dust.js
  linebreaker.html
  linebreaker-app.js
  src/linebreaker.js
  assets/instruments/cantor-lock.webp
  assets/instruments/escape-dust.webp
  assets/instruments/linebreaker.webp
  plasma-ball.html
  plasma-ball.css
  plasma-ball-app.js
  src/plasma-ball.js
  moire-organ.html
  chladni-plate.html
  spring-choir.html
  gear-ratio-drums.html
  automata.html
  cellular-automata.html
  prime-sieve.html
  lissajous-orbits.html
  pendulum-wave.html
  double-pendulum.html
  reaction-diffusion.html
  atomic-orbitals.html
  dna-translator.html
  neural-pulse.html
  fourier-epicycles.html
  gravity-lens.html
  orbital-ferris.html
  experiments.css
  experiments-app.js
  src/orbital-ferris.js
  assets/instruments/orbital-ferris.webp
  fm-drums.html
  fm-drums.css
  fm-drums-app.js
  src/fm-drums.js
  sample-drums.html
  sample-drums.css
  sample-drums-app.js
  src/sample-drums.js
  shape-drums.html
  shape-drums.css
  shape-drums-app.js
  src/shape-drums.js
  lattice-drums.html
  lattice-drums.css
  lattice-drums-app.js
  src/lattice-drums.js
  escher-tessellation.html
  escher-tessellation.css
  escher-tessellation-app.js
  src/escher-tessellation.js
  src/escher-contours.js
  src/escher-performance-audio.js
  assets/instruments/escher-tessellation.webp
  spiral-drums.html
  spiral-drums.css
  spiral-drums-app.js
  src/spiral-drums.js
  solid-drums.html
  solid-drums.css
  solid-drums-app.js
  src/solid-drums.js
  rubix.html
  rubix.css
  rubix-app.js
  src/rubix.js
  src/rubix-webgpu-303.js
  src/rubix-visibility.js
  assets/instruments/rubix.webp
  hyper-rubix.html
  hyper-rubix.css
  hyper-rubix-app.js
  src/hyper-rubix.js
  src/hyper-rubix-webgpu-303.js
  assets/instruments/hyper-rubix.webp
  hyper-drums.html
  hyper-drums.css
  hyper-drums-app.js
  src/hyper-drums.js
  l-system-drums.html
  l-system-drums.css
  l-system-drums-app.js
  src/l-system-drums.js
  linear-drums.html
  linear-drums.css
  linear-drums-app.js
  src/linear-drums.js
  karplus-strong.html
  karplus-strong.css
  karplus-strong-app.js
  src/karplus-strong.js
  assets/instruments/karplus-strong.webp
  karplus-carpet.html
  karplus-carpet.css
  karplus-carpet-app.js
  src/karplus-carpet.js
  assets/instruments/karplus-carpet.webp
  linear-drums-machine.html
  linear-drums-machine.css
  linear-drums-machine-app.js
  src/linear-drums-machine.js
  morphazoidical/index.html
  vendor/signalsmith-stretch/LICENSE
  vendor/signalsmith-stretch/SignalsmithStretch.mjs
  vendor/tactile/tactile.js
)

for required_file in "${required_files[@]}"; do
  if [[ ! -f "$output_dir/$required_file" ]]; then
    echo "Missing required runtime file: $required_file" >&2
    exit 1
  fi
done

for excluded_path in \
  tests \
  scripts \
  .github \
  node_modules \
  package.json \
  README.md \
  .preview-cdp.ps1
do
  if [[ -e "$output_dir/$excluded_path" ]]; then
    echo "Private development path leaked into artifact: $excluded_path" >&2
    exit 1
  fi
done

file_count="$(find "$output_dir" -type f | wc -l | tr -d ' ')"
size="$(du -sh "$output_dir" | cut -f1)"
echo "Built $file_count public files ($size) in $output_dir"
