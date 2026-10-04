import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./i18n/index.ts";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing in index.html");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
