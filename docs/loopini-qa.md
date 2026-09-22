# Loopini acceptance — September 22, 2026

The initial prototype was tested on local `main` at `932080b` and is now
integrated on fresh `main` at `dc02fd0` for publication. The publication commit
and deployment status are reported in the handoff. Worktree:
`/home/blechdom/creative/morphazoid`.

## Fresh-main integration

- Preserved all tracked/untracked work in a recoverable snapshot before
  fast-forwarding the actual main checkout by eleven commits, then including
  the new audio/MIDI-settings commit that landed during verification.
- Reapplied only Loopini's catalogue, navigation, MIDI and README additions.
  Kept the new catalogue identities, Faves, preset system and sibling changes.
- Moved Loopini's five runtime files under `src/instruments/loopini/` and
  rewrote relative imports and page/test references. Model, worklet and CSS
  bodies are unchanged; the public URL remains `loopini.html`.
- Registered all eight required page/module/style/icon/doc inputs in the new
  `scripts/site/runtime-files.tsv`; did not revive the obsolete shell file list.
- Registered Loopini in the post-sheet catalogue test fixture without changing
  the earlier catalogue fixtures or approved Faves/renames.
- The first fresh-main revision contained a stale WAX/proof record for the
  73f13d2 speaker-icon correction. The later dc02fd0 commit supplied the same
  correction and its regression coverage; those upstream files are preserved
  without adding duplicate fixes in this publication.
- Regenerated WAX rather than retaining stale flat-path copies. The unrelated
  staged CSV and untracked catalogue/logo-suggestion files remain outside the
  publication.

## Current scope

Six recording circles, one-tap on/off mixing, in-loop ● replacement / + layer /
× clear icons, Undo and one shared speed knob. Automatic song arrangement,
Save song, WAV export and the export Worker have been removed.

## Publication gate on dc02fd0

- `npm run verify`: **4,065 passed**, 6 skipped, no failures or cancellations.
  Source syntax, XYFlow and regenerated WAX parity passed.
- Loopini Playwright suite: **16 passed** on the integrated worktree.
- Shared navigation/route smoke for Loopini, Tape Worm, Loop Soup and 3D Graph:
  **8 passed**.
- `npm run build:deploy` and `npm run check:storybook-dist`: passed; the
  Storybook artifact contains 109 entries.
- Generated public and WAX pages: runtime bytes match the build; six circles,
  actual synthetic-stream recording/replacement, half-speed capture, Normal,
  Undo, microphone release, non-silent finite audio and phone layout passed.
  Removed info/song/save/readout controls and paused messages remain absent.
- Runtime preservation comparison against the pre-pull snapshot confirms the
  controller/audio-boundary changes are import paths only, with model,
  processor and stylesheet bodies unchanged.

Final integration logs: `/tmp/loopini-final-main-verify.log`,
`/tmp/loopini-final-main-browser.log`, `/tmp/loopini-final-main-neighbors.log`,
`/tmp/loopini-final-main-build.log`, `/tmp/loopini-release-artifact.log` and
`/tmp/loopini-wax-release-artifact.log`. Build screenshots and detailed results:
`/tmp/loopini-release-review/` and `/tmp/loopini-wax-release-review/`.
Deployment and live-byte checks follow the push and are reported in the handoff.

## Mechanical evidence

- **17 model/worklet tests:** first/later sample lengths, auto-finish, early
  finish, rejection of tiny/silent takes, immutable original buffers, exact
  Undo, repeated loud overdub bounds and continued playback of the old layer.
- At ½ speed, a new recording takes two normal-length turns of wall time and
  fills one normal-length buffer. A known 197 Hz input is approximately 394 Hz
  in that buffer at 1×, and approximately 197 Hz read at ½×. First and later
  recordings also pass at 0.73×, 1.25× and 2×.
- Speed is clamped, smoothed during playback, frozen during a take, and returns
  to 1× without erasing samples or resetting phase. Decimal-speed wrap-roundoff
  and fast complete takes shorter than ½ second have explicit regression tests.
- Manual model checks at the maximum length: ½× captures 24 seconds for a
  12-second normal-speed loop; 2× captures 6 seconds. Fractional-speed maximum
  first/later takes retain the same normal-speed length as well.
- The pre-integration prototype passed **3,666 tests**, 6 skipped. Fresh-main
  verification and publication evidence are recorded below; the broader main
  branch contains additional instruments and tests.
- **16 browser tests:** synthetic microphone capture at half speed, subsequent
  normal playback, + layering into the same slot, old sound audible during the
  take, Undo, track closing, permission denial, late-grant cancellation,
  first-take cancellation via Play, reset/Escape, hidden-page retention and
  independent Audio/transport state. The removed song/save controls are absent.
- Pointer and keyboard speed changes, exact Normal return, touch cancellation,
  pending/active-take knob locking and no implicit Audio/mic arm passed.
- **8 neighboring route/shared-contract checks** for Loopini, Tape Worm, Loop
  Soup and 3D Graph passed. Other instrument engines and interfaces remain unchanged.
- Desktop 1440×900, portrait 390×844 and landscape 844×390: no horizontal
  overflow, reachable controls, keyboard operation, no serious/critical
  axe violations. The knob is 62×62 px; the three in-loop controls each have
  40×40 px outer targets (36 px on extra-narrow screens). They are sibling
  buttons over the disc, never invalid nested buttons. Coarse Audio/Play
  targets remain ≥48 px.
- Source/public/WAX byte parity and generated-page playback are checked
  separately; the obsolete export Worker is absent from all artifacts.

Logs: `/tmp/loopini-icons-model.log`, `/tmp/loopini-icons-verify.log`,
`/tmp/loopini-icons-browser.log`, `/tmp/loopini-icons-neighbors.log`,
`/tmp/loopini-icons-build.log`, `/tmp/loopini-icons-artifacts.log`.
Reviewed screenshots and layout measurements: `/tmp/loopini-icons-review/`.

## Re-recording control clarification

A synthetic-microphone reproduction confirmed the old Again action replaced
recordings from playing, paused and muted states, but it disabled itself during
the take and its label was unclear. No replacement-DSP rewrite was needed.

The red ● now explicitly means replacement. It stays enabled as × to cancel
permission/preparation and ■ to finish capture early. + keeps the existing
sound and adds a layer. × clears the loop. These three SVG buttons sit inside
each recorded circle; outside text buttons have been removed. Hover titles and
screen-reader labels name the actions; the detailed symbol guide remains in
`docs/loopini.md`.

New tests finish an actual replacement from the red icon, verify it is not a
mix of old/new, exercise keyboard cancellation and early finish on that same
icon, and replace a muted take by touch. Different old-tone fixtures replaced
with identical input produce identical recorded buffers at normal and half
speed, proving old samples do not leak into the replacement. Undo restores the
original, and other loops are retained.

## Removed on-page prose

The info button/dialog and “Just play…” footer have been removed. Pausing clears
the two coaching messages and hides the empty heading; the microphone indicator,
recording/error guidance, icon tooltips and reset confirmation remain unchanged.
The redundant sound-count and seconds-per-turn readout is also removed,
including its empty-state slogan. Demo/Undo/Start over remain in place.
Browser checks cover absence of the removed elements and text at all three
viewports, plus normal resume behavior and the full recording/control suite.

Cleanup evidence: `/tmp/loopini-cleanup-model.log`,
`/tmp/loopini-cleanup-browser-final.log`, `/tmp/loopini-cleanup-verify.log`,
`/tmp/loopini-cleanup-build.log` and `/tmp/loopini-cleanup-review/`.
An initial browser run missed a temporary recording state in a sub-second test
fixture; that test now uses a longer take and tighter observation polling.
No recording behavior was changed to accommodate the test.

## Unperformed acceptance

No child usability session, human listening approval, physical microphone or
phone performance check, real MIDI controller or DAW/WAX-host test. Synthetic
capture is not evidence about a device's latency, gain control, noise reduction,
echo cancellation or speaker feedback. Linear varispeed resampling is not a
claim of band-limited high-fidelity conversion.

Recordings remain page-local and reload/navigation discards them. There is no
recording save/download facility. Headphones are advised for microphone layers.
Unrelated staged CSV and untracked catalogue/logo-suggestion work are untouched.
