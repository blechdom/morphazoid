# Morphazoid Geometric Analysis and Real-Time Feature Plan

Status: reference analysis, 2026-07-21

Morphazoid can support a much richer real-time geometry stream, including
rotation-aware intersections and contact bifurcations. The central architectural
recommendation is a shared geometry-analysis layer that feeds Canvas, Mapping,
Output, and audio from the same timestamped data.

## Accuracy audit

### What is already strong

- Shape drawing and sonification use the same normalized `ShapePath` and contact
  calculations, so the visible contact normally agrees with the geometric value
  being mapped.
- Path travel is constant with respect to sampled arc length.
- Scan and radar intersections handle shared vertices and coincident runs.
- Audio follows a 75 ms future geometry trajectory, refreshed every 24 ms.

### Important qualifications

- The authoritative geometry is currently a sampled polyline, not the smooth
  curve implied by the controls. Shape fixes `samplesPerEdge` at 48.
- The dedicated circle is therefore a 48-gon. Its maximum centerline error is
  approximately `0.00214` model units—roughly 0.84 CSS pixels on a
  1000-pixel-square stage—and its tangent changes in 7.5-degree steps.
- Tangent, perimeter, intersection, and corner values are accurate for that
  polyline, but are not analytically exact. Corner strength is derived from
  adjacent sampled chords, and an arbitrary contact receives the strength of
  its nearest logical corner rather than true local curvature.
- A corner has two valid one-sided tangents. Scan/ray intersection merging
  averages them, while trace mode generally uses the outgoing segment. Output
  should expose incoming, outgoing, and `ambiguous at corner` rather than one
  supposedly exact tangent.
- Open-line radar creates proximity contacts within a 0.11-radian beam around
  endpoints. That is musically useful, but it should be identified as
  `proximity`, not an exact intersection.
- Scan position is relative to the shape's rotation-dependent bounding box. Its
  actual stage velocity includes the current span and the changing bounds; the
  present crossing-angle calculation omits those terms during simultaneous scan
  and rotation.
- Scan/radar voice IDs use sorted contact indices. When contacts appear or
  disappear, a surviving oscillator can be reassigned to another branch.
- The Output dashboard shows instantaneous, pre-normalization values. Heard gain
  may differ because of voice-count scaling, the 32-voice cap, master taper,
  smoothing, and compression. The panel also updates at roughly 16.7 Hz while
  moving.

The current visual and aural renderings are therefore mutually consistent in
ordinary motion, but both inherit the sampled-geometry approximation, and
topology changes are not yet rendered with stable identities or precise event
timing.

## Practical feature catalog

| Scope | Real-time characteristics |
| --- | --- |
| Contact | Stable ID, lifetime, reader ID, logical edge ID/T, contour phase and distance, stage/local X/Y, radius, polar angle, tangent, normal, incoming/outgoing heading, signed turn from previous segment, tangent-versus-radius angle, radial motion, local curvature, nearest/previous/next corner distance |
| Segment/edge | Chord and arc length, perimeter fraction, heading, previous/next heading difference, straightness, mean/max curvature, bend energy, midpoint radius/angle, signed area contribution, center-facing score, hull membership, closest nonadjacent edge, self-intersection count |
| Corner | Convex/reflex/smooth, internal/external angle, bisector, adjacent-length ratio, radial depth, hull status, symmetry partner, reader-crossing time |
| Reader/contact set | Contact count/rank, inner/outer or left/right ordering, adjacent spacing, paired chord length, inside-span total, number of inside intervals, incidence, relative normal/tangential velocity, entry/exit/graze/overlap state |
| Whole form | Perimeter, signed/absolute area, multiple centroids, bounds, oriented bounds, principal axis, eccentricity, diameter, compactness, circularity, hull area, solidity, convexity, radial extrema/variance, lobe count, curvature statistics, center-inside and star-shapedness |
| Topology | Open/closed, components, endpoints, intersection nodes, intersection kind and multiplicity, branch degree, loop/cycle count, winding number, minimum clearance |
| Symmetry/descriptors | Reflection axes and residuals, rotational symmetry order, radial autocorrelation, Fourier boundary coefficients, harmonic energy, chirality, complexity/entropy |
| Temporal | Feature velocity/acceleration, contact age, birth/death, count delta, split/merge, time to corner, time to tangency, approaching/receding, predicted values |
| Audible telemetry | Geometric contacts, selected voices, culled contacts, raw gain, post-normalization gain, mapped frequency/timbre, worklet/fallback mode, estimated rendered level |

Cheap contact and reader values can run every analysis frame. Whole-form
topology, hulls, symmetry, and descriptors should be cached on form edits because
rigid rotation does not change them.

## Inside and outside

There should not be one ambiguous `inside` Boolean. Expose these distinct
meanings:

- `cornerClass`: convex, reflex, or smooth.
- `hullClass`: on convex hull or re-entrant.
- `centerFacing`: `outwardNormal · radialDirection`, a continuous -1 to +1
  value.
- `radialMotion`: inward, circular/tangent, or outward from
  `tangent · radialDirection`.
- `readerCrossing`: entry, exit, grazing, or overlap.
- `insideIntervals`: alternating contained spans between ordered scan contacts.
- `pointContained`: winding-number or even/odd containment.

Open paths have no intrinsic inside, so those features must be marked unavailable
rather than returned as zero. Self-crossing forms also need an explicit fill
rule.

## Intersections and bifurcation

There are three separate cases.

### Structural branch

Planarize the geometry into a graph and inspect node degree. A node of degree
three or more is a branch. A single ordered Shape contour cannot produce a true
Y branch; a normal self-crossing creates a degree-four node.

### Contour self-intersection

Detect proper crossings, touches, tangencies, overlaps, and near misses between
nonadjacent logical edges. Rigid 2D rotation cannot create or destroy these—it
only rotates their positions. Cache them in form-local space.

### Reader/contact bifurcation

This can happen while rotating. If

`g(s,t) = readerNormal(t) · (curve(s,t) - readerOrigin(t))`,

contacts satisfy `g = 0`. A fold bifurcation occurs when `g = 0` and
`∂g/∂s = 0`: the reader is tangent to the contour and a pair of contacts is born
or dies. Polygon corners need sided tests rather than smooth derivatives.

The runtime detector should:

- Track contacts by logical edge, contour position, position, tangent, and
  predicted motion—not array index.
- Adaptively substep the reader/rotation interval.
- Bracket suspected births, deaths, tangencies, or overlaps.
- Refine the event time by bisection.
- Emit `contact_birth`, `contact_death`, `tangent_touch`, `vertex_touch`, `split`,
  `merge`, and `overlap_begin/end`.
- Latch event indicators in the UI while preserving their precise audio-clock
  timestamps.

Forward looping should support `next N seconds`, `next reader loop`, `next
rotation loop`, or `next N events`. A moving reader and independently rotating
form only share a universal loop when their rates are commensurate.

## Output and Mapping design

Replace hard-coded source lists with a feature registry. Each feature needs:

- Stable ID and label
- Scope and coordinate frame
- Raw unit and normalized domain
- Scalar, signed, circular, categorical, or event type
- Validity conditions and confidence
- Update tier and default smoothing
- Available aggregations

Angles should offer seam-safe sine/cosine channels in addition to phase. Events
should be triggers, not interpolated scalars. Unavailable values must never
silently become zero.

The Output panel should be reorganized into:

- Active Contact
- Reader / Contact Set
- Edge and Corner
- Center / Inside-Outside
- Whole Form
- Topology and Events
- Motion / Prediction
- Audible Output

It should allow pinning a stable contact and show raw geometry, normalized
mapping value, mapped target, and rendered/estimated audio separately.

## Implementation sequence

1. **Correctness contract**
   - Define coordinate/angle conventions, center choices, fill rule, logical
     versus sampled segments, and exact versus perceptual contacts.
   - Correct scan-relative velocity.
2. **Shared feature engine**
   - Add a pure geometry feature layer and central registry.
   - Implement logical edge IDs, one-sided tangents, center-relative angles,
     local curvature, and raw/normalized values.
3. **Inside/outside and stable tracking**
   - Add winding, hull, entry/exit, inside intervals, stable contact IDs,
     audible/culled status, and overlap metadata.
4. **Global cached analysis**
   - Add area, centroids, hull, compactness, principal axes, radial statistics,
     self-intersections, and minimum clearance.
5. **Bifurcation and lookahead**
   - Add swept event detection and intermediate trajectory knots.
   - Schedule contact births/deaths within lookahead instead of only
     interpolating contacts that exist now.
6. **Cross-instrument adapters**
   - Lattice: unit-cell area, edge density, orientation/curvature distributions,
     node degree, and contact gaps.
   - Solid: 3D edge/plane angle, signed plane distance, depth, and contact
     topology. Slice loops/areas require face adjacency.
   - Hyper: 4D edge orientation, W-depth, projection distortion, and slice
     topology. Full slice topology requires cell/facet adjacency.
   - Lumber: ring radius/deformation, local slope/curvature, head phase, ring
     separation, and crossings.
7. **Advanced descriptors**
   - Symmetry, Fourier descriptors, lobes, medial thickness, and topology
     summaries.

## Acceptance targets

- Adaptive render error below 0.25 CSS pixels.
- Contact-marker error below 0.5 CSS pixels.
- Rotation-invariance and equivariance tests for every declared feature frame.
- No contact-ID swaps at bifurcations.
- Frame-rate-independent event counts.
- Audio event timing within one render quantum where the platform permits.
- Explicit quality/confidence metadata near every degeneracy.
