import {
  VoicePool,
  levelToGain,
  limitVoicePeakSum,
  normalizeVoiceGains,
  reduceVoiceContacts,
} from "./src/audio.js";
import {
  CANTOR_LOCK_DEFAULTS,
  analyzeCantorLock,
  complexMagnitudes,
} from "./src/cantor-lock.js";

const $ = (id) => document.getElementById(id);
const MAX_AUDIO_VOICES = 12;
const POWER_ITERATIONS = 36;
const FRAME_INTERVAL = 1_000 / 30;
const AUDIO_INTERVAL = 1_000 / 14;
const DEFAULTS = Object.freeze({
  ...CANTOR_LOCK_DEFAULTS,
  level: 0.48,
  tightened: false,
});

const canvas = $("stage");
const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
const stageWrap = $("stageWrap");
const pool = new VoicePool(MAX_AUDIO_VOICES, { continuousPeakCeiling: 0.68 });
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const state = {
  depth: DEFAULTS.depth,
  offset: DEFAULTS.offset,
  seed: DEFAULTS.seed,
  mode: DEFAULTS.mode,
  level: DEFAULTS.level,
  tightened: DEFAULTS.tightened,
  audio: false,
  audioChanging: false,
  hoverCell: null,
};

let result = null;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let frameId = 0;
let lastDrawTime = -Infinity;
let lastAudioTime = -Infinity;
let dirty = true;
let disposed = false;
let rebuildQueued = false;
let phraseStep = 0;
let nextPulseAt = 0;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percent(value, digits = 2) {
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = message;
  });
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function showAudioError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message || "Web Audio could not start.";
  $("audioError").hidden = false;
  announce(`Audio error: ${$("audioError").textContent}`);
}

function markDirty() {
  dirty = true;
  if (!frameId && !disposed) frameId = requestAnimationFrame(frame);
}

function currentIterations() {
  return state.tightened ? POWER_ITERATIONS : 0;
}

function cadenceMultiplier() {
  if (!result) return 1;
  const iterationProgress = result.iterations / POWER_ITERATIONS;
  const concentrationGain = Math.max(0, result.retainedEnergy - result.initialRetainedEnergy);
  return 1 + iterationProgress * 0.72 + concentrationGain * 0.44;
}

function ensembleSize() {
  return Math.min(10, 1 + state.depth * 2);
}

function resetPhraseClock(now = performance.now()) {
  if (!result) return;
  phraseStep = (state.seed + state.offset) % result.size;
  nextPulseAt = now + 90;
  paintSoundAnatomy(now);
}

function rebuild({ announceChange = false } = {}) {
  const size = 3 ** state.depth;
  state.offset = ((Math.round(state.offset) % size) + size) % size;
  result = analyzeCantorLock({
    depth: state.depth,
    offset: state.offset,
    seed: state.seed,
    mode: state.mode,
    iterations: currentIterations(),
  });
  paintControls();
  updateAudioVoices(performance.now());
  resetPhraseClock();
  markDirty();
  if (announceChange) {
    announce(
      `${state.mode === "cantor" ? "Cantor" : "Solid interval"} masks, depth ${state.depth}. ${percent(result.retainedEnergy)} retained and ${percent(result.leakedEnergy)} leaked.`,
    );
  }
}

function queueRebuild({ announceChange = false } = {}) {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    if (!disposed) rebuild({ announceChange });
  });
}

function paintAudioState() {
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
}

function paintControls() {
  const maximumOffset = result.size - 1;
  $("depth").value = String(state.depth);
  $("depthOut").textContent = `${state.depth} · ${result.size} cells`;
  $("offset").max = String(maximumOffset);
  $("offset").value = String(state.offset);
  $("offsetOut").textContent = `${state.offset} / ${maximumOffset}`;
  $("seed").value = String(state.seed);
  $("seedOut").textContent = String(state.seed);
  $("level").value = String(state.level);
  $("levelOut").textContent = percent(state.level, 0);
  setPressed($("cantorMode"), state.mode === "cantor");
  setPressed($("solidMode"), state.mode === "solid");
  setPressed($("tightenButton"), state.tightened);
  $("tightenButton").textContent = state.tightened ? "Trap tightened" : "Tighten trap";
  $("trapSummary").textContent = `${state.mode === "cantor" ? "Cantor" : "Solid"} · depth ${state.depth}`;
  $("receiptSummary").textContent = state.tightened
    ? `${result.iterations} steps · ${percent(result.retainedEnergy, 1)}`
    : "Raw seed";
  $("gridReadout").textContent = `N = ${result.size} · |X| = |Y| = ${result.count}`;
  $("retainedReadout").textContent = percent(result.retainedEnergy);
  $("leakReadout").textContent = percent(result.leakedEnergy);
  $("sigmaReadout").textContent = state.tightened
    ? `σ_est ≈ ${result.responseNorm.toFixed(4)}`
    : `‖Av‖ = ${result.responseNorm.toFixed(4)}`;
  $("iterationReadout").textContent = state.tightened
    ? `${result.iterations} · power iteration`
    : "0 · seeded state";
  $("soundSummary").textContent = state.mode === "cantor"
    ? "Fractured ensemble"
    : "Continuous ensemble";
  $("densityReadout").textContent = `${state.depth} → ${Math.min(ensembleSize(), result.count)}-voice ${state.depth >= 4 ? "wide" : "compact"} register`;
  $("coreSoundReadout").textContent = `${percent(result.retainedEnergy)} → glass core`;
  $("haloSoundReadout").textContent = `${percent(result.leakedEnergy)} → amber halo + air`;
  $("cadenceReadout").textContent = `${result.iterations} → ${cadenceMultiplier().toFixed(2)}× cadence`;
  $("stereoReadout").textContent = `${state.offset} → stereo rotation`;
  $("phraseReadout").textContent = `${state.seed} → phrase origin`;
  $("articulationReadout").textContent = state.mode === "cantor"
    ? "Cantor → recursive rests"
    : "Solid → connected sustain";
  $("meaningReadout").textContent = state.tightened
    ? (
      state.mode === "cantor"
        ? `The best state found still sends ${percent(result.leakedEnergy)} outside the recursive position mask. This is a finite concentration measurement, not a theorem bound.`
        : `The same-size solid windows retain ${percent(result.retainedEnergy)} in this finite search. Removing recursive gaps changes the concentration problem.`
    )
    : "Cyan energy lands inside X. Amber energy is the complement on this sampled grid. Tighten the trap to search for a less-leaky state.";
  $("stageReadout").textContent = `DEPTH ${state.depth} · ${result.size} CELLS · ${state.tightened ? `σ_EST ${result.responseNorm.toFixed(3)}` : "RAW SEED"} · AUDIO ${state.audio ? "ON" : "OFF"}`;
  canvas.setAttribute(
    "aria-label",
    `Cantor Lock ${state.mode === "cantor" ? "recursive Cantor" : "solid interval"} masks at depth ${state.depth}. ${percent(result.retainedEnergy)} of the finite Fourier state is retained and ${percent(result.leakedEnergy)} leaks. ${state.tightened ? `${result.iterations} power iterations.` : "Seeded state, not yet tightened."} Audio ${state.audio ? "on" : "off"}.`,
  );
  paintAudioState();
  paintSoundAnatomy();
}

function rankedMagnitudes(vector, mask = null, limit = 8) {
  const magnitudes = complexMagnitudes(vector);
  return magnitudes
    .map((magnitude, index) => ({ index, magnitude }))
    .filter(({ index, magnitude }) => magnitude > 1e-8 && (mask === null || mask[index]))
    .sort((left, right) => right.magnitude - left.magnitude || left.index - right.index)
    .slice(0, limit);
}

function glassVoices(now = 0) {
  if (!result) return [];
  const phase = now / 1_000;
  const selected = rankedMagnitudes(
    result.frequencyState,
    result.frequencyMask,
    ensembleSize(),
  );
  const maximum = selected[0]?.magnitude || 1;
  return selected.map(({ index, magnitude }, rank) => {
    const normalized = result.size > 1 ? index / (result.size - 1) : 0;
    const octaveSpan = 2.2 + state.depth * 0.43;
    const registerFloor = 112 * 2 ** (-(state.depth - 2) * 0.18);
    const baseFrequency = registerFloor * 2 ** (normalized * octaveSpan);
    const latticePulse = reducedMotion
      ? 1
      : 0.58 + 0.42 * Math.max(0, Math.sin(phase * (1.2 + rank * 0.09) + index * 2.094));
    const stereoPhase = (index + state.offset) / result.size;
    return {
      key: `glass:${index}`,
      frequency: baseFrequency,
      gain: (0.035 + 0.17 * magnitude / maximum)
        * (state.mode === "solid" ? 1 : latticePulse)
        * (0.28 + result.retainedEnergy * 0.72),
      pan: Math.sin(Math.PI * 2 * stereoPhase) * 0.84,
      waveform: state.mode === "solid" ? "sine" : (rank % 3 === 0 ? "triangle" : "sine"),
      mode: state.mode === "solid" ? "sine" : "pm",
      synthDrive: state.mode === "solid" ? 0 : 0.05 + state.depth * 0.025,
      modulationIndex: state.mode === "solid" ? 0 : 0.28 + rank * 0.075,
      modulationRatio: 1 + ((index * 2 + 1) % 9) / 6,
    };
  });
}

function leakVoices(now = 0) {
  if (!result) return [];
  const phase = now / 1_000;
  const selected = rankedMagnitudes(result.leakState, null, Math.min(4, state.depth));
  const maximum = selected[0]?.magnitude || 1;
  return selected.map(({ index, magnitude }, rank) => {
    const normalized = result.size > 1 ? index / (result.size - 1) : 0;
    const shimmer = reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(phase * 0.73 + rank * 1.7) ** 2;
    const isAirVoice = rank >= 2;
    return {
      key: `leak:${rank}`,
      frequency: isAirVoice
        ? 2_650 + normalized * 2_900 + (rank - 2) * 173
        : 397 + normalized * 1_241 + rank * (13 + state.depth),
      gain: (0.025 + 0.12 * magnitude / maximum)
        * Math.sqrt(result.leakedEnergy)
        * shimmer
        * (isAirVoice ? 0.46 : 1),
      pan: Math.sin(Math.PI * 2 * (normalized + state.offset / result.size)) * 0.76,
      waveform: rank % 2 === 0 ? "sawtooth" : "triangle",
      mode: rank % 2 === 0 ? "fm" : "pm",
      synthDrive: (isAirVoice ? 0.12 : 0.06) + result.leakedEnergy * 0.28,
      modulationIndex: (isAirVoice ? 0.7 : 0.35) + result.leakedEnergy * 1.8,
      modulationRatio: 1.5 + rank * 0.375,
    };
  });
}

function updateAudioVoices(now = performance.now()) {
  if (!result) return;
  pool.setVoices([...glassVoices(now), ...leakVoices(now)]);
  paintSoundAnatomy(now);
}

function phraseIntervalMilliseconds() {
  if (!result) return 180;
  return clamp(4_700 / result.size / cadenceMultiplier(), 33, 240);
}

function setText(id, text) {
  const element = $(id);
  if (element && element.textContent !== text) element.textContent = text;
}

function noteReference(frequency) {
  const midi = 69 + 12 * Math.log2(frequency / 440);
  const nearestMidi = Math.round(midi);
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const name = names[((nearestMidi % 12) + 12) % 12];
  const octave = Math.floor(nearestMidi / 12) - 1;
  const cents = Math.round((midi - nearestMidi) * 100);
  const centsText = cents === 0 ? "" : ` ${cents > 0 ? "+" : "−"}${Math.abs(cents)}¢`;
  return `${name}${octave}${centsText} · ${frequency.toFixed(1)} Hz`;
}

function formattedRange(values, digits = 3) {
  if (!values.length) return "none";
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === maximum
    ? minimum.toFixed(digits)
    : `${minimum.toFixed(digits)}–${maximum.toFixed(digits)}`;
}

function frequencyRange(voices) {
  if (!voices.length) return "no voices";
  const ordered = [...voices].sort((left, right) => left.frequency - right.frequency);
  if (ordered.length === 1) return noteReference(ordered[0].frequency);
  return `${noteReference(ordered[0].frequency)} to ${noteReference(ordered.at(-1).frequency)}`;
}

function voiceList(voices) {
  if (!voices.length) return "none in the 12-voice render pool";
  return [...voices]
    .sort((left, right) => left.frequency - right.frequency)
    .map((voice) => noteReference(voice.frequency))
    .join("; ");
}

/** Mirror VoicePool's reduction and gain bounds so the receipt describes the mix actually submitted. */
function continuousMix(now = performance.now()) {
  const coreRequested = glassVoices(now);
  const haloRequested = leakVoices(now);
  const reduced = reduceVoiceContacts(
    [...coreRequested, ...haloRequested],
    MAX_AUDIO_VOICES,
  );
  const rendered = limitVoicePeakSum(
    normalizeVoiceGains(reduced),
    0.68,
  );
  return {
    coreRequested,
    haloRequested,
    rendered,
    core: rendered.filter(({ key }) => key?.startsWith("glass:")),
    halo: rendered.filter(({ key }) => key?.startsWith("leak:")),
  };
}

function addressPulseDetails(cell) {
  const normalized = result.size > 1 ? cell / (result.size - 1) : 0;
  const octaveSpan = 2.2 + state.depth * 0.43;
  const registerFloor = 112 * 2 ** (-(state.depth - 2) * 0.18);
  const magnitude = Math.hypot(
    result.frequencyState[cell * 2],
    result.frequencyState[cell * 2 + 1],
  );
  const stereoPhase = (cell + state.offset) / result.size;
  return {
    frequency: registerFloor * 2 ** (normalized * octaveSpan),
    gain: clamp(0.07 + magnitude * 0.38 + result.retainedEnergy * 0.08, 0.06, 0.25),
    pan: Math.sin(Math.PI * 2 * stereoPhase) * 0.9,
  };
}

function formatPan(pan) {
  if (pan < -0.08) return `${Math.abs(pan).toFixed(2)} left`;
  if (pan > 0.08) return `${pan.toFixed(2)} right`;
  return "center";
}

function paintSoundAnatomy(now = performance.now()) {
  if (!result) return;
  const mix = continuousMix(now);
  const requestedCount = mix.coreRequested.length + mix.haloRequested.length;
  const interval = phraseIntervalMilliseconds();
  const attackMilliseconds = state.mode === "solid" ? 18 : 2.5;
  const decayMilliseconds = state.mode === "solid"
    ? clamp(interval / 1_000 * 3.2, 0.14, 0.72) * 1_000
    : clamp(interval / 1_000 * 0.72, 0.025, 0.11) * 1_000;
  const hitCount = result.frequencyMask.reduce((sum, value) => sum + Number(value), 0);
  const restCount = result.size - hitCount;
  const pulseDetails = [...result.frequencyMask]
    .map((kept, cell) => kept ? addressPulseDetails(cell) : null)
    .filter(Boolean);
  const pulseGains = pulseDetails.map(({ gain }) => gain);
  const continuousGains = mix.rendered.map(({ gain }) => gain);
  const panValues = mix.rendered.map(({ pan }) => pan ?? 0);
  const leftCount = panValues.filter((pan) => pan < -0.15).length;
  const rightCount = panValues.filter((pan) => pan > 0.15).length;
  const centerCount = panValues.length - leftCount - rightCount;
  const nextCell = phraseStep % result.size;
  const nextKept = Boolean(result.frequencyMask[nextCell]);
  const nextPulse = nextKept ? addressPulseDetails(nextCell) : null;
  const phaseRotation = 360 / result.size;
  const phraseOrigin = (state.seed + state.offset) % result.size;
  const glassStrength = 0.28 + result.retainedEnergy * 0.72;
  const haloStrength = Math.sqrt(result.leakedEnergy);
  const modulationModes = [...new Set(mix.rendered.map(({ mode }) => mode.toUpperCase()))].join(" + ");
  const waveforms = [...new Set(mix.rendered.map(({ waveform }) => waveform))].join(" / ");
  const modulationIndices = mix.rendered.map(({ modulationIndex }) => modulationIndex);
  const modulationRatios = mix.rendered.map(({ modulationRatio }) => modulationRatio);
  const peakSum = continuousGains.reduce((sum, gain) => sum + gain, 0);

  setText(
    "soundAnatomyState",
    state.audio
      ? `Audio on · ${mix.rendered.length}/${MAX_AUDIO_VOICES} continuous voices`
      : "Audio off · 0 sounding",
  );
  setText(
    "soundDiagnosisReadout",
    `${state.audio ? "You are hearing" : "Audio will start with"} a continuously sustained ${mix.rendered.length}-voice Fourier bed (${mix.core.length} cyan core + ${mix.halo.length} amber halo). Short address pulses sit on top; they do not replace the bed. That always-on layer is the likely source of the drone.`,
  );
  setText(
    "activeVoicesReadout",
    `${state.audio ? `${mix.rendered.length} sounding` : `${mix.rendered.length} prepared`} in a ${MAX_AUDIO_VOICES}-voice pool; model requests ${mix.coreRequested.length} core + ${mix.haloRequested.length} halo (${requestedCount} total). ${requestedCount > MAX_AUDIO_VOICES ? `The pool keeps the strongest ${MAX_AUDIO_VOICES}.` : "Nothing is voice-stolen."} Address strikes are additional transients.`,
  );
  setText(
    "coreRegisterReadout",
    `${mix.core.length} continuous ${state.mode === "solid" ? "sine" : "PM"} voices · ${frequencyRange(mix.core)} · retained ${percent(result.retainedEnergy)} gives core strength factor ${glassStrength.toFixed(3)}.`,
  );
  setText(
    "haloRegisterReadout",
    `${mix.halo.length} continuous FM/PM voices · ${frequencyRange(mix.halo)} · leak ${percent(result.leakedEnergy)} gives halo energy scale √leak = ${haloStrength.toFixed(3)}.`,
  );
  setText(
    "pulseTimingReadout",
    `One address every ${interval.toFixed(1)} ms (${(1_000 / interval).toFixed(1)} steps/s); ${hitCount} hits + ${restCount} literal rests per ${(interval * result.size / 1_000).toFixed(2)} s scan. Each hit: ${attackMilliseconds.toFixed(1)} ms attack, ${decayMilliseconds.toFixed(1)} ms decay, ${state.mode === "solid" ? "no" : `${percent(result.leakedEnergy * 0.32, 1)}`} attack noise.`,
  );
  setText(
    "dynamicsAnatomyReadout",
    `Pre-master continuous gains ${formattedRange(continuousGains)} after the ${peakSum.toFixed(3)}/${0.68.toFixed(2)} phase-aligned peak ceiling; pulse peaks ${formattedRange(pulseGains)} before the shared output compressor. Output ${percent(state.level, 0)} applies master gain ${levelToGain(state.level).toFixed(3)}.`,
  );
  setText(
    "timbreAnatomyReadout",
    `Main worklet: sine-carrier ${modulationModes}, modulation index ${formattedRange(modulationIndices)}, ratio ${formattedRange(modulationRatios)}. Native fallback: plain ${waveforms} oscillators without FM/PM. Cyan is smoother; amber has stronger modulation and high air voices.`,
  );
  setText(
    "stereoAnatomyReadout",
    `${leftCount} left / ${centerCount} center / ${rightCount} right; current continuous pan spans ${formattedRange(panValues, 2)}. Each offset step rotates the pan phase ${phaseRotation.toFixed(2)}°; address pulses reach ±0.90.`,
  );
  setText(
    "nextAddressReadout",
    nextPulse
      ? `Address ${nextCell}/${result.size - 1} is a hit: ${noteReference(nextPulse.frequency)}, gain ${nextPulse.gain.toFixed(3)}, ${formatPan(nextPulse.pan)}.${state.audio ? "" : " Clock is parked while audio is off."}`
      : `Address ${nextCell}/${result.size - 1} is a literal rest.${state.audio ? "" : " Clock is parked while audio is off."}`,
  );
  setText("coreVoiceList", voiceList(mix.core));
  setText("haloVoiceList", voiceList(mix.halo));

  setText(
    "geometryGuideReadout",
    state.mode === "cantor"
      ? `Cantor gaps scatter ${hitCount} sounding addresses among ${restCount} rests; the sustained core requests PM and the pulses are short. Solid keeps ${hitCount} addresses but packs them into one run, requests plain sine, and lengthens pulse decay so notes overlap.`
      : `Solid packs ${hitCount} sounding addresses into one run among ${restCount} rests; the sustained core is plain sine and pulse decays overlap. Cantor redistributes the same address count into recursive gaps, turns on PM, and shortens the pulses.`,
  );
  setText(
    "depthGuideReadout",
    `Depth ${state.depth} means N = ${result.size}, ${mix.coreRequested.length} requested core voices, a ${frequencyRange(mix.coreRequested)} core register, and a ${interval.toFixed(1)} ms address step. Increasing depth adds core voices until the 10-voice cap, widens/lowers the pitch lattice, and rebuilds a longer, usually faster scan with a smaller proportion of hits.`,
  );
  setText(
    "offsetGuideReadout",
    `Offset ${state.offset} translates both masks, changing which pitch addresses survive and recalculating retained/leak energy. It also sets phrase origin ${phraseOrigin} and rotates pan by ${phaseRotation.toFixed(2)}° per step.`,
  );
  setText(
    "seedGuideReadout",
    state.tightened
      ? `Seed ${state.seed} chose the starting complex phases for tightening, which can change interference, retained/leak energy, halo profile, and the converged voice priorities. It never changes the mask count or pitch formula. With offset ${state.offset}, it starts the phrase at address ${phraseOrigin}.`
      : `Seed ${state.seed} changes complex phases only: every kept Fourier bin still has equal magnitude before tightening, so core priority and pulse gain stay equal. Interference still changes retained/leak energy and the amber halo. With offset ${state.offset}, it starts the phrase at address ${phraseOrigin}.`,
  );
  setText(
    "tightenGuideReadout",
    state.tightened
      ? `${result.iterations} power iterations are active: retained ${percent(result.retainedEnergy)}, leak ${percent(result.leakedEnergy)}, cadence ${cadenceMultiplier().toFixed(2)}×. This remixes core/halo gains, modulation, voice priority, and timing; it does not change the mask or pitch formula.`
      : `Currently the raw seeded state. Tighten runs ${POWER_ITERATIONS} power iterations, then remixes core/halo gains, modulation, voice priority, cadence, and attack noise from the new retained/leak result; it does not change the mask or pitch formula.`,
  );
  setText(
    "levelGuideReadout",
    `Output ${percent(state.level, 0)} becomes master gain √level = ${levelToGain(state.level).toFixed(3)}. It changes final loudness only—never voice count, pitches, pulse timing, pan, or modulation.`,
  );
}

/**
 * Traverse the sampled Y addresses in order. Kept cells speak and removed
 * cells become literal rests, so the recursive mask supplies rhythm and
 * phrasing without quantizing the result onto a conventional musical scale.
 */
function advanceModelPhrase(now) {
  if (!state.audio || !result || document.hidden) return;
  const interval = phraseIntervalMilliseconds();
  if (!(nextPulseAt > 0)) nextPulseAt = now;
  let catchUp = 0;
  while (now >= nextPulseAt && catchUp < 3) {
    const cell = phraseStep % result.size;
    if (result.frequencyMask[cell]) {
      const normalized = result.size > 1 ? cell / (result.size - 1) : 0;
      const octaveSpan = 2.2 + state.depth * 0.43;
      const registerFloor = 112 * 2 ** (-(state.depth - 2) * 0.18);
      const magnitude = Math.hypot(
        result.frequencyState[cell * 2],
        result.frequencyState[cell * 2 + 1],
      );
      const stereoPhase = (cell + state.offset) / result.size;
      pool.strike({
        key: `address:${cell}`,
        frequency: registerFloor * 2 ** (normalized * octaveSpan),
        gain: clamp(0.07 + magnitude * 0.38 + result.retainedEnergy * 0.08, 0.06, 0.25),
        pan: Math.sin(Math.PI * 2 * stereoPhase) * 0.9,
        waveform: state.mode === "solid" ? "sine" : "triangle",
      }, {
        attackSeconds: state.mode === "solid" ? 0.018 : 0.0025,
        decaySeconds: state.mode === "solid"
          ? clamp(interval / 1_000 * 3.2, 0.14, 0.72)
          : clamp(interval / 1_000 * 0.72, 0.025, 0.11),
        attackNoise: state.mode === "solid" ? 0 : result.leakedEnergy * 0.32,
      });
    }
    phraseStep = (phraseStep + 1) % result.size;
    nextPulseAt += interval;
    catchUp += 1;
  }
  if (catchUp === 3 && now > nextPulseAt + interval * 3) nextPulseAt = now + interval;
  if (catchUp > 0) paintSoundAnatomy(now);
}

function strikeTightening() {
  if (!state.audio || !result) return;
  pool.strike({
    key: "tighten",
    frequency: 660 + result.responseNorm * 550,
    gain: 0.2,
    pan: 0,
    waveform: "triangle",
  }, { attackSeconds: 0.006, decaySeconds: 0.34, attackNoise: result.leakedEnergy * 0.55 });
}

function disableAudio({ announceChange = true } = {}) {
  state.audio = false;
  pool.disable();
  paintControls();
  if (announceChange) announce("Audio off.");
  markDirty();
}

async function enableAudio() {
  if (state.audio) return true;
  if (state.audioChanging) return false;
  state.audioChanging = true;
  $("audioButton").disabled = true;
  clearAudioError();
  try {
    await pool.enable();
    pool.setLevel(state.level);
    state.audio = true;
    paintControls();
    updateAudioVoices();
    resetPhraseClock();
    announce("Audio on. Cyan glass partials carry retained energy; rougher amber voices carry leakage.");
    markDirty();
    return true;
  } catch (error) {
    state.audio = false;
    paintControls();
    showAudioError(error);
    return false;
  } finally {
    state.audioChanging = false;
    $("audioButton").disabled = false;
  }
}

async function toggleAudio() {
  if (state.audio) disableAudio();
  else await enableAudio();
}

function setMode(mode, { announceChange = true } = {}) {
  const next = mode === "solid" ? "solid" : "cantor";
  if (next === state.mode) return;
  state.mode = next;
  state.tightened = false;
  rebuild({ announceChange });
}

function tightenTrap({ announceChange = true } = {}) {
  state.tightened = true;
  rebuild();
  strikeTightening();
  if (announceChange) {
    announce(`Trap tightened in ${result.iterations} steps. ${percent(result.retainedEnergy)} retained; ${percent(result.leakedEnergy)} leaked.`);
  }
}

function resetInstrument() {
  state.depth = DEFAULTS.depth;
  state.offset = DEFAULTS.offset;
  state.seed = DEFAULTS.seed;
  state.mode = DEFAULTS.mode;
  state.level = DEFAULTS.level;
  state.tightened = false;
  pool.setLevel(state.level);
  rebuild();
  announce("Cantor Lock reset to a depth-four seeded state.");
}

function canvasColors() {
  const style = getComputedStyle(document.body);
  return {
    background: style.getPropertyValue("--bg-deep").trim() || "#07090b",
    ink: style.getPropertyValue("--ink").trim() || "#eef1ec",
    muted: style.getPropertyValue("--muted").trim() || "#8c9692",
    faint: style.getPropertyValue("--faint").trim() || "#4d5754",
    line: style.getPropertyValue("--line").trim() || "rgba(255,255,255,.12)",
    cyan: style.getPropertyValue("--accent").trim() || "#69e7ff",
    amber: style.getPropertyValue("--fup-amber").trim() || "#f0aa55",
  };
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(bounds.width));
  const nextHeight = Math.max(1, Math.round(bounds.height));
  const nextRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  if (nextWidth === cssWidth && nextHeight === cssHeight && nextRatio === pixelRatio) return;
  cssWidth = nextWidth;
  cssHeight = nextHeight;
  pixelRatio = nextRatio;
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  dirty = true;
}

function drawLabel(text, x, y, color, align = "left", size = 8) {
  context.fillStyle = color;
  context.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillText(text, x, y);
}

function drawMask(mask, x, y, width, height, color, alpha = 0.78) {
  const cellWidth = width / mask.length;
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = 0.22;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  context.globalAlpha = alpha;
  context.fillStyle = color;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    context.fillRect(x + index * cellWidth, y, Math.max(0.7, cellWidth - 0.4), height);
  }
  context.restore();
}

function drawAmplitudeBand(vector, mask, x, baseline, width, height, colors, { frequency = false } = {}) {
  const magnitudes = complexMagnitudes(vector);
  const maximum = Math.max(...magnitudes, 1e-12);
  const cellWidth = width / magnitudes.length;
  context.save();
  context.strokeStyle = colors.line;
  context.beginPath();
  context.moveTo(x, baseline + 0.5);
  context.lineTo(x + width, baseline + 0.5);
  context.stroke();
  for (let index = 0; index < magnitudes.length; index += 1) {
    const magnitude = magnitudes[index] / maximum;
    if (!(magnitude > 0.002)) continue;
    const barHeight = Math.max(1, magnitude * height);
    const retained = Boolean(mask[index]);
    context.fillStyle = retained ? colors.cyan : colors.amber;
    context.globalAlpha = retained ? 0.76 : 0.55;
    const drawX = x + index * cellWidth;
    if (frequency) context.fillRect(drawX, baseline, Math.max(0.7, cellWidth - 0.35), barHeight);
    else context.fillRect(drawX, baseline - barHeight, Math.max(0.7, cellWidth - 0.35), barHeight);
  }
  context.restore();
}

function drawHistory(x, y, width, height, colors) {
  const history = result.history;
  context.save();
  context.strokeStyle = colors.line;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  context.strokeStyle = colors.cyan;
  context.lineWidth = 1.25;
  context.beginPath();
  history.forEach((value, index) => {
    const drawX = x + (history.length === 1 ? 0 : index / (history.length - 1)) * width;
    const drawY = y + height - value * height;
    if (index === 0) context.moveTo(drawX, drawY);
    else context.lineTo(drawX, drawY);
  });
  context.stroke();
  context.fillStyle = colors.amber;
  const finalValue = history.at(-1) ?? 0;
  context.beginPath();
  context.arc(x + (history.length > 1 ? width : 0), y + height - finalValue * height, 2.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawStage(now) {
  resizeCanvas();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const colors = canvasColors();
  const compact = cssWidth < 610 || cssHeight < 430;
  const x = compact ? 16 : 42;
  const width = Math.max(1, cssWidth - x * 2);
  const top = compact ? Math.max(104, cssHeight * 0.34) : Math.max(154, cssHeight * 0.27);
  const bottomSafe = compact ? 50 : 64;
  const available = Math.max(92, cssHeight - top - bottomSafe);
  const half = available * 0.47;
  const frequencyBaseline = top + 20;
  const positionBaseline = top + half + Math.max(42, half * 0.62);
  const amplitudeHeight = Math.max(26, half * 0.52);
  const maskHeight = compact ? 8 : 11;

  drawLabel("Y · FREQUENCY MASK", x, top - 9, colors.cyan, "left", compact ? 7 : 8);
  drawLabel(`${result.count}/${result.size} CELLS`, x + width, top - 9, colors.muted, "right", compact ? 7 : 8);
  drawMask(result.frequencyMask, x, frequencyBaseline - maskHeight - 2, width, maskHeight, colors.cyan);
  drawAmplitudeBand(
    result.frequencyState,
    result.frequencyMask,
    x,
    frequencyBaseline,
    width,
    amplitudeHeight,
    colors,
    { frequency: true },
  );

  const arrowY = top + half * 0.72;
  context.save();
  context.strokeStyle = colors.line;
  context.beginPath();
  context.moveTo(x, arrowY);
  context.lineTo(x + width, arrowY);
  context.stroke();
  drawLabel("Pᵧ  →  F⁻¹  →  Pₓ", x + width / 2, arrowY - 6, colors.muted, "center", compact ? 7 : 8);
  context.restore();

  const positionLabelY = positionBaseline - amplitudeHeight - 12;
  drawLabel("X · POSITION MASK", x, positionLabelY, colors.cyan, "left", compact ? 7 : 8);
  drawLabel(
    `${percent(result.retainedEnergy, 1)} HELD · ${percent(result.leakedEnergy, 1)} LEAK`,
    x + width,
    positionLabelY,
    colors.amber,
    "right",
    compact ? 7 : 8,
  );
  drawAmplitudeBand(
    result.fullPositionState,
    result.positionMask,
    x,
    positionBaseline,
    width,
    amplitudeHeight,
    colors,
  );
  drawMask(result.positionMask, x, positionBaseline + 4, width, maskHeight, colors.cyan);

  if (!compact && result.history.length > 1) {
    const graphWidth = Math.min(130, width * 0.2);
    const graphHeight = 34;
    drawHistory(x + width - graphWidth, arrowY + 9, graphWidth, graphHeight, colors);
    drawLabel("POWER ITERATION", x + width - graphWidth, arrowY + 7, colors.faint, "left", 7);
  }

  if (state.hoverCell !== null) {
    const hoverX = x + (state.hoverCell + 0.5) / result.size * width;
    context.save();
    context.strokeStyle = colors.amber;
    context.globalAlpha = 0.7;
    context.setLineDash([2, 3]);
    context.beginPath();
    context.moveTo(hoverX, top - 2);
    context.lineTo(hoverX, positionBaseline + maskHeight + 6);
    context.stroke();
    drawLabel(String(state.hoverCell), hoverX, positionBaseline + maskHeight + 18, colors.amber, "center", 7);
    context.restore();
  }

  if (state.audio && !reducedMotion) {
    const pulse = 0.35 + 0.25 * Math.sin(now / 420);
    context.save();
    context.strokeStyle = colors.cyan;
    context.globalAlpha = pulse;
    context.strokeRect(x - 3.5, top - 17.5, width + 7, positionBaseline - top + maskHeight + 25);
    context.restore();
  }
}

function frame(now) {
  frameId = 0;
  if (disposed) return;
  resizeCanvas();
  if (state.audio && now - lastAudioTime >= AUDIO_INTERVAL) {
    updateAudioVoices(now);
    lastAudioTime = now;
  }
  advanceModelPhrase(now);
  const shouldAnimate = state.audio && !document.hidden && !reducedMotion;
  if (dirty || shouldAnimate) {
    if (dirty || now - lastDrawTime >= FRAME_INTERVAL) {
      drawStage(now);
      dirty = false;
      lastDrawTime = now;
    }
  }
  if (dirty || state.audio) frameId = requestAnimationFrame(frame);
}

function cellAtPointer(event) {
  if (!result) return null;
  const bounds = canvas.getBoundingClientRect();
  const margin = cssWidth < 610 ? 16 : 42;
  const x = event.clientX - bounds.left;
  if (x < margin || x > cssWidth - margin) return null;
  return clamp(Math.floor((x - margin) / (cssWidth - margin * 2) * result.size), 0, result.size - 1);
}

$("audioButton").addEventListener("click", toggleAudio);
$("level").addEventListener("input", () => {
  state.level = clamp(Number($("level").value), 0, 1);
  pool.setLevel(state.level);
  $("levelOut").textContent = percent(state.level, 0);
  paintSoundAnatomy();
});
$("cantorMode").addEventListener("click", () => setMode("cantor"));
$("solidMode").addEventListener("click", () => setMode("solid"));
$("depth").addEventListener("input", () => {
  state.depth = Number($("depth").value);
  state.tightened = false;
  queueRebuild();
});
$("offset").addEventListener("input", () => {
  state.offset = Number($("offset").value);
  state.tightened = false;
  queueRebuild();
});
$("seed").addEventListener("input", () => {
  state.seed = Number($("seed").value);
  state.tightened = false;
  queueRebuild();
});
$("tightenButton").addEventListener("click", () => tightenTrap());
$("reseedButton").addEventListener("click", () => {
  state.seed = state.seed >= 999 ? 1 : state.seed + 1;
  state.tightened = false;
  rebuild({ announceChange: true });
});
$("resetButton").addEventListener("click", resetInstrument);

canvas.addEventListener("pointermove", (event) => {
  const cell = cellAtPointer(event);
  if (cell === state.hoverCell) return;
  state.hoverCell = cell;
  canvas.style.cursor = cell === null ? "default" : "crosshair";
  markDirty();
});

canvas.addEventListener("pointerleave", () => {
  state.hoverCell = null;
  canvas.style.cursor = "default";
  markDirty();
});

canvas.addEventListener("pointerdown", (event) => {
  const cell = cellAtPointer(event);
  if (cell === null) return;
  event.preventDefault();
  canvas.focus();
  state.offset = cell;
  state.tightened = false;
  rebuild({ announceChange: true });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.audio) {
      event.preventDefault();
      disableAudio();
    }
    return;
  }
  const interactive = /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(event.target?.tagName ?? "");
  if (interactive && event.target !== canvas) return;
  if (event.key.toLowerCase() === "t") {
    event.preventDefault();
    tightenTrap();
    return;
  }
  if (event.code === "Space" || event.key === " ") {
    event.preventDefault();
    setMode(state.mode === "cantor" ? "solid" : "cantor");
    return;
  }
  const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
  if (!direction) return;
  event.preventDefault();
  state.offset = (state.offset + direction + result.size) % result.size;
  state.tightened = false;
  rebuild({ announceChange: true });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else {
    updateAudioVoices();
    markDirty();
  }
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    pool.silence();
    return;
  }
  disposed = true;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  void pool.close();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  disposed = false;
  updateAudioVoices();
  markDirty();
});

if (globalThis.ResizeObserver) {
  const resizeObserver = new ResizeObserver(markDirty);
  resizeObserver.observe(stageWrap);
} else {
  window.addEventListener("resize", markDirty);
}

rebuild();
markDirty();
