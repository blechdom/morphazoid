# Domino Run research — 2026-09-30

Sources were read directly. Video titles/descriptions and two official thumbnails were inspected; no video motion was watched. No source code or imagery was copied into the project. Implementation suggestions below are distinct from source facts.

## Practical mechanics

**Lines, spacing, turns.** Domino-play describes straight lines, gradual turns, paired split-offs, diamonds, and removable safety gaps. Curves reduce contact overlap and have tighter gaps on the inside. Its example dimensions/angles are particular builder advice, not universal thresholds. Implement orientation along the path and reachable contact checks using height, thickness, direction, lateral overlap and elevation. A gap must be able to stop a run. Van Leeuwen's model has a minimum viable gap and a maximum speed near that gap; arbitrarily dense spacing does not accelerate forever.

- http://www.domino-play.com/TopplingBasic.htm
- https://arxiv.org/abs/physics/0401018
- https://arxiv.org/html/physics/0401018v1 (especially sections 10–11)

**Forks, merges, crossings.** The basic split places two nearly adjoining targets in front of one incoming line, then directs their successors outward. H5 separately lists crossover and bridge techniques. Implement a striker overlapping both targets, with bounded transfer shared among contacts. Separate crossings by elevation when desired. Proposed merge rule: first arrival starts the common standing domino; subsequent collisions can make impacts but cannot start its fall twice. That rule is a simulation choice, not a verified tutorial mechanism.

- http://www.domino-play.com/TopplingBasic.htm
- http://www.domino-play.com/TopplingIntermediate.htm
- https://youtu.be/6sZlymQf_8w (H5: How to Build Domino Crossovers; metadata verified)
- https://youtu.be/GFbwDfJk7KM (H5: 10 Tricks with Half-Bridges; metadata verified)

**Ascent/descent.** Domino-play describes stable gently sloping ramps, crossing ramps, and split ramps. Its example angle advice is not a universal maximum. H5 describes Sonimod Staircase as making a sonimod line fall upward. The official thumbnail shows horizontal crosspieces on successively taller upright post/tower supports; it is not ordinary upright dominoes on stairs. The transfer sequence was not observed. Implement a simplified supported staircase with actual relative floor heights and reach checks. Rising targets need reachable contact and sufficient torque; descending targets can be missed or struck low. Draw supports under elevated pieces. Do not call unconditional graph propagation on decorative z coordinates validated physical stairs.

- http://www.domino-play.com/TopplingIntermediate.htm
- https://youtu.be/N1DXFClimFw (Sonimod Staircase; metadata verified)
- https://i.ytimg.com/vi/N1DXFClimFw/hqdefault.jpg (static thumbnail inspected)

**Growing/shrinking dominoes.** Van Leeuwen's Domino Magnification studies increasing sizes and distances with fixed shape ratios. Successful transfer needs both contact geometry and enough energy to pass a potential barrier. Assumptions include fixed ground pivots/no sliding, sustained inelastic contact, and no mutual friction. There is no universal maximum growth ratio. Characteristic time is sqrt(I/(m*g*h)); each scale-similar stage takes sqrt(r) times longer as size grows by r. A rectangular block pivoting at its base has I=m*(h*h+d*d)/3. Conservative gradients, mass/inertia-aware transfer and size-sensitive timing are reasonable implementation choices. Reversing scale can accelerate the sequence, but a larger block can miss or land on a small target; the paper does not independently validate arbitrary shrinking layouts.

- https://arxiv.org/abs/1301.0615
- https://arxiv.org/html/1301.0615v1 (J. M. J. van Leeuwen, Domino Magnification, submitted 2013)

**Patterned fields/tapestries.** Domino-play describes colored tiles forming pictures and patterns. H5 offers Circle Field and fieldstarter tutorials. Implement connected rows/radial lanes with a visible branching starter or explicit multiple starts. Color may map to material/note. Per-piece state should leave visible remnants where a chain fails. Bound active audio voices and graphics separately. A global scanning animation is not evidence of local collision propagation.

- http://www.domino-play.com/TopplingAdvanced.htm
- https://youtu.be/VxPUTQgybfg (Circle Field; metadata verified)
- https://youtu.be/LXL68gus3SU (10 Tricks with Fieldstarters; metadata verified)

**Materials/friction.** Builder advice favors a flat hard support over carpet. Papers distinguish floor friction, which prevents sliding, from mutual face friction, which dissipates energy/slows transfer. Inelastic impact is a major energy loss. Low strikes can encourage sliding instead of tipping. Implement floor grip separately from contact loss, mass/inertia and acoustic damping. Wood/plastic/stone/metal attack and ringing envelopes are musical synthesis choices: these sources do not provide measured spectra or validate authentic material sound. Bound audio output independently of simulated energy.

- http://www.domino-play.com/TopplingBasic.htm
- https://arxiv.org/html/physics/0401018v1 (sections 8, 10–11)
- https://arxiv.org/html/1301.0615v1

## A real Stonehenge Trick exists

H5 Domino Community lists a five-domino Stonehenge Trick with a slow toppling effect. Its official thumbnail was inspected: two offset flat base pieces, two upright posts, and one horizontal lintel spanning them. This confirms static geometry, not the time-ordered support/transfer behavior. Keep a plain stone-circle Tone Henge preset distinct from a future five-piece collapsing portal module; do not call the circle an authentic reconstruction of the H5 trick.

- https://hevesh5.com/tutorials
- https://youtu.be/uepLOmh37_I (How to Build the STONEHENGE Trick in Dominoes)
- https://i.ytimg.com/vi/uepLOmh37_I/hqdefault.jpg (static thumbnail inspected)
- https://www.hevesh5.com/specialty-tricks-gallery?format=json (verified primary title, description and original video URLs; some individual gallery routes render only a shell)

Other verified slow-action inspirations: Piano Technique https://youtu.be/OkfhvF543no and Slowstones/Sideways Slowstones https://youtu.be/ouEjtTtCZuM. Metadata verified; mechanisms not watched.

## Verification boundaries

A directed event/collision model with reach, height and transfer checks is a useful musical approximation. It is not a full rigid-body simulation, an experimentally calibrated friction solver, or a measured acoustic model. Test observable behavior: broken gaps, actual forks, first-arrival merges, stair support/reach, and size-sensitive timing. Listening and interaction acceptance remain separate from automated checks.
