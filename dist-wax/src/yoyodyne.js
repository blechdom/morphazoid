// Kinetic yo-yo: one driven hand, unilateral string, axial spin and a sounding body.
export const STEP = 1 / 240;
export const TAU = Math.PI * 2;
export const MASS = 0.064;
export const RADIUS = 0.034;
export const INERTIA = MASS * RADIUS * RADIUS * 0.65;
export const AXLE = 0.0036;
const MOUNT_LENGTH = 0.25 + 2 * Math.hypot(0.105, 0.12) + 0.21;
export const clamp = (v, lo, hi, fallback = lo) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : fallback));
export const mix = (a, b, t) => a + (b - a) * t;
export const DEFAULTS = Object.freeze({ tempo: 90, length: 0.86, energy: 0.6, friction: 0.24,
  gravity: 1, elasticity: 0.3, tone: 0.28, root: 50, level: 0.4 });
export const TRICKS = Object.freeze([
  { id: "sleeper", name: "Sleeper", tag: "spin / sustain", beats: 6, description: "A strong throw settles into a singing spin, then binds back to hand." },
  { id: "cradle", name: "Rock the Cradle", tag: "mount / sway", beats: 8, description: "A prescribed triangular string mount shortens the sounding span. Hand motion rocks it." },
  { id: "around-world", name: "Around the World", tag: "orbit / sweep", beats: 6, description: "A lateral launch becomes a full swing around the hand, then a controlled return." },
  { id: "gravity-pull", name: "Gravity Pull", tag: "drop / return", beats: 3, description: "A short throw and bind: length and tension draw one rising-and-falling phrase." },
].map(Object.freeze));
export function settings(input = {}) {
  return { tempo: clamp(input.tempo, 45, 180, 90), length: clamp(input.length, 0.35, 1.2, 0.86),
    energy: clamp(input.energy, 0.1, 1, 0.6), friction: clamp(input.friction, 0, 1, 0.24),
    gravity: clamp(input.gravity, 0, 1.8, 1), elasticity: clamp(input.elasticity, 0, 1, 0.3),
    tone: clamp(input.tone, 0, 1, 0.28), root: clamp(input.root, 38, 74, 50), level: clamp(input.level, 0, 0.8, 0.4) };
}
export const trickFor = (id) => TRICKS.find((t) => t.id === id) ?? TRICKS[0];
export function createYoyo(input = {}) {
  return { time: 0, settings: settings(input), trick: "sleeper", mode: "held", age: 0,
    x: 0, y: 0.055, vx: 0, vy: 0, spin: 0, omega: 0, length: 0.055,
    hand: { x: 0, y: 0 }, targetHand: null, handVx: 0, handVy: 0,
    mount: 0, tension: 0, rawTension: 0, pluck: 0, tensionPrevious: 0,
    launches: 0, catches: 0, idle: 0, tug: 0, stringPoints: [{ x: 0, y: 0 }, { x: 0, y: 0.055 }] };
}
export function throwYoyo(w, intensity = 1) {
  if (w.mode !== "held") return false;
  const energy = w.settings.energy * clamp(intensity, 0.15, 1, 1);
  w.mode = "unwinding"; w.age = 0; w.idle = 0; w.mount = 0;
  w.length = 0.055; w.x = w.hand.x; w.y = w.hand.y + w.length;
  w.vx = w.trick === "around-world" ? 5.8 + energy * 2 : 0.13;
  w.vy = w.trick === "around-world" ? 1.5 : 0.65 + energy;
  w.omega = 300 + 500 * energy; w.pluck = 0.35 + energy * 0.5; w.launches++;
  return true;
}
export function bindYoyo(w) {
  if (w.mode === "held" || w.mode === "rewinding") return;
  w.mode = "rewinding"; w.omega *= 0.88; w.mount = 0;
  // Response engagement is an explicit, lossy clutch approximation.
  w.length = Math.max(0.055, Math.hypot(w.x - w.hand.x, w.y - w.hand.y));
  w.pluck = Math.max(w.pluck, 0.4);
}
export function tugYoyo(w) {
  if (w.mode === "held") return throwYoyo(w);
  w.tug = 0.22; w.pluck = Math.max(w.pluck, 0.28);
  return true;
}
export function setTrick(w, id) { w.trick = trickFor(id).id; }
export function stepYoyo(w, { automatic = false, dt = STEP } = {}) {
  dt = clamp(dt, 0, STEP, STEP);
  if (!dt) return w;
  const s = w.settings = settings(w.settings), beat = 60 / s.tempo;
  w.time += dt; w.age += dt; w.idle += dt; w.pluck *= Math.exp(-dt * 15);
  if (automatic && w.mode === "held" && w.idle > beat * 0.45) throwYoyo(w);
  const oldHand = { ...w.hand };
  let hx = 0, hy = 0;
  if (w.trick === "cradle" && w.mode !== "held") {
    hx = 0.18 * Math.sin(w.age * TAU / (beat * 2));
    hy = 0.035 * Math.sin(w.age * TAU / beat);
  }
  if (w.trick === "around-world" && w.mode !== "held") {
    // Circular hand pumping supplies orbital work through string tension.
    // The body is never attracted to a drawn trick path.
    hx = 0.25 * Math.sin(w.age * TAU / beat);
    hy = 0.25 * Math.cos(w.age * TAU / beat);
  }
  if (w.targetHand) { hx = clamp(w.targetHand.x, -0.7, 0.7); hy = clamp(w.targetHand.y, -0.3, 0.4); }
  if (w.tug > 0) { hy -= Math.sin(w.tug / 0.22 * Math.PI) * 0.22; w.tug = Math.max(0, w.tug - dt); }
  w.hand.x += clamp(hx - w.hand.x, -dt * 2, dt * 2);
  w.hand.y += clamp(hy - w.hand.y, -dt * 2, dt * 2);
  w.handVx = (w.hand.x - oldHand.x) / dt; w.handVy = (w.hand.y - oldHand.y) / dt;
  if (w.mode === "held") {
    w.x = w.hand.x; w.y = w.hand.y + 0.055; w.vx = w.vy = w.omega = w.tension = w.rawTension = 0;
    w.length = 0.055; w.mount = 0;
    w.stringPoints = [{ ...w.hand }, { x: w.x, y: w.y }];
    return w;
  }
  if (automatic && w.age > (trickFor(w.trick).beats - 1.2) * beat) bindYoyo(w);
  const mountTarget = w.trick === "cradle" && w.mode === "sleeping" && w.age > beat
    ? clamp((s.length - 0.28) / MOUNT_LENGTH, 0, 1) : 0;
  w.mount += clamp(mountTarget - w.mount, -dt * 2.5, dt * 2.5);
  const anchor = { x: w.hand.x, y: w.hand.y + w.mount * 0.25 };
  const triangleWidth = w.mount * 0.105, triangleHeight = w.mount * 0.12;
  const mountedLength = w.mount * MOUNT_LENGTH;
  const oldX = w.x, oldY = w.y;
  w.vx *= Math.exp(-dt * 0.06); w.vy += 9.81 * s.gravity * dt;
  w.x += w.vx * dt; w.y += w.vy * dt;
  w.omega *= Math.exp(-dt * (0.018 + s.friction * 0.25));
  const direction = w.mode === "unwinding" ? 1 : w.mode === "rewinding" ? -1 : 0;
  const paid = w.length + direction * AXLE * w.omega * dt;
  w.length = clamp(paid, 0.045, Math.max(s.length, direction < 0 ? w.length : s.length));
  if (w.mode === "unwinding" && w.length >= s.length - 1e-5) w.mode = "sleeping";
  if (w.mode === "sleeping") w.length += clamp(s.length - w.length, -dt * 0.6, dt * 0.6);
  const available = Math.max(0.06, w.length - mountedLength);
  const dx = w.x - anchor.x, dy = w.y - anchor.y, distance = Math.hypot(dx, dy) || 1e-8;
  const extension = distance - available;
  w.rawTension = 0;
  if (extension > 0) {
    const nX = dx / distance, nY = dy / distance;
    const coupled = w.mode === "unwinding" || w.mode === "rewinding";
    const compliance = (0.000003 + s.elasticity ** 2 * 0.00012) / (dt * dt);
    const inverseAngular = coupled ? AXLE * AXLE / INERTIA : 0;
    const lambda = -extension / (1 / MASS + inverseAngular + compliance);
    w.x += lambda * nX / MASS; w.y += lambda * nY / MASS;
    if (coupled) {
      const angleCorrection = -direction * AXLE * lambda / INERTIA;
      w.omega = clamp(w.omega + angleCorrection / dt, 0, 1200, 0);
      w.length = clamp(w.length + direction * AXLE * angleCorrection, 0.045, Math.max(s.length, w.length));
    }
    w.rawTension = clamp(-lambda / (dt * dt), 0, 80);
  }
  w.vx = clamp((w.x - oldX) / dt, -12, 12, 0);
  w.vy = clamp((w.y - oldY) / dt, -12, 12, 0);
  if (w.y > 1.45) { w.y = 1.45; w.vy = -Math.abs(w.vy) * 0.22; w.pluck = 0.6; }
  if (w.y < -1.25) { w.y = -1.25; w.vy = Math.abs(w.vy) * 0.22; }
  if (Math.abs(w.x) > 1.5) { w.x = Math.sign(w.x) * 1.5; w.vx *= -0.2; }
  w.tension += (w.rawTension - w.tension) * (1 - Math.exp(-dt * 30));
  w.spin = (w.spin + w.omega * dt) % TAU;
  if (w.mode === "rewinding" && Math.hypot(w.x - w.hand.x, w.y - w.hand.y) < 0.09) {
    w.mode = "held"; w.idle = 0; w.catches++; w.omega = 0; w.pluck = 0;
  } else if (w.mode === "rewinding" && w.omega < 12) {
    w.mode = "sleeping"; // insufficient spin: no invented return energy
  }
  w.stringPoints = w.mount > 0.001 ? [
    { ...w.hand }, anchor,
    { x: anchor.x - triangleWidth, y: anchor.y + triangleHeight },
    { x: anchor.x + triangleWidth, y: anchor.y + triangleHeight }, anchor, { x: w.x, y: w.y },
  ] : [{ ...w.hand }, { x: w.x, y: w.y }];
  return w;
}
export function soundingState(w) {
  const s = w.settings, span = Math.max(0.14, w.length - w.mount * MOUNT_LENGTH);
  const tensile = Math.max(0.025, w.tension / (MASS * 9.81));
  const root = 440 * 2 ** ((s.root - 69) / 12);
  const pitch = clamp(root * 0.8 / span * Math.sqrt(tensile), 45, 1600, root);
  const speed = Math.hypot(w.vx, w.vy), spinEnergy = clamp(w.omega / 620, 0, 1);
  const taut = clamp(w.tension / 0.35, 0, 1);
  const energy = w.mode === "held" ? 0 : spinEnergy * (0.25 + 0.75 * taut) * (0.65 + 0.35 * s.friction);
  return { frequency: pitch, spin: w.omega / TAU, energy, speed: clamp(speed, 0, 10),
    tension: clamp(tensile, 0, 12), friction: s.friction, tone: s.tone,
    pan: clamp(w.x / 1.15, -0.95, 0.95), angle: Math.atan2(w.y - w.hand.y, w.x - w.hand.x),
    pluck: w.pluck, held: w.mode === "held" ? 1 : 0 };
}
export function snapshot(w) {
  return { time: w.time, x: w.x, y: w.y, vx: w.vx, vy: w.vy, omega: w.omega,
    spin: w.spin, tension: w.tension, length: w.length, mount: w.mount, mode: w.mode,
    hand: { ...w.hand }, stringPoints: w.stringPoints.map(p => ({ ...p })), sound: soundingState(w) };
}
