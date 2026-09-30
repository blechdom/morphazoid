# Synthesaurus: native CLAP instrument

The `synthesis-clap` crate wraps the same Rust synthesis core and generated
53-method / 424-preset bank used by the browser laboratory. Its plugin ID is
`org.morphazoid.synthesis`. It has one stereo output, one note input supporting
CLAP notes and MIDI 1.0, and no audio inputs. It uses the host’s generic parameter
editor; no custom graphics or window system are required.

From `src/instruments/synthesis/rust`, run:

```sh
cargo test -p synthesis-clap --release -- --test-threads=1
cargo build -p synthesis-clap --release
```

On Linux, the build produces `target/release/libsynthesis_clap.so`. A CLAP host
expects that shared library as a `.clap` file; copy it to a host-scanned location
with the filename `Morphazoid-Synthesis.clap`. This repository does not install
it into a user plugin directory automatically. Build for the architecture used
by the host. macOS requires a platform-appropriate CLAP bundle, and Windows uses
its native dynamic-library build; those packaging steps are not validated by
the Linux fixture tests.

## Playing and automation

The host exposes method and preset selectors, a frequency reference, ADSR,
master output, method-specific controls, **Hold note**, and **Voice mode**. Methods expose algorithm-specific
controls, drawn from sixteen synthesis slots. Unused controls are hidden
through parameter metadata. A method change requests a host rescan so the macro
names and eight preset names match the selected method. All parameters have
stable numeric IDs for automation:

| ID | Parameter | Range |
| --- | --- | --- |
| 0 | Method | 0–52, stepped |
| 1 | Preset within method | 0–7, stepped |
| 2 | Frequency for Hold note | 20–8,000 Hz |
| 3 | Attack | 0.001–12 seconds |
| 4 | Decay | 0.002–12 seconds |
| 5 | Sustain | 0–1 |
| 6 | Release | 0.003–16 seconds |
| 7 | Output | 0–1; default 0.7 |
| 8–15 | Synthesis slots 0–7 (original IDs) | 0–1; see method parameter inventory |
| 16 | Hold note | Off / Held |
| 17–24 | Synthesis slots 8–15 | 0–1; see method parameter inventory |
| 25 | Voice mode | Mono / Poly (8 voices); default Mono |

Selecting a preset recalls its pitch, envelope and synthesis controls while
preserving master output, voice mode and currently held notes. Selecting another method
recalls the same preset index within that method. Editing a control changes the
sound directly; the selected preset index remains the recall location.
The [method inventory](synthesis-methods.md#parameter-inventory) maps normalized
macro values to each algorithm’s physical ranges and units.

Incoming notes set pitch from MIDI key number; they take precedence over the
manual Hold-note frequency reference. **Mono** is the default and retains
last-note priority: releasing a newer note resumes the latest older held note;
an unrelated note-off does not silence it. **Poly (8 voices)** gives each note
its own synthesis model, pitch, velocity and ADSR. CLAP note IDs distinguish
repeated pitches; raw MIDI uses channel and key. Releases, sustain and note
chokes affect their matching voices. The ninth concurrent note steals a voice,
preferring a released voice before the oldest held voice. The fixed held-note
table has 256 entries and evicts the oldest on overflow. Switching voice mode
revoices held keys, retaining the newest eight in Poly or newest one in Mono,
with a short transition. Hold provides a fallback note when no external keys
are held. Preset and method recall preserve voice mode. MIDI sustain, velocity-zero note-on,
all-notes-off and all-sound-off are handled. MIDI pitch bend, MPE, MIDI 2.0,
per-note parameter modulation and external audio/sample import are not exposed
by this wrapper. Source-based methods use the core’s generated source material.

Note and parameter events are processed at their sample offsets within each
host block. Output is supported as 32-bit or 64-bit planar stereo; the mono
synthesis mix is written to both channels. Master changes have a short ramp.
Poly uses smoothed voice-count gain and a sample ceiling to leave headroom as
notes overlap; one active voice retains the calibrated solo level.
The core provides parameter smoothing and method transitions. Activation and
reset clear notes; the instrument is silent until a note or Hold action occurs.

## Threading, state and limits

The audio engine and held-note state are owned by the CLAP audio callbacks.
Activation allocates the mono engine and eight polyphonic engines; processing uses a fixed 128-frame scratch
buffer and performs no heap allocation, including sample-offset note and
parameter changes. The wrapper follows CLAP’s rule that `process`, active
parameter `flush`, reset and lifecycle operations on an instance do not run
concurrently. Inactive parameter flush follows the corresponding main-thread
contract.

Main-thread parameter reads use atomic published values. Saved state uses a
versioned atomic snapshot. A state load validates a complete binary record and
publishes it through an atomic mailbox; the audio callback applies it at the
next processing/flush boundary. It never mutates an active engine from the UI
thread. The state format contains an eight-byte magic, a little-endian 32-bit
version (`3`), and 26 bounded little-endian 64-bit parameter values. Version-2
records with 25 values load with Mono selected. Version-1 records with 17 values
also default to Mono and remain readable: old performance and meaningful synthesis
physical values are preserved through the shared range-migration helper, new
controls receive their selected preset defaults, and
formerly unused zero slots do not overwrite the new defaults. Existing IDs
0–24 retain their meanings; Voice mode appends at ID 25. Stream reads
and writes may be partial. Truncated records and unknown versions fail without
partially applying a state. Nonfinite numeric values receive safe defaults.

Held notes, sustain, live audio buffers and manual Hold state are not restored.
Loading saved state cannot leave an unintended held voice playing. The
maximum accepted activation block size is 1,048,576 frames; rendering remains
chunked internally. Accepted sample rates are 8–192 kHz.

## Validation boundary

The native ABI fixtures exercise the exported factory/descriptor, parameter
and port extensions, lifecycle, 32/64-bit stereo output, sample-offset note and
parameter events, note identity and priority, sustain and panic messages, all
catalog methods with their eight generated presets, mono sample identity,
independent polyphonic releases and chokes, mode changes, voice stealing,
legacy state migration, partial state streams, malformed
state, concurrent state loading, and allocation-free processing. The trained
neural feature is enabled in the native target.

These tests are a small CLAP host fixture, not a test in a commercial DAW.
They establish mechanical behavior; host scanning, hardware playback, real DAW
automation/editor refresh and human listening still require a device/host pass.
The neural models’ capacity and provenance limits are documented in
[synthesis-neural-models.md](synthesis-neural-models.md).
