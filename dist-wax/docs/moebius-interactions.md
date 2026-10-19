# Möbius interaction recovery

The Möbius page supports direct targeting in Plane slice mode. Starting a drag
on a projected band triangle rotates the slicing plane; starting outside the
band, including its hole, rotates the view. The target stays fixed until that
gesture ends or is cancelled. Counterpoint weave drags always rotate the view.
Arrow keys retain keyboard plane and ribbon navigation.

The stage keeps the instrument title and playable graphic. Separate Shape/2D
head selectors, topology slogans, legend and numerical stage telemetry are
removed from Möbius. Its direction action sits beside speed and disappears in
forward-only Counterpoint weave. Klein Bottle retains its existing selectors,
stage readout, direction label and layout.

The three local buttons are labelled **Quick setups · form + sound** and explain
their scope. **Odd half-twists** edits geometry only. The current complete preset
banks, main preset menu, Next and parameter dice remain separate and unchanged.
Recall preserves Audio arming, primary transport and output level.

## Weave edits

Rate, sound and ribbon-position edits discard obsolete future attacks while
allowing already sounding envelopes to finish. Rate changes do not retrigger a
note, and playing sound-slider changes take effect on subsequent pulses. Complete
weave-to-weave preset recall preserves the live phase and sounding tails.

Paused ribbon scrubs coalesce repeated input at the same station and space
manual auditions by at least 60 ms. Manual auditions use a 12 ms smooth attack
and overlapping tails. Play takes over from any pending paused audition. Stop,
Audio off and lifecycle cleanup cancel pending work. The existing audio-clock
lookahead scheduler remains independent of animation frames.

## Mechanical verification

The focused checks cover projected triangle hits and holes, complete preset
validity, audio envelope primitives, explicit Audio arming, transport retention,
Klein behavior, direct targeting and cancellation at 1440×900, 390×844 and
844×390, future-note cancellation, retained tails, scrub coalescing and
scheduling while animation frames stop. Browser checks also exercise every
current complete preset plus Next and dice.

```sh
node --test tests/nonorientable-surfaces.test.mjs tests/nonorientable-presets.test.mjs tests/audio.test.mjs
MORPHAZOID_QA_PORT=4196 npx playwright test e2e/nonorientable-surfaces.spec.mjs --workers=1
```

Use an available port and the intended checkout's preview; clear an unrelated
`MORPHAZOID_QA_BASE_URL` or `PLAYWRIGHT_BASE_URL` override before a managed run.
These tests establish mechanical behavior. Listening quality, audible click
acceptance and physical touch feel still require a human/device pass.
