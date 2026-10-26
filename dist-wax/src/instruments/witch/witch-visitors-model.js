// Fixed, staggered visitors share the owner's Play clock. No RAF, timer,
// randomness, or accumulated visit queue is needed to resume a quiet scene.
export const WITCH_VISITORS = Object.freeze([
  Object.freeze({id:'mouse',first:18,period:43,duration:6.2,ground:698,margin:95,scale:1.25,stepsPerSecond:64,behaviorId:'walk'}),
  Object.freeze({id:'lizard',first:44,period:67,duration:8.5,ground:14,margin:150,scale:1.15,stepsPerSecond:34,behaviorId:'lizard-scuttle'}),
]);
export const WITCH_ANIMAL_DIVE_DURATION = .95;
const POT = Object.freeze({x:600,y:544});
const clamp = (value,low=0,high=1) => Math.max(low,Math.min(high,Number.isFinite(value)?value:low));
const smooth = value => {const t=clamp(value);return t*t*(3-2*t);};

// Feet follow the frame's inside edges. The mouse rounds the lower-left
// corner without snapping its spine, then reverses the whole route next visit.
function visitorRoute(visitor,progress,visit) {
  const direction=visit%2===0?1:-1;
  if(visitor.id==='lizard')return {
    x:direction>0?1000+visitor.margin-progress*(1000+visitor.margin*2):-visitor.margin+progress*(1000+visitor.margin*2),
    y:visitor.ground,rotation:Math.PI,direction,
  };
  const edge=10,radius=84,bottom=visitor.ground;
  const wall=bottom-radius+visitor.margin,corner=radius*Math.PI/2;
  const floor=1000+visitor.margin-edge-radius;
  const distance=(direction>0?progress:1-progress)*(wall+corner+floor);
  if(distance<wall)return {x:edge,y:-visitor.margin+distance,rotation:Math.PI/2,direction};
  if(distance<wall+corner) {
    const angle=Math.PI-(distance-wall)/radius;
    return {x:edge+radius+Math.cos(angle)*radius,y:bottom-radius+Math.sin(angle)*radius,rotation:angle-Math.PI/2,direction};
  }
  return {x:edge+radius+distance-wall-corner,y:bottom,rotation:0,direction};
}

export function witchAnimalGroundVisibility(state = {}) {
  return Number.isFinite(state.flightLift)?1-clamp(state.flightLift):state.scene==='flight'?0:1;
}

/** A retained capture record belongs only to the visit in which it began.
 * Its short arc uses performance time, so primary Stop freezes the dive. */
export function applyWitchAnimalCapture(frame,state = {}) {
  const record=state.capturedAnimals?.[frame.animalId],time=frame.clockTime;
  const captured=Boolean(record&&Number.isFinite(record.startedAt)
    &&record.startedAt>=frame.visitStartedAt&&record.startedAt<frame.visitEndsAt&&record.startedAt<=time
    &&Number.isFinite(record.from?.x)&&Number.isFinite(record.from?.y));
  const base={...frame,captured,diving:false,captureProgress:0,scale:1,rotation:Number.isFinite(frame.rotation)?frame.rotation:0};
  if(captured) {
    const progress=clamp((time-record.startedAt)/WITCH_ANIMAL_DIVE_DURATION),travel=smooth(progress);
    const from={x:clamp(record.from.x,-250,1250),y:clamp(record.from.y,-250,970)};
    const direction=record.from.direction===1||record.from.direction===-1?record.from.direction:frame.direction;
    const rotation=Number.isFinite(record.from.rotation)?record.from.rotation:base.rotation;
    const arcHeight=clamp(from.y-14,0,135);
    Object.assign(base,{
      active:progress<1,diving:progress<1,captureProgress:progress,
      x:from.x+(POT.x-from.x)*travel,
      y:from.y+(POT.y-from.y)*travel-Math.sin(progress*Math.PI)*arcHeight,
      scale:1-travel*.86,
      direction,rotation:rotation+direction*(-Math.sin(progress*Math.PI)*.7+progress*progress*1.35),
      alpha:1-smooth((progress-.72)/.28),
    });
  }
  base.visible=base.active&&base.alpha>.01&&witchAnimalGroundVisibility(state)>.01;
  return base;
}

export function getWitchVisitors(state = {}) {
  const time=clamp(state.performanceTime,0,Number.MAX_SAFE_INTEGER);
  return WITCH_VISITORS.map(visitor=>{
    const visit=time<visitor.first?-1:Math.floor((time-visitor.first)/visitor.period);
    const visitStartedAt=visitor.first+Math.max(0,visit)*visitor.period;
    const elapsed=time-visitStartedAt,active=visit>=0&&elapsed>=0&&elapsed<visitor.duration;
    const progress=active?clamp(elapsed/visitor.duration):0;
    return applyWitchAnimalCapture({
      id:visitor.id,animalId:visitor.id,source:'quadruped',behaviorId:visitor.behaviorId,
      active,visit,visitStartedAt,visitEndsAt:visitStartedAt+visitor.duration,clockTime:time,elapsed:active?elapsed:0,progress,
      ...visitorRoute(visitor,progress,visit),position:Math.max(0,Math.min(visitor.duration,elapsed))*visitor.stepsPerSecond,
      alpha:active?clamp(elapsed/.22)*clamp((visitor.duration-elapsed)/.22):0,
    },state);
  });
}
