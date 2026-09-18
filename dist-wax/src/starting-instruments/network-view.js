import { NETWORK_SIZE } from "./loop-network.js";
import { TAU } from "./common.js";
const NS = "http://www.w3.org/2000/svg";
const colors = ["#a4ddba", "#e6b47c", "#bba5ee", "#7edbe3", "#f3a1b6", "#c7ce86", "#84a5eb", "#dab69d"];
const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, String(value));
  return e;
};
// Same 24-unit play/pause geometry used by Shapes, L-Systems and Graphs.
// Icon faces stay small; the native button can have a larger touch target.
const glyphs = Object.freeze({
  play: ["path", { d: "M8 5.5 18 12 8 18.5Z", fill: "currentColor", stroke: "none" }],
  pause: ["path", { d: "M8 6v12M16 6v12", "stroke-width": 2.5 }],
  record: ["circle", { cx: 12, cy: 12, r: 5, fill: "currentColor", stroke: "none" }],
  stop: ["rect", { x: 7, y: 7, width: 10, height: 10, rx: 1, fill: "currentColor", stroke: "none" }],
  cancel: ["path", { d: "M7 7l10 10M17 7 7 17" }],
  connect: ["path", { d: "M5 18V8a2 2 0 0 1 2-2h11M13 2l5 4-5 4M5 12h7" }],
  reader: ["path", { d: "M7 5v14M11 6l8 6-8 6Z", fill: "currentColor", "stroke-width": 1.5 }],
  hold: ["path", { d: "M7 3v18M3 7h18M17 3v18M3 17h18" }],
  write: ["path", { d: "M5 16 16 5l3 3L8 19l-4 1 1-4ZM13 8l3 3" }],
});
function describeButton(button, label, tooltip = label) {
  button.setAttribute("aria-label", label);
  button.title = tooltip;
}
function setGlyph(button, name) {
  if (button.dataset.glyph === name) return;
  button.dataset.glyph = name;
  const face = document.createElement("span");
  face.className = "loop-button-face";
  face.setAttribute("aria-hidden", "true");
  if (glyphs[name]) {
    const icon = svg("svg", { viewBox: "0 0 24 24", focusable: "false", "aria-hidden": "true" });
    const [tag, attrs] = glyphs[name];
    icon.append(svg(tag, attrs)); face.append(icon);
  } else face.textContent = name; // M and S are intentionally visible letters.
  button.replaceChildren(face);
}
export function ringPoint(loop, phase, radius = NETWORK_SIZE.radius) {
  return { x: loop.x + radius * Math.cos(TAU * phase - Math.PI / 2), y: loop.y + radius * Math.sin(TAU * phase - Math.PI / 2) };
}
export function ringPhase(loop, p) { return ((Math.atan2(p.y - loop.y, p.x - loop.x) + Math.PI / 2) / TAU + 1) % 1; }
function routeGeometry(a, b, route, tape) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const p = tape ? ringPoint(a, route.departure) : { x: a.x + Math.cos(angle) * 143, y: a.y + Math.sin(angle) * 143 };
  const q = tape ? ringPoint(b, route.landing) : { x: b.x - Math.cos(angle) * 143, y: b.y - Math.sin(angle) * 143 };
  const dx = q.x - p.x, dy = q.y - p.y, length = Math.max(1, Math.hypot(dx, dy));
  const bend = length > 550 ? 330 : 48;
  const c = { x: (p.x + q.x) / 2 - dy / length * bend, y: (p.y + q.y) / 2 + dx / length * bend };
  return { p, q, c, mid: { x: p.x * 0.25 + c.x * 0.5 + q.x * 0.25, y: p.y * 0.25 + c.y * 0.5 + q.y * 0.25 },
    d: `M${p.x},${p.y} Q${c.x},${c.y} ${q.x},${q.y}` };
}

/** Native buttons inside the loops remain usable at 48px on touch screens. */
export class NetworkView {
  constructor(surface, tape, handlers, signal) {
    this.surface = surface; this.tape = tape; this.handlers = handlers; this.signal = signal;
    this.nodes = new Map(); this.edges = new Map();
    this.routesSvg = svg("svg", { class: "network-routes", viewBox: `0 0 ${NETWORK_SIZE.width} ${NETWORK_SIZE.height}`, "aria-hidden": "true" });
    const defs = svg("defs"), marker = svg("marker", { id: "networkArrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
    marker.append(svg("path", { d: "M0 1L9 5L0 9", fill: "none", stroke: "#bfd0dc", "stroke-width": 2 }));
    defs.append(marker); this.routesSvg.append(defs); surface.append(this.routesSvg);
    this.nodeLayer = document.createElement("div"); this.nodeLayer.className = "network-nodes"; surface.append(this.nodeLayer);
    this.routeLayer = document.createElement("div"); this.routeLayer.className = "network-route-controls"; surface.append(this.routeLayer);
  }
  on(node, event, handler) { node.addEventListener(event, handler, { signal: this.signal }); }
  button(parent, text, label, handler, className = "") {
    const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.className = className;
    describeButton(b, label); this.on(b, "click", handler); parent.append(b); return b;
  }
  iconButton(parent, glyph, label, handler, className = "") {
    const b = this.button(parent, "", label, handler, `loop-icon-button ${className}`.trim());
    setGlyph(b, glyph); return b;
  }
  createNode(loop) {
    const node = document.createElement("section"); node.className = "network-loop"; node.dataset.loopId = loop.id;
    node.setAttribute("aria-label", `Loop ${loop.label}`);
    node.style.setProperty("--loop-color", colors[Number(loop.id.split("-")[1]) % colors.length]);
    const drawing = svg("svg", { class: "loop-wave", viewBox: "0 0 310 310", "aria-hidden": "true" });
    const rim = svg("circle", { class: "loop-rim", cx: 155, cy: 155, r: 142, fill: "var(--loop-fill)", stroke: "#31413d", "stroke-width": 1 });
    const wave = svg("path", { class: "loop-waveform", fill: "none", stroke: "var(--loop-color)", "stroke-width": 2 });
    const head = svg("circle", { class: "loop-head", r: 8, fill: "#fff2d6", stroke: "#141e25", "stroke-width": 2 });
    drawing.append(rim, wave, head); node.append(drawing);
    this.on(drawing, "pointerdown", (e) => this.handlers.ring(e, loop.id));
    const center = document.createElement("div"); center.className = "loop-center"; node.append(center);
    const move = this.button(center, loop.label, `Move or select loop ${loop.label}`, () => this.handlers.select(loop.id), "loop-drag");
    this.on(move, "pointerdown", (e) => this.handlers.drag(e, loop.id));
    this.on(move, "keydown", (e) => {
      if (e.key.startsWith("Arrow")) { this.handlers.moveKey(loop.id, e.key, e.shiftKey ? 30 : 10); e.preventDefault(); }
    });
    const time = document.createElement("span"); time.className = "loop-duration"; center.append(time);
    const transport = document.createElement("div"); transport.className = "loop-transport"; center.append(transport);
    transport.setAttribute("role", "group"); transport.setAttribute("aria-label", `Loop ${loop.label} transport`);
    const pause = this.iconButton(transport, "play", `Play loop ${loop.label}`, () => this.handlers.transport(loop.id), "loop-play");
    const record = this.iconButton(transport, "record", `Record loop ${loop.label}`, () => this.handlers.record(loop.id), "loop-record");
    const mute = this.iconButton(transport, "M", `Mute loop ${loop.label}`, () => this.handlers.toggle(loop.id, "muted"), "loop-mute");
    const solo = this.iconButton(transport, "S", `Solo loop ${loop.label}`, () => this.handlers.toggle(loop.id, "solo"), "loop-solo");
    const bottom = document.createElement("div"); bottom.className = "loop-links"; center.append(bottom);
    const connect = this.iconButton(bottom, "connect", `Connect from loop ${loop.label}`, () => this.handlers.connect(loop.id), "loop-connect");
    const action = this.iconButton(bottom, this.tape ? "reader" : "hold", this.tape ? `Move reader to loop ${loop.label}` : `Hold loop ${loop.label}`,
      () => this.handlers.activate(loop.id));
    const state = document.createElement("span"); state.className = "loop-state"; center.append(state);
    this.nodeLayer.append(node);
    const result = { node, wave, head, move, time, record, pause, mute, solo, connect, action, state, label: loop.label };
    this.nodes.set(loop.id, result); return result;
  }
  createEdge(route) {
    const path = svg("path", { fill: "none", stroke: "#92adba", "stroke-width": 2, "marker-end": "url(#networkArrow)" });
    const hit = svg("path", { fill: "none", stroke: "transparent", "stroke-width": 18, class: "route-hit" });
    this.on(hit, "click", () => this.handlers.selectRoute(route.id));
    this.routesSvg.append(path, hit);
    const select = this.button(this.routeLayer, "→", "Select route", () => this.handlers.selectRoute(route.id), "network-route-label");
    let out, entry;
    if (this.tape) {
      out = this.button(this.routeLayer, "OUT", "Move route exit", () => this.handlers.selectRoute(route.id, false), "network-port");
      entry = this.button(this.routeLayer, "IN", "Move route entry", () => this.handlers.selectRoute(route.id, false), "network-port network-port-in");
      this.on(out, "pointerdown", (e) => this.handlers.gate(e, route.id, "departure"));
      this.on(entry, "pointerdown", (e) => this.handlers.gate(e, route.id, "landing"));
    }
    const result = { path, hit, select, out, entry }; this.edges.set(route.id, result); return result;
  }
  update(s, selected, selectedRoute, connecting, pendingRecord) {
    for (const [id, view] of this.nodes) if (!s.loops.some((l) => l.id === id)) { view.node.remove(); this.nodes.delete(id); }
    for (const [id, v] of this.edges) if (!s.routes.some((r) => r.id === id)) {
      for (const el of Object.values(v)) el?.remove(); this.edges.delete(id);
    }
    s.loops.forEach((loop, i) => {
      const v = this.nodes.get(loop.id) ?? this.createNode(loop);
      v.node.style.left = `${loop.x - 155}px`; v.node.style.top = `${loop.y - 155}px`;
      v.node.classList.toggle("is-selected", selected === loop.id);
      v.node.classList.toggle("is-paused", loop.paused); v.node.classList.toggle("is-muted", loop.muted);
      const capture = s.recording?.loopId === loop.id, pending = pendingRecord === loop.id;
      setGlyph(v.record, pending ? "cancel" : capture ? "stop" : "record");
      describeButton(v.record, `${pending ? "Cancel recording" : capture ? "Stop recording" : "Record"} loop ${loop.label}`);
      v.record.setAttribute("aria-pressed", String(capture || pending));
      v.record.disabled = Boolean((s.recording && !capture) || (pendingRecord && !pending));
      const running = !loop.paused && (s.playing || capture);
      setGlyph(v.pause, running ? "pause" : "play");
      describeButton(v.pause, `${running ? "Pause" : loop.paused ? "Resume" : "Play"} loop ${loop.label}`);
      v.pause.setAttribute("aria-pressed", String(running));
      v.mute.setAttribute("aria-pressed", String(loop.muted)); v.solo.setAttribute("aria-pressed", String(loop.solo));
      describeButton(v.mute, `Mute loop ${loop.label}`, `${loop.muted ? "Unmute" : "Mute"} loop ${loop.label}`);
      describeButton(v.solo, `Solo loop ${loop.label}`, `${loop.solo ? "Release solo" : "Solo"} loop ${loop.label}`);
      v.connect.setAttribute("aria-pressed", String(connecting === loop.id));
      describeButton(v.connect, `Connect from loop ${loop.label}`, connecting === loop.id ? "Cancel connection" : `Connect from ${loop.label} · then choose a destination letter`);
      v.time.textContent = capture ? `${s.recording.seconds.toFixed(1)} / 12 s${s.recording.paused ? " · paused" : ""}` : `${loop.duration.toFixed(2)} s`;
      v.node.classList.toggle("is-recording", capture);
      if (!this.tape) {
        setGlyph(v.action, loop.mode === "hold" ? "write" : "hold");
        describeButton(v.action, `${loop.mode === "hold" ? "Overdub" : "Hold"} loop ${loop.label}`,
          loop.mode === "hold" ? `Resume overdubbing loop ${loop.label}` : `Hold loop ${loop.label} · protect recorded audio`);
        v.action.setAttribute("aria-pressed", String(loop.mode === "hold"));
      }
      v.state.textContent = capture ? "MIC → TAPE" : this.tape ? (s.tape === i ? "READER" : loop.name === "Empty tape" ? "EMPTY" : "") : loop.mode.toUpperCase();
      v.state.title = loop.name;
      const points = s.waves?.[i] ?? [];
      v.wave.setAttribute("d", points.map((value, j) => {
        const p = ringPoint({ x: 155, y: 155 }, j / points.length, 137 + Math.min(13, value * 24));
        return `${j ? "L" : "M"}${p.x},${p.y}`;
      }).join("") + "Z");
      const p = ringPoint({ x: 155, y: 155 }, this.tape ? s.phase : s.phases?.[i] || 0, 142);
      v.head.setAttribute("cx", p.x); v.head.setAttribute("cy", p.y);
      v.head.style.display = this.tape && s.tape !== i ? "none" : "";
    });
    for (const route of s.routes) {
      const a = s.loops.find((l) => l.id === route.from), b = s.loops.find((l) => l.id === route.to);
      if (!a || !b) continue;
      const v = this.edges.get(route.id) ?? this.createEdge(route), g = routeGeometry(a, b, route, this.tape);
      // Route labels must never cover a loop's record/pause buttons, including
      // when users drag another loop into the path.
      const labelPoint = { ...g.mid };
      for (let attempt = 0; attempt < 8 && s.loops.some((l) => Math.hypot(l.x - labelPoint.x, l.y - labelPoint.y) < 170); attempt++) {
        labelPoint.y = Math.min(NETWORK_SIZE.height - 30, labelPoint.y + 65);
      }
      v.path.setAttribute("d", g.d); v.hit.setAttribute("d", g.d);
      v.path.setAttribute("stroke", selectedRoute === route.id ? "#fff0b3" : "#8ca4b4");
      v.path.setAttribute("stroke-width", this.tape ? 2 : 1.5 + route.gain * 5);
      v.path.setAttribute("stroke-dasharray", route.enabled ? "" : "6 8");
      v.select.textContent = `${a.label} → ${b.label}`;
      describeButton(v.select, `Edit route ${a.label} to ${b.label}`);
      v.select.setAttribute("aria-pressed", String(selectedRoute === route.id));
      for (const [el, p] of [[v.select, labelPoint], [v.out, g.p], [v.entry, g.q]]) if (el) {
        el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
      }
      if (v.out) describeButton(v.out, `Route ${a.label} to ${b.label} exit`);
      if (v.entry) describeButton(v.entry, `Route ${a.label} to ${b.label} entry`);
    }
  }
  focus(id) { this.nodes.get(id)?.node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }
}
