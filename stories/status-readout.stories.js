import { createStatusReadout } from "../src/ui/index.js";
import "./catalog.css";

function render(args) {
  const panel = document.createElement("div");
  panel.className = "mz-story-panel";
  panel.append(createStatusReadout(args));
  return panel;
}

export default {
  title: "Primitives/Status Readout",
  component: createStatusReadout,
  tags: ["autodocs"],
  render,
  args: { label: "Schedule", value: "I7 only", tone: "default", live: false },
  argTypes: {
    tone: { control: "select", options: ["default", "muted", "warning", "danger"] },
  },
  parameters: {
    layout: "centered",
    docs: { description: { component: "A compact key/value status card used for schedules, voice ceilings, traversal state, and other live readouts." } },
  },
};

export const Default = {};
export const Live = { args: { label: "MIDI input", value: "Keystep 37", live: "polite" } };
export const Warning = { args: { label: "Output", value: "Clipping", tone: "warning" } };
export const LongValue = { args: { label: "Traversal", value: "0.30 cyc/s · reverse ping-pong" } };
