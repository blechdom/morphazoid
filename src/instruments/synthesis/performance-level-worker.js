import { createDefaultState, getMethod, sanitizeState } from './catalog.js';
import { compileSequence } from './sequence-compiler.js';
import { compilePercussionSequence, sanitizePercussionState } from './percussion-state.js';
import { arpeggioDegrees } from './tunings.js';
import { mapSequenceToTuning } from './sequence-register.js';
import { createLevelMeter, gainForLevel } from './performance-level-measure.js';

const WASM_URL = new URL('../../../assets/wasm/synthesis.wasm', import.meta.url);
const REFERENCE_TRIM_DB = -36;
const PEAK_LIMIT = .7;
const TARGET_DB = -15;
const SAFETY_DB = 1.5;
const bound = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const toDb = gain => 20 * Math.log10(gain);
const yieldTurn = () => new Promise(resolve => setTimeout(resolve, 0));
const abort = () => new DOMException('Preset level preparation cancelled.', 'AbortError');

let Processor, modulePromise, bootPromise, renderer, renderRate;
let busy = false, pending = null, activeId = null, cancelledThrough = 0;
globalThis.sampleRate = 48000;
globalThis.currentFrame = 0;
globalThis.currentTime = 0;
// The production scheduler is deliberately reused verbatim, including polyphony,
// note gates, percussion choke, sample-clock timing and the core safety stage.
globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = { postMessage() {} }; }
};
globalThis.registerProcessor = (name, constructor) => {
  if (name === 'roads-synthesis') Processor = constructor;
};

async function boot(rate = 48000) {
  if (!bootPromise) bootPromise = import('./processor.js').catch(error => { bootPromise = null; throw error; });
  if (!modulePromise) modulePromise = fetch(WASM_URL).then(async response => {
    if (!response.ok) throw new Error(`Synthesis level engine could not load (${response.status}).`);
    return WebAssembly.compile(await response.arrayBuffer());
  }).catch(error => { modulePromise = null; throw error; });
  const [module] = await Promise.all([modulePromise, bootPromise]);
  if (renderer && renderRate === rate && !renderer.processor.failed) return renderer;
  renderer?.processor.message({ type: 'dispose' });
  globalThis.sampleRate = rate;
  globalThis.currentFrame = 0; globalThis.currentTime = 0;
  const processor = new Processor({ processorOptions: { module, outputArmed: true } });
  const retained = new Set(['api', 'engine', 'bank', 'processor', 'drums', 'port']);
  const initial = structuredClone(Object.fromEntries(Object.entries(processor).filter(([key]) => !retained.has(key))));
  renderer = { processor, initial }; renderRate = rate;
  return renderer;
}

function compilePerformance(performance) {
  const input = performance?.routing?.input;
  if (!['synthesis', 'percussion'].includes(input)) return null;
  const source = performance.sequence || { id: 'none' };
  const tempo = bound(source.tempoBpm, 10, 1200, 120);
  const gate = bound(source.gate, 5, 95, 65) / 100;
  let cycle = null;
  let state;
  if (input === 'percussion') {
    const drums = sanitizePercussionState(performance.routing.percussion);
    state = { ...createDefaultState('fx-reverb'), percussion: { voices: drums.voices, gain: 1 },
      kind: 'processor', processorId: getMethod('fx-reverb').processorId,
      bypass: true, wet: 0, source: 0, inputDb: 0, outputDb: 0, playStyle: 'process' };
    cycle = compilePercussionSequence(drums, tempo);
  } else {
    const sound = sanitizeState({ ...performance.sound, voiceMode: performance.voiceMode, tuningId: performance.tuningId });
    const method = getMethod(sound.methodId);
    if (method.kind === 'processor') throw new Error('A synthesis level probe needs a synthesis method.');
    state = { ...sound, engineId: method.engineId, kind: 'synthesis', insert: null,
      playStyle: method.playStyle === 'strike' || sound.envelope.sustain <= .001 ? 'strike' : 'hold' };
    if (['basic-up', 'basic-down', 'basic-up-down'].includes(source.id)) {
      const degrees = arpeggioDegrees(sound.tuningId, source.id.slice(6));
      cycle = { studyId: source.id, tempo, stepBeats: 1, lengthBeats: Math.max(1, degrees.length),
        steps: degrees.map((degree, index) => ({ index, at: index, duration: 1,
          notes: [{ degree, velocity: .76, gate, accent: index === 0 }] })) };
    } else if (source.id && source.id !== 'none') {
      cycle = compileSequence(source.id, { tempo, parameters: source.parameters });
    }
    cycle = mapSequenceToTuning(cycle, { tuningId: sound.tuningId, rootFrequency: sound.frequencyHz,
      pitchMode: source.parameters?.pitchMode ?? 'nearest' });
  }
  const cycleSeconds = cycle ? cycle.lengthBeats * 60 / tempo : 60 / tempo;
  const envelopeSeconds = state.envelope?.points?.at(-1)?.time
    ?? (state.envelope?.attack ?? 0) + (state.envelope?.decay ?? 0) + (state.envelope?.release ?? 0);
  const requestedSeconds = Math.max(4, cycleSeconds * 2, !cycle ? envelopeSeconds + .5 : 0);
  return { input, state, cycle, tempo, gate, cycleSeconds,
    seconds: Math.min(32, requestedSeconds), truncated: requestedSeconds > 32 };
}

function resetRenderer({ processor, initial }, state) {
  // Keep a single ~33 MB instance rather than constructing a voice bank per
  // preset. Reset *all* JS scheduling and WASM history before every reference
  // and verification pass; no preceding preset, pending swap or gain survives.
  Object.assign(processor, structuredClone(initial));
  globalThis.currentFrame = 0; globalThis.currentTime = 0;
  processor.message({ type: 'reset' });
  processor.message({ type: 'restore-source' });
  processor.message({ type: 'state', state });
  // State transfer sets targets. Reset once more to start at those exact targets
  // instead of measuring parameter/trim smoothing from the previous pass.
  processor.message({ type: 'reset' });
}

async function render(prepared, trim, id, rate) {
  const target = await boot(rate);
  if (id <= cancelledThrough) throw abort();
  const state = { ...prepared.state, levelTrimDb: trim };
  resetRenderer(target, state);
  const processor = target.processor;
  if (prepared.cycle) {
    const timing = { tempo: prepared.tempo, rootFrequency: state.frequencyHz, at: 0, phase: 0, originBeat: 0 };
    processor.message({ type: 'sequence-load', sequence: prepared.cycle, ...timing, preservePhase: false, playing: false });
    processor.message({ type: 'sequence-start', ...timing });
  } else processor.message({ type: 'play', playing: true, rate: prepared.tempo / 60, gate: prepared.gate });
  const meter = createLevelMeter(rate);
  const frames = Math.ceil(prepared.seconds * rate / 128) * 128;
  const channels = [new Float32Array(128), new Float32Array(128)];
  let yieldedAt = performance.now();
  for (let frame = 0; frame < frames; frame += 128) {
    globalThis.currentFrame = frame; globalThis.currentTime = frame / rate;
    channels[0].fill(0); channels[1].fill(0);
    if (!processor.process([], [channels]) || processor.failed) throw new Error('Synthesis level render failed.');
    meter.push(channels);
    if ((frame / 128) % 64 === 63 && performance.now() - yieldedAt >= 8) {
      await yieldTurn();
      if (id <= cancelledThrough) throw abort();
      yieldedAt = performance.now();
    }
  }
  if (id <= cancelledThrough) throw abort();
  const stats = meter.finish();
  if (stats.nonfinite) throw new Error('Synthesis level render contained non-finite audio.');
  return stats;
}

async function match(request) {
  const prepared = compilePerformance(request.performance);
  if (!prepared) return { sourceTrimDb: null, outputGain: 1, stats: { skipped: 'external-input' } };
  const rate = bound(request.sampleRate, 8000, 192000, 48000);
  const reference = await render(prepared, REFERENCE_TRIM_DB, request.id, rate);
  const context = { input: prepared.input, cycleSeconds: prepared.cycleSeconds,
    measuredCycles: prepared.cycle ? prepared.seconds / prepared.cycleSeconds : null,
    truncated: prepared.truncated, reference, targetDb: TARGET_DB, safetyDb: SAFETY_DB };
  if (reference.silent) return { sourceTrimDb: null, outputGain: 1, stats: { ...context, ...reference, skipped: 'silent-source' } };
  if (prepared.input === 'percussion') {
    // Gain belongs before the external processor, not in its editable trims or
    // the user's master. Both drum channels share this one fixed multiplier.
    const outputGain = gainForLevel(reference, { targetDb: TARGET_DB, peak: PEAK_LIMIT,
      maxDb: toDb(16), safetyDb: SAFETY_DB });
    return { sourceTrimDb: null, outputGain, stats: { ...context, ...reference, passes: 1 } };
  }
  const desired = REFERENCE_TRIM_DB + toDb(gainForLevel(reference, {
    targetDb: TARGET_DB, peak: PEAK_LIMIT, maxDb: 84, safetyDb: SAFETY_DB,
  }));
  let candidate = bound(desired, -36, 48, -36);
  let previous = null;
  const safe = stats => !stats.silent && stats.peak <= PEAK_LIMIT && stats.scoreDb <= TARGET_DB;
  for (let pass = 0; pass < 3; pass++) {
    const stats = await render(prepared, candidate, request.id, rate);
    const lift = candidate - REFERENCE_TRIM_DB;
    // Per-voice emergency clipping can hide behind polyphonic mix attenuation.
    // Check linearity as well as the final peak; a quiet-looking summed output
    // must not justify driving its constituent voices into their safety stages.
    const nonlinear = Math.abs(stats.scoreDb - (reference.scoreDb + lift)) > .75
      || Math.abs(stats.peakDb - (reference.peakDb + lift)) > .75;
    let accepted = !nonlinear && safe(stats) ? { candidate, stats } : null;
    if (previous) {
      // The polyphonic bank retires a released voice when its post-trim DC
      // tail falls below its silence threshold. A very quiet reference can
      // therefore retire tails sooner and change count-based headroom, without
      // any clipping. Verify the *local* gain slope at two neighboring settings
      // before rejecting that legitimate difference from the -36 dB reference.
      const delta = previous.candidate - candidate;
      const locallyLinear = Math.abs(previous.stats.scoreDb - stats.scoreDb - delta) <= .35
        && Math.abs(previous.stats.peakDb - stats.peakDb - delta) <= .35;
      if (locallyLinear) {
        if (safe(previous.stats)) accepted = previous;
        else if (safe(stats)) accepted = { candidate, stats };
      }
    }
    if (accepted) return { sourceTrimDb: accepted.candidate, outputGain: 1,
      stats: { ...context, ...accepted.stats, passes: pass + 2, limited: desired > 48 ? 'trim-range' : null } };
    if (pass === 2 || candidate <= REFERENCE_TRIM_DB) break;
    previous = { candidate, stats };
    const peakCut = Math.max(0, toDb(Math.max(1, stats.peak / PEAK_LIMIT)) + SAFETY_DB);
    candidate = Math.max(REFERENCE_TRIM_DB, candidate - Math.max(nonlinear ? 6 : 0, peakCut,
      stats.scoreDb - TARGET_DB + SAFETY_DB));
  }
  // Never publish the quiet reference probe as a successful match. A background
  // failure leaves the current musical state and its existing source gain alone.
  throw new Error('This sound could not be level-matched safely; its existing level is unchanged.');
}

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (pending) {
      const request = pending; pending = null; activeId = request.id;
      try {
        const result = await match(request);
        if (request.id > cancelledThrough) postMessage({ type: 'result', id: request.id, result });
      } catch (error) {
        if (error.name !== 'AbortError' && request.id > cancelledThrough) {
          postMessage({ type: 'error', id: request.id, message: String(error.message || error) });
        }
      } finally { activeId = null; }
    }
  } finally { busy = false; }
}

addEventListener('message', ({ data }) => {
  if (data?.type === 'warm') {
    boot().then(() => postMessage({ type: 'ready' }), error => postMessage({ type: 'error', message: String(error.message || error) }));
  } else if (data?.type === 'cancel' && Number.isSafeInteger(data.id)) {
    cancelledThrough = Math.max(cancelledThrough, data.id);
    if (pending?.id <= cancelledThrough) pending = null;
  } else if (data?.type === 'match' && Number.isSafeInteger(data.id) && data.id > cancelledThrough) {
    if (activeId !== null) cancelledThrough = Math.max(cancelledThrough, activeId);
    pending = data;
    void drain();
  }
});
