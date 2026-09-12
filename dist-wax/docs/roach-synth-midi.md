# Play Roach Synth with MIDI

Turn **MIDI In** on in the existing toolbar and choose an input. This explicit
action can arm Audio; notes and controller messages never turn Audio back on
after you switch it off. The Roach MIDI section sits between Animation and the
body mixer. **Release MIDI** releases held keys and returns MIDI joint offsets
to rest while preserving manually started playback.

## Keys and poses

Every note poses one body part or group and plays its assigned sound. Hold
several keys to combine a pose; release them to relax those parts. Notes never
start or stop either player. You can run Animation separately and layer MIDI
poses over its motion. The same map spans the whole keyboard, including both
computer-key rows.

| Note class | Body gesture | Mixer row |
| --- | --- | --- |
| C | All three left legs | Legs |
| C♯ | All three right legs | Legs |
| D | Left wing cover | Outer wings |
| D♯ | Right wing cover | Outer wings |
| E | Left hindwing | Hind wings |
| F | Right hindwing | Hind wings |
| F♯ | Thorax | Thorax |
| G | Abdomen | Abdomen |
| G♯ | Neck | Neck |
| A | Head | Head |
| A♯ | Left antenna | Antennae |
| B | Right antenna | Antennae |

Body groups repeat each octave, with higher notes producing higher pitches and
different octaves varying the pose’s tilt and reach.
Each group plays the source chosen in its mixer row, including FM, resonance,
wing buzz, rattles, plucks, footsteps, clicks and clacks. Percussion and recorded
textures are transposed effects rather than pure tuned notes. Left and right
parts can move independently but share their mixer voice; the most recently
held note in a group takes pitch priority. Velocity changes gesture strength
and impact. Holding a body key holds the pose steady, and releasing it lets
the gesture and sound decay. Tonal sources can sustain; scuttles and other
movement sounds settle once the part stops moving. The Sound and Animation
players can both remain paused while you play body notes. Changing keys does
not select animation routines or replace the sound preset.

With shared **Keys** input enabled, the computer keyboard uses the existing
two rows: `Z S X D C V G B H N J M` for C3–B3 and
`Q 2 W 3 E R 5 T 6 Y 7 U` for C4–B4. Brackets shift octaves. Typing in the
phrase box or another editable control does not play notes.

## Controller routes

Open **CC routes & key map** to assign eight profile macros. The generic MIDI
profile uses CC14–21. Controller profiles can use different physical CCs;
their macro assignments take precedence over the standard CC shortcuts below.
Each macro can target a joint group’s X, Y or Z rotation, a sound parameter,
a mixer level or source, a preset, or a button action. Rotation is centered
around the middle of the controller range and stays within the shared body
constraints. Buttons fire when a controller crosses halfway upward.

| Macro | Default target |
| --- | --- |
| 1 | Movement |
| 2 | Filter |
| 3 | Resonance |
| 4 | Crust |
| 5 | Outer wings · Y |
| 6 | Hind wings · Y |
| 7 | Head · X |
| 8 | Antennae · Y |

Macro destinations are saved in this browser. **Reset routes**
restores the table above and releases MIDI gestures. Input permission and
Audio are never enabled by saved settings.

| Message | Behavior |
| --- | --- |
| Pitch bend | ±2 semitones for body notes on that input/channel |
| Channel/polyphonic pressure | Extra gesture strength and sound expression |
| CC1 | Movement amount |
| CC7 | Master level |
| CC10 | Pan |
| CC11 | Expression for body notes on that input/channel |
| CC64 | Sustain body notes and their poses on that input/channel |
| CC71 | Resonance, unless assigned by a controller profile |
| CC74 | Filter, unless assigned by a controller profile |
| CC120 | Release all notes immediately on that input/channel |
| CC121 | Reset expression, bend, pressure, sustain and joint CCs on that input/channel |
| CC123 | Note-off for all notes on that input/channel; sustain still applies |
| Program change | Select a sound/voice preset, wrapping through the 42 menu choices |
| MIDI clock | Update tempo through the shared clock tracker |
| Start / Continue / Stop | Restart from zero / resume / pause Animation; Audio stays independent |

Disconnecting an input releases every channel belonging to that input. Turning
MIDI In off, leaving the page or using Release MIDI clears MIDI gestures and
offsets. Sound playback and Animation keep the state you selected. Only explicit
MIDI transport messages or a controller assigned to a player’s button operate
the players; keyboard notes do not.

## Timing and limits

The renderer and AudioWorklet use the same bounded gesture model and audio
clock. MIDI has at most 24 tracked notes and eight existing body sound voices;
it creates no per-note AudioNodes. Gesture envelopes, contact events and sound
modulation run independently of animation frames. Joint CC changes are smoothed
and constrained before they feed the sound and model. Animation graphics can
drop frames without supplying the musical clock. MIDI clock follows tempo;
this is not a sample-accurate external song-position or phase-lock sequencer.

Browser fake-MIDI and audio checks exercise routing, release, ownership and
output bounds. Physical-controller feel, actual-phone support and human
listening still need a device pass; software checks do not establish them.
