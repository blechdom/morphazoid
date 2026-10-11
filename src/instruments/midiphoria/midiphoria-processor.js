import { SpessaSynthWorkletProcessor } from './vendor/spessasynth_processor.min.js';
import { MidiNoteEffects } from '../../midi-note-effects.js';

/** Adapt the pinned processor without replacing its sequencer, MIDI parser or synthesis. */
export function installMidiphoriaNoteEffects(host, rate) {
  const synth = host.synthesizer, core = synth.synthCore;
  const installed = new WeakSet();
  let clearing = false, lastTempo;
  const effects = new MidiNoteEffects({ emit(event) {
    const channel = core.midiChannels[event.channel];
    if (!channel) return;
    if (event.type === 'noteOn') {
      // Use the resolved physical channel captured at attack, even if a later
      // SysEx changes MIDI-port routing before a delayed child is due.
      channel.noteOn(event.note, event.velocity);
    } else if (event.release) {
      // The native synth pairs one release with one FIFO attack, including
      // repeated pitches. The effect engine emits one release per child.
      channel.noteOff(event.note);
    }
  } });

  const clear = channel => {
    if (clearing) return;
    clearing = true;
    try {
      effects.clear(core.currentTime, channel === undefined ? undefined : meta => meta.physicalChannel === channel);
    } finally { clearing = false; }
  };
  const installChannel = channel => {
    if (installed.has(channel)) return;
    installed.add(channel);
    const stop = channel.stopAllNotes.bind(channel);
    channel.stopAllNotes = (...args) => { clear(channel.channel); return stop(...args); };
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
    syncTempo();
    for (const target of channelsFor(channel)) effects.noteOn(target.channel, note, velocity, core.currentTime,
      { physicalChannel: target.channel, drums: target.drumChannel });
  };
  core.noteOff = (channel, note) => {
    for (const target of channelsFor(channel)) effects.noteOff(target.channel, note, core.currentTime);
  };
  // The facade binds note methods during construction; replacing the core
  // alone would miss sequencer calls through those original bound functions.
  synth.noteOn = core.noteOn.bind(core);
  synth.noteOff = core.noteOff.bind(core);

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
    if (message?.type === 'midiphoriaNoteEffects') { effects.configure(message.config); lastTempo = undefined; return; }
    if (message?.type === 'soundBankManager') { clear(); core.stopAllChannels(true); }
    return handleMessage(message);
  };
  return { effects, clear };
}

export class MidiphoriaProcessor extends SpessaSynthWorkletProcessor {
  constructor(options) {
    super(options);
    this.noteEffects = installMidiphoriaNoteEffects(this.core, sampleRate);
  }
}

registerProcessor('spessasynth-worklet-processor', MidiphoriaProcessor);
