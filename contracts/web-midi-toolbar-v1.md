# Morphazoid Web MIDI toolbar contract v1

## One connection control

Every playable catalog instrument exposes one MIDI toggle in its shared top
bar. Morphazoidical hosts the same control in its custom workbench top bar. The
toggle is the only control that requests Web MIDI permission.

- Off → On activates the built-in computer keyboard immediately, then calls
  `requestMIDIAccess({ sysex: false })` from the same explicit click when the
  browser supports hardware Web MIDI.
- On selects the page's MIDI performance mode where one exists.
- On → Off sends CC120 All Sound Off before listeners detach, then restores the
  page's normal Drone/non-MIDI behavior.
- Enabled state is never restored automatically after navigation. Controller
  profile choice is persisted.
- The toolbar stays hidden until the page registers a MIDI client. The seven
  native clients and the catalog-wide universal client are mutually exclusive
  in the normal browser build.

The Audio control remains separate. A page may prepare Web Audio from the same
explicit MIDI click when its performance model requires it.

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

Wheel of Organs, Throatazoid, Spelling Synthesizer, Lumber Loops, and L-mic
reserve their existing typing, record, or input shortcuts. Their universal
client still accepts hardware MIDI, but it does not attach the shared QWERTY
listener or suppress those page-owned keys.

Virtual events use a stable per-client source ID and the General MIDI logical
profile, so they can coexist with physical controllers without inheriting an
NI, Akai, Arturia, or Novation pad mapping.

## Controller profiles

`Auto (per device)` resolves every connected input independently, allowing a
keyboard and a pad controller to be used together. A manually selected profile
overrides Auto for all inputs on the page.

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

- Note-on retunes a clearly labeled frequency, pitch, carrier, or root control
  where present. Pitched pages then start an explicit Play control; sequence
  pages prefer Step or Primary Action and otherwise start Play; drum pages
  prefer an exact pad, then an explicit Strike/Trigger, then Play.
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
- MIDI Clock estimates tempo at 24 PPQN. Start/Continue and Stop drive an
  explicit page transport where one exists. Song Position remains available to
  exact adapters through the public event.

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
