# Globule Damacy

[Open the instrument](../globule-damacy.html). **Globule Damacy is a separate
instrument from Groove Globe.** Record and Play are two tabs on one page, with
one ball and one transport. It is a playable, in-memory sampler, not a video
game or a claim about physical record grooves.

## Roll and collect

Eight original, generated stereo sounds are already spread across the table.
All eight are active simultaneously. The selector under **Sounds on the floor**
chooses which ribbon to refill, *not* which sounds the ball can pick up.
Drag or touch-roll over straight, extended **PCM-derived audio waves** on a
black floor; fine source/time cells that touch the ball dim on the table and
stick to its surface as **independent, irregular grain zones**. Dragging left,
right, up, down or diagonally actually rolls the ball about different axes.
The table is viewed from above so a sideways roll carries the marble's paint
sideways, not around the image like a flat record. Captured waves are
separate marks, never decorative grooves.
Across the full left-to-right length of a waveform, the marble turns exactly
once; a shorter horizontal roll turns a proportional part of the way, regardless
of screen size. You can stop, turn, or retrace at any point.
Each zone is fixed at the point of contact on that 3D orientation; there is no
empty polar cap or equatorial recording band. Turn a corner and the next sounds
stick on a different part of the marble. Each zone owns a short copy of actual
PCM, a spherical surface location, and a small contact footprint. Source
number and original time identify *what* was collected, **not a row or stripe
on the globe**. The waves have no marked beginnings or ends; each collected
mark displays a short, compressed waveform from its own captured sound, not a
miniature loop or a promise that playback follows its left-to-right shape.
The floor paths are straight, but their grains may end up far apart or overlap
on the ball. **The chrome marble never grows**: its
radius and pickup reach stay the same however many layers accumulate.
A sweep across several paths can collect all eight at once. There is no
grain-count cap on the ball. It keeps collecting until the current floor is
picked clean, and it still rolls after that.

**Grain size** sets the duration of each new PCM cut (40–240 ms, initially
100 ms) and the width of its painted and sounding zone. Choose **Fixed size**
for equal-length cuts or **Random size** with up to ±100 ms variation; sizes
are bounded to 40–240 ms and keyed to each floor cell, so Undo and a repeat
roll reproduce the same sizes. Earlier grains keep their own audio and contact
footprints. Record presets change these three pickup settings, **not** the ball,
floor audio or its position. Editing a control displays Custom.

With **Audio** explicitly on, pickups audition their sampled sound even if
the Play transport is stopped. The 32-voice cap is shared with the needle:
for a long pointer jump collecting many cells at once, up to 16 representative
new grains audition in that one event rather than hundreds of overlapping
voices. Every successfully collected grain still has its own PCM and can be
played later. A roll with Audio off is completely silent and never arms Audio.

Use the two location sliders to move without picking up, then **Pick up here**,
or focus the canvas: arrow keys roll and collect, Enter picks up at the current
location. A completed drag is one Undo action; cancelling a pointer stroke
returns *all* its picked-up grains, 3D orientation, and position. **Clear ball** is
undoable and does not erase or replace the source audio.

Choose one of eight **built-in generated samples** to lay on a selected ribbon,
or **lay audio file(s)** from your device: one file refills that ribbon, and
multiple files fill consecutive ribbons, wrapping around from 08 to 01.
The entire upload batch is decoded offline and validated before any source
changes. Source replacement lays new material over the whole ribbon, even if
its earlier cells were collected. The already picked-up PCM and its old paint
remain on the ball. No file is uploaded to a server.

**Record mic on this ribbon** requests microphone permission only when you
press that button; it does not arm output Audio or send the mic to speakers.
Press it again to finish (or cancel while permission is pending); it auto-stops
after 30 seconds. A valid take is decoded locally and laid on the selected
ribbon, ready to roll over. Hiding/leaving the page or switching to Play before
finishing discards the take and stops the mic. Denial, disconnect, a too-short,
oversized or undecodable take leaves the prior floor source unchanged.

## Read the same ball

Select **Play**. The same ball starts in its recorded pose. The motor rolls it
vertically beneath a **fixed, ribbed bendy-straw needle**, with a little sideways
sway; it does not spin like a flat record. Its tip stays at the same point on
the front of the stage. Dragging the marble right moves its front paint right;
dragging down moves it down, just as in Record. Two-axis drags roll freely
through the poles without stopping at the end of a tilt range. The small
unwrapped contact print shows the paint marks and the actual needle route
by spherical longitude and latitude, including after manual steering.
**A grain sounds only when its spherical zone moves under the fixed tip.**
Passing over bare chrome is silent;
remaining within a zone does *not* retrigger it. Leaving and coming back does.
Overlapping zones can sound together. There is no nearest-track fallback or
organized loop stripe to follow. At an exact pole, every longitude names the
same surface point.

Play presets change Roll speed, direction, Ball sway, Needle width, Orbit tilt
and Top layer transparency together. They keep the current ball, floor audio,
output level, Audio choice,
current manual orientation and playing phase/transport; editing any of these
controls displays Custom. **Ball sway** gently steers and tilts the rolling
marble and adds a little tape-rate variation and occasional backwards grains; it does not
teleport to another sound. **Needle width** (0–100%) expands a circular reading
mouth around the stationary tip. A narrow mouth hears only spots it crosses;
a wide mouth can touch and sound several zones at once, up to the shared
32-voice limit. It never rearranges the samples, lengthens their recorded
grains, or plays across bare chrome. Widening into a zone sounds its grain once;
staying inside does not repeat it. **Orbit tilt** biases the automatic roll
from north toward south, without limiting hand-rolled movement. **Roll speed**
sets the motor pace and tape pitch; **Reverse roll** reverses the motor and
grain reading. Drag in any direction to roll the marble and sweep zones beneath
the tip; the motor resumes if it was turning. Arrow keys roll the marble in
their directions; Enter sounds *only* patches beneath the fixed tip when Audio
is on. **Start of roll** resets motor progress and its grain-variation sequence
without wiping away manual steering.
Record and Play retain the same ball and transport.

**Top layer transparency** (0–100%) fades a newer grain's *whole* zone and
captured waveform when it crosses older paint on the spherical surface. Grains
that do not intersect earlier zones stay bright; an overlapping grain's exposed
edges fade along with its center, like a translucent sticker. At 0% paint
remains as laid down; at 100% an older patch shows through the overlap. The
same paint appears on the Record and Play ball. This is a visual control, not
a mute, eraser or audio crossfade: the needle still enters every grain zone
independently, including fully hidden grains, and can play them together up
to the 32-voice limit. The readout counts all contacting zones regardless
of visibility.

Play and pickup gestures remain silent until **Audio** is explicitly enabled.
Audio off does not turn Play off. This is sampled sound: at pickup, each cell
copies the selected 0.04–0.24 seconds of decoded PCM. The Web Audio clock samples
needle/zone contact every 8 ms while the motor turns; manual pointer strokes
probe the intervening 3D roll rather than just their endpoints. Canvas animation
never clocks their attacks. A browser tab left in the background silences
Audio, and returning requires another explicit Audio click.
Grains have short, smoothly shaped attacks and tails; moving Play controls
lets grains already sounding finish while cancelling old-route attacks that
have not yet begun. A cut near a file's edge stays within the file instead of
jumping across unmatched endpoints; clips shorter than the requested grain
reflect at their edges.

## Limits and storage

- **160** available source/time cells per wave *per placement*, with no
  separate ball-capacity cutoff: laying another file, generated sample or mic
  take replenishes that wave. At most **32** sample voices sound at once. In a
  dense crossing the voice cap takes priority; extra simultaneous entries are
  not queued or replayed later. A single pickup call auditions at most 16
  representative new grains.
- Imports and mic takes: nonempty encoded audio up to **12 MiB** per file/take,
  decoded mono/stereo between
  **0.1 and 90 seconds** at **8–48 kHz**, at most **24 MiB decoded** per source
  or **96 MiB** across the eight floor sources. A failed batch/take leaves all
  prior floor sources and captured scraps unchanged; accumulated grains consume
  page memory until cleared, undone or the page closes. Long, large batches can
  be demanding on a device even though no arbitrary grain count stops pickup.
- Sound and Undo exist only in this page's memory. Refreshing or navigating
  away loses the ball; this prototype does **not** yet save, export, or mix
  whole tracks into one linear recording.
- The original generated loops and procedural illustration use no game
  imagery, audio or third-party samples. The black Canvas stage and
  mirror-chrome marble hold distinct neon waves; floor and captured
  waveform marks are compressed previews of local PCM, not the data used
  to decide needle contact. Neutral imperfections and fixed light reflections
  are original Canvas drawing, not a sampled texture.
  Spherical geometry and sound contact are 3D, but the image is projected with
  Canvas rather than rendered by WebGL.
