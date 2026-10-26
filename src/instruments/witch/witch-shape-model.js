import { buildShapesScene } from '../shapes/shapes-scene.js';
import { createShapesState, SHAPES_DIMENSIONS } from '../shapes/shapes-state.js';

export const WITCH_SHAPE_MORPH_SECONDS = .9;
export const WITCH_SHAPE_MAX_EDGES = 192;
export const WITCH_SHAPE_MAX_FACES = 128;
export const WITCH_SHAPE_COLORS = Object.freeze({
  solid: SHAPES_DIMENSIONS['3d'].color,
  hyper: SHAPES_DIMENSIONS['4d'].color,
});
export const WITCH_SHAPE_FORMS = Object.freeze([
  { id:'tesseract', dimension:'4d', representation:'tesseract' },
  { id:'cube', dimension:'3d', representation:'cube' },
  { id:'hyperpyramid', dimension:'4d', representation:'hyperpyramid' },
  { id:'octahedron', dimension:'3d', representation:'octahedron' },
  { id:'klein', dimension:'4d', representation:'klein' },
  { id:'prism', dimension:'3d', representation:'prism' },
  { id:'hyperstar', dimension:'4d', representation:'profile', profile:Object.freeze({sides:5,kind:'star',starDepth:.4}) },
  { id:'torus', dimension:'3d', representation:'torus' },
].map((form,index)=>Object.freeze({...form,index})));

const clamp = value => Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = value => {const t=clamp(value);return t*t*(3-2*t);};
const ORIGIN = Object.freeze({x:0,y:0,z:0,w:0});
const cache = new Map();

export function getWitchShapeForm(form = 0) {
  return typeof form === 'string'
    ? WITCH_SHAPE_FORMS.find(entry=>entry.id===form)??WITCH_SHAPE_FORMS[0]
    : WITCH_SHAPE_FORMS[Number.isInteger(form)?form:-1]??WITCH_SHAPE_FORMS[0];
}

/** The exact native Shapes projection and reader state, without cloning or
 * browser state. Audio can build its contact plan once outside the sample loop. */
export function createWitchShapeSceneState(form = 0) {
  const source=getWitchShapeForm(form);
  return {
    selection:{dimension:source.dimension,playingMode:'continuous',bank:'main'},
    profile:{sides:4,kind:'polygon',starDepth:.48,...source.profile},
    play:{running:false,continuousPhase:.18,rateCyclesPerSecond:.8,direction:1,motion:'loop',divisions:2},
    dimension:{
      '3d':{representation:source.dimension==='3d'?source.representation:'cube',readerYaw:45,readerPitch:-22,
        rotation:{x:-24,y:36,z:8},scale:{x:1,y:1,z:1},skew:{x:0,z:0}},
      '4d':{representation:source.dimension==='4d'?source.representation:'tesseract',
        rotation:{xw:24,yw:-18,zw:12},scale:{x:1,y:1,z:1,w:1}},
    },
  };
}

export function createWitchShapeState(form = 0) {
  return createShapesState(createWitchShapeSceneState(form));
}

// Native wire geometry carries no faces. Its small chordless triangular and
// square cycles give translucent surfaces without changing vertices or edges.
function faceCycles(geometry,form) {
  const neighbors=geometry.vertices.map(()=>new Set());
  for(const {a,b} of geometry.edges){neighbors[a].add(b);neighbors[b].add(a);}
  const faces=[],seen=new Set();
  const add=indices=>{
    const key=indices.slice().sort((a,b)=>a-b).join(':');
    if(!seen.has(key)&&faces.length<WITCH_SHAPE_MAX_FACES){seen.add(key);faces.push(indices);}
  };
  for(let a=0;a<neighbors.length;a++)for(const b of neighbors[a])if(b>a)for(const c of neighbors[b])if(c>a&&c!==b) {
    if(neighbors[c].has(a)){add([a,b,c]);continue;}
    if(form.representation==='octahedron')continue;
    for(const d of neighbors[c])if(d>a&&d!==b&&neighbors[d].has(a)&&!neighbors[b].has(d))add([a,b,c,d]);
  }
  return faces;
}

/** At most eight cached meshes, built by the same native 3D/4D constructors,
 * rotations and perspective projections as the Shapes instrument. */
export function getWitchShapeGeometry(form = 0) {
  const source=getWitchShapeForm(form);
  if(cache.has(source.index))return cache.get(source.index);
  const scene=buildShapesScene(createWitchShapeSceneState(source.index));
  const radius=Math.max(.01,...scene.vertices.map(p=>Math.hypot(p.x,p.y)));
  const vertices=scene.vertices.map(p=>Object.freeze({x:p.x/radius,y:-p.y/radius,z:p.z,w:p.w??0}));
  const color=source.dimension==='4d'?1:0;
  const edges=scene.geometry.edges.map(edge=>Object.freeze({a:vertices[edge.a],b:vertices[edge.b],alpha:1,
    depth:(vertices[edge.a].z+vertices[edge.b].z)/2,color:edge.axis==='w'?1:0,hyper:edge.axis==='w'?1:0}));
  const faces=faceCycles(scene.geometry,source).map(indices=>{
    const points=indices.map(index=>vertices[index]);
    while(points.length<4)points.push(points.at(-1));
    return Object.freeze({points:Object.freeze(points),alpha:1,color,depth:points.reduce((sum,p)=>sum+p.z,0)/4});
  });
  const geometry=Object.freeze({form:source.index,dimension:source.dimension,vertices:Object.freeze(vertices),edges:Object.freeze(edges),faces:Object.freeze(faces)});
  cache.set(source.index,geometry);
  return geometry;
}

function pointBetween(a,b,t) {
  return {x:mix(a.x,b.x,t),y:mix(a.y,b.y,t),z:mix(a.z,b.z,t),w:mix(a.w,b.w,t)};
}

function geometryBetween(a,b,t) {
  if(t<=0)return a;if(t>=1)return b;
  const blankEdge={a:ORIGIN,b:ORIGIN,alpha:0,depth:0,color:0,hyper:0};
  const blankFace={points:[ORIGIN,ORIGIN,ORIGIN,ORIGIN],alpha:0,depth:0,color:0};
  return {
    form:b.form,dimension:b.dimension,
    edges:Array.from({length:Math.min(WITCH_SHAPE_MAX_EDGES,Math.max(a.edges.length,b.edges.length))},(_,index)=>{
      const from=a.edges[index]??blankEdge,to=b.edges[index]??blankEdge;
      return {a:pointBetween(from.a,to.a,t),b:pointBetween(from.b,to.b,t),alpha:mix(from.alpha,to.alpha,t),
        depth:mix(from.depth,to.depth,t),color:mix(from.color,to.color,t),hyper:mix(from.hyper,to.hyper,t)};
    }),
    faces:Array.from({length:Math.min(WITCH_SHAPE_MAX_FACES,Math.max(a.faces.length,b.faces.length))},(_,index)=>{
      const from=a.faces[index]??blankFace,to=b.faces[index]??blankFace;
      return {points:from.points.map((p,i)=>pointBetween(p,to.points[i],t)),alpha:mix(from.alpha,to.alpha,t),
        depth:mix(from.depth,to.depth,t),color:mix(from.color,to.color,t)};
    }),
  };
}

function sourceGeometry(source) {
  return source&&typeof source==='object'&&Array.isArray(source.edges)&&Array.isArray(source.faces)
    ? source : getWitchShapeGeometry(source);
}

/** Live geometry follows performance time. Reduced motion keeps the actual
 * native forms stationary and only crossfades their opacity. */
export function getWitchShapeFrame(state = {}) {
  const charm=state.shapeCharm??{},to=getWitchShapeForm(charm.to),from=sourceGeometry(charm.from??to.index);
  const age=Number.isFinite(charm.startedAt)&&Number.isFinite(state.performanceTime)?state.performanceTime-charm.startedAt:WITCH_SHAPE_MORPH_SECONDS;
  const progress=clamp(age/WITCH_SHAPE_MORPH_SECONDS),amount=smooth(progress);
  const target=getWitchShapeGeometry(to.index);
  const weights=Array.from({length:WITCH_SHAPE_FORMS.length},(_,index)=>
    mix(charm.from?.weights?.[index]??Number(index===getWitchShapeForm(from.form).index),Number(index===to.index),amount));
  const geometry=geometryBetween(from,target,amount);
  const layers=state.reducedMotion?weights.flatMap((alpha,index)=>alpha>.0001?[{geometry:getWitchShapeGeometry(index),alpha}]:[]):[{geometry,alpha:1}];
  return {form:to.index,id:to.id,dimension:to.dimension,progress,morphing:progress<1,geometry,weights,layers};
}

/** Retain one sampled mesh and eight weights, never a recursive animation
 * history. A rapid click begins exactly where the previous morph was drawn. */
export function retargetWitchShapeCharm(charm,to,time) {
  const now=Number.isFinite(time)?Math.max(0,time):0;
  const frame=getWitchShapeFrame({shapeCharm:charm,performanceTime:now});
  return {from:{...frame.geometry,weights:frame.weights},to:getWitchShapeForm(to).index,startedAt:now};
}
