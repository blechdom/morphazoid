import { encodeArtwork } from './blech-midi-art.js';

export const MATH_LIMITS = Object.freeze({ expression: 256, tokens: 192, depth: 24, samples: 1024, width: 16, notes: 16384 });
const functions = new Map(Object.entries({ sin: [Math.sin, 1], cos: [Math.cos, 1], tan: [Math.tan, 1], asin: [Math.asin, 1], acos: [Math.acos, 1], atan: [Math.atan, 1], abs: [Math.abs, 1], sqrt: [Math.sqrt, 1], log: [Math.log, 1], exp: [Math.exp, 1], floor: [Math.floor, 1], ceil: [Math.ceil, 1], round: [Math.round, 1], sign: [Math.sign, 1], min: [Math.min, 2], max: [Math.max, 2], pow: [Math.pow, 2], atan2: [Math.atan2, 2] }));
const constants = new Map([['pi', Math.PI], ['tau', Math.PI * 2], ['e', Math.E]]);
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));

/** A bounded arithmetic language. The second argument to the compiled function is
 * normalized progress (0–1): t/phase in y=f(x), phase in parametric x(t), y(t).
 * No JavaScript, assignments, property access, clocks or random state. */
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
    else if (token === variable || token === 't' || token === 'phase') left = { kind: 'variable', name: token };
    else if (functions.has(token)) {
      if (!take('(')) throw new Error(`Write ${token}(…) with parentheses.`);
      const [fn, count] = functions.get(token), args = [expression(0, depth + 1)];
      while (take(',')) {
        if (args.length >= count) throw new Error(`${token} takes ${count} value${count === 1 ? '' : 's'}.`);
        args.push(expression(0, depth + 1));
      }
      if (!take(')') || args.length !== count) throw new Error(`${token} takes ${count} value${count === 1 ? '' : 's'}.`);
      left = { kind: 'call', fn, args };
    } else throw new Error(`Use ${variable}${variable === 'x' ? ', t' : ''}, phase, pi, tau, e, or a supported function${token ? ` (unknown: ${token})` : ''}.`);
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
  function evaluate(node, value, phase) {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'variable') return node.name === variable ? value : phase;
    if (node.kind === 'unary') return (node.token === '-' ? -1 : 1) * evaluate(node.value, value, phase);
    if (node.kind === 'call') return node.fn(...node.args.map(arg => evaluate(arg, value, phase)));
    const a = evaluate(node.left, value, phase), b = evaluate(node.right, value, phase);
    if (node.op === '+') return a + b;
    if (node.op === '-') return a - b;
    if (node.op === '*') return a * b;
    if (node.op === '/') return a / b;
    if (node.op === '%') return a % b;
    return a ** b;
  }
  return (value, phase = 0) => evaluate(tree, value, clamp(phase, 0, 1, 0));
}

export const MATH_PRESETS = Object.freeze([
  { id: 'sine', name: 'Sine blade', mode: 'function', equation: 'sin(3*x)', domainMin: 0, domainMax: 6.28318530718 },
  { id: 'teeth', name: 'Saw teeth', mode: 'function', equation: '2*(x-floor(x))-1', domainMin: 0, domainMax: 8 },
  { id: 'interference', name: 'Interference', mode: 'function', equation: 'sin(5*x)*cos(2*x)', domainMin: 0, domainMax: 6.28318530718 },
  { id: 'lissajous', name: 'Lissajous knot', mode: 'parametric', equationX: 'sin(3*t)', equationY: 'sin(4*t)', domainMin: 0, domainMax: 6.28318530718 },
  { id: 'spiral', name: 'Uncoiling', mode: 'parametric', equationX: 't/(6*pi)*cos(t)', equationY: 't/(6*pi)*sin(t)', domainMin: 0, domainMax: 18.8495559215 },
  { id: 'heart', name: 'Heart attack', mode: 'parametric', equationX: 'sin(t)^3', equationY: '(13*cos(t)-5*cos(2*t)-2*cos(3*t)-cos(4*t))/17', domainMin: 0, domainMax: 6.28318530718 },
  // These contours evolve over the duration of one drop. t is elapsed fraction,
  // independent of Input start/end, so stretching Length preserves the motion.
  { id: 'rising-ripple', name: 'Rising ripple', equation: '.65*sin(4*x)+.6*t-.3', evolves: true },
  { id: 'falling-ripple', name: 'Falling ripple', equation: '.65*sin(5*x)-.6*t+.3', evolves: true },
  { id: 'opening-fan', name: 'Opening fan', equation: 't*sin(6*x)', evolves: true },
  { id: 'closing-fan', name: 'Closing fan', equation: '(1-t)*sin(7*x)', evolves: true },
  { id: 'accelerator', name: 'Accelerator', equation: 'sin(tau*(t+10*t^2))', evolves: true, samples: 512 },
  { id: 'decelerator', name: 'Decelerator', equation: 'sin(tau*(11*t-5*t^2))', evolves: true, samples: 512 },
  { id: 'breathing-ribbon', name: 'Breathing ribbon', equation: 'sin(6*x)*(.2+.8*sin(pi*t))', evolves: true },
  { id: 'orbit-shift', name: 'Orbit shift', equation: '.65*sin(4*x+pi*t^2)+.3*sin(tau*t)', evolves: true },
  { id: 'melting-stairs', name: 'Melting stairs', equation: 'round((2+10*t)*sin(3*x))/(2+10*t)', evolves: true },
  { id: 'wave-to-teeth', name: 'Wave into teeth', equation: '(1-t)*sin(4*x)+t*(2*(4*t-floor(4*t))-1)', evolves: true },
  { id: 'chirp-fold', name: 'Chirp fold', equation: '2*abs(sin(tau*(2*t+8*t^3)))-1', evolves: true, samples: 512 },
  { id: 'bouncing-decay', name: 'Bouncing decay', equation: '2*abs(sin(6*x))*(1-t)-1', evolves: true },
  { id: 'bloom-collapse', name: 'Bloom and collapse', equation: 'sin(8*x)*4*t*(1-t)', evolves: true },
  { id: 'spectral-wake', name: 'Spectral wake', equation: '(sin(2*x)+t*sin(11*x))/(1+t)', evolves: true },
  { id: 'glass-ramp', name: 'Glass ramp', equation: '.75*(2*t-1)+.2*sin(12*x)', evolves: true },
  { id: 'stutter-flare', name: 'Stutter flare', equation: 'sin(18*x)*(.2+.8*floor(8*t)/8)', evolves: true, samples: 512 },
  { id: 'triangle-chain', name: 'Triangle chain', equation: '2*abs(2*(4*x/tau-floor(4*x/tau+.5)))-1' },
  { id: 'square-switch', name: 'Square switch', equation: '.8*sign(sin(4*x))' },
  { id: 'staircase', name: 'Staircase', equation: '2*floor(8*x/tau)/8-1' },
  { id: 'arches', name: 'Arch arcade', equation: '2*abs(sin(3*x))-1' },
  { id: 'needle-comb', name: 'Needle comb', equation: '2*exp(-18*sin(4*x)^2)-1' },
  { id: 'beating-wires', name: 'Beating wires', equation: '(sin(9*x)+sin(10*x))/2', samples: 512 },
  { id: 'nested-wave', name: 'Nested wave', equation: 'sin(3*x+2*sin(7*x))', samples: 512 },
  { id: 'wavefold', name: 'Wavefold', equation: 'sin(5*sin(2*x))' },
  { id: 'harp-stairs', name: 'Harp stairs', equation: 'round(6*sin(2*x))/6' },
  { id: 'suspended-bridge', name: 'Suspended bridge', equation: '1-2*abs(cos(x/2))^.5' },
  { id: 'gaussian-island', name: 'Gaussian island', equation: '2*exp(-2*(x-pi)^2)-1' },
  { id: 'rational-bell', name: 'Rational bell', equation: '2/(1+4*(x-pi)^2)-1' },
  { id: 'chess-pulse', name: 'Chess pulse', equation: '.7*sign(sin(6*x))+.25*sin(x)' },
  { id: 'sine-lattice', name: 'Sine lattice', equation: '(sin(3*x)+sin(7*x)+sin(13*x))/3', samples: 512 },
  { id: 'crushed-orbit', name: 'Crushed orbit', equation: 'atan(12*sin(3*x))/atan(12)' },
  { id: 'granular-zigzag', name: 'Granular zigzag', equation: '.8*(2*(7*x/tau-floor(7*x/tau))-1)+.2*sin(29*x)', samples: 512 },
  { id: 'circle', name: 'Perfect orbit', mode: 'parametric', equationX: 'cos(t)', equationY: 'sin(t)' },
  { id: 'ellipse', name: 'Low orbit', mode: 'parametric', equationX: '.95*cos(t)', equationY: '.4*sin(t)' },
  { id: 'lemniscate', name: 'Infinity knot', mode: 'parametric', equationX: 'cos(t)/(1+sin(t)^2)', equationY: '2*sin(t)*cos(t)/(1+sin(t)^2)' },
  { id: 'astroid', name: 'Pinched diamond', mode: 'parametric', equationX: 'cos(t)^3', equationY: 'sin(t)^3' },
  { id: 'diamond', name: 'Diamond circuit', mode: 'parametric', equationX: 'cos(t)/(abs(cos(t))+abs(sin(t)))', equationY: 'sin(t)/(abs(cos(t))+abs(sin(t)))' },
  { id: 'rose-three', name: 'Three petal bloom', mode: 'parametric', equationX: 'cos(3*t)*cos(t)', equationY: 'cos(3*t)*sin(t)' },
  { id: 'rose-five', name: 'Five petal bloom', mode: 'parametric', equationX: 'cos(5*t)*cos(t)', equationY: 'cos(5*t)*sin(t)', samples: 512 },
  { id: 'rose-eight', name: 'Eight blade flower', mode: 'parametric', equationX: 'cos(4*t)*cos(t)', equationY: 'cos(4*t)*sin(t)', samples: 512 },
  { id: 'deltoid', name: 'Three corner circuit', mode: 'parametric', equationX: '(2*cos(t)+cos(2*t))/3', equationY: '(2*sin(t)-sin(2*t))/3' },
  { id: 'epicycle', name: 'Epicycle bubble', mode: 'parametric', equationX: '(3*cos(t)+cos(3*t))/4', equationY: '(3*sin(t)+sin(3*t))/4' },
  { id: 'braided-knot', name: 'Braided knot', mode: 'parametric', equationX: '.75*sin(3*t)+.25*sin(9*t)', equationY: '.75*sin(4*t)+.25*cos(7*t)', samples: 512 },
  { id: 'basket-weave', name: 'Basket weave', mode: 'parametric', equationX: 'sin(7*t)', equationY: 'sin(8*t+pi/4)', samples: 512 },
  { id: 'gear', name: 'Eleven tooth gear', mode: 'parametric', equationX: '(.75+.25*cos(11*t))*cos(t)', equationY: '(.75+.25*cos(11*t))*sin(t)', samples: 512 },
  { id: 'spiral-return', name: 'Spiral return', mode: 'parametric', equationX: '(1-phase)*cos(t)', equationY: '(1-phase)*sin(t)', domainMax: 8 * Math.PI, samples: 512 },
  { id: 'orbital-fan', name: 'Orbital fan', mode: 'parametric', equationX: 'cos(t)', equationY: 'phase*sin(t)', domainMax: 8 * Math.PI, samples: 512 },
  { id: 'ribbon-knot', name: 'Ribbon knot', mode: 'parametric', equationX: '.7*sin(2*t)+.3*cos(5*t)', equationY: '.7*cos(3*t)+.3*sin(7*t)', samples: 512 },
].map(preset => Object.freeze({ mode: 'function', domainMin: 0, domainMax: Math.PI * 2, samples: 256, width: 1, low: 0, high: 127, beats: 8, velocity: 96, gate: .9, xMin: -1, xMax: 1, yMin: -1, yMax: 1, ...preset })));

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
    const y = f(input, phase), x = fx ? fx(input, phase) : phase;
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
