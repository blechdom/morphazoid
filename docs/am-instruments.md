# Cascading, Recursive and Chaotic AM

These three instruments are amplitude-modulation counterparts to the existing
Cascading, Recursive and Chaotic FM/PM instruments. They keep their PM siblings’
layouts, operator controls, live analysis, output controls and Audio/MIDI lifecycle.
Chaotic AM adapts the routing and parameter ranges to keep its carrier audible. Each has its own route,
preset identity and sound engine.

## Synthesis

The starting point is Synthesaurus’s AM method, implemented in
`src/instruments/synthesis/rust/core/src/conventional.rs`. With its Bias set to
one, the method reduces to:

```text
output = carrier × (1 + depth × modulator) / (1 + depth)
```

The new instruments use that carrier-preserving form at every connection.
Carrier and modulator are bounded to ±1 and depth to 0–1. The gain is nonnegative
and at most one, so a deep chain cannot amplify itself without bound. Zero depth
leaves the stage’s sine unchanged. Unlike zero-bias ring modulation, the DC bias
retains a carrier component. The oscillators advance at their own frequencies;
the incoming signal never changes an oscillator’s phase increment or phase.

| Instrument | Preserved structure | AM interpretation |
| --- | --- | --- |
| Cascading AM | 2–12 stages, root frequency, rising/equal/falling cascade ratio, taper, twelve rhythm presets | Each stage’s output modulates the next sine’s amplitude. Modulation depth sets the first connection; depth taper changes subsequent connections. |
| Recursive AM | Recursion depth, carrier, starting modulation frequency, frequency divisor, index divisor, twelve presets | Each recursive turn uses the preceding output as its biased amplitude modulator. AM index maps to depth as `index / (1 + index)`. |
| Chaotic AM | Recursive frequency/index ladders, nonlinear amount, transfer choice, twelve presets, MIDI performance controls | A fixed audible carrier receives a nested chain of nonlinear amplitude modulators. Starting index controls the carrier link; divided indices shape deeper links. |

Cascading’s depth taper scales modulation strength in index space, then converts
back to bounded depth. This keeps a taper above one useful without clipping every
later stage to the same depth. Its twelve AM-specific presets demonstrate sound
immediately: deep chops, flutter, harmonic buzzes and inharmonic metallic tones.
Carriers span 288–1234 Hz and every root is at least 2 Hz. The original 48–89 Hz
carriers were too bass-heavy, and each extra biased-AM link dilutes the slow
root's influence. The new bank keeps stable preset IDs/order while changing
labels and voicings to describe the AM sounds. The full two-to-twelve-stage
control remains available. Raising Root raises every oscillator, so it speeds
tremolo into a steady timbre as well as raising pitch. Random scenes also produce
immediate rhythmic or audio-rate AM sounds.

Recursive keeps its five original preset identities and recursion depths, with translated
frequency and modulation settings for AM. Several original PM presets relied
on broad phase-modulation sidebands while their final oscillators were below
20 Hz. Copying those frequencies into bounded AM made them nearly inaudible.
The AM bank keeps the recursive movement but gives each scene an audible final
carrier. The controls retain their original ranges, including sub-audio settings
for deliberate experimentation.

Chaotic AM now builds modulation from the innermost sine outward into a fixed
40–2000 Hz carrier. The previous serial routing replaced that carrier at every
turn; the default 40 Hz output became 4, 0.4 and 0.04 Hz as depth increased.
The revised routing keeps slow frequencies in the modulation path instead.
Modulator rate spans 0.5–2400 Hz. Frequency divisor (0.5–4) and depth divisor
(0.5–2) use logarithmic sliders; AM depth has evenly distributed gain-depth
travel while its stored index remains `depth / (1 - depth)`. Depth changes fade
nested gain links without resetting phases. Expanding modulator frequencies
fade before the render ceiling, while the carrier remains connected.

Its twelve revoiced presets retain the first eight IDs/order and cover pulses,
flutter, bass and metallic tones with short attacks. The shared pulldown, Next
and dice recall complete synthesis and articulation settings while preserving
Audio, master output, MIDI mode/devices, held notes and live controllers.
The new bank deliberately changes the earlier AM sounds. Tests sweep every
preset's synthesis controls and check immediate carrier energy, bounds,
parameter influence, zero-amount bypass and live MIDI continuity.

Chaotic AM is an artistic nonlinear AM network. Its name does not imply a proof
of dynamical chaos in every setting. Smooth and saturated transfers produce
different modulator shapes, with the same bounded AM multiplication afterward.
The original PM transfer is not mixed into the new audio path.

## Playing

Enable **Audio**, choose a preset, then adjust the same operator and performance
controls as the sibling instrument. Low modulation frequencies produce level
movement; faster modulation creates sum/difference sidebands. Use zero AM amount
to compare with the final carrier alone. The spectrum and oscilloscope show the
actual resulting signal, and the flow diagram describes amplitude multiplication.

Recursive AM and Chaotic AM preserve native MIDI notes, expression, sustain,
pitch bend, glide and amplitude envelopes. Cascading AM retains its sibling’s
shared MIDI control mapping. MIDI and computer keys are enabled in Settings.
Preset recall preserves Audio and master output; preset changes do not add a
second audio owner. Cascading AM corrects its sibling’s preset-level reset so a
manually adjusted master output stays put. Audio begins off, and page departure
releases the audio graph.

Recursive AM, FM and PM now each have twelve complete presets in the shared
pulldown, with Next and dice controls. Existing preset IDs, order and synthesis
settings are retained. New scenes cover pulsed, harmonic and metallic sounds
with immediate onset. Dice varies every synthesis and envelope/glide parameter
within bounded, audible-oriented ranges. Manual edits and MIDI CC changes mark
the sound Custom. Recall includes ADSR, glide, root note and bend range; Audio,
master level, drone/MIDI mode, devices, held notes, pedal and live bend/expression
remain under the performer's control.

## Scope and evidence

These are browser instruments with generated WAX counterparts. They do not add
native JUCE/CLAP/REAPER binaries. Existing FM/PM sound engines and preset banks
remain intact. Catalogue artwork is reused from the corresponding PM instrument.

Focused model tests check the carrier/sideband relationship, fixed oscillator
phase, bounds, control sensitivity and lifecycle behavior. Browser checks cover
live output, preset recall, MIDI, cleanup and responsive layouts. Automated
measurements do not establish timbral quality or physical-controller feel;
human listening and hardware-controller acceptance remain separate.
