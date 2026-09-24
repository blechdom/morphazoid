export const LIGHTING_SCENES=Object.freeze([
  {id:'house',name:'House lights'}, {id:'sweep',name:'Sweeping color fans'},
  {id:'footlights',name:'Hot footlights'}, {id:'blacklight',name:'Blacklight bloom'},
  {id:'disco',name:'Mirror-ball disco'}, {id:'party',name:'Eight-beam party'},
  {id:'lasers',name:'Crossed laser rave'}, {id:'prism',name:'Prismatic cathedral'},
  {id:'aurora',name:'Aether curtains'}, {id:'strobe',name:'Strobe accents · flash opt-in'},
  {id:'chaos',name:'Punk light riot · flash opt-in'},
].map(Object.freeze));
const PALETTES={punk:['#ff389a','#c4ff45','#a978ff','#ffbd39'],history:['#ffbd53','#9ce4b8','#ff6651','#b49cff'],future:['#38ffe3','#ff4ce1','#9270ff','#dcff52']};
const clamp=(v,low,high)=>Math.max(low,Math.min(high,Number(v)||0));
export const MAX_LIGHT_BEAMS=8, MAX_DISCO_SPOTS=24, FLASH_RATE_HZ=2;
export function lightingState(w,h,model,view,lightingId='house',skinId='punk',options={}){
  const id=LIGHTING_SCENES.some(scene=>scene.id===lightingId)?lightingId:'house';
  const time=Number.isFinite(model.time)?model.time:0, floor=clamp(view.oy,0,h), palette=PALETTES[skinId]??PALETTES.punk;
  const intensity=clamp(options.lightIntensity??.8,0,1), speed=clamp(options.lightSpeed??1,.2,2.5);
  const reduced=options.reducedMotion===true, motion=reduced?0:time*speed;
  const energy=Math.max(0,...(model.activePlayers??model.players??[]).map(player=>{
    const age=time-player.lastCatch;return age>=0&&age<.8?Math.sin(Math.PI*age/.8):0;
  }));
  // Only the explicit flash preference can enable these shared, slow pulses.
  // Presets/dice cannot enable it, and reduced motion always suppresses it.
  const flashing=options.allowFlashes===true&&!reduced&&['strobe','chaos'].includes(id);
  const phase=(time*FLASH_RATE_HZ)%1, flash=flashing&&phase<.22?Math.sin(Math.PI*phase/.22):0;
  const count=id==='party'||id==='chaos'?8:['prism','lasers','disco'].includes(id)?6:id==='house'?3:4;
  const beams=Array.from({length:count},(_,i)=>{
    let x=w*(.08+i*.84/(count-1)),y=12,tx=x,ty=floor,spread=w*.13;
    let alpha=(id==='house'?.055:.25)+energy*(id==='house'?.015:.09),color=palette[i%palette.length];
    if(id==='sweep'||id==='party'){tx=w*(.5+Math.sin(motion*(id==='party'?1.1:.48)+i*1.7)*.46);spread=w*(id==='party'?.055:.14);}
    if(id==='footlights'){y=floor-3;ty=h*.04;tx=w*(.5+Math.sin(motion*.7+i*1.4)*.46);spread=w*.12;alpha=.36+energy*.12;}
    if(id==='blacklight'){color=['#b155ff','#46caff','#ff47d4'][i%3];spread=w*.25;alpha=.32+energy*.09;}
    if(id==='lasers'){tx=w*(.5+Math.sin(motion*.85+i*2.3)*.47);spread=w*.009;alpha=.65;}
    if(id==='prism'){x=w*.5;tx=w*(.08+i*.84/(count-1)+Math.sin(motion*.7+i)*.035);spread=w*.055;alpha=.33;}
    if(id==='aurora'){tx=w*(.5+Math.sin(motion*.25+i*1.9)*.43);spread=w*.25;alpha=.2+.12*(.5+.5*Math.sin(motion*.5+i));}
    if(id==='disco'){tx=w*(.5+Math.sin(motion*.8+i)*.45);spread=w*.045;alpha=.3;}
    if(id==='strobe'||id==='chaos'){tx=w*(.5+Math.sin(motion*(id==='chaos'?1.4:.5)+i*2)*.45);spread=w*.055;alpha=.15+energy*.08+flash*.52;}
    return {x,y,tx:clamp(tx,0,w),ty,spread,alpha:alpha*intensity*(id==='house'&&skinId==='future'?1.12:1),color};
  });
  const disco=id==='disco'||id==='party';
  const spots=disco?Array.from({length:MAX_DISCO_SPOTS},(_,i)=>({
    x:w*(.5+.46*Math.sin(motion*.75+i*2.399)),y:h*(.18+.72*(.5+.5*Math.sin(motion*.43+i*.93))),
    radius:Math.max(2,Math.min(8,w*.01)),color:palette[i%palette.length],alpha:(.3+energy*.12)*intensity,
  })):[];
  return {id,energy,beams,spots,intensity,flash,flashing,motion,
    wash:id==='blacklight'?'#5e187f':id==='aurora'?'#103a58':null,
    ball:disco?{x:w*.5,y:Math.min(52,h*.23),radius:Math.max(10,Math.min(28,w*.045))}:null};
}
export function renderStageLighting(c,w,h,model,view,lightingId='house',skinId='punk',options={}){
  const state=lightingState(w,h,model,view,lightingId,skinId,options);
  c.save();c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;
  if(state.wash){c.globalAlpha=.2*state.intensity;c.fillStyle=state.wash;c.fillRect(0,0,w,h);}
  c.globalCompositeOperation='screen';
  for(const beam of state.beams){
    const gradient=c.createLinearGradient(beam.x,beam.y,beam.tx,beam.ty);
    gradient.addColorStop(0,beam.color);gradient.addColorStop(.72,beam.color+'aa');gradient.addColorStop(1,beam.color+'00');
    c.globalAlpha=beam.alpha;c.fillStyle=gradient;
    c.beginPath();c.moveTo(beam.x-3,beam.y);c.lineTo(beam.x+3,beam.y);c.lineTo(beam.tx+beam.spread,beam.ty);c.lineTo(beam.tx-beam.spread,beam.ty);c.closePath();c.fill();
    c.globalAlpha=.75*state.intensity;c.fillStyle=beam.color;c.beginPath();c.ellipse(beam.x,beam.y,9,3,0,0,Math.PI*2);c.fill();
  }
  for(const spot of state.spots){c.globalAlpha=spot.alpha;c.fillStyle=spot.color;c.beginPath();c.ellipse(spot.x,spot.y,spot.radius,spot.radius*.55,state.motion*.3,0,Math.PI*2);c.fill();}
  if(state.ball){
    const b=state.ball;c.globalAlpha=state.intensity;c.globalCompositeOperation='source-over';
    c.strokeStyle='#b0baca';c.lineWidth=1;c.beginPath();c.moveTo(b.x,0);c.lineTo(b.x,b.y-b.radius);c.stroke();
    c.fillStyle='#253746';c.beginPath();c.ellipse(b.x,b.y,b.radius,b.radius,0,0,Math.PI*2);c.fill();
    for(let row=-3;row<=3;row++)for(let col=-3;col<=3;col++){
      if(row*row+col*col>10)continue;
      const glint=.5+.5*Math.sin(state.motion*2+col*.8+row*1.7);
      c.fillStyle=glint>.7?'#f1ffff':glint>.35?'#83c2d1':'#385865';
      c.fillRect(b.x+col*b.radius/4,b.y+row*b.radius/4,b.radius*.2,b.radius*.2);
    }
  }
  c.restore();return state.id;
}
