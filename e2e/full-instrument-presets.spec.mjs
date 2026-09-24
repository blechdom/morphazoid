import { expect, test } from "@playwright/test";
import { CREATURAZOID_FULL_PRESETS } from "../src/instruments/creaturazoid/full-presets.js";
import { HICCUP_HEAD_FULL_PRESETS } from "../src/instruments/hiccup-head/full-presets.js";
import { KARPLUS_STRONG_FULL_PRESETS } from "../src/instruments/karplus-strong/full-presets.js";
import { algorithmicFullPresets } from "../src/families/algorithmic-scores/full-presets.js";
import { CASCADING_FM_FULL_PRESETS, CASCADING_PM_FULL_PRESETS } from "../src/families/cascading/full-presets.js";
import { SHAPE_FULL_PRESETS } from "../src/instruments/shape-synth/full-presets.js";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const banks = [
  ["creaturazoid", CREATURAZOID_FULL_PRESETS],
  ["hiccup-head", HICCUP_HEAD_FULL_PRESETS],
  ["karplus-strong", KARPLUS_STRONG_FULL_PRESETS],
  ...["dijkstra", "hanoi", "minimax", "nqueens", "euclid"].map(id => [id, algorithmicFullPresets(id)]),
  ["cascading-fm", CASCADING_FM_FULL_PRESETS],
  ["cascading-pm", CASCADING_PM_FULL_PRESETS],
  ["shape-synth", SHAPE_FULL_PRESETS],
];
const readPreset = page => page.evaluate(async () => {
  const { captureHeaderPresetState } = await import(new URL("src/site/header-presets.js",
    location.pathname.includes("/dist-wax/") ? `${location.origin}/dist-wax/` : `${location.origin}/`));
  return captureHeaderPresetState();
});
const outputLevel = snapshot => snapshot.parameters?.level ?? snapshot.state?.level
  ?? snapshot.settings?.level ?? snapshot.settings?.output ?? snapshot.level;
async function select(page, presetId) {
  const picker = page.locator(".header-preset-picker");
  if (!await picker.evaluate(node => node.open)) await picker.locator(":scope > summary").click();
  await picker.locator(`button[data-full-preset][data-preset-id="${presetId}"]`).click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", presetId);
}

async function expectPresetMidiMeterOrder(page) {
  const order = await page.locator(".header-preset-controls").evaluate(node => {
    const host = document.querySelector("[data-instrument-preset-host]");
    const header = document.querySelector(".masthead");
    const io = header.querySelector(".header-io-controls");
    return {
      firstInPanel: host.firstElementChild === node,
      insideHeader: header.contains(node),
      midiInSettings: Boolean(header.querySelector(".header-settings-panel .midi-toggle")),
      meterFirst: io.firstElementChild.classList.contains("header-output-meter-shell"),
      settingsLast: io.lastElementChild.classList.contains("header-settings-menu"),
    };
  });
  expect(order).toEqual({ firstInPanel: true, insideHeader: false, midiInSettings: true, meterFirst: true, settingsLast: true });
}

async function expectPresetPanelAnchored(page) {
  const placement = () => page.locator(".header-preset-picker").evaluate(picker => {
    const trigger = picker.querySelector(":scope > summary").getBoundingClientRect();
    const panel = picker.querySelector(".instrument-picker-panel").getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? document.documentElement.clientWidth);
    const bottom = top + (viewport?.height ?? document.documentElement.clientHeight);
    const expectedLeft = Math.max(left + 8, Math.min(trigger.left, right - 8 - panel.width));
    return {
      // Once resize/scroll takes the trigger offscreen, dock at that viewport
      // edge rather than keep an impossible four-pixel offscreen gap.
      verticalError: Math.min(
        Math.abs(panel.top - Math.max(top + 8, Math.min(trigger.bottom + 4, bottom - 8))),
        Math.abs(panel.bottom - Math.max(top + 8, Math.min(trigger.top - 4, bottom - 8))),
      ),
      horizontalError: Math.abs(panel.left - expectedLeft),
      insideViewport: panel.left >= left + 7 && panel.right <= right - 7
        && panel.top >= top + 7 && panel.bottom <= bottom - 7,
    };
  });
  await expect.poll(async () => (await placement()).verticalError).toBeLessThan(1);
  const result = await placement();
  expect(result.horizontalError).toBeLessThan(1);
  expect(result.insideViewport).toBe(true);
}

for (const [id, bank] of banks) {
  test(`${id}: dice randomizes parameters, keeps Audio off and allows exact factory recovery`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`, { waitUntil: "load" });
    await settlePage(page);
    await select(page, bank[0].id);
    const dice = page.getByRole("button", { name: "Randomize instrument parameters", exact: true });
    await expect(dice).toHaveCount(1);
    let previous = (await readPreset(page)).snapshot;
    for (let roll = 0; roll < 6; roll++) {
      await dice.click();
      await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
      const { snapshot, selectedId } = await readPreset(page);
      expect(selectedId).toBeNull();
      expect(snapshot).not.toEqual(previous);
      for (const preset of bank) expect(snapshot).not.toEqual(preset.snapshot);
      expect(outputLevel(snapshot)).toBe(outputLevel(previous));
      if (id === "shape-synth") {
        expect(snapshot.parameters.playing || snapshot.parameters.autoRotate).toBe(true);
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", String(snapshot.parameters.playing));
        await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", String(snapshot.parameters.autoRotate));
      }
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      previous = snapshot;
    }
    // Keyboard button activation uses the same transaction, not a performance note.
    await dice.focus();
    await page.keyboard.press("Enter");
    expect((await readPreset(page)).snapshot).not.toEqual(previous);
    previous = (await readPreset(page)).snapshot;
    await page.keyboard.press("Space");
    expect((await readPreset(page)).snapshot).not.toEqual(previous);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await select(page, bank[0].id);
    expect((await readPreset(page)).snapshot).toEqual(bank[0].snapshot);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test(`${id}: all full presets recall exact complete state without arming Audio`, async ({ page, baseURL }) => {
    test.setTimeout(90000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`, { waitUntil: "load" });
    await settlePage(page);
    await expect(page.locator(".header-preset-controls")).toHaveCount(1);
    await expect(page.locator(".header-preset-picker button[data-full-preset]")).toHaveCount(bank.length);
    await expect(page.locator(".header-preset-picker details")).toHaveCount(0);
    await expect(page.locator(".header-preset-picker select")).toHaveCount(0);
    await expect(page.locator(".header-preset-picker")).not.toContainText("Edit preset ingredients");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    for (const preset of bank) {
      await select(page, preset.id);
      expect((await readPreset(page)).snapshot).toEqual(preset.snapshot);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      if (id === "shape-synth") {
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", String(preset.snapshot.parameters.playing));
        await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", String(preset.snapshot.parameters.autoRotate));
      }
    }
    await page.locator(".header-preset-next").click();
    expect((await readPreset(page)).selectedId).toBe(bank[0].id);
    await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
    await page.keyboard.press("ArrowRight");
    expect((await readPreset(page)).selectedId).toBe(bank[1].id);
    await page.keyboard.press("ArrowLeft");
    expect((await readPreset(page)).snapshot).toEqual(bank[0].snapshot);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

for (const [id, bank] of banks.slice(0, 2)) {
  test(`${id}: edited body, rhythm and voice settings return together; input arrows stay local`, async ({ page }) => {
    await page.goto(`${id}.html`);
    await select(page, bank[0].id);
    const first = await readPreset(page);
    const tempo = page.locator("#tempo");
    await tempo.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
    const edited = await readPreset(page);
    expect(edited.snapshot.state.tempo).not.toBe(first.snapshot.state.tempo);
    expect(edited.snapshot.pattern).toEqual(first.snapshot.pattern);
    await page.locator("#clearPatternButton").click();
    expect((await readPreset(page)).snapshot.pattern).not.toEqual(first.snapshot.pattern);
    await select(page, bank[1].id);
    await select(page, bank[0].id);
    expect((await readPreset(page)).snapshot).toEqual(first.snapshot);
    expect(await page.locator(".panel #presetSelect").count()).toBe(1);
    expect(await page.locator(".header-preset-picker #presetSelect").count()).toBe(0);
    expect(await page.locator(`.${id}-sequencer #patternSelect`).count()).toBe(1);
  });

  test(`${id}: live full-preset changes keep Audio and transport running`, async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`);
    await select(page, bank[0].id);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#playButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.00001);
    const connections = (await readAudioStatus(page)).connectionCount;
    for (const preset of [bank[3], bank[6], bank[0]]) {
      await select(page, preset.id);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
      expect((await readAudioStatus(page)).connectionCount).toBe(connections);
      expect((await readPreset(page)).snapshot).toEqual(preset.snapshot);
    }
    for (let roll = 0; roll < 3; roll++) {
      await page.locator(".header-preset-random").click();
      await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
      expect((await readAudioStatus(page)).connectionCount).toBe(connections);
    }
    const envelope = await sampleAudioEnvelope(page, { durationMs: 900 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.clippedSamples).toBe(0);
    expect(envelope.summary.maxPeak).toBeGreaterThan(0.00001);
    await testInfo.attach("preset-playback.json", { body: JSON.stringify(envelope), contentType: "application/json" });
    await page.evaluate(() => dispatchEvent(new Event("pagehide")));
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

for (const layout of [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "portrait", width: 390, height: 844, touch: true },
  { name: "landscape", width: 844, height: 390, touch: true },
]) {
  test.describe(layout.name, () => {
    test.use({ viewport: { width: layout.width, height: layout.height }, hasTouch: layout.touch });
    test("the preset control uses Choose styling at the top of the right panel", async ({ page }, testInfo) => {
      await page.goto("creaturazoid.html");
      await settlePage(page);
      await expect(page.locator(".header-preset-controls")).toBeVisible();
      await expectPresetMidiMeterOrder(page);
      const actual = await page.locator(".header-preset-controls").evaluate(node => {
        const box = node.getBoundingClientRect();
        const next = node.querySelector(".header-preset-next").getBoundingClientRect();
        const random = node.querySelector(".header-preset-random").getBoundingClientRect();
        const trigger = node.querySelector(".instrument-picker-trigger").getBoundingClientRect();
        const preset = getComputedStyle(node.querySelector(".instrument-picker-trigger"));
        const choose = getComputedStyle(document.querySelector(".tabs .instrument-picker-trigger"));
        return {
          right: box.right, width: document.documentElement.scrollWidth,
          nextWidth: next.width, nextHeight: next.height,
          randomWidth: random.width, randomHeight: random.height,
          randomAfterNext: random.left >= next.right && random.right <= box.right,
          triggerWidth: trigger.width,
          sameStyle: ["fontFamily", "color", "backgroundColor", "borderTopWidth"].every(key => preset[key] === choose[key]),
        };
      });
      expect(actual.width).toBeLessThanOrEqual(layout.width);
      expect(actual.right).toBeLessThanOrEqual(layout.width);
      expect(actual.sameStyle).toBe(true);
      expect(actual.randomAfterNext).toBe(true);
      expect(actual.triggerWidth).toBeGreaterThanOrEqual(48);
      if (layout.touch) {
        expect(actual.nextWidth).toBeGreaterThanOrEqual(48); expect(actual.nextHeight).toBeGreaterThanOrEqual(48);
        expect(actual.randomWidth).toBeGreaterThanOrEqual(48); expect(actual.randomHeight).toBeGreaterThanOrEqual(48);
      }
      await page.locator(".header-preset-next").focus();
      await page.keyboard.press("Tab");
      await expect(page.locator(".header-preset-random")).toBeFocused();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement.closest("[data-instrument-preset-host]")))).toBe(true);
      await expect(page.locator(".header-settings-panel .midi-toggle")).not.toBeFocused();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      await page.locator(".header-preset-picker > summary").click();
      await expectPresetPanelAnchored(page);
      await page.getByRole("searchbox", { name: "Filter presets" }).fill("Sweet");
      await expect(page.locator(".header-preset-picker button[data-full-preset]:visible")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("searchbox", { name: "Filter presets" })).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(page.locator(".header-preset-picker")).not.toHaveAttribute("open", "");
      await page.screenshot({ path: testInfo.outputPath("header-presets.png") });
    });

    test("Hiccup Head presets open under their own heading, not at the navigation edge", async ({ page }) => {
      await page.goto("hiccup-head.html");
      await settlePage(page);
      await expectPresetMidiMeterOrder(page);
      await page.locator(".header-preset-picker > summary").click();
      await expectPresetPanelAnchored(page);
      await page.getByRole("searchbox", { name: "Filter presets" }).fill("sweet");
      await expect(page.locator(".header-preset-picker button[data-full-preset]:visible")).toHaveCount(1);
      await expectPresetPanelAnchored(page);
      await page.locator('.header-preset-picker button[data-full-preset][data-preset-id="sweet-humming"]').click();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    });
  });
}

test("an open preset popup stays anchored after viewport and header layout changes", async ({ page }) => {
  await page.goto("hiccup-head.html");
  await settlePage(page);
  await page.locator(".header-preset-picker > summary").click();
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 844, height: 390 }, { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expectPresetPanelAnchored(page);
  }
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("WAX retains the same complete preset content and keeps Audio explicit", async ({ page }) => {
  await page.goto("dist-wax/creaturazoid.html");
  await select(page, CREATURAZOID_FULL_PRESETS[1].id);
  expect((await readPreset(page)).snapshot).toEqual(CREATURAZOID_FULL_PRESETS[1].snapshot);
  await page.locator(".header-preset-random").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("Shape recalls motion switches and spacing without arming Audio or recreating its audio owner", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("shape.html?header-presets=1#kept");
  await settlePage(page);
  await expect(page).toHaveURL(/\/shape-synth\.html\?header-presets=1#kept$/);
  await expect(page.locator(".header-preset-controls")).toBeVisible();
  await expectPresetMidiMeterOrder(page);
  await select(page, "crossed-scanners");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#heads")).toHaveValue("4");
  await expect(page.locator("#soundMode")).toHaveValue("pm");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", "true");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.00001);
  const connections = (await readAudioStatus(page)).connectionCount;
  for (const id of ["glass-star", "uneven-drum-wheel", "velvet-wheel", "twelve-point-braid", "endless-climb", "square-study"]) {
    const preset = SHAPE_FULL_PRESETS.find(preset => preset.id === id);
    await select(page, id);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", String(preset.snapshot.parameters.playing));
    await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", String(preset.snapshot.parameters.autoRotate));
    expect((await readAudioStatus(page)).connectionCount).toBe(connections);
    expect((await readPreset(page)).snapshot).toEqual(preset.snapshot);
  }
  for (let roll = 0; roll < 3; roll++) {
    await page.locator(".header-preset-random").click();
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    const randomized = (await readPreset(page)).snapshot.parameters;
    expect(randomized.playing || randomized.autoRotate).toBe(true);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", String(randomized.playing));
    await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", String(randomized.autoRotate));
    expect((await readAudioStatus(page)).connectionCount).toBe(connections);
  }
  // The paused preset was removed; ordinary manual pause still leaves Audio on.
  if (await page.locator("#playButton").getAttribute("aria-pressed") === "true") await page.locator("#playButton").click();
  if (await page.locator("#rotationPlayButton").getAttribute("aria-pressed") === "true") await page.locator("#rotationPlayButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(0.0001);
  expect((await readAudioStatus(page)).connectionCount).toBe(connections);
  await page.locator("#stage").focus();
  const chosen = (await readPreset(page)).selectedId;
  await page.keyboard.press("ArrowRight");
  expect((await readPreset(page)).selectedId).toBe(chosen, "canvas arrows still scrub, not select presets");
  // The ordinary controls remain authoritative after preset recall.
  await page.locator("#rotationPlayButton").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await select(page, "twin-comets");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Shape preset head offsets reach the visible spacing controls and restore after editing", async ({ page }) => {
  await page.goto("shape-synth.html");
  await select(page, "twelve-point-braid");
  const preset = SHAPE_FULL_PRESETS.find(preset => preset.id === "twelve-point-braid");
  for (let i = 0; i < preset.snapshot.parameters.heads; i++) {
    await expect(page.locator(`#headMarker${i}`)).toHaveAttribute("aria-valuenow",
      preset.snapshot.parameters.headOffsets[i].toFixed(3));
  }
  await page.locator("#resetHeadSpacing").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  const current = await readPreset(page);
  expect(current.snapshot.parameters.headOffsets).toEqual(Array.from({ length: 12 }, (_, i) => i / 12));
  await select(page, preset.id);
  expect((await readPreset(page)).snapshot).toEqual(preset.snapshot);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("Shape audition fixes retain smooth percussion, the original square, and mixed rotation controls", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("shape-synth.html");
  await settlePage(page);
  await expect(page.locator('.header-preset-picker [data-preset-id="soft-orbit"]')).toHaveCount(0);
  await select(page, "velvet-wheel");
  await expect(page.locator("#sides")).toHaveValue("4");
  await expect(page.locator("#curvature")).toHaveValue("0");
  await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  const evidence = [];
  for (const id of ["clustered-marimba", "orbiting-knuckles", "low-corner-kit", "insect-clock", "uneven-drum-wheel", "corner-storm"]) {
    await select(page, id);
    expect((await readPreset(page)).snapshot).toEqual(SHAPE_FULL_PRESETS.find(p => p.id === id).snapshot);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 1600 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.clippedSamples).toBe(0);
    expect(envelope.summary.maxPeak).toBeGreaterThan(0.00001);
    evidence.push({ id, envelope });
  }
  for (const id of ["bowed-line", "bowed-line-reel", "bowed-line-rocker"]) {
    await select(page, id);
    await expect(page.locator("#sides")).toHaveValue("2");
    await expect(page.locator("#rotationPlayButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  }
  await testInfo.attach("shape-audition-fixes.json", { body: JSON.stringify(evidence), contentType: "application/json" });
  // Coarse meters establish signal/level, not absence of perceptual clicks.
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Hiccup audition additions keep all new beats available locally and swap the requested main entries", async ({ page }) => {
  await page.goto("hiccup-head.html");
  await settlePage(page);
  const ids = await page.locator(".header-preset-picker [data-full-preset]").evaluateAll(nodes => nodes.map(node => node.dataset.presetId));
  expect(ids[1]).toBe("tongue-sprint");
  expect(ids[18]).toBe("sweet-humming");
  for (const id of ["pocket-beat", "rubber-skip", "tongue-breakbeat", "half-time-breath", "fwee-conversation", "mouth-crossbeat"]) {
    const preset = HICCUP_HEAD_FULL_PRESETS.find(p => p.id === id);
    await select(page, id);
    await expect(page.locator("#patternSelect")).toHaveValue(preset.snapshot.currentPatternId);
    expect((await readPreset(page)).snapshot).toEqual(preset.snapshot);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  }
  await page.locator("#patternSelect").selectOption("pocket-backbeat");
  await expect(page.locator("#presetSelect")).toHaveValue("open-throat");
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
});
