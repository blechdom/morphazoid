# SPARTIAL

**SPARTIAL** is a surround additive and granular synthesizer built on Surround for Safety's output layouts. It starts with sixteen stationary partials and supports up to thirty-two per note. Hold sustains the selected single note or chord; a chromatic keyboard and MIDI supply independent note gates. Instrument presets and eight harmonic fingerprints have Next and parameter dice controls. Frequency spacing compresses or expands the harmonic series, while seeded inharmonicity offsets upper partials; held frequencies glide and ultrasonic partials fade out. Spatial turns distribute the whole bank once around the speakers at 1, squeeze it into an arc below 1, or wrap it repeatedly above 1. Across speakers offers rotation by dragging; One speaker replaces the colored partial field with one highlighted destination selected by click or drag. Optional clockwise, counterclockwise, and opposite-direction motion follows BPM and beats per turn while rotation Play is active; motion starts off. Rotation Play/Pause never starts or releases a note. Starting rotation from Off selects clockwise movement. Hold and Silence control notes independently. The Shape-style panel places presets, note/chord selection and chromatic keys above the labelled Rotation Play/Pause and tempo knob on the right. The knob keeps its 30–240 BPM range, keyboard adjustment and Tap control. On mobile, the graphic stays fixed while the fingerprint and parameter controls share one scroll pane; landscape places that pane beside the graphic. The current master knob, next-instrument link, square Audio button and MIDI-in-Settings presentation preserve the existing native controls. Cascade delay and initial wait use exact millisecond entry with 1 ms steps. An accelerating/slowing curve and seeded variation reshape the gaps while preserving total span; the timing strip previews scheduled entrances, including silent partial slots. Restart cascade briefly fades only the held note or chord before replaying it with the new timing, leaving other notes and transport intact. An eight-voice sample-clock engine renders the numbered discrete patch when it fits, with a labeled left/right stereo fallback and LFE omitted by default. Artwork is generated from the instrument's canvas. Routing follows the [Web Audio channel contracts](https://www.w3.org/TR/webaudio-1.0/); physical channel assignments and spatial feel still need a hardware listening pass.


## Chords and clusters

Choose **Chord** under Sound, then a **Chord / cluster**. The menu includes major,
minor, suspended and seventh chords, augmented and diminished triads, fully and
half diminished sevenths, sixths, close add-nine voicings, stacked fourths,
whole-tone groups of three, four or six notes, and chromatic clusters of three
or four adjacent notes. Every voicing fits within one octave above the root;
the readout shows its actual notes. The keyboard transposes this shape from
each pressed key. MIDI continues to play the exact incoming notes.

**Next** cycles through the menu and wraps. **Dice** makes a fresh random group
of three or four distinct notes, including the root. Select **Random 3 notes**
or **Random 4 notes** to keep that size on subsequent rolls. The result stays
fixed when replayed, transposed, or edited elsewhere; only another selection or
roll generates a new group. Hold auditions chord changes immediately. Existing
keyboard and MIDI notes keep their pitches until released. The shared pool has
eight voices, so overlapping chords can steal older notes at that limit.

Chords enter the live granular buffer as part of the additive sound. A loaded
audio file still uses one transposition from the latest note; it does not create
a separate grain cloud for every chord tone.

## Partial modulation

**Pitch movement** adds vibrato in cents; **Amplitude movement** adds tremolo by
attenuating each partial. Both start at zero. Set a shared rate in hertz and a
sine or triangle wave. **Ripple across partials** offsets the modulation phase
through the bank: zero moves every partial together, positive values travel
from low to high, and negative values reverse that direction. One turn spans
one modulation cycle across the bank. The colored monitor follows the engine's
partial modulation. These movements run independently of Rotation Play/Pause.

## One fingerprint bank, three mappings

The **Mapping** menu in Harmonic fingerprint changes what its single slider bank
controls. **Custom partials** starts selected and retains the original individual
partial levels. **Tonewheel** maps the bank to nine sine drawbars; **Pipe organ**
maps it to nine voiced stops. The same preset menu, Next and dice follow the
selected mapping. Switching back to Custom partials restores its remembered
painting; organ mappings use neutral partial gains, with no hidden partial trims.

In either organ mapping, the sliders run from 0 (off) to 8, with footages **16′,
5⅓′, 8′, 4′, 2⅔′, 2′, 1⅗′, 1⅓′, 1′**. The 8′ stop follows the played note; 16′
sounds an octave below it. All stops off silences the sustained organ tone.
Frequency spacing and inharmonicity remain available beneath the bank; partial
count and rolloff apply to Custom partials.

Pipe voices include **Flute**, **Stopped flute**, **Principal**, **String pipe**
and **Reed**. Their controls appear beneath the same bank. Brightness changes
their harmonic balance; Pipe chiff adds an optional breath-like attack.
**Click, chiff & percussion** is available beneath the bank in every mapping.
It contains the chiff amount, a short key transient and decaying second- or
third-harmonic percussion with its own level and decay. Chiff, click and
percussion start off. Registration presets, Next
and dice offer additional starting points while preserving master Volume.

The stops share the existing 32-partial bank, so high stops have fewer available
overtones. These are original additive approximations inspired by organ
construction and the Sormena Project tutorial's public description. They do
not reproduce a sampled pipe, tonewheel mechanism or vintage drawbar gain law.
See the [research sources and model limits](spartial-organ-research.md), including
the distinction between the accessible video description and its unavailable
transcript.

## Rotary and drive

**Rotary** starts Off. Slow and Fast glide between speeds; Brake lets the motion
coast to a stop. Separate bass-drum and treble-horn movement processes both
additive and granular layers. Mix, spread and transition time control its
presence, width and acceleration. **One speaker** still gathers the result into
the selected output. Rotary motion is independent of the main Rotation control.

**Drive** adds saturation and starts at zero. It works with Rotary off and colors
both additive and granular sound. Each speaker channel uses its recent signal
level to set the saturation range, so quiet distributed partials respond too.
Turning Drive up adds progressively stronger harmonics while preserving partial
levels and the master Volume setting; zero restores the dry sound.
The rotary and drive models are
compact effects inspired by Leslie features, not a cabinet or valve-circuit
emulation; physical surround placement and subjective tone still need listening
on the intended system. Partial modulation, Rotary & drive, and Click, chiff &
percussion start collapsed. The mobile graphic remains fixed above or beside
the scrolling controls.

## Granular layer and mixer

The Layer mix crossfader runs from additive only to granular only. It uses a
smoothed linear blend because the two layers can be correlated; master Volume
stays independent and is preserved by instrument and texture presets and dice.
The initial mix is additive only, retaining the original sound.

**Live additive sound** records the synthesizer into a four-second mono buffer,
before speaker routing, master volume, and layer mixing. Play a note or use Hold,
then raise Granular. The synth still feeds this buffer at 100% granular and when
the master is turned down. Short notes and their additive release continue to
feed delayed grains after key-up, until the selected look-back/scatter window
has passed the recorded sound; existing grains then finish their own windows.
This also works after the running buffer has filled with silence. **Freeze buffer** stops replacing the captured sound;
grains can continue after releasing notes. **Unfreeze** resumes live capture.
**Silence** stops both layers, including a frozen cloud, until another note starts.
Audio remains the separate output arm/mute; Rotation Play/Pause only controls
speaker motion.

**Load audio file** decodes locally without turning Audio on. Files are limited to
20 MB; only the first 20 seconds are retained. Channels are averaged to mono, then
each grain is independently placed in the surround array. C4 uses the file's
original pitch; the latest played note supplies one transposition for the grain
cloud. File playback is gated by notes/Hold rather than starting automatically. File
grains fade with their Grain size; Additive fade in and Additive release shape
the synth source only.
Files are already fixed sources, so Freeze is disabled for that source. Changing
to the live source or choosing an instrument preset retains the loaded file;
Clear file removes it. Decode failures keep the previous source available.

| Control | Meaning |
| --- | --- |
| Grain size, 5–500 ms | Duration of each windowed piece of sound. |
| Density, 1–80 grains/s | Average number of new grains per second, independent of rotation tempo. |
| Pitch, −24–24 semitones | Grain read speed/transposition, without changing its duration. |
| Grain speaker order | Sequential, reverse, alternating sides, or seeded scattered destinations. |
| Spread around speakers | Full ring at 100%; a smaller arc toward the starting angle as it decreases. |
| Look-back, 0–3,000 ms | Gap between the newest captured sound and the nearest edge of each grain. |
| Position in file | Center point of grains in the file, replacing Look-back. |
| Source scatter, 0–1,000 ms | Variation around that source starting point. |
| Timing jitter | Variation in gaps between grain starts. |
| Reverse grains | Chance of reading a grain backwards. |

Look-back is clamped to available safe history. Long, slow or reversed grains
reserve enough room in the four-second live buffer to finish before capture
overwrites their source, including when a frozen buffer resumes recording.

Each grain currently has a fixed, symmetric Hann window: a smooth fade from
zero to its peak and back to zero across Grain size. There are no separate
editable grain Attack/Release controls or a cloud ADSR yet. Additive fade in
and release shape the live source before granulation; they do not change an
individual grain's window. Stereo preview folds every active speaker into
left/right, so granular sound does not require a multichannel device.

Five local texture presets, Next and dice change granular parameters without
changing notes, source, frozen capture, master Volume, or the layer mix. Four
complete instrument presets combine spectra with granular clouds, rain, reversed
tides and shimmer. Main dice includes granular parameters; unavailable files and
empty live buffers are not chosen as frozen sources. Amber dots on the speaker
ring follow active grains reported by the audio engine. One speaker gathers
both layers; rotating and dragging the shared ring move both layers. Grain order
and spread remain independently editable.

The audio worklet owns grain scheduling and rotation, with a fixed pool of
64 grains, Hann windows, interpolated source reads, smooth routing, and bounded
output. A shared soft upper knee also bounds coherent grain bursts when surround
is folded into stereo. File samples transfer directly to the worklet after
main-thread decoding and sanitizing, avoiding a large copy on the audio thread. No microphone, external upload, crusher-X code, sample library, or plugin
host is introduced. Granular synthesis here is an original implementation,
not an emulation of crusher-X.

## What translates from crusher-X

accSone documents per-grain spatial control, speaker snapping and multichannel
wet/dry mixing in [crusher-X 12's feature overview](https://accsone.com/crusherx/whatsnewincrusherx12).
Its [official reference manual](https://accsone.com/images/accsone/download/crusher-X%20User%20Manual.pdf)
distinguishes grain length, birth interval, source-buffer delay, generation offset,
live/fixed buffers, freeze, speed/reverse, and parameter morphing.

For SPARTIAL, the useful translations are independent grain destinations, a clear
layer mixer, a freezeable source, and explicit timing units. The interface keeps
common controls in Granular and moves source/timing variation into Timing &
texture. It reuses the existing speaker ring rather than introducing a separate
3D path editor. This is a design recommendation, not a claim that crusher-X's UI
is objectively poor. Larger modulation matrices, grain-specific effects,
feedback networks and timed preset morphing remain possible later extensions.

## Volume handling and validation boundary

A reproduced touch-browser defect let the native range underneath the shared
Volume knob handle a tap as an absolute slider position: a tap at its left edge
could change 65% to zero. The shared knob now cancels that native touch gesture
and retains relative vertical dragging. Intentional zero, native keyboard edits
and MIDI CC7 remain supported. This is one confirmed cause; an unobserved report
of silence may have a different cause.

Automated rendering and browser checks can establish bounded signals, gates,
control response, routing and continuity. They do not establish subjective
timbre, physical surround channel order, or touch/controller feel. Those need a
listening/device pass.

## LFE routing

The eight-channel **7.1** layout uses L/R/C/LFE at channels 1–4, LS/RS (sides)
at 5–6 and LRS/RRS (rears) at 7–8, with no height speakers. SPARTIAL's 7:4:1
patch retains the same bed order and adds four height channels at 9–12.

Speaker setup includes **Omit LFE channel**, on by default. For 7.1 and 7:4:1
it leaves channel 4 silent; for 4:1 it leaves channel 5 silent. Other physical output
numbers stay unchanged. Uncheck it to include LFE as a destination for both
partials and grains, including One speaker and the stereo preview/recording
mix. This is ordinary source routing, without a bass-management or subwoofer
filter. The option is disabled for layouts without LFE. Presets and dice
preserve this output setting, and toggling it retains the selected physical
speaker when that speaker remains available.

## Multitrack recording

Turn Audio on, then use **Record multitrack** above the instrument preset menu.
Stop opens the export window. The same take supports both:

- **Save tracks to folder** in browsers with folder access, or **Download tracks
  ZIP** everywhere recording is supported. The ZIP contains a named take folder
  with one numbered, labelled mono WAV per physical output and `channel-map.txt`.
- **Download multichannel WAV** for a single file with all output channels in
  numbered patch order. Import it as discrete channels in your DAW.

All files use 24-bit PCM at the instrument's audio sample rate. Every channel
starts on the same sample and has exactly the same length. Both additive and
granular layers are captured after their mixer and Volume control, before
stereo monitoring. Headphones still record the complete selected speaker layout.
Omitted LFE remains a silent numbered channel; the other tracks never shift.
The 7.1 and 7:4:1 patches keep LS/RS at 5–6 and LRS/RRS at 7–8.

The speaker layout and Omit LFE controls are fixed during a take; notes, presets,
rotation, layer mix and volume remain playable. The separate masthead Record
button continues to capture the stereo monitoring mix.

The available time appears beside the multitrack control. Capture uses a bounded
128 MiB buffer: at 48 kHz, approximately 3:53 for four channels, 1:56 for eight,
1:17 for twelve, or 0:58 for sixteen. At the limit, capture stops and preserves
the take for export. Audio off or an interrupted audio context also finalizes
the captured portion. Save cancellation or failure keeps the original take;
**Discard take** frees it for a new recording. Export before closing the page.

The multichannel WAV uses WAVEFORMATEXTENSIBLE with an unspecified speaker mask
because SPARTIAL supports custom patches. Its channel order is the numbered
speaker patch, not a DAW's automatic surround order; the separate-track export
includes the exact map. Recording controls are browser-only and hidden in the
WAX artifact, where the DAW owns recording.
