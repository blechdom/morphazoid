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
    *.html|*.css|*.js|favicon.svg|morphazoidical/PLAN.md|\
    vendor/tactile/LICENSE|\
    vendor/signalsmith-stretch/SignalsmithStretch.mjs)
      copy_runtime_file "$source_path"
      ;;
  esac
done < <(git -C "$repo_root" ls-files -z)

# Allow the new Workbench page to enter local release artifacts before its
# first commit; after tracking, these copies simply refresh the same paths.
for worktree_runtime_file in \
  lattice-drums.html \
  lattice-drums.css \
  lattice-drums-app.js \
  src/lattice-drums.js \
  spiral-drums.html \
  spiral-drums.css \
  spiral-drums-app.js \
  src/spiral-drums.js
do
  [[ -f "$repo_root/$worktree_runtime_file" ]] && copy_runtime_file "$worktree_runtime_file"
done

required_files=(
  index.html
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
  chaotic-fm.html
  chaotic-fm.css
  chaotic-fm-app.js
  src/chaotic-fm.js
  weierstrass.html
  weierstrass.css
  weierstrass-app.js
  src/weierstrass.js
  fm-drums.html
  fm-drums.css
  fm-drums-app.js
  src/fm-drums.js
  lattice-drums.html
  lattice-drums.css
  lattice-drums-app.js
  src/lattice-drums.js
  spiral-drums.html
  spiral-drums.css
  spiral-drums-app.js
  src/spiral-drums.js
  morphazoidical/index.html
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
