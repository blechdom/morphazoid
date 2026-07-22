# Morphazoidical rewrite plan

## 1. Outcome

Build a new, isolated Morphazoid workbench in which geometric form, reader motion, mapping, visual rendering, and sound share one explainable real-time model. The interface should be suitable both for performance and for close analysis: simple values are immediately available, advanced values remain discoverable, and every displayed measurement says what it means and how trustworthy it is.

This plan does not authorize a destructive replacement of the legacy pages. Migration happens instrument by instrument only after parity and accuracy gates pass.

## 2. Scope and status

Status terms used throughout this document:

- **Implemented MVP** — present in the isolated rewrite and suitable for evaluating the intended workflow.
- **In progress** — being built in the rewrite but not yet a production contract.
- **Planned** — designed here but not implemented or integrated.
- **Research** — needs experiments before its behavior or cost can be committed.

| Deliverable | Status |
|---|---|
| Isolated `morphazoidical/` workspace | Implemented MVP |
| Responsive workbench and analysis-oriented information architecture | Implemented MVP |
| Searchable Feature Atlas | Implemented MVP |
| Live sampled-Shape stage, controls, inspector, and event presentation | Implemented MVP |
| Common feature registry and real-time analysis snapshot | Implemented MVP |
| Prototype connection to Shape geometry, transport, mapping, and audio | Implemented MVP |
| Production parity, error-bounded geometry, and hardened audio scheduling | Planned |
| Stable cross-frame contact identity and typed frame events | Implemented MVP |
| Swept bifurcation/intersection event refinement | Planned |
| Error-bounded adaptive curves and analytic primitives | Planned |
| Cross-instrument feature adapters | Planned |
| Symmetry and spectral shape descriptors | Research |

### In scope

- A shared feature schema and analysis pipeline.
- Clear presentation of contact, segment, reader, form, topology, temporal, and audible information.
- Mapping any eligible scalar, circular value, category, or event through the correct interaction model.
- Stable identities and event timing across rotation and reader motion.
- Performance, accessibility, accuracy, and regression gates.

### Not in the first integration

- Replacing all five legacy instruments at once.
- Treating a canvas demo as an audio-ready implementation.
- Sending MIDI, OSC, or network data before its timing and privacy behavior are specified.
- Returning invented zeros for values that are undefined on open paths, missing contacts, or unsupported instruments.

## 3. Information architecture

### 3.1 Global structure

Two pages cover the initial product without forcing every task into one dense screen:

```text
Morphazoidical
├── Workbench
│   ├── Stage
│   ├── Performance racks
│   ├── Live inspector
│   └── Event timeline
└── Feature Atlas
    ├── Search and filters
    ├── Feature families
    └── Definitions and mapping guidance
```

Potential future pages should be added only when real workflows outgrow these surfaces:

- **Mapping Studio** for multi-target routing, transforms, modulation depth, conflict handling, and presets.
- **Diagnostics** for geometry error, frame budgets, voice allocation, and snapshot inspection.
- **Compare** for side-by-side forms, mappings, or captured runs.

Until then, mapping remains a focused rack and diagnostics remain optional inspector layers.

### 3.2 Workbench layout

The desktop arrangement uses three perceptual levels:

1. **Stage:** largest region; form, reader, contacts, selected overlays, and direct manipulation.
2. **Performance racks:** compact Transport, Form, Reader, and Mapping controls; safe for rapid use.
3. **Analysis rail:** Contact, Reader, Form, Topology, and Audio tabs plus an event timeline.

On narrower screens, the stage remains visible, performance racks become collapsible, and the inspector becomes a drawer or stacked panel. The UI must preserve the selected contact, tab, and mapping context across responsive transitions.

### 3.3 Inspector hierarchy

The inspector avoids a wall of telemetry by using consistent disclosure levels:

- **Headline:** 3–6 pinned values with label, value, unit, direction indicator where useful, and quality badge.
- **Essentials:** the most useful metrics for the active scope.
- **Details:** frame, raw/normalized values, derivatives, neighboring features, and validity notes.
- **Explain:** concise definition with a link to the Feature Atlas.

Tabs answer distinct questions:

| Tab | Primary question |
|---|---|
| Contact | Where is this contact, how is it oriented, and how is it moving? |
| Reader | How many contacts exist, in what order, and which intervals are inside? |
| Form | What are the form's global dimensions, balance, curvature, and complexity? |
| Topology | What intersects, branches, loops, or changes over time? |
| Audio | Which geometric contacts are actually voiced, and what reaches the output? |

### 3.4 Feature Atlas hierarchy

Atlas cards and detail views group features by scope rather than by implementation module. Users can filter by:

- Scope: contact, corner, segment, reader, form, topology, temporal, or audio.
- Availability: live, estimated, planned, unavailable for current geometry.
- Value type: scalar, signed scalar, circular, vector, category, event, or collection.
- Mapping suitability: continuous, trigger, selector, diagnostic only.
- Cost/cadence: audio-rate trajectory, analysis-frame, edit-time cache, or on demand.

Search indexes human names, IDs, aliases, definitions, units, and musical uses. Status and accuracy filters must remain visible whenever planned features appear alongside live ones.

## 4. Core user workflows

### 4.1 Explore a form

1. Choose or edit a form.
2. Start or scrub reader/form motion.
3. Toggle only the desired overlays: center vectors, tangents/normals, inside spans, hull, or intersections.
4. Select a visible contact to pin its stable identity in the inspector.
5. Open the Atlas definition when a measurement needs explanation.

### 4.2 Create a mapping

1. Choose a source by searching the Atlas or browsing the Mapping rack.
2. Confirm its scope, validity, quality, units, and current raw range.
3. Choose the correct mapping behavior: curve for scalar, sine/cosine or wrapped phase for circular, selector for category, trigger for event.
4. Set range, polarity, smoothing/hysteresis, and fallback behavior.
5. Preview the normalized value and resulting target before enabling it.
6. Compare raw geometry, normalized source, mapped target, and audible/rendered result.

### 4.3 Understand inside/outside

The UI never offers a single ambiguous `inside` field. It lets the user choose the intended concept:

- Corner class: convex, reflex, or smooth.
- Hull class: hull boundary or re-entrant.
- Center-facing score: outward normal dotted with radial direction.
- Radial motion: inward, tangent/circular, or outward.
- Reader crossing: entry, exit, graze, or overlap.
- Reader intervals: contained spans between ordered contacts.
- Point containment: winding or even/odd rule, stated explicitly.

Open paths display containment features as unavailable. Self-crossing forms display the active fill rule.

### 4.4 Investigate a topology event

1. An event appears at its precise analysis/audio timestamp and remains visually latched long enough to notice.
2. Selecting it pauses or scrubs to the event without destroying transport state.
3. The stage highlights involved contacts, edges, and reader geometry.
4. The inspector identifies birth, death, tangent touch, vertex touch, split, merge, or overlap begin/end.
5. A confidence/error field distinguishes refined events from sampled candidates.

### 4.5 Verify what is heard

1. Compare geometric contact count with selected, allocated, audible, and culled voice counts.
2. Inspect raw gain, normalization, envelope, mapping value, and estimated/rendered output separately.
3. Confirm worklet/fallback mode and look-ahead state.
4. Use a diagnostics capture when a visual event and audible event appear misaligned.

### 4.6 Non-pointer and non-audio use

Every drag interaction has a labeled numeric or keyboard alternative. Focus can move between stage objects and inspector values. Motion can be paused or reduced. Event meaning is conveyed with text and shape, and all analytical work remains possible while muted.

## 5. Feature contract

### 5.1 Snapshot architecture

Every consumer receives the same immutable, timestamped snapshot:

```text
Form definition + transport state + reader state
                    │
                    ▼
             Geometry evaluator
                    │
                    ▼
     Feature engine + contact tracker + event detector
                    │
                    ▼
       AnalysisSnapshot at time t, with look-ahead knots
          ├── canvas overlays
          ├── inspector and Atlas live values
          ├── mapping transforms
          ├── output adapters
          └── audio trajectory scheduler
```

UI code must not recalculate geometry independently. Audio must not infer a different contact order from a sorted display array.

### 5.2 Registry record

Each feature has stable metadata. The implemented MVP registry already provides stable IDs, labels, groups, scopes, value types, units, availability notes, categories, descriptions, and normalization rules. The target record below adds status, frame, validity, quality, cadence, mapping defaults, and presentation metadata as integration proceeds:

```js
{
  id: "contact.tangentRadiusAngle",
  label: "Tangent / radial angle",
  scope: "contact",
  status: "live",                 // live | estimated | planned
  valueType: "circular",          // scalar | circular | vector | category | event | collection
  unit: "rad",
  frame: "stage",                 // local | stage | reader | screen | audio
  domain: { min: -Math.PI, max: Math.PI, wrap: true },
  validity: { closedOnly: false, requiresContact: true },
  quality: { method: "sampled", confidence: 1, errorBound: null },
  cadence: "analysis-frame",      // trajectory | analysis-frame | edit-cache | on-demand
  mapping: {
    eligible: true,
    behavior: "circular",
    defaultSmoothingMs: 12,
    unavailable: "hold"
  },
  presentation: { group: "Orientation", precision: 1 }
}
```

The target live-value envelope is separate from its registry metadata. The MVP analyzer currently returns structured frame/contact/reader results and can flatten them by feature ID; subject-level envelopes and recorded error bounds are planned integration work:

```js
{
  featureId: "contact.tangentRadiusAngle",
  subjectId: "contact:reader-1:edge-7:branch-0",
  timestamp: 12.438,
  raw: 0.71,
  normalized: 0.613,
  valid: true,
  quality: { method: "sampled", confidence: 0.98, errorBound: 0.002 }
}
```

Collections and vectors can be inspected, but they are not mapping sources until an explicit component or reducer is chosen. Events are emitted with timestamps and payloads; they are never interpolated as scalars.

### 5.3 Feature families

#### Contact

- Stable ID, lifetime, reader ID, logical edge ID, edge parameter, contour distance, and contour phase.
- Local/stage position, radius, polar angle, tangent, normal, and incoming/outgoing headings.
- Turn relative to the previous segment and tangent-relative-to-radius angle.
- Normal, tangential, and radial velocity; speed and acceleration.
- Local curvature; nearest/previous/next corner distance and time.
- Exact intersection, vertex touch, proximity, grazing, or overlap classification.

#### Segment and edge

- Chord length, arc length, perimeter fraction, heading, and previous/next heading change.
- Straightness, mean/max curvature, bend energy, midpoint radius/angle, and signed area contribution.
- Center-facing score, hull membership, closest nonadjacent edge, clearance, and self-intersection count.

#### Corner

- Convex/reflex/smooth class, internal/external angle, signed turn, and angle bisector.
- Adjacent-length ratio, radial depth, hull state, symmetry partner, and predicted reader-crossing time.
- Incoming and outgoing one-sided tangents plus an explicit ambiguity flag at the vertex.

#### Reader and contact set

- Contact count/rank, inner/outer or left/right ordering, adjacent gaps, and paired chord lengths.
- Inside-interval count and total length; incidence and relative crossing velocity.
- Entry, exit, graze, vertex touch, and overlap state.
- Selected, pinned, audible, allocated, and culled contact counts.

#### Whole form

- Perimeter, signed/absolute area, centroid variants, axis-aligned bounds, oriented bounds, and diameter.
- Principal axis, eccentricity, compactness, circularity, hull area, solidity, and convexity.
- Radial extrema/variance, curvature statistics, bend energy, center containment, and star-shapedness.

#### Topology

- Open/closed state, component count, endpoints, planarized intersection nodes, and branch degree.
- Proper crossing, touch, tangency, overlap, and near-miss counts.
- Loop/cycle count, winding number, minimum clearance, and fill rule.
- Structural branch is distinct from reader/contact bifurcation. A normal self-crossing has degree four; one ordered contour does not become a Y branch merely because it crosses itself.

#### Symmetry and descriptors

- Reflection axes/residuals, rotational symmetry order, radial autocorrelation, and chirality.
- Fourier boundary coefficients, harmonic energy, lobe count, complexity/entropy, and medial thickness.
- These are edit-cache or on-demand features until performance tests justify a higher cadence.

#### Temporal and predicted

- Feature velocity/acceleration, contact age, birth/death, count delta, split/merge, and approaching/receding state.
- Time to corner, tangency, intersection, reader loop, and rotation loop.
- Forward analysis by next duration, reader cycle, rotation cycle, or event count. A common loop is promised only when independent rates are commensurate.

#### Audible telemetry

- Geometric, selected, allocated, audible, and culled voices.
- Raw gain, normalized gain, envelope gain, mapped frequency/timbre/pan, worklet/fallback state, and estimated rendered level.
- Exact rendered meters, where available, are labeled separately from estimates made on the UI thread.

### 5.4 Mapping behavior

| Feature type | Mapping UI | Required handling |
|---|---|---|
| Unsigned scalar | Range/curve | Clamp or explicitly allow extrapolation. |
| Signed scalar | Bipolar range | Preserve and display the neutral point. |
| Circular | Phase, sine/cosine pair, or unwrap | Never smooth directly across a wrap seam. |
| Category | Selector/table | Define behavior for new or unavailable categories. |
| Event | Trigger/rate gate | Timestamp, debounce, and velocity payload; never interpolate. |
| Collection | Reducer then scalar mapping | Require min/max/mean/rank/count or a selected subject. |

Every mapping stores source feature/version, subject selection, raw domain, normalization, transform, smoothing/hysteresis, target range, unavailable policy, and enable state.

## 6. Accuracy contract

### 6.1 Coordinate and semantic rules

- Declare handedness, zero angle, positive rotation, and units once.
- Preserve local, stage, reader, screen, and audio frames; conversions are explicit.
- Name the center used: transform origin, bounds center, area centroid, vertex centroid, or user anchor.
- State the containment fill rule and make closed-path requirements machine-readable.
- Preserve logical edges even when a curve is subdivided for rendering.
- Distinguish exact analytic, error-bounded sampled, estimated, perceptual/proximity, and unavailable results.

### 6.2 Geometry rules

- Curves use tolerance-driven adaptive subdivision for production analysis; a fixed sample count is not the accuracy contract.
- Circles and other supported primitives retain analytic definitions even if the canvas displays a tessellation.
- An intersection carries residual/error and classification; a proximity contact never masquerades as an exact hit.
- A corner reports both one-sided tangents. Any merged tangent is a named display/mapping policy.
- Relative velocity includes reader motion, form rotation, translation, scale/bounds changes, and deformation.
- Rigid rotation preserves local topology and intrinsic shape features; tests enforce those invariants.

### 6.3 Contact identity and bifurcation

Contacts are associated using reader identity, logical edge, contour parameter, position, tangent, and predicted motion—not sorted array index alone.

For a reader constraint `g(s, t) = 0`, a smooth fold candidate occurs when both `g = 0` and `∂g/∂s = 0`. The event detector must:

1. Adaptively substep the motion interval.
2. Bracket changes in contact existence, multiplicity, tangency, or overlap.
3. Refine the event timestamp by bisection or a bounded root solver.
4. Apply sided tests at polygon corners where a smooth derivative does not exist.
5. Emit stable `contact_birth`, `contact_death`, `tangent_touch`, `vertex_touch`, `split`, `merge`, `overlap_begin`, and `overlap_end` records.

Rigidly rotating a self-crossing form does not create or remove its structural self-intersections, but it can create reader-contact bifurcations as the reader becomes tangent to the contour.

### 6.4 Visual and aural truth

- The stage marker, inspector, mapper, and scheduler read the same snapshot timestamp or an explicitly interpolated snapshot pair.
- Render overlays state their precision when display tessellation is coarser than analysis geometry.
- The Output view separates raw geometry, normalized mapping value, mapped target, scheduled voice state, and rendered/estimated level.
- Audio look-ahead contains intermediate knots and event times; it does not interpolate blindly across a birth, death, corner discontinuity, or overlap transition.
- UI latching may make a short event visible longer, but never changes its stored timestamp.

### 6.5 Initial acceptance tolerances

- Adaptive visible-curve deviation: at most **0.25 CSS px** at the current view transform.
- Contact marker versus analyzed contact: at most **0.5 CSS px**.
- Refined audio event timing: within **one audio render quantum** under supported worklet operation.
- Stable-contact scenarios: **zero identity swaps** across reordering, rotation, and unrelated births/deaths.
- Deterministic event counts and ordering at 30, 60, and 120 Hz UI sampling for the same trajectory.

Tolerance values are recorded with each test profile and may be tightened after measurement. They are not claims about the current demo shell.

## 7. Implementation roadmap

### Phase 0 — isolated product prototype

**Status: Implemented MVP**

- Establish the `morphazoidical/` boundary.
- Build the workbench and Feature Atlas information architecture.
- Demonstrate responsive controls, inspector hierarchy, status/quality labels, overlays, and event presentation.
- Document the feature and accuracy contracts.

Exit gate: workflows can be evaluated without changing any legacy file or implying demo data is production analysis.

### Phase 1 — shared feature foundation

**Status: Implemented MVP**

- Implement the feature registry, frame snapshots, metadata, flattening, and normalization helpers.
- Implement contact, center-relative, corner/hull, reader-set, containment, whole-form, intersection, and topology features.
- Track contacts across frames and emit typed live events.
- Cover the public analysis and registry APIs with isolated unit tests.

MVP boundary: this establishes deterministic sampled-polyline analysis and an isolated end-to-end UI/mapping/audio proving ground. Production parity, adaptive geometry, and swept refinement remain later phases.

### Phase 2 — Shape production hardening

**Status: Planned**

- Harden the implemented isolated Shape/transport adapter without mutating legacy state.
- Correct reader-relative velocity and explicit corner tangent policy.
- Wire real snapshots into the stage, inspector, Atlas availability, and mapping rack.
- Add raw versus normalized versus target telemetry.

Exit gate: visual parity fixtures pass, legacy tests remain green, and feature values remain invariant under coordinate-frame round trips.

### Phase 3 — trajectory-aware swept events

**Status: Planned**

- Extend MVP frame-to-frame contact association with trajectory/lifetime history robust enough for audio scheduling.
- Add adaptive substeps, event bracketing/refinement, overlap intervals, and event latching.
- Add forward-loop/event prediction with bounded compute budgets.
- Schedule audio trajectory knots at discontinuities.

Exit gate: no ID swaps in adversarial fixtures; event timing is frame-rate independent and within the audio tolerance.

### Phase 4 — cached whole-form and topology analysis

**Status: Planned**

- Compute hull, area/centroids, principal axes, compactness, convexity, radial statistics, self-intersections, winding, cycles, and clearance on edits.
- Transform cached intrinsic results under rigid motion instead of recomputing them.
- Add background/on-demand tiers for expensive descriptors.

Exit gate: cache invalidation, rigid-motion invariants, degenerate forms, and self-crossing fill rules are covered by tests.

### Phase 5 — audio and output truth

**Status: Planned**

- Consume the same trajectories in AudioWorklet scheduling.
- Preserve stable voice ownership across contact reordering and bifurcations.
- Report allocation, culling, normalization, envelopes, compression, and rendered/estimated output separately.
- Add capture/replay for visual-versus-aural diagnosis.

Exit gate: automated/offline audio fixtures and manual listening checks meet the event and continuity requirements.

### Phase 6 — cross-instrument adapters

**Status: Planned**

- Implement the common schema per instrument, beginning with features already supported by its topology.
- Keep instrument-specific concepts in namespaced extensions.
- Move an instrument only after parity, accessibility, performance, and audio gates pass.

### Phase 7 — advanced descriptors

**Status: Research**

- Symmetry residuals, Fourier descriptors, lobes, chirality, medial thickness, entropy, and richer prediction.
- Benchmark perceptual usefulness and stability before making any feature a default mapping source.

## 8. Cross-instrument roadmap

| Instrument | First adapter | Later analysis | Key prerequisite |
|---|---|---|---|
| Shape | Contact/edge/corner, reader intervals, global 2D form metrics | Swept bifurcations, symmetry, Fourier descriptors, medial thickness | Stable logical edges and adaptive curve evaluator |
| Lattice | Unit-cell area, edge density, orientation/curvature distributions, contact gaps | Node degree, motif symmetry, cycle and neighborhood descriptors | Stable tile/edge provenance after deduplication |
| Solid | Edge/plane incidence, signed plane distance, depth, contact ordering | Slice loops, slice area/perimeter, component changes | Face adjacency and slice graph construction |
| Hyper | 4D edge orientation, W-depth, projection distortion, hyperplane contacts | Slice topology, component/cycle changes, 4D invariants | Cell/facet adjacency and explicit projection metadata |
| Lumber | Ring/head phase, radius/deformation, local slope/curvature, separation | Ring crossings, inter-ring phase structures, delay-geometry descriptors | Time-preserving waveform/ring parameterization |

The registry remains common, but not every feature applies to every instrument. Availability is capability-driven, never padded with zero values.

## 9. Verification strategy

### 9.1 Unit and property tests

- Analytic fixtures: line, circle, triangle, rectangle, regular/star polygon, bow-tie, tangent circle/line, coincident segment, and degenerate edges.
- Invariants: rigid rotation/translation, scale laws, contour reversal, reader reversal, frame conversions, winding/fill rules, and cache invalidation.
- Property tests: no NaN/Infinity leakage, normalized ranges, deterministic IDs, monotonic arc length, stable ordering, and reversible serialization.
- Mapping tests: angle seam handling, signed neutral points, unavailable policies, collection reducers, event gating, and smoothing.

### 9.2 Integration and regression tests

- Snapshot fixtures connecting engine, canvas marker, inspector, and mapping preview.
- Contact lifetime and bifurcation sequences at several frame rates.
- Audio trajectory fixtures around corners, births/deaths, overlap transitions, and voice caps.
- Run `node --test morphazoidical/tests/*.test.mjs` for the isolated engine and `npm run verify` for legacy regression; the current parent glob does not include nested rewrite tests.
- Saved screenshots for key desktop, tablet, mobile, high-DPI, reduced-motion, and high-contrast states.

### 9.3 Manual perception checks

- Slow rotation through a tangent event: visual contact birth/death and sound onset/offset agree.
- Dense intersections: selected, audible, and culled contacts remain identifiable.
- Corner crossings: one-sided tangent policy matches overlay and mapping behavior.
- Repeated loops: no accumulating phase drift or identity churn.
- Muted workflow: all geometry and event meaning remains inspectable without sound.

## 10. Performance budgets

Budgets are measured on named reference hardware with fixture complexity included in reports; averages alone do not pass a gate.

- Maintain 60 fps on the reference desktop for standard scenes; main-thread work should leave at least half of the 16.7 ms frame for browser rendering and input.
- Target core analysis at **≤2 ms p95** and UI/overlay preparation at **≤4 ms p95** for the standard Shape fixture.
- No unbounded work from device-pixel ratio, shape sampling, intersection count, timeline length, or Atlas results.
- Cache edit-time intrinsic metrics; transform them cheaply during rigid motion.
- Use priority tiers: contact/reader essentials each analysis frame, global form metrics on edit, expensive descriptors on demand/background.
- Bound look-ahead substeps and expose degraded quality rather than silently missing deadlines.
- Avoid per-frame object churn in hot geometry/audio paths; instrument long tasks, allocations, dropped frames, and audio underruns in diagnostics.

The standard fixture and reference hardware must be committed alongside performance tests before these numbers become release gates.

## 11. Accessibility requirements

- Meet WCAG 2.2 AA for text, controls, focus, structure, and contrast.
- Full keyboard access for transport, numeric edits, feature selection, tabs, mappings, overlays, and contact/event navigation.
- Every canvas-only interaction has a DOM control or object-list equivalent.
- Visible focus, logical tab order, landmarks, headings, fieldsets, labels, and error/help associations.
- Touch targets at least 44 by 44 CSS px where space permits; dense professional controls may use a documented equivalent target strategy.
- Do not use color alone for contact identity, direction, status, event kind, or confidence.
- Honor reduced motion; provide pause, scrub, and static inspection.
- Throttle live-region announcements. Announce selected or exceptional changes, not every animation-frame metric.
- Values include units and textual direction; circular values do not rely solely on a rotating glyph.
- Preserve functionality at 200% browser zoom, narrow portrait layouts, high contrast, and without audio.

## 12. Data, state, and compatibility

- Version feature IDs, snapshot schema, mappings, and saved sessions independently.
- Persist only user-intended state; ephemeral contact IDs and diagnostics remain session data unless captured explicitly.
- Unknown features survive import as disabled records with an explanation.
- A legacy adapter is read-only until migration; state conversion is explicit and reversible where possible.
- Network output is opt-in and displays destination, cadence, units, and schema version.

## 13. Definition of done for the first production release

The rewrite can be considered a production Shape replacement only when:

- The workbench uses real shared snapshots rather than demo values.
- Visual, inspector, mapping, and audio paths satisfy the accuracy contract.
- Stable contact tracking and event scheduling pass frame-rate and adversarial tests.
- Every enabled Atlas feature has tests, documentation, validity rules, and an unavailable policy.
- Performance and accessibility budgets pass on named test profiles.
- Legacy behavior has either parity or an intentional, documented migration.
- The legacy application remains available for rollback until real-world sessions validate the rewrite.

Anything short of those gates remains clearly labeled prototype, estimated, experimental, or planned.
