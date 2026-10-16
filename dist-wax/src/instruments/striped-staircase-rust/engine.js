import { connectAudioOutput } from '../../audio-output-manager.js';

const wasmUrl = new URL('../../../assets/wasm/staircase.wasm', import.meta.url);
const workletUrl = new URL('./processor.js', import.meta.url);
let modulePromise;
const registrations = new WeakMap();

export class StaircaseEngine {
  static async create(context, callbacks = {}) {
    modulePromise ??= fetch(wasmUrl).then(response => {
      if (!response.ok) throw new Error(`Could not load the staircase engine (${response.status}).`);
      return response.arrayBuffer();
    }).then(bytes => WebAssembly.compile(bytes)).catch(error => { modulePromise = null; throw error; });
    if (!registrations.has(context)) registrations.set(context,
      context.audioWorklet.addModule(workletUrl).catch(error => { registrations.delete(context); throw error; }));
    const [module] = await Promise.all([modulePromise, registrations.get(context)]);
    const engine = new StaircaseEngine(context, module, callbacks);
    try { await engine.ready; return engine; } catch (error) { engine.dispose(); throw error; }
  }
  constructor(context, module, { onState = () => {}, onError = () => {} }) {
    this.closed = false; this.statePending = false; this.stateBuffer = null;
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.ready.catch(() => {});
    this.node = new AudioWorkletNode(context, 'morphazoid-staircase-studies', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { module },
    });
    const fail = error => {
      if (this.closed) return;
      this.reject(error); this.dispose(); onError(error);
    };
    this.node.onprocessorerror = () => fail(new Error('The staircase audio thread stopped. Toggle Audio to retry.'));
    this.node.port.onmessage = ({ data }) => {
      if (this.closed) return;
      if (data.type === 'ready') { clearTimeout(this.timer); this.resolve(); }
      if (data.type === 'state') {
        this.statePending = false;
        this.stateBuffer = data.voices;
        // Retain the display copy on the main thread; return the original
        // buffer with the next request instead of allocating on the audio thread.
        onState({ ...data, voices: data.voices.slice() });
      }
      if (data.type === 'error') fail(new Error(data.message));
    };
    this.release = connectAudioOutput(context, this.node);
    this.timer = setTimeout(() => fail(new Error('The staircase engine did not start.')), 12000);
  }
  send(data, transfer = []) { if (!this.closed) this.node.port.postMessage(data, transfer); }
  requestState() {
    if (this.closed || this.statePending) return;
    this.statePending = true;
    const voices = this.stateBuffer; this.stateBuffer = null;
    this.send({ type: 'state-request', voices }, voices ? [voices.buffer] : []);
  }
  field(table, frames, revision, features = null, featureFrames = frames) {
    // Retain the prepared field in the app for re-arming after an audio error.
    const copy = table.slice(), featureCopy = features?.slice() ?? null;
    this.send({ type: 'field', table: copy, frames, revision, features: featureCopy, featureFrames },
      featureCopy ? [copy.buffer, featureCopy.buffer] : [copy.buffer]);
  }
  controls(state) { this.send({ type: 'controls', mode: state.mode, base: state.baseFrequency,
    brightness: state.brightness, body: state.body, gain: state.level, seconds: 1 / state.speed,
    pitchMapping: state.pitchMapping, pitchSpan: state.pitchSpan,
    turnAmount: state.turnAmount, turnSpan: state.turnSpan,
    accentAmount: state.accentAmount, accentRate: state.accentRate,
    forkAmount: state.forkAmount, forkSpan: state.forkSpan,
    curvatureAmount: state.curvatureAmount, curvatureDrive: state.curvatureDrive,
    endlessAmount: state.endlessAmount, endlessDirection: state.endlessDirection,
    focusFirst: state.focusedTendril == null ? 0 : state.pitchSource === 1 ? state.focusedTendril * 2 - 1 : state.focusedTendril,
    focusSecond: state.focusedTendril != null && state.pitchSource === 1 ? state.focusedTendril * 2 : 0,
    stripeGate: state.stripeGate !== false }); }
  transport(state) { this.send({ type: 'transport', playing: state.playing, enabled: state.audio, hold: state.hold }); }
  seek(depth, direction = 1) { this.send({ type: 'seek', depth, direction }); }
  dispose() {
    if (this.closed) return;
    this.send({ type: 'dispose' }); this.closed = true; this.stateBuffer = null; clearTimeout(this.timer);
    this.reject(new Error('Staircase engine closed.'));
    this.release?.(); this.node.disconnect(); this.node.onprocessorerror = null;
    this.node.port.onmessage = null; this.node.port.close();
  }
}
