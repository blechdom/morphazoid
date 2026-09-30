import { angleAt } from "./domino-run-model.js";
import { samplePolyline } from "./domino-run-drawing.js";
import { canvasSizing } from "../../graphics/canvas-sizing.js";

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function tint(hex, amount = 0) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  const n = parseInt(match?.[1] ?? "a8a78c", 16);
  return `rgb(${[16, 8, 0].map(s => clamp(((n >> s) & 255) + amount, 0, 255)).join(",")})`;
}

// Pick the same projected surfaces that are painted, including their .7px outline.
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
      for (const dx of [-d.height, d.height]) for (const dz of [-d.height, d.height]) for (const dy of [0, d.height]) {
        const p = this.raw(d.x + dx, d.elevation + dy, d.z + dz);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
    }
    const w = this.cssWidth, h = this.cssHeight;
    this.scale = Math.min((w - 60) / Math.max(2, x1 - x0), (h - 155) / Math.max(2, y1 - y0)) * this.zoom;
    this.ox = w / 2 - (x0 + x1) / 2 * this.scale;
    this.oy = (h + 38) / 2 - (y0 + y1) / 2 * this.scale;
  }
  polygon(points, color, stroke = "#11140e", alpha = 1) {
    const c = this.ctx;
    c.globalAlpha = alpha; c.beginPath();
    points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
    c.closePath(); c.fillStyle = color; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = .7; c.stroke(); }
    c.globalAlpha = 1;
  }
  box(d, angle, flash = 0, selected = false) {
    const c = this.ctx, ca = Math.cos(d.angle), sa = Math.sin(d.angle);
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
    surfaces.forEach(({points,i}) => this.polygon(points, tint(color, shades[i] + flash * 70), selected ? "#ffe1a0" : "#171a13"));
    const center = this.project(d.x + ca * (d.depth / 2 + d.height * st * .5), d.elevation + d.height * ct * .5, d.z + sa * (d.depth / 2 + d.height * st * .5));
    const base = this.project(d.x,d.elevation,d.z);
    this.hits.push({ id: d.id, x: center.x, y: center.y, bx: base.x, by: base.y, radius: Math.max(10, Math.min(30, d.height * this.scale * .45)), polygons: surfaces.map(({points}) => points) });
    if (this.scale * d.height > 20 && angle < 1.4) {
      const face = [vertices[2],vertices[3],vertices[7],vertices[6]];
      c.save(); c.beginPath(); face.forEach((p,i) => i ? c.lineTo(p.x,p.y) : c.moveTo(p.x,p.y)); c.closePath(); c.clip();
      c.strokeStyle = tint(color,-40); c.lineWidth = .65;
      if (d.material === "stone") {
        c.beginPath(); c.moveTo(center.x-6,center.y-10); c.lineTo(center.x+2,center.y-1); c.lineTo(center.x-1,center.y+6); c.lineTo(center.x+8,center.y+12); c.stroke();
      } else if (d.material === "wood") {
        for(let k=-1;k<=1;k++) { c.beginPath(); c.moveTo(center.x+k*4-4,center.y-18); c.lineTo(center.x+k*4+4,center.y+18); c.stroke(); }
      } else {
        c.fillStyle = tint(color,55); c.globalAlpha=.65; c.beginPath();c.arc(center.x,center.y,Math.max(1.1,this.scale*.028),0,Math.PI*2);c.fill();
      }
      c.restore();
    }
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
      const p=this.project(d.x,0,d.z);
      c.fillStyle="#080b08";c.globalAlpha=.25;c.beginPath();c.ellipse(p.x,p.y,d.height*this.scale*.46,d.height*this.scale*.13,this.yaw,0,Math.PI*2);c.fill();c.globalAlpha=1;
      if(d.elevation>.025) {
        const x=d.x,z=d.z,r=d.height*.37, y=d.elevation;
        const a=this.project(x-r,0,z-r),b=this.project(x+r,0,z-r),e=this.project(x+r,0,z+r),f=this.project(x-r,0,z+r);
        const at=this.project(x-r,y,z-r),bt=this.project(x+r,y,z-r),et=this.project(x+r,y,z+r),ft=this.project(x-r,y,z+r);
        this.polygon([a,b,bt,at],"#292f26");this.polygon([b,e,et,bt],"#363b2d");this.polygon([e,f,ft,et],"#2d3327");this.polygon([at,bt,et,ft],"#4a503c","#62664c");
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
      c.strokeStyle="#f2cd88";c.lineWidth=2;c.setLineDash([5,4]);c.beginPath();
      draft.points.forEach((point,i)=>{const p=this.project(point.x,.03,point.z);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});
      c.stroke();c.setLineDash([]);
      const samples=samplePolyline(draft.points,{spacing:1.2*run.params.size*run.params.spacing,maxPoints:512});
      c.fillStyle="#ffe0a0";
      for(const point of samples){const p=this.project(point.x,.04,point.z);c.beginPath();c.arc(p.x,p.y,2.3,0,Math.PI*2);c.fill();}
      if(draft.cursor){const p=this.project(draft.cursor.x,.05,draft.cursor.z);c.lineWidth=1;c.beginPath();c.moveTo(p.x-7,p.y);c.lineTo(p.x+7,p.y);c.moveTo(p.x,p.y-7);c.lineTo(p.x,p.y+7);c.stroke();}
    }
  }
  hit(x,y) {
    // Last painted wins where dominoes overlap; a nearer center may be hidden.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const p = this.hits[i];
      if (p.polygons) {
        if (p.polygons.some(points => containsPoint(points, x, y))) return p.id;
      } else if (Math.hypot(x - p.x, y - p.y) < p.radius) {
        // Lifted-out dominoes retain their small editing-marker target.
        return p.id;
      }
    }
    return null;
  }
}
