# Witches Brew

Witches Brew leads Faves with an ensemble in one continuous night scene.
Her cauldron voice and instrumental fingers play together. The scene starts
moving with **Audio off**; enable Audio to hear it. Stir the potion, play her
fingers, drop a floating miniature instrument into the pot, or take the whole
ensemble on a broom ride. **Stop** releases the sound and pauses the performance.

| Gesture | Picture | Sound |
| --- | --- | --- |
| Stir faster | Faster vortex and articulation | Faster invented syllables |
| Lift or lower the spoon | Five glowing motes follow its height | Selects mutter, whisper, creak, cackle or singing |
| Pull her nose / hat | Nose lengthens / hat stretches and tips | Changes vocal resonance / pitch and rasp |
| Widen the circle | Wider whirlpool and open jaw | Broader vowel resonances |
| Reverse | Vortex changes direction | The syllable path runs backward |
| Release a gesture | Automatic motion resumes while Play is active | The ensemble continues; stopped manual gestures fade |
| Click her right palm | Her long 3D hand stays enlarged at a 55° clockwise angle | Five instrumental voices come forward over quieter brewing |
| Bend a fingertip | Its long finger curls and glows | Glass, reed, wire, metal or marimba pitch and brightness |
| Drop a miniature hand, marimba or choir mouth into the pot | The object falls into the potion | Its short solo comes forward while the ensemble continues underneath |
| Click the moon | She takes off on a rollercoaster broom ride | One launch cackle; flight bends the whole mix through delay |
| Steer the broom | The ride rises, falls and sweeps across the sky | Delay and stereo movement follow the flight |
| Touch the moon, bats, ghosts, star or wind spirit | The touched creature responds | Selects a singing character and adds its accent |
| Stir during flight | The pot stays within reach | The same voice and fingers continue through the delay |
| Click a mushroom | Colors change and the picture ripples | Playback continues unchanged |
| Add glass / hair | Potion changes | Ringing resonances / unstable harmonics |
| Stop | The performance pauses | Voice, fingers, solos and flight effects release |

The spoon rises and falls automatically through muttering, whisper, creak,
cackle and singing. Drag its handle vertically to take over its height. The
checkbox beside the picture resumes automatic selection; choosing Character
or the height slider holds a selection. Nose and hat pulls reshape the voice
independently of the instrumental finger bends.
These are procedural synthesis gestures using a voiced/noisy source and
vowel-like resonances, not recordings or a measured model of a real singer.
Backward means reversing the authored syllable trajectory, not reversing a
recorded waveform. Pitch is continuous; there is no scale quantization.

Both hands use Gesticules’ actual weighted 3D hand model, elongated and colored
with teal, violet and jewel-toned claws. Her left ladle hand is rotated another
90° clockwise and enlarged by 25%. Her right hand stays fully extended through
brewing, flight, presets and Reset. Their finger-roll and claw-pulse animations reuse
Gesticules choreography with offset timing. The reaching hand uses its five-voice
synthesis engine: thumb glass, index reed, middle wire, ring metal and little
finger marimba. Each bend changes its own pitch and tone. The fingers play
alongside the cauldron throughout the performance, including during flight.
Hold several fingertips or number keys together. Holding a digit takes over its
bend while the others keep moving.
Moving a finger also re-excites the struck metal and marimba sounds. Brightness
shapes the instrument mix. Cauldron character and ingredients do not color the
hand's instrumental voices. Touching the right palm brings the fingers forward in the mix and
quiets the continuing cauldron voice.

Three floating objects offer featured solos: the miniature Gesticules hand
plays glass and wire, the marimba bars play a wooden mallet phrase, and the
mouth sings a small choir phrase. Drop an object into the pot or use its control
beside the picture. These reuse Gesticules synthesis: its marimba adapts Linear
Drums' pitched archetype, and its choir uses the Hiccup Head/Throatazoid glottal
source with vowel resonances. Each solo has a bounded duration; another drop
can bring a different material forward. The voice and fingers keep playing
underneath. Object drops remain available during flight.

Clicking the moon takes her into a continuous rollercoaster ride. With Audio
enabled, takeoff adds one short cackle; it does not repeat during ordinary
flight. Clicking the moon again while flying plays a bell. The flight effect
processes the combined voice, fingers and object solos through a changing
stereo delay. Her rise, fall and sideways motion shape the sound. You can keep
singing, bending fingers and dropping objects while she flies; returning to
the pot keeps the musical phrase going. The scenery adds instrumental accents.

Each mushroom cycles through three altered palettes and returns to the original
on the fourth activation. The altered picture has wavy lines; the playable
fingertips and other targets follow their visible positions. Palette changes
preserve the current instrument, Audio and Play.

Audio starts off while Play is already active. Gestures and Play never arm
Audio. Changing finger focus, steering, landing, mushroom changes and object drops
preserve the current Play state. Clicking the moon starts the ride and Play;
it keeps Audio off unless you explicitly arm it. Each held finger also plays
independently while stopped. Releasing it returns to the animation during Play
or fades its manual note while stopped. Presets retain Audio, output volume and
Play. Reset returns to the original cauldron, releases the sound and clears the
ingredients while retaining explicit Audio arming and output level.

With the picture focused, **H** brings the fingers forward in the mix, **M** takes off or rings the
moon bell while flying, **B** returns to brewing, and **W** cycles the mushrooms.
**Escape** returns to the cauldron and stops Play. **Space** toggles Play. **Q/E/R** drop the hand, marimba and mouth.
**T/G/S/V** play bats, ghosts, stars and wind in every activity. Arrows stir/open the voice
or steer the broom. Hold **1–5** to play individual finger instruments; arrows
bend the selected finger when its sound is featured. Native finger sliders also play
while held or adjusted with keys. The controls beside the picture provide
alternatives for bending, steering, ingredients and scenery accents. Pointer
cancellation and window blur release manual gestures. Hidden pages mute;
navigation disposes audio and animation. Shared MIDI exposes control learning
and transport; it does not turn note keys into an unrelated piano voice.

Synthesis and effects run on the AudioWorklet sample clock. Drawing follows
audio telemetry. The scene uses authored Canvas paths and a locally loaded 3D
hand rendered into two independently posed views using one WebGL context, with
bounded rendering and audio resources. The sky, potion, ironwork and hands carry
contrasting violet, teal, pink and amber light. Sounds are procedural; no
external service is required to play.

The hand model is **[Rigged hand](https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e)**
by **[Elena FF](https://sketchfab.com/elenaferfor)**, licensed under
**[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**.
Witches Brew reuses Gesticules’ unchanged local model and adapts its shape at runtime
with elongated, tapered fingers and witch claws. This model adaptation retains
CC BY-SA 4.0. See the [model provenance and credits](../assets/gesticulating-hand/README.md).

Human listening and physical touch-device review remain necessary. Automated
tests can establish signal bounds and interaction behavior, but do not establish
that the cackle is convincing or the singing is beautiful.
