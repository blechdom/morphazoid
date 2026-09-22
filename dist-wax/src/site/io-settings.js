import { getSharedAudioOutputManager } from "../audio-output-manager.js";
import { audioInputConstraints, configureAudioInputNode, loadAudioInputSettings, saveAudioInputSettings } from "../audio-input-settings.js";

const channel = (label, short, x, y, lfe = false) => Object.freeze({ label, short, x, y, lfe });
const FL = channel("Front left", "L", 20, 18);
const FR = channel("Front right", "R", 80, 18);
const C = channel("Center", "C", 50, 12);
const LFE = channel("Subwoofer", "LFE", 50, 82, true);
const BL = channel("Rear left", "RL", 20, 80);
const BR = channel("Rear right", "RR", 80, 80);
const SL = channel("Side left", "SL", 12, 50);
const SR = channel("Side right", "SR", 88, 50);

// Web Audio order for mono/stereo/quad/5.1. Eight-channel mode uses the
// explicitly labelled L R C LFE RL RR SL SR convention, not spatial panning.
export const OUTPUT_LAYOUTS = Object.freeze({
  mono: Object.freeze([channel("Mono", "M", 50, 18)]),
  stereo: Object.freeze([FL, FR]),
  quad: Object.freeze([FL, FR, BL, BR]),
  "5.1": Object.freeze([FL, FR, C, LFE, BL, BR]),
  "7.1": Object.freeze([FL, FR, C, LFE, BL, BR, SL, SR]),
});
export const SETTINGS_KEY = "morphazoid.io-settings.v1";
export const DEFAULT_SETTINGS = Object.freeze({
  layout: "stereo", outputDb: -24, inputId: "", inputDb: 0, inputChannels: 1,
  echoCancellation: false, midiInputId: "", midiOutputId: "",
  midiChannel: 0, announce: true, signal: "tone",
});

const bounded = (value, min, max, fallback) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback;
const deviceId = (value) => typeof value === "string" ? value.slice(0, 512) : "";
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (gain) => gain > 0 ? Math.max(-96, 20 * Math.log10(gain)) : -96;

export function normalizeSettings(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  return {
    layout: Object.hasOwn(OUTPUT_LAYOUTS, input.layout) ? input.layout : "stereo",
    outputDb: bounded(input.outputDb ?? -24, -60, -12, -24),
    inputId: deviceId(input.inputId),
    inputDb: bounded(input.inputDb ?? 0, -24, 18, 0),
    inputChannels: Number(input.inputChannels) === 2 ? 2 : 1,
    echoCancellation: input.echoCancellation === true,
    midiInputId: deviceId(input.midiInputId),
    midiOutputId: deviceId(input.midiOutputId),
    midiChannel: Math.round(bounded(input.midiChannel ?? 0, 0, 16, 0)),
    announce: input.announce !== false,
    signal: input.signal === "noise" ? "noise" : "tone",
  };
}

export function loadSettings(runtime = globalThis) {
  try {
    return normalizeSettings({
      ...JSON.parse(runtime.localStorage.getItem(SETTINGS_KEY)),
      ...loadAudioInputSettings(runtime),
    });
  }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings, runtime = globalThis) {
  try {
    runtime.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    return saveAudioInputSettings(settings, runtime);
  } catch { return false; }
}

export function measureSamples(samples) {
  let peak = 0;
  let sum = 0;
  for (const value of samples) {
    if (!Number.isFinite(value)) continue;
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, samples.length)), clipped: peak >= 0.99 };
}

export function describeMidi(data) {
  const [status = 0, a = 0, b = 0] = data;
  const command = status & 0xf0;
  const channelNumber = status < 0xf0 ? (status & 15) + 1 : null;
  const noteName = `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][a % 12]}${Math.floor(a / 12) - 1}`;
  const descriptions = {
    0x80: `Note off · ${noteName} (${a})`,
    0x90: b ? `Note on · ${noteName} (${a}) · velocity ${b}` : `Note off · ${noteName} (${a})`,
    0xa0: `Poly pressure · ${noteName} · ${b}`,
    0xb0: `CC ${a} · ${b}`,
    0xc0: `Program ${a + 1}`,
    0xd0: `Channel pressure · ${a}`,
    0xe0: `Pitch bend · ${(b << 7 | a) - 8192}`,
  };
  const system = {
    0xf0: "SysEx", 0xf1: "Time code", 0xf2: `Song position · ${b << 7 | a}`,
    0xf3: "Song select", 0xf6: "Tune request", 0xf8: "Clock",
    0xfa: "Start", 0xfb: "Continue", 0xfc: "Stop", 0xfe: "Active sensing", 0xff: "Reset",
  };
  return {
    channel: channelNumber,
    text: channelNumber ? descriptions[command] ?? "MIDI message" : system[status] ?? "System message",
    hex: Array.from(data).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" "),
    // Clock/active-sensing streams still show in the monitor but never chatter.
    announce: status !== 0xf8 && status !== 0xfe && status !== 0xf1
      && command !== 0x80 && !(command === 0x90 && b === 0),
  };
}

function disconnect(node) {
  try { node?.disconnect(); } catch { /* Already disconnected. */ }
}
function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}
function closePort(port) {
  try { Promise.resolve(port.close()).catch(() => {}); } catch { /* Unplugged. */ }
}

/** Page-owned audio. Nothing is created or acquired before an explicit action. */
export class IOAudioTest {
  constructor(runtime = globalThis, onChange = () => {}) {
    this.runtime = runtime;
    this.onChange = onChange;
    this.output = getSharedAudioOutputManager(runtime);
    this.context = null;
    this.master = null;
    this.releaseOutput = null;
    this.layout = "stereo";
    this.outputDb = -24;
    this.inputDb = 0;
    this.sources = new Set();
    this.mic = null;
    this.micVersion = 0;
    this.version = 0;
    this.testVersion = 0;
    this.sample = null;
    this.samplePromise = null;
    this.lastAnnouncement = -Infinity;
  }

  get active() { return this.context?.state === "running"; }
  get maxChannels() { return Math.max(1, this.context?.destination.maxChannelCount || 2); }

  async enable(settings) {
    if (this.context) {
      await this.context.resume();
      this.onChange();
      return;
    }
    settings = { ...settings };
    const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    if (!Context) throw new Error("Web Audio is unavailable in this browser.");
    const version = ++this.version;
    const context = new Context({ latencyHint: "interactive" });
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.channelInterpretation = "discrete";
    this.master.channelCountMode = "explicit";
    // Resume immediately in the user gesture, before device/file awaits.
    const resumed = context.resume();
    this.releaseOutput = this.output.connect(context, this.master);
    context.onstatechange = () => {
      if (context !== this.context) return;
      if (context.state !== "running") { this.stopTests(); this.setMonitor(false); }
      this.onChange();
    };
    try {
      await resumed;
      if (version !== this.version) return;
      if (context.state !== "running") throw new Error("Audio could not start. Try turning Audio on again.");
      const selected = this.output.outputStatus().selectedId;
      if (selected && selected !== "wax-host" && !await this.output.setOutputDevice(selected)) {
        await this.output.setOutputDevice("");
        this.onChange("Saved output unavailable; using the system default.");
      }
      if (version !== this.version) return;
      const layout = OUTPUT_LAYOUTS[settings.layout]?.length <= this.maxChannels
        ? settings.layout : this.maxChannels >= 2 ? "stereo" : "mono";
      this.setLayout(layout);
      if (layout !== settings.layout) this.onChange("Saved surround layout exceeds this output’s capacity; using a supported layout.");
      this.setOutputDb(settings.outputDb);
      this.inputDb = settings.inputDb;
      this.onChange();
    } catch (error) {
      if (version === this.version) await this.disable();
      throw error;
    }
  }

  setLayout(layout) {
    if (!Object.hasOwn(OUTPUT_LAYOUTS, layout)) throw new Error("Unknown speaker layout.");
    const count = OUTPUT_LAYOUTS[layout].length;
    if (this.context && count > this.maxChannels) {
      throw new Error(`This output exposes ${this.maxChannels} channels, not ${count}. Choose a smaller layout or configure the device in your system sound settings.`);
    }
    this.stopTests();
    this.setMonitor(false);
    if (this.mic) this.mic.monitor.channelCount = Math.min(2, count);
    if (this.context) {
      this.context.destination.channelCount = count;
      this.context.destination.channelInterpretation = "discrete";
      this.master.channelCount = count;
    }
    this.layout = layout;
    this.onChange();
  }

  setOutputDb(db) {
    this.outputDb = bounded(db, -60, -12, -24);
    this.master?.gain.setTargetAtTime(dbToGain(this.outputDb), this.context.currentTime, 0.015);
  }

  async setOutput(id) {
    this.stopTests();
    this.setMonitor(false);
    const ok = await this.output.setOutputDevice(id);
    if (!ok) throw new Error("Could not select that output. Grant speaker access or choose it in your system sound settings.");
    if (this.context) {
      const layout = OUTPUT_LAYOUTS[this.layout].length <= this.maxChannels
        ? this.layout : this.maxChannels >= 2 ? "stereo" : "mono";
      this.setLayout(layout);
    }
    this.onChange();
  }

  scheduleBuffer(buffer, when, channelIndex = null) {
    const context = this.context;
    if (!this.active || this.sources.size >= 8) return false;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.channelInterpretation = "discrete";
    source.connect(this.master);
    const record = { source, channelIndex, start: when, end: when + buffer.duration };
    this.sources.add(record);
    source.onended = () => {
      disconnect(source);
      this.sources.delete(record);
      this.onChange();
    };
    source.start(when);
    return true;
  }

  testChannels(indices, signal = "tone") {
    if (!this.active) throw new Error("Turn Audio on before testing speakers.");
    this.stopTests();
    this.setMonitor(false);
    const context = this.context;
    const channels = OUTPUT_LAYOUTS[this.layout];
    const start = context.currentTime + 0.04;
    for (const [step, index] of indices.slice(0, channels.length).entries()) {
      if (!channels[index]) continue;
      const buffer = context.createBuffer(channels.length, Math.ceil(context.sampleRate * 0.6), context.sampleRate);
      const samples = buffer.getChannelData(index);
      let seed = 12345;
      let filteredNoise = 0;
      for (let frame = 0; frame < samples.length; frame++) {
        const t = frame / context.sampleRate;
        const envelope = Math.min(1, t / 0.025, (0.6 - t) / 0.07);
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        filteredNoise = filteredNoise * 0.85 + (seed / 0x100000000 * 2 - 1) * 0.15;
        const sound = signal === "noise" && !channels[index].lfe
          ? filteredNoise * 2 : Math.sin(2 * Math.PI * (channels[index].lfe ? 80 : 440) * t);
        samples[frame] = sound * Math.max(0, envelope) * 0.6;
      }
      this.scheduleBuffer(buffer, start + step * 0.85, index);
    }
    this.onChange();
  }

  async announce({ preview = false } = {}) {
    if (!this.active) return false;
    const context = this.context;
    // Never overlap a sequence, speech, or a live monitor; never build a queue.
    if (!preview && (this.sources.size || this.mic?.monitoring
      || context.currentTime - this.lastAnnouncement < 2)) return false;
    if (preview) { this.stopTests(); this.setMonitor(false); }
    this.lastAnnouncement = context.currentTime;
    const version = this.version;
    const testVersion = this.testVersion;
    if (!this.sample) {
      this.samplePromise ??= this.runtime.fetch(new URL("../../assets/audio/midi-received.wav", import.meta.url))
        .then((response) => {
          if (!response.ok) throw new Error("The MIDI voice sample could not be loaded.");
          return response.arrayBuffer();
        })
        .then((bytes) => context.decodeAudioData(bytes))
        .catch((error) => { this.samplePromise = null; throw error; });
      this.sample = await this.samplePromise;
    }
    if (version !== this.version || testVersion !== this.testVersion
      || context !== this.context || !this.active || this.sources.size || this.mic?.monitoring) return false;
    const count = OUTPUT_LAYOUTS[this.layout].length;
    const buffer = context.createBuffer(count, this.sample.length, this.sample.sampleRate);
    const mono = this.sample.getChannelData(0);
    for (let channelIndex = 0; channelIndex < Math.min(2, count); channelIndex++) {
      buffer.copyToChannel(mono, channelIndex);
    }
    return this.scheduleBuffer(buffer, context.currentTime + 0.01);
  }

  stopTests() {
    // Invalidate pending sample loads as well as already scheduled sources.
    this.testVersion++;
    for (const { source } of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      disconnect(source);
    }
    this.sources.clear();
  }

  async startMic({ inputId = "", inputDb = 0, inputChannels = 1, echoCancellation = false } = {}) {
    if (!this.active) throw new Error("Turn Audio on before testing the microphone.");
    if (!this.runtime.navigator?.mediaDevices?.getUserMedia) throw new Error("Microphone access needs HTTPS or localhost and a supported browser.");
    this.stopMic();
    this.stopTests();
    const version = this.micVersion;
    const context = this.context;
    const stream = await this.runtime.navigator.mediaDevices.getUserMedia(
      audioInputConstraints(this.runtime, { inputId, inputChannels, echoCancellation }),
    );
    if (version !== this.micVersion || context !== this.context || !this.active) {
      stopStream(stream);
      return false;
    }
    const nodes = [];
    try {
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === "ended") throw new Error("No live audio track was provided.");
      const source = context.createMediaStreamSource(stream); nodes.push(source);
      const gain = context.createGain(); nodes.push(gain);
      configureAudioInputNode(gain, this.runtime, { inputChannels });
      const before = context.createAnalyser(); nodes.push(before);
      const after = context.createAnalyser(); nodes.push(after);
      const beforeRight = context.createAnalyser(); nodes.push(beforeRight);
      const afterRight = context.createAnalyser(); nodes.push(afterRight);
      for (const analyser of [before, after, beforeRight, afterRight]) analyser.fftSize = 2048;
      const rawSplit = context.createChannelSplitter(2); nodes.push(rawSplit);
      const gainSplit = context.createChannelSplitter(2); nodes.push(gainSplit);
      source.connect(rawSplit);
      rawSplit.connect(before, 0);
      rawSplit.connect(beforeRight, 1);
      source.connect(gain);
      gain.connect(gainSplit);
      gainSplit.connect(after, 0);
      gainSplit.connect(afterRight, 1);
      const monitor = context.createGain(); nodes.push(monitor);
      monitor.gain.value = 0;
      const limiter = context.createDynamicsCompressor(); nodes.push(limiter);
      limiter.threshold.value = -12;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      gain.connect(limiter);
      limiter.connect(monitor);
      // Explicit stereo upmixes mono for headphones, but preserves stereo line
      // input. Discrete master routing keeps it on front L/R in surround mode.
      monitor.channelCount = Math.min(2, OUTPUT_LAYOUTS[this.layout].length);
      monitor.channelCountMode = "explicit";
      monitor.connect(this.master);
      const ended = () => {
        if (this.mic?.stream === stream) {
          this.stopMic();
          this.onChange("Microphone disconnected or permission ended.");
        }
      };
      track.addEventListener("ended", ended);
      this.mic = {
        stream, track, ended, nodes, gain, before, after, beforeRight, afterRight, monitor,
        inputChannels,
        samples: new Float32Array(2048), monitoring: false,
        settings: track.getSettings(),
      };
      this.setInputDb(inputDb);
      this.onChange();
      return true;
    } catch (error) {
      nodes.forEach(disconnect);
      stopStream(stream);
      throw error;
    }
  }

  setInputDb(db) {
    this.inputDb = bounded(db, -24, 18, 0);
    this.mic?.gain.gain.setTargetAtTime(dbToGain(this.inputDb), this.context.currentTime, 0.015);
  }

  setMonitor(on) {
    if (!this.mic) return;
    this.mic.monitoring = Boolean(on && this.active);
    this.mic.monitor.gain.setTargetAtTime(this.mic.monitoring ? 0.5 : 0, this.context.currentTime, 0.015);
  }

  readInput() {
    if (!this.mic) return null;
    const { before, after, beforeRight, afterRight, samples } = this.mic;
    before.getFloatTimeDomainData(samples);
    const raw = measureSamples(samples);
    after.getFloatTimeDomainData(samples);
    const adjusted = measureSamples(samples);
    beforeRight.getFloatTimeDomainData(samples);
    const rawRight = measureSamples(samples);
    afterRight.getFloatTimeDomainData(samples);
    const adjustedRight = measureSamples(samples);
    return { raw, adjusted, rawRight, adjustedRight };
  }

  stopMic() {
    this.micVersion++;
    const mic = this.mic;
    this.mic = null;
    if (!mic) return;
    mic.track.removeEventListener("ended", mic.ended);
    mic.nodes.forEach(disconnect);
    stopStream(mic.stream);
    this.onChange();
  }

  async disable() {
    this.version++;
    this.lastAnnouncement = -Infinity;
    this.stopTests();
    this.stopMic();
    const context = this.context;
    this.context = null;
    if (context) context.onstatechange = null;
    this.releaseOutput?.();
    this.releaseOutput = null;
    disconnect(this.master);
    this.master = null;
    if (context && context.state !== "closed") await context.close();
    this.onChange();
  }
}

/** Dedicated MIDI diagnostic: no thru, synth mapping, clock generation or SysEx. */
export class IOMidiTest {
  constructor(runtime = globalThis, onMessage = () => {}, onChange = () => {}) {
    this.runtime = runtime;
    this.onMessage = onMessage;
    this.onChange = onChange;
    this.access = null;
    this.inputs = new Map();
    this.inputId = "";
    this.outputId = "";
    this.channel = 0;
    this.version = 0;
    this.pendingNote = null;
    this.statechange = () => { this.syncInputs(); this.onChange(); };
  }

  async enable() {
    if (this.access) return;
    if (!this.runtime.navigator?.requestMIDIAccess) throw new Error("Web MIDI is unavailable in this browser. Try a browser with Web MIDI support.");
    const version = ++this.version;
    const access = await this.runtime.navigator.requestMIDIAccess({ sysex: false });
    if (version !== this.version) {
      if (access !== this.access) {
        for (const port of [...access.inputs.values(), ...access.outputs.values()]) closePort(port);
      }
      return;
    }
    this.access = access;
    access.addEventListener("statechange", this.statechange);
    this.syncInputs();
    this.onChange();
  }

  ports(kind) {
    return [...(this.access?.[kind]?.values() ?? [])].filter((port) => port.state === "connected");
  }

  syncInputs() {
    const wanted = new Set(this.ports("inputs").filter((port) => !this.inputId || port.id === this.inputId));
    for (const [port, listener] of this.inputs) {
      if (wanted.has(port)) continue;
      port.removeEventListener("midimessage", listener);
      this.inputs.delete(port);
      closePort(port);
    }
    for (const port of wanted) {
      if (this.inputs.has(port)) continue;
      const listener = (event) => {
        if (!this.access || port.state !== "connected") return;
        const message = describeMidi(event.data);
        if (this.channel && message.channel && message.channel !== this.channel) return;
        this.onMessage({ ...message, name: port.name || "MIDI input", time: this.runtime.performance.now() });
      };
      port.addEventListener("midimessage", listener);
      this.inputs.set(port, listener);
    }
  }

  selectInput(id) { this.inputId = id; this.syncInputs(); }
  selectOutput(id) {
    this.stopNote();
    const previous = this.access?.outputs.get(this.outputId);
    if (previous && previous.id !== id) closePort(previous);
    this.outputId = id;
  }

  testNote(channelNumber = 1) {
    this.stopNote();
    const port = this.ports("outputs").find(({ id }) => id === this.outputId);
    if (!port) throw new Error("Choose a connected MIDI output first.");
    const channelIndex = Math.round(bounded(channelNumber, 1, 16, 1)) - 1;
    const off = [0x80 | channelIndex, 60, 0];
    // Queue a matching release on the MIDI clock, not on a rendering frame.
    this.pendingNote = { port, off, timer: null };
    try {
      port.send([0x90 | channelIndex, 60, 64]);
      port.send(off, this.runtime.performance.now() + 250);
      this.pendingNote.timer = this.runtime.setTimeout(() => { this.pendingNote = null; }, 400);
    } catch (error) { this.stopNote(); throw error; }
  }

  stopNote() {
    if (!this.pendingNote) return;
    const { port, off, timer } = this.pendingNote;
    this.pendingNote = null;
    this.runtime.clearTimeout(timer);
    try { port.clear(); } catch { /* Device disconnected. */ }
    try { port.send(off); } catch { /* Device disconnected. */ }
  }

  disable() {
    this.version++;
    this.stopNote();
    const access = this.access;
    this.access = null;
    access?.removeEventListener("statechange", this.statechange);
    for (const [port, listener] of this.inputs) port.removeEventListener("midimessage", listener);
    this.inputs.clear();
    for (const port of [...(access?.inputs.values() ?? []), ...(access?.outputs.values() ?? [])]) closePort(port);
    this.onChange();
  }
}
