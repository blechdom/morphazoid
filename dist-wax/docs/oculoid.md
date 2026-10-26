# Oculoid: the eye as an instrument

[Play Oculoid](../oculoid.html) · [model attribution and exact hash](../assets/oculoid/SOURCE.LICENSE.txt)

The central gesture is **looking**. Drag the iris or the **gaze X/Y pad**
to turn a textured 3D globe behind mirror-chrome lids (or pick matte brown).
The globe and its spherical shell have no flattened depth axis. Gaze travels deliberately beyond
human range (up to about 82° across and 70° up/down); at the extremes the iris
can disappear behind the lid rather than circling outside the skin. Glances
make short, pitched squishes: up/down changes their pitch, and left/right
sets their stereo position and a smaller pitch bend. Drag the empty stage
outside the eye to turn the **entire** globe, skin, lids, lashes and any active tear
together: each axis stops at ±90° from front (180° total, never a full spin).
This changes the view, not gaze or sound. Pull the upper lid down
or lift the lower lid to narrow the opening and soften subsequent glances;
pulling the lower lid down opens it independently. Lid movements also make
short percussive plops. **Tear** makes one drop; **Cry** repeats a drop every
four beats at its own Cry tempo even when Motion is paused. The pointed tip
touches the viewer-left lid join while the bulb leans clear of the skin,
then it grows and falls vertically; there is no
streak across the skin. Pupil movement also
excites short squishes, changing filtering and overtone brightness;
tears, vein drive and iris cast shape each movement sound.
These are authored sound
mappings, **not** recordings of eyes or a physiological model.

Oculoid is becoming a small *multi-loop character ensemble*: eyeballs, lids
and tears can repeat on interlocking clocks, and each present eyeball has a
short event voice. This is a first playable slice, not an editable step
sequencer. Individual eye loop lengths and moods, per-eye direct gestures,
and color/pattern-to-sound mappings are still open design directions, not
implemented controls.

## Play and recover

- Audio starts **off**. When armed, a motionless eye is quiet: there is no
  continuous tone or drone. Manual glances, pupil or lid gestures, and MIDI
  note attacks make short sounds; Motion excites the eye voices and lid rhythm
  as their parts move. Turning Audio off smoothly mutes without stopping Motion;
  Play and Space never arm it.
- **Eyeball animation** and **Eyelid animation** are separate looping parts
  on the Audio clock. Pair a drifting or wildly glancing eye with Blink, Flutter,
  Wild blink, Drowse or Lid flutter; Tremble adds small gaze twitches, and
  Pupil pulse changes the pupil without turning the globe. Choose **Still**
  on either menu to leave that part alone (for example, a forward-looking
  eye with fluttering lids, or a pulsing pupil with motionless lids).
  The dice beside each menu chooses a *different animated style for that
  part only*, leaving the other menu, tempo, Movement, Play and Audio alone.
  These are repeatable, continuous LFO curves, **not** editable steps or
  probability patterns. **Eye tempo** or its shared **Tap** button sets the
  main beat (one beat per tap). **Lid speed** runs its own rhythmic phase
  between 0.5× and 2× that beat. At 1× both parts repeat together after
  eight beats; at other rates they interlock or phase against each other.
  Adjusting either tempo while playing preserves both phases; choosing
  an animation also keeps its clock running. **Movement** changes excursion,
  not rate. Motion can play silently while Audio is off; enabling Audio joins
  the current phase.
- Drag the central eye to steer gaze. Start near the **upper margin** and
  drag down to blink or up to open above rest; start near the **lower margin**
  and drag down to open that lid, or up to lift it. Dragging elsewhere steers
  gaze **on the eye**; dragging outside the spherical skin turns the entire
  rig. The separate **gaze X/Y pad** moves both audible axes at once: drag its
  handle or tap the pad, or focus its handle and use arrow keys (Shift for
  fine steps). The labelled **Look across** and **Look up/down** knobs offer
  independent keyboard control. The **Whole eye left/right** and **Whole eye
  up/down** knobs turn the whole assembly ±90° without changing the sound.
  Gestures do not implicitly enable Audio. Drag a knob **vertically** to adjust
  it, or use its native keyboard range (Shift for a finer pointer drag).
  The Upper lid knob goes below 0% to open upward (-100%) and above 0%
  to close (+100%); the Lower lid knob opens downward (+100%) or lifts (-100%).
  At both fully open
  limits, the margins stop against the smaller eyeball, not at the outer
  skin shell's poles in the original one-eye arrangement.
- **Eyeballs in sheath** (under Dress-up) is a 1–12 knob for separate,
  smaller copies of the licensed globe inside the **same** spherical shell.
  Two meet in the middle and nest against the side caps; three form a
  touching triangle, and four a touching square. Three and four are larger
  and sit farther back inside the shell; five through twelve pack in two or
  three close, shallowly staggered rows. The cluster expands until its
  neighbors nearly touch or its outer eyes approach the shell. Some eyes
  are still partly occluded by the lids or their neighbors, but every eye
  remains partially visible in the resting aperture. No additional
  eye-model downloads. Drag any
  iris or the X/Y pad to shift **all** gazes together, while **Eyeball ensemble**
  gives each globe an individual repeating gaze, pupil accent and short
  pitched stereo voice. Banter trades attention across the group; Harmony
  spreads their gazes and pitches in simple non-tempered ratios; Rock out
  alternates bobbing parts. Together restores shared motion and one voice.
  Banter, Harmony and Rock out also give the eyes *different resting
  directions* with Motion paused or Eyeball style set to Still; their repeating
  movement and pupil accents require Motion on and a non-Still style. Together
  keeps the one shared gaze. Manual gaze and MIDI hits still play when Motion
  is paused. Poke and Stretch
  deform only the touched globe.
  Flash constricts the iris it reaches. Keyboard surface tools use the last
  touched globe (the leftmost one after changing counts). Eye count and ensemble
  style are *live dress-up* controls outside the 36 musical presets; neither
  starts Audio or creates sustained voices. The dark socket remains behind the
  cluster; Retract lids exposes all of its eyes.
- Switch on **Poke** beside the stage Reset button to press and drag the exposed
  globe. Its textured surface, iris details and vessels indent locally; release
  springs back. Mouse/touch starts at moderate pressure; dragging down pushes
  deeper, and a pressure-sensitive pen can control it directly. The lid and
  empty-stage drags keep their usual meanings. On the focused canvas, arrow
  keys move the poke spot and holding **P** presses it; releasing P rebounds.
  **Poke diameter**, in Surface, changes the actual contact area from 12% to
  92% of the globe's diameter and changes the next squelch; it is separate from
  pressure. **Poke depth** scales the visible dent and the pressure sent to the
  squelch from 0% to 150% (100% default). Both knobs work during a held press.
  Each press, substantial scrub and release makes a brief wet, low squelch
  when Audio is on, but holding still fades silent. This is deliberately
  cartoony geometry and synthesis, **not** realistic eye physiology. Poke
  doesn't arm Audio, alter musical presets, or leave a dent after Reset,
  cancellation or navigation.
- **Stretch** in Surface grips a patch of the *exposed* globe and pulls it a
  bounded distance (at most 0.25 globe-radius units) without rotating the
  whole eye. It springs back on release and makes brief wet sounds when Audio
  is armed, never sustained notes. Stretch, Poke and Flash are mutually
  exclusive; none arms Audio or changes presets.
  On the focused canvas, arrows move a tool's touch spot; **Enter** grips or
  releases, arrows tug while gripped, and **Escape** releases. A
  selected tool cannot accidentally steer gaze when its grip misses.
  Eyelids still occlude the surface.
- **Retract lids** holds *both* lids fully open while you work on the eyeball,
  including during Motion. It affects the performed image and sound gate, not
  the underlying upper/lower-lid knobs or preset. Toggle **Release lids** to
  restore those positions. A preset cannot trap the retractor on; Reset,
  page hiding and navigation release it. The hold is an artistic performance
  control, not a depiction of medical equipment.
- **Hide lids** removes the shell, both lids, lashes, cigar, mustache, coat,
  scarf, headband, lipstick, teeth, tongue and the attached tear altogether,
  leaving the rotatable, playable eyeball(s), sunglasses or Groucho disguise,
  hats, hair, ears,
  tie and tail. Closed saved lids
  no longer block Poke or Flash. Showing the lids restores their positions
  and the Retract latch unchanged. Tear/Cry and Retract are disabled while
  there is no lid corner to attach a drop; Reset restores the shell.
- **Tear size** changes how large the bulb grows (even at 0%, there is still
  a small drop; 100% is almost five times as wide) and how wet movement
  sounds are; it does not emit tears by itself. Press **Tear** for one growth
  and fall, or toggle **Cry** for a four-beat cycle at the separate
  **Cry tempo** knob or its own Tap button (35–800 BPM, 84 by default).
  The knob keeps finer control over slower tempos; at 800 BPM, four beats
  take 0.3 seconds, or 200 drops per minute. Eye-motion tempo still tops
  out at 200 BPM.
  A drop detaches at beat 2.08, stays full-size until it exits the stage
  and then resets. Cry continues when Motion is stopped, follows Cry tempo
  changes without restarting its current cycle and does not speed up when
  Motion tempo or presets change. One-shot Tear also uses Cry tempo to time
  its fall. Cry stops with the Cry button, Reset, Hide lids or page hiding. With Audio
  explicitly armed, each detachment is a brief, left-panned sound scheduled
  in the AudioWorklet, not by animation frames; the buttons never arm Audio.
- **Dress-up** loads Kimppo's connected, three-dimensional **aviator
  sunglasses** (with a procedural fallback). They sit high above the moving
  upper lid throughout a blink and rest over the exposed eyeball when lids
  hide. **Groucho Marx disguise** adds one connected round-glasses, bulbous
  nose and thick mustache costume at the same high eyewear position. It
  temporarily replaces separate sunglasses and mustache without changing
  those switches and stays on the bare globe when the lids hide.
  The **cigar** instead rests against the *shared lower lip*, following its
  movement, not gaze or the pupil. Tapered strands of **mustache** sit
  between the skin and upper eyelashes and follow that lid.
  Choose one adjustable-size **Hat**: top hat, curled-brim cowboy, cupcake
  frosting, cherry or a cat sitting on top. Add separate sculpted **Cat ears**
  or **Human ears**, a tapered, furred **Cat tail** behind the eye, a
  custom-color **Bow tie** in front of its lower hemisphere and a
  deliberately bad **mullet** or **mom bob** haircut, each with a curved,
  strand-layered cap rather than straight cylindrical bangs. Their front
  hairline lifts clear of the upper lash fan when the lid opens.
  These dress the whole rig, follow whole-eye turns rather than gaze, and
  remain visible if you hide the lids; tall hats and tail widen the camera view.
  Two pleated trench-coat panels with folded lapels and small buttons rise
  halfway up the sides/back of the sphere and do not connect under its chin.
  Their front neckline drapes below the moving lower lashes rather than
  crossing the lip. These clothes and hair remain stylized procedural
  meshes, not scanned garments or real fibers. A broad woven **scarf**
  wraps under the moving lip, with a
  knot, draped ends and fringe; a fabric **headband** crosses its forehead.
  Both hide with the lid shell. **Lipstick** colors the rounded lid rims *and*
  their inner lining beside the teeth, not the outer shell or dark rear socket.
  Choose the lip color with its adjacent picker.
  Two rows of ivory **Teeth** hang just *inside* the moving lips, while a
  pink, grooved **Tongue** emerges from behind the lower lip, rises over
  *in front of* its eyelashes, hangs out past the lip and wags with Motion.
  Both tuck out of sight as the lids close instead of piercing the rim.
  Shell-mounted pieces, including the cigar, mustache, coat, scarf, headband
  and mouth, hide with Hide lids; sunglasses or Groucho, hats, hair, ears,
  tie and tail remain on the bare eye.
  Dressing does not change the imported models or musical presets, but it **colors
  the next sound event** when Audio is armed: Tongue/Teeth give lid hits a
  throaty, clicky mouth; Mustache/Lipstick soften their edge. Flutter styles
  keep a fast airy butterfly-like lip strike; Wild blink is lower and rougher.
  Sunglasses (including Groucho's), cigar, hat, coat, scarf, hair, headband,
  bow tie and ears filter, ring or pan subsequent hits; the Groucho mustache
  also softens the next lid hit. Hiding the shell mutes its lid events, not the eyeball
  voices. Cat tail and the chosen lip color remain visual-only. No wardrobe
  toggle sounds by itself. Reset undresses the eye and restores one eyeball.
- Switch on **Flash** beside Poke to aim a focused flashlight. Hover or drag
  across the canvas (touch: drag); the warm spot follows the beam. On the
  focused canvas, arrows aim it, with Shift for finer steps. The **Flashlight
  power** knob sets the beam and response from 0–100% (default 80%).
  **Beam diameter** adjusts the spotlight's actual cone from 12% to 120% of
  the globe's diameter. Its stage ring shows the width; a wide beam can catch
  a visible iris patch away from its center. Hitting the *visible* iris
  constricts the pupil; shining it entirely on a lid, the background or the
  side of the eyeball does not. Passing the beam in and out excites the
  existing short pupil squish if Audio is armed; holding the beam still is
  silent. This is a deliberately playful light-response proxy, **not**
  measured pupil physiology. Turning Flash off lets the pupil relax without
  changing its manual Pupil knob.
- In **Appearance & lighting**, drag the warm **K** and neutral **F** handles
  in the light X/Y pad, or use their four labelled angle knobs and arrow keys. Each light
  orbits the eye independently (left/right ±140°, up/down ±75°). The key
  also turns the soft studio reflections in the chrome; the fill moves
  a real light and its highlight. **Key brightness** dims the warm key and
  reflections from 0–200% without moving either light or muting
  the independent fill. **Eyelid finish** chooses mirror chrome (the default),
  matte, wet glaze, gooey or clumpy. The adjacent **eyelid color** picker
  works with *every* finish; changing finish never discards its chosen color.
  **Finish reflection** adjusts the studio reflections on chrome and glossy
  finishes without changing the tint. **Eyelid pattern** draws smooth,
  sphere-local stripes, plaid, small polka dots or checkerboard across the
  moving lid and back shell. Separately, **Light pattern** projects a
  checkerboard, small dots, diagonal stripes or ripples from the key light
  onto the whole eye; moving K moves the projection. **Iris color** offers the
  original fibers, seven familiar tints, neon pink/cyan/lime, ember red and
  blackout. Its native color picker chooses any custom hex color; **Iris
  pattern** adds radial stripes, concentric bands or polka dots without
  removing the fibers. **Eyeball color** tints the separate globe with natural, ivory,
  blush, pearl, ink black, orchid, mint, cobalt or coral, or a custom color
  from its own picker. Its separate **Eyeball pattern** wraps dots, stripes or
  checkerboard over the globe, with an independent pattern color picker.
  Neither eyeball color nor pattern changes the separate iris or its corneal
  window; the pattern follows gaze, Poke, Stretch and all 1–12 eyes. The starting appearance is
  plain violet iris, pearl
  eyeball and unpatterned silver chrome lids. **Eyeball look → Black loading
  eye** uses the same loaded, deformable 3D globe with dark untextured
  materials and a corneal opening that reveals its grayscale iris and pupil,
  so it still follows gaze, whole-eye rotation, Poke and Stretch.
  It approximates the silhouette seen while loading rather than freezing a
  two-dimensional image. Palette pickers pause in this look; switching back
  restores their previous colors.
  The studio lights and appearance change the image only, not the voice,
  Audio or a musical preset; the interactive flashlight is separate, and
  **Iris cast** is a sound-shaping knob.
- On the focused canvas, arrow keys move the eye (Shift for finer steps);
  holding **L** closes the lid until keyup or blur (**B** is a MIDI piano key).
  Every gesture has equivalent labelled knobs or the gaze pad. The Audio button and
  transport can be used by keyboard.
- The right-panel menu contains **36 full presets**: the original twelve,
  eight pupil-only pulses, eight scenes with tiny pupils and eight
  forward-looking, lid-only flutters. Presets, Next and dice change the
  **sixteen musical controls**, including Lid speed, without changing Audio,
  Play or Output. The default is a
  moderate, playable held pose. The **Reset** button in the stage's upper-right
  corner or beside Motion restores that pose and the beat origin
  and centers the whole-eye viewpoint while retaining Audio, Motion and Output.
  Reset also restores solid chrome, plain violet iris, pearl eyeball, both light
  positions, default eyelid and pattern colors, plain light, solid sphere/iris patterns, 100% finish
  reflection, 100% key brightness, 80% flashlight power, 42% poke diameter,
  100% poke depth, 43% beam diameter and 84 BPM Cry tempo;
  Poke, Flash and Stretch turn off, Cry stops, the dress-up toggles clear,
  the eyeball count returns to one, its ensemble returns to Banter, Lid speed
  returns to 1×, the lids return and the black look switches back to the textured eye.
  Viewpoint, appearance, eyeball count, ensemble, wardrobe, studio lighting and flashlight power persist
  through preset/dice changes, as do the live poke depth, diameters, Cry tempo,
  chosen surface tool, retractor and lid visibility. Dice chooses bounded full states.
  Motion's on/off is live transport, not a preset parameter; its style and
  movement depth *are* part of each musical scene.
- A browser back/forward-cache return keeps the pose, controls and Motion
  state, but releases Audio. Tap Audio explicitly again to restore the voice.

| Gesture or control | Visual state | Sound mapping |
| --- | --- | --- |
| Gaze X/Y pad / Look across and up/down knobs | Globe, textured iris, pupil, vessels rotate | Displacement excites a short pitch-gliding squish; stereo pan and pitch follow gaze |
| Drag the empty stage / Whole eye left-right, up-down | Entire globe, skin shell, lids, lashes and tear turn together, up to ±90° on either axis | Viewpoint only; the separate gaze and sound stay put |
| Upper lid / Lower lid | Separate upper/lower margins and lashes | Each manual lid gesture can plop; repeated closures can plop automatically; aperture softens concurrent glances |
| Retract lids toggle | Both lids held fully open over the unchanged saved lid settings | Opens the lid sound gate; a toggle can make one short lid event, not a held tone |
| Hide lids toggle | Shell, lashes, cigar, coat, scarf, headband, mouth props and tear disappear; sunglasses or Groucho, hats, hair, ears, tie and tail remain with the bare globe(s) | Silences lid rhythm but retains the independent eyeball voices and saved knobs |
| Poke / exposed eyeball / Poke diameter and depth / focused-canvas P and arrows | Textured globe, iris details and veins locally dimple and rebound over a variable area and depth | Brief pressure-, depth- and diameter-sensitive watery squelch on press/scrub and a smaller spring release; still holding is silent |
| Stretch | Short local tug without gaze rotation | Brief sound on grip, tug and release; no sustained note |
| Flash / beam aim / Flashlight power / Beam diameter | Movable variable-width spotlight; pupil briefly constricts when the visible iris is reached | A change in light exposure excites the short pupil squish; a steady beam makes no drone |
| Pupil | Dark aperture ranges from pinpoint to wide | Moving it excites short squishes; breath/noise cutoff and overtone brightness change each hit |
| Tear / Cry / Tear size / Cry tempo | One drop / repeated drops at their own rate; size changes the bulb, not activation | Brief detachment sound at the lid corner on the audio clock; Tear size also colors movement sounds |
| Eyeballs in sheath / Eyeball ensemble | 1–12 globes; two to four touch, larger counts nearly touch in two or three depth-staggered rows; Banter/Harmony/Rock retain different resting directions even while paused | One bounded event voice per eye with independent pitch/accent/pan; one voice in Together; not stored in musical presets |
| Tongue / teeth / mustache / lipstick | Mouth pieces move with the shared lips and hide with the shell; the tongue drapes in front of the lower lashes | Throaty formant, tooth click, softened high edge on the next lid hit; silent when lids hide |
| Aviator sunglasses / Groucho disguise / cigar / hats / coat / scarf / hair / headband / bow tie / ears | High glasses follow the lid or rest over bare eyes; Groucho adds a nose and bushy mustache in one switch; the coat follows the lower lashes and hair clears the upper ones | Muffle, ring, filter, brighten or widen subsequent events; Groucho uses the glasses and mustache mappings, not a held voice |
| Vein drive / Breath | Scleral vessel contrast / visible iris remains | Noisy grain / airy grain on each event |
| Iris cast / Focus | Iris cast / unchanged pupil aperture | FM partial color / harmonic brightness |
| Register | Same resting eye | Reference pitch in hertz for the next event |
| Eye tempo / Lid speed / animations / Movement | Eye beat and phase-continuous 0.5–2× lid loop, independent movement styles and excursion, separate from Cry tempo | Audio clock drives gaze and each eye event, lid hits use the lid loop, never RAF timing |
| Eyelid finish/color/pattern / K and F lights / Light pattern / Key brightness / Finish reflection | Any-color mirror, matte, wet, gooey or clumpy sphere with smooth stripes/plaid/small dots/checkerboard and optionally projected light patterns | Visual viewpoint only; sound and musical presets are unchanged |
| Eyeball look / iris and eyeball palettes / iris and eyeball patterns | Textured or black 3D globe; recolored iris fibers, colored globe dots/stripes/checkerboard, independent eyeball and iris tint | Visual only; sound and musical presets are unchanged |

One bounded stereo AudioWorklet contains the shared lid/tear rhythm plus up to
twelve **short, event-excited** eye voices, rather than held oscillators. Each
gaze or pupil movement can trigger its own pitch-gliding squish with a
position-based stereo pan; lids make airy flits or low, mouthy plops, and
Tear/Cry add a short release sound. The same audio-clock functions drive
visible and audible motion. Phases, pans and levels smooth per sample and
decay to silence. Manual gestures can therefore play while Motion is paused;
MIDI note-off returns to the manual pose without cutting a drone.

## MIDI

Settings → **MIDI In** enables the shared computer-keyboard/hardware input.
Enabling MIDI may prepare Audio, as documented by Morphazoid's MIDI contract;
MIDI Start/Stop themselves never arm it. The two-row keyboard uses
`Z S X D C V G B H N J M` for MIDI 48–59 and
`Q 2 W 3 E R 5 T 6 Y 7 U` for 60–71. Octave and velocity shifts use
`[`/`]` and `-`/`=`. There is no on-screen keyboard occupying the eye stage.

Each MIDI note-on excites a short pitched glance sound, including repeated
notes of the same pitch. The newest held note temporarily sets an absolute
reference pitch, glances across/up-down, and opens the pupil by velocity.
Earlier notes return when newer ones release; pitch bend moves the reference
±2 semitones and CC64 retains released references per input/channel (not
an indefinitely sounding tone). Note-off/panic and MIDI Off return to the
manual pose without rewriting presets. MIDI pitch uses the
standard MIDI note-to-frequency convention **only for incoming notes**;
manual eye movement and automatic LFO motion are continuous, unquantized.
Gaze inflects each event's pitch continuously, even during MIDI notes.

| Input | Effect |
| --- | --- |
| CC14–21 / profile Macros 1–8 | Gaze X, Gaze Y, upper lid, pupil, tears, vein drive, focus, breath |
| CC1, CC7, CC11, CC71, CC74 | Pupil, Output, breath, vein drive, focus (unless a profile owns that CC as a macro) |
| CC64 / CC120 / CC123 | Sustain / all sound off / all notes off |
| Program 0–35 | Full presets 1–36 without restarting Motion |
| 24-PPQN timing clock | Tempo native range (presented as a knob) through the shared tracker |
| Start / Continue / Stop | Start or pause Motion; Stop also releases held notes |

## Model and license

The original **Realistic Human Eye** by **DEGUIDER** is a freely downloadable
[Sketchfab model](https://sketchfab.com/3d-models/realistic-human-eye-b68ae822b45443edb812950993ece362),
licensed [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
The bundled `assets/oculoid/eye.glb` (2,728,632 bytes) comes from
[Objaverse's mirrored GLB](https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-093/b68ae822b45443edb812950993ece362.glb).
Its two separate, textured meshes are the globe and iris. The asset does
**not** include eyelids, eyelashes, a face or an animation rig. Morphazoid
orients and scales the unchanged asset at runtime and supplies an authored
spherical skin shell with separately animated upper and lower lids, thick
rounded margins, a growing and falling drop, individually generated lashes,
vessels, a pupil, glints, optional procedural teeth and a tongue. Multi-eye
mode scales and reuses the same textured source with independent deformable
geometry but shared materials. The aviator glasses use
[Kimppo's 3D model](https://sketchfab.com/3d-models/aviator-sunglasses-00d1cb5aa82745228a3b764c97f867de)
under CC BY 4.0. Oculoid fits them at runtime without rewriting the bundled
GLB; if unavailable, procedural frames remain playable. The icon is rendered from the
adapted eye. Exact checksums, source details and modification notice are in
[`SOURCE.LICENSE.txt`](../assets/oculoid/SOURCE.LICENSE.txt) and the
repository's [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Preserve
attribution and the CC BY license when sharing the model. The creator has not
endorsed this instrument.

For the falling drop, Oculoid also adapts **CC0 - Drops** by **plaggy** from
[Sketchfab](https://sketchfab.com/3d-models/cc0-drops-f8f24228aebf41f297c878ad82ea7db0).
Despite that title, the downloaded GLB explicitly says **CC BY 4.0**, *not*
CC0. The bundled `assets/oculoid/drop.glb` preserves its 960-triangle teardrop
shape but removes the source textures and material; its own water material,
orientation, growth and vertical fall are applied at runtime. The tiny
geometry-only derivative is 19,760 bytes instead of the original 2.6 MB.
The ZIP contained no separate license file; the embedded GLB credit and license,
both original and derived hashes, and the extraction command are recorded in
[`SOURCE.LICENSE.txt`](../assets/oculoid/SOURCE.LICENSE.txt). No head mesh,
restricted texture, fluid simulation or teardrop animation rig is bundled.

The eyelid shell and eye-white are separate materials. Two independently
deforming **wraparound** front lid patches meet at the corners and at the
equator of a posterior skin hemisphere: the eye is one floating
spherical surround, not a flat face sheet or a separate background
oval. The hemisphere and both moving lid patches are reflective chrome outside
by default (with warm brown available using Matte and the color picker), with
unlit black inward-facing skin. Black fills the small side recesses where the
lids meet around the straight-ahead globe; these taper to a point instead of
painting a black outline across the upper or lower sclera. As the globe turns,
the visible recess changes shape but not color. A near-black spherical socket
liner sits behind the globe without covering it; at an oblique angle it keeps
the smaller eyeball's side gap from disappearing into the black stage, so the
round chrome shell does not appear pinched. The neutral studio reflections also
give its dark side a faint highlight, without adding a backdrop oval.
The rounded inner edges of both lids take the selected finish. Its 1.14-radius
spherical shell brings the cover closer to the rotating eyeball, leaving only 0.07 radial clearance to
the conservative globe envelope instead of 0.13. The rounded edge keeps a
nearly uniform width across the opening and tapers smoothly at the corners.
The front patches and back hemisphere share exact equator vertices,
sphere normals and the same exterior material, without an exterior seam.
The inward black patches share the moving lids' vertices; two small unlit
corner surfaces sit behind the globe and show only in uncovered side gaps.
The globe's sclera, including its reddish edge, stays in front of these
dark corners while the rounded lid rolls still cover its upper and lower edges.
The chrome is a high-metalness browser PBR material reflecting a neutral,
procedurally drawn panorama of broad, feathered highlights, with no sharp
rectangular light cards or black stripe; this is not ray-traced reflection of
the room or the eye itself. Two actual directional lights orbit independently;
the key also rotates the reflections. The Key brightness knob changes the real
key's intensity and the chrome's reflection strength while leaving a dim
ambient reflection and the independent fill at zero. A mapped spotlight
projects optional studio-light cookies; their 512px source is generated in
memory and reused, rather than baking a pattern onto the eye.
The finish changes the same shell materials; matte keeps fine skin pores,
wet and gooey use clearcoat, and clumpy has rougher, mottled surface shading.
Lid stripes, plaid, dots and checkerboard are antialiased in spherical object
space per fragment on the front, side and back rather than interpolated across
sparse vertices or joined UV images. The black interior is unaffected.
Iris recoloring and patterns operate only on the
separate iris mesh's bottom-left bitmap-atlas region; the original licensed
image and globe texture remain intact on disk. A single derived atlas is reused
across choices and released on teardown. Eyeball patterns interpolate the
loaded globe's original sphere-local coordinates for per-pixel shading and
travel with additional eyes without touching the separate iris or source atlas. The globe shader
protects the corneal opening from both its independent color and pattern
color; the iris texture, pupil and fibers keep their chosen colors.
The Black loading eye look temporarily replaces the loaded globe and iris
materials without replacing their geometry. Its ink globe leaves the corneal
disk open so the imported iris and its pupil, fibers and glints remain visible
instead of hiding behind the opaque black surface. The same gaze, whole-eye
turn and surface deformation apply.
The camera frames the shell against a black stage by its shorter canvas
dimension, so it remains large without clipping on tall or wide screens.
Tall hats and curled tails temporarily widen that framing to keep the props
in view through whole-eye turns; without them the original close view returns.
The imported globe and both shell hemispheres have **1:1:1 dimensions**;
neither front/back nor the rotating textured globe is depth-squashed. A
conservative spherical envelope of radius 1.07 encloses the globe's
measured maximum normalized vertex radius of 1.0524 at **every**
gaze angle. The fully open margins stop short of the skin shell's poles:
their thin inner edges approach that envelope closely enough to seal the
posterior-socket gap without cutting through the moving globe. Most
of the remaining rim volume projects toward the camera.
The skin shell uses a single gently asymmetric arch per lid, with subtler
pores in matte mode and no painted crease band or oval over the lower lid. The medial
corner sits lower and tighter than the temporal corner; upper and lower
arcs differ, and lash rows sweep outward toward
the temple. Their roots now sit on the outward-facing lip crests, with each
strand curving away from the opening rather than spearing the opposing lip
at full closure. Drawn scleral vessels follow the spherical globe surface
instead of floating outside it. Upper blinking does not pull the lower
margin along with it; performers can move either lid separately.
There is no separate tear duct, caruncle or streak. A single pointed drop
grows from zero at the viewer-left joined lid corner. The source drop's
measured apex is aligned with the tip-to-center distance used to position
it, including the procedural fallback: no gap remains above its growing tip.
Only the rendered geometry leans away from the spherical skin; the tip stays
on the corner, and even the broadest bulb clears the shell.
It then falls straight down at full size until it leaves the stage. Tear
performs this once; Cry repeats it every four beats at its own tempo,
independent of Motion. Tear size changes its scale but cannot start it. Hide lids temporarily
removes the whole shell and tear without changing saved lid settings. The lids
stay put when **gaze** rotates the globe, but a separate ±90° horizontal
and vertical turn pivots the entire assembly together; the back of the
iris cannot face the camera. This is still an artist-built surface,
**not** a scanned or pre-rigged lid; the tear is not a physiological fluid
simulation.

As an earlier shape reference only, we sampled the local mesh depths in Blender
around one eye of the downloaded
[Head of a young man](https://sketchfab.com/3d-models/head-of-a-young-man-cc7c091126164acea4d69d9a2179fedf)
by Fabian Mohr (Sketchfab Standard license). The sampled surface suggests a
broad brow-to-lid and lid-to-cheek depth transition. After trying a
face-like surround, Oculoid instead uses the requested spherical wrapper;
the sampled head is **not** its geometry or topology. It supplies **no**
Oculoid mesh, texture, eyelid rig or bundled asset; the eye surround
remains procedural and original.

We also checked free Sketchfab listings for a real replacement lid. The
[CC BY Eyelid Morph](https://sketchfab.com/3d-models/none-55043ceea39b4fca89bd9f9421069578)
listing reports 1,203 faces, no textures and no animation clips;
[CC BY Eyelids](https://sketchfab.com/3d-models/none-6d8bd2138f454f57a83418e80c9403e7)
is described as *eyelids for 3D splaat* and lists a 128-pixel texture,
19,600 faces and no animation clips. The
[CC BY eye anatomy study](https://sketchfab.com/3d-models/none-559f4ff77e554249b59f77acd0030ad7)
lists nearly 496,000 faces and no textures or animation clips. Those public
listings do not establish a matching rig, topology or texture fit for
DEGUIDER's globe. None is bundled or represented as the Oculoid's eyelid.
Before substituting one, its geometry, eyelid motion and exact licensing
would need hands-on inspection.

These layered shapes are a visual and musical **approximation**, not medically
accurate tissue, physiological pupillary response, ocular dynamics or an eye
tracking system. The bright corneal glints and visible veins are authored;
the sound is entirely synthesized, not captured from anatomy. The Three.js
renderer uses the repository's existing locally vendored MIT-licensed runtime.

## Resource and lifecycle limits

One AudioWorklet voice produces at most two output channels; it never depends
on rendering frames for its timing. Gaze and tone targets are bounded; stereo
samples are saturated and post-master Output is limited to 0–0.8. The rig uses
two 112-slice × 38-band skin patches (including ten rounded-lip bands),
shared-vertex black interior patches, two small canthal recesses,
one rear hemisphere with a selectable chrome/matte/glossy/clumpy exterior and permanently dark interior, 106 tapered lashes,
one static 64×48 near-black socket liner behind the eyeball,
one 960-triangle growing/falling drop and 36 small vessel paths per globe;
up to three extra globe geometries are cloned lazily for the multi-eye mode,
while the textures/materials and single AudioWorklet voice are shared;
canvas DPR is limited to 1.7 and roughly 1.2 million pixels at rest; while
Motion or Cry animates the eye it uses at most 500,000 rendered pixels and 24 frames
per second for the more active styles (30 for Drift). Software WebGL falls
back to 24,000 moving pixels and 12 frames per second so its CPU renderer
cannot monopolize gesture and shared output-meter updates. MIDI retains
at most 24 held notes and 32 pedal/bend scopes. The viewer releases
meshes, textures and its WebGL renderer (including a procedural tear fallback
if the optional drop model fails), and the audio context and
listeners are released on normal page exit. These limits keep display work
secondary to the audio clock, but do not constitute a human listening or
phone-touch certification.
