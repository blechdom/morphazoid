# Morphazoid plugin architecture

## Decision

The cross-DAW product path is a native C++ DSP core hosted by JUCE, initially
shipping VST3 for Linux/REAPER. The plugin editor may embed the reusable
Chaotic FM HTML/CSS/Canvas interface in a JUCE WebView. The browser instrument
and REAPER JSFX remain supported reference targets rather than runtime
dependencies of the native plugin.

This gives each platform the integration it is good at:

- browser: Web MIDI, AudioWorklet, Web Audio analysis, and the public demo;
- JSFX: zero-build REAPER prototyping and host-level conformance tests;
- JUCE: native host MIDI, sample-offset scheduling, automation, state, offline
  rendering, and cross-DAW distribution;
- shared web UI: visual design, controls, ADSR editor, scope, and spectrum;
- shared contracts: presets, parameter IDs, MIDI mappings, voice rules, and
  analysis semantics.

The WebView is an editor. It never runs DSP or communicates with the audio
thread directly. Native DSP writes decimated analysis data to a lock-free
queue; the editor/message thread forwards it to the UI at display rate.

## Sound parity

The core oscillator algorithm is straightforward to port: double-precision
phase accumulators, sine and tanh operations, bounded recursive amounts,
sample-rate frequency clamps, and explicit parameter smoothing. Native and
browser versions should therefore preserve the same presets and perceptual
behavior.

Chaotic trajectories are sensitive to very small floating-point differences,
so indefinite sample-for-sample identity is not a useful release criterion.
Conformance instead checks:

- identical initial values and short deterministic render windows;
- note, envelope, glide, velocity, bend, sustain, and panic timing;
- finite output and frequency/recursive-amount safety bounds;
- RMS, peak, spectral centroid, and energy in agreed frequency bands;
- matched output protection before subjective A/B review.

The current browser uses a Web Audio compressor in addition to its high-pass
and soft ceiling, while the JSFX does not. That output-stage difference must be
resolved explicitly before final cross-platform preset tuning.

## Why not browser-wrapped DSP

WAX is useful on its supported macOS and Windows targets, but it does not
provide the native Linux route required by this project. A browser-DSP wrapper
would also make host timing, offline rendering, automation, and deployment
depend on an embedded browser audio runtime. Reusing the browser presentation
through a WebView retains the visual benefit without putting that runtime on
the audio thread.

## Licensing boundary

The portable DSP core is dependency-light and remains part of Morphazoid's MIT
source. JUCE itself is separately dual-licensed under AGPLv3 and the JUCE
licence. Before distributing a binary linked with JUCE, the project must choose
and comply with one of those JUCE licensing routes; this architecture note is
not legal advice.

References:

- <https://juce.com/blog/juce-8-feature-overview-webview-uis/>
- <https://juce.com/get-juce/>
- <https://audiofusion.com/wax/>
