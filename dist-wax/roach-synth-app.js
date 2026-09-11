import { createRoachViewer } from './src/roach-synth-viewer.js?v=365ba8cf3adb';
import { ROACH_MOTION_PRESETS, ROACH_MOTION_DEFAULTS, normalizeRoachMotion, activeRoachPreset,
  writeRoachPose, createRoachSceneState, writeRoachSceneState, bakeRoachPresetTracks,
  createRandomRoachMotion, ROACH_STATIC_POSES, getRoachStaticPose, writeRoachBeatState } from './src/roach-synth-motion.js?v=365ba8cf3adb';
import { RoachSynthAudio, ROACH_SOUND_PRESETS, ROACH_BODY_GROUPS,
  ROACH_BODY_SOURCES, createDefaultRoachBodyMix, createRandomRoachSound, getRoachBodyGroupId,
  ROACH_MOTION_SOUND_PRESETS, getRoachMotionSound } from './src/roach-synth-audio.js?v=365ba8cf3adb';

const el = id => document.getElementById(id);
const listeners = new AbortController();
const options = { signal: listeners.signal };
const modelUrl = new URL('./assets/roach-synth/cockroach.glb', import.meta.url);
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  playing: false, soundPlaying: false, audioOn: false, audioStarting: false, disposed: false,
  modelLoading: true, notice: '', metronome: false,
  posePreset: 'neutral', poseSeed: 0, motionSeed: 0, soundSeed: 0, phraseRequest: 0,
  motionChoice: ROACH_MOTION_PRESETS[0].id, motionPrepared: false, antennae: true,
  motion: normalizeRoachMotion({ ...ROACH_MOTION_DEFAULTS, presetId: 'none', antennae: false }),
  sound: { ...ROACH_SOUND_PRESETS[0].sound }, bodyMix: structuredClone(ROACH_SOUND_PRESETS[0].bodyMix), muted: new Set(), solo: new Set(),
  joints: [], selectedGroup: '', view: 'side', side: 'left', time: 0, anchor: performance.now(), applyingPose: false,
};
let viewer, frame = 0, loadVersion = 0, lastFrame = -Infinity;
let pose = new Float32Array(0);
const sceneState = createRoachSceneState();
const beatState = {};
const status = (id, message = '') => { el(id).textContent = message; el(id).hidden = !message; };
function syncStageStatus() {
  status('liveStatus', state.notice || (state.modelLoading ? 'Loading the roach… Sound and voice are available.' : ''));
}
const announce = message => { state.notice = message; syncStageStatus(); };
const audio = new RoachSynthAudio({
  onStatus(message) {
    if (state.disposed) return;
    // Only actionable messages occupy the compact controls.
    if (!['Roach sound ready.', 'Audio off.', 'Starting roach sound…'].includes(message)) status('voiceStatus', String(message));
    if (state.audioOn && !audio.getState().enabled) {
      anchorTime(audio.getTime()); state.audioOn = false; syncAudioButton(); syncTransport();
    }
  },
  onTelemetry({ peak }) {
    if (state.disposed) return;
    const db = state.audioOn && peak > .000001 ? 20 * Math.log10(peak) : -Infinity;
    el('mixMeter').value = Math.max(-60, db);
    el('mixPeak').value = Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : '−∞ dBFS';
  },
  onSamples({ status: sampleState }) {
    if (!state.disposed) status('sampleStatus', sampleState === 'unavailable' ? 'Roach rustle unavailable; synthesized sounds remain playable.' : '');
  },
});
function fallbackTime() { return state.time + (state.playing ? (performance.now() - state.anchor) / 1000 : 0); }
function currentTime() { return state.audioOn ? audio.getTime() : fallbackTime(); }
function anchorTime(time) { state.time = Math.max(0, Number(time) || 0); state.anchor = performance.now(); }
function effectiveBodyMix() {
  return state.bodyMix.map(row => ({ ...row, level: state.muted.has(row.groupId) || (state.solo.size && !state.solo.has(row.groupId)) ? 0 : row.level }));
}
function publish(extra = {}) {
  audio.update({ playing: state.playing, soundPlaying: state.soundPlaying, motion: state.motion,
    joints: state.joints, mappings: [], sound: state.sound, bodyMix: effectiveBodyMix(), metronome: state.metronome, ...extra });
}
function publishSound() { audio.update({ sound: state.sound, bodyMix: effectiveBodyMix() }); }
function refreshJoints() {
  if (!viewer) return;
  state.joints = viewer.getState().bones;
  if (pose.length !== state.joints.length * 3) pose = new Float32Array(state.joints.length * 3);
}
function syncAudioButton() {
  el('audioButton').setAttribute('aria-pressed', String(state.audioOn));
  el('audioState').textContent = state.audioStarting ? 'starting' : state.audioOn ? 'on' : 'off';
  const button = el('stageAudioButton');
  button.disabled = state.audioStarting;
  button.setAttribute('aria-pressed', String(state.audioOn));
  button.setAttribute('aria-label', state.audioStarting ? 'Starting Audio' : state.audioOn ? 'Turn Audio off' : 'Turn Audio on');
  button.textContent = state.audioStarting ? 'Starting…' : state.audioOn ? 'Audio on' : 'Audio off';
}
function syncTransport() {
  for (const [id, active, noun] of [['soundPlayButton', state.soundPlaying, 'sound'], ['motionButton', state.playing, 'animation']]) {
    el(id).setAttribute('aria-pressed', String(active));
    el(id).setAttribute('aria-label', `${active ? 'Pause' : 'Play'} ${noun}`);
  }
  if (!state.audioOn && (state.playing || state.soundPlaying)) announce('Audio is off — turn it on to hear playback');
  else announce('');
}
function syncSelectedPart() {
  if (!viewer) return;
  const rig = viewer.getState();
  const part = rig.bones.find(joint => joint.id === rig.selectedBone);
  state.selectedGroup = part ? getRoachBodyGroupId(part) : '';
  for (const button of document.querySelectorAll('.roach-body-name')) button.setAttribute('aria-pressed', String(button.dataset.group === state.selectedGroup));
}
function syncRig() {
  if (!viewer) return;
  const rig = viewer.getState(); refreshJoints();
  el('specimenImage').hidden = rig.loaded;
  el('roachCanvas').style.visibility = rig.loaded ? 'visible' : 'hidden';
  for (const id of ['motionButton', 'posePreset', 'randomPose', 'resetPose', 'resetCamera', 'randomMotion', 'motionPreset', 'previousMotion', 'nextMotion', 'zoomIn', 'zoomOut']) el(id).disabled = !rig.loaded;
  el('showJoints').disabled = !rig.bones.length;
  syncSelectedPart();
}
function updateGaze() {
  const preset = activeRoachPreset(currentTime(), state.motion);
  state.motion.gaze = viewer && (state.view === 'face' || preset.lookAtViewer) ? viewer.getGazeOffset() : { x: 0, y: 0, z: 0 };
}
function refreshGaze() { updateGaze(); audio.update({ motion: state.motion }); updateVisual(); }
function selectView(view) {
  state.view = ['side', 'top', 'bottom', 'face'].includes(view) ? view : 'side';
  viewer?.setViewPreset(state.view, { side: state.side });
  for (const button of el('viewPresets').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  el('sideToggle').hidden = state.view !== 'side'; refreshGaze();
}
function updateVisual() {
  writeRoachBeatState(currentTime(), state.motion, beatState);
  const beat = state.playing ? beatState.beatInBar : -1;
  for (const [index, dot] of [...el('beatIndicator').children].entries()) dot.classList.toggle('is-active', index === beat);
  el('beatIndicator').setAttribute('aria-label', beat < 0 ? 'Beat stopped' : `Beat ${beat + 1} of 4`);
  if (state.disposed || !viewer || !state.joints.length) return;
  const time = currentTime();
  writeRoachPose(time, state.motion, state.joints, pose);
  writeRoachSceneState(time, state.motion, sceneState, state.joints);
  viewer.setExternalPose(pose); viewer.setSceneState(sceneState);
}
function tick(now) {
  frame = 0;
  if (state.disposed || document.hidden) return;
  if (now - lastFrame >= 50) { lastFrame = now; updateVisual(); }
  if (state.playing) scheduleFrame();
}
function scheduleFrame() { if (!frame && !state.disposed && !document.hidden) frame = requestAnimationFrame(tick); }
function populateMotionPresets() {
  el('motionPreset').replaceChildren(...ROACH_MOTION_PRESETS.map(item => new Option(item.label, item.id)));
  if (state.motionChoice === 'random') el('motionPreset').add(new Option('Random motion', 'random'));
  el('motionPreset').value = state.motionChoice;
  el('motionPreset').title = state.motion.randomLabel ?? '';
}
function setMotionPreset(id, { applySound = true } = {}) {
  if (!state.joints.length) return;
  const time = currentTime();
  const controls = { tempo: state.motion.tempo, intensity: state.motion.intensity, antennae: state.antennae };
  state.applyingPose = true;
  try { viewer.setExternalPose(null); viewer.resetPose(); refreshJoints(); }
  finally { state.applyingPose = false; }
  state.motionChoice = id === 'random' ? id : ROACH_MOTION_PRESETS.find(item => item.id === id)?.id ?? ROACH_MOTION_PRESETS[0].id;
  state.motion = state.motionChoice === 'random'
    ? createRandomRoachMotion(++state.motionSeed * 2654435761 >>> 0, state.joints, controls)
    : bakeRoachPresetTracks(state.motionChoice, state.joints, controls);
  state.motionPrepared = true; state.posePreset = 'custom'; el('posePreset').value = 'custom';
  if (applySound) {
    const patch = state.motionChoice === 'random' ? createRandomRoachSound(state.motionSeed * 2654435761 >>> 0) : getRoachMotionSound(state.motionChoice);
    state.sound = { ...patch.sound, level: state.sound.level, voice: state.sound.voice };
    state.bodyMix = structuredClone(patch.bodyMix);
    if (state.motionChoice === 'random') markSoundCustom();
    else el('soundPreset').value = `motion:${state.motionChoice}`;
    syncSound();
  }
  updateGaze(); populateMotionPresets(); anchorTime(time); publish({ time, resetActivity: true }); updateVisual();
}
function setPlaying(playing) {
  if (!state.joints.length) return;
  if (playing && !state.motionPrepared) setMotionPreset(state.motionChoice, { applySound: false });
  const time = currentTime(); state.playing = playing === true; anchorTime(time);
  publish({ time }); syncTransport(); updateVisual();
  if (state.playing) scheduleFrame();
  else if (frame) { cancelAnimationFrame(frame); frame = 0; }
}
function applyStaticPose(id) {
  if (!state.joints.length) return;
  setPlaying(false); state.applyingPose = true;
  let shape;
  try {
    viewer.setExternalPose(null); viewer.resetPose(); refreshJoints();
    shape = getRoachStaticPose(id, state.joints, { seed: ++state.poseSeed * 2654435761 >>> 0 });
    for (const offset of shape.offsets) viewer.setBoneOffset(offset.jointId, offset);
    refreshJoints();
  } finally { state.applyingPose = false; }
  state.motion = normalizeRoachMotion({ ...ROACH_MOTION_DEFAULTS, tempo: state.motion.tempo,
    intensity: state.motion.intensity, presetId: 'none', antennae: false, staticScene: shape.scene });
  state.motionPrepared = false; state.posePreset = id; el('posePreset').value = id;
  anchorTime(0); publish({ time: 0, resetActivity: true }); updateVisual(); syncTransport();
}
function syncManualPose() {
  if (state.applyingPose || state.disposed) return;
  state.posePreset = 'custom'; el('posePreset').value = 'custom'; refreshJoints();
  // This is a continuous gesture, unlike loading a pose: retain velocity and friction.
  audio.update({ joints: state.joints }); updateVisual(); syncSelectedPart();
}
function paintKnob(input) {
  const value = Number(input.value), fraction = (value - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.closest('.roach-knob')?.style.setProperty('--knob-angle', `${-135 + 270 * fraction}deg`);
  const text = ['pitch', 'wingRate'].includes(input.id) ? `${Math.round(value)}`
    : input.id === 'rhythm' ? `${value.toFixed(2)}×`
      : input.id === 'pan' ? value === 0 ? 'C' : `${Math.round(Math.abs(value) * 100)}${value < 0 ? 'L' : 'R'}`
        : `${Math.round(value * 100)}%`;
  el(`${input.id}Out`).textContent = text;
  input.setAttribute('aria-valuetext', ['pitch', 'wingRate'].includes(input.id) ? `${text} Hz` : text);
}
function syncMixer() {
  for (const row of state.bodyMix) {
    const container = document.querySelector(`.roach-body-row[data-group="${row.groupId}"]`);
    container.querySelector('select').value = row.source;
    const input = container.querySelector('input'); input.value = row.level; paintKnob(input);
    container.querySelector('[data-mute]').setAttribute('aria-pressed', String(state.muted.has(row.groupId)));
    container.querySelector('[data-solo]').setAttribute('aria-pressed', String(state.solo.has(row.groupId)));
    container.classList.toggle('is-silent', state.muted.has(row.groupId) || Boolean(state.solo.size && !state.solo.has(row.groupId)));
  }
}
function syncSound() {
  for (const input of document.querySelectorAll('[data-sound]')) { input.value = state.sound[input.dataset.sound]; paintKnob(input); }
  el('level').value = state.sound.level; el('levelOut').value = `${Math.round(state.sound.level * 100)}%`; syncMixer();
}
function markSoundCustom() {
  if (!el('soundPreset').querySelector('[value="custom"]')) el('soundPreset').add(new Option('Custom sound', 'custom'));
  el('soundPreset').value = 'custom';
}
function selectedSoundPreset() {
  const id = el('soundPreset').value;
  return id.startsWith('motion:') ? getRoachMotionSound(id.slice(7)) : ROACH_SOUND_PRESETS.find(item => item.id === id);
}
function buildMixer() {
  for (const { id, label } of ROACH_BODY_GROUPS) {
    const row = document.createElement('div'); row.className = 'roach-body-row'; row.dataset.group = id;
    const name = document.createElement('button'); name.type = 'button'; name.className = 'roach-body-name'; name.dataset.group = id; name.textContent = label; name.setAttribute('aria-pressed', 'false');
    name.addEventListener('click', () => {
      const part = state.joints.find(joint => getRoachBodyGroupId(joint) === id && (id !== 'covers' || joint.wingLayer === 'cover'));
      if (part) viewer?.selectBone(part.id);
    }, options);
    const source = document.createElement('select'); source.id = `source-${id}`; source.dataset.bodySource = id; source.setAttribute('aria-label', `${label} sound`);
    for (const item of ROACH_BODY_SOURCES) source.add(new Option(item.label, item.id));
    source.addEventListener('change', () => { state.bodyMix.find(item => item.groupId === id).source = source.value; markSoundCustom(); publishSound(); }, options);
    const sourceShell = document.createElement('span'); sourceShell.className = 'select-shell'; sourceShell.append(source);
    const knob = document.createElement('label'); knob.className = 'roach-knob'; knob.htmlFor = `mix-${id}`;
    const face = document.createElement('span'); face.className = 'knob-face'; face.setAttribute('aria-hidden', 'true');
    const pointer = document.createElement('i'), output = document.createElement('small'); output.id = `mix-${id}Out`; face.append(pointer, output);
    const level = document.createElement('input'); Object.assign(level, { id: `mix-${id}`, type: 'range', min: '0', max: '1', step: '.01' }); level.dataset.bodyLevel = id; level.setAttribute('aria-label', `${label} level`);
    level.addEventListener('input', () => { state.bodyMix.find(item => item.groupId === id).level = Number(level.value); paintKnob(level); publishSound(); }, options);
    knob.append(face, level); row.append(name, sourceShell, knob);
    for (const [attribute, copy] of [['mute', 'M'], ['solo', 'S']]) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset[attribute] = id; button.textContent = copy;
      button.setAttribute('aria-label', `${attribute === 'mute' ? 'Mute' : 'Solo'} ${label}`); button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => { const set = attribute === 'mute' ? state.muted : state.solo; if (set.has(id)) set.delete(id); else set.add(id); syncMixer(); publishSound(); }, options);
      row.append(button);
    }
    el('bodyMixer').append(row);
  }
}
// Native ranges remain keyboard/MIDI controls. Horizontal touch drags adjust a
// knob; vertical gestures remain document scrolling. Mouse drags also use Y.
function initializeKnobs() {
  for (const input of document.querySelectorAll('.roach-knob input')) {
    const area = input.closest('.roach-knob');
    let drag = null;
    // The visible label owns pointer gestures. Native range touch defaults
    // otherwise jump to the touched fraction before scrolling can cancel them.
    area.addEventListener('click', event => event.preventDefault(), options);
    area.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, value: Number(input.value), touch: event.pointerType === 'touch', active: event.pointerType !== 'touch' };
      event.preventDefault();
      if (!drag.touch) { input.focus({ preventScroll: true }); area.setPointerCapture(event.pointerId); }
    }, options);
    area.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (drag.touch && !drag.active) {
        if (Math.abs(dy) > 5 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
        if (Math.abs(dx) < 5) return;
        drag.active = true; area.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      const min = Number(input.min), max = Number(input.max), step = Number(input.step);
      const value = drag.value + (dx - (drag.touch ? 0 : dy)) / 150 * (max - min);
      input.value = String(Math.max(min, Math.min(max, Math.round(value / step) * step)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, options);
    const release = event => {
      if (!drag || drag.id !== event.pointerId) return;
      const active = drag.active; drag = null;
      if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId);
      if (active) input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) area.addEventListener(type, release, options);
  }
}
async function loadModel() {
  if (!viewer) return;
  state.modelLoading = true; syncStageStatus();
  const version = ++loadVersion; el('retryModel').hidden = true;
  try {
    await viewer.loadUrl(modelUrl.href, { name: 'Cockroach · photogrammetry scan' });
    if (version !== loadVersion || state.disposed) return;
    syncRig();
    const head = state.joints.find(part => /^head$/i.test(part.name)); if (head) viewer.selectBone(head.id);
    applyStaticPose('neutral'); selectView(state.view); publish({ resetActivity: true }); status('modelStatus');
  } catch (error) {
    if (version !== loadVersion || state.disposed) return;
    status('modelStatus', error.message || 'The model could not load.'); el('retryModel').hidden = false;
  } finally { if (version === loadVersion && !state.disposed) { state.modelLoading = false; syncStageStatus(); } }
}

buildMixer(); initializeKnobs();
el('posePreset').replaceChildren(new Option('Custom pose', 'custom'), ...ROACH_STATIC_POSES.map(item => new Option(item.label, item.id)), new Option('Random pose', 'random'));
el('posePreset').value = state.posePreset;
const soundBank = document.createElement('optgroup'); soundBank.label = 'Sound presets';
soundBank.append(...ROACH_SOUND_PRESETS.map(item => new Option(item.label, item.id)));
const animationSoundBank = document.createElement('optgroup'); animationSoundBank.label = 'Animation sounds';
animationSoundBank.append(...ROACH_MOTION_SOUND_PRESETS.map(item => new Option(`${ROACH_MOTION_PRESETS.find(motion => motion.id === item.motionId)?.label ?? item.motionId} · ${item.label}`, `motion:${item.motionId}`)));
el('soundPreset').replaceChildren(soundBank, animationSoundBank);
el('tempo').value = state.motion.tempo; el('tempoOut').value = `${state.motion.tempo} BPM`;
el('intensity').value = state.motion.intensity; el('intensityOut').value = `${Math.round(state.motion.intensity * 100)}%`;
populateMotionPresets(); syncSound(); syncTransport();
try {
  viewer = createRoachViewer({ canvas: el('roachCanvas'), onStatus: message => status('modelStatus', message), onRig: syncRig, onSelect: syncSelectedPart,
    onPoseChange: syncManualPose,
    onInteraction(gesture) {
      if (gesture.kind === 'orbit') { if (gesture.phase === 'change' || gesture.phase === 'end') refreshGaze(); return; }
      if (gesture.kind !== 'joint') return;
      audio.interact({ jointId: gesture.id, active: gesture.phase === 'start' || gesture.phase === 'change', velocity: 0 });
      if (!state.audioOn && gesture.phase === 'start') announce('Audio is off — turn it on to hear playback');
    },
  });
  viewer.setRenderBudget({ fps: 20, pixelRatio: 1 });
  Object.defineProperty(window, 'roachSynth', { configurable: true, value: Object.freeze({
    getState: () => ({ ...viewer.getState(), time: currentTime(), playing: state.playing, soundPlaying: state.soundPlaying,
      posePreset: state.posePreset, motionChoice: state.motionChoice, motionSettings: structuredClone(state.motion),
      soundPreset: el('soundPreset').value, metronome: state.metronome,
      sound: { ...state.sound }, bodyMix: structuredClone(state.bodyMix), effectiveBodyMix: effectiveBodyMix(),
      muted: [...state.muted], solo: [...state.solo], selectedGroup: state.selectedGroup, mappings: [],
      audio: audio.getState(), audioOn: state.audioOn, view: state.view, side: state.side, renderQuality: 'economy', clipPreview: false }),
    getPartScreenPosition: id => viewer.getPartScreenPosition(id),
  }) });
  void loadModel();
} catch (error) { state.modelLoading = false; syncStageStatus(); status('modelStatus', `3D could not start: ${error.message || 'WebGL unavailable'}.`); el('roachCanvas').hidden = true; }

el('audioButton').addEventListener('click', async () => {
  if (state.audioStarting || state.disposed) return;
  if (state.audioOn && audio.getState().contextState === 'running') {
    const time = currentTime(); state.audioOn = false; anchorTime(time); audio.disable(); syncAudioButton(); syncTransport(); return;
  }
  state.audioStarting = true; el('audioButton').disabled = true; syncAudioButton();
  try {
    await audio.enable({ time: currentTime(), playing: state.playing, soundPlaying: state.soundPlaying,
      motion: state.motion, joints: state.joints, mappings: [], sound: state.sound, bodyMix: effectiveBodyMix(), metronome: state.metronome, resetActivity: true });
    if (state.disposed) return;
    const time = fallbackTime(); state.audioOn = true; publish({ time }); status('voiceStatus'); syncTransport();
  } catch (error) { state.audioOn = false; announce(`Audio could not start: ${error.message || error}`); }
  finally { state.audioStarting = false; if (!state.disposed) { el('audioButton').disabled = false; syncAudioButton(); } }
}, options);
el('stageAudioButton').addEventListener('click', () => el('audioButton').click(), options);
el('soundPlayButton').addEventListener('click', () => { state.soundPlaying = !state.soundPlaying; audio.update({ soundPlaying: state.soundPlaying }); syncTransport(); }, options);
el('motionButton').addEventListener('click', () => setPlaying(!state.playing), options);
el('posePreset').addEventListener('change', () => { if (el('posePreset').value !== 'custom') applyStaticPose(el('posePreset').value); }, options);
el('randomPose').addEventListener('click', () => applyStaticPose('random'), options);
el('resetPose').addEventListener('click', () => applyStaticPose('neutral'), options);
el('motionPreset').addEventListener('change', () => setMotionPreset(el('motionPreset').value), options);
el('randomMotion').addEventListener('click', () => setMotionPreset('random'), options);
function changeMotionBy(amount) {
  const index = ROACH_MOTION_PRESETS.findIndex(item => item.id === state.motionChoice);
  setMotionPreset(ROACH_MOTION_PRESETS[(index + amount + ROACH_MOTION_PRESETS.length) % ROACH_MOTION_PRESETS.length].id);
}
el('previousMotion').addEventListener('click', () => changeMotionBy(-1), options);
el('nextMotion').addEventListener('click', () => changeMotionBy(1), options);
document.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest?.('input, textarea, select, canvas, [contenteditable="true"]')) return;
  if (event.target !== document.body && !event.target.closest?.('.roach-panel')) return;
  event.preventDefault(); changeMotionBy(event.key === 'ArrowRight' ? 1 : -1);
}, options);
el('tempo').addEventListener('input', () => {
  const time = currentTime() * state.motion.tempo / Number(el('tempo').value);
  state.motion.tempo = Number(el('tempo').value); el('tempoOut').value = `${state.motion.tempo} BPM`;
  anchorTime(time); publish({ time, resetActivity: true }); updateVisual();
}, options);
el('intensity').addEventListener('input', () => { state.motion.intensity = Number(el('intensity').value); el('intensityOut').value = `${Math.round(state.motion.intensity * 100)}%`; audio.update({ motion: state.motion }); updateVisual(); }, options);
el('antennae').addEventListener('change', () => { state.antennae = el('antennae').checked; state.motion.antennae = state.motionPrepared && state.antennae; audio.update({ motion: state.motion }); updateVisual(); }, options);
el('metronome').addEventListener('change', () => { state.metronome = el('metronome').checked; audio.update({ metronome: state.metronome }); }, options);
el('soundPreset').addEventListener('change', () => {
  const preset = selectedSoundPreset(); if (!preset) return;
  state.sound = { ...preset.sound, level: state.sound.level }; state.bodyMix = structuredClone(preset.bodyMix); syncSound(); publishSound();
}, options);
el('randomSound').addEventListener('click', () => {
  const next = createRandomRoachSound(++state.soundSeed * 2654435761 >>> 0);
  state.sound = { ...next.sound, level: state.sound.level }; state.bodyMix = next.bodyMix; markSoundCustom(); syncSound(); publishSound();
}, options);
for (const input of document.querySelectorAll('[data-sound]')) input.addEventListener('input', () => { state.sound[input.dataset.sound] = Number(input.value); paintKnob(input); markSoundCustom(); publishSound(); }, options);
el('resetMix').addEventListener('click', () => {
  state.bodyMix = structuredClone(selectedSoundPreset()?.bodyMix ?? createDefaultRoachBodyMix());
  state.muted.clear(); state.solo.clear(); syncMixer(); publishSound();
}, options);
el('level').addEventListener('input', () => { state.sound.level = Number(el('level').value); el('levelOut').value = `${Math.round(state.sound.level * 100)}%`; audio.setLevel(state.sound.level); }, options);
el('speakButton').addEventListener('click', async () => {
  if (!state.audioOn) { announce('Audio is off — turn it on to hear playback'); return; }
  const text = el('phrase').value.trim(); if (!text) { status('voiceStatus', 'Give the bug a few words first.'); return; }
  const version = ++state.phraseRequest; status('voiceStatus');
  try { await audio.speak(text); }
  catch (error) { if (version === state.phraseRequest && !state.disposed) status('voiceStatus', `Voice: ${error.message || error}`); }
}, options);
el('phrase').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); el('speakButton').click(); } }, options);
for (const button of el('viewPresets').querySelectorAll('button')) button.addEventListener('click', () => selectView(button.dataset.view), options);
el('sideToggle').addEventListener('click', () => { state.side = state.side === 'left' ? 'right' : 'left'; el('sideToggle').textContent = state.side === 'left' ? 'L / R' : 'R / L'; selectView('side'); }, options);
el('resetCamera').addEventListener('click', () => { viewer?.resetCamera(); refreshGaze(); }, options);
el('zoomIn').addEventListener('click', () => viewer?.zoom(.87), options);
el('zoomOut').addEventListener('click', () => viewer?.zoom(1 / .87), options);
el('dragAxis').addEventListener('change', () => viewer?.setDragAxis(el('dragAxis').value), options);
el('touch3D').addEventListener('click', () => {
  const active = el('touch3D').getAttribute('aria-pressed') !== 'true';
  el('touch3D').setAttribute('aria-pressed', String(active)); el('touch3D').textContent = active ? '3D touch on' : '3D touch'; viewer?.setTouchInteraction(active);
}, options);
el('showJoints').addEventListener('click', () => { const visible = el('showJoints').getAttribute('aria-pressed') !== 'true'; viewer?.setSkeletonVisible(visible); el('showJoints').setAttribute('aria-pressed', String(visible)); }, options);
el('retryModel').addEventListener('click', () => void loadModel(), options);
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (frame) cancelAnimationFrame(frame); frame = 0; } else { lastFrame = -Infinity; updateVisual(); if (state.playing) scheduleFrame(); } }, options);
motionQuery.addEventListener('change', () => { if (motionQuery.matches) setPlaying(false); }, options);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  state.disposed = true; loadVersion += 1; state.phraseRequest += 1;
  if (frame) cancelAnimationFrame(frame); frame = 0;
  listeners.abort(); viewer?.dispose(); audio.dispose(); delete window.roachSynth;
}, options);
