# Morphazoid REAPER spike

`Morphazoid_Chaotic_FM.jsfx` is a REAPER-native, zero-build port of the
Chaotic FM AudioWorklet. It preserves the five browser presets and implements
the expressive monophonic behavior in
`../../contracts/chaotic-fm-performance-v2.md`.

[WAX](https://audiofusion.com/wax/) currently distributes macOS and Windows
plug-ins, not a native Linux build, so this spike deliberately uses REAPER's
native JSFX format for the Linux proof.

## Install on Linux

1. In REAPER, choose **Options > Show REAPER resource path**.
2. Open its `Effects` directory and create a `Morphazoid` subdirectory.
3. Copy `Morphazoid_Chaotic_FM.jsfx` into that subdirectory.
4. Restart REAPER, or refresh the FX browser.
5. Add **JS: Morphazoid: Chaotic FM** to a track.

A typical non-portable Linux resource directory is
`~/.config/REAPER/Effects`, but the directory revealed by REAPER is
authoritative.

## End-to-end MIDI check

1. Keep **Play mode** set to **MIDI** and **Root MIDI note** at 60.
2. Turn the track output down before the first note.
3. Record-arm the track and enable monitoring, or add a MIDI item.
4. Play C4 (MIDI 60). It uses the browser preset without transposition.
5. Play C3 and C5. The complete chaotic system should transpose down/up one
   octave while retaining its overall spectral relationship.
6. Check low and high velocities, overlapping notes, note release, pitch bend,
   and two or more presets.
7. Save, close, and reopen the REAPER project; control values should restore.
8. Render a short selection and confirm the rendered file matches playback.

Set **Play mode** to **Drone** to test the original continuously sounding
browser behavior without MIDI.

## Expressive controls

The v2 instrument is monophonic with last-note priority. A fresh note starts
the amplitude envelope; overlapping notes and fallback to an older held note
change pitch and velocity without retriggering it.

- **Attack / Decay / Sustain / Release** default to 8 ms, 120 ms, 0.72, and
  180 ms.
- **Glide mode** is Off, Legato, or Always. **Glide time** is 0-2000 ms and
  defaults to 0, so the original immediate note changes are preserved.
- **Legato** glides only when another key is already physically held.
  **Always** also glides from the last pitch across detached notes; the very
  first note still starts at its own pitch.
- **Expression** is both a host parameter and the live CC11 value.

Factory MIDI controls are CC5 glide time, CC11 expression, CC64 sustain,
CC65 portamento enable, CC72 release, CC73 attack, and CC75 decay. CC120 uses
a click-safe 2 ms All Sound Off fade, CC121 resets controller state without
killing held notes, and CC123 starts the normal release. All accepted MIDI is
passed through for downstream effects.

Every visible control is backed by a JSFX slider parameter, so REAPER can
automate it or map it with **Param > Learn**. REAPER-owned Learn assignments
remain project state; they are separate from portable Morphazoid mappings.

## Custom interface and live analysis

The branded interface layers both live analyzers in the same non-scrolling
panel. Discrete rectangular spectrum bars sit in the background: their
horizontal positions are logarithmic from 20 Hz to the smaller of 20 kHz and
Nyquist, and their heights show the current output magnitude from -90 to 0 dB.
A bright amber oscilloscope trace is drawn simultaneously in front. The
**Analyzer** control switches between **Combined** and **Scope focus**; Scope
focus dims the background bars but keeps both displays visible. This retains
the parameter index used by projects saved with the earlier Spectrum/Scope
switch. Analysis reads the final protected output through a fixed ring buffer;
its 2048-point window, FFT, smoothing, and drawing run in `@gfx`, outside the
per-sample synthesis path.

The bars beneath the analyzer are interactive. Click or drag them to change
the corresponding host parameter; the five preset names across the top are
buttons.

## Automated Linux host smoke

`smoke/create-chaotic-fm-smoke.lua` creates a fresh REAPER project, loads the
installed effect, inserts five notes, three pitch-bend events, and twelve
controller events covering every factory expressive/channel-mode CC. It then
configures a 4.5 second, 48 kHz stereo WAV render. From the repository root:

```sh
reaper -newinst -nosplash -new \
  plugins/reaper/smoke/create-chaotic-fm-smoke.lua \
  -closeall:save:exit
reaper -newinst -nosplash -renderproject \
  /tmp/morphazoid-chaotic-fm-smoke/chaotic-fm-smoke.rpp
```

The creation report is written to
`/tmp/morphazoid-chaotic-fm-smoke/create-status.txt`; the rendered file is
`/tmp/morphazoid-chaotic-fm-smoke/chaotic-fm-smoke.wav`. Set
`MORPHAZOID_SMOKE_DIR` to use another output directory.

The v2 reference Linux run used REAPER 7.62, loaded 19 slider parameters, and
produced a 4.5 second, 48 kHz, 24-bit stereo file with MIDI-gated ADSR/glide
phrases and a peak near -12.3 dBFS.

## Browser and plugin MIDI

Web MIDI does not automatically become DAW MIDI. Implement the musical
behavior against `../../contracts/chaotic-fm-midi-v1.md`, then keep the host
adapters small:

- the browser turns Web MIDI events into the contract's note, controller, and
  bend actions;
- this JSFX turns `midirecv()` events into those same actions at each event's
  sample offset;
- a future native plugin turns its host MIDI event buffer into those actions.

This lets the browser and plugin ship separate versions from this same
repository without either implementation depending on the other's runtime.

## Scope

This remains a native-Linux REAPER implementation, not the cross-DAW product
format. A future C++ core can retain this MIDI/parameter contract and the same
DSP equations while JUCE supplies VST3/CLAP wrappers and a richer shared UI.
Because the oscillator is chaotic, short deterministic fixtures and spectral
statistics are better parity checks than expecting two floating-point
implementations to stay sample-identical forever.
