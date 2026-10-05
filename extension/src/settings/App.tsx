import { useEffect, useState } from "preact/hooks";
import darkIcon from "../../../assets/dark/culverin-dark-stats.svg";
import lightIcon from "../../../assets/light/culverin-light-stats.svg";
import { AboutSection } from "./AboutSection";
import { CountingSection } from "./CountingSection";
import { GitHubSection } from "./GitHubSection";
import { IgnoreSection } from "./IgnoreSection";
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
    if (location.hash !== `#${active}`)
      history.replaceState(null, "", `#${active}`);
  }, [active]);

  useEffect(() => {
    const fromHash = () => {
      const next = parseSection(location.hash);
      if (next) setActive(next);
    };
    const fromStorage = (event: StorageEvent) => {
      const next = event.key === SECTION_KEY && parseSection(event.newValue);
      if (next) setActive(next);
    };
    addEventListener("hashchange", fromHash);
    addEventListener("storage", fromStorage);
    return () => {
      removeEventListener("hashchange", fromHash);
      removeEventListener("storage", fromStorage);
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1040px] px-6 pt-10 pb-16 text-base">
      <header className="mb-10 flex items-start gap-4">
        <picture className="mt-0.5 shrink-0">
          <source srcSet={darkIcon} media="(prefers-color-scheme: dark)" />
          <img src={lightIcon} alt="" className="block size-10" />
        </picture>
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">
            Culverin
          </h1>
          <p className="text-muted m-0 mt-1 max-w-[72ch]">
            Repository source is downloaded directly from GitHub and analyzed in
            your browser when you select Analyze, or when you open a repository
            page if you turn that on under Counting. Public repositories work
            without an account; connect GitHub to count private ones.
          </p>
        </div>
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
          <IgnoreSection hidden={active !== "ignore"} />
          <StorageSection hidden={active !== "storage"} />
          <CountingSection hidden={active !== "counting"} />
          <GitHubSection hidden={active !== "github"} />
          <AboutSection hidden={active !== "about"} />
        </main>
      </div>
    </div>
  );
}
