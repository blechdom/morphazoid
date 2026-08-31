import "./catalog.css";

const COLOR_TOKENS = [
  ["Canvas", "--mz-color-bg", "#07090b"],
  ["Canvas deep", "--mz-color-bg-deep", "#050608"],
  ["Panel", "--mz-color-panel", "#0b0e11"],
  ["Panel raised", "--mz-color-panel-high", "#0f1316"],
  ["Ink", "--mz-color-ink", "#dbe4e0"],
  ["Muted ink", "--mz-color-muted", "#77837e"],
  ["Faint ink", "--mz-color-faint", "#454e4b"],
  ["Accent / play", "--mz-color-accent", "#5fe8c4"],
  ["Form", "--mz-color-brass", "#e8c46b"],
  ["Sound", "--mz-color-blue", "#7db4ff"],
  ["Mapping", "--mz-color-violet", "#c79bff"],
  ["Attention", "--mz-color-orange", "#ffb86b"],
  ["Danger", "--mz-color-danger", "#ff826f"],
];

const SPACING_TOKENS = Array.from({ length: 8 }, (_, index) => `--mz-space-${index + 1}`);

function makeStory(title, intro) {
  const root = document.createElement("section");
  root.className = "mz-story";

  const heading = document.createElement("h1");
  heading.textContent = title;

  const description = document.createElement("p");
  description.className = "mz-story__intro";
  description.textContent = intro;

  root.append(heading, description);
  return root;
}

function makeTokenCard([label, token, fallback]) {
  const card = document.createElement("article");
  card.className = "mz-token-card";

  const swatch = document.createElement("div");
  swatch.className = "mz-token-card__swatch";
  swatch.style.setProperty("--mz-story-swatch", `var(${token}, ${fallback})`);

  const copy = document.createElement("div");
  copy.className = "mz-token-card__copy";
  const name = document.createElement("b");
  name.textContent = label;
  const value = document.createElement("code");
  value.textContent = token;
  copy.append(name, value);
  card.append(swatch, copy);
  return card;
}

export default {
  title: "Foundations/Tokens",
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    controls: { disable: true },
  },
};

export const Color = {
  render: () => {
    const root = makeStory(
      "Morphazoid color system",
      "Neutral surfaces carry the interface. Semantic accents identify play, form, sound, mapping, attention, and destructive actions.",
    );
    const grid = document.createElement("div");
    grid.className = "mz-token-grid";
    grid.append(...COLOR_TOKENS.map(makeTokenCard));
    root.append(grid);
    return root;
  },
};

export const TypographyAndSpacing = {
  render: () => {
    const root = makeStory(
      "Type and rhythm",
      "A single monospace family, compact uppercase labels, and an eight-step spacing scale keep dense instrument controls legible.",
    );

    const type = document.createElement("div");
    type.className = "mz-type-specimen";
    type.innerHTML = `
      <div class="mz-type-specimen__display">Geometric instruments</div>
      <div class="mz-type-specimen__label">Sound mapping</div>
      <div class="mz-type-specimen__body">One visual grammar across synthesis, motion, form, and performance controls.</div>
    `;

    const spacing = document.createElement("div");
    spacing.className = "mz-story__surface mz-story__stack";
    const spacingTitle = document.createElement("h2");
    spacingTitle.textContent = "Spacing scale";
    spacing.append(spacingTitle);

    SPACING_TOKENS.forEach((token) => {
      const row = document.createElement("div");
      row.className = "mz-spacing-row";
      const name = document.createElement("code");
      name.textContent = token;
      const bar = document.createElement("i");
      bar.style.setProperty("--mz-story-space", `var(${token})`);
      row.append(name, bar);
      spacing.append(row);
    });

    root.append(type, spacing);
    return root;
  },
};
