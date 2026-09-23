# Prototype family renamed to Work in Progress — September 23, 2026

The owner requested replacing the internal “starting” family name with
“work in progress.” The five existing prototypes now live under
`src/families/work-in-progress/`. Their common entry controller and stylesheet
are named `work-in-progress-app.js` and `work-in-progress.css`.
The loop-network controller and all model filenames keep their existing names.

This is the same five-instrument shared package, not a move of every WIP
catalogue entry into one directory. Eight other prototype pages reuse its
stylesheet; their stylesheet links are updated without moving their own code.

## Preserved behavior and compatibility

- Tempo Tantrum, Tape Worm, Loop Soup, Habit Habitat and Hollowphonic retain
  their public HTML URLs, names, controls, presets, audio and recording behavior.
- Only the About/Other group labels change to “work-in-progress instruments.”
- AudioWorklet registration, exports, DOM IDs/classes/data attributes and saved
  state remain unchanged. The existing documentation and build-generator URLs
  are retained, with updated contents/paths.
- `prototype-family-layout.json` records 19 file moves and the explicit label
  changes. Independent hashes cover all 19 source/style files and 13 pages.
- Earlier `starting-family-layout` fixtures stay frozen. Their tests resolve
  current paths and reverse this rename before checking the earlier move.
- Generated WAX files are rebuilt, never edited directly.

The rename was initially based on the `eb5b17e` checkpoint without main's
separate iPhone-audio update. The owner subsequently requested a rebase onto
`ef6e593`; that update is now included while the rename and pending pointer /
preset work are preserved. See `rebase-main-20260923.md` for the new checkpoint,
verification and live preview. The neighboring main worktree remains untouched;
nothing was pushed or deployed.

## Verification and preview

| Check | Result |
| --- | --- |
| Focused rename, old-layout, model/worklet and pointer-preservation tests | 62 passed |
| `npm run verify` | 4,098 passed, six existing skips; syntax, SIMD, XYFlow and clean-build WAX parity passed |
| Existing prototype/loop-network browser suites | 45 passed |
| All 13 affected pages, including shared-stylesheet consumers | 13 browser smoke checks passed |
| Independent provenance | All 32 pre-rename hashes match the declared Git base |

Pre-existing pending files remain byte-identical except for the necessary
current-plan wording and release-manifest path updates. No pointer calculation,
preset data or audio implementation was changed by this rename.

The requested preview was started with
`npm run dev -- --port 4401 --strict-port` from
`/home/blechdom/creative/morphazoid-presets`. Its URL is
`http://localhost:4401/`. Navigation, registry, audio infrastructure, the new
controller/stylesheet and an affected page were compared with local source
bytes; all 13 affected pages resolve the new resource paths.
The server is left running for owner testing.

Logs, before-files and pending-work comparisons are under
`test-results/prototype-family-rename-20260923/`. These are rename-specific
mechanical checks, not new human listening/device approval or a claim to
resolve the independently recorded standalone Shape clipping-meter issue.
