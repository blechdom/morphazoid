# Shapes manual audio and first-cycle investigation

September 23, 2026. Automated characterization only: no physical-phone or
human listening approval.

## Source and scope

Tested `codex/shapes-manual-notes-20260923`, based on `9a45aa0`, with the
working-tree manual-audio changes. This is not a claim about deployed bytes.
The later iPhone-startup commit on `origin/main` is not part of this worktree.

Manual motion now preserves:

- Continuous voices, updating their existing trajectories rather than issuing
  a global silence on every drag event.
- Notes' full envelopes, including complete manual attacks when Swell is on.
- Both FM-kit and Rattlesnake trigger tails. Taking over automatic motion
  cancels only future hits and retains the manual trigger debounce history.

This applies to 2D, 3D and 4D. The 2D canvas retains its inside/reader and
outside/rotation gestures. The 3D canvas uses outside/body and inside/reading-surface rotation.
The 4D canvas defaults to moving its reader and its Canvas drag selector also
enables direct X–W, Y–W or Z–W rotation. Neither changes hidden 2D state;
axis controls remain available. Explicit Audio off and transport stops retain their release behavior.
Continuous still fades after all motion ends.

Rattlesnake's scheduled-voice cleanup also measures its timeout from the
current audio clock, not the future attack time, avoiding premature cleanup
by the length of the scheduling lead.

## Functional verification

The new regressions reproduced the repeated silencing in Continuous and
Triggers before the fix. Afterward, all 55 manual-audio browser cases passed:

```sh
MORPHAZOID_QA_PORT=4393 npm run test:browser -- \
  e2e/shapes-manual-motion.spec.mjs e2e/shapes-manual-notes.spec.mjs --workers=1
```

These cover four Continuous engines, five Notes engines, both Trigger banks,
all three dimensions, sliders, keyboard, canvas reader gestures, automatic/
manual handoffs, Audio-off gestures, release, and emulated touch/cancellation
at `390x844` and `844x390`. Native-engine unit tests check that cancellation
leaves existing source stop times and gains untouched, and releases future
sources and their cleanup timers.

The frozen module-relocation baseline remains unchanged. Exact source
amendments and their tests are recorded in
`shapes-manual-notes-runtime-changes.json`.

`npm run build:wax` and `npm run verify` passed: 4,076 Node tests passed,
6 were skipped, and the committed WAX output matched a clean build.

The existing preset/audio regression suites also passed all 17 cases,
including every factory scene and both seeded random tours:

```sh
MORPHAZOID_QA_PORT=4393 npm run test:browser -- \
  e2e/shapes-full-presets.spec.mjs e2e/audio-contract.spec.mjs --workers=1
```

## Phone report: first cycle only

The owner reported clicks after changing settings on a dense shape, disappearing
after one cycle. The following is evidence for a likely timing bottleneck, not
confirmation that these are the same audible clicks on the owner's phone.

### Preset and envelope inventory

Inspected all 106 factory scenes and 1,000 deterministic random scenes
(initial seed `93239`). The timed Notes factory attacks ranged from 8 to
160 ms. The randomizer's source bounds are 12–180 ms for tonal Notes attacks,
150–700 ms for their release segments, and 8–25 ms for corner-percussion
attacks. No zero-length attack was found in those timed Notes envelopes.

This does **not** treat Continuous's spatial envelopes as millisecond ADSRs.
FM-kit drum attacks are separate, deliberately sharp envelopes, including
1 ms attacks. There is no evidence here justifying a blanket change to all
envelopes or presets.

### First-cycle measurements

Compared desktop `1440x900`, DPR 1, with Chromium at `390x844`, DPR 3 and
4× DevTools CPU slowdown, at 48 kHz. This is a controlled slow-browser
experiment, not iOS/Safari or a physical-phone emulation.

Five scenes were exercised for three reader-cycle windows and then recalled:
Interference grid, Corner storm, Endless hypersphere, Eight facets, and Line
rattle. A reader-cycle window is not necessarily a complete geometry repeat
when independent rotation is also running.

Corner storm's 4×-slowdown result was repeated in three fresh browser runs:

| Measurement | First cycle after change | Later cycles |
| --- | --- | --- |
| Main-thread long tasks | 127, 127, 143 ms across the three runs | No reported tasks of 50 ms or more |
| Largest frame gaps | 133–150 ms | Approximately 50 ms |
| Sampled live tone oscillators | 9–11 | 9–10 |

Recalling the already-warm scene still produced 72–83 ms long tasks. The
initial broader run had a 134 ms first-cycle long task. Shapes' scheduling
lookahead is 75 ms; these stalls can exhaust that lead. Fewer attacks were
created in the first window than in later windows, consistent with the
scheduler's intentional skipping of stale events, not a late catch-up burst.
No clipping was observed in the sampled output.

A short CPU profile identified repeated geometric scene construction inside
`runDiscreteScheduler` as the dominant authored-JavaScript cost, rather than
native strike creation. Source inspection also shows two initial lookahead
fills during an armed preset recall: one directly from preset application and
another after `prepareActiveAudio` resets the clocks. Geometry generation,
allocations/collection, and repeated initialization are therefore concrete
optimization targets.

Corner storm uses **Notes / corner percussion**. Continuous does not run that
discrete lookahead scheduler. A Continuous-only report would need to be matched
to its own preset and renderer measurements rather than assuming this same
initialization path is responsible.

### Voice pressure

Pressure is still relevant, but it is not simply “more oscillators on cycle
one.” Continuous/tonal Notes used the worklet, not a bank of native oscillator
nodes. Interference grid reached 32 DSP voices; Eight facets reached 22 voices
in its first slowed window and 26 later. Endless hypersphere showed adaptive
settling from an eight-voice limit to four in one desktop run. Shepard voices
evaluate multiple partials, so voice counts are not equal DSP-cost units.

The native Line rattle scene had roughly 17–25 live tone oscillators across
windows, without an increasing first-cycle pool. Native percussion/hit limits
are separate from the synth worklet's adaptive voice limit.

Worklet load telemetry used a coarse clock. Its individual peak readings do
not prove audio-device underruns. The idle synth's telemetry is not a load
measurement for native FM-kit/Rattlesnake engines. Coarse output meters and
CPU profiles are not an event-aligned audio recording or a listening verdict.

## Conclusion and remaining work

The strongest supported suspect for the first-cycle report is a settings-change
and dense-geometry scheduling burst. Live-note accumulation and accidentally
zero-length randomized Notes attacks were not supported by this reproducer.

The manual-motion fixes are implemented. The separate 2D first-cycle/duplicate
initialization optimization is **not** implemented by this patch. The additional
high-subdivision Notes cutout fix below is implemented. No preset envelopes,
randomization ranges, or voice ceilings were changed to disguise either symptom.
A follow-up should avoid redundant lookahead initialization and reduce the
geometry work needed to fill it, while preserving timing and musical density.
The actual phone, browser, mode and scene are still needed to confirm the
owner's audible case.

Local, ignored evidence is under `test-results/shapes-all-modes/`: the preset
inventory, first-cycle JSON, three Corner storm repeat JSON files, and cold/
repeat `.cpuprofile` captures. These are working-session artifacts, not
committed audio baselines.

## Follow-up: complete cutouts with high-dimensional subdivisions

A further report described sound cutting out completely at high subdivisions.
This produced a stronger deterministic failure than the earlier first-cycle
stall. With a stationary hypersphere, a moving reader, PM Notes, 16 subdivisions
and 4× CPU slowdown, the scheduler attempted to recreate 4,428 note anchors on
each of its 256-per-second geometry samples. Most were repeated interior-edge
points whose coordinates did not change when only the reader moved.

| Same six-second 4D/16-subdivision case | Before | After |
| --- | ---: | ---: |
| Median scheduler callback | 124.5 ms | 10.9 ms |
| Maximum callback | 173.1 ms | 36.4 ms |
| Callbacks ending with under 12 ms of forecast lead | 39 of 39 | 0 of 96 |
| Scheduled note batches | 0 | 607 |
| Final sampled output RMS | 0 | 0.091 |

Before the fix, all 733 discovered events were discarded as already late.
Afterward, late-event skipping and the existing event-rate ceiling still apply;
this is not a claim that every candidate event is played at pathological
densities. The 3D sphere/16-subdivision median also fell from 32.8 to 4.3 ms.

The fix keeps one subdivision-point cache per higher dimension. Exact
coordinate and edge-topology snapshots detect changes, including in-place
edits. Reader-only changes reuse the existing interior points; real rotations
and deformations regenerate them with direct scalar arithmetic rather than
temporary arrays, tuples and `Object.fromEntries` per point. Each sample keeps
its own vertex list, and previously scheduled points are not overwritten.

Five pure tests compare all points and crossing intents against the original
interpolation for spheres, hyperspheres and Klein geometry, including changing
rotations and divisions 1, 2, 4 and 16. Twelve slow-browser tests passed for
3D/4D reader-only and rotating scenes, using PM, Shepard and corner percussion
after changing from 4 to 16 subdivisions.
Their deliberately sustained test envelopes bridge ordinary scan-edge rests;
no sampled silent run reached 250 ms. The subdivision value remains 16.

```sh
node tests/shapes-subdivision-cache.test.mjs
MORPHAZOID_QA_PORT=4393 npm run test:browser -- \
  e2e/shapes-high-divisions.spec.mjs --workers=1
```

The diagnostic also compared FM-kit Triggers at 4 and 16 subdivisions in both
dimensions. Those cases did not reproduce the all-events-late failure. The
optimization changes Notes sampling, not the Trigger rhythm model.

Local before/after evidence is in `high-divisions-before.json` and
`high-divisions-after.json` under the same ignored artifact directory.
The attempted worklet-module interception did not provide raw audio blocks;
zero-length block collections are **unavailable measurements**, not evidence
of silence duration. The findings above use scheduler counters, note submissions
and actual output-meter readings. The separate browser regression measures
output during playback. A physical-phone listening pass remains outstanding.

Final verification of this follow-up: `npm run verify` passed (4,076 passed,
6 skipped), including clean WAX parity. The combined browser run passed all
12 high-subdivision and 17 manual-Notes cases. It initially reported two
2D Trigger handoff failures: their first crossing was only about 18 ms after
transport startup and could be skipped by the existing late-event guard,
leaving the test sampling a rest before testing the handoff. The fixtures now
leave approximately 300 ms before that crossing; the sound and handoff
assertions were not relaxed. Rerunning the entire manual-motion suite passed
all 38 cases. This fixture correction changes no runtime playback behavior.

## Direct 4D canvas rotation

The owner additionally requested manual 4D rotation on the graphic itself.
A compact Canvas drag selector below the 4D canvas offers Move reader, Rotate
X–W, Rotate Y–W and Rotate Z–W. Reader remains the default, preserving existing
gestures. Choosing a plane maps a left/right drag to that actual 4D rotation,
not to the 3D camera or hidden 2D state. Sensitivity is normalized to canvas
width (240 degrees per width), following Hyper's gesture convention.

Left/Right Arrow rotates the selected plane by one degree; Shift increases
the step to ten degrees. Angles wrap at the seam. Grabbing a plane pauses only
that plane's automatic motion, leaving the reader and other independent planes
running. Audio is never armed by these gestures. Existing note and trigger
tails are retained. The drag selector is UI state outside preset snapshots;
angles remain part of the existing saved live state.

Pointer up, cancel, lost capture, window blur, visibility/page changes, changing
the selected plane/dimension, preset recall and Reset All release a held gesture.
The gesture snapshots its initial width, avoiding layout reads on every move.
The selector sits outside the graphic, has a native label, and uses a 48-pixel
coarse-pointer target.

The new focused browser suite covers all three planes, wrapping keyboard edits,
transport independence, all playback modes/banks, interruption cleanup, saved
angles, preset-safe UI state, and desktop/phone layouts. The control's complete
axe audit runs after gesture/network checks: axe's own stylesheet probing
re-requests nested CSS imports against the wrong base URL, even in legacy mode.
Those audit-only diagnostics are attached separately; normal page and gesture
HTTP/console errors remain a strict gate, and no accessibility rules are disabled. Gesture-coordinate assertions allow
0.00005 degrees for observed browser subpixel rounding; unchanged axes and
playhead positions are still checked exactly.

```sh
MORPHAZOID_QA_PORT=4393 npm run test:browser -- e2e/shapes-4d-drag.spec.mjs --workers=1
```

Screenshots are captured with the browser results. The session's image-viewing
tool could not access those files, so no human visual/listening/touch approval
is claimed.

Direct-4D validation completed: all 19 focused gesture tests passed, including
strict axe checks of the new control at all three viewports. The standard
Shapes-filtered UI audit passed all four selected cases. The combined motion/
high-density run passed the 67 existing regression cases; its three initial
new viewport failures were axe-generated import diagnostics, resolved by
separating instrumentation from the real-page error gate and rerunning the
focused suite. `npm run verify` passed (4,076 tests passed, 6 skipped), and the
regenerated WAX tree matched a clean build.

```sh
MORPHAZOID_QA_PORT=4393 npm run test:browser:audit -- --grep '[Ss]hapes' --workers=1
```

## 3D inside/outside gestures and random-dimension balance

The owner requested the model “outside rotates the shape; inside rotates the
playhead/playing surface.” In 3D, a pointer down outside the projected body
now captures shape rotation (horizontal Y, vertical X); inside captures surface
yaw/pitch. Both use canvas-relative sensitivity and keep the selected target
until release, even when the pointer crosses the outline. Only the captured
axes' automatic motion is paused; the scan transport and other axes are retained.

Picking uses the convex outer outline of projected body vertices, with a
12-CSS-pixel edge allowance for touch. Holes/concavities inside that envelope
are intentionally part of the reader grab region. The larger reading-plane
quad does not capture gestures outside the body. Picking runs once on pointer
down, not on every audio or animation tick. It reuses the existing pure convex
hull and point-in-polygon helpers. The position slider and canvas Left/Right
Arrow still translate the reader through the solid; the existing Rotate
controls provide keyboard-accessible rotation. The 4D plane menu is unchanged.

The header dice does not downweight 3D: it chooses uniformly from shape, solid
and hyper, then generates a complete scene rather than choosing a factory row.
A chained 6,000-roll check with seed `20260923` produced:

| Dimension | Count | Percentage |
| --- | ---: | ---: |
| 2D | 2,023 | 33.7% |
| 3D | 2,005 | 33.4% |
| 4D | 1,972 | 32.9% |

The current factory bank contains 46 2D, 30 3D and 30 4D scenes; that affects
the preset menu/tour, not dice probabilities. No randomization weights or
parameter-generation ranges were changed. A deterministic regression checks
broadly balanced dimension coverage without pinning the exact RNG call order.

Five pure gesture tests cover outline/bounding-box distinctions, touch edges,
degenerate input, wrapping, transport isolation and stale gestures. The new
20-case browser suite covers both drag regions, locked targets, all sound modes
and both Trigger banks, translation controls, cancellation and phone layouts.

```sh
node tests/shapes-stage-gestures.test.mjs
node tests/shapes-random-dimensions.test.mjs
MORPHAZOID_QA_PORT=4393 npm run test:browser -- e2e/shapes-3d-drag.spec.mjs --workers=1
```

Validation of the 3D update: all 20 new browser gesture tests passed, along
with the five pure gesture tests and the 6,000-roll distribution regression.
`npm run verify` passed (4,082 passed, 6 skipped), including regenerated WAX
parity and the runtime manifest check for the new gesture module. The combined
106-case browser run passed 103 cases; the three adapted position-slider
fixtures initially supplied noncanonical numeric strings to Playwright's native
range-input filler. After formatting exact canonical decimal steps, all three
passed on rerun without changing application code or relaxing assertions.

## Novice sound updates — 2026-09-23

Scope: Shapes only. Factory scenes and header dice now favor audible registers,
meaningful motion and less aggressive FM. Manual controls, saved user scenes,
the original Shape/Solid/Hyper instruments and continuous geometry-derived tuning
are not restricted. No automatic scale quantization, master-output change or
implicit Audio arming was added.

- Triangle and square are explicit engines in Continuous and Corners & Notes,
  in all three dimensions and both sound-control models. Worklet square uses
  PolyBLEP edge correction; triangle uses the integrated polynomial corner
  correction (PolyBLAMP), not a leaky integrator or a harmonic oscillator bank.
  Both have native oscillator fallbacks and independent adaptive-polyphony
  profiles within Shapes' existing 32-voice allocation. Changes involving the
  new waveforms fade through zero over 6 ms each way in the worklet.
- The 110-scene factory bank adds **Triangle corners**, **Square corners**,
  **Triangle current**, and **Square current**. The 76 raw imported adapters and
  all 122 original reference voice fixtures stay unchanged; performer-facing
  factory snapshots are tuned separately. Existing factory IDs remain stable.
- Factory/dice FM index is scaled by 0.28, capped at 1.5; ratio is bounded to
  0.5–2. FM scene level is halved, capped at 0.24. Square scene level is capped
  at 0.3. These are generated/curated starting values, not new manual limits.
  Trigger banks do not inherit attenuation from an inactive synth-engine field.
- Dice makes a fresh scene level on each roll (0.42–0.6 before timbre adjustment),
  instead of cumulatively attenuating the previous roll. The separate user
  output level, including mute, is preserved. Factory/rolled base frequency is
  at least 110 Hz; the mapped upper frequency is at most 3200 Hz. Pitch curves
  retain their shape and continuous frequencies. Shepard's octave partials are
  intentionally not confined to that fundamental-frequency register.
- Active factory/dice rotation axes have useful minimum speeds; round,
  rotationally symmetric shape-only scenes also move the reader. Shape-only
  polyhedral studies remain shape-only. Dense 2D dice rolls reduce generated
  subdivisions/head count before slowing the reader almost to a standstill.
  Curated dense subdivision studies and the full manual subdivision range remain.
- Shepard remains in seven Continuous factory scenes and **Sphere beads** in
  Corners & Notes, and in the dice pool for both modes. No oscillator weights or
  dimension weights were added. A fresh 6,000-roll chained seed `20260923` yielded
  2D 2,027 / 3D 2,001 / 4D 1,972; factory counts are 48 / 32 / 30.

### Mechanical characterization (not listening approval)

Deterministic Node worklet probe at 48 kHz, 440 Hz carrier, 0.8 mapped drive,
200 × 128-sample blocks with the first 6,000 samples discarded. Same carrier and
contact gain isolate scene-level/timbre changes from the raised preset register.
Values are single-channel worklet output, not acoustic loudness measurements:

| Source | Raw-adapter RMS → tuned RMS | RMS adjacent-sample step / signal RMS, before → after |
| --- | --- | --- |
| Glass star | 0.10392 → 0.09021 | 0.76858 → 0.08610 |
| Prism brass | 0.09686 → 0.08221 | 0.31142 → 0.08230 |
| Klein reed | 0.08532 → 0.06614 | 0.07343 → 0.05889 |

These support reduced output and high-frequency activity, not a claim of equal
perceived loudness or approved timbre. Regression tests also check waveform
non-silence, DC balance and bounds from 20 Hz to 20 kHz; coherent DFT alias-energy
reduction; complete ADSR releases; native fallback routing; live waveform-change
ramps; manual 20 Hz / seven-octave / index-12 / ratio-8 settings; saved-scene
recall; and 600 seeded model scenes producing voices/events within eight seconds.
The event scan uses the appropriate tonal/percussion gain rather than treating
an inactive percussion mapping as the amplitude of a tonal note or drum trigger.

Final source verification: `npm run build:wax` and `npm run verify` passed:
**4,097 passed, 6 skipped**, runtime syntax and deterministic XYFlow/WAX parity
included. Browser evidence and any limitations are recorded below after the
final interaction matrix completes.

The old port 3439 returned an empty response during preview validation. A new
`npm run dev -- --port 3449 --strict-port` preview serves this worktree at
`http://127.0.0.1:3449/shapes.html`; served state/worklet SHA-256s were checked
against authored files. No other server was stopped. No commit or publication
was performed. Physical-phone/iOS/WebKit listening and tactile approval remain
unperformed; phone-shaped Chromium viewports and CPU slowdown are not substitutes.

### Short-landscape defect found during the new waveform matrix

The initial combined preset/waveform browser run was **19 passed, 3 failed**:
all three `844×390` waveform cases timed out because the vertically stacked
230 px minimum canvas plus two headers collapsed the actual control scroller.
Playwright reported the panel header/HTML intercepting mode-button clicks; the
older range-fill-only layout checks had not exercised those pointer targets.

A Shapes-only short-landscape media rule now lays the stage and controls side by
side (601–900 px width, up to 520 px height). It preserves the portrait stack and
desktop layout. Independent checks at `844×390` could click Corners & Notes and
select Square with Audio off for both fine and coarse pointers: control-scroller
heights were 198 px and 172 px, with zero horizontal overflow. The revised
waveform matrix uses actual coarse-pointer contexts for phone sizes and asserts
a usable control-scroller height as well as real clicks. No force-click, hidden
control dispatch, disabled accessibility rule, or increased timeout masks the
failure. This CSS fix was regenerated into WAX and received another full verify.

### Final browser gate

**137 passed** (single-worker Chromium run, 8.4 minutes) against the byte-verified
port-3449 worktree preview:

```sh
MORPHAZOID_QA_BASE_URL=http://127.0.0.1:3449/ npx playwright test \
  e2e/shapes-waveforms.spec.mjs e2e/shapes-high-divisions.spec.mjs \
  e2e/shapes-manual-motion.spec.mjs e2e/shapes-manual-notes.spec.mjs \
  e2e/shapes-3d-drag.spec.mjs e2e/shapes-4d-drag.spec.mjs \
  e2e/audio-contract.spec.mjs --workers=1
```

This includes the repaired landscape cases, Continuous/Notes waveforms in all
three dimensions, 20 dense 3D/4D subdivision cases under 4× CPU slowdown,
manual/automatic handoffs, both Trigger banks, full ADSR tails, direct 3D/4D
rotation, touch cancellation, keyboard interaction, diagnostics, and shared
audio regressions. All 13 preset-suite cases had also passed: exact recall and
audibility for all 110 factory scenes, two seeded 24-roll live dice sweeps,
MIDI/state/BFCache checks, and phone control reachability.

The worklet switch path was checked once more after eliminating temporary arrays
and redundant settled-fade clamps from its audio-thread loop: **72 focused DSP,
audio-routing and starter-policy tests passed**. The last full verify remained
**4,097 passed, 6 skipped**, including clean WAX parity. No physical phone or
human listening acceptance is implied.

Ignored local evidence: `test-results/shapes-starter-initial-report/` retains the
initial landscape failure and preset evidence; `test-results/shapes-sound-final-report/`
contains the final browser report; `shapes-sound-regression-final.log`,
`shapes-sound-dsp-final.log`, and `shapes-sound-verify-final.log` under
`test-results/` retain the command results. Source, preview and WAX stylesheet
hashes matched; the final preview worklet hash matched authored source as well.

## Main integration — owner-requested rebase and push

Rebased the scoped Shapes change onto fetched `origin/main` at
`701dae8a7fb50a9bea3cb8d4ddf33c98ad92ccd8`, preserving the newer iPhone startup,
site-metadata and pointer-refactoring work. The only textual conflict was in
`tests/module-hierarchy.test.mjs`; both iPhone and Shapes exact amendment checks,
the site relocation map, and the pointer restoration remain active. All 200
focused preservation/audio/preset tests passed after conflict resolution.

Post-rebase gates:

- `npm run build:wax` and `npm run verify`: **4,143 passed, 6 skipped**;
  regenerated WAX matches a clean build.
- `npm run build:deploy` and `npm run check:storybook-dist`: passed; 109 Storybook
  entries verified. No deployment workflow was manually dispatched.
- Single-worker browser integration on the byte-verified worktree preview:
  **84 passed** across `e2e/iphone-audio-startup.spec.mjs`,
  `e2e/shapes-waveforms.spec.mjs`, `e2e/shapes-manual-notes.spec.mjs`, and
  `e2e/shapes-manual-motion.spec.mjs`, including pending startup cancellation,
  late-resume protection, interruption recovery, manual tails, Trigger banks,
  and desktop/phone waveform controls.

The pre-rebase commit is retained locally as
`codex/shapes-pre-main-rebase-20260923` (`f87d46a`); the tracked/untracked checkpoint
is under ignored `test-results/shapes-publish-checkpoint/`. The separate dirty
local-main checkout and its unpublished Puggler commit were not altered or
included. Publishing uses a normal fast-forward push from this branch to remote
main, not a force push. Post-rebase logs and browser evidence are under
`test-results/shapes-rebase-*`. Human/physical-phone listening remains outstanding.
