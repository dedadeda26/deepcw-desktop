import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@fontsource/roboto-mono/500.css";
import "@mantine/core/styles.css";
import "./global.css";
import { MantineProvider } from "@mantine/core";
import { theme } from "./theme";
import { initLanguage } from "./i18n";

initLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark" theme={theme}>
      <App />
    </MantineProvider>
  </StrictMode>,
);
