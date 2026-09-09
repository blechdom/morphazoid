import { STEP, TAU, clamp, mix, DEFAULTS, TRICKS, createYoyo, throwYoyo, bindYoyo, tugYoyo, setTrick, stepYoyo, soundingState, snapshot } from "./src/yoyodyne.js";
import { YoyodyneAudio } from "./src/yoyodyne-audio.js";
import { emitMidiOutputPreview } from "./src/midi-output-preview.js";
const $ = id => document.getElementById(id);
const canvas = $("noteStage"), ctx = canvas.getContext("2d");
const audio = new YoyodyneAudio(globalThis);
const listeners = new AbortController(), options = { signal: listeners.signal };
let world = createYoyo(), running = false, automatic = false, hidden = document.hidden, disposed = false;
let history = [snapshot(world)], anchor = 0, clockSource = "", interval = 0, frame = 0, lastUI = 0;
let width = 1, height = 1, scale = 1, originX = 0, originY = 0, pointer = null;
const controls = {
  tempo: ["tempo", v => Math.round(v) + " BPM"],
  stringLength: ["length", v => v.toFixed(2) + " m"],
  throwEnergy: ["energy", v => Math.round(v * 100) + "%"],
  friction: ["friction", v => Math.round(v * 100) + "%"],
  gravity: ["gravity", v => v.toFixed(2) + "×"],
  elasticity: ["elasticity", v => Math.round(v * 100) + "%"],
  tone: ["tone", v => Math.round(v * 100) + "%"],
  rootNote: ["root", v => ["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"][Math.round(v) % 12] + (Math.floor(v / 12) - 1)],
  outputLevel: ["level", v => Math.round(v * 100) + "%"],
};
const modeNames = { held: "IN HAND", unwinding: "THROW / UNWIND", sleeping: "SLEEP / SPIN", rewinding: "BIND / RETURN" };
function clock() {
  return audio.context?.state === "running" ? { value: audio.currentTime, source: "audio" } : { value: performance.now() / 1000, source: "silent" };
}
function reanchor() {
  const c = clock(); clockSource = c.source; anchor = c.value - world.time + 0.012;
  history = [snapshot(world)]; audio.silence();
}
function announce(text) { $("liveStatus").textContent = text; }
function sync() {
  $("playButton").setAttribute("aria-pressed", String(running));
  $("playButton").textContent = running ? "Ⅱ Pause" : "▶ Perform";
  $("throwButton").disabled = world.mode !== "held";
  $("audioButton").setAttribute("aria-pressed", String(audio.armed));
  const audioState = audio.starting ? "starting" : audio.armed ? audio.running ? "on" : "interrupted" : "off";
  $("audioButton").dataset.audioState = audioState;
  $("audioState").textContent = audioState;
  $("transportNotice").textContent = audioState === "interrupted" ? "Audio interrupted — click Audio to resume"
    : running && !audio.armed ? "Audio is off — turn it on to hear playback" : "";
  for (const [id, [key, format]] of Object.entries(controls)) {
    $(id).value = world.settings[key]; $(id + "Out").textContent = format(world.settings[key]);
  }
  for (const button of document.querySelectorAll("[data-trick]")) button.setAttribute("aria-pressed", String(button.dataset.trick === world.trick));
  $("trickDescription").textContent = TRICKS.find(t => t.id === world.trick).description;
  emitMidiOutputPreview({ kind:"timebase", source:"Yo-yo conductor", sourceId:"yoyodyne-conductor", routeId:"yoyodyne",
    rate:world.settings.tempo, unit:"BPM", running:running && automatic, displayValue:world.settings.tempo + " BPM · hand routine" });
}
function run(value, auto = automatic) {
  running = value; automatic = auto;
  reanchor(); sync();
}
function throwOnce() {
  if (!throwYoyo(world)) return;
  run(true, false); announce("Thrown. Drag to guide the hand; T tugs; C returns.");
}
function catchNow() {
  if (world.mode === "held") return;
  bindYoyo(world); run(true, false); announce("Binding back to hand.");
}
function pump() {
  if (disposed || hidden || !running) return;
  const c = clock();
  if (c.source !== clockSource || c.value - (anchor + world.time) > 0.12) reanchor();
  const end = c.value - anchor + 0.05, frames = [];
  let count = 0;
  while (world.time < end && count++ < 36) {
    stepYoyo(world, { automatic });
    history.push(snapshot(world));
    if (audio.running) frames.push({ time: anchor + world.time, state: soundingState(world) });
    const handSettled = !world.targetHand || Math.hypot(world.hand.x - world.targetHand.x, world.hand.y - world.targetHand.y) < 0.001;
    if (!automatic && world.mode === "held" && pointer === null && handSettled) {
      running = false; audio.silence(); sync(); break;
    }
  }
  if (history.length > 140) history.splice(0, history.length - 140);
  if (running) audio.send(frames);
}
function displayed() {
  if (!running || history.length < 2) return snapshot(world);
  const time = clock().value - anchor;
  let index = history.findIndex(p => p.time >= time);
  if (index < 0) return history.at(-1);
  if (index === 0) return history[0];
  const a = history[index - 1], b = history[index], t = clamp((time - a.time) / (b.time - a.time), 0, 1);
  return { ...a, time, x: mix(a.x, b.x, t), y: mix(a.y, b.y, t),
    hand: { x: mix(a.hand.x, b.hand.x, t), y: mix(a.hand.y, b.hand.y, t) },
    stringPoints: a.stringPoints.length === b.stringPoints.length ? a.stringPoints.map((p, i) => ({ x: mix(p.x, b.stringPoints[i].x, t), y: mix(p.y, b.stringPoints[i].y, t) })) : a.stringPoints };
}
function resize() {
  const bounds = $("stageWrap").getBoundingClientRect();
  width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scale = Math.min(width / 2.8, height / 2.55);
  originX = width / 2; originY = height * 0.44;
}
const point = p => ({ x: originX + p.x * scale, y: originY + p.y * scale });
function stroke(points, color, lineWidth = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
}
function circle(x, y, r, fill, strokeColor) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.stroke(); }
}
function draw(p) {
  ctx.clearRect(0, 0, width, height);
  const body = point(p), hand = point(p.hand), energy = p.sound.energy;
  // Quiet spatial references, not note locations or a timeline.
  ctx.save(); ctx.setLineDash([2, 10]);
  for (const radius of [0.38, 0.72, 1.08]) {
    ctx.strokeStyle = "#89b4ad0f"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(originX, originY, radius * scale, 0, TAU); ctx.stroke();
  }
  ctx.restore();
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1], b = history[i];
    if (b.time > p.time || p.time - b.time > 0.55) continue;
    const alpha = (1 - (p.time - b.time) / 0.55) * 0.25;
    stroke([point(a), point(b)], "rgba(238,184,113," + alpha + ")", 1.4);
  }
  // The performer: body stays above the rig; the two arms follow its anchors.
  const shoulder = point({ x: 0, y: -0.29 }), head = point({ x: 0, y: -0.43 });
  const torso = point({ x: 0, y: -0.13 });
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  stroke([point({x:-0.11,y:-0.06}),torso,point({x:0.11,y:-0.06})], "#78968e", 3);
  stroke([shoulder,torso], "#b2cdc2", 4);
  const offhand = p.mount > 0.01 ? point(p.stringPoints[2]) : point({ x: -0.13, y: p.hand.y + 0.035 });
  stroke([shoulder,point({x:-0.17,y:-0.17}),offhand], "#719189", 2.5);
  stroke([shoulder,point({x:0.15,y:-0.13}),hand], "#d5e7d9", 3);
  circle(head.x, head.y, Math.max(8, scale * 0.057), "#17312f", "#c1dfce");
  ctx.lineWidth = 1; stroke([{x:head.x+2,y:head.y+2},{x:head.x+7,y:head.y+2}], "#e6c394", 1.5);
  // The exact constrained string geometry, with exaggerated sonic vibration.
  const string = p.stringPoints.map(point);
  const direct = Math.hypot(p.x - p.hand.x, p.y - p.hand.y);
  const slack = p.mount ? 0 : Math.sqrt(Math.max(0, p.length * p.length - direct * direct)) * scale * 0.18;
  for (let segment = 1; segment < string.length; segment++) {
    const a = string[segment - 1], b = string[segment], dx = b.x - a.x, dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1, points = [];
    for (let i = 0; i <= 36; i++) {
      const u = i / 36, envelope = Math.sin(u * Math.PI);
      const ripple = Math.sin(u * TAU * 3.5 - p.time * 15) * energy * (2 + world.settings.tone * 3) * envelope;
      const bend = ripple + (segment === string.length - 1 ? slack * envelope : 0);
      points.push({ x: mix(a.x,b.x,u) - dy / length * bend, y: mix(a.y,b.y,u) + dx / length * bend });
    }
    stroke(points, "#a9efcf26", 5 + clamp(p.tension,0,5));
    stroke(points, p.tension > 1.5 ? "#f2c77f" : "#bdf4d7", 1.2 + Math.min(1, p.tension / 6));
  }
  circle(hand.x, hand.y, 4, "#e9f5df");
  // Two offset discs, a visible axle, and spin streaks.
  const r = Math.max(12, scale * 0.057), angle = Math.atan2(p.vy, p.vx) * 0.08;
  ctx.save(); ctx.translate(body.x,body.y); ctx.rotate(angle);
  const halo = ctx.createRadialGradient(0,0,r*0.2,0,0,r*3.6);
  halo.addColorStop(0,"rgba(242,185,111,"+(0.12+energy*0.18)+")"); halo.addColorStop(1,"#edb46700");
  ctx.fillStyle=halo; ctx.fillRect(-r*4,-r*4,r*8,r*8);
  ctx.lineWidth=1;
  circle(-4,0,r,"#56452e","#a58758"); circle(4,0,r,"#e5b876","#ffe0a4");
  circle(4,0,r*.72,"#b6874e","#714b27"); circle(4,0,r*.5,"#132724","#ffe1ab");
  ctx.save(); ctx.translate(4,0); ctx.rotate(p.spin);
  for(let i=0;i<3;i++) {
    ctx.rotate(TAU/3); ctx.beginPath(); ctx.arc(0,0,r*.6,0,.75); ctx.strokeStyle="#fce2b2"; ctx.lineWidth=2; ctx.stroke();
  }
  ctx.restore(); circle(4,0,2.2,"#d7f4dd");
  if (p.omega > 40) {
    ctx.strokeStyle="#ffe2a377"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(4,0,r*1.2,-.5,.7+energy);ctx.stroke();
    ctx.beginPath(); ctx.arc(4,0,r*1.35,2.4,3.5+energy);ctx.stroke();
  }
  ctx.restore();
  if (pointer !== null) { circle(hand.x,hand.y,17,null,"#c7ffdf88"); }
  if (p.mode === "held" && !running) {
    ctx.fillStyle="#9fb9b5"; ctx.font="11px ui-monospace,monospace"; ctx.textAlign="center";
    ctx.fillText("THROW TO SET IT SINGING",width/2,Math.min(height-40,body.y+70));
  }
}
function animate(timestamp) {
  if (hidden || disposed) return;
  const p = displayed(); draw(p);
  if (timestamp - lastUI > 100) {
    lastUI = timestamp;
    $("spinReadout").textContent = Math.round(p.omega / TAU * 60).toLocaleString() + " rpm";
    $("lengthReadout").textContent = p.length.toFixed(2) + " m";
    $("tensionReadout").textContent = p.tension.toFixed(2) + " N";
    $("pitchReadout").textContent = p.mode === "held" ? "— Hz" : Math.round(p.sound.frequency) + " Hz";
    $("modeReadout").textContent = p.mount > .2 ? "CRADLE / MOUNT" : modeNames[p.mode];
    $("throwButton").disabled = world.mode !== "held";
    document.body.dataset.yoyoMode = p.mode;
  }
  frame = requestAnimationFrame(animate);
}
for (const [id, [key]] of Object.entries(controls)) {
  $(id).addEventListener("input", () => { world.settings[key] = Number($(id).value); audio.setLevel(world.settings.level); sync(); }, options);
}
audio.onStateChange = () => { if (!disposed) sync(); };
$("audioButton").addEventListener("click", async () => {
  if (audio.running || audio.starting) { audio.mute(); sync(); return; }
  $("audioError").hidden = true;
  const request = audio.arm(); sync();
  try {
    await request;
    if (disposed) return;
    reanchor(); sync();
  } catch(error) { $("audioError").textContent = "Audio could not start: " + error.message; $("audioError").hidden = false; sync(); }
}, options);
$("playButton").addEventListener("click", () => run(!running, !running ? true : automatic), options);
$("throwButton").addEventListener("click", throwOnce, options);
$("tugButton").addEventListener("click", () => { tugYoyo(world); run(true, automatic); announce("Hand tug."); }, options);
$("catchButton").addEventListener("click", catchNow, options);
$("resetAll").addEventListener("click", () => {
  const trick = world.trick; world = createYoyo(DEFAULTS); world.trick = trick;
  audio.setLevel(world.settings.level); reanchor(); sync(); announce("Rig recalled.");
}, options);
for (const button of document.querySelectorAll("[data-trick]")) {
  button.addEventListener("click", () => { setTrick(world, button.dataset.trick); sync(); announce(button.textContent.trim()); }, options);
}
function pointerPosition(event) {
  const r = canvas.getBoundingClientRect();
  return { x: clamp((event.clientX-r.left-originX)/scale,-.7,.7), y: clamp((event.clientY-r.top-originY)/scale,-.3,.4) };
}
canvas.addEventListener("pointerdown", event => {
  if (pointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
  pointer = event.pointerId; canvas.setPointerCapture(pointer); canvas.focus({preventScroll:true});
  world.targetHand = pointerPosition(event);
  if (!running) run(true, false);
}, options);
canvas.addEventListener("pointermove", event => {
  if (event.pointerId === pointer) world.targetHand = pointerPosition(event);
}, options);
function releasePointer(event) {
  if (pointer !== event.pointerId) return;
  if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
  pointer = null; world.targetHand = null;
}
canvas.addEventListener("pointerup", releasePointer, options);
canvas.addEventListener("pointercancel", releasePointer, options);
canvas.addEventListener("lostpointercapture", releasePointer, options);
canvas.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === "enter") { event.preventDefault(); throwOnce(); }
  if (key === "t") { event.preventDefault(); tugYoyo(world); run(true, automatic); }
  if (key === "c") { event.preventDefault(); catchNow(); }
  if (["arrowleft","arrowright","arrowup","arrowdown"].includes(key)) {
    event.preventDefault();
    const p = world.targetHand ?? { ...world.hand };
    world.targetHand = { x: clamp(p.x+(key==="arrowright"?.08:key==="arrowleft"?-.08:0),-.7,.7),
      y: clamp(p.y+(key==="arrowdown"?.06:key==="arrowup"?-.06:0),-.3,.4) };
    if (!running) run(true, false);
  }
}, options);
function suspend() {
  hidden = true; clearInterval(interval); interval = 0; cancelAnimationFrame(frame); audio.silence();
  pointer = null; world.targetHand = null;
}
function resume() {
  if (disposed) return;
  hidden = false; reanchor(); resize();
  if (!interval) interval = setInterval(pump, 20);
  cancelAnimationFrame(frame); frame = requestAnimationFrame(animate);
}
document.addEventListener("visibilitychange", () => document.hidden ? suspend() : resume(), options);
window.addEventListener("pagehide", event => {
  suspend();
  if (!event.persisted) {
    disposed = true; observer.disconnect(); listeners.abort(); void audio.close();
  }
}, options);
window.addEventListener("pageshow", event => { if (event.persisted) resume(); }, options);
const observer = new ResizeObserver(resize); observer.observe($("stageWrap"));
window.__yoyodyne = Object.freeze({
  getDiagnostics: () => ({ running, automatic, hidden, disposed, audioArmed: audio.armed, audioRunning: audio.running,
    hasContext: !!audio.context, contextState: audio.context?.state ?? null, processorCount: audio.node ? 1 : 0,
    historyCount: history.length, intervalActive: !!interval, world: snapshot(world), settings: { ...world.settings },
    launches: world.launches, catches: world.catches, trick: world.trick }),
});
sync(); resize(); if (!hidden) resume();
