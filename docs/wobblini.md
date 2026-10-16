# Wobblini

Eight independent audio decks, built as a Morphazoid browser instrument.
**Records** opens by default: eight circular scratchable records, each with a
center Play/Pause icon and its audio waveform wrapped around the rim. A dot
tracks the position through the complete file; a thin arc marks the loop.
The compact master strip provides Play/Pause all, Stop, BPM, Match all and
crossfading. Deck editing controls and the detailed mixer remain hidden.
Turn Audio on in the header, then play a record. The view icons switch to
**Full decks** for all controls or **Tiny decks** for miniature decks; Edit
expands one tiny deck. Switching views keeps playback and the mix intact.
Buttons use icons with accessible names and hover titles.

## Playing

- Hold and rotate a record to scratch its samples forward or backward. One
  revolution traverses 1.8 seconds of source audio. Releasing resumes at the
  hand position if the deck was playing; a paused deck stays paused. A held,
  stationary record is silent. Enabled loops wrap; files without loops stop
  at their bounds. Focus a record and use Left/Right arrows to scratch; Shift
  makes smaller movements. Pointer cancellation and lost focus release it.
- Each deck has independent Play/Pause, waveform seeking, a keyboard-accessible
  position slider, and a cue point. Set cue saves the current position; Cue
  returns to it and pauses. Space toggles all decks; keys 1–8 toggle individual
  decks when focus is outside a control. Stop returns all playheads to zero.
- The beat-loop menu starts a loop at the current beat. Seeking outside its
  region exits that loop. The demos begin with their whole 16-beat phrase looped.
- Set a file's **Source BPM** manually, then use **Match BPM** or **Match all**
  against the master tempo. Tap buttons measure your taps. Rate spans ½×–2×;
  pitch follows playback speed. This MVP does not detect beats, align beat
  phase, or preserve pitch. Changing master BPM alone does not change decks.
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

## Contract and limits

The causal chain is file/demo samples → hand-controlled record or transport
position → signed sample playback/rate/loop → EQ/filter/wobble → level/pan/solo → crossfader → master output.
The instrument has eight decks, bounded source replacement fades, smoothed
parameters, and protected master output. Graphics run at a maximum of 30 fps
and device-pixel ratio 2 (20 fps and ratio 1 on touch/constrained devices);
offscreen records and unchanged waveforms do not redraw. Circular waveform
geometry is cached, and reduced-motion preferences stop automatic platter
rotation while preserving direct scratching and the file-position indicator.
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
tracks to 16 MiB each, and retains at most 64 MiB of decoded audio across the
session. Use short clips or mono files to fit more audio. These are retained
PCM limits; the browser decoder can temporarily allocate more before a decoded
file's size is known. Desktop defaults remain 48 kHz and the larger limits above.

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
No proprietary app binaries, code, sounds, graphics or branding are copied.
The demo audio is synthesized by this repository's code; the catalogue artwork
is an original procedural composition. Neither requires external media access.

Streaming accounts, AI stem separation, adaptive beatgrids, automatic phase
synchronization, independent headphone pre-cueing and pitch-locked stretching
are outside this MVP. Cue here means return to the saved position, not a
separate headphone output. Browser automation checks mechanical behavior,
bounded output, control sensitivity, import, recording and responsive layout;
human listening and physical phone/controller testing remain separate.
