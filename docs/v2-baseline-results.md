# v2 baseline and first-pilot results

Recorded September 16, 2026, in the isolated `codex/v2-preservation` worktree.
The untouched-source reference is `4e9feed0748d94aa86500b0d63218b62b20138c6`.
Node: `v22.23.2`. This is a local source reference, not a verified production
archive or an approved listening baseline.

## Original baseline

| Check | Result |
| --- | --- |
| Locked dependency installation | Completed; no existing versions upgraded |
| `npm run check`, including WASM reproducibility | Passed |
| Full Node suite within `npm run verify` | 3,537 passed, 8 failed, 6 skipped |
| `npm run check:xyflow`, run independently | Passed |
| `npm run check:wax-dist`, run independently | Passed |
| Original Solid/Hyper browser characterization | 8 passed |

`npm run verify` stopped at the Node failures, so the independent checks above
must not be presented as a successful full verification command.

### Pre-existing failures — not changed or suppressed

| Test | Observed failure |
| --- | --- |
| `tests/barber-delay-pages.test.mjs` | Candy logo bytes differ from the expected original |
| `tests/brand-mark.test.mjs` | Header mark does not match the expected SVG source pattern |
| `tests/browser-midi-adapter.test.mjs` | Capability/catalogue cardinalities differ: 145 and 142 |
| `tests/constellation-page.test.mjs` | Expected Constellation catalogue entry is absent |
| `tests/ffmpeg-wasm.test.mjs` | Expected FFmpeg navigation record is absent |
| `tests/hyper-rubix-app-smoke.test.mjs` | Import fails on unknown WAX role IDs |
| `tests/wax-instrument-roles.test.mjs` | Unknown WAX role IDs: `plugazoid`, `ffmpeg-wasm`, `constellation` |
| `tests/wax-midi-routing.test.mjs` | Same WAX role-registry import failure |

These are observations at the reference commit, not permission to change the
catalogue, artwork, requirements, or instrument behavior. Triage them separately.

## Completed pilot evidence

- Before controller edits, all four new sizing-characterization tests passed
  against the original controller callbacks.
- After extraction, all 105 focused Node tests passed (the original 98 plus
  four sizing and three reporting-tool tests).
- The frozen sizing callback was compared with both original controllers at
  the source reference and matched exactly.
- Pinned reporting tools were installed without changing any existing locked
  package version or integrity value.
- The candidate release contains exactly four changed files: Solid and Hyper
  controllers in the normal and WAX sites.
- Exactly two files were added: the shared sizing helper in those two sites.
  No published files were removed; 3,422 existing release files are byte-identical.
  In particular, audio engines, processors, samples, models, WASM, HTML, and CSS
  were not changed by this extraction.

## Final candidate checks

| Check | Result |
| --- | --- |
| Focused Node/model/worklet/tooling tests | 105 passed |
| Updated development-dependency inventory and new tooling/sizing tests | Passed |
| Full Node suite within final `npm run verify` | 3,544 passed, the same 8 failures, 6 skipped |
| Candidate `npm run check:wax-dist`, run independently | Passed |
| Candidate `npm run check:xyflow`, run independently | Passed |
| Final reference browser run | 8 passed |
| Final candidate browser run | 8 passed |
| Settled desktop/phone screenshots | All 6 reference/candidate PNGs byte-identical |
| Report-only architecture commands | Completed successfully |

The first candidate verification also caught the exact development-dependency
inventory in `tests/markup.test.mjs`. Its expected list was extended by the two
explicitly approved tools only; the development-only requirement and runtime
dependency allowlist remain enforced. None of the eight reference failures was
changed or suppressed. The first candidate log is retained separately.

An initial screenshot comparison caught the existing MIDI preview's timed
highlight, not a canvas difference. The test now waits for that highlight to
clear and disables CSS animations only while capturing the screenshot. The
same capture procedure is applied to both builds; runtime CSS and animation
behavior were not edited, and no image difference was masked.

Browser: Chromium `151.0.7922.34`. The tested servers serve archived local
artifacts from this v2 worktree, not the live production site:

- Reference: `http://127.0.0.1:4345`, serving
  `test-results/v2-baseline/reference-site/`.
- Candidate: `http://127.0.0.1:4346`, serving
  `test-results/v2-candidate/site/`.

The served HTML/controller bytes were checked against their respective
artifact files before testing. See `browser-comparison.json`,
`verification-comparison.json`, and `artifact-comparison.json` beneath
`test-results/v2-candidate/` for machine-readable comparisons.

This is a review-ready local pilot, **not release or listening approval**.

## Broad sizing-uniformity batch

After the owner accepted the pilot and requested broader reuse, 36 additional
controllers adopted the calculation with their existing policies preserved.
There are now 38 consumers across 48 browser pages. This includes the Shape,
L-system, physics, graph, lattice/spiral, drum, FM/PM, and other compatible
rounded-canvas implementations.

This is implementation uniformity, not a visual redesign:

- Existing maximum device scales (including 1.35, 1.5, 2, and 2.5) remain.
- Existing pixel budgets, pages with no budget, and sub-one scale behavior
  remain distinct where they were distinct.
- Conditional writes, canvas styles, transforms, invalidation, redraws,
  disposal guards, pending frames, and active gesture updates stay caller-owned.
- Code outside the 36 resize callbacks and their added helper imports was
  checked against the archived originals and is unchanged.
- Against the accepted pilot artifact, only those controllers and the helper
  differ in the normal/WAX sites: 74 changed files, no additions/removals, and
  3,354 byte-identical files. DSP, presets, audio/visual assets, HTML, and CSS
  were not rewritten.

| Check | Result |
| --- | --- |
| Original-versus-extracted sizing/default/variant tests | 81 passed before and after extraction |
| Fast refactoring gate | 147 passed |
| Full Node suite | 3,621 passed; the same 8 baseline failures; 6 skipped |
| Independent WAX and XYFlow parity | Passed |
| Original browser sizing matrix | 145 passed: route coverage plus 48 pages × 3 layouts |
| Candidate browser sizing matrix | 145 passed |
| Original interaction and browser-audio suites | 53 passed |
| Candidate interaction and browser-audio suites | 53 passed |

All 144 paired canvas-geometry records (initial, resized, and restored) match
exactly between the accepted pilot and this candidate. Of 42 retained full-page
layout screenshots, 41 are byte-identical; the remaining Hyper desktop
difference occupies an 8-by-2-pixel area in MIDI preview text, outside the canvas.
The crop and original captures are retained, not masked or approved by an
automatic baseline update. Hyper's controller and the preview's CSS/code did
not change in this batch.

The initial parallel sizing run had one original Plasma Ball desktop timeout.
It passed all three isolated checks, and both full sizing matrices then passed
serially with the original timeout and assertions retained. Browser scheduling
was changed, not the instrument.

The existing Candy logo failure still checks exact bytes. Its diagnostic now
uses `Buffer.equals` rather than printing an enormous array diff. The failure
was not fixed, skipped, or turned into an accepted baseline. Digestazoid's
source-level sizing check now verifies its preserved 2,600,000-pixel policy
at the shared call site; executable equivalence tests cover that policy.

The latest frozen candidate is served at `http://127.0.0.1:4347` from
`test-results/v2-uniformity/site/`. The accepted pilot on port 4346 is unchanged.
Paired outcomes, geometry equality, and screenshot observations are in
`test-results/v2-uniformity/browser-comparison.json`.

### Deliberately not forced into the common rule

The inventory found 83 named `resizeCanvas` functions; class methods or
differently named renderer resize paths are outside that count. Remaining
implementations are not automatically incompatible, but are not claimed as
migrated or fully assessed in this batch.

Examples needing separate treatment include raw/floor-rounded sizes, square
canvases, minimum backing sizes, strict budget algorithms that can reduce scale
below one, dynamic/deferred renderer reallocations, and resize paths coupled
to other renderer state. Linebreaker's clamp order is different; Rubix has
deferred backing-store changes. Hyper Rubix also has an existing WAX-registry
import failure in the baseline. None was normalized just to remove duplication.

## Tract-family geometry layer

Following the owner's approval to continue, four identical functions were
extracted from Alien Larynx and Throatazoid into
`src/families/tract/geometry.js`. Their calculation bodies are byte-identical to
the frozen originals. Page-owned wrappers preserve current state, viewport,
selection, and articulation callbacks; the rest of each controller is
token-identical apart from the corresponding imports.

Each controller is 411 lines shorter. The shared module contains 455 lines,
giving a net reduction of 367 authored runtime lines. This is not an audio-engine,
rendering, gesture, preset, or smoothing rewrite.

The flat JavaScript syntax check was also replaced by recursive source
discovery. It now covers nested family modules and build tools without executing
browser code. Lumber's old source-string check was replaced with a check that
the actual discovered syntax targets include its controller.

| Check | Result |
| --- | --- |
| Original tract model/worklet/page tests | 60 passed before changes |
| New geometry comparisons against original controllers | 6 passed before wiring |
| Focused geometry/model/worklet/page/syntax tests after extraction | 71 passed |
| Recursive JavaScript parsing | 493 modules, zero syntax failures |
| Original tract browser suite | 10 passed |
| Candidate tract browser suite | 10 passed |
| Full Node suite | 3,630 passed; the same 8 baseline failures; 6 skipped |
| Expanded fast refactoring gate | 156 passed |
| Independent WAX and XYFlow parity | Passed |

The browser matrix includes Clear/Hydra/Oracle anatomy changes at three
viewports, direct tongue dragging, a resize while the pointer is held, phoneme
changes and multi-mouth playback using the internal glottis, audio-off
continuity, and cleanup. Microphone requests are blocked in these tests.
The owner has not been asked to repeat the prior 48-page sizing review.

Captured layout/control records, before/after drag values, held-resize results,
and control states during synthetic playback match the reference exactly.
Canvas screenshots include ongoing time-based visualization and are retained
for visual review, not claimed as pixel-identical goldens. No renderer animation
was disabled or changed in the runtime to force a screenshot match.

The release comparison with the accepted sizing build shows four changed
controller copies and two new shared-module copies across normal/WAX output;
3,424 existing files are byte-identical. There are no removed public files or
changes to DSP processors, the shared parameter model, sound assets, presets,
HTML, or CSS.

Reference: `http://127.0.0.1:4347`, serving `test-results/v2-uniformity/site/`.
Candidate: `http://127.0.0.1:4348`, serving `test-results/v2-tract/site/`.
Source, artifact, and test evidence live under `test-results/v2-tract/`.

## Limits and next gate

The existing browser output-manager probes provide coarse meter readings, not
PCM captures or proof of timbral identity. Human A/B listening, physical-device
checks, and selection/archival of the approved production release remain
unperformed as a documented device/listening pass. The owner approved continuing
the mechanical work, not a change in musical behavior or a publication. Keep
subsequent work in reviewable batches and retain the unresolved baseline findings.

See `refactoring-tooling.md` for commands, report scope, and local evidence paths.
