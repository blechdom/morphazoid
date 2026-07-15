# Morphazoid

A geometric instrument for sounding contact.

**Shape** is a two-dimensional instrument: one to twelve point heads trace the boundary, or one to four parallel or crossed scan lines read contour intersections. Scan lines stay inside the contour's projected bounds and can loop or ping-pong. Reader and rotation transports run independently at up to four cycles or revolutions per second. The default instrument is one point moving in a loop.

Head spacing can be edited while the instrument runs: drag the markers in the compact head-layout control, or reset them to an even distribution. The form can be a polygon or a true concave star, then stretched, skewed, made asymmetric, rounded outward, or bowed inward. Every transform is normalized so the whole rotating form remains inside the stage. Drag the contour itself to spin it whenever auto-rotation is off.

Sound modes are exclusive. The default Sine mode keeps one sine oscillator per contact and shapes that same voice with an amplitude envelope at each corner—there is no layered corner sound. Percussion mode instead produces discrete corner strikes, with independent level, attack, and decay controls. Simultaneous strikes are normalized and scheduled across the rendered frame to prevent multi-head overload clicks.

The Mapping section routes geometric marks such as height, corner angle, incidence, and phase to pitch or level with linear, exponential, logarithmic, smooth, and inverted response curves. The Output dashboard exposes the live values and planned Web MIDI, OSC, and JSON-stream destinations. Pitch mapping, stereo width, volume, and sound settings persist locally.

On small screens the stage stays visible while the controls scroll independently. Play, Form, Sound, Mapping, and Output are collapsible so the most useful controls can stay close together during performance.

Morphazoid is built with plain HTML, CSS, JavaScript modules, Canvas, and Web Audio—there is no framework or build step.

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
