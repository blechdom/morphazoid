import { test, expect } from "@playwright/test";
import { readAudioStatus } from "./helpers/audio-probe.mjs";

const state = page => page.locator("#stage").evaluate(e => JSON.parse(e.dataset.state));
const loop = (page, letter) => page.locator(`.network-loop[aria-label="Loop ${letter}"]`);
const gate = (page, from, to, endpoint) => page.getByRole("button", { name: `Route ${from} to ${to} ${endpoint}`, exact: true });
async function ready(page, id) {
  await page.goto(`/${id}.html`);
  await expect(page.locator("#stage")).toHaveAttribute("data-state", /networkVersion/);
}
async function scaledNetwork(page) {
  await page.locator("#networkSurface").evaluate(e => {
    e.style.transformOrigin = "0 0";
    e.style.transform = "translate(38px, 24px) scale(.715, .68)";
  });
  await page.locator("#networkViewport").evaluate(e => e.scrollTo(140, 65));
}
async function pointOnDrawing(page, letter, x, y) {
  // SVG supplies the actual rendered point independently of the app's HTML
  // pointer conversion, including CSS transforms and nested/page scrolling.
  return loop(page, letter).locator(".loop-wave").evaluate((svg, {x,y}) => {
    const p = new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());
    return {x:p.x,y:p.y};
  }, {x,y});
}
async function ringPoint(page, letter, phase) {
  const a=phase*Math.PI*2-Math.PI/2;
  return pointOnDrawing(page,letter,155+142*Math.cos(a),155+142*Math.sin(a));
}
async function drag(page, button, target) {
  const box=await button.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(target.x,target.y,{steps:5});await page.mouse.up();
}

for(const id of ["tape-worm","loop-soup"]) for(const [name,width,height] of [["desktop",1440,900],["phone",390,844],["landscape",844,390]]) {
  test(`${id}: ${name} transformed, scrolled pointer follows the visible network`,async({page})=>{
    await page.setViewportSize({width,height});await ready(page,id);await scaledNetwork(page);
    const node=loop(page,"B"),button=node.locator(".loop-drag");
    await node.locator(".loop-wave").scrollIntoViewIfNeeded();
    const before=(await state(page)).loops.find(l=>l.label==="B"),box=await button.boundingBox();
    const p=await pointOnDrawing(page,"B",155,155),q=await pointOnDrawing(page,"B",205,185);
    await drag(page,button,{x:box.x+box.width/2+q.x-p.x,y:box.y+box.height/2+q.y-p.y});
    await expect.poll(async()=>Math.abs((await state(page)).loops.find(l=>l.label==="B").x-before.x-50)).toBeLessThan(.1);
    expect((await state(page)).loops.find(l=>l.label==="B").y).toBeCloseTo(before.y+30,1);
    if(id==="tape-worm"){
      const out=gate(page,"B","A","exit");await out.scrollIntoViewIfNeeded();
      await drag(page,out,await ringPoint(page,"B",.375));
      // A moved HTML node is laid out on the browser's subpixel grid.
      await expect.poll(async()=>(await state(page)).routes.find(r=>r.from===before.id).departure).toBeCloseTo(.375,4);
      // Clicking the visible ring must also seek to that displayed phase.
      await node.locator(".loop-wave").scrollIntoViewIfNeeded();
      const target=await ringPoint(page,"B",.5);await page.mouse.click(target.x,target.y);
      expect((await state(page)).phase).toBeCloseTo(.5,4);
      expect((await state(page)).loops[(await state(page)).tape].label).toBe("B");
    }
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
  });
}

test("Tape route selection exposes both overlapping native gate handles",async({page})=>{
  await ready(page,"tape-worm");await page.locator("#addLoop").click();
  for(const [from,to]of [["loop-0","loop-2"],["loop-2","loop-1"]]){
    await page.locator("#routeFrom").selectOption(from);await page.locator("#routeTo").selectOption(to);
    await page.locator("#attachRoute").click();
  }
  await scaledNetwork(page);await page.locator("#routePicker").selectOption("route-0");
  for(const [letter,endpoint,target]of [["A","exit",.5],["B","entry",.375]]){
    const handle=gate(page,"A","B",endpoint);await handle.scrollIntoViewIfNeeded();
    await expect(handle).toHaveAttribute("aria-pressed","true");
    expect(await handle.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    await drag(page,handle,await ringPoint(page,letter,target));
    const key=endpoint==="exit"?"departure":"landing";
    await expect.poll(async()=>(await state(page)).routes.find(r=>r.id==="route-0")[key]).toBeCloseTo(target,5);
  }
  const s=await state(page);
  expect(s.routes.find(r=>r.from==="loop-0"&&r.to==="loop-2").departure).toBe(.72);
  expect(s.routes.find(r=>r.from==="loop-2"&&r.to==="loop-1").landing).toBe(.08);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("phone touch: a scaled drag cancels cleanly and keeps native displacement",async({browser,baseURL})=>{
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:844}}),page=await context.newPage();
  try{
    await page.goto(`${baseURL}/loop-soup.html`);await expect(page.locator("#stage")).toHaveAttribute("data-state",/networkVersion/);
    await scaledNetwork(page);await loop(page,"A").locator(".loop-wave").scrollIntoViewIfNeeded();
    const button=loop(page,"A").locator(".loop-drag"),box=await button.boundingBox(),before=(await state(page)).loops[0];
    const p=await pointOnDrawing(page,"A",155,155),q=await pointOnDrawing(page,"A",215,195);
    const x=box.x+box.width/2,y=box.y+box.height/2,cdp=await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+q.x-p.x,y:y+q.y-p.y}]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});
    await expect.poll(async()=>Math.abs((await state(page)).loops[0].x-before.x-60)).toBeLessThan(.2);
    expect((await state(page)).loops[0].y).toBeCloseTo(before.y+40,0);
    await page.locator("#attachRoute").scrollIntoViewIfNeeded();await expect(page.locator("#attachRoute")).toBeInViewport();
    await loop(page,"A").locator(".loop-wave").scrollIntoViewIfNeeded();
    const moved=(await state(page)).loops[0],b=await button.boundingBox();
    await drag(page,button,{x:b.x+b.width/2+14.3,y:b.y+b.height/2});
    await expect.poll(async()=>Math.abs((await state(page)).loops[0].x-moved.x-20)).toBeLessThan(.2);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
  }finally{await context.close();}
});
