import "../src/ui/index.css";

const preview = {
  tags: ["autodocs"],
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
