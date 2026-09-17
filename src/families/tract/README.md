# Tract-family geometry

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
Animation smoothing remains page-owned. Draw routines and gesture handlers
remain in the pages, using the same geometry objects and coordinate helpers.

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

These checks do not establish microphone behavior, physical fidelity, or a
human listening judgment. Keep larger rendering or gesture extractions in
separately reviewable layers.
