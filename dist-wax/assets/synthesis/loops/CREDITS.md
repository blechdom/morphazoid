# Original musical processing inputs

These four original phrases were composed and rendered for Morphazoid in 2026.
They are provided under the repository's MIT license. They contain no external
recordings or borrowed song excerpts. The instrument names describe synthesized
sounds: these are not recordings of acoustic piano, guitar or bass performances.

| Input | Method / starting preset | Length | Intended processing examples |
| --- | --- | --- | --- |
| Bass groove | Subtractive / Muted saw bass | 2 bars, 4 seconds | Filter sweeps, saturation and compression |
| Electric piano chords | FM / Electric tine | 4 bars, 8 seconds | Chorus, phasing, reverb and spectral processing |
| Plucked strings | Karplus–Strong / Natural string pluck | 2 bars, 4 seconds | Delay, resonators and transient shaping |
| Synth arpeggio | Wavetable / Hollow square | 2 bars, 4 seconds | Rhythmic delay, filtering and pitch processing |

All loops are in 4/4 at **120 BPM**, using original A-minor-centered phrases.
Electric piano follows Am(add9)–Fmaj7–C/G–G(add9). The files are dry, stereo PCM16 at
44.1 kHz. Notes use individual envelopes and velocity accents. Release tails
wrap across the bar line; no trailing pause is inserted by the demo loader.
A single fixed gain targets −15.9 dBFS RMS with peaks no higher than −2.2 dBFS,
leaving room for processing. This is a signal-level target, not a LUFS claim.

Regenerate from the repository root with:

```sh
node scripts/render-synthesis-musical-loops.mjs
```

The generator renders every note through `assets/wasm/synthesis.wasm`, the same
Rust engine used by Synthesaurus. It accepts an optional output directory for
comparison renders. `renders.json` records the source WASM hash, note sequence,
preset, envelope, file hash and measured level for each loop.

Validation includes file integrity, exact bar duration, loop boundaries,
non-silence, clipping, and real-browser playback through the processor input.
Human listening and physical-device acceptance are not established by those checks.
