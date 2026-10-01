# Separate instrument idea — saved for later

Owner direction, 2026-10-01: finish Voicesaurus first. Do not fold this into its
voice-engine controls or begin another instrument in this pass.

Build speech or another target sound from water, footsteps or arbitrary source
samples. Two distinct processes are worth comparing:

- Spectral cross-synthesis: transfer a target's changing spectral envelope onto
  another sound, with FFT overlap-add reconstruction.
- Corpus audio mosaicing: analyze short source fragments, find spectral or
  perceptual matches for target frames, and assemble the selected fragments.

The owner asked about an original Rust/CPAL implementation. A shared Rust DSP
core could run with CPAL for native audio I/O and compile to WebAssembly for an
AudioWorklet browser host. CPAL is an audio-I/O layer; it does not supply spectral
matching or resynthesis. Keep analysis, matching, grain scheduling, overlap-add,
latency, output protection and real-time memory bounds in the DSP design.

Existing alternatives: Csound's phase-vocoder opcodes (including a WASM runtime),
FluCoMa's audio descriptors/corpus tools, Essentia.js's WASM analysis, and
CataRT/MuBu's corpus-based concatenative synthesis in Max. These have different
roles and are not interchangeable complete browser mosaic instruments.

Candidate inputs: uploaded target and corpus files, explicit microphone capture,
and correctly credited water/footstep samples. Keep target and source input roles
visible. No implementation or sound assets are claimed here.
