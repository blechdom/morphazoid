import {
  createButton,
  createChoiceSwitch,
  createControlSection,
  createRangeField,
  createSelectField,
} from "../src/ui/index.js";
import "./catalog.css";

const SECTIONS = ["play", "form", "rotation", "winding", "sound", "mapping", "output"];

function makeBody(section) {
  if (section === "play") {
    const row = document.createElement("div");
    row.className = "mz-story__row";
    row.append(
      createButton({ label: "Play", variant: "play", size: "square" }),
      createRangeField({
        label: "Playhead position",
        name: "section-playhead-position",
        min: 0,
        max: 1,
        step: 0.001,
        value: 0.25,
        formatValue: (value) => `${Math.round(Number(value) * 100)}%`,
      }),
    );
    return row;
  }

  if (section === "form") {
    return createChoiceSwitch({
      label: "Contour",
      value: "polygon",
      choices: ["polygon", "star"],
    });
  }

  if (section === "sound") {
    const stack = document.createElement("div");
    stack.className = "mz-story__stack";
    stack.append(
      createSelectField({
        label: "Voice",
        name: "section-voice",
        value: "sine",
        options: [
          { value: "sine", label: "Sine · contact envelope" },
          { value: "percussion", label: "Percussion · new contacts" },
          { value: "fm", label: "FM · incidence index" },
        ],
      }),
      createRangeField({
        label: "Base frequency",
        name: "section-base-frequency",
        min: 20,
        max: 440,
        step: 1,
        value: 110,
        formatValue: (value) => `${Math.round(Number(value))} Hz`,
      }),
    );
    return stack;
  }

  return createRangeField({
    label: section === "mapping" ? "Stereo width" : "Amount",
    name: `section-${section}-amount`,
    min: 0,
    max: 1,
    step: 0.01,
    value: section === "mapping" ? 1 : 0.5,
    formatValue: (value) => `${Math.round(Number(value) * 100)}%`,
  });
}

function renderSection(args) {
  return createControlSection({
    ...args,
    children: makeBody(args.section),
  });
}

function renderAccentGallery() {
  const root = document.createElement("section");
  root.className = "mz-story";
  root.innerHTML = `
    <h1>Semantic section accents</h1>
    <p class="mz-story__intro">Section color communicates control scope. Collapsed specimens keep the comparison compact; Sound is open to show body treatment.</p>
  `;

  const gallery = document.createElement("div");
  gallery.className = "mz-section-gallery";
  const labels = {
    play: ["Play", "Points · paused"],
    form: ["Form", "4 sides"],
    rotation: ["Rotation", "Still"],
    winding: ["Winding", "1 × 5 turns"],
    sound: ["Sound", "Sine oscillators"],
    mapping: ["Mapping", "Angle → pitch"],
    output: ["Output", "System default"],
  };

  SECTIONS.forEach((section) => {
    const [title, state] = labels[section];
    gallery.append(createControlSection({
      title,
      state,
      section,
      open: section === "sound",
      children: makeBody(section),
    }));
  });

  root.append(gallery);
  return root;
}

export default {
  title: "Primitives/Control Section",
  component: createControlSection,
  tags: ["autodocs"],
  render: renderSection,
  args: {
    title: "Sound",
    state: "Sine oscillators",
    section: "sound",
    open: true,
    collapsible: true,
  },
  argTypes: {
    section: {
      control: "select",
      options: SECTIONS,
    },
    open: { control: "boolean" },
    collapsible: { control: "boolean" },
    children: { table: { disable: true } },
  },
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: "A semantic panel section with optional disclosure behavior, concise state summary, and a scoped accent color.",
      },
    },
  },
};

export const Open = {};

export const Closed = {
  args: {
    title: "Form",
    state: "4 sides",
    section: "form",
    open: false,
  },
};

export const Static = {
  args: {
    title: "Form",
    state: "Always visible",
    section: "form",
    open: true,
    collapsible: false,
  },
};

export const LongSummary = {
  args: {
    title: "Mapping",
    state: "Angular position combined with tile and edge shape",
    section: "mapping",
    open: false,
  },
};

export const SemanticAccents = {
  render: renderAccentGallery,
  parameters: {
    controls: { disable: true },
  },
};
