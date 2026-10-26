import { createStereoMeter } from '../../ui/patterns/level-meter.js';
import { createRigAJigViewer } from './rig-a-jig-viewer.js';
import { createRigAJigAudio } from './rig-a-jig-audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const now = () => performance.now() / 1000;

/* Downloaded mocap rigs: bones + AnimationClips from CC0 packs (converted to
 * bones-only and skinned-mesh GLBs). Each plays its real clips through the
 * shared MocapFigure path; ghost body swaps in the skinned mesh. */
const MOCAP_RIGS = {
  mocap: { label: 'Mocap humanoid (Quaternius UAL · CC0)', url: 'assets/rig-a-jig/ual-humanoid-bones.glb', clip: 'Dance_Loop', view: { yaw: 0.25, pitch: 0.16, zoom: 2.6, lookY: 0.85 } },
  kaykit: { label: 'Skeleton (KayKit · CC0)', url: 'assets/rig-a-jig/KayKit_Skeleton_bones.glb', clip: 'Idle_A' },
  cow: { label: 'Cow (Quaternius · CC0)', url: 'assets/rig-a-jig/Cow_bones.glb', skinUrl: 'assets/rig-a-jig/Cow_skinned.glb', clip: 'Walk' },
  horseMocap: { label: 'Horse (Quaternius · CC0)', url: 'assets/rig-a-jig/Horse_bones.glb', skinUrl: 'assets/rig-a-jig/Horse_skinned.glb', clip: 'Walk' },
  llama: { label: 'Llama (Quaternius · CC0)', url: 'assets/rig-a-jig/Llama_bones.glb', skinUrl: 'assets/rig-a-jig/Llama_skinned.glb', clip: 'Idle' },
  pig: { label: 'Pig (Quaternius · CC0)', url: 'assets/rig-a-jig/Pig_bones.glb', skinUrl: 'assets/rig-a-jig/Pig_skinned.glb', clip: 'Idle' },
  pug: { label: 'Pug (Quaternius · CC0)', url: 'assets/rig-a-jig/Pug_bones.glb', skinUrl: 'assets/rig-a-jig/Pug_skinned.glb', clip: 'Idle' },
  sheep: { label: 'Sheep (Quaternius · CC0)', url: 'assets/rig-a-jig/Sheep_bones.glb', skinUrl: 'assets/rig-a-jig/Sheep_skinned.glb', clip: 'Idle' },
  zebra: { label: 'Zebra (Quaternius · CC0)', url: 'assets/rig-a-jig/Zebra_bones.glb', skinUrl: 'assets/rig-a-jig/Zebra_skinned.glb', clip: 'Walk' },
  frogMocap: { label: 'Frog (Easy Enemy · CC0)', url: 'assets/rig-a-jig/Frog_bones.glb', skinUrl: 'assets/rig-a-jig/Frog_skinned.glb', clip: 'Frog_Idle' },
  rat: { label: 'Rat (Easy Enemy · CC0)', url: 'assets/rig-a-jig/Rat_bones.glb', skinUrl: 'assets/rig-a-jig/Rat_skinned.glb', clip: 'Rat_Walk' },
  snakeMocap: { label: 'Snake (Easy Enemy · CC0)', url: 'assets/rig-a-jig/Snake_bones.glb', skinUrl: 'assets/rig-a-jig/Snake_skinned.glb', clip: 'Snake_Walk' },
  spiderMocap: { label: 'Spider (Easy Enemy · CC0)', url: 'assets/rig-a-jig/Spider_bones.glb', skinUrl: 'assets/rig-a-jig/Spider_skinned.glb', clip: 'Spider_Walk' },
  wasp: { label: 'Wasp (Easy Enemy · CC0)', url: 'assets/rig-a-jig/Wasp_bones.glb', skinUrl: 'assets/rig-a-jig/Wasp_skinned.glb', clip: 'Wasp_Flying' },
};
const MOCAP_GROUPS = [
  ['Humanoid & skeleton', ['mocap', 'kaykit']],
  ['Farm animals', ['cow', 'horseMocap', 'llama', 'pig', 'pug', 'sheep', 'zebra']],
  ['Creepy crawlies', ['frogMocap', 'rat', 'snakeMocap', 'spiderMocap', 'wasp']],
];

const defaultSettings = () => ({ rate: 0.35, amp: 0.5, sway: 0.3, fold: 0.5 });
const settings = Object.fromEntries(Object.keys(MOCAP_RIGS).map((id) => [id, defaultSettings()]));
let rig = 'mocap';
let armed = false, starting = false, disposed = false, playing = false;
let frameId = 0, lastPaint = 0, timer = null, suspendTimer = null, scheduledUntil = 0;
let walkAnchor = 0, walkCycles = 0;
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

/* Build the rig dropdown with grouped mocap options. */
const rigSelect = $('rigSelect');
for (const [label, ids] of MOCAP_GROUPS) {
  const optgroup = document.createElement('optgroup');
  optgroup.label = label;
  for (const id of ids) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = MOCAP_RIGS[id].label;
    optgroup.append(option);
  }
  rigSelect.append(optgroup);
}

let currentClip = MOCAP_RIGS.mocap.clip;
const rigClips = Object.fromEntries(Object.entries(MOCAP_RIGS).map(([id, def]) => [id, def.clip]));
const viewer = createRigAJigViewer($('zooCanvas'), {
  onJointGrab({ joint }) {
    $('jointSelect').value = String(joint);
    viewer.setSelected(joint);
    if (armed) audio.engine?.contact(rig, settings[rig], { index: joint, strength: 0.7, pan: 0 });
  },
  onFinish({ joint, moved, cancelled }) {
    if (joint >= 0 && !moved && !cancelled && armed) {
      audio.engine?.contact(rig, settings[rig], { index: joint, strength: 0.9, pan: 0 });
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
    clipPicker.rebuild();
    viewer.playClip(currentClip);
    if (playing) viewer.setMocapPlaying?.(true);
    applyGhostParams();
    $('jointSelect').max = String(viewer.getState().joints - 1);
    updateReadout();
  },
  onRigError(error) {
    status(`Mocap rig could not load: ${error?.message ?? error}. Other rigs still work.`);
  },
});

function buildRig() {
  const def = MOCAP_RIGS[rig];
  const ghost = bodyMode === 'ghost' && def.skinUrl;
  viewer.setRig(rig, { url: ghost ? def.skinUrl : def.url, clip: currentClip, view: def.view, ghost });
  $('jointSelect').max = String(viewer.getState().joints - 1);
  $('jointSelect').value = '0';
  viewer.setSelected(0);
}

function setRig(next) {
  if (!MOCAP_RIGS[next]) return;
  rig = next;
  currentClip = rigClips[next] ?? MOCAP_RIGS[next].clip;
  buildRig();
  $('rigSelect').value = next;
  $('rigSelect').dispatchEvent(new Event('picker:sync'));
  const label = MOCAP_RIGS[next].label;
  $('rigName').textContent = label;
  document.title = `Rig-a-Jig · ${label} — Morphazoid`;
  syncControls();
  updateReadout();
}

function syncControls() {
  const s = settings[rig];
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
  readout.textContent =
    `${rig.toUpperCase()} · ${state.joints} joints · ${currentClip.replace(/_/g, ' ')} · `
    + `${playing ? 'playing' : 'paused'}`;
}

function setPlaying(value) {
  if (value === playing) return;
  playing = value;
  if (value) {
    viewer.playClip?.(currentClip);
    walkAnchor = now();
  }
  viewer.setMocapPlaying?.(value);
  $('playButton').setAttribute('aria-pressed', String(value));
  $('playButton').setAttribute('aria-label', value ? 'Pause motion' : 'Play motion');
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
  scheduledUntil = target;
  if (!playing) return;
  // Drive contact accents from the clip's footfalls: sample the contact speeds.
  const state = viewer.getState();
  const contacts = Math.max(1, state.contacts);
  const rate = settings[rig].rate;
  walkCycles = (time - walkAnchor) * rate;
  const stepsPerCycle = Math.max(1, Math.min(8, contacts));
  const index = Math.floor(walkCycles * stepsPerCycle);
  if (index !== audioTick._last) {
    audioTick._last = index;
    audio.engine.contact(rig, settings[rig], {
      index: index % contacts, strength: 0.3 + settings[rig].amp * 0.5,
      pan: ((index % contacts) / Math.max(1, contacts - 1)) * 1.4 - 0.7, at: time + 0.01,
    });
  }
}

async function ensureAudio() {
  if (audio.context) return true;
  try { createAudioGraph(); } catch (error) { status(error.message); return false; }
  scheduledUntil = audio.context.currentTime;
  timer = window.setInterval(audioTick, 40);
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
      status(`Rig-a-Jig audio on · ${rig} joint contacts drive the sound`);
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
  const displayHz = playing ? 30 : 10;
  if (time - lastPaint < 1 / displayHz) { frameId = requestAnimationFrame(paint); return; }
  lastPaint = time;
  const pose = { ...settings[rig] };
  viewer.draw(pose, time);
  updateReadout();
  updateMeters();
  frameId = requestAnimationFrame(paint);
}

/* Cycle a <select> through its enabled option values (optgroup-aware) and
 * fire the same handler a manual choice would. */
function optionValues(select) {
  return [...select.querySelectorAll('option')].filter((o) => !o.disabled).map((o) => o.value);
}
function stepSelect(select, delta) {
  const values = optionValues(select);
  if (!values.length) return null;
  const index = values.indexOf(select.value);
  const next = values[(index + delta + values.length) % values.length];
  select.value = next;
  select.dispatchEvent(new Event('picker:sync'));
  return next;
}
function randomOption(select) {
  const values = optionValues(select);
  if (!values.length) return null;
  let next = select.value;
  if (values.length > 1) {
    while (next === select.value) next = values[Math.floor(Math.random() * values.length)];
  }
  select.value = next;
  select.dispatchEvent(new Event('picker:sync'));
  return next;
}

/* A faves-style picker: a details/summary dropdown that mirrors a hidden
 * <select>, with the trigger showing the current label. Selecting a row drives
 * the same handler a manual choice would. */
function buildPicker({ pickerId, listId, currentId, select, onChoose }) {
  const picker = $(pickerId);
  const list = $(listId);
  const current = $(currentId);
  const paint = () => {
    const selected = select.selectedOptions?.[0];
    current.textContent = selected ? selected.textContent : '';
    list.querySelectorAll('button[data-value]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.value === select.value));
    });
  };
  const build = () => {
    list.replaceChildren();
    for (const child of select.children) {
      if (child.tagName === 'OPTGROUP') {
        const heading = document.createElement('div');
        heading.className = 'rig-a-jig-picker-group';
        heading.textContent = child.label;
        list.append(heading);
        for (const option of child.querySelectorAll('option')) addOption(option);
      } else if (child.tagName === 'OPTION') {
        addOption(child);
      }
    }
    paint();
  };
  function addOption(option) {
    const row = document.createElement('div');
    row.className = 'instrument-picker-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'instrument-picker-link';
    button.dataset.value = option.value;
    button.textContent = option.textContent;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      select.value = option.value;
      picker.open = false;
      onChoose(option.value);
      paint();
    });
    row.append(button);
    list.append(row);
  }
  document.addEventListener('click', (event) => {
    if (picker.open && !picker.contains(event.target)) picker.open = false;
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') picker.open = false;
  });
  select.addEventListener('picker:sync', paint);
  build();
  return { paint, rebuild: build };
}

buildPicker({
  pickerId: 'rigPicker', listId: 'rigPickerList', currentId: 'rigPickerCurrent',
  select: rigSelect, onChoose: (value) => setRig(value),
});
const clipPicker = buildPicker({
  pickerId: 'clipPicker', listId: 'clipPickerList', currentId: 'clipPickerCurrent',
  select: $('clipSelect'), onChoose: (value) => {
    currentClip = value;
    rigClips[rig] = currentClip;
    viewer.playClip(currentClip);
    status(`${MOCAP_RIGS[rig].label}: ${currentClip.replace(/_/g, ' ')}`);
  },
});

$('rigSelect').addEventListener('change', (event) => setRig(event.target.value));
$('nextRig').addEventListener('click', () => { const v = stepSelect(rigSelect, 1); if (v) setRig(v); });
$('diceRig').addEventListener('click', () => { const v = randomOption(rigSelect); if (v) setRig(v); });

let bodyMode = 'off', ghostOpacity = 0.16, ghostWireframe = false;
function applyGhostParams() {
  viewer.setGhostOpacity?.(ghostOpacity);
  viewer.setGhostWireframe?.(ghostWireframe);
}

$('bodySelect').addEventListener('change', (event) => {
  bodyMode = event.target.value;
  $('ghostControls').hidden = bodyMode !== 'ghost';
  buildRig();
  if (playing) { viewer.playClip?.(currentClip); viewer.setMocapPlaying?.(true); }
  applyGhostParams();
});

$('ghostOpacity').addEventListener('input', (event) => {
  ghostOpacity = Number(event.target.value);
  $('ghostOpacityOut').textContent = `${Math.round(ghostOpacity * 100)}%`;
  viewer.setGhostOpacity?.(ghostOpacity);
});
$('ghostWireframe').addEventListener('change', (event) => {
  ghostWireframe = event.target.checked;
  viewer.setGhostWireframe?.(ghostWireframe);
});

$('clipSelect').addEventListener('change', (event) => {
  currentClip = event.target.value;
  rigClips[rig] = currentClip;
  viewer.playClip(currentClip);
  status(`${MOCAP_RIGS[rig].label}: ${currentClip.replace(/_/g, ' ')}`);
});
$('nextClip').addEventListener('click', () => {
  const v = stepSelect($('clipSelect'), 1);
  if (v) { currentClip = v; rigClips[rig] = v; viewer.playClip(v); $('clipSelect').dispatchEvent(new Event('picker:sync')); }
});
$('diceClip').addEventListener('click', () => {
  const v = randomOption($('clipSelect'));
  if (v) { currentClip = v; rigClips[rig] = v; viewer.playClip(v); $('clipSelect').dispatchEvent(new Event('picker:sync')); }
});
$('clipSpeed')?.addEventListener('input', (event) => {
  settings[rig].rate = clamp(Number(event.target.value), 0.05, 2);
  $('clipSpeedOut').textContent = settings[rig].rate.toFixed(2);
});
$('clipScrub')?.addEventListener('input', (event) => {
  const fraction = Number(event.target.value);
  $('clipScrubOut').textContent = `${Math.round(fraction * 100)}%`;
  viewer.setMocapScrub?.(fraction);
});
$('playButton').addEventListener('click', () => setPlaying(!playing));
$('resetButton').addEventListener('click', () => setRig(rig));
for (const key of ['rate', 'amp', 'sway', 'fold']) {
  $(`${key}Input`).addEventListener('input', (event) => {
    settings[rig][key] = clamp(Number(event.target.value), 0, key === 'rate' ? 2 : 1);
    $(`${key}Out`).textContent = settings[rig][key].toFixed(2) + (key === 'rate' ? '×' : '');
    if (key === 'rate') viewer.setMocapSpeed?.(settings[rig].rate);
  });
}
$('jointSelect').addEventListener('input', (event) => viewer.setSelected(Number(event.target.value)));
$('strikeButton').addEventListener('click', () => {
  const state = viewer.getState();
  if (armed) audio.engine?.contact(rig, settings[rig], { index: state.contacts - 1, strength: 1, pan: 0 });
});
$('viewFront').addEventListener('click', () => viewer.setView('front'));
$('viewSide').addEventListener('click', () => viewer.setView('side'));
$('viewTop').addEventListener('click', () => viewer.setView('top'));
$('zoomIn').addEventListener('click', () => viewer.zoomBy(0.9));
$('fitView').addEventListener('click', () => viewer.fitToScreen());
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
status('Choose a rig and a clip. Enable Audio to hear joint contacts; press Play.');
