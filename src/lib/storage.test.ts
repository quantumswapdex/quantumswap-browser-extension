// Byte-compatibility tests for the storage layer.
// The stored formats asserted here are a compatibility contract with vaults
// created by the legacy extension (public/js/storage.js + platform-bridge
// crypto handlers: AES-256-GCM payloads, atomic {salt, payload} main-key
// record) - do not update expected values.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as nodeCrypto from "node:crypto";

// Emulates the platform-bridge crypto handlers (src/bridge/handlers/crypto.js)
// so the full encryption chain runs in-process for tests. Web Crypto AES-GCM
// appends the 16-byte auth tag to the ciphertext; node's gcm APIs expose it
// separately, so the stub concatenates cipherText||tag the same way.
const FIXED_RANDOM: { queue: Uint8Array[] } = { queue: [] };

function nodeB64ToBytes(b64: string): Uint8Array {
    return new Uint8Array(Buffer.from(b64, "base64"));
}

function gcmEncryptB64(keyB64: string, ivB64: string, plainText: string): string {
    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", nodeB64ToBytes(keyB64), nodeB64ToBytes(ivB64));
    const cipherBytes = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([cipherBytes, tag]).toString("base64");
}

function gcmDecryptB64(keyB64: string, ivB64: string, cipherTextB64: string): string {
    const combined = Buffer.from(cipherTextB64, "base64");
    const cipherBytes = combined.subarray(0, combined.length - 16);
    const tag = combined.subarray(combined.length - 16);
    const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", nodeB64ToBytes(keyB64), nodeB64ToBytes(ivB64));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cipherBytes), decipher.final()]).toString("utf8");
}

function stubCryptoApiSend(channel: string, data: any): Promise<any> {
    switch (channel) {
        case "CryptoRandomBytes": {
            const next = FIXED_RANDOM.queue.shift();
            const bytes = next ?? new Uint8Array(nodeCrypto.randomBytes(Number(data)));
            return Promise.resolve(Buffer.from(bytes).toString("base64"));
        }
        case "CryptoApiEncrypt": {
            return Promise.resolve(gcmEncryptB64(data.key, data.iv, data.plainText));
        }
        case "CryptoApiDecrypt": {
            return Promise.resolve(gcmDecryptB64(data.key, data.iv, data.cipherText));
        }
        case "ScryptDerive": {
            // Same parameters as quantumcoin.scryptSync in the main process: N=262144, r=8, p=1, 32 bytes.
            const key = nodeCrypto.scryptSync(Buffer.from(data.secret, "utf8"), nodeB64ToBytes(data.salt), 32, {
                N: 262144, r: 8, p: 1, maxmem: 512 * 1024 * 1024,
            });
            return Promise.resolve(Buffer.from(key).toString("base64"));
        }
        default:
            return Promise.reject(new Error("unexpected channel " + channel));
    }
}

vi.stubGlobal("CryptoApi", { send: stubCryptoApiSend });
vi.stubGlobal("LocalStorageApi", { send: () => Promise.resolve("C:\\fake\\userData") });

const { storageSetItem, storageGetItem, storageCreateMainKey, storageSetSecureItem, storageGetSecureItem, isMainKeyCreated, isEulaAccepted, storeEulaAccepted } = await import("./storage");
const { cryptoHash, base64ToBytes, bytesToBase64 } = await import("./crypto");

beforeEach(() => {
    localStorage.clear();
    FIXED_RANDOM.queue = [];
});

describe("storage wrapper byte format", () => {
    it("writes JSON.stringify({value, hash}) with SHA-256(key+value) hex (golden vectors)", async () => {
        await storageSetItem("eulaaccepted", "ok");
        expect(localStorage.getItem("eulaaccepted")).toBe(
            JSON.stringify({ value: "ok", hash: "397a2e2b780b38eaf310d4ef6de46fd136ba26ebddd7b431664e7c191f714cce" })
        );

        await storageSetItem("MaxWalletIndex", "0");
        expect(localStorage.getItem("MaxWalletIndex")).toBe(
            JSON.stringify({ value: "0", hash: "7738b3e33e362aad08bc7a7d23144d1fb9d8510c72889c374bde84560b28ea07" })
        );
    });

    it("reads values written by the old app unchanged", async () => {
        // Simulates a pre-existing entry created by the old vanilla-JS app.
        localStorage.setItem(
            "BLOCKCHAIN_NETWORK_3_0",
            JSON.stringify({ value: '{"a":1}', hash: "7848f47004126c8248aced3a2efddba943fdf72a869db3fc4ae9f896528dfd25" })
        );
        expect(await storageGetItem("BLOCKCHAIN_NETWORK_3_0")).toBe('{"a":1}');
    });

    it("rejects tampered values", async () => {
        await storageSetItem("k", "v");
        const raw = JSON.parse(localStorage.getItem("k") as string);
        raw.value = "tampered";
        localStorage.setItem("k", JSON.stringify(raw));
        await expect(storageGetItem("k")).rejects.toThrow("storageGetItem mismatched hash.");
    });

    it("eula flag round-trip", async () => {
        expect(await isEulaAccepted()).toBe(false);
        await storeEulaAccepted();
        expect(await isEulaAccepted()).toBe(true);
    });
});

describe("main key + secure item encryption chain", () => {
    it("creates main key with old formats and round-trips secure items", async () => {
        expect(await isMainKeyCreated()).toBe(false);
        await storageCreateMainKey("correct horse battery staple");
        expect(await isMainKeyCreated()).toBe(true);

        // DUR-02: one atomic {salt, payload} record under encryptedmainkey (no
        // separate derivedkeysalt entry), inside the {value, hash} wrapper.
        expect(localStorage.getItem("derivedkeysalt")).toBeNull();
        const mainKeyItem = JSON.parse(localStorage.getItem("encryptedmainkey") as string);
        expect(mainKeyItem.hash).toBe(await cryptoHash("encryptedmainkey" + mainKeyItem.value));
        const record = JSON.parse(mainKeyItem.value);
        expect(Object.keys(record)).toEqual(["salt", "payload"]);
        expect(base64ToBytes(record.salt).length).toBe(32);

        // The payload is {"cipherText":...,"iv":...,"alg":"AES-GCM","v":2} with
        // exactly those keys in that order and a 12-byte GCM IV.
        expect(Object.keys(record.payload)).toEqual(["cipherText", "iv", "alg", "v"]);
        expect(record.payload.alg).toBe("AES-GCM");
        expect(record.payload.v).toBe(2);
        expect(base64ToBytes(record.payload.iv).length).toBe(12);

        const walletJson = JSON.stringify({ address: "0xabc", privateKey: null, publicKey: null, seed: "c2VlZA==" });
        expect(await storageSetSecureItem("correct horse battery staple", "WALLET_0", walletJson)).toBe(true);
        expect(await storageGetSecureItem("correct horse battery staple", "WALLET_0")).toBe(walletJson);

        // Wrong passphrase must not decrypt. The old app's storageDecryptMainKey
        // throws in this case (cryptoApiDecrypt returns null); callers catch it.
        await expect(storageGetSecureItem("wrong passphrase", "WALLET_0")).rejects.toThrow("storageDecryptMainKey cryptoApiDecrypt failed.");
    }, 60000);

    it("decrypts a deterministic golden snapshot (legacy-extension equivalent bytes)", async () => {
        // Fix all randomness: scrypt salt, main key bytes; main key IV; wallet item IV.
        const salt = new Uint8Array(32).fill(1);
        const mainKey = new Uint8Array(32).fill(2);
        const ivMainKey = new Uint8Array(12).fill(3);
        const ivWallet = new Uint8Array(12).fill(4);
        FIXED_RANDOM.queue = [salt, mainKey, ivMainKey, ivWallet];

        await storageCreateMainKey("pw");
        const secret = "golden-secret";
        await storageSetSecureItem("pw", "WALLET_0", secret);

        // The snapshot below is exactly what the legacy extension would have
        // produced for the same randomness (same scrypt, AES-256-GCM, and JSON
        // shapes incl. the atomic {salt, payload} main-key record).
        const expectedDerivedKey = nodeCrypto.scryptSync(Buffer.from("pw", "utf8"), salt, 32, { N: 262144, r: 8, p: 1, maxmem: 512 * 1024 * 1024 });
        const expectedMainKeyCipher = gcmEncryptB64(Buffer.from(expectedDerivedKey).toString("base64"), bytesToBase64(ivMainKey), bytesToBase64(mainKey));
        const mainKeyItem = JSON.parse(localStorage.getItem("encryptedmainkey") as string);
        expect(mainKeyItem.value).toBe(JSON.stringify({
            salt: bytesToBase64(salt),
            payload: { cipherText: expectedMainKeyCipher, iv: bytesToBase64(ivMainKey), alg: "AES-GCM", v: 2 },
        }));

        const expectedWalletCipher = gcmEncryptB64(bytesToBase64(mainKey), bytesToBase64(ivWallet), secret);
        const walletItem = JSON.parse(localStorage.getItem("WALLET_0") as string);
        expect(walletItem.value).toBe(JSON.stringify({ cipherText: expectedWalletCipher, iv: bytesToBase64(ivWallet), alg: "AES-GCM", v: 2 }));

        expect(await storageGetSecureItem("pw", "WALLET_0")).toBe(secret);
    }, 60000);
});
