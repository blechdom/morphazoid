import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import {
  buildPath, copyNodes, forkTiming, headDelaySeconds, makeSplit, razorSplitRange, tapeTimeline,
} from "../src/instruments/tapezoid/path.js";

const source = readFileSync(new URL("../src/instruments/tapezoid/tapezoid-processor.js", import.meta.url), "utf8");
const sampleRate = 8000;
let Worklet;
const sandbox = createContext({
  AudioWorkletProcessor: class {
    constructor() { this.port = { onmessage: null, sent: [], postMessage(message) { this.sent.push(message); } }; }
  },
  Float32Array, Math, Number, sampleRate,
  registerProcessor(name, klass) {
    assert.equal(name, "morphazoid-tapezoid");
    Worklet = klass;
  },
});
new Script(source).runInContext(sandbox);

function send(worklet, data) { worklet.port.onmessage({ data }); }
function createWorklet() {
  const worklet = new Worklet();
  const samples = new Float32Array(sampleRate * 3);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = (i < sampleRate ? .36 : i < sampleRate * 2 ? .14 : 0)
      * Math.sin(2 * Math.PI * 155 * i / sampleRate);
  }
  send(worklet, { type: "material", samples, rate: sampleRate });
  send(worklet, {
    type: "route", seconds: 4.5,
    heads: [{ id: "play-1", position: 0 }, { id: "play-2", position: .03 }],
  });
  send(worklet, { type: "seek", phase: 0 });
  return worklet;
}
function render(worklet, frames) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let start = 0; start < frames; start += 128) {
    const l = new Float32Array(128), r = new Float32Array(128);
    assert.equal(worklet.process([], [[l, r]]), true);
    left.set(l.subarray(0, Math.min(128, frames - start)), start);
    right.set(r.subarray(0, Math.min(128, frames - start)), start);
  }
  for (const sample of [...left, ...right]) assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1);
  return { left, right };
}
function rms(samples) { return Math.sqrt(samples.reduce((total, value) => total + value * value, 0) / samples.length); }

test("explicit speed plays bounded stereo; pause releases sound but not the tape material", () => {
  const worklet = createWorklet();
  assert.deepEqual([worklet.voices, worklet.phaseSlip, worklet.monitorMix,
    worklet.echoReturn, worklet.feedback], [1, 0, .75, 0, .45]);
  assert.equal(rms(render(worklet, 1024).left), 0);
  send(worklet, { type: "speed", speed: 1 });
  const playing = render(worklet, 3200);
  assert.ok(rms(playing.left) > .015);
  assert.ok(rms(playing.right) > .015);
  assert.ok(rms(playing.left.map((value, index) => value - playing.right[index])) > .002);
  assert.equal(worklet.material.length, sampleRate * 3);
  send(worklet, { type: "speed", speed: 0 });
  const paused = render(worklet, 5000);
  assert.ok(rms(paused.left.subarray(4000)) < .0001);
  assert.ok(worklet.port.sent.some(message => message.type === "transport"
    && message.phase >= 0 && message.phase < 1));
});

test("reverse, wind and live routing change the read without rewriting or retuning material", () => {
  const reverse = createWorklet();
  send(reverse, { type: "speed", speed: -1 });
  render(reverse, 800);
  assert.ok(reverse.phase > reverse.length - 850 && reverse.phase < reverse.length);
  send(reverse, { type: "speed", speed: 4 });
  render(reverse, 2000);
  assert.ok(reverse.phase >= 0 && reverse.phase < reverse.length);

  const near = createWorklet(), far = createWorklet();
  const originalSamples = far.material;
  send(near, { type: "speed", speed: 1 });
  send(far, { type: "speed", speed: 1 });
  send(far, { type: "route", seconds: 7, heads: [{ id: "play-2", position: .4 }] });
  assert.equal(far.material, originalSamples);
  assert.equal(far.material.length, sampleRate * 3);
  assert.equal(far.length, sampleRate * 7);
  assert.equal(far.trackLength, sampleRate * 3);
  const nearAudio = render(near, 3000), farAudio = render(far, 3000);
  assert.ok(rms(nearAudio.left.map((value, index) => value - farAudio.left[index])) > .01);
});

test("moving one split lane changes its channel's smooth tape delay, not PCM or transport", () => {
  const intact = createWorklet(), forked = createWorklet();
  for (const worklet of [intact, forked]) {
    for (let i = 0; i < worklet.length; i += 1) {
      worklet.tape[i] = .46 * Math.sin(2 * Math.PI * 71 * i / sampleRate);
    }
    send(worklet, { type: "tape-params", printing: false, voices: 1, monitorMix: 1, echoReturn: 0 });
    send(worklet, { type: "seek", phase: .42, trackTime: .25 });
    send(worklet, { type: "speed", speed: 1 });
  }
  const tapeBefore = forked.tape.slice();
  const buffer = forked.tape;
  send(forked, { type: "route", seconds: 4.5, heads: [
    { id: "play-1", position: .08, branchDelays: [0, .14] },
    { id: "play-2", position: .23, branchDelays: [0, .14] },
  ] });
  send(intact, { type: "route", seconds: 4.5, heads: [
    { id: "play-1", position: .08 }, { id: "play-2", position: .23 },
  ] });
  assert.equal(forked.heads[0].targetA, 0);
  assert.equal(forked.heads[0].targetB, .14);
  assert.equal(forked.heads[0].offsetB, 0, "guide movement should not jump the reader instantly");
  const first = render(forked, sampleRate / 10);
  render(intact, sampleRate / 10);
  assert.ok(forked.heads[0].offsetB > .09 && forked.heads[0].offsetB < .14);
  assert.ok(rms(first.right) > .01);
  const forkAudio = render(forked, sampleRate / 4), intactAudio = render(intact, sampleRate / 4);
  assert.ok(rms(forkAudio.right.map((value, i) => value - intactAudio.right[i])) > .03,
    "the blue lane's detour must change the right-channel tape read");
  assert.ok(rms(forkAudio.left.map((value, i) => value - intactAudio.left[i])) < .001,
    "the unchanged amber lane must retain its previous read");
  assert.equal(forked.tape, buffer, "routing must not reallocate memory");
  assert.deepEqual(forked.tape, tapeBefore, "forking does not rewrite the shared recording");
  send(forked, { type: "route", seconds: 4.5, heads: [
    { id: "play-1", position: .08, branchDelays: [0, -.2] },
    { id: "play-2", position: .23, branchDelays: [0, -.2] },
  ] });
  assert.ok(forked.heads[0].offsetB > -.2);
  render(forked, sampleRate / 2);
  assert.ok(Math.abs(forked.heads[0].offsetB + .2) < .005);
  send(forked, { type: "route", seconds: 4.5, heads: [
    { id: "play-1", position: .08, branchDelays: [0, Infinity] },
    { id: "play-2", position: .23, branchDelays: [0, -900] },
  ] });
  assert.equal(forked.heads[0].targetB, 0);
  assert.equal(forked.heads[1].targetB, -3.5);
  send(forked, { type: "route", seconds: 4.5, heads: [
    { id: "play-1", position: .08 }, { id: "play-2", position: .23 },
  ] });
  render(forked, sampleRate / 2);
  assert.ok(Math.abs(forked.heads[0].offsetB) < .005, "Scotch join should restore the intact read");
  assert.equal(forked.targetSpeed, 1);
  assert.deepEqual(forked.tape, tapeBefore);
});

test("a downstream Scotch junction smoothly crossfades two out-of-sync arrivals without writing PCM", () => {
  const open = createWorklet(), joined = createWorklet();
  for (const worklet of [open, joined]) {
    for (let i = 0; i < worklet.length; i += 1) {
      worklet.tape[i] = .42 * Math.sin(2 * Math.PI * 71 * i / sampleRate);
    }
    send(worklet, { type: "tape-params",
      printing: false, voices: 1, monitorMix: 1, echoReturn: 0 });
    send(worklet, { type: "route", seconds: 4.5,
      heads: [{ id: "play-1", position: .15, branchDelays: [0, .137] },
        { id: "play-2", position: .24, branchDelays: [0, .137] }],
      records: [{ id: "record", position: 0 }] });
    send(worklet, { type: "seek", phase: .65, trackTime: .1 });
    send(worklet, { type: "speed", speed: 1 });
    render(worklet, sampleRate / 8);
  }
  const memory = joined.tape.slice();
  send(joined, { type: "route", seconds: 4.5,
    heads: [{ id: "play-1", position: .15, branchDelays: [0, .137], branchMix: .5 },
      { id: "play-2", position: .24, branchDelays: [0, .137], branchMix: .5 }],
    records: [{ id: "record", position: 0 }] });
  assert.equal(joined.heads[0].targetBlend, 1);
  assert.equal(joined.heads[0].targetMix, .5);
  render(joined, 128);
  assert.ok(joined.heads[0].blend > 0 && joined.heads[0].blend < 1,
    "the Scotch contact fades rather than clicking in");
  render(open, 128);
  const dry = render(open, sampleRate / 3);
  const mixed = render(joined, sampleRate / 3);
  assert.ok(rms(mixed.left.map((value, i) => value - dry.left[i])) > .005);
  assert.ok(rms(mixed.right.map((value, i) => value - dry.right[i])) > .005,
    "at half mix both channels hear both routes, not just the blue stereo side");
  assert.ok(Math.abs(joined.heads[0].blend - 1) < .025);

  send(joined, { type: "route", seconds: 4.5,
    heads: [{ id: "play-1", position: .15, branchDelays: [0, .137], branchMix: 1 },
      { id: "play-2", position: .24, branchDelays: [0, .137], branchMix: -1 }],
    records: [{ id: "record", position: 0 }] });
  assert.equal(joined.heads[0].targetMix, 1);
  assert.equal(joined.heads[1].targetMix, 0);
  const extreme = render(joined, sampleRate / 4);
  assert.ok(rms(extreme.left) > .005 && rms(extreme.right) > .005);
  assert.deepEqual(joined.tape, memory, "Scotch mixing is nondestructive");
  send(joined, { type: "route", seconds: 4.5,
    heads: [{ id: "play-1", position: .15, branchDelays: [0, 0], branchMix: Infinity },
      { id: "play-2", position: .24, branchDelays: [0, 0] }],
    records: [{ id: "record", position: 0 }] });
  assert.equal(joined.heads[0].targetBlend, 0);
  assert.equal(joined.targetSpeed, 1);
  render(joined, sampleRate / 2);
  assert.ok(joined.heads[0].blend < .005);
});

test("a pool on one fork branch delays only that channel while the shared loop and motor continue", () => {
  const path = buildPath(copyNodes());
  const split = makeSplit(path, .316, .352);
  const pool = { id: "pool-1", laneId: "lane-b", position: .334, seconds: 1.35 };
  const timeline = tapeTimeline(path, [pool]);
  const bare = forkTiming(path, [], split);
  const stored = forkTiming(path, [pool], split, timeline);
  assert.equal(timeline.seconds, tapeTimeline(path).seconds);
  assert.equal(stored.lanes[0].delaySeconds, bare.lanes[0].delaySeconds);
  assert.ok(stored.lanes[1].delaySeconds - bare.lanes[1].delaySeconds > 1.3);

  const control = createWorklet(), branch = createWorklet();
  const position = headDelaySeconds(path, [pool], .19, .37, timeline) / timeline.seconds;
  for (const worklet of [control, branch]) {
    send(worklet, { type: "route", seconds: timeline.seconds,
      heads: [{ id: "play-1", position,
        branchDelays: bare.lanes.map(lane => lane.delaySeconds * timeline.scale) }],
      records: [{ id: "record", position: 0 }] });
    for (let i = 0; i < worklet.length; i += 1) {
      worklet.tape[i] = .35 * Math.sin(2 * Math.PI * 71 * i / sampleRate);
    }
    send(worklet, { type: "tape-params", printing: false, monitorMix: 1, voices: 1, echoReturn: 0 });
    send(worklet, { type: "seek", phase: .7, trackTime: .25 });
    send(worklet, { type: "speed", speed: 1 });
  }
  const memory = branch.tape.slice(), storage = branch.tape;
  send(branch, { type: "route", seconds: timeline.seconds,
    heads: [{ id: "play-1", position,
      branchDelays: stored.lanes.map(lane => lane.delaySeconds * timeline.scale) }],
    records: [{ id: "record", position: 0 }] });
  assert.equal(branch.heads[0].targetA, control.heads[0].targetA);
  assert.ok(branch.heads[0].targetB - control.heads[0].targetB > 1.3);
  render(control, sampleRate / 5);
  render(branch, sampleRate / 5);
  const withoutPool = render(control, sampleRate / 5);
  const withPool = render(branch, sampleRate / 5);
  assert.ok(rms(withPool.right.map((value, i) => value - withoutPool.right[i])) > .01,
    "storage on blue must change its playback read");
  assert.ok(rms(withPool.left.map((value, i) => value - withoutPool.left[i])) < .001,
    "amber must not inherit blue's storage");
  assert.equal(branch.tape, storage);
  assert.deepEqual(branch.tape, memory);
  assert.equal(branch.targetSpeed, 1);
  send(branch, { type: "route", seconds: timeline.seconds,
    heads: [{ id: "play-1", position, branchDelays: [0, 0] }],
    records: [{ id: "record", position: 0 }] });
  render(branch, sampleRate / 2);
  assert.ok(Math.abs(branch.heads[0].offsetB) < .005, "Scotch fades the separate read back in");
  assert.deepEqual(branch.tape, memory);
});

test("four independent PLAY contacts can be added, returned to REC, and lifted during motion", () => {
  const base = createWorklet(), extended = createWorklet();
  for (const worklet of [base, extended]) {
    for (let i = 0; i < worklet.length; i += 1) {
      worklet.tape[i] = .4 * Math.sin(2 * Math.PI * 91 * i / sampleRate);
    }
    send(worklet, { type: "tape-params", printing: false, monitorMix: 1, voices: 1, echoReturn: 0 });
    send(worklet, { type: "seek", phase: .56 });
    send(worklet, { type: "speed", speed: 1 });
  }
  const heads = [{ id: "play-1", position: .11 }, { id: "play-2", position: .22 }];
  const records = [{ id: "record", position: 0 }];
  send(base, { type: "route", seconds: 4.5, heads, records });
  send(extended, { type: "route", seconds: 4.5,
    heads: [...heads, { id: "play-3", position: .32 }, { id: "play-4", position: .41 }], records });
  send(extended, { type: "tape-params", returnHead: "play-4" });
  assert.equal(extended.returnHead, "play-4");
  assert.equal(extended.heads[2].targetGain, 1);
  assert.equal(extended.heads[3].targetGain, 1);
  const existingTape = extended.tape;
  render(base, sampleRate / 4);
  render(extended, sampleRate / 4);
  const a = render(base, sampleRate / 3), b = render(extended, sampleRate / 3);
  assert.ok(rms(a.left.map((sample, index) => sample - b.left[index])) > .01,
    "added playback contacts must actually read additional tape");
  assert.ok(rms(b.right) > .01);
  send(extended, { type: "route", seconds: 4.5,
    heads: [{ id: "play-2", position: .22 }], records: [{ id: "record-2", position: 0 }] });
  send(extended, { type: "tape-params", returnHead: "play-2" });
  assert.equal(extended.heads[0].targetGain, 0);
  assert.equal(extended.heads[1].targetGain, 1);
  assert.equal(extended.heads[2].targetGain, 0);
  assert.equal(extended.records[0].targetGain, 0);
  assert.equal(extended.records[1].targetGain, 1);
  const rolling = render(extended, sampleRate / 2);
  assert.ok(rms(rolling.right) > .01);
  assert.ok(extended.heads[0].gain < .001 && extended.records[0].gain < .001);
  assert.equal(extended.tape, existingTape, "structural edits never allocate PCM in the audio callback");
  assert.equal(extended.targetSpeed, 1);
});

test("a second REC contact prints at its actual offset while the original recording stays bounded", () => {
  const single = createWorklet(), doubled = createWorklet();
  const burst = new Float32Array(sampleRate * 6);
  for (let i = 0; i < sampleRate * .08; i += 1) {
    burst[i] = .48 * Math.sin(2 * Math.PI * 150 * i / sampleRate);
  }
  for (const worklet of [single, doubled]) {
    send(worklet, { type: "material", samples: burst, rate: sampleRate });
    send(worklet, { type: "tape-params", voices: 1, feedback: .42, echoReturn: 0, monitorMix: 1 });
    send(worklet, { type: "speed", speed: 1 });
  }
  const playHeads = [{ id: "play-1", position: .05 }, { id: "play-2", position: .12 }];
  send(single, { type: "route", seconds: 4.5, heads: playHeads,
    records: [{ id: "record", position: 0 }] });
  send(doubled, { type: "route", seconds: 4.5, heads: playHeads,
    records: [{ id: "record", position: 0 }, { id: "record-2", position: .2 }] });
  render(single, sampleRate * .12);
  render(doubled, sampleRate * .12);
  const extraContact = doubled.tape.subarray(Math.floor(3.59 * sampleRate), Math.floor(3.68 * sampleRate));
  const withoutContact = single.tape.subarray(Math.floor(3.59 * sampleRate), Math.floor(3.68 * sampleRate));
  assert.ok(rms(extraContact) > .015, "the new head prints before the primary REC reaches that tape position");
  assert.equal(rms(withoutContact), 0);
  assert.ok(doubled.tape.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  assert.ok(rms(doubled.tape.subarray(0, sampleRate * .08)) > .01,
    "the original red head still prints while its new neighbor is active");
});

test("one modeled delay pool extends the loop and moves only playback reads downstream of it", () => {
  const path = buildPath(copyNodes());
  const pool = { id: "pool-1", position: .3, seconds: 1.4 };
  const beforePool = createWorklet(), afterPool = createWorklet();
  for (const worklet of [beforePool, afterPool]) {
    for (let i = 0; i < worklet.length; i += 1) {
      worklet.tape[i] = .45 * Math.sin(2 * Math.PI * 73 * i / sampleRate);
    }
    send(worklet, { type: "tape-params", printing: false, monitorMix: 1, voices: 1, echoReturn: 0 });
    send(worklet, { type: "seek", phase: .5 });
    send(worklet, { type: "speed", speed: 1 });
  }
  const record = .19, playNear = .26, playFar = .45;
  const routeFor = pools => {
    const seconds = tapeTimeline(path, pools).seconds;
    return {
      type: "route", seconds, records: [{ id: "record", position: 0 }],
      heads: [playNear, playFar].map((position, index) => ({
        id: `play-${index + 1}`, position: headDelaySeconds(path, pools, record, position) / seconds,
      })),
    };
  };
  send(beforePool, routeFor([]));
  send(afterPool, routeFor([pool]));
  assert.ok(Math.abs(beforePool.heads[0].target
    - afterPool.heads[0].target * afterPool.length / beforePool.length) < 1e-5,
  "the upstream read stays at the same absolute time when pool time is added");
  assert.ok(afterPool.heads[1].target * afterPool.length / sampleRate
    > beforePool.heads[1].target * beforePool.length / sampleRate + 1.39);
  assert.equal(afterPool.length - beforePool.length, Math.round(pool.seconds * sampleRate));
  const tape = afterPool.tape;
  render(beforePool, sampleRate / 4);
  render(afterPool, sampleRate / 4);
  const a = render(beforePool, sampleRate / 3), b = render(afterPool, sampleRate / 3);
  assert.ok(rms(a.right.map((sample, index) => sample - b.right[index])) > .015);
  assert.equal(afterPool.tape, tape);
  assert.equal(afterPool.targetSpeed, 1);
});

test("six pools retime both PLAY reads inside the same 12-second PCM allocation", () => {
  const path = buildPath(copyNodes());
  const pools = Array.from({ length: 6 }, (_, index) => ({
    id: `pool-${index + 1}`, position: .1 + index * .14, seconds: 3,
  }));
  const short = createWorklet(), crowded = createWorklet();
  for (const worklet of [short, crowded]) {
    for (let i = 0; i < worklet.tape.length; i += 1) {
      worklet.tape[i] = .42 * Math.sin(2 * Math.PI * 73.17 * i / sampleRate);
    }
    send(worklet, { type: "tape-params", printing: false, monitorMix: 1, voices: 1, echoReturn: 0 });
    send(worklet, { type: "speed", speed: 1 });
  }
  const route = (worklet, stored) => {
    const timeline = tapeTimeline(path, stored);
    send(worklet, {
      type: "route", seconds: timeline.seconds,
      records: [{ id: "record", position: 0 }],
      heads: [.52, .72].map((position, index) => ({
        id: `play-${index + 1}`,
        position: headDelaySeconds(path, stored, .19, position, timeline) / timeline.seconds,
      })),
    });
    send(worklet, { type: "seek", phase: .5 });
    return timeline;
  };
  route(short, []);
  const timeline = route(crowded, pools);
  const tape = crowded.tape;
  assert.equal(timeline.seconds, 12);
  assert.ok(timeline.scale < 1);
  assert.equal(crowded.length, sampleRate * 12);
  assert.ok(crowded.heads[0].target > 0 && crowded.heads[1].target > crowded.heads[0].target);
  const a = render(short, sampleRate / 4), b = render(crowded, sampleRate / 4);
  assert.ok(rms(b.left) > .01 && rms(b.right) > .01);
  assert.ok(rms(a.left.map((sample, index) => sample - b.left[index])) > .01,
    "six storage basins must move the actual playback read");
  assert.equal(crowded.tape, tape, "storage pools must not allocate another tape buffer");
});

test("short finished material repeats without blank travel over a longer physical route", () => {
  const worklet = createWorklet();
  const samples = Float32Array.from({ length: sampleRate / 2 }, (_, i) =>
    .35 * Math.sin(2 * Math.PI * 155 * i / sampleRate));
  send(worklet, { type: "material", samples, rate: sampleRate });
  send(worklet, { type: "route", seconds: 12, heads: [
    { id: "play-1", position: 0 }, { id: "play-2", position: .03 },
  ] });
  send(worklet, { type: "speed", speed: 1 });
  for (let second = 0; second < 14; second++) {
    assert.ok(rms(render(worklet, sampleRate).left) > .025, `second ${second} must sound`);
  }
  assert.ok(worklet.phase < worklet.length);
  assert.ok(worklet.trackCursor < worklet.trackLength);
  assert.ok(worklet.port.sent.some(message => message.type === "transport"
    && message.trackTime >= 0 && message.trackTime < .5));
});

test("changing track PCM crossfades while retaining speed, phase and head routing", () => {
  const worklet = createWorklet();
  send(worklet, { type: "speed", speed: 1 });
  render(worklet, 1000);
  const phase = worklet.phase, target = worklet.heads[1].target;
  send(worklet, { type: "material", samples: Float32Array.from({ length: sampleRate },
    (_, i) => .45 * Math.sin(2 * Math.PI * 200 * i / sampleRate)), rate: sampleRate });
  assert.ok(worklet.fadeRemaining > 0);
  assert.equal(worklet.heads[1].target, target);
  assert.equal(worklet.targetSpeed, 1);
  assert.equal(worklet.phase, phase);
  assert.ok(rms(render(worklet, 1800).left) > .005);
  assert.equal(worklet.previousMaterial, null);
  send(worklet, { type: "seek", phase: .25, trackTime: .7 });
  assert.ok(Math.abs(worklet.trackCursor - .7 * sampleRate) < 1);
});

test("Razor's two joined routes keep separate audio delays and never stop the motor or REC", () => {
  const nodes = copyNodes(), path = buildPath(nodes);
  const range = razorSplitRange(path, .33, nodes, [
    { id: "record", kind: "record", position: .19 },
    { id: "play-1", kind: "play", position: .37 },
    { id: "play-2", kind: "play", position: .52 },
  ]);
  const fork = forkTiming(path, [], makeSplit(path, range.start, range.end));
  const seconds = tapeTimeline(path).seconds;
  const worklet = createWorklet(), intact = createWorklet();
  for (const reader of [worklet, intact]) {
    for (let i = 0; i < reader.length; i += 1) {
      reader.tape[i] = .4 * Math.sin(2 * Math.PI * 53 * i / sampleRate);
    }
    send(reader, { type: "tape-params", voices: 1, printing: true, feedback: .4,
      echoReturn: 0, monitorMix: 1 });
    send(reader, { type: "speed", speed: 1 });
  }
  const heads = [.37, .52].map((position, index) => ({
    id: `play-${index + 1}`,
    position: headDelaySeconds(path, [], .19, position) / seconds,
    branchDelays: fork.lanes.map(lane => lane.delaySeconds),
  }));
  const records = [{ id: "record", position: 0 }];
  send(worklet, { type: "route", seconds, heads, records });
  send(intact, { type: "route", seconds, heads: heads.map(({ branchDelays, ...head }) => head), records });
  render(worklet, sampleRate / 2);
  render(intact, sampleRate / 2);
  const out = render(worklet, sampleRate / 2), baseline = render(intact, sampleRate / 2);
  assert.ok(rms(out.right.map((value, index) => value - baseline.right[index])) > .01,
    "the post's added route time is heard *after* the visual join");
  assert.ok(rms(out.left.map((value, index) => value - out.right[index])) > .01);
  assert.ok(worklet.tape.some(value => Math.abs(value) > .02), "REC continues printing");
  assert.equal(worklet.targetSpeed, 1);
  assert.equal(worklet.port.sent.filter(message => message.type === "stopped-on-cut").length, 0);
  send(worklet, { type: "cut", position: .4, remainingSeconds: 0 });
  render(worklet, sampleRate / 4);
  assert.equal(worklet.targetSpeed, 1, "a legacy open-cut message cannot sever this continuous tape");
  send(worklet, { type: "dispose" });
  assert.equal(worklet.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
});

function singleBurstWorklet(feedback) {
  const worklet = createWorklet();
  const samples = new Float32Array(sampleRate * 6);
  for (let i = 0; i < sampleRate / 2; i += 1) {
    samples[i] = .45 * Math.sin(2 * Math.PI * 190 * i / sampleRate);
  }
  send(worklet, { type: "material", samples, rate: sampleRate });
  send(worklet, { type: "route", seconds: 4.5, heads: [
    { id: "play-1", position: .05 }, { id: "play-2", position: .16 },
  ] });
  send(worklet, { type: "tape-params", feedback, phaseSlip: 0, printing: true, echoReturn: 0 });
  send(worklet, { type: "speed", speed: 1 });
  return worklet;
}

test("REC actually prints a track; head distance and feedback accumulate a bounded later pass", () => {
  const wiped = singleBurstWorklet(0), stacked = singleBurstWorklet(.85);
  render(wiped, sampleRate * 4.5);
  render(stacked, sampleRate * 4.5);
  const nextLapWiped = render(wiped, sampleRate), nextLapStacked = render(stacked, sampleRate);
  const tail = [Math.floor(.3 * sampleRate), Math.floor(.42 * sampleRate)];
  const wipeRms = rms(nextLapWiped.left.subarray(...tail));
  const echoRms = rms(nextLapStacked.left.subarray(...tail));
  assert.ok(echoRms > wipeRms + .012, `${echoRms} should exceed wiped ${wipeRms}`);
  assert.ok(stacked.tape.some(value => Math.abs(value) > .005));
  assert.ok(stacked.tape.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  assert.equal(stacked.tape.length, 12 * sampleRate + 2);
  const sameTape = stacked.tape;
  send(stacked, { type: "route", seconds: 8, heads: [{ id: "play-2", position: .29 }] });
  assert.equal(stacked.tape, sameTape, "rerouting must not allocate or discard the tape");
});

function headReturnWorklet(head, amount) {
  const worklet = new Worklet();
  const samples = new Float32Array(sampleRate * 6);
  for (let i = 0; i < sampleRate / 40; i += 1) {
    samples[i] = .48 * Math.sin(2 * Math.PI * 150 * i / sampleRate);
  }
  send(worklet, { type: "material", samples, rate: sampleRate });
  send(worklet, { type: "route", seconds: 4.5, heads: [
    { id: "play-1", position: .1 }, { id: "play-2", position: .2 },
  ] });
  send(worklet, {
    type: "tape-params", feedback: 0, phaseSlip: 0, voices: 1,
    echoReturn: amount, returnHead: head, monitorMix: 1,
  });
  send(worklet, { type: "speed", speed: 1 });
  return worklet;
}

test("playback-to-REC return actually prints delayed repeats at the selected head's travel time", () => {
  const dry = headReturnWorklet("play-1", 0);
  const short = headReturnWorklet("play-1", .8);
  const long = headReturnWorklet("play-2", .8);
  const original = render(short, sampleRate * .25);
  assert.ok(rms(original.left.subarray(500)) < .003, "tape-only monitor stays quiet before the playback heads");
  render(dry, sampleRate * 1.2);
  render(short, sampleRate * .95);
  render(long, sampleRate * 1.2);
  const recordedRms = (worklet, second) => rms(worklet.tape.subarray(
    Math.floor(sampleRate * second), Math.floor(sampleRate * (second + .02)),
  ));
  assert.ok(recordedRms(short, .46) > recordedRms(dry, .46) + .01,
    "PLAY 01 returns the burst to REC after a 0.45-second head journey");
  assert.ok(recordedRms(long, .46) < recordedRms(short, .46) * .2,
    "PLAY 02 has not yet reached REC after the PLAY 01 journey");
  assert.ok(recordedRms(long, .91) > recordedRms(dry, .91) + .005,
    "PLAY 02 returns the same burst after its 0.9-second journey");
  assert.ok(short.tape.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  send(short, { type: "tape-params", echoReturn: 10, returnHead: "cassette", monitorMix: Infinity });
  assert.equal(short.echoReturn, .8);
  assert.equal(short.returnHead, "play-1");
  assert.equal(short.monitorMix, 1);
});

test("HOLD stops reprinting but keeps the echo, and ERASE fades then clears without stopping", () => {
  const worklet = singleBurstWorklet(.85);
  render(worklet, sampleRate);
  const stored = worklet.tape.slice(0, sampleRate / 2);
  send(worklet, { type: "tape-params", printing: false });
  assert.equal(worklet.printing, false);
  render(worklet, sampleRate * 5);
  assert.deepEqual(worklet.tape.subarray(0, stored.length), stored);
  const phase = worklet.phase;
  send(worklet, { type: "erase-tape" });
  render(worklet, sampleRate / 4);
  assert.equal(worklet.erasePending, false);
  assert.ok(worklet.tape.every(value => value === 0));
  assert.equal(worklet.targetSpeed, 1);
  assert.notEqual(worklet.phase, phase);
});

test("a virtual second motor slips gradually; 0% locks the two phrases without re-triggering", () => {
  const locked = createWorklet(), slipping = createWorklet();
  send(locked, { type: "tape-params", voices: 2, phaseSlip: 0, feedback: 0 });
  send(slipping, { type: "tape-params", voices: 2, phaseSlip: .06, feedback: 0 });
  send(locked, { type: "speed", speed: 1 });
  send(slipping, { type: "speed", speed: 1 });
  const a = render(locked, sampleRate * 2);
  const b = render(slipping, sampleRate * 2);
  assert.ok(rms(a.left.map((sample, index) => sample - b.left[index])) > .002);
  const lockedOffset = locked.port.sent.findLast(message => message.type === "transport").phaseShiftTime;
  const slippingOffset = slipping.port.sent.findLast(message => message.type === "transport").phaseShiftTime;
  assert.ok(lockedOffset < 1e-8);
  assert.ok(slippingOffset > .09 && slippingOffset < .13, String(slippingOffset));
  const phase = slipping.phase, cursor = slipping.trackCursor;
  send(slipping, { type: "tape-params", phaseSlip: 10, feedback: Infinity });
  assert.equal(slipping.phaseSlip, .06);
  assert.equal(slipping.feedback, 0);
  assert.equal(slipping.phase, phase);
  assert.equal(slipping.trackCursor, cursor);
  send(slipping, { type: "seek", phase: .34, trackTime: .5, phaseShiftTime: .25 });
  assert.ok(Math.abs(slipping.ghostCursor - .75 * sampleRate) < 1);
});

test("source motors can go solo, double a drifting pair to four/eight, and re-sync", () => {
  const worklet = createWorklet();
  send(worklet, { type: "tape-params", voices: 1, phaseSlip: .06 });
  send(worklet, { type: "speed", speed: 1 });
  render(worklet, sampleRate);
  assert.equal(worklet.voices, 1);
  assert.ok(Math.abs(worklet.ghostCursor - worklet.trackCursor) < 1e-7);
  send(worklet, { type: "tape-params", voices: 2 });
  assert.ok(Math.abs(worklet.ghostCursor - worklet.trackCursor) < 1e-7);
  render(worklet, sampleRate);
  assert.ok(Math.abs(worklet.ghostCursor - worklet.trackCursor) > .059 * sampleRate);
  send(worklet, { type: "tape-params", voices: 4 });
  assert.ok(Math.abs(worklet.extraCursors[0] - worklet.trackCursor) < 1e-7);
  assert.ok(Math.abs(worklet.extraCursors[1] - worklet.ghostCursor) < 1e-7);
  render(worklet, sampleRate);
  const firstOffset = (worklet.extraCursors[0] - worklet.trackCursor + worklet.trackLength) % worklet.trackLength;
  assert.ok(firstOffset > .018 * sampleRate && firstOffset < .022 * sampleRate, String(firstOffset));
  assert.ok(worklet.extraCursors[1] - worklet.ghostCursor < -.015 * sampleRate,
    "newly copied voices diverge gradually rather than re-triggering the source");
  send(worklet, { type: "tape-params", voices: 8 });
  assert.ok(Math.abs(worklet.extraCursors[2] - worklet.trackCursor) < 1e-7);
  render(worklet, sampleRate);
  const status = worklet.port.sent.findLast(message => message.type === "transport");
  assert.equal(status.extraPhaseTimes.length, 6);
  assert.ok(status.extraPhaseTimes.slice(0, 6).some(value => value > .01));
  assert.ok(worklet.tape.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  send(worklet, { type: "sync-motors" });
  assert.equal(worklet.ghostCursor, worklet.trackCursor);
  assert.ok(worklet.extraCursors.every(cursor => cursor === worklet.trackCursor));
  send(worklet, { type: "seek", phase: .4, trackTime: .5,
    phaseShiftTime: .25, extraPhaseTimes: [.1, .2, .3, .4, .5, .6] });
  assert.ok(Math.abs(worklet.ghostCursor - .75 * sampleRate) < 1);
  assert.ok(Math.abs(worklet.extraCursors[5] - 1.1 * sampleRate) < 1);
  send(worklet, { type: "tape-params", voices: 3 });
  assert.equal(worklet.voices, 8);
});

test("turning Audio off can transfer recorded tape to a new worklet without losing echoes", () => {
  const original = singleBurstWorklet(.75);
  render(original, sampleRate * .65);
  send(original, { type: "export-tape" });
  const snapshot = original.port.sent.findLast(message => message.type === "tape-snapshot");
  assert.equal(snapshot.rate, sampleRate);
  const meaningfulIndex = snapshot.samples.findIndex(value => Math.abs(value) > .04);
  assert.ok(meaningfulIndex >= 0);
  assert.notEqual(snapshot.samples, original.tape);
  const reopened = createWorklet();
  send(reopened, { type: "import-tape", samples: snapshot.samples, rate: snapshot.rate });
  assert.deepEqual(reopened.tape, original.tape);
  assert.ok(Math.abs(reopened.readTape(meaningfulIndex)) > .04);
  // Refuse malformed memory rather than allowing an unbounded transfer.
  send(reopened, { type: "import-tape", samples: new Float32Array(sampleRate * 13), rate: sampleRate });
  assert.deepEqual(reopened.tape, original.tape);
  // Audio-output device sample-rate changes do not lose the recorded image.
  const otherRate = new Float32Array(snapshot.samples.length * 2);
  for (let i = 0; i < otherRate.length; i += 1) otherRate[i] = snapshot.samples[Math.floor(i / 2)];
  send(reopened, { type: "import-tape", samples: otherRate, rate: sampleRate * 2 });
  assert.ok(Math.abs(reopened.tape[meaningfulIndex] - original.tape[meaningfulIndex]) < .04);
});
