# Midiphoria on Morphazoid

Open `/midiphoria.html`. Choose a song, enable **Audio**, then **Play**.
When a song is selected with Audio off, **Turn audio on** appears beside Play;
it uses the same audio action as the masthead speaker without starting transport.
Starting from zero skips any silent MIDI lead-in to the first note. The playhead
keeps the file's original time; Stop returns to zero, and manual seeks and
pause/resume retain their chosen positions.
SpessaSynth plays Standard MIDI Files through the bundled TimGM6mb SoundFont in
an AudioWorklet. The same note and controller events drive Canvas graphics.
Mute leaves the transport and graphics running. Color, velocity weighting,
ADSR, invert, hue and view changes stay live during playback.
Playback applies an 18 dB boost before compression so quiet arrangements have
useful output at 100%. The volume control still spans mute to full output,
with smoothed changes and a final peak ceiling of 0.98.

**Open your MIDIs** accepts multiple files, available alongside the built-in songs
at the top of the song list for this page session. Nothing is uploaded. Limits are 20 files, 10 MB per file
and 50 MB total. Reloading or leaving the page clears the local library.
Changing songs retains Play/Pause: a playing arrangement is replaced from the
new song's beginning, while a paused player stays paused. Rapid changes select
only the newest request; Stop cancels a pending restart. All MIDI files appear in
one scrollable list. The single filter matches song titles, artists and collection
names, including multiple search words. Filtering keeps the selected song playing;
its name remains visible even outside the results. Next and Random browse those
results without changing Audio. Clicking the selected song again preserves its
position. Arrow keys, Home/End and Page Up/Down browse the list without selecting;
Enter or Space selects the focused file. Imports and generated text clear the
filter so their new rows remain visible.
Speed is 0.5–4×, with the shared Tap control (120 BPM = 1×), seek and looping.
Seeking restores MIDI programs/controllers and resumes subsequent note events;
it does not reconstruct notes whose attacks precede the seek point.

If the browser suspends or interrupts audio, the speaker control reflects that
state. One explicit Audio click resumes the existing score without resetting its
position. A native recovery respects an explicit mute; a closed engine is
recreated on the next Audio action.

The on-screen pads play the TimGM6mb piano after **Audio** is enabled. They work
with playback stopped or alongside a song. Pointer, touch and focused-button
Enter/Space hold a note; release/cancel lets it decay. Assistive activation plays
a short note. Pad velocity and the shared output volume affect the sound.
Pads use a separate synthesizer in the same audio context, so file instruments,
controllers, stop and seek cannot change or cancel a held pad. Releasing a pad
cannot cancel a matching note in the song. Reset (in About & setup), window blur, hiding the
page, Audio off and page exit release pad sound. Muted presses are never queued.

Incoming hardware/computer MIDI also plays the piano when **Audio** is on.
Enable hardware/computer MIDI separately in shared Settings. Note velocity,
channel/trigger filtering and sustain apply to those live notes; program changes
and pitch bend do not change this piano voice. Muted notes are never replayed.
Live hardware and file notes retain source/channel ownership, including MIDI
ports within files. MIDI Learn ignores file playback so a running song cannot
capture a hardware mapping.

## Text MIDI

Type up to 32 characters in **Text MIDI**, then choose **Make MIDI**. Original
5×7 block glyphs map horizontal position to MIDI pitch and vertical position to
time. A horizontal playhead climbs from bottom to top, keeping the letters
upright. Vertical strokes sustain notes; gaps create rests. Letters read left
to right in phrases of up to eight characters, with longer text continuing in
the next phrase above. Letters, numbers and punctuation are supported,
lowercase becomes uppercase, and unsupported characters become spaces.
The generated MIDI appears in the session song menu. When Audio is already on,
**Make MIDI** immediately auditions the new score, including when playback was
paused or the previous score had ended. With Audio off, generation stays muted;
enable Audio and press Play to hear it through the existing SoundFont player.
Regenerating text while playing keeps playback active.

**Letter score** shows the actual MIDI pitches and durations, following the
file's audio clock. Long scores scroll vertically through a readable window;
seek, speed and Loop use the same player. Every phrase ends with one silent
row. Turn Letter score off to watch the normal light graphics, or choose a
visual preset. **Download MIDI** exports the exact Standard MIDI File played
in the browser, for a DAW or another player. Text and generated files stay in
this browser session.

The generator is bounded to eight seconds at 1×, 40 simultaneous pitches and
640 note runs. It uses a General MIDI sawtooth lead at 120 BPM and chromatic
pitches within 48–94, with no scale quantization. Each time row lasts 0.25 s;
a one-phrase score lasts two seconds. The score renderer never schedules
audio; notes are played by the existing AudioWorklet.

## Collection and arrangement quality

The song picker contains 100 selections, searchable by title, artist or
collection. Collections group popular arrangements, jazz/fusion, Black MIDI,
geometric patterns/studies, full orchestra, creator tracks and original demos.
Filtering the menu does not interrupt the current song. Local imports appear
in Your MIDIs and importing clears the current filter.

The Black MIDI collection contains all 16 complete creator AUDIO editions from
BLEEDING EDGE MONOTONE's archive. The unchanged 14.9 MB archive download contains
all 35 MIDI files / 19 works, including the much larger decorative originals.
No arrangement was shortened or regenerated. Three works without creator AUDIO
editions remain in the archive only. All nine rin-w geometric patterns are
included separately and labelled as short patterns; enable Loop to repeat them.

The orchestral collection contains all movements of Beethoven's Eroica and
Dvořák's Seventh, plus Mussorgsky's Night on Bald Mountain, with explicit
orchestral instruments. These total about 79 minutes. The former generic
solo-piano classical tracks remain removed. Actual Wendy Carlos performance
MIDIs and additional Mahler scores were downloaded separately for private
local import; their terms do not permit adding them to the public bundle.
Carlos's MIDI notes/expression do not include her recorded synthesizer timbres.

Web arrangements include multiple sounding MIDI channels and drums, complete
song timelines and preserved source/arranger metadata. This checks arrangement
structure and playback, not community ranking or human musical approval.
The original Experimental studies explore tempo canons, pitch geometry and
black-MIDI density; they are not compositions by Conlon Nancarrow.

Free collections with complete MIDI downloads:

- [MIDKAR pop/rock](https://midkar.com/Pop_Rock/Pop_Rock_A_to_Z.html): established song arrangements, individual files and a bulk 7z archive advertised as 1,297 MIDIs.
- [MIDKAR jazz](https://midkar.com/Jazz/Jazz.html): a large standards collection with individual MIDI downloads.
- [Doug McKenzie](https://bushgrafts.com/midi/): live-played jazz piano and trio performances, with many annotated files.
- [MIDIWorld](https://www.midiworld.com/files/): artist collections including [Depeche Mode](https://www.midiworld.com/files/826/), New Order, Kraftwerk and Queen. Complete MIDI downloads were verified and parsed for Enjoy the Silence, Blue Monday, Computer Love and Bohemian Rhapsody.
- [BitMidi](https://bitmidi.com/): a large popular-song archive with play counts and full MIDI download links.
- [MIDI Collection](https://midicollection.com/): searchable pop, rock, electronic and other songs, with full downloads and no account required.
- [Black-MIDI patterns](https://github.com/rin-w/black-midi-patterns): nine downloadable MIDI patterns for geometric note art; these are building blocks rather than full-song arrangements.

Checked on October 7–8, 2026. Actual MIDI downloads were verified for McKenzie's
Autumn Leaves and Dolphin Dance, MIDI Collection's Sweet Dreams, and all nine
MIDI files in the black-pattern pack. MIDKAR's archive links advertise 7z files;
its archive contents could not be inspected through the download tools used.
Free download does not itself establish permission to republish a collection.
The selected web arrangements are included in this collection; their source
and license status are recorded individually.
Extract ZIP/7z downloads first, then use Open your MIDIs to add selected .mid files.

Exact bundled credits, source links, licenses and file hashes are in
`assets/midiphoria/collection.json` and its adjacent source/license records.
The SpessaSynth versions, hashes and lifecycle patch are documented in
`src/instruments/midiphoria/vendor/README.md`.

## Visual presets

The first row of the right panel contains the visual preset menu, Next and
parameter dice. Sixteen complete looks span note trails, mirrored trails,
radial bursts, ribbons and orbits. Five palettes, palette shift,
saturation, trail length/width, glow and motion are available for live edits.
Twelve of the sixteen factory looks (75%) use None for reflections and no
repeated radial copies. Candy mirror, Ice blueprint, Disco prism and Silver
kaleidoscope use symmetry with thin trails (0.4–0.65×) and restrained glow. All symmetry controls remain
available for manual edits and parameter dice.
Instrument / channel colors keep a distinct, stable color for each MIDI channel.
All instruments draw together on one shared canvas, including every preset and
randomized look. Older presets with separate lanes or panels load into that same
shared view. The legend and Show voice menu can isolate the picture without
muting any audio. Instrument names follow the SoundFont patch on each channel.
MIDI ports retain separate note ownership and legend entries; matching channel
numbers reuse a color. Musical parts sharing one channel cannot be inferred as
separate voices. Color by pitch, MIDI channel or velocity remains available; adjust the trail fade curve, add
clockwise/counterclockwise spin, and repeat radial/orbit forms up to eight times.
Spin and radial-copy controls are enabled in the two circular views.
Reflection adds vertical, horizontal, both, either diagonal, both diagonals or
all center axes. Diagonal reflections use a centered square region and preserve
45-degree geometry. Travel can retain each view's Classic motion, move from the
center to the edges, or draw from the edges toward the center. Every preset and parameter dice
includes these fields. Older version-1 snapshots use None/Classic for missing
fields.

The preset bar uses the shared Shape picker without enclosing boxes. Circular
Play/Pause sits beside Speed and Tap above the collection. File stop/rewind and
Loop stay beside that transport. Download links, credits and Reset are inside
About & setup; the separate Demo/Clear/Reset row has been removed.
Static, rotating and note-triggered hue and the light ADSR are part of every
preset. Manual edits and dice show Custom; Next continues the preset tour.

Presets change the visual state. When no file is chosen, the first preset or
parameter-dice action selects a random library MIDI without arming Audio.
Once a file is chosen, presets retain that file, playhead,
Audio, volume, playback speed, looping, MIDI routing and learn state. A longer
trail setting affects retained history and new notes; expired notes cannot be
reconstructed. Audio remains scheduled by the synth worklet.

The Light envelope uses Shape-style draggable A/D/S/R nodes. Its native values
remain available under **Envelope values** for precise and keyboard editing.
Preset recall, dice and Reset synchronize both representations. This envelope
controls light; it does not replace the SoundFont instruments' sound envelopes.

## Feature parity

Reviewed against Nicholas C. Stanley's repository at
[`93b5c4f`](https://github.com/NicholasCStanley/midiphoria/tree/93b5c4f031933c3372c20b428e3c4160b9485c73).
This is an independent browser implementation; no original Python source is
bundled. Matching capabilities does not imply identical defaults or pixels.

| Capability | Morphazoid |
| --- | --- |
| Live MIDI notes and controllers | Implemented through shared Web MIDI |
| All-note trigger or mapped note/CC/channel | Implemented, including MIDI Learn |
| Velocity, mixed note color, monochrome, invert | Implemented |
| ADSR light envelope; static, rotating and activity hue | Implemented |
| Solid mask | Removed by request; the two former mask presets now draw lines |
| Fullscreen | Implemented |
| MIDI-file playback | Implemented with audible browser SoundFont synthesis |
| Note-set trigger, drum sets and add-to-set learning | Missing |
| Select a specific MIDI input port | Missing; receives all connected inputs |
| Detailed MIDI event log/debug overlay | Missing; compact note/light readout only |
| JSONL session recording and replay | Missing |
| Offline PNG/PPM frames and MP4 export | Missing |
| FluidSynth audio rendering / existing-audio mux for export | Missing |
| Export FPS, resolution, crop, duration, tails and channel subsets | Missing |
| Shutter samples, averaging/max blending, start/center/end sampling | Missing |
| Original keyboard shortcuts | Partial; browser controls and shared note keyboard differ |
| Torch/CUDA and OpenGL renderer | Replaced by browser Canvas/Web Audio |

The browser adds note trails, audible on-screen piano pads, two-row computer keys, sustain,
source/channel isolation, disconnect recovery, a curated menu, local MIDI
imports and realtime SoundFont listening. Upstream's live visualizer does not
synthesize audio; its separate export module can render audio with FluidSynth
and an SF2 or mux existing audio into an MP4.

The upstream repository includes recording/export modules, but its installed
[CLI entrypoint](https://github.com/NicholasCStanley/midiphoria/blob/93b5c4f031933c3372c20b428e3c4160b9485c73/pyproject.toml#L23)
targets an [argument parser](https://github.com/NicholasCStanley/midiphoria/blob/93b5c4f031933c3372c20b428e3c4160b9485c73/src/midiphoria/app.py#L427)
that does not wire in the advertised recording/export flags at this revision.
Those rows compare repository code, not a verified working upstream CLI run.

Default differences include trails/color/velocity enabled here, an initial
0.02/0.15/0.8/0.45-second ADSR and all-note input. Browser phase durations are
exact; release retains the note color. Upstream uses different defaults and
envelope/color behavior, so this is not a pixel-exact port.

## Dense files and verification limits

The file synthesizer caps synthesis at 128 voices; the independent piano pads
cap synthesis at 32 voices and track at most 32 held input sources. Both share
compression, volume and a final bounded output guard. These are synthesis voices,
not a promise of one independent audible sound for every simultaneous MIDI note.

The visual model now preserves up to 4,096 independent active attacks and the
renderer retains up to 8,192 trails. Each accepted attack/release goes directly
into history; there is no 120 Hz snapshot gate. Overlapping repeats at one pitch
have independent IDs and FIFO release, including sustain-pedal ownership. Older
released trails expire or are evicted first when the history is full. Extreme
inputs beyond the active-note capacity are counted by `model.droppedNotes`;
history eviction is counted by `renderer.droppedTrails`. These limits keep dense
files bounded rather than claiming unlimited black-MIDI fidelity.

Above 1,024 visible trails, graphics omit the glow stroke, simplify curved
orbits and use small held-note markers while retaining one path for every
retained note. Reflection still composites one rendered layer. Up to 64 source/
channel labels are shown; notes from additional ports still draw on the same
canvas. Audio scheduling and polyphony are unaffected by visual solo.

Regression fixtures using the real browser SoundFont player now capture 200/200
millisecond notes at both 1× and 4×, 512/512 simultaneous notes at 4×, and all 64
same-pitch attacks/releases delivered within one JavaScript turn. The prior
snapshot path captured only 23/200 notes in the 4× fixture. Full-capacity renderer
tests verify all 8,192 retained trails receive a bounded drawing path.

Audio scheduling lives in the worklet, independently of animation frames.
The page stops and closes its audio context and shared output connection on
pagehide. Browser tests check sound output, mute/transport independence,
imports, looping, seeking, cleanup, live controls and responsive layouts.
Automated measurements do not substitute for a human listening pass or a
physical MIDI-controller/touch-device test.

October 8 expansion checks: all 100 bundled selections produced finite audio
within the 0.98 ceiling; three peak-density black-MIDI passages remained
controllable at eight radial copies. All 24 relevant browser tests and 54
focused model/player/preset/integration tests passed. Desktop, portrait and
landscape checks covered the grouped menu and the 16 complete visual presets.
The full archive and bundled MIDI hashes match downloaded originals.

Piano-pad checks: five browser tests cover explicit Audio gating, no replay of
muted presses, pointer/keyboard/assistive activation, release/cancel/blur/Reset,
velocity and volume response, independent same-pitch file notes, stop/seek,
invalid-file recovery, and pagehide/BFCache cleanup. The pad synth uses the
piano sample's own release without reverb/chorus, preventing old effect tails
from returning on quick Audio off/on. File effects remain unchanged.
