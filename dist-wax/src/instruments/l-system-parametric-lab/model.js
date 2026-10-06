/** Numeric modules shared by the two Rust L-system laboratories. */
export const LAB_KINDS = Object.freeze(['parametric', 'context', 'thue-morse', 'fibonacci', 'penrose', 'sphinx']);
export const LAB_LIMITS = Object.freeze({ iterations: [1, 24], lengthRatio: [.2, 1.25], angleIncrement: [-90, 90],
  delayRatio: [.2, 2], pitchRatio: [.5, 2], branchCount: [2, 6], minLength: [.001, 1], contextStrength: [0, 1], symbolRatio: [.25, 4] });
export function defaultLab(kind = 'parametric') {
  return { kind: LAB_KINDS.includes(kind) ? kind : 'parametric', iterations: 6, lengthRatio: .72, angleIncrement: 0,
    delayRatio: .72, pitchRatio: 1, branchCount: 2, minLength: .03, contextStrength: .5, symbolRatio: 1.5 };
}
export function sanitizeLab(candidate = {}) {
  const defaults = defaultLab(candidate?.kind), next = { kind: defaults.kind };
  for (const [key, [low, high]] of Object.entries(LAB_LIMITS)) {
    const value = Number(candidate?.[key]);
    next[key] = Math.max(low, Math.min(high, Number.isFinite(value) ? value : defaults[key]));
  }
  next.iterations = Math.round(next.iterations); next.branchCount = Math.round(next.branchCount);
  return next;
}
export function randomLab(kind, random = Math.random) {
  const unit = () => Math.max(0, Math.min(1, Number(random()) || 0)), between = (a, b) => a + (b - a) * unit();
  return sanitizeLab({ kind, iterations: Math.floor(between(3, 9)), lengthRatio: between(.45, .95), angleIncrement: between(-24, 24),
    delayRatio: between(.45, 1.35), pitchRatio: between(.8, 1.2), branchCount: Math.floor(between(2, 7)), minLength: between(.008, .08),
    contextStrength: unit(), symbolRatio: between(.5, 2.5) });
}
