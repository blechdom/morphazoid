# Witches Brew native sound variants

`WITCH_NATIVE_BITE_VARIANTS` in
[`witch-bite-native-variants.js`](../src/instruments/witch/witch-bite-native-variants.js)
contains three choices for each listed ingredient. A `null` first entry keeps
the existing base bite. BLECH has three replacement clips, so the former Black
Lattice passage is not one of its choices. This bank adds nine mono PCM16 clips
at 22,050 Hz, decoded to 2,593,080 bytes of Float32 audio. BLECH clips last five
seconds; the other clips last 2.4 seconds. It adds no live source instruments.

| Ingredient | Choice 1 | Choice 2 | Choice 3 |
| --- | --- | --- | --- |
| BLECH MIDI | Lightstorm, 126–130.5 seconds, 4,274 attacks | Seven Red Suns, 39.25–43.75 seconds, 4,828 attacks | A Soul Of Steel, 208–212.5 seconds, 4,473 attacks |
| Rubix | Existing Color circuit, 252 BPM | Silver facets, 288 BPM, scrambled snake traversal | Pulse prism, 240 BPM, a different scramble with alternating faces |
| Monstroid | Existing Many-mouth rough call | Full-pressure rough call, loaded flow | Rough swarm call, impact flow |
| Candy Coil | Existing Frozen Bog | Slow Coil, fed by Silver facets | Thick Tar, fed by Pulse prism |

BLECH's passages are from the complete, creator-supplied AUDIO MIDI editions
already bundled in its file library. Each includes the source's documented
densest second: Lightstorm has 3,398 attacks there, Seven Red Suns has 3,232,
and A Soul Of Steel has 3,007. The excerpts preserve original pitch, velocity,
tempo, gates, programs, controllers and pitch bend. The native SpessaSynth and
TimGM6mb soundfont render every selected attack using BLECH's existing
128-voice policy; native voice stealing still applies. A one-second preroll
warms held notes and releases. Each exported clip contains 4.5 seconds of score
followed by half a second of release. No score thinning or transposition is
used to create these alternatives.

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

The command leaves `witch-bite-clips.js` and the other bite generators unchanged.
Its complete source and render parameters are in
[`build-witch-native-variants.mjs`](../scripts/build-witch-native-variants.mjs).

The three MIDI works are by **BLEEDING EDGE MONOTONE**, supplied under CC0 1.0
in the author's Black MIDI Archive. Exact original files, source hashes,
credits and license records remain in
[`collection.json`](../assets/midiphoria/collection.json),
[`BLACK-MIDI-SOURCES.md`](../assets/midiphoria/BLACK-MIDI-SOURCES.md) and
[`BLACK-MIDI-ARCHIVE-CC0.txt`](../assets/midiphoria/licenses/BLACK-MIDI-ARCHIVE-CC0.txt).
TimGM6mb is by Tim Brechbill and David Bolton; its supplied
[`copyright notice`](../assets/midiphoria/soundfont/COPYRIGHT.txt) and
[`GPL-2 license`](../assets/midiphoria/soundfont/GPL-2.0.txt) remain available.
The existing SpessaSynth vendor notices apply to the offline renderer.
Rubix's acid engine retains the “sound - acid jam” credit to srtuss shown on
the [SIMD303 page](../src/pages/simd-303.html); the other authored Morphazoid engines and scores retain the repository
license. These are synthesized excerpts, not animal or historical recordings.
