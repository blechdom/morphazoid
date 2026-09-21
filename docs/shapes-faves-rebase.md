# Shapes Faves promotion and main integration

September 21, 2026.

- Shapes is first in Faves. Shape, Solid and Hyper retain their original
  canonical/legacy routes and their Geometric category, but no Faves tag.
- The presets/refactor work was preserved at `6728675` on the local
  `codex/full-instrument-presets` branch before integration.
- `codex/shapes-faves-rebased` replays the catalogue/layout, tour and complete
  preset work onto `d96793a` from `origin/main`. The old published branch is not
  force-updated, and main is not replaced.
- Main's 3D Graph and eight WIP instruments remain registered. Their controllers
  and styles follow the existing `src/instruments/` / `src/families/` layout,
  with HTML, import paths, release inventory and browser-test references updated.
  Geometry, synthesis, device ownership and existing HTML routes are unchanged.
- Main's Rubix surface mixing, SIMD 303, extra kits and timbre presets remain
  intact. Its exact defaults/factory records now feed the shared full-preset
  adapter. Complete scenes also protect main's performer output/acid/drum
  levels, including mute. Normal recalls retain the live player; a backend
  transition can establish a new audio-clock origin using the existing engine.
- An existing Hyper Rubix preset mismatch found during browser verification was
  fixed: the chosen turn plane must be tangent to the selected cell. Factory
  scenes and dice now enforce that relation instead of being changed by UI
  normalization during recall. No DSP change was needed.

All Shapes source/geometry/audio files are unchanged by this rebase. The
106-preset bank, merged Corners & Notes mode, overlapping ADSR/swell, dense-voice
fixes and random guards remain as previously tested.

Verification logs and the recoverable pre-rebase tracked/untracked snapshot are
under the ignored `test-results/shapes-faves-publish/` directory. The current
rollout status records repository and browser results. Generated `dist-wax/`
is rebuilt, not manually merged. Publication is a branch push, not a main merge
or production deployment.

## Final local verification

- `npm run verify`: 3,990 passed, six skipped, zero failures; runtime syntax,
  SIMD artifacts, XYFlow and clean-build WAX parity passed (207 WAX pages).
- Final browser integration: eleven tests passed initially; the 106-preset audio
  sweep reported one intermittent clipped meter sample on Rattlesnake's
  `shapes-rattle-square-four`. The entire audio sweep passed on an isolated rerun.
  Shapes runtime and DSP are byte-identical to the pre-rebase checkpoint, so
  no sound retuning was made for this publication. The observation remains a
  listening follow-up, not a claim of universally click-free output.
- All nine incoming main instrument routes passed browser error checks after
  their shared stylesheet references were updated.
- Source-only WAX tests now exclude Playwright trace copies and test that nested
  authored pages are still included; browser artifacts cannot masquerade as
  authored pages when the suites run concurrently.
