# Morphazoid

Four geometric instruments for sounding contact.

**Shape** is a two-dimensional instrument: one to twelve point heads trace the boundary, one to four parallel or crossed scan lines read contour intersections, or center-rooted radar rays rotate clockwise/counterclockwise through every contour hit. Scan lines stay inside the contour's projected bounds and can loop or ping-pong. Reader and rotation transports run independently at up to four cycles or revolutions per second. FM is the default voice.

**Lattice** turns a curved isohedral tiling into one deduplicated edge field. A single centered line is the only playhead: the infinite pattern moves beneath it and sounds every edge it intersects simultaneously. It never walks or serializes the lattice. All 72 Tactile isohedral families are available, with their native shape parameters and independently bendable J, U, and S edge classes; symmetry-locked I edges remain straight.

**Solid** extends the intersection instrument into 3D. Cube, pyramid, cone, and sphere wireframes are cut by an oriented 2D plane. Segment/plane contacts become voices, vertex crossings can become percussion, and the solid can rotate manually or automatically around all three visible axes.

**Hyper** uses the same idea in 4D. A tesseract rotates through the XW, YW, and ZW planes while a moving W hyperplane sounds the intersected 4D segments. The projected visible height controls pitch and hidden-axis depth can drive FM or PM.

An optional prototile frame provides direct vertex editing without sacrificing tessellation validity. Movable corners are projected onto the selected family's native Tactile parameter space and keep the sliders synchronized; symmetry-fixed corners remain visibly locked. Tile solids retain their aspect/color identity as visual metadata, but no musical meaning is assigned to color yet so that mapping can be designed separately.

Head spacing can be edited while the instrument runs: drag the markers in the compact head-layout control, or reset them to an even distribution. The form can be a polygon or a true concave star, then stretched, skewed, made asymmetric, rounded outward, or bowed inward. Every transform is normalized so the whole rotating form remains inside the stage. Drag the contour itself to spin it whenever auto-rotation is off.

Sound modes are exclusive. The default Sine mode keeps one sine patch per contact and shapes that same voice with an amplitude envelope at each corner; there is no layered corner sound. Percussion instead produces discrete corner strikes, with independent level, attack, and decay controls. Shepard glissando follows the transport in adjustable octaves per loop, while FM and PM use a selectable live geometry mark to drive their modulation depth. Each mode remains one simple patch per contact, and simultaneous strikes are normalized to prevent multi-head overload clicks.

Lattice reuses the same click-safe voice pool, synth modes, pitch curves, stereo mapping, level normalization, and lazy Web Audio lifecycle. Every selected contact is one patch, with a same-voice onset accent and visual halo when an edge first intersects the line; Percussion turns only those new intersections into strikes. Height, position along the line, line/edge incidence, and edge orientation can be routed into pitch, level, or modulation drive. Dense intersections are sampled evenly across the line before sounding, so the selected voices retain the geometry's spatial span. One playback cycle is exactly one primitive lattice translation, making the visual loop, contact identity, and transport-locked Shepard motion continuous at the boundary.

The Mapping section routes geometric marks such as height, corner angle, incidence, and phase to pitch or level with linear, exponential, logarithmic, smooth, and inverted response curves. The Output dashboard exposes the live values and planned Web MIDI, OSC, and JSON-stream destinations. Pitch mapping, stereo width, volume, and sound settings persist locally.

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
