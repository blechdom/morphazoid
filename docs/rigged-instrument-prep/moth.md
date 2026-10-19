# Moth — proposed brushable-wing instrument

**Status:** playable wing-fold/brush sketch on the shared
[Rig Lab](../../src/pages/rig-lab.html), not a complete independent route.
Suggested later ID/route: `moth` / `moth.html`. **Separate from Mosquito.**
Only the downloaded [Animated Peacock Moth](https://sketchfab.com/3d-models/animated-peacock-moth-1c3db0798f1c46be9764e99631cbb0a7)
is visible in the lab. Play uses its **original 279-track, one-second clip**
for the complete imported rig; the independently edited fore-/hindwing folds
are added afterward, without replacing the keyed wing-tip motion. The wing
textures are smaller than the original download, but its animation data is
unchanged. Its wings are broad playable
surfaces that fold, flex and collect brushed gestures; there is no borrowed
continuous mosquito carrier, Roach Synth wing buzz or jellyfish bell swell.

**One action:** pull a forewing edge into a fold, then brush across its ridges.
The folded surface shifts its resonant color, each crossed ridge produces a
quiet papery attack, and a wing can slowly replay the deformation as a phrase.

## Performer → model → sound

| Gesture / visible change | Model quantity | Audible consequence |
| --- | --- | --- |
| Fold a left/right wing | Hinge angle and exposed area | Narrows/darkens that wing's damped modal spectrum |
| Pull a wing tip | Effective span and ridge curvature | Smoothly shifts its inharmonic resonances; no note grid |
| Brush across visible ridges | Actual world-space crossings and stroke velocity | One bounded, softly noisy grain per crossed ridge; direction changes attack color |
| Flick wing up/down | Angular velocity/acceleration | Brief flutter exciter into that wing's modes, not a permanent drone |
| Offset left and right flaps | Two visible motion phases | Interleaved attacks and stereo conversation without a step sequencer |
| Record/replay a wing motion | Two joint curves over a loop | Repeats the same folds and excitations while hand offsets remain playable |

Use distinct damped, slightly inharmonic resonators for left and right wings,
excited by *actual* brush crossings and flap accelerations. A few pale
particles may show the path of a brush, but must not imply recorded "moth
dust" sounds or introduce an unrelated particle synthesizer. Long filtered
tails and sparse grains make a soft material instrument, not a high-speed
insect whine. Model the span/timbre relation as expressive invention, not
proven wing acoustics.

## Stage, rig and clock

- Rig Lab uses only the attributed Peacock Moth GLB, not the earlier original
  silhouette. The original clip drives the wings and torso on the shared
  transport; the paired fore-/hindwing bones then respond to independent
  fold/span/brush offsets. The brush counts musical ridge crossings across
  the imported wing surface and briefly bends the source wings; it does
  **not** add painted ridges or procedural moth geometry. Front/side views
  and labelled fold/span controls remain; camera orbit alone is silent.
  Texture and mobile performance still need human review.
- **Play source clip** runs the original rig animation under the same editable
  hinge values used by direct grabs. Audio starts off; the source clip may
  run silently. With playback paused, brushing or
  flicking sounds if Audio is armed; Audio arm alone does not trigger a wing.
  Editing one wing while looping preserves phase and the other wing's voice.
  A manual correction is layered over the authored loop (as in Gesticules),
  not a silent visual offset. Reset restores rig/curves/seed, not Audio/output.
- Smallest slice: two deformable forewings, one ridge field per wing, drag
  fold and one brushed crossing that visibly/audibly hits its own wing. Then
  add the hindwings, loop editor and independent left/right rhythm. Avoid
  making a large animation preset bank before these two gestures feel distinct.
- Later complete scenes: "Lantern velvet" (wide low folds, long tails),
  "Paper storm" (rapid alternating brushes, short grains), and "Two shadows"
  (left/right out-of-phase wing loops). Presets change geometry, texture and
  motion together while preserving Audio arm, output and Loop phase.

Initial ceilings to test: one moth, four wing surfaces, ≤4 bend handles each,
≤8 sounding modes/voices, ≤24 admitted brush grains/s and ≤16 visible brush
trail marks. Interpolate between pointer samples to count every traversed
ridge exactly once per stroke, even at low frame rates. Smooth fold/span
changes and bound gain when many ridges are crossed quickly. Keep wing
animation/audio on a shared clock; rendering can degrade before sound does.
Keyboard/native wing selection, fold/span, brush and Flap actions need visible
focus and the same DSP path as pointer gestures.

**Acceptance scenes:** folding only the left wing changes its measured
spectrum, not the right wing identity; one slow brush fires the crossed ridges
once, a fast stroke does not skip them, and holding still is silent; a wing
flick has onset and release rather than a perpetual buzz; Loop while Audio
off animates silently; manual edits during Loop remain audible and survive
pause; cancelling a fold restores its initial curve; preset changes retain
phase and avoid clicks; extreme bends, portrait/landscape touch and repeated
teardown stay finite. Listen to left/right isolated and the mixed scene;
contrast explicitly with Mosquito's continuous flying tone.

**Evidence boundary:** do not claim a typical moth emits these membrane or
brush sounds, that all moths follow lamps, or that drawn particles are actual
scales. Species, flight behavior, bioacoustics, materials and recordings
require primary evidence and provenance before any naturalistic copy or asset.
This first instrument is an artistic rig-and-gesture sonification.
