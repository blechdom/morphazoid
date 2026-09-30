import { TINE_COUNT, tineFrequency } from './dsp.js';

const sideInset = width => Math.min(20, Math.max(14, width * 0.025));
function tineFrame(width, height) {
  const left = sideInset(width);
  return { left, span: width - 2 * left, base: height - 44 };
}

export function tineGeometry(width, height, index, baseFrequency, pitchSpread = 2) {
  const { left, span, base } = tineFrame(width, height);
  const x = left + (index + 0.5) / TINE_COUNT * span;
  const available = Math.max(55, base - 16);
  const length = available * Math.sqrt(45 / baseFrequency) / Math.sqrt(tineFrequency(index, baseFrequency, pitchSpread) / baseFrequency);
  return { x, base, length, width: span / TINE_COUNT * 0.55 };
}

export function materialPointer(width, height, px, py, baseFrequency, pitchSpread = 2) {
  const { left, span } = tineFrame(width, height);
  const tine = Math.max(0, Math.min(TINE_COUNT - 1, Math.floor((px - left) / span * TINE_COUNT)));
  const g = tineGeometry(width, height, tine, baseFrequency, pitchSpread);
  return { x: (tine + 0.5) / TINE_COUNT, y: Math.max(0.08, Math.min(0.98, (g.base - py) / g.length)) };
}

// One bounded surface for the original bank. Its slow deformation is an
// energy display, not a simulation of a measured plate or audio-rate motion.
const BANK_COLUMNS = 64, BANK_ROWS = 24;
const BANK_POINTS = (BANK_COLUMNS + 1) * (BANK_ROWS + 1);
const surfaceX = new Float32Array(BANK_POINTS), surfaceY = new Float32Array(BANK_POINTS);
const surfaceZ = new Float32Array(BANK_POINTS);
const surfaceBasis = new Float32Array(BANK_POINTS * TINE_COUNT);
const bandMotion = new Float32Array(TINE_COUNT);
const bankSurface = { width: 0, height: 0, x: surfaceX, y: surfaceY };
const steelPalette = Array.from({ length: 96 }, (_, i) => `rgb(${49 + i},${60 + i},${70 + i})`);
for (let row = 0; row <= BANK_ROWS; row++) {
  const y = 1 - row / BANK_ROWS;
  for (let column = 0; column <= BANK_COLUMNS; column++) {
    const x = column / BANK_COLUMNS, point = row * (BANK_COLUMNS + 1) + column;
    for (let band = 0; band < TINE_COUNT; band++) {
      surfaceBasis[point * TINE_COUNT + band] = Math.sin(Math.PI * (1 + band % 8) * x)
        * Math.sin(Math.PI * (1 + Math.floor(band / 8)) * y);
    }
  }
}

export function bankGeometry(width, height) {
  const inset = sideInset(width);
  return { left: inset, right: width - inset, top: 44, bottom: height - 34 };
}

export function bankSurfacePoint(width, height, x, y, surface = null) {
  if (surface?.width === width && surface?.height === height) {
    const column = Math.min(BANK_COLUMNS - 1, Math.floor(x * BANK_COLUMNS));
    const row = Math.min(BANK_ROWS - 1, Math.floor((1 - y) * BANK_ROWS));
    const u = x * BANK_COLUMNS - column, v = (1 - y) * BANK_ROWS - row;
    const a = row * (BANK_COLUMNS + 1) + column, b = a + 1, d = a + BANK_COLUMNS + 1, c = d + 1;
    const indices = u + v <= 1 ? [a, b, d] : [b, c, d];
    const weights = u + v <= 1 ? [1 - u - v, u, v] : [1 - v, u + v - 1, 1 - u];
    return { x: indices.reduce((sum, index, i) => sum + surface.x[index] * weights[i], 0),
      y: indices.reduce((sum, index, i) => sum + surface.y[index] * weights[i], 0) };
  }
  const g = bankGeometry(width, height);
  return { x: g.left + (g.right - g.left) * (0.78 * x + 0.22 * y),
    y: g.bottom - (g.bottom - g.top) * (0.22 * x + 0.78 * y) };
}

export function bankPointer(width, height, px, py, surface = null) {
  if (surface?.width === width && surface?.height === height) {
    const stride = BANK_COLUMNS + 1;
    const triangle = (a, b, c) => {
      const ax = surface.x[a], ay = surface.y[a], bx = surface.x[b], by = surface.y[b], cx = surface.x[c], cy = surface.y[c];
      const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(determinant) < 1e-8) return null;
      const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / determinant;
      const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / determinant;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) return null;
      return { x: Math.max(0, Math.min(1, ((a % stride) * u + (b % stride) * v + (c % stride) * w) / BANK_COLUMNS)),
        y: Math.max(0, Math.min(1, 1 - (Math.floor(a / stride) * u + Math.floor(b / stride) * v + Math.floor(c / stride) * w) / BANK_ROWS)) };
    };
    // Reverse painting order also selects the visible face if bending overlaps.
    for (let row = BANK_ROWS - 1; row >= 0; row--) for (let column = BANK_COLUMNS - 1; column >= 0; column--) {
      const a = row * stride + column, b = a + 1, d = a + stride, c = d + 1;
      const contact = triangle(b, c, d) || triangle(a, b, d);
      if (contact) return contact;
    }
  }
  const g = bankGeometry(width, height);
  const horizontal = (px - g.left) / (g.right - g.left);
  const vertical = (g.bottom - py) / (g.bottom - g.top);
  return { x: Math.max(0, Math.min(1, (0.78 * horizontal - 0.22 * vertical) / 0.56)),
    y: Math.max(0, Math.min(1, (0.78 * vertical - 0.22 * horizontal) / 0.56)) };
}

export function prepareBankSurface(w, h, state, time = 0) {
  const g = bankGeometry(w, h), span = g.right - g.left, depth = g.bottom - g.top;
  const bendScale = Math.min(34, depth * 0.13) / Math.sqrt(TINE_COUNT);
  const ribCount = 8 + Math.log2(state.settings.modes / 32);
  const ribHeight = Math.min(9, depth * 0.045);
  const stride = BANK_COLUMNS + 1;
  for (let band = 0; band < TINE_COUNT; band++) {
    const energy = state.audioOn ? Math.max(0, state.energies[band] || 0) : 0;
    bandMotion[band] = Math.sqrt(Math.min(1, energy * 16))
      * Math.sin(time * (3.5 + band * 0.23) + band * 2.399963);
  }
  for (let row = 0; row <= BANK_ROWS; row++) {
    const y = 1 - row / BANK_ROWS;
    for (let column = 0; column <= BANK_COLUMNS; column++) {
      const x = column / BANK_COLUMNS, index = row * stride + column;
      let bending = 0;
      for (let band = 0; band < TINE_COUNT; band++) bending += surfaceBasis[index * TINE_COUNT + band] * bandMotion[band];
      const relief = ribHeight * Math.cos(x * Math.PI * 2 * ribCount);
      const z = relief + Math.max(-34, Math.min(34, bending * bendScale));
      surfaceX[index] = g.left + span * (0.78 * x + 0.22 * y);
      surfaceY[index] = g.bottom - depth * (0.22 * x + 0.78 * y) - z;
      surfaceZ[index] = z;
    }
  }
  // Keep the projected sheet unfolded, including on short phone canvases.
  // Uniform relief scaling preserves the shape while every visible contact
  // remains reachable instead of being hidden behind another corrugation.
  let steepest = 0;
  for (let row = 0; row < BANK_ROWS; row++) for (let column = 0; column < BANK_COLUMNS; column++) {
    const a = row * stride + column, b = a + 1, d = a + stride, c = d + 1;
    steepest = Math.max(steepest,
      0.22 * (surfaceZ[b] - surfaceZ[a]) * BANK_COLUMNS + 0.78 * (surfaceZ[d] - surfaceZ[a]) * BANK_ROWS,
      0.22 * (surfaceZ[c] - surfaceZ[d]) * BANK_COLUMNS + 0.78 * (surfaceZ[c] - surfaceZ[b]) * BANK_ROWS);
  }
  const reliefScale = Math.min(1, depth * 0.5 / Math.max(1, steepest));
  if (reliefScale < 1) for (let point = 0; point < BANK_POINTS; point++) {
    surfaceY[point] += surfaceZ[point] * (1 - reliefScale);
    surfaceZ[point] *= reliefScale;
  }
  bankSurface.width = w; bankSurface.height = h;
  return bankSurface;
}

function drawBank(ctx, w, h, state, time) {
  const surface = prepareBankSurface(w, h, state, time);
  const g = bankGeometry(w, h), span = g.right - g.left, depth = g.bottom - g.top;
  const stride = BANK_COLUMNS + 1;
  const path = (indices, shift = 0) => {
    ctx.beginPath();
    indices.forEach((index, i) => { if (i) ctx.lineTo(surfaceX[index], surfaceY[index] + shift); else ctx.moveTo(surfaceX[index], surfaceY[index] + shift); });
    ctx.closePath();
  };
  const corners = [0, BANK_COLUMNS, BANK_POINTS - 1, BANK_ROWS * stride];
  // A narrow edge and cast shadow give the material depth even while silent.
  path(corners, 18); ctx.fillStyle = '#090d13'; ctx.fill();
  const front = BANK_ROWS * stride;
  ctx.beginPath();
  for (let column = 0; column <= BANK_COLUMNS; column++) {
    const index = front + column;
    if (column) ctx.lineTo(surfaceX[index], surfaceY[index]); else ctx.moveTo(surfaceX[index], surfaceY[index]);
  }
  for (let column = BANK_COLUMNS; column >= 0; column--) { const index = front + column; ctx.lineTo(surfaceX[index], surfaceY[index] + 7); }
  ctx.closePath(); ctx.fillStyle = '#44515e'; ctx.fill();
  for (let row = 0; row < BANK_ROWS; row++) {
    for (let column = 0; column < BANK_COLUMNS; column++) {
      const a = row * stride + column, b = a + 1, c = b + stride, d = a + stride;
      const slope = (surfaceZ[b] - surfaceZ[a]) / Math.max(1, span / BANK_COLUMNS);
      const lengthSlope = (surfaceZ[d] - surfaceZ[a]) / Math.max(1, depth / BANK_ROWS);
      const light = Math.max(0, Math.min(95, Math.round(49 + 35 * slope - 25 * lengthSlope)));
      ctx.beginPath(); ctx.moveTo(surfaceX[a], surfaceY[a]); ctx.lineTo(surfaceX[b], surfaceY[b]);
      ctx.lineTo(surfaceX[c], surfaceY[c]); ctx.lineTo(surfaceX[d], surfaceY[d]); ctx.closePath();
      ctx.fillStyle = steelPalette[light]; ctx.fill();
      // The fine seams follow the same surface; no independent overlay graph.
      ctx.strokeStyle = steelPalette[light]; ctx.lineWidth = 0.6; ctx.stroke();
    }
  }
  // Sparse lengthwise seams make the bending legible at phone sizes.
  ctx.strokeStyle = '#d6e0e82e'; ctx.lineWidth = 0.7;
  for (let row = 0; row <= BANK_ROWS; row += 4) {
    ctx.beginPath();
    for (let column = 0; column <= BANK_COLUMNS; column++) {
      const index = row * stride + column;
      if (column) ctx.lineTo(surfaceX[index], surfaceY[index]); else ctx.moveTo(surfaceX[index], surfaceY[index]);
    }
    ctx.stroke();
  }
  const contact = (x, y, color, recent) => {
    const { x: px, y: py } = bankSurfacePoint(w, h, x, y, surface);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px - 7, py); ctx.lineTo(px + 7, py); ctx.moveTo(px, py - 6); ctx.lineTo(px, py + 6); ctx.stroke();
    if (recent) { ctx.beginPath(); ctx.moveTo(px, py - 13); ctx.lineTo(px + 4, py - 29); ctx.stroke(); }
  };
  contact(state.x, state.y, '#ffbd80', state.audioOn && time - (state.manualContactTime ?? -10) < 0.18);
  if (state.audioOn && Number.isFinite(state.lastX) && time - (state.lastContactTime ?? -10) < 0.3) {
    contact(state.lastX, state.lastY, '#f2f9ff', true);
  }
  ctx.font = '10px system-ui'; ctx.fillStyle = '#aebdca';
  ctx.textAlign = 'right'; ctx.fillText('BRIGHTER ↗', g.right, g.top - 15);
  return surface;
}

export function drawGarden(canvas, state, time = 0) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(1800000 / Math.max(1, rect.width * rect.height)));
  const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const w = rect.width, h = rect.height;
  ctx.fillStyle = '#131820'; ctx.fillRect(0, 0, w, h);
  if (state.settings.model === 'bank') return drawBank(ctx, w, h, state, time);
  const selected = Math.min(TINE_COUNT - 1, Math.floor(state.x * TINE_COUNT));
  const { left, span, base } = tineFrame(w, h);
  ctx.fillStyle = '#303944'; ctx.fillRect(left, base, span, 16);
  ctx.fillStyle = '#65727f'; ctx.fillRect(left, base, span, 2);
  for (let i = 0; i < TINE_COUNT; i++) {
    const g = tineGeometry(w, h, i, state.settings.baseFrequency, state.settings.pitchSpread);
    const energy = state.audioOn ? Math.min(1, (state.energies[i] || 0) * 3) : 0;
    const top = g.base - g.length;
    // This is an energy envelope, not a slowed simulation of audio vibration.
    if (energy > 0.005) {
      ctx.fillStyle = `rgba(185,212,237,${energy * 0.3})`;
      ctx.fillRect(g.x - g.width / 2 - energy * 7, top, g.width + energy * 14, g.length);
    }
    const metal = ctx.createLinearGradient(g.x - g.width / 2, 0, g.x + g.width / 2, 0);
    metal.addColorStop(0, '#596776'); metal.addColorStop(0.45, '#c7d0d8'); metal.addColorStop(1, '#687583');
    ctx.fillStyle = metal; ctx.fillRect(g.x - g.width / 2, top, g.width, g.length);
    if (i === selected) {
      ctx.strokeStyle = '#edaf72'; ctx.lineWidth = 1.5; ctx.strokeRect(g.x - g.width / 2 - 2, top - 2, g.width + 4, g.length + 3);
      const contact = base - g.length * state.y;
      ctx.fillStyle = '#edaf72'; ctx.fillRect(g.x - g.width / 2 - 5, contact - 2, g.width + 10, 4);
    }
    if (state.repeating && i === state.lastTine && energy > 0.01) {
      ctx.fillStyle = '#eef5ff'; ctx.fillRect(g.x - g.width / 2, top - 4, g.width, 3);
    }
  }
  ctx.font = '11px system-ui'; ctx.fillStyle = '#9baab7';
  ctx.textAlign = 'left'; ctx.fillText(state.settings.pitchSpread === 0 ? 'UNISON' : 'LONG / LOW', left, base + 36);
  ctx.textAlign = 'right'; ctx.fillText(state.settings.pitchSpread === 0 ? 'EQUAL LENGTH' : 'SHORT / HIGH', w - left, base + 36);
  if (w > 600) { ctx.textAlign = 'center'; ctx.fillText('FIXED CLAMP', w / 2, base + 36); }
}
