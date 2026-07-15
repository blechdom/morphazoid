# Morphazoid

A geometric instrument for sounding contact.

**Shape** is a two-dimensional instrument: one to four parallel or crossed scan lines read contour intersections, or one to twelve point heads trace the boundary. Scan lines stay inside the contour's current projected bounds and can loop or ping-pong. Reader and rotation transports run independently at up to 1.2 cycles/s and 2 revolutions/s.

The initial sound is deliberately singular: each corner triggers one sine oscillator with a zero-sustain attack/decay envelope. Accent, attack, decay, pitch mapping, stereo width, and volume are independent and persist locally. It is built with plain HTML, CSS, JavaScript modules, Canvas, and Web Audio—there is no framework or build step.

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
