# Processor samples and presets

Candy Coil Delay, Sandy Syrup Delay and Slippery Resynthesis start with Samples
selected and Audio off. Turn on Audio, then **Play sample**. The sample menu and
its next arrow start with two real acapella stems, two extended-technique sax
recordings and a tabla rhythm, then browse the other bundled inputs.
**Loop** switches between repeat and one-shot playback;
**Stop** releases the input while the effect can finish its tail. Source credits
appear below the player after loading. Samples use the same bounded decoder and
assets as L-system Delay and Fractal Delay. The four new short recordings total
about 1 MB; the tabla reuses an existing asset. Their
[licenses, performers and excerpt credits](../assets/input-samples/expressive/CREDITS.md)
travel with the files. CC BY recordings require credits when sharing a video.

The input strip also offers **Mic** and **File**. Switching modes releases the
previous source. Selecting Mic never requests permission until its input button
is pressed. Local files keep their existing upload, loop and input button. No
input or preset action arms output Audio. Files remain local to the browser.

The first control row offers full presets, Next and dice. It preserves all
twelve authored Candy scenes, twelve Sandy scenes and fourteen Slippery scenes.
Recall and bounded full-state randomization keep source selection, sample/file
playback, loop policy, input gain, output gain and Audio unchanged. They update
the existing effect graph without reloading the sample or resetting its clock.
Candy's reciprocal speed/range lock and Slippery's spectral Hold are musical
settings and participate in full recall and dice. Random states are marked
Custom. Reset restores musical parameters while retaining input/output trims.

Implementation is owned by each instrument's `full-presets.js` and app adapter.
`src/processor-sample-player.js` supplies the common recorded-input UI using
`createInputSource`; the existing engines still own their synthesis, parameter
smoothing and output gate. The player has one live buffer source, cancellable
loading and page-exit cleanup. Samples do not request a microphone.

Automated acceptance lives in `tests/processor-full-presets.test.mjs` and
`e2e/processor-samples-presets.spec.mjs`: complete factory recall, seeded bounded
dice with no frozen musical fields, explicit Audio, finite non-silent unclipped
default output, unchanged buffer playback across every preset and dice, sample
changes, loop/stop, file replacement, explicit microphone requests, resource
cleanup, mono-microphone to stereo-sample transitions and controls at
1440×900, 390×844 and 844×390. Existing engine/input tests
remain applicable. These checks do not establish human listening or physical
microphone/touch acceptance.
