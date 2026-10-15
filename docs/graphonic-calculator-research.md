# Graphonic Calculator — research brief

Compiled on 2026-10-14 for the Morphazoid Graphonic Calculator from a multi-agent
research pass: five parallel sweeps (Desmos product and accessibility behavior,
Desmos engineering, open-source graphing calculators, building-block libraries,
sonification prior art), eighteen deep reads of candidate repositories with
independent adversarial license verification, and one synthesis. Every claim
carries its source; where sources disagreed the disagreement is recorded in §6.
Licenses were read from the actual LICENSE files or registry metadata, not
inferred. This document is research evidence, not legal advice.

How the shipped MVP uses it: the instrument follows the §4 build-vs-vendor
recommendation (hand-written parser, sampler, marching squares, camera, UI; no
third-party code vendored) and treats Desmos Audio Trace (§1.8) as the
specification the later sonification phases will measure against. The §4.10 gap
list and the §5 plan are the roadmap for those phases. Current behavior, syntax
and limits are documented in [graphonic-calculator.md](graphonic-calculator.md).

---

Date: 2026-10-14. Target: a Desmos-class graphing calculator shipped as a Morphazoid instrument (authored HTML/CSS, native ES modules, Canvas 2D, Web Audio; no framework, no bundler, no TypeScript step). Third-party code only if MIT/BSD/Apache-2.0/MPL-2.0 (with notice) and loadable as a plain ES module or one prebuilt browser file vendored under `vendor/`. First deliverable: expression list + live graph, pan/zoom, sliders, multiple colored functions. Phase 2 sonifies the plotted functions, so the sampled-function model must be audio-readable from day one.

Evidence base: five research sweeps (Desmos UX, Desmos engineering, open-source calculators, building blocks, sonification) plus deep reads with adversarial license/packaging verification of 18 candidates. Where verification refuted a sweep claim, the corrected value is used and flagged. Two source-quality caveats apply throughout: help.desmos.com returns HTTP 403 to fetchers, so help-center text was retrieved through Zendesk's public JSON API; Desmos's audio-trace constants were read from the minified production bundle (numeric literals exact, identifiers inferred).

## Bottom line

1. Desmos's calculator core is closed. Parser, plotter, audio trace and UI ship only as the proprietary minified bundle and the key-gated embed API ("you must supply an API key as a URL parameter"; self-hosting is for partners only) ([Desmos API](https://www.desmos.com/api), [API plans article](https://help.desmos.com/hc/en-us/articles/49078363315725)). Nothing from it may be vendored; its behavior is the specification. Repos that redistribute the bundle (OfflineDesmos, Desmos-Desktop and similar) are not usable sources either.
2. Desmos's architecture is reproducible in plain JS and is already the right shape for sonification: input → Pratt parser → AST → compiled JavaScript functions → sampling in a worker that returns "an array of tiny line segments" → styling and Canvas drawing on the main thread ([Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/), [SIGGRAPH 2025 Real-Time Live!](https://dl.acm.org/doi/10.1145/3721243.3735987)). The sampled segments are the audio model.
3. No mature, permissively licensed, framework-free Desmos clone exists to adopt wholesale. The two closest architectural matches (UtlCalculator, GabrielDeml/graphing-calc) have no license; the licensed libraries are heavy or render SVG. Verdict: hand-write the core as vanilla ES modules (the worktree already holds a ~2.8k-line scaffold, see §4.10), vendor only MathQuill (Desmos fork, MPL-2.0) when typeset input is wanted, and defer interval arithmetic (compute-engine `interval.js`, MIT; or interval-arithmetic, BSL-1.0 pending sign-off) to the implicit/asymptote phase.
4. Verification corrected the sweeps in several places that matter: Graphics Gems does have an SPDX id (`Graphics-Gems`, not OSI-approved); three of the math-codegen family packages ship no LICENSE file; mathjs's LGPL-free "number" ESM is CDN-generated and not vendorable (only the full UMD, which contains LGPL-2.1+ CSparse without a notice, is self-contained); the @desmos-community MathQuill nightly ships broken font references and its publishing workflow is disabled (Desmos moved to DesQuill); graphest binaries are GPL-encumbered through FFTW; the claim that the nightly is the only prebuilt jQuery-free MathQuill was false (@openwebwork/mathquill exists, but is a divergent fork).
5. Sonification has a documented, user-tested target (Desmos Audio Trace: pitch ↔ y across exactly one octave of the viewport, pan ↔ x, brown-noise static for y < 0, an added harmonic for x > 0, 75 ms blips for points, pops at points of interest, 5 s per screen by default) and a granted Desmos patent (US10346135B2) whose dependent claims cover discontinuity, quadrant, intersection and verbal-summary cues. Phase 2 should keep the mapping research recommends (exponential pitch, pan for x or for series identity, loudness never carries data, two simultaneous streams at most) and make deliberate, legally reviewed choices for the sign/discontinuity/intersection cues.

## 1. Desmos anatomy

Tiers: **MVP** (first deliverable), **Later** (phase 1.5–2), **Never** (inappropriate for a Morphazoid instrument: account/cloud features, classroom tooling, statistics workflows, proprietary surfaces, trademarks).

### 1.1 Expression list and editing

| Feature | Exact Desmos behavior (source) | Tier |
|---|---|---|
| Add/remove rows | "Click below an existing expression line or press Enter from an existing expression line to add a new blank line"; Backspace on an empty line removes it ([User Guide](https://docs.google.com/document/d/1gV-WgDjgR9hKKb32ffeUpjwggNAgfqxl0Gsg6xocbok/preview), [shortcut sheet](https://www.desmos.com/assets/docs/desmos-keyboard-shortcuts-windows.docx)) | MVP |
| Live re-plot on every keystroke | MathQuill typesets keystrokes to LaTeX, a Flux action updates the model "optimistically", parsing/compiling/plotting run in web workers ([Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/)) | MVP (plain text, main thread) |
| Typeset (WYSIWYG) input | Typing `/` yields `\frac{}{}`, `pi` yields `\pi`; typed `frac`, `sqrt`, `nthroot`, `sum`, `int`, `prod`, `pi`, `theta`, `<=`, `>=`, `->` autoconvert; Up/Down move into numerator/denominator, Tab exits a block ([Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/), [shortcut sheet](https://www.desmos.com/assets/docs/desmos-keyboard-shortcuts-windows.docx)) | Later (1.5) via MathQuill |
| Per-row evaluation display | `1+1` evaluates; `f(0)`, `f(5)` show values; Shift+Alt+A toggles fraction/decimal; exact rationals when numerator and denominator fit in ±2^53 so `0.1+0.2=0.3` ([Getting Started](https://help.desmos.com/hc/en-us/articles/4406040715149-Getting-Started-Desmos-Graphing-Calculator), [arithmetic article](https://engineering.desmos.com/articles/intuitive-calculator-arithmetic/)) | MVP (decimal only) |
| Localized errors | The Pratt parser was adopted for "flexibility" — localized messages such as highlighting a missing parenthesis ([Pratt parser article](https://engineering.desmos.com/articles/pratt-parser/)) | MVP |
| Hide/show | A single click on the Color icon hides/shows the item ([Getting Started](https://help.desmos.com/hc/en-us/articles/4406040715149-Getting-Started-Desmos-Graphing-Calculator), [FAQs](https://help.desmos.com/hc/en-us/articles/4406360401677-FAQs)) | MVP |
| Options menu | Click-and-hold the Color icon, Ctrl+Shift+O, or Shift+click: line/point style, thickness, color, opacity, labels, drag mode, fill ([FAQs](https://help.desmos.com/hc/en-us/articles/4406360401677-FAQs), [Custom Colors](https://help.desmos.com/hc/en-us/articles/4406795899533-Custom-Colors)) | MVP (color), Later (styles) |
| Expression size cap | `capExpressionSize`: 500 LaTeX tokens, depth 30 ([API v1.13](https://www.desmos.com/api/v1.13/docs/index.html)) | MVP (own caps) |
| Duplicate / delete / clear all | Ctrl+Shift+C, Ctrl+Shift+D, Ctrl+Shift+L ([shortcut sheet](https://www.desmos.com/assets/docs/desmos-keyboard-shortcuts-windows.docx), [What's New](https://help.desmos.com/hc/en-us/articles/4405017454477--What-s-New-at-Desmos-Studio)) | Later |
| Reorder | Drag-and-drop, or keyboard mode Alt+Shift+M / Cmd+Shift+M, arrows, Enter (April 2026) ([Accessibility intro](https://help.desmos.com/hc/en-us/articles/4404860698253-Introduction-to-Accessibility-Features), [What's New](https://help.desmos.com/hc/en-us/articles/4405017454477--What-s-New-at-Desmos-Studio)) | Later |
| Folders and notes | Add Item menu; "To add an expression line to a folder, press Return"; Alt+Up/Down collapse/expand ([Add an Item](https://help.desmos.com/hc/en-us/articles/4407895086349-Add-an-Item-to-a-Graph)) | Later |
| Copy/paste items between graphs | Since Nov 2024 ([Add an Item](https://help.desmos.com/hc/en-us/articles/4407895086349-Add-an-Item-to-a-Graph)) | Later |
| Undo/redo | Ctrl+Z / Ctrl+Shift+Z ([shortcut sheet](https://www.desmos.com/assets/docs/desmos-keyboard-shortcuts-windows.docx)) | Later |
| Images, inference, ticker/actions | Add Item menu; `->` creates actions ([Add an Item](https://help.desmos.com/hc/en-us/articles/4407895086349-Add-an-Item-to-a-Graph), [Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions)) | Never |
| Narrow layout | Below 450 px the list stacks over the graph with a draggable north-south divider; zoom buttons hide when the graph is under 450 px; keypad always activated on touch devices ([Supported Browsers](https://help.desmos.com/hc/en-us/articles/202528979-Supported-Browsers-Native-Apps), [API v1.13](https://www.desmos.com/api/v1.13/docs/index.html), bundle) | MVP (stack), Later (divider) |

### 1.2 Expression classification (what a line means)

The parser's "lower" pass decides context-specific meaning (e.g. whether comma-separated values are a list or a point) and every identifier resolves against a shared "frame" of exported definitions, so the list is "a complete declarative program" and any frame change cascades ([Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/)).

| Line form | Desmos meaning and defaults (source) | Tier |
|---|---|---|
| `y = f(x)`, bare `f(x)`-shaped expression, `f(x) = …` | Explicit function / definition; `g(x,y)` multi-argument definitions allowed ([Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions)) | MVP |
| `x = g(y)` | Function of y ("In graphs that use x as the dependent variable, the cues flip" also applies to audio) ([Audio Trace](https://help.desmos.com/hc/en-us/articles/37064105800333-Audio-Trace)) | MVP |
| `a = 3` and free variables | "Any time you have free variables in an expression, the calculator will prompt you to define them with sliders"; prompt reads `add slider:` with per-variable buttons and `all`; reserved: `x`, `y`, `θ`, `r` (when θ is present), `i` (complex mode), `e` ([Sliders](https://help.desmos.com/hc/en-us/articles/202529069-Sliders-and-Movable-Points-in-a-Graph)) | MVP |
| `3x−4y=1`, `x²+y²=9` | Implicit equations plotted whether or not solved for y; too-complex equations fall back to lower resolution ([Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions)) | Later (1.5) |
| `y < x²`, `x²+y² ≤ 1` | Shaded regions; help says strict inequalities are "dotted", the User Guide says "dashed" (docs disagree) ([Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions), [User Guide](https://docs.google.com/document/d/1gV-WgDjgR9hKKb32ffeUpjwggNAgfqxl0Gsg6xocbok/preview)) | Later |
| `(1,3)` | Point; several per line separated by commas; a point with slider coordinates becomes draggable ([Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions), [Sliders](https://help.desmos.com/hc/en-us/articles/202529069-Sliders-and-Movable-Points-in-a-Graph)) | MVP (single point) |
| `(cos t, sin t)` | "Any point with functions of t for coordinates will be plotted as a parametric equation"; default t ∈ [0,1], editable inline ([Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions), [Parametric](https://help.desmos.com/hc/en-us/articles/4406906208397)) | Later |
| `r = cos(3θ)` | Polar; default θ ∈ [0, 12π], shrunk when the curve is detected to be periodic; must be linear in r ([Polar Graphing](https://help.desmos.com/hc/en-us/articles/4406895312781-Polar-Graphing)) | Later |
| `{x<0: −1, 1}`, `… {x>0}` | Piecewise and domain restrictions, combinable with `and`/`or` ([Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions)) | Later |
| `[1,3,4]`, `[1…10]`, `L[L>0]` | Lists broadcast through any expression to plot families ([Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions)) | Later |
| Tables | First two columns plotted (x1, y1); Zoom Fit; function headers fill columns ([Tables](https://help.desmos.com/hc/en-us/articles/4405489674381-Tables)) | Later |
| `~` regressions, inference, `->` actions | Statistics/programming tools ([Inequalities and Restrictions](https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions)) | Never |
| `tone(f[, g])` | User-authored sound: 20–20000 Hz, gain capped at min(10, 660/f), graphs start muted, Alt+M mutes all ([Tone](https://help.desmos.com/hc/en-us/articles/21373904717197-Tone)) | Later (phase 2) |
| Identifier rules | Juxtaposed letters multiply (`mx` = m·x); multi-letter names need subscripts (`v_f`) ([Desmos forum](https://cl.desmos.com/t/variable-names-with-subcripts/459)) | MVP |
| Angle mode | Per-graph radians/degrees toggle, default radians; `pi` typed as axis step labels in multiples of π ([Degrees/radians](https://help.desmos.com/hc/en-us/articles/4406029680653), [Graph Settings](https://help.desmos.com/hc/en-us/articles/4405296853517-Graph-Settings)) | MVP (toggle), Later (π ticks) |

### 1.3 Graph paper: viewport, grid, settings

| Feature | Exact behavior (source) | Tier |
|---|---|---|
| Default viewport | x ∈ [−10, 10], y ∈ [−13.25, 13.25] with `squareAxes` true (visible y-range is squared to the real aspect ratio); "Default Viewport" restores it ([Graph Settings](https://help.desmos.com/hc/en-us/articles/4405296853517-Graph-Settings), bundle defaults) | MVP |
| Grid/axes defaults | showGrid/showXAxis/showYAxis true; axis step 0 = automatic; minor subdivisions 0 = automatic (1 = major only, up to 5); arrow modes NONE; `pixelsPerLabel` 80 (120 in projector mode); label size 14; curve width 2.5; point size 9; major grid opacity 0.4, minor 0.12; axis opacity 0.9, width 1.5 ([Graph Settings](https://help.desmos.com/hc/en-us/articles/4405296853517-Graph-Settings), [API v1.11](https://www.desmos.com/api/v1.11/docs/index.html), bundle) | MVP |
| Zoom | On-screen buttons, Alt+Plus/Minus (Ctrl+Plus/Minus on Mac), wheel, pinch; Alt+0 default zoom; Shift+Alt+Z zoom fit; "Lock Viewport" disables pan/zoom ([Graph Settings](https://help.desmos.com/hc/en-us/articles/4405296853517-Graph-Settings), [shortcut sheet](https://www.desmos.com/assets/docs/desmos-keyboard-shortcuts-windows.docx)) | MVP (buttons, wheel, drag), Later (fit, lock) |
| Independent axis scaling | `graphpaperBounds` exposes `mathCoordinates` and `pixelCoordinates`; axes can be scaled independently; log scale per axis under More Options ([API v1.13](https://www.desmos.com/api/v1.13/docs/index.html), [Graph Settings](https://help.desmos.com/hc/en-us/articles/4405296853517-Graph-Settings)) | MVP (independent linear), Later (log) |
| Polar grid, complex mode, degrees | Graph settings toggles ([Graph Settings](https://help.desmos.com/hc/en-us/articles/4405296853517-Graph-Settings)) | Later / Never (complex) |
| Accessibility display | Enlarge display, reverse contrast, Braille mode ([Accessibility intro](https://help.desmos.com/hc/en-us/articles/4404860698253-Introduction-to-Accessibility-Features)) | Later (large/contrast), Never (Braille) |

### 1.4 Interaction: trace and points of interest

"If you click anywhere on a line or curve, gray dots will appear at intercepts, intersection points, maximums, and minimums. Click a gray dot to display the coordinates at that point. Click the dot again to hide the coordinates" ([FAQs](https://help.desmos.com/hc/en-us/articles/4406360401677-FAQs)). Hovering reveals labeled coordinates; "Export Point to Expression List" copies a POI into a new line (Nov 2024); intersections show at least 5 decimals (July 2024) ([Getting Started](https://help.desmos.com/hc/en-us/articles/4406040715149-Getting-Started-Desmos-Graphing-Calculator), [What's New](https://help.desmos.com/hc/en-us/articles/4405017454477--What-s-New-at-Desmos-Studio)). Coordinates are not displayed for parametric curves ([FAQs](https://help.desmos.com/hc/en-us/articles/4406360401677-FAQs)). Tiers: hover readout MVP; gray POI dots, click-to-pin, export Later. POIs are also the audio-trace anchors, so the model slot exists from the MVP.

### 1.5 Sliders

"By default, sliders are typically set to an interval of -10 to 10"; clicking an end value edits bounds; a numeric step limits values "to fixed interval steps counting up from the lower bound"; bounds may reference other variables; Play animates with modes loop forwards-and-backwards, repeat one direction, play once, play indefinitely; bundle defaults: min `-10`, max `10`, step `''` (continuous), `animationPeriod` 4000 ms, `loopMode` LOOP_FORWARD_REVERSE ([Sliders](https://help.desmos.com/hc/en-us/articles/202529069-Sliders-and-Movable-Points-in-a-Graph)). Keyboard: Left/Right adjust, PageUp/PageDown larger step, Home/End min/max; viewport bounds can be bound to slider values (May 2025) ([shortcut sheet](https://www.desmos.com/assets/docs/desmos-keyboard-shortcuts-windows.docx), [What's New](https://help.desmos.com/hc/en-us/articles/4405017454477--What-s-New-at-Desmos-Studio)). Tiers: auto-prompt, bounds/step editing, play (forward-reverse, 4 s) MVP; other loop modes, dynamic bounds Later.

### 1.6 Styling

Default palette cycles six colors: RED `#c74440`, BLUE `#2d70b3`, GREEN `#388c46`, PURPLE `#6042a6`, ORANGE `#fa7e19`, BLACK `#000000`; styles SOLID/DASHED/DOTTED and POINT/OPEN/CROSS/…; lineWidth 2.5, lineOpacity 0.9, pointSize 9, fillOpacity 0.4 ([API v1.11](https://www.desmos.com/api/v1.11/docs/index.html), [Custom Colors](https://help.desmos.com/hc/en-us/articles/4406795899533-Custom-Colors)). A CITL review notes the default orange fails WCAG contrast ([Custom Colors](https://help.desmos.com/hc/en-us/articles/4406795899533-Custom-Colors)). Recommendation: use Morphazoid's own six-color palette (the scaffold already does) — color values are not protectable, but the instrument should not read as a Desmos clone, and the style record ("Color: red", "Dashed") is what audio trace narrates later.

### 1.7 Keyboard and accessibility baseline

Desmos opens with focus in the expression list; Ctrl+/ opens the shortcut dialog; Up/Shift+Tab and Down/Tab move between expressions; arrow keys pan when the graph is focused; Ctrl+Alt+G opens graph settings ([Accessibility intro](https://help.desmos.com/hc/en-us/articles/4404860698253-Introduction-to-Accessibility-Features), [shortcut sheet](https://www.desmos.com/assets/docs/desmos-keyboard-shortcuts-windows.docx)). The equation editor "reads aloud expressions knowing the difference between reading cosine instead of cos, x squared instead of x superscript 2, one half instead of 1 slash 2" ([Accessibility intro](https://help.desmos.com/hc/en-us/articles/4404860698253-Introduction-to-Accessibility-Features)). Tiers: list navigation keys, Ctrl+/ help, arrow-pan MVP; spoken math (MathQuill `.mathspeak()` or KaTeX a11y strings) Later.

### 1.8 Audio Trace — verbatim behaviors

From the official article ([Audio Trace](https://help.desmos.com/hc/en-us/articles/37064105800333-Audio-Trace)): enter with Alt+T (Windows) / Option+T (Mac) while focused in an expression line or the graph, or via the keypad's Sound key; H (or Hear Graph) plays the selected curve.

> "the sound of the graph will move from left to right as the trace point moves"
> "A static effect plays when the y values are negative, and the timbre (or quality) of the tone increases when the x values are positive"
> "In graphs that use x as the dependent variable, the cues flip."

Volume V / Shift+V; speed Alt+1 slowest … Alt+0 fastest; a point appears and Left/Right move it; Tab/Shift+Tab jump between points of interest (intercepts, intersections); Alt+Down/Up next/previous expression; S connects the slider to the arrow keys ("b=1, press S then Left twice gives b=-1, then H replays"); T describes the point, Alt+S the curve, Alt+G the axes. Worked examples: y=x pitch rises (static until y>0); y=−x falls; y=sin x oscillates; y=x² starts high, drops, rises; x²+y²=9 plays bottom and top halves simultaneously (bottom half with static); f(x)=−2x+4 with g(x)=x²+1 produces two pops at the intersections.

From the accessibility overview ([Accessibility intro](https://help.desmos.com/hc/en-us/articles/4404860698253-Introduction-to-Accessibility-Features)): "an overtone plays when moving from negative to positive x values (the independent variable) and static occurs when moving from positive to negative y values (the dependent variable)", with pops where curves intersect.

From What's New, June 2026 ([What's New](https://help.desmos.com/hc/en-us/articles/4405017454477--What-s-New-at-Desmos-Studio)): "Audio trace now plays points in time with how they're spaced along the x-axis. Implicit, polar, and parametric equations are all supported. For functions with multiple branches (like a circle!), all branches trace at once, from left to right"; Aug 2025: "You can now hear the difference between a curve intersecting a point and a curve intersecting another curve while tracing".

Synthesis constants read from the production bundle ([shared_calculator_desktop bundle](https://www.desmos.com/assets/build/shared_calculator_desktop-4c0e7c8826b1fb7f7f994b963732754fc33b99b2.js), served by [desmos.com/calculator](https://www.desmos.com/calculator)):

- Frequency = clamp(330 · 2^t, 125, 2000) Hz, t = y normalized over the visible y-range (log scale honored): viewport bottom 330 Hz (E4), top 660 Hz (E5), exactly one octave per screen height.
- Pan = clamp(2·(normalized x) − 1, −1, 1) via `StereoPannerNode`; x maps to time over `screenDuration`, default 5 s ("1 x", speed index 6); the speed table runs 1/32x (160 s) to 8x (0.625 s); default volume 0.5.
- Base tone: `PeriodicWave` real `[0,1,0,.25]`, imag `[1,0,.25,0]` at gain 0.5. "Overtone" for x > 0: a second oscillator at the same frequency with imag `[1,0,1,0,.25,0,.3,0]` at gain 0.15. Noise/overtone transitions are scheduled at interpolated zero-crossing times.
- "Static": looped brown noise (recurrence (prev + 0.2·rand)/1.02) at gain 0.1 while y < 0; off-screen y gets a 0.04-gain noise blip for 75 ms; gaps between branches are filled with 0.04-gain noise panned across the gap; every gain change uses `setTargetAtTime` with a 1.5 ms time constant; discrete points are 75 ms blips.
- POIs trigger sampled sounds (`poi-AGMVXCPR.mp3` for intercepts/extrema/intersections, `point-J6J7R37D.mp3` for "Approximate Intersection"); more than 256 branches aborts with "This curve is too complex to audio-trace. Try zooming in or simplifying the expression."
- Navigation samples 101 points per branch evenly in pixel space, inserting POIs between samples; POI types: Definition, Extremum, Intercept, Intersection / "Intersection with {curves}", Label, Zero, Approximate Intersection, Trace, "Not a P O I"; O moves to the origin; Up/Down switch branches; digits 1–0 play only branch 1–10; Describe Curve says "Color: {color}.", "Branches: {n}.", "{n} extrema.", "{n} intercepts.", "{n} intersections.", "{n} zero crossings."; Describe Axes says "X axis visible from {xmin} to {xmax} and is labeled {label}." and "Grid lines are visible."; audio-trace keys pause animating sliders ("{n} animating sliders were paused.").

The CITL guide's statement that arrows move "one fourth of your x-axis step value" and that speeds are Alt+1..5 ([CITL guide](https://citl.illinois.edu/desmos-accessible-graphonic-calculator-guide)) conflicts with the current bundle (101 pixel-even samples; ten speeds) and is likely stale. The granted patent ([US10346135B2](https://patents.google.com/patent/US10346135B2/en)) describes an older design: a triangle wave with pitch = position in the visible y-range "multiplied against a base frequency of 500 hz" (linear), a secondary triangle "at 1/4 volume and an octave above" when the independent variable is less than 0, brown noise for undefined/off-screen/negative y, each axis range "divided by 100" for step size, 12–150 ms per step, a 50 ms single-point sound, and "a brief pop" at intersections; its overtone polarity (x < 0) is the opposite of the current help text (x > 0).

### 1.9 Persistence and sharing

Save (Ctrl+S) requires login; Share offers an immutable snapshot or a live link; export PNG/SVG; a pasted graph link imports the graph ([Saving and Sharing](https://help.desmos.com/hc/en-us/articles/4405901719309-Saving-and-Sharing-Your-Work)). The state JSON (`getState`) is `{version, graph:{viewport:{xmin,ymin,xmax,ymax}, squareAxes, degreeMode, …}, expressions:{list:[{type, id, latex, color, hidden, sliderBounds, parametricDomain, polarDomain, lineStyle, …}]}}`, version 14 currently ([API v1.13](https://www.desmos.com/api/v1.13/docs/index.html), [Saving and Sharing](https://help.desmos.com/hc/en-us/articles/4405901719309-Saving-and-Sharing-Your-Work)). Tier: a similar local JSON document (localStorage + URL hash, versioned) is MVP; accounts, cloud save, live share links, image export are Never/Later.

### 1.10 Never

Accounts, cloud save and Desmos share links; Classroom/Activity Builder; regressions, inference and distributions; images, tickers and actions; Braille/embosser output and print; complex mode, 3D and Geometry; embedding the Desmos API (proprietary, key-gated); and the Desmos name or branding (MIT grants on Desmos repos convey no trademark rights).

## 2. How Desmos-class plotting works

### 2.1 Pipeline

Keystrokes become LaTeX in MathQuill on the main thread; parsing is three passes (LaTeX → display tree → precedence-aware expression tree → a "lower" pass to context-specific nodes); "Each parse node knows how to return a JavaScript function representation of itself"; changesets are batched because a frame change can invalidate every expression; the worker returns an array of tiny line segments that the main thread styles and draws on canvas ([Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/)). The 2025 paper confirms "the calculator's math engine runs in a pool of workers", emits "strings of JavaScript or GLSL source code", and uses "several hand-written Pratt parsers" ([SIGGRAPH 2025](https://dl.acm.org/doi/10.1145/3721243.3735987), [SIGGRAPH history entry](https://history.siggraph.org/experience/real-time-graphics-in-desmos-with-just-math-and-a-browser-by-shaw-and-luberoff/)); the 2D grapher draws to a Canvas 2D context (`canvas.dcg-graph-inner`, `gridLayer.redrawToCtx`) while WebGL is used for 3D ([Jared Hughes gist](https://gist.github.com/jared-hughes/d9a27764c7f8a6e07ba7e2aa89fb5f10), [HN Desmos 3D thread](https://news.ycombinator.com/item?id=37859085)). Guidance: keep Canvas 2D; compile to closures (not source strings) so no `unsafe-eval` is ever needed; sample on the main thread for the MVP with hard evaluation budgets, and move sampling into a Worker only when profiling demands it (the worker boundary is free if the sampled model is already a transferable typed array).

### 2.2 Parsing: Pratt parser with Desmos-style implicit multiplication

Desmos replaced a jison grammar with a hand-written Pratt parser: binding powers `+ -` 10, `* /` 20, `^` 30, right-associativity by recursing at power − 1, prefix ("initial") and infix ("consequent") parselets in maps keyed by token type; the result was about half the code (~20 KB → ~10 KB) and ~4x faster ([Pratt parser article](https://engineering.desmos.com/articles/pratt-parser/); sample code [desmosinc/pratt-parser-blog-code](https://github.com/desmosinc/pratt-parser-blog-code)). matklad's write-up gives the whole algorithm in ~40 lines ([Simple but Powerful Pratt Parsing](https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html)). The Desmos-specific additions are not in the article: juxtaposition as multiplication with single-letter identifier splitting (`mx` → m·x), function application both `f(x)` and `sin x`, `|x|` as a primary, subscripts, tuples for points/parametrics, and relations `= < > ≤ ≥` as top-level nodes. Practical binding-power choices that reproduce Desmos reading order (documented as prose in an unlicensed repo, so re-derive, do not copy): implicit product at the `*` level so `1/2x` = (1/2)·x in text, implicit function argument at 21 so `sin 2x` = sin(2x), prefix minus at 25 so `−x²` = −(x²), `^` at 30 right-assoc, postfix `!` at 40, a number never starting an implicit product (`x2` is an error) ([graphing-calc README](https://github.com/GabrielDeml/graphing-calc/blob/main/README.md)). mathjs documents the alternative convention where `1/2x` is also (1/2)·x and implicit multiplication binds tighter than `*` ([mathjs syntax](https://mathjs.org/docs/expressions/syntax.html)).

### 2.3 Compilation and evaluation

Desmos compiles each node to a JavaScript function resolved against the frame ([Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/)). Two JS libraries compile to source strings bound with `new Function` (math-codegen, compute-engine) and one (expr-eval) stringifies RPN into `new Function` with nested `with` blocks; the first two tied to CVEs or CSP `unsafe-eval` dependence (§3). Guidance: compile the AST to nested closures over a shared scope (register file or `Map`), inline user functions after rejecting definition cycles, read slider values from a shared array so slider moves never recompile, fold constant subtrees by running the closure once, and budget node counts (compute-engine's `CompilationResult` fields `freeSymbols`, `unsupported[]`, `fallback` are a good checklist; [compile-expression.ts](https://github.com/cortex-js/compute-engine/blob/main/src/compute-engine/compilation/compile-expression.ts)). Degree mode should be a compile-time flag on trig nodes so plot and audio evaluate identically.

### 2.4 Explicit sampling and discontinuity detection

Desmos's explicit plotter "start[s] with a bunch of evenly spaced on-screen values along one axis", merges nearly collinear points into segments, and "use[s] bisection" to locate zero crossings, extrema and jumps; parametrics use recursive adaptive subsampling "sensitive to curvature"; polar checks whether the compiled function is periodic ([Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/)). Wolfram frames the same tunables: initial equally spaced `PlotPoints`, adaptive subdivision at most `MaxRecursion` times, and `Exclusions` that break curves "at discontinuities and singularities it detects" ([Wolfram Plot](https://reference.wolfram.com/language/ref/Plot.html)). Guidance:

- Seed one sample per 1–2 px, offset by an irrational phase, and never bisect at the exact midpoint: de Figueiredo's gem splits at t = 0.45 + 0.1·rand so periodic structure cannot align with the samples (fixed-midpoint bisection of sin(πx) on integer endpoints collapsed to one straight segment in the deep read) ([aspc.c](https://raw.githubusercontent.com/erich666/GraphicsGems/master/gemsv/ch4-4/aspc.c)); use a seeded PRNG so renderer and audio see a reproducible curve.
- Refine where the polyline is not flat in screen space (perpendicular deviation ≳ 0.25 px, or Bayer's angle criterion with a 1–10° threshold), with a depth cap, an explicit stack, and a global evaluation budget ([Bayer 2018](https://ojs.cvut.cz/ojs/index.php/gi/article/view/gi.17.2.2)).
- Detect discontinuities locally rather than by slope alone: an infinite discontinuity if |f| exceeds a threshold or is ±Inf/NaN at x ± h; jump/removable via the LR smoothness ratio (f_r² − f_l²)/(f_r² + f_l²) > 0.8 with one-sided differences ([Bayer 2018](https://ojs.cvut.cz/ojs/index.php/gi/article/view/gi.17.2.2)); function-plot's cheaper heuristic starts a new polyline when the sign of Δy flips with |dy/dx| > 1 and confirms with 10 subsamples × 3 levels ([function-plot builtIn.ts](https://raw.githubusercontent.com/mauriciopoppe/function-plot/main/src/samplers/builtIn.ts)). Interval evaluation gives a certificate instead: a `whole` result means a pole in that column ([function-plot interval.ts](https://raw.githubusercontent.com/mauriciopoppe/function-plot/main/src/samplers/interval.ts)).
- Bisect toward domain edges so log x and √x end exactly; clip output to a band one viewport beyond each edge so it is bounded and Infinity-free; record each break as a typed event (asymptote / jump / hole / domain edge) because the sonifier needs the same breaks.

### 2.5 Implicit plotting: marching squares vs interval-arithmetic quadtree

Desmos does not use interval arithmetic (no public evidence). A userscript that patches `core/math/implicit-plotter` shows: quads at depth < 5 are always subdivided; leaves stop for outside-screen, too-small, all-undefined (NaN at all four vertices), low-curvature-and-no-crossing, or a hard cap of 2^14 leaves; segments connect midpoints of subdivided edges; and the implicit plotter is skipped whenever the equation can be solved analytically (`y=sin(x)`, `x^2=cos(y)` generate no quadtree) ([Jared Hughes quadtree viewer](https://gist.github.com/jared-hughes/d9a27764c7f8a6e07ba7e2aa89fb5f10), [resolution gist](https://gist.github.com/jared-hughes/adac228ecf81a6a455e1181e8e8e87bf)); the blog describes sampling from quadtree vertices, subdividing where the sign changes, triangulating and building boundary polygons ([Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/)). Marching squares: a 4-bit corner index into a 16-case table with linear-interpolated edge crossings; the two saddle cases are ambiguous and are resolved by comparing the cell center against the isovalue (or by triangulating, which has no ambiguity) ([Marching squares](https://en.wikipedia.org/wiki/Marching_squares), [Marching cubes](https://en.wikipedia.org/wiki/Marching_cubes)). Known failure modes of pure sign sampling: curves entirely inside one cell, two crossings per cell, sign changes without approaching zero (poles drawn as verticals), and zero sets without sign change such as (x−y)²=0 ([GeoGebra implicit write-up](https://shamshad-npti.github.io/implicit/curve/2015/10/08/Implicit-curve/)). The guaranteed alternative is interval branch-and-bound: Tupper's three-valued pixel classification with domain and continuity tracking ([Tupper 2001](https://www.dgp.toronto.edu/~mooncake/papers/SIGGRAPH2001_Tupper.pdf)), Snyder's globally parameterizable cells ([Snyder 1992](https://microsoft.com/en-us/research/wp-content/uploads/2017/01/snyder0_siggraph92.pdf)), Lopes et al.'s discard-when-0∉F(X) plus gradient-interval flatness via automatic differentiation ([Lopes et al.](https://lhf.impa.br/ftp/oral/sib2001.pdf)), all descending from Suffern's quadtree contouring ([Suffern 1990](https://doi.org/10.1093/comjnl/33.5.402)); graphest implements Tupper faithfully in Rust ([graphest](https://github.com/unageek/graphest)). Guidance for Morphazoid: MVP+1 uses a world-aligned coarse grid (~8 px cells, 12 px while interacting) evaluated once, candidate cells (sign change among finite corners, dilated by one cell) refined on a 4×4 subgrid, saddles resolved by sampling F at the cell center, every edge crossing verified by a 1-D root search so poles (tan x − y) and jumps (⌊x⌋ − y) are dropped, segments stitched into polylines, with evaluation budgets (~120k interactive / 400k final). Keep interval pruning (0 ∉ F(box) → skip; `singular`/`entire` → subdivide) as the later upgrade; compute-engine's `interval-js` result kinds `interval | empty | entire | singular{pole|jump} | partial{domainClipped}` are the right per-cell/per-sample vocabulary ([Compute Engine compiling guide](https://mathlive.io/compute-engine/guides/compiling/), [interval types.ts](https://github.com/cortex-js/compute-engine/blob/main/src/compute-engine/interval/types.ts)).

### 2.6 Nice-number axes

Heckbert's `nicenum`: f = x/10^⌊log10 x⌋ snapped to 1/2/5/10 with thresholds f<1.5→1, f<3→2, f<7→5 when rounding (≤1, ≤2, ≤5 for the ceiling); `loose_label` picks d = nicenum(range/(ntick−1)) and decimal places max(−⌊log10 d⌋, 0) ([Label.c](https://www.realtimerendering.com/resources/GraphicsGems/gems/Label.c)). d3's version snaps on log-midpoints (√50, √10, √2) and generates tick i as (i1+i)·inc, or (i1+i)/inc for negative powers, so `ticks(0,1,10)` is exactly 0.1…1 rather than 0.30000000000000004 ([d3-array ticks.js](https://raw.githubusercontent.com/d3/d3-array/main/src/ticks.js)). Talbot et al. formalize density targeting (score = 0.25·simplicity + 0.2·coverage + 0.5·density + 0.05·legibility) for when labels must appear and disappear smoothly while zooming ([Talbot, Lin, Hanrahan 2010](http://graphics.stanford.edu/vis/publications/2010/labeling-preprint.pdf)). Desmos's own automatic step algorithm is undocumented; only `pixelsPerLabel` 80 and "Minor Grid will show quarter marks between your step value" are verifiable ([Graph Settings](https://help.desmos.com/hc/en-us/articles/4405296853517-Graph-Settings)). Guidance: derive the major count from pixel width (~80–100 px per label), compute minors as step/5 (step/4 for 2·10^k), label by integer index with `toFixed(decimals)` and switch to exponent form outside ~[1e−7, 1e21), clamp the relative span to ≥1e−12 before calling the ticker, and add a π-multiples ladder later.

### 2.7 DPR-aware canvas

Set CSS size on the element, `canvas.width = Math.floor(cssSize * devicePixelRatio)`, `ctx.scale(dpr, dpr)`, and re-register a `matchMedia('(resolution: Ndppx)')` change listener each time the ratio changes ([MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio), [web.dev HiDPI canvas](https://web.dev/articles/canvas-hidipi)). Fractional CSS×DPR sizes blur; `ResizeObserver` with `box: 'device-pixel-content-box'` gives exact device pixels (Chrome 84+, Firefox 108; not Safari, so feature-detect) ([web.dev device-pixel-content-box](https://web.dev/articles/device-pixel-content-box)). Snap grid lines to device pixels with half-pixel offsets; clamp far off-screen coordinates (±1e4 px) because canvas backends misbehave with huge values.

### 2.8 Pan/zoom transform

The whole world↔screen mapping is `Transform(k, x, y)` with `apply = x·k + tx`, `invert = (x − tx)/k`; zoom about the cursor is "invert the pointer, scale, re-translate so the inverted point maps back" ([d3-zoom transform.js](https://raw.githubusercontent.com/d3/d3-zoom/main/src/transform.js)). Desmos allows independent axis scaling and square-axes mode, so model the viewport as `{cx, cy, ppuX, ppuY}` (pixels per unit per axis), pan by pixel deltas, zoom per axis with a factor about an anchor, pinch from two pointer deltas, and clamp |center|·ppu to ~1e15 so panning never quantizes into staircases. Gesture handling: one-finger drag pans ("greedy") unless "cooperative" is chosen ([API v1.13](https://www.desmos.com/api/v1.13/docs/index.html)); use Pointer Events with `setPointerCapture` and `touch-action: none` on the canvas (document-level `touchmove` handlers are passive by default since Chrome 56, so `preventDefault` there is ignored — [Chrome scrolling intervention](https://developer.chrome.com/blog/scrolling-intervention)).

### 2.9 Points of interest

Find sign changes of f, f′ (numeric), and f−g on the sampled polyline, then refine with bisection/Brent on the real closure (Desmos uses bisection for zero crossings, extrema and jumps — [Pressing a Key](https://engineering.desmos.com/articles/press-a-key-in-the-calculator/)); intersections to ≥5 decimals ([What's New](https://help.desmos.com/hc/en-us/articles/4405017454477--What-s-New-at-Desmos-Studio)); declutter by pixel distance. Store typed POIs in the model so the UI's gray dots and the audio trace's Tab stops are the same list.

### 2.10 Performance envelope

Desmos keeps work interactive with hard budgets (2^14 implicit leaves; "too complicated… plotted at lower resolution") and a worker pool. For a single-threaded MVP: per-row evaluation budgets (~40k explicit, ~60k parametric, ~400k implicit), two quality levels (interactive while panning, final at rest), caching keyed by (expression identity, view, slider values the row depends on), and `requestAnimationFrame` coalescing of redraws. Measured reference points: a compiled closure costs ~30 ns per sample, mathjs ~190 ns, function-plot's compile+eval of 1000 samples ~1 ms ([function-plot pipeline](https://mauriciopoppe.github.io/function-plot/)).

## 3. Open-source landscape

Legend for the license column: **V** = deep-read with adversarial verification (LICENSE file read, npm/GitHub cross-checked); **S** = sweep read the LICENSE/package.json; **R** = reported via GitHub badge/API or README only. "Bundler-free?" means a plain `<script>`/ES-module artifact exists that can be vendored unmodified.

### 3.1 Desmos-authored or Desmos-adjacent

| Name | URL | License (status) | Stack | Bundler-free? | Features | Verdict | Rationale |
|---|---|---|---|---|---|---|---|
| Desmos calculator bundle / embed API | [desmos.com/api](https://www.desmos.com/api) | Proprietary; API key required; self-hosting partner-only | Minified JS | n/a | Everything | Skip (reference only) | Cannot be vendored; behavior is the spec |
| desmosinc/mathquill (Desmos fork) | [github](https://github.com/desmosinc/mathquill) | MPL-2.0 (V; no LICENSE file in fork — asserted by package.json, README, MPL header baked into builds) | TS → one ES5 IIFE + CSS + Symbola fonts; zero runtime deps since Interface v3 | Yes after `npm ci && make` (build/ gitignored, no releases) | Math input editor only | Vendor (self-built, pinned to bb9974a 2026-08-07) | The actual Desmos editor; 157 KB min / 42 KB gz full build; Desmos now calls it unmaintained in favor of DesQuill |
| @desmos-community/mathquill 2026.8.7 | [builder repo](https://github.com/desmos-community/mathquill-builder), [npm](https://www.npmjs.com/package/@desmos-community/mathquill) | MPL-2.0 (V; full text in tarball) | Prebuilt `dist/index.global.js` 134,563 B + `style.css` 12,784 B + 3-line ESM shim | Yes | Math input editor (basic build: no backslash LaTeX entry) | Vendor (pinned bytes, SRI verified) | Only prebuilt Desmos-fork build; fonts missing (`dist/fonts` absent, root-caused to sd 1.1.0), nightly workflow disabled, single volunteer maintainer |
| mathquill/mathquill (upstream) | [github](https://github.com/mathquill/mathquill) | MPL-2.0 (V) | TS; jQuery-free master since PR #1031 (2025-06-02); npm 0.10.1-a (2016) still requires jQuery | Only via own `make` | Math input editor | Vendor-alternative | Stalled since June 2025; prefer the Desmos fork |
| @openwebwork/mathquill 0.11.6 | [github](https://github.com/openwebwork/mathquill) | MPL-2.0 (V; custom short notice, GitHub shows NOASSERTION) | Webpack IIFE + native ESM, no jQuery | Yes | Math input editor | Skip | Divergent WeBWorK rewrite, not the Desmos feature set; disproves "nightly is the only jQuery-free build" |
| desmosinc/desquill | [github](https://github.com/desmosinc/desquill) | MPL-2.0 (R; README only, no LICENSE/package.json) | TS source only, no build | No | Editor with Fluent Mathspeak/ARIA | Borrow-ideas | Desmos's successor editor; needs a compile step; no external PRs |
| desmosinc/pratt-parser-blog-code | [github](https://github.com/desmosinc/pratt-parser-blog-code) | MIT (V; package.json says ISC — boilerplate discrepancy) | TS + fuse-box demo; `dist/app.js` is a 467 KB app bundle with CodeMirror + HMR client | No | Parser skeleton only (`+ - * / ^ ( )` numbers) | Port-code | 105-line faithful port verified; needs unary minus, identifiers, implicit multiplication, relations; two latent bugs noted |
| desmosinc/scrubber | [github](https://github.com/desmosinc/scrubber) | MIT (V) | 195-line ES5 classic script | Yes (global; add `export`) | Slider widget | Borrow-ideas | 2013 code: passive-touch bug, no ARIA/keyboard, listener leaks; take the float-safe step snapping and start/change/end contract |
| DesModder | [github](https://github.com/DesModder/DesModder) | MIT (R) | TS browser extension | n/a | Documents Desmos state schema, GLesmos GPU fills, text-mode syntax | Borrow-ideas | Relies on undocumented Desmos internals |
| unofficial-desmos-wiki | [github](https://github.com/radian628/unofficial-desmos-wiki) | MIT (R) | Docs | n/a | Obscure Desmos semantics | Borrow-ideas | Behavior reference |

### 3.2 Math input and display

| Name | URL | License (status) | Stack | Bundler-free? | Features | Verdict | Rationale |
|---|---|---|---|---|---|---|---|
| MathLive 0.111.1 | [github](https://github.com/arnog/mathlive) | MIT (V) | `<math-field>` web component; `mathlive.min.mjs` 843,079 B (227 KB gz) + 20 KaTeX woff2 (260 KB); zero deps | Yes (flat package, no `dist/`) | Editor with virtual keyboard, LaTeX/ASCIIMath/speakable-text output | Vendor-alternative | MIT route if MPL/Symbola blocks MathQuill; 0.111.0 removed MathJSON/`expression`; set `soundsDirectory = null` to avoid a second AudioContext |
| KaTeX 0.19.0 | [github](https://github.com/KaTeX/KaTeX) | MIT (V) | `dist/katex.mjs` 603 KB (zero imports) or UMD 273 KB + CSS + fonts | Yes | Display only; `render-a11y-string` speech | Vendor (optional, deferrable) | Pretty-print rows and spoken labels; no editing or evaluation |
| Symbola font (bundled 2009/2015 versions) | [MathQuill wiki Fonts](https://github.com/mathquill/mathquill/wiki/Fonts) | Old terms "free for any use" (R); versions after 10.23 (2018) are personal/non-commercial only ([UFAS license](https://dn-works.com/wp-content/uploads/UFAS/License.pdf), [xahlee note](http://xahlee.info/comp/symbola_font_no_longer_free.html)) | woff2 | Yes | Glyphs for √ ∑ ∫ etc. | Vendor old subset with notice, or `OMIT_FONT_FACE=1` | Never refresh from the author's current site; needs a legal glance |

### 3.3 Expression parsers and evaluators

| Name | URL | License (status) | Stack | Bundler-free? | Features | Verdict | Rationale |
|---|---|---|---|---|---|---|---|
| mathjs 15.2.0 | [github](https://github.com/josdejong/mathjs) | Apache-2.0 (V) — full build also contains LGPL-2.1+ CSparse port, and the UMD ships without that notice ([README license](https://github.com/josdejong/mathjs#license), [issue #3162](https://github.com/josdejong/mathjs/issues/3162)) | UMD `lib/browser/math.js` 650 KB / 175 KB gz; `lib/esm` not browser-loadable (bare specifiers, 4 CJS deps, [issue #1841](https://github.com/josdejong/mathjs/issues/1841)) | UMD only (classic `<script>`); jsDelivr `+esm` is CDN-only | Parser with implicit multiplication, `f(x)=`, derivative, simplify, toTex | Skip for MVP (fallback engine) | Heavy; LGPL component in the only self-contained artifact; `xy` is one identifier, `=` is assignment, unit names like `m`/`b` resolve to Units in the full build |
| expr-eval 2.0.2 | [github](https://github.com/silentmatt/expr-eval) | MIT (V) | 48 KB ESM, zero imports | Yes | Evaluator, `toJSFunction` | Port-code (reference only) | Three unfixed CVEs (CVE-2025-13204, CVE-2025-12735, CVE-2026-12866 via `toJSFunction`); no implicit multiplication; abandoned since 2019 release |
| expr-eval-fork 3.0.3 | [github](https://github.com/jorenbroekema/expr-eval) | MIT (V) | 51 KB ESM | Yes | Same, fixes two CVEs | Skip | Still ships `new Function`+`with` `toJSFunction`; no implicit multiplication |
| jsep 1.6.0 | [github](https://github.com/EricSmekens/jsep) | MIT (S) | 28 KB ESM, parser only | Yes | JS-shaped AST (`^` is XOR by default) | Skip | Re-tabling operators plus hooks for implicit multiplication equals writing a Pratt parser |
| math-codegen 0.4.3 (+ mr-parser, built-in-math-eval, interval-arithmetic-eval) | [github](https://github.com/mauriciopoppe/math-codegen) | math-codegen MIT (V, LICENSE file); the three siblings MIT by package.json/header only, no LICENSE file (V, refuted "read-license-file") | CommonJS only; jsDelivr `+esm` = 8 cross-linked files | No | AST → namespace-call JS string → `new Function`; float and interval adapters | Port-code (pattern) | CVE-2026-41507 ([GHSA-p6x5-p4xf-cc4r](https://github.com/advisories/GHSA-p6x5-p4xf-cc4r)); fix incomplete (array-literal raw path, [issue #13](https://github.com/mauriciopoppe/math-codegen/issues/13) unanswered); the pluggable-namespace idea is worth keeping |
| @cortex-js/compute-engine 0.153.0 | [github](https://github.com/cortex-js/compute-engine) | MIT (V) | ES2022 ESM; full engine = 3 files ~4.19 MB / 1.23 MB gz; standalone `interval.js` 200 KB / 58 KB gz | Yes (relative chunk imports) | LaTeX→MathJSON, compile to JS/interval-js/GLSL | Borrow-ideas now; vendor `interval.js` later | Weight and near-daily 0.x churn; `new Function` targets; interval result taxonomy is the model to copy |
| Peggy 5.1.0 | [docs](https://peggyjs.org/documentation.html) | MIT (S) | Offline generator, `--format es`, no runtime | Yes (generated file) | Grammar-based parser | Skip (escape hatch) | Only if the hand grammar grows unwieldy |
| nerdamer 2.0 / Algebrite / evaluatex / Kalker | [nerdamer](https://github.com/jiggzson/nerdamer), [Kalker](https://github.com/PaddiM8/kalker) | Apache-2.0 / MIT / MIT / MIT (S) | 541 KB UMD / 850 KB / 13 KB (dormant 2020) / Rust→WASM 602 KB | Yes | CAS / evaluation | Skip | Not needed for plotting; nerdamer uses dynamic code generation |

### 3.4 Plotting libraries, algorithms and papers

| Name | URL | License (status) | Stack | Bundler-free? | Features | Verdict | Rationale |
|---|---|---|---|---|---|---|---|
| function-plot 1.26.0 | [github](https://github.com/mauriciopoppe/function-plot) | MIT (S, LICENSE read) | UMD 211 KB with d3 bundled; SVG rendering | Yes | linear/implicit/parametric/polar/points, interval sampler, zoom | Borrow-ideas | SVG+d3 is the wrong renderer; its samplers (`builtIn.ts`, `interval.ts`, worker quads) are the best JS reference for both sampling strategies |
| interval-arithmetic 1.1.3 | [github](https://github.com/mauriciopoppe/interval-arithmetic) | BSL-1.0 (V; source header says MIT — LICENSE governs; not on allow-list) | UMD `dist/bundle.js` 24 KB (global `Interval.default`, `self`-rooted) or lib-esm after a verified specifier rewrite | Yes | Outward-rounded interval kernel | Vendor later, conditional on BSL-1.0 sign-off | `pow` non-integer → EMPTY + console.warn; `sin` precision issue #40; UMD cannot load in an AudioWorklet |
| d3-array 3.2.4 `src/ticks.js` | [github](https://github.com/d3/d3-array) | ISC (V; 2.x was BSD-3) | 55 lines, zero imports | Yes | 1-2-5 ticks, float-exact | Vendor (if ISC accepted) or port | `nice()` has an unmerged rounding fix ([PR #283](https://github.com/d3/d3-array/pull/283)); do not vendor `src/index.js` (bare `internmap`) |
| d3-zoom 3.0.0 `src/transform.js` | [raw](https://raw.githubusercontent.com/d3/d3-zoom/main/src/transform.js) | ISC (S) | ~40 lines, zero imports | Yes | Camera math | Borrow-ideas | Trivially re-derived; Desmos needs per-axis scale anyway |
| d3-contour 4.0.2 | [github](https://github.com/d3/d3-contour) | ISC (V) | UMD 5,729 B that requires d3-array UMD loaded first and a shared `window.d3`; src has bare `d3-array` import | UMD only (two files, globals) | Marching squares → GeoJSON MultiPolygons, always closed along the frame | Port-code | Take `smoothLinear`, NaN/±Inf policy, hole assignment into Morphazoid's own stitcher; frame-closure problem ([issue #72](https://github.com/d3/d3-contour/issues/72)) |
| marching-squares-contours | [github](https://github.com/MohammadHossinzehi/marching-squares-contours) | MIT (R; 0 stars, not deep-read) | Zero-dep ESM | Yes | Isolines → stitched open/closed polylines, saddle via center value, RDP simplify | Vendor-candidate pending LICENSE read | Young single-author repo; verify the LICENSE file and tests before trusting |
| JSXGraph 1.14.0 | [github](https://github.com/jsxgraph/jsxgraph) | MIT OR LGPL-3.0-or-later (S; LICENSE.MIT present, GitHub badge shows LGPL) | Single file 994 KB (UMD) / 1,025 KB (ESM) | Yes | Full geometry/plotting, curve-tracing `ImplicitPlot`, own interval arithmetic | Borrow-ideas | Too large and geometry-oriented; read `implicitplot.js` for tracing-based implicits |
| graphest 1.9.1 | [github](https://github.com/unageek/graphest) | MIT source (V) but binaries GPL-2.0+ via static FFTW and LGPL-3.0+ via FLINT/GMP/MPFR (V) | Rust nightly + Electron/React; no WASM possible today ([inari #85](https://github.com/unageek/inari/issues/85)) | No | Tupper-faithful explicit/implicit/parametric/polar/inequalities | Borrow-ideas | Reference for a later verified mode; `Examples.md` + 190 reference PNGs are a hard-case regression corpus |
| Open-GraphEq | [github](https://github.com/maximsmol/Open-GraphEq) | MIT (R) | C++ | No | Tupper refinement loop | Borrow-ideas | Short, readable reference implementation |
| Graphics Gems `Label.c`, `aspc.c` | [repo](https://github.com/erich666/GraphicsGems), [LICENSE.md](https://github.com/erich666/GraphicsGems/blob/master/LICENSE.md) | SPDX `Graphics-Gems` (V; corrects the sweep's "no SPDX id"; GitHub shows NOASSERTION; permissive, not OSI-approved, not on allow-list; [SPDX entry](https://spdx.org/licenses/Graphics-Gems.html)) | C | n/a | Nice numbers; adaptive parametric sampler | Port-code (≈80 lines) | gems/README asks to retain the author header; `aspc.c` flatness is in world units and never terminates across poles — port the idea, not the code |
| Tupper 2001 / Snyder 1992 / Lopes 2002 / Suffern 1990 / Bayer 2018 / Talbot 2010 | see §2 | Papers | — | — | Algorithms | Borrow-ideas | Cited in §2 |
| bayertom/sampling | [github](https://github.com/bayertom/sampling) | None (R) | Java | No | Bayer's demo | Skip | No license; use the paper |
| RaumZeit/MarchingSquares.js | [github](https://github.com/RaumZeit/MarchingSquares.js) | **AGPL-3.0** (S) | JS | Yes | isoLines/isoBands | **Excluded** | Copyleft incompatible with the policy |
| spirulae | [github](https://github.com/harry7557558/spirulae) | **GPL-3.0** + CC BY-NC-SA shaders (S) | WebGL | — | GPU 2D/3D grapher | **Excluded** | Inactive; license |
| equation.io (graph.tk successor) | [github](https://github.com/aantthony/equation.io) | MIT on main; legacy branch LGPL-3.0 (S) | TS + Vite, GLSL distance-estimate rendering, no published dist | No | Parser/CAS, sliders, GPU implicit | Borrow-ideas | Pixel-shader output is not a sampled model |
| complexmos / Truthy Graph / CindyJS | [complexmos](https://github.com/sam-lb/complexmos), [truthygraph](https://github.com/calebmadrigal/truthygraph), [CindyJS](https://github.com/CindyJS/CindyJS) | MIT / MIT / Apache-2.0 (S) | WebGL / canvas+math.js / Cindy.js | Mixed | GPU complex plots / fuzzy-truth shading / geometry framework | Skip | Far from a Desmos list UI |

### 3.5 Full calculators (reference only)

| Name | URL | License (status) | Stack | Bundler-free? | Features | Verdict | Rationale |
|---|---|---|---|---|---|---|---|
| UtlCalculator ("UltCalc"/"FreeCalc") | [github](https://github.com/NazreenNasyuha/UtlCalculator) | None — README says "Free to use, modify, and share" only (V) | Vanilla ES modules + Canvas 2D; single-file bundle 270 KB | Yes | Expression list, auto sliders, adaptive marching squares, polar/parametric, inequalities, trace, URL state | Borrow-ideas | Closest architectural match but unlicensed; re-parses per sample; graph.js hard-wires 36 DOM ids |
| GabrielDeml/graphing-calc | [github](https://github.com/GabrielDeml/graphing-calc) | None (V; 47/49 commits AI-authored in 3 days) | TS + SolidJS + Vite PWA | No | Pratt parser, closure compiler, adaptive samplers, root-verified marching squares, sliders, insights | Borrow-ideas (prose spec) | Best Desmos-UX spec found; copy nothing |
| DesmosDT / OmniGraph | [github](https://github.com/Arjun-Anubis/DesmosDT) | None (R) | Vanilla + jQuery + MathQuill | Yes | MathQuill sidebar, add-slider prompts, POI snapping, CAS | Borrow-ideas | Unlicensed |
| GraphToy | [graphtoy.com](https://graphtoy.com/) | None (R) | ~580-line vanilla script | Yes | compile-to-Function, per-pixel sampling, t animation | Borrow-ideas | Unlicensed; uses `Function` constructor |
| PullJosh/graphonic-calculator | [github](https://github.com/PullJosh/graphonic-calculator) | None (S) | Next.js + Rust/WASM dual contouring | No | Quadtree + dual contouring | Borrow-ideas | Unlicensed |
| Cartesium | [tangled](https://tangled.org/oscillatory.net/cartesium) | 0BSD OR Apache-2.0 (S) | TS/Rust/Svelte, pre-alpha | No | 2D/3D calculator | Watch | Svelte-bound; README unreachable |
| Graphr / js-graphy / QuickPlotJS / Develifture / atharva1567 | [Graphr](https://github.com/yerich/Graphr), [js-graphy](https://github.com/laktak/js-graphy), [QuickPlotJS](https://github.com/d12/QuickPlotJS), [Develifture](https://github.com/Develifture/scientific-calculator) | MIT (S/R) | Vanilla canvas | Yes | Small graphers (zoom/pan/trace/roots) | Borrow-ideas | None is Desmos-class; safe to borrow small routines |
| Mafs / math3d-react / MathBox | [Mafs](https://github.com/stevenpetryk/mafs) | MIT / MPL-2.0 / MIT (R) | React / React / Three | No | UX references | Skip | Framework-bound |
| GeoGebra | [license](https://www.geogebra.org/license), [repo](https://github.com/geogebra/geogebra) | **EUPL-1.2 source; installers/web non-commercial only; UI assets CC BY-NC-SA 4.0** | Java/GWT | No | Full suite | **Excluded** | "Any use of GeoGebra for a commercial purpose… requires a special license" |
| NumWorks Epsilon | [github](https://github.com/numworks/epsilon) | **All rights reserved** (README) | C++/emscripten | No | Calculator OS | **Excluded** | Public source, proprietary terms |
| fooplot / kalc / sinerider | [fooplot](https://github.com/dheera/fooplot), [kalc](https://github.com/bgkillas/kalc), [sinerider](https://github.com/hackclub/sinerider) | **LGPL-3.0 / GPL-3.0 / AGPL-3.0** (S) | — | — | — | **Excluded** | Copyleft |

### 3.6 Sonification libraries and references

| Name | URL | License (status) | Stack | Bundler-free? | Features | Verdict | Rationale |
|---|---|---|---|---|---|---|---|
| chart2music 1.20.0 | [github](https://github.com/julianna-langston/chart2music) | MIT (S; package.json and bundle header read) | Self-contained `dist/index.mjs` ~305 KB | Yes | Keyboard sonification of series: 108-note HERTZ table, speeds 25–1000 ms, sine+triangle-FM voice, pan clamp ±0.98, compressor | Borrow-ideas (vendorable if wanted) | Chart-oriented; constants and key model are proven defaults |
| Tone.js | [github](https://github.com/Tonejs/Tone.js) | MIT (S) | UMD 345 KB | Yes | Synth/scheduling framework | Skip | Plain `OscillatorNode`/`StereoPannerNode`/`PeriodicWave` suffice |
| Erie | [github](https://github.com/see-mike-out/erie-web) | MIT (S) | Depends on D3/Arquero/Vega/Moment | No | Declarative sonification grammar | Borrow-ideas | Copy the settings vocabulary (continued tone, ramp, polarity, overlay vs sequence) |
| sonifier (UW) | [github](https://github.com/athersharif/sonifier) | BSD-3-Clause per sidebar, MIT per README badge (R; inconsistent) | Small JS | Yes | Audio graphs | Borrow-ideas | Minimal reference |
| function-curve-viewer | [github](https://github.com/chdh/function-curve-viewer) | MIT (S) | TS web component, zero deps | Yes | Waveform/envelope viewer | Borrow-ideas | Useful for the wavetable renderer's display |
| Highcharts sonification + Sonification Studio | [license](https://shop.highcharts.com/license), [studio](https://github.com/highcharts/sonification-studio) | **Proprietary, source-available** (studio BSD-3 but depends on Highcharts) | — | — | Richest mapping schema | **Excluded** (design reference) | "Any use of the Software on a Public Website requires the purchase of a SaaS License" |
| Audiofunctions++ | [github](https://github.com/SONAIRGRAPH/audiofunctions-plus) | **AGPL-3.0** (S) | Vite app | — | Function sonifier (pitch=y, pan=x, noise for y<0, earcons) | **Excluded** (UX reference) | Copyleft |
| maidr | [github](https://github.com/xability/maidr) | **GPL-3.0-or-later** (S) | TS | — | Multimodal chart access | **Excluded** (UX reference) | Copyleft |
| math-to-sound / sonifystem | [math-to-sound](https://github.com/katew918/math-to-sound), [sonifystem](https://github.com/ashwinH18/sonifystem) | None (R) | React/Vite | No | Shared 2048-sample array read by canvas and audio; `setValueCurveAtTime` pitch mode; single-cycle timbre mode / slope→sawtooth | Borrow-ideas | Unlicensed; re-implement the two renderer ideas |

### 3.7 License flags to decide explicitly

- Not on the allow-list but permissive: ISC (d3-array, d3-contour, d3-zoom; MIT-equivalent obligations), BSL-1.0 (interval-arithmetic; OSI-approved, notice required for source-form copies including minified JS — [OSI BSL-1.0](https://opensource.org/license/bsl-1-0)), `Graphics-Gems` (not OSI-approved), 0BSD (Cartesium), custom MIT-style notices (@openwebwork). A ported algorithm from a BSL-1.0 library is still a derivative work; a clean-room implementation from the papers is not.
- MPL-2.0 (MathQuill) is file-level copyleft: ship the LICENSE and keep the header; any modified MathQuill file must be published under MPL; Morphazoid's own code is an unaffected Larger Work. Style overrides belong in a separate stylesheet to avoid modifying `style.css`.
- The Symbola subset bundled with MathQuill is not MPL-licensed and its author later moved to non-commercial terms; the bundled 2009/2015 binaries predate the change ([Fedora note](https://fedoraproject.org/wiki/Gdouros_Symbola), [Debian copyright](https://metadata-backend.ftp-master.debian.org/changelogs/main/t/ttf-ancient-fonts/testing_copyright)).
- mathjs's only self-contained artifact embeds LGPL-2.1+ CSparse code without a notice in the shipped files ([csLu.js header](https://github.com/josdejong/mathjs/blob/develop/src/function/algebra/sparse/csLu.js), [UMD license sidecar](https://cdn.jsdelivr.net/npm/mathjs@15.2.0/lib/browser/math.js.LICENSE.txt)); LGPL is on neither list — avoid.
- Excluded outright: MarchingSquares.js (AGPL-3.0), spirulae (GPL-3.0), GeoGebra (EUPL + non-commercial), NumWorks (all rights reserved), fooplot (LGPL-3.0), kalc (GPL-3.0), sinerider (AGPL-3.0), Audiofunctions++ (AGPL-3.0), maidr (GPL-3.0+), Highcharts (proprietary), graphest binaries (GPL via FFTW — [FFTW license](https://www.fftw.org/fftw3_doc/License-and-Copyright.html)), the Desmos bundle, and every no-license repository (all rights reserved by default — [choosealicense](https://choosealicense.com/no-permission/)).
- Never use jsDelivr `+esm` or esm.sh outputs as vendored files: they import absolute CDN paths and jsDelivr warns "Do NOT use SRI with dynamically generated files" ([jsDelivr SRI note](https://www.jsdelivr.com/using-sri-with-dynamic-files)).

## 4. Build-vs-vendor recommendation for the MVP

Morphazoid conventions that apply (from the deep reads of the worktree): relative imports such as `../../../vendor/three/three.module.min.js`, no import maps anywhere, `vendor/<lib>/README.md` recording upstream tag, file URL, SHA256, license SHA256 and a modified/unmodified statement (precedent: `vendor/meshoptimizer/README.md`), a `THIRD_PARTY_NOTICES.md` section, and copy+require rows in `scripts/site/runtime-files.tsv`; `AGENTS.md` line 209 requires recording "material third-party provenance and licenses". Production CSP currently sets only `frame-ancestors 'self'`, so nothing forces `unsafe-eval` today — keep it that way by never using `new Function`.

| # | Component | Recommendation | Specific library / file | Reason |
|---|---|---|---|---|
| 1 | Expression parser + evaluator | **Hand-write** (vanilla ES module, ~400–600 LOC): tokenizer with Unicode normalization (· × ÷ − ≤ ≥ π θ √ ² ³, subscripts), Pratt parser with the Desmos binding powers (§2.2), single-letter juxtaposition splitting with a known-names table, `|x|`, tuples, relations as top-level nodes; compile AST → closures over a shared scope; free-variable discovery for sliders; positioned errors | Port the skeleton of [desmosinc/pratt-parser-blog-code](https://github.com/desmosinc/pratt-parser-blog-code) (MIT) and borrow test vectors from [expr-eval's precedence tests](https://github.com/silentmatt/expr-eval/blob/master/src/parser-state.js) as spec | Every ready-made evaluator fails on Desmos habits (`2x`, `θ`, `y=` vs `=`) or on security/CSP (expr-eval CVEs, math-codegen CVE, `new Function`), and the heavy ones (mathjs 650 KB w/ LGPL, compute-engine 4 MB) dwarf the instrument |
| 2 | Math input | **MVP: plain text** `<input>` per row with live normalization and the parser's error underline. **Phase 1.5: vendor MathQuill** — `@desmos-community/mathquill@2026.8.7` `dist/index.global.js` + `dist/index.mjs` + `dist/style.css` + `LICENSE` (SRI sha384 `eiP9c…` / `fixDV…`), plus `src/fonts/Symbola-basic.*` from [desmosinc/mathquill src/fonts](https://github.com/desmosinc/mathquill/tree/main/src/fonts) or an override `@font-face`; configure `autoCommands 'pi theta sqrt'`, `autoOperatorNames`, `charsThatBreakOutOfSupSub`, handlers `enter/upOutOf/downOutOf/deleteOutOf` ([docs/Config.md](https://github.com/desmosinc/mathquill/blob/main/docs/Config.md)); add a LaTeX front-end to the tokenizer (`\frac{}{}`, `\sqrt[]{}`, `\left( \right)`, `\cdot`, `\operatorname{}`, `^{}`, `_{}`) | Alternative: [MathLive](https://github.com/arnog/mathlive) (MIT, 843 KB) if MPL/Symbola are blockers; optional [KaTeX](https://github.com/KaTeX/KaTeX) for static previews | MathQuill is the Desmos typing feel at 135 KB; it is LaTeX-in/LaTeX-out only (`.text()` is lossy), which keeps the sampled model editor-agnostic; expect this to be the final nightly (workflow disabled, Desmos moved to DesQuill) |
| 3 | Explicit plotter | **Hand-write**: per-2 px seed grid with irrational phase, screen-space flatness refinement (0.25 px) with depth cap/budget, bisection toward NaN edges, break classification (asymptote/jump/hole/domain edge) recorded as events, output Float64Array polylines with NaN-pair pen-up clipped to ±1 viewport | Algorithms from [Bayer 2018](https://ojs.cvut.cz/ojs/index.php/gi/article/view/gi.17.2.2), [aspc.c](https://raw.githubusercontent.com/erich666/GraphicsGems/master/gemsv/ch4-4/aspc.c) (idea only), [function-plot builtIn.ts](https://raw.githubusercontent.com/mauriciopoppe/function-plot/main/src/samplers/builtIn.ts) | The sampler is the sonification model; it must be ours and typed-array based |
| 4 | Implicit plotter | **Hand-write (phase 1.5)**: generalize the existing Morphazoid stitched marching-squares extractor in `src/instruments/julia/julia.js` (center-sampled saddles, open+closed polylines) with the pieces d3-contour does better — linear crossing interpolation, NaN/±Inf policy, hole assignment ([d3-contour contours.js](https://raw.githubusercontent.com/d3/d3-contour/main/src/contours.js), ISC notice) — plus coarse→fine refinement and root-verified crossings. **Phase 2+**: interval pruning via vendored [compute-engine `interval.js`](https://cdn.jsdelivr.net/npm/@cortex-js/compute-engine@0.153.0/dist/esm-min/interval.js) (MIT, zero imports) or [interval-arithmetic `dist/bundle.js`](https://unpkg.com/interval-arithmetic@1.1.3/dist/bundle.js) (BSL-1.0, needs sign-off) | d3-contour's UMD needs d3-array first and a shared `window.d3`; MarchingSquares.js is AGPL; pure sign sampling misses tangencies and draws pole verticals unless crossings are verified |
| 5 | Axes/grid | **Hand-write labels and minor grid; optionally vendor** `d3-array/src/ticks.js` (ISC, 1,958 B, zero imports) if ISC is approved, else keep the in-house 1-2-5 ticker and port d3's `ticks-test.js` cases as the spec | [d3-array ticks.js](https://raw.githubusercontent.com/d3/d3-array/main/src/ticks.js), [Label.c](https://github.com/erich666/GraphicsGems/blob/master/gems/Label.c) | Tiny problem; the float-exact integer-index generation is the only subtle part |
| 6 | Pan/zoom | **Hand-write**: `{xMin,xMax,yMin,yMax}` ↔ `{cx,cy,ppuX,ppuY}` camera, pointer-event drag, wheel zoom about cursor, pinch, buttons, home/square-axes, precision clamp, DPR recipe | Semantics from [d3-zoom transform.js](https://raw.githubusercontent.com/d3/d3-zoom/main/src/transform.js) (ISC; ~40 lines, re-derive) and [MDN devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio) | No library earns its weight here |
| 7 | Sliders | **Hand-write**: native `<input type=range>` + editable min/max/step + play; auto-prompt "add slider: a, b, all" from free variables; defaults −10..10, continuous, 4 s loop forward-reverse; float-safe step snapping (min·invStep + n)/invStep; animation as an external 0..1 driver shared with the audio clock | Ideas from [desmosinc/scrubber](https://github.com/desmosinc/scrubber) (MIT; snapping L17–41, [PR #11](https://github.com/desmosinc/scrubber/pull/11) advice) and [numscrubberjs](https://github.com/mburakerman/numscrubberjs) (MIT, drag-to-scrub) | Native range inputs give keyboard and ARIA for free; scrubber's DOM code is obsolete |
| 8 | UI shell | **Hand-write** HTML/CSS: list pane + graph pane, stacked under 450 px, color icon toggles visibility, per-row status/evaluation, Ctrl+/ shortcut help, keyboard list navigation (Enter/Backspace/Up/Down), Morphazoid palette; register through the instrument surfaces (`src/pages/manifest.js`, `instrument-registry.js`, `instrument-catalog.js`, `catalogue-taxonomy.js`, `instrument-midi-capabilities.js`, `runtime-files.tsv`, catalogue fixtures, hash-guard amendments) | — | Framework-free by construction |
| 9 | Persistence | **Hand-write**: versioned JSON `{version, view, settings, rows:[{text, color, visible, slider, range}]}` in localStorage + URL hash, migrations in place | Shape mirrors Desmos's state JSON ([API v1.13](https://www.desmos.com/api/v1.13/docs/index.html)) | Lets examples and tests be imported |
| 10 | Tests | **Hand-write** node:test suites: parser precedence corpus, sampler break classification (1/x, tan x, ⌊x⌋, ln|x−c|, x^(1/3), sin(40/x)), ticks exactness, model/audio contract; use [graphest Examples.md](https://github.com/unageek/graphest/blob/main/Examples.md) as the hard-case list | — | The repo already runs ~450 guard tests; the instrument must not regress them |

### 4.10 Alignment with the existing scaffold

A working MVP already exists (uncommitted) in `src/instruments/graphonic-calculator/` (2,786 lines across `parser.js`, `expressions.js`, `sampler.js`, `geometry.js`, `camera.js`, `renderer.js`, `model.js`, `audio.js`, `app.js`). It already follows the recommended shape: a hand-written tokenizer/recursive-descent parser with implicit multiplication and closure compilation (`compile(node, env)`), a row classifier (explicit-y/x, polar, parametric, implicit, inequality, point, parameter, function), uniform sampling with bisection-based jump refinement and NaN-edge approach, uniform-grid marching squares with center-sampled saddles, an in-house 1-2-5 ticker with integer-index generation, a camera with home/square/pan/zoom, Float64Array segments per branch, `traceAt`/`resampleColumns`/`nearestPoint`, a six-voice sine audio trace (220 Hz × 2^(octaves·h), pan = x), and a Morphazoid palette. Gaps relative to this brief, in priority order:

1. Sampler: no irrational-phase offset and no flatness-based refinement between samples (only jump-triggered), so smooth high-curvature curves can alias; breaks are not classified or recorded as events; `limit = span·1e6` lets near-vertical segments reach the renderer (clamp to ±1 viewport in world space or ±1e4 px). Add seeded jitter, 0.25 px flatness refinement, typed break events, and evaluation budgets.
2. Implicit: `marchingSquares` emits disjoint two-point segments (not stitched), has no coarse→fine refinement and no root-verified crossings, so poles draw as verticals and audio cannot traverse the curve. Stitch (reuse the julia.js approach), refine candidates, verify crossings.
3. Model: `resampleColumns` keeps only the first hit per column (drops other branches), there is no `defined`/`onscreen` mask (NaN only), no POIs, no derivatives, no `continuous` flag, no robust y-range, and no version counter. Implement the §5.3 record.
4. Sliders: traversal is 6 s with no loop-mode choice; Desmos is 4 s loop forward-reverse; add float-safe stepping and editable bounds UI; Enter/Backspace row semantics per §1.1.
5. Audio: bare sines (research says harmonically richer), no speed ladder, no POI/branch events, no keyboard trace protocol — phase 2 work, but the default sweep (8 s) should move to 5 s with Desmos-like presets.
6. Ticks: derive the major count from pixel width (~80 px per label) rather than a fixed `maxTicks`; add exponent-form labels at extreme zoom.

## 5. Sonification plan

### 5.1 Prior art summary

- **Desmos Audio Trace** (production, 2026): time ∝ x across the viewport (5 s default, 1/32x–8x), pitch = 330·2^t Hz over the visible y-range (one octave per screen, clamped 125–2000), pan = x, PeriodicWave base tone + harmonic-rich second oscillator while x > 0, brown-noise static while y < 0, 75 ms noise blips for off-screen and discrete points, gap noise between branches, sampled pops at POIs, all branches of all curves at once, 101-point keyboard navigation with typed POIs and spoken descriptions (§1.8; [Audio Trace](https://help.desmos.com/hc/en-us/articles/37064105800333-Audio-Trace), bundle). The design is covered by [US10346135B2](https://patents.google.com/patent/US10346135B2/en) (Desmos Studio PBC; independent claims 1/18/20 and dependent claims 13–16 on discontinuity, quadrant, intersection and verbal-summary cues). An ASSETS'21 study found Desmos's sonification "useful for introducing discontinuities" when paired with verbal descriptions ([Ohshiro, Hurst, DuBois](https://dl.acm.org/doi/10.1145/3441852.3476533)); Desmos publishes a three-expression discontinuity demo graph ([wttrtvpr8a](https://www.desmos.com/calculator/wttrtvpr8a)) usable as a test fixture.
- **Desmos `tone()`**: user-authored sound, muted by default, Alt+M global mute, gain cap min(10, 660/f), semitone formula 440·2^(x/12) ([Tone](https://help.desmos.com/hc/en-us/articles/21373904717197-Tone)).
- **SAS Graphics Accelerator**: x → stereo, y → piano-like pitch, missing values → "a low thud", end of data → mid-frequency sound, speed cycling, groups as chord or melody at each x ([SAS user guide](https://documentation.sas.com/doc/en/gracclug/1.0/p06mk7dgflwldzn1ad6vxjfe8dob.htm)).
- **Highcharts sonification** (proprietary; design reference): pitch mapTo y c2–c6, pan/time mapTo x, linear|logarithmic mapFunction, `-y` inversion, scale quantization, `activeWhen` crossings, context tracks, `playSegment` scrubbing, sequential vs simultaneous order; its y=1/x demo pushes `null` at the asymptote ([pitch mapping](https://api.highcharts.com/highcharts/sonification.defaultInstrumentOptions.mapping.pitch), [advanced mapping](https://www.highcharts.com/docs/sonification/advanced-mapping), [context cues](https://www.highcharts.com/docs/sonification/context-cues), [demo](https://raw.githubusercontent.com/highcharts/highcharts/master/samples/highcharts/demo/sonified-function/demo.js)).
- **Brown et al. 2003 guidelines**: y → pitch of musical notes, musical timbres not sines, MIDI 35–100, 50–70 ms between tones, two series separated by hard L/R pan or timbre, parallel mode default because it made intersection-finding "significantly faster" ([Brown et al.](https://eprints.gla.ac.uk/3196/1/Brown_Guidelines_final.pdf), [Drawing by ear](https://eprints.gla.ac.uk/3194/1/Brown_Drawing_final.pdf)).
- **Flowers 2005**: log-frequency pitch for magnitude works; loudness for continuous data fails; 3+ simultaneous streams are "extremely difficult"; timbre/loudness pulses mark categorical events like axis crossings ([Flowers](https://sonify.psych.gatech.edu/ags2005/pdf/AGS05_Flowers.pdf)).
- **Walker & Nees** (Sonification Handbook ch. 2): polarity and scaling are design choices; clicks at twice the data rate act as ticks; a repeating y-max reference tone dramatically improves point estimation; round-to-scale vs pitch-bend both needed ([Handbook ch. 2](https://sonification.de/handbook/download/TheSonificationHandbook-chapter2.pdf), [Walker & Mauney 2010](https://wirelessrerc.gatech.edu/sites/default/files/publications/walker_et_al_-_a_comparison_of_sonification_mappings.pdf)).
- **Grond & Berger** (ch. 15) and **MathTrax/NASA MDE**: function value → pitch, derivatives as parallel streams or as vowel/brightness modulation (benefit strong in passive listening, weaker while scrubbing); MathTrax used f = f0·2^p over 110–1760 Hz with a sine/saw/triangle blend because sines vanish below ~200 Hz on laptop speakers ([Handbook ch. 15](https://sonification.de/handbook/download/TheSonificationHandbook-chapter15.pdf), [Shelton 2005](https://sonify.psych.gatech.edu/ags2005/pdf/Shelton_EqualizationOfPerceivedVolume.pdf), [NASA MDE](https://ntrs.nasa.gov/citations/20100019596)).
- **ViewPlus AGC / TRIANGLE / Sahyun**: ~100 points per sweep, tick clicks, max/min/zero locator, instrument change (piano→harpsichord) for values below a set point, drum density/pitch for slope/curvature ([ViewPlus](https://viewplus.com/product/audio-graphonic-calculator/), [TRIANGLE](https://www.icad.org/websiteV2.0/Conferences/ICAD96/proc96/gardner5.htm), [Sahyun 1998](https://sahyun.net/research/csun98/)).
- **Apple Audio Graphs**: continuous tone for lines, discrete tones for points, gridlines as haptics, drag-to-scrub with spoken value on pause ([WWDC21](https://developer.apple.com/videos/play/wwdc2021/10122/)).
- **AudioFunctions.web**: linear 200–2000 Hz, loudness as distance-to-curve for touch exploration, verbal or musical earcons at min/max/axis/origin, derivatives as separate playable functions ([Ahmetovic et al. 2019](https://air.unimi.it/retrieve/dfa8b9a0-a9fc-748b-e053-3a05fe0a3a96/ahmetovic2019audiofunctions.pdf)); successor Audiofunctions++ is AGPL.
- **Recent function-sonification research**: uniform-y ("variable tempo") resampling gave ~13x finer acceleration discrimination than uniform-x or continuous glides ([Fan et al. 2025](https://arxiv.org/html/2508.06872)); SonicFunction encodes sign in timbre and derivative in a parallel stream ([SonicFunction](https://pub.uni-bielefeld.de/record/2017190), [Singing Function](https://pub.uni-bielefeld.de/record/2277129)); multi-reference tones halved point-estimation error and a separate "sonar" sign sound reached ~90% sign accuracy ([Putra & Setiawan 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11419623/)).
- **Browser implementations**: chart2music's constants and key model (§3.6); math-to-sound's single shared 2048-sample NaN-masked array read by both canvas and audio, `setValueCurveAtTime` pitch mode holding the previous frequency across NaN, and a single-cycle wavetable mode ([math-to-sound](https://github.com/katew918/math-to-sound), unlicensed — ideas only); CAS precedent for "function as waveform" in GeoGebra `PlaySound(<Function>, <Min>, <Max>)` and Wolfram `Play` ([GeoGebra PlaySound](https://geogebra.github.io/docs/manual/en/commands/PlaySound/), [Wolfram Play](https://reference.wolfram.com/language/ref/Play.html)).

### 5.2 Recommended mapping strategy for phase 2

Three renderers reading one model, built in this order:

1. **Trace/glide renderer (Desmos-class).** One continuous voice per branch of the selected expression; time ∝ x across the viewport with a 5 s default and a Desmos-like speed ladder (Alt+1…0); pitch exponential in y over the visible range, default two octaves (the scaffold's 220 Hz × 2^(2h) = 220–880 Hz), user-adjustable 1–4 octaves with an optional semitone quantizer; pan = normalized x (−1..1); a harmonically rich voice (PeriodicWave blend) rather than a bare sine; `setTargetAtTime` ramps of ~1.5–30 ms. Encode `defined=false` and off-screen samples as gain-gated silence with a short non-tonal marker; encode breaks from the event list (asymptote: tone runs to the edge then silence/marker then re-entry; jump: pitch step; hole: nothing unless a POI). Cue choices for sign of y, sign of x and intersections must be chosen deliberately (candidates: static vs instrument change vs sign earcon; pop vs distinct earcon per POI type) after legal review of US10346135B2 — see §6.
2. **Step/scrub renderer.** Discrete notes per sample with ms-per-point presets (Desmos 12–150 ms historically; chart2music 25/50/100/250/1000; Brown 50–70 ms), keyboard navigation over the 101-point-per-branch grid with POIs inserted, Tab/Shift+Tab to POIs, spoken X/Y/type/color/branch via a live region or Web Speech, optional x-tick clicks at two densities and a y-max reference tone, and a uniform-y "variable tempo" mode. Slider trace (S) binds arrow keys to the active slider and replays.
3. **Wavetable/"isometry" renderer (Morphazoid-specific).** The N-sample visible curve (or one period) becomes a single-cycle waveform: DFT the resampled array into `createPeriodicWave` coefficients (band-limited, pitch-shiftable) rather than looping an `AudioBufferSourceNode` (aliasing at the seam) ([createPeriodicWave](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createPeriodicWave), [AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)); sliders then morph timbre live.

Cross-cutting rules: loudness never carries y; default polyphony is one expression (all its branches) with an "all visible" option capped at six voices and separated by timbre; a "pan = series" mode for two-curve comparison (pan cannot carry both x and identity); start muted with a global mute key; cap gain by frequency (Desmos's min(10, 660/f)); respect reduced-motion and autoplay policies (resume on gesture, which the scaffold's `TraceAudio.start()` already does).

Implementation pattern A (first): resample each branch to the playback time grid, map to Hz, replace NaN by the held previous value (NaN throws `TypeError`), `cancelScheduledValues` before every re-schedule (overlapping curves throw `NotSupportedError`), and schedule one `setValueCurveAtTime` per branch on a running oscillator ([MDN setValueCurveAtTime](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/setValueCurveAtTime), [Web Audio spec §1.6.2](https://webaudio.github.io/web-audio-api/)). Pattern B (upgrade): an `AudioWorkletProcessor` that receives the sampled arrays once and computes pitch/pan/noise mix per sample with hysteresis and sample-accurate scrubbing, handling 128- or 1-length parameter arrays ([AudioWorkletProcessor.process](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process)); keep interval math out of the worklet (worklet scopes load module scripts only and have no `self` — the interval-arithmetic UMD cannot load there ([HTML worklets](https://html.spec.whatwg.org/multipage/worklets.html))).

### 5.3 Data model the MVP must expose (so phase 2 needs no refactor)

Pure JS, no DOM or audio imports, versioned, built by the geometry layer and consumed by renderer, hit-testing and audio alike:

```
GraphModel {
  version: number;                       // monotonic; bumps on any change that alters samples
  viewport: { xMin, xMax, yMin, yMax, widthPx, heightPx, dpr, squareAxes, xScale: 'linear'|'log', yScale };
  axes: { xTicks: Float64Array, yTicks: Float64Array, xStep, yStep, xMinorStep, yMinorStep, piMode: boolean };
  sliders: [{ name, value, min, max, step, animating, direction }];
  expressions: ExpressionRecord[];
}
ExpressionRecord {
  id, index, color, label: string, latex?: string,
  kind: 'explicit-y'|'explicit-x'|'implicit'|'parametric'|'polar'|'inequality'|'point'|'points'|'table'|'definition'|'constant',
  visible, continuous: boolean,          // false for points/tables → discrete blips
  style: { lineStyle, lineWidth, opacity },
  deps: string[],                        // slider names; drives re-sampling and "{n} animating sliders were paused"
  evaluate?: (x) => y, evaluateX?: (y) => x, F?: (x, y) => number,   // closures for scrubbing and sample-accurate audio
  samples: { n: 1024|2048, xMin, xMax,   // uniform over the visible x-range; xs implicit (xMin + i*dx)
             ys: Float64Array(n), defined: Uint8Array(n), onscreen: Uint8Array(n),
             dy: Float32Array(n), d2y: Float32Array(n) },
  branches: [{ start, end }]             // index ranges of connected samples (explicit), or
  polylines: Float64Array[],             // interleaved (x,y) with NaN-pair pen-up (implicit/parametric/polar), ordered for arc-length traversal
  events: [{ x, type: 'asymptote'|'jump'|'hole'|'domain-edge', side: 'left'|'right'|'both' }],
  pois: [{ x, y, type: 'zero'|'min'|'max'|'x-intercept'|'y-intercept'|'intersection'|'label'|'origin', otherId? }],
  yRangeRobust: { lo, hi },              // percentile-based, for pitch normalisation independent of the viewport
  status: 'ok'|'error'|'too-complex', error?: { message, position }
}
```

Plus `sampleAt(x)` (all branch y-values at x, in drawing order) and `resample(xMin, xMax, n, branch?)` returning Float64Arrays with the `defined` mask, and a `change` event carrying `version`. The scaffold's `geometry.js` item (`segments`, `points`, `fills`, `evaluate`/`evaluateX`, `traceAt`, `resampleColumns`, `nearestPoint`) covers the drawing side; the additions are the typed `events`, `pois`, masks, derivatives, `continuous`, `yRangeRobust`, per-branch `resample`, and the version counter. Both the Canvas renderer and the sonifier must break the line/voice at the same `events`, which is why break detection lives in the sampler, not in either consumer.

## 6. Open questions and risks

1. **License policy decisions needed**: ISC (d3 files), BSL-1.0 (interval-arithmetic), `Graphics-Gems`, MPL-2.0 file-level copyleft (MathQuill), the Symbola subset's non-SPDX terms, and whether MIT-by-package.json-only packages (mr-parser family) count as licensed. Default plan avoids all but MPL-2.0 (and that only in phase 1.5).
2. **Patent exposure of the sonification cues**: US10346135B2's dependent claims cover an audible discontinuity cue, quadrant indication, intersection indication and verbal summaries in a web graphing calculator; the current Desmos implementation (static, overtone, pops) differs from the patent's triangle-wave description, and the overtone polarity is reversed between patent and help text. This brief is not legal advice; get a review before choosing those three encodings, and prefer encodings with independent prior art (SAS thud, Sahyun instrument change, AudioFunctions earcons, Putra sign sound).
3. **Trademark**: MIT licenses on Desmos repos grant no trademark rights; the instrument is "Graphonic Calculator", never branded Desmos.
4. **MathQuill end of life**: the Desmos fork is declared unmaintained, DesQuill is TypeScript-source-only with no license file or build, the community nightly is disabled and ships broken font paths; vendoring means owning a frozen copy and a config pass (`charsThatBreakOutOfSupSub` et al.) to get Desmos-like typing. MathLive (MIT) is the fallback at six times the size.
5. **Implicit plotting fidelity**: marching squares misses zero sets without sign change and sub-cell features; interval arithmetic fixes both at real cost (the dependency problem fattens bands; `sin` precision and `pow` quirks in interval-arithmetic; compute-engine's rounding is a proof only for + − × ÷ √). Decide whether a "verified" mode is ever a goal; graphest's corpus is the oracle if so.
6. **Performance model**: main-thread sampling with budgets is fine for the MVP; the worker boundary is cheap later only if the model stays transferable typed arrays. Interval math must not run in the audio thread.
7. **Docs disagreements and stale sources**: strict inequality dotted (help) vs dashed (user guide); arrow step 1/4 of axis step (CITL) vs 101 pixel-even samples (bundle); speeds Alt+1–5 (patent/CITL) vs Alt+1–0 (help); help-center content read via Zendesk JSON; audio constants inferred from minified code; the SIGGRAPH 2025 paper quotes come from search-engine extraction (ACM returned 403).
8. **Mobile input**: MathQuill ships no keypad (Desmos's is proprietary) and only mouse handlers; a touch-friendly list needs an own keypad driving `.cmd()`/`.typedText()`, and the canvas needs `touch-action: none` with pointer capture.
9. **Security**: the row text is user input and may be shared via URL hash; never evaluate through `new Function`; bound recursion depth, node count and evaluation budgets; KaTeX/MathLive output must be rendered with `trust:false`/pinned XSS-fixed versions if adopted.
10. **Audio safety and policy**: start muted, resume on gesture, cap gain by frequency, cap polyphony, respect `prefers-reduced-motion`; MathLive opens its own `AudioContext` unless `soundsDirectory = null`.
11. **Model versioning**: audio must diff on `version`, not re-sample; sliders animating during playback either pause (Desmos) or hot-swap curves — decide and encode in the model contract.

## 7. Sources

Desmos official documentation and product
- https://www.desmos.com/api
- https://help.desmos.com/hc/en-us/articles/49078363315725
- https://www.desmos.com/api/v1.13/docs/index.html
- https://www.desmos.com/api/v1.11/docs/index.html
- https://www.desmos.com/calculator
- https://www.desmos.com/assets/build/shared_calculator_desktop-4c0e7c8826b1fb7f7f994b963732754fc33b99b2.js
- https://www.desmos.com/calculator/wttrtvpr8a
- https://www.desmos.com/assets/docs/desmos-keyboard-shortcuts-windows.docx
- https://help.desmos.com/hc/en-us/articles/37064105800333-Audio-Trace
- https://help.desmos.com/hc/en-us/articles/4404860698253-Introduction-to-Accessibility-Features
- https://help.desmos.com/hc/en-us/articles/4406040715149-Getting-Started-Desmos-Graphing-Calculator
- https://help.desmos.com/hc/en-us/articles/4405296853517-Graph-Settings
- https://help.desmos.com/hc/en-us/articles/202529069-Sliders-and-Movable-Points-in-a-Graph
- https://help.desmos.com/hc/en-us/articles/4407895086349-Add-an-Item-to-a-Graph
- https://help.desmos.com/hc/en-us/articles/4407885334285-Inequalities-and-Restrictions
- https://help.desmos.com/hc/en-us/articles/4406795899533-Custom-Colors
- https://help.desmos.com/hc/en-us/articles/4405489674381-Tables
- https://help.desmos.com/hc/en-us/articles/4406360401677-FAQs
- https://help.desmos.com/hc/en-us/articles/4405017454477--What-s-New-at-Desmos-Studio
- https://help.desmos.com/hc/en-us/articles/202528979-Supported-Browsers-Native-Apps
- https://help.desmos.com/hc/en-us/articles/21373904717197-Tone
- https://help.desmos.com/hc/en-us/articles/4405901719309-Saving-and-Sharing-Your-Work
- https://help.desmos.com/hc/en-us/articles/4406895312781-Polar-Graphing
- https://help.desmos.com/hc/en-us/articles/4406906208397
- https://help.desmos.com/hc/en-us/articles/4406029680653
- https://docs.google.com/document/d/1gV-WgDjgR9hKKb32ffeUpjwggNAgfqxl0Gsg6xocbok/preview
- https://cl.desmos.com/t/variable-names-with-subcripts/459
- https://citl.illinois.edu/desmos-accessible-graphonic-calculator-guide

Desmos engineering, talks, patent, internals
- https://engineering.desmos.com/articles/press-a-key-in-the-calculator/
- https://engineering.desmos.com/articles/pratt-parser/
- https://engineering.desmos.com/articles/intuitive-calculator-arithmetic/
- https://dl.acm.org/doi/10.1145/3721243.3735987
- https://history.siggraph.org/experience/real-time-graphics-in-desmos-with-just-math-and-a-browser-by-shaw-and-luberoff/
- https://gist.github.com/jared-hughes/d9a27764c7f8a6e07ba7e2aa89fb5f10
- https://gist.github.com/jared-hughes/adac228ecf81a6a455e1181e8e8e87bf
- https://news.ycombinator.com/item?id=37859085
- https://patents.google.com/patent/US10346135B2/en
- https://dl.acm.org/doi/10.1145/3441852.3476533

Desmos-authored and adjacent repositories
- https://github.com/desmosinc/mathquill
- https://github.com/desmosinc/mathquill/tree/main/src/fonts
- https://github.com/desmosinc/mathquill/blob/main/docs/Config.md
- https://github.com/desmos-community/mathquill-builder
- https://www.npmjs.com/package/@desmos-community/mathquill
- https://github.com/mathquill/mathquill
- https://github.com/mathquill/mathquill/wiki/Fonts
- https://github.com/openwebwork/mathquill
- https://github.com/desmosinc/desquill
- https://github.com/desmosinc/pratt-parser-blog-code
- https://github.com/desmosinc/scrubber
- https://github.com/desmosinc/scrubber/pull/11
- https://github.com/DesModder/DesModder
- https://github.com/radian628/unofficial-desmos-wiki

Math input and display
- https://github.com/arnog/mathlive
- https://github.com/KaTeX/KaTeX
- https://dn-works.com/wp-content/uploads/UFAS/License.pdf
- http://xahlee.info/comp/symbola_font_no_longer_free.html
- https://fedoraproject.org/wiki/Gdouros_Symbola
- https://metadata-backend.ftp-master.debian.org/changelogs/main/t/ttf-ancient-fonts/testing_copyright

Parsers, evaluators, interval arithmetic
- https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html
- https://github.com/josdejong/mathjs
- https://github.com/josdejong/mathjs#license
- https://github.com/josdejong/mathjs/issues/3162
- https://github.com/josdejong/mathjs/issues/1841
- https://github.com/josdejong/mathjs/blob/develop/src/function/algebra/sparse/csLu.js
- https://cdn.jsdelivr.net/npm/mathjs@15.2.0/lib/browser/math.js.LICENSE.txt
- https://mathjs.org/docs/expressions/syntax.html
- https://github.com/silentmatt/expr-eval
- https://github.com/silentmatt/expr-eval/blob/master/src/parser-state.js
- https://github.com/jorenbroekema/expr-eval
- https://github.com/EricSmekens/jsep
- https://github.com/mauriciopoppe/math-codegen
- https://github.com/advisories/GHSA-p6x5-p4xf-cc4r
- https://github.com/mauriciopoppe/math-codegen/issues/13
- https://github.com/cortex-js/compute-engine
- https://github.com/cortex-js/compute-engine/blob/main/src/compute-engine/compilation/compile-expression.ts
- https://github.com/cortex-js/compute-engine/blob/main/src/compute-engine/interval/types.ts
- https://mathlive.io/compute-engine/guides/compiling/
- https://cdn.jsdelivr.net/npm/@cortex-js/compute-engine@0.153.0/dist/esm-min/interval.js
- https://github.com/mauriciopoppe/interval-arithmetic
- https://unpkg.com/interval-arithmetic@1.1.3/dist/bundle.js
- https://peggyjs.org/documentation.html
- https://github.com/jiggzson/nerdamer
- https://github.com/PaddiM8/kalker

Plotting libraries, algorithms, papers
- https://github.com/mauriciopoppe/function-plot
- https://mauriciopoppe.github.io/function-plot/
- https://raw.githubusercontent.com/mauriciopoppe/function-plot/main/src/samplers/builtIn.ts
- https://raw.githubusercontent.com/mauriciopoppe/function-plot/main/src/samplers/interval.ts
- https://github.com/d3/d3-array
- https://raw.githubusercontent.com/d3/d3-array/main/src/ticks.js
- https://github.com/d3/d3-array/pull/283
- https://raw.githubusercontent.com/d3/d3-zoom/main/src/transform.js
- https://github.com/d3/d3-contour
- https://raw.githubusercontent.com/d3/d3-contour/main/src/contours.js
- https://github.com/d3/d3-contour/issues/72
- https://github.com/MohammadHossinzehi/marching-squares-contours
- https://github.com/RaumZeit/MarchingSquares.js
- https://github.com/jsxgraph/jsxgraph
- https://github.com/unageek/graphest
- https://github.com/unageek/graphest/blob/main/Examples.md
- https://github.com/unageek/inari/issues/85
- https://www.fftw.org/fftw3_doc/License-and-Copyright.html
- https://github.com/maximsmol/Open-GraphEq
- https://github.com/erich666/GraphicsGems
- https://github.com/erich666/GraphicsGems/blob/master/LICENSE.md
- https://github.com/erich666/GraphicsGems/blob/master/gems/Label.c
- https://www.realtimerendering.com/resources/GraphicsGems/gems/Label.c
- https://raw.githubusercontent.com/erich666/GraphicsGems/master/gemsv/ch4-4/aspc.c
- https://spdx.org/licenses/Graphics-Gems.html
- https://www.dgp.toronto.edu/~mooncake/papers/SIGGRAPH2001_Tupper.pdf
- https://microsoft.com/en-us/research/wp-content/uploads/2017/01/snyder0_siggraph92.pdf
- https://lhf.impa.br/ftp/oral/sib2001.pdf
- https://doi.org/10.1093/comjnl/33.5.402
- https://en.wikipedia.org/wiki/Marching_squares
- https://en.wikipedia.org/wiki/Marching_cubes
- https://shamshad-npti.github.io/implicit/curve/2015/10/08/Implicit-curve/
- https://ojs.cvut.cz/ojs/index.php/gi/article/view/gi.17.2.2
- https://github.com/bayertom/sampling
- http://graphics.stanford.edu/vis/publications/2010/labeling-preprint.pdf
- https://reference.wolfram.com/language/ref/Plot.html
- https://github.com/harry7557558/spirulae
- https://github.com/aantthony/equation.io
- https://github.com/sam-lb/complexmos
- https://github.com/calebmadrigal/truthygraph
- https://github.com/CindyJS/CindyJS

Full calculators and license traps
- https://github.com/NazreenNasyuha/UtlCalculator
- https://github.com/GabrielDeml/graphing-calc
- https://github.com/GabrielDeml/graphing-calc/blob/main/README.md
- https://github.com/Arjun-Anubis/DesmosDT
- https://graphtoy.com/
- https://github.com/PullJosh/graphonic-calculator
- https://tangled.org/oscillatory.net/cartesium
- https://github.com/yerich/Graphr
- https://github.com/laktak/js-graphy
- https://github.com/d12/QuickPlotJS
- https://github.com/Develifture/scientific-calculator
- https://github.com/stevenpetryk/mafs
- https://www.geogebra.org/license
- https://github.com/geogebra/geogebra
- https://github.com/numworks/epsilon
- https://github.com/dheera/fooplot
- https://github.com/bgkillas/kalc
- https://github.com/hackclub/sinerider
- https://choosealicense.com/no-permission/

Sonification
- https://documentation.sas.com/doc/en/gracclug/1.0/p06mk7dgflwldzn1ad6vxjfe8dob.htm
- https://api.highcharts.com/highcharts/sonification.defaultInstrumentOptions.mapping.pitch
- https://www.highcharts.com/docs/sonification/advanced-mapping
- https://www.highcharts.com/docs/sonification/context-cues
- https://raw.githubusercontent.com/highcharts/highcharts/master/samples/highcharts/demo/sonified-function/demo.js
- https://shop.highcharts.com/license
- https://github.com/highcharts/sonification-studio
- https://eprints.gla.ac.uk/3196/1/Brown_Guidelines_final.pdf
- https://eprints.gla.ac.uk/3194/1/Brown_Drawing_final.pdf
- https://sonify.psych.gatech.edu/ags2005/pdf/AGS05_Flowers.pdf
- https://sonification.de/handbook/download/TheSonificationHandbook-chapter2.pdf
- https://sonification.de/handbook/download/TheSonificationHandbook-chapter15.pdf
- https://wirelessrerc.gatech.edu/sites/default/files/publications/walker_et_al_-_a_comparison_of_sonification_mappings.pdf
- https://sonify.psych.gatech.edu/ags2005/pdf/Shelton_EqualizationOfPerceivedVolume.pdf
- https://ntrs.nasa.gov/citations/20100019596
- https://viewplus.com/product/audio-graphonic-calculator/
- https://www.icad.org/websiteV2.0/Conferences/ICAD96/proc96/gardner5.htm
- https://sahyun.net/research/csun98/
- https://developer.apple.com/videos/play/wwdc2021/10122/
- https://air.unimi.it/retrieve/dfa8b9a0-a9fc-748b-e053-3a05fe0a3a96/ahmetovic2019audiofunctions.pdf
- https://github.com/SONAIRGRAPH/audiofunctions-plus
- https://arxiv.org/html/2508.06872
- https://pub.uni-bielefeld.de/record/2017190
- https://pub.uni-bielefeld.de/record/2277129
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11419623/
- https://github.com/katew918/math-to-sound
- https://github.com/ashwinH18/sonifystem
- https://github.com/julianna-langston/chart2music
- https://github.com/Tonejs/Tone.js
- https://github.com/see-mike-out/erie-web
- https://github.com/athersharif/sonifier
- https://github.com/chdh/function-curve-viewer
- https://github.com/xability/maidr
- https://geogebra.github.io/docs/manual/en/commands/PlaySound/
- https://reference.wolfram.com/language/ref/Play.html

Web platform references
- https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
- https://web.dev/articles/canvas-hidipi
- https://web.dev/articles/device-p
