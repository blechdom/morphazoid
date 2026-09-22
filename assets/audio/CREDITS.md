# I/O setup voice

`midi-received.wav` is an original synthesized “MIDI received” announcement for
Morphazoid, not a recording from Apple, Macintosh system software, OMS, or a
third-party sound library. Its deliberately lo-fi computer voice is an homage,
not a claim of historical authenticity.

Generated locally with eSpeak NG's English US voice using
`python3 scripts/generate-midi-received.py`; pronunciation input is “Middy
received.” The generator applies flat inflection, 11.025 kHz resampling and
8-bit-style quantization, then stores mono PCM16 WAV. No synthesizer library
code or voice database is bundled in the browser site. The original generated
asset is provided under the repository's MIT license.

eSpeak NG is a separate GPL-3.0-or-later development tool:
https://github.com/espeak-ng/espeak-ng
