import { WORLD } from './puggler.js';

// Original fictional pastiche and speculative 3026 designs, not reconstructions
// of any one historical culture, named portrait, technology or instrument.
const TAU=Math.PI*2;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,Number(n)||0));
const pulse=(time,at,duration=.4)=>Number.isFinite(at)?clamp(1-(time-at)/duration,0,1)*(time>=at):0;
const PALETTES={
  history:[{skin:'#bb855d',edge:'#63483c',cloth:'#a97743',trim:'#e0c391',wheel:'#857d68'},
    {skin:'#cfad84',edge:'#624c43',cloth:'#607b85',trim:'#c9bc83',wheel:'#a17b4e'},
    {skin:'#e0b69a',edge:'#865f55',cloth:'#a9444e',trim:'#e1bd76',wheel:'#c8a65d'}],
  future:[{skin:'#b87c60',edge:'#563c45',cloth:'#345d87',trim:'#81e7dc',wheel:'#7cddd9'},
    {skin:'#97698a',edge:'#4f344e',cloth:'#6651a0',trim:'#ef98d1',wheel:'#e9a2d6'},
    {skin:'#a1c894',edge:'#3e695f',cloth:'#557d75',trim:'#e4c886',wheel:'#aa9dd3'}],
};
function oval(c,x,y,rx,ry,fill,stroke,width=2){c.beginPath();c.ellipse(x,y,rx,ry,0,0,TAU);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}
function line(c,points,color,width=2){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();}
function shape(c,points,fill,stroke='#28262c',width=2){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(width>0&&stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}
function transformPoint(x,y,lean,bob){const dy=y-190;return[x*Math.cos(lean)-dy*Math.sin(lean),190+bob+x*Math.sin(lean)+dy*Math.cos(lean)];}
export function skinPerformerPose(model,owner=0,horizontalRatio=1){
  const player=model.players?.[owner];if(!player)return null;
  const time=model.time||0,wheel=player.wheel||0,caught=pulse(time,player.lastCatch,.35),drop=pulse(time,player.lastDrop,.9);
  const rush=clamp(player.vx/280,-1.4,1.4),recoil=clamp(player.recoil,-1,1);
  const lean=clamp(player.lean,-.28,.28)+rush*.1+recoil*.055;
  const bob=Math.sin(wheel*2)*5+caught*7-Math.abs(recoil)*8-drop*8;
  const arms=[0,1].map(hand=>{
    const sign=hand?1:-1,h=model.handPosition(hand,owner),flash=clamp(((player.flash?.[hand]??-10)-time)/.2,0,1);
    const flail=Math.sin(time*5+hand*2+owner)*Math.min(1,Math.abs(rush)+Math.abs(recoil)+caught);
    return {hand,sign,flash,shoulder:transformPoint(sign*41,303,lean,bob),
      elbow:[clamp(sign*(103+Math.abs(rush)*24)+flail*15,-player.x*horizontalRatio+12,(WORLD.width-player.x)*horizontalRatio-12),226+flash*16+flail*22-drop*22],
      palm:[(h.x-player.x)*horizontalRatio,h.y],worldPalm:[h.x,h.y]};
  });
  return {owner,player,time,wheel,caught,drop,rush,recoil,lean,bob,arms,x:player.x*horizontalRatio};
}
function cycle(c,pose,skin,p){
  const {wheel,rush,owner}=pose;
  oval(c,0,-2,80,10,'#08090b80');
  c.save();c.translate(0,57);c.rotate(-wheel);
  if(skin==='history'&&owner===0){
    const rock=Array.from({length:14},(_,i)=>{const a=i*TAU/14,r=50+(i*7%9);return[Math.cos(a)*r,Math.sin(a)*r];});
    shape(c,rock,'#777461','#3e443d',4);oval(c,0,0,41,40,'#858371','#b4ab83',2);
    for(let i=0;i<6;i++){const a=i*TAU/6;line(c,[[Math.cos(a)*12,Math.sin(a)*12],[Math.cos(a+.1)*29,Math.sin(a+.1)*29],[Math.cos(a)*44,Math.sin(a)*44]],'#565d51',2);}
  }else if(skin==='history'){
    oval(c,0,0,54,54,'#17191e',owner===1?'#817e68':'#c9ad6f',4);oval(c,0,0,45,45,'#242129',p.wheel,4);
    for(let i=0;i<(owner===1?8:12);i++){const a=i*TAU/(owner===1?8:12);line(c,[[Math.cos(a)*8,Math.sin(a)*8],[Math.cos(a)*44,Math.sin(a)*44]],p.wheel,owner===1?5:2);}
    if(owner===2)for(let i=0;i<6;i++){const a=i*TAU/6;oval(c,Math.cos(a)*33,Math.sin(a)*33,6,6,null,'#bfa56b',1.5);}
  }else{
    oval(c,0,0,54,54,'#1a2330',p.wheel,4);oval(c,0,0,43,43,'#263044',p.trim,2);
    const count=owner===2?7:10;
    for(let i=0;i<count;i++){
      const a=i*TAU/count;
      if(owner===2)oval(c,Math.cos(a)*44,Math.sin(a)*44,8,5,'#687aa0','#ae9fd0',1);
      else line(c,[[Math.cos(a)*43,Math.sin(a)*43],[Math.cos(a+.16)*27,Math.sin(a+.16)*27]],i%2?p.trim:'#556581',5);
    }
    oval(c,0,0,owner===2?25:19,owner===2?25:19,null,p.trim,2);
  }
  oval(c,0,0,7,7,p.trim,p.edge);c.restore();
  line(c,[[0,57],[rush*8,177]],skin==='history'&&owner===0?'#725a3d':p.wheel,9);
  if(skin==='future')line(c,[[4,63],[rush*8+4,164]],p.trim,2);
  line(c,[[-24+rush*8,177],[29+rush*8,177]],skin==='history'&&owner===0?'#9d885e':'#322735',12);
  const a=[Math.cos(wheel)*32,57+Math.sin(wheel)*32],b=[-Math.cos(wheel)*32,57-Math.sin(wheel)*32];
  const hip=[pose.lean*-30,197+pose.bob];
  for(const [side,pedal] of [[-1,a],[1,b]]){
    const knee=[side*45+pose.lean*15,127+Math.sin(wheel)*side*-18];
    const legColor=skin==='history'&&owner===0?p.skin:skin==='history'&&owner===2?'#d8cfb5':p.cloth;
    line(c,[[hip[0]+side*18,hip[1]],knee,pedal],p.edge,28);line(c,[[hip[0]+side*18,hip[1]],knee,pedal],legColor,21);
    if(skin==='future'){oval(c,knee[0],knee[1],10,9,p.cloth,p.trim,2);line(c,[[pedal[0],pedal[1]+10],[knee[0]+side*3,knee[1]-13]],p.trim,2);}
    else if(owner===1){oval(c,knee[0],knee[1],14,12,'#879496','#b5b9a4',2);line(c,[[pedal[0],pedal[1]+9],[knee[0],knee[1]-13]],'#b6baa5',3);}
    const shoe=skin==='history'&&owner===0?p.skin:skin==='history'&&owner===1?'#66433f':'#252533';
    line(c,[[pedal[0]-17,pedal[1]+1],[pedal[0]+21,pedal[1]-2]],shoe,13);
    if(skin==='history'&&owner===2){c.fillStyle='#cbb377';c.fillRect(pedal[0]-3,pedal[1]-6,9,8);}
    if(skin==='history'&&owner===0)for(let j=0;j<3;j++)line(c,[[pedal[0]+8+j*4,pedal[1]+1],[pedal[0]+10+j*4,pedal[1]-6]],p.edge,1.3);
  }
  line(c,[a,[0,57],b],skin==='history'?'#b6a77c':p.trim,3);
}
function costume(c,pose,skin,p){
  const {owner,time,rush}=pose;
  if(skin==='history'&&owner===0){
    shape(c,[[-39,310],[5,324],[43,283],[36,206],[19,198],[7,208],[-4,196],[-17,209],[-35,200],[-48,273]],p.cloth,p.edge,3);
    for(const [x,y] of [[-17,288],[13,286],[-29,250],[19,241],[-4,224]])shape(c,[[x-5,y-4],[x+4,y-5],[x+7,y+3],[x-2,y+7]],'#624d39',null,0);
    line(c,[[-30,309],[19,246]],'#e0c391',4);
    for(const [x,y] of [[-25,305],[-13,289],[-1,273],[10,256]])oval(c,x,y,6,3,'#ead7a5','#937d59',1);
  }else if(skin==='history'&&owner===1){
    shape(c,[[-46,306],[-10,321],[22,315],[47,294],[39,208],[13,194],[-33,204],[-50,268]],'#536477','#303541',3);
    shape(c,[[-34,308],[33,306],[38,250],[0,233],[-37,249]],'#84969a','#43515d',3);
    line(c,[[0,307],[0,239]],'#c8c6ad',3);shape(c,[[-9,281],[0,292],[10,281],[0,267]],'#c8ae6d','#705f46',1);
    for(const side of [-1,1]){oval(c,side*44,301,17,14,'#809299','#34414c',3);line(c,[[side*35,296],[side*51,305]],'#d0ceb4',2);}
    for(let j=0;j<4;j++)line(c,[[-32,215+j*8],[31,218+j*8]],'#8e9a9b',3);
    shape(c,[[-29,300],[-45,298],[-56-rush*20,220],[-31,235]],'#96484b','#603440',2);
  }else if(skin==='history'){
    shape(c,[[-40,313],[-17,322],[19,321],[42,309],[40,229],[58+rush*10,182],[20,193],[0,238],[-17,195],[-53+rush*10,177],[-39,244]],p.cloth,p.edge,3);
    shape(c,[[-17,319],[17,319],[19,239],[0,228],[-18,241]],'#ccb580','#7d674d',2);
    for(let j=0;j<5;j++)oval(c,2,298-j*13,3,3,'#f0d28f','#8b6948',1);
    for(const side of [-1,1])line(c,[[side*31,304],[side*21,273],[side*31,243],[side*40,199]],p.trim,3);
    shape(c,[[-10,329],[10,329],[16,309],[-14,304],[8,294],[-8,286]],'#eee0c3','#b6a98c',1.5);
  }else if(owner===0){
    shape(c,[[-39,314],[33,314],[53,289],[40,208],[-37,201],[-53,278]],p.cloth,p.edge,3);
    shape(c,[[-37,299],[-16,318],[14,317],[41,296],[30,269],[-26,269]],'#7e9eae','#314757',2);
    line(c,[[-29,303],[-14,281],[12,281],[30,304]],p.trim,3);
    for(let j=0;j<4;j++)line(c,[[-24,222+j*10],[25,222+j*10]],'#54798e',3);
    oval(c,0,290,8,8,'#213f4e',p.trim,2);oval(c,0,290,3,3,'#b5f5dc');
    for(const side of [-1,1])shape(c,[[side*40,310],[side*59,300],[side*53,279],[side*35,289]],'#577789',p.trim,2);
  }else if(owner===1){
    shape(c,[[-39,314],[-16,322],[20,320],[42,310],[47,273],[27,234],[38,200],[-34,198],[-25,239],[-48,278]],p.cloth,p.edge,3);
    shape(c,[[-30,303],[0,289],[31,305],[26,274],[0,262],[-29,277]],'#9c77bd','#453653',2);
    line(c,[[-25,302],[-17,278],[0,262],[18,241],[29,211]],p.trim,3);
    line(c,[[30,302],[19,282],[9,278]],'#8decde',3);
    for(let i=0;i<5;i++)oval(c,-18+i*9,212,2,2,'#b9f3e2');
    oval(c,-5,249,7,8,'#345968','#83d6cb',2);
  }else{
    shape(c,[[-32,319],[16,326],[47,300],[40,263],[52,216],[17,197],[-27,209],[-44,259],[-41,299]],p.cloth,p.edge,3);
    for(let i=0;i<5;i++){const y=225+i*17;oval(c,0,y,26-i*2,8,null,i%2?'#9da68b':'#a6c9a1',3);}
    shape(c,[[-28,310],[-52,321],[-45,281],[-27,291]],'#9caaa0','#42665b',2);
    shape(c,[[30,309],[52,321],[48,281],[28,289]],'#a2a499','#42665b',2);
    for(const side of [-1,1])line(c,[[side*24,229],[side*(51+Math.sin(time*3)*4),193],[side*60,216]],'#b8b78c',3);
  }
  shape(c,[[-13,339],[16,339],[18,313],[-14,313]],p.skin,p.edge,2);
}
function face(c,pose,skin,p){
  const {owner,time,caught,drop,rush}=pose,throwHit=pulse(time,pose.player.lastThrow,.33);
  const force=clamp(caught*.8+drop*.9+Math.abs(rush)*.32+throwHit*.45,0,1.6);
  const incoming=(pose.player.expression==='panic'?1:drop),center=skin==='future'&&owner===2?379:369;
  c.save();c.translate(rush*6,center);c.rotate(rush*.055+drop*(owner%2?.065:-.06));
  if(skin==='history'&&owner===0){
    shape(c,[[-47,-19],[-50,31],[-35,63],[-27,56],[-12,73],[0,57],[18,72],[27,56],[43,53],[50,12],[46,-24]],'#514437','#302b29',3);
    line(c,[[-28,63],[26,73]],'#ddd0ad',8);oval(c,-31,63,7,7,'#ded0ad');oval(c,29,73,7,7,'#ded0ad');
  }else if(skin==='history'&&owner===1){
    oval(c,0,22,46,54,'#71818b','#303d48',3);
    shape(c,[[-34,43],[-14,73],[7,81],[37,46],[24,35]],'#a3afb1','#475760',2);
    c.beginPath();c.moveTo(0,75);c.bezierCurveTo(3,104,49,93,35,121);c.strokeStyle='#ad4b52';c.lineWidth=15;c.lineCap='round';c.stroke();
    line(c,[[4,74],[4,53]],'#d6c4a0',3);
  }else if(skin==='history'){
    oval(c,0,19,44,47,'#ddd9c6','#897f73',3);
    for(const sign of [-1,1])for(let j=0;j<4;j++)oval(c,sign*(37+j%2*3),20-j*14,13,11,'#e5e1d2','#a89c8c',2);
    shape(c,[[31,-17],[47,-28],[43,-48],[26,-40]],'#d9d4bd','#928675',2);
    shape(c,[[35,-29],[49,-30],[51,-41],[36,-40]],'#51484b','#282a30',1);
  }else if(owner===0){
    oval(c,0,17,51,62,'#6eabb318','#7cb5c3',3);
    line(c,[[-42,46],[-34,63],[-12,70]],'#b7ebe566',4);
    shape(c,[[-32,19],[-36,52],[-17,62],[3,50],[16,57],[31,39],[30,17]],'#263742','#142737',2);
  }else if(owner===1){
    shape(c,[[-44,-22],[-47,37],[-29,63],[0,70],[33,57],[42,19],[29,-3]],'#303851','#1c2a3c',3);
    c.beginPath();c.moveTo(31,42);c.bezierCurveTo(87,70,92,11,58,-5);c.bezierCurveTo(38,-19,67,-41,57,-63);c.strokeStyle='#b77bc0';c.lineWidth=13;c.stroke();
    line(c,[[33,43],[69,52],[76,26]],'#75ded3',3);
  }else{
    for(const sign of [-1,1]){line(c,[[sign*20,44],[sign*(35+Math.sin(time*4+sign)*3),74],[sign*40,84]],'#a1c994',6);oval(c,sign*40,84,7,8,'#e0bf83','#588176',2);}
    oval(c,0,12,47,55,p.skin,p.edge,3);
  }
  oval(c,-37,0,8,12,p.skin,p.edge,2);oval(c,37,0,8,12,p.skin,p.edge,2);
  oval(c,0,0,skin==='future'&&owner===2?36:35,40+force*3,p.skin,p.edge,3);
  if(skin==='history'&&owner===0){
    shape(c,[[-31,-8],[-29,-34],[-14,-46],[0,-41],[14,-45],[30,-31],[32,-9],[20,-21],[-18,-22]],'#67503c','#3c302b',2);
    line(c,[[-30,23],[-6,27]],'#5b4433',6);line(c,[[6,27],[30,22]],'#5b4433',6);
  }else if(skin==='future'&&owner===1){
    shape(c,[[-34,26],[-28,56],[2,58],[28,42],[5,38],[-5,18],[-22,12]],'#d890c7','#664763',2);
    line(c,[[29,7],[37,0],[31,-17]],'#86e3d4',4);
  }else if(skin==='future'&&owner===2){
    for(const [x,y] of [[-23,34],[23,32],[-30,-12],[27,-16]])oval(c,x,y,4,3,'#83ac81');
  }
  const eyeY=11+drop*3,eyeWide=skin==='future'&&owner===2?10:12,eyeTall=9+force*4;
  for(const sign of [-1,1]){
    const ex=sign*17;
    oval(c,ex,eyeY,eyeWide,eyeTall,skin==='future'&&owner===2?'#303751':'#eee6c8',p.edge,2);
    if(skin==='future'&&owner===1&&sign===1){oval(c,ex,eyeY,8,8,'#517989','#8cefe1',2);line(c,[[ex-4,eyeY],[ex+4,eyeY]],'#b5fff0',2);}
    else{oval(c,ex+rush*2,eyeY+throwHit*3,drop>.3?3:3.5,drop>.3?5:4,skin==='future'&&owner===2?'#e8d495':'#302c34');}
    line(c,[[ex-10,eyeY+eyeTall+5-sign*rush*3],[ex+10,eyeY+eyeTall+5+sign*rush*3+drop*3]],skin==='history'&&owner===2?'#8d8175':p.edge,3.5);
  }
  if(skin==='future'&&owner===2){oval(c,0,34,8,7,'#343a55',p.edge,2);oval(c,rush,35,3,4,'#e2d394');}
  else oval(c,skin==='history'&&owner===2?4:0,-1,skin==='history'&&owner===0?12:8,skin==='history'&&owner===2?13:9,p.skin,p.edge,2);
  const mouthY=-22-force*4,mouthH=4+force*11;
  oval(c,0,mouthY,17+force*7,mouthH,'#50333e',p.edge,2);
  if(force<.25){line(c,[[-14,mouthY+1],[15,mouthY+1]],'#f4dfb6',4);for(let i=0;i<4;i++)line(c,[[-9+i*6,mouthY-2],[-9+i*6,mouthY+3]],'#80645c',1);}
  else{shape(c,[[-13,mouthY+mouthH-1],[12,mouthY+mouthH-1],[10,mouthY+mouthH-7],[-10,mouthY+mouthH-6]],'#f2dfb8',p.edge,1);oval(c,5+Math.sin(time*8)*3,mouthY-mouthH+4,10,4+force*2,'#cb7f8c');}
  if(skin==='history'&&owner===1)for(const sign of [-1,1])for(let j=0;j<3;j++)oval(c,sign*33,-13-j*10,5,7,'#a58a56','#64523b',1.5);
  if(incoming>.1)for(const sign of [-1,1])line(c,[[sign*40,23],[sign*48,32+drop*9]],'#b1d6d0',3);
  c.restore();
}
export function drawSkinPerformer(c,model,owner=0,horizontalRatio=1,skinId='punk'){
  const palettes=PALETTES[skinId];if(!palettes?.[owner])return false;
  const pose=skinPerformerPose(model,owner,horizontalRatio);
  if(!pose)return false;
  const p=palettes[owner];c.save();c.translate(pose.x,0);
  cycle(c,pose,skinId,p);
  // Shoulders follow the leaned torso while palm centers remain exact world contacts.
  for(const arm of pose.arms){line(c,[arm.shoulder,arm.elbow,arm.palm],p.edge,19);line(c,[arm.shoulder,arm.elbow,arm.palm],skinId==='future'?p.cloth:p.skin,12);if(skinId==='future')oval(c,arm.elbow[0],arm.elbow[1],8,8,p.cloth,p.trim,2);}
  c.save();c.translate(0,190+pose.bob);c.rotate(pose.lean);c.translate(0,-190);
  costume(c,pose,skinId,p);face(c,pose,skinId,p);c.restore();
  for(const arm of pose.arms){
    const [x,y]=arm.palm;oval(c,x,y,14,9,p.skin,p.edge,2);
    const fingers=skinId==='future'&&owner===2?3:4;
    for(let j=0;j<fingers;j++){const dx=(j-(fingers-1)/2)*5;line(c,[[x+dx,y],[x+dx*1.5+arm.sign*arm.flash*3,y+12+arm.flash*5]],p.skin,3.5);}
    if(skinId==='future')line(c,[[x-9,y-5],[x+9,y-5]],p.trim,3);
    else if(owner>0)line(c,[[x-10,y-5],[x+10,y-5]],owner===2?'#e8ddc5':'#a4aca6',7);
  }
  c.restore();return true;
}
function historyStage(c,w,h,model,view,collage){
  const floor=view.oy,time=model.time||0,seed=(model.posterSeed??1981)>>>0;
  const bg=c.createLinearGradient(0,0,0,h);bg.addColorStop(0,'#191b1b');bg.addColorStop(.55,'#3a302c');bg.addColorStop(1,'#242727');
  c.fillStyle=bg;c.fillRect(0,0,w,h);
  // Cave strata and painted hand marks meet invented carved columns, patterned
  // cloth, geometric tiles, and an arch: a deliberately cross-era global collage.
  for(let i=0;i<10;i++){
    const x=i*w/9,y=18+(i*29+seed%19)%90;
    shape(c,[[x-90,0],[x+45,0],[x+63,y],[x+16,y+20],[x-37,y-1]],i%2?'#32332d':'#3c3830','#494135',1);
    line(c,[[x-57,8],[x-18,y-6],[x+30,y+2]],'#7c6a4528',2);
  }
  c.save();c.globalAlpha=.22;
  for(const [x,y,turn] of [[w*.07,h*.27,-.3],[w*.19,h*.17,.25]]){
    c.save();c.translate(x,y);c.rotate(turn);oval(c,0,0,8,10,'#cba16b');for(let j=0;j<5;j++)line(c,[[-8+j*4,-1],[-11+j*5,-14-Math.sin(j)*5]],'#cba16b',3);c.restore();
  }
  c.restore();
  const archX=w*.49,archW=w*.3,top=h*.13,base=floor-18;
  c.beginPath();c.moveTo(archX-archW,base);c.lineTo(archX-archW,top+h*.2);c.bezierCurveTo(archX-archW,top-h*.08,archX+archW,top-h*.08,archX+archW,top+h*.2);c.lineTo(archX+archW,base);
  c.strokeStyle='#706854';c.lineWidth=Math.max(17,w*.028);c.stroke();
  c.beginPath();c.moveTo(archX-archW+9,base);c.lineTo(archX-archW+9,top+h*.2);c.bezierCurveTo(archX-archW+9,top-h*.04,archX+archW-9,top-h*.04,archX+archW-9,top+h*.2);c.lineTo(archX+archW-9,base);
  c.strokeStyle='#b09b6833';c.lineWidth=3;c.stroke();
  for(const side of [-1,1])for(let i=0;i<7;i++)line(c,[[archX+side*archW-14,top+h*.23+i*h*.06],[archX+side*archW+14,top+h*.23+i*h*.06]],'#302b273e',2);
  for(const x of [w*.035,w*.94]){
    const colW=Math.max(18,w*.033),colTop=h*.2;
    c.fillStyle='#697060';c.fillRect(x,colTop,colW,floor-colTop);
    c.fillStyle='#919075';c.fillRect(x-6,colTop-12,colW+12,14);c.fillRect(x-8,floor-19,colW+16,18);
    for(let j=0;j<6;j++){
      const y=colTop+27+j*(floor-colTop-50)/6;
      shape(c,[[x+colW/2,y-11],[x+colW-3,y],[x+colW/2,y+11],[x+3,y]],'#998757','#414e43',1.5);
      oval(c,x+colW/2,y,3,3,'#4a685d');
    }
    line(c,[[x+4,colTop+5],[x+4,floor-25]],'#b4ab7438',2);
  }
  // Two asymmetrical tapestries: no single period or region is asserted.
  for(let i=0;i<2;i++){
    const x=w*(i?.8:.28),y=h*(i?.2:.12),width=Math.min(103,w*.18),height=h*(i?.24:.21);
    c.save();c.translate(x,y);c.rotate(i?.045:-.06);
    shape(c,[[-width/2,-5],[width/2,0],[width/2-2,height],[-width/2,height-4]],i?'#70454c':'#5c6552','#b3a06b',3);
    for(let j=0;j<4;j++)line(c,[[-width*.42,height*.15+j*height*.2],[0,height*.07+j*height*.2],[width*.42,height*.15+j*height*.2]],i?'#c18a605e':'#b1a56966',3);
    oval(c,0,height*.42,width*.2,height*.19,null,'#d2ad7366',3);
    for(let j=0;j<7;j++)line(c,[[-width*.42+j*width*.14,height-2],[-width*.43+j*width*.14,height+10+j%2*3]],'#a99062',2);
    c.restore();
  }
  const tileY=floor-Math.min(115,h*.21),tileW=Math.max(25,w/23),tileH=27;
  for(let row=0;row<3;row++)for(let col=0;col<Math.ceil(w/tileW);col++){
    const x=col*tileW,y=tileY+row*tileH;
    c.fillStyle=(col+row+seed)%3?'#50655a55':'#93695166';c.fillRect(x+2,y+2,tileW-4,tileH-4);
    shape(c,[[x+tileW/2,y+6],[x+tileW-7,y+tileH/2],[x+tileW/2,y+tileH-6],[x+7,y+tileH/2]],'#c0a06326',null,0);
  }
  const eq=Math.min(view.scaleY*.86,w/1030),back=floor-12;
  // A bronze bell and bowl lute act as photographic backline when available.
  if(!collage?.draw(c,'history','guitar',w*.13,back-78*eq,180*eq,190*eq,-.2,0)){
    c.save();c.translate(w*.13,back-45*eq);c.scale(eq,eq);oval(c,0,0,36,46,'#ac8154','#483e32',3);oval(c,0,0,12,13,'#342e2c','#d7b87c',2);line(c,[[2,-39],[13,-132]],'#a9986c',10);for(let j=0;j<4;j++)line(c,[[-5+j*4,28],[9+j,-130]],'#dbc9a0',.8);c.restore();
  }
  if(!collage?.draw(c,'history','bell',w*.88,back-58*eq,155*eq,180*eq,.08,0)){
    c.save();c.translate(w*.88,back);c.scale(eq,-eq);line(c,[[-45,0],[-45,120],[44,120],[44,0]],'#635e48',6);shape(c,[[-30,25],[-21,82],[0,98],[22,83],[31,25]],'#b29355','#66533c',3);oval(c,0,26,31,8,'#60503c','#d3ae69',2);c.restore();
  }
  if(!collage?.draw(c,'history','plant',w*.5,back-22*eq,110*eq,110*eq,.03,0)){
    c.save();c.translate(w*.5,back);c.scale(eq,-eq);shape(c,[[-35,0],[35,0],[45,57],[-45,57]],'#945f48','#544437',3);for(let j=0;j<5;j++)line(c,[[j*10-20,54],[j*17-34,108],[j*23-46,93]],'#819565',6);c.restore();
  }
  const ground=c.createLinearGradient(0,floor-8,0,h);ground.addColorStop(0,'#73644c');ground.addColorStop(1,'#292825');c.fillStyle=ground;c.fillRect(0,floor-8,w,h-floor+8);
  for(let i=0;i<18;i++)line(c,[[i*w/17,floor-7],[i*w/17-20,h]],'#28272865',1.5);
  for(let i=0;i<8;i++){const x=(i*137+seed%100)%1000/1000*w;oval(c,x,floor+12+i%3*9,10+i%4*3,3,'#b5a87720');}
  // The hanging trim drifts gently; there is no autonomous rhythmic flashing.
  line(c,[[w*.09,40],[w*.3,44+Math.sin(time*.4)*2],[w*.6,37],[w*.92,48]],'#9c856448',2);
}
function futureStage(c,w,h,model,view,collage){
  const floor=view.oy,time=model.time||0,seed=(model.posterSeed??3026)>>>0;
  const energy=Math.max(0,...(model.activePlayers??model.players??[]).map(p=>pulse(time,p.lastCatch,.65)));
  const bg=c.createLinearGradient(0,0,w,h);bg.addColorStop(0,'#101726');bg.addColorStop(.55,'#25243c');bg.addColorStop(1,'#183335');c.fillStyle=bg;c.fillRect(0,0,w,h);
  // Organic reactor ribs are deliberately invented, with a quiet open center.
  for(const side of [0,1]){
    c.save();if(side){c.translate(w,0);c.scale(-1,1);}
    c.beginPath();c.moveTo(-12,floor+10);c.bezierCurveTo(w*.18,floor*.72,-w*.06,h*.19,w*.26,-15);c.strokeStyle='#3b5660';c.lineWidth=Math.max(20,w*.035);c.stroke();
    c.beginPath();c.moveTo(-12,floor+10);c.bezierCurveTo(w*.18,floor*.72,-w*.06,h*.19,w*.26,-15);c.strokeStyle='#80a4a15c';c.lineWidth=3;c.stroke();
    for(let i=0;i<8;i++){const y=60+i*(floor-90)/8,x=w*(.055+.025*Math.sin(i*.9));oval(c,x,y,12,8,'#315569','#79b9b164',2);oval(c,x,y,4,3,'#a5c99f70');}
    c.restore();
  }
  for(let i=0;i<3;i++){
    const x=w*(.19+i*.31),y=h*(.14+(i%2)*.06),r=Math.min(36,w*.055);
    line(c,[[x,0],[x+Math.sin(time*.3+i)*3,y-r]],'#6b80934f',2);
    oval(c,x,y,r,r*.65,'#3d4a6480','#9d9cb65c',2);
    shape(c,[[x,y-r*.74],[x+r*.5,y],[x,y+r*.85],[x-r*.5,y]],i%2?'#72919b55':'#a888a83f','#c3c4b466',1.5);
    oval(c,x,y,r*.2,r*.13,'#c5d8b480');
  }
  const center=w*.51,cy=floor-h*.22,rx=w*.22,ry=h*.14;
  for(let i=0;i<4;i++)oval(c,center,cy,rx+i*8,ry+i*4,null,i%2?'#a796bf20':'#8bc6c02b',2);
  c.save();c.translate(center,cy);c.rotate(Math.sin(time*.2)*.1);
  for(let i=0;i<9;i++){const a=i*TAU/9+.18,x=Math.cos(a)*rx,y=Math.sin(a)*ry;oval(c,x,y,5+energy,5,'#9fc7b947');}
  c.restore();
  // Curved printed circuits and membrane windows replace familiar brick walls.
  for(let i=0;i<9;i++){
    const x=((i*157+seed%251)%1000)/1000*w,y=h*.32+(i%4)*h*.095;
    c.beginPath();c.moveTo(x-30,y);c.bezierCurveTo(x-19,y-20,x+12,y+19,x+38,y-3);c.strokeStyle=i%2?'#be99c32a':'#8cbfb22d';c.lineWidth=2;c.stroke();oval(c,x+38,y-3,3,3,'#afccb33e');
  }
  const eq=Math.min(view.scaleY*.9,w/1030),back=floor-12;
  if(!collage?.draw(c,'future','plant',w*.12,back-65*eq,190*eq,190*eq,-.1,0)){
    c.save();c.translate(w*.12,back);c.scale(eq,-eq);oval(c,0,22,40,24,'#466476','#8f9ca3',3);for(let i=0;i<5;i++){const x=-30+i*15;line(c,[[x,26],[x*1.5,81],[x*.7,120+i%2*18]],'#9b93b7',5);oval(c,x*.7,120+i%2*18,9,14,'#81b9a6','#b8d4b4',2);}c.restore();
  }
  if(!collage?.draw(c,'future','bell',w*.89,back-63*eq,185*eq,185*eq,.1,0)){
    c.save();c.translate(w*.89,back);c.scale(eq,-eq);oval(c,0,31,42,30,'#4d4264','#a2a0bb',3);for(let i=0;i<4;i++)oval(c,0,62+i*16,27-i*5,8,'#5d6c83','#a8c2bc',2);c.restore();
  }
  const ground=c.createLinearGradient(0,floor-8,0,h);ground.addColorStop(0,'#435664');ground.addColorStop(1,'#18282e');c.fillStyle=ground;c.fillRect(0,floor-8,w,h-floor+8);
  for(let i=0;i<5;i++){const y=floor+5+i*11;c.beginPath();c.moveTo(0,y);c.bezierCurveTo(w*.3,y-12,w*.68,y+12,w,y);c.strokeStyle=i%2?'#9c8ab744':'#8fd1bf42';c.lineWidth=i===0?2:1;c.stroke();}
  for(let i=0;i<12;i++){const x=i*w/11;line(c,[[x,floor-4],[x+(x-w*.5)*.18,h]],'#aaccc324',1);}
}
export function drawSkinStage(c,w,h,model,view,collage,skinId='punk'){
  if(!PALETTES[skinId])return false;
  c.save();
  if(skinId==='history')historyStage(c,w,h,model,view,collage);else futureStage(c,w,h,model,view,collage);
  c.restore();return true;
}
