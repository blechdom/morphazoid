import { createSignalMonitor } from "../src/ui/index.js";
import {
  chaoticLiveVisualRegions,
  chaoticVisualRegions,
  drawChaoticScope,
  drawChaoticSpectrum,
} from "../src/chaotic-synth-visuals.js";
import "./catalog.css";

function waveform(length = 512) {
  return Float32Array.from({ length }, (_, index) => {
    const phase = index / Math.max(1, length - 1) * Math.PI * 8;
    return Math.sin(phase) * 0.62 + Math.sin(phase * 2.13 + 0.7) * 0.18;
  });
}

function spectrumState(length = 1024) {
  const displayData = Float32Array.from({ length }, (_, index) => {
    const x = index / length;
    const peaks = Math.max(
      Math.exp(-((x - 0.015) ** 2) / 0.00004),
      0.78 * Math.exp(-((x - 0.048) ** 2) / 0.00018),
      0.54 * Math.exp(-((x - 0.14) ** 2) / 0.0012),
    );
    return -88 + peaks * 73;
  });
  return { displayData, frames: 1, minimumDecibels: -90, maximumDecibels: 0, sampleRate: 48_000 };
}

function baseMonitor(options) {
  return createSignalMonitor({
    width: 760,
    height: 360,
    kicker: "Signal analysis",
    title: "Live monitor",
    subtitle: "Rendering is supplied by the instrument; the shell owns labels, axes, legend, and accessibility.",
    meta: "FFT 2048 · AUDIO OFF",
    ...options,
  });
}

function renderOverlay() {
  const monitor = baseMonitor({
    variant: "overlay",
    title: "Spectrum + Oscilloscope",
    ariaLabel: "Deterministic logarithmic spectrum with a foreground waveform",
    legend: [
      { label: "Spectrum", color: "#ff7aa6" },
      { label: "Waveform", color: "#5fe8c4" },
    ],
  });
  monitor.draw((context, canvas) => {
    context.fillStyle = "#07090b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const regions = chaoticLiveVisualRegions(canvas.width, canvas.height);
    drawChaoticSpectrum(context, spectrumState(), regions, {
      barFill: "rgba(255, 122, 166, 0.3)",
      barCap: "rgba(255, 184, 107, 0.72)",
    });
    drawChaoticScope(context, waveform(), regions, {
      foreground: true,
      stroke: "#5fe8c4",
      glow: "rgba(95, 232, 196, 0.4)",
      lineWidth: 1.8,
    });
  });
  return monitor;
}

function renderScope() {
  const monitor = baseMonitor({
    variant: "scope",
    title: "Oscilloscope",
    meta: "TIME DOMAIN · 512 SAMPLES",
    xAxis: ["−1.0", "−0.5", "0", "+0.5", "+1.0"],
    yAxis: ["+1", "0", "−1"],
    ariaLabel: "Deterministic time-domain waveform",
  });
  monitor.draw((context, canvas) => {
    context.fillStyle = "#07090b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const regions = { left: 38, right: canvas.width - 28, scopeTop: 56, scopeBottom: canvas.height - 68 };
    drawChaoticScope(context, waveform(), regions, { stroke: "#c79bff", glow: "rgba(199, 155, 255, 0.38)", lineWidth: 1.8 });
  });
  return monitor;
}

function renderSpectrogram() {
  const monitor = baseMonitor({
    variant: "spectrogram",
    title: "Spectrogram",
    meta: "LOG FREQUENCY · 4.0 S HISTORY",
    xAxis: ["−4 s", "−3", "−2", "−1", "now"],
    yAxis: ["20k", "2k", "200", "20 Hz"],
    ariaLabel: "Deterministic scrolling frequency-history fixture",
  });
  monitor.draw((context, canvas) => {
    context.fillStyle = "#07090b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const regions = chaoticVisualRegions(canvas.width, canvas.height);
    const left = 38;
    const top = 54;
    const width = canvas.width - 66;
    const height = canvas.height - 122;
    for (let x = 0; x < width; x += 3) {
      for (let y = 0; y < height; y += 3) {
        const energy = Math.max(0, Math.sin(x * 0.037 + y * 0.051) * 0.5 + Math.sin(x * 0.012 - y * 0.09) * 0.35);
        context.fillStyle = `hsla(${255 + y / height * 70} 76% ${8 + energy * 54}% / 0.86)`;
        context.fillRect(left + x, top + y, 3, 3);
      }
    }
    context.strokeStyle = "rgba(214,232,226,.12)";
    context.strokeRect(left, top, width, height);
    drawChaoticScope(context, waveform(256), { ...regions, scopeTop: top + 4, scopeBottom: top + height * 0.38 }, { stroke: "#5fe8c4", glow: "rgba(95,232,196,.3)" });
  });
  return monitor;
}

function renderXY() {
  const monitor = baseMonitor({
    variant: "xy",
    kicker: "X / Y plot",
    title: "Lissajous Orbit",
    subtitle: "A generic two-axis plot frame; pointer semantics and parameter mapping stay with the instrument.",
    meta: "X 3× · Y 2× · PHASE 0.25π",
    xAxis: ["−1 X", "0", "+1 X"],
    yAxis: ["+1 Y", "0", "−1 Y"],
    ariaLabel: "Deterministic three-to-two Lissajous curve on an X and Y grid",
  });
  monitor.draw((context, canvas) => {
    context.fillStyle = "#07090b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const left = 52;
    const right = canvas.width - 38;
    const top = 50;
    const bottom = canvas.height - 64;
    context.strokeStyle = "rgba(214,232,226,.1)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo((left + right) / 2, top);
    context.lineTo((left + right) / 2, bottom);
    context.moveTo(left, (top + bottom) / 2);
    context.lineTo(right, (top + bottom) / 2);
    context.stroke();
    context.beginPath();
    for (let index = 0; index <= 720; index += 1) {
      const phase = index / 720 * Math.PI * 2;
      const x = (left + right) / 2 + Math.sin(phase * 3 + Math.PI * 0.25) * (right - left) * 0.42;
      const y = (top + bottom) / 2 - Math.sin(phase * 2) * (bottom - top) * 0.42;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = "#5fe8c4";
    context.shadowColor = "rgba(95,232,196,.45)";
    context.shadowBlur = 9;
    context.lineWidth = 1.6;
    context.stroke();
  });
  return monitor;
}

export default {
  title: "Patterns/Signal Monitor",
  component: createSignalMonitor,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    controls: { disable: true },
    docs: { description: { component: "An accessible, frontend-only canvas shell for oscilloscopes, spectra, spectrograms, overlays, and X/Y plots. Production renderers and audio analyzers remain external." } },
  },
};

export const SpectrumAndScope = { render: renderOverlay };
export const Oscilloscope = { render: renderScope };
export const Spectrogram = { render: renderSpectrogram };
export const XYPlot = { render: renderXY };
