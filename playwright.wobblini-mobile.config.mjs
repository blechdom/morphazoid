import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

// Opt-in WebKit regression coverage. These current desktop WebKit builds with
// mobile viewports do not emulate an old iOS release or an iPhone's CPU/memory.
export default defineConfig({
  ...base,
  testMatch: "wobblini-mobile.spec.mjs",
  use: { ...base.use, contextOptions: { ...base.use.contextOptions, reducedMotion: "reduce" } },
  projects: [
    { name: "webkit-phone-375", use: { browserName: "webkit", viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: "webkit-phone-320", use: { browserName: "webkit", viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
});
