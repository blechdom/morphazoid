# Quadruped gait-to-sound notes

Quadruped is a playable locomotor model, not a biomechanics simulator. Its
sixteen cabinet cards are one editable gait cycle, and its four feet authorize
the clock:

`touchdown -> load -> push -> score travel -> lift-off -> flight -> landing`

A global BPM is independent of animal and gait. At 1× pace, one complete
sixteen-card cycle is one beat before added air/slide rests. ½×, 2×, and 3×
set the footwork ratio without rewriting BPM. The base cycle therefore occupies
`1 / paceRatio` beats. A tempo edit preserves card phase, cancels queued
future attacks, and retimes the motor immediately. Mass, species, terrain,
slope, and contact strength shape support, body, flight, timbre, and dynamics
without bending that global clock.

`Air / slide rest` inserts 0–8 additional global beats into selected cabinet
cards after the launch and before the next landing/stand. A card's clock duration
is `1 / paceRatio + 16 * extraBeats / stretchedCardCount`; unstretched
cards retain just `1 / paceRatio`. Prefix sums map card position to global
musical time and back, including exact touchdown, load, push, and toe-off
offsets. The playhead slows through stretched cards rather than repeating them.
Their badges display beat duration. Pace and rest length stay put across animal
and gait changes.

A touchdown begins stance. Support persists after it; load and push color the
contact, and lift-off begins an exact zero-support interval when no other foot
is planted. Ordinary running floats open a persistent air voice. Explicit
extended leaps/rolls mute that voice, leaving a rest after earlier contact tails
decay, until landing. The arc is a bounded ballistic-shaped curve in musical
time: multi-beat airtime is intentional slow motion, not physically literal
Earth-gravity flight. Clearing all four rows removes authorization for the clock: stored
momentum coasts according to the selected surface, then reaches an exact stall.

The live animal stays centered. Footprints and the material field move backward
through time beneath it, so each planted foot appears fixed in world space until
lift-off. Animal geometry is procedural; Cutout collage textures reuse the
project-owned Hiccup Head atlases described below.

## Interface and output

The control rail follows Shape and Roach Synth: flat dark surfaces, compact
native menus, one graphic title, and full presets → Next → Random at the top.
Animal and gait remain independent menus. Hidden accessible help holds the
instructions; the graphic keeps the animal and its contact feedback. Solo/Herd/Trio share the
pace row, with the numbered animal editor buttons alongside or wrapped on narrow
screens. Air / slide rest uses an inline knob only on compatible gaits. Redundant
four-foot audition boxes are removed; the score and keyboard 1–4 still edit feet.
The sixteen sequencer cards use the same Constellation animal rig as the stage,
with dark outlined backgrounds. A shared camera fits the whole gait so relative
jump height, rolling, and limb motion remain visible. Cards keep this style
independently of the selected stage skin and retain frame selection, support,
touchdown strengths, and duration indicators.

Twenty-seven complete scenes recall animal scores, foot/call patterns, gait, tempo,
pace, rests, group composition, surface, course, grain, cavern and sound skin.
Random creates a bounded new complete scene. Successful preset, Next and Random
recall starts Play, as requested by the owner; startup remains stopped. Audio
arming and master output are preserved. Turn **Audio** on to hear a playing scene.
Tempo spans 10–1,000 BPM, including immediate retiming at 3× pace (800 frames/sec
on average before extra rests). The logarithmic tempo knob keeps slow speeds
accessible; Shift-drag gives fine adjustment. Constellation is the startup and
global-reset skin. The original filled animal rendering is labelled Cartoon;
its `animal` selector ID is unchanged. The independent Animal skin menu sits
directly below the main presets. Recall, Next and Random preserve the chosen
animal skin, so new users stay in Constellation until they change it explicitly.

### Expanded motion and pitch

These are expressive, fictional extensions of the gait model. The same clock
and contacts drive movement and sound; presets retain explicit Audio arming,
master level and transport phase. New controls belong to the selected animal,
including independently editable Trio performers. Version 3 scene snapshots
add neutral expressive controls to older snapshots and ignore their legacy
visual skin field while preserving the saved music and sound skin.

| Control | Range | Visible and audible relationship |
| --- | --- | --- |
| Stride reach | 0.15–2.4× | Short shuffles through long world-travelling strides |
| Momentum | 12–300% | Push, stance, swing return, lean and empty-score coasting |
| Gravity | 10–300% | Floating airborne arcs through heavy, rapid falls |
| Pitch | −36 to +36 semitones, continuous | Transposes contact resonances, calls and the air voice |
| Lopsided | −100% to +100% | Uneven left/right pressure, lift, lean and timing within each cycle |
| Spring | 0–250% | Low skimming steps and damped impacts through exaggerated bounce, leaps and elastic ringing contacts |

Neutral Pitch/Lopsided/Spring are 0/0/100%. The twelve new scenes cover Slow
motion, Lopsided, Superhero and Extreme settings, including Lunar drift,
Crooked parade, Silver streak, Skybound and Hyperdrive. The original fifteen
scene IDs remain available. Full randomization explores all new controls and
their endpoints, biased toward moderate settings. Output and voice limits stay
bounded at the enlarged ranges; recorded signal checks establish parameter
direction and finite output, not human judgments of timbre or physical realism.

A fixed 4× (+12.04 dB) calibration follows the existing compressor. The native
master default/range stays 0.62 / 0–0.72. A soft ceiling and final reconstruction
guard bound output at 0.89. Offline stereo tests at 48/96 kHz verify the gain,
peak bound and zero-level silence; browser tests cover audible signal, mute,
pause and graph teardown. Signal measurements do not imply human listening or
physical-device acceptance, which remain unperformed.

### Independent sound and animal skins

Five sound skins use touchdown, load, push, lift-off and irregular body-slide
contacts. Ground combines a low body impact with broken grains; Tendon uses a
plucked delay loop; Porcelain excites inharmonic modes; Voltage uses decaying FM;
Breath uses short resonant air pulses. The designs draw on this repository's
Karplus Strong, FM Drums, Dentaphone/Object Forge and Shapes engines. They are
artistic synthesis, not recordings. Species mass, limb, surface, velocity and
resonance color every skin. Contact grain changes push/lift detail; New grain
changes event variation. Four prepared variants per contact are held in a
bounded 256-entry cache. No persistent scratch source runs during a skid.

The scheduler mixes its next contact window into one stereo sample buffer,
preserving each onset, pitch and pan. This prevents dense 1,000 BPM trios from
exhausting the 48-node budget with future contacts and silencing an earlier
actor. Control edits release queued batches before rescheduling. Melodic calls
keep their separate voices; extended flight rests remain silent unless scored.
Exact-rate contact resamples use a shared 32 MiB / 2,048-entry limit, with up to
32 rates per prepared source. The motor prepares contact cards separately from
drawing geometry; live state advancement skips discarded event records while
audio prediction retains every crossing and stance transition. Parity tests
compare these paths against full support geometry, eventful advancement and
direct stereo interpolation.

Five animal skins share the same poses and fixed-length limb IK: Cartoon,
Skeleton, Constellation (open Shapes-like connections and joint stars), Cutout
collage (photographic Hiccup Head atlas pieces), and Motion cards (sepia study
contours). Collage loads the existing project-owned assets only when selected;
see `assets/hiccup-head/skins/README.md` for provenance. Skin changes preserve
scores, clock, Audio and Play. Musical presets recall sound skin while animal
appearance stays independent; switching appearance also preserves the selected
main preset name.

Each visual skin also owns its environment. Constellation uses outlined sky
checks and a perspective ground grid, with laser structures and wireframe objects;
its background has no stars. Skeleton uses an eerie field with tombstones,
bones and bare trees. Cutout collage extends the existing photographic atlas
into the sky, hills, ground and scenery with white paper edges. Cartoon uses
an earthy field with cacti and tumbleweeds; Motion cards draws its scenery in ink.

Passing objects are decorative scenery behind the animal, with near/far layers
following actual motor travel. Pausing or stalling freezes the world; selecting
a stopped score card does not wrap the scenery back to the first gait cycle.
Every ensemble lane follows its own animal. World cells have stable identities,
so retracing the same distance reproduces the same objects. Only the visible
neighborhood is drawn; no growing object list, independent clock, collisions or
new sound triggers are introduced. Terrain still follows the selected course.

Footprints and landing flashes follow the visual skin in every group mode:
Cartoon keeps soft colored stamps; Skeleton leaves ivory toe bones;
Constellation leaves hollow rectangles; Collage uses photographic paper scraps
with pale cut edges; Motion cards uses sepia outlines and hatching. Contact
positions, timing, fading and the existing footprint hit targets stay tied to
the same feet.

Automated coverage: `tests/quadruped-{sound-skins,visual-skins,environment,presets,output}.test.mjs`
and `e2e/quadruped-{skins,environment,presets,ensemble,output}.spec.mjs`. Visual browser review
covers desktop, phone portrait and phone landscape, all five skins, reachable
menus and the aligned group/editor row.

## Reading and programming the score

There are four editable foot rows: left front (LF), right front (RF), left hind (LH),
and right hind (RH). Three optional melodic call rows sit below them. Calls never
count as support or propulsion. There is no fifth tail-contact lane.

- `·` means **no new touchdown on this frame**.
- `○` means a **soft touchdown**.
- `●` means a **strong touchdown**.
- The separate colored bar means the foot is **still planted** from the most
  recent touchdown.

A dotted cell can therefore still have a support bar. It is only airborne when
none of the four rows is supporting the body. Changing a touchdown changes both
the audible attack and the subsequent stance geometry, rather than merely
lighting a drum pad.

Hildebrand-style gait diagrams distinguish touchdown phase from duty factor,
the fraction of a limb cycle spent in stance. Quadruped preserves that
distinction: editable marks choose touchdown times and strengths; a
gait-specific front/hind duty factor calculates support, load, push, toe-off,
swing, and flight between them.

## Shared gait dictionary

Every gait can be borrowed by every animal. The UI labels anatomically unlikely
pairings as playful transfers instead of hiding them. The current dictionary has
forty-five entries in the same order for every species, spanning lateral and diagonal walks, running walk, amble,
tölt, jog, trot, passage, grounded and flying pace, both canter leads,
transverse and rotary gallops, bound and half-bound families, stot, jump,
leap, skid, forward roll, cartwheel, rear up, two-legged dances, species studies,
Mosey, Wander, Drunk, Tiptoe, Walk ×4 · leap, and Run ×3 · leap.

| Study | Zero-based touchdown cards | Contact character |
| --- | --- | --- |
| Walk | RH 0, RF 4, LH 8, LF 12 | even four-beat sequence; long overlap |
| Trot | RH + LF 0, LH + RF 8 | diagonal pairs separated by floats |
| Pace | RH + RF 0, LH + LF 8 | same-side pairs |
| Right canter | LH 0, RH + LF 4, RF 8 | three beats with a longer recovery |
| Right transverse gallop | LH 0, RH 3, LF 4, RF 8 | four contacts then suspension |
| Right rotary sprint | RH 0, LH 2, LF 7, RF 10 | hind-to-fore rotary order |
| Bound | LH + RH 0, LF + RF 8 | paired hind and fore contacts |
| Stot | all four 0 and 8 | simultaneous launch groups |
| Jump | hind launch; split fore landing | launch, flight, landing |
| Leap | LH + RH 0, RF 10, LF 11 | longer unsupported arc |
| Skid | LH + RH 0, RF 14, LF 15 | hind push, sustained belly slide, stand |
| Walk ×4 · leap | RH 0, RF 2, LH 4, LF 6; LH + RH 8; RF 14, LF 15 | four walking contacts, launch, stretched rest, landing |
| Cartwheel | RF 2, LF 5, RH 10, LH 13 | sequential supports with extended swinging limbs |
| Forward roll | LH + RH 0, RF 12, LF 13 | long flight with a tucked full-body rotation |
| Rear up | hind pair 0 and 8 | both forefeet raised on hind support |
| Rear waltz | hind pair 0, 5, 10 | both front legs can remain in the air |
| Rabbit gallop | LH 0, RH 1, LF 5, RF 7 | hind cluster followed by split fore |
| Giraffe walk | LH 0, LF 2, RH 8, RF 10 | long overlapping supports |
| Lizard scuttle | RH 0, RF 4, LH 8, LF 12 | lateral sequence with body wave |

`Leap`, `Skid`, `Forward roll`, `Cartwheel`, and `Rear up` are explicitly playful
stunt studies, not measured steady gaits. `Run ×3 · leap` is also a
composition: alternating
single-foot running contacts fill cards 0–11, both hind feet launch on card 12,
the final rear push clears during card 13, card 14 holds extra airtime, and both
forefeet land on card 15. Mosey, Wander, Drunk, and Tiptoe are authored musical
character studies, not names of measured gait classes.

Useful gait sources:

- Modern sequence, couplet, and duty-factor terminology:
  <https://academic.oup.com/icb/article/62/5/1246/6659194>
- Comparative gait mechanics across quadrupeds:
  <https://elifesciences.org/articles/29495>
- Horse canter timing:
  <https://nyaspubs.onlinelibrary.wiley.com/doi/full/10.1111/nyas.15271>
- Horse gallop footfall timing:
  <https://pubmed.ncbi.nlm.nih.gov/17050854/>
- Dog joint kinematics across walk, trot, and gallop:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6242825/>
- Dog temporal gait parameters:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC5015230/>
- Dog walk–trot and trot–gallop transitions:
  <https://pubmed.ncbi.nlm.nih.gov/11721550/>
- Goat slope locomotion:
  <https://www.mdpi.com/2313-7673/7/4/220>
- Rabbit hindlimb and forelimb support order:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6741911/>
- Camel walking and pacing:
  <https://zslpublications.onlinelibrary.wiley.com/doi/10.1111/j.1469-7998.1974.tb03144.x>
- The user-supplied animator's guide is a readable cross-check, not a source of
  copied art: <https://www.animatornotebook.com/learn/quadrupeds-gaits>

## Species evidence and playful boundaries

- Elephants retain lateral-sequence contacts across speed and do not enter a
  whole-body aerial phase; aerial elephant presets are playful transfers:
  <https://pubmed.ncbi.nlm.nih.gov/16985198/>.
- Gazelles fit rotary gallop and stot particularly well. Unicorn locomotion is
  deliberately fantasy.
- Domestic-cat walking uses a lateral sequence. Cats can use rotary,
  transverse, and half-bound gallops; jumping is hind-driven and lands
  forelimb-first:
  <https://journals.physiology.org/doi/full/10.1152/jn.00524.2013> and
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6857581/>.
- Fast cheetah rotary gallop alternates gathered and extended flight while the
  spine flexes and extends:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC8099890/>.
- Adult giraffes have been observed using a grounded rotary gallop, skipping
  trot, canter, and pace:
  <https://pubmed.ncbi.nlm.nih.gov/30775166/>.
- Lizards are diverse rather than one gait type. The presets contrast
  lateral-sequence, diagonal, pace-like, and explicitly playful hind-leg
  coupling:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC9271186/>.
- Horse, dog, goat, rabbit, and camel profiles use the studies linked above as
  family-level constraints, then quantize those relationships to this editable
  sixteen-card instrument.

The exact card positions, limb proportions, duty factors, material voices, and
motor constants are supported approximations for play, not measurements copied
from any one paper.

## Anatomy and ground

Each species has fixed normalized upper, lower, and distal limb lengths. A
three-segment inverse-kinematics solver changes joint angles while preserving
those lengths and the requested foot contact whenever the authored chain can
reach it. Shoulder, haunch, clearance, head, neck, paw/hoof, spine, and tail
proportions remain species-shaped rather than one skeleton with different
colors. The giraffe carries procedural coat patches across body and neck. The
camel is explicitly drawn as a two-humped Bactrian camel.

The mouse uses a deliberately tiny body scale, pointed muzzle, large rounded
ears, slim paws, and long fine tail. The dinosaur is specifically a quadrupedal
Triceratops: broad frill, two forward brow horns, smaller nose horn, a beak,
heavy body, and tapered tail. Its locomotion is speculative; no measured
Triceratops gait is claimed. All silhouettes and features are authored Canvas
geometry, with no downloaded imagery:

- Natural History Museum, Triceratops anatomy and four-legged body plan:
  <https://www.nhm.ac.uk/discover/dino-directory/triceratops.html>
- American Museum of Natural History, frill and three-horn anatomy:
  <https://www.amnh.org/exhibitions/permanent/ornithischian-dinosaurs/triceratops>

Roll rotation is clockwise for the right-facing animal. Cartwheel swing legs
extend around the rotating body, while a supporting foot keeps its ground
anchor. During the middle of a skid the belly lowers to the surface and limbs
tuck completely out of view; no foot is planted and no ballistic flight is
invented. One continuous material-filtered scrape replaces repeated foot hits.

The ground is one global material—earth, sand, wood, stone, metal, snow, water,
or crystal—not a different material on every card. Each material changes the
same contact resonator; roughness and hardness color releases, scrapes, and
landings, while rolling resistance changes only an unpowered coast, never BPM.

Level, upstairs, and downstairs are course profiles. Feet land on discrete stair
treads, with touchdown anchors inset from tread edges. The body follows the
continuous average grade of the regular stair course, which avoids a camera and
torso snap when support changes from two feet to one. Switching the entire
course relatches the current stance to the new geometry; after that switch, each
new touchdown keeps its tread until lift-off. Ascent lengthens rear stance and
increases rear load/push; descent lengthens front stance and front braking load.
The torso leans with the grade and swing feet lift further. Contact accents
use the same front/rear weighting so the course changes both motion and sound,
while BPM and touchdown card positions stay unchanged.

The stair model is an artistic regular-step approximation. It is informed by
the distinction between ascent and descent mechanics, not presented as measured
species-specific stair kinetics:

- Quadruped stair ascent mechanics:
  <https://pubmed.ncbi.nlm.nih.gov/21243173/>
- Quadruped stair descent mechanics:
  <https://pubmed.ncbi.nlm.nih.gov/20630021/>
- Leg compliance as a locomotor control principle:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6550006/>
- Cat uphill/downhill locomotor transitions and support adaptation:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC3130452/>
- Cat upslope kinetics and posture:
  <https://journals.physiology.org/doi/10.1152/jn.1998.79.4.1687>

The 1.02/1.14 stance and front/rear load multipliers are authored contrasts,
not measured coefficients from these studies.

## Sound mapping and bounds

Every foot has a distinct species-specific articulation family. Left/right and
front/hind contacts differ in oscillator or noise balance, pitch contour,
filtering, decay, and pan. Touchdown sounds the main attack; load and push add
smaller stance accents; toe-off adds a bounded release texture. The selected
surface passes those contacts through one persistent material resonator.

Calls start empty so the gait remains purely percussive. Every animal has three
named melodic synthesis voices. The separate call rows cycle rest / soft / strong;
Call phrase writes a sparse editable example on frames 1, 7, and 13. Calls preserve
their score across creature changes. Like footfalls, call onsets use predicted
motor crossings on the audio clock. Head gestures use the same weighted card time
and bounded phrase duration. Calls do not propel an empty foot score.

- The motor integrates at 480 fixed steps per second to resolve fast 3× supports.
- Global clock rate is exactly `tempoBpm * 16 / 60` clock units per second;
  each card's weighted duration converts that rate to visible card travel.
- Position, velocity, height, catch-up time, crossings, and transition counts
  are bounded.
- Audio is procedural and sample-free.
- Output is capped at 0.72; the internal mix enters compression at a fixed
  bounded gain.
- One-shots are capped at 48 and scheduled from motor-predicted crossings on
  `AudioContext.currentTime`.
- Each of three available actors has one persistent air source; friction now
  uses bounded event buffers. Only active actors sound. Explicit leap/roll rests mute air;
  authored call events remain an intentional way to write a voice into those rests.
- Audio and transport stay separate: Play and score editing never arm Audio.

## Ensemble, grain, depth, and frog

Solo plays the selected score; Herd creates three of that species with differing
gaits; Trio creates the selected species, Cat and Gazelle. 1/2/3 selects the score
to edit without resetting any motor. BPM, pace, stride, surface, path, resonance
and output are shared; gait, foot score, call score and added air/slide time are
private. Scatter uses bounded seeded phase offsets, not a free-running random
tempo. Changing group mode creates a fresh group from the selected score; Solo
retains only that selected player's audible participation. This is a musical
ensemble in adjacent travelling camera lanes, not a collision/flocking model.

Body skids trigger irregular, seeded contact bursts at moving clock positions.
Pressure follows the model's body-slide envelope. Contact grain varies push and
lift detail; New grain changes the reproducible event sequence. The earlier
continuous friction loop has been removed. See the sound-skin implementation
above; no recordings or third-party code are used.

Each landing tread changes the foot's pitch register. A bounded tanh map of
signed tread count brightens ascending attacks and darkens descending ones.
Descending also opens three damped feedback delays with longer decay and lower
cutoff. Stair depth scales this color; changing the course or restarting resets
the depth origin. Elevation alone does not determine real room acoustics: this
is the user's expressive cavern metaphor, not an acoustic simulation.

Frog adds large folded hind limbs, webbed toes, a broad tailless body, raised eyes,
and a vocal pouch pulsing to Croak, Ribbit and Peep. Its ordinary hop uses the
shared Jump/Leap patterns; transferred horse gaits and stunts remain playful.
Anatomical inspiration: [AMNH frog facts](https://www.amnh.org/exhibitions/frogs-a-chorus-of-colors/frog-fun-facts)
and [AMNH frog exhibition](https://www.amnh.org/exhibitions/frogs-a-chorus-of-colors).
Pouch and limb proportions are authored approximations, not species measurements.
All animal calls are melodic character synths, not authentic recordings; unicorn,
dinosaur and instrumental animal voices explicitly belong to the fantasy.

## Direct animal performances

The graphic is playable with mouse, pen, touch, or a focused animal's keyboard.
Clicking the head plays one of the existing character calls. Vertical head drags
transpose it continuously within one octave; horizontal distance shapes strength.
The call begins on release, and the head follows that same bounded voice envelope
on the audio clock. Shift/Alt choose its second/third call. Silent previews use a
monotonic display clock while Audio is off; gestures never arm Audio.

Dragging a body right temporarily runs; dragging left reverses its world travel.
Two deliberate horizontal reversals within a second latch a dance. An upward
pull followed by release, or a body tap, performs one jump cycle. C calls, J jumps,
and holding R/B/D runs, reverses, or dances. Escape, pointer cancellation, loss of
capture, window blur, resizing, or hiding the page ends the temporary gesture.
Each actor owns its performance, so a paused Trio can play one animal at a time.
These performances leave the selected gait, authored score, presets, and Play
state intact. Releasing a held gesture returns to the selected gait; a jump
returns after its landing cycle. Explicit Pause and Audio-off cancel gestures.

Signed travel is a bounded piecewise mapping from positive score positions to
world coordinates. Reversals capture planted foot anchors and retarget swings;
they do not reverse the audio scheduler or mirror the animal. Changing stride
preserves the current stance; changing anatomy, gait, or course relatches support.
Travel history is transient and excluded from saved presets. Skin-specific
scenery and footprint geometry read the same world mapping. Hit targets derive
from the painted rig, with touch capture restricted to each animal so empty
scenery remains available for page scrolling.

These are expressive performances using the existing stylized gait and voice
engines, not physical predictions or literal speech synthesis. Automated checks
cover gesture recognition, signed anchors, audio output/release, independent
actors, score preservation, keyboard operation, and real browser touch events.
Human listening and physical touch-device feel remain separate acceptance work.

The compact controls use shared rotary presentations over native range inputs,
including keyboard adjustment and Tap tempo. Next buttons cycle Animal, Gait,
both skins, Surface, and Path through the same native change handlers as their
menus. The single bottom Reset all restores the startup scene, default scores,
world settings, skins and clock while retaining Audio, Play/Pause and output
level. Visible Playing notes are removed; gesture help remains available to
assistive technology.

All five visual skins articulate a side-profile jaw from the existing voice
strength envelope. The alternate rigs split the upper skull and hinged lower
jaw without changing hit targets, feet or sound scheduling. Skeleton teeth,
constellation nodes, collage paper and motion-card ink follow the same opening;
the default elephant retains its raised trunk without emitted sound marks.
Paused and released calls return to a closed mouth.

Skeleton scenery is sparse: a single full moon accompanies irregularly spaced
bare trees and plain gravestones. Gravestones
have no crosses. Constellation scenery uses floating solids and orbital shapes
over its outlined grid. Landmark density is bounded to three visible objects on
desktop and two on compact screens, while travel and pause still control their
positions.
