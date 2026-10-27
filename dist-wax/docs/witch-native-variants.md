# Witches Brew native sound variants

`WITCH_NATIVE_BITE_VARIANTS` in
[`witch-bite-native-variants.js`](../src/instruments/witch/witch-bite-native-variants.js)
contains three choices for each listed ingredient. A `null` first entry keeps
the existing base bite. BLECH has three replacement rin-w patterns; neither
the former Black Lattice passage nor the BLEEDING EDGE MONOTONE excerpts are
one of its choices. This bank adds nine mono PCM16 clips
at 22,050 Hz, decoded to 2,593,080 bytes of Float32 audio. BLECH clips last five
seconds; the other clips last 2.4 seconds. It adds no live source instruments.

| Ingredient | Choice 1 | Choice 2 | Choice 3 |
| --- | --- | --- | --- |
| BLECH MIDI | rin-w Funnel 128 · 3 beats, 2,917 source notes | rin-w Funnel 88 · 4 beats, 2,794 source notes | rin-w Volcanic web, 1,393 source notes |
| Rubix | Existing Color circuit, 252 BPM | Silver facets, 288 BPM, scrambled snake traversal | Pulse prism, 240 BPM, a different scramble with alternating faces |
| Monstroid | Existing Many-mouth rough call | Full-pressure rough call, loaded flow | Rough swarm call, impact flow |
| Candy Coil | Existing Frozen Bog | Slow Coil, fed by Silver facets | Thick Tar, fed by Pulse prism |

BLECH uses the complete `black-pattern-3-beat-funnel-128.mid`,
`black-pattern-4-beat-funnel-88.mid` and `black-pattern-webs-volcanic.mid` files
already bundled in its library. Every original attack, velocity, controller,
program and pitch bend reaches the native SpessaSynth and TimGM6mb soundfont,
with BLECH's existing 128-voice policy and native voice stealing. These dense
note-art patterns repeat at 1.6 times their original tempo; no notes are thinned
or transposed during rendering. Two complete preroll periods warm the voices
and release tails before exporting a five-second ingredient taste. Source
hashes, original note counts, source rate and exact loop-frame periods remain
in each clip's metadata.

Flying visitors repeat that native source period with a 25 ms overlap inside
the clip's boundary fades. Their fixed trim is 0.22, up from 0.13 (+4.57 dB).
Clicked visitors use the same pattern in three offset readers at 2.4, 2.8 and
3.2 times the clip rate for 5.2 seconds, with a 0.125 trim per reader instead of
0.075 (+4.44 dB). Two automatic readers and three manual readers remain the
fixed ceiling; clicking still ducks the automatic visitors. These values do
not change the overall Witch output limit or the ingredient source trims.

Rubix uses its actual `RubixSimd303Processor`, surface preset mapper, scrambled
cube placements and visible-face gates. Its variants have 126 and 105 audible
sticker attacks before release. Monstroid uses the full native
`ColonySyrinxPressureProcessor`, each selected recipe's pressure network and
articulation. Candy Coil uses its native `MorphazoidBarberDelayProcessor` and
unchanged Slow Coil/Thick Tar factory settings. The variants capture 2.4 seconds
after twelve seconds of history from their respective native Rubix excerpts.

The authoring pass applies short boundary fades, then a fixed soft-peak curve
only where narrow transients would otherwise prevent the requested level.
It exports approximately 0.14 RMS with a 0.65 sample-peak ceiling. The curve's
drive is recorded in each clip's `authoringSoftPeakDrive` metadata. This is
offline processing; there is no playback AGC or normalization. The instrument's
existing per-source trims still set the final balance. Finite-output and level
checks do not establish perceptual harshness or equal perceived loudness.

Rebuild only this bank with:

```sh
node scripts/build-witch-native-variants.mjs
```

Add `--blech-only` to regenerate just the three rin-w clips, preserving every
other variant byte-for-byte. The command leaves `witch-bite-clips.js` and the
other bite generators unchanged.
Its complete source and render parameters are in
[`build-witch-native-variants.mjs`](../scripts/build-witch-native-variants.mjs).

The three MIDI patterns are by **rin-w / Black MIDI Patterns contributors**.
Their repository contribution terms allow public use and modification without
special conditions; there is no standalone license file. The descriptive
`LicenseRef-Black-MIDI-Patterns-Public-Use` is retained rather than assigning an
SPDX license. Exact original files, source hashes, credits and usage terms are
in [`collection.json`](../assets/midiphoria/collection.json),
[`BLACK-MIDI-SOURCES.md`](../assets/midiphoria/BLACK-MIDI-SOURCES.md) and
[`BLACK-MIDI-PATTERNS.md`](../assets/midiphoria/licenses/BLACK-MIDI-PATTERNS.md).
TimGM6mb is by Tim Brechbill and David Bolton; its supplied
[`copyright notice`](../assets/midiphoria/soundfont/COPYRIGHT.txt) and
[`GPL-2 license`](../assets/midiphoria/soundfont/GPL-2.0.txt) remain available.
The existing SpessaSynth vendor notices apply to the offline renderer.
Rubix's acid engine retains the “sound - acid jam” credit to srtuss shown on
the [SIMD303 page](../src/pages/simd-303.html); the other authored Morphazoid engines and scores retain the repository
license. These are synthesized excerpts, not animal or historical recordings.
