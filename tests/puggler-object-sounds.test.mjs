import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decodePcmWav } from '../src/pcm-wav-decoder.js';
import { PROPS } from '../src/instruments/puggler/puggler.js';
import { OBJECT_SOUND_PROFILES, OBJECT_SOUND_RATE, renderObjectSound, prepareObjectSoundData, objectSoundId, objectSoundKey } from '../src/instruments/puggler/puggler-object-sounds.js';
const clips=Object.fromEntries(['kick','snare','crash','tom','hat','oi','woo','boo','mic-check','count-in'].map(id=>{const wave=decodePcmWav(readFileSync(new URL(`../assets/puggler/${id}.wav`,import.meta.url)));return [id,{data:wave.samples,rate:wave.sampleRate}];}));
const hash=data=>createHash('sha256').update(new Uint8Array(data.buffer)).digest('hex');

test('all 99 prop/era voices have unique deterministic, finite, bounded air and catch samples',async()=>{
  const bank=await prepareObjectSoundData(clips);assert.equal(bank,await prepareObjectSoundData(clips));assert.equal(Object.keys(bank).length,198);
  const hashes=new Set(),features=new Map();let bytes=0;
  for(const skin of ['punk','history','future']){
    assert.equal(Object.keys(OBJECT_SOUND_PROFILES[skin]).length,PROPS.length);
    assert.ok(new Set(Object.values(OBJECT_SOUND_PROFILES[skin]).map(p=>p.family)).size>=7);
    for(const prop of PROPS)for(const kind of ['air','catch']){
      const data=bank[objectSoundKey(skin,prop.id,kind)];bytes+=data.byteLength;
      const digest=hash(data);hashes.add(digest);assert.equal(hash(renderObjectSound(skin,prop.id,kind,OBJECT_SOUND_RATE,clips)),digest);
      let sum=0,peak=0,difference=0;
      for(let i=0;i<data.length;i++){assert.ok(Number.isFinite(data[i]));sum+=data[i]**2;peak=Math.max(peak,Math.abs(data[i]));if(i)difference+=(data[i]-data[i-1])**2;}
      const rms=Math.sqrt(sum/data.length);assert.ok(rms>.035&&rms<=.201);assert.ok(peak<=.721);
      assert.equal(Math.abs(data[0]),0);assert.equal(Math.abs(data.at(-1)),0);
      // Envelope shape is level-independent; families are not merely transposed copies.
      const energies=Array.from({length:4},(_,j)=>{let e=0;for(let i=Math.floor(j*data.length/4);i<Math.floor((j+1)*data.length/4);i++)e+=data[i]**2;return (e/sum).toFixed(2);});
      if(kind==='air')features.set(`${skin}:${prop.id}`,{envelope:energies.join(),roughness:Math.sqrt(difference/sum)});
    }
  }
  assert.equal(hashes.size,198);assert.ok(bytes<16*1024*1024);
  for(const skin of ['punk','history','future']){
    const f=[...features].filter(([key])=>key.startsWith(skin)).map(([,value])=>value);
    assert.ok(new Set(f.map(v=>v.envelope)).size>=12,`${skin}: diverse articulation`);
    assert.ok(Math.max(...f.map(v=>v.roughness))/Math.min(...f.map(v=>v.roughness))>2,`${skin}: diverse spectrum`);
  }
  assert.equal(OBJECT_SOUND_RATE,22050);
});
test('automatic voice follows prop identity while explicit assignments and legacy sounds remain distinct',()=>{
  for(const prop of PROPS){assert.equal(objectSoundId('object',prop.id),prop.id);assert.equal(objectSoundId('object:bell',prop.id),'bell');}
  for(const choice of ['guitar','bass','oi','woo','kick','snare',null,'object:missing'])assert.equal(objectSoundId(choice,'ball'),null);
});

test('punk uses strings/recorded percussion and history uses acoustic or human-voice colors, reserving synthetic families for future',()=>{
  const synthFamilies=['gizzle','laser','ether','alien','packet','ring','beep','sub'];
  for(const skin of ['punk','history'])for(const p of Object.values(OBJECT_SOUND_PROFILES[skin]))assert.ok(!synthFamilies.includes(p.family),p.name);
  for(const f of ['guitar','bass','shred','ebow','whammy','snare','kick','tom','cymbal','tambourine','stomp','shout','scream','speech','count-in','glass','clatter'])assert.ok(Object.values(OBJECT_SOUND_PROFILES.punk).some(p=>p.family===f),f);
  for(const f of ['zither','sitar','tabla','gong','gamelan','harpsichord','piano','harp','violin','opera','tuba','trombone','flute','oboe','whistle','chant','cak','laughter','grunt'])assert.ok(Object.values(OBJECT_SOUND_PROFILES.history).some(p=>p.family===f),f);
});
test('real kit and voice recordings actually contribute to their assigned object timbres',()=>{
  for(const [skin,id] of [['punk','can'],['punk','boot'],['punk','plushrat'],['punk','mic'],['history','skull'],['history','deadcat'],['future','fish']]){
    assert.notEqual(hash(renderObjectSound(skin,id,'air',OBJECT_SOUND_RATE,clips)),hash(renderObjectSound(skin,id,'air')),`${skin}/${id}`);
  }
});

test('note-window calibration uses a bounded precomputed energy table and does not boost silence',async()=>{
  const {voiceWindowLevels,voiceWindowGain}=await import('../src/instruments/puggler/puggler-voice-dsp.js');
  const rate=22050,quiet=Float32Array.from({length:rate},(_,i)=>.1*Math.sin(i*.4)),loud=quiet.map(v=>v*3);
  const a=voiceWindowLevels(quiet,rate),b=voiceWindowLevels(loud,rate);
  assert.ok(a.energy.byteLength<quiet.byteLength/20);
  assert.ok(voiceWindowGain(a,.2)>voiceWindowGain(b,.2));
  assert.equal(voiceWindowGain(voiceWindowLevels(new Float32Array(rate),rate),.2),1);
  for(const seconds of [.001,.01,.1,.3,2]){const gain=voiceWindowGain(a,seconds);assert.ok(gain>=.45&&gain<=2.4);}
});
