# Site metadata and page implementation

`instrument-registry.js` owns the existing ordered `TOOL_GROUPS`,
`FAVE_TOOL_IDS`, and `SITE_LINKS` records. It is data-only: importing it does not
initialize navigation, register listeners, clear storage, or access browser
globals. `src/site/instrument-catalog.js` derives the richer catalogue from it.

Import metadata directly from the registry for tools and data consumers.
Browser pages continue to load the existing root `nav.js` entry point for
navigation, keyboard/transport integration, and its other existing startup
behavior. That entry point still re-exports the records for compatibility.

Stored route strings are **site-root-relative metadata**, not paths relative
to this module. Navigation still resolves them against its public root entry
URL (`NAVIGATION_BASE_URL`). Do not move that URL base into this directory.

The homepage's Faves section and the Choose menu both use `FAVE_TOOL_IDS` order.
The adjacent next-instrument arrow tours the visible Choose entries once each,
Faves first, then wraps. It navigates normally; it does not transfer a previous
instrument's Audio state or patch query/hash. Focused arrow keydowns remain local
to navigation; musical note-release events are not blocked.

`catalogue-taxonomy.js` owns normalized secondary tags. `instrument-identities.js`
maps new public IDs to historical protocol IDs and old URLs to current IDs.
Those aliases preserve storage and MIDI listeners; do not globally replace
internal strings when a public instrument name changes.

The owner-sheet changes are recorded in
`docs/catalogue-update-decisions.json`, alongside the original TSV. Runtime data
does not import this review document. Keep assertions synchronized with approved
changes, not with guesses about ambiguous sheet cells.

`INSTRUMENTS` remains the normal MIDI/WAX inventory. `CATALOGUE_ITEMS` additionally
contains browseable labs (`catalogue: false`, `browse: true`, `entryType: "lab"`).
Listing a lab is not evidence that it implements the regular Audio/MIDI
contracts. WIP stays visible on the homepage but excluded from the instrument
chooser, preserving the existing picker policy.

The catalogue and plugins page controllers/styles also live here. Auxiliary
page styles are under `styles/`. They do not own audio engines or instruments.

`instrument-catalog.js`, `instrument-midi-capabilities.js` and
`plugin-catalog.js` now live beside those controllers. Their catalogue records,
MIDI capability identities and public download URLs are unchanged. Shared MIDI
runtime ownership remains in `src/browser-midi-adapter.js` and
`src/midi-manager.js`; it is not part of this metadata move.

Preservation checks:

- `tests/site-metadata-layout.test.mjs` reverses the path-only follow-up against
  independent fresh-main hashes; see `docs/site-metadata-layout.json`.
- `tests/instrument-registry.test.mjs` compares all moved and derived records
  with an independent pre-extraction fixture and tests cold import purity.
- `e2e/v2-site-bootstrap.spec.mjs` verifies data-only normal/WAX imports,
  rendered navigation/catalogue records, one transport click per Space, and
  Audio staying off.
- `e2e/shared-consistency.spec.mjs` retains the existing site-wide contracts.
