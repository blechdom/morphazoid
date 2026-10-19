/** The loom is drawn in CSS pixels; the owner supplies its canvas DPR transform.
 * Geometry and hit regions share this layout, so dragging changes the same cord
 * that carries the source waveform and the audio-clock playback bead. */
export const LOOM_COLORS = Object.freeze(["#edba72", "#7cdbca", "#ed8e9b"]);
const BACKGROUND = "#0b1219";
const TAU = Math.PI * 2;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const distance = (a, x, y) => Math.hypot(x - a.x, y - a.y);

function color(hex, alpha = 1, lift = 0) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${[16, 8, 0].map(shift => clamp(((value >> shift) & 255) + lift, 0, 255)).join(",")},${alpha})`;
}

function pointAt(curve, t) {
  const q = 1 - t;
  return {
    x: q ** 3 * curve.from.x + 3 * q ** 2 * t * curve.control1.x + 3 * q * t ** 2 * curve.control2.x + t ** 3 * curve.to.x,
    y: q ** 3 * curve.from.y + 3 * q ** 2 * t * curve.control1.y + 3 * q * t ** 2 * curve.control2.y + t ** 3 * curve.to.y,
  };
}

function route(from, to, laneWidth, next) {
  const dx = to.x - from.x;
  if (Math.abs(dx) < 1) {
    const reach = Math.min(48, laneWidth * .32);
    return { from, to, control1: { x: from.x - reach, y: from.y }, control2: { x: to.x - reach, y: to.y }, next };
  }
  const sag = Math.min(44, Math.max(18, Math.abs(dx) * .12));
  return {
    from, to,
    control1: { x: from.x + dx * .43, y: from.y + sag },
    control2: { x: to.x - dx * .43, y: to.y + sag },
    next,
  };
}

/** start/end are normalized source positions. top/bottom delimit the complete
 * recording; stretching grows that source-bearing cord without moving its peg.
 * entry/exit respect reverse, while knotStart/knotEnd retain source ordering. */
export function getLoomLayout(width, height, cords = []) {
  const w = Math.max(1, finite(width, 1)), h = Math.max(1, finite(height, 1));
  const compact = h < 330;
  const headerY = compact ? 21 : 29;
  const railY = headerY + (compact ? 20 : 25);
  const top = railY + (compact ? 27 : 36);
  const availableLength = Math.max(24, h - top - (compact ? 58 : 70));
  const margin = Math.min(w * .18, 160);
  const laneWidth = cords.length > 1 ? (w - margin * 2) / (cords.length - 1) : w;
  const layout = cords.map((cord, index) => {
    const x = cords.length === 1 ? w / 2 : margin + laneWidth * index;
    const stretch = clamp(finite(cord.stretch, 1), .5, 4);
    const length = availableLength * (.58 + .42 * Math.log2(stretch * 2) / 3);
    const start = clamp(finite(cord.start, 0), 0, 1);
    const end = clamp(finite(cord.end, 1), start, 1);
    const bottom = top + length;
    // A tiny passage bunches its knots sideways, as a real cord would, so both
    // knots remain independently graspable even on the short landscape loom.
    const knotGap = (end - start) * length;
    const knotSpread = knotGap < 40 ? Math.sqrt(40 ** 2 - knotGap ** 2) / 2 : 0;
    const knotStart = { x: x - knotSpread, y: top + length * start };
    const knotEnd = { x: x + knotSpread, y: top + length * end };
    return {
      cord: index, x, top, bottom, length, availableLength, laneWidth, railY, viewportWidth: w,
      header: { x, y: headerY }, knotStart, knotEnd,
      entry: cord.reverse ? knotEnd : knotStart,
      exit: cord.reverse ? knotStart : knotEnd,
      tassel: { x, y: bottom + 23 },
      label: { x, y: bottom + (compact ? 48 : 53) },
      waveWidth: Math.min(31, laneWidth * .2),
      hitRadius: 24, start, end, stretch, reverse: Boolean(cord.reverse),
      next: Number.isInteger(cord.next) && cord.next >= 0 && cord.next < cords.length ? cord.next : null,
      link: null,
    };
  });
  for (const item of layout) {
    if (item.next !== null) item.link = route(item.exit, layout[item.next].entry, laneWidth, item.next);
  }
  return layout;
}

/** Knots win over the routes behind them. Choose the nearest knot when a very
 * short loop puts both generous touch regions under the same pointer. */
export function hitTestLoom(layout, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let closest = null;
  for (const item of layout) {
    for (const [part, point] of [["start", item.knotStart], ["end", item.knotEnd], ["stretch", item.tassel]]) {
      const d = distance(point, x, y);
      if (d <= item.hitRadius && (!closest || d < closest.distance)) closest = { cord: item.cord, part, distance: d };
    }
  }
  if (closest) return { cord: closest.cord, part: closest.part };
  // The whole waveform and its letter select the cord, including quiet samples.
  for (const item of layout) {
    if (Math.abs(x - item.x) <= Math.max(24, item.waveWidth) && y >= item.header.y - 19 && y <= item.bottom + 32) {
      return { cord: item.cord, part: "cord" };
    }
  }
  for (const item of layout) {
    if (!item.link) continue;
    for (let step = 1; step < 32; step++) {
      if (distance(pointAt(item.link, step / 32), x, y) <= 24) return { cord: item.cord, part: "link" };
    }
  }
  return null;
}

function strokeCurve(ctx, curve, stroke, width) {
  ctx.beginPath();
  ctx.moveTo(curve.from.x, curve.from.y);
  ctx.bezierCurveTo(curve.control1.x, curve.control1.y, curve.control2.x, curve.control2.y, curve.to.x, curve.to.y);
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
}

function line(ctx, x1, y1, x2, y2, stroke, width = 1) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
}

function ellipse(ctx, x, y, rx, ry, fill) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = fill; ctx.fill();
}

function arrow(ctx, curve, tint, t = .67, size = 5) {
  const point = pointAt(curve, t), before = pointAt(curve, t - .018);
  const angle = Math.atan2(point.y - before.y, point.x - before.x);
  ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(-size, -size * .65); ctx.lineTo(0, 0); ctx.lineTo(-size, size * .65);
  ctx.strokeStyle = tint; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
}

function tie(ctx, curve, tint, selected, playing = false, progress = 0) {
  strokeCurve(ctx, curve, "rgba(0,0,0,.42)", 7);
  strokeCurve(ctx, curve, color(tint, selected ? .66 : .38, -14), selected ? 2.6 : 2);
  strokeCurve(ctx, curve, color(tint, selected ? .19 : .09, 34), .8);
  // Short crossing fibres make this a thread, rather than a connection diagram.
  for (let index = 2; index < 34; index++) {
    const t = index / 36, p = pointAt(curve, t), q = pointAt(curve, t + .007);
    const angle = Math.atan2(q.y - p.y, q.x - p.x) + .9;
    line(ctx, p.x - Math.cos(angle) * 1.4, p.y - Math.sin(angle) * 1.4, p.x + Math.cos(angle) * 1.4, p.y + Math.sin(angle) * 1.4, color(tint, selected ? .33 : .18, 16), .6);
  }
  arrow(ctx, curve, color(tint, selected ? .92 : .62), .66, selected ? 5.5 : 4.5);
  if (playing && progress > .91) {
    const p = pointAt(curve, clamp((progress - .91) / .09, 0, 1));
    ellipse(ctx, p.x, p.y, 2.4, 2.4, color(tint, .85, 38));
  }
}

function rail(ctx, layout, width) {
  if (!layout.length) return;
  const y = layout[0].railY;
  const railCurve = { from: { x: 18, y: y - 3 }, to: { x: width - 18, y: y - 3 }, control1: { x: width * .32, y: y + 5 }, control2: { x: width * .68, y: y + 5 } };
  strokeCurve(ctx, railCurve, "#03090e", 10);
  strokeCurve(ctx, railCurve, "#5b645f", 5.5);
  strokeCurve(ctx, railCurve, "#8f9886", 1.2);
  const count = Math.ceil(width / 6);
  for (let i = 0; i < count; i++) {
    const p = pointAt(railCurve, i / count);
    line(ctx, p.x - 1.6, p.y + 2, p.x + 1.6, p.y - 2, "#a5a78a55", .8);
  }
  for (const item of layout) {
    const tint = LOOM_COLORS[item.cord % LOOM_COLORS.length];
    // A small lark's-head attachment visibly wraps around the carrying thread.
    ctx.beginPath(); ctx.moveTo(item.x - 3, item.top);
    ctx.bezierCurveTo(item.x - 4, y + 17, item.x - 12, y - 11, item.x, y - 9);
    ctx.bezierCurveTo(item.x + 12, y - 10, item.x + 3, y + 19, item.x + 2, item.top);
    ctx.strokeStyle = "#050b10"; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = color(tint, .75, -24); ctx.lineWidth = 3.4; ctx.stroke();
    ctx.strokeStyle = color(tint, .42, 28); ctx.lineWidth = .8; ctx.stroke();
    line(ctx, item.x - 4, y + 9, item.x + 5, y + 5, color(tint, .82), 3);
    line(ctx, item.x - 3, y + 13, item.x + 4, y + 9, color(tint, .65, 22), 2);
  }
}

function waveform(ctx, item, peaks, tint, selected) {
  const values = peaks?.length ? peaks : null;
  const count = Math.min(128, values?.length || 48);
  const amplitude = index => clamp(Math.abs(finite(values?.[Math.floor(index * values.length / count)], 0)), 0, 1);
  const spread = index => 4 + Math.sqrt(amplitude(index)) * item.waveWidth;
  // The original recording remains visible beyond the two knots.
  for (let i = 0; i < count; i++) {
    const sourcePosition = i / Math.max(1, count - 1);
    const y = item.top + sourcePosition * item.length;
    const inside = sourcePosition >= item.start && sourcePosition <= item.end;
    const wing = spread(i);
    const alpha = inside ? (selected ? .52 : .32) : .12;
    line(ctx, item.x - wing, y + .6, item.x + wing, y - .6, color(tint, alpha), selected && inside ? 1.2 : .85);
  }
  if (values) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = item.x + side * spread(i), y = item.top + i / Math.max(1, count - 1) * item.length;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = color(tint, selected ? .2 : .12); ctx.lineWidth = .65; ctx.stroke();
    }
  }
}

function rope(ctx, item, tint, selected) {
  line(ctx, item.x + 1, item.top, item.x + 1, item.bottom + 11, "#02070a99", 10);
  line(ctx, item.x, item.top, item.x, item.bottom + 10, color(tint, .54, -67), 6);
  line(ctx, item.x - 1.2, item.top, item.x - 1.2, item.bottom + 10, color(tint, .49), 2.3);
  const startY = item.knotStart.y, endY = item.knotEnd.y;
  if (endY > startY) {
    line(ctx, item.x, startY, item.x, endY, color(tint, selected ? .85 : .62, -26), 5.3);
    line(ctx, item.x - 1.1, startY, item.x - 1.1, endY, color(tint, selected ? .83 : .55, 22), 1.2);
  }
  for (let y = item.top + 2; y < item.bottom + 10; y += 5) {
    const inside = y >= startY && y <= endY;
    line(ctx, item.x - 2.5, y + 2.3, item.x + 2.5, y - .8, color(tint, inside ? .75 : .29, 26), .95);
    line(ctx, item.x - 2.3, y + 3.5, item.x + 2.3, y + .6, "#10171d55", .7);
  }
}

function knot(ctx, point, tint, selected, lift = false, ending = false) {
  ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(ending ? -.14 : .12);
  ellipse(ctx, 2, lift ? 5 : 3, 15, 10, "#01070bb8");
  // An open bight passes behind a compact stack of turns.
  ctx.beginPath(); ctx.moveTo(-4, -6);
  ctx.bezierCurveTo(7, -17, 19, -11, 13, -1);
  ctx.bezierCurveTo(10, 5, -1, 12, -8, 6);
  ctx.strokeStyle = "#080c10"; ctx.lineWidth = 6.8; ctx.stroke();
  ctx.strokeStyle = color(tint, .95, -34); ctx.lineWidth = 4.6; ctx.stroke();
  ctx.strokeStyle = color(tint, .7, 28); ctx.lineWidth = 1; ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    const y = i * 2.6;
    line(ctx, -7.5, y + 1.5, 7.5, y - 1.5, color(tint, 1, -66), 4.2);
    line(ctx, -7, y + .3, 6.5, y - 2.2, color(tint, selected || lift ? 1 : .9, i % 2 ? 0 : 16), 2.1);
    line(ctx, -5, y - .1, 4.5, y - 1.9, color(tint, .74, 46), .6);
  }
  ctx.beginPath(); ctx.moveTo(-9, 5);
  ctx.bezierCurveTo(-9, -3, -3, -8, 3, -8);
  ctx.bezierCurveTo(7, -8, 12, -4, 10, 1);
  ctx.strokeStyle = "#10141b"; ctx.lineWidth = 5.4; ctx.stroke();
  ctx.strokeStyle = color(tint, 1, -9); ctx.lineWidth = 3.4; ctx.stroke();
  ctx.strokeStyle = color(tint, selected || lift ? .92 : .55, 58); ctx.lineWidth = .9; ctx.stroke();
  ctx.restore();
}

function knotLead(ctx, item, point, tint) {
  if (Math.abs(point.x - item.x) < .1) return;
  ctx.beginPath(); ctx.moveTo(item.x, point.y - 12);
  ctx.bezierCurveTo(item.x, point.y - 5, point.x, point.y - 8, point.x, point.y);
  ctx.bezierCurveTo(point.x, point.y + 8, item.x, point.y + 5, item.x, point.y + 12);
  ctx.strokeStyle = "#03090ddd"; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = color(tint, .94, -20); ctx.lineWidth = 3.2; ctx.stroke();
  ctx.strokeStyle = color(tint, .65, 38); ctx.lineWidth = .7; ctx.stroke();
}

function tassel(ctx, item, tint, selected, sway = 0) {
  const baseY = item.bottom + 10;
  for (let i = 0; i < 11; i++) {
    const side = (i - 5) / 5;
    const endX = item.x + side * (8 + Math.abs(side) * 3) + sway;
    const endY = baseY + 22 + (1 - Math.abs(side)) * 4 - (i % 3) * 1.2;
    ctx.beginPath(); ctx.moveTo(item.x + side * 2.6, baseY);
    ctx.bezierCurveTo(item.x + side * 3.6, baseY + 10, endX - side * 3, endY - 7, endX, endY);
    ctx.strokeStyle = color(tint, selected ? .83 : .61, i % 2 ? -37 : 4); ctx.lineWidth = i % 3 ? 1.1 : 1.5; ctx.stroke();
  }
  for (let y = baseY - 5; y <= baseY + 3; y += 2) {
    line(ctx, item.x - 4, y + .4, item.x + 4, y - .4, color(tint, .95, -33), 2.4);
    line(ctx, item.x - 3, y - .5, item.x + 2, y - .8, color(tint, .8, 31), .65);
  }
}

function bead(ctx, item, position, tint, armed) {
  const y = item.top + clamp(finite(position), 0, 1) * item.length;
  const glow = ctx.createRadialGradient(item.x, y, 2, item.x, y, 27);
  glow.addColorStop(0, color(tint, armed ? .2 : .07)); glow.addColorStop(1, color(tint, 0));
  ctx.fillStyle = glow; ctx.fillRect(item.x - 27, y - 27, 54, 54);
  ellipse(ctx, item.x + 1, y + 2, 8, 11, "#01070dcc");
  const grain = ctx.createLinearGradient(item.x - 7, y, item.x + 7, y);
  grain.addColorStop(0, color(tint, 1, -76)); grain.addColorStop(.25, color(tint, 1, 36));
  grain.addColorStop(.52, color(tint, 1, 60)); grain.addColorStop(1, color(tint, 1, -42));
  ellipse(ctx, item.x, y, 6.7, 9.8, grain);
  line(ctx, item.x - 5.3, y - 3.5, item.x + 5.3, y - 3.5, "#10182066", .8);
  line(ctx, item.x - 5.3, y + 3.5, item.x + 5.3, y + 3.5, "#10182077", .8);
  ellipse(ctx, item.x - 1.6, y - 1, 1.7, 4.3, armed ? "#fff4d9e8" : "#e1dbc49e");
}

function labels(ctx, item, tint, selected, duration) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `500 ${item.laneWidth < 150 ? 13 : 14}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = color(tint, selected ? 1 : .7);
  ctx.fillText(String.fromCharCode(65 + item.cord), item.header.x, item.header.y);
  if (selected) ellipse(ctx, item.header.x - 17, item.header.y, 2, 2, color(tint, .9));
  const ax = item.header.x + 18, direction = item.reverse ? -1 : 1;
  line(ctx, ax, item.header.y - 4, ax, item.header.y + 4, color(tint, .64));
  line(ctx, ax - 2.5, item.header.y + direction * 1, ax, item.header.y + direction * 4, color(tint, .64));
  line(ctx, ax + 2.5, item.header.y + direction * 1, ax, item.header.y + direction * 4, color(tint, .64));
  const rulerX = item.x - item.waveWidth - 13;
  for (let i = 0; i <= 8; i++) {
    const y = item.top + item.length * i / 8;
    line(ctx, rulerX - (i % 2 ? 0 : 3), y, rulerX + 3, y, "#78899336", .75);
  }
  const loopSeconds = Math.max(0, duration * (item.end - item.start) * item.stretch);
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = selected ? "#bac5c9" : "#798b95";
  const stretchLabel = Number(item.stretch.toFixed(2)).toString();
  ctx.fillText(`${loopSeconds.toFixed(loopSeconds < 10 ? 2 : 1)}s · ${stretchLabel}×`, item.label.x, item.label.y);
  if (selected) {
    const rightX = Math.max(item.knotStart.x, item.knotEnd.x) + 23;
    const rightFits = rightX + 35 < item.viewportWidth - 5;
    const x = rightFits ? rightX : Math.min(item.knotStart.x, item.knotEnd.x) - 23;
    const separated = item.knotEnd.y - item.knotStart.y < 35;
    ctx.textAlign = rightFits ? "left" : "right"; ctx.fillStyle = color(tint, .78);
    ctx.fillText(`${(duration * item.start).toFixed(2)}`, x, item.knotStart.y - (separated ? 11 : 1));
    ctx.fillText(`${(duration * item.end).toFixed(2)}`, x, item.knotEnd.y + (separated ? 12 : 1));
  }
}

/** position is the active voice's normalized SOURCE position, not loop progress.
 * No wall clock is read: every motion follows playback or the current gesture. */
export function drawTimeLoom(ctx, width, height, state = {}) {
  const cords = Array.isArray(state.cords) ? state.cords : [];
  const layout = getLoomLayout(width, height, cords);
  if (!ctx) return layout;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, width, height);
  const atmosphere = ctx.createRadialGradient(width * .48, height * .37, 0, width * .48, height * .37, Math.max(width, height) * .72);
  atmosphere.addColorStop(0, "#16232a77"); atmosphere.addColorStop(1, "#0b121900");
  ctx.fillStyle = atmosphere; ctx.fillRect(0, 0, width, height);
  rail(ctx, layout, width);

  for (const item of layout) {
    const tint = LOOM_COLORS[item.cord % LOOM_COLORS.length];
    const selected = item.cord === state.selected;
    if (item.link) {
      const span = Math.max(.0001, item.end - item.start);
      const progress = item.reverse ? (item.end - finite(state.position)) / span : (finite(state.position) - item.start) / span;
      tie(ctx, item.link, tint, selected, Boolean(state.playing && state.armed && state.activeCord === item.cord), progress);
    } else if (item.end - item.start > .035) {
      const self = route(item.exit, item.entry, item.laneWidth, item.cord);
      strokeCurve(ctx, self, color(tint, selected ? .28 : .13), 1.3);
      arrow(ctx, self, color(tint, selected ? .62 : .32), .5, 3.8);
    }
  }

  for (const item of layout) {
    const tint = LOOM_COLORS[item.cord % LOOM_COLORS.length], selected = item.cord === state.selected;
    const active = Boolean(state.playing && state.activeCord === item.cord);
    const dragging = state.drag?.cord === item.cord;
    waveform(ctx, item, state.waveforms?.[item.cord], tint, selected);
    rope(ctx, item, tint, selected);
    const sway = dragging && state.drag.part === "stretch" ? clamp((finite(state.drag.x, item.x) - item.x) * .2, -9, 9) : active && state.armed ? Math.sin(finite(state.position) * TAU * 2) * 1.8 : 0;
    tassel(ctx, item, tint, selected, sway);
    knotLead(ctx, item, item.knotStart, tint);
    knotLead(ctx, item, item.knotEnd, tint);
    knot(ctx, item.knotStart, tint, selected, dragging && state.drag.part === "start");
    knot(ctx, item.knotEnd, tint, selected, dragging && state.drag.part === "end", true);
    if (active) bead(ctx, item, state.position, tint, state.armed);
    labels(ctx, item, tint, selected, Math.max(0, finite(state.durations?.[item.cord], 0)));
  }

  if (Number.isInteger(state.linkFrom) && layout[state.linkFrom]) {
    const origin = layout[state.linkFrom];
    const tint = LOOM_COLORS[state.linkFrom % LOOM_COLORS.length];
    const pointer = state.drag && Number.isFinite(state.drag.x) && Number.isFinite(state.drag.y)
      ? { x: state.drag.x, y: state.drag.y }
      : { x: origin.exit.x + Math.min(48, origin.laneWidth * .32), y: origin.exit.y + 24 };
    const preview = route(origin.exit, pointer, origin.laneWidth, null);
    strokeCurve(ctx, preview, color(tint, .9), 2);
    arrow(ctx, preview, color(tint, 1, 38), .88, 5);
    for (const item of layout) {
      if (item.cord === state.linkFrom) continue;
      ctx.beginPath(); ctx.arc(item.entry.x, item.entry.y, 21, -.7, 2.3);
      ctx.strokeStyle = color(LOOM_COLORS[item.cord % LOOM_COLORS.length], .65); ctx.lineWidth = 1.2; ctx.stroke();
    }
  }
  ctx.restore();
  return layout;
}
