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
