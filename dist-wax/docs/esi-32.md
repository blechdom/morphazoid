# ESI-32 Sampler

[Open the instrument](../esi-32.html).

Enable **Audio**, select a sample slot, and hold the on-screen or labelled
computer keys. Both keyboard rows play chromatically; octave buttons move the
range. **Audition** plays the selected sound, and **Silence** releases
the instrument. MIDI input is enabled in Settings. Note velocity, sustain
(CC64), pitch bend, cutoff (CC74), resonance (CC71), attack (CC73), release
(CC72), output (CC7), and all-notes-off messages are supported.

**Load sample** replaces the selected slot with a browser-decodable local audio
file. Eight original synthesized samples make the instrument playable without
downloads. Files remain on the device; the instrument does not upload audio.
Use **Save bank** before leaving or reloading the page to keep imported samples
and settings.

To record a microphone or audio interface, enable **Audio**, then click the
violet input toggle beside the input gain and meter. Allow microphone access
and choose **Audio input device** if you use an external interface. The input
meter follows the input gain; capture does not feed live input to the speakers.
Click **Record**, then **Stop**. The captured sound replaces
the slot selected when recording began and appears in the waveform editor.
Play the keys to hear it, then trim, loop, filter, export or save the bank as usual.
Recording stops at 60 seconds. Audio off, disconnecting input, or hiding the page
stops capture and keeps the recorded portion. Permission or startup failures
leave the existing sample intact. Input and recordings stay on your device.

The separate red **Record** button in Morphazoid's masthead records the sampler's
stereo output as WAV. It is independent of microphone-to-sample capture.

Drag the waveform markers or use the labelled trim and loop controls. Focus
the waveform and use arrows to move the start, or Shift + arrows to move the
end. Trim chooses the playable region; Loop repeats its interior region;
Reverse plays that region backwards. Root note identifies the sample's recorded
pitch. Tune and Fine shift playback rate, so transposition also changes duration.

The amplitude envelope controls attack, decay, sustain and release. Cutoff and
resonance shape a lowpass filter; Filter envelope sweeps its cutoff, and the
Pitch LFO adds vibrato. Pan and Level place and balance the selected slot.
Cutoff, resonance, pan, level and LFO edits update held notes. Trim, reverse,
coarse/fine tuning and envelope edits take effect on the next attack. MIDI
macros 1–8 map to cutoff, resonance, transpose, attack, release, pan, LFO depth
and sample level, respectively.
The preset menu, next-preset button, dice and Reset provide recoverable
starting points. Presets change sound settings and keep imported samples.

**Export WAV** writes the selected trim and reverse as mono/stereo 16-bit
PCM at the decoded sample rate. It exports the source sample, without filter,
envelope, tuning, LFO or output processing. **Save bank** embeds all eight full
samples as 16-bit WAV alongside the sound settings, names, selected slot and
keyboard octave. Trim and reverse remain editable after reopening. Converting
floating-point audio to PCM16 quantizes it; values beyond full scale are clipped.

Sample files are limited to 32 MiB before decoding, 60 seconds, and one or two
channels. Decoded audio uses the browser's sample rate. Bank files are limited
to 48 MiB of UTF-8 JSON and 32 MiB of embedded PCM WAV, including headers. A
large playable collection can exceed the portable bank budget. Bank imports
validate every slot and sample before replacing the current collection.

## Source and limits

This is a browser instrument inspired by the original E-mu ESI-32, using its
sample-editing and dynamic-processing concepts. The reference is the
[manufacturer's operation manual](https://www.deepsonic.ch/deep/docs_manuals/e-mu_esi32_manual.pdf),
especially printed pages 121–123 and 181–197. The hardware's three AHDSR
envelopes and proprietary filter/channel architecture are broader than this
implementation.

The browser engine has a 32-channel budget; stereo playback consumes two.
It uses resampled PCM playback, an ADSR amplitude envelope, a filter envelope,
pitch LFO and two cascaded Web Audio lowpass sections for an approximate
24 dB/octave response. It does not reproduce E-mu chips, firmware, conversion
or interpolation artifacts, the original AHDSR hold stages, multitimbral MIDI
parts, layered keyzones, or ESI/EIII/Akai disk-bank formats. Its JSON banks are
specific to Morphazoid. It is not an official E-mu product or a bit-accurate
hardware emulator.

The eight demo samples are generated from original synthesis in
`esi-32-model.js`: Glass tine, Velvet strings, Vowel cloud, Copper bass,
Satellite bell, Dust drum, Air corridor and Circuit keys. No E-mu ROMs,
commercial factory recordings or third-party sample library is included.
The visual panel and controls are authored for Morphazoid.

Non-looping cuts receive a short, cached fade at each boundary to reduce trim
clicks. Loop seams remain un-crossfaded; adjust endpoints to similar waveform
values when a seamless sustain is wanted. The displayed cursor approximates
sample position under pitch LFO and smoothed pitch bend.

### Catalogue icon

The catalogue and Choose menu use a simple mint emu silhouette generated with
the built-in image-generation tool, saved as `assets/instruments/esi-32.webp`
at 512 × 512 pixels. Its broad shapes and single eye cutout keep it legible at
small icon sizes.

<details>
<summary>Image-generation prompt</summary>

Redesign this emu bird icon as an extremely simple flat logo for a music app. Keep only a recognizable emu head in side profile, facing right, with a long gently curved neck and two small crown tufts. Draw a single bold solid mint-teal silhouette (#67e8cf) on a completely uniform near-black square background (#080e10). One tiny circular eye cutout; no other internal detail. Use a short broad beak and clean smooth curves. Center the mark with generous margin, so it reads instantly at 24 pixels. Strictly two flat colors. No feather texture, shading, gradients, rim lighting, realism, outlines, extra objects, circle border, lettering or text. This should feel like a restrained vector brand mark, not an illustration.

</details>
