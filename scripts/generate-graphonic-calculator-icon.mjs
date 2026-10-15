// Original, deterministic Canvas artwork; no external image inputs.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const palette = {
  backgroundTop: "#0d1a22",
  backgroundBottom: "#07090b",
  minorGrid: "#17262d",
  majorGrid: "#223640",
  axis: "#3c5661",
  sine: "#61e9ce",
  parabola: "#f6b57c",
  circle: "#c9a6ff",
  traceCore: "#f3fffb",
};

const drawIcon = (colors) => {
  const size = 512;
  const center = size / 2;
  const unit = 48;
  const minorStep = unit / 2;
  const majorStep = minorStep * 5;
  const axisInset = 18.5;
  const axisEndHalfLength = 8;
  const toPixelX = (x) => center + x * unit;
  const toPixelY = (y) => center - y * unit;
  const sine = (x) => 1.5 * Math.sin(1.15 * x - 0.9);
  const parabola = (x) => 0.71 * x * x - 3.5;
  const circle = { x: 0, y: 0, radius: 2.5 };

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, size, size);
  background.addColorStop(0, colors.backgroundTop);
  background.addColorStop(1, colors.backgroundBottom);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  const drawGridLines = (step, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let position = center % step; position < size; position += step) {
      const aligned = Math.round(position) + 0.5;
      ctx.moveTo(aligned, 0);
      ctx.lineTo(aligned, size);
      ctx.moveTo(0, aligned);
      ctx.lineTo(size, aligned);
    }
    ctx.stroke();
  };
  drawGridLines(minorStep, colors.minorGrid);
  drawGridLines(majorStep, colors.majorGrid);

  const axisLine = center + 0.5;
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(axisInset, axisLine);
  ctx.lineTo(size - axisInset, axisLine);
  ctx.moveTo(axisLine, axisInset);
  ctx.lineTo(axisLine, size - axisInset);
  for (const end of [axisInset, size - axisInset]) {
    ctx.moveTo(end, axisLine - axisEndHalfLength);
    ctx.lineTo(end, axisLine + axisEndHalfLength);
    ctx.moveTo(axisLine - axisEndHalfLength, end);
    ctx.lineTo(axisLine + axisEndHalfLength, end);
  }
  ctx.stroke();

  const vignette = ctx.createRadialGradient(center, center, size * 0.3, center, center, size * 0.78);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.32)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  const strokeGlowing = (color, width, tracePath) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = width * 3.4;
    ctx.beginPath();
    tracePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = width;
    ctx.beginPath();
    tracePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const traceFunction = (fn) => {
    const overshoot = 12;
    for (let px = -overshoot; px <= size + overshoot; px += 1) {
      const py = toPixelY(fn((px - center) / unit));
      if (px === -overshoot) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  };

  strokeGlowing(colors.parabola, 6, () => traceFunction(parabola));
  strokeGlowing(colors.circle, 6, () => {
    ctx.arc(toPixelX(circle.x), toPixelY(circle.y), circle.radius * unit, 0, Math.PI * 2);
  });
  strokeGlowing(colors.sine, 7, () => traceFunction(sine));

  const findCrossing = (lower, upper) => {
    const difference = (x) => sine(x) - parabola(x);
    let low = lower;
    let high = upper;
    for (let iteration = 0; iteration < 64; iteration++) {
      const mid = (low + high) / 2;
      if (Math.sign(difference(mid)) === Math.sign(difference(low))) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  };
  const traceX = findCrossing(2.2, 3.2);
  const tracePixelX = toPixelX(traceX);
  const tracePixelY = toPixelY(sine(traceX));

  ctx.strokeStyle = colors.sine;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(tracePixelX, 0);
  ctx.lineTo(tracePixelX, size);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.shadowColor = colors.sine;
  ctx.shadowBlur = 26;
  ctx.fillStyle = colors.sine;
  ctx.beginPath();
  ctx.arc(tracePixelX, tracePixelY, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = colors.traceCore;
  ctx.beginPath();
  ctx.arc(tracePixelX, tracePixelY, 7, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toDataURL("image/webp", 0.94).split(",")[1];
};

const browser = await chromium.launch({ channel: "chromium" });
try {
  const page = await browser.newPage();
  const encoded = await page.evaluate(drawIcon, palette);
  await writeFile(
    new URL("../assets/instruments/graphonic-calculator.webp", import.meta.url),
    Buffer.from(encoded, "base64"),
  );
} finally {
  await browser.close();
}
