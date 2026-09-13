# Playing Spider Synth

Turn **Audio** on, then pluck a strand or start **Animation**. **Sound** holds
body resonances independently. Shorter contacted silk segments ring higher;
raise Tension for a tighter, brighter web, or Damping for shorter, softer notes.
Choose a motion preset to hear its own body and web mix. Random sound and
Random animation are separate controls. Sound presets change only the sound
and voice: they preserve the web, pose, travel, tempo and both players.

Drag a body joint to change its sound. Choose X, Y or Z for a single axis;
**Move on web** makes dragging the body relocate the spider’s strand contacts.
Blank-space dragging rotates the camera. Zoom uses the explicit +/− buttons.
On a phone, vertical swipes scroll; 3D touch gives dragging full ownership until
it is turned off. Fit restores the selected view. Joint markers help select
small parts. The head and thorax are one cephalothorax; palps and fang regions
have authored small pivots. The Spinnerets sound row follows the abdomen.

The compact mixer assigns one source, level, Mute and Solo per body group or
web layer. Individual leg joints still influence pitch, filter, pan and contact
while sharing the Legs source. **Send a fly** brings in a buzzy visitor that
struggles on its trapped strand. Click it or press **Hunt bug** to approach and
eat it. Type into **Voice** and press **Say it**, or Control/Command+Enter.
Words temporarily animate the face without starting Animation.

## Web and travel

The initial web takes its zigzag decoration from *Argiope aurantia*. The scan is
the related *Argiope bruennichi*. Construction presets include other spider web
families and playful geometric patterns. Adjust radials, spiral density,
external anchors, capture spacing, asymmetry, twist, irregularity, depth and
zigzag amount. Changing construction clears the flies and extra silk attached
to the previous web. The Sound preset never changes construction.

Drag the round **Steer** pad or focus it and hold arrow keys. Steering follows
the current camera's directions across the web. Release to stop
manual travel. **Roam during animation** follows the chosen path; Speed and
Range shape that route. Tempo changes the pace of complete strides, including
body travel. Motion presets recall their own path, speed and range while
preserving your tempo; stationary gestures start with a held path. Choose a
travel path to make those gestures roam, or steer them yourself. **Home**
returns to the hub. Arrow keys over the 3D
canvas still orbit the camera; Shift+arrows manipulate the selected joint.

Turn on **Lay silk** and travel to leave new playable threads. Silk level sets
the spinning sound; **Clear new silk** removes those added strands. Plucked
threads visibly vibrate around their contact points. The base graph and newly
laid silk share the bounded audio voice pool.

**String voice** separates pluck Register and Pitch span from body/voice tuning.
Longer strands remain lower within a preset; Register transposes the whole web
and Pitch span widens or narrows its intervals. Attack, Hold and Release shape
each pluck’s loudness contour. Decay and Damping shape the vibrating string
inside that contour. Sound presets recall different registers, materials and
envelopes, from dry little ticks to high chimes and softly rising silk.

Texture, Glide, Courtship and Space expand body resonances into rubbing,
sliding, tremulous and layered timbres. Courtship is a musical pulse macro,
not a calibrated recording. Individual motion sources settle when movement
stops; Sound Play owns the held resonance layer.

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

Choose **Poses + travel** under Notes to steer with MIDI while also playing body
parts. C moves forward, D♯ right, F♯ backward and A left; intermediate notes
blend directions. Chords combine directions, and velocity/octave change reach.
Releasing a note ends its steering even when sustain holds its pose and sound.
**Body poses** remains the default. Neither note mode changes Sound or Animation
Play. CC routes can also choose web construction/path, shape web geometry,
control travel speed, lay silk or send/hunt a fly.

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
