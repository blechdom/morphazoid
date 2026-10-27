import { createWitchCatClock, snapshotWitchCatClock } from './witch-cat-model.js';
import { unlockAudioContext } from '../../audio.js';
import { connectAudioOutput } from '../../audio-output-manager.js';
import { normalizeWitchControls, witchClamp, witchSpoonHeight, WITCH_EFFECTS, WITCH_DROP_EFFECTS, WITCH_TAU } from './witch-model.js';

/** Only start(), called directly by Audio or a genuine scene-wake gesture,
 * creates or resumes a context. Control updates never arm audio themselves. */
export class WitchAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime; this.context = null; this.node = null; this.master = null;
    this.presenceNode = null; this.presence = 1; this.presenceFade = null;
    this.controls = normalizeWitchControls(); this.audible = false; this.disposed = false;
    this.starting = null; this.generation = 0; this.releaseOutput = null;
    this.pendingPhase = null; this.phaseGeneration = 0;
    this.nextDropVariants = Object.create(null);
    this.visual = { phase: 0, chantPhase: 0, mouth: 0, energy: 0, speed: 0, direction: 1, syllable: 0, audioTime: 0, effect: '', effectEnvelope: 0, breath: 0,
      catClock: createWitchCatClock(), catTime: 0, catLevel: 0, catMeow: 0, catMeowLevel: 0, handTime: 0, flightPhase: 0, ghostPhase: 0, ghostPresence: [0,0,0], ghostPulses: [0,0,0], ghostLevel: 0, brewLevel: 0, handLevel: 0, dropLevel: 0, dropKind: '', dropVariant: 0, dropEnvelope: 0, delayWet: 0, delayTime: .32, delayLevel: 0,
      spoonHeight: .5, activeVoice: 'mutter', fingerLevels: [0, 0, 0, 0, 0], flightPulse: 0, flightStep: 0, launchEnvelope: 0, launchActive: false, flybyTime: 0, flybyLevel: 0, flybyFrenzy: 0, flybyFrenzyIndex: 0 };
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
      processorOptions: { phaseGeneration: this.phaseGeneration },
    });
    const master = context.createGain(); master.gain.value = 0;
    const presence = context.createGain(); presence.gain.value = this.presence;
    node.connect(presence); presence.connect(master);
    this.node = node; this.master = master; this.presenceNode = presence; this.presenceFade = null;
    this.releaseOutput = connectAudioOutput(context, master, { runtime: this.runtime });
    node.port.onmessage = ({ data }) => {
      if (this.node !== node || data?.type !== 'visual') return;
      // A pre-seek packet may already be queued on the main thread. Keep the
      // synchronous clock snapshot until the worklet acknowledges this seek.
      if ((data.phaseGeneration ?? 0) !== this.phaseGeneration) return;
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
  /** Fade the whole performance without changing Audio, transport or volume.
   * A separate node keeps output-level edits from replacing a hair/wake fade. */
  setPresence(value, seconds = .8) {
    if (this.disposed) return;
    const target = witchClamp(value, 0, 1, this.presence);
    if (!this.presenceNode || !this.context) { this.presence = target; this.presenceFade = null; return; }
    const now = this.context.currentTime, fade = this.presenceFade;
    const duration = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : .8;
    const progress = fade ? witchClamp((now - fade.start) / Math.max(1e-9, fade.end - fade.start)) : 1;
    const current = fade ? fade.from + (fade.to - fade.from) * progress : this.presence;
    const param = this.presenceNode.gain;
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else param.cancelScheduledValues(now);
    param.setValueAtTime(duration ? current : target, now);
    if (duration) param.linearRampToValueAtTime(target, now + duration);
    this.presence = target;
    this.presenceFade = { from: duration ? current : target, to: target, start: now, end: now + duration };
  }
  /** Align silent viewport motion on first arm or explicit visual recovery.
   * This does not arm audio or restart the vocal phrase. Vortex phase is radians;
   * optional handTime is seconds of the independent Gesticules choreography;
   * spoonHeight joins its visible position; flightPhase keeps the broom and delay
   * at their current point through silent speed changes; ghostPhase is the
   * independent background beat count, preserved through tempo changes.
   * flybyTime counts only elapsed Play time in flight. */
  syncPhase(phase, speed = 0, handTime, spoonHeight, flightPhase, ghostPhase, catClock, flybyTime, capturedAnimals = {}) {
    const message = { type: 'phase', phaseGeneration: ++this.phaseGeneration, phase: ((witchClamp(phase, -1e12, 1e12) % WITCH_TAU) + WITCH_TAU) % WITCH_TAU,
      speed: witchClamp(speed) };
    if (Number.isFinite(handTime)) {
      message.handTime = witchClamp(handTime, 0, 1e9); this.visual.handTime = message.handTime;
      message.spoonHeight = witchClamp(spoonHeight, 0, 1,
        this.controls.spoonAuto ? witchSpoonHeight(message.handTime) : this.controls.spoonHeight);
      this.visual.spoonHeight = message.spoonHeight;
      message.flightPhase = witchClamp(flightPhase, 0, 1e12, message.handTime * (1 + this.controls.flightSpeed * 5) / 1.4);
      this.visual.flightPhase = message.flightPhase;
    }
    if (Number.isFinite(ghostPhase)) { message.ghostPhase = witchClamp(ghostPhase,0,1e12);this.visual.ghostPhase = message.ghostPhase; }
    if (Number.isFinite(flybyTime)) { message.flybyTime = witchClamp(flybyTime,0,1e12);this.visual.flybyTime = message.flybyTime;this.visual.flybyLevel = 0;this.visual.flybyFrenzy = 0; }
    if (catClock && typeof catClock === 'object') { message.catClock = snapshotWitchCatClock(catClock); this.visual.catClock = message.catClock; this.visual.catTime = message.catClock.time; this.visual.catMeow = 0; this.visual.catMeowLevel = 0; }
    // A rebuilt worklet joins the visible visit without reviving captured feet
    // or replaying an animal's earlier dive sound.
    message.visitorCaptures = {};
    for (const id of ['mouse', 'lizard']) if (Number.isFinite(capturedAnimals?.[id]?.startedAt)) {
      message.visitorCaptures[id] = capturedAnimals[id].startedAt;
    }
    this.visual.phase = message.phase; this.visual.speed = message.speed;
    if (this.node) this.post(message); else this.pendingPhase = message;
  }
  update(value = {}) {
    const priorVolume = this.controls.volume;
    this.controls = normalizeWitchControls({ ...this.controls, ...value,
      handFocus: value.mode && value.mode !== this.controls.mode && value.handFocus === undefined ? undefined : value.handFocus ?? this.controls.handFocus });
    this.post({ type: 'controls', controls: this.controls });
    if (this.controls.volume !== priorVolume) this.setGain();
  }
  trigger(kind, detail) {
    if (!this.running || !WITCH_EFFECTS.includes(kind)) return false;
    const variant = WITCH_DROP_EFFECTS.includes(kind) ? this.nextDropVariants[kind] ?? 0 : undefined;
    this.post({ type: 'trigger', kind, variant, ...(['unicorn-escape','shape-charm','blech-frenzy'].includes(kind)&&detail?{detail}:{}), at: this.context.currentTime });
    if (variant !== undefined) this.nextDropVariants[kind] = (variant + 1) % 3;
    return true;
  }
  /** Release manual accents even when primary Play is already stopped. */
  releaseAccents() { this.post({ type: 'release-accents' }); }
  detach() {
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null; this.node.disconnect(); this.node.port.close?.(); }
    this.releaseOutput?.(); this.releaseOutput = null;
    this.presenceNode?.disconnect(); this.presenceNode = null; this.presenceFade = null;
    this.master?.disconnect(); this.node = null; this.master = null;
  }
  async dispose() {
    this.disposed = true; this.generation++; this.audible = false; this.presence = 0;
    const context = this.context; this.post({ type: 'dispose' }); this.detach(); this.context = null;
    if (context && context.state !== 'closed') await context.close();
  }
}
