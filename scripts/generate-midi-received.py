#!/usr/bin/env python3
"""Render our original retro-style voice sample using the local eSpeak NG library.

Development-only; requires libespeak-ng and its English voice data. No network,
Apple samples, or runtime speech service. Run from any directory with Python 3.
"""
import ctypes
import ctypes.util
from pathlib import Path
import wave
import array
import sys

library = ctypes.util.find_library("espeak-ng")
if not library:
    raise SystemExit("Install libespeak-ng and English voice data to regenerate.")
speech = ctypes.CDLL(library)
sample_rate = speech.espeak_Initialize(2, 0, None, 0)  # synchronous retrieval
if sample_rate <= 0:
    raise SystemExit("eSpeak NG initialization failed")
chunks = []
callback_type = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)


@callback_type
def receive(samples, count, _events):
    if samples and count:
        chunks.extend(samples[:count])
    return 0


speech.espeak_SetSynthCallback(receive)
speech.espeak_SetVoiceByName(b"en-us")
speech.espeak_SetParameter(1, 145, 0)  # words/minute
speech.espeak_SetParameter(3, 32, 0)   # pitch
speech.espeak_SetParameter(4, 0, 0)    # robotic, flat inflection
text = b"Middy received."
speech.espeak_Synth(text, len(text) + 1, 0, 1, 0, 1, None, None)
speech.espeak_Synchronize()
speech.espeak_Terminate()
if not chunks:
    raise SystemExit("No speech rendered")

# Intentional 11.025 kHz / 8-bit-style texture, stored as universally supported
# PCM16 WAV. Normalize to -4 dBFS; the page applies its conservative test gain.
peak = max(abs(value) for value in chunks) or 1
rate = 11025
output = array.array("h")
for i in range(int(len(chunks) * rate / sample_rate)):
    source = chunks[min(len(chunks) - 1, int(i * sample_rate / rate))]
    quantized = round(source / peak * 0.63 * 127) / 127
    output.append(round(quantized * 32767))
if sys.byteorder != "little":
    output.byteswap()
path = Path(__file__).resolve().parents[1] / "assets/audio/midi-received.wav"
path.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(path), "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(rate)
    wav.writeframes(output.tobytes())
print(f"Rendered {path}: {len(output) / rate:.2f} seconds")
