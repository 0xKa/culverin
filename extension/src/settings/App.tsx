import { useEffect, useState } from "preact/hooks";
import { IgnoreSection } from "./IgnoreSection";
import { sectionFromHash, sections } from "./sections";
import { StorageSection } from "./StorageSection";

export function App() {
  const [active, setActive] = useState(() => sectionFromHash(location.hash));

  useEffect(() => {
    const update = () => setActive(sectionFromHash(location.hash));
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);

  return (
    <div className="mx-auto my-8 max-w-[960px] px-5 leading-[1.5]">
      <header className="mb-6">
        <h1 className="mb-1 text-[2em] font-bold">Culverin</h1>
        <p>
          Repository source is downloaded directly from GitHub and analyzed in
          your browser only when you select Analyze. This version analyzes
          public repositories only.
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
        </main>
      </div>
    </div>
  );
}
