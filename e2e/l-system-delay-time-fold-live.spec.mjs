import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ reducedMotion: 'no-preference' });

async function fixture(page, input) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(({ input }) => {
    const qa = window.__foldRuntime = { contexts: [], sources: [], controls: [], statuses: [], packets: [],
      inputs: [], screenInputs: [], draws: [], phase: 'setup', recording: false, drawViolations: 0, auditedDraws: 0, worklets: 0 };
    const NativeContext = AudioContext, NativeNode = AudioWorkletNode, NativeWorker = Worker;
    const controls = new Map();
    const record = (kind, data) => {
      const row = { kind, type: data.type ?? 'compile', id: data.id, at: performance.now(), phase: qa.phase,
        foldMs: data.parameters?.intervalMs, budget: data.voiceBudget };
      qa.controls.push(row); controls.set(`${kind}:${data.id}`, row);
    };
    window.Worker = new Proxy(NativeWorker, { construct(Target, args) {
      const worker = new Target(...args);
      if (String(args[0]).includes('/native/topology-worker.js')) {
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (data, ...rest) => { record('worker', data); return post(data, ...rest); };
        worker.addEventListener('message', ({ data }) => {
          const row = controls.get(`worker:${data.id}`);
          if (row) { row.ackAt = performance.now(); row.skipped = data.skipped; }
        });
      }
      return worker;
    } });
    window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); qa.contexts.push(this); } };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...rest) {
      const result = connect.call(this, destination, ...rest);
      if (destination === qa.audioNode) {
        qa.inputNode = this;
        void qa.probeReady.then(() => connect.call(this, qa.probe, 0, 1));
      }
      return result;
    };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'morphazoid-l-system-delay') return;
        qa.audioNode = this; qa.worklets++;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (data, ...rest) => {
          if (data.type !== 'status') record('audio', data);
          return post(data, ...rest);
        };
        this.port.addEventListener('message', ({ data }) => {
          const row = controls.get(`audio:${data.id}`); if (row) row.ackAt = performance.now();
          if (!qa.recording || !data.status) return;
          const s = data.status;
          qa.statuses.push({ at: performance.now(), phase: qa.phase, contextClock: this.context.currentTime,
            clock: s.elapsedSeconds, blocks: s.processedBlocks, cpu: s.cpuLoad, peakLoad: s.peakLoad,
            deadlines: s.deadlineMisses, underruns: s.underruns, overruns: s.overruns,
            active: s.activeVoices, target: s.targetVoices, limit: s.voiceLimit, capacity: s.installedCapacity,
            inputPeak: s.inputPeak, outputPeak: s.outputPeak, wetBusGain: s.wetBusGain,
            appliedFoldMs: s.timeFoldMs ?? null,
            topologyRevision: s.topologyRevision, activeVoiceIndices: Array.from(s.activeVoiceIndices ?? []) });
        });
        qa.probeReady = (async () => {
          const script = `registerProcessor('fold-pcm-witness', class extends AudioWorkletProcessor {
            constructor() {
              super(); this.capacity = Math.ceil(sampleRate * .05 / 128) * 128; this.reset();
              this.port.onmessage = ({ data }) => {
                if (data === 'reset') { this.reset(); this.port.postMessage({ reset: true }); }
                if (data === 'flush') this.port.postMessage({ flushed: true, rate: sampleRate,
                  totalFrames: this.totalFrames, quanta: this.quanta, discontinuities: this.discontinuities,
                  partialFrames: this.frames, endFrame: currentFrame, longestZeroRun: this.longestZeroRun,
                  longestLowRun: this.longestLowRun, longestInputLowRun: this.longestInputLowRun,
                  nonFinite: this.totalNonFinite, raw: this.raw.slice(0, this.frames * 3) });
              };
            }
            reset() {
              this.raw = new Float32Array(this.capacity * 3); this.frames = this.energy = this.inputEnergy = this.peak = 0;
              this.totalFrames = this.quanta = this.sequence = this.discontinuities = this.totalNonFinite = 0;
              this.zeroRun = this.lowRun = this.inputLowRun = this.longestZeroRun = this.longestLowRun = this.longestInputLowRun = 0;
              this.previousEnd = undefined;
            }
            process(inputs, outputs) {
              for (const output of outputs) for (const channel of output) channel.fill(0);
              const count = outputs[0][0].length, wet = inputs[0] || [], source = inputs[1] || [];
              if (this.previousEnd !== undefined && this.previousEnd !== currentFrame) this.discontinuities++;
              this.previousEnd = currentFrame + count; this.quanta++;
              for (let i = 0; i < count; i++) {
                const l = wet[0]?.[i] ?? 0, r = wet[1]?.[i] ?? l, original = source[0]?.[i] ?? 0;
                const finite = Number.isFinite(l) && Number.isFinite(r) && Number.isFinite(original);
                this.totalNonFinite += Number(!finite);
                const peak = finite ? Math.max(Math.abs(l), Math.abs(r)) : Infinity;
                this.peak = Math.max(this.peak, peak); this.energy += (l*l+r*r)*.5; this.inputEnergy += original*original;
                this.zeroRun = peak === 0 ? this.zeroRun+1 : 0; this.lowRun = peak < 1e-7 ? this.lowRun+1 : 0;
                this.inputLowRun = Math.abs(original) < 1e-7 ? this.inputLowRun+1 : 0;
                this.longestZeroRun = Math.max(this.longestZeroRun, this.zeroRun);
                this.longestLowRun = Math.max(this.longestLowRun, this.lowRun);
                this.longestInputLowRun = Math.max(this.longestInputLowRun, this.inputLowRun);
                const at = this.frames*3; this.raw[at]=l; this.raw[at+1]=r; this.raw[at+2]=original;
                this.frames++; this.totalFrames++;
                if (this.frames === this.capacity) {
                  this.port.postMessage({ sequence: this.sequence++, frames: this.frames, endFrame: currentFrame+i+1,
                    totalFrames: this.totalFrames, rate: sampleRate, peak: this.peak, rms: Math.sqrt(this.energy/this.frames),
                    inputRms: Math.sqrt(this.inputEnergy/this.frames), nonFinite: this.totalNonFinite,
                    longestZeroRun: this.longestZeroRun, longestLowRun: this.longestLowRun,
                    longestInputLowRun: this.longestInputLowRun, raw: this.raw }, [this.raw.buffer]);
                  this.raw = new Float32Array(this.capacity*3); this.frames = this.energy = this.inputEnergy = this.peak = 0;
                }
              }
              return true;
            }
          });`;
          const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
          try { await this.context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          const probe = qa.probe = new NativeNode(this.context, 'fold-pcm-witness', { numberOfInputs: 2, outputChannelCount: [1] });
          probe.port.onmessage = ({ data }) => {
            if (data.reset) { qa.resetAck?.(); return; }
            if (data.flushed) { qa.flushAck?.(data); return; }
            if (qa.recording) qa.packets.push({ ...data, receivedAt: performance.now(), phase: qa.phase });
          };
          connect.call(this, probe, 0, 0); connect.call(probe, this.context.destination);
        })();
      }
    };
    const create = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const node = create.apply(this, args), row = { starts: 0, stops: 0 };
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...args) => { row.starts++; return start(...args); };
      node.stop = (...args) => { row.stops++; return stop(...args); };
      qa.sources.push(row); return node;
    };
    if (input === 'broadband') navigator.mediaDevices.getUserMedia = async () => {
      const context = new NativeContext(), destination = context.createMediaStreamDestination();
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), data = buffer.getChannelData(0);
      let seed = 0x5eed1234;
      for (let i=0; i<data.length; i++) { seed = (Math.imul(seed,1664525)+1013904223)>>>0; data[i] = (seed/2147483648-1)*.03; }
      const node = context.createBufferSource(); node.buffer = buffer; node.loop = true; node.connect(destination); node.start();
      await context.resume();
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track); track.stop = () => { stop(); node.stop(); void context.close(); };
      }
      return destination.stream;
    };
  }, { input });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = 'visualCostMs += (cost - visualCostMs) * .15;';
    expect(source.split(marker).length - 1).toBe(1);
    await route.fulfill({ response, body: source.replace(marker, marker + ' captureFoldDraw(branches, now);') + `
function captureFoldDraw(branches, now) {
  const qa = __foldRuntime; if (!qa.recording) return;
  const indices = Array.from(state.status.activeVoiceIndices ?? []), active = new Set(indices);
  const coherent = state.status.topologyRevision === visualRevision;
  const expected = geometry.nodes.filter(n => n.generation === 0 || state.audio && previewParameters.depth > 0 && coherent && active.has(n.voiceIndex));
  const actualIds = branches.map(n => n.id), expectedIds = expected.map(n => n.id), actual = new Set(actualIds), wanted = new Set(expectedIds);
  const row = { at: now, phase: qa.phase, actualIds, expectedIds, activeVoiceIndices: indices,
    active: state.status.activeVoices, requestedFold: state.parameters.intervalMs, installedFold: previewParameters.intervalMs,
    engineFold: browserEngine.getDiagnostics().parameters.intervalMs,
    coherent, revision: visualRevision, statusRevision: state.status.topologyRevision,
    gpu: gpuRenderer?.available ? gpuRenderer.stats : null };
  const wrong = actual.size !== actualIds.length || indices.length !== state.status.activeVoices || active.size !== indices.length
    || actualIds.some(id => !wanted.has(id)) || expectedIds.some(id => !actual.has(id));
  qa.auditedDraws++; qa.drawViolations += Number(wrong); if (wrong && !qa.firstDrawViolation) qa.firstDrawViolation = row;
  qa.draws.push(row);
}
window.__foldQa = { engine: browserEngine, applyScene, slider: sliderFromTimeFold,
  scene: () => captureScene(state.parameters, state.performance),
  pendingFold: () => (typeof foldWorking !== 'undefined' && foldWorking) || (typeof foldDirty !== 'undefined' && foldDirty)
    || (typeof foldTimer !== 'undefined' && foldTimer) || (typeof foldRequest !== 'undefined' && foldRequest),
  requested: () => structuredClone(state.parameters), gpu: () => gpuRenderer?.stats ?? null };
$('interval').addEventListener('input', () => __foldRuntime.inputs.push({ at: performance.now(),
  phase: __foldRuntime.phase, foldMs: state.parameters.intervalMs, contextClock: __foldRuntime.contexts.at(-1)?.currentTime }));
$('stage').addEventListener('pointermove', event => {
  if (__foldRuntime.recording && event.buttons === 1) __foldRuntime.screenInputs.push({ at: performance.now(),
    phase: __foldRuntime.phase, x: event.clientX, y: event.clientY,
    foldMs: state.parameters.intervalMs, angle: state.parameters.angle });
});
` });
  });
  return errors;
}

const diagnostics = page => page.evaluate(() => __foldQa.engine.getDiagnostics());
const session = page => page.evaluate(() => ({ clock: __foldQa.engine.getSampleTime(),
  contextClock: __foldRuntime.contexts.at(-1)?.currentTime, contextState: __foldRuntime.contexts.at(-1)?.state,
  contexts: __foldRuntime.contexts.length, worklets: __foldRuntime.worklets, sources: structuredClone(__foldRuntime.sources) }));
async function settled(page) {
  await expect.poll(() => page.evaluate(() => {
    const d = __foldQa.engine.getDiagnostics();
    return JSON.stringify(d.parameters) === JSON.stringify(__foldQa.requested())
      && !__foldQa.pendingFold() && !d.compilePending && !d.installPending && !d.capacityWorking;
  }), { timeout: 15000 }).toBe(true);
}
async function native(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function sweep(page) {
  const dial = page.locator('#interval');
  await dial.evaluate(node => { for(let p=node.parentElement; p; p=p.parentElement) if(p.tagName==='DETAILS') p.open=true; });
  await dial.scrollIntoViewIfNeeded(); const box = await dial.boundingBox();
  const x = box.x + box.width/2; let y = box.y + box.height/2;
  expect(await dial.evaluate((node,{x,y}) => document.elementFromPoint(x,y)===node,{x,y})).toBe(true);
  await page.mouse.move(x,y); await page.mouse.down();
  const targets = [3000, .05, 240, 20, 26, 20, 3000, .05, 240];
  try {
    for(const foldMs of targets) {
      await page.evaluate(foldMs => { __foldRuntime.phase = 'sweep-'+foldMs; },foldMs);
      const start = Number(await dial.inputValue()), target = await page.evaluate(ms => __foldQa.slider(ms),foldMs);
      const nextY = y-(target-start)*120/1000;
      for(let step=1; step<=16; step++) { await page.mouse.move(x,y+(nextY-y)*step/16); await page.waitForTimeout(16); }
      y=nextY;
    }
  } finally { await page.mouse.up(); }
  await page.evaluate(() => { __foldRuntime.phase='recovery'; }); await settled(page);
  expect((await diagnostics(page)).parameters.intervalMs).toBeCloseTo(240,6);
}

async function screenSweep(page) {
  const canvas = page.locator('#stage');
  await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  expect(await canvas.evaluate((node, point) => document.elementFromPoint(point.x, point.y) === node, { x, y })).toBe(true);
  const initial = await page.evaluate(() => __foldQa.requested());
  await page.evaluate(() => { __foldRuntime.phase = 'screen-sweep'; });
  await page.mouse.move(x, y); await page.mouse.down();
  try {
    for (let step = 1; step <= 12; step++) { await page.mouse.move(x + box.width * .12 * step / 12, y); await page.waitForTimeout(16); }
    const stretched = await page.evaluate(() => __foldQa.requested());
    expect(stretched.intervalMs).toBeGreaterThan(initial.intervalMs * 1.5); expect(stretched.angle).toBe(initial.angle);
    for (let step = 11; step >= 0; step--) { await page.mouse.move(x + box.width * .12 * step / 12, y); await page.waitForTimeout(16); }
  } finally { await page.mouse.up(); }
  await settled(page);
  const final = await page.evaluate(() => __foldQa.requested());
  expect(final.intervalMs).toBeCloseTo(initial.intervalMs, 6); expect(final.angle).toBe(initial.angle);
  await page.evaluate(() => { __foldRuntime.phase = 'recovery'; });
}

function wav(raw, channels, rate) {
  const frames = raw.length/3, bytes = Buffer.alloc(44+frames*channels*2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(channels,22);
  bytes.writeUInt32LE(rate,24); bytes.writeUInt32LE(rate*channels*2,28); bytes.writeUInt16LE(channels*2,32);
  bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(bytes.length-44,40);
  for(let frame=0;frame<frames;frame++) for(let c=0;c<channels;c++) {
    const value=raw[frame*3+(channels===1?2:c)]; bytes.writeInt16LE(Math.round(Math.max(-1,Math.min(1,value))*32767),44+(frame*channels+c)*2);
  }
  return bytes;
}

for(const input of ['broadband','speech']) test(`dense sustained Time fold keeps continuous ${input} and uses timing updates without reinstalls`, async ({page},info) => {
  test.setTimeout(120000);
  const errors = await fixture(page,input); await page.goto('/l-mic-rust.html?renderer=webgl2');
  await expect(page.locator('#audioButton')).toBeEnabled({timeout:30000});
  await page.evaluate(async () => {
    const scene=__foldQa.scene(), {lab,...classic}=scene.parameters;
    await __foldQa.applyScene({...scene,parameters:{...classic,lSystemType:'pythagorean',generations:52,
      intervalMs:240,timeRatio:.72,depth:.85},performance:{...scene.performance,wet:.65,dry:0}});
  });
  if(input==='speech') { await native(page,'source','samples'); await native(page,'inputSample','speech-curling'); }
  await native(page,'inputTrim',.7); await native(page,'level',.6);
  await page.locator('#audioButton').click(); await page.evaluate(() => __foldRuntime.probeReady);
  // The maximum 3s fold has <10.72s cumulative lineage delay at .72 ratio.
  // Warm genuine history first so a new read into unrecorded time is excluded.
  await page.waitForTimeout(12000); await settled(page);
  const before=await session(page), initial=await diagnostics(page);
  expect(initial.performance.automatic).toBe(true); expect(initial.performance.voiceCeiling).toBe(0);
  expect(initial.requestedVoices).toBeGreaterThan(initial.preparedVoices); expect(initial.status.activeVoices).toBeGreaterThan(1);
  await page.evaluate(async () => {
    const qa=__foldRuntime; await new Promise(resolve => { qa.resetAck=resolve; qa.probe.port.postMessage('reset'); });
    qa.packets=[]; qa.statuses=[]; qa.draws=[]; qa.screenInputs=[]; qa.drawViolations=qa.auditedDraws=0; qa.firstDrawViolation=null;
    qa.controlStart=qa.controls.length; qa.inputStart=qa.inputs.length; qa.phase='baseline'; qa.recording=true;
    qa.start={wall:performance.now(),contextClock:qa.contexts.at(-1).currentTime};
  });
  let captured;
  try { await page.waitForTimeout(2000); await sweep(page); await screenSweep(page); await page.waitForTimeout(2000); }
  finally {
    captured=await page.evaluate(async () => {
      const qa=__foldRuntime;
      const flush=await new Promise(resolve => { qa.flushAck=resolve; qa.probe.port.postMessage('flush'); }); qa.recording=false;
      qa.flush=flush;
      return {start:qa.start,flush:{...flush,raw:undefined},end:{wall:performance.now(),contextClock:qa.contexts.at(-1).currentTime,
        sampleClock:__foldQa.engine.getSampleTime(),state:qa.contexts.at(-1).state},
        packets:qa.packets.map(({raw,...packet})=>packet),statuses:qa.statuses,draws:qa.draws,controls:qa.controls.slice(qa.controlStart),
        inputs:qa.inputs.slice(qa.inputStart),screenInputs:qa.screenInputs,
        auditedDraws:qa.auditedDraws,drawViolations:qa.drawViolations,firstDrawViolation:qa.firstDrawViolation,
        final:__foldQa.engine.getDiagnostics()};
    });
    // Counters cover every sample. Keep six seconds of raw, audible material
    // separately so evidence serialization does not dominate this short check.
    const raw=await page.evaluate(() => {
      const values=[], limit=__foldRuntime.flush.rate*6*3;
      for(const p of __foldRuntime.packets) for(const v of p.raw) { if(values.length===limit) return values; values.push(v); }
      for(const v of __foldRuntime.flush.raw) { if(values.length===limit) return values; values.push(v); } return values;
    });
    for(const channels of [2,1]) {
      const path=info.outputPath(channels===2?'wet-output.wav':'source-input.wav'); await writeFile(path,wav(raw,channels,captured.flush.rate));
      await info.attach(channels===2?'wet-output':'source-input',{path,contentType:'audio/wav'});
    }
    const path=info.outputPath('time-fold-evidence.json'); await writeFile(path,JSON.stringify({input,before,initial,...captured,
      rawWitness:{startSeconds:0,frames:raw.length/3,rate:captured.flush.rate},
      humanListening:false,physicalDeliveryChecked:false,forcedCapacity:false}));
    await info.attach('time-fold-evidence',{path,contentType:'application/json'});
  }
  const after=await session(page), {flush,packets}=captured;
  expect(after.contexts).toBe(before.contexts); expect(after.worklets).toBe(before.worklets); expect(after.sources).toEqual(before.sources);
  expect(after.contextState).toBe('running'); expect(after.clock).toBeGreaterThan(before.clock);
  expect(flush.discontinuities).toBe(0); expect(flush.nonFinite).toBe(0); expect(flush.quanta*128).toBe(flush.totalFrames);
  expect(flush.totalFrames/flush.rate).toBeGreaterThan((captured.end.wall-captured.start.wall)/1000*.8);
  expect(packets.length).toBeGreaterThan(20);
  for(let i=0;i<packets.length;i++) {
    expect(packets[i].nonFinite).toBe(0); expect(packets[i].peak).toBeLessThanOrEqual(1);
    if(i) { expect(packets[i].sequence).toBe(packets[i-1].sequence+1); expect(packets[i].endFrame).toBe(packets[i-1].endFrame+packets[i].frames); }
  }
  if(input==='broadband') { expect(flush.longestZeroRun/flush.rate).toBeLessThan(.04); expect(flush.longestLowRun/flush.rate).toBeLessThan(.04); }
  // Speech has phoneme pauses and the real loader's .35s release rest; those
  // amplitude changes are characterized with source PCM, never called gaps.
  expect(packets.some(p=>p.inputRms>1e-5)).toBe(true); expect(packets.some(p=>p.rms>1e-5)).toBe(true);
  expect(captured.auditedDraws).toBeGreaterThan(0); expect(captured.drawViolations,JSON.stringify(captured.firstDrawViolation)).toBe(0);
  expect(captured.final.eligibleVoices).toBe(initial.eligibleVoices);
  const {intervalMs:initialFold,...initialRest}=initial.parameters, {intervalMs:finalFold,...finalRest}=captured.final.parameters;
  expect(finalRest).toEqual(initialRest); expect(finalFold).toBeCloseTo(initialFold,6);
  expect(captured.draws.some(row=>row.engineFold<1),'sub-ms targets must reach the audio engine').toBe(true);
  expect(captured.draws.some(row=>row.engineFold>1000),'long targets must reach the audio engine').toBe(true);
  expect(captured.screenInputs.length).toBe(24);
  expect(new Set(captured.screenInputs.map(row=>row.y)).size,'screen sweep remains purely horizontal').toBe(1);
  await page.locator('#audioButton').click(); await expect.poll(async()=>(await diagnostics(page)).audio).toBe(false);
  await page.locator('#audioButton').click(); await expect.poll(async()=>(await diagnostics(page)).audio).toBe(true);
  const restarted=await session(page); expect(restarted.contexts).toBe(before.contexts); expect(restarted.worklets).toBe(before.worklets);
  await page.locator('#audioButton').click(); expect(errors).toEqual([]);
  // Desired fast path: timing-only gestures preserve the prepared tree.
  expect(captured.controls.filter(c=>c.kind==='worker').length,'Time fold must not compile topology when eligibility is unchanged').toBe(0);
  expect(captured.controls.filter(c=>c.type==='install').length,'Time fold must not reinstall a same-eligibility tree').toBe(0);
  expect(captured.draws.at(-1).gpu?.topologyUploads).toBe(captured.draws[0].gpu?.topologyUploads);
  for(let i=1;i<captured.draws.length;i++) {
    const previous=captured.draws[i-1], next=captured.draws[i];
    if(previous.coherent && next.coherent && JSON.stringify(previous.actualIds)===JSON.stringify(next.actualIds)) {
      expect(next.gpu?.selectionUploads).toBe(previous.gpu?.selectionUploads);
    }
  }
});
