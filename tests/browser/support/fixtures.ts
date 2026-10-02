import type { BrowserContext, Page } from "playwright";
export type FixtureState = {
  sha: string;
  metadataFailure: boolean;
  archiveRequests: number;
  apiRequests: number;
  authorization?: string;
  mode: "ok" | "empty" | "rate" | "slow" | "shared" | "private";
  slowArchiveStarted?: () => void;
  metadataGate?: Promise<void>;
};

export function createFixtures(sha: string): FixtureState {
  return {
    sha,
    metadataFailure: false,
    archiveRequests: 0,
    apiRequests: 0,
    mode: "ok",
  };
}

export async function installGitHubFixtures(
  context: BrowserContext,
  page: Page,
  publicSha: string,
): Promise<FixtureState> {
  const fixtures = createFixtures(publicSha);
  const repositoryFixture = `<!doctype html><html><head><meta name="octolytics-dimension-repository_nwo" content="culverin/bootstrap-fixture"><style>@media (max-width: 767px) { #about { display: none } }</style></head><body><main><react-app id="app"><div id="about"><h2>About</h2><div class="mt-2"><span>1 star</span></div><div class="mt-2"><a id="forks" href="/culverin/bootstrap-fixture/forks"><strong>0</strong> forks</a></div><div class="mt-2"><a href="/contact/report-content">Report repository</a></div></div></react-app></main><script>
const sync = () => {
  const [, owner, name] = location.pathname.split("/");
  document.querySelector("#forks").setAttribute("href", "/" + owner + "/" + name + "/forks");
  document.querySelector('meta[name="octolytics-dimension-repository_nwo"]').setAttribute("content", owner + "/" + name);
};
if (sessionStorage.getItem("holdHydration") !== "1")
  document.querySelector("#app").classList.add("loaded");
for (const method of ["pushState", "replaceState"]) {
  const original = history[method].bind(history);
  history[method] = (...args) => {
    original(...args);
    sync();
  };
}
addEventListener("popstate", sync);
sync();
</script></body></html>`;

  await context.route(
    "https://api.github.com/repos/culverin/bootstrap-fixture**",
    async (route) => {
      await fixtures.metadataGate;
      const url = new URL(route.request().url());
      fixtures.apiRequests++;
      fixtures.authorization = route.request().headers()["authorization"];
      if (fixtures.metadataFailure) return route.abort("failed");
      if (fixtures.mode === "rate")
        return route.fulfill({
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      if (url.pathname.endsWith(`/commits/main`)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "57",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
            "x-ratelimit-resource": "core",
          },
          body: JSON.stringify({ sha: fixtures.sha }),
        });
      }
      if (url.pathname.endsWith(`/tarball/${fixtures.sha}`)) {
        fixtures.archiveRequests++;
        if (fixtures.mode === "slow" || fixtures.mode === "shared") {
          fixtures.slowArchiveStarted?.();
          return new Promise<void>((resolve) =>
            setTimeout(resolve, fixtures.mode === "shared" ? 4000 : 6000),
          ).then(() => route.fulfill({ status: 404 }).catch(() => undefined));
        }
        return route.fulfill({ status: 404 });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          name: "bootstrap-fixture",
          owner: { login: "culverin" },
          private: fixtures.mode === "private",
          default_branch: fixtures.mode === "empty" ? null : "main",
          size: 2048,
        }),
      });
    },
  );

  await context.route(
    "https://api.github.com/repos/culverin/bootstrap-other**",
    (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          url.pathname.endsWith("/commits/main")
            ? { sha: publicSha }
            : {
                id: 2,
                name: "bootstrap-other",
                owner: { login: "culverin" },
                private: false,
                default_branch: "main",
              },
        ),
      });
    },
  );

  await page.route("https://github.com/culverin/bootstrap-fixture", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: repositoryFixture,
    }),
  );

  return fixtures;
}
