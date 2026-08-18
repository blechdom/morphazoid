const DEFAULT_HISTORY_WIDTH = 320;
const DEFAULT_HISTORY_HEIGHT = 72;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function chaoticVisualRegions(width, height) {
  const safeWidth = Math.max(1, finiteNumber(width, 1));
  const safeHeight = Math.max(1, finiteNumber(height, 1));
  const left = Math.max(24, safeWidth * 0.045);
  const right = safeWidth - left;
  const scopeTop = Math.max(
    108,
    Math.min(safeHeight * 0.23, safeHeight - 220),
  );
  const scopeBottom = Math.max(
    scopeTop + 56,
    Math.min(safeHeight * 0.43, safeHeight - 155),
  );
  const spectrogramTop = scopeBottom + 10;
  const spectrogramBottom = Math.max(
    spectrogramTop + 32,
    Math.min(safeHeight * 0.58, safeHeight - 100),
  );
  return Object.freeze({
    left,
    right,
    scopeTop,
    scopeBottom,
    spectrogramTop,
    spectrogramBottom,
  });
}

export function chaoticLiveVisualRegions(width, height) {
  const safeWidth = Math.max(1, finiteNumber(width, 1));
  const safeHeight = Math.max(1, finiteNumber(height, 1));
  const left = Math.max(38, safeWidth * 0.055);
  const right = safeWidth - Math.max(24, safeWidth * 0.045);
  // Reserve the opening band for the title and explanatory subtitle. The
  // analyzer still grows with the stage, but never rises into that copy.
  const analysisTop = Math.max(
    145,
    Math.min(safeHeight * 0.31, safeHeight - 235),
  );
  const analysisBottom = Math.max(
    analysisTop + 120,
    Math.min(safeHeight * 0.56, safeHeight - 92),
  );
  return Object.freeze({
    left,
    right,
    spectrumTop: analysisTop,
    spectrumBottom: analysisBottom,
    scopeTop: analysisTop,
    scopeBottom: analysisBottom,
  });
}

export function normalizeChaoticWaveformSample(waveform, index) {
  if (!waveform || index < 0 || index >= waveform.length) return 0;
  const sample = finiteNumber(waveform[index], 0);
  if (waveform instanceof Uint8Array) return clamp(sample / 128 - 1, -1, 1);
  return clamp(sample, -1, 1);
}

export function createChaoticSpectrum() {
  return {
    frequencyData: null,
    displayData: null,
    frames: 0,
    minimumDecibels: -90,
    maximumDecibels: 0,
    sampleRate: 48_000,
  };
}

export function chaoticSpectrumBin(
  frequency,
  binCount,
  sampleRate = 48_000,
) {
  const count = Math.max(1, Math.round(finiteNumber(binCount, 1)));
  const nyquist = Math.max(1, finiteNumber(sampleRate, 48_000) * 0.5);
  return clamp(
    Math.round(clamp(finiteNumber(frequency, 0), 0, nyquist) / nyquist * count),
    0,
    count - 1,
  );
}

export function updateChaoticSpectrum(
  state,
  analyser,
  { releaseDecibelsPerFrame = 4 } = {},
) {
  const binCount = Number(analyser?.frequencyBinCount) || 0;
  if (!state || binCount <= 0) return false;
  if (!state.frequencyData || state.frequencyData.length !== binCount) {
    state.frequencyData = new Float32Array(binCount);
    state.displayData = new Float32Array(binCount);
    state.displayData.fill(-90);
  }
  analyser.getFloatFrequencyData(state.frequencyData);
  state.minimumDecibels = finiteNumber(analyser.minDecibels, -90);
  state.maximumDecibels = finiteNumber(analyser.maxDecibels, 0);
  state.sampleRate = finiteNumber(analyser.context?.sampleRate, 48_000);
  const release = clamp(finiteNumber(releaseDecibelsPerFrame, 4), 0, 90);
  for (let index = 0; index < binCount; index += 1) {
    const next = clamp(
      finiteNumber(state.frequencyData[index], state.minimumDecibels),
      state.minimumDecibels,
      state.maximumDecibels,
    );
    state.displayData[index] = next >= state.displayData[index]
      ? next
      : Math.max(next, state.displayData[index] - release);
  }
  state.frames += 1;
  return true;
}

function formatSpectrumFrequency(frequency) {
  if (frequency >= 1_000) return `${frequency / 1_000}k`;
  return String(frequency);
}

export function drawChaoticSpectrum(
  context,
  state,
  regions,
  {
    barFill = "rgba(255, 122, 166, 0.3)",
    barCap = "rgba(255, 184, 107, 0.72)",
  } = {},
) {
  if (!context || !regions) return;
  const {
    left,
    right,
    spectrumTop: top,
    spectrumBottom: bottom,
  } = regions;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const minimumFrequency = 20;
  const maximumFrequency = Math.min(
    20_000,
    Math.max(minimumFrequency, finiteNumber(state?.sampleRate, 48_000) * 0.5),
  );
  const minimumDecibels = finiteNumber(state?.minimumDecibels, -90);
  const maximumDecibels = finiteNumber(state?.maximumDecibels, 0);
  const logRange = Math.log(maximumFrequency / minimumFrequency);

  context.save();
  context.fillStyle = "rgba(7, 9, 11, 0.6)";
  context.fillRect(left, top, width, height);
  context.font = "7px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "middle";

  for (const decibels of [-90, -60, -30, 0]) {
    const y = bottom - (
      (decibels - minimumDecibels) / (maximumDecibels - minimumDecibels)
    ) * height;
    context.strokeStyle = "rgba(214, 232, 226, 0.09)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.fillStyle = "rgba(119, 131, 126, 0.78)";
    context.textAlign = "right";
    context.fillText(`${decibels}`, left - 5, y);
  }

  for (const frequency of [20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000]) {
    if (frequency > maximumFrequency) continue;
    const x = left + Math.log(frequency / minimumFrequency) / logRange * width;
    context.strokeStyle = "rgba(214, 232, 226, 0.065)";
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
    context.fillStyle = "rgba(119, 131, 126, 0.72)";
    context.textAlign = frequency === minimumFrequency
      ? "left"
      : (frequency === maximumFrequency ? "right" : "center");
    context.fillText(formatSpectrumFrequency(frequency), x, bottom + 10);
  }

  const hasSpectrum = Boolean(state?.displayData?.length && state.frames > 0);
  const barCount = Math.round(clamp(Math.floor(width / 11), 32, 80));
  const gap = width < 520 ? 1 : 2;
  const barWidth = Math.max(1, (width - gap * (barCount - 1)) / barCount);
  if (hasSpectrum) {
    for (let bar = 0; bar < barCount; bar += 1) {
      const low = bar / barCount;
      const high = (bar + 1) / barCount;
      const lowFrequency = minimumFrequency * Math.exp(logRange * low);
      const highFrequency = minimumFrequency * Math.exp(logRange * high);
      const firstBin = chaoticSpectrumBin(
        lowFrequency,
        state.displayData.length,
        state.sampleRate,
      );
      const lastBin = chaoticSpectrumBin(
        highFrequency,
        state.displayData.length,
        state.sampleRate,
      );
      let decibels = minimumDecibels;
      for (let bin = firstBin; bin <= lastBin; bin += 1) {
        decibels = Math.max(
          decibels,
          finiteNumber(state.displayData[bin], minimumDecibels),
        );
      }
      const level = clamp(
        (decibels - minimumDecibels) / (maximumDecibels - minimumDecibels),
        0,
        1,
      );
      if (level <= 0) continue;
      const barHeight = Math.max(1, level * height);
      const x = left + bar * (barWidth + gap);
      const y = bottom - barHeight;
      context.fillStyle = barFill;
      context.fillRect(x, y, barWidth, barHeight);
      context.fillStyle = barCap;
      context.fillRect(x, y, barWidth, Math.min(2, barHeight));
    }
  }

  context.strokeStyle = "rgba(214, 232, 226, 0.13)";
  context.strokeRect(left, top, width, height);
  context.fillStyle = "rgba(255, 122, 166, 0.8)";
  context.textAlign = "left";
  context.fillText("LIVE SPECTRUM · HZ / WAVEFORM OVERLAY", left, top - 9);
  context.restore();
}

export function createChaoticSpectrogram(
  documentObject = globalThis.document,
  {
    width = DEFAULT_HISTORY_WIDTH,
    height = DEFAULT_HISTORY_HEIGHT,
  } = {},
) {
  const canvas = documentObject?.createElement?.("canvas") ?? null;
  const context = canvas?.getContext?.("2d", {
    alpha: false,
    desynchronized: true,
  }) ?? null;
  if (canvas) {
    canvas.width = Math.max(8, Math.round(finiteNumber(width, DEFAULT_HISTORY_WIDTH)));
    canvas.height = Math.max(8, Math.round(finiteNumber(height, DEFAULT_HISTORY_HEIGHT)));
  }
  if (context) {
    context.fillStyle = "#07090b";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  return {
    canvas,
    context,
    frequencyData: null,
    frames: 0,
  };
}

export function updateChaoticSpectrogram(
  state,
  analyser,
  { hue = 285 } = {},
) {
  const canvas = state?.canvas;
  const context = state?.context;
  const binCount = Number(analyser?.frequencyBinCount) || 0;
  if (!canvas || !context || binCount <= 0) return false;
  if (!state.frequencyData || state.frequencyData.length !== binCount) {
    state.frequencyData = new Uint8Array(binCount);
  }
  analyser.getByteFrequencyData(state.frequencyData);

  const width = canvas.width;
  const height = canvas.height;
  context.drawImage(canvas, 1, 0, width - 1, height, 0, 0, width - 1, height);
  context.fillStyle = "#07090b";
  context.fillRect(width - 1, 0, 1, height);

  const nyquist = Math.max(40, finiteNumber(analyser.context?.sampleRate, 48_000) / 2);
  const minimumFrequency = 20;
  for (let y = 0; y < height; y += 1) {
    const vertical = 1 - y / Math.max(1, height - 1);
    const frequency = minimumFrequency * (
      (nyquist / minimumFrequency) ** vertical
    );
    const bin = Math.min(
      binCount - 1,
      Math.max(0, Math.round(frequency / nyquist * (binCount - 1))),
    );
    const magnitude = state.frequencyData[bin] / 255;
    const lightness = 5 + magnitude ** 0.72 * 67;
    context.fillStyle = `hsl(${finiteNumber(hue, 285)} 78% ${lightness}%)`;
    context.fillRect(width - 1, y, 1, 1);
  }
  state.frames += 1;
  return true;
}

export function drawChaoticScope(
  context,
  waveform,
  regions,
  {
    stroke = "#c79bff",
    glow = "rgba(199, 155, 255, 0.38)",
    foreground = false,
    lineWidth = 1.25,
  } = {},
) {
  if (!context || !regions) return;
  const {
    left,
    right,
    scopeTop: top,
    scopeBottom: bottom,
  } = regions;
  const center = (top + bottom) * 0.5;

  context.save();
  context.strokeStyle = "rgba(214, 232, 226, 0.08)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, center);
  context.lineTo(right, center);
  context.stroke();

  const hasWaveform = Boolean(waveform?.length);
  context.beginPath();
  if (hasWaveform) {
    const slice = (right - left) / Math.max(1, waveform.length - 1);
    for (let index = 0; index < waveform.length; index += 1) {
      const x = left + index * slice;
      const y = center - normalizeChaoticWaveformSample(
        waveform,
        index,
      ) * (bottom - top) * 0.46;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  } else {
    context.moveTo(left, center);
    context.lineTo(right, center);
  }
  if (hasWaveform && foreground) {
    context.strokeStyle = "rgba(7, 9, 11, 0.88)";
    context.shadowBlur = 0;
    context.lineWidth = lineWidth + 3;
    context.stroke();
  }
  context.strokeStyle = hasWaveform ? stroke : "rgba(119, 131, 126, 0.48)";
  context.shadowColor = glow;
  context.shadowBlur = hasWaveform ? (foreground ? 12 : 8) : 0;
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

export function drawChaoticSpectrogram(context, state, regions) {
  if (!context || !regions) return;
  const {
    left,
    right,
    spectrogramTop: top,
    spectrogramBottom: bottom,
  } = regions;
  context.save();
  context.fillStyle = "rgba(7, 9, 11, 0.72)";
  context.fillRect(left, top, right - left, bottom - top);
  if (state?.canvas && state.frames > 0) {
    context.globalAlpha = 0.78;
    context.imageSmoothingEnabled = true;
    context.drawImage(state.canvas, left, top, right - left, bottom - top);
  }
  context.globalAlpha = 1;
  context.strokeStyle = "rgba(214, 232, 226, 0.1)";
  context.lineWidth = 1;
  context.strokeRect(left, top, right - left, bottom - top);
  context.restore();
}

export function drawChaoticAnalysis(
  context,
  {
    analyser,
    audioOn = false,
    glow,
    height,
    hue,
    spectrogram,
    stroke,
    waveform,
    width,
  },
) {
  const regions = chaoticVisualRegions(width, height);
  if (audioOn) updateChaoticSpectrogram(spectrogram, analyser, { hue });
  drawChaoticScope(context, audioOn ? waveform : null, regions, {
    stroke,
    glow,
  });
  drawChaoticSpectrogram(context, spectrogram, regions);
  return regions;
}

export function drawChaoticLiveAnalysis(
  context,
  {
    analyser,
    audioOn = false,
    glow,
    height,
    stroke,
    scopeGlow = glow,
    scopeStroke = stroke,
    spectrumBarCap,
    spectrumBarFill,
    spectrum,
    waveform,
    width,
  },
) {
  const regions = chaoticLiveVisualRegions(width, height);
  if (audioOn) updateChaoticSpectrum(spectrum, analyser);
  drawChaoticSpectrum(context, spectrum, regions, {
    barCap: spectrumBarCap,
    barFill: spectrumBarFill,
  });
  drawChaoticScope(context, audioOn ? waveform : null, regions, {
    foreground: true,
    glow: scopeGlow,
    lineWidth: 1.8,
    stroke: scopeStroke,
  });
  return regions;
}
