import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { fingerprintDentaphone } from "./fingerprint-dentaphone.mjs";
import { fingerprintHiccupHead } from "./fingerprint-hiccup-head.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const waxSourceDirectory = path.join(scriptDirectory, "wax");
const bootstrapFilename = "wax-host-bootstrap.js";
const bridgeFilename = "wax-host-bridge.js";
const universalAdapterFilename = "wax-universal-adapter.js";
const universalAdapterStylesheetFilename = "wax-universal-adapter.css";
const marker = "data-morphazoid-wax-bootstrap";
const adapterMarker = "data-morphazoid-wax-universal-adapter";

function browserPath(value) {
  return value.split(path.sep).join("/");
}

export function injectWaxBootstrap(html, bootstrapSource) {
  if (typeof html !== "string") throw new TypeError("HTML source must be a string");
  if (html.includes(marker)) return html;

  const tag = `<script src="${bootstrapSource}" ${marker}></script>`;
  const charset = /<meta\b[^>]*\bcharset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/i;
  if (charset.test(html)) return html.replace(charset, (match) => `${match}\n    ${tag}`);

  const head = /<head\b[^>]*>/i;
  if (head.test(html)) return html.replace(head, (match) => `${match}\n    ${tag}`);
  throw new Error("Cannot inject the WAX bootstrap into HTML without a <head>");
}

export function injectWaxUniversalAdapter(html, adapterSource) {
  if (typeof html !== "string") throw new TypeError("HTML source must be a string");
  if (html.includes(adapterMarker)) return html;
  const tag = `<script type="module" src="${adapterSource}" ${adapterMarker}></script>`;
  const bodyEnd = /<\/body\s*>/i;
  if (bodyEnd.test(html)) return html.replace(bodyEnd, `  ${tag}\n</body>`);
  throw new Error("Cannot inject the WAX universal adapter into HTML without a </body>");
}

export function waxBootstrapPathFor(htmlPath, outputDirectory) {
  const bootstrapPath = path.join(outputDirectory, "wax", bootstrapFilename);
  return browserPath(path.relative(path.dirname(htmlPath), bootstrapPath));
}

export function waxUniversalAdapterPathFor(htmlPath, outputDirectory) {
  const adapterPath = path.join(outputDirectory, "wax", universalAdapterFilename);
  return browserPath(path.relative(path.dirname(htmlPath), adapterPath));
}

export function rewriteWaxAdapterImports(source) {
  if (typeof source !== "string") throw new TypeError("WAX adapter source must be a string");
  return source.replaceAll('from "../../src/', 'from "../src/');
}

export function rewriteWaxHostedLinks(html, htmlPath, outputDirectory) {
  if (typeof html !== "string") throw new TypeError("HTML source must be a string");
  const storybookPath = browserPath(path.relative(
    path.dirname(htmlPath),
    path.resolve(outputDirectory, "..", "storybook"),
  ));
  return html.replace(
    /href=(["'])storybook\/\1/g,
    `href="${storybookPath}/"`,
  );
}

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listHtmlFiles(entryPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) files.push(entryPath);
  }
  return files;
}

export async function addWaxLayer(outputDirectory, options = {}) {
  const sourceDirectory = options.waxSourceDirectory || waxSourceDirectory;
  const destinationDirectory = path.join(outputDirectory, "wax");
  await mkdir(destinationDirectory, { recursive: true });
  await Promise.all([
    copyFile(
      path.join(sourceDirectory, bootstrapFilename),
      path.join(destinationDirectory, bootstrapFilename),
    ),
    copyFile(
      path.join(sourceDirectory, bridgeFilename),
      path.join(destinationDirectory, bridgeFilename),
    ),
    readFile(path.join(sourceDirectory, universalAdapterFilename), "utf8").then((source) => (
      writeFile(
        path.join(destinationDirectory, universalAdapterFilename),
        rewriteWaxAdapterImports(source),
        "utf8",
      )
    )),
    copyFile(
      path.join(sourceDirectory, universalAdapterStylesheetFilename),
      path.join(destinationDirectory, universalAdapterStylesheetFilename),
    ),
  ]);

  const htmlFiles = await listHtmlFiles(outputDirectory);
  await Promise.all(htmlFiles.map(async (htmlPath) => {
    const html = await readFile(htmlPath, "utf8");
    const bootstrapSource = waxBootstrapPathFor(htmlPath, outputDirectory);
    const adapterSource = waxUniversalAdapterPathFor(htmlPath, outputDirectory);
    const transformed = injectWaxUniversalAdapter(
      injectWaxBootstrap(rewriteWaxHostedLinks(html, htmlPath, outputDirectory), bootstrapSource),
      adapterSource,
    );
    if (transformed !== html) await writeFile(htmlPath, transformed, "utf8");
  }));

  return {
    htmlCount: htmlFiles.length,
    outputDirectory,
  };
}

export async function buildWaxSite(outputArgument = "dist-wax") {
  const outputDirectory = path.isAbsolute(outputArgument)
    ? path.resolve(outputArgument)
    : path.resolve(repositoryRoot, outputArgument);

  await execFileAsync("bash", ["scripts/build-site.sh", outputDirectory], {
    cwd: repositoryRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  await Promise.all([
    fingerprintDentaphone(outputDirectory),
    fingerprintHiccupHead(outputDirectory),
  ]);
  return addWaxLayer(outputDirectory);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await buildWaxSite(process.argv[2] || "dist-wax");
  console.log(`Built Morphazoid for WAX: ${result.htmlCount} pages in ${result.outputDirectory}`);
}
