import { createOptionCardGroup } from "../src/ui/index.js";
import "./catalog.css";

const OPTIONS = [
  { value: "salt", label: "Salt lattice", description: "9 terms · crystalline" },
  { value: "silver", label: "Silver thicket", description: "13 terms · diffuse" },
  { value: "ember", label: "Slow ember", description: "5 terms · low drift" },
  { value: "prism", label: "Prism engine", description: "11 terms · bright" },
];

function render(args) {
  const panel = document.createElement("div");
  panel.className = "mz-story-panel";
  panel.append(createOptionCardGroup(args));
  return panel;
}

export default {
  title: "Primitives/Preset Picker",
  component: createOptionCardGroup,
  tags: ["autodocs"],
  render,
  args: { label: "Character", value: "salt", options: OPTIONS, columns: 2, compact: false, disabled: false },
  argTypes: { value: { control: "select", options: OPTIONS.map(({ value }) => value) } },
  parameters: {
    layout: "centered",
    docs: { description: { component: "A selectable grid for preset, patch, and algorithm cards. It reports selection only; applications apply the preset data." } },
  },
};

export const CharacterPresets = {};
export const NamesOnly = { args: { value: "Line", options: ["Points", "Line", "Radar"], columns: 3, compact: true } };
export const LongLabels = { args: { value: "angle", options: [
  { value: "angle", label: "Angular position", description: "Tile and edge shape combined" },
  { value: "reader", label: "Complete path reader", description: "Normalized traversal position" },
] } };
export const Empty = { args: { options: [], value: undefined } };
export const Disabled = { args: { disabled: true } };
