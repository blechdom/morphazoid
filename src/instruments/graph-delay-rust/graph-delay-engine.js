import { connectAudioOutput } from '../../audio-output-manager.js';
import { compileGraphDelayPlan } from './graph-delay-plan.js';

const MODULE_URL = new URL('../../../assets/wasm/graph-delay.wasm', import.meta.url);
const WORKLET_URL = new URL('./graph-delay-worklet.js', import.meta.url);
const modules = new WeakMap();
let compiledModule;
async function loadModule() {
  if (!compiledModule) compiledModule = (async () => {
    const response = await fetch(MODULE_URL);
    if (!response.ok) throw new Error(`The Rust graph audio module could not load (${response.status}).`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    if (WebAssembly.Module.imports(module).length) throw new Error('The Rust graph audio module has unsupported imports.');
    return module;
  })().catch(error => { compiledModule = null; throw error; });
  return compiledModule;
}

/** Owns DSP lifecycle only. The instrument owns capture permission and Audio. */
export class GraphDelayRustEngine {
  static async create(context, options = {}) {
    if (!context?.audioWorklet) throw new Error('Graph Delay Rust needs a browser with AudioWorklet support.');
    if (!modules.has(context)) modules.set(context, context.audioWorklet.addModule(WORKLET_URL).catch(error => { modules.delete(context); throw error; }));
    const [module] = await Promise.all([loadModule(), modules.get(context)]);
    let engine;
    try {
      engine = new GraphDelayRustEngine(context, module, options);
      await engine.ready; return engine;
    } catch (error) { await engine?.dispose(); throw error; }
  }
  constructor(context, module, { onError = () => {}, onMetrics = () => {} } = {}) {
    this.context = context; this.onError = onError; this.onMetrics = onMetrics;
    this.closed = false; this.sequence = 0; this.revision = 0; this.requests = new Map();
    this.input = null; this.releaseOutput = null; this.readyTimer = null; this.statusTimer = null;
    this.closeError = null;
    this.metrics = { nodes: 0, edges: 0, routes: 0, activeRoutes: 0, inputPeak: 0, outputPeak: 0,
      nodeLevels: [], edgeLevels: [], cpuLoad: 0, peakLoad: 0, deadlineMisses: 0, elapsedSeconds: 0 };
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // Direct constructor users may dispose before awaiting readiness. Retain the
    // rejected promise for callers without creating an unhandled rejection.
    this.ready.catch(() => {});
    try {
      this.input = new AudioWorkletNode(context, 'morphazoid-graph-delay-rust', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
        processorOptions: { module },
      });
      this.input.onprocessorerror = () => this.fail(new Error('The Rust graph audio thread stopped.'));
      this.input.port.onmessage = ({ data }) => {
        if (this.closed) return;
        if (data.type === 'ready') { clearTimeout(this.readyTimer); this.resolveReady(); }
        else if (data.type === 'failure') this.fail(new Error(data.error));
        else if (data.type === 'metrics') { this.metrics = data.metrics; this.onMetrics(this.metrics); }
        else {
          const request = this.requests.get(data.id); if (!request) return;
          this.requests.delete(data.id); clearTimeout(request.timer);
          if (data.error) request.reject(new Error(data.error)); else request.resolve(data);
        }
      };
      this.releaseOutput = connectAudioOutput(context, this.input);
      this.readyTimer = setTimeout(() => this.fail(new Error('The Rust graph audio thread did not start.')), 15000);
      this.statusTimer = setInterval(() => this.send({ type: 'status' }), 100);
    } catch (error) { this.close(error); throw error; }
  }
  fail(error) {
    if (this.closed) return;
    this.close(error);
    this.onError(error);
  }
  send(message, transfer = []) {
    if (this.closed) return;
    try { this.input.port.postMessage(message, transfer); }
    catch (error) { this.fail(error); }
  }
  request(type, values, transfer = []) {
    if (this.closed) return Promise.reject(this.closeError);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      // A timed-out structural command must not commit later into a UI which
      // already rolled back. Retire the session and reject every pending edit.
      const timer = setTimeout(() => this.fail(new Error('The Rust graph audio thread did not respond.')), 30000);
      this.requests.set(id, { resolve, reject, timer });
      this.send({ id, type, ...values }, transfer);
    });
  }
  async update(graph, settings = {}, switches = null) {
    if (this.closed) throw this.closeError;
    const revision = ++this.revision, plan = compileGraphDelayPlan(graph, settings, switches);
    await this.ready;
    if (this.closed) throw this.closeError;
    if (revision !== this.revision) return { superseded: true };
    return this.request('configure', { plan: plan.data.buffer }, [plan.data.buffer]);
  }
  setOutputEnabled(enabled) { this.send({ type: 'enabled', enabled: Boolean(enabled) }); }
  clear() { this.send({ type: 'clear' }); }
  close(error) {
    if (this.closed) return;
    this.closed = true; this.closeError = error; this.revision++;
    clearInterval(this.statusTimer); clearTimeout(this.readyTimer);
    this.rejectReady(error);
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); }
    this.requests.clear();
    this.metrics = { ...this.metrics, inputPeak: 0, outputPeak: 0, activeRoutes: 0, nodeLevels: [], edgeLevels: [], preparing: false };
    if (this.input) {
      this.input.onprocessorerror = null; this.input.port.onmessage = null;
      try { this.input.port.postMessage({ type: 'dispose' }); } catch { /* Processor may already be gone. */ }
    }
    try { this.releaseOutput?.(); } catch { /* Continue releasing a closed context. */ }
    this.releaseOutput = null;
    try { this.input?.disconnect(); } catch { /* Context may already be closed. */ }
    try { this.input?.port.close(); } catch { /* Port may already be closed. */ }
  }
  async dispose() {
    this.close(new Error('The Rust graph session is closed.'));
  }
}
