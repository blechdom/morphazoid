# Chaotic FM MIDI contract v1

This contract defines the musical behavior shared by the browser instrument,
the REAPER JSFX spike, and a later native VST3/AU/CLAP implementation. Platform
APIs are adapters; none of them owns the musical behavior.

## Voice model

- Version 1 is monophonic with last-note priority.
- Note-on selects the newest held note and opens an 8 ms smoothed gate.
- Note-off returns to the most recently held note. Releasing the last held note
  closes the gate over 8 ms.
- Note-on velocity scales amplitude linearly from 1/127 through 127/127.
- MIDI channels are treated as omni in version 1.
- CC 120 (All Sound Off) and CC 123 (All Notes Off) clear held notes.

## Pitch model

- MIDI note 60 (C4) is the default root and preserves the preset exactly.
- A note time-scales the complete oscillator system by
  `2 ^ ((note - root + bendSemitones) / 12)`.
- The ratio multiplies the final phase rate of the carrier, entry oscillator,
  and every recursive turn. Patch parameters remain untouched; in particular,
  modulation amount keeps its original second role as the nonlinear drive.
  This produces an exact time scaling until a rate reaches the safety ceiling.
- Pitch bend is bipolar, centered at 8192, with a configurable default range
  of +/-2 semitones.
- Native implementations clamp final oscillator frequencies to the smaller of
  20 kHz and 45% of the current sample rate.

## Adapter boundaries

- Browser: translate Web MIDI messages into `noteOn(note, velocity)`,
  `noteOff(note)`, `pitchBend(normalized)`, and `allNotesOff()` actions.
- REAPER JSFX: translate `midirecv()` messages into the same actions.
- Native plugin: translate the host MIDI buffer into the same actions at the
  event's sample offset.
- DAW automation remains a parameter concern. MIDI CC-to-parameter mapping is
  deliberately not fixed here; hosts already provide learn/mapping facilities.

The browser implementation is therefore not a code generator for the plugin.
It is one adapter and one conformance target for this shared behavior.
