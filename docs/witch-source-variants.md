# Witches Brew native source variants

`scripts/build-witch-source-variants.mjs` authors two additional tastes for each
instrument below. It writes only
`src/instruments/witch/witch-bite-source-variants.js`, whose exported
`WITCH_SOURCE_BITE_VARIANTS` maps each trigger to `[null, first, second]`.
The null entry preserves the existing taste. Each new entry has the same
`instrumentId`, `source`, `rate`, `frames`, `events` and `pcm` fields as the
original bite bank; `events` counts the rendered attacks or authored calls.

| Trigger | First alternate | Second alternate |
| --- | --- | --- |
| `drop-fractal` | Fractal Synthesis Tangled Bells, branching FM bell events | Gravel Static, fast noise texture events |
| `drop-jaw-harp` | Deep Overtone Khomus, alternating plucks and its native vowel sequence | Sicilian Chatter Marranzanu, faster plucks with moving jaw and tongue |
| `drop-harmonicazoid` | Midnight Growl, low bent breath pulses through moving holes | Fox-Chase Breath, rapid fluttering pulses and hole changes |
| `drop-synthesaurus` | Phase Distortion Resonant Synthetic Vowel, 28 fast notes | Waveguide Ragged Bass Reed, 15 uneven descending notes |
| `drop-dentaphone` | Bronze Drone, forward brush route | Tiny Glass Bells, fast reversed brush route |
| `drop-marimba` | Rattlesnake, 48 falling inharmonic modal strikes | Rattlesnake, 58 sharp strikes folding up and down |
| `drop-cat` | Quadruped Purr call | Quadruped Trill call |
| `drop-mouse` | Quadruped Chirp call | Quadruped Peep call |
| `drop-lizard` | Quadruped Click Song arpeggio | Quadruped Hiss Reed call |

These are freshly rendered source performances, not transpositions of the
existing PCM. The Fractal, Jaw Harp, Harmonicazoid, Synthesaurus and Dentaphone
excerpts run their actual DSP or worklet processors offline. Synthesaurus uses
the committed `assets/wasm/synthesis.wasm`. Dentaphone uses each material's
complete preset, native tooth pitch map and brush route.

Rattlesnake retains the bounded scalar modal rendering used by its original
Witch bite: native `linearDrumParameters` supplies the frequency-dependent
ratios, gains, damping, noise and pitch fall. Its two variants change the
material controls and the entire strike score. This renders the modal branch,
not every Rattlesnake synthesis engine.

The Quadruped excerpts use `createQuadrupedGestureCall` and the native Purr,
Trill, Chirp, Peep, Click Song and Hiss Reed descriptors. A fixed scalar
rendition of `scheduleCall` supplies the pitch contours, pulse, attack/release,
bandpass and quiet sine undertone; Click Song uses separate arpeggio attacks.
Its oscillator partial count is bounded below Nyquist. These are synthetic
character calls, not animal recordings or a complete Quadruped instrument.

All eighteen clips are 2.4-second PCM16LE mono at 22,050 Hz: 52,920 frames each.
The authoring pass checks every sample for finite values and rejects silence.
It adds 6 ms onset and 120 ms ending fades and aims for 0.14 RMS with a 0.65
peak ceiling. Clips that exceed that ceiling at the target gain receive a
fixed soft saturation curve offline, without a level follower or runtime AGC.
PCM quantization can differ from the floating-point ceiling by one sample step.
Decoded Float32 storage for this bank is 3,810,240 bytes; source engines are
not instantiated by these generated records.

Regenerate with:

```sh
node scripts/build-witch-source-variants.mjs
```

The script prints frame counts, event counts, RMS and peak values. Syntax and
offline finite/bounds checks establish file integrity and level limits;
they do not establish timbral quality or replace listening.

The source engines, presets and newly authored scores are original Morphazoid
work under the repository's [MIT license](../LICENSE). No new recordings,
external samples or third-party model assets are included. Source references:

- [Fractal DSP](../src/instruments/fractal-signals/dsp.js) and [factory scenes](../src/instruments/fractal-signals/presets.js)
- [Jaw Harp processor](../src/instruments/jaw-harp/jaw-harp-processor.js) and [full presets](../src/instruments/jaw-harp/full-presets.js)
- [Harmonicazoid processor](../src/instruments/harmonica/harmonica-processor.js) and [full presets](../src/instruments/harmonica/full-presets.js)
- [Synthesaurus processor](../src/instruments/synthesis/processor.js) and [method catalogue](../src/instruments/synthesis/catalog.js)
- [Dentaphone material presets](../src/instruments/object-forge/full-presets.js), [tooth pitch maps](../src/instruments/object-forge/dentaphone.js) and [modal processor](../src/physical-sounds-processor.js)
- [Rattlesnake parameter mapper](../src/instruments/linear-drums/linear-drums.js)
- [Quadruped calls](../src/instruments/quadruped/quadruped-voices.js), [gesture descriptors](../src/instruments/quadruped/quadruped-gesture-voices.js) and [native scheduler](../src/instruments/quadruped/quadruped-app.js)
