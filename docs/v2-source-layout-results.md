# First source-directory cleanup — September 17, 2026

## Scope

Worktree: `/home/blechdom/creative/morphazoid-v2-integration`

Branch: `codex/v2-release-manifest`, based on
`ca58234773844f7e1fba8d65e55e1cf89b3f1184`.

The owner approved starting directory cleanup before providing the new names
and categories. This first batch physically moves **18 controllers and 11
stylesheets out of the root**. Current names, instrument IDs, public HTML routes,
saved-data keys, presets, behavior and sound algorithms are unchanged.

The changes are local and uncommitted. They have not been merged or published.
The preceding release-manifest layer has its own checkpoint.

While this batch ran, main advanced separately to `a17d7b5` with social-preview
and instrument-idea work. This branch remains based on `ca58234`; those incoming
changes must be reconciled before a later merge, especially the build-script
hook and regenerated WAX output. No main-worktree edits or staging were touched.

## New implementation groups

`src/instruments/` now contains Shape, Solid, Hyper and their drums;
Nonorientable (Möbius/Klein); L-System and L-System Drums; the L-Systems app;
Lattice and Spiral with their drums; Graph Synth/Drums wrappers; Graph Delay;
and the Graphs app.

`src/families/graph/graph-instruments.css` contains the unchanged shared Graph
styles. Existing shared models, processors and other utilities retain their
current `src/` locations. Assets remain top-level.

Nineteen root HTML pages now reference the new script/style locations. There
are no placeholder controller copies or forwarding modules left at the former
root locations.

This is not the entire root cleanup: 101 root `*-app.js` files remain, and many
other styles/models still need ownership review. Public HTML entry pages,
global navigation and global styling intentionally remain at the root for now.
Folder names represent current implementation units, not future categories.

## Preservation evidence

- The 18 controller bodies differ only in **109 dependency URL literals**.
  Every resolved module/worker target is the same as before the move.
- All 11 stylesheet contents are byte-identical to the originals.
- No model, processor, WASM binary, sample, preset bank or catalogue data changed.
- The original and new release trees both contain 3,382 files. The only
  differences are 58 moved normal/WAX resources and 38 normal/WAX HTML files
  whose resource references changed. The other 3,286 files match exactly.
- All 57 paired control/style surface captures match across 19 pages at three
  viewport widths.
- Graph Delay successfully loads the same real pitch-processing worklet and
  processes a synthetic input on both versions. No hardware microphone is used.

The new source locations are explicitly allowed/required by the release
manifest, including before their first commit. Several formerly
tracked-selection-only files therefore receive explicit `copy+require` entries;
this is an intentional packaging update for relocated, untracked source.

## Verification

| Check | Result |
| --- | --- |
| Source references, build/syntax coverage and inspection-tool checks | 3 passed |
| Focused updated smoke/WAX/path tests | 25 passed |
| Expanded fast gate | 177 passed |
| Reference and candidate source-layout browser suite | 20 passed on each |
| Full combined browser gate | 382 passed |
| Full Node suite in the final combined gate | 3,611 passed, zero failures, 6 skipped |
| JavaScript parsing | 488 modules, zero syntax failures |
| WAX / XYFlow parity | Passed |
| Complete local production build and Storybook check | Passed; 109 Storybook entries |
| Dependency scan | Zero warnings/errors; all 18 moved controllers present |

The first Node run identified 13 test-harness/path assertions still using old
locations. Cache-busted import templates and resource-version checks were
updated, and a synthetic WAX fixture's generic `app.js` reference was retained.
No behavioral requirements were loosened.

The first new Graph Delay browser probe incorrectly relied on page-level
network events to observe a worklet fetch. It was corrected to delegate to
and record successful completion of the real `AudioWorklet.addModule` API.
Both reference and candidate then passed the same load/signal requirements.
Initial failure logs are retained alongside final results.

This is not a new listening approval or a real mobile-performance assessment.
The complete production build retains its large-chunk advisory; no warning
threshold was changed.

## References and rollback

- Live worktree preview: `http://localhost:4352/`
- Frozen reference: `http://127.0.0.1:4353`, serving the preceding packaging build
- Frozen candidate: `http://127.0.0.1:4354`, serving this directory-move build
- Pre-move checkpoint: `test-results/release-manifest/checkpoint/`
- Move map, original files and URL/body proof: `test-results/source-layout/`
- Final move-layer checkpoint: `test-results/source-layout/checkpoint/`

The original callbacks in frozen preservation fixtures were not rewritten.
`tests/helpers/relocated-sources.mjs` maps their historical names to current
source locations. The syntax checker and inspection tool follow nested entries.

Only HTML page addresses are preserved as public routes in this batch.
Internal JS/CSS resource URLs change. A later publication must deploy the
matching HTML/resources together and handle cached old HTML; no release or
cache-policy change was performed here.

For rollback, restore the move layer and preceding packaging layer separately,
including caller references, tests, manifest and generated WAX output. Do not
delete a new module while keeping HTML or imports pointing to it. Checkpoints
include copied files and manifests as well as a diff; they are local backups,
not committed history or off-machine recovery.
