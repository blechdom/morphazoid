# Shape, Solid and Hyper: preset audition follow-up

September 21, 2026. Local changes on `codex/full-instrument-presets`.
Source preview: `http://localhost:4370/`.

## Requested changes

- All migrated pages start with **Select Preset**. Matching factory settings
  is not treated as a menu selection. The first next-arrow action loads the first
  preset, and clicking that row explicitly recalls it.
- Shape's **Hands-on · Paused sketch** is removed. Its bank now has **36** scenes.
  Ordinary Playhead and Rotation pause controls remain available.
- Solid and Hyper each now have **20** scenes: eight additional demonstrations
  per instrument, interleaved with the earlier bank. Four additions are explicitly
  playhead-only and four are shape-only with a single rotating axis.
- **Klein bottle · Folded reed is second** in Hyper.
- Both first entries are now **First study** rather than a claim of untouched
  original settings. They use faster playhead-only motion and open envelopes.
- Solid's Octahedron Glass uses a faster, fixed-shape PM scan without the short
  envelope's long silent stretches. Sphere Endless remains Shepard synthesis.
- Hyper's Hypersphere Inside-out remains Shepard synthesis. Velvet is now
  **Velvet pulse**, with a faster playhead and shaped amplitude envelope,
  rather than the previous slow, sustained rotation.

## Motion and audio contract

Solid/Hyper now recall the primary playhead flag as well as independent axis
switches. This makes a scene actually playhead-only or shape-only, regardless
of the preceding scene. Recall never arms Audio. Page initialization still
leaves Audio and all motions off.

For shape-only scenes, the stationary slice is centered at phase 0.5. Otherwise a
position inherited from the end of a previous scan can sit outside the shape
and remain silent. Moving-playhead scenes retain their current phase.
Current rotation angles are retained; the synthesis engine is not restarted.

An adjustable native **Voice limit** control bounds continuous sine/FM/PM/Shepard
voices. It is hidden for percussion, whose separate existing strike limits still
apply. Startup values match the old fixed limits: Solid 32 and Hyper 20.
Reset Sound restores those limits. Heavy Shepard presets use eight voices;
the geometry and Shepard algorithm are retained.

## Measured diagnosis

A temporary Chromium profile was used, with explicit Audio clicks, no microphone
requests, a 48 kHz context and the existing output meter. A test-only hook exposed
submitted voices and existing worklet load reports. It did not alter synthesis.
Served source bytes were checked against this worktree.

- The earlier first studies produced audio after Audio and Play were enabled;
  **persistent silence was not reproduced** in that fresh-page setup. However,
  the header presented matching startup settings as an already-loaded preset,
  and the old full scenes did not recall primary Play.
- Octahedron Glass used a short spatial pluck envelope. **29 of 47** post-warm-up
  meter observations were near-silent before; **0 of 47** were near-silent after.
- Both spherical Shepard scenes exceeded their audio render budget here.
  Limiting voice count relieved that pressure without replacing the sound model:

| Scene | Median reported render load, before → after | Audio-clock / wall-clock progress, before → after |
| --- | --- | --- |
| Solid Sphere Endless | about 116% → 63% | 0.85 → 1.00 |
| Hyper Hypersphere Inside-out | about 166% → 64% | 0.62 → 1.00 |

These are **coarse worklet timing reports**, not hardware profiling or proof of
performance on every device. The after probes produced bounded, non-silent
output with no reported clipping or page errors. Brief silence at a traversal
boundary differs from sustained silence or missed render deadlines.
Human listening still determines musical quality and whether Velvet has the
desired character.

## Regression coverage

**40 focused browser checks passed**, including all 23 startup placeholders,
all 40 Solid/Hyper recalls, ten representative audio cases and four phone-layout
cases. This does not claim a new human listening or physical-device approval.

`npm run verify` also passed: **3,806 tests passed, six skipped**, with no
failures; runtime syntax, XYFlow parity and clean-build WAX parity passed.
`dist-wax/` was regenerated, not hand-edited. The full run found two older
issues: a Shape markup test still expected moved defaults inside the controller,
and Hiccup's skin help text lacked an explicit visual/appearance description.
The test now checks the actual defaults and controller wiring; the skin help
copy was clarified without changing its behavior.

Pure checks cover placeholder/first-next behavior, Shape's removal, menu order,
motion combinations, voice limits, unchanged startup settings apart from the
equivalent explicit cap, and exact full-state recall.

The focused browser suite checks Select Preset on all 23 migrated routes, all
40 Solid/Hyper recalls, representative live audio, manual Shape pause, and phone
menu reachability. The first run found a 36px summary touch target; the shared
Choose/preset trigger now has a 48px minimum height on coarse pointers.

Evidence: `test-results/preset-feedback-solid/`, including before/after source,
meter/load JSON, screenshots, comparison metrics and test output.
