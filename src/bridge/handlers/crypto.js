// Ported from the Crypto/Wallet ipcMain.handle handlers in the desktop src/index.js.
// All crypto is now browser-native: AES-256-CBC uses the Web Crypto API
// (`globalThis.crypto.subtle`), and scrypt/randomBytes come from quantumcoin's
// native (WASM + Web Crypto) implementations. No Node `crypto` shim is required.
import { Initialize } from "quantumcoin/config";
import {
  Wallet,
  computeAddress,
  isAddress,
  scryptSync,
  randomBytes,
  verifyMessage,
} from "quantumcoin";

function base64ToBytes(base64) {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

// AES-256-CBC via Web Crypto. The browser applies PKCS#7 padding, matching Node's
// `aes-256-cbc`, so keystores created by the desktop app remain decryptable here.
async function importAesKey(keyBytes, usages) {
  return globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    usages,
  );
}

export default {
  async CryptoApiEncrypt(data) {
    const aesKey = base64ToBytes(data.key);
    const aesIV = base64ToBytes(data.iv);

    const key = await importAesKey(aesKey, ["encrypt"]);
    const cipherBytes = await globalThis.crypto.subtle.encrypt(
      { name: "AES-CBC", iv: aesIV },
      key,
      new TextEncoder().encode(data.plainText),
    );

    return bytesToBase64(new Uint8Array(cipherBytes));
  },

  async CryptoApiDecrypt(data) {
    const aesKey = base64ToBytes(data.key);
    const aesIV = base64ToBytes(data.iv);

    const key = await importAesKey(aesKey, ["decrypt"]);
    const plainBytes = await globalThis.crypto.subtle.decrypt(
      { name: "AES-CBC", iv: aesIV },
      key,
      base64ToBytes(data.cipherText),
    );

    return new TextDecoder().decode(plainBytes);
  },

  async CryptoApiScrypt(data) {
    await Initialize(null);
    const salt = base64ToBytes(data.salt);
    const hexKey = scryptSync(data.secret, salt, 16384, 8, 1, 32);
    return bytesToBase64(hexToBytes(hexKey));
  },

  async CryptoRandomBytes(data) {
    const size = Number(data);
    if (!Number.isInteger(size) || size < 1 || size > 1024) {
      throw new Error("CryptoRandomBytes: invalid size");
    }
    return bytesToBase64(randomBytes(size));
  },

  async WalletFromSeed(data) {
    await Initialize(null);
    const seedNumbers = Array.from(data.seed);
    const wallet = Wallet.fromSeed(seedNumbers);
    const privBytes = wallet.signingKey.privateKeyBytes;
    const pubBytes = wallet.signingKey.publicKeyBytes;
    return {
      address: wallet.address,
      privateKey: bytesToBase64(privBytes),
      publicKey: bytesToBase64(pubBytes),
    };
  },

  async WalletEncryptJson(data) {
    await Initialize(null);
    const privBytes = Buffer.from(data.privateKey, "base64");
    const pubBytes = Buffer.from(data.publicKey, "base64");
    const wallet = Wallet.fromKeys(privBytes, pubBytes);
    return wallet.encryptSync(data.passphrase);
  },

  async WalletDecryptJson(data) {
    await Initialize(null);
    const wallet = Wallet.fromEncryptedJsonSync(data.json, data.passphrase);
    const privBytes = wallet.signingKey.privateKeyBytes;
    const pubBytes = wallet.signingKey.publicKeyBytes;

    // The SDK exposes the original seed (hex) when the wallet file contains one.
    // Store it as base64-of-raw-bytes to match the desktop's seed format.
    let seedBase64 = null;
    if (typeof wallet.seed === "string" && wallet.seed.length > 0) {
      const seedHex = wallet.seed.startsWith("0x") ? wallet.seed.slice(2) : wallet.seed;
      seedBase64 = bytesToBase64(new Uint8Array(Buffer.from(seedHex, "hex")));
    }

    return {
      address: wallet.address,
      privateKey: bytesToBase64(privBytes),
      publicKey: bytesToBase64(pubBytes),
      seed: seedBase64,
    };
  },

  async ComputeAddress(data) {
    await Initialize(null);
    const pubBytes = Buffer.from(data, "base64");
    return computeAddress(pubBytes);
  },

  // EIP-191 personal-message signing via quantumcoin.js. The message is hashed
  // with the Ethereum-compatible prefix (keccak256("\x19Ethereum Signed
  // Message:\n" + len + message)) and signed with the unlocked post-quantum key.
  // The returned 0x signature blob embeds the signer's public key, so no
  // separate public key needs to travel with it (see VerifyMessage).
  async SignMessage(data) {
    await Initialize(null);
    const privBytes = Buffer.from(data.privateKey, "base64");
    const pubBytes = Buffer.from(data.publicKey, "base64");
    const wallet = Wallet.fromKeys(privBytes, pubBytes);
    // An explicit signingContext wins; otherwise, when advanced ("full") signing
    // is enabled, sign with the full signing context (mirrors chain.js sends).
    let signingContext = data.signingContext == null ? null : data.signingContext;
    if (signingContext == null && data.advancedSigningEnabled === true) {
      signingContext = wallet.getSigningContext(true);
    }
    const signature = wallet.signMessageSync(data.message, signingContext);
    return { signature };
  },

  // Recover the 32-byte signer address from an EIP-191 message signature.
  // Throws (INVALID_ARGUMENT) when the signature is malformed or does not verify.
  async VerifyMessage(data) {
    await Initialize(null);
    const address = verifyMessage(data.message, data.signature);
    return { address };
  },

  async IsValidAddress(data) {
    await Initialize(null);
    return isAddress(data);
  },

  async ScryptDerive(data) {
    await Initialize(null);
    const passwordBytes = new Uint8Array(Buffer.from(data.secret, "utf8"));
    const saltBytes = base64ToBytes(data.salt);
    const hexKey = scryptSync(passwordBytes, saltBytes, 262144, 8, 1, 32);
    const keyBytes = Buffer.from(hexKey.startsWith("0x") ? hexKey.slice(2) : hexKey, "hex");
    return bytesToBase64(new Uint8Array(keyBytes));
  },
};
