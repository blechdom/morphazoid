import { createCamera, formatCoordinate, formatTick, minorTicks, niceTicks } from "./camera.js";

export const PALETTE = Object.freeze({
  background: "#070b0e",
  minorGrid: "#111b21",
  majorGrid: "#1c2b33",
  axis: "#5d7a86",
  label: "#9fb5bd",
  labelShadow: "rgba(7, 11, 14, 0.85)",
  guide: "rgba(214, 228, 233, 0.55)",
  hover: "#ffffff",
  font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
  labelFont: "12px ui-monospace, SFMono-Regular, Menlo, monospace",
});

export const HEAD_TINTS = Object.freeze(["rgba(238, 246, 248, 0.85)", "rgba(184, 199, 205, 0.7)", "rgba(143, 163, 171, 0.6)", "rgba(107, 127, 136, 0.55)"]);
const TAU = Math.PI * 2;
const PIXEL_LIMIT = 1e5;
const clampPixel = (value) => (Number.isFinite(value) ? Math.max(-PIXEL_LIMIT, Math.min(PIXEL_LIMIT, value)) : NaN);

export class GraphRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
  }

  resize(width, height, pixelRatio = 1) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = Math.min(3, Math.max(1, pixelRatio || 1));
    const deviceWidth = Math.round(this.width * this.pixelRatio), deviceHeight = Math.round(this.height * this.pixelRatio);
    if (this.canvas.width !== deviceWidth) this.canvas.width = deviceWidth;
    if (this.canvas.height !== deviceHeight) this.canvas.height = deviceHeight;
  }

  camera(view) {
    return createCamera(view, this.width, this.height);
  }

  draw({ view, geometry = [], grid = true, labels = true, reading = null, hover = null, selectedId = null }) {
    const context = this.context;
    if (!context) return;
    const camera = this.camera(view);
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.fillStyle = PALETTE.background;
    context.fillRect(0, 0, this.width, this.height);
    const ticks = this.drawGrid(context, camera, view, grid);
    this.drawFills(context, camera, geometry);
    this.drawCurves(context, camera, geometry, selectedId);
    this.drawPoints(context, camera, geometry, selectedId);
    if (labels) this.drawAxisLabels(context, camera, view, ticks);
    if (reading) this.drawReading(context, camera, reading);
    if (hover) this.drawHover(context, camera, hover);
  }

  drawGrid(context, camera, view, grid) {
    const xTicks = niceTicks(view.xMin, view.xMax, Math.max(2, Math.floor(this.width / 90)));
    const yTicks = niceTicks(view.yMin, view.yMax, Math.max(2, Math.floor(this.height / 70)));
    if (grid) {
      context.lineWidth = 1;
      context.strokeStyle = PALETTE.minorGrid;
      context.beginPath();
      for (const x of minorTicks(view.xMin, view.xMax, xTicks.step, xTicks.minorStep)) this.verticalLine(context, camera, x);
      for (const y of minorTicks(view.yMin, view.yMax, yTicks.step, yTicks.minorStep)) this.horizontalLine(context, camera, y);
      context.stroke();
      context.strokeStyle = PALETTE.majorGrid;
      context.beginPath();
      for (const x of xTicks.ticks) if (x !== 0) this.verticalLine(context, camera, x);
      for (const y of yTicks.ticks) if (y !== 0) this.horizontalLine(context, camera, y);
      context.stroke();
    }
    context.strokeStyle = PALETTE.axis;
    context.lineWidth = 1.5;
    context.beginPath();
    if (view.xMin <= 0 && view.xMax >= 0) this.verticalLine(context, camera, 0);
    if (view.yMin <= 0 && view.yMax >= 0) this.horizontalLine(context, camera, 0);
    context.stroke();
    return { xTicks, yTicks };
  }

  verticalLine(context, camera, x) {
    const [px] = camera.toPixel(x, 0);
    const snapped = Math.round(px) + 0.5;
    context.moveTo(snapped, 0);
    context.lineTo(snapped, this.height);
  }

  horizontalLine(context, camera, y) {
    const [, py] = camera.toPixel(0, y);
    const snapped = Math.round(py) + 0.5;
    context.moveTo(0, snapped);
    context.lineTo(this.width, snapped);
  }

  drawAxisLabels(context, camera, view, { xTicks, yTicks }) {
    context.font = PALETTE.font;
    context.fillStyle = PALETTE.label;
    const [axisX, axisY] = camera.toPixel(0, 0);
    const baseY = Math.min(this.height - 6, Math.max(14, axisY + 4));
    const labelY = axisY > this.height - 20 ? this.height - 6 : baseY + 10;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    for (const x of xTicks.ticks) {
      if (x === 0) continue;
      const [px] = camera.toPixel(x, 0);
      if (px < 14 || px > this.width - 14) continue;
      this.labelText(context, formatTick(x, xTicks.decimals), px, labelY);
    }
    const baseX = Math.min(this.width - 6, Math.max(6, axisX - 6));
    context.textAlign = axisX < 40 ? "left" : "right";
    const labelX = axisX < 40 ? Math.max(6, axisX + 6) : baseX;
    context.textBaseline = "middle";
    for (const y of yTicks.ticks) {
      if (y === 0) continue;
      const [, py] = camera.toPixel(0, y);
      if (py < 8 || py > this.height - 8) continue;
      this.labelText(context, formatTick(y, yTicks.decimals), labelX, py);
    }
    if (view.xMin <= 0 && view.xMax >= 0 && view.yMin <= 0 && view.yMax >= 0) {
      context.textAlign = "right";
      context.textBaseline = "alphabetic";
      this.labelText(context, "0", axisX - 5, axisY + 13);
    }
  }

  labelText(context, text, x, y) {
    context.save();
    context.shadowColor = PALETTE.labelShadow;
    context.shadowBlur = 4;
    context.fillText(text, x, y);
    context.restore();
  }

  drawFills(context, camera, geometry) {
    for (const item of geometry) {
      if (!item.fills?.length) continue;
      context.fillStyle = withAlpha(item.color, 0.2);
      for (const polygon of item.fills) {
        context.beginPath();
        this.tracePath(context, camera, polygon, true);
        context.closePath();
        context.fill();
      }
    }
  }

  drawCurves(context, camera, geometry, selectedId) {
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const item of geometry) {
      if (!item.segments.length) continue;
      context.strokeStyle = item.color;
      context.lineWidth = item.id === selectedId ? 3.5 : 2.5;
      context.setLineDash(item.strict ? [6, 6] : []);
      context.beginPath();
      for (const segment of item.segments) this.tracePath(context, camera, segment, false);
      context.stroke();
    }
    context.setLineDash([]);
  }

  tracePath(context, camera, segment, continuous) {
    let pen = false;
    for (let i = 0; i + 1 < segment.length; i += 2) {
      const [px, py] = camera.toPixel(segment[i], segment[i + 1]);
      const x = clampPixel(px), y = clampPixel(py);
      if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
      if (!pen || (i === 0 && !continuous)) { context.moveTo(x, y); pen = true; } else context.lineTo(x, y);
    }
  }

  drawPoints(context, camera, geometry, selectedId) {
    for (const item of geometry) {
      for (const [x, y] of item.points) {
        const [px, py] = camera.toPixel(x, y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        const radius = item.id === selectedId ? 7 : 5.5;
        if (item.draggable?.some(Boolean)) {
          context.strokeStyle = withAlpha(item.color, 0.45);
          context.lineWidth = 2;
          context.beginPath();
          context.arc(px, py, radius + 5, 0, Math.PI * 2);
          context.stroke();
        }
        context.fillStyle = item.color;
        context.beginPath();
        context.arc(px, py, radius, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = PALETTE.background;
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
  }

  drawReading(context, camera, reading) {
    for (const head of reading.heads) {
      const tint = HEAD_TINTS[head.index % HEAD_TINTS.length];
      context.strokeStyle = tint;
      context.lineWidth = head.index === 0 ? 1.5 : 1;
      context.setLineDash(head.index === 0 ? [] : [4, 4]);
      if (head.guide.kind === "line") {
        context.beginPath();
        if (head.guide.axis === "vertical") {
          const [px] = camera.toPixel(head.guide.coordinate, 0);
          if (!Number.isFinite(px)) continue;
          context.moveTo(Math.round(px) + 0.5, 0);
          context.lineTo(Math.round(px) + 0.5, this.height);
        } else {
          const [, py] = camera.toPixel(0, head.guide.coordinate);
          if (!Number.isFinite(py)) continue;
          context.moveTo(0, Math.round(py) + 0.5);
          context.lineTo(this.width, Math.round(py) + 0.5);
        }
        context.stroke();
      } else if (head.guide.kind === "ray") {
        const { center, angle, probe } = head.guide;
        const [cx, cy] = camera.toPixel(center.x, center.y);
        const [ex, ey] = camera.toPixel(center.x + Math.cos(angle) * probe.length, center.y + Math.sin(angle) * probe.length);
        if (![cx, cy, ex, ey].every(Number.isFinite)) continue;
        context.beginPath();
        context.moveTo(cx, cy);
        context.lineTo(clampPixel(ex), clampPixel(ey));
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = tint;
        context.beginPath();
        context.arc(cx, cy, 3, 0, TAU);
        context.fill();
      }
    }
    context.setLineDash([]);
    context.font = PALETTE.labelFont;
    context.textBaseline = "middle";
    let shown = 0;
    for (const contact of reading.contacts) {
      const [px, py] = camera.toPixel(contact.x, contact.y);
      if (!Number.isFinite(px) || !Number.isFinite(py) || px < -20 || px > this.width + 20 || py < -20 || py > this.height + 20) continue;
      context.strokeStyle = HEAD_TINTS[contact.head % HEAD_TINTS.length];
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(px, py, 9, 0, TAU);
      context.stroke();
      context.fillStyle = contact.color;
      context.beginPath();
      context.arc(px, py, 5, 0, TAU);
      context.fill();
      context.strokeStyle = PALETTE.background;
      context.lineWidth = 1.5;
      context.stroke();
      if (contact.head === 0 && shown < 6) {
        context.fillStyle = contact.color;
        context.textAlign = px > this.width - 120 ? "right" : "left";
        this.labelText(context, `(${formatCoordinate(contact.x)}, ${formatCoordinate(contact.y)})`, px + (px > this.width - 120 ? -12 : 12), py - 14);
        shown++;
      }
    }
  }

  drawHover(context, camera, hover) {
    const [px, py] = camera.toPixel(hover.x, hover.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    context.strokeStyle = PALETTE.hover;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(px, py, 7, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = hover.color;
    context.beginPath();
    context.arc(px, py, 4, 0, Math.PI * 2);
    context.fill();
    context.font = PALETTE.labelFont;
    context.fillStyle = PALETTE.hover;
    context.textBaseline = "middle";
    context.textAlign = px > this.width - 130 ? "right" : "left";
    this.labelText(context, `(${formatCoordinate(hover.x)}, ${formatCoordinate(hover.y)})`, px + (px > this.width - 130 ? -12 : 12), py - 14);
  }
}

export function withAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((ch) => ch + ch).join("") : value;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return hex;
  const r = (number >> 16) & 255, g = (number >> 8) & 255, b = number & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
