import { fabricGesturePull, elasticReleaseProfile } from '../moire-drone/moire-drone.js';

const WIDTH=1000,HEIGHT=720,HALF_WIDTH=WIDTH/2,HALF_HEIGHT=HEIGHT/2;
const LIMIT_X=340,LIMIT_Y=240,VELOCITY_X=2400,VELOCITY_Y=1800,CONTACT=.18;
const RELEASE={fabricTension:.48,fabricDamping:.36,fabricInertia:.58,fabricPull:1,
  propagationRate:6,propagationSpeed:3,propagationDecay:1.5};
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const clamp=(value,low,high,fallback=0)=>Math.max(low,Math.min(high,finite(value,fallback)));

function packet(state,free=false) {
  const v=state.visual,anchorX=v.fabricGrabX*2-1,anchorY=v.fabricGrabY*2-1;
  return fabricGesturePull({anchorX,anchorY,contactPull:CONTACT,
    currentX:free?anchorX+v.fabricPullX/HALF_WIDTH:state.point.x/HALF_WIDTH-1,
    currentY:free?anchorY+v.fabricPullY/HALF_HEIGHT:state.point.y/HALF_HEIGHT-1,
    velocityX:v.fabricVelocityX/HALF_WIDTH,velocityY:v.fabricVelocityY/HALF_HEIGHT});
}
function updateAudio(state) {
  const pull=packet(state,!state.held),amount=Math.abs(pull.amount);
  state.audio.fabricPull=clamp(state.held?amount:(amount-CONTACT)/(1-CONTACT)+state.pulse,0,1);
  state.audio.fabricVelocity=clamp(1-Math.exp(-Math.hypot(pull.velocityX,pull.velocityY)*.3),0,1);
  return state;
}
function clearMotion(state) {
  Object.assign(state.visual,{fabricPullX:0,fabricPullY:0,fabricVelocityX:0,fabricVelocityY:0});
  Object.assign(state.audio,{fabricPull:0,fabricVelocity:0});state.pulse=0;
  return state;
}

/** Fixed-size transient state, separate from preset-owned fabric settings.
 * Visual grab coordinates are 0–1, pull is in stage pixels, velocity is px/s.
 * Audio pull and velocity are both 0–1. Caller passes canonical 1000×720 points,
 * pointer timestamps in milliseconds, and advance dt in seconds. */
export function createWitchFabricGesture() {
  return {held:false,visual:{fabricGrabX:.5,fabricGrabY:.5,fabricPullX:0,fabricPullY:0,
    fabricVelocityX:0,fabricVelocityY:0},audio:{fabricPull:0,fabricVelocity:0},
    point:{x:500,y:360},lastTime:0,travel:0,pulse:0,frequency:9,damping:2.2};
}

export function beginWitchFabricGesture(state,point={},time=0) {
  clearMotion(state);state.held=true;
  const x=clamp(point?.x,0,WIDTH,500),y=clamp(point?.y,0,HEIGHT,360);
  state.visual.fabricGrabX=x/WIDTH;state.visual.fabricGrabY=y/HEIGHT;
  state.point.x=x;state.point.y=y;state.lastTime=finite(time);state.travel=0;
  return updateAudio(state);
}

export function moveWitchFabricGesture(state,point={},time=state.lastTime) {
  if(!state.held)return state;
  // Match the native helper's raw -3…3 pointer budget. Keeping this wider than
  // the stage makes pulling outward from an edge work under pointer capture.
  const x=clamp(point?.x,-WIDTH,WIDTH*2,state.point.x);
  const y=clamp(point?.y,-HEIGHT,HEIGHT*2,state.point.y);
  const now=Math.max(state.lastTime,finite(time,state.lastTime));
  const elapsed=Math.max(1/240,(now-state.lastTime)/1000),v=state.visual;
  const retain=Math.exp(-Math.min(elapsed,1)/.06);
  v.fabricVelocityX=clamp(v.fabricVelocityX*retain*.52+(x-state.point.x)/elapsed*.48,-VELOCITY_X,VELOCITY_X);
  v.fabricVelocityY=clamp(v.fabricVelocityY*retain*.52+(y-state.point.y)/elapsed*.48,-VELOCITY_Y,VELOCITY_Y);
  state.travel=Math.max(state.travel,Math.hypot(x-v.fabricGrabX*WIDTH,y-v.fabricGrabY*HEIGHT));
  state.point.x=x;state.point.y=y;state.lastTime=now;
  const pull=packet(state);
  v.fabricPullX=clamp(pull.deltaX*HALF_WIDTH,-LIMIT_X,LIMIT_X);
  v.fabricPullY=clamp(pull.deltaY*HALF_HEIGHT,-LIMIT_Y,LIMIT_Y);
  return updateAudio(state);
}

export function releaseWitchFabricGesture(state,{cancel=false}={}) {
  if(cancel){state.held=false;state.travel=0;return clearMotion(state);}
  if(!state.held)return state;
  const pull=packet(state),profile=elasticReleaseProfile(RELEASE,pull,Math.abs(pull.amount),.2);
  state.held=false;
  state.frequency=clamp(5+profile.rate*.9,6,14,9);
  state.damping=clamp(4/profile.decay,1.8,4,2.2);
  // A stationary contact is a small pluck. A dragged release already contains
  // strain and measured momentum; do not add a second unconditional kick.
  if(state.travel<3) {state.visual.fabricVelocityY=-145;state.pulse=.24;}
  return updateAudio(state);
}

function spring(position,velocity,frequency,damping,dt,limit,maxVelocity) {
  // Exact underdamped update: stable across frame sizes, with no catch-up loop.
  const rate=Math.sqrt(frequency*frequency-damping*damping),angle=rate*dt;
  const decay=Math.exp(-damping*dt),cos=Math.cos(angle),sin=Math.sin(angle);
  const next=decay*(position*cos+(velocity+damping*position)/rate*sin);
  let speed=decay*(velocity*cos-(damping*velocity+frequency*frequency*position)/rate*sin);
  if(Math.abs(next)>limit&&Math.sign(next)===Math.sign(speed))speed*=-.2;
  return [clamp(next,-limit,limit),clamp(speed,-maxVelocity,maxVelocity)];
}

/** dt=0 freezes every field exactly, including held velocity and click decay. */
export function advanceWitchFabricGesture(state,dt) {
  const elapsed=clamp(dt,0,2);if(!elapsed)return state;
  const v=state.visual;
  if(state.held) {
    const decay=Math.exp(-elapsed/.06);
    v.fabricVelocityX*=decay;v.fabricVelocityY*=decay;
  } else {
    [v.fabricPullX,v.fabricVelocityX]=spring(v.fabricPullX,v.fabricVelocityX,state.frequency,state.damping,elapsed,LIMIT_X,VELOCITY_X);
    [v.fabricPullY,v.fabricVelocityY]=spring(v.fabricPullY,v.fabricVelocityY,state.frequency*1.08,state.damping,elapsed,LIMIT_Y,VELOCITY_Y);
    state.pulse*=Math.exp(-elapsed*6);
    if(Math.hypot(v.fabricPullX,v.fabricPullY)<.01&&Math.hypot(v.fabricVelocityX,v.fabricVelocityY)<.05&&state.pulse<.0001)return clearMotion(state);
  }
  return updateAudio(state);
}
