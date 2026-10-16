# Wobblini

Eight independent stereo audio tracks, built as a Morphazoid browser instrument.
**Records** opens by default: eight circular scratchable records. Each record
shows only its playing loop as a taller waveform, rotating past a fixed needle
at three o'clock. A complete turn follows the loop; there are no IN/OUT markers
or greyed-out portions of the full file on the record.

Play/Pause sits at the center. The top-left corner has the track number, a tiny
crown button to select the tempo master, and **SYNC** for that track. Only one
crown is selected, initially track 1. The bottom-left corner holds **S** (solo)
and **M** (mute), the bottom-right holds a volume knob, and the top-right gear
opens track settings. Pausing stops the record; muting keeps it spinning and
its playhead moving silently. Multiple tracks can be soloed together, and mute
still silences a soloed track.

The settings popup shows the imported audio file name (or **Demo loop N** for
generated audio), Load, **SYNC**, and compact Speed and Volume knobs with a **1×** speed reset. There is no file lock or loop
editor in this popup. Close it with its close button, Escape, or the backdrop.
The master strip provides Play/Pause all, Stop, a Master BPM knob, **Tap**, and
**SYNC ALL**. Deck editing controls and the detailed mixer stay out of Records
view; there is no A/B crossfader or global upload button.

Turn Audio on in the header, then play a record. The view icons switch to
**Track view** for waveform editing or **Tiny tracks** for a compact overview;
Edit expands one tiny track. Track view uses the full track width for its
scratchable waveform, without a platter, and becomes one column on small
screens. Switching views keeps playback and the mix intact. Most buttons use
icons with accessible names and hover titles; **SYNC**, **SYNC ALL**, **S**, and
**M** are compact text controls. Each record has a number without an enclosing
card or track-name header. File names remain available in hover titles,
screen-reader descriptions, and the settings popup.

## Playing

- Use Load in track settings or Track view to choose local audio. A global
  unlock step is unnecessary because loading is reached through settings.
- Drag Speed and Volume knobs vertically; hold Shift for finer changes.
  Keyboard arrows adjust the focused knob. **1×** resets speed to the file's
  original rate. The popup displays each knob's current value.
- Hold and rotate a record, or drag a Track view waveform left or right, to
  scratch the samples forward or backward. A held, stationary scratch surface
  is silent. Playing tracks resume at the hand position; a synced follower
  rejoins the selected master's beat phase when that master is playing.
  A paused track stays paused. Focus a scratch surface and use Left/Right arrows
  to scratch; Shift makes smaller movements. Pointer cancellation and lost
  focus release the scratch.
- Each track has independent Play/Pause, a keyboard-accessible position slider,
  and a cue point. The **flag icon is Set cue**: it saves the current position
  as the manual beat-grid origin. The separate Return to cue button jumps to
  that position and pauses. Space toggles all tracks; keys 1–8 toggle individual
  tracks when focus is outside a control. Stop returns playheads to the start
  of their active loop.
- Tracks always loop. In Track view, choose the whole file or a beat-loop
  length. The beat-loop menu starts a loop on the cue-relative beat grid,
  shifting it near the file boundary when needed to fit. Choosing a new length
  changes the active loop; selecting the whole file restores full-track
  looping. The record displays just that active audio region. Loop selection
  stays in Track view, separate from the compact record controls.
- Set each file's **Source BPM** and cue manually. **Master BPM** changes the
  selected master's playback speed; **Tap** measures one beat per tap and uses
  the same native BPM control. Rate spans ½×–2× and pitch follows speed.
  This MVP does not detect beats or preserve pitch. There is no metronome.
- Each track has level, mute, solo, stereo pan, three EQ bands and a filter.
  Negative filter values remove highs; positive values remove lows. All eight
  stereo tracks feed the stereo master output.
- **Wobble** modulates the track filters. Drag right for greater depth and up for
  faster modulation. The Depth and Rate sliders are equivalent controls; on
  the pad, arrow keys move the two axes and Home returns depth to zero. The
  visible wave uses the audio clock while sound is armed.
- Reset mixer restores levels, EQ, filter, pan and mute/solo, and dries the
  wobble. It preserves imported audio, cues, loops, tempo, transport and the
  master output level. Demo set replaces all eight sources; when local files
  are present it asks first. Replacing a playing track also asks first.

Audio starts off. Play, scratching and editing never arm it. Silent transports
keep moving; turning Audio on joins their current position. Record in the shared
Morphazoid header records the master mix. Local files are decoded in the browser
and are not uploaded. This first version keeps files and mix state only for the
current page session: reload clears them. It does not request microphone access.

## Stereo shape mixer

**Stereo shape** in Track view and Tiny tracks maps the eight stereo tracks to
one stereo master mix. Each numbered point controls the same pan and volume as
its deck: left to right is stereo pan, and top to bottom is 100% to 0% volume.
Opening the mixer displays the current mix without changing it or turning
Audio on. In Track view and Tiny tracks, the toolbar's polygon button opens a
larger native dialog; the panel also has an expand button. Close it with
the close button, Escape, or the backdrop.

In **Move** mode, drag a numbered point to change one track, or drag the space
around the points to move all eight together. **Rotate** turns their pan and
volume positions around the group's center; **Stretch** changes stereo spread
with horizontal movement and the spread of track volumes with vertical
movement. These gestures change the actual mix. The octagon button explicitly
arranges all eight tracks into a spread-out starting shape, changing both their
pans and volumes. It is never applied just by opening the mixer.

Select a track by its number or the Track menu, then use the **Pan** and
**Volume** sliders for precise edits. A focused numbered point also accepts
arrow keys; hold Shift for smaller movements. Expand **Shape controls** for
keyboard-accessible **Turn**, **Width**, and **Height** sliders. These group
controls work relative to the start of each gesture: on release, their handles
return to 0° or 1× while the new mix stays in place.

**Undo** restores the previous shape edit, one step only. Editing pan or volume
elsewhere clears that shape undo. **Center pans** moves every track to the
stereo center while preserving its volume. Muted tracks and tracks excluded by
solo appear dimmed; their points still control their underlying pan and level.
The shape shares the existing deck mixer and master output, so EQ, filters,
and mute/solo still apply. Shape edits preserve playback, loops, SYNC and the
Audio state.

## SYNC and master selection

Click any track's **crown** to make it the one tempo master. The selected crown
has a colored circular background, and selecting another clears the previous
one. Track 1 starts as master. Each other track's **SYNC** independently chooses
whether it follows that master or keeps its own tempo. **SYNC ALL** enables
all followers, or releases them when all are already selected. The master
itself does not follow another track. Selecting a new master leaves the former
master independent at its current tempo; each other track keeps its SYNC
choice. Independent tracks keep their own tempo.

Source BPM defines beat spacing and the cue defines beat zero. The demos have
prepared grids; imported tracks begin with an assumed 120 BPM and a zero cue.
Enter their actual tempo and set a cue on a beat before syncing. This aligns
beat phase, not musical downbeats or phrases. Moving the cue keeps an existing
loop region; the next loop choice uses the new grid origin.

When the selected master is playing and not being scratched, enabled followers
match its effective tempo and align to the nearest matching beat phase. Changes
to its rate or source BPM propagate to those followers. The Master BPM knob and
Tap use that same selected master; they do not edit each file's source BPM.
A paused follower keeps SYNC for its next launch. Starting, seeking, changing a
loop or cue, editing source BPM, and releasing a scratch rejoin the master when
that track's SYNC is enabled. Manually changing a follower's rate, including the
**1×** reset, releases only that follower; other selected tracks keep following.

Pausing or scratching the master suspends phase alignment: followers continue
at the matched tempo, and rejoin when the master resumes or is released.
SYNC stays enabled while alignment is suspended. Selecting another crown
changes the master explicitly; the app does not automatically choose one.
Master selection, SYNC and Tap never start a paused track or turn Audio on.

SYNC cannot match a follower outside its ½×–2× rate range. A loop clipped to
the file boundary must span a multiple of half a beat, allowing one decoded
sample of rounding; half-beat loops align on that subdivision. That tiny
rounding difference can accumulate over repeated wraps. Incompatible tempo or
loop bounds report a sync error rather than claim a lock. A full file with an
unmatched beat length can still loop, but needs a compatible beat-loop choice
for phase sync. Source BPM metadata stays intact. All tracks share one audio clock, and synchronized source changes
are scheduled at the same audio-clock boundary.

## Contract and limits

The causal chain is file/demo samples → hand-controlled record or transport
position → signed sample playback/rate/loop → EQ/filter/wobble → level/pan/solo → stereo master output.
The instrument has eight decks, bounded source replacement fades, smoothed
parameters, and protected master output. Graphics run at a maximum of 30 fps
and device-pixel ratio 2 (20 fps and ratio 1 on touch/constrained devices);
offscreen records and unchanged waveforms do not redraw. Circular waveform
geometry is cached, and reduced-motion preferences stop automatic platter
rotation while preserving direct scratching and the file-position indicator.
The fixed three-o'clock needle does not rotate. Record rotation and the
circular waveform describe the active loop, with one turn per loop. The taller
waveform is a visual amplitude boost and does not change audio gain.
Sample playback and modulation run in Web Audio,
independently of animation frames. Scratching uses signed interpolated PCM
in an AudioWorklet, with bounded velocity and release ramps; it requires
AudioWorklet support in a secure context (HTTPS or localhost). Normal playback
remains available if that capability is unavailable. Navigation releases its nodes, context,
output connection, pointer/event handlers and animation loop.

Files must be supported by the browser's audio decoder. Import bounds are
64 MB encoded per file, ten minutes, one or two channels, 64 MB decoded per
deck and 192 MB decoded across the session on the standard profile. A failed import keeps the previous
deck. Source BPM is an editable assumption (120 initially), not an analysis.
The shared MIDI controls expose general parameter/transport integration;
dedicated DJ controller mappings and MIDI Learn are not implemented.

## iPhone and older phones

The compatibility target is **iOS/iPadOS 15.4 or later in Safari**, over HTTPS.
Safari introduced AudioWorklet in [iOS 14.5](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/);
the shared controls also use features such as native dialogs supported in
[iOS 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).
This is an API compatibility target, not a measured guarantee for every device.
Current Linux WebKit automation is separate from testing Safari on an actual
older iPhone. Native Safari does not provide Web MIDI.

Coarse-pointer devices, devices reporting at most 4 GB RAM, and devices reporting
at most four logical processors automatically use a constrained profile. It
keeps all eight decks, decodes imports at 32 kHz, limits encoded files and decoded
tracks to 16 MiB each, and gives loaded-track PCM a 64 MiB budget across the
session. Use short clips or mono files to fit more audio. Scratch windows and
replacement fades add bounded storage, and the browser decoder can temporarily
allocate more before a decoded file's size is known. The standard profile uses
48 kHz and the larger limits above.

Before mobile decoding, a metadata-only reader checks that the duration could
fit even as mono PCM (at most about 131 seconds with an empty track slot).
An unreadable duration or overlong clip is rejected before native decoding;
the previous track stays playable. Actual decoded channel and byte limits
still apply, so stereo clips may need to be shorter. Replacing an import or
leaving the page cancels metadata inspection and releases its temporary URL.

Scratching transfers only two seconds of PCM at a time, retaining at most two
windows per held deck, instead of copying an entire track at each touch.
Native playback remains independent of main-thread drawing. Scratch refills
still need the main thread; long browser stalls can exhaust the available
window. After a phone call, backgrounding or another audio interruption, return
to the page and explicitly tap Audio to resume. Touch transport targets remain
48 px, tempo fields avoid Safari's automatic input zoom, and the layout accounts
for safe-area insets. The compact Records view is the lightest performance view.

This is an original MVP inspired by the observable mixing workflow of
[Algoriddim djay for iOS](https://www.algoriddim.com/djay-ios) and its
[interface documentation](https://help.algoriddim.com/user-manual/djay-ios/getting-started/interface).
The references motivate vinyl platters, decks, transport, cues, loops and EQ;
eight decks, the tiny view, the stereo shape mixer, and the wobble pad are
Wobblini's own extension.
The distinction between master tempo and beat-phase sync is informed by
[Native Instruments' Traktor concepts](https://docs.native-instruments.com/online-guides/traktor-pro-manual/en/global-concepts.html).
Wobblini uses explicit master selection and manual grids; it does not implement
Traktor's automatic master selection or full beatgrid workflow.
No proprietary app binaries, code, sounds, graphics or branding are copied.
The demo audio is synthesized by this repository's code; the catalogue artwork
is an original procedural composition. Neither requires external media access.

Streaming accounts, AI stem separation, automatic beat detection, adaptive
beatgrids, independent headphone pre-cueing and pitch-locked stretching
are outside this MVP. Cue here means return to the saved position, not a
separate headphone output. Browser automation checks mechanical behavior,
bounded output, control sensitivity, import, recording and responsive layout;
human listening and physical phone/controller testing remain separate.
