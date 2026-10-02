import {
  validSettingsReply,
  type SettingsCommand,
  type SettingsReply,
  type SettingsRequest,
} from "../protocol/settings";

export function sendSettings(
  command: SettingsCommand,
): Promise<SettingsReply | undefined> {
  const request: SettingsRequest = {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    navigationId: crypto.randomUUID(),
    ...command,
  };
  return new Promise<SettingsReply | undefined>((resolve) => {
    try {
      chrome.runtime.sendMessage(request, (reply: unknown) => {
        resolve(
          !chrome.runtime.lastError &&
            validSettingsReply(reply, request.requestId, request.navigationId)
            ? reply
            : undefined,
        );
      });
    } catch {
      resolve(undefined);
    }
  });
}
