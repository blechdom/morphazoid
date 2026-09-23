# Work-in-progress prototype family

This package contains the existing shared runtime and controllers for
Tempo Tantrum, Tape Worm, Loop Soup, Habit Habitat and Hollowphonic.
It replaces the former `src/families/starting-instruments/` directory.
Other WIP catalogue instruments remain with their own implementations; this
folder is not a miscellaneous destination for every unfinished instrument.

The five public page URLs and individual instrument names are unchanged.
`work-in-progress-app.js` serves the original three single-stage prototypes;
`loop-network-app.js` serves Tape Worm and Loop Soup. The five engines remain
separate behind their existing shared audio/worklet interface.

Legacy identifiers such as `StartingAudio`, `STARTING_INSTRUMENTS`,
`data-starting-instrument`, the `starting-*` CSS classes and the
`morphazoid-starting-instrument` processor name are retained deliberately.
They are implementation/compatibility identities, not the current folder name.
The old help URL `docs/starting-instruments.md` also remains valid.

See `docs/prototype-family-layout.json` for the exact rename map.
`tests/prototype-family-layout.test.mjs` checks all moved source/style files and
all affected pages against independent pre-rename hashes. It permits only path
changes and the two requested visible group-label changes.
