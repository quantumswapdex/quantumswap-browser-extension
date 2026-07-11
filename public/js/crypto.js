"use strict";

const CRYPTO_AES_KEY_SIZE = 32;
const CRYPTO_AES_IV_SIZE = 16;
const CRYPTO_AES_GCM_IV_SIZE = 12;
const CRYPTO_ALG_GCM = "AES-GCM";
const SCRYPT_SALT_SIZE = 32;
const CRYPTO_SEED_BYTES = 96;

// IMPORTANT: do not name page globals after Go-WASM exports. The quantum-coin
// SDK registers PascalCase globals (e.g. globalThis.IsValidAddress) and calls
// them internally; a page function with the same name can clobber the WASM one
// (script-parse vs WASM-init race) and turn every SDK-internal address check
// into an infinite recursion through the bridge.
async function isValidQcAddress(address) {
    return await CryptoApi.send('IsValidAddress', address);
}

class EncryptedPayload {

    // The vault is authenticated AES-GCM only; `alg`/`v` are always set.
    constructor(cipherText, iv, alg) {
        this.cipherText = cipherText;
        this.iv = iv;
        this.alg = alg;
        this.v = 2;
    }

}

class DerivedKey {
    constructor(key, salt) {
        this.key = key;
        this.salt = salt;
    }
}

async function cryptoHash(data) {
    const msgUint8 = new TextEncoder().encode(data); // encode as (utf-8) Uint8Array
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8); // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""); // convert bytes to hex string
    return hashHex;
}

function base64ToBytes(base64) {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

function bytesToBase64(bytes) {
    const binString = Array.from(bytes, (byte) =>
        String.fromCodePoint(byte),
    ).join("");
    return btoa(binString);
}

async function cryptoRandom(size) {
    const base64 = await cryptoRandomBytes(size);
    return base64ToBytes(base64);
}

async function cryptoNewSeed(seedBytes) {
    return cryptoRandom(seedBytes || CRYPTO_SEED_BYTES);
}

function cryptoNewAesKey() {
    return cryptoRandom(CRYPTO_AES_KEY_SIZE);
}

async function cryptoApiEncrypt(aesKeyArray, plainText) {
    // New writes use authenticated AES-GCM with a fresh 12-byte IV.
    const iv = await cryptoRandom(CRYPTO_AES_GCM_IV_SIZE);
    const ivBase64 = bytesToBase64(iv);

    const encryptRequest = {
        key: bytesToBase64(aesKeyArray),
        iv: ivBase64,
        plainText: plainText,
        alg: CRYPTO_ALG_GCM
    }
    const cipherText = await CryptoApi.send('CryptoApiEncrypt', encryptRequest);

    const encryptedPayload = new EncryptedPayload(cipherText, ivBase64, CRYPTO_ALG_GCM);

    return encryptedPayload;
}

async function cryptoApiDecrypt(aesKeyArray, encryptedPayload) {

    try {
        const decryptRequest = {
            key: bytesToBase64(aesKeyArray),
            iv: encryptedPayload.iv,
            cipherText: encryptedPayload.cipherText,
            alg: CRYPTO_ALG_GCM
        }

        const plainText = await CryptoApi.send('CryptoApiDecrypt', decryptRequest);
        return plainText;
    } catch (error) {
        return null;
    }
}

async function cryptoApiScryptAutoSalt(secretString) {
    const saltBytes = await cryptoRandom(SCRYPT_SALT_SIZE);
    return cryptoApiScrypt(secretString, saltBytes);
}

async function cryptoApiScrypt(secretString, saltBytes) {
    const derivedKey = await scryptDerive(secretString, bytesToBase64(saltBytes));

    const scryptDerivedKey = new DerivedKey(derivedKey, bytesToBase64(saltBytes));

    return scryptDerivedKey;
}
