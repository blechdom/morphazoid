# Tract-family geometry and drawing

`geometry.js` contains the shared geometry previously duplicated in
`throatazoid-app.js` and `alien-larynx-app.js`:

- `interpolatePoint(points, progress)`
- `tractPoint(geometry, progress, diameter)`
- `buildTractDiameterProfile(performance, context)`
- `buildTractGeometry(performance, diameterProfile, context)`

The calculation bodies were extracted unchanged. This is a view/interaction
geometry module, not a replacement for either instrument's DSP or controller.

## Ownership

The module owns no instrument state, selection, DOM, drawing context, audio
graph, smoothing history, timers, or event listeners. It returns new geometry
and profiles just as the original functions did.

Each page retains small `tractGeometry` and `tractDiameterProfile` wrappers.
They supply the **current** state, CSS-pixel viewport dimensions, and zero-based
selected mouth on every call. Do not cache these at module initialization or
pass backing-store pixels in place of CSS pixels.

The page also supplies its existing `currentArticulationIndex`,
`perceptualNoseOpening`, and profile callback. Those helpers participate in
other page behavior, including audio configuration; this extraction does not
redefine them.

An explicit animated diameter profile is copied without recomputing it.
Animation smoothing and gesture handlers remain page-owned, using the same
geometry objects and coordinate helpers.

## Physical-tract rendering

`rendering.js` contains the identical physical-tract drawing block formerly
duplicated in the two controllers. Its single public entry is:

```js
drawPhysicalTract(drawing, geometry, time, liveAlpha, performance, view);
```

The caller still prepares animated geometry and updates `currentTract`,
`currentTongues`, `currentNoses`, and `currentBodyHandles` **before** drawing.
Those objects are also used by gestures; the renderer neither replaces them nor
owns their lifecycle.

The `view` argument supplies current CSS dimensions, selections, visual pressure
readings, reduced-motion preference, pointer highlight, burst/keyboard pulse,
and the existing `isAwake`/color callbacks. It is read-only per-frame input, not
a cached application store. Helpers take only their required drawing/view
arguments and retain their original math, colors, Canvas operations and ordering.
No frame scheduling, audio, smoothing, listeners or DOM lookup moved here.

Other anatomy/monitor drawing and the two pages' instrument-specific behavior
remain in their controllers. This is not a universal renderer or controller.

## Compatibility

The existing shared parameter-model functions still come from
`src/throatazoid.js`. Its name and public path have not been changed. Alien
Larynx's extra state and sound processing remain instrument-owned.

Preserve calculation order, Float32 assignments, object relationships, callback
ordering, and fallback behavior during maintenance. Do not normalize the two
instruments' states or collapse their processing differences into this module.

## Tests and reference

- `tests/fixtures/tract-geometry-v1.json` freezes the original functions and
  page-owned dependencies from `4e9feed`.
- `tests/tract-geometry.test.mjs` compares full geometry, Float32 profiles,
  viewport/selection changes, phoneme constrictions, supplied profiles, and
  source-state preservation.
- `e2e/v2-tract-preservation.spec.mjs` exercises the actual pages: anatomy
  shortcuts, direct tongue dragging, held-pointer resize, synthetic phonemes,
  audio continuity, and cleanup. It blocks microphone requests.
- `tests/fixtures/tract-rendering-v1.json` freezes the original drawing block.
- `tests/tract-rendering.test.mjs` compares exact Canvas commands/property writes,
  current/default visual state, pressure and closure cases, selections,
  reduced-motion behavior, optional Canvas APIs, pulses and hit-test aliases.
- `e2e/v2-tract-rendering.spec.mjs` compares actual Canvas pixels with the frozen
  original at fixed timestamps, three sizes/DPRs, three anatomies, and both
  motion preferences, using normal and generated WAX modules.

These checks do not establish microphone behavior, physical fidelity, or a
human listening judgment. Fixed-frame pixels do not imply that live animation
screenshots will be identical. Keep subsequent gesture or audio extractions in
separately reviewable layers.
