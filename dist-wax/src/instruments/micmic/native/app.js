import { createAudioInputStrip } from '../../../ui/patterns/audio-input-strip.js';
import { createAudioStrip } from '../../../ui/patterns/audio-strip.js';
import { createStereoMeter } from '../../../ui/patterns/level-meter.js';
import { createChoosePickerShell } from '../../../ui/patterns/choose-picker-shell.js';
import { enhanceChooseSelect } from '../../../ui/patterns/choose-select.js';
import { createTapTempoButton } from '../../../ui/primitives/tap-tempo-button.js';
import { enhanceRangeKnob } from '../../../ui/primitives/range-knob.js';
import { registerHeaderPresets, presetStateKey } from '../../../site/header-presets.js';
import { generationTopology, timeFoldFromSlider, sliderFromTimeFold } from '../micmic.js';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, sanitizeParameters, sanitizePerformance,
  presetState, randomState, captureScene, gestureParameters, clamp, admittedPreviewNodes, applyPreviewDepth,
  buildPreview, topologyBounds, fitTransform, visualBudget, nativePreviewNodes, preparePreviewTransition, advancePreviewTransition, createPreviewDrawSelection,
  topologyIdentity, tapActivityFrame, activityEnergy, smoothActivity, branchWavePoints, inputHistoryFrame } from './model.js';
import { DEFAULT_MASTERING, MASTERING_PROFILES, masteringProfileId, cutoffFromSlider, sliderFromCutoff } from './mastering.js';
import { createBrowserDelayEngine } from './browser-engine.js';
import { SAMPLE_INPUT_OPTIONS, DEFAULT_SAMPLE_ID } from './input-source.js';
import { createGpuBranchRenderer } from './gpu-renderer.js';
import { config as parametricConfig } from '../../l-system-parametric-lab/config.js';
import { config as experimentsConfig, KIND_LABELS } from '../../l-system-experiments/config.js';
import { sanitizeLab, defaultLab, randomLab } from '../../l-system-parametric-lab/model.js';

import { FAVE_TOOL_IDS, TOOL_GROUPS } from '../../../site/instrument-registry.js';
import { createMidiStatus } from '../../../ui/patterns/midi-status.js';
import { installBrowserMidiAdapter } from '../../../browser-midi-adapter.js';
import { getSharedMidiManager } from '../../../midi-manager.js';

const SITE_ROOT = new URL('../../../../', import.meta.url);
const $ = id => document.getElementById(id);
const LAB_CONFIG = document.body.dataset.lSystemLab === 'parametric' ? parametricConfig
  : document.body.dataset.lSystemLab === 'experiments' ? experimentsConfig : null;
const INSTRUMENT_ID = LAB_CONFIG?.id ?? 'micmic-rust', INSTRUMENT_LABEL = LAB_CONFIG?.label ?? 'L-system Delay Rust';
const LAB_CONTROL_IDS = { lengthRatio: 'labLengthRatio', angleIncrement: 'labAngleIncrement', delayRatio: 'labDelayRatio',
  pitchRatio: 'labPitchRatio', branchCount: 'labBranchCount', minLength: 'labMinLength', contextStrength: 'labContextStrength', symbolRatio: 'labSymbolRatio' };
const labControlIds = Object.values(LAB_CONTROL_IDS).filter(id => $(id));
const initialParameters = LAB_CONFIG?.presets[0].snapshot.parameters ?? DEFAULT_PARAMETERS;
const state = { parameters: sanitizeParameters(initialParameters), performance: { ...DEFAULT_PERFORMANCE }, audio: false, status: {},
  input: { mode: 'mic', sampleId: DEFAULT_SAMPLE_ID, label: 'Mic / line', pending: false, playing: false, hasFile: false, fileName: '', loop: true, ended: false, credit: '', creditUrl: '' },
  requestedVoices: 0, eligibleVoices: 0, generationLimits: {}, memoryVoiceCapacity: Number.MAX_SAFE_INTEGER };
const CONTROL_IDS = { generations: 'generations', intervalMs: 'interval', timeRatio: 'timeRatio', angle: 'generationAngle',
  asymmetry: 'generationAsymmetry', curls: 'curls', mutation: 'mutation', pitchScale: 'generationPitchScale', pruningBias: 'pruningBias', depth: 'depth', spread: 'spread',
  ...($('grammarSeed') ? { grammarSeed: 'grammarSeed', branchProbability: 'branchProbability' } : {}) };
const PERFORMANCE_IDS = { wet: 'wet', dry: 'dry', inputGain: 'inputTrim', level: 'level', voiceCeiling: 'voiceCeiling' };
const MASTERING_FREQUENCIES = { inputHighpassHz: 2000, highpassHz: 2000, lowpassHz: 20000 };
const MASTERING_IDS = [...Object.keys(MASTERING_FREQUENCIES), 'thresholdDb', 'ratio', 'kneeDb', 'attackMs', 'releaseMs', 'makeupDb'];
const TYPE_LABELS = Object.fromEntries([...$('lSystemType').options].map(o => [o.value, o.textContent]));
const COLORS = ['#fff3d6', '#55d9ff', '#5fe8c4', '#7db4ff', '#c79bff', '#ff826f', '#e8c46b'];
let disposed = false, bootstrapped = false, parameterRevision = 0, performanceRevision = 0;
let parameterDirty = false, performanceDirty = false, parameterWorking = false, performanceWorking = false;
let depthDirty = false, depthWorking = false, depthRevision = 0, depthTimer;
let depthRequest = null, performanceRequest = null;
let parameterTimer, performanceTimer, pollTimer, pollWorking = false;
let audioRevision = 0, audioDesired = false, audioPending = false, mutationChain = Promise.resolve(), lastFailure = '';
let microphoneRevision = 0, microphoneDesired = false, microphonePending = false;
let inputRevision = 0;
let manualFlashUntil = 0, tapReceivedAt = -Infinity, inputReceivedAt = -Infinity, activityDrawAt = performance.now();
let inputTelemetry = { reader: null, receivedAt: -Infinity, clock: 0, clockReceivedAt: 0, endTime: -Infinity };
let tapIdentity = topologyIdentity(state.parameters), tapTargets = new Map(), tapLevels = new Map(), rootLevel = 0;
let minimumTapRevision = 0;
let lastDrawAt = -Infinity, visualCostMs = 0;
let geometry = null, frameId = 0, drag = null, rangeGesture = false, gestureUntil = 0, lockedFit = null;
let rangeGestureOwner = null, rangeGesturePointer = null, voiceCeilingExact = null;
const parameterKnobs = new Map();
let stageWidth = 0, stageHeight = 0;
const waveScratch = [];
let nativePreview = null, nativePreviewStarted = 0, nativePreviewMoving = false, previewTransition = null;
let previewParameters = { ...state.parameters };
let visualRevision = 0, previewRefreshWorking = false, previewRefreshDirty = false;
let presets = [], lastScenePreset = LAB_CONFIG?.presets[0].id ?? 'pythagorean', presetController, sceneApplying = false;
const canvas = $('stage'), context = canvas.getContext('2d'), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// The original canvas retains gestures, focus and small annotations. Branch
// deformation lives in a separate GPU layer, with the full Canvas fallback.
const rendererMode = new URLSearchParams(location.search).get('renderer');
const gpuRenderer = rendererMode === 'canvas' ? null
  : createGpuBranchRenderer(canvas, COLORS, { onInvalidate: scheduleDraw, force: rendererMode === 'webgl2' });
canvas.dataset.renderer = gpuRenderer?.available ? 'webgl2' : 'canvas';
const inputStrip = createAudioInputStrip({ button: $('micButton'), gainInput: $('inputTrim'), gainOutput: $('inputTrimOut'), channels: 1 });
$('inputMenu').classList.add('mz-input-legacy');
const sampleGroups = new Map();
for (const option of SAMPLE_INPUT_OPTIONS) {
  const group = option.group || 'Recordings';
  if (!sampleGroups.has(group)) { const element = document.createElement('optgroup'); element.label = group; sampleGroups.set(group, element); }
  sampleGroups.get(group).append(new Option(option.label, option.id));
}
$('inputSample').replaceChildren(...sampleGroups.values()); $('inputSample').value = DEFAULT_SAMPLE_ID;
const inputChoices = new Map([
  ['source', enhanceChooseSelect($('source'), { label: 'Choose input' })],
  ['inputSample', enhanceChooseSelect($('inputSample'), { label: 'Choose sample preset' })],
]);
const outputMeter = createStereoMeter({ active: false });
const audioStrip = createAudioStrip({ buttonId: 'audioButton', levelId: 'level', level: .58, levelLabel: 'Output',
  levelAriaLabel: `${INSTRUMENT_LABEL} output level`, onAudioClick: () => void toggleAudio(),
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

// Share Morphazoid's current catalogue while retaining this instrument's audio lifecycle.
const toolsById = new Map(TOOL_GROUPS.flatMap(group => group.tools).map(tool => [tool.id, tool]));
const choose = createChoosePickerShell(document, { current: INSTRUMENT_LABEL, label: `Choose instrument. Current: ${INSTRUMENT_LABEL}`,
  title: INSTRUMENT_LABEL, panelId: 'instrument-picker-panel-native', placeholder: 'Type an instrument', filterLabel: 'Find instrument', listLabel: 'Instruments' });
choose.details.setAttribute('data-active-tool-id', INSTRUMENT_ID);
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
  section.open = group.id === 'faves' || group.tools.some(t => t.id === INSTRUMENT_ID);
  const rows = [];
  for (const tool of group.tools) {
    const row = document.createElement('div'); row.className = 'instrument-picker-row'; row.dataset.filterText = `${tool.label} ${group.label}`.toLocaleLowerCase();
    const link = document.createElement('a'); link.className = 'instrument-picker-link'; link.href = new URL(tool.href, SITE_ROOT).href;
    link.dataset.toolId = tool.id; link.title = tool.label;
    const icon = document.createElement('img'); icon.className = 'instrument-picker-link-icon'; icon.alt = ''; icon.width = 24; icon.height = 24;
    icon.decoding = 'async'; icon.loading = 'lazy'; icon.src = new URL(tool.imageHref || `assets/instruments/${tool.id}.webp`, SITE_ROOT).href;
    const name = document.createElement('span'); name.className = 'instrument-picker-link-label'; name.textContent = tool.label;
    link.append(icon, name);
    if (tool.id === INSTRUMENT_ID) { link.classList.add('is-current'); link.setAttribute('aria-current', 'page'); }
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
const nextInstrument = document.createElement('a'); nextInstrument.className = 'instrument-picker-next'; nextInstrument.href = new URL(LAB_CONFIG?.nextHref ?? 'graph-delay.html', SITE_ROOT).href;
nextInstrument.setAttribute('aria-label', `Next instrument: ${LAB_CONFIG?.nextLabel ?? 'Graph Delay'}`); nextInstrument.title = nextInstrument.getAttribute('aria-label'); nextInstrument.innerHTML = '<span class="instrument-picker-next-icon" aria-hidden="true">▶</span>';
$('instrumentNavigation').append(choose.details, nextInstrument);
$('instrumentIdentity').innerHTML = `<article class="instrument-picker-card"><header class="instrument-picker-card-heading"><div class="instrument-picker-card-visual"><img class="instrument-picker-card-image" alt="" width="512" height="512" loading="eager" decoding="sync" src="${new URL(LAB_CONFIG?.image ?? 'assets/instruments/micmic.webp', SITE_ROOT).href}"></div><div class="instrument-picker-card-heading-copy"><${LAB_CONFIG ? 'h2' : 'h1'} class="instrument-picker-card-title">${INSTRUMENT_LABEL}</${LAB_CONFIG ? 'h2' : 'h1'}><p class="instrument-picker-card-subtitle">Rust/WASM audio processor</p><ul class="instrument-picker-card-tags" aria-label="L-system Delay tags"><li>Audio Effect</li><li>Fractal</li><li>Recursive</li><li>${LAB_CONFIG ? 'Work in Progress' : 'Faves'}</li></ul></div></header><ul class="instrument-picker-card-traits" aria-label="L-system Delay inputs and controls"><li>Mic / line input</li><li>Local audio files</li><li>Recorded samples</li></ul><p class="instrument-picker-card-description">${LAB_CONFIG?.description ?? 'Runs microphone, local audio files and recorded samples through an L-system tree where branches become delays and turns become pitch shifts.'}</p><div class="instrument-picker-card-start"><h3>Start</h3><p>${LAB_CONFIG?.start ?? 'Choose an input, enable Audio, then change the grammar or branch timing.'}</p></div></article>`;

const midiManager = getSharedMidiManager();
const midiAdapter = installBrowserMidiAdapter(globalThis, document, { routeId: INSTRUMENT_ID, manager: midiManager });
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
const browserEngine = createBrowserDelayEngine({ initialParameters: state.parameters,
  onStatus: reply => acceptStatus(reply), onError: error => showError(error?.message ?? String(error)) });

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
function syncActivityIdentity(parameters = previewParameters) {
  const identity = topologyIdentity(parameters);
  if (identity === tapIdentity) return;
  // Generation growth retains stable pool slots. A grammar replacement changes
  // their meaning, so only that committed replacement discards old tap levels.
  if (identity.split(':')[0] !== tapIdentity.split(':')[0]) {
    tapTargets = new Map(); tapLevels = new Map(); tapReceivedAt = -Infinity;
  }
  tapIdentity = identity;
}
function updateVisualDepth(depth) {
  if (depth === previewParameters.depth) return;
  const wasSilent = previewParameters.depth === 0;
  previewParameters.depth = depth;
  if (nativePreview) nativePreview.parameters.depth = depth;
  const nodes = geometry?.nodes ?? nativePreview?.nodes;
  if (nodes) applyPreviewDepth(nodes, depth);
  if (!geometry) return;
  if (wasSilent !== (depth === 0)) {
    geometry.activeLimit = -1; geometry.unavailableKey = null;
  }
}
function acceptStatus(reply, { acceptAudio = true } = {}) {
  if (!reply || disposed) return;
  if (reply.input) state.input = { ...state.input, ...reply.input };
  if (reply.generationLimits) state.generationLimits = reply.generationLimits;
  if (reply.memoryVoiceCapacity) state.memoryVoiceCapacity = reply.memoryVoiceCapacity;
  if (reply.status) {
    state.status = reply.status; inputReceivedAt = performance.now();
    inputTelemetry = inputHistoryFrame(reply, inputTelemetry, performance.now());
    const applied = sanitizeParameters(reply.parameters ?? previewParameters);
    const activity = reply.topologyRevision >= minimumTapRevision ? tapActivityFrame(reply, applied) : null;
    if (activity) {
      syncActivityIdentity(applied); tapTargets = activity.levels; tapReceivedAt = performance.now();
    }
    if (reply.topologyRevision >= visualRevision && Number.isFinite(applied.depth)) updateVisualDepth(applied.depth);
    if (reply.topologyRevision > visualRevision) void refreshNativePreview();
  }
  if (acceptAudio && !audioPending && typeof reply.audio === 'boolean' && (!reply.audio || !document.hidden)) { state.audio = reply.audio; audioDesired = reply.audio; }
  state.requestedVoices = reply.requestedVoices ?? state.requestedVoices; state.eligibleVoices = reply.eligibleVoices ?? state.eligibleVoices;
  const failure = reply.error || reply.status?.failure || '';
  if (failure && failure !== lastFailure) showError(failure);
  lastFailure = failure; paintControls(); scheduleDraw();
}
const GEOMETRY_PARAMETERS = ['lSystemType', 'generations', 'timeRatio', 'angle', 'asymmetry', 'curls', 'mutation'];
const LAB_GEOMETRY_PARAMETERS = ['kind', 'iterations', 'lengthRatio', 'angleIncrement', 'branchCount', 'minLength', 'contextStrength', 'symbolRatio'];
function sameLabGeometry(left, right) {
  return left && right ? LAB_GEOMETRY_PARAMETERS.every(key => left[key] === right[key]) : left === right;
}
async function refreshNativePreview() {
  if (previewRefreshWorking) { previewRefreshDirty = true; return; }
  previewRefreshWorking = true;
  try {
    const reply = await request('/api/preview');
    if (disposed || !reply.parameters || reply.topologyRevision < visualRevision) return;
    const parameters = sanitizeParameters(reply.parameters);
    if (LAB_CONFIG && (!parameters.lab || !LAB_CONFIG.kinds.includes(parameters.lab.kind))) return;
    if (reply.topologyRevision === visualRevision && nativePreview) { updateVisualDepth(parameters.depth); return; }
    const targets = reply.visualNodes ?? nativePreviewNodes(reply.nodes ?? []);
    if (!targets.length) return;
    const sameShape = nativePreview && GEOMETRY_PARAMETERS.every(key => parameters[key] === nativePreview.parameters[key])
      && parameters.grammarSeed === nativePreview.parameters.grammarSeed && parameters.branchProbability === nativePreview.parameters.branchProbability
      && sameLabGeometry(parameters.lab, nativePreview.parameters.lab);
    const compatible = sameShape && geometry && targets.length === geometry.nodes.length
      && targets.every((node, index) => node.id === geometry.nodes[index].id);
    visualRevision = reply.topologyRevision; previewParameters = { ...parameters };
    if (compatible) {
      // Timing, pitch, spread, pruning and gain edits reuse the live coordinates,
      // maps and wave paths instead of restarting the tree's visual motion.
      for (let index = 0; index < targets.length; index++) {
        const node = geometry.nodes[index], target = targets[index];
        node.priority = target.priority;
        node.delay = target.delay; node.rate = target.rate;
      }
      applyPreviewDepth(geometry.nodes, parameters.depth);
      for (const wave of geometry.waves.values()) {
        const node = geometry.byId.get(wave.signal.id);
        if (!node) continue;
        wave.signal.delay = node.delay; wave.signal.rate = node.rate;
        wave.signal.startDelay = wave.parent?.delay ?? Math.max(0, node.delay - parameters.intervalMs / 1000);
      }
      geometry.activeLimit = -1; geometry.unavailableKey = null;
      nativePreview.parameters = parameters;
      geometry.drawSelection.invalidate();
      gpuRenderer?.setGeometry(geometry.nodes, { intervalMs: parameters.intervalMs, drawNodes: geometry.drawSelection.select({ audio: state.audio,
        limit: state.status.voiceLimit, levels: tapLevels, depth: parameters.depth }) });
    } else {
      previewTransition = preparePreviewTransition(targets, geometry?.byId);
      applyPreviewDepth(previewTransition.nodes, parameters.depth);
      nativePreviewStarted = performance.now();
      nativePreviewMoving = Boolean(geometry && previewTransition.moving);
      if (!nativePreviewMoving) advancePreviewTransition(previewTransition, 1);
      nativePreview = { parameters, nodes: previewTransition.nodes, bounds: topologyBounds(targets) };
      geometry = null;
    }
    scheduleDraw();
  } catch (error) { if (!disposed) $('liveStatus').textContent = error.message; }
  finally {
    previewRefreshWorking = false;
    if (previewRefreshDirty && !disposed) { previewRefreshDirty = false; void refreshNativePreview(); }
  }
}
function startPreview({ lock = true } = {}) {
  const now = performance.now();
  if (lock && geometry && !lockedFit) lockedFit = { ...geometry.fit };
  // Keep the currently installed tree moving while its next topology is being
  // prepared. The accepted audio pool, rather than requested UI state, owns it.
  if (!rangeGesture) gestureUntil = now + 150; scheduleDraw();
}
function scheduleParameters(immediate = false) {
  parameterDirty = true; if (parameterWorking) return;
  if (!parameterTimer || immediate) { clearTimeout(parameterTimer); parameterTimer = setTimeout(flushParameters, immediate ? 0 : 16); }
}
async function flushParameters() {
  parameterTimer = null;
  if (disposed || parameterWorking || !parameterDirty) return;
  parameterDirty = false; parameterWorking = true;
  const revision = parameterRevision, parameters = { ...state.parameters };
  try {
    const reply = await enqueue(() => revision === parameterRevision ? request('/api/parameters', parameters) : null);
    if (revision === parameterRevision) { acceptStatus(reply); void refreshNativePreview(revision); }
  }
  catch (error) {
    showError(error.message);
    try { const reply = await request('/api/status'); if (revision === parameterRevision && reply.parameters) { state.parameters = sanitizeParameters(reply.parameters); startPreview(); void refreshNativePreview(revision); } acceptStatus(reply); } catch { /* Keep the error visible until reconnection. */ }
  } finally { parameterWorking = false; if (parameterDirty && !disposed) parameterTimer = setTimeout(flushParameters, 16); }
}
function schedulePerformance(immediate = false) {
  performanceDirty = true; if (performanceWorking) return;
  if (!performanceTimer || immediate) { clearTimeout(performanceTimer); performanceTimer = setTimeout(flushPerformance, immediate ? 0 : 16); }
}
async function flushPerformance() {
  performanceTimer = null;
  if (disposed || performanceWorking || !performanceDirty) return;
  performanceDirty = false; performanceWorking = true;
  const revision = performanceRevision, snapshot = { ...state.performance };
  try {
    const pending = request('/api/performance', snapshot); performanceRequest = pending;
    const reply = await pending;
    if (revision === performanceRevision) acceptStatus(reply);
  }
  catch (error) {
    showError(error.message);
    try { const reply = await request('/api/status'); if (revision === performanceRevision && reply.performance) state.performance = sanitizePerformance(reply.performance); acceptStatus(reply); } catch { /* Preserve the visible error. */ }
  } finally { performanceRequest = null; performanceWorking = false; if (performanceDirty && !disposed) performanceTimer = setTimeout(flushPerformance, 16); }
}
function scheduleDepth(immediate = false) {
  depthDirty = true; if (depthWorking) return;
  if (!depthTimer || immediate) { clearTimeout(depthTimer); depthTimer = setTimeout(flushDepth, immediate ? 0 : 16); }
}
async function flushDepth() {
  depthTimer = null;
  if (disposed || depthWorking || !depthDirty) return;
  depthDirty = false; depthWorking = true;
  const revision = depthRevision, depth = state.parameters.depth;
  try {
    const pending = request('/api/depth', { depth }); depthRequest = pending;
    const reply = await pending;
    if (revision === depthRevision) acceptStatus(reply);
  } catch (error) { showError(error.message); }
  finally { depthRequest = null; depthWorking = false; if (depthDirty && !disposed) depthTimer = setTimeout(flushDepth, 16); }
}
function updateParameter(key, value, immediate = false) {
  if (sceneApplying) return;
  state.parameters = sanitizeParameters({ ...state.parameters, [key]: value,
    ...(LAB_CONFIG && key === 'generations' ? { lab: { ...state.parameters.lab, iterations: value } } : {}) });
  if (key === 'depth') { depthRevision++; scheduleDepth(immediate); }
  else { parameterRevision++; startPreview(); scheduleParameters(immediate); }
  paintControls(); presetController?.refresh();
}
function updatePerformance(key, value, immediate = false, musical = true) {
  if (sceneApplying && ['wet', 'dry', 'inputGain', 'level', 'mastering', 'frequency', 'pulseRate'].includes(key)) return;
  state.performance = sanitizePerformance({ ...state.performance, [key]: value }); performanceRevision++;
  paintControls(); schedulePerformance(immediate); presetController?.refresh();
}
function updateMastering(settings, immediate = false) {
  updatePerformance('mastering', { ...state.performance.mastering, ...settings }, immediate);
}
async function applyScene(scene, id = 'custom') {
  if (disposed || sceneApplying) return;
  const next = presetState(scene, state.performance), previous = { parameters: state.parameters, performance: state.performance };
  sceneApplying = true;
  const picker = document.querySelector('.instrument-preset-controls');
  const restoreFocus = Boolean(picker?.contains(document.activeElement));
  if (picker) picker.inert = true;
  const controls = [...new Set([...Object.values(CONTROL_IDS), ...labControlIds, 'labKind', 'regrowGrammar', 'lSystemType', 'wet', 'dry', 'inputTrim', 'level',
    ...MASTERING_IDS, 'masteringPreset', 'compressorEnabled', 'autoMakeup', 'frequency', 'pulseRate', 'centerAngles', 'resetGenerationRules'])]
    .map($).filter(Boolean);
  const disabled = controls.map(control => control.disabled);
  for (const control of controls) control.disabled = true;
  canvas.setAttribute('aria-busy', 'true');
  if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
  drag = null; cancelParameterGestures(); lockedFit = geometry ? { ...geometry.fit } : null;
  clearTimeout(parameterTimer); clearTimeout(performanceTimer); clearTimeout(depthTimer);
  parameterTimer = performanceTimer = depthTimer = null; parameterDirty = performanceDirty = depthDirty = false; depthRevision++;
  state.parameters = next.parameters; state.performance = next.performance; parameterRevision++; performanceRevision++;
  const revision = parameterRevision; startPreview({ lock: false }); paintControls();
  try {
    await enqueue(async () => {
      if (disposed || revision !== parameterRevision) return;
      // A preset owns its complete mix/depth after older live controls finish.
      // Their canceled timers cannot enqueue another stale gesture afterward.
      await Promise.allSettled([depthRequest, performanceRequest].filter(Boolean));
      if (disposed || revision !== parameterRevision) return;
      acceptStatus(await request('/api/performance', presetState(scene, state.performance).performance));
      const reply = await request('/api/parameters', next.parameters);
      minimumTapRevision = Math.max(minimumTapRevision, reply.topologyRevision ?? 0);
      acceptStatus(reply);
    });
    await refreshNativePreview(revision);
    if (presets.some(p => p.id === id)) lastScenePreset = id;
  } catch (error) {
    if (revision === parameterRevision) {
      const restored = presetState(previous, state.performance);
      state.parameters = restored.parameters; state.performance = restored.performance; startPreview(); paintControls();
    }
    showError(error.message); throw error;
  } finally {
    sceneApplying = false;
    for (let index = 0; index < controls.length; index++) controls[index].disabled = disabled[index];
    if (picker) picker.inert = false;
    canvas.setAttribute('aria-busy', 'false');
    if (restoreFocus && document.activeElement === document.body) picker?.querySelector('summary')?.focus({ preventScroll: true });
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
  inputRevision++;
  const revision = ++microphoneRevision;
  microphoneDesired = microphonePending ? !microphoneDesired : state.status.microphonePending ? false : !Boolean(state.status.microphoneEnabled);
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
async function changeInput(action, { selectingSource = false } = {}) {
  const revision = ++inputRevision; clearError();
  if (selectingSource) { microphoneRevision++; microphoneDesired = false; microphonePending = false; }
  try {
    const reply = await action();
    if (revision === inputRevision && !disposed) acceptStatus(reply);
  } catch (error) {
    if (revision === inputRevision && !disposed && error.name !== 'AbortError') showError(error.message);
  }
  if (!disposed) paintControls();
}
async function strike() {
  if (state.performance.source !== 'seed') return;
  manualFlashUntil = performance.now() + 240; scheduleDraw();
  if (!state.audio) { $('liveStatus').textContent = 'Seed gesture. Audio remains off.'; audioStrip.setAttention(true); return; }
  try { acceptStatus(await enqueue(() => request('/api/strike', {}))); } catch (error) { if (!(error.status === 409 && !state.audio)) showError(error.message); }
}
function resetAll() {
  const performanceDefaults = { ...state.performance, wet: DEFAULT_PERFORMANCE.wet, dry: DEFAULT_PERFORMANCE.dry,
    frequency: DEFAULT_PERFORMANCE.frequency, pulseRate: DEFAULT_PERFORMANCE.pulseRate,
    mastering: DEFAULT_MASTERING };
  void applyScene({ parameters: initialParameters, performance: performanceDefaults }, LAB_CONFIG?.presets[0].id ?? 'pythagorean').catch(() => {});
}
function centerAngles() {
  if (disposed || sceneApplying) return;
  cancelParameterGestures();
  state.parameters = sanitizeParameters({ ...state.parameters, angle: 90, asymmetry: 0, curls: 0 });
  parameterRevision++; startPreview(); paintControls(); scheduleParameters(true); presetController?.refresh();
}
function formatParameter(key, value) {
  if (key === 'grammarSeed') return String(value);
  if (key === 'branchProbability') return `${Math.round(value * 100)}%`;
  if (key === 'generations' && LAB_CONFIG) return `${value} iterations`;
  if (key === 'generations') return `${value} / ${state.generationLimits[state.parameters.lSystemType] ?? 52}`;
  if (key === 'intervalMs') return `${Math.round(value)} ms`;
  if (key === 'timeRatio') return `${Number(value.toFixed(2))}× per generation`;
  if (key === 'angle') return `${Number(value.toFixed(1))}°`;
  if (key === 'curls') return Math.abs(value) < .005 ? 'original' : `${Number(Math.abs(value).toFixed(2))} turns ${value < 0 ? 'CW' : 'CCW'}`;
  if (key === 'pitchScale') return `${Math.round(value * 100)}% / 180°`;
  if (key === 'pruningBias') return value <= .01 ? 'breadth first' : value >= .99 ? 'depth first' : `${Math.round(value * 100)}% depth first`;
  if (key === 'asymmetry') return Math.abs(value) < .005 ? 'even' : `${Math.round(Math.abs(value) * 100)}% ${value > 0 ? 'right' : 'left'} wider`;
  if (key === 'depth' && value === 1) return '100% · no decay';
  if (key === 'mutation' && LAB_CONFIG) return `${Math.round(value * 100)}% module variation`;
  if (key === 'mutation') return `${Math.round(value * 100)}% ${state.parameters.lSystemType === 'pythagorean' ? 'branch' : 'delay'} variation`;
  return `${Math.round(value * 100)}%`;
}
function formatMastering(key, value) {
  if (key in MASTERING_FREQUENCIES) return value > 0 ? `${Math.round(value).toLocaleString()} Hz` : 'Off';
  const amount = Number(value.toFixed(1));
  if (key === 'ratio') return `${amount}:1`;
  if (key === 'attackMs' || key === 'releaseMs') return `${amount} ms`;
  return `${key === 'makeupDb' && amount > 0 ? '+' : ''}${amount} dB`;
}
function paintInput() {
  const input = state.input, mic = input.mode === 'mic', file = input.mode === 'file';
  const microphoneActive = Boolean(state.status.microphoneEnabled);
  const pending = input.pending || mic && (microphonePending || Boolean(state.status.microphonePending));
  const label = mic ? 'Mic / line' : file ? input.fileName || 'Audio file' : SAMPLE_INPUT_OPTIONS.find(item => item.id === input.sampleId)?.label || input.label;
  const playing = mic ? microphoneActive : input.playing;
  const summary = pending ? 'loading' : playing ? state.performance.frozen ? 'paused' : 'live' : input.ended ? 'finished' : 'ready';
  for (const [id, value] of [['source', input.mode], ['inputSample', input.sampleId]]) {
    if ($(id).value !== value) { $(id).value = value; inputChoices.get(id).refresh(); }
  }
  $('inputSampleControl').hidden = input.mode !== 'samples';
  $('inputFileControl').hidden = !file; $('inputMicHelp').hidden = !mic;
  $('inputPlaybackControls').hidden = mic;
  $('inputLoop').checked = input.loop;
  $('restartInput').disabled = !bootstrapped || !state.audio || pending || file && !input.hasFile;
  $('restartInput').textContent = file ? 'Restart file' : 'Restart sample';
  $('stopInput').disabled = !pending && !playing;
  $('inputSummary').textContent = `${mic ? label : file ? 'Audio file' : 'Built-in samples'} · ${summary}`;
  const status = pending ? `Loading ${label}…`
    : mic ? microphoneActive ? `Mic / line ${state.performance.frozen ? 'paused' : 'live'}${state.audio ? '' : ' · Audio off'}` : 'Mic / line ready · use Mic to start input'
      : file && !input.hasFile ? 'Choose a local audio file'
        : playing ? `${label} · ${state.performance.frozen ? 'paused' : input.loop ? 'looping' : 'playing'}`
          : input.ended ? `${label} · finished · Restart to play again`
            : `${label} · ${state.audio ? 'stopped · Restart to play' : 'ready · enable Audio to play'}`;
  if ($('inputSourceStatus').textContent !== status) $('inputSourceStatus').textContent = status;
  const credit = $('inputSourceCredit'), creditKey = `${input.credit || ''}\n${input.creditUrl || ''}`;
  if (credit.dataset.credit !== creditKey) {
    credit.dataset.credit = creditKey; credit.replaceChildren();
    if (input.credit) {
      if (/^https?:\/\//.test(input.creditUrl || '')) {
        const link = document.createElement('a'); link.href = input.creditUrl; link.textContent = input.credit; credit.append(link);
      } else credit.textContent = input.credit;
    }
  }
  credit.hidden = !input.credit;
}
function paintControls() {
  if ($('stochasticControls')) $('stochasticControls').hidden = state.parameters.lSystemType !== 'stochastic';
  const branchVariation = state.parameters.lSystemType === 'pythagorean';
  $('mutationLabel').textContent = LAB_CONFIG ? 'Module variation' : branchVariation ? 'Branch variation' : 'Delay variation';
  const mutationGuide = LAB_CONFIG ? 'Adds stable per-module length and timing variation while retaining the same rule identities.'
    : branchVariation ? 'Varies branch turns, lengths and delay timing in Pythagorean Pine.'
    : 'Varies delay timing while preserving this pattern’s branch shape and pitch turns.';
  $('mutationGuide').textContent = mutationGuide; $('mutation').title = mutationGuide;
  for (const [key, id] of Object.entries(CONTROL_IDS)) {
    const value = state.parameters[key]; $(id).value = key === 'intervalMs' ? sliderFromTimeFold(value) : value;
    const text = formatParameter(key, value); $(`${id}Out`).textContent = text; $(id).setAttribute('aria-valuetext', text);
  }
  $('lSystemType').value = state.parameters.lSystemType;
  for (const [key, id] of Object.entries(PERFORMANCE_IDS)) {
    const value = state.performance[key]; $(id).value = value;
    $(`${id}Out`).textContent = key === 'voiceCeiling' ? value === 0 ? 'No cap' : value.toLocaleString() : key === 'dry' && value === 0 ? 'muted' : `${Math.round(value * 100)}%`;
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
  $('generations').max = String(LAB_CONFIG ? 24 : state.generationLimits[state.parameters.lSystemType] ?? 52);
  paintLabControls();
  $('voiceCeiling').max = String(state.memoryVoiceCapacity);
  const mic = state.input.mode === 'mic', microphoneActive = Boolean(state.status.microphoneEnabled);
  const inputActive = (state.performance.source === 'seed' ? state.audio : mic ? microphoneActive : state.input.playing) && !state.performance.frozen;
  $('automatic').checked = state.performance.automatic;
  inputStrip.setGain(state.performance.inputGain); inputStrip.setInputState({ active: mic && microphoneActive, pending: microphonePending || Boolean(state.status.microphonePending), supported: bootstrapped });
  inputStrip.meter.setActive(inputActive);
  const inputLabel = `${mic && microphoneActive ? 'Stop' : 'Start'} microphone input${state.audio ? '' : '. Audio remains off'}`;
  inputStrip.button.setAttribute('aria-label', inputLabel); inputStrip.button.title = inputLabel;
  inputStrip.setLevels(inputActive ? Number(state.status.inputPeak) || 0 : 0);
  paintInput();
  const audioState = audioPending ? 'starting' : state.audio ? 'on' : lastFailure ? 'error' : 'off';
  audioStrip.setAudioState(audioState); $('audioButton').disabled = !bootstrapped;
  $('audioButton').setAttribute('aria-pressed', String(audioDesired)); $('audioButton').setAttribute('aria-busy', String(audioPending));
  const audioLabel = audioPending ? audioDesired ? 'Audio starting. Cancel Audio start' : 'Audio stopping. Enable Audio' : state.audio ? 'Audio is on. Disable Audio' : 'Audio is off. Enable Audio';
  $('audioButton').setAttribute('aria-label', audioLabel); $('audioButton').title = audioLabel;
  outputMeter.setActive(state.audio); outputMeter.setLevels(state.audio ? Number(state.status.outputLeftPeak) || 0 : 0, state.audio ? Number(state.status.outputRightPeak) || 0 : 0);
  $('panicButton').disabled = !state.audio && !audioPending;
  const p = state.parameters, s = state.status, type = p.lab ? KIND_LABELS[p.lab.kind] ?? 'Parametric branches' : TYPE_LABELS[p.lSystemType], pruning = formatParameter('pruningBias', p.pruningBias);
  const requested = Number(state.requestedVoices) || (!p.lab && p.lSystemType === 'pythagorean' ? 2 ** (p.generations + 1) - 2 : 0);
  const limit = Math.max(0, Number(s.voiceLimit) || 0);
  $('generationCapacityInline').textContent = `${limit.toLocaleString()} of ${requested.toLocaleString()} branches ${state.audio ? 'available' : 'ready'} · ${pruning} pruning · ${state.performance.automatic ? 'device-adjusted' : 'manual ceiling'}`;
  $('generationCapacityInline').title = 'Color shows admitted audio voices. Waves show signal amplitude. Device capacity is measured separately from sound travel time.';
  $('recursionSummary').textContent = `${type} · ${p.generations} ${LAB_CONFIG ? 'iterations' : 'generations'}${p.curls ? ` · ${formatParameter('curls', p.curls)} curls` : ''}`;
  $('mixSummary').textContent = `${Math.round(state.performance.wet * 100)}% descendants · ${state.performance.dry ? `${Math.round(state.performance.dry * 100)}% root` : 'root muted'}`;
  $('currentSettingsSummary').textContent = `${p.generations} ${LAB_CONFIG ? 'iterations' : 'gen'} · ${Math.round(p.intervalMs)} ms root fold`;
  $('pitchDetailStatus').textContent = `Independent granular · ${Number(s.activeVoices ?? 0).toLocaleString()} active voices · ${p.pitchScale === 0 ? 'exact unison' : 'independent pitch shifts'}`;
  $('generationKeyEnd').textContent = `G${p.generations} DESCENDANT`;
  const sourceState = state.performance.frozen ? 'INPUT PAUSED' : inputActive ? mic ? 'MIC / LINE LIVE' : state.input.mode === 'file' ? 'FILE LIVE' : 'SAMPLE LIVE' : 'INPUT STOPPED';
  $('stageReadout').textContent = `${state.audio ? sourceState : 'AUDIO OFF'} · ${type.toUpperCase()} · ${p.generations} ${LAB_CONFIG ? 'ITERATIONS' : 'GENERATIONS'}`;
  $('generationTimingReadout').textContent = `${Math.round(p.intervalMs)} ms → ${Number((p.intervalMs * p.timeRatio).toFixed(2))} ms → ${Number((p.intervalMs * p.timeRatio ** 2).toFixed(2))} ms … ${Number((p.intervalMs * p.timeRatio ** p.generations).toFixed(2))} ms at G${p.generations}`;
  if (p.lab) $('generationTimingReadout').textContent = p.lab.kind === 'parametric'
    ? `${Math.round(p.intervalMs)} ms base fold · ${Number((p.timeRatio * p.lab.delayRatio).toFixed(3))}× child duration`
    : `${Math.round(p.intervalMs)} ms base fold · ${Number(p.lab.symbolRatio.toFixed(3))}× ${['penrose', 'sphinx'].includes(p.lab.kind) ? 'tile pitch contrast' : 'symbol duration ratio'}`;
  $('generationPitchReadout').textContent = `${Number((-p.angle * (1 - p.asymmetry)).toFixed(1))}° → ${Number((-p.angle * (1 - p.asymmetry) / 180 * p.pitchScale * 100).toFixed(1))}% octave · ${Number((p.angle * (1 + p.asymmetry)).toFixed(1))}° → ${Number((p.angle * (1 + p.asymmetry) / 180 * p.pitchScale * 100).toFixed(1))}% octave`;
  $('outputDevice').textContent = s.device || 'Default output'; $('inputDevice').textContent = mic ? s.inputDevice || 'Default input' : state.input.label || (state.input.mode === 'file' ? 'Audio file' : 'Built-in sample');
  $('sampleRate').textContent = s.sampleRate ? `${(s.sampleRate / 1000).toFixed(1)} kHz` : '—';
  $('activeVoices').textContent = s.activeVoices === undefined ? '—' : `${s.activeVoices.toLocaleString()} / ${(s.voiceLimit ?? state.performance.voiceCeiling).toLocaleString()}`;
  $('requestedVoices').textContent = requested.toLocaleString(); $('eligibleVoices').textContent = Number(state.eligibleVoices).toLocaleString();
  $('cpuLoad').textContent = Number.isFinite(s.cpuLoad) ? `${(s.cpuLoad * 100).toFixed(1)}%` : '—'; $('peakLoad').textContent = Number.isFinite(s.peakLoad) ? `${(s.peakLoad * 100).toFixed(1)}%` : '—';
  $('streamMisses').textContent = `${s.underruns || 0} / ${s.deadlineMisses || 0}`; $('engineStatus').textContent = lastFailure || (state.audio ? 'Audio is running.' : 'Audio is off.');
  audioStrip.update();
  // Property-only preset/status paints must update the dials after dynamic
  // generation and memory limits, without dispatching musical input events.
  for (const knob of parameterKnobs.values()) knob.update();
  if (voiceCeilingExact) {
    const input = $('voiceCeiling');
    voiceCeilingExact.min = input.min; voiceCeilingExact.max = input.max; voiceCeilingExact.step = input.step;
    voiceCeilingExact.disabled = input.disabled;
    if (document.activeElement !== voiceCeilingExact) voiceCeilingExact.value = String(state.performance.voiceCeiling);
  }
}

function buildGeometry() {
  const box = canvas.getBoundingClientRect(), width = Math.max(1, box.width), height = Math.max(1, box.height), dpr = Math.min(2, devicePixelRatio || 1);
  if (width !== stageWidth || height !== stageHeight) { stageWidth = width; stageHeight = height; lockedFit = null; }
  const nodes = nativePreview?.nodes ?? (LAB_CONFIG ? [] : buildPreview(previewParameters, generationTopology));
  const desiredFit = fitTransform(nativePreview?.bounds ?? topologyBounds(nodes), width, height);
  const byId = new Map(nodes.map(n => [n.id, n]));
  geometry = { width, height, dpr, nodes, byId, waves: new Map(), root: nodes.find(n => n.generation === 0), desiredFit, fit: lockedFit ? { ...lockedFit } : desiredFit,
    activeLimit: -1, active: [], activeIds: new Set(), unavailableKey: null, drawSelection: createPreviewDrawSelection(nodes) };
  gpuRenderer?.setGeometry(nodes, { intervalMs: previewParameters.intervalMs, drawNodes: geometry.drawSelection.select({ audio: state.audio,
    limit: state.status.voiceLimit, levels: tapLevels, depth: previewParameters.depth }) });
  const counts = new Map(); for (const n of nodes) counts.set(n.generation, (counts.get(n.generation) ?? 0) + 1);
  $('generationCountReadout').textContent = [...counts].slice(0, 6).map(([, count]) => count.toLocaleString()).join(' → ') + (counts.size > 6 ? ` → … → ${(counts.get(Math.max(...counts.keys())) ?? 0).toLocaleString()} previewed at G${Math.max(...counts.keys())}` : '');
  $('treeDescription').textContent = `${state.parameters.lab ? KIND_LABELS[state.parameters.lab.kind] ?? 'Parametric branches' : TYPE_LABELS[state.parameters.lSystemType]}. ${state.parameters.generations} ${LAB_CONFIG ? 'rule iterations' : 'audio generations'}. While Audio is on, the tree shows available delay branches and sounding release tails. Audio off shows the complete preset preview. The green circle marks the start of the first white branch. Signal amplitude bends the connected lines without changing their color or thickness. Long branches also show input traveling toward their measured endpoint.`;
  canvas.setAttribute('aria-label', `Live fitted L-system tree for ${INSTRUMENT_LABEL}. ${state.audio ? state.performance.frozen ? 'Input paused; recursive tail live' : `${state.input.label || 'Input'} ${state.input.playing || state.status.microphoneEnabled ? 'live' : 'stopped'}` : 'Audio off'}.`);
}
function scheduleDraw() { if (!frameId && !disposed) frameId = requestAnimationFrame(draw); }
function draw(now) {
  frameId = 0; if (disposed) return;
  // Rust already smooths average load and releases its peak over .53 seconds.
  // Adding a three-second hold here kept quiet, cheap trees visibly stuttering.
  const budget = visualBudget(state.status.cpuLoad, state.status.peakLoad,
    Boolean(drag || rangeGesture || nativePreviewMoving), state.audio, visualCostMs);
  if (now - lastDrawAt < 1000 / budget.fps - 1) { scheduleDraw(); return; }
  lastDrawAt = now;
  const drawStarted = performance.now(), interpolating = nativePreviewMoving;
  if (nativePreviewMoving) {
    advancePreviewTransition(previewTransition, (now - nativePreviewStarted) / 80);
    nativePreviewMoving = previewTransition.moving;
    if (geometry) {
      geometry.unavailableKey = null;
      gpuRenderer?.updateGeometryPositions(geometry.nodes);
    }
  }
  const rebuilding = !geometry;
  if (rebuilding) buildGeometry();
  const { width, height, nodes, desiredFit } = geometry;
  const dpr = state.audio ? Math.min(geometry.dpr, budget.pressure === 2 ? 1 : budget.pressure === 1 ? 1.5 : 2) : geometry.dpr;
  const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  let fitMoving = false;
  if (lockedFit && !drag && !rangeGesture && now > gestureUntil && !nativePreviewMoving) {
    for (const key of ['scale', 'x', 'y']) {
      const difference = desiredFit[key] - geometry.fit[key]; geometry.fit[key] += difference * .22;
      if (Math.abs(difference) > (key === 'scale' ? .001 : .1)) fitMoving = true;
    }
    if (!fitMoving) { lockedFit = null; geometry.fit = desiredFit; }
  }
  const fit = geometry.fit, project = (x, y) => ({ x: x * fit.scale + fit.x, y: -y * fit.scale + fit.y });
  context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
  const limit = Math.max(0, Number(state.status.voiceLimit) || 0);
  if (geometry.activeLimit !== limit) {
    geometry.activeLimit = limit; geometry.active = admittedPreviewNodes(nodes, limit);
    geometry.activeIds = new Set(geometry.active.map(n => n.id));
    geometry.selectedCounts = new Map();
    for (const n of geometry.active) {
      geometry.selectedCounts.set(n.generation, (geometry.selectedCounts.get(n.generation) ?? 0) + 1);
    }
  }
  const elapsed = Math.max(0, now - activityDrawAt); activityDrawAt = now;
  const fresh = state.audio && now - tapReceivedAt < 300;
  // Retained history remains useful through a slow Canvas frame or HTTP jitter.
  // A short meter timeout must not erase the unmetered descendants' response.
  const historyFresh = state.audio && inputTelemetry.reader && now - inputTelemetry.receivedAt < 2000;
  const seconds = browserEngine.getSampleTime?.() ?? inputTelemetry.clock + clamp((now - inputTelemetry.clockReceivedAt) / 1000, 0, 2);
  for (const [slot, target] of tapTargets) if (target > 0 && !tapLevels.has(slot)) tapLevels.set(slot, 0);
  for (const [slot, level] of tapLevels) {
    const next = smoothActivity(level, fresh ? activityEnergy(tapTargets.get(slot) ?? 0) : 0, elapsed);
    if (next === 0) { tapLevels.delete(slot); continue; }
    tapLevels.set(slot, next);
  }
  rootLevel = smoothActivity(rootLevel, state.audio && now - inputReceivedAt < 300 ? activityEnergy(Number(state.status.inputPeak || 0)) : 0, elapsed);
  const rootNode = geometry.root;
  const branches = geometry.drawSelection.select({ audio: state.audio, limit, levels: tapLevels, depth: previewParameters.depth });
  canvas.dataset.renderer = gpuRenderer?.available ? 'webgl2' : 'canvas';
  if (gpuRenderer?.available) {
    const detailSteps = Math.max(5, Math.min(14, Math.floor(budget.branches * 8 / Math.max(1, geometry.active.length))));
    gpuRenderer.render({ width, height, dpr, fit, seconds, detailSteps, reducedMotion,
      limit, pending: false, historyFresh, history: inputTelemetry.envelope,
      levels: tapLevels, targets: tapTargets, rootLevel, wet: state.performance.wet,
      wetBusGain: Number(state.status.wetBusGain || 0), depth: previewParameters.depth,
      generationCounts: state.status.generationVoiceCounts, selectedCounts: geometry.selectedCounts, drawNodes: branches });
  } else {
    const activeIds = geometry.activeIds;
    // Playing draws the audio branches only. The complete quiet preset remains
    // a readable outline while Audio is off.
    const unavailableKey = `${limit}`;
    if (!state.audio && geometry.unavailableKey !== unavailableKey) {
      geometry.unavailableKey = unavailableKey; geometry.unavailable = new Path2D();
      for (const n of nodes) if (!activeIds.has(n.id)) { geometry.unavailable.moveTo(n.startX, n.startY); geometry.unavailable.lineTo(n.x, n.y); }
    }
    if (!state.audio) {
      context.save(); context.setTransform(dpr * fit.scale, 0, 0, -dpr * fit.scale, dpr * fit.x, dpr * fit.y);
      context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = 'rgba(119,131,126,.58)';
      context.globalAlpha = .4; context.lineWidth = .72 / fit.scale; context.stroke(geometry.unavailable); context.restore();
    }
    const coloredBranches = state.audio ? branches : geometry.active;
    const detailSteps = Math.max(5, Math.min(14, Math.floor(budget.branches * 8 / Math.max(1, coloredBranches.length))));
    const coloredPaths = COLORS.map(() => new Path2D());
    const wet = Number(state.status.wetBusGain || 0) > 0 ? state.performance.wet : 0;
    const voiceLevels = [1];
    for (const n of coloredBranches) if (voiceLevels[n.generation] === undefined) {
      const selectedCount = state.status.generationVoiceCounts?.[n.generation] ?? geometry.selectedCounts.get(n.generation);
      const gain = .5 * previewParameters.depth ** (n.generation * .72) / Math.sqrt(selectedCount || 1);
      voiceLevels[n.generation] = clamp(Math.sqrt(Math.max(0, gain) / .5) * Math.sqrt(wet));
    }
    for (const n of coloredBranches) {
      let wave = geometry.waves.get(n.id);
      if (!wave) {
        const parent = geometry.byId.get(n.parentId);
        wave = { parent, start: {}, end: {}, signal: { id: n.id, generation: n.generation, index: n.index, voiceIndex: n.voiceIndex,
          delay: n.delay, rate: n.rate, startDelay: parent?.delay ?? Math.max(0, (n.delay ?? 0) - previewParameters.intervalMs / 1000) } };
        geometry.waves.set(n.id, wave);
      }
      const { parent, start, end, signal } = wave;
      start.x = n.startX * fit.scale + fit.x; start.y = -n.startY * fit.scale + fit.y;
      end.x = n.x * fit.scale + fit.x; end.y = -n.y * fit.scale + fit.y;
      const history = historyFresh && activeIds.has(n.id);
      const energy = n.generation === 0 ? rootLevel : tapLevels.get(n.voiceIndex) ?? 0;
      const measured = n.generation === 0 || tapTargets.has(n.voiceIndex);
      const parentMeasured = parent?.generation === 0 || tapTargets.has(parent?.voiceIndex);
      const parentEnergy = wet > 0 ? (parent?.generation === 0 ? rootLevel * Math.sqrt(wet) : tapLevels.get(parent?.voiceIndex) ?? 0) : 0;
      signal.voiceLevel = voiceLevels[n.generation]; signal.measuredEnergy = measured ? energy : undefined;
      signal.parentEnergy = parentMeasured ? parentEnergy : undefined;
      const path = coloredPaths[n.generation % COLORS.length];
      if ((!history && energy === 0) || measured && energy === 0 && (!history || signal.delay - signal.startDelay <= .1)) {
        path.moveTo(start.x, start.y); path.lineTo(end.x, end.y); continue;
      }
      const points = branchWavePoints(signal, start, end, history ? inputTelemetry.reader : energy,
        detailSteps, reducedMotion, seconds, waveScratch);
      let peak = !history && !measured ? energy : 0;
      for (const point of points) peak = Math.max(peak, point.energy || 0);
      path.moveTo(points[0].x, points[0].y);
      if (peak === 0) path.lineTo(points.at(-1).x, points.at(-1).y);
      else for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
    }
    // All available lines stay colored and connected at silence. Only wave
    // deflection responds to amplitude; no brightness/width gate creates gaps.
    // Batch by palette color so quiet/high-polyphony trees require few strokes.
    context.lineCap = 'round'; context.lineJoin = 'round';
    context.globalAlpha = .85; context.lineWidth = 1.2; context.shadowBlur = 0;
    for (let i = 0; i < coloredPaths.length; i++) {
      context.strokeStyle = COLORS[i]; context.stroke(coloredPaths[i]);
    }
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  }
  if (state.audio && state.performance.frozen) { context.fillStyle = 'rgba(199,155,255,.72)'; context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'; context.fillText('INPUT PAUSED · DESCENDANTS DECAYING', 18, height - 42); }
  const root = project(rootNode?.startX ?? 0, rootNode?.startY ?? 0), seedSize = clamp(Math.min(width, height) * .085, 46, 62);
  // The annotation canvas stays above both branch renderers.
  context.save(); context.beginPath(); context.arc(root.x, root.y, 4, 0, Math.PI * 2);
  context.fillStyle = '#6de48b'; context.fill();
  context.strokeStyle = '#07090b'; context.lineWidth = 1.5; context.stroke(); context.restore();
  if (now < manualFlashUntil) { context.strokeStyle = COLORS[0]; context.globalAlpha = (manualFlashUntil - now) / 240; context.beginPath(); context.arc(root.x, root.y, seedSize / 2 + 5, 0, Math.PI * 2); context.stroke(); context.globalAlpha = 1; }
  if (!rebuilding && !interpolating) {
    const cost = Math.max(0, performance.now() - drawStarted);
    visualCostMs += (cost - visualCostMs) * .15;
  }
  if (state.audio || tapLevels.size || rootLevel > 0 || drag || nativePreviewMoving || fitMoving || (lockedFit && now <= gestureUntil) || now < manualFlashUntil) scheduleDraw();
}

canvas.addEventListener('pointerdown', event => {
  if (sceneApplying || event.button !== 0 || event.isPrimary === false) return;
  event.preventDefault(); canvas.focus({ preventScroll: true }); lockedFit = geometry ? { ...geometry.fit } : null;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...state.parameters }, changed: false }; canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (dx * dx + dy * dy < 16 && !drag.changed) return;
  drag.changed = true; const box = canvas.getBoundingClientRect();
  state.parameters = gestureParameters(drag.start, dx, dy, box.width, box.height, event.shiftKey); parameterRevision++;
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
  $(id).addEventListener('change', () => key === 'depth' ? scheduleDepth(true) : scheduleParameters(true));
  const input = $(id);
  input.addEventListener('pointerdown', event => {
    if (input.disabled || event.button !== 0 || event.isPrimary === false || rangeGestureOwner) return;
    // Focus may blur the previous knob. Do it before claiming this gesture.
    input.focus({ preventScroll: true });
    lockedFit = geometry ? { ...geometry.fit } : null;
    rangeGestureOwner = input; rangeGesturePointer = event.pointerId;
    rangeGesture = true; gestureUntil = Infinity;
  });
  const release = event => releaseRangeGesture(event, input);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) input.addEventListener(type, release);
}
$('lSystemType').addEventListener('change', () => updateParameter('lSystemType', $('lSystemType').value, true));
function updateLab(key, value, immediate = false) {
  if (!LAB_CONFIG || sceneApplying) return;
  const lab = sanitizeLab({ ...state.parameters.lab, [key]: value });
  state.parameters = sanitizeParameters({ ...state.parameters, generations: lab.iterations, lab });
  parameterRevision++; startPreview(); scheduleParameters(immediate); paintControls(); presetController?.refresh();
}
function paintLabControls() {
  if (!LAB_CONFIG) return;
  const lab = state.parameters.lab ?? defaultLab(LAB_CONFIG.kinds[0]);
  if ($('labKind')) $('labKind').value = lab.kind;
  for (const [key, id] of Object.entries(LAB_CONTROL_IDS)) {
    const input = $(id); if (!input) continue;
    const value = lab[key], text = key === 'angleIncrement' ? `${Number(value.toFixed(1))}°` : key === 'branchCount' ? String(value)
      : key === 'contextStrength' || key === 'minLength' ? `${Number((value * 100).toFixed(1))}%` : `${Number(value.toFixed(3))}×`;
    input.value = value; $(`${id}Out`).textContent = text; input.setAttribute('aria-valuetext', text);
    if (key === 'contextStrength') input.closest('label').hidden = lab.kind !== 'context';
  }
  const help = $('labRuleHelp');
  if (help) help.textContent = lab.kind === 'parametric' ? 'Numeric modules carry child length, turn, delay and pitch. A branch ends when its length falls below Stopping length.'
    : lab.kind === 'context' ? 'Parallel replacements use neighboring symbols. Neighbor influence changes the length and duration carried by each resulting module.'
    : lab.kind === 'thue-morse' || lab.kind === 'fibonacci' ? 'Symbols A and B form a rewritten sequence. Symbol ratio changes their lengths and delay contributions.'
      : 'The tiling is drawn through its unique edges. Symbol ratio changes the pitch contrast between tile types and orientations.';
}
for (const [key, id] of Object.entries(LAB_CONTROL_IDS)) {
  if (!$(id)) continue;
  $(id).addEventListener('input', () => updateLab(key, Number($(id).value)));
  $(id).addEventListener('change', () => scheduleParameters(true));
  const input = $(id);
  input.addEventListener('pointerdown', event => {
    if (input.disabled || event.button !== 0 || event.isPrimary === false || rangeGestureOwner) return;
    input.focus({ preventScroll: true }); lockedFit = geometry ? { ...geometry.fit } : null;
    rangeGestureOwner = input; rangeGesturePointer = event.pointerId; rangeGesture = true; gestureUntil = Infinity;
  });
  const release = event => releaseRangeGesture(event, input);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) input.addEventListener(type, release);
}
$('labKind')?.addEventListener('change', () => updateLab('kind', $('labKind').value, true));
$('regrowGrammar')?.addEventListener('click', () => updateParameter('grammarSeed', (state.parameters.grammarSeed ?? 1) % 4294967295 + 1, true));

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
// The input/output strips already own their header knobs. Enhance the existing
// panel controls only, preserving their IDs, native bounds and live listeners.
for (const id of [...Object.values(CONTROL_IDS), ...labControlIds, 'wet', 'dry', 'voiceCeiling', ...MASTERING_IDS]) {
  const input = $(id);
  if (input.type !== 'range') continue;
  const knob = enhanceRangeKnob(input, id === 'voiceCeiling' ? { scale: 'log' } : {});
  parameterKnobs.set(id, knob);
  $(id).addEventListener('blur', () => knob.cancelGesture());
}
{
  const label = document.createElement('label');
  label.htmlFor = 'voiceCeilingExact'; label.textContent = 'Exact voice cap (0 = no cap)';
  voiceCeilingExact = document.createElement('input');
  voiceCeilingExact.id = 'voiceCeilingExact'; voiceCeilingExact.type = 'number'; voiceCeilingExact.inputMode = 'numeric';
  label.append(voiceCeilingExact); $('voiceCeiling').closest('.native-voice-cap').append(label);
  const commit = () => {
    const input = $('voiceCeiling'), value = voiceCeilingExact.valueAsNumber;
    if (Number.isFinite(value)) {
      input.value = String(Math.round(clamp(value, Number(input.min), Number(input.max))));
      if (Number(input.value) !== state.performance.voiceCeiling) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    voiceCeilingExact.value = String(state.performance.voiceCeiling);
  };
  voiceCeilingExact.addEventListener('change', commit);
  voiceCeilingExact.addEventListener('blur', commit);
  voiceCeilingExact.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); voiceCeilingExact.value = String(state.performance.voiceCeiling); voiceCeilingExact.blur(); }
  });
}
for (const key of ['compressorEnabled', 'autoMakeup']) {
  $(key).addEventListener('change', () => updateMastering({ [key]: $(key).checked }, true));
}
$('masteringPreset').addEventListener('change', () => {
  const preset = MASTERING_PROFILES.find(item => item.id === $('masteringPreset').value);
  if (preset) updateMastering(preset.settings, true);
});
$('source').addEventListener('change', () => void changeInput(() => browserEngine.setInputMode($('source').value), { selectingSource: true }));
$('inputSample').addEventListener('change', () => void changeInput(() => browserEngine.setSample($('inputSample').value), { selectingSource: true }));
$('inputFile').addEventListener('change', () => {
  const file = $('inputFile').files?.[0];
  if (file) void changeInput(() => browserEngine.loadFile(file), { selectingSource: true });
  $('inputFile').value = '';
});
$('inputLoop').addEventListener('change', () => void changeInput(() => browserEngine.setInputLoop($('inputLoop').checked)));
$('restartInput').addEventListener('click', () => void changeInput(() => browserEngine.restartInput()));
$('stopInput').addEventListener('click', () => void changeInput(() => browserEngine.stopInput()));
inputStrip.button.addEventListener('click', () => void toggleMicrophone());
$('automatic').addEventListener('change', () => updatePerformance('automatic', $('automatic').checked, true, false));
$('panicButton').addEventListener('click', () => void toggleAudio(false));
$('freezeButton').addEventListener('click', () => void toggleAudio(false));
document.querySelector('[data-reset-all]').addEventListener('click', resetAll);
$('centerAngles').addEventListener('click', centerAngles);
$('resetGenerationRules').addEventListener('click', () => presetController?.view?.select(lastScenePreset));
$('nativeSettings').addEventListener('toggle', () => $('settingsButton').setAttribute('aria-expanded', String($('nativeSettings').open)));
function releaseRangeGesture(event, owner = rangeGestureOwner) {
  if (!rangeGesture || owner !== rangeGestureOwner || (event?.pointerId !== undefined && event.pointerId !== rangeGesturePointer)) return;
  rangeGesture = false; rangeGestureOwner = null; rangeGesturePointer = null;
  gestureUntil = performance.now() + 100; scheduleDraw();
}
document.addEventListener('pointerup', releaseRangeGesture); document.addEventListener('pointercancel', releaseRangeGesture);
function cancelParameterGestures() {
  for (const knob of parameterKnobs.values()) knob.cancelGesture();
  releaseRangeGesture();
}
addEventListener('blur', cancelParameterGestures);
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
    let [reply, bank] = await Promise.all([request('/api/state'), LAB_CONFIG ? Promise.resolve(LAB_CONFIG.presets) : request(new URL('./presets.json', import.meta.url).href)]);
    if (LAB_CONFIG && initialRevision === 0 && parameterRevision === initialRevision) {
      const initial = presetState(LAB_CONFIG.presets[0], state.performance);
      state.parameters = initial.parameters;
      if (performanceRevision === 0) state.performance = initial.performance;
      reply = await request('/api/performance', state.performance);
      if (JSON.stringify(reply.parameters) !== JSON.stringify(state.parameters)) reply = await request('/api/parameters', state.parameters);
    } if (disposed) return;
    if (parameterRevision === initialRevision && initialRevision === 0 && reply.parameters) state.parameters = sanitizeParameters(reply.parameters);
    if (performanceRevision === 0 && reply.performance) state.performance = sanitizePerformance(reply.performance);
    presets = bank;
    const initialScene = presets.find(p => presetStateKey(p.snapshot) === presetStateKey(captureScene(state.parameters, state.performance)));
    if (initialScene) lastScenePreset = initialScene.id;
    presetController = registerHeaderPresets({ id: INSTRUMENT_ID, presets,
      capture: () => captureScene(state.parameters, state.performance),
      apply: snapshot => applyScene(snapshot, presets.find(p => presetStateKey(p.snapshot) === presetStateKey(snapshot))?.id ?? 'custom'),
      randomize: (current, random) => { const next = randomState(current.parameters, state.performance, random);
        if (LAB_CONFIG) { const kind = LAB_CONFIG.kinds[Math.min(LAB_CONFIG.kinds.length - 1, Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * LAB_CONFIG.kinds.length))];
          const lab = randomLab(kind, random); next.parameters = sanitizeParameters({ ...next.parameters, lSystemType: 'pythagorean', generations: lab.iterations, lab }); }
        return captureScene(next.parameters, next.performance); },
      onApplied: () => { paintControls(); },
    });
    bootstrapped = true; previewParameters = { ...state.parameters }; geometry = null;
    acceptStatus(reply); paintControls(); placeInput(); void refreshNativePreview();
  } catch (error) { showError(`The Rust audio engine could not load. ${error.message}`); if (!disposed) setTimeout(bootstrap, 2000); }
}
async function poll() {
  if (disposed) return;
  if (!document.hidden && !pollWorking && bootstrapped) {
    pollWorking = true;
    // The browser engine publishes this reply through onStatus. Applying it a
    // second time repeats every control paint and rebases the same audio clock.
    try { await request('/api/status'); }
    catch (error) { if (!document.hidden) showError(error.message); }
    finally { pollWorking = false; }
  }
  if (!disposed) pollTimer = setTimeout(poll, state.audio ? 50 : 200);
}
function muteForDeparture() {
  cancelParameterGestures();
  audioRevision++; audioDesired = false; audioPending = false; state.audio = false;
  microphoneRevision++; microphoneDesired = false; microphonePending = false;
  inputRevision++;
  clearTimeout(parameterTimer); clearTimeout(performanceTimer); clearTimeout(depthTimer);
  parameterTimer = performanceTimer = depthTimer = null; parameterDirty = performanceDirty = depthDirty = false;
  browserEngine.muteForDeparture();
  paintControls(); scheduleDraw();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) muteForDeparture(); });
addEventListener('pagehide', event => {
  muteForDeparture();
  if (event.persisted) return;
  disposed = true; clearTimeout(pollTimer); cancelAnimationFrame(frameId); resizeObserver.disconnect(); mobile.removeEventListener('change', placeInput);
  gpuRenderer?.dispose(); browserEngine.dispose();
  midiManager.disable(); midiAdapter?.dispose(); unsubscribeMidiStatus(); unsubscribeMidiMessages(); clearTimeout(midiActivityTimer); midiStatus.destroy();
  foldTap.destroy(); for (const picker of inputChoices.values()) picker.destroy(); inputStrip.destroy(); audioStrip.destroy(); presetController?.destroy();
  for (const knob of parameterKnobs.values()) knob.destroy(); parameterKnobs.clear();
});
paintControls(); scheduleDraw(); void bootstrap(); void poll();
