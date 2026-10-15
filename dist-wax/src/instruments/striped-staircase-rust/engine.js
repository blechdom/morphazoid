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
    this.closed = false;
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
      if (data.type === 'state') onState(data);
      if (data.type === 'error') fail(new Error(data.message));
    };
    this.release = connectAudioOutput(context, this.node);
    this.timer = setTimeout(() => fail(new Error('The staircase engine did not start.')), 12000);
  }
  send(data, transfer = []) { if (!this.closed) this.node.port.postMessage(data, transfer); }
  field(table, frames, revision) {
    // Retain the prepared field in the app for re-arming after an audio error.
    const copy = table.slice(); this.send({ type: 'field', table: copy, frames, revision }, [copy.buffer]);
  }
  controls(state) { this.send({ type: 'controls', mode: state.mode, base: state.baseFrequency,
    brightness: state.brightness, body: state.body, gain: state.level, seconds: 1 / state.speed }); }
  transport(state) { this.send({ type: 'transport', playing: state.playing, enabled: state.audio, hold: state.hold }); }
  seek(depth, direction = 1) { this.send({ type: 'seek', depth, direction }); }
  dispose() {
    if (this.closed) return;
    this.send({ type: 'dispose' }); this.closed = true; clearTimeout(this.timer);
    this.reject(new Error('Staircase engine closed.'));
    this.release?.(); this.node.disconnect(); this.node.onprocessorerror = null;
    this.node.port.onmessage = null; this.node.port.close();
  }
}
