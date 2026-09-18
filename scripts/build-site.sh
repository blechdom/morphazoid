#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_arg="${1:-dist}"
build_temp_root="$(realpath -m "${2:-/tmp}")"

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

if [[ "$output_dir" != "$repo_root/"* && "$output_dir" != /tmp/* && "$output_dir" != "$build_temp_root/"* ]]; then
  echo "Output must be inside the repository or /tmp: $output_dir" >&2
  exit 1
fi

# Read and validate the explicit inventory before replacing an output directory.
# A failed reader must fail the build, not disappear inside process substitution.
manifest_inventory="$(node "$repo_root/scripts/site/runtime-manifest.mjs")"
worktree_runtime_files=()
required_files=()
while IFS=$'\t' read -r policy source_path; do
  case "$policy" in
    copy) worktree_runtime_files+=("$source_path") ;;
    require) required_files+=("$source_path") ;;
    copy+require)
      worktree_runtime_files+=("$source_path")
      required_files+=("$source_path")
      ;;
    *) echo "Invalid runtime manifest record: $policy" >&2; exit 1 ;;
  esac
done <<< "$manifest_inventory"

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
    .github/*|.storybook/*|stories/*|tests/*|morphazoidical/tests/*|scripts/*|src/xyflow/*|dist/*|dist-wax/*|storybook-static/*|*.stories.js)
      continue
      ;;
  esac

  case "$source_path" in
    *.html|*.css|*.js|*.wasm|*.webp|*.glb|*.LICENSE.txt|favicon.svg|THIRD_PARTY_NOTICES.md|morphazoidical/PLAN.md|downloads/plugins/*|assets/authors/*.png|\
    assets/puggler/*.wav|assets/puggler/*CREDITS.md|assets/puggler/CC0-1.0.txt|\
    vendor/tactile/LICENSE|\
    vendor/cmudict/cmudict-en-us.dict|\
    vendor/cmudict/LICENSE|\
    vendor/signalsmith-stretch/LICENSE|\
    vendor/signalsmith-stretch/SignalsmithStretch.mjs)
      copy_runtime_file "$source_path"
      ;;
  esac
done < <(git -C "$repo_root" ls-files -z)

# The manifest preserves explicit pre-commit inclusion, separately from the
# mandatory-file checks below. Ordinary tracked-file selection is unchanged.
for worktree_runtime_file in "${worktree_runtime_files[@]}"; do
  [[ -f "$repo_root/$worktree_runtime_file" ]] && copy_runtime_file "$worktree_runtime_file"
done

for spider_asset in "$repo_root"/assets/spider-synth/skins/ASSET.md "$repo_root"/assets/spider-synth/skins/*/* "$repo_root"/assets/audio/spider-synth/*; do
  [[ -f "$spider_asset" ]] || continue
  case "$spider_asset" in
    *.glb|*.json|*.webp|*.wav|*.md|*.LICENSE.txt) copy_runtime_file "${spider_asset#"$repo_root/"}" ;;
  esac
done

for catalog_icon in "$repo_root"/assets/instruments/*.webp; do
  [[ -f "$catalog_icon" ]] || continue
  copy_runtime_file "${catalog_icon#"$repo_root/"}"
done

# Make the sharing image explicit in the HTML crawlers actually receive.
# This shared step covers the normal public build and its WAX counterpart,
# including nested routes and pages added after this fix.
node "$repo_root/scripts/social-preview.mjs" "$output_dir"

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
  src/xyflow \
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
