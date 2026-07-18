// Channel -> handler registry. Replaces Electron's ipcMain.handle routing. Channel
// names are globally unique across the desktop app, so a single dispatch works for
// every *Api.send(channel, data) call the renderer makes.
import formatHandlers from "./handlers/format";
import seedwordsHandlers from "./handlers/seedwords";
import cryptoHandlers from "./handlers/crypto";
import platformHandlers from "./handlers/platform";
import chainHandlers from "./handlers/chain";

export type IpcHandler = (data: any) => Promise<any>;

const registry: Record<string, IpcHandler> = {
    ...formatHandlers,
    ...seedwordsHandlers,
    ...cryptoHandlers,
    ...platformHandlers,
    ...chainHandlers,
};

export async function dispatch(channel: string, data?: unknown): Promise<any> {
    const handler = registry[channel];
    if (typeof handler !== "function") {
        throw new Error("Unknown IPC channel: " + channel);
    }
    return handler(data);
}
