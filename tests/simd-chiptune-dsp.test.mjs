import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ChiptuneTempoClock, TEMPO_CLOCK_CAPACITY, TEMPO_CLOCK_FIELDS } from '../src/instruments/simd-chiptune/tempo-clock.js';
import {
  WEBGPU_CHIPTUNE_PARAM_ORDER as ORDER,
  WEBGPU_CHIPTUNE_DEFAULTS as DEFAULTS,
  WEBGPU_CHIPTUNE_LIMITS as LIMITS,
  WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE as SONG,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES as LANES,
  createWebGpuChiptunePattern,
  sanitizeWebGpuChiptuneSequence,
  sanitizeWebGpuChiptuneParams,
  packWebGpuChiptuneSequence,
  webGpuChiptuneParamArray,
  webGpuChiptunePatternGate,
} from '../src/instruments/webgpu-chiptune/webgpu-chiptune.js';

const binaries = Object.fromEntries(await Promise.all(['scalar','simd'].map(async type => [type, await readFile(new URL(`../assets/wasm/simd-chiptune-${type}.wasm`, import.meta.url))])));
const modules = Object.fromEntries(Object.entries(binaries).map(([key, bytes]) => [key, new WebAssembly.Module(bytes)]));
function kernel(type='simd', params=DEFAULTS, sequence=SONG, transitions=new Map()) {
  const exports = new WebAssembly.Instance(modules[type]).exports;
  exports.reset();
  const values=webGpuChiptuneParamArray(params), packed=packWebGpuChiptuneSequence(sequence, 4, transitions);
  new Float32Array(exports.memory.buffer,exports.params_ptr(),154).set(values);
  new Uint8Array(exports.memory.buffer,exports.sequence_meta_ptr(),192).set(new Uint8Array(packed.meta.buffer));
  new Uint8Array(exports.memory.buffer,exports.sequence_cells_ptr(),9216).set(new Uint8Array(packed.cells));
  return {
    exports,
    left:new Float32Array(exports.memory.buffer,exports.output_left_ptr(),128),
    right:new Float32Array(exports.memory.buffer,exports.output_right_ptr(),128),
    preview:new Float32Array(exports.memory.buffer,exports.time_info_ptr(),4),
  };
}
function render(engine, offset=10, frames=4096, rate=48000, exactChunkTime=false) {
  const output=new Float32Array(frames*2);
  const block=exactChunkTime?1:128;
  for(let index=0;index<frames;index+=block) {
    const count=Math.min(block,frames-index);
    engine.exports.process(count,rate,Math.fround(Math.fround(offset)+Math.fround(index/rate)));
    for(let i=0;i<count;i++) { output[(index+i)*2]=engine.left[i]; output[(index+i)*2+1]=engine.right[i]; }
  }
  return output;
}
const rms=values=>Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length);
const difference=(a,b)=>Math.sqrt(a.reduce((sum,x,i)=>sum+(x-b[i])**2,0)/a.length);
function bounded(values) { for(const x of values) assert.ok(Number.isFinite(x)&&Math.abs(x)<=.880001, `Invalid sample ${x}`); }
function isolated(overrides={}) {
  return {...DEFAULTS,upperOneLevel:0,upperTwoLevel:0,bassPulseLevel:0,bassSineLevel:0,leadLevel:0,arpLevel:0,noiseLevel:0,drumMix:0,echoTaps:1,...overrides};
}
function notePattern(lane='upperOne', value=0, velocity=1) {
  const sequence=structuredClone(createWebGpuChiptunePattern(DEFAULTS));
  for(const key of LANES) {
    sequence.lanes[key].activeLength=1;
    sequence.lanes[key].stepBeats=.25;
    sequence.lanes[key].cells=Array.from({length:32},()=>({state:key===lane?'note':'rest',value,velocity}));
  }
  return sanitizeWebGpuChiptuneSequence(sequence);
}

test('kernels match the complete source ABI and contain real SIMD oscillator arithmetic', async () => {
  assert.equal(ORDER.length,154);
  const source=await readFile(new URL('../src/simd-chiptune-kernel.ts',import.meta.url),'utf8');
  const fields=[...source.match(/export class AudioParam \{([\s\S]*?)\n\}/)[1].matchAll(/(\w+): f32;/g)].map(match=>match[1]);
  assert.deepEqual(fields,ORDER);
  const completeSource=source+await readFile(new URL('../src/simd-chiptune-scalar.ts',import.meta.url),'utf8');
  for(const field of ORDER) assert.ok(completeSource.includes(`.${field}`), `${field} must reach the source engine`);
  for(const type of ['scalar','simd']) {
    assert.deepEqual(WebAssembly.Module.imports(modules[type]),[]);
    const engine=kernel(type);
    assert.equal(engine.exports.param_count(),154);
    assert.equal(engine.exports.lane_width(),type==='simd'?4:1);
    assert.equal(engine.exports.block_size(),128);
    assert.throws(()=>engine.exports.memory.grow(1));
  }
  const binaryen=(await import('binaryen')).default;
  for(const type of ['scalar','simd']) {
    const binary=binaryen.readBinary(binaries[type]);
    try { if(type==='simd') assert.match(binary.emitText(),/f32x4\.mul/); else assert.doesNotMatch(binary.emitText(),/f32x4\./); }
    finally { binary.dispose(); }
  }
});

test('packed source gates agree with the original browser reference through all four code segments', () => {
  const params={...DEFAULTS,gatePatternSteps:32,gateA0:21845,gateA1:43690,gateA2:65535,gateA3:13107,gateB0:65535,gateB1:0,gateB2:43690,gateB3:21845,gatePatternPhase:.125};
  const engine=kernel('simd',params);
  for(const lane of [0,1]) for(let i=-64;i<128;i++) {
    const time=i*.317+0.013;
    const actual=engine.exports.test_pattern_gate(time,params.gateLength,lane);
    const expected=webGpuChiptunePatternGate(Math.fround(time),params.gateLength,params,Boolean(lane));
    assert.ok(Math.abs(actual-expected)<.00004, `${lane}/${time}: ${actual} versus ${expected}`);
  }
});

test('scalar and SIMD preserve complete Song and Pattern audio at several rates and offsets', () => {
  for(const rate of [44100,48000,96000]) for(const sequence of [SONG,createWebGpuChiptunePattern(DEFAULTS)]) {
    for(const offset of [0,2.137,10,38.625]) {
      const a=render(kernel('scalar',DEFAULTS,sequence),offset,1024,rate);
      const b=render(kernel('simd',DEFAULTS,sequence),offset,1024,rate);
      bounded(a);bounded(b);
      assert.ok(difference(a,b)<1e-7);
    }
  }
  assert.ok(rms(render(kernel(),10))>.01);
});

test('independent lane lengths, note/rest state and velocity reach original packed cell semantics', () => {
  const params=isolated({upperOneLevel:1});
  const quiet=render(kernel('simd',params,notePattern('upperOne',0,.2)),4.03,2048);
  const loud=render(kernel('simd',params,notePattern('upperOne',0,.8)),4.03,2048);
  assert.ok(Math.abs(rms(loud)/rms(quiet)-4)<.001);
  const rests=structuredClone(notePattern());rests.lanes.upperOne.cells[0].state='rest';
  assert.equal(rms(render(kernel('simd',params,rests),4.03,2048)),0);
  const transitioned=kernel('simd',params,notePattern('upperOne',12),new Map([[0,{before:{state:'rest',value:0,velocity:1},applyAt:4.1}]]));
  assert.equal(rms(render(transitioned,4.03,1024)),0);
  assert.ok(rms(render(transitioned,4.12,1024))>.01);
});

test('analytic echo, original preview ducking and deterministic seeking remain active', () => {
  const params=isolated({upperOneLevel:1,leadSectionShare:0,gateA0:43690,gateA1:43690,gateA2:43690,gateA3:43690});
  const dry=render(kernel('simd',params),10,2048);
  const echoes=render(kernel('simd',{...params,echoTaps:8,echoTime:.137,echoDecay:.66,echoWet:1,echoCrossfeed:.7}),10,2048);
  assert.ok(difference(dry,echoes)>.01);
  const preview=kernel('simd',params);preview.preview.set([10,0,12,10]);
  assert.ok(difference(dry,render(preview,10,2048))>.01);
  const pattern=createWebGpuChiptunePattern(params);
  const patternPreview=kernel('simd',params,pattern);patternPreview.preview.set([10,0,12,10]);
  assert.deepEqual(render(patternPreview,10,2048),render(kernel('simd',params,pattern),10,2048));
  const engine=kernel();const before=render(engine,12.25,1024);
  render(engine,200,4096);engine.exports.reset();
  assert.deepEqual(render(engine,12.25,1024),before);
  assert.equal(rms(render(engine,0,1)),0);
});

test('all parameter extrema and eight negative-time analytic echoes stay finite and bounded', () => {
  const states=[Object.fromEntries(ORDER.map(k=>[k,LIMITS[k][0]])),Object.fromEntries(ORDER.map(k=>[k,LIMITS[k][1]]))];
  for(const rate of [8000,44100,192000]) for(const params of states) {
    const patch=sanitizeWebGpuChiptuneParams({...params,gain:1,echoTaps:8,echoTime:2});
    const values=render(kernel('simd',patch),.125,2048,rate);
    bounded(values);
  }
});

// Real original-WGSL samples captured from Google Chrome's SwiftShader WebGPU
// backend at 48 kHz, offset 10 s. These are independent GPU reference fixtures,
// not output generated by the kernels under test. Hash-noise snapshots are
// deliberately excluded: sin/floor/fract hash values differ by GPU math backend.
// Tonal comparisons allow only measured floating-point transcendental error.
const GPU_REFERENCES = [
  {
    "id": "upper-one-pattern",
    "mode": "pattern",
    "overrides": {
      "upperTwoLevel": 0,
      "bassPulseLevel": 0,
      "bassSineLevel": 0,
      "leadLevel": 0,
      "arpLevel": 0,
      "noiseLevel": 0,
      "drumMix": 0,
      "echoTaps": 1
    },
    "hit": null,
    "samples": "AAAAAAAAAADm5ru3UFKWtoO/wbid/5q3pW5WubiLK7ganLy5SOOWuL4lErr61em4S2tTuqIiKbnauY66jVxkuQyuuroKWJW5UkLsutoBvbnKsg+72urluay1LLvwKgq6l2RNu3pQJLrFtnC7OJJAuo+jiruA0l26itOeu0AffrrKuPa6oGDFue2qvTvyu5c6nUngOxhuszpqOvk77WHHOrqqCTxaRNw6z88WPIBM8ToJ+iQ8OvsDO5yoMjxK7Q47wN9BPGcZGzu/EFE8mkAnO5pOYTzgPjQ75XdxPLgsQTuvWIE8TfROO0wzijzgHl079qeSPFOmajsA9ps8mol5O6QopTyDIIQ7reauPL/rizvEgrg80JuTOz6rwjwwvJs7LE/MPIpyozvV2tY8ReKrOyA44TznLLQ7OiPsPProvDvCPPc8M8rFO4EPAT0zf847zscGPROm1zsZLgw9wEngO3cOEj3AsOk7q80XPa3i8jsW1B09h4b8O8jsIz3TIwM8WeApPa3mBzxrrC898IkMPAr2NT2ikRE8KE88PbqlFjxEfkI9N5gbPLrzSD36wiA83zxPPU3KJTzSkVU9DdsqPPLxWz3A9C88cJdiPfNFNTwftDY9sikSPJF1Kr0NXgi8k4h2vQ86RbyiF329TXlKvPTWgb1Tvk+8YSWFvZoIVbwklYi9OohavELpi72a21+8O16PvZNjZbxP1ZK95+5qvM8Qlr3nGnC884qZvSCrdbxq55y92gt7vE9joL1zT4C8y8CjvaMAg7wMPae9cMqFvPO4qr33k4i8tfatvcUri7w+UrG9Y9uNvBrLtL16opC8OkK4vS9ok7y/mLu9yxOWvGILv73n1Zi8nD7CvUplm7x7q8W9yCKevMz2yL1wxaC8c1zMvSp9o7zfvc+9gDGmvCL90r2Ayqi8O1XWvWJ3q7yPbdm9QPGtvCe73L26lbC87eXfvVges7xyJ+O9J7m1vOVF5r3rN7i88HnpvfPHurzQbuy9cyW9vEuU773Vqb+8s7HyvcInwryfq/W9TYnEvBq4+L2t+ca8AqH7vZpNybwym/69Wq/LvP6rAL763828ah8CvkAy0LwJgQO+DWjSvO/pBL6AqdS8Nk0Gvu3h1ry+nge++v3YvLLqCL4aEdu87DAKvhMb3byVfAu+ui3fvKO2DL46JOG8W/UNvi0i47w4LQ++JxXlvFuRsb3iDY68X+rsPU2IvTw2jBI+7XnqPKenEz5zP+w8/rEUPpPp7TwRvhU+gJbvPDu5Fj5gKPE8sqwXPuet8jxMmBg+4Cb0PNuDGT7Hn/U8omYaPpoK9zwWORs+U1v4PBMKHD66qfk8A8scPm3e+jwcgx0++gT8PA=="
  },
  {
    "id": "bass-pattern",
    "mode": "pattern",
    "overrides": {
      "upperOneLevel": 0,
      "upperTwoLevel": 0,
      "leadLevel": 0,
      "arpLevel": 0,
      "noiseLevel": 0,
      "drumMix": 0,
      "echoTaps": 1
    },
    "hit": null,
    "samples": "AAAAAAAAAACfSw44M6xjN1AiFDmzA204rYKlOYpoBDlx4RI6UAJrORLBZTqpzbc517inOngtBjrla+Q6t7w2Oru9FjuTL3E6W35AO7D+mTorI2w78Oi8OggpjztzDuU6M76rO/VkCTsbBss7SWsiO5Df6zvasjw7qkIIPEMEWjs9TRs8k3t4O8eQLzzTc4w7+zNFPDDDnTt97lw8yr6wOzgPdjz62MQ7fc6HPGBK2Tvzv5U8h5nvO89iozxytQI8b7GyPFr0DjzPMcI8DVsbPBrl0jxHtyg887/jPCozNjz91/U8yqxEPGNSBD0Dt1M8S2gNPXdAYjwAfRc9mmFyPEiYIT2gRoE81V0sParkiTxzJDc9kIOSPBOHQj1Cn5s8ioZNPaFrpDxPpVk92h2uPPi5ZT36x7c8r4RyPcADwjylpX89g4TMPOpZhj1D9tY8gT6NPZ394TxL05M9RYXsPOsImz1FDvg8Uy+iPXW/AT33tak9xcQHPfNksT1d6g09h/C4PaDzEz0fdMA9f/YZPeCEyD1NaiA9F8zQPa0JJz2f+dg9gJQtPaKK4T3pbjQ98/7pPV0yOz34gfI9kwFCPUI5+z2c+kg9eioCPvdDUD0vyQY+TahXPcdVCz6n7149shQQPoOHZj3/vxQ+AABuPWZuGT5wfXU9iSoePt0QfT1KJCM+boOCPYAHKD5nbIY9nxwtPkt9ij3fPjI+spiOPe8VNz7zd5I9S1A8PqOmlj16cEE+YcCaPZHBRj5CAZ89C/dLPggsoz3aXFE+e32nPVLMVj6p1qs9lehbPkPtrz1FQmE+AzW0Pb+7Zj4zlrg9lUtsPkMJvT0Iu3E+bWLBPf9Xdz4A4MU98pt8PlwWyj25IYE+XZzOPQTkgz5tBtM9+7uGPi2T1z2TlYk+gyLcPctcjD56lOA9tTiPPocn5T1r5ZE+EG/pPVXClD67A+49uIuXPid58j2FX5o+O//2PQUonT47c/s98wKgPlsCAD4PraI+DSQCPgiFpT5tagQ+61qoPiOvBj6GG6s+0uIIPkjsrT5tIws+S6ewPqNSDT57cbM+/Y0PPtMJtj51oRE+E8y4PnXWEz7Hd7s+bfkVPu8mvj4nHxg+J9rAPiBIGj5PdsM+p14cPgcDxj7TaB4+O5PIPsl1ID5vLcs+wIoiPvivzT7HjCQ+MjvQPsOVJj4yvtI+KZgoPi0p1T5Xhyo+9XLXPvdbLD6929k+Y0kuPqg63D7tLjA+QoHePgMBMj7VweA+Q84zPrXz4j7DjzU+IhHlPulANz4SLec+3PA4Po9J6T5AoTo+P1nrPmdHPD5yUO0+9tk9PqpF7z7uaj8+bSLxPlfoQD4r6PI+V1NCPg=="
  },
  {
    "id": "snare-tonal-song",
    "mode": "song",
    "overrides": {
      "upperOneLevel": 0,
      "upperTwoLevel": 0,
      "bassPulseLevel": 0,
      "bassSineLevel": 0,
      "leadLevel": 0,
      "arpLevel": 0,
      "noiseLevel": 0,
      "kickLevel": 0,
      "hatLevel": 0,
      "shakerLevel": 0,
      "ghostDrums": 0,
      "echoTaps": 1,
      "snareNoiseMix": 0,
      "synthMix": 0
    },
    "hit": null,
    "samples": "uzNBu7szQbvE7gG7xO4Bu9ccgLrXHIC6CkahtgpGobYfWn06H1p9Oi2i/Totov06zyZAO88mQDvnsX4757F+OydwnzsncJ87oB2/O6AdvztgJNw7YCTcOwvB+TsLwfk739YLPN/WCzwYfRo8GH0aPDk/KDw5Pyg8lQk2PJUJNjxj90I8Y/dCPN9oTzzfaE88PV1bPD1dWzylMGc8pTBnPDVscjw1bHI8UrB8PFKwfDzDW4M8w1uDPB+2hzwftoc8hhCMPIYQjDwY8Y88GPGPPMOWkzzDlpM8J8WWPCfFljx/sJk8f7CZPGE5nDxhOZw8xjyePMY8njxTBaA8UwWgPExeoTxMXqE81F+iPNRfojw/+KI8P/iiPLMyozyzMqM8NwWjPDcFozwQcqI8EHKiPBuEoTwbhKE8oCqgPKAqoDxlbZ48ZW2ePHpgnDx6YJw8R+OZPEfjmTwGOpc8BjqXPAcDlDwHA5Q8g5GQPIORkDxAp4w8QKeMPPBkiDzwZIg8zPiDPMz4gzxg1348YNd+PO98dDzvfHQ874dpPO+HaTxnZV48Z2VePCJgUjwiYFI800FGPNNBRjyitzk8orc5PJfJLDyXySw8jvQePI70HjyJwRA8icEQPFu9AjxbvQI86tHnO+rR5zuXrco7l63KO2AXrTtgF607ZyCPO2cgjzsYrl87GK5fOxaiIjsWoiI7umXGOrplxjoANg46ADYOOi9rvrkva765tdiuurXYrrojlhS7I5YUuyKJU7siiVO7JuKHuybih7u2s6a7trOmu9YbxbvWG8W7EgfhuxIH4bsDd/27A3f9u4cbDbyHGw28RScbvEUnG7yXXyi8l18ovDuiNbw7ojW8+5lBvPuZQbzn9U285/VNvGd1WbxndVm8ddBkvHXQZLwzoW+8M6FvvBiEebwYhHm8E5WBvBOVgbxYyYW8WMmFvCIAirwiAIq8ZsGNvGbBjbzwS5G88EuRvGNmlLxjZpS8FkGXvBZBl7yvmJm8r5iZvDzBm7w8wZu8sYqdvLGKnbwl6568JeuevH/6n7x/+p+8t6SgvLekoLzX96C81/egvAvqoLwL6qC8G3ugvBt7oLyHtZ+8h7WfvHaMnrx2jJ68WQSdvFkEnbw4MJu8ODCbvLMHmbyzB5m8eImWvHiJlrzfm5O835uTvE91kLxPdZC8/9yMvP/cjLyL8Ii8i/CIvHLahLxy2oS8H6SAvB+kgLwArHe8AKx3vF96bbxfem28OBhjvDgYY7yl3Ve8pd1XvGeLTLxni0y8AsxAvALMQLxapjS8WqY0vOmhJ7zpoSe8nT4avJ0+Gry2AA28tgANvBL3/bsS9/27uFviu7hb4rtTTsa7U07Guw=="
  },
  {
    "id": "arp-song",
    "mode": "song",
    "overrides": {
      "upperOneLevel": 0,
      "upperTwoLevel": 0,
      "bassPulseLevel": 0,
      "bassSineLevel": 0,
      "leadLevel": 0,
      "noiseLevel": 0,
      "kickLevel": 0,
      "snareLevel": 0,
      "hatLevel": 0,
      "shakerLevel": 0,
      "drumMix": 0,
      "ghostDrums": 0,
      "echoTaps": 1
    },
    "hit": null,
    "samples": "Fa4HPIoW2TvNzCw8cD0KPNijUDx66SY84np0PIKVQzwfhYs8ZTtfPHsUnjyQ7Xw8AACwPM3MjDyF68E80iKbPOJ61Dzo+6k8Z2bmPO1RuDwVrvc83yTGPM3MBD3getQ8exQOPfdT4zw/Chc9/anxPAAAID0AAAA9r0cpPYtsBz1xPTI9jpcOPUjhOj0HgRU9C9dDPQmsHD24Hk09kxgkPXsUVj2VQys9PwpfPZhuMj3rUWg9Its5PcP1cD2dxEA9het5PZ/vRz2jcIE9oBpPPXsUhj0qh1Y9XY+KPS2yXT0/Co89MN1kPRWukz29SWw9AACYPTMzcz3iepw9N156Pbu3iz1fjF89+6dKvfsfIr2amZ299yh8vbkemb31/XS9zcyUvXoUbr31KJC98KdmvRWui73wfF+9MzOHve1RWL1dj4K9YOVQvfcofL1gukm9MzNzvV2PQr1dj2q946U7va9HYb1YOTS961FYvVUOLb0qXE+9VeMlvXsURr3Idh69uR49vcdLF73iejS9T2IQvR+FK71MNwm9cT0ivcHKAb2vRxm9fT/1vO1REL166ea8PwoHvWMQ2LzNzPy8cD3KvEfh6rxs57u8w/XYvGqRrbxnZsa8U7ievOJ6tLxPYpC8XY+ivEoMgrwAAJC8Z2ZmvKVwfbyFwEq8mplZvHsULryPwjW8c2gRvNejELyLbOe7mpnZu3sUrruF65G713hpu5qZGbuQwvW6C9ejuG8Sg7hxPQo7Gy/dOs3MjDutR2E7PwrXOzIIrDspXA88QmDlOzMzMzwqXA88kMJVPA0CKzxH4Xo8ObRIPClcjzxCYGU8r0ehPCUGgTwL17M8PN+PPI/CxTw/NZ48PwrXPDIIrDzD9eg8N166PB+F+zxLN8k8U7gGPVKN1zwVrg89V+PlPMP1GD1rvPQ8heshPTiJAT1djyo9sHIIPR+FMz2znQ89zcw8PT0KFz2PwkU9PzUePVK4Tj1CYCU9AABYPc3MLD3Yo2A9R7YzPZqZaT1H4To9XY9yPUoMQj0L13s91XhJPWdmgj3ao1A9SOGGPdrOVz0fhYs9ZTtfPQvXjz3fJGY97VGUPeBPbT3NzJg94Hp0PaNwnT1t53s9DRxYPT3jLD3t0YK94E9RvcP1nL3SInu97VGYvUe2c70L15O9RYtsvSlcj71CYGW9U7iKvbjzXb1xPYa9tchWvY/Cgb2ynU+9R+F6vTm0SL2amXG9rkdBvdqjaL2uHDq9Fa5fvavxMr1nZla9IIUrvaVwTb0fWiS9zcxEvaNwHb0L1zu9o0UWvV2PMr0X2Q69mpkpvRWuB73XoyC9E4MAvSlcF70PLfK8Z2YOvQ3X47yPwgW9GATWvA=="
  },
  {
    "id": "kick-hit-pattern",
    "mode": "pattern",
    "overrides": {
      "upperOneLevel": 0,
      "upperTwoLevel": 0,
      "bassPulseLevel": 0,
      "bassSineLevel": 0,
      "leadLevel": 0,
      "arpLevel": 0,
      "noiseLevel": 0,
      "snareLevel": 0,
      "hatLevel": 0,
      "shakerLevel": 0,
      "ghostDrums": 0,
      "echoTaps": 1,
      "synthMix": 0
    },
    "hit": "kick",
    "samples": "L0u/PC9LvzzRwDs+0cA7PqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+DZVEPg2VRD6FL6M9hS+jPb3vBb697wW+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvi11Kr4tdSq+FXarPBV2qzwE0jg+BNI4PqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD76juw9+o7sPbyin728op+9iYtEvomLRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvv8iRL7/IkS+MRuwvTEbsL1Y1vA9WNbwPaebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD7aGkM+2hpDPod1lD2HdZQ95WIBvuViAb6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+lwFEvpcBRL6VEZ69lRGevc9k9T3PZPU9p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+d3zjPXd84z32EJ+99hCfveLfQr7i30K+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqGEIL6hhCC+hKw6PISsOjxTyi8+U8ovPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6Zc0I+mXNCPu+4lz3vuJc9ta/evbWv3r2nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL5VMSe+VTEnvrOd77mzne+5p90ePqfdHj6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6mxw0+pscNPgtfFr0LXxa9+3wzvvt8M76nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL68jwG+vI8Bvs+gSj3PoEo91UM3PtVDNz6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD4s8Qs+LPELPqvN1ryrzda846UrvuOlK76nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL6nm0S+p5tEvqebRL65nyq+uZ8qvmeiqrxnoqq8JzANPicwDT6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD6nm0Q+p5tEPqebRD5ziUI+c4lCPjPVvj0z1b49w6aUvcOmlL1bADy+WwA8vg=="
  },
  {
    "id": "snare-tonal-hit-pattern",
    "mode": "pattern",
    "overrides": {
      "upperOneLevel": 0,
      "upperTwoLevel": 0,
      "bassPulseLevel": 0,
      "bassSineLevel": 0,
      "leadLevel": 0,
      "arpLevel": 0,
      "noiseLevel": 0,
      "kickLevel": 0,
      "hatLevel": 0,
      "shakerLevel": 0,
      "ghostDrums": 0,
      "echoTaps": 1,
      "snareNoiseMix": 0,
      "synthMix": 0
    },
    "hit": "snare",
    "samples": "AAAAAAAAAAACTJE8AkyRPP+vEz3/rxM9Kr9bPSq/Wz1GnZE9Rp2RPfv4tD37+LQ9QxfZPUMX2T1AYvs9QGL7PQkaDz4JGg8+eRsgPnkbID7miC8+5ogvPiAUPz4gFD8+eqVOPnqlTj4foV0+H6FdPkCAaz5AgGs+UjZ5PlI2eT7144I+9eOCPjfUiD431Ig+6WeOPulnjj73yJM+98iTPr2+mD69vpg+lx+dPpcfnT5vOKE+bzihPvOfpD7zn6Q+5NSnPuTUpz5reqo+a3qqPkC/rD5Av6w+IHquPiB6rj7Vya8+1cmvPv+bsD7/m7A+4O6wPuDusD6mxLA+psSwPogisD6IIrA+P/+uPj//rj4jb60+I2+tPlFWqz5RVqs+jfOoPo3zqD7X7aU+1+2lPvyQoj78kKI+zqGePs6hnj6/P5o+vz+aPlCalT5QmpU+51+QPudfkD6zI4s+syOLPv8ihT7/IoU+ovd9PqL3fT4vhHA+L4RwPt9iYj7fYmI+5yJUPuciVD7g3UU+4N1FPrEANj6xADY+R6AlPkegJT4fXxU+H18VPsUfBD7FHwQ+5TzmPeU85j0PoMM9D6DDPV6AoD1egKA9ZV13PWVddz1cCS09XAktPUKfyTxCn8k8WN3NO1jdzTvVSTu81Uk7vHeA7rx3gO68Fl0/vRZdP71mwoS9ZsKEvQw0qL0MNKi9HHLMvRxyzL2LHPC9ixzwvRlbCL4ZWwi+s30ZvrN9Gb4VoCm+FaApvpHdOb6R3Tm+jwxJvo8MSb6LN1i+izdYvlPGZr5Txma+h75zvoe+c74oSIC+KEiAvnmQhr55kIa+hneMvoZ3jL4vypG+L8qRvvDllr7w5Za+kkWbvpJFm77Mi5++zIufvh8/o74fP6O+m6Cmvpugpr4viqm+L4qpvovmq76L5qu+dd+tvnXfrb71Ra++9UWvvp9OsL6fTrC+utewvrrXsL5R5rC+UeawvtN2sL7TdrC+0YivvtGIr74zO66+Mzuuvg9drL4PXay+xgOqvsYDqr6vS6e+r0unvt4EpL7eBKS+MmugvjJroL5hP5y+YT+cvjH4l74x+Je+f/aSvn/2kr65vI2+ubyNvi/vh74v74e+CcCBvgnAgb4y3na+Mt52vliXab5Yl2m+eLRbvni0W747uEy+O7hMvlm1Pb5ZtT2+KKQtviikLb4zFx2+MxcdvumxDL7psQy+HRT5vR0U+b2LtdW9i7XVvRe/sb0Xv7G9g46OvYOOjr0ac1O9GnNTvc3FC73NxQu9Y3uHvGN7h7yqvI46qryOOlRvnjxUb548v74ZPb++GT0TS2E9E0thPaBilT2gYpU90XW4PdF1uD2LDds9iw3bPQ=="
  }
];

test('pitched stems and tonal drums closely match real original WebGPU output', () => {
  for(const fixture of GPU_REFERENCES) {
    const params={...DEFAULTS,...fixture.overrides};
    const sequence=structuredClone(fixture.mode==='pattern'?createWebGpuChiptunePattern(DEFAULTS):SONG);
    if(fixture.hit) sequence.lanes[fixture.hit].cells=Array.from({length:32},()=>({state:'note',value:1,velocity:1}));
    const bytes=Buffer.from(fixture.samples,'base64');
    const expected=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
    for(const backend of ['scalar','simd']) {
      const actual=render(kernel(backend,params,sequence),10,128,48000,true);
      const error=difference(actual,expected);
      assert.ok(error<(fixture.id==='arp-song'?.002:.00012),`${fixture.id}/${backend}: GPU RMS error ${error}`);
    }
  }
});


function setTempoClock(engine, clock) {
  const buffer = new Float64Array(engine.exports.memory.buffer, engine.exports.tempo_clock_ptr(), TEMPO_CLOCK_CAPACITY * TEMPO_CLOCK_FIELDS);
  engine.exports.set_tempo_clock(clock.writeTo(buffer));
}

test('live tempo ramps leave a sustained original oscillator waveform unchanged', () => {
  const params = isolated({ upperOneLevel: 1, upperOneTone: -.6, tempo: 1.3, pwmDepth: .12 });
  const sequence = structuredClone(notePattern());
  sequence.lanes.upperOne.stepBeats = 4;
  sequence.lanes.upperOne.gate = .95;
  const offset = 600.25;
  const clock = new ChiptuneTempoClock(params.tempo);
  clock.setTempo(3.5, offset);
  for (const type of ['scalar', 'simd']) {
    const reference = render(kernel(type, params, sequence), offset, 4096);
    const changing = kernel(type, { ...params, tempo: 3.5 }, sequence);
    setTempoClock(changing, clock);
    const actual = render(changing, offset, 4096);
    assert.ok(rms(actual) > .01);
    assert.deepEqual(actual, reference, 'tempo automation must not alter oscillator phase, pitch or PWM seconds');
  }
});

test('tempo changes preserve an in-flight tonal drum hit instead of bending its phase', () => {
  const params = isolated({ tempo: 1.3, synthMix: 0, drumMix: 1, kickLevel: 0, snareLevel: 1, hatLevel: 0, shakerLevel: 0, snareNoiseMix: 0, ghostDrums: 0 });
  const sequence = notePattern('snare', 1);
  const offset = 10.21;
  const clock = new ChiptuneTempoClock(params.tempo);
  clock.setTempo(2.5, offset);
  for (const type of ['scalar', 'simd']) {
    const reference = render(kernel(type, params, sequence), offset, 2048);
    const changing = kernel(type, { ...params, tempo: 2.5 }, sequence);
    setTempoClock(changing, clock);
    const actual = render(changing, offset, 2048);
    const oldJump = render(kernel(type, { ...params, tempo: 2.5 }, sequence), offset, 2048);
    assert.ok(difference(actual, reference) < .001, `drum phase error ${difference(actual, reference)}`);
    assert.ok(difference(actual, reference) < difference(oldJump, reference) / 100, `drum fixed=${difference(actual, reference)}, previous=${difference(oldJump, reference)}`);
  }
});

test('source Song continuity improves over the previous tempo-times-elapsed seek', () => {
  const params = isolated({ upperOneLevel: 1, tempo: 1.3, pitchClock: .5, leadSectionShare: 0, gateA0: 65535, gateA1: 65535, gateA2: 65535, gateA3: 65535, gateLength: 2 });
  let fixedError = 0, oldError = 0;
  for (const offset of [123.137, 249.73, 367.337, 482.223, 600.837]) {
    const reference = render(kernel('simd', params), offset, 128);
    const changedParams = { ...params, tempo: 2.2 };
    const clock = new ChiptuneTempoClock(params.tempo);
    clock.setTempo(changedParams.tempo, offset);
    const changing = kernel('simd', changedParams);
    setTempoClock(changing, clock);
    fixedError += difference(render(changing, offset, 128), reference);
    oldError += difference(render(kernel('simd', changedParams), offset, 128), reference);
  }
  assert.ok(oldError > .01, `reference error ${oldError}`);
  assert.ok(fixedError < oldError / 100, `continuity errors fixed=${fixedError}, previous=${oldError}`);
});


test('analytic echoes read their historical beat rather than the newly selected tempo', () => {
  const params = isolated({ upperOneLevel: .4, tempo: 1.3, pitchClock: .5, leadSectionShare: 0, gateA0: 65535, gateA1: 65535, gateA2: 65535, gateA3: 65535, gateLength: 2 });
  const clock = new ChiptuneTempoClock(params.tempo);
  clock.setTempo(3.5, 123.137);
  for (const type of ['scalar', 'simd']) {
    const changing = kernel(type, { ...params, tempo: 3.5 });
    setTempoClock(changing, clock);
    for (const delay of [.33, 2, 6, 14, 16]) {
      const sourceTime = 123.15 - delay;
      const actual = render(changing, sourceTime, 128);
      const expected = render(kernel(type, params), sourceTime, 128);
      assert.ok(rms(expected) > .005);
      assert.ok(difference(actual, expected) < 1e-7, `historical echo ${delay} seconds must retain its original note and phase`);
    }
  }
});
