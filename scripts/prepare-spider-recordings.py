#!/usr/bin/env python3
"""Reproduce the CC BY spider excerpts; run manually, never during a site build.

Usage: python scripts/prepare-spider-recordings.py /path/to/Video_S1.m4v OUTPUT_DIR
Dependencies: av, numpy, scipy. Source URL and license are in the asset README.
"""
import hashlib
import pathlib
import sys
import wave

import av
import numpy as np
from scipy import signal

source, output = map(pathlib.Path, sys.argv[1:3])
expected = 'eb17b297355119430fa1abe8763160c3eef78d8f04be241df7ea96923a77ca0b'
if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
    raise ValueError('Source does not match the licensed publisher recording.')
container = av.open(str(source))
audio = np.concatenate([frame.to_ndarray() for frame in container.decode(audio=0)], axis=1)[0]
output.mkdir(parents=True, exist_ok=True)
rate = 22050
for name, start, end in [('peacock-rumble', 18.82, 21.38),
                         ('peacock-crunch', 39.93, 41.27),
                         ('peacock-grind', 59.02, 61.05)]:
    samples = audio[round(start * 44100):round(end * 44100)].astype(float)
    samples = signal.sosfilt(signal.butter(2, 80, fs=44100, btype='highpass', output='sos'), samples)
    samples = signal.resample_poly(samples, 1, 2)
    samples -= samples.mean()
    samples *= min(.76 / max(abs(samples)), .145 / np.sqrt(np.mean(samples * samples)))
    fade = round(.01 * rate)
    samples[:fade] *= np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
    samples[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
    data = np.round(np.clip(samples, -1, 1) * 32767).astype('<i2')
    path = output / (name + '.wav')
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(rate)
        stream.writeframes(data.tobytes())
    print(name, hashlib.sha256(path.read_bytes()).hexdigest())
