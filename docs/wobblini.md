# Wobblini

Eight independent audio decks, built as a Morphazoid browser instrument.
**Records** opens by default: eight circular scratchable records, each with a
fixed needle above its rotating surface and a taller audio waveform wrapped
around it. A dot tracks the position through the complete file. Play/Pause
sits at the record's center, and one gear button opens a larger track-control
popup. It contains Load, per-deck Sync, Speed with a **1×** reset, Volume,
and the loop toggle and length selector. Active loops show their in/out
markers and length on the record.
Expand **Beat grid & cue** in the popup to edit source BPM, seek, save a cue,
or return to it. Close the popup with its close button, Escape, or the backdrop.
The compact master strip provides Play/Pause all, Stop, Master BPM, Sync and
crossfading. Deck 1 is always the tempo master, marked by a crown.
Deck editing controls and the detailed mixer remain hidden.
Turn Audio on in the header, then play a record. The view icons switch to
**Full decks** for all controls or **Tiny decks** for miniature decks; Edit
expands one tiny deck. Switching views keeps playback and the mix intact.
Buttons use icons with accessible names and hover titles.
Decks have no enclosing cards or visible track-name headers. A larger number
identifies each record; the other views keep their small gutter numbers.
File names remain in the platter's hover title and screen-reader description.
In Full decks and the expanded Tiny editor, Load sits beside Edit.

## Playing

- File loading starts locked. Use the global file-unlock control before
  opening Load or dropping local audio onto a deck; lock it again when finished
  loading. The lock also covers the Demo set and Load in Full/Tiny views.
  Transport, scratching, mixing and Sync remain available while locked.
- Drag the Speed and Volume knobs vertically; hold Shift for finer changes.
  Keyboard arrows adjust the focused knob. **1×** resets speed to the file's
  original rate. The popup displays each knob's current value.
- Hold and rotate a record to scratch its samples forward or backward. One
  revolution traverses 1.8 seconds of source audio. Playing decks resume at
  the hand position; a synced follower realigns to Deck 1's beat phase when
  the master is playing. A paused deck stays paused. A held,
  stationary record is silent. Enabled loops wrap; files without loops stop
  at their bounds. Focus a record and use Left/Right arrows to scratch; Shift
  makes smaller movements. Pointer cancellation and lost focus release it.
- Each deck has independent Play/Pause, waveform seeking, a keyboard-accessible
  position slider, and a cue point. Set cue saves the current position as
  the manual beat-grid origin; Cue
  returns to it and pauses. Space toggles all decks; keys 1–8 toggle individual
  decks when focus is outside a control. Stop returns all playheads to zero.
- The beat-loop menu starts a loop on the cue-relative beat grid, shifting it
  near the file boundary when needed to fit. Seeking outside its region exits
  that loop. The loop toggle uses the remembered beat length when re-enabled.
  Choosing a new length also enables the loop.
  The demos begin with their whole 16-beat phrase looped.
- Set each file's **Source BPM** and cue manually. **Master BPM** changes
  Deck 1's playback speed; **Sync** makes the other decks follow its tempo
  and beat phase. Each deck's **Match BPM** performs a one-time speed match.
  Rate spans ½×–2× and pitch follows speed. This MVP does not detect beats
  or preserve pitch. It has no Tap tempo or metronome control.
- Each deck has level, mute, solo, stereo pan, three EQ bands and a filter.
  Negative filter values remove highs; positive values remove lows. Assign a
  deck to crossfader bus A or B, or Thru to bypass the crossfader. Multiple solo
  buttons can remain active together; mute still silences a soloed deck.
- **Wobble** modulates the deck filters. Drag right for greater depth and up for
  faster modulation. The Depth and Rate sliders are equivalent controls; on
  the pad, arrow keys move the two axes and Home returns depth to zero. The
  visible wave uses the audio clock while sound is armed.
- Reset mixer restores levels, EQ, filter, pan, mute/solo and bus routing, and
  dries the wobble. It preserves imported audio, cues, loops, tempo, transport
  and the master output level. Demo set replaces all eight sources; when local
  files are present it asks first. Replacing a playing deck also asks first.

Audio starts off. Play, scratching and editing never arm it. Silent transports keep moving;
turning Audio on joins their current position. Record in the shared Morphazoid
header records the master mix. Local files are decoded in the browser and are
not uploaded. This first version keeps files and mix state only for the current
page session: reload clears them. It does not request microphone access.

## Sync

**Sync** is a persistent setting for each of the seven followers, with Deck 1
always the master. A deck's Sync button selects whether it follows Deck 1;
the master-strip Sync control enables all seven followers, or releases them
when all are already selected. Source BPM
defines beat spacing and the cue defines beat zero.
The demos have prepared grids; imported tracks begin with an assumed 120 BPM
and a zero cue. Enter their actual tempo and set a cue on a beat before syncing.
This aligns beat phase, not musical downbeats or phrases.
Moving the cue keeps an existing loop region; the next loop choice uses the
new grid origin.

When Deck 1 is playing and not being scratched, selected followers match its effective
tempo and align to the nearest matching beat phase. Changes to Deck 1's rate
or source BPM propagate to those followers. A paused follower keeps Sync
for its next launch. Starting, seeking, changing a loop or cue, editing source
BPM, and releasing a scratch rejoin the master when that deck's Sync is enabled.
Manually changing a follower's rate, including the **1×** reset or Match BPM,
releases only that follower; other selected decks keep following Deck 1.

Pausing or scratching Deck 1 suspends phase alignment: followers continue at
the matched tempo, and rejoin when Deck 1 resumes or is released. Master status
does not transfer to another deck. Sync remains enabled while alignment is
suspended. It never starts a paused deck or turns Audio on.

Sync cannot match a follower outside its ½×–2× rate range. A loop clipped to
the file boundary must span an exact multiple of half a beat to stay aligned;
half-beat loops align on that subdivision. Incompatible tempo or loop bounds
report a sync error rather than claim a lock. Source BPM metadata stays intact.
All decks share one audio clock, and synchronized source changes are scheduled
at the same audio-clock boundary.

## Contract and limits

The causal chain is file/demo samples → hand-controlled record or transport
position → signed sample playback/rate/loop → EQ/filter/wobble → level/pan/solo → crossfader → master output.
The instrument has eight decks, bounded source replacement fades, smoothed
parameters, and protected master output. Graphics run at a maximum of 30 fps
and device-pixel ratio 2 (20 fps and ratio 1 on touch/constrained devices);
offscreen records and unchanged waveforms do not redraw. Circular waveform
geometry is cached, and reduced-motion preferences stop automatic platter
rotation while preserving direct scratching and the file-position indicator.
The fixed needle does not rotate. Physical record rotation follows the
1.8-seconds-per-turn scratch scale; the circular waveform and position dot
describe the complete file. The taller waveform is a visual amplitude boost
and does not change audio gain.
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
The references motivate vinyl platters, decks, transport, cues, loops, EQ
and crossfading;
eight decks, the tiny view, and the wobble pad are Wobblini's own extension.
The distinction between master tempo and beat-phase sync is informed by
[Native Instruments' Traktor concepts](https://docs.native-instruments.com/online-guides/traktor-pro-manual/en/global-concepts.html).
Wobblini uses a fixed Deck 1 master and manual grids; it does not implement
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
