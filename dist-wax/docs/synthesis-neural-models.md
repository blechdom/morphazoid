# Synthesis Lab: the four trained teaching models

Methods 33–36 use **actual learned neural-network weights**, trained locally on
original generated sounds. They are deliberately small demonstrations of four
different principles. They are not WaveNet, RAVE, Google's DDSP implementation,
DiffWave, or pretrained models from those projects. None models speech, recorded
instruments, complete musical phrases, or text prompts.

The same dependency-free Rust inference source runs in the shared synthesis core
for WebAssembly, CPAL, and CLAP. Training requires NumPy; playback does not.
The common instrument engine owns pitch smoothing, velocity, ADSR, DC removal,
and output limiting. This module provides the excitation waveform.

| Method | Learned architecture | What actually runs |
| --- | --- | --- |
| 33: autoregressive | 8 → 24 tanh → 1 tanh; 241 parameters | Predict the next waveform sample from two preceding **predicted** samples, sine/cosine phase conditions, phase increment, and three timbre controls. Sample a temperature-scaled Gaussian around that prediction. |
| 34: latent autoencoder | Encoder 64 → 24 tanh → 4 tanh; decoder 4 → 32 tanh → 64; 3,932 parameters altogether | Decode four learned coordinates into a 64-sample periodic waveform frame. The encoder is included and exercised in reconstruction tests; live audio encoding is not a page feature. |
| 35: differentiable DSP | 4 → 24 tanh → 9 sigmoid; 345 parameters | Infer eight harmonic amplitudes and one noise amplitude, then synthesize those learned controls with an additive bank and white-noise source. |
| 36: diffusion | 67 → 64 tanh → 64; 8,512 parameters | Start from seeded Gaussian noise; repeatedly use the trained conditional clean-frame predictor in a deterministic DDIM reverse process, then play the resulting periodic frame. |

All weights are in
[`neural_weights.rs`](../src/instruments/synthesis/rust/core/src/neural_weights.rs).
The full four networks contain 13,030 parameters (52,120 bytes as float32), plus
eight latent-range constants. The playback binary can omit the unused encoder;
source and training tests retain it. No external inference runtime, network
request, model download, or third-party weight license is needed.

## Training and data

[`scripts/train-synthesis-models.py`](../scripts/train-synthesis-models.py)
contains the entire corpus generator, feed-forward layers, analytic
back-propagation, Adam optimizer, validation, and Rust exporter. Training uses
seed `20260929` and float32 NumPy operations. It uses no microphone recordings,
music files, scraped data, or third-party model weights. The generated examples,
training code, and resulting weights are original project material under the
repository's MIT license; NumPy is a training dependency under its own license.

The original corpus is intentionally restricted:

- **Autoregressive:** analytic periodic examples with a fundamental and second,
  third, and fifth harmonics. Timbre, Texture, and Contour change their amplitudes
  and phases. Training histories are perturbed and sometimes dropped to teach
  stable prediction when the preceding values come from the network itself.
  Training minimizes sample MSE, equivalent to fixed-variance Gaussian mean
  fitting; it does not learn a separate uncertainty/variance head.
- **Autoencoder:** 4,096 periodic 64-sample examples with four independently
  varying harmonic regions and a small nonlinear interaction. Both encoder and
  decoder optimize waveform reconstruction. Four-dimensional coordinates are
  learned jointly; they are not hand-assigned oscillator coefficients.
- **DDSP:** generated harmonic-plus-noise reference frames. The network outputs
  controls, these controls run through the differentiable sine/noise synthesizer,
  and the loss compares the resulting **audio waveforms**. Gradients propagate
  through synthesis into the network. Target coefficients construct the
  reference sound; there is no coefficient-regression training objective.
- **Diffusion:** 64-sample harmonic frames with two conditions and unconditioned
  small random changes to harmonic amplitude/phase. Forward training corruption
  is `x(t) = cos(πt/2) x₀ + sin(πt/2) ε`, with Gaussian `ε`. The network learns
  `x₀` from the noisy frame, the two conditions, and the timestep. Runtime
  reconstructs the implied noise at each step and follows a DDIM trajectory.

The four methods therefore remain distinct even though their training examples
share the deliberately limited domain of small periodic sounds. The procedural
corpus generators are **training tools**; runtime neural methods do not evaluate
those formulas in place of inference.

## Controls and playback bounds

Each model retains its original four normalized controls in the first four slots
of a sixteen-value parameter array. The expanded inference controls below occupy
slots 4 onward. They operate on the trained models and their synthesis process;
they do not add conditioning dimensions or change the bundled trained weights.

| Method | Controls, in order | Runtime mapping |
| --- | --- | --- |
| Autoregressive | Timbre, Texture, Contour, Temperature | First three are learned conditions scaled to −1…1. Temperature sets Gaussian standard deviation to `0.11 × value²`. It adds prediction variation, not an estimate of model confidence. |
| Latent | X, Y, Z, W | Display −1…1; normalized values span each learned coordinate's 3rd–97th training percentiles. Moving multiple coordinates can leave the well-sampled training region. |
| DDSP | Brightness, Odd / even, Formant, Noise | Four learned conditions. Brightness changes spectral slope; balance changes even-partial emphasis; formant moves a broad spectral emphasis; noise changes the learned noise contribution. These controls do not bypass the network. |
| Diffusion | Timbre, Harmonic shape, Denoising, Variation | First two condition the denoiser. Denoising chooses 4–20 reverse steps. Variation selects the initial Gaussian-noise seed. Every step-count setting reaches the final clean-frame endpoint; fewer steps mean a coarser approximation, not a guaranteed amount of leftover noise. |

Autoregressive prediction defaults to 12 kHz and can run from 3 to 24 kHz,
with linear interpolation to the host rate. Controls smooth inside that predictor; generated histories remain live
through parameter edits. The strongest training coverage is approximately
36–1,680 Hz fundamental at the default rate. The internal phase-increment bound
is 0.4 cycles per prediction, equivalent to 4,800 Hz at the default rate. This is a low-bandwidth teaching
generator, not a full-band audio model; high harmonics and high notes can alias.

The latent decoder and diffusion sampler run when their controls change. Their
learned frames are projected into five tables retaining at most 16, 8, 4, 2,
and 1 harmonics. Pitch selects and crossfades the table levels; this is ordinary
playback conditioning after learned generation. Frame edits crossfade over
25 ms. Expensive preparation runs at most 30 times per second, and a pending
control update completes even if the host sends no further parameter messages.

DDSP amplitudes smooth into an eight-harmonic bank. Harmonics above the allowed
frequency range are omitted. The noise source runs continuously. Outputs are
finite and bounded; the enclosing engine supplies articulation and final gain.
There is no heap allocation per sample. Reset reproduces stochastic generation
and waveform phase while preserving the selected model and controls.

## Expanded inference controls

The original four controls keep their order and meaning. Additional controls
have neutral defaults that preserve the original model behavior.

| Method | Additional controls | Actual destination |
| --- | --- | --- |
| Autoregressive | History amount 0–150%; prediction rate 3–24 kHz; history stride 1–8 samples; sampling seed | Scale the predicted samples fed back into the network, change its prediction clock, select more widely spaced preceding samples, and seed its temperature sampling. The training history stride was one; larger strides and history gains are bounded experimental inference settings. |
| Latent autoencoder | Latent spread 0–2×; orbit depth; orbit rate 0.01–8 Hz; orbit plane XY/XZ/XW/YZ/YW/ZW | Expand coordinates about the learned center and move two actual decoder inputs around a circular trajectory. Frames are decoded at the bounded preparation rate and crossfaded. This motion is in the learned space, not output vibrato. |
| DDSP | Partial count 1–8; harmonic stretch 0.8–1.2; noise color; attack brightness; attack-color time 5 ms–2 s | Select learned partial amplitudes, change oscillator frequency ratios, shape the synthesized noise source, and temporarily raise the brightness condition passed through the trained controller after a note-on. The common ADSR remains independent. |
| Diffusion | Condition contrast 0–2×; residual noise 0–80%; sampling stochasticity; regeneration rate 0–4 Hz | Blend/extrapolate the conditioned denoiser against its response at neutral conditions, choose an earlier diffusion endpoint, introduce the DDIM stochastic term, and periodically generate a fresh seeded frame. |

Diffusion condition contrast uses a **neutral-condition reference** evaluated by
the same network. The network was not trained with an unconditional branch, so
this is not advertised as classifier-free guidance. Residual noise changes the
actual last timestep; at its neutral zero setting the process still reaches
`t=0`. Stochasticity zero retains the original deterministic DDIM path. A zero
regeneration rate holds the generated frame until a parameter edit.

The expanded DSP tests exercise all 17 added neural controls, activating the
relevant process for dependent controls (orbit depth for orbit rate/plane,
attack brightness for attack time, temperature for sampling seed). They verify
measurable output changes and finite bounded output at extreme combinations.
The original training losses below still describe the unchanged weights and
training task; they do not certify out-of-training inference settings.

## Reproduce and validate

From a checkout root, with a suitable Python installed:

```sh
python3 -m venv /tmp/synthesis-model-training
/tmp/synthesis-model-training/bin/pip install numpy==2.2.6
OPENBLAS_NUM_THREADS=1 /tmp/synthesis-model-training/bin/python scripts/train-synthesis-models.py
```

This overwrites the generated weights and
[`synthesis-neural-training-results.json`](synthesis-neural-training-results.json).
Default training takes 10,000 AR updates, 7,000 autoencoder updates, 8,000 DDSP
updates, and 12,000 diffusion updates. Fixed seeds and a pinned NumPy version
support reproducibility; another CPU/BLAS implementation can introduce small
floating-point differences. The report records the generated source SHA-256.

Observed held-out results for the supplied weights:

| Check | Measured MSE |
| --- | ---: |
| AR, corrupted teacher-history prediction | 0.000583 |
| AR, free-running histories on unseen conditions | 0.000557 |
| Autoencoder, unseen-frame reconstruction | 0.0000151 |
| DDSP, synthesized waveform error | 0.000195 |
| Diffusion, held-out noisy-frame denoising | 0.00525 |

Each is a loss in its own task and scale; these numbers do not rank the models
against one another. The diffusion result averages many noise levels, including
highly ambiguous near-pure-noise inputs. Training asserts meaningful improvement
and reconstruction bounds before the exported models are accepted.

The focused Rust tests can also run without any parent crate:

```sh
rustc --edition=2021 --test -O src/instruments/synthesis/rust/core/src/neural.rs -o /tmp/synthesis-neural-tests
/tmp/synthesis-neural-tests
```

Five tests cover unseen-frame autoencoder reconstruction, all four generators at
55/220/880/1,760 Hz, finite bounded non-silent output, exact deterministic reset,
every exposed control's sensitivity, completion of deferred updates, and
non-finite input handling. The shared core's tests cover its ADSR and host APIs.

Additional native checks rendered all 32 factory presets at the **same 220 Hz**,
without ADSR, to separate timbre from preset pitch and articulation. Every preset
was audible and finite. The minimum pairwise distance between unit-normalized
magnitude spectra within each bank was 0.108 (AR), 0.183 (latent), 0.191 (DDSP),
and 0.0629 (diffusion). RMS levels ranged from 0.173 to 0.527 before the common
output stage. These are mechanical separation checks, not a listening judgment.

An optimized native build on the development host rendered 60 seconds of one
voice in approximately 0.19 seconds for AR, 0.03 seconds for cached latent or
diffusion playback, and 0.04 seconds for DDSP. Twenty-step diffusion frame
preparation averaged about 52 microseconds. These are local native observations,
not phone/browser performance guarantees. Human listening and physical-device
acceptance were not performed as part of these model checks.

## Family references

These explain the wider research families, not the architecture or identity of
the bundled miniature models:

- van den Oord et al., [WaveNet (2016)](https://arxiv.org/abs/1609.03499).
- Caillon and Esling, [RAVE (2021)](https://arxiv.org/abs/2111.05011).
- Engel et al., [DDSP (2020)](https://arxiv.org/abs/2001.04643).
- Kong et al., [DiffWave (2020)](https://arxiv.org/abs/2009.09761).
- Song, Meng, and Ermon,
  [Denoising Diffusion Implicit Models (2020)](https://arxiv.org/abs/2010.02502).
