# Automatapoeia: retire the previous preset's voices

September 23, 2026. Follow-up to the owner-reported hanging preset notes.
Catalogue ID `cellular-automata`; public route `automatapoeia.html`.

> Historical first fix. The September 24 owner request now preserves the current
> seed/history and applies changes at the next row boundary, with explicit
> Play/Pause. See [current transport/lifecycle](automatapoeia-live-transport.md).
> Source ownership/empty-row regressions below remain covered, with boundary
> retirement rather than immediate preset reseeding.

## Confirmed defect

1. Recall **Rule 110 · Singing columns** and explicitly enable Audio.
2. Recall **Rule 30 · Original cascade** (vertical-sine → row-events).
3. Set Rule to **0** and let the automaton become empty.

The preset adapter replaced the score/mode without retiring its audio sources.
The old column oscillators only received note-off transitions on subsequent
column-bank calls; row-event playback never made those calls. Old notes could
therefore persist indefinitely, unrelated to the visible cells. In the saved
reproduction, 14 old oscillators were still alive without any scheduled stop;
the empty automaton measured RMS 0.07369 / peak 0.21822.

## Bounded fix and preservation

- Validate the complete snapshot, then call the existing audio cleanup before
  replacing the score. Retire held columns, releasing tails and queued row
  buffers on every full preset/dice recall, including same-mode changes.
- Keep the existing AudioContext and Audio state; preserve the accumulator's
  existing tempo/swing retiming. No immediate extra seed audition is added.
- Reuse the native sonification selector's mode-dependent control presentation
  after recall. Row-only controls are disabled only in vertical-sine mode.
- Do not change synthesis, envelope values, the twelve factory scenes, random
  parameter ranges, routes, or the normal lifetime of a live column. A column
  that remains active may legitimately sustain until it becomes inactive.

`automatapoeia-preset-lifecycle-runtime-changes.json` records the exact changes
relative to fresh main `41c7239`. The historical module-hierarchy hashes remain
untouched; the preservation gate reverses only these explicit edits.

## Regression evidence

- `tests/automatapoeia-preset-lifecycle.test.mjs` executes the actual adapter and
  cleanup methods: all twelve scenes, dice, source ownership, clock/session
  continuity, UI mode state, Audio-off recall, and validation before mutation.
- `e2e/automatapoeia-preset-lifecycle.spec.mjs` observes real Web Audio stop/ended
  events on source and generated WAX pages, using native preset handlers. It
  checks column/row and same-mode transitions, dice, silence after finite tails,
  Audio off/on without resurrected notes, and no context allocation while off.
- Before the fix, 14 of the 16 unit cases and both live-browser transition
  cases failed. After the fix they pass. Repeating the original reproduction
  leaves **zero** old voices and measures **zero** RMS/peak with Audio still on.

On Node 22.23.2 / Chrome 152.0.7977.82 (48 kHz Web Audio): `npm run verify`
passes (4,193 passed, 6 skipped), including the untouched historical hash gate
and clean WAX regeneration. All 16 shared-controller routes pass browser smoke.
The focused preset/audio/responsive run passes 13/14 cases. The remaining case
is the existing phone-landscape expectation that `caVoice` fit without scrolling:
its bottom is 426.47 px in a 390 px viewport on both main `41c7239` and this fix.
It is not weakened or changed as part of the note-release repair.

This is automated lifecycle and coarse-output evidence, not human listening or
physical-device approval. WAX browser coverage checks the generated artifact;
it does not simulate a real DAW host. Existing instantaneous cleanup semantics
are reused, not redesigned or certified click-free by these measurements.
