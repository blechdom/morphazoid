#!/usr/bin/env python3
"""Read Standard MIDI File structure without allocating one object per note.

Used for collection provenance; positive-velocity Note On events count as notes.
Duration follows the global tempo map. Sustain/voice-renderer tails are excluded.
Usage: python3 inspect-midi.py one.mid [two.mid ...]
"""
import bisect
import hashlib
import json
import pathlib
import struct
import sys


def inspect(path):
    data = pathlib.Path(path).read_bytes()
    if data[:4] != b'MThd':
        raise ValueError('Missing MThd')
    header_length = int.from_bytes(data[4:8], 'big')
    form, tracks, division = struct.unpack_from('>HHH', data, 8)
    if form not in (0, 1) or division & 0x8000 or not division:
        raise ValueError('Requires synchronous PPQ MIDI')
    offset = 8 + header_length
    tempos = [(0, -1, -1, 500000)]
    channel_counts = {}
    program_sets = {}
    names = []
    end_tick = note_end_tick = 0
    first_tick = None
    note_count = 0
    minimum, maximum = 127, 0
    note_tracks = 0

    def vlq(position, stop):
        value = 0
        for _ in range(4):
            if position >= stop:
                raise ValueError('Truncated VLQ')
            byte = data[position]
            position += 1
            value = (value << 7) | (byte & 127)
            if not byte & 128:
                return value, position
        raise ValueError('Oversize VLQ')

    for track in range(tracks):
        if data[offset:offset+4] != b'MTrk':
            raise ValueError(f'Missing MTrk {track}')
        length = int.from_bytes(data[offset+4:offset+8], 'big')
        position, stop = offset + 8, offset + 8 + length
        if stop > len(data):
            raise ValueError('Truncated track')
        tick = running = 0
        track_notes = 0
        while position < stop:
            delta, position = vlq(position, stop)
            tick += delta
            status = data[position]
            if status >= 128:
                position += 1
                if status < 240:
                    running = status
            else:
                status = running
            if not status:
                raise ValueError('Invalid running status')
            if status == 255:
                kind = data[position]
                position += 1
                size, position = vlq(position, stop)
                payload = data[position:position+size]
                if len(payload) != size or position + size > stop:
                    raise ValueError('Truncated meta event')
                if kind == 81 and size == 3:
                    tempos.append((tick, track, position, int.from_bytes(payload, 'big')))
                if kind in (1, 2, 3, 4) and len(names) < 64:
                    value = payload.decode('utf-8', errors='replace').strip('\x00 \n\r')
                    if value and value not in names:
                        names.append(value)
                position += size
            elif status in (240, 247):
                size, position = vlq(position, stop)
                position += size
            elif status < 240:
                kind, channel = status >> 4, status & 15
                size = 1 if kind in (12, 13) else 2
                if position + size > stop:
                    raise ValueError('Truncated channel event')
                a = data[position]
                b = data[position + 1] if size == 2 else 0
                if a > 127 or b > 127:
                    raise ValueError('Invalid MIDI data byte')
                if kind == 9 and b:
                    note_count += 1
                    track_notes += 1
                    channel_counts[channel] = channel_counts.get(channel, 0) + 1
                    minimum, maximum = min(minimum, a), max(maximum, a)
                    first_tick = tick if first_tick is None else min(first_tick, tick)
                    note_end_tick = max(note_end_tick, tick)
                elif kind in (8, 9):
                    note_end_tick = max(note_end_tick, tick)
                elif kind == 12:
                    program_sets.setdefault(channel, set()).add(a)
                position += size
            else:
                raise ValueError(f'Unsupported system status {status}')
            if position > stop:
                raise ValueError('Event crosses track boundary')
        note_tracks += bool(track_notes)
        end_tick = max(end_tick, tick)
        offset = stop
    if offset != len(data):
        raise ValueError('Trailing data')
    tempos.sort()
    tempo_ticks, tempo_seconds, tempo_values = [], [], []
    prior_tick, seconds, prior_tempo = 0, 0., 500000
    for tick, _, _, tempo in tempos:
        seconds += (tick - prior_tick) * prior_tempo / division / 1000000
        tempo_ticks.append(tick)
        tempo_seconds.append(seconds)
        tempo_values.append(tempo)
        prior_tick, prior_tempo = tick, tempo

    def at(tick):
        i = bisect.bisect_right(tempo_ticks, tick) - 1
        return round(tempo_seconds[i] + (tick-tempo_ticks[i])*tempo_values[i]/division/1000000, 6)

    return {
        'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
        'format': form, 'tracks': tracks, 'noteTracks': note_tracks,
        'ticksPerQuarter': division, 'noteOnCount': note_count,
        'channelCount': len(channel_counts), 'channelNoteCounts': channel_counts,
        'programs': {k: sorted(v) for k, v in program_sets.items()},
        'lowestNote': minimum, 'highestNote': maximum,
        'firstNoteSeconds': at(first_tick or 0),
        'durationSeconds': at(note_end_tick), 'fileDurationSeconds': at(end_tick),
        'embeddedCredits': names,
    }


if __name__ == '__main__':
    for name in sys.argv[1:]:
        print(json.dumps({'file': name, **inspect(name)}), flush=True)
