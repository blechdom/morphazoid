import { connectAudioOutput } from '../../audio-output-manager.js';
import { unlockAudioContext } from '../../audio.js';
import { resumeAudioContext, withAudioTimeout } from '../../audio-startup.js';

export class VectorAudio {
  constructor({ onTelemetry, onError } = {}) {
    this.onTelemetry = onTelemetry; this.onError = onError; this.generation = 0;
    this.context = null; this.node = null; this.output = null; this.release = null;
    this.starting = null; this.destroyed = false;
  }
  async start(options) {
    if (this.destroyed) throw new Error('Instrument closed.');
    if (this.starting) return this.starting;
    if (this.node) return resumeAudioContext(this.context);
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) throw new Error('Web Audio is not available.');
    const generation = ++this.generation;
    const context = new Context({ latencyHint: 'interactive' }); this.context = context;
    // iOS activation must be consumed before awaiting any module fetch.
    unlockAudioContext(context);
    const resumed = resumeAudioContext(context); resumed.catch(() => {});
    const pending = (async () => {
      try {
        if (!context.audioWorklet) throw new Error('Use a browser with AudioWorklet support on localhost or HTTPS.');
        await withAudioTimeout(Promise.all([resumed, context.audioWorklet.addModule(new URL('./processor.js', import.meta.url))]));
        if (generation !== this.generation || this.destroyed) throw new Error('Audio startup cancelled.');
        this.node = new AudioWorkletNode(context, 'vector-fractals', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: options });
        this.output = context.createGain(); this.output.gain.value = 1;
        this.node.connect(this.output); this.release = connectAudioOutput(context, this.output);
        this.node.port.onmessage = ({ data }) => this.onTelemetry?.(data);
        this.node.onprocessorerror = () => { void this.stop(); this.onError?.(new Error('Audio processor stopped. Press Audio to retry.')); };
      } catch (error) { if (this.context === context) await this.stop(); else await context.close().catch(() => {}); throw error; }
    })();
    this.starting = pending;
    try { await pending; } finally { if (this.starting === pending) this.starting = null; }
  }
  send(data) { this.node?.port.postMessage(data); }
  async stop() {
    ++this.generation;
    const context = this.context, node = this.node, output = this.output, release = this.release;
    this.context = null; this.node = null; this.output = null; this.release = null;
    // Release the shared output only after a short click-free master ramp.
    if (output && context?.state === 'running') {
      output.gain.cancelScheduledValues(context.currentTime);
      output.gain.setTargetAtTime(0, context.currentTime, .008);
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    try { node?.port.postMessage({ type: 'dispose' }); node?.port.close(); node?.disconnect(); output?.disconnect(); } catch { /* Already closed. */ }
    release?.();
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
  async destroy() { this.destroyed = true; await this.stop(); }
}
