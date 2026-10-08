# Synthetic spoken inputs

`curling-voice.wav` says exactly **“it's curling a bit more than i'm comfortable for”**.
The phrase was rendered locally with the standard eSpeak NG `en-us` synthetic
voice, using the synchronous PCM callback method in
[`generate-puggler-mic-check.py`](../../../scripts/generate-puggler-mic-check.py).
Speech rate is 155 words/minute, pitch 42, and pitch range 50. Leading/trailing
silence is trimmed at an absolute PCM16 threshold of 100, retaining 100 leading
and 200 trailing frames. Peak normalization to 0.65 and 4/20 ms boundary fades
produce a mono PCM16 WAV at 22.05 kHz. The shared input loader adds its normal
short release gap when repeating the phrase.

This generated audio is provided under the repository's MIT license. eSpeak NG
is a separate GPL-3.0-or-later development tool; the sample plays as ordinary
recorded PCM. See the existing
[speech engine notices](../../../docs/THIRD_PARTY_NOTICES.md) and
[exact text, render settings and asset measurements](provenance.json).
