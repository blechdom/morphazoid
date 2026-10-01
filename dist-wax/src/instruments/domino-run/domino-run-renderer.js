import { angleAt } from "./domino-run-model.js";
import { MAX_DRAWN_DOMINOES, samplePolyline } from "./domino-run-drawing.js";
import { canvasSizing } from "../../graphics/canvas-sizing.js";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function tint(hex, amount = 0) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  const n = parseInt(match?.[1] ?? "a8a78c", 16);
  return `rgb(${[16, 8, 0].map(s => clamp(((n >> s) & 255) + amount, 0, 255)).join(",")})`;
}

// Keep each full projected face clickable, including wireframe interiors and .7px edges.
function containsPoint(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared, 0, 1) : 0;
    if ((x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 <= .35 ** 2) return true;
    if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * dx / dy) inside = !inside;
  }
  return inside;
}

export class DominoRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.yaw = -.48;
    this.zoom = 1;
    this.tilt = .54;
    this.hits = [];
    this.scale = 1;
    this.ox = this.oy = 0;
    this.cssWidth = this.cssHeight = 1;
    this.resize();
  }
  resize() {
    const size = canvasSizing(this.canvas.getBoundingClientRect(), globalThis.devicePixelRatio, { maxPixelRatio: 1.75, pixelBudget: 2_000_000 });
    this.canvas.width = size.width; this.canvas.height = size.height;
    Object.assign(this, size);
  }
  raw(x, y, z) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { x: x * c - z * s, y: (x * s + z * c) * this.tilt - y * .94, depth: x * s + z * c };
  }
  project(x, y, z) {
    const p = this.raw(x, y, z);
    return { x: p.x * this.scale + this.ox, y: p.y * this.scale + this.oy, depth: p.depth };
  }
  unproject(x, y, elevation = 0) {
    const rx = (x - this.ox) / this.scale;
    const rz = ((y - this.oy) / this.scale + elevation * .94) / this.tilt;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { x: rx * c + rz * s, z: -rx * s + rz * c };
  }
  fit(run) {
    if (!run.dominoes.length) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const d of run.dominoes) {
      // Include the entire falling envelope, thickness, and negative steps.
      const reach = Math.hypot(d.height, d.depth);
      const radius = reach + d.depth / 2 + d.width / 2;
      const bottom = Math.min(0, d.elevation), top = Math.max(0, d.elevation + reach);
      for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) for (const dy of [bottom, top]) {
        const p = this.raw(d.x + dx, dy, d.z + dz);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
    }
    const w = this.cssWidth, h = this.cssHeight;
    this.scale = Math.min(Math.max(1, w - 60) / Math.max(.001, x1 - x0), Math.max(1, h - 155) / Math.max(.001, y1 - y0)) * this.zoom;
    this.ox = w / 2 - (x0 + x1) / 2 * this.scale;
    this.oy = (h + 38) / 2 - (y0 + y1) / 2 * this.scale;
  }
  polygon(points, color, stroke = color, alpha = 1) {
    const c = this.ctx;
    c.globalAlpha = alpha; c.beginPath();
    points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
    c.closePath();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = .7; c.stroke(); }
    c.globalAlpha = 1;
  }
  box(d, angle, flash = 0, selected = false) {
    const ca = Math.cos(d.angle), sa = Math.sin(d.angle);
    const st = Math.sin(angle), ct = Math.cos(angle);
    const vertices = [];
    for (const h of [0, d.height]) for (const t of [-d.depth, 0]) for (const side of [-d.width / 2, d.width / 2]) {
      const forward = d.depth / 2 + h * st + t * ct;
      vertices.push(this.project(d.x + ca * forward - sa * side, d.elevation + h * ct - t * st, d.z + sa * forward + ca * side));
    }
    const color = d.color || "#aaa68c";
    const faces = [[0,1,5,4], [2,3,7,6], [0,2,6,4], [1,3,7,5], [4,5,7,6]];
    const shades = [-35, 5, -20, -8, 28];
    const surfaces = faces.map((face, i) => ({ points: face.map(j => vertices[j]), i, depth: face.reduce((a,j) => a + vertices[j].depth,0) / 4 }))
      .sort((a,b) => a.depth - b.depth);
    surfaces.forEach(({points,i}) => this.polygon(points, selected ? "#ffe1a0" : tint(color, shades[i] + flash * 70)));
    const center = this.project(d.x + ca * (d.depth / 2 + d.height * st * .5), d.elevation + d.height * ct * .5, d.z + sa * (d.depth / 2 + d.height * st * .5));
    const base = this.project(d.x,d.elevation,d.z);
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const point of vertices) {
      bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    this.hits.push({ id: d.id, x: center.x, y: center.y, bx: base.x, by: base.y, radius: Math.max(10, Math.min(30, d.height * this.scale * .45)), bounds, polygons: surfaces.map(({points}) => points) });
  }
  render(run, timeline, time, { selected = 0, showPaths = true, resurrection = 0, autoStand = false, draft = null } = {}) {
    if (!run?.dominoes) return;
    if (!this.fitLocked) this.fit(run);
    const c = this.ctx, w = this.cssWidth, h = this.cssHeight;
    c.setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0);
    c.fillStyle = "#141613"; c.fillRect(0,0,w,h);
    const glow = c.createRadialGradient(w*.48,h*.57,5,w*.48,h*.57,w*.6);
    glow.addColorStop(0,"#292b21"); glow.addColorStop(1,"#141613"); c.fillStyle=glow;c.fillRect(0,0,w,h);
    const falls = new Map();
    for (const f of timeline.falls) if (f.start <= time) falls.set(f.id, f);
    const blocked = new Set((timeline.blockedLinks??[]).map(e => `${e.from}:${e.to}`));
    const byId = new Map(run.dominoes.map(d => [d.id,d]));
    const flashes = new Map();
    for (const e of timeline.events) if (e.time <= time && time-e.time < .16) flashes.set(e.id,Math.max(flashes.get(e.id)||0,1-(time-e.time)/.16));
    if (showPaths) {
      c.lineWidth = 1;
      for (const link of run.links) {
        const a=byId.get(link.from),b=byId.get(link.to);if(!a||!b)continue;
        const pa=this.project(a.x,a.elevation+.015,a.z),pb=this.project(b.x,b.elevation+.015,b.z);
        c.strokeStyle=blocked.has(`${a.id}:${b.id}`)?"#a05e44":"#5c6045";
        c.setLineDash(blocked.has(`${a.id}:${b.id}`)?[3,4]:[]);
        c.beginPath();c.moveTo(pa.x,pa.y);c.lineTo(pb.x,pb.y);c.stroke();
      }
      c.setLineDash([]);
    }
    const ordered=[...run.dominoes].sort((a,b)=>this.raw(a.x,0,a.z).depth-this.raw(b.x,0,b.z).depth);
    for(const d of ordered) {
      if(Math.abs(d.elevation)>.025) {
        const x=d.x,z=d.z,r=d.height*.37, y=d.elevation;
        const a=this.project(x-r,0,z-r),b=this.project(x+r,0,z-r),e=this.project(x+r,0,z+r),f=this.project(x-r,0,z+r);
        const at=this.project(x-r,y,z-r),bt=this.project(x+r,y,z-r),et=this.project(x+r,y,z+r),ft=this.project(x-r,y,z+r);
        this.polygon([a,b,e,f],"#616958");
        this.polygon([a,b,bt,at],"#616958");this.polygon([b,e,et,bt],"#717b64");
        this.polygon([e,f,ft,et],"#616958");this.polygon([at,bt,et,ft],"#8b957c");
      }
    }
    this.hits=[];
    for(const d of ordered) {
      const f=falls.get(d.id);
      let angle=f?angleAt(f,time)*(1-resurrection):0;
      if(autoStand && f && time>=f.standStart){
        const rise=clamp((time-f.standStart)/Math.max(.001,f.standEnd-f.standStart),0,1);
        angle=Math.PI/2*(1-rise*rise*(3-2*rise));
      }
      if(d.enabled===false) {
        const p=this.project(d.x,d.elevation,d.z);c.strokeStyle="#b29068";c.setLineDash([3,3]);c.strokeRect(p.x-5,p.y-4,10,8);c.setLineDash([]);
        this.hits.push({id:d.id,x:p.x,y:p.y,bx:p.x,by:p.y,radius:12});continue;
      }
      this.box(d,angle,flashes.get(d.id)||0,d.id===selected);
      if(run.roots.includes(d.id)) {const p=this.project(d.x,d.elevation+.01,d.z);c.strokeStyle="#e7b871";c.lineWidth=1.5;c.beginPath();c.ellipse(p.x,p.y+4,8,4,0,0,Math.PI*2);c.stroke();}
      if(flashes.has(d.id)){const p=this.project(d.x,d.elevation,d.z);c.strokeStyle=`rgba(247,211,135,${flashes.get(d.id)*.6})`;c.lineWidth=1;c.beginPath();c.ellipse(p.x,p.y,12+(1-flashes.get(d.id))*20,5+(1-flashes.get(d.id))*8,0,0,Math.PI*2);c.stroke();}
    }
    if(draft){
      const rotation = (run.params.rotation ?? 0) * Math.PI / 180;
      const cosine = Math.cos(rotation), sine = Math.sin(rotation), stretch = run.params.stretch ?? 1;
      const draftPoint = (point, elevation = .03) => {
        const x = point.x * stretch;
        return this.project(x * cosine - point.z * sine, elevation, x * sine + point.z * cosine);
      };
      c.strokeStyle="#f2cd88";c.lineWidth=2;c.setLineDash([5,4]);c.beginPath();
      draft.points.forEach((point,i)=>{const p=draftPoint(point);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});
      c.stroke();c.setLineDash([]);
      const samples=samplePolyline(draft.points,{spacing:1.2*run.params.size*run.params.spacing,maxPoints:MAX_DRAWN_DOMINOES});
      c.fillStyle="#ffe0a0";
      for(const point of samples){const p=draftPoint(point,.04);c.beginPath();c.arc(p.x,p.y,2.3,0,Math.PI*2);c.fill();}
      if(draft.cursor){const p=draftPoint(draft.cursor,.05);c.lineWidth=1;c.beginPath();c.moveTo(p.x-7,p.y);c.lineTo(p.x+7,p.y);c.moveTo(p.x,p.y-7);c.lineTo(p.x,p.y+7);c.stroke();}
    }
  }
  hit(x,y) {
    // Choose the frontmost projected domino where wireframe interiors overlap.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const p = this.hits[i];
      if (p.polygons) {
        if (x < p.bounds.minX - .35 || x > p.bounds.maxX + .35 || y < p.bounds.minY - .35 || y > p.bounds.maxY + .35) continue;
        if (p.polygons.some(points => containsPoint(points, x, y))) return p.id;
      } else if (Math.hypot(x - p.x, y - p.y) < p.radius) {
        // Lifted-out dominoes retain their small editing-marker target.
        return p.id;
      }
    }
    return null;
  }
}
