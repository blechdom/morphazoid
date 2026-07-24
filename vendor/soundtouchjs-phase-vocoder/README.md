# SoundTouchJS Phase Vocoder AudioWorklet

These browser files are copied from
`@soundtouchjs/phase-vocoder-worklet` 2.1.0:

- `PhaseVocoderNode.js`
- `constants.js`
- `phase-vocoder-processor.js`

The processor is a self-contained bundle of SoundTouchJS's FFT phase-vocoder
stretch stage and its AudioWorklet integration. It uses a 2048-sample FFT with
4× overlap by default. It is a meaningfully different time-stretch algorithm
from SoundTouchJS's default WSOLA worklet.

The files are licensed under MPL-2.0; see `LICENSE`.

Upstream release: <https://github.com/cutterbl/SoundTouchJS/tree/v2.1.0/packages/phase-vocoder-worklet>
