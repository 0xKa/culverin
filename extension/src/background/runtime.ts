import {
  handleArchiveCounting,
  handleGithub,
  initializeGitHub,
} from "./github";
type Handler = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
) => boolean;
let started = false;
export function startBackground(additionalHandler?: Handler): void {
  if (started) return;
  started = true;
  initializeGitHub();
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (handleArchiveCounting(message, sender)) return false;
    if (handleGithub(message, sender, respond)) return true;
    return additionalHandler?.(message, sender, respond) ?? false;
  });
}
