// Throwaway parity check: AES-256-CBC is the one wallet primitive that moved from
// Node's `crypto` to the browser-native Web Crypto API. This asserts that Node
// `crypto` and Web Crypto (`globalThis.crypto.subtle`) produce byte-identical
// AES-256-CBC output, so keystores created by the desktop app still decrypt in the
// extension. The scrypt + full keystore path is covered end-to-end by
// scripts/smoke-wasm.cjs (which exercises the real quantumcoin SDK).
const nodeCrypto = require("node:crypto");
const webcrypto = globalThis.crypto;

function hex(b) {
  return Buffer.from(b).toString("hex");
}

let ok = true;
function check(name, a, b) {
  const pass = a === b;
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) {
    console.log("   a:", a);
    console.log("   b:", b);
  }
}

(async () => {
  const key = nodeCrypto.randomBytes(32);
  const iv = nodeCrypto.randomBytes(16);
  const plain = "quantumswap secret payload";

  // Node AES-256-CBC (the desktop path).
  const nodeCipher = nodeCrypto.createCipheriv("aes-256-cbc", key, iv);
  const nodeCt = Buffer.concat([nodeCipher.update(plain, "utf8"), nodeCipher.final()]);

  // Web Crypto AES-CBC (the extension path).
  const webKey = await webcrypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-CBC" },
    false,
    ["encrypt", "decrypt"],
  );
  const webCtBuf = await webcrypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    webKey,
    new TextEncoder().encode(plain),
  );
  const webCt = Buffer.from(new Uint8Array(webCtBuf));

  check("aes-256-cbc encrypt (node == webcrypto)", hex(nodeCt), hex(webCt));

  // Cross round-trip: Web Crypto must decrypt Node's ciphertext back to plaintext.
  const decryptedBuf = await webcrypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    webKey,
    nodeCt,
  );
  const roundTrip = new TextDecoder().decode(decryptedBuf);
  check("aes-256-cbc decrypt (node ct -> webcrypto pt)", plain, roundTrip);

  console.log(ok ? "\nALL PARITY CHECKS PASSED" : "\nPARITY CHECKS FAILED");
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error("\nPARITY CHECK ERROR:", err);
  process.exit(1);
});
