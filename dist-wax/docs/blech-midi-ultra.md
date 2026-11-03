# BLECH MIDI ULTRA

[Open BLECH MIDI ULTRA](../blech-midi-ultra.html). Saved from the in-progress
[BLECH MIDI](../blech-midi.html) playground on November 3, 2026. This page,
its BLECH-owned modules, styling, mark and guide are separate copies so work
on BLECH MIDI need not change this version. Shared MIDI Mixer, Midiophilia,
SoundFont and site infrastructure remain shared.

Drawing, black MIDI and geometric stamps,
words, MIDI artwork, the Black MIDI file player and live Automatapoeia evolution
share one falling-note stage. The light-trail visualizer, ordinary file player and two-deck
mixer remain in [Midiophilia](../midiphoria.html).

## Prepare, position, Drop

The full-width playground puts the transport beside a joined icon toolbar:
**Free Draw**, **Free Stamp**, **Free Text**, **Free Math**, **Workbox**, **Automata**, **File**,
**Effects**, **Loop Select**, **Eraser**, **Trash**, **Restore
workbox**, **Layers**, **Settings**. The labels and hover hints explain the
icons. A centered Math workbox is ready on load, with its formula popup closed.
The main Free Math icon opens pictured math shapes. Choose one, then move it
over the playable area and tap/click to place it once; tap again for another
copy. The outline follows pitch and time until placed. Arrow keys move the
preview, Enter places, and Escape cancels. Nothing plays just from opening or
choosing a shape. The corner arrow opens the formula controls and an explicit
**Workbox** action for editing and looping. Effects opens its own drawer;
Settings opens MIDI channels, SoundFonts and visualizer controls. Choosing
another tool keeps existing sources playing. The four Free tools play or drop
directly without opening a workbox;
Workbox shows **Draw**, **Loop Stamp**, **Text**, **Math** (fourth) and **Add +** beside the frame,
not another workbox. Choose a pictured Math shape and tap inside the same
silent frame to add it; switch tools to keep decorating before Drop. Add + offers prepared notes, a fresh empty box,
and the optional grid, images, scripts and sequences.

The transport has Play/Pause, the 0–1000 BPM dial, exact BPM entry and Tap.
Play/Pause pauses running sources without deleting layers; Trash clears layers
and any live Free Draw or rail notes.
The dial devotes most of its turn to 60–300 BPM. Zero pauses running
sources; raising the tempo resumes the sources it paused. The exact input has
no UI maximum, although the playback engine bounds positive tempo to
30–4800 BPM. In Piano layout, all 128 pitches have their own adjacent
rectangles: the black keys are narrower, not painted over the seams between
white keys. The white-key width-to-height ratio stays constant as the graphic
is stretched, including on narrow phones. Falling notes, drawing and the
top rail use these same pitch boundaries.

Prepared generators use a silent **workbox**: turn **Loop** off for a one-shot or
on to repeat, then press **Drop ↓** to make a layer. The unboxed, adjoining
toolbar has Drop ↓, Loop, a green disk/check (save directly to Layers), a
**ch1 ▾** (opens the nearby MIDI channel and instrument picker), an inline volume knob
with a 0–127 readout, Reset and ×. A Math workbox adds a picture preset menu and
Math-only controls alongside these shared actions. Its formula popup follows
the frame's top-right corner, with a scrollable above/below fallback on narrow
screens. Geometry lives on the frame, not in a settings popup. Clicking away *tucks* a draft without playing or deleting it;
the square toolbar icon restores it. Closing the drawer instead leaves the
workbox visible so you can use all its grips. **×** discards it; neither action
is a Drop. **Free Draw, Free Stamp, Free Text and Free Math** act directly without
opening a workbox; none automatically loops. **Workbox**
starts with an empty, silent rectangle. Choose the Draw, Stamp, Text or Math icon
by the frame's top-right corner to add strokes, stamps, pixel-letter words or formulas
in the same box. Math's fourth icon opens pictured formulas and places them
in that box rather than creating a second frame. The pencil, stamp and Math
corner arrows open their brush and picture options without adding another toolbar row.
Click an active icon again (or press Escape on the paint surface) to move and
resize the frame. Type once, then click to place silent copies. **Add + → Add to box**
copies a previously prepared Math, Type, Stamp, File, Automata, Drawing or Loop
Select shape into the same box. Visit a generator and return to your unfinished
box; **New empty box** starts over. Choose Loop, channel and instrument before
dropping. Nothing sounds until Drop; an empty box cannot be dropped.
**Reset** clears additions to an empty workbox and restores its starting frame,
channel, instrument, volume and Loop. For a Math draft it also restores the
current preset's note strength, stroke width and gate; it leaves the source
formula or file in place. Playing layers are untouched.

Selecting a stamp or preset shows a movable copy over the visualizer.
Drag left/right to transpose the entire phrase and up/down to set its start
delay in master beats. Focus the frame and use arrows for precise changes;
Shift makes larger moves.
The default delay is two beats; zero starts immediately. Delay is bounded to
0–64 beats in quarter-beat steps. Pitch movement stops at the keyboard's edges
without folding notes together. Full-width shapes have no room to transpose.
The first Math preview starts centered at 48 pitches wide and four beats tall
instead of filling the keyboard; its handles have room on all sides. Changing
the equation replaces the notes *inside* the chosen frame, not its size or
position—even for flat or narrowly pitched expressions. While an expression
is incomplete, its last valid preview remains in place and Drop is disabled.
Reset returns to the approachable starting frame. Drag the square edge or corner
grips to change pitch span or stretch the complete timeline in beats. Focus
a grip and use arrows for precise changes. Resizing changes the next copy,
preserves note attacks and controller messages, and leaves playing layers alone.
Drag the rotation handle (or use its arrow keys) to turn pitch/time coordinates before encoding the
MIDI: a horizontal chord can become a time sequence, and a half turn reverses
both pitch contour and attack order. The result fits within the chosen frame;
it is not a CSS rotation.

The channel number opens a compact menu: Original routing or MIDI channel
1–16 (channel 10 is percussion), plus Original or a GM instrument. Drag the
adjacent volume knob vertically or use its arrow keys to set 0–127 for the
next layer's gain (95 by default). It scales layer loudness, not MIDI note
velocity. These settings
are independent of the GM SoundFont bank, master output volume and existing
layers. Draw options share their next-drop settings. Choosing a channel does
not request an external MIDI device.

After Drop, the prepared overlay hides and the new layer appears in **Layers**,
queued until its delay expires. The falling forecast then reaches the keyboard
when its notes sound. A finished one-shot keeps its layer controls for replay;
a loop continues until closed or stopped. Edit another
draft while that snapshot plays. The floating workbox toolbar handles Loop and Drop.
Files Stop ends only the file transport; Automata has its own Play/Pause.
Use an individual layer's **×** to remove one copy or **Trash** to delete all.
None of these actions arms Audio: use the masthead Audio control explicitly.

## Spigots and the playable falling canvas

Click the **pencil** for immediate Free Draw notes. Its corner arrow opens
Pencil, crosshair Line, Rectangle, Ellipse and Triangle. To draw a Line,
click successive anchors: each click connects to the previous one. Move the
pointer to preview the next segment, then double-click to finish and drop the
entire path once (Space also finishes; Escape cancels). Drag Rectangle, Ellipse
or Triangle to preview its MIDI notes; releasing drops that shape once. Shape
tools offer Outline or Solid; consecutive vertical cells become held gates
instead of thousands of repeated attacks. Inside **Workbox → Draw**, the same
Line anchors and shapes stay *silent* until the box's Drop. Free Draw and Workbox
Draw remember their own drawing tool; the right-hand Draw icon uses the same
pencil shape as Free Draw. Its neighbors select Stamp and Text. The brush popup's
Size slider (1–8) grows pitch width and time height together; the preview shows
the actual MIDI nib. Drag the slider or use arrow keys to adjust it. Square,
Circle or lightly scattered Spray nibs and note strength (MIDI velocity) are
also available. Solid fills ignore nib holes; Repeat and the
double-click latch apply only to the live freehand Pencil. **Free Stamp** has
its own icon for one-shot placement; its bottom caret opens a secondary toolbar
with a searchable picture menu (tiny thumbnails), Width (notes), and Height
(beats). **Workbox → Loop Stamp** has a stamp-with-arrow icon; its bottom caret
opens just the picture menu and a size knob (¼–4×, with 1× original). The knob
scales pitch width and beat length together. The right-hand Stamp button reuses its
selected stamp and enables workbox Loop by default, but
stays silent until Drop, and can add several copies to the same box. Free Stamp's
blank Width/Height fields or ↺ restore its original size; Loop Stamp's 1× does
the same. Oversized pictures
fit inside the workbox without losing notes. Both menus are separate from the
pencil popup.
Choose a MIDI channel in a workbox or Layers, not on the Free Draw brush.
There is no separate Select button: click a layer's name or activity map to edit
its floating rectangle. The keyboard remains a separate playable surface.

**Free Draw Pencil** sounds as you draw: a quick click makes one short note
(normally 1/16 beat). Holding still extends that note until release; moving
across pitches sends successive notes, not a simultaneous chord. Vertical
movement changes their timing; moving vertically on one pitch leaves a line of
timed notes. Sharp turns, zigzags, crossings and closed strokes follow the
whole pointer path, even when the browser groups several moves together.
You can draw back down below the height where you started: the start height
is recorded in the notes, not used as the earliest possible playback time.
Points that have already passed the keyboard cannot be sounded retroactively.
Free Draw leaves no static sketch or layer behind: its MIDI notes fall and
sound once, then expire. Geometry shows a temporary preview only while dragging.
Release ends the one-shot gesture; nothing restarts and no frame opens.
Choose **Repeat** in the brush popup to pulse
notes at the selected beat interval *while pressed*; release stops the pulses.
Double-click in Repeat mode to latch a pulsing note instead. These gestures
do not create Layers or borrow the next workbox's **1 / Loop** setting.
A higher starting position gives notes more
time to fall before sounding. Free Draw notes keep falling while you sketch;
no trace of the pencil stroke stays on the stage. Use
Workbox → Draw when you want the picture to repeat in an editable box.

Double-click with Pencil to latch a single **Held note**. Its gate stays open
without repeated attacks; an instrument such as piano may still decay naturally.
An outlined note grows below the keyboard while that gate remains open, even
with ordinary past trails hidden. Pause or mute ends its outline; resuming
rejoins the note with a new outlined segment but no additional counted attack.
Master Pause releases it; Resume rejoins it. **Trash** removes it with all
other notes. For an individually editable note, use a Workbox instead.

The **grey note rail** in its own row below the tools, above the falling graphic,
works with any selected tool, even while a workbox is open. Tap a pitch to repeat one note every quarter
beat; keep pressing before release for slower pulses (½, 1, 2, 4 or 8 beats).
The note is on for half a cycle and off for the other half. Double-tap at the
same pitch to replace that first pulse with one sustained note; its rail mark is
outlined and its note grows an outline below the keyboard while held. In Piano
alignment each black or white key has a separate, filled rectangle across the full rail
height; black-key rectangles are narrower. Equal alignment uses 128 even columns.
A colored mark stays inside each active note's pitch rectangle in the
rail: tap it again (after the double-tap window) to remove that note. Arrow
keys choose a pitch (Shift moves an octave), Enter or Space can be held to set
the rate, pressing twice sustains, and Delete removes the selected pitch.
The master MIDI clock drives the notes, not a visual timer. Rail notes do not
create Layers. Four active MIDI clip slots are available: a fifth rail note
reports that limit rather than
replacing another sound. Rail notes keep their slots when other tools start
layers. The rail never turns on Audio.

**Workbox → Draw** lets you draw a silent, editable box directly above the
keyboard. Release the pointer to inspect or add another stroke; choose Loop to
repeat it, then explicitly Drop. Switch to **Workbox → Loop Stamp** to add stamps
without replacing earlier strokes. **More sources** opens the optional drawing
grid, prepared stamps, images, scripts and sequences. **Loop Select** captures notes *already performed* in
the previous four master beats (even with past trails hidden); it opens an
editable workbox without changing the original performance. Catch again
updates that draft. It cannot select unheard future notes.

The narrow grey **Comb** at the left of the falling graphic makes a horizontal chord
across the full 128-pitch keyboard. Tap anywhere on the bar to play every pitch
immediately; keep holding to preview repeating blocks across the pitches:
one note on / one off (after about 0.42 seconds), two on / two off (after about
1.42 seconds), three on / three off, and so on up to eight on / eight off.
The leftmost pitch starts each pattern on. Drag up before release to delay the row.
Each release makes one quieter, quarter-beat one-shot row without a layer.
A small square appears on the left rail while its notes play, then disappears.
The whole bar accepts a press, including near the keyboard. Double-click the
rail to cancel the two quick rows and stop the last active Comb row. Other
sounds are untouched. The same on/off blocks repeat *across the pitches*, not
over time. Only the upper corner makes a repeating version of this pattern.

The small **grid square** where the left Comb meets the top note rail switches
**Both rails** on and off. It repeats the most recent Comb's selected pitch blocks
at the beat subdivision shown in the square. With no Comb row yet, a quick tap
loops all 128 pitches together every **1/8 beat**. Hold the square before release
to choose 1/4, 1/2, 1, 2, 4 or 8 beats between rows; the note gate occupies
half of that interval. The chosen rate stays displayed for the next quick tap.
Tap again to stop and remove *only* that repeating grid; one-shot Comb rows and
top-rail notes remain. To change a running grid's pitch blocks, stop it and tap
the corner again after selecting a different Comb block. The grid's default
gain is low because the simultaneous attack is dense. It uses one reserved
audio clip, not 128 separate clips or a layer. If all
four sound slots are occupied, remove a sound before switching it on; it never
steals another layer or rail note.
Pause and Resume retain the square's selection; tap it again or use Trash to
clear it. It never turns on Audio.

Choose Free Stamp, then click above the keyboard to place it once. Holding the
pointer repeats the stamp into one longer phrase; release ends it without looping.
Each stamp goes straight to Layers without raising a frame over the next click;
select its row in Layers if you want to edit that copy.
Dense, full-length or multiport patterns place one intact copy instead of
repeating. Pencil and repeating stamp captures retain up to 4,096 notes;
cancelling a capture lets committed notes finish once without starting a loop.

**Eraser** selects the newest layer if none is selected. Drag across its notes
to remove the notes you touch; other layers keep playing. Erasing its last note
removes the layer. Select another layer from the rack before erasing that layer.

Each layer has one compact, single-line strip. Select its name or activity map
to show that layer's floating **spigot** rectangle. Only the selected rectangle
is shown; the other layers keep playing. New drops select themselves. Choose a
generator tab or the rectangle's checkmark to return to preparation. Selecting
a layer on a phone or short screen tucks the tool drawer so the frame is clear;
reopen its generator to return to the prepared workbox. On very short or narrow
frames, colliding middle grips yield to corner grips. If a playing layer's
frame is too small for grips, drag its outline or open that layer's gear for
exact edits; the undropped workbox uses its frame handles.
On shallow touch screens, remove a source from expanded Layers instead of
crowding its on-frame transport. A full-width frame also leaves its border
grips to the gear so they cannot collide with the stage controls.

A looping Workbox Drop keeps its frame while it loops. Free Draw and the rails
stay unboxed and out of Layers; use Workbox → Draw for an editable pattern.
The frame's small Play/Pause pauses or replays an editable layer; the corner
square alone repeats Comb patterns. **Transform** reveals the existing move, resize and rotation
handles; the playing layer's gear opens the same exact Pitch, Delay, Width, Height, Rotation and
Instrument editor as a layer selected from the rack. The checkmark tucks the
frame away but keeps the layer in Layers; select that row to reopen it.

Drag the rectangle to change pitch and timing, resize its edges to change pitch
span and phrase length, or turn its rotation handle to change the actual MIDI.
These edits affect the running phrase immediately. Resizing retains its relative
playback position; moving upward adds waiting time and moving downward brings
notes forward without replaying past attacks. Other layers keep their clocks.
Its moving line shows the phrase position.

Open the layer strip's **gear** for exact pitch, delay in beats, width in notes,
height in beats, rotation, channel and instrument controls. The editor floats
beside the frame over the graphic; channel, volume and pan also stay in the
expanded Layers mixer. Close it with
its close button, Escape or a click outside. Hovering the canvas never opens a
popup. Geometry and instrument edits affect the selected layer while the others
continue independently.

For repeating phrases, turning Loop off lets the current pass finish; Play can
start the layer again. Pause freezes its transport. Removing a layer with **×**
or using **Trash** stops it immediately. Spigots retain their original source
score, so repeated geometry edits do not repeatedly round or distort the previous
result. The shared tempo and explicit Audio control still apply.

**Workbox → More sources** contains prepared **Stamps**, **Drawing grid**, **Images**,
**Scripts** and **Sequence**, not a separate Frames generator. Prepared Stamps uses a
searchable thumbnail pulldown showing one selected
stamp when closed. Drawing prepares freehand geometry. Images converts local
images into notes. Scripts copies the selected stamp, drawing or image for
processing; **Use source** adds a copied source, while choosing Image reuses the
latest image layer without duplicating it. Images and Scripts share the same
prepared artwork. Sequence arranges captured drawings and rests into a clip.

## Black MIDI file player

The falling-note stage fills the available width; generator drawers overlay it
and can be tucked away. On phones and short landscapes the stage remains fixed
while the tool drawer overlays its lower edge. **File**
contains a native collection-grouped menu, Next, Random and local imports.
The shallow horizontal MIDI-file strip keeps Play/Pause, Stop, Volume, File BPM,
Link, Ratio, Speed, Loop and Original together. On narrow screens it scrolls
sideways. Volume also controls the playable keyboard; Stop ends only the file.
Changing tabs, preparing another drawing, changing colors, or pausing
Automatapoeia does not stop the file. Master Play/Pause pauses them together;
Trash clears layers, live notes and drafts.
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
Audio off or master Play/Pause releases held notes. Keyboard focus supports arrow keys
(semitones or octaves), Home/End and Enter to play. Fast movement uses the actual
pointer samples received; it does not insert unobserved notes between them.

Local import accepts up to 20 files and 200 MiB total per session. Scores above
10 MiB use silent visual playback unless the collection supplies a separate
creator AUDIO edition. The complete score still has the limits below.

**Black MIDI** is the file-based falling-note view in BLECH MIDI ULTRA. Future rectangles descend onto the full **128 MIDI pitches (0–127)**;
choose piano-key spacing or equal pitch lanes. All tracks overlap on the same
keyboard. Track checkboxes isolate only the picture, and per-track color
selectors, six palettes and track/channel/pitch/velocity mappings differentiate
voices. ULTRA (logo green, hot pink, yellow, BLECH MIDI red and blue) is the
default; the other palettes remain available. Switching away from Visuals
preserves the file clock.

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

The upper-right edge of the graphic shows one lightweight trip-style **Notes
played** total for files, generated
layers, live Automata and keyboard attacks since Reset. Repeated loops add to
the total; seeking, rewinding or selecting a file does not count skipped notes.
Stopping keeps the total. The zero-arrow button to the left clears it without interrupting
playback. Pending drops and held-note rejoins add no attacks.
These are source-note counts before MIDI effects and synthesizer voice limits;
they do not depend on how many rectangles fit on screen. Full-file totals and
playhead statistics remain available in the Visualizer's score details.
Files beyond the 12 million-note preview limit have no parsed source timeline,
so their unparsed decorative notes are not included in this total.

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

The graphic's upper-right **Notes played** total combines file, layer, live Automata and
keyboard attacks since reset. It counts repeated loops, not the number of notes
sounding simultaneously.

The circular master **Play/Pause** beside **Master BPM** and **Tap** pauses the
running file, layers, Free Draw and rail notes, and live evolution together. Resume restores those sources
from their paused positions; layers paused individually stay paused. With no
paused performance, Play starts the selected file in Files or sends the prepared
generator. Audio remains separately armed. **Trash** removes the layers,
live notes and drafts.

The file's own transport, volume, tempo, Link, Ratio, Speed, loop and position
controls live only in **Files**. File playback and its visualizer keep running
when you switch to another tab.

**Layers** appears only when its toolbar stack icon is pressed; the number on
that icon counts editable layers, not Free Draw or rail notes. It opens over the usual settings/drawer area without
changing the graphic's size. Press the icon again or the panel's chevron to
close it. Switching tools, starting playback or dropping more notes does not
close Layers; the currently selected tool keeps working outside the panel.
If generator settings were open, they return when Layers closes. Each numbered,
colored activity picture selects its layer's frame. **▶ / Ⅱ** starts or pauses
only that clip, its trash can deletes only that clip, and the panel's fixed
trash can deletes *everything* (layers, live notes, saved drops and drafts), just like
the toolbar Trash. Finished one-shots can be played again. Tooltips and
accessible names provide clip names; the panel has no visible word labels.
Saved-drop strips have their own delete buttons.
**Drop** starts an editable layer with its frame still
visible; the frame's **✓** keeps the playing layer in Layers and closes the frame.
The workbox's green disk/check drops directly to Layers, while **×** discards an unplayed
draft. Each Drop creates a named layer
with a distinct number, even when two drops use the same equation. **Pause**
freezes only that layer's position and releases its notes; **Resume** continues
from that position. Its saved snapshot remains behind the archive icon in
expanded Layers. Other layers, the
full-file player and live Automata keep their own transport states.

The sliders icon on an expanded clip opens its optional mix controls: speaker
slash (mute), headphones (solo among dropped layers), **↻** (loop), volume
and pan knobs, MIDI channel and a gear for geometry and instrument. Only
one clip's details open at a time; Escape closes them. Mute and solo silence layers while their
timing keeps running; unmuting rejoins
their current position. Multiple solo layers can play together. MIDI channel
changes reroute that layer's notes and controllers without restarting it. Pan
moves its sound left or right relative to the source MIDI pan. The tiny
note-activity picture tracks progress; muted clips turn grey.

Each repeating layer has a **Loop** switch: switching it off finishes the current
pass. **↻** on the workbox toggles looping for the next copy without changing
existing layers. Ordinary Free Draw strokes do not loop; a deliberate Repeat
double-click can latch a pulse. A double-clicked Held note is not a layer:
master Pause releases its gate, and Trash clears it. Removing a layer ends its
loop immediately.

Four audio clip slots are shared by layers and temporary Free Draw/rail sounds.
A fifth Drop replaces the oldest unpinned playing clip; paused layers and
pinned note-rail sounds are retained. If every occupied slot is paused or pinned
by the rail, stop a sound or remove a rail square before adding another; a visible canvas notice
explains why a new stamp did not play. **Trash** is the page-wide delete action; Play/Pause
stops playback without deleting layers. Up to 16 spigots retain their source
for replay; a seventeenth layer reports an error rather
than silently removing an earlier performance. This does not increase the four
simultaneous playback slots.

## Drawing, stamps and Text

Open **Workbox → More sources → Drawing grid** for the optional 48 × 32 grid; draw or choose a
shape, position its prepared overlay,
then use shared Drop. Editing prepares the next drawing while the sent copy
keeps playing. **Load as file** explicitly replaces the file-player selection.
**Download MIDI** saves the last dropped drawing; editing hides that stale link.

The master Play/Pause is the primary Space transport outside editable
controls and never arms Audio. Inside the drawing canvas, arrows move, Space or
Enter paints, Delete erases, and Ctrl/Cmd+Z undoes. One captured stroke is one
undo action. Generator icons and Draw-option tabs support Left/Right and Home/End.

The stamp pulldown combines generated textures and bundled black MIDI/geometric
files. Its filter searches names and collections; each result
has a thumbnail. Selecting prepares a copy. Shared Drop launches it. Selecting
another file cancels an unfinished preparation download without stopping
already-playing layers. Wave, Zigzag, Braid, Stripes, Chevrons, Lattice, Mesh
and Ladder fill the phrase and match at the top and bottom, so repeated copies
form continuous contours. Hearts, stars and other literal shapes retain their
separate silhouettes.

Each Drop saves an independent snapshot, including drawings, messages, equations
and captured evolution. Expand **Layers**, then tap the archive icon for compact
replay controls: tap to start or stop a
loop, resume a paused pad, or retrigger a one-shot. Their Loop switches affect
that saved pad and its current playback.
**Remove** stops and removes only that saved pad; master Play/Pause leaves the bank
available. The bank holds eight sends for this page session. A ninth replaces
the oldest stopped pad; Trash or navigation/reload clears the bank. **Edit** reopens Text
pads in Text. Other pads copy into the 48 × 32 drawing grid, simplifying timing
and pitch detail while retaining the original saved MIDI. Dropping that draft
creates another layer.

**Text** has a multiline **Write text** box, **Clear text** and an exact MIDI
preview; the workbox **↻** chooses the next drop's playback. Enter inserts a deliberate line break;
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
The shared shape controls belong to Workbox → More sources → Drawing grid and prepared Stamps. The old live trail
canvas and Paint flow gesture remain in Midiophilia.

## Math and frame sequences

**Math** prepares `y = f(x, t)` or parametric `x(t), y(t)` curves. The bank has
54 presets: the original six plus 48 new waves, steps, folds, knots, flowers and
spirals. Sixteen are marked **evolves**: they grow, shrink, accelerate or morph
through one drop. In function mode, `t` and `phase` run from 0 to 1 across the
output duration, independently of the input domain. In parametric mode, `t`
retains the domain parameter and `phase` measures traversal from 0 to 1.
Dragging the workbox's vertical grips stretches the complete score and its evolution together.
These are prepared note patterns; live playback does not reevaluate formulas.

Free Math opens the searchable thumbnail menu, then a chosen shape can be
placed directly on the graphic as a one-shot, without a workbox. Its corner
arrow opens the formula popup, where **Workbox** opens an editable Math frame. The formula
preset's thumbnail menu also sits in the Math workbox action row beside
Drop and Loop; it marks evolving patterns. Its adjacent Math-controls icon
opens the formula popup: graph type, expression, and knobs for curve points,
stroke width, note length and note strength, with graph-range knobs under
**Graph range**. There is no second preview or transport. Shared channel and
instrument selection stays in the workbox's channel menu (channel is a knob);
the volume knob is directly in the action strip. Stamps, drawings, text and automata retain
their own source tools instead of borrowing Math's graph controls. The frame
determines pitch placement, width, height and rotation. One beat means one
quarter note at the master tempo; the frame's height is the phrase duration,
including its loop boundary. The falling view currently scales its on-screen
beat spacing with tempo. Selecting presets and editing equations only prepare
the preview; they do not move or resize the workbox. The bounded arithmetic parser allows no
assignments, property access or dynamic code. Limits are 256 characters, 192
tokens, 24 nesting levels, 1,024 samples and 16 notes per sample. Invalid
expressions disable Drop; non-finite/out-of-bounds samples are omitted and
counted. An empty result also disables Drop. No external graph service is used.

Inside the handmade Workbox, Math is the fourth frame-side tool—not a second
box. Its picture menu uses the same formulas as Free Math; selecting one
arms silent placement in the current frame. Click or tap there to add copies
alongside existing Draw, Stamp and Text notes. Click Math again to move the
frame, or use its corner arrow/Down Arrow to choose another formula. Only
the Workbox's Drop starts the combined layer.

**Workbox → More sources → Sequence** holds up to eight immutable drawing snapshots. **Capture
frame** in Drawing or **Capture drawing** in Sequence adds a frame. Arrange,
duplicate, remove or insert rests, set beats per frame, then use shared Drop.
Edit drawing opens a copy; playing sequences keep their old snapshots.
Animate preview is silent and does not alter the source transport. A sequence
uses one of the four live layer slots and one saved-pad slot.

## Performance workspace design

The graphic occupies the whole usable width and height under the masthead,
top transport and icon toolbar. No layer shelf takes space below it. The
scrollable generator drawer overlays the graphic for sources other than Workbox;
Math's formula popup sits beside its workbox (above/below when space is tight).
Closing a drawer restores that space without moving the graphic. Layers toggles
independently over the drawer's usual area, even on a phone. Opening it does
not tuck an unfinished workbox; choosing a clip's picture selects that frame
without closing Layers. Tool changes leave the panel open. The compact workbox channel, volume and
text menus, and the playing layer's gear popup appear over the stage. On mobile
the title and note count share the fullscreen row.
On load only the centered Math workbox is shown; its formula popup opens via
the Free Math caret or the workbox's Math-controls button. The workbox has large **Drop**, **Loop**, save, channel, volume,
Reset and × actions. Click outside an unfinished workbox to tuck it for later; the restore
icon brings it back. The default keyboard position is 78%, leaving a shorter
fading-note area in every view.
The title includes an original
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
Each layer retains its own position and Loop setting. The workbox **↻** sets
only the next Drop. Turning an individual layer's Loop off finishes its current
pass; removing that layer ends it immediately without interrupting other sources.

Master **Play/Pause** pauses the file, playing layers, live notes and Automatapoeia
while retaining their replayable layers and Saved drops. **Trash** immediately removes
all layers, live notes, Saved drops, the selected file, the drawing grid and workbox drafts
in one click. It does not unarm Audio or reset the separate Notes played counter.
**Audio off** releases
pad playback but keeps the live automata transport evolving silently. Enabling
Audio joins the current evolution. Audio never arms through Send, Play, seed
selection, Capture or Restart. Up to four clips play alongside the independent
live generator; another pad replaces the oldest unpinned playing clip. Its saved
snapshot remains available. Stopping a source cancels its own pending
MIDI-effect echoes and leaves other sources moving.

Generated drawings, patterns and rules default to piano; file stamps can retain
their original instruments. **Drop volume** sets the next copy, and each Layers
clip's sliders menu has its own volume. Automata has its own live volume and instrument
selector. Masthead Output controls the final mix. Source programs,
controllers, pitch and velocity are retained where supported; selecting a
channel or instrument changes that new copy's routing or voice.

**GM SoundFonts** is available through Settings → Sound and Files. Its General MIDI group offers
TimGM6mb, GeneralUser GS 2.0.3, FluidR3Mono GM and FluidR3 GM, each with all 128
instruments; specialist banks and saved imports appear separately. **Browse &
preview** opens the Sound Fonts library. Settings → Sound retains live effects and
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

| Feature | BLECH MIDI ULTRA behavior |
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
controls, not cellular generation controls; BLECH MIDI ULTRA instead uses its
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

The main **Free Text** icon is immediate, not a workbox: tap anywhere in the note
field above the keyboard for a blinking text cursor. Type to see your letters
and their silent MIDI-note outline; **Return** drops a one-shot layer there.
Tap another spot to drop the current word once and start a fresh, empty cursor
there; tapping with no word just moves the cursor. Formatting controls do not
drop the word. Press **Escape** to cancel without sounding. The keyboard
remains playable below the field.
Font and size appear beside the cursor with **B** (bold), **I** (italic), and
**↔/↕** (horizontal/vertical). Ctrl/⌘ B and I toggle the same styles while
typing. Six browser-font stacks (Sans, Serif, Mono, Round, Poster, Hand) work
offline; the browser rasterizes the selected face into the actual MIDI notes,
so exact letter outlines depend on fonts installed on the device but the dropped
MIDI stays fixed. Horizontal words cross pitches; vertical words stack upright
letters in time. Large words wrap before reaching the keyboard's right edge.
Select a dropped Free Text layer's Edit button to return to its inline editor
without stopping it; Return applies the new word. The corner menu opens the
advanced **Text workbox** for loops and longer documents, retaining its authored
pixel-font choices. The separate Text icon beside an empty Workbox places silent
lettering *inside* that box until its Drop.

Messages use authored pixel letters and curated 🙂 😀 ⭐ ❤ ◆ symbols.
In the advanced editor **Rows of text** fits characters alongside each other
and continues in rows; **Letters in sequence** gives each character a time
window. Up to 32 characters are supported, lowercase becomes uppercase, and
skipped symbols are reported in the draft preview. Workbox **Drop** launches
the prepared Text score and adds it to Layers and Saved drops. The separate
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

Open **Workbox → More sources → Images** to import a local raster image (up to 16 MiB).
**Workbox → More sources → Scripts** selects Drawing, Stamp or Image as the input for processing.
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
Mixer and BLECH MIDI ULTRA use the shared tempo. A gate limit shortens key holds;
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
