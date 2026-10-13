# BLECH MIDI

[Open BLECH MIDI](../blech-midi.html). Drawing, black MIDI and geometric stamps,
words, MIDI artwork, the Black MIDI file player and live Automatapoeia evolution
share one page. The light-trail visualizer, ordinary file player and two-deck
mixer remain in [Midiophilia](../midiphoria.html).

## Black MIDI file player

The persistent falling-note stage stays beside the preparation tabs on laptops and above them on phones. **MIDI Files**
contains a native collection-grouped menu, Next, Random and local imports.
Play/Pause, Stop, Loop file and File volume belong only to this player.
Changing tabs, preparing another drawing, changing colors, or pausing
Automatapoeia does not stop the file. **Stop all** stops every source.
Changing files preserves an already-running file transport.

**Preview score ↓** beside a prepared drawing or in the MIDI art creator loads
an independent snapshot into the falling-note player. It does not send a pad,
arm Audio or alter pads already looping. Press the player's Play button after
turning Audio on. Sending and previewing have separate transport ownership.

The file synthesizer borrows Blech's AudioContext and feeds the same filter,
delay, master volume and final peak limiter as the pads and Automatapoeia.
The SoundFont picker and MIDI note effects apply to file playback too. File
volume balances this source before the shared output. Audio remains an
explicit page-wide action; stopping a file does not close the shared context.
Synthesizer-specific live-pad parameter edits remain with their pad source.

By default, Speed preserves the file's own tempo map. **Sync to tempo** scales
that map by the shared tempo divided by its initial BPM, multiplied by Speed.
Changes are continuous and bounded to 0.5–8×. Variable-tempo files retain their
tempo changes: this is a tempo ratio, not a rewritten constant-tempo score or
a bar-alignment system. The status explains a clamped ratio. SMPTE-timed files
have no initial musical BPM and retain speed-only playback.

Local import accepts up to 20 files and 200 MiB total per session. Scores above
10 MiB use silent visual playback unless the collection supplies a separate
creator AUDIO edition. The complete score still has the limits below.

**Black MIDI** is the file-based falling-note view in BLECH MIDI. Future rectangles descend onto the full **128 MIDI pitches (0–127)**;
choose piano-key spacing or equal pitch lanes. All tracks overlap on the same
keyboard. Track checkboxes isolate only the picture, and per-track color
selectors, five palettes and track/channel/pitch/velocity mappings differentiate
voices. Switching away from Visuals preserves the file clock.

The keyboard is the **present**: upcoming notes descend above it, and played
notes continue below it as fading **past trails** in the same voice colors.
In Visuals, **Future** sets the visible forecast and fall speed, **Trail lifetime**
sets the maximum age of a trail (it may leave the picture sooner), and
**Keyboard position** divides the stage. **Past trails** can be switched off.
A note keeps the same downward speed on either side of the keys. File history
follows its playhead: pause freezes it and seeking replaces it with history at
the new position. Generated layers keep their own bounded history, including
recent notes after a pad ends or stops. These are note-gate trails, not measured
SoundFont release tails. Dropping a pad still starts it immediately; the view
does not introduce an audio delay.

This view uses **WebGL2**, with Canvas 2D fallback after GPU unavailability or
context loss. Generated pads and live evolution are composited into this same stage; Midiophilia light/trail views remain Canvas 2D. It does not use
WebGPU or Vulkan. [Vulkan](https://www.vulkan.org/) is a native GPU API, used by
tools such as Wasabi; our browser GPU path is WebGL2. This is an original
Piano From Above-style presentation, not a port of that application.

A module worker parses the complete SMF into indexed typed arrays. Total notes
count every positive-velocity Note On, including quiet/decorative channels.
Zero-velocity Note On is an off event. Repeated overlapping pitches use FIFO
matching within each track/channel. Statistics show total/passed notes, attacks
in the preceding score second, held note gates and peak overlap. Sustain,
release tails, effects and the synthesizer's 128-voice limit are separate.

The parser accepts up to 12 million notes and 200 MiB, with no silent thinning.
Drawing caps are 200,000 rectangles per frame in WebGL2 and 25,000 in Canvas;
At playback rates above 1× the rectangle cap is divided by speed. Live pads and evolution reserve up to half the drawing budget so a dense file cannot hide them. Score details reports omitted file rectangles while statistics retain the full score. Live forecasts are bounded to 12,000 rectangles before the renderer budget. Large files can require hundreds of megabytes of memory; the desktop
9.39-million-note benchmark is not a claim of mobile support at that size.
Lightstorm's 22,866,471-note original remains downloadable, with an explicit
preview-limit message and playable creator AUDIO edition.

The library now includes all 19 decorative BLEEDING EDGE MONOTONE originals
and three Hans5958 files, losslessly compressed from the creators' originals.
Sixteen decorative entries play the separately supplied AUDIO edition on its
original timeline. Different editions can have different note/end times; no
duration-based stretching is applied. Unpaired scores at or below the 10 MiB
audio-loader limit use the original MIDI; larger unpaired scores have an
explicitly silent visual transport with pause, seek, loop and 0.5–8× speed.
The complete scores are kept out of the bounded mixer/stamp selectors.
See [artist sources and Nancarrow findings](../assets/midiphoria/ARTWORK-SOURCES.md)
for provenance, redistribution terms and exact independently checked counts.

Black MIDI displays the original source score before MIDI effects. Generated pads, their upcoming loop cycles, and projected Automatapoeia rows share the same stage and 128-key keyboard. Forecasts use the current source clocks; switching tabs never changes them. Generated forecasts include the current note effects. Full-file statistics remain file statistics, separate from generated layers.


## Independent layer transports

The **Layers** rack stays above the preparation tabs. Each Drop creates its own
named layer with a distinct number, even when two drops use the same equation.
**Pause** freezes only that layer's position and releases its notes; **Resume**
continues it from that position. **Stop** ends that layer immediately. Other
layers, the MIDI file and Automatapoeia keep running. The saved pad remains in
MIDI Stamps so it can be played again after stopping.

Each active layer has its own **Loop** switch: switching it off finishes the
current pass. The Math **Loop new pattern**, Animation **Loop new sequence** and
Drawing **Loop drawing** controls apply to the next Drop, not to layers already
playing. To end a running loop now, use its **Stop** button in Layers.

The rack holds up to four active or paused layers. A fifth Drop replaces the
oldest playing layer; paused layers are retained. If all four are paused, stop
one before adding another. A paused stamp or saved pad resumes when tapped.
**Stop all** remains the page-wide way to stop every source.

## Prepare and send

Turn **Audio** on. Open **Drawing**, draw or choose a shape, then press
**Drop ↓**. The sent score is a snapshot: edits prepare the next drawing while
that pad keeps playing. **Loop drawing** affects the next drop. Stop or change
Loop for an active pad in the persistent Layers rack, or open **MIDI Stamps**
to replay, edit or remove its saved pad. **Load as file** explicitly replaces
the file-player selection instead of layering. **Download MIDI** saves the
last dropped drawing; editing hides that stale link.

The upper file Play/Pause is the primary transport. Space outside editable
controls toggles that file; it never arms Audio. Inside the drawing canvas,
arrow keys move, Space or Enter paints, Delete erases, and Ctrl/Cmd+Z undoes.
One captured freehand stroke is one undo action. Tabs use Left/Right and
Home/End navigation and preserve all prepared contents.

The stamp bank contains the existing generated textures plus the bundled black
MIDI and geometric file stamps. Its single filter searches names and collections.
Each pad has its own **Loop** switch. With it on, tap a pad to start it and tap again to stop only that pad.
With Loop off, a tap plays once; another tap retriggers that pad from the start
without stopping other pads. Green means playing; the dashed outline means the
shape selected for editing or painting. A loading file says **Loading · tap to
cancel** and does not count as playing. Selecting another file cancels the old
download; it does not stop already-playing pads.

Each Drop creates a thumbnail in the **MIDI Stamps** bank. Drawings,
captured evolution, messages and painted copies retain their exact MIDI, independent of
the preparation canvas. Tap a looping saved pad to stop or restart it; its own
**Loop** switch changes only that pad. Turning this switch off finishes the
current pass. **Remove** stops and removes just that saved pad. Stop all leaves
the bank available to replay. The bank holds eight sends for this page session;
a ninth replaces the oldest stopped pad. Navigation/reload clears it. The single
filter searches both factory and saved pads; playing pads remain visible and
move to the front. **Edit** reopens Text pads in the Text editor. For other pads it copies into the 48 × 32 drawing grid. This
raster draft simplifies source timing and pitch detail; the original MIDI pad
is unchanged. Sending the draft creates another pad.

**Text** has a multiline **Write text** box, **Clear text**, an exact MIDI preview,
and its own **Loop new text** switch. Enter inserts a deliberate line break;
longer lines wrap at word boundaries, splitting long words only when necessary.
The numbered list shows the actual prepared lines and why each breaks. The first
line plays first, from the bottom of the upright preview; there are no generic
grid dividers. Messages use up to 32 normalized characters, including line breaks.
Unsupported characters and truncation are reported beside the controls.

**Fit to line** gives all lines the same letter scale, fitting the longest one to
the pitch window. Turn it off for **Letter size** (5, 10, 15 or 20 keys per letter,
bounded by the window). Left/Center/Right align shorter lines within that window.
**Keyboard width** selects 12–128 pitches; **Keyboard position** moves that window
and shows its actual MIDI range. Full width fixes the position to MIDI 0–127.
**Total duration** sets the entire message length in beats and shows seconds at
the shared tempo. Preview and Drop use the same parsed MIDI bytes and layout.
Preparation and Clear never start playback, stop layers or arm Audio.

**Drop text** adds an independent copy. **Edit** beside a Text layer or saved Text
pad restores its message and layout. Change width, duration, position, lettering
or text, then **Apply next loop**: the current pass finishes and the new version
starts on that layer's next loop. Repeated Apply replaces the queued update.
Queued layers can update before starting; paused layers update while staying
paused. Playing one-shots offer **Restart this layer**. Turning off Loop cancels
a pending update and finishes the current pass. **Drop new text** layers another
copy instead. Other sources keep their positions and play/pause states.
The stamp Density/seed/Key gate and Drawing Loop controls do not affect Text;
shared Sound / FX processing still applies during playback.
The shared shape controls belong to Drawing and MIDI Stamps. The old live trail
canvas and Paint flow gesture remain in Midiophilia.

## MIDI Math and Frames

**MIDI Math** prepares `y = f(x)` or parametric `x(t), y(t)` curves. Six presets
cover sine blades, interference, staircases and parametric shapes. Edit the
expression, domain, duration, sample density, stroke width, gate, pitch range
and velocity, then Drop an independent pad. Loop defaults on. Preparing,
selecting a preset and changing equations do not launch notes or arm Audio.
Expressions use a bounded arithmetic parser, not JavaScript evaluation: no
assignment, property access or dynamic code. Limits: 256 characters, 192 tokens,
24 nesting levels, 1,024 samples and 16 notes per sample. Invalid expressions disable Drop. Non-finite or out-of-bounds samples are omitted and counted; an empty result also disables Drop. No external graphing service is required.

**Frames** takes up to eight immutable drawing snapshots. Use **Capture frame**
inside Drawing, or **Capture drawing** inside Frames. Arrange, duplicate, remove
or insert rests, set beats per frame, and Drop the sequence as an independent
loopable pad. Edit drawing opens a copy; playing sequences retain their old
snapshots. Animate preview runs a silent preparation preview. It never changes
the source transport. All generated scores remain subject to the four active
pad and eight saved pad limits.

## Performance workspace design

The laptop workspace fits one viewport: permanent stage/transport, active
layers, tabs, and a scrolling preparation area. The stage occupies the taller
left column, with a narrower preparation column on the right. Portrait phones
stack a taller stage above the controls; short landscape screens use two columns. The title includes an original
SVG MIDI-cable/bat-wing mark; no third-party logo artwork was reused.

The interaction borrows stable transport placement from
[Traktor layouts](https://docs.native-instruments.com/ni-tech-manuals/traktor-pro-manual/en/setting-up-traktor),
separate preparation and launch from
[Ableton clip launching](https://www.ableton.com/en/live-manual/12/launching-clips/),
and keyboard behavior from the
[WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).
These inform interface organization; this is not a Traktor/Ableton emulation.
A small arithmetic parser keeps MIDI Math local and bounded; the reviewed
[Desmos API](https://www.desmos.com/api/v1.12/docs/index.html) requires its hosted
API/key, while [math.js](https://mathjs.org/docs/expressions/security.html)
documents resource/security considerations for arbitrary expressions.

## Timing and sound

All sources follow the **30–300 BPM** tempo knob and its shared Tap control.
Each pad retains its own position and Loop setting. **Loop drawing** sets only
the next drawing Send; Text has its own **Loop new text** switch. Neither changes
existing pads. Turning an
individual pad's Loop off finishes its current pass. Tapping a looping pad
stops it immediately without interrupting the other sources.

**Stop all** stops the file, removes active pads and pauses Automatapoeia. **Audio off** releases
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

Automatapoeia runs in its own preparation tab with an independent **Play/Pause**
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
**New seed** (Reseed) prepares a distinct reproducible seed. While playing, its
fresh lineage starts at the next generation and preserves performed history;
while paused, the visible seed is queued and the status says to press Play.
At 0% or 100% density it uses 50%, since uniform seeds cannot produce a distinct
pattern. **Restart** alone clears the history and repeats the chosen seed.
The exact seed number and density remain editable. These seed edits prepare the
next Restart (or the queued seed's next Play); they do not silently replace an
already evolving row. Play/Pause, Restart and New seed preserve other sources
and do not arm Audio.

Compared with the original Automatapoeia instrument:

| Feature | BLECH MIDI behavior |
| --- | --- |
| Rule catalog and thumbnails | Same 256 elementary and 64 totalistic rules, search, symmetry filters, Previous/Next, boundaries and transforms. |
| Play/Pause, Restart and New seed | Independent MIDI transport. New seed now preserves history like the original; Restart clears it. Paused actions prepare a seed until Play. |
| Width | 8–128 MIDI pitches; original uses odd widths of 25–127 cells. |
| Generation speed | 1–8 rows per shared beat; original uses 1–24 generations per second. |
| Sound generation | SoundFont instruments, MIDI velocity/articulation, shared note and audio effects. The original's seven synthesis models, ADSR, cell polarity and connected-form sound objects are not direct MIDI equivalents. |
| Sound mappings and presets | Original pitch-response/frequency curves, timbre/contour mappings, phrase spread/swing/gate and complete sound presets are not mirrored one-for-one. MIDI effects supply some timing and pitch transformations. |
| MIDI-specific additions | Editable numeric seed, drawing-row seed, performed-history capture to a pad, and downloadable MIDI. |

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
controls, not cellular generation controls; BLECH MIDI instead uses its
SoundFont, Stamp MIDI and live-effects controls for those sound changes.
The MIDI generator remains distinct from the
[standalone Automatapoeia instrument](../automatapoeia.html).

## Pattern mapping and source details

The 30 generated pictures include Heart, Square, Zigzag, Polka dots, Plaid,
Stripes, Drips, Glob, Glooob, Noise, Scatter and Explode. Their thumbnails show
actual pitch/time cells, positioned across the full MIDI pitch range. Density
changes stroke thickness or particle count; **Width →** covers 12–128 chromatic
notes and **Height** spans ¼–64 beats. Height stretches the picture in time;
it does not change the tempo. The **Offset ↔** slider moves the whole picture
left/right in pitch, stopping at MIDI's edges without folding or losing notes.
At full width there is no room to move it farther sideways. Width, height and
offset also apply to the next drawing Drop; they leave saved snapshots intact.
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

In the 48×32 preparation grid, pitch increases left to right. The bottom of the picture reaches the keyboard first, keeping the complete image upright in the falling-note stage. Adjacent vertical cells sustain one note. Defaults remain piano,
MIDI pitches 48–95 and ¼ beat per row: four seconds at 120 BPM. There is no
scale snapping. Shape buttons replace the draft with editable original pixel
patterns; they do not rasterize platform emoji fonts. Undo retains 32 edits.

Messages use the existing original 5×7 letters and curated 🙂 😀 ⭐ ❤ ◆ symbols.
**Rows of text** fits up to eight characters alongside each other and continues in
rows; **Letters in sequence** uses a separate time window for each character. Up to
32 characters are supported, lowercase becomes uppercase, and skipped symbols
are reported in the draft preview. **Drop text** launches the prepared score and
adds it to Layers and Your pads. The separate
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

### Bespoke MIDI artwork creator

Open **MIDI artwork creator** below the drawing and Automata workbenches. Import
a local raster image (up to 16 MiB), copy the current drawing, or generate a
ribbon/cloud. The image is mapped into at most 128 pitch columns and 256 time
rows, reading upward from the bottom. Threshold, inversion, dimensions, pitch
range, duration and brightness-to-velocity determine the actual MIDI notes.
Images stay in the browser; animated formats use the decoded first frame.

Up to eight layers overlap in one rectangular preview. Inclusion toggles affect
the exported score; faint original notes show what a transformation changed.
The script dropdown explains each operation: original, up/down/ping-pong
arpeggiation, ratchet, pitch/time mirror, seeded scatter, strum, canon/echoes,
time quantization, sine/zigzag ribbons and seeded note clouds. These are 14
built-in browser choices, not an interpreter for FL Studio Python scripts.
Randomization is reproducible from its seed.

Pitch paths, velocity and note-length curves alter individual MIDI notes. They
are discrete score transformations, not continuous pitch-bend or CC automation.
Export produces a type-1 SMF with separate layer channels and piano programs.
**Send** captures an immutable score into the playable pad bank, with its own
Loop checkbox and tap-to-stop behavior; clearing/editing the creator leaves
already sent pads intact. It shares Blech's tempo and explicitly armed Audio.
Limits are 32,768 notes and 512 beats; exceeding them produces an error instead
of silently deleting notes.

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
Mixer and BLECH MIDI use the shared tempo. A gate limit shortens key holds;
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
