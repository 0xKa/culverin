import { handleArchiveHost } from "./host";
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) =>
  handleArchiveHost(message, sender, respond, false),
);
