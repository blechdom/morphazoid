# Morphazoid Audio and Transport Contract v1

## Separate controls

In the browser, **Audio** is an explicit arm and master mute. A transport
control changes automatic motion, sequencing, or simulation only. Play,
keyboard Space, pointer scrubbing, MIDI transport, and programmatic clicks do
not silently change the Audio control.

- Audio Off is a valid performance state. Visual transport and manual geometry
  can continue silently.
- Turning Audio on while a transport is already moving joins the current phase;
  it does not restart the score.
- Turning Audio off releases or mutes audible voices without changing the
  visible transport state unless the instrument cannot safely decouple those
  lifecycles and documents that exception.
- The Audio control stays in the masthead, outside settings and parameter
  disclosures. It is an icon-only speaker control: the off state uses a muted,
  slashed speaker; the on state uses sound waves, a filled background, and a
  glow. Starting and error states remain visually distinct. The canonical
  accessible name and title describe the state and corresponding action, so
  state is never conveyed by color alone.
- If a primary transport is started or requested while Audio is off, a visible
  polite live status says: “Audio is off — turn it on to hear playback”. This
  stays truthful when an instrument declines to start until Audio is armed. The
  instruction remains until Audio is on or the transport is stopped again.

The explicit Audio action is also the browser user gesture that creates or
resumes Web Audio. An implementation should perform that work directly from the
Audio handler, before unrelated asynchronous work can consume transient user
activation on mobile browsers.

## Primary transport keyboard shortcut

The shared navigation runtime assigns `aria-keyshortcuts="Space"` to the first
`[data-primary-transport]`, falling back to `#playButton`. One capture-phase
handler clicks that control for an unmodified, non-repeating Space keydown.

The shortcut does not click or prevent the browser default for an event that is
already prevented, composing, modified, repeating, or disabled. On a page
surface, the capture handler still stops those guarded Space events before
legacy bubbling handlers can toggle the transport. It leaves Space completely
untouched when targeted within:

- a native input, select, textarea, button, link, summary, audio, or video
  control;
- editable content; or
- an ARIA widget such as a textbox, slider, spinbutton, combobox, switch, tab,
  menu, listbox, tree, or grid.

This preserves text entry, range manipulation, disclosure behavior, page-owned
performance keyboards, and native Space activation on a focused button. Once
the shared shortcut actually activates the transport, it prevents scrolling
and stops legacy page handlers from toggling the same transport a second time.
Disabled or `aria-disabled` transports are never activated.

On coarse-pointer devices, Audio and primary transport controls expose at least
a 48 by 48 CSS-pixel target without constraining wider labeled controls.

Primary transports must be visible without opening a disclosure. A control
matched by `#playButton` or `[data-primary-transport]` may be inside `<details>`
only when that disclosure is open in the authored HTML, preserving the same
route when modules fail or JavaScript is unavailable.

## Explicit preset motion on Shape

The owner requested that Shape's main presets restore Playhead and Rotation
on/off, speeds, directions and relative head spacing. On `shape-synth.html`,
main preset recall may therefore start or stop those visual/musical motions,
but **never arms or disarms Audio**. Registering the preset bank on page load
does not apply a scene: startup remains Audio off and both motions paused.

Recall preserves the current physical playhead position and rotation angle,
rebasing the continuous phase only when motion mode changes. Starting from
rest resets timing references so elapsed idle time does not become an overdue
burst. Already-running motion is not restarted. A scene that pauses both motions
releases existing sound through the normal fade while leaving Audio armed.
Direct Play/Rotate controls remain usable after recall.

The owner's full-parameter randomization requirement also includes these
musical Playhead/Rotate switches. Dice may select playhead-only, rotation-only
or both, without arming Audio or resetting live phase. Other instruments'
external play/stop flags remain outside their preset snapshots; a serialized
algorithmic `loop` setting is a musical policy and may vary without restarting
its running transport.

Shape, Solid and Hyper have explicit owner-requested full-scene motion recall.
This does not change the independent Audio boundary or authorize automatic
transport changes on other instruments.

## Other full-scene adapters

Solid and Hyper presets now recall their primary Play flag and independent
rotation/surface-motion switches, so playhead-only and shape-only scenes are
unambiguous. Moving-playhead scenes retain the current phase. Shape-only scenes
center the stationary slice at phase 0.5 instead of inheriting a potentially
out-of-bounds slice; current rotation angles remain live. Neither recall nor
randomization arms Audio. Startup still leaves all motion and Audio off.
Shapes' mixed bank follows the same explicit motion exception. It preserves the
user's master level, live angles and Audio arm; scene level is separate. Its
existing persisted visual-motion state may resume silently at startup, but the
header still shows Select Preset and does not apply a factory scene. Corners and
Notes share one player: one subdivision retains corner/vertex anchors and higher
values add intermediate notes. Original corner percussion remains a sound option;
tonal notes have independent ADSR envelopes and optional pre-marker swell, without
resetting prior tails at each marker. Manual rotation and scrubbing preserve
those tails and start a complete envelope at each crossing; only predictable
automatic motion anticipates a marker for swell. Manual takeover cancels
unstarted forecast notes, not envelopes already sounding. The same manual-motion
boundary applies in 2D, 3D and 4D: Continuous updates its existing voices smoothly,
and both Triggers banks let hits finish while canceling only unstarted forecasts.
Repeated drag updates preserve trigger debounce rather than resetting it.
Continuous still fades when all motion stops; Audio off and explicit transport
stops retain their normal release behavior. The 3D canvas picks against the shape’s projected outer outline: outside rotates
the shape’s X/Y angles; inside rotates the reading surface’s yaw/pitch. The
target stays fixed until release, and only its corresponding automatic axes
are paused. Reader position remains available through its slider and arrow keys.
The 4D canvas defaults to reader movement and has an explicit Canvas drag
selector for X–W, Y–W or Z–W rotation. Dragging or using Left/Right Arrow takes
over only the selected plane, preserving the reader and other planes' motion,
and never arms Audio. The selector is interaction state, outside presets and
randomization. Axis knobs and Rotate controls remain available.
Continuous spatial swell is retained, and Triggers remains a separate drum-bank
player. Device-learned polyphony limits are
runtime-only, outside preset and persistent musical state.
Puzzle, graph, L-System, Hybrinx and Jaw Harp adapters likewise retain their
external primary player. Musical loop, automatic-motion, breath and read-path
settings may vary as part of a full scene without silently arming Audio.
Automatapoeia's new seed lineage is musical score data, not a new audio session.
Microphone presets retain the existing stream/input-pause state; selecting a
scene must never initiate device permission or silently choose a new backend.

## MIDI and WAX boundaries

Browser MIDI input remains governed by the Web MIDI toolbar contract. Its
existing explicit MIDI-enable gesture may prepare page audio where that
instrument’s current MIDI contract requires it; removing that exception is a
separate migration from transport behavior.

WAX and DAW hosts own their audio graph and host transport lifecycle. A WAX
adapter may activate an instrument graph or follow host Play without changing
the browser-facing meaning of the page Audio button. Host behavior must remain
isolated to a positively detected WAX artifact.

The shared `AudioOutputManager` meters and routes final output. Its header meter
keeps independent left and right signal taps, displays both channels, and
retains aggregate values only for compatibility. This makes hard panning,
channel imbalance, and channel-specific clipping visible. It does not decide
whether Audio is armed and must not infer activation from signal level, an
`AudioContext` state, Play, MIDI, or pointer events.
