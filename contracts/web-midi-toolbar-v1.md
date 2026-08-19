# Morphazoid Web MIDI toolbar contract v1

## One connection control

Every playable catalog instrument exposes one MIDI toggle in its shared top
bar. Morphazoidical hosts the same control in its custom workbench top bar. The
toggle is the only control that requests Web MIDI permission.

The compact bar keeps performance state visible in this order: MIDI In and its
receive light, the actual pre-destination stereo L/R audio meter, master level, Audio, and
a far-right Settings disclosure. The receive light flashes only for incoming
hardware or computer-key messages. The meter is registered explicitly at each
engine's final master/limiter output; it reports signal sent toward the browser
or WAX destination, not the operating system's speaker volume. Left and right
remain independently metered so panning, imbalance, and per-channel clipping
are visible.

- Off → On activates the built-in computer keyboard when that page has a safe
  note mapping, then calls `requestMIDIAccess({ sysex: false })` from the same
  explicit click when the browser supports hardware Web MIDI.
- On selects the page's MIDI performance mode where one exists.
- On → Off sends CC120 All Sound Off before listeners detach. Native synth
  clients restore their normal Drone/non-MIDI mode. Universal pages retain any
  visible control or transport changes already made, but receive no new MIDI.
- Enabled state is never restored automatically after navigation. Controller
  profile choice is persisted.
- The toolbar stays hidden until the page registers a MIDI client. The seven
  native clients and the catalog-wide universal client are mutually exclusive
  in the normal browser build.

## Input and output settings

The native Settings disclosure is titled `Morphazoid Settings`. It contains
normal form controls rather than ARIA menu items: exactly five visible
label/select rows in this order — Audio Out, Mic / Audio In, MIDI In, MIDI Out,
and MIDI Map — followed by one `MIDI Guide` link. Routine status, setup, and
mapping prose belongs in that guide, not in the compact panel. A row may show a
short alert only when a real permission, hardware, or route error occurs.

- Audio Out is always visible. Browser device choice is enabled only when
  `AudioContext.setSinkId()` is feature-detected; otherwise its disabled option
  truthfully names the system/browser destination. WAX identifies this route as
  the DAW / plug-in host and never requests an operating-system sink.
- Mic / Audio In is always visible. It is disabled and greyed out when the
  current instrument has no live-input path. Instruments that do use live input
  still own microphone permission, stream start, and device routing in their
  page controls; the shared row must not imply unsupported device selection.
- MIDI In represents the manager's aggregate input state. The manager listens
  to all available inputs and does not pretend to offer per-device filtering.
  The toolbar MIDI toggle and this row stay synchronized.
- MIDI Out remains separate and off by default. A disabled option identifies
  instruments without output. Output-preview pages show the mobile-safe
  `Preview · no route` label and expose the full `preview only, not routed`
  meaning to assistive technology; the normal browser does not expose a
  destination chooser, explicitly select a destination, or send until a later
  mapping/router contract has been implemented. WAX-capable MIDI FX
  pages leave host destination, channel, clock, and panic routing with the WAX
  adapter. Incoming events are never echoed automatically.
- MIDI Map selects the input controller profile. Its internal `auto` profile is
  presented as the initially selected `Computer keys` option: computer keys
  remain immediately available while connected hardware is detected per
  device. Choosing a named profile forces that hardware layout. Output routing
  does not get a duplicate controller map.

The Audio control remains separate. A page may prepare Web Audio from the same
explicit MIDI click when its performance model requires it.

## MIDI output preview

Pages whose capability declares MIDI output expose one flow-contained `MIDI Out
Monitor` at the bottom of the existing control rail in the normal browser build.
It is an observability layer, not a virtual MIDI port: every event is marked
`mapped: false` and `sent: false`, it does not request Web MIDI permission, and
it contains no routing or mapping controls.

- `note` previews come only from an instrument's own accepted onset logic.
  Generic DOM position or pointer movement must never be guessed into notes.
  A finite audition duration is labeled as a gate candidate unless the page
  publishes an explicit contact-exit note-off.
- Trusted user movement of continuous controls may expose the formatted value
  plus an unassigned normalized 0–127 CC candidate. Instrument-owned telemetry
  may publish moving playhead or model values under stable source IDs.
- A value is called a MIDI Clock candidate only when it is genuinely expressed
  in BPM. Cycles per second, steps per second, and other rates remain explicitly
  unmapped timebases; the monitor does not invent 24-PPQN ticks.
- Transport rows reflect primary page transport state as a preview. They do not
  claim that MIDI Start, Continue, or Stop was transmitted.
- Independent controls, polyphonic notes, and multiple transports/timebases are
  retained by stable source ID. Rapid values render at animation-frame cadence
  with `aria-live="off"` so they do not flood assistive technology.
- The panel lives in normal document flow and remains collapsible. WAX suppresses
  this browser monitor because its host-owned MIDI routing panel is authoritative.

## Built-in computer keyboard

Most instruments receive a computer-keyboard MIDI source while the top MIDI
toggle is on. It does not depend on a connected device or successful Web MIDI
permission, and controller-profile selection never reinterprets it.

- Melodic instruments use `Z S X D C V G B H N J M` for C3–B3 and
  `Q 2 W 3 E R 5 T 6 Y 7 U` for C4–B4.
- Drum instruments use a 4 × 4 grid: `1 2 3 4`, `Q W E R`, `A S D F`,
  `Z X C V`, producing notes 36–51.
- `[` / `]` shift the computer keyboard by octaves; `-` / `=` lower or raise
  velocity.
- Editable fields and Ctrl/Alt/Meta shortcuts are ignored. Mapped key events
  are captured while MIDI is on, including duplicate and repeat keydowns, so a
  page shortcut cannot fire alongside a MIDI note. Held notes are
  released on keyup, blur, page hiding, client removal, and MIDI Off.

Wheel of Organs, Throatazoid, Spelling Synthesizer, Lumber Loops, and L-system Delay
reserve their existing typing, record, or input shortcuts. Their universal
client still accepts hardware MIDI, but it does not attach the shared QWERTY
listener or suppress those page-owned keys.

Pages without a safe generic note action expose hardware MIDI for labeled
controls, presets, and transport but do not capture the shared piano/drum keys
or advertise Computer keys in the catalog.

Virtual events use a stable per-client source ID and the General MIDI logical
profile, so they can coexist with physical controllers without inheriting an
NI, Akai, Arturia, or Novation pad mapping.

## Controller profiles

The default `Computer keys` selection uses the internal Auto profile to resolve
every connected hardware input independently, allowing a keyboard and a pad
controller to be used together. A manually selected profile overrides Auto for
all hardware inputs on the page; it never disables the built-in keyboard.

Profiles normalize physical controls into eight `macro` slots and, where
available, sixteen `pad` slots. Instrument code decides what those logical
slots mean; controller profiles never write synth parameters directly.

Included profiles:

- General MIDI / Morphazoid — macros CC14–21.
- NI Komplete Kontrol S49 MK2 — explicit Morphazoid CC14–21 MIDI template.
- NI Komplete Kontrol A49 / M32 — explicit Morphazoid CC14–21 MIDI template.
- NI Maschine Mikro MK3 — MIDI mode, pads 36–51, optional CC14–21 template.
- Akai MPK Mini MK3 — macros CC70–77, pads 36–51.
- Arturia MiniLab 3 — documented encoder CCs 74, 71, 76, 77, 93, 18, 19, 16;
  pads 36–43.
- Novation Launchkey — Custom Mode CC21–28, pads 36–51.
- Custom / Pass-through — standard MIDI only; no unimplemented MIDI Learn claim.

NI knob/button assignments are user-defined in the Komplete Kontrol MIDI
Assignment Editor. The Morphazoid profile therefore describes a template to
create, not a claimed NI factory mapping. Maschine Mikro MK3 enters MIDI mode
with Shift + Project.

## Standard messages

Every profile passes through notes, velocity, channel, and pitch bend. These
standard CC meanings are also available when the active controller profile has
not assigned the same physical CC to a logical macro:

- CC5 portamento time
- CC7 master level where supported
- CC11 expression
- CC64 sustain
- CC65 portamento enable
- CC72 release
- CC73 attack
- CC75 decay
- CC120 All Sound Off
- CC121 Reset All Controllers
- CC123 All Notes Off

Controller-profile macro and pad assignments take precedence when a physical
message overlaps this standard list. For example, an Akai profile's CC72 knob
is Macro 3 rather than release, and FM Drums treats Generic CC16 as Macro 3
rather than its pass-through tune control. Choose Custom / Pass-through when
the raw standard CC meaning is preferred.

Every input receives a stable `sourceId`, so identical notes from two connected
controllers remain independently owned.

## Universal browser mapping

The normal browser site registers one conservative fallback on every catalog
page without a native MIDI client. It exposes each incoming message through a
cancelable `morphazoid:midi-input` event first. A page-specific listener may
call `preventDefault()` to own that message and suppress the fallback.

- Note-on retunes a clearly labeled frequency, pitch, carrier, root, tone, or
  fundamental control where present. Pitched pages then start an explicit Play
  control; sequence pages prefer Step or an explicitly marked
  `data-midi-trigger="step"` action and otherwise start Play; drum pages prefer
  an exact pad, then an explicit Strike/Trigger, then Play.
- Randomize and reseed controls are never generic note triggers.
- Note-off is always published to the event contract. The fallback does not
  stop global audio because doing so would cut page-owned envelopes and tails.
- Pitch bend is absolute around the last unbent value with a two-semitone
  default interpretation, and returning to center restores that base.
- Common CCs target controls by whole-word labels: modulation/depth, glide,
  output/level, pan, expression, resonance/feedback, attack, release, tone or
  cutoff, and decay. Profile macro slots map to the first eight range sliders;
  navigation, MIDI-profile, and preset selects are excluded from macro mapping.
- Program Change selects an explicit preset, and polyphonic or channel
  aftertouch targets pressure, intensity, force, or level.
- MIDI Clock estimates tempo independently per source at 24 PPQN and updates a
  page control at most four times per second, skipping unchanged stepped values.
  Start/Continue and Stop drive an explicit page transport where one exists.
  Song Position remains available to exact adapters through the public event.

Generated WAX pages never register this browser fallback. Their positive WAX
bootstrap/adapter marker leaves ownership with the WAX universal adapter, which
reuses the same control conversion helpers while adding host routing and PPQ.

## Current instrument clients

- Chaotic FM: macros Carrier, Offset, Amount, Nonlinearity, Attack, Release,
  Glide, Output.
- Recursive FM: macros Carrier, Offset, Modulation, Divisor, Attack, Release,
  Glide, Output.
- Chaotic PM: macros Depth, Mod frequency, Phase index, Phase warp, Attack,
  Release, Glide, Output.
- Recursive PM: macros Depth, Mod frequency, Phase index, Index divisor,
  Attack, Release, Glide, Output.
- FM Drums: notes/pads 36–51 trigger voices 1–16 with velocity; macros Tune,
  Decay, FM ratio, FM index, Pitch sweep, Noise, Tone, Level.
- Sample Drums: notes/pads 36–51 trigger voices 1–16 with velocity; macros
  Pitch, Decay, Tone, Level, and per-voice controls.
- Shape: keyboard notes transpose the geometric voice around C4; macros Sides,
  Roundness, Stretch, Skew, Playhead speed, Rotation, active Sound character,
  Stereo width. Pad slots select sound/playhead modes and performance commands.

Those seven pages are native clients. The remaining catalog pages use the
universal mapping until an exact adapter replaces it without adding another
permission button.
