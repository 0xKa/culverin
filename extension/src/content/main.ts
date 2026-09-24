chrome.runtime.sendMessage({ type: "bootstrap.ping" }, (response: unknown) => {
  if (chrome.runtime.lastError) return;
  if (
    typeof response === "object" &&
    response !== null &&
    "version" in response &&
    response.version === "0.1.0"
  ) {
    document.documentElement.dataset.culverinBootstrap = "loaded";
  }
});
