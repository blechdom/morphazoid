# Shared canvas sizing

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
