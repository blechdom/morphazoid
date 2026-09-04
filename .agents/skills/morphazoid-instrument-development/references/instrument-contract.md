# Instrument contract

Write this short contract before broad implementation. Keep it proportional to
the instrument; a compact table or a few paragraphs is enough when the concept
is simple.

## Identity

- **One-sentence identity:** What makes this recognizably this instrument?
- **Primary action:** What does the player do first?
- **Immediate feedback:** What must they see and hear?
- **Non-goals:** Which adjacent ideas are intentionally excluded from this pass?

## Causal model

Describe the chain from player action to result:

```text
gesture or state -> visible mechanism -> synthesis parameter/event -> sound
```

For each core relationship, record:

| Player/visible input | Model quantity and units | DSP destination | Audible expectation | Visual feedback |
| --- | --- | --- | --- | --- |
| | | | | |

The visual and audio should derive from the same state or timeline. Document any
intentional exception.

## Controls and defaults

For every identity-defining control, record its units, min/default/max, scaling
curve, useful sweet spot, and expected audible relationship. Defaults should be
moderate in level and playable immediately. Define a reproducible initial or
seeded QA state even when live performance is intentionally stochastic. Extreme
values may be stranger but must remain finite and bounded.

Describe how presets cover genuinely different regions of articulation,
duration, spectrum, pitch/rhythm, space, or mechanism. Avoid preset sets that
mainly differ in loudness or labels.

## State ownership

Decide which state is changed or preserved by:

- Audio arm/mute;
- transport start/stop;
- presets;
- reset;
- mutation/randomization;
- structural edits such as voice, anatomy, or sequence length changes;
- navigation, visibility changes, and teardown.

Safe edits should normally preserve transport phase and unrelated state. Note
any deliberate restart or destructive transition.

## Bounds and lifecycle

Record maximum voices, nodes/events, geometry size, render/DPR cost, scheduler
lookahead, tail duration, and any microphone/MIDI/media resources. Define the
stop, hide, navigation, error, and `pagehide` cleanup behavior.

## Research ledger

When research informs the model, classify each important claim as:

- observed/sourced mechanism;
- playable approximation;
- speculative or fictional extension;
- explicit non-claim.

Record the source and license/provenance for data, recordings, images, and code.

## Acceptance scenes

Define deterministic scenes for the default, representative presets, core
control min/default/max states, hostile inputs, a live transition, stop/release,
and any important touch or MIDI gesture. State which observations are automated
and which require listening or physical hardware.
