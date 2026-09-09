// Siteswap timing and a world-space, linear-drag juggling model. See PUGGLER_RESEARCH.md.
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : lo));
export const MAX_OBJECTS = 10;
export const RIDER_NAMES = Object.freeze(['Puggler','Roxy','Moss']);
export const performerCount = partner => partner === 'solo' ? 1 : String(partner).startsWith('trio') ? 3 : 2;
export const notation = value => value.toString(36);
export const parseNotation = text => [...text].map(value => parseInt(value,36));
export const WORLD = Object.freeze({ width: 1000, handY: 270, hatY: 510, gravity: 2200 });
export const PROPS = Object.freeze([
  { id: 'ball', name: 'Rubber ball', mass: .16, drag: .045, bounce: .78, color: '#ff668d', voice: 'rubber', hz: 196, decay: .3, radius: 30 },
  { id: 'can', name: 'Tin can', mass: .09, drag: .04, bounce: .3, color: '#6ce0df', voice: 'metal', hz: 294, decay: .65, radius: 23 },
  { id: 'club', name: 'Juggling club', mass: .22, drag: .035, bounce: .3, color: '#c6f16d', voice: 'wood', hz: 147, decay: .18, radius: 29 },
  { id: 'bowling', name: 'Bowling ball', mass: 2.7, drag: .025, bounce: .18, color: '#ab8df4', voice: 'rubber', hz: 65.4, decay: .6, radius: 29 },
  { id: 'bottle', name: 'Glass bottle', mass: .36, drag: .04, bounce: .2, color: '#89e8a5', voice: 'glass', hz: 440, decay: 1.1, radius: 28 },
  { id: 'boot', name: 'Punk boot', mass: .85, drag: .08, bounce: .15, color: '#e5b183', voice: 'wood', hz: 82.4, decay: .12, radius: 29 },
  { id: 'duck', name: 'Rubber duck', mass: .065, drag: .07, bounce: .5, color: '#ffdd68', voice: 'reed', hz: 330, decay: .3, radius: 26 },
  { id: 'fish', name: 'Disco fish', mass: .42, drag: .06, bounce: .25, color: '#79bfff', voice: 'reed', hz: 220, decay: .4, radius: 30 },
  { id: 'apple', name: 'Apple', mass: .18, drag: .045, bounce: .2, color: '#ee7960', voice: 'wood', hz: 262, decay: .16, radius: 22 },
  { id: 'bell', name: 'Brass bell', mass: .55, drag: .035, bounce: .3, color: '#f1c76d', voice: 'metal', hz: 523, decay: 1.4, radius: 25 },
  { id: 'brick', name: 'Brick', mass: 1.8, drag: .035, bounce: .1, color: '#d77461', voice: 'wood', hz: 98, decay: .1, radius: 30 },
  { id: 'balloon', name: 'Air balloon', mass: .018, drag: .07, bounce: .65, color: '#f0a0ed', voice: 'air', hz: 392, decay: .4, radius: 29 },
  { id:'guitar',name:'Battered guitar',mass:3.1,drag:.12,bounce:.12,color:'#e9a454',voice:'wood',hz:110,decay:.6,radius:33 },
  { id:'cassette',name:'Demo cassette',mass:.055,drag:.045,bounce:.35,color:'#ee86b0',voice:'metal',hz:330,decay:.3,radius:23 },
  { id:'skateboard',name:'Cracked skateboard',mass:2.1,drag:.14,bounce:.25,color:'#b8b878',voice:'wood',hz:98,decay:.25,radius:35 },
  { id:'vinyl',name:'Punk seven-inch',mass:.06,drag:.1,bounce:.2,color:'#db77ad',voice:'metal',hz:294,decay:.4,radius:28 },
  { id:'mic',name:'Dented microphone',mass:.32,drag:.055,bounce:.25,color:'#99bcc0',voice:'metal',hz:220,decay:.4,radius:24 },
  { id:'cone',name:'Traffic cone',mass:1.2,drag:.15,bounce:.3,color:'#f2955b',voice:'rubber',hz:82.4,decay:.25,radius:30 },
  { id:'glowstick',name:'Rave glowstick',mass:.025,drag:.04,bounce:.3,color:'#9dce94',voice:'glass',hz:523,decay:.7,radius:22 },
  { id:'mushroom',name:'Plush mushroom',mass:.13,drag:.11,bounce:.5,color:'#c885b9',voice:'reed',hz:262,decay:.2,radius:29 },
  { id:'plushrat',name:'Squat-house plush rat',mass:.19,drag:.12,bounce:.45,color:'#b3a7a4',voice:'reed',hz:147,decay:.2,radius:28 },
]);
const pattern = (id, name, count, notation, values, extra = {}) => Object.freeze({ id, name, count, notation, values, ...extra });
export const PATTERNS = Object.freeze([
  pattern('zip', 'Hand-to-hand zip', 1, '1', [1]),
  pattern('single', 'Alternating high toss', 1, '300', [3, 0, 0]),
  pattern('single-hand', 'One-hand toss', 1, '2T0', [2, 0]),
  pattern('columns', 'Alternating columns', 2, '2T', [2]),
  pattern('sync-columns', 'Together columns', 2, '(2T,2T)', [2], { sync: true }),
  pattern('two-shower', 'Two-object shower', 2, '31', [3, 1]),
  pattern('one-hand', 'Two in one hand', 2, '40', [4, 0]),
  pattern('cascade', 'Cascade', 3, '3', [3]),
  pattern('reverse', 'Reverse cascade', 3, '3', [3], { reverse: true }),
  pattern('shower', 'Three-object shower', 3, '51', [5, 1]),
  pattern('half-box', 'Half box', 3, '441', [4, 4, 1]),
  pattern('tower', 'High / middle / zip', 3, '531', [5, 3, 1]),
  pattern('fountain', 'Alternating fountain', 4, '4', [4]),
  pattern('sync-fountain', 'Together fountain', 4, '(4,4)', [4], { sync: true }),
  pattern('four-shower', 'Four-object shower', 4, '71', [7, 1]),
  pattern('534', 'Cross / cross / fountain', 4, '534', [5, 3, 4]),
  ...Array.from({length:6},(_,i)=>i+5).flatMap(n=>[
    pattern(`many-${n}`,`${n}-object ${n%2?'cascade':'fountain'}`,n,notation(n),[n]),
    pattern(`shower-${n}`,`${n}-object shower`,n,notation(n*2-1)+'1',[n*2-1,1]),
    ...(n%2?[]:[pattern(`sync-${n}`,`${n}-object together fountain`,n,`(${notation(n)},${notation(n)})`,[n],{sync:true})]),
  ]),
]);
export const DEFAULTS = Object.freeze({ count: 3, pattern: 'cascade', tempo: 180, gravity: 1, wind: 0, assist: 65, mode: 'juggle', propIds: ['ball','can','club','duck','guitar','cassette','skateboard','vinyl','mic','glowstick'], drums:['kick','snare','crash','tom','hat','kick','snare','crash','tom','hat'], riffs:['guitar','bass','oi','woo','guitar','bass','oi','woo','guitar','bass'], seed: 1981, loft: 1.4, partner: 'solo', phrase: 'loop', passMode: 'every', chaos:0, posterSeed:1981 });
export function eventsAt(p, beat) {
  if (p.sync) return beat % 2 ? [] : [0, 1].map(hand => ({ hand, value: p.values[0], destination: hand }));
  const value = p.values[((beat % p.values.length) + p.values.length) % p.values.length];
  return value ? [{ hand: ((beat % 2) + 2) % 2, value, destination: (((beat + value) % 2) + 2) % 2 }] : [];
}
export function initialSlots(p) {
  const slots = [];
  for (let beat = -Math.max(...p.values); beat < 0; beat++) {
    for (const e of eventsAt(p, beat)) if (beat + e.value >= 0) slots.push({ due: beat + e.value, hand: e.destination });
  }
  return slots.sort((a, b) => a.due - b.due || a.hand - b.hand);
}
export function propFor(id) { return PROPS.find(p => p.id === id) ?? PROPS[0]; }
// Exact solution for linear drag dv/dt = acceleration - k*v. Mass never changes g.
export function flightPosition(f, t) {
  t = Math.max(0, t);
  const a = f.k < 1e-6 ? t : -Math.expm1(-f.k * t) / f.k;
  const b = f.k < 1e-6 ? t * t / 2 : (t - a) / f.k;
  const decay = Math.exp(-f.k * t);
  return { x: f.x + f.vx * a + f.ax * b, y: f.y + f.vy * a - f.g * b,
    vx: f.vx * decay + f.ax * a, vy: f.vy * decay - f.g * a };
}
export function launchFlight({ x, y, targetX, targetY = y, duration, mass, drag, g, wind = 0 }) {
  const k = clamp(drag / mass, 0, 5), t = Math.max(.012, duration);
  const a = k < 1e-6 ? t : -Math.expm1(-k * t) / k;
  const b = k < 1e-6 ? t * t / 2 : (t - a) / k;
  // The throw anticipates still air; crosswind remains an expressive disturbance.
  return { x, y, vx: (targetX - x) / a, vy: (targetY - y + g * b) / a, k, g, ax: wind / Math.max(.06, mass) };
}
export function soundMapping(prop, body, params = {}) {
  const height = clamp((body.y - WORLD.handY) / 360, -.5, 2);
  return { frequency: clamp(prop.hz * 2 ** (height * (params.height ?? .8)), 35, 5000),
    pan: clamp((body.x / WORLD.width * 2 - 1) * (params.stereo ?? 1), -1, 1),
    brightness: clamp(600 + Math.hypot(body.vx ?? 0, body.vy ?? 0) * (params.motion ?? 5), 300, 10000),
    energy: clamp(.5 * prop.mass * ((body.vx ?? 0) ** 2 + (body.vy ?? 0) ** 2) / 180000, .02, 1),
  };
}
// All chunks return to the same ground state; see the research ledger for sources.
export const PHRASE_CHUNKS = Object.freeze({
  1: ['1','20','300','4000','50000'],
  2: ['2','31','330','420','4400','411'],
  3: ['3','441','531','423','522','55500','45141'],
  4: ['4','534','552','633','5551','6424','7531','55550','7441'],
  ...Object.fromEntries(Array.from({length:6},(_,i)=>{
    const n=i+5,chunks=[[n],[n+1,n-1],[n+1,n+1,n-2],[n+2,n,n-2],[...Array(n-2).fill(n+2),2,2],[...Array(n-1).fill(n+2),2,0],[...Array(n).fill(n+2),0,0]];
    return [n,chunks.map(values=>values.map(notation).join(''))];
  })),
});
export const VERSES = Object.freeze({1:'3001400030050000',2:'3133031420440031',3:'3334415314235223',4:'4445555064244444',...Object.fromEntries(Array.from({length:6},(_,i)=>{const n=i+5;return [n,[...Array(12-n).fill(n),...Array(n-1).fill(n+2),2,0,n+1,n+1,n-2].map(notation).join('')];}))});
export const DRUMS = Object.freeze(['kick','snare','crash','tom','hat']);
export const RIFFS = Object.freeze(['guitar','bass','oi','woo']);

export class PugglerModel {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options, propIds: [...(options.propIds ?? DEFAULTS.propIds)], drums:[...(options.drums??['kick','snare','crash','tom'])], riffs:[...(options.riffs??RIFFS)] };
    this.reset();
  }
  get riderCount() { return performerCount(this.config.partner); }
  get activePlayers() { return this.players.slice(0,this.riderCount); }
  get x() { return this.players[0].x; } set x(v) { this.players[0].x=v; }
  get vx() { return this.players[0].vx; } set vx(v) { this.players[0].vx=v; }
  get wheel() { return this.players[0].wheel; }
  get flash() { return this.players[0].flash; }
  reset() {
    this.time=0; this.beat=0; this.nextBeat=0; this.seed=this.config.seed;
    this.catches=0; this.drops=0; this.score=0; this.combo=0; this.passes=0; this.lastDrop=-10; this.lastKick=-10;
    this.players=[0,1,2].map(id=>({id,x:id?740:500,vx:0,wheel:0,flash:[0,0],lastCatch:-10,lastDrop:-10,lastThrow:-10,lastKick:-10,lastCrowdThrow:-10,crowdQueued:false,loft:1,manualUntil:0,recoil:0,lean:0,expression:'grin'}));
    this.posterSeed=this.config.posterSeed;this.lastAudienceThrow=null;this.lastCrowdCatch=null;this.crowdCatches=0;
    this.stack=[]; this.balloons=[]; this.debris=[]; this.nextBalloon=1; this.events=[]; this.objects=null;
    this.apply(this.config);
  }
  apply(options) {
    const previousPartner=this.config.partner,previousPhrase=this.config.phrase;
    Object.assign(this.config,options);
    for(const key of ['propIds','drums','riffs'])if(key in options||!Array.isArray(this.config[key]))this.config[key]=[...(Array.isArray(options[key])?options[key]:DEFAULTS[key])];
    this.config.count=Math.round(clamp(this.config.count,1,MAX_OBJECTS));
    this.config.tempo=clamp(this.config.tempo,100,1200);
    this.config.loft=clamp(this.config.loft??1.4,.6,3);
    this.config.gravity=clamp(this.config.gravity,.45,1.65);
    this.config.wind=clamp(this.config.wind,-12,12);
    this.config.assist=clamp(this.config.assist,20,120);
    this.config.chaos=clamp(this.config.chaos??0,0,100);
    this.config.posterSeed=Math.floor(clamp(this.config.posterSeed??1981,0,0xffffffff));this.posterSeed=this.config.posterSeed;
    for(let i=0;i<MAX_OBJECTS;i++){
      this.config.propIds[i]??=DEFAULTS.propIds[i];this.config.drums[i]??=DRUMS[i%DRUMS.length];this.config.riffs[i]??=RIFFS[i%RIFFS.length];
    }
    this.config.partner=['solo','auto','manual','trio-auto','trio-manual'].includes(this.config.partner)?this.config.partner:'solo';
    this.config.phrase=['loop','verse','evolve'].includes(this.config.phrase)?this.config.phrase:'loop';
    this.config.passMode=['every','three','phrase'].includes(this.config.passMode)?this.config.passMode:'every';
    const p=PATTERNS.find(p=>p.id===this.config.pattern&&p.count===this.config.count)??PATTERNS.find(p=>p.count===this.config.count);
    const changed=this.pattern!==p||this.objects?.length!==p.count||performerCount(previousPartner)!==this.riderCount||previousPhrase!==this.config.phrase;
    this.pattern=p; this.config.pattern=p.id;
    if(changed||!this.objects){
      const positions=this.riderCount===3?[210,500,790]:this.riderCount===2?[285,715]:[500];
      this.activePlayers.forEach((player,i)=>{player.x=positions[i];player.vx=0;player.crowdQueued=false;});
      this.reRack();
    }
    for(let i=0;i<this.objects.length;i++){
      this.objects[i].prop=propFor(this.config.propIds[i]);
      this.objects[i].drum=DRUMS.includes(this.config.drums[i])?this.config.drums[i]:DRUMS[i%DRUMS.length];
      this.objects[i].riff=RIFFS.includes(this.config.riffs[i])?this.config.riffs[i]:RIFFS[i%RIFFS.length];
    }
  }
  reRack() {
    this.beat=0;this.nextBeat=0;this.phraseStart=0;this.phraseValues=[];this.phraseNumber=0;this.lastChunk='';this.currentPhrase='Repeat';
    const p=this.config.phrase==='loop'?this.pattern:{values:[this.config.count]};
    this.objects=initialSlots(p).map((s,id)=>({...s,id,owner:id%this.riderCount,fromOwner:0,phase:'held',x:this.x,y:WORLD.handY,vx:0,vy:0,spin:0,trail:[],prop:propFor(this.config.propIds[id]),drum:this.config.drums[id],riff:this.config.riffs[id],pickup:0}));
    this.debris=[];
  }
  random() {this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  patternEvents(beat) {
    if(this.config.phrase==='loop') return eventsAt(this.pattern,beat);
    let value;
    if(this.config.phrase==='verse'){
      const verse=VERSES[this.config.count];value=parseInt(verse[beat%verse.length],36);
      this.currentPhrase=['VERSE','FILL','BREAK','REFRAIN'][Math.floor(beat%16/4)];
    }else{
      if(beat>=this.phraseStart+this.phraseValues.length){
        this.phraseStart+=this.phraseValues.length;
        const chunks=PHRASE_CHUNKS[this.config.count];
        const section=this.phraseNumber++%4;
        let chunk;
        if(section===0)chunk=notation(this.config.count).repeat(2+Math.floor(this.random()*4));
        else if(section===3)chunk=notation(this.config.count).repeat(2);
        else {const choices=chunks.filter(c=>c!==this.lastChunk&&c.length>1);chunk=choices[Math.floor(this.random()*choices.length)];}
        this.lastChunk=chunk;this.phraseValues=parseNotation(chunk);
        this.currentPhrase=['VERSE','FILL','BREAK','REFRAIN'][section];
      }
      value=this.phraseValues[beat-this.phraseStart];
    }
    return value?[{hand:beat%2,value,destination:(beat+value)%2,hold:value===2&&this.config.count>2}]:[];
  }
  get rhythmPreview() {
    if(this.config.phrase==='verse')return VERSES[this.config.count];
    if(this.config.phrase==='evolve')return this.phraseValues.map(notation).join('');
    return this.pattern.notation;
  }
  offset(hand,catching=false) {
    if(['columns','sync-columns','single-hand'].includes(this.pattern.id)&&this.config.phrase==='loop')return (hand?1:-1)*97;
    return (hand?1:-1)*((catching!==!!this.pattern.reverse)?118:72);
  }
  handPosition(hand,owner=0) {
    const player=this.players[owner];
    const held=this.objects.find(o=>o.phase==='held'&&o.hand===hand&&o.owner===owner);
    const incoming=this.objects.filter(o=>['air','replacement'].includes(o.phase)&&o.owner===owner&&o.hand===hand&&o.vy<0).sort((a,b)=>a.y-b.y)[0];
    const dwell=held?clamp((this.time-held.pickup)/.12,0,1):1;
    let x=player.x+this.offset(hand,true)*(1-dwell)+this.offset(hand)*dwell;
    let y=WORLD.handY-Math.sin(dwell*Math.PI)*22;
    if(incoming&&incoming.y<WORLD.handY+200){const reach=clamp(1-(incoming.y-WORLD.handY)/200,0,1);x+=(clamp(incoming.x-player.x,-175,175)+player.x-x)*reach*.75;}
    return {x,y};
  }
  emit(kind,o,extra={}) {
    this.events.push({kind,time:this.time,x:o.x,y:o.y,vx:o.vx,vy:o.vy,prop:o.prop??propFor('balloon'),id:o.id,owner:o.owner??0,drum:o.drum,riff:o.riff,...extra});
  }
  effectiveGravity(owner=0) {return WORLD.gravity*this.config.gravity*this.config.loft*this.players[owner].loft*(this.config.tempo/180)**2;}
  throwBeat(beat,events=this.patternEvents(beat)) {
    for(const e of events){
      const o=this.objects.find(o=>o.due===beat&&o.hand===e.hand);
      if(!o)continue;
      const from=o.owner,source=this.players[from];
      if(source.crowdQueued){source.crowdQueued=false;o.due=beat+e.value;o.hand=e.destination;this.launchToAudience(o,from);continue;}
      if(e.hold){o.due=beat+2;continue;}
      const shouldPass=this.config.partner!=='solo'&&(this.config.passMode==='every'||(this.config.passMode==='three'?beat%3===0:beat%8>=4));
      const destination=shouldPass?(from+1)%this.riderCount:from,receiver=this.players[destination];
      const duration=(e.value-.38)*60/this.config.tempo;
      o.x=source.x+this.offset(e.hand);o.y=WORLD.handY;
      const bounds=this.playerBounds(destination);
      const targetX=clamp(receiver.x+receiver.vx*duration,...bounds)+this.offset(e.destination,true);
      // Most throws wobble slightly; occasional wild releases can genuinely miss.
      const wild=this.config.chaos/100;
      const slip=wild>0&&this.random()<.035+wild*.13;
      const error=wild*((this.random()-.5)*48+(slip?(this.random()<.5?-1:1)*(190+this.config.count*8):0));
      o.flight=launchFlight({x:o.x,y:o.y,targetX:targetX+error,duration,mass:o.prop.mass,drag:o.prop.drag,g:this.effectiveGravity(from),wind:this.config.wind});
      o.start=this.time;o.duration=duration;o.phase='air';o.fromOwner=from;o.owner=destination;o.hand=e.destination;o.due=beat+e.value;
      o.targetX=targetX;o.spinRate=(e.hand?-1:1)*clamp(6/Math.sqrt(o.prop.mass),3,22);
      o.vx=o.flight.vx;o.vy=o.flight.vy;o.trail=[];
      source.flash[e.hand]=this.time+.12;source.lastThrow=this.time;source.recoil+=clamp(o.prop.mass*.035,.008,.15)*(e.hand?1:-1);
      this.emit('throw',o,{impulse:o.prop.mass*Math.hypot(o.vx,o.vy),pass:shouldPass,fromOwner:from});
    }
  }
  playerBounds(owner) {
    if(this.riderCount===1)return [135,865];
    if(this.riderCount===2)return owner?[545,865]:[135,455];
    return [[110,315],[385,615],[685,890]][owner]??[110,890];
  }
  setRiderLoft(owner,value) {if(owner<this.riderCount)this.players[owner].loft=clamp(value,.4,2.2);}
  throwToAudience(owner=0) {
    if(owner>=this.riderCount)return;
    const player=this.players[owner];if(this.time-player.lastCrowdThrow<.45)return;
    const held=this.objects.find(o=>o.owner===owner&&o.phase==='held');
    if(held)this.launchToAudience(held,owner);else player.crowdQueued=true;
  }
  launchToAudience(o,owner) {
    const player=this.players[owner],p=this.handPosition(o.hand,owner);
    o.phase='audience';o.start=this.time;o.duration=.82;o.x=p.x;o.y=p.y;o.trail=[];
    o.targetX=clamp(player.x+(this.random()-.5)*420,45,955);
    o.flight=launchFlight({x:o.x,y:o.y,targetX:o.targetX,targetY:40,duration:o.duration,mass:o.prop.mass,drag:o.prop.drag,g:1450});
    o.vx=o.flight.vx;o.vy=o.flight.vy;o.spinRate=12;player.lastCrowdThrow=this.time;player.lastThrow=this.time;player.recoil+=.2;
    this.emit('crowd-throw',o);
  }
  crowdCatch(o) {
    this.emit('crowd-catch',o);this.crowdCatches++;this.score+=25;
    this.lastCrowdCatch={time:this.time,x:o.x,owner:o.owner};o.phase='waiting';o.spawnAt=this.time+.32;o.trail=[];o.y=-100;
  }
  kick(owner=0) {
    const player=this.players[owner];if(this.time-player.lastKick<.25)return;
    player.lastKick=this.time;this.lastKick=this.time;
    for(const o of [...this.objects,...this.balloons]){
      if(o.owner!==owner&&!this.balloons.includes(o))continue;
      if(['air','replacement'].includes(o.phase)&&Math.abs(o.x-player.x)<165&&o.y<235){
        const bonus=this.balloons.includes(o);o.phase=bonus?'air':o.phase;o.start=this.time;o.duration=bonus?1.1:1.0;
        o.flight=launchFlight({x:o.x,y:Math.max(28,o.y),targetX:bonus?player.x:player.x+this.offset(o.hand,true),targetY:bonus?WORLD.hatY+this.stack.length*33:WORLD.handY,duration:o.duration,mass:o.prop.mass,drag:o.prop.drag,g:WORLD.gravity*this.config.gravity});
        this.emit('kick',o);
      }
    }
  }
  miss(o) {
    this.emit('drop',o);this.drops++;this.combo=0;this.lastDrop=this.time;
    const player=this.players[o.owner];player.lastDrop=this.time;player.recoil+=(this.random()-.5)*.6;
    this.debris.push({prop:o.prop,x:o.x,y:o.prop.radius,vx:o.vx*.12,vy:Math.abs(o.vy)*o.prop.bounce*.2,spin:o.spin,owner:o.owner,expires:this.time+2.2});
    if(this.debris.length>10)this.debris.shift();
    o.phase='waiting';o.spawnAt=this.time+.24;o.trail=[];o.y=-100;
  }
  replace(o) {
    const old=o.prop.id,choices=PROPS.filter(p=>p.id!==old),player=this.players[o.owner];
    o.prop=choices[Math.floor(this.random()*choices.length)];this.config.propIds[o.id]=o.prop.id;
    // A front-row hand lobs a new prop upward; it descends to the intended rider.
    o.phase='replacement';o.x=clamp(player.x+(this.random()-.5)*530,35,965);o.y=32;
    o.targetX=clamp(player.x+this.offset(o.hand,true)+(this.random()-.5)*70,20,980);
    o.start=this.time;o.duration=1.15; o.spinRate=(this.random()-.5)*12;
    o.flight=launchFlight({x:o.x,y:o.y,targetX:o.targetX,targetY:WORLD.handY,duration:o.duration,mass:o.prop.mass,drag:o.prop.drag,g:2000});
    o.vx=o.flight.vx;o.vy=o.flight.vy;o.trail=[];
    this.lastAudienceThrow={time:this.time,x:o.x,owner:o.owner};this.emit('replacement',o);
  }
  movePlayers(dt,controls) {
    for(const p of this.activePlayers){
      p.previousX=p.x;
      const control=controls[p.id]??{};
      let aim=control.target??null,direction=control.steer??0;
      if(direction||aim!==null)p.manualUntil=this.time+.65;
      if(p.id&&this.config.partner.endsWith('auto')&&this.time>p.manualUntil){
        const incoming=this.objects.filter(o=>o.owner===p.id&&['air','replacement'].includes(o.phase)&&o.vy<0).sort((a,b)=>a.y-b.y)[0];
        if(incoming)aim=incoming.targetX-this.offset(incoming.hand,true);else aim=p.x;
      }
      if(control.height)this.setRiderLoft(p.id,p.loft+clamp(control.height,-1,1)*dt*.7);
      const desired=aim===null?clamp(direction,-1,1)*480:clamp((aim-p.x)*6,-480,480),previous=p.vx;
      p.vx+=(desired-p.vx)*(1-Math.exp(-dt*8));p.x=clamp(p.x+p.vx*dt,...this.playerBounds(p.id));
      const bounds=this.playerBounds(p.id);if(p.x<=bounds[0]||p.x>=bounds[1])p.vx=0;
      p.wheel+=p.vx*dt/49;p.recoil*=Math.exp(-dt*6);p.lean+=((p.vx/480*.2+(p.vx-previous)*.003+p.recoil)-p.lean)*(1-Math.exp(-dt*10));
      p.expression=this.time-p.lastDrop<1.4?'panic':this.time-p.lastCatch<.25?'shout':Math.abs(p.vx)>180?'wild':'grin';
    }
  }
  step(dt,steer=0,target=null,friendSteer=0,friendTarget=null) {
    const controls=Array.isArray(steer)?steer:[{steer,target},{steer:friendSteer,target:friendTarget},{}];
    dt=clamp(dt,0,1/60);this.events=[];this.time+=dt;this.movePlayers(dt,controls);
    for(const o of this.objects){
      if(o.phase==='held')Object.assign(o,this.handPosition(o.hand,o.owner),{vx:this.players[o.owner].vx,vy:0});
      else if(o.phase==='waiting'){if(this.time>=o.spawnAt)this.replace(o);}
      else if(o.phase==='audience'){Object.assign(o,flightPosition(o.flight,this.time-o.start));o.spin+=o.spinRate*dt;if(o.y<=65&&o.vy<0)this.crowdCatch(o);}
      else if(['air','replacement'].includes(o.phase)){
        const previousY=o.y;Object.assign(o,flightPosition(o.flight,this.time-o.start));o.spin+=o.spinRate*dt;
        if(o.vy<0&&previousY>=WORLD.handY&&o.y<=WORLD.handY){
          // Sweep the actual descending crossing: short, fast passes can travel
          // beyond a whole hand between two fixed steps.
          let low=Math.max(0,this.time-o.start-dt),high=this.time-o.start;
          for(let i=0;i<12;i++){const mid=(low+high)/2;if(flightPosition(o.flight,mid).y>WORLD.handY)low=mid;else high=mid;}
          const crossingTime=o.start+(low+high)/2,crossing=flightPosition(o.flight,crossingTime-o.start);
          const player=this.players[o.owner],mix=clamp((crossingTime-(this.time-dt))/dt,0,1),playerX=player.previousX+(player.x-player.previousX)*mix;
          const distance=Math.abs(crossing.x-playerX-this.offset(o.hand,true));
          if(distance<this.config.assist+o.prop.radius){
            this.emit('catch',o,{...crossing,time:crossingTime,distance,vx:crossing.vx-player.vx,replacement:o.phase==='replacement',pass:o.phase==='air'&&o.fromOwner!==o.owner});
            if(o.phase==='air'&&o.fromOwner!==o.owner)this.passes++;
            player.flash[o.hand]=this.time+.2;player.lastCatch=this.time;player.recoil+=clamp(o.prop.mass*.03,0,.1)*(o.hand?1:-1);
            o.phase='held';o.pickup=this.time;Object.assign(o,this.handPosition(o.hand,o.owner),{vx:player.vx,vy:0});o.trail=[];this.catches++;this.combo++;this.score+=10+Math.min(this.combo,30);
          }
        }
        if(o.y<o.prop.radius&&['air','replacement'].includes(o.phase))this.miss(o);
      }
      if(o.phase!=='waiting'){o.x=clamp(o.x,-1000,2000);o.y=clamp(o.y,0,1000000);}
      if(['air','replacement','audience'].includes(o.phase)){o.trail.push([o.x,o.y]);if(o.trail.length>55)o.trail.shift();}
    }
    for(const d of this.debris){d.vy-=900*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.spin+=d.vx*.01*dt;if(d.y<d.prop.radius){d.y=d.prop.radius;d.vy=Math.abs(d.vy)*d.prop.bounce*.25;d.vx*=.9;}}
    this.debris=this.debris.filter(d=>d.expires>this.time);
    while(this.nextBeat<=this.beat+1e-8){
      const events=this.patternEvents(this.nextBeat);
      const waiting=events.some(e=>this.objects.some(o=>o.due===this.nextBeat&&o.hand===e.hand&&o.phase!=='held'));
      if(waiting){this.beat=this.nextBeat;break;}
      this.throwBeat(this.nextBeat++,events);
    }
    this.beat+=dt*this.config.tempo/60;
    if(this.config.mode==='kick')this.stepBalloons(dt);else {this.balloons=[];this.stack=[];this.nextBalloon=this.time+1;}
    return this.events;
  }
  stepBalloons(dt) {
    if(this.time>=this.nextBalloon&&this.balloons.length<5){
      const owner=Math.floor(this.random()*this.riderCount),player=this.players[owner];
      this.balloons.push({id:100+Math.floor(this.random()*10000),owner,x:clamp(player.x+(this.random()-.5)*280,80,920),y:1000,vx:0,vy:-75,prop:propFor('balloon'),phase:'air',color:['#ff83be','#ffe079','#99eec8'][Math.floor(this.random()*3)]});
      this.nextBalloon=this.time+2;
    }
    for(const o of this.balloons){
      const previousY=o.y;
      if(o.flight)Object.assign(o,flightPosition(o.flight,this.time-o.start));else {o.vy=Math.max(-170,o.vy-35*dt);o.x+=Math.sin(this.time+o.id)*10*dt;o.y+=o.vy*dt;}
      const player=this.players[o.owner??0],top=WORLD.hatY+this.stack.length*33;
      if(o.vy<0&&previousY>=top&&o.y<=top&&Math.abs(o.x-player.x)<55){
        this.stack.push(o.color);o.phase='gone';this.score+=50;this.emit('hat',o);
        if(this.stack.length>=8){this.score+=800;this.emit('tower',o);this.stack=[];}
      }
      if(o.y<20){o.phase='gone';this.combo=0;this.drops++;this.lastDrop=this.time;player.lastDrop=this.time;this.emit('drop',o);}
    }
    this.balloons=this.balloons.filter(o=>o.phase!=='gone');
  }
}
