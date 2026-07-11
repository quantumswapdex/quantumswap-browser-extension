"use strict";

const MAX_WALLETS = 128;
const MAX_WALLET_INDEX_KEY = "MaxWalletIndex";
const WALLET_KEY_PREFIX = "WALLET_";

var WALLET_ADDRESS_TO_INDEX_MAP = new Map(); //key is address, value is index
var WALLET_INDEX_TO_ADDRESS_MAP = new Map(); //key is index, value is address
var WALLET_ADDRESS_TO_INDEX_MAP_LOADED = false;

class Wallet {
    constructor(address, privateKey, publicKey, seed) {
        if (address.startsWith("0x") == false) {
            address = "0x" + address
        }
        this.address = address;
        this.privateKey = privateKey;
        this.publicKey = publicKey;
        this.seed = seed;
    }

    async getPrivateKey() {
        if (this.privateKey == null) {
            let seedArray = base64ToBytes(this.seed);
            let keyPair = await walletKeyPairFromSeed(seedArray);
            return keyPair.privateKey;
        } else {
            return this.privateKey;
        }
    }

    async getPublicKey() {
        if (this.publicKey == null) {
            let seedArray = base64ToBytes(this.seed);
            let keyPair = await walletKeyPairFromSeed(seedArray);
            return keyPair.publicKey;
        } else {
            return this.publicKey;
        }
    }

    getSeedArray() {
        if (this.seed == null) {
            return null;
        }
        return base64ToBytes(this.seed);
    }
}

function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
}

async function walletGetAccountAddress(publicKeyBase64) {
    let address = await computeAddressFromPublicKey(publicKeyBase64);
    return address;
}

async function walletGetMaxIndex() {
    let result = await storageGetItem(MAX_WALLET_INDEX_KEY);
    if (result == null) {
        return -1;
    }

    let maxWalletIndex = parseInt(result);

    if (isNumber(maxWalletIndex) == false) {
        throw new Error('MaxWalletIndex is not a number.');
    }

    // -1 is the valid "no wallets" sentinel written when reconciliation/rollback
    // (DUR-03) rolls the reserved index all the way back. Anything lower is corrupt.
    if (maxWalletIndex < -1 || maxWalletIndex > MAX_WALLETS) {
        throw new Error('MaxWalletIndex out of range.');
    }

    return maxWalletIndex;
}

async function walletKeyPairFromSeed(seedArray) {
    const allowedLengths = [64, 72, 96];
    if (!allowedLengths.includes(seedArray.length)) {
        throw new Error('walletKeyPairFromSeed: unsupported seed length.');
    }

    let result = await walletFromSeed(seedArray);
    return { privateKey: result.privateKey, publicKey: result.publicKey };
}

async function walletCreateNewWalletFromSeed(seedArray) {
    let result = await walletFromSeed(seedArray);
    let seedString = bytesToBase64(seedArray);
    let wallet = new Wallet(result.address, null, null, seedString);
    return wallet;
}

async function walletCreateNewWallet() {
    let seedArray = await cryptoNewSeed();
    let wallet = await walletCreateNewWalletFromSeed(seedArray);
    return wallet;
}

async function walletCreateNewWalletFromJson(walletJsonString, passphrase) {
    let result = await walletDecryptJson(walletJsonString, passphrase);
    if (result == null) {
        throw new Error('walletCreateNewWalletFromJson walletDecryptJson failed');
    }

    let wallet = new Wallet(result.address, result.privateKey, result.publicKey, result.seed || null);
    return wallet;
}

async function walletSave(wallet, passphrase) {
    // DUR-04: run the whole read-modify-write under the vault lock. The nested
    // load uses the internal (non-locking) variant because QC_LOCK_VAULT is not
    // reentrant; re-acquiring the same lock name would deadlock.
    return await qcWithLock(QC_LOCK_VAULT, async function () {
        return await walletSaveInternal(wallet, passphrase);
    });
}

async function walletSaveInternal(wallet, passphrase) {
    if (WALLET_ADDRESS_TO_INDEX_MAP_LOADED == false) {
        await walletLoadAllInternal(passphrase);
    }

    if (WALLET_ADDRESS_TO_INDEX_MAP.has(wallet.address.toString().toLowerCase()) == true) {
        return false;
    }

    let previousMaxWalletIndex = await walletGetMaxIndex();
    let newIndex = previousMaxWalletIndex + 1;

    let key = WALLET_KEY_PREFIX + newIndex.toString();
    let keyExists = await storageDoesItemExist(key);
    if (keyExists == true) {
        return false;
    }

    // DUR-03: reserve the index FIRST, then write the wallet. If the process is
    // killed between the two writes, walletReconcileIndexInternal rolls the
    // dangling top index back on the next load, so the slot is reusable and future
    // adds are never permanently blocked (the alternative ordering orphaned the
    // wallet and wedged all subsequent adds).
    let indexStoreResult = await storageSetItem(MAX_WALLET_INDEX_KEY, newIndex.toString());
    if (indexStoreResult != true) {
        return false;
    }

    let walletJson = JSON.stringify(wallet);

    let walletStoreResult = false;
    try {
        walletStoreResult = await storageSetSecureItem(passphrase, key, walletJson);
    } catch (walletWriteError) {
        // Best-effort rollback so we don't leave a reserved-but-empty top slot.
        await storageSetItem(MAX_WALLET_INDEX_KEY, previousMaxWalletIndex.toString());
        throw walletWriteError;
    }

    if (walletStoreResult != true) {
        await storageSetItem(MAX_WALLET_INDEX_KEY, previousMaxWalletIndex.toString());
        return false;
    }

    WALLET_ADDRESS_TO_INDEX_MAP.set(wallet.address.toString().toLowerCase(), newIndex);
    WALLET_INDEX_TO_ADDRESS_MAP.set(newIndex, wallet.address.toString().toLowerCase());

    return true;
}

async function walletGetByIndex(passphrase, index) {
    let key = WALLET_KEY_PREFIX + index.toString();
    let keyExists = await storageDoesItemExist(key);
    if (keyExists == false) {
        return null;
    }

    let walletJson = await storageGetSecureItem(passphrase, key);
    if (walletJson == null) {
        return null;
    }
    let tempWallet = JSON.parse(walletJson);
    let wallet = new Wallet(tempWallet.address, tempWallet.privateKey, tempWallet.publicKey, tempWallet.seed)
    return wallet;
}

async function walletGetByAddress(passphrase, address) {
    address = address.toString().toLowerCase();
    if (WALLET_ADDRESS_TO_INDEX_MAP_LOADED == false) {
        await walletLoadAll(passphrase);
    }

    if (WALLET_ADDRESS_TO_INDEX_MAP.has(address) == false) {
        return null;
    }

    let wallet = await walletGetByIndex(passphrase, WALLET_ADDRESS_TO_INDEX_MAP.get(address));
    if (wallet == null) {
        return null;
    }

    if (wallet.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error("walletGetByAddress address mismatch");
    }

    return wallet;
}

// DUR-03: roll back a reserved-but-uncommitted top index left by an interrupted
// walletSave. Only the trailing slot can dangle (index-first guarantees every
// WALLET_<k> for k < n was committed before n was reserved), so we walk down from
// the stored max while the top WALLET_<n> is absent and persist the corrected max.
// A missing middle slot is real corruption (DUR-06) and is intentionally left for
// the load path to surface.
async function walletReconcileIndexInternal() {
    let maxWalletIndex = await walletGetMaxIndex();
    let reconciledIndex = maxWalletIndex;
    while (reconciledIndex >= 0) {
        let key = WALLET_KEY_PREFIX + reconciledIndex.toString();
        let exists = await storageDoesItemExist(key);
        if (exists == true) {
            break;
        }
        reconciledIndex = reconciledIndex - 1;
    }

    if (reconciledIndex != maxWalletIndex) {
        let result = await storageSetItem(MAX_WALLET_INDEX_KEY, reconciledIndex.toString());
        if (result != true) {
            throw new Error('walletReconcileIndexInternal failed to persist reconciled index.');
        }
    }
}

async function walletLoadAll(passphrase) {
    // DUR-04: serialize the full load (reconcile + read) against concurrent
    // mutations on other surfaces.
    return await qcWithLock(QC_LOCK_VAULT, async function () {
        return await walletLoadAllInternal(passphrase);
    });
}

async function walletLoadAllInternal(passphrase) {
    await walletReconcileIndexInternal();

    let maxWalletIndex = await walletGetMaxIndex();
    let walletKeyArray = [];
    for (var i = 0; i <= maxWalletIndex; i++) {
        let key = WALLET_KEY_PREFIX + i.toString();
        walletKeyArray.push(key);
    }

    let walletJsonArray = await storageMultiGetSecureItems(passphrase, walletKeyArray);
    
    if (walletJsonArray.length != maxWalletIndex + 1) {
        throw new Error('walletLoadAll storageMultiGetSecureItems wallet count mismatch.');
    }

    let walletArray = [];
    WALLET_ADDRESS_TO_INDEX_MAP = new Map();
    WALLET_INDEX_TO_ADDRESS_MAP = new Map();
    for (var i = 0; i < walletJsonArray.length; i++) {
        if (walletJsonArray[i] == null) {
            throw new Error('walletLoadAll storageMultiGetSecureItems wallet entry is null.');
        }
        let wallet = JSON.parse(walletJsonArray[i]);
        if (wallet.address == null) {
            throw new Error('walletLoadAll storageMultiGetSecureItems wallet address is null.');
        }
        // item 14: re-validate the address shape on load so a tampered/imported
        // vault record cannot inject a non-hex address that later reaches the DOM
        // (wallet-row onclick args) or explorer URLs.
        if (typeof wallet.address !== 'string' || /^0x[0-9a-fA-F]{64}$/.test(wallet.address) === false) {
            throw new Error('walletLoadAll wallet address has an invalid format.');
        }
        walletArray.push(wallet);
        WALLET_ADDRESS_TO_INDEX_MAP.set(wallet.address.toLowerCase(), i);
        WALLET_INDEX_TO_ADDRESS_MAP.set(i, wallet.address.toLowerCase());
    }

    WALLET_ADDRESS_TO_INDEX_MAP_LOADED = true;

    return walletArray;
}

function walletGetCachedAddressToIndexMap() {
    return WALLET_ADDRESS_TO_INDEX_MAP;
}

function walletGetCachedIndexToAddressMap() {
    return WALLET_INDEX_TO_ADDRESS_MAP;
}

function walletDoesAddressExistInCache(address) {
    return WALLET_ADDRESS_TO_INDEX_MAP.has(address.toLowerCase());
}

async function walletGetAccountJsonFromWallet(wallet, passphrase) {
    let privateKey = await wallet.getPrivateKey();
    let publicKey = await wallet.getPublicKey();
    return await walletEncryptJson(privateKey, publicKey, passphrase);
}

async function walletGetAccountJson(privateKeyBase64, publicKeyBase64, passphrase) {
    return await walletEncryptJson(privateKeyBase64, publicKeyBase64, passphrase);
}
