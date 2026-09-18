# Editable loop networks — QA, September 18, 2026

Worktree: `/home/blechdom/creative/morphazoid`, local `main` based on `59e4f4e`.
This report records the pre-publication checks for the editable loop-network
and compact-control update.

## Automated checks

- Full `npm run verify`: **3,634 passed**, 6 skipped, 0 failures.
  Runtime syntax, XYFlow determinism, and generated WAX parity passed.
- `npm run build:site`: passed; 182 WAX pages.
- Combined browser run: **45 passed**, comprising the new loop-network suite
  and regression coverage for Tempo Tantrum, Habit Habitat, and Hollowphonic.
- Focused pure network tests: **11 passed**, alongside the existing
  starting-engine and worklet tests.
- Generated public and WAX files match source. Both tape pages were opened from
  each artifact and exercised with actual AudioWorklet playback and live loop
  addition, without page errors.

## Relationships tested

- Eight-loop and 24-route limits; stable letter/ID allocation; self/duplicate
  route rejection; only incident routes disappear on loop removal.
- Layout changes retain source audio. Routing changes preserve buffers.
- Actual center-button drag, native keyboard position edits, letter-to-letter
  connection, and independently editable routes during playback.
- Native record/pause/mute/solo controls inside each loop.
- Microphone capture reaches the real worklet, pauses without advancing the
  recording count, and installs its take into the original target even after
  the user selects/adds another loop.
- Recording works when the microphone is already enabled without asking for it
  twice. Audio Off finalizes capture and stops owned tracks.
- Cancelling permission or removing its target stops a late-granted stream and
  cannot install audio in a different loop.
- Initial Audio handoff preserves loop topology, route settings, audio, and
  Hold/pause/solo/level/pan state, including between different sample rates.
- Tape Worm's per-route entry/exit/fade changes affect actual traversal;
  disabled routes and paused targets are bypassed; no zero-time transfer loop.
- Loop Soup's route gain/tone affect audio written to destinations; Hold blocks
  writes; Mute closes outgoing feed; Solo affects only monitoring.
- Dense maximum-feedback graphs stay finite and bounded. Active removal
  preserves unrelated running loops; normalization changes are smoothed.
- Desktop 1440×900, phone 390×844, landscape 844×390; no document horizontal
  overflow, all loop controls reachable by scrolling. Emulated coarse-pointer
  controls are at least 48px, and touch cancellation does not trap scrolling.
- The other three demo HTML pages remain byte-for-byte unchanged.

The initial focused test caught a floating-point exit-crossing issue in Tape
Worm; crossing comparisons now tolerate roundoff while exact arrival at a gate
waits a lap. Legacy fixed-loop tests were replaced with stronger dynamic-network
tests rather than retained with invalid fixed-position UI assumptions.

## Visual and signal checks

### Compact center-control follow-up

The circles now have solid opaque fills, including while muted, to hide the
workspace grid and routes behind each loop. The old large labelled center grid
is replaced by a compact horizontal row: shared-style play/pause glyph, red
record/stop glyph, **M**, and **S**. Route and reader/Hold actions use smaller
secondary icons. Every button has an accessible name and state-aware tooltip;
pending microphone permission uses a cancel glyph rather than claiming to record.

Desktop main icon faces are 28px and secondary faces are 24px. Coarse-pointer
hit targets are 48px without enlarging the artwork or overlapping adjacent
targets. Removed the inherited large `.loop-transport` border/padding so there
is no extra box around the small row. Stage/sidebar surfaces use the neutral
Morphazoid palette and the play/pause paths match Shapes, L-Systems and Graphs.

The center triangle actually starts/resumes playback while preserving the
explicit Audio boundary. While recording, it still pauses/resumes capture
locally rather than starting global playback. Added tests verify icon and
tooltip states, opaque fills after mute, exact desktop sizes, separate touch
target/face sizes, initial Play behavior, and recording stop/cancel transitions.
Desktop loop closeups and the portrait touch layout were visually inspected.

Inspected the desktop loop centers, route inspector, and portrait workspace.
Route labels are moved clear of center controls, and long routes arc around
intervening loops rather than placing buttons on top of Record/Pause.

Three-second model renders at 48 kHz with eight loops and 24 routes produced
finite output, with raw model peaks about 0.212 (Tape Worm) and 0.239 (Loop Soup).
These are boundedness observations, **not listening approval**. No human
listening, real microphone, hardware MIDI, physical phone, or real DAW/WAX-host
pass was performed.

All 390 pre-existing CSV/artwork files remain unchanged; the previously staged
CSV is still staged and was not included in any new commit.
