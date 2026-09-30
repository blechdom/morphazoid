import { branchFrame, branchPitch, branchShape, branchTurnsGeometry, createBranchTurnsTarget } from './branch-geometry.js';
import { MOTION_TARGETS, createMotions, rebaseMotions, advanceMotions, motionValues, motionSnapshot, selectMotionFrame } from './motions.js';
import { motionBankKey } from './motion-bank.js';
import { MODULATOR_SHAPES, targetsForMode, modulatorTargetAvailable, modulatorSettings, modulatedValues, advanceModulators } from './modulators.js';
import { MODES, PARAMS, MODE_PARAMETERS, ENGINE_OPTIONS, getParameterInfo, createDefaultState, sanitizeState, generateStructure, analyzeTexture } from './model.js';
import { FACTORY_PRESETS, openingPreset, randomizeState } from './presets.js';
import { createAmplitudeControl } from '../../amplitude-control.js';
import { ADSR_EDITOR_MODEL, adsrFromPoints, envelopeEditorState } from './envelope-editor.js';
import { FractalAudio } from './audio.js';
import { createFractalSource, advancePhaseClocks } from './dsp.js';
import { createRangeField } from '../../ui/index.js';
import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';
import { createAudioStrip } from '../../ui/patterns/audio-strip.js';
import { registerHeaderPresets } from '../../site/header-presets.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const GLYPHS = ['∿', '⋔', '⁙', '≋', '◎', '▥'];
const modeIds = new Set(MODES.map(mode => mode.id));
const modeAliases = { paths: 'wander', branches: 'grammar', waves: 'waveform', textures: 'texture' };
const hashMode = modeAliases[location.hash.slice(1)] ?? location.hash.slice(1);
const initialMode = modeIds.has(hashMode) ? hashMode : 'wander';
const initialPreset = openingPreset(initialMode);
let state = sanitizeState(initialPreset?.snapshot ?? createDefaultState(initialMode));
let structure = generateStructure(state, { turnsGeometry: state.mode === 'grammar' });
let motions = createMotions(state);
let motionBank = null;
let motionBankVersion = 0;
let requestedMotionKey = null;
let motionWorker = null;
let motionWorkerTimer = null;
const motionBanks = new Map();
let playing = false;
let completedAt = -Infinity;
let armed = false;
let starting = false;
let disposed = false;
let phase = 0;
let transport = { travelDirection: 1, completed: false, time: 0, motionTime: 0, modPhases: [0, 0], motions: motionSnapshot(motions) };
let modulatorSlots = modulatorSettings(state);
const visualModulation = {};
const visibleBranchFrame = {};
const visibleTurnsTarget = createBranchTurnsTarget();
let displayedBranchGeometry = structure.branchGeometry;
let displayedBranchAngle = state.branchAngle;
let level = .55;
let frameHandle = 0;
let lastFrame = performance.now();
let lastPaint = 0;
let telemetry = null;
let activePointer = null;
const builtinSource = createFractalSource(16000, 2);
const builtinProfile = analyzeTexture(builtinSource, 16000);
let source = builtinSource;
let sourceProfile = builtinProfile;
let sourceRate = 16000;
let sourceName = 'Built-in synthetic source';
let sourceRequest = 0;
let presetController;
let controlsMode = null;
let envelopeControl = null;
let envelopeSyncing = false;
let microphoneBusy = false;
let microphoneMessage = '';
const modeMemory = new Map();
const fields = new Map();
const motionButtons = new Map();
const abort = new AbortController();
const listen = (node, name, callback, options = {}) => node.addEventListener(name, callback, { ...options, signal: abort.signal });
const modeInfo = () => MODES.find(mode => mode.id === state.mode) ?? MODES[0];
const wrap = value => ((value % 1) + 1) % 1;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const status = text => { $('status').textContent = text; };

const audio = new FractalAudio({ onMicrophoneState() { if (!disposed) refreshMicrophone(); }, onError(error) {
  armed = false; telemetry = null; strip.setAudioState('error'); refreshMicrophone(); status(error.message);
}, onTelemetry(data) {
  if (!armed) return;
  telemetry = data;
  if (Number.isFinite(data.phase)) phase = clamp(data.phase, 0, 1);
  transport = { travelDirection: data.travelDirection === -1 ? -1 : 1, completed: data.completed === true, time: data.time, motionTime: data.motionTime, modPhases: Array.from(data.modPhases ?? [0, 0]), motions: data.motions ?? motionSnapshot(motions), ...(data.phaseClocks ? { phaseClocks: { ...data.phaseClocks } } : {}) };
  if (data.motions) motions = createMotions(state, data.motions);
  if (data.completed && !data.playing && playing) reflectPlaying(false);
} });

const strip = createAudioStrip({ buttonId: 'audioButton', levelId: 'level', level,
  onAudioClick: toggleAudio,
  onLevelInput(value) { level = value; audio.setLevel(level); },
});
$('audioHost').append(strip);

async function toggleAudio() {
  if (starting || disposed) return;
  if (armed) {
    armed = false;
    telemetry = null;
    strip.setAudioState('off');
    status('Audio off');
    await audio.stop();
    refreshMicrophone();
    return;
  }
  starting = true;
  strip.setAudioState('starting');
  try {
    await audio.start(state, structure, { phase, playing, level, transport, deferPlaying: true });
    if (disposed) { await audio.destroy(); return; }
    audio.setState(state, structure, { motionBankVersion });
    if (motionBank) audio.setMotionBank(motionBank);
    audio.setPhase(phase, transport);
    audio.setPlaying(playing);
    audio.setLevel(level);
    if (source) audio.setSource(source, sourceRate, sourceProfile);
    armed = true;
    strip.setAudioState('on');
    status(playing ? 'Playing' : 'Audio on · press Play');
  } catch (error) {
    armed = false;
    strip.setAudioState('error');
    status(`Audio could not start: ${error.message}. Press Audio to retry.`);
  } finally { starting = false; refreshMicrophone(); }
}

function refreshMicrophone() {
  const active = audio.microphoneActive;
  $('microphone').disabled = !armed || microphoneBusy;
  $('microphone').setAttribute('aria-pressed', String(active));
  $('microphone').textContent = microphoneBusy ? 'Connecting…' : active ? 'Microphone on' : 'Microphone off';
  $('microphoneStatus').textContent = microphoneMessage || (!armed ? 'Enable Audio to use the microphone.' : active ? 'Live input · use headphones' : 'Input off · click Microphone to connect.');
  for (const key of ['inputMix', 'inputGain']) fields.get(key)?.field.setDisabled(!active);
  fields.get('profileMemory')?.field.setDisabled(!active);
  refreshModulation();
  $('inputMeter').value = active ? clamp(telemetry?.inputRms ?? 0, 0, 1) : 0;
}
listen($('microphone'), 'click', async () => {
  if (!armed || microphoneBusy) return;
  microphoneMessage = '';
  if (audio.microphoneActive) { audio.stopMicrophone(); refreshMicrophone(); return; }
  microphoneBusy = true; refreshMicrophone();
  try { await audio.startMicrophone(); }
  catch (error) { if (!disposed && armed) microphoneMessage = `Microphone unavailable: ${error.message}`; }
  finally { microphoneBusy = false; if (!disposed) refreshMicrophone(); }
});

function reflectPlaying(value) {
  if (playing && !value && transport.completed) completedAt = performance.now();
  if (value) completedAt = -Infinity;
  playing = Boolean(value);
  lastFrame = performance.now();
  $('playButton').setAttribute('aria-pressed', String(playing));
  const label = playing ? 'Pause' : 'Play';
  $('playButtonLabel').textContent = label;
  $('playButton').setAttribute('aria-label', label);
  $('playButton').title = label;
  $('transportState').textContent = playing ? 'playing' : transport.completed ? 'finished' : 'paused';
  status(armed ? (playing ? 'Playing' : transport.completed ? 'Finished' : 'Paused') : 'Audio off');
}

function resetVisualTransport(position = 0, travelDirection = 1, resetMotions = true) {
  completedAt = -Infinity;
  phase = clamp(position, 0, 1);
  const time = phase * state.phrase / state.rate;
  if (resetMotions) motions = createMotions(state);
  transport = { travelDirection, completed: false, time, motionTime: time, modPhases: [0, 0], motions: motionSnapshot(motions) };
  telemetry = null;
}

function setPlaying(value) {
  if (value && transport.completed) resetVisualTransport(0, 1, false);
  reflectPlaying(value);
  audio.setPlaying(playing);
}

// Preview the same traversal while Audio is off. An armed instrument always
// follows worklet telemetry, including a suspended audio context or UI stall.
function advanceVisualTransport(dt) {
  let remaining = dt * state.rate / state.phrase;
  const secondsPerPhase = state.phrase / state.rate;
  while (remaining > 0 && playing) {
    const direction = transport.travelDirection;
    const distance = direction > 0 ? 1 - phase : phase;
    const travel = Math.min(remaining, distance);
    phase = clamp(phase + travel * direction, 0, 1);
    if (transport.phaseClocks) {
      const direct = motionValues(state, motions);
      const root = modulatedValues({ ...state, ...direct }, modulatorSlots, transport.modPhases).base ?? direct.base;
      advancePhaseClocks(transport.phaseClocks, travel * secondsPerPhase, state.sweepRate, root, state.direction, direction);
    }
    advanceModulators(transport.modPhases, modulatorSlots, travel * secondsPerPhase);
    transport.time += travel * secondsPerPhase;
    transport.motionTime += travel * secondsPerPhase * direction;
    remaining -= travel;
    if (travel < distance) break;
    if (direction > 0 && state.pingPong) transport.travelDirection = -1;
    else if (state.loop) {
      phase = 0;
      transport.travelDirection = 1;
    } else {
      transport.completed = true;
      reflectPlaying(false);
    }
  }
}

const MIC_HELP = {
  wander: 'Live input excites and shapes the articulated path voices. Speak, tap or sing into the microphone while the path supplies pitch and timing. Input mix blends this response with the built-in voice.',
  grammar: 'Live input excites the branching voices. The L-system supplies the rhythm and pitches; your sound supplies changing energy and excitation. Input mix returns toward the built-in source when lowered.',
  grains: 'The microphone fills a rolling source buffer. Each recursive grain reads a recent fragment; Source scan chooses its position and Spray scatters fragments. Input mix blends live grains with the built-in or loaded source.',
  waveform: 'The live waveform shapes the wave engine through modulation. The fractal partial family supplies pitch while your input changes the sound’s movement and density. Input mix controls this contribution.',
  echoes: 'Microphone audio enters the geometric delay network directly. Echo time, Echo ratio and Echo feedback turn your voice or taps into expanding or crowding repetitions. Input mix blends live input with the generated echo source.',
  texture: 'Sixteen live frequency bands and an amplitude follower measure the microphone. Filtered noise and band oscillators synthesize a new texture from that changing profile; Noise + grains also adds fragments of the recent input. Analysis release controls how quickly measured energy fades.',
};
const LOG_PARAMS = new Set(['lfo1Rate', 'lfo2Rate', 'base', 'ratio', 'rate', 'attack', 'decay', 'release', 'grainSize', 'echoTime', 'sweepRate', 'bandQ', 'profileMemory', 'glide']);
function format(key, value) {
  if (/^motion.*Tempo$/.test(key)) return `${Number(value.toFixed(1))} BPM`;
  if (/^lfo[12]Rate$/.test(key)) return `${Number(value.toFixed(3))} Hz`;
  if (key === 'stereoWidth') return `${Math.round(value * 100)}%`;
  if (key === 'branchAngle') return `${value.toFixed(1)}°`;
  const unit = PARAMS[key]?.unit;
  if (unit === 'Hz') return `${value < 100 ? value.toFixed(1) : Math.round(value)} Hz`;
  if (key === 'rate') return `${Number((value * 60).toFixed(2))} BPM`;
  if (unit === 's') return value < 1 ? `${Number((value * 1000).toFixed(1))} ms` : `${value.toFixed(2)} s`;
  if (unit === 'beats') return `${Math.round(value)} beats`;
  if (unit === 'oct') return `${value.toFixed(2)} oct`;
  if (unit === 'oct/s') return `${value.toFixed(2)} oct/s`;
  if (unit === '×') return `${value.toFixed(2)} ×`;
  if (['depth', 'seed'].includes(key)) return `${Math.round(value)}`;
  if (['index', 'shapeToMod', 'turns', 'fold', 'bandQ', 'tilt', 'chaos', 'roughness', 'branch'].includes(key)) return value.toFixed(2);
  return `${Math.round(value * 100)}%`;
}
function modulationInfo() {
  if (state.mode === 'texture' && state.engine !== 'hybrid') return { label: 'Band movement', choices: ['Fractal', 'Orbital'], description: 'This choice moves the texture’s frequency bands: Fractal follows correlated multiscale motion; Orbital follows smooth oscillation with chaotic drift.' };
  if (state.engine === 'pluck') return { label: 'String modulation', choices: ['Relative', 'Absolute'], description: 'The sound generator is a plucked delay string. Relative modulation scales its loop length; Absolute modulation adds a moving sample offset. Mod amount controls the bend and Mod ratio controls its speed relative to the note.' };
  if (state.mode === 'grains' || (state.mode === 'texture' && state.engine === 'hybrid')) return { label: 'Grain modulation', choices: ['Speed', 'Position'], description: 'The generator reads fragments of audio. Speed varies their playback speed; Position moves the sample-reading position. Mod amount and Mod ratio set the strength and rate. In textures, this choice also selects fractal or orbital movement of the noise bands.' };
  return { label: state.mode === 'echoes' ? 'Synth modulation' : 'Oscillator modulation', choices: ['FM', 'PM'], description: 'Sound engine chooses the primary generator. This choice controls modulation inside that generator: FM varies oscillator frequency; PM varies oscillator phase. Mod amount at zero removes this modulation. In Echoes, it acts on the generated tones; the live microphone follows its own delay path.' };
}
function parameterInfo(key) {
  if (/^lfo[12]Rate$/.test(key)) return { ...PARAMS[key], description: 'Modulator speed in cycles per second. The audio clock runs this motion independently of drawing; Pause freezes it and Restart resets it.' };
  if (/^lfo[12]Depth$/.test(key)) return { ...PARAMS[key], description: 'Excursion around the knob’s manual setting. For Branch angle, 100% spans a full 360° turn with Rise or Fall. Frequency controls move by ratios; other controls move through their available range. Two modulators assigned to the same knob add together.' };
  const info = getParameterInfo(key, state.mode);
  if (key === 'shapeToMod') return { ...info, label: 'Shape → mod' };
  if (key === 'rate') return { ...info, label: 'Tempo', description: 'Phrase-clock speed in beats per minute. At 120 BPM, an eight-beat phrase lasts four seconds. Branches and subdivisions can create several attacks per beat. Tempo also changes pulse-linked modulation; Echo time and Sweep rate retain their own controls.' };
  if (key === 'memory') {
    const note = {
      wander: state.engine === 'pluck' ? ['String decay', 'Lengthens the plucked-string decay and the note gate.'] : ['Note length', 'Lengthens the note gate before the ADSR release begins.'],
      grammar: state.engine === 'pluck' ? ['String decay', 'Increases feedback inside each plucked string.'] : ['Delay feedback', 'Controls feedback in the shared stereo delay.'],
      grains: ['Grain decay', 'Lets descendant grains retain more level and duration; it also sharpens the resonant grain filter.'],
      waveform: ['Note length', 'Lengthens the note gate before the ADSR release begins.'],
      echoes: ['Echo feedback', 'Raises repeated-tap levels and feedback, and lets later score events retain more energy and duration.'],
      texture: [state.engine === 'hybrid' ? 'Grain length' : 'Note length', 'Lengthens score gates and, in hybrid, the source-grain windows.'],
    }[state.mode];
    return { ...info, label: note[0], description: `${note[1]} This linked control also changes feedback in the 173 ms / 277 ms stereo delay. Its delay contribution is heard when Stereo delay is raised; in Echoes it also feeds the main echo network.` };
  }
  if (key === 'space') return { ...info, label: 'Stereo delay', description: 'Adds crossed delays at 173 ms and 277 ms and increases their feedback. It also widens event panning in pitched and grain voices. Texture noise and band oscillators keep their own dry stereo positions. Zero removes this added delay but does not make the source mono.' };
  if (key === 'profileMemory') return { ...info, label: 'Analysis release', description: 'Time for measured microphone energy to decay. New attacks register quickly. This follows live input; loaded-file profiles stay fixed.' };
  if (key === 'engine') return { ...info, label: 'Sound engine', description: 'Chooses the main sound generator: oscillators, a plucked string, audio grains, a wave shape, or a spectral texture. The separate modulation controls transform that chosen generator; they do not add another independent instrument.' };
  if (key === 'synthesis') return { ...info, label: modulationInfo().label, description: modulationInfo().description };
  if (state.mode === 'texture' && key === 'ratio') return { ...info, label: 'Band spacing', description: 'Redistributes the texture’s frequency bands between low and high registers. In hybrid it also sets the modulation ratio of source grains.' };
  if (state.mode === 'texture' && key === 'index') return { ...info, label: 'Band motion', description: 'Depth of frequency movement across the texture bands. In hybrid it also changes modulation of source-grain reads.' };
  if (key === 'ratio' || key === 'index') return { ...info, label: key === 'ratio' ? 'Mod ratio' : 'Mod amount', description: `${key === 'ratio' ? 'Modulation frequency relative to each note’s reference frequency.' : 'Strength of the selected modulation.'} ${modulationInfo().description}` };
  return info;
}
function refreshModulation() {
  const info = modulationInfo();
  const inputOnly = audio.microphoneActive && state.inputMix === 1 && (state.mode === 'echoes' || (state.mode === 'grammar' && state.engine !== 'pluck'));
  $('synthesisFm').textContent = info.choices[0]; $('synthesisPm').textContent = info.choices[1];
  $('synthesisFm').disabled = $('synthesisPm').disabled = inputOnly;
  $('modulationRow').querySelector('span').textContent = info.label.toUpperCase();
  $('modulationRow').querySelector('[role=group]').setAttribute('aria-label', info.label);
  $('modulationRow').querySelector('[data-help]').setAttribute('aria-label', `About ${info.label}`);
  $('modulationUnit').textContent = inputOnly ? 'mic only' : '';
  for (const key of ['index', 'ratio', 'shapeToMod']) fields.get(key)?.field.setDisabled(inputOnly);
}
function parameterMapping(key) {
  const { min, max, step } = PARAMS[key];
  if (!LOG_PARAMS.has(key)) return { min, max, step, encode: value => value, decode: value => Number(value) };
  const offset = min === 0 ? .001 : 0;
  const low = min + offset, ratio = (max + offset) / low;
  return { min: 0, max: 1, step: .0001,
    encode: value => Math.log((value + offset) / low) / Math.log(ratio),
    decode: value => clamp(low * ratio ** Number(value) - offset, min, max),
  };
}
function infoButton(key, label) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'info-button'; button.textContent = 'i';
  button.dataset.help = key; button.setAttribute('aria-label', `About ${label}`);
  return button;
}
function addField(key, host, knob = false) {
  const descriptor = parameterInfo(key), mapping = parameterMapping(key);
  const wrapper = document.createElement('div');
  wrapper.className = `parameter${knob ? ' knob-parameter' : ''}${key === 'scan' ? ' scan-control' : ''}`;
  const field = createRangeField({ id: key, label: descriptor.label, ...mapping,
    value: mapping.encode(state[key]), parseValue: mapping.decode,
    formatValue: value => format(key, value), onInput: value => updateState({ [key]: value }),
  });
  field.input.dataset.scale = LOG_PARAMS.has(key) ? 'log' : 'linear';
  field.input.dataset.parameterMin = PARAMS[key].min;
  field.input.dataset.parameterMax = PARAMS[key].max;
  const rotary = knob ? enhanceRangeKnob(field.input, { wrap: Boolean(MOTION_TARGETS[key]?.circular) }) : null;
  const modOutput = document.createElement('output'); modOutput.className = 'modulation-value'; modOutput.hidden = true;
  const help = infoButton(key, descriptor.label);
  wrapper.append(field, help, modOutput);
  if (key === 'timingBend') {
    const reset = document.createElement('button'); reset.type = 'button'; reset.id = 'timingBendReset'; reset.className = 'parameter-reset'; reset.textContent = '↺ 0%'; reset.title = 'Return Timing bend to zero'; reset.setAttribute('aria-label', 'Reset Timing bend to zero');
    listen(reset, 'click', () => updateState({ timingBend: 0 })); wrapper.append(reset);
  }
  host.append(wrapper);
  fields.set(key, { field, rotary, wrapper, help, mapping, modOutput });
  if (MOTION_TARGETS[key]) addMotionControl(key, wrapper);
}
function addMotionControl(key, host) {
  const spec = MOTION_TARGETS[key];
  const row = document.createElement('div'); row.className = 'parameter-motion';
  const button = document.createElement('button');
  button.type = 'button'; button.id = spec.onKey; button.className = 'motion-play';
  button.innerHTML = '<svg class="transport-play" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5 18 12 8 18.5Z" /></svg><svg class="transport-pause" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6v12M16 6v12" /></svg>';
  button.dataset.motionKey = key;
  const tempo = document.createElement('div'); tempo.className = 'motion-tempo';
  addField(spec.tempoKey, tempo);
  fields.get(spec.tempoKey).field.input.setAttribute('aria-label', `${parameterInfo(key).label} motion tempo`);
  row.append(button, tempo); host.append(row); motionButtons.set(key, button);
}

function addSection(label, keys, host, knobs = false) {
  const section = document.createElement('section'); section.className = 'control-section';
  const heading = document.createElement('h2'); heading.textContent = label;
  const grid = document.createElement('div'); grid.className = knobs ? 'envelope-controls macro-controls' : 'control-grid';
  keys.forEach(key => addField(key, grid, knobs || Boolean(MOTION_TARGETS[key]?.circular)));
  section.append(heading);
  if (knobs) {
    const envelope = document.createElement('div'); envelope.id = 'envelopeControl';
    section.append(envelope);
    envelopeControl = createAmplitudeControl(envelope, {
      label: '', timing: 'milliseconds', showLevel: false, allowDisable: false,
      editorModel: ADSR_EDITOR_MODEL,
      onChange(controller) {
        if (!envelopeSyncing) updateState(adsrFromPoints(controller.captureState().points));
      },
    });
    heading.append(infoButton('envelope', 'ADSR editor'));
  }
  section.append(grid);
  host.append(section);
  return section;
}
function addToggle(key, label, section) {
  const wrapper = document.createElement('div'); wrapper.className = 'mapping-toggle';
  const button = document.createElement('button'); button.type = 'button'; button.id = key;
  button.dataset.stateToggle = key; button.textContent = label; button.setAttribute('aria-pressed', String(Boolean(state[key])));
  wrapper.append(button, infoButton(key, label)); section.querySelector('.control-grid').append(wrapper);
}
function buildModulators(host) {
  const section = document.createElement('section'); section.className = 'control-section modulators-section';
  const heading = document.createElement('h2'); heading.textContent = 'MODULATORS'; heading.append(infoButton('modulators', 'Knob modulators')); section.append(heading);
  for (let i = 1; i <= 2; i++) {
    const prefix = `lfo${i}`, slot = document.createElement('div'); slot.className = 'modulator-slot';
    const row = document.createElement('div'); row.className = 'modulator-heading';
    const label = document.createElement('span'); label.textContent = `LFO ${i}`;
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.id = `${prefix}On`; toggle.dataset.stateToggle = `${prefix}On`; toggle.setAttribute('aria-label', `Modulator ${i} on/off`);
    row.append(label, toggle);
    const choices = document.createElement('div'); choices.className = 'modulator-choices';
    for (const [suffix, name, options] of [['Target', 'Destination', targetsForMode(state.mode).map(([key, value]) => [key, value.label])], ['Shape', 'Waveform', MODULATOR_SHAPES.map(shape => [shape, shape[0].toUpperCase() + shape.slice(1)])]]) {
      const label = document.createElement('label'); label.textContent = name;
      const select = document.createElement('select'); select.id = `${prefix}${suffix}`; select.dataset.modulatorSelect = select.id; select.setAttribute('aria-label', `Modulator ${i} ${name.toLowerCase()}`);
      for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
      label.append(select); choices.append(label);
    }
    const grid = document.createElement('div'); grid.className = 'control-grid';
    addField(`${prefix}Rate`, grid); addField(`${prefix}Depth`, grid);
    const status = document.createElement('small'); status.id = `${prefix}Status`; status.className = 'modulator-status';
    slot.append(row, choices, grid, status); section.append(slot);
  }
  host.append(section);
}
listen(document, 'change', event => {
  const key = event.target.dataset?.modulatorSelect;
  if (key) updateState({ [key]: event.target.value });
});

function buildControls() {
  envelopeControl?.destroy(); envelopeControl = null;
  for (const { field, rotary } of fields.values()) { rotary?.destroy(); field.destroy(); }
  fields.clear(); motionButtons.clear();
  for (const id of ['tempoControl', 'macroControls', 'modeControls', 'soundControls', 'inputControls']) $(id).replaceChildren();
  addField('rate', $('tempoControl'));
  for (const key of ['base', 'index', 'ratio']) addField(key, $('macroControls'), true);
  if (state.mode === 'grammar') {
    const section = addSection('BRANCHES', ['branchAngle', 'turns'], $('modeControls'));
    section.querySelector('.control-grid').className = 'macro-controls branch-knobs';
    addField('generationLoss', section);
  } else addSection(modeInfo().label.toUpperCase(), MODE_PARAMETERS[state.mode].filter(key => key !== 'profileMemory'), $('modeControls'));
  for (const [label, keys] of [
    ['STRUCTURE', ['depth', 'roughness', 'branch']],
    ['GESTURE', ['x', 'y']], ['PHRASING', ['phrase']],
  ]) addSection(label, keys, $('soundControls'));
  const mapping = addSection('MAPPING', ['span', 'timingBend', 'shapeToMod'], $('soundControls'));
  addToggle('pitchInvert', 'Invert pitch', mapping);
  buildModulators($('soundControls'));
  addSection('ADSR', ['attack', 'decay', 'sustain', 'release'], $('soundControls'), true);
  const stereo = addSection('DECAY, DELAY & STEREO', ['memory', 'space', 'stereoWidth'], $('soundControls'));
  addToggle('stereoFlip', 'Flip L/R', stereo);
  for (const key of ['inputMix', 'inputGain', ...(state.mode === 'texture' ? ['profileMemory'] : [])]) addField(key, $('inputControls'));
  $('engine').replaceChildren(...ENGINE_OPTIONS[state.mode].map(engine => {
    const option = document.createElement('option'); option.value = engine.value; option.textContent = engine.label; return option;
  }));
  controlsMode = state.mode;
}
function drawEnvelope() {
  if (!envelopeControl) return;
  const snapshot = envelopeEditorState(state), current = envelopeControl.captureState();
  if (current.preset === snapshot.preset && current.points.every((point, index) =>
    Math.abs(point.x - snapshot.points[index].x) < 1e-10 && Math.abs(point.y - snapshot.points[index].y) < 1e-10)) return;
  envelopeSyncing = true;
  try { envelopeControl.applyState(snapshot); } finally { envelopeSyncing = false; }
}
function openHelp(key) {
  const body = $('helpBody'); body.replaceChildren();
  const paragraph = text => { const p = document.createElement('p'); p.textContent = text; body.append(p); };
  if (key === 'instrument') {
    $('helpTitle').textContent = modeInfo().label;
    paragraph(modeInfo().description);
    for (const engine of ENGINE_OPTIONS[state.mode]) {
      const p = document.createElement('p'), strong = document.createElement('strong');
      strong.textContent = `${engine.label} — `; p.append(strong, document.createTextNode(engine.description)); body.append(p);
    }
    paragraph(MIC_HELP[state.mode]);
    const preset = FACTORY_PRESETS.find(item => JSON.stringify(item.snapshot) === JSON.stringify(state));
    if (preset) paragraph(`${preset.label ?? preset.name}: ${preset.description}`);
    paragraph('Enable Audio, then Play. Drag the graphic or use its arrow keys to reshape the sound. Presets keep the live playhead moving. Tuning follows continuous geometric ratios. Headphones keep live input separate from speaker output.');
    const link = document.createElement('a'); link.href = 'docs/fractal-signals.md'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'More about Fractal Synthesis ↗'; body.append(link);
  } else if (key === 'modulators') {
    $('helpTitle').textContent = 'Knob modulators';
    paragraph('Each modulator moves one selected parameter around its manual setting. Choose a destination, waveform, rate and depth, then turn it on. The thin moving needle and arrow readout show the effective value; the main knob keeps your base value. Two routes can modulate the same destination.');
    paragraph('Sine and Triangle move back and forth. Rise and Fall make ramps; at full depth, Branch angle makes a continuous circular turn. Pause freezes modulation, Restart resets both cycles, and Audio off/on retains their positions.');
  } else if (key === 'transport') {
    $('helpTitle').textContent = 'Phrase traversal';
    paragraph('Forward or Reverse chooses the initial direction through the score. Ping-pong travels out and back, playing each edge note once before turning toward the adjacent note. Loop repeats the pass, or the full round trip when Ping-pong is on. With Loop off, playback finishes and lets the final notes and delays release. Restart returns to the beginning with the same seed.');
    paragraph('Traversal direction is separate from stereo. Stereo width and Flip L/R control the finished left/right output.');
  } else if (key === 'envelope') {
    $('helpTitle').textContent = 'ADSR editor';
    paragraph('Drag Attack, Decay or Release horizontally to change that stage’s time. Drag Decay or Sustain vertically to change the sustain level. Each time stage has its own logarithmic travel, keeping very short attacks and long releases reachable together. The note’s score gate decides when release begins. The knobs provide fine adjustment of the same values.');
  } else if (key === 'microphone') {
    $('helpTitle').textContent = 'Microphone input'; paragraph(MIC_HELP[state.mode]);
    paragraph('Enable Audio and click Microphone to request access. Play runs the processing. Audio off releases the microphone. Presets keep the current input connection and never request permission. Use headphones when processing live input.');
  } else if (key === 'position') {
    $('helpTitle').textContent = 'Phrase position'; paragraph('Scrub through the current phrase. The thin line shows the audio clock; marks show event time, pitch and gate duration. Restart returns to the same deterministic beginning.');
  } else {
    const info = parameterInfo(key); $('helpTitle').textContent = info.label;
    paragraph(key === 'inputMix' ? MIC_HELP[state.mode] : info.description);
    if (key === 'engine') ENGINE_OPTIONS[state.mode].forEach(engine => paragraph(`${engine.label}: ${engine.description}`));
    if (key === 'x' || key === 'y') paragraph(modeInfo().description);
    if (Number.isFinite(info.min)) paragraph(`Range: ${format(key, info.min)} – ${format(key, info.max)}.${LOG_PARAMS.has(key) ? ' Logarithmic travel gives fine control at low values.' : ''}`);
    if (['base', 'ratio', 'span', 'depth', 'partialRatio'].includes(key)) paragraph('At high frequencies, partials above the output bandwidth are reduced or omitted to keep the sound bounded.');
  }
  if (!$('helpDialog').open) $('helpDialog').showModal();
}
listen(document, 'click', event => {
  const button = event.target.closest('[data-help]'); if (button) openHelp(button.dataset.help);
  const motionButton = event.target.closest('[data-motion-key]');
  if (motionButton) {
    const key = motionButton.dataset.motionKey, spec = MOTION_TARGETS[key];
    if (spec) updateState({ [spec.onKey]: !state[spec.onKey] });
  }
  const toggle = event.target.closest('[data-state-toggle]');
  if (toggle) updateState({ [toggle.dataset.stateToggle]: !state[toggle.dataset.stateToggle] });
});
listen($('instrumentInfo'), 'click', () => openHelp('instrument'));
listen($('closeHelp'), 'click', () => $('helpDialog').close());
listen($('copySettings'), 'click', async () => {
  const snapshot = {
    instrument: 'fractal-synthesis', version: 1, modeLabel: modeInfo().label,
    snapshot: captureSoundState(),
    source: { material: sourceName, microphone: audio.microphoneActive },
  };
  const text = JSON.stringify(snapshot, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    status('Settings copied');
  } catch {
    $('helpTitle').textContent = 'Copy settings';
    const explanation = document.createElement('p');
    explanation.textContent = 'Copy this text when sharing a sound. Include a name and what you like about it; mention any microphone or loaded-audio source.';
    const input = document.createElement('textarea');
    input.id = 'settingsText'; input.readOnly = true; input.value = text;
    input.setAttribute('aria-label', 'Complete sound settings');
    $('helpBody').replaceChildren(explanation, input);
    if (!$('helpDialog').open) $('helpDialog').showModal();
    input.focus({ preventScroll: true }); input.select();
    $('helpDialog').scrollTop = 0;
  }
});
listen($('helpDialog'), 'click', event => { if (event.target === $('helpDialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
listen($('engine'), 'change', event => updateState({ engine: event.target.value }));

for (const [index, mode] of MODES.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.mode = mode.id;
  button.setAttribute('aria-pressed', String(mode.id === state.mode));
  button.setAttribute('aria-label', mode.label);
  const glyph = document.createElement('span');
  glyph.textContent = GLYPHS[index];
  glyph.setAttribute('aria-hidden', 'true');
  button.append(glyph, document.createTextNode(mode.shortLabel));
  listen(button, 'click', () => switchMode(mode.id));
  $('demoModes').append(button);
}

function refreshControls() {
  if (controlsMode !== state.mode) buildControls();
  for (const [key, { field, rotary, mapping, help }] of fields) {
    const info = parameterInfo(key);
    field.labelElement.textContent = info.label;
    help.setAttribute('aria-label', `About ${info.label}`);
    field.setValue(mapping.encode(state[key]));
    const formatted = format(key, state[key]);
    field.output.value = formatted;
    field.input.setAttribute('aria-valuetext', formatted);
    rotary?.update();
  }
  for (const [key, button] of motionButtons) {
    const spec = MOTION_TARGETS[key], running = state[spec.onKey];
    const label = `${running ? 'Pause' : 'Play'} ${parameterInfo(key).label} motion`;
    button.setAttribute('aria-pressed', String(running)); button.setAttribute('aria-label', label); button.title = label;
    const preparing = key === 'branch' && running && !motionBank;
    button.setAttribute('aria-busy', String(preparing));
  }
  const mode = modeInfo();
  document.body.style.setProperty('--accent', mode.accent);
  document.title = 'Fractal Synthesis — Morphazoid';
  $('gestureHint').textContent = `${mode.gesture.x.toLowerCase()} ↔ · ${mode.gesture.y.toLowerCase()} ↕`;
  $('stage').setAttribute('aria-label', `${mode.label}. Drag horizontally for ${mode.gesture.x}, vertically for ${mode.gesture.y}. Arrow keys also reshape.`);
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
  $('engine').value = state.engine;
  $('synthesisFm').setAttribute('aria-pressed', String(state.synthesis === 'fm'));
  $('synthesisPm').setAttribute('aria-pressed', String(state.synthesis === 'pm'));
  refreshModulation();
  if (fields.has('bandQ')) fields.get('bandQ').wrapper.hidden = state.engine === 'resonant';
  if (state.mode === 'texture') for (const key of ['grainSize', 'spray', 'scan']) fields.get(key).wrapper.hidden = state.engine !== 'hybrid';
  if (fields.has('fold')) fields.get('fold').wrapper.hidden = state.engine !== 'folded';
  for (const key of ['loop', 'pingPong', 'pitchInvert', 'stereoFlip']) $(key)?.setAttribute('aria-pressed', String(Boolean(state[key])));
  for (let i = 1; i <= 2; i++) {
    const prefix = `lfo${i}`;
    $(`${prefix}On`).setAttribute('aria-pressed', String(state[`${prefix}On`]));
    $(`${prefix}On`).textContent = state[`${prefix}On`] ? 'On' : 'Off';
    $(`${prefix}Target`).value = state[`${prefix}Target`];
    for (const option of $(`${prefix}Target`).options) {
      option.disabled = !modulatorTargetAvailable(state, option.value);
      option.textContent = `${parameterInfo(option.value).label}${option.disabled ? ' (inactive)' : ''}`;
    }
    const available = modulatorTargetAvailable(state, state[`${prefix}Target`]);
    $(`${prefix}Status`).textContent = available ? '' : 'Choose a destination used by this engine.';
    $(`${prefix}On`).disabled = !available;
    $(`${prefix}Shape`).value = state[`${prefix}Shape`];
  }
  $('reverse').setAttribute('aria-pressed', String(state.direction < 0));
  const directionLabel = `Direction: ${state.direction < 0 ? 'reverse' : 'forward'}`;
  $('reverse').setAttribute('aria-label', directionLabel);
  $('reverse').title = directionLabel;
  $('fileSourceControls').hidden = !['grains', 'texture'].includes(state.mode);
  drawEnvelope(); refreshMicrophone();
}

function currentMotionValues() {
  const values = armed && telemetry?.motionValues ? { ...telemetry.motionValues } : motionValues(state, motions, {});
  const frame = visibleMotionFrame();
  if (frame) values.branch = frame.branch;
  if (armed && Number.isFinite(telemetry?.turns)) values.turns = telemetry.turns;
  return values;
}
function captureSoundState() {
  const result = { ...state }, values = currentMotionValues();
  for (const key of Object.keys(MOTION_TARGETS)) if (Number.isFinite(values[key])) result[key] = values[key];
  return result;
}
function stopMotionWorker() {
  clearTimeout(motionWorkerTimer); motionWorkerTimer = null;
  motionWorker?.terminate(); motionWorker = null;
}
function prepareMotionBank(previous, resetMotions) {
  const manualEdit = resetMotions || previous.mode !== state.mode || previous.branch !== state.branch;
  if (manualEdit) motionBank = null;
  if (!state.motionBranchOn) {
    stopMotionWorker(); requestedMotionKey = null;
    return;
  }
  const key = motionBankKey(state);
  if (motionBank?.stateKey === key || requestedMotionKey === key) return;
  stopMotionWorker(); requestedMotionKey = key;
  const version = ++motionBankVersion, snapshot = { ...state };
  motionWorkerTimer = setTimeout(() => {
    if (disposed || version !== motionBankVersion) return;
    const failed = () => {
      if (disposed || version !== motionBankVersion) return;
      stopMotionWorker(); requestedMotionKey = null;
      updateState({ branch: currentMotionValues().branch, motionBranchOn: false });
      status('Branching motion could not start. Try its Play button again.');
    };
    try {
      const worker = new Worker(new URL('./motion-worker.js', import.meta.url), { type: 'module' });
      motionWorker = worker;
      worker.onerror = failed;
      worker.onmessage = ({ data }) => {
        if (disposed || version !== motionBankVersion || worker !== motionWorker) return;
        if (data?.error || !data?.bank) { failed(); return; }
        motionBank = data.bank; motionBanks.set(version, motionBank);
        while (motionBanks.size > 3) motionBanks.delete(motionBanks.keys().next().value);
        requestedMotionKey = null; stopMotionWorker();
        audio.setMotionBank(motionBank);
        refreshControls();
      };
      worker.postMessage({ state: snapshot, version });
    } catch { failed(); }
  }, 60);
}
function visibleMotionFrame() {
  if (armed && telemetry) {
    const bank = motionBanks.get(telemetry.motionBankVersion);
    return bank?.mode === state.mode ? bank.frames[telemetry.motionFrameIndex] ?? null : null;
  }
  if (!motionBank || motionBank.mode !== state.mode) return null;
  return motionBank.frames[selectMotionFrame(motionBank, motionValues(state, motions, {}).branch)] ?? null;
}
function visibleStructure() { return visibleMotionFrame()?.structure ?? structure; }
function updateState(patch, { resetMotions = false } = {}) {
  const previous = state;
  state = sanitizeState({ ...state, ...patch });
  rebaseMotions(motions, previous, state, { resetMotions });
  transport.motions = motionSnapshot(motions);
  telemetry = null;
  modulatorSlots = modulatorSettings(state);
  structure = generateStructure(state, { turnsGeometry: state.mode === 'grammar' });
  prepareMotionBank(previous, resetMotions);
  modeMemory.set(state.mode, { ...state });
  audio.setState(state, structure, { resetMotions, motionBankVersion });
  refreshControls();
  presetController?.refresh();
}

function applyPreset(snapshot) {
  modeMemory.set(state.mode, captureSoundState());
  updateState(snapshot, { resetMotions: true });
  history.replaceState(null, '', `${location.pathname}${location.search}#${modeInfo().label}`);
}

function switchMode(id) {
  if (!modeIds.has(id) || id === state.mode) return;
  modeMemory.set(state.mode, captureSoundState());
  const next = modeMemory.get(id) ?? openingPreset(id)?.snapshot ?? createDefaultState(id);
  applyPreset(next);
}

presetController = registerHeaderPresets({ id: 'fractal-signals', presets: FACTORY_PRESETS,
  host: $('mainPresets'), capture: captureSoundState, apply: applyPreset,
  randomize: (snapshot, random) => randomizeState(snapshot, random),
});
refreshControls();
listen($('synthesisFm'), 'click', () => updateState({ synthesis: 'fm' }));
listen($('synthesisPm'), 'click', () => updateState({ synthesis: 'pm' }));
listen($('playButton'), 'click', () => setPlaying(!playing));
listen($('reverse'), 'click', () => updateState({ direction: -state.direction }));
listen($('loop'), 'click', () => updateState({ loop: !state.loop }));
listen($('pingPong'), 'click', () => updateState({ pingPong: !state.pingPong }));
listen($('restart'), 'click', () => { resetVisualTransport(); audio.setPhase(0); reflectPlaying(playing); });
listen($('position'), 'input', event => { resetVisualTransport(Number(event.target.value), transport.travelDirection); audio.setPhase(phase, transport); reflectPlaying(playing); });
listen(window, 'hashchange', () => switchMode(location.hash.slice(1)));

function stagePoint(event) {
  const rect = $('stage').getBoundingClientRect();
  const bounds = plotBounds(rect.width, rect.height);
  return { x: clamp((event.clientX - rect.left - bounds.x) / bounds.w, 0, 1),
    y: clamp(1 - (event.clientY - rect.top - bounds.y) / bounds.h, 0, 1) };
}
listen($('stage'), 'pointerdown', event => {
  if (event.button !== 0 || activePointer !== null) return;
  activePointer = event.pointerId;
  $('stage').setPointerCapture(event.pointerId);
  $('stage').focus({ preventScroll: true });
  updateState(stagePoint(event));
});
listen($('stage'), 'pointermove', event => { if (activePointer === event.pointerId) updateState(stagePoint(event)); });
function releasePointer(event) {
  if (activePointer !== event.pointerId) return;
  if ($('stage').hasPointerCapture(event.pointerId)) $('stage').releasePointerCapture(event.pointerId);
  activePointer = null;
}
listen($('stage'), 'pointerup', releasePointer);
listen($('stage'), 'pointercancel', releasePointer);
listen($('stage'), 'lostpointercapture', () => { activePointer = null; });
listen($('stage'), 'keydown', event => {
  const delta = event.shiftKey ? .005 : .025;
  const offsets = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
  if (!offsets[event.key]) return;
  event.preventDefault();
  const [dx, dy] = offsets[event.key];
  updateState({ x: state.x + dx, y: state.y + dy });
});

listen($('loadSource'), 'click', () => $('sourceFile').click());
listen($('sourceFile'), 'change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const request = ++sourceRequest;
  if (file.size > 30 * 1024 * 1024) { status('Choose an audio file smaller than 30 MB.'); return; }
  $('loadSource').disabled = true;
  status('Reading local audio…');
  try {
    const encoded = await file.arrayBuffer();
    const decoder = new OfflineAudioContext(1, 1, 48000);
    const decoded = await decoder.decodeAudioData(encoded);
    if (disposed || request !== sourceRequest) return;
    const length = Math.min(decoded.length, 576000, Math.round(decoded.sampleRate * 12));
    const mono = new Float32Array(length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const samples = decoded.getChannelData(channel);
      for (let i = 0; i < length; i++) mono[i] += samples[i] / decoded.numberOfChannels;
    }
    sourceProfile = analyzeTexture(mono, decoded.sampleRate);
    source = mono;
    sourceRate = decoded.sampleRate;
    sourceName = file.name;
    audio.setSource(source, sourceRate, sourceProfile);
    $('sourceStatus').textContent = `${file.name} · ${(length / sourceRate).toFixed(1)} s · spectral and envelope profile loaded`;
    status('Source ready · current phrase preserved');
  } catch (error) { status(`Could not read this audio: ${error.message}`); }
  finally { $('loadSource').disabled = false; event.target.value = ''; }
});
listen($('clearSource'), 'click', () => {
  sourceRequest++;
  source = builtinSource;
  sourceProfile = builtinProfile;
  sourceRate = 16000;
  sourceName = 'Built-in synthetic source';
  audio.setSource(source, sourceRate, sourceProfile);
  $('sourceStatus').textContent = 'Original synthetic material. Local files stay on this device.';
  status('Built-in source restored');
});
listen(window, 'morphazoid:midi-input', event => {
  const message = event.detail?.message ?? event.detail;
  if (message?.type === 'noteOn' && message.velocity !== 0) {
    updateState({ base: 440 * 2 ** ((Number(message.note) - 69) / 12) });
    event.preventDefault();
  }
});

function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.75, devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  return { context, width: rect.width, height: rect.height };
}

function plotBounds(width, height) { return { x: 24, y: 25, w: Math.max(1, width - 48), h: Math.max(1, height - 76) }; }
function circle(ctx, x, y, radius, color, fill = true) {
  ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU);
  if (fill) { ctx.fillStyle = color; ctx.fill(); } else { ctx.strokeStyle = color; ctx.stroke(); }
}

function refreshModulationDisplay() {
  const direct = currentMotionValues();
  const values = armed && telemetry ? telemetry.modValues ?? {} : modulatedValues({ ...state, ...direct }, modulatorSlots, transport.modPhases, visualModulation);
  const frame = visibleMotionFrame();
  if (frame) direct.branch = frame.branch;
  displayedBranchAngle = armed && telemetry ? telemetry.branchAngle ?? direct.branchAngle : values.branchAngle ?? direct.branchAngle;
  if (state.mode === 'grammar') {
    const current = visibleStructure(), turns = armed && telemetry ? telemetry.turns ?? direct.turns : direct.turns;
    displayedBranchGeometry = current.branchTurns && turns !== current.branchTurns.turns
      ? branchTurnsGeometry(current.branchTurns, turns, visibleTurnsTarget) : current.branchGeometry;
    branchFrame(displayedBranchGeometry, displayedBranchAngle, visibleBranchFrame);
  }
  for (const [key] of Object.entries(MOTION_TARGETS)) {
    const entry = fields.get(key), value = direct[key];
    if (!entry || !Number.isFinite(value)) continue;
    entry.field.setValue(entry.mapping.encode(value));
    entry.field.output.value = format(key, value);
    entry.field.input.setAttribute('aria-valuetext', format(key, value));
    entry.rotary?.update();
  }
  for (const [key, { rotary, mapping, modOutput }] of fields) {
    const active = modulatorSlots.some(slot => slot.enabled && slot.depth > 0 && slot.target === key);
    const value = active && Number.isFinite(values[key]) ? values[key] : null;
    rotary?.setModulation(value === null ? null : mapping.encode(value));
    modOutput.hidden = value === null;
    if (value !== null) modOutput.textContent = `↝ ${format(key, value)}`;
  }
  return values;
}

function drawStage(now) {
  const structure = visibleStructure();
  const { context: ctx, width, height } = sizeCanvas($('stage'));
  const b = plotBounds(width, height);
  const accent = modeInfo().accent;
  const project = (point, index) => [b.x + point.x * b.w, b.y + (1 - (state.mode === 'grammar' && Number.isInteger(index) ? branchShape(displayedBranchGeometry, index, visibleBranchFrame) : point.y)) * b.h];
  const readPhase = phase; // Direction is already encoded by the model.
  ctx.strokeStyle = '#14201b'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = b.y + b.h * i / 4;
    ctx.beginPath(); ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); ctx.stroke();
  }
  if (state.mode === 'texture') {
    const liveBands = audio.microphoneActive ? telemetry?.inputBands : null;
    const maximum = liveBands ? Math.max(.00001, ...liveBands) : 1;
    const bands = liveBands ? Array.from(liveBands, value => value / maximum) : sourceProfile?.bands;
    for (let i = 0; i < 16; i++) {
      const value = bands?.[i] ?? 0;
      const barW = b.w / 16;
      const amplitude = clamp(value, .02, 1);
      ctx.globalAlpha = .2 + .65 * amplitude;
      ctx.fillStyle = accent;
      ctx.fillRect(b.x + i * barW + 2, b.y + b.h * (1 - amplitude), barW - 4, b.h * amplitude);
    }
    ctx.globalAlpha = 1;
  }
  for (const edge of structure.edges ?? []) {
    const a = structure.points[edge[0]]; const c = structure.points[edge[1]];
    if (!a || !c) continue;
    const [ax, ay] = project(a, edge[0]); const [cx, cy] = project(c, edge[1]);
    const passed = transport.travelDirection > 0 ? (c.phase ?? 0) <= readPhase : (c.phase ?? 0) >= readPhase;
    ctx.strokeStyle = accent;
    ctx.globalAlpha = passed ? .82 : .48;
    ctx.lineWidth = Math.max(.7, 2.2 - (c.depth ?? 1) * .22);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cx, cy); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  let closest = null; let distance = Infinity;
  const completionAge = Math.max(0, (now - completedAt) / 1000);
  const showingCompletion = transport.completed && completionAge < .14
    && structure.events.some(event => Math.abs(readPhase - event.phase) <= 1e-9);
  for (const event of structure.events ?? []) {
    const point = structure.points[event.point];
    if (!point) continue;
    const [x, y] = project(point, event.point);
    const signedAge = (readPhase - event.phase) * transport.travelDirection;
    // A reflected leg has no circular seam: an event ahead of the cursor has
    // not played yet. Keep this rule while finishing a return after Ping-pong
    // is switched off, too. The model already encodes Forward/Reverse.
    const age = state.pingPong || transport.travelDirection < 0
      ? signedAge >= -1e-9 ? Math.max(0, signedAge) : Infinity
      : wrap(signedAge);
    const finalOnset = showingCompletion && Math.abs(readPhase - event.phase) <= 1e-9;
    const ageSeconds = finalOnset ? completionAge : age * state.phrase / state.rate;
    const lit = (playing || finalOnset) && ageSeconds < .14;
    if (age < distance) { distance = age; closest = event; }
    if (lit) {
      circle(ctx, x, y, 10 + Math.max(0, 1 - ageSeconds / .14) * 9, `${accent}16`);
      circle(ctx, x, y, 3.5 + event.amp * 3, accent);
      circle(ctx, x, y, 2, '#f0fff6');
    } else if (state.mode !== 'waveform' && state.mode !== 'wander') {
      circle(ctx, x, y, state.mode === 'grains' ? 1.5 + event.amp * 4 : 2, '#467663');
    }
  }
  if (state.mode === 'echoes' && state.engine === 'shepard') {
    const sweepPhase = Number.isFinite(transport.phaseClocks?.shepard)
      ? transport.phaseClocks.shepard : transport.motionTime * state.sweepRate * state.direction / 7;
    for (let i = 0; i < state.depth; i++) {
      const p = wrap(sweepPhase + i / 12 + state.y * .1);
      const radius = Math.min(b.w, b.h) * (.12 + p * .35);
      ctx.globalAlpha = Math.sin(Math.PI * p) ** 2 * .35;
      circle(ctx, b.x + b.w / 2, b.y + b.h / 2, radius, accent, false);
    } ctx.globalAlpha = 1;
  }
  const hx = b.x + state.x * b.w; const hy = b.y + (1 - state.y) * b.h;
  ctx.setLineDash([3, 5]); ctx.strokeStyle = '#81b798'; ctx.globalAlpha = .28;
  ctx.beginPath(); ctx.moveTo(b.x, hy); ctx.lineTo(b.x + b.w, hy); ctx.moveTo(hx, b.y); ctx.lineTo(hx, b.y + b.h); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  circle(ctx, hx, hy, 10, '#091410'); circle(ctx, hx, hy, 9, accent, false); circle(ctx, hx, hy, 3, accent);
  $('inputMeter').value = audio.microphoneActive ? clamp(telemetry?.inputRms ?? 0, 0, 1) : 0;
  const currentFrequency = closest && state.mode === 'grammar' ? state.base * 2 ** (branchPitch(displayedBranchGeometry, closest.point, visibleBranchFrame) * state.span * (state.pitchInvert ? -1 : 1)) : closest?.freq;
  $('frequencyReadout').textContent = state.mode !== 'texture' && closest && (playing || showingCompletion) ? `score ${Math.round(clamp(currentFrequency, 20, 20000))} Hz` : `root ${Math.round(state.base)} Hz`;
}

function drawScore() {
  const structure = visibleStructure();
  const { context: ctx, width, height } = sizeCanvas($('score'));
  const accent = modeInfo().accent;
  const readPhase = phase; // Direction is already encoded by the model.
  ctx.fillStyle = '#0d1510'; ctx.fillRect(0, 0, width, height);
  for (let i = 0; i <= state.phrase; i++) {
    const x = i / state.phrase * width;
    ctx.strokeStyle = i % 4 === 0 ? '#2a3e31' : '#15251b';
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (const event of structure.events ?? []) {
    const eventFrequency = state.mode === 'grammar' ? state.base * 2 ** (branchPitch(displayedBranchGeometry, event.point, visibleBranchFrame) * state.span * (state.pitchInvert ? -1 : 1)) : event.freq;
    const pitch = clamp(.5 + Math.log2(Math.max(1, eventFrequency) / state.base) / Math.max(1, state.span * 2), 0, 1);
    const x = event.phase * width;
    const y = 5 + (1 - pitch) * (height - 13);
    const duration = Math.min(width * .1, Math.max(2, event.duration * state.rate / state.phrase * width));
    ctx.globalAlpha = .25 + event.amp * .65; ctx.fillStyle = accent;
    ctx.fillRect(x, y, duration, 2.5);
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#edfff4'; ctx.fillRect(readPhase * width, 0, 1.5, height);
  if (document.activeElement !== $('position')) $('position').value = phase;
  $('phraseReadout').textContent = `${(phase * state.phrase).toFixed(1)} / ${state.phrase}`;
  $('transportState').textContent = playing ? `${state.direction * transport.travelDirection > 0 ? '→' : '←'} playing` : transport.completed ? 'finished' : 'paused';
}

function frame(now) {
  if (disposed) return;
  const dt = Math.min(.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!armed) {
    advanceMotions(motions, state, dt, { branchReady: Boolean(motionBank) });
    transport.motions = motionSnapshot(motions);
    if (playing) advanceVisualTransport(dt);
  }
  if (now - lastPaint > 33 && !document.hidden) { refreshModulationDisplay(); drawStage(now); drawScore(); lastPaint = now; }
  frameHandle = requestAnimationFrame(frame);
}
frameHandle = requestAnimationFrame(frame);

// Read-only QA seam. Performance state is changed through native controls.
globalThis.__fractalSignals = Object.freeze({
  get state() { return { ...state }; }, get structure() { return structuredClone(visibleStructure()); },
  get playing() { return playing; }, get armed() { return armed; }, get phase() { return phase; },
  get transport() { return { ...transport }; },
  get motionValues() { return currentMotionValues(); },
  get branchGeometry() { return structuredClone(displayedBranchGeometry); },
  get telemetry() { return telemetry ? { ...telemetry } : null; }, get audio() { return audio; },
});

async function dispose() {
  if (disposed) return;
  disposed = true; sourceRequest++;
  stopMotionWorker(); motionBanks.clear(); motionBank = null;
  abort.abort(); cancelAnimationFrame(frameHandle);
  presetController?.destroy();
  envelopeControl?.destroy();
  for (const { field, rotary } of fields.values()) { rotary?.destroy(); field.destroy(); }
  strip.destroy();
  await audio.destroy();
}
listen(window, 'pagehide', event => {
  if (!event.persisted) { void dispose(); return; }
  cancelAnimationFrame(frameHandle);
  armed = false;
  telemetry = null;
  strip.setAudioState('off');
  void audio.stop();
  refreshMicrophone();
});
listen(window, 'pageshow', event => {
  if (!event.persisted || disposed) return;
  lastFrame = performance.now();
  cancelAnimationFrame(frameHandle);
  frameHandle = requestAnimationFrame(frame);
  status('Audio off · press Audio to resume sound');
});
