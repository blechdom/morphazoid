import { FAVE_TOOL_IDS } from "./nav.js?v=catalog-20260902-5";
import { INSTRUMENTS } from "./src/instrument-catalog.js?v=catalog-20260902-5";

const ALL_TAG_ID = "all";

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createCard(doc, instrument, index) {
  const card = element(doc, "article", "instrument-card");
  card.dataset.instrumentId = instrument.id;
  card.dataset.tagIds = instrument.tags.map(({ id }) => id).join(" ");
  const cardLink = element(doc, "a", "instrument-card-link");
  cardLink.href = instrument.href;

  const visual = element(doc, "div", "instrument-card-visual");
  const image = element(doc, "img", "instrument-card-image");
  image.alt = "";
  image.width = 512;
  image.height = 512;
  image.loading = index < 12 ? "eager" : "lazy";
  if (index < 6) image.fetchPriority = "high";
  image.decoding = index < 12 ? "sync" : "async";
  image.src = instrument.imageHref;
  visual.append(image);

  const preview = element(doc, "div", "instrument-card-image-preview");
  preview.setAttribute("aria-hidden", "true");
  const previewImage = element(doc, "img", "instrument-card-preview-image");
  previewImage.alt = "";
  previewImage.width = 512;
  previewImage.height = 512;
  previewImage.loading = "lazy";
  previewImage.decoding = "async";
  previewImage.src = instrument.imageHref;
  preview.append(previewImage);

  const heading = element(doc, "header", "instrument-card-heading");
  const headingCopy = element(doc, "div", "instrument-card-heading-copy");
  const title = element(doc, "h3", "instrument-card-title", instrument.label);
  title.id = `catalogue-${instrument.id}-title`;
  cardLink.setAttribute("aria-labelledby", title.id);

  const tags = element(doc, "ul", "instrument-tags");
  tags.setAttribute("aria-label", `${instrument.label} tags`);
  for (const tag of instrument.tags) tags.append(element(doc, "li", "", tag.label));

  const status = instrument.status
    ? element(doc, "span", "instrument-card-status", instrument.status)
    : null;

  const traits = element(doc, "ul", "instrument-traits");
  traits.setAttribute("aria-label", `${instrument.label} type and inputs`);
  for (const trait of [instrument.kind, ...instrument.features]) {
    const item = element(doc, "li", "", trait);
    traits.append(item);
  }
  headingCopy.append(title);
  if (status) headingCopy.append(status);
  headingCopy.append(tags, traits);
  heading.append(visual, headingCopy);

  const body = element(doc, "div", "instrument-card-body");
  const description = element(doc, "p", "instrument-description", instrument.description);
  const start = element(doc, "div", "instrument-start");
  start.append(
    element(doc, "h4", "", "Start"),
    element(doc, "p", "", instrument.start),
  );
  body.append(description, start);

  const actions = element(doc, "div", "instrument-card-actions");
  actions.append(element(
    doc,
    "span",
    "instrument-action instrument-action-primary",
    "Play in browser",
  ));

  cardLink.append(heading, body, actions);
  card.append(cardLink, preview);
  return card;
}

export function instrumentMatchesTag(instrument, tagId) {
  return tagId === ALL_TAG_ID || instrument.tags.some(({ id }) => id === tagId);
}

export function orderHomepageInstruments(instruments) {
  const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const favoriteIds = new Set(FAVE_TOOL_IDS);
  const shapes = instrumentById.get("combo");
  return [
    ...FAVE_TOOL_IDS.map((id) => instrumentById.get(id)).filter(Boolean),
    ...instruments.filter(({ id }) => !favoriteIds.has(id) && id !== "combo"),
    ...(shapes ? [shapes] : []),
  ];
}

function catalogueTags(records) {
  const seen = new Set();
  const tags = [];
  const instruments = records
    .map(({ instrument }) => instrument)
    .filter((instrument) => !instrument.status);
  const addTag = (tag) => {
    if (!tag || tag.id === "experiments" || seen.has(tag.id)) return;
    seen.add(tag.id);
    tags.push(tag);
  };

  addTag(instruments.flatMap(({ tags: instrumentTags }) => instrumentTags)
    .find(({ id }) => id === "faves"));
  for (const instrument of instruments) addTag(instrument.tags[0]);
  for (const instrument of instruments) {
    for (const tag of instrument.tags) addTag(tag);
  }
  return tags;
}

function createTagFilter(doc, records, experiments, deferredAppGrid) {
  const filter = element(doc, "div", "catalogue-tag-filter");
  filter.setAttribute("role", "group");
  filter.setAttribute("aria-label", "Filter instruments by tag");
  const buttons = [];

  const setActiveTag = (tagId) => {
    let visibleExperiments = 0;
    for (const { instrument, card } of records) {
      const matches = instrumentMatchesTag(instrument, tagId);
      card.hidden = !matches;
      if (matches && instrument.status) visibleExperiments += 1;
    }
    experiments.hidden = visibleExperiments === 0;
    deferredAppGrid.hidden = records.find(({ instrument }) => instrument.id === "combo")
      ?.card.hidden ?? true;
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.catalogueTag === tagId),
      );
    }
  };

  for (const tag of [
    { id: ALL_TAG_ID, label: "All" },
    ...catalogueTags(records),
  ]) {
    const button = element(doc, "button", "catalogue-tag-filter-button", tag.label);
    button.type = "button";
    button.dataset.catalogueTag = tag.id;
    button.setAttribute("aria-pressed", String(tag.id === ALL_TAG_ID));
    button.addEventListener("click", () => setActiveTag(tag.id));
    buttons.push(button);
    filter.append(button);
  }

  return { filter, setActiveTag };
}

export function renderInstrumentCatalog(root) {
  if (!root?.ownerDocument) return null;
  const doc = root.ownerDocument;
  const grid = element(doc, "div", "instrument-catalog-grid");
  const homepageInstruments = orderHomepageInstruments(INSTRUMENTS);
  const displayIndexById = new Map(homepageInstruments.map(({ id }, index) => [id, index]));
  const records = INSTRUMENTS.map((instrument, index) => ({
    instrument,
    card: createCard(doc, instrument, displayIndexById.get(instrument.id) ?? index),
  }));
  const recordById = new Map(records.map((record) => [record.instrument.id, record]));
  const instrumentCards = homepageInstruments
    .filter((instrument) => !instrument.status && instrument.id !== "combo")
    .map(({ id }) => recordById.get(id).card);
  const experimentCards = records
    .filter(({ instrument }) => instrument.status)
    .map(({ card }) => card);
  grid.append(...instrumentCards);

  const experiments = element(doc, "section", "catalogue-experiments");
  const experimentsTitle = element(doc, "h3", "", "Experiments");
  experimentsTitle.id = "catalogue-experiments-title";
  experiments.setAttribute("aria-labelledby", experimentsTitle.id);
  const experimentsHeading = element(doc, "header", "catalogue-experiments-heading");
  experimentsHeading.append(
    experimentsTitle,
    element(doc, "span", "catalogue-experiments-status", "Works in progress"),
  );
  const experimentGrid = element(doc, "div", "instrument-catalog-grid");
  experimentGrid.append(...experimentCards);
  experiments.append(experimentsHeading, experimentGrid);

  const deferredAppGrid = element(doc, "div", "instrument-catalog-grid");
  const shapesCard = recordById.get("combo")?.card;
  if (shapesCard) deferredAppGrid.append(shapesCard);

  const { filter, setActiveTag } = createTagFilter(
    doc,
    records,
    experiments,
    deferredAppGrid,
  );

  root.replaceChildren(filter, grid, experiments, deferredAppGrid);
  return Object.freeze({
    root,
    filter,
    grid,
    experiments,
    experimentGrid,
    deferredAppGrid,
    cards: Object.freeze(records.map(({ card }) => card)),
    setActiveTag,
  });
}

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll("[data-instrument-catalog]")) {
    renderInstrumentCatalog(root);
  }
}
