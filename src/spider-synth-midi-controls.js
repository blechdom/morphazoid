import { getSharedMidiManager } from './midi-manager.js';
import { SPIDER_BODY_GROUPS } from './spider-synth-body.js';
import { SPIDER_MIDI_GESTURES } from './spider-synth-midi.js';

export const SPIDER_MIDI_ROUTE_DEFAULTS = Object.freeze([
  'param:tension', 'param:damping', 'param:brightness', 'param:coupling',
  'joint:legs:y', 'joint:abdomen:x', 'joint:cephalothorax:y', 'joint:pedipalps:x',
]);
const KEY = 'morphazoid:spider-midi:v1';
const PARAMS = [
  ['intensity', 'Movement'], ['tempo', 'Tempo'], ['tune', 'Tuning'], ['brightness', 'Brightness'],
  ['tension', 'Silk tension'], ['damping', 'Damping'], ['coupling', 'Coupling'], ['decay', 'Decay'],
  ['body', 'Body resonance'], ['pan', 'Pan'], ['voice', 'Voice level'], ['level', 'Master level'],
];
const ACTIONS = [
  ['speakButton', 'Say phrase'], ['soundPlayButton', 'Sound play / pause'], ['motionButton', 'Animation play / pause'],
  ['nextMotion', 'Next animation'], ['previousMotion', 'Previous animation'],
  ['randomSound', 'Random sound'], ['randomMotion', 'Random animation'], ['randomPose', 'Random body pose'],
];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));
const wrap = (value, length) => ((value % length) + length) % length;

/** Own only Spider's public MIDI event; the shared toolbar owns permission,
 * controller profiles and keyboard input in both browser and WAX builds. */
export function createSpiderMidiControls({ audio, setPlaying, selectGroup, onVisual,
  runtime = window, document: doc = runtime.document }) {
  const el = id => doc.getElementById(id);
  const listeners = new AbortController(), options = { signal: listeners.signal };
  let disposed = false, routes = [...SPIDER_MIDI_ROUTE_DEFAULTS];
  let visualUntil = 0, lastLabel = 'MIDI poses ready', managerEnabled = false;
  const edgeScopes = new Map();
  function edgesFor(message) {
    const key = `${String(message.sourceId ?? 'midi').slice(0, 128)}:${message.channel ?? 0}`;
    if (!edgeScopes.has(key)) {
      if (edgeScopes.size >= 64) edgeScopes.delete(edgeScopes.keys().next().value);
      edgeScopes.set(key, { sourceId: message.sourceId, channel: message.channel ?? 0, values: new Uint8Array(8) });
    }
    return edgeScopes.get(key).values;
  }
  function clearEdges(message) {
    if (message?.synthetic && message.sourceId === 'web-midi:manager') message = null;
    for (const [key, scope] of edgeScopes) {
      if (!message || (scope.sourceId === message.sourceId
        && (message.synthetic || scope.channel === (message.channel ?? 0)))) edgeScopes.delete(key);
    }
  }
  const validTargets = new Set();
  const groups = [
    ['Sound & motion', PARAMS.map(([id, label]) => [`param:${id}`, label])],
    ['Body rotations', SPIDER_BODY_GROUPS.slice(0, 5).flatMap(({ id, label }) => ['x', 'y', 'z'].map(axis => [`joint:${id}:${axis}`, `${label} · ${axis.toUpperCase()}`]))],
    ['Body levels', SPIDER_BODY_GROUPS.map(({ id, label }) => [`mix:${id}`, `${label} level`])],
    ['Body sounds', SPIDER_BODY_GROUPS.map(({ id, label }) => [`source:${id}`, `${label} sound`])],
    ['Presets', [['select:soundPreset', 'Sound preset'], ['select:motionPreset', 'Animation preset']]],
    ['Buttons · cross halfway to trigger', ACTIONS.map(([id, label]) => [`action:${id}`, label])],
  ];
  for (const [, values] of groups) for (const [id] of values) validTargets.add(id);
  try {
    const saved = JSON.parse(runtime.localStorage.getItem(KEY));
    if (saved?.version === 1) {
      routes = routes.map((fallback, i) => validTargets.has(saved.routes?.[i]) ? saved.routes[i] : fallback);
    }
  } catch {}
  function save() {
    try { runtime.localStorage.setItem(KEY, JSON.stringify({ version: 1, routes })); } catch {}
  }
  function wake() { visualUntil = runtime.performance.now() + 600; onVisual(); }
  function range(id, normalized) {
    const input = el(id); if (!input || input.disabled) return;
    const low = Number(input.min), high = Number(input.max), step = Number(input.step) || .01;
    const raw = id === 'tune' || id === 'tension' ? low * (high / low) ** normalized : low + (high - low) * normalized;
    const value = clamp(Math.round((raw - low) / step) * step + low, low, high);
    if (Math.abs(Number(input.value) - value) < step * .1) return;
    input.value = String(value); input.dispatchEvent(new runtime.Event('input', { bubbles: true }));
  }
  function select(id, normalized, program = false) {
    const input = el(id); if (!input || input.disabled) return;
    const choices = [...input.options].filter(option => !['custom', 'random', ''].includes(option.value));
    if (!choices.length) return;
    const index = program ? wrap(Math.floor(normalized), choices.length) : Math.min(choices.length - 1, Math.floor(normalized * choices.length));
    if (input.value === choices[index].value) return;
    input.value = choices[index].value; input.dispatchEvent(new runtime.Event('change', { bubbles: true }));
  }
  function panic() {
    audio.resetMidi(); clearEdges();
    lastLabel = 'MIDI released'; el('midiStatus').textContent = lastLabel; wake();
  }
  function applyMacro(index, value, message) {
    if (index < 0 || index >= routes.length) return;
    const target = routes[index], [kind, id, axis] = target.split(':'), edges = edgesFor(message);
    if (kind === 'joint') {
      const raw = Math.round(value * 127);
      audio.midiControl(id, axis, (raw - 64) / (raw < 64 ? 64 : 63), message); selectGroup(id); wake();
    } else if (kind === 'param') range(id, value);
    else if (kind === 'mix') range(`mix-${id}`, value);
    else if (kind === 'source') select(`source-${id}`, value);
    else if (kind === 'select') select(id, value);
    else if (kind === 'action' && value >= .5 && !edges[index]) el(id)?.click();
    edges[index] = value >= .5 ? 1 : 0;
    lastLabel = `Macro ${index + 1} · ${el(`midiRoute${index}`).selectedOptions[0].textContent}`;
    el('midiStatus').textContent = lastLabel;
  }
  function handle(event) {
    const detail = event.detail, message = detail?.message;
    if (!message || (detail.routeId && detail.routeId !== 'spider-synth') || disposed) return;
    const type = message.type;
    if (['noteOn', 'noteOff', 'pitchBend', 'channelPressure', 'polyPressure', 'polyAftertouch', 'channelAftertouch', 'controlChange', 'programChange', 'start', 'continue', 'stop'].includes(type)) event.preventDefault();
    else return; // Clock uses the shared per-device 24-PPQN tempo tracker.
    if (type === 'noteOn' || type === 'noteOff') {
      if (!Number.isInteger(message.note) || message.note < 0 || message.note > 127) return;
      const attack = type === 'noteOn' && message.velocity > 0;
      audio.midi({ ...message, kind: 'body' });
      if (attack) {
        const gesture = SPIDER_MIDI_GESTURES[message.note % 12];
        lastLabel = `${NOTE_NAMES[message.note % 12]}${Math.floor(message.note / 12) - 1} · ${gesture.label}`;
        el('midiStatus').textContent = lastLabel;
        selectGroup(gesture.groupId, gesture.side, gesture.id);
      }
      wake(); return;
    }
    if (type === 'controlChange') {
      const cc = message.controller, value = clamp(message.value / 127, 0, 1);
      // Hardware profiles own overlaps, e.g. Arturia CC74 is Macro 1.
      if (message.logical?.type === 'macro') { applyMacro(message.logical.index, value, message); return; }
      if (cc >= 14 && cc <= 21 && !message.profileId) { applyMacro(cc - 14, value, message); return; }
      if ([11, 64, 120, 121, 123].includes(cc)) {
        audio.midi(message); wake();
        if ([120, 121, 123].includes(cc)) clearEdges(message);
        return;
      }
      const parameter = { 1: 'intensity', 7: 'level', 10: 'pan', 71: 'body', 74: 'brightness' }[cc];
      if (parameter) range(parameter, value);
      return;
    }
    if (type === 'programChange') { select('soundPreset', message.program ?? message.value ?? 0, true); return; }
    if (type === 'start' || type === 'continue' || type === 'stop') {
      setPlaying(type !== 'stop', { restart: type === 'start' }); wake(); return;
    }
    audio.midi(message); wake();
  }
  for (let i = 0; i < routes.length; i += 1) {
    const label = doc.createElement('label'), copy = doc.createElement('span'), input = doc.createElement('select');
    copy.textContent = `Macro ${i + 1}`; input.id = `midiRoute${i}`; input.setAttribute('aria-label', `MIDI Macro ${i + 1} target`);
    for (const [title, values] of groups) {
      const group = doc.createElement('optgroup'); group.label = title;
      for (const [id, name] of values) group.append(new runtime.Option(name, id));
      input.append(group);
    }
    input.value = routes[i]; label.append(copy, input); el('midiMacroRoutes').append(label);
    input.addEventListener('change', () => {
      // A reassigned knob must not leave its old body axis stranded.
      const [kind, group, axis] = routes[i].split(':');
      if (kind === 'joint') audio.midiControl(group, axis, 0);
      routes[i] = input.value; for (const scope of edgeScopes.values()) scope.values[i] = 0; save(); wake();
    }, options);
  }
  for (const [i, gesture] of SPIDER_MIDI_GESTURES.entries()) {
    const note = doc.createElement('dt'), part = doc.createElement('dd');
    note.textContent = NOTE_NAMES[i]; part.textContent = gesture.label; el('midiKeyMap').append(note, part);
  }
  el('midiPanic').addEventListener('click', panic, options);
  el('midiResetRoutes').addEventListener('click', () => {
    panic(); routes = [...SPIDER_MIDI_ROUTE_DEFAULTS]; routes.forEach((id, i) => { el(`midiRoute${i}`).value = id; }); save();
  }, options);
  runtime.addEventListener('morphazoid:midi-input', handle, options);
  runtime.addEventListener('pagehide', panic, options);
  const unsubscribe = getSharedMidiManager(runtime).subscribeStatus(status => {
    if (!status.enabled && managerEnabled) panic();
    managerEnabled = status.enabled;
  });
  return Object.freeze({
    getState: () => ({ routes: [...routes], ...audio.getMidiState(), lastLabel }),
    isAnimating: () => !disposed && (runtime.performance.now() < visualUntil || audio.midiPerformance.hasActivity(audio.clock())),
    syncRig: wake, panic,
    dispose() { if (disposed) return; panic(); disposed = true; listeners.abort(); unsubscribe(); },
  });
}
