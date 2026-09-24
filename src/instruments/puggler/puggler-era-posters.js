// Original fictional gig bills for the cross-era stage, not historical artifacts.
export const ERA_POSTER_BILLS=Object.freeze({
  history:Object.freeze([
    ['CAVE','RAVE'],['LUTE','LOOT'],['OUD &','PROUD'],['GONG','WRONG'],['QUILL','THRILL'],
    ['BAROQUE','& ROLL'],['BACH','ALLEY'],['BRONZE','RIOT'],['TIMPANI','TANTRUM'],['SCROLL','PATROL'],
    ['CHAMBER','CHAOS'],['BONES','& DRONES'],['YE OLDE','NOISE'],['LYRE','FIRE'],['MEDIEVAL','MAYHEM'],
    ['REED','REVOLT'],['COURT','DISORDER'],['FOLK','FURY'],['DRUM','DYNASTY'],['OPERA','UPROAR'],
  ].map(Object.freeze)),
  future:Object.freeze([
    ['AETHER','RIOT'],['NO','SIGNAL'],['PHOTON','PUNKS'],['VACUUM','RAVE'],['ION','STORM'],
    ['ORBITAL','FEEDBACK'],['PLASMA','PALACE'],['GHOST','PACKETS'],['ALIEN','BANDWIDTH'],['VOID','CHOIR'],
    ['DO NOT','REBOOT'],['NEON','MUTINY'],['TIME','LEAK'],['DARK','MATTER'],['WORMHOLE','DISCO'],
    ['LASER','FEVER'],['COSMIC','STATIC'],['AETHER','LEAK'],['GAMMA','GARAGE'],['3026','JET JAM'],
  ].map(Object.freeze)),
});
export function eraPosterLayout(seed,w,h,skin){
  const bank=ERA_POSTER_BILLS[skin];if(!bank)return [];
  const count=w<480?3:4, width=Math.min(130,w/(count+1)*.75),height=Math.min(66,h*.29);
  const start=(Number(seed)>>>0)%bank.length;
  return Array.from({length:count},(_,i)=>({
    text:bank[(start+i*7)%bank.length],x:w*(i+1)/(count+1),y:Math.max(height*.55+5,h*(.22+(i%2)*.07)),
    width,height,angle:skin==='future'?0:((start+i*3)%7-3)*.022,
  }));
}
export function drawEraPosters(c,w,h,seed,skin){
  const posters=eraPosterLayout(seed,w,h,skin);
  for(const p of posters){
    c.save();c.translate(p.x,p.y);c.rotate(p.angle);
    c.fillStyle=skin==='history'?'#d5bd83':'#122b42';c.strokeStyle=skin==='history'?'#79613d':'#55f9ed';c.lineWidth=1.5;
    c.fillRect(-p.width/2,-p.height/2,p.width,p.height);c.strokeRect(-p.width/2,-p.height/2,p.width,p.height);
    c.fillStyle=skin==='history'?'#3b2529':'#dd79ff';c.textAlign='center';c.textBaseline='middle';
    p.text.forEach((line,i)=>{c.font=`900 ${Math.min(18,p.height*.27,p.width/(line.length*.69))}px ui-monospace,monospace`;c.fillText(line,0,(i-.5)*p.height*.34);});
    c.strokeStyle=skin==='history'?'#8a5e41':'#44bbda';c.beginPath();c.moveTo(-p.width*.36,p.height*.36);c.lineTo(p.width*.36,p.height*.36);c.stroke();c.restore();
  }
  return posters.length;
}
