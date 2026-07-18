// Wallet object model + encrypted persistence. TS port of the legacy
// public/js/wallet.js (keeping its DUR-03/DUR-04 durability hardening).
// The persisted wallet JSON shape {address, privateKey, publicKey, seed} and the
// WALLET_{n} / MaxWalletIndex key names are a storage compatibility contract.
import { base64ToBytes, bytesToBase64, cryptoNewSeed } from "./crypto";
import { computeAddressFromPublicKey, walletDecryptJson, walletEncryptJson, walletFromSeed } from "./bridge";
import {
    storageDoesItemExist,
    storageGetItem,
    storageGetSecureItem,
    storageMultiGetSecureItems,
    storageSetItem,
    storageSetSecureItem,
} from "./storage";
import { QC_LOCK_VAULT, qcWithLock } from "../platform/locks";

const MAX_WALLETS = 128;
const MAX_WALLET_INDEX_KEY = "MaxWalletIndex";
export const WALLET_KEY_PREFIX = "WALLET_";

let WALLET_ADDRESS_TO_INDEX_MAP = new Map<string, number>(); //key is address, value is index
let WALLET_INDEX_TO_ADDRESS_MAP = new Map<number, string>(); //key is index, value is address
let WALLET_ADDRESS_TO_INDEX_MAP_LOADED = false;

export class Wallet {
    address: string;
    privateKey: string | null;
    publicKey: string | null;
    seed: string | null;

    constructor(address: string, privateKey: string | null, publicKey: string | null, seed: string | null) {
        if (address.startsWith("0x") == false) {
            address = "0x" + address;
        }
        this.address = address;
        this.privateKey = privateKey;
        this.publicKey = publicKey;
        this.seed = seed;
    }

    async getPrivateKey(): Promise<string> {
        if (this.privateKey == null) {
            const seedArray = base64ToBytes(this.seed as string);
            const keyPair = await walletKeyPairFromSeed(seedArray);
            return keyPair.privateKey;
        } else {
            return this.privateKey;
        }
    }

    async getPublicKey(): Promise<string> {
        if (this.publicKey == null) {
            const seedArray = base64ToBytes(this.seed as string);
            const keyPair = await walletKeyPairFromSeed(seedArray);
            return keyPair.publicKey;
        } else {
            return this.publicKey;
        }
    }

    getSeedArray(): Uint8Array | null {
        if (this.seed == null) {
            return null;
        }
        return base64ToBytes(this.seed);
    }
}

export function isNumber(value: unknown): value is number {
    return typeof value === "number" && isFinite(value);
}

export async function walletGetAccountAddress(publicKeyBase64: string): Promise<string> {
    return await computeAddressFromPublicKey(publicKeyBase64);
}

export async function walletGetMaxIndex(): Promise<number> {
    const result = await storageGetItem(MAX_WALLET_INDEX_KEY);
    if (result == null) {
        return -1;
    }

    const maxWalletIndex = parseInt(result);

    if (isNumber(maxWalletIndex) == false) {
        throw new Error("MaxWalletIndex is not a number.");
    }

    // -1 is the valid "no wallets" sentinel written when reconciliation/rollback
    // (DUR-03) rolls the reserved index all the way back. Anything lower is corrupt.
    if (maxWalletIndex < -1 || maxWalletIndex > MAX_WALLETS) {
        throw new Error("MaxWalletIndex out of range.");
    }

    return maxWalletIndex;
}

export async function walletKeyPairFromSeed(seedArray: Uint8Array): Promise<{ privateKey: string; publicKey: string }> {
    const allowedLengths = [64, 72, 96];
    if (!allowedLengths.includes(seedArray.length)) {
        throw new Error("walletKeyPairFromSeed: unsupported seed length.");
    }

    const result = await walletFromSeed(seedArray);
    return { privateKey: result.privateKey, publicKey: result.publicKey };
}

export async function walletCreateNewWalletFromSeed(seedArray: Uint8Array): Promise<Wallet> {
    const result = await walletFromSeed(seedArray);
    const seedString = bytesToBase64(seedArray);
    return new Wallet(result.address, null, null, seedString);
}

export async function walletCreateNewWallet(): Promise<Wallet> {
    const seedArray = await cryptoNewSeed();
    return await walletCreateNewWalletFromSeed(seedArray);
}

export async function walletCreateNewWalletFromJson(walletJsonString: string, passphrase: string): Promise<Wallet> {
    const result = await walletDecryptJson(walletJsonString, passphrase);
    if (result == null) {
        throw new Error("walletCreateNewWalletFromJson walletDecryptJson failed");
    }

    return new Wallet(result.address, result.privateKey, result.publicKey, result.seed || null);
}

export async function walletSave(wallet: Wallet, passphrase: string): Promise<boolean> {
    // DUR-04: run the whole read-modify-write under the vault lock. The nested
    // load uses the internal (non-locking) variant because QC_LOCK_VAULT is not
    // reentrant; re-acquiring the same lock name would deadlock.
    return await qcWithLock(QC_LOCK_VAULT, async function () {
        return await walletSaveInternal(wallet, passphrase);
    });
}

async function walletSaveInternal(wallet: Wallet, passphrase: string): Promise<boolean> {
    if (WALLET_ADDRESS_TO_INDEX_MAP_LOADED == false) {
        await walletLoadAllInternal(passphrase);
    }

    if (WALLET_ADDRESS_TO_INDEX_MAP.has(wallet.address.toString().toLowerCase()) == true) {
        return false;
    }

    const previousMaxWalletIndex = await walletGetMaxIndex();
    const newIndex = previousMaxWalletIndex + 1;

    const key = WALLET_KEY_PREFIX + newIndex.toString();
    const keyExists = await storageDoesItemExist(key);
    if (keyExists == true) {
        return false;
    }

    // DUR-03: reserve the index FIRST, then write the wallet. If the process is
    // killed between the two writes, walletReconcileIndexInternal rolls the
    // dangling top index back on the next load, so the slot is reusable and future
    // adds are never permanently blocked (the alternative ordering orphaned the
    // wallet and wedged all subsequent adds).
    const indexStoreResult = await storageSetItem(MAX_WALLET_INDEX_KEY, newIndex.toString());
    if (indexStoreResult != true) {
        return false;
    }

    const walletJson = JSON.stringify(wallet);

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

export async function walletGetByIndex(passphrase: string, index: number): Promise<Wallet | null> {
    const key = WALLET_KEY_PREFIX + index.toString();
    const keyExists = await storageDoesItemExist(key);
    if (keyExists == false) {
        return null;
    }

    const walletJson = await storageGetSecureItem(passphrase, key);
    if (walletJson == null) {
        return null;
    }
    const tempWallet = JSON.parse(walletJson);
    return new Wallet(tempWallet.address, tempWallet.privateKey, tempWallet.publicKey, tempWallet.seed);
}

export async function walletGetByAddress(passphrase: string, address: string): Promise<Wallet | null> {
    address = address.toString().toLowerCase();
    if (WALLET_ADDRESS_TO_INDEX_MAP_LOADED == false) {
        await walletLoadAll(passphrase);
    }

    if (WALLET_ADDRESS_TO_INDEX_MAP.has(address) == false) {
        return null;
    }

    const wallet = await walletGetByIndex(passphrase, WALLET_ADDRESS_TO_INDEX_MAP.get(address) as number);
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
async function walletReconcileIndexInternal(): Promise<void> {
    const maxWalletIndex = await walletGetMaxIndex();
    let reconciledIndex = maxWalletIndex;
    while (reconciledIndex >= 0) {
        const key = WALLET_KEY_PREFIX + reconciledIndex.toString();
        const exists = await storageDoesItemExist(key);
        if (exists == true) {
            break;
        }
        reconciledIndex = reconciledIndex - 1;
    }

    if (reconciledIndex != maxWalletIndex) {
        const result = await storageSetItem(MAX_WALLET_INDEX_KEY, reconciledIndex.toString());
        if (result != true) {
            throw new Error("walletReconcileIndexInternal failed to persist reconciled index.");
        }
    }
}

export async function walletLoadAll(passphrase: string): Promise<any[]> {
    // DUR-04: serialize the full load (reconcile + read) against concurrent
    // mutations on other surfaces.
    return await qcWithLock(QC_LOCK_VAULT, async function () {
        return await walletLoadAllInternal(passphrase);
    });
}

async function walletLoadAllInternal(passphrase: string): Promise<any[]> {
    await walletReconcileIndexInternal();

    const maxWalletIndex = await walletGetMaxIndex();
    const walletKeyArray: string[] = [];
    for (let i = 0; i <= maxWalletIndex; i++) {
        walletKeyArray.push(WALLET_KEY_PREFIX + i.toString());
    }

    const walletJsonArray = await storageMultiGetSecureItems(passphrase, walletKeyArray);

    if (walletJsonArray.length != maxWalletIndex + 1) {
        throw new Error("walletLoadAll storageMultiGetSecureItems wallet count mismatch.");
    }

    const walletArray: any[] = [];
    WALLET_ADDRESS_TO_INDEX_MAP = new Map();
    WALLET_INDEX_TO_ADDRESS_MAP = new Map();
    for (let i = 0; i < walletJsonArray.length; i++) {
        const walletJson = walletJsonArray[i];
        if (walletJson == null) {
            throw new Error("walletLoadAll storageMultiGetSecureItems wallet entry is null.");
        }
        const wallet = JSON.parse(walletJson);
        if (wallet.address == null) {
            throw new Error("walletLoadAll storageMultiGetSecureItems wallet address is null.");
        }
        // Re-validate the address shape on load so a tampered/imported vault
        // record cannot inject a non-hex address that later reaches the DOM
        // (wallet-row listeners' args) or explorer URLs.
        if (typeof wallet.address !== "string" || /^0x[0-9a-fA-F]{64}$/.test(wallet.address) === false) {
            throw new Error("walletLoadAll wallet address has an invalid format.");
        }
        walletArray.push(wallet);
        WALLET_ADDRESS_TO_INDEX_MAP.set(wallet.address.toLowerCase(), i);
        WALLET_INDEX_TO_ADDRESS_MAP.set(i, wallet.address.toLowerCase());
    }

    WALLET_ADDRESS_TO_INDEX_MAP_LOADED = true;

    return walletArray;
}

export function walletGetCachedAddressToIndexMap(): Map<string, number> {
    return WALLET_ADDRESS_TO_INDEX_MAP;
}

export function walletGetCachedIndexToAddressMap(): Map<number, string> {
    return WALLET_INDEX_TO_ADDRESS_MAP;
}

export function walletDoesAddressExistInCache(address: string): boolean {
    return WALLET_ADDRESS_TO_INDEX_MAP.has(address.toLowerCase());
}

export async function walletGetAccountJsonFromWallet(wallet: Wallet, passphrase: string): Promise<string> {
    const privateKey = await wallet.getPrivateKey();
    const publicKey = await wallet.getPublicKey();
    return await walletEncryptJson(privateKey, publicKey, passphrase);
}

export async function walletGetAccountJson(privateKeyBase64: string, publicKeyBase64: string, passphrase: string): Promise<string> {
    return await walletEncryptJson(privateKeyBase64, publicKeyBase64, passphrase);
}
