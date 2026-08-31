import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function contentVersion(source) {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function versionReference(source, pathname, version) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(
    new RegExp(`${escaped}(?:\\?v=[^\"']+)?`, "g"),
    `${pathname}?v=${version}`,
  );
}

export async function fingerprintHiccupHead(outputDirectory) {
  const modelPath = path.join(outputDirectory, "src/hiccup-head.js");
  const processorPath = path.join(outputDirectory, "src/hiccup-head-processor.js");
  const appPath = path.join(outputDirectory, "hiccup-head-app.js");
  const cssPath = path.join(outputDirectory, "hiccup-head.css");
  const htmlPath = path.join(outputDirectory, "hiccup-head.html");

  const model = await readFile(modelPath, "utf8");
  const modelVersion = contentVersion(model);

  let processor = await readFile(processorPath, "utf8");
  processor = versionReference(processor, "./hiccup-head.js", modelVersion);
  await writeFile(processorPath, processor, "utf8");
  const processorVersion = contentVersion(processor);

  let app = await readFile(appPath, "utf8");
  app = versionReference(app, "./src/hiccup-head.js", modelVersion);
  app = versionReference(app, "./src/hiccup-head-processor.js", processorVersion);
  await writeFile(appPath, app, "utf8");
  const appVersion = contentVersion(app);

  const css = await readFile(cssPath, "utf8");
  const cssVersion = contentVersion(css);
  let html = await readFile(htmlPath, "utf8");
  html = versionReference(html, "hiccup-head.css", cssVersion);
  html = versionReference(html, "hiccup-head-app.js", appVersion);
  await writeFile(htmlPath, html, "utf8");

  return { appVersion, cssVersion, modelVersion, processorVersion };
}
