# Morphazoid

Five geometric instruments for sounding contact and recorded motion.

**Shape** is a two-dimensional instrument: one to twelve point heads trace the boundary, one to four parallel or crossed scan lines read contour intersections, or center-rooted radar rays rotate clockwise/counterclockwise through every contour hit. Scan lines stay inside the contour's projected bounds and can loop or ping-pong. Reader and rotation transports run independently at up to four cycles or revolutions per second. Sine with motion-gated corner emphasis is the default voice.

**Lattice** turns a curved isohedral tiling into one deduplicated edge field. A single centered line is the only playhead: the infinite pattern moves beneath it and sounds every edge it intersects simultaneously. It never walks or serializes the lattice. All 72 Tactile isohedral families are available, with their native shape parameters and independently bendable J, U, and S edge classes; symmetry-locked I edges remain straight.

**Solid** extends the intersection instrument into 3D. Eight wireframes—including cube, octahedron, prism, sphere, and torus—can be stretched and skewed before an oriented 2D plane cuts them. Segment/plane contacts become voices, while X/Y/Z rotation and surface yaw/pitch each have independent play and speed controls.

**Hyper** uses the same idea in 4D. Tesseract, hypersphere, hyperpyramid, and Klein-bottle wireframes can be stretched through X/Y/Z/W. XW, YW, and ZW rotation run independently while a moving W hyperplane sounds the intersected 4D segments.

**Lumber** is a live audio looper drawn as thin, differently colored concentric rings. Each ring has inline direction, relative volume, mute, solo, and delete controls. Straight radial handles apply duration-preserving local pitch: inward lowers and outward raises only adjacent loop sections. Additional controls provide movable playback heads, per-ring clocks, one-click global length/phase sync, per-ring filter/stereo, and optional 3D depth. An optional outer Delay ring affects the complete mix: its neutral shape is dry, inward pulls shorten the echo, and outward pulls add feedback and wet level.

Lattice keeps its prototile editor permanently visible. Movable corners are projected onto the selected family's native Tactile parameter space, while an overlap guard rejects self-crossing edits and a density guard limits visual/audio overload.

Head spacing can be edited while the instrument runs: drag the markers in the compact head-layout control, or reset them to an even distribution. The form can be a polygon or a true concave star, then stretched, skewed, made asymmetric, rounded outward, or bowed inward. Every transform is normalized so the whole rotating form remains inside the stage. Drag the contour itself to spin it whenever auto-rotation is off.

Sound modes are exclusive. The default Sine mode keeps one sine patch per contact and shapes that same voice with an amplitude envelope at each corner; there is no layered corner sound. Percussion instead produces discrete corner strikes, with independent level, attack, and decay controls. Shepard glissando follows the transport in adjustable octaves per loop, while FM and PM use a selectable live geometry mark to drive their modulation depth. Each mode remains one simple patch per contact, and simultaneous strikes are normalized to prevent multi-head overload clicks.

Lattice reuses the same click-safe voice pool, synth modes, pitch curves, stereo mapping, level normalization, and lazy Web Audio lifecycle. Every selected contact is one patch, with guarded onset accents and crossfaded percussion retriggers. Dense fields retain a centered adjacent contact window so tighter visual spacing produces tighter pitch spacing, while density also increases the exact lattice-cycle rate. Form edits temporarily suppress onset detection to avoid ripping or level surges.

The Mapping section routes geometric marks such as height, corner angle, incidence, and phase to pitch or level with linear, exponential, logarithmic, smooth, and inverted response curves. The Output dashboard exposes the live values and planned Web MIDI, OSC, and JSON-stream destinations. Every page starts from its baseline settings when loaded, and the bottom-of-panel reset returns the complete instrument to that baseline.

On small screens the stage stays visible while the controls scroll independently. Play, Form, Sound, Mapping, and Output are collapsible so the most useful controls can stay close together during performance.

Morphazoid is built with plain HTML, CSS, JavaScript modules, Canvas, and Web Audio—there is no framework or build step.

Continuous voices render in an AudioWorklet. Moving geometry sends short look-ahead trajectories to that render thread, while transport time prefers the audio clock and the canvas follows it. Canvas resolution is pixel-budgeted on large/retina windows so display work cannot grow without bound.

## Play online

<https://blechdom.github.io/morphazoid/>

## Development

```sh
npm run dev
```

Open <http://localhost:3435>.

## Checks

```sh
npm run verify
```
