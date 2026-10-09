import { canvasSizing } from '../../graphics/canvas-sizing.js';
import { DEFAULT_RENDER_OPTIONS, normalizeMidiphoriaRenderOptions } from './midiphoria-presets.js';

const TAU = Math.PI * 2;
const MAX_TRAILS = 384;
const MAX_HELD = 256;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const wrap = value => ((value % 1) + 1) % 1;
const keyFor = note => JSON.stringify([note.sourceId, note.channel, note.note]);
const cssRgb = rgb => `rgb(${rgb.map(value => Math.round(clamp(value) * 255)).join(' ')})`;

// Rigid transforms about the canvas center, in Canvas [a, b, c, d] order.
// Diagonals are 45-degree axes in pixels, never a stretched screen diagonal.
const REFLECTION_TRANSFORMS = Object.freeze({
  none: [[1, 0, 0, 1]],
  vertical: [[1, 0, 0, 1], [-1, 0, 0, 1]],
  horizontal: [[1, 0, 0, 1], [1, 0, 0, -1]],
  both: [[1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1]],
  diagonal: [[1, 0, 0, 1], [0, 1, 1, 0]],
  'anti-diagonal': [[1, 0, 0, 1], [0, -1, -1, 0]],
  diagonals: [[1, 0, 0, 1], [0, 1, 1, 0], [0, -1, -1, 0], [-1, 0, 0, -1]],
  all: [[1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1],
    [0, 1, 1, 0], [0, -1, -1, 0], [0, 1, -1, 0], [0, -1, 1, 0]],
});

/** Whole-layer symmetry avoids redrawing note paths for each reflection. */
export function midiphoriaReflectionTransforms(options = DEFAULT_RENDER_OPTIONS) {
  const transforms = REFLECTION_TRANSFORMS[options.reflection] ?? REFLECTION_TRANSFORMS.none;
  const circular = options.view === 'radial' || options.view === 'orbit';
  const copies = clamp(Math.round(options.symmetry || 1), 1, 8);
  const result = [];
  const seen = new Set();
  for (const transform of transforms) {
    const [a, b, c, d] = transform;
    let key = transform.join(',');
    if (circular) {
      // Rotations already present in the base picture are the same image.
      const angle = wrap(Math.atan2(b, a) / TAU * copies);
      key = `${Math.round(angle * 1e8) % 1e8}:${a * d - b * c}`;
    } else if (options.view === 'mirror') {
      // Mirror trails already contain all four horizontal/vertical copies.
      key = a === 0 ? 'diagonal' : 'straight';
    }
    if (!seen.has(key)) { seen.add(key); result.push(transform); }
  }
  return result;
}

/** Age is the note-history clock: released heads move, held attacks stay at the origin. */
export function midiphoriaTravelFraction(age, flow = 'outward') {
  const progress = clamp(Number.isFinite(age) ? age : 0);
  return flow === 'inward' ? 1 - progress : progress;
}

export function paletteHue(hue, palette = 'pitch') {
  const phase = wrap(hue);
  if (palette === 'candy') return wrap((270 + 100 * Math.sin(phase * TAU)) / 360);
  if (palette === 'ember') return (5 + 55 * (0.5 + 0.5 * Math.sin(phase * TAU))) / 360;
  if (palette === 'ice') return (180 + 60 * (0.5 + 0.5 * Math.sin(phase * TAU))) / 360;
  if (palette === 'acid') return (65 + 95 * (0.5 + 0.5 * Math.sin(phase * TAU))) / 360;
  return phase;
}

export function midiColorHue(note, source = 'pitch') {
  if (source === 'channel') return clamp(note.channel, 0, 15) / 16;
  // Keep soft and hard attacks apart instead of wrapping both onto red.
  if (source === 'velocity') return (1 - clamp(note.velocity / 127)) * 2 / 3;
  return clamp(note.note, 0, 127) / 128;
}

function hsvRgb(hue, saturation, value) {
  const sector = wrap(hue) * 6;
  return [0, 4, 2].map(offset => value * (1 - saturation
    + saturation * clamp(Math.abs((sector + offset) % 6 - 3) - 1)));
}

function rgbHsv(rgb) {
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === rgb[0]) hue = ((rgb[1] - rgb[2]) / delta) / 6;
    else if (max === rgb[1]) hue = ((rgb[2] - rgb[0]) / delta + 2) / 6;
    else hue = ((rgb[0] - rgb[1]) / delta + 4) / 6;
  }
  return [wrap(hue), max ? delta / max : 0, max];
}

/** The neutral pitch blend is exactly the model's RGB, including inversion and ADSR. */
export function midiphoriaBlendRgb(sample, settings, options = DEFAULT_RENDER_OPTIONS) {
  if (!settings.color || (options.colorSource === 'pitch' && options.palette === 'pitch'
    && options.hueOffset === 0 && options.saturation === 1)) {
    return [...sample.rgb];
  }
  let base = sample.rgb.map(value => settings.invert ? 1 - value : value);
  if (options.colorSource !== 'pitch' && sample.activeNotes?.length) {
    const sum = [0, 0, 0];
    let total = 0;
    for (const note of sample.activeNotes.slice(0, MAX_HELD)) {
      const weight = settings.velocity ? note.velocity / 127 : 1;
      const rgb = hsvRgb(midiColorHue(note, options.colorSource) + (sample.hueOffset ?? 0), 1, 1);
      for (let axis = 0; axis < 3; axis += 1) sum[axis] += rgb[axis] * weight;
      total += weight;
    }
    if (total > 0) base = sum.map(value => value / total * sample.level);
  }
  const [hue, saturation, value] = rgbHsv(base);
  const color = hsvRgb(paletteHue(hue, options.palette) + options.hueOffset / 360,
    saturation * options.saturation, value);
  return color.map(component => settings.invert ? 1 - component : component);
}

/** Bounded MIDI event history. Rendering owns no clock, MIDI device, or audio work. */
export class MidiphoriaRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.trails = [];
    this.held = new Map();
    this.options = { ...DEFAULT_RENDER_OPTIONS };
    this._now = 0;
    this._spinTurns = 0;
    this._lastColorNotes = [];
    this._reflectionLayer = null;
    this.resize();
  }

  get view() { return this.options.view; }
  set view(view) { this.configure({ view }); }

  configure(partial) {
    this.options = normalizeMidiphoriaRenderOptions(partial, this.options);
    return { ...this.options };
  }

  resize() {
    const size = canvasSizing(this.canvas.getBoundingClientRect(), globalThis.devicePixelRatio, {
      maxPixelRatio: 2, minPixelRatio: null, pixelBudget: 2_000_000,
    });
    this.width = size.cssWidth; this.height = size.cssHeight;
    this.canvas.width = size.width; this.canvas.height = size.height;
    this.pixelRatio = size.pixelRatio;
    this.context?.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
    if (this._reflectionLayer) this._sizeReflectionLayer();
  }

  _sizeReflectionLayer() {
    const layer = this._reflectionLayer;
    layer.canvas.width = this.canvas.width; layer.canvas.height = this.canvas.height;
    layer.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  _getReflectionLayer() {
    if (!this._reflectionLayer) {
      const canvas = this.canvas.ownerDocument?.createElement('canvas')
        ?? new OffscreenCanvas(this.canvas.width, this.canvas.height);
      const context = canvas.getContext('2d');
      this._reflectionLayer = { canvas, context };
      this._sizeReflectionLayer();
    }
    return this._reflectionLayer;
  }

  clear() {
    this.trails = []; this.held.clear();
    this._lastColorNotes = []; this._spinTurns = 0;
  }

  capture(sample, now) {
    const next = Number.isFinite(now) ? Math.max(this._now, now) : this._now;
    this._spinTurns = wrap(this._spinTurns + (next - this._now) * this.options.spin / 60);
    this._now = next;
    if (sample.activeNotes.length) this._lastColorNotes = sample.activeNotes.slice(0, MAX_HELD);
    const active = new Set();
    for (const note of sample.activeNotes.slice(0, MAX_HELD)) {
      const key = keyFor(note);
      active.add(key);
      if (!this.held.has(key)) {
        const trail = { ...note, start: this._now, end: null };
        this.held.set(key, trail);
        this.trails.push(trail);
      }
    }
    for (const [key, trail] of this.held) {
      if (!active.has(key)) { trail.end = this._now; this.held.delete(key); }
    }
    const held = this.trails.filter(trail => trail.end === null);
    const released = this.trails.filter(trail => trail.end !== null && this._now - trail.end < this.options.trailSeconds);
    const room = Math.max(0, MAX_TRAILS - held.length);
    this.trails = [...(room ? released.slice(-room) : []), ...held];
  }

  draw(sample, now, settings) {
    const ctx = this.context;
    if (!ctx) return;
    this.capture(sample, now);
    now = this._now;
    const options = this.options, w = this.width, h = this.height;
    const background = settings.invert ? '#e7efe9' : '#030706';
    // Retain the last channel/velocity blend through the model's release envelope.
    const blend = midiphoriaBlendRgb({ ...sample, activeNotes: this._lastColorNotes }, settings, options);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);

    const floor = Math.max(8, h - 36), span = Math.max(1, w - 32);
    const xFor = note => 16 + (note + 0.5) / 128 * span;
    const round = options.view === 'radial' || options.view === 'orbit';
    ctx.lineWidth = 1;
    ctx.strokeStyle = settings.invert ? '#c5d4c9' : '#102019';
    if (round) {
      for (const radius of [0.2, 0.5, 0.8]) {
        ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.46 * radius, 0, TAU); ctx.stroke();
      }
    } else {
      for (let note = 0; note < 128; note += 12) {
        const x = xFor(note);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, floor); ctx.stroke();
        ctx.fillStyle = settings.invert ? '#4e6757' : '#6d8476';
        ctx.font = '9px system-ui'; ctx.textAlign = 'center';
        if (w > 500 || note % 24 === 0) ctx.fillText(`C${note / 12 - 1}`, x, h - 13);
      }
    }

    // One ambient gradient per frame; glow paths below never use expensive shadow blur.
    if (sample.level > 0.001 && options.glow > 0) {
      const centerY = round || options.flow !== 'classic' ? h / 2 : floor;
      const ambient = ctx.createRadialGradient(w / 2, centerY, 0, w / 2, centerY, Math.max(w, h) * 0.65);
      ambient.addColorStop(0, cssRgb(blend)); ambient.addColorStop(1, background);
      ctx.globalAlpha = options.glow * 0.45;
      ctx.fillStyle = ambient; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    }

    if (options.reflection === 'none') {
      this._drawTrails(ctx, sample, now, settings, w, h);
    } else {
      const layer = this._getReflectionLayer();
      layer.context.clearRect(0, 0, w, h);
      // A centered square keeps diagonal reflections inside the viewport with
      // the same scale on both axes. The extra backing store has the same cap.
      const diagonal = REFLECTION_TRANSFORMS[options.reflection].some(([a]) => a === 0);
      const drawWidth = diagonal ? Math.min(w, h) : w;
      const drawHeight = diagonal ? Math.min(w, h) : h;
      layer.context.save();
      layer.context.translate((w - drawWidth) / 2, (h - drawHeight) / 2);
      this._drawTrails(layer.context, sample, now, settings, drawWidth, drawHeight);
      layer.context.restore();
      ctx.globalAlpha = 1;
      for (const [a, b, c, d] of midiphoriaReflectionTransforms(options)) {
        ctx.save();
        ctx.transform(a, b, c, d, w / 2 - a * w / 2 - c * h / 2,
          h / 2 - b * w / 2 - d * h / 2);
        ctx.drawImage(layer.canvas, 0, 0, w, h);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
    ctx.strokeStyle = settings.invert ? '#9eb6a6' : '#274e39';
    ctx.beginPath(); ctx.moveTo(16, floor + 8); ctx.lineTo(w - 16, floor + 8); ctx.stroke();
    // CC mappings create no fake notes; the strip shows their actual envelope.
    ctx.fillStyle = cssRgb(blend);
    ctx.fillRect(16, floor + 7, span * sample.level, 2);
  }

  _drawTrails(ctx, sample, now, settings, w, h) {
    const options = this.options;
    const floor = Math.max(8, h - 36), span = Math.max(1, w - 32);
    const xFor = note => 16 + (note + 0.5) / 128 * span;
    ctx.lineCap = 'round';
    for (const trail of this.trails) {
      const end = trail.end ?? now;
      const fade = clamp(1 - (now - end) / options.trailSeconds) ** options.fadeCurve;
      if (fade <= 0) continue;
      const strength = settings.velocity ? trail.velocity / 127 : 1;
      const hue = paletteHue(midiColorHue(trail, options.colorSource) + (sample.hueOffset ?? 0), options.palette)
        + options.hueOffset / 360;
      const rgb = settings.color ? hsvRgb(hue, options.saturation * 0.78, settings.invert ? 0.45 : 1)
        : settings.invert ? [0.08, 0.14, 0.11] : [0.9, 0.95, 0.92];
      ctx.strokeStyle = cssRgb(rgb); ctx.fillStyle = ctx.strokeStyle;
      const alpha = Math.max(0.12, strength) * fade;
      const thickness = Math.max(1, span / 128 * 0.85) * options.width;
      const startAge = clamp((now - trail.start) / options.trailSeconds);
      const endAge = clamp((now - end) / options.trailSeconds);
      const phase = trail.note / 128 * TAU;
      const drift = Math.sin(now * 0.55 + phase * 3) * options.motion;
      let headX = 0, headY = 0;
      const heads = [];
      const rotation = this._spinTurns * TAU;
      const directed = options.flow !== 'classic';
      const travel = age => midiphoriaTravelFraction(age, options.flow);
      const travelPoint = (age, edgeX, edgeY) => [
        w / 2 + (edgeX - w / 2) * travel(age),
        h / 2 + (edgeY - h / 2) * travel(age),
      ];
      const shape = () => {
        ctx.beginPath();
        if (options.view === 'radial') {
          const angle = phase - Math.PI / 2 + now * options.motion * 0.1 + rotation;
          const maxRadius = Math.max(2, Math.min(w, h) * 0.44);
          const head = maxRadius * (directed ? 0.015 + travel(endAge) * 0.965 : 0.18 + endAge * 0.8);
          const tail = directed
            ? maxRadius * (0.015 + travel(Math.max(startAge, endAge + 0.008)) * 0.965)
            : Math.max(head + 3, maxRadius * (0.18 + startAge * 0.8));
          for (let copy = 0; copy < options.symmetry; copy += 1) {
            const copyAngle = angle + copy * TAU / options.symmetry;
            headX = w / 2 + Math.cos(copyAngle) * head; headY = h / 2 + Math.sin(copyAngle) * head;
            ctx.moveTo(headX, headY);
            ctx.lineTo(w / 2 + Math.cos(copyAngle) * tail, h / 2 + Math.sin(copyAngle) * tail);
            heads.push([headX, headY]);
          }
        } else if (options.view === 'orbit') {
          const radius = Math.max(2, Math.min(w, h) * (directed ? 0.44 : 0.08 + trail.note / 127 * 0.37));
          const angle = phase + now * options.motion * (0.14 + (trail.channel % 4) * 0.035) + rotation;
          const length = Math.min(TAU * 0.78, 0.025 + (startAge - endAge) * TAU * 0.65);
          for (let copy = 0; copy < options.symmetry; copy += 1) {
            const headAngle = angle - endAge * TAU * 0.65 + copy * TAU / options.symmetry;
            const headRadius = directed ? radius * (0.015 + travel(endAge) * 0.965) : radius;
            headX = w / 2 + Math.cos(headAngle) * headRadius; headY = h / 2 + Math.sin(headAngle) * headRadius;
            if (directed) {
              // A spiral follows both history angle and radius. Four cubic
              // pieces bound the cost independently of trail length or MIDI rate.
              const omega = -TAU * 0.65;
              const radiusSlope = radius * 0.965 * (options.flow === 'inward' ? -1 : 1);
              const point = age => {
                const theta = angle + age * omega + copy * TAU / options.symmetry;
                const r = radius * (0.015 + travel(age) * 0.965);
                return [w / 2 + Math.cos(theta) * r, h / 2 + Math.sin(theta) * r,
                  Math.cos(theta) * radiusSlope - Math.sin(theta) * r * omega,
                  Math.sin(theta) * radiusSlope + Math.cos(theta) * r * omega];
              };
              const tailAge = Math.min(1, Math.max(startAge, endAge + 0.008));
              const step = (endAge - tailAge) / 4;
              let from = point(tailAge);
              ctx.moveTo(from[0], from[1]);
              for (let segment = 1; segment <= 4; segment += 1) {
                const to = point(tailAge + segment * step);
                ctx.bezierCurveTo(from[0] + from[2] * step / 3, from[1] + from[3] * step / 3,
                  to[0] - to[2] * step / 3, to[1] - to[3] * step / 3, to[0], to[1]);
                from = to;
              }
            } else {
              if (copy) ctx.moveTo(w / 2 + Math.cos(headAngle - length) * radius,
                h / 2 + Math.sin(headAngle - length) * radius);
              ctx.arc(w / 2, h / 2, radius, headAngle - length, headAngle);
            }
            heads.push([headX, headY]);
          }
        } else if (options.view === 'ribbons') {
          const centerY = 16 + trail.note / 127 * Math.max(1, floor - 30);
          if (directed) {
            [headX, headY] = travelPoint(endAge, w - 16, centerY);
            const [tailX, tailY] = travelPoint(Math.max(startAge, endAge + 0.008), w - 16, centerY);
            const bend = drift * Math.min(w, h) * 0.06 * Math.abs(startAge - endAge);
            ctx.moveTo(tailX, tailY);
            ctx.bezierCurveTo(tailX + (headX - tailX) * 0.35, tailY + (headY - tailY) * 0.35 + bend,
              tailX + (headX - tailX) * 0.65, tailY + (headY - tailY) * 0.65 - bend, headX, headY);
            return;
          }
          const ribbonY = value => options.reflection === 'none' ? value : clamp(value, 16, Math.max(16, h - 16));
          headX = 16 + (1 - endAge) * span; headY = ribbonY(centerY + drift * h * 0.028);
          const tailX = 16 + (1 - startAge) * span;
          ctx.moveTo(tailX, centerY);
          ctx.bezierCurveTo(tailX + (headX - tailX) * 0.35, ribbonY(centerY + drift * h * 0.09),
            tailX + (headX - tailX) * 0.65, ribbonY(centerY - drift * h * 0.06), headX, headY);
          if (headX - tailX < 3) ctx.lineTo(headX + 3, headY);
        } else if (options.view === 'mirror') {
          const distance = Math.abs(trail.note - 63.5) / 64 * span * 0.48;
          const startY = Math.max(3, startAge * floor * 0.46);
          const endY = endAge * floor * 0.46;
          const spread = Math.abs(drift) * Math.min(w, h) * 0.03;
          const centerY = options.reflection === 'none' ? floor / 2 : h / 2;
          const offset = directed || options.reflection !== 'none'
            ? Math.min(Math.max(0, w / 2 - 16), distance + spread) : distance + spread;
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            const x = w / 2 + sx * offset;
            if (directed) {
              const edgeY = h / 2 + sy * Math.max(1, h / 2 - 16);
              [headX, headY] = travelPoint(endAge, x, edgeY);
              const [tailX, tailY] = travelPoint(Math.max(startAge, endAge + 0.008), x, edgeY);
              ctx.moveTo(headX, headY); ctx.lineTo(tailX, tailY);
            } else {
              ctx.moveTo(x, centerY + sy * endY); ctx.lineTo(x, centerY + sy * startY);
              headX = x; headY = centerY + sy * endY;
            }
            if (directed || options.reflection !== 'none') heads.push([headX, headY]);
          }
        } else {
          const rawX = xFor(trail.note) + drift * Math.min(10, span / 80);
          const x = directed || options.reflection !== 'none' ? clamp(rawX, 16, Math.max(16, w - 16)) : rawX;
          if (directed) {
            [headX, headY] = travelPoint(endAge, x, 16);
            const [tailX, tailY] = travelPoint(Math.max(startAge, endAge + 0.008), x, 16);
            ctx.moveTo(tailX, tailY); ctx.lineTo(headX, headY);
            return;
          }
          headX = x; headY = floor * (1 - endAge);
          ctx.moveTo(x, Math.max(0, floor * (1 - startAge)));
          ctx.lineTo(x, Math.max(4, headY));
        }
      };
      shape();
      if (options.glow > 0) {
        ctx.globalAlpha = alpha * options.glow * 0.14;
        ctx.lineWidth = thickness * (2.5 + options.glow * 3); ctx.stroke();
      }
      ctx.globalAlpha = alpha; ctx.lineWidth = thickness; ctx.stroke();
      if (trail.end === null) {
        if (!heads.length) heads.push([headX, headY]);
        for (const [x, y] of heads) {
          ctx.beginPath(); ctx.arc(x, y, Math.min(10, Math.max(1.5, thickness + strength * 2)), 0, TAU); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
