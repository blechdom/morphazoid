# Original experimental MIDI studies

Created for Morphazoid on 2026-10-07. These three new algorithmic studies explore independent tempi, geometric pitch shapes and controlled black-MIDI density. They are original generated examples, not Conlon Nancarrow compositions, transcriptions, or arrangements of any existing work. The tempo-canon idea answers the user's interest in player-piano experiments; the actual note sequences and structures were written for this collection.

All three MIDI files, the generation script and original documentation are offered under **CC0 1.0 Universal**. Credit, although appreciated, is not required: **Morphazoid original study**. The complete dedication is in `../licenses/CC0-1.0.txt`; its authoritative text is at https://creativecommons.org/publicdomain/zero/1.0/. The bundled copy came from SPDX's license-list-data CC0-1.0 text, preserved from the accompanying genre collection.

| Study | Duration | Musical construction |
| --- | --- | --- |
| Ratio Canon · 3:4:5 | 55 seconds | One original subject in three separate GM voices moving at exactly 3, 4 and 5 pulses per second; staggered entrances, retrograde phrases, harmonic anchors and a shared final cadence. |
| Mirror Spiral · Expanding Orbits | 56 seconds | Exact upper/lower pitch reflections around a moving center, expanding and contracting pentatonic radii, a second coprime orbit and a quiet harmonic frame. |
| Black Lattice · Ordered Storm | 55 seconds | Offset rows of diatonic clusters produce opposing diagonals through five density sections; short gates and low velocities keep the dense score controlled. |

Copy `generate.py` into an empty working directory and run `python3 generate.py` to reproduce the MIDI bytes and this subset’s metadata. The published collection merges that metadata with the other songs and adjusts source links. The generator uses only Python's standard library, with no randomness, sampled audio or copied musical material. Format 1 SMF, 960 PPQN, fixed 120 BPM, explicit GM programs, separate channels, track names, section markers and paired note-on/note-off events are included. No percussion channel, sustain pedal, external synthesizer commands or SysEx are required.

The generator checks all pitches/velocities, matching note releases, absence of overlapping same-key notes on one channel, total duration, a maximum rolling one-second density of 500 note-ons, score polyphony at most 128, and file size below 1 MB. Actual statistics and SHA-256 hashes appear in `collection.json`. Score polyphony counts MIDI gates; a SoundFont can continue sounding release tails after note-off. Morphazoid's player separately caps synthesizer voices at 128.

Use `genre: "Experimental"`, retain `demo: true`, and display the original-study credit so these examples cannot be mistaken for recordings or works by an existing composer. The published source link points here; the reproducible source is the adjacent `generate.py`.
