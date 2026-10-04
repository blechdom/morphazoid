import { createAudioInputStrip } from '../../../ui/patterns/audio-input-strip.js';
import { createAudioStrip } from '../../../ui/patterns/audio-strip.js';
import { createStereoMeter } from '../../../ui/patterns/level-meter.js';
import { createChoosePickerShell } from '../../../ui/patterns/choose-picker-shell.js';
import { createTapTempoButton } from '../../../ui/primitives/tap-tempo-button.js';
import { registerHeaderPresets, presetStateKey } from '../../../site/header-presets.js';
import { generationTopology, timeFoldFromSlider, sliderFromTimeFold } from '../micmic.js';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, sanitizeParameters, sanitizePerformance,
  presetState, randomState, captureScene, generationPresetParameters, gestureParameters, clamp, admittedPreviewNodes,
  buildPreview, interpolateParameters, topologyBounds, fitTransform, visualBudget, nativePreviewNodes, interpolatePreviewNodes,
  topologyIdentity, tapActivityFrame, activityEnergy, smoothActivity, branchBaselineAlpha, branchWavePoints, inputHistoryFrame } from './model.js';
import { DEFAULT_MASTERING, MASTERING_PROFILES, masteringProfileId, cutoffFromSlider, sliderFromCutoff } from './mastering.js';
import { createBrowserDelayEngine } from './browser-engine.js';

import { FAVE_TOOL_IDS, TOOL_GROUPS } from '../../../site/instrument-registry.js';
import { createMidiStatus } from '../../../ui/patterns/midi-status.js';
import { installBrowserMidiAdapter } from '../../../browser-midi-adapter.js';
import { getSharedMidiManager } from '../../../midi-manager.js';

const SITE_ROOT = new URL('../../../../', import.meta.url);
const $ = id => document.getElementById(id);
const state = { parameters: { ...DEFAULT_PARAMETERS }, performance: { ...DEFAULT_PERFORMANCE }, audio: false, status: {}, requestedVoices: 0, eligibleVoices: 0, generationLimits: {}, memoryVoiceCapacity: Number.MAX_SAFE_INTEGER };
const CONTROL_IDS = { generations: 'generations', intervalMs: 'interval', timeRatio: 'timeRatio', angle: 'generationAngle',
  asymmetry: 'generationAsymmetry', mutation: 'mutation', pitchScale: 'generationPitchScale', pruningBias: 'pruningBias', depth: 'depth', spread: 'spread' };
const PERFORMANCE_IDS = { frequency: 'frequency', pulseRate: 'pulseRate', wet: 'wet', dry: 'dry', inputGain: 'inputTrim', level: 'level', voiceCeiling: 'voiceCeiling' };
const MASTERING_FREQUENCIES = { inputHighpassHz: 2000, highpassHz: 2000, lowpassHz: 20000 };
const MASTERING_IDS = [...Object.keys(MASTERING_FREQUENCIES), 'thresholdDb', 'ratio', 'kneeDb', 'attackMs', 'releaseMs', 'makeupDb'];
const TYPE_LABELS = Object.fromEntries([...$('lSystemType').options].map(o => [o.value, o.textContent]));
const COLORS = ['#fff3d6', '#55d9ff', '#5fe8c4', '#7db4ff', '#c79bff', '#ff826f', '#e8c46b'];
let disposed = false, bootstrapped = false, parameterRevision = 0, performanceRevision = 0;
let parameterDirty = false, performanceDirty = false, parameterWorking = false, performanceWorking = false;
let parameterTimer, performanceTimer, pollTimer, pollWorking = false;
let audioRevision = 0, audioDesired = false, audioPending = false, mutationChain = Promise.resolve(), lastFailure = '';
let microphoneRevision = 0, microphoneDesired = false, microphonePending = false;
let manualFlashUntil = 0, tapReceivedAt = -Infinity, inputReceivedAt = -Infinity, activityDrawAt = performance.now();
let inputTelemetry = { reader: null, receivedAt: -Infinity, clock: 0, clockReceivedAt: 0, endTime: -Infinity };
let tapIdentity = topologyIdentity(state.parameters), tapTargets = new Map(), tapLevels = new Map(), rootLevel = 0;
let lastDrawAt = -Infinity, visualPressureUntil = 0, heldVisualPressure = 0;
let geometry = null, frameId = 0, drag = null, rangeGesture = false, gestureUntil = 0, lockedFit = null;
let nativePreview = null, nativePreviewFrom = new Map(), nativePreviewStarted = 0, nativePreviewMoving = false;
let previewParameters = { ...state.parameters }, previewFrom = { ...previewParameters }, previewStarted = 0, previewMoving = false;
let presets = [], selectedPreset = 'pythagorean', lastGenerationPreset = 'pythagorean', presetController;
const canvas = $('stage'), context = canvas.getContext('2d'), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const inputStrip = createAudioInputStrip({ button: $('micButton'), gainInput: $('inputTrim'), gainOutput: $('inputTrimOut'), channels: 1 });
$('inputMenu').classList.add('mz-input-legacy'); $('seedMicButton').classList.add('mz-input-legacy');
const outputMeter = createStereoMeter({ active: false });
const audioStrip = createAudioStrip({ buttonId: 'audioButton', levelId: 'level', level: .58, levelLabel: 'Output',
  levelAriaLabel: 'L-system Delay output level', onAudioClick: () => void toggleAudio(),
  onLevelInput: value => updatePerformance('level', value, false, false), onLevelChange: () => schedulePerformance(true) });
audioStrip.levelOutput.id = 'levelOut';
$('headerAudio').replaceWith(outputMeter, audioStrip);
$('headerControls').insertBefore(inputStrip, outputMeter); inputStrip.dataset.inputPlacement = 'header';
audioStrip.setAudioDisabled(true);
const errorBox = $('audioError'); errorBox.className = 'audio-error native-audio-error'; errorBox.setAttribute('popover', 'manual'); document.body.append(errorBox);
errorBox.addEventListener('click', () => { errorBox.hidden = true; if (errorBox.matches(':popover-open')) errorBox.hidePopover(); });
const foldTap = createTapTempoButton({ ariaLabel: 'Tap Time fold', onTempo: bpm => updateParameter('intervalMs', clamp(60000 / bpm, 1, 3000), true) });
function attachTap(input, button) { const field = input.closest('label'), wrapper = document.createElement('div'); wrapper.className = 'mz-tap-tempo-field'; field.before(wrapper); wrapper.append(field, button); }
attachTap($('interval'), foldTap);
const pulseTap = createTapTempoButton({ ariaLabel: 'Tap the seed pulse', onTempo: bpm => updatePerformance('pulseRate', clamp(bpm / 60, .1, 12), true) });
attachTap($('pulseRate'), pulseTap);

// Share Morphazoid's current catalogue while retaining the native audio lifecycle.
const toolsById = new Map(TOOL_GROUPS.flatMap(group => group.tools).map(tool => [tool.id, tool]));
const choose = createChoosePickerShell(document, { current: 'L-system Delay Rust', label: 'Choose instrument. Current: L-system Delay Rust',
  title: 'L-system Delay Rust', panelId: 'instrument-picker-panel-native', placeholder: 'Type an instrument', filterLabel: 'Find instrument', listLabel: 'Instruments' });
choose.details.setAttribute('data-active-tool-id', 'micmic-rust');
const navigationGroups = [{ id: 'faves', label: 'Faves', tools: FAVE_TOOL_IDS.map(id => toolsById.get(id)).filter(Boolean) },
  ...TOOL_GROUPS.flatMap(group => {
    const tools = group.tools.filter(tool => group.picker !== false || tool.picker === true);
    return tools.length ? [{ ...group, tools }] : [];
  })], groupRecords = [];
$('instrumentNavigation').replaceChildren();
for (const group of navigationGroups) {
  const section = document.createElement('details'); section.className = 'instrument-picker-group'; section.dataset.groupId = group.id;
  const heading = document.createElement('summary'); heading.className = 'instrument-picker-group-title'; heading.id = `instrument-picker-group-native-${group.id}`;
  const label = document.createElement('span'); label.className = 'instrument-picker-group-label'; label.textContent = group.label;
  const count = document.createElement('span'); count.className = 'instrument-picker-group-count'; count.textContent = String(group.tools.length);
  const chevron = document.createElement('span'); chevron.className = 'instrument-picker-group-chevron'; chevron.setAttribute('aria-hidden', 'true');
  heading.append(label, count, chevron); section.append(heading);
  section.open = group.id === 'faves' || group.tools.some(t => t.id === 'micmic-rust');
  const rows = [];
  for (const tool of group.tools) {
    const row = document.createElement('div'); row.className = 'instrument-picker-row'; row.dataset.filterText = `${tool.label} ${group.label}`.toLocaleLowerCase();
    const link = document.createElement('a'); link.className = 'instrument-picker-link'; link.href = new URL(tool.href, SITE_ROOT).href;
    link.dataset.toolId = tool.id; link.title = tool.label;
    const icon = document.createElement('img'); icon.className = 'instrument-picker-link-icon'; icon.alt = ''; icon.width = 24; icon.height = 24;
    icon.decoding = 'async'; icon.loading = 'lazy'; icon.src = new URL(tool.imageHref || `assets/instruments/${tool.id}.webp`, SITE_ROOT).href;
    const name = document.createElement('span'); name.className = 'instrument-picker-link-label'; name.textContent = tool.label;
    link.append(icon, name);
    if (tool.id === 'micmic-rust') { link.classList.add('is-current'); link.setAttribute('aria-current', 'page'); }
    link.addEventListener('click', () => { choose.details.open = false; });
    row.append(link); section.append(row); rows.push(row);
  }
  groupRecords.push({ group, section, rows, defaultOpen: section.open }); choose.list.append(section);
}
const noResults = document.createElement('p'); noResults.className = 'instrument-picker-empty'; noResults.textContent = 'No instruments found';
noResults.hidden = true; noResults.setAttribute('role', 'status'); choose.list.append(noResults);
function filterInstruments() {
  const query = choose.searchInput.value.trim().toLocaleLowerCase(); let visibleRows = 0;
  for (const record of groupRecords) {
    let matches = 0;
    for (const row of record.rows) { row.hidden = Boolean(query) && !row.dataset.filterText.includes(query); if (!row.hidden) matches++; }
    const hideDuplicateFaves = Boolean(query) && record.group.id === 'faves';
    record.section.hidden = hideDuplicateFaves || matches === 0; record.section.open = query ? matches > 0 : record.defaultOpen;
    if (!hideDuplicateFaves) visibleRows += matches;
  }
  noResults.hidden = visibleRows > 0;
}
choose.searchInput.addEventListener('input', filterInstruments);
choose.details.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !choose.details.open) return;
  event.preventDefault();
  if (choose.searchInput.value) { choose.searchInput.value = ''; filterInstruments(); choose.searchInput.focus(); }
  else { choose.details.open = false; choose.summary.focus(); }
});
choose.details.addEventListener('toggle', () => { if (!choose.details.open && choose.searchInput.value) { choose.searchInput.value = ''; filterInstruments(); } });
choose.panel.append(choose.search, choose.list); choose.details.append(choose.summary, choose.panel);
const nextInstrument = document.createElement('a'); nextInstrument.className = 'instrument-picker-next'; nextInstrument.href = new URL('graph-delay.html', SITE_ROOT).href;
nextInstrument.setAttribute('aria-label', 'Next instrument: Graph Delay'); nextInstrument.title = 'Next instrument: Graph Delay'; nextInstrument.innerHTML = '<span class="instrument-picker-next-icon" aria-hidden="true">▶</span>';
$('instrumentNavigation').append(choose.details, nextInstrument);
$('instrumentIdentity').innerHTML = `<article class="instrument-picker-card"><header class="instrument-picker-card-heading"><div class="instrument-picker-card-visual"><img class="instrument-picker-card-image" alt="" width="512" height="512" loading="eager" decoding="sync" src="${new URL('assets/instruments/micmic.webp', SITE_ROOT).href}"></div><div class="instrument-picker-card-heading-copy"><h1 class="instrument-picker-card-title">L-system Delay Rust</h1><p class="instrument-picker-card-subtitle">Native mic processor</p><ul class="instrument-picker-card-tags" aria-label="L-system Delay tags"><li>Audio Effect</li><li>Fractal</li><li>Recursive</li><li>Faves</li></ul></div></header><ul class="instrument-picker-card-traits" aria-label="L-system Delay inputs and controls"><li>Mic input</li><li>Built-in test tone</li><li>Computer keys</li></ul><p class="instrument-picker-card-description">Runs live microphone audio through an L-system tree where branches become delays and turns become pitch shifts.</p><div class="instrument-picker-card-start"><h3>Start</h3><p>Choose microphone or the test tone, enable Audio, then change the grammar or branch timing.</p></div></article>`;

const midiManager = getSharedMidiManager();
const midiAdapter = installBrowserMidiAdapter(globalThis, document, { routeId: 'micmic-rust', manager: midiManager });
const midiStatus = createMidiStatus({ controlled: true, ariaLabel: 'MIDI input controls',
  onToggle: enabled => { if (enabled) void midiManager.enable().catch(error => showError(error.message)); else midiManager.disable(); } });
midiStatus.toggle.id = 'sharedMidiToggle';
$('nativeMidiControl').append(midiStatus);
let midiActivityTimer;
const unsubscribeMidiStatus = midiManager.subscribeStatus(status => {
  midiStatus.setDeviceLabel(`${status.inputCount} input${status.inputCount === 1 ? '' : 's'}`);
  midiStatus.setState(!status.supported ? 'unsupported' : status.enabling ? 'enabling' : status.enabled ? 'on' : status.hardwareError ? 'error' : 'off');
});
const unsubscribeMidiMessages = midiManager.subscribeMessages(() => {
  midiStatus.setReceiving(true); clearTimeout(midiActivityTimer);
  midiActivityTimer = setTimeout(() => midiStatus.setState(midiManager.status().enabled ? 'on' : 'off'), 120);
});
const browserEngine = createBrowserDelayEngine({ onStatus: reply => acceptStatus(reply), onError: error => showError(error?.message ?? String(error)) });

function showError(message) {
  if (disposed) return;
  errorBox.textContent = `${String(message)} Click to dismiss.`; errorBox.hidden = false;
  if (typeof errorBox.showPopover === 'function' && !errorBox.matches(':popover-open')) errorBox.showPopover();
  $('liveStatus').textContent = String(message);
}
function clearError() { errorBox.hidden = true; if (errorBox.matches(':popover-open')) errorBox.hidePopover(); }
async function request(url, body) {
  if (url.startsWith('/api/')) return browserEngine.request(url, body);
  const response = await fetch(url, { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Preset bank could not load (${response.status}).`);
  return result;
}
function enqueue(task) { const pending = mutationChain.catch(() => {}).then(() => disposed ? null : task()); mutationChain = pending; return pending; }
function syncActivityIdentity() {
  const identity = topologyIdentity(state.parameters);
  if (identity === tapIdentity) return;
  tapIdentity = identity; tapTargets = new Map(); tapLevels = new Map(); tapReceivedAt = -Infinity;
}
function acceptStatus(reply, { acceptAudio = true } = {}) {
  if (!reply || disposed) return;
  if (reply.generationLimits) state.generationLimits = reply.generationLimits;
  if (reply.memoryVoiceCapacity) state.memoryVoiceCapacity = reply.memoryVoiceCapacity;
  if (reply.status) {
    state.status = reply.status; inputReceivedAt = performance.now();
    inputTelemetry = inputHistoryFrame(reply, inputTelemetry, performance.now());
    syncActivityIdentity();
    const activity = tapActivityFrame(reply, state.parameters);
    tapTargets = activity?.levels ?? new Map();
    if (activity) tapReceivedAt = performance.now();
  }
  if (acceptAudio && !audioPending && typeof reply.audio === 'boolean' && (!reply.audio || !document.hidden)) { state.audio = reply.audio; audioDesired = reply.audio; }
  state.requestedVoices = reply.requestedVoices ?? state.requestedVoices; state.eligibleVoices = reply.eligibleVoices ?? state.eligibleVoices;
  const failure = reply.error || reply.status?.failure || '';
  if (failure && failure !== lastFailure) showError(failure);
  lastFailure = failure; paintControls(); scheduleDraw();
}
async function refreshNativePreview(revision = parameterRevision) {
  if (state.parameters.generations <= 13) { nativePreview = null; nativePreviewMoving = false; return; }
  try {
    const reply = await request('/api/preview');
    if (disposed || revision !== parameterRevision || JSON.stringify(sanitizeParameters(reply.parameters)) !== JSON.stringify(state.parameters)) return;
    nativePreviewFrom = new Map((geometry?.nodes ?? []).map(n => [n.id, n]));
    nativePreview = { parameters: reply.parameters, nodes: nativePreviewNodes(reply.nodes) };
    nativePreviewStarted = performance.now(); nativePreviewMoving = true; geometry = null; scheduleDraw();
  } catch (error) { if (!disposed) $('liveStatus').textContent = error.message; }
}
function startPreview({ lock = true } = {}) {
  const now = performance.now();
  syncActivityIdentity();
  if (lock && geometry && !lockedFit) lockedFit = { ...geometry.fit };
  previewFrom = { ...previewParameters }; previewStarted = now; previewMoving = true;
  if (!rangeGesture) gestureUntil = now + 150; scheduleDraw();
}
function scheduleParameters(immediate = false) {
  parameterDirty = true; if (parameterWorking) return;
  clearTimeout(parameterTimer); parameterTimer = setTimeout(flushParameters, immediate ? 0 : 30);
}
async function flushParameters() {
  if (disposed || parameterWorking || !parameterDirty) return;
  parameterDirty = false; parameterWorking = true;
  const revision = parameterRevision, parameters = { ...state.parameters };
  try { acceptStatus(await enqueue(() => request('/api/parameters', parameters))); void refreshNativePreview(revision); }
  catch (error) {
    showError(error.message);
    try { const reply = await request('/api/status'); if (revision === parameterRevision && reply.parameters) { state.parameters = sanitizeParameters(reply.parameters); startPreview(); void refreshNativePreview(revision); } acceptStatus(reply); } catch { /* Keep the error visible until reconnection. */ }
  } finally { parameterWorking = false; if (parameterDirty && !disposed) parameterTimer = setTimeout(flushParameters, 30); }
}
function schedulePerformance(immediate = false) {
  performanceDirty = true; if (performanceWorking) return;
  clearTimeout(performanceTimer); performanceTimer = setTimeout(flushPerformance, immediate ? 0 : 30);
}
async function flushPerformance() {
  if (disposed || performanceWorking || !performanceDirty) return;
  performanceDirty = false; performanceWorking = true;
  const revision = performanceRevision, snapshot = { ...state.performance };
  try { acceptStatus(await enqueue(() => request('/api/performance', snapshot))); }
  catch (error) {
    showError(error.message);
    try { const reply = await request('/api/status'); if (revision === performanceRevision && reply.performance) state.performance = sanitizePerformance(reply.performance); acceptStatus(reply); } catch { /* Preserve the visible error. */ }
  } finally { performanceWorking = false; if (performanceDirty && !disposed) performanceTimer = setTimeout(flushPerformance, 30); }
}
function updateParameter(key, value, immediate = false) {
  state.parameters = sanitizeParameters({ ...state.parameters, [key]: value }); parameterRevision++;
  if (!['lSystemType', 'pruningBias', 'spread'].includes(key)) selectedPreset = 'custom';
  startPreview(); paintControls(); scheduleParameters(immediate); presetController?.refresh();
}
function updatePerformance(key, value, immediate = false, musical = true) {
  state.performance = sanitizePerformance({ ...state.performance, [key]: value }); performanceRevision++;
  // Mix and device edits leave the independent growth preset selection intact.
  paintControls(); schedulePerformance(immediate); presetController?.refresh();
}
function updateMastering(settings, immediate = false) {
  updatePerformance('mastering', { ...state.performance.mastering, ...settings }, immediate);
}
async function applyScene(scene, id = 'custom') {
  const next = presetState(scene, state.performance), previous = { parameters: state.parameters, performance: state.performance };
  clearTimeout(parameterTimer); clearTimeout(performanceTimer); parameterDirty = performanceDirty = false;
  state.parameters = next.parameters; state.performance = next.performance; parameterRevision++; performanceRevision++; selectedPreset = id;
  const revision = parameterRevision; if (presets.some(p => p.id === id)) lastGenerationPreset = id; startPreview({ lock: false }); paintControls();
  try {
    acceptStatus(await enqueue(() => request('/api/performance', next.performance)));
    acceptStatus(await enqueue(() => request('/api/parameters', next.parameters)));
    await refreshNativePreview(revision);
  } catch (error) {
    if (revision === parameterRevision) { state.parameters = previous.parameters; state.performance = previous.performance; startPreview(); paintControls(); }
    showError(error.message); throw error;
  }
}
async function toggleAudio(force) {
  const revision = ++audioRevision; audioDesired = force === undefined ? !audioDesired : Boolean(force); audioPending = true;
  const enabled = audioDesired; clearError(); audioStrip.setAttention(false); paintControls();
  try {
    let reply;
    if (enabled) {
      await browserEngine.prepareAudio();
      reply = await enqueue(() => { if (revision !== audioRevision || document.hidden) return null; return request('/api/audio', { enabled: true }); });
    } else {
      // Stop also cancels an outstanding microphone permission request.
      reply = await request('/api/audio', { enabled: false });
    }
    if (revision === audioRevision && reply && !disposed) { audioPending = false; acceptStatus(reply); audioDesired = state.audio; }
  } catch (error) { if (revision === audioRevision) { audioPending = false; audioDesired = state.audio; lastFailure = error.message; showError(error.message); } }
  paintControls(); scheduleDraw();
}
async function toggleMicrophone() {
  const revision = ++microphoneRevision;
  microphoneDesired = microphonePending ? !microphoneDesired : !Boolean(state.status.microphoneEnabled);
  microphonePending = true; clearError();
  if (state.performance.source !== 'mic') updatePerformance('source', 'mic', true, false);
  paintControls();
  try {
    const reply = await browserEngine.setMicrophoneEnabled(microphoneDesired);
    if (revision === microphoneRevision && !disposed) { microphonePending = false; acceptStatus(reply); }
  } catch (error) {
    if (revision === microphoneRevision && !disposed) { microphonePending = false; microphoneDesired = false; showError(error.message); }
  }
  paintControls(); scheduleDraw();
}
async function strike() {
  if (state.performance.source !== 'seed') return;
  manualFlashUntil = performance.now() + 240; scheduleDraw();
  if (!state.audio) { $('liveStatus').textContent = 'Seed gesture. Audio remains off.'; audioStrip.setAttention(true); return; }
  try { acceptStatus(await enqueue(() => request('/api/strike', {}))); } catch (error) { if (!(error.status === 409 && !state.audio)) showError(error.message); }
}
function resetAll() {
  const performanceDefaults = { ...state.performance, wet: DEFAULT_PERFORMANCE.wet, dry: DEFAULT_PERFORMANCE.dry,
    inputGain: DEFAULT_PERFORMANCE.inputGain, frequency: DEFAULT_PERFORMANCE.frequency, pulseRate: DEFAULT_PERFORMANCE.pulseRate,
    mastering: DEFAULT_MASTERING };
  void applyScene({ parameters: DEFAULT_PARAMETERS, performance: performanceDefaults }, 'pythagorean').catch(() => {});
}
function formatParameter(key, value) {
  if (key === 'generations') return `${value} / ${state.generationLimits[state.parameters.lSystemType] ?? 52}`;
  if (key === 'intervalMs') return `${Math.round(value)} ms`;
  if (key === 'timeRatio') return `${Number(value.toFixed(2))}× per generation`;
  if (key === 'angle') return `${Number(value.toFixed(1))}°`;
  if (key === 'pitchScale') return `${Math.round(value * 100)}% / 180°`;
  if (key === 'pruningBias') return value <= .01 ? 'breadth first' : value >= .99 ? 'depth first' : `${Math.round(value * 100)}% depth first`;
  if (key === 'asymmetry') return Math.abs(value) < .005 ? 'even' : `${Math.round(Math.abs(value) * 100)}% ${value > 0 ? 'right' : 'left'} wider`;
  return `${Math.round(value * 100)}%${key === 'mutation' ? ' rule variance' : ''}`;
}
function formatMastering(key, value) {
  if (key in MASTERING_FREQUENCIES) return value > 0 ? `${Math.round(value).toLocaleString()} Hz` : 'Off';
  const amount = Number(value.toFixed(1));
  if (key === 'ratio') return `${amount}:1`;
  if (key === 'attackMs' || key === 'releaseMs') return `${amount} ms`;
  return `${key === 'makeupDb' && amount > 0 ? '+' : ''}${amount} dB`;
}
function paintControls() {
  for (const [key, id] of Object.entries(CONTROL_IDS)) {
    const value = state.parameters[key]; $(id).value = key === 'intervalMs' ? sliderFromTimeFold(value) : value;
    const text = formatParameter(key, value); $(`${id}Out`).textContent = text; $(id).setAttribute('aria-valuetext', text);
  }
  $('lSystemType').value = state.parameters.lSystemType;
  for (const button of document.querySelectorAll('[data-generation-preset]')) button.setAttribute('aria-pressed', String(button.dataset.generationPreset === selectedPreset));
  for (const [key, id] of Object.entries(PERFORMANCE_IDS)) {
    const value = state.performance[key]; $(id).value = value;
    $(`${id}Out`).textContent = key === 'frequency' ? `${Math.round(value)} Hz` : key === 'pulseRate' ? `${Number(value.toFixed(2))} / s`
      : key === 'voiceCeiling' ? value === 0 ? 'No cap' : value.toLocaleString() : key === 'dry' && value === 0 ? 'muted' : `${Math.round(value * 100)}%`;
  }
  const mastering = state.performance.mastering;
  for (const key of MASTERING_IDS) {
    const isCutoff = key in MASTERING_FREQUENCIES, requested = mastering[key], sampleRate = Number(state.status.sampleRate);
    $(key).value = isCutoff ? sliderFromCutoff(requested, MASTERING_FREQUENCIES[key], key === 'lowpassHz') : requested;
    const effective = isCutoff && state.audio && Number.isFinite(sampleRate) && sampleRate > 0
      ? Math.min(requested, sampleRate * .45) : requested;
    const text = formatMastering(key, effective), output = $(`${key}Out`), clamped = effective < requested;
    output.textContent = text;
    $(key).setAttribute('aria-valuetext', clamped ? `${text} effective (${formatMastering(key, requested)} requested)` : text);
    if (clamped) {
      const title = `${text} effective; ${formatMastering(key, requested)} requested`;
      output.title = title; $(key).title = title;
    } else { output.removeAttribute('title'); $(key).removeAttribute('title'); }
  }
  $('compressorEnabled').checked = mastering.compressorEnabled; $('autoMakeup').checked = mastering.autoMakeup;
  const profileId = masteringProfileId(mastering);
  $('masteringPreset').value = profileId;
  $('masteringSummary').textContent = `${MASTERING_PROFILES.find(item => item.id === profileId)?.label ?? 'Custom'} · ${mastering.compressorEnabled ? `${Number(mastering.ratio.toFixed(1))}:1 compression` : 'compression off'}`;
  const reduction = state.audio ? Math.max(0, Number(state.status.gainReductionDb) || 0) : 0;
  $('gainReductionOut').textContent = `${reduction.toFixed(1)} dB`;
  $('gainReductionBar').style.width = `${clamp(reduction / 30) * 100}%`;
  $('generations').max = String(state.generationLimits[state.parameters.lSystemType] ?? 52);
  $('voiceCeiling').max = String(state.memoryVoiceCapacity);
  const mic = state.performance.source === 'mic', microphoneActive = Boolean(state.status.microphoneEnabled);
  const inputActive = (mic ? microphoneActive : state.audio) && !state.performance.frozen;
  $('source').value = state.performance.source; $('seedParameters').hidden = mic;
  $('automatic').checked = state.performance.automatic;
  inputStrip.setGain(state.performance.inputGain); inputStrip.setInputState({ active: mic && microphoneActive, pending: microphonePending || Boolean(state.status.microphonePending), supported: bootstrapped });
  inputStrip.meter.setActive(inputActive);
  const inputLabel = `${mic && microphoneActive ? 'Stop' : 'Start'} microphone input${state.audio ? '' : '. Audio remains off'}`;
  inputStrip.button.setAttribute('aria-label', inputLabel); inputStrip.button.title = inputLabel;
  inputStrip.setLevels(inputActive ? Number(state.status.inputPeak) || 0 : 0);
  $('seedMicButton').setAttribute('aria-pressed', String(inputActive)); $('seedMicButton').setAttribute('aria-label', inputLabel);
  $('seedMicButton').querySelector('b').textContent = state.performance.frozen ? 'Resume input' : state.audio ? 'Pause input' : 'Input ready';
  $('seedMicButton').querySelector('small').textContent = mic ? 'microphone input' : 'test tone';
  const audioState = audioPending ? 'starting' : state.audio ? 'on' : lastFailure ? 'error' : 'off';
  audioStrip.setAudioState(audioState); $('audioButton').disabled = !bootstrapped;
  $('audioButton').setAttribute('aria-pressed', String(audioDesired)); $('audioButton').setAttribute('aria-busy', String(audioPending));
  const audioLabel = audioPending ? audioDesired ? 'Audio starting. Cancel Audio start' : 'Audio stopping. Enable Audio' : state.audio ? 'Audio is on. Disable Audio' : 'Audio is off. Enable Audio';
  $('audioButton').setAttribute('aria-label', audioLabel); $('audioButton').title = audioLabel;
  outputMeter.setActive(state.audio); outputMeter.setLevels(state.audio ? Number(state.status.outputLeftPeak) || 0 : 0, state.audio ? Number(state.status.outputRightPeak) || 0 : 0);
  $('panicButton').disabled = !state.audio && !audioPending; $('nativeStopAudio').disabled = !state.audio && !audioPending;
  const p = state.parameters, s = state.status, type = TYPE_LABELS[p.lSystemType], pruning = formatParameter('pruningBias', p.pruningBias);
  const requested = Number(state.requestedVoices) || (p.lSystemType === 'pythagorean' ? 2 ** (p.generations + 1) - 2 : 0);
  const limit = state.audio ? Number(s.voiceLimit) || 0 : Math.min(48, requested, state.performance.voiceCeiling || Infinity);
  $('generationCapacityInline').textContent = `${limit.toLocaleString()} of ${requested.toLocaleString()} branches ${state.audio ? 'active' : 'ready'} · ${pruning} pruning · ${state.performance.automatic ? 'device-adjusted' : 'manual ceiling'}`;
  $('recursionSummary').textContent = `${type} · ${p.generations} generations`;
  $('presetSummary').textContent = presets.find(n => n.id === selectedPreset)?.label.split(' · ')[0] ?? 'Custom growth';
  $('mixSummary').textContent = `${Math.round(state.performance.wet * 100)}% descendants · ${state.performance.dry ? `${Math.round(state.performance.dry * 100)}% root` : 'root muted'}`;
  $('seedPauseButton').textContent = state.performance.frozen ? 'Resume test tone' : 'Pause test tone';
  $('seedPauseButton').setAttribute('aria-pressed', String(state.performance.frozen));
  $('seedSummary').textContent = mic ? `Microphone · ${state.performance.frozen ? 'paused' : 'ready'}` : `Built-in test tone · ${Math.round(state.performance.frequency)} Hz`;
  $('currentSettingsSummary').textContent = `${p.generations} gen · ${Math.round(p.intervalMs)} ms root fold`;
  $('pitchDetailStatus').textContent = `Independent granular · ${Number(s.activeVoices ?? 0).toLocaleString()} active voices · ${p.pitchScale === 0 ? 'exact unison' : 'independent pitch shifts'}`;
  $('generationKeyEnd').textContent = `G${p.generations} DESCENDANT`;
  $('stageReadout').textContent = `${state.audio ? state.performance.frozen ? 'INPUT PAUSED' : mic ? 'MIC LIVE' : 'SEED LIVE' : 'AUDIO OFF'} · ${type.toUpperCase()} · ${p.generations} GENERATIONS`;
  $('generationTimingReadout').textContent = `${Math.round(p.intervalMs)} ms → ${Number((p.intervalMs * p.timeRatio).toFixed(2))} ms → ${Number((p.intervalMs * p.timeRatio ** 2).toFixed(2))} ms … ${Number((p.intervalMs * p.timeRatio ** p.generations).toFixed(2))} ms at G${p.generations}`;
  $('generationPitchReadout').textContent = `${Number((-p.angle * (1 - p.asymmetry)).toFixed(1))}° → ${Number((-p.angle * (1 - p.asymmetry) / 180 * p.pitchScale * 100).toFixed(1))}% octave · ${Number((p.angle * (1 + p.asymmetry)).toFixed(1))}° → ${Number((p.angle * (1 + p.asymmetry) / 180 * p.pitchScale * 100).toFixed(1))}% octave`;
  $('outputDevice').textContent = s.device || 'Default output'; $('inputDevice').textContent = mic ? s.inputDevice || 'Default input' : 'Built-in test tone';
  $('sampleRate').textContent = s.sampleRate ? `${(s.sampleRate / 1000).toFixed(1)} kHz` : '—';
  $('activeVoices').textContent = s.activeVoices === undefined ? '—' : `${s.activeVoices.toLocaleString()} / ${(s.voiceLimit ?? state.performance.voiceCeiling).toLocaleString()}`;
  $('requestedVoices').textContent = requested.toLocaleString(); $('eligibleVoices').textContent = Number(state.eligibleVoices).toLocaleString();
  $('cpuLoad').textContent = Number.isFinite(s.cpuLoad) ? `${(s.cpuLoad * 100).toFixed(1)}%` : '—'; $('peakLoad').textContent = Number.isFinite(s.peakLoad) ? `${(s.peakLoad * 100).toFixed(1)}%` : '—';
  $('streamMisses').textContent = `${s.underruns || 0} / ${s.deadlineMisses || 0}`; $('engineStatus').textContent = lastFailure || (state.audio ? 'Audio is running.' : 'Audio is off.');
  audioStrip.update();
}

function buildGeometry() {
  const box = canvas.getBoundingClientRect(), width = Math.max(1, box.width), height = Math.max(1, box.height), dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); lockedFit = null; }
  const advanced = state.parameters.generations > 13;
  const authoritative = advanced && nativePreview?.parameters.lSystemType === state.parameters.lSystemType && nativePreview.parameters.generations === state.parameters.generations;
  const nodes = authoritative ? interpolatePreviewNodes(nativePreview.nodes, nativePreviewFrom, (performance.now() - nativePreviewStarted) / 120)
    : buildPreview(previewParameters, generationTopology);
  // A provisional ancestor drawing never claims to represent admitted deep taps.
  if (advanced && !authoritative) for (const n of nodes) n.priority = null;
  const ghost = new Path2D();
  for (const n of nodes) { ghost.moveTo(n.startX, n.startY); ghost.lineTo(n.x, n.y); }
  const desiredFit = fitTransform(topologyBounds(nodes), width, height);
  geometry = { width, height, dpr, nodes, ghost, desiredFit, fit: lockedFit ? { ...lockedFit } : desiredFit, activeLimit: -1, active: [],
    byVoiceIndex: new Map(nodes.filter(n => n.generation > 0).map(n => [n.voiceIndex, n])), baselinePaths: new Map() };
  const counts = new Map(); for (const n of nodes) counts.set(n.generation, (counts.get(n.generation) ?? 0) + 1);
  $('generationCountReadout').textContent = [...counts].slice(0, 6).map(([, count]) => count.toLocaleString()).join(' → ') + (counts.size > 6 ? ` → … → ${(counts.get(Math.max(...counts.keys())) ?? 0).toLocaleString()} previewed at G${Math.max(...counts.keys())}` : '');
  $('treeDescription').textContent = `${TYPE_LABELS[state.parameters.lSystemType]}. ${state.parameters.generations} audio generations; ${nodes.length.toLocaleString()} segments in the bounded visual preview. Colored branches are admitted delay taps; microphone envelopes travel along vibrating branches at their delay times.`;
  canvas.setAttribute('aria-label', `Live fitted L-system tree for L-system Delay. ${state.audio ? state.performance.frozen ? 'Input paused; recursive tail live' : `${state.performance.source === 'mic' ? 'Microphone' : 'Seed'} live` : 'Audio off'}.`);
}
function scheduleDraw() { if (!frameId && !disposed) frameId = requestAnimationFrame(draw); }
function draw(now) {
  frameId = 0; if (disposed) return;
  const pressure = visualBudget(state.status.cpuLoad, state.status.peakLoad).pressure;
  if (pressure >= heldVisualPressure) { heldVisualPressure = pressure; if (pressure) visualPressureUntil = now + 3000; }
  else if (now > visualPressureUntil) heldVisualPressure = pressure;
  const budget = visualBudget(heldVisualPressure === 2 ? .85 : heldVisualPressure === 1 ? .65 : 0, 0,
    Boolean(drag || rangeGesture || previewMoving || nativePreviewMoving), state.audio);
  if (now - lastDrawAt < 1000 / budget.fps - 1) { scheduleDraw(); return; }
  lastDrawAt = now;
  if (nativePreviewMoving) { geometry = null; if (now - nativePreviewStarted >= 120) nativePreviewMoving = false; }
  if (previewMoving) {
    const fraction = (now - previewStarted) / 120;
    previewParameters = interpolateParameters(previewFrom, state.parameters, fraction); geometry = null;
    if (fraction >= 1) { previewParameters = { ...state.parameters }; previewMoving = false; }
  }
  if (!geometry) buildGeometry();
  const { width, height, dpr, nodes, ghost, desiredFit } = geometry;
  let fitMoving = false;
  if (lockedFit && !drag && !rangeGesture && now > gestureUntil && !previewMoving) {
    for (const key of ['scale', 'x', 'y']) {
      const difference = desiredFit[key] - geometry.fit[key]; geometry.fit[key] += difference * .22;
      if (Math.abs(difference) > (key === 'scale' ? .001 : .1)) fitMoving = true;
    }
    if (!fitMoving) { lockedFit = null; geometry.fit = desiredFit; }
  }
  const fit = geometry.fit, project = (x, y) => ({ x: x * fit.scale + fit.x, y: -y * fit.scale + fit.y });
  context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
  context.save(); context.setTransform(dpr * fit.scale, 0, 0, -dpr * fit.scale, dpr * fit.x, dpr * fit.y);
  context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = 'rgba(119,131,126,.58)';
  context.globalAlpha = state.audio ? .34 : .28; context.lineWidth = .72 / fit.scale; context.stroke(ghost); context.restore();
  const limit = state.audio ? Math.max(0, Number(state.status.voiceLimit) || 0) : Math.min(48, state.performance.voiceCeiling || Infinity);
  if (geometry.activeLimit !== limit) {
    geometry.activeLimit = limit; geometry.active = admittedPreviewNodes(nodes, limit); geometry.baselinePaths = new Map();
    geometry.selectedCounts = new Map();
    for (const n of geometry.active) {
      geometry.selectedCounts.set(n.generation, (geometry.selectedCounts.get(n.generation) ?? 0) + 1);
      let path = geometry.baselinePaths.get(n.generation);
      if (!path) { path = new Path2D(); geometry.baselinePaths.set(n.generation, path); }
      path.moveTo(n.startX, n.startY); path.lineTo(n.x, n.y);
    }
  }
  const elapsed = Math.max(0, now - activityDrawAt); activityDrawAt = now;
  const fresh = state.audio && now - tapReceivedAt < 300;
  // Retained history remains useful through a slow Canvas frame or HTTP jitter.
  // A short meter timeout must not erase the unmetered descendants' response.
  const historyFresh = state.audio && inputTelemetry.reader && now - inputTelemetry.receivedAt < 2000;
  const seconds = inputTelemetry.clock + clamp((now - inputTelemetry.clockReceivedAt) / 1000, 0, 2);
  const responding = new Map();
  for (const [slot, target] of tapTargets) if (target > 0 && !tapLevels.has(slot)) tapLevels.set(slot, 0);
  for (const [slot, level] of tapLevels) {
    const next = smoothActivity(level, fresh ? activityEnergy(tapTargets.get(slot) ?? 0) : 0, elapsed);
    if (next === 0) { tapLevels.delete(slot); continue; }
    tapLevels.set(slot, next);
    const node = geometry.byVoiceIndex.get(slot);
    if (node) responding.set(node.id, { node, energy: next });
  }
  rootLevel = smoothActivity(rootLevel, state.audio && now - inputReceivedAt < 300 ? activityEnergy(Number(state.status.inputPeak || 0)) : 0, elapsed);
  const rootNode = nodes.find(n => n.generation === 0);
  if (rootNode && rootLevel > 0) responding.set(rootNode.id, { node: rootNode, energy: rootLevel });
  const activeIds = new Set(geometry.active.map(n => n.id));
  const branches = [...geometry.active, ...[...responding.values()].filter(({ node }) => !activeIds.has(node.id)).map(({ node }) => node)];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const detailSteps = Math.max(5, Math.min(14, Math.floor(budget.branches * 8 / Math.max(1, branches.length))));
  const baselines = new Map(), glows = [];
  for (const n of branches) {
    const parent = byId.get(n.parentId), a = project(n.startX, n.startY), b = project(n.x, n.y);
    const wet = Number(state.status.wetBusGain || 0) > 0 ? state.performance.wet : 0;
    const selectedCount = state.status.generationVoiceCounts?.[n.generation] ?? geometry.selectedCounts.get(n.generation);
    const gain = .5 * state.parameters.depth ** (n.generation * .72) / Math.sqrt(selectedCount || 1);
    const voiceLevel = n.generation === 0 ? 1 : clamp(Math.sqrt(Math.max(0, gain) / .5) * Math.sqrt(wet));
    const history = historyFresh && activeIds.has(n.id);
    const energy = responding.get(n.id)?.energy ?? 0;
    const points = branchWavePoints({ ...n, startDelay: parent?.delay ?? Math.max(0, (n.delay ?? 0) - state.parameters.intervalMs / 1000), voiceLevel },
      a, b, history ? inputTelemetry.reader : energy, detailSteps, reducedMotion, seconds);
    if (!history) for (const p of points) p.energy = energy;
    if (activeIds.has(n.id)) {
      let path = baselines.get(n.generation);
      if (!path) { path = new Path2D(); baselines.set(n.generation, path); }
      points.forEach((p, i) => i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y));
    }
    const peak = Math.max(...points.map(p => p.energy));
    if (peak >= .015) glows.push({ node: n, points, peak });
  }
  // Both strokes follow the same moving curve. Only the gray full-tree ghost
  // stays straight; quiet parts of a branch receive no bright overlay.
  context.lineCap = 'round'; context.lineJoin = 'round';
  for (const [generation, path] of baselines) {
    context.strokeStyle = COLORS[generation % COLORS.length];
    context.globalAlpha = branchBaselineAlpha(generation, state.parameters.depth, state.audio);
    context.lineWidth = generation === 0 ? 1.85 : .95; context.stroke(path);
  }
  for (const { node: n, points, peak } of glows) {
    context.beginPath(); let connected = false;
    for (let i = 1; i < points.length; i++) {
      if (Math.max(points[i - 1].energy, points[i].energy) < .015) { connected = false; continue; }
      if (!connected) context.moveTo(points[i - 1].x, points[i - 1].y);
      context.lineTo(points[i].x, points[i].y); connected = true;
    }
    context.strokeStyle = COLORS[n.generation % COLORS.length]; context.globalAlpha = .24 + peak * .72;
    context.lineWidth = (n.generation === 0 ? 1.9 : 1.05) + peak * 2.4;
    context.shadowColor = context.strokeStyle; context.shadowBlur = budget.pressure === 0 && glows.length < 1000 ? 3 + peak * 12 : 0;
    context.stroke();
  }
  context.shadowBlur = 0;
  context.globalAlpha = 1;
  if (state.audio && state.performance.frozen) { context.fillStyle = 'rgba(199,155,255,.72)'; context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'; context.fillText('INPUT PAUSED · DESCENDANTS DECAYING', 18, height - 42); }
  const root = project(0, 0), seedSize = clamp(Math.min(width, height) * .085, 46, 62);
  $('seedControl').style.left = `${root.x}px`; $('seedControl').style.top = `${root.y}px`; $('seedControl').style.width = `${seedSize}px`; $('seedControl').style.height = `${seedSize}px`;
  if (now < manualFlashUntil) { context.strokeStyle = COLORS[0]; context.globalAlpha = (manualFlashUntil - now) / 240; context.beginPath(); context.arc(root.x, root.y, seedSize / 2 + 5, 0, Math.PI * 2); context.stroke(); context.globalAlpha = 1; }
  if (state.audio || tapLevels.size || rootLevel > 0 || drag || previewMoving || nativePreviewMoving || fitMoving || (lockedFit && now <= gestureUntil) || now < manualFlashUntil) scheduleDraw();
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.isPrimary === false) return;
  event.preventDefault(); canvas.focus({ preventScroll: true }); lockedFit = geometry ? { ...geometry.fit } : null;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...state.parameters }, changed: false }; canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (dx * dx + dy * dy < 16 && !drag.changed) return;
  drag.changed = true; const box = canvas.getBoundingClientRect();
  state.parameters = gestureParameters(drag.start, dx, dy, box.width, box.height, event.shiftKey); parameterRevision++; selectedPreset = 'custom';
  startPreview(); paintControls(); scheduleParameters(); presetController?.refresh();
});
function endDrag(event, cancelled = false) {
  if (!drag || drag.id !== event.pointerId) return;
  const previous = drag; drag = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  gestureUntil = performance.now() + 100;
  if (previous.changed) scheduleParameters(true); else if (!cancelled) void strike(); scheduleDraw();
}
canvas.addEventListener('pointerup', event => endDrag(event)); canvas.addEventListener('pointercancel', event => endDrag(event, true)); canvas.addEventListener('lostpointercapture', event => endDrag(event, true));
canvas.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if (event.key === 'Enter' && !event.repeat) { event.preventDefault(); void strike(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') updateParameter('intervalMs', state.parameters.intervalMs * Math.exp((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? .005 : .04)), true);
  else updateParameter('angle', state.parameters.angle + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? .1 : 1), true);
});
for (const [key, id] of Object.entries(CONTROL_IDS)) {
  $(id).addEventListener('input', () => updateParameter(key, key === 'intervalMs' ? timeFoldFromSlider($(id).value) : Number($(id).value)));
  $(id).addEventListener('change', () => scheduleParameters(true));
  $(id).addEventListener('pointerdown', () => { lockedFit = geometry ? { ...geometry.fit } : null; rangeGesture = true; gestureUntil = Infinity; });
  const release = () => { rangeGesture = false; gestureUntil = performance.now() + 100; scheduleDraw(); };
  $(id).addEventListener('pointerup', release); $(id).addEventListener('pointercancel', release);
}
$('lSystemType').addEventListener('change', () => updateParameter('lSystemType', $('lSystemType').value, true));
for (const [key, id] of Object.entries(PERFORMANCE_IDS)) {
  if (key === 'level') continue;
  $(id).addEventListener('input', () => updatePerformance(key, Number($(id).value), false, !['voiceCeiling'].includes(key)));
  $(id).addEventListener('change', () => schedulePerformance(true));
}
for (const key of MASTERING_IDS) {
  $(key).addEventListener('input', () => updateMastering({ [key]: key in MASTERING_FREQUENCIES
    ? cutoffFromSlider($(key).value, MASTERING_FREQUENCIES[key], key === 'lowpassHz') : Number($(key).value) }));
  $(key).addEventListener('change', () => schedulePerformance(true));
}
for (const key of ['compressorEnabled', 'autoMakeup']) {
  $(key).addEventListener('change', () => updateMastering({ [key]: $(key).checked }, true));
}
$('masteringPreset').addEventListener('change', () => {
  const preset = MASTERING_PROFILES.find(item => item.id === $('masteringPreset').value);
  if (preset) updateMastering(preset.settings, true);
});
$('source').addEventListener('change', () => updatePerformance('source', $('source').value, true, false));
const pauseInput = () => updatePerformance('frozen', !state.performance.frozen, true, false);
inputStrip.button.addEventListener('click', () => void toggleMicrophone());
$('seedMicButton').addEventListener('click', pauseInput); $('seedPauseButton').addEventListener('click', pauseInput);
$('automatic').addEventListener('change', () => updatePerformance('automatic', $('automatic').checked, true, false));
$('strikeButton').addEventListener('click', () => void strike()); $('panicButton').addEventListener('click', () => void toggleAudio(false));
$('nativeStopAudio').addEventListener('click', () => void toggleAudio(false)); $('freezeButton').addEventListener('click', () => void toggleAudio(false));
document.querySelector('[data-reset-all]').addEventListener('click', resetAll);
function loadGenerationPreset(id) {
  const preset = presets.find(p => p.id === id); if (!preset) return;
  state.parameters = generationPresetParameters(state.parameters, preset); parameterRevision++; selectedPreset = lastGenerationPreset = id;
  startPreview(); paintControls(); scheduleParameters(true); presetController?.refresh();
}
$('resetGenerationRules').addEventListener('click', () => loadGenerationPreset(lastGenerationPreset));
for (const button of document.querySelectorAll('[data-generation-preset]')) button.addEventListener('click', () => loadGenerationPreset(button.dataset.generationPreset));
$('nativeSettings').addEventListener('toggle', () => $('settingsButton').setAttribute('aria-expanded', String($('nativeSettings').open)));
function releaseRangeGesture() { if (!rangeGesture) return; rangeGesture = false; gestureUntil = performance.now() + 100; scheduleDraw(); }
document.addEventListener('pointerup', releaseRangeGesture); document.addEventListener('pointercancel', releaseRangeGesture);
document.addEventListener('pointerdown', event => {
  if (!choose.details.contains(event.target) && !choose.panel.contains(event.target)) choose.details.open = false;
  if (!$('nativeSettings').contains(event.target)) $('nativeSettings').open = false;
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) { choose.details.open = false; $('nativeSettings').open = false; clearError(); } });

const mobile = matchMedia('(max-width:720px), (max-width:960px) and (max-height:560px) and (orientation:landscape)');
let inputRow;
function placeInput() {
  const presetsRow = document.querySelector('.instrument-preset-controls');
  if (mobile.matches && presetsRow) {
    if (!inputRow) { inputRow = document.createElement('div'); inputRow.className = 'mz-input-preset-row'; presetsRow.before(inputRow); }
    inputRow.append(inputStrip, presetsRow); inputStrip.dataset.inputPlacement = 'preset';
  } else {
    $('headerControls').insertBefore(inputStrip, outputMeter); inputStrip.dataset.inputPlacement = 'header';
    if (inputRow && presetsRow) { inputRow.before(presetsRow); inputRow.remove(); inputRow = null; }
  }
  inputStrip.repositionError(); lockedFit = null; geometry = null; scheduleDraw();
}
mobile.addEventListener('change', placeInput);
const resizeObserver = new ResizeObserver(() => { lockedFit = null; geometry = null; scheduleDraw(); }); resizeObserver.observe(canvas);

async function bootstrap() {
  if (disposed) return;
  const initialRevision = parameterRevision;
  try {
    const [reply, bank] = await Promise.all([request('/api/state'), request(new URL('./presets.json', import.meta.url).href)]); if (disposed) return;
    if (parameterRevision === initialRevision && initialRevision === 0 && reply.parameters) state.parameters = sanitizeParameters(reply.parameters);
    if (performanceRevision === 0 && reply.performance) state.performance = sanitizePerformance(reply.performance);
    presets = bank;
    const growthKeys = ['generations', 'depth', 'intervalMs', 'mutation', 'timeRatio', 'angle', 'asymmetry', 'pitchScale'];
    selectedPreset = presets.find(p => growthKeys.every(key => p.snapshot.parameters[key] === state.parameters[key]))?.id ?? 'custom';
    if (selectedPreset !== 'custom') lastGenerationPreset = selectedPreset;
    const buttonPresetOrder = new Map([...document.querySelectorAll('[data-generation-preset]')]
      .map((button, index) => [button.dataset.generationPreset, index]));
    const menuPresets = [...presets].sort((a, b) =>
      (buttonPresetOrder.get(a.id) ?? buttonPresetOrder.size) - (buttonPresetOrder.get(b.id) ?? buttonPresetOrder.size));
    presetController = registerHeaderPresets({ id: 'micmic-rust', presets: menuPresets,
      capture: () => captureScene(state.parameters, state.performance),
      apply: snapshot => applyScene(snapshot, presets.find(p => presetStateKey(p.snapshot) === presetStateKey(snapshot))?.id ?? 'custom'),
      randomize: (current, random) => { const next = randomState(current.parameters, state.performance, random); return captureScene(next.parameters, next.performance); },
      onApplied: () => { paintControls(); },
    });
    bootstrapped = true; previewParameters = { ...state.parameters }; geometry = null;
    acceptStatus(reply); paintControls(); placeInput(); void refreshNativePreview();
  } catch (error) { showError(`The Rust audio engine could not load. ${error.message}`); if (!disposed) setTimeout(bootstrap, 2000); }
}
async function poll() {
  if (disposed) return;
  if (!document.hidden && !pollWorking && bootstrapped) {
    pollWorking = true; const revision = audioRevision;
    try { acceptStatus(await request('/api/status'), { acceptAudio: revision === audioRevision }); }
    catch (error) { if (!document.hidden) showError(error.message); }
    finally { pollWorking = false; }
  }
  if (!disposed) pollTimer = setTimeout(poll, state.audio ? 50 : 200);
}
function muteForDeparture() {
  audioRevision++; audioDesired = false; audioPending = false; state.audio = false;
  microphoneRevision++; microphoneDesired = false; microphonePending = false;
  clearTimeout(parameterTimer); clearTimeout(performanceTimer); parameterDirty = performanceDirty = false;
  browserEngine.muteForDeparture();
  paintControls(); scheduleDraw();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) muteForDeparture(); });
addEventListener('pagehide', event => {
  muteForDeparture();
  if (event.persisted) return;
  disposed = true; clearTimeout(pollTimer); cancelAnimationFrame(frameId); resizeObserver.disconnect(); mobile.removeEventListener('change', placeInput);
  browserEngine.dispose();
  midiManager.disable(); midiAdapter?.dispose(); unsubscribeMidiStatus(); unsubscribeMidiMessages(); clearTimeout(midiActivityTimer); midiStatus.destroy();
  foldTap.destroy(); pulseTap.destroy(); inputStrip.destroy(); audioStrip.destroy(); presetController?.destroy();
});
paintControls(); scheduleDraw(); void bootstrap(); void poll();
