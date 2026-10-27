import { createMidiNotePerformance } from "../../midi-manager.js";
import { mountAudioInputControl } from '../../audio-input-control.js';
import { audioInputConstraints } from '../../audio-input-settings.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';
import { createInputSource, SAMPLE_INPUT_OPTIONS } from '../micmic/native/input-source.js';
import { presetsForSimdEngine } from '../../simd-resonator.js';
import { DEFAULTS, LIMITS, MAX_MODES, MAX_FFT_BANDS, createConfiguration } from './model.js';
import { PRESETS, DEFAULT_PRESET_SETTINGS, sanitizePresetSettings, applicationForSettings, APPLICATION_MODES, signalSettingsForPreset,
  REVERB_CHARACTERS, RESYNTHESIS_CHARACTERS, capturePreset, validatePreset, randomizePreset } from './presets.js';
import { sanitizeSpatialSettings } from './spatial-model.js';
import { createResonatorSurroundOutput } from './surround-output.js';
import { mountResonatorRecording } from './recording.js';
import { spartialLayout, spartialSpeakers } from '../spartial/spartial-audio.js';

const $ = id => document.getElementById(id);
const canvas = $('resonatorCanvas'), context2d = canvas.getContext('2d', { alpha: false });
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const percent = value => Math.round(value * 100) + '%';
const pitchLabel = value => Number(value.toFixed(1)) + ' Hz';
const [pitchMin, pitchMax] = LIMITS.baseFrequency;
const [strikeMin, strikeMax] = LIMITS.strikePosition;
const pitchSpan = Math.log(pitchMax / pitchMin);
const forceScalar = new URLSearchParams(location.search).get('scalar') === '1';
const materialPresets = presetsForSimdEngine('resonator');
const fields = [
  ['controlA', 'modeCount', value => String(Math.round(value))],
  ['controlB', 'baseFrequency', pitchLabel],
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
  ['spaceSpan', 'spaceSpan', value => Number(value.toFixed(2)) + ''],
  ['spaceOffset', 'spaceOffset', value => Math.round(value * 360) + '°'],
  ['spaceRate', 'spaceRate', value => Number(value.toFixed(3)) + ''],
  ['excitationStrength', 'excitationStrength', percent],
  ['excitationDurationMs', 'excitationDurationMs', value => Math.round(value) + ' ms'],
  ['bodyMix', 'bodyMix', percent], ['wetMix', 'wetMix', value => percent(value) + ' wet'],
  ['filterFrequency', 'filterFrequency', value => value < 1000 ? Math.round(value) + ' Hz' : (value / 1000).toFixed(1) + ' kHz'],
  ['drive', 'drive', value => Number(value.toFixed(2)) + '×'],
  ['reverbTime', 'reverbTime', value => Number(value.toFixed(2)) + ' s'],
  ['reverbDamping', 'reverbDamping', percent], ['reverbMix', 'reverbMix', percent],
];
const state = {
  settings: { ...DEFAULT_PRESET_SETTINGS }, context: null, node: null, master: null, limiter: null,
  spatialMaster: null, output: null, routeInfo: null, surround: { enabled: false, layoutId: '8-circle', forcePreview: false },
  ready: false, starting: false, arming: false, armRevision: 0, armed: false, disposed: false, generation: 0, startPromise: null, readyReject: null,
  backend: 'none', requestedBackend: forceScalar ? 'scalar' : 'simd', simdAvailable: false,
  micStream: null, micSource: null, micGain: null, micPending: false, micRevision: 0, recordedGain: null,
  inputKind: 'excitation', inputRevision: 0, inputWasPlaying: false, pointer: null, lastStrike: 0, materialId: null,
  peak: 0, rms: 0, telemetry: {}, energy: new Float32Array(128), modal: new Float32Array(128),
  fftInput: new Float32Array(MAX_FFT_BANDS), fftOutput: new Float32Array(MAX_FFT_BANDS), frame: 0, lastDraw: 0,
};
let inputControl, recordedInput, presetController, recording;
const knobs = [];
const choices = new Map();
const channelMeters = [];
function showError(message = '') { $('audioError').textContent = message; $('audioError').hidden = !message; }
function announce(message) { $('liveStatus').textContent = message; }
function inputLive() { return Boolean(state.micStream || recordedInput?.snapshot().playing); }
function syncInput() { state.node?.port.postMessage({ type: 'mic', active: inputLive() }); }
function spatialConfiguration(settings = state.settings) {
  return sanitizeSpatialSettings({ enabled: state.routeInfo?.enabled ?? state.surround.enabled,
    speakerCount: state.output ? state.routeInfo.speakers.length : spartialSpeakers(spartialLayout(state.surround.layoutId), true).length,
    target: settings.applicationMode === 'body' ? 'modes' : settings.applicationMode === 'resynthesis' ? 'fft' : 'both',
    pattern: settings.spacePattern, span: settings.spaceSpan,
    offset: settings.spaceOffset, motion: settings.spaceMotion, rate: settings.spaceRate });
}
function signalConfiguration(settings = state.settings) {
  return signalSettingsForPreset(settings);
}
function sendSignalConfiguration() {
  if (state.ready) state.node?.port.postMessage({ type: 'signal', configuration: signalConfiguration() });
}
function renderMode() {
  const settings = state.settings;
  $('applicationMode').value = settings.applicationMode;
  for (const [mode, section] of [['body', 'bodySection'], ['processing', 'processingSection'],
    ['resynthesis', 'resynthesisSection'], ['reverb', 'reverbSection']]) {
    $(section).hidden = settings.applicationMode !== mode;
  }
  $('materialSection').hidden = settings.applicationMode !== 'body';
  $('excitationType').value = settings.excitationType; $('filterType').value = settings.filterType;
  $('excitationDurationControl').hidden = settings.excitationType === 'impulse';
  $('filterFrequency').disabled = settings.filterType === 'bypass';
  for (const [id, bank] of [['reverbCharacter', REVERB_CHARACTERS], ['resynthesisCharacter', RESYNTHESIS_CHARACTERS]]) {
    $(id).value = bank.find(item => Object.entries(item.settings).every(([key, value]) => settings[key] === value))?.id || '';
  }
  for (const id of ['applicationMode', 'excitationType', 'filterType', 'reverbCharacter', 'resynthesisCharacter', 'presetSelect']) choices.get(id)?.refresh();
}
function sendSpatialConfiguration() {
  if (state.ready) state.node?.port.postMessage({ type: 'spatial', configuration: spatialConfiguration() });
}
function renderSurround() {
  const info = state.routeInfo;
  $('surroundEnabled').checked = state.surround.enabled;
  $('surroundEnabled').disabled = Boolean(recording?.locked);
  $('surroundLayout').disabled = Boolean(recording?.locked);
  $('surroundLayout').value = state.surround.layoutId;
  $('surroundPreview').checked = state.surround.forcePreview;
  $('surroundOptions').hidden = !state.surround.enabled;
  $('spatialDistributionControls').hidden = !['body', 'resynthesis'].includes(state.settings.applicationMode);
  $('spacePattern').value = state.settings.spacePattern;
  $('spaceMotion').checked = state.settings.spaceMotion;
  $('surroundSummary').textContent = !state.surround.enabled ? 'Stereo' : info?.mode === 'discrete' ? info.channelCount + ' channels' : 'Stereo preview';
  $('surroundStatus').textContent = !state.ready ? 'Turn on Audio to hear the speaker layout.'
    : info?.mode === 'discrete' ? info.channelCount + ' output channels. LFE channels stay silent.'
    : state.surround.forcePreview ? 'Stereo preview. Recording keeps separate speaker channels.'
    : 'Stereo preview: the selected output exposes fewer channels than this layout. Recording keeps separate channels.';
  const layout = state.output ? info.layout : spartialLayout(state.surround.layoutId);
  const speakers = layout.speakers, activeSpeakers = spartialSpeakers(layout, true);
  const signature = speakers.map(speaker => speaker.channel + ':' + speaker.label).join('|');
  if ($('surroundMeters').dataset.layout !== signature) {
    $('surroundMeters').dataset.layout = signature; $('surroundMeters').replaceChildren(); channelMeters.length = 0;
    for (const speaker of speakers) {
      const cell = document.createElement('div'), bar = document.createElement('i'), label = document.createElement('span');
      cell.className = 'rezo-channel-meter'; cell.title = speaker.channel + ': ' + speaker.label;
      label.textContent = speaker.channel; cell.append(bar, label); $('surroundMeters').append(cell);
      channelMeters.push({ bar, logical: activeSpeakers.findIndex(active => active.channel === speaker.channel) });
    }
    $('surroundChannelMap').textContent = speakers.map(speaker => speaker.channel + ': ' + speaker.label + (speaker.kind === 'lfe' ? ' (silent)' : '')).join(' · ');
  }
  for (const id of ['surroundLayout', 'spacePattern']) choices.get(id)?.refresh();
}
function routeSurround(patch) {
  if (recording?.locked && ('enabled' in patch || 'layoutId' in patch)) { renderSurround(); return; }
  const next = { ...state.surround, ...patch };
  if (state.output?.route(next) === false) { renderSurround(); return; }
  state.surround = next;
  sendSpatialConfiguration(); renderSurround(); recording?.update();
}

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
  const bodyGesture = state.settings.applicationMode === 'body';
  $('strikeReadout').textContent = bodyGesture
    ? percent(state.settings.strikePosition) + ' position · ' + pitchLabel(state.settings.baseFrequency)
    : percent(state.settings.excitationStrength) + ' strength' + (state.settings.excitationType === 'impulse' ? '' : ' · ' + Math.round(state.settings.excitationDurationMs) + ' ms');
  $('gestureXAxis').textContent = bodyGesture ? '← Strike position →' : '← Excitation strength →';
  $('gestureYAxis').textContent = bodyGesture ? '↑ Higher pitch · Lower pitch ↓'
    : state.settings.excitationType === 'impulse' ? 'Single-sample impulse' : '↑ Shorter burst · Longer burst ↓';
  canvas.setAttribute('aria-label', 'Playable resonator. ' + (bodyGesture
    ? 'Drag horizontally for strike position and vertically for body pitch, higher at the top. Hardness has a separate knob.'
    : state.settings.excitationType === 'impulse' ? 'Drag horizontally for impulse strength.'
      : 'Drag horizontally for excitation strength and vertically for burst duration.') + ' Arrow keys adjust; Enter or Space excites the selected sound when Audio is on.');
  $('presetSelect').value = state.materialId || '';
  $('presetDescription').textContent = materialPresets.find(preset => preset.id === state.materialId)?.note || 'Drag for strike position and pitch. Use Hardness to shape the attack.';
  for (const knob of knobs) knob.update();
  renderMode(); renderSurround(); renderGesture();
}
function renderInput() {
  if (!recordedInput) return;
  const input = recordedInput.snapshot();
  $('recordedInputControls').hidden = state.inputKind === 'mic' || state.inputKind === 'excitation';
  $('inputSampleControl').hidden = input.mode !== 'samples';
  $('inputFileControl').hidden = input.mode !== 'file';
  $('inputSource').value = state.inputKind;
  $('inputSample').value = input.sampleId; $('inputLoop').checked = input.loop;
  const playbackLabel = input.pending ? 'Cancel loading' : input.playing ? 'Stop input' : 'Play input';
  $('inputPlay').firstElementChild.textContent = input.pending ? '×' : input.playing ? '■' : '▶';
  $('inputPlay').setAttribute('aria-label', playbackLabel); $('inputPlay').title = playbackLabel;
  $('inputPlay').setAttribute('aria-pressed', String(input.playing));
  $('inputPlay').setAttribute('aria-busy', String(input.pending));
  $('inputCredit').hidden = !input.credit;
  if ($('inputCredit').dataset.credit !== input.credit) {
    $('inputCredit').dataset.credit = input.credit; $('inputCredit').replaceChildren();
    if (input.creditUrl) {
      const link = document.createElement('a'); link.href = input.creditUrl; link.textContent = input.credit;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; $('inputCredit').append(link);
    } else $('inputCredit').textContent = input.credit;
  }
  $('inputSummary').textContent = inputLive() ? 'input live' : state.armed ? 'excite or input' : 'Audio off';
  choices.get('inputSource')?.refresh(); choices.get('inputSample')?.refresh();
}
function renderAudio() {
  $('audioButton').setAttribute('aria-pressed', String(state.armed && state.ready));
  $('audioButton').setAttribute('aria-busy', String(state.starting || state.arming));
  $('audioState').textContent = state.starting || state.arming ? 'loading' : state.armed ? 'on' : 'off';
  $('backendMetric').textContent = state.ready ? 'Rust ' + (state.backend === 'simd' ? 'SIMD ×4' : 'scalar') : state.starting ? 'loading' : 'not loaded';
  $('backendSelect').value = state.requestedBackend;
  inputControl?.refresh(); renderInput(); renderSurround(); recording?.update();
}
function sendConfiguration(performanceUpdate = false) {
  if (!state.ready || !state.node) return;
  state.node.port.postMessage({ type: performanceUpdate ? 'performance' : 'configure', configuration: createConfiguration(state.settings, state.context.sampleRate) });
  sendSignalConfiguration(); sendSpatialConfiguration();
}
function updateSettings(patch) {
  const previous = state.settings;
  const next = { ...state.settings, ...patch };
  state.settings = { ...sanitizePresetSettings(next) };
  const changed = Object.keys(DEFAULTS).filter(key => previous[key] !== state.settings[key]);
  if (changed.length) state.materialId = null;
  renderSettings();
  if (changed.length) sendConfiguration(changed.every(key => ['baseFrequency', 'strikePosition', 'hardness'].includes(key)));
  else { sendSignalConfiguration(); sendSpatialConfiguration(); }
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
  state.settings = { ...sanitizePresetSettings({ ...state.settings, ...preset.settings, spectralSpan: preset.settings.modeCount, ...fft }) };
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
    for (const meter of channelMeters) meter.bar.style.transform = 'scaleY(' + (meter.logical < 0 ? 0 : clamp((message.spatialPeaks?.[meter.logical] || 0) * 2, 0, 1)) + ')';
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
        numberOfInputs: 1, numberOfOutputs: 2, outputChannelCount: [2, 16], channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      });
      const limiter = audioContext.createDynamicsCompressor();
      limiter.threshold.value = -8; limiter.knee.value = 8; limiter.ratio.value = 12; limiter.attack.value = .002; limiter.release.value = .12;
      const master = audioContext.createGain(); master.gain.value = 0;
      const spatialMaster = audioContext.createGain(); spatialMaster.gain.value = 0;
      spatialMaster.channelCount = 16; spatialMaster.channelCountMode = 'explicit'; spatialMaster.channelInterpretation = 'discrete';
      node.connect(limiter, 0); limiter.connect(master); node.connect(spatialMaster, 1);
      state.node = node; state.limiter = limiter; state.master = master; state.spatialMaster = spatialMaster;
      state.output = createResonatorSurroundOutput({ context: audioContext, stereoSource: master, spatialSource: spatialMaster,
        getAudioOn: () => state.armed && state.ready, settings: state.surround,
        onRoute: info => {
          if (state.context !== audioContext || generation !== state.generation) return;
          state.routeInfo = info; renderSurround(); sendSpatialConfiguration(); recording?.update();
        } });
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
    state.spatialMaster.gain.setTargetAtTime(Number($('outputLevel').value), state.context.currentTime, .012);
    renderAudio(); await recordedInput.start(); announce('Audio on. Excite the resonator or play an input.');
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
  const old = { context: state.context, node: state.node, master: state.master, limiter: state.limiter, spatialMaster: state.spatialMaster, output: state.output };
  if (old.master && old.context?.state !== 'closed') old.master.gain.setTargetAtTime(0, old.context.currentTime, .006);
  if (old.spatialMaster && old.context?.state !== 'closed') old.spatialMaster.gain.setTargetAtTime(0, old.context.currentTime, .006);
  const finishRecording = recording?.stop(state.disposed ? 'pagehide' : 'audio-off');
  state.context = null; state.node = null; state.master = null; state.limiter = null; state.spatialMaster = null; state.output = null;
  state.recordedGain = null; state.armed = false; state.ready = false; state.backend = 'none';
  state.peak = 0; state.rms = 0; state.energy.fill(0); state.modal.fill(0); state.fftInput.fill(0); state.fftOutput.fill(0);
  state.telemetry = {};
  for (const meter of channelMeters) meter.bar.style.transform = 'scaleY(0)';
  if (!preserveError) showError(); renderAudio();
  await finishRecording;
  if (old.context && !state.disposed) await new Promise(resolve => setTimeout(resolve, 35));
  old.node?.port.postMessage({ type: 'dispose' });
  try { old.node?.disconnect(); old.limiter?.disconnect(); old.master?.disconnect(); old.spatialMaster?.disconnect(); } catch {}
  old.output?.destroy();
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
  onStart: async () => {
    const revision = ++state.micRevision;
    state.inputKind = 'mic';
    await recordedInput.selectMode('mic');
    if (revision !== state.micRevision || state.disposed || document.hidden) return;
    return startMic();
  },
  onStop: stopMic,
  getState: () => ({ active: Boolean(state.micStream), pending: state.micPending, supported: true, source: 'mic' }),
  getSignal: () => ({ node: state.micGain, stream: state.micStream }),
});
inputControl.gainInput.setAttribute('aria-label', 'Microphone gain');
inputControl.gainInput.title = 'Microphone gain; samples and files use their own source level';
recordedInput = createInputSource({
  prepare: async () => {
    await ensureGraph();
    if (!state.ready || state.disposed) throw new Error('Input processor has closed.');
    if (!state.recordedGain) {
      state.recordedGain = state.context.createGain();
      state.recordedGain.gain.value = 1;
      state.recordedGain.connect(state.node);
    }
  },
  getContext: () => state.context, getTarget: () => state.recordedGain,
  canPlay: () => state.armed && state.ready && !state.disposed && !document.hidden,
  onChange: input => {
    if (input.playing && !state.inputWasPlaying) state.inputRevision++;
    state.inputWasPlaying = input.playing; syncInput(); if (!state.disposed) renderAudio();
  },
  onError: error => { if (!state.disposed) showError(error.message); },
});

function trigger(strength = 1) {
  if (!state.armed || !state.ready) { announce('Turn on Audio to hear the excitation.'); return; }
  state.node.port.postMessage({ type: 'excite', kind: state.settings.excitationType,
    strength: clamp((Number(strength) || 0) * state.settings.excitationStrength, 0, 1.5), durationMs: state.settings.excitationDurationMs });
}
function plotBounds(width, height) {
  return { left: 24, right: Math.max(25, width - 24), top: 36, bottom: Math.max(37, height * .8) };
}
function renderGesture() {
  const rect = canvas.getBoundingClientRect(), bounds = plotBounds(rect.width, rect.height), settings = state.settings;
  const x = settings.applicationMode === 'body' ? (settings.strikePosition - strikeMin) / (strikeMax - strikeMin) : settings.excitationStrength / 1.5;
  const y = settings.applicationMode === 'body' ? Math.log(pitchMax / settings.baseFrequency) / pitchSpan
    : settings.excitationType === 'impulse' ? .5 : Math.log(settings.excitationDurationMs) / Math.log(300);
  const marker = $('excitationMarker');
  marker.style.left = bounds.left + (bounds.right - bounds.left) * clamp(x, 0, 1) + 'px';
  marker.style.top = bounds.top + (bounds.bottom - bounds.top) * clamp(y, 0, 1) + 'px';
  marker.classList.toggle('is-active', state.pointer !== null);
}
function gesture(event) {
  const rect = canvas.getBoundingClientRect(), bounds = plotBounds(rect.width, rect.height);
  const x = clamp((event.clientX - rect.left - bounds.left) / (bounds.right - bounds.left), 0, 1);
  const y = clamp((event.clientY - rect.top - bounds.top) / (bounds.bottom - bounds.top), 0, 1);
  updateSettings(state.settings.applicationMode === 'body'
    ? { strikePosition: strikeMin + x * (strikeMax - strikeMin), baseFrequency: pitchMax * Math.exp(-y * pitchSpan) }
    : { excitationStrength: x * 1.5, ...(state.settings.excitationType === 'impulse' ? {} : { excitationDurationMs: 300 ** y }) });
}
function releasePointer(event) {
  if (state.pointer !== event.pointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  state.pointer = null; renderGesture();
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
    updateSettings(state.settings.applicationMode === 'body'
      ? { strikePosition: state.settings.strikePosition + x, baseFrequency: state.settings.baseFrequency * Math.exp(y * .5 * pitchSpan) }
      : { excitationStrength: state.settings.excitationStrength + x * 1.5,
        ...(state.settings.excitationType === 'impulse' ? {} : { excitationDurationMs: state.settings.excitationDurationMs * 300 ** -y }) });
    trigger(.45);
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
  const w = rect.width, h = rect.height, { left, right, top, bottom } = plotBounds(w, h);
  context2d.fillStyle = '#040d0c'; context2d.fillRect(0, 0, w, h);
  const bandCount = state.settings.fftBandCount;
  const visibleBands = Math.min(bandCount, Math.max(1, Math.floor(right - left)));
  for (let i = 0; i < visibleBands; i++) {
    // Preserve narrow peaks when several logarithmic groups share a screen pixel.
    const first = Math.floor(i * bandCount / visibleBands), end = Math.floor((i + 1) * bandCount / visibleBands);
    let input = 0, output = 0;
    for (let band = first; band < end; band++) { input = Math.max(input, state.fftInput[band]); output = Math.max(output, state.fftOutput[band]); }
    const x = left + (right - left) * i / visibleBands, bar = Math.max(1, (right - left) / visibleBands - 1);
    context2d.fillStyle = '#a78bfa44'; context2d.fillRect(x, bottom - input * (bottom - top), bar, input * (bottom - top));
    context2d.fillStyle = '#ff6f9177'; context2d.fillRect(x, bottom - output * (bottom - top), Math.max(1, bar * .35), output * (bottom - top));
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
  renderGesture();
}

$('controlALabel').textContent = 'Waves';
for (const [id, key] of fields) {
  $(id).addEventListener('input', () => updateSettings({ [key]: Number($(id).value) }));
  knobs.push(enhanceRangeKnob($(id), { scale: ['modeCount', 'baseFrequency', 'spectralSpan', 'filterFrequency', 'drive'].includes(key) ? 'log' : 'linear' }));
}
for (const id of ['fftSize', 'fftWindow']) $(id).addEventListener('change', () => updateSettings({ [id]: Number($(id).value) }));
$('presetSelect').replaceChildren(new Option('Custom body', ''), ...materialPresets.map(preset => new Option(preset.label, preset.id)));
$('presetSelect').addEventListener('change', () => applyMaterial($('presetSelect').value));
$('applicationMode').replaceChildren(...APPLICATION_MODES.map(mode => new Option(mode.label, mode.id)));
$('applicationMode').addEventListener('change', () => updateSettings({ applicationMode: $('applicationMode').value }));
for (const [id, bank] of [['reverbCharacter', REVERB_CHARACTERS], ['resynthesisCharacter', RESYNTHESIS_CHARACTERS]]) {
  $(id).replaceChildren(new Option('Custom', ''), ...bank.map(item => new Option(item.label, item.id)));
  $(id).addEventListener('change', () => {
    const character = bank.find(item => item.id === $(id).value);
    if (character) updateSettings(character.settings);
  });
}
$('filterType').addEventListener('change', () => updateSettings({ filterType: $('filterType').value }));
$('excitationType').addEventListener('change', () => {
  const excitationType = $('excitationType').value;
  const duration = { impulse: 1, 'white-noise': 30, 'pink-noise': 30, pluck: 18, 'soft-mallet': 8, 'hard-mallet': 3 };
  updateSettings({ excitationType, excitationDurationMs: duration[excitationType] });
});
$('audioButton').addEventListener('click', () => void toggleAudio());
$('pluckButton').addEventListener('click', () => trigger());
// This is one struck body, not a polyphonic keyboard. Notes excite the selected
// body; release/bend/pressure never retune it or attenuate already-ringing tails.
const midiNotes = createMidiNotePerformance({
  onNoteOn: (_id, { velocity }) => trigger(velocity),
  onPanic: () => state.node?.port.postMessage({ type: 'reset' }),
});
function receiveMidi(event) {
  const { message, routeId, source } = event.detail || {};
  if (!message || routeId && routeId !== 'simd-resonator-rust') return;
  if (source === 'wax') return; // Retain the host adapter's own processor contract.
  if (midiNotes.handle(message)) event.preventDefault();
}
globalThis.addEventListener('morphazoid:midi-input', receiveMidi);
globalThis.addEventListener('blur', () => midiNotes.reset());

$('outputLevel').addEventListener('input', () => {
  $('outputLevelOut').value = percent(Number($('outputLevel').value));
  if (state.master) state.master.gain.setTargetAtTime(state.armed ? Number($('outputLevel').value) : 0, state.context.currentTime, .015);
  if (state.spatialMaster) state.spatialMaster.gain.setTargetAtTime(state.armed ? Number($('outputLevel').value) : 0, state.context.currentTime, .015);
});
$('backendSelect').value = state.requestedBackend;
$('backendSelect').addEventListener('change', () => {
  state.requestedBackend = $('backendSelect').value; state.node?.port.postMessage({ type: 'backend', backend: state.requestedBackend });
});
$('inputSample').replaceChildren(...SAMPLE_INPUT_OPTIONS.map(option => new Option(option.label.replace(/^Sample · /, ''), option.id)));
for (const [id, label] of [['applicationMode', 'Mode'], ['inputSource', 'Source'], ['inputSample', 'Sample'], ['excitationType', 'Excite'],
  ['filterType', 'Filter'], ['presetSelect', 'Material'], ['reverbCharacter', 'Reverb character'], ['resynthesisCharacter', 'Resynthesis character'],
  ['surroundLayout', 'Speakers'], ['spacePattern', 'Order']]) choices.set(id, enhanceChooseSelect($(id), { label }));
$('inputSource').addEventListener('change', () => {
  const mode = $('inputSource').value;
  state.inputKind = mode;
  stopMic(); void changeInput(() => recordedInput.selectMode(mode === 'sample-file' ? 'samples' : mode === 'excitation' ? 'mic' : mode), true);
});
$('inputSample').addEventListener('change', () => void changeInput(() => recordedInput.selectSample($('inputSample').value), true));
$('inputLoop').addEventListener('change', () => recordedInput.setLoop($('inputLoop').checked));
$('inputPlay').addEventListener('click', () => {
  const input = recordedInput.snapshot();
  if (input.playing || input.pending) recordedInput.stop(); else void changeInput(() => recordedInput.start());
});
$('inputFile').addEventListener('change', () => {
  const file = $('inputFile').files?.[0]; if (!file) return;
  void changeInput(async () => {
    const loading = recordedInput.loadFile(file);
    // loadFile validates before changing its mode. Keep the previous source
    // and label when it rejects an empty or oversized file.
    if (recordedInput.snapshot().mode === 'file') {
      state.inputKind = 'file'; stopMic();
      renderInput();
    }
    await loading;
  }); $('inputFile').value = '';
});
$('chooseInputFile').addEventListener('click', () => $('inputFile').click());
$('surroundEnabled').addEventListener('change', () => routeSurround({ enabled: $('surroundEnabled').checked }));
$('surroundLayout').addEventListener('change', () => routeSurround({ layoutId: $('surroundLayout').value }));
$('surroundPreview').addEventListener('change', () => routeSurround({ forcePreview: $('surroundPreview').checked }));
$('spacePattern').addEventListener('change', () => updateSettings({ spacePattern: $('spacePattern').value }));
$('spaceMotion').addEventListener('change', () => updateSettings({ spaceMotion: $('spaceMotion').checked }));
$('resetButton').addEventListener('click', () => {
  for (const knob of knobs) knob.cancelGesture();
  state.node?.port.postMessage({ type: 'reset' }); updateSettings(DEFAULT_PRESET_SETTINGS); showError();
});
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    midiNotes.reset();
    recordedInput.stop(); stopMic();
    if (state.starting) void stopAudio();
    else {
      const audioContext = state.context;
      await recording?.stop('page-hidden');
      if (document.hidden && state.context === audioContext) audioContext?.suspend().catch(() => {});
    }
  } else if (state.ready) state.context?.resume().catch(() => {});
});
globalThis.addEventListener('pagehide', () => {
  state.disposed = true; cancelAnimationFrame(state.frame);
  midiNotes.reset(); globalThis.removeEventListener('morphazoid:midi-input', receiveMidi);
  for (const knob of knobs) knob.destroy();
  for (const choice of choices.values()) choice.destroy();
  recordedInput.dispose(); presetController?.destroy(); inputControl.destroy();
  void stopAudio().finally(() => recording?.destroy());
}, { once: true });
globalThis.addEventListener('pageshow', event => { if (event.persisted && state.disposed) location.reload(); });
presetController = registerHeaderPresets({ id: 'simd-resonator-rust', presets: PRESETS,
  capture: () => capturePreset(state.settings), apply: applyFullPreset, randomize: randomizePreset });
recording = mountResonatorRecording({
  audio: {
    canRecord: () => state.output?.canRecord() || false,
    recordingContext: () => state.output?.recordingContext() || null,
    recordingSampleRate: () => state.output?.recordingSampleRate() || 48000,
    tapInto: (...args) => state.output?.tapInto(...args),
  },
  getPatch: () => ({ ...state.surround, omitLfe: true }),
  onLockChange: locked => { state.output?.setLocked(locked); renderSurround(); },
});
globalThis.__MORPHAZOID_RUST_RESONATOR__ = Object.freeze({
  getState: () => ({ audioOn: state.armed && state.ready, audioReady: state.ready, audioStarting: state.starting || state.arming,
    contextState: state.context?.state || 'none', contextTime: state.context?.currentTime || 0, backend: state.backend,
    maxModes: MAX_MODES, workCount: state.settings.modeCount, settings: { ...state.settings }, micOn: Boolean(state.micStream),
    input: { ...recordedInput.snapshot(), mode: state.inputKind === 'excitation' ? 'excitation' : recordedInput.snapshot().mode },
    inputKind: state.inputKind, application: applicationForSettings(state.settings),
    signal: signalConfiguration(), inputPlaybackRevision: state.inputRevision, inputGain: Number(inputControl.gainInput.value),
    outputLevel: Number($('outputLevel').value), fullPresetId: presetController?.selectedId, peak: state.peak, rms: state.rms,
    renderedFrames: state.telemetry.renderedFrames || 0, renderedModeCount: state.telemetry.modeCount || 0, callbackMicros: state.telemetry.callbackMicros || 0,
    callbackMaxMicros: state.telemetry.callbackMaxMicros || 0, callbackOverruns: state.telemetry.callbackOverruns || 0,
    timingResolution: state.telemetry.timingResolution, fftInputPeak: Math.max(...state.fftInput), fftOutputPeak: Math.max(...state.fftOutput),
    surround: { ...state.surround, mode: state.routeInfo?.mode || 'stereo', channelCount: state.routeInfo?.channelCount || 2 },
    spatialPeaks: Array.from(state.telemetry.spatialPeaks || []), spatialRms: Array.from(state.telemetry.spatialRms || []),
    spatialEnabled: state.telemetry.spatialEnabled || false, spatialPhase: state.telemetry.spatialPhase || 0,
    recording: recording?.getStatus() }),
  trigger, updateSettings,
});
renderSettings(); renderAudio(); state.frame = requestAnimationFrame(draw);
