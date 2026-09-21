import { INSTRUMENT_BY_ID, clamp } from "./gesturama-core.js";

function roundedRectPath(context, x, y, width, height, radius) {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + resolvedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, resolvedRadius);
  context.arcTo(x + width, y + height, x, y + height, resolvedRadius);
  context.arcTo(x, y + height, x, y, resolvedRadius);
  context.arcTo(x, y, x + width, y, resolvedRadius);
  context.closePath();
}

function traceZone(context, zone, width, height) {
  const points = zone.points ?? [];
  const scale = Math.min(width, height);
  if (zone.type === "rect") {
    const start = points[0];
    const end = points[1] ?? start;
    if (!start) return false;
    const x = Math.min(start.x, end.x) * width;
    const y = Math.min(start.y, end.y) * height;
    const rectWidth = Math.abs(end.x - start.x) * width;
    const rectHeight = Math.abs(end.y - start.y) * height;
    roundedRectPath(context, x, y, Math.max(rectWidth, 2), Math.max(rectHeight, 2), Math.min(24, scale * 0.04));
    return true;
  }

  if (zone.type === "dot") {
    const center = points[0];
    if (!center) return false;
    context.beginPath();
    context.arc(center.x * width, center.y * height, Math.max(zone.radius * scale, 3), 0, Math.PI * 2);
    context.closePath();
    return true;
  }

  if (!points.length) return false;
  context.beginPath();
  context.moveTo(points[0].x * width, points[0].y * height);
  if (points.length === 1) {
    context.lineTo(points[0].x * width + 0.01, points[0].y * height);
  } else {
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x * width, points[index].y * height);
    }
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(zone.size * scale, 5);
  return true;
}

function zoneCenter(zone, width, height) {
  const points = zone.points ?? [];
  if (!points.length) return { x: width / 2, y: height / 2 };
  if ((zone.type === "rect" || zone.type === "line") && points[1]) {
    return {
      x: ((points[0].x + points[1].x) / 2) * width,
      y: ((points[0].y + points[1].y) / 2) * height,
    };
  }
  const total = points.reduce((accumulator, point) => ({
    x: accumulator.x + point.x,
    y: accumulator.y + point.y,
  }), { x: 0, y: 0 });
  return { x: (total.x / points.length) * width, y: (total.y / points.length) * height };
}

function drawPattern(context, zone, instrument, width, height) {
  const center = zoneCenter(zone, width, height);
  context.save();
  context.strokeStyle = instrument.color;
  context.fillStyle = instrument.color;
  context.globalAlpha = 0.55;
  context.lineWidth = 2;

  if (instrument.id === "kick") {
    context.beginPath();
    context.arc(center.x, center.y, 12, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(center.x, center.y, 4, 0, Math.PI * 2);
    context.fill();
  } else if (instrument.id === "snare") {
    for (let offset = -12; offset <= 12; offset += 8) {
      context.beginPath();
      context.moveTo(center.x + offset - 6, center.y + 11);
      context.lineTo(center.x + offset + 6, center.y - 11);
      context.stroke();
    }
  } else if (instrument.id === "hat") {
    for (const offset of [-7, 0, 7]) {
      context.beginPath();
      context.moveTo(center.x - 16, center.y + offset);
      context.lineTo(center.x + 16, center.y + offset);
      context.stroke();
    }
  } else {
    for (const x of [-9, 0, 9]) {
      for (const y of [-7, 7]) {
        context.beginPath();
        context.arc(center.x + x, center.y + y, 2.2, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  context.restore();
}

export function drawZones(context, zones, width, height, { now = 0, armed = false, hitTimes = new Map() } = {}) {
  context.clearRect(0, 0, width, height);
  for (const zone of zones) {
    const instrument = INSTRUMENT_BY_ID.get(zone.instrument);
    if (!instrument || !traceZone(context, zone, width, height)) continue;
    const isStroke = zone.type === "brush" || zone.type === "line";

    context.save();
    context.shadowColor = instrument.color;
    context.shadowBlur = armed ? 11 : 3;
    context.globalAlpha = armed ? 0.38 : 0.3;
    context.strokeStyle = instrument.color;
    context.fillStyle = instrument.color;
    if (isStroke) context.stroke();
    else context.fill();
    context.shadowBlur = 0;
    context.globalAlpha = 0.96;
    context.lineWidth = isStroke ? Math.max(zone.size * Math.min(width, height) * 0.13, 2) : 3;
    context.strokeStyle = instrument.color;
    context.stroke();
    context.restore();

    drawPattern(context, zone, instrument, width, height);

    const center = zoneCenter(zone, width, height);
    context.save();
    context.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(8, 10, 12, 0.78)";
    context.fillText(instrument.short, center.x, center.y + 27);
    context.restore();

    const hitAt = hitTimes.get(zone.id);
    const elapsed = now - (hitAt ?? -1_000);
    if (elapsed >= 0 && elapsed < 360) {
      const progress = clamp(elapsed / 360, 0, 1);
      context.save();
      context.globalAlpha = (1 - progress) * 0.9;
      context.strokeStyle = instrument.color;
      context.lineWidth = 5 * (1 - progress) + 1;
      context.beginPath();
      context.arc(center.x, center.y, 24 + progress * 54, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }
}
