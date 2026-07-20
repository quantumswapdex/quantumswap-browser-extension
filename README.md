# QuantumSwap Browser Extension

A Chrome + Firefox port of the QuantumSwap desktop wallet. The renderer is a
native TypeScript port of the desktop wallet's UI architecture (ScreenModule +
`el()` DOM builder + core/impure split), and the Electron "main process" IPC
handlers are re-homed into the extension pages, where the post-quantum
WebAssembly SDK runs.

- **Tooling:** [WXT](https://wxt.dev) (Manifest V3 for Chrome, MV2 for Firefox from a single codebase)
- **UI surfaces:** side panel / sidebar (docked, default), toolbar popup, detached window and full tab — all served from the same `index.html`
- **Crypto:** the Go-compiled post-quantum WASM from `quantum-coin-js-sdk` runs directly in the popup
- **Anti-phishing:** per-user [Spoof Buster Words](#spoof-buster-words) shown
  before every dApp approval, with randomized training rounds
- **dApp approvals:** hosted in the browser side panel (UI a web page cannot
  spoof); a small redirector popup guides the user there

## Table of contents

- [Architecture](#architecture)
  - [Why a separate esbuild step?](#why-a-separate-esbuild-step)
- [Spoof Buster Words](#spoof-buster-words)
  - [What it is](#what-it-is)
  - [Why it is needed](#why-it-is-needed)
  - [How it works](#how-it-works)
  - [Random training rounds (1-in-10 sampling)](#random-training-rounds-1-in-10-sampling)
  - [Negative cases (what happens when the check fails)](#negative-cases-what-happens-when-the-check-fails)
  - [Storage](#storage)
- [dApp approval flow (side panel)](#dapp-approval-flow-side-panel)
- [Building a dApp](#building-a-dapp)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Build](#build)
- [Package](#package)
- [Test in Chrome](#test-in-chrome)
- [Test in Firefox](#test-in-firefox)
- [Test the web3 dApp example page](#test-the-web3-dapp-example-page)
- [Smoke-test checklist (both browsers)](#smoke-test-checklist-both-browsers)
- [Icons](#icons)
- [Dev/verification scripts](#devverification-scripts)
- [Notes / known constraints](#notes--known-constraints)

## Architecture

The desktop app has a clean split we make use of: the renderer only ever calls
`SomeApi.send(channel, data)` / `StorageApi.Get/SetItem`, never Node directly. The
renderer is ported to the extension as native TypeScript (same screen modules,
app controllers and lib layers as the desktop `src/`), and only the transport +
Node "main process" layer is replaced.

```
Electron (desktop)                     Extension
------------------                     ---------
renderer ts  --Api.send-->  preload    renderer ts  --Api.send-->  platform-bridge.js
             --ipc-->  main (Node)                  --dispatch-->  handlers/* (browser + WASM)
```

- `entrypoints/index/` — the wallet UI entry (`index.html` + `main.ts`
  bootstrap mirroring the desktop `src/renderer.ts`). The same page serves all
  four surfaces via `?view=panel|popup|window|tab`. `entrypoints/approve/` is
  the dApp approval page (`approve.html?requestId=...`); it hosts the full
  approval flow when rendered in the side panel (`&view=panel`) or a popup,
  and doubles as the redirector/notice popup via `?mode=open-panel|notice`.
- `src/screens`, `src/dialogs`, `src/app`, `src/lib`, `src/ui` — the renderer,
  ported from the desktop wallet: `el()`-built screen modules, per-domain app
  controllers with pure `*-core.ts` logic, and the typed `lib/bridge.ts`
  wrappers over the `*Api.send` surface.
- `public/` — static assets only (`styles.css` + themes, fonts, icons,
  `json/**`).
- `public/platform-bridge.js` — **generated** by `scripts/build-bridge.mjs`
  (esbuild). Loaded as the first `<script>` in each entrypoint HTML. It:
  - recreates the globals the Electron `preload.ts` exposed
    (`CryptoApi`, `SwapQuoteApi`, `FileApi`, `ClipboardApi`, `ShellApi`,
    `LocalStorageApi`, `FormatApi`, `AppApi`, `SeedWordsApi`, `StorageApi`),
  - routes every `*.send(channel, data)` to an in-page handler registry
    (`src/platform/dispatch.ts`) instead of `ipcRenderer.invoke`,
  - bundles the SDKs (`quantumcoin`, `quantumswap`, `seed-words`) + the embedded
    Go WASM, with Node built-ins polyfilled for the browser.
- `src/platform/handlers/**` — the ported bodies of the `ipcMain.handle`
  channels (crypto, format, seedwords, swap quotes/submits, send, platform).
  Contract addresses, slippage/deadline math, and gas estimation are preserved
  verbatim; the local named-pipe/socket RPC paths were removed (browsers can
  only reach RPC over HTTP/S).
- Crypto is fully browser-native — no third-party runtime crypto libraries.
  `scrypt` and `randomBytes` come from `quantumcoin`'s native implementations
  (post-quantum WASM + Web Crypto), and the storage vault uses AES-256-GCM via
  the Web Crypto API (`crypto.subtle`) with an atomic `{salt, payload}` main-key
  record; existing extension vaults keep unlocking unchanged (golden
  byte-compatibility tests live in `src/lib/storage.test.ts`).
- `entrypoints/background.ts` — the service worker. It makes the toolbar action
  open the docked surface, and acts as the **dApp broker** for the web3 provider
  (`window.quantumcoin`): it validates and routes approval requests to the side
  panel (see [dApp approval flow](#dapp-approval-flow-side-panel)), resolves
  page requests, rate-limits the read-RPC passthrough per origin, and owns
  post-broadcast confirmation polling. The injected provider and page relay
  live in `entrypoints/injected.content.ts` (MAIN world) and
  `entrypoints/relay.content.ts` (isolated world).
- `src/app/spoofbuster.ts` (+ `src/app/spoofbuster-wordlist.ts`, the bundled
  BIP-39 English wordlist) — the Spoof Buster Words feature: word generation,
  storage, the unlock slider, the settings dialog, and the approval gate
  helpers used by `src/approval/dapp.ts`.
- `public/icon/*.png` — the toolbar/store icons, generated from the same logo the
  Electron app uses (`quantumswap.svg`) by `scripts/build-icons.mjs`, and wired
  into `manifest.icons` / `action.default_icon` in `wxt.config.ts`.

### Why a separate esbuild step?

The renderer TypeScript is bundled by WXT/Vite, but the SDK + Go WASM bridge is
kept as a separate esbuild bundle (`public/platform-bridge.js`, a classic
self-executing script loaded before the module entry). This cleanly injects the
Node polyfills the SDKs need, keeps the 3.6 MB WASM payload out of the Vite
graph, and guarantees the `*Api` globals exist before any renderer module runs.

## Spoof Buster Words

### What it is

An anti-phishing mechanism unique to this wallet. During onboarding the wallet
generates **three random words** (from the 2048-word BIP-39 English wordlist),
shows them as colored chips on the last welcome step, and quizzes the user on
them in the final safety-quiz step. The words are the secret; the chip colors
are position-based, fixed and identical for all users — purely a
readability/recognition aid.

### Why it is needed

A malicious website can open a window (or draw an overlay) that pixel-perfectly
imitates the wallet's approval popup and harvest the password the user types
into it. What a fake window **cannot** do is read this extension's local
storage — so it cannot know the user's three words. Showing the words at the
start of every genuine approval gives the user a proof-of-authenticity check
that no look-alike window can pass: wrong words, or no words at all, mean the
window is fake.

### How it works

Before any dApp approval renders (connect, sign message, send transaction), a
gate shows three word chips and a single consciously-selected option:

1. The user compares the chips against their memorized words.
2. If they match, the user ticks **"Correct - these are my words"** (unchecked
   by default; there is deliberately no "Incorrect" option) and clicks
   **Next**. Only then does the actual approval screen render.
3. If they do **not** match, the explanation under the option instructs the
   user to **close the side panel immediately** — the only safe response to a
   suspected fake window, and the same muscle memory that protects them against
   a real spoof. Closing the panel makes the background broker auto-reject the
   pending request.

Clicking **Next** without ticking the box does not proceed; it re-states the
instruction (select Correct, or close the panel if the words are wrong).

To keep the words fresh in memory, a slide-up banner re-shows them after every
unlock, and **Settings > Spoof Buster Words** displays them on demand.

### Random training rounds (1-in-10 sampling)

Users get no practice against an attack they have never seen, so the wallet
drills them: **each approval has a 1-in-10 chance** (uniform, via a
rejection-sampled `crypto.getRandomValues` roll — see `spoofRandomInt` in
`src/app/spoofbuster.ts`) of being a training round instead of a real gate. A
training round then splits 50/50 between two methods:

- **Method A — decoy words.** The gate renders normally but shows three random
  words that are guaranteed not to be the user's (drawn from the wordlist
  excluding the real words). The right response is the trained one: close the
  panel.
- **Method B — no gate at all.** The approval screen renders directly, exactly
  what a spoofed window would do. The right response is to notice the missing
  word check and reject or close without engaging.

Every training round rejects the dApp request regardless of what the user does;
the user simply retries the action on the dApp (this is why the example-page
instructions say "roughly 1 in 10 approvals is a drill — just retry").

### Negative cases (what happens when the check fails)

- **Method A, user confirms decoy words:** the mistake being taught. An
  educational dialog explains that the words shown were not theirs and that a
  mismatch means the window is fake. The dialog **cannot be dismissed** — it
  has no OK button and blocks Escape — and instructs the user to close the
  extension window and reopen it from the toolbar. The request is rejected the
  moment the dialog appears. Falling through to any wallet/unlock UI is
  deliberately impossible: landing on a password prompt right after a failed
  word check is exactly what a spoofed flow would want next.
- **Method B, user engages:** touching the password field or clicking Approve
  on the gate-less screen triggers the same non-dismissable educational dialog
  ("never enter your password unless you saw and confirmed your words first").
  Clicking Reject instead shows a "good catch" confirmation (also terminal).
- **Real round, words don't match:** there is no in-UI path — the user closes
  the panel as instructed, and the background auto-rejects the request. If they
  are unsure of their words, they can unlock the wallet afterwards and check
  **Settings > Spoof Buster Words**.
- **Closing the surface at any point** without acting rejects the pending
  request; nothing is ever approved by default.

### Storage

The words are stored locally, unencrypted **by design**: they gate nothing
cryptographic and must be displayable before unlock (only the words themselves
are secret, from websites — not from the device owner). They never leave the
device and are unrelated to the seed phrase or password.

## dApp approval flow (side panel)

Approvals are hosted in the **side panel** (Chrome) / **sidebar** (Firefox) —
browser chrome a web page cannot draw over — rather than in a free-floating
popup a page could imitate:

- **Panel already open:** the request is routed straight to it; a small
  auto-closing notice popup points the user there.
- **Panel closed (Chrome):** a centered redirector popup explains that genuine
  approvals happen only in the side panel; its button opens the panel with the
  click's user gesture and the flow continues there.
- **Firefox with the sidebar closed:** `sidebarAction.open()` cannot be invoked
  from a detached popup, so the full approval flow (Spoof Buster gate included)
  runs in the popup window itself.

Closing the surface without acting rejects the request; routed requests that
are never picked up are auto-rejected after a timeout so they cannot block
future approvals. One approval is in flight at a time, with per-origin
open/reject throttles against approval-fatigue attacks. Plain-HTTP origins
(other than localhost) get a prominent insecure-origin warning in the approval
card.

## Building a dApp

Websites can connect to the wallet through an Ethereum-like, EIP-1193-style
provider injected at `window.quantumcoin` (for the QuantumCoin network, with
32-byte addresses and `qc_*` methods). It lets a site connect an account, request
signatures, send coins/tokens, deploy contracts, and read chain state — all with
signing confined to the wallet's side-panel approval flow (with the Spoof
Buster anti-phishing gate).

**→ See the [dApp Developer Guide](README-DAPP.md)** for the full provider API,
every supported method and event, and copy-paste examples.

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
(`npm run build:chrome` also re-bundles the SDK bridge, so edits under
`src/platform/**` are picked up.)

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
send transactions through the side-panel approval flow. `examples/dapp.html`
is a self-contained test page for that flow.

For building your own dApp against `window.quantumcoin`, see the
[dApp Developer Guide](README-DAPP.md).

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
4. **Connect** — click **Connect Wallet**. If the side panel is closed, a small
   redirector popup opens; click **Open side panel & continue** and the approval
   renders in the panel (if the panel is already open, it is routed there
   directly). Confirm your **Spoof Buster words**, enter your wallet password,
   pick an account, and click **Sign & Connect**. The page logs the connected
   address and chain id, and enables the sign/send buttons. (Roughly 1 in 10
   approvals is a training drill that rejects the request — just retry.)
5. **Sign a message** — edit the message field and click **Sign Message**.
   Confirm the words, enter your password in the approval surface, and click
   **Sign**; the 0x signature blob is printed to the log.
6. **Send tokens/coins** — fill in the token contract, recipient address, and
   quantity, then click **Send Tokens** (or **Send Coins** for the native
   asset). Review the details in the approval surface, enter your password, and
   click **Sign & Send**. The page logs the returned `txHash`.
7. **Confirmation event** — after broadcast, the background service worker polls
   the scan API and emits a `transactionResult` event. To prove it fires
   independently of the approval surface, **close it right after signing**;
   the `event: transactionResult { ..., status }` line still appears in the log.
8. **Disconnect** — click **Disconnect** to revoke the site (`qc_disconnect`);
   the log shows `accountsChanged []` / `disconnect`.

Everything the page does is mirrored to the on-page **event / result log**, and
you can watch the background side under `chrome://extensions` → the extension's
**service worker** → **Inspect**.

## Smoke-test checklist (both browsers)

Work through these in the popup to confirm parity with the desktop app:

- **Create wallet** — accept EULA, read the welcome steps (the last one shows
  your **Spoof Buster words**), pass the safety quiz (the final question asks
  for your words), generate a new seed, confirm it, set a passphrase; a new
  address should appear.
- **Unlock** — the slide-up banner re-shows the Spoof Buster words.
- **Restore** — from seed phrase and from an encrypted JSON file (a file exported
  from the desktop app decrypts here; the crypto is byte-compatible).
- **Balances / tokens / transactions** load on the home screen.
- **Copy address** (clipboard) and **open explorer link** (opens a new tab).
- **Send** coins and tokens — the action button stays enabled while gas is
  estimated; clicking early shows "Please wait, estimating gas..." and then
  proceeds to review.
- **Swap** — quote → approve/allowance → swap.
- **QR display** and **network switching**.
- **Settings** — Wallet Path, Networks, Releases, Signing, and **Spoof Buster
  Words** (shows the stored words). The burger menu links to Builder /
  QuantumSwap / QuantumCoin and the **Privacy Policy**.
- **web3 dApp** — connect, sign a message, and send from `examples/dapp.html`,
  confirming the Spoof Buster gate in the side panel each time
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

- `npm run typecheck` / `npm run lint` / `npm test` — strict `tsc`, ESLint
  (HTML-injection sinks banned) and the vitest core suites, including the
  golden storage byte-compatibility tests (`src/lib/storage.test.ts`).
- `node scripts/smoke-wasm.cjs` — loads the built bundle in a browser-like
  harness and exercises WASM init, wallet derivation, and keystore
  encrypt/decrypt.

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
  `script-src 'self' 'wasm-unsafe-eval'` (required for the embedded Go WASM; no
  remote code is loaded anywhere).
- **Gas estimation UX:** action buttons stay enabled while gas is being
  estimated. If the user clicks before the estimate lands (and has not manually
  overridden gas), a "Please wait, estimating gas..." dialog shows, then the
  flow proceeds to review automatically.
- **Privacy:** the extension collects no user data and talks only to the
  blockchain endpoints the user configures. The policy is hosted at
  <https://quantumswap.com/browser-extension-privacy-policy.html> and linked
  from the burger menu (**Privacy Policy**).
