import { connectAudioOutput } from '../../audio-output-manager.js';
import { unlockAudioContext } from '../../audio.js';
import { resumeAudioContext, withAudioTimeout } from '../../audio-startup.js';
import { audioInputConstraints } from '../../audio-input-settings.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
const cancelled = () => Object.assign(new Error('Audio start was cancelled.'), { name: 'AbortError' });
const disconnect = (node) => { try { node?.disconnect(); } catch { /* Already detached. */ } };

/** Explicit Audio arming owns context lifetime; Play never creates a context.
 * Musical events and display telemetry share the AudioWorklet sample clock. */
export class FractalAudio {
  constructor({ onTelemetry, onError, onMicrophoneState } = {}) {
    this.onTelemetry = onTelemetry;
    this.onError = onError;
    this.onMicrophoneState = onMicrophoneState;
    this.microphoneStream = null;
    this.microphoneNode = null;
    this.microphoneGeneration = 0;
    this.microphonePending = null;
    this.microphoneAbort = null;
    this.context = null;
    this.node = null;
    this.output = null;
    this.releaseOutput = null;
    this.generation = 0;
    this.starting = null;
    this.startAbort = null;
    this.level = .55;
    this.playing = false;
    this.phase = 0;
    this.transport = {};
    this.transportRevision = 0;
    this.state = {};
    this.structure = null;
    this.motionBank = null;
    this.source = null;
    this.destroyed = false;
  }

  async start(state, structure, { phase = 0, playing = false, level = .55, transport = {}, deferPlaying = false } = {}) {
    if (this.destroyed) throw new Error('This instrument has been closed.');
    this.state = state;
    this.structure = structure;
    this.phase = clamp(phase, 0, 1);
    this.transport = { ...transport };
    this.playing = Boolean(playing);
    this.level = clamp(level, 0, 1);
    if (this.node && this.context?.state !== 'closed') {
      this.setState(state, structure);
      this.setPlaying(playing);
      this.setLevel(level);
      if (this.context.state !== 'running') await resumeAudioContext(this.context);
      return this;
    }
    if (this.starting) return this.starting;
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) throw new Error('Web Audio is unavailable in this browser.');
    const generation = ++this.generation;
    // Creation, unlock, and resume happen inside the explicit user gesture,
    // before module fetches can consume Safari's transient activation.
    const context = new Context({ latencyHint: 'interactive' });
    this.context = context;
    unlockAudioContext(context);
    this.startAbort = new AbortController();
    const resume = resumeAudioContext(context, { signal: this.startAbort.signal });
    resume.catch(() => {});
    const pending = this.initialize(context, generation, resume, deferPlaying);
    this.starting = pending;
    try { return await pending; }
    finally { if (this.starting === pending) this.starting = null; }
  }

  async initialize(context, generation, resumed, deferPlaying = false) {
    let node, output, release;
    try {
      if (!context.audioWorklet || !globalThis.AudioWorkletNode) {
        throw new Error('This browser needs AudioWorklet support to play Fractal Signals.');
      }
      await withAudioTimeout(Promise.all([
        resumed,
        context.audioWorklet.addModule(new URL('./processor.js', import.meta.url)),
      ]), { signal: this.startAbort?.signal });
      if (generation !== this.generation || this.destroyed) throw cancelled();
      node = new AudioWorkletNode(context, 'fractal-signals', {
        numberOfInputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          state: this.state, structure: this.structure, phase: this.phase,
          // The app can keep loading silent until it hands over the latest
          // visual-clock position and Play state, including a completed pass.
          playing: deferPlaying ? false : this.playing, level: this.level,
          transport: this.transport, transportRevision: this.transportRevision, motionBank: this.motionBank,
        },
      });
      output = context.createGain();
      output.gain.value = 1;
      node.connect(output);
      release = connectAudioOutput(context, output);
      this.node = node;
      this.output = output;
      this.releaseOutput = release;
      node.port.onmessage = ({ data }) => {
        if (generation !== this.generation || data?.type !== 'telemetry' || data.transportRevision !== this.transportRevision) return;
        this.phase = data.phase;
        this.playing = data.playing;
        this.transport = { travelDirection: data.travelDirection, completed: data.completed, time: data.time, motionTime: data.motionTime, modPhases: Array.from(data.modPhases ?? [0, 0]),
          ...(data.phaseClocks ? { phaseClocks: { ...data.phaseClocks } } : {}),
          ...(data.motions ? { motions: { values: { ...data.motions.values }, directions: { ...data.motions.directions } } } : {}) };
        try { this.onTelemetry?.(data); } catch { /* A display observer cannot interrupt sound. */ }
      };
      node.onprocessorerror = () => {
        if (generation !== this.generation) return;
        const error = new Error('The audio processor stopped. Turn Audio on again to recover.');
        void this.stop();
        this.onError?.(error);
      };
      if (this.source) this.sendSource();
      return this;
    } catch (error) {
      release?.();
      disconnect(node);
      disconnect(output);
      try { node?.port?.close(); } catch { /* Optional during failed startup. */ }
      try { await context.close(); } catch { /* It may already be closed by Stop. */ }
      if (this.context === context) {
        this.context = null;
        this.node = null;
        this.output = null;
        this.releaseOutput = null;
      }
      throw error;
    }
  }

  send(message, transfer = []) {
    if (this.node && this.context?.state !== 'closed') this.node.port.postMessage(message, transfer);
  }

  setState(state, structure, options = {}) {
    if (options.resetMotions || this.state.branch !== state.branch || this.state.mode !== state.mode) this.motionBank = null;
    this.state = state;
    this.structure = structure;
    this.send({ type: 'state', state, structure, options, transportRevision: ++this.transportRevision });
  }

  setMotionBank(bank) {
    // Worker structures stay in the UI. Only prepared audio data crosses again.
    this.motionBank = bank ? { version: bank.version, stateKey: bank.stateKey, base: bank.base, mode: bank.mode,
      frames: bank.frames.map(frame => ({ branch: frame.branch, events: frame.events, branchGeometry: frame.branchGeometry, branchTurns: frame.branchTurns })) } : null;
    this.send({ type: 'motionBank', bank: this.motionBank, transportRevision: ++this.transportRevision });
  }

  setPlaying(value) {
    this.playing = Boolean(value);
    this.send({ type: 'playing', value: this.playing, transportRevision: ++this.transportRevision });
  }

  setLevel(value) {
    this.level = clamp(value, 0, 1);
    this.send({ type: 'level', value: this.level });
  }

  setPhase(value, transport = {}) {
    this.phase = clamp(value, 0, 1);
    this.transport = { ...transport };
    this.send({ type: 'phase', value: this.phase, transport: this.transport, transportRevision: ++this.transportRevision });
  }

  setSource(samples, sampleRate = 48000, profile) {
    this.source = samples?.length ? {
      samples: Float32Array.from(samples.slice(0, 576000)),
      sampleRate: clamp(sampleRate, 8000, 192000), profile,
    } : null;
    this.sendSource();
  }

  sendSource() {
    if (!this.node) return;
    const samples = this.source?.samples.slice() ?? null;
    this.send({ type: 'source', samples, sampleRate: this.source?.sampleRate,
      profile: this.source?.profile }, samples ? [samples.buffer] : []);
  }

  get microphoneActive() { return Boolean(this.microphoneStream); }

  async startMicrophone() {
    if (!this.node || !this.context || this.context.state === 'closed') throw new Error('Turn Audio on before enabling the microphone.');
    if (this.microphoneActive) return true;
    if (this.microphonePending) return this.microphonePending;
    const devices = globalThis.navigator?.mediaDevices;
    if (typeof devices?.getUserMedia !== 'function') throw new Error('Microphone capture is unavailable in this browser.');
    const generation = ++this.microphoneGeneration, context = this.context, node = this.node;
    const abort = new AbortController();
    this.microphoneAbort = abort;
    // Only this explicit public method requests capture. Presets/Play never call it.
    const requested = Promise.resolve(devices.getUserMedia(audioInputConstraints()));
    requested.then((stream) => {
      if (generation !== this.microphoneGeneration || context !== this.context || abort.signal.aborted) {
        for (const track of stream.getTracks()) track.stop();
      }
    }, () => {});
    const pending = (async () => {
      let stream, source;
      try {
        // User permission can legitimately take longer than audio startup; cancellation
        // still rejects promptly and retires a stream granted after Audio/Mic off.
        stream = await withAudioTimeout(requested, { timeoutMs: 120000, signal: abort.signal });
        if (generation !== this.microphoneGeneration || context !== this.context || abort.signal.aborted) throw cancelled();
        source = context.createMediaStreamSource(stream);
        source.channelCount = 1;
        source.channelCountMode = 'explicit';
        source.channelInterpretation = 'speakers';
        source.connect(node);
        this.microphoneStream = stream;
        this.microphoneNode = source;
        for (const track of stream.getAudioTracks()) track.addEventListener?.('ended', () => {
          if (this.microphoneStream === stream) this.stopMicrophone();
        }, { once: true });
        this.send({ type: 'microphone', value: true });
        try { this.onMicrophoneState?.(true); } catch { /* UI observer only. */ }
        return true;
      } catch (error) {
        abort.abort();
        disconnect(source);
        if (stream) for (const track of stream.getTracks()) track.stop();
        if (generation === this.microphoneGeneration) {
          this.microphoneStream = this.microphoneNode = null;
          try { this.onMicrophoneState?.(false); } catch { /* UI observer only. */ }
        }
        throw error;
      } finally {
        if (this.microphonePending === pending) this.microphonePending = null;
      }
    })();
    this.microphonePending = pending;
    return pending;
  }

  stopMicrophone() {
    ++this.microphoneGeneration;
    this.microphoneAbort?.abort();
    this.microphoneAbort = null;
    this.microphonePending = null;
    const stream = this.microphoneStream;
    this.microphoneStream = null;
    disconnect(this.microphoneNode);
    this.microphoneNode = null;
    if (stream) for (const track of stream.getTracks()) track.stop();
    this.send({ type: 'microphone', value: false });
    try { this.onMicrophoneState?.(false); } catch { /* UI observer only. */ }
  }

  async stop() {
    this.stopMicrophone();
    ++this.generation;
    this.startAbort?.abort();
    this.startAbort = null;
    const context = this.context, node = this.node, output = this.output;
    const release = this.releaseOutput;
    this.context = this.node = this.output = this.releaseOutput = null;
    this.starting = null;
    if (!context) return;
    if (node && context.state === 'running') {
      try {
        output.gain.cancelScheduledValues(context.currentTime);
        output.gain.setValueAtTime(output.gain.value, context.currentTime);
        output.gain.linearRampToValueAtTime(0, context.currentTime + .035);
      } catch { /* Context can close during navigation. */ }
      await new Promise((resolve) => setTimeout(resolve, 45));
    }
    try { node?.port?.postMessage({ type: 'dispose' }); } catch { /* Already closed. */ }
    release?.();
    disconnect(node);
    disconnect(output);
    try { node?.port?.close(); } catch { /* Already closed. */ }
    try { await context.close(); } catch { /* Already closed. */ }
  }

  async destroy() {
    this.destroyed = true;
    await this.stop();
    this.source = null;
    this.onTelemetry = this.onError = this.onMicrophoneState = null;
  }
}
