const LEGACY_SETTINGS_KEYS = [
  "morphazoid:shape:audio:v1",
  "morphazoid:lattice:audio:v2",
  "morphazoid:lumber:audio:v2",
];
const RESET_SHAPE_SIDES_KEY = "morphazoid:shape:reset:sides";

const freezeGroup = (id, label, tools) => Object.freeze({
  id,
  label,
  tools: Object.freeze(tools.map((tool) => Object.freeze(tool))),
});

/**
 * Shared navigation contract.
 *
 * `href` values are relative to nav.js, which lives at the published site
 * root. Directory tools use prefix matching so their secondary pages remain
 * associated with the same top-level tool.
 */
export const TOOL_GROUPS = Object.freeze([
  freezeGroup("geometry", "Geometry", [
    { id: "shape", label: "Shape", href: "./" },
    { id: "lattice", label: "Lattice", href: "lattice.html" },
    { id: "spiral", label: "Spiral", href: "spiral.html" },
    { id: "solid", label: "Solid", href: "solid.html" },
    { id: "hyper", label: "Hyper", href: "hyper.html" },
  ]),
  freezeGroup("audio-mic", "Audio & Mic", [
    { id: "lumber", label: "Lumber", href: "lumber.html" },
    { id: "micmic", label: "L-mic", href: "l-mic.html" },
    { id: "graph-delay", label: "Graph Delay", href: "graph-delay.html" },
    { id: "throatazoid", label: "Throatazoid", href: "throatazoid.html" },
  ]),
  freezeGroup("fractals-recursion", "Fractals & Recursion", [
    { id: "l-system", label: "L-System", href: "l-system.html" },
    { id: "recursion", label: "Recursion", href: "recursion.html" },
    { id: "julia", label: "Julia", href: "julia.html" },
  ]),
  freezeGroup("barber-shop-poles", "Barber Shop Poles", [
    { id: "shepard-risset", label: "Shepard–Risset", href: "shepard-risset.html" },
    { id: "sandy-syrup-delay", label: "Sandy Syrup Delay", href: "sandy-syrup-delay.html" },
    {
      id: "striped-sludge-delay",
      label: "Striped Sludge Delay",
      href: "striped-sludge-delay.html",
    },
    { id: "candy-coil-delay", label: "Candy Coil Delay", href: "candy-coil-delay.html" },
  ]),
  freezeGroup("chaotic-synths", "Chaotic Synths", [
    { id: "recursive-fm", label: "Recursive FM", href: "recursive-fm.html" },
    { id: "recursive-pm", label: "Recursive PM", href: "recursive-pm.html" },
    { id: "chaotic-fm", label: "Chaotic FM", href: "chaotic-fm.html" },
    { id: "weierstrass", label: "Weierstrass", href: "weierstrass.html" },
  ]),
  freezeGroup("workbench", "Workbench", [
    { id: "fm-drums", label: "FM Drums", href: "fm-drums.html" },
    {
      id: "morphazoidical",
      label: "Morphazoidical",
      href: "morphazoidical/",
      match: "directory",
    },
  ]),
]);

export const NAVIGATION_BASE_URL = new URL("./", import.meta.url).href;

const allTools = () => TOOL_GROUPS.flatMap((group) => group.tools);

/**
 * Normalize a navigation URL to a pathname suitable for route comparison.
 * The site root and its index.html spelling intentionally resolve identically.
 */
export function normalizeNavigationPath(value, siteRoot = NAVIGATION_BASE_URL) {
  try {
    const root = new URL(siteRoot);
    const url = new URL(value, root);
    const rootPath = root.pathname.endsWith("/")
      ? root.pathname
      : root.pathname.replace(/[^/]*$/, "");
    let pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/index\.html$/i, "/");
    if (rootPath.length > 1 && pathname === rootPath.slice(0, -1)) pathname = rootPath;
    return pathname;
  } catch {
    return null;
  }
}

/**
 * Resolve the active tool without assuming the site is hosted at `/`.
 */
export function resolveActiveTool(currentUrl, siteRoot = NAVIGATION_BASE_URL) {
  const currentPath = normalizeNavigationPath(currentUrl, siteRoot);
  if (!currentPath) return null;
  for (const tool of allTools()) {
    const toolPath = normalizeNavigationPath(tool.href, siteRoot);
    if (!toolPath) continue;
    if (tool.match === "directory") {
      const directory = toolPath.endsWith("/") ? toolPath : `${toolPath}/`;
      if (
        currentPath === directory
        || currentPath === directory.slice(0, -1)
        || currentPath.startsWith(directory)
      ) return tool;
    } else if (currentPath === toolPath) {
      return tool;
    }
  }
  return null;
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function staticCurrentHref(doc) {
  const currentLink = doc.querySelector?.('.tabs [aria-current="page"]');
  if (currentLink?.getAttribute) return currentLink.getAttribute("href");
  const selectedOption = doc.querySelector?.(".mobile-instrument-select option:checked");
  return selectedOption?.value ?? selectedOption?.getAttribute?.("value") ?? null;
}

function createToolsDisclosure(doc, activeTool, siteRoot, index) {
  const details = element(doc, "details", "tools-menu");
  const summary = element(doc, "summary", "tools-menu-trigger");
  const activeGroup = TOOL_GROUPS.find(
    (group) => group.tools.some((tool) => tool.id === activeTool?.id),
  );
  const menuLabel = activeGroup?.label ?? "Tools";
  summary.setAttribute(
    "aria-label",
    activeTool
      ? `${menuLabel}. Current tool: ${activeTool.label}`
      : "Tools. Choose a tool",
  );
  summary.append(
    element(doc, "span", "tools-menu-label", menuLabel),
    element(doc, "strong", "tools-menu-current", activeTool?.label ?? "Choose"),
  );
  const chevron = element(doc, "span", "tools-menu-chevron");
  chevron.setAttribute("aria-hidden", "true");
  summary.append(chevron);

  const panel = element(doc, "div", "tools-menu-panel");
  for (const group of TOOL_GROUPS) {
    const headingId = `tools-group-${index}-${group.id}`;
    const section = element(doc, "section", "tools-menu-group");
    section.setAttribute("aria-labelledby", headingId);
    const heading = element(doc, "h2", "tools-menu-heading", group.label);
    heading.id = headingId;
    section.append(heading);
    for (const tool of group.tools) {
      const link = element(doc, "a", "tools-menu-link", tool.label);
      link.setAttribute("href", new URL(tool.href, siteRoot).href);
      link.setAttribute("data-tool-id", tool.id);
      if (tool.id === activeTool?.id) {
        link.classList.add("is-current");
        link.setAttribute("aria-current", "page");
      }
      link.addEventListener?.("click", () => {
        details.open = false;
      });
      section.append(link);
    }
    panel.append(section);
  }
  details.append(summary, panel);

  details.addEventListener?.("keydown", (event) => {
    if (event.key !== "Escape" || !details.open) return;
    event.preventDefault?.();
    details.open = false;
    summary.focus?.();
  });
  doc.addEventListener?.("pointerdown", (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  });

  return details;
}

function populateMobileSelect(doc, select, activeTool, siteRoot) {
  const groups = TOOL_GROUPS.map((group) => {
    const optgroup = element(doc, "optgroup");
    optgroup.label = group.label;
    for (const tool of group.tools) {
      const option = element(doc, "option", "", tool.label);
      option.value = new URL(tool.href, siteRoot).href;
      if (tool.id === activeTool?.id) option.selected = true;
      optgroup.append(option);
    }
    return optgroup;
  });
  select.replaceChildren(...groups);
  select.setAttribute("aria-label", "Tool");
  if (activeTool) select.value = new URL(activeTool.href, siteRoot).href;
}

/**
 * Enhance the static desktop links and mobile options in place. Static markup
 * remains a complete no-JavaScript fallback in every page.
 */
export function enhanceSharedNavigation(doc, {
  currentHref = doc?.baseURI ?? NAVIGATION_BASE_URL,
  siteRoot = NAVIGATION_BASE_URL,
} = {}) {
  if (!doc?.querySelectorAll || !doc?.createElement) {
    return Object.freeze({ activeTool: null, disclosures: Object.freeze([]) });
  }

  const fallbackHref = staticCurrentHref(doc);
  const activeTool = resolveActiveTool(currentHref, siteRoot)
    ?? (fallbackHref ? resolveActiveTool(fallbackHref, siteRoot) : null);
  const disclosures = [];

  [...doc.querySelectorAll(".tabs")].forEach((nav, index) => {
    const disclosure = createToolsDisclosure(doc, activeTool, siteRoot, index);
    nav.replaceChildren(disclosure);
    nav.classList.add("tools-nav");
    nav.setAttribute("aria-label", "Morphazoid tools");
    disclosures.push(disclosure);
  });

  for (const select of doc.querySelectorAll(".mobile-instrument-select")) {
    populateMobileSelect(doc, select, activeTool, siteRoot);
  }

  return Object.freeze({
    activeTool,
    disclosures: Object.freeze(disclosures),
  });
}

function runtimeStorage(runtime, key) {
  try {
    return runtime?.[key] ?? null;
  } catch {
    return null;
  }
}

function clearLegacySettings(localStorage) {
  try {
    for (const key of LEGACY_SETTINGS_KEYS) localStorage?.removeItem(key);
  } catch {
    // Pages still reset normally when storage is unavailable.
  }
}

function preserveShapeSides(doc, storage) {
  try {
    const sides = doc.getElementById?.("sides");
    if (!sides) return;
    storage?.setItem(RESET_SHAPE_SIDES_KEY, sides.value);
  } catch {
    // Reset still works when one-shot session storage is unavailable.
  }
}

export function initializeSharedNavigation(doc = globalThis.document, runtime = globalThis) {
  clearLegacySettings(runtimeStorage(runtime, "localStorage"));

  enhanceSharedNavigation(doc, {
    currentHref: runtime.location?.href || doc?.baseURI || NAVIGATION_BASE_URL,
    siteRoot: NAVIGATION_BASE_URL,
  });

  for (const select of doc?.querySelectorAll?.(".mobile-instrument-select") ?? []) {
    select.addEventListener("change", () => {
      if (select.value) runtime.location.href = select.value;
    });
  }

  for (const button of doc?.querySelectorAll?.("[data-reset-all]") ?? []) {
    button.addEventListener("click", () => {
      preserveShapeSides(doc, runtimeStorage(runtime, "sessionStorage"));
      clearLegacySettings(runtimeStorage(runtime, "localStorage"));
      runtime.location.reload();
    });
  }
}

if (typeof document !== "undefined") initializeSharedNavigation(document, globalThis);
