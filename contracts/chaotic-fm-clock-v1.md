# Chaotic FM host-clock contract v1

This contract defines the first DAW-transport adapter for Chaotic FM. It is
additive to the frozen nineteen-parameter performance contract: parameter IDs
20 through 27 are timing controls, while IDs 1 through 19 never move.

## Clocked destination

- Version 1 synchronizes only the independent Carrier oscillator. In Free
  mode it retains its original Hz value and follows MIDI time scaling exactly
  as before.
- In Sync mode the Carrier control is replaced by a musical division from
  eight bars through 1/64 note. Straight, dotted, and triplet feel multiply
  that division by 1, 3/2, and 2/3.
- Entry offset, modulation amount, amount divisor, nonlinear rate, ADSR, and
  glide stay unsynchronized. This keeps clocking predictable and avoids
  repitching the core timbre without an explicit future destination control.

## Phase sources

- Free advances at the host tempo whether transport is running or stopped.
- Song derives phase from the host's absolute quarter-note beat position.
  Seeking, looping, and offline rendering therefore reach the same phase at
  the same project position.
- Transport resets the Carrier beat accumulator on each playback start and
  holds it while stopped.
- Note resets only the Carrier beat accumulator when the selected monophonic
  note changes. It never resets the entry or recursive oscillator phases.
- Phase offset adds 0 through 1 cycle after the source is selected.

## Rhythmic latch

- Off uses the continuously synchronized Carrier waveform.
- Hold samples it at exact boundaries of an independent latch division.
- Slew targets the same boundary values and applies the configured 0-50 ms
  smoothing time between them.
- The latch inherits the Carrier's straight/dotted/triplet feel but has its
  own division. Keeping those divisions independent avoids sampling the same
  point of every complete Carrier cycle, which would otherwise produce a
  constant value.

## REAPER adapter

The JSFX snapshots `tempo`, `beat_position`, `play_state`, `ts_num`, and
`ts_denom` at block boundaries and interpolates project beats per sample.
Bar divisions respect the current time signature; note divisions use REAPER's
quarter-note beat unit. Sync mode does not multiply the Carrier by MIDI pitch,
but MIDI continues to time-scale the entry oscillator and every recursive
turn. Free/Free/Off defaults preserve all v0.2.x projects and presets.
