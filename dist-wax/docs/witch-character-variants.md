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
| Spider Synth | **Fang chatter and gasping howls**: eSpeak NG `croak`, interrupted screams, low groans and fricative bursts | **Cellar moans and breaking screams**: eSpeak NG Klatt `robosoft3`, deep moans, rising shrieks and a fading rattle |

All three Spider clips are wordless. The base **Croak and tearing shrieks**
uses Silk buzz; the two alternates change the native character and arrangement.
`scripts/witch-spider-vocals.mjs` renders isolated `[[A:]]`, `[[u:]]`, `[[x]]`
and `[[s]]` phones, rejecting any native result that contains another phone.
Curved playback, overlapping envelopes and flutter shape 12–13 groans, screams,
moans and consonant bursts per clip. After impact, the final moan and breath
rattle weaken into silence within the same 2.4-second budget. Every clip passes
through the native `SpiderSpeechPlayer`; no words or web plucks are included.
The voices are fictional synthesized characters, not recordings or imitations
of people.

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
