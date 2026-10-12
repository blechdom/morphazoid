# Blech MIDI

[Open Blech MIDI](../blech-midi.html). Drawing, black MIDI and geometric stamps,
words, and live Automatapoeia MIDI evolution share one page and one tempo. The file player,
live MIDI visualizer and two-deck mixer remain in [Midiophilia](../midiphoria.html).

## Prepare and send

Turn **Audio** on. Draw on the preparation canvas below the live output, or
choose one of its shapes, then press **Send ↑**. The sent score is a snapshot:
editing, erasing or clearing the preparation canvas leaves that score playing.
**Download MIDI** saves the score that was sent, including its pitch span,
lowest note, row length and key gate. Editing the drawing hides the stale link.

The top **Send ↑** button performs the same action. Drawing and Automatapoeia
remain visible together. Space outside editable controls sends
the prepared drawing; it never arms Audio. Inside the preparation canvas, arrow
keys move the cursor, Space or Enter paints, Delete erases, and Ctrl/Cmd+Z undoes.
One captured freehand stroke is one undo action.

The stamp bank contains the existing generated textures plus the bundled black
MIDI and geometric file stamps. Its single filter searches names and collections.
Each pad has its own **Loop** switch. With it on, tap a pad to start it and tap again to stop only that pad.
With Loop off, a tap plays once; another tap retriggers that pad from the start
without stopping other pads. Green means playing; the dashed outline means the
shape selected for editing or painting. A loading file says **Loading · tap to
cancel** and does not count as playing. Selecting another file cancels the old
download; it does not stop already-playing pads.

Each Send creates a thumbnail in the shared **Playable pads** bank below the live output. Drawings,
captured evolution, messages and painted copies retain their exact MIDI, independent of
the preparation canvas. Tap a looping saved pad to stop or restart it; its own
**Loop** switch changes only that pad. Turning this switch off finishes the
current pass. **Remove** stops and removes just that saved pad. Stop all leaves
the bank available to replay. The bank holds eight sends for this page session;
a ninth replaces the oldest stopped pad. Navigation/reload clears it. The single
filter searches both factory and saved pads; playing pads remain visible and
move to the front. **Edit** copies a pad into the 48 × 32 drawing grid. This
raster draft simplifies source timing and pitch detail; the original MIDI pad
is unchanged. Sending the draft creates another pad.

**Paint flow** places separate copies of the selected stamp by pitch directly on
the live output, each with its own saved pad. Enter on that output triggers the
selected stamp pad. Messages also send immediately. The preparation canvas
remains separate from these live actions.

## Timing and sound

All sources follow the **30–300 BPM** tempo knob and its shared Tap control.
Each pad retains its own position and Loop setting. **Loop drawing** sets only
the next drawing/message Send; it never changes existing pads. Turning an
individual pad's Loop off finishes its current pass. Tapping a looping pad
stops it immediately without interrupting the other sources.

**Stop all** removes active pads and pauses Automatapoeia. **Audio off** releases
pad playback but keeps the live automata transport evolving silently. Enabling
Audio joins the current evolution. Audio never arms through Send, Play, seed
selection, Capture or Restart. Up to four clips play alongside the independent
live generator; another pad replaces the oldest playing clip. Its saved
snapshot remains available. Stopping a source cancels its own pending
MIDI-effect echoes and leaves other sources moving.

Generated drawings, patterns and rules default to piano; file stamps can retain
their original instruments. The **Pads** volume controls the stamp bus; Automatapoeia has its own volume
and instrument selector. Masthead Output controls the final mix. **Stamp MIDI**
retains program, controller, pitch, velocity and envelope parameters supported by
the existing MIDI stamp engine. Source settings apply to future sends; live
parameters update active voices where supported.

The collapsed **SoundFont & live effects** section keeps the stamp sound controls
on this page. Choose a bundled bank or a font saved on **Sound Fonts**, import a
local SF2/SF3 file up to 128 MiB, or restore TimGM6mb. Accepted imports join the
[shared browser library](shared-sound-fonts.md). Choosing a bank preserves the
current Audio state; enable Audio explicitly to hear it. Banks stay in this browser;
loading errors keep the previous usable bank. Filter frequency, echo mix,
beat-based echo length, feedback, and the existing SoundFont reverb/chorus
parameters update the same engine used by drawings, stamps, messages and rules.
Editing either work area preserves these settings. **Reset effects** restores their defaults
without stopping the patterns or changing Audio, output level or the SoundFont.

## Live Automatapoeia

Automatapoeia runs beside the drawing editor with an independent **Play/Pause**
and the same master tempo as the pads. Every row is computed from the previous
row on the audio clock, without repeatedly launching sample clips. Pause
releases only its notes and pending effects, retaining the generation and
within-row phase. Resume continues that row's remaining time. The output shows
its notes alongside every playing pad, with a distinct source color.

The original thumbnail rule menu, search, symmetry filters, Previous and Next
remain available. All 256 elementary rules and 64 radius-2 totalistic codes
are retained. The live preview shows the observed history, not a precomputed
finite clip. **Generation rate** is 1–8 rows per master beat. Rule, boundary,
transform, rate, width, pitch, velocity, articulation and sound edits apply at
the next generation without resetting the stream. Width is 8–128 pitches;
width changes center-fit the evolving row, while Lowest MIDI note transposes
its pitch window at the next generation.

**Restart** returns to the chosen seed without changing Play/Pause.
**Reseed** chooses a reproducible random seed and restarts; from a single
centered seed, it sets density to 50% so reseeding produces a different row.
The exact seed number and density remain editable. These seed edits prepare the
next Restart; they do not replace the current evolving row.

**Pick seed row** changes the preparation canvas gesture from painting to
choosing a horizontal row. The adjacent slider and arrow keys also select the
row. **Use row as seed** copies its mapped MIDI pitches, including Width and
Offset, into the visible seed strip and restarts only Automatapoeia. Its pitch
window expands as needed to retain those notes. This action preserves its
Play/Pause state and leaves every pad alone. No seed is inferred from the
whole two-dimensional picture.

**Capture to pad** saves the most recent 1, 2, 4, 8 or 16 performed beats as a
stopped, looping pad. Capture leaves evolution running and does not double it.
The downloadable MIDI retains source note gates, velocity, program, level and
tempo changes; capture is before the shared MIDI effects layer, so replay does
not bake in and then apply that layer twice. Less than the requested duration
is captured if the source has just started. The history is bounded to 16 beats
and 1,024 rows. Before Audio is initialized, a long hidden-tab gap advances at
most 16 silent beats on return; excess idle time is discarded without overdue
attacks or a claim that skipped generations were computed. The running audio
worklet processes every rendered quantum independently of UI frames. Empty evolution cannot create a sounding capture.

The same original Automatapoeia catalogue, thumbnail raster, evolution, edge
and post-step-transform functions are reused. The original instrument's
oscillator voices, spectral/contour mappings and audio ADSR are synthesis
controls, not cellular generation controls; Blech MIDI instead uses its
SoundFont, Stamp MIDI and live-effects controls for those sound changes.
The MIDI generator remains distinct from the
[standalone Automatapoeia instrument](../automatapoeia.html).

## Pattern mapping and source details

The 30 generated pictures include Heart, Square, Zigzag, Polka dots, Plaid,
Stripes, Drips, Glob, Glooob, Noise, Scatter and Explode. Their thumbnails show
actual pitch/time cells, positioned across the full MIDI pitch range. Density
changes stroke thickness or particle count; **Width →** covers 12–128 chromatic
notes and **Height ↑** spans ¼–64 beats. Height stretches the picture in time;
it does not change the tempo. The **Offset ↔** slider moves the whole picture
left/right in pitch, stopping at MIDI's edges without folding or losing notes.
At full width there is no room to move it farther sideways. Width, height and
offset also apply to the next drawing Send; they leave saved snapshots intact.
The advanced drawing-row length is another view of the same height setting.
Variation
changes a reproducible seed for irregular textures. Fixed icons retain their
geometry when only that seed changes.

The palette also retains 28 bundled file stamps: 16 Black MIDI arrangements,
nine geometric patterns and three studies. Short geometric files play whole,
fitted to Height. Longer arrangements use a dense excerpt; Next slice moves
through the source. File window offers automatic, densest, manual-start and
whole-file selection. Status reports the source beat range and note count.
The 35-file downloadable archive includes larger decorative scores that the
stamp palette does not unpack.

Excerpts preserve programs, controllers, pitch bend and held notes at their
boundaries. Dense excerpts are explicitly shortened to meet the engine limits,
without silently thinning their attacks. A single instant that cannot fit is
rejected. A 100% key gate retains the original bytes; a shorter gate changes
key release while source pedals can still extend the sound. Only two parsed
file stamps are cached, and file downloads are lazy and cancelable.

In the 48×32 preparation grid, pitch increases left to right. The top of the
picture enters the live output first and rises, keeping the complete image
upright. Adjacent vertical cells sustain one note. Defaults remain piano,
MIDI pitches 48–95 and ¼ beat per row: four seconds at 120 BPM. There is no
scale snapping. Shape buttons replace the draft with editable original pixel
patterns; they do not rasterize platform emoji fonts. Undo retains 32 edits.

Messages use the existing original 5×7 letters and curated 🙂 😀 ⭐ ❤ ◆ symbols.
Whole words fit up to eight characters alongside each other and continue in
phrases; One letter at a time uses a separate window for each letter. Up to
32 characters are supported, lowercase becomes uppercase, and skipped symbols
are reported. The message field launches its score immediately. The separate
Words & symbols file-generation feature remains in Midiophilia's visualizer.

Automatapoeia maps each column to one chromatic pitch. Its seed row plays first.
Retrigger attacks every active cell; Hold joins consecutive cells at the same
pitch. Captured pads retain the performed note gates. The older finite MIDI
rule generator remains available to other consumers without changing its
published default MIDI bytes.

## Ownership and limits

One `MidiMixerEngine` owns the sound graph and sample clocks; it loads no deck
files on this page. One `mountMixerPerformance` instance retains the stamp bank,
live rule editor, MIDI controls and renderer in one workspace. Graphics follow native
audio timing when Audio is running; rendering never schedules audible rows. With Audio off and no context, the existing
silent preview clock advances without creating Web Audio.

The shared output connection supports stereo meters and main-output recording.
Page departure aborts downloads and listeners, revokes generated URLs, releases
the audio graph and removes render observers. A back/forward-cache return mounts
fresh owners with Audio off and restores the prepared drawing without restarting
playback. No microphone, MIDI input, MIDI output or device permission is requested.

The existing sample limits remain: at most four clips, 32,768 notes, 16 channels,
512 beats and 2 MB per generated/excerpted sample. Dense file stamps use bounded
windows; **Whole file** can shorten an oversized source to fit those limits.
The preparation grid is 48 by 32 cells, mapped across up to all 128 MIDI pitches.

Visuals are independently implemented for the browser, inspired by
[Nicholas C. Stanley's Midiphoria](https://github.com/NicholasCStanley/midiphoria).
See the [MIDI collection and SoundFont credits](../assets/midiphoria/SOURCE.md)
for source attribution, licenses and links. Existing rendering and scheduler
bounds are preserved; this page does not promise every dense black-MIDI note
will become a separately visible mark or simultaneous sounding voice.

## Black MIDI tools and references

Primary-source research for the stamp workflow, checked October 2026:

| Tool | Documented role | Relevance here |
| --- | --- | --- |
| [ImageToMidi](https://github.com/arduano/ImageToMidi) | Desktop image-to-MIDI note-art generator, with pitch range and time-per-pixel controls. | Pixel geometry can become the actual sounding score. |
| [midi2img](https://github.com/mathigatti/midi2img) | Python conversion between monochrome images and MIDI piano rolls. | A clear pitch/time raster model. |
| [rin-w Black MIDI Patterns](https://github.com/rin-w/black-midi-patterns) | Reusable patterns in MIDI, Domino and FL Studio formats. | Nine existing patterns become whole playable stamps. |
| [Zenith](https://github.com/arduano/Zenith-MIDI) | MIDI video renderer with plugins, live preview settings, gradients, opacity, ripples, textures and statistics. Its author states it is no longer supported. | Reference for independent visual presentation controls. |
| [Kiva](https://github.com/arduano/Kiva) | Native MIDI player supporting palettes and MIDI color events. | Reference for distinguishable voices on one canvas. |
| [Wasabi](https://github.com/BlackMIDIDevs/wasabi) | Rust/Vulkan Black MIDI player with integrated XSynth and SoundFonts. | Reference for keeping dense graphics and audio workloads separate. |
| [MIDITrail](https://www.yknk.org/miditrail/en/summary/) | A 3D MIDI player for Windows, macOS and iOS. | Reference for depth and rain-style presentations. |
| [Piano From Above](https://github.com/brian-pantano/PianoFromAbove) | Native visual MIDI player with a separate visualization branch. | Reference for readable rectangular note geometry. |

The browser mappings above are Morphazoid design choices, not ports of these
applications or claims of their full feature sets. No code from these tools
was imported for this stamp bank. Generated textures are original bounded
pitch/time patterns; they do not claim to recreate any named composition.

## MIDI note effects

Open **MIDI effects**, turn the layer on, then shape new notes with transpose
(±24 semitones), velocity, single/octave/fifth/major/minor chords, note delay,
a gate limit, and up to four echoes with their own spacing and velocity decay.
Drum pitches stay unchanged unless **Transpose & harmonize drums too** is on.
Pitches outside MIDI 0–127 are omitted rather than folded onto the endpoints.

Timing is in beats: the file player follows the file's current tempo and speed;
Mixer and Blech MIDI use the shared tempo. A gate limit shortens key holds;
source sustain pedals still apply. Edits and bypass affect new attacks, while
held notes and pending echoes finish with their captured settings. Stop, seek,
source replacement cancel the affected pending notes. Audio off releases pads
and stamps; song transports keep moving.

The layer runs before synthesis on the audio thread, and the visualizer receives
the resulting notes. Playing, Audio permission, source MIDI bytes and download
files remain independent. Mixer scenes include the layer; visualizer presets
continue to own appearance only. These are MIDI note effects, separate from
SoundFont reverb/chorus and the audio filter/delay controls.

The shared scheduler bounds each engine to 512 source-note families and 4,096
reserved events. Under extreme black-MIDI load it removes added voices before
stealing the oldest family; each sounded child retains a matched release.
Existing native synthesis and display polyphony limits still apply.
