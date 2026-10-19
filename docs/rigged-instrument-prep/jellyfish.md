# Jellyfish — proposed bell-and-tentacle instrument

**Status:** design, not implemented. Suggested ID/route:
`jellyfish` / `jellyfish.html`. This is a single articulated translucent
performer, not an animal-call emulator or a watery animation behind a keyboard.
Like Gesticules, its shape can be held and its movement can play; unlike
Gesticules, pressure in one bell excites several coupled elastic voices.

**One action:** press into the 3D bell and release it. The dome visibly
compresses/rebounds; one pressure-driven swell blooms into six resonant
tentacles. Pull one tentacle and *that sounding resonance* changes.

## Performer → model → sound

| Gesture / visible change | Model quantity | Audible consequence |
| --- | --- | --- |
| Squeeze/release the bell | Compression 0–1 and positive/negative speed | Excites a soft filtered-noise/modal swell; release has its own tail |
| Pull a tentacle tip out | World-space effective length | Lowers its continuous frequency/lengthens its decay within limits |
| Curl a tentacle | Integrated bend along its joints | Changes its comb/chorus color; visible wave follows the same bend |
| Steer the current vector | Bounded force and resulting joint motion | Slow pitch/filter drift and apparent travel across voices |
| Tap one tentacle | Stable tentacle ID, local velocity | A short bright excitation of *its* resonator |
| Start/stop Pulse | Bell compression on a shared audio-clock cycle | Repeating swells with editable phase; no note-grid sequencer |

The synthesized underwater texture is an expressive invention: pressure is
used as an exciter, with damped modes and short, protected feedback delays
as the tentacle voices. A tentacle at rest must not emit continuous loud sound
simply because it is rendered. Keep a restrained held **Sound** audition and
an independent **Pulse** motion transport; Audio alone never starts Pulse.
Manual squeeze/tap remains playable while Pulse is stopped.

## 3D rig and first slice

- Procedural bell with eight radial deformation controls and six spline
  tentacles with four or five bounded joints each. Keep each tentacle's stable
  ID, authored rest length and selected point visible; manipulate the tip
  with a screen-plane drag plus a labelled depth control. A light, propagated
  deformation animates the mesh from the same joint state the audio reads.
  No licensed model is needed for the first slice; a later GLB needs rig,
  materials and provenance reviewed like the hand/roach assets.
- Begin with one bell, two audible tentacles, press/release and one tip drag;
  add the other four voices and current/Pulse only after that path is clear.
  Default Audio off, Pulse paused, moderate output, a visible jellyfish and
  no automatic ambient recording. Camera orbit/zoom must not change physical
  tentacle length or pitch.
- Three later complete scenes to test separation: "Long current" (slow
  breath and sustained low tails), "Needle rain" (short independent taps),
  "Backwash" (opposed bell phase and curled, colored resonators). Scene changes
  preserve Audio arm, output, Pulse state/phase and custom camera. Offer
  bounded random shapes with a reproducible seed.

Prototype ceilings: one bell, six tentacles, ≤5 joints per tentacle,
≤8 sustained audio voices and ≤24 admitted taps/s. Rate-limit/graduated
smooth the current and geometry messages before they reach audio, not by
blocking UI; keep visual pixel budget independent of the audio scheduler.
Stops, page hide and errors release sound/animation resources. A keyboard
selection and labelled Bell/Tip/Current controls must play the same model
without precision raycasting.

**Acceptance scenes:** squeeze depth and speed separately affect excitation;
a held press does not emit retriggering attacks each video frame; releasing
allows a bounded tail; pulling tentacle 2 changes its measured pitch but not
tentacle 1's stable identity; Pulse while Audio off animates silently;
manual gestures neither turn on Audio nor start Pulse; orbit-only motion
leaves DSP unchanged; fast alternating press/release, cancel and preset
changes do not click or leak voices. Verify desktop and both phone
orientations, then human-listen to bell, isolated tentacles and complete mix.

**Evidence boundary:** there is no claim here that real jellyfish sing, that
tentacles are acoustic strings, or that this is a fluid-dynamics simulation.
Research anatomy before any realism claims; keep water motion and timbre
labelled as artistic sonification.
