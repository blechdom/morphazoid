# Perceptual QA pass

Choose the smallest matrix that covers the requested risk. Record exact state so
another reviewer can reproduce each scene.

## Scene matrix

| Scene | Required observation |
| --- | --- |
| Audio-off transport | Transport behavior, silence, Audio state, visible guidance |
| Default | Immediate identity, useful level, finite output, visible causality |
| Representative presets | Distinct articulation/spectrum/rhythm/space with stable level |
| Core control min/default/max | Direction, magnitude, useful center, no dead range |
| Live state change without a scheduled onset | Continuity, smoothing/crossfade, preserved phase and unrelated state; compare with a legitimate attack control scene |
| Stop/release | No click, stuck voice, timer/node leak, or persistent output |
| Hostile input | Clamping, bounded CPU/polyphony/tail, finite output |
| Touch portrait/landscape | Scroll/drag ownership, reachability, timing continuity |
| MIDI/microphone/device | Permission, reconnect, latency/feel, cleanup when applicable |

Add instrument-specific scenes only when they exercise a declared identity or
risk. Use known presets, seeds, sample rates, durations, and timestamped events.
Exercise every preset when the bank is small; otherwise choose a documented
stratified sample spanning contrasting articulation, spectrum, register,
rhythm/density, space, and level. Measure raw level and clipping first, then
level-match a copy for character comparison.

## Automated evidence

At minimum record:

- silence/non-silence and finite samples;
- peak, RMS, clipping, and channel activity;
- onset timing, event count, release/tail duration, and stuck output;
- parameter sensitivity between min/default/max;
- distance between representative presets;
- transition-only adjacent-sample deltas and brief high-frequency energy,
  compared with an intended attack when investigating clicks;
- relevant spectrum, pitch, stereo, or envelope features;
- connection, node, timer, and media cleanup.

Prefer feature comparisons over sample-exact snapshots for oscillators, noise,
realtime scheduling, convolution, and browser-dependent DSP. Non-finite samples
and unsafe runaway output fail whenever a render exists. Silence, clipping,
events, channels, duration, and cleanup are judged against the declared scene;
record unavailable evidence as not measured.

## Listening prompts

Listen at a safe, consistent monitoring level and answer:

- Is the named identity apparent without reading the explanation?
- Does the default start in a useful sweet spot?
- Do labels and the visible mechanism predict what is heard?
- Are attacks prompt enough and tails intentional?
- Do controls offer continuous useful leverage rather than a dead middle and
  unstable extremes?
- Are presets different in character rather than merely in loudness?
- Are noise, buzz, metallic resonance, or a generic drone part of the mechanism
  or accidental substitutes for it?
- Do edits, presets, tempo changes, and structural changes remain click-free and
  preserve the intended playback state?
- Does extended use reveal piercing bands, fatigue, excessive bass/level, or
  feedback risk?

Do not write "sounds good" as the only result. Record the listener, monitoring
path, scene, observation, and decision. If nobody listened, label the pass
"automated characterization only."

## Reference comparison

An approved reference needs a captured URL/build/commit, environment, scene,
metrics, and listening decision. Align candidate and reference by trigger or
measured onset, report per-feature differences, and attach short A/B audio when
useful. Updating a reference requires intentional review; current behavior is
not automatically correct.
