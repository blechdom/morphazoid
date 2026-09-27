import { HAND_CONTOUR_POINTS, HAND_CONTOUR_BEATS, sampleHandContour } from './hand-contour.js';
import { captureHandContours, handDigitLabels, handJointKeys, handJointLabel, handMotionPeriod } from './hand-model.js';

const COLORS = { mcp: '#e5b16f', pip: '#6ed3cb', dip: '#cb9cf1', spread: '#ef91ad' };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clone = value => structuredClone(value);

/** Five overlaid curve surfaces. Editing owns one captured drag/undo transaction;
 * the audio clock owns playback, and a display stall cannot delay the animation. */
export function createHandContourEditor({ read, commit, listen, selectFinger }) {
  const lanes = [], undo = [];
  let config, curves, drag = null, lastTime = 0;
  const undoButton = document.getElementById('contourUndo');
  function remember(motion) {
    undo.push(clone({custom:motion.custom,contours:motion.contours})); if (undo.length > 32) undo.shift(); undoButton.disabled = false;
  }
  function edit(finger, joint, mutate, first = true) {
    const next = clone(read());
    if (first) remember(next.motion);
    next.motion.contours = captureHandContours(next);
    next.motion.custom = true;
    mutate(next.motion.contours[finger][joint]);
    commit(next);
  }
  function updateA11y(lane) {
    const label = handDigitLabels(config.form)[lane.index];
    lane.canvas.setAttribute('aria-label', `${label} ${handJointLabel(config.form,lane.index,lane.joint)} movement contour`);
    const curve = curves[lane.index][lane.joint];
    lane.readout.textContent = `${lane.cursor + 1}/16 · ${Math.round(curve[lane.cursor] * 100)}%`;
    lane.canvas.setAttribute('aria-valuenow',String(Math.round(curve[lane.cursor]*100)));
    lane.canvas.setAttribute('aria-valuetext', `Point ${lane.cursor + 1} of 16, ${Math.round(curve[lane.cursor] * 100)} percent`);
  }
  function drawLane(lane, time) {
    const canvas = lane.canvas, width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
      canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    }
    const context = canvas.getContext('2d'); context.setTransform(dpr,0,0,dpr,0,0);
    context.clearRect(0,0,width,height);
    context.strokeStyle = '#ffffff12'; context.lineWidth = 1;
    context.beginPath();
    for(let point=0;point<HAND_CONTOUR_POINTS;point++) { const x=point/HAND_CONTOUR_POINTS*width; context.moveTo(x,0);context.lineTo(x,height); }
    context.moveTo(0,height/2);context.lineTo(width,height/2);context.stroke();
    const keys=handJointKeys(config.form,lane.index), ordered=[...keys.filter(key=>key!==lane.joint),lane.joint];
    for(const joint of ordered) {
      const selected=joint===lane.joint;context.globalAlpha=selected?1:.38;
      context.strokeStyle=COLORS[joint];context.lineWidth=selected?2:1.1;context.beginPath();
      for(let x=0;x<=width;x+=2) {
        const value=sampleHandContour(curves[lane.index][joint],x/width*HAND_CONTOUR_BEATS);
        const y=height/2-value*(height/2-5);if(x===0)context.moveTo(x,y);else context.lineTo(x,y);
      }
      context.stroke();
    }
    context.globalAlpha=1;
    const progress=((time/handMotionPeriod(config.motion))%1+1)%1;
    context.strokeStyle='#ffffffaa';context.lineWidth=1;context.beginPath();context.moveTo(progress*width,0);context.lineTo(progress*width,height);context.stroke();
    if(document.activeElement===canvas) {
      const x=lane.cursor/HAND_CONTOUR_POINTS*width,y=height/2-curves[lane.index][lane.joint][lane.cursor]*(height/2-5);
      context.fillStyle=COLORS[lane.joint];context.beginPath();context.arc(x,y,4,0,Math.PI*2);context.fill();
    }
  }
  function point(lane,event) {
    const rect=lane.canvas.getBoundingClientRect();
    return { index:clamp(Math.round((event.clientX-rect.left)/rect.width*HAND_CONTOUR_POINTS),0,HAND_CONTOUR_POINTS-1),
      value:clamp((rect.height/2-(event.clientY-rect.top))/(rect.height/2-5),-1,1) };
  }
  function paint(lane,event,first=false) {
    const next=point(lane,event), previous=first?next:drag.last;
    edit(lane.index,lane.joint,curve=>{
      const distance=Math.abs(next.index-previous.index);
      for(let step=0;step<=distance;step++) {
        const amount=distance?step/distance:1,index=previous.index+Math.sign(next.index-previous.index)*step;
        curve[index]=previous.value+(next.value-previous.value)*amount;
      }
    },first);
    lane.cursor=next.index;drag.last=next;updateA11y(lane);
  }
  for(let index=0;index<5;index++) {
    const canvas=document.getElementById(`contour-${index}`),selector=document.getElementById(`contour-joint-${index}`);
    const lane={ index,canvas,selector,joint:'mcp',cursor:0,readout:document.getElementById(`contour-value-${index}`) };lanes.push(lane);
    listen(selector,'change',()=>{lane.joint=selector.value;updateA11y(lane);drawLane(lane,lastTime);selectFinger(index,lane.joint);});
    listen(canvas,'pointerdown',event=>{
      if(event.button!==0||drag)return;event.preventDefault();canvas.focus({preventScroll:true});
      drag={lane,pointer:event.pointerId,last:null};canvas.setPointerCapture(event.pointerId);selectFinger(index,lane.joint);paint(lane,event,true);
    });
    listen(canvas,'pointermove',event=>{if(drag?.lane===lane&&event.pointerId===drag.pointer)paint(lane,event);});
    const finish=event=>{if(drag?.lane===lane&&event.pointerId===drag.pointer){drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}};
    listen(canvas,'pointerup',finish);listen(canvas,'pointercancel',finish);listen(canvas,'lostpointercapture',finish);
    listen(canvas,'focus',()=>drawLane(lane,lastTime));listen(canvas,'blur',()=>drawLane(lane,lastTime));
    listen(canvas,'keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','Delete','Backspace'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      if(event.key==='ArrowLeft'||event.key==='ArrowRight')lane.cursor=(lane.cursor+(event.key==='ArrowRight'?1:15))%16;
      else edit(index,lane.joint,curve=>{curve[lane.cursor]=event.key==='Home'||event.key==='Delete'||event.key==='Backspace'?0:clamp(curve[lane.cursor]+(event.key==='ArrowUp'?1:-1)*(event.shiftKey ? .1 : .025),-1,1);});
      updateA11y(lane);drawLane(lane,lastTime);
    });
    listen(document.getElementById(`contour-clear-${index}`),'click',()=>edit(index,lane.joint,curve=>curve.fill(0)));
  }
  listen(undoButton,'click',()=>{
    if(!undo.length)return;const next=clone(read());Object.assign(next.motion,undo.pop());undoButton.disabled=!undo.length;commit(next);
  });
  return {
    sync(next) {
      config=next;curves=captureHandContours(next);
      for(const lane of lanes) {
        const keys=handJointKeys(next.form,lane.index);
        if(!keys.includes(lane.joint))lane.joint=keys[0];
        lane.selector.replaceChildren(...keys.map(key=>new Option(handJointLabel(next.form,lane.index,key),key)));
        lane.selector.value=lane.joint;lane.selector.style.color=COLORS[lane.joint];
        lane.selector.setAttribute('aria-label',`${handDigitLabels(next.form)[lane.index]} contour joint`);
        updateA11y(lane);drawLane(lane,lastTime);
      }
    },
    draw(time) { lastTime=time;if(config)for(const lane of lanes)drawLane(lane,time); },
    clearHistory() {undo.length=0;undoButton.disabled=true;},
  };
}
