import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PugglerAudio, sonicMotion, punkMotion, punkVocalMotion, vocalPerformer, MAX_PUGGLER_ATTACKS, MAX_PUGGLER_VOICES, MAX_PUGGLER_AIR_TAILS } from '../src/puggler-audio.js';
import { VOCAL_CHARACTERS, vocalCharacter } from '../src/puggler-vocals.js';
import { PUNK_DRUMS, PUNK_RIFFS, renderPunkPhrase, renderVocalChant } from '../src/puggler-samples.js';
import { PROPS, WORLD } from '../src/puggler.js';

const object = (id, phase = 'air') => ({ id, phase, prop: PROPS[id % PROPS.length], drum: PUNK_DRUMS[id % PUNK_DRUMS.length], riff: PUNK_RIFFS[id % PUNK_RIFFS.length], x: 60 + id * 90, y: WORLD.handY + 200, vx: 90, vy: 420, spinRate: 3 });
class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, t) { this.value = value; this.events.push(['set', value, t]); }
  setTargetAtTime(value, t) { this.value = value; this.events.push(['target', value, t]); }
  linearRampToValueAtTime(value, t) { this.value = value; this.events.push(['ramp', value, t]); }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); }
}
class Node {
  constructor() {
    for (const key of ['gain', 'frequency', 'Q', 'playbackRate', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[key] = new Param();
    this.connections = []; this.starts = []; this.stops = [];
  }
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; this.connections = []; }
  start(t, offset) { this.starts.push({ t, offset }); }
  stop(t) { this.stops.push(t); }
}
class Context {
  constructor() { this.currentTime = 1; this.state = 'suspended'; this.destination = new Node(); this.nodes = []; }
  createGain() { const n = new Node(); this.nodes.push(n); return n; }
  createDynamicsCompressor() { return this.createGain(); }
  createWaveShaper() { return this.createGain(); }
  createBiquadFilter() { return this.createGain(); }
  createStereoPanner() { return this.createGain(); }
  createBufferSource() { const n = this.createGain(); n.kind = 'sample'; return n; }
  createBuffer(channels, length, rate) {
    const data = new Float32Array(length);
    return { duration: length / rate, sampleRate: rate, length, getChannelData() { return data; }, copyToChannel(samples) { data.set(samples); } };
  }
  async decodeAudioData() { return this.createBuffer(1, 39690, 22050); }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
async function withAudio(run) {
  const originalContext = globalThis.AudioContext, originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.AudioContext = Context;
  globalThis.fetch = async url => { urls.push(String(url)); return { ok: true, async arrayBuffer() { return new ArrayBuffer(2); } }; };
  const audio = new PugglerAudio();
  try { await run(audio, urls); } finally { await audio.close(); globalThis.AudioContext = originalContext; globalThis.fetch = originalFetch; }
}
const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);

test('vocal identity follows stable performer IDs, including passes, rescues and audience returns', () => {
  assert.equal(vocalPerformer({phase:'air',owner:2,fromOwner:1}),1);
  assert.equal(vocalPerformer({phase:'air',owner:2,fromOwner:1,voiceOwner:2}),2);
  assert.equal(vocalPerformer({phase:'audience',owner:2,fromOwner:1}),2);
  assert.equal(vocalPerformer({phase:'replacement',owner:1,fromOwner:0}),1);
  assert.equal(vocalPerformer({phase:'air',owner:2,voiceOwner:99}),2);
  assert.equal(vocalPerformer({owner:NaN,fromOwner:Infinity}),0);
});

test('all nine characters select their own cached OI and WOO buffers while crowd recordings stay unchanged', async () => withAudio(async audio => {
  await audio.arm();
  assert.equal(Object.keys(audio.vocalBuffers).length,18);
  const bank=audio.vocalBuffers;
  for(const character of VOCAL_CHARACTERS)for(const role of ['oi','woo']){
    const prop={...object(0),riff:role,owner:(character.owner+1)%3,voiceOwner:character.owner};
    audio.update([prop],{skin:character.skin},true);
    const voice=audio.voices[0];
    assert.equal(voice.character,character.id);assert.equal(voice.speaker,character.owner);
    assert.equal(voice.source.buffer,bank[`${character.id}:${role}`]);
    const source=voice.source;
    audio.context.currentTime+=.03;audio.update([prop],{skin:character.skin},true);
    assert.equal(audio.voices[0].source,source,'steady flight retains its source');
  }
  assert.equal(audio.vocalBuffers,bank,'live skin and cast changes reuse the bank');
  audio.strike({...object(0),kind:'crowd-woo'},{},audio.context.currentTime);
  assert.equal([...audio.attacks].at(-1).source.buffer,audio.buffers.woo);
  await audio.close();assert.equal(audio.vocalBuffers,null);
}));

test('era and performer handoffs crossfade instruments and vocals at relative phrase position', async () => withAudio(async audio => {
  await audio.arm();
  const objects=[{...object(0),riff:'oi',owner:2,voiceOwner:1},object(4)];
  audio.update(objects,{skin:'punk'},true);
  const old=audio.voices[0],guitar=audio.voices[4];
  audio.context.currentTime+=.32;
  audio.update(objects,{skin:'future'},true);
  const next=audio.voices[0],position=audio.phrasePositions[0];
  assert.equal(next.character,vocalCharacter('future',1).id);
  assert.notEqual(next.source,old.source);assert.ok(old.source.stops.length);
  assert.ok(audio.airTails.has(old));assert.notEqual(audio.voices[4],guitar);
  assert.ok(audio.airTails.has(guitar));assert.equal(audio.voices[4].key,'future:0:guitar');
  assert.ok(Math.abs(audio.voices[4].offset/audio.voices[4].source.buffer.duration-audio.phrasePositions[4].offset/audio.phrasePositions[4].duration)<1e-12);
  assert.ok(Math.abs(next.offset/next.source.buffer.duration-position.offset/position.duration)<1e-12);
  assert.ok(next.offset>0,'changing character does not restart the word');
  audio.update([{...objects[0],phase:'held'},objects[1]],{skin:'future'},true);
  const cursor=audio.phrasePositions[0];audio.context.currentTime+=.2;
  objects[0].voiceOwner=2;objects[0].owner=1;
  audio.update(objects,{skin:'future'},true);
  const receiver=audio.voices[0];
  assert.equal(receiver.character,vocalCharacter('future',2).id);
  assert.ok(Math.abs(receiver.offset/receiver.source.buffer.duration-cursor.offset/cursor.duration)<1e-12);
  for(let i=0;i<80;i++){
    objects[0].voiceOwner=i%3;audio.update(objects,{skin:i%2?'history':'future'},true);
  }
  assert.ok(audio.airTails.size<=MAX_PUGGLER_AIR_TAILS);
}));

test('authored punk phrases are deterministic, bounded, articulate, and spectrally distinct', () => {
  const parts = Object.fromEntries(['guitar', 'bass'].map(role => [role, renderPunkPhrase(role)]));
  for (const [role, data] of Object.entries(parts)) {
    assert.deepEqual(data, renderPunkPhrase(role));
    assert.ok(data.every(Number.isFinite));
    assert.ok(rms(data) > .05);
    assert.ok(data.every(x => Math.abs(x) <= .901));
    assert.equal(Math.abs(data[0]), 0); assert.equal(Math.abs(data.at(-1)), 0);
    assert.ok(rms(data.slice(-1500)) < rms(data.slice(1000, 4000)) * .3, `${role} closes its phrase with a rest`);
  }
  const roughness = data => rms(data.slice(1).map((value, i) => value - data[i]));
  assert.ok(roughness(parts.guitar) > roughness(parts.bass) * 1.8, 'guitar is brighter than the bass');
  assert.notDeepEqual(parts.guitar, parts.bass);
});

test('world position, speed, tempo, and height mapping alter bounded playback parameters', () => {
  const o = object(0), base = punkMotion(o, { tempo: 200 });
  assert.ok(punkMotion({ ...o, y: o.y + 300 }, { tempo: 200 }).rate > base.rate);
  assert.ok(punkMotion(o, { tempo: 400 }).rate > base.rate);
  assert.ok(punkMotion({ ...o, vy: 1500 }, {}).tone > punkMotion({ ...o, vy: 0 }, {}).tone);
  assert.ok(punkMotion({ ...o, x: 900 }).pan > punkMotion({ ...o, x: 100 }).pan);
  const malformed = punkMotion({ x: NaN, y: Infinity, vx: NaN, vy: -Infinity }, { tempo: Infinity, motion: NaN, height: NaN });
  assert.ok(Object.values(malformed).every(Number.isFinite));
  assert.ok(malformed.rate >= .3 && malformed.rate <= 6.8);
  const fast = [600, 900, 1200].map(tempo => punkMotion(o, { tempo }).rate);
  assert.ok(fast[0] < fast[1] && fast[1] < fast[2], 'upper tempos remain distinct');
  assert.ok(punkMotion({ ...o, y: o.y + 250 }, { tempo: 1200 }).rate > fast[2], 'height still modulates the fastest tempo');
});

test('bundled drums and crowd are short finite non-silent PCM recordings', async () => {
  for (const id of [...PUNK_DRUMS, 'oi', 'woo', 'boo']) {
    const file = await readFile(new URL(`../assets/puggler/${id}.wav`, import.meta.url));
    assert.equal(file.toString('ascii', 0, 4), 'RIFF');
    assert.equal(file.readUInt16LE(20), 1); assert.equal(file.readUInt16LE(22), 1);
    assert.equal(file.readUInt32LE(24), 22050); assert.equal(file.readUInt16LE(34), 16);
    assert.ok(file.length < 90000);
    let energy = 0;
    for (let i = 44; i < file.length; i += 2) energy += (file.readInt16LE(i) / 32768) ** 2;
    assert.ok(energy > 1, `${id} must contain an actual audible waveform`);
  }
});

test('the OI phrase keeps three complete recorded calls and clear pauses', async () => {
  const file = await readFile(new URL('../assets/puggler/oi.wav', import.meta.url));
  const pcm = Float32Array.from({ length: (file.length - 44) / 2 }, (_, i) => file.readInt16LE(44 + i * 2) / 32768);
  const chant = renderVocalChant(pcm, 22050);
  assert.ok(rms(pcm) > .03); assert.ok(chant.every(Number.isFinite));
  for (const [call, level] of [.92, 1, .86].entries()) {
    const start = Math.round(call * .6 * 22050);
    for (let i = 0; i < pcm.length; i++) assert.ok(Math.abs(chant[start + i] - pcm[i] * level) < .000001);
    const pause = chant.slice(start + pcm.length, Math.round((call + 1) * .6 * 22050));
    assert.ok(pause.length > 2000); assert.equal(rms(pause), 0);
  }
});

test('vocal motion preserves the recorded register even at extreme tempos and uses a clean voice path', async () => withAudio(async audio => {
  const o = object(2);
  const slow = punkVocalMotion(o, { tempo: 300 }), fast = punkVocalMotion(o, { tempo: 1200 });
  assert.ok(fast.rate > slow.rate && fast.rate / slow.rate < 1.1);
  assert.ok(punkVocalMotion({ ...o, y: o.y + 300 }, { tempo: 300 }).rate > slow.rate);
  for (const tempo of [60, 240, 600, 1200]) {
    const extreme = punkVocalMotion({ ...o, y: 20000, vx: -5000 }, { tempo, height: 2, motion: 12 });
    assert.ok(extreme.rate >= .84 && extreme.rate <= 1.2);
  }
  await audio.arm(); audio.update([object(0), object(2), object(3)], { tempo: 1200, grit: 1 }, true);
  assert.ok(audio.voices[0].drive);
  for (const id of [2, 3]) {
    const v = audio.voices[id]; assert.equal(v.drive, null); assert.equal(v.dirt, null);
    assert.equal(v.pan.connections[0], audio.vocalBus);
    assert.ok(v.source.playbackRate.value >= .84 && v.source.playbackRate.value <= 1.2);
    assert.ok(v.filter.frequency.value >= 5800);
  }
}));

test('transport and strikes stay silent until explicitly armed; arm loads only local assets once', async () => withAudio(async (audio, urls) => {
  audio.update([object(0)], {}, true); audio.strike({ ...object(0), kind: 'catch' }, {}, 0); audio.mute();
  assert.equal(audio.context, null); assert.equal(urls.length, 0);
  await audio.arm(); assert.equal(audio.on, true); assert.equal(urls.length, 8);
  assert.ok(urls.every(url => url.includes('/assets/puggler/') && url.endsWith('.wav')));
  await audio.arm(); assert.equal(urls.length, 8);
}));

test('only airborne, replacement, or outbound audience objects own riff loops', async () => withAudio(async audio => {
  await audio.arm();
  audio.update([object(0), object(1, 'held'), object(2, 'replacement'), object(3, 'floor')], {}, true);
  assert.deepEqual(audio.voices.map(v => v?.role ?? null), ['guitar', null, 'oi', null, null, null, null, null, null, null]);
  const previous = audio.voices[0];
  audio.update([{ ...object(0), riff: 'woo' }, object(1, 'held'), object(2, 'held')], {}, true);
  assert.equal(audio.voices[0].role, 'woo'); assert.ok(previous.source.stops.length);
  assert.equal(audio.voices[2], null);
  audio.update([], {}, false);
  assert.equal(audio.voices.filter(Boolean).length, 0); assert.ok(audio.master.gain.value > 0, 'paused room remains armed for crowd audio');
}));

test('ten objects get independent voices, cyclic defaults, and bounded maximum-level gain', async () => withAudio(async audio => {
  await audio.arm();
  const objects = Array.from({ length: 12 }, (_, i) => ({ ...object(i, i === 9 ? 'audience' : 'air'), riff: undefined }));
  audio.update(objects, { tempo: 1200, level: 1, flight: 1 }, true);
  assert.equal(audio.voices.filter(Boolean).length, MAX_PUGGLER_VOICES);
  assert.deepEqual(audio.voices.map(v => v.role), ['guitar', 'bass', 'oi', 'woo', 'guitar', 'bass', 'oi', 'woo', 'guitar', 'bass']);
  assert.equal(new Set(audio.voices.map(v => v.source)).size, MAX_PUGGLER_VOICES);
  assert.equal(audio.master.gain.value, .9);
  const retained = audio.voices[3];
  objects[8].riff = 'woo'; objects[9].phase = 'held';
  audio.update(objects, { tempo: 1200 }, true);
  assert.equal(audio.voices[8].role, 'woo'); assert.equal(audio.voices[9], null);
  assert.equal(audio.voices[3], retained);
}));

test('catch hits selected recorded drum, drop only boos, throws do not invent drum attacks', async () => withAudio(async audio => {
  await audio.arm();
  for (const drum of PUNK_DRUMS) audio.strike({ ...object(0), drum, kind: 'catch' }, {}, audio.context.currentTime);
  assert.deepEqual([...audio.attacks].map(v => v.role), PUNK_DRUMS);
  audio.strike({ ...object(1), kind: 'drop' }, {}, audio.context.currentTime);
  assert.equal([...audio.attacks].at(-1).role, 'boo');
  const total = audio.attacks.size;
  for (const kind of ['throw', 'replacement', 'recover', 'audience-throw']) audio.strike({ ...object(1), kind }, {}, audio.context.currentTime);
  assert.equal(audio.attacks.size, total);
  audio.strike({ ...object(0), kind: 'catch' }, {}, audio.context.currentTime - 1);
  audio.strike({ ...object(0), kind: 'catch' }, {}, audio.context.currentTime + 1);
  assert.equal(audio.attacks.size, total);
}));

test('catch events gate their own riff when the held state falls between polls, even with drums muted', async () => withAudio(async audio => {
  await audio.arm();
  const objects = Array.from({ length: 10 }, (_, i) => object(i));
  audio.update(objects, { tempo: 1200 }, true);
  audio.context.currentTime += .1;
  const previous = audio.voices[8], unaffected = audio.voices[7], when = audio.context.currentTime + .006;
  audio.strike({ ...objects[8], kind: 'catch' }, { impacts: 0 }, when);
  assert.equal(audio.voices[8], null); assert.equal(audio.voices[7], unaffected);
  assert.equal(audio.attacks.size, 0);
  assert.ok(previous.source.stops[0] >= when);
  audio.update(objects, { tempo: 1200 }, true);
  assert.notEqual(audio.voices[8], previous);
  assert.ok(audio.voices[8].source.starts[0].t >= when + .018);
  assert.equal(audio.voices[8].source.starts[0].offset, audio.phrasePositions[8].offset);
}));

test('crowd catches close the outbound riff and accent the assigned/default drum', async () => withAudio(async audio => {
  await audio.arm(); audio.update([object(9, 'audience')], {}, true);
  const previous = audio.voices[9]; assert.equal(previous.role, 'bass');
  audio.strike({ ...object(9), kind: 'crowd-catch', drum: undefined }, {}, audio.context.currentTime);
  assert.equal(audio.voices[9], null); assert.ok(previous.source.stops.length);
  assert.equal([...audio.attacks].at(-1).role, 'hat');
}));

test('audible catches briefly duck other riffs and route stronger transients around the riff compressor', async () => withAudio(async audio => {
  await audio.arm(); audio.update([object(0), object(1)], { level: 1 }, true);
  assert.equal(audio.voices[1].pan.connections[0], audio.airBus);
  assert.equal(audio.drumBus.connections[0], audio.bus);
  const when = audio.context.currentTime + .01;
  audio.strike({ ...object(0), kind: 'catch' }, { impacts: 1.25 }, when);
  const events = audio.airDuck.gain.events;
  assert.ok(events.some(([kind, value, t]) => kind === 'ramp' && value < .3 && t === when + .002));
  assert.ok(events.some(([kind, value, t]) => kind === 'ramp' && value === 1 && t === when + .045));
  const hit = [...audio.attacks].at(-1);
  assert.equal(hit.pan.connections[0], audio.drumBus);
  const attack = hit.gain.gain.events.find(([kind]) => kind === 'ramp')[1];
  const body = hit.gain.gain.events.find(([kind, , t]) => kind === 'ramp' && t === when + .042)[1];
  assert.ok(attack > body * 1.3);
  assert.ok(audio.voices[1], 'ducking preserves the other live riff source');
  audio.update([], {}, false);
  assert.equal(audio.ducking, false); assert.equal(audio.airDuck.gain.value, 1);
}));

test('unarmed, muted, zero-impact catches and audience boos never duck the other riffs', async () => withAudio(async audio => {
  audio.strike({ ...object(0), kind: 'catch' }, { impacts: 2 }, 1);
  assert.equal(audio.airDuck, undefined);
  await audio.arm();
  audio.strike({ ...object(0), kind: 'catch' }, { impacts: 0 }, audio.context.currentTime);
  audio.strike({ ...object(0), kind: 'drop' }, { boo: 1 }, audio.context.currentTime);
  assert.equal(audio.airDuck.gain.events.length, 0);
  audio.mute();
  audio.strike({ ...object(0), kind: 'catch' }, { impacts: 2 }, audio.context.currentTime);
  assert.equal(audio.airDuck.gain.events.length, 0);
}));

test('the impact control reaches two with a bounded duck depth and unchanged output ceiling', async () => withAudio(async audio => {
  await audio.arm(); audio.update([], { level: 1 }, true);
  for (const impacts of [1, 2, 100]) audio.strike({ ...object(0), kind: 'catch' }, { impacts }, audio.context.currentTime);
  const peaks = [...audio.attacks].map(v => v.gain.gain.events.find(([kind]) => kind === 'ramp')[1]);
  assert.equal(peaks[1], peaks[0] * 2); assert.equal(peaks[2], peaks[1]);
  assert.ok(audio.airDuck.gain.events.filter(([kind]) => ['set', 'ramp'].includes(kind)).every(([, value]) => value >= 1 / 5.4 && value <= 1));
  assert.equal(audio.master.gain.value, .9);
  assert.deepEqual([...audio.peakGuard.curve], [-1, 1]);
  await audio.close();
  assert.ok([audio.airBus, audio.airDuck, audio.drumBus, audio.peakGuard].every(node => node.disconnected));
}));

test('juggling pause releases riffs while preserving catch tails and model-triggered crowd voices', async () => withAudio(async audio => {
  await audio.arm(); audio.update([object(0), object(2)], { level: .6 }, true);
  audio.strike({ ...object(1), kind: 'catch' }, {}, audio.context.currentTime);
  const catchTail = [...audio.attacks][0];
  audio.update([object(0), object(2)], { level: .6 }, false);
  assert.equal(audio.voices.filter(Boolean).length, 0); assert.equal(audio.master.gain.value, .54);
  assert.equal(catchTail.releasing, undefined);
  for (const kind of ['crowd-woo', 'crowd-boo']) audio.strike({ ...object(1), kind }, {}, audio.context.currentTime);
  assert.deepEqual([...audio.attacks].map(v => v.role), ['snare', 'woo', 'boo']);
  audio.update([], { level: .6 }, false);
  assert.ok([...audio.attacks].every(v => !v.releasing));
  assert.ok([...audio.attacks].slice(1).every(v => v.pan.connections[0] === audio.bus));
  audio.mute(); assert.equal(audio.master.gain.value, 0);
  assert.ok([...audio.attacks].every(v => v.releasing));
}));

test('hidden active=false and zero level silence/release the entire room and reject crowd attacks', async () => withAudio(async audio => {
  await audio.arm(); audio.update([], { level: .6 }, false);
  audio.strike({ ...object(1), kind: 'crowd-woo' }, {}, audio.context.currentTime);
  const first = [...audio.attacks][0];
  audio.update([], { level: .6, active: false }, false);
  assert.equal(audio.master.gain.value, 0); assert.equal(first.releasing, true);
  audio.strike({ ...object(1), kind: 'crowd-boo' }, {}, audio.context.currentTime);
  assert.equal(audio.attacks.size, 1);
  audio.update([], { level: 0, active: true }, false);
  audio.strike({ ...object(1), kind: 'crowd-boo' }, {}, audio.context.currentTime);
  assert.equal(audio.attacks.size, 1); assert.equal(audio.master.gain.value, 0);
  audio.update([], { level: .6, active: true }, false);
  audio.strike({ ...object(1), kind: 'crowd-boo' }, {}, audio.context.currentTime);
  assert.equal(audio.attacks.size, 2); assert.equal(audio.master.gain.value, .54);
}));

test('short tosses continue their riff phrase; holding an object pauses its sample cursor', async () => withAudio(async audio => {
  await audio.arm(); audio.update([object(0)], {}, true);
  audio.context.currentTime += .3;
  audio.update([object(0, 'held')], {}, true);
  const cursor = audio.phrasePositions[0].offset;
  assert.ok(cursor > .15);
  audio.context.currentTime += 2;
  audio.update([object(0)], {}, true);
  assert.equal(audio.voices[0].source.starts[0].offset, cursor);
}));

test('fast catch storms remain bounded and mute/close stop and disconnect all sources', async () => withAudio(async audio => {
  await audio.arm();
  const objects = Array.from({ length: 10 }, (_, i) => object(i));
  audio.update(objects, { tempo: 1200, level: 1 }, true);
  for (let i = 0; i < 400; i++) {
    audio.strike({ ...object(i % 10), kind: i % 8 ? 'catch' : 'drop' }, {}, audio.context.currentTime);
    audio.update(objects, { tempo: 1200, level: 1 }, true);
  }
  assert.ok(audio.attacks.size <= MAX_PUGGLER_ATTACKS);
  assert.ok(audio.airTails.size <= MAX_PUGGLER_AIR_TAILS);
  audio.mute(); assert.equal(audio.on, false); assert.equal(audio.voices.filter(Boolean).length, 0);
  assert.ok([...audio.attacks, ...audio.airTails].every(v => v.source.stops.length > 0));
  await audio.close();
  assert.equal(audio.context.state, 'closed'); assert.equal(audio.attacks.size, 0); assert.equal(audio.airTails.size, 0);
  assert.ok(audio.context.nodes.filter(n => n.kind === 'sample').every(n => n.disconnected));
}));


test('era banks cover each performer and drum without new fetches or live regeneration', async () => withAudio(async (audio, urls) => {
  await audio.arm(); assert.equal(urls.length, 8);
  const bank = audio.eraBuffers; assert.equal(Object.keys(bank).length, 22);
  for (const skin of ['history', 'future']) {
    for (let owner = 0; owner < 3; owner++) for (const role of ['guitar', 'bass']) {
      const prop = { ...object(0), riff: role, owner: (owner + 1) % 3, fromOwner: owner };
      audio.update([prop], { skin }, true);
      const voice = audio.voices[0];
      assert.equal(voice.key, `${skin}:${owner}:${role}`);
      assert.equal(voice.speaker, owner, 'passing instrument stays with its thrower');
      assert.equal(voice.source.buffer, bank[voice.key]);
      assert.equal(voice.character, null);
      assert.equal(voice.drive === null, skin === 'history', 'acoustic plucks bypass overdrive');
      assert.ok(voice.pan.connections.includes(skin === 'history' ? audio.vocalBus : audio.airBus));
      audio.update([prop], { skin, tempo:1200 }, true);
      assert.equal(audio.voices[0], voice);
    }
    for (const drum of PUNK_DRUMS) {
      audio.strike({ ...object(1), kind:'catch', drum }, { skin });
      const hit = [...audio.attacks].at(-1);
      assert.equal(hit.source.buffer, bank[`${skin}:${drum}`]);
      assert.ok(hit.pan.connections.includes(audio.drumBus), 'era hits retain the punchy impact route');
    }
  }
  audio.update([{...object(0),voiceOwner:0}], {skin:'punk'}, true);
  const punk = audio.voices[0];
  audio.update([{...object(0),voiceOwner:2}], {skin:'unknown'}, true);
  assert.equal(audio.voices[0], punk, 'original punk guitar stays common to its performers');
  assert.equal(audio.eraBuffers, bank); assert.equal(urls.length, 8);
  await audio.close(); assert.equal(audio.eraBuffers, null);
}));

test('era motion keeps spatial control, register and tempo sensitivity bounded', () => {
  const prop=object(0);
  for (const skin of ['history','future']) for (const role of PUNK_RIFFS) {
    const base=sonicMotion(prop,{skin,tempo:240},role);
    const high=sonicMotion({...prop,y:prop.y+300},{skin,tempo:240},role);
    const fast=sonicMotion(prop,{skin,tempo:1200},role);
    assert.ok(high.rate>base.rate); assert.ok(fast.rate>base.rate);
    assert.ok(sonicMotion({...prop,x:900},{skin},role).pan>sonicMotion({...prop,x:100},{skin},role).pan);
    const broken=sonicMotion({x:NaN,y:Infinity,vx:NaN,vy:-Infinity},{skin,tempo:Infinity,height:NaN,grit:NaN},role);
    assert.ok(Object.values(broken).every(Number.isFinite));
    for (const tempo of [60,240,600,1200]) {
      const extreme=sonicMotion({...prop,y:20000,vx:-5000,vy:8000},{skin,tempo,height:2,grit:1,motion:12},role);
      assert.ok(extreme.rate>=.3&&extreme.rate<=5);
      assert.ok(extreme.tone>=650&&extreme.tone<=10000);
      assert.ok(extreme.resonance<=2);
      if (['oi','woo'].includes(role)) assert.ok(extreme.rate>=.84&&extreme.rate<=1.2);
    }
  }
  const {resonance,...punk}=sonicMotion(prop,{skin:'punk'},'guitar');
  assert.deepEqual(punk,punkMotion(prop)); assert.equal(resonance,.55);
});


test('high-rate device decoding retains all three complete OI calls and their duration', () => {
  // decodeAudioData returns PCM at the context rate; assembly must use that
  // same clock, otherwise a 192 kHz device cuts every word and halves the bar.
  const rate=192000,source=Float32Array.from({length:Math.round(rate*.45)},(_,i)=>.3*Math.sin(i*2*Math.PI*220/rate));
  const chant=renderVocalChant(source,rate);
  assert.equal(chant.length/rate,1.8);
  for (const [index,level] of [.92,1,.86].entries()) {
    const at=Math.round(index*.6*rate);
    assert.ok(rms(chant.slice(at+rate*.35,at+rate*.44))>.1,'the end of each word survives');
    assert.equal(rms(chant.slice(at+rate*.45,at+rate*.6)),0,'calls retain their silence');
    assert.ok(Math.abs(rms(chant.slice(at,at+source.length))/rms(source)-level)<1e-6);
  }
});
