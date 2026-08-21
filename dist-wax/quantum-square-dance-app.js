import { VoicePool } from "./src/audio.js";
import { emitMidiOutputPreview } from "./src/midi-output-preview.js";
import {
  DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS,
  DEFAULT_SQUARE_DANCE_SETTINGS,
  PHYSICAL_EXCHANGE_CYCLE_SECONDS,
  deriveSquareDanceSound,
  sampleSquareDance,
  simulateSquareDance,
  squareDanceCall,
  timeLensDiagnostics,
} from "./src/quantum-square-dance.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const MIDI_ROUTE_ID = "quantum-square-dance";
const DRAW_INTERVAL_MS = 1_000 / 30;
const MIDI_FRAME_INTERVAL_MS = 50;
const MANUAL_AUDITION_INTERVAL_MS = 72;
const MAX_ENSEMBLE_AUDIO_LAYERS = 4;
const COLORS = Object.freeze({
  amber: "#ffc86b",
  blue: "#77baff",
  coral: "#ff8d79",
  mint: "#74f0c3",
  orchid: "#c49bff",
  cream: "#fff3d6",
  ink: "#07090b",
});
const DEFAULTS = Object.freeze({
  ...DEFAULT_SQUARE_DANCE_SETTINGS,
  preparation: "01",
  scene: "one-pair",
  phaseDegrees: 0,
  cycleDuration: 2.4,
  coherence: 1,
  pairCount: 1,
  rootFrequency: 219.3,
  contourRange: 12,
  phraseDensity: 6,
  spectralColor: 0.58,
  level: 0.46,
});

const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const voices = new VoicePool(4);

const state = {
  ...DEFAULTS,
  playing: false,
  audioOn: false,
  audioStarting: false,
  clockTurns: 0,
  sampleSerial: 0,
  lastMeasurement: null,
  lastShots: null,
  lastEventLabel: "prepared",
  flashUntil: 0,
};

let simulation = calculateSimulation();
let sound = calculateSound();
let frameId = null;
let lastFrameTime = performance.now();
let lastDrawTime = -Infinity;
let lastUiTime = -Infinity;
let lastMidiTime = -Infinity;
let lastStepSerial = null;
let lastManualAudition = -Infinity;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let visualizationDirty = true;
let pageActive = true;
let disposed = false;
let audioRequest = 0;
let pointerScrub = null;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function wrap(value, modulus) {
  const result = value % modulus;
  return result < 0 ? result + modulus : result;
}

function percentage(value, digits = 1) {
  return (clamp(value, 0, 1) * 100).toFixed(digits) + "%";
}

function signed(value, digits = 3) {
  const numeric = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return (numeric >= 0 ? "+" : "") + numeric.toFixed(digits);
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function setText(elementOrId, text) {
  const element = typeof elementOrId === "string" ? $(elementOrId) : elementOrId;
  const next = String(text ?? "");
  if (element && element.textContent !== next) element.textContent = next;
}

function phaseRadians() {
  return state.phaseDegrees * Math.PI / 180;
}

function preparationForCore() {
  const values = {
    "01": "up-down",
    "10": "down-up",
    "00": "up-up",
    "11": "down-down",
  };
  return values[state.preparation] ?? state.preparation ?? "up-down";
}

function calculateSimulation() {
  return simulateSquareDance({
    preparation: preparationForCore(),
    exchangeAngle: phaseRadians(),
    visibility: state.coherence,
  });
}

function calculateSound() {
  return deriveSquareDanceSound(simulation, {
    ...DEFAULT_SQUARE_DANCE_MUSICAL_SETTINGS,
    musicalCycleSeconds: state.cycleDuration,
    rootMidi: 69 + 12 * Math.log2(state.rootFrequency / 440),
    contourSemitones: state.contourRange,
    subdivisions: state.phraseDensity,
    level: 0.72,
  });
}

function probabilities() {
  const array = simulation.probabilities ?? simulation.basisProbabilities ?? [0, 1, 0, 0];
  const preparation = preparationForCore();
  if (preparation === "up-down") return { stay: array[1] ?? 0, swap: array[2] ?? 0 };
  if (preparation === "down-up") return { stay: array[2] ?? 0, swap: array[1] ?? 0 };
  return { stay: 1, swap: 0 };
}

function localPurities() {
  const value = simulation.reducedPurity ?? simulation.localPurity ?? 1;
  if (Array.isArray(value)) return [value[0] ?? 1, value[1] ?? value[0] ?? 1];
  if (value && typeof value === "object") {
    return [
      value.excited ?? value.first ?? value.left ?? value.alice ?? 1,
      value.ground ?? value.second ?? value.right ?? value.bob ?? 1,
    ];
  }
  return [Number(value) || 0, Number(value) || 0];
}

function jointPurity() {
  return Number(simulation.jointPurity ?? simulation.globalPurity ?? simulation.purity ?? 1);
}

function entanglementOfFormation() {
  return Number(simulation.entanglementOfFormation ?? simulation.entanglement ?? 0);
}

function xyWitness() {
  return Number(
    simulation.observables?.xyMinusYxHalf
      ?? simulation.observables?.xy
      ?? simulation.xyCoherence
      ?? 0,
  );
}

function isExchangeActive() {
  return preparationForCore() === "up-down" || preparationForCore() === "down-up";
}

function representedPairCount() {
  return state.scene === "whole-floor" ? Math.round(clamp(state.pairCount, 1, 32)) : 1;
}

function renderedPairCount() {
  return Math.min(representedPairCount(), MAX_ENSEMBLE_AUDIO_LAYERS);
}

function phaseLabel(degrees = state.phaseDegrees, includeDegrees = true) {
  const source = Number(degrees) || 0;
  const returned = source > 0 && Math.abs(source % 360) < 0.001;
  const normalized = returned ? 360 : wrap(source, 360);
  const landmarks = [
    [0, "0"],
    [90, "π/2"],
    [180, "π"],
    [270, "3π/2"],
    [360, "2π"],
  ];
  let symbol = (normalized / 180).toFixed(2).replace(/\.00$/, "") + "π";
  for (const [angle, label] of landmarks) {
    if (Math.abs(normalized - angle) < 0.25) symbol = label;
  }
  return includeDegrees ? symbol + " · " + normalized.toFixed(1) + "°" : symbol;
}

function stateBasisLabels() {
  const preparation = preparationForCore();
  if (preparation === "up-down") return { stay: "|↑ₑ↓ᵍ⟩", swap: "|↓ₑ↑ᵍ⟩", stayIndex: 1, swapIndex: 2 };
  if (preparation === "down-up") return { stay: "|↓ₑ↑ᵍ⟩", swap: "|↑ₑ↓ᵍ⟩", stayIndex: 2, swapIndex: 1 };
  if (preparation === "up-up") return { stay: "|↑ₑ↑ᵍ⟩", swap: null, stayIndex: 0, swapIndex: null };
  return { stay: "|↓ₑ↓ᵍ⟩", swap: null, stayIndex: 3, swapIndex: null };
}

function signedAmplitude(value) {
  const re = Math.abs(value?.re ?? 0) < 0.0005 ? 0 : value.re;
  const im = Math.abs(value?.im ?? 0) < 0.0005 ? 0 : value.im;
  if (im === 0) return { negative: re < 0, body: Math.abs(re).toFixed(3) };
  if (re === 0) return { negative: im < 0, body: Math.abs(im).toFixed(3) + "i" };
  return {
    negative: false,
    body: "(" + re.toFixed(3) + (im < 0 ? " − " : " + ") + Math.abs(im).toFixed(3) + "i)",
  };
}

function appendStateTerm(expression, amplitude, basis) {
  const coefficient = signedAmplitude(amplitude);
  if ((Math.abs(amplitude?.re ?? 0) + Math.abs(amplitude?.im ?? 0)) < 0.0005) return expression;
  if (!expression) return (coefficient.negative ? "−" : "") + coefficient.body + basis;
  return expression + (coefficient.negative ? " − " : " + ") + coefficient.body + basis;
}

function stateDescriptionText() {
  const labels = stateBasisLabels();
  const { stay, swap } = probabilities();
  const hasTwoPaths = labels.swap && stay > 0.0001 && swap > 0.0001;
  if (hasTwoPaths && state.coherence < 0.9995) {
    return "ρ mixed · " + labels.stay + " " + stay.toFixed(3) + " · "
      + labels.swap + " " + swap.toFixed(3) + " · |ρₛ𝓌| "
      + simulation.coherence.magnitude.toFixed(3);
  }
  let expression = appendStateTerm("", simulation.state[labels.stayIndex], labels.stay);
  if (labels.swap) expression = appendStateTerm(expression, simulation.state[labels.swapIndex], labels.swap);
  return "|ψ⟩ = " + expression + (labels.swap ? "" : " · aligned exchange eigenstate");
}

function relativePhaseText() {
  const labels = stateBasisLabels();
  const { stay, swap } = probabilities();
  if (!labels.swap || stay <= 0.0001 || swap <= 0.0001) return "not observable at one-path endpoint";
  if (simulation.coherence.magnitude <= 0.0001) return "erased by dephasing · populations remain";
  const stayAmplitude = simulation.state[labels.stayIndex];
  const swapAmplitude = simulation.state[labels.swapIndex];
  let relative = Math.atan2(swapAmplitude.im, swapAmplitude.re)
    - Math.atan2(stayAmplitude.im, stayAmplitude.re);
  while (relative <= -Math.PI) relative += TAU;
  while (relative > Math.PI) relative -= TAU;
  const quarterTurns = relative / (Math.PI / 2);
  const label = Math.abs(Math.abs(quarterTurns) - 1) < 0.001
    ? (quarterTurns < 0 ? "−π/2" : "+π/2")
    : signed(relative / Math.PI, 2) + "π";
  return label + " · coherent visibility " + percentage(state.coherence, 0);
}

function entanglementLabel() {
  if (!isExchangeActive() || simulation.concurrence < 0.001) return "separable";
  if (simulation.concurrence > 0.999) return "maximally entangled";
  return "partly entangled";
}

function sceneLabel() {
  if (state.scene === "hold-half-swap") return "hold √SWAP";
  if (state.scene === "whole-floor") return "whole floor";
  return "one pair";
}

function currentCall() {
  const call = squareDanceCall(simulation);
  if (typeof call === "string") return { label: call, description: call };
  return call ?? { label: "EXCHANGE", description: "Coherent spin exchange." };
}

function shotSummary(result) {
  if (!result) return "no shots yet";
  const counts = result.counts ?? {};
  const labels = ["00", "01", "10", "11"];
  const text = labels.filter((label) => (counts[label] ?? 0) > 0)
    .map((label) => label + " " + counts[label])
    .join(" · ");
  return text || "no detected outcomes";
}

function announce(message) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => {
    if (!disposed && pageActive) live.textContent = message;
  });
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  setText("audioError", message);
  $("audioError").hidden = false;
  announce("Audio error: " + message);
}

function clearAudioError() {
  setText("audioError", "");
  $("audioError").hidden = true;
}

function publishPreview(detail) {
  return emitMidiOutputPreview({ ...detail, routeId: MIDI_ROUTE_ID });
}

function publishTransportPreview() {
  publishPreview({
    kind: "transport",
    source: "Exchange transport",
    sourceId: "quantum-square-dance-transport",
    state: state.playing ? "start" : "stop",
    position: wrap(state.clockTurns, 1),
  });
  publishPreview({
    kind: "timebase",
    source: "Exchange recurrence",
    sourceId: "quantum-square-dance-timebase",
    rate: 1 / state.cycleDuration,
    unit: "cycles/s",
    running: state.playing,
    displayValue: (1 / state.cycleDuration).toFixed(3) + " cyc/s",
  });
}

function publishPhasePreview(now = performance.now()) {
  if (now - lastMidiTime < MIDI_FRAME_INTERVAL_MS) return;
  lastMidiTime = now;
  publishPreview({
    kind: "control",
    source: "Exchange phase",
    sourceId: "quantum-square-dance-phase",
    rawValue: state.phaseDegrees,
    min: 0,
    max: 360,
    displayValue: phaseLabel(),
  });
}

function midiNoteForFrequency(frequency) {
  return Math.round(clamp(69 + 12 * Math.log2(Math.max(20, frequency) / 440), 0, 127));
}

function noteFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function contourNotes(stepIndex) {
  const density = Math.max(2, Math.round(state.phraseDensity));
  const progress = wrap(stepIndex, density) / Math.max(1, density - 1);
  const arch = Math.sin(progress * Math.PI);
  const rise = sound.spinVoices.up.midi + arch * 1.75;
  const fall = sound.spinVoices.down.midi - arch * 1.75;
  return {
    upMidi: rise,
    downMidi: fall,
    upFrequency: noteFrequency(rise),
    downFrequency: noteFrequency(fall),
  };
}

function waveforms() {
  if (state.spectralColor < 0.25) return { up: "sine", down: "sine", center: "triangle", noise: 0.02 };
  if (state.spectralColor < 0.62) return { up: "triangle", down: "sine", center: "sine", noise: 0.16 };
  if (state.spectralColor < 0.86) return { up: "triangle", down: "sawtooth", center: "triangle", noise: 0.28 };
  return { up: "square", down: "sawtooth", center: "triangle", noise: 0.42 };
}

function strike(spec, envelope) {
  if (!state.audioOn) return false;
  return voices.strike(spec, envelope);
}

function branchStrikes(stepIndex, { manual = false, measurement = null } = {}) {
  let stay = sound.branches.stay.probability;
  let swap = sound.branches.swap.probability;
  if (measurement) {
    stay = measurement === simulation.inputBasis ? 1 : 0;
    swap = stay ? 0 : 1;
  }
  const pairTotal = renderedPairCount();
  const normalization = 1 / Math.sqrt(pairTotal);
  const pitches = contourNotes(stepIndex);
  const colors = waveforms();
  const reverse = preparationForCore() === "down-up";
  const orbitalWidth = Math.abs(sound.spatialRoles.excited.pan);
  const stayPanLeft = reverse ? orbitalWidth : -orbitalWidth;
  const stayPanRight = -stayPanLeft;
  const branchGain = (manual ? 0.075 : 0.063) * normalization;
  const attack = manual ? 0.003 : 0.005;
  const decay = manual ? 0.16 : clamp(state.cycleDuration / state.phraseDensity * 0.55, 0.075, 0.48);
  const emitted = [];
  const ensembleSpread = clamp(Math.log2(Math.max(1, representedPairCount())) / 5, 0, 1);

  for (let pairIndex = 0; pairIndex < pairTotal; pairIndex += 1) {
    const latticePosition = pairTotal === 1 ? 0.5 : pairIndex / (pairTotal - 1);
    const panOffset = (latticePosition - 0.5) * (0.12 + ensembleSpread * 0.34);
    const octave = state.scene === "whole-floor" ? (pairIndex % 3) - 1 : 0;
    const detuneCents = (latticePosition - 0.5) * 32 * ensembleSpread;
    const octaveRatio = 2 ** (octave + detuneCents / 1_200);
    const delay = Math.min(0.045, pairIndex * 0.0035);
    const identityUp = pitches.upFrequency * octaveRatio;
    const identityDown = pitches.downFrequency * octaveRatio;

    if (stay > 0.0005) {
      const gain = branchGain * Math.sqrt(stay);
      if (!isExchangeActive()) {
        const alignedUp = preparationForCore() === "up-up";
        const frequency = alignedUp ? identityUp : identityDown;
        const waveform = alignedUp ? colors.up : colors.down;
        for (const [seat, pan] of [["e", stayPanLeft], ["g", stayPanRight]]) {
          strike({
            key: "square-aligned-" + seat + "-" + pairIndex,
            frequency,
            gain: gain * 0.82,
            pan: clamp(pan + panOffset, -1, 1),
            waveform,
          }, {
            attackSeconds: attack,
            decaySeconds: decay,
            attackNoise: colors.noise * 0.35,
            startDelaySeconds: delay + (seat === "g" ? 0.012 : 0),
          });
        }
        emitted.push({ frequency, gain: gain * 0.82, branch: "aligned" });
      } else {
        strike({
          key: "square-stay-up-" + pairIndex,
          frequency: identityUp,
          gain,
          pan: clamp(stayPanLeft + panOffset, -1, 1),
          waveform: colors.up,
        }, { attackSeconds: attack, decaySeconds: decay, attackNoise: colors.noise, startDelaySeconds: delay });
        strike({
          key: "square-stay-down-" + pairIndex,
          frequency: identityDown,
          gain: gain * 0.92,
          pan: clamp(stayPanRight + panOffset, -1, 1),
          waveform: colors.down,
        }, { attackSeconds: attack + 0.002, decaySeconds: decay * 1.14, attackNoise: colors.noise * 0.55, startDelaySeconds: delay + 0.012 });
        emitted.push({ frequency: identityUp, gain, branch: "stay" });
      }
    }

    if (swap > 0.0005) {
      const gain = branchGain * Math.sqrt(swap);
      const quadratureDelay = Math.min(0.05, delay + 0.021);
      strike({
        key: "square-swap-down-" + pairIndex,
        frequency: identityDown,
        gain,
        pan: clamp(stayPanLeft + panOffset, -1, 1),
        waveform: colors.down,
      }, { attackSeconds: attack + 0.001, decaySeconds: decay * 1.08, attackNoise: colors.noise * 0.7, startDelaySeconds: quadratureDelay });
      strike({
        key: "square-swap-up-" + pairIndex,
        frequency: identityUp,
        gain: gain * 0.92,
        pan: clamp(stayPanRight + panOffset, -1, 1),
        waveform: colors.up,
      }, { attackSeconds: attack, decaySeconds: decay, attackNoise: colors.noise, startDelaySeconds: Math.min(0.05, quadratureDelay + 0.012) });
      emitted.push({ frequency: identityDown, gain, branch: "swap" });
    }
  }

  const coherentGain = (measurement ? 0 : sound.interference.spectralFusion)
    * (manual ? 0.075 : 0.052);
  if (coherentGain > 0.001 && state.audioOn) {
    const direction = Math.sign(xyWitness()) || 1;
    const centerRoot = Math.sqrt(pitches.upFrequency * pitches.downFrequency);
    const ratios = [1, 1.5, 2 ** (7 / 12)];
    ratios.forEach((ratio, index) => {
      strike({
        key: "square-coherence-" + index,
        frequency: centerRoot * ratio,
        gain: coherentGain * [0.72, 0.42, 0.31][index],
        pan: direction * [-0.18, 0, 0.18][index],
        waveform: colors.center,
      }, {
        attackSeconds: 0.007 + index * 0.002,
        decaySeconds: decay * (0.86 + index * 0.18),
        attackNoise: colors.noise * 0.2,
        startDelaySeconds: 0.008 + index * 0.011,
      });
    });
  }

  const preview = emitted.sort((left, right) => right.gain - left.gain).slice(0, 2);
  preview.forEach((entry, index) => {
    publishPreview({
      kind: "note",
      source: measurement ? "Exchange measurement" : "Exchange contour",
      sourceId: measurement ? "quantum-square-dance-measurement" : "quantum-square-dance-contour",
      voiceId: (measurement ? "measure:" : "dance:") + stepIndex + ":" + index,
      channel: 1,
      note: midiNoteForFrequency(entry.frequency),
      frequencyHz: entry.frequency,
      velocity: Math.max(1, Math.round(clamp(entry.gain * 1_100, 0, 127))),
      durationMs: Math.round((attack + decay) * 1_000),
    });
  });
  return emitted;
}

function triggerDanceEvent(stepIndex, options = {}) {
  state.lastEventLabel = options.measurement ? "measurement" : currentCall().label.toLowerCase();
  branchStrikes(stepIndex, options);
  state.flashUntil = performance.now() + (reducedMotion ? 160 : 420);
  visualizationDirty = true;
  scheduleFrame();
}

function measurementOutcome(result) {
  return result?.outcomes?.at?.(-1) ?? result?.outcome ?? null;
}

function performMeasurement(shots = 1) {
  state.sampleSerial += 1;
  const result = sampleSquareDance(simulation, {
    shots,
    seed: (0x51a9e + Math.imul(state.sampleSerial, 0x9e3779b1)) >>> 0,
  });
  state.lastShots = result;
  state.lastMeasurement = measurementOutcome(result);
  const count = Math.min(4, shots);
  for (let index = 0; index < count; index += 1) {
    triggerDanceEvent(index, { measurement: result.outcomes?.[index] ?? state.lastMeasurement });
  }
  updateReadouts();
  announce(
    shots === 1
      ? "Measured an independently prepared pair: " + (state.lastMeasurement ?? "no result") + ". The displayed preparation remains available for another shot."
      : "Thirty-two independently prepared pairs sampled. " + shotSummary(result) + ".",
  );
}

function updateTransport() {
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "Pause the exchange cycle" : "Play the exchange cycle");
  document.body.classList.toggle("is-playing", state.playing);
}

function updateAudioInterface() {
  setPressed($("audioButton"), state.audioOn);
  $("audioButton").disabled = state.audioStarting;
  $("audioButton").setAttribute("aria-label", state.audioOn ? "Turn Quantum Square Dance audio off" : "Turn Quantum Square Dance audio on");
  $("audioButton").title = state.audioOn ? "Audio on" : "Audio off";
  setText("audioState", state.audioOn ? "on" : "off");
}

function updateSoundAnatomy() {
  const { stay, swap } = probabilities();
  const coherent = simulation.concurrence;
  const represented = representedPairCount();
  const rendered = renderedPairCount();
  const root = state.rootFrequency.toFixed(2) + " Hz";
  setText(
    "soundAnatomyState",
    phaseLabel(state.phaseDegrees, false) + " · stay " + percentage(stay, 0) + " · swap " + percentage(swap, 0) + " · C " + coherent.toFixed(3),
  );
  setText(
    "soundAnatomyVoices",
    (represented === rendered
      ? rendered + (rendered === 1 ? " pair" : " audio layers")
      : represented + " represented · " + rendered + " audio layers")
      + " · " + root + " · " + state.phraseDensity + " events · "
      + (state.audioOn ? "audible next event" : "programmed, audio off"),
  );
  let diagnosis;
  if (!isExchangeActive()) {
    diagnosis = "The aligned preparation has no competing spin assignment. You hear one dry contour and no coherent center sidebands: this exchange does not entangle the pair.";
  } else if (Math.abs(stay - swap) < 0.035 && state.coherence < 0.05) {
    diagnosis = "The two alternatives remain 50/50, but dephasing has removed their shared phase. Dry branch energy remains while the center interaction disappears: equal populations alone are not an entanglement witness.";
  } else if (coherent > 0.92) {
    diagnosis = "At the half-SWAP, both branch contours sound with equal energy. Their relative phase adds the centered sideband bloom; this is the maximally entangled moment, not the completed SWAP.";
  } else if (stay > 0.97 || swap > 0.97) {
    diagnosis = swap > stay
      ? "The complete contour, timbre, and stereo assignment have traded buses. Full SWAP is again separable."
      : "One prepared branch carries nearly all energy. The pair is separated in state space and the center coherence color is quiet.";
  } else {
    diagnosis = "The rising and falling identities divide between stay and swap paths with constant branch energy. Their phase-sensitive center color follows concurrence, while the contour follows the exchange angle.";
  }
  setText("soundDiagnosis", diagnosis);
}

function updateReadouts() {
  const { stay, swap } = probabilities();
  const call = currentCall();
  const purities = localPurities();
  const timeLens = timeLensDiagnostics(state.cycleDuration);
  const ratio = Number(timeLens.slowdownFactor ?? timeLens.timeLens ?? state.cycleDuration / PHYSICAL_EXCHANGE_CYCLE_SECONDS);
  const represented = representedPairCount();
  const rendered = renderedPairCount();

  $("scene").value = state.scene;
  $("preparation").value = state.preparation;
  $("exchangePhase").value = String(state.phaseDegrees);
  $("cycleDuration").value = String(state.cycleDuration);
  $("coherence").value = String(state.coherence);
  $("pairCount").value = String(state.pairCount);
  $("rootNote").value = String(state.rootFrequency);
  $("contourRange").value = String(state.contourRange);
  $("phraseDensity").value = String(state.phraseDensity);
  $("spectralColor").value = String(state.spectralColor);
  $("level").value = String(state.level);
  const phaseLocked = state.scene === "hold-half-swap";
  for (const controlId of ["exchangePhase", "halfSwapButton", "swapButton", "reprepareButton"]) {
    $(controlId).disabled = phaseLocked;
  }
  canvas.setAttribute("aria-disabled", String(phaseLocked));

  setText("exchangePhaseOut", phaseLabel());
  setText("cycleDurationOut", state.cycleDuration.toFixed(3) + " s · " + (state.cycleDuration / 2.4).toFixed(2) + " bars @100");
  setText("coherenceOut", percentage(state.coherence, 0));
  setText(
    "pairCountOut",
    represented === rendered
      ? represented + (represented === 1 ? " pair" : " audio layers")
      : represented + " represented · " + rendered + " audio layers",
  );
  setText("contourRangeOut", state.contourRange + " semitones");
  setText("phraseDensityOut", state.phraseDensity + " events / cycle");
  const colorLabel = state.spectralColor < 0.25 ? "round / pure" : state.spectralColor < 0.62 ? "glass / wood" : state.spectralColor < 0.86 ? "reed / grain" : "bright / rough";
  setText("spectralColorOut", percentage(state.spectralColor, 0) + " · " + colorLabel);
  setText("levelOut", percentage(state.level, 0));

  setText("exchangeSummary", call.label.toLowerCase() + " · θ " + phaseLabel(state.phaseDegrees, false) + " · " + entanglementLabel());
  setText(
    "soundSummary",
    state.rootFrequency.toFixed(1) + " Hz · " + state.phraseDensity + " events · "
      + (represented === rendered
        ? rendered + (rendered === 1 ? " pair" : " audio layers")
        : rendered + " audio layers / " + represented + " represented"),
  );
  setText("stateSummary", entanglementLabel() + " · C " + simulation.concurrence.toFixed(3));
  setText("stateVectorReadout", stateDescriptionText());
  setText("stayProbability", percentage(stay));
  setText("swapProbability", percentage(swap));
  setText("relativePhase", relativePhaseText());
  setText("concurrenceReadout", simulation.concurrence.toFixed(3));
  setText("entanglementReadout", entanglementLabel() + " · EoF " + entanglementOfFormation().toFixed(3));
  setText("localPurityReadout", purities[0].toFixed(3) + " / " + purities[1].toFixed(3));
  setText("jointPurityReadout", jointPurity().toFixed(3));
  setText("xyWitnessReadout", signed(xyWitness()));
  setText("physicalCycleReadout", (PHYSICAL_EXCHANGE_CYCLE_SECONDS * 1e6).toFixed(0) + " μs · " + (1 / PHYSICAL_EXCHANGE_CYCLE_SECONDS / 1_000).toFixed(3) + " kHz");
  setText("musicalCycleReadout", state.cycleDuration.toFixed(3) + " s · " + (state.cycleDuration / 2.4).toFixed(2) + " bars at 100 BPM");
  setText("timeLensReadout", Math.round(ratio).toLocaleString("en-US") + "× slower");
  setText("lastMeasurement", state.lastMeasurement ?? "—");
  setText("shotLedger", shotSummary(state.lastShots));
  updateSoundAnatomy();

  setText(
    "stageReadout",
    call.label.toUpperCase() + " · θ " + phaseLabel(state.phaseDegrees, false) + " · C " + simulation.concurrence.toFixed(3) + " · " + represented + (represented === 1 ? " PAIR" : " REPRESENTED PAIRS") + " · AUDIO " + (state.audioOn ? "ON" : "OFF"),
  );
  if (document.activeElement !== canvas) {
    canvas.setAttribute(
      "aria-label",
      "Quantum Square Dance. " + call.description + " Exchange phase " + state.phaseDegrees.toFixed(1) + " degrees. Stay probability " + percentage(stay, 1) + ", swap probability " + percentage(swap, 1) + ", concurrence " + simulation.concurrence.toFixed(3) + ". Scene " + sceneLabel() + ". Audio " + (state.audioOn ? "on" : "off") + ".",
    );
  }
}

function refreshSimulation({ announceMessage = "", audition = false } = {}) {
  simulation = calculateSimulation();
  sound = calculateSound();
  updateReadouts();
  publishPhasePreview();
  visualizationDirty = true;
  scheduleFrame();
  if (audition && state.audioOn) {
    const now = performance.now();
    if (now - lastManualAudition >= MANUAL_AUDITION_INTERVAL_MS) {
      lastManualAudition = now;
      triggerDanceEvent(Math.floor(state.phaseDegrees / 360 * state.phraseDensity), { manual: true });
    }
  }
  if (announceMessage) announce(announceMessage);
}

function setPhaseDegrees(value, { audition = false, announceChange = false } = {}) {
  if (state.scene === "hold-half-swap" && Math.abs(Number(value) - 90) > 0.001) {
    state.phaseDegrees = 90;
    state.clockTurns = 0.25;
    updateReadouts();
    if (announceChange) {
      announce("The held square-root SWAP is locked at 90 degrees. Choose Swing one pair to scrub the exchange.");
    }
    return false;
  }
  state.phaseDegrees = clamp(value, 0, 360);
  state.clockTurns = state.phaseDegrees / 360;
  refreshSimulation({ audition });
  if (announceChange) announce(currentCall().description + " Concurrence " + simulation.concurrence.toFixed(3) + ".");
  return true;
}

function setPlaying(playing) {
  const next = Boolean(playing);
  if (state.playing === next) return;
  state.playing = next;
  if (next && state.scene === "hold-half-swap") {
    state.phaseDegrees = 90;
    simulation = calculateSimulation();
    sound = calculateSound();
  }
  lastFrameTime = performance.now();
  lastStepSerial = Math.floor(state.clockTurns * state.phraseDensity);
  updateTransport();
  updateReadouts();
  publishTransportPreview();
  visualizationDirty = true;
  scheduleFrame();
  announce("Exchange transport " + (next ? "playing" : "paused") + ". Audio remains " + (state.audioOn ? "on" : "off") + ".");
}

function togglePlaying() {
  if (!pageActive || disposed) return;
  setPlaying(!state.playing);
}

async function toggleAudio() {
  if (state.audioStarting || !pageActive || disposed) return;
  const request = ++audioRequest;
  clearAudioError();
  if (state.audioOn) {
    voices.disable();
    state.audioOn = false;
    updateAudioInterface();
    updateReadouts();
    announce("Quantum Square Dance audio off.");
    return;
  }
  state.audioStarting = true;
  updateAudioInterface();
  try {
    voices.setLevel(state.level);
    voices.setVoices([]);
    await voices.start();
    if (request !== audioRequest || !pageActive || disposed) {
      voices.disable();
      return;
    }
    state.audioOn = true;
    lastStepSerial = Math.floor(state.clockTurns * state.phraseDensity);
    announce("Quantum Square Dance audio armed. The next exchange event will sound; no sustained bed was started.");
  } catch (error) {
    if (request === audioRequest) {
      voices.disable();
      state.audioOn = false;
      showAudioError(error);
    }
  } finally {
    if (request === audioRequest) state.audioStarting = false;
    updateAudioInterface();
    updateReadouts();
    visualizationDirty = true;
    scheduleFrame();
  }
}

function turnAudioOff(message = "Quantum Square Dance audio off.") {
  if (!state.audioOn && !state.audioStarting) return;
  audioRequest += 1;
  voices.disable();
  state.audioOn = false;
  state.audioStarting = false;
  updateAudioInterface();
  updateReadouts();
  announce(message);
}

function applyScene(scene) {
  state.scene = ["one-pair", "hold-half-swap", "whole-floor"].includes(scene) ? scene : "one-pair";
  if (state.scene === "one-pair") state.pairCount = 1;
  if (state.scene === "hold-half-swap") {
    state.pairCount = 1;
    state.phaseDegrees = 90;
    state.clockTurns = 0.25;
  }
  if (state.scene === "whole-floor" && state.pairCount < 8) state.pairCount = 16;
  refreshSimulation({ announceMessage: "Scene " + sceneLabel() + ". " + currentCall().description });
}

function repreparePair() {
  if (!setPhaseDegrees(0, { audition: true })) return;
  state.lastMeasurement = null;
  state.lastShots = null;
  updateReadouts();
  announce("Pair reprepared at " + preparationForCore().replaceAll("-", " ") + ".");
}

function resetInstrument() {
  Object.assign(state, DEFAULTS, {
    playing: false,
    clockTurns: 0,
    sampleSerial: 0,
    lastMeasurement: null,
    lastShots: null,
    lastEventLabel: "prepared",
    flashUntil: 0,
  });
  voices.setLevel(state.level);
  clearAudioError();
  updateTransport();
  refreshSimulation({ announceMessage: "Quantum Square Dance reset to a coherent up-down pair at phase zero." });
  publishTransportPreview();
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawBackground(context, width, height) {
  context.clearRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#05070a");
  gradient.addColorStop(0.52, "#0a0b10");
  gradient.addColorStop(1, "#050709");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const halo = context.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.58);
  halo.addColorStop(0, "rgba(255, 200, 107, 0.075)");
  halo.addColorStop(0.48, "rgba(119, 186, 255, 0.035)");
  halo.addColorStop(1, "rgba(5, 7, 9, 0)");
  context.fillStyle = halo;
  context.fillRect(0, 0, width, height);
}

function drawMiniFloor(context, width, height, timestamp, compact) {
  const columns = compact ? 6 : 10;
  const rows = compact ? 3 : 5;
  const left = compact ? 16 : width * 0.055;
  const right = compact ? width - 16 : width * 0.945;
  const top = compact ? height * 0.19 : height * 0.18;
  const bottom = compact ? height * 0.79 : height * 0.84;
  const wholeFloor = state.scene === "whole-floor";
  context.save();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = left + column / Math.max(1, columns - 1) * (right - left);
      const y = top + row / Math.max(1, rows - 1) * (bottom - top);
      const serial = row * columns + column;
      const offset = wholeFloor ? (serial / (rows * columns) - 0.5) * (1 - state.coherence) * 0.7 : 0;
      const localPhase = phaseRadians() + offset * TAU;
      const pulse = reducedMotion ? 0 : Math.sin(timestamp * 0.0025 + serial * 0.7) * 0.5 + 0.5;
      const alpha = wholeFloor ? 0.1 + pulse * 0.11 : 0.035;
      const separation = compact ? 7 : 10;
      context.beginPath();
      context.moveTo(x - separation, y);
      context.lineTo(x + separation, y);
      context.lineWidth = 1;
      context.strokeStyle = "rgba(255, 243, 214, " + alpha.toFixed(3) + ")";
      context.stroke();
      const swap = Math.sin(localPhase / 2) ** 2;
      for (const side of [-1, 1]) {
        context.beginPath();
        context.arc(x + side * separation, y, compact ? 1.7 : 2.3, 0, TAU);
        const swapped = side < 0 ? swap > 0.5 : swap <= 0.5;
        context.fillStyle = swapped ? "rgba(119, 186, 255, " + (alpha + 0.08) + ")" : "rgba(255, 200, 107, " + (alpha + 0.08) + ")";
        context.fill();
      }
    }
  }
  context.restore();
}

function drawDoubleWell(context, layout, timestamp) {
  const { centerX, centerY, wellSeparation, wellRadius, compact } = layout;
  const { stay, swap } = probabilities();
  const leftX = centerX - wellSeparation;
  const rightX = centerX + wellSeparation;
  const glowPulse = reducedMotion ? 1 : 0.94 + Math.sin(timestamp * 0.004) * 0.06;
  context.save();

  for (const [x, color] of [[leftX, COLORS.amber], [rightX, COLORS.blue]]) {
    const halo = context.createRadialGradient(x, centerY, 0, x, centerY, wellRadius * 1.85);
    halo.addColorStop(0, color + "2d");
    halo.addColorStop(0.55, color + "0d");
    halo.addColorStop(1, color + "00");
    context.fillStyle = halo;
    context.beginPath();
    context.ellipse(x, centerY, wellRadius * 1.85, wellRadius, 0, 0, TAU);
    context.fill();
    context.beginPath();
    context.ellipse(x, centerY, wellRadius, wellRadius * 0.45, 0, 0, TAU);
    context.strokeStyle = color + "8a";
    context.lineWidth = 1.3;
    context.stroke();
  }

  const stayAlpha = 0.12 + stay * 0.78;
  const swapAlpha = 0.04 + swap * 0.82;
  context.lineCap = "round";
  context.lineWidth = compact ? 3 : 4;
  context.beginPath();
  context.moveTo(leftX, centerY - wellRadius * 0.23);
  context.bezierCurveTo(centerX - wellRadius * 0.55, centerY - wellRadius * 0.42, centerX + wellRadius * 0.55, centerY - wellRadius * 0.42, rightX, centerY - wellRadius * 0.23);
  context.strokeStyle = "rgba(255, 200, 107, " + stayAlpha.toFixed(3) + ")";
  context.shadowBlur = 14;
  context.shadowColor = COLORS.amber;
  context.stroke();

  context.beginPath();
  context.moveTo(leftX, centerY + wellRadius * 0.23);
  context.bezierCurveTo(centerX - wellRadius * 0.45, centerY + wellRadius * 0.72, centerX + wellRadius * 0.45, centerY - wellRadius * 0.72, rightX, centerY + wellRadius * 0.23);
  context.strokeStyle = "rgba(119, 186, 255, " + swapAlpha.toFixed(3) + ")";
  context.shadowColor = COLORS.blue;
  context.stroke();
  context.shadowBlur = 0;

  if (simulation.concurrence > 0.001) {
    const radius = wellRadius * (0.22 + simulation.concurrence * 0.24) * glowPulse;
    const centerHalo = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 3.4);
    centerHalo.addColorStop(0, "rgba(116, 240, 195, " + (0.34 + simulation.concurrence * 0.48) + ")");
    centerHalo.addColorStop(0.35, "rgba(196, 155, 255, " + (0.08 + simulation.concurrence * 0.2) + ")");
    centerHalo.addColorStop(1, "rgba(116, 240, 195, 0)");
    context.fillStyle = centerHalo;
    context.beginPath();
    context.arc(centerX, centerY, radius * 3.4, 0, TAU);
    context.fill();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, TAU);
    context.fillStyle = COLORS.cream;
    context.fill();
  }

  const atoms = [
    { x: leftX, marginal: simulation.orbitalMarginals.excited, label: "e · excited mode" },
    { x: rightX, marginal: simulation.orbitalMarginals.ground, label: "g · ground mode" },
  ];
  atoms.forEach((atom) => {
    const baseRadius = (compact ? 9 : 12) * glowPulse;
    context.beginPath();
    context.arc(atom.x, centerY, baseRadius * 1.12, 0, TAU);
    context.fillStyle = "rgba(255, 243, 214, 0.055)";
    context.fill();

    for (const spin of [
      { probability: atom.marginal.up, color: COLORS.amber, arrow: "↑", direction: -1 },
      { probability: atom.marginal.down, color: COLORS.blue, arrow: "↓", direction: 1 },
    ]) {
      const radius = baseRadius * (0.2 + 0.68 * Math.sqrt(spin.probability));
      const x = atom.x + spin.direction * baseRadius * 0.23;
      context.save();
      context.globalAlpha = 0.08 + spin.probability * 0.92;
      context.beginPath();
      context.arc(x, centerY, radius, 0, TAU);
      context.fillStyle = spin.color;
      context.shadowBlur = 8 + 15 * spin.probability;
      context.shadowColor = spin.color;
      context.fill();
      context.shadowBlur = 0;
      if (spin.probability > 0.08) {
        context.fillStyle = COLORS.ink;
        context.font = "600 " + (compact ? 8 : 10) + "px ui-monospace, monospace";
        context.textAlign = "center";
        context.fillText(spin.arrow, x, centerY + 3);
      }
      context.restore();
    }

    context.fillStyle = "rgba(255, 243, 214, 0.55)";
    context.font = (compact ? 7 : 8) + "px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(
      "↑" + Math.round(atom.marginal.up * 100) + " · ↓" + Math.round(atom.marginal.down * 100),
      atom.x,
      centerY + wellRadius * 0.66,
    );
    context.fillText(atom.label, atom.x, centerY + wellRadius * 0.88);
  });

  context.fillStyle = "rgba(255, 243, 214, 0.42)";
  context.font = (compact ? 7 : 9) + "px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText("MERGED DOUBLE WELL · EXCHANGE SYMMETRY", centerX, centerY - wellRadius * 0.92);
  context.restore();
}

function drawPhaseRing(context, layout) {
  const { ringX, ringY, ringRadius, compact } = layout;
  const phase = phaseRadians() - Math.PI / 2;
  context.save();
  context.beginPath();
  context.arc(ringX, ringY, ringRadius, 0, TAU);
  context.strokeStyle = "rgba(255, 243, 214, 0.14)";
  context.lineWidth = 1;
  context.stroke();
  const markers = [
    { angle: -Math.PI / 2, label: "0", color: COLORS.amber },
    { angle: 0, label: "√S", color: COLORS.mint },
    { angle: Math.PI / 2, label: "S", color: COLORS.blue },
    { angle: Math.PI, label: "√S†", color: COLORS.orchid },
  ];
  markers.forEach((marker) => {
    const x = ringX + Math.cos(marker.angle) * ringRadius;
    const y = ringY + Math.sin(marker.angle) * ringRadius;
    context.beginPath();
    context.arc(x, y, compact ? 2.2 : 3.2, 0, TAU);
    context.fillStyle = marker.color;
    context.fill();
    context.fillStyle = "rgba(255, 243, 214, 0.6)";
    context.font = (compact ? 6 : 8) + "px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(marker.label, x, y + (marker.angle < 0 ? -7 : 11));
  });
  const x = ringX + Math.cos(phase) * ringRadius;
  const y = ringY + Math.sin(phase) * ringRadius;
  context.beginPath();
  context.moveTo(ringX, ringY);
  context.lineTo(x, y);
  context.strokeStyle = COLORS.cream;
  context.lineWidth = 1.5;
  context.stroke();
  context.beginPath();
  context.arc(x, y, compact ? 4 : 5, 0, TAU);
  context.fillStyle = COLORS.cream;
  context.shadowBlur = 14;
  context.shadowColor = COLORS.cream;
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = COLORS.cream;
  context.font = "600 " + (compact ? 7 : 9) + "px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText("θ", ringX, ringY + 3);
  context.restore();
}

function drawProbabilityCurves(context, layout) {
  const { chartX, chartY, chartWidth, chartHeight, compact } = layout;
  if (compact) return;
  context.save();
  roundedRect(context, chartX, chartY, chartWidth, chartHeight, 8);
  context.fillStyle = "rgba(5, 7, 9, 0.58)";
  context.fill();
  context.strokeStyle = "rgba(255, 243, 214, 0.1)";
  context.stroke();
  const curves = [
    { color: COLORS.amber, value: (phase) => Math.cos(phase / 2) ** 2 },
    { color: COLORS.blue, value: (phase) => Math.sin(phase / 2) ** 2 },
    { color: COLORS.mint, value: (phase) => state.coherence * Math.abs(Math.sin(phase)) },
  ];
  curves.forEach((curve) => {
    context.beginPath();
    for (let index = 0; index <= 96; index += 1) {
      const progress = index / 96;
      const x = chartX + progress * chartWidth;
      const y = chartY + chartHeight - 8 - curve.value(progress * TAU) * (chartHeight - 16);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = curve.color + "b8";
    context.lineWidth = 1.4;
    context.stroke();
  });
  const playhead = chartX + state.phaseDegrees / 360 * chartWidth;
  context.beginPath();
  context.moveTo(playhead, chartY + 4);
  context.lineTo(playhead, chartY + chartHeight - 4);
  context.strokeStyle = COLORS.cream + "b8";
  context.stroke();
  context.fillStyle = "rgba(255, 243, 214, 0.5)";
  context.font = "7px ui-monospace, monospace";
  context.textAlign = "left";
  context.fillText("STAY", chartX + 7, chartY + 12);
  context.fillStyle = COLORS.blue;
  context.fillText("SWAP", chartX + 43, chartY + 12);
  context.fillStyle = COLORS.mint;
  context.fillText("CONCURRENCE", chartX + 81, chartY + 12);
  context.restore();
}

function stageLayout(width, height) {
  const compact = width < 720 || height < 430;
  if (compact) {
    return {
      compact,
      centerX: width * 0.5,
      centerY: height * 0.5,
      wellSeparation: clamp(width * 0.17, 42, 68),
      wellRadius: clamp(Math.min(width, height) * 0.12, 34, 54),
      ringX: width * 0.79,
      ringY: height * 0.69,
      ringRadius: clamp(Math.min(width, height) * 0.09, 23, 36),
      chartX: 0,
      chartY: 0,
      chartWidth: 0,
      chartHeight: 0,
    };
  }
  return {
    compact,
    centerX: width * 0.46,
    centerY: height * 0.48,
    wellSeparation: clamp(width * 0.115, 78, 138),
    wellRadius: clamp(Math.min(width, height) * 0.13, 68, 112),
    ringX: width * 0.75,
    ringY: height * 0.46,
    ringRadius: clamp(Math.min(width, height) * 0.11, 55, 88),
    chartX: width * 0.23,
    chartY: height * 0.73,
    chartWidth: width * 0.54,
    chartHeight: clamp(height * 0.12, 62, 92),
  };
}

function draw(timestamp) {
  if (!context2d) return;
  context2d.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawBackground(context2d, cssWidth, cssHeight);
  const layout = stageLayout(cssWidth, cssHeight);
  drawMiniFloor(context2d, cssWidth, cssHeight, timestamp, layout.compact);
  drawDoubleWell(context2d, layout, timestamp);
  drawPhaseRing(context2d, layout);
  drawProbabilityCurves(context2d, layout);

  if (timestamp < state.flashUntil) {
    context2d.save();
    context2d.strokeStyle = COLORS.cream + "66";
    context2d.lineWidth = 2;
    context2d.strokeRect(5, 5, cssWidth - 10, cssHeight - 10);
    context2d.restore();
  }
}

function animationFrame(timestamp) {
  frameId = null;
  if (disposed || !pageActive || document.hidden) return;
  const elapsed = Math.min(0.1, Math.max(0, (timestamp - lastFrameTime) / 1_000));
  lastFrameTime = timestamp;

  if (state.playing && elapsed > 0) {
    state.clockTurns += elapsed / state.cycleDuration;
    if (state.scene !== "hold-half-swap") state.phaseDegrees = wrap(state.clockTurns, 1) * 360;
    else state.phaseDegrees = 90;
    simulation = calculateSimulation();
    sound = calculateSound();
    const stepSerial = Math.floor(state.clockTurns * state.phraseDensity);
    if (stepSerial !== lastStepSerial) {
      lastStepSerial = stepSerial;
      triggerDanceEvent(stepSerial);
    }
    publishPhasePreview(timestamp);
    visualizationDirty = true;
  }

  if (timestamp - lastUiTime >= MIDI_FRAME_INTERVAL_MS && (state.playing || visualizationDirty)) {
    lastUiTime = timestamp;
    updateReadouts();
  }
  if (visualizationDirty || timestamp - lastDrawTime >= DRAW_INTERVAL_MS) {
    draw(timestamp);
    lastDrawTime = timestamp;
    visualizationDirty = false;
  }
  if (state.playing || timestamp < state.flashUntil) scheduleFrame();
}

function scheduleFrame() {
  if (frameId === null && pageActive && !disposed && !document.hidden) {
    frameId = requestAnimationFrame(animationFrame);
  }
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.min(1.5, Math.max(1, globalThis.devicePixelRatio || 1));
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
  }
  visualizationDirty = true;
  scheduleFrame();
}

function phaseFromPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  return clamp((event.clientX - bounds.left) / Math.max(1, bounds.width) * 360, 0, 359.999);
}

function beginPointerScrub(event) {
  if (event.button !== 0 || disposed || !pageActive || state.scene === "hold-half-swap") return;
  pointerScrub = { pointerId: event.pointerId, startPhase: state.phaseDegrees, moved: false };
  canvas.setPointerCapture?.(event.pointerId);
}

function movePointerScrub(event) {
  if (!pointerScrub || pointerScrub.pointerId !== event.pointerId) return;
  const next = phaseFromPointer(event);
  if (Math.abs(next - pointerScrub.startPhase) > 0.5) pointerScrub.moved = true;
  setPhaseDegrees(next, { audition: pointerScrub.moved && event.isTrusted !== false });
}

function endPointerScrub(event) {
  if (!pointerScrub || pointerScrub.pointerId !== event.pointerId) return;
  const moved = pointerScrub.moved;
  pointerScrub = null;
  try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be lost. */ }
  if (moved) announce(currentCall().description + " Exchange phase " + phaseLabel() + ".");
}

$("audioButton").addEventListener("click", toggleAudio);
$("playButton").addEventListener("click", togglePlaying);
$("halfSwapButton").addEventListener("click", () => {
  setPhaseDegrees(90, { audition: true, announceChange: true });
});
$("swapButton").addEventListener("click", () => {
  setPhaseDegrees(180, { audition: true, announceChange: true });
});
$("reprepareButton").addEventListener("click", repreparePair);
$("measureButton").addEventListener("click", () => performMeasurement(1));
$("shotsButton").addEventListener("click", () => performMeasurement(32));
$("resetSquareDance").addEventListener("click", resetInstrument);

$("scene").addEventListener("change", (event) => applyScene(event.currentTarget.value));
$("preparation").addEventListener("change", (event) => {
  state.preparation = event.currentTarget.value;
  state.phaseDegrees = 0;
  state.clockTurns = 0;
  refreshSimulation({ announceMessage: "Prepared " + preparationForCore().replaceAll("-", " ") + ". " + currentCall().description });
});
$("exchangePhase").addEventListener("input", (event) => {
  setPhaseDegrees(event.currentTarget.value, { audition: event.isTrusted !== false });
});
$("exchangePhase").addEventListener("change", () => {
  announce(currentCall().description + " Concurrence " + simulation.concurrence.toFixed(3) + ".");
});
$("cycleDuration").addEventListener("input", (event) => {
  state.cycleDuration = clamp(event.currentTarget.value, 0.6, 9.6);
  sound = calculateSound();
  updateReadouts();
  publishTransportPreview();
});
$("coherence").addEventListener("input", (event) => {
  state.coherence = clamp(event.currentTarget.value, 0, 1);
  refreshSimulation();
});
$("coherence").addEventListener("change", () => {
  announce("Coherence " + percentage(state.coherence, 0) + ". Populations are unchanged; concurrence is " + simulation.concurrence.toFixed(3) + ".");
});
$("pairCount").addEventListener("input", (event) => {
  state.pairCount = Math.round(clamp(event.currentTarget.value, 1, 32));
  sound = calculateSound();
  updateReadouts();
  visualizationDirty = true;
  scheduleFrame();
});
$("rootNote").addEventListener("change", (event) => {
  state.rootFrequency = clamp(event.currentTarget.value, 40, 1_000);
  sound = calculateSound();
  updateReadouts();
});
$("contourRange").addEventListener("input", (event) => {
  state.contourRange = Math.round(clamp(event.currentTarget.value, 0, 24));
  sound = calculateSound();
  updateReadouts();
});
$("phraseDensity").addEventListener("input", (event) => {
  state.phraseDensity = Math.round(clamp(event.currentTarget.value, 2, 12));
  sound = calculateSound();
  lastStepSerial = Math.floor(state.clockTurns * state.phraseDensity);
  updateReadouts();
});
$("spectralColor").addEventListener("input", (event) => {
  state.spectralColor = clamp(event.currentTarget.value, 0, 1);
  sound = calculateSound();
  updateReadouts();
});
$("level").addEventListener("input", (event) => {
  state.level = clamp(event.currentTarget.value, 0, 0.82);
  voices.setLevel(state.level);
  setText("levelOut", percentage(state.level, 0));
});

canvas.addEventListener("pointerdown", beginPointerScrub);
canvas.addEventListener("pointermove", movePointerScrub);
canvas.addEventListener("pointerup", endPointerScrub);
canvas.addEventListener("pointercancel", endPointerScrub);
canvas.addEventListener("lostpointercapture", () => { pointerScrub = null; });

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.matches("input, select, textarea, button, a, summary")
    || target.isContentEditable
    || ["textbox", "slider", "spinbutton", "combobox"].includes(target.getAttribute("role"))
  );
}

globalThis.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    turnAudioOff();
    return;
  }
  if (
    isTypingTarget(event.target)
    || event.defaultPrevented
    || event.isComposing
    || event.repeat
    || event.altKey
    || event.ctrlKey
    || event.metaKey
  ) return;
  const key = event.key.toLowerCase();
  if (key === "m") {
    event.preventDefault();
    performMeasurement(1);
    return;
  }
  if (key === "h") {
    event.preventDefault();
    setPhaseDegrees(90, { audition: true, announceChange: true });
    return;
  }
  if (key === "s") {
    event.preventDefault();
    setPhaseDegrees(180, { audition: true, announceChange: true });
    return;
  }
  if (key === "r") {
    event.preventDefault();
    repreparePair();
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  setPhaseDegrees(wrap(state.phaseDegrees + direction * (event.shiftKey ? 1 : 5), 360), { audition: true, announceChange: true });
});

const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resizeCanvas) : null;
resizeObserver?.observe(stageWrap);
if (!resizeObserver) globalThis.addEventListener("resize", resizeCanvas);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setPlaying(false);
    turnAudioOff("Audio released while the page is hidden.");
    return;
  }
  lastFrameTime = performance.now();
  visualizationDirty = true;
  scheduleFrame();
});

globalThis.addEventListener("pagehide", (event) => {
  const wasPlaying = state.playing;
  pageActive = false;
  audioRequest += 1;
  state.playing = false;
  state.audioOn = false;
  state.audioStarting = false;
  voices.disable();
  if (wasPlaying) publishTransportPreview();
  if (frameId !== null) cancelAnimationFrame(frameId);
  frameId = null;
  pointerScrub = null;
  if (event.persisted) return;
  disposed = true;
  resizeObserver?.disconnect();
  if (!resizeObserver) globalThis.removeEventListener("resize", resizeCanvas);
  void voices.close();
});

globalThis.addEventListener("pageshow", (event) => {
  if (!event.persisted || disposed) return;
  pageActive = true;
  lastFrameTime = performance.now();
  updateTransport();
  updateAudioInterface();
  updateReadouts();
  publishTransportPreview();
  visualizationDirty = true;
  scheduleFrame();
});

voices.setLevel(state.level);
voices.setVoices([]);
updateTransport();
updateAudioInterface();
updateReadouts();
resizeCanvas();
requestAnimationFrame(() => publishTransportPreview());
