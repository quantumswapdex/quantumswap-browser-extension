// Smoke test: load the ACTUAL bundled public/platform-bridge.js in a browser-like
// global environment and exercise the WASM path. Initialize() instantiates the Go
// WASM and then calls a WASM function (cryptoRandom) during CSPRNG validation, so
// a successful handler call proves the post-quantum WASM runs outside Electron.
const path = require("node:path");

// Minimal browser-ish globals the bridge/UI touch.
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.navigator = globalThis.navigator || { clipboard: { writeText: async () => {} } };
globalThis.document = {
  addEventListener() {},
  querySelectorAll() {
    return [];
  },
  getElementById() {
    return { addEventListener() {} };
  },
};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.browser = {
  runtime: { getManifest: () => ({ version: "1.2.6" }), getURL: (p) => p },
  tabs: { create() {} },
};

require(path.join(__dirname, "..", "public", "platform-bridge.js"));

(async () => {
  const version = await window.AppApi.send("AppApiGetVersion");
  console.log("AppApiGetVersion ->", version);

  const seedWordsInit = await window.SeedWordsApi.send("SeedWordsInitialize");
  console.log("SeedWordsInitialize ->", seedWordsInit);

  // Triggers Initialize(null): instantiates the Go WASM AND runs a WASM call.
  const valid = await window.CryptoApi.send("IsValidAddress", "0x" + "0".repeat(64));
  console.log("IsValidAddress(zero) ->", valid, "(WASM instantiated + executed)");

  // CryptoRandomBytes exercises the browser crypto shim end-to-end.
  const rnd = await window.CryptoApi.send("CryptoRandomBytes", 16);
  console.log("CryptoRandomBytes(16) -> base64 len", rnd.length);

  // Heaviest WASM path: derive a post-quantum wallet from a seed, then round-trip
  // it through the encrypted-JSON keystore (PQC key handling runs entirely in WASM).
  const seed = Array.from({ length: 96 }, () => Math.floor(Math.random() * 256));
  const wallet = await window.CryptoApi.send("WalletFromSeed", { seed });
  console.log("WalletFromSeed -> address", wallet.address.slice(0, 12) + "...");

  const encrypted = await window.CryptoApi.send("WalletEncryptJson", {
    privateKey: wallet.privateKey,
    publicKey: wallet.publicKey,
    passphrase: "test-passphrase-123",
  });
  const decrypted = await window.CryptoApi.send("WalletDecryptJson", {
    json: encrypted,
    passphrase: "test-passphrase-123",
  });
  console.log(
    "Wallet encrypt/decrypt round trip ->",
    decrypted.address === wallet.address ? "address matches" : "MISMATCH",
  );
  if (decrypted.address !== wallet.address)
    throw new Error("wallet encrypt/decrypt round trip failed: address mismatch");

  console.log("\nWASM SMOKE TEST PASSED");
  process.exit(0);
})().catch((err) => {
  console.error("\nWASM SMOKE TEST FAILED:", err);
  process.exit(1);
});
