// Filtered fractional-delay strings, after Karplus/Strong and Jaffe/Smith (1983).
// https://musicweb.ucsd.edu/~trsmyth/papers/KSExtensions.pdf
// Length/tension come from the visible graph; their audible scaling is authored,
// not a measurement of this spider species. No oscillators replace these loops.
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));
export const SPIDER_STRING_VOICES = 24;
// Authored musical register around A3. This is a monotonic sonification of
// substring length, not a claim that an Argiope web emits these airborne notes.
export function spiderPluckFrequency(rawFrequency, sound, rate = 48000) {
  return clamp(220 * 2 ** ((sound.pluckRegister ?? 0) / 12) * (Math.max(1, rawFrequency) / 220) ** (sound.pluckSpread ?? 1), 45, Math.min(6000, rate * .18));
}
const smoothStep = x => x * x * (3 - 2 * x);
export class SpiderStrings {
  constructor(rate) {
    this.rate = rate; this.releaseDecay = Math.exp(-1 / (rate * .012)); this.expressionSmoothing = 1 - Math.exp(-1 / (rate * .015)); this.randomState = 0x3453b719; this.left = 0; this.right = 0; this.active = 0;
    this.shortenedAttacks = 0; this.voiceReplacements = 0; this.lastVoiceIndex = -1; this.propagationEvents = 0; this.writes = new Float64Array(24); this.excitations = new Float64Array(24);
    this.voices = Array.from({ length: SPIDER_STRING_VOICES }, () => ({
      line: new Float32Array(4096), cursor: 0, filled: 0, period: 60, frequency: 800, baseFrequency: 800,
      loss: .3, feedback: .99, previous: 0, dispersionInput:0, dispersionOutput:0, texture:0, slide:0, targetPeriod:60, slideCoefficient:.01, vibratoPhase:0, dc: 0, noise: 0, age: 0, remaining: 0,
      burst: 0, burstLength: 60, amplitude: 0, release: false, envelope: 0, excitePhase:0, coherentScale:1, attackFrames:48, holdFrames:0, releaseFrames:48000, contourEnd:48048, pair:-1, couplingCos:1, couplingSin:0, eventOwner:-1, priority:false, lastL:0, lastR:0, tailL:0, tailR:0, replacementAge:1000000,
      panL: .7, panR: .7, group: 6, segmentId: 0, material: 0, pick: .5, tune: 1, tension: 1, worldKind:0, worldLevel:1, expression: 1, targetExpression: 1, midiSourceId: null, midiChannel: 0, midiScope: -1,
    }));
  }
  random() { let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x | 0; return (x >>> 0) / 2147483648 - 1; }
  pluck(frequency, strength, pan, sound, group, segmentId, material = 0, pick = .5, midiOwner = null, expression = 1, priority = true, worldKind = 0, eventOwner = -1) {
    let voice = null; this.lastVoiceIndex = -1;
    // Four existing slots are reserved for intentional plucks/MIDI; routine
    // feet cannot consume the entire interaction budget. Physical replacements
    // below use a short outgoing tail; intentional MIDI/gesture voices survive.
    for (let i=0;i<(priority?SPIDER_STRING_VOICES:SPIDER_STRING_VOICES-4);i++) { const candidate=this.voices[i];if (candidate.remaining <= 0) { voice = candidate; this.lastVoiceIndex = i; break; } }
    if(!voice&&eventOwner>=0){
      let best=-1,age=-1;
      for(let i=0;i<SPIDER_STRING_VOICES-4;i++){const v=this.voices[i];if(v.priority||v.midiSourceId!==null)continue;
        const score=v.age+(v.eventOwner===eventOwner?this.rate*20:0);if(score>age){age=score;best=i;}}
      if(best>=0){voice=this.voices[best];this.lastVoiceIndex=best;this.voiceReplacements++;}
    }
    if (!voice || !(strength > 0)) return false; // Surplus unowned/intentional attacks are dropped; physical ownership has the bounded replacement path above.
    const replacing=voice.remaining>0;
    voice.tailL=replacing?voice.lastL:0;voice.tailR=replacing?voice.lastR:0;voice.replacementAge=replacing?0:1000000;
    voice.eventOwner=eventOwner;voice.priority=priority;
    if (voice.pair >= 0) this.voices[voice.pair].pair = -1; voice.pair = -1;
    const f = spiderPluckFrequency(frequency, sound, this.rate);
    voice.baseFrequency = frequency / sound.tune; voice.frequency = f; voice.tune = sound.tune; voice.tension = sound.tension;
    voice.loss = clamp(.07 + sound.damping * .4 + (material === 1 ? .12 : material === 2 ? -.045 : material === 4 ? .18 : 0), .025, .65);
    voice.targetPeriod = clamp(this.rate / f - voice.loss, 3, 4092);voice.texture=sound.texture??0;voice.slide=sound.slide??0;voice.period=voice.targetPeriod*(1+voice.slide*.16);voice.slideCoefficient=1-Math.exp(-1/(this.rate*(.006+voice.slide*.2)));voice.vibratoPhase=0;
    voice.feedback = Math.min(.9997, Math.exp(-6.907755 / (f * sound.decay * (material === 1 ? .7 : material === 2 ? 1.25 : material === 4 ? .45 : 1))));
    voice.previous = 0;voice.dispersionInput=0;voice.dispersionOutput=0; voice.dc = 0; voice.noise = 0; voice.age = 0; voice.cursor = 0; voice.filled = 0;
    voice.attackFrames = Math.max(1, Math.round(this.rate * (sound.pluckAttack ?? .001)));
    // Under physical-event overload a new contact must still become audible.
    // Its old tail gets four milliseconds; preserve full authored blooms when
    // a free voice exists, and bound only replacement attack time to six ms.
    if(replacing&&eventOwner>=0&&voice.attackFrames>this.rate*.006){voice.attackFrames=Math.ceil(this.rate*.006);this.shortenedAttacks++;}
    voice.holdFrames = Math.round(this.rate * (sound.pluckHold ?? 0));
    voice.releaseFrames = Math.max(1, Math.round(this.rate * (sound.pluckRelease ?? sound.decay)));
    voice.contourEnd = voice.attackFrames + voice.holdFrames + voice.releaseFrames;
    // A slow gesture supplies force throughout its attack/hold. Spreading the
    // excitation energy over that duration avoids a decayed, inaudible bloom.
    voice.burstLength = Math.max(Math.ceil(voice.period), voice.attackFrames + voice.holdFrames); voice.burst = voice.burstLength;
    voice.excitePhase=0;voice.coherentScale=Math.sqrt(Math.min(1,voice.period/voice.burstLength));
    voice.amplitude = clamp(strength, 0, 1) * (material === 3 ? .5 : .65) * Math.sqrt(Math.min(1, voice.period / voice.burstLength));
    voice.envelope = 1; voice.remaining = voice.contourEnd + Math.ceil(this.rate * .04); voice.release = false;
    voice.worldKind=worldKind;voice.worldLevel=worldKind===1?sound.silkLevel:worldKind===2?sound.preyLevel:1;voice.group = group; voice.expression = voice.targetExpression = Math.sqrt(clamp(expression,0,1)); voice.midiSourceId = midiOwner?.sourceId ?? null; voice.midiChannel = midiOwner?.channel ?? 0; voice.midiScope = midiOwner?.scope ?? -1; voice.segmentId = segmentId; voice.material = material; voice.pick = clamp(pick, .03, .97);
    const p = clamp(pan, -.95, .95); voice.panL = Math.cos((p + 1) * Math.PI / 4); voice.panR = Math.sin((p + 1) * Math.PI / 4);
    return true;
  }
  coupleLast(frequency, pan, sound, group, segmentId, material, pick = .5) {
    const donorIndex = this.lastVoiceIndex, donor = this.voices[donorIndex];
    if (!donor || donor.pair >= 0 || !(sound.coupling > 0)) return false;
    if (!this.pluck(frequency, .000001, pan, sound, group, segmentId, material, pick, null, 1, false)) return false;
    const receiverIndex = this.lastVoiceIndex, receiver = this.voices[receiverIndex];
    receiver.burst = 0; receiver.amplitude = 0; // No new force and no random draw.
    receiver.midiSourceId=donor.midiSourceId;receiver.midiChannel=donor.midiChannel;receiver.midiScope=donor.midiScope;
    receiver.expression=donor.expression;receiver.targetExpression=donor.targetExpression;receiver.worldKind=donor.worldKind;receiver.worldLevel=donor.worldLevel;
    donor.pair = receiverIndex; receiver.pair = donorIndex;
    const angle = clamp(sound.coupling,0,.4) * Math.PI / 4;
    donor.couplingCos = receiver.couplingCos = Math.cos(angle);
    donor.couplingSin = receiver.couplingSin = Math.sin(angle);
    this.propagationEvents++; this.lastVoiceIndex = donorIndex; return true;
  }
  retune(sound, midiPerformance) {
    for (const voice of this.voices) if (voice.remaining > 0) {
      const scope = midiPerformance?.scopes[voice.midiScope];
      const bend = scope?.active && scope.sourceId === voice.midiSourceId && scope.channel === voice.midiChannel ? 2 ** (scope.bend / 6) : 1;
      voice.targetExpression = voice.midiSourceId === null ? 1 : scope?.active && scope.sourceId === voice.midiSourceId && scope.channel === voice.midiChannel ? Math.sqrt(scope.expression) * (1 + .35 * scope.pressure) : 0;
      const f = spiderPluckFrequency(voice.baseFrequency * sound.tune * Math.sqrt(sound.tension / voice.tension) * bend, sound, this.rate);
      voice.frequency = f;voice.texture=sound.texture??0;voice.slide=sound.slide??0;voice.targetPeriod=this.rate/f-voice.loss;voice.slideCoefficient=1-Math.exp(-1/(this.rate*(.006+voice.slide*.2)));
      voice.feedback = Math.min(.9997, Math.exp(-6.907755 / (f * sound.decay * (voice.material === 1 ? .7 : voice.material === 2 ? 1.25 : voice.material === 4 ? .45 : 1))));
      voice.loss = clamp(.07 + sound.damping * .4 + (voice.material === 1 ? .12 : voice.material === 2 ? -.045 : voice.material === 4 ? .18 : 0), .025, .65);
    }
  }
  releaseMidi(scope) { for (const voice of this.voices) if (voice.midiSourceId !== null && (!scope || (scope.sourceId == null || voice.midiSourceId === scope.sourceId) && (scope.channel == null || voice.midiChannel === scope.channel))) voice.release = true; }
  release(group = -1) { for (const voice of this.voices) if (group < 0 || voice.group === group) voice.release = true; }
  sample(levels, brightness, sound) {
    this.left = 0; this.right = 0; this.active = 0;
    for (let vi=0; vi<SPIDER_STRING_VOICES; vi++) {
      const voice=this.voices[vi]; this.writes[vi]=0; this.excitations[vi]=0;
      if (voice.remaining <= 0) continue;
      this.active++; voice.remaining--; voice.age++;voice.period+=(voice.targetPeriod-voice.period)*voice.slideCoefficient;
      const read = voice.cursor - voice.period; const wrapped = (read + 4096) % 4096;
      const index = Math.floor(wrapped), fraction = wrapped - index;
      const delayed = voice.filled > voice.period + 1 ? voice.line[index] * (1 - fraction) + voice.line[(index + 1) & 4095] * fraction : 0;
      const filtered = delayed * (1 - voice.loss) + voice.previous * voice.loss; voice.previous = delayed;
      const coefficient=voice.texture*.32,dispersed=-coefficient*filtered+voice.dispersionInput+coefficient*voice.dispersionOutput;voice.dispersionInput=filtered;voice.dispersionOutput=dispersed;
      let excitation = 0;
      if (voice.burst > 0) {
        const n = this.random(); voice.noise += (n - voice.noise) * (.08 + brightness * .8);
        const t = voice.excitePhase;voice.excitePhase=(t+1/voice.period)%1;
        // Pick position changes harmonic content as well as the model's substring pitch.
        const triangle = t < voice.pick ? t / voice.pick : (1 - t) / (1 - voice.pick);
        excitation = (voice.noise * .75 + (triangle - .5) * .5 * voice.coherentScale) * voice.amplitude;
        if (voice.material === 3) excitation += Math.sin(TAU * t * 7) * voice.amplitude * .12 * voice.coherentScale;
        // A soft hammer and a short inharmonic attack distinguish a thumb tine
        // from a displaced silk string; its loop also loses high modes faster.
        if (voice.material === 4) excitation = Math.sin(Math.PI*t)**2 * (voice.noise*.2 + (Math.cos(TAU*t)*.55 + Math.cos(TAU*t*2.76)*.12)*voice.coherentScale) * voice.amplitude;
        voice.burst--;
      }
      this.writes[vi]=(filtered*(1-voice.texture)+dispersed*voice.texture) * voice.feedback; this.excitations[vi]=excitation;
      voice.dc += (delayed - voice.dc) * .002;
      if (voice.release || voice.remaining < this.rate * .04) voice.envelope *= this.releaseDecay;
      if (voice.envelope < 1e-8) voice.remaining = 0;
      voice.expression += (voice.targetExpression - voice.expression) * this.expressionSmoothing;
      const worldGain=voice.worldKind&&sound?Math.sqrt(clamp(voice.worldKind===1?sound.silkLevel:sound.preyLevel,0,1)/Math.max(1e-12,voice.worldLevel)):1;
      const releaseAge=voice.age-voice.attackFrames-voice.holdFrames;
      const contour=voice.age<voice.attackFrames?smoothStep(voice.age/voice.attackFrames):releaseAge<=0?1:releaseAge<voice.releaseFrames?1-smoothStep(releaseAge/voice.releaseFrames):0;
      if(contour===0){voice.remaining=0;if(voice.pair>=0)this.voices[voice.pair].pair=-1;voice.pair=-1;}
      const sample = worldGain*(delayed - voice.dc + excitation * .12) * voice.envelope * contour * levels[voice.group] * voice.expression;
      const fade=Math.min(1,voice.replacementAge++/(this.rate*.004)),tail=1-smoothStep(fade);
      voice.lastL=sample*voice.panL*(1-tail)+voice.tailL*tail;voice.lastR=sample*voice.panR*(1-tail)+voice.tailR*tail;
      this.left += voice.lastL; this.right += voice.lastR;
    }
    // A lossless 2x2 scattering junction exchanges existing traveling energy.
    // Rotation preserves a²+b²; damping occurs in the loops, excitation outside.
    // In particular an adjacent string never receives an unrelated noise burst.
    for(let i=0;i<SPIDER_STRING_VOICES;i++){
      const v=this.voices[i], j=v.pair;
      if(v.remaining>0&&j>i&&this.voices[j].remaining>0){const a=this.writes[i],b=this.writes[j];this.writes[i]=a*v.couplingCos+b*v.couplingSin;this.writes[j]=b*v.couplingCos-a*v.couplingSin;}
    }
    for(let i=0;i<SPIDER_STRING_VOICES;i++){
      const v=this.voices[i];if(v.remaining<=0)continue;
      v.line[v.cursor]=clamp(this.writes[i]+this.excitations[i],-1.5,1.5);v.cursor=(v.cursor+1)&4095;v.filled=Math.min(4096,v.filled+1);
    }
  }
}

// Reused bounded 20-frame stereo reconstruction guard from Roach Synth.
// Absolute polyphase taps of the 81-tap, 4x Kaiser-5 windowed-sinc interpolator
// (cutoff .25 Nyquist, unity DC gain). This is the same reconstruction used by
// the offline 4x peak checks, not a claim of certified broadcast true-peak I/O.
const RECONSTRUCTION_TAPS = [
  [0.0011305975791844614,0.0029265141089618871,0.0059320518437837155,0.010605090076805452,0.017579165251157443,0.027866916359520887,0.043423086442114837,0.068972338798174965,0.1201343501545469,0.29654281960437512,0.89963257101020833,0.17397774297154042,0.089283348532046142,0.054425491068782507,0.034795254750361118,0.022219885567699757,0.01375395907063175,0.0080261254612654931,0.0042523190668551048,0.0019016679348927712],
  [0.0021031678617178758,0.0050185309234718201,0.0097908339711988927,0.017115155028976113,0.02798327701095811,0.044051484099836259,0.068688534985681365,0.11058973007292544,0.20188442282305527,0.63347608687987322,0.63347608687987322,0.20188442282305527,0.11058973007292544,0.068688534985681365,0.044051484099836259,0.02798327701095811,0.017115155028976113,0.0097908339711988927,0.0050185309234718201,0.0021031678617178758],
  [0.0019016679348927712,0.0042523190668551048,0.0080261254612654931,0.01375395907063175,0.022219885567699757,0.034795254750361118,0.054425491068782507,0.089283348532046142,0.17397774297154042,0.89963257101020833,0.29654281960437512,0.1201343501545469,0.068972338798174965,0.043423086442114837,0.027866916359520887,0.017579165251157443,0.010605090076805452,0.0059320518437837155,0.0029265141089618871,0.0011305975791844614],
];
const RECONSTRUCTION_BOUND = .9;
const RECONSTRUCTION_SAFE_SAMPLE = RECONSTRUCTION_BOUND / Math.max(...RECONSTRUCTION_TAPS.map((phase) => phase.reduce((sum, tap) => sum + tap, 0)));
export class SpiderOutputGuard {
  constructor() {
    this.inputL = new Float64Array(32); this.inputR = new Float64Array(32);
    this.absoluteL = new Float64Array(32); this.absoluteR = new Float64Array(32);
    this.gains = new Float64Array(32).fill(1); this.dangerous = new Uint8Array(32);
    this.cursor = 0; this.dangerCount = 0; this.left = 0; this.right = 0;
    this.delayFrames = 20;
  }
  sample(left, right) {
    const cursor = this.cursor;
    this.inputL[cursor] = left; this.inputR[cursor] = right;
    this.absoluteL[cursor] = Math.abs(left); this.absoluteR[cursor] = Math.abs(right);
    this.gains[cursor] = 1;
    const dangerous = Math.max(Math.abs(left), Math.abs(right)) > RECONSTRUCTION_SAFE_SAMPLE ? 1 : 0;
    this.dangerCount += dangerous - this.dangerous[cursor]; this.dangerous[cursor] = dangerous;
    // The common case needs only the ring delay: no reconstruction arithmetic.
    if (this.dangerCount) {
      const center = (cursor - 10) & 31;
      // Phase zero is an impulse (other taps <4e-17). Rounded upward to keep a
      // conservative margin without spending 21 multiplies on numerical zeros.
      let bound = Math.max(this.absoluteL[center], this.absoluteR[center]) * 1.000637 + 1e-14;
      for (let phase = 0; phase < 3; phase += 1) {
        const taps = RECONSTRUCTION_TAPS[phase]; let sumL = 0; let sumR = 0;
        for (let i = 0; i < 20; i += 1) {
          const index = (cursor - i) & 31;
          sumL += taps[i] * this.absoluteL[index]; sumR += taps[i] * this.absoluteR[index];
        }
        bound = Math.max(bound, sumL, sumR);
      }
      if (bound > RECONSTRUCTION_BOUND) {
        const gain = RECONSTRUCTION_BOUND / bound;
        // Every input contributing to this window must respect its bound.
        // A sample is emitted only after ALL its future windows were checked.
        // Thus |sum(h*x*gain)| <= sum(|h*x|)*gain <= .9, even as gain varies.
        for (let i = 0; i <= this.delayFrames; i += 1) {
          const index = (cursor - i) & 31;
          this.gains[index] = Math.min(this.gains[index], gain);
        }
      }
    }
    const delayed = (cursor - this.delayFrames) & 31;
    this.left = this.inputL[delayed] * this.gains[delayed]; this.right = this.inputR[delayed] * this.gains[delayed];
    this.cursor = (cursor + 1) & 31;
  }
}
