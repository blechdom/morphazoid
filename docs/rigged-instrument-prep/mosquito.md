# Mosquito — proposed flying-tone instrument

**Status:** playable textured mosquito/wing-tone prototype on the shared
[Rig Lab](../../src/pages/rig-lab.html), not a complete independent route.
The downloaded [Mosquito by adarshktk](https://sketchfab.com/3d-models/mosquito-474d2ea54af64114b2b5b1d2f6b18f8a)
is CC BY 4.0. It has no original skeleton or animations. Blender conversion
at `scripts/rig-lab/rig_mosquito.py` authored a new 21-bone skinned derivative
with separate wing hinges, six two-joint legs, a probe, head, antennae and
abdomen and scaled its 4K maps for the browser. It follows the audio-driving
pose at runtime; when it cannot load, the Rig Lab 3D stage is **empty**, with
sound controls still available. See [model attribution](../../assets/rig-lab/SOURCE.LICENSE.txt).
Suggested later ID/route: `mosquito` / `mosquito.html`.
**Separate from Moth, Roach Synth and Ant Farm.**
One steerable mosquito is an airborne, continuously sounding pitch gesture;
it does not inherit a cockroach's sound bank, an ant colony's contact rhythm,
or a moth's brushable wing membranes.

**One action:** grab the thorax and steer a hover in 3D. Its wing-hinge control
sets the audible carrier rate while its actual flight path moves the sound in
space. Pull the wing control to bend the tone without changing the flight path;
draw a path to let the same gesture recur over time.

## Performer → model → sound

| Gesture / visible change | Model quantity | Audible consequence |
| --- | --- | --- |
| Drag body in world space | Position and velocity, sampled from the same flight model | X steers stereo; proximity and speed change airiness/level, not automatic notes |
| Adjust paired wing hinges | One stroke phase, bounded rate and amplitude | Continuous pitch and harmonic/noise balance follow the *sounding* stroke |
| Curl a selected leg (six independent bones) | Bound leg bend from -1 to 1 | Increased filtered air noise and brightness; the wing pitch remains stable |
| Offset left/right strokes slightly | Phase/rate separation | Slowly beating, narrow stereo difference; reset to a stable unison |
| Tilt body into/out of flight direction | World-space yaw/roll | Filtered/unfiltered mix changes visibly with wing exposure |
| Draw and replay a 3D hover path | Anchors, normalized phase and height | A repeatable pitch/space contour: height offsets the wing-rate target smoothly |
| Touch a suspended glass ring with the proboscis | Actual tip-to-ring contact and velocity | One brief tuned contact ping; no bite or blood-feeding simulation |

Use an audio-clock wing phase driving a bounded harmonic-plus-air-noise source.
The visible wings sample that *same* phase; render them as a motion envelope or
blur at high rates rather than pretend the frame rate depicts every stroke.
Wing rate is a **musical Hz control**, not a claimed measured mosquito frequency.
Use continuous tuning; a later MIDI seed could give a reference without
silently quantizing the rate. Flight path speed and wing pitch remain separately
performable. Ring contact excites a short secondary voice only when contact
occurs; the main voice is the wing, not a generic insect sample.

## Stage, rig and clock

- Current slice: an actual skinned textured mosquito with head, thorax,
  abdomen, six independently curled two-joint legs, two wing roots, antennae
  and an aimable proboscis. Its two wing bones and six leg chains respond to
  the same pose as the continuous wing voice. No procedural mosquito or
  missing-asset substitute is shown. The exact bone/mesh layout is documented in the
  Blender conversion script; do not present the source GLB as pre-rigged.
  A later glass ring and editable path anchors are *proposals*, not shipped
  features. Do not retag the Roach Synth scan as a mosquito.
- **Flight** replays a short authored world-space path independently of Audio.
  Manual steering/wing adjustment can sound while Flight is paused if Audio is
  armed; Audio arm alone emits no unattended drone. Audio off leaves Flight
  visible and silent, with no catch-up attacks when rearmed. Changing path
  while playing preserves normalized phase; wing parameters glide rather than
  rebuilding the voice. Reset restores the seed/path/rig, not Audio or output.
- First slice: one rig, direct steering plus a wing-rate control that audibly
  bends the visible wing motion. Next add a four-anchor path and its Flight
  transport; then the glass contact and stereo-rate offset. Avoid a fake 3D
  cockpit full of non-musical flight stats.
- Later complete scenes should differ in *flight and tone*: "Window hover"
  (slow spatial arc, soft harmonics), "Needle spiral" (large pitch curve,
  sharper air) and "Pinned orbit" (small range, beating paired wings).
  Presets preserve Audio arm, output, Flight state/phase and camera.

Initial ceilings to test: one insect, two wing phases, ≤12 path anchors,
≤3 sustained sound layers, ≤8 contact pings/s and bounded 100–120 ms audio
lookahead. Clamp oscillator and upper partials below the context's usable
Nyquist band; fade flight/wing stops and stale contacts. The visual wing blur
may drop frames without altering the audio clock. Keyboard/native controls
must select thorax, wing rate, path point and ring audition without raycast
precision; pointer cancellation restores the previous gesture.

**Acceptance scenes:** wing-rate min/default/max changes the measured carrier
while a fixed flight path stays fixed; changing path speed alters timing but
does not secretly retune a held wing; camera orbit does not change pan or pitch;
the same seeded path replays its contour; a ring contact sounds once at its
timestamp even when a render frame skips it; no ping sounds on a visual near
miss; Audio off is silent while Flight remains visible; toggling Audio does
not start Flight; live preset/path changes have no audible discontinuity or
stuck voices. Test desktop and both phone orientations, then listen in
isolation to the wing, air and contact layers.

**Evidence boundary:** no species-specific wing-rate, hearing, flight-control
or feeding claims are established here. The tuned ring and steerable rate
are invented musical affordances, not an acoustic reconstruction or a mosquito
field recording. Consult primary species-specific sources before biological
labels or naturalistic model assets; existing cockroach wing evidence cannot
be reused as mosquito evidence.
