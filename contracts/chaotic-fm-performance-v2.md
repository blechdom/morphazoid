# Chaotic FM performance contract v2

This contract extends `chaotic-fm-midi-v1.md` with expressive monophonic note
behavior. It is the common target for the browser AudioWorklet, REAPER JSFX,
and native C++ implementations. Platform APIs are adapters; none of them owns
the instrument's musical behavior.

## Scope and conformance

- Version 2 remains monophonic with last-note priority. Polyphony is a later
  contract revision so that voice allocation cannot silently change mono
  presets.
- Implementations share stable parameter IDs from
  `chaotic-fm-parameters-v2.json` and the same five synthesis presets.
- Event timing should be sample-offset accurate where the host supplies sample
  offsets. Browser adapters should preserve Web MIDI timestamps as closely as
  the AudioWorklet message boundary permits.
- Short deterministic renders, envelope timing, pitch trajectories, safety
  bounds, and spectral statistics are conformance targets. Indefinite
  sample-for-sample identity is not: tiny floating-point differences can make
  a chaotic trajectory diverge while preserving the intended sound.

## Note priority and phases

- Note-on selects the newest held note. Note-off of the current note falls back
  to the most recently pressed note that is still physically held.
- Oscillator phases are free-running across note changes and envelope
  retriggers. Starting a note does not reset the recursive oscillator stack.
- A fresh note from silence starts an attack. An overlapping note, or fallback
  to an older held note, changes pitch and velocity without retriggering the
  envelope.
- A note-on received during release starts a new attack from the current
  envelope level, avoiding a discontinuity.
- MIDI channels are omni in version 2. Note ownership still records the source
  channel so a later multichannel/MPE contract can be added without changing
  action names.

## Pitch and glide

- MIDI note 60 is the default root. At the root with centered pitch bend, the
  complete oscillator system preserves the browser preset rates exactly.
- Pitch is represented in semitones:
  `note - rootMidiNote + pitchBendSemitones`.
- Its ratio, `2 ^ (semitones / 12)`, multiplies the final phase rate of the
  carrier, entry oscillator, and every recursive turn. It does not multiply
  modulation amount or the nonlinear drive.
- Pitch bend is centered at 8192 and defaults to +/-2 semitones. Bend changes
  use a separate 5-8 ms de-zipper and do not restart note glide.
- Glide modes are `off`, `legato`, and `always`:
  - `off`: a note target changes immediately; only bend de-zippering remains.
  - `legato`: glide when a note was already physically held before note-on and
    when falling back to another held note.
  - `always`: also glide from the last known pitch for a detached note. The
    first note after initialization always starts at its own pitch.
- Glide is an exact-duration linear interpolation in semitone space. A target
  received during a glide begins a new segment at the current interpolated
  pitch. `glideTimeMs = 0` is immediate in every mode.
- Final oscillator rates are clamped to the smaller of 20 kHz and 45% of the
  current sample rate. High notes can therefore cease to be exact
  transpositions once a rate reaches the safety ceiling.

## Amplitude envelope

The amplitude envelope is evaluated per sample and multiplies the selected
voice signal before the common high-pass/protection/output path.

- Defaults: attack 8 ms, decay 120 ms, sustain 0.72, release 180 ms.
- Attack runs from the segment's starting level to 1 over its exact duration:
  `start + (1 - start) * (1 - (1 - p)^2)`.
- Decay runs from 1 to sustain over its exact duration:
  `sustain + (1 - sustain) * (1 - p)^2`.
- Release runs from the segment's starting level to 0 over its exact duration:
  `start * (1 - p)^2`.
- Here `p` advances from 0 through 1 across the segment. Zero-duration attack
  or decay transitions immediately; release has a 2 ms minimum parameter
  value, apart from the dedicated All Sound Off safety fade.
- Note velocity and CC11 expression multiply the envelope. Changes caused by
  legato velocity or expression use a short 5-8 ms gain de-zipper.
- Drone mode bypasses note priority and ADSR, preserves a pitch ratio of 1,
  and uses the output parameter as its continuous gain.
- The portable parameter default is MIDI mode. The standalone browser page may
  deliberately start in Drone mode so its existing Audio button still produces
  an immediate demonstration before MIDI permission is granted.

## Sustain and channel-mode actions

- CC64 values 64-127 engage sustain; 0-63 disengage it.
- Key release always removes a note from the physically-held stack. When no
  physical notes remain and sustain is engaged, the current note and envelope
  continue. Releasing sustain then begins release.
- CC120 All Sound Off performs a dedicated 2 ms safety fade, clears held and
  sustained state, then forces the envelope idle.
- CC121 Reset All Controllers restores expression to 1, centers pitch bend,
  clears sustain, and restores the configured glide-enable state. It does not
  reset synthesis parameters, mappings, presets, or physically held notes.
- CC123 All Notes Off clears held and sustained state and begins the normal
  release segment regardless of the sustain-pedal state.

## Standard controls and MIDI Learn

- Factory performance meanings are CC5 glide time, CC11 expression, CC64
  sustain, CC65 portamento enable, CC72 release time, CC73 attack time, and
  CC75 decay time.
- CC120-127 are channel-mode messages and are never learnable parameter slots.
- CC5 maps 0 to 0 ms. Values 1-127 map logarithmically from 10 to 2000 ms.
  This curve is Morphazoid behavior because MIDI standardizes the controller's
  meaning, not a universal millisecond curve.
- A `linear` CC curve maps `value / 127` across the parameter range. A `log`
  curve maps that normalized value geometrically between positive minimum and
  maximum. A `log-zero` curve maps value 0 to zero, then values 1-127
  geometrically from the parameter's declared `minimumNonzero` to maximum.
- Factory envelope mappings therefore use 0.5-5000 ms for CC73 attack,
  1-5000 ms for CC75 decay, and 2-10000 ms for CC72 release.
- Raw algorithm controls remain host-automatable and learnable rather than
  receiving fixed factory CCs.
- A portable Morphazoid mapping stores source type, optional channel, CC,
  stable target parameter ID, normalized minimum/maximum, curve, inversion,
  and relative mode. Browser settings and plugin state may serialize the same
  mapping and exchange it as JSON.
- DAW-owned MIDI Learn remains host/project state and is not expected to appear
  automatically in the browser.

## Adapter boundaries

- Browser: Web MIDI messages become timestamped `noteOn`, `noteOff`,
  `pitchBend`, `controlChange`, and `allSoundOff` actions. Audio still requires
  an explicit user gesture before the browser may run it.
- REAPER JSFX: `midirecv()` events become the same actions at `midi_offset` and
  remain available to downstream effects through MIDI thru.
- Native plugin: host events become the same actions at their process-block
  sample offsets. The audio thread never calls the WebView.
- UI adapters may display MIDI and analysis state but never own envelope,
  glide, note-priority, or voice-allocation state.

## Live analysis view

- The primary analysis view is a non-scrolling live spectrum, not a history
  spectrogram. It is drawn as discrete vertical frequency bars rather than a
  connected or filled terrain silhouette.
- It represents the final audible stereo mix after protection/output, using a
  2048-point FFT by default and updating near 30 frames per second.
- Horizontal position is logarithmic from 20 Hz to the smaller of 20 kHz and
  Nyquist. Vertical position is current magnitude from -90 to 0 dB.
- A short display release and optional 500 ms peak hold are permitted. History
  accumulation is not part of the primary view.
- The oscilloscope is simultaneous with the spectrum in the same plot. Bars
  are painted first at lower visual emphasis; the brighter waveform is painted
  afterward so it is unambiguously in the foreground.
- A rolling spectrogram may remain behind an explicitly optional History view.
