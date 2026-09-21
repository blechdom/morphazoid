import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const previewRepositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const previewIdentityFiles = Object.freeze([
  "nav.js",
  "src/site/instrument-registry.js",
  "src/audio.js",
]);

/** A managed server is never silently replaced by another worktree's server. */
export function previewServerConfiguration(env = process.env, root = previewRepositoryRoot) {
  const external = env.MORPHAZOID_QA_BASE_URL ?? env.PLAYWRIGHT_BASE_URL;
  if (external !== undefined) {
    const url = new URL(external);
    if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
      throw new Error("The QA base URL must be an HTTP(S) site directory without credentials, query or fragment.");
    }
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return { baseURL: url.href, webServer: undefined };
  }
  const rawPort = env.MORPHAZOID_QA_PORT ?? "3435";
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error("MORPHAZOID_QA_PORT must be an integer from 1 through 65535.");
  }
  const port = Number(rawPort);
  const baseURL = `http://127.0.0.1:${port}/`;
  return {
    baseURL,
    webServer: {
      command: `python3 scripts/dev-server.py --port ${port} --strict-port`,
      cwd: root,
      url: `${baseURL}index.html`,
      reuseExistingServer: false,
      stderr: "pipe",
      timeout: 30_000,
    },
  };
}

/**
 * Fail once, before launching tests, if an explicitly selected server is from
 * an older checkout/build. These shared files are not WAX fingerprint targets.
 * This is a baseline identity check, not proof that every resource is correct.
 */
export async function verifyPreviewSource(baseURL, {
  root = previewRepositoryRoot,
  fetchSource = globalThis.fetch,
  readSource = filename => readFile(filename),
  files = previewIdentityFiles,
} = {}) {
  for (const relative of files) {
    const url = new URL(relative, baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
    let response, served;
    try {
      response = await fetchSource(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      served = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
    } catch (error) {
      throw new Error(`Cannot check QA server ${url}: ${error.message}. Start the intended preview or unset the QA base URL to use a managed server.`);
    }
    const expected = Buffer.from(await readSource(path.join(root, relative)));
    if (!response.ok || !served.equals(expected)) {
      throw new Error([
        `Wrong or stale QA server at ${baseURL}.`,
        `${relative}: ${response.ok ? "served bytes differ from this checkout" : `HTTP ${response.status}`}.`,
        `Expected source root: ${root}`,
        "No instrument tests were run against this server.",
        "Unset MORPHAZOID_QA_BASE_URL / PLAYWRIGHT_BASE_URL and choose a free MORPHAZOID_QA_PORT,",
        "or point MORPHAZOID_QA_BASE_URL at a preview of this checkout.",
      ].join("\n"));
    }
  }
}
