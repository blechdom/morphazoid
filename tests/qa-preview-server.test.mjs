import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { previewServerConfiguration, verifyPreviewSource } from "../scripts/qa/preview-server.mjs";

test("default QA server belongs to the configured checkout and cannot reuse another server", () => {
  const config = previewServerConfiguration({}, "/workspace/test checkout");
  assert.equal(config.baseURL, "http://127.0.0.1:3435/");
  assert.equal(config.webServer.cwd, "/workspace/test checkout");
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(config.webServer.command, "python3 scripts/dev-server.py --port 3435 --strict-port");
});

test("a custom QA port changes both the launched server and browser base URL", () => {
  const config = previewServerConfiguration({ MORPHAZOID_QA_PORT: "4381" });
  assert.equal(config.baseURL, "http://127.0.0.1:4381/");
  assert.equal(config.webServer.url, "http://127.0.0.1:4381/index.html");
  assert.match(config.webServer.command, /--port 4381 --strict-port$/);
  for (const invalid of ["", "0", "-1", "65536", "abc", "4381; echo oops"]) {
    assert.throws(() => previewServerConfiguration({ MORPHAZOID_QA_PORT: invalid }), /integer/);
  }
});

test("an explicit external preview is not paired with an unrelated hardcoded server", () => {
  const config = previewServerConfiguration({
    MORPHAZOID_QA_BASE_URL: "http://127.0.0.1:4370/dist-wax",
    MORPHAZOID_QA_PORT: "4381",
  });
  assert.equal(config.baseURL, "http://127.0.0.1:4370/dist-wax/");
  assert.equal(config.webServer, undefined);
  assert.equal(previewServerConfiguration({ PLAYWRIGHT_BASE_URL: "http://localhost:4444" }).baseURL, "http://localhost:4444/");
  for (const invalid of ["file:///tmp/site/", "http://user:secret@localhost/", "http://localhost/?preview=1"]) {
    assert.throws(() => previewServerConfiguration({ MORPHAZOID_QA_BASE_URL: invalid }));
  }
});

test("preview preflight compares served bytes and preserves deployment subpaths", async () => {
  const requested = [];
  await verifyPreviewSource("http://localhost:4381/site/", {
    root: "/worktree",
    files: ["nav.js", "src/audio.js"],
    readSource: async filename => Buffer.from(filename.endsWith("nav.js") ? "nav" : "audio"),
    fetchSource: async (url, options) => {
      requested.push(String(url));
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal);
      return new Response(String(url).endsWith("nav.js") ? "nav" : "audio");
    },
  });
  assert.deepEqual(requested, ["http://localhost:4381/site/nav.js", "http://localhost:4381/site/src/audio.js"]);
});

test("preview preflight stops on stale bytes or 404 with an actionable wrong-worktree error", async () => {
  for (const response of [new Response("old checkout"), new Response("Not found", { status: 404 })]) {
    await assert.rejects(verifyPreviewSource("http://localhost:3435/", {
      root: "/expected/worktree", files: ["nav.js"],
      readSource: async () => Buffer.from("new checkout"),
      fetchSource: async () => response,
    }), error => {
      assert.match(error.message, /Wrong or stale QA server/);
      assert.match(error.message, /\/expected\/worktree/);
      assert.match(error.message, /No instrument tests were run/);
      assert.match(error.message, /MORPHAZOID_QA_PORT/);
      return true;
    });
  }
});

test("preview connection failures do not masquerade as instrument regressions", async () => {
  await assert.rejects(verifyPreviewSource("http://localhost:4381/", {
    files: ["nav.js"],
    fetchSource: async () => { throw new Error("connection refused"); },
  }), /Cannot check QA server.*connection refused/);
});

test("Playwright and smoke diagnostics use the shared preview policy", async () => {
  const config = await readFile(new URL("../playwright.config.mjs", import.meta.url), "utf8");
  const smoke = await readFile(new URL("../e2e/site-smoke.spec.mjs", import.meta.url), "utf8");
  assert.match(config, /previewServerConfiguration\(\)/);
  assert.match(config, /globalSetup: "\.\/e2e\/preview-setup\.mjs"/);
  assert.doesNotMatch(config, /reuseExistingServer: !process.env.CI/);
  assert.match(smoke, /watchPageDiagnostics\(page, \{ baseURL \}\)/);
});

test("the standalone artwork gallery declares the existing favicon instead of requesting favicon.ico", async () => {
  const page = new URL("../artwork/vector-instrument-icons/options/index.html", import.meta.url);
  const html = await readFile(page, "utf8");
  const icon = html.match(/<link rel="icon" href="([^"]+)"/)?.[1];
  assert.ok(icon);
  assert.equal(new URL(icon, page).href, new URL("../favicon.svg", import.meta.url).href);
  assert.ok((await readFile(new URL(icon, page))).length > 0);
});

test("every top-level HTML entry including legacy redirects declares an existing local favicon", async () => {
  const root = new URL("../", import.meta.url);
  for (const name of (await readdir(root)).filter(name => name.endsWith(".html"))) {
    const html = await readFile(new URL(name, root), "utf8");
    const icon = html.match(/<link\b[^>]*\brel=["'](?:shortcut )?icon["'][^>]*\bhref=["']([^"']+)["']/i)?.[1];
    assert.ok(icon, `${name}: browsers must not fall back to a missing favicon.ico`);
    const url = new URL(icon, new URL(name, root));
    assert.equal(url.protocol, "file:", `${name}: local icon`);
    assert.ok((await readFile(url)).length > 0, `${name}: icon exists`);
  }
});
