# v2 review checkpoint — September 16, 2026

Worktree: `/home/blechdom/creative/morphazoid-v2`

Branch: `codex/v2-preservation`

Base: `4e9feed0748d94aa86500b0d63218b62b20138c6`

All changes are local, unstaged and uncommitted. Nothing was pushed or deployed.
The original checkout and its unrelated changes were not used as a rollback
target. No sound-engine/WASM, preset, mapping, asset, CSS, framework or hosting
change is included in these extraction layers.

## Current review version

Frozen candidate: `http://127.0.0.1:4350`

Serves: `test-results/v2-tract-rendering/site/`

Immediately preceding reference: `http://127.0.0.1:4349`

Serves: `test-results/v2-catalog/site/`

These loopback previews serve frozen builds, not changing worktree files.
They are accessible on the development machine while their servers remain
running. Restart a server with its explicit artifact directory if needed;
do not assume that the usual development port serves this worktree.

## Changes since the accepted sizing review

1. **Tract geometry:** four shared calculation functions, unchanged bodies;
   367 fewer runtime lines net across Alien Larynx and Throatazoid.
2. **Catalogue ownership:** pure `src/site/instrument-registry.js`; navigation
   keeps its public URL/API and startup behavior. All 142 shared page contracts
   match the reference; the reported import cycle is gone.
3. **Tract drawing:** one shared renderer with explicit frame inputs;
   another 653 fewer runtime lines net. Hit-test state stays in the pages.
   Exact drawing commands and 36 fixed-frame rasterizations match the original.
4. **Automation:** recursive syntax discovery and fast/batch gates cover the
   extracted modules, data-import purity, navigation, interaction and rendering.

The two tract controllers are each 1,100 lines shorter across their geometry
and drawing layers. They remain distinct instruments with their original
audio and instrument-specific state.

The cumulative built-file comparison confirms unchanged bytes for all 12 WASM
binaries, 582 runtime-asset paths and 637 HTML/CSS files from the local-source
reference. No public files were removed.

## Short manual review — no need to repeat all 48 sizing pages

At a comfortable output level, compare candidate and reference one at a time:

- **Throatazoid and Alien Larynx:** compare the default voice and a familiar
  multi-mouth preset; change vowels, drag a tongue and nose, then resize while
  holding a tongue. Look/listen for changed response, misplaced handles,
  unexpectedly changed sound, stuck gestures or interruption.
- **One familiar instrument such as Solid:** check its menu selection;
  with Audio off, Space should toggle Play once without arming Audio.
- **Home catalogue:** spot-check familiar groups/links/order.

Real microphone, touch-device feel, MIDI hardware and perceptual A/B listening
remain human/device checks. Automated output-meter tests do not prove timbral
identity, glitch-free performance, latency or musical quality.

## Rollback map

Choose an older frozen preview first if isolating a problem. This changes no
source and helps identify the first affected layer:

| State | Frozen preview | Checkpoint holding source before the next layer |
| --- | --- | --- |
| Accepted broad sizing | `http://127.0.0.1:4347` | `test-results/v2-tract/checkpoint/` |
| Plus tract geometry | `http://127.0.0.1:4348` | `test-results/v2-catalog/checkpoint/` |
| Plus catalogue separation | `http://127.0.0.1:4349` | `test-results/v2-tract-rendering/checkpoint/` |
| Plus tract renderer | `http://127.0.0.1:4350` | `test-results/v2-review/checkpoint/` |

Each checkpoint has copied changed/untracked files, a SHA-256 manifest and a
binary working diff. The diff alone does **not** include untracked files; retain
the copied files and manifest with it.
`test-results/v2-review/source-layers.json` records the file/hash differences
between the geometry, catalogue and renderer checkpoints.

For a source rollback, review the affected layer's manifest and compare current
file hashes first. Restore only that layer's callers, modules, tests and build
entries together. Removing a new helper while retaining its callers is not a
valid rollback. Review files added after the checkpoint separately; do not
blanket-delete untracked work or reset the checkout. Regenerate WAX from the
restored source and rerun the relevant gates.

These checkpoints are local working backups, not committed history or
off-machine recovery. Authorization to keep refactoring did not authorize
commits or publication.

## Verification and known red checks

Commands:

```sh
npm run test:refactor:fast
npm run test:browser:v2-tract
npm run test:browser:v2-site
npm run test:refactor:batch
```

The standalone final Node run has 3,637 passing tests, the same eight baseline
failures and six skips. WAX/XYFlow parity and 495-module parsing pass. The
combined batch was also run: all 163 fast checks and all 362 browser tests passed,
then its final `npm run verify` reached the same eight baseline failures. The
overall command correctly exits 1; it does not claim success while those
failures remain. The machine-readable result is
`test-results/v2-tract-rendering/batch-summary.json`.

The eight pre-existing failures concern Candy/brand artwork assertions,
catalogue/capability mismatches, missing FFmpeg/Constellation records and three
WAX-role-related import failures. No requirement was loosened to hide them.
Details and exact evidence paths are in `v2-baseline-results.md`.

## Next bounded work

Prefer another narrowly scoped family extraction or a move-only entry-point
pilot after this batch is reviewed. Keep release-manifest changes separate from
runtime moves. Do not use the remaining duplication count as a reason to
consolidate DSP or rewrite either instrument.
