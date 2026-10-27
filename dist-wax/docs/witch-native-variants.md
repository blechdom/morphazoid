# Witches Brew native sound variants

`WITCH_NATIVE_BITE_VARIANTS` in
[`witch-bite-native-variants.js`](../src/instruments/witch/witch-bite-native-variants.js)
contains eight choices for BLECH and three for the other listed ingredients.
A `null` first entry keeps the existing base bite. This bank adds fourteen
mono PCM16 clips at 22,050 Hz, decoded to 2,658,352 bytes of Float32 audio.
BLECH stores one loop period plus fade margins and plays for five seconds;
the other clips last 2.4 seconds. The complete shared Witch PCM bank remains
under its existing 12 MB limit. It adds no live source instruments.

| Ingredient | Choice 1 | Choice 2 | Choice 3 |
| --- | --- | --- | --- |
| Rubix | Existing Color circuit, 252 BPM | Silver facets, 288 BPM, scrambled snake traversal | Pulse prism, 240 BPM, a different scramble with alternating faces |
| Monstroid | Existing Many-mouth rough call | Full-pressure rough call, loaded flow | Rough swarm call, impact flow |
| Candy Coil | Existing Frozen Bog | Slow Coil, fed by Silver facets | Thick Tar, fed by Pulse prism |

BLECH alternates complete geometric patterns with dense excerpts from the
final tenth of the sounding notes in three bundled creator AUDIO files:

| Choice | Original source window | Original attacks |
| --- | --- | ---: |
| rin-w Funnel 128 · 3 beats | Complete pattern | 2,917 |
| Chasing Wind · final cascade | 172.25–176.75 seconds | 1,234 |
| rin-w Block Gliss 128 · 4 beats | Complete pattern | 128 |
| Lightstorm · ending barrage | 234–238.5 seconds | 6,536 |
| rin-w Volcanic web | Complete pattern | 1,393 |
| SWMG · ending clusters | 184.75–189.25 seconds | 1,631 |
| rin-w Block Gliss 88 · 3 beats | Complete pattern | 88 |
| rin-w Funnel 88 · 4 beats | Complete pattern | 2,794 |

Each ending spans all twelve pitch classes. Lightstorm's ending contains 53%
more attacks than its former 126–130.5-second excerpt. These are MIDI-density
and pitch-distribution observations; they do not establish perceived melody
or harshness. The former Black Lattice, Seven Red Suns and A Soul Of Steel
passages are absent.

Every original attack in each window, with its velocity and channel, reaches
native SpessaSynth and TimGM6mb at 1.6 times source tempo, using BLECH's
128-voice policy and native voice stealing. All eight sounds are transposed
up one octave through the native synth's global tuning (+1,200 cents), retaining
every MIDI note ID, including the top octave of the 128-note patterns. Timing,
velocity, note releases and loop lengths stay intact; no notes are thinned.
Excerpt boundaries restore source controller/program state and held notes,
releasing held voices at each wrap. Two preroll periods warm release tails.
Source hashes, complete/window note counts, rate, transposition and loop periods
remain in clip metadata. The lightweight recipe list is
[`witch-blech-phrases.js`](../src/instruments/witch/witch-blech-phrases.js).

Ingredients and flying visitors repeat that source period with a 25 ms overlap
inside the clip's boundary fades. Automatic flying visitors keep their fixed
0.22 trim, up from 0.13 (+4.57 dB).
Clicked visitors use the same pattern in three offset readers at 2.4, 2.8 and
3.2 times the clip rate for 5.2 seconds, with a 0.125 trim per reader instead of
0.075 (+4.44 dB). Two automatic readers and three manual readers remain the
fixed ceiling; clicking still ducks the automatic visitors. These values do
not change the overall Witch output limit or the ingredient source trims.
All eight choices retain the same ingredient trim. Tree drops, autonomous
visitors and manual-only sky clicks have independent rotations; mute and
preset changes do not consume ingredient choices. Clicking a sounding visitor
intensifies that visitor's current phrase.

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

Add `--blech-only` to regenerate just the eight BLECH clips, preserving every
other variant byte-for-byte. The command leaves `witch-bite-clips.js` and the
other bite generators unchanged.
Its complete source and render parameters are in
[`build-witch-native-variants.mjs`](../scripts/build-witch-native-variants.mjs).

The five geometric patterns are by **rin-w / Black MIDI Patterns contributors**.
Their repository contribution terms allow public use and modification without
special conditions; there is no standalone license file. The descriptive
`LicenseRef-Black-MIDI-Patterns-Public-Use` is retained rather than assigning an
SPDX license. Exact original files, source hashes, credits and usage terms are
in [`collection.json`](../assets/midiphoria/collection.json),
[`BLACK-MIDI-SOURCES.md`](../assets/midiphoria/BLACK-MIDI-SOURCES.md) and
[`BLACK-MIDI-PATTERNS.md`](../assets/midiphoria/licenses/BLACK-MIDI-PATTERNS.md).
The three ending excerpts are from **BLEEDING EDGE MONOTONE**'s original
creator AUDIO editions, licensed CC0. Their original files/hashes and credits
remain in the collection, with the supplied
[`CC0 notice`](../assets/midiphoria/licenses/BLACK-MIDI-ARCHIVE-CC0.txt).
TimGM6mb is by Tim Brechbill and David Bolton; its supplied
[`copyright notice`](../assets/midiphoria/soundfont/COPYRIGHT.txt) and
[`GPL-2 license`](../assets/midiphoria/soundfont/GPL-2.0.txt) remain available.
The existing SpessaSynth vendor notices apply to the offline renderer.
Rubix's acid engine retains the “sound - acid jam” credit to srtuss shown on
the [SIMD303 page](../src/pages/simd-303.html); the other authored Morphazoid engines and scores retain the repository
license. These are synthesized excerpts, not animal or historical recordings.
