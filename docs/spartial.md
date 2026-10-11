# SPARTIAL

**SPARTIAL** is a surround additive and granular synthesizer built on Surround for Safety's output layouts. It starts with sixteen stationary partials and supports up to thirty-two per note. Hold sustains the selected single note or chord; a chromatic keyboard and MIDI supply independent note gates. Sixteen instrument presets and eight harmonic fingerprints have Next and parameter dice controls. Frequency spacing compresses or expands the harmonic series, while seeded inharmonicity offsets upper partials; held frequencies glide and ultrasonic partials fade out. Spatial turns distribute the whole bank once around the speakers at 1, squeeze it into an arc below 1, or wrap it repeatedly above 1. Across speakers offers rotation by dragging; One speaker replaces the colored partial field with one highlighted destination selected by click or drag. Optional clockwise, counterclockwise, and opposite-direction motion follows BPM and beats per turn while rotation Play is active; motion starts off. Rotation Play/Pause never starts or releases a note. Starting rotation from Off selects clockwise movement. Hold and Silence control notes independently. The Shape-style panel places presets, note/chord selection and chromatic keys above the labelled Rotation Play/Pause and tempo knob on the right. The knob keeps its 30–240 BPM range, keyboard adjustment and Tap control. On mobile, the graphic stays fixed while the fingerprint and parameter controls share one scroll pane; landscape places that pane beside the graphic. The current master knob, next-instrument link, square Audio button and MIDI-in-Settings presentation preserve the existing native controls. Cascade delay and initial wait use exact millisecond entry with 1 ms steps. An accelerating/slowing curve and seeded variation reshape the gaps while preserving total span; the timing strip previews scheduled entrances, including silent partial slots. Restart cascade briefly fades only the held note or chord before replaying it with the new timing, leaving other notes and transport intact. An eight-voice sample-clock engine renders the numbered discrete patch when it fits, with a labeled left/right stereo fallback and LFE omitted by default. Artwork is generated from the instrument's canvas. Routing follows the [Web Audio channel contracts](https://www.w3.org/TR/webaudio-1.0/); physical channel assignments and spatial feel still need a hardware listening pass.


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

SPARTIAL's 7:4:1 patch uses channels 5–6 for LS/RS (sides) and channels 7–8
for LRS/RRS (rears). The front, LFE and height channel assignments stay the same.

Speaker setup includes **Omit LFE channel**, on by default. For 7:4:1 it leaves
channel 4 silent; for 4:1 it leaves channel 5 silent. Other physical output
numbers stay unchanged. Uncheck it to include LFE as a destination for both
partials and grains, including One speaker and the stereo preview/recording
mix. This is ordinary source routing, without a bass-management or subwoofer
filter. The option is disabled for layouts without LFE. Presets and dice
preserve this output setting, and toggling it retains the selected physical
speaker when that speaker remains available.
