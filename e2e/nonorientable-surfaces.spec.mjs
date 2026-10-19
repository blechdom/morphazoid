import { expect, test } from "@playwright/test";
import {
  KLEIN_FULL_PRESETS,
  MOEBIUS_FULL_PRESETS,
} from "../src/families/nonorientable/full-presets.js";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

const surfaces = [
  { id: "moebius", href: "moebius-synth.html" },
  { id: "klein-bottle", href: "klein-bottle-synth.html" },
];

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

for (const surface of surfaces) {
  test(`${surface.id} keeps its 2D playhead, transport, view, and audio causally separate`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(surface.href, { waitUntil: "load" });
    const canvas = page.locator("#stage");
    const play = page.locator("#playButton");
    const audio = page.locator("#audioButton");
    await expect(canvas).toBeVisible();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).active).toBe(false);

    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#liveStatus")).toHaveText(
      "Audio is off — turn it on to hear playback",
    );

    await canvas.focus();
    const positionBefore = Number(await page.locator("#position").inputValue());
    await page.keyboard.press("ArrowRight");
    expect(Number(await page.locator("#position").inputValue())).toBeGreaterThan(positionBefore);
    const yawBefore = Number(await page.locator("#planeYaw").inputValue());
    await page.keyboard.press("Shift+BracketLeft");
    expect(Number(await page.locator("#planeYaw").inputValue())).toBe(yawBefore - 12);
    await page.keyboard.press("Home");
    expect(Number(await page.locator("#position").inputValue())).toBeCloseTo(0.5, 1);

    const autoRotate = page.locator("#autoRotateButton");
    await page.locator('[data-section="rotation"]').evaluate((details) => { details.open = true; });
    await autoRotate.click();
    await expect(autoRotate).toHaveAttribute("aria-pressed", "true");
    await setRange(page, "#rotationSpeed", 0.08);
    await expect(autoRotate).toHaveAttribute("aria-pressed", "true");
    await setRange(page, "#rotationX", 16);
    await expect(autoRotate).toHaveAttribute("aria-pressed", "false");

    await page.locator("[data-preset]").last().click();
    await expect(play).toHaveAttribute("aria-pressed", "true");

    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "true");
    await waitForAudioState(page, true);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 50 });
    await testInfo.attach(`${surface.id}-audio-envelope.json`, {
      body: JSON.stringify(envelope, null, 2),
      contentType: "application/json",
    });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.activeSamples).toBeGreaterThan(0);
    expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
    expect(envelope.summary.clippedSamples).toBe(0);

    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await waitForStableAudioState(page, false);
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });
}

test("Mobius counterpoint weave hockets across the orientation reversal", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("moebius-synth.html", { waitUntil: "load" });
  const canvas = page.locator("#stage");
  const play = page.locator("#playButton");
  const audio = page.locator("#audioButton");
  const planeMode = page.locator("#selectPlaneMode");
  const sequenceMode = page.locator("#selectSequenceMode");
  const sequenceState = page.locator("#sequenceState");

  await expect(planeMode).toHaveAttribute("aria-pressed", "true");
  await expect(sequenceMode).toHaveAttribute("aria-pressed", "false");
  await expect(sequenceState).toBeHidden();
  await page.locator("#directionButton").click();
  await expect(page.locator("#directionButton")).toHaveAttribute("data-direction", "reverse");

  await sequenceMode.click();
  await expect(sequenceMode).toHaveAttribute("aria-pressed", "true");
  await expect(planeMode).toHaveAttribute("aria-pressed", "false");
  await expect(sequenceState).toHaveCount(0);
  await expect(page.locator("#stageWrap")).toHaveAttribute("data-play-mode", "sequence");
  await expect(page.locator("#directionButton")).toBeHidden();
  await expect(page.locator("#planeYaw")).toBeDisabled();
  await expect(page.locator("#planePitch")).toBeDisabled();
  await expect(page.locator("#soundMode")).toBeDisabled();
  await expect(canvas).toHaveAttribute("aria-label", /sixteen Mobius stations/);
  await expect(audio).toHaveAttribute("aria-pressed", "false");

  await expect(page.locator('[data-section="form"] .control-note')).toContainText(
    "visible strip only",
  );
  await expect(canvas).toHaveAttribute("data-sequence-role", "subject");
  await setRange(page, "#position", 0.532);
  await expect(canvas).toHaveAttribute("data-sequence-role", "answer");
  await setRange(page, "#position", 0.5);
  await expect(canvas).toHaveAttribute("data-sequence-role", "subject");

  await setRange(page, "#position", 0.99);
  await setRange(page, "#speed", 1.2);
  await play.click();
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(canvas).toHaveAttribute("data-sequence-pass", "2", { timeout: 2_000 });
  await expect(canvas).toHaveAttribute("data-sequence-orientation", "-1");
  await play.click();

  await setRange(page, "#position", 0.25);
  await expect(canvas).toHaveAttribute("data-sequence-pass", "2");
  await canvas.focus();
  await page.keyboard.press("Home");
  expect(Number(await page.locator("#position").inputValue())).toBeCloseTo(0, 4);
  await expect(canvas).toHaveAttribute("data-sequence-pass", "2");
  await setRange(page, "#position", 1);
  await expect(canvas).toHaveAttribute("data-sequence-pass", "1");
  expect(Number(await page.locator("#position").inputValue())).toBeCloseTo(0, 4);

  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  await waitForAudioState(page, true);
  await play.click();
  await setRange(page, "#surfaceRadius", 0.8);
  await expect(play).toHaveAttribute("aria-pressed", "true");
  const envelope = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 40 });
  await testInfo.attach("moebius-counterpoint-envelope.json", {
    body: JSON.stringify(envelope, null, 2),
    contentType: "application/json",
  });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.activeSamples).toBeGreaterThan(0);
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await play.click();
  await audio.click();
  await waitForStableAudioState(page, false);

  await planeMode.click();
  await expect(sequenceState).toBeHidden();
  await expect(page.locator("#directionButton")).toBeEnabled();
  await expect(page.locator("#directionButton")).toHaveAttribute("data-direction", "reverse");
  await expect(page.locator("#soundMode")).toBeEnabled();
  await expect(page.locator("#selectPlayhead")).toHaveCount(0);

  await sequenceMode.click();
  await page.locator("#resetAll").click();
  await expect(planeMode).toHaveAttribute("aria-pressed", "true");
  await expect(sequenceState).toBeHidden();
  expect(errors).toEqual([]);
});

test.describe("touch-sized responsive topology controls", () => {
  test.use({ hasTouch: true });

  for (const surface of surfaces) {
    test(`${surface.id} stays reachable at required viewports`, async ({ page }) => {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(surface.href, { waitUntil: "load" });

        const layout = await page.evaluate(() => {
          const rect = (selector) => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return box ? {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            } : null;
          };
          const identity = rect(".topology-identity");
          const target = rect(".topology-target-switch");
          const overlaps = identity && target
            ? !(identity.right <= target.left || target.right <= identity.left
              || identity.bottom <= target.top || target.bottom <= identity.top)
            : false;
          return {
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            panelOverflow: document.querySelector(".topology-panel").scrollWidth
              - document.querySelector(".topology-panel").clientWidth,
            canvas: rect("#stage"),
            overlaps,
          };
        });

        expect(layout.documentOverflow).toBeLessThanOrEqual(1);
        expect(layout.panelOverflow).toBeLessThanOrEqual(1);
        expect(layout.canvas.width).toBeGreaterThan(100);
        expect(layout.canvas.height).toBeGreaterThan(100);
        if (viewport.height <= 430) expect(layout.overlaps).toBe(false);

        for (const selector of [
          "#audioButton",
          "#playButton",
          "#directionButton",
          "#resetAll",
        ]) {
          if (surface.id === "moebius") {
            await expect(page.locator("#selectSequenceMode")).toBeVisible();
          }
          const box = await page.locator(selector).boundingBox();
          expect(box.width, `${selector} width at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(48);
          expect(box.height, `${selector} height at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(48);
        }

        if (surface.id === "moebius") {
          for (const selector of ["#selectPlaneMode", "#selectSequenceMode"]) {
            const box = await page.locator(selector).boundingBox();
            expect(
              box.width,
              `${selector} width at ${viewport.width}x${viewport.height}`,
            ).toBeGreaterThanOrEqual(48);
            expect(box.height).toBeGreaterThanOrEqual(48);
          }
        }

        const stage = page.locator("#stage");
        if (surface.id === "klein-bottle") await page.locator("#selectPlayhead").click();
        const box = await stage.boundingBox();
        await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
        await page.mouse.down();
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        await page.mouse.up();
        await expect(page.locator("#stageWrap")).not.toHaveClass(/is-dragging/);
      }
    });
  }
});

async function bandPoint(page) {
  return page.evaluate(async () => {
    const { buildSurfaceMesh } = await import('/src/families/nonorientable/nonorientable-surface.js');
    const { rotatePoint3, projectPoint3 } = await import('/src/solid.js');
    const value = id => Number(document.getElementById(id).value);
    const box = document.getElementById('stage').getBoundingClientRect();
    const scale = Math.min(box.width, box.height) * .42;
    const mesh = buildSurfaceMesh('moebius', { radius:value('surfaceRadius'), width:value('surfaceWidth'), fold:value('surfaceFold'), halfTwists:value('surfaceTwists') });
    const vertices = mesh.vertices.map(v => {
      const p = projectPoint3(rotatePoint3(v, {x:value('rotationX'),y:value('rotationY'),z:value('rotationZ')}),3.5);
      return {x:box.x+box.width*.5+p.x*scale,y:box.y+box.height*.52-p.y*scale};
    });
    // The largest triangle's centroid is safely inside a visible face, not the hole.
    const face = mesh.triangles.reduce((best,t) => {
      const [a,b,c] = [vertices[t.a],vertices[t.b],vertices[t.c]];
      const area = Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
      return area > best.area ? {area,a,b,c} : best;
    },{area:0});
    return {x:(face.a.x+face.b.x+face.c.x)/3,y:(face.a.y+face.b.y+face.c.y)/3};
  });
}

for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
  test(`Mobius automatically targets the band or view at ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('moebius-synth.html');
    await expect(page.locator('#selectForm, #selectPlayhead, #sequenceState, #stageReadout, #surfaceInstructions, .topology-legend')).toHaveCount(0);
    const state = () => page.evaluate(() => Object.fromEntries(['rotationX','rotationY','planeYaw','planePitch'].map(id=>[id,Number(document.getElementById(id).value)])));
    const drag = async (point, cancel=false) => {
      await page.mouse.move(point.x,point.y); await page.mouse.down();
      await page.mouse.move(point.x+24,point.y+12,{steps:3});
      if (cancel) await page.locator('#stage').dispatchEvent('pointercancel',{pointerId:1});
      await page.mouse.up();
      await expect(page.locator('#stageWrap')).not.toHaveClass(/is-dragging/);
    };
    const first=await state();
    await drag(await bandPoint(page));
    const second=await state();
    expect(second.planeYaw).not.toBe(first.planeYaw);
    expect(second.planePitch).not.toBe(first.planePitch);
    expect(second.rotationX).toBe(first.rotationX);
    expect(second.rotationY).toBe(first.rotationY);
    const box=await page.locator('#stage').boundingBox();
    await drag({x:box.x+8,y:box.y+box.height-25},true);
    const third=await state();
    expect(third.rotationY).not.toBe(second.rotationY);
    expect(third.planeYaw).toBe(second.planeYaw);
    await page.locator('#selectSequenceMode').click();
    await drag(await bandPoint(page));
    const fourth=await state();
    expect(fourth.rotationY).not.toBe(third.rotationY);
    expect(fourth.planeYaw).toBe(third.planeYaw);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  });
}

async function probeWeave(page) {
  // Test-only reference; no debug globals or audio hooks in shipped source.
  await page.route('**/nonorientable-app.js', async route => {
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace('const pool = new VoicePool','const pool = window.__weaveTestPool = new VoicePool')});
  });
  await page.goto('moebius-synth.html');
  await page.locator('#selectSequenceMode').click();
  await page.locator('#audioButton').click();
  await page.evaluate(() => {
    const pool=window.__weaveTestPool;
    window.__weaveLog={strikes:[],silences:0,cancellations:0};
    const strike=pool.strike.bind(pool), silence=pool.silence.bind(pool), cancel=pool.cancelScheduledNotes.bind(pool);
    pool.strike=(spec,options)=>{
      const now=pool.context.currentTime;
      const accepted=strike(spec,options);
      window.__weaveLog.strikes.push({spec,options,accepted,now});return accepted;
    };
    pool.silence=()=>{window.__weaveLog.silences++;return silence();};
    pool.cancelScheduledNotes=()=>{window.__weaveLog.cancellations++;return cancel();};
  });
}

test('weave rate edits preserve tails and phase without retriggering or clearing envelopes', async ({page}) => {
  await probeWeave(page);
  await setRange(page,'#speed',.01);
  await setRange(page,'#position',.5);
  await page.waitForTimeout(300);
  await page.locator('#playButton').click();
  const result=await page.evaluate(async () => {
    const pool=window.__weaveTestPool, log=window.__weaveLog;
    await new Promise(r=>setTimeout(r,12));
    const active=[...pool.activeStrikes].filter(s=>s.startedAt<=pool.context.currentTime);
    const ends=active.map(s=>s.endedAt), before=log.strikes.length, silence=log.silences;
    for(let i=0;i<20;i++) {
      const input=document.getElementById('speed');input.value=i%2?.01:.02;input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    return {before,after:log.strikes.length,silence:log.silences-silence,
      active:active.length,ends,afterEnds:active.map(s=>s.endedAt), retained:active.every(s=>pool.activeStrikes.has(s)),position:Number(document.getElementById('position').value)};
  });
  expect(result.active).toBeGreaterThan(0);
  expect(result.after).toBe(result.before);
  expect(result.silence).toBe(0);
  expect(result.retained).toBe(true);
  expect(result.afterEnds).toEqual(result.ends);
  expect(result.position).toBeGreaterThanOrEqual(.5);
  expect(result.position).toBeLessThan(.51);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  await setRange(page,'#speed',1.2);
  await page.waitForTimeout(150);
  // Capture exact phase from the audio clock while rAF is stalled.
  await page.evaluate(()=>{window.requestAnimationFrame=()=>0;window.__weaveLog.strikes=[];});
  await page.waitForTimeout(350);
  const scheduled=await page.evaluate(()=>window.__weaveLog.strikes);
  expect(scheduled.length).toBeGreaterThan(5);
  expect(scheduled.length).toBeLessThan(18);
  expect(scheduled.every(s=>s.options.startAt>=s.now+.003)).toBe(true);
  await page.locator('#playButton').click();
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>window.__weaveTestPool.activeStrikes.size)).toBe(0);
});

test('weave scrubs coalesce rapid input, retain tails and cancel pending auditions on stop', async ({page}) => {
  await probeWeave(page);
  await setRange(page,'#speed',.01);
  await page.evaluate(()=>{window.__weaveLog.strikes=[];});
  await page.evaluate(async () => {
    for(let i=0;i<35;i++) {
      const input=document.getElementById('position');input.value=(i%16)/16;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,3));
    }
  });
  await page.waitForTimeout(100);
  const log=await page.evaluate(()=>window.__weaveLog);
  expect(log.silences).toBe(0);
  expect(log.cancellations).toBeGreaterThanOrEqual(35);
  expect(log.strikes.length).toBeGreaterThan(1);
  expect(log.strikes.length).toBeLessThan(8);
  expect(log.strikes.every(s=>s.options.attackCurve==='smooth' && s.options.retriggerMode==='overlap')).toBe(true);
  for(let i=1;i<log.strikes.length;i++) expect(log.strikes[i].options.startAt-log.strikes[i-1].options.startAt).toBeGreaterThanOrEqual(.06);
  await page.locator('#playButton').click();
  await setRange(page,'#position',.8);
  await page.locator('#playButton').click();
  const count=await page.evaluate(()=>window.__weaveLog.strikes.length);
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>window.__weaveLog.strikes.length)).toBe(count);
  expect(await page.evaluate(()=>window.__weaveTestPool.activeStrikes.size)).toBe(0);
  await page.locator('#audioButton').click();
  await setRange(page,'#position',.6);
  expect(await page.evaluate(()=>window.__weaveLog.strikes.length)).toBe(count);
});

test('weave edits discard obsolete future attacks, not already sounding ones', async ({page}) => {
  await probeWeave(page);
  await setRange(page,'#speed',1.2);
  await setRange(page,'#position',.501);
  await page.locator('#playButton').click();
  const result=await page.evaluate(() => {
    const pool=window.__weaveTestPool;
    const future=[...pool.activeStrikes].filter(s=>s.startedAt>pool.context.currentTime+.01);
    const sounding=[...pool.activeStrikes].filter(s=>s.startedAt<=pool.context.currentTime);
    const endTimes=sounding.map(s=>s.endedAt);
    const input=document.getElementById('speed');input.value=.01;input.dispatchEvent(new Event('input',{bubbles:true}));
    return {pending:future.length,removed:future.every(s=>!pool.activeStrikes.has(s)),
      retained:sounding.every(s=>pool.activeStrikes.has(s)),endTimes,afterEnds:sounding.map(s=>s.endedAt)};
  });
  expect(result.pending).toBeGreaterThan(0);
  expect(result.removed).toBe(true);
  expect(result.retained).toBe(true);
  expect(result.afterEnds).toEqual(result.endTimes);
  await page.locator('#audioButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  const count=await page.evaluate(()=>window.__weaveLog.strikes.length);
  await page.waitForTimeout(200);
  expect(await page.evaluate(()=>window.__weaveLog.strikes.length)).toBe(count);
});

test('starting weave replaces a pending scrub audition with transport', async ({page}) => {
  await probeWeave(page);
  await setRange(page,'#speed',.01);
  const count=await page.evaluate(() => {
    for(const value of [.25,.75]) {
      const input=document.getElementById('position');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    document.getElementById('playButton').click();
    return window.__weaveLog.strikes.length;
  });
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>window.__weaveLog.strikes.length)).toBe(count);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
});

for (const [href, bank] of [
  ["moebius-synth.html", MOEBIUS_FULL_PRESETS],
  ["klein-bottle-synth.html", KLEIN_FULL_PRESETS],
]) {
  test(`${href} retains the full bank, Next and dice without changing Audio or transport`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(href);
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "unselected");
    await expect(page.locator("button[data-full-preset]")).toHaveCount(bank.length);
    await setRange(page, "#level", 0.23);

    // Capture synchronously with recall, before an auto-rotating scene advances.
    const recalled = await page.evaluate(async () => {
      const { captureHeaderPresetState } = await import("/src/site/header-presets.js");
      return Array.from(document.querySelectorAll("button[data-full-preset]"), button => {
        button.click();
        return captureHeaderPresetState();
      });
    });
    expect(recalled.map(entry => entry.snapshot)).toEqual(bank.map(entry => entry.snapshot));
    expect(recalled.map(entry => entry.selectedId)).toEqual(bank.map(entry => entry.id));
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#level")).toHaveValue("0.23");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);

    await page.locator(".header-preset-next").click();
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", bank[0].id);
    await page.locator("#playButton").click();
    for (const audioArmed of [false, true]) {
      if (audioArmed) {
        await page.locator("#audioButton").click();
        await waitForAudioState(page, true);
      }
      const connections = (await readAudioStatus(page)).connectionCount;
      for (const action of [".header-preset-next", ".header-preset-random"]) {
        await page.locator(action).click();
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", String(audioArmed));
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#level")).toHaveValue("0.23");
        expect((await readAudioStatus(page)).connectionCount).toBe(connections);
      }
      await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
    }
    const picker = page.locator(".header-preset-picker");
    await picker.locator(":scope > summary").click();
    await picker.locator(`button[data-preset-id="${bank[0].id}"]`).click();
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", bank[0].id);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#playButton").click();
    await page.locator("#audioButton").click();
    await waitForStableAudioState(page, false);
    expect(errors).toEqual([]);
  });
}

test("a full weave preset preserves sounding tails and the live phase", async ({ page }) => {
  await probeWeave(page);
  await setRange(page, "#speed", 0.01);
  await setRange(page, "#position", 0.5);
  await page.waitForTimeout(300);
  await page.locator("#playButton").click();
  const result = await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 12));
    const pool = window.__weaveTestPool;
    const log = window.__weaveLog;
    const sounding = [...pool.activeStrikes].filter(strike => strike.startedAt <= pool.context.currentTime);
    const endTimes = sounding.map(strike => strike.endedAt);
    const before = { strikes: log.strikes.length, silences: log.silences };
    document.querySelector('button[data-full-preset][data-preset-id="weave-deep"]').click();
    return {
      active: sounding.length,
      retained: sounding.every(strike => pool.activeStrikes.has(strike)),
      endTimes,
      afterEndTimes: sounding.map(strike => strike.endedAt),
      strikes: log.strikes.length - before.strikes,
      silences: log.silences - before.silences,
      position: Number(document.getElementById("position").value),
    };
  });
  expect(result.active).toBeGreaterThan(0);
  expect(result.retained).toBe(true);
  expect(result.afterEndTimes).toEqual(result.endTimes);
  expect(result.strikes).toBe(0);
  expect(result.silences).toBe(0);
  expect(result.position).toBeGreaterThanOrEqual(0.5);
  expect(result.position).toBeLessThan(0.51);
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "weave-deep");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
});
