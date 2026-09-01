# Hiccup Head reverb impulses

Hiccup Head uses two derived stereo impulse responses for its eye-controlled
convolution reverb.

## EMT-140 warm plate

- File: `hiccup-head-emt140-warm-plate.wav`
- Source: Greg Hopkins, *EMT-140 Plate Reverb Impulse Response*, distributed by
  the [Oramics Sampled collection](https://oramics.github.io/sampled/IR/EMT140-Plate/)
- Source recording: `emt_140_dark_3.wav`
- License stated by the collection: Creative Commons Attribution-Any
- Modification: retained the first 2.6 seconds, narrowed the extreme stereo
  side component by 48%, added a 250 ms tail fade, then held the initial field
  at 40% through 5 ms and smoothly restored it by 120 ms so the dense plate
  tail leads over the early-room signature. Converted to 48 kHz / 16-bit PCM.

## York Minster warm hall

- File: `hiccup-head-york-minster-warm-hall.wav`
- Source: [OpenAIR](https://www.openair.hosted.york.ac.uk/), Audiolab,
  University of York
- Dataset: York Minster
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- Intermediate distribution and attribution:
  [DatanoiseTV/doobie](https://github.com/DatanoiseTV/doobie/tree/main/external/openair-irs)
- Modification: removed the first 85 ms containing the silent lead and direct
  arrival, retained the following 4.4-second diffuse late field, added a 25 ms
  entrance fade and 300 ms tail fade, narrowed the stereo side component by
  40%, then held the initial field at 40% through 12 ms and smoothly restored
  it by 170 ms so the Minster tail leads over the early-room signature.
  Converted to 48 kHz / 16-bit PCM.
