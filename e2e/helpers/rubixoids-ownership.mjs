/** Run every Rubixoids regression with standalone instrument implementations
 * unavailable, so a test cannot accidentally instantiate or depend on them. */
export function enforceRubixoidsOwnership(test, expect) {
  const blockedByPage = new WeakMap();
  test.beforeEach(async ({ page }) => {
    const blocked = [];
    blockedByPage.set(page, blocked);
    await page.route(/\/src\/instruments\/(?!rubixoids\/)/, route => {
      // The browser MIDI adapter shares this site-level WAX routing helper.
      if (new URL(route.request().url()).pathname === '/src/instruments/wax/wax-midi-routing.js') return route.continue();
      blocked.push(route.request().url());
      return route.abort('blockedbyclient');
    });
  });
  test.afterEach(async ({ page }) => {
    expect(blockedByPage.get(page) ?? [], 'Rubixoids must load its own instrument modules and styles').toEqual([]);
  });
}
