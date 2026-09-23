# Presets and directory cleanup — September 22, 2026

## Working boundary

Continued in the `morphazoid-presets` worktree, initially on `codex/shapes-faves-rebased`.
GitHub SSH access was verified and `origin/main` fetched before editing.
The clean `079ba1e` checkpoint fast-forwarded to
`83ea203915513d13ac3efea4931fc0c1e5b314dd`. The neighboring `main` worktree
was not checked out, edited, staged or reset. No publication was requested.

### Fresh-main follow-up

The owner's machine-local, ignored `test-results/handoff-2026-09-22.md` was read
on the renewed request. Its clean `83ea203` snapshot remains historical and
was not overwritten. A new GitHub verification on September 22 found main had
advanced to `9a45aa0ac6ea35d2086186bcc88313b6f3a735da` through `dc02fd0`
(Audio/MIDI setup and stereo delay inputs) and `9a45aa0` (Loopini).

All 79 local changed/untracked paths were saved under
`test-results/presets-continuation/before-9a45aa0/` and in a named recovery stash.
The current review branch is **`codex/presets-continue-20260922`**, created from
the fetched commit in this same worktree. Restoring the local work required
resolving metadata move/delete conflicts and composing the hierarchy test with
main's exact stereo-input amendment records. The temporary integration index
was cleared only for the saved paths; nothing is staged for a new commit.

Main's new settings, stereo input behavior, Loopini source/assets and tests are
retained. Loopini remains WIP and receives no new preset-authoring here.
The nine-file metadata-move proof now reads its reference bytes directly from
Git at `9a45aa0`, not from the candidate. The earlier `83ea203` proof is in the
checkpoint; the original 430-module fixture is unchanged. WAX was regenerated
from the reconciled source (209 pages), not manually conflict-merged.

## Scope

- Finish pending Faves mechanical checks before authoring another bank.
  Existing factory records, engines, controls, storage identities and public
  HTML routes remain intact.
- Move the three remaining site metadata modules next to their registry and
  page controllers in `src/site/`. The move map is
  `site-metadata-layout.json`; shared audio/MIDI runtime utilities and WASM
  engine/toolchain locations stay unchanged.
- Keep the preceding module-hierarchy proof intact by composing the follow-up
  move map when reversing imports. The new independent fixture hashes each
  of nine affected runtime modules from fresh main, so reversal must be byte-exact.
  Generated WAX output is rebuilt, never hand-edited.
- Derive rollout scopes and queues from the current registry. Nine newer WIP
  instruments had incorrectly remained in the regular queue. Four auxiliary
  routes are now explicitly deferred utilities, not counted as instruments or
  labs. Existing WIP adapters and all their evidence are retained.

The first focused Node run exposed an upstream integration mismatch:
`73f13d2` had fixed the shared speaker icon in `proto-shell.js`, but the older
hierarchy proof still expected the pre-fix bytes. The runtime fix is retained
unchanged and recorded as an explicit reversible exception. A new real-shell
regression test checks icon/name retention, explicit Audio arming and transport
continuity. The historical fixture hashes were not rewritten.

The next authoring queue is Shape, Solid, Hyper and Graph Drum Machines, then
L-Systems, Graphs and Tesselation in registry order. This batch does not claim
those migrations are implemented.

## Graph recall reference

The baseline browser pass found Graph Delay and Graph Synth comparisons that
differed only in a trigonometric coordinate's last floating-point bit between
Node and Chromium (`0.1872661309604105` versus `0.18726613096041056`).
Production recall was exact against its own factory bank.

The test now imports the independent factory in the same browser as the
adapter. It still checks exact complete-state equality and successful selected
identity; there is no rounding, loose matcher, copied adapter output or change
to the graph generation, sound or preset data.

## Other browser harness repairs

The route/integration run loaded every public HTML route, but exposed seven
older assertions that treated `.instrument-picker` as a unique node. Migrated
pages intentionally have both Choose and Presets. These assertions now target
the navigation picker under `.tabs`, retaining the same route, query/hash,
active-ID and transport expectations.

The Creaturazoid phone drag trace showed its first volume-lane point beneath
the sticky mobile actions, hitting **Mutate shape** rather than the sequencer.
The test now centers each paint lane and hit-tests both ends before sending a
real captured pointer stroke. Exact six-step velocity interpolation, sound
painting, keyboard behavior and Audio isolation assertions remain intact;
no sequencer implementation or layout was changed to satisfy the harness.

## Verification at the initial 83ea203-based checkpoint

| Check | Result |
| --- | --- |
| Focused source/layout/registry/preset-status/MIDI/plugin checks | 77 passed |
| `npm run verify` | 4,038 passed, six skipped; syntax, SIMD, XYFlow and clean-build WAX parity passed |
| `npm run build:wax` | 207 WAX pages regenerated |
| `npm run build:site` | Local production site and its 207-page WAX subtree built; no deployment |
| `npm run analyze:dependencies` | 549 modules / 1,080 dependency edges; no reported warnings, errors or unresolved imports |
| Focused browser repair checks | 26 passed, including Graph exact recall, alias/metadata navigation and Creaturazoid painting |

The combined browser gate on that base was interrupted on the renewed
fresh-main request after **148 passes**, not completed. Its output is retained
in `browser-final.log`; it is not a passing final release gate. Local logs
and browser evidence are under `test-results/presets-continuation/`.
The original preset baseline was **128 passed, two failed**; the first wider
route/integration run was **233 passed, eight failed**. Both original failure
logs and traces are retained rather than rewritten as successes.

## Verification on fresh main 9a45aa0

| Check | Result |
| --- | --- |
| Focused hierarchy, metadata, Faves, I/O, stereo and Loopini Node checks | 90 passed |
| `npm run verify` | 4,073 passed, six skipped; syntax, SIMD, XYFlow and clean-build WAX parity passed |
| `npm run build:wax` | 209 pages regenerated from reconciled source |
| `npm run build:site` | Local production site and 209-page WAX subtree built; not deployed |
| `npm run analyze:dependencies` | 556 modules / 1,095 edges; no reported warnings, errors or unresolved imports |
| Final combined Chromium gate | **402 passed**, zero failures, across 13 suites with one worker (11 minutes) |

The final browser run covers all 209 public HTML routes, all 451 existing
full-state preset recalls, Shapes' 106-scene bounded-audio sweep and live dice,
menu/preset hierarchy, responsive headers, navigation/query/hash preservation,
Creaturazoid's continuous painting, and the incoming I/O setup and Loopini
suites. These are preservation checks, not new WIP preset authoring.
Portrait and landscape header screenshots were also visually inspected.
The dedicated source-verified server was `http://127.0.0.1:4395/` in this
worktree; it was test-managed, not a promised persistent preview.

Reproduction scope is the exact command at the beginning of
`test-results/presets-continuation/browser-9a45aa0.log`:
`faves-full-presets`, `shapes-full-presets`, `full-instrument-presets`,
`preset-hierarchy`, `preset-menu-colors`, `preset-motion-feedback`,
`site-smoke`, `v2-site-bootstrap`, `catalogue-update`, `instrument-tour`,
`creaturazoid-sequencer`, `io-settings` and `loopini` under `e2e/`.
Fresh-main build/Node logs use the `-9a45aa0` suffix; the focused Node log is
`fresh-main-focused.log`. Earlier partial/failed runs remain separate.

No new bank was authored in this preservation/acceptance batch. All existing
presets remain available. There are still 64 active non-WIP migrations, beginning
with Shape, Solid, Hyper and Graph Drum Machines. The per-route
verification-pending labels remain intentional where listening/device acceptance
has not been performed; a passing recall count does not complete those gates.

Human listening, real microphone/MIDI devices and physical touch feel remain
outside automated acceptance. Green browser tests must not be described as
new approval of timbre, Shape click quality or preset musicality.
