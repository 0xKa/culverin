import { handleArchiveHost, listenForArchiveData } from "./host";
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) =>
  handleArchiveHost(message, sender, respond, false),
);
listenForArchiveData();
