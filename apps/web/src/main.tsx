import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main><h1>BookerDoc</h1><p>Rezervace termínů u lékařů.</p></main>
  </StrictMode>,
);
