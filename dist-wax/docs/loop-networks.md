# Tape Worm and Loop Soup — editable networks

September 18, 2026. These extend the existing two demos, not the other three
starting instruments. App names and URLs are unchanged; loop labels are now
letters in both apps and Loop Soup's preset labels are A/B/C/D.

## Play the surface

1. Enable **Audio**; it remains a separate explicit permission from Play.
2. Use global **Play**, or a loop's **triangle**, to run the network.
3. Inside a loop, the **red circle** captures the microphone and changes to a
   **stop square** while recording. **Triangle / pause bars** starts or suspends
   that loop. **M / S** toggles mute and solo.
4. Drag the loop's **letter** to arrange the graph. Use the labelled loop
   selectors to scroll to an off-screen loop. The workspace itself scrolls,
   rather than shrinking the buttons below a usable size on phones.
5. Use **Add loop** to create an empty tape of the chosen duration. Letters do
   not change when an earlier loop is removed. **Remove selected** requires
   confirmation and removes only that loop's audio and attached routes.
6. Press the **bent-arrow route icon** inside the source loop, then click the destination letter.
   Alternatively use **From / To / Attach route** in the control rail.
7. Click an arrow's label or choose it in **Edit route**. Route edits and
   detach/enable operations take effect live without rebuilding the audio graph.

Letter buttons are keyboard accessible: arrow keys move the loop; Shift moves
it farther. Native buttons/selectors provide all record, transport and connection
actions without dragging. Escape cancels route selection or erasing.

### Compact center controls

The loop disc is opaque, including when muted: neither grid nor routes show
through the center. Its small center toolbar follows the Shapes / L-Systems /
Graphs transport language, using the same play/pause glyph geometry and neutral
Morphazoid surface colors.

| Center control | Action |
| --- | --- |
| Triangle / pause bars | Play/resume or pause this loop; never arms Audio |
| Red circle / red square | Start or finish microphone capture |
| × while waiting for microphone permission | Cancel the pending recording request |
| M | Mute; press again to unmute |
| S | Solo; press again to release solo |
| Bent arrow | Begin attaching a route from this loop |
| Reader-to-start icon (Tape Worm) | Move the playback head to this loop's start |
| Hold / pencil icon (Loop Soup) | Protect samples or resume overdubbing |

Every icon retains a full accessible name and a tooltip. Desktop controls have
28px faces; secondary controls have 24px faces. On coarse-pointer devices, the
native hit targets grow to 48px without enlarging the visible icons or overlapping
neighboring targets. The letter and duration remain visible above the toolbar.

When global Play is stopped, the center triangle starts/resumes playback
(in Tape Worm it brings the reader to that loop). During an active capture,
the same button pauses/resumes capture locally without unexpectedly starting
global playback.

## Tape Worm: routes transfer the reader

There is still **one reader**, not one simultaneous voice per loop. The
**reader-to-start icon** transfers it to that loop's start and releases that loop's local pause.
Clicking the rim places it at that phase without arming Audio.

Each directed route owns:

| Parameter | Range | Meaning |
| --- | --- | --- |
| Exit | 2–98% | Position at which the source tape can transfer its reader |
| Entry | 0–95% | Destination phase after the transfer |
| Crossfade | 5–150 ms | Blend between old and new playback at transfer |
| Enabled | on/off | Whether the route can be used |

The earliest upcoming eligible exit wins. Coincident exits alternate in stable
route order. Paused destinations are skipped. No eligible route means the
current tape continues looping. Arriving exactly on a gate waits a full lap,
preventing a zero-time cycle. Global **All route exits/entries** and presets
deliberately apply their positions to every route; individual route edits do
not alter the others.

New tapes insert after the last tape in the default ring connection, retaining
existing route settings where possible. Mute and Solo affect monitoring, not
route selection. A muted reader still travels. Moving a loop only changes its
layout: pitch and duration remain controlled by tape speed and recorded length.

## Loop Soup: routes carry audio

Each loop has an independent read/write position. All unpaused loops run
simultaneously. The original default ring is now only a starting topology.
New loops start empty and unconnected so attaching a route is an explicit act.

Each route has **send level** (0–100%), **low-pass tone** (120–12,000 Hz nominal
cutoff), and an **enabled** switch. Sends use source playback from the previous
audio sample, avoiding an algebraic feedback cycle. Source loop level and mute
affect the feed; Solo isolates listening without changing route signals.

**Write** permits saturated overdubbing from microphone/demo plus incoming
routes. **Hold** leaves the buffer exactly unchanged while it plays. Pause
stops playback/writing, and if it owns the active capture it pauses that capture.
The global Route write level scales all route sends; their individual level
controls remain independent. Saturation bounds every written cell to ±0.9.
Increasing retention to 100% is not exact freeze; Hold is.

Center **Rec** performs a replacement take, not overdubbing. Completing a take
puts that loop in Hold to protect the new material; press Write to resume
overdubbing. The erase brush can remove a region; a Write loop may refill it.

## Capture and lifecycle

- One explicit microphone capture at a time, maximum 12 recorded seconds.
  Per-loop pause suspends the count. The previous recording remains until a
  take of at least 0.08 seconds is completed.
- Center Rec can request the microphone if it is not already enabled.
  **Enable microphone** also allows persistent monitoring or Loop Soup input
  without replacing a tape. Monitor is optional and labelled for headphones.
- Stop recording finalizes that loop regardless of which loop is now selected.
  Global Pause stops playback but does not end capture. Audio Off finalizes
  capture, mutes output and stops owned media tracks.
- Removing a capturing loop cancels its take rather than writing it into a
  different loop. Delayed file loads use stable loop IDs. Pending permissions
  are cancelled by removal, Audio Off, or navigation.
- File import works for both apps after Audio is enabled: maximum file size
  40 MB, first 12 decoded seconds, downmixed to mono.
- All tape data is in RAM only. No upload, persistent audio save or audio export
  is provided. Reloading/navigating discards it.
- Reset keeps audio/topology/layout. Restore demo network is separately
  confirmed and replaces the entire network.

## Implementation contract

Pure engines share `src/families/starting-instruments/loop-network.js` for stable IDs,
bounded tape storage, topology and capture. Their playback/routing DSP stays
separate. A dedicated `loop-network-app.js` owns native center controls and the
scrollable workspace; the other three demos retain their original controller.

Limits: eight loops, 24 directed routes, no self-routes, and one route per ordered
endpoint pair. Adds/removes route edits happen in one worklet message. Changing
routes never recreates unaffected tape buffers. Active-loop removal crossfades
the Tape Worm reader; Loop Soup retains unrelated output state and smooths its
voice-count gain normalization. Native button hit targets are at least 48px on
coarse-pointer devices; icon faces remain compact.

This is not yet automatic "graphitizing" of an initial recording. No segmentation,
clustering, independently added readers, or draggable record heads are implied.
