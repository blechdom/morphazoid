# Witch

Witch is a work-in-progress gesture instrument: she brews her own voice, plays
five instrumental fingers, and rides a musical broom. Open `witch.html`,
enable **Audio**, then circle the ladle or choose **Stir for me**.

| Gesture | Picture | Sound |
| --- | --- | --- |
| Stir faster | Faster vortex and articulation | Faster invented syllables |
| Widen the circle | Wider whirlpool and open jaw | Broader vowel resonances |
| Reverse | Vortex changes direction | The syllable path runs backward |
| Release | Vortex coasts and mouth relaxes | Voicing dissolves into breath |
| Bend a finger | Its long finger curls and glows | Independent glass, reed, wire, metal or marimba pitch and brightness |
| Fly higher / faster | Broom rises / accelerates | Higher instrumental pitch / faster plucked pattern |
| Fly across the sky | Broom travels left or right | Stereo position moves with it |
| Touch moon, bats, ghosts | The touched creature responds | Moon bell, bat ticks, ghost chimes |
| Add glass / hair | Potion changes | Ringing resonances / unstable harmonics |

The cauldron voice choices cover muttering, whisper, creak, cackle and singing. These
are original procedural synthesis gestures using a voiced/noisy source and
vowel-like resonances, not recordings or a measured model of a real singer.
Backward means reversing the authored syllable trajectory, not reversing a
recorded waveform. Pitch is continuous; there is no scale quantization.

Fingers uses Gesticules’ five-voice synthesis engine with instrumental sources:
thumb glass, index reed, middle wire, ring metal and little finger marimba.
Each bend changes its own pitch and tone. Hold several fingertips or number
keys together, or choose **Play the hand** to sustain the whole hand. Moving a
finger also re-excites the struck metal and marimba sounds. Brightness shapes
the instrument mix. Cauldron character and ingredients do not color this scene.

Night flight has its own plucked-string and bell pattern. Altitude continuously
transposes it, flight speed changes the strike rate, and horizontal position
pans the music. Brightness changes the partials. Tap beside Flight speed sets one
broom note per tap; the cauldron’s Tap sets one complete ladle turn. The scenery adds instrumental
accents; there is no chanting or automatic cackling in flight.

Audio starts off. Gestures and Play never arm it. Play provides an automatic
gesture or sustained instrument. Taking the ladle or broom takes over manually;
in Fingers, each held finger plays independently while stopped, and Play keeps
the whole hand sounding through edits. Releasing a manual gesture fades it.
Presets retain Audio, output volume and the current Play state. Changing scenes
retains the settings and smoothly changes the sound engine. Reset
returns to the original cauldron, releases the sound and clears the ingredients,
while retaining the explicit Audio arm and output level.

Every gesture has a native control alternative. With the picture focused,
arrows stir/open the voice; Fingers uses held 1–5 keys to play fingers and arrows
to bend the selected finger; Night flight uses arrows to steer and M/B/G/S/W for
moon bells, bat ticks, ghost chimes, star plucks and wind. Native finger sliders
also play their instrument while held or adjusted with keys. Space toggles Play,
Escape releases. Pointer cancellation and
window blur release manual gestures. Hidden pages mute; navigation disposes
audio and animation. Shared MIDI exposes control learning and transport; it
does not turn note keys into an unrelated piano voice.

Synthesis and effects run on the AudioWorklet sample clock. Drawing follows
audio telemetry. The renderer uses authored Canvas paths, capped at 2× pixel
density, and the engines have bounded output and effect resources. All artwork
and sounds are original procedural material; no external media is required.

This first version needs human listening and physical touch-device review.
Automated tests can establish signal bounds and interaction behavior, but do
not establish that a cackle is convincing or the singing is beautiful.
