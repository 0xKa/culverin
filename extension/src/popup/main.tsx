import { render } from "preact";
import { LucideProvider } from "lucide-preact";
import { App } from "./App";
import "../ui/styles.css";

render(
  <LucideProvider size={16} strokeWidth={1.5} absoluteStrokeWidth>
    <App />
  </LucideProvider>,
  document.querySelector("#root")!,
);
