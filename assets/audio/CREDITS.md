# I/O setup voice

`midi-received.wav` is an original synthesized “MIDI received” announcement for
Morphazoid, not a recording from Apple, Macintosh system software, OMS, or a
third-party sound library. Its deliberately lo-fi computer voice is an homage,
not a claim of historical authenticity.

Generated locally with eSpeak NG's English US voice using
`python3 scripts/generate-midi-received.py`; pronunciation input is “Middy
received.” The generator applies flat inflection, 11.025 kHz resampling and
8-bit-style quantization, then stores mono PCM16 WAV. This announcement plays
a rendered sample without loading a synthesizer library or voice database.
The original generated asset is provided under the repository's MIT license.
The separate browser speech engines are credited in [third-party notices](../../docs/THIRD_PARTY_NOTICES.md).

eSpeak NG is a separate GPL-3.0-or-later development tool:
https://github.com/espeak-ng/espeak-ng
