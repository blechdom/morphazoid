/** Instanced branch ribbons. Audio owns the clock and meters; the GPU only draws. */
const VERTEX_DECLARATIONS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec4 aEndpoints;
layout(location=1) in vec4 aTiming;
layout(location=2) in float aPhase;
layout(location=3) in vec4 aSignal;
uniform vec2 uSize;
uniform vec3 uFit;
uniform float uSeconds;
uniform int uDetailSteps;
uniform bool uReducedMotion;
uniform bool uAvailablePass;
uniform sampler2D uHistory;
// Count, texture width, sample interval, seconds since the last envelope sample.
uniform vec4 uHistorySettings;
uniform vec3 uPalette[7];`;

const DEFORMATION_SOURCE = `
float unit(float value) { return clamp(value, 0.0, 1.0); }
float envelopeValue(int index) {
  int width = int(uHistorySettings.y);
  return texelFetch(uHistory, ivec2(index % width, index / width), 0).r;
}
float envelopeAt(float delay) {
  int count = int(uHistorySettings.x);
  if (count == 0) return 0.0;
  float elapsed = uHistorySettings.w - delay;
  if (elapsed >= 0.0) return max(0.0, envelopeValue(count - 1)) * exp(-elapsed / .16);
  float position = float(count - 1) + elapsed / uHistorySettings.z;
  if (position < 0.0) return 0.0;
  int before = int(floor(position));
  int after = min(before + 1, count - 1);
  return max(0.0, mix(envelopeValue(before), envelopeValue(after), fract(position)));
}
float signalAt(float progress) {
  int flags = int(aSignal.w);
  bool history = (flags & 2) != 0;
  bool measured = (flags & 4) != 0;
  bool parentMeasured = (flags & 8) != 0;
  float transit = aTiming.y - aTiming.x;
  float strength = history ? unit(1.0 - exp(-max(0.0, envelopeAt(mix(aTiming.x, aTiming.y, progress))) * 5.0)) * unit(aSignal.z) : unit(aSignal.x);
  if (measured) {
    float measuredEnergy = unit(aSignal.x);
    if (!history || transit <= .1) strength = measuredEnergy;
    else {
      strength = mix(strength, measuredEnergy, smoothstep(.8, 1.0, progress));
      if (parentMeasured) strength = mix(unit(aSignal.y), strength, smoothstep(0.0, .2, progress));
      strength = mix(measuredEnergy, strength, smoothstep(.1, .14, transit));
    }
  }
  return strength;
}
vec2 project(vec2 point) { return point * vec2(uFit.x, -uFit.x) + uFit.yz; }
vec2 centerAt(float progress, vec2 start, vec2 delta, float length) {
  vec2 point = start + delta * progress;
  // The exact endpoints remain shared by adjoining branches, including silence.
  if (uReducedMotion || (int(aSignal.w) & 1) == 0 || progress <= 0.0 || progress >= 1.0 || length <= .000001) return point;
  float shortness = unit(1.0 - length / 64.0);
  float maximum = 8.0 + shortness * 8.0;
  float carrier = sin(uSeconds * 9.0 * sqrt(clamp(aTiming.z, .25, 4.0)) + progress * 3.141592653589793 * (3.0 + aTiming.w * .35) + aPhase);
  float offset = sin(3.141592653589793 * progress) * sqrt(signalAt(progress)) * maximum * carrier;
  return point + vec2(-delta.y, delta.x) / length * offset;
}
vec2 direction(vec2 delta) {
  float magnitude = length(delta);
  return magnitude > .000001 ? delta / magnitude : vec2(1.0, 0.0);
}`;

const VERTEX_SOURCE = `${VERTEX_DECLARATIONS}
out vec2 vCenterCss;
out float vSignalEnergy;
out float vEdge;
flat out float vHalfWidth;
flat out vec4 vColor;
${DEFORMATION_SOURCE}
void main() {
  bool available = (int(aSignal.w) & 1) != 0;
  // Skip deformation entirely for instances belonging to the other pass.
  if (available != uAvailablePass) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vCenterCss = vec2(0.0); vSignalEnergy = 0.0; vEdge = 0.0;
    vHalfWidth = 0.0; vColor = vec4(0.0);
    return;
  }
  vec2 start = project(aEndpoints.xy);
  vec2 delta = project(aEndpoints.zw) - start;
  float branchLength = length(delta);
  int steps = max(5, min(uDetailSteps, max(5, int(ceil(branchLength / 14.0)))));
  int index = min(gl_VertexID / 2, steps);
  float progress = float(index) / float(steps);
  vec2 center = centerAt(progress, start, delta, branchLength);
  vec2 before = centerAt(float(max(0, index - 1)) / float(steps), start, delta, branchLength);
  vec2 after = centerAt(float(min(steps, index + 1)) / float(steps), start, delta, branchLength);
  vec2 incoming = direction(index == 0 ? after - center : center - before);
  vec2 outgoing = direction(index == steps ? center - before : after - center);
  vec2 normal = direction(vec2(-incoming.y - outgoing.y, incoming.x + outgoing.x));
  vec2 outgoingNormal = vec2(-outgoing.y, outgoing.x);
  float join = 1.0 / max(.3, dot(normal, outgoingNormal));
  vHalfWidth = available ? .6 : .36;
  // Coverage is evaluated per fragment, so thin ribbons do not need MSAA.
  float edge = vHalfWidth + 1.0;
  vEdge = (gl_VertexID % 2 == 0 ? -edge : edge);
  vec2 point = center + normal * vEdge * join;
  gl_Position = vec4(point / uSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  vCenterCss = center;
  vSignalEnergy = signalAt(progress);
  vColor = available ? vec4(uPalette[int(aTiming.w) % 7], .85) : vec4(vec3(119.0, 131.0, 126.0) / 255.0, .232);
}`;

// Endpoint semicircles meet the ribbons without drawing their interior twice.
// Their tangent is the same first/last wave segment used by Canvas round caps.
const CAP_VERTEX_SOURCE = `${VERTEX_DECLARATIONS}
out vec2 vCapOffset;
flat out vec2 vCapAxis;
flat out float vHalfWidth;
flat out vec4 vColor;
${DEFORMATION_SOURCE}
void main() {
  bool available = (int(aSignal.w) & 1) != 0;
  if (available != uAvailablePass) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vCapOffset = vec2(0.0); vCapAxis = vec2(1.0, 0.0);
    vHalfWidth = 0.0; vColor = vec4(0.0);
    return;
  }
  vec2 start = project(aEndpoints.xy);
  vec2 delta = project(aEndpoints.zw) - start;
  float branchLength = length(delta);
  int steps = max(5, min(uDetailSteps, max(5, int(ceil(branchLength / 14.0)))));
  bool atStart = gl_VertexID < 6;
  float progress = atStart ? 0.0 : 1.0;
  vec2 center = start + delta * progress;
  float nextProgress = atStart ? 1.0 / float(steps) : 1.0 - 1.0 / float(steps);
  vec2 neighbor = centerAt(nextProgress, start, delta, branchLength);
  // On a zero-length edge, two opposing half-discs form its round point.
  vCapAxis = direction(center - neighbor);
  if (branchLength <= .000001) vCapAxis = atStart ? vec2(-1.0, 0.0) : vec2(1.0, 0.0);
  int corner = gl_VertexID % 6;
  vec2 sign = corner == 0 ? vec2(-1.0, -1.0) : corner == 1 || corner == 3 ? vec2(1.0, -1.0) : corner == 2 || corner == 4 ? vec2(-1.0, 1.0) : vec2(1.0, 1.0);
  vHalfWidth = available ? .6 : .36;
  vCapOffset = sign * (vHalfWidth + 1.0);
  vec2 point = center + vCapOffset;
  gl_Position = vec4(point / uSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  vColor = available ? vec4(uPalette[int(aTiming.w) % 7], .85) : vec4(vec3(119.0, 131.0, 126.0) / 255.0, .232);
}`;

const CAP_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 vCapOffset;
flat in vec2 vCapAxis;
flat in float vHalfWidth;
flat in vec4 vColor;
out vec4 outColor;
float primitive(float coordinate, float radius) {
  return .5 * (coordinate * sqrt(max(0.0, radius * radius - coordinate * coordinate)) + radius * radius * asin(clamp(coordinate / radius, 0.0, 1.0)));
}
float quadrant(float x, float y, float hx, float hy, float radius) {
  float area = x * x + y * y <= radius * radius ? abs(x * y) : hx + hy - radius * radius * .7853981633974483;
  return sign(x) * sign(y) * area;
}
void main() {
  // A circle near one pixel wide needs area coverage rather than a linear SDF
  // ramp, which substantially over-brightens zero-length and deep short edges.
  // Derivatives are evaluated before discarding the half inside the ribbon.
  vec2 halfPixel = .5 * vec2(length(dFdx(vCapOffset)), length(dFdy(vCapOffset)));
  if (dot(vCapOffset, vCapAxis) < 0.0) discard;
  vec2 x = clamp(vec2(vCapOffset.x) + vec2(-halfPixel.x, halfPixel.x), -vHalfWidth, vHalfWidth);
  vec2 y = clamp(vec2(vCapOffset.y) + vec2(-halfPixel.y, halfPixel.y), -vHalfWidth, vHalfWidth);
  vec2 hx = vec2(primitive(abs(x.x), vHalfWidth), primitive(abs(x.y), vHalfWidth));
  vec2 hy = vec2(primitive(abs(y.x), vHalfWidth), primitive(abs(y.y), vHalfWidth));
  float area = quadrant(x.y, y.y, hx.y, hy.y, vHalfWidth) - quadrant(x.x, y.y, hx.x, hy.y, vHalfWidth)
    - quadrant(x.y, y.x, hx.y, hy.x, vHalfWidth) + quadrant(x.x, y.x, hx.x, hy.x, vHalfWidth);
  float coverage = clamp(area / max(.0001, 4.0 * halfPixel.x * halfPixel.y), 0.0, 1.0);
  float alpha = vColor.a * coverage;
  outColor = vec4(vColor.rgb * alpha, alpha);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in float vEdge;
flat in float vHalfWidth;
flat in vec4 vColor;
out vec4 outColor;
void main() {
  float pixel = max(.0001, fwidth(vEdge));
  float coverage = clamp((vHalfWidth - abs(vEdge)) / pixel + .5, 0.0, 1.0);
  float alpha = vColor.a * coverage;
  outColor = vec4(vColor.rgb * alpha, alpha);
}`;

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const EMPTY_MAP = new Map();

function paletteValues(colors) {
  const values = new Float32Array(21);
  for (let index = 0; index < 7; index++) {
    const color = /^#([0-9a-f]{6})$/i.exec(colors[index] ?? '#ffffff');
    const hex = Number.parseInt(color?.[1] ?? 'ffffff', 16);
    values.set([(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255], index * 3);
  }
  return values;
}

/**
 * Separate transparent layer keeps the original gesture/annotation Canvas2D
 * intact. Unsupported GPUs and lost contexts fall back without touching audio.
 */
export function createGpuBranchRenderer(stageCanvas, colors, { onInvalidate = () => {}, force = false } = {}) {
  const document = stageCanvas?.ownerDocument;
  if (!document || !stageCanvas.parentNode) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'native-gpu-stage';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  canvas.hidden = true;
  let gl;
  try { gl = canvas.getContext('webgl2', { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false }); }
  catch { return null; }
  if (!gl) return null;
  let backend = '';
  try {
    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    backend = String(gl.getParameter(rendererInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) ?? '');
  } catch { /* Privacy-limited browser: initialize and retain Canvas fallback. */ }
  // CPU software rasterizers compete with audio and are slower on large trees.
  // An explicit trial may force this backend for reproducible comparison.
  if (!force && /swiftshader|llvmpipe|softpipe|software\s*rasterizer|microsoft.*basic.*render|mesa\s*offscreen/i.test(backend)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }

  let disposed = false, ready = false, resources = null, maximumTextureSize = 0;
  let cachedNodes = [], cachedGeometryOptions = {}, cachedDrawNodes = [], sourceNodes = [], sourceIndices = new Map(), sourceStaticData = new Float32Array();
  let nodes = [], drawIndices = [], staticData = new Float32Array(), meterData = new Float32Array();
  let maximumGeneration = 0, generationLevels = new Float32Array(1);
  let historyValues = null, historyInterval = 0, historyEnd = 0, historyCount = 0, historyWidth = 1, historyHeight = 1;
  let historyScratch = new Float32Array();
  const palette = paletteValues(colors);
  const counters = { backend, nodeCount: 0, previewNodeCount: 0, topologyUploads: 0, selectionUploads: 0, positionUploads: 0, meterUploads: 0,
    historyUploads: 0, historyTextureAllocations: 0, historyScratchAllocations: 0, historyTextureCapacity: 1, historyScratchCapacity: 0, drawCalls: 0 };

  function releaseResources() {
    if (!resources) return;
    gl.deleteBuffer(resources.topology);
    gl.deleteBuffer(resources.meters);
    gl.deleteTexture(resources.history);
    gl.deleteVertexArray(resources.vao);
    gl.deleteProgram(resources.program);
    gl.deleteProgram(resources.caps);
    resources = null;
  }
  function shader(type, source) {
    const compiled = gl.createShader(type);
    if (!compiled) throw new Error('GPU shader allocation unavailable');
    gl.shaderSource(compiled, source); gl.compileShader(compiled);
    if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
      gl.deleteShader(compiled); throw new Error('GPU branch shader unavailable');
    }
    return compiled;
  }
  function initialize() {
    let vertex = null, fragment = null, capVertex = null, capFragment = null;
    resources = { program: gl.createProgram(), caps: gl.createProgram(), topology: gl.createBuffer(), meters: gl.createBuffer(), history: gl.createTexture(), vao: gl.createVertexArray(), uniforms: {}, capUniforms: {} };
    try {
      if (Object.values(resources).some(value => value === null)) throw new Error('GPU allocation unavailable');
      vertex = shader(gl.VERTEX_SHADER, VERTEX_SOURCE); fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
      gl.attachShader(resources.program, vertex); gl.attachShader(resources.program, fragment); gl.linkProgram(resources.program);
      if (!gl.getProgramParameter(resources.program, gl.LINK_STATUS)) throw new Error('GPU branch program unavailable');
      capVertex = shader(gl.VERTEX_SHADER, CAP_VERTEX_SOURCE); capFragment = shader(gl.FRAGMENT_SHADER, CAP_FRAGMENT_SOURCE);
      gl.attachShader(resources.caps, capVertex); gl.attachShader(resources.caps, capFragment); gl.linkProgram(resources.caps);
      if (!gl.getProgramParameter(resources.caps, gl.LINK_STATUS)) throw new Error('GPU cap program unavailable');
      for (const name of ['uSize', 'uFit', 'uSeconds', 'uDetailSteps', 'uReducedMotion', 'uAvailablePass', 'uHistory', 'uHistorySettings', 'uPalette[0]']) {
        resources.uniforms[name] = gl.getUniformLocation(resources.program, name);
        resources.capUniforms[name] = gl.getUniformLocation(resources.caps, name);
      }
      maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      gl.bindVertexArray(resources.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.topology);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 36, 0); gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 36, 16); gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 36, 32); gl.vertexAttribDivisor(2, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.meters);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(3, 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, resources.history);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array(1));
      counters.historyTextureAllocations++; counters.historyTextureCapacity = 1;
      gl.useProgram(resources.program); gl.uniform1i(resources.uniforms.uHistory, 0); gl.uniform3fv(resources.uniforms['uPalette[0]'], palette);
      gl.useProgram(resources.caps); gl.uniform1i(resources.capUniforms.uHistory, 0); gl.uniform3fv(resources.capUniforms['uPalette[0]'], palette);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.clearColor(0, 0, 0, 0);
      historyValues = null; historyCount = 0; historyWidth = 1; historyHeight = 1;
      ready = true;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (capVertex) gl.deleteShader(capVertex);
      if (capFragment) gl.deleteShader(capFragment);
    }
  }

  function uploadGeometry(selection = false) {
    gl.bindVertexArray(resources.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.topology); gl.bufferData(gl.ARRAY_BUFFER, staticData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.meters); gl.bufferData(gl.ARRAY_BUFFER, meterData.byteLength, gl.DYNAMIC_DRAW);
    counters[selection ? 'selectionUploads' : 'topologyUploads']++;
  }
  function selectGeometry(nextDrawNodes, topology = false) {
    cachedDrawNodes = nextDrawNodes;
    drawIndices = nextDrawNodes.map(node => sourceIndices.get(node.id)).filter(index => index !== undefined);
    nodes = drawIndices.map(index => sourceNodes[index]);
    staticData = new Float32Array(nodes.length * 9); meterData = new Float32Array(nodes.length * 4);
    for (let index = 0; index < drawIndices.length; index++) {
      const sourceIndex = drawIndices[index], node = cachedNodes[sourceIndex], offset = index * 9;
      staticData.set(sourceStaticData.subarray(sourceIndex * 9, sourceIndex * 9 + 9), offset);
      // A hidden branch may have completed a morph since the last selection.
      staticData[offset] = finite(node.startX); staticData[offset + 1] = finite(node.startY);
      staticData[offset + 2] = finite(node.x); staticData[offset + 3] = finite(node.y);
    }
    counters.nodeCount = nodes.length;
    if (ready) uploadGeometry(!topology);
  }
  function setGeometry(nextNodes, { intervalMs, drawNodes } = {}) {
    if (disposed) return;
    cachedNodes = nextNodes ?? [];
    cachedGeometryOptions = { ...(Number.isFinite(intervalMs) ? { intervalMs } : {}), drawNodes: drawNodes ?? cachedNodes };
    const byId = new Map(cachedNodes.map(node => [node.id, node]));
    sourceStaticData = new Float32Array(cachedNodes.length * 9);
    sourceIndices = new Map(cachedNodes.map((node, index) => [node.id, index]));
    maximumGeneration = 0;
    sourceNodes = cachedNodes.map((node, index) => {
      const parent = byId.get(node.parentId), root = node.generation === 0;
      const generation = Math.max(0, Math.floor(finite(node.generation)));
      maximumGeneration = Math.max(maximumGeneration, generation);
      // The normal connected tree uses its actual parent. Keep the Canvas app's
      // interval fallback for a sampled edge whose ancestor is not in the view.
      const fallbackDelay = Number.isFinite(intervalMs) ? Math.max(0, finite(node.delay) - intervalMs / 1000) : finite(node.startDelay, finite(node.delay));
      const startDelay = root ? 0 : Math.max(0, finite(parent?.delay, fallbackDelay));
      const endDelay = root ? 0 : Math.max(startDelay, finite(node.delay));
      // Pool indices may exceed exact Float32 integers on deep native trees.
      // Reduce the phase in JS once, before uploading immutable topology.
      const phase = (finite(node.index, finite(node.voiceIndex)) * .71) % (Math.PI * 2);
      sourceStaticData.set([finite(node.startX), finite(node.startY), finite(node.x), finite(node.y), startDelay, endDelay, finite(node.rate, 1), generation, phase], index * 9);
      return { root, generation, voiceIndex: node.voiceIndex, parentVoiceIndex: parent?.voiceIndex, parentRoot: parent?.generation === 0,
        priority: Number.isInteger(node.priority) && node.priority >= 0 ? node.priority : Infinity };
    });
    generationLevels = new Float32Array(maximumGeneration + 1);
    counters.previewNodeCount = cachedNodes.length;
    selectGeometry(drawNodes ?? cachedNodes, true);
  }

  function updateGeometryPositions(nextNodes) {
    if (disposed || nextNodes !== cachedNodes) return;
    // A committed morph changes only endpoints. Retain voice ranks, delays,
    // meters and their buffers rather than allocating another topology frame.
    for (let index = 0; index < drawIndices.length; index++) {
      const node = cachedNodes[drawIndices[index]], offset = index * 9;
      staticData[offset] = finite(node.startX); staticData[offset + 1] = finite(node.startY);
      staticData[offset + 2] = finite(node.x); staticData[offset + 3] = finite(node.y);
    }
    if (ready) {
      gl.bindVertexArray(resources.vao); gl.bindBuffer(gl.ARRAY_BUFFER, resources.topology);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, staticData); counters.positionUploads++;
    }
  }

  function uploadHistory(history) {
    const values = history?.values, interval = history?.interval, end = history?.endTime;
    if (!values?.length || !Number.isFinite(interval) || interval <= 0 || !Number.isFinite(end)) { historyCount = 0; return false; }
    if (values.length > maximumTextureSize * maximumTextureSize) { historyCount = 0; return false; }
    if (historyValues === values && historyInterval === interval && historyEnd === end) { historyCount = values.length; return true; }
    let capacity = historyWidth * historyHeight;
    while (capacity < values.length) capacity = Math.min(maximumTextureSize * maximumTextureSize, capacity * 2);
    const width = Math.min(maximumTextureSize, capacity), height = Math.ceil(capacity / width);
    if (historyScratch.length < width * height) {
      historyScratch = new Float32Array(width * height);
      counters.historyScratchAllocations++; counters.historyScratchCapacity = historyScratch.length;
    }
    for (let index = 0; index < values.length; index++) historyScratch[index] = Math.max(0, finite(Number(values[index])));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, resources.history);
    if (width !== historyWidth || height !== historyHeight) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, null);
      counters.historyTextureAllocations++; counters.historyTextureCapacity = width * height;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, historyScratch);
    historyValues = values; historyInterval = interval; historyEnd = end; historyCount = values.length; historyWidth = width; historyHeight = height;
    counters.historyUploads++;
    return true;
  }

  function render(frame) {
    if (!ready || disposed) return false;
    try {
      const drawNodes = frame.drawNodes ?? cachedNodes;
      if (drawNodes !== cachedDrawNodes) selectGeometry(drawNodes);
      const width = Math.max(1, finite(frame.width, 1)), height = Math.max(1, finite(frame.height, 1)), dpr = clamp(frame.dpr, .25, 4);
      const pixelWidth = Math.max(1, Math.round(width * dpr)), pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      const historyValid = uploadHistory(frame.history);
      const levels = frame.levels ?? EMPTY_MAP, targets = frame.targets ?? EMPTY_MAP, selectedCounts = frame.selectedCounts ?? EMPTY_MAP;
      const wet = finite(frame.wetBusGain) > 0 ? clamp(frame.wet) : 0;
      const wetLevel = Math.sqrt(wet), rootLevel = clamp(frame.rootLevel), limit = Math.max(0, finite(frame.limit));
      generationLevels[0] = 1;
      for (let generation = 1; generation <= maximumGeneration; generation++) {
        const count = frame.generationCounts?.[generation] ?? selectedCounts.get(generation);
        const gain = .5 * clamp(frame.depth) ** (generation * .72) / Math.sqrt(count || 1);
        generationLevels[generation] = clamp(Math.sqrt(Math.max(0, gain) / .5) * wetLevel);
      }
      let availableCount = 0;
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index], energy = node.root ? rootLevel : clamp(levels.get(node.voiceIndex));
        // The original geometry objects carry live coefficient gain. It is an
        // admission gate, not an immutable topology attribute or amplitude.
        // Generation amplitude above already follows the applied frame depth.
        const admitted = node.root || (!frame.pending && node.priority < limit && finite(cachedNodes[drawIndices[index]].gain) > 0);
        // Exact playback selection already contains only Rust's active slots.
        // Their availability does not depend on meter coverage or amplitude;
        // rank still controls the historical input-travel approximation below.
        const available = frame.activeVoiceSelection || admitted || energy > 0;
        if (available) availableCount++;
        const measured = node.root || targets.has(node.voiceIndex);
        const parentMeasured = node.parentRoot || targets.has(node.parentVoiceIndex);
        const parentEnergy = wet > 0 ? node.parentRoot ? rootLevel * wetLevel : clamp(levels.get(node.parentVoiceIndex)) : 0;
        const history = frame.historyFresh && historyValid && !frame.pending && admitted;
        const flags = (available ? 1 : 0) | (history ? 2 : 0) | (measured ? 4 : 0) | (parentMeasured ? 8 : 0);
        const offset = index * 4;
        meterData[offset] = energy; meterData[offset + 1] = parentEnergy; meterData[offset + 2] = generationLevels[node.generation]; meterData[offset + 3] = flags;
      }
      gl.bindVertexArray(resources.vao); gl.bindBuffer(gl.ARRAY_BUFFER, resources.meters);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, meterData); counters.meterUploads++;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, resources.history);
      gl.viewport(0, 0, pixelWidth, pixelHeight); gl.clear(gl.COLOR_BUFFER_BIT);
      const detailSteps = Math.floor(clamp(frame.detailSteps, 5, 14));
      for (const [program, uniforms] of [[resources.program, resources.uniforms], [resources.caps, resources.capUniforms]]) {
        gl.useProgram(program);
        gl.uniform2f(uniforms.uSize, width, height); gl.uniform3f(uniforms.uFit, finite(frame.fit?.scale, 1), finite(frame.fit?.x), finite(frame.fit?.y));
        gl.uniform1f(uniforms.uSeconds, finite(frame.seconds)); gl.uniform1i(uniforms.uDetailSteps, detailSteps); gl.uniform1i(uniforms.uReducedMotion, Boolean(frame.reducedMotion));
        gl.uniform4f(uniforms.uHistorySettings, historyCount, historyWidth, historyInterval || 1, finite(frame.seconds) - historyEnd);
      }
      if (nodes.length) {
        for (const available of [false, true]) {
          if (available ? availableCount === 0 : availableCount === nodes.length) continue;
          gl.useProgram(resources.program); gl.uniform1i(resources.uniforms.uAvailablePass, available); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (detailSteps + 1) * 2, nodes.length);
          gl.useProgram(resources.caps); gl.uniform1i(resources.capUniforms.uAvailablePass, available); gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, nodes.length);
        }
        counters.drawCalls += (availableCount ? 2 : 0) + (availableCount < nodes.length ? 2 : 0);
      }
      canvas.hidden = false;
      return true;
    } catch {
      ready = false; canvas.hidden = true; releaseResources(); onInvalidate();
      return false;
    }
  }

  function contextLost(event) {
    event.preventDefault();
    ready = false; canvas.hidden = true;
    // All handles are invalidated by the browser; restoration allocates anew.
    resources = null;
    if (!disposed) onInvalidate();
  }
  function contextRestored() {
    if (disposed) return;
    try { initialize(); setGeometry(cachedNodes, { ...cachedGeometryOptions, drawNodes: cachedDrawNodes }); }
    catch { ready = false; canvas.hidden = true; releaseResources(); }
    onInvalidate();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ready = false;
    canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
    releaseResources(); canvas.remove(); cachedNodes = []; cachedGeometryOptions = {}; cachedDrawNodes = [];
    sourceNodes = []; sourceIndices.clear(); sourceStaticData = new Float32Array();
    nodes = []; drawIndices = []; staticData = new Float32Array(); meterData = new Float32Array(); historyValues = null; historyScratch = new Float32Array();
    // Retire the context as well as its objects when the owning page tears down.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  try { initialize(); }
  catch { ready = false; releaseResources(); gl.getExtension('WEBGL_lose_context')?.loseContext(); return null; }
  canvas.addEventListener('webglcontextlost', contextLost); canvas.addEventListener('webglcontextrestored', contextRestored);
  stageCanvas.parentNode.insertBefore(canvas, stageCanvas);
  return { canvas, get available() { return ready && !disposed; }, get stats() { return { ...counters }; }, setGeometry, updateGeometryPositions, render, dispose };
}
