import { render } from "preact";
import { LucideProvider } from "lucide-preact";
import { followTheme } from "../appearance/theme";
import { followHighContrast } from "../appearance/contrast";
import { followLanguageColors } from "../appearance/language-colors";
import { followAccent } from "../appearance/accent";
import { followColorScheme } from "../appearance/color-scheme";
import { App } from "./App";
import { followTabIcon } from "./tab-icon";
import "../ui/styles.css";

followTheme();
followHighContrast();
followAccent();
followColorScheme({ immediately: true });
followLanguageColors();
followTabIcon();

render(
  <LucideProvider size={16} strokeWidth={1.5} absoluteStrokeWidth>
    <App />
  </LucideProvider>,
  document.querySelector("#root")!,
);
