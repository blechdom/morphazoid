# Gesticules

Open [Gesticules](../gesticules.html), a standalone 3D instrument with **Hand** and **Foot** models. Their textured skin,
editable joints and five synthesized finger or toe voices share one pose timeline.
Choose the model above Sound and Motion. Switching keeps both players, sound
settings, Tempo, Speed, tremor, skin tint, lighting and camera; it remembers each
model’s manual base pose separately for the current page session. Audio remains off
until explicitly enabled. Older saved configurations default to Hand.

Turn **Audio** on, then **Sound** to hold the sound of the current pose. **Motion**
runs the selected choreography independently. Dragging a finger or its joint
markers auditions that finger while Audio is armed. Audio starts off; gestures,
Space and motion playback never arm it. Turning Audio off leaves visual motion
running silently. Presets preserve Audio, output level and both players. Sound and
Motion have
independent play/pause buttons at the top of the right panel, beside Tempo, with
Speed directly below. Their circular buttons and labelled ranges follow Shape's
transport layout.

## Hand and movement

The right hand is [Rigged hand by Elena FF](https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e),
licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Its 28,994 triangles, skin textures, nails and weighted deform rig are retained.
The 3.8 MB GLB is a lossless repack of the attributed public distribution, with
three 2048-square textures. Twenty-two bones deform the mesh; an additional
structural palm bone participates in the source choreography. Exported Blender
control bones are not interactive constraints: the page controls the deform
chains directly.

**Open / close · original** follows the source animation's actual quaternion
curves, including palm cupping. The original 3.208333-second movement is mapped
to a four-beat loop; it opens, curls into a grasp and opens again. It is not a
tightly squeezed fist. Movement size blends those rotations with the open pose;
manual joint offsets remain editable. Every source rotation key time is retained.
Finger flexion values for synthesis are measured from those same rotations.
Other named motions are original, bounded Morphazoid choreography, not motion
capture or imported Microsoft clips.

There are **35 animated movements**, plus **Still**: the original Open/Close,
Wave, Beckon, Finger roll, Pinch and release, Counting fingers, Flourish, and the
28 movements below.

| Movement family | Choreography |
| --- | --- |
| Finger sequences | Fan and gather, Opening ripple, Closing ripple, Finger drumming, Spider walk, Air piano |
| Thumb and pinch | Index tapping, Thumb pulse, Thumb orbit, Thumb visits fingers, Climbing pinches, Circling pinch |
| Grasp and wrist | Claw and uncurl, Squeeze and release, Wrist circles, Wrist nodding, Palm to back, Figure eight |
| Expressive loops | Spiral flourish, Finger flicks, Finger scissors, Two-finger beckon, Two-finger walk, Ring-finger bow |
| Complex patterns | Polyrhythmic tangle, Finger swarm, Frantic orbit, Scatter |

The four complex patterns combine independent finger and wrist cycles. Knuckles,
middle joints, tips and spread can move at different rates and in opposing
directions. Frantic orbit and Scatter also vary the phase within their loops.
Their curves are deterministic, continuous and bounded by the same joint limits.

**Tempo** ranges from **20 to 1,100 BPM**. **Speed** multiplies it from **0.1× to
4×**, default **1×**; the maximum combination runs at 4,400 effective beats per
minute. Changing either rate preserves the choreography's current cycle position
while running or paused; both the visible rig and audio worklet use the same
rebased timeline. Faster motion changes the rate of pitch, tone and excitation
movement. It does not resample the audio output. Older saved configurations
without Speed use 1×. Presets recall both Tempo and Speed.

The selected finger exposes each joint separately. For the four fingers these
are knuckle (MCP), middle (PIP), tip (DIP), and knuckle spread. The thumb uses its
base (CMC), knuckle (MCP), tip (IP), and base opposition. Bending a knuckle by
dragging can also bend its downstream joints; uncheck **Bend joints together**
to isolate it. Wrist bend, side motion and hand turn are separate controls.

**Tremor** adds a shake to selected joints: **0–15 degrees** at **0.5–40 Hz**.
Choose one finger, all fingers, or alternating fingers moving in opposite phase.
The joint choices are Tip, Middle, Knuckle, Whole finger, and Wrist. Whole finger
moves its three bending joints together; Wrist shakes bend, side and turn.
Tip and middle tremor also add gentle continuous vibrato from the actual visible
deflection. Knuckle and wrist tremor use their existing pitch mappings. Tremor
rate is expressed in Hz independently of Tempo and Speed. Changing Tempo, Speed
or tremor rate preserves its current phase. Motion pause holds both
choreography and tremor at their current position; Sound can sustain that pose.
Tremor defaults to zero, including when loading older saved configurations.

These are calibrated, bounded controls on an artist's rig. They do not simulate
every tendon, contact force or bone collision. Extreme mixed poses may intersect.
The turn control represents forearm rotation expressed at the available wrist
rig; it is not a claim that a real wrist has an independent axial hinge. This is
not a clinical hand model, sign-language dictionary or validated hand tracker.

## Foot and toes

The **Foot** option uses an ankle crop of the official **MakeHuman CC0** mesh and
skeleton, with **Mindfront’s Aksel CC0 skin**. Its 17 weighted bones include
14 toe joints, an ankle and two stationary calf anchors. The big toe has base
(MTP) and tip (IP) controls; each smaller toe has base (MTP), middle (PIP) and tip
(DIP) controls. Each toe also splays sideways. There is no extra middle joint on
the big toe. Ankle bend, side and turn replace the wrist controls.

All 35 motions are adapted to the foot’s smaller ranges, including toe curls,
ripples, drumming, splaying and ankle circles. These are expressive adaptations,
not imported foot motion capture. The hand’s source quaternion animation is never
applied to the foot; its corresponding foot motion is **Toe curl · adapted**.
Targeted tremor works on the same toe controls. A big-toe middle-joint tremor
becomes tip tremor, while an all-toes middle tremor skips the big toe.

Four complete foot presets join the unchanged 24 hand presets: **Velvet toe curl**,
**Glass toe ripple**, **Tin toe drumming**, and **Ankle choir**. Preset recall includes the
model; manually choosing another model retains the current sound and view.
**Top / Sole / Side** replace Palm / Back / Side. Rotation keeps the same stereo
phaser, and all eight engines, six skin tints, six lighting choices and five-voice
MIDI controls work with either model.

The foot has 34,352 triangles and a 1.68 MB GLB. Its 352×336 foot texture crop
retains the source nail and crease detail without upscaling, so close zooms look
softer than the hand. The cropped ankle is capped. These are bounded controls on
an artist-authored mesh, not a tendon/contact simulation; extreme combinations
can intersect. The foot does not claim clinical accuracy.

## Sound mapping

| Visible change | Sound consequence |
| --- | --- |
| Finger knuckle/base bend | Continuous exponential pitch movement |
| Middle and tip bends | Brightness and roughness |
| Middle and tip tremor | Additional continuous vibrato from visible joint deflection |
| Finger spread | Stereo position |
| Wrist bend and turn | Shared pitch/register movement |
| Wrist side motion | Shared color and stereo movement |
| Turning or tilting the hand | Stereo phaser sweep |
| Speed of automatic finger movement | Additional voice excitation |

Each finger chooses one of **eight sound engines**, with its own level, mute and
solo: Glass, Reed, Wire, Pulse, Air, **Bowed**, **Vowel**, or **Metal**. Bowed uses
a damped string loop with friction-like excitation. Vowel sends a voiced source
through moving formants. Metal excites inharmonic ringing modes on finger motion
and note onset; a motionless held hand lets those rings decay. These are original synthesis types, not recordings of a hand. Pitch remains
continuous without a scale or pentatonic quantizer. Register, brightness, grain,
space, attack and release belong to the complete preset state.

**Rotation sound** controls a stereo phaser driven by the hand's orientation.
Dragging empty space turns and tilts the hand, sweeping the effect across the
voices. Animated wrist turns and bends also move the sweep. The amount control
ranges from dry at zero to the full effect at 100%; it belongs to presets and
randomization. Zoom and lighting do not change the sound. With Rotation sound
above zero and Audio armed, manual rotation briefly auditions the hand even when
Sound is paused.

An AudioWorklet evaluates motion and synthesis on the audio clock. The renderer
reads that same timeline; animation frames do not schedule audio. There are five
bounded voices, smoothed controls and a bounded stereo effect. Geometry rendering
is capped at 40 frames/second, 1.6 device-pixel ratio and about 1.45 million pixels.

## Controls and recovery

- Drag a marker or finger segment to bend it; horizontal drag adds spread.
- Drag the palm for wrist bend and turn. Drag empty space to orbit the camera.
- Palm, Back and Side restore views and sweep the rotation effect. The plus/minus
  buttons and wheel zoom without changing sound.
- With the hand focused, 1–5 select fingers, arrows bend/spread, and Home relaxes
  the selected finger. Shift makes a smaller change. Sliders provide the same
  controls without direct 3D manipulation.
- Space toggles Motion. Sound and Audio remain separate.
- The **28 complete presets** recall the model, joints, sound engines and levels, envelopes,
  choreography, Tempo, Speed, tremor, camera angle/zoom, skin and lighting. The
  four complex-motion scenes showcase higher tempos with different Speed values.
  The adjacent dice randomizes these settings within their bounds.
- Reset recalls the initial scene without changing output or player
  switches. Audio off releases sound. Blur releases transient manual/MIDI holds.

Skin tints are **Natural, Porcelain, Copper, Jade, Violet, and Cyan**. Each color
multiplies the original textured material, retaining finger/toe nails, joint creases,
skin detail and the original roughness and specular response. Natural restores
the original color exactly.
Lighting choices are **Studio, Warm, Cool, Noir, Neon, and Soft**. These tint
and light treatments change the view; joint motion continues to own synthesis.
Older saved configurations use Natural skin, Studio lighting and the palm camera.
Camera orbit, angle and zoom belong to each complete preset. Each model is loaded
on first selection and cached; both share one renderer, lights and appearance
controller. Tint changes always start from each material’s original color.

On phones, the hand or foot stage stays visible beneath the masthead while the mixer and
parameter controls scroll below it. The transport and parameter panel comes
before the finger mixer on phones. The hand remains available for direct gestures
as sound, motion and appearance settings are edited.

MIDI notes map to five temporary finger gestures, with velocity controlling
their bend. Independent sources and note releases are tracked. Pitch bend moves
hand turn; MIDI Start/Stop controls Motion. The shared MIDI switch enables the
two-row computer keyboard. This instrument has no microphone path or MIDI output.

## Asset selection and provenance

The selected hand was compared with Microsoft MRTK HandCoach, WebXR generic-hand,
BabylonJS's hand, and free animated Sketchfab alternatives. Elena FF's hand was
the strongest obtainable realistic option in that comparison, with visible skin,
nails and tendons plus a useful authored animation. It is not a claim to have
reviewed every free model.

[Microsoft HandCoach](https://learn.microsoft.com/en-us/windows/mixed-reality/mrtk-unity/mrtk2/features/ux-building-blocks/hand-coach?view=mrtkunity-2022-05)
provides an MIT-licensed rig and broader authored choreography such as AirTap,
NearSelect, PalmUp, HandFlip, Rotate and Scroll. Its smooth teaching hand is less
realistic, and its Unity animation clips are not included in this instrument.
[WebXR generic-hand](https://github.com/immersive-web/webxr-input-profiles/tree/main/packages/assets/profiles/generic-hand)
is small and MIT-licensed but has no textures or animation; its tracking-joint
hierarchy also differs from a conventional finger rig.

Model distribution, exact attribution, hashes and rebuild commands are recorded
in [the asset notes](../assets/gesticulating-hand/README.md). The model and derived
animation data retain CC BY-SA 4.0; the separate sampler and instrument code use
the repository's MIT license.

The foot was selected after checking the hand artist’s catalogue and dedicated
free foot models. Obtainable MakeHuman source offered five existing weighted toe
chains and documented CC0 licensing. The mesh was cropped, capped and subdivided
offline; source weights were interpolated, normalized and pruned to four
influences per exported vertex. One small left/right source-weight error was
corrected. Normal detail is retained; specular intensity becomes roughness.
Exact provenance, conversion limits, hashes and the reproducible Python build
are in [the foot asset notes](../assets/gesticulating-foot/README.md).

## Acceptance boundaries

Automated checks cover numerical bounds, source-curve fidelity, control-to-sound
relationships, explicit Audio arming, voice release, independent players,
pose/preset continuity, direct manipulation, responsive layouts and cleanup.
They do not establish subjective sound quality or clinical anatomical fidelity.
Human listening and physical touch/MIDI-device checks remain separate.
