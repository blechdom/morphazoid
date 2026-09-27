# Gesticules

Open [Gesticules](../gesticules.html), a standalone 3D instrument with **Hand** and **Foot** models. Their textured skin,
editable joints and five synthesized finger or toe voices share one pose timeline.
Choose the model above Sound and Motion. Switching keeps both players, sound
settings, Tempo, tremor, Color, Light and camera; it remembers each
model’s manual base pose separately for the current page session. Audio remains off
until explicitly enabled. The initial scene is **Finger loom**. Older saved configurations default to Hand.

Turn **Audio** on, then **Sound** to hold the sound of the current pose. **Motion**
runs the selected choreography independently. Dragging a finger or its joint
markers auditions that finger while Audio is armed. Audio starts off; gestures,
Space and motion playback never arm it. Turning Audio off leaves visual motion
running silently. Presets preserve Audio, output level and both players. Sound and
Motion have
independent play/pause buttons at the top of the right panel, beside one Tempo slider. Their circular buttons and labelled ranges follow Shape's
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

There are **41 animated movements**, plus **Still**: the original Open/Close,
Wave, Beckon, Finger roll, Pinch and release, Counting fingers, Flourish, and the
34 movements below.

| Movement family | Choreography |
| --- | --- |
| Finger sequences | Fan and gather, Opening ripple, Closing ripple, Finger drumming, Spider walk, Air piano |
| Thumb and pinch | Index tapping, Thumb pulse, Thumb orbit, Thumb visits fingers, Climbing pinches, Circling pinch |
| Grasp and wrist | Claw and uncurl, Squeeze and release, Wrist circles, Wrist nodding, Palm to back, Figure eight |
| Expressive loops | Spiral flourish, Finger flicks, Finger scissors, Two-finger beckon, Two-finger walk, Ring-finger bow |
| Complex patterns | Polyrhythmic tangle, Finger swarm, Frantic orbit, Scatter |
| Hand signs | Middle finger, Hang loose, I love you, Rock and roll, Vulcan salute |
| Puppet | Puppet mouth |

The five hand signs are also available as static poses and complete sound
presets. Selecting one of these movements loads its editable sign pose. Its loop adds
small joint motion and wrist gestures, so the joint sliders can still reshape
the entire sign. **Hang loose** extends the thumb and little
finger. **I love you** extends thumb, index and little finger; **Rock and roll**
folds the thumb. **Vulcan salute** pairs index/middle and ring/little around a
central split, with the thumb extended. The five scenes recall their own sound,
pitch spread, Tempo, Color, Light, Trails and palm-facing view. Their toe
adaptations have separate labels; these are expressive rigs, not validated sign
language or anatomical demonstrations.

**Puppet mouth** groups four fingers as an upper jaw and the thumb as a lower
jaw. The two-beat loop opens and closes them around an editable midpoint pose.
Its complete preset combines Vowel and Choir voices and recalls a side view,
Color, Light and Tempo.

The four complex patterns combine independent finger and wrist cycles. Knuckles,
middle joints, tips and spread can move at different rates and in opposing
directions. Frantic orbit and Scatter also vary the phase within their loops.
Their curves are deterministic, continuous and bounded by the same joint limits.

**Tempo** is one slider from **2 to 4,400 BPM**, combining the old Tempo and
Speed controls. Presets retain exactly their previous effective rate. Changing
Tempo preserves the current loop position while running or paused; the rig and
worklet share one rebased timeline. Faster motion changes pitch, tone and
excitation movement without resampling audio. Older saved tempo/speed pairs
remain compatible; their product is displayed as the single Tempo value.

## Drawing your own animation

Each compact voice row has M/S, level, sound, and overlaid movement contours.
Select a joint in the row, then draw its highlighted curve; the other joints
remain visible. Drawing converts the current choreography into an editable
**four-beat loop**, with 16 points per joint and smooth, continuous interpolation.
Curves add bounded bend or spread to the starting pose, scaled by Movement size.
The big toe has base, tip and spread curves; it has no middle joint.

Dragging paints every point crossed, with one undo per stroke. On a focused
curve, left/right selects a point, up/down changes its value, Shift makes a
larger change, and Home/Delete returns that point to zero. Clear resets only the
selected joint curve; Undo restores the previous edit. Choosing **Drawn contours**
under Choreography returns to the edited curves; choosing another choreography
keeps them stored in the scene. Motion plays the loop, while Sound and Audio
remain independent. The curves feed the same pose evaluator in the renderer and
AudioWorklet, so joint movement changes the same voice pitch, tone and spread.

**Save** downloads an animation JSON containing the model, starting pose,
choreography, curves and tempo; **Load** restores it without changing Audio,
Sound, Motion, output level, sound settings, lighting or camera. Preset changes
recall their complete motion state, so save a drawing before changing presets.

The selected finger exposes each joint separately. For the four fingers these
are knuckle (MCP), middle (PIP), tip (DIP), and knuckle spread. The thumb uses its
base (CMC), knuckle (MCP), tip (IP), and base opposition. Bending a knuckle by
dragging can also bend its downstream joints; uncheck **Bend joints together**
to isolate it. Wrist bend, side motion and hand turn are separate controls.

**Tremor** adds a shake to selected joints: **0–45 degrees** with a **0.1–120 Hz**
base rate. Choose one finger, all fingers, or alternating fingers moving in
opposite phase. The joint choices are Tip, Middle, Knuckle, Whole finger,
sideways Spread, and Wrist. Whole finger moves its three bending joints together;
Spread splays the digits sideways; Wrist shakes bend, side and turn.
**Rate spread** and **Phase spread**, each 0–100%, distribute rates and phase
positions across individual digits, or across the three wrist/ankle axes. They
range from synchronized motion to independent, offset oscillations. Actual
bends remain bounded by each joint’s range; a high base rate with rate spread
can drive some digits faster than 120 Hz.
Tip and middle tremor also add gentle continuous vibrato from the actual visible
deflection. Knuckle and wrist tremor use their existing pitch mappings. Tremor
follows Tempo along with choreography and rhythmic taps: halving Tempo halves
all finger, toe, wrist and ankle shake rates. Tremor rate still adjusts the
shake independently, and its readout shows the actual base Hz at the current
Tempo (individual digits may differ with Rate spread). Changing Tempo or
Tremor rate preserves the current phase. Motion pause holds both
choreography and tremor at their current position; Sound can sustain that pose.
Missing tremor depth, rate spread and phase spread default to zero. Existing
scenes retain their original tremor settings and speed on recall. Each scene
saves a reference Tempo with its nominal tremor rate, so slowing down and back
up never loses the original rate at slider limits. The new scenes include gentle
subhertz movement, deep shakes and fast sideways splay.

These are calibrated, bounded controls on an artist's rig. They do not simulate
every tendon, contact force or bone collision. Extreme mixed poses may intersect.
Wrist and ankle motion combines choreography and tremor before easing near the
joint limits. Manual bend, side and turn controls retain movement throughout
their travel, including in a paused animated pose. Still poses retain their
exact base angles, and inward animation remains available at either endpoint.

The turn control represents forearm rotation expressed at the available wrist
rig; it is not a claim that a real wrist has an independent axial hinge. This is
not a clinical hand model, sign-language dictionary or validated hand tracker.

## Foot and toes

The **Foot** option uses an ankle crop of the official **MakeHuman CC0** mesh and
skeleton, with **Mindfront’s Aksel CC0 skin**. The source GLB has 17 weighted bones:
14 toe joints, an ankle and two stationary calf anchors. The instrument adds
three weighted arch bones at runtime, giving **20 runtime bones** while retaining
the source GLB and its neutral surface. The big toe has base
(MTP) and tip (IP) controls; each smaller toe has base (MTP), middle (PIP) and tip
(DIP) controls. Each toe also splays sideways. There is no extra middle joint on
the big toe. Ankle bend, side and turn replace the wrist controls.

**Arch** (−70° to 85°), **Twist** (−55° to 55°), and **Stretch** (−40% to 100%)
deform the foot between ankle and toes. The visible arch bend is softened to
two-thirds of its setting. Drag the arch marker vertically to bend
or horizontally to stretch; sliders expose all three dimensions. **Elastic motion**
(0–100%) adds deterministic arch, twist and stretch cycles that follow the
selected choreography and Tempo. The manual shape remains editable.
Arch raises pitch and brightness, stretch lowers register and changes brightness,
and twist changes roughness and stereo position. Their movement also excites the
voices. These elastic deformations are expressive extensions of the source rig.
Older foot scenes keep a neutral shape and zero elastic motion.

All 41 motions are adapted to the foot’s smaller ranges, including toe curls,
ripples, drumming, splaying and ankle circles. These are expressive adaptations,
not imported foot motion capture. The hand’s source quaternion animation is never
applied to the foot; its corresponding foot motion is **Toe curl · adapted**.
Targeted tremor works on the same toe controls. A big-toe middle-joint tremor
becomes tip tremor, while an all-toes middle tremor skips the big toe.

The library has **21 foot scenes and 47 hand scenes**, interleaved in one menu.
The four original foot scenes—**Velvet toe curl**, **Glass toe ripple**,
**Tin toe drumming**, and **Ankle choir**—retain their musical settings. Twelve
new foot scenes combine elastic shapes with varied engines and tremors. Preset
recall includes the model; manually choosing another model retains the current
sound and view. **Top / Sole / Side** replace Palm / Back / Side. Rotation keeps
the same stereo phaser, and all ten engines, continuous Color and Light
controls, and five-voice MIDI controls work with either model.

The foot has 34,352 triangles and a 1.89 MB GLB. Its 352×336 foot texture crop
retains the source nail and crease detail without upscaling, so close zooms look
softer than the hand. The cropped ankle is capped, with smoothed shading and colors matched to the adjoining skin. These are bounded controls on
an artist-authored mesh, not a tendon/contact simulation; extreme combinations
can intersect. The foot does not claim clinical accuracy.

## Sound mapping

| Visible change | Sound consequence |
| --- | --- |
| Finger knuckle/base bend | Continuous exponential pitch movement |
| Middle bends | Brightness/formant movement and a smaller pitch bend |
| Tip bends | Texture and a smaller pitch bend |
| Middle and tip tremor | Continuous vibrato through the same bend-to-pitch mapping |
| Finger/toe spread and sideways tremor | Stereo position and signed tonal color, also audible in mono |
| Foot arch | Pitch and brightness |
| Foot stretch | Lower register and changed brightness |
| Foot twist | Brightness, roughness and stereo position |
| Speed of elastic foot deformation | Additional voice excitation |
| Wrist bend and turn | Shared pitch/register movement |
| Wrist side motion | Shared color and stereo movement |
| Turning or tilting the hand | Stereo phaser sweep |
| Speed of finger/toe bends, spread and wrist/ankle movement | Additional voice excitation, including Metal and Marimba strikes |

All physical joint controls feed every engine. Pitch, tone and pan compress smoothly
near their sound limits instead of becoming flat; the anatomical rig still has
its visible end stops. Short velocity sampling retains percussion excitation
through fast tremors, including 100 Hz. Tin Morse, Neon tap, Crystal staccato and
Beetle step leave more room for edits around their starting poses. Muted,
zero-level or excluded-by-solo voices remain silent.

Each finger chooses one of **ten sound engines**, with its own level, mute and
solo: Glass, Reed, Wire, Pulse, Air, **Bowed**, **Vowel**, **Metal**, **Choir**, or **Marimba**. Bowed uses
a damped string loop with friction-like excitation. Vowel sends a voiced source
through moving formants. Metal excites inharmonic ringing modes on finger motion
and note onset; a motionless held hand lets those rings decay. Choir adapts the
glottal pulse used by Hiccup Head and Throatazoid, with moving singing formants
from Puggler’s vocal layer. Joint tremors modulate its pitch as vibrato. Marimba
adapts Linear Drums’ damped wooden-bar modes, struck by notes and joint movement.
These are synthesis models rather than recordings of a hand. Pitch remains
continuous without a scale or pentatonic quantizer. Register, brightness, grain,
Trails, attack and release belong to the complete preset state. Register spans
**35–1,600 Hz**, with bounded synthesized voice frequencies up to 4,200 Hz.

**Pitch spread**, beside Register, scales the spacing of the five voices’ starting
pitches from **0–400%**. **100%** keeps the original non-scale intervals; **0%**
puts their starting pitches together; higher values widen them around the middle
voice. Register moves their shared tuning reference. Joint bends, vibrato and
wrist/ankle/foot pitch gestures remain active even at zero spread. The setting
is saved with presets, included in randomization, and retained when switching
between hand and foot. Older saved scenes default to 100%. Finger loom stays
at 100%; Lingering choir narrows to 30% and Marimba footprints widens to 225%.

**Rhythm** offers Continuous, Walking notes, Offbeat taps, Three against four,
and Broken phrases. The four written patterns open and close individual voice
gates, creating attacks and rests while the corresponding digits tap visibly.
**Note length** sets 8–90% of each note cell; Attack, Release and Trails shape its
onset and tail. These patterns use the same Tempo and freeze with Motion.
Manual held notes and auditions can sound through a written rest. Eight new
hand/foot presets demonstrate the rhythms without tremor.

**Trails** links fading visual afterimages with stereo echoes. Zero clears the
image history and turns off the audible delay; higher settings increase both.
It uses the existing saved `sound.space` value, so older presets retain their
echo settings. History clears on form changes, reset, resizing and hiding the
page. The live hand/foot keeps its original skin, lighting and joint markers.
**Lingering choir** demonstrates singing vibrato with long trails;
**Marimba footprints** combines toe rhythms and mallet echoes.

The output has a fixed 4× (+12.04 dB) gain lift after synthesis and effects,
followed by a linked stereo peak limiter with 1.5 ms lookahead, 80 ms release,
and a .89 sample ceiling (about −1 dBFS). The master ranges from zero to unity;
maximum output is about 14 dB above the previous maximum. Quieter scene dynamics
remain intact below limiting. These are measured output bounds, not a human
listening assessment or an oversampled true-peak guarantee.

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
- The **68 complete presets** (47 hand, 21 foot) recall the model, joints, foot
  shape, elastic motion, sound engines and levels, envelopes, choreography,
  Tempo, rhythm, note length, drawn joint contours, all tremor controls, camera angle/zoom, Color and Light. Each six
  neighboring scenes, including the menu wrap, contain hand and foot, fast and
  slow, smooth and shaky choices. The original 28 scenes retain their musical
  settings; 12 hand and 12 foot scenes add new combinations, with eight additional higher-register rhythmic scenes. The adjacent dice
  randomizes these settings within their bounds.
- Reset recalls **Finger loom** without changing output or player
  switches. Audio off releases sound. Blur releases transient manual/MIDI holds.

**Color** (0–100%) and **Light** (0–160%) are continuous sliders with no named
palette or lighting menus. The Light range above 100% adds brighter neutral, warm
and cool illumination; the original 0–100% settings retain their positions. Color moves through saturated hues while retaining textured
nails, joint creases, skin detail and the original material response. Light
interpolates the illumination. Neither changes synthesis; visible joint motion
continues to own the sound. Saved appearance values are numeric positions from
0 to 1 for Color and 0 to 1.6 for Light; older named settings migrate to their
original positions, with removed pale
colors mapped to the saturated starting color.
Camera orbit, angle and zoom belong to each complete preset. Each model is loaded
on first selection and cached; both share one renderer, lights and appearance
controller. Color changes always start from each material’s original color.

On phones, the hand or foot stage stays visible beneath the masthead while the mixer and
parameter controls scroll below it. The compact voice and contour rows come
before the transport and parameter panel on phones. The hand remains available for direct gestures
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
