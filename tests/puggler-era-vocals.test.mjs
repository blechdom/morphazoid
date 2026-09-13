import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderEraVocal, ERA_VOCAL_PROFILES } from '../src/puggler-era-vocals.js';
import { VOCAL_CHARACTERS, renderCharacterVocal } from '../src/puggler-vocals.js';
import { renderVocalChant } from '../src/puggler-samples.js';
import { decodePcmWav } from '../src/pcm-wav-decoder.js';

const rms = data => Math.sqrt(data.reduce((sum, x) => sum + x*x, 0) / Math.max(1, data.length));
const peak = data => data.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
const characters = VOCAL_CHARACTERS.filter(p => p.skin !== 'punk');
const decoded = Object.fromEntries(['oi', 'woo'].map(role => [role,
  decodePcmWav(readFileSync(new URL(`../assets/puggler/${role}.wav`, import.meta.url))),
]));
const source = { oi: renderVocalChant(decoded.oi.samples, decoded.oi.sampleRate), woo: decoded.woo.samples };
const clips = Object.fromEntries(Object.entries(source).map(([role, input]) => [role,
  characters.map(p => renderEraVocal(input, decoded[role].sampleRate, p, role)),
]));
const at = (data, position) => {
  const i = Math.floor(position), f = position - i;
  return (data[i] ?? 0) * (1-f) + (data[i+1] ?? 0) * f;
};
function correlation(a, b) {
  let aa=0, bb=0, ab=0;
  for(let i=0;i<a.length;i++){ aa+=a[i]*a[i]; bb+=b[i]*b[i]; ab+=a[i]*b[i]; }
  return ab/Math.sqrt(Math.max(1e-20,aa*bb));
}
function crossings(data, rate, start, end) {
  let count=0;
  for(let i=Math.round(start*rate)+1;i<Math.round(end*rate);i++) if(data[i-1]<=0&&data[i]>0)count++;
  return count/(end-start);
}

test('six era identities are immutable and punk rendering is exactly unchanged', () => {
  assert.equal(ERA_VOCAL_PROFILES.length, 6);
  assert.deepEqual(new Set(ERA_VOCAL_PROFILES.map(p=>p.id)),new Set(characters.map(p=>p.id)));
  assert.ok(Object.isFrozen(ERA_VOCAL_PROFILES));
  for(const p of ERA_VOCAL_PROFILES){ assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.notes)); }
  for(const p of VOCAL_CHARACTERS.filter(p=>p.skin==='punk')) {
    assert.deepEqual(renderEraVocal(source.oi,decoded.oi.sampleRate,p,'oi'),renderCharacterVocal(source.oi,decoded.oi.sampleRate,p));
  }
});

test('actual OI and WOO recordings render useful finite phrases with clean boundaries', () => {
  for(const role of ['oi','woo']) for(const [index,p] of characters.entries()) {
    const input=source[role], before=input.slice(), rate=decoded[role].sampleRate;
    const output=renderEraVocal(input,rate,p,role);
    assert.ok(output instanceof Float32Array);
    assert.notEqual(output,input);
    assert.ok(output.length/rate>1.8&&output.length/rate<2.25,`${p.id}/${role}: bounded phrase length`);
    assert.ok(output.every(Number.isFinite));
    assert.ok(peak(output)<=.88,`${p.id}/${role}: raw peak`);
    assert.ok(rms(output)>=.10&&rms(output)<=.181,`${p.id}/${role}: useful RMS ${rms(output)}`);
    assert.equal(Math.abs(output[0]),0);
    assert.equal(Math.abs(output.at(-1)),0);
    assert.ok(rms(output.subarray(-Math.round(rate*.015)))<.00001,'reflections settle before the boundary');
    assert.deepEqual(input,before);
    assert.deepEqual(output,clips[role][index],'renders are deterministic');
  }
});

test('all three recorded OI calls retain their order, energy and separate quiet gaps', () => {
  const rate=decoded.oi.sampleRate;
  for(const [index,p] of characters.entries()) {
    const output=clips.oi[index];
    // Derive time mapping from observed duration, not a character pitch setting.
    const stretch=(output.length-Math.ceil(rate*.18))/source.oi.length;
    const energies=[];
    for(let call=0;call<3;call++) {
      const energy=rms(output.subarray(Math.round(call*.6*stretch*rate),Math.round((call*.6+.45)*stretch*rate)));
      assert.ok(energy>.08,`${p.id}: recorded syllable ${call+1} survives`); energies.push(energy);
      if(call<2) {
        const gap=rms(output.subarray(Math.round((call*.6+.52)*stretch*rate),Math.round((call*.6+.59)*stretch*rate)));
        assert.ok(gap<energy*.12,`${p.id}: formants do not fill the syllable gap`);
      }
    }
    assert.ok(Math.min(...energies)/Math.max(...energies)>.55,`${p.id}: every call remains audible`);
  }
});

test('era identities and OI/WOO contours differ after matching gain and phrase duration', () => {
  const rate=decoded.woo.sampleRate;
  for(const role of ['oi','woo']) {
    const aligned=clips[role].map(output=>Float32Array.from(source[role],(_,i)=>at(output,i*(output.length-Math.ceil(rate*.18))/source[role].length)));
    for(let i=0;i<aligned.length;i++)for(let j=i+1;j<aligned.length;j++) {
      assert.ok(correlation(aligned[i],aligned[j])<.90,`${role}: ${characters[i].id}/${characters[j].id}`);
    }
  }
  for(const p of characters) {
    const a=renderEraVocal(source.woo,rate,p,'oi'), b=renderEraVocal(source.woo,rate,p,'woo');
    const scale=(b.length-Math.ceil(rate*.18))/(a.length-Math.ceil(rate*.18));
    const aligned=Float32Array.from(a,(_,i)=>at(b,i*scale));
    assert.ok(correlation(a,aligned)<.97,`${p.id}: phrase roles change the contour, not just level`);
  }
});

test('voiced calibration retains periodic energy and distinct high/low vocal registers across sample rates', () => {
  for(const rate of [8000,22050,48000,96000,192000]) {
    const input=Float32Array.from({length:Math.round(rate*.7)},(_,i)=>{
      const phase=2*Math.PI*150*i/rate;
      return .15*(Math.sin(phase)+.4*Math.sin(phase*2)+.2*Math.sin(phase*3));
    });
    const lower=renderEraVocal(input,rate,characters.find(p=>p.id==='future-futureman'));
    const higher=renderEraVocal(input,rate,characters.find(p=>p.id==='future-cyberwoman'));
    const lowCross=crossings(lower,rate,.15,.55), highCross=crossings(higher,rate,.15,.55);
    assert.ok(highCross>lowCross*1.6,`${rate}: higher voice register ${highCross}/${lowCross}`);
    for(const output of [lower,higher]) {
      assert.ok(output.every(Number.isFinite));
      assert.ok(peak(output)<=.88);
      assert.ok(rms(output)>.06&&rms(output)<.18);
      assert.ok(crossings(output,rate,.15,.55)<1400,'vocal harmonics stay bounded, without noise-like crossings');
    }
  }
});

test('the singing layers follow source syllables rather than sustaining over empty input', () => {
  const rate=8000;
  const input=Float32Array.from({length:rate*2},(_,i)=>i<rate*.3||i>rate*1.6?.2*Math.sin(2*Math.PI*180*i/rate):0);
  for(const p of characters) {
    const output=renderEraVocal(input,rate,p);
    assert.ok(rms(output.subarray(Math.round(rate*.8),Math.round(rate*1.4)))<.000001,`${p.id}: silent middle stays silent`);
    assert.ok(rms(output.subarray(0,Math.round(rate*.3)))>.04);
    assert.ok(rms(output.subarray(Math.round(rate*1.9),Math.round(rate*2)))>.02);
  }
});

test('invalid and corrupted inputs are bounded, safe and never mutate their source', () => {
  for(const input of [undefined,null,[],new Float64Array(2),new ArrayBuffer(4)]) assert.throws(()=>renderEraVocal(input,22050),TypeError);
  for(const rate of [undefined,null,0,7999,192001,NaN,Infinity,'22050']) assert.throws(()=>renderEraVocal(new Float32Array(4),rate),RangeError);
  assert.throws(()=>renderEraVocal(new Float32Array(8000*8+1),8000),RangeError);
  assert.deepEqual(renderEraVocal(new Float32Array(),8000),new Float32Array());
  const corrupt=new Float32Array([Infinity,NaN,-Infinity,100,-100,.5,-.5]),before=corrupt.slice();
  for(const p of [null,{},false,{skin:'future',owner:Infinity},{id:'__proto__',hz:Infinity,notes:[NaN]}]) {
    const output=renderEraVocal(corrupt,8000,p);
    assert.ok(output.every(Number.isFinite)); assert.ok(peak(output)<=.88);
    assert.ok(output.length<corrupt.length*1.2+8000*.181);
  }
  assert.deepEqual(corrupt,before);
  for(const p of characters) {
    assert.equal(peak(renderEraVocal(new Float32Array(8000),8000,p)),0);
    const quiet=renderEraVocal(Float32Array.from({length:800},(_,i)=>1e-7*Math.sin(i)),8000,p);
    assert.ok(peak(quiet)<.00001,'near-silence is not normalized into a loud synth');
  }
});
