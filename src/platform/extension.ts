// Extension platform helpers shared by the wallet renderer: access to the
// WebExtension API namespace and the best-effort dApp-broker notifications the
// legacy public/js/app.js sent (chrome.storage.session address publishing and
// runtime messages the background broker listens for).

type ExtApi = any;

export function extApi(): ExtApi {
    const g = globalThis as { chrome?: any; browser?: any };
    return g.browser || g.chrome;
}

// Publish the currently-open wallet address to chrome.storage.session so the
// separate dApp approval popup (approve.html) can prefill the default account.
// Only the public address is shared (never the password); the popup still
// requires the password to sign. Session storage is in-memory and shared across
// extension contexts, and is cleared when the browser fully closes.
export function qcSessionSetAddress(address: string): void {
    try {
        const api = extApi();
        if (api && api.storage && api.storage.session) {
            api.storage.session.set({ qc_current_address: address });
        }
    } catch { /* non-fatal */ }
}

export function qcSessionClearAddress(): void {
    try {
        const api = extApi();
        if (api && api.storage && api.storage.session) {
            api.storage.session.remove("qc_current_address");
        }
    } catch { /* non-fatal */ }
}

// Tell the dApp broker (background) that the active wallet changed, so it can
// repoint every connected site to the new address and emit accountsChanged.
export function qcNotifyActiveAccountChanged(address: string): void {
    try {
        const api = extApi();
        if (api && api.runtime && api.runtime.sendMessage) {
            api.runtime.sendMessage({ type: "qc-active-account-changed", address: address });
        }
    } catch { /* non-fatal */ }
}

// Tell the dApp broker (background) that the active network changed, so it can
// repoint every connected site to the new chainId/RPC and emit the standard
// chainChanged event to connected dApps.
export function qcNotifyActiveNetworkChanged(chainId: number, network: unknown): void {
    try {
        const api = extApi();
        if (api && api.runtime && api.runtime.sendMessage) {
            api.runtime.sendMessage({ type: "qc-active-network-changed", chainId: chainId, network: network });
        }
    } catch { /* non-fatal */ }
}
