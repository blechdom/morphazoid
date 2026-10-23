import { createStereoMeter } from '../../ui/patterns/level-meter.js';
import { createRigAJigViewer } from './rig-a-jig-viewer.js';
import { RIG_DESCRIPTIONS, RIG_GROUPS } from './rig-a-jig-rigs.js';
import { createRigAJigAudio } from './rig-a-jig-audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const now = () => performance.now() / 1000;

const rigIds = Object.keys(RIG_DESCRIPTIONS);
const MOTIONS = [
  { id: 'walk', label: 'Walk', overlay: null },
  { id: 'dance', label: 'Dance', overlay: 'dance', duration: 3.2 },
  { id: 'jump', label: 'Jump', overlay: 'jump', duration: 0.9 },
  { id: 'karate', label: 'Karate', overlay: 'karate', duration: 1.4 },
  { id: 'stomp', label: 'Stomp', overlay: 'stomp', duration: 0.7 },
];
const RANDOM_LABEL = 'Random body plan';

const defaultSettings = () => ({ rate: 0.35, amp: 0.5, sway: 0.3, fold: 0.5 });
let rig = 'mocap', randomSeed = null;
const settings = Object.fromEntries(rigIds.map((id) => [id, defaultSettings()]));
settings.random = defaultSettings();
settings.mocap = defaultSettings();
const motions = Object.fromEntries(rigIds.map((id) => [id, 'walk']));
motions.random = 'walk';
const clocks = { walk: { playing: false, anchor: 0, cycles: 0 } };
let armed = false, starting = false, disposed = false, playing = false;
let overlay = null; // { name, start, duration }
let frameId = 0, lastPaint = 0, timer = null, suspendTimer = null, scheduledUntil = 0;
const audio = { context: null, master: null, splitter: null, merger: null,
  analysers: null, buffers: null, engine: null, levels: { left: 0, right: 0 } };

const meter = createStereoMeter({ ariaLabel: 'Rig-a-Jig stereo output', active: false });
const audioButton = $('audioButton');
const audioStateLabel = $('audioState');
const outputInput = $('output');
const outputOut = $('outputOut');
audioButton.insertAdjacentElement('afterend', meter);
audioButton.addEventListener('click', () => { void toggleAudio(); });
outputInput.addEventListener('input', () => {
  const value = Number(outputInput.value);
  outputOut.textContent = `${Math.round(value * 100)}%`;
  if (armed && audio.master) audio.master.gain.setTargetAtTime(value, audio.context.currentTime, 0.025);
});
function setAudioVisual(on) {
  audioButton.setAttribute('aria-pressed', String(on));
  audioButton.setAttribute('aria-label', on ? 'Turn audio off' : 'Turn audio on');
  audioStateLabel.textContent = on ? 'on' : 'off';
  meter.setActive(on);
}
const status = (message) => { $('liveStatus').textContent = message; };

/* Build the rig dropdown with grouped options. */
const rigSelect = $('rigSelect');
for (const [group, ids] of Object.entries(RIG_GROUPS)) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = group;
  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    optgroup.append(option);
  }
  rigSelect.append(optgroup);
}
{
  const optgroup = document.createElement('optgroup');
  optgroup.label = 'Generative';
  const option = document.createElement('option');
  option.value = 'random';
  option.textContent = RANDOM_LABEL;
  optgroup.append(option);
  const mocap = document.createElement('option');
  mocap.value = 'mocap';
  mocap.textContent = 'Mocap humanoid (Quaternius UAL · CC0)';
  optgroup.append(mocap);
  rigSelect.append(optgroup);
}

let currentClip = 'Dance_Loop';
const viewer = createRigAJigViewer($('zooCanvas'), {
  onJointGrab({ joint }) {
    $('jointSelect').value = String(joint);
    viewer.setSelected(joint);
    if (armed) audio.engine?.contact(currentRigId(), settings[currentRigId()], { index: joint, strength: 0.7, pan: 0 });
  },
  onFinish({ joint, moved, cancelled }) {
    if (joint >= 0 && !moved && !cancelled && armed) {
      audio.engine?.contact(currentRigId(), settings[currentRigId()], { index: joint, strength: 0.9, pan: 0 });
    }
  },
  onRigReady({ clipNames }) {
    const select = $('clipSelect');
    select.replaceChildren(...clipNames.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name.replace(/_/g, ' ');
      return option;
    }));
    select.value = currentClip;
    viewer.playClip(currentClip);
    if (rig === 'mocap' && playing) viewer.setMocapPlaying?.(true);
    $('jointSelect').max = String(viewer.getState().joints - 1);
    updateReadout();
  },
  onRigError(error) {
    status(`Mocap rig could not load: ${error?.message ?? error}. Other rigs still work.`);
  },
});

function currentRigId() { return rig === 'random' ? 'random' : rig === 'mocap' ? 'mocap' : rig; }
function poseAt() { return { ...settings[currentRigId()] }; }

function motionCycles(clock, rate, time) {
  if (clock.playing) clock.cycles = clock.base + (time - clock.anchor) * rate;
  return clock.cycles;
}
function startWalkClock() {
  const clock = clocks.walk;
  clock.base = clock.cycles;
  clock.anchor = now();
  clock.playing = true;
}
function stopWalkClock() {
  const clock = clocks.walk;
  motionCycles(clock, settings[currentRigId()].rate, now());
  clock.playing = false;
}

function buildRig() {
  if (rig === 'random') {
    randomSeed = randomSeed ?? Math.floor(Math.random() * 0xffffffff);
    viewer.setRig('random', { seed: randomSeed });
  } else if (rig === 'mocap') {
    viewer.setRig('mocap', { clip: currentClip });
  } else {
    viewer.setRig(rig);
  }
  $('jointSelect').max = String(viewer.getState().joints - 1);
  $('jointSelect').value = '0';
  viewer.setSelected(0);
}

function setRig(next) {
  if (!RIG_DESCRIPTIONS[next] && next !== 'random' && next !== 'mocap') return;
  if (playing) stopWalkClock();

  rig = next;
  if (next !== 'random') randomSeed = null;
  $('clipRow').hidden = next !== 'mocap';
  $('motionRow').hidden = next === 'mocap';
  buildRig();
  $('rigSelect').value = next;
  const label = next === 'random' ? `${RANDOM_LABEL} #${(randomSeed % 9000 + 1000)}`
    : next === 'mocap' ? 'Mocap humanoid'
    : next.replace(/([A-Z])/g, ' $1');
  $('rigName').textContent = label;
  document.title = `Rig-a-Jig · ${label} — Morphazoid`;
  syncControls();
  updateReadout();
}

function syncControls() {
  const s = settings[currentRigId()];
  $('rateInput').value = String(s.rate);
  $('ampInput').value = String(s.amp);
  $('swayInput').value = String(s.sway);
  $('foldInput').value = String(s.fold);
  $('rateOut').textContent = s.rate.toFixed(2);
  $('ampOut').textContent = s.amp.toFixed(2);
  $('swayOut').textContent = s.sway.toFixed(2);
  $('foldOut').textContent = s.fold.toFixed(2);
}

function updateReadout() {
  const readout = $('modelReadout');
  if (!readout) return; // readout element removed from the stage overlay
  const state = viewer.getState();
  const motion = rig === 'mocap' ? currentClip.replace(/_/g, ' ') : motions[currentRigId()];
  readout.textContent =
    `${(currentRigId()).toUpperCase()} · ${state.joints} joints · ${motion} · `
    + `${playing ? 'playing' : 'paused'} · no mesh`;
}

function setPlaying(value) {
  if (value === playing) return;
  playing = value;
  frozenAt = null;
  if (rig === 'mocap') {
    if (value) viewer.playClip?.(currentClip);
    viewer.setMocapPlaying?.(value);
  } else if (value) startWalkClock(); else stopWalkClock();
  $('playButton').setAttribute('aria-pressed', String(value));
  $('playButton').setAttribute('aria-label', value ? 'Pause motion' : 'Play motion');
  updateReadout();
}

function selectMotion(id, { autoplay = false } = {}) {
  frozenAt = null;
  motions[currentRigId()] = id;
  $('motionSelect').value = id;
  const motion = MOTIONS.find((entry) => entry.id === id);
  if (motion.overlay) {
    overlay = { name: motion.overlay, start: now(), duration: motion.duration };
    viewer.setAction(motion.overlay, now());
    if (armed) {
      audio.engine?.contact(currentRigId(), settings[currentRigId()], {
        index: 0, strength: id === 'jump' || id === 'stomp' ? 1 : 0.55, pan: 0,
      });
    }
    status(`${currentRigId()}: ${motion.label}`);
  } else {
    overlay = null;
    viewer.setAction(null, now());
    if (autoplay) setPlaying(true);
  }
  updateReadout();
}

function createAudioGraph() {
  const Constructor = window.AudioContext || window.webkitAudioContext;
  if (!Constructor) throw new Error('Web Audio is unavailable in this browser.');
  const context = new Constructor({ latencyHint: 'interactive' });
  const master = context.createGain();
  master.gain.value = 0;
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  master.connect(splitter);
  const analysers = [context.createAnalyser(), context.createAnalyser()];
  const buffers = analysers.map((node, channel) => {
    node.fftSize = 512;
    splitter.connect(node, channel);
    node.connect(merger, 0, channel);
    return new Float32Array(node.fftSize);
  });
  merger.connect(context.destination);
  audio.context = context;
  audio.master = master;
  audio.splitter = splitter;
  audio.merger = merger;
  audio.analysers = analysers;
  audio.buffers = buffers;
  audio.engine = createRigAJigAudio(context, master);
  audio.engine.setSelected(true);
}

function updateMeters() {
  if (!armed || !audio.analysers) {
    audio.levels = { left: 0, right: 0 };
    meter.setLevels(0, 0);
    return;
  }
  const values = [0, 1].map((channel) => {
    const samples = audio.buffers[channel];
    audio.analysers[channel].getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    return clamp(Math.sqrt(sum / samples.length) / 0.19, 0, 1);
  });
  audio.levels = {
    left: Math.max(values[0], audio.levels.left * 0.84),
    right: Math.max(values[1], audio.levels.right * 0.84),
  };
  meter.setLevels(audio.levels.left, audio.levels.right);
}

function audioTick() {
  const context = audio.context;
  if (disposed || !armed || context?.state !== 'running') return;
  const time = context.currentTime, target = time + 0.105;
  const from = Math.max(time - 0.006, scheduledUntil);
  const clock = clocks.walk, rate = settings[currentRigId()].rate;
  if (playing) {
    const contacts = Math.max(1, viewer.getState().contacts);
    const stepsPerCycle = Math.max(1, Math.min(8, contacts));
    const fromCycle = motionCycles(clock, rate, from);
    const toCycle = motionCycles(clock, rate, target);
    const first = Math.ceil(fromCycle * stepsPerCycle - 1e-8);
    const last = Math.floor(toCycle * stepsPerCycle + 1e-8);
    for (let index = first; index <= Math.min(first + 16, last); index += 1) {
      const cycle = index / stepsPerCycle;
      const at = clock.anchor + (cycle - clock.cycles) / rate;
      if (at >= time + 0.002 && at <= target + 0.003) {
        audio.engine.contact(currentRigId(), settings[currentRigId()], {
          index: index % contacts, strength: 0.35 + settings[currentRigId()].amp * 0.5,
          pan: ((index % contacts) / Math.max(1, contacts - 1)) * 1.4 - 0.7, at,
        });
      }
    }
  }
  scheduledUntil = target;
}

async function ensureAudio() {
  if (audio.context) return true;
  try { createAudioGraph(); } catch (error) { status(error.message); return false; }
  scheduledUntil = audio.context.currentTime;
  timer = window.setInterval(audioTick, 24);
  return true;
}

async function toggleAudio() {
  if (starting || disposed) return;
  starting = true;
  try {
    if (!armed) {
      if (!(await ensureAudio())) return;
      if (audio.context.state === 'suspended') {
        try { await audio.context.resume(); } catch { /* next gesture */ }
      }
      armed = true;
      audio.master.gain.setTargetAtTime(Number(outputInput.value), audio.context.currentTime, 0.03);
      setAudioVisual(true);
      status(`Rig-a-Jig audio on · ${currentRigId()} joint contacts drive the sound`);
      suspendTimer = window.setInterval(() => {
        if (audio.context?.state === 'suspended' && armed) void audio.context.resume();
      }, 1200);
    } else {
      armed = false;
      if (audio.master) audio.master.gain.setTargetAtTime(0, audio.context.currentTime, 0.025);
      setAudioVisual(false);
      meter.setLevels(0, 0);
      window.clearInterval(suspendTimer);
      suspendTimer = null;
      status('Audio off. Motion continues silently.');
    }
  } finally { starting = false; }
}

function paint() {
  if (disposed || document.hidden) return;
  const time = now();
  const displayHz = playing || overlay ? 30 : 10;
  if (time - lastPaint < 1 / displayHz) { frameId = requestAnimationFrame(paint); return; }
  lastPaint = time;
  // Drive the viewer: base gait only while "walk" is playing; overlays run on top.
  // Gait runs while "walk" is playing; overlays (dance/jump/karate/stomp) run
  // on top via the viewer's action clock. Frozen only when fully paused.
  const pose = poseAt();
  const displayTime = playing || overlay ? time : frozenTime(time);
  if (!playing && !overlay) pose.rate = 0;
  viewer.draw(pose, displayTime);
  updateReadout();
  updateMeters();
  frameId = requestAnimationFrame(paint);
}
let frozenAt = null;
function frozenTime(time) {
  if (frozenAt == null) frozenAt = time;
  return frozenAt;
}

$('rigSelect').addEventListener('change', (event) => setRig(event.target.value));
$('clipSelect').addEventListener('change', (event) => {
  currentClip = event.target.value;
  viewer.playClip(currentClip);
  status(`Mocap: ${currentClip.replace(/_/g, ' ')}`);
});
$('clipSpeed')?.addEventListener('input', (event) => {
  settings.mocap.rate = clamp(Number(event.target.value), 0.05, 2);
  $('clipSpeedOut').textContent = settings.mocap.rate.toFixed(2);
});
$('clipScrub')?.addEventListener('input', (event) => {
  const fraction = Number(event.target.value);
  $('clipScrubOut').textContent = `${Math.round(fraction * 100)}%`;
  viewer.setMocapScrub?.(fraction);
});
$('randomRig').addEventListener('click', () => {
  randomSeed = Math.floor(Math.random() * 0xffffffff);
  setRig('random');
});
$('motionSelect').addEventListener('change', (event) => selectMotion(event.target.value, { autoplay: true }));
$('playButton').addEventListener('click', () => setPlaying(!playing));
$('resetButton').addEventListener('click', () => {
  randomSeed = null;
  setRig(rig === 'random' ? 'spider' : rig);
});
for (const key of ['rate', 'amp', 'sway', 'fold']) {
  $(`${key}Input`).addEventListener('input', (event) => {
    settings[currentRigId()][key] = clamp(Number(event.target.value), 0, key === 'rate' ? 2 : 1);
    $(`${key}Out`).textContent = settings[currentRigId()][key].toFixed(2) + (key === 'rate' ? '×' : '');
    if (key === 'rate' && rig === 'mocap') viewer.setMocapSpeed?.(settings.mocap.rate);
  });
}
$('jointSelect').addEventListener('input', (event) => viewer.setSelected(Number(event.target.value)));
$('strikeButton').addEventListener('click', () => {
  const state = viewer.getState();
  if (armed) audio.engine?.contact(currentRigId(), settings[currentRigId()], { index: state.contacts - 1, strength: 1, pan: 0 });
});
$('viewFront').addEventListener('click', () => viewer.setView('front'));
$('viewSide').addEventListener('click', () => viewer.setView('side'));
$('viewTop').addEventListener('click', () => viewer.setView('top'));
$('zoomIn').addEventListener('click', () => viewer.zoomBy(0.9));
$('zoomOut').addEventListener('click', () => viewer.zoomBy(1.11));

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && event.target === document.body) {
    event.preventDefault();
    setPlaying(!playing);
  }
});
window.addEventListener('pagehide', dispose);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !disposed) {
    cancelAnimationFrame(frameId);
    lastPaint = 0;
    frameId = requestAnimationFrame(paint);
  }
});

function dispose() {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(frameId);
  window.clearInterval(timer);
  window.clearInterval(suspendTimer);
  audio.engine?.dispose();
  audio.context?.close?.();
  viewer.dispose();
}

setRig('mocap');
window.__zooDebug = {
  viewer, getRig: () => rig, getState: () => viewer.getState(),
  rootY: () => viewer.rootJointY(), jointScale: () => viewer.jointSpriteScale(),
};
frameId = requestAnimationFrame(paint);
status('Choose a rig and a motion. Enable Audio to hear joint contacts; press Play to walk.');
