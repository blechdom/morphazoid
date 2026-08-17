import {
  PLUGIN_CATALOG,
  latestPluginRelease,
} from "./src/plugin-catalog.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(className, text, href) {
  const anchor = element("a", className, text);
  anchor.href = href;
  return anchor;
}

function renderVersionDownload(plugin) {
  const artifacts = plugin.releases.flatMap((release) => (
    release.artifacts.map((artifact) => ({
      ...artifact,
      recommended: release.recommended,
    }))
  ));
  if (artifacts.length === 0) return null;

  const controls = element("div", "plugin-version-controls");
  const picker = element("label", "plugin-version-picker");
  const select = element("select");
  select.setAttribute("aria-label", `${plugin.name} download version`);

  for (const artifact of artifacts) {
    const option = element(
      "option",
      "",
      `v${artifact.version}${artifact.recommended ? " (current)" : ""}`,
    );
    option.value = artifact.href;
    option.dataset.downloadName = artifact.downloadName;
    select.append(option);
  }

  picker.append(element("span", "", "Version"), select);
  const download = link("plugin-download", "Download for REAPER", artifacts[0].href);
  download.download = artifacts[0].downloadName;
  download.setAttribute("data-plugin-download", artifacts[0].id);
  select.addEventListener("change", () => {
    const option = select.selectedOptions[0];
    download.href = option.value;
    download.download = option.dataset.downloadName;
  });

  controls.append(picker, download);
  return controls;
}

function renderPluginCard(plugin) {
  const card = element(
    "article",
    `plugin-card plugin-card-${plugin.status}`,
  );
  card.id = plugin.id;
  card.dataset.pluginStatus = plugin.status;
  card.dataset.search = [
    plugin.name,
    plugin.family,
    plugin.summary,
    plugin.stage,
    plugin.voiceMode,
    ...plugin.plannedFormats,
    ...plugin.capabilities,
  ].join(" ").toLowerCase();

  const header = element("header", "plugin-card-header");
  const status = element(
    "p",
    `plugin-status plugin-status-${plugin.status}`,
    plugin.status === "available" ? "Beta available" : "Under development",
  );
  header.append(
    status,
    element("p", "plugin-family", plugin.family),
    element("h2", "", plugin.name),
  );

  const summary = element("p", "plugin-summary", plugin.summary);
  const cardActions = element("div", "plugin-card-actions");
  card.append(header, summary);

  const latest = latestPluginRelease(plugin);
  if (latest) {
    const artifact = latest.artifacts[0];
    if (artifact) {
      card.append(element(
        "p",
        "plugin-format-note",
        `${artifact.format} for ${artifact.platforms.join(", ")}.`,
      ));
      const versionDownload = renderVersionDownload(plugin);
      if (versionDownload) cardActions.append(versionDownload);
    }
    cardActions.append(link("plugin-demo-link", "Try it in the browser", plugin.demoHref));
    card.append(cardActions);
  } else {
    card.append(element(
      "p",
      "plugin-format-note",
      `Planned formats: ${plugin.plannedFormats.join(", ")}.`,
    ));
    cardActions.append(link("plugin-demo-link", "Try it in the browser", plugin.demoHref));
    card.append(cardActions);
  }

  return card;
}

const catalog = document.getElementById("pluginCatalog");
const cards = PLUGIN_CATALOG.map(renderPluginCard);
catalog?.replaceChildren(...cards);

if (location.hash) {
  const hashId = decodeURIComponent(location.hash.slice(1));
  requestAnimationFrame(() => document.getElementById(hashId)?.scrollIntoView());
}
