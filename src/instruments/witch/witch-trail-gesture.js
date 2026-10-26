const MAX_STRANDS=2,MAX_POINTS=257,MAX_STEP=1/120,MAX_STEPS=10;
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const clamp=(value,low,high,fallback=0)=>Math.max(low,Math.min(high,finite(value,fallback)));
const pointerPoint=(point,fallback={x:500,y:360})=>({
  x:clamp(point?.x,-1000,2000,fallback.x),y:clamp(point?.y,-720,1440,fallback.y),
});

function sample(points,u) {
  const at=clamp(u,0,1)*(points.length-1),a=Math.floor(at),b=Math.min(points.length-1,a+1),t=at-a;
  return {x:finite(points[a]?.x,500)+(finite(points[b]?.x,500)-finite(points[a]?.x,500))*t,
    y:finite(points[a]?.y,360)+(finite(points[b]?.y,360)-finite(points[a]?.y,360))*t};
}
function seed(paths) {
  return (Array.isArray(paths)?paths:[]).slice(0,MAX_STRANDS).filter(path=>path?.points?.length>2).map(path=>{
    const count=Math.min(MAX_POINTS,path.points.length),points=Array.from({length:count},(_,i)=>sample(path.points,i/(count-1)));
    return {index:path.index,points,rest:points.map(p=>({...p})),vx:new Float64Array(count),vy:new Float64Array(count),
      ax:new Float64Array(count),ay:new Float64Array(count)};
  });
}
function pin(state) {
  const grab=state.grab,strand=state.strands.find(s=>s.index===grab?.index);
  if(!state.held||!strand)return;
  const a=strand.points[grab.segment],b=strand.points[grab.segment+1],wa=1-grab.fraction,wb=grab.fraction;
  const divisor=wa*wa+wb*wb,dx=state.point.x+grab.offset.x-a.x*wa-b.x*wb,dy=state.point.y+grab.offset.y-a.y*wa-b.y*wb;
  for(const [i,w] of [[grab.segment,wa],[grab.segment+1,wb]]) {
    strand.points[i].x+=dx*w/divisor;strand.points[i].y+=dy*w/divisor;
    strand.vx[i]=state.velocity.x*w/divisor;strand.vy[i]=state.velocity.y*w/divisor;
  }
}

/** Canonical-stage rope motion; the last point is always attached to the hair.
 * Two fixed-budget chains use damped neighboring displacement springs. Their
 * authored idle paths remain the rest shapes, so only a touch starts physics. */
export function createWitchTrailGesture() {
  return {held:false,active:false,strands:[],grab:null,point:{x:500,y:360},velocity:{x:0,y:0},lastTime:0,releaseAge:0};
}

export function beginWitchTrailGesture(state,paths,point={},time=0) {
  if(!state.active)state.strands=seed(paths);
  state.point=pointerPoint(point,state.point);state.velocity.x=state.velocity.y=0;state.lastTime=finite(time);state.releaseAge=0;
  let nearest=null,distance=Infinity;
  for(const strand of state.strands)for(let i=0;i<strand.points.length-2;i++) {
    // Leave the final hair-anchored segment free of a competing pointer pin.
    const a=strand.points[i],b=strand.points[i+1],dx=b.x-a.x,dy=b.y-a.y;
    const fraction=clamp(((state.point.x-a.x)*dx+(state.point.y-a.y)*dy)/Math.max(.0001,dx*dx+dy*dy),0,1);
    const x=a.x+dx*fraction,y=a.y+dy*fraction,d=Math.hypot(state.point.x-x,state.point.y-y);
    if(d<distance){distance=d;nearest={index:strand.index,segment:i,fraction,offset:{x:x-state.point.x,y:y-state.point.y}};}
  }
  state.grab=nearest;state.held=state.active=Boolean(nearest);return state;
}

export function moveWitchTrailGesture(state,point={},time=state.lastTime) {
  if(!state.held)return state;
  const next=pointerPoint(point,state.point),now=Math.max(state.lastTime,finite(time,state.lastTime));
  const dt=Math.max(1/240,(now-state.lastTime)/1000),retain=Math.exp(-Math.min(dt,1)/.055);
  state.velocity.x=clamp(state.velocity.x*retain*.45+(next.x-state.point.x)/dt*.55,-2400,2400);
  state.velocity.y=clamp(state.velocity.y*retain*.45+(next.y-state.point.y)/dt*.55,-2000,2000);
  state.point=next;state.lastTime=now;pin(state);return state;
}

export function releaseWitchTrailGesture(state,{cancel=false}={}) {
  state.held=false;state.releaseAge=0;
  if(cancel){state.active=false;state.strands=[];state.grab=null;state.velocity.x=state.velocity.y=0;}
  return state;
}

/** Pulling toward the attachment gathers the coil; away fills the whole sky. */
export function witchTrailSpaceAtPoint(point,anchor) {
  return clamp((Math.hypot(finite(point?.x)-finite(anchor?.x),finite(point?.y)-finite(anchor?.y))-100)/650,0,1);
}

/** dt is seconds, input timestamps are milliseconds. dt=0 freezes all state.
 * At most ten 1/120s substeps run; old elapsed time never creates a catch-up loop. */
export function advanceWitchTrailGesture(state,paths,dt) {
  const elapsed=clamp(dt,0,MAX_STEP*MAX_STEPS);if(!state.active||!elapsed)return state;
  for(const strand of state.strands) {
    const source=paths?.find(path=>path.index===strand.index)?.points;if(!source?.length)continue;
    for(let i=0;i<strand.points.length;i++)Object.assign(strand.rest[i],sample(source,i/(strand.points.length-1)));
  }
  const steps=Math.min(MAX_STEPS,Math.ceil(elapsed/MAX_STEP)),h=elapsed/steps;
  for(let step=0;step<steps;step++) {
    if(state.held){const fade=Math.exp(-h/.07);state.velocity.x*=fade;state.velocity.y*=fade;}
    else state.releaseAge+=h;
    const settling=state.held?0:Math.max(0,state.releaseAge-3.5),damping=Math.exp(-(2.7+settling*3)*h);
    for(const strand of state.strands) {
      const {points,rest,vx,vy,ax,ay}=strand,last=points.length-1;
      Object.assign(points[last],rest[last]);vx[last]=vy[last]=0;
      for(let i=0;i<last;i++) {
        const ox=points[i].x-rest[i].x,oy=points[i].y-rest[i].y;
        const a=Math.max(0,i-1),b=i+1;
        ax[i]=-(19+settling*40)*ox+980*((points[a].x-rest[a].x)+(points[b].x-rest[b].x)-2*ox);
        ay[i]=-(19+settling*40)*oy+980*((points[a].y-rest[a].y)+(points[b].y-rest[b].y)-2*oy);
      }
      for(let i=0;i<last;i++) {
        vx[i]=clamp((vx[i]+ax[i]*h)*damping,-2400,2400);vy[i]=clamp((vy[i]+ay[i]*h)*damping,-2000,2000);
        points[i].x=clamp(points[i].x+vx[i]*h,-1100,2100,rest[i].x);
        points[i].y=clamp(points[i].y+vy[i]*h,-820,1540,rest[i].y);
        if(settling){const blend=1-Math.exp(-settling*4*h);points[i].x+=(rest[i].x-points[i].x)*blend;points[i].y+=(rest[i].y-points[i].y)*blend;}
      }
    }
    pin(state);
  }
  if(!state.held&&state.releaseAge>7)releaseWitchTrailGesture(state,{cancel:true});
  return state;
}
