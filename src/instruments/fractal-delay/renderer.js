/** Visible vectors and wave traces share the installed DSP graph. The only
 * displacement source is actual travelling-wave pressure from Rust telemetry.
 * A separate GPU surface keeps the interactive canvas and its listeners intact
 * when WebGL is unavailable or loses its context. */
const SAMPLES = 32, EDGES_PER_ROW = 32, TEXTURE_WIDTH = SAMPLES * EDGES_PER_ROW;
const PALETTES = { inverse: [155, 225], contours: [285, 345], orbits: [30, 65], rays: [190, 255], membrane: [105, 170] };
function colorFor(edge, mode) {
  if (edge.routingLink) return [.3, .72, .8];
  const [low, high] = PALETTES[mode] || PALETTES.inverse;
  const hue = low + (high - low) * ((edge.id >>> 0) % 997) / 997;
  const c = .72, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = .24;
  const color = hue < 60 ? [c,x,0] : hue < 120 ? [x,c,0] : hue < 180 ? [0,c,x] : hue < 240 ? [0,x,c] : hue < 300 ? [x,0,c] : [c,0,x];
  return color.map(value => value + m);
}
function markersFor(network) {
  const inputs = Array.isArray(network.inputPorts) ? network.inputPorts : [{ node: network.inputNode, weight: 1 }];
  const pickups = Array.isArray(network.pickupPorts) ? network.pickupPorts : [{ node: network.pickupNode, weight: 1 }];
  const inputNodes = new Set(inputs.map(port => port.node)), multiport = inputs.length + pickups.length > 2;
  return [[inputs, [.25, 1, .46], '#40ff76', false], [pickups, [1, .62, .2], '#ff9f33', true]].flatMap(([ports, color, css, pickup]) => {
    const maximum = ports.reduce((maximum, port) => Math.max(maximum, port.weight), Number.EPSILON);
    return ports.filter(port => network.nodes[port.node] && port.weight > 0).map(port => {
      const node = network.nodes[port.node], relative = Math.sqrt(port.weight / maximum);
      return { node: port.node, x: node.x, y: node.y, color, css, scale: .55 + .45 * relative,
        alpha: .6 + .4 * relative, ring: multiport && pickup && inputNodes.has(port.node) };
    });
  });
}
function shader(gl, type, source) {
  const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(result); gl.deleteShader(result); throw new Error(error); }
  return result;
}
function program(gl, vertex, fragment) {
  const v = shader(gl, gl.VERTEX_SHADER, vertex), f = shader(gl, gl.FRAGMENT_SHADER, fragment), result = gl.createProgram();
  gl.attachShader(result,v); gl.attachShader(result,f); gl.linkProgram(result); gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(result,gl.LINK_STATUS)) { const error=gl.getProgramInfoLog(result);gl.deleteProgram(result);throw new Error(error); }
  return result;
}
const VERTEX = `#version 300 es
precision highp float;
precision highp sampler2D;
layout(location=0) in vec2 aStart;
layout(location=1) in vec2 aEnd;
layout(location=2) in vec3 aColor;
uniform vec2 uViewport;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform sampler2D uPressure;
uniform float uWave;
uniform float uWidth;
uniform float uAmplitude;
out vec3 vColor;
void main(){
  int sampleIndex=gl_VertexID/2;
  float t=float(sampleIndex)/31.0;
  vec2 a=aStart*uScale+uOffset;
  vec2 b=aEnd*uScale+uOffset;
  vec2 direction=b-a;
  float distance=max(length(direction),0.0001);
  vec2 normal=vec2(-direction.y,direction.x)/distance;
  float pressure=texelFetch(uPressure,ivec2((gl_InstanceID%32)*32+sampleIndex,gl_InstanceID/32),0).r;
  // Endpoint taper keeps the real junction visible; it is a display window on
  // measured pressure, never a phase animation or an invented waveform.
  float taper=1.0-pow(abs(t*2.0-1.0),4.0);
  float displacement=clamp(pressure,-0.125,0.125)*uAmplitude*taper*uWave;
  float side=(gl_VertexID%2==0)?-0.5:0.5;
  vec2 position=mix(a,b,t)+normal*(displacement+side*uWidth);
  gl_Position=vec4(position/uViewport*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);
  vColor=aColor;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor;
uniform float uAlpha;
out vec4 outColor;
void main(){outColor=vec4(vColor,uAlpha);}`;
const DOT_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
layout(location=1) in vec3 aColor;
layout(location=2) in float aSize;
layout(location=3) in float aAlpha;
layout(location=4) in float aRing;
uniform vec2 uViewport;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform float uSize;
out vec3 vColor;
out float vAlpha;
out float vRing;
void main(){vec2 position=aPosition*uScale+uOffset;
gl_Position=vec4(position/uViewport*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);
gl_PointSize=uSize*aSize+aRing*uSize*.36;vColor=aColor;vAlpha=aAlpha;vRing=aRing;}`;
const DOT_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
in float vRing;
out vec4 outColor;
void main(){float distance=length(gl_PointCoord-vec2(0.5));if(distance>0.5)discard;
float alpha=(1.0-smoothstep(0.38,0.5,distance))*vAlpha;
if(vRing>0.5)alpha*=smoothstep(0.25,0.33,distance);outColor=vec4(vColor,alpha);}`;

function makeGpu() {
  const surface = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1,1) : document.createElement('canvas');
  const gl = surface.getContext('webgl2', { alpha:true, antialias:false, premultipliedAlpha:false, depth:false, stencil:false });
  if (!gl) return null;
  let failed = false;
  surface.addEventListener?.('webglcontextlost', event => { event.preventDefault(); failed = true; });
  const lines = program(gl,VERTEX,FRAGMENT), dots = program(gl,DOT_VERTEX,DOT_FRAGMENT);
  const edgeVao=gl.createVertexArray(),dotVao=gl.createVertexArray(),edgeBuffer=gl.createBuffer(),dotBuffer=gl.createBuffer(),texture=gl.createTexture();
  gl.bindVertexArray(edgeVao);gl.bindBuffer(gl.ARRAY_BUFFER,edgeBuffer);
  for(const [index,size,offset] of [[0,2,0],[1,2,8],[2,3,16]]){
    gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,28,offset);gl.vertexAttribDivisor(index,1);
  }
  gl.bindVertexArray(dotVao);gl.bindBuffer(gl.ARRAY_BUFFER,dotBuffer);
  for(const [index,size,offset] of [[0,2,0],[1,3,8],[2,1,20],[3,1,24],[4,1,28]]){
    gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,32,offset);
  }
  gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  const uniform = (p,name) => gl.getUniformLocation(p,name);
  const lineUniforms = Object.fromEntries(['uViewport','uScale','uOffset','uPressure','uWave','uWidth','uAmplitude','uAlpha'].map(name=>[name,uniform(lines,name)]));
  const dotUniforms = Object.fromEntries(['uViewport','uScale','uOffset','uSize'].map(name=>[name,uniform(dots,name)]));
  let edgeCount=0, markerCount=0, textureHeight=1, pressures=new Float32Array(TEXTURE_WIDTH);
  return {
    surface,
    get failed(){return failed;},
    setNetwork(network,colors,markers){
      edgeCount=network.edges.length;const data=new Float32Array(edgeCount*7);
      network.edges.forEach((edge,i)=>{const a=network.nodes[edge.a],b=network.nodes[edge.b];data.set([a.x,a.y,b.x,b.y,...colors[i]],i*7);});
      gl.bindBuffer(gl.ARRAY_BUFFER,edgeBuffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
      markerCount=markers.length;const markerData=new Float32Array(markerCount*8);
      markers.forEach((marker,i)=>markerData.set([marker.x,marker.y,...marker.color,marker.scale,marker.alpha,Number(marker.ring)],i*8));
      gl.bindBuffer(gl.ARRAY_BUFFER,dotBuffer);gl.bufferData(gl.ARRAY_BUFFER,markerData,gl.STATIC_DRAW);
      textureHeight=Math.max(1,Math.ceil(edgeCount/EDGES_PER_ROW));pressures=new Float32Array(TEXTURE_WIDTH*textureHeight);
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,TEXTURE_WIDTH,textureHeight,0,gl.RED,gl.FLOAT,pressures);
    },
    setPressure(values){
      pressures.fill(0);if(values)pressures.set(values.subarray(0,edgeCount*SAMPLES));
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,TEXTURE_WIDTH,textureHeight,gl.RED,gl.FLOAT,pressures);
    },
    draw(width,height,transform,dpr){
      if(surface.width!==width||surface.height!==height){surface.width=width;surface.height=height;}
      gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(lines);gl.bindVertexArray(edgeVao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.uniform2f(lineUniforms.uViewport,width,height);gl.uniform2f(lineUniforms.uScale,transform.scaleX,transform.scaleY);
      gl.uniform2f(lineUniforms.uOffset,transform.offsetX,transform.offsetY);gl.uniform1i(lineUniforms.uPressure,0);
      gl.uniform1f(lineUniforms.uAmplitude,120*dpr);
      gl.uniform1f(lineUniforms.uWave,0);gl.uniform1f(lineUniforms.uWidth,1.15*dpr);gl.uniform1f(lineUniforms.uAlpha,.44);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,SAMPLES*2,edgeCount);
      gl.uniform1f(lineUniforms.uWave,1);gl.uniform1f(lineUniforms.uWidth,1.4*dpr);gl.uniform1f(lineUniforms.uAlpha,.92);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,SAMPLES*2,edgeCount);
      gl.useProgram(dots);gl.bindVertexArray(dotVao);gl.uniform2f(dotUniforms.uViewport,width,height);
      gl.uniform2f(dotUniforms.uScale,transform.scaleX,transform.scaleY);gl.uniform2f(dotUniforms.uOffset,transform.offsetX,transform.offsetY);
      gl.uniform1f(dotUniforms.uSize,11*dpr);gl.drawArrays(gl.POINTS,0,markerCount);gl.bindVertexArray(null);
    },
    dispose(){gl.deleteBuffer(edgeBuffer);gl.deleteBuffer(dotBuffer);gl.deleteVertexArray(edgeVao);gl.deleteVertexArray(dotVao);
      gl.deleteTexture(texture);gl.deleteProgram(lines);gl.deleteProgram(dots);}
  };
}

export function createNetworkRenderer(canvas) {
  const context=canvas.getContext('2d',{alpha:true});
  if(!context)throw new Error('A graphics surface could not be created');
  let gpu;
  try{gpu=makeGpu();}catch{gpu=null;}
  let network=null,status=null,colors=[],markers=[],dead=false,dpr=1,width=1,height=1,lastUpload=null,fitDirty=true;
  let markerSurface=null,markerContext=null,markerCacheTried=false,markersDirty=true;
  let transform={scaleX:1,scaleY:-1,offsetX:0,offsetY:0};
  function resize(){
    const rect=canvas.getBoundingClientRect(),nextDpr=Math.min(1.75,Math.max(1,globalThis.devicePixelRatio||1));
    const nextWidth=Math.max(1,Math.round(rect.width*nextDpr)),nextHeight=Math.max(1,Math.round(rect.height*nextDpr));
    if(!fitDirty&&nextWidth===width&&nextHeight===height&&nextDpr===dpr)return;
    dpr=nextDpr;width=nextWidth;height=nextHeight;fitDirty=false;markersDirty=true;
    if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
    if(network){
      const bounds=network.bounds||network.nodes.reduce((b,node)=>({minX:Math.min(b.minX,node.x),maxX:Math.max(b.maxX,node.x),
        minY:Math.min(b.minY,node.y),maxY:Math.max(b.maxY,node.y)}),{minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity});
      const pad=Math.min(36*dpr,width*.12,height*.12),spanX=Math.max(.15,bounds.maxX-bounds.minX),spanY=Math.max(.15,bounds.maxY-bounds.minY);
      const scale=Math.min(Math.max(1,width-2*pad)/spanX,Math.max(1,height-2*pad)/spanY);
      transform={scaleX:scale,scaleY:-scale,offsetX:width*.5-(bounds.minX+bounds.maxX)*.5*scale,
        offsetY:height*.5+(bounds.minY+bounds.maxY)*.5*scale};
    }
  }
  const point=node=>({x:node.x*transform.scaleX+transform.offsetX,y:node.y*transform.scaleY+transform.offsetY});
  function coherentWave(){return status&&status.revision===network?.revision&&status.waveformSize===SAMPLES
    &&status.edgeWaveforms?.length===network.edges.length*SAMPLES?status.edgeWaveforms:null;}
  function drawCanvas(wave){
    context.lineCap='round';context.lineJoin='round';
    for(let i=0;i<network.edges.length;i++){
      const edge=network.edges[i],a=point(network.nodes[edge.a]),b=point(network.nodes[edge.b]);
      const dx=b.x-a.x,dy=b.y-a.y,distance=Math.max(.0001,Math.hypot(dx,dy)),nx=-dy/distance,ny=dx/distance;
      const rgb=colors[i].map(value=>Math.round(value*255));context.strokeStyle=`rgba(${rgb.join(',')},0.48)`;context.lineWidth=1.15*dpr;
      context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.stroke();
      context.strokeStyle=`rgba(${rgb.join(',')},0.92)`;context.lineWidth=1.4*dpr;context.beginPath();
      for(let j=0;j<SAMPLES;j++){const t=j/(SAMPLES-1),taper=1-Math.abs(2*t-1)**4;
        const displacement=Math.max(-.125,Math.min(.125,wave?.[i*SAMPLES+j]||0))*120*dpr*taper;
        const x=a.x+dx*t+nx*displacement,y=a.y+dy*t+ny*displacement;j?context.lineTo(x,y):context.moveTo(x,y);}
      context.stroke();
    }
    drawCanvasMarkers();
  }
  function paintMarkers(target){
    for(const marker of markers){
      const p=point(marker);target.globalAlpha=marker.alpha;target.beginPath();
      target.arc(p.x,p.y,(5*marker.scale+(marker.ring?1.8:0))*dpr,0,Math.PI*2);
      if(marker.ring){target.strokeStyle=marker.css;target.lineWidth=1.8*dpr;target.stroke();}
      else{target.fillStyle=marker.css;target.fill();}
    }
    target.globalAlpha=1;
  }
  function drawCanvasMarkers(){
    if(!markerCacheTried){
      markerCacheTried=true;
      const factories=[];
      if(typeof OffscreenCanvas==='function')factories.push(()=>new OffscreenCanvas(width,height));
      if(typeof document!=='undefined')factories.push(()=>document.createElement('canvas'));
      for(const create of factories){try{const surface=create(),target=surface.getContext('2d',{alpha:true});
        if(target){markerSurface=surface;markerContext=target;break;}}catch{}}
    }
    if(!markerContext){paintMarkers(context);return;}
    if(markersDirty){
      markerSurface.width=width;markerSurface.height=height;markerContext.clearRect(0,0,width,height);
      paintMarkers(markerContext);markersDirty=false;
    }
    context.drawImage(markerSurface,0,0);
  }
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;observer?.observe(canvas);resize();
  return {
    get renderer(){return gpu&&!gpu.failed?'WebGL2':'Canvas2D';},
    setNetwork(next){
      network=next;status=null;lastUpload=null;fitDirty=true;colors=next?.edges.map(edge=>colorFor(edge,next.mode))||[];
      markers=next?markersFor(next):[];markersDirty=true;
      if(gpu&&!gpu.failed&&next){try{gpu.setNetwork(next,colors,markers);}catch{gpu.dispose();gpu=null;}}
      resize();
    },
    setStatus(next){status=next;},
    resize,
    draw(){
      if(dead)return;context.clearRect(0,0,width,height);if(!network?.edges.length)return;
      const wave=coherentWave();
      if(gpu&&!gpu.failed){try{
        if(lastUpload!==wave){gpu.setPressure(wave);lastUpload=wave;}
        gpu.draw(width,height,transform,dpr);context.drawImage(gpu.surface,0,0);return;
      }catch{gpu.dispose();gpu=null;}}
      drawCanvas(wave);
    },
    dispose(){if(dead)return;dead=true;observer?.disconnect();gpu?.dispose();gpu=null;
      if(markerSurface){markerSurface.width=markerSurface.height=1;}markerSurface=markerContext=null;context.clearRect(0,0,width,height);}
  };
}
