import { STRIPED_STAIRCASE_DEFAULTS, STRIPED_STAIRCASE_VIEWS, advancePingPong,
  cameraFromView, createStaircaseFrame, formatComplexCoordinate,
  normalizeStaircaseSettings, panCamera, viewById, zoomCameraAt } from '../striped-staircase/striped-staircase.js';
import { StaircaseEngine } from './engine.js';
import { createRustStaircaseRenderer } from './renderer.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { readStaircaseRhythm } from './field.js';
import { buildStaircaseContourPaths } from './contour-paths.js';
import { SPIRAL_DEFAULTS, SPIRAL_RANGES, SPIRAL_STUDIES, formatSpiralControl,
  normalizeSpiralStudies, selectedSpiralStudy, spiralStudyPatch } from './spiral-studies.js';

const $ = id => document.getElementById(id);
const descriptions = [
  ['Contour', 'The measured outline becomes a repeating stereo wave. Detail brings out its sharper bends.'],
  ['Harmonics', 'The band’s vertical distribution weights sixteen harmonics. Hold depth to hear the same shape as a sustained spectrum.'],
  ['Stripe rhythm', 'White holds the traced voices; black releases them. Voices stay centered. Hold freezes the chord or rest.'],
  ['Resonant body', 'Contour length and bends tune and excite a bank of resonances. Body lengthens their response.'],
];
const pitchDescriptions = [
  'Height sets pitch across the selected span. Higher traced positions sound higher.',
  'X and Y set pitch from the frame center. Moving right or up raises it.',
  'Each voice remembers its previous note. Turns change pitch; offshoots inherit their parent’s history. Dashed lines show the previous-note reference.',
];
const defaults = { progress: .175, direction: 1, speed: .035, baseFrequency: 73, brightness: .55, body: .35,
  level: .75, mode: 2, palette: 3, hold: false, view: 'seahorse', pitchSource: 1, pitchMapping: 1, pitchSpan: 3, voiceLimit: 256,
  showPaths: true, showStripes: true, stripeGate: true, focusedTendril: null, ...SPIRAL_DEFAULTS };
const state = { ...defaults, audio: false, playing: false, camera: cameraFromView(viewById('seahorse')),
  settings: normalizeStaircaseSettings(STRIPED_STAIRCASE_DEFAULTS), clock: 0, revision: 0, acceptedRevision: 0,
  audioRevision: 0, ready: false, disposed: false, rhythm: null, audioBranches: 0, audioWhite: false, audioVoices: new Float64Array(0) };
const signalOwner = new AbortController();
const on = (target, name, fn, options = {}) => target.addEventListener(name, fn, { ...options, signal: signalOwner.signal });
const canvas = $('stage'), overlay = $('contourOverlay'), overlayContext = overlay.getContext('2d');
let renderer, worker, field, contourPaths, context, engine, starting = false, audioEpoch = 0, renderFrame = 0, previousTime = 0;
let focusOptionsKey = '';
let nextVisualTime = 0, visualInterval = 1000 / 30;
let rebuildTimer = 0, pendingJob = null, workerBusy = false, observer, aspect = 1;
const status = text => { $('liveStatus').textContent = text; };
const keys = ['progress', 'speed', 'baseFrequency', 'brightness', 'body', 'level', 'pitchSpan', 'voiceLimit', ...Object.keys(SPIRAL_RANGES)];
const structureKeys = ['startIteration', 'maxIterations', 'steps', 'stripePeriod'];
const rangeKnobs = new Map();
let progressGesture = null;
for (const input of document.querySelectorAll('.studies-panel input[type="range"]')) {
  rangeKnobs.set(input.id, enhanceRangeKnob(input));
  // Navigation may have mounted Tap before the instrument module ran.
  input.closest('.mz-tap-tempo-field')?.classList.add('mz-tap-tempo-field--knob');
}
on($('progress'), 'pointerdown', event => {
  if (event.button === 0 && event.isPrimary !== false) progressGesture = event.pointerId;
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on($('progress'), name, event => {
  if (event.pointerId === progressGesture) progressGesture = null;
});

function updateControls() {
  $('voiceLimit').min = state.pitchSource === 1 ? 2 : 1;
  $('voiceLimit').step = state.pitchSource === 1 ? 2 : 1;
  for (const key of keys) {
    $(key).value = state[key];
    $(key + 'Out').textContent = key in SPIRAL_RANGES ? formatSpiralControl(key, state[key]) : key === 'progress' ? state[key].toFixed(3)
      : key === 'speed' ? `${(1 / state.speed).toFixed(1)} s / journey`
      : key === 'pitchSpan' ? `${state.pitchSpan.toFixed(1)} oct`
      : key === 'voiceLimit' ? String(state.voiceLimit)
      : key === 'baseFrequency' ? `${Math.round(state[key])} Hz` : `${Math.round(state[key] * 100)}%`;
  }
  for (const key of structureKeys) { $(key).value = state.settings[key]; $(key + 'Out').textContent = Number(state.settings[key].toFixed(1)); }
  $('holdButton').setAttribute('aria-pressed', String(state.hold));
  $('playButton').setAttribute('aria-pressed', String(state.playing));
  $('playButton').setAttribute('aria-label', state.playing ? 'Pause depth motion' : 'Play depth motion');
  $('audioButton').setAttribute('aria-pressed', String(state.audio));
  $('audioButton').setAttribute('aria-busy', String(starting));
  $('audioState').textContent = starting ? 'starting' : state.audio ? 'on' : 'off';
  $('viewPreset').value = state.view; $('palette').value = state.palette;
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(Number(button.dataset.mode) === state.mode));
  $('modeHeading').textContent = descriptions[state.mode][0];
  $('modeDescription').textContent = state.mode === 2 && !state.stripeGate
    ? 'Voices follow the contours continuously. Stripe rests are off. Hold freezes the pitch contours.' : descriptions[state.mode][1];
  $('canvasInstructions').textContent = `Drag to roam · wheel or pinch to dive. ${state.stripeGate ? 'White = notes · black = rest.' : 'Continuous contour voices · stripe gate off.'} Hold a depth to hear its paths.`;
  $('body').disabled = state.mode < 2;
  document.querySelector('label[for="body"] b').textContent = state.mode === 2 ? 'Release' : 'Body';
  $('rhythmReadout').hidden = state.mode !== 2;
  $('tendrilReadout').hidden = state.mode !== 2;
  $('pitchControls').hidden = state.mode !== 2;
  $('spiralControls').hidden = state.mode !== 2;
  state.spiralStudy = selectedSpiralStudy(state);
  $('spiralStudy').value = state.spiralStudy;
  $('endlessDirection').value = String(state.endlessDirection);
  $('spiralDescription').textContent = SPIRAL_STUDIES.find(study => study.id === state.spiralStudy)?.description
    ?? 'Your blend of contour mappings. Turn an amount to Off to remove that idea; the descent keeps its place.';
  for (const button of document.querySelectorAll('[data-study]')) button.dataset.active = String(button.dataset.study === state.spiralStudy);
  $('pitchSource').value = state.pitchSource;
  $('pitchPathDescription').textContent = state.pitchSource === 1
    ? 'The two marked edges of each moving block drive its voices. Circle and diamond keep their sides around bends.'
    : 'Each traced branch’s center drives one voice.';
  $('pitchMapping').value = state.pitchMapping;
  $('pitchDescription').textContent = pitchDescriptions[state.pitchMapping];
  const referenceShare = Math.round(100 * (1 - Math.max(state.turnAmount, state.forkAmount)));
  $('pitchContribution').textContent = `Base reference ${referenceShare}% · contour turning ${Math.round(state.turnAmount * 100)}% · branching ${Math.round(state.forkAmount * 100)}%. Unmeasured paths use the base reference.`;
  $('pitchMapping').setAttribute('aria-describedby', 'pitchDescription pitchContribution');
  for (const key of ['showPaths', 'showStripes', 'stripeGate']) $(key).checked = state[key];
  $('pathControls').hidden = state.mode !== 2;
  $('stageLegend').hidden = state.mode !== 2 || !state.showPaths;
  $('stageLegend').textContent = state.pitchSource === 1
    ? 'Color = tendril · ● / ◆ = its two voices · tap a marker to isolate'
    : 'Color = path · ● = its voice · tap a marker to isolate';
  $('pathLegend').textContent = `${state.pitchSource === 1 ? 'Color identifies a tendril. ● and ◆ follow its two edge voices; the diamond trail is dashed.' : 'Color identifies a path. ● follows its single center voice.'} Faint trails show the route through depth; bright outlines show the current contour. Filled markers = gate open; outlines = rest. Tap a marker to hear that path.`;
  $('allTendrils').disabled = state.focusedTendril === null;
  $('tendrilFocus').disabled = state.acceptedRevision !== state.revision;
  for (const knob of rangeKnobs.values()) knob.update();
}
function sendControls() { engine?.controls(state); }
function transport() { engine?.transport(state); updateControls(); }
function seek(value, direction = state.direction) {
  state.progress = Math.max(0, Math.min(1, value)); state.direction = direction;
  engine?.seek(state.progress, direction); updateControls();
}
function drainWorker() {
  if (workerBusy || !pendingJob || state.disposed) return;
  workerBusy = true; worker.postMessage(pendingJob); pendingJob = null;
}
function queueField(delay = 65) {
  if (state.disposed) return;
  if (state.focusedTendril !== null) { state.focusedTendril = null; sendControls(); updateControls(); }
  clearTimeout(rebuildTimer); state.revision++;
  $('tendrilFocus').disabled = true;
  status('Preparing this view…');
  rebuildTimer = setTimeout(() => {
    pendingJob = { type: 'analyze', revision: state.revision, camera: { ...state.camera }, settings: { ...state.settings }, aspect, resolution: 112, voiceLimit: state.voiceLimit, pitchSource: state.pitchSource };
    drainWorker();
    renderer?.renderField(state.camera, state.settings.maxIterations);
  }, delay);
}
function initWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    workerBusy = false;
    if (state.disposed) return;
    if (data.revision === state.revision) {
      if (data.type === 'error' || data.error) status(`Field preparation failed: ${data.error || data.message}`);
      else if (data.type === 'field') {
        field = data; contourPaths = buildStaircaseContourPaths(data); focusOptionsKey = '';
        state.ready = true; state.acceptedRevision = data.revision;
        engine?.field(data.table, data.frames, data.revision, data.features, data.featureFrames);
        updateControls();
        status('Ready · Audio, then Play. Hold freezes the current depth.');
      }
    }
    drainWorker();
  };
  worker.onerror = event => {
    worker.terminate(); workerBusy = false; pendingJob = null;
    status(`Field preparation failed: ${event.message}. Move or reset the view to retry.`);
    if (!state.disposed) initWorker();
  };
}
async function closeAudio() {
  const old = context; engine?.dispose(); engine = null; context = null;
  if (old && old.state !== 'closed') await old.close().catch(() => {});
}
function audioFailure(error) {
  state.audio = false; starting = false; audioEpoch++; status(error.message); updateControls(); void closeAudio();
}
async function toggleAudio() {
  if (state.disposed || starting) return;
  if (state.audio) { state.audio = false; transport(); return; }
  if (engine) {
    try { await context.resume(); state.audio = true; transport(); }
    catch (error) { audioFailure(error); }
    return;
  }
  const epoch = ++audioEpoch; starting = true; updateControls();
  try {
    // Creation/resume belongs to the direct, explicit Audio gesture.
    context = new AudioContext(); const currentContext = context;
    const resumed = currentContext.resume(); resumed.catch(() => {});
    const created = await StaircaseEngine.create(currentContext, {
      onState(data) {
        if (state.disposed || epoch !== audioEpoch) return;
        state.progress = data.depth; state.direction = data.direction; state.clock = data.clock; state.audioRevision = data.revision;
        state.audioBranches = data.branches; state.audioWhite = data.white;
        state.audioVoices = data.voices;
      }, onError: error => { if (epoch === audioEpoch && !state.disposed) audioFailure(error); },
    });
    await resumed;
    if (state.disposed || epoch !== audioEpoch) { created.dispose(); return; }
    engine = created; engine.controls(state); engine.seek(state.progress, state.direction);
    if (field) engine.field(field.table, field.frames, field.revision, field.features, field.featureFrames);
    starting = false; state.audio = true; transport();
  } catch (error) { if (epoch === audioEpoch) audioFailure(error); }
}
function resize() {
  if (state.disposed) return;
  const rect = canvas.getBoundingClientRect(), ratio = Math.min(1.5, devicePixelRatio || 1, Math.sqrt(1_200_000 / Math.max(1, rect.width * rect.height)));
  const nextAspect = rect.width / Math.max(1, rect.height);
  renderer?.resize(Math.round(rect.width * ratio), Math.round(rect.height * ratio));
  overlay.width = canvas.width; overlay.height = canvas.height;
  if (Math.abs(aspect - nextAspect) > .01) { aspect = nextAspect; queueField(); }
}
const tendrilOf = branch => field?.pitchSource === 1 ? branch.tendrilId : branch.id;
const voiceColor = branch => `hsl(${(tendrilOf(branch) * 137.5 + 115) % 360} 85% ${branch.side === 1 ? 88 : 70}%)`;
function focusTendril(value) {
  if (value !== 'all' && value !== null && state.acceptedRevision !== state.revision) return;
  const id = Number(value);
  state.focusedTendril = value === 'all' || value === null || !Number.isInteger(id) || id < 1 ? null : id;
  focusOptionsKey = ''; updateControls(); sendControls();
}
function updatePathDisplay(rhythm) {
  const ids = [...new Set(rhythm.branches.filter(branch => branch.presence > .5).map(tendrilOf))].sort((a, b) => a - b);
  const paired = field.pitchSource === 1, selected = state.focusedTendril;
  const key = `${paired}:${ids.join(',')}:${selected}`;
  if (key !== focusOptionsKey) {
    const select = $('tendrilFocus'), choices = selected !== null && !ids.includes(selected) ? [...ids, selected] : ids;
    select.replaceChildren(new Option('All mapped tendrils', 'all'), ...choices.map(id =>
      new Option(`${paired ? 'Tendril' : 'Path'} ${id}${ids.includes(id) ? '' : ' · outside this depth'}`, String(id))));
    select.value = selected === null ? 'all' : String(selected); focusOptionsKey = key;
  }
  const heard = rhythm.branches.filter(branch => branch.presence > .5 && (selected === null || tendrilOf(branch) === selected));
  const gate = !state.stripeGate ? 'continuous · stripe gate off' : rhythm.white ? 'white · gate open' : 'black · rest';
  $('focusReadout').textContent = selected === null
    ? `All mapped tendrils · ${gate}. Each voice follows its own pitch path.`
    : `${paired ? 'Tendril' : 'Path'} ${selected} · ${heard.length ? `${heard.length === 2 ? 'two' : heard.length} ${heard.length === 1 ? 'voice follows' : 'voices follow'} the highlighted ${heard.length === 1 ? 'path' : 'paths'} · ${gate}` : 'outside this depth · no mapped voice here'}.`;
  state.pathDisplay = { visible: state.showPaths, focusedTendril: selected,
    pathCount: state.showPaths ? heard.length : 0,
    markers: state.showPaths ? rhythm.branches.filter(branch => branch.presence > .5 && (selected === null || tendrilOf(branch) === selected)).map(branch =>
      ({ id: branch.id, voiceId: branch.id, tendrilId: tendrilOf(branch), side: branch.side,
        x: branch.cx, y: branch.cy, trail: Boolean(contourPaths?.byId.get(branch.id)?.runs.some(run => run.points.length > 2)), focused: selected !== null })) : [] };
}
function drawVoicePaths(rhythm) {
  if (!state.showPaths || !contourPaths) return;
  for (const branch of rhythm.branches) {
    if (branch.presence <= .5 || (state.focusedTendril !== null && tendrilOf(branch) !== state.focusedTendril)) continue;
    const path = contourPaths.byId.get(branch.id);
    if (!path) continue;
    overlayContext.save(); overlayContext.strokeStyle = voiceColor(branch);
    overlayContext.globalAlpha = state.focusedTendril === null ? .3 : .75;
    overlayContext.lineWidth = state.focusedTendril === null ? 1.3 : 2.5;
    if (branch.side === 1) overlayContext.setLineDash([5, 4]);
    for (const run of path.runs) {
      overlayContext.beginPath();
      for (let index = 0; index < run.points.length; index += 2) {
        const x = run.points[index] * overlay.width, y = run.points[index + 1] * overlay.height;
        if (index === 0) overlayContext.moveTo(x, y); else overlayContext.lineTo(x, y);
      }
      overlayContext.stroke();
    }
    overlayContext.restore();
  }
}
function render(now) {
  if (state.disposed) return;
  renderFrame = requestAnimationFrame(render);
  // Audio owns motion and onsets. Skip visual work when it is not due, and
  // shed display frames before competing with synthesis on a busy device.
  if (now < nextVisualTime) return;
  const visualStarted = performance.now();
  const delta = previousTime ? Math.min(.1, (now - previousTime) / 1000) : 0; previousTime = now;
  if (!engine && state.playing && !state.hold) Object.assign(state, advancePingPong(state.progress, state.direction, delta * state.speed));
  const rhythm = field?.revision === state.revision ? readStaircaseRhythm(field, state.progress) : null;
  const frame = { ...createStaircaseFrame(state.progress, state.settings, 'slide') };
  // The DSP interpolates prepared depths. The exact nonlinear staircase curve
  // can cross a stripe slightly earlier, so the visible sweep follows the same
  // prepared threshold as the sound instead of running a second depth clock.
  if (rhythm) { frame.renderLow = rhythm.bandLow; frame.renderHigh = rhythm.bandHigh; }
  renderer?.render({ ...frame, stepPhase: .5 }, state.settings, state.camera, state.direction, state.palette, { showStripes: state.showStripes });
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  state.rhythm = null;
  state.pathDisplay = { visible: state.showPaths, focusedTendril: state.focusedTendril, pathCount: 0, markers: [] };
  if (rhythm) {
    state.rhythm = { white: rhythm.white, count: rhythm.count, omitted: rhythm.omitted,
      pitchSource: rhythm.pitchSource, tendrils: rhythm.tendrils, unpaired: rhythm.unpaired,
      voices: rhythm.branches.map(({ slot, id, parentId, cx, cy, presence, tendrilId, side, boundary, anchor, feature }) =>
        ({ slot, id, parentId, cx, cy, presence, tendrilId, side, boundary, anchor, feature })) };
    const paired = field.pitchSource === 1;
    const gateOpen = !state.stripeGate || rhythm.white;
    if (state.mode === 2) { updatePathDisplay(rhythm); drawVoicePaths(rhythm); }
    // Count mapped paths at the audio-owned depth, including black rests.
    // The prepared field keeps edge pairs together and excludes omitted paths.
    const tendrilCount = String(rhythm.tendrils);
    if ($('tendrilCount').textContent !== tendrilCount) $('tendrilCount').textContent = tendrilCount;
    const voiceCount = `${rhythm.count} ${rhythm.count === 1 ? 'voice' : 'voices'}`;
    $('rhythmReadout').textContent = `${state.stripeGate ? rhythm.white ? 'White · on' : 'Black · rest' : 'Continuous · stripe gate off'} · ${voiceCount}${state.focusedTendril !== null ? ` · hearing tendril ${state.focusedTendril}` : ''}${rhythm.omitted ? ` · ${rhythm.omitted} ${paired ? 'tendrils omitted' : 'unvoiced'}` : ''}${paired && rhythm.unpaired ? ` · ${rhythm.unpaired} incomplete pairs` : ''}`;
    const traces = state.mode === 2 ? state.showPaths ? rhythm.branches.filter(branch => state.focusedTendril === null || tendrilOf(branch) === state.focusedTendril) : [] : [{ points: field.overlays[Math.round(state.progress * (field.frames - 1))]?.points }];
    for (const branch of traces) {
      const path = branch.points;
      if (!path?.length && state.mode !== 2) continue;
      overlayContext.strokeStyle = state.mode === 2 ? voiceColor(branch) : '#ddffe6';
      overlayContext.lineWidth = state.mode === 2 && gateOpen ? 2 : 1.3;
      overlayContext.globalAlpha = state.mode === 2 ? branch.presence * (gateOpen ? .9 : .4) : .85;
      overlayContext.beginPath();
      for (let i = 0; i < (path?.length ?? 0); i += 2) {
        const x = path[i] * overlay.width, y = path[i + 1] * overlay.height;
        if (i === 0) overlayContext.moveTo(x, y); else overlayContext.lineTo(x, y);
      }
      overlayContext.stroke();
      if (state.mode === 2) {
        const at = branch.slot * 6, voices = state.audioVoices;
        if (state.pitchMapping === 2 && Math.max(state.turnAmount, state.forkAmount) < 1 && state.audioRevision === field.revision && voices[at] === branch.id && voices[at + 4]) {
          const x = voices[at + 2] * overlay.width, y = voices[at + 3] * overlay.height;
          overlayContext.save(); overlayContext.globalAlpha *= .55; overlayContext.setLineDash([3, 4]);
          overlayContext.beginPath(); overlayContext.moveTo(x, y); overlayContext.lineTo(branch.cx * overlay.width, branch.cy * overlay.height); overlayContext.stroke();
          overlayContext.setLineDash([]); overlayContext.beginPath(); overlayContext.arc(x, y, 2, 0, Math.PI * 2); overlayContext.stroke(); overlayContext.restore();
        }
        const x = branch.cx * overlay.width, y = branch.cy * overlay.height;
        const feature = branch.feature;
        const accent = feature?.confidence > 0 ? state.accentAmount * .5 * (1 + Math.cos(2 * Math.PI * feature.travelTurns * state.accentRate)) : 0;
        const size = gateOpen ? 5 + accent * 2.5 : 4;
        overlayContext.beginPath();
        if (paired && branch.side === 1) {
          overlayContext.moveTo(x, y - size - 1); overlayContext.lineTo(x + size + 1, y);
          overlayContext.lineTo(x, y + size + 1); overlayContext.lineTo(x - size - 1, y); overlayContext.closePath();
        } else overlayContext.arc(x, y, size, 0, Math.PI * 2);
        overlayContext.fillStyle = feature?.confidence > 0 && state.curvatureAmount > 0
          ? `hsl(${(tendrilOf(branch) * 137.5 + 115) % 360} 85% ${Math.min(96, 70 + 26 * state.curvatureAmount * Math.min(1, feature.curvature * state.curvatureDrive))}%)`
          : overlayContext.strokeStyle;
        if (gateOpen) overlayContext.fill(); else overlayContext.stroke();
        if (state.focusedTendril !== null || rhythm.tendrils <= 8) {
          const label = `${tendrilOf(branch)}${paired ? branch.side === 1 ? ' ◆' : ' ●' : ''}`;
          overlayContext.save(); overlayContext.globalAlpha = 1; overlayContext.font = '12px monospace';
          const labelX = Math.min(overlay.width - overlayContext.measureText(label).width - 5, Math.max(5, x + 9));
          const labelY = Math.max(14, Math.min(overlay.height - 8, y + (branch.side === 1 ? 16 : -9)));
          overlayContext.lineWidth = 4; overlayContext.strokeStyle = '#080c12'; overlayContext.strokeText(label, labelX, labelY);
          overlayContext.fillText(label, labelX, labelY); overlayContext.restore();
        }
      }
    }
  } else {
    $('tendrilCount').textContent = '—';
    $('rhythmReadout').textContent = 'Preparing branch traces…';
  }
  overlayContext.globalAlpha = 1;
  if (progressGesture === null) {
    $('progress').value = state.progress;
    rangeKnobs.get('progress').update();
  }
  $('progressOut').textContent = state.progress.toFixed(3);
  $('depthReadout').textContent = `Depth ${frame.renderLow.toFixed(1)}–${frame.renderHigh.toFixed(1)}`;
  $('coordinateReadout').textContent = formatComplexCoordinate(state.camera.centerX, state.camera.centerY);
  const cost = performance.now() - visualStarted;
  const targetInterval = Math.max(1000 / 30, Math.min(100, cost * 3));
  visualInterval = targetInterval > visualInterval ? targetInterval : Math.max(1000 / 30, visualInterval * .95);
  nextVisualTime = now + visualInterval;
  engine?.requestState();
}
function zoom(factor, point = { x: .5, y: .5 }) { state.camera = zoomCameraAt(state.camera, point, factor, aspect); queueField(); }
function resetView() { state.camera = cameraFromView(viewById(state.view)); queueField(); }
function reset() {
  for (const knob of rangeKnobs.values()) knob.cancelGesture();
  progressGesture = null;
  const level = state.level, audio = state.audio;
  Object.assign(state, defaults, { level, audio, playing: false, settings: normalizeStaircaseSettings(STRIPED_STAIRCASE_DEFAULTS) });
  seek(defaults.progress, 1); resetView(); sendControls(); transport();
}
for (const view of STRIPED_STAIRCASE_VIEWS) {
  if (view.id === 'seahorse') continue;
  const option = document.createElement('option'); option.value = view.id; option.textContent = view.label; $('viewPreset').append(option);
}
on($('audioButton'), 'click', () => void toggleAudio());
on($('playButton'), 'click', () => { state.playing = !state.playing; transport(); });
on($('holdButton'), 'click', () => { state.hold = !state.hold; transport(); });
on($('resetAll'), 'click', reset);
on($('tendrilFocus'), 'change', () => focusTendril($('tendrilFocus').value));
on($('allTendrils'), 'click', () => focusTendril(null));
for (const key of ['showPaths', 'showStripes', 'stripeGate']) on($(key), 'change', () => {
  state[key] = $(key).checked;
  if (key === 'stripeGate') sendControls();
  updateControls();
});
for (const key of keys) on($(key), 'input', () => {
  const value = Number($(key).value); if (!Number.isFinite(value)) return;
  if (key === 'progress') seek(value); else {
    state[key] = value;
    if (key in SPIRAL_RANGES) Object.assign(state, normalizeSpiralStudies(state));
    updateControls(); sendControls();
    if (key === 'voiceLimit') queueField();
  }
});
function chooseSpiralStudy(id) {
  const patch = spiralStudyPatch(id);
  if (!patch) return;
  for (const knob of rangeKnobs.values()) knob.cancelGesture();
  Object.assign(state, patch, { mode: 2 });
  updateControls(); sendControls();
}
on($('spiralStudy'), 'change', () => chooseSpiralStudy($('spiralStudy').value));
for (const button of document.querySelectorAll('[data-study]')) on(button, 'click', () => chooseSpiralStudy(button.dataset.study));
on($('branchingPassage'), 'click', () => {
  state.view = 'spiral'; state.pitchSource = 1; state.voiceLimit = 32;
  state.settings = normalizeStaircaseSettings(STRIPED_STAIRCASE_DEFAULTS);
  chooseSpiralStudy('forks'); seek(51 / 63, 1); resetView();
});
on($('endlessDirection'), 'change', () => {
  state.endlessDirection = Number($('endlessDirection').value) === 1 ? 1 : -1;
  updateControls(); sendControls();
});
on($('pitchMapping'), 'change', () => { state.pitchMapping = Number($('pitchMapping').value); sendControls(); updateControls(); });
on($('pitchSource'), 'change', () => {
  state.pitchSource = Number($('pitchSource').value);
  if (state.pitchSource === 1) state.voiceLimit = Math.max(2, Math.floor(state.voiceLimit / 2) * 2);
  updateControls(); queueField();
});
for (const key of structureKeys) on($(key), 'input', () => {
  state.settings = normalizeStaircaseSettings({ ...state.settings, [key]: Number($(key).value) }); updateControls(); queueField();
});
for (const button of document.querySelectorAll('[data-mode]')) on(button, 'click', () => {
  state.mode = Number(button.dataset.mode); sendControls(); updateControls();
});
on($('viewPreset'), 'change', () => { state.view = $('viewPreset').value; resetView(); });
on($('palette'), 'change', () => { state.palette = Number($('palette').value); });
on($('zoomIn'), 'click', () => zoom(.7)); on($('zoomOut'), 'click', () => zoom(1 / .7)); on($('homeView'), 'click', resetView);
const pointAt = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; };
on(canvas, 'wheel', event => { event.preventDefault(); zoom(Math.exp(Math.max(-.5, Math.min(.5, event.deltaY * .002))), pointAt(event)); }, { passive: false });
on(canvas, 'dblclick', event => zoom(.5, pointAt(event)));
const pointers = new Map(); let gesture = null, markerTap = null;
const gestureState = () => {
  const points = [...pointers.values()];
  if (points.length > 1) return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2,
    distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) };
  return points.length ? { ...points[0], distance: 0 } : null;
};
on(canvas, 'pointerdown', event => {
  if (event.button !== 0) return; canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); gesture = gestureState();
  markerTap = pointers.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
});
on(canvas, 'pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); const next = gestureState();
  if (markerTap && Math.hypot(event.clientX - markerTap.x, event.clientY - markerTap.y) <= 6) return;
  markerTap = null;
  if (gesture) {
    state.camera = panCamera(state.camera, next.x - gesture.x, next.y - gesture.y, canvas.clientHeight);
    if (gesture.distance > 0 && next.distance > 0) {
      const rect = canvas.getBoundingClientRect(); state.camera = zoomCameraAt(state.camera,
        { x: (next.x - rect.left) / rect.width, y: (next.y - rect.top) / rect.height }, gesture.distance / next.distance, aspect);
    }
    queueField();
  }
  gesture = next;
});
on(canvas, 'pointerup', event => {
  if (markerTap?.id !== event.pointerId || state.mode !== 2 || !state.showPaths) return;
  markerTap = null;
  const rect = canvas.getBoundingClientRect();
  let nearest = null, distance = 22;
  for (const marker of state.pathDisplay?.markers ?? []) {
    const next = Math.hypot(rect.left + marker.x * rect.width - event.clientX, rect.top + marker.y * rect.height - event.clientY);
    if (next < distance) { distance = next; nearest = marker; }
  }
  if (nearest) focusTendril(nearest.tendrilId);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on(canvas, name, event => {
  if (markerTap?.id === event.pointerId) markerTap = null;
  pointers.delete(event.pointerId); gesture = gestureState();
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});
on(canvas, 'keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '+' || event.key === '=') zoom(.8);
  else if (event.key === '-') zoom(1.25);
  else if (event.key === 'Home') resetView();
  else if (event.key.startsWith('Arrow')) {
    const d = 28; state.camera = panCamera(state.camera,
      event.key === 'ArrowRight' ? -d : event.key === 'ArrowLeft' ? d : 0,
      event.key === 'ArrowDown' ? -d : event.key === 'ArrowUp' ? d : 0, canvas.clientHeight); queueField();
  } else return;
  event.preventDefault(); event.stopPropagation();
});
on(canvas, 'webglcontextlost', event => { event.preventDefault(); renderer = null; status('Graphics paused. Sound continues; restore the view when WebGL returns.'); });
on(canvas, 'webglcontextrestored', () => { try { renderer = createRustStaircaseRenderer(canvas); resize(); queueField(); } catch (error) { status(error.message); } });
function teardown() {
  if (state.disposed) return;
  state.disposed = true; state.audio = false; state.playing = false; audioEpoch++;
  cancelAnimationFrame(renderFrame); clearTimeout(rebuildTimer); observer?.disconnect(); worker?.terminate(); renderer?.destroy();
  for (const knob of rangeKnobs.values()) knob.destroy();
  rangeKnobs.clear(); progressGesture = null;
  signalOwner.abort(); pointers.clear(); void closeAudio();
}
on(window, 'pagehide', teardown);
window.addEventListener('pageshow', event => { if (event.persisted && state.disposed) location.reload(); });
globalThis.__staircaseStudies = { snapshot: () => ({ ...state, camera: { ...state.camera }, settings: { ...state.settings } }), teardown };
try { renderer = createRustStaircaseRenderer(canvas); } catch (error) { $('renderError').hidden = false; $('renderError').textContent = error.message; }
initWorker(); observer = new ResizeObserver(resize); observer.observe(canvas); resize(); queueField(0); updateControls(); renderFrame = requestAnimationFrame(render);
