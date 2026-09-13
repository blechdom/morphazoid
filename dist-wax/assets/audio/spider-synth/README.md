# Recorded peacock-spider vibrations

The three WAV files are **actual substrate-borne courtship vibrations of male
Maratus volans**, made audible by laser vibrometry. They are not airborne calls,
not tarantula recordings, and not recordings of the scanned Argiope specimen.
They are three articulations excerpted from one study's supplementary video.

**Credit:** Madeline B. Girard, Michael M. Kasumovic and Damian O. Elias (2011),
*Multi-Modal Courtship in the Peacock Spider, Maratus volans
(O.P.-Cambridge, 1874)*, PLOS ONE 6(9), e25390.

- [Article and recording methods](https://doi.org/10.1371/journal.pone.0025390)
- [Video S1, the source recording](https://doi.org/10.1371/journal.pone.0025390.s001)
- [Author/publisher dataset and license](https://doi.org/10.6084/m9.figshare.132960)
- [Machine-readable dataset metadata](https://api.figshare.com/v2/articles/132960)
- [Exact downloadable source](https://ndownloader.figshare.com/files/369220)
- **License:** [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

The Figshare metadata identifies `Video_S1.m4v`, 7,546,754 bytes, under CC BY 4.0;
its MD5 `4601c1eb6f7b2def1ed4cb395e4f861e` matches the downloaded source. Source
SHA-256: `eb17b297355119430fa1abe8763160c3eef78d8f04be241df7ea96923a77ca0b`.
The article also states a Creative Commons Attribution license. The authors
do not endorse this instrument.

| File | Source video interval | Recorded signal | Bytes |
| --- | --- | --- | ---: |
| `peacock-rumble.wav` | 18.82–21.38 s | Rumble-rump excerpt during abdomen bobbing | 112,940 |
| `peacock-crunch.wav` | 39.93–41.27 s | Crunch-roll excerpt during the pre-mount display | 59,138 |
| `peacock-grind.wav` | 59.02–61.05 s | Grind-rev excerpt during the pre-mount display | 89,568 |

Changes: extracted the left audio channel (the signal-bearing channel), trimmed
the intervals above, applied a second-order 80 Hz high-pass, resampled 44.1 kHz
to 22.05 kHz with a polyphase antialias filter, removed DC, adjusted gain with a
0.76 peak ceiling, faded each file's first/last 10 ms, and encoded mono 16-bit PCM.
No synthetic sound, time stretch or denoising was added to these assets. The
source recording already reflects the experimental substrate, measurement and
video encoding. These WAVs are listening/instrument assets, not calibrated
measurements suitable for reproducing the paper's physical analysis.

`manifest.json` records exact intervals, gains, durations, sizes and derived
hashes. `scripts/prepare-spider-recordings.py` reproduces the extraction from the
source video with Python, PyAV, NumPy and SciPy.

The instrument plays short, faded fragments only on accepted body movement,
foot/string contacts or MIDI notes. Tune, joint axes and MIDI pitch bend alter
playback speed artistically. Eight shared recording voices, two tails per body
row and a per-row 160 ms retrigger interval keep the accents bounded. There is
no automatic recording loop. Selecting the three named sound presets does not
change the spider species, animation or web.

These assets retain the CC BY 4.0 license independently of the application's MIT
license. Preserve the above credit, source link, license link and modification
notice when redistributing them.
