import { useEffect, useState } from "preact/hooks";
import { CountingSection } from "./CountingSection";
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
    <div className="mx-auto my-8 max-w-[960px] px-5 leading-[1.5]">
      <header className="mb-6">
        <h1 className="mb-1 text-[2em] font-bold">Culverin</h1>
        <p>
          Repository source is downloaded directly from GitHub and analyzed in
          your browser when you select Analyze, or when you open a repository
          page if you turn that on under Counting. This version analyzes public
          repositories only.
        </p>
      </header>
      <div className="grid gap-6 md:grid-cols-[12rem_1fr]">
        <nav aria-label="Settings sections">
          <ul className="flex flex-wrap gap-1 md:flex-col">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? "page" : undefined}
                  className="aria-[current=page]:bg-selected aria-[current=page]:border-subtle block rounded-md border border-transparent px-3 py-1.5 hover:underline aria-[current=page]:font-semibold"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main>
          <IgnoreSection hidden={active !== "ignore"} />
          <StorageSection hidden={active !== "storage"} />
          <CountingSection hidden={active !== "counting"} />
        </main>
      </div>
    </div>
  );
}
