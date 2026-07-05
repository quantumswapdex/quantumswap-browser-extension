// Channel -> handler registry. Replaces Electron's ipcMain.handle routing. Channel
// names are globally unique across the desktop app, so a single dispatch works for
// every *Api.send(channel, data) call the renderer makes.
import formatHandlers from "./handlers/format.js";
import seedwordsHandlers from "./handlers/seedwords.js";
import cryptoHandlers from "./handlers/crypto.js";
import platformHandlers from "./handlers/platform.js";
import chainHandlers from "./handlers/chain.js";

const registry = {
  ...formatHandlers,
  ...seedwordsHandlers,
  ...cryptoHandlers,
  ...platformHandlers,
  ...chainHandlers,
};

export async function dispatch(channel, data) {
  const handler = registry[channel];
  if (typeof handler !== "function") {
    throw new Error("Unknown IPC channel: " + channel);
  }
  return await handler(data);
}
