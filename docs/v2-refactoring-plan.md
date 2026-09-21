# Morphazoid v2: preservation-first refactoring

## Current status — September 21, 2026

Preset priority is now **Faves first in menu order, then remaining non-WIP
regular instruments**. WIP and labs are deferred from new preset work; existing
implementations and regression coverage stay intact. The next new banks are
the remaining non-WIP instruments: every current Fave now has an implemented
bank/adapter, with browser/listening acceptance still pending. The
[active queue](full-instrument-preset-rollout.md#active-priority-faves-first-works-in-progress-deferred)
records the order and review policy.

The file-layout refactor was rebased onto main `e042512` in an isolated worktree,
preserving the newer loop-network instruments. The owner then requested a new
test branch for navigation and a full-instrument preset rollout, rather than
immediate publication. `codex/full-instrument-presets` contains the current
checkpoint; main and the old review worktree remain untouched.

The next-instrument arrow and Faves changes are implemented: Creaturazoid follows
Hiccup Head, and Spiral is no longer a Fave. The next local batch moves Hiccup
Head/Hybrinx/Jaw Harp before Hyper Rubix and exchanges Automatapoeia/Lattice.
Complete header preset adapters and 345 states are implemented for 23 regular
instruments; this is partial coverage, not a requirement to finish deferred WIP
before the Faves. The latest geometry feedback pass completed the repository
gate and 40 focused browser checks after approval-service access recovered.
Broader mobile regression coverage and human audition remain pending. The latest fixes are not yet
committed or pushed. See
[the rollout contract and status](full-instrument-preset-rollout.md).
Shape's bank now has 36 scenes with explicit Playhead/Rotate switches and varied
head spacing, per owner request; Audio is still separate. This is a Shape-specific
preset change, not a change to other instruments' transport contracts. The latest
audition feedback restores Velvet wheel's square, removes Sweet orbit, adds
Bowed line variants and balances rotation directions. Hiccup Head now has 25
full scenes, including six new independent rhythm scores. Shape alone opts into
a rounded percussion attack; click resolution still needs browser/listening
confirmation. [Feedback changes and evidence](preset-audition-followup.md).

The shared header now also includes a dice randomize button after its next arrow
on all 23 migrated instruments. Randomizers create new parameter states
within instrument-owned bounds, retaining master level, device state and live
clocks. After the owner's clarification, every preset-owned musical parameter
participates (including Shape's motion switches); this is no longer a small
mutation of a factory scene. New
preset adapters must supply this behavior; unmigrated instruments stay unchanged.
See [the randomization contract and verification](header-preset-random.md).
Solid and Hyper now have 20 scenes each, including interleaved single-motion
examples. Their primary playhead switch participates in recall; Audio does not.
The common header starts at Select Preset. See
[the geometry feedback report](geometry-preset-feedback.md) for the scoped
voice-budget change and actual browser measurements.

## Previous status — September 18, 2026

The owner's updated sheet is being applied on the isolated
`codex/v2-catalogue-layout` worktree, based on main `59e4f4e`. Prior packaging and
source-move layers were carried forward without changing the main checkout.
Catalogue IDs/names/categories and the full root-controller/style cleanup are
now implemented. The owner confirmed the three retained values (`webgpu-303`,
`image-to-instrument-3`, and “Rattlesnake”) and authorized a branch push for
testing on another computer.
See [the current report](v2-catalogue-layout-results.md) for verification,
compatibility boundaries, and rollback artifacts.

Combined Apps and individual instruments remain. The latest sheet retains
Throatazoid, so this batch does not delete it. Device-aware favorites, instrument
redesigns, and further engine abstraction remain separate work. Nothing in this
batch is to be merged into main or deployed before that review. The branch
commit/push is authorized; the previous uncommitted state is preserved in the
local checkpoint.

## Previous status — September 17, 2026

The reviewed preservation layers have been committed, reconciled with fetched
main, and merged into local main. Full verification now passes with zero
failures. See `v2-integration-results.md`; earlier eight-failure counts below
describe the historical source reference, not current main.

Await the owner's catalogue/name/file-layout changes before further runtime
edits. Combined Apps and their individual versions remain until the owner is
satisfied with the replacements. Deep renames, source moves and device-aware
Faves require separate reviewed mappings/evidence.

The worktree now holds two separate, uncommitted layers: release-file
bookkeeping and the first owner-approved directory cleanup using current names.
See `v2-release-manifest-results.md` and `v2-source-layout-results.md`. Public HTML
routes stay stable; internal JS/CSS locations change. Product names/categories,
instrument redesign and device-aware Faves remain pending.

## Objective

Reduce duplication and make the existing instruments easier to maintain without
changing their sound, gestures, presets, routes, or saved data. This is an
extraction and organization project, not an instrument rewrite.

Work proceeds in small, reviewable patches. Completing one phase does not
authorize unrelated changes in a later phase.

## Priority update — September 17, 2026

The owner chose to retire standalone Throatazoid, requested a product-overlap
audit and catalogue/category rearrangement, and wants Alien Larynx design
changes specified before more abstraction. Pause further family extraction
pending those decisions. `v2-instrument-plan.csv` holds proposed catalogue
decisions without changing the live menus. The next integration, retirement,
catalogue and design sequence is recorded in `v2-product-triage.md`, including
the actual local-main divergence and shared dependencies that must survive
Throatazoid's retirement. No deletion or Git history change is implied by this
planning update.

## Starting point — September 16, 2026

- Source reference: `4e9feed0748d94aa86500b0d63218b62b20138c6`.
- Refactoring branch: `codex/v2-preservation`.
- Isolated worktree: `/home/blechdom/creative/morphazoid-v2`.
- Original worktree: `/home/blechdom/creative/morphazoid`, left on `main`.
- The existing untracked `instrument-catalogue.csv` remains in the original
  worktree. It has not been moved, staged, or included in this project.
- At the initial checkpoint, no instrument runtime files, generated WAX files,
  dependencies, hosting configuration, or sound assets had been changed.
- This commit is a source reference, **not yet a verified copy of the published
  site or a listener-approved audio baseline**.

## Agreed organization and tooling

- Keep runtime `assets/` top-level, alongside `src/`. Preserve existing URLs
  and bytes during the DRY pilot; do not duplicate assets inside `src/`.
- Organize new shared source by responsibility. The sizing pilot belongs in
  `src/graphics/`; later instrument-owned code belongs in instrument folders.
- Treat source relocation as a separate, move-only pilot after the first DRY
  pilot is reviewed. Prepare release mapping and discovery before moving files.
- Add report-only duplication/dependency tools before imposing new quality
  gates. Configurations belong under `scripts/architecture/`, not more root files.
- No framework migration, automated deletion, bulk formatting, dependency
  upgrades, or host migration is included in the initial pass.

Current evidence and known baseline failures are in `v2-baseline-results.md`;
tooling commands and limitations are in `refactoring-tooling.md`.

## Review cadence and rollback layers

The owner accepted the Solid/Hyper pilot and asked to continue with larger
batches, broad reuse where behavior is unchanged, and less frequent manual
testing. Work should now advance through coherent groups, not request approval
after each utility or caller.

- Run `npm run test:refactor:fast` during implementation.
- Run the broader checks once per review batch; `npm run test:refactor:batch`
  assembles the current sizing, interaction/audio, build-parity, and full-suite
  checks. It now passes on integrated main; do not preserve old failures as
  permanent exceptions.
- Freeze a candidate artifact for review so continued editing does not change
  the version the owner is testing.
- Keep dependency-aware rollback layers: a caller migration depends on the
  shared helper/policy support it uses. Do not remove the helper while keeping
  callers that need it. Restore source/tests together, then regenerate WAX.
- Prefer small logical local commits when authorized, grouped into larger
  review batches. No commits, merges, pushes, or deployments are implied by
  approval to keep implementing. Current local checkpoints are working backups,
  not off-machine recovery or a committed history.
- Escalate human review for changes to musical mapping, gestures, timing,
  processing, or assets. Do not require a new listening session for each proven
  algebraic extraction.

## Rules for every refactoring patch

1. Name the duplicated behavior, the participating instruments, and the exact
   paths allowed to change before editing.
2. Preserve calculations, constants, state ownership, initialization order,
   event ordering, cleanup, and observable behavior. Matching function bodies
   do not prove matching dependencies or surrounding state.
3. Do not change DSP algorithms, parameter mappings, smoothing, defaults, gain,
   sample rates, random sequences, scheduling, backend selection, or WASM
   compilation as incidental cleanup.
4. Keep existing public routes and entry points. Do not bulk-move files,
   reformat the repository, upgrade dependencies, introduce a new framework, or
   switch hosts in a refactoring patch.
5. Keep Audio arming separate from transport and preserve normal-browser/WAX
   separation. Existing contracts remain authoritative.
6. Add or preserve behavior tests. Never loosen assertions or replace approved
   audio references merely to make an extraction pass.
7. Record pre-existing failures separately. A partial test run is not a green
   repository, and automated signal checks are not listening approval.
8. Stop on unexplained behavior or audio drift. Keep sound fixes and new
   features in separately reviewed work.
9. Do not stage, commit, merge, push, or deploy without authorization for that
   operation.

## Ordered checklist

### 1. Protect the starting point

- [x] Confirm that the earlier merge has finished and no conflicts remain.
- [x] Record the exact source commit.
- [x] Create an isolated refactoring branch and worktree.
- [x] Leave unrelated work in the original checkout untouched.
- [x] Record this plan before changing instrument code.

**Gate:** an identifiable, recoverable source reference and an isolated place
to work. Completed for source; production-artifact preservation is in step 2.

### 2. Establish the baseline

- [x] Run focused geometry, audio, worklet, and output-manager tests.
- [x] Install locked dependencies in the isolated worktree without upgrades.
- [x] Run `npm run verify`; record all existing failures before fixing anything.
- [x] Verify the exact preview endpoint and worktree, then run relevant browser
  checks. Do not accidentally reuse a server belonging to another checkout.
- [ ] Identify the release the owner wants preserved. Archive its built assets
  and provenance before any publication; do not assume the source reference
  above is identical to production.
- [x] Define reference scenes for the two pilot instruments, Solid and Hyper:
  default state, representative sound modes, fixed inputs, transitions,
  start/stop, and resize during playback.
- [ ] Record the browser, sample rate, seed/input sequence, timing, and reference
  release. Obtain human approval of the reference sound before calling it an
  approved audio baseline.

Follow the two-stage baseline process in `../QA_AUTOMATION.md`. Expand approved
scenes before each family migration rather than attempting to capture every
instrument before the first small extraction.

**Gate:** baseline failures are known, and local-source pilot behavior can be
compared. Production-reference selection and human listening approval remain
pending; the local characterization must not be relabeled as an approved sound.

### 3. Make one small DRY pilot

- [x] Confirm the identical canvas-sizing calculation in `hyper-app.js` and
  `solid-app.js`, including its surrounding state and scheduling.
- [x] Capture the existing calculation in a characterization test before
  replacing either copy.
- [x] Extract a pure sizing helper and use it in these two controllers only.
- [x] Keep the existing rounding, device-pixel-ratio handling, 3,000,000-pixel
  budget, canvas assignments, observer lifecycle, and frame scheduling.
- [x] Test old and extracted results across normal, fractional, tiny, large,
  and high-DPI dimensions. Preserve edge behavior; do not add unrelated fixes.
- [x] Leave DSP, processors, audio graph construction, and sound assets alone.

**Gate:** equivalent sizing results and unchanged initialization, interaction,
transport, and audio behavior. No rollout to other controllers yet.

### 4. Verify and review the pilot

- [x] Run focused tests and `npm run verify`.
- [x] Regenerate WAX output with `npm run build:wax` when runtime changes, and
  require `npm run check:wax-dist` to pass. Never hand-edit `dist-wax/`.
- [x] Check both instruments at desktop `1440x900`, phone portrait `390x844`,
  and phone landscape `844x390`.
- [x] Check resize during playback, Audio-off behavior, start/stop, and cleanup.
- [ ] Compare the reference scenes and complete the applicable A/B listening
  and device pass.
- [x] Review the scoped diff, generated changes, and evidence with the owner.

**Gate:** explicitly accept the pilot before expanding the refactoring pattern.

Automated comparisons are complete: 105 focused Node tests pass; the final full
suite has exactly the same eight pre-existing failures; both browser runs pass
all eight checks, and all six settled screenshots match byte-for-byte. WAX
parity passes. The owner approved continuation after reviewing the pilot.
The particular listening setup and physical-device checks were not reported.

### 5. Expand low-risk shared utilities

- [x] Adopt the proven sizing helper in other genuinely matching controllers.
- [ ] Review exact duplicates in status presentation, control binding, pointer
  coordinates, and geometry-editor utilities.
- [ ] Reuse existing `src/ui/` foundations where appropriate.
- [ ] Keep instrument-specific mappings, caches, and musical state outside
  generic UI utilities.
- [ ] Give each extraction at least two real consumers and its own tests.

**Gate:** each small patch preserves the participating instruments. Do not
create one universal instrument controller or a large collection of mode flags.

The first broad sizing batch now shares one calculation across 38 controllers
and 48 pages. Existing caps, budgets, sub-one device-scale behavior, conditional
canvas writes, transforms, redraws, and gesture effects are preserved. The
remaining specialized/unreviewed sizing methods are not forced into this rule.
See `../src/graphics/README.md` for the policy boundary.

### 6. Extract instrument-family modules

- [x] Start with the substantial Alien Larynx/Throatazoid duplication.
- [x] Extract shared tract geometry with explicit current-state/view dependencies.
- [x] Extract the identical physical-tract renderer in a separate layer.
- [ ] Review gesture helpers separately, preserving instrument-specific differences.
- [ ] Review duplicated graph-editor/controller behavior next.
- [ ] Keep original routes, entry modules, processors, and sound assets stable
  during these extractions.
- [ ] Extend reference scenes and regression coverage before each migration.

**Gate:** shared family behavior has one implementation without removing either
instrument's identity. Geometry and gestures can affect sound and are not
assumed harmless merely because they are outside a processor.

The first tract layer moves four identical calculation bodies into
`src/families/tract/geometry.js`. Each page is 411 lines shorter; the shared
module is 455 lines, for 367 fewer authored runtime lines overall. Processing,
presets, smoothing, drawing, gestures, and lifecycle code remain page/model-owned.
The accepted sizing build is retained as the comparison reference.

The second tract layer extracts the 717-line physical-tract drawing block into
`src/families/tract/rendering.js`. Each controller is another 689 lines shorter;
the net reduction is 653 runtime lines. Animated profile preparation and all
four hit-test alias assignments remain in the original order in the pages.
Exact Canvas-command comparisons, 36 same-browser fixed-frame pixel comparisons,
and paired live-page interaction/synthetic-audio checks pass. No processing,
mapping, smoothing, scheduling or gesture code was changed.

### 7. Clarify module ownership and release assembly

- [x] Separate pure catalogue/route data from navigation initialization.
- [ ] Make MIDI, transport, and page initialization explicit without changing
  their behavior or event ordering.
- [x] Begin grouping instrument-owned code: 18 controllers and 11 stylesheets,
  retaining public HTML entry points and updating their resource references.
- [ ] Continue the remaining controller/style families in separately verified batches.
- [x] Ensure source checks and dependency discovery cover any new directories.
- [ ] Replace release-file special cases with a reviewed runtime-asset manifest.
- [ ] Preserve the WAX generation/parity contract. Changing whether generated
  output is committed requires a separate compatibility decision.

**Gate:** authored behavior and released asset dependencies remain equivalent.

The first ownership layer moves the existing ordered navigation records into
`src/site/instrument-registry.js`. `nav.js` keeps its public URL, exports, URL
base and startup behavior. Data-only consumers no longer initialize navigation.
All 142 existing shared instrument browser contracts pass on both builds with
identical captured records; focused menu/catalogue and transport checks also
match. No missing registry entries were silently restored, and the same eight
full-suite failures remain visible.

### 8. Consider audio deduplication and hosting separately

- [ ] Inventory remaining duplicated audio-control and DSP code.
- [ ] Select only candidates with adequate deterministic or reviewed
  reference-audio coverage. Some similar implementations should remain distinct.
- [ ] Preserve WASM bytes and toolchain settings unless a separately approved
  task changes them.
- [ ] Improve release identification, reproducibility, and rollback before
  considering another host.
- [ ] Evaluate hosting as a separate decision with asset-size, header, caching,
  microphone/MIDI, and WAX requirements. Keep existing hosting during the DRY
  pilot and family extractions.

**Gate:** no audio change or deployment migration is smuggled into a structural
cleanup. Publication still requires separate authorization.

## Evidence recorded so far

On September 16, 2026, at the source reference above, under Node.js `v22.23.2`:

```sh
node --test --test-concurrency=2 --test-reporter=spec \
  tests/geometry.test.mjs \
  tests/hyper.test.mjs \
  tests/solid.test.mjs \
  tests/audio.test.mjs \
  tests/synth-processor.test.mjs \
  tests/audio-output-manager.test.mjs \
  tests/geometry-transport-parity.test.mjs
```

Initial result: **98 passed, 0 failed, 0 skipped** across seven test files. These are
focused Node/model/worklet-harness tests, not full browser or audio-reference
comparisons. Subsequent full verification and browser results are recorded in
`v2-baseline-results.md`. Production-asset archival and human listening approval
remain pending.

## Handoff after each patch

Report the shared behavior extracted, changed paths, participating instruments,
tests actually run, pre-existing failures, unperformed listening/device checks,
and the next bounded step. Update this checklist only when its work is actually
complete.
