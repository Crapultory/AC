import { createRoot } from "react-dom/client";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing root element");
}

createRoot(container).render("AISOC frontend bootstrap pending.");

