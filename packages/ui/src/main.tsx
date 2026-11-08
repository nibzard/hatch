/**
 * The browser entry of the editor (task T026, specification sections 11
 * and 23). The page mounts one App; the panels and the render loop live
 * there.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html carries no #root to mount the editor on");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
