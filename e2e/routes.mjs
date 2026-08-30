import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { FAVE_TOOL_IDS, TOOL_GROUPS } from "../nav.js";
import { INSTRUMENTS } from "../src/instrument-catalog.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const ignoredDirectoryNames = new Set([
  ".git",
  "blob-report",
  "coverage",
  "dist",
  "dist-wax",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const freezeRoute = (route) => Object.freeze({
  ...route,
  testHref: route.testHref
    ?? (route.id === "vector-flight" ? `${route.href}?manual=1` : route.href),
  features: Object.freeze([...(route.features ?? [])]),
});

const normalizeHref = (filePath) => relative(projectRoot, filePath).split(sep).join("/");

async function sourceHtmlFiles(directory = projectRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoredDirectoryNames.has(entry.name)) continue;
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceHtmlFiles(entryPath));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".html") {
      files.push(entryPath);
    }
  }

  return files;
}

function auxiliaryId(href) {
  if (href === "index.html") return "home";
  return href
    .replace(/\/index\.html$/u, "")
    .replace(/\.html$/u, "")
    .replaceAll("/", "--");
}

function labelFromTitleMarkup(markup, href) {
  const title = markup.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/iu)?.[1]
    ?.replace(/\s+/gu, " ")
    .trim();
  return title || auxiliaryId(href);
}

const groupByToolId = new Map(TOOL_GROUPS.flatMap((group) => (
  group.tools.map((tool) => [tool.id, group])
)));
const faveIds = new Set(FAVE_TOOL_IDS);

export const instrumentRoutes = Object.freeze(INSTRUMENTS.map((instrument) => freezeRoute({
  id: instrument.id,
  label: instrument.label,
  href: instrument.href,
  status: instrument.status ?? null,
  features: instrument.features,
  groupId: groupByToolId.get(instrument.id)?.id ?? null,
  isFave: faveIds.has(instrument.id),
  source: "catalogue",
})));

const instrumentById = new Map(instrumentRoutes.map((route) => [route.id, route]));
const instrumentByHref = new Map(instrumentRoutes.map((route) => [route.href, route]));

export const primaryInstrumentRoutes = Object.freeze(instrumentRoutes.filter(
  ({ status }) => status !== "Works in progress",
));

export const faveRoutes = Object.freeze(FAVE_TOOL_IDS.map((id) => {
  const route = instrumentById.get(id);
  if (!route) throw new Error(`Fave instrument is missing from the catalogue: ${id}`);
  return route;
}));

export const toolRoutes = Object.freeze(TOOL_GROUPS.flatMap((group) => (
  group.tools.map((tool) => {
    const instrument = instrumentById.get(tool.id);
    return instrument ?? freezeRoute({
      id: tool.id,
      label: tool.label,
      href: tool.href,
      status: null,
      features: [],
      groupId: group.id,
      isFave: false,
      source: "navigation",
    });
  })
)));

const sourceHrefForRoute = ({ href }) => (href.endsWith("/") ? `${href}index.html` : href);
const toolBySourceHref = new Map(toolRoutes.map((route) => [sourceHrefForRoute(route), route]));
const trackedIds = new Set(toolRoutes.map(({ id }) => id));
const htmlFiles = (await sourceHtmlFiles()).sort((left, right) => (
  normalizeHref(left).localeCompare(normalizeHref(right))
));
const sourceHtmlHrefs = new Set(htmlFiles.map(normalizeHref));
const missingTrackedRoutes = toolRoutes.filter((route) => !sourceHtmlHrefs.has(sourceHrefForRoute(route)));

if (missingTrackedRoutes.length) {
  throw new Error(
    `Navigation routes missing source HTML: ${missingTrackedRoutes.map(({ href }) => href).join(", ")}`,
  );
}

export const allHtmlRoutes = Object.freeze(await Promise.all(htmlFiles.map(async (filePath) => {
  const href = normalizeHref(filePath);
  const trackedRoute = instrumentByHref.get(href) ?? toolBySourceHref.get(href);
  if (trackedRoute?.href === href) return trackedRoute;
  if (trackedRoute) return freezeRoute({
    ...trackedRoute,
    href,
    navigationHref: trackedRoute.href,
    testHref: href,
  });

  const markup = await readFile(filePath, "utf8");
  const candidateId = auxiliaryId(href);
  return freezeRoute({
    id: trackedIds.has(candidateId) ? `${candidateId}--alias` : candidateId,
    label: labelFromTitleMarkup(markup, href),
    href,
    status: null,
    features: [],
    groupId: null,
    isFave: false,
    source: "auxiliary",
  });
})));

export const auxiliaryHtmlRoutes = Object.freeze(allHtmlRoutes.filter(
  ({ source }) => source === "auxiliary",
));
