import { getWitchShapeFrame, WITCH_SHAPE_COLORS } from './witch-shape-model.js';

const TAU=Math.PI*2;
const tint=amount=>amount<=0?WITCH_SHAPE_COLORS.solid:amount>=1?WITCH_SHAPE_COLORS.hyper
  :`rgb(${Math.round(120+83*amount)},${Math.round(167-24*amount)},255)`;

function polygon(context,points,radius) {
  context.beginPath();
  points.forEach((point,index)=>index?context.lineTo(point.x*radius,point.y*radius):context.moveTo(point.x*radius,point.y*radius));
  context.closePath();
}

/** Small native Shapes wire sculpture. No labels, independent clock, image,
 * offscreen canvas or continually rotating decorative animation is needed. */
export function drawWitchShapeCharm(context,state = {},anchor = {x:344,y:657,r:38}) {
  const frame=getWitchShapeFrame(state),{x,y,r}=anchor;
  context.save();context.fillStyle='#080d19a8';context.beginPath();
  context.ellipse(x,y+r+4,r*.84,7,0,0,TAU);context.fill();
  context.translate(x,y);context.lineCap='round';context.lineJoin='round';
  for(const layer of frame.layers) {
    const {geometry}=layer;
    context.save();context.globalAlpha*=layer.alpha;
    const opacity=context.globalAlpha;
    for(const face of [...geometry.faces].sort((a,b)=>a.depth-b.depth)) {
      if(face.alpha<.001)continue;
      polygon(context,face.points,r);
      context.globalAlpha=opacity*face.alpha*(geometry.faces.length>40?.025:.075);
      context.fillStyle=tint(face.color);context.fill();
    }
    for(const edge of [...geometry.edges].sort((a,b)=>a.depth-b.depth)) {
      if(edge.alpha<.001)continue;
      const depth=Math.max(0,Math.min(1,(edge.depth+1.2)/2.4));
      context.globalAlpha=opacity*edge.alpha*(.3+depth*.64)*(geometry.edges.length>100?.72:1);
      context.beginPath();context.moveTo(edge.a.x*r,edge.a.y*r);context.lineTo(edge.b.x*r,edge.b.y*r);
      context.strokeStyle=tint(edge.color);context.lineWidth=.85+depth*.65+edge.hyper*.25;
      context.setLineDash(edge.hyper>.65?[2,2.5]:[]);context.stroke();
    }
    context.setLineDash([]);
    // Sparse native endpoints make the near/far cages readable at floor size.
    if(geometry.vertices)for(const point of geometry.vertices.filter((_,i)=>i%Math.max(1,Math.ceil(geometry.vertices.length/24))===0)) {
      context.globalAlpha=opacity*.85;context.beginPath();context.arc(point.x*r,point.y*r,1.15,0,TAU);
      context.fillStyle=geometry.dimension==='4d'?WITCH_SHAPE_COLORS.hyper:WITCH_SHAPE_COLORS.solid;context.fill();
    }
    context.restore();
  }
  context.restore();
  return frame;
}
