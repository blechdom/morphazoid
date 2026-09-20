import {
  CATALOGUE_GROUPS,
  CATALOGUE_ITEMS,
} from "../instrument-catalog.js?v=catalog-20260914-1";
import { FAVE_TOOL_IDS } from "./instrument-registry.js";

const ALL_TAG_ID = "all";
export const FIRST_CATEGORY_ID = "faves";

// Retain the public export name, but use the owner's registry/sheet order
// rather than an older activity ranking that would override rearrangement.
export const HOMEPAGE_ACTIVITY_IDS = Object.freeze(CATALOGUE_ITEMS.map(({ id }) => id));

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function previewDescription(description) {
  const firstSentence = description.match(/^[^.!?]+[.!?]/)?.[0] ?? description;
  const maximumLength = 88;
  if (firstSentence.length <= maximumLength) return firstSentence;
  const excerpt = firstSentence.slice(0, maximumLength - 1).trimEnd();
  const finalWordBreak = excerpt.lastIndexOf(" ");
  return `${excerpt.slice(0, finalWordBreak > 0 ? finalWordBreak : excerpt.length).trimEnd()}…`;
}

function createPreview(doc) {
  const node = element(doc, "aside", "instrument-card-preview");
  node.hidden = true;
  node.setAttribute("aria-hidden", "true");

  const visual = element(doc, "span", "instrument-card-preview-visual");
  const image = element(doc, "img", "instrument-card-preview-image");
  image.alt = "";
  image.width = 512;
  image.height = 512;
  image.decoding = "async";
  visual.append(image);

  const copy = element(doc, "span", "instrument-card-preview-copy");
  const title = element(doc, "h3", "instrument-card-preview-title");
  const description = element(doc, "p", "instrument-card-preview-description");
  copy.append(title, description);
  node.append(visual, copy);
  return Object.freeze({ node, image, title, description });
}

function showPreview(preview, cardLink, instrument) {
  const { node } = preview;
  const anchorRect = cardLink.getBoundingClientRect();
  const viewportWidth = Math.max(0, globalThis.innerWidth ?? 1024);
  const horizontalMargin = 8;
  const previewWidth = Math.min(212, Math.max(0, viewportWidth - (horizontalMargin * 2)));
  const centeredLeft = anchorRect.left + (anchorRect.width / 2) - (previewWidth / 2);
  const left = Math.max(horizontalMargin, Math.min(
    centeredLeft,
    viewportWidth - previewWidth - horizontalMargin,
  ));
  const showBelow = anchorRect.top < 176;

  preview.image.src = instrument.imageHref;
  preview.title.textContent = instrument.label;
  preview.description.textContent = previewDescription(instrument.description);
  node.className = `instrument-card-preview${showBelow ? " is-below" : ""}`;
  node.style.left = `${left}px`;
  node.style.top = `${showBelow ? anchorRect.bottom + horizontalMargin : anchorRect.top - horizontalMargin}px`;
  node.hidden = false;
}

function createCard(doc, instrument, index, preview) {
  const card = element(doc, "article", "instrument-card");
  card.dataset.instrumentId = instrument.id;
  card.dataset.entryType = instrument.entryType ?? "instrument";

  const cardLink = element(doc, "a", "instrument-card-link");
  cardLink.href = instrument.href;
  cardLink.setAttribute("aria-label", instrument.entryType === "lab" ? `${instrument.label} — lab` : instrument.label);

  const visual = element(doc, "span", "instrument-card-visual");
  const image = element(doc, "img", "instrument-card-image");
  image.alt = "";
  image.width = 512;
  image.height = 512;
  image.loading = index < 12 ? "eager" : "lazy";
  if (index < 6) image.fetchPriority = "high";
  image.decoding = index < 12 ? "sync" : "async";
  image.src = instrument.imageHref;
  visual.append(image);

  const title = element(doc, "h3", "instrument-card-title", instrument.label);
  cardLink.append(visual, title);
  card.append(cardLink);

  cardLink.addEventListener("pointerenter", () => showPreview(preview, cardLink, instrument));
  cardLink.addEventListener("pointerleave", () => {
    preview.node.hidden = true;
  });
  cardLink.addEventListener("focus", () => showPreview(preview, cardLink, instrument));
  cardLink.addEventListener("blur", () => {
    preview.node.hidden = true;
  });

  return card;
}

export function instrumentMatchesTag(instrument, tagId) {
  return tagId === ALL_TAG_ID || instrument.tags.some(({ id }) => id === tagId);
}

export function orderHomepageInstruments(instruments) {
  const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const rankedIds = new Set(HOMEPAGE_ACTIVITY_IDS);
  return [
    ...HOMEPAGE_ACTIVITY_IDS.map((id) => instrumentById.get(id)).filter(Boolean),
    ...instruments.filter(({ id }) => !rankedIds.has(id)),
  ];
}

function homepageCategories() {
  return [
    Object.freeze({ id: FIRST_CATEGORY_ID, label: "Faves" }),
    ...CATALOGUE_GROUPS.filter(({ id, tools }) => id !== FIRST_CATEGORY_ID && tools.length > 0),
  ];
}

export function renderInstrumentCatalog(root) {
  if (!root?.ownerDocument) return null;
  const doc = root.ownerDocument;
  const instruments = orderHomepageInstruments(CATALOGUE_ITEMS);
  const preview = createPreview(doc);
  const cards = [];
  let renderIndex = 0;
  const groupViews = homepageCategories().map((category) => {
    const categoryInstruments = category.id === FIRST_CATEGORY_ID
      ? FAVE_TOOL_IDS.map(id => instruments.find(instrument => instrument.id === id)).filter(Boolean)
      : instruments.filter(instrument => instrumentMatchesTag(instrument, category.id));
    const section = element(doc, "section", "catalogue-group");
    const heading = element(doc, "h3", "catalogue-group-title", category.label);
    const grid = element(doc, "div", "instrument-catalog-grid");
    const headingId = `catalogue-${category.id}-title`;
    heading.id = headingId;
    section.dataset.categoryId = category.id;
    section.setAttribute("aria-labelledby", headingId);
    grid.dataset.categoryId = category.id;

    const groupCards = categoryInstruments.map((instrument) => {
      const card = createCard(doc, instrument, renderIndex, preview);
      renderIndex += 1;
      card.dataset.categoryId = category.id;
      cards.push(card);
      return card;
    });
    grid.append(...groupCards);
    section.append(heading, grid);
    return Object.freeze({
      id: category.id,
      section,
      heading,
      grid,
      cards: Object.freeze(groupCards),
    });
  });

  root.replaceChildren(...groupViews.map(({ section }) => section), preview.node);
  return Object.freeze({
    root,
    groups: Object.freeze(groupViews),
    cards: Object.freeze(cards),
    preview,
  });
}

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll("[data-instrument-catalog]")) {
    renderInstrumentCatalog(root);
  }
}
