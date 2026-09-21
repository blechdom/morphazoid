# Shape and Hiccup Head: audition feedback follow-up

Status: local source changes on `codex/full-instrument-presets`, based on
`15980a90f298586a5df41865b8d1ba8da2d9d1bb`; not committed, pushed or deployed.
The earlier preset work in this worktree is preserved.

## Hiccup Head

- **Tin grin · Tongue virtuoso** and **Humming head · Sweet doo-wop** swap menu
  positions. Canonical snapshot hashes verify that all 19 existing full scenes
  retain their settings; this is an ordering change, not a bank overwrite.
- Six new complete scenes bring the main bank to **25**. Each combines face,
  voice bank, rhythm, tempo, effects and built-in skin.
- Their scores also appear in the independent sequence selector, which now has
  **25** choices. Body/face, sound-bank, voice and skin controls stay in place.

| New main scene | Local sequence | BPM | Voice bank | Effects / skin |
| --- | --- | ---: | --- | --- |
| Rubber face · Pocket backbeat | Pocket backbeat | 104 | Natural mouth | Dry / checker |
| Sloppy oracle · Rubber offbeats | Rubber offbeats | 126 | Wet rubber | Plate / food portrait |
| Tin grin · Tongue breaks | Tongue breaks | 164 | Tongue workshop | Dry / ASCII |
| Humming mask · Half-time huff | Half-time huff | 82 | Air pockets | Plate / photograph |
| Chipmunk box · FWEE answer | FWEE call and answer | 118 | Tiny cartoon | Echo / collage |
| Open throat · Three-two mouth | Three-two mouth | 136 | Natural mouth | Dry / checker |

These are explicitly authored two-bar scores with rests, accents, quieter
intervening hits and second-bar variations, repeated across the existing
64-step bank. Each step holds at most one sound; none relies on simultaneous
voices that the monophonic instrument would discard. The existing sequencer,
tract, gesture, effect and voice algorithms are unchanged. Musical usefulness
still needs listening.

## Shape: geometry and motion

- **Velvet wheel** uses the original square geometry: four straight sides,
  zero curvature, zero aspect stretch and zero skew. Three stationary rays
  remain; the square now rotates counterclockwise.
- Removed **Circle · Sweet orbit** (`soft-orbit`) only. Circle geometry and
  distinct multi-reader circle scenes remain available.
- **Open line · Bowed pendulum** now uses three unevenly spaced readers and
  ping-pong rotation. Added **Bowed line · Reverse reel** and
  **Bowed line · Four-way rocker** for opposing readers / continuous reverse
  rotation and four-reader / ping-pong motion respectively.
- The bank now has **37** full scenes, **29** nonuniform head layouts and
  **26** rotating scenes: eight clockwise, eight counterclockwise, ten
  ping-pong. Menu order stays deliberately mixed but stable.
- Playhead/Rotate recall remains independent of Audio. Presets do not arm
  Audio, rewind live phase, request permissions or change MIDI.

## Shape: click investigation and scoped mitigation

**Hypothesis, not a confirmed browser root cause:** all six reported scenes use
the corner-percussion strike path. Its exponential rise from a near-zero gain
floor concentrates much of the amplitude change near the end of the attack.
Added attack noise and very dense corner crossings are other plausible
contributors. Corner storm's previous settings imply roughly 1,984 trace-corner
crossings per second before event/headroom limits; this is a geometry estimate,
not a measured browser event rate.

`VoicePool.strike` now accepts an opt-in `attackCurve: "smooth"`. Only Shape's
corner-percussion caller enables it. Twenty-four linear automation segments
approximate a raised-cosine onset. Other callers retain the original exponential
automation. With the same envelope data, the attack endpoint, subsequent stages,
release, frequency and output limits are unchanged. Shape preset envelope data
is deliberately retuned separately:

| Reported scene | Attack | Attack noise | Other change |
| --- | ---: | ---: | --- |
| Uneven drum wheel | 14 ms | 0 | Counterclockwise rotation |
| Clustered marimba | 10 ms | 0 | Retains clustered four-reader rhythm |
| Orbiting knuckles | 14 ms | 0.025 | Slower ping-pong rotation |
| Square · Low corner kit | 12 ms | 0 | Slower corner traversal |
| Insect clock | 9 ms | 0.03 | Nine-point star, five uneven rays, slower reverse rotation |
| Corner storm | 8 ms | 0.025 | Four readers, slower traversal and ping-pong rotation |

Star · Percussion sprint and Stuttering pentagon also have reduced attack
noise and rounded short envelopes. Shape percussion is intentionally changed
by this feedback pass; this is not a claim of identical sound. No new filter,
oscillator, limiter, sample or worklet replaces the instrument.

### Evidence

- **181 passed, six skipped, zero failures** across 16 direct Node suites.
  Coverage includes full recall, motion/Audio separation, existing audio
  contracts, Hiccup face/transport behavior, preset hierarchy, geometry,
  playheads, mapping, synthesis and MIDI.
- The new percussion tests run the real `VoicePool.strike` scheduling code
  against a recording AudioParam facade, then sample its gain/noise automation
  deterministically: six scenes × three sample rates (44.1/48/96 kHz) × four
  pitches (55/110/440/880 Hz) = **72 before/after comparisons**.
- Normalized maximum attack-envelope slope falls below half the earlier value
  in every reference case, rather than merely passing by reducing master gain.
  Finite output, bounded isolated peaks and final silence pass. Existing
  exponential scheduling, peak reservation and retrigger release are tested.
- Example only: at 48 kHz / 110 Hz / strike gain 0.5, Uneven drum wheel's
  reference maximum adjacent-sample difference falls from about 0.117 to 0.0072.
  This is **not** a rendered browser/compressor output or a device recording,
  and it does not prove that the reported clicks are resolved.
- Compared with the pre-feedback snapshots, Shape's `strikeCorner` is its only
  changed existing named app function (170 unchanged); all 33 named Hiccup
  model functions are unchanged. Original Hiccup full-scene settings are
  hash-checked independently of their new order.

Local artifacts: `test-results/preset-audition-followup/`, including source
snapshots, before/after metrics, preservation checks and direct-test logs.
Tracked tests/fixtures keep the focused checks reproducible without those logs.

## Remaining acceptance

Browser/build execution remains pending after the earlier approval-service
failures. No indirect workaround was used. The updated Playwright cases have
not run; the full repository gate and regenerated WAX/production artifacts
remain pending. `dist-wax/` was not hand-edited for this follow-up.

For the next listening pass:

1. With Audio explicitly on, revisit the six reported Shape scenes at a
   comfortable output level. Compare steady playing and a live preset switch;
   distinguish intended percussion attacks from extraneous clicks.
2. Check the original square in Velvet wheel, both new Bowed line variants,
   counterclockwise travel and ping-pong reversals. Listen through a reversal.
3. In Hiccup Head, confirm the requested swap and audition each new beat for at
   least its two contrasting bars. Change the local sequence while preserving
   face/effects, then recall the main scene to restore everything.
4. Recheck desktop, phone portrait and phone landscape header reachability and
   local sequence dragging. Earlier Creaturazoid drag and Hiccup portrait
   navigation failures have not yet received a successful browser rerun.

If clicks remain, capture repeated steady-state, transition-only and intended
attack windows in the real browser before making broader DSP changes.
