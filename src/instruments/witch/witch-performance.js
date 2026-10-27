const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const fitScale=({width=1000,height=720,pixelRatio=1,worldWidth=1000,worldHeight=720}={})=>
  clamp(Math.ceil(Math.min(Math.max(1,finite(width,1000))/Math.max(1,finite(worldWidth,1000)),Math.max(1,finite(height,720))/Math.max(1,finite(worldHeight,720)))*clamp(finite(pixelRatio,1),1,1.5)*16)/16,.5,1);

/** Only raster detail changes. Musical settings, clocks and logical gesture
 * coordinates stay independent of viewport size and rendering pressure. */
export function createWitchRenderBudget(view={}) {
  const ceiling=fitScale(view);
  return {scale:ceiling,ceiling,mean:0,samples:0,slow:0,fast:0,changedAt:-Infinity,frameInterval:1000/30};
}

export function resizeWitchRenderBudget(budget,view) {
  const old=budget.ceiling;
  budget.ceiling=fitScale(view);
  // Keep an established pressure reduction when rotating/resizing.
  budget.scale=clamp(budget.scale*budget.ceiling/old,.5,budget.ceiling);
  budget.slow=budget.fast=0;
  return budget;
}

export function sampleWitchRenderBudget(budget,milliseconds,now) {
  if(!Number.isFinite(milliseconds)||milliseconds<0||!Number.isFinite(now))return false;
  budget.mean=budget.samples?budget.mean*.85+milliseconds*.15:milliseconds;
  budget.samples++;
  if(budget.samples<6)return false; // Shader/asset warm-up is not steady load.
  budget.slow=budget.mean>23?budget.slow+1:0;
  budget.fast=budget.mean<11?budget.fast+1:0;
  const previous=budget.scale;
  if(budget.slow>=12&&now-budget.changedAt>1000) {
    budget.scale=Math.max(.5,budget.scale-.125);budget.slow=0;budget.changedAt=now;
  } else if(budget.fast>=75&&now-budget.changedAt>3000) {
    budget.scale=Math.min(budget.ceiling,budget.scale+.125);budget.fast=0;budget.changedAt=now;
  }
  budget.frameInterval=budget.scale===.5&&budget.mean>32?1000/24:1000/30;
  return previous!==budget.scale;
}
