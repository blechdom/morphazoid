# Recurring failure signatures

Use these as investigation routes, not predetermined diagnoses.

## Silent or barely audible

- Trace explicit Audio arm -> context resume -> voice start -> final gain ->
  `connectAudioOutput`.
- Check preset/default gain staging, source amplitude, voice normalization,
  muted/solo state, start timing, and early teardown.
- Measure before raising gain; a missing source should not be hidden by a louder
  master.

## Harsh, piercing, metallic, or fatiguing

- Inspect starting pitch/formant ranges, resonator Q, stacked partial gain,
  nonlinear stages, aliasing, feedback, and simultaneous-voice normalization.
- Compare default and extremes separately. Preserve expressive high ranges while
  moving the default to a safer sweet spot when appropriate.

## Clicks, zipper noise, or dropouts

- Look for instantaneous AudioParam changes, node replacement, oscillator
  stop/start, graph topology swaps, truncated tails, unsmoothed preset changes,
  and duplicate events.
- Ramp or crossfade at the actual discontinuity. Do not mask structural clicks
  with a global low-pass filter unless that is the intended sound.

## Generic drone, white noise, or weak identity

- Verify that the researched or geometric mechanism actually controls the
  source and resonator rather than decorating a generic oscillator/noise bed.
- Isolate voices and compare onset, duration, spectrum, modulation, and rhythm
  with the declared target. Add mechanism-level leverage before adding effects.

## Controls have little or misleading effect

- Trace DOM event -> parsed/scaled state -> model -> DSP parameter -> output and
  visual readout.
- Check units, scaling curve, smoothing time, preset overwrite, stale closures,
  clamping, and whether another stronger layer masks the change.
- Compare deterministic min/default/max renders. A changing number or node value
  is not proof of a meaningful audible relationship.

## Presets sound alike

- Compare source topology, articulation, duration, spectrum, register, rhythm,
  space, and effects after loudness normalization.
- Increase separation in identity-defining parameters rather than adding more
  presets or relying on level differences.

## Late, missing, doubled, or drifting events

- Verify that audio uses `AudioContext.currentTime` and a lookahead wider than
  the wake interval; RAF should only display scheduled state.
- On wake-up, skip stale attacks instead of replaying a burst. Check phase
  preservation after tempo, sequence, preset, and visibility changes.
- Compare scheduled event timestamps with the visible playhead's source of truth.

## Visual and audio disagree

- Derive both from the same model state and audio timeline when possible.
- Check independently advanced clocks, stale cached geometry, parameter
  smoothing shown as an instantaneous visual jump, and voices without a visible
  source.

## Mobile-only failure

- Check transient user activation, AudioContext creation timing, global scroll
  locks, `touch-action`, overlapping hit targets, pointer capture cancellation,
  viewport-height assumptions, and main-thread work that starves scheduling.
