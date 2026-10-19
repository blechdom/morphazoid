# Pancakes — proposed sticky skillet instrument

**Status:** six-cake sketch on the shared [Rig Lab](../../src/pages/rig-lab.html);
not a standalone `pancakes.html` instrument. Preserve the requested comedy and tactility:
**frying pan, flipping pancakes, syrup poured on top, butter sizzling, and
sticking them to things**. Sound comes from visible contact and material change,
not kitchen samples playing over an unrelated sequencer.

**One action:** scoop a pancake with the spatula, drag it to the plate or
press **Stack on plate**, then pour a fresh pancake into the empty pan.
Each cake keeps its own identity, syrup coverage and ordered plate layer.
Flip a pancake in the pan: it tumbles in 3D and makes one timed landing.
Butter already touching the hot pan sizzles between strikes; syrup changes
what happens when the next sticky pancake is lifted.

## Performer → model → sound

| Gesture / visible change | Model quantity | Audible consequence |
| --- | --- | --- |
| Tilt/shake pan by its handle | Pan angle/velocity, sliding contact | Scrape pace and spectral roughness follow real sliding speed |
| Scoop/flick pancake with spatula | Release velocity, spin, swept collision | Flight is mostly quiet; landing excites pan/pancake impact modes |
| Add butter onto the hot surface | Butter amount, contact area, heat 0–1 | Bounded stochastic micro-sizzle; cool/empty pan stays quiet |
| Pour syrup by drawing a line on pancake | Visible trail/coverage and viscosity proxy | Darkens subsequent contacts and increases adhesion/peel length |
| Press it onto pan rim, plate, wall or another pancake | Contact patch and syrup-dependent latch | A sticky hold; pulling past threshold emits a finite stick–slip peel |
| Stack two pancakes | Shared contact/coupling | Lowers/damps the next landing without changing master level |

Butter sizzle, elastic impacts and wet peels may be procedurally synthesized
with filtered noise, short impulses and bounded resonant modes. Use timestamped
model contacts; do not trigger a landing merely because a sprite briefly
overlaps a pan in a display frame. "Sticky" is deliberate playable cartoon
physics, not a measured syrup adhesive model.

## Stage, rig and cooking time

- For a later standalone route: a deformable skillet/pancake rig with handle pivot,
  flexible pancake disk and
  visible rim, spatula hinge, butter patch, raised plate and a small vertical
  sticking surface. Pancake mesh deforms from fold, pan impact and gravity.
  Syrup is an editable glossy trail on the pancake; it stays attached when
  the pancake flips, not painted onto the camera. Show the contact patch,
  butter amount and attachment clearly; no decorative sizzle if it is silent.
- The shared Rig Lab draws **only approved downloaded models**: one pan, four
  separate source cake meshes reused for up to six pancakes, a pickable
  spatula, separate butter and syrup meshes, and a plate from the stack.
  There is **no visible wall or syrup bottle**, and wall sticking is not
  offered in the lab.
  Scoop/stack/peel/return have buttons as keyboard/touch alternatives; moving
  the spatula over the plate stacks the held cake. Layer height and a short
  plate impact follow the same transition. The butter pat is visible on the
  stack and pan butter drives heat-dependent sizzle. Cake syrup persists
  through the transfer. These are authored transitions, not continuous
  spatula collisions or physically simulated batter/fluid.
- A **Cook** transport advances heat/butter/syrup time while manual grabs and
  flips still work when Cook is paused. Pause stops heat progression, not a
  mid-flight pancake: let an existing flight land, then hold the scene.
  Audio off does not pause cooking; rearming never replays missed landings.
  Reset restores materials, contact state, rig pose and seeded sizzle without
  changing Audio/output. Orbiting the camera never fries or flips a pancake.
- Later complete scenes should demonstrate different mechanisms: "First
  flip" (pan transients), "Butter bath" (continuous heat texture) and
  "Ceiling breakfast" (syrup/latch/peel). Do not use different sample banks
  to disguise the same gesture with three labels.

The current preview caps cakes at six and audio at ten voices. Future instrument
ceilings to test: ≤8 active contacts, ≤128 syrup-trail
points per pancake, ≤64 admitted sizzle micro-events/s, ≤10 audio voices,
bounded heat/adhesion/ballistic speeds, and stable IDs for objects and voices.
In a future standalone build, use swept collision against pan/plate/wall, smooth heat/syrup edits and ramp
sound on detach. Audio events run on the audio clock, not a graphics timer.
Provide keyboard/native alternatives for Flip, Pan tilt, Butter, Syrup,
Attach and Peel, plus a visible selection/focus indicator on the stage.

**Acceptance scenes:** a flip has silence in free flight and one event per
actual landing; varying flick speed changes impact; butter at zero or heat at
zero makes no sizzle even with Cook running; pouring syrup changes the next
contact/peel, not the master filter; a stuck pancake is visibly still and can
be peeled, including after camera orbit; pausing mid-flight lands safely;
fast tilt and low frame rate do not miss rim collisions; Audio off and
Play/Cook remain separate; repeated reset/visibility changes leave no stuck
voices or listeners. Verify desktop/phone gestures and isolate sizzle, impact
and peel in a human listening pass.

**Evidence/asset boundary:** this is an invented playable kitchen. The lab's
visible assets are attributed CC BY downloads; no food recordings are included.
Future assets still need source and license documentation. Acoustic and
food-science claims require evidence, not cartoon controls.
