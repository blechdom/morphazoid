import { encodeArtwork } from './blech-midi-art.js';

export const MATH_LIMITS = Object.freeze({ expression: 256, tokens: 192, depth: 24, samples: 1024, width: 16, notes: 16384 });
const functions = new Map(Object.entries({ sin: [Math.sin, 1], cos: [Math.cos, 1], tan: [Math.tan, 1], asin: [Math.asin, 1], acos: [Math.acos, 1], atan: [Math.atan, 1], abs: [Math.abs, 1], sqrt: [Math.sqrt, 1], log: [Math.log, 1], exp: [Math.exp, 1], floor: [Math.floor, 1], ceil: [Math.ceil, 1], round: [Math.round, 1], sign: [Math.sign, 1], min: [Math.min, 2], max: [Math.max, 2], pow: [Math.pow, 2], atan2: [Math.atan2, 2] }));
const constants = new Map([['pi', Math.PI], ['tau', Math.PI * 2], ['e', Math.E]]);
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));

/** A deliberately small arithmetic language. No JavaScript, assignments or property access. */
export function compileMidiExpression(source, variable = 'x') {
  if (!['x', 't'].includes(variable)) throw new Error('Use x or t as the variable.');
  const text = String(source ?? '').trim().toLowerCase();
  if (!text || text.length > MATH_LIMITS.expression) throw new Error('Use an expression of 1–256 characters.');
  const tokens = []; let offset = 0;
  while (offset < text.length) {
    const match = /^(?:\s+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[a-z]+|\*\*|[+\-*/%^(),])/.exec(text.slice(offset));
    if (!match) throw new Error(`Unexpected character at ${offset + 1}. Use arithmetic and named functions.`);
    offset += match[0].length;
    if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
    if (tokens.length > MATH_LIMITS.tokens) throw new Error('Simplify the expression.');
  }
  let position = 0;
  const take = token => tokens[position] === token && (++position, true);
  function expression(minimum = 0, depth = 0) {
    if (depth > MATH_LIMITS.depth) throw new Error('Use fewer nested operations.');
    let left; const token = tokens[position++];
    if (token === '+' || token === '-') left = { kind: 'unary', token, value: expression(3, depth + 1) };
    else if (token === '(') { left = expression(0, depth + 1); if (!take(')')) throw new Error('Close the parenthesis.'); }
    else if (/^(?:\d|\.)/.test(token ?? '')) {
      if (!Number.isFinite(Number(token))) throw new Error('Use finite numbers.');
      left = { kind: 'number', value: Number(token) };
    } else if (constants.has(token)) left = { kind: 'number', value: constants.get(token) };
    else if (token === variable) left = { kind: 'variable' };
    else if (functions.has(token)) {
      if (!take('(')) throw new Error(`Write ${token}(…) with parentheses.`);
      const [fn, count] = functions.get(token), args = [expression(0, depth + 1)];
      while (take(',')) {
        if (args.length >= count) throw new Error(`${token} takes ${count} value${count === 1 ? '' : 's'}.`);
        args.push(expression(0, depth + 1));
      }
      if (!take(')') || args.length !== count) throw new Error(`${token} takes ${count} value${count === 1 ? '' : 's'}.`);
      left = { kind: 'call', fn, args };
    } else throw new Error(`Use ${variable}, pi, tau, e, or a supported function${token ? ` (unknown: ${token})` : ''}.`);
    for (;;) {
      const op = tokens[position], power = ['+', '-'].includes(op) ? 1 : ['*', '/', '%'].includes(op) ? 2 : ['^', '**'].includes(op) ? 4 : -1;
      if (power < minimum) break;
      position++;
      left = { kind: 'binary', op, left, right: expression(power === 4 ? power : power + 1, depth + 1) };
    }
    return left;
  }
  const tree = expression();
  if (position !== tokens.length) throw new Error('Separate multiplied terms with * and close every parenthesis.');
  function evaluate(node, value) {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'variable') return value;
    if (node.kind === 'unary') return (node.token === '-' ? -1 : 1) * evaluate(node.value, value);
    if (node.kind === 'call') return node.fn(...node.args.map(arg => evaluate(arg, value)));
    const a = evaluate(node.left, value), b = evaluate(node.right, value);
    if (node.op === '+') return a + b;
    if (node.op === '-') return a - b;
    if (node.op === '*') return a * b;
    if (node.op === '/') return a / b;
    if (node.op === '%') return a % b;
    return a ** b;
  }
  return value => evaluate(tree, value);
}

export const MATH_PRESETS = Object.freeze([
  { id: 'sine', name: 'Sine blade', mode: 'function', equation: 'sin(3*x)', domainMin: 0, domainMax: 6.28318530718 },
  { id: 'teeth', name: 'Saw teeth', mode: 'function', equation: '2*(x-floor(x))-1', domainMin: 0, domainMax: 8 },
  { id: 'interference', name: 'Interference', mode: 'function', equation: 'sin(5*x)*cos(2*x)', domainMin: 0, domainMax: 6.28318530718 },
  { id: 'lissajous', name: 'Lissajous knot', mode: 'parametric', equationX: 'sin(3*t)', equationY: 'sin(4*t)', domainMin: 0, domainMax: 6.28318530718 },
  { id: 'spiral', name: 'Uncoiling', mode: 'parametric', equationX: 't/(6*pi)*cos(t)', equationY: 't/(6*pi)*sin(t)', domainMin: 0, domainMax: 18.8495559215 },
  { id: 'heart', name: 'Heart attack', mode: 'parametric', equationX: 'sin(t)^3', equationY: '(13*cos(t)-5*cos(2*t)-2*cos(3*t)-cos(4*t))/17', domainMin: 0, domainMax: 6.28318530718 },
].map(preset => Object.freeze({ samples: 256, width: 1, low: 0, high: 127, beats: 8, velocity: 96, gate: .9, xMin: -1, xMax: 1, yMin: -1, yMax: 1, ...preset })));

/** x is timeline, y is pitch; each sampled point becomes a bounded note attack. */
export function mathArtwork(options = {}) {
  const settings = { ...MATH_PRESETS[0], ...options }, parametric = settings.mode === 'parametric';
  const samples = Math.round(clamp(settings.samples, 8, MATH_LIMITS.samples, 256));
  const width = Math.round(clamp(settings.width, 1, MATH_LIMITS.width, 1));
  const beats = clamp(settings.beats, .25, 128, 8), gate = clamp(settings.gate, .05, 4, .9);
  const low = Math.round(clamp(settings.low, 0, 127, 0)), high = Math.round(clamp(settings.high, 0, 127, 127));
  const velocity = Math.round(clamp(settings.velocity, 1, 127, 96));
  if (high < low) throw new Error('Highest pitch must be at least Lowest pitch.');
  for (const key of ['domain', 'x', 'y']) {
    if (![settings[`${key}Min`], settings[`${key}Max`]].every(value => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1000000) || Number(settings[`${key}Min`]) >= Number(settings[`${key}Max`])) throw new Error(`${key === 'domain' ? 'Input' : key.toUpperCase()} minimum must be below its maximum (within ±1,000,000).`);
  }
  const f = compileMidiExpression(parametric ? settings.equationY : settings.equation, parametric ? 't' : 'x');
  const fx = parametric ? compileMidiExpression(settings.equationX, 't') : null;
  const notes = [], seen = new Set(); let skipped = 0;
  for (let index = 0; index < samples; index++) {
    const phase = index / Math.max(1, samples - 1), input = Number(settings.domainMin) + (Number(settings.domainMax) - Number(settings.domainMin)) * phase;
    const y = f(input), x = fx ? fx(input) : phase;
    const time = fx ? (x - Number(settings.xMin)) / (Number(settings.xMax) - Number(settings.xMin)) : phase;
    const pitch = (y - Number(settings.yMin)) / (Number(settings.yMax) - Number(settings.yMin));
    if (![time, pitch].every(Number.isFinite) || time < 0 || time > 1 || pitch < 0 || pitch > 1) { skipped++; continue; }
    const beat = Math.round(time * (beats - beats / samples) * 960) / 960;
    const note = Math.round(low + pitch * (high - low)), duration = Math.max(1 / 960, Math.min(beats - beat, beats / samples * gate));
    for (let offset = 0; offset < width; offset++) {
      const key = note + offset - Math.floor((width - 1) / 2), identity = `${beat}:${key}`;
      if (key < low || key > high || seen.has(identity)) continue;
      seen.add(identity); notes.push({ note: key, beat, duration, velocity, layer: 0 });
    }
  }
  notes.sort((a, b) => a.beat - b.beat || a.note - b.note);
  return { notes, durationBeats: beats, skipped, samples };
}

export function encodeMath(options = {}, tempo = 120) {
  const artwork = mathArtwork(options);
  if (!artwork.notes.length) throw new Error('No notes inside the graph bounds. Adjust the expression or ranges.');
  return encodeArtwork(artwork.notes, { title: `MIDI Math · ${options.name || 'equation'}`, tempo, durationBeats: artwork.durationBeats });
}
