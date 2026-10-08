# Original genre demonstration MIDI files

These five short compositions were generated for Morphazoid with the accompanying
Python standard-library source, `generate.py`. They contain original note sequences
and arrangements: no existing songs were transcribed, and no samples, named-artist
performances, or source MIDI files were used. They are **genre demonstrations**, not
popular-song covers or recordings by artists.

To the extent copyright applies, these MIDI files and their generation source are
dedicated to the public domain under **CC0 1.0 Universal**:
https://creativecommons.org/publicdomain/zero/1.0/

The same notice is embedded in every MIDI conductor track. No credit is required
under CC0; the collection metadata includes an attribution explaining their origin.

| Title | Genre | Duration | Arrangement |
| --- | --- | --- | --- |
| Neon Jukebox | Rock & roll | 47 seconds | Two 12-bar E blues choruses; shuffled boogie bass, clean guitar sixths, piano punches, tenor sax, second-chorus organ, strong backbeat and drum fills. |
| After-hours Window | Jazz | 51 seconds | Swing ride and light snare; walking upright bass, syncopated extended piano voicings, alto melody, vibraphone replies, a contrasting middle section and closing major-sixth color. |
| Paper Sky | Pop | 67 seconds | Electric piano and clean guitar intro; picked bass and sparse low-register verse; percussion lift into a higher melody, warm pad, clap-backed chorus and final tonic tag. |
| Chrome Pulse | Techno | 61 seconds | Four-on-the-floor kick, offbeat hats, syncopated synth bass, shifting sixteenth-note saw sequence, short chord stabs, atmospheric pad, breakdown, snare build and returning beat. |
| Electric Postcard | Euro synth pop | 63 seconds | F-sharp-minor octave bass, glassy arpeggios, warm sustained pads, low-register verse melody rising into a saw-lead hook, counterline, electronic pop drums and a final held tonic. |

## Format and reproducibility

All files use Standard MIDI File format 1, 480 ticks per quarter note, 4/4 time,
one constant tempo, a conductor track and separate named instrument tracks. General
MIDI programs are zero-based in JSON metadata. MIDI channel 10 is percussion.
Volume, pan, expression and a modest reverb send are initialized for each channel.
Performance variations use deterministic per-song seeds.

Run `python3 generate.py` in this directory to reproduce `midi/*.mid` and
`collection.json`. The generator verifies its output with a separate byte-stream
parser that checks chunk lengths, event data bounds, note-on/off pairing, absence
of overlapping notes of the same pitch on a channel, end-of-track events, duration,
aggregate polyphony and file hashes. Drum fills sharing a hit with the backbeat are
merged before serialization. Every channel ends with sustain off and all notes and
sound off; all notes also have their own explicit note-off events.

The files are 47–67 seconds long and peak at 9–14 concurrent MIDI notes. This
polyphony count measures held keys, not SoundFont release tails. Sound depends on
the loaded General MIDI SoundFont. The arrangements have been structurally
validated; their sound should additionally be checked through the browser player.

Suggested distribution layout: keep the MIDI files under `midi/`, collection
entries in the main `collection.json`, and this source, generator and CC0 notice
under `genre-demos/`. Each entry's `sourceUrl` refers to that generator location.
