import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Ide from "./components/Ide";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Ide />
  </StrictMode>,
);
