import { SpiderSynthViewer } from './src/spider-synth-viewer.js';
import { createSpiderMidiControls } from './src/spider-synth-midi-controls.js';
import { createSpiderNavigationControls } from './src/spider-synth-navigation-controls.js';
import { SpiderSynthWorld, normalizeSpiderWorld, SPIDER_TRAVEL_PATHS } from './src/spider-synth-world.js';
import { normalizeSpiderWeb, serializeSpiderWeb, SPIDER_WEB_PRESETS, SPIDER_WEB_PARAMETERS } from './src/spider-synth-web.js';
import { SPIDER_JOINTS, SPIDER_MOTION_PRESETS, SPIDER_MOTION_DEFAULTS, SPIDER_STATIC_POSES,
  normalizeSpiderMotion, createRandomSpiderMotion, createSpiderStaticPose,
  createSpiderWeb, createSpiderFrame, writeSpiderPose, applySpiderSpeechPose } from './src/spider-synth-model.js';
import { SpiderSynthAudio, SPIDER_SOUND_PRESETS, SPIDER_SOUND_DEFAULTS, SPIDER_BODY_GROUPS,
  SPIDER_BODY_SOURCES, createDefaultSpiderBodyMix, createRandomSpiderSound,
  getSpiderMotionSound, getSpiderBodyGroupId } from './src/spider-synth-audio.js';

const el = id => document.getElementById(id);
const listeners = new AbortController(), options = { signal: listeners.signal };
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  playing: false, soundPlaying: false, audioOn: false, audioStarting: false, disposed: false,
  modelLoading: true, notice: '', metronome: false, phraseRequest: 0,
  posePreset: 'neutral', poseSeed: 0, motionSeed: 0, soundSeed: 0,
  motionChoice: SPIDER_MOTION_PRESETS[0].id,
  motion: normalizeSpiderMotion({ ...SPIDER_MOTION_DEFAULTS, preset: 'none' }),
  webSettings: normalizeSpiderWeb({ preset: 'argiope', seed: 1 }),
  worldSettings: normalizeSpiderWorld({ ...SPIDER_MOTION_PRESETS[0].world, playing: false }),
  sound: { ...SPIDER_SOUND_DEFAULTS, ...SPIDER_SOUND_PRESETS[0].sound },
  bodyMix: structuredClone(SPIDER_SOUND_PRESETS[0].bodyMix), muted: new Set(), solo: new Set(),
  selectedGroup: '', view: 'top', side: 'left', time: 0, anchor: performance.now(),
};
let viewer, midiControls, navigationControls, animationFrame = 0, loadVersion = 0, lastFrame = -Infinity, pulsesUntil = 0, wavesActive = false;
let web = createSpiderWeb(state.webSettings);
let preparedWeb = serializeSpiderWeb(web);
const visualWorld = new SpiderSynthWorld(state.worldSettings);
const steering = new Map();
const pose = new Float32Array(SPIDER_JOINTS.length * 3), scene = createSpiderFrame();
const speechMotion = { amount: 0, target: 0, audioTime: -Infinity, updatedAt: performance.now() };
const status = (id, message = '') => { el(id).textContent = message; el(id).hidden = !message; };
function syncStageStatus() { status('liveStatus', state.notice || (state.modelLoading ? 'Loading the spider… Web sound and voice are available.' : '')); }
const announce = message => { state.notice = message; syncStageStatus(); };
const audio = new SpiderSynthAudio({
  getWorldSnapshot() { updateVisual(); return visualWorld.snapshot(); },
  onStatus(message) {
    if (state.disposed) return;
    const text = String(message?.message ?? message ?? '');
    if (/error|could not|unavailable|requires|failed/i.test(text)) status('voiceStatus', text);
    if (state.audioOn && !audio.getState().enabled) {
      releaseAudioWorld(); anchorTime(audio.getTime()); state.audioOn = false; syncAudioButton(); syncTransport();
    }
    if (speechMotion.amount > 0) scheduleFrame();
  },
  onTelemetry(data) {
    if (state.disposed) return;
    if (state.audioOn && data.world) visualWorld.restore(data.world);
    const db = state.audioOn && data.peak > .000001 ? 20 * Math.log10(data.peak) : -Infinity;
    el('mixMeter').value = Math.max(-60, db); el('mixPeak').value = Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : '−∞ dBFS';
    speechMotion.target = data.speechEnvelope > .001 ? Math.min(1, data.speechEnvelope * 10) : 0;
    speechMotion.audioTime = data.audioTime;
    const events = (data.recentEvents ?? []).filter(event => data.audioTime - event.audioTime <= 2.4
      && (event.graphVersion == null || event.graphVersion === visualWorld.state.graphVersion));
    if (events.length || wavesActive) {
      viewer?.setEvents(events, data.audioTime); wavesActive = events.length > 0;
      if (events.length) {
        const age = Math.max(0, data.audioTime - Math.max(...events.map(event => event.audioTime)));
        pulsesUntil = performance.now() + Math.max(0, 2.5 - age) * 1000;
      }
    }
    if (needsVisualFrames()) scheduleFrame();
  },
});
function fallbackTime() { return state.time + (state.playing ? (performance.now() - state.anchor) / 1000 : 0); }
function currentTime() { return state.audioOn ? audio.getTime() : fallbackTime(); }
function worldClock() { return state.audioOn ? audio.clock() : performance.now() / 1000; }
function effectiveWorldSettings() {
  return { ...state.worldSettings, path: el('explore').checked ? state.worldSettings.path : 'hold', playing: state.playing };
}
function releaseAudioWorld() {
  updateVisual(); const snapshot = visualWorld.snapshot();
  visualWorld.restore(snapshot, performance.now() / 1000 - snapshot.clock);
}
function updateWorldSettings(settings) {
  if (JSON.stringify(normalizeSpiderWorld(settings)) !== JSON.stringify(visualWorld.settings)) visualWorld.update(settings, worldClock());
}
function publishWorld() {
  const settings = effectiveWorldSettings(); updateWorldSettings(settings);
  audio.update({ worldSettings: settings }); updateVisual(); scheduleFrame();
}
function commandWorld(command) {
  visualWorld.command(command, worldClock()); audio.worldCommand(command);
  updateVisual(); scheduleFrame();
}
function steerSpider({ x, z, source }) {
  const direction = viewer?.screenToWebDirection?.(x, z) ?? { x: -x, z };
  steering.set(source, direction); let dx = 0, dz = 0;
  for (const vector of steering.values()) { dx += vector.x; dz += vector.z; }
  const length = Math.max(1, Math.hypot(dx, dz));
  state.worldSettings.joystick = { x: dx / length, z: dz / length }; publishWorld();
}
function anchorTime(time) { state.time = Math.max(0, Number(time) || 0); state.anchor = performance.now(); }
function effectiveBodyMix() {
  return state.bodyMix.map(row => ({ ...row, level: state.muted.has(row.groupId) || (state.solo.size && !state.solo.has(row.groupId)) ? 0 : row.level }));
}
function audioSettings(extra = {}) {
  return { playing: state.playing, soundPlaying: state.soundPlaying, motion: state.motion,
    webSettings: state.webSettings, preparedWeb, worldSettings: effectiveWorldSettings(), sound: state.sound, bodyMix: effectiveBodyMix(), metronome: state.metronome, ...extra };
}
function publish(extra = {}) { updateWorldSettings(effectiveWorldSettings()); audio.update(audioSettings(extra)); }
function publishSound() { audio.update({ sound: state.sound, bodyMix: effectiveBodyMix() }); }
function syncAudioButton() {
  el('audioButton').setAttribute('aria-pressed', String(state.audioOn));
  el('audioState').textContent = state.audioStarting ? 'starting' : state.audioOn ? 'on' : 'off';
}
function syncTransport() {
  for (const [id, active, noun] of [['soundPlayButton', state.soundPlaying, 'sound'], ['motionButton', state.playing, 'animation']]) {
    el(id).setAttribute('aria-pressed', String(active)); el(id).setAttribute('aria-label', `${active ? 'Pause' : 'Play'} ${noun}`);
  }
  announce(!state.audioOn && (state.playing || state.soundPlaying) ? 'Audio is off — turn it on to hear playback' : '');
}
function selectGroup(groupId, side = 0, target = '') {
  const joint = SPIDER_JOINTS.find(item => (!target || item.id.startsWith(target)) && getSpiderBodyGroupId(item) === groupId
    && (!side || item.id.includes(side < 0 ? 'left' : 'right')))
    ?? SPIDER_JOINTS.find(item => getSpiderBodyGroupId(item) === groupId);
  if (joint) viewer?.selectJoint(joint.id);
  else if (groupId === 'spinnerets') viewer?.selectJoint('abdomen');
  state.selectedGroup = groupId; syncSelection();
}
function syncSelection() {
  for (const button of document.querySelectorAll('.spider-body-name')) button.setAttribute('aria-pressed', String(button.dataset.group === state.selectedGroup));
}
function selectView(view) {
  state.view = ['side', 'top', 'bottom', 'face'].includes(view) ? view : 'top';
  viewer?.setViewPreset(state.view, { side: state.side });
  for (const button of el('viewPresets').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  el('sideToggle').hidden = state.view !== 'side'; updateVisual();
}
function speechTarget() {
  return state.audioOn && audio.context?.state === 'running' && audio.clock() - speechMotion.audioTime < .3 ? speechMotion.target : 0;
}
function needsVisualFrames() { return state.playing || visualWorld.state.active || midiControls?.isAnimating() || speechMotion.amount > 0 || speechTarget() > 0 || performance.now() < pulsesUntil; }
function updateVisual() {
  if (state.disposed) return;
  const time = currentTime(), beat = state.playing ? Math.floor(time * state.motion.tempo / 60) % 4 : -1;
  for (const [index, dot] of [...el('beatIndicator').children].entries()) dot.classList.toggle('is-active', index === beat);
  el('beatIndicator').setAttribute('aria-label', beat < 0 ? 'Beat stopped' : `Beat ${beat + 1} of 4`);
  writeSpiderPose(time, state.motion, pose);
  audio.applyMidiPose(pose, SPIDER_JOINTS, state.motion.tempo, state.motion.intensity);
  const now = performance.now(), dt = Math.max(0, (now - speechMotion.updatedAt) / 1000); speechMotion.updatedAt = now;
  const target = speechTarget(); speechMotion.amount += (target - speechMotion.amount) * (1 - Math.exp(-dt / (target > speechMotion.amount ? .04 : .14)));
  if (!target && speechMotion.amount < .001) speechMotion.amount = 0;
  applySpiderSpeechPose(audio.clock(), speechMotion.amount, pose);
  const world = visualWorld.sample(worldClock(), state.motion, web, scene, pose, audio.midiPerformance.poseOffsets, { motionTime: time, playing: state.playing });
  viewer?.setClock?.(worldClock()); viewer?.setCenter?.(visualWorld.point); viewer?.setWorld?.(world); viewer?.setFrame(scene);
  const prey = world.prey.filter(item => item.state !== 'eaten');
  const worldStatus = world.eating ? 'Enjoying a fly' : prey.some(item => item.state === 'hunting') ? 'Hunting the fly'
    : prey.some(item => item.state === 'flying') ? 'Fly approaching' : prey.length ? 'Fly trapped · click it to hunt'
    : world.layingSpeed > .0001 ? 'Spinning silk' : '';
  if (el('webWorldStatus').textContent !== worldStatus) el('webWorldStatus').textContent = worldStatus;
}
function tick(now) {
  animationFrame = 0; if (state.disposed || document.hidden) return;
  if (now - lastFrame >= 50) { lastFrame = now; updateVisual(); }
  if (needsVisualFrames()) scheduleFrame();
}
function scheduleFrame() { if (!animationFrame && !state.disposed && !document.hidden) animationFrame = requestAnimationFrame(tick); }
function setPlaying(playing, { restart = false } = {}) {
  const time = restart ? 0 : currentTime();
  if (playing && state.motion.preset === 'none') state.motion = normalizeSpiderMotion({ ...state.motion, preset: state.motionChoice });
  state.playing = playing === true; anchorTime(time); publish({ time }); syncTransport(); updateVisual();
  if (needsVisualFrames()) scheduleFrame();
}
function populateMotionPresets() {
  el('motionPreset').replaceChildren(...SPIDER_MOTION_PRESETS.map(item => new Option(item.label, item.id)));
  if (state.motionChoice === 'random') el('motionPreset').add(new Option('Random motion', 'random'));
  el('motionPreset').value = state.motionChoice;
}
function setMotionPreset(id, { applySound = true, applyTravel = true } = {}) {
  const time = currentTime();
  state.motionChoice = id === 'random' ? id : SPIDER_MOTION_PRESETS.find(item => item.id === id)?.id ?? SPIDER_MOTION_PRESETS[0].id;
  const base = { ...state.motion, offsets: {}, center: { x: 0, z: 0 }, yaw: 0, explore: el('explore').checked };
  const next = id === 'random' ? createRandomSpiderMotion(++state.motionSeed * 2654435761 >>> 0, base)
    : normalizeSpiderMotion({ ...base, preset: state.motionChoice });
  state.motion = normalizeSpiderMotion(next);
  const travel = next.world ?? SPIDER_MOTION_PRESETS.find(item => item.id === state.motionChoice)?.world;
  if (applyTravel && travel) {
    state.worldSettings = normalizeSpiderWorld({ ...state.worldSettings, ...travel });
    syncTravelControls();
  }
  state.posePreset = 'custom'; el('posePreset').value = 'custom'; viewer?.setOffsets?.(state.motion.offsets);
  if (applySound) {
    const patch = id === 'random' ? createRandomSpiderSound(state.motionSeed * 2654435761 >>> 0) : getSpiderMotionSound(id);
    state.sound = { ...patch.sound, level: state.sound.level, voice: state.sound.voice }; state.bodyMix = structuredClone(patch.bodyMix);
    if (id === 'random') markSoundCustom(); else el('soundPreset').value = `motion:${id}`;
    syncSound();
  }
  el('intensity').value = state.motion.intensity; el('intensityOut').value = `${Math.round(state.motion.intensity * 100)}%`;
  populateMotionPresets(); anchorTime(time); publish({ time, resetActivity: true }); updateVisual();
}
function applyStaticPose(id) {
  state.posePreset = id; el('posePreset').value = id;
  state.motion = normalizeSpiderMotion({ ...state.motion,
    offsets: createSpiderStaticPose(id, ++state.poseSeed * 2654435761 >>> 0) });
  // Pose is a joint-offset layer. It never owns transport, phase or voice release.
  viewer?.setOffsets?.(state.motion.offsets); audio.update({ motion: state.motion }); updateVisual(); scheduleFrame();
}
function paintKnob(input) {
  const value = Number(input.value), fraction = (value - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.closest('.spider-knob')?.style.setProperty('--knob-angle', `${-135 + 270 * fraction}deg`);
  const parameter = SPIDER_WEB_PARAMETERS.find(item => item.key === input.id);
  const text = parameter?.step === 1 ? String(value) : input.id === 'pluckRegister' ? `${value > 0 ? '+' : ''}${value} st`
    : ['pluckAttack', 'pluckHold'].includes(input.id) ? `${Math.round(value * 1000)} ms`
    : input.id === 'pluckRelease' ? `${value.toFixed(2)}s`
    : ['tune', 'tension', 'travelSpeed', 'pluckSpread'].includes(input.id) ? `${value.toFixed(2)}×` : input.id === 'decay' ? `${value.toFixed(1)}s`
    : input.id === 'pan' ? value === 0 ? 'C' : `${Math.round(Math.abs(value) * 100)}${value < 0 ? 'L' : 'R'}` : `${Math.round(value * 100)}%`;
  el(`${input.id}Out`).textContent = text; input.setAttribute('aria-valuetext', text);
}
function buildToneControls() {
  const params = [ ['tension', 'Tension', .25, 4, .01, 'webControls'], ['damping', 'Damping', 0, 1, .01, 'webControls'],
    ['coupling', 'Coupling', 0, .4, .01, 'webControls'], ['decay', 'Decay', .08, 6, .01, 'webControls'],
    ['pluckRegister', 'Register', -24, 36, 1, 'pluckControls'], ['pluckSpread', 'Pitch span', .35, 1.8, .01, 'pluckControls'],
    ['pluckAttack', 'Attack', .001, .35, .001, 'pluckControls'], ['pluckHold', 'Hold', 0, .6, .001, 'pluckControls'],
    ['pluckRelease', 'Release', .04, 4, .01, 'pluckControls'],
    ['tune', 'Tuning', .5, 2, .01, 'toneControls'], ['brightness', 'Brightness', 0, 1, .01, 'toneControls'],
    ['body', 'Body', 0, 1, .01, 'toneControls'], ['pan', 'Pan', -1, 1, .01, 'toneControls'],
    ['texture', 'Texture', 0, 1, .01, 'toneControls'], ['slide', 'Glide', 0, 1, .01, 'toneControls'],
    ['flutter', 'Courtship', 0, 1, .01, 'toneControls'], ['space', 'Space', 0, 1, .01, 'toneControls'],
    ['silkLevel', 'Silk level', 0, 1, .01, 'silkMixControl'], ['preyLevel', 'Bug level', 0, 1, .01, 'preyMixControl'] ];
  for (const [id, name, min, max, step, parent] of params) {
    const input = addKnob({ id, name, min, max, step, parent }); input.dataset.sound = id;
  }
}
function addKnob({ id, name, min, max, step, parent }) {
    const label = document.createElement('label'); label.className = 'spider-knob spider-tone-knob'; label.htmlFor = id;
    const copy = document.createElement('span'); copy.className = 'knob-label'; copy.textContent = name;
    const face = document.createElement('span'); face.className = 'knob-face'; face.setAttribute('aria-hidden', 'true');
    const pointer = document.createElement('i'), output = document.createElement('small'); output.id = `${id}Out`; face.append(pointer, output);
    const input = document.createElement('input'); Object.assign(input, { id, type: 'range', min, max, step }); input.setAttribute('aria-label', name);
    label.append(copy, face, input); el(parent).append(label);
    return input;
}
function syncWebControls() {
  el('webPreset').value = state.webSettings.preset;
  for (const parameter of SPIDER_WEB_PARAMETERS) {
    const input = el(parameter.key); if (!input) continue;
    input.min = parameter.min; input.max = parameter.max; input.step = parameter.step;
    input.value = state.webSettings[parameter.key];
    if (input.closest('.spider-knob')) paintKnob(input);
    else el(`${parameter.key}Out`).value = input.value;
  }
}
function changeWeb(settings) {
  state.webSettings = normalizeSpiderWeb(settings); web = createSpiderWeb(state.webSettings);
  preparedWeb = serializeSpiderWeb(web);
  syncWebControls(); viewer?.setWeb(web); audio.update({ webSettings: state.webSettings, preparedWeb }); updateVisual();
}
function selectWebPreset(id) {
  const preset = SPIDER_WEB_PRESETS.find(item => item.id === id); if (!preset) return;
  changeWeb({ ...preset.settings, seed: state.webSettings.seed });
}
function syncTravelControls() {
  el('travelPath').value = state.worldSettings.path;
  for (const [key, id] of [['speed', 'travelSpeed'], ['range', 'travelRange']]) {
    const input = el(id); input.value = state.worldSettings[key]; paintKnob(input);
  }
}
function buildWorldControls() {
  el('webPreset').replaceChildren(...SPIDER_WEB_PRESETS.map(item => new Option(item.label, item.id)));
  el('travelPath').replaceChildren(...SPIDER_TRAVEL_PATHS.map(item => new Option(item.label, item.id)));
  el('travelPath').value = state.worldSettings.path;
  for (const parameter of SPIDER_WEB_PARAMETERS) {
    if (['spokes', 'rings'].includes(parameter.key)) continue;
    const name = ({ irregularity: 'Variation', asymmetry: 'Hub offset' })[parameter.key] ?? parameter.label;
    const input = addKnob({ id: parameter.key, name, ...parameter, parent: 'webGeometryControls' });
    input.addEventListener('input', () => changeWeb({ ...state.webSettings, [parameter.key]: Number(input.value) }), options);
  }
  for (const [key, id, name, max] of [['speed', 'travelSpeed', 'Speed', 2], ['range', 'travelRange', 'Range', .85]]) {
    const input = addKnob({ id, name, min: 0, max, step: .01, parent: 'travelControls' });
    input.value = state.worldSettings[key]; paintKnob(input);
    input.addEventListener('input', () => { state.worldSettings[key] = Number(input.value); paintKnob(input); publishWorld(); }, options);
  }
  syncWebControls();
}
function syncMixer() {
  for (const row of state.bodyMix) {
    const container = document.querySelector(`.spider-body-row[data-group="${row.groupId}"]`);
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
  return id.startsWith('motion:') ? getSpiderMotionSound(id.slice(7)) : SPIDER_SOUND_PRESETS.find(item => item.id === id);
}
function buildMixer() {
  for (const { id, label } of SPIDER_BODY_GROUPS) {
    const row = document.createElement('div'); row.className = 'spider-body-row'; row.dataset.group = id;
    const name = document.createElement('button'); name.type = 'button'; name.className = 'spider-body-name'; name.dataset.group = id; name.textContent = label; name.setAttribute('aria-pressed', 'false');
    name.addEventListener('click', () => selectGroup(id), options);
    const source = document.createElement('select'); source.id = `source-${id}`; source.dataset.bodySource = id; source.setAttribute('aria-label', `${label} sound`);
    for (const item of SPIDER_BODY_SOURCES) source.add(new Option(item.label, item.id));
    source.addEventListener('change', () => { state.bodyMix.find(item => item.groupId === id).source = source.value; markSoundCustom(); publishSound(); }, options);
    const sourceShell = document.createElement('span'); sourceShell.className = 'select-shell'; sourceShell.append(source);
    const knob = document.createElement('label'); knob.className = 'spider-knob'; knob.htmlFor = `mix-${id}`;
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
  for (const input of document.querySelectorAll('.spider-knob input')) {
    const area = input.closest('.spider-knob');
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
  state.modelLoading = true; syncStageStatus(); const version = ++loadVersion; el('retryModel').hidden = true;
  try {
    const loaded = await viewer.load();
    if (loaded === false || !viewer.getState().loaded) throw new Error('The spider scan could not load');
    if (version !== loadVersion || state.disposed) return;
    el('specimenImage').hidden = true; el('spiderCanvas').style.visibility = 'visible';
    for (const id of ['resetCamera', 'showJoints']) el(id).disabled = false;
    viewer.setOffsets?.(state.motion.offsets); selectView(state.view); selectGroup('cephalothorax');
    status('modelStatus'); updateVisual(); midiControls?.syncRig();
  } catch (error) {
    if (version !== loadVersion || state.disposed) return;
    status('modelStatus', `Model: ${error.message || 'could not load'}. Web sound remains playable.`); el('retryModel').hidden = false;
  } finally { if (version === loadVersion && !state.disposed) { state.modelLoading = false; syncStageStatus(); } }
}

buildToneControls(); buildWorldControls(); buildMixer(); initializeKnobs();
el('posePreset').replaceChildren(new Option('Custom pose', 'custom'), ...SPIDER_STATIC_POSES.map(item => new Option(item.label, item.id)));
el('posePreset').value = state.posePreset;
const soundBank = document.createElement('optgroup'); soundBank.label = 'Sound presets';
soundBank.append(...SPIDER_SOUND_PRESETS.map(item => new Option(item.label, item.id)));
const motionBank = document.createElement('optgroup'); motionBank.label = 'Animation sounds';
motionBank.append(...SPIDER_MOTION_PRESETS.map(item => new Option(item.label, `motion:${item.id}`)));
el('soundPreset').replaceChildren(soundBank, motionBank);
el('soundPreset').value = SPIDER_SOUND_PRESETS[0].id;
el('tempo').value = state.motion.tempo; el('tempoOut').value = `${state.motion.tempo} BPM`;
el('intensity').value = state.motion.intensity; el('intensityOut').value = `${Math.round(state.motion.intensity * 100)}%`;
populateMotionPresets(); syncSound(); syncTransport();
try {
  viewer = new SpiderSynthViewer({ canvas: el('spiderCanvas'),
    onStatus(data) { if (data?.state === 'error') status('modelStatus', data.message); },
    onSelect({ jointId }) { state.selectedGroup = getSpiderBodyGroupId(jointId); syncSelection(); },
    onInteract({ jointId, offset, active, velocity }) {
      if (!SPIDER_JOINTS.some(joint => joint.id === jointId)) return;
      if (offset) {
        state.motion = normalizeSpiderMotion({ ...state.motion, offsets: { ...state.motion.offsets, [jointId]: { x: offset.x, y: offset.y, z: offset.z } } });
        viewer?.setOffsets?.(state.motion.offsets);
        state.posePreset = 'custom'; el('posePreset').value = 'custom'; audio.update({ motion: state.motion }); updateVisual();
      }
      audio.interact({ jointId, active, velocity });
      if (!state.audioOn && active) announce('Audio is off — turn it on to hear playback');
    },
    onMove({ x, z, active, velocity }) {
      commandWorld({ type: 'move', x, z }); audio.interact({ jointId: 'cephalothorax', active, velocity });
    },
    onPluck(event) {
      if (event.source === 'silk') commandWorld({ type: 'pluck-silk', id: event.silkId, u: event.u, strength: event.velocity, angle: event.angle });
      else audio.pluck(event);
      if (!state.audioOn) announce('Audio is off — turn it on to hear playback');
      else { pulsesUntil = performance.now() + 500; scheduleFrame(); }
    },
    onPreySelect({ id }) { commandWorld({ type: 'hunt', id }); },
  });
  viewer.setWeb(web); updateVisual();
  // Show the small real-specimen render until the interactive scan is ready.
  // Audio and both players stay usable throughout the download.
  void loadModel();
} catch (error) {
  state.modelLoading = false; syncStageStatus(); status('modelStatus', `3D could not start: ${error.message || 'WebGL unavailable'}. Sound and MIDI remain available.`); el('spiderCanvas').hidden = true;
}
Object.defineProperty(window, 'spiderSynth', { configurable: true, value: Object.freeze({
  getState: () => ({ ...viewer?.getState(), playing: state.playing, soundPlaying: state.soundPlaying, audioOn: state.audioOn,
    time: currentTime(), view: state.view, side: state.side, posePreset: state.posePreset, motionChoice: state.motionChoice,
    motionSettings: structuredClone(state.motion), webSettings: { ...state.webSettings },
    worldSettings: structuredClone(effectiveWorldSettings()), world: visualWorld.snapshot(), navigation: navigationControls?.getState(),
    web: { nodes: web.nodes.length, segments: web.segments.length }, frame: { ...structuredClone(scene), pose: Array.from(scene.pose) },
    soundPreset: el('soundPreset').value, sound: { ...state.sound }, bodyMix: structuredClone(state.bodyMix),
    effectiveBodyMix: effectiveBodyMix(), muted: [...state.muted], solo: [...state.solo], selectedGroup: state.selectedGroup,
    audio: audio.getState(), midi: midiControls?.getState(), speechMotion: speechMotion.amount, metronome: state.metronome,
    renderQuality: 'audio-first', modelLoading: state.modelLoading }),
  getPartScreenPosition: id => viewer?.getPartScreenPosition(id),
  getSegmentScreenPosition: (id, u) => viewer?.getSegmentScreenPosition?.(id, u),
  getSilkScreenPosition: (id, u) => viewer?.getSilkScreenPosition?.(id, u),
  getPreyScreenPosition: id => viewer?.getPreyScreenPosition?.(id),
}) });

el('audioButton').addEventListener('click', async () => {
  if (state.audioStarting || state.disposed) return;
  if (state.audioOn && audio.getState().contextState === 'running') {
    const time = currentTime(); releaseAudioWorld(); state.audioOn = false; anchorTime(time); audio.disable(); syncAudioButton(); syncTransport(); updateVisual(); return;
  }
  const resumingAudioClock = state.audioOn;
  state.audioStarting = true; el('audioButton').disabled = true; syncAudioButton();
  try {
    await audio.enable(audioSettings({ time: currentTime(), resetActivity: true }));
    if (state.disposed) return;
    // A suspended audio clock freezes its pose. Only a previously silent
    // animation hands over elapsed wall time when Audio is first armed.
    const time = resumingAudioClock ? audio.getTime() : fallbackTime();
    const snapshot = audio.getState().world;
    if (snapshot) visualWorld.restore(snapshot);
    else if (!resumingAudioClock) { const fallback = visualWorld.snapshot(); visualWorld.restore(fallback, audio.clock() - fallback.clock); }
    state.audioOn = true; publish({ time }); status('voiceStatus'); syncTransport(); updateVisual(); scheduleFrame();
  } catch (error) { state.audioOn = false; announce(`Audio could not start: ${error.message || error}`); }
  finally { state.audioStarting = false; if (!state.disposed) { el('audioButton').disabled = false; syncAudioButton(); } }
}, options);
el('soundPlayButton').addEventListener('click', () => { state.soundPlaying = !state.soundPlaying; audio.update({ soundPlaying: state.soundPlaying }); syncTransport(); }, options);
el('motionButton').addEventListener('click', () => setPlaying(!state.playing), options);
el('posePreset').addEventListener('change', () => { if (el('posePreset').value !== 'custom') applyStaticPose(el('posePreset').value); }, options);
el('randomPose').addEventListener('click', () => applyStaticPose('random'), options);
el('resetPose').addEventListener('click', () => { midiControls?.panic(); applyStaticPose('neutral'); }, options);
el('motionPreset').addEventListener('change', () => setMotionPreset(el('motionPreset').value), options);
el('randomMotion').addEventListener('click', () => setMotionPreset('random'), options);
function changeMotionBy(amount) {
  const index = SPIDER_MOTION_PRESETS.findIndex(item => item.id === state.motionChoice);
  setMotionPreset(SPIDER_MOTION_PRESETS[(index + amount + SPIDER_MOTION_PRESETS.length) % SPIDER_MOTION_PRESETS.length].id);
}
el('previousMotion').addEventListener('click', () => changeMotionBy(-1), options);
el('nextMotion').addEventListener('click', () => changeMotionBy(1), options);
document.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest?.('input, textarea, select, canvas, [contenteditable="true"]')) return;
  if (event.target !== document.body && !event.target.closest?.('.spider-panel')) return;
  event.preventDefault(); changeMotionBy(event.key === 'ArrowRight' ? 1 : -1);
}, options);
el('tempo').addEventListener('input', () => {
  const time = currentTime() * state.motion.tempo / Number(el('tempo').value);
  state.motion.tempo = Number(el('tempo').value); el('tempoOut').value = `${state.motion.tempo} BPM`;
  anchorTime(time); publish({ time, resetActivity: true }); updateVisual();
}, options);
el('intensity').addEventListener('input', () => { state.motion.intensity = Number(el('intensity').value); el('intensityOut').value = `${Math.round(state.motion.intensity * 100)}%`; audio.update({ motion: state.motion }); updateVisual(); }, options);
el('explore').addEventListener('change', publishWorld, options);
el('travelPath').addEventListener('change', () => { state.worldSettings.path = el('travelPath').value; publishWorld(); }, options);
el('homeSpider').addEventListener('click', () => {
  navigationControls?.release(); midiControls?.panic();
  state.motion = normalizeSpiderMotion({ ...state.motion, center: { x: 0, z: 0 }, yaw: 0 });
  audio.update({ motion: state.motion }); commandWorld({ type: 'home' });
}, options);
el('metronome').addEventListener('change', () => { state.metronome = el('metronome').checked; audio.update({ metronome: state.metronome }); }, options);
for (const key of ['spokes', 'rings']) el(key).addEventListener('input', () => {
  changeWeb({ ...state.webSettings, [key]: Number(el(key).value) });
}, options);
el('webPreset').addEventListener('change', () => selectWebPreset(el('webPreset').value), options);
el('randomWeb').addEventListener('click', () => {
  state.webSettings.seed = (state.webSettings.seed + 1) >>> 0;
  selectWebPreset(SPIDER_WEB_PRESETS[(state.webSettings.seed * 7) % SPIDER_WEB_PRESETS.length].id);
}, options);
el('laySilk').addEventListener('click', () => {
  state.worldSettings.laySilk = !state.worldSettings.laySilk;
  el('laySilk').setAttribute('aria-pressed', String(state.worldSettings.laySilk)); publishWorld();
}, options);
el('clearSilk').addEventListener('click', () => commandWorld({ type: 'clear-silk' }), options);
el('huntBug').addEventListener('click', () => commandWorld({ type: 'hunt' }), options);
el('catchBug').addEventListener('click', () => {
  commandWorld({ type: 'send-prey' });
  if (!state.audioOn) announce('Audio is off — turn it on to hear playback');
}, options);
el('soundPreset').addEventListener('change', () => {
  const preset = selectedSoundPreset(); if (!preset) return;
  state.sound = { ...preset.sound, level: state.sound.level }; state.bodyMix = structuredClone(preset.bodyMix);
  syncSound(); publishSound();
}, options);
el('randomSound').addEventListener('click', () => {
  const next = createRandomSpiderSound(++state.soundSeed * 2654435761 >>> 0);
  state.sound = { ...next.sound, level: state.sound.level }; state.bodyMix = next.bodyMix; markSoundCustom(); syncSound(); publishSound();
}, options);
for (const input of document.querySelectorAll('[data-sound]')) input.addEventListener('input', () => {
  state.sound[input.dataset.sound] = Number(input.value); paintKnob(input); markSoundCustom(); publishSound();
}, options);
el('resetMix').addEventListener('click', () => {
  state.bodyMix = structuredClone(selectedSoundPreset()?.bodyMix ?? createDefaultSpiderBodyMix()); state.muted.clear(); state.solo.clear(); syncMixer(); publishSound();
}, options);
el('level').addEventListener('input', () => { state.sound.level = Number(el('level').value); el('levelOut').value = `${Math.round(state.sound.level * 100)}%`; audio.update({ sound: { level: state.sound.level } }); }, options);
el('speakButton').addEventListener('click', async () => {
  if (!state.audioOn) { announce('Audio is off — turn it on to hear playback'); return; }
  const text = el('phrase').value.trim(); if (!text) { status('voiceStatus', 'Give the spider a few words first.'); return; }
  const version = ++state.phraseRequest; status('voiceStatus');
  try { await audio.speak(text); }
  catch (error) { if (version === state.phraseRequest && !state.disposed) status('voiceStatus', `Voice: ${error.message || error}`); }
}, options);
el('phrase').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); el('speakButton').click(); } }, options);
for (const button of el('viewPresets').querySelectorAll('button')) button.addEventListener('click', () => selectView(button.dataset.view), options);
el('sideToggle').addEventListener('click', () => { state.side = state.side === 'left' ? 'right' : 'left'; el('sideToggle').textContent = state.side === 'left' ? 'L / R' : 'R / L'; selectView('side'); }, options);
el('resetCamera').addEventListener('click', () => viewer?.fit(), options);
el('zoomIn').addEventListener('click', () => viewer?.zoomBy(.87), options);
el('zoomOut').addEventListener('click', () => viewer?.zoomBy(1 / .87), options);
el('dragAxis').addEventListener('change', () => viewer?.setAxis(el('dragAxis').value), options);
for (const [id, method] of [['touch3D', 'setTouchMode'], ['showJoints', 'setShowJoints'], ['moveOnWeb', 'setMoveMode']]) {
  el(id).addEventListener('click', () => { const active = el(id).getAttribute('aria-pressed') !== 'true'; el(id).setAttribute('aria-pressed', String(active)); viewer?.[method](active); }, options);
}
el('retryModel').addEventListener('click', () => void loadModel(), options);
// Keep the single Audio control available above the sticky mobile specimen.
const masthead = document.querySelector('.masthead');
let headerHeight = 0;
function measureHeader() {
  const height = Math.ceil(masthead.getBoundingClientRect().height);
  if (height === headerHeight) return;
  headerHeight = height; document.body.style.setProperty('--spider-header-height', `${height}px`);
}
const headerObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measureHeader) : null;
headerObserver?.observe(masthead); measureHeader(); window.addEventListener('resize', measureHeader, options);
const gestureInfo = el('gestureInfo'), gestureHelp = el('gestureHelp'), infoArea = gestureInfo.parentElement;
let infoPinned = false;
function showGestureHelp(open) { gestureHelp.hidden = !open; gestureInfo.setAttribute('aria-expanded', String(open)); }
function closeGestureHelp() { infoPinned = false; showGestureHelp(false); }
gestureInfo.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') showGestureHelp(true); }, options);
infoArea.addEventListener('pointerleave', () => { if (!infoPinned && !infoArea.contains(document.activeElement)) showGestureHelp(false); }, options);
gestureInfo.addEventListener('focus', () => showGestureHelp(true), options);
infoArea.addEventListener('focusout', event => { if (!infoArea.contains(event.relatedTarget)) closeGestureHelp(); }, options);
gestureInfo.addEventListener('click', () => { infoPinned = !infoPinned; showGestureHelp(infoPinned); }, options);
document.addEventListener('pointerdown', event => { if (!infoArea.contains(event.target)) closeGestureHelp(); }, options);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeGestureHelp(); }, options);
navigationControls = createSpiderNavigationControls({ element: el('webJoystick'), onSteer: steerSpider });
midiControls = createSpiderMidiControls({ audio, setPlaying, selectGroup, onSteer: steerSpider,
  onVisual: () => { updateVisual(); scheduleFrame(); },
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (animationFrame) cancelAnimationFrame(animationFrame); animationFrame = 0; } else { lastFrame = -Infinity; updateVisual(); if (needsVisualFrames()) scheduleFrame(); } }, options);
motionQuery.addEventListener('change', () => { if (motionQuery.matches) setPlaying(false); }, options);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  state.disposed = true; loadVersion += 1; state.phraseRequest += 1;
  if (animationFrame) cancelAnimationFrame(animationFrame); animationFrame = 0;
  navigationControls?.dispose(); midiControls?.dispose(); headerObserver?.disconnect(); listeners.abort(); viewer?.dispose(); audio.dispose(); delete window.spiderSynth;
}, options);
