const output = document.querySelector<HTMLElement>("#status")!;
const button = document.querySelector<HTMLButtonElement>("#clear-public")!;

button.addEventListener("click", () => {
  chrome.runtime.sendMessage(
    {
      protocolVersion: 1,
      type: "cache.clear-public",
      requestId: crypto.randomUUID(),
      navigationId: crypto.randomUUID(),
    },
    (reply: { state?: string } | undefined) => {
      output.textContent =
        !chrome.runtime.lastError && reply?.state === "public-cache-cleared"
          ? "Public cache cleared."
          : "Extension unavailable. Try again.";
    },
  );
});
