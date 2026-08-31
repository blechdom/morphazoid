import "../src/ui/index.css";
import "./preview.css";

function withMorphazoidTypography(Story) {
  const root = document.createElement("div");
  root.className = "mz-ui mz-preview-root";
  root.setAttribute("data-mz-ui", "storybook");
  const rendered = Story();
  if (rendered instanceof Node) root.append(rendered);
  else if (rendered !== undefined && rendered !== null) root.innerHTML = String(rendered);
  return root;
}

const preview = {
  tags: ["autodocs"],
  decorators: [withMorphazoidTypography],
  parameters: {
    layout: "centered",
    a11y: {
      test: "todo",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
