import { WORLD, flightPosition } from './puggler.js';

const TAU = Math.PI * 2;
function ellipse(c, x, y, rx, ry, fill, stroke) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.stroke(); }
}
function path(c, points, fill, stroke = '#201a2b', width = 2) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = width; c.stroke();
}
function line(c, points, color, width) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
export function drawProp(c, prop, x, y, spin = 0, size = 1) {
  c.save(); c.translate(x, y); c.rotate(spin); c.scale(size, size); c.lineWidth = 2;
  const col = prop.color;
  switch (prop.id) {
    case 'can':
      path(c, [[-12,-16],[12,-16],[12,16],[-12,16]], '#688d9a');
      c.fillStyle = col; c.fillRect(-8,-14,8,29); ellipse(c,0,-16,12,4,'#d9eeec','#263541'); ellipse(c,0,16,12,4,'#8bb5b9','#263541');
      line(c,[[-10,-6],[10,-6]],'#d8eee4',2); line(c,[[-10,8],[10,8]],'#d8eee4',2); break;
    case 'club':
      path(c,[[-3,24],[3,24],[4,4],[10,-10],[7,-25],[-7,-25],[-10,-10],[-4,4]],col);
      c.fillStyle='#f8f3df'; c.fillRect(-4,3,8,18); line(c,[[-7,-19],[7,-19]],'#647b38',3); break;
    case 'bottle':
      path(c,[[-5,-26],[5,-26],[5,-12],[11,-5],[11,21],[-11,21],[-11,-5],[-5,-12]],col);
      c.fillStyle='#f2e0af';c.fillRect(-9,0,18,13);line(c,[[-4,-22],[-4,-13],[-7,-4],[-7,18]],'#e5ffd1',2);break;
    case 'boot':
      path(c,[[-11,-20],[7,-20],[7,4],[24,10],[24,20],[-14,20]],'#3b3042');
      line(c,[[-13,20],[25,20]],col,5); for(let i=0;i<4;i++)line(c,[[-5,-15+i*6],[5,-13+i*6]],'#dbd2bc',2);break;
    case 'fish':
      path(c,[[9,0],[28,-15],[25,14]],'#bc82ea');ellipse(c,-3,0,23,11,col,'#244965');ellipse(c,-16,-3,3,3,'#fff4dc');ellipse(c,-17,-3,1.4,2,'#14222b');
      path(c,[[-1,-9],[8,-22],[12,-5]],'#d2a4e6');break;
    case 'duck':
      ellipse(c,0,6,18,13,col,'#715835');ellipse(c,9,-10,11,11,col,'#715835');path(c,[[17,-12],[27,-7],[17,-4]],'#e58b44');ellipse(c,11,-13,2,2,'#242233');line(c,[[-10,2],[-3,10],[5,6]],'#c8953f',2);break;
    case 'bell':
      path(c,[[-17,15],[-11,5],[-9,-11],[0,-18],[9,-11],[11,5],[17,15]],col);ellipse(c,0,15,17,4,'#856336','#382630');ellipse(c,0,19,4,5,'#f8d987');break;
    case 'brick':
      path(c,[[-23,-12],[18,-12],[25,-5],[25,14],[-18,14],[-23,7]],col);line(c,[[-23,-12],[-18,-4],[25,-5]],'#f5b096',2);line(c,[[-18,-4],[-18,14]],'#f5b096',2);break;
    case 'guitar':
      path(c,[[-8,-2],[-20,4],[-24,20],[-14,30],[1,29],[15,19],[12,7],[5,1],[7,-34],[1,-38],[-4,-35],[-3,-2]],col);
      path(c,[[-7,2],[2,2],[7,17],[-7,22],[-14,13]],'#eecc9e','#644936',1);
      line(c,[[2,-32],[-4,20]],'#dac6a4',4);line(c,[[2,-31],[-4,21]],'#302931',1);
      for(let j=0;j<4;j++)line(c,[[-2,-24+j*6],[6,-23+j*6]],'#453a36',1);
      line(c,[[-9,19],[2,20]],'#272533',3);ellipse(c,8,17,2,2,'#f4d390');break;
    case 'cassette':
      path(c,[[-25,-17],[24,-17],[26,16],[-26,16]],'#292832');
      path(c,[[-21,-12],[21,-12],[21,6],[-21,6]],col,'#37333b',1);
      path(c,[[-17,6],[16,6],[19,14],[-19,14]],'#aba08b','#3b3640',1);
      ellipse(c,-12,-2,6,6,'#eee0b5','#473b39');ellipse(c,12,-2,6,6,'#eee0b5','#473b39');
      ellipse(c,-12,-2,2,2,'#393039');ellipse(c,12,-2,2,2,'#393039');line(c,[[-6,-3],[6,-3]],'#302f3b',3);
      line(c,[[-17,-8],[14,-8]],'#353445',2);break;
    case 'skateboard':
      ellipse(c,-18,8,5,7,'#d8bf83','#36303a');ellipse(c,18,8,5,7,'#d8bf83','#36303a');
      path(c,[[-36,-7],[-30,1],[-18,5],[21,5],[33,-2],[35,-9],[27,-5],[-24,-5]],col,'#302737',2);
      line(c,[[-26,-3],[25,-3]],'#393340',4);line(c,[[-15,-3],[-6,2],[1,-3],[10,2]],'#f0c78e',2);break;
    case 'vinyl':
      ellipse(c,0,0,25,25,'#24212e','#797183');
      for(const radius of [13,17,21])ellipse(c,0,0,radius,radius,null,'#86738266');
      ellipse(c,0,0,9,9,col,'#1d1c25');ellipse(c,0,0,2,2,'#e6d3ad');
      line(c,[[-19,-10],[-11,-18]],'#e7cfc677',2);break;
    case 'mic':
      path(c,[[-7,-4],[6,-4],[3,29],[-3,30]],'#6b6370','#332b38');
      ellipse(c,0,-15,13,15,col,'#4c3b44');
      for(let j=0;j<4;j++)line(c,[[-10,-23+j*5],[10,-23+j*5]],'#3d374f99',2);
      line(c,[[-5,-6],[6,-6]],'#ddd0b1',3);line(c,[[0,30],[12,34],[9,42]],'#aca192',2);break;
    case 'cone':
      path(c,[[-23,23],[23,23],[28,29],[-27,29]],'#393039');
      path(c,[[0,-30],[20,23],[-20,23]],col,'#733c37');
      path(c,[[-6,-13],[6,-13],[10,-3],[-10,-3]],'#f1e5bc','#f1e5bc',0);
      path(c,[[-13,5],[13,5],[17,16],[-17,16]],'#efe1b4','#efe1b4',0);break;
    case 'glowstick':
      c.save();c.globalAlpha=.16;line(c,[[0,-25],[0,24]],col,19);c.restore();
      line(c,[[0,-25],[0,24]],'#464148',10);line(c,[[0,-21],[0,22]],col,7);line(c,[[-1,-18],[-1,20]],'#f5f4c2',2);
      ellipse(c,0,-30,5,5,null,'#b9ba93');break;
    case 'mushroom':
      path(c,[[-5,-1],[6,-1],[11,26],[-12,26]],'#e1c799','#776051');
      path(c,[[-26,0],[-23,-13],[-11,-25],[4,-28],[19,-18],[26,0],[12,6],[-12,6]],col,'#64433d');
      for(const [x,y,r] of [[-14,-12,5],[0,-18,6],[13,-9,5],[-2,0,4]])ellipse(c,x,y,r,r*.65,'#e8d6b1');
      line(c,[[-9,23],[9,23]],'#baa377',2);break;
    case 'plushrat':
      c.beginPath();c.moveTo(15,7);c.bezierCurveTo(43,3,34,27,46,26);c.strokeStyle='#db9ca7';c.lineWidth=4;c.stroke();
      ellipse(c,0,5,25,16,col,'#4d4655');path(c,[[-17,-4],[-36,7],[-18,17]],col,'#4d4655');
      ellipse(c,-13,-9,9,10,col,'#4d4655');ellipse(c,-13,-9,5,6,'#d694a0');ellipse(c,-24,4,3,3,'#201f2c');ellipse(c,-34,8,3,3,'#da90a2');
      line(c,[[-32,10],[-43,7]],'#d9cfbd',1);line(c,[[-32,11],[-42,14]],'#d9cfbd',1);
      line(c,[[-4,-8],[2,0],[-3,9],[4,16]],'#6b5c68',1.5);line(c,[[0,0],[-5,2]],'#dfcba5',2);break;
    case 'balloon':
      ellipse(c,0,-3,17,22,col,'#593b67');path(c,[[-3,18],[3,18],[0,23]],col);line(c,[[0,23],[-4,30],[2,35]],'#dcc1da',1);ellipse(c,-6,-12,4,7,'#ffffff66');break;
    default:
      ellipse(c,0,0,prop.radius,prop.radius,col,'#33243d');ellipse(c,-prop.radius*.3,-prop.radius*.35,prop.radius*.27,prop.radius*.18,'#ffffff70');
      if(prop.id==='bowling')for(const [x,y] of [[2,-5],[7,0],[1,4]])ellipse(c,x,y,2.3,2.7,'#362549');
      if(prop.id==='apple') {line(c,[[0,-12],[3,-22]],'#785838',3);ellipse(c,8,-19,6,3,'#bfe875');} break;
  }
  c.restore();
}
// Every limb ends at the simulation's hand, even while the spine recoils.
const bounded = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
function impact(time, event, duration = .4) {
  return Number.isFinite(event) && time >= event ? Math.max(0, 1 - (time - event) / duration) : 0;
}
function localPoint(x, y, angle, pivot, bob) {
  const dy = y - pivot - bob;
  return [x * Math.cos(angle) + dy * Math.sin(angle), -x * Math.sin(angle) + dy * Math.cos(angle) + pivot];
}
function lettering(c, text, x, y, size, color = '#dce9a3', angle = 0) {
  c.save(); c.translate(x,y); c.rotate(angle); c.scale(1,-1); c.fillStyle=color;
  c.font=`900 ${size}px ui-monospace, monospace`; c.textAlign='center'; c.fillText(text,0,0); c.restore();
}
function punkFace(c, model, player, owner, drop, catchHit, rush) {
  const female=owner===1,moss=owner===2,time=model.time;
  const skin=moss?'#aa785a':female?'#bb946d':'#d7a57e';
  const hair=moss?'#69988b':female?'#f245aa':'#d58a42';
  const toss=impact(time,player.lastThrow,.33),pit=impact(time,player.lastCrowdThrow,.7);
  const force=bounded(catchHit*.65+toss*.4+Math.abs(rush)*.45+pit*.5,0,1);
  const mode=((Math.floor((model.beat??0)/4)+owner)%4+4)%4;
  const incoming=(model.objects??[]).filter(o=>o.owner===owner&&['air','replacement'].includes(o.phase)).sort((a,b)=>a.y-b.y)[0];
  const look=bounded(incoming?(incoming.x-player.x)/95:rush,-1,1)*5;
  const lookUp=incoming?bounded((incoming.y-270)/120,0,5):1;
  const jaw=8+force*13+drop*19,tilt=rush*.08+drop*(owner%2?-.12:.12)+catchHit*(owner%2?.045:-.045);
  const cheek=Math.sin(time*5+owner*2)*Math.abs(rush)*3;
  c.save();c.translate(rush*7,388+force*3);c.rotate(tilt);c.scale(1.25+force*.08,1+drop*.06);c.translate(0,-388);
  // Hair reacts with the enlarged, hinged face while palms remain in world space.
  if(moss) {
    for(let i=0;i<11;i++) {
      const a=i/10*Math.PI,x=Math.cos(a)*37,y=359+Math.sin(a)*40;
      path(c,[[x-10,y-5],[x-15,y+25+force*5],[x-4,y+15],[x+7,y+32+drop*8],[x+12,y+7],[x+10,y-12]],i%2?hair:'#49756e','#344d48',2);
    }
  } else if(female) {
    for(const side of [-1,1]) {
      path(c,[[side*17,377],[side*47,409+Math.sin(time*4+side)*8+force*8],[side*60,376],[side*47,384],[side*53,349-force*9],[side*30,365]],hair,'#742854',3);
      ellipse(c,side*30,385,9,5,'#baf276','#432840');
    }
  } else {
    for(let i=0;i<13;i++) {
      const a=i/12*Math.PI;
      ellipse(c,Math.cos(a)*35,356+Math.sin(a)*40,12,13,i%2?'#ba662f':hair,'#683c28');
    }
  }
  // A broad upper face and rubbery jaw make reactions readable on a phone.
  path(c,[[-29,386],[18,395],[36,376],[48+cheek,357],[35,347],[31,338-jaw],[9,326-jaw],[-17,335-jaw],[-31,359]],skin,'#513738',3);
  path(c,[[14,390],[33,376],[32,351],[15,357]],moss?'#bd926b':female?'#caa884':'#e9bb92',skin,0);
  ellipse(c,-27,350,8+force*2,6,'#b7736455');ellipse(c,33,349,8+force*2,6,'#bf796855');
  if(female) {
    path(c,[[-29,375],[-30,399],[-18,404],[-14,425],[-2,407],[7,427],[16,406],[29,415],[25,389],[8,397]],hair,'#742854',3);
    ellipse(c,-32,343-jaw*.25,6,11,null,'#f2da8b');
    line(c,[[37,347],[45,344]],'#ece3bd',2.5);
  }
  if(moss) {
    line(c,[[-29,389],[30,389]],'#a97987',9);
    ellipse(c,-10,391,13,11,'#59495d','#d6c17d');ellipse(c,20,391,13,11,'#59495d','#d6c17d');
    ellipse(c,-10,391,8,6,'#96c9b7');ellipse(c,20,391,8,6,'#a2bfe0');line(c,[[1,391],[7,391]],'#ddd09d',3);
    path(c,[[-21,336-jaw],[-15,320-jaw],[-5,311-jaw],[3,319-jaw],[10,306-jaw],[23,324-jaw],[30,340-jaw],[13,335-jaw],[0,338-jaw]],'#514638','#382e2f',2);
    ellipse(c,-32,342,7,9,null,'#b8cc92');
  }
  const eyeOpen=drop>.1?1.15:mode===1?.54:mode===3?.85:1;
  const leftY=369+drop*4+catchHit*2,rightY=367+drop*6-catchHit*2;
  const eyeWidth=12+drop*4+force*2,leftHeight=(8+force*4+drop*4)*eyeOpen,rightHeight=(9+force*3+drop*5)*(mode===3?.6:eyeOpen);
  ellipse(c,-7,leftY,eyeWidth,leftHeight,'#fff1cc','#7b5946');ellipse(c,24,rightY,eyeWidth-1,rightHeight,'#fff1cc','#7b5946');
  // Brows have different slopes: disbelief, snarling, manic delight, then a sneer.
  const brow=drop*10+force*6;
  line(c,[[-23,380+brow],[-9,389+brow],[7,380+brow-(mode===1?8:0)]],female?'#29212a':'#57352d',5);
  line(c,[[11,382+brow+(mode===3?5:0)],[25,382+brow],[39,391+brow-(mode===1?13:0)]],female?'#29212a':'#57352d',5);
  if(female) {
    line(c,[[-22,leftY+5],[-30,leftY+11]],'#2b2030',3);
    line(c,[[36,rightY+4],[44,rightY+10]],'#2b2030',3);
  }
  for(const [x,y,sign] of [[-7,leftY,-1],[24,rightY,1]]) {
    const px=x+look-sign*drop*3,py=y+lookUp;
    if(drop>.18) {
      c.beginPath();for(let i=0;i<=22;i++){const a=i*.55,r=1+i*.23;const x=px+Math.cos(a)*r,y=py+Math.sin(a)*r;if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.strokeStyle='#4b3b51';c.lineWidth=1.7;c.stroke();
    } else {
      ellipse(c,px,py,4.5+force,5.5+force*.5,moss?'#645272':female?'#435263':'#405944');
      ellipse(c,px,py,2.2,3.6,'#211d2a');ellipse(c,px-1.6,py+2,1.4,1.6,'#fff4d4');
    }
  }
  line(c,[[11,365],[19,352],[39+cheek,352]],'#8d6550',2.5);
  ellipse(c,30+cheek,350,3,2,'#624139');
  const mouthY=336-jaw*.35;
  if(drop>.1||mode===2) {
    // A cavernous howl, with an offset tongue, cheek creases and two bad teeth.
    ellipse(c,9,mouthY,17+force*6,12+jaw*.52,'#482330','#8d514e');
    path(c,[[-3,mouthY+12],[4,mouthY+14],[5,mouthY+4],[-2,mouthY+3]],'#f4dfb3','#d0b793',1);
    path(c,[[8,mouthY+14],[16,mouthY+12],[14,mouthY+3],[8,mouthY+4]],'#f4dfb3','#d0b793',1);
    ellipse(c,13,mouthY-jaw*.35,9,4+force*3,'#e77d8d');
    line(c,[[-17,mouthY+6],[-22,mouthY-5]],'#8f554b',2);line(c,[[32,mouthY+7],[37,mouthY-5]],'#8f554b',2);
  } else if(mode===1) {
    const teeth=[[-14,mouthY+11],[28,mouthY+13],[34,mouthY-7],[-14,mouthY-5]];
    path(c,teeth,'#4b2334','#8d514e',2);
    path(c,[[-12,mouthY+9],[27,mouthY+10],[29,mouthY+1],[-13,mouthY+1]],'#f4dfb3','#f4dfb3',0);
    path(c,[[-12,mouthY-1],[29,mouthY-1],[31,mouthY-5],[-12,mouthY-3]],'#ddc58c','#ddc58c',0);
    for(let i=0;i<5;i++)line(c,[[-7+i*8,mouthY+9],[-6+i*8,mouthY+1]],'#775953',1.4);
    line(c,[[-19,mouthY+11],[-25,mouthY+18]],'#8f554b',2);
  } else if(mode===3) {
    ellipse(c,12,mouthY,14,9+force*4,'#b66b77','#753d49');ellipse(c,14,mouthY,7,6+force*3,'#452534');
    line(c,[[-17,346],[-21,337],[-17,331]],'#8d554b',2);line(c,[[33,345],[39,337],[36,331]],'#8d554b',2);
  } else {
    path(c,[[-17,mouthY+14],[31,mouthY+17],[35,mouthY+4],[20,mouthY-14],[2,mouthY-13],[-15,mouthY+1]],'#512331','#8d514e',2);
    path(c,[[-14,mouthY+12],[28,mouthY+14],[25,mouthY+5],[-8,mouthY+3]],'#f3dfb3','#d2b68b',1);
    for(let i=0;i<4;i++)line(c,[[-5+i*8,mouthY+12],[-3+i*8,mouthY+4]],'#846052',1.5);
    // Tongue travel comes from the throw impulse and direction of the unicycle.
    const tongueX=19+Math.sin(time*7+owner)*force*8+rush*5;
    path(c,[[4,mouthY-7],[20,mouthY-5],[tongueX+10,mouthY-17-force*10],[tongueX+4,mouthY-23-force*12],[tongueX-6,mouthY-20-force*8]],'#e78292','#9d4a64',1.5);
    line(c,[[14,mouthY-10],[tongueX+1,mouthY-18-force*7]],'#b35272',1.5);
  }
  if(drop>.12)for(const [x,y,side] of [[-35,380,-1],[42,380,1],[-32,350,-1]]) {
    line(c,[[x,y],[x+side*(7+drop*7),y+9+drop*7]],'#aecfd1',3);
    ellipse(c,x+side*(10+drop*8),y+14+drop*7,2,3,'#b3dbe0');
  }
  if(owner===0)for(const side of [-1,1])for(let j=0;j<3;j++)ellipse(c,side*33,370-j*14,8,10,j%2?'#d89342':'#a8602f','#744326');
  c.restore();
  if(owner===0) {
    // The hat stays recognizable while the face underneath goes rubbery.
    c.save();c.translate(rush*7,398+force*3);c.rotate(tilt-rush*.055-drop*.07);c.translate(0,-398);
    ellipse(c,0,398,73,15,'#082f28','#061e20');
    const hat=c.createLinearGradient(-42,0,42,0);hat.addColorStop(0,'#075a40');hat.addColorStop(.45,'#1db66a');hat.addColorStop(.75,'#138d54');hat.addColorStop(1,'#064737');
    path(c,[[-42,402],[-39,503],[36,506],[44,402]],hat,'#033d2c',3);
    for(let row=0;row<5;row++)for(let col=0;col<3;col++) {
      const x=-28+col*26+(row%2?5:0);if(x>38)continue;
      ellipse(c,x,415+row*19,8,6,'#94b78a','#a9bd90');ellipse(c,x,415+row*19,4,3,'#5b956f');
    }
    ellipse(c,-1,505,38,9,'#279d62','#085138');ellipse(c,-6,508,27,4,'#79dd8655');
    c.restore();
  }
}
export function drawPuggler(c, model, owner = 0, horizontalRatio = 1) {
  const player=model.players?.[owner] ?? model;
  if(!player)return;
  const female=owner===1,moss=owner===2,time=model.time,wheel=player.wheel||0;
  const caught=impact(time,player.lastCatch,.35),drop=impact(time,player.lastDrop,.9);
  const rush=bounded(player.vx/280,-1.4,1.4);
  const recoil=bounded(player.recoil,-1,1);
  const lean=bounded(player.lean,-.28,.28) + rush*.1 + recoil*.055;
  const bob=Math.sin(wheel*2)*5 + caught*7 - Math.abs(recoil)*8 - drop*8;
  const skin=moss?'#aa785a':female?'#bb946d':'#d3a381',darkSkin=moss?'#604735':female?'#624b3d':'#644233';
  const cycle=moss?'#ccac62':female?'#5be0b5':'#e84c67';
  c.save();c.translate(player.x*horizontalRatio,0);
  ellipse(c,0,-2,90,12,'#00000088');
  // Tyre, spokes and pedals follow travelled wheel distance, not a clock.
  c.save();c.translate(0,57);c.rotate(-wheel);
  ellipse(c,0,0,54,54,'#110f15','#979084');ellipse(c,0,0,43,43,'#302a35','#aaa2a0');
  for(let i=0;i<12;i++){const a=i*TAU/12;line(c,[[0,0],[Math.cos(a)*43,Math.sin(a)*43]],i%3?'#a39aa0':'#eaba92',1.4);}
  ellipse(c,0,0,8,8,cycle);c.restore();
  line(c,[[0,57],[rush*8,178]],cycle,10);
  line(c,[[-24+rush*8,177],[29+rush*8,177]],'#231923',13);
  const pedalA=[Math.cos(wheel)*32,57+Math.sin(wheel)*32],pedalB=[-Math.cos(wheel)*32,57-Math.sin(wheel)*32];
  const hip=[lean*-30,197+bob];
  line(c,[[hip[0]-18,hip[1]],[-49+lean*15,126+Math.sin(wheel)*18],pedalA],moss?'#58615a':female?'#352735':'#54233b',25);
  line(c,[[hip[0]+19,hip[1]],[44+lean*15,129-Math.sin(wheel)*18],pedalB],moss?'#6b7462':female?'#4a3045':'#763047',27);
  if(moss) {
    path(c,[[pedalA[0]-14,pedalA[1]+6],[pedalA[0]+15,pedalA[1]+6],[-39,136],[-58,126]],'#58615a','#454940',1);
    path(c,[[pedalB[0]-18,pedalB[1]+6],[pedalB[0]+18,pedalB[1]+6],[50,133],[31,139]],'#707964','#454940',1);
    path(c,[[-39,140],[-28,133],[-35,111],[-49,117]],'#ae826c','#d5bca0',1);
    path(c,[[31,126],[50,121],[46,104],[34,109]],'#957f9b','#c8b5aa',1);
  } else if(female) {
    line(c,[[-45,130+Math.sin(wheel)*18],[-34,122+Math.sin(wheel)*18]],skin,8);
    line(c,[[34,144-Math.sin(wheel)*18],[44,140-Math.sin(wheel)*18]],skin,9);
    for(let j=0;j<4;j++)line(c,[[-41+j*3,116],[-38+j*3,126]],'#9b799660',1.5);
  }
  line(c,[[pedalA[0]-19,pedalA[1]+1],[pedalA[0]+19,pedalA[1]-4]],'#17121b',14);
  line(c,[[pedalB[0]-17,pedalB[1]+2],[pedalB[0]+25,pedalB[1]-4]],'#241923',15);
  line(c,[[pedalB[0]-17,pedalB[1]-6],[pedalB[0]+26,pedalB[1]-6]],female?'#e7eaaf':'#d4a98c',3);
  line(c,[pedalA,[0,57],pedalB],'#c2b3a2',4);
  c.save();c.translate(0,190+bob);c.rotate(lean);c.translate(0,-190);
  path(c,[[-39,314],[34,314],[49,278],[36,195],[-36,195],[-51,272]],moss?'#866d8e':female?'#28262c':'#593457','#211926',3);
  if(moss) {
    for(const [x,y,rx,ry,color] of [[-7,271,30,36,'#859479'],[8,272,23,28,'#c18e78'],[1,275,15,20,'#d4b275'],[0,276,7,11,'#8799a2']])ellipse(c,x,y,rx,ry,color);
    path(c,[[-39,311],[-20,292],[-23,215],[-40,204],[-50,275]],'#8c6f50','#4e4938',2);
    path(c,[[34,311],[19,292],[23,217],[39,206],[47,279]],'#777f5b','#4e4938',2);
    for(let j=0;j<5;j++){line(c,[[-34+j*5,216],[-33+j*5,198-j%2*6]],'#bdb78a',2);line(c,[[20+j*5,216],[19+j*5,198-j%2*6]],'#bdb78a',2);}
    path(c,[[-39,279],[-23,280],[-24,261],[-41,265]],'#839ca3','#d9c6a6',1);
    path(c,[[23,252],[42,255],[39,237],[24,234]],'#b28b90','#d9c6a6',1);
    ellipse(c,31,285,8,8,'#c6bb78','#67583e');line(c,[[31,293],[31,277]],'#665e49',1.5);line(c,[[31,285],[25,279]],'#665e49',1.5);line(c,[[31,285],[37,279]],'#665e49',1.5);
    line(c,[[-14,316],[-4,294],[10,316]],'#e6d3aa',2);ellipse(c,-3,294,5,6,'#afc4a1','#657458');
  } else if(female) {
    path(c,[[-39,304],[-13,291],[-19,239],[-41,218],[-48,277]],'#642e43');
    path(c,[[34,304],[12,292],[19,239],[40,221],[47,278]],'#6e3248');
    for(let j=0;j<5;j++)line(c,[[-44,235+j*13],[-20,230+j*13]],'#c99d7455',4);
    for(let j=0;j<5;j++)line(c,[[23,229+j*14],[42,234+j*14]],'#c99d7455',4);
    line(c,[[-33,301],[-19,285],[-31,268]],'#d8cca5',3);line(c,[[27,300],[16,285],[29,270]],'#d8cca5',3);
    ellipse(c,0,273,11,13,'#d2d5a8');ellipse(c,-4,276,3,4,'#24242c');ellipse(c,5,275,3,4,'#24242c');
    line(c,[[-5,259],[5,259]],'#e5d7a8',3);
    for(let i=0;i<6;i++)ellipse(c,-30+i*12,209,2,2,'#d7d4b4');
    line(c,[[34,208],[55,183],[48,150],[29,147]],'#b9b0a4',3);
  } else {
    path(c,[[-45,294],[44,292],[47,270],[-49,273]],'#cd3e77','#cd3e77',0);
    path(c,[[-45,249],[42,249],[38,228],[-41,229]],'#d5427a','#d5427a',0);
    path(c,[[-35,196],[36,196],[29,209],[-36,213]],'#422038');
  }
  path(c,[[-13,340],[17,340],[19,310],[2,301],[-16,314]],skin,darkSkin,2);
  if(female)line(c,[[-16,320],[18,319]],'#272129',7);
  else if(!moss) {
    path(c,[[-2,312],[10,315],[10,299],[4,294],[-2,300]],'#a8d94b');
    path(c,[[4,294],[12,289],[-1-rush*12,231],[-13-rush*12,220],[-16-rush*10,235]],'#9bc942','#466729');
  }
  for(let hand=0;hand<2;hand++) {
    const sign=hand?1:-1,h=model.handPosition(hand,owner);
    const flash=bounded(((player.flash?.[hand]??-10)-time)/.2,0,1);
    // Undo the torso transform so the palm stays on the catch coordinate.
    const [hx,hy]=localPoint((h.x-player.x)*horizontalRatio,h.y,lean,190,bob);
    const shoulder=[sign*41,303];
    const flail=Math.sin(time*5+hand*2+owner)*Math.min(1,Math.abs(rush)+Math.abs(recoil)+caught);
    const elbow=[bounded(sign*(106+Math.abs(rush)*27)+flail*15,-player.x*horizontalRatio+12,(WORLD.width-player.x)*horizontalRatio-12),226+flash*16+flail*22-drop*22];
    line(c,[shoulder,elbow,[hx,hy]],darkSkin,18);
    line(c,[[shoulder[0],shoulder[1]+2],[elbow[0],elbow[1]+2],[hx,hy]],skin,12);
    line(c,[[elbow[0]-7,elbow[1]+1],[elbow[0]+6,elbow[1]-3]],female?'#2c2830':'#7d493e',4);
    const wrist=[hx*.88+elbow[0]*.12,hy*.88+elbow[1]*.12];
    line(c,[[wrist[0]-6,wrist[1]+1],[wrist[0]+6,wrist[1]-1]],female?'#22212a':'#544138',6);
    if(female)for(let j=0;j<3;j++)ellipse(c,wrist[0]-5+j*5,wrist[1]+2,1.8,2,'#e5daab');
    ellipse(c,hx,hy,14,9,skin,darkSkin);
    for(let j=0;j<4;j++)line(c,[[hx-8+j*5,hy],[hx-12+j*7+sign*flash*3,hy+12+flash*5]],skin,3.5);
  }
  punkFace(c,model,player,owner,drop,caught,rush);
  c.restore();
  c.restore();
}
function amplifier(c,x,y,width,height,color) {
  c.save();c.translate(x,y);
  path(c,[[0,0],[width,0],[width-3,height],[4,height]],'#201d23','#7b6d61',2);
  c.fillStyle='#34312f';c.fillRect(8,13,width-16,height-27);
  for(let i=0;i<8;i++)line(c,[[10,19+i*(height-32)/8],[width-10,19+i*(height-32)/8]],'#72665435',2);
  ellipse(c,width*.5,height*.35,width*.25,width*.25,'#211e24','#5c5151');
  ellipse(c,width*.5,height*.72,width*.23,width*.23,'#252129','#5c5151');
  ellipse(c,width*.5,height*.35,6,6,'#443837');
  line(c,[[12,height-10],[width-12,height-10]],color,3);
  lettering(c,'NO FUTURE',width*.5,6,Math.max(6,width*.095),'#cbb898');
  path(c,[[width-30,height-22],[width-11,height-29],[width-16,height-43],[width-34,height-37]],'#d6c09566','#d6c09555',1);
  c.restore();
}
// Hand-lettered fictional bills: shuffle changes the wall, never the performance.
const POSTER_BILLS = [
  ['THRASH','TRASH','star'], ['SNOT','RIOT!','skull'], ['HOT','GARBAGE','slime'], ['BIN','RATS','rat'],
  ['CRUST','BUCKET','skull'], ['GRIME','TIME','star'], ['BIN','JUICE','slime'], ['SKUNK','WRESTLE','rat'],
  ['RUST','TEETH','skull'], ['FILTH','FREQUENCY','star'], ['SEWER','SERENADE','slime'], ['NOISE','GOBLIN','rat'],
  ['GUTTER','CHOIR','skull'], ['BENT','NAILS','star'], ['SLUDGE','PUNCH','slime'], ['FLEA','CIRCUS','rat'],
  ['SQUAT','ROT','skull'], ['TRASH','PANIC','star'], ['MOLD','PATROL','slime'], ['DAMP','SOCKS','rat'],
  ['RANCID','RACKET','skull'], ['SNOT','ROCKET','star'], ['GOO','CREW','slime'], ['GARBAGE','GOBLINS','rat'],
  ['BROKEN','TEETH','skull'], ['DIRT','DRUMS','star'], ['PUNK','PUKE','slime'], ['WORM','AMPLIFIER','rat'],
  ['SHRIEK','& REEK','skull'], ['CRUST','CONTROL','star'], ['FEEDBACK','FUNGUS','slime'], ['MYSTERY','GRISTLE','rat'],
  ['DOOM','LAUNDRY','skull'], ['SICK','RIFFS','star'], ['HOT','SWEATPANTS','slime'], ['TRASH','GREMLINS','rat'],
  ['STINK','MACHINE','skull'], ['NASTY','RACKET','star'], ['SWEAT','SOUP','slime'], ['SCAB','CABARET','rat'],
];
const POSTER_GROUPS=['star','skull','slime','rat'].map(kind=>POSTER_BILLS.filter(bill=>bill[2]===kind));
function poster(c,bill,paper) {
  path(c,[[-43,-51],[41,-50],[44,36],[29,39],[23,32],[9,42],[-1,34],[-14,40],[-41,35]],paper,'#30282d',2);
  c.fillStyle='#3b3035';c.textAlign='center';
  for(let i=0;i<2;i++) {
    c.font=`900 ${Math.min(i?18:20,76/(bill[i].length*.63))}px ui-monospace,monospace`;
    c.fillText(bill[i],0,-27+i*20);
  }
  const ink='#4d4246';
  if(bill[2]==='skull') {
    ellipse(c,0,11,11,11,ink);path(c,[[-7,15],[7,15],[6,25],[-6,25]],ink,ink,0);
    ellipse(c,-4,11,3,4,paper);ellipse(c,4,11,3,4,paper);path(c,[[0,15],[-2,18],[2,18]],paper,paper,0);
    for(let i=0;i<3;i++)line(c,[[-4+i*4,21],[-4+i*4,25]],paper,1.4);
  } else if(bill[2]==='star') {
    const points=Array.from({length:10},(_,i)=>{const a=i*Math.PI/5-Math.PI/2,r=i%2?5:13;return[Math.cos(a)*r,14+Math.sin(a)*r];});
    path(c,points,ink,ink,1);
  } else if(bill[2]==='slime') {
    path(c,[[-12,10],[-8,4],[-1,8],[5,3],[12,10],[13,18],[8,19],[8,26],[4,26],[3,18],[-2,20],[-3,29],[-7,27],[-7,19],[-13,19]],ink,ink,1);
    ellipse(c,-5,11,2,2,paper);ellipse(c,5,12,2,2,paper);
  } else {
    ellipse(c,1,17,11,7,ink);path(c,[[-7,12],[-17,16],[-8,22]],ink,ink,1);
    ellipse(c,-7,10,4,5,ink);ellipse(c,-11,16,1.2,1.2,paper);
    c.beginPath();c.moveTo(10,18);c.bezierCurveTo(23,13,11,5,21,3);c.strokeStyle=ink;c.lineWidth=2;c.stroke();
  }
  line(c,[[-31,30],[26,30]],'#4c393960',1.3);
}
function stage(c,w,h,model,view) {
  const floor=view.oy,time=model.time;
  const background=c.createLinearGradient(0,0,0,h);background.addColorStop(0,'#120f13');background.addColorStop(.48,'#302028');background.addColorStop(1,'#161419');
  c.fillStyle=background;c.fillRect(0,0,w,h);
  // Stained brickwork, torn fly-posters and ragged velvet side curtains.
  const brickW=84,brickH=39;
  for(let row=0;row<Math.ceil(h*.82/brickH);row++)for(let col=-1;col<w/brickW;col++) {
    const x=col*brickW+(row%2)*brickW*.5,y=row*brickH;
    c.strokeStyle=(row+col)%3?'#84605213':'#b8856618';c.lineWidth=2;c.strokeRect(x+3,y+4,brickW-7,brickH-7);
    if((row*7+col*3)%11===0){c.fillStyle='#211c2148';c.fillRect(x+7,y+9,brickW*.75,brickH*.8);}
  }
  // Long water stains, a leaking pipe and old spray paint break up the masonry.
  for(let i=0;i<22;i++) {
    const x=((i*157+39)%1000)/1000*w,y=34+(i*71%130),length=35+(i*37%170);
    line(c,[[x,y],[x+2,y+length*.6],[x-2,y+length]],i%3?'#77824c10':'#9f72451a',3+i%5);
    if(i%3===0)ellipse(c,x-2,y+length,3,7,'#6e7c4924');
  }
  line(c,[[w*.07,52],[w*.3,52],[w*.3,77]],'#71634b',6);
  line(c,[[w*.3,76],[w*.3-2,95],[w*.3+1,121]],'#7a986855',3);
  const graffiti=Math.min(w/1100,1);
  c.save();c.translate(w*.76,h*.59);c.rotate(-.18);c.scale(graffiti,graffiti);
  ellipse(c,0,0,30,32,null,'#a55e7244');line(c,[[-20,24],[0,-26],[21,26]],'#a55e7266',5);line(c,[[-26,5],[27,-2]],'#a55e7266',5);c.restore();
  for(const side of [0,1]) {
    c.save();if(side){c.translate(w,0);c.scale(-1,1);}
    path(c,[[0,0],[w*.09,0],[w*.073,h*.25],[w*.084,h*.55],[w*.047,floor-8],[0,floor+10]],'#432030','#281724',2);
    for(let i=0;i<4;i++)line(c,[[i*w*.017,0],[i*w*.014,h*.4],[i*w*.01,floor-7]],i%2?'#69334466':'#25162299',6);
    c.restore();
  }
  const posterScale=Math.min(1.15,Math.max(.72,w/850));
  const posterSeed=(Number(model.posterSeed??model.config.posterSeed??1981)>>>0);
  const papers=['#b6b38e','#a77e91','#91a184','#b49b7b','#afa582','#84a3a0'];
  for(let i=0;i<4;i++) {
    const bank=POSTER_GROUPS[i],bill=bank[(posterSeed+i*3)%bank.length];
    c.save();c.translate(w*(.14+i*.24),h*(i%2?.33:.21));c.rotate(((posterSeed+i*11)%9-4)*.035);c.scale(posterScale,posterScale);
    poster(c,bill,papers[(posterSeed+i*5)%papers.length]);c.restore();
  }
  // Fixed broad beams breathe gently with performance; no strobe effects.
  const performers=model.activePlayers??model.players??[model];
  const energy=Math.min(1,Math.max(0,...performers.map(p=>Math.abs(p.vx||0)))/350+Math.max(0,...performers.map(p=>impact(time,p.lastCatch,.8)))*.2);
  for(let i=0;i<3;i++) {
    const x=w*(.16+i*.34),end=w*(.2+i*.31)+Math.sin(time*.35+i)*w*.04;
    path(c,[[x-7,23],[x+7,23],[end+w*.16,floor],[end-w*.16,floor]],i%2?'#bf648111':'#bdce5e0c','#ffffff00',0);
    ellipse(c,x,23,15,7,i%2?'#c482aa':'#bdc57c','#211d22');
    ellipse(c,x,23,8+energy,3,i%2?'#d99bbb66':'#e3e39477');
  }
  line(c,[[0,14],[w,14]],'#575052',6);line(c,[[0,32],[w,32]],'#3c343c',3);
  for(let x=0;x<w;x+=70){line(c,[[x,14],[x+55,32]],'#544b4d',2);line(c,[[x,32],[x+55,14]],'#544b4d',2);}
  // Backline stays visually behind the performers and their flight paths.
  const equipment=Math.min(w/1030,view.scaleY*.88),backY=floor-12;
  c.save();c.translate(w*.09,backY);c.scale(equipment,-equipment);amplifier(c,-65,0,115,168,'#d58a87');amplifier(c,-57,177,99,79,'#b9c26e');c.restore();
  c.save();c.translate(w*.91,backY);c.scale(equipment,-equipment);amplifier(c,-52,0,115,180,'#9bb395');amplifier(c,-43,189,99,69,'#d28cad');c.restore();
  c.save();c.translate(w*.5,backY-12);c.scale(equipment,-equipment);
  ellipse(c,0,62,60,59,'#473642','#948171');ellipse(c,0,62,47,47,'#24212a','#6c6261');
  lettering(c,'TRASH',0,70,19,'#a79886');lettering(c,'OR DIE',0,48,13,'#a79886');
  for(const side of [-1,1]) {
    line(c,[[side*86,4],[side*86,171]],'#847977',4);line(c,[[side*86,8],[side*115,0]],'#847977',3);line(c,[[side*86,8],[side*65,0]],'#847977',3);
    ellipse(c,side*86,171,45,5,'#968d5b','#534e37');
    path(c,[[side*20-23,98],[side*20+23,98],[side*20+27,127],[side*20-26,127]],'#854858','#483b43',2);
    ellipse(c,side*20,127,27,7,'#aea58d','#746657');
  }
  line(c,[[-43,17],[-51,0]],'#988a84',3);line(c,[[43,17],[51,0]],'#988a84',3);c.restore();
  const floorFill=c.createLinearGradient(0,floor-8,0,h);floorFill.addColorStop(0,'#494037');floorFill.addColorStop(1,'#17161a');
  c.fillStyle=floorFill;c.fillRect(0,floor-8,w,h-floor+8);
  line(c,[[0,floor-8],[w,floor-8]],'#9c82625c',2);
  for(let i=0;i<16;i++)line(c,[[i*w/15,floor-6],[i*w/15-35,h]],'#a08c6930',1);
  for(let i=0;i<9;i++) {
    const x=((i*173+73)%1000)/1000*w,y=floor+4+(i*17%35);
    ellipse(c,x,y,18+(i*11%23),3+(i%3),'#7d936b28');
    line(c,[[x-10,y],[x+12,y]],'#b8ac7555',1);
  }
  c.beginPath();c.moveTo(w*.12,floor+8);c.bezierCurveTo(w*.78,floor-9,w*.31,h+9,w*.91,floor+15);c.strokeStyle='#101014';c.lineWidth=4;c.stroke();
  for(const side of [0,1]) {
    const gx=w*(side?.97:.025),gy=floor+17,gs=Math.min(.85,view.scaleY);
    c.save();c.translate(gx,gy);c.scale(gs,gs);
    path(c,[[-23,13],[-25,-5],[-12,-27],[-13,-36],[-2,-33],[5,-34],[11,-25],[26,-6],[23,14]],'#252c23','#4a4c33',2);
    line(c,[[-10,-23],[-15,5]],'#84916133',3);line(c,[[7,-21],[17,6]],'#84916133',3);
    path(c,[[-27,16],[31,16],[20,28],[-39,26]],'#8d7650','#372e24',2);
    path(c,[[-15,16],[13,18],[4,25]],'#ad864e','#56442d',1);
    ellipse(c,2,20,3,2,'#714635');c.restore();
  }
  for(let i=0;i<10;i++) {
    const x=((i*213+47)%1000)/1000*w,y=floor+11+(i*13%29);
    c.save();c.globalAlpha=.62;drawProp(c,{id:i%3?'can':'bottle',color:i%3?'#a89573':'#768e5a'},x,y,i*.8,.34+equipment*.2);c.restore();
  }
}
function audience(c,w,h,model,view) {
  const time=model.time,reaction=model.lastCrowdReaction;
  const cheer=reaction?.kind==='crowd-woo'?impact(time,reaction.time,.9):0;
  const boo=Math.max(impact(time,model.lastDrop,1.35),reaction?.kind==='crowd-boo'?impact(time,reaction.time,.9):0);
  const movement=Math.max(0,...(model.activePlayers??model.players??[model]).map(p=>Math.abs(p.vx||0)));
  const count=Math.ceil(w/43);
  for(let i=0;i<count;i++) {
    const x=i*w/(count-1),bounce=Math.sin(time*3+i*1.7)*(2+Math.min(2,movement/100))-cheer*(8+(i%3)*3);
    const y=h+8+bounce-(i%3)*4,up=Math.max(boo*18,cheer*28,Math.max(0,Math.sin(time*2.4+i*2))*11);
    const col=i%2?'#0a090e':'#151117';
    ellipse(c,x,y-17,12+i%3,15,col);ellipse(c,x,y+10,25,25,col);
    if(Math.max(boo,cheer)>.15&&i%2===0){ellipse(c,x-4,y-22,1.5,2,'#867b73');ellipse(c,x+4,y-22,1.5,2,'#867b73');ellipse(c,x,y-13,4+boo*2,3+cheer*4,'#83646b');}
    if(i%3!==1) {
      const sign=i%2?1:-1,handX=x+sign*26,handY=y-43-up;
      line(c,[[x+sign*12,y+1],[x+sign*29,y-15],[handX,handY]],col,8);
      ellipse(c,handX,handY,7,8,col);
      line(c,[[handX-5,handY],[handX-7,handY-13]],col,3.5);
      line(c,[[handX+5,handY],[handX+7,handY-12]],col,3.5);
    }
    if(i%5===0)path(c,[[x-12,y-26],[x-6,y-45],[x,y-30],[x+5,y-47],[x+11,y-28]],'#28162b',col,2);
  }
  const throws=(model.audienceThrows?.length?model.audienceThrows:model.lastAudienceThrow?[model.lastAudienceThrow]:[]).slice(-8);
  const recentCatch=typeof model.lastCrowdCatch==='object'?model.lastCrowdCatch:{time:model.lastCrowdCatch,x:WORLD.width*.5};
  const gestures=[...throws.map(event=>({...event,kind:'throw'})),{...recentCatch,kind:'catch'}];
  for(const gesture of gestures) {
    const energy=impact(time,gesture.time,gesture.kind==='throw'?.85:1.1);
    if(energy<=0||!Number.isFinite(gesture.x))continue;
    const x=view.point(gesture.x,0).x,y=h-8;
    const hand=view.point(gesture.x,gesture.y??32),lift=energy*24;
    const direction=(model.players?.[gesture.owner]?.x??500)>gesture.x?1:-1;
    const color=gesture.kind==='throw'?'#99867a':'#a59a79';
    ellipse(c,x-direction*15,y-10,13,15,'#211a22','#756256');
    line(c,[[x-direction*28,y+15],[x-direction*20,y-4],[hand.x,hand.y+24-lift]],'#2b2228',11);
    line(c,[[x-direction*28,y+15],[x-direction*20,y-4],[hand.x,hand.y+24-lift]],color,5);
    ellipse(c,hand.x,hand.y+24-lift,6,7,color,'#43303a');
    for(let j=0;j<4;j++)line(c,[[hand.x-5+j*3,hand.y+22-lift],[hand.x-7+j*4,hand.y+13-lift]],color,2);
    if(gesture.kind==='catch') {
      const other=hand.x+direction*23;
      line(c,[[x+direction*6,y+9],[x+direction*23,y-12],[other,hand.y+27-lift]],color,6);
      ellipse(c,other,hand.y+25-lift,6,6,color);
    }
  }

}
export class PugglerRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.c=canvas.getContext('2d',{alpha:false});this.top=1200;
    this.view={scale:1,scaleY:1,ox:0,oy:0};
  }
  worldX(clientX) {
    const r=this.canvas.getBoundingClientRect();return (clientX-r.left-this.view.ox)/this.view.scale;
  }
  draw(model, params = {}) {
    const c=this.c,canvas=this.canvas,rect=canvas.getBoundingClientRect(),dpr=Math.min(globalThis.devicePixelRatio||1,2);
    const w=Math.max(1,rect.width),h=Math.max(1,rect.height);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    c.setTransform(dpr,0,0,dpr,0,0);
    const bodies=(model.objects??[]).filter(o=>o.phase!=='waiting'&&o.phase!=='gone');
    let highest=720;
    for(const o of bodies) {
      if(!['air','replacement','audience'].includes(o.phase))continue;
      highest=Math.max(highest,o.y+100);
      if(o.flight) {
        const f=o.flight,apex=f.k<1e-6?f.vy/f.g:Math.log1p(Math.max(0,f.vy)*f.k/f.g)/f.k;
        const at=flightPosition(f,Math.min(o.duration??apex,Math.max(0,apex))).y;
        if(Number.isFinite(at))highest=Math.max(highest,at+100);
      }
    }
    this.top=highest>this.top?highest:this.top+(highest-this.top)*.035;
    const activePlayers=Array.isArray(model.activePlayers)?model.activePlayers:(model.activeIds??[0]).map(id=>model.players?.[id]??model);
    const sx=w/1030,sy=Math.max(.22,Math.min(.8,(h-80)*.59/510)),ox=(w-WORLD.width*sx)/2,oy=h-56;
    const shoulder=540,shoulderPixels=shoulder*sy,upperPixels=Math.max(25,oy-shoulderPixels-31);
    const compressedTop=Math.log1p(Math.max(1,this.top-shoulder)/280);
    const yMap=y=>y<=shoulder?y*sy:shoulderPixels+Math.log1p((y-shoulder)/280)/compressedTop*upperPixels;
    const point=(x,y)=>({x:ox+x*sx,y:oy-yMap(y)});
    this.view={scale:sx,scaleY:sy,ox,oy,point};
    stage(c,w,h,model,this.view);
    const guideSteps=bodies.length>6?24:42;
    if(params.guides)for(const o of model.objects??[]) {
      if(!['air','replacement','audience'].includes(o.phase)||!o.flight)continue;
      c.beginPath();for(let i=0;i<=guideSteps;i++){const p=flightPosition(o.flight,(o.duration||.5)*i/guideSteps),s=point(p.x,p.y);if(i)c.lineTo(s.x,s.y);else c.moveTo(s.x,s.y);}
      c.setLineDash([4,7]);c.lineWidth=1.2;c.strokeStyle=o.prop.color+'55';c.stroke();c.setLineDash([]);
      const end=flightPosition(o.flight,o.duration||.5);
      const target=point(o.targetX??end.x,o.phase==='audience'?end.y:WORLD.handY);
      ellipse(c,target.x,target.y,Math.max(7,(model.config.assist||50)*sx),4,null,o.prop.color+'77');
    }
    // Arm geometry is uniformly scaled; only position/palm endpoints span world X.
    c.save();c.translate(ox,oy);c.scale(sy,-sy);
    for(const player of activePlayers)drawPuggler(c,model,player.id??0,sx/sy);
    c.restore();
    for(const o of [...(model.debris??[]),...bodies]) {
      if(params.trails&&o.trail?.length>1) {
        c.beginPath();o.trail.forEach(([x,y],i)=>{if(bodies.length>6&&i%2&&i!==o.trail.length-1)return;const p=point(x,y);if(i)c.lineTo(p.x,p.y);else c.moveTo(p.x,p.y);});
        c.lineWidth=Math.max(2,sy*5);c.strokeStyle=o.prop.color+'80';c.stroke();
        if(o.phase==='air'&&o.fromOwner!==undefined&&o.fromOwner!==o.owner) {
          c.setLineDash([2,7]);c.lineWidth=1;c.strokeStyle='#f6d48a90';c.stroke();c.setLineDash([]);
        }
      }
      const p=point(o.x,o.y),size=sy*(o.phase==='floor'?1.45:1.8);
      drawProp(c,o.color?{...o.prop,color:o.color}:o.prop,p.x,p.y,o.spin??0,size);
      const player=model.players?.[o.owner??0]??model;
      if(o.phase==='held'&&(player.flash?.[o.hand]??0)>model.time) {
        const flash=bounded(((player.flash[o.hand]-model.time)/.2),0,1);
        ellipse(c,p.x,p.y,Math.max(12,sy*(30+(1-flash)*28)),Math.max(12,sy*(30+(1-flash)*28)),null,o.prop.color);
        for(let j=0;j<5;j++){const a=j*TAU/5;line(c,[[p.x+Math.cos(a)*sy*32,p.y+Math.sin(a)*sy*32],[p.x+Math.cos(a)*sy*47,p.y+Math.sin(a)*sy*47]],o.prop.color+'c0',2);}
      }
    }
    for(const player of activePlayers)if(impact(model.time,player.lastKick,.22)>0) {
      const p=point(player.x,75);c.strokeStyle='#d5f58c';c.lineWidth=3;c.beginPath();c.arc(p.x,p.y,85*sy,-1.2,.2);c.stroke();
    }
    audience(c,w,h,model,this.view);
  }
}
