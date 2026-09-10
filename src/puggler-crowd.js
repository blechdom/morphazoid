// Five listeners respond to the same physical contact events as the drum kit.
// No AudioContext, frame-time integration, timers, or unbounded particle history.
export const CROWD_MEMBERS = Object.freeze([
  {id:0,head:'dread',hand:'lighter',phase:.4,delay:.014,duration:.36,refractory:.15,jump:24,scale:1.03,lean:-1,drums:{kick:1,snare:.25,crash:.55,tom:.75,hat:.08}},
  {id:1,head:'kid',hand:'phone',phase:2.1,delay:.066,duration:.26,refractory:.12,jump:29,scale:.81,lean:1,drums:{kick:.25,snare:.9,crash:.5,tom:.35,hat:1}},
  {id:2,head:'hat',hand:'palm',phase:4.5,delay:.105,duration:.44,refractory:.19,jump:19,scale:1.09,lean:-1,drums:{kick:.7,snare:.15,crash:1,tom:.4,hat:.05}},
  {id:3,head:'curls',hand:'peace',phase:5.8,delay:.039,duration:.31,refractory:.135,jump:27,scale:.94,lean:1,drums:{kick:.2,snare:.6,crash:.35,tom:1,hat:.65}},
  {id:4,head:'punk',hand:'horns',phase:3.2,delay:.085,duration:.29,refractory:.16,jump:31,scale:1,lean:-1,drums:{kick:.6,snare:1,crash:.9,tom:.5,hat:.3}},
].map(member=>Object.freeze({...member,drums:Object.freeze(member.drums)})));
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const noise=value=>{const n=Math.sin(value*12.9898+78.233)*43758.5453;return n-Math.floor(n);};
const CONTACTS=new Set(['catch','kick','crowd-catch']);
const REACTIONS=new Set(['crowd-woo','crowd-boo','drop']);
export const MAX_CROWD_IMPULSES=6;

export class PugglerCrowd {
  constructor() { this.disposed=false;this.reset(); }
  reset() {
    this.events=0;this.lastTime=-Infinity;
    this.members=CROWD_MEMBERS.map(profile=>({profile,pulses:[],lastHit:-Infinity}));
  }
  alignTime(time) {
    if(time<this.lastTime-.000001)this.reset();
    this.lastTime=time;
  }
  react(events=[],now) {
    if(this.disposed)return;
    if(Number.isFinite(now))this.alignTime(now);
    for(const event of events) {
      const time=event.time;
      if(!Number.isFinite(time)||!CONTACTS.has(event.kind)&&!REACTIONS.has(event.kind))continue;
      this.events++;
      const reaction=REACTIONS.has(event.kind),drum=event.kind==='kick'?'kick':event.drum??'snare';
      for(const member of this.members) {
        const p=member.profile,key=(event.id??0)*17+Math.round(time*1000)*.031+p.id*7;
        const chance=reaction?1:p.drums[drum]??.4;
        if(time-member.lastHit<p.refractory||noise(key)>chance)continue;
        member.lastHit=time;
        const vigor=reaction?1.1:.68+.32*noise(key+5);
        member.pulses.push({time:time+p.delay+noise(key+3)*.022,amplitude:vigor,duration:p.duration*(reaction?1.5:1),sign:event.kind==='crowd-boo'||event.kind==='drop'?-1:1});
        if(member.pulses.length>MAX_CROWD_IMPULSES)member.pulses.splice(0,member.pulses.length-MAX_CROWD_IMPULSES);
      }
    }
  }
  snapshot(time=0) {
    this.alignTime(time);
    const members=this.members.map(member=>{
      const p=member.profile;
      member.pulses=member.pulses.filter(pulse=>time-pulse.time<pulse.duration);
      let lift=0,impulse=0,attitude=0;
      for(const pulse of member.pulses) {
        const age=time-pulse.time;
        if(age<0)continue;
        const phase=age/pulse.duration;
        const envelope=Math.sin(Math.PI*phase)**.8*pulse.amplitude;
        lift+=envelope;impulse+=envelope*(1-phase*.35);attitude+=envelope*pulse.sign;
      }
      const energy=clamp(impulse,0,1.25),bounce=clamp(lift,0,1.25);
      // Small, independent idle fidgets remain when the drums rest. Event-driven
      // lift supplies the larger fast movement, with strict geometry limits.
      return {id:p.id,head:p.head,hand:p.hand,scale:p.scale,energy,
        jump:clamp(bounce*p.jump+Math.max(0,Math.sin(time*(8.1+p.id*.67)+p.phase))*1.7,0,40),
        sway:clamp(Math.sin(time*(6.8+p.id*.51)+p.phase)*(1.2+energy*4),-7,7),
        tilt:clamp(Math.sin(time*(9.2+p.id*.63)+p.phase)*(.025+energy*.13)+clamp(attitude,-1,1)*p.lean*.025,-.23,.23),
        arm:clamp(energy*(15+p.id*2)+Math.max(0,Math.sin(time*(7.3+p.id*.4)+p.phase))*2,0,30),
        handAngle:clamp(Math.sin(time*(10.7+p.id*.37)+p.phase)*(.055+energy*.16),-.28,.28),
      };
    });
    return {events:this.events,disposed:this.disposed,members};
  }
  dispose() { this.reset();this.disposed=true; }
}
