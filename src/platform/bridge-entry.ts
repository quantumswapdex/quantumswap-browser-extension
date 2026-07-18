// Platform bridge for the QuantumSwap browser extension.
//
// Built by scripts/build-bridge.mjs into public/platform-bridge.js and loaded as
// the FIRST classic <script> in the wallet/approval HTML, so these globals exist
// before the Vite-bundled renderer module runs. It recreates exactly the globals
// the Electron preload.ts exposes on desktop, but routes *.send(channel, data)
// to a local in-page handler registry (dispatch) instead of ipcRenderer.invoke.
import { dispatch } from "./dispatch";
import { Initialize } from "quantumcoin/config";

const noop = () => {};

interface IpcApi {
    send(channel: string, data?: unknown): Promise<any>;
    handle(): void;
}

// send: (channel, data) => Promise, matching the desktop preload contract.
function makeApi(): IpcApi {
    return { send: (channel: string, data?: unknown) => dispatch(channel, data), handle: noop };
}

const w = window as any;

// APIs that are exposed via contextBridge in the desktop preload.ts.
w.CryptoApi = makeApi();
w.SwapQuoteApi = makeApi();
w.FileApi = makeApi();
w.ClipboardApi = makeApi();
w.ShellApi = makeApi();
w.LocalStorageApi = makeApi();
w.FormatApi = makeApi();
w.AppApi = makeApi();
w.SeedWordsApi = makeApi();

// Kick off the post-quantum WASM initialization eagerly so it is ready (or nearly
// ready) by the time the user performs their first wallet action. Handlers also
// call Initialize() defensively, and it is idempotent.
Initialize(null).catch((err: unknown) => {
    console.error("QuantumSwap SDK initialization failed:", err);
});
