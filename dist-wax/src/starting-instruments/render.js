import { TAU, clamp } from "./common.js";

export const COLORS = ["#f4bb7e", "#a4ddba", "#c5a5ee", "#7dd8e7", "#eb9cb5", "#bdcb77"];
export const WORLD = { width: 900, height: 610 };
export const tapeCenters = [{ x: 250, y: 310 }, { x: 650, y: 310 }];
export const soupCenters = [{ x: 190, y: 285 }, { x: 450, y: 335 }, { x: 710, y: 285 }];
export const habitNodes = Array.from({ length: 6 }, (_, i) => ({
  x: 450 + 225 * Math.cos(-Math.PI / 2 + i * TAU / 6),
  y: 305 + 220 * Math.sin(-Math.PI / 2 + i * TAU / 6),
}));
export function polar(cx, cy, r, p) { return { x: cx + r * Math.cos(TAU * p - Math.PI / 2), y: cy + r * Math.sin(TAU * p - Math.PI / 2) }; }
export function angleAt(p, c) { return ((Math.atan2(p.y - c.y, p.x - c.x) + Math.PI / 2) / TAU + 1) % 1; }
const line = (ctx, a, b, c, width = 2) => {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = c; ctx.lineWidth = width; ctx.stroke();
};
function circle(ctx, x, y, r, fill, stroke, width = 2) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
function text(ctx, value, x, y, color = "#99a6b9", size = 14, align = "center") {
  ctx.fillStyle = color; ctx.font = `${size}px ui-monospace, monospace`; ctx.textAlign = align; ctx.fillText(value, x, y);
}
function arrow(ctx, point, angle, color, size = 9) {
  line(ctx, point, { x: point.x - size * Math.cos(angle - 0.55), y: point.y - size * Math.sin(angle - 0.55) }, color, 2);
  line(ctx, point, { x: point.x - size * Math.cos(angle + 0.55), y: point.y - size * Math.sin(angle + 0.55) }, color, 2);
}
function waveformRing(ctx, center, r, wave, color, selected = false) {
  circle(ctx, center.x, center.y, r, "#0d1821", "#24313c", selected ? 3 : 1);
  circle(ctx, center.x, center.y, r * 0.65, "#0a1018", "#24313c", 1);
  ctx.beginPath();
  const samples = wave?.length || 96;
  for (let i = 0; i <= samples; i++) {
    const radius = r + Math.min(28, (wave?.[i % samples] || 0) * 55);
    const p = polar(center.x, center.y, radius, i / samples);
    if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 2.7; ctx.stroke();
  for (let i = 0; i < 16; i++) {
    line(ctx, polar(center.x, center.y, r * 0.7, i / 16), polar(center.x, center.y, r * 0.75, i / 16), "#334351");
  }
}

export function renderInstrument(ctx, id, s, selected = 0, brush = false) {
  ctx.fillStyle = "#080e16"; ctx.fillRect(0, 0, 900, 610);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // A restrained fixed reference grid; all bright motion comes from model state.
  ctx.strokeStyle = "#111d28"; ctx.lineWidth = 1;
  for (let x = 50; x < 900; x += 50) { ctx.beginPath(); ctx.moveTo(x, 45); ctx.lineTo(x, 565); ctx.stroke(); }
  for (let y = 55; y < 610; y += 50) { ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(855, y); ctx.stroke(); }
  if (id === "tempo-tantrum") {
    const center = { x: 450, y: 306 };
    for (let i = 2; i >= 0; i--) {
      const r = 86 + i * 74;
      circle(ctx, center.x, center.y, r, "transparent", COLORS[i] + "50", 1.5);
      // Show every equivalent phase branch; a single marker would jump
      // backwards every drive wrap and falsely suggest the body should follow it.
      for (let k = 0; k < i + 2; k++) {
        const target = polar(center.x, center.y, r, ((s.driverPhase || 0) + k) / (i + 2));
        circle(ctx, target.x, target.y, 6, "#080e16", COLORS[i] + "75", 1);
      }
      const p = polar(center.x, center.y, r + (s.offsets?.[i] || 0) * 100, s.phases?.[i] || 0);
      line(ctx, center, p, COLORS[i] + "38", 2);
      circle(ctx, p.x, p.y, 16 + (s.flashes?.[i] || 0) * 13, COLORS[i] + "20");
      circle(ctx, p.x, p.y, 13, COLORS[i], "#f7f1df", selected === i ? 3 : 1);
      text(ctx, i + 1, p.x, p.y + 5, "#08121a", 14);
      text(ctx, `BODY ${i + 1} · 1:${i + 2}`, 124 + i * 326, 548, COLORS[i], 13);
      text(ctx, s.locked?.[i] ? "IN STEP" : "DRIFTING", 124 + i * 326, 572, COLORS[i], 13);
    }
    circle(ctx, 450, 306, 30, "#d18683", "#f1c1ae", 2);
    const pulse = 1 - (s.driverPhase || 0);
    circle(ctx, 450, 306, 32 + pulse * 16, "transparent", "#d1868350", 2);
    text(ctx, "DRIVE", 450, 311, "#101721", 12);
  } else if (id === "tape-worm") {
    for (let i = 0; i < 2; i++) {
      const c = tapeCenters[i], color = COLORS[i];
      waveformRing(ctx, c, 132, s.waves?.[i], color, selected === i);
      text(ctx, i ? "TAPE B" : "TAPE A", c.x, c.y - 8, color, 19);
      text(ctx, `${(s.durations?.[i] || 0).toFixed(2)} s`, c.x, c.y + 22);
      const gate = polar(c.x, c.y, 132, s.params.departure);
      const arrival = polar(tapeCenters[1 - i].x, tapeCenters[1 - i].y, 132, s.params.landing);
      if (s.params.splice > 0.5) {
        ctx.beginPath(); ctx.moveTo(gate.x, gate.y);
        ctx.bezierCurveTo(450, 64 + i * 480, 450, 64 + i * 480, arrival.x, arrival.y);
        ctx.strokeStyle = color + "90"; ctx.lineWidth = 2; ctx.setLineDash([5, 8]); ctx.stroke(); ctx.setLineDash([]);
        arrow(ctx, arrival, Math.atan2(arrival.y - (64 + i * 480), arrival.x - 450), color);
      }
      circle(ctx, gate.x, gate.y, 11, "#080e16", color, 4);
      text(ctx, "OUT", gate.x, gate.y - 19, color, 11);
      const entry = polar(c.x, c.y, 132, s.params.landing);
      ctx.beginPath(); ctx.moveTo(entry.x, entry.y - 10); ctx.lineTo(entry.x + 10, entry.y);
      ctx.lineTo(entry.x, entry.y + 10); ctx.lineTo(entry.x - 10, entry.y); ctx.closePath();
      ctx.fillStyle = "#080e16"; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, "IN", entry.x, entry.y + 25, color, 11);
      text(ctx, s.names?.[i] || "Demo", c.x, 504, "#9eabba", 12);
    }
    const c = tapeCenters[s.tape || 0];
    for (let k = 4; k >= 0; k--) {
      const p = polar(c.x, c.y, 132, (s.phase || 0) - k * 0.017);
      circle(ctx, p.x, p.y, k ? 9 - k : 15, k ? "#e6ecca" : "#faf3d9", "#50624a", 1);
      if (!k) { circle(ctx, p.x - 4, p.y - 3, 2, "#0a1018"); circle(ctx, p.x + 4, p.y - 3, 2, "#0a1018"); }
    }
    text(ctx, s.recording ? `RECORDING ${s.recording.seconds.toFixed(1)} / 12 s` : `${s.transitions || 0} SPLICES`, 450, 574, s.recording ? "#f595a3" : "#8297a9", 13);
  } else if (id === "loop-soup") {
    for (let i = 0; i < 3; i++) {
      const c = soupCenters[i];
      waveformRing(ctx, c, 96, s.waves?.[i], COLORS[i], selected === i);
      const bead = polar(c.x, c.y, 96, s.phases?.[i] || 0);
      circle(ctx, bead.x, bead.y, 9, "#fcf2dc", COLORS[i], 2);
      text(ctx, ["BROTH", "SPICE", "STOCK"][i], c.x, c.y, COLORS[i], 16);
      text(ctx, s.modes?.[i]?.toUpperCase() || "OVERDUB", c.x, c.y + 25, "#aab2c0", 11);
      const next = soupCenters[(i + 1) % 3];
      if (s.params.spill > 0) {
        ctx.beginPath(); ctx.moveTo(c.x, c.y + 112);
        ctx.quadraticCurveTo((c.x + next.x) / 2, 543, next.x, next.y + 113);
        ctx.strokeStyle = COLORS[i] + "65"; ctx.lineWidth = 1 + s.params.spill * 7; ctx.stroke();
        arrow(ctx, { x: next.x, y: next.y + 113 },
          Math.atan2(next.y + 113 - 543, next.x - (c.x + next.x) / 2), COLORS[i]);
      }
      text(ctx, `${Math.round((s.energy?.[i] || 0) * 100)}% density`, c.x, 478, "#8a9eac", 12);
    }
    text(ctx, brush ? "ERASE BRUSH · drag around a tape" : "HOLD keeps the tape. OVERDUB changes it.", 450, 566, brush ? "#f49db6" : "#8a9eac", 13);
  } else if (id === "habit-habitat") {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        const weight = s.weights?.[i]?.[j] || 0;
        if (weight < 0.3) continue;
        const a = habitNodes[i], b = habitNodes[j];
        const active = s.previousNode === i && s.head === j;
        line(ctx, a, b, active ? "#f6e2b9" : COLORS[i] + "70", 1 + weight * 0.65);
        const t = 0.73, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        line(ctx, { x, y }, { x: x - 10 * Math.cos(angle - 0.5), y: y - 10 * Math.sin(angle - 0.5) }, COLORS[i], 3);
        line(ctx, { x, y }, { x: x - 10 * Math.cos(angle + 0.5), y: y - 10 * Math.sin(angle + 0.5) }, COLORS[i], 3);
      }
    }
    habitNodes.forEach((p, i) => {
      circle(ctx, p.x, p.y, 31 + (s.flash?.[i] || 0) * 17, COLORS[i] + "20");
      circle(ctx, p.x, p.y, 27, "#13212c", COLORS[i], selected === i ? 4 : 2);
      text(ctx, i + 1, p.x, p.y + 7, COLORS[i], 21);
    });
    text(ctx, s.mode === "teach" ? "TEACH" : "RECALL", 450, 303, "#dfe7d7", 24);
    text(ctx, s.mode === "teach" ? "your gestures leave a trace" : "playback never teaches itself", 450, 327, "#99a6b9", 11);
    text(ctx, brush ? "tap a bright path to weaken it" : "1—6 · play a node", 450, 573, "#aacaef", 13);
  } else if (id === "hollowphonic") {
    const centers = [220, 450, 680];
    for (let i = 0; i < 3; i++) {
      const depth = clamp(s.params.depth + (s.offsets?.[i] || 0));
      const top = 200 - 70 * depth, height = 150 + 150 * depth, x = centers[i];
      const intensity = clamp((s.energy?.[i] || 0) * 8);
      ctx.fillStyle = "#17202e"; ctx.strokeStyle = COLORS[i]; ctx.lineWidth = selected === i ? 4 : 2;
      ctx.beginPath(); ctx.roundRect(x - 72, top, 144, height, [12, 12, 63, 63]); ctx.fill(); ctx.stroke();
      for (let j = 0; j < 7; j++) {
        const y = top + 30 + j / 7 * (height - 45);
        ctx.beginPath();
        for (let k = 0; k <= 40; k++) {
          const xx = x - 53 + k / 40 * 106;
          const yy = y + Math.sin(k / 40 * TAU + (s.time || 0) * 5 + j) * intensity * 12;
          if (!k) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.strokeStyle = COLORS[i] + (intensity > 0.1 ? "bb" : "28"); ctx.lineWidth = 1.5; ctx.stroke();
      }
      circle(ctx, x, top, 14, "#edf1df", COLORS[i], 2);
      text(ctx, `${Math.round(s.frequencies?.[i] || 0)} Hz`, x, 506, COLORS[i], 16);
      if (i < 2) line(ctx, { x: x + 73, y: 300 }, { x: centers[i + 1] - 73, y: 300 }, "#cebbdf", 2 + s.params.coupling * 10);
    }
    text(ctx, s.bypass ? "BYPASS · unfiltered source" : "deeper chambers · lower resonances", 450, 567, "#bdadd0", 13);
  }
}
