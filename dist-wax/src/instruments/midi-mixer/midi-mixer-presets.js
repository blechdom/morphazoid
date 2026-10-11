const clamp = (v, min, max, fallback) => Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const channel = (id, patch = {}) => ({ channel: id, mute: false, solo: false, program: null, ...patch });
const deck = (config = {}, channels = []) => ({ config: { gain: 1, rate: 1, transpose: 0, offsetBeats: 0, loop: true, mute: false, loopStartBeats: 0, loopEndBeats: null, ...config },
  channels: Array.from({ length: 16 }, (_, id) => channel(id, channels.find(item => item.channel === id))) });
export function captureMixerPreset(state) {
  return { version: 1, tempo: clamp(state.tempo, 30, 300, 120), crossfade: clamp(state.crossfade, -1, 1, 0),
    effects: { filterHz: clamp(state.effects?.filterHz, 60, 20000, 20000), delayMix: clamp(state.effects?.delayMix, 0, .75, 0),
      delayBeats: clamp(state.effects?.delayBeats, .125, 4, .5), feedback: clamp(state.effects?.feedback, 0, .8, .3) },
    decks: [0, 1].map(index => {
      const value = state.decks?.[index], config = value?.config ?? {};
      const result = deck({ rate: clamp(config.rate, .25, 4, 1), gain: clamp(config.gain, 0, 1, 1), transpose: Math.round(clamp(config.transpose, -24, 24, 0)),
        offsetBeats: clamp(config.offsetBeats, -4000000, 4000000, 0), loop: config.loop !== false, mute: Boolean(config.mute),
        loopStartBeats: clamp(config.loopStartBeats, 0, 1000000, 0),
        loopEndBeats: config.loopEndBeats == null ? null : Math.max(clamp(config.loopStartBeats, 0, 1000000, 0) + 1 / 32, clamp(config.loopEndBeats, 0, 1000000, 1)) },
      (value?.channels ?? []).map(item => channel(item.channel, { mute: Boolean(item.mute), solo: Boolean(item.solo),
        program: Number.isInteger(item.program) && item.program >= 0 && item.program < 128 ? item.program : null })));
      for (const item of value?.channels ?? []) if (item.channel >= 16 && item.channel < 4096 && Number.isInteger(item.channel)) { const normalized = channel(item.channel, {
        mute: Boolean(item.mute), solo: Boolean(item.solo), program: Number.isInteger(item.program) && item.program >= 0 && item.program < 128 ? item.program : null });
        const base = result.channels[item.channel % 16];
        if (normalized.mute !== base.mute || normalized.solo !== base.solo || normalized.program !== base.program) result.channels.push(normalized);
      }
      return result;
    }) };
}
export function applyMixerPreset(engine, snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.decks) || snapshot.decks.length !== 2) throw new Error('Invalid MIDI Mixer preset.');
  const next = captureMixerPreset(snapshot);
  engine.setTempo(next.tempo); engine.setCrossfade(next.crossfade); engine.configureEffects(next.effects);
  next.decks.forEach((value, index) => {
    for (const setting of engine.state.decks[index]?.channels ?? []) if (!value.channels.some(item => item.channel === setting.channel)) {
      value.channels.push(channel(setting.channel, { ...value.channels[setting.channel % 16], channel: setting.channel }));
    }
    engine.configureDeck(index, value.config);
    value.channels.forEach(item => engine.configureChannel(index, item.channel, item));
  });
  return next;
}
const only = predicate => Array.from({ length: 16 }, (_, id) => channel(id, { mute: !predicate(id) }));
const drums = only(id => id === 9), melody = only(id => id !== 9);
const preset = (id, label, description, tempo = 120, a = deck(), b = deck(), crossfade = 0) =>
  ({ id, label, description, snapshot: { version: 1, tempo, crossfade, effects: { filterHz: 20000, delayMix: 0, delayBeats: .5, feedback: .3 }, decks: [a, b] } });
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
];
// These scenes change the same audible filter/echo controls available during a set.
MIDI_MIXER_PRESETS.find(item => item.id === 'slow-machine').snapshot.effects = { filterHz: 2600, delayMix: .28, delayBeats: .75, feedback: .38 };
MIDI_MIXER_PRESETS.find(item => item.id === 'fifth-up').snapshot.effects = { filterHz: 10000, delayMix: .16, delayBeats: .5, feedback: .26 };
export function randomizeMixerPreset(current, random = Math.random) {
  const unit = () => clamp(random(), 0, 1, .5), pick = values => values[Math.min(values.length - 1, Math.floor(unit() * values.length))];
  const snapshot = captureMixerPreset(current);
  snapshot.tempo = Math.round(60 + unit() * 140); snapshot.crossfade = unit() * 1.6 - .8;
  snapshot.effects = { filterHz: 10 ** (2.6 + unit() * 1.7), delayMix: unit() * .5, delayBeats: pick([.125, .25, .5, .75, 1, 1.5, 2, 4]), feedback: unit() * .65 };
  snapshot.decks.forEach((value, index) => {
    const analysis = current.decks?.[index]?.analysis, duration = analysis?.durationBeats || 16;
    const region = unit() < .3, length = Math.min(duration, pick([2, 4, 8, 16])), start = region ? Math.floor(unit() * Math.max(0, duration - length)) : 0;
    value.config = { rate: pick([.25, .5, 1, 2, 4]), gain: .45 + unit() * .55, transpose: pick([-24, -12, -7, -5, 0, 3, 5, 7, 12, 24]),
      offsetBeats: pick([-8, -4, -2, -1, -.5, 0, .25, .5, 1, 2, 4, 8]), loop: unit() > .08, mute: unit() < .08,
      loopStartBeats: start, loopEndBeats: region ? start + length : null };
    const sounding = analysis?.channels.filter(item => item.noteCount > 0).map(item => item.channel) ?? Array.from({ length: 16 }, (_, id) => id);
    const solo = unit() < .18 ? pick(sounding) : null;
    value.channels = value.channels.map(item => channel(item.channel, { mute: unit() < .15, solo: item.channel === solo,
      program: item.channel % 16 === 9 || unit() < .7 ? null : Math.min(127, Math.floor(unit() * 128)) }));
    // A randomized solo always remains audible; keep at least one present voice enabled.
    const keep = value.channels.find(item => item.channel === (solo ?? sounding[0])); if (keep) keep.mute = false;
  });
  if (snapshot.decks.every(value => value.config.mute)) snapshot.decks[0].config.mute = false;
  return snapshot;
}
