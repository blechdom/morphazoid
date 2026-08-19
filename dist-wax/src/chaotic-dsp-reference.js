const ARCHIVE_ROOT = "https://github.com/blechdom/recursive-sound/blob/main/public/images";

const node = (title, detail, tone = "signal") => Object.freeze({
  title,
  detail,
  tone,
});

const sequence = (label, nodes) => Object.freeze({
  type: "sequence",
  label,
  nodes: Object.freeze(nodes),
});

const branches = (label, lanes) => Object.freeze({
  type: "branches",
  label,
  lanes: Object.freeze(lanes.map((lane) => Object.freeze({
    label: lane.label,
    nodes: Object.freeze(lane.nodes),
  }))),
});

const diagram = (title, formula, ariaLabel, sections) => Object.freeze({
  title,
  formula,
  ariaLabel,
  sections: Object.freeze(sections),
});

export const CHAOTIC_DSP_REFERENCES = Object.freeze([
  Object.freeze({
    id: "recursive-fm",
    label: "Recursive FM",
    engine: "Native Web Audio",
    topology: "12 preallocated sine oscillators",
    archive: Object.freeze({
      label: "Archived 2023 flowchart - comparison only",
      href: `${ARCHIVE_ROOT}/recursiveFM.png`,
    }),
    algorithm: diagram(
      "Algorithm flow",
      "cycle(offset + M/2 + carrier x M/2) -> cycle(previous x A[n])",
      "Recursive FM algorithm. A carrier sine sets an entry oscillator frequency, then each selected sine recursively sets the next oscillator frequency with a divided modulation amount.",
      [
        sequence("Frequency recursion", [
          node("Carrier oscillator", "carrier = sin(phase(carrierHz))", "oscillator"),
          node("Entry frequency", "offset + M/2 + carrier x M/2", "control"),
          node("Entry oscillator", "sin(integral(entryHz))", "oscillator"),
          node("Recursive amount", "A[1] = M/2; A[n+1] = A[n] / divisor", "control"),
          node("Recursive operator", "sin(integral(previous x A[n]))", "oscillator"),
          node("Depth selection", "Only the requested final operator is audible", "output"),
        ]),
      ],
    ),
    audio: diagram(
      "DSP / audio path",
      "OscillatorNode graph -> dynamics -> shared output",
      "Recursive FM audio path. A preallocated native oscillator graph passes through a crossfaded output tap, normalization, performance articulation, dynamics, analysis, and the shared audio output manager.",
      [
        sequence("Rendered signal", [
          node("Native operator graph", "12 OscillatorNodes; source GainNode -> next frequency", "oscillator"),
          node("Output tap switch", "8 ms crossfade when recursion depth changes", "mix"),
          node("Graph normalization", "Depth and frequency-pressure trim", "guard"),
          node("Performance", "ADSR, velocity, expression, note glide and bend", "control"),
          node("Master gain", "Smoothed output level", "mix"),
          node("Dynamics compressor", "Fast protective compression", "guard"),
          node("Ceiling GainNode", "Fixed 0.82 post-compressor gain", "guard"),
          node("Analyser", "2048-point FFT; 512-sample scope window", "signal"),
          node("Audio output", "Shared output manager", "output"),
        ]),
      ],
    ),
  }),
  Object.freeze({
    id: "recursive-pm",
    label: "Recursive PM",
    engine: "AudioWorklet",
    topology: "1 carrier + 10 recursive phase operators",
    archive: Object.freeze({
      label: "Archived 2023 flowchart - comparison only",
      href: `${ARCHIVE_ROOT}/recursivePM.png`,
    }),
    algorithm: diagram(
      "Algorithm flow",
      "signal[n] = sin(2pi x (phasor[n] + signal[n-1] x I[n]))",
      "Recursive PM algorithm. Independent phasors are phase displaced by the previous sine, with frequency and phase index divided at every recursive turn.",
      [
        sequence("Phase recursion", [
          node("Carrier phasor", "phase += carrierHz / sampleRate", "control"),
          node("Carrier sine", "signal[0] = sin(2pi x phase)", "oscillator"),
          node("Turn frequency", "f[n] = startFrequency / frequencyDivisor^(n-1)", "control"),
          node("Turn index", "I[n] = startIndex / indexDivisor^(n-1); max 64", "guard"),
          node("Phase operator", "sin(2pi x (phasor[n] + previous x I[n]))", "oscillator"),
          node("Bounded repeat", "Up to 10 turns; stop at the render ceiling", "guard"),
          node("Depth interpolation", "Crossfade adjacent operator outputs", "output"),
        ]),
      ],
    ),
    audio: diagram(
      "DSP / audio path",
      "Persistent-phase worklet -> articulation -> dynamics -> shared output",
      "Recursive PM audio path. A zero-allocation AudioWorklet with persistent phases passes through normalization, articulation, velocity, master gain, protection, analysis, and the shared output manager.",
      [
        sequence("Rendered signal", [
          node("AudioWorklet", "Persistent phases; per-sample parameter smoothing", "oscillator"),
          node("Graph normalization", "Depth and phase-pressure trim", "guard"),
          node("ADSR articulation", "Drone bypass or MIDI gate envelope", "control"),
          node("Velocity gain", "Note velocity before master output", "control"),
          node("Master gain", "Expression and smoothed output level", "mix"),
          node("Dynamics compressor", "Fast protective compression", "guard"),
          node("Ceiling GainNode", "Fixed 0.82 post-compressor gain", "guard"),
          node("Analyser", "2048-point FFT; 512-sample scope window", "signal"),
          node("Audio output", "Shared output manager", "output"),
        ]),
      ],
    ),
  }),
  Object.freeze({
    id: "chaotic-fm",
    label: "Chaotic FM",
    engine: "AudioWorklet",
    topology: "Entry oscillator + 10 nonlinear frequency turns",
    algorithm: diagram(
      "Algorithm flow",
      "f[n] = nonlinearityHz x tanh(previous x A[n])",
      "Chaotic FM algorithm. A carrier creates the entry frequency, then a bounded hyperbolic tangent maps every previous sine into the next signed oscillator frequency.",
      [
        sequence("Nonlinear frequency recursion", [
          node("Carrier sine", "sin(phase(carrierHz))", "oscillator"),
          node("Entry frequency", "offset + amount/2 + carrier x amount/2", "control"),
          node("Entry oscillator", "Integrate signed Hz, then sine", "oscillator"),
          node("Recursive drive", "clamp(previous x A[n], -64, +64)", "guard"),
          node("Nonlinear rate", "nonlinearityHz x tanh(drive)", "nonlinear"),
          node("Signed-rate guard", "+/- min(20 kHz, 0.45 x sampleRate)", "guard"),
          node("Next oscillator", "Integrate signed rate, then sine", "oscillator"),
          node("Bounded repeat", "A[n+1] = A[n] / divisor; up to 10 turns", "control"),
          node("Depth tap mix", "Smooth one-hot gains select the audible turn", "output"),
        ]),
      ],
    ),
    audio: diagram(
      "DSP / audio path",
      "Nonlinear worklet -> DC block -> compressor -> soft ceiling",
      "Chaotic FM audio path. The synthesis and MIDI articulation run inside one AudioWorklet before DC removal, compression, a two-times oversampled soft ceiling, master gain, analysis, and shared output.",
      [
        sequence("Rendered signal", [
          node("AudioWorklet", "Persistent phases, parameter slew, ADSR and expression", "oscillator"),
          node("Depth crossfade", "Smoothed tap gains inside the sample loop", "mix"),
          node("DC blocker", "18 Hz high-pass; Q 0.707", "guard"),
          node("Dynamics compressor", "Threshold -15 dB; ratio 10:1", "guard"),
          node("Soft ceiling", "WaveShaper with 2x oversampling", "nonlinear"),
          node("Master gain", "35 ms start/stop ramp", "mix"),
          node("Analyser", "2048-point FFT; 512-sample scope window", "signal"),
          node("Audio output", "Shared output manager", "output"),
        ]),
      ],
    ),
  }),
  Object.freeze({
    id: "chaotic-pm",
    label: "Chaotic PM",
    engine: "AudioWorklet",
    topology: "Parallel Smooth and Legacy/Raw phase banks",
    algorithm: diagram(
      "Algorithm flow",
      "Both transfer banks render continuously, then crossfade",
      "Chaotic PM algorithm. Each turn computes a continuous periodic Smooth phase operator and the preserved signed-remainder Legacy Raw operator in parallel, then crossfades the selected transfer and recursion depth.",
      [
        sequence("Shared turn inputs", [
          node("Previous sine", "The preceding operator output", "oscillator"),
          node("Independent phasor", "f[n] = startFrequency / frequencyDivisor^(n-1)", "control"),
          node("Divided index", "I[n] = startIndex / indexDivisor^(n-1)", "control"),
        ]),
        branches("Transfer branches", [
          {
            label: "Smooth",
            nodes: [
              node("Normalized tanh", "tanh(previous x drive) / tanh(drive)", "nonlinear"),
              node("Chaos morph", "mix(previous, shaped, chaos)", "mix"),
              node("Periodic PM sine", "sin(2pi x phasor + I[radians] x modulator)", "oscillator"),
            ],
          },
          {
            label: "Legacy / Raw",
            nodes: [
              node("Signed remainder", "r = (phasor + previous x I[cycles]) % 1", "nonlinear"),
              node("Frequency-squared drive", "clamp(r x warp x f^2, -64, +64)", "guard"),
              node("Warped sine", "sin(2pi x tanh(drive) x (1.2 - sqrt(warp)))", "oscillator"),
            ],
          },
        ]),
        sequence("Selection", [
          node("Transfer crossfade", "Smooth and Legacy banks remain phase-continuous", "mix"),
          node("Depth crossfade", "Smoothed one-hot taps select up to 10 turns", "output"),
        ]),
      ],
    ),
    audio: diagram(
      "DSP / audio path",
      "Dual-transfer worklet -> normalized protected output",
      "Chaotic PM audio path. A zero-allocation dual-transfer AudioWorklet passes through an 18 hertz DC blocker, graph normalization, compression, a two-times oversampled soft ceiling, master gain, analysis, and shared output.",
      [
        sequence("Rendered signal", [
          node("AudioWorklet", "Both transfer banks, persistent phases, MIDI envelope", "oscillator"),
          node("DC blocker", "18 Hz high-pass; Q 0.707", "guard"),
          node("Graph normalization", "Depth, drive and discontinuity-pressure trim", "guard"),
          node("Dynamics compressor", "Threshold -16 dB; ratio 10:1", "guard"),
          node("Soft ceiling", "WaveShaper with 2x oversampling", "nonlinear"),
          node("Master gain", "Smoothed output level", "mix"),
          node("Analyser", "2048-point FFT; 512-sample scope window", "signal"),
          node("Audio output", "Shared output manager", "output"),
        ]),
      ],
    ),
  }),
  Object.freeze({
    id: "cascading-fm",
    label: "Cascading FM",
    engine: "Native Web Audio",
    topology: "2-12 feed-forward sine oscillators",
    algorithm: diagram(
      "Algorithm flow",
      "osc[i] x D[i] -> osc[i+1].frequency",
      "Cascading FM algorithm. Base frequencies follow a geometric series, modulation depths follow an independent taper, and each sine drives the next native oscillator frequency input.",
      [
        sequence("Frequency cascade", [
          node("Frequency ledger", "f[i] = min(root x ratio^i, 20 kHz)", "control"),
          node("Depth ledger", "D[i] = modDepth x depthTaper^i", "control"),
          node("Stage 0 sine", "OscillatorNode at f[0]", "oscillator"),
          node("FM hand-off", "stage[i] x D[i] -> stage[i+1].frequency", "mix"),
          node("Next stage sine", "OscillatorNode at base f[i+1]", "oscillator"),
          node("Bounded repeat", "Continue through 2-12 stages", "guard"),
          node("Final-stage tap", "Only stage[count - 1] reaches the mix bus", "output"),
        ]),
      ],
    ),
    audio: diagram(
      "DSP / audio path",
      "Preallocated OscillatorNodes -> selected tap -> protected output",
      "Cascading FM audio path. Twelve native oscillators and their modulation links are preallocated, while smoothed gains activate the requested chain and route only its final stage through normalization and the output chain.",
      [
        sequence("Rendered signal", [
          node("Native FM graph", "12 preallocated OscillatorNodes and 11 modulation gains", "oscillator"),
          node("Active links", "Smoothed AudioParams gate unused connections", "control"),
          node("Output tap switch", "8 ms crossfade to the selected final stage", "mix"),
          node("Normalization", "clamp(1 / sqrt(stages), 0.25, 1)", "guard"),
          node("Master gain", "Smoothed output level", "mix"),
          node("Dynamics compressor", "Fast protective compression", "guard"),
          node("Ceiling GainNode", "Fixed 0.82 post-compressor gain", "guard"),
          node("Analyser", "2048-point FFT; 512-sample scope window", "signal"),
          node("Audio output", "Shared output manager", "output"),
        ]),
      ],
    ),
  }),
  Object.freeze({
    id: "cascading-pm",
    label: "Cascading PM",
    engine: "AudioWorklet",
    topology: "2-12 feed-forward phase operators",
    algorithm: diagram(
      "Algorithm flow",
      "signal[i] = sin(phase[i] + signal[i-1] x I[i-1])",
      "Cascading PM algorithm. Every stage advances an independent base phase and receives the preceding sine as a bandwidth-guarded phase displacement in radians.",
      [
        sequence("Phase cascade", [
          node("Frequency ledger", "f[i] = root x ratio^i; base rate capped at 0.4 x sampleRate", "control"),
          node("Independent phases", "phase[i] += 2pi x f[i] / sampleRate", "oscillator"),
          node("Seed sine", "signal[0] = sin(phase[0])", "oscillator"),
          node("Index ledger", "I[i] = phaseIndex x indexTaper^i", "control"),
          node("Bandwidth guard", "Reduce I only when inherited PM exceeds 0.45 x sampleRate", "guard"),
          node("Phase hand-off", "signal[i] = sin(phase[i] + previous x I[i-1])", "oscillator"),
          node("Bounded repeat", "Continue through 2-12 stages", "guard"),
          node("Final-stage tap", "Crossfade to stage[count - 1]", "output"),
        ]),
      ],
    ),
    audio: diagram(
      "DSP / audio path",
      "Persistent-phase worklet -> normalized protected output",
      "Cascading PM audio path. A zero-allocation AudioWorklet keeps twelve phase accumulators and smoothed output taps, then sends the selected stage through normalization and the shared output chain.",
      [
        sequence("Rendered signal", [
          node("AudioWorklet", "12 persistent phases; no allocation in process()", "oscillator"),
          node("Parameter smoothing", "Frequencies and phase indices slew per sample", "control"),
          node("Output crossfade", "Tap vectors interpolate when stage count changes", "mix"),
          node("Output clamp", "Final worklet sample bounded to [-1, +1]", "guard"),
          node("Graph normalization", "Phase-pressure trim", "guard"),
          node("Master gain", "Smoothed output level", "mix"),
          node("Dynamics compressor", "Fast protective compression", "guard"),
          node("Ceiling GainNode", "Fixed 0.82 post-compressor gain", "guard"),
          node("Analyser", "2048-point FFT; 512-sample scope window", "signal"),
          node("Audio output", "Shared output manager", "output"),
        ]),
      ],
    ),
  }),
  Object.freeze({
    id: "weierstrass",
    label: "Weierstrass",
    engine: "AudioWorklet",
    topology: "48-term bank with Wave, FM and PM branches",
    algorithm: diagram(
      "Algorithm flow",
      "W(t) = sum(a^n x taper x cos(2pi x base x b^n x t)) / sum(abs(weight))",
      "Weierstrass algorithm. A tapered and normalized cosine bank produces W of t, then Wave, frequency modulation, and wrapped phase modulation branches render in parallel before a smooth mode crossfade.",
      [
        sequence("Shared Weierstrass bank", [
          node("Exponent", "n = startExponent + termIndex", "control"),
          node("Term frequency", "f[n] = baseFrequency x b^n", "control"),
          node("Anti-alias taper", "Smooth fade near ceiling; cull at or above it", "guard"),
          node("Term weight", "w[n] = a^n x taper(f[n])", "control"),
          node("Cosine partial", "cos(phase[n]) x w[n]", "oscillator"),
          node("Normalized bank", "W = sum(partials) / sum(abs(w[n]))", "mix"),
        ]),
        branches("Mode branches", [
          {
            label: "Wave",
            nodes: [
              node("Direct bank", "W(t)", "output"),
            ],
          },
          {
            label: "FM",
            nodes: [
              node("Instantaneous Hz", "clamp(offset + W x effectiveDepth, +/- ceiling)", "guard"),
              node("FM oscillator", "Integrate signed Hz, then sine", "oscillator"),
            ],
          },
          {
            label: "PM",
            nodes: [
              node("Phase cycles", "W x bankGain x bankScale + sin(carrier) x index", "mix"),
              node("Wrapped PM sine", "sin(2pi x fractional(phaseCycles))", "oscillator"),
            ],
          },
        ]),
        sequence("Selection", [
          node("Mode crossfade", "Wave, FM and PM remain live during transitions", "output"),
        ]),
      ],
    ),
    audio: diagram(
      "DSP / audio path",
      "Smoothed partial bank -> mode mix -> protected output",
      "Weierstrass audio path. One AudioWorklet maintains a fixed forty-eight-term bank and all three mode branches before DC removal, compression, a two-times oversampled ceiling, master gain, analysis, and shared output.",
      [
        sequence("Rendered signal", [
          node("AudioWorklet bank", "48 phase slots with frequency and weight slew", "oscillator"),
          node("Mode mixer", "Smoothed Wave/FM mix, then PM mix", "mix"),
          node("Internal trim", "Mode signal x active ramp x 0.48", "guard"),
          node("DC blocker", "18 Hz high-pass; Q 0.707", "guard"),
          node("Dynamics compressor", "Threshold -15 dB; ratio 9:1", "guard"),
          node("Soft ceiling", "WaveShaper with 2x oversampling", "nonlinear"),
          node("Master gain", "Smoothed output level", "mix"),
          node("Analyser", "512-point analysis buffer", "signal"),
          node("Audio output", "Shared output manager", "output"),
        ]),
      ],
    ),
  }),
]);

export const CHAOTIC_DSP_REFERENCE_IDS = Object.freeze(
  CHAOTIC_DSP_REFERENCES.map(({ id }) => id),
);

export function chaoticDspReferenceForId(id) {
  return CHAOTIC_DSP_REFERENCES.find((reference) => reference.id === id) ?? null;
}

function appendTextElement(documentObject, parent, tagName, className, text) {
  const element = documentObject.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderSequence(documentObject, sequenceDefinition, compact = false) {
  const lane = documentObject.createElement("section");
  lane.className = "chaos-dsp-lane";
  if (sequenceDefinition.label) {
    appendTextElement(
      documentObject,
      lane,
      "h4",
      "chaos-dsp-lane-title",
      sequenceDefinition.label,
    );
  }

  const list = documentObject.createElement("ol");
  list.className = compact
    ? "chaos-dsp-sequence is-compact"
    : "chaos-dsp-sequence";
  for (const step of sequenceDefinition.nodes) {
    const item = documentObject.createElement("li");
    item.className = `chaos-dsp-step is-${step.tone}`;
    appendTextElement(documentObject, item, "b", "chaos-dsp-step-title", step.title);
    appendTextElement(documentObject, item, "code", "chaos-dsp-step-detail", step.detail);
    list.append(item);
  }
  lane.append(list);
  return lane;
}

function renderDiagram(documentObject, synthId, definition, kind) {
  const figure = documentObject.createElement("figure");
  figure.className = `chaos-dsp-figure is-${kind}`;

  const captionId = `${synthId}Dsp${kind === "algorithm" ? "Algorithm" : "Audio"}Title`;
  const caption = documentObject.createElement("figcaption");
  appendTextElement(documentObject, caption, "b", null, definition.title).id = captionId;
  appendTextElement(documentObject, caption, "code", null, definition.formula);
  figure.append(caption);

  const drawing = documentObject.createElement("div");
  drawing.className = "chaos-dsp-drawing";
  drawing.setAttribute("role", "img");
  drawing.setAttribute("aria-label", definition.ariaLabel);

  definition.sections.forEach((sectionDefinition, index) => {
    if (index > 0) {
      const connector = documentObject.createElement("span");
      connector.className = "chaos-dsp-section-connector";
      connector.setAttribute("aria-hidden", "true");
      drawing.append(connector);
    }

    if (sectionDefinition.type === "branches") {
      const group = documentObject.createElement("section");
      group.className = "chaos-dsp-branch-section";
      appendTextElement(
        documentObject,
        group,
        "h4",
        "chaos-dsp-lane-title",
        sectionDefinition.label,
      );
      const branchGrid = documentObject.createElement("div");
      branchGrid.className = "chaos-dsp-branches";
      for (const lane of sectionDefinition.lanes) {
        branchGrid.append(renderSequence(documentObject, lane, true));
      }
      group.append(branchGrid);
      drawing.append(group);
      return;
    }

    drawing.append(renderSequence(documentObject, sectionDefinition, kind === "audio"));
  });

  figure.append(drawing);
  return figure;
}

export function renderChaoticDspReference(root, reference, documentObject = globalThis.document) {
  if (!root || !reference || !documentObject?.createElement) return false;
  const body = root.querySelector?.("[data-chaos-dsp-reference-body]");
  if (!body) return false;

  body.replaceChildren();
  const meta = documentObject.createElement("div");
  meta.className = "chaos-dsp-reference-meta";
  appendTextElement(documentObject, meta, "span", "chaos-dsp-engine", reference.engine);
  appendTextElement(documentObject, meta, "span", "chaos-dsp-topology", reference.topology);
  if (!root.hasAttribute?.("data-chaos-dsp-full-page")) {
    const fullPageLink = appendTextElement(
      documentObject,
      meta,
      "a",
      "chaos-dsp-full-page-link",
      "Open full diagram",
    );
    fullPageLink.href = `chaotic-dsp-reference.html?synth=${encodeURIComponent(reference.id)}`;
  }
  body.append(meta);
  body.append(renderDiagram(documentObject, reference.id, reference.algorithm, "algorithm"));
  body.append(renderDiagram(documentObject, reference.id, reference.audio, "audio"));

  if (reference.archive) {
    const archive = appendTextElement(
      documentObject,
      body,
      "a",
      "chaos-dsp-archive-link",
      reference.archive.label,
    );
    archive.href = reference.archive.href;
    archive.target = "_blank";
    archive.rel = "noreferrer noopener";
  }

  root.dataset.chaosDspReferenceReady = "true";
  const windowObject = documentObject.defaultView ?? globalThis;
  const locationObject = windowObject.location;
  if (root.id && locationObject?.hash === `#${root.id}`) {
    root.open = true;
    windowObject.requestAnimationFrame?.(
      () => root.scrollIntoView?.({ block: "start" }),
    );
  }
  return true;
}

export function renderChaoticDspReferences(documentObject = globalThis.document) {
  if (!documentObject?.querySelectorAll) return 0;
  let rendered = 0;
  for (const root of documentObject.querySelectorAll("[data-chaos-dsp-reference]")) {
    const reference = chaoticDspReferenceForId(root.dataset.chaosDspReference);
    if (renderChaoticDspReference(root, reference, documentObject)) rendered += 1;
  }
  return rendered;
}

if (typeof document !== "undefined") renderChaoticDspReferences(document);
