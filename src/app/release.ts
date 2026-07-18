// Swap releases (Settings > Releases): screen handlers, the active-release
// state, the custom-release banner and swap payload stamping. Port of the
// release sections of the browser extension's public/js/app.js.
import { htmlEncode, containsUnsafeDisplayText } from "../lib/util";
import { langJson } from "../lib/i18n";
import {
    SwapRelease,
    swapReleaseGetDefaultIndex,
    swapReleaseSetDefaultIndex,
    swapReleaseAddNew,
    swapReleasesList,
} from "../lib/release";
import { OpenUrl } from "../lib/bridge";
import {
    ADDRESS_TEMPLATE,
    BLOCK_EXPLORER_ACCOUNT_TEMPLATE,
    BLOCK_EXPLORER_DOMAIN_TEMPLATE,
    byId,
    inputById,
    getShortAddress,
    networkStore,
} from "./state";
import {
    showAlertAndExecuteOnClose,
    showConfirmAndExecuteOnConfirm,
    showReleasePasswordDialog,
    showWarnAlert,
    showYesNoConfirm,
} from "./dialog";
import { updateSwapRoutePathDisplay } from "./swap";

// The active release; loaded at unlock (loadSwapReleases in app.ts) and after
// every add/switch. null until refreshCurrentSwapRelease has run.
export let currentSwapRelease: SwapRelease | null = null;

export async function refreshCurrentSwapRelease(): Promise<void> {
    const releaseMap = await swapReleasesList();
    let defaultIndex = await swapReleaseGetDefaultIndex();
    const sortedKeys = [...releaseMap.keys()].sort((a, b) => a - b);
    if (sortedKeys.length > 0 && !releaseMap.has(defaultIndex)) {
        // In-memory fallback only: persisting the corrected index would need
        // the wallet password (the default index is stored encrypted).
        defaultIndex = sortedKeys[0];
    }
    currentSwapRelease = releaseMap.get(defaultIndex) || null;
    updateCustomReleaseBanner();
}

// The banner is suppressed while no wallet is unlocked (unlock/onboarding
// screens); gated from setWalletMenuEnabled in app.ts, the same lock/unlock
// choke point that shows and hides the burger menu.
let customReleaseBannerAllowed = false;

export function setCustomReleaseBannerAllowed(allowed: boolean): void {
    customReleaseBannerAllowed = allowed;
    updateCustomReleaseBanner();
}

// Standout banner just below the logo, shown only when the active release is
// not a built-in one. The name is user/storage data: it was validated on add,
// but is re-checked here and rendered via textContent only; on failure the
// banner falls back to a generic label instead of the name.
export function updateCustomReleaseBanner(): void {
    const banner = byId("divCustomReleaseBanner");
    if (!banner) return;
    if (!customReleaseBannerAllowed || !currentSwapRelease || currentSwapRelease.builtin === true) {
        banner.textContent = "";
        banner.style.display = "none";
        return;
    }
    const prefix = (langJson && langJson.langValues && langJson.langValues["custom-release-banner-prefix"]) || "Custom release: ";
    let name = String(currentSwapRelease.name || "");
    if (name === "" || htmlEncode(name) !== name || containsUnsafeDisplayText(name)) {
        name = "(unnamed)";
    }
    banner.textContent = prefix + name;
    banner.style.display = "block";
}

// Stamp the active release's contract addresses onto a swap payload. The
// electron handlers fall back to the built-in constants when absent.
export function applySwapReleaseToPayload<T extends Record<string, unknown>>(payload: T): T {
    if (!payload) return payload;
    if (currentSwapRelease != null) {
        (payload as Record<string, unknown>).releaseWq = currentSwapRelease.wq;
        (payload as Record<string, unknown>).releaseFactory = currentSwapRelease.factory;
        (payload as Record<string, unknown>).releaseRouter = currentSwapRelease.router;
    }
    return payload;
}

export async function showReleasesScreen(): Promise<boolean> {
    byId("settings-content").style.display = "block";
    byId("settingsScreen").style.display = "none";
    byId("releaseListScreen").style.display = "block";
    byId("releaseAddScreen").style.display = "none";
    await showSwapReleasesTable();
    return false;
}

// Rows are built with createElement/textContent only: name and addresses are
// storage-backed (user-entered) data and must never reach innerHTML.
export async function showSwapReleasesTable(): Promise<void> {
    const releaseMap = await swapReleasesList();
    const defaultIndex = await swapReleaseGetDefaultIndex();
    const tbody = byId("tbodyReleaseRow");
    tbody.textContent = "";
    const sortedEntries = [...releaseMap.entries()].sort((a, b) => a[0] - b[0]);
    const lv = (langJson && langJson.langValues) || {};
    for (const [index, releaseItem] of sortedEntries) {
        const tr = document.createElement("tr");

        const tdActive = document.createElement("td");
        tdActive.style.textAlign = "center";
        tdActive.textContent = (index === defaultIndex) ? "\u2713" : "";
        tr.appendChild(tdActive);

        const tdName = document.createElement("td");
        tdName.textContent = releaseItem.name;
        tr.appendChild(tdName);

        // Same explorer-account URL pattern as the swap contract links; the
        // release addresses are 0x+64-hex validated on add, so they are safe
        // to substitute into the URL template.
        const explorerBase = networkStore.currentBlockchainNetwork
            ? BLOCK_EXPLORER_ACCOUNT_TEMPLATE.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, (networkStore.currentBlockchainNetwork as { blockExplorerDomain: string }).blockExplorerDomain)
            : "";
        for (const addr of [releaseItem.wq, releaseItem.factory, releaseItem.router]) {
            const td = document.createElement("td");
            const addrStr = String(addr);
            if (explorerBase !== "") {
                const link = document.createElement("a");
                const url = explorerBase.replace(ADDRESS_TEMPLATE, addrStr);
                link.href = url;
                link.textContent = getShortAddress(addrStr);
                link.title = addrStr;
                link.addEventListener("click", function (ev: Event) {
                    ev.preventDefault();
                    void OpenUrl(url);
                    return false;
                });
                td.appendChild(link);
            } else {
                td.textContent = getShortAddress(addrStr);
                td.title = addrStr;
            }
            tr.appendChild(td);
        }

        const tdUse = document.createElement("td");
        if (index !== defaultIndex) {
            const useLink = document.createElement("a");
            useLink.href = "#";
            useLink.textContent = lv["use"] || "Use";
            useLink.addEventListener("click", (function (idx: number) {
                return function (ev: Event) {
                    ev.preventDefault();
                    void useRelease(idx);
                    return false;
                };
            })(index));
            tdUse.appendChild(useLink);
        }
        tr.appendChild(tdUse);

        tbody.appendChild(tr);
    }
}

// True when the error came from the main-key decrypt, i.e. the entered wallet
// password was wrong (storageDecryptMainKey is the password check).
function isWrongPasswordError(error: unknown): boolean {
    const message = String((error as { message?: unknown })?.message ?? error ?? "");
    return message.indexOf("storageDecryptMainKey") !== -1;
}

function showReleasePasswordError(error: unknown): void {
    if (isWrongPasswordError(error)) {
        showWarnAlert(langJson.errors.releasePasswordWrong || "The wallet password you entered is incorrect.");
    } else {
        showWarnAlert(String((error as { message?: unknown })?.message ?? error));
    }
}

// Switch the active release. Making a custom release the default first warns
// the user (its contracts get full control of every swap, and a scam
// deployment can drain the wallet). Every switch - built-in included - then
// prompts for the wallet password, because the default index is stored
// encrypted with the wallet main key.
export async function useRelease(index: number): Promise<void> {
    try {
        const releaseMap = await swapReleasesList();
        const releaseItem = releaseMap.get(index);
        if (releaseItem != null && releaseItem.builtin !== true) {
            const lv = langJson.langValues;
            let details = "";
            const name = String(releaseItem.name || "");
            if (name !== "" && htmlEncode(name) === name && !containsUnsafeDisplayText(name)) {
                details = "\n\n" + (lv.useReleaseNamePrefix || "Release : ") + name;
            }
            showYesNoConfirm((lv.useReleaseWarn || "This is a custom release. All swaps will run against its contracts. A compromised or scam release can drain your wallet of all coins and tokens. Do you want to continue?") + details, function () {
                showReleasePasswordDialog(function (password: string) {
                    void switchToRelease(index, password);
                });
            });
            return;
        }
        showReleasePasswordDialog(function (password: string) {
            void switchToRelease(index, password);
        });
    } catch (error: any) {
        showWarnAlert(String((error && error.message) ? error.message : error));
    }
}

// Persist the new default index (encrypted write; a wrong password throws),
// reload currentSwapRelease + banner, and reset any in-progress swap state so
// nothing quoted under the previous release survives.
async function switchToRelease(index: number, password: string): Promise<void> {
    try {
        await swapReleaseSetDefaultIndex(password, index);
        await refreshCurrentSwapRelease();
        resetSwapScreenStateForReleaseChange();
        await showSwapReleasesTable();
    } catch (error) {
        showReleasePasswordError(error);
    }
}

export function resetSwapScreenStateForReleaseChange(): void {
    const fromQty = inputById("txtSwapFromQuantity");
    const toQty = inputById("txtSwapToQuantity");
    if (fromQty) fromQty.value = "";
    if (toQty) toQty.value = "";
    updateSwapRoutePathDisplay(null);
}

export function showAddReleaseScreen(): boolean {
    byId("releaseListScreen").style.display = "none";
    byId("releaseAddScreen").style.display = "block";
    inputById("txtReleaseName").value = "";
    inputById("txtReleaseWq").value = "";
    inputById("txtReleaseFactory").value = "";
    inputById("txtReleaseRouter").value = "";
    inputById("pwdAddRelease").value = "";
    inputById("txtReleaseName").focus();
    return false;
}

export function addRelease(): void {
    const lv = langJson.langValues;
    const password = inputById("pwdAddRelease").value;
    if (password == null || password === "") {
        showWarnAlert(langJson.errors.enterWalletPassord);
        return;
    }
    const name = (inputById("txtReleaseName").value || "").trim();
    let details = "";
    if (name !== "" && htmlEncode(name) === name && !containsUnsafeDisplayText(name)) {
        details = "\n\n" + (lv.addReleaseNewPrefix || "New release : ") + name;
    }
    const msg = lv.addReleaseWarn + details;
    showConfirmAndExecuteOnConfirm(msg, function () { void checkAndAddRelease(); });
}

export async function checkAndAddRelease(): Promise<void> {
    try {
        const name = (inputById("txtReleaseName").value || "").trim();
        const wq = (inputById("txtReleaseWq").value || "").trim();
        const factory = (inputById("txtReleaseFactory").value || "").trim();
        const router = (inputById("txtReleaseRouter").value || "").trim();
        const password = inputById("pwdAddRelease").value;

        await swapReleaseAddNew(password, name, wq, factory, router);

        inputById("pwdAddRelease").value = "";
        showAlertAndExecuteOnClose(langJson.langValues.releaseAdded, function () { void showReleasesScreen(); });
    } catch (error) {
        if (isWrongPasswordError(error)) {
            showReleasePasswordError(error);
        } else {
            showWarnAlert(langJson.errors.invalidRelease + " " + error);
        }
    }
}
