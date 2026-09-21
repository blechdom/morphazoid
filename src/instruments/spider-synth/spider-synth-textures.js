// Authored sonifications of silk friction and spider vibration mechanisms.
// Schizocosa stridulans: palp stridulation + abdominal tremulation + percussion,
// Elias et al. 2006, doi:10.1242/jeb.02104. These are not Argiope recordings.
const TAU=Math.PI*2;
const bound=(x,a,b)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:a));

/** One bounded bowed delay loop. Drive is external energy, never an idle timer. */
export class SpiderFrictionString {
 constructor(rate){this.rate=rate;this.line=new Float32Array(4096);this.cursor=0;this.period=100;this.targetPeriod=100;this.low=0;this.dc=0;this.phase=0;this.energy=0;this.smoothing=1-Math.exp(-1/(rate*.018));}
 tune(frequency,slide){this.targetPeriod=bound(this.rate/bound(frequency,45,this.rate*.15)-.35,3,4092);this.glide=1-Math.exp(-1/(this.rate*(.004+.3*slide*slide)));}
 sample(drive,texture,white){
  this.energy+=(drive-this.energy)*this.smoothing;this.period+=(this.targetPeriod-this.period)*(this.glide||this.smoothing);
  const read=(this.cursor-this.period+4096)%4096,index=Math.floor(read),fraction=read-index;
  const delayed=this.line[index]*(1-fraction)+this.line[(index+1)&4095]*fraction;
  this.phase=(this.phase+(.37+texture*.81)/this.rate)%1;
  const pressure=.035+texture*.12,velocity=this.energy*(.035+.016*Math.sin(TAU*this.phase));
  const difference=velocity-delayed*.35;
  // Velocity-weakening friction approximates the catch/release of a bow.
  const friction=difference/(1+Math.abs(difference)*(.8+texture*20));
  const force=friction*pressure*this.energy+white*this.energy*(.0005+texture*.0012);
  this.low+=(delayed-this.low)*(.3+texture*.2);
  const next=Math.tanh(this.low*(this.energy>.00001?.991:.91)+force);
  this.line[this.cursor]=next;this.cursor=(this.cursor+1)&4095;this.dc+=(next-this.dc)*.001;
  return (next-this.dc)*4;
 }
}

/** Extra colors inside each of the eight existing body voices. */
export class SpiderSurfaceVoice {
 constructor(rate,index){this.rate=rate;this.phase=new Float64Array([index*.07,.23,.49,.71]);this.frequencies=new Float64Array(4);this.output=new Float64Array(8);this.life=index*.113;this.low=0;this.bow=new SpiderFrictionString(rate);this.texture=.45;this.slide=.25;this.flutter=.3;this.frequency=140;}
 configure(frequency,sound,x=0,y=0,z=0){
  this.frequency=frequency;this.texture=sound.texture;this.slide=sound.slide;this.flutter=sound.flutter;
  const spread=.003+sound.texture*.021;
  for(let i=0;i<4;i++){const ratio=i===0?1:i===1?1.501+spread:i===2?2.017+sound.texture*.09:3.071+sound.texture*.13;this.frequencies[i]=bound(frequency*ratio*2**((x-y+z)*.015),20,this.rate*.35);}
  this.bow.tune(frequency*(.5+sound.texture*.25),sound.slide);
 }
 sample(gate,env,white,age,source,oldSource,fade){
  const o=this.output,texture=this.texture,slide=this.slide;this.life=(this.life+(.13+texture*.42)/this.rate)%1;
  const breath=Math.sin(TAU*this.life),ripple=Math.sin(TAU*this.life*2.173+.7);
  for(let i=0;i<4;i++)this.phase[i]=(this.phase[i]+this.frequencies[i]*(1+slide*.009*breath)/this.rate)%1;
  const a=TAU*this.phase[0],b=TAU*this.phase[1],c=TAU*this.phase[2],d=TAU*this.phase[3];
  const s=Math.sin(a),s1=Math.sin(b),s2=Math.sin(c),s3=Math.sin(d);
  const live=.57+.24*breath+.18*ripple,seconds=age/this.rate;
  this.low+=(white-this.low)*.045;const rasp=white-this.low;
  const ridge=Math.max(0,Math.sin(TAU*seconds*(42+this.flutter*84)));
  const tremor=Math.max(0,Math.sin(TAU*seconds*(16+this.flutter*38)));
  const needsBow=source===17||source===21||oldSource===17&&fade<1||oldSource===21&&fade<1;
  const bowed=this.bow.sample(needsBow?(source===21?env:gate)*(.7+texture*.6):0,texture,white);
  o[0]=2*(Math.sin(a+s1*texture*1.1)*.12+s2*.055+s3*.035)*gate*(.7+texture*live*.5);
  o[1]=2*(bowed*2+(Math.sin(a+s2*texture*.7)*.12+s1*.055)*(.6+texture*live))*gate;
  o[2]=(Math.sin(a*3.1+texture*rasp*.4)*.11+rasp*.065)*env*ridge*ridge;
  o[3]=(Math.sin(a*.51)*.2+s*.045)*env*(.18+.82*tremor*tremor);
  o[4]=(Math.sin(a+s1*env*(1+texture*5))*.15+rasp*.025)*env*(.15+.85*ridge**4);
  o[5]=(bowed*.7+Math.sin(a+Math.sin(TAU*seconds*9)*slide*8)*.08+rasp*.018)*env;
  o[6]=(Math.sin(a+slide*14*Math.exp(-seconds*3))*.14+s2*.09+s3*.055)*env;
  o[7]=2*(s*.07+s1*.055+s2*.038+s3*.024)*gate*(.55+texture*(.5+live*.55));
  return o;
 }
}

/** Four short damped feedback paths; orthogonal mixing and gain < 1. */
export class SpiderSpace {
 constructor(rate){this.rate=rate;this.lines=Array.from({length:4},()=>new Float32Array(8192));this.sizes=new Int32Array([1069,1559,2203,3163].map(n=>Math.min(8191,Math.round(n*rate/48000))));this.positions=new Int32Array(4);this.low=new Float64Array(4);this.left=0;this.right=0;}
 sample(left,right,space){
  const a=this.low[0],b=this.low[1],c=this.low[2],d=this.low[3],feedback=.23+.43*space;
  const inputL=left*.2,inputR=right*.2;
  for(let i=0;i<4;i++){
   const next=i===0?(-a+b+c+d)*.5+inputL:i===1?(a-b+c+d)*.5+inputR:i===2?(a+b-c+d)*.5-inputL:(a+b+c-d)*.5-inputR;
   const position=this.positions[i];this.lines[i][position]=Math.tanh(next*feedback);
   const read=(position+1)%this.sizes[i];this.positions[i]=read;this.low[i]+=(this.lines[i][read]-this.low[i])*.42;
  }
  this.left=left+(a+c-b*.3)*space*.85;this.right=right+(b+d-a*.3)*space*.85;
 }
}

/** Three bounded world-owned mechanisms; no free-running scene effects. */
export class SpiderWorldSound {
 constructor(rate){this.rate=rate;this.bow=new SpiderFrictionString(rate);this.phase=0;this.beat=0;this.chew=0;this.silk=0;this.buzz=0;this.struggle=0;this.eat=0;this.targetSilk=0;this.targetBuzz=0;this.targetStruggle=0;this.targetEat=0;this.pan=0;this.frequency=180;this.left=0;this.right=0;this.noise=0;this.seed=0x671328;this.smoothing=1-Math.exp(-1/(rate*.025));}
 control(state,sound,enabled){
  this.targetSilk=enabled?bound(state?.layingSpeed*9,0,1):0;this.targetBuzz=enabled?bound(state?.preyBuzz,0,1):0;this.targetStruggle=enabled?bound(state?.preyStruggle,0,1):0;this.targetEat=enabled?bound(state?.eating,0,1):0;
  this.frequency=(75+bound(state?.travelSpeed,0,2)*650)*sound.tune*Math.sqrt(sound.tension);this.bow.tune(this.frequency,sound.slide);
  this.pan=bound(state?.bodyX??0,-.9,.9);
 }
 sample(sound){
  const k=this.smoothing;this.silk+=(this.targetSilk-this.silk)*k;this.buzz+=(this.targetBuzz-this.buzz)*k;this.struggle+=(this.targetStruggle-this.struggle)*k;this.eat+=(this.targetEat-this.eat)*k;
  let n=this.seed;n^=n<<13;n^=n>>>17;n^=n<<5;this.seed=n|0;const white=(n>>>0)/2147483648-1;this.noise+=(white-this.noise)*.11;
  this.beat=(this.beat+(17+sound.flutter*49)/this.rate)%1;this.phase=(this.phase+(135+sound.texture*105+this.struggle*80)/this.rate)%1;this.chew=(this.chew+(480+sound.slide*this.eat*1300)/this.rate)%1;
  const bow=this.bow.sample(this.silk*(.6+sound.texture),sound.texture,white);
  const silk=(bow*2+(white-this.noise)*this.silk*.018)*sound.silkLevel*10;
  const wing=Math.sin(TAU*this.phase+Math.sin(TAU*this.phase*2)*.5)*this.buzz*.075;
  const struggle=(Math.sin(TAU*this.chew)*.055+(white-this.noise)*.045)*this.struggle*(.18+.82*Math.max(0,Math.sin(TAU*this.beat))**2);
  const eat=(Math.sin(TAU*this.chew+this.noise*2)*.065+(white-this.noise)*.045)*this.eat;
  const signal=silk+(wing+struggle+eat)*sound.preyLevel*4;const pan=(this.pan+sound.pan+1)*Math.PI/4;
  this.left=signal*Math.cos(pan);this.right=signal*Math.sin(pan);
 }
}
