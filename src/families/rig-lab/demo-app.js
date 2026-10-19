import { createAudioStrip } from '../../ui/patterns/audio-strip.js';
import { createStereoMeter } from '../../ui/patterns/level-meter.js';
import { ANT_DEFAULTS, antFootContacts, antPose, antSettings } from '../../instruments/ant-farm/demo-model.js';
import { createAntDemoAudio } from '../../instruments/ant-farm/demo-audio.js';
import { FOAM_DEFAULTS, foamPose, foamSettings, voronoiCells } from '../../instruments/voronoi-foam/demo-model.js';
import { createFoamDemoAudio } from '../../instruments/voronoi-foam/demo-audio.js';
import { LATTICE_DEFAULTS, latticePose, latticeSettings, latticeStructure } from '../../instruments/polyhedral-lattice/demo-model.js';
import { createLatticeDemoAudio } from '../../instruments/polyhedral-lattice/demo-audio.js';
import { OCTOPUS_DEFAULTS, octopusPose, octopusSettings } from '../../instruments/octopus/demo-model.js';
import { createOctopusDemoAudio } from '../../instruments/octopus/demo-audio.js';
import { PANCAKE_DEFAULTS, pancakeSettings, pancakeTransition } from '../../instruments/pancakes/demo-model.js';
import { createPancakeDemoAudio } from '../../instruments/pancakes/demo-audio.js';
import { MOSQUITO_DEFAULTS, mosquitoPose, mosquitoSettings } from '../../instruments/mosquito/demo-model.js';
import { createMosquitoDemoAudio } from '../../instruments/mosquito/demo-audio.js';
import { MOTH_DEFAULTS, mothPose, mothSettings, mothBrushRidges } from '../../instruments/moth/demo-model.js';
import { createMothDemoAudio } from '../../instruments/moth/demo-audio.js';
import { createRigLabViewer } from './demo-viewer.js';
import { motionClock, motionCycles, rebaseMotion } from './demo-motion.js';
import { animatedRigSettings, KITCHEN_SCENE_CONTACTS, pancakeScenePose,
  rigLabScene, rigLabScenes } from './demo-presets.js';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const now = () => performance.now() / 1000;
const ids = ['ant-farm', 'voronoi-foam', 'polyhedral-lattice', 'octopus', 'pancakes', 'mosquito', 'moth'];
const metadata = {
  'ant-farm': {
    title: 'Ant farm', play: 'Walk ants', pause: 'Pause ants',
    intro: 'Guide three downloaded, jointed ants. Food, trails and chambers shape their path and sound, but no handmade habitat is displayed.',
    help: 'Drag a downloaded ant to guide it · empty space: orbit · arrows: guide selected ant · Enter: sound chamber.',
    canvas: 'Three downloaded 3D ants. Drag an ant to guide it; drag empty space to orbit the camera.',
  },
  'voronoi-foam': {
    title: 'Voronoi foam', play: 'Sweep cells', pause: 'Pause sweep',
    intro: 'Grow 2–12 actual 3D Voronoi cells inside a cube, octahedron or icosahedron. Pull a seed: shared faces, volume and its pitch change together.',
    help: 'Drag a seed to reshape its cell and neighbors · choose boundary and cell count · empty space: orbit · arrows: move seed · Enter: sound cell.',
    canvas: 'Live clipped Three.js Voronoi cells. Drag a seed to reshape its real surfaces, or empty space to orbit.',
  },
  'polyhedral-lattice': {
    title: 'Polyhedral lattice', play: 'Pulse joints', pause: 'Pause pulse',
    intro: 'Choose a solid, grow 1–4 connected units and subdivide to add real editable vertices on the fly. Pull a joint: its struts, faces and pitch move together.',
    help: 'Choose polyhedron and vertex detail · drag any generated joint · empty space: orbit · arrows: pull joint · Enter: pluck.',
    canvas: 'Procedural deformable Three.js polyhedra. Add vertices with Subdivision; drag a joint to bend the live faces and struts.',
  },
  octopus: {
    title: 'Octopus', play: 'Pulse mantle', pause: 'Pause mantle',
    intro: 'Give Dirk.z’s downloaded 128-bone creature a reef, abyss, pearl or kelp UV-mapped skin. Adjust its PBR sheen; squeeze the mantle or play eight appendages.',
    help: 'Drag the downloaded mantle or an appendage tip · empty space: orbit · Enter: pulse mantle.',
    canvas: 'Downloaded skinned octopus. Drag its mantle or one of eight appendages, or empty space to orbit.',
  },
  pancakes: {
    title: 'Pancakes', play: 'Cook sizzle', pause: 'Pause cooking',
    intro: 'Use the downloaded pan, spatula, butter and four source cakes (reused for six). Stack the cakes on the imported plate or add the imported syrup.',
    help: 'Drag the downloaded spatula to scoop/stack · tap plate to stack · pan handle: tilt · butter: tap to add · Enter: flip.',
    canvas: '3D frying pan, individual stackable pancakes, spatula and butter. Drag the flipper to the plate; drag empty space to orbit.',
  },
  mosquito: {
    title: 'Mosquito', play: 'Play flight', pause: 'Pause flight',
    intro: 'Play the downloaded textured mosquito: steer its body, hinge both wings, curl six legs and bend the proboscis.',
    help: 'Drag wing for rate and stroke · leg to curl the airy tone · body to steer · proboscis to bend · empty space: orbit.',
    canvas: '3D skinned textured mosquito. Drag a wing, leg, body or proboscis to play; drag empty space to orbit.',
  },
  moth: {
    title: 'Moth', play: 'Play source clip', pause: 'Pause source clip',
    intro: 'Play the downloaded moth’s original full-rig animation. Fold either wing over its native motion, or brush the membranes for papery left and right voices.',
    help: 'Play: original wing/body clip · Fold: drag either wing over it · Brush: sweep ridges · empty space: orbit.',
    canvas: '3D rigged moth. Drag a wing to fold it or enable Brush to stroke its ridges; drag empty space to orbit.',
  },
};
const defaults = {
  'ant-farm': ANT_DEFAULTS, 'voronoi-foam': FOAM_DEFAULTS,
  'polyhedral-lattice': LATTICE_DEFAULTS, octopus: OCTOPUS_DEFAULTS,
  pancakes: PANCAKE_DEFAULTS, mosquito: MOSQUITO_DEFAULTS, moth: MOTH_DEFAULTS,
};
const validators = {
  'ant-farm': antSettings, 'voronoi-foam': foamSettings, 'polyhedral-lattice': latticeSettings,
  octopus: octopusSettings, pancakes: pancakeSettings, mosquito: mosquitoSettings, moth: mothSettings,
};
const rates = {
  'ant-farm': 'travelRate', 'voronoi-foam': 'sweepRate',
  'polyhedral-lattice': 'pulseRate', octopus: 'pulseRate', pancakes: 'cookRate',
  mosquito: 'flightRate', moth: 'flapRate',
};
const abort = new AbortController(), signal = abort.signal;
const listen = (element, type, callback) => element?.addEventListener(type, callback, { signal });
let model = 'ant-farm';
const settings = Object.fromEntries(ids.map((id) => [id, validators[id](defaults[id])]));
const sceneSelection = Object.fromEntries(ids.map((id) => [id, rigLabScenes(id)[0].id]));
const animationMode = Object.fromEntries(ids.map((id) =>
  [id, rigLabScenes(id)[0].animation]));
const clocks = Object.fromEntries(ids.map((id) => [id, motionClock()]));
let foamCells = voronoiCells(settings['voronoi-foam']);
let armed = false, starting = false, disposed = false, generation = 0, epoch = 0;
let gesture = null, manualUntil = 0, selectedWing = 'left';
let lastMothExciter = 0, lastManualSound = 0, lastHud = 0;
let scheduledUntil = 0, timer = null, suspendTimer = null, frameId = 0;
let lastPaint = 0, lastMeterAt = 0;
let flightAt = null, flightCake = null, landing = null;
const wing = { time: now(), phase: 0, pitch: settings.mosquito.wingRate };
const audio = { context: null, master: null, splitter: null, merger: null,
  analysers: null, buffers: null, buses: {}, engines: {}, levels: { left: 0, right: 0 } };
const meter = createStereoMeter({ ariaLabel: 'Rig lab stereo output', active: false });
const strip = createAudioStrip({
  buttonId: 'audioButton', levelId: 'level', level: 0.42, min: 0, max: 0.8, step: 0.01,
  levelLabel: 'Output', onAudioClick: () => { void toggleAudio(); },
  onLevelInput(value) {
    if (armed && audio.master) audio.master.gain.setTargetAtTime(value, audio.context.currentTime, 0.025);
  },
});
$('audioSlot').replaceChildren(meter, strip);
const status = (message) => { $('liveStatus').textContent = message; };
const rateFor = (id) => settings[id][rates[id]];
const activeEngine = (id = model) => armed ? audio.engines[id] : null;
let viewer;
try {
  viewer = createRigLabViewer($('rigCanvas'), {
    onStart: beginGesture, onEdit: editGesture, onBrush: brushGesture,
    onFinish: endGesture, onKeyboard: keyboardGesture,
    onAssetStatus: (message, assetState) => {
      $('assetStatus').textContent = message;
      const notice = $('stageModelStatus');
      notice.hidden = assetState === 'ready';
      if (assetState === 'loading') notice.textContent = message;
      if (assetState === 'error') notice.textContent =
        'This download could not be loaded. No substitute 3D model is shown; the sound controls still work.';
    },
  });
} catch (error) {
  $('rigCanvas').hidden = true;
  $('stageModelStatus').textContent = '3D preview unavailable. The sound controls still work.';
  status(`3D preview unavailable: ${error.message}. You can still use the labelled sound controls.`);
  viewer = {
    setModel() {}, setBrushMode() {}, setAntStyle() {},
    setView() {}, zoomBy() {}, flashWing() {},
    draw() {}, dispose() {}, screenPoint() { return null; },
    getState() { return { unavailable: true, frames: 0 }; },
  };
}

function poseAt(id = model, time = now()) {
  const cycles = motionCycles(clocks[id], rateFor(id), time);
  const playing = clocks[id].playing;
  const values = id === 'pancakes' ? settings[id]
    : animatedRigSettings(id, settings[id], cycles, playing, animationMode[id]);
  switch (id) {
    case 'ant-farm': return antPose(values, cycles, playing, animationMode[id]);
    case 'voronoi-foam':
      return foamPose(values, playing ? voronoiCells(values) : foamCells, cycles, playing);
    case 'polyhedral-lattice': return latticePose(values, cycles, playing);
    case 'octopus': return octopusPose(values, cycles, playing);
    case 'pancakes':
      return pancakeScenePose(values, cycles, playing, animationMode[id],
        time, flightAt, flightCake);
    case 'mosquito':
      return mosquitoPose(values, cycles, time, playing || time < manualUntil,
        null, playing);
    case 'moth': return mothPose(values, cycles, playing);
    default: return null;
  }
}
function readout(pose) {
  switch (model) {
    case 'ant-farm':
      return `ANT FARM · ${pose.colony.length} downloaded ants · ${clocks[model].playing
        ? animationMode[model] === 'dig' ? 'digging' : 'walking' : 'still'}`;
    case 'voronoi-foam':
      return `FOAM · ${pose.cells.length} live ${pose.shape} cells · ${Math.round(pose.frequencies[pose.selected])} Hz`;
    case 'polyhedral-lattice':
      return `LATTICE · ${pose.nodes.length} live vertices · ${pose.shape} · joint ${pose.selected + 1}`;
    case 'octopus': return `OCTOPUS · ${pose.skin} skin · appendage ${pose.selected + 1} · ${Math.round(pose.arms[pose.selected].frequency)} Hz`;
    case 'pancakes':
      return `PANCAKES · ${pose.stackCount}/${pose.cakes.length} stacked · #${pose.selected + 1} ${pose.airborne ? 'flipping' : pose.cakes[pose.selected].place}`;
    case 'mosquito': return `MOSQUITO · ${Math.round(pose.pitchHz)} Hz wing tone · leg ${settings.mosquito.selectedLeg + 1} · ${clocks[model].playing ? 'flying' : 'manual'}`;
    case 'moth': return `MOTH · ${Math.round(pose.leftHz)} / ${Math.round(pose.rightHz)} Hz wing modes · original clip`;
    default: return '';
  }
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
  // Short contacts should remain visible without freezing their actual sound.
  audio.levels = {
    left: Math.max(values[0], audio.levels.left * 0.84),
    right: Math.max(values[1], audio.levels.right * 0.84),
  };
  meter.setLevels(audio.levels.left, audio.levels.right);
}
function paint() {
  if (disposed || document.hidden) return;
  const time = now();
  // The static scene and 2K PBR texture can saturate software WebGL; do not
  // let display frames take the CPU from the audio-clock scheduler.
  // A stationary downloaded mesh needs fewer redraws, especially while a
  // paused rig's brief contact is playing. Restore the full interaction rate
  // for drags, flight and Play; audio keeps its independent 24 ms timer.
  const moving = clocks[model].playing || gesture ||
    model === 'mosquito' && time < manualUntil ||
    model === 'pancakes' && flightAt != null && time - flightAt < 0.68;
  // Detail two on four solids has 648 real joints. Throttle drawing before
  // it can compete with the audio-clock scheduler on software WebGL.
  const denseLattice = model === 'polyhedral-lattice' &&
    settings[model].detail === 2 && settings[model].unitCount >= 3;
  const displayHz = moving ? (denseLattice ? 20 : 30) : 12;
  if (time - lastPaint < 1 / displayHz) {
    frameId = requestAnimationFrame(paint);
    return;
  }
  lastPaint = time;
  let pose = poseAt(model, time);
  if (model === 'mosquito') {
    const elapsed = Math.max(0, time - wing.time);
    wing.phase = (wing.phase + elapsed * (wing.pitch + pose.pitchHz) * 0.5) % 1;
    wing.time = time;
    wing.pitch = pose.pitchHz;
    const cycles = motionCycles(clocks.mosquito, rateFor('mosquito'), time);
    const animated = animatedRigSettings('mosquito', settings.mosquito, cycles,
      clocks.mosquito.playing, animationMode.mosquito);
    pose = mosquitoPose(animated, cycles, time, pose.flutter,
      wing.phase, clocks.mosquito.playing);
  }
  viewer.draw(pose, time);
  if (time - lastHud > 0.12) {
    $('modelReadout').textContent = readout(pose);
    lastHud = time;
  }
  frameId = requestAnimationFrame(paint);
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
  const buses = Object.fromEntries(ids.map((id) => {
    const bus = context.createGain();
    bus.gain.value = id === model ? 1 : 0;
    bus.connect(master);
    return [id, bus];
  }));
  audio.context = context;
  audio.master = master;
  audio.splitter = splitter;
  audio.merger = merger;
  audio.analysers = analysers;
  audio.buffers = buffers;
  audio.buses = buses;
  audio.engines = {
    'ant-farm': createAntDemoAudio(context, buses['ant-farm']),
    'voronoi-foam': createFoamDemoAudio(context, buses['voronoi-foam']),
    'polyhedral-lattice': createLatticeDemoAudio(context, buses['polyhedral-lattice']),
    octopus: createOctopusDemoAudio(context, buses.octopus),
    pancakes: createPancakeDemoAudio(context, buses.pancakes),
    mosquito: createMosquitoDemoAudio(context, buses.mosquito),
    moth: createMothDemoAudio(context, buses.moth),
  };
}
/** Schedule from the AudioContext clock. A stalled paint cannot cause late attacks. */
function audioTick() {
  const context = audio.context;
  if (disposed || !armed || context?.state !== 'running') return;
  const time = context.currentTime, target = time + 0.105;
  const from = Math.max(time - 0.006, scheduledUntil);
  const id = model, engine = audio.engines[id];
  const clock = clocks[id], rate = rateFor(id);
  const schedule = (steps, callback, offset = 0) => {
    if (!clock.playing) return;
    const first = Math.ceil((motionCycles(clock, rate, from + epoch) - offset) * steps - 1e-8);
    const last = Math.floor((motionCycles(clock, rate, target + epoch) - offset) * steps + 1e-8);
    for (let index = first; index <= Math.min(first + 14, last); index += 1) {
      const cycle = offset + index / steps;
      const at = clock.anchor + (cycle - clock.cycles) / rate - epoch;
      if (at >= time + 0.002 && at <= target + 0.003) callback(index, at, cycle);
    }
  };
  switch (id) {
    case 'ant-farm': {
      const fromCycle = motionCycles(clock, rate, from + epoch);
      const toCycle = motionCycles(clock, rate, target + epoch);
      for (let ant = 0; ant < 3; ant += 1) {
        if (animationMode[id] === 'dig') {
          schedule(4, (_index, at, cycle) => {
            const pose = antPose(settings[id], cycle, true, 'dig');
            engine.foot(ant, pose.colony[ant], at);
          }, -ant / 3);
        } else for (const contact of antFootContacts(fromCycle, toCycle, ant)) {
          const at = clock.anchor + (contact.cycle - clock.cycles) / rate - epoch;
          if (at < time + 0.002 || at > target + 0.003) continue;
          // Body, imported leg phase and audible tripod share this cycle.
          const pose = antPose(settings[id], contact.cycle, true, 'walk');
          engine.foot(ant, pose.colony[ant], at);
        }
      }
      if (animationMode[id] === 'walk') for (const [offset, chamber] of [[0.44, 1], [0.94, 0]]) {
        schedule(1, (_index, at) =>
          engine.chamber(chamber, settings[id].chamberSize, at), offset);
      }
      break;
    }
    case 'voronoi-foam':
      for (const cell of foamCells) {
        schedule(1, (_index, at) =>
          engine.hit(poseAt(id, at + epoch).cells[cell.id], at),
          clamp((cell.center[0] + 1) / 2, 0, 0.999));
      }
      break;
    case 'polyhedral-lattice':
      schedule(12, (index, at) => {
        const pose = poseAt(id, at + epoch);
        engine.pluck(pose, ((index % pose.nodes.length) + pose.nodes.length) % pose.nodes.length, at);
      });
      break;
    case 'octopus':
      schedule(1, (index, at) => {
        const pose = poseAt(id, at + epoch);
        engine.mantle(pose, at);
        engine.arm(pose, ((index % 8) + 8) % 8, at + 0.057);
      });
      break;
    case 'pancakes': {
      engine.update(poseAt(id, time + epoch));
      if (animationMode[id] === 'flip-stack') for (const { phase, kind } of KITCHEN_SCENE_CONTACTS) {
        schedule(1, (_index, at) => {
          const syrup = settings.pancakes.cakes.find((cake) => cake.place === 'pan')?.syrup ?? 0;
          if (kind === 'land') engine.land({ at, syrup, speed: 0.7 });
          if (kind === 'scoop') engine.scoop({ at });
          if (kind === 'stack') engine.stack({ at, syrup,
            layer: settings.pancakes.cakes.filter((cake) => cake.place === 'plate').length });
          if (kind === 'peel') engine.peel(syrup, at);
        }, phase);
      }
      if (landing) {
        const at = landing.at - epoch;
        if (at < time - 0.012) landing = null;
        else if (at <= target && at >= time + 0.002) {
          engine.land({ at, syrup: landing.syrup, speed: landing.speed });
          landing = null;
        }
      }
      break;
    }
    case 'mosquito': {
      const pose = poseAt(id, time + epoch);
      engine.update(pose, pose.stroke, clock.playing || time + epoch < manualUntil);
      break;
    }
    case 'moth':
      // The source's downstroke is near phase .25 and its upstroke near .75.
      // Accent alternate sides without inventing an unrelated wing tempo.
      schedule(2, (index, at) => {
        const pose = poseAt(id, at + epoch);
        engine.trigger(index % 2 === 0 ? 'left' : 'right', pose,
          { strength: 0.48, ridge: 1, at });
      }, 0.25);
      break;
    default: break;
  }
  if (time - lastMeterAt > 0.045) {
    updateMeters();
    lastMeterAt = time;
  }
  scheduledUntil = target;
}
async function toggleAudio() {
  if (disposed) return;
  if (armed || starting) { silenceAudio(); return; }
  clearTimeout(suspendTimer);
  starting = true;
  strip.setAudioState('starting');
  const attempt = ++generation;
  try {
    if (!audio.context) createAudioGraph();
    // Explicit Audio click owns this resume. Neither Play nor a pointer edit creates Web Audio.
    await audio.context.resume();
    if (disposed || attempt !== generation) return;
    epoch = now() - audio.context.currentTime;
    armed = true; starting = false;
    audio.master.gain.setTargetAtTime(strip.level, audio.context.currentTime, 0.025);
    audio.engines.moth.setSelected(model === 'moth');
    strip.setAudioState('on');
    meter.setActive(true);
    scheduledUntil = audio.context.currentTime;
    lastMeterAt = audio.context.currentTime - 1;
    timer = setInterval(audioTick, 24);
    audioTick();
    status(clocks[model].playing
      ? 'Audio joined the moving rig.' : 'Audio on. Drag a part, use its action buttons or press Play.');
  } catch (error) {
    if (disposed || attempt !== generation) return;
    starting = false; armed = false;
    strip.setAudioState('error');
    status(`Audio unavailable: ${error.message}`);
  }
}
function silenceAudio() {
  ++generation;
  armed = false; starting = false;
  clearInterval(timer); timer = null;
  clearTimeout(suspendTimer);
  for (const engine of Object.values(audio.engines)) engine.silence?.();
  audio.engines.moth?.setSelected(false);
  if (audio.context && audio.master) {
    const context = audio.context;
    audio.master.gain.setTargetAtTime(0, context.currentTime, 0.025);
    suspendTimer = setTimeout(() => {
      if (!armed && audio.context === context && context.state === 'running') void context.suspend();
    }, 190);
  }
  strip.setAudioState('off');
  meter.setActive(false);
  updateMeters();
  status(clocks[model].playing ? 'Audio off. Motion continues silently.' : 'Audio off. The rigs are still movable.');
}

function setPlaying(playing) {
  const time = now();
  if (clocks[model].playing === Boolean(playing)) return;
  clocks[model] = rebaseMotion(clocks[model], rateFor(model), time, playing);
  manualUntil = 0;
  scheduledUntil = audio.context?.currentTime ?? 0;
  if (!playing) {
    audio.engines.mosquito?.silence();
    audio.engines.pancakes?.silence();
  }
  syncTransport();
  status(playing
    ? `${metadata[model].play}${armed ? '.' : ' (silent until you turn on Audio).'}`
    : 'Motion paused. You can still manipulate the rig.');
}
function syncTransport() {
  const playing = clocks[model].playing;
  const digging = model === 'ant-farm' && animationMode[model] === 'dig';
  $('playButton').textContent = digging ? playing ? 'Pause digging' : 'Dig site'
    : playing ? metadata[model].pause : metadata[model].play;
  $('playButton').setAttribute('aria-pressed', String(playing));
  $('playButton').setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${metadata[model].title} motion`);
}
function valueFor(id, field) {
  const state = settings[id];
  if (id === 'voronoi-foam' && field.startsWith('seed')) {
    return state.seeds[state.selected][{ seedX: 0, seedY: 1, seedZ: 2 }[field]];
  }
  if (id === 'octopus' && field === 'length') return state.lengths[state.selected];
  if (id === 'octopus' && field === 'curl') return state.curls[state.selected];
  if (id === 'mosquito' && field === 'legCurl') return state.legs[state.selectedLeg];
  return state[field];
}
function syncChoices() {
  const foam = $('foamSelected'), cellCount = settings['voronoi-foam'].count;
  if (foam.options.length !== cellCount) {
    foam.replaceChildren(...Array.from({ length: cellCount }, (_, index) =>
      new Option(`Cell ${index + 1}`, String(index))));
  }
  const state = settings['polyhedral-lattice'];
  const lattice = $('latticeSelected'), structure = latticeStructure(state);
  const signature = `${state.shape}:${state.unitCount}:${state.detail}`;
  if (lattice.dataset.signature !== signature) {
    lattice.replaceChildren(...Array.from({ length: structure.restNodes.length }, (_, index) =>
      new Option(`Solid ${Math.floor(index / structure.verticesPerUnit) + 1} · vertex ${index % structure.verticesPerUnit + 1}`,
        String(index))));
    lattice.dataset.signature = signature;
  }
  const cakes = settings.pancakes.cakes, pancake = $('panSelected');
  const cakeSignature = cakes.map((cake) => `${cake.place}:${cake.order}`).join(',');
  if (pancake.dataset.signature !== cakeSignature) {
    const layers = cakes.map((cake, id) => ({ cake, id }))
      .filter(({ cake }) => cake.place === 'plate')
      .sort((a, b) => a.cake.order - b.cake.order)
      .map(({ id }) => id);
    pancake.replaceChildren(...cakes.map((cake, index) => new Option(
      `Cake ${index + 1} · ${cake.place === 'plate' ? `stack layer ${layers.indexOf(index) + 1}` : cake.place}`,
      String(index))));
    pancake.dataset.signature = cakeSignature;
  }
}
function syncSceneChoices() {
  const select = $('rigScene'), scenes = rigLabScenes(model);
  const custom = sceneSelection[model] === 'custom';
  if (select.dataset.model !== model || select.options.length !== scenes.length + Number(custom)) {
    select.replaceChildren(...scenes.map((scene) => new Option(scene.label, scene.id)));
    if (custom) select.add(new Option('Custom · edited controls', 'custom'));
    select.dataset.model = model;
  }
  select.value = sceneSelection[model];
  $('sceneDescription').textContent = custom
    ? 'Custom rig pose. The selected motion continues; use Play to watch your edits over time.'
    : rigLabScene(model, sceneSelection[model])?.description ?? '';
}
function syncControls() {
  syncChoices();
  syncSceneChoices();
  for (const input of document.querySelectorAll('input[data-parameter]')) {
    const id = input.closest('[data-controls]').dataset.controls;
    const field = input.dataset.parameter, value = valueFor(id, field);
    if (input.type === 'checkbox') { input.checked = Boolean(value); continue; }
    input.value = String(value);
    const output = input.closest('label').querySelector('output');
    if (output) output.textContent = field === 'detail'
      ? `${value} · ${latticeStructure(settings[id]).verticesPerUnit} per solid`
      : ['count', 'unitCount'].includes(field) ? String(value)
        : field === 'wingRate' ? `${Math.round(value)} Hz`
      : ['probe', 'tilt'].includes(field) ? `${Math.round(value)}°`
        : Number(value).toFixed(2);
  }
  for (const select of document.querySelectorAll('select[data-choice]')) {
    const id = select.closest('[data-controls]').dataset.controls;
    select.value = String(settings[id][select.dataset.choice]);
  }
  $('modelReadout').textContent = readout(poseAt(model));
}
function markCustom(id) {
  sceneSelection[id] = 'custom';
  // A hand-moved cake must not fight the scripted spatula/stack tour.
  if (id === 'pancakes' && animationMode[id] === 'flip-stack') animationMode[id] = 'sizzle';
}
function applyScene(id, key) {
  const chosen = rigLabScene(id, key);
  if (!chosen) return false;
  if (gesture) endGesture({ kind: gesture.kind, cancelled: true });
  clocks[id] = rebaseMotion(clocks[id], rateFor(id), now());
  settings[id] = chosen.settings;
  sceneSelection[id] = chosen.id;
  animationMode[id] = chosen.animation;
  if (id === 'ant-farm') {
    $('antStyle').value = chosen.antStyle ?? 'mixed';
    viewer.setAntStyle($('antStyle').value);
  }
  if (id === 'moth') {
    $('brushMode').checked = Boolean(chosen.brushMode);
    viewer.setBrushMode($('brushMode').checked);
  }
  if (id === 'voronoi-foam') foamCells = voronoiCells(settings[id]);
  if (id === 'pancakes') { flightAt = null; flightCake = null; landing = null; }
  if (id === 'mosquito') manualUntil = 0;
  scheduledUntil = audio.context?.currentTime ?? 0;
  syncTransport();
  syncControls();
  return true;
}
function selectModel(next) {
  if (!ids.includes(next) || next === model || disposed) return;
  if (gesture) endGesture({ kind: gesture.kind, cancelled: true });
  const prior = model, time = now();
  clocks[prior] = rebaseMotion(clocks[prior], rateFor(prior), time, false);
  audio.engines[prior]?.silence?.();
  model = next;
  viewer.setModel(next);
  viewer.setBrushMode(next === 'moth' && $('brushMode').checked);
  document.body.dataset.demoModel = next;
  $('modelIntro').textContent = metadata[next].intro;
  $('stageHelp').textContent = metadata[next].help;
  $('rigCanvas').setAttribute('aria-label', metadata[next].canvas);
  for (const button of document.querySelectorAll('button[data-demo-model]')) {
    const selected = button.dataset.demoModel === next;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
  }
  for (const group of document.querySelectorAll('[data-controls]')) {
    group.hidden = group.dataset.controls !== next;
  }
  if (armed) {
    for (const id of ids) {
      audio.buses[id].gain.setTargetAtTime(id === next ? 1 : 0, audio.context.currentTime, 0.016);
    }
    audio.engines.mosquito.silence();
    audio.engines.moth.setSelected(next === 'moth');
  }
  manualUntil = 0;
  scheduledUntil = audio.context?.currentTime ?? 0;
  wing.time = time;
  if (prior === 'pancakes') landing = null;
  syncTransport();
  syncControls();
  status(`${metadata[next].title} selected. The previous rig is paused, not layered into it.`);
}

function revise(id, values) {
  const previous = settings[id];
  settings[id] = validators[id](values);
  markCustom(id);
  if (id === 'voronoi-foam') foamCells = voronoiCells(settings[id]);
  if ((id === 'voronoi-foam' && (previous.count !== settings[id].count ||
        previous.shape !== settings[id].shape)) ||
      (id === 'polyhedral-lattice' && (previous.unitCount !== settings[id].unitCount ||
        previous.shape !== settings[id].shape || previous.detail !== settings[id].detail))) {
    scheduledUntil = audio.context?.currentTime ?? 0;
  }
  syncControls();
}
function audition(id, kind = 'main', index = null) {
  const engine = activeEngine(id);
  if (!engine) return;
  const pose = poseAt(id);
  switch (id) {
    case 'ant-farm': engine.chamber(kind === 'chamber' ? index ?? 1 : 1, pose.chamberSize); break;
    case 'voronoi-foam': engine.hit(foamCells[index ?? settings[id].selected]); break;
    case 'polyhedral-lattice': engine.pluck(pose, index ?? settings[id].selected); break;
    case 'octopus':
      if (kind === 'arm') engine.arm(pose, index ?? settings[id].selected);
      else engine.mantle(pose);
      break;
    case 'moth':
      viewer.flashWing(selectedWing);
      engine.trigger(selectedWing, settings.moth, { strength: 0.72, ridge: 1 });
      break;
    default: break;
  }
}
function flipPancake(speed = 0.65) {
  const time = now();
  if (flightAt != null && time - flightAt < 0.68) return;
  const panIndex = settings.pancakes.cakes.findIndex((cake) => cake.place === 'pan');
  if (panIndex < 0) {
    status('No pancake in the pan. Return one with the spatula or pour new batter.');
    return;
  }
  flightCake = panIndex;
  flightAt = time;
  landing = { at: time + 0.68, syrup: settings.pancakes.cakes[panIndex].syrup,
    speed: clamp(speed, 0.15, 1) };
  markCustom('pancakes');
  syncControls();
  status(`Cake ${panIndex + 1} airborne. A single pan impact is timed for its landing.`);
}
function pancakeAction(action) {
  const state = settings.pancakes;
  if (action === 'flip') { flipPancake(); return; }
  if (action === 'butter') {
    revise('pancakes', { ...state, butter: state.butter + 0.22 });
    status('Butter melts on the pan; the top of a stack gets a pat too.');
  } else if (action === 'syrup') {
    revise('pancakes', { ...state, syrup: state.syrup + 0.24 });
    status(`Cake ${state.selected + 1} has more syrup; its next contact will sound darker.`);
  } else {
    if (flightAt != null && now() - flightAt < 0.68) {
      status('Let the pancake land before moving it.');
      return;
    }
    const move = action === 'plate' ? 'stack' : action;
    const next = pancakeTransition(state, move);
    if (!next) {
      status({
        pour: 'The pan must be clear, and the stack holds at most six pancakes.',
        scoop: 'The spatula is occupied or there is no pancake to scoop.',
        stack: 'Scoop a pancake with the spatula before stacking it.',
        pan: 'The spatula needs a pancake and the pan must be empty.',
        peel: 'The spatula must be free to lift the top pancake.',
      }[move] ?? 'No pancake moved.');
      return;
    }
    const engine = activeEngine('pancakes');
    if (move === 'scoop') engine?.scoop();
    if (move === 'peel') engine?.peel(state.cakes[next.selected].syrup);
    if (move === 'stack') engine?.stack({ layer: next.cakes.filter((cake) => cake.place === 'plate').length - 1,
      syrup: next.syrup });
    if (move === 'pan') engine?.land({ syrup: next.syrup, speed: 0.24 });
    settings.pancakes = next;
    markCustom('pancakes');
    flightAt = null; flightCake = null; landing = null;
    syncControls();
    status({
      pour: `Cake ${next.selected + 1} cooking in the pan.`,
      scoop: `Cake ${next.selected + 1} on the spatula. Drag it to the plate or press Stack.`,
      stack: `${next.cakes.filter((cake) => cake.place === 'plate').length} pancakes stacked on the plate.`,
      pan: `Cake ${next.selected + 1} returned to the pan.`,
      peel: `Cake ${next.selected + 1} lifted onto the spatula.`,
    }[move]);
  }
}
function perform(action) {
  if (model === 'pancakes') { pancakeAction(action); return; }
  if (model === 'mosquito') { manualUntil = now() + 0.55; return; }
  if (model === 'moth' && action === 'wing') { audition('moth'); return; }
  if (model === 'ant-farm' && action === 'chamber') { audition(model, 'chamber'); return; }
  if (model === 'voronoi-foam' && action === 'cell') { audition(model); return; }
  if (model === 'polyhedral-lattice' && action === 'pluck') { audition(model); return; }
  if (model === 'octopus' && ['mantle', 'arm'].includes(action)) audition(model, action);
}

function beginGesture({ kind, side, index }) {
  const before = structuredClone(settings[model]);
  const beforeScene = sceneSelection[model], beforeAnimation = animationMode[model];
  if (side) selectedWing = side;
  if (index != null && model === 'mosquito' && kind === 'leg') {
    revise(model, { ...settings.mosquito, selectedLeg: index });
  }
  if (index != null && ['ant-farm', 'voronoi-foam', 'polyhedral-lattice', 'octopus'].includes(model)) {
    revise(model, { ...settings[model], selected: index });
  }
  if (index != null && model === 'pancakes') {
    revise(model, { ...settings.pancakes, selected: index, syrup: settings.pancakes.cakes[index].syrup });
  }
  gesture = { model, kind, side, index, before, beforeScene, beforeAnimation,
    initial: structuredClone(settings[model]) };
  if (model === 'mosquito' && kind !== 'orbit') manualUntil = now() + 0.55;
  if (model === 'voronoi-foam' && kind === 'seed') activeEngine()?.hold(foamCells[settings[model].selected]);
  if (model === 'polyhedral-lattice' && kind === 'node') activeEngine()?.hold(poseAt());
  if (model === 'octopus' && kind === 'arm') activeEngine()?.hold(poseAt());
}
function editGesture({ kind, side, dx, dy }) {
  if (!gesture || gesture.model !== model) return;
  const original = gesture.initial;
  if (model === 'ant-farm') {
    if (kind === 'ant') {
      const guide = original.guide.map((point) => [...point]);
      guide[original.selected] = [
        original.guide[original.selected][0] + dx * 1.3,
        original.guide[original.selected][1] - dy * 1.3,
      ];
      revise(model, { ...original, guide });
      if (activeEngine() && now() - lastManualSound > 0.11) {
        activeEngine().foot(original.selected, poseAt().colony[original.selected], audio.context.currentTime);
        lastManualSound = now();
      }
    }
  } else if (model === 'voronoi-foam' && kind === 'seed') {
    const seeds = original.seeds.map((seed) => [...seed]);
    seeds[original.selected][0] += dx * 2.1;
    seeds[original.selected][1] -= dy * 2.1;
    revise(model, { ...original, seeds });
    activeEngine()?.hold(foamCells[settings[model].selected]);
  } else if (model === 'polyhedral-lattice' && kind === 'node') {
    revise(model, { ...original, pullX: original.pullX + dx * 1.8,
      pullY: original.pullY - dy * 1.8 });
    activeEngine()?.hold(poseAt());
  } else if (model === 'octopus') {
    if (kind === 'mantle') {
      revise(model, { ...original, grip: original.grip + dy * 1.35,
        current: original.current + dx * 0.9 });
      if (activeEngine() && now() - lastManualSound > 0.14) {
        audition(model, 'mantle');
        lastManualSound = now();
      }
    }
    if (kind === 'arm') {
      const lengths = [...original.lengths], curls = [...original.curls];
      lengths[original.selected] -= dy * 2.05;
      curls[original.selected] += dx * 1.9;
      revise(model, { ...original, lengths, curls });
      activeEngine()?.hold(poseAt());
    }
  } else if (model === 'pancakes') {
    if (kind === 'pan') {
      revise(model, { ...original, tilt: original.tilt + dx * 67 - dy * 28 });
      if (activeEngine() && now() - lastManualSound > 0.12) {
        activeEngine().scrape(settings.pancakes.tilt);
        lastManualSound = now();
      }
    } else if (kind === 'spatula') {
      if (!gesture.scooped && Math.hypot(dx, dy) > 0.014) {
        if (!settings.pancakes.cakes.some((cake) => cake.place === 'spatula')) pancakeAction('scoop');
        gesture.scooped = settings.pancakes.cakes.some((cake) => cake.place === 'spatula');
      }
      if (gesture.scooped) revise(model, { ...settings.pancakes,
        spatulaX: original.spatulaX + dx * 2.8,
        spatulaY: original.spatulaY - dy * 1.8 });
    } else if (kind === 'butter') {
      revise(model, { ...original, butter: original.butter + Math.hypot(dx, dy) * 0.75 });
    }
  } else if (model === 'mosquito') {
    const next = { ...original };
    if (kind === 'wing') { next.wingRate += dx * 950; next.stroke -= dy * 1.5; }
    if (kind === 'body') { next.x += dx * 2.4; next.y -= dy * 1.8; }
    if (kind === 'probe') next.probe -= dy * 120;
    if (kind === 'leg') {
      next.legs = [...original.legs];
      next.legs[original.selectedLeg] += dx * 1.7 - dy * 1.1;
    }
    revise(model, next);
    manualUntil = now() + 0.55;
  } else if (model === 'moth' && kind === 'wing') {
    revise(model, { ...original,
      [side === 'right' ? 'rightFold' : 'leftFold']:
        original[side === 'right' ? 'rightFold' : 'leftFold'] + dy * 1.75,
      span: original.span + dx * (side === 'left' ? -0.8 : 0.8),
    });
    if (activeEngine() && now() - lastMothExciter > 0.095) {
      activeEngine().trigger(side, settings.moth,
        { strength: 0.34 + clamp(Math.abs(dx) + Math.abs(dy), 0, 0.35) });
      lastMothExciter = now();
      viewer.flashWing(side);
    }
  }
}
const recentBrush = [];
function brushGesture({ side, from, to }) {
  if (model !== 'moth' || from == null || to == null) return;
  const ridges = mothBrushRidges(from, to);
  if (!ridges.length) return;
  viewer.flashWing(side);
  const time = now();
  while (recentBrush.length && recentBrush[0] < time - 1) recentBrush.shift();
  let struck = 0;
  for (const ridge of ridges) {
    if (recentBrush.length >= 24) break;
    recentBrush.push(time);
    if (activeEngine()) activeEngine().trigger(side, settings.moth, { strength: 0.48, ridge });
    struck += 1;
  }
  $('gestureReadout').textContent = `${side} wing · ${struck} ridge${struck === 1 ? '' : 's'} brushed`;
}
function endGesture({ kind, index, dy = 0, moved = false, cancelled = false,
  dropKind = null, dropIndex = null }) {
  if (!gesture) return;
  const id = gesture.model;
  if (cancelled && kind !== 'orbit' && kind !== 'brush') {
    settings[id] = validators[id](gesture.before);
    sceneSelection[id] = gesture.beforeScene;
    animationMode[id] = gesture.beforeAnimation;
    if (id === 'voronoi-foam') foamCells = voronoiCells(settings[id]);
    if (id === 'mosquito') manualUntil = 0;
    syncControls();
  } else if (!cancelled && id === 'pancakes') {
    const cake = settings.pancakes.cakes[index];
    const overPlate = dropKind === 'plate' || (dropKind === 'pancake' &&
      settings.pancakes.cakes[dropIndex]?.place === 'plate');
    if (kind === 'spatula') {
      if (moved && overPlate) pancakeAction('stack');
      else if (moved && dropKind === 'pan') pancakeAction('pan');
      else if (!moved && settings.pancakes.cakes.some((item) => item.place === 'pan')) flipPancake();
    }
    if (kind === 'pancake') {
      if (cake?.place === 'pan' && (!moved || dy < -0.06)) {
        flipPancake(clamp(Math.abs(dy) * 3 + 0.35, 0.3, 1));
      } else if (cake?.place === 'plate' && dy > 0.05 &&
        cake.order === Math.max(...settings.pancakes.cakes
          .filter((item) => item.place === 'plate').map((item) => item.order))) pancakeAction('peel');
    }
    if (kind === 'butter' && !moved) pancakeAction('butter');
    if (kind === 'plate' && !moved) pancakeAction('stack');
  } else if (!cancelled && !moved) {
    if (id === 'voronoi-foam' && kind === 'seed') audition(id, 'cell', index);
    if (id === 'polyhedral-lattice' && kind === 'node') audition(id, 'pluck', index);
    if (id === 'octopus' && kind === 'mantle') audition(id, 'mantle');
    if (id === 'octopus' && kind === 'arm') audition(id, 'arm', index);
  }
  if (['voronoi-foam', 'polyhedral-lattice', 'octopus'].includes(id)) audio.engines[id]?.silence();
  gesture = null;
}

function keyboardGesture(event) {
  if (ids[Number(event.key) - 1]) {
    selectModel(ids[Number(event.key) - 1]);
    event.preventDefault();
    return;
  }
  if (event.key === 'Enter') {
    perform({
      'ant-farm': 'chamber', 'voronoi-foam': 'cell', 'polyhedral-lattice': 'pluck',
      octopus: 'mantle', pancakes: 'flip', mosquito: 'flight', moth: 'wing',
    }[model]);
    event.preventDefault();
    return;
  }
  if (!event.key.startsWith('Arrow')) return;
  const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  const vertical = event.key === 'ArrowDown' ? -1 : event.key === 'ArrowUp' ? 1 : 0;
  const state = settings[model];
  if (model === 'ant-farm') {
    const guide = state.guide.map((point) => [...point]);
    guide[state.selected][0] += horizontal * 0.05;
    guide[state.selected][1] += vertical * 0.05;
    revise(model, { ...state, guide });
    activeEngine()?.foot(state.selected, poseAt().colony[state.selected], audio.context.currentTime);
  } else if (model === 'voronoi-foam') {
    const seeds = state.seeds.map((seed) => [...seed]);
    seeds[state.selected][0] += horizontal * 0.05;
    seeds[state.selected][1] += vertical * 0.05;
    revise(model, { ...state, seeds });
    audition(model);
  } else if (model === 'polyhedral-lattice') {
    revise(model, { ...state, pullX: state.pullX + horizontal * 0.045,
      pullY: state.pullY + vertical * 0.045 });
    audition(model);
  } else if (model === 'octopus') {
    const lengths = [...state.lengths], curls = [...state.curls];
    lengths[state.selected] += vertical * 0.07;
    curls[state.selected] += horizontal * 0.065;
    revise(model, { ...state, lengths, curls });
    audition(model, 'arm');
  } else if (model === 'pancakes') {
    revise(model, { ...state, tilt: state.tilt + horizontal * 2, heat: state.heat + vertical * 0.04 });
    if (horizontal) activeEngine()?.scrape(settings.pancakes.tilt);
  } else if (model === 'mosquito') {
    revise(model, { ...state, wingRate: state.wingRate + horizontal * 16,
      y: state.y + vertical * 0.06 });
    manualUntil = now() + 0.5;
  } else {
    const field = selectedWing === 'right' ? 'rightFold' : 'leftFold';
    revise(model, { ...state, [field]: state[field] + (horizontal + vertical) * 0.06 });
    audition(model);
  }
  event.preventDefault();
}

for (const input of document.querySelectorAll('input[data-parameter]')) {
  listen(input, input.type === 'checkbox' ? 'change' : 'input', () => {
    const id = input.closest('[data-controls]').dataset.controls;
    const field = input.dataset.parameter, state = settings[id];
    if (field === rates[id]) {
      clocks[id] = rebaseMotion(clocks[id], rateFor(id), now());
      scheduledUntil = audio.context?.currentTime ?? 0;
    }
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);
    if (id === 'voronoi-foam' && field.startsWith('seed')) {
      const seeds = state.seeds.map((seed) => [...seed]);
      seeds[state.selected][{ seedX: 0, seedY: 1, seedZ: 2 }[field]] = value;
      revise(id, { ...state, seeds });
    } else if (id === 'octopus' && (field === 'length' || field === 'curl')) {
      const key = field === 'length' ? 'lengths' : 'curls';
      const array = [...state[key]];
      array[state.selected] = value;
      revise(id, { ...state, [key]: array });
    } else if (id === 'mosquito' && field === 'legCurl') {
      const legs = [...state.legs];
      legs[state.selectedLeg] = value;
      revise(id, { ...state, legs });
    } else revise(id, { ...state, [field]: value });
    if (id !== model) return;
    const time = now();
    if (id === 'mosquito') manualUntil = time + 0.55;
    if (id === 'moth' && field !== 'flapRate' && activeEngine()) {
      activeEngine().trigger('left', settings.moth, { strength: 0.32 });
      activeEngine().trigger('right', settings.moth, { strength: 0.32 });
    }
    if (time - lastManualSound > 0.085) {
      if (id === 'voronoi-foam' && field !== 'sweepRate') audition(id);
      if (id === 'polyhedral-lattice' && field !== 'pulseRate') audition(id);
      if (id === 'octopus' && !['pulseRate', 'wetness'].includes(field)) audition(id,
        field === 'grip' ? 'mantle' : 'arm');
      if (id === 'ant-farm' && field === 'gateOpen') activeEngine()?.gate();
      if (id === 'pancakes' && field === 'tilt') activeEngine()?.scrape(settings.pancakes.tilt);
      lastManualSound = time;
    }
  });
}
for (const select of document.querySelectorAll('select[data-choice]')) {
  listen(select, 'change', () => {
    const id = select.closest('[data-controls]').dataset.controls;
    const field = select.dataset.choice;
    const value = ['shape', 'skin'].includes(field) ? select.value : Number(select.value);
    const next = { ...settings[id], [field]: value };
    if (id === 'pancakes' && field === 'selected') next.syrup = settings.pancakes.cakes[value].syrup;
    revise(id, next);
    if (id === 'voronoi-foam' || id === 'polyhedral-lattice') audition(id);
    if (id === 'octopus' && field !== 'skin') audition(id, 'arm');
  });
}
for (const button of document.querySelectorAll('button[data-demo-model]')) {
  listen(button, 'click', () => selectModel(button.dataset.demoModel));
}
listen($('rigScene'), 'change', () => {
  const key = $('rigScene').value;
  if (applyScene(model, key)) status(`${rigLabScene(model, key).label} loaded. Play and Audio are unchanged.`);
});
listen($('nextScene'), 'click', () => {
  const scenes = rigLabScenes(model), index = scenes.findIndex((scene) =>
    scene.id === sceneSelection[model]);
  const next = scenes[(index + 1) % scenes.length];
  if (applyScene(model, next.id)) status(`${next.label} loaded. Play and Audio are unchanged.`);
});
for (const button of document.querySelectorAll('button[data-action]')) {
  listen(button, 'click', () => perform(button.dataset.action));
}
listen($('playButton'), 'click', () => setPlaying(!clocks[model].playing));
listen($('resetButton'), 'click', () => {
  const id = model;
  applyScene(id, rigLabScenes(id)[0].id);
  audio.engines[id]?.silence?.();
  status(`${metadata[id].title} reset; Play, Audio and output were not changed.`);
});
listen($('brushMode'), 'change', () => {
  viewer.setBrushMode($('brushMode').checked);
  markCustom('moth');
  syncSceneChoices();
  $('gestureReadout').textContent = $('brushMode').checked
    ? 'Brush a moth wing from root to tip.' : 'Drag a moth wing to fold it.';
});
listen($('antStyle'), 'change', () => {
  viewer.setAntStyle($('antStyle').value);
  markCustom('ant-farm');
  syncSceneChoices();
  status(`Ant farm now shows ${$('antStyle').selectedOptions[0].textContent} from the downloaded rigs.`);
});
listen($('viewFront'), 'click', () => viewer.setView('front'));
listen($('viewSide'), 'click', () => viewer.setView('side'));
listen($('zoomIn'), 'click', () => viewer.zoomBy(0.84));
listen($('zoomOut'), 'click', () => viewer.zoomBy(1.18));
// This unregistered preview keeps its own authored navigation rather than
// asking the catalogue navigator to invent an unrelated "next instrument".
listen(document, 'keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || event.isComposing ||
    event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, select, textarea, button, a, summary, audio, video, [contenteditable], [role="slider"], [role="textbox"], [role="combobox"]')) return;
  event.preventDefault();
  $('playButton').click();
});
listen(document, 'visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(frameId); frameId = 0;
    if (clocks[model].playing) setPlaying(false);
    if (armed || starting) silenceAudio();
  } else if (!disposed && !frameId) {
    wing.time = now();
    lastPaint = 0;
    frameId = requestAnimationFrame(paint);
  }
});
listen(window, 'pagehide', dispose);

function dispose() {
  if (disposed) return;
  disposed = true;
  ++generation;
  clearTimeout(suspendTimer);
  clearInterval(timer);
  cancelAnimationFrame(frameId);
  abort.abort();
  viewer.dispose();
  for (const engine of Object.values(audio.engines)) engine.dispose();
  for (const bus of Object.values(audio.buses)) bus.disconnect();
  audio.master?.disconnect();
  audio.splitter?.disconnect();
  audio.analysers?.forEach((node) => node.disconnect());
  audio.merger?.disconnect();
  if (audio.context && audio.context.state !== 'closed') void audio.context.close();
  strip.destroy();
}

syncControls();
syncTransport();
frameId = requestAnimationFrame(paint);
status('Drag a rig or press Play. Audio starts off.');

// Read-only development seam: tests inspect actual model, transport and audio, not private nodes.
window.rigLabDemo = Object.freeze({
  state: () => ({
    model, settings: structuredClone(settings),
    scene: sceneSelection[model], animation: animationMode[model],
    animatedSettings: structuredClone(animatedRigSettings(model, settings[model],
      motionCycles(clocks[model], rateFor(model), now()),
      clocks[model].playing, animationMode[model])),
    playing: clocks[model].playing,
    cycles: motionCycles(clocks[model], rateFor(model), now()),
    audioArmed: armed, audioCreated: Boolean(audio.context),
    levels: { ...audio.levels }, visual: viewer.getState(),
    foamVolumes: foamCells.map((cell) => cell.volume),
    foamFrequencies: foamCells.map((cell) => cell.frequency),
    latticeNodes: latticeStructure(settings['polyhedral-lattice']).restNodes.length,
    activeVoices: Object.fromEntries(ids.map((id) => [id, audio.engines[id]?.activeVoices ?? 0])),
    pancakeAirborne: poseAt('pancakes').airborne,
    pancakeStackCount: poseAt('pancakes').stackCount,
    pancakePositions: poseAt('pancakes').cakes.map((cake) => cake.position),
  }),
  screenPoint: (kind, index) => viewer.screenPoint(kind, index),
  dispose,
});
