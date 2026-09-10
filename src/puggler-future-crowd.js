// Rear-view speculative 3026 costumes. Physics and reaction timing belong to
// puggler-crowd; the renderer-owned collage loader owns all image lifetimes.
const heads=['dread','kid','hat','curls','punk','braids','ponytail','baby'];
const clothes=['#187d91','#773aa6','#51427a','#405c72','#304859','#653769','#36766e','#8796ad'];
const skinTones=['#734b36','#bd8c69','#aa806c','#b6ed70','#714c3a','#724832','#d3b3a8','#ae78d0'];
const handIds=Object.freeze({lighter:'plasma',phone:'holo',palm:'robot',peace:'alien',horns:'alien',plasma:'plasma',holo:'holo',robot:'robot',alien:'alien'});
export function futureCrowdMember(pose) {
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
function clearShadow(c) {
  c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;c.shadowColor='transparent';
}

// All markings are hair strands, rear shell seams or occipital implants. No
// facial features are drawn, including on the alien and the supported baby.
export function futureHeadwear(c,id,x,y,size=1,ink=null) {
  c.save();c.translate(x,y);c.scale(size,size);clearShadow(c);
  if(id==='hat') {
    shape(c,[[-16,10],[-21,-14],[-14,-43],[0,-49],[17,-40],[21,-13],[15,11]],ink??'#65448f');
    for(let j=0;j<4;j++)stroke(c,[[-13,-30+j*10],[0,-35+j*11],[14,-28+j*10]],ink??(j%2?'#8365a7':'#be79e2'),2.5);
    stroke(c,[[0,-45],[0,7]],ink??'#d785ef',2);
  }else if(id==='curls') {
    shape(c,[[-13,-20],[-29,-34],[-38,-27],[-24,-6],[-35,2],[-18,12],[18,12],[34,0],[24,-7],[38,-28],[28,-34],[11,-21]],ink??'#a7d75e');
    oval(c,0,-8,20,22,ink??'#b6ed70');
    for(let j=0;j<3;j++)stroke(c,[[-9+j*8,-22],[-11+j*9,-5],[-6+j*6,10]],ink??'#6eac78',2);
  }else if(id==='punk') {
    oval(c,0,-7,17,23,ink??skinTones[4]);
    shape(c,[[-16,-17],[-7,-27],[2,-24],[-5,-7],[-14,-3]],ink??'#96b1bf');
    stroke(c,[[7,-26],[13,-14],[11,4]],ink??'#82aaad',4);
    stroke(c,[[-9,-19],[-8,-7],[0,5]],ink??'#58e8d2',1.6);
    shape(c,[[-9,5],[10,5],[11,11],[-8,11]],ink??'#4b738c');
  }else if(id==='ponytail') {
    shape(c,[[-19,18],[-23,-7],[-18,-26],[-5,-34],[10,-31],[21,-19],[22,9],[14,23],[10,11],[-12,9],[-13,23]],ink??'#9cd6c0');
    for(let j=0;j<5;j++)stroke(c,[[-14+j*7,-24],[-18+j*8,-9],[-15+j*7,16]],ink??(j%2?'#609ba7':'#b2e4cf'),2);
    stroke(c,[[-17,12],[16,12]],ink??'#3b7073',2);
  }else if(id==='baby') {
    oval(c,0,-5,13,15,ink??skinTones[7]);
    // One diagonal cluster avoids a pair of face-like spots on the rear skull.
    for(let j=0;j<3;j++)oval(c,-5+j*4,-12+j*3,2.2,2.7,ink??'#8356b4');
    shape(c,[[-17,9],[-7,13],[8,13],[17,9],[19,22],[-19,22]],ink??'#8696af');
    stroke(c,[[-15,12],[-8,17],[8,17],[15,12]],ink??'#c0c1ce',2);
  }else if(id==='kid') {
    oval(c,0,-9,16,20,ink??'#252330');
    for(const side of [-1,1]) {
      oval(c,side*16,-22,10,10,ink??'#2d2538');
      stroke(c,[[side*10,-26],[side*13,-16]],ink??'#d772e3',2.5);
    }
    stroke(c,[[0,-23],[0,6]],ink??'#494253',2);
  }else {
    const mother=id==='braids';
    oval(c,0,-8,18,21,ink??'#26212e');
    if(mother)oval(c,1,-29,15,12,ink??'#2f2636');
    for(let j=0;j<6;j++) {
      const x=-14+j*5.5,end=mother?18-j%2*4:24-j%3*3;
      stroke(c,[[x,-22],[x*1.14,-5],[x*.8,end]],ink??(j%2?'#493344':'#1a2430'),5);
      if(j%2===0)stroke(c,[[x+1,-18],[x*1.14+1,-4],[x*.8+1,end-2]],ink??(mother?'#f95fd5':'#50e7db'),1.4);
    }
    if(mother)stroke(c,[[-9,-31],[0,-24],[11,-29]],ink??'#da59c9',2);
  }
  c.restore();
}

export function drawFutureCrowdHead(c,collage,id,x,y,size,angle=0) {
  if(collage?.draw(c,'futureCrowd',id,x,y,size,size,angle,0))return;
  c.save();c.translate(x,y);c.rotate(angle);c.scale(size/62,size/62);clearShadow(c);
  const index=heads.indexOf(id),baby=id==='baby';
  oval(c,0,22,baby?17:22,baby?13:17,clothes[index]??clothes[0]);
  stroke(c,[[0,4],[0,19]],skinTones[index]??skinTones[0],baby?8:11);
  if(!baby) {
    oval(c,0,-3,14,18,skinTones[index]??skinTones[0]);
    stroke(c,[[-19,20],[-9,16],[9,16],[19,20]],id==='dread'?'#53e7da':'#867bc180',2);
  }
  futureHeadwear(c,id,0,-2);
  c.restore();
}

export function drawFutureCrowdHand(c,collage,id,x,y,size,angle=0,time=0,ink=null) {
  const item=handIds[id]??'robot';
  if(!ink&&collage?.draw(c,'futureCrowd',item,x,y,size,size,angle,0))return;
  c.save();c.translate(x,y);c.rotate(angle);c.scale(size/54,size/54);clearShadow(c);
  const skin=ink??(item==='plasma'?'#79503a':item==='holo'?'#c79c80':item==='robot'?'#91a6ba':'#a7e267');
  stroke(c,[[0,27],[0,9]],ink??'#374b72',12);stroke(c,[[0,16],[0,2]],skin,10);oval(c,0,0,8,10,skin);
  if(item==='plasma') {
    shape(c,[[-6,-20],[-3,-24],[4,-24],[7,-19],[7,0],[-6,0]],ink??'#406c7d');
    oval(c,1,-13,3.5,8,ink??'#6aefcf');
    const drift=Math.sin((Number.isFinite(time)?time:0)*1.8)*1.5;
    stroke(c,[[0,-17+drift],[3,-12+drift],[0,-7+drift]],'#c5f68f',1.5);
    stroke(c,[[-4,2],[7,-1]],skin,4);
  }else if(item==='holo') {
    shape(c,[[-17,-31],[17,-27],[14,1],[-19,-3]],ink??'#48bdbd35');
    stroke(c,[[-17,-31],[17,-27],[14,1],[-19,-3],[-17,-31]],ink??'#67e6d2',2);
    if(!ink)for(let j=0;j<3;j++)stroke(c,[[-11,-24+j*7],[9,-22+j*7]],'#a379ef99',1.5);
    stroke(c,[[0,5],[9,0],[10,-7]],skin,4);
  }else if(item==='robot') {
    for(const finger of [-6,-2,2,6]) {
      const top=-20+Math.abs(finger)*.6;
      stroke(c,[[finger,0],[finger*1.4,-10],[finger*1.5,top]],skin,3.7);
      if(!ink)stroke(c,[[finger*1.4-1,-10],[finger*1.4+1,-10]],'#4a7082',1.8);
    }
    stroke(c,[[-6,2],[-14,-3],[-15,-10]],skin,4);
    if(!ink){shape(c,[[-5,-1],[5,-1],[5,6],[-5,6]],'#526e86');stroke(c,[[-3,2],[3,2]],'#60e9d2',1.5);}
  }else {
    // Three elongated fingers and one opposing thumb: four alien digits total.
    for(const finger of [-5,0,5])stroke(c,[[finger,0],[finger*1.6,-13],[finger*1.8,-26+Math.abs(finger)*.7]],skin,4.2);
    stroke(c,[[-6,2],[-13,-3],[-17,-12]],skin,4.2);
    if(!ink)stroke(c,[[1,-3],[3,3],[1,8]],'#629d6a',1.8);
  }
  c.restore();
}
