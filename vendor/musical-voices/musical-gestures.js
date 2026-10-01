// Authored English gesture sequencing over genuine upstream phone/tract models.
// This adapter is approximate articulation, not original STK/Singer TTS.
import {createMusicalVoices,SAMPLE_RATE} from './voice-api.js';
export const GESTURE_KEYS=Object.freeze(['a','b','c','d','e','f','g','h','i','j','k','l','m','n','ng','o','p','q','r','s','sh','t','th','dh','u','v','w','x','y','z','ch','ai','au','ei','oi','ou','ee','oo','oa','ay','er','uh','zh']);
const vowels=new Set(['a','e','i','o','u','ee','oo','au','er','uh']);
const diphthongs={ai:['ehh','eee'],ei:['ehh','eee'],oi:['aww','eee'],ou:['ahh','ooo'],oa:['ohh','ooo'],ay:['ahh','eee']};
const base={a:'aaa',e:'ehh',i:'ihh',o:'ahh',u:'uhh',ee:'eee',oo:'ooo',au:'aww',er:'rrr',uh:'uuu',r:'rrr',l:'lll',m:'mmm',n:'nnn',ng:'nng',f:'fff',s:'sss',sh:'shh',th:'thh',dh:'thz',v:'vvv',z:'zzz',zh:'zhh',h:'hah',y:'eee',j:'jjj',ch:'jjj'};
const stop={b:'bbb',p:'bbb',d:'ddd',t:'ddd',g:'ggg',k:'ggg',c:'ggg'};
const singerName=p=>({aaa:'aah',hah:'hhh',thz:'dhh',zhh:'shh'})[p]??p;
function step(phone,duration,extras={}){return {phone,duration,...extras};}
function sequence(key,method,pitch) {
  if(!GESTURE_KEYS.includes(key))throw new Error('Unknown English gesture.');
  const translate=method==='singer'?singerName:p=>p;
  const opts={pitch,vibrato:0,jitter:0};
  if(diphthongs[key])return diphthongs[key].map(p=>step(translate(p),.21,opts));
  if(['q','x'].includes(key)){const first=sequence('k',method,pitch);return [...first,...sequence(key==='q'?'w':'s',method,pitch)];}
  if(key==='w')return [step('ooo',.16,opts),step(translate('ahh'),.06,opts)];
  if(stop[key]) {
    const voiced=['b','d','g'].includes(key),p=stop[key];
    if(method==='singer') {
      const release={bbb:'pp+',ddd:'tt+',ggg:'ggg1'}[p];
      return [step(p,.035,{...opts,voiced:voiced?.2:0,noise:0}),step(release,.055,{...opts,voiced:voiced?.8:0,noise:key==='t'?2:.5}),step('aah',.035,{...opts,voiced:voiced?.6:0,noise:0})];
    }
    return [step(p,.025,{...opts,voiced:0,noise:0}),step(p,.07,{...opts,voiced:voiced?1:0,noise:.4}),step('aaa',.025,{...opts,voiced:voiced?.4:0,noise:0})];
  }
  let p=translate(base[key]),extras={...opts};
  if(method==='singer') {
    if(['dh','v','z','zh','j'].includes(key))Object.assign(extras,{voiced:.7,noise:.6});
    if(key==='ch')Object.assign(extras,{voiced:0,noise:1});
  }
  if(method==='stk'&&key==='ch')Object.assign(extras,{voiced:0,noise:.5});
  return [step(p,vowels.has(key)?.42:.20,extras)];
}
export async function createMusicalGestureRenderer(moduleOptions={}) {
  const voices=await createMusicalVoices(moduleOptions);
  return function renderGesture(key,{method='stk',pitch=180,balance=true,...nativeOptions}={}) {
    const frames=sequence(key,method,pitch);
    const controls=['vibrato','vibratoRate','jitter','glide','transition','tilt','velum','tractScale','glottis','formantScale','radii','formants'];
    // Native overrides are applied to every stage after its authored articulation.
    // Noise is a multiplier: silent closures remain silent, consonant excitation
    // retains each model's native gain. No caller override is invented here.
    const stkNoise={fff:.7,sss:.7,thh:.7,shh:.7,xxx:.7,hee:.1,hoo:.1,hah:.1,bbb:.1,ddd:.1,jjj:.1,ggg:.1,vvv:1,zzz:1,thz:1,zhh:1};
    for(const frame of frames){
      for(const name of controls)if(nativeOptions[name]!==undefined)frame[name]=nativeOptions[name];
      if(nativeOptions.noise!==undefined){
        if(!Number.isFinite(nativeOptions.noise)||nativeOptions.noise<0||nativeOptions.noise>4)throw new Error('Noise multiplier must be between0 and4.');
        frame.noise=(frame.noise??(method==='stk'?(stkNoise[frame.phone]??0):1))*nativeOptions.noise;
      }
    }
    const result=voices.synthesize({method,sequence:frames});
    const samples=result.samples;
    // Atlas preparation only: remove DC, fade clip boundaries and balance loudness.
    let mean=0;for(const x of samples)mean+=x;mean/=samples.length;
    const fade=Math.min(Math.floor(SAMPLE_RATE*.004),Math.floor(samples.length/4));
    let peak=0,power=0;
    for(let i=0;i<samples.length;i++){samples[i]=(samples[i]-mean)*Math.min(1,i/fade,(samples.length-1-i)/fade);peak=Math.max(peak,Math.abs(samples[i]));power+=samples[i]**2;}
    const rms=Math.sqrt(power/samples.length);
    if(!(peak>1e-8&&rms>1e-9)){if(nativeOptions.noise===0)return result;throw new Error(`${method}/${key} did not produce a gesture.`);}
    if(balance){const gain=Math.min(32,.14/rms,.8/peak);for(let i=0;i<samples.length;i++)samples[i]*=gain;}
    return result;
  };
}
