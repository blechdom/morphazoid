import { MIDI_PARAMETER_FIELDS, MIDI_CC_PARAMETERS, MIDI_GENERATOR_PARAMETERS, MIDI_SYNTH_EFFECT_PARAMETERS,
  sanitizeMidiParameters, sanitizeMidiSynthEffects } from './midi-mixer-parameters.js';

const clamp = (v, min, max, fallback) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const channel = (id, patch = {}) => ({ channel: id, mute: false, solo: false, program: null, ...patch, midi: sanitizeMidiParameters(patch.midi) });
const deck = (config = {}, channels = []) => ({ config: { gain: 1, rate: 1, transpose: 0, offsetBeats: 0, loop: true, mute: false, loopStartBeats: 0, loopEndBeats: null, ...config, midi: sanitizeMidiParameters(config.midi) },
  channels: Array.from({ length: 16 }, (_, id) => channel(id, channels.find(item => item.channel === id))) });
export function captureMixerPreset(state) {
  return { version: 2, tempo: clamp(state.tempo, 30, 300, 120), crossfade: clamp(state.crossfade, -1, 1, 0),
    effects: { filterHz: clamp(state.effects?.filterHz, 60, 20000, 20000), delayMix: clamp(state.effects?.delayMix, 0, .75, 0),
      delayBeats: clamp(state.effects?.delayBeats, .125, 4, .5), feedback: clamp(state.effects?.feedback, 0, .8, .3), synth: sanitizeMidiSynthEffects(state.effects?.synth) },
    decks: [0, 1].map(index => {
      const value = state.decks?.[index], config = value?.config ?? {};
      const result = deck({ rate: clamp(config.rate, .25, 8, 1), gain: clamp(config.gain, 0, 2, 1), transpose: Math.round(clamp(config.transpose, -24, 24, 0)), midi: config.midi,
        offsetBeats: clamp(config.offsetBeats, -4000000, 4000000, 0), loop: config.loop !== false, mute: Boolean(config.mute),
        loopStartBeats: clamp(config.loopStartBeats, 0, 1000000, 0),
        loopEndBeats: config.loopEndBeats == null ? null : Math.max(clamp(config.loopStartBeats, 0, 1000000, 0) + 1 / 32, clamp(config.loopEndBeats, 0, 1000000, 1)) },
      (value?.channels ?? []).map(item => channel(item.channel, { mute: Boolean(item.mute), solo: Boolean(item.solo),
        program: Number.isInteger(item.program) && item.program >= 0 && item.program < 128 ? item.program : null, midi: item.midi })));
      for (const item of value?.channels ?? []) if (item.channel >= 16 && item.channel < 4096 && Number.isInteger(item.channel)) { const normalized = channel(item.channel, {
        mute: Boolean(item.mute), solo: Boolean(item.solo), program: Number.isInteger(item.program) && item.program >= 0 && item.program < 128 ? item.program : null, midi: item.midi });
        const base = result.channels[item.channel % 16];
        if (normalized.mute !== base.mute || normalized.solo !== base.solo || normalized.program !== base.program || JSON.stringify(normalized.midi) !== JSON.stringify(base.midi)) result.channels.push(normalized);
      }
      return result;
    }) };
}
function replacementMidi(previous = {}, next = {}) {
  const result = Object.fromEntries(Object.keys(previous).map(key => [key, null]));
  Object.assign(result, next);
  for (const key of ['controllers', 'generators']) if (next[key]) result[key] = { ...Object.fromEntries(Object.keys(previous[key] || {}).map(id => [id, null])), ...next[key] };
  return result;
}
export function applyMixerPreset(engine, snapshot) {
  if (![1, 2].includes(snapshot?.version) || !Array.isArray(snapshot.decks) || snapshot.decks.length !== 2) throw new Error('Invalid MIDI Mixer preset.');
  const next = captureMixerPreset(snapshot), previous = engine.state;
  engine.setTempo(next.tempo); engine.setCrossfade(next.crossfade); engine.configureEffects({ ...next.effects, synth: { ...Object.fromEntries(Object.keys(previous.effects?.synth || {}).map(key => [key, null])), ...next.effects.synth } });
  next.decks.forEach((value, index) => {
    for (const setting of engine.state.decks[index]?.channels ?? []) if (!value.channels.some(item => item.channel === setting.channel)) {
      value.channels.push(channel(setting.channel, { ...value.channels[setting.channel % 16], channel: setting.channel }));
    }
    engine.configureDeck(index, { ...value.config, midi: replacementMidi(previous.decks[index].config.midi, value.config.midi) });
    value.channels.forEach(item => engine.configureChannel(index, item.channel, { ...item, midi: replacementMidi(previous.decks[index].channels.find(channel => channel.channel === item.channel)?.midi, item.midi) }));
  });
  return next;
}
const only = predicate => Array.from({ length: 16 }, (_, id) => channel(id, { mute: !predicate(id) }));
const drums = only(id => id === 9), melody = only(id => id !== 9);
const preset = (id, label, description, tempo = 120, a = deck(), b = deck(), crossfade = 0) =>
  ({ id, label, description, snapshot: { version: 2, tempo, crossfade, effects: { filterHz: 20000, delayMix: 0, delayBeats: .5, feedback: .3, synth: {} }, decks: [a, b] } });
export const MIDI_MIXER_PRESETS = [
  preset('open-pair', 'Open pair', 'Both arrangements, original instruments, one tempo.'),
  preset('a-rhythm', 'A rhythm · B melody', 'Drum channel from A, melodic channels from B.', 120, deck({}, drums), deck({}, melody)),
  preset('b-rhythm', 'A melody · B rhythm', 'Melodic channels from A, drum channel from B.', 120, deck({}, melody), deck({}, drums)),
  preset('double-drums', 'Double-time drums', 'A drums at double time; B melody at half time.', 126, deck({ rate: 2 }, drums), deck({ rate: .5 }, melody), 0),
  preset('melody-pair', 'No drums', 'Combine both files’ melodic channels.', 110, deck({}, melody), deck({}, melody)),
  preset('octave-room', 'Octave room', 'A moves an octave down, B an octave up.', 100, deck({ transpose: -12, gain: .75 }, melody), deck({ transpose: 12, gain: .7 }, melody), 0),
  preset('slipped-beat', 'Slipped beat', 'B enters one beat later against A.', 132, deck(), deck({ offsetBeats: -1, gain: .8 }), -.15),
  preset('answer-bar', 'Answer one bar later', 'A drum groove with B’s melody slipped four beats.', 112, deck({}, drums), deck({ offsetBeats: -4 }, melody)),
  preset('fifth-up', 'Fifth up', 'Move B’s melodic pitches up seven semitones.', 124, deck({ gain: .8 }), deck({ transpose: 7, gain: .65 }, melody)),
  preset('slow-machine', 'Slow machine', 'A spacious 64 BPM mix with low A and delayed B.', 64, deck({ transpose: -12, gain: .8 }), deck({ offsetBeats: -2, gain: .7 }), -.1),
  preset('fast-collision', 'Fast collision', 'A 190 BPM collision, B shifted down five semitones.', 190, deck({ gain: .7 }), deck({ transpose: -5, offsetBeats: .25, gain: .7 }), 0),
  preset('a-leading', 'A leading', 'A in front, B’s high melody tucked underneath.', 118, deck(), deck({ transpose: 12, gain: .7 }, melody), -.55),
  preset('wide-wires', 'Wide wires', 'Voices lean left and right with a small tuning difference.', 118, deck({ midi: { pan: -.6, fineTune: -17 } }), deck({ midi: { pan: .6, fineTune: 17 }, gain: .8 })),
  preset('velvet-cut', 'Velvet cut', 'SoundFont filters and a soft attack reshape both arrangements.', 108, deck({ midi: { generators: { 8: 7600, 34: -3600, 38: -1200 } } }), deck({ midi: { generators: { 8: 9000, 34: -4800, 38: -2400 } }, gain: .8 })),
  preset('rubber-wire', 'Rubber wire', 'A slow pitch LFO bends the first arrangement against the second.', 126, deck({ midi: { generators: { 5: 180, 22: -1200 } }, gain: .75 }), deck({ midi: { fineTune: 23 }, gain: .75 })),
  preset('chorus-fog', 'Chorus fog', 'Wide SoundFont chorus and reverb around both sources.', 102, deck({ midi: { controllers: { 91: 64, 93: 100 } }, gain: .7 }), deck({ midi: { controllers: { 91: 80, 93: 80 } }, gain: .7 })),
  preset('velocity-fold', 'Velocity fold', 'Soft attacks in A and a compressed velocity range in B.', 128, deck({ midi: { velocityScale: .6, velocityOffset: 8 } }), deck({ midi: { velocityScale: .35, velocityOffset: 55 }, gain: .7 })),
];
// These scenes change the same audible filter/echo controls available during a set.
MIDI_MIXER_PRESETS.find(item => item.id === 'slow-machine').snapshot.effects = { filterHz: 2600, delayMix: .28, delayBeats: .75, feedback: .38 };
MIDI_MIXER_PRESETS.find(item => item.id === 'fifth-up').snapshot.effects = { filterHz: 10000, delayMix: .16, delayBeats: .5, feedback: .26 };
MIDI_MIXER_PRESETS.find(item => item.id === 'chorus-fog').snapshot.effects.synth = { 'chorus.depth': 50, 'chorus.rate': 14, 'chorus.level': 80, 'reverb.time': 90, 'reverb.level': 70 };

function randomizedMidi(current, unit, { programs = true } = {}) {
  const original = sanitizeMidiParameters(current), result = {};
  const valueIn = (min, max, step = 1) => { const value = min + unit() * (max - min); return step === 1 ? Math.round(value) : value; };
  const ranges = { gain: [.6, 1.1], pan: [-.8, .8], transpose: [-12, 12], fineTune: [-60, 60], velocityScale: [.4, 1.5], velocityOffset: [-15, 25],
    program: [0, 127], bankMSB: [0, 1], bankLSB: [0, 2], bend: [6144, 10240], bendRange: [1, 12], pressure: [0, 80], polyPressure: [0, 80], modulationDepth: [0, 200], mono: [0, 1], drums: [0, 1] };
  for (const descriptor of MIDI_PARAMETER_FIELDS) {
    if (descriptor.id === 'program' && !programs) continue;
    if (unit() > (descriptor.id in original ? .85 : .12)) continue;
    result[descriptor.id] = valueIn(...(ranges[descriptor.id] || [descriptor.min, descriptor.max]), descriptor.step);
  }
  const controllers = {}, frequent = new Set([1, 7, 10, 11, 64, 91, 93]);
  for (const descriptor of MIDI_CC_PARAMETERS) {
    if (descriptor.procedural || !(descriptor.id in (original.controllers || {})) && (!frequent.has(descriptor.id) || unit() > .12)) continue;
    if (unit() < .12) continue;
    controllers[descriptor.id] = descriptor.id === 64 ? (unit() < .1 ? 127 : 0) : valueIn([7, 11].includes(descriptor.id) ? 55 : 0, [91, 93].includes(descriptor.id) ? 100 : 127);
  }
  if (Object.keys(controllers).length) result.controllers = controllers;
  const generators = {};
  for (const descriptor of MIDI_GENERATOR_PARAMETERS) {
    if (unit() > (descriptor.id in (original.generators || {}) ? .85 : .08)) continue;
    let min = descriptor.min, max = descriptor.max;
    if (descriptor.unit === 'timecents') { min = -10000; max = [34, 26].includes(descriptor.id) ? -2400 : 1200; }
    else if (descriptor.unit === 'timecents/key') { min = -120; max = 120; }
    else if ([5, 6, 7, 10, 11].includes(descriptor.id)) { min = -350; max = 350; }
    else if (descriptor.id === 8) { min = 6500; max = 13500; }
    else if (descriptor.id === 9) { min = 0; max = 160; }
    else if (descriptor.id === 13) { min = -40; max = 40; }
    else if ([15, 16].includes(descriptor.id)) { min = 0; max = 600; }
    else if ([22, 24].includes(descriptor.id)) { min = -3600; max = 1200; }
    else if (descriptor.id === 29) { min = 0; max = 500; }
    else if ([37, 48].includes(descriptor.id)) { min = 0; max = 150; }
    else if (descriptor.id === 51) { min = -12; max = 12; }
    else if (descriptor.id === 52) { min = -80; max = 80; }
    else if (descriptor.id === 56) { min = 70; max = 130; }
    else if ([61, 62, 65].includes(descriptor.id)) { min = -250; max = 250; }
    else if ([63, 66].includes(descriptor.id)) { min = 0; max = 150; }
    else if (descriptor.id === 64) { min = -350; max = 350; }
    generators[descriptor.id] = valueIn(min, max);
  }
  if (Object.keys(generators).length) result.generators = generators;
  return sanitizeMidiParameters(result);
}
export function randomizeMixerPreset(current, random = Math.random) {
  const unit = () => clamp(random(), 0, 1, .5), pick = values => values[Math.min(values.length - 1, Math.floor(unit() * values.length))];
  const snapshot = captureMixerPreset(current);
  snapshot.tempo = Math.round(60 + unit() * 140); snapshot.crossfade = unit() * 1.6 - .8;
  snapshot.effects = { filterHz: 10 ** (2.6 + unit() * 1.7), delayMix: unit() * .5, delayBeats: pick([.125, .25, .5, .75, 1, 1.5, 2, 4]), feedback: unit() * .65, synth: {} };
  for (const descriptor of MIDI_SYNTH_EFFECT_PARAMETERS) if (unit() < (descriptor.id in (current.effects?.synth || {}) ? .85 : .18)) {
    const radius = (descriptor.max - descriptor.min) * .25;
    snapshot.effects.synth[descriptor.id] = Math.round(clamp(descriptor.default + (unit() * 2 - 1) * radius, descriptor.min, descriptor.max, descriptor.default));
  }
  snapshot.decks.forEach((value, index) => {
    const analysis = current.decks?.[index]?.analysis, duration = analysis?.durationBeats || 16;
    const region = unit() < .3, length = Math.min(duration, pick([2, 4, 8, 16])), start = region ? Math.floor(unit() * Math.max(0, duration - length)) : 0;
    value.config = { rate: pick([.25, .5, 1, 2, 4, 8]), gain: .45 + unit() * .55, transpose: pick([-24, -12, -7, -5, 0, 3, 5, 7, 12, 24]),
      offsetBeats: pick([-8, -4, -2, -1, -.5, 0, .25, .5, 1, 2, 4, 8]), loop: unit() > .08, mute: unit() < .08,
      loopStartBeats: start, loopEndBeats: region ? start + length : null, midi: randomizedMidi(value.config.midi, unit) };
    const sounding = analysis?.channels.filter(item => item.noteCount > 0).map(item => item.channel) ?? Array.from({ length: 16 }, (_, id) => id);
    const solo = unit() < .18 ? pick(sounding) : null;
    value.channels = value.channels.map(item => channel(item.channel, { mute: unit() < .15, solo: item.channel === solo,
      program: item.channel % 16 === 9 || unit() < .7 ? null : Math.min(127, Math.floor(unit() * 128)), midi: randomizedMidi(item.midi, unit, { programs: false }) }));
    // A randomized solo always remains audible; keep at least one present voice enabled.
    const keep = value.channels.find(item => item.channel === (solo ?? sounding[0])); if (keep) keep.mute = false;
  });
  if (snapshot.decks.every(value => value.config.mute)) snapshot.decks[0].config.mute = false;
  return snapshot;
}
