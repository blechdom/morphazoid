import { renderCsound } from './csound-runtime.js';
import { SPELLING_DIPHONE_CLIPS } from '../../instruments/spelling-synthesizer/spelling-diphone-atlas.js';
import { sustainPoints } from './vowel-loop.js';

// Authored English-like targets for playing the original Csound opcodes.
// These are a phoneme instrument, not IRCAM's original CHANT voice database.
const vowels = {
  a: [660, 1720, 2410], e: [530, 1840, 2480], i: [390, 1990, 2550], o: [730, 1090, 2440],
  u: [640, 1190, 2390], au: [570, 840, 2410], ee: [270, 2290, 3010], oo: [300, 870, 2240],
  er: [490, 1350, 1690], uh: [440, 1020, 2240], l: [400, 1200, 2600], r: [400, 1300, 1700],
  m: [250, 1000, 2100], n: [280, 1500, 2500], ng: [300, 1800, 2400], w: [300, 650, 2200], y: [270, 2200, 3000],
};
const glides = { ai: ['e', 'ee'], ei: ['e', 'ee'], oi: ['au', 'ee'], ou: ['o', 'oo'], oa: ['au', 'oo'], ay: ['o', 'ee'] };
const bounded = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));

export function renderCsoundAtlas(module, { method = 'fof', pitch = 145, formantScale = 1, bandwidth = 1, breath = .025, vibrato = .015, pulseCount = 3, decay = .65 } = {}) {
  if (!['fof', 'vosim'].includes(method)) throw new Error('Unknown Csound voice method.');
  pitch = bounded(pitch, 145, 60, 440); formantScale = bounded(formantScale, 1, .65, 1.6);
  bandwidth = bounded(bandwidth, 1, .4, 3); breath = bounded(breath, .025, 0, .4);
  vibrato = bounded(vibrato, .015, 0, .12); pulseCount = Math.round(bounded(pulseCount, 3, 1, 8)); decay = bounded(decay, .65, .2, .95);
  const bands = [1, 2, 3].map((n, i) => method === 'fof'
    ? `a${n} fof ${[.34, .19, .10][i]}, kPitch, kF${n}, 0, ${[65, 95, 140][i] * bandwidth}, .003, .024, .007, 100, giSine, giEnv, p3`
    : `a${n} vosim ${[.10, .055, .03][i]}, kPitch, max(kF${n},kPitch*1.1), ${decay}, ${pulseCount}, 1, giEnv`).join('\n');
  const orchestra = `sr=24000
ksmps=32
nchnls=1
0dbfs=1
seed 7319
giSine ftgen 1,0,16384,10,1
giEnv ftgen 2,0,16384,19,.5,.5,270,.5
instr 1
kVib oscili ${vibrato},5.3
kPitch = ${pitch}*(1+kVib)
kF1 linseg p4,p3,p7
kF2 linseg p5,p3,p8
kF3 linseg p6,p3,p9
${bands}
aNoise rand .2
aFric reson aNoise,p11,1000,1
aBreath reson aNoise,kF2,800,1
aVoice = (a1+a2+a3)*p10+aFric*(1-p10)*2+aBreath*${breath}
aClean dcblock2 aVoice
aEnv linseg 0,.008,1,p3-.028,1,.02,0
out aClean*aEnv
endin`;
  const groups = []; let start = .03;
  const score = Object.entries(SPELLING_DIPHONE_CLIPS).map(([key, meta]) => {
    const pair = glides[key], from = vowels[pair?.[0] ?? key] ?? vowels.u, to = vowels[pair?.[1] ?? key] ?? from;
    const voiced = Boolean(vowels[key] || pair || ['b', 'd', 'g', 'j', 'v', 'z', 'zh', 'dh'].includes(key));
    const duration = meta.kind === 'vowel' || meta.kind === 'glide' ? .54 : .17;
    const voiceMix = voiced ? (['v', 'z', 'zh', 'dh', 'j'].includes(key) ? .5 : 1) : 0;
    const noiseCenter = ['s', 'z', 'x', 't'].includes(key) ? 6100 : ['sh', 'zh', 'ch', 'j'].includes(key) ? 3000 : 1700;
    const line = `i1 ${start.toFixed(6)} ${duration} ${[...from, ...to].map(v => v * formantScale).join(' ')} ${voiceMix} ${noiseCenter}`;
    groups.push({ key, start, duration, meta }); start += duration + .025;
    return line;
  }).join('\n') + '\ne';
  const result = renderCsound(module, orchestra, score, { maxSeconds: start + 1 });
  const clips = {};
  for (const { key, start, duration, meta } of groups) {
    const offset = Math.round(start * result.sampleRate), end = Math.min(result.samples.length, Math.round((start + duration) * result.sampleRate));
    const samples = result.samples.subarray(offset, end);
    let square = 0, peak = 0;
    for (const value of samples) { square += value * value; peak = Math.max(peak, Math.abs(value)); }
    if (!(peak > .0001)) throw new Error(`Silent Csound ${method} phone: ${key}.`);
    const gain = Math.min(.76 / peak, .14 / Math.sqrt(square / samples.length));
    for (let n = 0; n < samples.length; n++) samples[n] *= gain;
    clips[key] = { ...meta, offset: offset / result.sampleRate, duration: samples.length / result.sampleRate, gain: meta.kind === 'vowel' ? 1 : 1.35,
      ...(meta.kind === 'vowel' ? sustainPoints(samples, result.sampleRate) : { sustainStart: 0, sustainEnd: 0 }) };
  }
  return { ...result, clips };
}
