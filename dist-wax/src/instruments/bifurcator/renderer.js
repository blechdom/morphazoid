const COLORS = { hopf: '#c6a0ff', logistic: '#ffe493', fold: '#ffac98', lorenz: '#72f5d1', rossler: '#7cbfff' };
export const modelColor = model => COLORS[model] ?? COLORS.lorenz;

function grid(ctx, w, h) {
  ctx.strokeStyle = '#14221f'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = w * .5 % 48; x < w; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = h * .5 % 48; y < h; y += 48) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}
function orbitProjection(point, model, w, h) {
  const size = Math.min(w / 65, Math.max(90, h - 200) / 58);
  if (model === 'lorenz') return [w * .5 + (point[0] + point[1] * .15) * size, h * .57 - (point[2] - 24) * size];
  if (model === 'rossler') return [w * .51 + (point[0] + point[2] * .12) * size * 1.35, h * .53 - (point[1] + point[2] * .23) * size * 1.35];
  return [w * .5 + point[0] * Math.min(w, h) * .26, h * .51 - point[1] * Math.min(w, h) * .26];
}
function line(ctx, history, project, color) {
  const segments = 10;
  for (let section = 0; section < segments; section++) {
    const start = Math.max(0, Math.floor(history.length * section / segments) - 1);
    const end = Math.floor(history.length * (section + 1) / segments);
    ctx.globalAlpha = .12 + .72 * (section + 1) / segments;
    ctx.strokeStyle = color; ctx.lineWidth = section === segments - 1 ? 1.8 : 1.05; ctx.beginPath();
    for (let i = start; i < end; i++) {
      const [x, y] = project(history[i]);
      if (i === start || history[i].break) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (history.length) {
    const [x, y] = project(history.at(-1));
    ctx.fillStyle = '#effff7'; ctx.shadowBlur = 12; ctx.shadowColor = color;
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  }
}
let branchImage = null, branchSize = '';
function branchDiagram(ctx, w, h, history, params) {
  const left = w * .1, right = w * .9, top = h * .22, bottom = h * .76;
  const width = right - left, height = bottom - top;
  const sizeKey = `${Math.round(width)}:${Math.round(height)}`;
  if (branchSize !== sizeKey) {
    branchSize = sizeKey;
    branchImage = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    const imageCtx = branchImage.getContext('2d');
    imageCtx.fillStyle = '#7b6b35';
  // This predictive map is computed from the same logistic equation as the DSP.
  for (let col = 0; col < 240; col++) {
    const r = 2.6 + 1.4 * col / 239; let x = .314159;
    for (let n = 0; n < 240; n++) x = r * x * (1 - x);
    for (let n = 0; n < 48; n++) { x = r * x * (1 - x); imageCtx.fillRect(col / 239 * width, height - x * height, 1.2, 1.2); }
  }
  }
  ctx.globalAlpha = .7; ctx.drawImage(branchImage, left, top);
  ctx.globalAlpha = 1; ctx.strokeStyle = '#ffe493'; ctx.lineWidth = 1;
  const active = left + params.regime * width;
  ctx.beginPath(); ctx.moveTo(active, top); ctx.lineTo(active, bottom); ctx.stroke();
  ctx.fillStyle = '#fff6b4';
  for (const item of history.slice(-60)) { ctx.beginPath(); ctx.arc(left + (item.n - 2.6) / 1.4 * width, bottom - item.p[0] * height, 2.3, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#aeb99c'; ctx.font = '11px monospace';
  for (const r of [2.6, 3, 3.5, 4]) ctx.fillText(r.toFixed(1), left + (r - 2.6) / 1.4 * width - 9, bottom + 22);
  ctx.fillText('r', right + 18, bottom + 22);
}
function foldDiagram(ctx, w, h, history) {
  const left = w * .15, right = w * .85, top = h * .24, bottom = h * .73;
  const project = item => [left + (item.n + .65) / 1.3 * (right - left), bottom - (item.p[0] + 1.6) / 3.2 * (bottom - top)];
  ctx.strokeStyle = '#55453f'; ctx.lineWidth = 1;
  for (let stable = 0; stable < 2; stable++) {
    ctx.setLineDash(stable ? [] : [4, 5]); ctx.beginPath(); let started = false;
    for (let i = 0; i <= 400; i++) {
      const x = -1.6 + i * 3.2 / 400, bias = x ** 3 - x;
      if (Math.abs(bias) > .65 || Number(Math.abs(x) > 1 / Math.sqrt(3)) !== stable) { started = false; continue; }
      const [px, py] = project({ n: bias, p: [x] });
      if (started) ctx.lineTo(px, py); else ctx.moveTo(px, py); started = true;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]); line(ctx, history, project, COLORS.fold);
  ctx.fillStyle = '#aeafa3'; ctx.font = '11px monospace'; ctx.fillText('− bias', left, bottom + 25); ctx.fillText('+ bias', right - 45, bottom + 25);
}

export function drawOrbit(ctx, width, height, history, params) {
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#080c12'; ctx.fillRect(0, 0, width, height); grid(ctx, width, height);
  if (params.model === 'logistic') branchDiagram(ctx, width, height, history, params);
  else if (params.model === 'fold') foldDiagram(ctx, width, height, history);
  else line(ctx, history, item => orbitProjection(item.p, params.model, width, height), modelColor(params.model));
}

const CYCLE_COLORS = ['#fff0ab', '#ffac98', '#79e8d2', '#9bcaff', '#c6a0ff', '#ffbbdf', '#9fe69c', '#ffd283'];
const CYCLE_LABELS = { collecting: 'Collecting cycles', irregular: 'No short repeat', quiet: 'Quiet', 'under-sampled': 'Pitch too high to trace' };

// All cycles share the engine's bounded output range. Scaling them separately
// would erase the alternating amplitudes that make a period-doubling visible.
export function drawCycles(ctx, width, height, cycles, params, pattern = null) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#080c12'; ctx.fillRect(0, 0, width, height);
  grid(ctx, width, height);
  const compact = width < 650 || height < 520;
  const left = compact ? 22 : 44, right = width - (compact ? 22 : 44);
  const top = compact ? 142 : 170, bottom = Math.max(top + 36, height - 112);
  const middle = (top + bottom) * .5, amplitude = (bottom - top) * .46 / .8;
  const plotWidth = Math.max(1, right - left);
  const repeat = [1, 2, 3, 4, 6, 8].includes(pattern) ? pattern : 0;
  const recent = (cycles ?? []).slice(-24);

  ctx.lineWidth = 1; ctx.strokeStyle = '#243c38';
  ctx.beginPath(); ctx.moveTo(left, middle); ctx.lineTo(right, middle); ctx.stroke();
  ctx.strokeStyle = '#192a2a'; ctx.setLineDash([2, 6]);
  ctx.beginPath();
  for (const fraction of [.25, .5, .75]) {
    const x = left + fraction * plotWidth;
    ctx.moveTo(x, top); ctx.lineTo(x, bottom);
  }
  ctx.stroke(); ctx.setLineDash([]);

  ctx.save(); ctx.beginPath(); ctx.rect(left - 2, top - 2, plotWidth + 4, bottom - top + 4); ctx.clip();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let i = 0; i < recent.length; i++) {
    const cycle = recent[i];
    if (!cycle?.length) continue;
    const age = (i + 1) / recent.length;
    const newest = i === recent.length - 1;
    const branch = repeat ? (recent.length - 1 - i) % repeat : i % CYCLE_COLORS.length;
    const color = repeat ? CYCLE_COLORS[branch] : modelColor(params.model);
    ctx.strokeStyle = color;
    ctx.globalAlpha = newest ? .98 : .1 + .43 * age;
    ctx.lineWidth = newest ? (compact ? 1.8 : 2.2) : (repeat ? 1.25 : .95);
    ctx.beginPath(); let connected = false;
    for (let bin = 0; bin < cycle.length; bin++) {
      const value = cycle[bin];
      if (!Number.isFinite(value)) { connected = false; continue; }
      const x = left + bin / Math.max(1, cycle.length - 1) * plotWidth;
      const y = middle - value * amplitude;
      if (connected) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      connected = true;
    }
    ctx.stroke();
  }
  ctx.restore(); ctx.globalAlpha = 1;

  ctx.font = '11px monospace'; ctx.fillStyle = '#88a39a';
  ctx.textBaseline = 'top';
  ctx.fillText('0', left, bottom + 12);
  ctx.textAlign = 'center'; ctx.fillText('½', left + plotWidth * .5, bottom + 12);
  ctx.textAlign = 'right'; ctx.fillText('1 cycle', right, bottom + 12);
  ctx.textBaseline = 'bottom';
  const label = repeat ? (repeat === 1 ? 'One repeating cycle' : `${repeat}-cycle repeat`) : CYCLE_LABELS[pattern] ?? (recent.length ? 'Recent cycles' : 'Collecting cycles');
  ctx.fillStyle = repeat ? CYCLE_COLORS[0] : '#a8c0b7'; ctx.fillText(label, right, compact ? 80 : top - 12);
  ctx.restore();
}

const SHAPE_HEAD_COLORS = ['#fff0ab', '#ffac98', '#9bcaff', '#c6a0ff', '#72f5d1', '#ff99cf', '#b8ed7c', '#ffd089', '#85d8ff', '#a6adff', '#f39597', '#b0ffe9', '#e7b6ff', '#f1dc7d', '#82cbb8', '#dca78d'];
export const shapeHeadColor = index => SHAPE_HEAD_COLORS[Math.trunc(Number(index)) & 15];
const unit = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const headIndex = (head, fallback) => Number.isInteger(head.index) && head.index >= 0 && head.index < 16 ? head.index : fallback;
function shapeBounds(width, height) {
  const compact = width < 650 || height < 520;
  const inset = compact ? 22 : 44;
  const bottom = Math.max(44, height - 90);
  const top = Math.min(compact ? 142 : 170, bottom - 36);
  return { left: inset, right: Math.max(inset + 1, width - inset), top, bottom };
}

// Projection is fixed for signed normalized coordinates; changing the path's
// extent never changes the displayed pitch height or moves the coordinate axes.
export function shapePointToCanvas(point, width, height) {
  const { left, right, top, bottom } = shapeBounds(width, height);
  return [(left + right) * .5 + point[0] * (right - left) * .44,
    (top + bottom) * .5 - point[1] * (bottom - top) * .42];
}

export function drawShapePlayheads(ctx, width, height, shape, params) {
  ctx.save(); ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#080c12'; ctx.fillRect(0, 0, width, height); grid(ctx, width, height);
  const bounds = shapeBounds(width, height);
  const points = (shape?.points ?? []).slice(-1024);
  const heads = (shape?.heads ?? []).slice(0, 16);
  const center = shapePointToCanvas([0, 0], width, height);
  ctx.lineWidth = 1; ctx.strokeStyle = '#203631';
  ctx.beginPath(); ctx.moveTo(bounds.left, center[1]); ctx.lineTo(bounds.right, center[1]); ctx.stroke();
  ctx.strokeStyle = '#1a2b29'; ctx.setLineDash([2, 6]);
  ctx.beginPath(); ctx.moveTo(center[0], bounds.top); ctx.lineTo(center[0], bounds.bottom); ctx.stroke();
  ctx.setLineDash([]);

  ctx.save(); ctx.beginPath(); ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); ctx.clip();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = modelColor(params.model);
  // Only consecutive retained samples are joined. In particular, no segment
  // connects the final point back to the first across the reader's wrap.
  const sections = 12;
  for (let section = 0; section < sections; section++) {
    const start = Math.max(0, Math.floor(points.length * section / sections) - 1);
    const end = Math.floor(points.length * (section + 1) / sections);
    ctx.globalAlpha = .2 + .58 * (section + 1) / sections;
    ctx.lineWidth = section === sections - 1 ? 1.65 : 1.15;
    ctx.beginPath(); let connected = false;
    for (let i = start; i < end; i++) {
      const point = points[i];
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) { connected = false; continue; }
      const [x, y] = shapePointToCanvas(point, width, height);
      if (connected) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      connected = true;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    if (!Number.isFinite(head.x) || !Number.isFinite(head.y)) continue;
    const [x, y] = shapePointToCanvas([head.x, head.y], width, height);
    const color = shapeHeadColor(headIndex(head, i));
    const level = params.sonification === 'rhythm' ? unit(head.pulse) : unit(head.gain);
    ctx.fillStyle = color; ctx.globalAlpha = .04 + level * .25;
    ctx.beginPath(); ctx.arc(x, y, 8 + level * (heads.length > 8 ? 11 : 17), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .55 + level * .45;
    ctx.beginPath(); ctx.arc(x, y, heads.length > 8 ? 4.5 : 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#080c12'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore(); ctx.globalAlpha = 1;

  ctx.font = '11px monospace'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'right';
  const mapping = { height: 'Height', horizontal: 'Horizontal position', depth: 'Depth', center: 'Distance from center', angle: 'Angle', bend: 'Bend', path: 'Path position', none: 'Fixed' };
  ctx.fillStyle = '#88a39a';
  if (height >= 520 && width >= 650) ctx.fillText(`${mapping[params.sonification === 'rhythm' ? params.tempoAxis : params.pitchAxis] ?? mapping.height} → ${params.sonification === 'rhythm' ? 'tempo' : 'pitch'}`, bounds.right, bounds.top - 12);
  const labels = [];
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    if (!Number.isFinite(head.x) || !Number.isFinite(head.y)) continue;
    const [x, y] = shapePointToCanvas([head.x, head.y], width, height);
    const label = String(headIndex(head, i) + 1), labelWidth = ctx.measureText(label).width + 6;
    let rect;
    for (const [dx, dy] of [[10, -24], [10, 6], [-labelWidth - 10, -24], [-labelWidth - 10, 6], [10, -39], [10, 20]]) {
      const trial = { x: Math.min(bounds.right - labelWidth, Math.max(bounds.left, x + dx)), y: Math.min(bounds.bottom - 14, Math.max(bounds.top, y + dy)), w: labelWidth, h: 14 };
      rect = trial;
      if (!labels.some(other => trial.x < other.x + other.w + 2 && trial.x + trial.w + 2 > other.x && trial.y < other.y + other.h + 2 && trial.y + trial.h + 2 > other.y)) break;
    }
    labels.push(rect);
    const labelCenterX = rect.x + rect.w * .5, labelCenterY = rect.y + rect.h * .5;
    if (Math.hypot(labelCenterX - x, labelCenterY - y) > 19) {
      ctx.strokeStyle = shapeHeadColor(headIndex(head, i)); ctx.lineWidth = .75; ctx.globalAlpha = .45; ctx.setLineDash([1, 3]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(labelCenterX, labelCenterY); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#080c12'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = shapeHeadColor(headIndex(head, i)); ctx.fillText(label, rect.x + 3, rect.y + 12);
  }
  ctx.restore();
}

const RHYTHM_RATIOS = { unison: [1], octaves: [.5, 1, 2, 4], 'two-three-four': [1, 1.5, 2], fibonacci: [1, 2, 3, 5] };
const TEMPO_AXIS_LABELS = { none: ['Fixed tempo', 'Fixed tempo'], height: ['Low height', 'High height'], horizontal: ['Left', 'Right'], depth: ['Near depth', 'Far depth'], center: ['Center', 'Outer edge'], angle: ['Start angle', 'Full turn'], bend: ['Straight', 'Sharp bend'], path: ['Path start', 'Path end'] };
const TEMPO_MIN = 8, TEMPO_MAX = 960;
const tempoClamp = value => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Number.isFinite(value) ? value : TEMPO_MIN));
export function tempoMapBounds(width, height, headCount = 16) {
  const compact = width < 650 || height < 520, columns = compact ? 4 : 2;
  const count = Math.min(16, Math.max(1, Math.round(headCount) || 1));
  const laneHeight = compact ? 10 : 18, phaseHeight = Math.ceil(count / columns) * laneHeight;
  const top = compact ? 142 : 170, bottom = Math.max(top + 64, height - 90);
  const phaseTop = bottom - phaseHeight, mapBottom = Math.max(top + 24, phaseTop - (compact ? 24 : 36));
  return { left: compact ? 44 : 62, right: Math.max(compact ? 45 : 63, width - (compact ? 22 : 44)), top, bottom, mapBottom, phaseTop, columns, laneHeight, compact };
}
export function tempoPointToCanvas(coordinate, bpm, width, height, headCount = 16) {
  const { left, right, top, mapBottom } = tempoMapBounds(width, height, headCount);
  const amount = Math.log(tempoClamp(bpm) / TEMPO_MIN) / Math.log(TEMPO_MAX / TEMPO_MIN);
  return [left + unit(coordinate) * (right - left), mapBottom - amount * (mapBottom - top)];
}

export function drawTempoMap(ctx, width, height, shape, params) {
  ctx.save(); ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#080c12'; ctx.fillRect(0, 0, width, height); grid(ctx, width, height);
  const heads = (shape?.heads ?? []).slice(0, 16);
  const count = heads.length || Math.min(16, Math.max(1, Math.round(params.headCount) || 1));
  const bounds = tempoMapBounds(width, height, count);
  const fallback = RHYTHM_RATIOS[params.rhythmRatios] ?? RHYTHM_RATIOS.unison;
  const ratios = [];
  for (let i = 0; i < count; i++) {
    const ratio = Number.isFinite(heads[i]?.ratio) && heads[i].ratio > 0 ? heads[i].ratio : fallback[i % fallback.length];
    if (!ratios.some(item => Math.abs(item.value - ratio) < 1e-8)) ratios.push({ value: ratio, color: shapeHeadColor(headIndex(heads[i] ?? {}, i)) });
  }
  ctx.font = `${bounds.compact ? 9 : 11}px monospace`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  for (const bpm of [8, 96, 960]) {
    const [, y] = tempoPointToCanvas(0, bpm, width, height, count);
    ctx.strokeStyle = '#22352f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bounds.left, y); ctx.lineTo(bounds.right, y); ctx.stroke();
    ctx.fillStyle = '#94b1a4';
    if (bpm !== 96 || bounds.mapBottom - bounds.top >= 42) ctx.fillText(String(bpm), bounds.left - 8, Math.min(bounds.mapBottom - 5, Math.max(bounds.top + 5, y)));
  }
  ctx.save(); ctx.beginPath(); ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.mapBottom - bounds.top); ctx.clip();
  ctx.lineJoin = 'round';
  for (const ratio of ratios) {
    ctx.strokeStyle = ratio.color; ctx.globalAlpha = .5; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let bin = 0; bin <= 64; bin++) {
      const coordinate = bin / 64;
      const bpm = params.tempo * ratio.value * 2 ** ((params.tempoAxis === 'none' ? 0 : coordinate - .5) * params.tempoSpan);
      const [x, y] = tempoPointToCanvas(coordinate, bpm, width, height, count);
      if (bin) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    if (!Number.isFinite(head.tempoCoordinate) || !Number.isFinite(head.tempo)) continue;
    const [x, y] = tempoPointToCanvas(head.tempoCoordinate, head.tempo, width, height, count);
    const pulse = unit(head.pulse);
    ctx.fillStyle = shapeHeadColor(headIndex(head, i)); ctx.globalAlpha = .08 + pulse * .25;
    ctx.beginPath(); ctx.arc(x, y, 5 + pulse * 7, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .85; ctx.beginPath(); ctx.arc(x, y, 2.8 + pulse * 1.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore(); ctx.globalAlpha = 1;

  const labels = TEMPO_AXIS_LABELS[params.tempoAxis] ?? TEMPO_AXIS_LABELS.height;
  ctx.textBaseline = 'top'; ctx.fillStyle = '#94b1a4'; ctx.textAlign = 'left'; ctx.fillText(labels[0], bounds.left, bounds.mapBottom + 5);
  ctx.textAlign = 'right'; if (params.tempoAxis !== 'none') ctx.fillText(labels[1], bounds.right, bounds.mapBottom + 5);
  ctx.textBaseline = 'bottom'; ctx.fillStyle = '#78958b'; ctx.fillText('Beat phase', bounds.right, bounds.phaseTop - 2);
  const gap = bounds.compact ? 10 : 24, cellWidth = (bounds.right - bounds.left - gap * (bounds.columns - 1)) / bounds.columns;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i], column = i % bounds.columns, row = Math.floor(i / bounds.columns);
    const x = bounds.left + column * (cellWidth + gap), y = bounds.phaseTop + (row + .5) * bounds.laneHeight;
    const color = shapeHeadColor(headIndex(head, i));
    ctx.fillStyle = color; ctx.fillText(String(headIndex(head, i) + 1), x, y);
    const lineStart = x + (bounds.compact ? 17 : 25), lineEnd = x + cellWidth;
    ctx.strokeStyle = '#284138'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lineStart, y); ctx.lineTo(lineEnd, y); ctx.stroke();
    if (!Number.isFinite(head.beatPhase)) continue;
    const phaseX = lineStart + unit(head.beatPhase) * (lineEnd - lineStart), pulse = unit(head.pulse);
    ctx.fillStyle = color; ctx.globalAlpha = .25 + pulse * .4; ctx.beginPath(); ctx.arc(phaseX, y, 3 + pulse * 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(phaseX, y, 1.7 + pulse * 1.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawSignal(ctx, width, height, values, color, audible) {
  ctx.clearRect(0, 0, width, height); ctx.strokeStyle = '#243830'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
  if (!audible || !values.length) return;
  ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath();
  values.forEach((value, i) => {
    const x = i / Math.max(1, values.length - 1) * width, y = height * (.5 - value * .47);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }); ctx.stroke();
}
