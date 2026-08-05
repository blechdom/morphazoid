# Chaotic Synths browser MIDI contract v1

Recursive FM, Recursive PM, Chaotic FM, and Chaotic PM share one performance
vocabulary even though each remains a separate instrument and DSP engine.

## Browser adapter

- MIDI permission is requested only after an explicit **Enable MIDI** gesture
  and always with `{ sysex: false }`.
- Each page preserves its original continuously sounding Drone mode and adds a
  monophonic MIDI mode with last-note priority, velocity, pitch bend, ADSR,
  sustain, expression, and Off/Legato/Always portamento.
- MIDI input and page-audio handlers are detached on page exit.

## Pitch and articulation

- Root note 60 (C4) preserves the current preset at centered bend.
- Notes time-scale the complete oscillator system by
  `2 ^ ((note - root + bendSemitones) / 12)`. FM modulation amounts that act as
  frequency deviations and PM oscillator/phasor rates scale with that ratio;
  phase indices and other dimensionless nonlinear controls do not.
- A new detached note retriggers the ADSR. Overlapping notes and fallback to an
  older held key update pitch and velocity without retriggering the envelope.

## Factory controllers

The family-wide fixed performance map is CC5 glide time, CC11 expression,
CC64 sustain, CC65 portamento enable, CC72 release, CC73 attack, and CC75
decay. CC120 is All Sound Off, CC121 resets controllers, and CC123 is All
Notes Off. Algorithm controls receive no arbitrary factory CC assignment;
their stable parameter IDs are reserved for a later portable MIDI Learn layer.

The detailed controller curves, sustain/channel-mode behavior, and future
portable mapping schema follow `chaotic-fm-performance-v2.md`.
