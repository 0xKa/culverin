# Language colors

The popup, saved-result dialogs, and the Appearance preview color each language row by language. Appearance offers By language, the default, and Single color, which restores the single accent. Language markers chooses the swatch beside each language name: Square, the default, Circle, or None, which colors only the bars; it is disabled while Single color is selected, which shows no markers. The choices are stored as `culverin.languageColors` and `culverin.languageMarker` in trusted-only `chrome.storage.sync` only when they differ from the defaults, remembered in the extension origin's `localStorage` for startup, and applied as `data-language-colors="single"` and `data-language-marker="circle"` or `"none"` on the root element, so open views switch without re-rendering. Colors are presentation data: they are not part of counter results, cache entries, or the protocol, and GitHub repository pages keep their appearance.

## Rendering

Code rows show a small marker beside the language name and a bar in the language's color. Text rows use the same hue with 40% of its chroma. Other files rows stay neutral, because their labels are file extensions rather than languages. A row's color depends only on the language name, so it does not change with rank, repository, or the other languages shown. Names, counts, percentages, accessible row labels, and tooltips are unchanged; the marker and bar are decorative.

`extension/src/appearance/language-palette.ts` looks up one base color per language and passes its OKLCH lightness, chroma, and hue to the row as `--language-l`, `--language-c`, and `--language-h`. `extension/src/ui/styles.css` clamps the lightness between `--language-min-l` and `--language-max-l`, which each theme and contrast mode sets, and keeps the chroma and hue. The bounds keep every bar at least 3:1 against its track and every swatch at least 3:1 against the page background, and 4.5:1 in high contrast:

| Mode                | Lightness     |
| ------------------- | ------------- |
| Light               | at most 0.54  |
| Dark                | at least 0.67 |
| High contrast light | at most 0.4   |
| High contrast dark  | at least 0.9  |

`tests/unit/language-palette.test.ts` reads these bounds and the track and background colors from `styles.css` and checks every palette and fallback color, at full and subdued chroma, in all four modes. Change a bound or a theme color only with that test passing. The rules use plain `oklch()` with `var()`, `clamp()`, and `calc()`, which Chrome 120 supports, rather than relative color syntax. In forced-color mode the colors are not applied, and bars and swatches use the system text color.

## Sources

Language names come from Tokei 15.0.0, the version in `Cargo.lock`: the display name of each of the 333 entries in its `languages.json`, which is the `name` field when present and otherwise the entry key. Base colors come from GitHub Linguist at commit [`5fbdfcb8133be2bed88bf3ce62b2335f50474525`](https://github.com/github-linguist/linguist/blob/5fbdfcb8133be2bed88bf3ce62b2335f50474525/lib/linguist/languages.yml), MIT licensed. `extension/src/appearance/linguist/LICENSE` keeps Linguist's license, and `scripts/generate-notices.ts` adds it to the packaged third-party notices.

| Input                                 | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| Linguist `lib/linguist/languages.yml` | `183243e30496ba53f5f8743b0e39c9f0e0bccc5a32639f7b541cc2285db0e043` |
| Linguist `LICENSE`                    | `7717070c5a8c85440ff2312930bb30dd19002ab5bc235c9800042767f6f5242f` |
| Tokei 15.0.0 `languages.json`         | `596748f92a5dca4065cc73e9379cf45615f1c06ba0b5b279b5851edd8258bd05` |

A Tokei name takes the color of the first Linguist language it matches, in this order: the same name, the same name ignoring case when only one Linguist language has it, a Linguist alias that only one language declares, then the alias list in the generator below, which covers common names that do not match automatically, such as `C Header` and `JSX`. There is no fuzzy matching. With the pinned inputs, 230 names have a Linguist color and 103 use a fallback, including names whose Linguist match has no color, such as Plain Text. A fallback hashes the full name with 32-bit FNV-1a into one of eight fixed colors, so it is stable everywhere, and names Tokei adds later use the same rule.

`extension/src/appearance/linguist/colors.ts` is generated and holds only the matched names and colors. Its minified size is 3,890 bytes, 2,264 gzipped. With the controls, rendering, and styles, the feature added 9,865 bytes to the popup and settings JavaScript and CSS, 4,156 gzipped.

## Regenerating

The build never downloads these inputs. To update the palette, pick a Linguist commit and download its `lib/linguist/languages.yml` and `LICENSE` from `https://raw.githubusercontent.com/github-linguist/linguist/<commit>/` into a new empty directory. Save the generator below into a separate directory and run it with the inputs and the output path:

```sh
bun generate.ts <inputs>/languages.yml "$(dirname "$(cargo metadata --locked --format-version 1 | jq -r '.packages[] | select(.name == "tokei") | .manifest_path')")/languages.json" extension/src/appearance/linguist/colors.ts
bunx prettier --write extension/src/appearance/linguist/colors.ts
```

Then copy the new `LICENSE` to `extension/src/appearance/linguist/LICENSE`, update the commit in `scripts/generate-notices.ts` and this document, run `bun run notices:build`, update the checksums, alias list, and counts here, and update the expected counts in `tests/unit/language-palette.test.ts`. Review any new alias by hand, and check that every alias target exists in Linguist; the generator stops when one does not.

```ts
const [linguistPath, tokeiPath, outputPath] = process.argv.slice(2);

const ALIASES: Record<string, string> = {
  "Arduino C++": "C++",
  "C Header": "C",
  "C Shell": "Shell",
  "C++ Header": "C++",
  "C++ Module": "C++",
  ClojureScript: "Clojure",
  Ebuild: "Gentoo Ebuild",
  "FORTRAN Legacy": "Fortran",
  "FORTRAN Modern": "Fortran",
  "GNU Style Assembly": "Assembly",
  "Gherkin (Cucumber)": "Gherkin",
  "Go HTML": "Go Template",
  JSX: "JavaScript",
  Jinja2: "Jinja",
  "Jupyter Notebooks": "Jupyter Notebook",
  "Korn shell": "Shell",
  MSBuild: "XML",
  "Metal Shading Language": "Metal",
  Rakefile: "Ruby",
  "Ruby HTML": "HTML+ERB",
  "Rusty Object Notation": "RON",
  "Standard ML (SML)": "Standard ML",
  "Unreal Script": "UnrealScript",
  "VB6/VBA": "VBA",
  "WebGPU Shader Language": "WGSL",
  XAML: "XML",
};

type Linguist = Record<string, { color?: string; aliases?: string[] }>;
const linguist = Bun.YAML.parse(
  await Bun.file(linguistPath).text(),
) as Linguist;
const tokei = (await Bun.file(tokeiPath).json()).languages as Record<
  string,
  { name?: string }
>;

const index = (keys: (name: string) => string[]) => {
  const map = new Map<string, Set<string>>();
  for (const name of Object.keys(linguist))
    for (const key of keys(name))
      map.set(key, (map.get(key) ?? new Set()).add(name));
  return map;
};
const byName = index((name) => [name.toLowerCase()]);
const byAlias = index((name) =>
  (linguist[name]!.aliases ?? []).map((alias) => alias.toLowerCase()),
);
const only = (set?: Set<string>) => (set?.size === 1 ? [...set][0] : undefined);

const colors: Record<string, string> = {};
let fallback = 0;
const names = Object.entries(tokei).map(([key, entry]) => entry.name ?? key);
for (const name of names.sort()) {
  const match =
    (name in linguist ? name : undefined) ??
    only(byName.get(name.toLowerCase())) ??
    only(byAlias.get(name.toLowerCase())) ??
    ALIASES[name];
  const color = match && linguist[match]?.color;
  if (match === ALIASES[name] && match && !linguist[match])
    throw new Error(`missing alias target ${match}`);
  if (color && /^#[0-9a-f]{6}$/i.test(color))
    colors[name] = color.slice(1).toLowerCase();
  else fallback++;
}

const body = Object.entries(colors)
  .map(
    ([name, color]) => `  ${JSON.stringify(name)}: ${JSON.stringify(color)},`,
  )
  .join("\n");
await Bun.write(
  outputPath,
  `export const linguistColors: Record<string, string> = {\n${body}\n};\n`,
);
console.log(
  `${names.length} names: ${Object.keys(colors).length} matched, ${fallback} fallback`,
);
```
