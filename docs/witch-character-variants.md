# Witch character taste variants

`scripts/build-witch-character-variants.mjs` renders eight additional tastes
into `src/instruments/witch/witch-bite-character-variants.js`. Each ingredient
has `[null, alternate, alternate]`: the null entry keeps its existing base
clip. Every alternate is 2.4 seconds of mono PCM16 at 22,050 Hz, with finite
onset/release fades, an RMS target of 0.14 and a peak ceiling of 0.65. The eight
clips add 1,693,440 decoded float32 bytes. No source instrument runs at a drop.
The generator applies a fixed soft peak curve to excerpts whose isolated spikes
would otherwise force the entire phrase below that level; playback has no
automatic gain adjustment.

| Ingredient | Second taste | Third taste |
| --- | --- | --- |
| Puggler | **Roxy saw sprint**: 248 BPM, native axe buzzsaw, pickle gated guitar and apple octave-fuzz props, alternate kick/snare pattern and Roxy Oi | **Moss basement gallop**: 232 BPM, native pickle/club/banana guitar props, picked bass, galloping kicks, tom fill and Moss Oi |
| SIMD Chiptune | **Crypt pulse chase**: 216 BPM, narrow pulse, clipped bass, minor chromatic hook and fast arpeggio | **Broken cartridge rush**: 240 BPM, wide pulse, prominent upper/lead voices, different irregular note/rest loops and syncopated drums |
| SIMD303 | Native **Sixteen Ratchet** factory voice, sequence and expression at 15.4 steps/second | Native **Foldstorm** factory voice, sequence and expression accelerated to 14.8 steps/second |
| Spider Synth | Native **Silk whisper** / eSpeak NG `whisperf` character | Native **Cellar rasp** / eSpeak NG Klatt `robosoft3` character |

The second Spider character says “SPIIIIIIDER!!!!!!” through the native
`SpiderSpeechPlayer`, stretching the stressed vowel while retaining its consonants.
The third says “I love you mom and dad!” with complete native sentence timing.
They follow the base clip's long “NOOOOOOOOO !!!!!” and finish before the release fade. They contain
no web plucks. The voices are fictional synthesized characters, not recordings
or imitations of people.

Puggler reuses its native string-model prop synthesis and vocal-character DSP.
The drums are Karoryfer Samples' CC0 recordings; Oi is rhink's CC0 recording.
See [Puggler's credits](../assets/puggler/CREDITS.md). Chiptune and SIMD303 use
their committed native WASM processors; the former receives two authored
tracker patterns, while the latter retains its factory expression states.
Native speech uses the already bundled eSpeak NG/Voicesaurus engine; see
[third-party notices](THIRD_PARTY_NOTICES.md). No external audio was downloaded.

The generator checks finite, non-silent PCM, exact clip length, zero edge
samples, and separation between each pair of alternates before writing the
bank. These are offline integrity checks, not a substitute for listening in
the complete Witch mix.
