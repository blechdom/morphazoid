import { INSTRUMENTS } from "./src/instrument-catalog.js";

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

export function renderInstrumentCatalog(root) {
  if (!root?.ownerDocument) return null;
  const doc = root.ownerDocument;
  const grid = element(doc, "div", "instrument-catalog-grid");
  const records = INSTRUMENTS.map((instrument, index) => ({
    instrument,
    card: createCard(doc, instrument, index),
  }));
  const instrumentCards = records
    .filter(({ instrument }) => !instrument.status)
    .map(({ card }) => card);
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

  root.replaceChildren(grid, experiments);
  return Object.freeze({
    root,
    grid,
    experimentGrid,
    cards: Object.freeze(records.map(({ card }) => card)),
  });
}

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll("[data-instrument-catalog]")) {
    renderInstrumentCatalog(root);
  }
}
