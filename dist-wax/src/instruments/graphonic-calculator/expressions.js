import { CompileError, ParseError, compile, createEnvironment, describeNode, parse, variableNames } from "./parser.js";

export const POLAR_ANGLE = "θ";
export const PARAMETRIC_TIME = "t";
export const RESERVED_LEFT_SIDES = Object.freeze(new Set(["x", "y", "r"]));
const INEQUALITY_OPS = Object.freeze(new Set(["<", ">", "<=", ">="]));

const isVariable = (node, name = null) => node.type === "var" && (name === null || node.name === name);

function literalNumber(node) {
  if (node.type === "num") return node.value;
  if (node.type === "neg" && node.operand.type === "num") return -node.operand.value;
  if (node.type === "group") return literalNumber(node.inner);
  return null;
}

function parseRow(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ast: null, error: null };
  try {
    return { ast: parse(trimmed), error: null };
  } catch (error) {
    if (error instanceof ParseError) return { ast: null, error: error.message, position: error.position };
    throw error;
  }
}

function definitionOf(ast) {
  if (!ast || ast.type !== "relation" || ast.op !== "=") return null;
  const { left, right } = ast;
  if (isVariable(left) && !RESERVED_LEFT_SIDES.has(left.name) && left.name !== POLAR_ANGLE) {
    return { kind: "parameter", name: left.name, body: right };
  }
  if (left.type === "apply" && left.args.every((arg) => isVariable(arg)) && !RESERVED_LEFT_SIDES.has(left.name)) {
    const params = left.args.map((arg) => arg.name);
    if (new Set(params).size !== params.length) return { kind: "invalid", error: "Function parameters must be distinct" };
    return { kind: "function", name: left.name, params, body: right };
  }
  return null;
}

/**
 * Analyze every expression row together: definitions form the shared environment, then each
 * row is classified and compiled. Rows keep their index so the UI can show per-row status.
 */
export function analyzeRows(rows, { angle = "radians" } = {}) {
  const parsed = rows.map((row) => ({ row, ...parseRow(row.text) }));
  const functions = new Map();
  const parameterBodies = new Map();
  const duplicates = new Map();
  for (const entry of parsed) {
    if (!entry.ast || entry.error) continue;
    const definition = definitionOf(entry.ast);
    if (!definition) continue;
    if (definition.kind === "invalid") { entry.error = definition.error; continue; }
    const taken = functions.has(definition.name) || parameterBodies.has(definition.name);
    if (taken) { duplicates.set(entry, definition.name); continue; }
    entry.definition = definition;
    if (definition.kind === "function") functions.set(definition.name, { params: definition.params, body: definition.body });
    else parameterBodies.set(definition.name, definition.body);
  }
  const parameters = new Set(parameterBodies.keys());
  const env = createEnvironment({ angle, functions, parameters });
  const values = evaluateParameters(parameterBodies, functions, env);
  const scope = { ...values.scope };

  return {
    env,
    scope,
    functions,
    parameters: values,
    rows: parsed.map((entry) => classifyRow(entry, { env, scope, functions, parameters, duplicates, parameterValues: values })),
  };
}

function evaluateParameters(parameterBodies, functions, env) {
  const scope = {};
  const errors = new Map();
  const order = [];
  const states = new Map();
  const dependenciesOf = (name) => [...variableNames(parameterBodies.get(name))].filter((other) => parameterBodies.has(other));
  const visit = (name, trail) => {
    const state = states.get(name);
    if (state === "done") return;
    if (state === "active") {
      for (const member of trail.slice(trail.indexOf(name))) errors.set(member, "Circular definition");
      return;
    }
    states.set(name, "active");
    for (const dependency of dependenciesOf(name)) visit(dependency, [...trail, name]);
    states.set(name, "done");
    order.push(name);
  };
  for (const name of parameterBodies.keys()) visit(name, []);
  for (const name of order) {
    if (errors.has(name)) continue;
    try {
      const value = compile(parameterBodies.get(name), env)(scope);
      scope[name] = value;
    } catch (error) {
      if (error instanceof CompileError) errors.set(name, error.message);
      else throw error;
    }
  }
  return { scope, errors, order };
}

function missingVariables(names, allowed, context) {
  return [...names].filter((name) => !allowed.has(name) && !context.parameters.has(name) && !context.functions.has(name));
}

function reservedError(missing) {
  if (missing.includes("r")) return "r is the polar radius: write r = f(θ) or use another letter";
  if (missing.includes(POLAR_ANGLE)) return "θ belongs in a polar curve r = f(θ)";
  if (missing.includes("x") || missing.includes("y")) return "x and y describe curves; this kind of row cannot depend on them";
  return null;
}

function undefinedResult(entry, missing, label, extra = {}) {
  const reserved = reservedError(missing);
  if (reserved) return result(entry, { kind: "error", error: reserved, label, ...extra });
  return result(entry, { kind: "error", missing, error: `Undefined: ${missing.join(", ")}`, label, ...extra });
}

function result(entry, fields) {
  return { id: entry.row.id, text: entry.row.text, kind: "empty", error: null, missing: [], plot: null, value: null, definition: null, label: "", ...fields };
}

function classifyRow(entry, context) {
  if (!entry.ast) return result(entry, { kind: entry.error ? "error" : "empty", error: entry.error, position: entry.position });
  if (entry.error) return result(entry, { kind: "error", error: entry.error });
  if (context.duplicates.has(entry)) return result(entry, { kind: "error", error: `${context.duplicates.get(entry)} is already defined` });
  const { env, scope } = context;
  const ast = entry.ast;
  const label = describeNode(ast);
  try {
    if (entry.definition?.kind === "parameter") {
      const { name } = entry.definition;
      const error = context.parameterValues.errors.get(name) ?? null;
      const literal = literalNumber(entry.definition.body);
      const missing = missingVariables(variableNames(entry.definition.body), new Set(), context);
      if (missing.length) return undefinedResult(entry, missing, label, { kind: "parameter", definition: { name } });
      return result(entry, { kind: "parameter", definition: { name, slider: literal !== null }, value: error ? null : scope[name], error, label });
    }
    if (entry.definition?.kind === "function") {
      const { name, params } = entry.definition;
      const missing = missingVariables(variableNames(entry.definition.body), new Set(params), context);
      if (missing.length) return undefinedResult(entry, missing, label, { kind: "function", definition: { name, params } });
      compile(entry.definition.body, env, Object.fromEntries(params.map((param, index) => [param, index])), [name]);
      const plot = params.length === 1 ? { type: "explicit-y", fn: compile(parse(`${name}(x)`), env) } : null;
      return result(entry, { kind: "function", definition: { name, params }, plot, label });
    }
    if (ast.type === "relation") return classifyRelation(entry, ast, context, label);
    if (ast.type === "tuple") return classifyTuple(entry, ast, context, label);
    const names = variableNames(ast);
    const missing = missingVariables(names, new Set(["x", "y", POLAR_ANGLE]), context);
    if (missing.length) return undefinedResult(entry, missing, label);
    const usesX = names.has("x"), usesY = names.has("y"), usesTheta = names.has(POLAR_ANGLE);
    if (usesTheta && !usesX && !usesY) return result(entry, { kind: "polar", plot: { type: "polar", fn: compile(ast, env) }, label });
    if (usesTheta) return result(entry, { kind: "error", error: "Mix θ only with r, not with x or y", label });
    if (usesX && usesY) return result(entry, { kind: "error", error: "Add = to plot a relation between x and y", label });
    if (usesX) return result(entry, { kind: "explicit-y", plot: { type: "explicit-y", fn: compile(ast, env) }, label });
    if (usesY) return result(entry, { kind: "explicit-x", plot: { type: "explicit-x", fn: compile(ast, env) }, label });
    return result(entry, { kind: "value", value: compile(ast, env)(scope), label });
  } catch (error) {
    if (error instanceof CompileError) return result(entry, { kind: "error", error: error.message, label });
    throw error;
  }
}

function classifyRelation(entry, ast, context, label) {
  const { env } = context;
  const { left, right } = ast;
  const names = new Set([...variableNames(left), ...variableNames(right)]);
  const polar = isVariable(left, "r") || isVariable(right, "r");
  if (polar && (names.has("x") || names.has("y"))) return result(entry, { kind: "error", error: "Polar curves use r = f(θ)", label });
  const missing = missingVariables(names, new Set(polar ? [POLAR_ANGLE, "r"] : ["x", "y"]), context);
  if (missing.length) return undefinedResult(entry, missing, label);
  const rightNames = variableNames(right), leftNames = variableNames(left);
  if (INEQUALITY_OPS.has(ast.op)) {
    const flipped = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
    let axis = null, fn = null, op = ast.op;
    if (isVariable(left, "y") && !rightNames.has("y")) { axis = "y"; fn = compile(right, env); }
    else if (isVariable(right, "y") && !leftNames.has("y")) { axis = "y"; fn = compile(left, env); op = flipped[op]; }
    else if (isVariable(left, "x") && !rightNames.has("x")) { axis = "x"; fn = compile(right, env); }
    else if (isVariable(right, "x") && !leftNames.has("x")) { axis = "x"; fn = compile(left, env); op = flipped[op]; }
    if (!axis) return result(entry, { kind: "error", error: "Shading supports y < f(x) and x < g(y) forms for now", label });
    if (names.has(POLAR_ANGLE) || names.has("r")) return result(entry, { kind: "error", error: "Polar inequalities are not supported yet", label });
    return result(entry, { kind: "inequality", plot: { type: "inequality", axis, fn, direction: op.startsWith("<") ? "less" : "greater", strict: !op.endsWith("=") }, label });
  }
  if (polar) {
    const body = isVariable(left, "r") ? right : left;
    const bodyNames = variableNames(body);
    if (bodyNames.has("x") || bodyNames.has("y") || bodyNames.has("r")) return result(entry, { kind: "error", error: "Polar curves use r = f(θ)", label });
    return result(entry, { kind: "polar", plot: { type: "polar", fn: compile(body, env) }, label });
  }
  if (isVariable(left, "y") && !rightNames.has("y")) return result(entry, { kind: "explicit-y", plot: { type: "explicit-y", fn: compile(right, env) }, label });
  if (isVariable(right, "y") && !leftNames.has("y")) return result(entry, { kind: "explicit-y", plot: { type: "explicit-y", fn: compile(left, env) }, label });
  if (isVariable(left, "x") && !rightNames.has("x")) return result(entry, { kind: "explicit-x", plot: { type: "explicit-x", fn: compile(right, env) }, label });
  if (isVariable(right, "x") && !leftNames.has("x")) return result(entry, { kind: "explicit-x", plot: { type: "explicit-x", fn: compile(left, env) }, label });
  const difference = compile({ type: "sub", left, right }, env);
  return result(entry, { kind: "implicit", plot: { type: "implicit", fn: difference }, label });
}

function classifyTuple(entry, ast, context, label) {
  const { env, scope } = context;
  const [first, second] = ast.items;
  const names = new Set([...variableNames(first), ...variableNames(second)]);
  const missing = missingVariables(names, new Set([PARAMETRIC_TIME]), context);
  if (missing.length) return undefinedResult(entry, missing, label);
  if (names.has(PARAMETRIC_TIME)) {
    return result(entry, { kind: "parametric", plot: { type: "parametric", fx: compile(first, env), fy: compile(second, env) }, label });
  }
  const fx = compile(first, env), fy = compile(second, env);
  const draggable = [first, second].map((item) => (isVariable(item) && context.parameterValues.order.includes(item.name) && sliderParameter(item.name, context) ? item.name : null));
  return result(entry, { kind: "point", plot: { type: "point", fx, fy, draggable }, value: null, point: [fx(scope), fy(scope)], label });
}

function sliderParameter(name, context) {
  return context.parameters.has(name);
}

export function parameterText(name, value) {
  return `${name} = ${formatParameterValue(value)}`;
}

export function formatParameterValue(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Number(value.toFixed(6));
  return String(rounded);
}
