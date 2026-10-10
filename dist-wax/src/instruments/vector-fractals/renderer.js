import { TABLE_SIZE, HARMONICS, TAU, mipSelection, componentPoint, juliaParameter } from './model.js';

const COLORS = { julia: [0.38, .92, .81, 1], mandelbrot: [1, .73, .46, 1], voyager: [.78, .61, 1, 1], explorer: [.5, .85, 1, 1] };
export class VectorRenderer {
  constructor(canvas, waves, map) {
    this.canvas = canvas; this.waves = waves; this.map = map;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: false });
    this.ctx = this.gl ? null : canvas.getContext('2d');
    this.path = new Float32Array((TABLE_SIZE + 1) * 2);
    this.reference = new Float32Array(this.path.length);
    this.x = new Float32Array(TABLE_SIZE); this.y = new Float32Array(TABLE_SIZE);
    this.lost = false;
    this.onLost = event => { event.preventDefault(); this.lost = true; };
    this.onRestored = () => { this.initGL(); this.lost = false; };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    if (this.gl) this.initGL();
  }
  initGL() {
    const gl = this.gl;
    const shader = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, 'attribute vec2 p; uniform vec2 scale; uniform float size; void main(){gl_Position=vec4(p*scale+vec2(0.,-.05),0.,1.);gl_PointSize=size;}');
    const fs = shader(gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 color; void main(){gl_FragColor=color;}');
    this.program = gl.createProgram(); gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.buffer = gl.createBuffer(); this.position = gl.getAttribLocation(this.program, 'p');
    this.scale = gl.getUniformLocation(this.program, 'scale'); this.color = gl.getUniformLocation(this.program, 'color'); this.size = gl.getUniformLocation(this.program, 'size');
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  fit(canvas) {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(1.75, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h };
  }
  line(points, color, pointsOnly = false) {
    const gl = this.gl;
    if (gl) {
      gl.bufferData(gl.ARRAY_BUFFER, points instanceof Float32Array ? points : new Float32Array(points), gl.DYNAMIC_DRAW);
      gl.uniform4fv(this.color, color); gl.uniform1f(this.size, 7 * Math.min(1.75, devicePixelRatio || 1));
      gl.drawArrays(pointsOnly ? gl.POINTS : gl.LINE_STRIP, 0, points.length / 2);
    } else if (this.ctx) {
      const ctx = this.ctx, { width: w, height: h } = this.canvas, s = Math.min(w, h) * .34;
      ctx.strokeStyle = ctx.fillStyle = `rgba(${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')},${color[3]})`;
      ctx.lineWidth = 1.4; ctx.beginPath();
      for (let i = 0; i < points.length; i += 2) {
        const x = w / 2 + points[i] * s, y = h * .525 - points[i + 1] * s;
        if (pointsOnly) ctx.fillRect(x - 3, y - 3, 6, 6);
        else if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (!pointsOnly) ctx.stroke();
    }
  }
  draw(bank, state, clock) {
    if (!bank || this.lost) return;
    const { w, h } = this.fit(this.canvas), gl = this.gl;
    if (gl) {
      gl.viewport(0, 0, w, h); gl.clearColor(.025, .035, .047, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.position); gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(this.scale, Math.min(w, h) / w * .68, Math.min(w, h) / h * .68);
    } else { this.ctx.fillStyle = '#06090c'; this.ctx.fillRect(0, 0, w, h); }
    for (let i = -1.5; i <= 1.5; i += .25) {
      this.line([i, -1.5, i, 1.5], [.35, .49, .55, i === 0 ? .18 : .055]);
      this.line([-1.5, i, 1.5, i], [.35, .49, .55, i === 0 ? .18 : .055]);
    }
    const t = clock.voyage * bank.frames.length, f = Math.floor(t) % bank.frames.length, blend = t % 1;
    const a = bank.frames[f], b = bank.frames[(f + 1) % bank.frames.length];
    const mip = mipSelection(clock.frequency, clock.sampleRate), coarse = Math.min(mip.index + 1, HARMONICS.length - 1);
    const cos = Math.cos(clock.rotation), sin = Math.sin(clock.rotation);
    for (let i = 0; i <= TABLE_SIZE; i++) {
      const j = i % TABLE_SIZE;
      let x = 0, y = 0;
      for (let channel = 0; channel < 2; channel++) {
        const key = channel ? 'y' : 'x';
        const av = a.tables[coarse][key][j] + (a.tables[mip.index][key][j] - a.tables[coarse][key][j]) * mip.mix;
        const bv = b.tables[coarse][key][j] + (b.tables[mip.index][key][j] - b.tables[coarse][key][j]) * mip.mix;
        if (channel) y = av + (bv - av) * blend; else x = av + (bv - av) * blend;
      }
      const rx = x * cos - y * sin, ry = state.readout === 'mono' ? rx : x * sin + y * cos;
      this.path[2 * i] = rx; this.path[2 * i + 1] = ry;
      this.x[j] = rx; this.y[j] = ry;
      const sx = a.sourceX[j] + (b.sourceX[j] - a.sourceX[j]) * blend;
      const sy = a.sourceY[j] + (b.sourceY[j] - a.sourceY[j]) * blend;
      this.reference[2 * i] = sx * cos - sy * sin; this.reference[2 * i + 1] = sx * sin + sy * cos;
    }
    if (state.reference) this.line(this.reference, [.78, .86, .90, .32]);
    const color = COLORS[state.mode]; this.line(this.path, color);
    const phase = clock.scanPhase * TAU;
    if (state.vectors) {
      const coefficients = [];
      for (let i = 1; i < TABLE_SIZE; i++) {
        const k = i < TABLE_SIZE / 2 ? i : i - TABLE_SIZE;
        const weight = Math.abs(k) <= HARMONICS[coarse] ? 1 : Math.abs(k) <= HARMONICS[mip.index] ? mip.mix : 0;
        const r = (a.spectrumRe[i] + (b.spectrumRe[i] - a.spectrumRe[i]) * blend) * weight;
        const m = (a.spectrumIm[i] + (b.spectrumIm[i] - a.spectrumIm[i]) * blend) * weight;
        if (Math.hypot(r, m) > .00002) coefficients.push({ k, r, m, radius: Math.hypot(r, m) });
      }
      coefficients.sort((a, b) => b.radius - a.radius);
      let x = 0, y = 0; const chain = [0, 0];
      const project = (x, y) => { const rx = x * cos - y * sin; return [rx, state.readout === 'mono' ? rx : x * sin + y * cos]; };
      coefficients.forEach((v, index) => {
        if (index < 5) {
          const circle = [];
          for (let j = 0; j <= 64; j++) circle.push(...project(x + v.radius * Math.cos(j / 64 * TAU), y + v.radius * Math.sin(j / 64 * TAU)));
          this.line(circle, [.72, .79, .84, .12]);
        }
        x += v.r * Math.cos(v.k * phase) - v.m * Math.sin(v.k * phase);
        y += v.r * Math.sin(v.k * phase) + v.m * Math.cos(v.k * phase);
        chain.push(...project(x, y));
      });
      this.line(chain, [.93, .78, .98, .7]);
    }
    const head = Math.floor(clock.scanPhase * TABLE_SIZE) % TABLE_SIZE;
    this.line([this.x[head], this.y[head]], [1, 1, 1, 1], true);
    this.drawWaves(head, color); this.drawMap(state.mode === 'explorer' ? state : bank.state, clock.voyage, color);
  }
  drawWaves(head, color) {
    const { w, h } = this.fit(this.waves), ctx = this.waves.getContext('2d');
    ctx.clearRect(0, 0, w, h); ctx.lineWidth = 1.5;
    for (let ch = 0; ch < 2; ch++) {
      const y0 = h * (ch ? .72 : .28), data = ch ? this.y : this.x;
      ctx.strokeStyle = '#24323a'; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke();
      ctx.strokeStyle = ch ? '#bba5f8' : `rgb(${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
      ctx.beginPath();
      for (let i = 0; i < TABLE_SIZE; i++) { const x = i / (TABLE_SIZE - 1) * w, y = y0 - data[i] * h * .15; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = '#f3f7f5'; ctx.beginPath(); ctx.moveTo(head / TABLE_SIZE * w, 0); ctx.lineTo(head / TABLE_SIZE * w, h); ctx.stroke();
  }
  drawMap(state, voyage, color) {
    const { w, h } = this.fit(this.map), ctx = this.map.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const project = ([x, y]) => [w * .65 + x * Math.min(w / 2.6, h / 1.65), h / 2 - y * Math.min(w / 2.6, h / 1.65)];
    for (const component of [1, 2]) {
      ctx.strokeStyle = '#3d515c'; ctx.beginPath();
      for (let i = 0; i <= 160; i++) { const [x, y] = project(componentPoint(1, i / 160, component)); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
    if (state.mode === 'voyager' || state.shape === 'cardioid') {
      ctx.strokeStyle = `rgba(${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')},.7)`; ctx.beginPath();
      for (let i = 0; i <= 160; i++) { const [x, y] = project(componentPoint(state.depth, i / 160, state.mode === 'voyager' ? state.component : 1)); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
    }
    if (state.mode === 'explorer') {
      const [x, y] = project([state.viewX, state.viewY]);
      const s = Math.min(w / 2.6, h / 1.65), size = Math.max(4, state.viewWidth * s);
      ctx.strokeStyle = '#80d9ff'; ctx.lineWidth = 1.5;
      ctx.strokeRect(x - size / 2, y - size / 3, size, size * 2 / 3);
    } else if (state.mode !== 'mandelbrot') {
      const [x, y] = project(juliaParameter(state, voyage)); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
    }
  }
  destroy() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost); this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.gl?.deleteBuffer(this.buffer); this.gl?.deleteProgram(this.program);
  }
}
