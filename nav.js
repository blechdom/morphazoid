import {
  COMPUTER_KEYBOARD_DEFAULTS,
  MIDI_PROFILES,
  MIDI_PROFILE_REGISTRY,
  getSharedMidiManager,
} from "./src/midi-manager.js";

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
  freezeGroup("geometry", "Geometry Synths", [
    { id: "shape", label: "Shape", href: "./" },
    { id: "lattice", label: "Lattice", href: "lattice.html" },
    { id: "spiral", label: "Spiral", href: "spiral.html" },
    { id: "solid", label: "Solid", href: "solid.html" },
    { id: "hyper", label: "Hyper", href: "hyper.html" },
  ]),
  freezeGroup("geometric-physics", "Geometric Physics", [
    { id: "gravity-walk", label: "Gravity Walk", href: "gravity-walk.html" },
    { id: "ricochet", label: "Ricochet", href: "ricochet.html" },
    { id: "rigidity", label: "Rigidity", href: "rigidity.html" },
    { id: "rolling-measure", label: "Rolling Measure", href: "rolling-measure.html" },
    { id: "falling-forms", label: "Falling Forms", href: "falling-forms.html" },
    { id: "charge-garden", label: "Charge Garden", href: "charge-garden.html" },
    { id: "packing-pressure", label: "Packing Pressure", href: "packing-pressure.html" },
    { id: "geodesic-drift", label: "Geodesic Drift", href: "geodesic-drift.html" },
    { id: "kinetic-hull", label: "Kinetic Hull", href: "kinetic-hull.html" },
  ]),
  freezeGroup("geometry-drums", "Geometry Drum Machines", [
    {
      id: "shape-drums",
      label: "Shape Drum Machine",
      href: "shape-drums.html",
    },
    {
      id: "lattice-drums",
      label: "Lattice Drum Machine",
      href: "lattice-drums.html",
    },
    {
      id: "spiral-drums",
      label: "Spiral Drum Machine",
      href: "spiral-drums.html",
    },
    {
      id: "solid-drums",
      label: "Solid Drum Machine",
      href: "solid-drums.html",
    },
    {
      id: "hyper-drums",
      label: "Hyper Drum Machine",
      href: "hyper-drums.html",
    },
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
  freezeGroup("algorithmic-sequencers", "Algorithmic Sequencers", [
    { id: "sorting-algorithms", label: "Sorting", href: "algorithmic-sequencers.html" },
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
    { id: "chaotic-pm", label: "Chaotic PM", href: "chaotic-pm.html" },
    { id: "weierstrass", label: "Weierstrass", href: "weierstrass.html" },
  ]),
  freezeGroup("quantum-synths", "Quantum Synths", [
    { id: "order-tones", label: "Order Tones", href: "order-tones.html" },
    { id: "bell-square", label: "Bell Square", href: "bell-square.html" },
    { id: "annealogue", label: "Annealogue", href: "annealogue.html" },
  ]),
  freezeGroup("experiments", "Experiments", [
    { id: "moire-organ", label: "Moire Organ", href: "moire-organ.html" },
    { id: "chladni-plate", label: "Chladni Plate", href: "chladni-plate.html" },
    { id: "spring-choir", label: "Spring Choir", href: "spring-choir.html" },
    {
      id: "gear-ratio-drums",
      label: "Gear Ratio Drums",
      href: "gear-ratio-drums.html",
    },
    {
      id: "cellular-automata",
      label: "Cellular Automata",
      href: "cellular-automata.html",
    },
    { id: "prime-sieve", label: "Prime Sieve", href: "prime-sieve.html" },
    {
      id: "lissajous-orbits",
      label: "Lissajous Orbits",
      href: "lissajous-orbits.html",
    },
    { id: "pendulum-wave", label: "Pendulum Wave", href: "pendulum-wave.html" },
    {
      id: "double-pendulum",
      label: "Double Pendulum",
      href: "double-pendulum.html",
    },
    {
      id: "reaction-diffusion",
      label: "Reaction-Diffusion",
      href: "reaction-diffusion.html",
    },
    {
      id: "atomic-orbitals",
      label: "Atomic Orbitals",
      href: "atomic-orbitals.html",
    },
    { id: "dna-translator", label: "DNA Translator", href: "dna-translator.html" },
    { id: "neural-pulse", label: "Neural Pulse", href: "neural-pulse.html" },
    {
      id: "fourier-epicycles",
      label: "Fourier Epicycles",
      href: "fourier-epicycles.html",
    },
    { id: "gravity-lens", label: "Gravity Lens", href: "gravity-lens.html" },
  ]),
  freezeGroup("tools", "Tools", [
    { id: "fm-drums", label: "FM Drums", href: "fm-drums.html" },
    { id: "sample-drums", label: "Sample Drums", href: "sample-drums.html" },
    {
      id: "morphazoidical",
      label: "Morphazoidical",
      href: "morphazoidical/",
      match: "directory",
    },
  ]),
]);

export const SITE_LINKS = Object.freeze([
  Object.freeze({ id: "plugins", label: "Plug-ins", href: "plugins.html" }),
  Object.freeze({ id: "about", label: "About", href: "about.html" }),
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

export function resolveActiveSiteLink(currentUrl, siteRoot = NAVIGATION_BASE_URL) {
  const currentPath = normalizeNavigationPath(currentUrl, siteRoot);
  if (!currentPath) return null;
  return SITE_LINKS.find(
    (link) => normalizeNavigationPath(link.href, siteRoot) === currentPath,
  ) ?? null;
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

function createSiteLink(doc, link, activeSiteLink, siteRoot) {
  const anchor = element(doc, "a", "site-nav-link", link.label);
  anchor.setAttribute("href", new URL(link.href, siteRoot).href);
  if (link.id === activeSiteLink?.id) {
    anchor.classList.add("is-current");
    anchor.setAttribute("aria-current", "page");
  }
  return anchor;
}

function insertBeforeOrAppend(parent, node, reference) {
  if (reference && typeof parent.insertBefore === "function") parent.insertBefore(node, reference);
  else parent.append?.(node);
}

function midiInputSummary(status) {
  if (!status.supported) return "Web MIDI is unavailable in this browser.";
  if (!status.enabled) return "Off · computer keys and hardware MIDI are inactive.";
  const sources = [];
  if (status.computerKeyboard?.active) sources.push("computer keys ready");
  if (status.enabling) sources.push("waiting for hardware MIDI permission…");
  if (status.hardwareError) sources.push(`hardware MIDI: ${status.hardwareError}`);
  const names = status.inputs.map((input) => {
    const name = input.name || input.manufacturer || "MIDI input";
    return input.profileLabel ? `${name} — ${input.profileLabel}` : name;
  });
  sources.push(...names);
  if (
    status.webMidiSupported
    && !status.enabling
    && !status.hardwareError
    && names.length === 0
  ) sources.push("no hardware inputs connected");
  return `On · ${sources.join(" · ") || "ready"}`;
}

function computerKeyboardPresentation(status) {
  const clients = status.computerKeyboard?.clients ?? [];
  const layouts = new Set(clients.map(({ layout }) => layout));
  if (layouts.size === 0) return null;
  if (layouts.size === 1 && layouts.has("pad-grid")) {
    return { compact: "Pads", spoken: "pads", kind: "pad-grid" };
  }
  if (layouts.size === 1 && layouts.has("piano")) {
    return { compact: "Piano", spoken: "piano", kind: "piano" };
  }
  return { compact: "Mixed", spoken: "piano and pads", kind: "mixed" };
}

function effectiveComputerKeyboardVelocity(status, clients) {
  const sharedVelocity = Number(status.computerKeyboard?.velocity)
    || COMPUTER_KEYBOARD_DEFAULTS.velocity;
  const values = clients.map((client) => Math.max(1, Math.min(
    127,
    Math.round(
      Number(client.velocity ?? COMPUTER_KEYBOARD_DEFAULTS.velocity)
      + sharedVelocity
      - COMPUTER_KEYBOARD_DEFAULTS.velocity,
    ),
  )));
  if (values.length === 0) return sharedVelocity;
  const unique = [...new Set(values)].sort((left, right) => left - right);
  return unique.length === 1 ? unique[0] : `${unique[0]}–${unique.at(-1)}`;
}

function computerKeyboardHint(status) {
  const clients = status.computerKeyboard?.clients ?? [];
  const presentation = computerKeyboardPresentation(status);
  if (!presentation) return "Computer keyboard input is disabled for this instrument.";
  const octave = status.computerKeyboard?.octave ?? 0;
  const velocity = effectiveComputerKeyboardVelocity(status, clients);
  const tuning = `Octave ${octave >= 0 ? "+" : ""}${octave} · velocity ${velocity}`;
  if (presentation.kind === "pad-grid") {
    return `Computer pads · 1 2 3 4 / Q W E R / A S D F / Z X C V. [ ] octave · - / = velocity. ${tuning}.`;
  }
  if (presentation.kind === "mixed") {
    return `Computer piano + pads · piano uses Z–M and Q–U; pads use 1–4 / Q–R / A–F / Z–V. [ ] octave · - / = velocity. ${tuning}.`;
  }
  return `Computer piano · Z S X D C V G B H N J M / Q 2 W 3 E R 5 T 6 Y 7 U. Q is C4. [ ] octave · - / = velocity. ${tuning}.`;
}

function midiProfileHint(status, selectedProfile) {
  if (selectedProfile.id !== "auto" || status.inputs.length === 0) {
    return selectedProfile.setupHint || selectedProfile.description;
  }
  const resolved = [...new Set(status.inputs.map(({ profileId }) => profileId))]
    .map((profileId) => MIDI_PROFILE_REGISTRY[profileId])
    .filter(Boolean);
  if (resolved.length === 0) return selectedProfile.setupHint || selectedProfile.description;
  return resolved.map((profile) => (
    `${profile.shortLabel}: ${profile.setupHint || profile.description}`
  )).join(" ");
}

/** Build the one site-level MIDI control used by every mapped instrument. */
export function createMidiToolbar(
  doc,
  runtime,
  manager = getSharedMidiManager(runtime),
  { idSuffix = "" } = {},
) {
  const suffix = idSuffix ? `-${String(idSuffix).replace(/[^a-z\d_-]/gi, "-")}` : "";
  const toolbar = element(doc, "div", "midi-toolbar");
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "MIDI and computer keyboard controls");
  toolbar.hidden = true;

  const toggle = element(doc, "button", "midi-toggle");
  toggle.type = "button";
  toggle.id = `sharedMidiToggle${suffix}`;
  toggle.setAttribute("aria-pressed", "false");
  const dot = element(doc, "span", "midi-status-dot");
  dot.setAttribute("aria-hidden", "true");
  const toggleTitle = element(doc, "b", "", "MIDI");
  const toggleState = element(doc, "small", "", "off");
  toggle.append(dot, toggleTitle, toggleState);

  const details = element(doc, "details", "midi-profile-menu");
  const summary = element(doc, "summary", "midi-profile-trigger");
  summary.setAttribute("aria-label", "MIDI mapping: Auto");
  summary.setAttribute("aria-controls", `midiProfilePanel${suffix}`);
  const summaryTitle = element(doc, "b", "", "Map");
  const summaryProfile = element(doc, "small", "", "Auto");
  summary.append(summaryTitle, summaryProfile);

  const panel = element(doc, "div", "midi-profile-panel");
  panel.id = `midiProfilePanel${suffix}`;
  const heading = element(doc, "div", "midi-profile-heading");
  heading.append(
    element(doc, "b", "", "Controller mapping"),
    element(doc, "span", "", "Keys + hardware · no SysEx"),
  );
  const keyboardHint = element(doc, "p", "midi-keyboard-hint");
  const field = element(doc, "label", "midi-profile-field");
  field.append(element(doc, "span", "", "Controller profile"));
  const select = element(doc, "select", "");
  select.id = `midiProfileSelect${suffix}`;
  select.setAttribute("aria-label", "MIDI controller profile");
  for (const profile of MIDI_PROFILES) {
    const option = element(doc, "option", "", profile.label);
    option.value = profile.id;
    select.append(option);
  }
  field.append(select);
  const statusLine = element(doc, "p", "midi-profile-status", "MIDI off");
  statusLine.id = `sharedMidiStatus${suffix}`;
  statusLine.setAttribute("aria-live", "polite");
  const hint = element(doc, "p", "midi-profile-hint");
  const error = element(doc, "p", "midi-profile-error");
  error.id = `sharedMidiError${suffix}`;
  error.setAttribute("role", "alert");
  error.hidden = true;
  panel.append(heading, keyboardHint, field, statusLine, hint, error);
  details.append(summary, panel);
  toolbar.append(toggle, details);

  const paint = (status) => {
    const clientCount = Number(status.clientCount) || 0;
    const visible = clientCount > 0;
    toolbar.hidden = !visible;
    if (visible) toolbar.parentNode?.classList?.add("has-midi-toolbar");
    else {
      toolbar.parentNode?.classList?.remove("has-midi-toolbar");
      details.open = false;
      toolbar.classList.remove("is-error");
      error.textContent = "";
      error.hidden = true;
    }
    toggle.disabled = !status.supported || clientCount === 0;
    toggle.setAttribute("aria-pressed", String(Boolean(status.enabled)));
    toggleState.textContent = status.enabled
      ? status.computerKeyboard?.active
        ? status.inputCount ? `keys+${status.inputCount}` : "keys"
        : `${status.inputCount} in`
      : status.enabling ? "wait" : status.supported ? "off" : "n/a";
    select.value = status.selectedProfileId;
    const profile = MIDI_PROFILE_REGISTRY[status.selectedProfileId] ?? MIDI_PROFILE_REGISTRY.auto;
    const keyboardPresentation = computerKeyboardPresentation(status);
    summaryProfile.textContent = keyboardPresentation?.compact ?? profile.shortLabel;
    const keyboardDescription = keyboardPresentation
      ? `; computer keys: ${keyboardPresentation.spoken}`
      : "";
    summary.setAttribute("aria-label", `MIDI mapping: ${profile.label}${keyboardDescription}`);
    summary.title = keyboardPresentation
      ? `${profile.label} · Computer ${keyboardPresentation.spoken}`
      : profile.label;
    keyboardHint.textContent = computerKeyboardHint(status);
    statusLine.textContent = midiInputSummary(status);
    hint.textContent = midiProfileHint(status, profile);
    if (status.enabled) {
      toolbar.classList.remove("is-error");
      error.textContent = "";
      error.hidden = true;
    }
  };

  const unsubscribe = manager.subscribeStatus(paint);
  const clearError = () => {
    toolbar.classList.remove("is-error");
    error.textContent = "";
    error.hidden = true;
  };
  const showError = (reason) => {
    error.textContent = reason instanceof Error ? reason.message : String(reason);
    error.hidden = false;
    toolbar.classList.add("is-error");
    details.open = true;
  };
  const handleToggle = async () => {
    clearError();
    try {
      if (manager.enabled) manager.disable();
      else await manager.enable();
      clearError();
    } catch (reason) {
      showError(reason);
    }
  };
  const handleProfileChange = () => {
    clearError();
    try {
      manager.setProfile(select.value);
    } catch (reason) {
      select.value = manager.selectedProfileId;
      showError(reason);
    }
  };
  const handleDetailsKeydown = (event) => {
    if (event.key !== "Escape" || !details.open) return;
    event.preventDefault?.();
    details.open = false;
    summary.focus?.();
  };
  const handleDocumentPointerdown = (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  };
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    toggle.removeEventListener?.("click", handleToggle);
    select.removeEventListener?.("change", handleProfileChange);
    details.removeEventListener?.("keydown", handleDetailsKeydown);
    doc.removeEventListener?.("pointerdown", handleDocumentPointerdown);
    runtime.removeEventListener?.("pagehide", handlePageHide);
  };
  const handlePageHide = (event) => {
    manager.disable();
    if (!event?.persisted) destroy();
  };
  toggle.addEventListener("click", handleToggle);
  select.addEventListener("change", handleProfileChange);
  details.addEventListener("keydown", handleDetailsKeydown);
  doc.addEventListener?.("pointerdown", handleDocumentPointerdown);
  runtime.addEventListener?.("pagehide", handlePageHide);

  return Object.freeze({ toolbar, toggle, details, select, unsubscribe: destroy, destroy });
}

export function initializeMidiToolbars(doc, runtime, manager = getSharedMidiManager(runtime)) {
  const controls = [];
  const mastheads = [...(doc?.querySelectorAll?.(".masthead") ?? [])];
  for (const [index, masthead] of mastheads.entries()) {
    if (masthead.querySelector?.(".midi-toolbar")) continue;
    const control = createMidiToolbar(doc, runtime, manager, {
      idSuffix: index === 0 ? "" : String(index + 1),
    });
    insertBeforeOrAppend(masthead, control.toolbar, masthead.querySelector?.(".audio-strip"));
    if (manager.status().clientCount > 0) masthead.classList?.add("has-midi-toolbar");
    controls.push(control);
  }
  return Object.freeze(controls);
}

function populateMobileSelect(doc, select, activeTool, activeSiteLink, siteRoot) {
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
  const information = element(doc, "optgroup");
  information.label = "Information";
  for (const link of SITE_LINKS) {
    const option = element(doc, "option", "", link.label);
    option.value = new URL(link.href, siteRoot).href;
    if (link.id === activeSiteLink?.id) option.selected = true;
    information.append(option);
  }
  groups.push(information);
  select.replaceChildren(...groups);
  select.setAttribute("aria-label", "Morphazoid page");
  if (activeTool) select.value = new URL(activeTool.href, siteRoot).href;
  if (activeSiteLink) select.value = new URL(activeSiteLink.href, siteRoot).href;
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
  const activeSiteLink = resolveActiveSiteLink(currentHref, siteRoot);
  const disclosures = [];

  [...doc.querySelectorAll(".tabs")].forEach((nav, index) => {
    const disclosure = createToolsDisclosure(doc, activeTool, siteRoot, index);
    const siteLinks = SITE_LINKS.map(
      (link) => createSiteLink(doc, link, activeSiteLink, siteRoot),
    );
    nav.replaceChildren(disclosure, ...siteLinks);
    nav.classList.add("tools-nav");
    nav.setAttribute("aria-label", "Morphazoid main menu");
    disclosures.push(disclosure);
  });

  for (const select of doc.querySelectorAll(".mobile-instrument-select")) {
    populateMobileSelect(doc, select, activeTool, activeSiteLink, siteRoot);
  }

  return Object.freeze({
    activeTool,
    activeSiteLink,
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

  initializeMidiToolbars(doc, runtime);

  for (const select of doc?.querySelectorAll?.(".mobile-instrument-select") ?? []) {
    select.addEventListener("change", () => {
      if (select.value) runtime.location.href = select.value;
    });
  }

  for (const button of doc?.querySelectorAll?.("[data-reset-all]") ?? []) {
    if (button.hasAttribute?.("data-reset-in-place")) continue;
    button.addEventListener("click", () => {
      preserveShapeSides(doc, runtimeStorage(runtime, "sessionStorage"));
      clearLegacySettings(runtimeStorage(runtime, "localStorage"));
      runtime.location.reload();
    });
  }
}

if (typeof document !== "undefined") initializeSharedNavigation(document, globalThis);
