# Hybrinx: live master volume and working output meters

**September 26 update:** [Loop now stays live too](hybrinx-preset-loop.md);
presets and dice no longer own its on/off state.

September 25, 2026 — owner-reported preset-volume and silent-meter correction.

## Master volume is not a scene parameter

Hybrinx's twelve complete presets, capture and dice no longer store `state.level`.
Menu, Next, preset arrows, randomization and rollback retain the performer's
current output, including mute. Moving the volume knob no longer makes the
selected scene Custom. Older snapshots containing a master level remain valid,
but apply ignores that saved value. Live activity stays outside snapshots too.

All other scene data is retained exactly: IDs/order, labels, host anatomy,
pressure and other musical dynamics, call contours, tongue poses and motion
clips, modulation and gap durations. The native host/call selectors, startup
master 0.48, 0–1 knob range, Audio/Play and scheduling are unchanged.

## Why the header showed no signal

The shared Syrinx controller imported `audio-output-manager.js` with an old
query string, while `nav.js` imported the canonical URL. ES modules with those
different URLs created separate manager instances. The audio instance had one
connected output; the header's instance had none. Audio reached the destination
but the header meters and output-device control did not observe that context.

The controller now imports the same canonical URL as navigation. This also
corrects the same connection in Syrinx, Syrinx UI and Tongued Beasts, which use
that controller. No global singleton redesign or DSP modification is involved.

The preserved audio path is:

**Physical source/tract → calibrated call trim → master knob → compressor →
final analyser/output manager → destination**, with a parallel stereo meter tap.

Meters show the **actual post-master, post-compressor signal**, not the knob's
position. Turning up a silent instrument must not illuminate them. Mute settles
to silence, and the connection is released on page exit. Existing per-call/model
calibration trims remain separate from user volume and are not removed.

## Level diagnosis, not mastering

Before the fix, at the same master 0.44, a Chromium 151 / 48 kHz live scan of all
twelve scenes found nonzero signal in the engine's manager and zero connection
and meter activity in the header's manager. Example observed sample peaks:

| Full scene | Peak, dBFS (approximate) |
| --- | ---: |
| Dove · Velvet coo | -28.7 |
| Owl · Hollow lullaby | -25.2 |
| Raven · First croak | -18.1 |
| Wolf · Rolling howl | -5.9 |
| Bullfrog · Rubber gate | -5.6 |
| Cow · Wandering vowels | -6.2 |

These are sampled live analyser windows over at least a call cycle, **not**
integrated LUFS, true-peak or calibrated acoustic SPL measurements. No sampled
clipping was detected. Quiet and stronger scenes differ substantially, so the
whole instrument is not simply silent or uniformly under-gained. The compact
header currently displays linear amplitude percentages, not a logarithmic dB
scale; a quiet but audible call can still occupy only a small part of the meter.

A professional instrument need not hit one universal peak/loudness target;
headroom, articulation and the mix matter. Raising every scene would push the
stronger ones harder into the existing compressor. This correction therefore
does **not** add blanket gain, normalization or change any musical parameter.
Further balancing of the quiet scenes is a separate listening-led decision.

## Preservation and verification

Focused Node and browser tests cover all twelve scenes, legacy snapshots,
deterministic dice, retained volume and identity, real stereo output, gain
sensitivity, muted live recalls, release/cleanup, native sub-presets, source/WAX
and desktop/portrait/landscape controls. Shared-controller routes also receive
meter/mute/teardown checks. `hybrinx-volume-meter-runtime-changes.json` documents
exact amendments; frozen module/pointer checks reverse them, without changing
historical hashes. A before-change musical fingerprint records all non-master
scene values.

Automated measurements do not claim
human listening approval, physical-device or positively detected WAX-host QA.
See the rollout status and local handoff for completed gate results.
