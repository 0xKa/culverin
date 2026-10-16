import {
  EyeOff,
  Gauge,
  HardDriveDownload,
  History as HistoryIcon,
  Info,
  KeyRound,
  Palette,
  PanelsTopLeft,
  type LucideIcon,
} from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { BrandHeader } from "./BrandHeader";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { CountingSection } from "./CountingSection";
import { GitHubSection } from "./GitHubSection";
import { IgnoreSection } from "./IgnoreSection";
import { LargeRepositoriesSection } from "./LargeRepositoriesSection";
import { RepositoryPageSection } from "./RepositoryPageSection";
import {
  initialSection,
  parseSection,
  readSection,
  rememberSection,
  SECTION_KEY,
  sectionGroups,
  sections,
  type SectionId,
} from "./sections";
import { StorageSection } from "./StorageSection";

const sectionIcons: Record<SectionId, LucideIcon> = {
  appearance: Palette,
  "repository-page": PanelsTopLeft,
  counting: Gauge,
  ignore: EyeOff,
  "large-repositories": HardDriveDownload,
  github: KeyRound,
  storage: HistoryIcon,
  about: Info,
};

export function App() {
  const [initial] = useState(() =>
    initialSection(location.hash, readSection()),
  );
  const [active, setActive] = useState(initial);

  useEffect(() => {
    rememberSection(active);
  }, [active]);

  useEffect(() => {
    if (!parseSection(location.hash))
      history.replaceState(null, "", `#${initial}`);
  }, [initial]);

  useEffect(() => {
    const fromHash = () => {
      const next = location.hash ? parseSection(location.hash) : sections[0].id;
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
      <BrandHeader
        onHome={() => {
          if (location.hash)
            history.pushState(null, "", location.pathname + location.search);
          setActive(sections[0].id);
        }}
      />
      <div className="grid gap-8 md:grid-cols-[12.5rem_1fr]">
        <nav
          aria-label="Settings sections"
          className="md:sticky md:top-8 md:self-start"
        >
          <div className="flex flex-wrap gap-1 md:flex-col md:gap-4">
            {sectionGroups.map((group, index) => (
              <div
                key={group.name ?? index}
                className={
                  group.name
                    ? undefined
                    : "md:border-divider md:border-t md:pt-4"
                }
              >
                {group.name && (
                  <p
                    id={`nav-group-${index}`}
                    className="text-muted m-0 mb-1 hidden px-3 text-2xs font-semibold tracking-wider uppercase md:block"
                  >
                    {group.name}
                  </p>
                )}
                <ul
                  aria-labelledby={
                    group.name ? `nav-group-${index}` : undefined
                  }
                  className="m-0 flex list-none flex-wrap gap-1 p-0 md:flex-col"
                >
                  {group.sections.map((section) => {
                    const Icon = sectionIcons[section.id];
                    return (
                      <li key={section.id}>
                        <a
                          href={`#${section.id}`}
                          aria-current={
                            active === section.id ? "page" : undefined
                          }
                          className="ticks ticks-quiet group text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-text flex items-center gap-2.5 rounded-md px-3 py-1.5 no-underline transition-colors duration-150 aria-[current=page]:font-medium"
                        >
                          <Icon class="text-muted group-aria-[current=page]:text-accent-text shrink-0" />
                          {section.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <main className="min-w-0">
          <AppearanceSection hidden={active !== "appearance"} />
          <IgnoreSection hidden={active !== "ignore"} />
          <StorageSection hidden={active !== "storage"} />
          <CountingSection hidden={active !== "counting"} />
          <LargeRepositoriesSection hidden={active !== "large-repositories"} />
          <RepositoryPageSection hidden={active !== "repository-page"} />
          <GitHubSection hidden={active !== "github"} />
          <AboutSection hidden={active !== "about"} />
        </main>
      </div>
    </div>
  );
}
