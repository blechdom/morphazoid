# L-Systems subdivision notes

## Findings and fixes

The combined `l-systems.html` app already used the same subdivision frontier for
Notes and Triggers, but Notes multiplied each note by a **continuous-loop boundary
fade** evaluated at its subdivision index. Index zero therefore became a gain of
only `0.001`: the first note of every branch was nearly silent, and with one
subdivision almost the entire score disappeared. Notes now start a full envelope
at those same branch/intersection events; only sustained Continuous uses the
spatial boundary fade.

Notes also bypassed the synth worklet with native oscillator strikes, using a
4 ms exponential attack, extra attack noise for FM, and frame-time batches of
new oscillators. Notes now uses the existing timed-note worklet and its actual
Sine, FM, PM and Shepard models. A conservative per-note level, at least 8 ms
attack and 20 ms release, and independent complete envelopes avoid chopping
previous notes at subsequent branch events. The shared branch amplitude editor
now shapes Notes too, mapped onto each note's duration (90–700 ms before envelope
minimums), instead of being an ineffective Notes control. Native fallback uses
the same envelope through the shared smooth-attack path.

Both discrete modes use one scheduler on `AudioContext.currentTime`, with an
85 ms lookahead and 25 ms polling, rather than firing a swept frame's notes all
at once. Sweep sample positions supply distinct scheduled times. Starts are
bounded to 128/second with a 16-start burst and at most eight simultaneous grouped
voices; the budget survives control edits. Notes has a 128-voice ceiling, and
overload admits fewer attacks rather than growing an unbounded oscillator graph.
The existing subdivision sweep/grouping semantics and their bounded sampling
remain: this is not a promise to sound every branch of an arbitrarily dense tree.
Stale attacks after a UI stall are skipped, not replayed. Stop and Audio off
release sounding notes; ordinary parameter edits never cancel upcoming notes or
restart the scheduler. Dense discrete visuals run at 24 fps while audio keeps its
independent clock.

### Uninterrupted live edits

A held-drag regression exposed a problem in the first local fix: every range,
select and ADSR movement invalidated the clock, canceled queued notes and seeded
a new frontier. Repeated movement could therefore prevent any queued note from
reaching its onset. The existing test checked recovery **after** a few edits and
missed the silence **during** a sustained gesture.

The scheduler now stays alive throughout parameter editing. New notes read the
latest ADSR, pitch, timbre, pan and level values; scheduled notes and sounding
tails finish normally. Speed, subdivisions, grammar, mapping and direction changes
are coalesced into the next unscheduled window (within the 85 ms lookahead),
without moving the audio already queued. A bounded motion history keeps the
visible phase consistent across speed/direction changes. Reader seeks join that
same queue rather than clearing it. The start budget survives every update.
Explicit Stop/Audio off still release sound, and intentional zero speed or zero
level still has its normal musical meaning.

Regression tests now hold the pointer down throughout repeated ADSR and range
moves and observe sound **before release**, not just afterward. Emulated touch
covers portrait/landscape and touch cancellation; rapid geometry/timing updates
cover both Notes and Triggers. Model tests prove phase continuity, latest-value
coalescing, bounded history, zero-speed recovery and seek behavior.

## Controls and compatibility

- **Subdivisions** is beside Speed in Transport: every integer **1–16**, including
  3, 5, 6 and other non-power-of-two values.
- The same value is visible in Notes, Triggers and Mic (where it affects delay
  density), and hidden in Continuous, where it has no effect.
- Short landscape screens use side-by-side stage/scrolling controls instead of
  collapsing the parameter viewport below a tall stage. Coarse-pointer transport
  targets are at least 48×48 pixels.
- Existing ranges, grammar presets, free pitch mapping and Audio/Play separation
  are retained. Standalone L-System / L-System Drum Machine pages are unchanged.
- Exact feature amendments in `l-systems-notes-runtime-changes.json` reverse the
  controller changes before the existing frozen relocation checks; no frozen
  reference hashes are refreshed.

## Verification boundary

Model/DSP tests cover every integer subdivision, first-hit level, forward/reverse
and loop/ping-pong timing, all iteration structures, overload/stall behavior,
rapid-edits start budgets, envelope presets, real worklet output and note tails.
Browser coverage includes desktop `1440×900`, portrait `390×844`, landscape
`844×390`, all four note engines, dense trees, paint suspension, live edits,
Audio-off playback, stop, and teardown. Deterministic native-fallback renders
compare the former exponential attack with the new rounded envelope at 123,
220 and 330 Hz, reporting raw levels and RMS-normalized carrier-removed onset
energy versus a steady window. This isolates envelope transients, not perceived
quality of every dense-tree timbre.

No human listening approval or physical-phone CPU/touch testing has occurred.

### Earlier completed checks — 2026-09-24

- `npm run verify`: 4,232 passed, 6 skipped; source/Wasm/XYFlow and WAX parity passed.
- Final affected model/reference tests: 51 passed.
- L-systems Notes suite: 14 browser checks passed, including emulated touch in both phone orientations.
- Existing standalone/shared canvas and bootstrap regressions: 14 browser checks passed.
- Production build: 209 pages; generated WAX parity passed.
- Phone-landscape screenshot inspected. No physical-phone or human-listening pass.

### Live-edit follow-up checks — 2026-09-24

- Held-mouse regression reproduced the silence before this fix, then passed
  with notes still arriving before pointer release.
- `npm run verify`: **4,239 passed, 6 skipped**, no failures; runtime/Wasm,
  XYFlow and clean generated WAX parity passed.
- `node --test tests/l-systems-suite.test.mjs tests/l-systems-notes.test.mjs tests/module-hierarchy.test.mjs`:
  **58 passed**, including 44 focused note/scheduler tests.
- Final Chromium matrix: **33 passed** (19 L-Systems Notes/live-edit tests and
  14 existing canvas/bootstrap regressions). The five new live-edit cases also
  passed independently: held mouse ranges/ADSR, held touch ADSR in both phone
  orientations including cancellation, and repeated geometry/timing edits in
  Notes and Triggers.
- The first broad browser run was **32 passed, 1 failed**: the landscape touch
  test measured the Audio button at 44px, not the required 48px. The same
  unchanged layout measured 48px in eight independent browser probes and the
  unchanged test passed eight repetitions. Added an explicit coarse-pointer
  assertion and selector-specific failure messages; the full final matrix
  passed without relaxing the 48px requirement. This isolated layout/emulation
  failure was not reproduced or attributed to a confirmed cause; no layout
  fix is claimed by this follow-up.
- `npm run build:site`: **209 WAX pages**; release and WAX runtime JS/CSS match
  the source. Release HTML differs only by the expected generated social tags.
- Preview HTML/controller/scheduler/styles match this worktree byte-for-byte;
  `git diff --check` passed. No human listening or physical-phone pass.

Logs: `/tmp/l-systems-live-edit-{before,after,models,verify,browser,full-browser,full-browser-final,touch-repeat,site}.log`.

Development preview used for the original checks:
`http://127.0.0.1:3449/l-systems.html`, from the
`/home/blechdom/creative/morphazoid-sound` worktree on
`codex/l-systems-notes-20260924`.

### Main integration checks — 2026-09-25

The source fix was preserved as commit `4fe2c18`, then integrated onto main
`251d27e` in an isolated publishing worktree. The L-Systems runtime had no
upstream overlap. Shared runtime-manifest and module-hierarchy registrations
retain all intervening Automatapoeia, Gesticules and Rubixoids additions as well
as this fix; frozen relocation hashes remain unchanged.

- `npm run verify`: **4,405 passed, 6 skipped**, no failures; runtime/Wasm,
  XYFlow and regenerated WAX parity passed.
- Focused Notes, suite and module-hierarchy tests: **59 passed**.
- The same **33 Chromium checks passed** against the main-based source on an
  isolated, identity-checked preview (`127.0.0.1:3491`), including held mouse and
  touch gestures. No touch-target failure occurred in this integration run.
- `npm run build:deploy` and `npm run check:storybook-dist` passed:
  **212 WAX pages**, **112 Storybook entries**. The build emitted a non-failing
  large-chunk warning for Storybook.
- Production runtime files match the tested source; eight expected public
  HTML/JS/CSS hashes were recorded for deployment verification.
- No physical-phone or human-listening pass. Other active worktrees were not
  changed, and the original tracked/untracked source was saved before integration.

Main advanced to `7393f87` during the first push attempt, which Git rejected
without changing the remote. The unpublished commit was rebased onto that main,
retaining its new Automatapoeia controls and click-only Settings behavior. The
only conflict was another additive module-hierarchy registration. Final checks
were rerun after the rebase:

- `npm run verify`: **4,411 passed, 6 skipped**, no failures; all source, Wasm,
  XYFlow and WAX parity checks passed.
- Focused model/reference tests: **60 passed**.
- L-Systems browser matrix: **33 passed**; incoming shared-header interaction
  suite: **6 passed**.
- Full deployment build and Storybook artifact verification passed again.

Publication is performed from `codex/l-systems-publish-20260925`. The deployment
run and public-byte result are reported separately after the push, not assumed
from local checks.
