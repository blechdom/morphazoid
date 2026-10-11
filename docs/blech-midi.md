# Blech MIDI

[Open Blech MIDI](../blech-midi.html). Drawing, black MIDI and geometric stamps,
words, and Automatapoeia MIDI rules now have their own page. The file player,
live MIDI visualizer and two-deck mixer remain in [Midiophilia](../midiphoria.html).

## Prepare and send

Turn **Audio** on. Draw on the preparation canvas below the live output, or
choose one of its shapes, then press **Send ↑**. The sent score is a snapshot:
editing, erasing or clearing the preparation canvas leaves that score playing.
**Download MIDI** saves the score that was sent, including its pitch span,
lowest note, row length and key gate. Editing the drawing hides the stale link.

The top **Send ↑** button performs the same action. In the **Automatapoeia**
tab it sends the selected rule instead. Space outside editable controls sends
the prepared source; it never arms Audio. Inside the preparation canvas, arrow
keys move the cursor, Space or Enter paints, Delete erases, and Ctrl/Cmd+Z undoes.
One captured freehand stroke is one undo action.

The stamp bank contains the existing generated textures plus the bundled black
MIDI and geometric file stamps. Its single filter searches names and collections.
Selecting a stamp sends it immediately. **Paint flow** places the selected stamp
by pitch directly on the live output; Enter on that output sends it once. Messages
also send immediately. The preparation canvas remains separate from these live
actions.

## Timing and sound

**Loop** repeats active drawings, stamps, messages and rules. Turning it off lets
each current cycle finish. **Sync to tempo** follows the 30–300 BPM tempo control;
turn it off for each source's original timing. The tempo has the shared Tap
control, and source-specific row length and clip length remain available.

**Stop** removes the active patterns and releases their notes. **Audio off** also
stops active patterns; preparing and sending silent previews remains possible.
There is no queued conveyor or position-preserving pause in this move. Sending
another score layers it with the currently playing scores. Up to four clips play
at once; another send replaces the oldest. Enabling Audio during a silent preview
joins its current position.

Generated drawings, patterns and rules default to piano; file stamps can retain
their original instruments. The Black MIDI volume controls the shared stamp
bus, and masthead Output controls the instrument's final output. **Stamp MIDI**
retains program, controller, pitch, velocity and envelope parameters supported by
the existing MIDI stamp engine. Source settings apply to future sends; live
parameters update active voices where supported.

The collapsed **SoundFont & live effects** section keeps the stamp sound controls
on this page. Open a local SF2/SF3 bank up to 32 MB, or restore TimGM6mb. Selecting
a bank leaves Audio off until explicitly enabled. Banks stay in this browser;
loading errors keep the previous usable bank. Filter frequency, echo mix,
beat-based echo length, feedback, and the existing SoundFont reverb/chorus
parameters update the same engine used by drawings, stamps, messages and rules.
Tab changes preserve these settings. **Reset effects** restores their defaults
without stopping the patterns or changing Audio, output level or the SoundFont.

Automatapoeia uses the original instrument's rule-picker layout: a current
thumbnail inside the closed pulldown and thumbnail tiles inside the opened
pulldown. Search decimal or binary codes, show all rules, show symmetry
representatives, or show the selected rule's equivalence family. All 256
elementary rules and 64 radius-2 totalistic codes remain available. Previous,
Next, the rule knob, and the dropdown keep the same selected rule.

Seed density, exact Seed, **Restart**, **Reseed**, family, rule, boundary,
post-step transform and Columns / width are directly visible. Width supports
8–128 pitches, bounded by MIDI's complete 0–127 note range. Restart prepares
the same current seed again; Reseed advances to a reproducible new seed.
Neither action sends MIDI or changes already-playing layers. At zero density,
the seed is one centered cell, so different seed numbers retain the same picture.

**Generation rate** uses 1–8 rows per beat and shares the existing
**Beats per generation** value in MIDI pattern settings. They are reciprocal
views of one value; 4 rows/beat is ¼ beat/generation. The existing 480-tick
encoder rounds to actual MIDI timing. With Sync on, changing the master tempo
changes real-time speed; with Sync off, generated scores use their original
120 BPM. Generations, lowest note, articulation and velocity remain MIDI
settings. Source edits change the next Send, while the active score is retained.

The same original Automatapoeia catalogue, thumbnail raster, evolution, edge
and post-step-transform functions are reused. The original instrument's
oscillator voices, spectral/contour mappings and audio ADSR are synthesis
controls, not cellular generation controls; Blech MIDI instead uses its
SoundFont, Stamp MIDI and live-effects controls for those sound changes.
The MIDI generator remains distinct from the
[standalone Automatapoeia instrument](../automatapoeia.html).

## Pattern mapping and source details

The 30 generated pictures include Heart, Square, Zigzag, Polka dots, Plaid,
Stripes, Drips, Glob, Glooob, Noise, Scatter and Explode. Their thumbnails show
actual pitch/time cells. Density changes stroke thickness or particle count;
Pitch span covers 12–128 chromatic notes and Length spans 4–32 beats. Variation
changes a reproducible seed for irregular textures. Fixed icons retain their
geometry when only that seed changes.

The palette also retains 28 bundled file stamps: 16 Black MIDI arrangements,
nine geometric patterns and three studies. Short geometric files play whole,
fitted to Length. Longer arrangements use a dense excerpt; Next slice moves
through the source. File window offers automatic, densest, manual-start and
whole-file selection. Status reports the source beat range and note count.
The 35-file downloadable archive includes larger decorative scores that the
stamp palette does not unpack.

Excerpts preserve programs, controllers, pitch bend and held notes at their
boundaries. Dense excerpts are explicitly shortened to meet the engine limits,
without silently thinning their attacks. A single instant that cannot fit is
rejected. A 100% key gate retains the original bytes; a shorter gate changes
key release while source pedals can still extend the sound. Only two parsed
file stamps are cached, and file downloads are lazy and cancelable.

In the 48×32 preparation grid, pitch increases left to right. The top of the
picture enters the live output first and rises, keeping the complete image
upright. Adjacent vertical cells sustain one note. Defaults remain piano,
MIDI pitches 48–95 and ¼ beat per row: four seconds at 120 BPM. There is no
scale snapping. Shape buttons replace the draft with editable original pixel
patterns; they do not rasterize platform emoji fonts. Undo retains 32 edits.

Messages use the existing original 5×7 letters and curated 🙂 😀 ⭐ ❤ ◆ symbols.
Whole words fit up to eight characters alongside each other and continue in
phrases; One letter at a time uses a separate window for each letter. Up to
32 characters are supported, lowercase becomes uppercase, and skipped symbols
are reported. The message field launches its score immediately. The separate
Words & symbols file-generation feature remains in Midiophilia's visualizer.

Automatapoeia maps each column to one chromatic pitch. Its seed row plays first,
followed by each generated row. Retrigger attacks every active cell; Hold joins
consecutive cells at the same pitch. The selected preview uses the actual seed,
boundary and transform; rule-menu thumbnails use a fixed random seed with
wraparound. Controls span 8–128 pitches and generations, ⅛–1 beat per row,
MIDI pitches 0–127, velocity, seed density, reproducible seed, fixed or periodic
edges, and post-step shift, reflection or inversion. At most 16,384 notes and
128 beats are generated per pattern. Preview edits do not replace a playing
pattern; Send rule launches the new snapshot. Download MIDI saves that rule.

## Ownership and limits

One `MidiMixerEngine` owns the sound graph and sample clocks; it loads no deck
files on this page. One `mountMixerPerformance` instance retains the stamp bank,
rule editor, live MIDI controls and renderer across tabs. Graphics follow native
audio timing when Audio is running. With Audio off and no context, the existing
silent preview clock advances without creating Web Audio.

The shared output connection supports stereo meters and main-output recording.
Page departure aborts downloads and listeners, revokes generated URLs, releases
the audio graph and removes render observers. A back/forward-cache return mounts
fresh owners with Audio off and restores the prepared drawing without restarting
playback. No microphone, MIDI input, MIDI output or device permission is requested.

The existing sample limits remain: at most four clips, 32,768 notes, 16 channels,
512 beats and 2 MB per generated/excerpted sample. Dense file stamps use bounded
windows; **Whole file** can shorten an oversized source to fit those limits.
The preparation grid is 48 by 32 cells, mapped across up to all 128 MIDI pitches.

Visuals are independently implemented for the browser, inspired by
[Nicholas C. Stanley's Midiphoria](https://github.com/NicholasCStanley/midiphoria).
See the [MIDI collection and SoundFont credits](../assets/midiphoria/SOURCE.md)
for source attribution, licenses and links. Existing rendering and scheduler
bounds are preserved; this page does not promise every dense black-MIDI note
will become a separately visible mark or simultaneous sounding voice.

## Black MIDI tools and references

Primary-source research for the stamp workflow, checked October 2026:

| Tool | Documented role | Relevance here |
| --- | --- | --- |
| [ImageToMidi](https://github.com/arduano/ImageToMidi) | Desktop image-to-MIDI note-art generator, with pitch range and time-per-pixel controls. | Pixel geometry can become the actual sounding score. |
| [midi2img](https://github.com/mathigatti/midi2img) | Python conversion between monochrome images and MIDI piano rolls. | A clear pitch/time raster model. |
| [rin-w Black MIDI Patterns](https://github.com/rin-w/black-midi-patterns) | Reusable patterns in MIDI, Domino and FL Studio formats. | Nine existing patterns become whole playable stamps. |
| [Zenith](https://github.com/arduano/Zenith-MIDI) | MIDI video renderer with plugins, live preview settings, gradients, opacity, ripples, textures and statistics. Its author states it is no longer supported. | Reference for independent visual presentation controls. |
| [Kiva](https://github.com/arduano/Kiva) | Native MIDI player supporting palettes and MIDI color events. | Reference for distinguishable voices on one canvas. |
| [Wasabi](https://github.com/BlackMIDIDevs/wasabi) | Rust/Vulkan Black MIDI player with integrated XSynth and SoundFonts. | Reference for keeping dense graphics and audio workloads separate. |
| [MIDITrail](https://www.yknk.org/miditrail/en/summary/) | A 3D MIDI player for Windows, macOS and iOS. | Reference for depth and rain-style presentations. |
| [Piano From Above](https://github.com/brian-pantano/PianoFromAbove) | Native visual MIDI player with a separate visualization branch. | Reference for readable rectangular note geometry. |

The browser mappings above are Morphazoid design choices, not ports of these
applications or claims of their full feature sets. No code from these tools
was imported for this stamp bank. Generated textures are original bounded
pitch/time patterns; they do not claim to recreate any named composition.
