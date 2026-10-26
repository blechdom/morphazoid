// Capture Hiccup Head's actual Zombie Zoid face without running its instrument
// inside Witches Brew. Run against a source preview via MORPHAZOID_QA_BASE_URL.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const baseURL=process.env.MORPHAZOID_QA_BASE_URL || 'http://localhost:5173';
const source=await readFile(new URL('../src/instruments/hiccup-head/hiccup-head-app.js',import.meta.url),'utf8');
const browser=await chromium.launch({channel:'chromium'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  await page.route('**/src/instruments/hiccup-head/hiccup-head-app.js*',route=>route.fulfill({
    contentType:'text/javascript',body:source+`\nglobalThis.captureWitchGhost=async()=>{
      primeVisualSkinAsset('wild-ink');
      const field=visualSkinFieldAssets.get('wild-ink');
      await field.image.decode();field.ready=true;
      const previous={cssWidth,cssHeight,visualSkinId};
      try {
        cssWidth=cssHeight=1024;visualSkinId='wild-ink';
        const surface=document.createElement('canvas');surface.width=surface.height=1280;
        const context=surface.getContext('2d');context.translate(128,128);
        const pose=hiccupHeadState('rubber-face');
        const motion=Object.fromEntries(HICCUP_HEAD_SOUNDS.map(({id})=>[id,0]));
        const beat={active:false,step:0,ordinal:0,pulse:0,stepPulse:0,hitPulse:0,downbeat:true};
        drawFace(context,faceLayout(pose),pose,motion,0,0,beat);
        const pixels=context.getImageData(0,0,1280,1280).data;
        let left=1280,top=1280,right=0,bottom=0;
        for(let y=0;y<1280;y++)for(let x=0;x<1280;x++)if(pixels[(y*1280+x)*4+3]>8) {
          left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
        }
        if(right<=left||bottom<=top)throw new Error('The native ghost portrait is empty.');
        const width=right-left+1,height=bottom-top+1,scale=Math.min(480/width,480/height);
        const portrait=document.createElement('canvas');portrait.width=portrait.height=512;
        portrait.getContext('2d').drawImage(surface,left,top,width,height,
          (512-width*scale)/2,(512-height*scale)/2,width*scale,height*scale);
        return portrait.toDataURL('image/webp',.96).split(',')[1];
      } finally {
        cssWidth=previous.cssWidth;cssHeight=previous.cssHeight;visualSkinId=previous.visualSkinId;
      }
    };`,
  }));
  await page.goto(new URL('hiccup-head.html',baseURL).href);
  await page.waitForFunction(()=>typeof globalThis.captureWitchGhost==='function');
  const data=await page.evaluate(()=>globalThis.captureWitchGhost());
  await mkdir(new URL('../assets/witch/',import.meta.url),{recursive:true});
  await writeFile(new URL('../assets/witch/hiccup-head-bloody.webp',import.meta.url),Buffer.from(data,'base64'));
} finally { await browser.close(); }
