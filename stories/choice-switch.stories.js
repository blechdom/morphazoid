import { createChoiceSwitch } from "../src/ui/index.js";
import "./catalog.css";

const READING_METHODS = [
  { value: "trace", label: "Points" },
  { value: "scan", label: "Line" },
  { value: "radial", label: "Radar" },
];

export default {
  title: "Primitives/Choice Switch",
  component: createChoiceSwitch,
  tags: ["autodocs"],
  render: (args) => createChoiceSwitch(args),
  args: {
    label: "Playhead type",
    value: "trace",
    choices: READING_METHODS,
    compact: false,
    disabled: false,
  },
  argTypes: {
    value: {
      control: "select",
      options: READING_METHODS.map(({ value }) => value),
    },
    choices: { control: "object" },
  },
  parameters: {
    docs: {
      description: {
        component: "A single-choice group built from native buttons with explicit pressed state and keyboard focus.",
      },
    },
  },
};

export const ThreeChoices = {};

export const Binary = {
  args: {
    label: "Contour",
    value: "polygon",
    choices: [
      { value: "polygon", label: "Polygon" },
      { value: "star", label: "Star" },
    ],
  },
  argTypes: {
    value: {
      control: "select",
      options: ["polygon", "star"],
    },
  },
};

export const Compact = {
  args: {
    label: "Time path",
    value: "spiral",
    choices: [
      { value: "spiral", label: "Spiral" },
      { value: "loop", label: "Loop" },
      { value: "bounce", label: "Bounce" },
      { value: "hold", label: "Hold" },
    ],
    compact: true,
  },
  argTypes: {
    value: {
      control: "select",
      options: ["spiral", "loop", "bounce", "hold"],
    },
  },
};

export const ChoiceUnavailable = {
  args: {
    label: "Render path",
    value: "canvas",
    choices: [
      { value: "canvas", label: "Canvas" },
      { value: "webgpu", label: "WebGPU", disabled: true },
      { value: "svg", label: "SVG" },
    ],
  },
  argTypes: {
    value: {
      control: "select",
      options: ["canvas", "webgpu", "svg"],
    },
  },
};

export const Disabled = {
  args: {
    disabled: true,
  },
};
