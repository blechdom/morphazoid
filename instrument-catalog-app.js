import { INSTRUMENT_GROUPS, INSTRUMENTS } from "./src/instrument-catalog.js";

const FILTER_OPTIONS = Object.freeze([
  ["all", "All types"],
  ["synth", "Synths"],
  ["drums", "Drums & percussion"],
  ["mic", "Mic input"],
  ["midi", "MIDI"],
  ["keys", "Computer keys"],
  ["file", "File input"],
  ["sequencer", "Sequencers"],
]);

let mountCount = 0;

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function searchableText(instrument, groupLabel) {
  return [
    instrument.label,
    groupLabel,
    instrument.kind,
    instrument.description,
    instrument.start,
    ...instrument.features,
  ].join(" ").toLocaleLowerCase();
}

function matchesType(instrument, type) {
  const kind = instrument.kind.toLocaleLowerCase();
  if (type === "all") return true;
  if (type === "synth") return kind.includes("synth");
  if (type === "drums") return kind.includes("drum") || kind.includes("percussion");
  if (type === "mic") return instrument.features.includes("Mic input");
  if (type === "midi") return instrument.features.includes("MIDI");
  if (type === "keys") return instrument.features.includes("Computer keys");
  if (type === "file") return instrument.features.includes("File input");
  if (type === "sequencer") return kind.includes("sequencer");
  return true;
}

function createFilterField(doc, labelText, control) {
  const label = element(doc, "label", "catalogue-filter-field");
  label.append(element(doc, "span", "catalogue-filter-label", labelText), control);
  return label;
}

function createFilters(doc, instanceId) {
  const controls = element(doc, "div", "catalogue-controls");
  controls.setAttribute("role", "search");
  controls.setAttribute("aria-label", "Filter instrument catalogue");

  const search = element(doc, "input", "catalogue-search");
  search.type = "search";
  search.id = `${instanceId}-search`;
  search.placeholder = "Name, sound, or idea";
  search.autocomplete = "off";

  const category = element(doc, "select", "catalogue-select");
  category.id = `${instanceId}-category`;
  const allCategories = element(doc, "option", "", "All sections");
  allCategories.value = "all";
  category.append(allCategories);
  for (const group of INSTRUMENT_GROUPS) {
    const option = element(doc, "option", "", group.label);
    option.value = group.id;
    category.append(option);
  }

  const type = element(doc, "select", "catalogue-select");
  type.id = `${instanceId}-type`;
  for (const [value, label] of FILTER_OPTIONS) {
    const option = element(doc, "option", "", label);
    option.value = value;
    type.append(option);
  }

  const status = element(doc, "p", "catalogue-result-count", `${INSTRUMENTS.length} instruments`);
  status.setAttribute("aria-live", "polite");
  controls.append(
    createFilterField(doc, "Find", search),
    createFilterField(doc, "Section", category),
    createFilterField(doc, "Type & input", type),
    status,
  );
  return { controls, search, category, type, status };
}

function createCard(doc, instrument, groupLabel) {
  const card = element(doc, "article", "instrument-card");
  card.dataset.instrumentId = instrument.id;
  card.dataset.groupId = instrument.groupId;
  card.dataset.search = searchableText(instrument, groupLabel);

  const visual = element(doc, "div", "instrument-card-visual");
  const image = element(doc, "img", "instrument-card-image");
  image.src = instrument.imageHref;
  image.alt = "";
  image.width = 512;
  image.height = 512;
  image.loading = "lazy";
  image.decoding = "async";
  visual.append(image);

  const body = element(doc, "div", "instrument-card-body");
  const title = element(doc, "h3", "instrument-card-title");
  const titleLink = element(doc, "a", "", instrument.label);
  titleLink.href = instrument.href;
  title.append(titleLink);

  const traits = element(doc, "ul", "instrument-traits");
  traits.setAttribute("aria-label", `${instrument.label} type and inputs`);
  for (const trait of [instrument.kind, ...instrument.features]) {
    const item = element(doc, "li", "", trait);
    traits.append(item);
  }

  const description = element(doc, "p", "instrument-description", instrument.description);
  const start = element(doc, "div", "instrument-start");
  start.append(
    element(doc, "h4", "", "Start"),
    element(doc, "p", "", instrument.start),
  );
  body.append(title, traits, description, start);

  const actions = element(doc, "div", "instrument-card-actions");
  const browserLink = element(doc, "a", "instrument-action instrument-action-primary", "Play in browser");
  browserLink.href = instrument.href;
  actions.append(browserLink);
  if (instrument.pluginHref) {
    const pluginLink = element(doc, "a", "instrument-action", "Get plug-in");
    pluginLink.href = instrument.pluginHref;
    actions.append(pluginLink);
  } else {
    const unavailable = element(doc, "span", "instrument-action is-disabled", "Plug-in unavailable");
    unavailable.setAttribute("aria-disabled", "true");
    actions.append(unavailable);
  }

  card.append(visual, body, actions);
  return card;
}

function createGroup(doc, group, instanceId) {
  const section = element(doc, "section", "catalogue-group");
  section.dataset.catalogueGroup = group.id;
  const heading = element(doc, "header", "catalogue-group-heading");
  const title = element(doc, "h2", "", group.label);
  title.id = `${instanceId}-${group.id}`;
  const count = element(doc, "span", "catalogue-group-count", String(group.tools.length));
  count.setAttribute("aria-label", `${group.tools.length} instruments`);
  heading.append(title, count);

  const grid = element(doc, "div", "instrument-catalog-grid");
  const cards = group.tools.map((instrument) => {
    const catalogInstrument = { ...instrument, groupId: group.id };
    const card = createCard(doc, catalogInstrument, group.label);
    grid.append(card);
    return { card, instrument: catalogInstrument };
  });
  section.setAttribute("aria-labelledby", title.id);
  section.append(heading, grid);
  return { section, cards };
}

function createSectionIndex(doc, instanceId) {
  const nav = element(doc, "nav", "catalogue-section-index");
  nav.setAttribute("aria-label", "Instrument catalogue sections");
  for (const group of INSTRUMENT_GROUPS) {
    const link = element(doc, "a", "", group.label);
    link.href = `#${instanceId}-${group.id}`;
    nav.append(link);
  }
  return nav;
}

export function renderInstrumentCatalog(root) {
  if (!root?.ownerDocument) return null;
  const doc = root.ownerDocument;
  const instanceId = root.id || `instrument-catalog-${++mountCount}`;
  const { controls, search, category, type, status } = createFilters(doc, instanceId);
  const index = createSectionIndex(doc, instanceId);
  const groupRecords = INSTRUMENT_GROUPS.map((group) => createGroup(doc, group, instanceId));
  const empty = element(doc, "p", "catalogue-empty", "No instruments match those filters.");
  empty.hidden = true;
  root.replaceChildren(controls, index, ...groupRecords.map(({ section }) => section), empty);

  const applyFilters = () => {
    const query = search.value.trim().toLocaleLowerCase();
    let visibleCount = 0;
    for (const { section, cards } of groupRecords) {
      let groupCount = 0;
      for (const { card, instrument } of cards) {
        const visible = (category.value === "all" || category.value === instrument.groupId)
          && matchesType(instrument, type.value)
          && (!query || card.dataset.search.includes(query));
        card.hidden = !visible;
        if (visible) {
          visibleCount += 1;
          groupCount += 1;
        }
      }
      section.hidden = groupCount === 0;
      const count = section.querySelector(".catalogue-group-count");
      if (count) {
        count.textContent = String(groupCount);
        count.setAttribute("aria-label", `${groupCount} instruments`);
      }
    }
    status.textContent = `${visibleCount} ${visibleCount === 1 ? "instrument" : "instruments"}`;
    empty.hidden = visibleCount !== 0;
  };

  search.addEventListener("input", applyFilters);
  category.addEventListener("change", applyFilters);
  type.addEventListener("change", applyFilters);

  return Object.freeze({ root, search, category, type, applyFilters });
}

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll("[data-instrument-catalog]")) {
    renderInstrumentCatalog(root);
  }
}
