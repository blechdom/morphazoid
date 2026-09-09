# Quadruped gait-to-sound notes

Quadruped is a playable locomotor model, not a biomechanics simulator. Its
sixteen cabinet cards are one editable gait cycle, and its four feet authorize
the clock:

`touchdown -> load -> push -> score travel -> lift-off -> flight -> landing`

A global BPM is independent of animal and gait: one complete sixteen-card cycle
is one beat. A tempo edit preserves phase, cancels queued future attacks, and
sets the running motor to the new exact rate immediately. With any touchdown in
the score, mass, species, terrain, slope, contact strength, and gait do not bend
that rate. They shape the support, body, flight, landing, timbre, and dynamics.

A touchdown begins stance. Support persists after it; load and push color the
contact, and lift-off begins an exact zero-support interval when no other foot
is planted. A persistent air voice opens only during that interval, while the
global score continues through the leap. Gravity returns the body to the next
landing. Clearing all four rows removes authorization for the clock: stored
momentum coasts according to the selected surface, then reaches an exact stall.

The live animal stays centered. Footprints and the material field move backward
through time beneath it, so each planted foot appears fixed in world space until
lift-off. All animal drawings are procedural; no historical photographs or
third-party visual assets are included.

## Reading and programming the score

There are four editable rows: left front (LF), right front (RF), left hind (LH),
and right hind (RH). There is no fifth tail lane.

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
thirty-nine entries spanning lateral and diagonal walks, running walk, amble,
tölt, jog, trot, passage, grounded and flying pace, both canter leads,
transverse and rotary gallops, bound and half-bound families, stot, jump,
leap, skid, forward roll, rear up, two-legged dances, species studies, and
Run ×3 · leap.

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
| Skid | RH 15, LH 0, RF 1, LF 2 | four staggered braces and a surface scrape |
| Forward roll | LH + RH 0, RF 12, LF 13 | long flight with a tucked full-body rotation |
| Rear up | hind pair 0 and 8 | both forefeet raised on hind support |
| Rear waltz | hind pair 0, 5, 10 | both front legs can remain in the air |
| Rabbit gallop | LH 0, RH 1, LF 5, RF 7 | hind cluster followed by split fore |
| Giraffe walk | LH 0, LF 2, RH 8, RF 10 | long overlapping supports |
| Lizard scuttle | RH 0, RF 4, LH 8, LF 12 | lateral sequence with body wave |

`Leap`, `Skid`, `Forward roll`, and `Rear up` are explicitly playful
stunt studies, not measured steady gaits. `Run ×3 · leap` is also a
composition: alternating
single-foot running contacts fill cards 0–11, both hind feet launch on card 12,
cards 13–14 fly, and both forefeet land on card 15.

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

The ground is one global material—earth, sand, wood, stone, metal, snow, water,
or crystal—not a different material on every card. Each material changes the
same contact resonator; roughness and hardness color releases, scrapes, and
landings, while rolling resistance changes only an unpowered coast, never BPM.

Level, upstairs, and downstairs are course profiles. Feet land on discrete stair
treads, with touchdown anchors inset from tread edges. The body follows the
continuous average grade of the regular stair course, which avoids a camera and
torso snap when support changes from two feet to one. Switching the entire
course relatches the current stance to the new geometry; after that switch, each
new touchdown keeps its tread until lift-off.

The stair model is an artistic regular-step approximation. It is informed by
the distinction between ascent and descent mechanics, not presented as measured
species-specific stair kinetics:

- Quadruped stair ascent mechanics:
  <https://pubmed.ncbi.nlm.nih.gov/21243173/>
- Quadruped stair descent mechanics:
  <https://pubmed.ncbi.nlm.nih.gov/20630021/>
- Leg compliance as a locomotor control principle:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6550006/>

## Sound mapping and bounds

Every foot has a distinct species-specific articulation family. Left/right and
front/hind contacts differ in oscillator or noise balance, pitch contour,
filtering, decay, and pan. Touchdown sounds the main attack; load and push add
smaller stance accents; toe-off adds a bounded release texture. The selected
surface passes those contacts through one persistent material resonator.

Automatic head music is intentionally muted in this gait-focused pass. Head,
neck, trunk, muzzle, ears, and tail remain visible anatomy, but the rhythm comes
from feet, support, momentum, flight, and landing.

- The motor integrates at 120 fixed steps per second.
- The active score rate is exactly `tempoBpm * 16 / 60` cards per second.
- Position, velocity, height, catch-up time, crossings, and transition counts
  are bounded.
- Audio is procedural and sample-free.
- Output is capped at 0.72; the internal mix enters compression at a fixed
  bounded gain.
- One-shots are capped at 48 and scheduled from motor-predicted crossings on
  `AudioContext.currentTime`.
- The air voice is one persistent bounded source, gated by exact
  `supportCount === 0`.
- Audio and transport stay separate: Play and score editing never arm Audio.
