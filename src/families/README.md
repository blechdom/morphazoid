# Shared instrument families

This directory contains controllers, styles, or helpers with multiple real
instrument consumers. Examples include `nonorientable/` (Möbius/Klein),
`physics/`, `syrinx/`, `image-to-instrument/`, and `starting-instruments/`.
`geometry/` contains the Shapes embed styling; `graph/` owns shared Graph styling.

These names describe implementation ownership, not catalogue categories.
Changing an instrument's category should require metadata changes, not file
moves. Do not combine engines merely because their instruments share a category.
Keep instrument-specific UI/audio in `src/instruments/<id>/`, site behavior in
`src/site/`, and sound-independent primitives in their existing shared modules.

The current structure preserves existing family implementations. It does not
imply that all duplicated code has been abstracted or that individual instruments
can now be deleted.
