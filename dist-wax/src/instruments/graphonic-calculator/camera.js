export const HOME_X_RANGE = Object.freeze({ xMin: -10, xMax: 10 });

const MIN_SPAN = 1e-9;
const MAX_SPAN = 1e15;
const MAX_MAJOR_TICKS = 1000;
const MAX_MINOR_TICKS = 5000;
const MAX_FIXED_DIGITS = 100;
const TICK_TOLERANCE = 1e-9;
const NICE_MANTISSAS = [1, 2, 5];

const dimension = (value) => (Number.isFinite(value) && value > 0 ? value : 1);
const isPositiveFinite = (value) => Number.isFinite(value) && value > 0;
const withinSpanLimits = (span) => span >= MIN_SPAN && span <= MAX_SPAN;

function isValidView(view) {
  if (view === null || typeof view !== "object") return false;
  const { xMin, xMax, yMin, yMax } = view;
  return Number.isFinite(xMin) && Number.isFinite(xMax) && Number.isFinite(yMin) && Number.isFinite(yMax) && xMax > xMin && yMax > yMin;
}

function resolveView(view, width, height) {
  if (isValidView(view) && Number.isFinite(width / (view.xMax - view.xMin)) && Number.isFinite(height / (view.yMax - view.yMin))) return view;
  return homeView(width, height);
}

export function homeView(width, height) {
  const safeWidth = dimension(width);
  const safeHeight = dimension(height);
  const xSpan = HOME_X_RANGE.xMax - HOME_X_RANGE.xMin;
  const ySpan = (xSpan * safeHeight) / safeWidth;
  const safeSpan = isPositiveFinite(ySpan) ? ySpan : xSpan;
  return { xMin: HOME_X_RANGE.xMin, xMax: HOME_X_RANGE.xMax, yMin: -safeSpan / 2, yMax: safeSpan / 2 };
}

export function squareView(view, width, height) {
  const safeWidth = dimension(width);
  const safeHeight = dimension(height);
  const base = resolveView(view, safeWidth, safeHeight);
  const ySpan = ((base.xMax - base.xMin) * safeHeight) / safeWidth;
  const yCenter = (base.yMin + base.yMax) / 2;
  const next = { xMin: base.xMin, xMax: base.xMax, yMin: yCenter - ySpan / 2, yMax: yCenter + ySpan / 2 };
  return isValidView(next) ? next : base;
}

export function createCamera(view, width, height) {
  const safeWidth = dimension(width);
  const safeHeight = dimension(height);
  const base = resolveView(view, safeWidth, safeHeight);
  const { xMin, xMax, yMin, yMax } = base;
  const scaleX = safeWidth / (xMax - xMin);
  const scaleY = safeHeight / (yMax - yMin);
  return {
    view: { xMin, xMax, yMin, yMax },
    width: safeWidth,
    height: safeHeight,
    scaleX,
    scaleY,
    toPixel: (x, y) => [(x - xMin) * scaleX, (yMax - y) * scaleY],
    toWorld: (px, py) => [xMin + px / scaleX, yMax - py / scaleY],
  };
}

export function panView(view, dxPixels, dyPixels, width, height) {
  const safeWidth = dimension(width);
  const safeHeight = dimension(height);
  const base = resolveView(view, safeWidth, safeHeight);
  const dx = Number.isFinite(dxPixels) ? dxPixels : 0;
  const dy = Number.isFinite(dyPixels) ? dyPixels : 0;
  const worldDx = (dx * (base.xMax - base.xMin)) / safeWidth;
  const worldDy = (dy * (base.yMax - base.yMin)) / safeHeight;
  const next = { xMin: base.xMin - worldDx, xMax: base.xMax - worldDx, yMin: base.yMin + worldDy, yMax: base.yMax + worldDy };
  return isValidView(next) ? next : base;
}

export function zoomView(view, factor, anchorPx, anchorPy, width, height) {
  return zoomAxes(view, factor, factor, anchorPx, anchorPy, width, height);
}

export function zoomAxes(view, factorX, factorY, anchorPx, anchorPy, width, height) {
  const safeWidth = dimension(width);
  const safeHeight = dimension(height);
  const base = resolveView(view, safeWidth, safeHeight);
  if (!isPositiveFinite(factorX) || !isPositiveFinite(factorY)) return base;
  const spanX = base.xMax - base.xMin;
  const spanY = base.yMax - base.yMin;
  const nextSpanX = spanX / factorX;
  const nextSpanY = spanY / factorY;
  if (!withinSpanLimits(nextSpanX) || !withinSpanLimits(nextSpanY)) return base;
  const fractionX = (Number.isFinite(anchorPx) ? anchorPx : safeWidth / 2) / safeWidth;
  const fractionY = (Number.isFinite(anchorPy) ? anchorPy : safeHeight / 2) / safeHeight;
  const anchorX = base.xMin + fractionX * spanX;
  const anchorY = base.yMax - fractionY * spanY;
  const xMin = anchorX - fractionX * nextSpanX;
  const yMax = anchorY + fractionY * nextSpanY;
  const next = { xMin, xMax: xMin + nextSpanX, yMin: yMax - nextSpanY, yMax };
  return isValidView(next) ? next : base;
}

const niceValue = (mantissa, exponent) => Number(`${mantissa}e${exponent}`);

function tickLimit(maxTicks) {
  if (typeof maxTicks !== "number" || Number.isNaN(maxTicks)) return 10;
  return Math.min(MAX_MAJOR_TICKS, Math.max(1, maxTicks));
}

function niceStepParts(span, maxTicks) {
  const magnitude = typeof span === "number" ? Math.abs(span) : NaN;
  if (!Number.isFinite(magnitude) || magnitude === 0) return { step: 1, mantissa: 1, exponent: 0 };
  const rough = magnitude / tickLimit(maxTicks);
  const startExponent = Math.floor(Math.log10(rough));
  for (let exponent = startExponent; exponent <= startExponent + 1; exponent++) {
    for (const mantissa of NICE_MANTISSAS) {
      const step = niceValue(mantissa, exponent);
      if (Number.isFinite(step) && step >= rough * (1 - 1e-12)) return { step, mantissa, exponent };
    }
  }
  const fallback = niceValue(1, startExponent + 2);
  return Number.isFinite(fallback) ? { step: fallback, mantissa: 1, exponent: startExponent + 2 } : { step: 1, mantissa: 1, exponent: 0 };
}

export function niceStep(span, maxTicks = 10) {
  const { step } = niceStepParts(span, maxTicks);
  return isPositiveFinite(step) ? step : 1;
}

function roundTick(value, decimals) {
  const rounded = Number(value.toFixed(decimals));
  return rounded === 0 ? 0 : rounded;
}

// Digits needed to print every multiple of `step` exactly, from its shortest decimal form (0.25 → 2, 2.5 → 1).
function decimalsFor(step) {
  const [mantissa, exponent] = step.toExponential().split("e");
  const fraction = mantissa.includes(".") ? mantissa.split(".")[1].length : 0;
  return Math.max(0, fraction - Number(exponent));
}

// Steps below the floating-point resolution of the range cannot produce distinct ticks.
const representable = (step, min, max) => step > Math.max(Math.abs(min), Math.abs(max)) * Number.EPSILON * 4;

// Index tolerance grows with magnitude so a quotient like 10000.007 / 0.0001 still lands on its tick.
function tickIndexRange(min, max, step) {
  const low = min / step, high = max / step;
  const tolerance = Math.max(TICK_TOLERANCE, Math.max(Math.abs(low), Math.abs(high)) * Number.EPSILON * 8);
  const first = Math.ceil(low - tolerance), last = Math.floor(high + tolerance);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return null;
  return [first, last];
}

const EMPTY_TICKS = () => ({ step: 1, minorStep: 0.2, decimals: 0, ticks: [] });

export function niceTicks(min, max, maxTicks = 10) {
  const span = max - min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(span) || span <= 0) return EMPTY_TICKS();
  const { step, mantissa, exponent } = niceStepParts(span, maxTicks);
  if (!isPositiveFinite(step)) return EMPTY_TICKS();
  const minorStep = mantissa === 2 ? niceValue(5, exponent - 1) : mantissa === 5 ? niceValue(1, exponent) : niceValue(2, exponent - 1);
  const decimals = decimalsFor(step);
  if (decimals > MAX_FIXED_DIGITS || !representable(step, min, max)) return EMPTY_TICKS();
  const range = tickIndexRange(min, max, step);
  if (!range || range[1] - range[0] > MAX_MAJOR_TICKS * 2) return EMPTY_TICKS();
  const [first, last] = range;
  const ticks = [];
  for (let offset = 0; offset <= last - first; offset++) ticks.push(roundTick((first + offset) * step, decimals));
  return { step, minorStep, decimals, ticks };
}

export function minorTicks(min, max, step, minorStep) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !isPositiveFinite(step) || !isPositiveFinite(minorStep)) return [];
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0 || span / minorStep > MAX_MINOR_TICKS) return [];
  const decimals = decimalsFor(minorStep);
  if (decimals > MAX_FIXED_DIGITS || !representable(minorStep, min, max)) return [];
  const range = tickIndexRange(min, max, minorStep);
  if (!range) return [];
  const [first, last] = range;
  const ratio = Math.round(step / minorStep);
  const integerRatio = ratio > 0 && Math.abs(step / minorStep - ratio) < TICK_TOLERANCE;
  const isMajor = (index, value) => {
    if (integerRatio) return ((index % ratio) + ratio) % ratio === 0;
    const majorIndex = value / step;
    return Math.abs(majorIndex - Math.round(majorIndex)) <= TICK_TOLERANCE * Math.max(1, Math.abs(majorIndex));
  };
  const ticks = [];
  for (let offset = 0; offset <= last - first; offset++) {
    const index = first + offset;
    const value = roundTick(index * minorStep, decimals);
    if (!isMajor(index, value)) ticks.push(value);
  }
  return ticks;
}

function trimFraction(text) {
  const trimmed = text.includes(".") ? text.replace(/\.?0+$/, "") : text;
  return trimmed === "-0" ? "0" : trimmed;
}

function compactExponent(value, fractionDigits) {
  const [mantissa, exponent = "0"] = value.toExponential(fractionDigits).split("e");
  return `${trimFraction(mantissa)}e${exponent.replace("+", "")}`;
}

const usesExponent = (magnitude) => magnitude >= 1e6 || magnitude < 1e-4;

export function formatTick(value, decimals) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value === 0) return "0";
  if (usesExponent(Math.abs(value))) return compactExponent(value, 5);
  if (Number.isInteger(value)) return String(value);
  const digits = Number.isFinite(decimals) ? Math.min(MAX_FIXED_DIGITS, Math.max(0, Math.round(decimals))) : 6;
  return trimFraction(value.toFixed(digits));
}

export function formatCoordinate(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "undefined";
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";
  if (value === 0) return "0";
  const rounded = Number(value.toPrecision(4));
  if (rounded === 0) return "0";
  if (!Number.isFinite(rounded) || usesExponent(Math.abs(rounded))) return compactExponent(value, 3);
  return String(rounded);
}
