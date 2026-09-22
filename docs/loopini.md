# Loopini

A kid-facing live looper built around six large recording circles, rather than
a DAW. It is a separate Works-in-progress instrument; Tape Worm and Loop Soup
are unchanged. There is no automatic song arrangement or save/download button.

## Just play

1. Turn on Audio using the shared speaker button.
2. Tap an empty circle, allow the microphone, and make a sound.
3. Tap that circle again to finish the first loop. Playback starts immediately.
4. Tap another empty circle. Wait for **Recording**, then perform for one turn.
   It finishes and joins the others automatically.
5. Tap recorded circles off/on to mix. Everything keeps looping until paused.
6. Inside a recorded circle, **●** (red record dot) replaces a bad take;
   **+** records an additional layer without replacing the old sound.
   **×** clears the circle. Undo restores the last completed recording,
   overdub, removal or reset.

The icons are real buttons inside the disc, separate from (not nested within)
the large on/off button. Hover titles and accessible names distinguish
replacement, addition and clearing. The active recording icon stays enabled:
it becomes × to cancel permission/preparation, then ■ to finish early.
The old labels “Again” (replace) and “Add sound” (overdub) are no longer shown.
The on-page info link/dialog, paused-state coaching, footer prose and
sound-count/seconds-per-turn readout are removed.
This document retains the detailed instructions; icon tooltips and accessible
names remain available on the playing surface.

No tempo, routing or mixer setup. Start over asks for confirmation, clears the
circles and returns Speed to 1×. Undo brings the sounds back but does not rewind
speed-knob edits. The microphone-free demo is available only while empty and
cannot replace recordings.

## Slow recording, fast playback

The **Speed** knob controls one shared tape clock, from **0.5× to 2×**, default
**1×**. Drag up/right for faster, down/left for slower; arrow keys work when the
knob is focused. Home/End select the limits; **Normal · 1×** returns to normal.
Speed changes never erase, retime independently or restart the recorded loops.

Playback and recording use the same tape coordinates. At ½× an existing
four-second loop takes eight seconds to play, and a new take lasts eight
seconds. Returning to 1× plays that new recording in four seconds: twice the
performed rate, one octave higher. The + layer button uses the same behavior, so a
slowed-down performance can be added to an existing recording. At 2× the
reverse applies: less time to perform, then slower/lower when returning to 1×.

Speed stays fixed during microphone permission, preparation and the take.
Once the take ends or is cancelled, the knob is available again. This avoids
moving the recording boundary while a child is performing. Speed affects pitch
like tape; it is not pitch-preserving time stretching or pitch correction.

## Contract and ownership

| Action/state | Sound and visible consequence |
| --- | --- |
| First record | Microphone captured without monitoring; elapsed time in its circle |
| Finish | Recorded sound repeats at the chosen speed; circles show shared phase |
| Later record | Next shared boundary starts a one-turn take, automatically ended |
| + Layer | Old loop remains audible; one new layer is merged only on successful finish |
| ● Record / replace | Old loop is quiet during capture; a successful take replaces it |
| Tap full circle | Smoothed off/on gain; samples and phase are unchanged |
| Speed | Shared tape read/write rate; lower/slower or higher/faster |
| Audio off | Mutes playback; cancels unfinished take and closes owned microphone tracks |
| Play/pause | Does not arm Audio; cancels an unfinished take, retains completed loops |
| Hide tab | Pauses, mutes, stops microphone; suspends context, retains samples |
| Leave/reload | Releases audio/media; page-local loops are lost |

Recording is an intentional local microphone operation, never triggered by MIDI
or QWERTY. The 1–6 keys toggle only recorded loops. MIDI note-on modulo six does
the same through the shared cancelable handoff. No MIDI output is generated.

New recording, + and ● acquire the microphone only after explicit
Audio arm. Pending permission requests can be cancelled; late-granted streams
are stopped. Denial, disconnection, pause and cancellation leave the old audio
and prior Undo state intact. The microphone closes after each take; the UI
always exposes its on/off state. Adding to an off circle temporarily lets you
hear that circle, then turns it on if the new take succeeds. Cancellation leaves
its prior on/off setting intact.

## Synchronization and audio bounds

- Six mono slots; normal-speed loop length ½–12 seconds. At ½×, a take can last
  up to 24 seconds; at 2×, up to 6 seconds. A first take's normal-speed length is
  the performed duration multiplied by the recording speed.
- First takes are free-duration, not beat-detected or silence-trimmed. Too-short
  or silent takes do not install or replace anything. A later complete fast
  take is accepted even when its performed duration is less than ½ second.
- Later takes wait for a shared sample-clock boundary, with at least 0.3 s
  preparation (another turn if too close), then cover one turn at the latched
  speed. Fractional wraps use the first available output sample; the gap is
  under two tape samples. Decimal-speed roundoff near a wrap is normalized.
- Microphone samples are linearly resampled into normal-speed tape coordinates
  incrementally on the audio thread, not in a long finish-time processing pass.
  Playback uses linear interpolation as well. This is a simple artistic tape
  model, not a high-fidelity band-limited resampler; high-frequency aliasing may
  be audible at extreme speed changes.
- New input has a DC blocker, bounded soft input and short edge fades. An
  overdub writes to a separate buffer; the old audio is never mutated in place.
  Headroom is linear below a soft knee at 0.85; louder sums are bounded below
  unity. Repeated additions can compress rather than grow without limit.
- Finishing early pads a replacement's remainder with silence. For + layers,
  that remainder is copied exactly from the old loop, and only the new
  contribution is faded at the end. Undo restores the previous buffer exactly.
- Removing the first loop does not change the remaining loops' lengths.
  Emptying every slot permits a new length. Undo restores that length too.
- Loop boundaries receive 6 ms nominal fades. Mute/transport gains smooth over
  9 ms; removal/reset retain a 10 ms old-sound tail. Speed approaches its new
  target over 15 ms during playback and latches exactly when a take is armed.
- AudioWorklet owns samples, phase, recording windows and gain/rate transitions;
  UI paint/messages are not the musical clock. State is published at roughly
  25 Hz. Waveform thumbnails use a fixed sampling budget.
- The mix is softly bounded before the shared master level. No live mic input
  is sent directly to speakers. Physical speaker pickup remains possible;
  headphones are advised for layering.
- All recordings are temporary memory. No WAV export, automatic arrangement,
  account, name entry, recording storage or cloud upload is provided.

## Integration and provenance

Original SVG/WebP artwork matches the six-circle interface. Demo audio is
synthesized locally from untuned decaying oscillators and deterministic noise.
No third-party recordings, external sound services or new runtime dependencies.
Shared Audio strip, output metering, navigation and capability registry are
reused. The source page has no WAX bootstrap; `build:wax` creates that artifact.
The public URL remains `loopini.html`. Controllers, styles, audio boundary,
model and worklet live in `src/instruments/loopini/`, following the current
main-branch source layout; the explicit release inputs are registered in
`scripts/site/runtime-files.tsv`.

## Acceptance

Tests cover exact sample lengths, auto-stop, early finish, silence rejection,
replacement versus addition, immutable originals and Undo, bounded repeated
layers, simultaneous clocks, rate clamping/smoothing, and first/new/added
recordings at half, normal, double and fractional speeds. Known-frequency
fixtures verify ½-speed recording plays at twice the performed frequency when
returned to 1×. The actual worklet is tested separately from UI callbacks.

Browser tests cover synthetic microphone capture, automatically timed layers,
mic release, denied and late permission, Audio/transport separation, retention
across hiding, keyboard/pointer/touch controls and phone layouts. They verify
the absence of automatic-song and save controls.

**No child usability session, human listening approval, physical-phone or
microphone performance pass, or real MIDI/DAW-host test has been performed.**
Synthetic capture does not establish a device's latency, gain control, echo
cancellation or feedback behavior, nor acoustic listening safety.
