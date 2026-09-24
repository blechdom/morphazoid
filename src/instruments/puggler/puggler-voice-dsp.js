// Original offline voice builders. These are theatrical acoustic approximations,
// not authenticated recordings of instruments or cultural performance styles.
export const TAU=Math.PI*2;
export const noiseFor=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
export function mode(out,rate,hz,amp,decay,phase=0,detune=0){
  if(hz<20||hz>rate*.42)return;
  const a=TAU*hz/rate,cs=Math.cos(a),sn=Math.sin(a),loss=Math.exp(-1/(rate*decay));
  let real=Math.cos(phase),imag=Math.sin(phase),envelope=1;
  for(let i=0;i<out.length;i++){
    out[i]+=imag*envelope*amp*(detune?Math.cos(TAU*detune*i/rate):1);
    const r=real*cs-imag*sn;imag=imag*cs+real*sn;real=r;envelope*=loss;
  }
}
export function noiseBurst(out,rate,seed,amount,decay,brightness=.5){
  const noise=noiseFor(seed);let low=0,env=1;const loss=Math.exp(-1/(rate*decay));
  for(let i=0;i<out.length;i++){const n=noise();low+=.13*(n-low);out[i]+=amount*env*(low+(n-low)*brightness);env*=loss;}
}
export function cabinet(out,rate,drive=3,cutoff=4200){
  let low=0,high=0,previous=0;const lp=1-Math.exp(-TAU*cutoff/rate),hp=Math.exp(-TAU*55/rate);
  for(let i=0;i<out.length;i++){const x=Math.tanh(out[i]*drive);high=hp*(high+x-previous);previous=x;low+=lp*(high-low);out[i]=low;}
}
export function pluckedString(out,rate,p,{bass=false,muted=false,sustain=false,whammy=false}={}){
  const noise=noiseFor(891+p.index*71),root=p.frequency;
  // Pick displacement excites actual recirculating delay-line strings. No FM
  // carrier, ring modulation or laser chirp in the punk string family.
  for(const [voice,ratio] of (bass?[1]:[1,1.4983,2.001]).entries()){
    const delay=rate/(root*ratio),size=Math.ceil(delay*1.5)+4,line=new Float32Array(size);
    for(let i=0;i<size;i++){const x=(i/delay)%1;line[i]=((x<.18?x/.18:(1-x)/.82)-.5)+noise()*.045;}
    let write=0,old=0;
    for(let i=0;i<out.length;i++){
      const t=i/rate,bend=whammy?1+.16*Math.sin(TAU*1.7*t)*Math.min(1,t*9):1;
      const read=(write-delay/bend+size*2)%size,j=Math.floor(read),f=read-j;
      const value=line[j]*(1-f)+line[(j+1)%size]*f;
      const excitation=sustain?.008*Math.sin(TAU*root*ratio*t)*(1-Math.exp(-t*22)):0;
      line[write]=Math.tanh(((value+old)*.5*(muted?.987:.998)+excitation)*1.02)/1.02;old=value;write=(write+1)%size;
      const env=Math.min(1,t/(sustain?.045:.002))*Math.exp(-t/(muted?.16:sustain?2.4:.9));
      out[i]+=value*env/(1+voice*.7);
    }
  }
  cabinet(out,rate,bass?3:p.family==='ebow'?2:6+p.color*5,bass?2300:4600);
}
export function acousticVoice(out,rate,p){
  const f=p.frequency,family=p.family,seed=p.index*373+12;
  if(['harpsichord','piano','harp','zither','sitar','pizzicato'].includes(family)){
    const quill=family==='harpsichord',sitar=family==='sitar',piano=family==='piano';
    for(let k=1;k<=22;k++){
      const stiff=piano?.00028:quill?.00006:.000018;
      const hz=f*k*Math.sqrt(1+stiff*k*k),amp=Math.sin(Math.PI*k*(quill?.13:.21))/k**(quill?1.05:piano?1.8:1.45);
      const decay=(family==='harp'?1.05:piano?.8:sitar?.65:.43)/(1+k*.055);
      mode(out,rate,hz,amp,decay,k*.19,p.family==='zither'?.35+k*.08:0);
      if(sitar&&k<9)mode(out,rate,hz*1.003,amp*.28,.8/(1+k*.08),k*.71);
    }
    noiseBurst(out,rate,seed,quill?.1:.045,.005,quill?.8:.2);
    if(sitar){for(let i=0;i<out.length;i++){const t=i/rate;out[i]+=.17*Math.max(0,out[i]-.1)*Math.exp(-t*3);}}
  }else if(['gong','gamelan','bell','wood','tabla','timpani','hand-drum'].includes(family)){
    const ratios=family==='gong'||family==='gamelan'?[1,1.023,1.52,2.14,2.76,3.61,4.48,5.73]:family==='tabla'?[1,2,3,4.01,5.03,6.02]:family==='timpani'?[1,1.5,1.99,2.44,3.02]:family==='wood'?[1,2.76,5.41,8.93]:family==='hand-drum'?[1,1.59,2.14,2.92,4.06]:[1,2.756,5.404,8.933];
    ratios.forEach((ratio,k)=>mode(out,rate,f*ratio,.6/(1+k*.6),(family==='gong'||family==='gamelan'?1.5:family==='wood'?.14:.4)/(1+k*.15),k*.63));
    if(family==='gamelan')ratios.slice(0,5).forEach((ratio,k)=>mode(out,rate,f*ratio+2.4,.25/(1+k*.7),.95,k*.37));
    noiseBurst(out,rate,seed,.06,.006,family==='tabla'?.55:.15);
  }else{
    // Bow/wind/brass: harmonic source, register-dependent spectral envelope,
    // breath/rosin noise and delayed vibrato rather than inharmonic FM vowels.
    const bowed=family==='violin',flute=family==='flute'||family==='whistle',oboe=family==='oboe',brass=family==='tuba'||family==='trombone';
    const noise=noiseFor(seed),phase=new Float64Array(19);let breath=0;
    for(let i=0;i<out.length;i++){
      const t=i/rate,attack=Math.min(1,t/(bowed?.065:brass?.035:.018));
      const vibrato=1+(bowed?.009:flute?.002:.003)*Math.sin(TAU*(bowed?5.7:5)*t)*(1-Math.exp(-t*8));
      const slide=family==='trombone'?1-.08*Math.exp(-t*18):1;let value=0;
      for(let k=1;k<phase.length;k++){
        if(f*k>rate*.42)break;phase[k]+=TAU*f*k*vibrato*slide/rate;
        const spectrum=flute?(k===1?1:k===2?.14:k===3?.025:0):oboe?(k%2?1:.3)/k**1.1:brass?1/k**(.95+.75*Math.exp(-t*30)):1/k**1.3;
        const body=bowed?.45+.9*Math.exp(-(((f*k-2300)/1200)**2)):oboe?.5+1.3*Math.exp(-(((f*k-1400)/600)**2)):1;
        value+=Math.sin(phase[k])*spectrum*body;
      }
      breath+=.09*(noise()-breath);out[i]=(value+breath*(flute?.16:.04))*attack*Math.min(1,(out.length-i)/(rate*.045));
    }
  }
}
export function copyClip(out,rate,clip,{speed=1,at=0,gain=1,reverse=false}={}){
  if(!clip?.data?.length)return;
  const offset=Math.round(at*rate),length=Math.min(out.length-offset,Math.ceil(clip.data.length/clip.rate*rate/speed));
  for(let i=0;i<length;i++){
    const pos=i/rate*clip.rate*speed,x=reverse?clip.data.length-1-pos:pos,j=Math.floor(x),f=x-j;
    if(j<0||j+1>=clip.data.length)continue;
    out[offset+i]+=(clip.data[j]*(1-f)+clip.data[j+1]*f)*gain*Math.min(1,i/(rate*.003),(length-1-i)/(rate*.012));
  }
}
export function finishVoice(out,rate,target=.15){
  let prev=0,high=0,peak=0,square=0,active=0;const hp=Math.exp(-TAU*28/rate);
  for(let i=0;i<out.length;i++){
    const x=out[i];high=hp*(high+x-prev);prev=x;
    out[i]=high*Math.max(0,Math.min(1,i/(rate*.003),(out.length-1-i)/(rate*.018)));
    peak=Math.max(peak,Math.abs(out[i]));square+=out[i]**2;if(Math.abs(out[i])>.001)active++;
  }
  // Active rather than whole-file RMS: never inflate a sparse phrase's silence.
  const rms=Math.sqrt(square/Math.max(1,active)),gain=Math.min(.68/Math.max(1e-9,peak),target/Math.max(1e-9,rms));
  for(let i=0;i<out.length;i++)out[i]*=gain;
  return out;
}

// Tiny prefix-energy table, prepared with the bank, not scanned in the audio
// update loop. Equalize the part of a note that can actually sound before the
// next pulse; a long decaying pluck must not dwarf a short breathy note.
export function voiceWindowLevels(data,rate){
  const block=64,energy=new Float64Array(Math.ceil(data.length/block)+1);let sum=0;
  for(let i=0;i<data.length;i++){sum+=data[i]**2;if((i+1)%block===0)energy[(i+1)/block]=sum;}
  energy[energy.length-1]=sum;return {energy,block,frames:data.length,rate};
}
export function voiceWindowGain(levels,seconds,target=.15){
  if(!levels)return 1;
  const frames=Math.max(1,Math.min(levels.frames,seconds*levels.rate)),position=frames/levels.block,index=Math.floor(position),fraction=position-index;
  const a=levels.energy[Math.min(index,levels.energy.length-1)],b=levels.energy[Math.min(index+1,levels.energy.length-1)];
  const rms=Math.sqrt((a+(b-a)*fraction)/frames);
  return rms<.002?1:Math.max(.45,Math.min(2.4,target/rms));
}
