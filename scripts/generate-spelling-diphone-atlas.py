#!/usr/bin/env python3
"""Build the browser sample atlas from CMU Flite's KAL16 diphone voice.

This is an offline asset tool. It writes a WAV file and prints JavaScript clip
metadata; it never opens an audio device. The system Flite libraries and the
cmu_us_kal16 voice must be installed.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import math
import struct
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path


SAMPLE_RATE = 16_000
GAP_FRAMES = round(SAMPLE_RATE * 0.018)
FADE_FRAMES = round(SAMPLE_RATE * 0.002)


@dataclass(frozen=True)
class Unit:
    key: str
    phones: tuple[str, ...]
    first: int
    last: int
    pre: float = 0.004
    post: float = 0.006
    kind: str = "consonant"
    label: str = ""
    stretch: float = 1.0


def sustained(
    key: str,
    phone: str,
    *,
    label: str | None = None,
    stretch: float = 7.0,
) -> Unit:
    return Unit(key, (phone,), 0, 0, 0.008, 0.010, "vowel", label or phone.upper(), stretch)


def glide(key: str, phone: str, *, label: str | None = None) -> Unit:
    return Unit(key, (phone,), 0, 0, 0.008, 0.010, "glide", label or phone.upper(), 4.0)


def onset(key: str, phone: str, *, label: str | None = None) -> Unit:
    return Unit(key, (phone, "ae"), 0, 0, 0.005, 0.030, "consonant", label or phone.upper())


def isolated(key: str, *phones: str, label: str | None = None) -> Unit:
    return Unit(key, tuple(phones), 0, len(phones) - 1, 0.005, 0.008, "consonant", label or " ".join(phones).upper())


UNITS = (
    sustained("a", "ae", label="AE"),
    onset("b", "b", label="B"),
    onset("c", "k", label="K"),
    onset("d", "d", label="D"),
    sustained("e", "eh", label="EH"),
    isolated("f", "f", label="F"),
    onset("g", "g", label="G"),
    onset("h", "hh", label="HH"),
    sustained("i", "ih", label="IH", stretch=12.0),
    isolated("j", "jh", label="JH"),
    onset("k", "k", label="K"),
    Unit("l", ("ae", "l", "ae"), 1, 1, 0.030, 0.030, "liquid", "L"),
    isolated("m", "m", "m", label="M"),
    isolated("n", "n", "n", label="N"),
    Unit("ng", ("ae", "ng", "ae"), 1, 1, 0.025, 0.025, "consonant", "NG"),
    sustained("o", "aa", label="AA"),
    onset("p", "p", label="P"),
    Unit("q", ("k", "w", "ae"), 0, 1, 0.005, 0.030, "cluster", "K W"),
    Unit("r", ("ae", "r", "ae"), 1, 1, 0.030, 0.030, "liquid", "R"),
    isolated("s", "s", label="S"),
    isolated("sh", "sh", label="SH"),
    onset("t", "t", label="T"),
    isolated("th", "th", label="TH"),
    isolated("dh", "dh", label="DH"),
    sustained("u", "ah", label="AH", stretch=12.0),
    isolated("v", "v", label="V"),
    onset("w", "w", label="W"),
    isolated("x", "k", "s", label="K S"),
    onset("y", "y", label="Y"),
    isolated("z", "z", label="Z"),
    isolated("ch", "ch", label="CH"),
    glide("ai", "ey", label="EY"),
    sustained("au", "ao", label="AO"),
    glide("ei", "ey", label="EY"),
    glide("oi", "oy", label="OY"),
    glide("ou", "aw", label="AW"),
    sustained("ee", "iy", label="IY"),
    sustained("oo", "uw", label="UW"),
    glide("oa", "ow", label="OW"),
    glide("ay", "ay", label="AY"),
    sustained("er", "er", label="ER"),
    sustained("uh", "uh", label="UH"),
    isolated("zh", "zh", label="ZH"),
)


class Voice(ctypes.Structure):
    _fields_ = [
        ("name", ctypes.c_void_p),
        ("features", ctypes.c_void_p),
        ("ffunctions", ctypes.c_void_p),
        ("utt_init", ctypes.c_void_p),
    ]


def library(name: str) -> ctypes.CDLL:
    resolved = ctypes.util.find_library(name)
    if not resolved:
        raise RuntimeError(f"Missing system library: {name}")
    return ctypes.CDLL(resolved, mode=ctypes.RTLD_GLOBAL)


def configure_flite():
    flite = library("flite")
    library("flite_usenglish")
    library("flite_cmulex")
    kal = library("flite_cmu_us_kal16")
    flite.flite_init()
    kal.register_cmu_us_kal16.argtypes = [ctypes.c_char_p]
    kal.register_cmu_us_kal16.restype = ctypes.c_void_p
    voice = kal.register_cmu_us_kal16(None)
    if not voice:
        raise RuntimeError("Flite could not register cmu_us_kal16")

    flite.flite_phones_to_speech.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.c_char_p]
    flite.flite_phones_to_speech.restype = ctypes.c_float
    flite.flite_synth_phones.argtypes = [ctypes.c_char_p, ctypes.c_void_p]
    flite.flite_synth_phones.restype = ctypes.c_void_p
    flite.utt_relation.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    flite.utt_relation.restype = ctypes.c_void_p
    flite.relation_head.argtypes = [ctypes.c_void_p]
    flite.relation_head.restype = ctypes.c_void_p
    flite.item_next.argtypes = [ctypes.c_void_p]
    flite.item_next.restype = ctypes.c_void_p
    flite.item_feat_string.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    flite.item_feat_string.restype = ctypes.c_char_p
    flite.item_feat_float.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    flite.item_feat_float.restype = ctypes.c_float
    flite.delete_utterance.argtypes = [ctypes.c_void_p]
    flite.flite_feat_set_float.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_float]
    features = ctypes.cast(voice, ctypes.POINTER(Voice)).contents.features
    return flite, voice, features


def segments_for(flite, voice, sequence: str):
    utterance = flite.flite_synth_phones(sequence.encode(), voice)
    relation = flite.utt_relation(utterance, b"Segment")
    item = flite.relation_head(relation)
    segments = []
    start = 0.0
    while item:
        end = float(flite.item_feat_float(item, b"end"))
        label = flite.item_feat_string(item, b"name").decode()
        segments.append((label, start, end))
        start = end
        item = flite.item_next(item)
    flite.delete_utterance(utterance)
    return segments


def read_wave(path: Path):
    with wave.open(str(path), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, SAMPLE_RATE):
            raise RuntimeError(f"Unexpected Flite WAV format: {path}")
        frames = source.readframes(source.getnframes())
    return list(struct.unpack(f"<{len(frames) // 2}h", frames))


def fade(samples: list[int]) -> list[int]:
    result = samples[:]
    amount = min(FADE_FRAMES, len(result) // 3)
    for index in range(amount):
        scale = (index + 1) / amount
        result[index] = round(result[index] * scale)
        result[-index - 1] = round(result[-index - 1] * scale)
    return result


def rms(samples: list[int]) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum((sample / 32768.0) ** 2 for sample in samples) / len(samples))


def make_unit(flite, voice, features, unit: Unit, temporary: Path):
    sequence = "pau " + " ".join(unit.phones) + " pau"
    wav_path = temporary / f"{unit.key}.wav"
    # KAL's pitch-synchronous duration model lengthens the phone without
    # resampling its formants or repeating a recorded segment boundary.
    flite.flite_feat_set_float(features, b"duration_stretch", unit.stretch)
    flite.flite_phones_to_speech(sequence.encode(), voice, str(wav_path).encode())
    samples = read_wave(wav_path)
    segments = segments_for(flite, voice, sequence)
    body = segments[1:-1]
    actual = tuple(segment[0] for segment in body)
    if actual != unit.phones:
        raise RuntimeError(f"{unit.key}: requested {unit.phones}, Flite made {actual}")
    start = max(0.0, body[unit.first][1] - unit.pre)
    end = min(len(samples) / SAMPLE_RATE, body[unit.last][2] + unit.post)
    first_frame = round(start * SAMPLE_RATE)
    final_frame = round(end * SAMPLE_RATE)
    cropped = fade(samples[first_frame:final_frame])
    level = rms(cropped)
    peak = max((abs(sample) / 32768.0 for sample in cropped), default=0.0)
    target = {
        "vowel": 0.090,
        "glide": 0.088,
        "liquid": 0.072,
        "cluster": 0.066,
        "consonant": 0.060,
    }[unit.kind]
    scale = target / max(level, 1e-6)
    if peak > 0:
        scale = min(scale, 0.92 / peak)
    scaled = [max(-32768, min(32767, round(sample * scale))) for sample in cropped]
    return scaled, 1.0, sequence


def build(output: Path):
    flite, voice, features = configure_flite()
    packed: list[int] = [0] * GAP_FRAMES
    metadata = []
    with tempfile.TemporaryDirectory(prefix="spelling-atlas-") as directory:
        temporary = Path(directory)
        for unit in UNITS:
            samples, gain, sequence = make_unit(flite, voice, features, unit, temporary)
            offset = len(packed) / SAMPLE_RATE
            packed.extend(samples)
            duration = len(samples) / SAMPLE_RATE
            metadata.append((unit, offset, duration, gain, sequence, rms(samples)))
            packed.extend([0] * GAP_FRAMES)

    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(SAMPLE_RATE)
        target.writeframes(struct.pack(f"<{len(packed)}h", *packed))

    print(f"Wrote {output} ({len(packed) / SAMPLE_RATE:.3f}s, {output.stat().st_size} bytes)")
    for unit, offset, duration, gain, sequence, level in metadata:
        print(
            f"  {unit.key}: clip({offset:.6f}, {duration:.6f}, {gain:.4f}, "
            f'"{unit.kind}", "{unit.label}"),  // {sequence}; RMS {level:.4f}'
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        default=Path("assets/audio/spelling-diphone-kal16.wav"),
    )
    args = parser.parse_args()
    build(args.output)


if __name__ == "__main__":
    main()
