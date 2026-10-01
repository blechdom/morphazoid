export function mountVoiceDisplays(audio,{wave,spectrum,spectrogram,onFrame=()=>{}}) {
  let frame=0,active=true;
  const fit=canvas=>{const ratio=Math.min(2,devicePixelRatio||1),w=Math.round(canvas.clientWidth*ratio),h=Math.round(canvas.clientHeight*ratio);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#080d0d';ctx.fillRect(0,0,w,h);}return canvas.getContext('2d');};
  function draw() {
    if(!active)return;frame=requestAnimationFrame(draw);onFrame();
    const analyser=audio.analyser;
    const time=new Float32Array(analyser?.fftSize??2048),freq=new Uint8Array(analyser?.frequencyBinCount??1024);
    if(analyser){analyser.getFloatTimeDomainData(time);analyser.getByteFrequencyData(freq);}
    for(const [canvas,values,kind] of [[wave,time,'wave'],[spectrum,freq,'spectrum']]) {
      const ctx=fit(canvas),w=canvas.width,h=canvas.height;ctx.fillStyle='#080d0d';ctx.fillRect(0,0,w,h);ctx.strokeStyle=kind==='wave'?'#7fdac8':'#dba3ff';ctx.lineWidth=1.5;ctx.beginPath();
      for(let x=0;x<w;x++){const n=kind==='wave'?Math.floor(x/w*values.length):Math.min(values.length-1,Math.floor((Math.exp(x/w*Math.log(values.length))-1)));const y=kind==='wave'?h*(.5-values[n]*.45):h*(1-values[n]/255);if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
    }
    const ctx=fit(spectrogram),w=spectrogram.width,h=spectrogram.height;ctx.drawImage(spectrogram,-2,0);ctx.fillStyle='#080d0d';ctx.fillRect(w-2,0,2,h);
    for(let y=0;y<h;y++){const n=Math.min(freq.length-1,Math.floor(Math.exp((1-y/h)*Math.log(freq.length))-1)),v=freq[n]/255;ctx.fillStyle=`hsl(${260-150*v} 75% ${v*65}%)`;ctx.fillRect(w-2,y,2,1);}
  }
  draw();return()=>{active=false;cancelAnimationFrame(frame);};
}
