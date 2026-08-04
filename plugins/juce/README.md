# Morphazoid Chaotic FM native core

This subtree is the dependency-light C++ path toward a Linux VST3. The DSP
core and its tests build now with only a C++17 compiler. An optional JUCE
adapter is included, but this repository does not download or vendor JUCE.

The current adapter deliberately opens JUCE's generic parameter editor. It is
a host-test scaffold, not the finished Morphazoid UI. A later
`WebBrowserComponent` editor can bundle the Chaotic FM HTML/CSS/JavaScript and
bind it to the same parameter IDs while all MIDI and audio stay in native C++.

## Build and test the standalone core

From the repository root:

```sh
cmake -S plugins/juce -B build/chaotic-fm-core \
  -DMORPHAZOID_BUILD_JUCE_PLUGIN=OFF \
  -DMORPHAZOID_BUILD_TESTS=ON
cmake --build build/chaotic-fm-core --parallel
ctest --test-dir build/chaotic-fm-core --output-on-failure
```

The test executable has no test-framework dependency. It covers:

- all five original preset tuples;
- deterministic short-window golden output and double-precision phase seeds;
- finite output under extreme recursive settings;
- sample-offset event dispatch and coherent stereo output;
- the exact v2 attack, decay, release, and semitone-glide curves;
- last-note priority, physically-held sustain fallback, velocity, expression,
  pitch bend, and channel-mode messages; and
- factory CC curves, including zero-capable attack, decay, and glide mappings.

## Build the JUCE VST3 adapter

Install or build JUCE separately, then point CMake at its package directory:

```sh
cmake -S plugins/juce -B build/chaotic-fm-vst3 \
  -DMORPHAZOID_BUILD_JUCE_PLUGIN=ON \
  -DMORPHAZOID_BUILD_TESTS=ON \
  -DCMAKE_PREFIX_PATH=/absolute/path/to/installed/JUCE
cmake --build build/chaotic-fm-vst3 --parallel
ctest --test-dir build/chaotic-fm-vst3 --output-on-failure
```

An unpacked source checkout works without installing JUCE:

```sh
cmake -S plugins/juce -B build/chaotic-fm-vst3 \
  -DMORPHAZOID_BUILD_JUCE_PLUGIN=ON \
  -DMORPHAZOID_JUCE_SOURCE_DIR=/absolute/path/to/JUCE
cmake --build build/chaotic-fm-vst3 --target MorphazoidChaoticFM_VST3 --parallel
```

On Linux, building WebView support also requires the WebKitGTK and GTK 3
development packages used by JUCE.

### JUCE 9 Linux validation

The actual VST3 adapter was compiled against the external JUCE 9.0.0 checkout
in this development environment with:

```sh
cmake -S plugins/juce -B /tmp/morphazoid-chaotic-fm-juce9-build \
  -DMORPHAZOID_BUILD_JUCE_PLUGIN=ON \
  -DMORPHAZOID_BUILD_TESTS=ON \
  -DMORPHAZOID_JUCE_SOURCE_DIR=/tmp/JUCE-9.0.0 \
  -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/morphazoid-chaotic-fm-juce9-build \
  --target MorphazoidChaoticFM_VST3 morphazoid_chaotic_fm_core_tests \
  --parallel 4
ctest --test-dir /tmp/morphazoid-chaotic-fm-juce9-build --output-on-failure
```

That produces the Linux bundle at:

```text
/tmp/morphazoid-chaotic-fm-juce9-build/MorphazoidChaoticFM_artefacts/Release/VST3/Morphazoid Chaotic FM.vst3
```

The generated binary is an x86-64 ELF VST3 with no unresolved dynamic-library
entries, and JUCE generated its VST 3.8 module manifest successfully.

### Install and smoke-test in REAPER on Linux

Copy the complete generated bundle—not only its `.so`—into the per-user VST3
directory, then restart REAPER or re-scan its VST paths:

```sh
mkdir -p "$HOME/.vst3"
cp -a \
  "build/chaotic-fm-vst3/MorphazoidChaoticFM_artefacts/Release/VST3/Morphazoid Chaotic FM.vst3" \
  "$HOME/.vst3/"
```

REAPER lists it as `VST3i: Morphazoid Chaotic FM (Morphazoid)`. The script
[`create-chaotic-fm-vst3-smoke.lua`](smoke/create-chaotic-fm-vst3-smoke.lua)
creates a 4.5-second project with five notes and fifteen CC/pitch events. Open
that script from REAPER's Actions window, save the generated project, and use
Render to File; the default output directory is
`/tmp/morphazoid-chaotic-fm-juce-v2`.

The host validation in this development environment used REAPER 7.62 and
produced a 48 kHz, 24-bit stereo render with -22.27 dBFS RMS, -12.73 dBFS peak,
and no NaN, infinity, or denormal samples. The equivalent JSFX render measured
-22.25 dBFS RMS and -12.73 dBFS peak; their active-frame mean spectral
centroids were 655.14 Hz and 654.37 Hz respectively. These close statistical
matches are the useful parity result even though chaotic trajectories are not
expected to null indefinitely.

The generated target is `MorphazoidChaoticFM_VST3`. Its JUCE adapter uses a
fixed 2,048-event scratch array, translates host MIDI offsets into trivial
`PerformanceEvent` values, and calls the allocation-free `ChaoticFmCore`.
Overflow triggers All Sound Off rather than allocating on the audio thread.

## Portable contract and parameter IDs

The source of truth is
[`chaotic-fm-parameters-v2.json`](../../contracts/chaotic-fm-parameters-v2.json)
and the behavior is specified in
[`chaotic-fm-performance-v2.md`](../../contracts/chaotic-fm-performance-v2.md).
The JUCE APVTS uses these stable IDs verbatim:

| Stable plugin/JSON ID | C++ `Parameters` member |
| --- | --- |
| `synthesis.depth` | `depth` |
| `synthesis.carrierHz` | `carrierHz` |
| `synthesis.offsetHz` | `offsetHz` |
| `synthesis.modulationAmount` | `modulationAmount` |
| `synthesis.amountDivisor` | `amountDivisor` |
| `synthesis.nonlinearityHz` | `nonlinearityHz` |
| `performance.playMode` | `playModeDrone` (`false` is MIDI) |
| `performance.rootMidiNote` | `rootMidiNote` |
| `performance.pitchBendRangeSemitones` | `pitchBendRangeSemitones` |
| `performance.ampAttackMs` | `ampAttackMs` |
| `performance.ampDecayMs` | `ampDecayMs` |
| `performance.ampSustainLevel` | `ampSustainLevel` |
| `performance.ampReleaseMs` | `ampReleaseMs` |
| `performance.glideTimeMs` | `glideTimeMs` |
| `performance.glideMode` | `glideMode` |
| `output.level` | `output` |

Play-mode choice ordering also matches the schema: `drone`, then `midi`, with
`midi` selected by default.

Factory performance MIDI is implemented inside the portable core:

- CC5: 0 ms at zero, then 10-2,000 ms geometrically;
- CC11: expression;
- CC64: sustain at the 64 threshold;
- CC65: temporary portamento enable/disable overlay;
- CC72: 2-10,000 ms release;
- CC73: zero, then 0.5-5,000 ms attack;
- CC75: zero, then 1-5,000 ms decay;
- CC120: clear state with a dedicated 2 ms safety fade;
- CC121: reset controller overlays without killing held notes; and
- CC123: clear notes using the normal release.

Host-owned MIDI Learn is still host state. A later internal mapping layer can
serialize portable learn assignments using the same stable parameter IDs; it
does not need to alter this voice core.

## Process-block API

`ChaoticFmCore::process()` accepts an already ordered fixed array of events:

```cpp
std::array<morphazoid::chaotic_fm::PerformanceEvent, 2> events{
    morphazoid::chaotic_fm::PerformanceEvent::noteOnAt(16, 60, 110),
    morphazoid::chaotic_fm::PerformanceEvent::pitchWheelAt(96, 10'240),
};

core.process(left, right, sampleCount, events.data(), events.size());
```

Events at a given offset are applied immediately before that output sample.
The host adapter owns sorting and capacity; the voice owns note priority,
envelope, glide, sustain, oscillator phases, and protection.

## Sound parity and the future UI

The native core keeps the browser/JSFX equations and constants: five exact
preset tuples, golden-ratio phase seeds, all recursive phases free-running,
double phase state, a +/-64 nonlinear input clamp, 20 kHz / 45%-sample-rate
frequency ceiling, parameter/depth smoothing, the 18 Hz protection high-pass,
and the 1.45-drive / 0.91 soft ceiling. Root note C4 at centered bend preserves
the original preset rates.

Short renders should match closely and the intended timbre should match. A
chaotic feedback system magnifies tiny differences between JavaScript and C++
`sin`/`tanh` implementations, compiler optimization, and output-filter
implementations, so indefinite sample identity is neither promised nor a
useful acceptance criterion. Tests instead freeze short windows, timing,
safety, and musical behavior; spectral-statistics tests can be added once the
browser v2 renderer is frozen.

For the finished UI, the audio callback should copy final stereo samples into
a lock-free analysis FIFO. A non-audio UI/analysis worker can calculate the
2,048-point FFT and publish roughly 30 frames per second to the WebView. The
browser Canvas and JUCE WebView can then render the same non-scrolling live
spectrum (20 Hz to Nyquist/20 kHz, -90 to 0 dB), while the native audio thread
never calls JavaScript or the WebView.
