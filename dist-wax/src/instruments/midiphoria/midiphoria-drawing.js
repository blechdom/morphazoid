import { generateGridMidi, midiIconPixels } from './midiphoria-text-midi.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const DRAWING_COLUMNS = 48, DRAWING_ROWS = 32;
const empty = () => Array.from({ length: DRAWING_ROWS }, () => Array(DRAWING_COLUMNS).fill(0));

/** Bresenham coverage keeps a fast captured drag continuous on the note grid. */
export function drawingLine(from, to) {
  if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) throw new Error('Drawing points must be finite.');
  const cells = [];
  let x = clamp(Math.round(from.x), 0, DRAWING_COLUMNS - 1), y = clamp(Math.round(from.y), 0, DRAWING_ROWS - 1);
  const endX = clamp(Math.round(to.x), 0, DRAWING_COLUMNS - 1), endY = clamp(Math.round(to.y), 0, DRAWING_ROWS - 1);
  const dx = Math.abs(endX - x), dy = -Math.abs(endY - y), sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    cells.push({ x, y });
    if (x === endX && y === endY) return cells;
    const twice = error * 2;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}

export class MidiDrawing {
  constructor() { this.pixels = empty(); this.history = []; this.stroke = null; }
  get count() { return this.pixels.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0); }
  checkpoint() { this.history.push(this.pixels.map(row => [...row])); if (this.history.length > 32) this.history.shift(); }
  begin(point, erase = false) {
    if (this.stroke) this.end();
    this.checkpoint(); this.stroke = { last: point, value: erase ? 0 : 1 };
    this.move(point);
  }
  move(point) {
    if (!this.stroke) return;
    for (const { x, y } of drawingLine(this.stroke.last, point)) this.pixels[y][x] = this.stroke.value;
    this.stroke.last = point;
  }
  end() {
    if (!this.stroke) return;
    this.stroke = null;
    if (JSON.stringify(this.history.at(-1)) === JSON.stringify(this.pixels)) this.history.pop();
  }
  undo() { this.end(); const previous = this.history.pop(); if (previous) this.pixels = previous; }
  clear() { this.end(); if (this.count) { this.checkpoint(); this.pixels = empty(); } }
  stamp(kind) {
    this.end(); this.checkpoint(); this.pixels = empty();
    const icon = midiIconPixels(kind);
    if (icon) {
      const scale = 3, left = Math.floor((DRAWING_COLUMNS - icon[0].length * scale) / 2), top = 5;
      icon.forEach((row, y) => row.forEach((value, x) => {
        if (value) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) this.pixels[top + y * scale + dy][left + x * scale + dx] = 1;
      }));
    } else {
      let previous;
      for (let index = 0; index <= 160; index++) {
        const phase = index / 160, angle = phase * Math.PI * 6;
        const point = kind === 'spiral' ? { x: 23.5 + Math.cos(angle) * phase * 20, y: 15.5 + Math.sin(angle) * phase * 13 }
          : kind === 'zigzag' ? { x: 3 + phase * 41, y: 4 + (1 - Math.abs(phase * 6 % 2 - 1)) * 23 }
          : { x: 3 + phase * 41, y: 15.5 + Math.sin(phase * Math.PI * 6) * 11 };
        for (const { x, y } of drawingLine(previous ?? point, point)) this.pixels[y][x] = 1;
        previous = point;
      }
    }
  }
  score() { return generateGridMidi(this.pixels, { title: 'Drawn score', secondsPerRow: .125 }); }
}

/** No audio ownership: the app sends score().buffer through the shared stamp player. */
export function mountMidiDrawing({ canvas, status, undoButton, clearButton, eraseButton, onChange, onSeedRow }) {
  const model = new MidiDrawing(), context = canvas.getContext('2d');
  const events = new AbortController();
  const on = (node, type, handler) => node.addEventListener(type, handler, { signal: events.signal });
  eraseButton.setAttribute('aria-pressed', 'false');
  let pointer = null, erase = false, cursor = { x: 23, y: 31 }, focus = false;
  let seedRow = null, selectingSeed = false;
  let geometry = { cell: 1, left: 0, top: 0, width: 1, height: 1 };
  function render() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2), width = bounds.width, height = bounds.height;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#030706'; context.fillRect(0, 0, width, height);
    const cell = Math.min((width - 28) / DRAWING_COLUMNS, (height - 52) / DRAWING_ROWS);
    const left = (width - cell * DRAWING_COLUMNS) / 2, top = (height - cell * DRAWING_ROWS) / 2;
    geometry = { cell, left, top, width, height };
    context.strokeStyle = '#1b3027'; context.lineWidth = .5;
    context.beginPath();
    for (let x = 0; x <= DRAWING_COLUMNS; x++) { context.moveTo(left + x * cell, top); context.lineTo(left + x * cell, top + DRAWING_ROWS * cell); }
    for (let y = 0; y <= DRAWING_ROWS; y++) { context.moveTo(left, top + y * cell); context.lineTo(left + DRAWING_COLUMNS * cell, top + y * cell); }
    context.stroke();
    model.pixels.forEach((row, y) => row.forEach((value, x) => {
      if (!value) return;
      context.fillStyle = `hsl(${145 + x * 3} 75% 65%)`;
      context.fillRect(left + x * cell + .5, top + y * cell + .5, Math.max(1, cell - 1), Math.max(1, cell - 1));
    }));
    if (seedRow !== null) {
      context.fillStyle = '#f5ce6b22'; context.fillRect(left, top + seedRow * cell, DRAWING_COLUMNS * cell, cell);
      context.strokeStyle = '#f5ce6b'; context.lineWidth = 1.5;
      context.strokeRect(left, top + seedRow * cell, DRAWING_COLUMNS * cell, cell);
      canvas.dataset.seedRow = String(seedRow);
    }
    if (focus) {
      context.strokeStyle = '#fff'; context.lineWidth = 2;
      context.strokeRect(left + cursor.x * cell, top + cursor.y * cell, cell, cell);
    }
    context.fillStyle = '#a1b4ae'; context.font = '11px system-ui';
    context.textAlign = 'left'; context.fillText('Flow ↑', left, top - 10);
    context.textAlign = 'right'; context.fillText('Pitch →', left + DRAWING_COLUMNS * cell, top + DRAWING_ROWS * cell + 18);
  }
  function reflect() {
    undoButton.disabled = !model.history.length;
    clearButton.disabled = !model.count;
    status.value = `${model.count} pixels`;
    canvas.dataset.pixels = String(model.count);
    onChange?.(model); render();
  }
  function point(event) {
    const bounds = canvas.getBoundingClientRect(), { left, top, cell } = geometry;
    return { x: clamp(Math.floor((event.clientX - bounds.left - left) / cell), 0, DRAWING_COLUMNS - 1),
      y: clamp(Math.floor((event.clientY - bounds.top - top) / cell), 0, DRAWING_ROWS - 1) };
  }
  function end(event) {
    if (pointer === null || (event?.pointerId !== undefined && event.pointerId !== pointer)) return;
    const held = pointer; pointer = null; model.end();
    if (canvas.hasPointerCapture(held)) canvas.releasePointerCapture(held);
    reflect();
  }
  on(canvas, 'pointerdown', event => {
    if (event.button !== 0 || pointer !== null) return;
    event.preventDefault(); canvas.focus({ preventScroll: true });
    pointer = event.pointerId; canvas.setPointerCapture(pointer); cursor = point(event);
    if (selectingSeed) { seedRow = cursor.y; onSeedRow?.(seedRow); render(); return; }
    model.begin(cursor, erase); reflect();
  });
  on(canvas, 'pointermove', event => { if (event.pointerId === pointer) { cursor = point(event); if (selectingSeed) { seedRow = cursor.y; onSeedRow?.(seedRow); render(); } else { model.move(cursor); reflect(); } } });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(canvas, type, end);
  on(canvas, 'keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); model.undo(); reflect(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key]) {
      event.preventDefault(); event.stopPropagation(); const [dx, dy] = arrows[event.key];
      cursor = { x: clamp(cursor.x + dx, 0, DRAWING_COLUMNS - 1), y: clamp(cursor.y + dy, 0, DRAWING_ROWS - 1) }; render();
      if (selectingSeed) { seedRow = cursor.y; onSeedRow?.(seedRow); render(); }
    } else if ([' ', 'Enter', 'Backspace', 'Delete'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); if (event.repeat) return;
      if (selectingSeed) { seedRow = cursor.y; onSeedRow?.(seedRow); render(); }
      else { model.begin(cursor, erase || ['Backspace', 'Delete'].includes(event.key)); model.end(); reflect(); }
    }
  });
  on(canvas, 'focus', () => { focus = true; render(); });
  on(canvas, 'blur', () => { end(); focus = false; render(); });
  on(eraseButton, 'click', () => { erase = !erase; eraseButton.setAttribute('aria-pressed', String(erase)); });
  on(undoButton, 'click', () => { model.undo(); reflect(); });
  on(clearButton, 'click', () => { model.clear(); reflect(); });
  const resize = new ResizeObserver(render); resize.observe(canvas);
  reflect();
  return { model, render, stamp(kind) { model.stamp(kind); reflect(); },
    setSeedSelection(row, enabled = selectingSeed) { end(); seedRow = row == null ? null : clamp(Math.round(row), 0, DRAWING_ROWS - 1); selectingSeed = Boolean(enabled); if (seedRow !== null) cursor.y = seedRow; render(); },
    loadPixels(pixels) { model.end(); model.checkpoint(); model.pixels = Array.from({ length: DRAWING_ROWS }, (_, y) => Array.from({ length: DRAWING_COLUMNS }, (_, x) => Number(Boolean(pixels?.[y]?.[x])))); reflect(); },
    destroy() { end(); resize.disconnect(); events.abort(); } };
}
