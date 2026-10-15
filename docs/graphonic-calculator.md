# Graphonic Calculator — expressions, sliders and a sonified playhead

Open `/graphonic-calculator.html`. The instrument is a Desmos-style graphing
calculator built as a Morphazoid work in progress: an expression list beside a
pannable, zoomable plane, with a trace playhead that reads every visible curve
as sound. Audio starts off; **Play** sweeps the playhead silently until you
enable **Audio**. Audio and transport stay separate.

## What to try

- Type `y = x^2`, `sin(2x)` or `f(x) = e^-x cos(x)`. Bare expressions in `x`
  plot as `y =`; bare expressions in `y` plot as `x =`.
- `x^2 + y^2 = 4` is an implicit curve. `y < x^2` and `x >= y^2` shade regions
  (strict inequalities draw a dashed edge).
- `r = cos(3θ)` is polar (type `theta`), `(cos t, sin t)` is parametric; both
  show editable ranges beneath the row. `(1, 2)` is a point.
- `a = 2` makes a slider. Use an undefined letter and the row offers **Add
  slider**. Press ▶ beside a slider to animate it (one traversal every 4 s,
  Desmos's default); the row then offers Bounce / Loop / Play once and ¼×–4× speed.
- `(a, b)` with sliders `a` and `b` is a draggable point: drag it on the plane
  and the sliders follow, so everything built on them moves too.
- `2 + 2` or `sin(pi)` show their value. `f(2)` calls a defined function.
- Drag to pan; wheel, pinch, **+/−** or **+**/**−** keys zoom around the pointer;
  **⌂**/Home resets to x ∈ [−10, 10] with square units. Arrow keys pan the
  focused graph. Hovering a curve or point shows its coordinates.
- Choose a preset in the first row of the panel, press **▶** for the next one,
  or the dice for a bounded random scene. **Reset** returns to *Parabola &
  tangent* without touching Audio.

## Syntax

Implicit multiplication (`2x`, `xy`, `3sin(x)`, `(x+1)(x-1)`), `^` powers
(right-associative; `-x^2` is `-(x^2)`), `|x|`, `!` factorials (gamma for
non-integers), subscripts (`a_1`), and function application without parentheses
(`sin 2x` means `sin(2x)`; `sin x cos x` means `sin(x)·cos(x)`). Functions: `sin
cos tan sec csc cot asin acos atan sinh cosh tanh asinh acosh atanh ln log exp
sqrt cbrt abs floor ceil round sign min max mod`. Constants: `pi`/`π`, `tau`/`τ`,
`e`. Degrees mode (Graph settings) changes the trigonometric functions only.
Odd real roots of negative numbers stay real (`x^(1/3)` is defined for `x < 0`).

Explicit multiplication and division bind equally and left to right: `1/2x` is
`(1/2)·x`, as in a plain-text calculator, not the fraction `1/(2x)` a typeset
editor produces.

## Plotting

Explicit curves are sampled once per pixel across the visible range. Jumps are
bisected up to eight times: a jump that shrinks with the interval is a steep but
continuous section and is connected (`y = 1000x`); a jump that persists is a
discontinuity and the curve breaks there (`floor(x)`, `1/x`, `tan(x)`), so no
false vertical lines are drawn at poles. Domain edges are probed so `sqrt(x)`
reaches the origin. Implicit relations use marching squares on a four-pixel grid
with linear interpolation; thin or self-touching features may be missed between
cells. Polar and parametric curves sample their ranges as parametric paths.
Grid steps follow a 1–2–5 sequence with minor subdivisions, and axis numbers
follow the axes while they are on screen.

## Play

The Play section is Shape's playhead transport. One shared clock runs at the **Tempo**
rate in cycles per minute (12 per minute, one cycle every 5 s as in Desmos Audio Trace,
by default; tap the Tap button once per cycle; right is faster). The **position**
slider scrubs the first playhead within its cycle (as an angle for Radar) without
discarding completed cycles, so a scrub while playing never jumps the sound. The
reader vocabulary follows Shape's playheads:

- **Line** (default): a line sweeps the view, left to right or top to bottom; every
  curve it crosses is a contact. Each line's small toggle rotates it 90°, and
  **Crossed** alternates vertical and horizontal lines.
- **Radar**: a ray turns about the origin (or the view centre when the origin is off
  screen), starting at 12 o'clock and turning clockwise; contacts are where the ray
  meets curves. Polar curves read as their own radius function.
- **Points**: heads travel along every connected branch of every visible curve at
  the same pace, one lap per cycle, so a hyperbola carries one point per branch per
  head; each head sounds where it is.

**Playheads** (1–12) start equidistant in phase. Drag a numbered marker on the
spacing track, or focus it and use the arrow keys (Shift for 5% steps, Home and
End), to offset that playhead; **Equidistant** restores even spacing. The toggle
above a point or ray reverses that head only. **Loop** wraps the cycle; **Ping-pong**
folds it there and back; the direction button runs the whole clock backwards without
jumping. Head 1 draws solid and labelled; others dashed and dimmer, so a contact's
colour is always its curve and its ring brightness is its head.

## Sound

Every contact inside the view sounds (up to twelve voices at once) in the chosen
**Voice**: sine, triangle, reed (odd harmonics), saw, pulse or two-operator FM.
**Timbre** brightens reed and saw, narrows the pulse and deepens the FM index;
**Glide** sets how quickly a voice slides to a new contact. **Pitch from** chooses
what sets pitch across the **Pitch range** octaves above 220 Hz: height (y), width
(x) or distance from the origin; horizontal position always sets stereo placement.
Undefined values, poles and off-screen contacts stay silent, and pitch is continuous
rather than scale-quantized. The clock follows the audio clock while Audio is on, so
a stalled page does not stop or jump the sound; the readers keep moving silently when
Audio is off.

This is the deliberately small first slice of a larger sonification plan;
see [the research brief](graphonic-calculator-research.md) for the Desmos Audio
Trace comparison, prior art and the data model later phases build on
(`collectContacts` in `readers.js`, `probeHits`, `traceAt` and `resampleColumns` in
`geometry.js`), and [the roadmap](graphonic-calculator-roadmap.md) for the Desmos
features still to add.

## State and presets

One hundred and thirty complete scenes live in the header preset chooser: twenty
listening studies (Fourier square-wave and sawtooth build-ups, harmonic numbers
against ln(x) + γ, beats, consonant ratios) and a 110-formula library in
`formulas.js` spanning polynomials, trigonometry, exponentials, rational curves,
conics and named implicit curves, polar and parametric classics, Fourier sums,
physical models and calculus demonstrations. Presets own the reader (mode, heads, motion,
direction, head spacing and per-head options, voice, timbre, glide, pitch source) as well as the rows, view, angle mode, tempo and
pitch range. Presets own the
expression rows (text, color, visibility, slider bounds and animation, polar and
parametric ranges), the view, the angle mode, the sweep duration and the pitch
range. Grid and axis-number toggles, master level, Audio and the playhead are
session state. The dice builds a bounded random scene from a template library
with fresh slider values and colors. The current scene is saved locally
(`morphazoid.graphonic-calculator.v1`) and restored on the next visit without
arming Audio or starting the sweep.

## Limits

- Inequalities shade only `y < f(x)` and `x < g(y)` forms; implicit
  inequalities, lists, tables, regressions, derivatives, sums and products are
  not supported yet.
- One comparison per line; piecewise `{...}` notation, chained inequalities and
  complex numbers are not supported.
- Implicit curves are approximate near singular points; there is no interval
  arithmetic yet.
- Up to 40 rows, 240 characters per row, 6 simultaneous voices.

## Tests

`tests/graphonic-calculator-*.test.mjs` cover the parser, expression
classification, the view camera and ticks, the sampler and marching squares,
geometry and trace sampling, the state model, presets and randomization, and
site integration. `e2e/graphonic-calculator.spec.mjs` checks expression editing,
sliders, the silent sweep, pan/zoom/drag gestures, real Web Audio output and
release, and desktop, phone portrait and phone landscape reachability with an
axe accessibility pass. Human listening acceptance remains separate.
