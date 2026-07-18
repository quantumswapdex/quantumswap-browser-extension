// Cross-surface serialization (DUR-04). The wallet UI can be open at the same
// time as the side panel, the toolbar popup, a full tab, and the separate dApp
// approval popup -- all same-origin and all sharing window.localStorage. The Web
// Locks API serializes critical sections across every same-origin extension
// surface (available in Chrome and Firefox 121+). Two distinct lock names are
// used with a strict acquire order (VAULT outer, STORAGE_IO inner): the
// higher-level wallet-store mutations take QC_LOCK_VAULT, and each StorageApi
// write takes QC_LOCK_STORAGE_IO. StorageApi never takes QC_LOCK_VAULT, so the
// ordering is consistent and nested locking cannot deadlock.
export const QC_LOCK_VAULT = "qc-vault";
export const QC_LOCK_STORAGE_IO = "qc-storage-io";

export function qcWithLock<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    if (typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function") {
        return navigator.locks.request(name, fn as () => Promise<T>) as Promise<T>;
    }
    // Engines without the Web Locks API fall back to no cross-surface locking.
    return Promise.resolve().then(fn);
}
