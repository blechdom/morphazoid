# Morphazoid Web MIDI toolbar contract v1

## One connection control

Mapped browser instruments expose one MIDI toggle in the shared masthead. The
toggle is the only control that requests Web MIDI permission.

- Off → On activates the built-in computer keyboard immediately, then calls
  `requestMIDIAccess({ sysex: false })` from the same explicit click when the
  browser supports hardware Web MIDI.
- On selects the page's MIDI performance mode where one exists.
- On → Off sends CC120 All Sound Off before listeners detach, then restores the
  page's normal Drone/non-MIDI behavior.
- Enabled state is never restored automatically after navigation. Controller
  profile choice is persisted.
- The toolbar stays hidden until the page registers a MIDI client.

The Audio control remains separate. A page may prepare Web Audio from the same
explicit MIDI click when its performance model requires it.

## Built-in computer keyboard

Every mapped instrument receives a computer-keyboard MIDI source while the
top MIDI toggle is on. It does not depend on a connected device or successful
Web MIDI permission, and controller-profile selection never reinterprets it.

- Melodic instruments use `Z S X D C V G B H N J M` for C3–B3 and
  `Q 2 W 3 E R 5 T 6 Y 7 U` for C4–B4.
- FM Drums preserves its 4 × 4 grid: `1 2 3 4`, `Q W E R`, `A S D F`,
  `Z X C V`, producing notes 36–51.
- `[` / `]` shift the computer keyboard by octaves; `-` / `=` lower or raise
  velocity.
- Editable fields and Ctrl/Alt/Meta shortcuts are ignored. Held notes are
  released on keyup, blur, page hiding, client removal, and MIDI Off.

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
- Shape: keyboard notes transpose the geometric voice around C4; macros Sides,
  Roundness, Stretch, Skew, Playhead speed, Rotation, active Sound character,
  Stereo width. Pad slots select sound/playhead modes and performance commands.

The shared registration API is deliberately page-neutral so remaining demos
can add an instrument adapter without adding another permission button.
