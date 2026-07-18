// Swap screen logic (quotes, allowances, execution, success panel).
// 1:1 port of the swap section of the old src/js/app.js.
import {
    getSwapCheckAllowance,
    getSwapCheckPairExists,
    getSwapQuoteAmountsIn,
    getSwapQuoteAmountsOut,
    OpenUrl,
    submitSwapAddAllowance,
    submitSwapSwap,
    weiToEtherFormatted,
    WriteTextToClipboard,
    SwapCheckPairExistsResult,
} from "../lib/bridge";
import { htmlEncode } from "../lib/util";
import { langJson } from "../lib/i18n";
import {
    ADDRESS_TEMPLATE,
    BLOCK_EXPLORER_ACCOUNT_TEMPLATE,
    BLOCK_EXPLORER_DOMAIN_TEMPLATE,
    QuantumCoin,
    byId,
    inputById,
    networkStore,
    selectById,
    tokenStore,
    walletStore,
    zero_address,
} from "./state";
import {
    APPROVE_DEFAULT_GAS,
    SWAP_DEFAULT_GAS,
    SWAP_GAS_FEE_RATE,
    estimateGasForContext,
    formatGasFeeQ,
} from "./gas";
import { ReviewedTxStepDefinition, requireTxHash, showReviewThenSteps } from "./txflow";
import { createSwapReviewQuantities, createSwapSuccessAmounts, createSwapWorkflowStepPlan } from "./swap-flow";

function showSwapNetworkError(e: any): void {
    showWarnAlert((e && e.message) ? e.message : String(e));
}
import { showWarnAlert } from "./dialog";
import { OpenScanTxn, refreshAccountBalance, removeOptions, setHeaderBand, showWalletScreen } from "./app";
import { applySwapReleaseToPayload, currentSwapRelease } from "./release";
import { BUILTIN_SWAP_RELEASES } from "../lib/release";
import { getCachedManualToken } from "./manual-token";
import { TOKEN_LIST_STATE_EVENT } from "./token-list-state";
import {
    applyTokenPickerSelection,
    openTokenPicker,
    setTokenPickerTriggerText,
} from "./token-picker";

export const SWAP_SHOW_NATIVE_COIN = false;

function swapSelectId(side: "from" | "to"): string {
    return side === "from" ? "ddlSwapFromToken" : "ddlSwapToToken";
}

function selectedSwapToken(side: "from" | "to"): string {
    return selectById(swapSelectId(side)).value;
}

function updateSwapQuantityVisibility(): void {
    const ready = selectedSwapToken("from") !== "" && selectedSwapToken("to") !== "";
    byId("divSwapFromQuantityBox").style.display = ready ? "block" : "none";
    byId("divSwapToQuantityBox").style.display = ready ? "block" : "none";
    byId("divSwapFlip").style.display = ready ? "block" : "none";
    const flip = byId<HTMLButtonElement>("btnSwapFlipTokens");
    flip.disabled = !ready;
}

export async function flipSwapTokens(): Promise<void> {
    const from = selectById("ddlSwapFromToken");
    const to = selectById("ddlSwapToToken");
    const fromValue = from.value;
    const toValue = to.value;
    if (!fromValue || !toValue) return;
    const fromText = from.options[from.selectedIndex]?.text || fromValue;
    const toText = to.options[to.selectedIndex]?.text || toValue;
    const previousToQuantity = inputById("txtSwapToQuantity").value;
    restoreSwapOption(from, toValue, toText);
    restoreSwapOption(to, fromValue, fromText);
    setTokenPickerTriggerText("ddlSwapFromToken", "btnSwapFromTokenPicker");
    setTokenPickerTriggerText("ddlSwapToToken", "btnSwapToTokenPicker");
    await updateSwapScreenInfo();
    if (previousToQuantity) {
        inputById("txtSwapFromQuantity").value = previousToQuantity;
        updateToQuantityFromFrom();
    }
}

export function openSwapTokenPicker(side: "from" | "to"): void {
    const otherSide = side === "from" ? "to" : "from";
    const triggerId = side === "from" ? "btnSwapFromTokenPicker" : "btnSwapToTokenPicker";
    openTokenPicker({
        allowNativeQ: SWAP_SHOW_NATIVE_COIN,
        allowUnrecognized: true,
        excludeValue: selectedSwapToken(otherSide),
        onSelect: (item) => {
            applyTokenPickerSelection(swapSelectId(side), triggerId, item);
            swapTokenSymbolCache[item.value.toLowerCase()] = item.symbol;
            void updateSwapScreenInfo();
        },
    });
}

export function getSwapSymbolFromValue(value: string): string {
    if (!value || value === "Q") return "Q";
    const lower = value.toLowerCase();
    if (networkStore.currentBlockchainNetwork) {
        const manual = getCachedManualToken(
            parseInt(String(networkStore.currentBlockchainNetwork.networkId), 10),
            value,
        );
        if (manual != null) return manual.symbol;
    }
    if (tokenStore.currentWalletTokenList == null) return "Q";
    for (let i = 0; i < tokenStore.currentWalletTokenList.length; i++) {
        if (tokenStore.currentWalletTokenList[i].contractAddress.toLowerCase() === lower) {
            return tokenStore.currentWalletTokenList[i].symbol || "Q";
        }
    }
    return "Q";
}

export async function getSwapBalanceForSymbol(value: string): Promise<string> {
    if (!value) return "0";
    if (value === "Q" && walletStore.currentAccountDetails != null) {
        return await weiToEtherFormatted(walletStore.currentAccountDetails.balance);
    }
    if (networkStore.currentBlockchainNetwork) {
        const manual = getCachedManualToken(
            parseInt(String(networkStore.currentBlockchainNetwork.networkId), 10),
            value,
        );
        if (manual != null) return manual.balance;
    }
    if (tokenStore.currentWalletTokenList == null) return "0";
    const lower = value.toLowerCase();
    for (let i = 0; i < tokenStore.currentWalletTokenList.length; i++) {
        if (tokenStore.currentWalletTokenList[i].contractAddress.toLowerCase() === lower) {
            return tokenStore.currentWalletTokenList[i].tokenBalance || "0";
        }
    }
    return "0";
}

export function getSwapContractAddress(value: string): string {
    return (!value || value === "Q") ? zero_address : value;
}

export async function updateSwapBalanceLabels(): Promise<void> {
    const fromSymbol = selectedSwapToken("from");
    const toSymbol = selectedSwapToken("to");
    const fromBal = await getSwapBalanceForSymbol(fromSymbol);
    const toBal = await getSwapBalanceForSymbol(toSymbol);
    byId("spanSwapFromBalance").textContent = fromBal;
    byId("spanSwapToBalance").textContent = toBal;
}

export function normalizeAmountForNumberInput(value: unknown): string {
    if (value == null || value === "") return "";
    return String(value).replace(/,/g, "").trim();
}

export function setSwapFromQuantityToBalance(): boolean {
    (async function () {
        const fromSymbol = selectedSwapToken("from");
        const bal = await getSwapBalanceForSymbol(fromSymbol);
        inputById("txtSwapFromQuantity").value = normalizeAmountForNumberInput(bal);
        updateToQuantityFromFrom();
    })();
    return false;
}

export function setSwapToQuantityToBalance(): boolean {
    (async function () {
        const toSymbol = selectedSwapToken("to");
        const bal = await getSwapBalanceForSymbol(toSymbol);
        inputById("txtSwapToQuantity").value = normalizeAmountForNumberInput(bal);
        updateFromQuantityFromTo();
    })();
    return false;
}

export function getSwapDropdownDisplayText(tokenName: string, tokenSymbol: string, contractAddress: string): string {
    const namePart = (tokenName || "").substring(0, 25);
    const symbolPart = (tokenSymbol || "").substring(0, 6);
    if (!contractAddress || contractAddress === zero_address) {
        return namePart + " (" + symbolPart + ")";
    }
    const addr = contractAddress;
    const addrPart = addr.length >= 10 ? addr.substring(0, 5) + "..." + addr.slice(-5) : addr;
    return namePart + " (" + symbolPart + ") " + addrPart;
}

export function getSwapTokenListFromWallet(includeUnrecognized = true): { value: string; displayText: string }[] {
    const list: { value: string; displayText: string }[] = [];
    if (SWAP_SHOW_NATIVE_COIN) {
        list.push({ value: "Q", displayText: QuantumCoin + " (Q)" });
    }
    // These lists are already filtered upstream to exclude stablecoin
    // impersonators. Recognized contracts are always shown; unrecognized
    // contracts are opt-in on the Swap screen.
    const walletTokens = tokenStore.currentWalletRecognizedTokens.concat(
        includeUnrecognized ? tokenStore.currentWalletUnrecognizedTokens : [],
    );
    if (walletTokens.length > 0) {
        for (let i = 0; i < walletTokens.length; i++) {
            const t = walletTokens[i];
            if (!t.symbol || !t.name || !t.contractAddress) continue;
            if (htmlEncode(t.name) !== t.name || htmlEncode(t.symbol) !== t.symbol) continue;
            list.push({
                value: t.contractAddress,
                displayText: getSwapDropdownDisplayText(t.name, t.symbol, t.contractAddress),
            });
        }
    }
    return list;
}

export function populateSwapTokenDropdowns(): void {
    const swapTokenList = getSwapTokenListFromWallet(false);
    const ddlFrom = selectById("ddlSwapFromToken");
    const ddlTo = selectById("ddlSwapToToken");
    removeOptions(ddlFrom);
    removeOptions(ddlTo);
    const selectTokenText = (langJson && langJson.langValues && langJson.langValues["select-token"]) ? langJson.langValues["select-token"] : "Select token";
    const optFromPlaceholder = document.createElement("option");
    optFromPlaceholder.value = "";
    optFromPlaceholder.text = selectTokenText;
    ddlFrom.add(optFromPlaceholder);
    const optToPlaceholder = document.createElement("option");
    optToPlaceholder.value = "";
    optToPlaceholder.text = selectTokenText;
    ddlTo.add(optToPlaceholder);
    for (let i = 0; i < swapTokenList.length; i++) {
        const optFrom = document.createElement("option");
        optFrom.text = swapTokenList[i].displayText;
        optFrom.value = swapTokenList[i].value;
        ddlFrom.add(optFrom);
        const optTo = document.createElement("option");
        optTo.text = swapTokenList[i].displayText;
        optTo.value = swapTokenList[i].value;
        ddlTo.add(optTo);
    }
    ddlFrom.selectedIndex = 0;
    ddlTo.selectedIndex = 0;
    updateSwapTokenSymbolCache();
    setTokenPickerTriggerText("ddlSwapFromToken", "btnSwapFromTokenPicker");
    setTokenPickerTriggerText("ddlSwapToToken", "btnSwapToTokenPicker");
}

function syncSwapTokenListState(): void {
    const loading = document.getElementById("divSwapTokenListLoading");
    if (loading) loading.style.display = tokenStore.isTokenListLoading ? "block" : "none";
    if (tokenStore.isTokenListLoading) return;
    const ddlFrom = document.getElementById("ddlSwapFromToken") as HTMLSelectElement | null;
    const ddlTo = document.getElementById("ddlSwapToToken") as HTMLSelectElement | null;
    if (!ddlFrom || !ddlTo) return;
    const previousFrom = ddlFrom.value;
    const previousTo = ddlTo.value;
    const previousFromText = ddlFrom.options[ddlFrom.selectedIndex]?.text || previousFrom;
    const previousToText = ddlTo.options[ddlTo.selectedIndex]?.text || previousTo;
    populateSwapTokenDropdowns();
    restoreSwapOption(ddlFrom, previousFrom, previousFromText);
    restoreSwapOption(ddlTo, previousTo, previousToText);
    setTokenPickerTriggerText("ddlSwapFromToken", "btnSwapFromTokenPicker");
    setTokenPickerTriggerText("ddlSwapToToken", "btnSwapToTokenPicker");
    void updateSwapBalanceLabels();
}

function restoreSwapOption(select: HTMLSelectElement, value: string, text: string): void {
    if (!value) return;
    const existing = Array.from(select.options).find((option) => option.value.toLowerCase() === value.toLowerCase());
    if (existing) {
        select.value = existing.value;
        return;
    }
    const option = document.createElement("option");
    option.value = value;
    option.text = text;
    select.add(option);
    select.value = value;
}

window.addEventListener(TOKEN_LIST_STATE_EVENT, syncSwapTokenListState);

let swapTokenSymbolCache: Record<string, string> = {};

export function updateSwapTokenSymbolCache(): void {
    swapTokenSymbolCache = { "q": "Q" };
    if (tokenStore.currentWalletTokenList != null) {
        for (let i = 0; i < tokenStore.currentWalletTokenList.length; i++) {
            const t = tokenStore.currentWalletTokenList[i];
            if (t.contractAddress && t.symbol) swapTokenSymbolCache[t.contractAddress.toLowerCase()] = t.symbol;
        }
    }
}

export function getSwapCachedSymbol(value: string): string {
    if (!value || value === "Q") return "Q";
    const cached = swapTokenSymbolCache[value.toLowerCase()];
    return cached != null ? cached : getSwapSymbolFromValue(value);
}

// ---- Multi-hop swap route display ----
// Current route as returned by the route check: array of { address, symbol }.
export interface SwapRouteEntry {
    address: string;
    symbol: string | null;
}

let swapCurrentRoute: SwapRouteEntry[] | null = null;
const SWAP_ROUTE_SYMBOL_MAX_LENGTH = 12;

// Sanitize an untrusted token symbol for display: strip spoofing Unicode
// (bidi/zero-width/control) and HTML-special characters (harmless via
// textContent, removed for defense in depth), then cap the length. Returns ""
// when nothing displayable remains.
export function sanitizeSwapSymbolForDisplay(raw: unknown): string {
    if (raw == null) return "";
    const s = String(raw)
        // eslint-disable-next-line no-control-regex -- stripping control characters is the point
        .replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF\u0000-\u001F\u007F-\u009F]/g, "")
        .replace(/[<>&"'`]/g, "");
    return s.substring(0, SWAP_ROUTE_SYMBOL_MAX_LENGTH).trim();
}

// Display text for one route token. Prefers the wallet's own (already filtered)
// symbol; otherwise the on-chain symbol returned by the route check. Both are
// untrusted, so the value is sanitized (spoofing/HTML-special characters
// stripped, length-capped); only when no displayable symbol remains does the
// shortened contract address appear. Rendered via textContent only.
export function getSwapRouteDisplaySymbol(address: string, symbol: string | null): string {
    const addrLower = String(address || "").toLowerCase();
    let candidate: string | null = null;
    if (tokenStore.currentWalletTokenList != null) {
        for (let i = 0; i < tokenStore.currentWalletTokenList.length; i++) {
            const t = tokenStore.currentWalletTokenList[i];
            if (t.contractAddress && String(t.contractAddress).toLowerCase() === addrLower && t.symbol) {
                candidate = t.symbol;
                break;
            }
        }
    }
    if (candidate == null && symbol != null) candidate = symbol;
    const s = sanitizeSwapSymbolForDisplay(candidate);
    if (s !== "") return s;
    const addr = String(address || "");
    return addr.length >= 12 ? addr.substring(0, 6) + "..." + addr.slice(-4) : addr;
}

export function updateSwapRoutePathDisplay(route: SwapRouteEntry[] | null): void {
    swapCurrentRoute = (route && route.length >= 2) ? route : null;
    const container = byId("divSwapRoutePath");
    const span = byId("spanSwapRoutePath");
    if (!container || !span) return;
    if (!swapCurrentRoute) {
        span.textContent = "";
        container.style.display = "none";
        return;
    }
    const parts: string[] = [];
    for (let i = 0; i < swapCurrentRoute.length; i++) {
        parts.push(getSwapRouteDisplaySymbol(swapCurrentRoute[i].address, swapCurrentRoute[i].symbol));
    }
    span.textContent = parts.join(" -> ");
    container.style.display = "block";
}

// Build the { address, symbol } route list from a SwapQuoteCheckPairExists result.
export function buildSwapRouteFromCheckResult(result: SwapCheckPairExistsResult | null): SwapRouteEntry[] | null {
    if (!result || result.exists !== true || !result.path || result.path.length < 2) return null;
    const route: SwapRouteEntry[] = [];
    for (let i = 0; i < result.path.length; i++) {
        route.push({
            address: result.path[i],
            symbol: (result.pathSymbols && result.pathSymbols[i] != null) ? result.pathSymbols[i] : null,
        });
    }
    return route;
}

let swapQuantityUpdating = false;
let swapQuoteFromDebounceId: ReturnType<typeof setTimeout> | null = null;
let swapLastChanged: "from" | "to" = "from"; // which quantity the user last edited
let swapQuoteToDebounceId: ReturnType<typeof setTimeout> | null = null;
const SWAP_QUOTE_DEBOUNCE_MS = 400;

export function getSwapTokenDecimals(value: string | null): number {
    if (!value || value === "Q") return 18;
    if (networkStore.currentBlockchainNetwork) {
        const manual = getCachedManualToken(
            parseInt(String(networkStore.currentBlockchainNetwork.networkId), 10),
            value,
        );
        if (manual != null) return manual.decimals;
    }
    const lower = value.toLowerCase();
    if (tokenStore.currentWalletTokenList != null) {
        for (let i = 0; i < tokenStore.currentWalletTokenList.length; i++) {
            const token = tokenStore.currentWalletTokenList[i] as { contractAddress: string; decimals?: number };
            if (token.contractAddress.toLowerCase() === lower && token.decimals != null) {
                return token.decimals;
            }
        }
    }
    return 18;
}

export function showSwapQuoteLoading(show: boolean): void {
    const el = byId("divSwapQuoteLoading");
    if (el) el.style.display = show ? "block" : "none";
}

export async function updateToQuantityFromFrom(): Promise<void> {
    if (swapQuantityUpdating) return;
    swapLastChanged = "from";
    const fromValue = selectedSwapToken("from");
    const toValue = selectedSwapToken("to");
    const fromQtyStr = (inputById("txtSwapFromQuantity").value || "").trim();
    const fromQty = parseFloat(fromQtyStr);

    if (!fromQtyStr || isNaN(fromQty) || fromQty < 0) {
        inputById("txtSwapToQuantity").value = "";
        return;
    }
    if (!fromValue || !toValue || fromValue.toLowerCase() === toValue.toLowerCase()) {
        inputById("txtSwapToQuantity").value = "";
        return;
    }
    if (!networkStore.currentBlockchainNetwork) return;

    swapQuantityUpdating = true;
    showSwapQuoteLoading(true);
    try {
        const payload = applySwapReleaseToPayload({
            rpcEndpoint: networkStore.currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(String(networkStore.currentBlockchainNetwork.networkId), 10) || 123123,
            amountIn: fromQtyStr,
            fromTokenValue: fromValue,
            toTokenValue: toValue,
            fromDecimals: getSwapTokenDecimals(fromValue),
            toDecimals: getSwapTokenDecimals(toValue),
        });
        const result = await getSwapQuoteAmountsOut(payload);
        if (result && result.success && result.amountOut != null) {
            const outStr = String(result.amountOut).replace(/\.?0+$/, "") || result.amountOut;
            inputById("txtSwapToQuantity").value = outStr;
        } else {
            inputById("txtSwapToQuantity").value = "";
            if (result && !result.success && result.error) {
                showWarnAlert(result.error);
            }
        }
    } catch (e: any) {
        inputById("txtSwapToQuantity").value = "";
        showSwapNetworkError(e);
    } finally {
        showSwapQuoteLoading(false);
        swapQuantityUpdating = false;
    }
}

export function debouncedUpdateToQuantityFromFrom(): void {
    if (swapQuoteFromDebounceId != null) clearTimeout(swapQuoteFromDebounceId);
    swapQuoteFromDebounceId = setTimeout(function () {
        swapQuoteFromDebounceId = null;
        updateToQuantityFromFrom();
    }, SWAP_QUOTE_DEBOUNCE_MS);
}

export async function updateFromQuantityFromTo(): Promise<void> {
    if (swapQuantityUpdating) return;
    swapLastChanged = "to";
    const fromValue = selectedSwapToken("from");
    const toValue = selectedSwapToken("to");
    const toQtyStr = (inputById("txtSwapToQuantity").value || "").trim();
    const toQty = parseFloat(toQtyStr);

    if (!toQtyStr || isNaN(toQty) || toQty < 0) {
        inputById("txtSwapFromQuantity").value = "";
        return;
    }
    if (!fromValue || !toValue || fromValue.toLowerCase() === toValue.toLowerCase()) {
        inputById("txtSwapFromQuantity").value = "";
        return;
    }
    if (!networkStore.currentBlockchainNetwork) return;

    swapQuantityUpdating = true;
    showSwapQuoteLoading(true);
    try {
        const payload = applySwapReleaseToPayload({
            rpcEndpoint: networkStore.currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(String(networkStore.currentBlockchainNetwork.networkId), 10),
            amountOut: toQtyStr,
            fromTokenValue: fromValue,
            toTokenValue: toValue,
            fromDecimals: getSwapTokenDecimals(fromValue),
            toDecimals: getSwapTokenDecimals(toValue),
        });
        const result = await getSwapQuoteAmountsIn(payload);
        if (result && result.success && result.amountIn != null) {
            const inStr = String(result.amountIn).replace(/\.?0+$/, "") || result.amountIn;
            inputById("txtSwapFromQuantity").value = inStr;
        } else {
            inputById("txtSwapFromQuantity").value = "";
            if (result && !result.success && result.error) {
                showWarnAlert(result.error);
            }
        }
    } catch (e: any) {
        inputById("txtSwapFromQuantity").value = "";
        showSwapNetworkError(e);
    } finally {
        showSwapQuoteLoading(false);
        swapQuantityUpdating = false;
    }
}

export function debouncedUpdateFromQuantityFromTo(): void {
    if (swapQuoteToDebounceId != null) clearTimeout(swapQuoteToDebounceId);
    swapQuoteToDebounceId = setTimeout(function () {
        swapQuoteToDebounceId = null;
        updateFromQuantityFromTo();
    }, SWAP_QUOTE_DEBOUNCE_MS);
}

export async function updateSwapScreenInfo(): Promise<boolean> {
    // Runs when either "from" or "to" token dropdown is changed. Find a swap route
    // (direct pair or multi-hop) and show an error when no route exists.
    inputById("txtSwapFromQuantity").value = "";
    inputById("txtSwapToQuantity").value = "";
    updateSwapRoutePathDisplay(null);
    updateSwapBalanceLabels();
    const fromValue = selectedSwapToken("from");
    const toValue = selectedSwapToken("to");
    updateSwapQuantityVisibility();
    if (!fromValue || !toValue || fromValue.toLowerCase() === toValue.toLowerCase()) {
        return false;
    }
    if (!networkStore.currentBlockchainNetwork) return false;
    let pairExists = false;
    try {
        const payload = applySwapReleaseToPayload({
            rpcEndpoint: networkStore.currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(String(networkStore.currentBlockchainNetwork.networkId), 10) || 123123,
            fromTokenValue: fromValue,
            toTokenValue: toValue,
        });
        const result = await getSwapCheckPairExists(payload);
        pairExists = result && result.exists === true;
        if (pairExists) {
            updateSwapRoutePathDisplay(buildSwapRouteFromCheckResult(result));
        } else {
            if (result && result.error) {
                showWarnAlert(result.error);
            } else {
                showWarnAlert((langJson && langJson.langValues && langJson.langValues["swap-no-pair"]) || "No swap route exists between these two tokens (max 3 hops)");
            }
            inputById("txtSwapToQuantity").value = "";
        }
    } catch (e: any) {
        showSwapNetworkError(e);
        inputById("txtSwapToQuantity").value = "";
    }
    if (pairExists) {
        updateToQuantityFromFrom();
    }
    return false;
}

export async function openSwapScreen(): Promise<boolean> {
    byId("divNetworkDropdown").style.display = "none";
    byId("HomeScreen").style.display = "none";
    byId("SendScreen").style.display = "none";
    byId("SwapScreen").style.display = "block";
    byId("ReceiveScreen").style.display = "none";
    byId("TransactionsScreen").style.display = "none";
    setHeaderBand("compact");

    byId("divSwapScreenInner").style.display = "block";
    byId("divSwapSuccessPanel").style.display = "none";
    populateSwapTokenDropdowns();
    syncSwapTokenListState();
    inputById("txtSwapFromQuantity").value = "";
    inputById("txtSwapToQuantity").value = "";
    updateSwapQuantityVisibility();
    updateSwapRoutePathDisplay(null);
    inputById("txtSwapFromQuantity").focus();
    updateSwapBalanceLabels();
    return false;
}

export async function onSwapNextClick(): Promise<boolean> {
    const fromValue = selectedSwapToken("from");
    const toValue = selectedSwapToken("to");
    const fromQty = (inputById("txtSwapFromQuantity").value || "").trim();
    const toQty = (inputById("txtSwapToQuantity").value || "").trim();
    const slippagePercent = parseFloat(inputById("txtSwapSlippage").value);
    if (!fromQty || parseFloat(fromQty) <= 0) {
        showWarnAlert((langJson.langValues["swap-from-quantity"] || "From quantity") + " " + (langJson.errors && langJson.errors.invalidValue ? langJson.errors.invalidValue : "is required"));
        return false;
    }
    if (!toQty || parseFloat(toQty) <= 0) {
        showWarnAlert((langJson.langValues["swap-to-quantity"] || "To quantity") + " " + (langJson.errors && langJson.errors.invalidValue ? langJson.errors.invalidValue : "is required"));
        return false;
    }
    if (!fromValue || !toValue || fromValue.toLowerCase() === toValue.toLowerCase()) {
        showWarnAlert((langJson && langJson.langValues && langJson.langValues["swap-no-pair"]));
        return false;
    }
    if (!Number.isFinite(slippagePercent) || slippagePercent < 0 || slippagePercent > 100) {
        showWarnAlert((langJson.langValues.slippage || "Slippage") + " " + (langJson.errors.invalidValue || "is invalid"));
        return false;
    }
    if (!networkStore.currentBlockchainNetwork) return false;

    try {
        const payload = applySwapReleaseToPayload({
            rpcEndpoint: networkStore.currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(String(networkStore.currentBlockchainNetwork.networkId), 10),
            fromTokenValue: fromValue,
            toTokenValue: toValue,
        });
        const result = await getSwapCheckPairExists(payload);
        if (!result || result.exists !== true) {
            updateSwapRoutePathDisplay(null);
            if (result && result.error) {
                showWarnAlert(result.error);
            } else {
                showWarnAlert((langJson && langJson.langValues && langJson.langValues["swap-no-pair"]));
            }
            return false;
        }
        updateSwapRoutePathDisplay(buildSwapRouteFromCheckResult(result));
    } catch (e: any) {
        showWarnAlert((e && e.message) ? e.message : String(e));
        return false;
    }

    try {
        const allowancePayload = applySwapReleaseToPayload({
            rpcEndpoint: networkStore.currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(String(networkStore.currentBlockchainNetwork.networkId), 10),
            fromTokenValue: fromValue,
            ownerAddress: walletStore.currentWalletAddress,
            requiredAmount: fromQty,
            fromDecimals: getSwapTokenDecimals(fromValue),
        });
        const allowanceResult = await getSwapCheckAllowance(allowancePayload);
        if (!allowanceResult || !allowanceResult.success) {
            showWarnAlert((allowanceResult && allowanceResult.error) ? allowanceResult.error : "Failed to check approval");
            byId("divSwapScreenInner").style.display = "block";
            return false;
        }

        swapSuccessFromToken = fromValue;
        swapSuccessToToken = toValue;
        swapSuccessFromQuantity = fromQty;
        swapSuccessToQuantity = toQty;
        swapSuccessWorkflowCompleted = false;
        swapSuccessTxHash = null;
        let submittedGasLimit = 0;

        // Picker symbols are cached when the dropdowns are populated, so step
        // labels do not fall back to shortened contract addresses if the
        // network token-list refresh is unavailable later.
        const fromSymbol = getSwapCachedSymbol(fromValue);
        const toSymbol = getSwapCachedSymbol(toValue);
        const routerAddress = currentSwapRelease
            ? currentSwapRelease.router
            : BUILTIN_SWAP_RELEASES[0].router;
        let swapActionText = (langJson.langValues.swap || "Swap") + " " + fromSymbol
            + " " + (langJson.langValues["swap-for"] || "for") + " " + toSymbol;
        if (swapCurrentRoute && swapCurrentRoute.length > 2) {
            // Multi-hop trade: append the full route so the user sees the
            // intermediate tokens their swap passes through.
            const routeText = swapCurrentRoute
                .map((entry) => getSwapRouteDisplaySymbol(entry.address, entry.symbol))
                .join(" -> ");
            swapActionText += " (" + routeText + ")";
        }
        const stepPlan = createSwapWorkflowStepPlan(
            !allowanceResult.sufficient,
            fromSymbol,
            toSymbol,
            langJson.langValues["step-approve"] || "Approve",
            langJson.langValues.swap || "Swap",
        );
        const reviewQuantities = createSwapReviewQuantities(
            fromValue,
            fromQty,
            fromSymbol,
            toValue,
            toQty,
            toSymbol,
        );

        showReviewThenSteps({
            review: {
                asset: swapActionText,
                fromTokenContractAddress: fromValue,
                toTokenContractAddress: toValue,
                toAddress: routerAddress,
                quantityLabelKey: "send-quantity",
                quantityValue: reviewQuantities.quantityValue,
                tokenQuantityValue: reviewQuantities.tokenQuantityValue,
            },
            stepsTitle: langJson.langValues.swap || "Swap",
            buildSteps: () => {
                const steps: ReviewedTxStepDefinition[] = [];
                if (!allowanceResult.sufficient) {
                    steps.push({
                        label: stepPlan[0].label,
                        review: {
                            asset: stepPlan[0].label,
                            toAddress: fromValue,
                            // Approval only concerns the token being spent, so
                            // show a single "Approval token contract" row.
                            fromTokenContractLabelKey: "approval-token-contract",
                            toTokenContractAddress: null,
                            quantityLabelKey: "send-quantity",
                            quantityValue: "0",
                            tokenQuantityLabelKey: "approval-token-quantity",
                            tokenQuantityValue: fromQty + " " + fromSymbol,
                        },
                        prepare: async () => estimateGasForContext({
                            txKind: "approve",
                            fromTokenValue: fromValue,
                            amount: fromQty,
                            fromDecimals: getSwapTokenDecimals(fromValue),
                            defaultGasLimit: APPROVE_DEFAULT_GAS,
                        }),
                        run: async (gasLimit, credentials) => {
                            const limit = gasLimit;
                            const txHash = requireTxHash(await submitSwapAddAllowance(applySwapReleaseToPayload({
                                rpcEndpoint: networkStore.currentBlockchainNetwork!.rpcEndpoint,
                                chainId: parseInt(String(networkStore.currentBlockchainNetwork!.networkId), 10),
                                fromTokenValue: fromValue,
                                amount: fromQty,
                                fromDecimals: getSwapTokenDecimals(fromValue),
                                privateKey: credentials.privateKey,
                                publicKey: credentials.publicKey,
                                gasLimit: limit,
                                advancedSigningEnabled: credentials.advancedSigningEnabled,
                            })));
                            submittedGasLimit += limit;
                            return txHash;
                        },
                    });
                }
                const swapPlan = stepPlan[stepPlan.length - 1];
                steps.push({
                    label: swapPlan.label,
                    prepare: async () => estimateGasForContext({
                        txKind: "swap",
                        fromTokenValue: fromValue,
                        toTokenValue: toValue,
                        amountIn: fromQty,
                        amountOut: toQty,
                        lastChanged: swapLastChanged || "from",
                        slippagePercent,
                        fromDecimals: getSwapTokenDecimals(fromValue),
                        toDecimals: getSwapTokenDecimals(toValue),
                        recipientAddress: walletStore.currentWalletAddress,
                        defaultGasLimit: SWAP_DEFAULT_GAS,
                    }),
                    run: async (gasLimit, credentials) => {
                        const limit = gasLimit;
                        const txHash = requireTxHash(await submitSwapSwap(applySwapReleaseToPayload({
                            rpcEndpoint: networkStore.currentBlockchainNetwork!.rpcEndpoint,
                            chainId: parseInt(String(networkStore.currentBlockchainNetwork!.networkId), 10),
                            fromTokenValue: fromValue,
                            toTokenValue: toValue,
                            amountIn: fromQty,
                            amountOut: toQty,
                            lastChanged: swapLastChanged || "from",
                            slippagePercent,
                            fromDecimals: getSwapTokenDecimals(fromValue),
                            toDecimals: getSwapTokenDecimals(toValue),
                            recipientAddress: walletStore.currentWalletAddress,
                            privateKey: credentials.privateKey,
                            publicKey: credentials.publicKey,
                            gasLimit: limit,
                            advancedSigningEnabled: credentials.advancedSigningEnabled,
                        })));
                        submittedGasLimit += limit;
                        swapSuccessTxHash = txHash;
                        return txHash;
                    },
                });
                return steps;
            },
            onAllDone: () => {
                swapSuccessWorkflowCompleted = true;
                swapSuccessGasLimit = submittedGasLimit;
            },
            onClose: () => {
                if (swapSuccessWorkflowCompleted) {
                    void finalizeSequentialSwapSuccess();
                }
            },
        });
    } catch (e: any) {
        showWarnAlert((e && e.message) ? e.message : String(e));
        byId("divSwapScreenInner").style.display = "block";
    }
    return false;
}

export function onSwapScreenBackClick(): boolean {
    if (byId("divSwapSuccessPanel").style.display !== "none") {
        goToFirstSwapScreen();
        return false;
    }
    showWalletScreen();
    return false;
}

let swapSuccessFromToken: string | null = null;
let swapSuccessToToken: string | null = null;
let swapSuccessFromQuantity: string | null = null;
let swapSuccessToQuantity: string | null = null;
let swapSuccessGasLimit: number | null = null;
let swapSuccessWorkflowCompleted = false;
let swapSuccessTxHash: string | null = null;

async function finalizeSequentialSwapSuccess(): Promise<void> {
    const fromToken = swapSuccessFromToken;
    const toToken = swapSuccessToToken;
    const fromQuantity = swapSuccessFromQuantity;
    const toQuantity = swapSuccessToQuantity;
    if (fromToken == null || toToken == null || fromQuantity == null || toQuantity == null) return;
    const gasFeeCoins = swapSuccessGasLimit != null
        ? formatGasFeeQ(swapSuccessGasLimit * SWAP_GAS_FEE_RATE)
        : "0";
    showSwapSuccessPanel(
        fromToken,
        toToken,
        fromQuantity,
        toQuantity,
        gasFeeCoins,
    );
    try {
        await refreshAccountBalance();
    } catch {
        // The swap is already confirmed. Keep the submitted amounts visible
        // if the post-send account refresh is unavailable.
    }
    swapSuccessFromToken = null;
    swapSuccessToToken = null;
    swapSuccessFromQuantity = null;
    swapSuccessToQuantity = null;
    swapSuccessGasLimit = null;
    swapSuccessWorkflowCompleted = false;
}

export function goToFirstSwapScreen(): void {
    byId("divSwapSuccessPanel").style.display = "none";
    byId("divSwapScreenInner").style.display = "block";
    swapSuccessWorkflowCompleted = false;
    swapSuccessTxHash = null;
}

export function setSwapSuccessSymbolAndLink(container: HTMLElement | null, symbol: string, explorerUrl: string, shortAddr: string): void {
    if (!container) return;
    container.textContent = "";
    if (!explorerUrl || !shortAddr) {
        container.textContent = symbol || "Q";
        return;
    }
    container.appendChild(document.createTextNode(symbol + " ("));
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = shortAddr;
    a.style.color = "#0066cc";
    a.style.textDecoration = "underline";
    a.onclick = function () { OpenUrl(explorerUrl); return false; };
    container.appendChild(a);
    container.appendChild(document.createTextNode(")"));
}

export function showSwapSuccessPanel(fromToken: string, toToken: string, fromQuantity: string, toQuantity: string, gasFeeCoins: string | null): void {
    byId("divSwapScreenInner").style.display = "none";
    byId("divSwapSuccessPanel").style.display = "block";

    const explorerBase = networkStore.currentBlockchainNetwork ? BLOCK_EXPLORER_ACCOUNT_TEMPLATE.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, networkStore.currentBlockchainNetwork.blockExplorerDomain) : "";
    const fromAddr = getSwapContractAddress(fromToken);
    const toAddr = getSwapContractAddress(toToken);
    const fromSymbol = getSwapCachedSymbol(fromToken);
    const toSymbol = getSwapCachedSymbol(toToken);
    function shortAddr(addr: string): string { return (!addr || addr === zero_address) ? "" : (String(addr).length > 10 ? String(addr).slice(0, 6) + "..." + String(addr).slice(-4) : addr); }
    const fromUrl = (fromAddr && fromAddr !== zero_address && explorerBase) ? explorerBase.replace(ADDRESS_TEMPLATE, fromAddr) : "";
    const toUrl = (toAddr && toAddr !== zero_address && explorerBase) ? explorerBase.replace(ADDRESS_TEMPLATE, toAddr) : "";

    setSwapSuccessSymbolAndLink(byId("spanSwapSuccessFromTokenDisplay"), fromSymbol, fromUrl, shortAddr(fromAddr));
    setSwapSuccessSymbolAndLink(byId("spanSwapSuccessToTokenDisplay"), toSymbol, toUrl, shortAddr(toAddr));

    const amounts = createSwapSuccessAmounts(fromQuantity, fromSymbol, toQuantity, toSymbol);
    byId("spanSwapSuccessFromQuantity").textContent = amounts.from;
    byId("spanSwapSuccessToQuantity").textContent = amounts.to;
    byId("spanSwapSuccessGasFee").textContent = gasFeeCoins != null ? String(gasFeeCoins) : "0";
    byId("pSwapSuccessTxHash").textContent = swapSuccessTxHash || "";
}

export async function copySwapSuccessTransactionHash(): Promise<void> {
    if (swapSuccessTxHash) await WriteTextToClipboard(swapSuccessTxHash);
}

export async function openSwapSuccessTransactionInExplorer(): Promise<void> {
    if (swapSuccessTxHash) await OpenScanTxn(swapSuccessTxHash);
}

export function onSwapSuccessOkClick(): boolean {
    goToFirstSwapScreen();
    void showWalletScreen();
    return false;
}

