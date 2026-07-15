# Morphazoid

A geometric instrument for sounding contact.

**Shape** is a two-dimensional instrument: one to twelve point heads trace the boundary, or one to four parallel or crossed scan lines read contour intersections. Scan lines stay inside the contour's current projected bounds and can loop or ping-pong. Reader and rotation transports run independently at up to 1.2 cycles/s and 2 revolutions/s. The default instrument is one point moving in a loop.

Sound modes are exclusive. The default Sine mode keeps one sine oscillator per contact and shapes that same voice with an amplitude envelope at each corner—there is no layered corner sound. Percussion mode instead produces discrete corner strikes, with independent level, attack, and decay controls. Pitch mapping, stereo width, volume, and sound settings persist locally. It is built with plain HTML, CSS, JavaScript modules, Canvas, and Web Audio—there is no framework or build step.

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
