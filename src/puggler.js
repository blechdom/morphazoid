// Siteswap timing and a world-space, linear-drag juggling model. See PUGGLER_RESEARCH.md.
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : lo));
export const MAX_OBJECTS = 10;
export const RIDER_NAMES = Object.freeze(['Puggler','Roxy','Moss']);
export const CASTS = Object.freeze([
  {id:'puggler',name:'Puggler solo',riders:[0]}, {id:'roxy',name:'Roxy solo',riders:[1]}, {id:'moss',name:'Moss solo',riders:[2]},
  {id:'puggler-roxy',name:'Puggler + Roxy',riders:[0,1]}, {id:'puggler-moss',name:'Puggler + Moss',riders:[0,2]}, {id:'roxy-moss',name:'Roxy + Moss',riders:[1,2]},
  {id:'trio',name:'Puggler + Roxy + Moss',riders:[0,1,2]},
]);
const legacyCast = partner => partner === 'solo' ? 'puggler' : String(partner).startsWith('trio') ? 'trio' : 'puggler-roxy';
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
  { id:'plushrat',name:'Squat-house plush rat',mass:.19,drag:.12,bounce:.45,color:'#b3a7a4',voice:'reed',hz:147,decay:.2,radius:28 },
  // Game-scaled material contrasts, not measured replicas of these objects.
  { id:'icecream',name:'Dripping ice cream',mass:.14,drag:.08,bounce:.05,color:'#f1bfd8',voice:'air',hz:392,decay:.14,radius:28 },
  { id:'axe',name:'Rusty axe',mass:1.65,drag:.07,bounce:.08,color:'#aca6a1',voice:'metal',hz:147,decay:.5,radius:33 },
  { id:'deadcat',name:'Dead cat',mass:2.4,drag:.14,bounce:.015,color:'#9f9293',voice:'wood',hz:73.4,decay:.08,radius:35 },
  { id:'hydrant',name:'Fire hydrant',mass:6.8,drag:.11,bounce:.045,color:'#cf5e53',voice:'metal',hz:65.4,decay:.8,radius:35 },
  { id:'pickle',name:'Pickle',mass:.075,drag:.05,bounce:.16,color:'#a5b24f',voice:'reed',hz:349.2,decay:.16,radius:24 },
  { id:'violin',name:'Battered violin',mass:.48,drag:.075,bounce:.1,color:'#c99253',voice:'wood',hz:440,decay:.75,radius:32 },
  { id:'skull',name:'Skull',mass:.68,drag:.07,bounce:.18,color:'#ded3a7',voice:'wood',hz:174.6,decay:.32,radius:28 },
  { id:'banana',name:'Banana',mass:.12,drag:.06,bounce:.08,color:'#e6d16c',voice:'wood',hz:293.7,decay:.13,radius:26 },
  { id:'snake',name:'Snake',mass:.54,drag:.16,bounce:.07,color:'#95aa68',voice:'reed',hz:246.9,decay:.3,radius:33 },
  { id:'plant',name:'Potted plant',mass:1.35,drag:.19,bounce:.05,color:'#79b879',voice:'wood',hz:130.8,decay:.2,radius:34 },
  { id:'plunger',name:'Plunger',mass:.62,drag:.1,bounce:.62,color:'#cc8479',voice:'rubber',hz:110,decay:.3,radius:33 },
  { id:'cd',name:'Compact disc',mass:.016,drag:.045,bounce:.22,color:'#adcef1',voice:'metal',hz:587.3,decay:.55,radius:25 },
  { id:'vhs',name:'VHS tape',mass:.23,drag:.065,bounce:.2,color:'#9e91b9',voice:'metal',hz:196,decay:.28,radius:29 },
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
export const DEFAULTS = Object.freeze({ count: 3, pattern: 'cascade', tempo: 180, gravity: 1, wind: 0, assist: 65, propIds: ['ball','can','club','duck','guitar','cassette','skateboard','vinyl','mic','glowstick'], drums:['kick','snare','crash','tom','hat','kick','snare','crash','tom','hat'], riffs:['guitar','bass','oi','woo','guitar','bass','oi','woo','guitar','bass'], seed: 1981, loft: 1.4, partner: 'solo', phrase: 'loop', passMode: 'every', chaos:0, posterSeed:1981, ridePattern:'rock', rideSpeed:1, rideRange:44 });
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
// Expressive riding paths, not a biomechanics solver. Zero speed is useful for
// an isolated stationary juggling scene; ordinary defaults keep the wheel alive.
export const RIDE_PATTERNS = Object.freeze(['rock','sweep','double-step','lurch','surge']);
const rideShape = (pattern, phase) => pattern==='sweep' ? Math.sin(phase*.42)
  : pattern==='double-step' ? .64*Math.sin(phase)+.36*Math.sin(phase*2)
  : pattern==='lurch' ? (Math.sin(phase)+.32*Math.sin(phase*2))/1.32
  : pattern==='surge' ? Math.tanh(1.8*Math.sin(phase))/Math.tanh(1.8)
  : Math.sin(phase);

export class PugglerModel {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options, cast:options.cast??legacyCast(options.partner??DEFAULTS.partner), autoRide:options.autoRide??String(options.partner).endsWith('auto'), propIds: [...(options.propIds ?? DEFAULTS.propIds)], drums:[...(options.drums??['kick','snare','crash','tom'])], riffs:[...(options.riffs??RIFFS)] };
    this.reset();
  }
  get activeIds() { return (CASTS.find(c=>c.id===this.config.cast)??CASTS[0]).riders; }
  get riderCount() { return this.activeIds.length; }
  get activePlayers() { return this.activeIds.map(id=>this.players[id]); }
  get x() { return this.players[0].x; } set x(v) { this.players[0].x=v; }
  get vx() { return this.players[0].vx; } set vx(v) { this.players[0].vx=v; }
  get wheel() { return this.players[0].wheel; }
  get flash() { return this.players[0].flash; }
  reset() {
    this.time=0; this.beat=0; this.nextBeat=0; this.seed=this.config.seed;
    this.catches=0; this.drops=0; this.score=0; this.combo=0; this.passes=0; this.lastDrop=-10; this.lastKick=-10;
    this.players=[0,1,2].map(id=>({id,x:id?740:500,vx:0,wheel:0,flash:[0,0],lastCatch:-10,lastDrop:-10,lastThrow:-10,lastKick:-10,lastCrowdThrow:-10,crowdQueued:false,loft:1,manualUntil:0,rideAnchor:id?740:500,ridePhase:id*2.1,rideBlend:1,rideMotion:'balance',recoil:0,lean:0,expression:'grin'}));
    this.posterSeed=this.config.posterSeed;this.lastAudienceThrow=null;this.lastCrowdCatch=null;this.crowdCatches=0;
    this.lastCrowdReaction=null;this.nextCrowdReaction=2.5;this.debris=[]; this.events=[]; this.objects=null;
    this.apply(this.config);
  }
  apply(options) {
    const previousCast=this.activeIds.join(','),previousPhrase=this.config.phrase;
    const previousRide=[this.config.autoRide,this.config.ridePattern,this.config.rideSpeed,this.config.rideRange].join(':');
    Object.assign(this.config,options);
    if('partner' in options&&!('cast' in options))this.config.cast=legacyCast(options.partner);
    if('partner' in options&&!('autoRide' in options))this.config.autoRide=String(options.partner).endsWith('auto');
    if(!CASTS.some(c=>c.id===this.config.cast))this.config.cast='puggler';
    this.config.autoRide=!!this.config.autoRide;
    delete this.config.mode;
    for(const key of ['propIds','drums','riffs'])if(key in options||!Array.isArray(this.config[key]))this.config[key]=[...(Array.isArray(options[key])?options[key]:DEFAULTS[key])];
    this.config.count=Math.round(clamp(this.config.count,1,MAX_OBJECTS));
    this.config.tempo=clamp(this.config.tempo,100,1200);
    this.config.loft=clamp(this.config.loft??1.4,.6,3);
    this.config.gravity=clamp(this.config.gravity,.45,1.65);
    this.config.wind=clamp(this.config.wind,-12,12);
    this.config.assist=clamp(this.config.assist,20,120);
    this.config.chaos=clamp(this.config.chaos??0,0,100);
    this.config.ridePattern=RIDE_PATTERNS.includes(this.config.ridePattern)?this.config.ridePattern:'rock';
    this.config.rideSpeed=clamp(this.config.rideSpeed??1,0,2.5);
    this.config.rideRange=clamp(this.config.rideRange??44,0,100);
    this.config.posterSeed=Math.floor(clamp(this.config.posterSeed??1981,0,0xffffffff));this.posterSeed=this.config.posterSeed;
    for(let i=0;i<MAX_OBJECTS;i++){
      this.config.propIds[i]??=DEFAULTS.propIds[i];this.config.drums[i]??=DRUMS[i%DRUMS.length];this.config.riffs[i]??=RIFFS[i%RIFFS.length];
    }
    this.config.partner=['solo','auto','manual','trio-auto','trio-manual'].includes(this.config.partner)?this.config.partner:'solo';
    this.config.phrase=['loop','verse','evolve'].includes(this.config.phrase)?this.config.phrase:'loop';
    this.config.passMode=['every','three','phrase'].includes(this.config.passMode)?this.config.passMode:'every';
    const p=PATTERNS.find(p=>p.id===this.config.pattern&&p.count===this.config.count)??PATTERNS.find(p=>p.count===this.config.count);
    const changed=this.pattern!==p||this.objects?.length!==p.count||previousCast!==this.activeIds.join(',')||previousPhrase!==this.config.phrase;
    this.pattern=p; this.config.pattern=p.id;
    if(changed||!this.objects){
      const positions=this.riderCount===3?[210,500,790]:this.riderCount===2?[285,715]:[500];
      this.activePlayers.forEach((player,i)=>{player.x=positions[i];player.vx=0;player.crowdQueued=false;this.reanchorRider(player);});
      this.reRack();
    }
    else if(previousRide!==[this.config.autoRide,this.config.ridePattern,this.config.rideSpeed,this.config.rideRange].join(':')){
      for(const player of this.activePlayers)this.reanchorRider(player);
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
    this.objects=initialSlots(p).map((s,id)=>({...s,id,owner:this.activeIds[id%this.riderCount],fromOwner:0,phase:'held',x:this.x,y:WORLD.handY,vx:0,vy:0,spin:0,trail:[],prop:propFor(this.config.propIds[id]),drum:this.config.drums[id],riff:this.config.riffs[id],pickup:0}));
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
      const shouldPass=this.riderCount>1&&(this.config.passMode==='every'||(this.config.passMode==='three'?beat%3===0:beat%8>=4));
      const destination=shouldPass?this.activeIds[(this.activeIds.indexOf(from)+1)%this.riderCount]:from;
      const duration=(e.value-.38)*60/this.config.tempo;
      o.x=source.x+this.offset(e.hand);o.y=WORLD.handY;
      const bounds=this.playerBounds(destination);
      const targetX=clamp(this.riderLandingX(destination,duration),...bounds)+this.offset(e.destination,true);
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
    const position=this.activeIds.indexOf(owner);
    if(this.riderCount===2)return position===1?[545,865]:[135,455];
    return [[110,315],[385,615],[685,890]][position]??[110,890];
  }
  setRiderLoft(owner,value) {if(this.activeIds.includes(owner))this.players[owner].loft=clamp(value,.4,2.2);}
  rideOffset(player,ahead=0) {
    if(!this.config.rideSpeed)return 0;
    const phase=player.ridePhase+ahead*2.4*this.config.rideSpeed;
    const bounds=this.playerBounds(player.id),range=this.config.autoRide?Math.min(this.config.rideRange,(bounds[1]-bounds[0])*.36):0;
    return range*rideShape(this.config.ridePattern,phase)+(this.config.autoRide?8:15)*Math.sin(phase*1.12+player.id*.45);
  }
  reanchorRider(player) {
    const [low,high]=this.playerBounds(player.id);
    const reach=this.config.rideSpeed?(this.config.autoRide?Math.min(this.config.rideRange,(high-low)*.36)+8:15):0;
    // Reserve space for the whole rocking score. An anchor beyond an edge can
    // clamp every target to that edge indefinitely after manual control ends.
    // Only the target center changes here; x/vx still use the smooth controller.
    player.rideAnchor=clamp(player.x-this.rideOffset(player),low+reach,high-reach);
  }
  ridingTarget(player,ahead=0) {
    const bounds=this.playerBounds(player.id),at=t=>clamp(player.rideAnchor+this.rideOffset(player,t),...bounds);
    return {x:at(ahead),vx:(at(ahead+.001)-at(ahead-.001))/.002};
  }
  riderLandingX(owner,duration) {
    const player=this.players[owner];
    if(!this.config.rideSpeed||this.time<=player.manualUntil)return player.x+player.vx*duration;
    // Aim ahead along the actual bounded riding score. Correct its current
    // tracking error, while manual intervention can still make a throw miss.
    const now=this.ridingTarget(player),future=this.ridingTarget(player,duration);
    return future.x+(player.x-now.x)*Math.exp(-duration*6);
  }
  throwToAudience(owner=0) {
    if(!this.activeIds.includes(owner))return;
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
    if(!this.activeIds.includes(owner))return;
    const player=this.players[owner];if(this.time-player.lastKick<.25)return;
    player.lastKick=this.time;this.lastKick=this.time;
    for(const o of this.objects){
      if(o.owner!==owner)continue;
      if(['air','replacement'].includes(o.phase)&&Math.abs(o.x-player.x)<165&&o.y<235){
        o.start=this.time;o.duration=1;
        o.flight=launchFlight({x:o.x,y:Math.max(28,o.y),targetX:player.x+this.offset(o.hand,true),targetY:WORLD.handY,duration:o.duration,mass:o.prop.mass,drag:o.prop.drag,g:WORLD.gravity*this.config.gravity});
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
    o.targetX=clamp(this.riderLandingX(o.owner,1.15)+this.offset(o.hand,true)+(this.random()-.5)*70,20,980);
    o.start=this.time;o.duration=1.15; o.spinRate=(this.random()-.5)*12;
    o.flight=launchFlight({x:o.x,y:o.y,targetX:o.targetX,targetY:WORLD.handY,duration:o.duration,mass:o.prop.mass,drag:o.prop.drag,g:2000});
    o.vx=o.flight.vx;o.vy=o.flight.vy;o.trail=[];
    this.lastAudienceThrow={time:this.time,x:o.x,owner:o.owner};this.emit('replacement',o);
  }
  movePlayers(dt,controls) {
    for(const p of this.activePlayers){
      p.previousX=p.x;
      const control=controls[p.id]??{};
      let aim=Number.isFinite(control.target)?control.target:null,direction=Number.isFinite(control.steer)?clamp(control.steer,-1,1):0,feedForward=0;
      const manual=direction!==0||aim!==null;
      if(manual)p.manualUntil=this.time+.65;
      p.ridePhase+=dt*2.4*this.config.rideSpeed;
      if(this.time<=p.manualUntil){p.rideBlend=0;p.rideMotion=manual?'manual':'coast';}
      else{
        p.rideBlend+=(1-p.rideBlend)*(1-Math.exp(-dt*3));
        p.rideMotion=this.config.rideSpeed?(this.config.autoRide?'pattern':'balance'):'still';
        const ride=this.ridingTarget(p);aim=ride.x;feedForward=ride.vx;
        if(this.config.autoRide){
          const incoming=this.objects.filter(o=>o.owner===p.id&&['air','replacement'].includes(o.phase)&&o.vy<0).sort((a,b)=>(a.start+a.duration)-(b.start+b.duration))[0];
          if(incoming){
            const urgency=clamp(1-(incoming.start+incoming.duration-this.time)/.3,0,1)*.65;
            aim+=(clamp(incoming.targetX-this.offset(incoming.hand,true),...this.playerBounds(p.id))-aim)*urgency;
          }
        }
      }
      if(control.height)this.setRiderLoft(p.id,p.loft+clamp(control.height,-1,1)*dt*.7);
      const desired=aim===null?direction*480:clamp(((aim-p.x)*6+feedForward)*(this.time>p.manualUntil?p.rideBlend:1),-480,480),previous=p.vx;
      p.vx+=(desired-p.vx)*(1-Math.exp(-dt*8));p.x=clamp(p.x+p.vx*dt,...this.playerBounds(p.id));
      const bounds=this.playerBounds(p.id);if(p.x<=bounds[0]||p.x>=bounds[1])p.vx=0;
      if(this.time<=p.manualUntil)this.reanchorRider(p);
      p.wheel+=(p.x-p.previousX)/49;p.recoil*=Math.exp(-dt*6);
      const acceleration=dt?(p.vx-previous)/dt:0;
      const balanceLean=clamp(p.vx/480*.2+acceleration*.00028+p.recoil,-.36,.36);
      p.lean+=(balanceLean-p.lean)*(1-Math.exp(-dt*10));
      p.expression=this.time-p.lastDrop<1.4?'panic':this.time-p.lastCatch<.25?'shout':Math.abs(p.vx)>180?'wild':'grin';
    }
  }
  step(dt,steer=0,target=null,friendSteer=0,friendTarget=null,juggling=true) {
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
            if(!juggling&&player.crowdQueued){player.crowdQueued=false;this.launchToAudience(o,player.id);}
          }
        }
        if(o.y<o.prop.radius&&['air','replacement'].includes(o.phase))this.miss(o);
      }
      if(o.phase!=='waiting'){o.x=clamp(o.x,-1000,2000);o.y=clamp(o.y,0,1000000);}
      if(['air','replacement','audience'].includes(o.phase)){o.trail.push([o.x,o.y,o.spin,this.time]);if(o.trail.length>55)o.trail.shift();}
    }
    for(const d of this.debris){d.vy-=900*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.spin+=d.vx*.01*dt;if(d.y<d.prop.radius){d.y=d.prop.radius;d.vy=Math.abs(d.vy)*d.prop.bounce*.25;d.vx*=.9;}}
    this.debris=this.debris.filter(d=>d.expires>this.time);
    while(juggling&&this.nextBeat<=this.beat+1e-8){
      const events=this.patternEvents(this.nextBeat);
      const waiting=events.some(e=>this.objects.some(o=>o.due===this.nextBeat&&o.hand===e.hand&&o.phase!=='held'));
      if(waiting){this.beat=this.nextBeat;break;}
      this.throwBeat(this.nextBeat++,events);
    }
    if(juggling)this.beat+=dt*this.config.tempo/60;
    if(this.time>=this.nextCrowdReaction){
      const kind=this.time-this.lastDrop<2?'crowd-boo':'crowd-woo',x=80+this.random()*840;
      this.lastCrowdReaction={time:this.time,kind,x};
      this.emit(kind,{x,y:30,id:-1,owner:this.activeIds[0],prop:propFor('mic')});
      this.nextCrowdReaction=this.time+3.5+this.random()*3;
    }
    return this.events;
  }
}
