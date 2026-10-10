const MAX_SEGMENTS = 500000;
const FALLBACK_SEGMENTS = 30000;
const MAX_BACKING_SIZE = 4096;
const MAX_BACKING_PIXELS = 8000000;
const EMPTY = new Float32Array(0);
const BASE_COLOR = [1, .73, .46, .8];
const SELECTED_COLOR = [.42, .96, .86, 1];
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

function viewOf(view = {}) {
  return { x: finite(view.x, 0), y: finite(view.y, 0), width: Math.max(1e-10, finite(view.width, 3.5)), aspect: Math.max(.01, finite(view.aspect, 1)) };
}

/**
 * Batched contour vectors. Packed points are offsets from result.view's center,
 * in units of result.view.width on both axes; imaginary Y points upwards.
 * offsets index vertices, and closed paths do not repeat their first vertex.
 */
export class ContourRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.disposed = false;
    this.contextLost = false;
    this.result = null;
    this.vertices = EMPTY;
    this.ranges = [];
    this.sourceView = viewOf();
    this.currentView = viewOf();
    this.sourceSegments = 0;
    this.drawnSegments = 0;
    this.highlightSegments = 0;
    this.drawCalls = 0;
    this.uploads = 0;
    this.selectedPath = -1;
    this.scanHead = null;
    this.uploadDirty = false;
    this.error = '';
    try { this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: false, preserveDrawingBuffer: false }); } catch { this.gl = null; }
    this.ctx = this.gl ? null : canvas.getContext('2d');
    this.onLost = event => {
      event.preventDefault();
      this.contextLost = true;
      this.program = null;
      this.buffer = null;
    };
    this.onRestored = () => {
      if (this.disposed) return;
      this.contextLost = false;
      this.initGL();
    };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    if (this.gl) this.initGL();
  }

  initGL() {
    const gl = this.gl, shaders = [];
    try {
      const shader = (type, source) => {
        const item = gl.createShader(type);
        shaders.push(item);
        gl.shaderSource(item, source);
        gl.compileShader(item);
        if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item) || 'Contour shader compilation failed.');
        return item;
      };
      const vertex = shader(gl.VERTEX_SHADER, `
        attribute vec2 point;
        uniform vec2 scale;
        uniform vec2 translation;
        uniform float pointSize;
        void main() {
          gl_Position = vec4(point * scale + translation, 0., 1.);
          gl_PointSize = pointSize;
        }
      `);
      const fragment = shader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform vec4 color;
        uniform float marker;
        void main() {
          if (marker > .5 && distance(gl_PointCoord, vec2(.5)) > .5) discard;
          gl_FragColor = color;
        }
      `);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) || 'Contour shader linking failed.');
      this.buffer = gl.createBuffer();
      this.pointAttribute = gl.getAttribLocation(this.program, 'point');
      this.scaleUniform = gl.getUniformLocation(this.program, 'scale');
      this.translationUniform = gl.getUniformLocation(this.program, 'translation');
      this.colorUniform = gl.getUniformLocation(this.program, 'color');
      this.pointSizeUniform = gl.getUniformLocation(this.program, 'pointSize');
      this.markerUniform = gl.getUniformLocation(this.program, 'marker');
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.uploadDirty = true;
      this.error = '';
    } catch (error) {
      this.error = error.message;
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      this.buffer = null;
      this.program = null;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }

  fit() {
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width), cssHeight = Math.max(1, rect.height);
    const environment = this.canvas.ownerDocument?.defaultView || globalThis;
    const dpr = Math.min(2, environment.devicePixelRatio || 1, MAX_BACKING_SIZE / cssWidth, MAX_BACKING_SIZE / cssHeight, Math.sqrt(MAX_BACKING_PIXELS / (cssWidth * cssHeight)));
    const width = Math.max(1, Math.round(cssWidth * dpr)), height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    return { width, height, cssWidth, cssHeight, dpr, aspect: cssWidth / cssHeight };
  }

  setResult(result) {
    if (result === this.result) return;
    this.result = result;
    this.sourceView = viewOf(result?.view);
    this.sourceSegments = 0;
    this.ranges = [];
    this.selectedPath = -1;
    this.lengths = null;
    this.scanHead = null;
    const points = result?.points, offsets = result?.offsets, closed = result?.closed;
    if (!points || !offsets || !closed) {
      this.vertices = EMPTY;
      this.uploadDirty = true;
      return;
    }
    const vertexCount = Math.floor(points.length / 2), pathCount = Math.min(closed.length, offsets.length - 1);
    for (let path = 0; path < pathCount; path++) {
      const start = Math.min(vertexCount, offsets[path]), end = Math.min(vertexCount, offsets[path + 1]);
      this.sourceSegments += Math.max(0, end - start - 1) + (closed[path] && end - start > 1 ? 1 : 0);
    }
    const packed = new Float32Array(Math.min(MAX_SEGMENTS, this.sourceSegments) * 4);
    let segments = 0;
    for (let path = 0; path < pathCount && segments < MAX_SEGMENTS; path++) {
      const start = Math.min(vertexCount, offsets[path]), end = Math.min(vertexCount, offsets[path + 1]);
      const pathSegments = Math.max(0, end - start - 1) + (closed[path] && end - start > 1 ? 1 : 0);
      // Retain complete paths if a malformed or future worker exceeds the budget.
      if (segments + pathSegments > MAX_SEGMENTS) break;
      const range = { first: segments * 2, count: 0, closed: Boolean(closed[path]), minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      const add = (a, b) => {
        if (segments >= MAX_SEGMENTS) return;
        const ax = points[a * 2], ay = points[a * 2 + 1], bx = points[b * 2], by = points[b * 2 + 1];
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return;
        const offset = segments * 4;
        packed[offset] = ax; packed[offset + 1] = ay;
        packed[offset + 2] = bx; packed[offset + 3] = by;
        range.minX = Math.min(range.minX, ax, bx); range.maxX = Math.max(range.maxX, ax, bx);
        range.minY = Math.min(range.minY, ay, by); range.maxY = Math.max(range.maxY, ay, by);
        segments++;
        range.count += 2;
      };
      for (let vertex = start + 1; vertex < end && segments < MAX_SEGMENTS; vertex++) add(vertex - 1, vertex);
      if (range.closed && end - start > 1) add(end - 1, start);
      this.ranges[path] = range;
    }
    this.vertices = packed.subarray(0, segments * 4);
    this.uploadDirty = true;
  }

  select(path) {
    const next = Number.isInteger(path) && this.ranges[path]?.count > 0 ? path : -1;
    if (next === this.selectedPath) return;
    this.selectedPath = next;
    this.lengths = null;
    if (next < 0) return;
    const range = this.ranges[next], count = range.count / 2;
    this.lengths = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) {
      const offset = range.first * 2 + i * 4;
      this.lengths[i + 1] = this.lengths[i] + Math.hypot(this.vertices[offset + 2] - this.vertices[offset], this.vertices[offset + 3] - this.vertices[offset + 1]);
    }
    const first = range.first * 2, last = first + (count - 1) * 4 + 2;
    this.reverseOpen = !range.closed && (this.vertices[first] > this.vertices[last]
      || (this.vertices[first] === this.vertices[last] && this.vertices[first + 1] > this.vertices[last + 1]));
  }

  headAt(phase) {
    if (this.selectedPath < 0 || !this.lengths) return null;
    const range = this.ranges[this.selectedPath], count = range.count / 2;
    const wrapped = ((finite(phase, 0) % 1) + 1) % 1;
    let position = range.closed ? wrapped : (1 - Math.cos(2 * Math.PI * wrapped)) / 2;
    if (this.reverseOpen) position = 1 - position;
    const distance = this.lengths[count] * position;
    let low = 0, high = count - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.lengths[mid + 1] < distance) low = mid + 1;
      else high = mid;
    }
    const offset = range.first * 2 + low * 4;
    const length = this.lengths[low + 1] - this.lengths[low];
    const blend = length > 0 ? Math.max(0, Math.min(1, (distance - this.lengths[low]) / length)) : 0;
    return {
      x: this.vertices[offset] + (this.vertices[offset + 2] - this.vertices[offset]) * blend,
      y: this.vertices[offset + 1] + (this.vertices[offset + 3] - this.vertices[offset + 1]) * blend,
    };
  }

  draw(result, currentView, { selectedPath = -1, scanPhase = 0 } = {}) {
    if (this.disposed) return;
    this.setResult(result);
    this.currentView = viewOf(currentView || result?.view);
    this.select(selectedPath);
    this.drawCalls = 0;
    this.drawnSegments = 0;
    this.highlightSegments = 0;
    const head = this.headAt(scanPhase);
    this.scanHead = head ? { x: this.sourceView.x + head.x * this.sourceView.width, y: this.sourceView.y + head.y * this.sourceView.width } : null;
    if (this.contextLost) return;
    const size = this.fit(), view = this.currentView;
    const ratio = this.sourceView.width / view.width;
    // Subtract world centers in double precision before passing small local values to GL.
    const dx = (this.sourceView.x - view.x) / view.width, dy = (this.sourceView.y - view.y) / view.width;
    const transform = { scaleX: 2 * ratio, scaleY: 2 * size.aspect * ratio, x: 2 * dx, y: 2 * size.aspect * dy };
    if (this.gl && this.program) this.drawGL(size, transform, head);
    else if (this.ctx) this.draw2D(size, transform, head);
  }

  drawGL(size, transform, head) {
    const gl = this.gl;
    gl.viewport(0, 0, size.width, size.height);
    gl.clearColor(.025, .035, .047, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.uploadDirty) {
      gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW);
      this.uploads++;
      this.uploadDirty = false;
    }
    gl.enableVertexAttribArray(this.pointAttribute);
    gl.vertexAttribPointer(this.pointAttribute, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.scaleUniform, transform.scaleX, transform.scaleY);
    gl.uniform2f(this.translationUniform, transform.x, transform.y);
    gl.uniform1f(this.markerUniform, 0);
    gl.uniform1f(this.pointSizeUniform, 7 * size.dpr);
    gl.uniform4fv(this.colorUniform, BASE_COLOR);
    if (this.vertices.length) {
      gl.drawArrays(gl.LINES, 0, this.vertices.length / 2);
      this.drawCalls++;
      this.drawnSegments = this.vertices.length / 4;
    }
    if (this.selectedPath >= 0) {
      const range = this.ranges[this.selectedPath];
      gl.uniform4fv(this.colorUniform, SELECTED_COLOR);
      gl.drawArrays(gl.LINES, range.first, range.count);
      this.drawCalls++;
      this.highlightSegments = range.count / 2;
    }
    if (head) {
      gl.disableVertexAttribArray(this.pointAttribute);
      gl.vertexAttrib2f(this.pointAttribute, head.x, head.y);
      gl.uniform4f(this.colorUniform, 1, 1, 1, 1);
      gl.uniform1f(this.markerUniform, 1);
      gl.drawArrays(gl.POINTS, 0, 1);
      this.drawCalls++;
    }
  }

  draw2D(size, transform, head) {
    const ctx = this.ctx;
    ctx.fillStyle = '#06090c';
    ctx.fillRect(0, 0, size.width, size.height);
    const screen = (x, y) => [(1 + x * transform.scaleX + transform.x) * size.width / 2, (1 - y * transform.scaleY - transform.y) * size.height / 2];
    const drawSegments = (first, count, color, budget) => {
      if (!count) return 0;
      const stride = Math.max(1, Math.ceil(count / 2 / budget));
      ctx.strokeStyle = `rgba(${color.slice(0, 3).map(value => Math.round(value * 255)).join(',')},${color[3]})`;
      ctx.lineWidth = size.dpr;
      ctx.beginPath();
      let drawn = 0;
      for (let offset = first * 2; offset < (first + count) * 2; offset += stride * 4) {
        const a = screen(this.vertices[offset], this.vertices[offset + 1]);
        const b = screen(this.vertices[offset + 2], this.vertices[offset + 3]);
        ctx.moveTo(...a);
        ctx.lineTo(...b);
        drawn++;
      }
      ctx.stroke();
      this.drawCalls++;
      return drawn;
    };
    this.drawnSegments = drawSegments(0, this.vertices.length / 2, BASE_COLOR, this.selectedPath >= 0 ? FALLBACK_SEGMENTS * 2 / 3 : FALLBACK_SEGMENTS);
    if (this.selectedPath >= 0) {
      const range = this.ranges[this.selectedPath];
      this.highlightSegments = drawSegments(range.first, range.count, SELECTED_COLOR, FALLBACK_SEGMENTS / 3);
    }
    if (head) {
      const point = screen(head.x, head.y);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(point[0], point[1], 3.5 * size.dpr, 0, Math.PI * 2);
      ctx.fill();
      this.drawCalls++;
    }
  }

  /** Return the nearest path to a global complex point, or -1 outside the CSS pixel radius. */
  pick(point, currentView = this.currentView, radiusCssPixels = 10) {
    if (this.disposed || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return -1;
    const rect = this.canvas.getBoundingClientRect(), width = viewOf(currentView).width;
    const x = (point.x - this.sourceView.x) / this.sourceView.width, y = (point.y - this.sourceView.y) / this.sourceView.width;
    const radius = Math.max(0, finite(radiusCssPixels, 10)) * width / Math.max(1, rect.width) / this.sourceView.width;
    let nearest = -1, distanceSquared = radius * radius;
    for (let path = 0; path < this.ranges.length; path++) {
      const range = this.ranges[path];
      if (!range || x < range.minX - radius || x > range.maxX + radius || y < range.minY - radius || y > range.maxY + radius) continue;
      for (let offset = range.first * 2; offset < (range.first + range.count) * 2; offset += 4) {
        const ax = this.vertices[offset], ay = this.vertices[offset + 1];
        const dx = this.vertices[offset + 2] - ax, dy = this.vertices[offset + 3] - ay;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)) : 0;
        const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
        if (distance <= distanceSquared) { nearest = path; distanceSquared = distance; }
      }
    }
    return nearest;
  }

  diagnosticSnapshot() {
    return {
      backend: this.gl ? (this.program || this.contextLost ? 'webgl' : 'unavailable') : this.ctx ? 'canvas2d' : 'unavailable',
      contextLost: this.contextLost, disposed: this.disposed, error: this.error,
      pathCount: this.ranges.length, sourceSegments: this.sourceSegments,
      limited: this.sourceSegments > this.vertices.length / 4,
      bufferedSegments: this.vertices.length / 4, drawnSegments: this.drawnSegments,
      highlightSegments: this.highlightSegments, drawCalls: this.drawCalls, uploads: this.uploads,
      selectedPath: this.selectedPath, scanHead: this.scanHead && { ...this.scanHead },
      view: { ...this.currentView }, width: this.canvas.width, height: this.canvas.height,
    };
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    if (!this.contextLost) {
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.buffer = null;
    this.program = null;
    this.result = null;
    this.vertices = EMPTY;
    this.ranges = [];
    this.lengths = null;
    this.scanHead = null;
  }
}
