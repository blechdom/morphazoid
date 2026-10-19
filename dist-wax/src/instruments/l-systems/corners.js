// Instrument-owned geometric accents. No extra audio nodes or hidden readers.
export const DEFAULT_CORNER_STATE = Object.freeze({ emphasis: .45, minimumAngle: 12, width: .2, placement: "all" });
const clamp = (n, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(Number(n)) ? Number(n) : fallback));
const metadata = new WeakMap();
const endpoint = Object.freeze({ angle: 0, fork: false, endpoint: true });

function connected(parent, child) {
  if (!parent || !child) return false;
  const scale = Math.max(1, Math.hypot(parent.end.x-parent.start.x, parent.end.y-parent.start.y), Math.hypot(child.end.x-child.start.x, child.end.y-child.start.y));
  return Math.hypot(parent.end.x-child.start.x, parent.end.y-child.start.y) <= scale * 1e-8
    && Math.abs(parent.endDistance-child.startDistance) <= Math.max(1, Math.abs(child.startDistance)) * 1e-8;
}
function angleBetween(parent, child) {
  const ax=parent.end.x-parent.start.x, ay=parent.end.y-parent.start.y;
  const bx=child.end.x-child.start.x, by=child.end.y-child.start.y;
  const lengths=Math.hypot(ax,ay)*Math.hypot(bx,by);
  return lengths > 1e-12 ? Math.acos(clamp((ax*bx+ay*by)/lengths,-1,1,1))*180/Math.PI : 0;
}
function cornerData(trace) {
  if (metadata.has(trace)) return metadata.get(trace);
  const ends=trace.segments.map(segment=>{
    const children=segment.children.map(i=>trace.segments[i]).filter(child=>connected(segment,child));
    return children.length ? { angle:Math.max(...children.map(child=>angleBetween(segment,child))), fork:children.length>1, endpoint:false } : endpoint;
  });
  const entries=trace.segments.map(segment=>({
    start:connected(trace.segments[segment.parentIndex],segment) ? ends[segment.parentIndex] : endpoint,
    end:ends[segment.index],
  }));
  const result={entries, selectedKey:null, selected:[]};metadata.set(trace,result);return result;
}
export function lSystemsCornersForHead(head) {
  if (head.corners) return head.corners;
  const index=head.index ?? head.segmentIndex ?? head.segment?.index;
  return head.sourceTrace ? cornerData(head.sourceTrace).entries[index] : null;
}
export function lSystemsIsCorner(vertex, minimumAngle=12, includeEndpoints=false) {
  if (!vertex) return false;
  if (vertex.endpoint) return includeEndpoints;
  return (vertex.fork || vertex.angle > 1e-5) && vertex.angle + 1e-6 >= minimumAngle;
}
export function lSystemsCornerContact(head, direction=1, minimumAngle=12) {
  const corners=lSystemsCornersForHead(head);
  const atBoundary=direction<0 ? head.subdivisionIndex===head.subdivisions-1 : head.subdivisionIndex===0;
  return atBoundary && lSystemsIsCorner(direction<0 ? corners?.end : corners?.start,minimumAngle,true);
}
export function lSystemsCornerPulse(head, settings=DEFAULT_CORNER_STATE) {
  const corners=lSystemsCornersForHead(head);
  if (!corners) return 0;
  const width=clamp(settings.width,.04,.5,DEFAULT_CORNER_STATE.width);
  const minimum=clamp(settings.minimumAngle,0,180,DEFAULT_CORNER_STATE.minimumAngle);
  const progress=clamp(head.progress,0,1,0);
  const rounded=x=>{const u=clamp(x,0,1,0);return u*u*(3-2*u);};
  const start=lSystemsIsCorner(corners.start,minimum,true) ? rounded(1-progress/width) : 0;
  const end=lSystemsIsCorner(corners.end,minimum,true) ? rounded(1-(1-progress)/width) : 0;
  return Math.max(start,end);
}
export function lSystemsCornerGain(head, settings=DEFAULT_CORNER_STATE, discrete=false) {
  if (discrete && settings.placement === "corners") return 1;
  // Preserve legacy event callers without geometry; accent by contrast, never
  // by lifting an already-bounded peak or changing an envelope's attack time.
  if (!lSystemsCornersForHead(head)) return 1;
  const amount=clamp(settings.emphasis,0,1,DEFAULT_CORNER_STATE.emphasis);
  return 1 - .75*amount*(1-lSystemsCornerPulse(head,settings));
}
export function lSystemsCornerPoints(trace, minimumAngle=12, limit=192) {
  const data=cornerData(trace), cap=Math.max(1,Math.min(192,Math.floor(limit)));
  const key=`${minimumAngle}:${cap}`;
  if (data.selectedKey===key) return data.selected;
  const candidates=trace.segments.filter(segment=>lSystemsIsCorner(data.entries[segment.index].end,minimumAngle));
  const count=Math.min(cap,candidates.length);
  data.selected=Array.from({length:count},(_,i)=>{
    const segment=candidates[Math.floor(i*candidates.length/count)];
    return { ...segment.end, segmentIndex:segment.index };
  });
  data.selectedKey=key;return data.selected;
}
