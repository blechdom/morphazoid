# Quadruped gait-to-sound notes

Quadruped is a playable fiction, not a biomechanics simulator. One repeating
sixteen-frame score drives the whole causal loop:

`touchdown + strength + ground -> stance/flight pose -> percussion -> head phrase`

The live animal stays centered while terrain and notes travel underneath. The
score's top row is an original, procedurally drawn motion-study cabinet strip;
no historical photographs or third-party visual assets are included.

## Footfall rhythm dictionary

Hildebrand-style gait diagrams are the closest scientific analogue to a rhythm
dictionary. They encode touchdown phase and duty factor (how much of the stride
a foot remains grounded). The presets below quantize those continuous
relationships into one musical sixteen-frame loop. Frame numbers are one-based.

| Preset | Touchdowns | Visible timing |
| --- | --- | --- |
| Walk | RH 1, RF 5, LH 9, LF 13 | four even lateral-sequence beats; no flight |
| Amble | RH 1, RF 3, LH 9, LF 11 | lateral order with closer same-side timing |
| Elephant charge | RH 1, RF 4, LH 9, LF 12 | faster uneven single-foot phrase; grounded |
| Trot | RH + LF 1, LH + RF 9 | two diagonal pairs with short suspension |
| Pace | RH + RF 1, LH + LF 9 | two same-side pairs |
| Right-lead canter | LH 1, RH + LF 6, RF 11 | three beats, then suspension |
| Transverse gallop | LH 1, RH 6, LF 9, RF 12 | hind-to-fore crossing order, then flight |
| Rotary sprint | RH 1, LH 3, LF 9, RF 11 | two close pairs with two flight gaps |
| Stot | all four at 1 and 9 | simultaneous land/launch; long flight |
| Jump | hind pair 1, all four land 9 | deliberately theatrical launch and landing |
| Dance | LF + RH 1, RF + LH 9 | alternating two-leg diagonal balances |

The comprehensive terminology review and normalized gait phases support the
Walk/Trot/Pace/Canter/Gallop relationships:
<https://academic.oup.com/icb/article/62/5/1246/6659194> and
<https://doi.org/10.3390/s21196366>. Horse measurements independently describe
walk as four-beat, trot as paired diagonals, and canter/gallop as asymmetric:
<https://doi.org/10.1242/jeb.02611>. The user-supplied Animator Notebook guide
was used as a readable animation cross-check, not as a source of copied art:
<https://www.animatornotebook.com/learn/quadrupeds-gaits>.

Touchdown cells remain editable. For custom scores, each leg's animation derives
its stance, swing, and next touchdown from the nearest active cells. Preset duty
factors set the initial stance length, so a grounded trot and a suspended trot
are not reduced to identical pictures even when their touchdown order matches.

## Animal boundaries

- Elephant exposes Walk, Amble, and grounded Charge rather than presenting a
  biological gallop. A study of more than 2,400 strides found lateral-sequence
  footfalls across speeds and no whole-body aerial phase:
  <https://pubmed.ncbi.nlm.nih.gov/16985198/>. Elephant Jump remains explicitly
  labeled fantasy.
- Unicorn uses horse-like Walk, Amble, Trot, Pace, Canter, and transverse
  Gallop, then adds fantasy Jump and Dance.
- Gazelle uses Walk, Trot, Canter, rotary Sprint, and Stot. A comparative study
  of 351 sequences across 89 mammal species classifies the sampled gazelles as
  rotary gallopers: <https://doi.org/10.1242/jeb.073031>. Stot is an expressive
  simultaneous-four-foot approximation, not a claim about predator signaling.

## Sound and graphic mapping

| Character | Four foot voices | Tail | Head |
| --- | --- | --- | --- |
| Elephant | fore hide slap + hollow knock; hind sub + floor drums | brush/knock | five-point rising trumpet with lifted trunk |
| Unicorn | fore glass + silver bells; hind clop + crystal kick | star shimmer | six-note sparkle-neigh/sneeze from a visible muzzle |
| Gazelle | fore wood tick + stick click; hind low + high marimba | whip | six-note marimba/string zigzag with head toss |

Left/right pairs differ in oscillator family, pitch contour, transient, filter,
and decay as well as pan, so they remain distinguishable on mono playback. The
ground under the animal multiplies those limb identities with earth, wood,
metal, or crystal resonance rather than replacing them.

## Safety and reproducibility

- Audio is procedural and sample-free. Output defaults are 0.60–0.62 under a
  0.72 ceiling; simultaneous contacts are normalized.
- Active one-shots are capped at 48, head voices at 16, and all events schedule
  against `AudioContext.currentTime`.
- Mutation is seeded and bounded to off/soft/loud contact levels.
- Transport and visual editing never arm Audio. Editing auditions a foot only
  when Audio is already on.
