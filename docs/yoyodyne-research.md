# Yoyodyne research notebook — yo-yo dynamics and trick vocabulary
Retrieved 8 September 2026. This is a source-grounded design notebook for the
instrument, not an installed vector database or an autonomous runtime RAG system.
Use the claim IDs below as retrieval anchors. Summaries are paraphrased; the
linked papers and instructors remain authoritative. No tutorial video was
motion-captured or measured, and there is no statistical popularity ranking.

## Main finding

A convincing yo-yo instrument needs changing **support and contact states**,
not just differently shaped playhead curves. Recommended split:
a physical body/string engine plus a skilled performer that schedules throws,
moves hands, sets mounts and decides when to catch. The musical score remains
the contact stream, not a stored series of notes.

## Physics evidence

### P1 — Rotation is not the same as travelling around the hand
Source: [UCSB, Maxwell's yo-yo demonstration](https://web.physics.ucsb.edu/~lecturedemonstrations/Composer/Pages/28.33.html).
A simple no-slip descent couples translation and axle rotation:
`a = g / (1 + I / (m r²))`, with mass m, axle radius r and axial inertia I.
This equation assumes the specific vertical constrained descent; it is not a
universal equation for string tricks. It explains why changing inertia or axle
radius changes descent, and why a freely falling particle with decorative spin
is an incomplete yo-yo model.

Design inference: track position/velocity AND angular velocity, with winding
state coupling them only when the response/axle is engaged. Do not equate the
visible orbit speed with the much faster axial spin.

### P2 — Taut/slack and bottom transitions matter
Sources:
[Jin & Zacksenhouse, ASME 2002](https://doi.org/10.1115/1.1485750),
[author institution abstract](https://cris.technion.ac.il/en/publications/yoyo-dynamics-sequence-of-collisions-captured-by-a-restitution-ef-2/).
Their model separates free motion, constrained motion, bottom and transition
phases. They experimentally examine energy loss from yo-yo/string collisions,
and propose an equivalent restitution simplification. Three yo-yos were used
to verify their models. This is evidence for a hybrid model, not proof that one
restitution number reproduces every modern bearing or trick.

Design inference: a string pulls but cannot push. Use an inactive constraint
while slack, a tensile constraint while taut, and explicit, energy-losing
transition handling. Never silently reverse the spin merely because height
starts decreasing.

### P3 — A spring/damper with zero slack tension is defensible
Source: [Nemoto et al., 2014, full paper](https://www.jstage.jst.go.jp/article/tjsst/6/1/6_1/_pdf/-char/ja),
DOI 10.11308/tjsst.6.1.
The paper develops a two-dimensional yo-yo model that includes string
inclination, slack and changing effective axle radius due to winding thickness.
Its spring/damper treatment distinguishes tension from slack and is compared
against measurements. Its detailed non-sleeping model does not automatically
supply modern unresponsive binds, knot topology or all competition tricks.

Design inference: a bounded unilateral compliant tether is a sensible MVP
starting point. Add winding/bearing states explicitly instead of attributing
their behavior to an ordinary elastic cord.

### P4 — The performer should react, not simply replay
Source: [Jin & Zacksenhouse, Robotic Yoyo Playing With Visual Feedback, 2004](https://doi.org/10.1109/TRO.2004.829478);
[author-uploaded paper](https://www.researchgate.net/publication/3450080_Robotic_Yoyo_Playing_With_Visual_Feedback).
The authors use state estimation and switching control to time the robot's
activation, and test stabilization experimentally. The paper focuses on
rotational/vertical motion; swinging, yaw and pitch are outside that control
model. It does not provide a ready-made virtuoso trick controller.

Design inference: “skill” should mean catch timing, alignment and feedback
correction within finite hand speed/acceleration, rather than arbitrary force
attraction to the next note. Misses and corrective motions can be expressive.

### P5 — Browser-sized rope simulation
Sources: [Macklin, Müller & Chentanez, XPBD, 2016](https://matthias-research.github.io/pages/publications/XPBD.pdf);
[Macklin et al., Small Steps, 2019](https://matthias-research.github.io/pages/publications/smallsteps.pdf).
XPBD gives constraints an explicit compliance and force estimate, reducing the
stiffness dependence on the solver's iteration/time-step choices. Small Steps
shows benefits of smaller simulation steps for constrained examples.
Neither paper validates yo-yo binds, collision acoustics or this instrument.

Recommendation: retain a fixed 240 Hz simulation clock; prototype 16–24 rope
particles with unilateral stretch constraints, moving hand anchors and a
separate axial-spin variable. Tune substeps using pendulum/energy tests.
Use swept collision for fast tine strikes; small steps alone are not a
guarantee against tunnelling. XPBD is proposed, not yet implemented in the
first assisted Yoyodyne slice.

## Familiar and useful techniques

These are established teaching-curriculum examples, not a measured popularity
chart. Musical mappings in the last column are our inventions.

| Technique / primary lesson | Actual mechanism | Proposed orchestral behavior |
| --- | --- | --- |
| [Around the World](https://yoyoexpert.com/pages/105-looping-around-the-world) | Forward launch, controlled circular swing, return to hand; speed is practiced | Broad ring sweep and a fast flourish |
| [Walk the Dog](https://yoyoexpert.com/pages/007-basic-walk-the-dog-classic) | Strong sleeper placed on a surface; spin and ground contact propel it | Low rolling traversal, successive gentle tine hits |
| [Rock the Baby / Cradle](https://yoyotricks.com/yoyo-tricks/rock-the-baby/95/) | Two hands form a triangle; yo-yo rocks through it | Alternate two or three nearby voices |
| [Trapeze](https://yoyoexpert.com/pages/018-intermediate-man-flying-trapeze-classic) | Breakaway swings around a finger and lands on a string segment | Catch accent, suspension, then a short release phrase |
| [Eli Hops](https://yoyoexpert.com/pages/042-advanced-eli-hops-classic) | Launch from trapeze by spreading hands, then catch on string | Large isolated leap, silence in flight, accented landing |
| [Boing-E-Boing](https://yoyoexpert.com/pages/037-advanced-boing-e-boing-classic) | Rhythmic hand motion bounces the yo-yo between aligned string segments | Repeated interlocking hits between two zones |
| [Bind return](https://yoyoexpert.com/pages/030-intermediate-bind-returns-classic) | String fed into the gap engages an unresponsive yo-yo's return | A visible ending gesture and upward closing flourish |

A stationary sleeper should not retrigger a tine just because the disc is
spinning. We may later add an explicit rubbing/bowing surface, but it must be a
different contact instrument rather than hidden repeated note-on events.

### Terminology trap — “string tension”
[YoYoExpert's string-tension lesson](https://yoyoexpert.com/pages/017-intermediate-string-tension-classic)
uses the term for twist/tightening of the string as well as its playing
consequences. Mechanical tensile force, rope compliance and string twist are
different quantities. Label the current motor control **Guidance**, not
“Tension”; reserve tension for measured pulling force and twist for twist.

## Recommended model, in stages

1. **Immediate playable slice:** remove the timeline; use actual swept contacts,
   finite mass/velocity, gravity, slack/taut tether and optional zone restitution.
   Use explicitly named motor assistance to keep gestures playable. Separate
   three acoustic materials and replace the formant choir.
2. **Physical performer:** let actions target hands and mounts, not body
   coordinates. Add free/unwinding/sleeping/mounted/binding/rewinding states,
   spin drag, response engagement and a feedback-controlled catch.
3. **Real trick grammar:** introduce an ordered set of string contacts:
   throw hand -> optional finger/mount nodes -> axle -> return branch.
   Trapeze and cradle must change that geometry. Walk the Dog requires a
   surface-contact/rolling state; it must not merely be an ellipse preset.
4. **Virtuosity:** chain successful throws, mounts, hops and catches using
   observed position/spin/contact state. Tempo controls the performer's intent;
   actual impacts may lead, lag or fail. Density and register follow movement.

Do not start by solving arbitrary knots, full self-contact or 3-D gyroscopic
precession. Those are materially larger projects than this browser MVP.
Keep an assisted musical mode alongside a physically stricter mode if stricter
simulation makes prescribed all-tine sweeps impossible.

### Proposed state flow
`held -> throw/unwind -> sleep/swing -> mount or roll -> release/bind -> rewind -> catch`
Slack can occur between several states; it is not just a once-per-cycle phase.
A missed catch leaves the body in valid motion rather than teleporting it.

### Contact-to-sound
Use normal relative speed for a physical bounce; a pass-through sound zone may
use traversal speed. Derive velocity and upper-mode excitation from the accepted
contact; pan follows position. Re-arm a zone only after exit plus hysteresis.
Striking multiple zones is allowed, but a solid obstacle can occlude contacts
behind it. A projected overlap does not mean a literal physical chord.

## Tests that distinguish physics from animated paths

- Move a tine out of the path: its sound must disappear.
- With no guiding input, a slack body falls; a taut pendulum swings.
- A string never applies compressive force and extension stays bounded.
- An unresponsive sleeping yo-yo must not return from an ordinary tug.
- Engaging a bind transfers available spin into return motion and loses energy.
- A catch must depend on position, approach and alignment.
- Walk the Dog responds to contact friction; cradle supports actually move.
- Stop should release sound smoothly; live trick edits preserve motion and tails.
- Halving the simulation step should give similar trajectories and contact order.
- Compare hand/mount gestures visually against the cited tutorials; have a
  yo-yo player review fidelity before calling any mode physically authentic.

## Status / limits

This notebook records an earlier tine/contact proposal. Its experimental
modules remain local to the development worktree and are not part of this
published instrument. The current page instead uses `src/yoyodyne.js` and the
kinetic string DSP: a compliant tether, coupled payout/spin, a lossy bind
approximation and prescribed cradle geometry drive continuous sonification.
See [the current model contract](yoyodyne-kinetic.md). Full 3-D orientation,
rope-particle self-contact, arbitrary mounts and validated response-pad
behavior remain unimplemented. No mode claims physical authenticity.
No full article, tutorial transcript, image, video or third-party code has been
copied into the repository. Sources were retrieved for grounded paraphrases and
design decisions; no runtime network/model dependency is added.
