#!/usr/bin/env python3
"""Generate three original studies, deterministically; Python 3 standard library.

Run from any directory: python3 generate.py
Scores, generation code, and original text are offered under CC0-1.0.
These are new algorithmic studies, not arrangements of existing compositions.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
import json
import math
import struct

HERE = Path(__file__).resolve().parent
PPQN = 960
TICKS_PER_SECOND = PPQN * 2  # Constant 120 BPM.


def tick(seconds: float) -> int:
    return round(seconds * TICKS_PER_SECOND)


def vlq(value: int) -> bytes:
    assert 0 <= value <= 0x0FFFFFFF
    result = [value & 127]
    while value >> 7:
        value >>= 7
        result.insert(0, 128 | (value & 127))
    return bytes(result)


def meta(kind: int, text: str) -> bytes:
    encoded = text.encode('utf-8')
    return bytes([255, kind]) + vlq(len(encoded)) + encoded


@dataclass
class Part:
    channel: int
    name: str
    program: int
    pan: int = 64
    volume: int = 92
    events: list = field(default_factory=list)
    notes: list = field(default_factory=list)

    def add(self, start: float, pitch: int, length: float, velocity: int):
        begin, end = tick(start), tick(start + length)
        assert 0 <= pitch <= 127 and 1 <= velocity <= 127 and end > begin >= 0
        self.notes.append((begin, end, self.channel, pitch, velocity))
        self.events.extend([(begin, 2, bytes([0x90 | self.channel, pitch, velocity])),
                            (end, 1, bytes([0x80 | self.channel, pitch, 0]))])

    def bytes(self, duration: float) -> bytes:
        ch = self.channel
        # Distinct channels, explicit GM programs, no sustain; short reverb tails.
        events = [(0, 0, meta(3, self.name)),
                  (0, 0, bytes([0xC0 | ch, self.program]))]
        for controller, value in [(0, 0), (32, 0), (7, self.volume), (10, self.pan),
                                  (11, 127), (64, 0), (91, 12), (93, 0)]:
            events.append((0, 0, bytes([0xB0 | ch, controller, value])))
        events.extend(self.events)
        events.append((tick(duration), 3, bytes([0xB0 | ch, 123, 0])))
        return track(events, duration)


def track(events: list, duration: float) -> bytes:
    data, previous = bytearray(), 0
    # Stable priority puts note-off before note-on when boundaries coincide.
    for when, priority, payload in sorted(events, key=lambda item: (item[0], item[1])):
        assert previous <= when <= tick(duration)
        data += vlq(when - previous) + payload
        previous = when
    data += vlq(tick(duration) - previous) + b'\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + data


def audit(parts: list[Part], duration: float) -> dict:
    notes = sorted(note for part in parts for note in part.notes)
    edges = []
    recent = deque()
    maximum_rate = 0
    for begin, end, channel, pitch, velocity in notes:
        assert end <= tick(duration)
        while recent and recent[0] <= begin - TICKS_PER_SECOND:
            recent.popleft()
        recent.append(begin)
        maximum_rate = max(maximum_rate, len(recent))
        edges.extend([(begin, 1, channel, pitch), (end, -1, channel, pitch)])
    active = set()
    maximum_polyphony = 0
    for when, direction, channel, pitch in sorted(edges):
        key = channel, pitch
        if direction < 0:
            assert key in active, f'Unpaired note-off {key} at {when}'
            active.remove(key)
        else:
            assert key not in active, f'Overlapping repeated note {key} at {when}'
            active.add(key)
            maximum_polyphony = max(maximum_polyphony, len(active))
    assert not active
    assert maximum_rate <= 500
    assert maximum_polyphony <= 128
    return dict(noteOnCount=len(notes), noteEventCount=2 * len(notes),
                maximumNoteOnsPerSecond=maximum_rate,
                maximumScorePolyphony=maximum_polyphony, danglingNotes=0,
                channelCount=len(parts))


def write_score(identifier: str, title: str, duration: float, description: str,
                parts: list[Part], markers: list, extra: dict | None = None) -> dict:
    statistics = audit(parts, duration)
    conductor = [(0, 0, meta(3, title)),
                 (0, 0, meta(2, 'Morphazoid original algorithmic study; CC0-1.0')),
                 (0, 0, meta(1, description)),
                 (0, 0, b'\xff\x51\x03\x07\xa1\x20'),
                 (0, 0, b'\xff\x58\x04\x04\x02\x18\x08')]
    conductor += [(tick(time), 0, meta(6, text)) for time, text in markers]
    data = b'MThd' + struct.pack('>IHHH', 6, 1, len(parts) + 1, PPQN)
    data += track(conductor, duration)
    data += b''.join(part.bytes(duration) for part in parts)
    assert len(data) < 1_000_000
    target = HERE / 'midi' / f'{identifier}.mid'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return dict(id=identifier, title=title, composer='Morphazoid original study',
                genre='Experimental', demo=True, file=f'midi/{identifier}.mid',
                durationSeconds=duration, description=description,
                attribution=f'{title}: original algorithmic study generated for Morphazoid, 2026. CC0 1.0. Not a transcription or arrangement of any existing work.',
                origin='Original generated algorithmic study',
                sourceUrl='generate.py', license='CC0-1.0',
                licenseName='Creative Commons Zero 1.0 Universal',
                licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',
                sha256=sha256(data).hexdigest(), bytes=len(data),
                statistics=statistics, **(extra or {}))


def canon() -> dict:
    parts = [Part(0, 'Canon I - 3 pulses per second', 0, 36),
             Part(1, 'Canon II - 4 pulses per second', 12, 64),
             Part(2, 'Canon III - 5 pulses per second', 1, 92),
             Part(3, 'Sparse harmonic anchors', 32, 64, 80)]
    subject = [0, 2, 7, 5, 3, 2, -2, 0, 7, 10, 9, 5,
               3, 2, 0, -5, 0, 7, 12, 10, 7, 3, 2, 0]
    roots = [0, 0, 5, 5, 2, 7, 0]
    for voice, (rate, entry, base) in enumerate([(3, 0, 48), (4, 2, 60), (5, 4, 72)]):
        index = 0
        while (time := entry + index / rate) < 51.65:
            # Every voice plays the same ordered subject on its own exact grid.
            phrase_index = index % len(subject)
            root = roots[min(len(roots) - 1, int(time // 8))]
            phrase = index // len(subject)
            contour = subject[phrase_index]
            if phrase % 4 == 2:
                contour = subject[-1 - phrase_index]
            accent = 8 if phrase_index in (0, 8, 16) else 0
            swell = 7 * math.sin(math.pi * min(time / 52, 1))
            velocity = round(55 + accent + swell - voice * 6)
            gate = 0.72 if phrase_index % 6 else 0.9
            parts[voice].add(time, base + root + contour, gate / rate, velocity)
            index += 1
    for time in range(0, 48, 4):
        root = roots[time // 8]
        parts[3].add(time, 36 + root, 1.45, 48)
        parts[3].add(time + 2.2, 43 + root, 0.6, 35)
    for voice, pitches in enumerate([[48, 55, 60], [60, 67, 72], [72, 79, 84]]):
        for index, pitch in enumerate(pitches):
            parts[voice].add(52 + index * 0.09, pitch, 2.35 - index * 0.09, 48 - voice * 5)
    return write_score('ratio-canon-345', 'Ratio Canon · 3:4:5', 55,
        'Three independent voices carry a common subject at exactly 3, 4 and 5 pulses per second; staggered entrances, retrograde phrases and shifting harmonic anchors resolve into one cadence.',
        parts, [(0, 'Three against four against five'), (2, 'Voice II enters'),
                (4, 'Voice III enters'), (16, 'Harmonic drift'), (32, 'Return through contrary phrases'),
                (52, 'Convergence')], dict(techniques=['3:4:5 tempo canon', 'retrograde', 'phase alignment']))


def mirror() -> dict:
    parts = [Part(0, 'Upper mirror - piano', 0, 34),
             Part(1, 'Lower mirror - marimba', 12, 94),
             Part(2, 'Orbiting spiral - electric piano', 4, 64, 78),
             Part(3, 'Harmonic frame - warm pad', 89, 64, 62)]
    radii = [0, 2, 5, 7, 10, 12, 14, 17, 19, 22, 24, 26, 29]
    centers = [60, 62, 65, 67, 65, 62, 60]
    for index in range(424):
        time = index / 8
        section = min(6, int(time // 8))
        center = centers[section]
        span = [5, 8, 11, 13, 11, 8, 6][section]
        phase = index % (2 * span - 2)
        radius = radii[phase if phase < span else 2 * span - 2 - phase]
        accent = 9 if index % 8 == 0 else 0
        parts[0].add(time, center + radius, 0.095, 51 + accent)
        parts[1].add(time + 0.025, center - radius, 0.092, 43 + accent)
        if index % 2 == 1:
            # Coprime stepping rotates a second orbit against the mirrored line.
            orbit = radii[(index * 5 // 2) % span]
            parts[2].add(time + 0.0625, center + 12 + orbit % 24, 0.15, 36 + index % 7)
    for section, center in enumerate(centers):
        time = section * 8
        for pitch in (center - 24, center - 17, center - 10):
            parts[3].add(time, pitch, 5.5 if section < 6 else 4.4, 38)
    for index, radius in enumerate(reversed(radii[:6])):
        time = 53 + index * 0.24
        for part, sign in [(parts[0], 1), (parts[1], -1)]:
            part.add(time, 60 + sign * radius, 0.21, 50 - index * 4)
    parts[2].add(54.6, 72, 0.8, 32)
    return write_score('mirror-spiral', 'Mirror Spiral · Expanding Orbits', 56,
        'Piano and marimba trace exact pitch reflections around a moving center, widening into nested pentatonic spirals before folding inward. A slower electric-piano orbit turns against the mirror.',
        parts, [(0, 'Small orbit'), (8, 'Expansion'), (16, 'Nested spirals'),
                (24, 'Widest mirror'), (40, 'Fold inward'), (53, 'Collapse to center')],
        dict(techniques=['pitch reflection', 'expanding spiral', 'coprime orbit']))


def lattice() -> dict:
    parts = [Part(channel, f'Lattice row {channel + 1}', [0, 1, 4, 12][channel % 4],
                  26 + channel * 11, 76) for channel in range(8)]
    # Eight offset rows make the roll dense while keeping simultaneous notes small.
    sections = [(0, 8, 4, 3, 0.12), (8, 20, 6, 4, 0.105),
                (20, 32, 4, 3, 0.12), (32, 48, 8, 4, 0.115),
                (48, 54, 5, 3, 0.14)]
    scale = [0, 2, 3, 5, 7, 8, 10]
    for section, (begin, end, row_count, width, step) in enumerate(sections):
        index = 0
        while (time := begin + index * step) < end - 0.09:
            root = [0, 5, 0, 7, 0][section]
            for row in range(row_count):
                direction = 1 if row % 2 == 0 else -1
                angle = (direction * index + row * 3) % 16
                triangle = angle if angle < 8 else 15 - angle
                degree = 6 + row * 3 + triangle
                offset = row * 0.006
                for column in range(width):
                    d = degree + column * 2
                    pitch = 36 + root + 12 * (d // 7) + scale[d % 7]
                    accent = 6 if index % 8 == 0 and column == 0 else 0
                    # Low velocities and short gates preserve headroom at the peak.
                    velocity = 22 + row % 3 * 2 + column * 2 + accent
                    parts[row].add(time + offset, pitch, 0.045 + row * 0.003, velocity)
            index += 1
    for row, part in enumerate(parts):
        for column in range(3):
            pitch = 48 + row * 5 + [0, 7, 12][column]
            part.add(54.15 + row * 0.045, pitch, 0.5, 27 - row)
    result = write_score('black-lattice', 'Black Lattice · Ordered Storm', 55,
        'Nearly ten thousand short notes form opposing diagonal lattices: a sparse seed, six-row weave, open corridor, eight-row storm and dissolving cadence. Density is bounded and every note has its own release.',
        parts, [(0, 'Seed lattice'), (8, 'Six-row weave'), (20, 'Open corridor'),
                (32, 'Eight-row storm'), (48, 'Dissolve'), (54.15, 'Last diagonal')],
        dict(techniques=['black MIDI', 'diagonal note lattice', 'contrary motion']))
    assert 8000 <= result['statistics']['noteOnCount'] <= 20000
    return result


def main():
    collection = [canon(), mirror(), lattice()]
    (HERE / 'collection.json').write_text(json.dumps(collection, indent=2, ensure_ascii=False) + '\n')
    for item in collection:
        print(item['file'], item['bytes'], item['statistics'])


if __name__ == '__main__':
    main()
