---
name: morphazoid-perceptual-qa
description: Diagnose and, when requested, tune an existing Morphazoid browser instrument's sound, control audibility, presets, transitions, visual causality, and touch playability. Use for silent, weak, harsh, clicky, generic, homogeneous, drifting, or input-specific behavior and for listening-focused release review; not for native plug-ins or creating a new instrument.
---

# Morphazoid Perceptual QA

Determine whether the instrument is musically legible, safe, continuous, and
faithful to its visible mechanism. Automated tests provide evidence; they do not
substitute for listening or physical interaction.

Respect the requested action. A diagnosis request authorizes investigation and
reporting, while a request to fix or polish authorizes the corresponding code
changes.

## Establish the contract and scene matrix

1. Read `AGENTS.md`, `QA_AUTOMATION.md`, the instrument's app/model/audio/tests,
   and `contracts/audio-transport-v1.md` when transport applies.
2. Resolve the exact route, slug, control, and preset bank from the request,
   active files, or reproduction context. When multiple candidates remain,
   identify them and ask before expensive or mutating work; any read-only
   characterization made in the meantime must remain explicitly conditional.
3. State the instrument's intended identity and central visual-to-audio causal
   loop. If no explicit contract exists, infer it from labels, presets, docs,
   and behavior and mark the inference.
4. Read [references/listening-pass.md](references/listening-pass.md) and choose a
   proportional matrix: default, representative presets, identity controls at
   min/default/max, one live transition, stop/release, and relevant pointer,
   keyboard, touch, MIDI, microphone, or visibility cases.
5. Preserve exact provenance: worktree/commit, browser, sample rate, route,
   preset/seed/state, input gesture or MIDI fixture, render duration, warm-up,
   and reference build when comparing versions.

## Measure before interpreting

Prefer deterministic `OfflineAudioContext` renders for DSP that supports them.
For live browser paths, use `src/audio-output-manager.js` for its supported
coarse RMS/peak, channel, active-state, and connection evidence. Use an existing
instrument-specific capture seam for event-aligned waveform, click, or detailed
timbre analysis; do not pretend coarse meter data is a durable audio capture.

For every audio render that exists, treat non-finite samples and unsafe runaway
output as universal failures. Check silence/non-silence, clipping, channel
activity, events, onset/release, tails, and cleanup only when the declared scene
expects or exposes them. Mark unavailable checks as not measured rather than
passing them by assumption. Then compare useful relative features: RMS/peak,
crest factor, onset and tail, coarse spectral bands or centroid, fundamental
when meaningful, stereo balance, parameter sensitivity, and preset separation.

Do not impose one universal timbre threshold on unrelated instruments. Derive
expectations from the instrument contract and approved reference scenes. Align
signals by declared trigger or measured onset before comparing timbre. Measure
and report raw level, clipping, and level consistency first; then level-match a
copy for timbre/identity comparison so normalization does not hide a level
defect. Without an approved threshold, require the measured direction to match
the declared mapping. For stochastic or noisy DSP, render each state at least
three times, compare the between-state effect with within-state spread, and
increase repeats when the estimate is unstable. Report the effect and spread
instead of inventing a pass line.

For clicks, compare repeated transition-only windows with repeated steady-state
windows and a control scene containing the legitimate attack. Inspect aligned
adjacent-sample deltas and brief high-frequency transient energy. Report the
transition's excess over both distributions; confirm a defect only when an
unintended transient is repeatable or violates an approved tolerance. Do not
label every sharp percussive attack a defect.

For layered models, use existing solo/mute/debug seams to isolate each voice or
mechanism. If diagnosis-only scope exposes no such seam, trace the model
statically, characterize what can be observed, and recommend the smallest
instrumentation needed rather than editing code without authorization. Calibrate
source character, onset, duration, spectrum, level, and control leverage before
debugging the composite. Read
[references/failure-signatures.md](references/failure-signatures.md) when a
symptom needs likely-cause routing.

## Exercise real interaction

- When a primary transport exists, activate it once with Audio off. It may move
  visually but must not silently arm Audio; verify the visible Audio-off
  guidance.
- In the normal browser, after an explicit Audio action, exercise start, stop,
  reset, representative presets, core controls, and live
  structural/tempo/mode changes. Look for clicks, dropouts, replayed late
  bursts, missing first events, state loss, and playhead/audio drift.
- Inspect visual causality: identity-defining events and changes have the
  correct visible source or state, and each core visible edit produces the
  declared audible change. Continuous input, ambience, and tails may use
  aggregate causal feedback.
- When the complaint or changed contract involves input or responsive behavior,
  test the applicable mouse, keyboard, real/emulated touch, MIDI, microphone,
  visibility, and interruption cases. Touch checks use `390x844` and `844x390`
  and cover document scrolling, drag ownership, gesture cancellation, reachable
  controls, and continuous audio scheduling.
- Inspect console, page, request, and first-party HTTP failures. Use screenshots,
  traces, metrics, and short candidate/reference audio as review evidence rather
  than treating a screenshot as proof of sound quality.

## Listen and decide

The listening pass should judge identity, useful sweet spots, expressive range,
label-to-sound agreement, preset diversity, level consistency, fatigue, harsh
resonances, noise character, onset, tail, clicks, and whether the visual feels
causally connected.

When no human listening or physical-device pass occurred, say so explicitly and
separate automated findings from perceptual claims. Never describe a current
render as an approved baseline until someone has listened to and accepted it.
When audio rendering, dependencies, hardware, or listening access is missing,
return a static or automated characterization with reduced confidence rather
than implying the full pass occurred.

When fixing is in scope, correct the failed causal or lifecycle contract instead
of merely loosening a test. Re-run the smallest reproducer, the scene matrix, the
focused tests, and any shared browser suite affected by the change. Keep new
feature ideas outside the current polish pass.

## Report

Return:

1. the intended audible/visual contract;
2. scenes and environments exercised;
3. findings labeled as confirmed defect, deterministic model result, runtime
   observation, perceptual judgment, or hypothesis;
4. objective measurements/traces and perceptual findings, clearly identifying
   the listener;
5. fixes made or ranked likely causes when diagnosis-only;
6. remaining human, hardware, or deployment checks.
