# Morphazoidical

Morphazoidical is the isolated design and engineering track for the next Morphazoid geometry-to-sound workbench. It turns geometric measurements into understandable, trustworthy mapping sources while keeping the legacy instruments untouched.

The interface is intentionally progressive: the stage remains the visual center, a compact rack holds performance controls, a live inspector explains the selected contact or form, and an event timeline makes topology changes legible. The separate Feature Atlas is the searchable reference for every measurement that can eventually become a mapping source.

## Current status

This directory is a **prototype and integration workspace**, not a replacement for the legacy application.

| Area | Status | Meaning |
|---|---|---|
| Responsive workbench shell | Implemented MVP | Professional layout, stage overlays, compact control racks, inspector tabs, quality disclosures, and event presentation are available in the isolated page. |
| Feature Atlas | Implemented MVP | The 76 registered outputs can be browsed, searched, and filtered by scope/group, with availability, cadence, status, and normalization visible on each card. |
| Live interaction and visualization | Implemented MVP | The isolated page renders the real sampled Shape geometry, readers, contacts, hull, intersections, inside spans, and vectors without modifying legacy code. |
| Shared geometry feature engine | Implemented MVP | The isolated engine analyzes paths, contacts, readers, form metrics, containment, and intersections, with registry-backed normalization. |
| Stable tracking and live events | Implemented MVP | Frame-to-frame contact identities plus birth, death, entry, exit, and contact-pair events drive the inspector and event monitor. |
| Prototype Shape/mapping/audio runtime | Implemented MVP | Canvas, output mappings, telemetry, and legacy VoicePool audio consume the same timestamped sampled-geometry snapshots. |
| Production parity and migration | Planned | The workbench is not yet an authoritative replacement for the legacy instrument; visual/audio parity and hardened scheduling gates still apply. |
| Swept bifurcation refinement | Planned | Sub-frame bracketing/refinement of birth, death, split, merge, tangency, and overlap times still requires trajectory-aware integration. |
| Adaptive/analytic curve geometry | Planned | Production error-bounded sampling, analytic circle handling, and tolerance-driven refinement are not part of the UI MVP. |
| Lattice, Solid, Hyper, and Lumber adapters | Planned | These remain on the legacy pages until their feature adapters meet the common accuracy contract. |

The prototype uses explicit labels such as **Live**, **Estimated**, **Demo**, **Unavailable**, and **Planned**. An unavailable value must never silently appear as zero.

## Pages

### Workbench — `index.html`

The primary performance and analysis surface:

- A persistent geometric stage with reader, contacts, center guides, and selectable overlays.
- Compact Transport, Form, Reader, and Mapping racks.
- Contact, Reader, Form, Topology, and Audio inspector views.
- A chronological event strip for contact and topology changes.
- Visible coordinate-frame and quality information near the values it qualifies.
- Responsive behavior that keeps the stage useful while dense information moves into drawers or stacked regions.

### Feature Atlas — `atlas.html`

A searchable catalog of mapping sources. It is designed to answer three questions quickly:

1. What does this feature mean geometrically?
2. When is it valid and how accurate is it?
3. How should it be normalized, smoothed, or treated when mapped?

The Atlas is a product surface rather than a developer-only data dump. It groups measurements by geometric scope and exposes status, units, coordinate frame, range, cadence, and mapping behavior.

## Run locally

From the legacy Morphazoid package directory:

```sh
cd morphazoid
npm run dev
```

Then open:

- <http://localhost:3435/morphazoidical/>
- <http://localhost:3435/morphazoidical/atlas.html>

There is no build step. If the repository root is served instead, the equivalent paths are `/morphazoid/morphazoidical/` and `/morphazoid/morphazoidical/atlas.html`.

Run only the isolated rewrite tests from `morphazoid/`:

```sh
node --test morphazoidical/tests/*.test.mjs
```

Run the complete legacy and Morphazoidical regression suite:

```sh
npm run verify
```

`npm run verify` includes both the root instrument tests and the nested rewrite tests, so the Pages verification gate protects the complete worktree.

## Isolation rule

All rewrite work stays below `morphazoid/morphazoidical/` until an explicit migration decision is made. The rewrite may study or import stable legacy modules, but it must not alter legacy URLs, state defaults, audio behavior, or visual output as a side effect.

## Design principles

- **One geometric truth.** Canvas, mappings, the inspector, and audio consume the same timestamped analysis snapshot.
- **Explain before exposing.** A feature carries a definition, units, frame, validity, quality, and mapping policy—not only a number.
- **Performance first, depth on demand.** The stage and essential controls stay calm; detailed diagnostics live in inspector tabs and the Atlas.
- **Topology is temporal.** Contact births, deaths, tangencies, splits, merges, and overlaps are first-class events rather than unexplained count changes.
- **Raw, normalized, mapped, and audible are different.** The UI shows each stage explicitly when it matters.
- **Accessible by construction.** Every core workflow must work without drag, color, sound, or continuous animation.

See [PLAN.md](./PLAN.md) for the product architecture, feature contract, accuracy requirements, and staged roadmap.
