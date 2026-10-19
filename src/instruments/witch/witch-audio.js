import { unlockAudioContext } from '../../audio.js';
import { connectAudioOutput } from '../../audio-output-manager.js';
import { normalizeWitchControls, witchClamp, WITCH_VOCAL_EFFECTS, WITCH_FLIGHT_EFFECTS, WITCH_TAU } from './witch-model.js';

/** Only start(), called directly by the explicit Audio handler, creates or
 * resumes a context. Gesture updates and one-shots are safe while Audio is off. */
export class WitchAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime; this.context = null; this.node = null; this.master = null;
    this.controls = normalizeWitchControls(); this.audible = false; this.disposed = false;
    this.starting = null; this.generation = 0; this.releaseOutput = null;
    this.pendingPhase = null;
    this.visual = { phase: 0, chantPhase: 0, mouth: 0, energy: 0, speed: 0, direction: 1, syllable: 0, audioTime: 0, effect: '', effectEnvelope: 0, breath: 0,
      fingerLevels: [0, 0, 0, 0, 0], flightPulse: 0, flightStep: 0 };
    this.onError = null;
  }
  get running() { return this.audible && this.context?.state === 'running' && Boolean(this.node); }
  start() {
    if (this.disposed) return Promise.reject(new Error('This Witch audio engine has been disposed.'));
    if (this.starting) return this.starting;
    const Constructor = this.runtime.AudioContext || this.runtime.webkitAudioContext;
    if (!Constructor) return Promise.reject(new Error('Web Audio is unavailable in this browser.'));
    if (!this.context || this.context.state === 'closed') this.context = new Constructor({ latencyHint: 'interactive' });
    const context = this.context, generation = this.generation;
    // Resume before module loading so mobile user activation is still live.
    unlockAudioContext(context);
    const resumed = context.state === 'running' ? Promise.resolve() : context.resume();
    const ready = this.node ? Promise.resolve() : this.build(context, generation);
    const promise = Promise.all([resumed, ready]).then(() => {
      if (generation !== this.generation || this.disposed) return false;
      if (context.state !== 'running') throw new Error('Audio is suspended. Turn Audio on again.');
      this.post({ type: 'controls', controls: this.controls });
      if (this.pendingPhase) { this.post(this.pendingPhase); this.pendingPhase = null; }
      this.post({ type: 'enabled', enabled: this.audible }); this.setGain();
      return true;
    }).catch(async error => {
      if (generation !== this.generation) return false;
      this.audible = false; this.detach(); this.context = null;
      if (context.state !== 'closed') await context.close().catch(() => {});
      throw error;
    }).finally(() => { if (this.starting === promise) this.starting = null; });
    this.starting = promise;
    return promise;
  }
  async build(context, generation) {
    if (!context.audioWorklet?.addModule || typeof this.runtime.AudioWorkletNode !== 'function') {
      throw new Error('Witch requires AudioWorklet support. Try a current browser.');
    }
    await context.audioWorklet.addModule(new URL('./witch-worklet.js', import.meta.url));
    if (generation !== this.generation || this.disposed || context.state === 'closed') return;
    const node = new this.runtime.AudioWorkletNode(context, 'witch-voice', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2,
    });
    const master = context.createGain(); master.gain.value = 0;
    node.connect(master); this.node = node; this.master = master;
    this.releaseOutput = connectAudioOutput(context, master, { runtime: this.runtime });
    node.port.onmessage = ({ data }) => {
      if (this.node !== node || data?.type !== 'visual') return;
      const { type: _type, ...visual } = data; this.visual = visual;
    };
    node.onprocessorerror = () => {
      if (this.node !== node) return;
      this.setAudible(false); this.detach();
      this.onError?.(new Error('The witch voice stopped. Turn Audio on to rebuild it.'));
    };
  }
  post(data) { this.node?.port.postMessage(data); }
  setGain() {
    if (!this.master || !this.context) return;
    const param = this.master.gain, now = this.context.currentTime;
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues?.(now);
    param.setTargetAtTime(this.audible ? this.controls.volume : 0, now, .02);
  }
  setAudible(value) {
    this.audible = value === true && !this.disposed;
    this.post({ type: 'enabled', enabled: this.audible }); this.setGain();
  }
  /** Align silent viewport motion on first arm or explicit visual recovery.
   * This does not arm audio or restart the vocal phrase. Units are radians. */
  syncPhase(phase, speed = 0) {
    const message = { type: 'phase', phase: ((witchClamp(phase, -1e12, 1e12) % WITCH_TAU) + WITCH_TAU) % WITCH_TAU,
      speed: witchClamp(speed) };
    this.visual.phase = message.phase; this.visual.speed = message.speed;
    if (this.node) this.post(message); else this.pendingPhase = message;
  }
  update(value = {}) {
    const priorVolume = this.controls.volume;
    this.controls = normalizeWitchControls({ ...this.controls, ...value });
    this.post({ type: 'controls', controls: this.controls });
    if (this.controls.volume !== priorVolume) this.setGain();
  }
  trigger(kind) {
    const allowed = this.controls.mode === 'brew' ? WITCH_VOCAL_EFFECTS : this.controls.mode === 'flight' ? WITCH_FLIGHT_EFFECTS : [];
    if (!this.running || !allowed.includes(kind)) return false;
    this.post({ type: 'trigger', kind, at: this.context.currentTime }); return true;
  }
  detach() {
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null; this.node.disconnect(); this.node.port.close?.(); }
    this.releaseOutput?.(); this.releaseOutput = null;
    this.master?.disconnect(); this.node = null; this.master = null;
  }
  async dispose() {
    this.disposed = true; this.generation++; this.audible = false;
    const context = this.context; this.post({ type: 'dispose' }); this.detach(); this.context = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
