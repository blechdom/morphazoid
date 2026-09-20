# 3D Graph acceptance — September 20, 2026

Prepared for publication from `/home/blechdom/creative/morphazoid`, local `main`,
base `e042512`. The publication commit and deployment result are reported in the
handoff; passing local tests alone does not establish deployment.

## Verified gates

- Pure 3D model: **15 tests**, including continuous defaults, 30-preset coverage,
  independent axis mappings, persistent edits and backward-compatible patches.
- Full `npm run verify`: **3,649 passed**, 6 skipped, no failures or cancellations.
  Syntax parsing, XYFlow determinism and committed WAX parity passed.
- Dedicated 3D Graph browser suite: **12 passed**.
- Shared navigation/route checks for 3D Graph, Graph Synth and Graphs: **6 passed**.
- Production and WAX builds passed; Storybook artifact validated (109 entries).
- Instrument-development skill passed `quick_validate.py`; its existing trigger
  boundary is unchanged. Physics/geometry-derived continuous tuning is now the
  project preference, not an instruction to rewrite unrelated older instruments.

## Acceptance relationships

- Defaults: MIDI seed **68**, **Continuous** tuning, forces off. All thirty
  presets use continuous tuning and remain freely editable.
- Twenty-four added presets cover all four layouts, seven graph generators,
  five voices, all seven timing sources, short/long envelopes, sparse/dense
  routing, multiple seed ranges and different force configurations.
- Source → sound rows independently assign X/Y/Z, radius, incoming route
  length/stretch or Off to timing, pitch, FM/PM color, shading and stereo.
  Pitch also supports accumulated signed bends. Tests exercise axis isolation,
  tiny continuous pitch changes, source Off and voice-dependent controls.
- Drag, keyboard and slider edits pin the edited node. It holds under enabled
  forces; explicit unpin releases it. Pointer cancellation restores exact local
  coordinates and the original pin state. Preset recall restores a fresh graph,
  pins and route switches without changing Audio, Play or camera state.
- Canonical Graph Synth generators and split/merge/feedback gains are reused.
  Camera projection/rotation never enters the musical state. Timing can change
  with Z even when XY is unchanged.
- Forces are deterministic, bounded, effective and pin-respecting. In-flight
  deadlines stay fixed; following hops read new geometry. Disabled routes block
  unsubmitted arrivals. Acyclic routes finish; cyclic routes decay under limits.
- Audio arm stays separate from Play, sending notes and incoming MIDI handoff.
  Panic, Audio off and pagehide release sound. Stale attacks are dropped after
  stalls instead of bursting at the current time.
- The subtitle is removed. The small ⓘ button opens a native modal with the
  controls, formulas, pin behavior, timing semantics, recovery and keyboard guide.
  Escape closes it and returns focus; opening help does not stop playback.
- Desktop 1440×900, phone 390×844 and landscape 844×390 checks cover keyboard,
  pointer/touch cancellation, nested scrolling, visible numeric values, dialog
  scrolling, title/camera non-overlap and no horizontal document overflow.
  Coarse Audio/Play targets are at least 48 px. Serious/critical accessibility
  checks pass for both the playing surface and the open help dialog.

## Evidence and limitations

Local logs: `/tmp/graph3d-final-verify.log`, `/tmp/graph3d-final-browser.log`,
`/tmp/graph3d-revision-neighbors.log`, `/tmp/graph3d-final-build.log`.
Reviewed screenshots and measured layouts: `/tmp/graph3d-revision-review/`.
A first visual review caught squeezed numeric outputs in the narrow rail;
wrapping labels and non-shrinking outputs now have explicit regression coverage.

All thirty presets produced finite, non-silent audio in their 800 ms live test
windows, with no clipped samples and peaks below the test ceiling of 0.95.
These are short mechanical measurements, not exhaustive loudness or timbral
approval. The test attaches the per-preset metrics when an attachment-retaining
Playwright reporter is selected.

**No human listening approval, physical-phone performance test, hardware MIDI,
or real WAX/DAW-host pass was performed.** Automated checks do not prove
perceptual click-freedom, musical usefulness, or physical acoustic accuracy.

The original Graph Synth, Graphs, Graph Delay kernel, shared synth renderer and
Solid projection module are unchanged. The pre-existing staged CSV and
uncommitted catalogue/logo-suggestion work remain outside this publication.
