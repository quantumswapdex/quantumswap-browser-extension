// Swap "releases": named deployments of the three core swap contracts
// (wrapped Q, factory, router). Port of the browser extension's
// public/js/release.js, but with wallet-style encrypted persistence: release
// entries and the default (active) index are stored with
// storageSetSecureItem/storageGetSecureItem (AES via the password-unlocked
// main key, same as WALLET_<n>), while the max index stays plaintext like
// MaxWalletIndex. The store is append-only (no delete); index 0 is seeded
// from BUILTIN_SWAP_RELEASES so users always have the official deployment.
//
// Because reads need the wallet password, the decrypted releases live in a
// module-level cache filled at unlock (swapReleasesLoadAll, mirroring
// walletLoadAll); list/get functions read only the cache.
import { htmlEncode, containsUnsafeDisplayText } from "./util";
import { storageGetItem, storageSetItem, storageGetSecureItem, storageSetSecureItem } from "./storage";

// "2" suffix/prefix: version bump over the short-lived plaintext "1" keys, so
// any plaintext entries written by earlier builds are orphaned, never read.
const MAX_SWAP_RELEASE_INDEX_KEY = "MaxSwapReleaseIndex2";
const DEFAULT_SWAP_RELEASE_INDEX_KEY = "DefaultSwapReleaseIndex2";
const SWAP_RELEASE_KEY_PREFIX = "SWAP_RELEASE_2_";
export const MAX_SWAP_RELEASES = 100;
export const MAX_SWAP_RELEASE_NAME_LENGTH = 60;

// Built-in release contract addresses. Duplicated from electron/rpc.ts because
// the main process is a separate TypeScript project; keep the two in sync.
export const BUILTIN_SWAP_RELEASES = [
    {
        name: "Beta 1",
        wq: "0x0E49c26cd1ca19bF8ddA2C8985B96783288458754757F4C9E00a5439A7291628",
        factory: "0xbbF45a1B60044669793B444eD01Eb33e03Bb8cf3c5b6ae7887B218D05C5Cbf1d",
        router: "0x41323EF72662185f44a03ea0ad8094a0C9e925aB1102679D8e957e838054aac5",
        builtin: true,
    },
];

export function isValidSwapReleaseAddress(address: unknown): boolean {
    if (address == null || typeof address !== "string") {
        return false;
    }
    return /^0x[0-9a-fA-F]{64}$/.test(address.trim());
}

// A display-safe release name: trimmed, bounded, and inert when rendered
// (htmlEncode-stable means it contains no HTML-special characters, and
// containsUnsafeDisplayText rejects bidi/zero-width/control spoofing).
export function isValidSwapReleaseName(name: unknown): boolean {
    if (name == null || typeof name !== "string") {
        return false;
    }
    if (name.length < 1 || name.length > MAX_SWAP_RELEASE_NAME_LENGTH) {
        return false;
    }
    if (name.trim().length != name.length) {
        return false;
    }
    if (htmlEncode(name) !== name) {
        return false;
    }
    if (containsUnsafeDisplayText(name)) {
        return false;
    }
    return true;
}

export class SwapRelease {
    name: string;
    wq: string;
    factory: string;
    router: string;
    builtin: boolean;
    index: number;

    constructor(name: unknown, wq: unknown, factory: unknown, router: unknown, builtin: unknown, index: number) {
        if (name == null || wq == null || factory == null || router == null) {
            throw new Error("SwapRelease null values");
        }

        const nameStr = String(name).trim();
        if (isValidSwapReleaseName(nameStr) == false) {
            throw new Error("SwapRelease invalid name");
        }

        const wqStr = String(wq).trim();
        const factoryStr = String(factory).trim();
        const routerStr = String(router).trim();
        if (isValidSwapReleaseAddress(wqStr) == false) {
            throw new Error("SwapRelease invalid WQ contract address");
        }
        if (isValidSwapReleaseAddress(factoryStr) == false) {
            throw new Error("SwapRelease invalid factory contract address");
        }
        if (isValidSwapReleaseAddress(routerStr) == false) {
            throw new Error("SwapRelease invalid router contract address");
        }

        this.name = nameStr;
        this.wq = wqStr;
        this.factory = factoryStr;
        this.router = routerStr;
        this.builtin = builtin === true;
        this.index = index;
    }
}

// Decrypted-release cache, filled at unlock (mirrors the wallet maps in
// wallet.ts). All post-unlock reads come from here; writes update it in place.
let SWAP_RELEASE_INDEX_TO_RELEASE_MAP = new Map<number, SwapRelease>();
let SWAP_RELEASE_CACHED_DEFAULT_INDEX = 0;
let SWAP_RELEASES_LOADED = false;

export async function swapReleaseGetMaxIndex(): Promise<number> {
    const result = await storageGetItem(MAX_SWAP_RELEASE_INDEX_KEY);
    if (result == null) {
        return -1;
    }

    const maxIndex = parseInt(result, 10);

    if (Number.isInteger(maxIndex) == false) {
        throw new Error("swapReleaseGetMaxIndex maxIndex is not a number.");
    }

    if (maxIndex < 0 || maxIndex > MAX_SWAP_RELEASES) {
        throw new Error("swapReleaseGetMaxIndex maxIndex out of range.");
    }

    return maxIndex;
}

export async function swapReleasesInit(passphrase: string): Promise<void> {
    const result = await swapReleaseGetMaxIndex();
    if (result == -1) {
        await swapReleaseSaveDefaults(passphrase);
    }
}

export async function swapReleaseSaveDefaults(passphrase: string): Promise<void> {
    const builtinReleases = BUILTIN_SWAP_RELEASES;
    if (builtinReleases == null || builtinReleases.length < 1) {
        throw new Error("swapReleaseSaveDefaults built-in releases unavailable");
    }

    for (let i = 0; i < builtinReleases.length; i++) {
        const releaseItem = JSON.stringify({
            name: builtinReleases[i].name,
            wq: builtinReleases[i].wq,
            factory: builtinReleases[i].factory,
            router: builtinReleases[i].router,
            builtin: true,
        });
        const key = SWAP_RELEASE_KEY_PREFIX + i.toString();

        const itemStoreResult = await storageSetSecureItem(passphrase, key, releaseItem);
        if (itemStoreResult != true) {
            throw new Error("swapReleaseSaveDefaults item store failed");
        }
    }

    const indexStoreResult = await storageSetItem(MAX_SWAP_RELEASE_INDEX_KEY, (builtinReleases.length - 1).toString());
    if (indexStoreResult != true) {
        throw new Error("swapReleaseSaveDefaults index store failed");
    }
}

// Decrypt every stored release plus the default index into the cache. Called
// at unlock (and after first-wallet creation) with the wallet password; a
// wrong password throws from storageDecryptMainKey. Individual entries that
// fail to parse/validate are skipped with a warning so one corrupt entry does
// not take down the whole list.
export async function swapReleasesLoadAll(passphrase: string): Promise<Map<number, SwapRelease>> {
    const releaseMap = new Map<number, SwapRelease>();
    const maxIndex = await swapReleaseGetMaxIndex();
    for (let i = 0; i <= maxIndex; i++) {
        const key = SWAP_RELEASE_KEY_PREFIX + i.toString();
        try {
            const releaseJson = await storageGetSecureItem(passphrase, key);
            if (releaseJson == null || releaseJson === "") {
                console.warn("quantumswapwallet: missing release storage entry " + key);
                continue;
            }
            const releaseItem = JSON.parse(releaseJson);
            const swapRelease = new SwapRelease(releaseItem.name, releaseItem.wq, releaseItem.factory, releaseItem.router, releaseItem.builtin, i);
            releaseMap.set(i, swapRelease);
        } catch (error) {
            // A wrong passphrase fails on the very first entry (the main-key
            // decrypt), before anything was cached: rethrow so unlock-style
            // callers see it. Later entries failing means corrupt data: skip.
            if (i === 0 && releaseMap.size === 0) {
                throw error;
            }
            console.warn("quantumswapwallet: unreadable release storage entry " + key + " " + String(error));
        }
    }

    let defaultIndex = 0;
    const defaultIndexJson = await storageGetSecureItem(passphrase, DEFAULT_SWAP_RELEASE_INDEX_KEY);
    if (defaultIndexJson != null) {
        const parsed = parseInt(defaultIndexJson, 10);
        if (Number.isInteger(parsed) == false || parsed < 0 || parsed > MAX_SWAP_RELEASES) {
            throw new Error("swapReleasesLoadAll defaultIndex out of range.");
        }
        defaultIndex = parsed;
    }

    SWAP_RELEASE_INDEX_TO_RELEASE_MAP = releaseMap;
    SWAP_RELEASE_CACHED_DEFAULT_INDEX = defaultIndex;
    SWAP_RELEASES_LOADED = true;

    return releaseMap;
}

export function swapReleasesAreLoaded(): boolean {
    return SWAP_RELEASES_LOADED;
}

export async function swapReleaseAddNew(passphrase: string, name: unknown, wq: unknown, factory: unknown, router: unknown): Promise<SwapRelease> {
    let maxIndex = await swapReleaseGetMaxIndex();
    if (maxIndex >= MAX_SWAP_RELEASES) {
        throw new Error("swapReleaseAddNew too many releases");
    }
    maxIndex = maxIndex + 1;
    const swapRelease = new SwapRelease(name, wq, factory, router, false, maxIndex);
    const key = SWAP_RELEASE_KEY_PREFIX + maxIndex.toString();

    const stored = {
        name: swapRelease.name,
        wq: swapRelease.wq,
        factory: swapRelease.factory,
        router: swapRelease.router,
        builtin: false,
    };
    const itemStoreResult = await storageSetSecureItem(passphrase, key, JSON.stringify(stored));
    if (itemStoreResult != true) {
        throw new Error("swapReleaseAddNew item store failed");
    }

    const indexStoreResult = await storageSetItem(MAX_SWAP_RELEASE_INDEX_KEY, maxIndex.toString());
    if (indexStoreResult != true) {
        throw new Error("swapReleaseAddNew item store index failed");
    }

    SWAP_RELEASE_INDEX_TO_RELEASE_MAP.set(maxIndex, swapRelease);
    return swapRelease;
}

// Post-unlock reads come from the cache; no password needed.
export async function swapReleasesList(): Promise<Map<number, SwapRelease>> {
    return SWAP_RELEASE_INDEX_TO_RELEASE_MAP;
}

export async function swapReleaseSetDefaultIndex(passphrase: string, index: number): Promise<boolean> {
    const maxIndex = await swapReleaseGetMaxIndex();
    let idx = parseInt(String(index), 10);
    if (Number.isInteger(idx) == false || idx < 0 || idx > maxIndex) {
        idx = 0;
    }

    const itemStoreResult = await storageSetSecureItem(passphrase, DEFAULT_SWAP_RELEASE_INDEX_KEY, idx.toString());
    if (itemStoreResult != true) {
        throw new Error("swapReleaseSetDefaultIndex item store failed");
    }

    SWAP_RELEASE_CACHED_DEFAULT_INDEX = idx;
    return true;
}

export async function swapReleaseGetDefaultIndex(): Promise<number> {
    return SWAP_RELEASE_CACHED_DEFAULT_INDEX;
}
