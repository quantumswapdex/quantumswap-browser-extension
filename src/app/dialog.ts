// Modal dialog layer. 1:1 port of the old src/js/dialog.js.
// The old file ran its element lookups at script-eval time (after the static
// HTML body existed). Here initDialogs() performs the same lookups/bindings
// and is called from the renderer entry right after the DOM is built.
import { htmlEncode } from "../lib/util";
import { langJson } from "../lib/i18n";
import { storeEulaAccepted } from "../lib/storage";
import { byId, inputById, networkStore, removeAllChildren } from "./state";
import { formatGasFeeNumber } from "./gas";
import {
    getGenericError,
    resumePostEula,
    saveSelectedBlockchainNetwork,
    showBlockchainNetworks,
} from "./app";
import { advancedSigningGetDefaultValue, saveSelectedAdvancedSigningSetting } from "./settings";
import { closeSendCompletedDialog } from "./send";

let modalOkDialog: HTMLDialogElement;
let divSuccess: HTMLElement;
let divWarn: HTMLElement;
let pDetails: HTMLElement;
let onCloseFunc: (() => void) | null = null;

let modalConfirm: HTMLDialogElement;
let pDetailsConfirm: HTMLElement;
let txtConfirm: HTMLInputElement;

let onConfirmFunc: (() => void) | null = null;

// Yes/No confirmation
let modalYesNoDialog: HTMLDialogElement;
let pDetailsYesNo: HTMLElement;
let onYesNoConfirmFunc: (() => void) | null = null;

export function showYesNoConfirm(txt: string, onConfirm: () => void): void {
    pDetailsYesNo.innerText = htmlEncode(txt);
    onYesNoConfirmFunc = onConfirm;
    modalYesNoDialog.style.display = "block";
    modalYesNoDialog.showModal();
}

// Release-switch password prompt: the default swap release index is stored
// encrypted with the wallet main key, so switching requires the password.
let modalReleasePassword: HTMLDialogElement;
let onReleasePasswordOk: ((password: string) => void) | null = null;

export function showReleasePasswordDialog(onOk: (password: string) => void): void {
    inputById("pwdReleasePassword").value = "";
    onReleasePasswordOk = onOk;
    modalReleasePassword.style.display = "block";
    modalReleasePassword.showModal();
    inputById("pwdReleasePassword").focus();
}

//Gas configuration
let modalGasConfig: HTMLDialogElement;
let onGasConfigOk: ((result: { gasLimit: string; gasFee: string }) => void) | null = null;

// Price per gas unit (coins) derived from the estimate the dialog was opened with.
// Used to recompute the fee field live when the user edits the gas limit.
let gasConfigFeeRate: number | null = null;

// Bind a one-time input listener on the gas-limit field that recomputes the fee
// field as (gasLimit * gasConfigFeeRate). Generic: applies to every screen that
// opens this dialog (send, validator, swap), since they all share these inputs.
function bindGasLimitRecompute(limitEl: HTMLInputElement | null, feeEl: HTMLElement | null): void {
    if (!limitEl || !feeEl || limitEl.dataset.gasRecomputeBound) return;
    limitEl.dataset.gasRecomputeBound = "1";
    limitEl.addEventListener("input", function () {
        if (gasConfigFeeRate == null) return;
        const lim = parseFloat(limitEl.value);
        if (isNaN(lim) || lim < 0) return;
        const fee = lim * gasConfigFeeRate;
        feeEl.textContent = formatGasFeeNumber(fee);
    });
}

export interface GasConfigDialogOptions {
    gasLimit?: string | null;
    gasFee?: string | null;
    onOk?: (result: { gasLimit: string; gasFee: string }) => void;
}

export function showGasConfigDialog(opts: GasConfigDialogOptions): boolean {
    opts = opts || {};
    const limitEl = inputById("txtGasLimit");
    const feeEl = byId("spanGasFee");
    if (limitEl) limitEl.value = (opts.gasLimit != null ? String(opts.gasLimit) : "");
    if (feeEl) feeEl.textContent = (opts.gasFee != null ? String(opts.gasFee) : "");
    // Derive the coins-per-gas-unit rate from the opened estimate so editing the
    // gas limit updates the fee. Null when there is no usable estimate yet.
    const limitNum = parseFloat(opts.gasLimit ?? "");
    const feeNum = parseFloat(opts.gasFee ?? "");
    gasConfigFeeRate = (!isNaN(limitNum) && limitNum > 0 && !isNaN(feeNum)) ? (feeNum / limitNum) : null;
    bindGasLimitRecompute(limitEl, feeEl);
    onGasConfigOk = (typeof opts.onOk === "function") ? opts.onOk : null;
    modalGasConfig.style.display = "block";
    modalGasConfig.showModal();
    setTimeout(function () { if (limitEl) limitEl.focus(); }, 80);
    return false;
}

// Transient tooltip-like toast shown above the active screen (e.g. send screen)
// when an RPC call fails. Auto-hides after `durationMs` (default 4000ms).
// The message is rendered via textContent, which never parses HTML, so any
// markup contained in an RPC return value / transport error is neutralized.
let gasToastTimerId: ReturnType<typeof setTimeout> | null = null;
export function showTransientToast(message: unknown, durationMs?: number): void {
    const el = byId("divGasToast");
    if (!el) return;
    let text = (message == null) ? "" : String(message);
    if (text.length > 300) text = text.substring(0, 297) + "...";
    el.textContent = text;
    el.classList.add("gas-toast-visible");
    if (gasToastTimerId) { clearTimeout(gasToastTimerId); gasToastTimerId = null; }
    gasToastTimerId = setTimeout(function () {
        el.classList.remove("gas-toast-visible");
        gasToastTimerId = null;
    }, durationMs || 4000);
}

//Network
let modalNetwork: HTMLDialogElement;
let onCloseFuncNetwork: (() => void) | null = null;

let modalAdvancedSigning: HTMLDialogElement;
let onCloseFuncAdvancedSigning: (() => void) | null = null;

export function showAlert(txt: string): void {
    modalOkDialog.style.display = "block";
    modalOkDialog.showModal();
    divSuccess.style.display = "block";
    divWarn.style.display = "none";
    pDetails.innerText = htmlEncode(txt);
}

export function showWarnAlert(txt: unknown): void {
    modalOkDialog.style.display = "block";
    modalOkDialog.showModal();
    divSuccess.style.display = "none";
    divWarn.style.display = "block";
    if (txt == null) {
        pDetails.innerText = "";
    } else {
        pDetails.innerText = htmlEncode(String(txt));
    }
}

export function showAlertAndExecuteOnClose(txt: string, f: () => void): void {
    modalOkDialog.style.display = "block";
    modalOkDialog.showModal();
    divSuccess.style.display = "block";
    divWarn.style.display = "none";
    pDetails.innerText = htmlEncode(txt);
    onCloseFunc = f;
}

export function showWarnAlertAndExecuteOnClose(txt: string, f: () => void): void {
    modalOkDialog.style.display = "block";
    modalOkDialog.showModal();
    divSuccess.style.display = "none";
    divWarn.style.display = "block";
    pDetails.innerText = htmlEncode(txt);
    onCloseFunc = f;
}

export async function showNetworkDialog(f?: () => void): Promise<boolean> {
    await showBlockchainNetworks();
    modalNetwork.style.display = "block";
    modalNetwork.showModal();
    onCloseFuncNetwork = f ?? null;
    return false;
}

export function showConfirmAndExecuteOnConfirm(txt: string, f: () => void): void {
    txtConfirm.value = "";
    modalConfirm.style.display = "block";
    modalConfirm.showModal();
    pDetailsConfirm.innerText = txt;
    onConfirmFunc = f;
    txtConfirm.focus();
}

export async function showAdvancedSigningSettingDialog(f?: () => void): Promise<boolean> {
    const defaultVal = await advancedSigningGetDefaultValue();
    if (defaultVal == false) {
        inputById("optAdvancedSigningDisabled").checked = true;
    } else {
        inputById("optAdvancedSigningEnabled").checked = true;
    }
    modalAdvancedSigning.style.display = "block";
    modalAdvancedSigning.showModal();
    onCloseFuncAdvancedSigning = f ?? null;
    return false;
}

let modalSwapApprovalSubmit: HTMLDialogElement | null;

let modalTransactionReview: HTMLDialogElement;
export interface TransactionReviewSubmission {
    password: string;
    startingNonce: number | null;
}

let txReviewOnSubmit: ((submission: TransactionReviewSubmission) => unknown) | null = null;
let txReviewOnCancel: (() => unknown) | null = null;
let txReviewRequirePassword = false;
let txReviewRequireNonce = false;

let modalSendCompleted: HTMLDialogElement;

export function showErrorAndLockup(err: unknown): void {
    modalOkDialog.style.display = "block";
    divSuccess.style.display = "none";
    divWarn.style.display = "block";
    modalOkDialog.showModal();

    byId("login-content").style.display = "none";
    byId("main-content").style.display = "none";
    byId("settings-content").style.display = "none";
    byId("wallets-content").style.display = "none";
    byId("divNetworkDropdown").style.display = "none";

    const msg = getGenericError(err);
    pDetails.innerText = htmlEncode(msg);
}

export function showLoadingAndExecuteAsync(txt: string, f: () => unknown): void {
    const modalWaitDialog = byId<HTMLDialogElement>("modalWaitDialog");
    modalWaitDialog.style.display = "block";
    modalWaitDialog.showModal();
    byId("pWaitDetails").innerText = txt;
    setTimeout(() => {
        f();
    }, 60);
}

export function showWaitingBox(txt: string): void {
    const modalWaitDialog = byId<HTMLDialogElement>("modalWaitDialog");
    modalWaitDialog.style.display = "block";
    modalWaitDialog.showModal();
    byId("pWaitDetails").innerText = txt;
}

export function hideWaitingBox(): void {
    const modalWaitDialog = byId<HTMLDialogElement>("modalWaitDialog");
    modalWaitDialog.style.display = "none";
    modalWaitDialog.close();
}

export function updateWaitingBox(txt: string): void {
    byId("pWaitDetails").innerText = txt;
}

let modalEulaDialog: HTMLDialogElement;
export function showEula(): void {
    modalEulaDialog.style.display = "block";
    modalEulaDialog.showModal();
    // The old app assigned langJson.langValues.eula through innerHTML; the EULA
    // string is plain text, so rendering it as a text node is byte-identical.
    const divEula = byId("divEula");
    removeAllChildren(divEula);
    divEula.textContent = langJson.langValues.eula;
}

export function closeTransactionReviewDialog(): void {
    if (modalTransactionReview) {
        modalTransactionReview.style.display = "none";
        modalTransactionReview.close();
    }
    txReviewOnSubmit = null;
    txReviewOnCancel = null;
    const password = document.getElementById("txtTxReviewPassword") as HTMLInputElement | null;
    const nonce = document.getElementById("txtTxReviewNonce") as HTMLInputElement | null;
    if (password) password.value = "";
    if (nonce) nonce.value = "";
}

export function txReviewNetworkText(): string {
    if (networkStore.currentBlockchainNetwork == null) {
        return "";
    }
    const name = networkStore.currentBlockchainNetwork.blockchainName || "";
    const chainId = networkStore.currentBlockchainNetwork.networkId;
    const chainSuffix = (langJson && langJson.langValues["chain-id-suffix"]) ? langJson.langValues["chain-id-suffix"] : "chain";
    if (name === "") {
        return "(" + chainSuffix + " " + chainId + ")";
    }
    return name + " (" + chainSuffix + " " + chainId + ")";
}

export interface TransactionReview {
    asset?: string;
    fromAddress?: string;
    toAddress?: string | null;
    quantityLabelKey?: string;
    quantityValue?: string;
    tokenQuantityLabelKey?: string;
    tokenQuantityValue?: string | null;
    gasLimit?: string;
    gasFee?: string;
    nonce?: string | null;
    networkText?: string;
    contractAddress?: string | null;
    fromTokenContractAddress?: string | null;
    fromTokenContractLabelKey?: string;
    toTokenContractAddress?: string | null;
    assetLabelKey?: string;
    requirePassword?: boolean;
    requireNonce?: boolean;
    showGas?: boolean;
    submitLabelKey?: string;
    onSubmit?: (submission: TransactionReviewSubmission) => unknown;
    onCancel?: () => unknown;
}

export function showTransactionReviewDialog(review: TransactionReview): boolean {
    byId("spanTxReviewAsset").textContent = review.asset || "";
    byId("spanTxReviewFrom").textContent = review.fromAddress || "";
    byId("spanTxReviewQuantity").textContent = review.quantityValue || "";
    const tokenQuantityRow = byId("rowTxReviewTokenQuantity");
    if (review.tokenQuantityValue) {
        byId("spanTxReviewTokenQuantity").textContent = review.tokenQuantityValue;
        tokenQuantityRow.style.display = "block";
    } else {
        byId("spanTxReviewTokenQuantity").textContent = "";
        tokenQuantityRow.style.display = "none";
    }
    byId("spanTxReviewGasLimit").textContent = review.gasLimit || "";
    byId("spanTxReviewGasFee").textContent = review.gasFee || "";
    byId("spanTxReviewNetwork").textContent = review.networkText || "";
    const showGas = review.showGas !== false;
    byId("rowTxReviewGasLimit").style.display = showGas ? "block" : "none";
    byId("rowTxReviewGasFee").style.display = showGas ? "block" : "none";

    const lblAsset = byId("lblTxReviewAsset");
    if (lblAsset) {
        const assetKey = review.assetLabelKey || "action";
        if (langJson && langJson.langValues[assetKey]) {
            lblAsset.textContent = langJson.langValues[assetKey];
        }
    }

    const lblQty = byId("lblTxReviewQuantity");
    if (lblQty && review.quantityLabelKey && langJson && langJson.langValues[review.quantityLabelKey]) {
        lblQty.textContent = langJson.langValues[review.quantityLabelKey];
    }

    const lblTokenQty = byId("lblTxReviewTokenQuantity");
    const tokenQuantityLabelKey = review.tokenQuantityLabelKey || "token-quantity";
    if (lblTokenQty && langJson && langJson.langValues[tokenQuantityLabelKey]) {
        lblTokenQty.textContent = langJson.langValues[tokenQuantityLabelKey];
    }

    const toRow = byId("rowTxReviewTo");
    if (review.toAddress != null && review.toAddress !== "") {
        byId("spanTxReviewTo").textContent = review.toAddress;
        toRow.style.display = "block";
    } else {
        byId("spanTxReviewTo").textContent = "";
        toRow.style.display = "none";
    }

    const contractRow = byId("rowTxReviewContract");
    if (review.contractAddress) {
        byId("spanTxReviewContract").textContent = review.contractAddress;
        contractRow.style.display = "block";
    } else {
        byId("spanTxReviewContract").textContent = "";
        contractRow.style.display = "none";
    }

    const setOptionalAddressRow = (rowId: string, spanId: string, value: string | null | undefined): void => {
        byId(spanId).textContent = value || "";
        byId(rowId).style.display = value ? "block" : "none";
    };
    setOptionalAddressRow(
        "rowTxReviewFromTokenContract",
        "spanTxReviewFromTokenContract",
        review.fromTokenContractAddress,
    );
    const lblFromTokenContract = byId("lblTxReviewFromTokenContract");
    if (lblFromTokenContract) {
        const fromTokenContractKey = review.fromTokenContractLabelKey || "swap-from-token-contract";
        if (langJson && langJson.langValues[fromTokenContractKey]) {
            lblFromTokenContract.textContent = langJson.langValues[fromTokenContractKey];
        }
    }
    setOptionalAddressRow(
        "rowTxReviewToTokenContract",
        "spanTxReviewToTokenContract",
        review.toTokenContractAddress,
    );

    const nonceRow = byId("rowTxReviewNonce");
    txReviewRequireNonce = review.requireNonce === true;
    if (txReviewRequireNonce || (review.nonce != null && review.nonce !== "")) {
        inputById("txtTxReviewNonce").value = review.nonce || "";
        nonceRow.style.display = "block";
    } else {
        inputById("txtTxReviewNonce").value = "";
        nonceRow.style.display = "none";
    }

    const pwdRow = byId("rowTxReviewPassword");
    txReviewRequirePassword = review.requirePassword === true;
    if (txReviewRequirePassword) {
        pwdRow.style.display = "block";
    } else {
        pwdRow.style.display = "none";
    }

    const submitBtn = byId("btnTxReviewSubmit");
    if (submitBtn && review.submitLabelKey && langJson && langJson.langValues[review.submitLabelKey]) {
        submitBtn.textContent = langJson.langValues[review.submitLabelKey];
    }

    inputById("txtTxReviewIAgree").value = "";
    const pwdInput = inputById("txtTxReviewPassword");
    if (pwdInput) {
        pwdInput.value = "";
        pwdInput.type = "password";
    }
    const pwdEye = byId<HTMLImageElement>("imgTxReviewPasswordEye");
    if (pwdEye) pwdEye.src = "assets/svg/eye-outline.svg";

    txReviewOnSubmit = review.onSubmit || null;
    txReviewOnCancel = review.onCancel || null;
    modalTransactionReview.style.display = "block";
    modalTransactionReview.showModal();
    setTimeout(function () {
        const el = byId("txtTxReviewIAgree");
        if (el) { el.focus(); }
    }, 100);
    return false;
}

function cancelTransactionReview(): void {
    modalTransactionReview.style.display = "none";
    modalTransactionReview.close();
    txReviewOnSubmit = null;
    inputById("txtTxReviewPassword").value = "";
    inputById("txtTxReviewNonce").value = "";
    const cb = txReviewOnCancel;
    txReviewOnCancel = null;
    if (cb != null) void cb();
}

// Wires all static dialog buttons. Must run after the generated body is
// attached to the document (replaces the old script-eval-time bindings).
export function initDialogs(): void {
    modalOkDialog = byId<HTMLDialogElement>("modalOkDialog");
    divSuccess = byId("divSuccess");
    divWarn = byId("divWarn");
    pDetails = byId("pDetails");
    const span = document.getElementsByClassName("close")[0] as HTMLElement;

    modalConfirm = byId<HTMLDialogElement>("modalConfirmDialog");
    pDetailsConfirm = byId("pDetailsConfirm");
    txtConfirm = inputById("txtConfirm");
    const spanConfirm = document.getElementsByClassName("proceed")[0] as HTMLElement;
    const spanCancel = document.getElementsByClassName("cancel")[0] as HTMLElement;

    modalYesNoDialog = byId<HTMLDialogElement>("modalYesNoDialog");
    pDetailsYesNo = byId("pDetailsYesNo");
    const btnYesNoYes = byId("btnYesNoYes");
    const btnYesNoNo = byId("btnYesNoNo");

    modalGasConfig = byId<HTMLDialogElement>("modalGasConfig");
    const btnGasConfigOk = byId("btnGasConfigOk");
    const btnGasConfigCancel = byId("btnGasConfigCancel");

    modalReleasePassword = byId<HTMLDialogElement>("modalReleasePassword");
    const btnReleasePasswordOk = byId("btnReleasePasswordOk");
    const btnReleasePasswordCancel = byId("btnReleasePasswordCancel");

    modalNetwork = byId<HTMLDialogElement>("modalNetworkDialog");
    const spanNetwork = document.getElementsByClassName("oknetwork")[0] as HTMLElement;
    const spanCancelNetwork = byId("divCancelNetwork");

    modalAdvancedSigning = byId<HTMLDialogElement>("modalAdvancedSigning");
    const btnOkAdvancedSigning = byId("btnOkAdvancedSigning");
    const btnCancelAdvancedSigning = byId("btnCancelAdvancedSigning");

    modalSwapApprovalSubmit = byId<HTMLDialogElement>("modalSwapApprovalSubmit");
    modalTransactionReview = byId<HTMLDialogElement>("modalTransactionReview");
    const btnTxReviewSubmit = byId("btnTxReviewSubmit");
    const btnTxReviewCancel = byId("btnTxReviewCancel");
    modalSendCompleted = byId<HTMLDialogElement>("modalSendCompleted");

    modalEulaDialog = byId<HTMLDialogElement>("modalEulaDialog");
    const spanIAgree = byId("divIAgree");

    btnYesNoYes.onclick = function () {
        modalYesNoDialog.style.display = "none";
        modalYesNoDialog.close();
        if (onYesNoConfirmFunc != null) {
            onYesNoConfirmFunc();
            onYesNoConfirmFunc = null;
        }
    };

    btnYesNoNo.onclick = function () {
        modalYesNoDialog.style.display = "none";
        modalYesNoDialog.close();
        onYesNoConfirmFunc = null;
    };

    btnGasConfigOk.onclick = function () {
        const limitEl = inputById("txtGasLimit");
        const feeEl = byId("spanGasFee");
        const gasLimit = parseInt((limitEl && limitEl.value) || "", 10);
        const gasFee = (feeEl && feeEl.textContent != null) ? String(feeEl.textContent).trim() : "";
        const feeNum = parseFloat(gasFee);
        if (isNaN(gasLimit) || gasLimit <= 0 || isNaN(feeNum) || feeNum < 0) {
            showWarnAlert((langJson && langJson.errors && langJson.errors.invalidValue) ? langJson.errors.invalidValue : "Invalid value");
            return;
        }
        modalGasConfig.style.display = "none";
        modalGasConfig.close();
        const cb = onGasConfigOk;
        onGasConfigOk = null;
        if (cb != null) {
            cb({ gasLimit: String(gasLimit), gasFee: gasFee });
        }
    };

    btnGasConfigCancel.onclick = function () {
        modalGasConfig.style.display = "none";
        modalGasConfig.close();
        onGasConfigOk = null;
    };

    btnReleasePasswordOk.onclick = function () {
        const password = inputById("pwdReleasePassword").value;
        if (password == null || password === "") {
            showWarnAlert(langJson.errors.enterWalletPassord);
            return;
        }
        modalReleasePassword.style.display = "none";
        modalReleasePassword.close();
        inputById("pwdReleasePassword").value = "";
        const cb = onReleasePasswordOk;
        onReleasePasswordOk = null;
        if (cb != null) {
            cb(password);
        }
    };

    btnReleasePasswordCancel.onclick = function () {
        modalReleasePassword.style.display = "none";
        modalReleasePassword.close();
        inputById("pwdReleasePassword").value = "";
        onReleasePasswordOk = null;
    };

    span.onclick = function () {
        modalOkDialog.style.display = "none";
        modalOkDialog.close();
        if (onCloseFunc == null) {
            // nothing pending
        } else {
            onCloseFunc();
            onCloseFunc = null;
        }
    };

    spanConfirm.onclick = function () {
        if (!txtConfirm.value || txtConfirm.value != "i agree") {
            txtConfirm.value = "";
            return;
        }
        modalConfirm.style.display = "none";
        modalConfirm.close();
        txtConfirm.value = "";
        if (onConfirmFunc == null) {
            // nothing pending
        } else {
            onConfirmFunc();
            onConfirmFunc = null;
        }
    };

    spanCancel.onclick = function () {
        modalConfirm.style.display = "none";
        modalConfirm.close();
        onConfirmFunc = null;
    };

    spanNetwork.onclick = function () {
        modalNetwork.style.display = "none";
        modalNetwork.close();
        const network = document.querySelector<HTMLInputElement>('input[name="network_option"]:checked')?.value;
        if (!network || network === "") {
            // no selection
        } else {
            saveSelectedBlockchainNetwork();
        }

        if (onCloseFuncNetwork == null) {
            // nothing pending
        } else {
            onCloseFuncNetwork();
            onCloseFuncNetwork = null;
        }
    };

    spanCancelNetwork.onclick = function () {
        modalNetwork.style.display = "none";
        modalNetwork.close();
        onCloseFuncNetwork = null;
    };

    btnOkAdvancedSigning.onclick = function () {
        modalAdvancedSigning.style.display = "none";
        modalAdvancedSigning.close();
        const advancedSigningValue = document.querySelector<HTMLInputElement>('input[name="optAdvancedSigning"]:checked')?.value;
        if (!advancedSigningValue || advancedSigningValue === "") {
            // no selection
        } else {
            saveSelectedAdvancedSigningSetting();
        }

        if (onCloseFuncAdvancedSigning == null) {
            // nothing pending
        } else {
            onCloseFuncAdvancedSigning();
            onCloseFuncAdvancedSigning = null;
        }
    };

    btnCancelAdvancedSigning.onclick = function () {
        modalAdvancedSigning.style.display = "none";
        modalAdvancedSigning.close();
        onCloseFuncAdvancedSigning = null;
    };

    spanIAgree.onclick = async function () {
        modalEulaDialog.style.display = "none";
        modalEulaDialog.close();
        await storeEulaAccepted();
        await resumePostEula();
    };

    btnTxReviewSubmit.onclick = async function () {
        const iagree = (inputById("txtTxReviewIAgree").value || "").trim().toLowerCase();
        const required = (langJson && langJson.langValues["i-agree-literal"]) ? langJson.langValues["i-agree-literal"].toLowerCase() : "i agree";
        if (iagree !== required) {
            showWarnAlert(langJson.langValues["must-agree-to-submit"]);
            return;
        }
        const password = (inputById("txtTxReviewPassword").value || "").trim();
        if (txReviewRequirePassword && !password) {
            showWarnAlert(langJson.errors.enterWalletPassord);
            return;
        }
        const nonceText = (inputById("txtTxReviewNonce").value || "").trim();
        const startingNonce = nonceText === "" ? null : Number(nonceText);
        if (txReviewRequireNonce && (!Number.isInteger(startingNonce) || (startingNonce as number) < 0)) {
            showWarnAlert(langJson.errors.enterCurrentNonce);
            return;
        }
        const cb = txReviewOnSubmit;
        if (cb == null) return;
        let ok = false;
        try {
            const result = await cb({ password, startingNonce });
            ok = result !== false;
        } catch {
            ok = false;
        }
        if (!ok) {
            setTimeout(function () {
                const target = txReviewRequirePassword ? "txtTxReviewPassword" : "txtTxReviewIAgree";
                const el = byId(target);
                if (el) el.focus();
            }, 100);
            return;
        }
        modalTransactionReview.style.display = "none";
        modalTransactionReview.close();
        inputById("txtTxReviewPassword").value = "";
        inputById("txtTxReviewNonce").value = "";
        txReviewOnSubmit = null;
        txReviewOnCancel = null;
    };

    btnTxReviewCancel.onclick = function () {
        cancelTransactionReview();
    };
    modalTransactionReview.addEventListener("cancel", function (event) {
        event.preventDefault();
        cancelTransactionReview();
    });

    // Click on the dialog backdrop closes the open modal (same target checks as
    // the old window.onclick handler).
    window.onclick = function (event: MouseEvent) {
        if (event.target == modalOkDialog || event.target == modalConfirm || event.target == modalYesNoDialog || event.target == modalNetwork || event.target == modalAdvancedSigning || event.target == modalSwapApprovalSubmit || event.target == modalTransactionReview || event.target == modalSendCompleted || event.target == modalGasConfig || event.target == modalReleasePassword) {
            if (modalOkDialog.style.display !== "none") {
                modalNetwork.style.display = "none";
                modalNetwork.close();
            }

            if (modalConfirm.style.display !== "none") {
                modalConfirm.style.display = "none";
                modalConfirm.close();
            }

            if (modalYesNoDialog.style.display !== "none") {
                modalYesNoDialog.style.display = "none";
                modalYesNoDialog.close();
                onYesNoConfirmFunc = null;
            }

            if (modalNetwork.style.display !== "none") {
                modalNetwork.style.display = "none";
                modalNetwork.close();
            }

            if (modalAdvancedSigning && modalAdvancedSigning.style.display !== "none") {
                modalAdvancedSigning.style.display = "none";
                modalAdvancedSigning.close();
            }

            if (modalSwapApprovalSubmit && modalSwapApprovalSubmit.style.display !== "none") {
                modalSwapApprovalSubmit.style.display = "none";
                modalSwapApprovalSubmit.close();
            }
            if (modalTransactionReview && modalTransactionReview.style.display !== "none") {
                cancelTransactionReview();
            }
            if (modalSendCompleted && modalSendCompleted.style.display !== "none") {
                closeSendCompletedDialog();
            }
            if (modalGasConfig && modalGasConfig.style.display !== "none") {
                modalGasConfig.style.display = "none";
                modalGasConfig.close();
                onGasConfigOk = null;
            }
            if (modalReleasePassword && modalReleasePassword.style.display !== "none") {
                modalReleasePassword.style.display = "none";
                modalReleasePassword.close();
                inputById("pwdReleasePassword").value = "";
                onReleasePasswordOk = null;
            }
        }
    };
}
