import {
  WebGpuChiptuneAudio, WEBGPU_CHIPTUNE_DEFAULTS, WEBGPU_CHIPTUNE_PARAM_ORDER,
  webGpuChiptuneParamArray, packWebGpuChiptuneSequence, sanitizeWebGpuChiptuneParams,
} from '../webgpu-chiptune/webgpu-chiptune.js';
import { ChiptuneTempoClock } from './tempo-clock.js';

export function simdChiptuneSupport(runtime = globalThis) {
  const Ctor = runtime.AudioContext ?? runtime.webkitAudioContext;
  const audio = Boolean(Ctor);
  const worklet = Boolean(runtime.AudioWorkletNode && Ctor?.prototype && 'audioWorklet' in Ctor.prototype);
  const wasm = Boolean(runtime.WebAssembly);
  return { audio, worklet, wasm, supported: audio && worklet && wasm };
}

/** The original instrument's complete state/sequence contract, rendered by WASM. */
export class SimdChiptuneAudio extends WebGpuChiptuneAudio {
  constructor(runtime = globalThis, options = {}) {
    super(runtime, options);
    this.node = null;
    this.backend = 'off';
    this.lifecycle = 0;
    this.timelineOffset = 0;
    this.timelineStart = 0;
    this.workletTelemetry = null;
    this.cancelStart = null;
    this.readyCleanup = null;
    this.tempoClock = new ChiptuneTempoClock(this.params.tempo);
    this.tempoEvent = null; this.tempoEventSerial = 0; this.pausedAudioSeconds = null; this.previewAudioAnchor = null;
  }

  configuration() {
    const packed = packWebGpuChiptuneSequence(this.sequence, this.sequenceRevision, this.sequenceTransitions);
    if (this.pendingPreview && !Number.isFinite(this.pendingPreview.startOffset)) {
      this.pendingPreview = Object.freeze({ ...this.pendingPreview, startOffset: this.sequenceEditSafeTime() });
    }
    const preview = this.pendingPreview;
    if (!preview) this.previewAudioAnchor = null;
    else if (this.previewAudioAnchor?.serial !== preview.serial) {
      this.previewAudioAnchor = { serial: preview.serial, seconds: this.tempoClock.timeAtBeat(preview.startOffset * this.params.tempo) };
    }
    const previewStart = this.previewAudioAnchor?.seconds ?? -1;
    return { tempoEvent: this.tempoEvent, params: webGpuChiptuneParamArray(this.params), meta: packed.meta,
      cells: new Uint8Array(packed.cells),
      time: new Float32Array([0, preview?.lane ?? -1, preview?.value ?? 0, previewStart]) };
  }

  async start(params = WEBGPU_CHIPTUNE_DEFAULTS, options = {}) {
    if (this.context) await this.stop();
    const generation = ++this.lifecycle;
    const Ctor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
    const external = options.context ?? options.audioContext;
    if (!Ctor && !external) throw new Error('Web Audio is unavailable in this browser.');
    this.context = external ?? new Ctor({ latencyHint: 'interactive' });
    this.ownsContext = !external;
    let cancelStart;
    const cancelled = new Promise((_, reject) => {
      cancelStart = () => reject(new Error('Chiptune startup was cancelled.'));
    });
    this.cancelStart = cancelStart;
    // Preflight can fail before the first race starts listening for cancellation.
    void cancelled.catch(() => {});
    // This happens directly inside the explicit Audio gesture, before loading.
    try {
      const resumed = this.context.state === 'suspended' ? this.context.resume() : Promise.resolve();
      if (!this.context.audioWorklet || !this.runtime.AudioWorkletNode) throw new Error('SIMD Chiptune needs AudioWorklet on HTTPS or localhost.');
      if (!this.runtime.WebAssembly) throw new Error('WebAssembly is unavailable in this browser.');
      const context = this.context;
      const fetchBytes = async backend => {
        const response = await this.runtime.fetch(new URL(`../../../assets/wasm/simd-chiptune-${backend}.wasm`, import.meta.url));
        if (!response.ok) throw new Error(`Could not load the ${backend} chiptune engine (${response.status}).`);
        return response.arrayBuffer();
      };
      const forceScalar = options.forceScalar ?? new URL(this.runtime.location?.href ?? 'https://localhost/').searchParams.has('scalar');
      const [scalarBytes, simdBytes] = await Promise.race([Promise.all([
        fetchBytes('scalar'), forceScalar ? null : fetchBytes('simd').catch(() => null),
        context.audioWorklet.addModule(new URL('./processor.js', import.meta.url)), resumed,
      ]), cancelled]);
      if (generation !== this.lifecycle || this.context !== context) throw new Error('Chiptune startup was cancelled.');
      this.sampleRate = context.sampleRate;
      this.chunkDurationInSeconds = 128 / this.sampleRate;
      this.destination = options.destination ?? null;
      this.createAudioGraph(this.destination);
      this.updateParams(params);
      this.updateSequence(options.sequence ?? this.sequence, { deferDrums: false });
      const node = new this.runtime.AudioWorkletNode(context, 'morphazoid-simd-chiptune', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.node = node;
      node.connect(this.input);
      await Promise.race([new Promise((resolve, reject) => {
        const timeout = this.runtime.setTimeout(() => reject(new Error('The SIMD chiptune engine did not become ready.')), 8000);
        this.readyCleanup = () => this.runtime.clearTimeout(timeout);
        const fail = error => { this.readyCleanup?.(); reject(error); };
        node.addEventListener('processorerror', () => {
          if (generation !== this.lifecycle) return;
          const error = new Error('The chiptune audio worklet stopped. Turn Audio off and on to recover.');
          fail(error); this.onError?.(error);
        });
        node.port.onmessage = ({ data }) => {
          if (generation !== this.lifecycle) return;
          if (data.type === 'ready') { this.backend = data.backend; this.runtime.clearTimeout(timeout); resolve(); }
          else if (data.type === 'backend') this.backend = data.backend;
          else if (data.type === 'telemetry') { this.workletTelemetry = data; this.backend = data.backend; }
          else if (data.type === 'error') { const error = new Error(data.message); fail(error); this.onError?.(error); }
        };
        node.port.postMessage({ type: 'install', scalarBytes, simdBytes, configuration: this.configuration() }, simdBytes ? [scalarBytes, simdBytes] : [scalarBytes]);
      }), cancelled]);
      if (generation !== this.lifecycle) throw new Error('Chiptune startup was cancelled.');
      this.renderOffset = Math.max(0, Number(options.offset) || 0);
      if (options.autoStart !== false) await this.restart(options);
      this.applyOutputGain();
      return context;
    } catch (error) {
      if (generation === this.lifecycle) await this.stop().catch(() => {});
      throw error;
    } finally {
      if (this.cancelStart === cancelStart) {
        this.readyCleanup?.(); this.readyCleanup = null; this.cancelStart = null;
      }
    }
  }

  // Original updateParams/updateSequence preserve all 154 controls and edit latches.
  scheduleRenderRefresh() {
    this.node?.port.postMessage({ type: 'configure', configuration: this.configuration() });
  }

  updateParams(params = this.params) {
    const previousTempo = this.params.tempo;
    const nextTempo = sanitizeWebGpuChiptuneParams(params).tempo;
    if (nextTempo !== previousTempo) {
      const seconds = this.currentAudioSeconds();
      this.tempoClock.setTempo(nextTempo, seconds);
      this.tempoEvent = { seconds, tempo: nextTempo, serial: ++this.tempoEventSerial };
      // The original edit API expresses activation in beat / selected-tempo
      // seconds. Rebase those coordinates without moving their musical beat.
      for (const [key, transition] of this.sequenceTransitions) {
        this.sequenceTransitions.set(key, Object.freeze({ ...transition, applyAt: transition.applyAt * previousTempo / nextTempo }));
      }
      if (Number.isFinite(this.pendingPreview?.startOffset)) {
        this.pendingPreview = Object.freeze({ ...this.pendingPreview, startOffset: this.pendingPreview.startOffset * previousTempo / nextTempo });
      }
      if (!this.running && this.pausedAudioSeconds !== null) this.renderOffset = this.tempoClock.beatAt(seconds) / nextTempo;
    }
    super.updateParams(params);
    if (!this.running) this.scheduleRenderRefresh();
  }

  updateSequence(sequence, options) {
    super.updateSequence(sequence, options);
    if (!this.running) this.scheduleRenderRefresh();
  }

  sequenceEditSafeTime() {
    const seconds = this.currentAudioSeconds() + 128 / (this.sampleRate || 48000);
    return this.tempoClock.beatAt(seconds) / this.params.tempo;
  }

  currentAudioSeconds() {
    if (!this.context || !this.running) return this.pausedAudioSeconds ?? this.renderOffset;
    return this.timelineOffset + Math.max(0, this.context.currentTime - this.timelineStart);
  }

  currentPlaybackBeat() {
    if (!this.context || !this.running) return null;
    return this.tempoClock.beatAt(this.currentAudioSeconds());
  }

  currentPlaybackTime() {
    const beat = this.currentPlaybackBeat();
    return beat === null ? null : beat / this.params.tempo;
  }

  pause() {
    this.pausedAudioSeconds = this.currentAudioSeconds();
    this.renderOffset = this.currentPlaybackTime() ?? this.renderOffset;
    this.running = false;
    this.sequenceTransitions.clear();
    this.pendingPreview = null;
    this.node?.port.postMessage({ type: 'transport', playing: false, offset: this.pausedAudioSeconds });
    this.scheduleRenderRefresh();
    return this.renderOffset;
  }

  async restart({ offset = 0, startAt } = {}) {
    if (!this.context || !this.node) throw new Error('Turn Audio on before restarting the chiptune engine.');
    this.sequenceTransitions.clear();
    this.pendingPreview = null;
    const requestedOffset = Math.max(0, Number(offset) || 0);
    const resume = this.pausedAudioSeconds !== null && Math.abs(requestedOffset - this.renderOffset) < 0.00001;
    this.timelineOffset = resume ? this.pausedAudioSeconds : requestedOffset;
    if (!resume) this.tempoClock.reset(this.params.tempo);
    this.renderOffset = requestedOffset;
    this.pausedAudioSeconds = null;
    this.timelineStart = Math.max(this.context.currentTime + 0.012, Number(startAt) || 0);
    this.workletTelemetry = null;
    this.scheduleRenderRefresh();
    this.running = true;
    this.node.port.postMessage({ type: 'transport', playing: true, offset: this.timelineOffset, startAt: this.timelineStart, clock: this.tempoClock.segments });
    return this.timelineStart;
  }

  async stop() {
    ++this.lifecycle;
    this.cancelStart?.(); this.cancelStart = null;
    this.readyCleanup?.(); this.readyCleanup = null;
    this.node?.port.postMessage({ type: 'dispose' });
    this.node?.disconnect();
    this.node?.port.close();
    this.node = null;
    this.workletTelemetry = null;
    await super.stop();
    this.backend = 'off';
    this.tempoClock.reset(this.params.tempo); this.tempoEvent = null; this.pausedAudioSeconds = null;
  }
}

export const SIMD_CHIPTUNE_PARAM_COUNT = WEBGPU_CHIPTUNE_PARAM_ORDER.length;
