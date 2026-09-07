# Quadruped gait-to-sound notes

Quadruped is a playable locomotor fiction, not a biomechanics simulator. Its
sixteen cabinet cards are gait phases, and the feet are the clock:

`stance + foot strength -> push -> momentum -> crossed card -> percussion + head note`

Supported feet create bounded traction. Flight contributes no drive: the score
can only coast on stored momentum while gravity moves the body toward its next
landing. With every foot cell clear, velocity decays to an exact stall; tail
cells never propel it. The live animal stays centered while its compact ground
score travels underneath. All cabinet drawings are procedural; no historical
photographs or third-party visual assets are included.

## Shared gait dictionary

Hildebrand-style diagrams describe both touchdown phase and duty factor (the
fraction of a cycle a foot remains grounded). The authored presets quantize
those relationships into sixteen editable cards. A shared dictionary is
available to every animal; `playful transfer` marks an unlikely pairing rather
than hiding it.

The dictionary includes lateral- and diagonal-sequence walks, running walk,
amble, tölt, jog, trot, passage, grounded and flying pace, both canter leads,
both transverse and rotary gallop leads, bound, both half-bounds, stot, jump,
charge, two-legged dances, carousel, feline prowl/gallop, giraffe walk/grounded
rotary, three lizard patterns, and the composed Run ×3 · leap phrase.

| Study | Zero-based touchdown cards | Stance / flight character |
| --- | --- | --- |
| Walk | RH 0, RF 4, LH 8, LF 12 | even lateral sequence; long overlap |
| Diagonal walk | RH 0, LF 4, LH 8, RF 12 | diagonal sequence; long overlap |
| Trot | RH + LF 0, LH + RF 8 | diagonal pairs; two floats |
| Pace | RH + RF 0, LH + LF 8 | same-side pairs; grounded or flying variant |
| Right canter | LH 0, RH + LF 4, RF 8 | 4, 4, 8 card onset spacing |
| Right transverse gallop | LH 0, RH 3, LF 7, RF 10 | gathered flight |
| Right rotary sprint | RH 0, LH 3, LF 8, RF 11 | two flight windows |
| Bound | LH + RH 0, LF + RF 8 | paired hind and fore contacts |
| Stot | all four 0 and 8 | simultaneous launches |
| Jump | hind 0; RF 9, LF 10; hind recover 13 | hind launch, fore-first landing |
| Rear waltz | hind pair 0, 5, 10 | front legs stay in the air |
| Cat prowl | RH 0, RF 3, LH 8, LF 11 | quiet overlapping paws |
| Giraffe walk | LH 0, LF 2, RH 8, RF 10 | long overlapping supports |
| Lizard scuttle | RH 0, RF 4, LH 8, LF 12 | lateral sequence plus body wave |

`Run ×3 · leap` is explicitly a composition rather than a claimed steady
animal gait: three alternating four-foot run clusters occupy cards 0–11, both
hind feet launch on card 12, cards 13–14 fly ballistically, and both forefeet
land on card 15. The loop boundary supplies the landing compression and next
run.

Useful gait sources:

- Modern Hildebrand terminology and sequence/couplet distinctions:
  <https://academic.oup.com/icb/article/62/5/1246/6659194>
- Measured horse walk, trot, canter, and gallop:
  <https://journals.biologists.com/jeb/article/210/2/187/17107/Gait-characterisation-and-classification-in-horses>
- Measured canter's characteristic 1:1:2 onset intervals:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC11776444/>
- Bound, half-bound, and gallop distinctions:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC4262343/>
- Stot/pronk synchronization:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC10498029/>
- The user-supplied animation guide was a readable cross-check, not a source of
  copied art: <https://www.animatornotebook.com/learn/quadrupeds-gaits>

## Species evidence and playful boundaries

- Elephants retain lateral-sequence footfalls across speeds and do not enter a
  whole-body aerial phase. Aerial elephant studies are therefore marked
  playful: <https://pubmed.ncbi.nlm.nih.gov/16985198/>.
- Gazelles are a strong visual fit for rotary gallop and stot, while unicorn
  locomotion is deliberately unconstrained fantasy:
  <https://pubmed.ncbi.nlm.nih.gov/22933611/>.
- Domestic-cat walking uses a lateral sequence. Cats can use rotary,
  transverse, and half-bound gallops; jumping is hind-driven and lands forelimb
  first: <https://journals.physiology.org/doi/full/10.1152/jn.00524.2013> and
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6857581/>.
- Fast cheetah rotary gallop alternates gathered and extended flight while its
  flexible spine flexes and extends:
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC8099890/>.
- Adult giraffes have been observed using a grounded rotary gallop, skipping
  trot, canter, and pace; neck motion is partly isolated from trunk pitch:
  <https://pubmed.ncbi.nlm.nih.gov/30775166/>. Their walking neck dynamics are
  coupled to locomotion: <https://pubmed.ncbi.nlm.nih.gov/30510118/>.
- Lizards are diverse rather than one gait type. The presets contrast
  pace-like, lateral-sequence, and diagonal-trot coupling and add an explicitly
  playful hind-leg sprint. A gecko-style lateral body wave follows locomotor
  phase: <https://pmc.ncbi.nlm.nih.gov/articles/PMC9271186/> and
  <https://pubmed.ncbi.nlm.nih.gov/32279015/>.

The exact sixteen-card locations and synthesis mappings are supported
approximations for play, not measurements reported by those papers.

## Sound and graphic mapping

| Character | Feet / tail | Frame-locked head melody |
| --- | --- | --- |
| Elephant | hide, hollow, sub, floor drums / brush | segmented rising trumpet; trunk lifts |
| Unicorn | glass, silver, clop, crystal / shimmer | sparkle-neigh; muzzle and horn answer |
| Gazelle | wood, stick, low/high marimba / whip | marimba-string zigzag; head tosses |
| Cat | felt, paw, cushion, soft thump / swish | purr-meow contour; whiskers pulse |
| Cheetah | claw, dry slap, launch, sprint / rudder | rapid chirp contour; spine flexes |
| Giraffe | long knock, bone bell, wood bass, hollow hoof / tuft | bowed neck-harp harmonics |
| Lizard | claw, scale, sand, stone / drag | filtered hiss-clicks; tongue flicks |

Automatic head melodies emit one note only when the motor crosses that note's
card; they cannot outrun a slowing or stalled animal. Existing acoustic tails
may decay after motion stops. Manual HEAD audition remains an explicit
performer gesture. Left/right feet differ in oscillator, contour, transient,
filter, and decay as well as pan, so they remain distinguishable in mono.

## Bounded motor and audio

- The stride flywheel advances at 120 fixed steps per second with bounded
  velocity, height, time catch-up, crossings, and transition events.
- Animal profiles change mass, power, compliance, rolling resistance, and
  cadence feel; gait state changes preserve current position and momentum.
- Gravity controls ballistic height and landing energy. Compression and body
  vibration come from contact/landing state, not a decorative oscillator.
- Audio is procedural and sample-free. Output is capped at 0.72, simultaneous
  contacts are normalized, active one-shots are capped at 48, and scheduling
  uses `AudioContext.currentTime`.
- Audio and transport remain separate. Play, editing, and silent locomotion do
  not arm Audio.
