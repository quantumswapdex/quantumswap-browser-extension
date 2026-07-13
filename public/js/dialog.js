var modalOkDialog = document.getElementById("modalOkDialog");
var divSuccess = document.getElementById("divSuccess");
var divWarn = document.getElementById("divWarn");
var pDetails = document.getElementById("pDetails");
var span = document.getElementsByClassName("close")[0];
var onCloseFunc = null;

var modalConfirm = document.getElementById("modalConfirmDialog");
var pDetailsConfirm = document.getElementById("pDetailsConfirm");
var txtConfirm = document.getElementById("txtConfirm");
var spanConfirm = document.getElementsByClassName("proceed")[0];
var spanCancel = document.getElementsByClassName("cancel")[0];

var onConfirmFunc = null;

// Yes/No confirmation
var modalYesNoDialog = document.getElementById("modalYesNoDialog");
var pDetailsYesNo = document.getElementById("pDetailsYesNo");
var btnYesNoYes = document.getElementById("btnYesNoYes");
var btnYesNoNo = document.getElementById("btnYesNoNo");
var onYesNoConfirmFunc = null;

function showYesNoConfirm(txt, onConfirm) {
    pDetailsYesNo.innerText = htmlEncode(txt);
    onYesNoConfirmFunc = onConfirm;
    modalYesNoDialog.style.display = "block";
    modalYesNoDialog.showModal();
}

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

//Gas configuration
var modalGasConfig = document.getElementById("modalGasConfig");
var btnGasConfigOk = document.getElementById("btnGasConfigOk");
var btnGasConfigCancel = document.getElementById("btnGasConfigCancel");
var onGasConfigOk = null;

// Restrict the gas-fee field to numbers and a single decimal point (no other characters).
function sanitizeGasFeeInput(el) {
    if (!el || el.dataset.gasSanitized) return;
    el.dataset.gasSanitized = "1";
    el.addEventListener("input", function () {
        var v = el.value;
        var cleaned = v.replace(/[^0-9.]/g, "");
        var parts = cleaned.split(".");
        if (parts.length > 2) cleaned = parts[0] + "." + parts.slice(1).join("");
        if (cleaned !== v) el.value = cleaned;
    });
}

// Price per gas unit (coins) derived from the estimate the dialog was opened with.
// Used to recompute the fee field live when the user edits the gas limit.
var gasConfigFeeRate = null;

// Bind a one-time input listener on the gas-limit field that recomputes the fee
// field as (gasLimit * gasConfigFeeRate). Generic: applies to every screen that
// opens this dialog (send, swap), since they all share these inputs.
function bindGasLimitRecompute(limitEl, feeEl) {
    if (!limitEl || !feeEl || limitEl.dataset.gasRecomputeBound) return;
    limitEl.dataset.gasRecomputeBound = "1";
    limitEl.addEventListener("input", function () {
        if (gasConfigFeeRate == null) return;
        var lim = parseFloat(limitEl.value);
        if (isNaN(lim) || lim < 0) return;
        var fee = lim * gasConfigFeeRate;
        feeEl.value = (typeof formatGasFeeNumber === "function") ? formatGasFeeNumber(fee) : String(fee);
    });
}

function showGasConfigDialog(opts) {
    opts = opts || {};
    var limitEl = document.getElementById("txtGasLimit");
    var feeEl = document.getElementById("txtGasFee");
    if (limitEl) limitEl.value = (opts.gasLimit != null ? String(opts.gasLimit) : "");
    if (feeEl) feeEl.value = (opts.gasFee != null ? String(opts.gasFee) : "");
    sanitizeGasFeeInput(feeEl);
    // Derive the coins-per-gas-unit rate from the opened estimate so editing the
    // gas limit updates the fee. Null when there is no usable estimate yet.
    var limitNum = parseFloat(opts.gasLimit);
    var feeNum = parseFloat(opts.gasFee);
    gasConfigFeeRate = (!isNaN(limitNum) && limitNum > 0 && !isNaN(feeNum)) ? (feeNum / limitNum) : null;
    bindGasLimitRecompute(limitEl, feeEl);
    onGasConfigOk = (typeof opts.onOk === "function") ? opts.onOk : null;
    modalGasConfig.style.display = "block";
    modalGasConfig.showModal();
    setTimeout(function () { if (limitEl) limitEl.focus(); }, 80);
    return false;
}

btnGasConfigOk.onclick = function () {
    var limitEl = document.getElementById("txtGasLimit");
    var feeEl = document.getElementById("txtGasFee");
    var gasLimit = parseInt((limitEl && limitEl.value) || "", 10);
    var gasFee = (feeEl && feeEl.value != null) ? String(feeEl.value).trim() : "";
    var feeNum = parseFloat(gasFee);
    if (isNaN(gasLimit) || gasLimit <= 0 || isNaN(feeNum) || feeNum < 0) {
        showWarnAlert((langJson && langJson.errors && langJson.errors.invalidValue) ? langJson.errors.invalidValue : "Invalid value");
        return;
    }
    modalGasConfig.style.display = "none";
    modalGasConfig.close();
    var cb = onGasConfigOk;
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

// Transient tooltip-like toast shown above the active screen (e.g. send screen)
// when an RPC call fails. Auto-hides after `durationMs` (default 4000ms).
// The message is rendered via textContent, which never parses HTML, so any
// markup contained in an RPC return value / transport error is neutralized.
var gasToastTimerId = null;
function showTransientToast(message, durationMs) {
    var el = document.getElementById("divGasToast");
    if (!el) return;
    var text = (message == null) ? "" : String(message);
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
var modalNetwork = document.getElementById("modalNetworkDialog");
var spanNetwork = document.getElementsByClassName("oknetwork")[0];
var spanCancelNetwork = document.getElementById("divCancelNetwork");
var onCloseFuncNetwork = null;

var modalAdvancedSigning = document.getElementById("modalAdvancedSigning");
var btnOkAdvancedSigning = document.getElementById("btnOkAdvancedSigning");
var btnCancelAdvancedSigning = document.getElementById("btnCancelAdvancedSigning");
var onCloseFuncAdvancedSigning = null;

function showAlert(txt) {
    modalOkDialog.style.display = "block";
    modalOkDialog.showModal();
    divSuccess.style.display = "block";
    divWarn.style.display = "none";
    pDetails.innerText = htmlEncode(txt);
}

function showWarnAlert(txt) {
    modalOkDialog.style.display = "block";
    modalOkDialog.showModal();
    divSuccess.style.display = "none";
    divWarn.style.display = "block";
    if (txt == null) {
        pDetails.innerText = "";
    } else {
        pDetails.innerText = htmlEncode(txt.toString());
    }
}

function showAlertAndExecuteOnClose(txt, f) {
    modalOkDialog.style.display = "block";
    modalOkDialog.showModal();
    divSuccess.style.display = "block";
    divWarn.style.display = "none";
    pDetails.innerText = htmlEncode(txt);
    onCloseFunc = f;
}

function showWarnAlertAndExecuteOnClose(txt, f) {
    modalOkDialog.style.display = "block";
    modalOkDialog.showModal();
    divSuccess.style.display = "none";
    divWarn.style.display = "block";
    pDetails.innerText = htmlEncode(txt);
    onCloseFunc = f;
}

async function showNetworkDialog(f) {
    await showBlockchainNetworks();
    modalNetwork.style.display = "block";
    modalNetwork.showModal();
    onCloseFuncNetwork = f;
    return false;
}

span.onclick = function () {
    modalOkDialog.style.display = "none";
    modalOkDialog.close();
    if (onCloseFunc == null) {

    } else {
        onCloseFunc();
        onCloseFunc = null;
    }
}


spanConfirm.onclick = function () {
    if (!txtConfirm.value || txtConfirm.value != "i agree") {
        txtConfirm.value = "";
        return;
    }
    modalConfirm.style.display = "none";
    modalConfirm.close();
    document.getElementById("txtConfirm").value = "";
    if (onConfirmFunc == null) {

    } else {
        onConfirmFunc();
        onConfirmFunc = null;
    }
}

spanCancel.onclick = function () {
    modalConfirm.style.display = "none";
    modalConfirm.close();
    onConfirmFunc = null;
}

function showConfirmAndExecuteOnConfirm(txt, f) {
    document.getElementById("txtConfirm").value = "";
    modalConfirm.style.display = "block";
    modalConfirm.showModal();
    pDetailsConfirm.innerText = txt;
    onConfirmFunc = f;
    document.getElementById("txtConfirm").focus();
}

spanNetwork.onclick = function () {
    modalNetwork.style.display = "none";
    modalNetwork.close();
    var network = document.querySelector('input[name="network_option"]:checked')?.value;
    if (!network || network === "") {

    } else {
        saveSelectedBlockchainNetwork();
    }

    if (onCloseFuncNetwork == null) {

    } else {
        onCloseFuncNetwork();
        onCloseFuncNetwork = null;
    }
}

spanCancelNetwork.onclick = function () {
    modalNetwork.style.display = "none";
    modalNetwork.close();
    onCloseFuncNetwork = null;
}

async function showAdvancedSigningSettingDialog(f) {
    var defaultVal = await advancedSigningGetDefaultValue();
    if (defaultVal == false) {
        document.getElementById('optAdvancedSigningDisabled').checked = true;
    } else {
        document.getElementById('optAdvancedSigningEnabled').checked = true;
    }
    modalAdvancedSigning.style.display = "block";
    modalAdvancedSigning.showModal();
    onCloseFuncAdvancedSigning = f;
    return false;
}

btnOkAdvancedSigning.onclick = function () {
    modalAdvancedSigning.style.display = "none";
    modalAdvancedSigning.close();
    var advancedSigningValue = document.querySelector('input[name="optAdvancedSigning"]:checked')?.value;
    if (!advancedSigningValue || advancedSigningValue === "") {

    } else {
        saveSelectedAdvancedSigningSetting();
    }

    if (onCloseFuncAdvancedSigning == null) {

    } else {
        onCloseFuncAdvancedSigning();
        onCloseFuncAdvancedSigning = null;
    }
}

btnCancelAdvancedSigning.onclick = function () {
    modalAdvancedSigning.style.display = "none";
    modalAdvancedSigning.close();
    onCloseFuncAdvancedSigning = null;
}


var modalSwapApprovalSubmit = document.getElementById("modalSwapApprovalSubmit");

var modalTransactionReview = document.getElementById("modalTransactionReview");
var btnTxReviewSubmit = document.getElementById("btnTxReviewSubmit");
var btnTxReviewCancel = document.getElementById("btnTxReviewCancel");
var txReviewOnSubmit = null;
var txReviewRequirePassword = false;

var modalSendCompleted = document.getElementById("modalSendCompleted");

window.onclick = function (event) {
    if (event.target == modalOkDialog || event.target == modalConfirm || event.target == modalYesNoDialog || event.target == modalNetwork || event.target == modalAdvancedSigning || event.target == modalSwapApprovalSubmit || event.target == modalTransactionReview || event.target == modalSendCompleted || event.target == modalGasConfig) {
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
            modalTransactionReview.style.display = "none";
            modalTransactionReview.close();
            txReviewOnSubmit = null;
        }
        if (modalSendCompleted && modalSendCompleted.style.display !== "none") {
            closeSendCompletedDialog();
        }
        if (modalGasConfig && modalGasConfig.style.display !== "none") {
            modalGasConfig.style.display = "none";
            modalGasConfig.close();
            onGasConfigOk = null;
        }
    }
}

function showErrorAndLockup(err) {
    // In the dApp approval popup (index.html?view=approval) the normal wallet
    // boot never runs, so langJson and the lockup screens are uninitialized.
    // Route errors to the approval status line instead of the (throwing) lockup.
    if (typeof window !== "undefined" && window.__qcApprovalView) {
        var s = document.getElementById("dappStatus");
        if (s) s.textContent = (err && err.message) ? err.message : String(err);
        return;
    }

    modalOkDialog.style.display = "block";
    divSuccess.style.display = "none";
    divWarn.style.display = "block";
    modalOkDialog.showModal();

    document.getElementById('login-content').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('settings-content').style.display = 'none';
    document.getElementById('wallets-content').style.display = 'none';
    document.getElementById('divNetworkDropdown').style.display = 'none';

    let msg = getGenericError(err);
    pDetails.innerText = htmlEncode(msg);
}

function showLoadingAndExecuteAsync(txt, f) {
    document.getElementById("modalWaitDialog").style.display = "block";
    document.getElementById("modalWaitDialog").showModal();
    pWaitDetails.innerText = txt;
    setTimeout(() => {
        f();
    }, 60);
}

function hideWaitingBox() {
    document.getElementById("modalWaitDialog").style.display = "none";
    document.getElementById("modalWaitDialog").close();
}

function updateWaitingBox(txt) {
    pWaitDetails.innerText = txt;
}

let modalEulaDialog = document.getElementById("modalEulaDialog");
function showEula() {
    modalEulaDialog.style.display = "block";
    modalEulaDialog.showModal();
    document.getElementById("divEula").innerHTML = langJson.langValues.eula;
}

var spanIAgree = document.getElementById("divIAgree");

spanIAgree.onclick = async function () {
    modalEulaDialog.style.display = "none";
    modalEulaDialog.close();
    await storeEulaAccepted();
    await resumePostEula();
}

function closeTransactionReviewDialog() {
    if (modalTransactionReview) {
        modalTransactionReview.style.display = "none";
        modalTransactionReview.close();
    }
    txReviewOnSubmit = null;
}

function txReviewNetworkText() {
    if (typeof currentBlockchainNetwork === "undefined" || currentBlockchainNetwork == null) {
        return "";
    }
    var name = currentBlockchainNetwork.blockchainName || "";
    var chainId = currentBlockchainNetwork.networkId;
    var chainSuffix = (langJson && langJson.langValues["chain-id-suffix"]) ? langJson.langValues["chain-id-suffix"] : "chain";
    if (name === "") {
        return "(" + chainSuffix + " " + chainId + ")";
    }
    return name + " (" + chainSuffix + " " + chainId + ")";
}

function showTransactionReviewDialog(review) {
    document.getElementById("spanTxReviewAsset").textContent = review.asset || "";
    document.getElementById("spanTxReviewFrom").textContent = review.fromAddress || "";
    document.getElementById("spanTxReviewTo").textContent = review.toAddress || "";
    document.getElementById("spanTxReviewQuantity").textContent = review.quantityValue || "";
    document.getElementById("spanTxReviewGasLimit").textContent = review.gasLimit || "";
    document.getElementById("spanTxReviewGasFee").textContent = review.gasFee || "";
    document.getElementById("spanTxReviewNetwork").textContent = review.networkText || "";

    var lblAsset = document.getElementById("lblTxReviewAsset");
    if (lblAsset) {
        var assetKey = review.assetLabelKey || "what-is-being-sent";
        if (langJson && langJson.langValues[assetKey]) {
            lblAsset.textContent = langJson.langValues[assetKey];
        }
    }

    var lblQty = document.getElementById("lblTxReviewQuantity");
    if (lblQty && review.quantityLabelKey && langJson && langJson.langValues[review.quantityLabelKey]) {
        lblQty.textContent = langJson.langValues[review.quantityLabelKey];
    }

    var contractRow = document.getElementById("rowTxReviewContract");
    if (review.contractAddress) {
        document.getElementById("spanTxReviewContract").textContent = review.contractAddress;
        contractRow.style.display = "block";
    } else {
        document.getElementById("spanTxReviewContract").textContent = "";
        contractRow.style.display = "none";
    }

    var nonceRow = document.getElementById("rowTxReviewNonce");
    if (review.nonce != null && review.nonce !== "") {
        document.getElementById("spanTxReviewNonce").textContent = review.nonce;
        nonceRow.style.display = "block";
    } else {
        document.getElementById("spanTxReviewNonce").textContent = "";
        nonceRow.style.display = "none";
    }

    var pwdRow = document.getElementById("rowTxReviewPassword");
    txReviewRequirePassword = review.requirePassword === true;
    if (txReviewRequirePassword) {
        pwdRow.style.display = "flex";
    } else {
        pwdRow.style.display = "none";
    }

    var submitBtn = document.getElementById("btnTxReviewSubmit");
    if (submitBtn && review.submitLabelKey && langJson && langJson.langValues[review.submitLabelKey]) {
        submitBtn.textContent = langJson.langValues[review.submitLabelKey];
    }

    document.getElementById("txtTxReviewIAgree").value = "";
    var pwdInput = document.getElementById("txtTxReviewPassword");
    if (pwdInput) { pwdInput.value = ""; }

    txReviewOnSubmit = review.onSubmit || null;
    modalTransactionReview.style.display = "block";
    modalTransactionReview.showModal();
    setTimeout(function () {
        var el = document.getElementById("txtTxReviewIAgree");
        if (el) { el.focus(); }
    }, 100);
    return false;
}

btnTxReviewSubmit.onclick = function () {
    var iagree = (document.getElementById("txtTxReviewIAgree").value || "").trim().toLowerCase();
    var required = (langJson && langJson.langValues["i-agree-literal"]) ? langJson.langValues["i-agree-literal"].toLowerCase() : "i agree";
    if (iagree !== required) {
        showWarnAlert(langJson.langValues["must-agree-to-submit"]);
        return;
    }
    if (txReviewRequirePassword) {
        var password = (document.getElementById("txtTxReviewPassword").value || "").trim();
        if (!password) {
            showWarnAlert(langJson.errors.enterWalletPassord);
            return;
        }
    }
    var cb = txReviewOnSubmit;
    modalTransactionReview.style.display = "none";
    modalTransactionReview.close();
    txReviewOnSubmit = null;
    if (cb != null) {
        cb();
    }
}

btnTxReviewCancel.onclick = function () {
    modalTransactionReview.style.display = "none";
    modalTransactionReview.close();
    txReviewOnSubmit = null;
}