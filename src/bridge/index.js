// Platform bridge for the QuantumSwap browser extension.
//
// Built by scripts/build-bridge.mjs into public/platform-bridge.js and loaded as
// the FIRST classic <script> in public/index.html, so these globals exist before
// any of the ported renderer scripts (js/*.js) run. It recreates exactly the
// globals the Electron preload.js exposed, but routes *.send(channel, data) to a
// local in-page handler registry (dispatch) instead of ipcRenderer.invoke.
import { dispatch } from "./dispatch.js";
import { Initialize } from "quantumcoin/config";
import { RECOGNIZED_TOKEN_CONTRACT_ADDRESSES } from "./token-constants.js";
import { BUILTIN_SWAP_RELEASES } from "./release-constants.js";

const noop = () => {};

// send: (channel, data) => Promise, matching the desktop preload contract.
function makeApi() {
  return { send: (channel, data) => dispatch(channel, data), handle: noop };
}

// Single-source token constants (src/bridge/token-constants.js). This bundle is
// the first classic script in index.html, so the list exists before
// js/tokenfilter.js (and every other UI script) runs.
window.RECOGNIZED_TOKEN_CONTRACT_ADDRESSES = RECOGNIZED_TOKEN_CONTRACT_ADDRESSES;

// Built-in swap releases (src/bridge/release-constants.js). public/js/release.js
// seeds its storage-backed release list from this.
window.BUILTIN_SWAP_RELEASES = BUILTIN_SWAP_RELEASES;

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

// Cross-surface serialization (DUR-04). The wallet UI can be open at the same
// time as the side panel, the toolbar popup, a full tab, and the separate dApp
// approval popup -- all same-origin and all sharing window.localStorage. The Web
// Locks API serializes critical sections across every same-origin extension
// surface (available in Chrome and Firefox 121+). Two distinct lock names are
// used with a strict acquire order (VAULT outer, STORAGE_IO inner): the
// higher-level wallet-store mutations take QC_LOCK_VAULT, and each StorageApi
// write takes QC_LOCK_STORAGE_IO. StorageApi never takes QC_LOCK_VAULT, so the
// ordering is consistent and nested locking cannot deadlock.
const QC_LOCK_VAULT = "qc-vault";
const QC_LOCK_STORAGE_IO = "qc-storage-io";

function qcWithLock(name, fn) {
  if (navigator.locks && typeof navigator.locks.request === "function") {
    return navigator.locks.request(name, fn);
  }
  // Engines without the Web Locks API fall back to no cross-surface locking.
  return Promise.resolve().then(fn);
}

window.qcWithLock = qcWithLock;
window.QC_LOCK_VAULT = QC_LOCK_VAULT;
window.QC_LOCK_STORAGE_IO = QC_LOCK_STORAGE_IO;

// StorageApi kept its Electron shape (localStorage wrappers). SetItem now returns
// a Promise because it serializes on QC_LOCK_STORAGE_IO; all callers already
// await it. GetItem stays synchronous (single-key reads are atomic).
window.StorageApi = {
  SetItem: function (key, value) {
    return qcWithLock(QC_LOCK_STORAGE_IO, function () {
      window.localStorage.setItem(key, JSON.stringify(value));
      return window.localStorage.getItem(key);
    });
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
