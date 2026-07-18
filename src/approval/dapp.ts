// dApp approval controller. Loaded only by approve.html, which the background
// broker opens as `approve.html?requestId=...`. It bypasses the normal wallet
// boot and drives the Send-styled approval card (#dappApprovalRoot) for these
// request kinds:
//   - qc_requestAccounts : unlock + pick account + sign a login challenge
//   - qc_signMessage     : unlock + EIP-191 sign an arbitrary message
//   - qc_sendTransaction : unlock + WYSIWYS-verified sign + broadcast
//
// Connect/sign results flow back through `qc-approval-result`; sends report the
// broadcast txHash through `qc-approval-txBroadcast` and hand confirmation
// polling to the background so transactionResult fires even if this popup closes.
//
// TS port of the legacy public/js/dapp.js (same message protocol, keep-alive
// port and screen flow), rebuilt on the shared src/lib modules.
import {
    OpenUrl,
    ReadFile,
    WriteTextToClipboard,
    decodeTransaction,
    estimateGas,
    estimateGasFee,
    signMessage,
    submitSendTransaction,
    verifyMessage,
} from "../lib/bridge";
import { storageGetItem, storageMultiGetSecureItems } from "../lib/storage";
import { WALLET_KEY_PREFIX, Wallet, walletGetByAddress, walletGetMaxIndex } from "../lib/wallet";
import { IsValidAddress } from "../lib/crypto";
import { containsUnsafeDisplayText } from "../lib/util";
import {
    BlockchainNetwork,
    blockchainNetworkGetDefaultIndex,
    blockchainNetworksInit,
    blockchainNetworksList,
} from "../lib/blockchainNetwork";
import { extApi } from "../platform/extension";
import { pickDecoyWords, renderSpoofBusterWords, spoofBusterLoad, spoofRandomInt } from "../app/spoofbuster";

interface PendingApprovalRequest {
    method: string;
    origin?: string;
    params?: Record<string, any>;
}

interface NetworkInfo {
    name: string;
    chainId: number;
    scanApiDomain: string;
    blockExplorerDomain: string;
    rpcEndpoint: string;
    index: number;
}

function sendToBackground(msg: unknown): Promise<any> {
    return new Promise(function (resolve, reject) {
        try {
            const ret = extApi().runtime.sendMessage(msg, function (res: unknown) {
                const err = extApi().runtime.lastError;
                if (err) { reject(new Error(err.message)); return; }
                resolve(res);
            });
            // Chrome MV3 / Firefox return a promise when no callback fires.
            if (ret && typeof ret.then === "function") {
                ret.then(resolve).catch(reject);
            }
        } catch (e) {
            reject(e);
        }
    });
}

// Hold a dedicated port to the background for the popup's whole lifetime.
// An open port + periodic pings keep the MV3 service worker (and its
// in-memory pending request map + the dApp's relay port) alive through slow
// signing, so the qc_sendTransaction result is still delivered afterward.
// The port closes automatically when this window closes.
function startKeepAlive(): void {
    let port: any = null;
    function connect(): void {
        try {
            port = extApi().runtime.connect({ name: "qc-approval" });
            // Panel-hosted approvals identify themselves so the broker can
            // auto-reject the request if the panel closes without a result
            // (the panel equivalent of the popup's windows.onRemoved).
            if (APPROVAL_VIEW === "panel" && REQUEST_ID) {
                try { port.postMessage({ type: "approval-hello", requestId: REQUEST_ID, view: "panel" }); } catch { /* ignore */ }
            }
            port.onDisconnect.addListener(function () {
                void extApi().runtime.lastError; // swallow disconnect error
                port = null;
                // Chrome force-closes ports at ~5 min; reconnect to stay alive.
                setTimeout(connect, 100);
            });
        } catch {
            port = null;
        }
    }
    connect();
    // Ping well under the 30s idle window so the worker never goes idle.
    setInterval(function () {
        try { if (port) port.postMessage({ type: "ping" }); } catch { /* reconnect via onDisconnect */ }
    }, 20000);
}

const URL_PARAMS = new URLSearchParams(location.search);
const REQUEST_ID = URL_PARAMS.get("requestId") || "";
// "" (approval flow, panel-hosted) | "notice" | "open-panel" (redirector popup)
const APPROVAL_MODE = URL_PARAMS.get("mode") || "";
// "panel" when this page is hosted in the side panel / sidebar
const APPROVAL_VIEW = URL_PARAMS.get("view") || "";
// The requesting tab's windowId (redirector popup only; targets sidePanel.open)
const APPROVAL_WIN = URL_PARAMS.get("win");
let currentNet: BlockchainNetwork | null = null;
let pendingRequest: PendingApprovalRequest | null = null;
let settled = false;
let lang: Record<string, string> = {};
// item 12: the exact {to,data,value} that passed the WYSIWYS decode in
// renderTransaction. doSendTransaction re-verifies against this before signing
// so any mutation between render and submit is caught and rejected.
let verifiedTx: { to: string; data: string; value: string } | null = null;

// Gas config for send approvals (self-contained parity with the Send screen).
// `overridden` becomes true once the user edits the values via the Gas dialog,
// after which the live estimate no longer replaces them.
const TX_SEND_GAS = 250000; // default for a generic dApp transaction (contract call/deploy)
const SWAP_GAS_FEE_RATE = 1000 / 21000;
const GAS_FEE_DECIMALS = 4;
const GAS_FEE_UNIT_LABEL = "Q";
const GAS_ESTIMATE_BUFFER_PERCENT = 10;
const WALLET_KEY_TYPE_3 = 3;

interface DappGasConfig {
    gasLimit: string | null;
    gasFee: string | null;
    gasPriceWei: string | null;
    overridden: boolean;
}
let dappGasConfig: DappGasConfig = { gasLimit: null, gasFee: null, gasPriceWei: null, overridden: false };
let dappGasToken = 0;
let dappGasConfigFeeRate: number | null = null;
// In-flight background estimate started by renderTransaction. doSendTransaction
// awaits it (with an "estimating gas" wait message) instead of silently
// submitting with the default gas limit.
let dappGasEstimateInFlight: Promise<void> | null = null;

// Connect-screen state:
//   "ready"  - an address is selected and we can sign on click (Sign & Connect)
//   "locked" - no shared/unlocked address yet; first click must Unlock
let connectState: "ready" | "locked" = "locked";
let connectAccounts: Wallet[] | null = null; // wallets loaded after an in-popup unlock
let selectedConnectAddress: string | null = null; // address currently shown / to be connected

function el(id: string): HTMLElement | null { return document.getElementById(id); }
function inputEl(id: string): HTMLInputElement | null { return document.getElementById(id) as HTMLInputElement | null; }
function setStatus(text: string): void { const s = el("dappStatus"); if (s) s.textContent = text || ""; }
function show(id: string, on: boolean): void { const e = el(id); if (e) e.style.display = on ? "" : "none"; }
function errMsg(e: unknown): string { return (e instanceof Error && e.message) ? e.message : String(e); }

// Show/hide the "type i agree to confirm" row (parity with the sidebar's
// transaction-review dialog). Shown before any signing/sending click.
function showIAgreeRow(on: boolean): void {
    const r = el("dappIAgreeRow");
    if (r) r.style.display = on ? "" : "none";
}

// Returns true when the confirmation textbox matches the required "i agree"
// literal (trimmed, case-insensitive); otherwise sets the status and returns false.
function checkIAgree(): boolean {
    const input = inputEl("txtDappIAgree");
    const typed = (input && input.value ? input.value : "").trim().toLowerCase();
    const required = t("i-agree-literal", "i agree").toLowerCase();
    if (typed !== required) {
        setStatus(t("must-agree-to-submit", 'Please type "i agree" to confirm.'));
        return false;
    }
    return true;
}

// ---- localization ----------------------------------------------------
// Mirrors the wallet surface: read the same en-us.json and use its `langValues` table.
function t(key: string, fallback?: string): string {
    const v = lang ? lang[key] : null;
    return (v == null) ? (fallback == null ? key : fallback) : v;
}

async function loadLang(): Promise<void> {
    try {
        const raw = await ReadFile("./json/en-us.json");
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && parsed.langValues) lang = parsed.langValues;
    } catch {
        lang = {};
    }
}

// Advanced ("full") signing setting, stored by the wallet under this key
// (see src/app/state.ts DEFAULT_ADVANCED_SIGNING_SETTING_KEY). Read directly
// since the approval page does not load the wallet app.
const DAPP_ADVANCED_SIGNING_KEY = "DefaultAdvancedSigningSettingKey";
async function getAdvancedSigningEnabled(): Promise<boolean> {
    try {
        const v = await storageGetItem(DAPP_ADVANCED_SIGNING_KEY);
        return v === "enabled";
    } catch {
        return false;
    }
}

// Read the docked wallet's current address (published to chrome.storage.session).
// Present only while a wallet is unlocked; used to prefill the default account.
async function readSessionAddress(): Promise<string | null> {
    try {
        const api = extApi();
        if (!api || !api.storage || !api.storage.session) return null;
        const got = api.storage.session.get("qc_current_address");
        if (got && typeof got.then === "function") {
            const o = await got;
            return o ? (o.qc_current_address || null) : null;
        }
        return await new Promise(function (resolve) {
            api.storage.session.get("qc_current_address", function (o: any) {
                resolve(o ? (o.qc_current_address || null) : null);
            });
        });
    } catch {
        return null;
    }
}

// Populate any data-lang-key / data-placeholder-key / data-alt-key nodes that
// live inside the approval card + header.
function fillLang(): void {
    document.querySelectorAll<HTMLElement>("[data-lang-key]").forEach(function (node) {
        const val = t(node.getAttribute("data-lang-key") as string, node.textContent || undefined);
        if (val != null) node.textContent = val;
    });
    document.querySelectorAll<HTMLInputElement>("[data-placeholder-key]").forEach(function (node) {
        const val = t(node.getAttribute("data-placeholder-key") as string, node.placeholder);
        if (val != null) node.placeholder = val;
    });
    document.querySelectorAll<HTMLImageElement>("[data-alt-key]").forEach(function (node) {
        const val = t(node.getAttribute("data-alt-key") as string, node.alt);
        if (val != null) node.alt = val;
    });
}

// ---- "Please wait…" modal (self-contained; dialog.ts is not loaded here) --
function showLoadingAndExecuteAsync(txt: string, f: () => void): void {
    const d = el("modalWaitDialog") as HTMLDialogElement | null;
    if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch { /* already open */ } } }
    const p = el("pWaitDetails");
    if (p) p.innerText = txt || "";
    // Yield once so the modal paints before the heavy work begins.
    setTimeout(f, 0);
}
function updateWaitingBox(txt: string): void { const p = el("pWaitDetails"); if (p) p.innerText = txt || ""; }
function hideWaitingBox(): void {
    const d = el("modalWaitDialog") as HTMLDialogElement | null;
    if (d) { d.style.display = "none"; if (d.close) { try { d.close(); } catch { /* not open */ } } }
}

// ---- post-send status dialog (mirrors the wallet's modalSendCompleted) ---
// Self-contained: shows a loading gif + tx hash (copy/scan) and polls the scan
// API, flipping the status from waiting to success/failure.
let sendCompletedPollingId: ReturnType<typeof setInterval> | null = null;
let sendCompletedStatusRotateId: ReturnType<typeof setInterval> | null = null;
let sendCompletedTxHash: string | null = null;
let sendCompletedAddress: string | null = null;
const SEND_STATUS_MESSAGES = ["send-status-checking", "send-status-waiting", "send-status-checking-short"];
const SEND_STATUS_ROTATE_MS = 3600;
const SEND_STATUS_POLL_MS = 9000;

function scanScheme(domain: string): string {
    const httpAllowed = domain.indexOf("localhost:") === 0 || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(domain);
    return httpAllowed ? "http://" : "https://";
}

async function fetchTxList(scanApiDomain: string, address: string, pending: boolean): Promise<any[]> {
    const base = scanScheme(scanApiDomain) + scanApiDomain + "/account/" + address + "/transactions/";
    const resp = await fetch(pending ? base + "pending/0" : base + "0");
    const json = await resp.json();
    return (json && Array.isArray(json.items)) ? json.items : [];
}

function setSendCompletedPending(): void {
    const img = el("imgSendCompletedStatus") as HTMLImageElement | null;
    if (img) { img.src = "assets/icons/loading.gif"; img.alt = "Loading"; }
}

function updateSendCompletedStatusText(): void {
    const img = el("imgSendCompletedStatus") as HTMLImageElement | null;
    if (!img || img.alt !== "Loading") return;
    const idx = Math.floor(Date.now() / SEND_STATUS_ROTATE_MS) % SEND_STATUS_MESSAGES.length;
    const span = el("spanSendCompletedStatus");
    if (span) span.textContent = t(SEND_STATUS_MESSAGES[idx], "Checking transaction status...");
}

function setSendCompletedSucceeded(): void {
    const img = el("imgSendCompletedStatus") as HTMLImageElement | null;
    if (img) { img.src = "assets/svg/checkmark-circle-outline.svg"; img.alt = "Success"; }
    const span = el("spanSendCompletedStatus");
    if (span) span.textContent = t("send-transaction-succeeded", "Transaction completed successfully.");
}

function setSendCompletedFailed(errorText: string): void {
    const img = el("imgSendCompletedStatus") as HTMLImageElement | null;
    if (img) { img.src = "assets/svg/alert-outline.svg"; img.alt = "Failed"; }
    const span = el("spanSendCompletedStatus");
    const base = t("send-transaction-failed", "Transaction failed.");
    if (span) span.textContent = errorText ? (base + " " + errorText) : base;
}

function stopSendCompletedTimers(): void {
    if (sendCompletedPollingId != null) { clearInterval(sendCompletedPollingId); sendCompletedPollingId = null; }
    if (sendCompletedStatusRotateId != null) { clearInterval(sendCompletedStatusRotateId); sendCompletedStatusRotateId = null; }
}

function closeSendCompletedDialog(): void {
    stopSendCompletedTimers();
    const d = el("modalSendCompleted") as HTMLDialogElement | null;
    if (d) { d.style.display = "none"; if (d.close) { try { d.close(); } catch { /* not open */ } } }
    closeWindow();
}

async function pollSendCompletedStatus(): Promise<void> {
    if (!sendCompletedTxHash || !sendCompletedAddress) return;
    const net = networkInfo();
    if (!net || !net.scanApiDomain) return;
    try {
        const pending = await fetchTxList(net.scanApiDomain, sendCompletedAddress, true);
        if (pending.some(function (x) { return x && x.hash === sendCompletedTxHash; })) return; // still pending
        const completed = await fetchTxList(net.scanApiDomain, sendCompletedAddress, false);
        const found = completed.find(function (x) { return x && x.hash === sendCompletedTxHash; });
        if (found) {
            stopSendCompletedTimers();
            if (found.status === "0x1") setSendCompletedSucceeded();
            else setSendCompletedFailed("");
        }
    } catch { /* transient network error; keep polling */ }
}

function showSendCompletedDialog(txHash: string, address: string): void {
    sendCompletedTxHash = txHash;
    sendCompletedAddress = address;

    const msg = el("pSendCompletedMessage");
    if (msg) msg.textContent = t("send-transaction-send-message-description", "Your transaction has been submitted. It can take upto a minute to process the transaction. You may close this dialog now.");
    const hashEl = el("pSendCompletedTxHash");
    if (hashEl) hashEl.textContent = txHash || "";

    const copyBtn = el("divSendCompletedCopy");
    if (copyBtn) { copyBtn.title = t("copy", "Copy"); copyBtn.onclick = function () { try { void WriteTextToClipboard(txHash); } catch { /* ignore */ } }; }
    const expBtn = el("divSendCompletedExplorer");
    if (expBtn) {
        expBtn.title = t("block-explorer", "Block Explorer");
        expBtn.onclick = async function () {
            try {
                const net = networkInfo();
                if (net && net.blockExplorerDomain) await OpenUrl("https://" + net.blockExplorerDomain + "/txn/" + txHash);
            } catch { /* ignore */ }
        };
    }
    const ok = el("btnSendCompletedOk");
    if (ok) ok.onclick = function () { closeSendCompletedDialog(); };

    setSendCompletedPending();
    const d = el("modalSendCompleted") as HTMLDialogElement | null;
    if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch { /* already open */ } } }

    updateSendCompletedStatusText();
    sendCompletedStatusRotateId = setInterval(updateSendCompletedStatusText, SEND_STATUS_ROTATE_MS);
    sendCompletedPollingId = setInterval(pollSendCompletedStatus, SEND_STATUS_POLL_MS);
    void pollSendCompletedStatus();
}

// ---- password visibility toggle (self-contained) ---------------------
// Pure UI toggle: flips the input type and swaps the eye icon. Uses mousedown
// preventDefault so clicking it never blurs the password field (which must not
// trigger any wallet work).
function wirePasswordToggle(): void {
    const eye = el("dappPwdEye") as HTMLImageElement | null;
    const input = inputEl("dappPassword");
    if (!eye || !input) return;
    eye.addEventListener("mousedown", function (e) { e.preventDefault(); });
    eye.addEventListener("click", function () {
        if (input.type === "password") {
            input.type = "text";
            eye.src = "assets/svg/eye-off-outline.svg";
        } else {
            input.type = "password";
            eye.src = "assets/svg/eye-outline.svg";
        }
    });
}

function closeWindow(): void {
    // Panel-hosted: window.close() would close the whole side panel. Navigate
    // the panel back to the wallet instead.
    if (APPROVAL_VIEW === "panel") {
        try { location.replace("index.html?view=panel"); return; } catch { /* fall through */ }
    }
    try { window.close(); } catch { /* ignore */ }
}

async function loadNetwork(): Promise<void> {
    await blockchainNetworksInit();
    const networkMap = await blockchainNetworksList();
    const defaultIndex = await blockchainNetworkGetDefaultIndex();
    let chosen = networkMap.get(defaultIndex);
    if (!chosen) {
        const keys = [...networkMap.keys()].sort(function (a, b) { return a - b; });
        if (keys.length > 0) chosen = networkMap.get(keys[0]);
    }
    currentNet = chosen || null;
}

// Load the network on demand (connect/send need it; sign does not) so a slow
// bridge/WASM call never blocks rendering the approval screen.
async function ensureNetwork(): Promise<BlockchainNetwork | null> {
    if (currentNet) return currentNet;
    await loadNetwork();
    return currentNet;
}

// The approval popup skips the normal wallet boot, so redirect stray errors
// to the status line rather than a shared (uninitialized) lockup screen.
function installErrorGuards(): void {
    (window as any).__qcApprovalView = true;
    // SEC-11: log detail to the console but show only a generic message so no
    // secret-derived error text is rendered into the popup status line.
    const genericErr = t("dapp-unexpected-error", "An unexpected error occurred.");
    window.onerror = function (message, source, lineno, colno, error) {
        console.error("dapp window.onerror:", message, source, lineno, colno, error);
        setStatus(genericErr);
        return true;
    };
    window.addEventListener("unhandledrejection", function (event) {
        console.error("dapp unhandledrejection:", event && (event as PromiseRejectionEvent).reason);
        setStatus(genericErr);
        try { event.preventDefault(); } catch { /* ignore */ }
    });
}

function networkInfo(): NetworkInfo | null {
    if (!currentNet) return null;
    return {
        name: String(currentNet.blockchainName),
        chainId: parseInt(String(currentNet.networkId), 10),
        scanApiDomain: currentNet.scanApiDomain,
        blockExplorerDomain: currentNet.blockExplorerDomain,
        rpcEndpoint: currentNet.rpcEndpoint,
        index: currentNet.index,
    };
}

async function replyResult(result: unknown): Promise<void> {
    if (settled) return;
    settled = true;
    await sendToBackground({ type: "qc-approval-result", requestId: REQUEST_ID, approved: true, result: result });
    closeWindow();
}

// Send the rejection without closing/navigating this surface (callers decide
// how to close; the panel-hosted spoof-mismatch path must NOT return to the
// wallet UI).
async function replyRejectRaw(message?: string): Promise<void> {
    if (settled) return;
    settled = true;
    await sendToBackground({ type: "qc-approval-result", requestId: REQUEST_ID, approved: false, error: message || "User rejected the request" });
}

async function replyReject(message?: string): Promise<void> {
    await replyRejectRaw(message);
    closeWindow();
}

async function replyBroadcast(txHash: string, address: string): Promise<void> {
    if (settled) return;
    settled = true;
    const net = networkInfo();
    await sendToBackground({
        type: "qc-approval-txBroadcast",
        requestId: REQUEST_ID,
        txHash: txHash,
        scanApiDomain: net ? net.scanApiDomain : null,
        address: address,
    });
}

// Show a blocking error with only an OK button. Used when a generic
// transaction fails the mandatory WYSIWYS decode/verify: the calldata and the
// approve/reject controls are hidden, and the only action (OK, or closing the
// popup) rejects the request so a tampered/unverifiable tx can never be signed.
function showErrorOnlyReject(message?: string | null): void {
    const msg = message || t("dapp-tx-verify-failed", "The transaction could not be verified.");
    // Hide every approval control so OK is the sole affordance.
    show("dappApprovalRoot", false);
    const p = el("pDetails");
    if (p) p.textContent = msg;
    const warn = el("divWarn");
    if (warn) warn.style.display = "";
    const succ = el("divSuccess");
    if (succ) succ.style.display = "none";
    const ok = el("divModalOk");
    if (ok) ok.onclick = function () { replyReject(msg).catch(function () { closeWindow(); }); };
    const d = el("modalOkDialog") as HTMLDialogElement | null;
    if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch { /* already open */ } } }
}

// ---- Spoof Buster gate + redirector modes ------------------------------
// The genuine approval flow (side-panel hosted) starts with a gate showing the
// user's Spoof Buster Words. 1 round in 10 is a training round: method A shows
// decoy words, method B skips the gate entirely (simulating a spoofed window)
// and educates on any engagement. Every training round rejects the dApp
// request; the user retries the action on the dApp.

type SpoofGateOutcome = "proceed" | "handled";

// Training method B active: the rendered approval screen is a drill; any
// engagement (password field, Approve) triggers the educational dialog and the
// real approval logic is never reachable.
let spoofTrainingModeB = false;

// OK-only dialog for training outcomes (mirrors showErrorOnlyReject): OK, or
// closing the surface, rejects the request. `goodCatch` shows the success icon.
function showSpoofTrainingDialog(message: string, goodCatch: boolean): void {
    show("dappApprovalRoot", false);
    show("dappSpoofGateRoot", false);
    const p = el("pDetails");
    if (p) p.textContent = message;
    const warn = el("divWarn");
    if (warn) warn.style.display = goodCatch ? "none" : "";
    const succ = el("divSuccess");
    if (succ) succ.style.display = goodCatch ? "" : "none";
    const ok = el("divModalOk");
    if (ok) ok.onclick = function () { replyReject("Spoof Buster training round").catch(function () { closeWindow(); }); };
    const d = el("modalOkDialog") as HTMLDialogElement | null;
    if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch { /* already open */ } } }
}

// Normal round, words marked "Incorrect": fail closed. Reject the request,
// explain, and close the WHOLE side panel - never fall through to the wallet
// unlock/password UI, which is exactly what a spoofed flow would want next.
function showSpoofMismatchDialog(): void {
    show("dappApprovalRoot", false);
    show("dappSpoofGateRoot", false);
    const p = el("pDetails");
    if (p) p.textContent = t("spoof-gate-mismatch", "The request was rejected. This side panel will now close - reopen it from the toolbar and try the request again. If you are unsure of your words, unlock your wallet and check Settings > Spoof Buster Words.");
    const warn = el("divWarn");
    if (warn) warn.style.display = "";
    const succ = el("divSuccess");
    if (succ) succ.style.display = "none";
    const ok = el("divModalOk");
    if (ok) ok.onclick = function () {
        replyRejectRaw("Spoof check failed")
            .catch(function () { /* background may be gone; port disconnect rejects */ })
            .finally(function () { try { window.close(); } catch { /* ignore */ } });
    };
    const d = el("modalOkDialog") as HTMLDialogElement | null;
    if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch { /* already open */ } } }
}

function spoofTrainingBEducate(): void {
    showSpoofTrainingDialog(
        t("spoof-training-b-educate", "This was an anti-spoofing drill. Your Spoof Buster words were never shown - never enter your password unless you saw and confirmed your words first. A window that skips the word check is fake: close it and try again."),
        false,
    );
}

// Method B: render the normal approval screen with no gate (exactly what a
// spoofed window would do). Engaging the password field or Approve educates;
// Reject / closing is the right response.
function armSpoofTrainingModeB(): void {
    spoofTrainingModeB = true;
    const pwd = inputEl("dappPassword");
    if (pwd) {
        pwd.addEventListener("focus", spoofTrainingBEducate, { once: true });
        pwd.addEventListener("keydown", spoofTrainingBEducate, { once: true });
    }
}

// Show the gate (or arm a training round) and resolve with whether the real
// approval flow may proceed. "handled" means a dialog/reject path took over.
async function runSpoofGatePhase(): Promise<SpoofGateOutcome> {
    const words = await spoofBusterLoad();
    if (words == null) {
        // No words stored (fresh install mid-onboarding): skip the gate.
        show("dappApprovalRoot", true);
        return "proceed";
    }
    const isTraining = spoofRandomInt(10) === 0;
    if (isTraining && spoofRandomInt(2) === 1) {
        armSpoofTrainingModeB();
        show("dappApprovalRoot", true);
        return "proceed";
    }
    const displayWords = isTraining ? pickDecoyWords(words, words.length) : words;

    return await new Promise<SpoofGateOutcome>(function (resolve) {
        renderSpoofBusterWords(el("dappSpoofWords") as HTMLElement, displayWords);
        show("dappApprovalRoot", false);
        show("dappSpoofGateRoot", true);

        const nextBtn = el("dappSpoofNextBtn");
        if (!nextBtn) { resolve("handled"); return; }
        nextBtn.onclick = function () {
            const correct = inputEl("optSpoofCorrect");
            const incorrect = inputEl("optSpoofIncorrect");
            const saidCorrect = !!(correct && correct.checked);
            const saidIncorrect = !!(incorrect && incorrect.checked);
            if (!saidCorrect && !saidIncorrect) {
                const s = el("dappSpoofGateStatus");
                if (s) s.textContent = t("spoof-gate-select-option", "Please select an option.");
                return;
            }
            if (isTraining) {
                // Method A: the words shown are decoys.
                if (saidIncorrect) {
                    showSpoofTrainingDialog(
                        t("spoof-training-a-good-catch", "Good catch - this was a training check. You should always close the window and try again if incorrect words are shown."),
                        true,
                    );
                } else {
                    showSpoofTrainingDialog(
                        t("spoof-training-a-educate", "The words shown were NOT your Spoof Buster words. A mismatch means the window is fake - always close it and try again. This was a training check; the request was rejected."),
                        false,
                    );
                }
                resolve("handled");
                return;
            }
            if (saidCorrect) {
                show("dappSpoofGateRoot", false);
                show("dappApprovalRoot", true);
                resolve("proceed");
                return;
            }
            // Real words marked incorrect: fail closed with an explanation and
            // close the side panel (no wallet/password UI after a mismatch).
            showSpoofMismatchDialog();
            resolve("handled");
        };
    });
}

// mode=notice: the panel is already open and has the approval; this popup only
// points the user at it, then closes itself.
function renderNoticeMode(): void {
    show("dappApprovalRoot", false);
    show("dappRedirectRoot", true);
    const title = el("dappRedirectTitle");
    if (title) title.textContent = t("spoof-redirect-notice-title", "Continue in the side panel");
    const text = el("dappRedirectText");
    if (text) text.textContent = t("spoof-redirect-notice-text", "A wallet request is waiting for you in the QuantumSwap side panel.");
    setTimeout(function () { try { window.close(); } catch { /* ignore */ } }, 3000);
}

// mode=open-panel: the panel is closed. Explain that genuine approvals happen
// only in the side panel and open it with the click's user gesture.
async function renderOpenPanelMode(): Promise<void> {
    show("dappApprovalRoot", false);
    show("dappRedirectRoot", true);
    const buttons = el("dappRedirectButtons");
    if (buttons) buttons.style.display = "flex";
    const title = el("dappRedirectTitle");
    if (title) title.textContent = t("spoof-redirect-title", "Wallet request waiting");

    const unlocked = (await readSessionAddress()) != null;
    const text = el("dappRedirectText");
    if (text) {
        text.textContent = unlocked
            ? t("spoof-redirect-text-unlocked", "A site is requesting access to your wallet. For your safety, wallet requests are only approved inside the QuantumSwap side panel. Open the side panel to review the request there.")
            : t("spoof-redirect-text-locked", "A site is requesting access to your wallet. For your safety, wallet requests are only approved inside the QuantumSwap side panel. Open the side panel and unlock your wallet there to continue.");
    }

    const rejectBtn = el("dappRedirectRejectBtn");
    if (rejectBtn) rejectBtn.addEventListener("click", function () {
        replyReject("User rejected the request").catch(function () { closeWindow(); });
    });
    const openBtn = el("dappRedirectOpenBtn");
    if (openBtn) openBtn.addEventListener("click", onOpenPanelClick);
}

// Must run synchronously within the click so sidePanel.open() keeps the user
// gesture (same pattern as walletDock in src/platform/surface.ts).
function onOpenPanelClick(): void {
    const A = extApi();
    const winId = APPROVAL_WIN != null ? Number(APPROVAL_WIN) : NaN;
    // Mark the request as continuing in the panel BEFORE this popup closes, so
    // windows.onRemoved does not auto-reject it.
    const markRouted = sendToBackground({ type: "qc-approval-mark-routed", requestId: REQUEST_ID }).catch(function () { /* ignore */ });
    const finish = function () { markRouted.then(function () { try { window.close(); } catch { /* ignore */ } }); };
    const fail = function () {
        setStatus(t("spoof-redirect-open-failed", "Could not open the side panel. Please open it from the toolbar."));
    };
    try {
        if (A.sidePanel && A.sidePanel.open) {
            const opts = !isNaN(winId) ? { windowId: winId } : {};
            A.sidePanel.open(opts).then(finish).catch(function () {
                // Fallback: last focused normal window (may lose the gesture).
                A.windows.getLastFocused({ windowTypes: ["normal"] })
                    .then(function (w: any) { return A.sidePanel.open({ windowId: w.id }); })
                    .then(finish)
                    .catch(fail);
            });
        } else if (A.sidebarAction && A.sidebarAction.open) {
            const p = A.sidebarAction.open();
            if (p && p.then) p.then(finish).catch(fail);
            else finish();
        } else {
            fail();
        }
    } catch {
        fail();
    }
}

// SEC-14: true if any of the supplied display values carries spoofing Unicode
// (bidi overrides, zero-width/format chars, control chars). Used to hard-reject
// dApp-displayed values so a request can never be approved while showing text
// that visually differs from the bytes being signed.
function anyUnsafeDisplayText(values: unknown[]): boolean {
    for (let i = 0; i < values.length; i++) {
        if (containsUnsafeDisplayText(values[i])) return true;
    }
    return false;
}

// ---- request validation ----------------------------------------------
// Belt-and-suspenders: the background broker already early-rejects the same
// cases before opening this popup. This is the authoritative (SDK-backed)
// second check for anything that still reaches the approval card.
function isEthStyleAddress(a: unknown): boolean {
    return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

async function isQcAddress(a: unknown): Promise<boolean> {
    if (typeof a !== "string") return false;
    const s = a.trim();
    // Cheap shape prefilter; the SDK IsValidAddress check below is authoritative.
    if (!/^0x[0-9a-fA-F]{64}$/.test(s)) return false;
    try {
        return (await IsValidAddress(s)) === true;
    } catch {
        // Fail closed: if the SDK bridge is unavailable we cannot confirm the
        // address is valid, so reject rather than accept an unverified address.
        return false;
    }
}

async function validateAddressParam(a: unknown): Promise<string | null> {
    if (isEthStyleAddress(a)) {
        return t("dapp-err-incompatible-address", "Incompatible address: QuantumCoin uses 32-byte (64-hex) addresses; received an Ethereum-style 20-byte address.");
    }
    if (!(await isQcAddress(a))) {
        return t("dapp-err-invalid-address", "Invalid QuantumCoin address.");
    }
    return null;
}

// Returns an error message string when the request is invalid, else null.
async function validateApprovalRequest(method: string, params: Record<string, any>): Promise<string | null> {
    if (method === "qc_signMessage") {
        const m = params.message;
        if (typeof m !== "string" || m.length === 0) {
            return t("dapp-err-invalid-message", "Invalid message: expected a non-empty string.");
        }
        return null;
    }
    if (method === "qc_sendTransaction") {
        // Shape-only pre-check (mirrors the background). The authoritative ABI
        // decode + WYSIWYS re-encode verification happens in renderTransaction.
        const toRaw = params.to == null ? "" : String(params.to).trim();
        const dataRaw = params.data == null ? "" : String(params.data).trim();
        if (toRaw !== "") {
            const toErrTx = await validateAddressParam(toRaw);
            if (toErrTx) return toErrTx;
        }
        const hasData = dataRaw !== "" && dataRaw !== "0x" && dataRaw !== "0X";
        if (toRaw === "" && !hasData) {
            return t("dapp-err-empty-tx", "Invalid transaction: provide a recipient and/or contract data.");
        }
        if (dataRaw !== "" && !/^0x?[0-9a-fA-F]*$/.test(dataRaw)) {
            return t("dapp-err-invalid-data", "Invalid transaction data: expected a hex string.");
        }
        return null;
    }
    return null; // qc_requestAccounts has no params to validate
}

// ---- account discovery (after password entry) ------------------------
// Loads every wallet with a SINGLE scrypt key-derivation (via
// storageMultiGetSecureItems), instead of one scrypt per wallet. scrypt is
// synchronous WASM on the main thread, so avoiding repeats keeps the popup
// from freezing during connect/unlock.
async function loadAccounts(password: string): Promise<Wallet[]> {
    const maxIndex = await walletGetMaxIndex();
    const keys: string[] = [];
    for (let i = 0; i <= maxIndex; i++) {
        keys.push(WALLET_KEY_PREFIX + i.toString());
    }
    const jsons = await storageMultiGetSecureItems(password, keys);
    const accounts: Wallet[] = [];
    for (let j = 0; j < jsons.length; j++) {
        const json = jsons[j];
        if (!json) continue;
        const w = JSON.parse(json);
        accounts.push(new Wallet(w.address, w.privateKey, w.publicKey, w.seed));
    }
    return accounts;
}

// ---- flow: connect ---------------------------------------------------
function buildChallenge(origin: string, address: string): string {
    const nonceBytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return "QuantumSwap Connect\n\n"
        + "Site: " + origin + "\n"
        + "Address: " + address + "\n"
        + "Nonce: " + nonce + "\n"
        + "Issued: " + new Date().toISOString();
}

async function doConnect(origin: string, password: string): Promise<void> {
    const address = selectedConnectAddress;
    if (!address) {
        throw new Error(t("dappNoWallets", "No wallets found or wrong password."));
    }

    // Prefer already-loaded wallets (locked path unlocked them); otherwise
    // load all accounts with a single scrypt (ready path) and pick the target.
    let wallet: Wallet | null = null;
    if (!connectAccounts) {
        connectAccounts = await loadAccounts(password);
    }
    if (connectAccounts) {
        wallet = connectAccounts.find(function (w) {
            return w.address.toLowerCase() === String(address).toLowerCase();
        }) || null;
    }
    if (!wallet) {
        throw new Error(t("dappUnlockFailed", "Could not unlock the account (wrong password?)."));
    }

    const priv = await wallet.getPrivateKey();
    const pub = await wallet.getPublicKey();
    const challenge = buildChallenge(origin, wallet.address);

    const fullSign = await getAdvancedSigningEnabled();
    updateWaitingBox(t("dapp-signing", "Please wait while the request is being signed."));
    const signed = await signMessage(priv, pub, challenge, null, fullSign);
    // Self-check: the recovered signer must match the connecting account.
    const recovered = await verifyMessage(challenge, signed.signature);
    if (!recovered || String(recovered.address).toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error(t("dappSelfVerifyFailed", "Signature self-verification failed."));
    }

    await ensureNetwork();
    const net = networkInfo();
    await replyResult({ address: wallet.address, chainId: net ? net.chainId : null, network: net });
}

// Unlock step for the locked connect path: load the wallets, populate the
// dropdown, show the default address, and flip the button to Sign & Connect.
async function unlockConnect(password: string): Promise<void> {
    const accounts = await loadAccounts(password);
    if (accounts.length === 0) {
        throw new Error(t("dappNoWallets", "No wallets found or wrong password."));
    }
    connectAccounts = accounts;
    const sel = el("dappAccountSelect") as HTMLSelectElement | null;
    if (sel) {
        sel.replaceChildren();
        accounts.forEach(function (w) {
            const opt = document.createElement("option");
            opt.value = w.address;
            opt.textContent = w.address;
            sel.appendChild(opt);
        });
        sel.style.display = (accounts.length > 1) ? "" : "none";
    }
    show("dappConnectScreen", true);
    setSelectedConnectAddress(accounts[0].address);
    connectState = "ready";
    el("dappApproveBtn")!.textContent = t("dapp-connect", "Sign & Connect");
    showIAgreeRow(true);
    setStatus("");
}

function setSelectedConnectAddress(addr: string | null): void {
    selectedConnectAddress = addr || null;
    const a = el("dappSelectedAddress");
    if (a) a.textContent = addr || "";
}

// Shared account row for the sign and send screens (mirrors the connect
// address block). Fills the address, wires copy + block-explorer icons once,
// and reveals the row. The current address is read from a module-level var so
// the once-bound handlers always act on the latest value.
let accountRowAddress: string | null = null;
function renderAccountRow(address: string | null): void {
    accountRowAddress = address || null;
    const addrEl = el("dappAccountAddress");
    if (addrEl) addrEl.textContent = accountRowAddress || "";

    const copyBtn = el("dappAccountCopy");
    if (copyBtn && !copyBtn.dataset.bound) {
        copyBtn.dataset.bound = "1";
        copyBtn.addEventListener("click", function () {
            if (!accountRowAddress) return;
            try { void WriteTextToClipboard(accountRowAddress); } catch { /* ignore */ }
        });
    }

    const expBtn = el("dappAccountExplorer");
    if (expBtn && !expBtn.dataset.bound) {
        expBtn.dataset.bound = "1";
        expBtn.addEventListener("click", async function () {
            if (!accountRowAddress) return;
            try {
                await ensureNetwork();
                const net = networkInfo();
                if (net && net.blockExplorerDomain) {
                    await OpenUrl("https://" + net.blockExplorerDomain + "/account/" + accountRowAddress);
                }
            } catch (e) { setStatus(errMsg(e)); }
        });
    }

    show("dappAccountRow", true);
}

// ---- flow: sign arbitrary message ------------------------------------
async function doSign(params: Record<string, any>, password: string): Promise<void> {
    const address = params.address;
    const wallet = await walletGetByAddress(password, address);
    if (!wallet) {
        throw new Error(t("dappUnlockFailed", "Could not unlock the connected account (wrong password?)."));
    }
    const priv = await wallet.getPrivateKey();
    const pub = await wallet.getPublicKey();
    const fullSign = await getAdvancedSigningEnabled();
    updateWaitingBox(t("dapp-signing", "Please wait while the request is being signed."));
    const signed = await signMessage(priv, pub, String(params.message == null ? "" : params.message), null, fullSign);
    await replyResult({ signature: signed.signature });
}

// ---- gas estimation + config (send approvals) ------------------------
// Mirrors the wallet Send screen: show an estimated fee + a gas icon that
// opens an editable dialog. Uses the same bridge calls (estimateGas /
// estimateGasFee).
// item 5: derive a decimal-wei per-gas-unit price from a fee (coins) + gas
// limit for the cases where the node didn't return an exact price.
function computeGasPriceWei(gasFeeEth: unknown, gasLimit: unknown): string | null {
    const fee = parseFloat(String(gasFeeEth));
    const gl = parseFloat(String(gasLimit));
    if (isNaN(fee) || isNaN(gl) || gl <= 0) return null;
    const wei = Math.round((fee * 1e18) / gl);
    if (!isFinite(wei) || wei < 0) return null;
    return String(wei);
}

function formatGasFeeNumber(value: unknown): string {
    let n = parseFloat(String(value));
    if (isNaN(n)) n = 0;
    let s = n.toFixed(GAS_FEE_DECIMALS);
    if (s.indexOf(".") >= 0) {
        s = s.replace(/0+$/, "");
        if (s.slice(-1) === ".") s = s.slice(0, -1);
    }
    return s;
}

function formatGasFeeQ(value: unknown): string {
    return formatGasFeeNumber(value) + " " + GAS_FEE_UNIT_LABEL;
}

function setGasFeeLabel(feeValue: unknown): void {
    const e = el("dappGasFee");
    if (!e) return;
    e.textContent = (feeValue == null || feeValue === "") ? "" : formatGasFeeQ(feeValue);
}

function setGasIconPulse(pulsing: boolean): void {
    const e = el("dappGasIcon");
    if (!e) return;
    if (pulsing) e.classList.add("gas-pulse");
    else e.classList.remove("gas-pulse");
}

// Shared fee lookup: given a resolved gas limit, estimate the fee and (unless
// the user has overridden the gas) publish it to the gas config + header label.
async function finalizeGasEstimate(gasLimit: string | null, myToken: number): Promise<void> {
    if (gasLimit == null) { setGasIconPulse(false); return; }
    let gasFee: string | number | null = null;
    let gasPriceWei: string | null = null;
    try {
        const fullSign = await getAdvancedSigningEnabled();
        const feeRes = await estimateGasFee({
            rpcEndpoint: currentNet!.rpcEndpoint,
            chainId: parseInt(String(currentNet!.networkId), 10),
            gasLimit: gasLimit,
            keyType: WALLET_KEY_TYPE_3,
            fullSign: fullSign === true,
        });
        if (myToken !== dappGasToken) { setGasIconPulse(false); return; }
        if (feeRes && feeRes.success && feeRes.gasFeeEth != null) {
            gasFee = feeRes.gasFeeEth;
            if (feeRes.gasPriceWei != null) gasPriceWei = String(feeRes.gasPriceWei);
        }
    } catch { /* fall back below */ }

    if (gasFee == null) gasFee = (Number(gasLimit) * SWAP_GAS_FEE_RATE);

    if (myToken === dappGasToken && !dappGasConfig.overridden) {
        dappGasConfig.gasLimit = String(gasLimit);
        dappGasConfig.gasFee = String(gasFee);
        // item 5: prefer the node's exact price; else derive from the shown fee.
        dappGasConfig.gasPriceWei = (gasPriceWei != null) ? gasPriceWei : computeGasPriceWei(gasFee, gasLimit);
        dappGasConfig.overridden = false;
        setGasFeeLabel(dappGasConfig.gasFee);
    }
    setGasIconPulse(false);
}

// Estimate gas limit + fee for a generic dApp transaction (verbatim
// to/data/value). Falls back to the generic default limit on lookup failure.
async function estimateGenericGas(params: Record<string, any>): Promise<void> {
    setGasIconPulse(true);
    setGasFeeLabel("");
    const myToken = ++dappGasToken;

    await ensureNetwork();
    if (!currentNet) { setGasIconPulse(false); return; }

    let gasLimit: string | null = null;
    try {
        const est = await estimateGas({
            rpcEndpoint: currentNet.rpcEndpoint,
            chainId: parseInt(String(currentNet.networkId), 10),
            txKind: "sendTransaction",
            fromAddress: params.from,
            to: params.to,
            data: params.data,
            value: params.value,
            bufferPercent: GAS_ESTIMATE_BUFFER_PERCENT,
        });
        if (myToken !== dappGasToken) { setGasIconPulse(false); return; }
        if (est && est.success && est.gasLimit) gasLimit = est.gasLimit;
    } catch { /* fall back below */ }

    if (gasLimit == null) gasLimit = String(TX_SEND_GAS);
    await finalizeGasEstimate(gasLimit, myToken);
}

// Resolve the gas limit to submit: user override wins, else the estimate,
// else the hardcoded default for the tx kind.
function resolveSendGasLimit(defaultGasLimit: number): number {
    if (dappGasConfig.gasLimit != null && dappGasConfig.gasLimit !== "") {
        const gl = parseInt(dappGasConfig.gasLimit, 10);
        if (!isNaN(gl) && gl > 0) return gl;
    }
    return defaultGasLimit;
}

// item 5: the pinned per-gas-unit price to submit (null lets the signer decide).
function resolveSendGasPrice(): string | null {
    return (dappGasConfig.gasPriceWei != null && dappGasConfig.gasPriceWei !== "")
        ? dappGasConfig.gasPriceWei : null;
}

function showGasConfigDialog(): void {
    const limitEl = inputEl("txtGasLimit");
    const feeEl = inputEl("txtGasFee");
    const gl = dappGasConfig.gasLimit;
    const gf = dappGasConfig.gasFee;
    if (limitEl) limitEl.value = (gl != null ? String(gl) : "");
    if (feeEl) feeEl.value = (gf != null ? formatGasFeeNumber(gf) : "");
    const limitNum = parseFloat(String(gl));
    const feeNum = parseFloat(String(gf));
    dappGasConfigFeeRate = (!isNaN(limitNum) && limitNum > 0 && !isNaN(feeNum)) ? (feeNum / limitNum) : null;
    const d = el("modalGasConfig") as HTMLDialogElement | null;
    if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch { /* already open */ } } }
    setTimeout(function () { if (limitEl) limitEl.focus(); }, 80);
}

function closeGasConfigDialog(): void {
    const d = el("modalGasConfig") as HTMLDialogElement | null;
    if (d) { d.style.display = "none"; if (d.close) { try { d.close(); } catch { /* not open */ } } }
}

// One-time wiring for the gas icon + dialog buttons.
function wireGasControls(): void {
    const icon = el("dappGasIcon");
    if (icon) icon.addEventListener("click", function () {
        if (dappGasConfig.gasLimit == null) {
            // No estimate yet: seed the dialog with the transaction default.
            const def = TX_SEND_GAS;
            dappGasConfig.gasLimit = String(def);
            dappGasConfig.gasFee = String(def * SWAP_GAS_FEE_RATE);
            dappGasConfig.gasPriceWei = computeGasPriceWei(def * SWAP_GAS_FEE_RATE, def);
        }
        showGasConfigDialog();
    });

    const limitEl = inputEl("txtGasLimit");
    const feeEl = inputEl("txtGasFee");
    if (limitEl && feeEl && !limitEl.dataset.gasRecomputeBound) {
        limitEl.dataset.gasRecomputeBound = "1";
        limitEl.addEventListener("input", function () {
            if (dappGasConfigFeeRate == null) return;
            const lim = parseFloat(limitEl.value);
            if (isNaN(lim) || lim < 0) return;
            feeEl.value = formatGasFeeNumber(lim * dappGasConfigFeeRate);
        });
    }

    const okBtn = el("btnGasConfigOk");
    if (okBtn) okBtn.addEventListener("click", function () {
        const lEl = inputEl("txtGasLimit");
        const fEl = inputEl("txtGasFee");
        const gasLimit = parseInt((lEl && lEl.value) || "", 10);
        const gasFee = (fEl && fEl.value != null) ? String(fEl.value).trim() : "";
        const feeNum = parseFloat(gasFee);
        if (isNaN(gasLimit) || gasLimit <= 0 || isNaN(feeNum) || feeNum < 0) {
            setStatus(t("invalidValue", "Invalid value"));
            return;
        }
        // Invalidate any in-flight estimate so it can't overwrite the override.
        dappGasToken++;
        dappGasConfig.gasLimit = String(gasLimit);
        dappGasConfig.gasFee = gasFee;
        dappGasConfig.gasPriceWei = computeGasPriceWei(gasFee, gasLimit);
        dappGasConfig.overridden = true;
        setGasFeeLabel(dappGasConfig.gasFee);
        closeGasConfigDialog();
    });

    const cancelBtn = el("btnGasConfigCancel");
    if (cancelBtn) cancelBtn.addEventListener("click", closeGasConfigDialog);
}

// ---- flow: generic transaction (verified to/data/value) --------------
// item 12: normalize helpers for the pre-signing byte-compare.
function normTxTo(v: unknown): string { return (v == null ? "" : String(v)).trim().toLowerCase(); }
function normTxData(v: unknown): string {
    let s = (v == null ? "" : String(v)).trim();
    if (s === "" || s === "0x" || s === "0X") return "0x";
    if (s.slice(0, 2).toLowerCase() === "0x") s = s.slice(2);
    return "0x" + s.toLowerCase();
}
function normTxValue(v: unknown): string {
    if (v == null || String(v).trim() === "") return "0";
    try { return BigInt(String(v).trim()).toString(); } catch { return "\u0000invalid"; }
}

async function doSendTransaction(params: Record<string, any>, password: string): Promise<void> {
    const from = params.from;

    // If the background gas estimate hasn't landed yet (and the user didn't
    // set gas manually via the dialog), wait for it here instead of silently
    // falling back to the default gas limit. The wait modal is already open.
    if (!dappGasConfig.overridden && dappGasConfig.gasLimit == null && dappGasEstimateInFlight != null) {
        updateWaitingBox(t("pleaseWaitEstimatingGas", "Please wait, estimating gas..."));
        await dappGasEstimateInFlight;
    }

    await ensureNetwork();
    const net = networkInfo();
    if (!net) throw new Error(t("dappNoNetwork", "No blockchain network is configured."));

    // item 12: re-verify WYSIWYS BEFORE unlocking any keys. The params must be
    // byte-identical to what passed verification at render time, and must still
    // decode successfully; otherwise reject (reject-only) so a tampered/mutated
    // request can never be signed.
    let verifyFailed = false;
    if (!verifiedTx
        || normTxTo(params.to) !== normTxTo(verifiedTx.to)
        || normTxData(params.data) !== normTxData(verifiedTx.data)
        || normTxValue(params.value) !== normTxValue(verifiedTx.value)) {
        verifyFailed = true;
    }
    if (!verifyFailed) {
        let recheck;
        try {
            recheck = await decodeTransaction({
                rpcEndpoint: currentNet ? currentNet.rpcEndpoint : null,
                chainId: net ? net.chainId : (params.chainId || 0),
                to: params.to,
                data: params.data,
                value: params.value,
                abi: params.abi,
                bytecode: params.bytecode,
            });
        } catch { recheck = null; }
        if (!recheck || !recheck.success) verifyFailed = true;
    }
    if (verifyFailed) {
        hideWaitingBox();
        showErrorOnlyReject(t("dapp-tx-verify-failed", "The transaction could not be verified and was rejected to protect you from signing tampered or unverifiable data."));
        return;
    }

    const wallet = await walletGetByAddress(password, from);
    if (!wallet) {
        throw new Error(t("dappUnlockFailed", "Could not unlock the sending account (wrong password?)."));
    }

    const priv = await wallet.getPrivateKey();
    const pub = await wallet.getPublicKey();
    const fullSign = await getAdvancedSigningEnabled();

    updateWaitingBox(t("pleaseWaitSubmit", "Please wait while your request is being submitted."));

    const result = await submitSendTransaction({
        rpcEndpoint: currentNet!.rpcEndpoint,
        chainId: parseInt(String(currentNet!.networkId), 10),
        to: params.to,
        data: params.data,
        value: params.value,
        privateKey: priv,
        publicKey: pub,
        gasLimit: resolveSendGasLimit(TX_SEND_GAS),
        gasPriceWei: resolveSendGasPrice(),
        advancedSigningEnabled: fullSign,
    });

    if (!result || !result.success || !result.txHash) {
        throw new Error((result && result.error) ? String(result.error) : "Transaction submission failed.");
    }

    await replyBroadcast(result.txHash, wallet.address);
    hideWaitingBox();
    const approveBtn = el("dappApproveBtn") as HTMLButtonElement | null;
    if (approveBtn) approveBtn.disabled = true;
    showSendCompletedDialog(result.txHash, wallet.address);
}

// ---- unified approve handler -----------------------------------------
async function runApprove(password: string): Promise<void> {
    switch (pendingRequest!.method) {
        case "qc_requestAccounts":
            await doConnect(pendingRequest!.origin || "", password);
            break;
        case "qc_signMessage":
            await doSign(pendingRequest!.params || {}, password);
            break;
        case "qc_sendTransaction":
            await doSendTransaction(pendingRequest!.params || {}, password);
            break;
    }
}

function onApprove(): void {
    // Training method B drill: approving a gate-less window is the mistake
    // being taught. The real approval logic is unreachable in this mode.
    if (spoofTrainingModeB) { spoofTrainingBEducate(); return; }

    const approveBtn = el("dappApproveBtn") as HTMLButtonElement | null;

    // Connect + locked: first click unlocks (loads accounts, shows the
    // dropdown). The connect popup requires the "i agree" confirmation like the
    // other flows, checked BEFORE the password so an empty/incorrect
    // confirmation is reported first.
    if (pendingRequest!.method === "qc_requestAccounts" && connectState === "locked") {
        if (!checkIAgree()) return;
        const lockPwd = inputEl("dappPassword");
        const lockPassword = lockPwd ? lockPwd.value : "";
        if (!lockPassword) { setStatus(t("dapp-password-required", "Password is required.")); return; }
        // SEC-07: clear the cleartext password from the DOM once captured.
        if (lockPwd) lockPwd.value = "";
        setStatus("");
        if (approveBtn) approveBtn.disabled = true;
        showLoadingAndExecuteAsync(t("dapp-connecting", "Please wait while connecting..."), function () {
            unlockConnect(lockPassword).then(function () {
                hideWaitingBox();
                if (approveBtn) approveBtn.disabled = false;
            }).catch(function (e) {
                hideWaitingBox();
                if (approveBtn) approveBtn.disabled = false;
                setStatus(errMsg(e));
            });
        });
        return;
    }

    // Final approve action (Sign & Connect / Sign / Sign & Send) requires the
    // "i agree" confirmation, checked BEFORE the password so an empty/incorrect
    // confirmation is reported first (mirrors the wallet transaction-review flow).
    if (!checkIAgree()) return;

    const pwd = inputEl("dappPassword");
    const password = pwd ? pwd.value : "";
    if (!password) { setStatus(t("dapp-password-required", "Password is required.")); return; }
    // SEC-07: clear the cleartext password from the DOM once captured.
    if (pwd) pwd.value = "";
    setStatus("");

    if (approveBtn) approveBtn.disabled = true;
    showLoadingAndExecuteAsync(initialWaitMessage(pendingRequest!.method), function () {
        runApprove(password).catch(function (e) {
            hideWaitingBox();
            if (approveBtn) approveBtn.disabled = false;
            setStatus(errMsg(e));
        });
    });
}

// Initial "please wait" text shown while the (slow) wallet decrypt runs,
// before each flow updates it with a step-specific message.
function initialWaitMessage(method: string): string {
    if (method === "qc_signMessage") return t("dapp-signing", "Please wait while the request is being signed.");
    if (method === "qc_sendTransaction") return t("pleaseWaitSubmit", "Please wait while your request is being submitted.");
    return t("dapp-connecting", "Please wait while connecting...");
}

// ---- rendering -------------------------------------------------------
// True when at least one wallet has been created/restored in this extension.
async function hasAnyWallet(): Promise<boolean> {
    try {
        return (await walletGetMaxIndex()) >= 0;
    } catch {
        return false;
    }
}

async function renderConnect(origin: string): Promise<void> {
    el("dappTitle")!.textContent = t("dapp-connect-title", "Connect Wallet");
    setStatus("");

    // SEC-14: refuse to render a connect prompt whose origin carries spoofing
    // Unicode (bidi/zero-width/control chars) so the displayed site can never
    // visually differ from the origin being granted access.
    if (containsUnsafeDisplayText(origin)) {
        showErrorOnlyReject(t("dapp-unsafe-chars", "This request contains hidden or direction-changing characters that can disguise what you are approving. It was rejected for your safety."));
        return;
    }

    // No wallet exists yet: there is nothing to connect. Hide the approval
    // card entirely and present an OK-only error pane; OK (or closing the
    // popup) rejects the request.
    if (!(await hasAnyWallet())) {
        showErrorOnlyReject(t("dapp-no-wallet", "No wallet found. Create or restore a wallet before connecting."));
        return;
    }

    // One-time wiring: dropdown change + copy/explorer icons. These read
    // selectedConnectAddress at click time.
    const sel = el("dappAccountSelect") as HTMLSelectElement | null;
    if (sel) sel.addEventListener("change", function () { setSelectedConnectAddress(sel.value); });

    const copyBtn = el("dappCopyAddr");
    if (copyBtn) copyBtn.addEventListener("click", function () {
        if (!selectedConnectAddress) return;
        try { void WriteTextToClipboard(selectedConnectAddress); } catch { /* ignore */ }
    });

    const expBtn = el("dappExplorerAddr");
    if (expBtn) expBtn.addEventListener("click", async function () {
        if (!selectedConnectAddress) return;
        try {
            await ensureNetwork();
            const net = networkInfo();
            if (net && net.blockExplorerDomain) {
                await OpenUrl("https://" + net.blockExplorerDomain + "/account/" + selectedConnectAddress);
            }
        } catch (e) { setStatus(errMsg(e)); }
    });

    // If the docked wallet is unlocked, its current address is shared and we
    // can show it as the default (Sign & Connect, single click). Otherwise the
    // first click must Unlock (which then reveals the account dropdown).
    // item 24: only trust the shared session address for the single-click
    // "ready" path if it is a valid QuantumCoin address. A spoofed/garbage
    // value falls through to the locked/unlock path (which loads wallets under
    // the password). doConnect already rejects any address not present in the
    // password-loaded wallets, so this only closes the display-spoof.
    let sessionAddress = await readSessionAddress();
    if (sessionAddress && !(await isQcAddress(sessionAddress))) {
        sessionAddress = null;
    }
    if (sessionAddress) {
        connectState = "ready";
        connectAccounts = null;
        show("dappConnectScreen", true);
        if (sel) sel.style.display = "none";
        setSelectedConnectAddress(sessionAddress);
        el("dappApproveBtn")!.textContent = t("dapp-connect", "Sign & Connect");
        showIAgreeRow(true);
    } else {
        connectState = "locked";
        show("dappConnectScreen", false);
        el("dappApproveBtn")!.textContent = t("dapp-unlock", "Unlock");
        showIAgreeRow(true);
    }
}

function renderSign(origin: string, params: Record<string, any>): void {
    void origin;
    el("dappTitle")!.textContent = t("dapp-sign-title", "Sign Message");
    // SEC-14: reject-only when the message carries spoofing Unicode so the
    // rendered text can never differ from the bytes being signed.
    if (containsUnsafeDisplayText(params.message)) {
        showErrorOnlyReject(t("dapp-unsafe-chars", "This request contains hidden or direction-changing characters that can disguise what you are approving. It was rejected for your safety."));
        return;
    }
    renderAccountRow(params.address);
    show("dappSignScreen", true);
    el("dappSignMessage")!.textContent = String(params.message == null ? "" : params.message);
    el("dappApproveBtn")!.textContent = t("dapp-sign", "Sign");
    showIAgreeRow(true);
    setStatus("");
}

// ---- rendering: generic transaction (WYSIWYS) ------------------------
function formatValueQ(decimalStr: unknown): string {
    const s = (decimalStr == null || decimalStr === "") ? "0" : String(decimalStr);
    return s + " " + GAS_FEE_UNIT_LABEL;
}

// Render the decoded argument list. Values are dApp-influenced (only through
// the exact signed bytes), so they are set via textContent, never innerHTML.
function renderTxParams(args: Array<{ name?: string; type?: string; value?: unknown }> | null | undefined): void {
    const box = el("dappTxParams");
    if (!box) return;
    box.replaceChildren();
    if (!args || !args.length) { show("dappTxParams", false); return; }
    show("dappTxParams", true);
    const title = document.createElement("div");
    title.className = "heading medium";
    title.textContent = t("dapp-parameters", "Parameters");
    box.appendChild(title);
    args.forEach(function (a, i) {
        const row = document.createElement("div");
        row.style.cssText = "font-size:0.8em; word-break:break-all; margin-top:4px; padding-left:6px;";
        row.textContent = (a.name || ("arg" + i)) + " (" + (a.type || "") + "): " + (a.value == null ? "" : String(a.value));
        box.appendChild(row);
    });
}

// Decode + strictly verify the pending generic transaction before showing any
// approvable UI. On any decode/mismatch failure, present an OK-only reject
// dialog so a tampered/unverifiable transaction can never be signed.
async function renderTransaction(origin: string, params: Record<string, any>): Promise<void> {
    void origin;
    el("dappTitle")!.textContent = t("dapp-tx-title", "Confirm Transaction");
    setStatus(t("dapp-decoding", "Verifying transaction…"));
    (el("dappApproveBtn") as HTMLButtonElement).disabled = true;

    await ensureNetwork();
    const net = networkInfo();

    // item 4: if the site connected on a different network than the wallet's
    // current active network, refuse to sign (the broker forwards the connected
    // site's chainId as params.chainId). Prevents signing a tx meant for one
    // chain against a different active chain after the user switched networks.
    if (params.chainId != null && net && params.chainId !== net.chainId) {
        showErrorOnlyReject(t("dapp-chain-mismatch", "Your wallet's active network differs from the network this site is connected to. Switch back to the connected network before approving."));
        return;
    }

    // SEC-14: reject-only when any dApp-displayed value carries spoofing Unicode
    // (checked on the raw request before it is decoded/shown).
    if (anyUnsafeDisplayText([params.to, params.data, params.value])) {
        showErrorOnlyReject(t("dapp-unsafe-chars", "This request contains hidden or direction-changing characters that can disguise what you are approving. It was rejected for your safety."));
        return;
    }

    let decoded;
    try {
        decoded = await decodeTransaction({
            rpcEndpoint: currentNet ? currentNet.rpcEndpoint : null,
            chainId: net ? net.chainId : (params.chainId || 0),
            to: params.to,
            data: params.data,
            value: params.value,
            abi: params.abi,
            bytecode: params.bytecode,
        });
    } catch (e) {
        showErrorOnlyReject(errMsg(e));
        return;
    }
    if (!decoded || !decoded.success) {
        showErrorOnlyReject((decoded && decoded.error) ? decoded.error : null);
        return;
    }

    // SEC-14: reject-only when any decoded value that will be displayed carries
    // spoofing Unicode (method/signature label, decoded arg values, the shown
    // "To" address, and the value amount).
    const decodedDisplayValues: unknown[] = [decoded.to, decoded.method, decoded.signature, decoded.valueDecimal];
    if (decoded.args && decoded.args.length) {
        for (let ai = 0; ai < decoded.args.length; ai++) {
            const av = decoded.args[ai];
            if (av) decodedDisplayValues.push(av.value == null ? "" : String(av.value));
        }
    }
    if (anyUnsafeDisplayText(decodedDisplayValues)) {
        showErrorOnlyReject(t("dapp-unsafe-chars", "This request contains hidden or direction-changing characters that can disguise what you are approving. It was rejected for your safety."));
        return;
    }

    // item 12: stash the exact bytes that passed verification so
    // doSendTransaction can confirm the request was not mutated before signing.
    verifiedTx = {
        to: params.to == null ? "" : String(params.to),
        data: params.data == null ? "" : String(params.data),
        value: params.value == null ? "" : String(params.value),
    };

    renderAccountRow(params.from);
    show("dappTxScreen", true);
    // item 11: contract-creation deploys have opaque, unverified bytecode.
    show("dapp-deploy-warning", decoded.kind === "deploy");
    if (decoded.kind === "deploy") {
        el("dappTxTargetLabel")!.textContent = "";
        el("dappTxTarget")!.textContent = t("dapp-contract-creation", "Contract creation");
    } else {
        // Label kept in its own (non-bold) span; only the address is bold.
        el("dappTxTargetLabel")!.textContent = t("dapp-to", "To") + ": ";
        el("dappTxTarget")!.textContent = decoded.to || "";
    }
    el("dappTxValue")!.textContent = formatValueQ(decoded.valueDecimal);
    if (decoded.method) {
        show("dappTxMethodRow", true);
        el("dappTxMethod")!.textContent = decoded.signature || decoded.method;
    } else {
        show("dappTxMethodRow", false);
    }
    renderTxParams(decoded.args);
    el("dappTxData")!.textContent = params.data || "0x";

    el("dappApproveBtn")!.textContent = t("dapp-send", "Sign & Send");
    (el("dappApproveBtn") as HTMLButtonElement).disabled = false;
    showIAgreeRow(true);
    setStatus("");

    // Gas controls (parity with the Send screen).
    dappGasConfig = { gasLimit: null, gasFee: null, gasPriceWei: null, overridden: false };
    show("dappGasHeaderRight", true);
    const gasRun = estimateGenericGas(params).catch(function () { setGasIconPulse(false); });
    dappGasEstimateInFlight = gasRun;
    void gasRun.finally(function () {
        if (dappGasEstimateInFlight === gasRun) dappGasEstimateInFlight = null;
    });
}

// ---- entry point -----------------------------------------------------
export async function initDappApproval(): Promise<void> {
    startKeepAlive();
    installErrorGuards();
    document.documentElement.setAttribute("data-view", "approval");

    await loadLang();
    fillLang();
    wirePasswordToggle();
    wireGasControls();

    // Popup title (browser window + header banner) is always "QuantumSwap".
    document.title = "QuantumSwap";
    const titleEl = el("divWalletTitle");
    if (titleEl) titleEl.textContent = t("title", "QuantumSwap");

    setStatus(t("dapp-loading", "Loading request…"));

    // Redirector modes: the dApp-triggered popup only points the user at the
    // side panel; no request details render here at all.
    if (APPROVAL_MODE === "notice") { renderNoticeMode(); return; }
    if (APPROVAL_MODE === "open-panel") { await renderOpenPanelMode(); return; }

    // Hide the card until the Spoof Buster gate resolves so no request UI is
    // visible before the words are confirmed (error paths below re-show it).
    show("dappApprovalRoot", false);

    el("dappRejectBtn")!.addEventListener("click", function () {
        if (spoofTrainingModeB) {
            // Method B drill: rejecting the gate-less window is the right call.
            showSpoofTrainingDialog(
                t("spoof-training-b-good-catch", "Correct - the Spoof Buster words were never shown, so this window should not be trusted. This was a training check; the request was rejected."),
                true,
            );
            return;
        }
        replyReject("User rejected the request").catch(function () { closeWindow(); });
    });
    el("dappApproveBtn")!.addEventListener("click", onApprove);

    try {
        const res = await sendToBackground({ type: "qc-approval-getRequest", requestId: REQUEST_ID });
        if (!res || !res.ok || !res.request) {
            show("dappApprovalRoot", true);
            setStatus(t("dapp-request-unavailable", "This request is no longer available."));
            (el("dappApproveBtn") as HTMLButtonElement).disabled = true;
            return;
        }
        pendingRequest = res.request as PendingApprovalRequest;
        const origin = pendingRequest.origin || "";
        const params = pendingRequest.params || {};
        el("dappOrigin")!.textContent = origin;

        // Reject incompatible / malformed requests up front: show the message,
        // disable Approve, and don't render the request screen (Reject stays).
        const verr = await validateApprovalRequest(pendingRequest.method, params);
        if (verr) {
            show("dappApprovalRoot", true);
            setStatus(verr);
            (el("dappApproveBtn") as HTMLButtonElement).disabled = true;
            return;
        }

        // Spoof Buster gate (or a training round) before any request details.
        const gate = await runSpoofGatePhase();
        if (gate === "handled") return;

        switch (pendingRequest.method) {
            case "qc_requestAccounts":
                await renderConnect(origin);
                break;
            case "qc_signMessage":
                renderSign(origin, params);
                break;
            case "qc_sendTransaction":
                await renderTransaction(origin, params);
                break;
            default:
                setStatus("Unsupported request: " + pendingRequest.method);
                (el("dappApproveBtn") as HTMLButtonElement).disabled = true;
        }
    } catch (e) {
        setStatus(errMsg(e));
    }
}
