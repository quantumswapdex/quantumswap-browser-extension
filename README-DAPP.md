# QuantumSwap dApp Developer Guide

This guide shows you how to connect a website to the **QuantumSwap wallet**
browser extension and use it to read blockchain data, request signatures, send
coins/tokens, and deploy contracts on the **QuantumCoin** network.

If you have ever integrated an Ethereum wallet, this will feel familiar: the
extension injects an **EIP-1193-style provider** at `window.quantumcoin`, and you
talk to it with `provider.request({ method, params })` and `provider.on(event, ...)`.
The important differences from Ethereum are called out in
[Key differences from Ethereum](#key-differences-from-ethereum).

It is written for developers who are new to wallet integration: every method has
a copy-paste example, and there is a runnable reference page at
[`examples/dapp.html`](examples/dapp.html) (driver:
[`examples/dapp.js`](examples/dapp.js)).

---

## Table of contents

- [How it works](#how-it-works)
- [Key differences from Ethereum](#key-differences-from-ethereum)
- [Prerequisites](#prerequisites)
- [Detecting the provider](#detecting-the-provider)
- [The core API](#the-core-api)
- [Addresses, amounts, and units](#addresses-amounts-and-units)
- [Method reference](#method-reference)
  - [qc_requestAccounts](#qc_requestaccounts)
  - [qc_accounts](#qc_accounts)
  - [qc_chainId](#qc_chainid)
  - [qc_getNetwork](#qc_getnetwork)
  - [qc_signMessage](#qc_signmessage)
  - [qc_sendTransaction](#qc_sendtransaction)
  - [qc_disconnect](#qc_disconnect)
  - [Read-only JSON-RPC passthrough](#read-only-json-rpc-passthrough)
- [Events](#events)
- [Step-by-step walkthroughs](#step-by-step-walkthroughs)
- [Error handling](#error-handling)
- [Using with standard Ethereum tooling](#using-with-standard-ethereum-tooling)
- [Security model](#security-model)
- [Try it: the example page](#try-it-the-example-page)
- [Troubleshooting](#troubleshooting)

---

## How it works

- When the extension is installed and the user has created/restored a wallet, it
  injects a provider object at `window.quantumcoin` into every `http(s)://` page.
- Your page calls `window.quantumcoin.request(...)`. Read calls are answered
  immediately; anything that needs the user's approval (connecting, signing,
  sending) opens a focused **wallet approval popup**.
- The user reviews and confirms in that popup (entering their password). Your
  page never sees the password or the private keys.
- The result (an address, a signature, a transaction hash, ...) is returned to
  your `request(...)` promise, and follow-up **events** (like a mined
  transaction) are delivered to your `provider.on(...)` listeners.

```
your page  --request()-->  window.quantumcoin  --->  extension  --->  approval popup (user confirms)
   ^                                                                   |
   +----------------------- result / events --------------------------+
```

---

## Key differences from Ethereum

Read this first; it prevents the most common mistakes.

- **32-byte addresses.** QuantumCoin addresses are 32 bytes: `0x` followed by
  **64 hex characters**. A normal 20-byte (40-hex) Ethereum address is **rejected**
  with a clear error.
- **`qc_*` method namespace.** Wallet actions use `qc_` methods (for example
  `qc_requestAccounts`, `qc_sendTransaction`). A few Ethereum names are aliased for
  convenience (see [tooling](#using-with-standard-ethereum-tooling)).
- **Transfers use `qc_sendTransaction`.** Native coin and ERC20 token transfers
  both go through `qc_sendTransaction` (the `eth_sendTransaction` equivalent):
  native via the `value` field, tokens via ERC20 `transfer(...)` calldata to the
  contract. Its `value` field is **wei** (hex like `"0x0"` or a decimal-wei
  string). This is the only send path, and it is decode-and-verified (WYSIWYS)
  before signing.
- **`chainId` type.** `qc_chainId` returns a **number** (for example `123123`).
  The `chainChanged` event and the `eth_chainId` read method return a **hex
  string** (for example `"0x1e0f3"`). Don't mix them up.

---

## Prerequisites

1. **Install the extension** and create or restore a wallet in it. See the main
   [README.md](README.md) for build/load steps (Chrome and Firefox).
2. **Serve your site over HTTP(S).** Content scripts do not run on `file://`
   pages, so the provider is not injected there. During development:

   ```bash
   npx serve .            # or: python -m http.server 3000
   ```

3. Open your page in the browser where the extension is loaded.

---

## Detecting the provider

The provider is injected at page start, but to be safe also listen for the
`quantumcoin#initialized` event (fired when the provider becomes available):

```js
function getProvider() {
  return window.quantumcoin || null;
}

function whenProviderReady(cb) {
  if (getProvider()) { cb(getProvider()); return; }
  window.addEventListener("quantumcoin#initialized", function () {
    if (getProvider()) cb(getProvider());
  });
}

whenProviderReady(function (provider) {
  console.log("QuantumCoin provider ready:", provider.isQuantumCoin); // true
});
```

A robust helper that surfaces a clear message instead of failing silently:

```js
function requireProvider() {
  var provider = getProvider();
  if (!provider) {
    alert("No QuantumCoin provider found. Install/enable the QuantumSwap extension, then reload.");
    return null;
  }
  return provider;
}
```

You can identify the provider with the `isQuantumCoin === true` flag.

---

## The core API

The provider exposes:

| Member | Description |
| --- | --- |
| `request({ method, params })` | Returns a `Promise`. Resolves with the result, or **rejects with an `Error`** whose `.message` explains why. |
| `on(event, handler)` | Subscribe to an event. Alias: `addListener`. |
| `removeListener(event, handler)` | Unsubscribe. Alias: `off`. |
| `removeAllListeners(event?)` | Remove all listeners (optionally for one event). |
| `enable()` | Shortcut for `request({ method: "qc_requestAccounts" })`. |
| `isQuantumCoin` | `true` for this provider. |

```js
const provider = window.quantumcoin;

// A request:
const accounts = await provider.request({ method: "qc_requestAccounts" });

// An event:
provider.on("accountsChanged", (accounts) => console.log("accounts:", accounts));
```

`params` shape depends on the method:

- Wallet (`qc_*`) methods take an **object** (for example `{ message }`,
  `{ to, amount }`), or no params.
- Read-only `eth_*` methods take a **positional array** (the Ethereum JSON-RPC
  convention), for example `["0x<txhash>"]`.

---

## Addresses, amounts, and units

- **Address format:** `0x` + 64 hex chars (32 bytes). Example:
  `0x0e49c26cd1ca19bf8dda2c8985b96783288458754757f4c9e00a5439a7291628`.
- **`qc_sendTransaction` `value`:** wei. Accepts a hex string (`"0x0"`,
  `"0x16345785d8a0000"`) or a decimal-wei string. Use `"0x0"` for no value. This
  is the field used for native coin transfers; token transfers carry the amount in
  the ERC20 `transfer(...)` calldata instead.
- **`data` / `bytecode`:** `0x`-prefixed hex; `data` must have an even number of
  hex digits.

---

## Method reference

Every method is called via `provider.request({ method, params })`. Methods that
require the user are noted; they open the approval popup and reject with
`User rejected the request` if the user closes it without approving.

### qc_requestAccounts

Connect the site and get the active account. Opens the approval popup the first
time (the user picks an account and approves); afterwards returns the connected
account without a popup.

- **Params:** none.
- **Returns:** `string[]` — an array with the connected address, e.g.
  `["0x<64-hex>"]`.
- **Aliases:** `eth_requestAccounts`, and `provider.enable()`.

```js
const accounts = await provider.request({ method: "qc_requestAccounts" });
const account = accounts[0];
```

### qc_accounts

Get the currently connected account **without** prompting.

- **Params:** none.
- **Returns:** `string[]` — `["0x<64-hex>"]` if connected, else `[]`.
- **Alias:** `eth_accounts`.

```js
const [account] = await provider.request({ method: "qc_accounts" });
if (!account) console.log("not connected yet");
```

### qc_chainId

- **Params:** none.
- **Returns:** `number` chain id (e.g. `123123`), or `null` if not connected.

```js
const chainId = await provider.request({ method: "qc_chainId" }); // 123123
```

> Note: this is a number. For a hex chain id use the `eth_chainId` read method or
> the `chainChanged` event.

### qc_getNetwork

- **Params:** none.
- **Returns:** the active network descriptor, or `null` if not connected:

  ```ts
  {
    name: string,
    chainId: number,
    scanApiDomain: string,
    blockExplorerDomain: string,
    rpcEndpoint: string,
    index: number
  }
  ```

```js
const net = await provider.request({ method: "qc_getNetwork" });
console.log(net.name, net.chainId, net.blockExplorerDomain);
```

### qc_signMessage

Sign an arbitrary text message. **Requires connection.** Opens the approval popup.

- **Params:** `{ message: string }` — must be a non-empty string.
- **Returns:** `string` — the signature (`0x...`).

```js
const signature = await provider.request({
  method: "qc_signMessage",
  params: { message: "Hello from my dApp!" }
});
```

### qc_sendTransaction

The general-purpose transaction method: call a contract method or **deploy** a
contract. **Requires connection.** Opens the approval popup.

- **Params:**
  - `to?: string` — target contract/account. **Omit `to` to deploy** a contract.
  - `data?: string` — `0x` calldata (even number of hex digits).
  - `value?: string` — wei, as hex (`"0x0"`) or decimal-wei string.
  - `abi?: any[]` — the ABI describing `data` (and the constructor for a deploy).
  - `bytecode?: string` — the contract creation bytecode (deploys only).
- **Returns:** `{ txHash: string }`.

**What-you-see-is-what-you-sign (WYSIWYS).** Provide `abi` (and `bytecode` for a
deploy). The wallet decodes your `data` with the ABI, **re-encodes it, and
byte-compares** against the `data` you sent. If they differ, the transaction is
rejected — this stops a page from displaying one thing and signing another. The
value is shown to the user in decimal.

**Native coin transfer.** Set `to` (recipient) and `value` (wei). No `data`:

```js
const { txHash } = await provider.request({
  method: "qc_sendTransaction",
  params: {
    to: "0x<64-hex recipient>",
    value: "0x16345785d8a0000" // 0.1 coin in wei (hex), or a decimal-wei string
  }
});
```

**ERC20 token transfer.** Send `transfer(address,uint256)` calldata to the token
contract, with the matching `abi` so the wallet can decode + verify (WYSIWYS). See
[`examples/dapp.js`](examples/dapp.js) for the `encodeErc20Transfer` helper:

```js
// data = 0xa9059cbb ++ pad32(recipient) ++ uint256(amountBaseUnits)
const data = encodeErc20Transfer(recipient, amountBaseUnits);

const { txHash } = await provider.request({
  method: "qc_sendTransaction",
  params: {
    to: "0x<64-hex token contract>",
    data,
    value: "0x0",
    abi: [{
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" }
      ],
      outputs: [{ name: "", type: "bool" }]
    }]
  }
});
```

**Deploy example (ERC20 with `constructor(string,string,uint256)`).** The
provider does not include an ABI encoder, so the page builds the constructor
calldata itself and appends it to the bytecode. See
[`examples/dapp.js`](examples/dapp.js) for the full `encodeErc20ConstructorArgs`
helper; the request looks like:

```js
// data = creationBytecode ++ abi.encode(name, symbol, initialSupplyWei)
const data = ERC20_CREATION_BYTECODE + encodeErc20ConstructorArgs(name, symbol, supplyWei);

const { txHash } = await provider.request({
  method: "qc_sendTransaction",
  params: {
    // no `to` => contract creation
    data,
    value: "0x0",
    abi: [{
      type: "constructor",
      inputs: [
        { name: "name_", type: "string" },
        { name: "symbol_", type: "string" },
        { name: "initialSupply_", type: "uint256" }
      ]
    }],
    bytecode: ERC20_CREATION_BYTECODE
  }
});
```

**Getting the deployed contract address.** `qc_sendTransaction` returns only a
`txHash`. To learn the new contract address, poll the transaction receipt via the
[read passthrough](#read-only-json-rpc-passthrough) and read `contractAddress`:

```js
async function waitForReceipt(provider, txHash, tries = 40, intervalMs = 3000) {
  for (let i = 0; i < tries; i++) {
    const r = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
    if (r) return r;                                  // mined
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return null;                                        // timed out
}

const receipt = await waitForReceipt(provider, txHash);
console.log("deployed at:", receipt && receipt.contractAddress); // 0x<64-hex>
```

### qc_disconnect

Revoke this site's access.

- **Params:** none.
- **Returns:** `true`.
- **Side effects:** emits `accountsChanged []` then `disconnect`.

```js
await provider.request({ method: "qc_disconnect" });
```

### Read-only JSON-RPC passthrough

Standard Ethereum **read** methods are forwarded to the QuantumCoin node so you
can query chain state through the same provider. These require a **connected
site** (so the wallet knows which network's node to use) and take a **positional
array** of params. They do not open a popup.

Supported (allowlisted) read methods include:

```
eth_blockNumber        eth_chainId              eth_call
eth_estimateGas        eth_gasPrice             eth_maxPriorityFeePerGas
eth_feeHistory         eth_getBalance           eth_getCode
eth_getStorageAt       eth_getLogs              eth_getBlockByNumber
eth_getBlockByHash     eth_getBlockTransactionCountByNumber
eth_getBlockTransactionCountByHash               eth_getTransactionByHash
eth_getTransactionByBlockNumberAndIndex          eth_getTransactionByBlockHashAndIndex
eth_getTransactionCount  eth_getTransactionReceipt  eth_getBlockReceipts
eth_syncing            net_version              net_listening
web3_clientVersion
```

Examples:

```js
const height = await provider.request({ method: "eth_blockNumber" });            // "0x41cdb0"
const bal    = await provider.request({ method: "eth_getBalance", params: [account, "latest"] });
const code   = await provider.request({ method: "eth_getCode",    params: [contract, "latest"] });
const ret    = await provider.request({ method: "eth_call",       params: [{ to: contract, data }, "latest"] });
```

Notes:

- Results carry **32-byte** QuantumCoin addresses (`contractAddress`, `from`,
  `to`, ... are 64-hex).
- Unsupported methods return the node's JSON-RPC error verbatim. On the current
  network node, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, and
  `eth_getBlockReceipts` are **not available** and reject with
  `the method ... does not exist/is not available` (JSON-RPC code `-32601`).
- Anything not on the allowlist (and not a `qc_*`/aliased method) rejects with
  `Unsupported method: <name>`. Write methods like `eth_sendTransaction` /
  `eth_sendRawTransaction` are intentionally **not** proxied — use the `qc_*`
  send methods.

---

## Events

Subscribe with `provider.on(event, handler)`.

| Event | Payload | When it fires |
| --- | --- | --- |
| `connect` | `{ chainId: number }` | The site connects an account. |
| `accountsChanged` | `string[]` (`[address]` or `[]`) | The active account changes, or the site is disconnected (`[]`). |
| `chainChanged` | `string` (hex chain id, e.g. `"0x1e0f3"`) | The wallet switches networks. |
| `disconnect` | `{}` | The site is disconnected. |
| `transactionResult` | `{ txHash: string, status: "succeeded" \| "failed" \| "timeout" }` | After a send is broadcast and the wallet finishes polling for confirmation. Fires even if the approval popup was closed right after signing. |

```js
provider.on("connect",         (info)     => console.log("connected, chainId:", info.chainId));
provider.on("accountsChanged", (accounts) => console.log("accounts:", accounts));
provider.on("chainChanged",    (chainIdHex) => console.log("chain:", chainIdHex));
provider.on("disconnect",      ()         => console.log("disconnected"));
provider.on("transactionResult", (r)      => console.log("tx", r.txHash, "=>", r.status));
```

> A common pattern is to **reload or refetch** on `chainChanged` and to update the
> UI on `accountsChanged` (treat `[]` as "logged out").

---

## Step-by-step walkthroughs

### 1. Connect and show the account + chain

```js
const provider = requireProvider();
if (!provider) return;

const accounts = await provider.request({ method: "qc_requestAccounts" }); // opens popup
const account  = accounts[0];
const chainId  = await provider.request({ method: "qc_chainId" });
console.log("connected:", account, "chain:", chainId);
```

### 2. Sign a message

```js
const signature = await provider.request({
  method: "qc_signMessage",
  params: { message: "Sign in to Example dApp" }
});
console.log("signature:", signature);
```

### 3. Send native coin

```js
const { txHash } = await provider.request({
  method: "qc_sendTransaction",
  params: { to: recipient, value: "0x37a07d447a80000" } // 0.25 coin in wei
});
console.log("submitted:", txHash);
```

### 4. Send a token

```js
// data = 0xa9059cbb ++ pad32(recipient) ++ uint256(amountBaseUnits)
const data = encodeErc20Transfer(recipient, amountBaseUnits); // see examples/dapp.js
const { txHash } = await provider.request({
  method: "qc_sendTransaction",
  params: {
    to: token,
    data,
    value: "0x0",
    abi: [{
      type: "function",
      name: "transfer",
      stateMutability: "nonpayable",
      inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
      outputs: [{ name: "", type: "bool" }]
    }]
  }
});
```

### 5. Deploy a contract and read its address

```js
const { txHash } = await provider.request({
  method: "qc_sendTransaction",
  params: { data, value: "0x0", abi, bytecode }   // no `to` => deploy
});
const receipt = await waitForReceipt(provider, txHash);
console.log("deployed at:", receipt.contractAddress);
```

### 6. React to wallet-side changes

```js
provider.on("accountsChanged", (accounts) => {
  if (!accounts.length) showLoggedOut();
  else showAccount(accounts[0]);
});
provider.on("chainChanged", () => window.location.reload());
```

---

## Error handling

`provider.request(...)` rejects with an `Error`; read `.message`. Always wrap
calls in `try/catch`:

```js
try {
  const accounts = await provider.request({ method: "qc_requestAccounts" });
} catch (e) {
  console.error("connect failed:", e.message);
}
```

Common messages:

| Message | Meaning |
| --- | --- |
| `User rejected the request` | The user closed the approval popup without approving. |
| `The active account is not connected to this site. Call qc_requestAccounts first.` | You called a wallet method before connecting. |
| `Not connected: call qc_requestAccounts first.` | You called a read (`eth_*`) method before connecting. |
| `Unsupported method: <name>` | The method is not exposed by the provider. |
| `Incompatible address: QuantumCoin uses 32-byte (64-hex) addresses; received an Ethereum-style 20-byte address.` | You passed a 20-byte Ethereum address. |

---

## Using with standard Ethereum tooling

The provider is EIP-1193-shaped, so basic Ethereum tooling can do **reads**
against it:

- Reads work through the `eth_*` [passthrough](#read-only-json-rpc-passthrough).
- `eth_requestAccounts`, `eth_accounts`, and `eth_chainId` are aliased/handled,
  so account discovery works.

But **writes are different**: there is **no `eth_sendTransaction`**. Use the
`qc_*` methods (`qc_signMessage`, `qc_sendTransaction`) for anything that signs or
sends — including native coin and ERC20 token transfers, which both go through
`qc_sendTransaction`. Also remember:

- Addresses are 32 bytes — libraries that validate 20-byte Ethereum addresses
  will reject QuantumCoin addresses.
- `qc_chainId` is numeric; `eth_chainId` and `chainChanged` are hex.

For most dApps the simplest path is to call `window.quantumcoin.request(...)`
directly, as shown throughout this guide.

---

## Security model

- **Keys never leave the wallet.** Signing happens inside the extension's
  approval popup after the user enters their password; your page only ever
  receives public results (addresses, signatures, tx hashes).
- **Explicit approval.** Connecting, signing, and sending each require the user
  to confirm in the popup. Closing it rejects the request.
- **Per-origin permissions.** Access is granted per website origin; the user can
  disconnect at any time (and your site can call `qc_disconnect`).
- **WYSIWYS.** For `qc_sendTransaction`, the wallet re-encodes the decoded
  calldata from your `abi` and byte-compares it to your `data`, so what the user
  sees is what actually gets signed.

---

## Try it: the example page

[`examples/dapp.html`](examples/dapp.html) (driven by
[`examples/dapp.js`](examples/dapp.js)) is a complete, self-contained page that
exercises connect, sign, deploy, and send, and logs every request/result/event.

Serve it over HTTP and open it in the browser where the extension is loaded:

```bash
npx serve examples          # then open the printed http://localhost:3000/dapp.html
# or: python -m http.server 3000 --directory examples
```

See the main [README.md](README.md#test-the-web3-dapp-example-page) for the full
click-through.

---

## Troubleshooting

- **`window.quantumcoin` is undefined.** The page must be `http(s)://` (not
  `file://`), the extension must be installed/enabled, and a wallet must exist.
  Reload after installing; or wait for the `quantumcoin#initialized` event.
- **A call "hangs".** Wallet actions wait for the user to approve in the popup.
  There is no built-in timeout — add your own if you need one, and handle the
  `User rejected the request` rejection.
- **Reads fail with "Not connected".** Call `qc_requestAccounts` first; reads
  need a connected site to know which network node to use.
- **`eth_gasPrice` (or similar) errors with `-32601`.** That method is not
  enabled on the current network node; use `eth_estimateGas` and the wallet's
  own fee UI instead.
