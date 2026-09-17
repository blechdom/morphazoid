# Site metadata

`instrument-registry.js` owns the existing ordered `TOOL_GROUPS`,
`FAVE_TOOL_IDS`, and `SITE_LINKS` records. It is data-only: importing it does not
initialize navigation, register listeners, clear storage, or access browser
globals. `src/instrument-catalog.js` derives the richer catalogue from it.

Import metadata directly from the registry for tools and data consumers.
Browser pages continue to load the existing root `nav.js` entry point for
navigation, keyboard/transport integration, and its other existing startup
behavior. That entry point still re-exports the records for compatibility.

Stored route strings are **site-root-relative metadata**, not paths relative
to this module. Navigation still resolves them against its public root entry
URL (`NAVIGATION_BASE_URL`). Do not move that URL base into this directory.

This extraction does not fix missing catalogue/capability registrations or
change group membership. Those existing cross-registry failures remain visible.

Preservation checks:

- `tests/instrument-registry.test.mjs` compares all moved and derived records
  with an independent pre-extraction fixture and tests cold import purity.
- `e2e/v2-site-bootstrap.spec.mjs` verifies data-only normal/WAX imports,
  rendered navigation/catalogue records, one transport click per Space, and
  Audio staying off.
- `e2e/shared-consistency.spec.mjs` retains the existing site-wide contracts.
