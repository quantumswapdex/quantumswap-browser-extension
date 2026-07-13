// Swap "releases": named deployments of the three core swap contracts
// (wrapped Q, factory, router). Mirrors the blockchain-network persistence
// model (blockchain-network.js): append-only storage entries with a max index
// and a default (active) index; no delete. Index 0 is seeded from
// window.BUILTIN_SWAP_RELEASES (exposed by the platform bridge from
// src/bridge/release-constants.js) so the addresses are never duplicated here.
const MAX_SWAP_RELEASE_INDEX_KEY = "MaxSwapReleaseIndex1";
const DEFAULT_SWAP_RELEASE_INDEX_KEY = "DefaultSwapReleaseIndex1";
const SWAP_RELEASE_KEY_PREFIX = "SWAP_RELEASE_1_";
const MAX_SWAP_RELEASES = 100;
const MAX_SWAP_RELEASE_NAME_LENGTH = 60;

var swapReleaseIndexToReleaseMap = new Map(); //key is index, value is SwapRelease

// The active release; loaded at boot (showSwapReleases in app.js) and after
// every add/switch. null until swapReleasesInit has run.
var currentSwapRelease = null;

function isValidSwapReleaseAddress(address) {
    if (address == null || typeof address !== "string") {
        return false;
    }
    return /^0x[0-9a-fA-F]{64}$/.test(address.trim());
}

// A display-safe release name: trimmed, bounded, and inert when rendered
// (htmlEncode-stable means it contains no HTML-special characters, and
// containsUnsafeDisplayText rejects bidi/zero-width/control spoofing).
function isValidSwapReleaseName(name) {
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

class SwapRelease {
    constructor(name, wq, factory, router, builtin, index) {
        if (name == null || wq == null || factory == null || router == null) {
            throw new Error("SwapRelease null values");
        }

        name = String(name).trim();
        if (isValidSwapReleaseName(name) == false) {
            throw new Error("SwapRelease invalid name");
        }

        wq = String(wq).trim();
        factory = String(factory).trim();
        router = String(router).trim();
        if (isValidSwapReleaseAddress(wq) == false) {
            throw new Error("SwapRelease invalid WQ contract address");
        }
        if (isValidSwapReleaseAddress(factory) == false) {
            throw new Error("SwapRelease invalid factory contract address");
        }
        if (isValidSwapReleaseAddress(router) == false) {
            throw new Error("SwapRelease invalid router contract address");
        }

        this.name = name;
        this.wq = wq;
        this.factory = factory;
        this.router = router;
        this.builtin = builtin === true;
        this.index = index;
    }
}

async function swapReleaseGetMaxIndex() {
    let result = await storageGetItem(MAX_SWAP_RELEASE_INDEX_KEY);
    if (result == null) {
        return -1;
    }

    let maxIndex = parseInt(result);

    if (isNumber(maxIndex) == false) {
        throw new Error('swapReleaseGetMaxIndex maxIndex is not a number.');
    }

    if (maxIndex < 0 || maxIndex > MAX_SWAP_RELEASES) {
        throw new Error('swapReleaseGetMaxIndex maxIndex out of range.');
    }

    return maxIndex;
}

async function swapReleasesInit() {
    let result = await swapReleaseGetMaxIndex();
    if (result == -1) {
        await swapReleaseSaveDefaults();
    }
}

async function swapReleaseSaveDefaults() {
    let builtinReleases = window.BUILTIN_SWAP_RELEASES;
    if (builtinReleases == null || builtinReleases.length < 1) {
        throw new Error("swapReleaseSaveDefaults built-in releases unavailable");
    }

    for (var i = 0; i < builtinReleases.length; i++) {
        let releaseItem = JSON.stringify({
            name: builtinReleases[i].name,
            wq: builtinReleases[i].wq,
            factory: builtinReleases[i].factory,
            router: builtinReleases[i].router,
            builtin: true
        });
        let key = SWAP_RELEASE_KEY_PREFIX + i.toString();

        let itemStoreResult = await storageSetItem(key, releaseItem);
        if (itemStoreResult != true) {
            throw new Error("swapReleaseSaveDefaults item store failed");
        }
    }

    let indexStoreResult = await storageSetItem(MAX_SWAP_RELEASE_INDEX_KEY, (builtinReleases.length - 1).toString());
    if (indexStoreResult != true) {
        throw new Error("swapReleaseSaveDefaults index store failed");
    }
}

async function swapReleaseAddNew(name, wq, factory, router) {
    let maxIndex = await swapReleaseGetMaxIndex();
    if (maxIndex >= MAX_SWAP_RELEASES) {
        throw new Error("swapReleaseAddNew too many releases");
    }
    maxIndex = maxIndex + 1;
    let swapRelease = new SwapRelease(name, wq, factory, router, false, maxIndex);
    let key = SWAP_RELEASE_KEY_PREFIX + maxIndex.toString();

    const stored = {
        name: swapRelease.name,
        wq: swapRelease.wq,
        factory: swapRelease.factory,
        router: swapRelease.router,
        builtin: false
    };
    let itemStoreResult = await storageSetItem(key, JSON.stringify(stored));
    if (itemStoreResult != true) {
        throw new Error("swapReleaseAddNew item store failed");
    }

    itemStoreResult = await storageSetItem(MAX_SWAP_RELEASE_INDEX_KEY, maxIndex.toString());
    if (itemStoreResult != true) {
        throw new Error("swapReleaseAddNew item store index failed");
    }

    swapReleaseIndexToReleaseMap.set(maxIndex, swapRelease);
    return swapRelease;
}

async function swapReleasesList() {
    swapReleaseIndexToReleaseMap = new Map();
    let maxIndex = await swapReleaseGetMaxIndex();
    for (var i = 0; i <= maxIndex; i++) {
        let key = SWAP_RELEASE_KEY_PREFIX + i.toString();
        let releaseJson = await storageGetItem(key);
        if (releaseJson == null || releaseJson === "") {
            console.warn("quantumswapwallet: missing release storage entry " + key);
            continue;
        }
        let releaseItem = JSON.parse(releaseJson);
        let swapRelease = new SwapRelease(releaseItem.name, releaseItem.wq, releaseItem.factory, releaseItem.router, releaseItem.builtin, i);
        swapReleaseIndexToReleaseMap.set(i, swapRelease);
    }

    return swapReleaseIndexToReleaseMap;
}

async function swapReleaseSetDefaultIndex(index) {
    let result = await swapReleaseGetMaxIndex();
    index = parseInt(index);
    if (result == null || isNumber(index) == false || index < 0 || index > result) {
        index = 0;
    }

    let itemStoreResult = await storageSetItem(DEFAULT_SWAP_RELEASE_INDEX_KEY, index);
    if (itemStoreResult != true) {
        throw new Error("swapReleaseSetDefaultIndex item store failed");
    }

    return true;
}

async function swapReleaseGetDefaultIndex() {
    let result = await storageGetItem(DEFAULT_SWAP_RELEASE_INDEX_KEY);
    if (result == null) {
        return 0;
    }

    let defaultIndex = parseInt(result);

    if (isNumber(defaultIndex) == false) {
        throw new Error('swapReleaseGetDefaultIndex defaultIndex is not a number.');
    }

    if (defaultIndex < 0 || defaultIndex > MAX_SWAP_RELEASES) {
        throw new Error('swapReleaseGetDefaultIndex defaultIndex out of range.');
    }

    return defaultIndex;
}
