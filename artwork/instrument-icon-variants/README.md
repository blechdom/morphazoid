# Instrument Icon Decisions

Each instrument has its own folder. Every image file inside a folder belongs only
to that instrument.

## File Names

- `catalogue-current.webp`: image currently shown in the catalogue
- `round-1-original.webp`: archived first-round image
- `round-2-v*.webp`: later alternatives
- Descriptive suffixes identify focused revisions such as `penrose-escher`

Identical copies are stored only once per folder. No generated artwork has been
deleted.

## Catalogue Mix

Run `npm run mix:icons` to choose one existing variant per eligible instrument
and copy it into the live catalogue. The draw balances the available visual
styles and records its seed and every source path in `CATALOGUE-MIX.json`.
Preview a draw without changing files with `npm run mix:icons -- --dry-run`, or
repeat an exact draw with `npm run mix:icons -- --seed <number>`. Explicit
family choices, including the red-and-white Barber Shop Poles set, remain pinned
across random draws.

## Selection Queue

Choices and progress are tracked in [SELECTIONS.md](SELECTIONS.md).
