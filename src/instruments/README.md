# Instrument implementations

Instrument-owned page controllers and styles live here, grouped by the canonical
IDs from `src/site/instrument-registry.js`. The September 18 naming pass includes
`shape-synth/`, `solid-synth/`, `hyper-synth/`, `shapes/`, `tesselation/`,
`monstroid/`, `rattlesnake-skin/`, and the renamed `*-drum-machine/` directories.

The root HTML files remain the public page entry points. Their script/style
references point here or into `src/families/`. Many shared models, audio
processors and utilities retain their existing `src/` paths; selected helpers
belonging to renamed instruments moved with their controllers. Runtime assets
remain top-level in `assets/`. Shared controllers such as Möbius/Klein's
nonorientable implementation belong under `src/families/`, not one instrument.

## Boundaries

- This is relocation, not a rewrite or consolidation of instruments.
- Relocation changes dependency/resource URLs, not synthesis or gestures.
  CSS URLs are rebased as needed without redesigning the selectors or rules.
- Existing cross-page stylesheet dependencies remain explicit; relocation does
  not claim that every stylesheet is exclusively owned by its folder.
- Folders represent implementation ownership, not navigation categories.
  Moving an instrument between categories does not move its source files.
- Public IDs/routes may change only through an explicit naming decision.
  Keep old route redirects and the aliases in `src/site/instrument-identities.js`.
  Do not rename saved-data keys, model enums, processor registrations, or presets
  merely to make internal strings resemble public names.
- Add new or moved required files to `scripts/site/runtime-files.tsv` with
  appropriate pre-commit copy permission.

## Preservation

`tests/source-layout.test.mjs` checks source existence, imports/worklet URLs,
build inclusion, syntax discovery and inspection-tool coverage.

`tests/helpers/relocated-sources.mjs` maps historical preservation-fixture names
to current source locations. Update that lookup for an intentional move; keep
the original callback bodies in the frozen fixtures unchanged.

`npm run test:browser:v2-layout` exercises the moved pages' control surfaces at
three viewport widths and loads Graph Delay's real worklet using a synthetic
input. The normal preservation batch retains the broader sizing, gesture,
MIDI/navigation and audio checks.

No root `*-app.js` controllers remain. Root `style.css`, public HTML, `nav.js`,
`wax-page.js`, and the shader bootstrap remain intentionally. This completes
the controller/style cleanup, not an architectural rewrite of every module.
