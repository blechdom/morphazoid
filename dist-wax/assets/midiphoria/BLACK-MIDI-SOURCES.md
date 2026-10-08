# Black MIDI expansion — retrieved 2026-10-08

## Complete geometric-pattern collection

Source: https://github.com/rin-w/black-midi-patterns
Download: https://codeload.github.com/rin-w/black-midi-patterns/zip/refs/heads/master

All **9 `.mid` files** under `generic_mid/Black MIDI` have been downloaded, validated and copied without modification to `midi/`. These are short reusable note-art patterns, **not full musical arrangements**. They include 3- and 4-beat block glisses, funnels, lines, and a volcanic web. Their musical duration is 0.429–5.142 seconds; use Loop to explore sustained repetition.

The repository README contribution conditions permit the public to use/modify contributed patterns without special conditions. There is no standalone license file; records use a descriptive LicenseRef instead of inventing an SPDX license. Exact README is retained in `licenses/BLACK-MIDI-PATTERNS.md`.

## Complete BLEEDING EDGE MONOTONE archive

Author source: https://github.com/BLEEDING-EDGE-MONOTONE/Black-MIDI-Archive
Original download: https://raw.githubusercontent.com/BLEEDING-EDGE-MONOTONE/Black-MIDI-Archive/main/ARCHIVE%202026.7z
License: https://github.com/BLEEDING-EDGE-MONOTONE/Black-MIDI-Archive/blob/main/LICENSE

The entire original **14,890,135-byte archive** is saved as `archives/black-midi-archive-2026.7z`. It contains **35 MIDI files representing 19 unique works**, plus the author's FL Studio project files. The 35 MIDIs are 19 full decorative scores and 16 creator-provided AUDIO variants. These are Series I, II and III works released in the author's archive, including three previously unreleased compositions. The repository specifies CC0 1.0; credit is preserved as requested. Exact license/README are retained as `licenses/BLACK-MIDI-ARCHIVE-CC0.txt` and `archives/BLACK-MIDI-ARCHIVE-README.md`.

The browser menu includes **all 16 complete creator AUDIO variants**, unchanged. These are not newly simplified or truncated by Morphazoid: they are the separately supplied files named `Audio.mid` in the author's own archive. Duration ranges from 149.052 to 455.273 seconds, with 17,517–152,948 positive-velocity note-on events. Together they occupy 9,817,887 bytes. Menu labels explicitly identify the audio variant; the complete original decorative scores remain available through the archive download.

The three unique full-score-only works are Five Pebbles, UPDATE, and Winter's Pain. These have no supplied AUDIO variant and are retained in the complete archive. Five Pebbles exceeds the browser's 10 MB import size; UPDATE and Winter's Pain have 455,179 and 872,471 note-ons, peaking at 19,489 and 27,021 per second respectively. They are not included as normal browser-menu entries.

Full scores can exceed 183 MB, with browser-sized full-score examples peaking above 40,000 note-ons per second. The lighter AUDIO variants still require dense-event handling: Lightstorm reaches 3,398 positive-velocity note-ons per second (127s), Seven Red Suns reaches 3,232 (42s), and A Soul of Steel reaches 3,007 (210s). Graphics should batch/subsample events without interfering with audio scheduling.

`collection.json` contains the 25 browser entries (9 patterns + 16 full-length audio variants). `archives/black-midi-work-variants.json` maps every work to its creator AUDIO and full-score archive paths. `archives/black-midi-archive-2026.json` records the exact archive size, hash and source.

Validation reads real MThd/MTrk structure, tempo map, note-on counts, track/channel/program counts, musical/file duration, SHA256, fixed one-second/100ms attack bins, and original embedded text. Densest-second values are integer one-second bins, not arbitrary sliding-window claims. No human listening assessment or claim of historical popularity has been made for this collection. The files are by this author, not Conlon Nancarrow or Wendy Carlos.
