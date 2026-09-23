# Shared graphics calculations

## Pointer coordinates

`pointer-coordinates.js` shares only two existing calculations:

- `canvasLocalPoint(event, bounds)` subtracts the measured rectangle's left/top
  in CSS pixels. Rubix, Jaw Harp, the Graph controller and the Syrinx controller
  retain this unscaled policy.
- `canvasScaledPoint(event, bounds, size)` maps to logical drawing dimensions.
  Hiccup Head and Creaturazoid retain multiplication **then** division, with the
  existing `Math.max(1, measuredDimension)` denominator.

Callers still measure their current canvas once per event and own hit testing,
capture, focus, gesture state, parameter mapping and audio. Neither helper
clamps captured drags, rounds, sanitizes, reads device pixel ratio or falls back
to `offsetX`/`offsetY`.

Do not substitute a precomputed scale ratio: its floating-point results can
differ. Graph Delay's ratio-first calculation, Shapes' finite-coordinate
fallback and world-space transforms remain local rather than being silently
normalized into these two policies.

`tests/pointer-coordinates.test.mjs` compares the real wrappers with frozen
original functions and reverses each entire controller to its original bytes.
`e2e/pointer-coordinates.spec.mjs` compares the actual private callbacks with
the same independent reference in real browser layouts, CSS transforms,
resize transitions and representative WAX pages. See
`docs/pointer-coordinate-refactor.md` for scope and verification.

## Canvas sizing

`canvas-sizing.js` shares the **calculation**, not the instrument lifecycle.
Callers still own bounds measurement, canvas/style writes, transforms, redraws,
observer registration, disposal guards, and gesture/geometry state.

```js
const sizing = canvasSizing(bounds, window.devicePixelRatio);
```

The default policy preserves the original Solid/Hyper behavior:

- CSS dimensions are rounded and clamped to at least one.
- Device scale defaults to one when the supplied value is falsy.
- The maximum scale is two, with a nominal 3,000,000-pixel budget.
- The final scale is at least one, even if that exceeds the nominal budget.
- Backing dimensions use `Math.round`.

Do not "correct" these edge cases during a behavior-preserving extraction.

## Preserve the caller's existing policy

```js
// Existing 1.5x cap, without a pixel budget:
canvasSizing(bounds, window.devicePixelRatio, {
  maxPixelRatio: 1.5,
  pixelBudget: null,
});

// Existing 2.5x cap, allowing device scale below one:
canvasSizing(bounds, window.devicePixelRatio, {
  maxPixelRatio: 2.5,
  minPixelRatio: null,
  pixelBudget: null,
});

// Existing custom budget, retaining the default scale limits:
canvasSizing(bounds, window.devicePixelRatio, {
  pixelBudget: 2_600_000,
});
```

`null` disables the corresponding budget/minimum; it does not mean zero.
Do not replace a page's 1.35x/1.5x/2.5x cap, custom budget, or sub-one scale
behavior with the defaults merely for visual uniformity.

## What does not belong here

Do not add event listeners, Web Audio, drawing, timers, state resets, or
microphone/host handling. Do not make this helper resize a canvas unconditionally:
some callers intentionally avoid clearing an unchanged backing store.

Raw/fractional or floor-rounded CSS sizes, square stages, minimum backing-store
sizes, strict budget algorithms that reduce scale below one, and deferred
WebGL/WebGPU reallocations are not automatically equivalent to this policy.
They need their own equivalence evidence before migration.

## Verification

- `tests/canvas-sizing.test.mjs`: the original default rule and first consumers.
- `tests/canvas-sizing-variants.test.mjs`: frozen original callbacks, policies,
  conditional writes, repeated resizes, disposal guards, gesture state, redraws,
  transforms, and pending frames.
- `e2e/v2-canvas-uniformity.spec.mjs`: actual browser dimensions and resize
  behavior, compared with each original callback rather than this helper.
- `e2e/v2-canvas-rollout.spec.mjs`: selected live audio/transport scenarios.

A new policy needs a real consumer and a behavior comparison, not a new flag
added speculatively. Changing a musical mapping or an existing renderer's sizing
policy is a separate product change, not part of DRY maintenance.
