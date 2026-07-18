// Renderer-side crypto helpers. TS port of the legacy public/js/crypto.js:
// byte formats (base64 codecs, SHA-256 hex hashing, EncryptedPayload/DerivedKey
// JSON shapes) must remain identical for storage compatibility. The extension
// vault is authenticated AES-256-GCM (12-byte IV, `alg`/`v` always set).
import { cryptoRandomBytes, scryptDerive } from "./bridge";

export const CRYPTO_AES_KEY_SIZE = 32;
export const CRYPTO_AES_IV_SIZE = 16;
export const CRYPTO_AES_GCM_IV_SIZE = 12;
export const CRYPTO_ALG_GCM = "AES-GCM";
export const SCRYPT_SALT_SIZE = 32;
export const CRYPTO_SEED_BYTES = 96;

// IMPORTANT: do not name page globals after Go-WASM exports. The quantum-coin
// SDK registers PascalCase globals (e.g. globalThis.IsValidAddress) and calls
// them internally; a page function with the same name can clobber the WASM one
// (script-parse vs WASM-init race). This module-scoped export is safe (it is
// not installed on globalThis), but keep the caution in mind for new globals.
export async function IsValidAddress(address: string): Promise<boolean> {
    return await CryptoApi.send("IsValidAddress", address);
}

// Field order matters: JSON.stringify(new EncryptedPayload(...)) must produce
// {"cipherText":"...","iv":"...","alg":"...","v":2} exactly as stored.
export class EncryptedPayload {
    cipherText: string;
    iv: string;
    alg: string;
    v: number;

    // The vault is authenticated AES-GCM only; `alg`/`v` are always set.
    constructor(cipherText: string, iv: string, alg: string) {
        this.cipherText = cipherText;
        this.iv = iv;
        this.alg = alg;
        this.v = 2;
    }
}

export class DerivedKey {
    key: string;
    salt: string;

    constructor(key: string, salt: string) {
        this.key = key;
        this.salt = salt;
    }
}

export async function cryptoHash(data: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(data); // encode as (utf-8) Uint8Array
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8); // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""); // convert bytes to hex string
    return hashHex;
}

export function base64ToBytes(base64: string): Uint8Array {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0) as number);
}

export function bytesToBase64(bytes: Uint8Array | number[]): string {
    const binString = Array.from(bytes, (byte) =>
        String.fromCodePoint(byte),
    ).join("");
    return btoa(binString);
}

export async function cryptoRandom(size: number): Promise<Uint8Array> {
    const base64 = await cryptoRandomBytes(size);
    return base64ToBytes(base64);
}

export async function cryptoNewSeed(seedBytes?: number): Promise<Uint8Array> {
    return cryptoRandom(seedBytes || CRYPTO_SEED_BYTES);
}

export function cryptoNewAesKey(): Promise<Uint8Array> {
    return cryptoRandom(CRYPTO_AES_KEY_SIZE);
}

export async function cryptoApiEncrypt(aesKeyArray: Uint8Array, plainText: string): Promise<EncryptedPayload> {
    // New writes use authenticated AES-GCM with a fresh 12-byte IV.
    const iv = await cryptoRandom(CRYPTO_AES_GCM_IV_SIZE);
    const ivBase64 = bytesToBase64(iv);

    const encryptRequest = {
        key: bytesToBase64(aesKeyArray),
        iv: ivBase64,
        plainText: plainText,
        alg: CRYPTO_ALG_GCM,
    };
    const cipherText: string = await CryptoApi.send("CryptoApiEncrypt", encryptRequest);

    return new EncryptedPayload(cipherText, ivBase64, CRYPTO_ALG_GCM);
}

export async function cryptoApiDecrypt(aesKeyArray: Uint8Array, encryptedPayload: { cipherText: string; iv: string }): Promise<string | null> {
    try {
        const decryptRequest = {
            key: bytesToBase64(aesKeyArray),
            iv: encryptedPayload.iv,
            cipherText: encryptedPayload.cipherText,
            alg: CRYPTO_ALG_GCM,
        };

        const plainText: string = await CryptoApi.send("CryptoApiDecrypt", decryptRequest);
        return plainText;
    } catch {
        return null;
    }
}

export async function cryptoApiScryptAutoSalt(secretString: string): Promise<DerivedKey> {
    const saltBytes = await cryptoRandom(SCRYPT_SALT_SIZE);
    return cryptoApiScrypt(secretString, saltBytes);
}

export async function cryptoApiScrypt(secretString: string, saltBytes: Uint8Array): Promise<DerivedKey> {
    const derivedKey = await scryptDerive(secretString, bytesToBase64(saltBytes));

    return new DerivedKey(derivedKey, bytesToBase64(saltBytes));
}
