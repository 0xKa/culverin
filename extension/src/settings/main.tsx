import { render } from "preact";
import { LucideProvider } from "lucide-preact";
import { followTheme } from "../appearance/theme";
import { followHighContrast } from "../appearance/contrast";
import { followLanguageColors } from "../appearance/language-colors";
import { App } from "./App";
import "../ui/styles.css";

followTheme();
followHighContrast();
followLanguageColors();

render(
  <LucideProvider size={16} strokeWidth={1.5} absoluteStrokeWidth>
    <App />
  </LucideProvider>,
  document.querySelector("#root")!,
);
