# QuantumSwap Browser Extension

A Chrome + Firefox port of the QuantumSwap desktop wallet. It reuses the desktop
app's **entire** UI (HTML/CSS/JS/assets) unchanged and re-homes the Electron
"main process" IPC handlers into the extension popup, where the post-quantum
WebAssembly SDK runs.

- **Tooling:** [WXT](https://wxt.dev) (Manifest V3 for Chrome, MV2 for Firefox from a single codebase)
- **UI surface:** toolbar popup (`action.default_popup`)
- **Crypto:** the Go-compiled post-quantum WASM from `quantum-coin-js-sdk` runs directly in the popup

## Architecture

The desktop app has a clean split we exploit: the renderer only ever calls
`SomeApi.send(channel, data)` / `StorageApi.Get/SetItem`, never Node directly. We
keep every UI/renderer file byte-for-byte and replace only the transport + Node
"main process" layer.

```
Electron (before)                     Extension (after)
-----------------                     -----------------
renderer js  --Api.send-->  preload   renderer js  --Api.send-->  platform-bridge.js
             --ipc-->  index.js (Node)              --dispatch-->  handlers/* (browser + WASM)
```

- `public/` — the desktop UI, copied verbatim (`index.html`, `styles.css`,
  `js/**`, `lib/**`, `assets/**`, `json/**`). Served as the popup. It is **not**
  processed by Vite; the plain global `<script>` files keep their shared scope.
- `public/platform-bridge.js` — **generated** by `scripts/build-bridge.mjs`
  (esbuild). Loaded as the first `<script>` in `index.html`. It:
  - recreates the globals the Electron `preload.js` exposed
    (`CryptoApi`, `SwapQuoteApi`, `FileApi`, `ClipboardApi`, `ShellApi`,
    `LocalStorageApi`, `FormatApi`, `AppApi`, `SeedWordsApi`, `StorageApi`),
  - routes every `*.send(channel, data)` to an in-page handler registry
    (`src/bridge/dispatch.js`) instead of `ipcRenderer.invoke`,
  - bundles the SDKs (`quantumcoin`, `quantumswap`, `seed-words`) + the embedded
    Go WASM, with Node built-ins polyfilled for the browser.
- `src/bridge/handlers/**` — the ported bodies of the 47 `ipcMain.handle`
  channels (crypto, format, seedwords, swap quotes/submits, send, staking,
  offline signing, platform). Contract addresses, slippage/deadline math, gas
  estimation, and the staking ABI are preserved verbatim; only `require(...)`
  became `import`, and the local named-pipe/socket RPC paths were removed
  (browsers can only reach RPC over HTTP/S).
- Crypto is fully browser-native — no third-party runtime crypto libraries.
  `scrypt` and `randomBytes` come from `quantumcoin`'s native implementations
  (post-quantum WASM + Web Crypto), and AES-256-CBC in `src/bridge/handlers/crypto.js`
  uses the Web Crypto API (`crypto.subtle`), which applies PKCS#7 padding and is
  byte-compatible with Node (see `scripts/verify-crypto-parity.cjs`), so
  desktop-created wallets still decrypt here.
- `entrypoints/background.ts` — the service worker. It makes the toolbar action
  open the docked surface, and acts as the **dApp broker** for the web3 provider
  (`window.quantumcoin`): it opens approval popups, resolves page requests, and
  owns post-broadcast confirmation polling. The injected provider and page relay
  live in `entrypoints/injected.content.ts` (MAIN world) and
  `entrypoints/relay.content.ts` (isolated world).
- `public/icon/*.png` — the toolbar/store icons, generated from the same logo the
  Electron app uses (`quantumswap.svg`) by `scripts/build-icons.mjs`, and wired
  into `manifest.icons` / `action.default_icon` in `wxt.config.ts`.

### Why a separate esbuild step?

The legacy UI relies on classic global `<script>` files loaded in order and must
not be transformed. WXT/Vite would try to bundle those. So the UI stays static in
`public/`, and only the SDK/WASM bridge is bundled (by esbuild) into a single
self-executing `public/platform-bridge.js`, which WXT then copies like any other
static asset. This also cleanly injects the Node polyfills the SDKs need.

## Prerequisites

- Node.js 20+ (developed on Node 24)

## Install

```bash
npm install
```

`postinstall` runs `wxt prepare`.

## Build

```bash
npm run build          # Chrome + Firefox -> .output/chrome-mv3 + .output/firefox-mv2
npm run build:chrome   # Chrome only      -> .output/chrome-mv3
npm run build:firefox  # Firefox only     -> .output/firefox-mv2
```

`npm run build:all` is kept as an alias for `npm run build`. Each build first runs
`build:bridge` to (re)generate `public/platform-bridge.js`.

## Package

```bash
npm run zip            # .output/quantumswap-browser-extension-<ver>-chrome.zip
npm run zip:firefox    # firefox zip + AMO sources zip
```

## Test in Chrome

1. Build the Chrome target:

   ```bash
   npm install         # first time only (runs wxt prepare)
   npm run build:chrome   # -> .output/chrome-mv3
   ```

2. Open `chrome://extensions`.
3. Toggle **Developer mode** ON (top-right).
4. Click **Load unpacked** and select the `.output/chrome-mv3` folder.
5. "QuantumSwap Browser Extension" appears in the list. Pin it via the toolbar
   puzzle-piece icon for easy access.
6. Click the QuantumSwap toolbar icon to open the wallet popup. The first open
   runs the ~2s post-quantum WASM init.
7. To see logs/errors, right-click inside the popup → **Inspect** and watch the
   **Console** tab.

After changing code, Chrome does **not** auto-reload unpacked builds: run
`npm run build:chrome` again, then click the reload icon on the extension card.
(`npm run build:chrome` also re-bundles the SDK bridge, so edits under `src/bridge/**`
are picked up.)

## Test in Firefox

1. Build the Firefox target:

   ```bash
   npm install          # first time only
   npm run build:firefox   # -> .output/firefox-mv2
   ```

2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select the `manifest.json` inside the `.output/firefox-mv2` folder.
5. The extension loads and its icon appears in the toolbar; click it to open the
   wallet popup.
6. To see logs/errors, click **Inspect** next to the extension on the
   `about:debugging` page (opens DevTools for the popup/background).

Temporary add-ons are removed when Firefox closes, and Firefox does not
auto-reload unpacked builds: run `npm run build:firefox` again, then click
**Reload** on the `about:debugging` entry.

## Test the web3 dApp example page

The extension injects an EIP-1193-style provider (`window.quantumcoin`) into
web pages via a content script, so sites can connect, request signatures, and
send transactions through in-extension approval popups. `examples/dapp.html`
is a self-contained test page for that flow.

Content scripts only run on `http(s)://` pages (not `file://`), so the example
**must be served over HTTP**:

1. Build and load the extension (see [Test in Chrome](#test-in-chrome)); make
   sure you have created/restored a wallet in the popup first.
2. Serve the `examples/` folder over HTTP from the repo root, e.g.:

   ```bash
   npx serve examples          # then open the printed http://localhost:3000
   # or: python -m http.server 3000 --directory examples
   ```

3. Open `http://localhost:3000/dapp.html` in the browser where the extension is
   loaded. The page shows **Provider: ready** once `window.quantumcoin` is
   injected (otherwise confirm the extension is loaded and reload the page).
4. **Connect** — click **Connect Wallet**. A focused approval popup opens
   (`index.html?view=approval`); enter your wallet password, pick an account,
   and click **Sign & Connect**. The page logs the connected address and chain
   id, and enables the sign/send buttons.
5. **Sign a message** — edit the message field and click **Sign Message**. Enter
   your password in the approval popup and click **Sign**; the 0x signature blob
   is printed to the log.
6. **Send tokens/coins** — fill in the token contract, recipient address, and
   quantity, then click **Send Tokens** (or **Send Coins** for the native
   asset). Review the details in the approval popup, enter your password, and
   click **Sign & Send**. The page logs the returned `txHash`.
7. **Confirmation event** — after broadcast, the background service worker polls
   the scan API and emits a `transactionResult` event. To prove it fires
   independently of the popup, **close the approval popup right after signing**;
   the `event: transactionResult { ..., status }` line still appears in the log.
8. **Disconnect** — click **Disconnect** to revoke the site (`qc_disconnect`);
   the log shows `accountsChanged []` / `disconnect`.

Everything the page does is mirrored to the on-page **event / result log**, and
you can watch the background side under `chrome://extensions` → the extension's
**service worker** → **Inspect**.

## Smoke-test checklist (both browsers)

Work through these in the popup to confirm parity with the desktop app:

- **Create wallet** — accept EULA, generate a new seed, confirm it, set a
  passphrase; a new address should appear.
- **Restore** — from seed phrase and from an encrypted JSON file (a file exported
  from the desktop app decrypts here; the crypto is byte-compatible).
- **Balances / tokens / transactions** load on the home screen.
- **Copy address** (clipboard) and **open explorer link** (opens a new tab).
- **Send** coins and tokens.
- **Swap** — quote → approve/allowance → swap.
- **Staking** — deposit / withdraw / pause / resume.
- **Offline signing**, **QR display**, and **network switching**.
- **web3 dApp** — connect, sign a message, and send from `examples/dapp.html`
  (see [Test the web3 dApp example page](#test-the-web3-dapp-example-page)).

## Icons

The extension icon is generated from the Electron app logo
(`public/assets/svg/quantumswap.svg`), transparent background, to match the
desktop app. The PNGs in `public/icon/` are committed; regenerate them (e.g.
after changing the logo) with:

```bash
npm run build:icons
```

## Dev/verification scripts

- `node scripts/verify-crypto-parity.cjs` — asserts the browser-native AES-256-CBC
  (Web Crypto) matches Node byte-for-byte, so desktop-created keystores decrypt here.
- `node scripts/smoke-wasm.cjs` — loads the built bundle in a browser-like
  harness and exercises WASM init, wallet derivation, keystore encrypt/decrypt,
  and offline PQC transaction signing.

## Notes / known constraints

- **Popup size:** the popup is 625px wide x 600px tall. Chrome and Firefox clamp
  browser-action popups to a maximum height of ~600px, so the popup is sized to
  that ceiling (no outer vertical scroll); screens needing more room use their own
  inner scroll containers.
- **WASM re-init:** the popup document is recreated each time it opens, so the
  ~2s post-quantum WASM initialization runs on each open. The bridge starts it
  eagerly; handlers also await it (idempotent).
- **Networking:** RPC/scan/explorer endpoints must be HTTP(S). `host_permissions`
  is broad (`http://*/*`, `https://*/*`) because users can configure arbitrary
  custom-network endpoints.
- **Firefox manifest version:** WXT targets MV2 for Firefox by default (the most
  compatible option); Chrome uses MV3. Both apply
  `script-src 'self' 'wasm-unsafe-eval'`.
