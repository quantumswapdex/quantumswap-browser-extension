// Platform bridge for the QuantumSwap browser extension.
//
// Built by scripts/build-bridge.mjs into public/platform-bridge.js and loaded as
// the FIRST classic <script> in public/index.html, so these globals exist before
// any of the ported renderer scripts (js/*.js) run. It recreates exactly the
// globals the Electron preload.js exposed, but routes *.send(channel, data) to a
// local in-page handler registry (dispatch) instead of ipcRenderer.invoke.
import { dispatch } from "./dispatch.js";
import { Initialize } from "quantumcoin/config";

const noop = () => {};

// send: (channel, data) => Promise, matching the desktop preload contract.
function makeApi() {
  return { send: (channel, data) => dispatch(channel, data), handle: noop };
}

// APIs that were exposed via contextBridge in the desktop preload.js.
window.CryptoApi = makeApi();
window.SwapQuoteApi = makeApi();
window.FileApi = makeApi();
window.ClipboardApi = makeApi();
window.ShellApi = makeApi();
window.LocalStorageApi = makeApi();
window.FormatApi = makeApi();
window.AppApi = makeApi();
window.SeedWordsApi = makeApi();

// StorageApi kept its Electron shape (synchronous localStorage wrappers). In the
// popup document window.localStorage is available and persistent per extension.
window.StorageApi = {
  SetItem: function (key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
    return window.localStorage.getItem(key);
  },
  GetItem: function (key) {
    return window.localStorage.getItem(key);
  },
};

// Kick off the post-quantum WASM initialization eagerly so it is ready (or nearly
// ready) by the time the user performs their first wallet action. Handlers also
// call Initialize() defensively, and it is idempotent.
Initialize(null).catch((err) => {
  console.error("QuantumSwap SDK initialization failed:", err);
});
