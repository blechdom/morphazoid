# Time Loom — weave the recent past

Time Loom is a three-cord recording instrument. A single playback bead reads a
passage between two knots. At the last knot it either loops that cord or follows
a tie to the entry knot of another. Each cord can hold a different phrase; by
default all three hold the same original eight-second study.

Turn **Audio** on, then **Play**. Slide knots to isolate a fragment, pull the
tassel to lengthen it, and choose **Tie to another cord** followed by a destination.
**Read upward** reverses the passage. **Untie** restores the cord's own loop.
Double-click a cord to knot a short fragment; double-click its tassel to reverse.
The selected cord's labelled controls provide every operation without dragging.

Enable the shared microphone control, then **Record phrase**. Press again to
finish; capture ends at 30 seconds. **Load audio** imports the first 30 seconds of
a local file (maximum duration 3 minutes, maximum encoded file size 40 MB). File
metadata is checked before decoding to bound the working audio allocation.
Capture and upload target all
three cords or just the selected one. **Copy to all cords** reuses the selected
recording without changing knots. The input gain affects captured audio. Input
is never monitored directly. No recordings are uploaded or stored persistently;
they disappear when this page is closed or reloaded.

**Undo** restores up to eight edits/takes. **Reset weave** restores the initial
knots, stretches, directions and routes while keeping recordings. The twelve
presets and dice own only those musical settings; they preserve recordings,
output volume, Audio arming and Play. Original demo is an explicit source action.

With the canvas focused, 1–3 select cords; Up/Down move the upper knot;
Shift+Up/Down move the lower knot; Left/Right stretch; R reverses; T begins a tie
(then 1–3 chooses its destination); Enter moves the bead; Escape cancels a tie.
Space controls the primary transport outside native form fields. MIDI uses the
site's shared control/transport mapping, without pitched notes or MIDI output.

## Instrument contract

| Gesture | Meaning | Visible and audible result |
| --- | --- | --- |
| Move two knots | Source interval, normalized 0–1; minimum span .02 | Knots enclose a repeating recorded passage |
| Pull tassel | Duration multiplier .5–4, default 1 | Cord length and passage duration grow together |
| Reverse | Reverse source trajectory and grain reading | Bead climbs the cord; sound reads backward |
| Tie cords | One directed successor per cord | On exit the bead and reader enter the next passage |
| Untie | Remove outgoing successor | Reader loops that passage again |
| Click a cord | Seek within its selected passage | The same source position moves visibly and audibly |

Pitch-preserving stretching is an engineering approximation using overlapping,
waveform-aligned grains, not a transparent studio timestretcher. Transients can
smear and very short passages can sound granular. There is one reader, not three
simultaneous tracks. Knots and routes remain independent of stored recordings.
This first prototype does not save projects or export an editable weave; the
site's main output recorder can capture the performed sound.

Audio starts off, separately from Play. Before audio initialization, silent
preview advances a bounded pure timeline. After initialization the AudioWorklet
owns transport and sound; the canvas follows its snapshots. DSP never depends on
animation frames. Turning Audio off mutes output while preserving transport.
Hiding the page mutes output, cancels capture and releases microphone tracks;
returning requires an explicit Audio action. Navigation cancels pending work and
releases nodes, streams, listeners and frames. Rendering uses at most 2× DPR and
30 frames per second. File decoding and microphone permission have cancellation
generations so late results cannot replace newer takes or reacquire input.

## Inspiration and provenance

The user's reference is the quipu in *The Rise and Fall of D.O.D.O.* by Neal
Stephenson and Nicole Galland, with the supplied secondary reference
[Wikipedia: Quipu, Literature](https://en.wikipedia.org/wiki/Quipu#Literature).
We use that fictional association as inspiration, not as an independently
verified reading of the book. The musical meanings of knots, stretch, reversal
and routes are invented here. This is not a reconstruction of historical Andean
quipu practice or a claim about how real quipus encoded information.

The demo is procedurally authored for Morphazoid: continuous-frequency plucks,
chirps and textural taps, without automatic scale quantization. The graphic and
catalogue icon are rendered from the instrument's own drawing code. No external
recording, book artwork, cultural artifact image or new dependency is bundled.

## Verification

Focused Node tests cover sample-clock routes, stretch/reverse relationships,
finite bounded output, silence, recovery, presets and source integration.
Browser checks cover explicit Audio, live gesture/preset edits, undo/reset,
microphone capture and file import, and desktop/phone layout. Automated audio
measurements cannot establish musical quality. Human listening and physical
touch-device acceptance remain separate checks.
