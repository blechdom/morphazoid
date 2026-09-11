# Roach Synth recorded movement samples

All three WAV files derive from **nicotep**, *Gromphadorhina_portentosa.aif*
(2020-12-14), released under **CC0 1.0 Universal**.

- [Creator and recording page](https://freesound.org/people/nicotep/sounds/547897/)
- [CC0 dedication](https://creativecommons.org/publicdomain/zero/1.0/)
- [Downloaded Freesound HQ MP3 preview](https://cdn.freesound.org/previews/547/547897_7529214-hq.mp3)

The creator describes close microphone recording of Madagascar hissing
cockroach movements in a museum vivarium in Lille, France, with an Oktava
hypercardioid condenser microphone. The original AIFF was not downloaded:
these edits use the public, lossy MP3 preview. Source and license were checked
2026-09-11. No endorsement by the creator or museum is implied.

| File / bank ID | Source interval | Duration | Intended sample role |
| --- | --- | --- | --- |
| `vivarium-scuttle.wav` / `vivarium_scuttle` | 80.500–84.000 s | 3.500 s | Clustered movement transients |
| `vivarium-rustle.wav` / `vivarium_rustle` | 10.400–13.900 s | 3.500 s | Broadband movement texture |
| `vivarium-contact.wav` / `vivarium_contact` | 3.000–5.500 s | 2.500 s | Sparse sharp movement transients |

Edits: 180 Hz high-pass and 14 kHz low-pass filtering, trimming, resampling to
48 kHz mono, 10 ms endpoint fades, constant gain and offline lookahead peak
reduction. Each file is signed 16-bit PCM WAV, approximately −28 dBFS RMS with
−6 dBFS sample peaks. Total runtime audio is 9.5 seconds / 912,132 bytes.
The limiter affects approximately 7.05%, 2.48% and 5.07% of the respective
files; maximum instantaneous gain reduction is 11.95, 8.61 and 11.73 dB.
No pitch shift, time stretch, generated sound, music or speech was added.

The names describe their instrument roles. They are **recorded vivarium
movements**, not independently identified footsteps, isolated hisses, wing
sounds or recordings inside a house wall. The sampled species is wingless;
the displayed scanned specimen has no confirmed species identification.
Granular retriggering and synthesized wall/ground resonances are sound design.

Selection used source provenance and waveform/spectrogram inspection. No
obvious sustained speech or musical harmonic patterns were seen in these
intervals, but no human audition was performed; this does not certify the
absence of intelligible background sounds or perceptual quality.

[manifest.json](manifest.json) records complete source/output SHA-256 hashes,
exact source offsets, processing settings, raw and processed levels, and
transient cue positions in seconds relative to each edited file. Cues identify
measured broadband energy peaks, not verified biological events.

Source MP3 SHA-256:
`37f2b888e41485802a078d9b3cb85a10f648bd45b44272677e9e4739a842780d`.
