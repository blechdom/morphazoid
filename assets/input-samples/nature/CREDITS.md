# Nature input samples

These are short excerpts of the credited recordings already bundled unchanged
under `assets/bioacoustics/`. The originals remain unchanged there. The WAV
excerpts here retain their respective media licenses; the repository's MIT
software license does not replace those licenses.

| File | Original recording / creator | License | Source |
| --- | --- | --- | --- |
| `coyote-howl.wav` | Pack of coyotes howling in Ventura County, California; Rybkovich | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pack_of_coyotes_howling.ogg) |
| `frog-chorus.wav` | Pobblebonk and motorbike frogs at Lake Seppings; Hughesdarren | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Frog_sounds.ogg) |
| `humpback-song.wav` | Humpback whale song; contributed by Spyrogumas | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Humpbackwhale2.ogg) |
| `cricket-night.wav` | House-cricket stridulation; Morray | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Acheta-domesticus-Stridulation.ogg) |

Morphazoid prepared each excerpt by cropping, downmixing to mono, resampling to
44.1 kHz PCM16, removing DC, adding 10 ms boundary fades, and applying a single
static gain. No compression or pitch change was applied. The coyote and frog
adaptations are distributed under CC BY-SA 4.0. No creator endorsement is implied.

Exact source/excerpt hashes, crop windows, actual durations and gain changes are
in [sources.json](sources.json). Recreate these files from the bundled originals
with `node scripts/prepare-nature-input-samples.mjs`; ffmpeg is a development-time
decoder and is not needed in the browser.
