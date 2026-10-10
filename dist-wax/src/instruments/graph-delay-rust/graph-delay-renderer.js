import { createGpuFrameTimer } from '../micmic/native/gpu-renderer.js';

/** Instanced, directed graph ribbons. Audio supplies all signal activity. */
const MAX_ROUTES = 16384;
const MAX_PIXELS = 4 * 1024 * 1024;
const COLORS = new Float32Array([
  1, .953, .839, .333, .851, 1, .373, .910, .769,
  .490, .706, 1, .780, .608, 1, 1, .510, .435, .910, .769, .420,
]);
const VERTEX_SOURCE = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in vec4 aEndpoints;
// Palette indices, bounded phase, and closed/feedback/terminal/output flags.
layout(location=1) in vec4 aRoute;
layout(location=2) in float aEnergy;
uniform vec2 uSize;
uniform float uSeconds;
uniform int uSteps;
uniform bool uReducedMotion;
uniform bool uArrow;
uniform vec3 uPalette[7];
out float vEdge;
out float vDistance;
out vec4 vColor;
flat out float vHalfWidth;
flat out int vFlags;
vec2 direction(vec2 value) {
  float size = length(value);
  return size > .0001 ? value / size : vec2(1.0, 0.0);
}
vec2 centerAt(float progress, vec2 delta, float size, float energy) {
  vec2 point = aEndpoints.xy + delta * progress;
  if (uReducedMotion || energy <= 0.0 || progress <= 0.0 || progress >= 1.0) return point;
  float carrier = sin(uSeconds * 11.0 + progress * 15.707963 + aRoute.z);
  float offset = sin(progress * 3.141593) * energy * min(8.0, size * .055) * carrier;
  return point + vec2(-delta.y, delta.x) / max(.0001, size) * offset;
}
void main() {
  vFlags = int(aRoute.w);
  bool closed = (vFlags & 1) != 0;
  bool feedback = (vFlags & 2) != 0;
  float energy = closed ? 0.0 : clamp(aEnergy, 0.0, 1.0);
  vec2 delta = aEndpoints.zw - aEndpoints.xy;
  float size = length(delta);
  vec2 axis = direction(delta);
  float progress;
  vec2 point;
  vHalfWidth = .575 + energy * 1.3;
  if (uArrow) {
    progress = 1.0;
    float arrowSize = min(8.0, size * .35);
    point = aEndpoints.zw;
    if (gl_VertexID > 0) point += -axis * arrowSize
      + vec2(-axis.y, axis.x) * arrowSize * (gl_VertexID == 1 ? .55 : -.55);
    vEdge = 0.0;
  } else {
    int steps = max(5, min(uSteps, int(ceil(size / 18.0))));
    int index = min(gl_VertexID / 2, steps);
    progress = float(index) / float(steps);
    vec2 center = centerAt(progress, delta, size, energy);
    vec2 before = centerAt(float(max(0, index - 1)) / float(steps), delta, size, energy);
    vec2 after = centerAt(float(min(steps, index + 1)) / float(steps), delta, size, energy);
    vec2 tangent = direction(after - before);
    vEdge = (gl_VertexID % 2 == 0 ? -1.0 : 1.0) * (vHalfWidth + 1.0);
    point = center + vec2(-tangent.y, tangent.x) * vEdge;
  }
  vec3 color = mix(uPalette[int(aRoute.x)], uPalette[int(aRoute.y)], progress);
  if (feedback) color = mix(color, uPalette[5], uArrow ? 1.0 : .35);
  color = mix(color, vec3(1.0, .953, .839), energy * .65);
  vColor = vec4(color, closed ? (uArrow ? .22 : .15) : (uArrow ? .95 : .42 + energy * .5));
  vDistance = progress * size;
  gl_Position = vec4(point / uSize * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
precision highp int;
uniform bool uArrow;
in float vEdge;
in float vDistance;
in vec4 vColor;
flat in float vHalfWidth;
flat in int vFlags;
out vec4 outColor;
void main() {
  float coverage = 1.0;
  if (!uArrow) {
    coverage = clamp((vHalfWidth - abs(vEdge)) / max(.0001, fwidth(vEdge)) + .5, 0.0, 1.0);
    // Closed switches remain visibly dashed even with stale nonzero meters.
    if ((vFlags & 1) != 0 && mod(vDistance, 8.0) > 2.5) discard;
    if ((vFlags & 8) != 0 && mod(vDistance, 7.0) > 2.0) discard;
  }
  float alpha = vColor.a * coverage;
  outColor = vec4(vColor.rgb * alpha, alpha);
}`;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const unit = value => Math.max(0, Math.min(1, finite(value)));
const measured = (levels, index) => unit(levels?.get ? levels.get(index) : levels?.[index]);
const paletteIndex = value => ((Math.trunc(finite(value)) % 7) + 7) % 7;
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);

/**
 * The owner places this transparent, aria-hidden canvas behind its Canvas2D
 * controls and calls resize in CSS pixels. draw returns false when Canvas2D
 * should draw the paths instead. Context restoration resumes automatically.
 *
 * points: CSS {x,y} positions indexed by node id; edges: {id,from,to,feedbackEdge}.
 * switches: Map keyed by "from>to", or booleans indexed by edge order.
 * edgeLevels/nodeLevels: measured 0..1 arrays or Maps keyed by edge/node id.
 * Missing measurements mean silence; no input envelope is imputed to an edge.
 */
export function createGraphDelayRenderer(canvas, { force = false, onInvalidate = () => {}, now = () => performance.now() } = {}) {
  if (!canvas?.getContext) return null;
  let gl;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, depth: false, stencil: false,
      antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
  } catch { return null; }
  if (!gl) return null;
  let backend = '';
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    backend = String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) ?? '');
  } catch { /* Browser privacy settings may hide the renderer name. */ }
  const retireContext = () => {
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* Already lost. */ }
  };
  if (!force && /swiftshader|llvmpipe|softpipe|software\s*rasterizer|microsoft.*basic.*render|mesa\s*offscreen/i.test(backend)) {
    retireContext(); return null;
  }

  let resources = null, gpuTimer = null, ready = false, disposed = false, fallbackReason = '';
  let width = 1, height = 1, requestedDpr = 1, dpr = 1, maximumSize = 4096;
  let capacity = 0, geometry = new Float32Array(), meters = new Float32Array();
  let gpuCapacity = -1, previousCount = -1, count = 0, geometryDirty = true;
  const counters = { backend, routes: 0, omittedRoutes: 0, topologyUploads: 0,
    meterUploads: 0, bufferAllocations: 0, drawCalls: 0 };

  function release() {
    gpuTimer?.dispose(); gpuTimer = null;
    if (!resources) return;
    gl.deleteBuffer(resources.geometry); gl.deleteBuffer(resources.meters);
    gl.deleteVertexArray(resources.vao); gl.deleteProgram(resources.program);
    resources = null;
  }
  function shader(type, source) {
    const result = gl.createShader(type);
    if (!result) throw new Error('Graph shader allocation failed');
    gl.shaderSource(result, source); gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      gl.deleteShader(result); throw new Error('Graph shader compilation failed');
    }
    return result;
  }
  function initialize() {
    let vertex = null, fragment = null;
    resources = { program: gl.createProgram(), geometry: gl.createBuffer(),
      meters: gl.createBuffer(), vao: gl.createVertexArray(), uniforms: {} };
    try {
      if (Object.values(resources).some(value => value === null)) throw new Error('Graph GPU allocation failed');
      vertex = shader(gl.VERTEX_SHADER, VERTEX_SOURCE); fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
      gl.attachShader(resources.program, vertex); gl.attachShader(resources.program, fragment);
      gl.linkProgram(resources.program);
      if (!gl.getProgramParameter(resources.program, gl.LINK_STATUS)) throw new Error('Graph GPU linking failed');
      for (const name of ['uSize', 'uSeconds', 'uSteps', 'uReducedMotion', 'uArrow', 'uPalette[0]']) {
        resources.uniforms[name] = gl.getUniformLocation(resources.program, name);
      }
      maximumSize = Math.max(1, finite(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 4096));
      gl.bindVertexArray(resources.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.geometry);
      for (let index = 0; index < 2; index++) {
        gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, 4, gl.FLOAT, false, 32, index * 16);
        gl.vertexAttribDivisor(index, 1);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.meters);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0); gl.vertexAttribDivisor(2, 1);
      gl.useProgram(resources.program); gl.uniform3fv(resources.uniforms['uPalette[0]'], COLORS);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.clearColor(0, 0, 0, 0);
      gpuTimer = createGpuFrameTimer(gl, { now });
      ready = true; fallbackReason = ''; geometryDirty = true; previousCount = -1; gpuCapacity = -1;
      resize(width, height, requestedDpr);
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }
  function resize(cssWidth, cssHeight, pixelRatio = 1) {
    if (disposed) return;
    width = Math.max(1, finite(cssWidth, 1)); height = Math.max(1, finite(cssHeight, 1));
    requestedDpr = Math.max(.25, finite(pixelRatio, 1));
    dpr = Math.min(2, requestedDpr, Math.sqrt(MAX_PIXELS / (width * height)), maximumSize / width, maximumSize / height);
    const pixelWidth = Math.max(1, Math.floor(width * dpr)), pixelHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  }
  function reserve(required) {
    if (capacity >= required) return;
    capacity = Math.min(MAX_ROUTES, Math.max(16, 2 ** Math.ceil(Math.log2(required))));
    geometry = new Float32Array(capacity * 8); meters = new Float32Array(capacity);
    geometryDirty = true;
  }
  function write(offset, value) {
    const next = Math.fround(value);
    if (geometry[offset] !== next) { geometry[offset] = next; geometryDirty = true; }
  }
  function route(from, to, fromColor, toColor, phase, flags, energy, startInset = 12, endInset = 15) {
    if (count >= MAX_ROUTES || !validPoint(from) || !validPoint(to)) return;
    const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
    if (distance < .001) return;
    const trimScale = Math.min(1, distance * .6 / (startInset + endInset));
    const start = startInset * trimScale / distance, end = endInset * trimScale / distance;
    const offset = count * 8;
    write(offset, from.x + dx * start); write(offset + 1, from.y + dy * start);
    write(offset + 2, to.x - dx * end); write(offset + 3, to.y - dy * end);
    write(offset + 4, fromColor); write(offset + 5, toColor);
    write(offset + 6, phase); write(offset + 7, flags);
    meters[count++] = (flags & 1) ? 0 : unit(energy);
  }
  function draw(frame = {}) {
    if (!ready || disposed) return false;
    try {
      const points = frame.points ?? [], edges = frame.edges ?? [];
      const entries = frame.entries ?? [], sinks = frame.sinks ?? [];
      const requested = edges.length + entries.length + sinks.length;
      reserve(Math.min(MAX_ROUTES, requested)); count = 0;
      for (let index = 0; index < Math.min(edges.length, MAX_ROUTES); index++) {
        const edge = edges[index], id = edge.id ?? index;
        const enabled = frame.switches?.get ? frame.switches.get(`${edge.from}>${edge.to}`) !== false : frame.switches?.[index] !== false;
        route(points[edge.from], points[edge.to], paletteIndex(edge.from), paletteIndex(edge.to),
          (finite(id) * .73) % (Math.PI * 2), (enabled ? 0 : 1) | (edge.feedbackEdge ? 2 : 0), measured(frame.edgeLevels, id));
      }
      for (let index = 0; index < Math.min(entries.length, MAX_ROUTES) && count < MAX_ROUTES; index++) {
        route(frame.inputPoint, points[entries[index]], 1, 1, 0, 4, frame.inputLevel, 15, 12);
      }
      for (let index = 0; index < Math.min(sinks.length, MAX_ROUTES) && count < MAX_ROUTES; index++) {
        route(points[sinks[index]], frame.outputPoint, 6, 6, 0, 8, measured(frame.nodeLevels, sinks[index]), 10, 18);
      }
      counters.routes = count; counters.omittedRoutes = Math.max(0, requested - count);
      gl.bindVertexArray(resources.vao);
      if (gpuCapacity !== capacity) {
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.geometry); gl.bufferData(gl.ARRAY_BUFFER, geometry.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.meters); gl.bufferData(gl.ARRAY_BUFFER, meters.byteLength, gl.DYNAMIC_DRAW);
        counters.bufferAllocations += 2; gpuCapacity = capacity;
      }
      if (geometryDirty || count !== previousCount) {
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.geometry);
        if (count) gl.bufferSubData(gl.ARRAY_BUFFER, 0, geometry, 0, count * 8);
        counters.topologyUploads++;
        geometryDirty = false; previousCount = count;
      }
      if (count) {
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.meters); gl.bufferSubData(gl.ARRAY_BUFFER, 0, meters, 0, count);
        counters.meterUploads++;
      }
      // Optional asynchronous timing covers this graph's clear and draw passes.
      // It does not estimate whole-device GPU utilization or block for results.
      gpuTimer?.begin();
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT);
      if (count) {
        const uniforms = resources.uniforms, steps = Math.max(5, Math.min(14, Math.floor(finite(frame.detailSteps, 12))));
        gl.useProgram(resources.program); gl.uniform2f(uniforms.uSize, width, height);
        gl.uniform1f(uniforms.uSeconds, finite(frame.seconds) % (Math.PI * 2 / 11));
        gl.uniform1i(uniforms.uSteps, steps); gl.uniform1i(uniforms.uReducedMotion, Boolean(frame.reducedMotion));
        gl.uniform1i(uniforms.uArrow, false); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (steps + 1) * 2, count);
        gl.uniform1i(uniforms.uArrow, true); gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, count);
        counters.drawCalls += 2;
      }
      gpuTimer?.end();
      canvas.hidden = false; return true;
    } catch {
      ready = false; fallbackReason = 'draw-failed'; canvas.hidden = true; release(); onInvalidate(); return false;
    }
  }
  function contextLost(event) {
    event.preventDefault(); ready = false; fallbackReason = 'context-lost'; canvas.hidden = true;
    gpuTimer?.dispose({ contextLost: true }); gpuTimer = null;
    resources = null;
    if (!disposed) onInvalidate();
  }
  function contextRestored() {
    if (disposed) return;
    try { initialize(); }
    catch { ready = false; fallbackReason = 'restore-failed'; release(); }
    onInvalidate();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; ready = false; fallbackReason = 'disposed'; canvas.hidden = true;
    canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
    release(); geometry = new Float32Array(); meters = new Float32Array(); retireContext();
  }
  try { initialize(); }
  catch { release(); retireContext(); return null; }
  canvas.hidden = true;
  canvas.addEventListener('webglcontextlost', contextLost); canvas.addEventListener('webglcontextrestored', contextRestored);
  function getStats() {
    return { ...counters, capacity, dpr, maximumRoutes: MAX_ROUTES,
      ...(gpuTimer?.stats ?? { gpuTimingSupported: false, gpuTimeMs: null, gpuTimeSampledAt: null, gpuTimingSamples: 0 }) };
  }
  return { resize, draw, dispose, getStats, get available() { return ready && !disposed; },
    get fallbackReason() { return fallbackReason; },
    get stats() { return getStats(); } };
}
