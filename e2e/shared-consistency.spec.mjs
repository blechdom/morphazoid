import { expect, test } from "@playwright/test";

import { instrumentRoutes } from "./routes.mjs";

test.describe.configure({ mode: "parallel" });

for (const route of instrumentRoutes) {
  test(`${route.label} keeps the shared instrument contract`, async ({ page }, testInfo) => {
    await page.goto(route.testHref, { waitUntil: "domcontentloaded" });
    await page.locator("body").waitFor();

    const contract = await page.evaluate(() => {
      const audio = document.querySelector("#audioButton, #audioToggle");
      const mobile = document.querySelector(".mobile-instrument-select");
      const picker = document.querySelector(".instrument-picker");
      const reset = document.querySelector("[data-reset-all]");
      const transport = document.querySelector("[data-primary-transport]");
      const level = document.querySelector(".header-level input[type='range']");
      return {
        audio: audio ? {
          id: audio.id,
          pressed: audio.getAttribute("aria-pressed"),
          name: (
            audio.getAttribute("aria-label")
            || audio.textContent
            || ""
          ).replace(/\s+/gu, " ").trim(),
          disabled: Boolean(audio.disabled),
        } : null,
        mobile: mobile ? {
          label: mobile.getAttribute("aria-label"),
          options: mobile.querySelectorAll("option").length,
        } : null,
        picker: picker ? {
          activeId: picker.getAttribute("data-active-tool-id"),
          label: picker.querySelector("summary")?.getAttribute("aria-label") ?? null,
        } : null,
        hasReset: Boolean(reset),
        hasPrimaryTransport: Boolean(transport),
        hasMasterLevel: Boolean(level),
      };
    });

    await testInfo.attach(`${route.id}-shared-contract.json`, {
      body: JSON.stringify(contract, null, 2),
      contentType: "application/json",
    });

    expect(contract.audio, "every catalogue instrument needs a shared Audio control").not.toBeNull();
    expect(contract.audio?.pressed, "audio must be off before a user gesture").toBe("false");
    expect(contract.audio?.name, "the Audio control needs an accessible name").toBeTruthy();

    if (route.id === "morphazoidical") {
      // The workbench deliberately owns a compact custom header. Keep that
      // exception explicit so a second accidental design system cannot slip in.
      expect(contract.audio?.id).toBe("audioToggle");
      expect(contract.mobile).toBeNull();
      expect(contract.picker).toBeNull();
    } else {
      expect(contract.audio?.id).toBe("audioButton");
      expect(contract.mobile?.label).toBe("Instrument");
      expect(contract.mobile?.options ?? 0).toBeGreaterThan(0);
      expect(contract.picker, "shared desktop navigation should hydrate").not.toBeNull();
      expect(contract.picker?.activeId).toBe(route.id);
    }
  });
}
