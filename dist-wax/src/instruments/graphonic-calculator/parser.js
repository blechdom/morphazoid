const TAU = Math.PI * 2;

function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(TAU) * t ** (z + 0.5) * Math.exp(-t) * x;
}

export function factorial(n) {
  if (!Number.isFinite(n)) return NaN;
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
  }
  return gamma(n + 1);
}

const toRadians = (angle) => (value) => value * angle.scale;
const fromRadians = (angle) => (value) => value / angle.scale;

export const BUILTIN_FUNCTIONS = Object.freeze({
  sin: { arity: 1, make: (angle) => { const r = toRadians(angle); return (a) => Math.sin(r(a)); } },
  cos: { arity: 1, make: (angle) => { const r = toRadians(angle); return (a) => Math.cos(r(a)); } },
  tan: { arity: 1, make: (angle) => { const r = toRadians(angle); return (a) => Math.tan(r(a)); } },
  sec: { arity: 1, make: (angle) => { const r = toRadians(angle); return (a) => 1 / Math.cos(r(a)); } },
  csc: { arity: 1, make: (angle) => { const r = toRadians(angle); return (a) => 1 / Math.sin(r(a)); } },
  cot: { arity: 1, make: (angle) => { const r = toRadians(angle); return (a) => 1 / Math.tan(r(a)); } },
  asin: { arity: 1, make: (angle) => { const d = fromRadians(angle); return (a) => d(Math.asin(a)); } },
  acos: { arity: 1, make: (angle) => { const d = fromRadians(angle); return (a) => d(Math.acos(a)); } },
  atan: { arity: 1, make: (angle) => { const d = fromRadians(angle); return (a) => d(Math.atan(a)); } },
  sinh: { arity: 1, make: () => Math.sinh },
  cosh: { arity: 1, make: () => Math.cosh },
  tanh: { arity: 1, make: () => Math.tanh },
  asinh: { arity: 1, make: () => Math.asinh },
  acosh: { arity: 1, make: () => Math.acosh },
  atanh: { arity: 1, make: () => Math.atanh },
  ln: { arity: 1, make: () => Math.log },
  log: { arity: 1, make: () => Math.log10 },
  exp: { arity: 1, make: () => Math.exp },
  sqrt: { arity: 1, make: () => Math.sqrt },
  cbrt: { arity: 1, make: () => Math.cbrt },
  abs: { arity: 1, make: () => Math.abs },
  floor: { arity: 1, make: () => Math.floor },
  ceil: { arity: 1, make: () => Math.ceil },
  round: { arity: 1, make: () => Math.round },
  sign: { arity: 1, make: () => Math.sign },
  min: { arity: -2, make: () => Math.min },
  max: { arity: -2, make: () => Math.max },
  mod: { arity: 2, make: () => (a, b) => ((a % b) + b) % b },
});

const FUNCTION_ALIASES = Object.freeze({ arcsin: "asin", arccos: "acos", arctan: "atan" });

export const CONSTANTS = Object.freeze({ pi: Math.PI, tau: TAU, e: Math.E });

const CONSTANT_ALIASES = Object.freeze({ "π": "pi", "τ": "tau" });
const VARIABLE_WORDS = Object.freeze({ theta: "θ", phi: "φ" });

const NAMED_WORDS = [...Object.keys(BUILTIN_FUNCTIONS), ...Object.keys(FUNCTION_ALIASES), ...Object.keys(CONSTANTS), ...Object.keys(VARIABLE_WORDS)]
  .filter((word) => word.length > 1)
  .sort((a, b) => b.length - a.length);

const isLetter = (ch) => /\p{L}/u.test(ch);
const isDigit = (ch) => ch >= "0" && ch <= "9";

export class ParseError extends Error {
  constructor(message, position) {
    super(message);
    this.name = "ParseError";
    this.position = position;
  }
}

export function tokenize(text) {
  const tokens = [];
  const source = String(text ?? "");
  let i = 0;
  const push = (type, value, start) => tokens.push({ type, value, start, end: i });
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n") { i++; continue; }
    const start = i;
    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1] ?? ""))) {
      while (i < source.length && isDigit(source[i])) i++;
      if (source[i] === ".") {
        i++;
        while (i < source.length && isDigit(source[i])) i++;
      }
      if (source[i] === "." ) throw new ParseError("Unexpected second decimal point", i);
      push("number", Number(source.slice(start, i)), start);
      continue;
    }
    if (isLetter(ch)) {
      const word = NAMED_WORDS.find((name) => source.startsWith(name, i));
      if (word && !(word in VARIABLE_WORDS)) {
        i += word.length;
        if (word in CONSTANTS) push("constant", word, start);
        else push("function", FUNCTION_ALIASES[word] ?? word, start);
        continue;
      }
      let name = word ? VARIABLE_WORDS[word] : ch;
      i += word ? word.length : 1;
      if (source[i] === "_") {
        i++;
        if (source[i] === "{") {
          const close = source.indexOf("}", i);
          if (close < 0) throw new ParseError("Unclosed subscript", i);
          name += `_${source.slice(i + 1, close)}`;
          i = close + 1;
        } else {
          const subscriptStart = i;
          while (i < source.length && (isDigit(source[i]) || isLetter(source[i]))) i++;
          if (i === subscriptStart) throw new ParseError("Subscript needs a letter or digit", i);
          name += `_${source.slice(subscriptStart, i)}`;
        }
      }
      const constant = CONSTANT_ALIASES[name] ?? (name in CONSTANTS ? name : null);
      if (constant) push("constant", constant, start);
      else push("name", name, start);
      continue;
    }
    if (ch === "<" || ch === ">") {
      if (source[i + 1] === "=") { i += 2; push("op", `${ch}=`, start); continue; }
      i++; push("op", ch, start); continue;
    }
    if (ch === "≤") { i++; push("op", "<=", start); continue; }
    if (ch === "≥") { i++; push("op", ">=", start); continue; }
    if (ch === "·" || ch === "×" || ch === "*") { i++; push("op", "*", start); continue; }
    if (ch === "÷") { i++; push("op", "/", start); continue; }
    if (ch === "−") { i++; push("op", "-", start); continue; }
    if ("+-/^!,=()|".includes(ch)) { i++; push("op", ch, start); continue; }
    if (ch === "[" || ch === "{") { i++; push("op", "(", start); continue; }
    if (ch === "]" || ch === "}") { i++; push("op", ")", start); continue; }
    throw new ParseError(`Unexpected character “${ch}”`, i);
  }
  push("end", null, i);
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.absDepth = 0;
  }

  peek(offset = 0) { return this.tokens[this.index + offset]; }
  next() { return this.tokens[this.index++]; }
  isOp(value, offset = 0) { const token = this.peek(offset); return token.type === "op" && token.value === value; }
  fail(message, token = this.peek()) { throw new ParseError(message, token.start); }

  parseStatement() {
    const left = this.parseSum();
    const token = this.peek();
    if (token.type === "op" && ["=", "<", ">", "<=", ">="].includes(token.value)) {
      this.next();
      const right = this.parseSum();
      const again = this.peek();
      if (again.type === "op" && ["=", "<", ">", "<=", ">="].includes(again.value)) this.fail("Only one comparison per line is supported");
      this.expectEnd();
      return { type: "relation", op: token.value, left, right };
    }
    this.expectEnd();
    return left;
  }

  expectEnd() {
    const token = this.peek();
    if (token.type !== "end") this.fail(token.type === "op" && token.value === ")" ? "Unmatched “)”" : `Unexpected “${token.value}”`);
  }

  parseSum() {
    let node = this.parseProduct();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next().value;
      const right = this.parseProduct();
      node = { type: op === "+" ? "add" : "sub", left: node, right };
    }
    return node;
  }

  startsOperand(token) {
    if (token.type === "number" || token.type === "name" || token.type === "constant" || token.type === "function") return true;
    if (token.type === "op") return token.value === "(" || (token.value === "|" && this.absDepth === 0);
    return false;
  }

  parseProduct() {
    let node = this.parseUnary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = this.next().value;
        const right = this.parseUnary();
        node = { type: op === "*" ? "mul" : "div", left: node, right };
      } else if (this.startsOperand(this.peek())) {
        node = { type: "mul", left: node, right: this.parsePower(), implicit: true };
      } else return node;
    }
  }

  parseUnary() {
    if (this.isOp("-")) { this.next(); return { type: "neg", operand: this.parseUnary() }; }
    if (this.isOp("+")) { this.next(); return this.parseUnary(); }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePostfix();
    if (this.isOp("^")) {
      this.next();
      return { type: "pow", base, exponent: this.parseUnary() };
    }
    return base;
  }

  parsePostfix() {
    let node = this.parsePrimary();
    while (this.isOp("!")) { this.next(); node = { type: "fact", operand: node }; }
    return node;
  }

  parseArguments() {
    this.next();
    const args = [];
    if (this.isOp(")")) this.fail("Empty parentheses");
    const outerDepth = this.absDepth;
    this.absDepth = 0;
    for (;;) {
      args.push(this.parseSum());
      if (this.isOp(",")) { this.next(); continue; }
      if (this.isOp(")")) { this.next(); break; }
      this.fail(this.peek().type === "end" ? "Missing “)”" : `Unexpected “${this.peek().value}”`);
    }
    this.absDepth = outerDepth;
    return args;
  }

  parsePrimary() {
    const token = this.peek();
    if (token.type === "number") { this.next(); return { type: "num", value: token.value }; }
    if (token.type === "constant") { this.next(); return { type: "const", name: token.value }; }
    if (token.type === "function") {
      this.next();
      if (this.isOp("(")) return { type: "call", name: token.value, args: this.parseArguments() };
      if (this.isOp("^")) {
        this.next();
        const exponent = this.parseUnary();
        return { type: "pow", base: { type: "call", name: token.value, args: [this.parseFunctionOperand(token)] }, exponent };
      }
      return { type: "call", name: token.value, args: [this.parseFunctionOperand(token)] };
    }
    if (token.type === "name") {
      this.next();
      if (this.isOp("(")) return { type: "apply", name: token.value, args: this.parseArguments() };
      return { type: "var", name: token.value };
    }
    if (token.type === "op" && token.value === "(") {
      const items = this.parseArguments();
      if (items.length === 1) return { type: "group", inner: items[0] };
      if (items.length === 2) return { type: "tuple", items };
      this.fail("Points use two coordinates", token);
    }
    if (token.type === "op" && token.value === "|") {
      this.next();
      this.absDepth++;
      const inner = this.parseSum();
      this.absDepth--;
      if (!this.isOp("|")) this.fail("Missing closing “|”");
      this.next();
      return { type: "call", name: "abs", args: [inner] };
    }
    if (token.type === "end") this.fail("Expression ends too early");
    if (token.type === "op" && token.value === ")") this.fail("Unmatched “)”");
    this.fail(`Unexpected “${token.value}”`);
  }

  // sin 2πx² reads as sin(2πx²); the operand stops before another function name or operator.
  parseFunctionOperand(functionToken) {
    let sign = false;
    while (this.isOp("-") || this.isOp("+")) sign = this.next().value === "-" ? !sign : sign;
    const simple = (token) => token.type === "number" || token.type === "name" || token.type === "constant" || (token.type === "op" && token.value === "(");
    if (!simple(this.peek())) this.fail(`${functionToken.value} needs an argument`, this.peek());
    let node = this.parsePower();
    while (simple(this.peek())) node = { type: "mul", left: node, right: this.parsePower(), implicit: true };
    return sign ? { type: "neg", operand: node } : node;
  }
}

export function parse(text) {
  return new Parser(tokenize(text)).parseStatement();
}

export function walk(node, visit) {
  visit(node);
  switch (node.type) {
    case "neg": case "fact": walk(node.operand, visit); break;
    case "group": walk(node.inner, visit); break;
    case "add": case "sub": case "mul": case "div": walk(node.left, visit); walk(node.right, visit); break;
    case "pow": walk(node.base, visit); walk(node.exponent, visit); break;
    case "call": case "apply": case "tuple": for (const item of node.args ?? node.items) walk(item, visit); break;
    case "relation": walk(node.left, visit); walk(node.right, visit); break;
    default: break;
  }
}

export function variableNames(node) {
  const names = new Set();
  walk(node, (item) => {
    if (item.type === "var") names.add(item.name);
    if (item.type === "apply") names.add(item.name);
  });
  return names;
}

export function containsTuple(node) {
  let found = false;
  walk(node, (item) => { if (item.type === "tuple") found = true; });
  return found;
}

export class CompileError extends Error {
  constructor(message) { super(message); this.name = "CompileError"; }
}

export function createEnvironment({ angle = "radians", functions = new Map(), parameters = new Set() } = {}) {
  return { angle: { mode: angle, scale: angle === "degrees" ? Math.PI / 180 : 1 }, functions, parameters };
}

/**
 * Compile an expression tree into `(scope) => number`. User functions resolve through
 * `env.functions` (name → { params, body }); parameters and plot variables read from the scope object.
 */
export function compile(node, env = createEnvironment(), bindings = null, stack = []) {
  const build = (item) => compile(item, env, bindings, stack);
  switch (node.type) {
    case "num": { const value = node.value; return () => value; }
    case "const": { const value = CONSTANTS[node.name]; return () => value; }
    case "var": {
      const name = node.name;
      if (bindings && name in bindings) { const index = bindings[name]; return (scope, args) => args[index]; }
      return (scope) => { const value = scope[name]; return value === undefined ? NaN : value; };
    }
    case "group": return build(node.inner);
    case "neg": { const inner = build(node.operand); return (s, a) => -inner(s, a); }
    case "fact": { const inner = build(node.operand); return (s, a) => factorial(inner(s, a)); }
    case "add": { const l = build(node.left), r = build(node.right); return (s, a) => l(s, a) + r(s, a); }
    case "sub": { const l = build(node.left), r = build(node.right); return (s, a) => l(s, a) - r(s, a); }
    case "mul": { const l = build(node.left), r = build(node.right); return (s, a) => l(s, a) * r(s, a); }
    case "div": { const l = build(node.left), r = build(node.right); return (s, a) => l(s, a) / r(s, a); }
    case "pow": { const b = build(node.base), e = build(node.exponent); return (s, a) => realPower(b(s, a), e(s, a)); }
    case "call": {
      const spec = BUILTIN_FUNCTIONS[node.name];
      const impl = spec.make(env.angle);
      if (spec.arity > 0 && node.args.length !== spec.arity) throw new CompileError(`${node.name} takes ${spec.arity} argument${spec.arity === 1 ? "" : "s"}`);
      if (spec.arity < 0 && node.args.length < -spec.arity) throw new CompileError(`${node.name} needs at least ${-spec.arity} arguments`);
      const args = node.args.map(build);
      if (args.length === 1) { const [one] = args; return (s, a) => impl(one(s, a)); }
      if (args.length === 2) { const [one, two] = args; return (s, a) => impl(one(s, a), two(s, a)); }
      return (s, a) => impl(...args.map((fn) => fn(s, a)));
    }
    case "apply": {
      const definition = env.functions.get(node.name);
      if (!definition) {
        if (node.args.length !== 1) throw new CompileError(`${node.name} is not a defined function`);
        return build({ type: "mul", left: { type: "var", name: node.name }, right: node.args[0], implicit: true });
      }
      if (stack.includes(node.name)) throw new CompileError(`${node.name} is defined in terms of itself`);
      if (definition.params.length !== node.args.length) throw new CompileError(`${node.name} takes ${definition.params.length} argument${definition.params.length === 1 ? "" : "s"}`);
      const paramBindings = Object.fromEntries(definition.params.map((name, index) => [name, index]));
      const body = compile(definition.body, env, paramBindings, [...stack, node.name]);
      const args = node.args.map(build);
      return (s, a) => body(s, args.map((fn) => fn(s, a)));
    }
    case "tuple": throw new CompileError("A point cannot be used inside arithmetic");
    case "relation": throw new CompileError("A comparison cannot be used as a value");
    default: throw new CompileError(`Unknown node ${node.type}`);
  }
}

// Odd real roots of negative numbers stay real, matching graphonic-calculator convention for x^(1/3).
export function realPower(base, exponent) {
  if (base < 0 && !Number.isInteger(exponent) && Number.isFinite(exponent)) {
    const inverse = 1 / exponent;
    const rounded = Math.round(inverse);
    if (Math.abs(inverse - rounded) < 1e-9 && rounded % 2 !== 0) return -((-base) ** exponent);
    const [num, den] = rationalApproximation(exponent);
    if (den % 2 === 1) return (num % 2 === 0 ? 1 : -1) * (-base) ** exponent;
  }
  return base ** exponent;
}

function rationalApproximation(value, maxDenominator = 64) {
  let bestNumerator = 0, bestDenominator = 1, bestError = Infinity;
  for (let den = 1; den <= maxDenominator; den++) {
    const num = Math.round(value * den);
    const error = Math.abs(value - num / den);
    if (error < bestError - 1e-12) { bestError = error; bestNumerator = num; bestDenominator = den; }
  }
  return bestError < 1e-9 ? [bestNumerator, bestDenominator] : [0, 2];
}

export function describeNode(node) {
  switch (node.type) {
    case "num": return formatNumber(node.value);
    case "const": return node.name;
    case "var": return node.name;
    case "group": return `(${describeNode(node.inner)})`;
    case "neg": return `-${describeNode(node.operand)}`;
    case "fact": return `${describeNode(node.operand)}!`;
    case "add": return `${describeNode(node.left)} + ${describeNode(node.right)}`;
    case "sub": return `${describeNode(node.left)} - ${describeNode(node.right)}`;
    case "mul": return node.implicit ? `${describeNode(node.left)}${describeNode(node.right)}` : `${describeNode(node.left)}·${describeNode(node.right)}`;
    case "div": return `${describeNode(node.left)}/${describeNode(node.right)}`;
    case "pow": return `${describeNode(node.base)}^${describeNode(node.exponent)}`;
    case "call": case "apply": return `${node.name}(${node.args.map(describeNode).join(", ")})`;
    case "tuple": return `(${node.items.map(describeNode).join(", ")})`;
    case "relation": return `${describeNode(node.left)} ${node.op} ${describeNode(node.right)}`;
    default: return "?";
  }
}

export function formatNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? "undefined" : value > 0 ? "∞" : "-∞";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9 || magnitude < 1e-6) return value.toExponential(3).replace(/\.?0+e/, "e");
  const rounded = Number(value.toPrecision(digits));
  return String(rounded);
}
