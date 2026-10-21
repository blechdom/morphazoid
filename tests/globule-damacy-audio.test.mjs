import assert from "node:assert/strict";
import test from "node:test";
import { GlobuleAudio } from "../src/instruments/globule-damacy/audio.js";
import {
  IDENTITY_ORIENTATION, MAX_VOICES, coordinatesOf, grainHit, needleNormalAt, normalAt,
  rollOrientation, rollPlayPose, rotateNormal,
} from "../src/instruments/globule-damacy/model.js";

function motorZone(key, phase, latitudeRadius = .5) {
  const normal = needleNormalAt(IDENTITY_ORIENTATION, phase, 3.5, 0);
  return {
    key, sourceIndex: key % 8, normal, ...coordinatesOf(normal),
    angularRadius: .017, latitudeRadius, tilt: 0, shapeSeed: .25,
    sampleRate: 8000, channels: [new Float32Array(800).fill(.3)],
  };
}

function param() {
  const events = [];
  return { value: 0, events,
    cancelScheduledValues(time) { events.push({ kind: "cancel", time }); },
    setTargetAtTime() {},
    setValueAtTime(value, time) { events.push({ kind: "set", value, time }); },
    linearRampToValueAtTime(value, time) { events.push({ kind: "ramp", value, time }); } };
}
function node(extra = {}) {
  return { connect() {}, disconnect() {}, ...extra };
}
function fakeContext() {
  const created = [], sources = [];
  return {
    created, sources, currentTime: 1, state: "running",
    createBuffer(channels, length, rate) {
      const buffer = { channels: Array.from({ length: channels }, () => new Float32Array(length)),
        duration: length / rate,
        copyToChannel(data, channel) { this.channels[channel].set(data); } };
      created.push(buffer);
      return buffer;
    },
    createGain() { return node({ gain: param() }); },
    createStereoPanner() { return node({ pan: param() }); },
    createBufferSource() {
      const source = node({ playbackRate: param(),
        start(time) { this.started = time; },
        stop(time) { this.stopped = time; } });
      sources.push(source);
      return source;
    },
    async close() { this.state = "closed"; },
  };
}

test("bounded Web Audio voices read owned sample copies, reverse without altering PCM, and release on removal", async () => {
  assert.equal(MAX_VOICES, 32, "denser crossings have room for more simultaneous scraps");
  const audio = new GlobuleAudio();
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  const ribbon = {
    key: 1, sourceIndex: 0, angle: .25, latitude: 3.5,
    angularRadius: .02, latitudeRadius: .6, tilt: 0, shapeSeed: .25,
    channels: [Float32Array.from({ length: 1600 }, (_, index) => (index % 251) / 251)],
    sampleRate: 8000,
  };
  const hit = grainHit(ribbon, .8, 3);
  audio.setRibbons([ribbon]);
  for (let index = 0; index < MAX_VOICES * 2; index++)
    audio.schedule({ ...hit, reverse: index % 2 === 1 }, context.currentTime + .04 + index * .001);
  assert.equal(audio.voices.size, MAX_VOICES);
  assert.equal(context.sources.length, MAX_VOICES);
  assert.equal(context.created.length, 2, "each PCM direction has one cached buffer");
  assert.equal(context.created[0].channels[0][0], ribbon.channels[0][0]);
  assert.equal(context.created[1].channels[0][0], ribbon.channels[0].at(-1));
  assert.equal(ribbon.channels[0][0], 0, "the source copy is never reversed in place");
  assert.ok(context.sources.every(source => source.started >= context.currentTime
    && source.stopped > source.started));
  audio.setRibbons([]);
  assert.ok([...audio.voices].every(voice => voice.released
    && voice.source.stopped <= context.currentTime + .055));
  await audio.close();
  assert.equal(audio.context, null);
  assert.equal(audio.voices.size, 0);
  assert.equal(context.state, "closed");
});

test("full-scale mono and panned stereo grains retain headroom at the 32-voice limit", async () => {
  for (const [channels, pan] of [[1, 0], [2, 0], [2, .62]]) {
    const audio = new GlobuleAudio(), context = fakeContext();
    audio.context = context;
    audio.master = context.createGain();
    const ribbon = { ...motorZone(1, .4),
      channels: Array.from({ length: channels }, () => new Float32Array(800).fill(1)) };
    for (let index = 0; index < MAX_VOICES; index++)
      assert.equal(audio.schedule({ ribbon, reverse: false, rate: 1, pan }, 1.04), true);
    const peakSum = [...audio.voices].reduce((sum, voice) => sum + voice.peak, 0);
    const channelGain = channels === 2 ? 1 + Math.sin(Math.PI * Math.abs(pan) / 2) : 1;
    assert.ok(peakSum * .8 * channelGain < 1,
      `${channels}-channel grains at pan ${pan} must not clip at maximum output`);
    assert.equal(audio.schedule({ ribbon, reverse: false, rate: 1, pan }, 1.04), false);
    await audio.close();
  }
});

test("releasing a grain during its attack holds the current gain before a short fade", async () => {
  const audio = new GlobuleAudio(), context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  const ribbon = motorZone(1, .4);
  audio.schedule({ ribbon, reverse: false, rate: 1, pan: 0 }, 1.02);
  const [voice] = audio.voices;
  context.currentTime = voice.startAt + voice.attack / 2;
  audio.releaseVoice(voice);
  const events = voice.gain.gain.events;
  const cancel = events.findLastIndex(event => event.kind === "cancel");
  assert.ok(cancel >= 0, "the old release automation is cancelled");
  assert.equal(events[cancel + 1].kind, "set");
  assert.ok(events[cancel + 1].value > 0 && events[cancel + 1].value < voice.peak,
    "the in-flight gain is restored rather than jumping to zero");
  assert.equal(events.at(-1).kind, "ramp");
  assert.equal(events.at(-1).value, 0);
  assert.ok(voice.source.stopped >= context.currentTime + .02);
  await audio.close();
});

test("live play-control edits leave audible grains ringing, cancelling only future attacks", async t => {
  const audio = new GlobuleAudio(), context = fakeContext();
  t.after(() => audio.close());
  audio.context = context;
  audio.master = context.createGain();
  audio.enabled = true;
  audio.playing = true;
  audio.scatter = 0;
  audio.needleWidth = 0;
  audio.anchorPhase = .4;
  audio.anchorTime = context.currentTime;
  const ribbon = motorZone(1, .4);
  audio.setRibbons([ribbon]);
  const hit = { ribbon, reverse: false, rate: 1, pan: 0 };
  audio.schedule(hit, 1.01);
  audio.schedule(hit, 1.10);
  const [ringing, future] = audio.voices;
  context.currentTime = 1.04;
  audio.setControls({ phase: .4, speed: 1.2, needleWidth: 30 });
  assert.equal(ringing.released, false, "the note already sounding gets its full envelope");
  assert.equal(future.released, true, "old-path lookahead attacks never play after rebase");
  assert.ok(future.source.stopped <= future.startAt);
  await audio.close();
});

test("new pickups audition immediately only after explicit Audio, bounded on a long roll", async () => {
  const heard = [];
  const audio = new GlobuleAudio({ onHit: (grain, hit) => heard.push([grain.key, hit.pickup]) });
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  audio.speed = 2; // Pickup listens to the raw recording, not a Play preset.
  const grains = Array.from({ length: 150 }, (_, key) => ({
    key, sourceIndex: key % 8, angle: .25, latitude: 3.5,
    angularRadius: .02, latitudeRadius: .6, tilt: 0, shapeSeed: .25,
    channels: [new Float32Array(800).fill(.3)], sampleRate: 8000,
  }));
  audio.setRibbons(grains);
  assert.equal(audio.auditionPickup(grains), 0);
  assert.equal(context.sources.length, 0, "rolling does not silently arm Audio");
  assert.equal(audio.context, context);
  audio.setEnabled(true);
  assert.equal(audio.auditionPickup(grains), 16);
  assert.equal(context.sources.length, 16);
  assert.ok(heard.every(([, pickup]) => pickup === true));
  assert.ok(new Set(heard.map(([key]) => key)).size === 16);
  assert.ok(context.sources.every(source => source.playbackRate.value === 1
    && source.started >= context.currentTime + .012
    && source.started <= context.currentTime + .14));
  assert.equal(audio.auditionPickup(grains), MAX_VOICES - 16,
    "the shared voice cap still applies when Play and Record overlap");
  assert.equal(audio.voices.size, MAX_VOICES);
  audio.setRibbons([]);
  assert.ok([...audio.voices].every(voice => voice.released),
    "Undo/cancel must release pickups removed from the ball");
  audio.setEnabled(false);
  assert.equal(audio.auditionPickup(grains), 0);
  await audio.close();
});

test("audio-clock probes trigger only at zone entry, not nearest empty space or while held inside", async () => {
  const hits = [], audio = new GlobuleAudio({ onHit: zone => hits.push(zone.key) });
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  audio.scatter = 0;
  audio.needleWidth = 0;
  const grain = motorZone(42, .99, .6);
  audio.setRibbons([grain]);
  let inside = audio.scanAt(.3, 1.05, new Set());
  assert.equal(inside.size, 0);
  assert.equal(context.sources.length, 0, "the nearest grain stays silent across empty space");
  inside = audio.scanAt(.98, 1.06, inside);
  assert.deepEqual(hits, [42]);
  inside = audio.scanAt(.002, 1.07, inside);
  assert.deepEqual(hits, [42], "the seam does not retrigger a held zone");
  inside = audio.scanAt(.3, 1.08, inside);
  assert.equal(inside.size, 0);
  inside = audio.scanAt(.98, 1.09, inside);
  assert.deepEqual(hits, [42, 42], "leaving and reentering does");
  audio.needle = 7;
  inside = audio.scanAt(.3, 1.10, inside);
  inside = audio.scanAt(.99, 1.11, inside);
  assert.deepEqual(hits, [42, 42], "another latitude remains quiet");
  await audio.close();
});

test("needle width reads neighboring grains together, only on entry, without playing empty glass", async () => {
  const hits = [], audio = new GlobuleAudio({ onHit: grain => hits.push(grain.key) });
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  audio.scatter = 0;
  audio.needleWidth = 0;
  audio.setRibbons([motorZone(1, .4), motorZone(2, .44), motorZone(3, .6)]);
  let inside = audio.scanAt(.4, 1.05, new Set());
  assert.deepEqual(hits, [1], "a point-sized needle reads just the spot beneath its center");
  audio.needleWidth = 100;
  inside = audio.scanAt(.4, 1.06, inside);
  assert.deepEqual(hits, [1, 2], "widening into a second zone sounds only the new grain");
  assert.equal(context.sources.length, 2, "both independent sample voices overlap");
  assert.equal(context.sources[0].started, 1.05);
  assert.equal(context.sources[1].started, 1.06);
  inside = audio.scanAt(.4, 1.07, inside);
  assert.deepEqual(hits, [1, 2], "staying in the wide mouth never retriggers either grain");
  inside = audio.scanAt(.8, 1.08, inside);
  assert.equal(inside.size, 0);
  assert.deepEqual(hits, [1, 2], "even a wide mouth stays quiet on bare glass");
  inside = audio.scanAt(.4, 1.09, inside);
  assert.deepEqual(hits, [1, 2, 1, 2], "returning to overlapping zones plays both together");
  assert.equal(context.sources[2].started, context.sources[3].started);
  assert.ok(!hits.includes(3), "a width setting is not a nearest-grain fallback");
  await audio.close();
});

test("all grains in a three-layer stack play their own PCM on entry", async () => {
  const hits = [], audio = new GlobuleAudio({ onHit: grain => hits.push(grain.key) });
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  audio.scatter = 0;
  audio.needleWidth = 0;
  const lower = motorZone(1, .4), upper = {
    ...motorZone(2, .4),
    channels: [new Float32Array(800).fill(.75)],
  };
  const newest = { ...motorZone(3, .4),
    channels: [new Float32Array(800).fill(-.5)] };
  audio.setRibbons([lower, upper, newest]); // Later pickups are painted on top.
  let inside = audio.scanAt(.3, 1.04, new Set());
  assert.equal(inside.size, 0, "bare chrome is still quiet");
  inside = audio.scanAt(.4, 1.05, inside);
  assert.deepEqual(hits, [1, 2, 3]);
  assert.deepEqual([...inside], [1, 2, 3]);
  assert.equal(context.sources[0].buffer.channels[0][0], lower.channels[0][0]);
  assert.equal(context.sources[1].buffer.channels[0][0], upper.channels[0][0]);
  assert.equal(context.sources[2].buffer.channels[0][0], newest.channels[0][0]);
  assert.equal(context.sources[0].started, context.sources[1].started);
  assert.equal(context.sources[1].started, context.sources[2].started);
  inside = audio.scanAt(.4, 1.06, inside);
  assert.deepEqual(hits, [1, 2, 3], "no layer retriggers while the tip remains inside");
  inside = audio.scanAt(.3, 1.07, inside);
  audio.scanAt(.4, 1.08, inside);
  assert.deepEqual(hits, [1, 2, 3, 1, 2, 3], "every layer can be revisited");
  await audio.close();
});

test("the audio scanner reads a 3D polar grain in its recorded pose, not a latitude stripe", async () => {
  const hits = [], audio = new GlobuleAudio({ onHit: grain => hits.push(grain.key) });
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  audio.scatter = 0;
  audio.needleWidth = 0;
  const grain = {
    key: 8, sourceIndex: 3, angle: .23, latitude: 0,
    normal: normalAt(.23, 0), angularRadius: .022,
    latitudeRadius: .55, tilt: .12, shapeSeed: .4,
    sampleRate: 8000, channels: [new Float32Array(800).fill(.3)],
  };
  const pose = rollOrientation(IDENTITY_ORIENTATION, 47, -28, 34);
  const world = coordinatesOf(rotateNormal(pose, grain.normal));
  const point = rotateNormal(pose, grain.normal);
  const distance = Math.hypot(point[0], point[1]), angle = Math.acos(point[2]);
  const steering = rollPlayPose(IDENTITY_ORIENTATION,
    -point[0] * angle * 34 / distance, point[1] * angle * 34 / distance, 34);
  audio.setRibbons([grain], pose, steering);
  let inside = audio.scanAt(0, 1.05, new Set());
  assert.deepEqual(hits, [8], "the needle meets the visible, rotated mark");
  assert.ok(world.latitude > 1, "recording moved the north pole away from its initial view");
  inside = audio.scanAt(.001, 1.06, inside);
  assert.deepEqual(hits, [8], "staying in a spherical zone does not retrigger it");
  audio.needle = 7;
  assert.equal(audio.scanAt(0, 1.07, inside).size, 0,
    "the other pole is not a fallback");
  await audio.close();
});

test("changing transport controls while still inside a zone does not fabricate another entry", async () => {
  const audio = new GlobuleAudio();
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  audio.enabled = true;
  audio.playing = true;
  audio.scatter = 0;
  audio.needleWidth = 0;
  audio.anchorPhase = .4;
  audio.anchorTime = context.currentTime;
  audio.setRibbons([motorZone(17, .4, .6)]);
  audio.inside.add(17);
  audio.setControls({ phase: .4, speed: 1.2, needle: 3.5, scatter: 0, needleWidth: 0 });
  assert.equal(context.sources.length, 0, "changing speed while touching a spot must not retrigger it");
  audio.setControls({ phase: .4, needle: 7 });
  assert.equal(context.sources.length, 0, "lifting the tip leaves the patch");
  audio.setControls({ phase: .4, needle: 3.5 });
  assert.equal(context.sources.length, 1, "touching the same patch again after leaving does trigger");
  await audio.close();
});

test("changing width during a live turn fires only newly touched zones and retains transport", async t => {
  const hits = [], audio = new GlobuleAudio({ onHit: grain => hits.push(grain.key) });
  t.after(() => audio.close());
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  audio.enabled = true;
  audio.playing = true;
  audio.speed = .5; // A narrow lookahead must not reach the neighboring spot first.
  audio.scatter = 0;
  audio.needleWidth = 0;
  audio.anchorPhase = .4;
  audio.anchorTime = context.currentTime;
  audio.setRibbons([motorZone(0, .4, .32), motorZone(1, .44, .32)]);
  audio.inside.add(0);
  audio.setControls({ phase: .4, needleWidth: 100 });
  assert.deepEqual(hits, [1], "the center grain already under the tip does not fire again");
  assert.equal(audio.playing, true);
  assert.equal(audio.enabled, true);
  audio.setControls({ phase: .4, needleWidth: 100 });
  assert.deepEqual(hits, [1], "setting the same width twice does not invent a second entry");
  audio.setControls({ phase: .4, needleWidth: 0 });
  audio.setControls({ phase: .4, needleWidth: 100 });
  assert.deepEqual(hits, [1, 1], "narrowing away then widening back re-enters that zone");
  await audio.close();
});

test("fast forward and backwards scratches sound zones crossed between pointer events", async () => {
  const audio = new GlobuleAudio();
  const context = fakeContext();
  audio.context = context;
  audio.master = context.createGain();
  audio.scatter = 0;
  audio.needleWidth = 0;
  audio.setRibbons([motorZone(9, .2)]);
  audio.setEnabled(true);
  audio.scratch(.1, true);
  assert.equal(context.sources.length, 0);
  audio.scratch(.4);
  assert.equal(context.sources.length, 1, "an intervening contact sounds even when both endpoints miss");
  audio.scratch(.41);
  assert.equal(context.sources.length, 1, "staying in empty space does not invent repeats");
  audio.scratch(.1);
  assert.equal(context.sources.length, 2, "crossing back into the same patch retriggers it");
  await audio.close();
});

test("manual Play rolling sounds crossed zones between pointer events, in both screen axes", async t => {
  const hits = [], audio = new GlobuleAudio({ onHit: grain => hits.push(grain.key) });
  t.after(() => audio.close());
  const context = fakeContext(), radius = 100;
  audio.context = context;
  audio.master = context.createGain();
  audio.scatter = 0;
  audio.needleWidth = 0;
  const paintAt = (key, pose) => {
    const normal = needleNormalAt(IDENTITY_ORIENTATION, 0, 3.5, 0, pose);
    return { ...motorZone(key, 0), normal, ...coordinatesOf(normal) };
  };
  audio.setRibbons([
    paintAt(31, rollPlayPose(IDENTITY_ORIENTATION, 45, 0, radius)),
    paintAt(32, rollPlayPose(IDENTITY_ORIENTATION, 0, 45, radius)),
  ]);
  audio.setEnabled(true);
  audio.scratch(0, true);
  assert.deepEqual(hits, []);
  const right = rollPlayPose(IDENTITY_ORIENTATION, 90, 0, radius);
  audio.scratchRoll(IDENTITY_ORIENTATION, 90, 0, radius, 0);
  assert.deepEqual(hits, [31], "sideways rolling reads the intermediate lateral grain");
  assert.equal(context.sources.length, 1);
  audio.scratchRoll(right, -90, 0, radius, 0);
  assert.deepEqual(hits, [31, 31], "rolling back re-enters the zone");
  audio.scratchRoll(IDENTITY_ORIENTATION, 0, 90, radius, 0);
  assert.deepEqual(hits, [31, 31, 32], "a downward roll reaches a different meridian");
  assert.equal(audio.enabled, true);
  assert.equal(audio.playing, false);
});

test("silent transport, reverse direction and deterministic Home never create or arm an AudioContext", async () => {
  const audio = new GlobuleAudio();
  audio.transport(true, .25);
  assert.equal(audio.enabled, false);
  assert.equal(audio.context, null);
  audio.setControls({ phase: .25, direction: -1, speed: 2, scatter: .9 });
  audio.seek(0, true);
  assert.equal(audio.phase(), 0);
  assert.equal(audio.step, 0);
  await audio.close();
});
