import { useEffect, useState } from "preact/hooks";
import darkIcon from "../../../assets/dark/culverin-dark-stats.svg";
import lightIcon from "../../../assets/light/culverin-light-stats.svg";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { CountingSection } from "./CountingSection";
import { GitHubSection } from "./GitHubSection";
import { IgnoreSection } from "./IgnoreSection";
import { RepositoryPageSection } from "./RepositoryPageSection";
import {
  initialSection,
  parseSection,
  readSection,
  rememberSection,
  SECTION_KEY,
  sections,
} from "./sections";
import { StorageSection } from "./StorageSection";

export function App() {
  const [active, setActive] = useState(() =>
    initialSection(location.hash, readSection()),
  );

  useEffect(() => {
    rememberSection(active);
    if (!parseSection(location.hash))
      history.replaceState(null, "", `#${active}`);
  }, [active]);

  useEffect(() => {
    const fromHash = () => {
      const next = parseSection(location.hash);
      if (next) setActive(next);
    };
    const fromStorage = (event: StorageEvent) => {
      const next = event.key === SECTION_KEY && parseSection(event.newValue);
      if (!next) return;
      if (location.hash !== `#${next}`)
        history.replaceState(null, "", `#${next}`);
      setActive(next);
    };
    addEventListener("hashchange", fromHash);
    addEventListener("storage", fromStorage);
    return () => {
      removeEventListener("hashchange", fromHash);
      removeEventListener("storage", fromStorage);
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1040px] px-6 pt-8 pb-16 text-base">
      <header className="mb-8 flex items-center gap-3">
        <img
          src={lightIcon}
          alt=""
          className="block size-7 shrink-0 dark:hidden"
        />
        <img
          src={darkIcon}
          alt=""
          className="hidden size-7 shrink-0 dark:block"
        />
        <h1 className="m-0 text-xl font-semibold tracking-tight">Culverin</h1>
      </header>
      <div className="grid gap-8 md:grid-cols-[12.5rem_1fr]">
        <nav
          aria-label="Settings sections"
          className="md:sticky md:top-8 md:self-start"
        >
          <ul className="m-0 flex list-none flex-wrap gap-1 p-0 md:flex-col">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? "page" : undefined}
                  className="text-ink hover:bg-hover aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-text block rounded-md px-3 py-1.5 no-underline transition-colors duration-150 aria-[current=page]:font-medium"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0">
          <AppearanceSection hidden={active !== "appearance"} />
          <IgnoreSection hidden={active !== "ignore"} />
          <StorageSection hidden={active !== "storage"} />
          <CountingSection hidden={active !== "counting"} />
          <RepositoryPageSection hidden={active !== "repository-page"} />
          <GitHubSection hidden={active !== "github"} />
          <AboutSection hidden={active !== "about"} />
        </main>
      </div>
    </div>
  );
}
