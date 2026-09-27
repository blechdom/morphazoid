# Hybrinx: Loop stays live while browsing sounds

September 26, 2026 — owner-requested continuation of the
[master-volume and meter correction](hybrinx-volume-meter.md).

Hybrinx's **Loop toggle is performer/transport state**, not a preset parameter.
When Loop is on, selecting a preset, Next, preset arrows or top-row dice leaves
it on. When off, those same actions leave it off. Choosing sounds neither starts
a paused call player nor arms Audio. An already-playing loop keeps playing
through later call boundaries; the existing phase-preserving recall is retained.

Capture, all twelve factory snapshots and dice omit `state.loop`. Applying an
older snapshot ignores its stored Loop value, just as it ignores stored master
volume. Toggling Loop no longer makes an otherwise selected scene Custom.
Explicit Stop still stops, and explicitly disabling Loop still allows the call
to end normally. Loop gap, gesture rate, contours, tongue clips and all other
musical parameters remain in the scenes; startup still has Loop and Audio off.

This deliberately supersedes the original Hybrinx preset-owned Loop policy;
other instruments' loop policies are not changed. The native host/call controls
and lower-panel body mutation retain their existing behavior. No synthesis,
audio timing, compressor, meter routing, gain, controls or public route changes.

All twelve musical fingerprints remain unchanged after restoring only the
archived factory Loop=true for comparison. The former dice Loop RNG draw is
reserved (not applied) so every other seeded musical value remains identical.
A before-change random-stream fingerprint protects that preservation; original
fixture hashes are not regenerated. Exact amendments extend
`hybrinx-volume-meter-runtime-changes.json` and its frozen-source reversal.

Regression coverage: pure on/off and legacy recall, deterministic dice,
rollback, long-lived call timelines, actual adapter phase continuity, source/WAX
at three viewport sizes, real menu/Next/arrows/dice/Loop controls, continued
Audio/Play across randomized call boundaries, explicit Stop, one-shot completion,
master/meter regression and teardown. These are mechanical tests, not human
listening or device/host approval. Publication does not imply listening or device/host approval.
