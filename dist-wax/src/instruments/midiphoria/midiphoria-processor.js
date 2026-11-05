import { SpessaSynthWorkletProcessor } from './vendor/spessasynth_processor.min.js';
import { MidiNoteEffects } from '../../midi-note-effects.js';

// This is a musical stream, separate from the vendor's display callbacks. Audio
// timestamps travel unchanged to Web MIDI; no animation timer owns note timing.
export function createMidiphoriaMidiOutput(host, core) {
  let enabled = false, epoch = 0, prefix = 'midiphoria:file', events = [], overflow = false, error = '';
  let configuration = '';
  let channels = new Set();
  const pitches = new Map();
  const source = channel => `${prefix}:${channel}`;
  const push = event => {
    if (!enabled) return;
    if (!Number.isInteger(event.channel) || event.channel < 0 || event.channel > 15) {
      error = 'Live MIDI output supports one MIDI port (16 channels). This file uses additional ports.';
      for (const channel of channels) if (channel < 16) events.push({ type: 'release', source: source(channel), channel, time: core.currentTime });
      pitches.clear(); enabled = false; return;
    }
    if (events.length >= 4096) { events.length = 0; pitches.clear(); overflow = true; enabled = false; return; }
    events.push({ ...event, source: source(event.channel) });
  };
  const message = (channel, data, time = core.currentTime) => push({ type: 'message', channel, data, time });
  const release = channel => {
    for (const [id, pitch] of pitches) if (pitch.channel === channel) pitches.delete(id);
    push({ type: 'release', channel, time: core.currentTime });
  };
  const chase = channel => {
    const state = core.midiChannels[channel];
    if (!state) return;
    const patch = state.patch ?? {}, controllers = state.midiControllers, parameters = state.midiParameters ?? {};
    message(channel, [0xb0 | channel, 0, Math.max(0, Math.min(127, patch.bankMSB ?? 0))]);
    message(channel, [0xb0 | channel, 32, Math.max(0, Math.min(127, patch.bankLSB ?? 0))]);
    message(channel, [0xc0 | channel, Math.max(0, Math.min(127, patch.program ?? 0))]);
    // Chase musical CCs without replaying channel-mode panic or applying a data
    // entry byte to an unrelated RPN. Bend range is restored explicitly below.
    if (controllers) for (let cc = 1; cc < 120; cc++) {
      if ([6, 32, 38, 96, 97, 98, 99, 100, 101].includes(cc)) continue;
      message(channel, [0xb0 | channel, cc, (controllers[cc] >> 7) & 127]);
    }
    const range = Math.max(0, Math.min(127, parameters.pitchWheelRange ?? 2));
    for (const [cc, value] of [[101, 0], [100, 0], [6, Math.floor(range)], [38, Math.round((range % 1) * 100)], [101, 127], [100, 127]]) message(channel, [0xb0 | channel, cc, value]);
    const bend = Math.max(0, Math.min(16383, parameters.pitchWheel ?? 8192));
    message(channel, [0xe0 | channel, bend & 127, (bend >> 7) & 127]);
    message(channel, [0xd0 | channel, Math.max(0, Math.min(127, parameters.pressure ?? 0))]);
  };
  return {
    note(event, keyShift = 0) {
      if (!enabled) return;
      if (event.type === 'noteOn') {
        const note = event.note + (Number.isFinite(keyShift) ? Math.trunc(keyShift) : 0);
        if (note < 0 || note > 127) return;
        pitches.set(event.id, { channel: event.channel, sourceNote: event.note, note });
        push({ type: 'noteOn', id: event.id, channel: event.channel, note, velocity: event.velocity, time: event.time });
      } else {
        const pitch = pitches.get(event.id); pitches.delete(event.id);
        if (pitch) push({ type: 'noteOff', id: event.id, channel: event.channel, note: pitch.note, velocity: 0, time: event.time });
      }
    },
    pressure(channel, note, value) {
      if (!enabled) return;
      const sent = new Set();
      for (const pitch of pitches.values()) if (pitch.channel === channel && pitch.sourceNote === note && !sent.has(pitch.note)) {
        sent.add(pitch.note); message(channel, [0xa0 | (channel & 15), pitch.note, value]);
      }
    },
    message, release,
    configure(config) {
      const next = JSON.stringify([Boolean(config.enabled), config.epoch, config.source, config.channels]);
      if (next === configuration) return;
      configuration = next;
      // The controller discards old epochs; never relabel an already queued
      // event with a newly chosen destination's epoch.
      events = []; pitches.clear(); overflow = false; error = '';
      enabled = Boolean(config.enabled); epoch = config.epoch;
      prefix = String(config.source || 'midiphoria:file');
      channels = new Set((config.channels ?? [0]).filter(channel => Number.isInteger(channel) && channel >= 0));
      if (enabled) for (const channel of channels) {
        if (channel > 15) { push({ channel }); break; }
        chase(channel);
      }
    },
    flush() {
      if (!events.length && !overflow && !error) return;
      host.port?.postMessage({ type: 'midiphoriaMidiOutput', epoch, events, ...(overflow ? { overflow: true } : {}), ...(error ? { fileError: error } : {}) });
      events = []; overflow = false; error = '';
    },
  };
}

/** Adapt the pinned processor without replacing its sequencer, MIDI parser or synthesis. */
export function installMidiphoriaNoteEffects(host, rate) {
  const synth = host.synthesizer, core = synth.synthCore;
  const midiOutput = createMidiphoriaMidiOutput(host, core);
  const installed = new WeakSet();
  // MIDI ports have a one-byte ID: at most 4096 channels and 128 source keys.
  // Allocate pressure bytes only for channels that actually receive aftertouch.
  const pressureByChannel = new Map();
  let clearing = false, lastTempo;
  const effects = new MidiNoteEffects({ emit(event) {
    const channel = core.midiChannels[event.channel];
    if (!channel) return;
    if (event.type === 'noteOn') {
      // Use the resolved physical channel captured at attack, even if a later
      // SysEx changes MIDI-port routing before a delayed child is due.
      channel.noteOn(event.note, event.velocity);
      midiOutput.note(event, channel.currentKeyShift);
      const pressure = pressureByChannel.get(event.channel)?.[event.meta.sourceNote] ?? 0;
      if (pressure) channel.polyPressure(event.note, pressure);
    } else if (event.release) {
      // The native synth pairs one release with one FIFO attack, including
      // repeated pitches. The effect engine emits one release per child.
      channel.noteOff(event.note);
      midiOutput.note(event);
    }
  } });

  const clear = channel => {
    if (clearing) return;
    clearing = true;
    try {
      if (channel === undefined) pressureByChannel.clear();
      else pressureByChannel.delete(channel);
      effects.clear(core.currentTime, channel === undefined ? undefined : meta => meta.physicalChannel === channel);
    } finally { clearing = false; }
  };
  const installChannel = channel => {
    if (installed.has(channel)) return;
    installed.add(channel);
    const stop = channel.stopAllNotes.bind(channel);
    channel.stopAllNotes = (...args) => { clear(channel.channel); midiOutput.release(channel.channel); return stop(...args); };
    const wrap = (name, forward) => {
      if (typeof channel[name] !== 'function') return;
      const original = channel[name].bind(channel);
      channel[name] = (...args) => { const result = original(...args); forward(...args); return result; };
    };
    wrap('controllerChange', (cc, value) => {
      if (cc === 120 || cc === 123) midiOutput.release(channel.channel);
      else if (Number.isInteger(cc) && cc >= 0 && cc <= 127 && Number.isInteger(value) && value >= 0 && value <= 127) midiOutput.message(channel.channel, [0xb0 | (channel.channel & 15), cc, value]);
    });
    wrap('programChange', program => { if (Number.isInteger(program) && program >= 0 && program <= 127) midiOutput.message(channel.channel, [0xc0 | (channel.channel & 15), program]); });
    wrap('pitchWheel', (value, note = -1) => { if (note < 0 && Number.isInteger(value) && value >= 0 && value <= 16383) midiOutput.message(channel.channel, [0xe0 | (channel.channel & 15), value & 127, value >> 7]); });
    wrap('setMIDIParameter', (parameter, value) => { if (parameter === 'pressure' && Number.isInteger(value) && value >= 0 && value <= 127) midiOutput.message(channel.channel, [0xd0 | (channel.channel & 15), value]); });
    wrap('polyPressure', (note, value) => { if ([note, value].every(value => Number.isInteger(value) && value >= 0 && value <= 127)) midiOutput.pressure(channel.channel, note, value); });
    const resetControllers = channel.resetRP15.bind(channel);
    channel.resetRP15 = (...args) => {
      const pressures = pressureByChannel.get(channel.channel);
      if (pressures) for (let note = 0; note < 128; note++) if (pressures[note]) {
        for (const pitch of effects.activePitches(channel.channel, note)) channel.polyPressure(pitch, 0);
      }
      pressureByChannel.delete(channel.channel);
      return resetControllers(...args);
    };
  };
  for (const channel of core.midiChannels) installChannel(channel);
  const create = core.createMIDIChannel.bind(core);
  core.createMIDIChannel = (...args) => {
    const result = create(...args);
    installChannel(core.midiChannels.at(-1));
    return result;
  };
  const channelsFor = channel => core.customChannelNumbers
    ? core.midiChannels.filter(target => target.midiParameters.rxChannel === channel)
    : [core.midiChannels[channel + core.portSelectChannelOffset]].filter(Boolean);
  const syncTempo = () => {
    const sequence = host.sequencers.find(candidate => candidate.midiData && !candidate.paused);
    const secondsPerBeat = sequence?.oneTickToSeconds * sequence?.midiData?.timeDivision;
    const tempo = secondsPerBeat > 0 ? 60 / secondsPerBeat * sequence.playbackRate : null;
    if (tempo !== null && tempo !== lastTempo) { effects.configure({ tempo }); lastTempo = tempo; }
  };
  core.noteOn = (channel, note, velocity) => {
    effects.advance(core.currentTime);
    syncTempo();
    for (const target of channelsFor(channel)) {
      const pressures = pressureByChannel.get(target.channel);
      if (pressures && velocity > 0) pressures[note] = 0;
      effects.noteOn(target.channel, note, velocity, core.currentTime,
        { physicalChannel: target.channel, sourceNote: note, drums: target.drumChannel });
    }
  };
  core.noteOff = (channel, note) => {
    for (const target of channelsFor(channel)) effects.noteOff(target.channel, note, core.currentTime);
  };
  core.polyPressure = (channel, note, pressure) => {
    if (!Number.isInteger(note) || note < 0 || note > 127
      || !Number.isInteger(pressure) || pressure < 0 || pressure > 127) return;
    effects.advance(core.currentTime);
    for (const target of channelsFor(channel)) {
      if (target.channel < 0 || target.channel > 4095) continue;
      let pressures = pressureByChannel.get(target.channel);
      if (!pressures) { pressures = new Uint8Array(128); pressureByChannel.set(target.channel, pressures); }
      pressures[note] = pressure;
      const pitches = effects.activePitches(target.channel, note);
      for (const pitch of pitches.length ? pitches : [note]) target.polyPressure(pitch, pressure);
    }
  };
  // The facade binds note methods during construction; replacing the core
  // alone would miss sequencer calls through those original bound functions.
  synth.noteOn = core.noteOn.bind(core);
  synth.noteOff = core.noteOff.bind(core);
  synth.polyPressure = core.polyPressure.bind(core);

  const reset = core.reset.bind(core), destroy = core.destroySynthProcessor.bind(core);
  core.reset = (...args) => { clear(); core.eventQueue.length = 0; return reset(...args); };
  core.destroySynthProcessor = (...args) => { clear(); core.eventQueue.length = 0; return destroy(...args); };
  const stopAll = core.stopAllChannels.bind(core);
  core.stopAllChannels = (...args) => { clear(); core.eventQueue.length = 0; return stopAll(...args); };

  const render = synth.processSplit.bind(synth);
  synth.processSplit = (outputs, wetLeft, wetRight, offset = 0, count = 0) => {
    const end = offset + (count || outputs[0][0].length - offset);
    while (offset < end) {
      const now = core.currentTime;
      // Upstream drains this queue at render boundaries. Drain before choosing
      // our next boundary so scheduled pad attacks can create delayed children.
      while (core.eventQueue[0]?.time <= now) {
        const event = core.eventQueue.shift();
        core.processMessageInternal(event.message, event.channelOffset);
      }
      effects.advance(now);
      const next = Math.min(effects.nextTime, core.eventQueue[0]?.time ?? Infinity);
      const frames = Math.min(end - offset, Math.max(1, Math.ceil((next - now) * rate - 1e-7)));
      render(outputs, wetLeft, wetRight, offset, frames);
      offset += frames;
    }
  };

  const handleMessage = host.handleMessage.bind(host);
  host.handleMessage = message => {
    if (message?.type === 'midiphoriaMidiOutput') { midiOutput.configure(message); midiOutput.flush(); return; }
    if (message?.type === 'midiphoriaNoteEffects') { effects.configure(message.config); lastTempo = undefined; return; }
    if (message?.type === 'soundBankManager') { clear(); core.stopAllChannels(true); }
    return handleMessage(message);
  };
  return { effects, clear, midiOutput };
}

export class MidiphoriaProcessor extends SpessaSynthWorkletProcessor {
  constructor(options) {
    super(options);
    this.noteEffects = installMidiphoriaNoteEffects(this.core, sampleRate);
  }
  process(inputs, outputs) {
    const alive = super.process(inputs, outputs);
    this.noteEffects.midiOutput.flush();
    return alive;
  }
}

registerProcessor('spessasynth-worklet-processor', MidiphoriaProcessor);
