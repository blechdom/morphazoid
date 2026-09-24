#!/usr/bin/env python3
"""Original theatrical mic-check/count-in assets; offline eSpeak NG, no audio device.
Requires the system libespeak-ng and voice data, like generate-midi-received.py.
These are synthetic speech, not recordings of actors or a voice imitation.
"""
import array
import ctypes
import ctypes.util
from pathlib import Path
import sys
import wave

library = ctypes.util.find_library('espeak-ng')
if not library:
    raise SystemExit('Install libespeak-ng and its English voice data to regenerate.')
speech = ctypes.CDLL(library)
rate = speech.espeak_Initialize(2, 0, None, 0)
if rate <= 0:
    raise SystemExit('eSpeak NG initialization failed')
chunks = []
callback_type = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
@callback_type
def receive(samples, count, _events):
    if samples and count:
        chunks.extend(samples[:count])
    return 0
speech.espeak_SetSynthCallback(receive)
speech.espeak_SetVoiceByName(b'en-us')
speech.espeak_SetParameter(1, 185, 0)
speech.espeak_SetParameter(3, 43, 0)
speech.espeak_SetParameter(4, 65, 0)
for name, text in [('mic-check', b'Check, check. Is this thing on?'), ('count-in', b'One! Two! Three! Four!')]:
    chunks.clear()
    speech.espeak_Synth(text, len(text)+1, 0, 1, 0, 1, None, None)
    speech.espeak_Synchronize()
    if not chunks:
        raise SystemExit('No speech rendered')
    first = next(i for i,v in enumerate(chunks) if abs(v)>100)
    last = len(chunks)-next(i for i,v in enumerate(reversed(chunks)) if abs(v)>100)
    source=chunks[max(0,first-100):min(len(chunks),last+200)]
    peak=max(abs(v) for v in source) or 1
    pcm=array.array('h', [round(v/peak*.65*32767*min(1,i/(rate*.004),(len(source)-1-i)/(rate*.02))) for i,v in enumerate(source)])
    if sys.byteorder!='little':
        pcm.byteswap()
    path=Path(__file__).resolve().parents[1]/f'assets/puggler/{name}.wav'
    with wave.open(str(path),'wb') as wav:
        wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes(pcm.tobytes())
    print(name,len(pcm)/rate)
speech.espeak_Terminate()
