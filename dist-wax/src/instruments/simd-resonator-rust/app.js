import { connectAudioOutput } from '../../audio-output-manager.js';
import { mountAudioInputControl } from '../../audio-input-control.js';
import { audioInputConstraints } from '../../audio-input-settings.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { createInputSource, SAMPLE_INPUT_OPTIONS } from '../micmic/native/input-source.js';
import { presetsForSimdEngine } from '../../simd-resonator.js';
import { DEFAULTS, MAX_MODES, createConfiguration, sanitizeSettings } from './model.js';
import { PRESETS, capturePreset, validatePreset, randomizePreset } from './presets.js';

const $ = id => document.getElementById(id);
const canvas = $('resonatorCanvas'), context2d = canvas.getContext('2d', { alpha: false });
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const percent = value => Math.round(value * 100) + '%';
const forceScalar = new URLSearchParams(location.search).get('scalar') === '1';
const materialPresets = presetsForSimdEngine('resonator');
const fields = [
  ['controlA', 'modeCount', value => String(Math.round(value))],
  ['controlB', 'baseFrequency', value => Math.round(value) + ' Hz'],
  ['controlC', 'decaySeconds', value => value.toFixed(2) + ' s'],
  ['controlD', 'spread', percent],
  ['spectralSpan', 'spectralSpan', value => Number(value.toFixed(2)) + ' orders'],
  ['strikePosition', 'strikePosition', percent], ['hardness', 'hardness', percent],
  ['fftHopRatio', 'fftHopRatio', value => Math.round((1 - value) * 100) + '% overlap'],
  ['fftBandCount', 'fftBandCount', String], ['fftResponseMs', 'fftResponseMs', value => Math.round(value) + ' ms'],
  ['fftDetail', 'fftDetail', percent], ['fftMix', 'fftMix', percent], ['fftInputGain', 'fftInputGain', percent],
  ['fftGateDb', 'fftGateDb', value => Math.round(value) + ' dB'],
  ['fftLowFrequency', 'fftLowFrequency', value => Math.round(value) + ' Hz'],
  ['fftHighFrequency', 'fftHighFrequency', value => (value / 1000).toFixed(1) + ' kHz'],
];
const state = {
  settings: { ...DEFAULTS }, context: null, node: null, master: null, limiter: null, releaseOutput: null,
  ready: false, starting: false, arming: false, armRevision: 0, armed: false, disposed: false, generation: 0, startPromise: null, readyReject: null,
  backend: 'none', requestedBackend: forceScalar ? 'scalar' : 'simd', simdAvailable: false,
  micStream: null, micSource: null, micGain: null, micPending: false, micRevision: 0, recordedGain: null,
  inputRevision: 0, inputWasPlaying: false, pointer: null, lastStrike: 0, materialId: null,
  peak: 0, rms: 0, telemetry: {}, energy: new Float32Array(128), modal: new Float32Array(128),
  fftInput: new Float32Array(128), fftOutput: new Float32Array(128), frame: 0, lastDraw: 0,
};
let inputControl, recordedInput, presetController;
const knobs = [];
function showError(message = '') { $('audioError').textContent = message; $('audioError').hidden = !message; }
function announce(message) { $('liveStatus').textContent = message; }
function inputLive() { return Boolean(state.micStream || recordedInput?.snapshot().playing); }
function syncInput() { state.node?.port.postMessage({ type: 'mic', active: inputLive() }); }

function renderSettings() {
  for (const [id, key, format] of fields) {
    $(id).value = state.settings[key]; $(id + 'Out').value = format(state.settings[key]);
    $(id).setAttribute('aria-valuetext', format(state.settings[key]));
  }
  $('fftSize').value = state.settings.fftSize; $('fftWindow').value = state.settings.fftWindow;
  const frameMs = state.settings.fftSize / (state.context?.sampleRate || 48000) * 1000;
  $('fftSizeOut').value = frameMs.toFixed(1) + ' ms';
  $('fftSummary').textContent = state.settings.fftBandCount + ' bands · ' + frameMs.toFixed(1) + ' ms';
  $('bodySummary').textContent = state.settings.modeCount.toLocaleString() + ' waves';
  $('strikeReadout').textContent = percent(state.settings.strikePosition) + ' · ' + percent(state.settings.hardness) + ' hardness';
  $('presetSelect').value = state.materialId || '';
  $('presetDescription').textContent = materialPresets.find(preset => preset.id === state.materialId)?.note || 'Drag the body to choose strike position and hardness.';
  for (const knob of knobs) knob.update();
}
function renderInput() {
  if (!recordedInput) return;
  const input = recordedInput.snapshot();
  $('recordedInputControls').hidden = input.mode === 'mic';
  $('inputSampleControl').hidden = input.mode !== 'samples';
  $('inputSample').value = input.sampleId; $('inputLoop').checked = input.loop;
  $('inputPlay').textContent = input.pending ? 'Cancel loading' : input.playing ? 'Stop input' : 'Play input';
  $('inputPlay').setAttribute('aria-pressed', String(input.playing));
  $('inputPlay').setAttribute('aria-busy', String(input.pending));
  $('inputStatus').textContent = input.pending ? 'Loading ' + input.label + '…' : input.label + (input.playing ? ' · playing' : ' · stopped');
  $('inputCredit').hidden = !input.credit;
  if ($('inputCredit').dataset.credit !== input.credit) {
    $('inputCredit').dataset.credit = input.credit; $('inputCredit').replaceChildren();
    if (input.creditUrl) {
      const link = document.createElement('a'); link.href = input.creditUrl; link.textContent = input.credit;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; $('inputCredit').append(link);
    } else $('inputCredit').textContent = input.credit;
  }
  $('inputSummary').textContent = inputLive() ? 'input live' : state.armed ? 'pluck or input' : 'Audio off';
}
function renderAudio() {
  $('audioButton').setAttribute('aria-pressed', String(state.armed && state.ready));
  $('audioButton').setAttribute('aria-busy', String(state.starting || state.arming));
  $('audioState').textContent = state.starting || state.arming ? 'loading' : state.armed ? 'on' : 'off';
  $('backendMetric').textContent = state.ready ? 'Rust ' + (state.backend === 'simd' ? 'SIMD ×4' : 'scalar') : state.starting ? 'loading' : 'not loaded';
  $('backendSelect').value = state.requestedBackend;
  inputControl?.refresh(); renderInput();
}
function sendConfiguration() {
  if (!state.ready || !state.node) return;
  state.node.port.postMessage({ type: 'configure', configuration: createConfiguration(state.settings, state.context.sampleRate) });
}
function updateSettings(patch) {
  state.settings = { ...sanitizeSettings({ ...state.settings, ...patch }) }; state.materialId = null;
  renderSettings(); sendConfiguration();
}
function applyFullPreset(snapshot) {
  const next = validatePreset(snapshot);
  for (const knob of knobs) knob.cancelGesture();
  state.settings = { ...next }; state.materialId = null; renderSettings(); sendConfiguration();
}
function applyMaterial(id) {
  const preset = materialPresets.find(item => item.id === id);
  if (!preset) return;
  const fft = Object.fromEntries(Object.entries(state.settings).filter(([key]) => key.startsWith('fft')));
  state.settings = { ...sanitizeSettings({ ...preset.settings, spectralSpan: preset.settings.modeCount, ...fft }) };
  state.materialId = id; renderSettings(); sendConfiguration();
}
async function wasm(name, required = true) {
  try {
    const response = await fetch(new URL('../../../assets/wasm/rust-resonator-' + name + '.wasm', import.meta.url));
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bytes = await response.arrayBuffer();
    if (!WebAssembly.validate(bytes)) throw new Error('Unsupported WebAssembly module');
    return bytes;
  } catch (error) { if (required) throw error; return null; }
}
function receive(message) {
  if (message.type === 'ready' || message.type === 'backend') {
    state.backend = message.backend; state.simdAvailable = message.simdAvailable; renderAudio();
  } else if (message.type === 'telemetry') {
    state.telemetry = message; state.peak = message.peak; state.rms = message.rms;
    state.energy.set(message.modalEnergy); state.modal.set(message.modalState);
    state.fftInput.set(message.fftInput); state.fftOutput.set(message.fftOutput);
    const coarse = message.timingResolution !== 'high';
    $('callbackMetric').textContent = (coarse ? '~' : '') + Math.round(message.callbackMicros) + ' µs / ' + Math.round(message.budgetMicros) + ' µs';
    $('kernelMetric').textContent = (coarse ? '~' : '') + Math.round(message.kernelMicros) + ' µs';
    $('bodySummary').textContent = message.modeCount.toLocaleString() + ' waves · ' + message.audibleModes.toLocaleString() + ' audible';
  } else if (message.type === 'error') {
    state.readyReject?.(new Error(message.message)); showError(message.message);
    if (state.ready) void stopAudio({ preserveError: true });
  }
}
function ensureGraph() {
  if (state.ready) return Promise.resolve();
  if (state.startPromise) return state.startPromise;
  if (state.disposed) return Promise.reject(new Error('Instrument has closed.'));
  const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Constructor || !globalThis.AudioWorkletNode) return Promise.reject(new Error('This browser needs Web Audio and AudioWorklet.'));
  const generation = ++state.generation;
  const audioContext = new Constructor({ latencyHint: 'interactive' });
  const resumed = audioContext.resume(); // Preserve transient user activation.
  state.context = audioContext; state.starting = true; renderAudio();
  const current = () => generation === state.generation && !state.disposed && !document.hidden;
  const promise = (async () => {
    let timer;
    try {
      await resumed;
      const [scalarBytes, simdBytes] = await Promise.all([
        wasm('scalar'), forceScalar ? Promise.resolve(null) : wasm('simd', false),
        audioContext.audioWorklet.addModule(new URL('./processor.js', import.meta.url)),
      ]);
      if (!current()) throw new DOMException('Start cancelled.', 'AbortError');
      const node = new AudioWorkletNode(audioContext, 'morphazoid-rust-resonator', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit',
      });
      const limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = -8; limiter.knee.value = 8; limiter.ratio.value = 12; limiter.attack.value = .002; limiter.release.value = .12;
      const master = audioContext.createGain(); master.gain.value = 0;
      node.connect(limiter); limiter.connect(master);
      state.node = node; state.limiter = limiter; state.master = master;
      state.releaseOutput = connectAudioOutput(audioContext, master, { runtime: globalThis });
      await new Promise((resolve, reject) => {
        state.readyReject = reject;
        timer = setTimeout(() => reject(new Error('Rust audio processor did not become ready.')), 8000);
        node.port.onmessage = event => {
          if (!current()) return;
          receive(event.data);
          if (event.data.type === 'ready') resolve();
        };
        node.addEventListener('processorerror', () => {
          const error = new Error('Rust audio processor stopped.'); reject(error);
          if (state.node === node) { showError(error.message); void stopAudio({ preserveError: true }); }
        }, { once: true });
        node.port.postMessage({ type: 'install', scalarBytes, simdBytes, requestedBackend: state.requestedBackend,
          configuration: createConfiguration(state.settings, audioContext.sampleRate) }, simdBytes ? [scalarBytes, simdBytes] : [scalarBytes]);
      });
      if (!current()) throw new DOMException('Start cancelled.', 'AbortError');
      state.ready = true; renderSettings(); sendConfiguration();
    } catch (error) {
      if (generation === state.generation) await stopAudio({ preserveError: true });
      else if (audioContext.state !== 'closed') await audioContext.close().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      if (generation === state.generation) { state.starting = false; state.startPromise = null; state.readyReject = null; renderAudio(); }
    }
  })();
  state.startPromise = promise; return promise;
}
async function toggleAudio() {
  if (state.armed || state.starting || state.arming) { await stopAudio(); return; }
  const armRevision = ++state.armRevision; state.arming = true; renderAudio();
  showError();
  try {
    await ensureGraph();
    if (!state.ready || state.disposed || document.hidden) return;
    const audioContext = state.context, generation = state.generation;
    await audioContext.resume();
    if (generation !== state.generation || state.context !== audioContext || !state.ready || state.disposed || document.hidden) return;
    state.armed = true;
    state.master.gain.setTargetAtTime(Number($('outputLevel').value), state.context.currentTime, .012);
    renderAudio(); await recordedInput.start(); announce('Audio on. Pluck the body or play an input.');
  } catch (error) { if (error.name !== 'AbortError') showError(error.message); }
  finally { if (armRevision === state.armRevision) { state.arming = false; renderAudio(); } }
}
function stopMic() {
  state.micRevision++;
  try { state.micSource?.disconnect(); state.micGain?.disconnect(); } catch {}
  for (const track of state.micStream?.getTracks() || []) track.stop();
  if (state.micGain === state.recordedGain) state.recordedGain = null;
  state.micStream = null; state.micSource = null; state.micGain = null; state.micPending = false;
  syncInput(); renderAudio();
}
async function stopAudio({ preserveError = false } = {}) {
  state.generation++; state.readyReject?.(new DOMException('Start cancelled.', 'AbortError'));
  state.armRevision++; state.arming = false;
  state.readyReject = null; state.startPromise = null; state.starting = false;
  recordedInput?.stop(); stopMic();
  const old = { context: state.context, node: state.node, master: state.master, limiter: state.limiter, release: state.releaseOutput };
  if (old.master && old.context?.state !== 'closed') old.master.gain.setTargetAtTime(0, old.context.currentTime, .006);
  state.context = null; state.node = null; state.master = null; state.limiter = null; state.releaseOutput = null;
  state.recordedGain = null; state.armed = false; state.ready = false; state.backend = 'none';
  state.peak = 0; state.rms = 0; state.energy.fill(0); state.modal.fill(0); state.fftInput.fill(0); state.fftOutput.fill(0);
  if (!preserveError) showError(); renderAudio();
  if (old.context && !state.disposed) await new Promise(resolve => setTimeout(resolve, 35));
  old.node?.port.postMessage({ type: 'dispose' });
  try { old.node?.disconnect(); old.limiter?.disconnect(); old.master?.disconnect(); } catch {}
  old.release?.();
  if (old.context?.state !== 'closed') await old.context?.close().catch(() => {});
}
async function startMic() {
  if (state.micPending || state.micStream) return;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone input is not available.');
  const revision = ++state.micRevision; state.micPending = true; renderAudio();
  try {
    await ensureGraph();
    if (revision !== state.micRevision || !state.ready) return;
    const stream = await navigator.mediaDevices.getUserMedia(audioInputConstraints());
    if (revision !== state.micRevision || !state.ready || document.hidden || state.disposed) {
      for (const track of stream.getTracks()) track.stop(); return;
    }
    const source = state.context.createMediaStreamSource(stream), gain = inputControl.createGain(state.context);
    source.connect(gain); gain.connect(state.node);
    state.micStream = stream; state.micSource = source; state.micGain = gain;
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (state.micStream === stream) stopMic(); }, { once: true });
    syncInput();
  } finally { if (revision === state.micRevision) { state.micPending = false; renderAudio(); } }
}
async function changeInput(change, start = false) {
  try { showError(); await change(); if (start) await recordedInput.start(); }
  catch (error) { if (!state.disposed && error.name !== 'AbortError') showError(error.message); }
}
inputControl = mountAudioInputControl({
  container: $('micButton').parentElement, before: $('micButton').nextElementSibling, button: $('micButton'),
  sourceSelect: $('inputSource'), sources: [{ value: 'mic' }, { value: 'sample-file' }, { value: 'file' }], sourceValue: 'mic', fileInput: $('inputFile'),
  onSourceChange: value => { stopMic(); void changeInput(() => recordedInput.selectMode(value === 'sample-file' ? 'samples' : value), true); },
  onStart: () => recordedInput?.snapshot().mode === 'mic' ? startMic() : recordedInput.start(),
  onStop: () => recordedInput?.snapshot().mode === 'mic' ? stopMic() : recordedInput.stop(),
  getState: () => ({ active: inputLive(), pending: state.micPending || Boolean(recordedInput?.snapshot().pending), supported: true,
    source: recordedInput?.snapshot().mode === 'samples' ? 'sample-file' : recordedInput?.snapshot().mode || 'mic' }),
  getSignal: () => state.micStream ? { node: state.micGain, stream: state.micStream } : { node: state.recordedGain, channels: 2 },
});
recordedInput = createInputSource({
  prepare: async () => {
    await ensureGraph();
    if (!state.ready || state.disposed) throw new Error('Input processor has closed.');
    const gain = inputControl.createGain(state.context);
    if (state.recordedGain !== gain) gain.connect(state.node);
    state.recordedGain = gain;
  },
  getContext: () => state.context, getTarget: () => state.recordedGain,
  canPlay: () => state.armed && state.ready && !state.disposed && !document.hidden,
  onChange: input => {
    if (input.playing && !state.inputWasPlaying) state.inputRevision++;
    state.inputWasPlaying = input.playing; syncInput(); if (!state.disposed) renderAudio();
  },
  onError: error => { if (!state.disposed) showError(error.message); },
});

function trigger(strength = .78) {
  if (!state.armed || !state.ready) { announce('Turn on Audio to hear the body.'); return; }
  state.node.port.postMessage({ type: 'trigger', strength: clamp(Number(strength) || 0, 0, 1.5) });
}
function gesture(event) {
  const rect = canvas.getBoundingClientRect();
  updateSettings({ strikePosition: clamp((event.clientX - rect.left) / rect.width, .04, .96),
    hardness: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1) });
}
function releasePointer(event) {
  if (state.pointer !== event.pointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  state.pointer = null;
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || state.pointer !== null) return;
  event.preventDefault(); canvas.focus({ preventScroll: true }); state.pointer = event.pointerId;
  canvas.setPointerCapture(event.pointerId); gesture(event); state.lastStrike = performance.now(); trigger();
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== state.pointer) return;
  gesture(event);
  if (performance.now() - state.lastStrike > 42) { state.lastStrike = performance.now(); trigger(.5); }
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, releasePointer);
canvas.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const keys = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, .04], ArrowDown: [0, -.04] };
  if (keys[event.key]) {
    event.preventDefault(); const [x, y] = keys[event.key];
    updateSettings({ strikePosition: state.settings.strikePosition + x, hardness: state.settings.hardness + y }); trigger(.45);
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); trigger(); }
});

function draw(time) {
  if (state.disposed) return;
  state.frame = requestAnimationFrame(draw);
  if (document.hidden || time - state.lastDraw < 33) return;
  state.lastDraw = time;
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = width / dpr, h = height / dpr, left = 24, right = w - 24, top = 36, bottom = h * .8;
  context2d.fillStyle = '#040d0c'; context2d.fillRect(0, 0, w, h);
  const bandCount = state.settings.fftBandCount;
  for (let i = 0; i < bandCount; i++) {
    const x = left + (right - left) * i / bandCount, bar = Math.max(1, (right - left) / bandCount - 1);
    context2d.fillStyle = '#a78bfa44'; context2d.fillRect(x, bottom - state.fftInput[i] * (bottom - top), bar, state.fftInput[i] * (bottom - top));
    context2d.fillStyle = '#ff6f9177'; context2d.fillRect(x, bottom - state.fftOutput[i] * (bottom - top), Math.max(1, bar * .35), state.fftOutput[i] * (bottom - top));
  }
  for (let strand = 0; strand < 40; strand++) {
    const index = Math.round(strand * 127 / 39), order = 1 + strand * (state.settings.spectralSpan - 1) / 39;
    const energy = clamp(state.energy[index] * 4.4, 0, 1), modal = clamp(state.modal[index], -2, 2);
    const baseline = top + (bottom - top) * strand / 39;
    context2d.beginPath();
    for (let point = 0; point <= 96; point++) {
      const fraction = point / 96;
      const displacement = modal * Math.sin(Math.PI * order * fraction) * (3 + energy * h * .07) * Math.sin(Math.PI * fraction);
      const x = left + (right - left) * fraction, y = baseline + displacement;
      if (!point) context2d.moveTo(x, y); else context2d.lineTo(x, y);
    }
    context2d.strokeStyle = 'rgba(105,247,204,' + (.13 + energy * .7 + Math.min(.08, state.peak * .1)) + ')';
    context2d.lineWidth = .6 + energy; context2d.stroke();
  }
  const x = left + (right - left) * state.settings.strikePosition, y = top + (bottom - top) * (1 - state.settings.hardness);
  context2d.strokeStyle = '#ffd166'; context2d.beginPath(); context2d.arc(x, y, 6, 0, Math.PI * 2); context2d.stroke();
}

$('controlALabel').textContent = 'Waves';
for (const [id, key] of fields) {
  $(id).addEventListener('input', () => updateSettings({ [key]: Number($(id).value) }));
  knobs.push(enhanceRangeKnob($(id), { scale: key === 'modeCount' || key === 'spectralSpan' ? 'log' : 'linear' }));
}
for (const id of ['fftSize', 'fftWindow']) $(id).addEventListener('change', () => updateSettings({ [id]: Number($(id).value) }));
$('presetSelect').replaceChildren(new Option('Custom body', ''), ...materialPresets.map(preset => new Option(preset.label, preset.id)));
$('presetSelect').addEventListener('change', () => applyMaterial($('presetSelect').value));
$('audioButton').addEventListener('click', () => void toggleAudio());
$('pluckButton').addEventListener('click', () => trigger());
$('outputLevel').addEventListener('input', () => {
  $('outputLevelOut').value = percent(Number($('outputLevel').value));
  if (state.master) state.master.gain.setTargetAtTime(state.armed ? Number($('outputLevel').value) : 0, state.context.currentTime, .015);
});
$('backendSelect').value = state.requestedBackend;
$('backendSelect').addEventListener('change', () => {
  state.requestedBackend = $('backendSelect').value; state.node?.port.postMessage({ type: 'backend', backend: state.requestedBackend });
});
$('inputSample').replaceChildren(...SAMPLE_INPUT_OPTIONS.map(option => new Option(option.label.replace(/^Sample · /, ''), option.id)));
$('inputSample').addEventListener('change', () => void changeInput(() => recordedInput.selectSample($('inputSample').value), true));
$('inputLoop').addEventListener('change', () => recordedInput.setLoop($('inputLoop').checked));
$('inputPlay').addEventListener('click', () => {
  const input = recordedInput.snapshot();
  if (input.playing || input.pending) recordedInput.stop(); else void changeInput(() => recordedInput.start());
});
$('inputFile').addEventListener('change', () => {
  const file = $('inputFile').files?.[0]; if (!file) return;
  stopMic(); void changeInput(() => recordedInput.loadFile(file)); $('inputFile').value = '';
});
$('resetButton').addEventListener('click', () => {
  for (const knob of knobs) knob.cancelGesture();
  state.node?.port.postMessage({ type: 'reset' }); updateSettings(DEFAULTS); showError();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    recordedInput.stop(); stopMic();
    if (state.starting) void stopAudio();
    else state.context?.suspend().catch(() => {});
  } else if (state.ready) state.context?.resume().catch(() => {});
});
globalThis.addEventListener('pagehide', () => {
  state.disposed = true; cancelAnimationFrame(state.frame);
  for (const knob of knobs) knob.destroy();
  recordedInput.dispose(); presetController?.destroy(); inputControl.destroy(); void stopAudio();
}, { once: true });
globalThis.addEventListener('pageshow', event => { if (event.persisted && state.disposed) location.reload(); });
presetController = registerHeaderPresets({ id: 'simd-resonator-rust', presets: PRESETS,
  capture: () => capturePreset(state.settings), apply: applyFullPreset, randomize: randomizePreset });
globalThis.__MORPHAZOID_RUST_RESONATOR__ = Object.freeze({
  getState: () => ({ audioOn: state.armed && state.ready, audioReady: state.ready, audioStarting: state.starting || state.arming,
    contextState: state.context?.state || 'none', contextTime: state.context?.currentTime || 0, backend: state.backend,
    maxModes: MAX_MODES, workCount: state.settings.modeCount, settings: { ...state.settings }, micOn: Boolean(state.micStream),
    input: recordedInput.snapshot(), inputPlaybackRevision: state.inputRevision, inputGain: Number(inputControl.gainInput.value),
    outputLevel: Number($('outputLevel').value), fullPresetId: presetController?.selectedId, peak: state.peak, rms: state.rms,
    renderedFrames: state.telemetry.renderedFrames || 0, renderedModeCount: state.telemetry.modeCount || 0, callbackMicros: state.telemetry.callbackMicros || 0,
    callbackMaxMicros: state.telemetry.callbackMaxMicros || 0, callbackOverruns: state.telemetry.callbackOverruns || 0,
    timingResolution: state.telemetry.timingResolution, fftInputPeak: Math.max(...state.fftInput), fftOutputPeak: Math.max(...state.fftOutput) }),
  trigger, updateSettings,
});
renderSettings(); renderAudio(); state.frame = requestAnimationFrame(draw);
