import { flattenPatch } from "./constellation-composer.js";

const EPSILON = 1e-7;
const MAX_EVENTS_PER_WINDOW = 512;
const MAX_ACTIVE_VOICES = 128;
const SILENCE = 0.0001;

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finite(value, fallback)))
);

function midiFrequency(note) {
  return 440 * 2 ** ((clamp(note, 0, 127, 60) - 69) / 12);
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeConnect(source, destination) {
  if (!source || !destination || typeof source.connect !== "function") return false;
  try {
    source.connect(destination);
    return true;
  } catch {
    return false;
  }
}

function safeDisconnect(node) {
  try { node?.disconnect?.(); } catch { /* A closing graph may already be disconnected. */ }
}

function setParam(parameter, method, ...values) {
  if (!parameter) return;
  try {
    if (typeof parameter[method] === "function") parameter[method](...values);
    else if (values.length) parameter.value = values[0];
  } catch {
    // A closing context is intentionally ignored; the next gesture rebuilds it.
  }
}

function playableEventHasEnergy(event) {
  if (!event?.playable) return false;
  const explicitLevels = [event.value, event.velocity]
    .filter((value) => value !== undefined)
    .map((value) => finite(value, 0));
  return !explicitLevels.length || explicitLevels.every((value) => value > EPSILON);
}

/** Return only playable note attacks inside one half-open beat window. */
export function performanceEventsForWindow(
  source,
  fromBeat,
  toBeat,
  { maximum = MAX_EVENTS_PER_WINDOW, includeControl = false } = {},
) {
  const events = Array.isArray(source) ? source : Array.isArray(source?.events) ? source.events : [];
  const start = finite(fromBeat, 0);
  const end = Math.max(start, finite(toBeat, start));
  if (end - start <= EPSILON) return [];
  return events
    .filter((event) => (
      event?.beat + EPSILON >= start
      && event.beat < end - EPSILON
      && (playableEventHasEnergy(event) || (includeControl && event.signal === "control"))
    ))
    .sort((first, second) => first.beat - second.beat || String(first.id).localeCompare(String(second.id)))
    .slice(0, Math.max(1, Math.floor(finite(maximum, MAX_EVENTS_PER_WINDOW))));
}

function makePassthrough(context) {
  const input = context.createGain();
  const output = context.createGain();
  safeConnect(input, output);
  return {
    input,
    output,
    nodes: [input, output],
    controlParam: null,
    controlBase: 0,
    controlDepth: 0,
    controlMinimum: -Infinity,
    controlMaximum: Infinity,
  };
}

function makeImpulse(context, seconds = 1.4, decay = 2.4) {
  const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, frames, context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let seed = 173 + channel * 37;
    for (let index = 0; index < frames; index += 1) {
      seed = (seed * 16807) % 2147483647;
      const noise = seed / 1073741823.5 - 1;
      data[index] = noise * (1 - index / frames) ** decay;
    }
  }
  return buffer;
}

function primitiveBus(context, flat) {
  const primitiveId = flat.node?.primitiveId;
  const params = flat.node?.params ?? {};
  const bus = makePassthrough(context);
  safeDisconnect(bus.input);
  safeDisconnect(bus.output);
  bus.nodes = [bus.input, bus.output];

  if (primitiveId === "filter") {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = clamp(params.cutoff, 80, 18_000, 2200);
    filter.Q.value = clamp(params.resonance, .1, 24, 2.2);
    safeConnect(bus.input, filter);
    safeConnect(filter, bus.output);
    bus.nodes.push(filter);
    bus.controlParam = filter.frequency;
    bus.controlBase = filter.frequency.value;
    bus.controlDepth = 1_100;
    bus.controlMinimum = 80;
    bus.controlMaximum = 18_000;
    return bus;
  }

  if (primitiveId === "delay") {
    const dry = context.createGain();
    const wet = context.createGain();
    const delay = context.createDelay(4);
    const feedback = context.createGain();
    dry.gain.value = 0.72;
    wet.gain.value = clamp(params.mix, 0, .9, .45);
    delay.delayTime.value = clamp(params.delaySeconds, .01, 3.8, .22);
    feedback.gain.value = clamp(params.feedback, 0, .78, .36);
    safeConnect(bus.input, dry);
    safeConnect(dry, bus.output);
    safeConnect(bus.input, delay);
    safeConnect(delay, wet);
    safeConnect(wet, bus.output);
    safeConnect(delay, feedback);
    safeConnect(feedback, delay);
    bus.nodes.push(dry, wet, delay, feedback);
    bus.controlParam = delay.delayTime;
    bus.controlBase = delay.delayTime.value;
    bus.controlDepth = .08;
    bus.controlMinimum = .01;
    bus.controlMaximum = 3.8;
    return bus;
  }

  if (primitiveId === "reverb") {
    const dry = context.createGain();
    const wet = context.createGain();
    const convolver = context.createConvolver();
    dry.gain.value = .65;
    wet.gain.value = clamp(params.mix, 0, .9, .42);
    convolver.buffer = makeImpulse(context);
    safeConnect(bus.input, dry);
    safeConnect(dry, bus.output);
    safeConnect(bus.input, convolver);
    safeConnect(convolver, wet);
    safeConnect(wet, bus.output);
    bus.nodes.push(dry, wet, convolver);
    bus.controlParam = wet.gain;
    bus.controlBase = wet.gain.value;
    bus.controlDepth = .32;
    bus.controlMinimum = 0;
    bus.controlMaximum = .9;
    return bus;
  }

  if (primitiveId === "compressor") {
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 16;
    compressor.ratio.value = 5;
    compressor.attack.value = .004;
    compressor.release.value = .16;
    safeConnect(bus.input, compressor);
    safeConnect(compressor, bus.output);
    bus.nodes.push(compressor);
    bus.controlParam = compressor.threshold;
    bus.controlBase = compressor.threshold.value;
    bus.controlDepth = 8;
    bus.controlMinimum = -100;
    bus.controlMaximum = 0;
    return bus;
  }

  if (["gain", "mixer", "output"].includes(primitiveId)) {
    const gain = context.createGain();
    gain.gain.value = clamp(params.gain, 0, 1.5, primitiveId === "output" ? .88 : .76);
    safeConnect(bus.input, gain);
    safeConnect(gain, bus.output);
    bus.nodes.push(gain);
    bus.controlParam = gain.gain;
    bus.controlBase = gain.gain.value;
    bus.controlDepth = .28;
    bus.controlMinimum = 0;
    bus.controlMaximum = 1.5;
    return bus;
  }

  safeConnect(bus.input, bus.output);
  return bus;
}

/**
 * One shared Web Audio graph for the whole patch. Trigger and control flow is
 * projected in beats and scheduled; only continuous audio cables compile here.
 */
export class ConstellationAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.patch = null;
    this.flattened = null;
    this.master = null;
    this.compressor = null;
    this.output = .54;
    this.started = false;
    this.startPromise = null;
    this.buses = new Map();
    this.graphNodes = [];
    this.modulators = [];
    this.activeVoices = new Set();
    this.noiseBuffers = new Map();
    this.transport = { tempo: 120, beat: 0, contextTime: 0 };
  }

  setPatch(patch) {
    this.patch = patch;
    this.transport.tempo = clamp(patch?.tempo, 30, 300, this.transport.tempo);
    if (this.context && this.context.state !== "closed") this.#compilePatch();
  }

  /**
   * Keep the adapter's tempo fallback aligned with the musical transport.
   * Projected LFO/control events already carry their phase in beats, so this
   * intentionally does not create or restart a free-running oscillator.
   */
  syncTransport(options = {}) {
    const values = typeof options === "number" ? { tempo: options } : options ?? {};
    this.transport = {
      tempo: clamp(values.tempo, 30, 300, this.patch?.tempo ?? this.transport.tempo),
      beat: Math.max(0, finite(values.beat, this.transport.beat)),
      contextTime: Math.max(0, finite(values.contextTime, this.context?.currentTime ?? this.transport.contextTime)),
    };
    return { ...this.transport };
  }

  setTempo(tempo, options = {}) {
    return this.syncTransport({ ...options, tempo });
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async #startInternal() {
    if (!this.context || this.context.state === "closed") {
      const AudioContextConstructor = this.runtime?.AudioContext ?? this.runtime?.webkitAudioContext;
      if (typeof AudioContextConstructor !== "function") throw new Error("Web Audio is not available in this browser.");
      this.context = new AudioContextConstructor();
      this.noiseBuffers.clear();
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor?.() ?? this.context.createGain();
      this.compressor.threshold && (this.compressor.threshold.value = -10);
      this.compressor.knee && (this.compressor.knee.value = 12);
      this.compressor.ratio && (this.compressor.ratio.value = 8);
      safeConnect(this.master, this.compressor);
      safeConnect(this.compressor, this.context.destination);
      this.setOutput(this.output);
      this.#compilePatch();
    }
    if (this.context.state !== "running") await this.context.resume?.();
    this.started = true;
    return this.context;
  }

  #clearCompiledGraph() {
    for (const voice of [...this.activeVoices]) {
      try { voice.source?.stop?.(); } catch { /* already stopped */ }
      this.#releaseVoice(voice);
    }
    this.activeVoices.clear();
    for (const oscillator of this.modulators) {
      try { oscillator.stop?.(); } catch { /* already stopped */ }
      safeDisconnect(oscillator);
    }
    this.modulators = [];
    for (const node of this.graphNodes) safeDisconnect(node);
    this.graphNodes = [];
    this.buses.clear();
  }

  #compilePatch() {
    if (!this.context || !this.patch) return;
    this.#clearCompiledGraph();
    this.flattened = flattenPatch(this.patch, this.patch.rootGraphId);
    for (const flat of this.flattened.nodes) {
      const audio = primitiveBus(this.context, flat);
      this.buses.set(flat.address, { audio, control: null, flat });
      this.graphNodes.push(...audio.nodes);
      if (flat.node?.primitiveId === "output") safeConnect(audio.output, this.master);
    }

    for (const edge of this.flattened.edges) {
      const source = this.buses.get(edge.sourceAddress);
      const target = this.buses.get(edge.targetAddress);
      if (!source || !target) continue;
      if (edge.signal === "audio") {
        if (edge.feedback) {
          const delay = this.context.createDelay(.1);
          const gain = this.context.createGain();
          delay.delayTime.value = .01;
          gain.gain.value = clamp(edge.gain, 0, .78, .25);
          safeConnect(source.audio.output, delay);
          safeConnect(delay, gain);
          safeConnect(gain, target.audio.input);
          this.graphNodes.push(delay, gain);
        } else {
          const gain = this.context.createGain();
          gain.gain.value = clamp(edge.gain, 0, 2, 1);
          safeConnect(source.audio.output, gain);
          safeConnect(gain, target.audio.input);
          this.graphNodes.push(gain);
        }
      }
    }
  }

  setOutput(value) {
    this.output = clamp(value, 0, .9, .54);
    if (!this.master || !this.context) return;
    const now = finite(this.context.currentTime, 0);
    setParam(this.master.gain, "cancelScheduledValues", now, now);
    if (typeof this.master.gain.setTargetAtTime === "function") this.master.gain.setTargetAtTime(this.output, now, .02);
    else setParam(this.master.gain, "setValueAtTime", this.output, now);
  }

  #releaseVoice(record) {
    if (!record || record.released) return;
    record.released = true;
    this.activeVoices.delete(record);
    safeDisconnect(record.source);
    safeDisconnect(record.gain);
    for (const node of record.nodes ?? []) safeDisconnect(node);
  }

  #admitVoice(record) {
    if (this.activeVoices.size >= MAX_ACTIVE_VOICES) {
      const oldest = this.activeVoices.values().next().value;
      try { oldest?.source?.stop?.(); } catch { /* voice already ended */ }
      this.#releaseVoice(oldest);
    }
    this.activeVoices.add(record);
    record.source.onended = () => this.#releaseVoice(record);
  }

  #noiseBuffer(identity) {
    const sampleRate = Math.max(1, Math.floor(finite(this.context?.sampleRate, 44_100)));
    const key = `${sampleRate}:${identity}`;
    const cached = this.noiseBuffers.get(key);
    if (cached) return cached;
    const frames = Math.max(1, Math.floor(sampleRate * .16));
    const buffer = this.context.createBuffer(1, frames, sampleRate);
    const data = buffer.getChannelData(0);
    let seed = hashString(`constellation-noise:${key}`) || 1;
    for (let index = 0; index < frames; index += 1) {
      seed = (seed * 16807) % 2147483647;
      data[index] = (seed / 1073741823.5 - 1) * (1 - index / frames);
    }
    this.noiseBuffers.set(key, buffer);
    return buffer;
  }

  #triggerControl(event, bus, startsAt, secondsPerBeat) {
    const audio = bus?.audio;
    const parameter = audio?.controlParam;
    if (!parameter) return { scheduled: false, skipped: true, reason: "no-control-target", event };
    const normalized = clamp(event.value, 0, 1, .5);
    const base = finite(audio.controlBase, finite(parameter.value, 0));
    const depth = Math.max(0, finite(audio.controlDepth, 0));
    const targetValue = clamp(
      base + (normalized * 2 - 1) * depth,
      finite(audio.controlMinimum, finite(parameter.minValue, -Infinity)),
      finite(audio.controlMaximum, finite(parameter.maxValue, Infinity)),
      base,
    );
    const rampSeconds = clamp(
      Math.max(1 / 64, finite(event.durationBeats, .25)) * secondsPerBeat * .08,
      .003,
      .08,
      .012,
    );
    if (typeof parameter.setTargetAtTime === "function") {
      setParam(parameter, "setTargetAtTime", targetValue, startsAt, rampSeconds);
    } else {
      setParam(parameter, "setValueAtTime", targetValue, startsAt);
    }
    return { scheduled: true, startAt: startsAt, targetValue, event };
  }

  #triggerPitched(event, destination, startsAt, secondsPerBeat) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const sound = String(event.soundId ?? "").toLowerCase();
    oscillator.type = sound.includes("lattice") ? "triangle" : sound.includes("voice") ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(midiFrequency(event.note), startsAt);
    if (sound.includes("spiral") && oscillator.detune) {
      oscillator.detune.setValueAtTime(-7, startsAt);
      oscillator.detune.linearRampToValueAtTime(14, startsAt + Math.max(.08, event.durationBeats * secondsPerBeat));
    }
    const peak = clamp(event.velocity * .18, .018, .24, .12);
    const attackEnd = startsAt + .008;
    const releaseAt = startsAt + Math.max(.04, event.durationBeats * secondsPerBeat);
    gain.gain.setValueAtTime(SILENCE, startsAt);
    gain.gain.linearRampToValueAtTime(peak, attackEnd);
    gain.gain.exponentialRampToValueAtTime(SILENCE, releaseAt);
    safeConnect(oscillator, gain);
    safeConnect(gain, destination);
    oscillator.start(startsAt);
    oscillator.stop(releaseAt + .03);
    this.#admitVoice({ source: oscillator, gain });
    return { scheduled: true, startAt: startsAt, event };
  }

  #triggerDrum(event, destination, startsAt, secondsPerBeat) {
    const identity = hashString(`${event.id}:${event.note}`) % 4;
    if (identity === 0 || event.note < 52) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(120, startsAt);
      oscillator.frequency.exponentialRampToValueAtTime(42, startsAt + .12);
      gain.gain.setValueAtTime(clamp(event.velocity * .42, .04, .55, .32), startsAt);
      gain.gain.exponentialRampToValueAtTime(SILENCE, startsAt + .2);
      safeConnect(oscillator, gain);
      safeConnect(gain, destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + .23);
      this.#admitVoice({ source: oscillator, gain });
      return { scheduled: true, startAt: startsAt, event };
    }

    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.#noiseBuffer(identity);
    filter.type = identity === 1 ? "bandpass" : "highpass";
    filter.frequency.value = identity === 1 ? 1_600 : 5_800;
    filter.Q.value = identity === 1 ? 1.8 : .8;
    gain.gain.setValueAtTime(clamp(event.velocity * .25, .025, .36, .2), startsAt);
    gain.gain.exponentialRampToValueAtTime(SILENCE, startsAt + (identity === 1 ? .16 : .07));
    safeConnect(source, filter);
    safeConnect(filter, gain);
    safeConnect(gain, destination);
    source.start(startsAt);
    source.stop(startsAt + .18);
    this.#admitVoice({ source, gain, nodes: [filter] });
    return { scheduled: true, startAt: startsAt, event, secondsPerBeat };
  }

  async trigger(event, options = {}) {
    const isControl = event?.signal === "control";
    if (!isControl && !event?.playable) return { scheduled: false, skipped: true, reason: "not-playable" };
    if (!isControl && !playableEventHasEnergy(event)) return { scheduled: false, skipped: true, reason: "silent" };
    await this.start();
    const bus = this.buses.get(event?.address);
    if (!bus) return { scheduled: false, skipped: true, reason: "unrouted" };
    const delaySeconds = Math.max(0, finite(options.delaySeconds, 0));
    const secondsPerBeat = Math.max(1 / 1_000, finite(options.secondsPerBeat, 60 / this.transport.tempo));
    const startsAt = finite(this.context.currentTime, 0) + delaySeconds;
    if (isControl) return this.#triggerControl(event, bus, startsAt, secondsPerBeat);
    return event.instrumentType === "drums"
      ? this.#triggerDrum(event, bus.audio.input, startsAt, secondsPerBeat)
      : this.#triggerPitched(event, bus.audio.input, startsAt, secondsPerBeat);
  }

  resetControls({ toBase = true } = {}) {
    if (!this.context || this.context.state === "closed") return 0;
    const now = finite(this.context.currentTime, 0);
    let reset = 0;
    for (const { audio } of this.buses.values()) {
      const parameter = audio?.controlParam;
      if (!parameter) continue;
      if (!toBase && typeof parameter.cancelAndHoldAtTime === "function") {
        setParam(parameter, "cancelAndHoldAtTime", now);
      } else {
        const heldValue = finite(parameter.value, finite(audio.controlBase, 0));
        setParam(parameter, "cancelScheduledValues", now);
        setParam(parameter, "setValueAtTime", toBase ? finite(audio.controlBase, heldValue) : heldValue, now);
      }
      reset += 1;
    }
    return reset;
  }

  silence() {
    for (const voice of [...this.activeVoices]) {
      try { voice.source?.stop?.(); } catch { /* already stopped */ }
      this.#releaseVoice(voice);
    }
    this.activeVoices.clear();
  }

  async close() {
    this.started = false;
    this.silence();
    this.#clearCompiledGraph();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffers.clear();
    if (context && context.state !== "closed") await context.close?.();
  }
}
