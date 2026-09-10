// Historical costume collage; poses and drum reactions remain in puggler-crowd.
// Exact generation prompt: assets/puggler/HISTORY_CROWD_CREDITS.md.
const rects = {
  dread:[4,0,358,402], kid:[394,92,304,310], hat:[715,0,372,402], curls:[1090,58,358,350],
  punk:[3,414,377,334], braids:[390,407,351,341], ponytail:[750,433,361,315], baby:[1140,528,297,220],
  candle:[15,750,222,336], fan:[448,749,266,337], palm:[789,765,255,321], tankard:[1221,770,227,316],
};
export const HISTORY_CROWD_ATLAS = Object.freeze({
  url:new URL('../assets/puggler/history-crowd-collage.webp',import.meta.url),
  columns:4,rows:3,ids:Object.freeze(Object.keys(rects)),
  rects:Object.freeze(Object.fromEntries(Object.entries(rects).map(([id,rect])=>[id,Object.freeze(rect)]))),
});
const clothes=['#997329','#9b463a','#46343a','#b1a48a','#454a30','#856546','#405a7a','#c8bda2'];
const skinTones=['#734833','#b28058','#b2886b','#91603e','#b18b71','#70472f','#d3ab8f','#b99071'];
const handIds=Object.freeze({lighter:'candle',phone:'fan',palm:'palm',peace:'palm',horns:'tankard'});
export function historicalCrowdMember(pose) {
  return {...pose,bodyColor:clothes[pose.id]??clothes[0],skinColor:skinTones[pose.id]??skinTones[0]};
}
function oval(c,x,y,rx,ry,color) {
  c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();
}
function stroke(c,points,color,width) {
  c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));
  c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();
}
function shape(c,points,color) {
  c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=color;c.fill();
}
// Back-view headwear is also used for the distant silhouettes. No face features.
export function historyHeadwear(c,id,x,y,size=1,ink=null) {
  c.save();c.translate(x,y);c.scale(size,size);
  if(id==='hat')shape(c,[[-14,0],[-14,-31],[-6,-42],[15,-36],[21,-14],[10,-20],[5,-32],[10,0]],ink??'#823844');
  else if(id==='curls'||id==='braids') {
    oval(c,0,-5,19,15,ink??(id==='curls'?'#344c69':'#bf8733'));
    stroke(c,[[-15,-8],[-4,-1],[13,-7]],ink??'#77674c',3);
    if(id==='braids')oval(c,-2,-21,12,9,ink??'#2d2926');
  }else if(id==='ponytail'||id==='baby') {
    oval(c,0,-4,id==='baby'?13:18,id==='baby'?13:19,ink??'#d0c5a5');
    oval(c,0,4,id==='baby'?9:12,id==='baby'?8:12,ink??'#60412d');
    if(id==='ponytail')for(const side of [-1,1])stroke(c,[[side*10,0],[side*14,16],[side*12,26]],ink??'#78472f',5);
  }else if(id==='punk') {
    oval(c,0,0,17,15,ink??'#a29888');oval(c,-2,-11,22,7,ink??'#424333');
  }else if(id==='kid')oval(c,0,-17,8,7,ink??'#292427');
  else {
    oval(c,-1,-17,15,14,ink??'#33291e');
    for(let j=0;j<6;j++)stroke(c,[[-12+j*5,-17],[-16+j*6,-4],[-12+j*5,14]],ink??(j%2?'#483321':'#28241e'),4);
  }
  c.restore();
}
export function drawHistoryCrowdHead(c,collage,id,x,y,size,angle=0) {
  if(collage?.draw(c,'historyCrowd',id,x,y,size,size,angle,0))return;
  c.save();c.translate(x,y);c.rotate(angle);c.scale(size/62,size/62);
  const index=HISTORY_CROWD_ATLAS.ids.indexOf(id);
  oval(c,0,22,22,17,clothes[index]??clothes[0]);
  stroke(c,[[0,5],[0,18]],skinTones[index]??skinTones[0],11);
  oval(c,0,-2,id==='baby'?11:14,id==='baby'?12:17,'#392a23');
  historyHeadwear(c,id,0,-2);
  c.restore();
}
export function drawHistoryCrowdHand(c,collage,id,x,y,size,angle=0,time=0,ink=null) {
  const item=handIds[id]??'palm';
  if(!ink&&collage?.draw(c,'historyCrowd',item,x,y,size,size,angle,0))return;
  c.save();c.translate(x,y);c.rotate(angle);c.scale(size/54,size/54);
  const skin=ink??(item==='candle'||item==='tankard'?'#79513a':item==='fan'?'#c49a7b':'#a37353');
  stroke(c,[[0,27],[0,8]],ink??'#736d56',12);stroke(c,[[0,16],[0,3]],skin,9);oval(c,0,0,7,9,skin);
  if(item==='candle') {
    c.fillStyle=ink??'#c6a258';c.fillRect(-4,-21,8,22);
    const tip=-31-Math.sin(time*13)*1.5;
    shape(c,[[0,tip],[-3,-24],[0,-20],[4,-24]],'#f0c166');
  }else if(item==='fan') {
    shape(c,[[0,2],[-22,-19],[-17,-28],[-5,-33],[8,-32],[20,-25],[24,-15]],ink??'#c6ab77');
    if(!ink)for(let j=0;j<6;j++)stroke(c,[[0,2],[-20+j*8,-20-Math.sin(j*.6)*11]],'#806543',1.5);
  }else if(item==='tankard') {
    c.fillStyle=ink??'#866443';c.fillRect(-14,-23,21,26);
    stroke(c,[[7,-19],[14,-18],[14,-3],[7,-2]],ink??'#8d8774',4);
    stroke(c,[[-14,-18],[6,-18]],ink??'#59574d',3);stroke(c,[[-14,-3],[6,-3]],ink??'#59574d',3);
  }else {
    for(const finger of [-6,-3,0,3,6])stroke(c,[[finger,0],[finger*1.3,-20+Math.abs(finger)*.4]],skin,3);
    stroke(c,[[-6,2],[-10,-3]],skin,3);
  }
  c.restore();
}
