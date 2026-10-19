# L-Systems readers, corners and branch articulation

L-Systems starts with **End to end · natural branches**: the final Pythagorean
tree begins at its root and divides into 1, 2, 4 and further readers only at real
forks. **Three regions** is an optional reader mode that scans three equal
distance regions. Each iteration, reader and real branch has an independent
voice identity. Cantor pen-up gaps remain rests.

Pitch follows normalized turn, height, depth/path distance or progress, with
spatial detail separating equal-depth siblings. Center frequency anchors the
octave span. There are no added chords, tuning quantization or fixed detuning.
Continuous repeats its amplitude envelope on each branch segment. Notes retains
its separately timed ADSR and overlapping tails. Continuous factory scenes use
branch decay 1; manual decay and short envelopes remain available.

The **Corners** panel provides:

- **Corner accent**: contrast between connected bends/forks and straight travel,
  lowering between-corner gain rather than boosting peaks.
- **Minimum turn**: the geometric angle qualifying a corner, including at forks.
- **Accent width**: the fraction of an edge occupied by the smooth accent.
- **Hit placement**: all subdivisions or corners/forks only in Notes and Triggers.

Diamonds mark qualifying corners, with at most 192 visible markers. This visual
limit does not remove audio events. Unconnected crossings and pen-up gaps do not
become corners. Corner-only hits preserve the first onset of each stroke in both
directions; irrelevant subdivision/accent controls are hidden until restored to
All subdivisions. Continuous hides Hit placement. Mic retains its separate
reader, controls, preset bank and input lifecycle.

Each main bank has nine medium, five fast and two slow scenes. Dice favors
medium/fast motion and natural final-tree traversal. Scene generation reduces
subdivisions and then iterations when necessary to retain its intended pacing;
manual speed and geometry changes are never silently constrained by that pass.

Main preset, Next and dice recall start at the direction-appropriate end while
preserving master volume, Audio and Play. Master volume, including zero, is
excluded from scene capture. Ordinary live sliders and Readers changes preserve
phase. A shape selection restores forward final-tree natural branching while
retaining synthesis and speed. Existing timed tails and the note event budget
survive same-mode scene restarts at the next unscheduled audio boundary.
Legacy scenes without Readers or Corners restore their defaults.

The existing bounded audio scheduler also drives Continuous independently of
canvas painting. Voice, event and geometry limits remain in force. Fresh main's
shared audio context, explicit microphone capture, recorded input and mobile
menubar behavior are retained.

Focused model and browser checks cover geometry, pitch diversity, corner-only
events, pacing, branch envelopes through terminal branches, live clock/tail
continuity, mute preservation, cleanup and three viewports. These checks do not
establish timbral quality or physical-phone performance; human listening and
physical-device acceptance remain unperformed.

Recovery verification on 2026-10-18: 130 focused Node/model/frozen-reference
checks and 60 Chromium checks passed. The browser preview used port 4392 from
the isolated recovery checkout, with source identity checked before execution.
The browser total includes explicit zero/nonzero master-volume preservation
through presets, Next and dice, both paused and running. Shared runtime manifest,
WAX and full repository verification belong to the final integration gate.
