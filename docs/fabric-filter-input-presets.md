# Fabric Filter: presets, live input and visual mapping

The canonical page source is `src/pages/moire-drone.html`; its public route
remains `moire-drone.html`. The preset menu uses the shared
Choose-style picker, Next and Random controls. All 62 authored patches retain
their original settings, expanded into complete snapshots. Random generates a
bounded patch across the musical controls, with the existing manual-motion
constraints. Neither operation changes master Output, Audio, source, input
device, channels, trim or capture connection.

## Filtering a microphone or audio interface

Turn **Audio** on, select **Mic / Audio In**, choose a device and mono/stereo,
then press **Connect input**. Input gain is a separate 0–4× trim before filtering.
The shared device preferences also honor the browser input-processing settings.
The browser requires a secure context (HTTPS or localhost) for capture.

Live audio passes through both warp/weft resonator families, the broadband/lattice
mix, ambience/drive, and Q/FFT sculpting. Left and right have independent filter
histories; mono is duplicated after the input bus. No noise, dust or impact sound
is added in input mode. Grabs and impacts still move the filters. The broadband
endpoint preserves the incoming channels before downstream processing.

Source selection and presets never request permission. Connect is explicit and
can be cancelled. Switching to Noise, turning Audio off, changing devices or
channels, hiding the page, and leaving the page release capture. A late permission
grant after cancellation is immediately stopped. Reconnection is explicit;
missing input stays silent. Source handovers fade briefly and clear audio tails
without resetting the held fabric or wave motion.

## How closely drawing and sound correspond

Both use the same `SpectralFabric` and `SpectralPropagationPool` model and mapping
functions. Displacement, velocity, activity, centroid, spread and opposing motion
affect frequency, bandwidth, depth, resonance and stereo. The canvas now applies
the same Wave Q depth gain curve to wave-driven comb warping as the audio engine.

The drawing still contains finer spatial detail. Its default grid samples about
2,050 interpolated points, while audio combines the sheet into at most 48
resonators, 16 sculpt anchors and aggregate measures. Grid density changes only
the drawing; Sections changes the simulated sheet. The 1,024-point FFT has 513
unique bins and a 256-sample hop: at 48 kHz this is about 46.9 Hz per bin and 187.5
mask updates per second. Fine visible differences can land in the same bin.

Audio modulation is temporally finer: it updates every 16 samples (3 kHz at
48 kHz), versus the canvas's usual 30/60 frames per second. However, the canvas
runs a separate model copy and caps long time steps, so it can diverge during UI
stalls. Its drawn Q response is an approximation rather than the actual biquad
transfer function. Sharing audio-state snapshots with the renderer and deriving
response curves from the real coefficients would close those remaining gaps.

## Verification scope

The completed implementation passed `npm run verify`: 5,293 tests passed, six
skipped, with syntax, SIMD, XYFlow and clean-build WAX parity. A final rebase onto
`origin/main` at `fddedc8` retained every verified runtime byte and adopted the
upstream equivalents of four page-location test repairs; all 62 affected tests
passed again. The WAX build follows main's 187 canonical pages. Historical
fixtures remain unchanged.

Focused engine tests cover disconnected silence, full-chain control sensitivity,
stereo preservation, finite/bounded output, source transitions, input trim and
device lifecycle. Preset tests cover exact authored expansion, complete-state
validation, bounded deterministic randomization and musical-field coverage.
Browser coverage exercises actual Web Audio input with a generated MediaStream,
permission cancellation, preset continuity and three responsive viewports.

On October 1, 2026, all 14 focused Chromium cases passed, including desktop
1440×900, phone portrait 390×844 and landscape 844×390. The stereo probe measured
0.1056 RMS at the open endpoint and 0.000000441 RMS after FFT low-pass rejection,
with no clipping or nonfinite samples. Default and dense/cascaded chaotic-noise
renders, including tug/release gestures, matched the previous engine sample for
sample. These comparisons cover the tested configurations rather than every
possible patch.

The shape selector applies to taps, Drop and Enter: Pebble creates one small
contact, Pebbles scatters 2–4 contacts, and Brick creates one broad, heavier
contact. Dragging always uses the same held-sheet physics. Impacts animate while
Audio is off without creating an AudioContext or requesting capture. In input
mode their effect is filtering only; they do not add a synthesized impact sound.
The Motion feel controls retain their labels and scales without a surrounding
box or explanatory paragraphs.

Automated audio measurements establish signal behavior; they do not establish
perceived timbre or physical controller feel. Human listening, a real microphone
and audio interface, and physical touch-device checks remain necessary.
