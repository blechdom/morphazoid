#!/usr/bin/env python3
"""Create five original General MIDI genre sketches, using only Python stdlib.

No transcription, samples, existing song data, or named artist emulation is used.
The notes, arrangement, and deterministic performance variation originate here.
CC0-1.0: to the extent copyright applies, dedicated to the public domain.
"""

from collections import Counter
import hashlib
import json
from pathlib import Path
import random
import struct

ROOT = Path(__file__).resolve().parent
PPQ = 480


def vlq(value):
    assert 0 <= value <= 0x0fffffff
    result = [value & 127]
    while value >> 7:
        value >>= 7
        result.insert(0, (value & 127) | 128)
    return bytes(result)


def meta(kind, data):
    return bytes([255, kind]) + vlq(len(data)) + data


class Track:
    def __init__(self, name, channel=None, program=None, volume=90, pan=64):
        self.channel = channel
        self.events = [(0, -10, meta(3, name.encode('utf-8')))]
        self.notes = []
        if channel is not None:
            self.cc(0, 121, 0)
            if program is not None:
                self.events.append((0, -8, bytes([0xc0 | channel, program])))
            for controller, value in [(7, volume), (10, pan), (11, 110), (91, 25), (93, 0)]:
                self.cc(0, controller, value)

    def cc(self, beat, controller, value):
        self.events.append((round(beat * PPQ), -9, bytes([0xb0 | self.channel, controller, value])))

    def note(self, beat, pitch, duration, velocity):
        assert beat >= 0 and duration > 0 and 0 <= pitch <= 127 and 1 <= velocity <= 127
        self.notes.append((round(beat * PPQ), round((beat + duration) * PPQ), pitch, velocity))

    def chord(self, beat, pitches, duration, velocity, strum=0):
        for index, pitch in enumerate(pitches):
            self.note(beat + index * strum, pitch, duration, max(1, velocity - index * 2))

    def serialize(self, end):
        notes = self.notes
        if self.channel == 9:
            # A fill and backbeat can request the same drum hit; merge those
            # intervals so every key has exactly one matching note-off.
            merged = []
            for pitch in sorted({n[2] for n in notes}):
                for start, stop, _, velocity in sorted(n for n in notes if n[2] == pitch):
                    if merged and merged[-1][2] == pitch and start < merged[-1][1]:
                        a, b, p, v = merged[-1]
                        merged[-1] = (a, max(b, stop), p, max(v, velocity))
                    else:
                        merged.append((start, stop, pitch, velocity))
            notes = merged
        for start, stop, pitch, velocity in notes:
            self.events.append((start, 1, bytes([0x90 | self.channel, pitch, velocity])))
            self.events.append((stop, 0, bytes([0x80 | self.channel, pitch, 0])))
        if self.channel is not None:
            for cc in (64, 123, 120):
                self.cc(end, cc, 0)
        self.events.append((round(end * PPQ), 10, meta(47, b'')))
        output, tick = bytearray(), 0
        for at, _, data in sorted(self.events, key=lambda e: (e[0], e[1])):
            assert at >= tick and at <= round(end * PPQ)
            output.extend(vlq(at - tick)); output.extend(data); tick = at
        return b'MTrk' + struct.pack('>I', len(output)) + output


class Song:
    def __init__(self, slug, title, genre, bpm, bars, description):
        self.slug, self.title, self.genre = slug, title, genre
        self.bpm, self.bars, self.description = bpm, bars, description
        self.tracks = [Track(title)]
        self.rng = random.Random(slug)
        conductor = self.tracks[0]
        conductor.events += [
            (0, -8, meta(81, round(60_000_000 / bpm).to_bytes(3, 'big'))),
            (0, -8, meta(88, bytes([4, 2, 24, 8]))),
            (0, -8, meta(2, b'Original generated demonstration for Morphazoid. CC0-1.0.')),
        ]

    def track(self, name, channel, program, volume=90, pan=64):
        result = Track(name, channel, program, volume, pan)
        self.tracks.append(result)
        return result

    def section(self, bar, title):
        self.tracks[0].events.append((bar * 4 * PPQ, -1, meta(6, title.encode('utf-8'))))

    def v(self, velocity, variation=5):
        return max(1, min(112, velocity + self.rng.randint(-variation, variation)))

    def save(self):
        end = self.bars * 4 + 2
        binary = b'MThd' + struct.pack('>IHHH', 6, 1, len(self.tracks), PPQ)
        binary += b''.join(t.serialize(end) for t in self.tracks)
        path = ROOT / 'midi' / f'{self.slug}.mid'
        path.write_bytes(binary)
        info = inspect(binary)
        return {
            'id': self.slug, 'title': self.title, 'genre': self.genre,
            'collection': 'Original genre demos', 'composer': 'Morphazoid original demo',
            'file': f'midi/{self.slug}.mid',
            'sourceUrl': 'genre-demos/generate.py',
            'license': 'CC0-1.0', 'licenseName': 'Creative Commons CC0 1.0 Universal',
            'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
            'attribution': 'Original generated demonstration for Morphazoid; composed and arranged in generate.py. Not a recording, transcription, or performance by an existing artist. Dedicated under CC0-1.0 to the extent copyright applies.',
            'description': self.description, 'bpm': self.bpm, 'bars': self.bars,
            'sha256': hashlib.sha256(binary).hexdigest(), 'bytes': len(binary), **info,
        }


def rock():
    s = Song('neon-jukebox', 'Neon Jukebox', 'Rock & roll', 124, 24,
             'Two bright 12-bar choruses: shuffled boogie bass, guitar sixths, piano punches, sax replies and a backbeat.')
    piano = s.track('Barroom piano', 0, 0, 77, 44)
    guitar = s.track('Clean electric rhythm', 1, 27, 78, 84)
    bass = s.track('Fingered electric bass', 2, 33, 93, 64)
    sax = s.track('Tenor sax melody', 3, 66, 76, 57)
    organ = s.track('Second chorus organ', 4, 16, 66, 78)
    drums = s.track('Shuffle drum kit', 9, 0, 88, 64)
    for bar, name in [(0, 'Boogie pickup'), (2, 'First chorus'), (12, 'Organ joins / second chorus'), (20, 'Turnaround'), (23, 'Closing hit')]:
        s.section(bar, name)
    progression = [40, 40, 40, 40, 45, 45, 40, 40, 47, 45, 40, 47]
    lead_phrases = [
        [(0, 7, .4), (.67, 9, .24), (1, 12, .54), (1.67, 9, .23), (2.67, 7, .25), (3, 4, .55)],
        [(.67, 3, .23), (1, 4, .5), (1.67, 7, .23), (2, 9, .55), (2.67, 7, .23), (3, 4, .8)],
        [(0, 12, .6), (1, 10, .5), (1.67, 9, .23), (2, 7, .55), (2.67, 4, .23), (3, 3, .23), (3.33, 4, .4)],
        [(0, 7, .85), (1.67, 4, .23), (2, 0, 1.55)],
    ]
    for bar in range(24):
        t, root = bar * 4, progression[bar % 12]
        if bar == 23:
            root = 40
            bass.note(t, root, 2.5, 88)
            guitar.chord(t, [root + 12, root + 19, root + 24], 1.8, 82, .012)
            piano.chord(t, [root + 16, root + 22, root + 28], 2.1, 79)
            sax.note(t, 76, 1.9, 80)
            organ.chord(t, [64, 67, 71], 2.0, 57)
            for pitch, vel in [(36, 96), (38, 82), (49, 76)]: drums.note(t, pitch, .16, vel)
            continue
        for beat, interval in zip([0, .67, 1, 1.67, 2, 2.67, 3, 3.67], [0, 4, 7, 9, 10, 9, 7, 4]):
            bass.note(t + beat, root + interval, .26 if beat % 1 else .51, s.v(78 if beat % 1 else 89))
        for beat in range(4):
            guitar.chord(t + beat, [root + 12, root + (19 if beat % 2 == 0 else 21)], .39, s.v(72), .006)
            drums.note(t + beat, 42, .10, s.v(66))
            drums.note(t + beat + 2/3, 42, .08, s.v(45))
        for beat in (1, 3):
            drums.note(t + beat, 38, .14, s.v(91))
            piano.chord(t + beat + .025, [root + 16, root + 22, root + 28], .32, s.v(78), .006)
        for beat in (0, 2, 2.67 if bar % 2 else 3.67): drums.note(t + beat, 36, .12, s.v(90))
        if bar >= 2:
            for at, interval, duration in lead_phrases[bar % 4]:
                sax.note(t + at, root + 24 + interval, duration, s.v(78 if bar < 12 else 84))
        if bar >= 12:
            organ.chord(t + .67, [root + 16, root + 19, root + 22], 1.1, s.v(51))
            organ.chord(t + 2.67, [root + 16, root + 21, root + 24], .8, s.v(55))
        if bar % 4 == 3:
            for i, pitch in enumerate((38, 48, 45, 43)):
                drums.note(t + 3 + i / 4, pitch, .10, s.v(64 + i * 5))
        if bar in (0, 4, 8, 12, 16, 20): drums.note(t, 49, .18, s.v(66))
    return s


def jazz():
    s = Song('after-hours-window', 'After-hours Window', 'Jazz', 116, 24,
             'A small swing ensemble: walking upright bass, loose piano comping, ride cymbal, vibraphone color and an alto melody.')
    piano = s.track('Piano comping', 0, 0, 82, 45)
    bass = s.track('Walking upright', 1, 32, 100, 66)
    alto = s.track('Alto melody', 2, 65, 77, 58)
    vibes = s.track('Vibraphone replies', 3, 11, 71, 86)
    drums = s.track('Light swing kit', 9, 0, 72, 64)
    # Bass root, piano voicing intervals, melodic chord color; all original phrases.
    progression = [
        (38, [15, 19, 22, 26], [0, 2, 3, 7, 9, 10]),
        (43, [10, 16, 21, 26], [0, 2, 4, 7, 9, 10]),
        (36, [16, 19, 23, 26], [0, 2, 4, 7, 9, 11]),
        (45, [10, 16, 19, 25], [0, 1, 4, 7, 10]),
    ] * 3 + [
        (41, [16, 19, 23, 26], [0, 2, 4, 7, 9, 11]),
        (41, [15, 19, 21, 26], [0, 2, 3, 7, 9]),
        (40, [15, 19, 22, 26], [0, 2, 3, 7, 10]),
        (45, [10, 16, 19, 25], [0, 1, 4, 7, 10]),
    ] + [
        (38, [15, 19, 22, 26], [0, 2, 3, 7, 9, 10]),
        (43, [10, 16, 21, 26], [0, 2, 4, 7, 9, 10]),
        (36, [16, 19, 23, 26], [0, 2, 4, 7, 9, 11]),
        (45, [10, 16, 19, 25], [0, 1, 4, 7, 10]),
        (38, [15, 19, 22, 26], [0, 2, 3, 7, 9, 10]),
        (43, [10, 16, 21, 26], [0, 2, 4, 7, 9, 10]),
        (36, [16, 19, 23, 26], [0, 2, 4, 7, 9, 11]),
        (36, [16, 21, 26, 31], [0, 2, 4, 7, 9, 11]),
    ]
    for bar, name in [(0, 'Head'), (8, 'Vibraphone answer'), (12, 'Middle eight'), (20, 'Last cadence')]: s.section(bar, name)
    for bar, (root, voicing, scale) in enumerate(progression):
        t = bar * 4
        nextroot = progression[min(bar + 1, 23)][0]
        if bar == 23:
            bass.note(t, root, 2.7, 82)
            piano.chord(t + .03, [root + n for n in voicing], 2.6, 69, .013)
            alto.note(t + .05, 76, 2.25, 70)
            vibes.chord(t + .67, [72, 79, 86], 1.6, 48, .025)
            drums.note(t, 51, .25, 59)
            continue
        walk = [root, root + (3 if 15 in voicing else 4), root + 7, nextroot - 1]
        for beat, pitch in enumerate(walk): bass.note(t + beat, pitch, .88, s.v(83, 4))
        rhythm = [(.67, .44), (2, .55), (3.67, .24)] if bar % 2 == 0 else [(1, .6), (2.67, .85)]
        for beat, duration in rhythm:
            piano.chord(t + beat + s.rng.uniform(0, .018), [root + n for n in voicing], duration, s.v(58, 7), .007)
        for beat in (0, 1, 1.67, 2, 3, 3.67): drums.note(t + beat, 51, .1, s.v(55 if beat % 1 == 0 else 37))
        for beat in (1, 3): drums.note(t + beat, 44, .1, s.v(45))
        for beat in (0, 2): drums.note(t + beat, 36, .1, s.v(44))
        for beat in (.67, 2.67):
            if bar % 3 != 0: drums.note(t + beat, 38, .08, s.v(31))
        indices = [2, 3, 4, 3, 1, 2] if bar % 2 == 0 else [4, 3, 2, 1, 0]
        timings = [(.0, .48), (.67, .24), (1, .55), (1.67, .24), (2.67, .24), (3, .75)] if bar % 2 == 0 else [(.67, .23), (1, .55), (1.67, .24), (2, .8), (3.33, .5)]
        for i, (beat, duration) in enumerate(timings):
            pitch = root + 24 + scale[indices[i] % len(scale)]
            while pitch < 64: pitch += 12
            while pitch > 81: pitch -= 12
            target = vibes if 8 <= bar < 12 or 16 <= bar < 18 else alto
            target.note(t + beat + .018, pitch + (12 if target is vibes else 0), duration, s.v(70 if target is alto else 59, 7))
        if bar in (3, 7, 11, 15, 19, 22):
            for i in range(3): drums.note(t + 3 + i / 3, 38 if i < 2 else 45, .08, s.v(43 + 5 * i))
    return s


def pop():
    s = Song('paper-sky', 'Paper Sky', 'Pop', 116, 32,
             'A warm verse grows into a bright hook: electric piano, picked bass, clean guitar, synth melody and crisp pop drums.')
    keys = s.track('Electric piano', 0, 4, 76, 47)
    guitar = s.track('Clean guitar arpeggios', 1, 27, 75, 83)
    bass = s.track('Picked electric bass', 2, 34, 93, 64)
    lead = s.track('Pop synth melody', 3, 80, 66, 62)
    pad = s.track('Chorus warm pad', 4, 89, 58, 74)
    drums = s.track('Pop kit', 9, 0, 87, 64)
    chords = [(48, [0, 4, 7, 14]), (43, [0, 4, 7, 12]), (45, [0, 3, 7, 12]), (41, [0, 4, 7, 12])]
    hook = [
        [(0, 76, .65), (1, 79, .4), (1.5, 76, .35), (2.5, 74, .35), (3, 72, .75)],
        [(.5, 74, .35), (1, 71, .7), (2, 74, .4), (2.5, 79, .4), (3.25, 78, .5)],
        [(0, 76, .85), (1.5, 72, .4), (2, 69, .65), (3, 72, .75)],
        [(.5, 72, .35), (1, 74, .35), (1.5, 77, .35), (2, 76, .7), (3, 72, .7)],
    ]
    for bar, name in [(0, 'Intro'), (4, 'Verse'), (12, 'Lift'), (16, 'Chorus'), (24, 'Chorus variation'), (30, 'Tag')]: s.section(bar, name)
    for bar in range(32):
        t = bar * 4
        root, intervals = chords[bar % 4]
        chorus = bar >= 16
        if bar == 31:
            keys.chord(t, [60, 64, 67, 74], 2.9, 77, .012)
            pad.chord(t, [60, 64, 67], 3.2, 56)
            bass.note(t, 36, 2.8, 87)
            lead.note(t + .1, 76, 2.6, 73)
            guitar.chord(t, [60, 67, 76], 2.7, 61, .025)
            drums.note(t, 36, .16, 97); drums.note(t, 49, .2, 71)
            continue
        for beat, duration in [(0, 1.35), (1.5, .35), (2.5, .9)]:
            keys.chord(t + beat, [root + 12 + n for n in intervals], duration, s.v(61 + 8 * chorus), .008)
        for i in range(8):
            if bar < 2 and i % 2: continue
            guitar.note(t + i * .5, root + 12 + intervals[[0, 2, 1, 3, 2, 1, 2, 3][i]], .36, s.v(47 + 8 * chorus))
        if bar >= 2:
            for beat, pitch, duration in [(0, root - 12, .9), (1.5, root - 12, .4), (2, root - 5, .65), (3, root - 12, .42), (3.5, root, .38)]:
                bass.note(t + beat, pitch, duration, s.v(82))
        if chorus: pad.chord(t, [root + 12 + n for n in intervals[:3]], 3.8, s.v(50))
        if bar >= 4:
            for beat, pitch, duration in hook[bar % 4]:
                if not chorus and beat in (1.5, 2.5): continue
                lead.note(t + beat, pitch - (12 if not chorus else 0), duration, s.v(65 + 9 * chorus))
        if bar >= 2:
            for i in range(8): drums.note(t + i * .5, 42, .08, s.v(55 if i % 2 == 0 else 40))
            for beat in (0, 2, 2.75 if chorus else 3.5): drums.note(t + beat, 36, .12, s.v(91))
            if bar >= 4:
                for beat in (1, 3):
                    drums.note(t + beat, 38, .13, s.v(86))
                    if chorus: drums.note(t + beat + .012, 39, .1, s.v(49))
            if bar in (4, 12, 16, 24): drums.note(t, 49, .15, s.v(67))
            if bar % 8 == 7:
                for i, p in enumerate((38, 38, 48, 45)): drums.note(t + 3 + i / 4, p, .1, s.v(56 + i * 7))
        if 12 <= bar < 16:
            for beat in (0, 1, 2, 3): drums.note(t + beat, 54, .08, s.v(49 + (bar - 12) * 5))
    return s


def techno():
    s = Song('chrome-pulse', 'Chrome Pulse', 'Techno', 128, 32,
             'Four-on-the-floor kick, offbeat hats, syncopated synth bass and a shifting sixteenth-note sequence with a breakdown and return.')
    bass = s.track('Resonant synth bass', 0, 38, 91, 64)
    seq = s.track('Saw sequencer', 1, 81, 67, 48)
    stab = s.track('Square chord stabs', 2, 80, 54, 81)
    pad = s.track('Atmosphere', 3, 95, 51, 64)
    drums = s.track('Machine drum kit', 9, 0, 89, 64)
    for bar, name in [(0, 'Kick and pulse'), (4, 'Sequence enters'), (12, 'Open groove'), (16, 'Breakdown'), (20, 'Build'), (24, 'Return'), (30, 'Outro')]: s.section(bar, name)
    roots = [38, 38, 41, 36]
    pattern = [0, 12, 7, 10, 0, 7, 12, 3, 0, 10, 7, 15, 12, 7, 3, 10]
    for bar in range(32):
        t, root = bar * 4, roots[(bar // 2) % 4]
        breakdown = 16 <= bar < 20
        if bar == 31:
            drums.note(t, 36, .15, 99); drums.note(t, 49, .14, 55)
            bass.note(t, 38, .65, 89)
            pad.chord(t, [62, 65, 69], 2.8, 46)
            for i, n in enumerate((74, 69, 65, 62)): seq.note(t + i * .5, n, .19, 58 - i * 6)
            continue
        if not breakdown:
            for beat in range(4): drums.note(t + beat, 36, .11, s.v(100, 2))
            if bar >= 2:
                for beat in (1, 3): drums.note(t + beat, 39, .11, s.v(74, 2))
            for beat in (.5, 1.5, 2.5, 3.5): drums.note(t + beat, 46 if bar >= 12 else 42, .12, s.v(60, 3))
            if bar >= 8:
                for beat in (.25, .75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75): drums.note(t + beat, 42, .055, s.v(34, 4))
            if bar >= 4:
                for beat, interval in [(.5, 0), (1.25, 0), (1.75, 12), (2.5, 0), (3.25, 7), (3.75, 0)]:
                    bass.note(t + beat, root + interval, .18, s.v(80, 4))
        else:
            for beat in (0, 2): drums.note(t + beat, 37, .1, s.v(35))
        if 4 <= bar < 30:
            for i in range(16):
                if breakdown and i % 2: continue
                if bar < 8 and i % 4 == 3: continue
                rotate = 2 if bar >= 24 else 0
                pitch = root + 24 + pattern[(i + rotate) % 16]
                seq.note(t + i / 4, pitch, .12 if i % 4 else .18, s.v((49 if breakdown else 61) + (10 if i % 4 == 0 else 0), 3))
        if bar >= 8:
            for beat in (1.75, 3.25):
                if not breakdown: stab.chord(t + beat, [root + 24, root + 27, root + 31], .15, s.v(52))
        if bar % 2 == 0:
            pad.chord(t, [root + 24, root + 27, root + 34], 7.7, s.v(42 if not breakdown else 53))
        if 20 <= bar < 24:
            step = .5 if bar < 22 else .25
            for i in range(round(4 / step)):
                drums.note(t + i * step, 38, .075, 37 + (bar - 20) * 6 + i % 4 * 3)
        if bar in (0, 8, 12, 24): drums.note(t, 49, .15, 58)
        if bar % 8 == 7:
            for i, p in enumerate((41, 43, 45, 47)): drums.note(t + 3 + i * .25, p, .09, 57 + i * 4)
    return s


def euro():
    s = Song('electric-postcard', 'Electric Postcard', 'Euro synth pop', 124, 32,
             'Minor-key octave bass, sparkling arpeggios, wide warm pads, a singable saw lead and punchy electronic drums.')
    bass = s.track('Octave synth bass', 0, 39, 86, 64)
    arp = s.track('Glass arpeggio', 1, 10, 74, 42)
    pad = s.track('Warm synth pad', 2, 89, 66, 84)
    lead = s.track('Saw lead hook', 3, 81, 65, 61)
    accent = s.track('Square counter melody', 4, 80, 51, 77)
    drums = s.track('Electronic pop kit', 9, 0, 88, 64)
    chords = [(42, [0, 3, 7]), (38, [0, 4, 7]), (45, [0, 4, 7]), (40, [0, 4, 7])]
    # F-sharp minor, D, A, E. The lead uses two related original four-bar motifs.
    hook = [
        [(0, 73, .7), (1, 76, .4), (1.5, 78, .4), (2.5, 76, .4), (3, 73, .8)],
        [(.5, 74, .35), (1, 73, .4), (1.5, 69, .8), (3, 66, .7)],
        [(0, 69, .65), (1, 73, .4), (1.5, 76, .8), (3, 73, .65)],
        [(.5, 71, .35), (1, 76, .65), (2, 74, .4), (2.5, 71, .4), (3.5, 68, .35)],
    ]
    for bar, name in [(0, 'Arpeggio intro'), (4, 'Verse'), (12, 'Lift'), (16, 'Hook'), (24, 'Hook with counterline'), (30, 'Final postcard')]: s.section(bar, name)
    for bar in range(32):
        t, (root, triad) = bar * 4, chords[bar % 4]
        if bar == 31:
            bass.note(t, 30, 2.8, 85)
            pad.chord(t, [54, 57, 61, 66], 3.2, 59)
            lead.note(t, 78, 2.7, 77)
            arp.chord(t, [78, 81, 85], 2.8, 52, .02)
            drums.note(t, 36, .15, 98); drums.note(t, 49, .15, 69)
            continue
        for i, degree in enumerate([0, 1, 2, 1, 3, 2, 1, 2]):
            pitch = root + 24 + (triad[degree] if degree < 3 else 12)
            arp.note(t + i * .5, pitch, .29, s.v(54 if bar < 16 else 61, 4))
        pad.chord(t, [root + 12 + n for n in triad] + [root + 24], 3.8, s.v(48 if bar < 12 else 58, 3))
        if bar >= 2:
            for i in range(8): bass.note(t + i * .5, root - 12 + (12 if i % 2 else 0), .32, s.v(83 if i % 2 == 0 else 72, 3))
            for beat in range(4): drums.note(t + beat, 36, .11, s.v(95, 2))
            for beat in (1, 3):
                drums.note(t + beat, 38, .12, s.v(86, 3))
                drums.note(t + beat + .012, 39, .09, s.v(52, 2))
            for i in range(8): drums.note(t + i * .5, 46 if i % 2 and bar >= 16 else 42, .09, s.v(44 if i % 2 == 0 else 59, 3))
        if bar >= 4:
            for beat, pitch, duration in hook[bar % 4]:
                if bar < 12 and beat == 1.5: continue
                lead.note(t + beat, pitch - (12 if bar < 16 else 0), duration, s.v(63 if bar < 16 else 77, 3))
        if 12 <= bar < 16:
            for i in range(8): drums.note(t + i * .5, 54, .1, 43 + (bar - 12) * 5)
        if 24 <= bar < 30:
            for i, degree in enumerate([2, 1, 0, 1]):
                accent.note(t + .25 + i, root + 24 + triad[degree], .55, s.v(46))
        if bar in (4, 12, 16, 24): drums.note(t, 49, .18, 68)
        if bar % 8 == 7:
            for i, pitch in enumerate((38, 48, 45, 41)): drums.note(t + 3 + i * .25, pitch, .09, 54 + i * 6)
    return s


def inspect(data):
    """Independent SMF parser: verify chunks, event lengths, bounds and voice closure."""
    assert data[:4] == b'MThd'
    header_len, format_, tracks, division = struct.unpack('>IHHH', data[4:14])
    assert header_len == 6 and format_ == 1 and division == PPQ
    cursor, largest_tick, note_count, max_held = 14, 0, 0, 0
    programs, tempo, timeline = [], 500000, []
    for track_index in range(tracks):
        assert data[cursor:cursor + 4] == b'MTrk'
        length = struct.unpack('>I', data[cursor + 4:cursor + 8])[0]
        start, end, tick, active, ended = cursor + 8, cursor + 8 + length, 0, Counter(), False
        cursor = start

        def read_vlq():
            nonlocal cursor
            value = 0
            for _ in range(4):
                assert cursor < end
                byte = data[cursor]; cursor += 1
                value = (value << 7) | (byte & 127)
                if not byte & 128: return value
            raise AssertionError('Oversized VLQ')

        while cursor < end:
            tick += read_vlq()
            status = data[cursor]; cursor += 1
            assert status >= 128, 'Writer does not emit running status'
            if status == 255:
                kind = data[cursor]; cursor += 1
                size = read_vlq()
                assert cursor + size <= end
                payload = data[cursor:cursor + size]; cursor += size
                if kind == 81:
                    assert track_index == 0 and tick == 0 and size == 3
                    tempo = int.from_bytes(payload, 'big')
                if kind == 47:
                    assert size == 0 and cursor == end
                    ended = True
            else:
                kind, channel = status >> 4, status & 15
                count = 1 if kind in (12, 13) else 2
                assert 8 <= kind <= 14 and cursor + count <= end
                payload = data[cursor:cursor + count]; cursor += count
                assert all(value < 128 for value in payload)
                if kind == 9 and payload[1] > 0:
                    assert active[(channel, payload[0])] == 0, f'Overlapping same-note voice in track {track_index}'
                    active[(channel, payload[0])] += 1
                    timeline.append((tick, 1)); note_count += 1
                    max_held = max(max_held, sum(active.values()))
                elif kind == 8 or (kind == 9 and payload[1] == 0):
                    assert active[(channel, payload[0])] > 0, 'Unmatched note off'
                    active[(channel, payload[0])] -= 1
                    timeline.append((tick, -1))
                elif kind == 12:
                    programs.append({'channel': channel + 1, 'program': payload[0]})
        assert ended and not +active, 'Missing end or hanging notes'
        largest_tick = max(largest_tick, tick)
    assert cursor == len(data)
    voices = peak = 0
    for tick, change in sorted(timeline):
        voices += change; peak = max(peak, voices)
        assert voices >= 0
    assert voices == 0
    duration = largest_tick * tempo / division / 1_000_000
    assert 45 <= duration <= 75 and 300 <= note_count <= 4000 and peak <= 36
    return {'format': format_, 'tracks': tracks, 'ticksPerBeat': division,
            'noteOnCount': note_count, 'durationSeconds': round(duration, 3),
            'peakConcurrentNotes': peak, 'programChanges': programs}


if __name__ == '__main__':
    (ROOT / 'midi').mkdir(exist_ok=True)
    entries = [factory().save() for factory in (rock, jazz, pop, techno, euro)]
    (ROOT / 'collection.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
    for entry in entries:
        print(f"{entry['title']}: {entry['genre']}, {entry['durationSeconds']}s, "
              f"{entry['noteOnCount']} notes, peak {entry['peakConcurrentNotes']} voices")
