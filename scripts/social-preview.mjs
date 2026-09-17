import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITE_ORIGIN = "https://morphazoid.com";
export const SOCIAL_IMAGE_PATH = "assets/social/morphazoid-card-20260917.png";
export const BRAND_MARK_PATH = "assets/social/morphazoid-mark-20260917.png";
export const SOCIAL_IMAGE_URL = `${SITE_ORIGIN}/${SOCIAL_IMAGE_PATH}`;
export const SOCIAL_IMAGE_ALT = "Morphazoid geometric wireframe logo on a dark background.";
const defaultDescription = "Morphazoid browser audio experiments and instrument catalogue.";
const startMarker = "<!-- morphazoid-social-preview:start -->";
const endMarker = "<!-- morphazoid-social-preview:end -->";
const managedBlock = new RegExp(`(?:\\r?\\n)?[\\t ]*${startMarker}[\\s\\S]*?${endMarker}`, "g");
const htmlTag = /<(?:meta|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function decodeEntities(value) {
  const names = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, name) => {
    if (!name.startsWith("#")) return names[name.toLowerCase()];
    const code = name[1].toLowerCase() === "x"
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : "\ufffd";
  });
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function canonicalUrl(relativePath) {
  const route = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (["", "index.html", "about.html", "instruments.html"].includes(route)) return `${SITE_ORIGIN}/`;
  return new URL(route.replace(/(^|\/)index\.html$/, "$1"), `${SITE_ORIGIN}/`).href;
}

/**
 * Static head metadata for crawlers; no browser JavaScript is needed.
 * The sharing identity is always the site logo, never the author's portrait.
 * Preserve all body bytes, canonical links, descriptions, and runtime scripts.
 */
export function withSocialPreview(html, relativePath = "index.html") {
  if (typeof html !== "string") throw new TypeError("HTML must be a string");
  const head = /(<head\b[^>]*>)([\s\S]*?)(<\/head\s*>)/i.exec(html);
  if (!head) throw new Error(`Missing HTML head: ${relativePath}`);
  let contents = head[2].replace(managedBlock, "");
  const title = decodeEntities((/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(contents)?.[1]
    ?? "Morphazoid").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  let description = defaultDescription;
  for (const tag of contents.match(htmlTag) ?? []) {
    const attrs = attributes(tag);
    if (attrs.name?.toLowerCase() === "description" && attrs.content?.trim()) {
      description = attrs.content.replace(/\s+/g, " ").trim();
      break;
    }
  }
  // Eliminate ambiguous earlier image declarations. Open Graph readers may
  // prefer the first declaration; keeping a portrait declaration is unsafe.
  contents = contents.replace(htmlTag, (tag) => {
    const attrs = attributes(tag);
    const field = (attrs.property ?? attrs.name ?? "").toLowerCase();
    return field.startsWith("og:") || field.startsWith("twitter:")
      || attrs.rel?.toLowerCase().split(/\s+/).includes("image_src") ? "" : tag;
  });
  const properties = [
    ["og:type", "website"],
    ["og:site_name", "Morphazoid"],
    ["og:title", title],
    ["og:description", description],
    ["og:url", canonicalUrl(relativePath)],
    ["og:image", SOCIAL_IMAGE_URL],
    ["og:image:secure_url", SOCIAL_IMAGE_URL],
    ["og:image:type", "image/png"],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["og:image:alt", SOCIAL_IMAGE_ALT],
  ];
  const names = [
    ["twitter:card", "summary_large_image"],
    ["twitter:title", title],
    ["twitter:description", description],
    ["twitter:image", SOCIAL_IMAGE_URL],
    ["twitter:image:alt", SOCIAL_IMAGE_ALT],
  ];
  const block = [
    startMarker,
    ...properties.map(([property, value]) => `<meta property="${property}" content="${escapeAttribute(value)}" />`),
    ...names.map(([name, value]) => `<meta name="${name}" content="${escapeAttribute(value)}" />`),
    `<link rel="image_src" href="${SOCIAL_IMAGE_URL}" />`,
    endMarker,
  ].map((line) => `    ${line}`).join("\n");

  // Keep charset first, then declare the preview before redirects/scripts.
  const charset = /<meta\b[^>]*\bcharset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/i;
  contents = charset.test(contents)
    ? contents.replace(charset, (tag) => `${tag}\n${block}`)
    : `\n${block}${contents}`;
  return html.slice(0, head.index) + head[1] + contents + head[3]
    + html.slice(head.index + head[0].length);
}

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(target);
  }
  return files.sort();
}

/** Called by the shared build path for the public site and WAX artifact. */
export async function addSocialPreviews(outputDirectory) {
  const destination = path.resolve(outputDirectory);
  if (destination === repositoryRoot) {
    throw new Error("Use a build output directory, not the source worktree");
  }
  for (const asset of [SOCIAL_IMAGE_PATH, BRAND_MARK_PATH]) {
    await mkdir(path.dirname(path.join(destination, asset)), { recursive: true });
    await copyFile(path.join(repositoryRoot, asset), path.join(destination, asset));
  }
  const files = await htmlFiles(destination);
  for (const file of files) {
    const before = await readFile(file, "utf8");
    const after = withSocialPreview(before, path.relative(destination, file));
    if (after !== before) await writeFile(file, after);
  }
  return { htmlCount: files.length };
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/social-preview.mjs <build-directory>");
  const result = await addSocialPreviews(process.argv[2]);
  console.log(`Added portrait-free social previews to ${result.htmlCount} pages.`);
}
