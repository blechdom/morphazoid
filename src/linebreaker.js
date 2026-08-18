const TAU = Math.PI * 2;

export const LINEBREAKER_PRESETS = Object.freeze([
  Object.freeze({
    id: "crossed-lines",
    label: "Crossed lines",
    description: "Two complete one-pixel rails cross the finite square.",
  }),
  Object.freeze({
    id: "sierpinski-carpet",
    label: "Sierpiński carpet",
    description: "Ordinary holes repeat at every scale, while complete rows and columns remain.",
  }),
  Object.freeze({
    id: "cantor-dust",
    label: "Cantor dust",
    description: "Both coordinates omit the middle third, breaking every sampled rail across scales.",
  }),
]);

const PRESET_ALIASES = Object.freeze({
  cross: "crossed-lines",
  crossed: "crossed-lines",
  lines: "crossed-lines",
  carpet: "sierpinski-carpet",
  sierpinski: "sierpinski-carpet",
  dust: "cantor-dust",
  cantor: "cantor-dust",
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizePresetId(id) {
  const candidate = String(id ?? "").toLowerCase();
  const normalized = PRESET_ALIASES[candidate] ?? candidate;
  return LINEBREAKER_PRESETS.some((preset) => preset.id === normalized)
    ? normalized
    : LINEBREAKER_PRESETS[0].id;
}

export function ternaryDigits(index, depth) {
  let value = Math.max(0, finiteInteger(index, 0));
  const digits = [];
  for (let level = 0; level < Math.max(0, finiteInteger(depth, 0)); level += 1) {
    digits.push(value % 3);
    value = Math.floor(value / 3);
  }
  return digits;
}

export function isCantorCoordinate(index, depth) {
  return ternaryDigits(index, depth).every((digit) => digit !== 1);
}

export function makeLinebreakerMask(presetId = "crossed-lines", depth = 3) {
  const preset = normalizePresetId(presetId);
  const safeDepth = clamp(finiteInteger(depth, 3), 1, 4);
  const size = 3 ** safeDepth;
  const data = new Uint8Array(size * size);
  const center = Math.floor(size / 2);
  let occupiedCount = 0;

  for (let y = 0; y < size; y += 1) {
    const yDigits = ternaryDigits(y, safeDepth);
    const cantorY = yDigits.every((digit) => digit !== 1);
    for (let x = 0; x < size; x += 1) {
      const xDigits = ternaryDigits(x, safeDepth);
      let occupied = false;
      if (preset === "crossed-lines") {
        occupied = x === center || y === center;
      } else if (preset === "sierpinski-carpet") {
        occupied = xDigits.every((digit, level) => !(digit === 1 && yDigits[level] === 1));
      } else {
        occupied = cantorY && xDigits.every((digit) => digit !== 1);
      }
      if (occupied) {
        data[y * size + x] = 1;
        occupiedCount += 1;
      }
    }
  }

  return Object.freeze({
    preset,
    depth: safeDepth,
    size,
    data,
    occupiedCount,
    density: occupiedCount / (size * size),
  });
}

function unpackMask(maskOrData, explicitSize) {
  const source = maskOrData?.data ?? maskOrData;
  const inferredSize = maskOrData?.size ?? explicitSize ?? Math.sqrt(source?.length ?? 0);
  const size = finiteInteger(inferredSize, 0);
  if (!source || size < 1 || source.length !== size * size) {
    throw new RangeError("A square mask and its size are required.");
  }
  return { data: source, size };
}

function lineSquareInterval(angle, offset) {
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -direction.y, y: direction.x };
  const origin = { x: normal.x * offset, y: normal.y * offset };
  let minimum = -Infinity;
  let maximum = Infinity;

  for (const axis of ["x", "y"]) {
    const position = origin[axis];
    const velocity = direction[axis];
    if (Math.abs(velocity) < 1e-12) {
      if (position < -0.5 || position > 0.5) return null;
      continue;
    }
    const first = (-0.5 - position) / velocity;
    const second = (0.5 - position) / velocity;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum) return null;
  }

  return { minimum, maximum, direction, normal, origin };
}

function occupiedNear(data, size, x, y, widthPixels) {
  const cellX = clamp(Math.floor((x + 0.5) * size), 0, size - 1);
  const cellY = clamp(Math.floor((y + 0.5) * size), 0, size - 1);
  const radius = Math.max(0, Math.ceil((widthPixels - 1) / 2));
  for (let dy = -radius; dy <= radius; dy += 1) {
    const sampleY = cellY + dy;
    if (sampleY < 0 || sampleY >= size) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const sampleX = cellX + dx;
      if (sampleX < 0 || sampleX >= size) continue;
      if (data[sampleY * size + sampleX]) return true;
    }
  }
  return false;
}

function oddProbeWidth(widthPixels, size) {
  let width = clamp(Math.round(Number(widthPixels) || 1), 1, Math.max(1, size));
  if (width % 2 === 0) width += width < size ? 1 : -1;
  return Math.max(1, width);
}

function runStatistics(samples) {
  let occupiedSamples = 0;
  let longestOccupiedRun = 0;
  let longestClearRun = 0;
  let occupiedRun = 0;
  let clearRun = 0;
  let clearGapCount = 0;
  let insideClearGap = false;

  for (const sample of samples) {
    if (sample.occupied) {
      occupiedSamples += 1;
      occupiedRun += 1;
      clearRun = 0;
      insideClearGap = false;
      longestOccupiedRun = Math.max(longestOccupiedRun, occupiedRun);
    } else {
      clearRun += 1;
      occupiedRun = 0;
      longestClearRun = Math.max(longestClearRun, clearRun);
      if (!insideClearGap) {
        clearGapCount += 1;
        insideClearGap = true;
      }
    }
  }

  return {
    occupiedSamples,
    occupancy: samples.length ? occupiedSamples / samples.length : 0,
    longestOccupiedRun,
    longestOccupiedFraction: samples.length ? longestOccupiedRun / samples.length : 0,
    longestClearRun,
    longestClearFraction: samples.length ? longestClearRun / samples.length : 0,
    clearGapCount,
  };
}

export function probeLine(maskOrData, options = {}) {
  const { data, size } = unpackMask(maskOrData, options.size);
  const angleDegrees = Number.isFinite(Number(options.angleDegrees))
    ? Number(options.angleDegrees)
    : 0;
  const angle = angleDegrees * Math.PI / 180;
  const offset = clamp(Number(options.offset) || 0, -0.7, 0.7);
  const widthPixels = oddProbeWidth(options.widthPixels, size);
  const interval = lineSquareInterval(angle, offset);
  if (!interval) {
    return Object.freeze({
      valid: false,
      angleDegrees,
      offset,
      widthPixels,
      samples: Object.freeze([]),
      sampleCount: 0,
      occupiedSamples: 0,
      occupancy: 0,
      longestOccupiedRun: 0,
      longestOccupiedFraction: 0,
      longestClearRun: 0,
      longestClearFraction: 0,
      clearGapCount: 0,
    });
  }

  const sampleCount = clamp(
    finiteInteger(options.sampleCount, Math.max(96, size * 4)),
    2,
    2048,
  );
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = sampleCount === 1 ? 0.5 : index / (sampleCount - 1);
    const time = interval.minimum + (interval.maximum - interval.minimum) * progress;
    const x = interval.origin.x + interval.direction.x * time;
    const y = interval.origin.y + interval.direction.y * time;
    samples.push(Object.freeze({
      x,
      y,
      occupied: occupiedNear(data, size, x, y, widthPixels),
    }));
  }
  const statistics = runStatistics(samples);
  return Object.freeze({
    valid: true,
    angleDegrees,
    offset,
    widthPixels,
    samples: Object.freeze(samples),
    sampleCount,
    ...statistics,
  });
}

export function findClearLine(maskOrData, options = {}) {
  const { data, size } = unpackMask(maskOrData, options.size);
  const angleSteps = clamp(finiteInteger(options.angleSteps, 36), 2, 180);
  const offsetSteps = clamp(finiteInteger(options.offsetSteps, size), 3, 121);
  const widthPixels = oddProbeWidth(options.widthPixels, size);
  let best = null;

  for (let angleIndex = 0; angleIndex < angleSteps; angleIndex += 1) {
    const angleDegrees = angleIndex * 180 / angleSteps;
    for (let offsetIndex = 0; offsetIndex < offsetSteps; offsetIndex += 1) {
      const offset = -0.5 + (offsetIndex + 0.5) / offsetSteps;
      const result = probeLine(data, {
        size,
        angleDegrees,
        offset,
        widthPixels,
        sampleCount: options.sampleCount ?? Math.max(96, size * 4),
      });
      if (!result.valid) continue;
      const score = result.longestOccupiedFraction * 2 + result.occupancy;
      const bestScore = best
        ? best.longestOccupiedFraction * 2 + best.occupancy
        : -Infinity;
      if (
        score > bestScore + 1e-12
        || (Math.abs(score - bestScore) <= 1e-12
          && Math.abs(result.offset) < Math.abs(best.offset))
      ) best = result;
    }
  }

  return best;
}

export function energy2D(real, imaginary = null) {
  if (!real) return 0;
  let total = 0;
  for (let index = 0; index < real.length; index += 1) {
    const imag = imaginary?.[index] ?? 0;
    total += Number(real[index]) ** 2 + Number(imag) ** 2;
  }
  return total;
}

const matrixCache = new Map();

function unitaryMatrix(size, inverse) {
  const key = `${size}:${inverse ? "inverse" : "forward"}`;
  const cached = matrixCache.get(key);
  if (cached) return cached;
  const real = new Float64Array(size * size);
  const imaginary = new Float64Array(size * size);
  const sign = inverse ? 1 : -1;
  const scale = 1 / Math.sqrt(size);
  for (let output = 0; output < size; output += 1) {
    for (let input = 0; input < size; input += 1) {
      const phase = sign * TAU * output * input / size;
      const index = output * size + input;
      real[index] = Math.cos(phase) * scale;
      imaginary[index] = Math.sin(phase) * scale;
    }
  }
  const matrix = { real, imaginary };
  matrixCache.set(key, matrix);
  return matrix;
}

function transformRows(sourceReal, sourceImaginary, size, inverse) {
  const matrix = unitaryMatrix(size, inverse);
  const outputReal = new Float64Array(size * size);
  const outputImaginary = new Float64Array(size * size);
  for (let row = 0; row < size; row += 1) {
    const rowOffset = row * size;
    for (let output = 0; output < size; output += 1) {
      let real = 0;
      let imaginary = 0;
      const matrixOffset = output * size;
      for (let input = 0; input < size; input += 1) {
        const sourceIndex = rowOffset + input;
        const matrixIndex = matrixOffset + input;
        const a = sourceReal[sourceIndex];
        const b = sourceImaginary[sourceIndex];
        const c = matrix.real[matrixIndex];
        const d = matrix.imaginary[matrixIndex];
        real += a * c - b * d;
        imaginary += a * d + b * c;
      }
      outputReal[rowOffset + output] = real;
      outputImaginary[rowOffset + output] = imaginary;
    }
  }
  return { real: outputReal, imaginary: outputImaginary };
}

function transformColumns(sourceReal, sourceImaginary, size, inverse) {
  const matrix = unitaryMatrix(size, inverse);
  const outputReal = new Float64Array(size * size);
  const outputImaginary = new Float64Array(size * size);
  for (let column = 0; column < size; column += 1) {
    for (let output = 0; output < size; output += 1) {
      let real = 0;
      let imaginary = 0;
      const matrixOffset = output * size;
      for (let input = 0; input < size; input += 1) {
        const sourceIndex = input * size + column;
        const matrixIndex = matrixOffset + input;
        const a = sourceReal[sourceIndex];
        const b = sourceImaginary[sourceIndex];
        const c = matrix.real[matrixIndex];
        const d = matrix.imaginary[matrixIndex];
        real += a * c - b * d;
        imaginary += a * d + b * c;
      }
      outputReal[output * size + column] = real;
      outputImaginary[output * size + column] = imaginary;
    }
  }
  return { real: outputReal, imaginary: outputImaginary };
}

export function dft2D(input, explicitSize, options = {}) {
  const source = input?.real ?? input?.data ?? input;
  const inferredSize = input?.size ?? explicitSize ?? Math.sqrt(source?.length ?? 0);
  const size = finiteInteger(inferredSize, 0);
  if (!source || size < 1 || source.length !== size * size) {
    throw new RangeError("A square complex field and its size are required.");
  }
  const sourceReal = Float64Array.from(source, Number);
  const sourceImaginary = input?.imaginary
    ? Float64Array.from(input.imaginary, Number)
    : input?.imag
      ? Float64Array.from(input.imag, Number)
      : new Float64Array(size * size);
  if (sourceImaginary.length !== sourceReal.length) {
    throw new RangeError("Real and imaginary fields must have equal lengths.");
  }
  const inverse = Boolean(options.inverse);
  const rows = transformRows(sourceReal, sourceImaginary, size, inverse);
  const columns = transformColumns(rows.real, rows.imaginary, size, inverse);
  const magnitude = new Float64Array(size * size);
  for (let index = 0; index < magnitude.length; index += 1) {
    magnitude[index] = Math.hypot(columns.real[index], columns.imaginary[index]);
  }
  return Object.freeze({
    size,
    real: columns.real,
    imaginary: columns.imaginary,
    magnitude,
    energy: energy2D(columns.real, columns.imaginary),
  });
}

export function shiftedIndex(index, size) {
  // `shiftedMagnitude` maps each centered output cell back to its unshifted
  // input bin. Odd grids need ceil(N / 2), otherwise DC lands one cell low.
  const half = Math.ceil(size / 2);
  return (index + half) % size;
}

export function shiftedMagnitude(transform, { logarithmic = true } = {}) {
  const { size, magnitude } = transform;
  const output = new Float64Array(magnitude.length);
  let maximum = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = magnitude[shiftedIndex(y, size) * size + shiftedIndex(x, size)];
      const mapped = logarithmic ? Math.log1p(value) : value;
      output[y * size + x] = mapped;
      maximum = Math.max(maximum, mapped);
    }
  }
  if (maximum > 0) {
    for (let index = 0; index < output.length; index += 1) output[index] /= maximum;
  }
  return output;
}

export function dominantFourierBins(transform, count = 12, { excludeDC = true } = {}) {
  const { size, magnitude } = transform;
  const bins = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (excludeDC && x === 0 && y === 0) continue;
      bins.push(Object.freeze({ x, y, magnitude: magnitude[y * size + x] }));
    }
  }
  return bins
    .sort((left, right) => right.magnitude - left.magnitude || left.y - right.y || left.x - right.x)
    .slice(0, clamp(finiteInteger(count, 12), 0, bins.length));
}

export function sampledPorosityDiagnostics(maskOrData, options = {}) {
  const { data, size } = unpackMask(maskOrData, options.size);
  const angleSteps = clamp(finiteInteger(options.angleSteps, 24), 2, 90);
  const offsetSteps = clamp(finiteInteger(options.offsetSteps, Math.min(size, 81)), 3, 81);
  const minimumGapFraction = clamp(Number(options.minimumGapFraction) || 0.04, 0, 1);
  let probes = 0;
  let probesWithGap = 0;
  let completeOccupiedLines = 0;
  let minimumLongestClearFraction = 1;
  let maximumOccupiedFraction = 0;

  for (let angleIndex = 0; angleIndex < angleSteps; angleIndex += 1) {
    const angleDegrees = angleIndex * 180 / angleSteps;
    for (let offsetIndex = 0; offsetIndex < offsetSteps; offsetIndex += 1) {
      const offset = -0.5 + (offsetIndex + 0.5) / offsetSteps;
      const probe = probeLine(data, {
        size,
        angleDegrees,
        offset,
        widthPixels: options.widthPixels ?? 1,
        sampleCount: options.sampleCount ?? Math.max(64, size * 3),
      });
      if (!probe.valid) continue;
      probes += 1;
      maximumOccupiedFraction = Math.max(maximumOccupiedFraction, probe.occupancy);
      minimumLongestClearFraction = Math.min(
        minimumLongestClearFraction,
        probe.longestClearFraction,
      );
      if (probe.longestClearFraction >= minimumGapFraction) probesWithGap += 1;
      if (probe.occupiedSamples === probe.sampleCount) completeOccupiedLines += 1;
    }
  }

  let occupiedCount = 0;
  for (const value of data) occupiedCount += value ? 1 : 0;
  return Object.freeze({
    size,
    density: occupiedCount / data.length,
    vacancyFraction: 1 - occupiedCount / data.length,
    sampledProbeCount: probes,
    probesWithGap,
    lineGapCoverage: probes ? probesWithGap / probes : 0,
    completeOccupiedLines,
    minimumLongestClearFraction: probes ? minimumLongestClearFraction : 0,
    maximumOccupiedFraction,
    qualification: "finite-sampled-diagnostic-only",
  });
}
