# Pointer-coordinate extraction — September 23, 2026

**Rebase follow-up:** this extraction is now combined with main's `ef6e593`
iPhone-startup changes. The original reference hashes remain unchanged; exact
upstream amendments are reversed only inside the preservation tests. See
`rebase-main-20260923.md`. The initial checkpoint and evidence below remain
historical rather than being relabeled as results from the new base.

## Scope

This is the next low-risk shared-utility step after directory checkpoint
`eb5b17e`. GitHub main was verified/fetched at `9a45aa0`; it is already an
ancestor of the review branch. Work continues only in `morphazoid-presets`.
The `starting-instruments` family keeps its existing name. The neighboring
main worktree and pre-existing preset-rollout drafts remain untouched.

Two pure calculations now live in `src/graphics/pointer-coordinates.js`:

| Policy | Controllers | Routes |
| --- | --- | --- |
| Unscaled client-to-canvas CSS coordinates | Rubix, Jaw Harp, Graph, Syrinx | Rubix, Jaw Harp, Graph Synth/Drums, Syrinx, Hybrinx, Tongued Beasts and Syrinx UI |
| Logical drawing coordinates, multiplication then division | Hiccup Head, Creaturazoid | Their two existing pages |

The six existing callback names and call sites are retained. Each still reads
its own canvas rectangle once per event. No event binding, pointer capture,
cancellation, focus, hit-test threshold, geometry-to-sound mapping, preset,
transport or audio code is moved into the helper.

Similar-looking calculations are deliberately excluded: Graph Delay multiplies
by a precomputed ratio; Shapes has per-axis finite-coordinate/offset fallbacks;
Lattice converts to world coordinates. Replacing those with a universal
"normalized pointer" function would change behavior.

## Preservation evidence

`tests/fixtures/pointer-coordinates-v1.json` freezes the six original functions,
their whole-module hashes and exact replacement/import strings from `eb5b17e`.
Unit tests execute the actual current wrappers against those independent
originals across fractional/scrolled bounds, differing logical dimensions,
collapsed/subpixel rectangles, captured out-of-bounds drags, signed zero and
existing non-finite behavior. Inputs remain read-only; bounds are not cached.

Each controller must reverse exactly to its full pre-extraction bytes. The
existing 430-module hierarchy proof first reverses this explicitly tested
extraction and then runs its existing path/stereo-input reversals. No historical
hash or approved audio reference is regenerated and no broader exception is
introduced.

The browser probe exposes the existing callback only in an intercepted test
response; production receives no global test API. It compares that real
callback with the frozen function in the same live closure at desktop,
portrait and landscape sizes, before/after resize, under fractional CSS scaling
and a collapsed transform. Representative WAX pages exercise hosted-relative
imports. Instrument-specific gesture/preset/audio suites remain separate.

## Verification

| Check | Result |
| --- | --- |
| Focused Node equivalence / affected instrument checks | 102 passed |
| `npm run verify` | 4,093 passed, six skipped; syntax, SIMD, XYFlow and clean-build WAX parity passed |
| Real-browser callback/reference comparisons | 32 passed across ten routes, three viewports, resize, CSS transforms and two WAX pages |
| Production build | Passed, including 209 WAX pages |
| Existing preset, gesture, audio and all-route browser suites | **311 passed, one failed**: standalone Shape's percussion clipping-meter assertion |

The wider browser gate is **not fully green**. The failure occurred in the
unchanged `Shape audition fixes retain smooth percussion, the original square,
and mixed rotation controls` test, with one clipping-meter sample during
“Orbiting knuckles.” No Shape controller, preset or audio code was changed.

The same unmodified test was run five times in an isolated checkout of
`eb5b17e`: **three passed and two failed at the same clipping assertion**.
This confirms an existing intermittent issue rather than a pointer-extraction
regression. All 71 present/tracked Shape resources discovered by the inspection
tool match the baseline byte-for-byte, with no unresolved templates or
dependency on the new pointer helper in that inventory. Discovery remains
static evidence, not a claim to inspect every possible runtime fetch.

No audio retuning, assertion weakening, skip or failure allowlist was added.
The clipping-meter finding is retained for a separate audio investigation;
coarse meter samples do not establish the cause or audibility of a transient.

Logs and pre-change snapshots are under `test-results/pointer-refactor-20260923/`:
`focused.log`, `verify.log`, `pointer-browser.log`, `regression-browser.log`,
`shape-baseline.log`, `shape-source-comparison.json`, and retained failure
artifacts. The six frozen module hashes were independently checked against
their declared Git base. Pre-existing tracked preset drafts still match the
initial working-tree patch; none was staged or consumed.

This is exact calculation/source preservation, not new listening or
physical-device approval. There are no preset-content changes, no new WIP
features, no new commit, no push and no deployment in this batch.
