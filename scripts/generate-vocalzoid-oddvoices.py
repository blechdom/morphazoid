#!/usr/bin/env python3
"""Build tiny, reproducible Vocalzoid demo sprites from CC0 OddVoices data.

Only eight labelled units needed by the default word are fetched with HTTP
byte-range requests. The original multi-hundred-megabyte recordings are never
downloaded in full. The generated sprites remain derived from the CC0-marked
voice data; see vendor/oddvoices/LICENSE and THIRD_PARTY_NOTICES.md.
"""

from __future__ import annotations

import argparse
import array
import json
import math
import struct
import sys
import urllib.request
import wave
from pathlib import Path


SAMPLE_RATE = 48_000
BYTES_PER_FRAME = 2
WAV_DATA_OFFSET = 44
SILENCE_SECONDS = 0.022
SUSTAIN_SECONDS = 0.38
TRANSITION_PADDING = 0.012
FADE_SECONDS = 0.005
UNITS = ("voU", "oU", "k@", "@", "@l", "z_", "OI", "OId")
SUSTAINS = frozenset(("oU", "@", "OI"))
VOICES = {
    "air": {"root_midi": 62, "description": "soft / breathy alto"},
    "cicada": {"root_midi": 55, "description": "bright / buzzy baritone"},
    "quake": {"root_midi": 44, "description": "deep / dark bass"},
}
ODDVOICES_REVISION = "33a248af8df88edf5166593bf36b7e24e7bc1f94"
RAW_ROOT = f"https://gitlab.com/oddvoices/oddvoices/-/raw/{ODDVOICES_REVISION}/voices"


def fetch(url: str, byte_range: tuple[int, int] | None = None) -> bytes:
    headers = {"User-Agent": "Morphazoid-Vocalzoid-bank-builder/1.0"}
    if byte_range:
        headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        expected = None if not byte_range else byte_range[1] - byte_range[0] + 1
        payload = response.read(None if expected is None else expected + 1)
    if expected is not None and len(payload) != expected:
        raise RuntimeError(f"Range request returned {len(payload)} bytes; expected {expected}")
    return payload


def parse_labels(value: str) -> dict[str, tuple[float, float]]:
    labels: dict[str, tuple[float, float]] = {}
    for line in value.splitlines():
        fields = line.strip().split("\t")
        if len(fields) != 3 or fields[2] in labels:
            continue
        labels[fields[2]] = (float(fields[0]), float(fields[1]))
    return labels


def closest_rising_zero(samples: array.array, target: int, radius: int) -> int:
    start = max(1, target - radius)
    end = min(len(samples) - 1, target + radius)
    candidates = [index for index in range(start, end) if samples[index - 1] <= 0 < samples[index]]
    return min(candidates, key=lambda index: abs(index - target)) if candidates else target


def normalize_and_fade(samples: array.array) -> None:
    if not samples:
        return
    mean = sum(samples) / len(samples)
    centered = [sample - mean for sample in samples]
    peak = max(1.0, max(abs(sample) for sample in centered))
    scale = min(2.4, 25_500 / peak)
    fade_frames = min(len(samples) // 3, round(FADE_SECONDS * SAMPLE_RATE))
    for index, sample in enumerate(centered):
        edge = 1.0
        if index < fade_frames:
            edge = math.sin(index / max(1, fade_frames - 1) * math.pi * 0.5)
        elif index >= len(samples) - fade_frames:
            edge = math.sin((len(samples) - 1 - index) / max(1, fade_frames - 1) * math.pi * 0.5)
        samples[index] = round(max(-32_768, min(32_767, sample * scale * edge)))


def select_interval(label: str, start: float, end: float) -> tuple[float, float]:
    if label in SUSTAINS:
        center = start + (end - start) * 0.58
        half = SUSTAIN_SECONDS * 0.5
        return max(start, center - half), min(end, center + half)
    return max(0, start - TRANSITION_PADDING), end + TRANSITION_PADDING


def pcm_range(url: str, start: float, end: float) -> array.array:
    first_frame = max(0, math.floor(start * SAMPLE_RATE))
    final_frame = max(first_frame + 1, math.ceil(end * SAMPLE_RATE))
    first_byte = WAV_DATA_OFFSET + first_frame * BYTES_PER_FRAME
    final_byte = WAV_DATA_OFFSET + final_frame * BYTES_PER_FRAME - 1
    payload = fetch(url, (first_byte, final_byte))
    samples = array.array("h")
    samples.frombytes(payload)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def build_voice(name: str, output_directory: Path) -> dict:
    voice_root = f"{RAW_ROOT}/{name}"
    labels = parse_labels(fetch(f"{voice_root}/labels.txt").decode("utf-8"))
    missing = [label for label in UNITS if label not in labels]
    if missing:
        raise RuntimeError(f"{name}: missing labels {', '.join(missing)}")

    silence = array.array("h", [0]) * round(SILENCE_SECONDS * SAMPLE_RATE)
    sprite = array.array("h")
    clips: dict[str, dict] = {}
    for label in UNITS:
        start, end = select_interval(label, *labels[label])
        samples = pcm_range(f"{voice_root}/audio.wav?inline=false", start, end)
        normalize_and_fade(samples)
        sprite.extend(silence)
        offset = len(sprite) / SAMPLE_RATE
        loop_start = 0.0
        loop_end = 0.0
        if label in SUSTAINS and len(samples) > round(0.14 * SAMPLE_RATE):
            nominal_start = round(len(samples) * 0.24)
            nominal_end = round(len(samples) * 0.76)
            radius = round(0.018 * SAMPLE_RATE)
            loop_start_frame = closest_rising_zero(samples, nominal_start, radius)
            loop_end_frame = closest_rising_zero(samples, nominal_end, radius)
            if loop_end_frame - loop_start_frame > round(0.08 * SAMPLE_RATE):
                loop_start = loop_start_frame / SAMPLE_RATE
                loop_end = loop_end_frame / SAMPLE_RATE
        sprite.extend(samples)
        clips[label] = {
            "offset": round(offset, 6),
            "duration": round(len(samples) / SAMPLE_RATE, 6),
            "loopStart": round(loop_start, 6),
            "loopEnd": round(loop_end, 6),
        }

    output_directory.mkdir(parents=True, exist_ok=True)
    output_path = output_directory / f"vocalzoid-oddvoices-{name}.wav"
    with wave.open(str(output_path), "wb") as destination:
        destination.setnchannels(1)
        destination.setsampwidth(2)
        destination.setframerate(SAMPLE_RATE)
        destination.writeframes(sprite.tobytes())
    return {
        "id": name,
        "name": f"OddVoices · {name.title()}",
        "description": VOICES[name]["description"],
        "rootMidi": VOICES[name]["root_midi"],
        "url": f"../assets/audio/{output_path.name}",
        "clips": clips,
        "bytes": output_path.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/audio"),
        help="Output directory for the three WAV sprites",
    )
    arguments = parser.parse_args()
    manifests = [build_voice(name, arguments.output) for name in VOICES]
    print(json.dumps(manifests, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
