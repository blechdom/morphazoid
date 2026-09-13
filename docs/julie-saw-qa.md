# Julie Saw — verification

Date: 2026-09-12. Branch: `codex/julie-saw`. Preview:
http://127.0.0.1:3436/julie-saw.html, served from the isolated
`morphazoid-julie-saw` worktree. No commit, push, or deployment was performed.

## Implemented slice

The instrument-development skill shaped two causal, simultaneous gestures:
the flex hand changes blade arch, tip curl, pitch, and the moving sweet spot;
the bow arm changes bow speed, direction, contact position, and pressure. The
responsive/audio skill drove explicit Audio/transport separation, continuous
drag and multitouch input, live-edit continuity, compact phone layouts, and
lifecycle checks. Perceptual QA remains automated characterization only.

The worklet specializes Morphazoid's previously unreachable Bowed Things modal
family as an eight-mode musical-saw bank. It models localized plate modes,
velocity-weakening bow friction, contact alignment, changing decay, scrape and
choke regions, impulses, long release, and worklet-owned gesture rhythms. This
is an expressive reduced-order physical model, not a finite-element simulation
or a measured replica of one specific blade.

## Automated evidence

- 14 focused Node tests passed, covering parameter bounds, continuous tuning and mode
  localization, preset recovery, seeded randomization, audio-thread gesture
  patterns, hidden-family integration, finite worklet output, release and
  impulse behavior, pitch agreement, contact-position sensitivity, deterministic
  reset, construction-independent damping, phase-aware transport joins, and a
  sustained 30-second render.
- 10 focused Chrome browser tests passed, covering recovery, explicit Audio/transport state,
  continuous two-hand gestures, manual exciters and actual worklet output,
  MIDI/computer keys and panic, the WAX MIDI guard and generated page, and desktop/phone
  layouts. Silent manual gestures, moving sweet-spot tracking, and transport
  phase joins are explicit regression cases.
- 6 shared strict audits passed, covering the route, control inventory, UI consistency,
  responsive reachability, WCAG A/AA accessibility, and the real-browser audio
  contract.
- `npm run verify` passed: 3,475 repository-wide Node tests passed, 6 were
  skipped, and none failed; syntax, SIMD-WASM, Shader Synth XYFlow, and WAX
  distribution checks also passed.
- Static WAX output contains 178 pages, was rebuilt from the authored source,
  and exactly passed the repository's clean-build parity verification.
- `git diff --check` passed.

## Signal characterization — not a listening approval

Deterministic stereo render, 48 kHz, representative presets and gestures. All
samples were finite and none clipped.

| Performance | Peak | Stereo RMS | Maximum adjacent-sample change | Stereo difference |
| --- | ---: | ---: | ---: | ---: |
| Julie's First Note | 0.0592 | 0.0278 | 0.00536 | 0.00002 |
| Low Fog | 0.0805 | 0.0285 | 0.00278 | 0.00010 |
| High Wire | 0.0155 | 0.0065 | 0.00487 | 0.00003 |
| Continuous Silver | 0.0993 | 0.0458 | 0.01067 | 0.00011 |
| Mode-Pair Mirage | 0.1005 | 0.0405 | 0.01374 | 0.00042 |
| Storm Window | 0.1239 | 0.0347 | 0.01308 | 0.00074 |
| Felt Mallets | 0.1533 | 0.0864 | 0.01970 | 0.00013 |

The Bow Lift Halo test remained above -80 dB for 12.53 seconds after release,
exercising the intended long, nearly sinusoidal ring. The browser audio contract
separately checks bounded, active output followed by silence. Numerical
differences and pitch agreement show control leverage and model consistency;
they do not establish musical usefulness, realism, or pleasantness.

Generated local listening artifacts (ignored by git):
`test-results/julie-saw-presets.wav` and
`test-results/julie-saw-characterization.json`.

## Human/device pass still needed

Start at low volume. Try a centered sustained bow, move the bow away from the
illuminated sweet spot, vary pressure against speed, bend through the range,
then compare delayed knee vibrato, tremolo, detaché, siren, mallets, pluck,
thimble and choke. Check whether the instrument reads as a flexed metal plate,
whether the scrape/choke boundaries feel recoverable, and whether the long ring
becomes tiring or piercing. Human listening, multitouch feel on physical
hardware, real MIDI hardware, speaker/output routing, microphone interaction,
and an actual WAX host have not been evaluated.
