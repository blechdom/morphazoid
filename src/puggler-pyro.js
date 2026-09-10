// Brief stage accents, driven by the same physical drum contacts as the music.
// One analytic burst replaces the previous one; nothing is integrated per frame.
export const MAX_PYRO_PARTICLES=48;
const FIRST_ACCENT_AT=5.2;
const BURST_LIFETIME=1.3;
const random=seed=>{const n=Math.sin(seed*12.9898+78.233)*43758.5453;return n-Math.floor(n);};
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

export class PugglerPyro {
  constructor(){this.disposed=false;this.reset();}
  reset(time=0){
    this.lastTime=time;this.nextBurstAt=time+FIRST_ACCENT_AT;this.contacts=0;
    this.bursts=0;this.burst=null;this.sparks=[];
  }
  advance(time){
    if(!Number.isFinite(time))return;
    if(time<this.lastTime-.000001)this.reset(time);
    this.lastTime=time;
    if(this.burst&&time-this.burst.time>BURST_LIFETIME){this.burst=null;this.sparks=[];}
  }
  react(events=[],time=0,playing=true){
    if(this.disposed)return;
    this.advance(time);
    if(!playing){this.contacts=0;return;}
    for(const event of events){
      if(!['catch','kick'].includes(event.kind)||!Number.isFinite(event.time))continue;
      this.contacts++;
      const drum=event.kind==='kick'?'kick':event.drum??'snare';
      const accent=drum==='kick'||drum==='crash'||drum==='snare'&&this.contacts%4===0||this.contacts>=16;
      if(event.time<this.nextBurstAt||this.contacts<8||!accent)continue;
      const at=Math.min(time,event.time),seed=++this.bursts*37+(event.id??0)*3;
      this.burst={time:at,drum,strength:drum==='crash'?1:.86,seed};
      this.contacts=0;this.nextBurstAt=at+5.6+random(seed+9)*5.2;
      this.sparks=Array.from({length:MAX_PYRO_PARTICLES},(_,id)=>{
        const side=id%2,offset=id*7+seed;
        return {side,start:at+random(offset)*.3,vx:(random(offset+1)-.5)*.095,
          vy:.48+random(offset+2)*.5,life:.55+random(offset+3)*.4,
          size:.85+random(offset+4)*1.65,color:id%4?'#f8bf63':'#fff0bb'};
      });
      break;
    }
  }
  snapshot(time=0){
    this.advance(time);
    const age=this.burst?time-this.burst.time:Infinity;
    const jets=this.burst&&age>=0&&age<.62?[0,1].map(side=>({
      side,x:side?.86:.14,energy:Math.sin(Math.PI*age/.62)**.65*this.burst.strength*(side?.88:1),
    })):[];
    const particles=[];
    for(const spark of this.sparks){
      const t=time-spark.start;
      if(t<0||t>spark.life)continue;
      const y=spark.vy*t-.95*t*t;
      if(y<0)continue;
      particles.push({side:spark.side,x:(spark.side?.86:.14)+spark.vx*t,y,
        dx:spark.vx*.023,dy:(spark.vy-1.9*t)*.023,
        alpha:clamp((1-t/spark.life)*1.35,0,1),size:spark.size,color:spark.color});
    }
    return {bursts:this.bursts,active:jets.length>0||particles.length>0,nextBurstAt:this.nextBurstAt,
      particles,particleCount:particles.length,jets,disposed:this.disposed};
  }
  dispose(){this.reset(this.lastTime);this.disposed=true;}
}
