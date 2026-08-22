#!/usr/bin/env python3
"""Build compact Vocalzoid demo sprites from five CMU ARCTIC voices.

The source archives are the CMU ARCTIC 0.95 Festival voice releases.  They
contain both the original recordings and automatically aligned phone labels,
so every clip below is selected reproducibly rather than by hand-tuned times.
The archives are large; pass --archive-dir /path/to/cache to reuse downloads.

The generated WAVs are modified excerpts.  CMU permits use, copying,
modification, and licensing for any purpose; see vendor/cmu-arctic/COPYING.
"""

from __future__ import annotations

import argparse
import array
import hashlib
import io
import json
import math
import statistics
import sys
import tarfile
import urllib.request
import wave
from pathlib import Path


SILENCE_SECONDS = 0.022
TRANSITION_PADDING = 0.010
FADE_SECONDS = 0.004
RELEASE = "0.95-release"
DOWNLOAD_ROOT = "https://sourceforge.net/projects/o-milo/files/Omilo/linux/voices"

VOICES = {
    "bdl": {
        "name": "CMU ARCTIC · BDL",
        "description": "Warm North Midland US male",
        "sha256": "3c9ec89942056cb4609ea788a6a455d507f5fa3729fc5d0ffcb6ba7ae1d594c9",
        "bytes": 94_333_107,
        "pitch_range": (75.0, 180.0),
    },
    "clb": {
        "name": "CMU ARCTIC · CLB",
        "description": "Clear US female",
        "sha256": "399e49e8a3ad310e5aa1ab57b215dc4abb06013da634e09a0f800220ec19ed35",
        "bytes": 130_040_259,
        "pitch_range": (135.0, 290.0),
    },
    "jmk": {
        "name": "CMU ARCTIC · JMK",
        "description": "Resonant Ontario Canadian male",
        "sha256": "9f418da3db9dc037056990dbbb2ce6ad91b84e853ab7f9839c6db50c8ad6b411",
        "bytes": 91_729_965,
        "pitch_range": (75.0, 180.0),
    },
    "ksp": {
        "name": "CMU ARCTIC · KSP",
        "description": "Focused Indian English male",
        "sha256": "a968b063012c3efcc4a3f0e93e0eda4765df8f92426a4b06bf470eba7ab574b0",
        "bytes": 119_175_914,
        "pitch_range": (75.0, 190.0),
    },
    "slt": {
        "name": "CMU ARCTIC · SLT",
        "description": "Light North Midland US female",
        "sha256": "9fddec16fbfbfb7d4989dff0fe77ccbe31f80b07b57be49d09994aa7a67d6dba",
        "bytes": 119_914_432,
        "pitch_range": (135.0, 290.0),
    },
}

# All five speakers recorded these prompts.  The paired phone labels give the
# transitions needed for the three default Vocalzoid syllables V OW / K AH L /
# Z OY D.  Sustains deliberately use a clean vowel from the same speaker.
UNITS = {
    "voU": {"utterance": "a0244", "phones": ("v", "ow")},       # devotion
    "oU": {"utterance": "a0244", "phones": ("ow",), "occurrence": 1, "loop": True},
    "k@": {"utterance": "a0051", "phones": ("k", "ah")},       # color
    "@": {"utterance": "b0333", "phones": ("ah",), "loop": True},  # does
    "@l": {"utterance": "a0051", "phones": ("ah", "l")},
    "z_": {"utterance": "b0516", "phones": ("z",)},           # Zilla
    "OI": {"utterance": "a0099", "phones": ("oy",), "loop": True},  # joy
    "OId": {"utterance": "a0589", "phones": ("oy", "d")},    # typhoid
}


def archive_name(voice: str) -> str:
    return f"cmu_us_{voice}_arctic-{RELEASE}.tar.bz2"


def download_url(voice: str) -> str:
    filename = archive_name(voice)
    return f"{DOWNLOAD_ROOT}/{filename}/download"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def obtain_archive(voice: str, directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / archive_name(voice)
    metadata = VOICES[voice]
    if not path.exists():
        print(f"Downloading {metadata['name']} ({metadata['bytes'] / 1_000_000:.1f} MB)…", file=sys.stderr)
        request = urllib.request.Request(
            download_url(voice),
            headers={"User-Agent": "Morphazoid-Vocalzoid-bank-builder/1.0"},
        )
        temporary = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        temporary.replace(path)
    actual_size = path.stat().st_size
    if actual_size != metadata["bytes"]:
        raise RuntimeError(f"{voice}: archive has {actual_size} bytes; expected {metadata['bytes']}")
    actual_hash = sha256(path)
    if actual_hash != metadata["sha256"]:
        raise RuntimeError(f"{voice}: archive SHA-256 mismatch ({actual_hash})")
    return path


def archive_payloads(path: Path, voice: str) -> dict[str, bytes]:
    root = f"cmu_us_{voice}_arctic"
    wanted = set()
    for unit in UNITS.values():
        stem = f"arctic_{unit['utterance']}"
        wanted.add(f"{root}/lab/{stem}.lab")
        wanted.add(f"{root}/wav/{stem}.wav")
    payloads: dict[str, bytes] = {}
    # Streaming mode expands each large bzip2 archive only once.
    with path.open("rb") as source, tarfile.open(fileobj=source, mode="r|bz2") as archive:
        for member in archive:
            if member.isfile() and member.name in wanted:
                extracted = archive.extractfile(member)
                if extracted is not None:
                    payloads[member.name] = extracted.read()
    missing = wanted.difference(payloads)
    if missing:
        raise RuntimeError(f"{voice}: missing archive members: {', '.join(sorted(missing))}")
    return payloads


def parse_labels(payload: bytes) -> list[tuple[float, float, str]]:
    labels: list[tuple[float, float, str]] = []
    previous_end = 0.0
    for line in payload.decode("ascii").splitlines():
        fields = line.split()
        if len(fields) < 3 or fields[0] == "#":
            continue
        end = float(fields[0])
        labels.append((previous_end, end, fields[2]))
        previous_end = end
    return labels


def find_phone_interval(
    labels: list[tuple[float, float, str]],
    phones: tuple[str, ...],
    occurrence: int = 0,
) -> tuple[float, float]:
    matches = []
    for index in range(len(labels) - len(phones) + 1):
        if tuple(row[2] for row in labels[index:index + len(phones)]) == phones:
            matches.append((labels[index][0], labels[index + len(phones) - 1][1]))
    if occurrence < 0 or occurrence >= len(matches):
        raise RuntimeError(
            f"expected occurrence {occurrence + 1} of {' '.join(phones)}, found {len(matches)}"
        )
    return matches[occurrence]


def read_wav(payload: bytes) -> tuple[int, array.array]:
    with wave.open(io.BytesIO(payload), "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getcomptype() != "NONE":
            raise RuntimeError("expected mono, 16-bit PCM source audio")
        sample_rate = source.getframerate()
        samples = array.array("h")
        samples.frombytes(source.readframes(source.getnframes()))
    if sys.byteorder != "little":
        samples.byteswap()
    return sample_rate, samples


def normalize_and_fade(samples: array.array, sample_rate: int) -> None:
    if not samples:
        return
    mean = sum(samples) / len(samples)
    centered = [sample - mean for sample in samples]
    peak = max(1.0, max(abs(sample) for sample in centered))
    scale = min(2.5, 25_000 / peak)
    fade_frames = min(len(samples) // 4, round(FADE_SECONDS * sample_rate))
    for index, sample in enumerate(centered):
        edge = 1.0
        if index < fade_frames:
            edge = math.sin(index / max(1, fade_frames - 1) * math.pi * 0.5)
        elif index >= len(samples) - fade_frames:
            edge = math.sin((len(samples) - 1 - index) / max(1, fade_frames - 1) * math.pi * 0.5)
        samples[index] = round(max(-32_768, min(32_767, sample * scale * edge)))


def rising_crossings(samples: array.array, start: int, end: int) -> list[int]:
    return [index for index in range(max(1, start), min(len(samples), end)) if samples[index - 1] <= 0 < samples[index]]


def phase_matched_loop(samples: array.array, sample_rate: int) -> tuple[float, float]:
    """Choose similarly sloped rising-zero crossings in the middle of a vowel."""
    if len(samples) < round(0.045 * sample_rate):
        return 0.0, 0.0
    starts = rising_crossings(samples, round(len(samples) * 0.12), round(len(samples) * 0.43))
    ends = rising_crossings(samples, round(len(samples) * 0.58), round(len(samples) * 0.90))
    minimum = round(0.060 * sample_rate)
    target_start = len(samples) * 0.25
    target_end = len(samples) * 0.75
    best: tuple[float, int, int] | None = None
    peak_slope = max(1, max(abs(samples[i] - samples[i - 1]) for i in starts + ends))
    for start in starts:
        start_slope = samples[start] - samples[start - 1]
        for end in ends:
            if end - start < minimum:
                continue
            end_slope = samples[end] - samples[end - 1]
            position_error = abs(start - target_start) / len(samples) + abs(end - target_end) / len(samples)
            slope_error = abs(start_slope - end_slope) / peak_slope
            score = position_error + 0.45 * slope_error
            if best is None or score < best[0]:
                best = (score, start, end)
    if best is None:
        return 0.0, 0.0
    return best[1] / sample_rate, best[2] / sample_rate


def estimate_pitch(samples: array.array, sample_rate: int, frequency_range: tuple[float, float]) -> float | None:
    if len(samples) < round(0.035 * sample_rate):
        return None
    values = [float(value) for value in samples]
    mean = sum(values) / len(values)
    values = [value - mean for value in values]
    low, high = frequency_range
    minimum_lag = max(1, math.floor(sample_rate / high))
    maximum_lag = min(len(values) // 2, math.ceil(sample_rate / low))
    best_score = -1.0
    best_lag = 0
    for lag in range(minimum_lag, maximum_lag + 1):
        left = values[:-lag]
        right = values[lag:]
        numerator = sum(a * b for a, b in zip(left, right))
        denominator = math.sqrt(sum(a * a for a in left) * sum(b * b for b in right))
        score = numerator / denominator if denominator else -1.0
        if score > best_score:
            best_score = score
            best_lag = lag
    return sample_rate / best_lag if best_lag and best_score > 0.35 else None


def build_voice(voice: str, archive_path: Path, output_directory: Path) -> dict:
    payloads = archive_payloads(archive_path, voice)
    root = f"cmu_us_{voice}_arctic"
    silence: array.array | None = None
    sprite = array.array("h")
    clips: dict[str, dict] = {}
    pitches = []
    output_rate = None
    for alias, unit in UNITS.items():
        stem = f"arctic_{unit['utterance']}"
        labels = parse_labels(payloads[f"{root}/lab/{stem}.lab"])
        start, end = find_phone_interval(labels, unit["phones"], unit.get("occurrence", 0))
        sample_rate, source_samples = read_wav(payloads[f"{root}/wav/{stem}.wav"])
        if output_rate is None:
            output_rate = sample_rate
            silence = array.array("h", [0]) * round(SILENCE_SECONDS * sample_rate)
        elif sample_rate != output_rate:
            raise RuntimeError(f"{voice}: inconsistent source sample rates")
        padding = 0.0 if unit.get("loop") else TRANSITION_PADDING
        first = max(0, math.floor((start - padding) * sample_rate))
        final = min(len(source_samples), math.ceil((end + padding) * sample_rate))
        samples = source_samples[first:final]
        if unit.get("loop"):
            pitch = estimate_pitch(samples, sample_rate, VOICES[voice]["pitch_range"])
            if pitch:
                pitches.append(pitch)
        normalize_and_fade(samples, sample_rate)
        loop_start, loop_end = phase_matched_loop(samples, sample_rate) if unit.get("loop") else (0.0, 0.0)
        sprite.extend(silence or [])
        offset = len(sprite) / sample_rate
        sprite.extend(samples)
        clips[alias] = {
            "offset": round(offset, 6),
            "duration": round(len(samples) / sample_rate, 6),
            "loopStart": round(loop_start, 6),
            "loopEnd": round(loop_end, 6),
        }
    if output_rate is None:
        raise RuntimeError(f"{voice}: no samples generated")
    median_pitch = statistics.median(pitches) if pitches else 130.81
    root_midi = round(69 + 12 * math.log2(median_pitch / 440.0))
    output_directory.mkdir(parents=True, exist_ok=True)
    output_path = output_directory / f"vocalzoid-cmu-arctic-{voice}.wav"
    with wave.open(str(output_path), "wb") as destination:
        destination.setnchannels(1)
        destination.setsampwidth(2)
        destination.setframerate(output_rate)
        destination.writeframes(sprite.tobytes())
    metadata = VOICES[voice]
    return {
        "id": voice,
        "name": metadata["name"],
        "description": metadata["description"],
        "rootMidi": root_midi,
        "estimatedPitchHz": round(median_pitch, 2),
        "url": f"../assets/audio/{output_path.name}",
        "sourceHref": f"http://festvox.org/cmu_arctic/cmu_arctic/cmu_us_{voice}_arctic/",
        "license": "CMU ARCTIC permissive",
        "clips": clips,
        "bytes": output_path.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("assets/audio"))
    parser.add_argument(
        "--archive-dir",
        type=Path,
        default=Path("/tmp/vocalzoid-cmu-arctic"),
        help="cache containing (or receiving) the five release archives",
    )
    arguments = parser.parse_args()
    manifests = []
    for voice in VOICES:
        archive_path = obtain_archive(voice, arguments.archive_dir)
        print(f"Building {VOICES[voice]['name']}…", file=sys.stderr)
        manifests.append(build_voice(voice, archive_path, arguments.output))
    print(json.dumps(manifests, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
