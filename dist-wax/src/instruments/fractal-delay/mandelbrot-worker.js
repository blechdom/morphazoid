// The parameter map is independent of audio and recomputed only once.
self.onmessage=({data})=>{
  const {width=240,height=120}=data, pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const cr=-2+3*x/(width-1),ci=1.5-3*y/(height-1);let zr=0,zi=0,n=0;
    for(;n<100&&zr*zr+zi*zi<16;n++){const next=zr*zr-zi*zi+cr;zi=2*zr*zi+ci;zr=next;}
    const at=(y*width+x)*4,t=n===100?0:Math.min(1,n/30);
    pixels[at]=n===100?28:18+70*t;pixels[at+1]=n===100?80:34+145*t;pixels[at+2]=n===100?72:46+115*t;pixels[at+3]=255;
  }
  self.postMessage({width,height,pixels},[pixels.buffer]);
};
