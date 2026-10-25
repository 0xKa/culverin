import { buttonClass } from "../ui/Button";
import chromeWebStore from "../ui/chrome-web-store.svg";
import { ExternalLink } from "../ui/ExternalLink";
import { GitHubMark } from "../ui/GitHubMark";
import { REPOSITORY_URL, REVIEWS_URL } from "./about";

export function SupportLinks() {
  return (
    <div className="flex flex-wrap gap-2 md:mt-auto md:flex-col md:[@media(min-height:40rem)]:sticky md:[@media(min-height:40rem)]:bottom-16">
      <ExternalLink
        href={REVIEWS_URL}
        className={buttonClass("md", "secondary")}
      >
        <img src={chromeWebStore} alt="" width={16} height={16} />
        Rate on Web Store
      </ExternalLink>
      <ExternalLink
        href={REPOSITORY_URL}
        className={buttonClass("md", "secondary")}
      >
        <GitHubMark />
        Star on GitHub
      </ExternalLink>
    </div>
  );
}
