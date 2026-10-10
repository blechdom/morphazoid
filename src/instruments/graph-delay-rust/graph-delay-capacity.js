const BLOCK = 128;
export const GRAPH_CAPACITY_TARGET_LOAD = .45;

/** Runs only in a disposable renderer. All prepared, eligible candidate routes
 * are admitted, regardless of the playing graph's live ceiling. Synthetic full
 * history prevents long delays and pitch lookbacks from timing cold reads. */
export function measureGraphDelayCapacity(module, sourcePlan, sampleRate = 48000, { now = () => performance.now() } = {}) {
  const api = new WebAssembly.Instance(module, {}).exports;
  const plan = sourcePlan instanceof Float64Array ? sourcePlan.slice() : new Float64Array(sourcePlan).slice();
  const started = now(), measurements = [], pointers = [];
  const renderer = api.gdr_new_calibration(sampleRate);
  if (!renderer) throw new Error('The graph capacity probe could not allocate audio state.');
  let control = 0;
  try {
    for (let index = 0; index < 4; index++) {
      const pointer = api.gdr_alloc(BLOCK * 4);
      if (!pointer) throw new Error('The graph capacity probe could not allocate audio buffers.');
      pointers.push(pointer);
    }
    const routeStart = 16 + plan[1] * 2 + plan[2] * 6 + plan[3] * 3;
    for (let index = 0; index < plan[4]; index++) {
      const at = routeStart + index * 4 + 2;
      if (Math.abs(plan[at]) < 1.2) plan[at] = [7, -5, 11, -12][index % 4];
    }
    control = api.gdr_alloc(plan.byteLength);
    if (!control) throw new Error('The graph capacity probe could not allocate its plan.');
    new Float64Array(api.memory.buffer, control, plan.length).set(plan);
    if (!api.gdr_plan(renderer, control, plan.length) || !api.gdr_performance(renderer, 0, 0)) {
      throw new Error('The candidate graph exceeds this device’s prepared memory or route limits.');
    }
    let steps = 0;
    while (!api.gdr_prepare(renderer, 65536)) if (++steps > 16384) throw new Error('The capacity probe could not prepare its graph.');
    if (!api.gdr_prepare_calibration_history(renderer)) throw new Error('The graph capacity probe could not warm its complete history.');
    api.gdr_enabled(renderer, 1);
    for (const pointer of pointers.slice(0, 2)) {
      const input = new Float32Array(api.memory.buffer, pointer, BLOCK);
      for (let index = 0; index < BLOCK; index++) input[index] = .08 * Math.sin(index * .13);
    }
    const process = count => { for (let block = 0; block < count; block++) {
      if (!api.gdr_process(renderer, ...pointers, BLOCK)) throw new Error('The graph capacity probe could not render.');
    } };
    process(64);
    const metrics = new Float64Array(api.memory.buffer, api.gdr_metrics(renderer), api.gdr_metrics_len());
    const voices = metrics[13], preparedRoutes = metrics[5];
    if (metrics[9] !== voices || metrics[11] !== voices || metrics[10] !== 0) throw new Error('The graph capacity probe did not admit every eligible route.');
    for (let trial = 0; trial < 3; trial++) {
      let blocks = 0, elapsed = 0; const at = now();
      do { process(16); blocks += 16; elapsed = now() - at; } while (elapsed < 8 && blocks < 4096);
      measurements.push({ voices, blocks, load: elapsed / (blocks * BLOCK / sampleRate * 1000) });
    }
    const load = measurements.map(item => item.load).sort((a, b) => a - b)[1];
    return { voices, preparedRoutes, eligibleRoutes: voices, proved: voices > 0 && Number.isFinite(load) && load > 0 && load <= GRAPH_CAPACITY_TARGET_LOAD,
      load, measuredLoad: load, targetLoad: GRAPH_CAPACITY_TARGET_LOAD, sampleRate, measurements,
      elapsedMs: Math.max(0, now() - started), pitchedStress: true };
  } finally {
    api.gdr_drop(renderer);
    if (control) api.gdr_free(control, plan.byteLength);
    for (const pointer of pointers) api.gdr_free(pointer, BLOCK * 4);
  }
}
