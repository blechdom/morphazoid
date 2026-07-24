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
    vendor/elementary-audio/LICENSE|\
    vendor/soundtouchjs-phase-vocoder/LICENSE|\
    vendor/soundtouchjs/LICENSE|\
    vendor/tone/LICENSE|\
    vendor/tone/Tone.js.LICENSE.txt|\
    vendor/tactile/LICENSE|\
    vendor/signalsmith-stretch/SignalsmithStretch.mjs)
      copy_runtime_file "$source_path"
      ;;
  esac
done < <(git -C "$repo_root" ls-files -z)

required_files=(
  index.html
  app.js
  style.css
  favicon.svg
  src/audio.js
  src/contour-synth-processor.js
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
