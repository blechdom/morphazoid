# Playing Spider Synth

Turn **Audio** on, then pluck a strand or start **Animation**. **Sound** holds
body resonances independently. Shorter contacted silk segments ring higher;
raise Tension for a tighter, brighter web, or Damping for shorter, softer notes.
Choose a motion preset to hear its own body and web mix. Random sound and
Random animation are separate controls.

Drag a body joint to change its sound. Choose X, Y or Z for a single axis;
**Move on web** makes dragging the body relocate the spider’s strand contacts.
Blank-space dragging rotates the camera. Zoom uses the explicit +/− buttons.
On a phone, vertical swipes scroll; 3D touch gives dragging full ownership until
it is turned off. Fit restores the selected view. Joint markers help select
small parts. The head and thorax are one cephalothorax; palps and fang regions
have authored small pivots. The Spinnerets sound row follows the abdomen.

The compact mixer assigns one source, level, Mute and Solo per body group or
web layer. Individual leg joints still influence pitch, filter, pan and contact
while sharing the Legs source. Catch a bug produces a finite flutter on a
strand. Type into **Voice** and press **Say it**, or Control/Command+Enter.
Words temporarily animate the face without starting Animation.

## MIDI and computer keys

Enable **MIDI In** in the shared top bar. This enables the computer keyboard and,
where supported, requests hardware MIDI permission. Computer keys work even if
there is no connected keyboard. Notes never press either Play button.

| Pitch class | Held pose / sound |
| --- | --- |
| C | Left front leg |
| C♯ | Left second leg |
| D | Left third leg |
| D♯ | Left rear leg |
| E | Right front leg |
| F | Right second leg |
| F♯ | Right third leg |
| G | Right rear leg |
| G♯ | Head / thorax |
| A | Abdomen |
| A♯ | Palps |
| B | Fangs |

Higher/lower octaves change the pitch and reach. Velocity controls strength;
pitch bend moves two semitones either way. Polyphonic/channel pressure and
expression shape owned notes, and sustain holds them after release. Notes from
different device/channel pairs retain separate ownership. **Release MIDI**
returns temporary note and CC poses without resetting the main instrument.

Computer keys: `Z S X D C V G B H N J M` = C3–B3;
`Q 2 W 3 E R 5 T 6 Y 7 U` = C4–B4. `[` and `]` change octave;
`-` and `=` change velocity. Typing in the voice field does not play notes.

The eight default macros control Tension, Damping, Brightness, Coupling,
Legs Y, Abdomen X, Head/thorax Y and Palps X. Open **CC routes & key map**
to assign each knob to a sound control, body axis, group level, source, preset
or button. Button routes trigger on a crossing through halfway. Generic MIDI
uses CC14–21; Settings → MIDI Map adapts supported hardware profiles.

Standard controls: CC1 movement, CC7 master, CC10 pan, CC11 expression,
CC64 sustain, CC71 body, CC74 brightness. Program Change selects a sound
preset. MIDI Start/Continue/Stop controls Animation and incoming clock sets
tempo. A configured hardware macro takes precedence over an overlapping CC.

Audio and MIDI routing in the WAX build remain owned by the host adapter.
Normal browser MIDI input is never echoed automatically to MIDI output.
