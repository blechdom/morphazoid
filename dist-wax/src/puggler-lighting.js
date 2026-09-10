export const LIGHTING_SCENES=Object.freeze([
  {id:'house',name:'House lights'},
  {id:'sweep',name:'Slow color sweep'},
  {id:'footlights',name:'Footlights'},
  {id:'blacklight',name:'Blacklight'},
].map(Object.freeze));
const PALETTES={punk:['#df87b8','#b9df82','#bca1e7','#d9bd7b'],history:['#e7b674','#c5c48e','#d38b74','#91b3a0'],future:['#38ffe3','#ff4ce1','#9270ff','#dcff52']};
const clamp=(v,low,high)=>Math.max(low,Math.min(high,Number(v)||0));
export function lightingState(w,h,model,view,lightingId='house',skinId='punk'){
  const id=LIGHTING_SCENES.some(scene=>scene.id===lightingId)?lightingId:'house';
  const time=Number.isFinite(model.time)?model.time:0,floor=clamp(view.oy,0,h),palette=PALETTES[skinId]??PALETTES.punk;
  // Broad, gentle contact envelopes change only a little local beam intensity.
  // Their attack begins at zero; high BPM never becomes a full-stage strobe.
  const energy=Math.max(0,...(model.activePlayers??model.players??[]).map(player=>{
    const age=time-player.lastCatch;return age>=0&&age<1.4?Math.sin(Math.PI*age/1.4):0;
  }));
  const count=id==='sweep'||id==='footlights'?4:3;
  const beams=Array.from({length:count},(_,i)=>{
    let x=w*(.14+i*.72/(count-1)),y=18,tx=x,ty=floor,spread=w*.15,alpha=.055+energy*.015,color=palette[i%palette.length];
    if(id==='sweep'){tx=w*(.5+Math.sin(time*.43+i*1.7)*.4);spread=w*.12;alpha=.1+energy*.018;}
    else if(id==='footlights'){y=floor-4;ty=h*.09;tx=clamp(x+Math.sin(time*.31+i)*w*.04,0,w);spread=w*.17;alpha=.095+energy*.017;}
    else if(id==='blacklight'){x=w*(.18+i*.32);tx=x+w*.025*Math.sin(time*.26+i);spread=w*.2;alpha=.13+energy*.012;color=['#ac6dea','#75b6ed','#a775ec'][i];}
    if(skinId==='future'){
      color=id==='blacklight'?['#d868ff','#59fff0','#ff61dc'][i]:palette[i%palette.length];
      alpha=id==='house'?.092+energy*.016:id==='sweep'?.128+energy*.018:id==='footlights'?.119+energy*.017:.136+energy*.012;
    }
    return {x,y,tx,ty,spread,alpha,color};
  });
  return {id,energy,beams,wash:id==='blacklight'?(skinId==='future'?'#66118822':'#40206722'):null};
}
export function renderStageLighting(c,w,h,model,view,lightingId='house',skinId='punk'){
  const state=lightingState(w,h,model,view,lightingId,skinId);
  c.save();c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;
  if(state.wash){c.fillStyle=state.wash;c.fillRect(0,0,w,h);}
  c.globalCompositeOperation='screen';
  for(const beam of state.beams){
    const gradient=c.createLinearGradient(beam.x,beam.y,beam.tx,beam.ty);
    gradient.addColorStop(0,beam.color);gradient.addColorStop(.72,beam.color+'88');gradient.addColorStop(1,beam.color+'00');
    c.globalAlpha=beam.alpha;c.fillStyle=gradient;
    c.beginPath();c.moveTo(beam.x-5,beam.y);c.lineTo(beam.x+5,beam.y);c.lineTo(beam.tx+beam.spread,beam.ty);c.lineTo(beam.tx-beam.spread,beam.ty);c.closePath();c.fill();
    c.globalAlpha=.38;c.fillStyle=beam.color;c.beginPath();c.ellipse(beam.x,beam.y,11,4,0,0,Math.PI*2);c.fill();
    const radius=Math.min(74,w*.075),poolY=state.id==='footlights'?beam.y:beam.ty-8;
    const pool=c.createRadialGradient(beam.tx,poolY,0,beam.tx,poolY,radius);
    pool.addColorStop(0,beam.color+'75');pool.addColorStop(1,beam.color+'00');
    c.globalAlpha=.2;c.fillStyle=pool;c.fillRect(beam.tx-radius,poolY-radius*.35,radius*2,radius*.7);
  }
  c.restore();return state.id;
}
