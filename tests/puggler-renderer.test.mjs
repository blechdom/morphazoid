import test from 'node:test';
import assert from 'node:assert/strict';
import { drawProp, drawObjectEchoes, drawPyrotechnics, MAX_TRAIL_ECHOES, posterLayout, PugglerRenderer } from '../src/puggler-renderer.js';
import { PugglerModel, PROPS } from '../src/puggler.js';
import { PugglerPyro, MAX_PYRO_PARTICLES } from '../src/puggler-pyro.js';

function context() {
  const calls=[],stack=[];
  let styles={globalAlpha:1,globalCompositeOperation:'source-over',shadowColor:'transparent',shadowBlur:0};
  const methods={
    save(){stack.push({...styles});},restore(){styles=stack.pop();},
    createLinearGradient(){return {addColorStop(){}};},
    createRadialGradient(){return {stops:[],addColorStop(at,color){this.stops.push([at,color]);}};},
  };
  const c=new Proxy({}, {
    get(_target,key){return methods[key]??styles[key]??((...args)=>calls.push([key,...args]));},
    set(_target,key,value){styles[key]=value;return true;},
  });
  return {c,calls};
}
function photographs() {
  const props=[],venue=[];
  return {props,venue,draw(c,...args){venue.push(args);return true;},drawProp(c,prop,x,y,spin,size,shadow){props.push({prop,x,y,spin,size,shadow,alpha:c.globalAlpha,composite:c.globalCompositeOperation,glow:c.fillStyle?.stops,blur:c.shadowBlur});return true;},dispose(){}};
}
const view={scaleY:.6,point:(x,y)=>({x:x*.7+10,y:500-Math.log1p(y)*50})};
const history=Array.from({length:55},(_,i)=>[100+i*18,100+i*10,i*.17,1-(54-i)/120]);
const object=(id=0)=>({id,prop:PROPS[id%PROPS.length],phase:'air',trail:history,x:history.at(-1)[0],y:history.at(-1)[1],spin:20});

test('the thirteen new props have distinct vector silhouettes and still prefer their photographs',()=>{
  const ids=['icecream','axe','deadcat','hydrant','pickle','violin','skull','banana','snake','plant','plunger','cd','vhs'];
  const signatures=[];
  for(const id of ids){
    const {c,calls}=context(),prop={id,color:'#b0b880',radius:26};
    drawProp(c,prop,10,20,.3,.8,{drawProp:()=>false});
    assert.ok(calls.length>8);
    signatures.push(JSON.stringify(calls));
    calls.length=0;
    const photo=photographs();drawProp(c,prop,10,20,.3,.8,photo);
    assert.equal(photo.props.length,1);assert.equal(photo.props[0].prop.id,id);
    assert.equal(calls.length,0);
  }
  assert.equal(new Set(signatures).size,ids.length);
});

test('stage pyro draws a bounded local accent without native blur or leaked canvas state',()=>{
  const {c,calls}=context(),pyro=new PugglerPyro(),blur=[];
  for(let i=0;i<8;i++)pyro.react([{kind:'catch',time:i*.5,drum:'kick'}],i*.5);
  pyro.react([{kind:'catch',time:5.3,drum:'crash'}],5.3);
  c.shadowBlur=9;c.globalCompositeOperation='source-over';
  c.stroke=()=>blur.push(c.shadowBlur);c.fill=()=>blur.push(c.shadowBlur);
  drawPyrotechnics(c,1030,612,{oy:556},pyro,5.5);
  assert.ok(blur.length>4&&blur.length<=MAX_PYRO_PARTICLES+4);
  assert.ok(blur.every(value=>value===0));
  assert.equal(c.shadowBlur,9);assert.equal(c.globalCompositeOperation,'source-over');
  assert.ok(calls.filter(call=>call[0]==='fillRect').every(call=>call[3]<200&&call[4]<200));
});

test('vector echo fallback disables per-path shadow work and restores the caller state',()=>{
  const {c}=context(),shadows=[];
  c.shadowBlur=9;c.shadowColor='#f268c9';c.shadowOffsetX=3;c.shadowOffsetY=4;
  c.ellipse=()=>shadows.push([c.shadowBlur,c.shadowOffsetX,c.shadowOffsetY,c.shadowColor]);
  drawProp(c,PROPS[0],10,20,.3,.7,{drawProp:()=>false},0);
  assert.ok(shadows.length>0);
  assert.ok(shadows.every(values=>values[0]===0&&values[1]===0&&values[2]===0&&values[3]==='transparent'));
  assert.deepEqual([c.shadowBlur,c.shadowOffsetX,c.shadowOffsetY,c.shadowColor],[9,3,4,'#f268c9']);
});

test('object echoes follow recorded positions and rotation, fade and shrink, with colored glow',()=>{
  const {c,calls}=context(),collage=photographs(),body=object();
  const count=drawObjectEchoes(c,[body],view,collage,1);
  assert.ok(count>2&&count<=8);
  assert.equal(count,collage.props.length);
  const recorded=new Map(history.map(sample=>{const p=view.point(sample[0],sample[1]);return [`${p.x},${p.y}`,sample[2]];}));
  for(const echo of collage.props) {
    assert.equal(echo.spin,recorded.get(`${echo.x},${echo.y}`));
    assert.equal(echo.prop,body.prop);
    assert.equal(echo.shadow,0);
    assert.equal(echo.composite,'screen');
    assert.equal(echo.blur,0);
    assert.equal(echo.glow.length,3);
    assert.ok(echo.glow.at(-1)[1].endsWith('00'));
    assert.ok(echo.alpha>0&&echo.alpha<.35);
    assert.ok(echo.size<view.scaleY*1.8);
  }
  assert.ok(collage.props[0].alpha<collage.props.at(-1).alpha);
  assert.ok(collage.props[0].size<collage.props.at(-1).size);
  assert.ok(new Set(collage.props.map(echo=>echo.glow[0][1])).size>1);
  assert.equal(c.globalAlpha,1);
  assert.equal(c.globalCompositeOperation,'source-over');
  assert.equal(calls.some(call=>['lineTo','setLineDash','stroke'].includes(call[0])),false);
});

test('ten long histories stay within the total echo budget and do not accumulate between frames',()=>{
  const {c}=context(),collage=photographs();
  const bodies=Array.from({length:10},(_,id)=>object(id));
  for(let i=0;i<120;i++) {
    collage.props.length=0;
    const count=drawObjectEchoes(c,bodies,view,collage,1);
    assert.equal(count,MAX_TRAIL_ECHOES);
    assert.equal(collage.props.length,count);
  }
  assert.ok(bodies.every(body=>body.trail===history&&body.trail.length===55));
});

test('cleared, stale, held and stationary histories cannot leave floating echo artifacts',()=>{
  const {c}=context(),collage=photographs();
  const bodies=[
    {...object(),phase:'held'}, {...object(),trail:[]},
    {...object(),trail:[[100,100,0,0],[110,100,1,.01]]},
    {...object(),x:100,y:100,trail:Array(55).fill([100,100,0,1])},
  ];
  assert.equal(drawObjectEchoes(c,bodies,view,collage,1),0);
  assert.equal(collage.props.length,0);
  // Replacement and crowd-return arcs use the same history, with no special path.
  assert.ok(drawObjectEchoes(c,[{...object(),phase:'replacement'},{...object(),phase:'audience'}],view,collage,1)>0);
});

test('flyer seeds deterministically change text, imagery and positions inside the back wall',()=>{
  for(const [w,h] of [[1440,612],[370,480],[500,400]]) {
    const first=posterLayout(1981,w,h),second=posterLayout(1982,w,h);
    assert.deepEqual(first,posterLayout(1981,w,h));
    assert.notDeepEqual(first.map(p=>p.bill),second.map(p=>p.bill));
    assert.notDeepEqual(first.map(p=>[p.symbol,p.variant]),second.map(p=>[p.symbol,p.variant]));
    assert.notDeepEqual(first.map(p=>[p.x,p.y]),second.map(p=>[p.x,p.y]));
    for(let seed=0;seed<200;seed++)for(const flyer of posterLayout(seed,w,h)) {
      assert.ok(flyer.x-47*flyer.scale>0&&flyer.x+47*flyer.scale<w);
      assert.ok(flyer.y-58*flyer.scale>30&&flyer.y+50*flyer.scale<h*.5);
      assert.equal(flyer.bill.length,3);
    }
  }
});

test('a complete ten-object, 1200 BPM frame has no predicted dotted paths and respects the trail toggle',()=>{
  const {c,calls}=context();
  const canvas={getContext:()=>c,getBoundingClientRect:()=>({width:1030,height:612,left:0}),width:0,height:0};
  const renderer=new PugglerRenderer(canvas);
  renderer.collage.dispose();renderer.collage=photographs();
  const model=new PugglerModel({count:10,pattern:'many-10',tempo:1200,cast:'trio',loft:2.5,assist:100});
  for(let i=0;i<90;i++)model.step(1/120);
  renderer.draw(model,{guides:true,trails:false});
  const plain=renderer.collage.props.length;
  renderer.collage.props.length=0;
  renderer.draw(model,{guides:true,trails:true});
  const echoed=renderer.collage.props.length;
  assert.ok(echoed>plain&&echoed-plain<=MAX_TRAIL_ECHOES);
  assert.equal(calls.some(call=>call[0]==='setLineDash'),false);
  const equipment=renderer.collage.venue.filter(call=>['amp','speaker','drum'].includes(call[1]));
  assert.ok(equipment.every(call=>call[4]<=300*renderer.view.scaleY));
  const crowd=renderer.collage.venue.filter(call=>['crowd','crowdExtra'].includes(call[0]));
  assert.deepEqual(new Set(crowd.map(call=>call[1])),new Set(['dread','kid','hat','curls','punk','lighter','phone','palm','peace','horns','braids','ponytail','baby']));
  assert.ok(crowd.every(call=>call[4]<=68&&call[7]===0));
  renderer.dispose();
});
