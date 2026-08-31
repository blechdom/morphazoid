import { createMidiStatus } from "../src/ui/index.js";
import "./catalog.css";

export default {
  title: "Patterns/MIDI Status",
  component: createMidiStatus,
  tags: ["autodocs"],
  render: (args) => createMidiStatus(args),
  args: { state: "off", deviceLabel: "Keystep 37", controlled: true },
  argTypes: { state: { control: "select", options: ["off", "enabling", "on", "receiving", "error", "unsupported"] } },
  parameters: {
    layout: "centered",
    docs: { description: { component: "The project-wide MIDI connection and activity view. Stories inject deterministic status and never request Web MIDI permission." } },
  },
};

export const Off = {};
export const Enabling = { args: { state: "enabling" } };
export const Ready = { args: { state: "on" } };
export const Receiving = { args: { state: "receiving" } };
export const Error = { args: { state: "error" } };
export const Unsupported = { args: { state: "unsupported" } };
