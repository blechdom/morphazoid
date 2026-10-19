# Witch

Witch is a work-in-progress gesture instrument in one continuous night scene.
She brews her voice, reaches out an instrumental hand, and takes her broom into
the sky. Open `witch.html`, enable **Audio**, then circle the ladle or choose
**Stir for me**. Click her right hand, the moon, the cauldron, or the mushrooms
to change what happens in the same picture.

| Gesture | Picture | Sound |
| --- | --- | --- |
| Stir faster | Faster vortex and articulation | Faster invented syllables |
| Widen the circle | Wider whirlpool and open jaw | Broader vowel resonances |
| Reverse | Vortex changes direction | The syllable path runs backward |
| Release | Vortex coasts and mouth relaxes | Voicing dissolves into breath |
| Click her right hand | A long, articulated 3D hand reaches toward you | Five independent instrumental voices become playable |
| Bend a fingertip | Its long finger curls and glows | Glass, reed, wire, metal or marimba pitch and brightness |
| Click the moon | She takes off on her broom | One launch cackle, then instrumental flight music |
| Fly higher / faster | Broom rises / accelerates | Higher instrumental pitch / faster plucked pattern |
| Fly across the sky | Broom travels left or right | Stereo position moves with it |
| Touch the moon, bats or ghosts while flying | The touched creature responds | Moon bell, bat ticks or ghost chimes |
| Click the cauldron | She returns to her potion | Brewing controls and voice return |
| Click a mushroom | Colors change and the picture ripples | Playback continues unchanged |
| Add glass / hair | Potion changes | Ringing resonances / unstable harmonics |

The cauldron voice choices cover muttering, whisper, creak, cackle and singing.
These are procedural synthesis gestures using a voiced/noisy source and
vowel-like resonances, not recordings or a measured model of a real singer.
Backward means reversing the authored syllable trajectory, not reversing a
recorded waveform. Pitch is continuous; there is no scale quantization.

Her reaching hand uses Gesticules’ actual weighted 3D hand model and five-voice
synthesis engine: thumb glass, index reed, middle wire, ring metal and little
finger marimba. Each bend changes its own pitch and tone. Hold several fingertips
or number keys together, or choose **Play the hand** to sustain the whole hand.
Moving a finger also re-excites the struck metal and marimba sounds. Brightness
shapes the instrument mix. Cauldron character and ingredients do not color the
hand's instrumental voices.

Clicking the moon starts flight and its music. With Audio enabled, takeoff adds
one short cackle; it does not repeat during ordinary flight. Clicking the moon
again while flying plays a bell. The ongoing music has a plucked-string and bell
pattern: altitude continuously transposes it, flight speed changes the strike
rate, and horizontal position pans the music. Brightness changes the partials.
Tap beside Flight speed sets one broom note per tap; the cauldron's Tap sets one
complete ladle turn. The scenery adds instrumental accents.

Each mushroom cycles through three altered palettes and returns to the original
on the fourth activation. The altered picture has wavy lines; the playable
fingertips and other targets follow their visible positions. Palette changes
preserve the current instrument, Audio and Play.

Audio starts off. Gestures and Play never arm it. The moon is a takeoff gesture,
so it starts Play; opening the hand or using **B** / **Return to pot** retains the
current Play state. Touching the cauldron or broom takes over manually. Each held
finger plays independently while stopped, and Play keeps the whole hand sounding
through edits. Releasing a manual gesture fades it. Presets retain Audio, output
volume and the current Play state. The instruments retain their settings and
crossfade when you move between them. Reset returns to the original cauldron,
releases the sound and clears the ingredients while retaining explicit Audio
arming and output level.

With the picture focused, **H** reaches out the hand, **M** takes off or rings the
moon bell while flying, **B** returns to brewing, and **W** cycles the mushrooms.
**Escape** returns to the cauldron and stops Play. **Space** toggles Play. While
flying, **T/G/S/V** play bats, ghosts, stars and wind. Arrows stir/open the voice
or steer the broom. In the hand, hold **1–5** to play individual
instruments; arrows bend the selected finger. Native finger sliders also play
while held or adjusted with keys. The controls beside the picture provide
alternatives for bending, steering, ingredients and scenery accents. Pointer
cancellation and window blur release manual gestures. Hidden pages mute;
navigation disposes audio and animation. Shared MIDI exposes control learning
and transport; it does not turn note keys into an unrelated piano voice.

Synthesis and effects run on the AudioWorklet sample clock. Drawing follows
audio telemetry. The scene uses authored Canvas paths and a locally loaded 3D
hand, with bounded rendering and audio resources. Sounds are procedural; no
external service is required to play.

The hand model is **[Rigged hand](https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e)**
by **[Elena FF](https://sketchfab.com/elenaferfor)**, licensed under
**[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**.
Witch reuses Gesticules’ unchanged local model and adapts its shape at runtime
with elongated, tapered fingers and witch claws. This model adaptation retains
CC BY-SA 4.0. See the [model provenance and credits](../assets/gesticulating-hand/README.md).

Human listening and physical touch-device review remain necessary. Automated
tests can establish signal bounds and interaction behavior, but do not establish
that the cackle is convincing or the singing is beautiful.
