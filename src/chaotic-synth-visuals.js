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

export function normalizeChaoticWaveformSample(waveform, index) {
  if (!waveform || index < 0 || index >= waveform.length) return 0;
  const sample = finiteNumber(waveform[index], 0);
  if (waveform instanceof Uint8Array) return clamp(sample / 128 - 1, -1, 1);
  return clamp(sample, -1, 1);
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

  context.beginPath();
  if (waveform?.length) {
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
    context.strokeStyle = stroke;
    context.shadowColor = glow;
    context.shadowBlur = 8;
  } else {
    context.moveTo(left, center);
    context.lineTo(right, center);
    context.strokeStyle = "rgba(119, 131, 126, 0.48)";
  }
  context.lineWidth = 1.25;
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
