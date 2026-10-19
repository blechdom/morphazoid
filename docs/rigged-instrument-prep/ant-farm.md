# Ant Farm — proposed rigged-colony instrument

**Status:** standalone route is proposed, not implemented. The shared
[Rig Lab](../../src/pages/rig-lab.html) displays only the two approved
downloaded ant rigs, with three actor copies. Food/trail/gate/chamber state
influences paths or sound but **does not draw a habitat**, food marker, tunnels
or gate. Suggested ID/route: `ant-farm` / `ant-farm.html`. Keep it separate from Roach Synth, Spider Synth
and Habit Habitat: the player sculpts a *physical, audible tunnel network* that
independent ants traverse rather than programming abstract transition weights
or a single insect's pose.

**One action:** drag a food marker or brush a trail; ants reroute through a
transparent three-layer 3D habitat. Each actual foot contact makes a quiet
substrate tick, and an ant entering a chamber excites that chamber's pitched
resonance. The passing colony creates a pattern that remembers recent routes.

## Performer → model → sound

| Gesture / visible change | Model quantity | Audible consequence |
| --- | --- | --- |
| Move food; ants turn toward it | Target position and bounded route attraction | Alters *which* junctions sound, not an arbitrary master pitch |
| Brush a trail on an existing tunnel | Trail strength 0–1, fades over time | Raises that route's selection probability and repeat frequency |
| Open/close a gate | Edge enabled state, latched at next junction | Redirects later hits; gate contact itself is a short click |
| Stretch a tunnel in world space | Path length | Changes travel time between attacks, not the camera orbit |
| Widen a chamber | Radius/volume proxy | Lowers its continuous resonant pitch and lengthens a bounded decay |
| Guide one selected ant | Stable actor ID and its walking/antenna pose | Footfalls follow planted feet; antenna contact gives a tiny accent |
| Hold ant over a chamber | Actual entry/contact | One audition attack; do not retrigger on every render frame |

Footsteps are designed amplification of substrate contacts, not an assertion
that ants make audible music. Use a filtered impulse per planted foot plus
one or two lightly coupled chamber modes; no default cockroach audio samples.
Give a **Chamber tone** hold/solo audition that plays the same chamber model,
not an unrelated synth pad. Keep the initial sound sparse.

## Stage, rig and clock

- For a future standalone instrument, a transparent aquarium with connected tunnel curves,
  chambers, gates and exactly three visible depth layers. Show selection and
  pheromone/trail decay in-world. Camera orbit/zoom is separate from geometry;
  offer front/side/layer views so ants do not disappear behind soil.
- The lab starts with three instances of the downloaded, skinned rayray and
  Msassasa ants, not original low-poly workers. Animate gait
  from distance travelled and calculate foot strike from planted-leg contact,
  not a free-running sound oscillator. Ground-contact identity stays attached
  to the ant across route edits. Full high-detail skins or a queen are later
  decisions; do not reuse the Roach Synth specimen as an ant.
- One bounded route model and seeded selection supply both visible ant movement
  and timestamped entry/contact events. Use an audio-clock scheduler; viewport
  refresh only samples/interpolates. Route edits affect the next junction:
  an ant already inside a tunnel finishes that edge, never teleports. Trail
  strength decays by simulation time even if no frames render.
- **Walk** starts/stops autonomous route choices; manual ant guiding works
  while Walk is paused if Audio is armed. Audio off leaves Walk visual and silent;
  rearming never plays missed footsteps. Reset restores the seed, trails,
  tunnels and actors, but does not secretly arm Audio or change output level.

## Smallest playable slice

Three ants, two chambers, four junctions, one movable food marker, one gate,
and one trail brush. Default Walk paused, Audio off, moderate output; a guided
ant makes a recognizably different foot contact and chamber entry. A single
**Start walking** action creates a different repeating route without a generic
step sequencer. First presets should contrast "Foot traffic" (dry contacts),
"Resonance nest" (sparse chamber entries), and "Reroute" (strong trails), not
different master levels. Preset recall keeps walking phase and manual camera.

Initial budgets to validate: at most 8 ants, 12 chambers, 32 tunnel edges,
64 admitted contacts/s, 12 ringing voices and a 100–120 ms scheduling window.
Coalesce/downgain too-dense simultaneous feet instead of allocating an audio
node per leg every frame. Reassess only with measured browser/phone data.

**Acceptance scenes:** with the same seed, route and contact timestamps
reproduce; closing a gate reroutes future ants but never mutes a ringing
chamber or teleports an ant; steering ant 2 does not relabel ant 1's voice;
fast motion does not skip a gate/chamber crossing; Audio off is silent while
Walk continues; Audio on alone does not start Walk; after pause, reset,
visibility change and `pagehide`, no orphaned events/nodes/listeners remain.
Test stage dragging and keyboard/native access in desktop, portrait and short
landscape; listen separately to foot contacts and chamber resonance.

**Evidence boundary:** real ant navigation and pheromone behavior need
species-specific research before any biological copy; the initial trail
attractor and amplified footsteps are explicitly a musical colony simulation.
The ant downloads remain CC BY 4.0 and require attribution; the artistic
footstep and chamber audio is authored separately.
