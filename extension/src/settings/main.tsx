import { render } from "preact";
import { LucideProvider } from "lucide-preact";
import { followTheme } from "../appearance/theme";
import { App } from "./App";
import "../ui/styles.css";

followTheme();

render(
  <LucideProvider size={16} strokeWidth={1.5} absoluteStrokeWidth>
    <App />
  </LucideProvider>,
  document.querySelector("#root")!,
);
