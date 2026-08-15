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
    .github/*|tests/*|morphazoidical/tests/*|scripts/*)
      continue
      ;;
  esac

  case "$source_path" in
    *.html|*.css|*.js|*.webp|favicon.svg|morphazoidical/PLAN.md|downloads/plugins/*|\
    vendor/tactile/LICENSE|\
    vendor/signalsmith-stretch/LICENSE|\
    vendor/signalsmith-stretch/SignalsmithStretch.mjs)
      copy_runtime_file "$source_path"
      ;;
  esac
done < <(git -C "$repo_root" ls-files -z)

# Allow new public pages to enter local release artifacts before their first
# commit; after tracking, these copies simply refresh the same paths.
for worktree_runtime_file in \
  shape.html \
  about.html \
  about.css \
  plugins.html \
  plugins.css \
  plugins-app.js \
  assets/lumber-loops-wood-loop.webp \
  src/plugin-catalog.js \
  src/midi-manager.js \
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
  spiral-drums.html \
  spiral-drums.css \
  spiral-drums-app.js \
  src/spiral-drums.js \
  solid-drums.html \
  solid-drums.css \
  solid-drums-app.js \
  src/solid-drums.js \
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
  linear-drums-machine.html \
  linear-drums-machine.css \
  linear-drums-machine-app.js \
  src/linear-drums-machine.js \
  src/chaotic-fm-flow.js \
  chaotic-pm.html \
  chaotic-pm.css \
  chaotic-pm-app.js \
  src/chaotic-pm.js \
  algorithmic-sequencers.html \
  algorithmic-sequencers.css \
  algorithmic-sequencers-app.js \
  src/algorithmic-sequencers.js \
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
  annealogue.html \
  annealogue-app.js \
  src/annealogue.js \
  moire-organ.html \
  chladni-plate.html \
  spring-choir.html \
  gear-ratio-drums.html \
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
  experiments.css \
  experiments-app.js
do
  [[ -f "$repo_root/$worktree_runtime_file" ]] && copy_runtime_file "$worktree_runtime_file"
done

required_files=(
  index.html
  shape.html
  about.html
  about.css
  plugins.html
  plugins.css
  plugins-app.js
  src/plugin-catalog.js
  src/midi-manager.js
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
  candy-coil-delay.html
  striped-sludge-delay.html
  sandy-syrup-delay.html
  barber-delay.css
  barber-delay-app.js
  src/barber-delay.js
  recursive-fm.html
  recursive-fm-app.js
  src/recursive-fm.js
  recursive-pm.html
  recursive-pm.css
  recursive-pm-app.js
  src/recursive-pm.js
  src/recursive-pm-midi.js
  chaotic-fm.html
  chaotic-fm.css
  chaotic-fm-app.js
  src/chaotic-fm.js
  src/chaotic-fm-flow.js
  chaotic-pm.html
  chaotic-pm.css
  chaotic-pm-app.js
  src/chaotic-pm.js
  weierstrass.html
  weierstrass.css
  weierstrass-app.js
  src/weierstrass.js
  algorithmic-sequencers.html
  algorithmic-sequencers.css
  algorithmic-sequencers-app.js
  src/algorithmic-sequencers.js
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
  annealogue.html
  annealogue-app.js
  src/annealogue.js
  moire-organ.html
  chladni-plate.html
  spring-choir.html
  gear-ratio-drums.html
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
  experiments.css
  experiments-app.js
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
  spiral-drums.html
  spiral-drums.css
  spiral-drums-app.js
  src/spiral-drums.js
  solid-drums.html
  solid-drums.css
  solid-drums-app.js
  src/solid-drums.js
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
