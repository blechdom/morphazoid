import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Continuous video readback stalls software WebGL (and the audio meter) when
// two rig previews run concurrently. Failure screenshots and traces remain on.
test.use({ video: 'off' });
// This file tests one GPU-heavy lab at a time, even if unrelated suites use
// parallel workers. Each test remains independent and retries independently.
test.describe.configure({ mode: 'default' });

const modes = [
  'ant-farm', 'voronoi-foam', 'polyhedral-lattice', 'octopus',
  'pancakes', 'mosquito', 'moth',
];
const state = (page) => page.evaluate(() => window.rigLabDemo.state());
async function ready(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('/rig-lab.html', { waitUntil: 'domcontentloaded' });
  expect(response?.ok()).toBe(true);
  await page.waitForFunction(() => window.rigLabDemo?.state().visual.frames > 2);
  expect((await state(page)).visual.unavailable).not.toBe(true);
  await assetReady(page, 'ant-farm');
  expect(errors).toEqual([]);
  return errors;
}
async function assetReady(page, id) {
  // A GLB is not ready until its mesh is drawn. The two procedural stages
  // instead require their live topology and authored surfaces to exist.
  await page.waitForFunction((selected) => {
    const visual = window.rigLabDemo?.state().visual;
    if (visual?.model !== selected) return false;
    if (selected === 'voronoi-foam') return visual.procedural.foam.count > 0 &&
      visual.renderedSurfaces.authored > 0 && visual.renderedSurfaces.imported === 0;
    if (selected === 'polyhedral-lattice') return visual.procedural.lattice.vertexCount > 0 &&
      visual.renderedSurfaces.authored > 0 && visual.renderedSurfaces.imported === 0;
    return visual.downloaded.models[selected]?.status === 'ready' &&
      visual.renderedSurfaces.imported > 0;
  }, id);
}
async function select(page, id) {
  await page.locator(`button[data-demo-model="${id}"]`).click();
  await expect(page.locator(`fieldset[data-controls="${id}"]`)).toBeVisible();
  expect((await state(page)).model).toBe(id);
}
async function dragPart(page, kind, index, dx, dy) {
  await page.waitForFunction(() => {
    const visual = window.rigLabDemo?.state().visual;
    return visual?.model === 'voronoi-foam' || visual?.model === 'polyhedral-lattice'
      ? visual.renderedSurfaces.authored > 0
      : visual?.downloaded.activeDownloaded && visual.renderedSurfaces.imported > 0;
  });
  const point = await page.evaluate(([role, choice]) =>
    window.rigLabDemo.screenPoint(role, choice), [kind, index]);
  expect(point, `No projected ${kind} point`).not.toBeNull();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 5 });
  await page.mouse.up();
}
async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('animal/kitchen stages retain downloaded surfaces; math stages draw live topology only', async ({ page }) => {
  test.setTimeout(60_000); // Sequentially loading every optional GLB includes several large textures.
  const requests = [];
  page.on('response', (response) => {
    if (response.url().includes('/assets/rig-lab/')) {
      requests.push({ url: response.url(), status: response.status() });
    }
  });
  const errors = await ready(page);
  let snapshot = await state(page);
  expect(snapshot.visual.downloaded.models['ant-farm'].bones).toBeGreaterThan(0);
  expect(snapshot.visual.renderedSurfaces.authored).toBe(0);
  expect(snapshot.visual.renderedSurfaces.imported).toBeGreaterThan(0);
  await page.locator('#antStyle').selectOption('worker');
  expect((await state(page)).visual.downloaded.antStyle).toBe('worker');
  expect((await state(page)).visual.renderedSurfaces.authored).toBe(0);
  await page.locator('#resetButton').click();
  expect((await state(page)).visual.downloaded.antStyle).toBe('mixed');

  for (const id of ['moth', 'octopus', 'pancakes', 'voronoi-foam', 'polyhedral-lattice', 'mosquito']) {
    await select(page, id);
    await assetReady(page, id);
    snapshot = await state(page);
    if (['voronoi-foam', 'polyhedral-lattice'].includes(id)) {
      expect(snapshot.visual.downloaded.activeDownloaded).toBe(false);
      expect(snapshot.visual.renderedSurfaces.authored).toBeGreaterThan(0);
      expect(snapshot.visual.renderedSurfaces.imported).toBe(0);
    } else {
      expect(snapshot.visual.downloaded.activeDownloaded).toBe(true);
      expect(snapshot.visual.renderedSurfaces.authored).toBe(0);
      expect(snapshot.visual.renderedSurfaces.imported).toBeGreaterThan(0);
    }
    await expect(page.locator('#stageModelStatus')).toBeHidden();
  }
  expect((await state(page)).visual.downloaded.models.moth.bones).toBeGreaterThan(0);
  expect((await state(page)).visual.downloaded.models.octopus.bones).toBeGreaterThan(0);
  expect((await state(page)).visual.downloaded.models.mosquito.bones).toBe(21);
  expect((await state(page)).visual.downloaded.octopusSkin.texture).toBe(true);
  expect(requests.some(({ url }) => url.endsWith('/ant-vfx.glb'))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith('/worker-ant.glb'))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith('/peacock-moth.glb'))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith('/pancake-stack.glb'))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith('/mosquito-rig.glb'))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith('/octopus-rig.glb'))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith('/lattice-rig.glb'))).toBe(false);
  expect(requests.some(({ url }) => url.endsWith('/voronoi-reference.glb'))).toBe(false);
  expect(requests.every(({ status }) => status === 200)).toBe(true);
  await expect(page.locator('#assetStatus')).toContainText('skinned');
  expect(errors).toEqual([]);
});

test('generated lattice faces, struts, vertices and audio topology bend together', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await ready(page);
  await select(page, 'polyhedral-lattice');
  await assetReady(page, 'polyhedral-lattice');
  let snapshot = await state(page);
  expect(snapshot.visual.procedural.lattice).toMatchObject({
    shape: 'icosahedron', detail: 0, unitCount: 1,
    vertexCount: 12, edgeCount: 30, faceCount: 20,
  });
  const rest = snapshot.visual.procedural.lattice.nodes[7];
  await setRange(page, '#latticeX', 0.6);
  await page.waitForFunction((before) =>
    window.rigLabDemo.state().visual.procedural.lattice.nodes[7][0] > before + 0.5,
  rest[0]);
  snapshot = await state(page);
  expect(snapshot.settings['polyhedral-lattice'].pullX).toBe(0.6);
  expect(snapshot.visual.procedural.lattice.geometrySelectedPoint)
    .toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]));
  expect(snapshot.visual.procedural.lattice.geometrySelectedPoint[0])
    .toBeCloseTo(snapshot.visual.procedural.lattice.nodes[7][0], 5);
  await setRange(page, '#latticeX', 0);
  await setRange(page, '#latticeDetail', 1);
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.lattice.vertexCount === 42);
  expect(await page.locator('#latticeSelected option').count()).toBe(42);
  await expect(page.locator('output[for="latticeDetail"]')).toContainText('42 per solid');
  await setRange(page, '#latticeUnits', 4);
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.lattice.vertexCount === 168);
  snapshot = await state(page);
  expect(snapshot.visual.procedural.lattice.unitCount).toBe(4);
  expect(snapshot.visual.procedural.lattice.nodes).toHaveLength(168);
  await page.locator('#latticeSelected').selectOption('133'); // Vertex 8 of the fourth solid.
  await setRange(page, '#latticeZ', 0.5);
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.lattice.nodes[133][2] >
    window.rigLabDemo.state().visual.procedural.lattice.nodes[7][2] + 0.4);
  expect((await state(page)).latticeNodes).toBe(168);
  expect((await state(page)).visual.renderedSurfaces).toEqual({ imported: 0, authored: 3 });
  expect((await state(page)).audioCreated).toBe(false);
  expect(errors).toEqual([]);
});

test('geometry stage remains editable without fetching its older static-model reference', async ({ page }) => {
  let requests = 0;
  await page.route('**/assets/rig-lab/lattice-rig.glb', (route) => {
    requests += 1;
    return route.fulfill({ status: 404, body: 'Unavailable' });
  });
  await ready(page);
  await select(page, 'polyhedral-lattice');
  await assetReady(page, 'polyhedral-lattice');
  await expect(page.locator('#assetStatus')).toContainText('Live Three.js lattice');
  expect(requests).toBe(0);
  expect(await page.evaluate(() => window.rigLabDemo.screenPoint('node', 7))).not.toBeNull();
  await setRange(page, '#latticeX', 0.55);
  await page.waitForFunction(() => {
    const { geometrySelectedPoint, nodes } = window.rigLabDemo.state().visual.procedural.lattice;
    return geometrySelectedPoint[0] > 1 &&
      Math.abs(geometrySelectedPoint[0] - nodes[7][0]) < 1e-5;
  });
  const moved = await state(page);
  expect(moved.settings['polyhedral-lattice'].pullX).toBe(0.55);
  expect(moved.visual.procedural.lattice.geometrySelectedPoint[0])
    .toBeCloseTo(moved.visual.procedural.lattice.nodes[7][0], 5);
  expect((await state(page)).audioCreated).toBe(false);
});

test('octopus material selector keeps Dirk.z UV mesh and 128 bones while changing real PBR maps', async ({ page }) => {
  const errors = await ready(page);
  await select(page, 'octopus');
  await assetReady(page, 'octopus');
  await page.waitForFunction(() => window.rigLabDemo.state().visual.downloaded.octopusSkin?.skin === 'reef');
  const first = (await state(page)).visual.downloaded.octopusSkin;
  expect(first).toMatchObject({ texture: true, uv: true, mapSize: 256, bones: 128 });
  const reefImage = (await page.locator('#rigCanvas').screenshot()).toString('base64');
  await page.locator('#octopusSkin').selectOption('abyss');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.octopusSkin.skin === 'abyss');
  const abyssImage = (await page.locator('#rigCanvas').screenshot()).toString('base64');
  const changedPixels = await page.evaluate(async ([reef, abyss]) => {
    const decode = async (png) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const surface = document.createElement('canvas');
      surface.width = bitmap.width; surface.height = bitmap.height;
      const ctx = surface.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return ctx.getImageData(0, 0, surface.width, surface.height);
    };
    const a = await decode(reef), b = await decode(abyss);
    let different = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      if (Math.abs(a.data[i] - b.data[i]) +
          Math.abs(a.data[i + 1] - b.data[i + 1]) +
          Math.abs(a.data[i + 2] - b.data[i + 2]) > 45) different += 1;
    }
    return different;
  }, [reefImage, abyssImage]);
  expect(changedPixels).toBeGreaterThan(3000);
  await page.locator('#playButton').click();
  for (const skin of ['abyss', 'pearl', 'kelp', 'reef']) {
    await page.locator('#octopusSkin').selectOption(skin);
    await page.waitForFunction((name) =>
      window.rigLabDemo.state().visual.downloaded.octopusSkin.skin === name, skin);
    const snapshot = await state(page);
    expect(snapshot.playing).toBe(true);
    expect(snapshot.audioCreated).toBe(false);
    expect(snapshot.visual.downloaded.octopusSkin.geometry).toBe(first.geometry);
    expect(snapshot.visual.downloaded.octopusSkin.bones).toBe(128);
    expect(snapshot.visual.downloaded.octopusSkin.material).toContain(skin);
    expect(snapshot.visual.downloaded.octopusSkin.emissive > 0).toBe(skin === 'abyss');
  }
  await setRange(page, '#octopusWetness', 0);
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.octopusSkin.wetness === 0);
  const dry = (await state(page)).visual.downloaded.octopusSkin;
  await setRange(page, '#octopusWetness', 1);
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.octopusSkin.wetness === 1);
  const wet = (await state(page)).visual.downloaded.octopusSkin;
  expect(wet.clearcoat).toBeGreaterThan(dry.clearcoat);
  expect(wet.roughness).toBeLessThan(dry.roughness);
  await page.locator('#rigScene').selectOption('undertow');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.octopusSkin.skin === 'pearl');
  expect((await state(page)).settings.octopus.skin).toBe('pearl');
  await page.locator('#resetButton').click();
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.octopusSkin.skin === 'reef');
  expect((await state(page)).playing).toBe(true);
  expect(errors).toEqual([]);
});

test('loading or missing initial ant download never reveals a handmade model', async ({ page }) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/assets/rig-lab/ant-vfx.glb', async (route) => {
    await held;
    await route.fulfill({ status: 404, body: 'Unavailable' });
  });
  try {
    await page.goto('/rig-lab.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      window.rigLabDemo?.state().visual.downloaded.models['ant-farm'].status === 'loading');
    expect((await state(page)).visual.renderedSurfaces).toEqual({ imported: 0, authored: 0 });
    expect(await page.evaluate(() => window.rigLabDemo.screenPoint('ant', 0))).toBeNull();
    await expect(page.locator('#stageModelStatus')).toContainText('Loading downloaded');
  } finally {
    release();
  }
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.models['ant-farm'].status === 'error');
  expect((await state(page)).visual.renderedSurfaces).toEqual({ imported: 0, authored: 0 });
  await expect(page.locator('#stageModelStatus')).toContainText('No substitute 3D model');
});

test('independent mosquito leg, wing and proboscis bones follow sound-driving controls', async ({ page }) => {
  const errors = await ready(page);
  await select(page, 'mosquito');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.models.mosquito.status === 'ready');
  const before = (await state(page)).visual.downloaded.mosquitoJoints;
  expect(before?.legs).toHaveLength(6);
  await page.locator('#mosquitoLeg').selectOption('4');
  await setRange(page, '#mosquitoLegCurl', 0.85);
  await page.waitForFunction((prior) =>
    JSON.stringify(window.rigLabDemo.state().visual.downloaded.mosquitoJoints.legs[4]) !== prior,
  JSON.stringify(before.legs[4]));
  let snapshot = await state(page);
  expect(snapshot.settings.mosquito.legs[4]).toBe(0.85);
  expect(snapshot.settings.mosquito.legs[0]).toBe(0);
  expect(snapshot.visual.downloaded.mosquitoJoints.legs[4]).not.toEqual(before.legs[4]);
  expect(snapshot.visual.downloaded.mosquitoJoints.legs[0]).toEqual(before.legs[0]);
  await setRange(page, '#mosquitoProbe', 31);
  await page.waitForFunction((prior) =>
    JSON.stringify(window.rigLabDemo.state().visual.downloaded.mosquitoJoints.probe) !== prior,
  JSON.stringify(before.probe));
  await setRange(page, '#mosquitoStroke', 0.92);
  await page.locator('#playButton').click();
  await page.waitForFunction((prior) =>
    JSON.stringify(window.rigLabDemo.state().visual.downloaded.mosquitoJoints.wings) !== prior,
  JSON.stringify(before.wings));
  snapshot = await state(page);
  expect(snapshot.visual.downloaded.mosquitoJoints.probe).not.toEqual(before.probe);
  expect(snapshot.visual.downloaded.mosquitoJoints.wings).not.toEqual(before.wings);
  expect(snapshot.audioCreated).toBe(false);
  await page.locator('#playButton').click();
  await page.locator('#resetButton').click();
  expect((await state(page)).settings.mosquito.legs).toEqual([0, 0, 0, 0, 0, 0]);
  expect(errors).toEqual([]);
});

test('failed textured mosquito download has no substitute mesh or grab handles', async ({ page }) => {
  await page.route('**/assets/rig-lab/mosquito-rig.glb', (route) =>
    route.fulfill({ status: 404, body: 'Unavailable' }));
  await ready(page);
  await select(page, 'mosquito');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.models.mosquito.status === 'error');
  await expect(page.locator('#assetStatus')).toContainText('No substitute model is shown');
  expect((await state(page)).visual.renderedSurfaces).toEqual({ imported: 0, authored: 0 });
  expect(await page.evaluate(() => window.rigLabDemo.screenPoint('leg', 0))).toBeNull();
  await setRange(page, '#mosquitoLegCurl', 0.72);
  expect((await state(page)).settings.mosquito.legs[0]).toBe(0.72);
  expect((await state(page)).audioCreated).toBe(false);
});

test('seven independent sound models, silent Play, resetting the selected rig only', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await ready(page);
  let snapshot = await state(page);
  expect(snapshot.audioArmed).toBe(false);
  expect(snapshot.audioCreated).toBe(false);
  for (const id of modes) {
    await select(page, id);
    await assetReady(page, id);
    snapshot = await state(page);
    expect(snapshot.visual.model).toBe(id);
    expect(snapshot.visual.frames).toBeGreaterThan(2);
    if (['voronoi-foam', 'polyhedral-lattice'].includes(id)) {
      expect(snapshot.visual.renderedSurfaces.authored).toBeGreaterThan(0);
      expect(snapshot.visual.renderedSurfaces.imported).toBe(0);
    } else {
      expect(snapshot.visual.renderedSurfaces.authored).toBe(0);
      expect(snapshot.visual.renderedSurfaces.imported).toBeGreaterThan(0);
    }
    expect(snapshot.audioCreated).toBe(false);
    await page.locator('#playButton').click();
    expect((await state(page)).playing).toBe(true);
    expect((await state(page)).audioCreated).toBe(false);
    await page.locator('#playButton').click();
    expect((await state(page)).playing).toBe(false);
  }
  await select(page, 'ant-farm');
  await setRange(page, '#antTrail', 0.89);
  expect((await state(page)).settings['ant-farm'].trail).toBeCloseTo(0.89, 2);
  await page.locator('#resetButton').click();
  snapshot = await state(page);
  expect(snapshot.settings['ant-farm'].trail).toBeCloseTo(0.34, 2);
  expect(snapshot.audioCreated).toBe(false);
  await page.locator('#rigCanvas').focus();
  await page.keyboard.press('Space');
  expect((await state(page)).playing).toBe(true);
  expect((await state(page)).audioCreated).toBe(false);
  await page.keyboard.press('Space');
  expect((await state(page)).playing).toBe(false);
  expect(errors).toEqual([]);
});

test('Voronoi cells and subdivided lattice grow new sound-driving surfaces in real time', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await ready(page);
  await select(page, 'voronoi-foam');
  await assetReady(page, 'voronoi-foam');
  await page.locator('#playButton').click();
  await setRange(page, '#foamCount', 12);
  await page.waitForFunction(() => window.rigLabDemo.state().visual.procedural.foam.count === 12);
  let snapshot = await state(page);
  expect(snapshot.playing).toBe(true);
  expect(snapshot.audioCreated).toBe(false);
  expect(snapshot.foamVolumes).toHaveLength(12);
  expect(snapshot.visual.procedural.foam.vertexCount).toBeGreaterThan(24);
  expect(snapshot.visual.procedural.foam.faceCount).toBeGreaterThan(12);
  expect(snapshot.visual.renderedSurfaces.authored).toBeGreaterThan(20);
  expect(snapshot.visual.renderedSurfaces.imported).toBe(0);
  expect(await page.locator('#foamSelected option').count()).toBe(12);
  await page.locator('#playButton').click();
  await page.locator('#foamSelected').selectOption('11');
  const before = (await state(page)).visual.procedural.foam.selectedSignature;
  await dragPart(page, 'seed', 11, 22, -13);
  expect((await state(page)).settings['voronoi-foam'].selected).toBe(11);
  await page.waitForFunction((signature) =>
    window.rigLabDemo.state().visual.procedural.foam.selectedSignature !== signature, before);
  expect((await state(page)).foamVolumes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(8, 2);
  await page.locator('#playButton').click();
  await setRange(page, '#foamCount', 2);
  await page.waitForFunction(() => window.rigLabDemo.state().visual.procedural.foam.count === 2);
  snapshot = await state(page);
  expect(snapshot.settings['voronoi-foam'].selected).toBe(1);
  expect(snapshot.foamVolumes).toHaveLength(2);
  expect(snapshot.visual.renderedSurfaces.imported).toBe(0);
  expect(await page.locator('#foamSelected option').count()).toBe(2);
  expect(snapshot.playing).toBe(true);
  await page.locator('#foamShape').selectOption('octahedron');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.foam.shape === 'octahedron');
  expect((await state(page)).foamVolumes.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(8);
  await page.locator('#foamShape').selectOption('icosahedron');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.foam.shape === 'icosahedron');
  expect((await state(page)).visual.procedural.foam.vertexCount).toBeGreaterThan(10);

  await select(page, 'polyhedral-lattice');
  await assetReady(page, 'polyhedral-lattice');
  expect((await state(page)).latticeNodes).toBe(12);
  await page.locator('#latticeShape').selectOption('octahedron');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.lattice.vertexCount === 6);
  expect((await state(page)).visual.procedural.lattice.faceCount).toBe(8);
  await page.locator('#latticeShape').selectOption('icosahedron');
  await setRange(page, '#latticeDetail', 2);
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.lattice.vertexCount === 162);
  expect(await page.locator('#latticeSelected option').count()).toBe(162);
  await setRange(page, '#latticeUnits', 4);
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.lattice.vertexCount === 648);
  expect((await state(page)).latticeNodes).toBe(648);
  expect(await page.locator('#latticeSelected option').count()).toBe(648);
  await page.locator('#latticeSelected').selectOption('647');
  expect((await state(page)).settings['polyhedral-lattice'].selected).toBe(647);
  await setRange(page, '#latticeUnits', 1);
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.procedural.lattice.vertexCount === 162);
  snapshot = await state(page);
  expect(snapshot.latticeNodes).toBe(162);
  expect(snapshot.settings['polyhedral-lattice'].selected).toBe(161);
  expect(await page.locator('#latticeSelected option').count()).toBe(162);
  expect(snapshot.visual.renderedSurfaces).toEqual({ imported: 0, authored: 3 });
  expect(snapshot.audioCreated).toBe(false);
  expect(errors).toEqual([]);
});

test('direct grabs change seven different sound-driving models', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await ready(page);
  const initialGuide = (await state(page)).settings['ant-farm'].guide[0][0];
  await dragPart(page, 'ant', 0, 82, -25);
  expect((await state(page)).settings['ant-farm'].guide[0][0]).toBeGreaterThan(initialGuide);
  await select(page, 'voronoi-foam');
  const initialVolume = (await state(page)).foamVolumes[4];
  await dragPart(page, 'seed', 4, 75, -42);
  const foam = await state(page);
  expect(foam.settings['voronoi-foam'].seeds[4][0]).toBeGreaterThan(0.02);
  expect(foam.foamVolumes[4]).not.toBeCloseTo(initialVolume, 4);
  expect(foam.foamVolumes.reduce((sum, value) => sum + value, 0)).toBeCloseTo(8, 2);

  await select(page, 'polyhedral-lattice');
  await dragPart(page, 'node', 7, 74, -30);
  expect((await state(page)).settings['polyhedral-lattice'].pullX).toBeGreaterThan(0);

  await select(page, 'octopus');
  await dragPart(page, 'mantle', null, 24, 46);
  expect((await state(page)).settings.octopus.grip).toBeGreaterThan(0.16);
  await dragPart(page, 'arm', 0, 34, -30);
  expect((await state(page)).settings.octopus.lengths[0]).toBeGreaterThan(1.18);

  await select(page, 'pancakes');
  await dragPart(page, 'pan', null, 72, 0);
  expect((await state(page)).settings.pancakes.tilt).toBeGreaterThan(0);
  await page.locator('[data-action="flip"]').click();
  expect((await state(page)).pancakeAirborne).toBe(true);
  await page.waitForTimeout(740);
  expect((await state(page)).pancakeAirborne).toBe(false);
  await page.locator('[data-action="syrup"]').click();
  const start = await page.evaluate(() => window.rigLabDemo.screenPoint('spatula'));
  const end = await page.evaluate(() => window.rigLabDemo.screenPoint('plate'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  expect((await state(page)).pancakeStackCount).toBe(1);
  await page.locator('[data-action="peel"]').click();
  await page.locator('[data-action="pan"]').click();
  expect((await state(page)).pancakeStackCount).toBe(0);
  await page.locator('[data-action="scoop"]').click();
  await page.locator('[data-action="stack"]').click();
  await page.locator('[data-action="pour"]').click();
  await page.locator('[data-action="butter"]').click();
  await page.locator('[data-action="scoop"]').click();
  await page.locator('[data-action="stack"]').click();
  const stacked = await state(page);
  expect(stacked.pancakeStackCount).toBe(2);
  expect(stacked.settings.pancakes.cakes).toHaveLength(2);
  expect(stacked.pancakePositions[1][1]).toBeGreaterThan(stacked.pancakePositions[0][1]);
  expect(stacked.settings.pancakes.cakes[0].syrup).toBeGreaterThan(0);
  await page.locator('[data-action="peel"]').click();
  expect((await state(page)).pancakeStackCount).toBe(1);

  await select(page, 'mosquito');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.models.mosquito.status === 'ready');
  await dragPart(page, 'wing', 'left', 76, -16);
  expect((await state(page)).settings.mosquito.wingRate).toBeGreaterThan(390);
  await dragPart(page, 'leg', 4, 55, -25);
  expect((await state(page)).settings.mosquito.legs[4]).toBeGreaterThan(0);
  await select(page, 'moth');
  await dragPart(page, 'wing', 'left', -20, 60);
  expect((await state(page)).settings.moth.leftFold).toBeGreaterThan(0.2);
  await page.locator('#brushMode').check();
  await dragPart(page, 'wing', 'left', -160, 0);
  await expect(page.locator('#gestureReadout')).toContainText(/[1-9]\d* ridge/);
  expect(errors).toEqual([]);
});

test('explicit Audio arm drives finite sound and stays separate from the motion transport', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await ready(page);
  await select(page, 'mosquito');
  await page.locator('#playButton').click();
  expect((await state(page)).audioCreated).toBe(false);
  await page.locator('#audioButton').click();
  await page.waitForFunction(() => window.rigLabDemo?.state().audioArmed);
  await page.waitForFunction(() => window.rigLabDemo.state().levels.left > 0.005
    || window.rigLabDemo.state().levels.right > 0.005);
  expect((await state(page)).playing).toBe(true);
  await setRange(page, '#mosquitoWingRate', 730);
  expect((await state(page)).settings.mosquito.wingRate).toBe(730);
  await expect(page.locator('#modelReadout')).toContainText('wing tone');
  await page.locator('#playButton').click();
  await select(page, 'ant-farm');
  for (const [id, action] of [
    ['ant-farm', 'chamber'], ['voronoi-foam', 'cell'], ['polyhedral-lattice', 'pluck'],
    ['octopus', 'mantle'], ['moth', 'wing'],
  ]) {
    await select(page, id);
    await assetReady(page, id);
    // A click can outlast a short contact when WebGL is busy. Observe actual
    // analyser output *during* the click, not after its automatic waits.
    await page.waitForFunction(() => {
      const { levels } = window.rigLabDemo.state();
      return levels.left < 0.002 && levels.right < 0.002;
    });
    const audible = page.waitForFunction(() => {
      const { levels } = window.rigLabDemo.state();
      return levels.left > 0.002 || levels.right > 0.002 ? levels : false;
    }, undefined, { polling: 20 }); // Audio's timer may outpace rAF during software WebGL draws.
    const [peak] = await Promise.all([
      audible, page.locator(`[data-controls="${id}"] [data-action="${action}"]`).click(),
    ]);
    const levels = await peak.jsonValue();
    await peak.dispose();
    const { audioArmed } = await state(page);
    expect(audioArmed).toBe(true);
    expect(levels.left).toBeLessThan(0.98);
    expect(levels.right).toBeLessThan(0.98);
  }
  await select(page, 'pancakes');
  await page.locator('#playButton').click();
  await page.waitForFunction(() => {
    const { levels } = window.rigLabDemo.state();
    return levels.left > 0.002 || levels.right > 0.002;
  });
  await page.locator('#audioButton').click();
  expect((await state(page)).audioArmed).toBe(false);
  expect((await state(page)).playing).toBe(true);
  await page.waitForTimeout(250);
  expect((await state(page)).levels).toEqual({ left: 0, right: 0 });
  expect(errors).toEqual([]);
});

test('cancelled pointer editing rolls back and controls stay reachable in three viewports', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await ready(page);
  await select(page, 'voronoi-foam');
  await assetReady(page, 'voronoi-foam');
  const initial = (await state(page)).settings['voronoi-foam'].seeds[4];
  const point = await page.evaluate(() => window.rigLabDemo.screenPoint('seed', 4));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 60, point.y - 25);
  await page.locator('#rigCanvas').evaluate((canvas) => {
    canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
  });
  expect((await state(page)).settings['voronoi-foam'].seeds[4]).toEqual(initial);
  await page.mouse.up();
  await select(page, 'pancakes');
  await assetReady(page, 'pancakes');
  await page.locator('[data-action="scoop"]').click();
  const before = (await state(page)).settings.pancakes;
  const spatula = await page.evaluate(() => window.rigLabDemo.screenPoint('spatula'));
  await page.mouse.move(spatula.x, spatula.y);
  await page.mouse.down();
  await page.mouse.move(spatula.x - 74, spatula.y - 22);
  await page.locator('#rigCanvas').evaluate((canvas) => {
    canvas.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
  });
  expect((await state(page)).settings.pancakes).toEqual(before);
  await page.mouse.up();
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    const transport = await page.locator('#playButton').boundingBox();
    const audio = await page.locator('#audioButton').boundingBox();
    expect(transport?.width).toBeGreaterThanOrEqual(48);
    expect(transport?.height).toBeGreaterThanOrEqual(48);
    expect(audio?.height).toBeGreaterThanOrEqual(40);
    for (const id of modes) {
      await select(page, id);
      expect(await page.locator(`fieldset[data-controls="${id}"]`).isVisible()).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test('every model exposes labelled controls without serious automated accessibility findings', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await ready(page);
  for (const id of modes) {
    await select(page, id);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter(({ impact }) =>
      impact === 'critical' || impact === 'serious').map((item) => ({
      id: item.id, impact: item.impact, targets: item.nodes.map((node) => node.target),
    }));
    await testInfo.attach(`${id}-axe.json`, {
      body: JSON.stringify({ blocking, violations: results.violations.length }, null, 2),
      contentType: 'application/json',
    });
    expect(blocking, `${id} serious or critical accessibility findings`).toEqual([]);
  }
});

test('all seven stages have animated presets; recall keeps Play separate from Audio', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await ready(page);
  for (const id of modes) {
    await select(page, id);
    await assetReady(page, id);
    const available = await page.locator('#rigScene option').count();
    expect(available).toBe(3);
    await page.locator('#rigScene').selectOption({ index: 1 });
    let snapshot = await state(page);
    expect(snapshot.scene).not.toBe('custom');
    expect(snapshot.audioCreated).toBe(false);
    expect(snapshot.playing).toBe(false);
    await page.locator('#playButton').click();
    await page.waitForTimeout(130);
    snapshot = await state(page);
    expect(snapshot.playing).toBe(true);
    expect(snapshot.audioCreated).toBe(false);
    if (id !== 'ant-farm') expect(snapshot.animatedSettings).not.toEqual(snapshot.settings[id]);
    await page.locator('#nextScene').click();
    expect((await state(page)).playing).toBe(true);
    expect((await state(page)).audioCreated).toBe(false);
    await page.locator('#resetButton').click();
    snapshot = await state(page);
    expect(snapshot.playing).toBe(true);
    expect(snapshot.audioCreated).toBe(false);
    expect(snapshot.scene).not.toBe('custom');
  }
  await page.locator('#playButton').click();
  expect((await state(page)).playing).toBe(false);
  await setRange(page, '#mothLeft', 0.67);
  expect((await state(page)).scene).toBe('custom');
  await page.locator('#nextScene').click();
  expect((await state(page)).scene).not.toBe('custom');
  expect(errors).toEqual([]);
});

test('ants animate their imported joints, three-stride Worker walk and included dig clip', async ({ page }) => {
  const errors = await ready(page);
  await page.locator('#antStyle').selectOption('vfx');
  const before = (await state(page)).visual.downloaded.antActors[0];
  expect(before.hips).toHaveLength(6);
  expect(before.knees).toHaveLength(6);
  await page.locator('#playButton').click();
  await page.waitForFunction((prior) => {
    const actor = window.rigLabDemo.state().visual.downloaded.antActors[0];
    return JSON.stringify(actor.hips) !== prior.hips &&
      Math.abs(actor.position[0] - prior.position) > 0.05;
  }, { hips: JSON.stringify(before.hips), position: before.position[0] });
  expect((await state(page)).audioCreated).toBe(false);
  await page.locator('#rigScene').selectOption('convoy');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.antActors[0].activeClip === 'Walk');
  let snapshot = await state(page);
  expect(snapshot.playing).toBe(true);
  expect(snapshot.visual.downloaded.antActors.every((actor) => actor.variant === 'worker')).toBe(true);
  const clipTime = snapshot.visual.downloaded.antActors[0].clipTime;
  await page.waitForFunction((previous) => Math.abs(
    window.rigLabDemo.state().visual.downloaded.antActors[0].clipTime - previous) > 0.1,
  clipTime);
  await page.locator('#rigScene').selectOption('dig');
  await page.waitForFunction(() =>
    window.rigLabDemo.state().visual.downloaded.antActors[1].activeClip === 'dig');
  snapshot = await state(page);
  expect(snapshot.animation).toBe('dig');
  expect(snapshot.playing).toBe(true);
  expect(snapshot.audioCreated).toBe(false);
  await expect(page.locator('#modelReadout')).toContainText('digging');
  expect(errors).toEqual([]);
});

test('moth plays its native full-rig clip with independent folds and evenly lit wings', async ({ page }) => {
  test.setTimeout(45_000);
  const errors = await ready(page);
  await select(page, 'moth');
  await assetReady(page, 'moth');
  await setRange(page, '#mothLeft', 0);
  await setRange(page, '#mothRight', 0);
  await page.waitForTimeout(130);
  let rendered = (await state(page)).visual.downloaded;
  const start = rendered.mothWingTips;
  expect(rendered.mothSource).toMatchObject({
    clip: 'Animation', tracks: 279, duration: 1, phase: 0,
  });
  expect(rendered.mothSource.distal).toHaveLength(2);
  await setRange(page, '#mothLeft', 0.78);
  await setRange(page, '#mothRight', 0.78);
  // The two inputs can arrive in different animation frames: sample only
  // after *both* downloaded wing chains have received the new fold.
  await page.waitForFunction((prior) => [0, 1].every((wing) => Math.abs(
    window.rigLabDemo.state().visual.downloaded.mothWingTips[wing].fore[2] -
      prior[wing].fore[2]) > 0.3), start);
  const raised = (await state(page)).visual.downloaded.mothWingTips;
  for (const section of ['fore', 'hind']) {
    const left = raised[0][section][2] - start[0][section][2];
    const right = raised[1][section][2] - start[1][section][2];
    expect(left).toBeGreaterThan(0.25);
    expect(Math.abs(left - right)).toBeLessThan(0.08);
  }
  await setRange(page, '#mothLeft', 0);
  await setRange(page, '#mothRight', 0);
  await page.waitForTimeout(180);
  rendered = (await state(page)).visual.downloaded;
  const neutral = { tips: rendered.mothWingTips, distal: rendered.mothSource.distal };
  const screenshot = (await page.locator('#rigCanvas').screenshot()).toString('base64');
  const wingLight = await page.evaluate(async (png) => {
    const response = await fetch(`data:image/png;base64,${png}`);
    const bitmap = await createImageBitmap(await response.blob());
    const surface = document.createElement('canvas');
    surface.width = bitmap.width; surface.height = bitmap.height;
    const ctx = surface.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return [[0.12, 0.48], [0.53, 0.89]].map(([startX, endX]) => {
      let count = 0, sum = 0;
      for (let y = Math.floor(surface.height * 0.36); y < surface.height * 0.61; y += 1) {
        for (let x = Math.floor(surface.width * startX); x < surface.width * endX; x += 1) {
          const at = (y * surface.width + x) * 4;
          const [red, green, blue] = [data[at], data[at + 1], data[at + 2]];
          if (red > blue * 1.22 && green > blue * 1.11 && red > 55) {
            sum += (red + green + blue) / 3; count += 1;
          }
        }
      }
      return { count, brightness: sum / Math.max(1, count) };
    });
  }, screenshot);
  expect(wingLight[0].count).toBeGreaterThan(5000);
  expect(wingLight[1].count).toBeGreaterThan(5000);
  expect(wingLight[0].brightness / wingLight[1].brightness).toBeGreaterThan(0.8);
  expect(wingLight[0].brightness / wingLight[1].brightness).toBeLessThan(1.2);
  await page.locator('#playButton').click();
  // The original wing tips sweep DOWN near .35 and back UP near .9. A
  // non-root wing joint changes local quaternion too; procedural hinge-only
  // motion could move the tip but cannot pass that second assertion.
  const downHandle = await page.waitForFunction((rest) => {
    const { mothWingTips: tips, mothSource: source } =
      window.rigLabDemo.state().visual.downloaded;
    if (!source || source.phase < 0.28 || source.phase > 0.43) return false;
    return tips?.every((wing, index) =>
      wing.fore[1] < rest.tips[index].fore[1] - 0.12 &&
      Math.abs(source.distal[index][0] - rest.distal[index][0]) > 0.08)
      ? { tips, source } : false;
  }, neutral);
  const down = await downHandle.jsonValue();
  await downHandle.dispose();
  const upHandle = await page.waitForFunction((lower) => {
    const { mothWingTips: tips, mothSource: source } =
      window.rigLabDemo.state().visual.downloaded;
    if (!source || source.phase < 0.84 || source.phase > 0.97) return false;
    return tips?.every((wing, index) =>
      wing.fore[1] > lower.tips[index].fore[1] + 0.12 &&
      Math.abs(source.distal[index][0] - lower.source.distal[index][0]) > 0.08)
      ? { tips, source } : false;
  }, down);
  const up = await upHandle.jsonValue();
  await upHandle.dispose();
  expect(Math.abs((down.tips[0].fore[1] - neutral.tips[0].fore[1]) -
    (down.tips[1].fore[1] - neutral.tips[1].fore[1]))).toBeLessThan(0.08);
  expect(up.source.phase).toBeGreaterThan(down.source.phase);
  await page.locator('#playButton').click();
  await page.waitForTimeout(180);
  const held = (await state(page)).visual.downloaded;
  await page.waitForTimeout(180);
  expect((await state(page)).visual.downloaded.mothSource.phase)
    .toBeCloseTo(held.mothSource.phase, 5);
  await setRange(page, '#mothLeft', 0.78);
  await page.waitForFunction((previous) =>
    window.rigLabDemo.state().visual.downloaded.mothWingTips[0].fore[2] >
      previous[0].fore[2] + 0.2, held.mothWingTips);
  const folded = (await state(page)).visual.downloaded;
  expect(Math.abs(folded.mothWingTips[1].fore[2] -
    held.mothWingTips[1].fore[2])).toBeLessThan(0.04);
  expect(folded.mothSource.distal).toEqual(held.mothSource.distal);
  expect(errors).toEqual([]);
});

test('moth wings show their lit dorsal faces above and shaded ventral faces below', async ({ page }) => {
  test.setTimeout(45_000);
  const errors = await ready(page);
  await select(page, 'moth');
  await assetReady(page, 'moth');
  await setRange(page, '#mothLeft', 0);
  await setRange(page, '#mothRight', 0);
  await page.locator('#viewFront').click();
  const topPitch = (await state(page)).visual.pitch;
  expect(topPitch).toBeGreaterThan(0.6); // The default/front view shows the textured dorsal side.
  await page.waitForTimeout(150);
  const dorsal = (await page.locator('#rigCanvas').screenshot()).toString('base64');

  // Drag empty canvas rather than a wing: look upward from below at the
  // *same downloaded model*, without swapping its textures or lights.
  const box = await page.locator('#rigCanvas').boundingBox();
  const x = box.x + box.width * 0.07, y = box.y + box.height * 0.21;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + box.height * (topPitch + 0.75) / Math.PI, { steps: 8 });
  await page.mouse.up();
  expect((await state(page)).visual.pitch).toBeLessThan(-0.6);
  await page.waitForTimeout(150);
  const ventral = (await page.locator('#rigCanvas').screenshot()).toString('base64');
  const litPixels = await page.evaluate(async (images) => Promise.all(images.map(async (png) => {
    const response = await fetch(`data:image/png;base64,${png}`);
    const bitmap = await createImageBitmap(await response.blob());
    const surface = document.createElement('canvas');
    surface.width = bitmap.width; surface.height = bitmap.height;
    const ctx = surface.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, surface.width, surface.height);
    bitmap.close();
    return [[0.12, 0.48], [0.53, 0.89]].map(([startX, endX]) => {
      let count = 0;
      for (let y = Math.floor(surface.height * 0.36); y < surface.height * 0.61; y += 1) {
        for (let x = Math.floor(surface.width * startX); x < surface.width * endX; x += 1) {
          const at = (y * surface.width + x) * 4;
          const [red, green, blue] = [data[at], data[at + 1], data[at + 2]];
          if (red > blue * 1.22 && green > blue * 1.11 && red > 55) count += 1;
        }
      }
      return count;
    });
  })), [dorsal, ventral]);
  for (let wing = 0; wing < 2; wing += 1) {
    expect(litPixels[0][wing], `dorsal wing ${wing}`).toBeGreaterThan(6000);
    expect(litPixels[1][wing], `ventral wing ${wing}`).toBeLessThan(litPixels[0][wing] / 3);
  }
  expect(errors).toEqual([]);
});

test('pancake tour shows the imported spatula stacking one cake and preserves Audio on scene change', async ({ page }) => {
  test.setTimeout(50_000);
  const errors = await ready(page);
  await select(page, 'pancakes');
  await assetReady(page, 'pancakes');
  await page.locator('#rigScene').selectOption('flip-stack');
  expect((await state(page)).pancakeStackCount).toBe(2);
  await page.locator('#playButton').click();
  await page.waitForFunction(() =>
    window.rigLabDemo.state().pancakeStackCount === 3);
  const stacked = await state(page);
  expect(stacked.scene).toBe('flip-stack');
  expect(stacked.playing).toBe(true);
  expect(stacked.visual.renderedSurfaces.authored).toBe(0);
  await page.locator('#audioButton').click();
  await page.waitForFunction(() => window.rigLabDemo.state().audioArmed);
  await page.locator('#rigScene').selectOption('tower');
  expect((await state(page)).audioArmed).toBe(true);
  expect((await state(page)).playing).toBe(true);
  await page.locator('#resetButton').click();
  expect((await state(page)).audioArmed).toBe(true);
  await page.locator('#audioButton').click();
  expect((await state(page)).audioArmed).toBe(false);
  expect(errors).toEqual([]);
});
