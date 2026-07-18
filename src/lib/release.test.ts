// Unit tests for the swap release store (src/lib/release.ts). The hash-checked
// storage layer is replaced with in-memory maps: the byte format of storage
// itself is covered by storage.test.ts. The secure-item mock is password
// aware, mirroring the real behavior where storageDecryptMainKey throws when
// the passphrase cannot decrypt the wallet main key.
import { beforeEach, describe, expect, it, vi } from "vitest";

const WALLET_PASSWORD = "correct-wallet-password";

const memoryStore = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => new Map<string, string>());

vi.mock("./storage", () => ({
    storageGetItem: async (key: string): Promise<string | null> => {
        return memoryStore.has(key) ? (memoryStore.get(key) as string) : null;
    },
    storageSetItem: async (key: string, value: string): Promise<boolean> => {
        memoryStore.set(key, String(value));
        return true;
    },
    storageGetSecureItem: async (passphrase: string, key: string): Promise<string | null> => {
        if (!secureStore.has(key)) {
            return null;
        }
        if (passphrase !== "correct-wallet-password") {
            throw new Error("storageDecryptMainKey cryptoApiDecrypt failed.");
        }
        return secureStore.get(key) as string;
    },
    storageSetSecureItem: async (passphrase: string, key: string, value: string): Promise<boolean> => {
        if (passphrase !== "correct-wallet-password") {
            throw new Error("storageDecryptMainKey cryptoApiDecrypt failed.");
        }
        secureStore.set(key, String(value));
        return true;
    },
}));

import {
    BUILTIN_SWAP_RELEASES,
    SwapRelease,
    isValidSwapReleaseAddress,
    isValidSwapReleaseName,
    swapReleaseAddNew,
    swapReleaseGetDefaultIndex,
    swapReleaseGetMaxIndex,
    swapReleaseSetDefaultIndex,
    swapReleasesInit,
    swapReleasesList,
    swapReleasesLoadAll,
} from "./release";

const VALID_WQ = "0x" + "a".repeat(64);
const VALID_FACTORY = "0x" + "b".repeat(64);
const VALID_ROUTER = "0x" + "c".repeat(64);

// Seed + decrypt into the module cache, like loadSwapReleases does at unlock.
// Needed per test because the cache is module state that outlives memoryStore.
async function initAndLoad(password: string = WALLET_PASSWORD): Promise<void> {
    await swapReleasesInit(password);
    await swapReleasesLoadAll(password);
}

beforeEach(() => {
    memoryStore.clear();
    secureStore.clear();
});

describe("swapReleasesInit seeding", () => {
    it("seeds the built-in release at index 0 on first run", async () => {
        expect(await swapReleaseGetMaxIndex()).toBe(-1);
        await initAndLoad();
        expect(await swapReleaseGetMaxIndex()).toBe(0);

        const releases = await swapReleasesList();
        expect(releases.size).toBe(1);
        const beta = releases.get(0) as SwapRelease;
        expect(beta.name).toBe(BUILTIN_SWAP_RELEASES[0].name);
        expect(beta.wq).toBe(BUILTIN_SWAP_RELEASES[0].wq);
        expect(beta.factory).toBe(BUILTIN_SWAP_RELEASES[0].factory);
        expect(beta.router).toBe(BUILTIN_SWAP_RELEASES[0].router);
        expect(beta.builtin).toBe(true);
        expect(beta.index).toBe(0);
    });

    it("does not re-seed when already initialized", async () => {
        await initAndLoad();
        await swapReleaseAddNew(WALLET_PASSWORD, "Custom", VALID_WQ, VALID_FACTORY, VALID_ROUTER);
        await swapReleasesInit(WALLET_PASSWORD);
        expect(await swapReleaseGetMaxIndex()).toBe(1);
        expect((await swapReleasesList()).size).toBe(2);
    });

    it("stores entries encrypted, never in the plaintext store", async () => {
        await initAndLoad();
        await swapReleaseAddNew(WALLET_PASSWORD, "Custom", VALID_WQ, VALID_FACTORY, VALID_ROUTER);
        for (const key of memoryStore.keys()) {
            expect(key.startsWith("SWAP_RELEASE_")).toBe(false);
        }
        expect(secureStore.has("SWAP_RELEASE_2_0")).toBe(true);
        expect(secureStore.has("SWAP_RELEASE_2_1")).toBe(true);
    });
});

describe("swapReleaseAddNew + swapReleasesList round trip", () => {
    it("appends a custom release and lists it back", async () => {
        await initAndLoad();
        const added = await swapReleaseAddNew(WALLET_PASSWORD, "My Release", VALID_WQ, VALID_FACTORY, VALID_ROUTER);
        expect(added.index).toBe(1);
        expect(added.builtin).toBe(false);

        const releases = await swapReleasesList();
        expect(releases.size).toBe(2);
        const custom = releases.get(1) as SwapRelease;
        expect(custom.name).toBe("My Release");
        expect(custom.wq).toBe(VALID_WQ);
        expect(custom.factory).toBe(VALID_FACTORY);
        expect(custom.router).toBe(VALID_ROUTER);
        expect(custom.builtin).toBe(false);
    });

    it("round-trips through a fresh decrypt (loadAll)", async () => {
        await initAndLoad();
        await swapReleaseAddNew(WALLET_PASSWORD, "My Release", VALID_WQ, VALID_FACTORY, VALID_ROUTER);
        await swapReleasesLoadAll(WALLET_PASSWORD);
        const releases = await swapReleasesList();
        expect(releases.size).toBe(2);
        expect((releases.get(1) as SwapRelease).name).toBe("My Release");
    });

    it("trims name and addresses before storing", async () => {
        await initAndLoad();
        const added = await swapReleaseAddNew(WALLET_PASSWORD, "Trimmed", "  " + VALID_WQ + "  ", VALID_FACTORY, VALID_ROUTER);
        expect(added.wq).toBe(VALID_WQ);
    });
});

describe("default index get/set", () => {
    it("defaults to 0 when unset", async () => {
        await initAndLoad();
        expect(await swapReleaseGetDefaultIndex()).toBe(0);
    });

    it("persists a valid default index across a reload", async () => {
        await initAndLoad();
        await swapReleaseAddNew(WALLET_PASSWORD, "Custom", VALID_WQ, VALID_FACTORY, VALID_ROUTER);
        expect(await swapReleaseSetDefaultIndex(WALLET_PASSWORD, 1)).toBe(true);
        expect(await swapReleaseGetDefaultIndex()).toBe(1);

        await swapReleasesLoadAll(WALLET_PASSWORD);
        expect(await swapReleaseGetDefaultIndex()).toBe(1);
    });

    it("clamps an out-of-range index to 0", async () => {
        await initAndLoad();
        await swapReleaseSetDefaultIndex(WALLET_PASSWORD, 50);
        expect(await swapReleaseGetDefaultIndex()).toBe(0);
    });
});

describe("wrong password rejection", () => {
    it("swapReleasesLoadAll rejects with a wrong password", async () => {
        await initAndLoad();
        await expect(swapReleasesLoadAll("wrong-password")).rejects.toThrow("storageDecryptMainKey");
    });

    it("swapReleaseAddNew rejects with a wrong password and stores nothing", async () => {
        await initAndLoad();
        await expect(swapReleaseAddNew("wrong-password", "Custom", VALID_WQ, VALID_FACTORY, VALID_ROUTER)).rejects.toThrow("storageDecryptMainKey");
        expect(await swapReleaseGetMaxIndex()).toBe(0);
        expect((await swapReleasesList()).size).toBe(1);
    });

    it("swapReleaseSetDefaultIndex rejects with a wrong password and keeps the cached value", async () => {
        await initAndLoad();
        await swapReleaseAddNew(WALLET_PASSWORD, "Custom", VALID_WQ, VALID_FACTORY, VALID_ROUTER);
        await expect(swapReleaseSetDefaultIndex("wrong-password", 1)).rejects.toThrow("storageDecryptMainKey");
        expect(await swapReleaseGetDefaultIndex()).toBe(0);
    });
});

describe("undecryptable entries", () => {
    it("skips a corrupt entry past index 0 and loads the rest", async () => {
        await initAndLoad();
        await swapReleaseAddNew(WALLET_PASSWORD, "First", VALID_WQ, VALID_FACTORY, VALID_ROUTER);
        await swapReleaseAddNew(WALLET_PASSWORD, "Second", VALID_WQ, VALID_FACTORY, VALID_ROUTER);

        secureStore.set("SWAP_RELEASE_2_1", "not valid json");
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const releases = await swapReleasesLoadAll(WALLET_PASSWORD);
            expect(releases.size).toBe(2);
            expect(releases.has(0)).toBe(true);
            expect(releases.has(1)).toBe(false);
            expect((releases.get(2) as SwapRelease).name).toBe("Second");
            expect(warnSpy).toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });
});

describe("validation", () => {
    it("accepts only 0x + 64 hex chars as an address", () => {
        expect(isValidSwapReleaseAddress(VALID_WQ)).toBe(true);
        expect(isValidSwapReleaseAddress("0x" + "a".repeat(63))).toBe(false);
        expect(isValidSwapReleaseAddress("0x" + "a".repeat(65))).toBe(false);
        expect(isValidSwapReleaseAddress("0x" + "g".repeat(64))).toBe(false);
        expect(isValidSwapReleaseAddress("a".repeat(66))).toBe(false);
        expect(isValidSwapReleaseAddress("")).toBe(false);
        expect(isValidSwapReleaseAddress(null)).toBe(false);
        expect(isValidSwapReleaseAddress(123 as unknown as string)).toBe(false);
    });

    it("rejects unsafe or malformed names", () => {
        expect(isValidSwapReleaseName("Beta 1")).toBe(true);
        expect(isValidSwapReleaseName("")).toBe(false);
        expect(isValidSwapReleaseName("a".repeat(61))).toBe(false);
        expect(isValidSwapReleaseName(" padded")).toBe(false);
        expect(isValidSwapReleaseName("<script>")).toBe(false);
        expect(isValidSwapReleaseName("a&b")).toBe(false);
        expect(isValidSwapReleaseName("evil\u202Ename")).toBe(false);
        expect(isValidSwapReleaseName("zero\u200Bwidth")).toBe(false);
        expect(isValidSwapReleaseName(null)).toBe(false);
    });

    it("swapReleaseAddNew rejects an invalid address", async () => {
        await initAndLoad();
        await expect(swapReleaseAddNew(WALLET_PASSWORD, "Bad", "0x1234", VALID_FACTORY, VALID_ROUTER)).rejects.toThrow("invalid WQ contract address");
        expect(await swapReleaseGetMaxIndex()).toBe(0);
    });

    it("swapReleaseAddNew rejects an invalid name", async () => {
        await initAndLoad();
        await expect(swapReleaseAddNew(WALLET_PASSWORD, "<b>x</b>", VALID_WQ, VALID_FACTORY, VALID_ROUTER)).rejects.toThrow("invalid name");
        expect(await swapReleaseGetMaxIndex()).toBe(0);
    });
});
