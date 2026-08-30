# Micromorph AI

## Product thesis

There are two different generative-AI products hiding inside the phrase
“text-to-sound plug-in”:

1. A model designs or assembles an ordinary audio effect or instrument. The
   generated artifact can run without the model afterward.
2. An audio effect or instrument contains a model in its sounding path. The
   player continuously conditions the model and the model continuously makes
   the sound.

Micromorph starts with the second idea. It is a live microphone effect whose
main gesture is not “write a prompt, wait, receive a clip.” It asks how far the
current sound should travel from its audible ancestor while it is being played.

The browser implementation is deliberately model-neutral. It is playable today
through a clearly labeled deterministic rehearsal processor, and it can replace
that wet path with PCM from any compatible local streaming host. A socket being
connected is not treated as proof that neural audio is audible.

## What realtime audio diffusion could feel like

“Diffusion” is useful here as a performance metaphor even when the eventual
realtime network is a distilled diffusion model, consistency model, flow model,
neural codec transformer, or another causal generator.

- **Lineage morphing:** preserve the mic at one end and move through increasingly
  distant but continuous descendants at the other. A spoken consonant can become
  a membrane strike, wire choir, glass breath, or an invented animal without
  becoming a disconnected sample trigger.
- **Semantic resynthesis:** two text or reference anchors describe possible
  bodies. A material control interpolates the current voice between those bodies
  while timing still comes from the performer.
- **Structure-preserving mutation:** lock articulation, rhythm, loudness contour,
  or pitch movement from the mic while allowing timbre and microscopic texture
  to be regenerated.
- **Ancestral memory:** a short context sounds responsive and literal; a longer
  context lets earlier syllables, breaths, and gestures recur as learned material.
- **Counterfactual continuation:** after the mic falls silent, the model can stop,
  decay, answer, or continue an imagined phrase. This turns an effect into a duet.
- **Controlled instability:** mutation changes seed drift and divergence without
  asking the player to rewrite prose during a performance.
- **Recoverable failure:** inference jitter should briefly reveal the rehearsal
  organism, not freeze the audio thread or silently build seconds of latency.

## The Micromorph controls

- **Ancestor distance / derivation** is the main performance control: source at
  zero, imaginary descendant at one.
- **Ancestor A and B** are bounded semantic endpoints, not full songs to copy.
- **Material** chooses the position between those endpoints.
- **Structure lock** decides how tightly output follows mic timing and gesture.
- **Memory** selects temporal context and latent persistence.
- **Mutation** controls stochastic divergence.
- **Continuation** controls how much the model may imagine after source energy
  falls.

All continuous controls share the input PCM sample clock. That makes automation
and gestures align with sound instead of relying on unrelated wall-clock arrival
times.

## Morphazoid-style uses

- A vocalist plays an impossible throat whose geometry changes continuously.
- A percussionist turns mouth clicks into living impacts while keeping their
  groove and dynamics.
- A wind or bowed instrument becomes a family of speculative acoustic bodies,
  with breath and bow articulation preserved.
- A feedback send remembers earlier phrases and returns increasingly remote
  descendants rather than ordinary delay taps.
- Two Morphazoid instruments become the A/B ancestors of a third “offspring”
  instrument.
- A sound designer records one performance while automating derivation, then
  keeps the control performance and swaps models behind the same open boundary.
- An installation uses mutation and continuation to make an environment answer
  visitors without replaying fixed clips.
- A later DAW/WAX version receives the host track instead of browser mic input,
  while retaining the same controls and model-host contract.

## Model capability tiers

Not every audio generator belongs in a live insert. Micromorph should name the
actual behavior and measured latency.

- **Causal neural effect:** tens of milliseconds, continuous input/output, best
  for tight vocal and instrumental performance.
- **Chunked latent transformer or distilled generator:** roughly one gesture
  behind the performer, useful as a responsive parallel effect or duet.
- **Predictive buffer remix:** reads a larger rolling context and produces a
  transformed continuation. Musically live, but not a transparent insert.
- **Clip diffusion:** seconds of generation time and finite outputs. Valuable as
  a separate loop breeder or sample instrument, not falsely presented as this
  realtime mic effect.

A conforming host advertises causal transformation, text-anchor support,
algorithmic latency, and output hop size before Micromorph marks it ready.

## Local model boundary

The first implementation uses the loopback-only `mga-stream/1` contract in
`contracts/micromorph-stream-v1.md`. The browser owns microphone permission,
visuals, controls, bounded buffering, and final output. A replaceable process
owns the model, weights, GPU/accelerator selection, and inference state.

That boundary lets us try small open models without embedding one project’s
license, runtime, or private wire protocol in every Morphazoid page. It also
keeps remote microphone upload out of the default design. A future remote mode
would be a separate, explicit privacy decision rather than a different URL
silently entered into the local field.

## Next experiments

1. Implement one genuinely causal local adapter and measure end-to-end latency,
   drop recovery, and model/rehearsal crossfades on ordinary hardware.
2. Train or distill a small voice-to-texture model around the six Micromorph
   controls instead of attempting to bend an offline clip generator into a live
   insert.
3. Add reference-audio anchors alongside text anchors without allowing uploaded
   microphone material to leave the loopback boundary.
4. Record sample-clocked control and condition events so the same performance is
   reproducible with different local models.
5. Split continuation-heavy models into a parallel “descendant voice” so a
   predictive generator can answer the source without pretending to be
   zero-latency.
