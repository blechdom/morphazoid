# Fractal Synthesis

Fractal Synthesis is one instrument with six tabs: **paths, branches, grains, waves, echoes, textures**. Open [`fractal-synthesis.html`](../fractal-synthesis.html), choose a tab and preset, enable **Audio**, then press **Play**. Audio and transport are independent. The bank contains 54 complete presets in a stable mixed order, with descriptive names and no ownership or tab prefixes. Supplied settings and seeds retain their exact values. Opening presets are independent of menu order; Grains opens with Needle scan. Each tab has three sound engines. The adjacent modulation choice changes how that generator behaves; its labels follow the selected engine.

The earlier `fractal-signals.html` route redirects to the new page and preserves its query and hash. New links use the tab names (`#paths`, `#branches`, `#grains`, `#waves`, `#echoes`, `#textures`); the original internal identifiers below also remain valid:

| Tab / deep link | Engines | Mechanism and gesture |
| --- | --- | --- |
| **paths** · `#wander` | cascade, pluck, additive | Bounded multiscale motion makes a continuous pitch path with separately articulated events and omitted attacks. **Time folding** changes its horizontal stretch; **Excursion** changes pitch displacement. Cascade uses nested FM/PM, pluck excites a short delay-string voice, and additive uses a bank of partials. |
| **branches** · `#grammar` | cascade, pluck, bell | A graph form of L-system rewriting grows tips into stems and new tips. The trunk starts on the left, and every child generation advances right. Height and bearing determine continuous pitch. **Branch spread** and **Child length** reshape the score; the circular **Branch angle** knob rotates its bearings; the engines give it modulated, plucked or ringing articulation. |
| **grains** · `#grains` | sample, resonant, cloud | Grains spawn shorter descendants in nested clusters. **Cluster spread** changes their separation; **Fan rotation** changes their arrangement. Sample reads windowed source fragments, resonant filters their excitation, and cloud adds overlapping offset fragments. |
| **waves** · `#waveform` | self-affine, folded, hollow | Partial frequencies follow a geometric ratio. **Detail phase** changes their relative phases; **Pitch lift** changes register. Self-affine sums the partials, folded bends that sum, and hollow retains alternate recursion levels with quieter upper detail. |
| **echoes** · `#echoes` | shepard, strikes, resonant | A spiral score feeds geometric delay taps and retained feedback. **Spiral opening** changes the geometry; **Spiral turn** changes its winding. Shepard adds continuously wrapped register motion, strikes exposes the rhythm with short impacts, and resonant supplies ringing material. |
| **textures** · `#texture` | noise, resonant, hybrid | Sixteen measured frequency bands and an amplitude profile guide fresh material. **Band drift** and **Grain contrast** reshape the score. Noise uses filtered noise, resonant uses focused pitched bands, and hybrid adds source grains. |

## Playing and recovery

Drag the illuminated handle or anywhere in the plotting area to change the two labeled gesture values. Focus the Canvas and use arrow keys for the same controls; Shift makes keyboard steps smaller. Knobs and sliders retain native keyboard operation. The circular Play/Pause button sits directly below the preset menu, beside Tempo in BPM. Restart, Forward/Reverse, Ping-pong and Loop share this transport region. Tempo controls the existing phrase clock (BPM = pulse rate × 60), preserving preset timing. Frequency and time controls use logarithmic travel where appropriate, giving more precision at their low end. Information buttons explain the current tab, engine, parameter or microphone mapping without covering the playing surface permanently.

Node flashes indicate score onsets. In the lower score, horizontal position is phrase time, vertical position is continuous target frequency, and line length is the model's event gate. The score target is not a measurement of every output partial or the instantaneous frequency after modulation. The phrase slider scrubs the score; **Restart** returns to its beginning with the existing seed.

**Next** recalls the next complete factory scene. **Dice** randomizes every scene-owned musical field, including engine, modulation choice, direction, envelope, gesture, and microphone mix/gain, while retaining the current tab. Randomized Echoes keep source attacks close enough to audition and keep Attack within the event gate, avoiding long unintended silence. Factory recall and randomization preserve Audio, Play, output level and the current microphone connection. Switching tabs remembers their current session controls. Recovery is through the preset bank, Next, Dice and Restart; there is no patch-save or patch-load interface.

**Copy settings** copies the complete current preset state as text, including the exact seed, gesture values, engine, modulation, inactive parameters and ADSR values. It also identifies the tab, loaded source filename and whether the microphone is connected. Paste that text with a proposed name and a note about the sound when requesting a new factory preset. It does not save to browser storage or include audio-file samples or microphone recordings. If clipboard access is unavailable, a dialog selects the same text for manual copying. Copying leaves the current sound and transport untouched.

The paths bank starts at a 440 Hz plucked scene and includes roots from about 154 to 980 Hz, sparse isolated calls, high pinpricks, bent phrases, fast rattles and inharmonic cascades. The presets vary engines, attack density, gates, pitch movement and articulation as well as register. The fastest scenes deliberately approach a buzz or rattle; the sparse scenes leave released gates and clear gaps.

## Shared controls and ranges

Pitch relationships come from geometry and continuous ratios, without automatic Western-scale or equal-tempered quantization. Root is a reference frequency rather than a promise that all resulting sound stays in that register.

| Control | Range | Consequence |
| --- | --- | --- |
| Root | 20–8000 Hz | Reference for geometric pitch and spectral placement. |
| Pitch span | 0–8 octaves | Frequency excursion produced by the same geometry. |
| Mod ratio / Band spacing | 0.03125–32× | Rate or ratio of the selected modulation; in textures it redistributes band frequencies. |
| Mod amount / Band motion | 0–32 | Strength of the selected modulation; in textures it controls band movement. |
| Recursion | 1–48 | Generations, descendants or spectral detail, within the bounded rendering and voice budgets. |
| Roughness | 0.01–3 | Weight of fine structure; values above one can make short-scale detail dominant. |
| Branching | 0–64 | Descendant or event density. Zero selects the sparsest structure; upper values add representative subdivisions within the fixed event budget. |
| Tempo | 3.75–3840 BPM | Speed of the phrase clock; subdivisions may create multiple attacks per beat. |
| Phrase | 1–512 beats | Duration of a complete traversal. Seconds per phrase = Phrase × 60 / Tempo. |
| Attack | 0.0002–4 s | Time from onset toward the event peak. |
| Decay | 0.001–8 s | Time from that peak toward Sustain. |
| Sustain | 0–1 | Level retained while the event gate remains open. |
| Release | 0.005–16 s | Fade after the gate closes. |
| Note length / String decay / Grain decay / Grain length / Delay feedback / Echo feedback | 0–0.96 | The label follows the engine’s duration or feedback destination; all variants also change shared stereo-delay feedback. |
| Stereo delay | 0–1 | Wet level and feedback of crossed 173 ms / 277 ms delays, plus event pan width in pitched and grain voices. Zero removes the added delay but does not make the dry source mono. |

The draggable ADSR uses Shapes’ shared amplitude editor with an instrument-owned view of the four audio parameters. Drag **A** horizontally for Attack, **D** horizontally for Decay and vertically for Sustain, **S** vertically for Sustain, and **R** horizontally for Release. Arrow keys edit the focused point; Shift makes larger steps. Each time stage has independent logarithmic travel so a very short attack stays reachable beside a sixteen-second release. The graph illustrates the stages rather than a single linear time axis; the score determines when the gate closes. The **pluck, note, sustain, pad** buttons adapt the same envelope starting points used by Shapes. They change only Attack, Decay, Sustain and Release, retain the current phrase position and microphone connection, and show no active selection after a custom edit. Graph and knobs always share the same values. A short event gate can close during Attack or Decay; a longer Attack does not automatically lengthen that gate. Slower clocks and the relevant duration controls give longer envelopes more room. Grains also apply a window around each fragment. Running parameter changes preserve the current phrase position.

**Forward / Reverse** chooses the initial traversal direction. **Ping-pong** places the first and last score events at the ends of each phrase, plays each endpoint once, then returns through the adjacent events in reverse order. It also reverses new grain reads and the Shepard sweep on the return leg. This endpoint fit applies only to Ping-pong; ordinary looping keeps its original timing. **Loop** repeats the pass or round trip. With Loop off, playback ends at the far end (or the starting end after a round trip), then releases active notes and delay tails naturally. Pause retains phrase position and travel leg; Restart returns to the outbound start with the same seed; Play after completion starts again. Audio off/on retains the current travel leg. Direction and stereo orientation are independent. The two gesture axes remain normalized from zero to one; the mode-specific labels state their current meaning. Seeds are integers from 1 to 999999 and make structural choices reproducible.

The former **Memory** control is a linked duration/feedback control. Paths and waves use it for note gates; plucked strings also use it for string decay. Branches’ non-string engines use it only for stereo-delay feedback. Grains use it for descendant level and window length, with filter resonance in the resonant engine. Echoes use it for tap levels, feedback and event duration. Textures use it for note gates and, in the hybrid engine, grain length. Its shared-delay contribution requires Stereo delay above zero. These labels and help explain the existing mappings without changing the sounds.

## Geometry and stereo mapping

The **Mapping** section controls the relationship between the visible score and sound:

- **Pitch span** scales the pitch excursion; **Invert pitch** reflects it around Root. Texture bands and Shepard register contours follow this inversion too.
- **Timing bend** (−1 to 1) warps score timing without changing event order or phrase length. Positive settings crowd attacks toward the beginning in forward traversal; negative settings crowd them toward the end. Reverse mirrors this timing. The adjacent **↺ 0%** button restores neutral timing while retaining transport position.
- **Shape → mod** (−16 to 16) adds a signed amount from the graphic's vertical position to Mod amount. Zero retains the existing fixed setting. It acts on each engine's applicable modulation path and retains the overall 0–32 bound.
- **Stereo width** (0–200%) sets the finished stereo spread, including effects and microphone processing. Zero is mono; 100% preserves the original image. **Flip L/R** exchanges the output channels independently of score direction.

These mappings are included in full presets, randomization and Copy settings. Neutral values retain existing sounds.

## Sound engine and modulation

**Sound engine** chooses the primary generator. The adjacent modulation controls transform that generator; they are not a second independent sound source.

| Generator | Modulation choices | Meaning |
| --- | --- | --- |
| Modulation cascade, additive/bell partials, wave partials, generated echo tones | **FM / PM** | Varies oscillator frequency or phase. Echoes labels this Synth modulation because its fully live input follows a separate delay path. |
| Plucked string | **Relative / Absolute** | Scales string-loop length or adds a moving sample offset. |
| Grains and texture Noise + grains | **Speed / Position** | Modulates fragment playback speed or sample-reading position. The texture hybrid choice also selects the corresponding band movement below. |
| Texture Filtered noise / Band oscillators | **Fractal / Orbital** | Correlated multiscale band movement or smooth oscillation with chaotic drift. This is not an oscillator FM/PM switch. |

At 100% microphone input, modulation controls are disabled for Echoes and the Branches Modulation cascade because they affect only those engines’ synthesized material. Their values are retained for use when Input mix is lowered.

## Parameter motion and knob modulators

**Branching, Branch angle, Turns, Root, Mod amount and Source scan** have their own circular Play/Pause button and signed speed slider. One beat advances a full rotation or a complete outward-and-back sweep. Negative speed reverses the movement; zero holds it. Branch angle wraps through 360°, Turns wraps through 0–32, and Source scan wraps through the source. Branching, Root and Mod amount travel back and forth across their ranges. Turns appears in Branches; Source scan appears in Grains and Textures’ Noise + grains engine.

Each parameter’s Pause holds its current value; Play resumes there. These transports run independently of phrase Play and never arm Audio. While Audio is on they follow the audio clock, including during a stalled drawing frame. The Audio-off preview stays silent. Branching prepares bounded scores in a worker; Turns reprojects prepared branch bearings and heights. Neither creates an unbounded tree on the audio thread. Restart resets motion from the current manual anchors. Presets recall their motion switches and speeds, and Copy settings includes the current values.


Branches has a **Branch angle** knob that wraps through 360° indefinitely. Dragging or arrow-key stepping across either boundary continues around the circle. The previous horizontal gesture is retained as **Branch spread**, preserving existing patches at the new angle’s default of zero. Bearings and accumulated branch displacement rotate together; Root, Pitch span and pitch inversion map the resulting height and bearing to each new note.

Two assignable **LFOs** supply Sine, Triangle, Rise and Fall waveforms, **Rate** from 0.01–20 Hz, and **Depth** from 0–100%. They start off in default scenes; supplied presets retain their captured on/off states. A thin moving knob marker and arrow readout show the effective value while the main knob retains its manual setting. Full-depth Rise/Fall gives Branch angle a continuous full-circle turn. Frequency destinations move by ratios; other destinations use their natural units. Two routes to one destination add before clamping.

Destinations include Branch angle, Root, Mod amount, Mod ratio, Stereo width and Stereo delay, plus applicable Echo time, Grain size, Source scan, Band Q and Spectral tilt controls. Choices not used by the selected engine are disabled; an existing inactive assignment is retained and explained until a compatible engine returns. Sweep rate remains a manual control. Oscillator modulation acts on the synthesized part of engines whose microphone paths bypass the carrier.

Modulator phases run on the audio sample clock and continue in their own direction through score Ping-pong. Pause freezes them; Restart resets them; Audio off/on retains them. The Audio-off visual preview never arms audio or the microphone. Branch geometry and score drawing follow the effective angle, while new attacks read the same projection in the worklet without rebuilding the tree. Existing notes retain the pitch selected at their onset. Controls, presets and Copy settings retain modulation configurations, but live clock phases remain transport state.

## Output level

The master controls finished output after the limiter, so turning down changes level without changing saturation or limiting. The internal mix has fixed makeup gains calibrated across the factory bank: Paths and Waves +18 dB; Branches cascade/string +18 dB and bells +6 dB; Grains sample +30 dB, cloud +24 dB and resonant +18 dB; Echoes Shepard/strikes +18 dB and bells +6 dB; Textures noise +6 dB, band oscillators +9 dB and hybrid +24 dB.

These are gain-stage values, not promised loudness increases for every patch: stronger signals meet a stereo-linked limiter at 0.88 (about −1.1 dBFS sample peak). Its 2 ms lookahead, fast attack and 80 ms recovery protect transients without independently shifting the two stereo channels. Quiet phrases and decaying notes are not automatically normalized upward. The gain sits outside synthesis and delay feedback loops, and applies to generated and processed microphone material. Existing tuning, modulation, envelopes, seeds and preset values remain the same. The retained output coloration runs at a fixed drive; the master is pure attenuation after that stage. No true-peak or playback-device SPL guarantee is implied by this sample-peak limit.

## Controls specific to each tab

| Tab | Controls | Consequence |
| --- | --- | --- |
| paths | **Glide:** 0–2 s; **Chaos:** 0–2 | Glide joins successive target frequencies with bends. Chaos adds bounded irregular motion to the geometric path and deepest modulation stage. |
| branches | **Branch angle:** circular 0–360°; **Turns:** circular 0–32; **Generation loss:** 0–1 | Turns curls branch bearings across generations, changing height and pitch. Generation loss removes energy from successive descendants; one leaves only the first generation audible. |
| grains | **Grain size:** 0.005–1.5 s; **Spray:** 0–1; **Source scan:** 0–1 | Grain size establishes the family’s fragment scale. Spray scatters fragments and cluster timing. Scan moves through the source region used for reading. |
| waves | **Partial ratio:** 1.1–3×; **Fold:** 0–6 | Partial ratio stretches the spectrum continuously; two produces octave spacing. Fold changes the folded engine's curve and also shapes enabled live input. The control is relevant to synthesized folding when the folded engine is selected. |
| echoes | **Echo time:** 0.015–3 s; **Echo ratio:** 0.35–2.5×; **Sweep rate:** 0.01–4 octaves/s | Tap `i` uses `Echo time × Echo ratio^i`, bounded at 7.9 seconds. Ratios below one crowd taps together; ratios above one spread them out. Sweep rate moves the wrapped Shepard register. |
| textures | **Band Q:** 0.3–24; **Spectral tilt:** −3–3; **Analysis release:** 0.01–3 s | Q focuses filtered noise and is hidden for Band oscillators, which uses sine bands. Positive tilt favors high bands; negative tilt favors low bands. Analysis release controls the decay of measured live-input energy, while new attacks register quickly; it is disabled without microphone input. Noise + grains also exposes Grain size, Spray and Source scan. |

Echo time and Echo ratio edits crossfade between the old and new delay taps over 35 ms. Rapid edits finish the current fade before taking the latest target, preserving audio already in delay memory. Sweep-rate changes retain the current Shepard register position and change its speed; Root edits also retain the microphone strike carrier phase. These live clocks survive Pause and Audio off/on, while Restart resets them.

At high branching and recursion, the L-system reserves a budget for every remaining generation and samples tips across the frontier. This keeps the first stem and representatives through generation forty-eight while bounding work. It is a finite graphical rewriting system with an artistic sound mapping, not an unbounded biological growth simulation.

## Local sources and optional microphone

Grains and textures can read an original procedural source or a local audio file. Files are decoded on the device; this instrument does not upload them. Files must be below 30 MB. It uses up to twelve seconds or 576,000 mono samples, whichever is shorter. **Built-in source** restores the procedural recording and its measured profile. Source material stays in the session across preset recalls until replaced.

All six tabs offer optional live microphone input directly below **Sound engine**. This group contains the microphone switch, meter, Input mix and Input gain; textures also puts Analysis release here. Local file controls for grains and textures share the same group. Enable Audio, explicitly click **Microphone**, grant access, then use Play to run the processing. Presets and Play never request microphone access. Audio off, microphone off and page teardown release the capture connection; a late permission result after cancellation is discarded. Use headphones when processing live input.

| Tab | Live-input role |
| --- | --- |
| paths | Cascade uses the live waveform and amplitude to modulate its voiced response. Pluck excites a delay string with captured input; additive follows measured band energy. Geometry supplies pitch and timing. |
| branches | Cascade and bell use event-tuned filters, with added modulation in bell. Pluck uses captured input to excite a delay string. The branching score supplies rhythm and frequency. |
| grains | A rolling two-second buffer supplies recent fragments. Scan chooses the look-back region and Spray scatters the reads. |
| waves | The live waveform is folded and modulates the voiced partial family. |
| echoes | Live audio feeds the delay network. Shepard uses moving reads for register motion; strikes articulates the excitation; resonant uses the ringing response. |
| textures | Sixteen live bands and an amplitude follower control new noise or pitched-band material. Hybrid also reads fragments of the recent input. |

In textures, the common modulation knobs are labeled **Band spacing** and **Band motion**. Filtered noise and Band oscillators expose **Fractal / Orbital** band movement. Noise + grains exposes **Speed / Position** grain modulation, which also selects the corresponding band movement.

**Input mix** ranges from zero to one and blends the microphone response with the generated or loaded-source response. **Input gain** ranges from zero to four and acts on the microphone before processing. Neither control enables the device, changes master output level, nor changes the loaded file itself. With microphone input disabled, the instrument uses its generated or local-source material. Static file profiles are unchanged by Analysis release; that control follows live energy with a fast attack and an adjustable decay.

MIDI note-on retunes Root through the shared MIDI input setting, while the generated frequency relationships remain continuous. Canvas arrows belong to the gesture controls. The instrument does not generate MIDI output.

## Implementation and boundaries

Runtime modules remain under `src/instruments/fractal-signals/`. State, geometry, presets and local-file analysis are pure modules. An AudioWorklet runs synthesis and musical scheduling on the sample clock; the display follows its phase telemetry rather than driving the audio clock.

The model allows at most 768 geometry points and 384 score events. DSP uses a pool of 32 voices, with a smaller eight-voice budget for expensive waves and additive paths, sixteen texture bands and up to forty-eight wave/additive partials and geometric delay taps. Above 24 levels, wave and additive voices share a 192-partial work budget: six voices at 32 levels, four at 48. Live depth increases retire excess quiet voices through short tails. Shepard uses a separate twelve-slot oscillator bank. Trigger admission uses a 480-attacks-per-second refill and a sixteen-attack burst allowance. At a Ping-pong turn, the outermost endpoint note can borrow one attack; that debt is repaid before more ordinary attacks are admitted. Simultaneous endpoint groups still share the voice and attack limits. Dense clusters may omit lower-priority attacks, and overlapping voices may retire quieter or older notes. Delay storage spans eight seconds; the principal taps stop at 7.9 seconds. Parameters, feedback and final output are bounded, and live changes are smoothed. Rendering runs at approximately thirty frames per second with capped pixel density.

The noise model retains its first 24 binary octaves, then uses independent seeded layers at the finest retained scale to avoid numerical collapse. True tree generations, partial capacities and tap capacities extend to 48. Grain roughness above 1.8 also changes fine placement and timing. The multiscale noise is a bounded approximation, not an exact fractional Brownian process. Wave partials are frequency-limited; the folded engine uses a two-pass oversampling approximation and does not claim exact bandlimiting. The displayed wave is a representative source curve, not an output oscilloscope. With noninteger Partial ratio, the illustrated interval need not close into one periodic cycle. Shepard layering and the feedback delay network are separate mechanisms used together. Texture analysis measures a coarse spectral profile and envelope, not the physical identity of the source. Chaotic modulation is a bounded expressive numerical model. Graphics and built-in source audio are generated by this implementation; no external recordings or raster artwork are required.

## Verification status

Focused model tests cover finite bounds, deterministic scores, gesture and mode-specific consequences, left-to-right generations through the expanded depth range, forty-nine complete presets, all-field randomization, spectral discrimination, and paths register/rest distinctions. Dedicated tests cover the shared draggable ADSR adapter, wider recursion and branching, geometry/stereo mappings, and Loop/Ping-pong endpoint and tail behavior. Prior-range structures and rendered audio were compared against the earlier implementation to check neutral-setting continuity.

DSP and browser checks exercise rendered samples, envelope and engine consequences, input isolation, audio/transport lifecycle, live recall, responsive controls and scheduling through main-thread stalls. Their current run results belong in the implementation handoff; test presence alone does not establish that a browser or device pass has completed.

Validation for this revision is automated. Listening on physical speakers or headphones, microphone feel, physical touch controls and hardware MIDI remain unperformed human checks. Signal measurements and green tests do not establish musical quality or preferred timbre.
