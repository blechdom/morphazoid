const DEFAULT_BASE_URL = "http://127.0.0.1:3435";

function isFirstPartyUrl(value, baseURL) {
  try {
    return new URL(value).origin === new URL(baseURL).origin;
  } catch {
    return false;
  }
}

function locationSuffix(location = {}) {
  if (!location.url) return "";
  const line = Number.isInteger(location.lineNumber) ? `:${location.lineNumber + 1}` : "";
  const column = Number.isInteger(location.columnNumber) ? `:${location.columnNumber + 1}` : "";
  return ` (${location.url}${line}${column})`;
}

/**
 * Collect actionable failures emitted while a page loads or runs.
 * External URLs are intentionally excluded from network gates: third-party
 * reference links must not make the local test suite depend on the internet.
 */
export function watchPageDiagnostics(page, { baseURL = DEFAULT_BASE_URL } = {}) {
  const diagnostics = {
    consoleErrors: [],
    httpErrors: [],
    pageErrors: [],
    requestFailures: [],
  };

  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(error?.stack || error?.message || String(error));
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    diagnostics.consoleErrors.push(`${message.text()}${locationSuffix(message.location())}`);
  });

  page.on("requestfailed", (request) => {
    if (!isFirstPartyUrl(request.url(), baseURL)) return;
    const failure = request.failure()?.errorText ?? "unknown request failure";
    diagnostics.requestFailures.push(`${request.method()} ${request.url()} — ${failure}`);
  });

  page.on("response", (response) => {
    if (response.status() < 400 || !isFirstPartyUrl(response.url(), baseURL)) return;
    diagnostics.httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });

  return diagnostics;
}

export async function settlePage(page, { loadTimeout = 10_000 } = {}) {
  // Some legacy aliases redirect with a zero-delay meta refresh, which can
  // replace the execution context just after goto() returns. Retry only that
  // navigation race; page exceptions remain visible through pageerror.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForLoadState("domcontentloaded");
    try {
      await page.waitForLoadState("load", { timeout: loadTimeout });
    } catch (error) {
      if (error?.name !== "TimeoutError") throw error;
    }

    try {
      await page.evaluate(async () => {
        if (document.fonts?.ready) {
          await Promise.race([
            document.fonts.ready,
            new Promise((resolve) => setTimeout(resolve, 1_000)),
          ]);
        }
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
      return;
    } catch (error) {
      if (!/Execution context was destroyed|most likely because of a navigation/iu.test(error?.message)) {
        throw error;
      }
    }
  }

  throw new Error(`Page did not reach a stable document after redirects: ${page.url()}`);
}

export function pageDiagnosticMessages(diagnostics) {
  return [
    ...diagnostics.pageErrors.map((message) => `page error: ${message}`),
    ...diagnostics.consoleErrors.map((message) => `console error: ${message}`),
    ...diagnostics.requestFailures.map((message) => `request failed: ${message}`),
    ...diagnostics.httpErrors.map((message) => `HTTP error: ${message}`),
  ];
}

export function formatPageDiagnostics(diagnostics) {
  const messages = pageDiagnosticMessages(diagnostics);
  return messages.length ? messages.map((message) => `- ${message}`).join("\n") : "none";
}
