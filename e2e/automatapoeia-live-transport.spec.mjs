import { expect, test } from "@playwright/test";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

import { observeAutomataState as probe } from "./helpers/automatapoeia-probe.mjs";

const snapshot = page => page.evaluate(() => __caSnapshot());
async function setControl(page, id, value) {
  await page.locator(`#${id}`).evaluate((control, value) => {
    control.value = String(value);
    control.dispatchEvent(new Event(control.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }, value);
}

for (const prefix of ["", "/dist-wax"]) {
  test(`${prefix || "source"}: paused startup, independent Audio, round Play by rate, pause/resume`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await probe(page);
    await page.goto(`${prefix}/automatapoeia.html`);
    // The graphic has no visible title/caption/status overlays. Keep the
    // accessible heading and metadata without covering the cellular rows.
    await expect(page.locator(".stage .experiment-title, .stage .stage-meta")).toHaveCount(0);
    for (const selector of [".stage h1", "#stageCaption", "#stageReadout"]) {
      expect(await page.locator(selector).evaluate(element => Boolean(element.closest(".sr-only")))).toBe(true);
    }
    const initial = await snapshot(page);
    expect(initial.playing).toBe(false);
    expect(initial.generation).toBe(0);
    expect(initial.contextCount).toBe(0);
    const play = page.locator("#playButton");
    await expect(play).toHaveClass(/play-button/);
    const placement = await play.evaluate(button => {
      const b = button.getBoundingClientRect(), rate = document.getElementById("caRate").closest("label").getBoundingClientRect();
      return { width: b.width, height: b.height, leftOfRate: b.right <= rate.left, sameRow: b.top < rate.bottom && b.bottom > rate.top };
    });
    expect(placement.width).toBeGreaterThanOrEqual(48);
    expect(placement.height).toBeGreaterThanOrEqual(48);
    expect(placement.leftOfRate && placement.sameRow).toBe(true);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(450);
    expect((await snapshot(page)).rows).toEqual(initial.rows);
    expect((await snapshot(page)).sources).toBe(0);
    await play.click();
    await expect(play.locator(".transport-pause")).toBeVisible();
    expect(await play.evaluate(button => getComputedStyle(button).color === getComputedStyle(button).backgroundColor)).toBe(false);
    await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(2);
    await play.click();
    const paused = await snapshot(page);
    await page.waitForTimeout(450);
    expect((await snapshot(page)).rows).toEqual(paused.rows);
    expect((await snapshot(page)).sources).toBe(0);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await setControl(page, "caRule", 90);
    await page.waitForTimeout(200);
    expect((await snapshot(page)).rows).toEqual(paused.rows);
    await page.locator("#stage").focus();
    await page.keyboard.press("Space");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(paused.generation);
    await page.locator("#audioButton").click();
    const muted = await snapshot(page);
    await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(muted.generation);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test(`${prefix || "source"}: presets and controls replace the very next row without clearing or reseeding`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await probe(page);
    await page.goto(`${prefix}/automatapoeia.html`);
    await setControl(page, "caRate", 3);
    await setControl(page, "caSwing", 0);
    await page.locator("#audioButton").click();
    await page.locator("#playButton").click();
    await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(3);
    // Recall in one task: no intervening timer can obscure which row changed.
    const recall = await page.evaluate(() => {
      const before = __caSnapshot();
      document.querySelector('[data-preset-id="columns-110"]').click();
      return { before, after: __caSnapshot() };
    });
    expect(recall.after.rows).toEqual(recall.before.rows);
    expect(recall.after.initial).toEqual(recall.before.initial);
    expect(recall.after.playing).toBe(true);
    expect(recall.after.next.time).toBe(recall.before.next?.time ?? recall.before.nextTime);
    const expected = await page.evaluate(async ({ rows, parameters, prefix }) => {
      const model = await import(`${prefix}/src/instruments/cellular-automata/automatapoeia.js`);
      const previous = rows.at(-1);
      return previous.length !== parameters.caWidth
        ? model.automatapoeiaResizeRow(previous, parameters.caWidth)
        : model.automatapoeiaTransformRow(model.automatapoeiaNextRow(previous, parameters.caRule, parameters.caBoundary, parameters.caFamily), parameters.caTransform, parameters.caBoundary);
    }, { rows: recall.before.rows, parameters: recall.after.parameters, prefix });
    expect(recall.after.next.view.caRows).toEqual([...recall.before.rows, expected]);
    await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(recall.before.generation);
    const heard = await snapshot(page);
    expect(heard.rows.slice(0, recall.before.rows.length)).toEqual(recall.before.rows);
    expect(heard.rows[recall.before.rows.length]).toEqual(expected);
    const edit = await page.evaluate(() => {
      const before = __caSnapshot();
      for (const [id, value] of Object.entries({ caRate: 2, caSwing: 0, caRule: 0 })) {
        const control = document.getElementById(id);
        control.value = String(value); control.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return { before, after: __caSnapshot() };
    });
    expect(edit.after.rows).toEqual(edit.before.rows);
    expect(edit.after.next.time).toBe(edit.before.next?.time ?? edit.before.nextTime);
    expect(edit.after.next.view.caGeneration).toBe(edit.before.generation + 1);
    expect(edit.after.next.view.caRows.at(-1).every(cell => cell === 0)).toBe(true);
    await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(edit.before.generation);
    expect((await snapshot(page)).rows[edit.before.rows.length].every(cell => cell === 0)).toBe(true);
    await page.locator("#playButton").click();
    const paused = await snapshot(page);
    await page.locator('.header-preset-random').click();
    expect((await snapshot(page)).rows).toEqual(paused.rows);
    expect((await snapshot(page)).initial).toEqual(paused.initial);
    expect((await snapshot(page)).playing).toBe(false);
    // Explicit Restart is still the one deliberate clear-history command.
    await page.locator("#seedAutomata").click();
    expect((await snapshot(page)).rows).toHaveLength(1);
    expect((await snapshot(page)).generation).toBe(0);
    expect((await snapshot(page)).playing).toBe(false);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}
