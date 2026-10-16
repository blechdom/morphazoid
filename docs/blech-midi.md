# BLECH MIDI

[Open BLECH MIDI](../blech-midi.html). Drawing, black MIDI and geometric stamps,
words, MIDI artwork, the Black MIDI file player and live Automatapoeia evolution
share one falling-note stage. The light-trail visualizer, ordinary file player and two-deck
mixer remain in [Midiophilia](../midiphoria.html).

## Prepare, position, Drop

The five generator views are **Math**, **Files**, **Frames**, **Text** and
**Automata**. Math opens first with a prepared equation. **FX** and **Visualizer** are separate output settings. Credits,
reference material and setup information live at the bottom of the page.
Changing views preserves drafts and keeps the other sources playing.

Each generator uses the same **Send Drop** strip: choose **1** for a one-shot or
**Loop**, then press **Drop ↓**. Preparation is silent. Selecting a stamp or
preset shows a movable copy over the visualizer; it does not launch that copy.
Drag left/right to transpose the entire phrase and up/down to set its start
delay in master beats. The numeric Pitch and Delay controls do the same thing.
The default delay is two beats; zero starts immediately. Delay is bounded to
0–64 beats in quarter-beat steps. Pitch movement stops at the keyboard's edges
without folding notes together. Full-width shapes have no room to transpose.
Arrow keys move a focused preview; Shift makes larger moves. Drag the square
edge or corner grips to resize the prepared block. **Width** compresses or
expands its pitch span; **Height** stretches the complete MIDI timeline in
beats. The numeric fields offer the same controls. Resizing changes the next
copy, preserves note attacks and controller messages, and leaves playing
layers alone. **Rotation** turns the pitch/time coordinates before encoding the
MIDI: a horizontal chord can become a time sequence, and a half turn reverses
both pitch contour and attack order. The result fits within the chosen Width
and Height; it is not a CSS rotation. **Reset block** restores its natural size
and initial position.

The small **Channel** menu retains Original routing or sends the copy to MIDI
channel 1–16; channel 10 is percussion. **Instrument** retains Original programs
or selects a GM instrument. **Volume** sets that new layer's gain. These settings
are independent of the GM SoundFont bank, master output volume and existing
layers. Frames subviews share their next-drop settings. Choosing a channel does
not request an external MIDI device.

After Drop, the prepared overlay hides and the new layer appears in **Layers**,
queued until its delay expires. The falling forecast then reaches the keyboard
when its notes sound. A finished one-shot keeps its closed spigot and layer
controls for replay; a loop continues until closed or stopped. Edit another
draft while that snapshot plays. The floating Loop
and Drop controls perform the same actions as the strip. **Stop** in Send Drop
ends that generator's layers; Frames includes all its subviews. Files Stop also
stops the full-file transport, and Automata Stop pauses live evolution. Use an
individual layer's **×** to remove only one copy, or **Stop all** for everything.
None of these actions arms Audio: use the masthead Audio control explicitly.

## Spigots and the playable falling canvas

The stage has three gesture modes: **Select**, **Stamp** and **Draw**. Select
keeps preparation and layer editing available. Stamp places the current
prepared pattern directly above the keyboard. Draw makes a stream of notes as
you hold and move the pointer; holding still repeats the same pitch. These
gestures start a source without a second Drop action. A higher placement gives
notes more time to fall before sounding. The keyboard remains a separate
playable surface.

A gesture occupies one live layer. Repeating brushes retain up to 4,096 notes;
dense, full-length or multiport patterns place one intact copy instead of
repeating. Releasing normally honors Loop; cancelling the gesture finishes its
committed notes once without starting a loop.

Each source has a persistent **spigot** on the stage. Select one to move its
pitch and delay, resize its pitch span and phrase length, or rotate its actual
MIDI. Multiple spigots can share the same stage. A loop edit takes effect on the
next pass, preserving the current pass. Closing Loop lets that pass finish;
Play can start the source again. Pause freezes its transport. Removing a
source with **×**, or using **Stop all**, stops it immediately.

Spigots retain their original source score, so repeated edits do not repeatedly
round or distort the previous result. Instrument, channel, gain and pan remain
per-layer controls. The shared tempo and explicit Audio control still apply.

**Frames** contains **Stamps**, **Drawing**, **Images**, **Scripts** and
**Sequence**. Stamps uses a searchable thumbnail pulldown showing one selected
stamp when closed. Drawing prepares freehand geometry. Images converts local
images into notes. Scripts copies the selected stamp, drawing or image for
processing; **Use source** adds a copied source, while choosing Image reuses the
latest image layer without duplicating it. Images and Scripts share the same
prepared artwork. Sequence arranges captured drawings and rests into a clip.

## Black MIDI file player

The persistent falling-note stage stays beside the preparation tabs on laptops and above them on phones. **Files**
contains a native collection-grouped menu, Next, Random and local imports.
The shallow horizontal MIDI-file strip keeps Play/Pause, Stop, Volume, File BPM,
Link, Ratio, Speed, Loop and Original together. On narrow screens it scrolls
sideways. Volume also controls the playable keyboard; Stop ends only the file.
Changing tabs, preparing another drawing, changing colors, or pausing
Automatapoeia does not stop the file. **Stop all** stops every source.
Changing files preserves an already-running file transport.

Files has two playback routes. Its channel strip plays the complete selected
file independently. Shared **Drop** instead makes a separate finite layer when
the source fits the layer limits: 2 MiB, 32,768 notes, 131,072 events, 16 channels
and 512 beats. An oversized source reports why Drop is unavailable; the full
file player remains available. A layer uses the selected score itself, including
decorative notes, rather than substituting a separate AUDIO edition. Layer
drops share Master tempo; the full-file strip retains its Link/File BPM/Ratio
settings. Local uploads join the Files menu for this session.

**Preview score ↓** beside a prepared drawing or in the MIDI art creator loads
an independent snapshot into the falling-note player. It does not send a pad,
arm Audio or alter pads already looping. Press the player's Play button after
turning Audio on. Sending and previewing have separate transport ownership.

The file synthesizer borrows Blech's AudioContext and feeds the same filter,
delay, master volume and final peak limiter as the pads and Automatapoeia.
The SoundFont picker and MIDI note effects apply to file playback too. File
volume balances the file and keyboard before the shared output. Audio remains an
explicit page-wide action; stopping a file does not close the shared context.
Synthesizer-specific live-pad parameter edits remain with their pad source.

By default, the file uses its original tempo. Edit **File BPM** for an independent
tempo, or enable **Link** to follow Master. **Ratio** offers exact eighth, quarter,
third, half, two-thirds and faster multiples through 64×; **Speed** adjusts that
same multiplier continuously. The status shows the resulting initial BPM after
the ratio. **Original** unlinks and restores the source tempo at 1× without
stopping playback. The Tap buttons follow their displayed tempo or ratio base.
The combined playback rate is limited to 0.01–64×, with clipping shown explicitly.
File BPM accepts up to 4,800. A 120 BPM file at 64× runs at an initial 7,680 BPM;
Link and Ratio share the same combined 64× limit.
Variable-tempo files retain their tempo changes: this scales the original tempo
map rather than rewriting it or aligning bars. SMPTE-timed files have no musical
BPM; Link and File BPM are disabled while the speed ratio remains available.

With Audio on, moving the mouse across the piano plays its keys. Touch and pen
use press-and-drag. The keyboard uses the selected SoundFont's piano; its volume
is the MIDI strip's Volume knob. Leaving the keys, releasing a touch, losing focus,
Audio off or Stop all releases held notes. Keyboard focus supports arrow keys
(semitones or octaves), Home/End and Enter to play. Fast movement uses the actual
pointer samples received; it does not insert unobserved notes between them.

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
SoundFont release tails. Shared Drop uses the chosen start delay; a zero-delay
drop starts immediately. The visualizer follows that timing rather than adding
its own delay.

This view uses **WebGL2**, with Canvas 2D fallback after GPU unavailability or
context loss. Generated pads and live evolution are composited into this same stage; Midiophilia light/trail views remain Canvas 2D. It does not use
WebGPU or Vulkan. [Vulkan](https://www.vulkan.org/) is a native GPU API, used by
tools such as Wasabi; our browser GPU path is WebGL2. This is an original
Piano From Above-style presentation, not a port of that application.

The persistent title row shows **File played** (notes reached / total) and **Generated notes**.
The file count follows its playhead, including seeks and each loop. Generated
notes accumulate across layer loops, live Automata and keyboard attacks; stopping
a layer keeps its count. The reset arrow clears only the generated counter and
does not interrupt playback. Pending drops and held-note rejoins add no attacks.
These are source-note counts before MIDI effects and synthesizer voice limits;
they do not depend on how many rectangles fit on screen. If a file exceeds the
preview limit, its total remains visible but its passed count is unavailable.

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
explicitly silent visual transport with pause, seek, loop and adjustable speed.
The complete scores are kept out of the bounded mixer/stamp selectors.
See [artist sources and Nancarrow findings](../assets/midiphoria/ARTWORK-SOURCES.md)
for provenance, redistribution terms and exact independently checked counts.

Black MIDI displays the original source score before MIDI effects. Generated pads, their upcoming loop cycles, and projected Automatapoeia rows share the same stage and 128-key keyboard. Forecasts use the current source clocks; switching tabs never changes them. Generated forecasts include the current note effects. Full-file statistics remain file statistics, separate from generated layers.


## Independent layer transports

The title row shows **File played** (notes reached / total notes in the selected
file) and **Generated notes** (layer, live Automata and keyboard attacks since
reset). The file count follows seeking and loops; the generated count accumulates
repeated loops. Neither count is the number of notes sounding simultaneously.

The circular master **Play/Pause** beside **Master BPM** and **Tap** pauses the
running file, layers and live evolution together. Resume restores those sources
from their paused positions; layers paused individually stay paused. With no
paused performance, Play starts the selected file in Files or sends the prepared
generator. Audio remains separately armed. **Stop all** ends the performance.

The file's own transport, volume, tempo, Link, Ratio, Speed, loop and position
controls live only in **Files**. File playback and its visualizer keep running
when you switch to another tab.

The **Layers** rack stays with the visualizer. Each Drop creates a named layer
with a distinct number, even when two drops use the same equation. **Pause**
freezes only that layer's position and releases its notes; **Resume** continues
from that position. **×** removes that layer immediately. Its saved snapshot
remains under **Saved drops** at the bottom of the page. Other layers, the
full-file player and live Automata keep their own transport states.

Each short channel strip contains **M** (mute), **S** (solo among dropped
layers), **↻** (loop), a volume knob, a MIDI channel menu and a pan knob. Mute
and solo silence layers while their timing keeps running; unmuting rejoins
their current position. Multiple solo layers can play together. MIDI channel
changes reroute that layer's notes and controllers without restarting it. Pan
moves its sound left or right relative to the source MIDI pan. The tiny
note-activity map tracks progress; muted strips turn grey.

Each active layer has a **Loop** switch: switching it off finishes the current
pass. **1 / Loop** in Send Drop sets the next copy's playback without changing
existing layers. Stop ends a loop immediately.

The rack holds four active, queued or paused layers. A fifth Drop replaces the
oldest playing layer; paused layers are retained. If all four are paused, stop
one before adding another. **Stop all** remains the page-wide recovery action.
Up to 16 spigots retain their source for replay; adding more replaces an idle
spigot first. This does not increase the four simultaneous playback slots.

## Drawing, stamps and Text

Open **Frames → Drawing**, draw or choose a shape, position its prepared overlay,
then use shared Drop. Editing prepares the next drawing while the sent copy
keeps playing. **Load as file** explicitly replaces the file-player selection.
**Download MIDI** saves the last dropped drawing; editing hides that stale link.

The master Play/Pause is the primary Space transport outside editable
controls and never arms Audio. Inside the drawing canvas, arrows move, Space or
Enter paints, Delete erases, and Ctrl/Cmd+Z undoes. One captured stroke is one
undo action. Both generator and Frames tabs support Left/Right and Home/End.

The stamp pulldown combines generated textures and bundled black MIDI/geometric
files. Its filter searches names and collections; each result
has a thumbnail. Selecting prepares a copy. Shared Drop launches it. Selecting
another file cancels an unfinished preparation download without stopping
already-playing layers. Wave, Zigzag, Braid, Stripes, Chevrons, Lattice, Mesh
and Ladder fill the phrase and match at the top and bottom, so repeated copies
form continuous contours. Hearts, stars and other literal shapes retain their
separate silhouettes.

Each Drop saves an independent snapshot, including drawings, messages, equations
and captured evolution. The collapsed **Saved drops** list at the bottom of the
page retains compact replay controls: tap to start or stop a
loop, resume a paused pad, or retrigger a one-shot. Their Loop switches affect
that saved pad and its current playback.
**Remove** stops and removes only that saved pad; **Stop all** leaves the bank
available. The bank holds eight sends for this page session. A ninth replaces
the oldest stopped pad; navigation/reload clears the bank. **Edit** reopens Text
pads in Text. Other pads copy into the 48 × 32 drawing grid, simplifying timing
and pitch detail while retaining the original saved MIDI. Dropping that draft
creates another layer.

**Text** has a multiline **Write text** box, **Clear text** and an exact MIDI
preview; shared **1 / Loop** chooses the next drop's playback. Enter inserts a deliberate line break;
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

Shared **Drop** adds an independent Text copy. **Edit** beside a Text layer or saved Text
pad restores its message and layout. Change width, duration, position, lettering
or text, then **Apply next loop**: the current pass finishes and the new version
starts on that layer's next loop. Repeated Apply replaces the queued update.
Queued layers can update before starting; paused layers update while staying
paused. Playing one-shots offer **Restart this layer**. Turning off Loop cancels
a pending update and finishes the current pass. Stop also cancels a queued edit;
the saved pad retains its last applied text. Shared **Drop** layers another
copy instead. Other sources keep their positions and play/pause states.
The stamp Density/seed/Key gate controls do not affect Text;
shared FX processing still applies during playback.
The shared shape controls belong to Frames → Drawing and Stamps. The old live trail
canvas and Paint flow gesture remain in Midiophilia.

## Math and frame sequences

**Math** prepares `y = f(x, t)` or parametric `x(t), y(t)` curves. The bank has
54 presets: the original six plus 48 new waves, steps, folds, knots, flowers and
spirals. Sixteen are marked **evolves**: they grow, shrink, accelerate or morph
through one drop. In function mode, `t` and `phase` run from 0 to 1 across the
output duration, independently of the input domain. In parametric mode, `t`
retains the domain parameter and `phase` measures traversal from 0 to 1.
Changing Length stretches the complete score and its evolution together.
These are prepared note patterns; live playback does not reevaluate formulas.

Edit the expression, domain, duration, samples, stroke width, note length,
pitch range and velocity, then use shared Drop. The searchable preset menu
shows a small formula-shape thumbnail and marks evolving patterns. Selecting presets and editing
equations only prepare the preview. The bounded arithmetic parser allows no
assignments, property access or dynamic code. Limits are 256 characters, 192
tokens, 24 nesting levels, 1,024 samples and 16 notes per sample. Invalid
expressions disable Drop; non-finite/out-of-bounds samples are omitted and
counted. An empty result also disables Drop. No external graph service is used.

**Frames → Sequence** holds up to eight immutable drawing snapshots. **Capture
frame** in Drawing or **Capture drawing** in Sequence adds a frame. Arrange,
duplicate, remove or insert rests, set beats per frame, then use shared Drop.
Edit drawing opens a copy; playing sequences keep their old snapshots.
Animate preview is silent and does not alter the source transport. A sequence
uses one of the four live layer slots and one saved-pad slot.

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

Generated layers and Automatapoeia follow the **30–4,800 BPM Master** knob,
exact BPM field and shared Tap control. The MIDI file follows Master only while **Link** is enabled.
Each layer retains its own position and Loop setting. Shared **1 / Loop** sets
only the next Drop. Turning an individual layer's Loop off finishes its current
pass; its Stop button ends it immediately without interrupting other sources.

**Stop all** stops the file, removes active pads and pauses Automatapoeia. **Audio off** releases
pad playback but keeps the live automata transport evolving silently. Enabling
Audio joins the current evolution. Audio never arms through Send, Play, seed
selection, Capture or Restart. Up to four clips play alongside the independent
live generator; another pad replaces the oldest playing clip. Its saved
snapshot remains available. Stopping a source cancels its own pending
MIDI-effect echoes and leaves other sources moving.

Generated drawings, patterns and rules default to piano; file stamps can retain
their original instruments. **Drop volume** sets the next copy, and each Layers
row has its own volume. Automata has its own live volume and instrument
selector. Masthead Output controls the final mix. Source programs,
controllers, pitch and velocity are retained where supported; selecting a
channel or instrument changes that new copy's routing or voice.

**GM SoundFonts** is visible in Files. Its General MIDI group offers
TimGM6mb, GeneralUser GS 2.0.3, FluidR3Mono GM and FluidR3 GM, each with all 128
instruments; specialist banks and saved imports appear separately. **Browse &
preview** opens the Sound Fonts library. **FX** retains live effects and
a shortcut to the bank chooser. Choose a bundled bank or a saved font, import a
local SF2/SF3 file up to 128 MiB, or restore TimGM6mb. Accepted imports join the
[shared browser library](shared-sound-fonts.md). Choosing a bank preserves the
current Audio state; enable Audio explicitly to hear it. Banks stay in this browser;
loading errors keep the previous usable bank. Filter frequency, echo mix,
beat-based echo length, feedback, and the existing SoundFont reverb/chorus
parameters update the same engine used by drawings, stamps, messages and rules.
Editing either work area preserves these settings. **Reset effects** restores their defaults
without stopping the patterns or changing Audio, output level or the SoundFont.

## Live Automatapoeia

The **Automata** generator contains live Automatapoeia with an independent
**Play/Pause** and the same Master tempo as the layers. **New seed** and Restart
sit near the rule/transport controls so the starting pattern is easy to change.
Every row is computed from the previous row on the audio clock, without repeatedly
launching sample clips. Pause
releases only its notes and pending effects, retaining the generation and
within-row phase. Resume continues that row's remaining time. The output shows
its notes alongside every playing pad, with a distinct source color.

Shared **Drop** is a separate action: it generates a finite clip from the
prepared rule, seed, width, row count and articulation. That clip can be moved,
assigned a channel/instrument and played once or looped in Layers without
starting, pausing or resetting live evolution. It begins from the prepared
seed, not from the current live row. To keep an actual performed passage,
use Capture to pad instead. Automata **Stop** in Send Drop stops its finite
layers and pauses its live stream; a layer's Stop affects only that clip.

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
are reported in the draft preview. Shared **Drop** launches the prepared Text score and
adds it to Layers and Saved drops. The separate
Words & symbols file-generation feature remains in Midiophilia's visualizer.

Automatapoeia maps each column to one chromatic pitch. Its seed row plays first.
Retrigger attacks every active cell; Hold joins consecutive cells at the same
pitch. Captured pads retain the performed note gates. Shared Drop uses the
existing finite MIDI rule generator without changing its published default
MIDI bytes; live evolution remains an independent source.

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
512 beats, 131,072 events and 2 MiB per generated/excerpted sample. Dense file stamps use bounded
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

Open **Frames → Images** to import a local raster image (up to 16 MiB).
**Frames → Scripts** selects Drawing, Stamp or Image as the input for processing.
Use source copies the drawing/stamp; Image reuses the latest original image
layer. Both views share their layers and processing settings. The script menu
can also generate a ribbon/cloud without an image. The image maps into at most
128 pitch columns and 256 time rows, reading upward from the bottom. Threshold,
inversion, dimensions, pitch
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
Shared **Drop** captures an immutable score into Layers and the saved stamp
bank, using the chosen channel, instrument, volume, position and **1 / Loop**
setting. Clearing/editing the creator leaves sent copies intact. It shares
Master tempo and explicitly armed Audio.
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
