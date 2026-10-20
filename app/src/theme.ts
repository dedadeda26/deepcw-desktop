import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * Neutral, squared-off look: dark grey surfaces, blue accent, 4 px radii.
 * (The previous teal/glass style was too decorative for a contest tool.)
 */

const accent: MantineColorsTuple = [
  "#eaf0ff",
  "#d3e0ff",
  "#a9c2ff",
  "#7ea3ff",
  "#5c8bff",
  "#4a7bf0",
  "#396ad4",
  "#2a58b3",
  "#1e4791",
  "#13366f",
];

const dark: MantineColorsTuple = [
  "#d9dde3",
  "#bcc2ca",
  "#9aa1ac",
  "#767e8b",
  "#565e6b",
  "#3d4551",
  "#2c333d",
  "#20262e",
  "#171c23",
  "#10141a",
];

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: { light: 6, dark: 6 },
  colors: { accent, dark },
  defaultRadius: "sm",
  fontFamily:
    "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif",
  fontFamilyMonospace:
    "'Cascadia Mono', Consolas, 'Roboto Mono', ui-monospace, monospace",
  headings: {
    fontFamily:
      "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, 'Microsoft YaHei UI', sans-serif",
    fontWeight: "600",
  },
  components: {
    Button: {
      defaultProps: { radius: "sm" },
      styles: { root: { fontWeight: 600 } },
    },
    Badge: {
      defaultProps: { radius: "sm" },
    },
    NativeSelect: { defaultProps: { radius: "sm" } },
    TextInput: { defaultProps: { radius: "sm" } },
    NumberInput: { defaultProps: { radius: "sm" } },
    Switch: { defaultProps: { radius: "sm" } },
    Slider: { defaultProps: { radius: "sm" } },
    Tooltip: {
      defaultProps: { radius: "sm", withArrow: true, openDelay: 350 },
    },
    Paper: { defaultProps: { radius: "sm" } },
    Modal: {
      defaultProps: { radius: "sm" },
    },
    Tabs: {
      defaultProps: { radius: "sm" },
      styles: {
        tab: {
          fontWeight: 600,
          fontSize: 12,
          letterSpacing: "0.02em",
        },
      },
    },
  },
});
