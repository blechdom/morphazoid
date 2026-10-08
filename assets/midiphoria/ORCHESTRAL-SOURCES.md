# Midiphoria orchestral MIDI sources

Retrieved 2026-10-08. Nine complete orchestral score MIDIs were downloaded from the source archives below. These are full ensemble arrangements, not solo-piano reductions or preview clips. Beethoven's Eroica and Dvořák's Seventh each include all four movements. The original MIDI bytes are unchanged; only local filenames differ. Score-derived MIDI playback through the bundled General MIDI soundfont is not a live orchestra recording.

| Files | Work and preparation | Source | Terms |
| --- | --- | --- | --- |
| `midi/eroica-1.mid` through `midi/eroica-4.mid` | Beethoven, Symphony No. 3 “Eroica”; typesetting/MIDI by Jay Anderson | [Mutopia, work 1655](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1655) | CC BY-SA 3.0 |
| `midi/dvorak7-1.mid` through `midi/dvorak7-4.mid` | Dvořák, Symphony No. 7; typesetting/MIDI by J.F. Lucarelli | [Mutopia, work 1901](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1901) | Public Domain, explicitly declared for this edition by Mutopia |
| `midi/mussorgsky-night-on-bald-mountain.mid` | Mussorgsky, Night on Bald Mountain; conversion/editing by TheOuterLinux | [OpenGameArt submission](https://opengameart.org/content/mussorgsky-night-on-bald-mountain) | CC0 1.0 |

All nine have valid Standard MIDI headers and passed strict Mido 1.3.3 parsing. They contain 8–16 active MIDI channels, 5,597–26,636 note attacks per file, and explicit orchestral General MIDI program changes. Durations are 3:53–12:21 per movement/piece, totaling roughly 79 minutes. This is structural validation, not a human listening assessment. General MIDI voice allocation and the finite browser synthesizer can affect dense passages.

The Mutopia archives include complete conductor-score files; Dvořák's separate single-instrument practice files were not added. The Eroica MIDI archive contains four movement files. Mutopia's source editions, contributor credits and licensing remain linked in each collection record. A score MIDI may use a different repeat interpretation or tempo from a particular recording.

The OpenGameArt download contains the complete MIDI plus score, LMMS project and audio examples. Only its MIDI is bundled. Its C64/chiptune tags describe an accompanying realization: playback here uses the orchestral GM programs in the MIDI, not the LMMS/chiptune sound.

Exact source URLs, archive members, SHA-256 hashes, byte counts, note counts, instruments and smoke-test positions are in `collection.json`. CC BY-SA 3.0 and CC0 1.0 license texts accompany the runtime assets. No claim that every public-domain composition has a public-domain MIDI arrangement is made; the permissions above concern these specific supplied editions/conversions.

## Separate private downloads

Five actual Wendy Carlos performance MIDIs are downloaded outside the runtime asset tree: Air on a G-String and Invention in D minor from Switched-On Bach 2000; The Hummingbird and The Vulture from Carnival of the Animals, Part II; and HeavenScent. Sources: [Carlos's official resources](https://www.wendycarlos.com/resources.html) and [HeavenScent notes/downloads](https://www.wendycarlos.com/heavens/heavens.html).

The official resources allow private use only; these files are copyrighted and are not redistributable under an open license. They are supplied as a local private-use ZIP for the user's own MIDI import and are excluded from the public song library. The performance data is authentic, but Carlos's synthesizer patches, routing and recorded timbres are not included. Air has no program assignments; other files contain hardware-specific assignments. A General MIDI realization can therefore sound unlike her recordings, including default piano sounds.

Six additional Mahler movements were downloaded for private local study: all four movements of Symphony No. 1, Symphony No. 5/II, and Symphony No. 9/III, sequenced by Ben Boot, from [GustavMahler.com](https://gustavmahler.com/midi.html). Their embedded © OnClassical / Ben Boot 2010 notices prohibit republication without permission and commercial use. These files likewise remain outside the runtime/public bundle. The local ZIP preserves each original MIDI and its embedded notices.
