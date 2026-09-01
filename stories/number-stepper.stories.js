import { createNumberStepper } from "../src/ui/index.js";
import "./catalog.css";

function render(args) {
  const panel = document.createElement("div");
  panel.className = "mz-story-panel";
  panel.append(createNumberStepper(args));
  return panel;
}

export default {
  title: "Primitives/Number Stepper",
  component: createNumberStepper,
  tags: ["autodocs"],
  render,
  args: {
    label: "Playhead count",
    value: 3,
    min: 1,
    max: 8,
    step: 1,
    disabled: false,
    formatValue: (value) => `${value} heads`,
  },
  argTypes: { formatValue: { table: { disable: true } } },
  parameters: {
    layout: "centered",
    docs: { description: { component: "A bounded native-button stepper extracted from repeated playhead, loop-vertex, and playback-head controls." } },
  },
};

export const Middle = {};
export const Minimum = { args: { value: 1 } };
export const Maximum = { args: { value: 8 } };
export const LongUnit = { args: { label: "Loop vertices", value: 12, min: 3, max: 24, formatValue: (value) => `${value} vertices` } };
export const Disabled = { args: { disabled: true } };
