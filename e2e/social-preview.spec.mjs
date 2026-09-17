import { expect, test } from "@playwright/test";

const imageUrl = "https://morphazoid.com/assets/social/morphazoid-card-20260917.png";
const imagePath = "/assets/social/morphazoid-card-20260917.png";

test("link crawlers receive an explicit logo card without executing page JavaScript", async ({ request }) => {
  for (const route of ["/", "/about.html", "/instruments.html"]) {
    const response = await request.get(route);
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
    expect(head).toContain(`property="og:image" content="${imageUrl}"`);
    expect(head).toContain(`name="twitter:image" content="${imageUrl}"`);
    expect(head).toContain('property="og:image:width" content="1200"');
    expect(head).toContain('property="og:image:height" content="630"');
    expect(head).not.toMatch(/assets\/authors?\//);
  }
  const image = await request.get(imagePath);
  expect(image.ok()).toBeTruthy();
  expect(image.headers()["content-type"]).toContain("image/png");
  const bytes = await image.body();
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`homepage logo is the first image with scripts disabled at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport });
    try {
      const page = await context.newPage();
      await page.goto(baseURL);
      const first = page.locator("img").first();
      await expect(first).toHaveClass("about-title-mark");
      await expect(first).toHaveAttribute("src", "assets/social/morphazoid-mark-20260917.png");
      await expect(first).toBeVisible();
      await expect(page.locator(".author-mark")).toHaveAttribute("src", "assets/authors/kristin-galvin.png");
      const logo = await first.boundingBox();
      expect(logo.width).toBeGreaterThan(24);
      expect(logo.height).toBeGreaterThan(24);
      expect(logo.x + logo.width).toBeLessThanOrEqual(viewport.width);
    } finally {
      await context.close();
    }
  });
}
