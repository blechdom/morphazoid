# Original synthesized demo loops

These twelve original compositions and fantasy effects were created for Morphazoid in 2026 and are provided under the repository's MIT license. Every voice is rendered by the existing Synthesaurus Rust/WASM engine. There are no external recordings, borrowed song excerpts or human vocal performances. Genre names describe artistic inspiration; instrument and choir names describe synthesis approximations, not acoustic recordings or cultural authenticity.

The **80s synth-pop homage** is an original arrangement. It contains no Rick Astley recording, borrowed song melody, lyrics or imitation of his voice. It is not the Rickroll song.

| Input | Tempo | Duration | Character |
| --- | ---: | ---: | --- |
| Classical clockwork | 108 BPM | 4.444 s | Original chamber-style counterpoint: bright plucked sixteenths against a rounded low clarinet-like line. |
| Rock & roll shuffle | 148 BPM | 6.486 s | Original shuffled power-chord picking, walking bass and synthesized backbeat. |
| Country porch picking | 116 BPM | 4.138 s | Original alternating low strings, twangy upper picking and soft wooden taps. |
| 80s synth-pop homage | 114 BPM | 8.421 s | Original 1980s-inspired synth-pop arrangement. No Rick Astley recording, borrowed song melody or voice imitation. |
| Sparkle unicorn | 96 BPM | 5.000 s | Original fantasy effect: rising glass glints, scattered high chimes and a slow luminous undercurrent. |
| Midnight jazz | 92 BPM | 5.217 s | Original swung FM keys, compact reed-like answers and a walking low line. |
| Dub skank | 76 BPM | 6.316 s | Original sparse offbeat organ, deep syncopated bass and dry rim accents; intentionally leaves space for delay. |
| Disco strut | 124 BPM | 3.871 s | Original octave bass, short bright chord chops and a synthesized four-on-the-floor beat. |
| Chiptune quest | 156 BPM | 6.154 s | Original pulse-wave adventure motif, fast broken chords and a triangle-like bass. |
| Ambient choir | 64 BPM | 7.500 s | Original slow synthesized vowel chords and drifting soft waves; no human vocal recording. |
| Acid circuit | 132 BPM | 3.636 s | Original resonant bass sequence with alternate accents, tight kick and tick-like hats. |
| Bossa sunrise | 112 BPM | 4.286 s | Original syncopated mellow plucks, low alternating roots, flute-like answers and soft rim taps. |

Files are stereo PCM16 at 44.1 kHz. Original note sequences, individual ADSR envelopes, velocity accents and stereo positions provide different rhythmic and spectral material for recursive delay. Release tails wrap over the musical bar boundary. One fixed gain per loop targets approximately −16.5 dBFS RMS with peaks no higher than −2.2 dBFS; sparse transient loops can have lower RMS. This is a signal-level target, not a LUFS measurement.

Regenerate from the repository root:

```sh
node scripts/render-synthesis-extra-loops.mjs
```

An optional output directory supports comparison renders. The script leaves the original four files in assets/synthesis/loops unchanged. renders.json records the generator and source WASM hashes, complete voice parameters, note sequences, measured levels, loop boundary steps, coarse spectral/envelope characterization and WAV hashes. These mechanical checks do not establish timbral quality or human/device listening acceptance.
