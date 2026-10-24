# Tapezoid · cassette as a small reel-to-reel desk

Tapezoid is a **Work in Progress** instrument. Viewed straight down, one
cassette supplies and takes up an exposed ribbon through its *bottom* ports.
Six factory guide posts route that ribbon past one red REC and two blue PLAY
heads. A narrow vertical tool dock beside the drag canvas adds up to 32 posts,
two more REC heads, two more PLAY heads and six adjustable delay pools. The
five-key transport is centered above the cassette and follows its *rendered
width*, even when you load another model or resize the page. When that width
cannot fit five keys in a row, the keys reflow into two or three short rows
instead of being cut off. An extreme tape pull or tiny imported model can
make the cassette narrower than PLAY; only then does the fascia keep a 52px
minimum so PLAY remains a visible 48 × 48px target.
The dock scrolls vertically on a short landscape screen. The stage has no
picture frame or corner screws. It is an imaginative
cassette-as-reel-to-reel machine, not a mechanically possible commercial deck.
In **MOVE**, drag an existing post to move just that post, or pull bare tape
out to add **one** bend that follows your hand. Choose **DRAW** to trace
several turns across the desk *without lifting your finger*; intermediate
turns become posts. One DRAW stroke is one Undo, including its self-crossings.
Tapping bare tape adds nothing in either mode. Both modes still let you move
heads, pools, fork halves and the blue Scotch join.
**TIME** in the dock shows the effective seconds on exposed stretches between
guides, with separate branch-leg times and the two arrival times at a fork.
Stretches of different length take different time. The labels do not intercept
your hand and can be hidden without affecting playback. Razor and Scotch are
toolbar tools, not separate objects on the desk; the tape, heads, posts and
active joins remain directly draggable.

## Start with one delay

The initial scene has **one original source motor**, **REC**, and two PLAY
heads, with the monitor mostly on tape. No virtual motor drifts and no head
return feeds REC until you turn those controls up. This keeps the first
experiment about distance, not phase multiplication.

1. Turn on **Audio**. The deck's ▶ transport already runs forward; it is
   separate from the blue PLAY *head*. Red REC automatically records the
   original (or your loaded) track, not microphone input. Wait for that
   recording to reach PLAY 01: the tape starts blank, while a quieter direct
   track plays immediately.
2. In **MOVE**, drag **PLAY 01** along the intact ribbon. The panel's live
   **REC → PLAY** readout shows its actual travel time at 1× speed; the
   recorded track now arrives earlier or later, without retuning the track.
   The other PLAY head adds another audible read. Compare the original track
   at **0% tape** with recorded-head output at **100% tape** using **Monitor ·
   track / tape**. Use **Reset** to recover this starting scene.
3. Move a yellow post or pull bare tape outward for a single bend and a longer
   stretch; use **DRAW** when you want many turns at once. **TIME** only shows
   their seconds: pressing it never changes the sound. A **POOL** adds stored
   seconds to the stretch it sits on. Press
   STOP to silence the motor without turning Audio off.
4. Only after that, select **RAZOR** in the toolbar and touch tape after REC,
   before PLAY. It gives the *same recording* two differently timed routes
   instead of cutting an open end. A later PLAY can hear the two arrivals;
   **Scotch tape** can mix them at a later junction or restore one path. Cuts
   and pools can change the sound; just selecting a tool cannot. The starter
   readout shows **A / B** times if the first PLAY hears both halves, or just
   **A** when blue rejoins farther down the ribbon.

## Play the machine

1. Arm **Audio** in the Morphazoid masthead to hear **Afterimage**, an original
   continuous eight-second track. **Load local track** instead to print a
   recording from your device; the file stays local. The track itself and
   its virtual drifting copy are traced in amber and blue on the ribbon.
2. With **Print the track onto tape** checked, REC writes material and retains
   part of the previous lap. **Sound-on-sound** sets how much survives one
   *complete* tape lap. **Head return** feeds the selected PLAY head back
   to REC, making further echoes at the *shorter* head-to-head interval.
   Switch **Return to REC from** to choose that delay. Both loops can accumulate
   together, but their combined return is bounded and softly saturated rather
   than allowed to run into uncontrolled feedback. Drag REC or any PLAY
   head to change the intervals; pull the tape or move a yellow guide post to
   change the route.
   REC writes into the **one shared loop**, not a separate track, microphone
   input or output bus; additional REC heads write at other positions in
   that same loop. The blue PLAY heads read it to the stereo monitor (or,
   when selected under **Return to REC from**, back into REC). Route edits
   do not retune the original track. **Monitor · track / tape** at
   100% lets you hear only what the playback heads read (including their
   accumulated repeats). Uncheck Print to hold that recording without
   recording more; **Erase tape memory** clears it without stopping the track.
3. Use **the toolbar on the desk**: **New PLAY**, **New REC** and **New POST**
   arm a placement gesture. Touch intact ribbon for a head, or a point beside
   it for a post; drag it in **MOVE** mode. Or **grab bare ribbon directly**:
   a small grip appears on hover, but not next to a draggable head or post.
   In MOVE, a pull threads **one** new guide; drag that guide to **squeeze**
   the bend and shorten its echo. Choose **DRAW** and grab bare tape to
   trace a zigzag or knot across most of the desk: significant turns become
   posts in order, while pointer jitter is smoothed away. Up to 32 added
   posts fit in either mode. Erase posts to unwind the mess. Once all 32
   are used, a MOVE pull shifts a neighboring guide; DRAW does not silently
   move one. One entire drawn stroke is one Undo. Canceling a pull restores
   its original route.
   Every blue head reads a separately
   positioned echo of the same recorded tape. Every red head prints the
   source and selected-head return into that shared tape at its own point.
   Choose any active blue head in **Return to REC from**. With **New POOL**,
   touch intact tape **or either fork half** to route it into a circular delay
   basin. Select or drag the basin to move it along that same ribbon; its
   slider in the control rail sets **0.15–3 seconds** of stored
   travel. As time increases the circle grows and the ribbon zigzags across
   more rows inside it rather than coiling. Moving tape flecks travel the
   *same serpentine route* on the audio clock. Storage on **intact** tape
   extends the shared loop and the delay of heads *after* it. Storage on an
   **amber or blue branch** delays only that half's virtual read, leaving the
   shared recorded loop alone. Move a branch pool to reposition its basin;
   adjust its time to change that lane's echo. **ERASE** lifts a head, added
   post or pool. The six factory
   posts and the last REC and PLAY stay in place. The small tool buttons stay
   off the canvas, leaving its full height available to draw, squeeze and
   drag tape toward the desk's edges. TIME reports effective travel **at 1×
   Play**, including any storage pool in that stretch. Reverse, FF and REW
   change its wall-clock travel according to speed. A very long route plus
   pools can reach the 12-second tape-memory ceiling; the displayed time is
   the bounded audio time, not unlimited physical inches of tape.

4. **Source motors** selects one original source, a pair, four, or eight
   independent *virtual* reads of that same source. Doubling makes copies of
   the current phases; **Source motor slip** (0–6%) slowly separates their
   speeds. **Re-sync motors** starts them together again. The amber and blue
   ribbon traces show only the original and the fastest virtual source (after
   a fork, they also show the different route delays);
   the other voices are audible, not individually drawn. Tape memory displays
   the first pair's separation. This is a playable *It's Gonna Rain*-inspired
   gesture: Reich described two loops drifting into and out of phase, then
   doubling to four and eight in the later part of that work. The **head
   return is a separate tape-echo technique**, not an attribution of the
   feedback circuit to Reich.
5. The on-stage cassette-player keys provide Rewind, Reverse, Stop, Play/Pause
   and Fast Forward. Wind/reverse change speed and pitch, but only forward
   Play prints to tape. Audio and transport are separate: moving or editing
   with Audio off never arms sound. The stored loop survives turning Audio off
   and back on in this page, while silent motor motion still advances.
6. Select **RAZOR** in the on-desk toolbar and touch
   a usable stretch of tape **after REC and before PLAY**. A blue separating
   post and a blue join handle appear: the same recorded signal travels along
   a nearly direct amber route and a longer blue route. They **initially
   rejoin before the next guide post, head or pool**. There is no severed
   transport; REC and the motor continue normally. At PLAY *after* that join,
   two stereo reads arrive at different times. Grab the blue join handle and
   drop it on a later **intact** stretch before a PLAY head. Or choose
   **Scotch tape** and touch that stretch. The blue branch now meets the
   original tape at a visible **Scotch mixer**. A PLAY head between the old
   and new join hears amber alone; heads after the new join crossfade the two
   arrivals using **Scotch · A / B mix** (0% amber → 100% blue). The panel
   shows both route times from REC and their difference. Move the join again
   to repatch it without stopping playback or erasing PCM.
   Drag the separating post **or grab either ribbon
   directly** to stretch or squeeze its route independently of the other.
   A pool can collect tape on either lane, with up to six pools on the desk.
   Blue branch pools retain their fractional position when its end moves.
   Very short gaps, touches on a part, or tape after the last PLAY cannot
   make a useful audible fork or mixer, so those placements are declined.
   Reconnection moves **forward** on this ribbon; backward feedback splices
   and multiple simultaneous forks are not supported.
7. **Scotch tape** at the *original* join (or **Scotch · restore one path**) removes the
   detour, returns both reads to one timing and leaves a visible patch.
   Scotch at a relocated join selects its A / B mixer instead.
   Branch pools move onto the intact ribbon at the nearest available positions
   without losing their storage time, now extending the shared loop. Undo
   returns them to their former halves. **ERASE** on the separating post or join
   rejoins and retains its pools without leaving a patch. One fork can be
   active at a time.
   **Undo** restores added/erased parts, storage time, route and fork geometry,
   but not erased or already recorded sound. **Reset** restores the original
   route, tape memory, controls and forward motion without changing Audio or
   the loaded file.

**Why the part limits?** The six factory guides and up to 32 added posts are
a render/editing budget, not a tape-machine rule. Up to **six** pools can be
placed on the shared ribbon or the fork halves; they do not allocate extra
recordings. Shared pools and physical route length still fit into **one
12-second PCM loop**: once its cap is reached, adding storage compresses the
effective travel time of all shared stretches instead of adding more total
seconds. Fork storage is also bounded to 3.5 seconds per playback branch.
**Four PLAY and three REC** are the worklet's preallocated real-time contacts,
not four outputs or three tracks. Erase an added part to free a place; the
last REC and PLAY stay so the instrument remains playable. More independent
heads or longer uncapped tape would need a redesigned/tested audio engine,
not just bigger tool counters.

### Phase studies

Open **Select Preset** in the control rail and search for **Phase**. Try:

| Preset | What you do | What it actually does |
| --- | --- | --- |
| **Phase · two loops (slow drift)** | Start here, press **Re-sync motors**, then let the track run. Try a short rhythmic or spoken loop of your own. | Two *virtual* reads slowly separate at 0.2% speed difference. Printing and head return are off so you hear source phasing alone; routing is still visible but won't change this dry preset until you enable Print and raise Monitor · tape. |
| **Phase · double to four** | Choose it while the two reads are already apart; choose DRAW and trace a few turns on exposed tape. | Copies the *current* two motor phases into four reads, which diverge at different rates. A little recorded tape in the mix lets you hear the longer route too. No head return. |
| **Phase · double to eight** | Choose it while four are playing; Re-sync to start another pass from unison. | Eight virtual reads, sped-up drift for playability, plus a dense preset maze. This does **not** model eight physical tape machines. No head return. |
| **Head echo · tangled return** | Drag PLAY heads or the violet pool, then draw or squeeze the maze. | One source motor; a PLAY head feeds REC through a timed, bounded echo. **Our tape-echo extension, not a Reich technique.** |
| **Fork · two arrival times** | Pull the blue branch away, put a pool on either branch, then Scotch them back together. | Our virtual stereo-delay/fork extension; not a historical lengthwise tape splice. |

The first three are **inspired by** [Steve Reich's account of the early tape
pieces](https://www.furious.com/perfect/ohm/reich2.html): nearly identical
loops on separate machines drift in and out of phase, and he describes
doubling to four and eight in *It's Gonna Rain*. This is an approximation
using one displayed cassette and virtual playback cursors, **not** his
recordings or a reconstruction of either historical piece. The default
eight-second **Afterimage** track is original; you can supply your own audio
file. Selecting a preset preserves the motor's current phase, tape recording,
Audio arm, and transport speed; **Re-sync motors** is the explicit reset to
unison. Head-to-REC feedback makes repeats, **not** Reich-style loop phasing.

### Cassette models

The default cassette is the **actual downloaded GLB**,
[“Cassette Tape” by joshtmc](https://sketchfab.com/3d-models/cassette-tape-4613411c569d4185a2e07f31b1bf9e49),
licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
It is bundled unchanged with its embedded textures and attribution in
`assets/tapezoid/cassette-tape.glb`; see
[`cassette-tape.LICENSE.txt`](../assets/tapezoid/cassette-tape.LICENSE.txt).
**This is a different cassette from the earlier Sketchfab link**
(`cassette-a9534b2dcaa94b299f1a5ae029517c3c`). The downloaded model has
one mesh, but six disconnected, textured components make up its two hubs.
At runtime those components are placed on two pivots; the visible artist
reels now turn together forward and reverse and stop with the transport.
The mostly opaque plastic writes depth before the translucent windows are
drawn, so the exposed ribbon does not paint over the cover. The external drive
pair also turns, and the procedurally modeled **Generated shell** has its
own two turning reels. Other locally chosen GLBs are not guessed apart
or automatically animated.

**Artist cassette** restores the bundled model after switching.
**Generated shell** selects the code-generated fallback, which also appears
automatically if the artist model cannot load. **Choose .glb** or drop a
different local GLB onto the desk to replace only the cassette shell; tape
mouths, transport and editing geometry stay aligned. Local imports require a
self-contained glTF 2.0 GLB under 32 MB with at most 300,000 vertices;
referenced external textures or geometry are refused. The chosen local file
is used only in this browser session: it is not uploaded, bundled, saved or
redistributed. Changes to the artist model, if made, remain subject to its
CC BY-SA 4.0 license. The original creator has not endorsed this instrument.

The 3D stage is keyboard-focusable. Space toggles forward/pause; **G** selects
Move, **D** Draw, **1/2/3/4** New PLAY/REC/POST/POOL, **R** Razor, **T** Scotch tape and
**E** Eraser. **J** moves the blue join halfway toward the last PLAY head
and makes a Scotch mixer (if there is room). **[** and **]** select a post,
either fork lane, its join, head or pool;
arrows move it (Shift for a finer step), while Up/Down adjust a selected
pool's storage time. **4**, then Enter on a selected fork lane places its
pool; Enter otherwise places the selected new part, forks with Razor
between REC and PLAY, restores one route with Scotch tape or erases with
Eraser. **Delete** erases a selected removable part. Escape returns to Move.
Morphazoid's standard Space shortcut controls transport from elsewhere on
the page; native form controls retain their normal keyboard behavior.

## Mechanism and evidence

Default path, described schematically rather than as literal head geometry:

```text
 cassette supply → bottom outlet → guides → REC(s) → pools → PLAY(s)
       ↑                    fork → amber / blue → join  ↓
                                  ↳ pool per half
                              blue → later Scotch A/B mixer → PLAY
       └─ take-up hub ← bottom return ← capstan / pinch pair
                       REC(s) ← head return ← choose any PLAY
                  REC ← old tape on its next complete lap
                  REC ← 1 / 2 / 4 / 8 virtual source reads
                 monitor = direct source ↔ stereo playback heads
```

| Reference or observation | Implementation | Boundary |
| --- | --- | --- |
| [Roland RE-201 original owner's manual](https://static.roland.com/assets/media/pdf/RE-201_OM.pdf), *Functions and Uses of Controls* (Roland, 1982): its mode selector combines three playback heads; Repeat Rate changes tape speed and echo interval; Intensity governs repeats and can oscillate at high settings. | The chosen blue playback head feeds REC at its route-dependent delay; up to four heads monitor the shared tape in stereo. Our send is normalized against sound-on-sound retention and softly saturated. | An RE-201 is an endless-tape echo machine, **not** a two-reel cassette. Our route is not its electrical schematic. No manual images/audio are included. |
| [Studer/Revox B77 MKII service instructions](https://archive.org/details/revox-b-77-mk-1-and-mk-2-service-manual), *Technical Specifications*, *Tape transport mechanism*, §4.1 *Headblock* and §4.3 *Pinch roller*: two spooling motors, regulated capstan motor, guide adjustments, magnetic heads and pinch-arm pressure. | Two cassette reels stand in for open supply/take-up reels; tape routes past guides, REC and PLAY heads before a capstan/pinch pair on the return side. | A cassette lacks this exposed three-motor layout. The drive pair is a visual analogy; no real tape tension, wear, pinch force, hub-speed math or calibrated geometry are simulated. No manual illustration is reproduced. |
| [Steve Reich, interview by Jason Gross, *Early tape pieces* (April 2000)](https://www.furious.com/perfect/ohm/reich2.html): Reich describes identical loops on two Wollensak tape machines moving from unison through other relationships; later he layered two, then four, then eight voices. | One independently timed source read becomes a pair; doubling copies their current phases and additional virtual motors slip apart. Re-sync makes the process playable again. | These are copies of **our** original music or the user's track, not Reich's recordings. There is only one illustrated cassette; the extra source motors are virtual. The 6% maximum is exaggerated for playability. **Phasing is not the head-to-REC feedback loop.** |

The loaded source is browser-decoded and folded to mono at 24 kHz; files above
24 MB are refused, and only the first 60 seconds are used. A 15 ms crossfade
softens replacement. Each AudioWorklet owns a bounded 12-second mono tape
buffer with four preallocated stereo readers and three recording contacts
(only the active ones read/write). REC writes a softly saturated mixture of new
track and up to 88% retained tape on each forward pass. The chosen playback
head also feeds REC at its record-to-play travel time, including any pool
between the two; the old tape contributes
again after a full lap. Return is multiplied by the headroom `(1 - retention)`
and limited to 80%, so total linear feedback remains below unity before
soft saturation and tape-loss filtering. Multiple REC contacts write that
**same** PCM at different positions; source contribution is divided among
active contacts. The PLAY heads are stereo readers of the same tape; their
delay follows the route. A drawn maze adds geometric travel with a smooth,
saturating time mapping: short bends have an audible effect while large
scribbles approach, but cannot exceed, the 12-second tape-memory limit.
The browser retains at most 384 sampled pointer positions and simplifies
them to 32 additional ordered guides; the rendered strips cap their
tessellation. With a very long maze or several pools the audio will
eventually saturate at 12 seconds: more visible tape cannot supply infinite
real recording time. Pools on intact tape add configured seconds to the
shared route and downstream reads; if total route plus shared pool time
would exceed 12 seconds, both travel and storage scale together to that
12-second limit. The circular basin radius and number of zigzag rows depend
on the **effective** stored seconds after this limit. A tape marker follows
the exact serpentine ribbon while the audio clock spends its configured
time there. The extra route length is visually suggestive, **not a calibrated
centimeters-per-second tape-speed simulation**; there is no second reel,
separate pool audio buffer or tension model.

The blade makes two **virtual** paths through one continuous fork. The blue
post detours one narrow rendered lane; the amber lane starts nearly direct,
but both lanes can be pulled separately without cutting open the tape.
A second handle marks the blue end. Dropping it on a later intact stretch
or touching that stretch with Scotch routes the virtual blue read there.
The intact route, including any intervening heads, keeps running. Only
PLAY heads **after** the relocated junction receive the mixed signal.
The mix slider smoothly crossfades the two PCM reads in the AudioWorklet;
its center is a bounded equal-level sum, not another recorded track.
Shared pools bypassed by blue are subtracted from its read offset.
Each branch pool stores time on **only its own playback read**; its circle,
zigzag and moving marker use that lane's effective audio time. Branch
storage does not extend the shared PCM loop; detour and branch storage
together are limited to a **3.5-second offset per lane** in the worklet.
Moving a pool within its lane changes its visual location and marker timing;
changing its storage time or pulling that lane changes the echo heard after
the join. The two different arrivals are read by downstream PLAY heads
*after* their respective join. The worklet smoothly approaches these
bounded offsets while the moving markers continue at different phases past
the join. **A real lengthwise tape split
cannot simply rejoin at unequal arrival times without storage/slack, a
different transport, or resampling.** This is a stereo-delay/phasing
instrument, not a slack-free mechanical splice or two independently
recorded magnetic/PCM tracks. The mono source and recorded buffer are
preserved when patching, undoing or moving the tape. Pulling the ribbon
changes travel and echo time, **not the original waveform's duration or
pitch**: this is not audio time-stretching or a tape-tension model.
Direct-track monitoring can
be blended out to hear only recorded tape. These are audio delays, **not**
tape-contact triggers. The source waveform traces do **not** analyze the
overdubbed tape content.

Changing route length reinterprets the stored buffer without allocating in
the audio callback; adding/removing a head or pool also preserves stored PCM,
and material in a shortened-away region is latent until that
region is available again. A Razor fork keeps printing onto the shared mono
loop; both downstream reads carry that memory at different delay times.
Scotch **restoring one path** removes the virtual detour; it does not
destructively edit PCM, remove recorded audio or add splice noise.
Scotch making a later junction does smoothly crossfade the live playback
reads, nondestructively. Branch pools become shared-loop pools rather than disappearing;
Eraser on the separating post does the same without leaving a patch.
**Bifurcation** is a factory scene with a pool on its blue lane; older
three-field pool scenes still load without branch metadata. Up to eight
visible patches are retained. Older saved scenes with
an open cut load as intact tape with a patch at the old edit position, never
as a severed transport. Erase fades
the echo before clearing the buffer in bounded slices. Audio off/on retains
the loop in memory, but page reload/navigation does not; changing tracks
does not erase earlier recordings. The masthead Record captures Morphazoid's
output, not the red record-head input. No upload, saved project, export or
microphone capture is provided by Tapezoid.

Three.js 0.185.1 is the existing MIT-licensed local bundle in `vendor/three/`;
its license is alongside it. The generated fallback cassette, stage tools,
tape, original track and catalogue image are Morphazoid originals. The
artist cassette and embedded textures retain their separate CC BY-SA 4.0
terms; other locally chosen 3D models are never shipped. Source lives in
`src/instruments/tapezoid/`; the public page source is `src/pages/tapezoid.html`.
