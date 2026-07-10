const COIN_SEND_GAS = 21000;
const TOKEN_SEND_GAS = 84000;

let sendShowUnrecognizedTokens = false;

function getSendTxContext() {
    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");
    let selectedValue = ddlCoinTokenToSend ? ddlCoinTokenToSend.value : "Q";
    let toAddress = (document.getElementById("txtSendAddress").value || "").trim();
    let amount = (document.getElementById("txtSendQuantity").value || "").trim();
    let isCoin = (selectedValue === "Q");
    // The dropdown option value is the token contract address for recognized tokens;
    // "other" is the offline manual-entry case where the address is in txtTokenContractAddress.
    // (txtTokenContractAddress is not populated in online mode, so don't rely on it here.)
    let contractAddress = isCoin
        ? null
        : (selectedValue === "other" ? document.getElementById("txtTokenContractAddress").value : selectedValue);
    var ctx = {
        txKind: isCoin ? "sendCoin" : "sendToken",
        toAddress: toAddress || currentWalletAddress,
        amount: amount || "0",
        defaultGasLimit: isCoin ? COIN_SEND_GAS : TOKEN_SEND_GAS,
        bufferPercent: isCoin ? GAS_NO_BUFFER_PERCENT : GAS_ESTIMATE_BUFFER_PERCENT
    };
    if (!isCoin) {
        ctx.contractAddress = contractAddress;
        ctx.fromDecimals = getSwapTokenDecimals(contractAddress);
    }
    return ctx;
}

function onSendGasIconClick() {
    return onGasIconClick("spanSendGasFee", null, getSendTxContext);
}

function scheduleSendGasEstimation() {
    scheduleGasEstimation(getSendTxContext, "divSendGasIcon", "spanSendGasFee", null, function (errorDetail) {
        var base = (langJson && langJson.errors && langJson.errors.gasEstimateError)
            ? langJson.errors.gasEstimateError
            : "Could not fetch the gas fee from the network. Using the default estimate.";
        // errorDetail is the raw RPC return value / transport error; showTransientToast
        // renders via textContent so any HTML in it is sanitized (not parsed).
        var message = errorDetail ? (base + " (" + errorDetail + ")") : base;
        showTransientToast(message, 4000);
    });
}

function resetTokenList() {
    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");
    removeOptions(ddlCoinTokenToSend);
    var option = document.createElement("option");
    option.text = "Q";
    option.value = "Q";
    ddlCoinTokenToSend.add(option);
    if (offlineSignEnabled === true) {
        var optOther = document.createElement("option");
        optOther.text = "(token)";
        optOther.value = "other";
        ddlCoinTokenToSend.add(optOther);
    }
}

function addTokenOptionToSendDropdown(ddlCoinTokenToSend, token) {
    let tokenName = token.name;

    if (tokenName.length > maxTokenNameLength) {
        tokenName = tokenName.substring(0, maxTokenNameLength - 1) + "...";
    }
    tokenName = htmlEncode(tokenName);

    let tokenOption = document.createElement("option");
    tokenOption.text = tokenName;
    tokenOption.value = token.contractAddress;
    ddlCoinTokenToSend.add(tokenOption);
}

function getSendAssetSymbol(contractAddress, isCoin) {
    if (isCoin) return "Q";
    if (currentWalletTokenList != null) {
        for (let i = 0; i < currentWalletTokenList.length; i++) {
            if (currentWalletTokenList[i].contractAddress === contractAddress) {
                let sym = currentWalletTokenList[i].symbol;
                if (sym) return sym;
                return currentWalletTokenList[i].name || langJson.langValues.tokens;
            }
        }
    }
    return langJson.langValues.tokens;
}

function populateSendScreen() {
    resetTokenList();

    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");

    //Recognized tokens are always listed; unrecognized only when the toggle is on.
    //Stablecoin impersonators are already removed upstream so they never appear here.
    if (currentWalletRecognizedTokens != null) {
        for (var i = 0; i < currentWalletRecognizedTokens.length; i++) {
            addTokenOptionToSendDropdown(ddlCoinTokenToSend, currentWalletRecognizedTokens[i]);
        }
    }

    if (sendShowUnrecognizedTokens === true && currentWalletUnrecognizedTokens != null) {
        for (var j = 0; j < currentWalletUnrecognizedTokens.length; j++) {
            addTokenOptionToSendDropdown(ddlCoinTokenToSend, currentWalletUnrecognizedTokens[j]);
        }
    }

    //The toggle is only shown when there are unrecognized tokens to reveal.
    let toggleRow = document.getElementById("divSendShowUnrecognized");
    if (currentWalletUnrecognizedTokens != null && currentWalletUnrecognizedTokens.length > 0) {
        toggleRow.style.display = '';
    } else {
        toggleRow.style.display = 'none';
    }
}

function onToggleSendUnrecognized() {
    sendShowUnrecognizedTokens = document.getElementById("chkSendShowUnrecognized").checked === true;
    populateSendScreen();
    updateInfoSendScreen();
}

// Re-sync the send dropdown/toggle when the token list loads (or refreshes)
// while the send screen is already open, so the unrecognized-tokens checkbox
// appears as soon as the data arrives. The current selection is preserved.
function syncSendScreenTokenList() {
    let sendScreen = document.getElementById("SendScreen");
    if (sendScreen == null || sendScreen.style.display === "none") {
        return;
    }

    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");
    let previousValue = ddlCoinTokenToSend.value;
    let previousContractInput = document.getElementById("txtTokenContractAddress").value;

    populateSendScreen();

    for (let i = 0; i < ddlCoinTokenToSend.options.length; i++) {
        if (ddlCoinTokenToSend.options[i].value === previousValue) {
            ddlCoinTokenToSend.value = previousValue;
            break;
        }
    }

    updateInfoSendScreen();

    //Preserve a manually-typed token contract (offline "(token)" entry) that
    //updateInfoSendScreen clears when re-selecting the manual option.
    if (previousValue === "other") {
        document.getElementById("txtTokenContractAddress").value = previousContractInput;
    }
}

async function updateInfoSendScreen() {
    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");
    let selectedValue = ddlCoinTokenToSend.value;
    if (document.getElementById("SendScreen").style.display === "block") {
        resetCurrentGasConfig();
        setGasFeeLabel("spanSendGasFee", "");
    }
    document.getElementById("divCoinTokenToSend").textContent = "";
    document.getElementById("divCoinTokenToSend").style.display = "";
    document.getElementById("divBalanceSendScreen").textContent = "";
    document.getElementById("txtTokenContractAddress").style.display = "none";
    if(offlineSignEnabled == true) {
        document.getElementById("divSendScreenBalanceBox").style.display = "none";
    } else {
        document.getElementById("divSendScreenBalanceBox").style.display = "false";
    }

    if(selectedValue === "Q") {
        document.getElementById("divCoinTokenToSend").textContent = QuantumCoin;
        if(offlineSignEnabled === false) {
            if (currentAccountDetails !== null) {
                let newBalance = await weiToEtherFormatted(currentAccountDetails.balance);
                document.getElementById("divBalanceSendScreen").textContent = newBalance;
            }
        }
    } else {
        if(offlineSignEnabled === true) {
            let txtContract = document.getElementById("txtTokenContractAddress");
            document.getElementById("divCoinTokenToSend").style.display = "none";
            txtContract.style.display = "";
            if (selectedValue === "other") {
                //Manual entry: let the user type the contract address.
                txtContract.value = "";
                txtContract.readOnly = false;
            } else {
                //A real token was picked from the list; use its contract address.
                txtContract.value = selectedValue;
                txtContract.readOnly = true;
            }
        } else {
            for (let i = 0; i < currentWalletTokenList.length; i++) {
                if (currentWalletTokenList[i].contractAddress === selectedValue) {
                    document.getElementById("divBalanceSendScreen").textContent = currentWalletTokenList[i].tokenBalance;
                    document.getElementById("divCoinTokenToSend").textContent = selectedValue;
                    break;
                }
            }
        }
    }

    if (document.getElementById("SendScreen").style.display === "block") {
        scheduleSendGasEstimation();
    }
    return false;
}

async function showSendScreen() {
    offlineSignEnabled = await offlineTxnSigningGetDefaultValue();
    sendShowUnrecognizedTokens = false;
    document.getElementById("chkSendShowUnrecognized").checked = false;
    document.getElementById("txtTokenContractAddress").readOnly = false;
    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");
    ddlCoinTokenToSend.disabled = true;
    populateSendScreen();
    await updateInfoSendScreen();
    ddlCoinTokenToSend.disabled = false;

    if (offlineSignEnabled === true) {
        document.getElementById("btnOfflineSign").style.display  = "block";
        document.getElementById("divCurrentNonce").style.display  = "block";
        document.getElementById("btnSendCoins").style.display  = "none";
    } else {
        document.getElementById("btnOfflineSign").style.display  = "none";
        document.getElementById("divCurrentNonce").style.display  = "none";
        document.getElementById("btnSendCoins").style.display  = "block";
    }

    document.getElementById('divNetworkDropdown').style.display = 'none';
    document.getElementById('HomeScreen').style.display = 'none';
    document.getElementById('SendScreen').style.display = 'block';
    document.getElementById('OfflineSignScreen').style.display = 'none';
    document.getElementById('gradient').style.height = '116px';
    document.getElementById("txtSendAddress").value = "";
    document.getElementById("txtSendQuantity").value = "";
    document.getElementById("txtCurrentNonce").value = "";
    document.getElementById("pwdSend").value = "";
    document.getElementById("txtSendAddress").focus();

    resetCurrentGasConfig();
    attachSendGasListeners();
    setGasFeeLabel("spanSendGasFee", "");
    scheduleSendGasEstimation();

    return false;
}

function attachSendGasListeners() {
    var addr = document.getElementById("txtSendAddress");
    var qty = document.getElementById("txtSendQuantity");
    if (addr && !addr.dataset.gasBound) { addr.addEventListener("input", scheduleSendGasEstimation); addr.dataset.gasBound = "1"; }
    if (qty && !qty.dataset.gasBound) { qty.addEventListener("input", scheduleSendGasEstimation); qty.dataset.gasBound = "1"; }
}

async function signOfflineSend() {
    var sendAddress = document.getElementById("txtSendAddress").value;
    var sendQuantity = document.getElementById("txtSendQuantity").value;
    var currentNonce = document.getElementById("txtCurrentNonce").value;
    var sendPassword = document.getElementById("pwdSend").value;
    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");
    let selectedValue = ddlCoinTokenToSend.value;
    let CoinTokenToSendName = "";
    if(selectedValue === "Q") {
        CoinTokenToSendName = "coins";
    } else {
        let contractAddress = document.getElementById("txtTokenContractAddress").value;
        if (contractAddress == null || contractAddress.length < ADDRESS_LENGTH_CHECK || await isValidQcAddress(contractAddress) == false) {
            showWarnAlert(langJson.errors.quantumAddr);
            return false;
        }
        CoinTokenToSendName = "tokens";
    }

    if (sendAddress == null || sendAddress.length < ADDRESS_LENGTH_CHECK || await isValidQcAddress(sendAddress) == false) {
        showWarnAlert(langJson.errors.quantumAddr);
        return false;
    }

    if (sendQuantity == null || sendQuantity.length < 1) {
        showWarnAlert(langJson.errors.enterAmount);
        return false;
    }

    let okQuantity = await isValidEther(sendQuantity);
    if (isValidEther(okQuantity) == false) {
        showWarnAlert(langJson.errors.enterAmount);
        return false;
    }

    if (currentNonce == null || currentNonce.length < 1) {
        showWarnAlert(langJson.errors.enterCurrentNonce);
        return false;
    }

    let tempNonce = parseInt(currentNonce);
    if (Number.isInteger(tempNonce) == false || tempNonce < 0) {
        showWarnAlert(langJson.errors.enterCurrentNonce);
        return false;
    }

    if (sendPassword == null || sendPassword.length < 2) {
        showWarnAlert(langJson.errors.enterQuantumPassword);
        return false;
    }

    var isCoin = (selectedValue === "Q");
    var offlineContractAddress = isCoin ? null : document.getElementById("txtTokenContractAddress").value;
    var resolved = resolveGasForTx(isCoin ? COIN_SEND_GAS : TOKEN_SEND_GAS);
    var gasLimit = parseInt(resolved.gasLimit, 10);
    var gasFee = resolved.gasFee;

    var review = {
        asset: getSendAssetSymbol(offlineContractAddress, isCoin),
        contractAddress: offlineContractAddress,
        fromAddress: currentWalletAddress,
        toAddress: sendAddress,
        quantityLabelKey: "send-quantity",
        quantityValue: sendQuantity,
        gasLimit: String(gasLimit),
        gasFee: gasFee,
        nonce: String(tempNonce),
        networkText: txReviewNetworkText(),
        requirePassword: false,
        submitLabelKey: "ok",
        onSubmit: onSignOfflineSendCoinsConfirm
    };
    showTransactionReviewDialog(review);
}

async function onSignOfflineSendCoinsConfirm() {
    showLoadingAndExecuteAsync(langJson.langValues.waitWalletOpen, decryptAndUnlockWalletSignOffline);
}

async function decryptAndUnlockWalletSignOffline() {
    var password = document.getElementById("pwdSend").value;
    try {
        let quantumWallet = await walletGetByAddress(password, currentWalletAddress);
        if (quantumWallet == null) {
            hideWaitingBox();
            showWarnAlert(getGenericError());
            return;
        }
        signOfflineTxnSend(quantumWallet);
    }
    catch (error) {
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH) + " " + error)
        return;
    }
    return false;
}

async function signOfflineTxnSendToken(quantumWallet) {
    var sendAddress = document.getElementById("txtSendAddress").value;
    var sendQuantity = document.getElementById("txtSendQuantity").value;
    var currentNonce = document.getElementById("txtCurrentNonce").value;
    var contractAddress = document.getElementById("txtTokenContractAddress").value;

    try {
        var result = await offlineSignTokenTransaction({
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            toAddress: sendAddress,
            amount: sendQuantity,
            contractAddress: contractAddress,
            fromDecimals: getSwapTokenDecimals(contractAddress),
            nonce: parseInt(currentNonce),
            gasLimit: parseInt(resolveGasForTx(TOKEN_SEND_GAS).gasLimit, 10),
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        });

        if (!result || !result.success || !result.txData) {
            hideWaitingBox();
            showWarnAlert((result && result.error) ? String(result.error) : (langJson.errors.unexpectedError));
            return;
        }

        hideWaitingBox();
        document.getElementById('txtSignedSendTransaction').value = result.txData;
        document.getElementById('SendScreen').style.display = "none";
        document.getElementById('OfflineSignScreen').style.display = "block";
    }
    catch (error) {
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH) + " " + error)
    }
}

async function signOfflineTxnSend(quantumWallet) {
    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");
    let selectedValue = ddlCoinTokenToSend.value;
    if(selectedValue === "Q") {

    } else {
        await signOfflineTxnSendToken(quantumWallet);
        return;
    }
    var sendAddress = document.getElementById("txtSendAddress").value;
    var sendQuantity = document.getElementById("txtSendQuantity").value;
    var currentNonce = document.getElementById("txtCurrentNonce").value;

    try {
        var result = await offlineSignCoinTransaction({
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            toAddress: sendAddress,
            amount: sendQuantity,
            nonce: parseInt(currentNonce),
            gasLimit: parseInt(resolveGasForTx(COIN_SEND_GAS).gasLimit, 10),
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        });

        if (!result || !result.success || !result.txData) {
            hideWaitingBox();
            showWarnAlert((result && result.error) ? String(result.error) : (langJson.errors.unexpectedError));
            return;
        }

        hideWaitingBox();
        document.getElementById('txtSignedSendTransaction').value = result.txData;
        document.getElementById('SendScreen').style.display = "none";
        document.getElementById('OfflineSignScreen').style.display = "block";
    }
    catch (error) {
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH) + " " + error)
    }
}

async function copySignedSendTransaction() {
    await WriteTextToClipboard(document.getElementById('txtSignedSendTransaction').value);
}

async function openOfflineTxnSigningUrl() {
    await OpenUrl("https://QuantumCoin.org/offline-transaction-signing.html");
    return false;
}

async function sendCoins() {
    var sendAddress = document.getElementById("txtSendAddress").value;
    var sendQuantity = document.getElementById("txtSendQuantity").value;
    var sendPassword = document.getElementById("pwdSend").value;
    let ddlCoinTokenToSend = document.getElementById("ddlCoinTokenToSend");
    var CoinTokenToSendName = ddlCoinTokenToSend.options[ddlCoinTokenToSend.selectedIndex].text;
    var contractAddress = document.getElementById("divCoinTokenToSend").textContent;
    let quantityToSend = "";

    if (sendAddress == null || sendAddress.length < ADDRESS_LENGTH_CHECK || await isValidQcAddress(sendAddress) == false) {
        showWarnAlert(langJson.errors.quantumAddr);
        return false;
    }

    if (sendQuantity == null || sendQuantity.length < 1) {
        showWarnAlert(langJson.errors.enterAmount);
        return false;
    }

    let okQuantity = await isValidEther(sendQuantity);
    if (isValidEther(okQuantity) == false) {
        showWarnAlert(langJson.errors.enterAmount);
        return false;
    }

    if(contractAddress === QuantumCoin) {
        quantityToSend = currentBalance;
        CoinTokenToSendName = langJson.langValues.coins;
    } else {
        quantityToSend = getTokenBalance(contractAddress);
        CoinTokenToSendName = langJson.langValues.tokens;
    }

    if (quantityToSend == null || quantityToSend === "") {
        await refreshAccountBalance();
        if (contractAddress === QuantumCoin) {
            quantityToSend = currentBalance;
        } else {
            quantityToSend = getTokenBalance(contractAddress);
        }
    }

    if (quantityToSend == null || quantityToSend === "") {
        showWarnAlert(langJson.errors.amountLarge);
        return false;
    }

    let compareResult = await compareEther(sendQuantity, quantityToSend);
    if (compareResult == 1) {
        showWarnAlert(langJson.errors.amountLarge);
        return false;
    }

    if (sendPassword == null || sendPassword.length < 2) {
        showWarnAlert(langJson.errors.enterQuantumPassword);
        return false;
    }

    var isCoin = (contractAddress === QuantumCoin);
    var resolved = resolveGasForTx(isCoin ? COIN_SEND_GAS : TOKEN_SEND_GAS);
    var gasLimit = parseInt(resolved.gasLimit, 10);
    var gasFee = resolved.gasFee;

    var review = {
        asset: getSendAssetSymbol(contractAddress, isCoin),
        contractAddress: isCoin ? null : contractAddress,
        fromAddress: currentWalletAddress,
        toAddress: sendAddress,
        quantityLabelKey: "send-quantity",
        quantityValue: sendQuantity,
        gasLimit: String(gasLimit),
        gasFee: gasFee,
        nonce: null,
        networkText: txReviewNetworkText(),
        requirePassword: false,
        submitLabelKey: "ok",
        onSubmit: onSendCoinsConfirm
    };
    showTransactionReviewDialog(review);
}

async function onSendCoinsConfirm() {
    showLoadingAndExecuteAsync(langJson.langValues.waitWalletOpen, decryptAndUnlockWalletSend);
}

async function decryptAndUnlockWalletSend() {
    var password = document.getElementById("pwdSend").value;
    try {
        let quantumWallet = await walletGetByAddress(password, currentWalletAddress);
        if (quantumWallet == null) {
            hideWaitingBox();
            showWarnAlert(getGenericError());
            return;
        }
        sendCoinsSubmit(quantumWallet);
    }
    catch (error) {
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH) + " " + error)
        return;
    }
    return false;
}

async function sendCoinsSubmit(quantumWallet) {
    let coinTokenToSend = document.getElementById("divCoinTokenToSend").textContent;
    if(coinTokenToSend !== QuantumCoin) {
        await sendTokensSubmit(quantumWallet);
        return;
    }

    updateWaitingBox(langJson.langValues.pleaseWaitSubmit);
    var sendAddress = document.getElementById("txtSendAddress").value;
    var sendQuantity = document.getElementById("txtSendQuantity").value;
    var resolved = resolveGasForTx(COIN_SEND_GAS);
    var gasLimit = parseInt(resolved.gasLimit, 10);

    try {
        let currentDate = new Date();
        var result = await submitSendCoins({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            toAddress: sendAddress,
            amount: sendQuantity,
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            gasLimit: gasLimit,
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        });

        if (!result || !result.success || !result.txHash) {
            hideWaitingBox();
            showWarnAlert((result && result.error) ? String(result.error) : (langJson.errors.invalidApiResponse));
            return;
        }

        let pendingTxn = new TransactionDetails(result.txHash, currentDate, quantumWallet.address, sendAddress, sendQuantity, true);
        pendingTransactionsMap.set(quantumWallet.address.toLowerCase() + currentBlockchainNetwork.index.toString(), pendingTxn);

        setTimeout(() => {
            hideWaitingBox();
            showSendCompletedDialog(result.txHash, showWalletScreen);
        }, 1000);
    }
    catch (error) {
        hideWaitingBox();

        if (isNetworkError(error)) {
            showWarnAlert(langJson.errors.internetDisconnected);
        } else {
            showWarnAlert(langJson.errors.invalidApiResponse + ' ' + error);
        }
    }
}

async function sendTokensSubmit(quantumWallet) {
    updateWaitingBox(langJson.langValues.pleaseWaitSubmit);

    try {
        var sendAddress = document.getElementById("txtSendAddress").value;
        var sendQuantity = document.getElementById("txtSendQuantity").value;
        var contractAddress = document.getElementById("divCoinTokenToSend").textContent;
        var resolvedTok = resolveGasForTx(TOKEN_SEND_GAS);
        var gasLimitTok = parseInt(resolvedTok.gasLimit, 10);

        let currentDate = new Date();
        var result = await submitSendTokens({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            toAddress: sendAddress,
            amount: sendQuantity,
            contractAddress: contractAddress,
            fromDecimals: getSwapTokenDecimals(contractAddress),
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            gasLimit: gasLimitTok,
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        });

        if (!result || !result.success || !result.txHash) {
            hideWaitingBox();
            showWarnAlert((result && result.error) ? String(result.error) : (langJson.errors.invalidApiResponse));
            return;
        }

        let pendingTxn = new TransactionDetails(result.txHash, currentDate, quantumWallet.address, contractAddress, "0", true);
        pendingTransactionsMap.set(quantumWallet.address.toLowerCase() + currentBlockchainNetwork.index.toString(), pendingTxn);

        setTimeout(() => {
            hideWaitingBox();
            showSendCompletedDialog(result.txHash, showWalletScreen);
        }, 1000);
    }
    catch (error) {
        hideWaitingBox();

        if (isNetworkError(error)) {
            showWarnAlert(langJson.errors.internetDisconnected);
        } else {
            showWarnAlert(langJson.errors.invalidApiResponse + ' ' + error);
        }
    }
}

var sendCompletedPollingId = null;
var sendCompletedStatusRotateId = null;
var sendCompletedStatusStartTime = 0;
var sendCompletedOnClose = null;
var sendCompletedLastTxHash = null;
var SEND_STATUS_MESSAGES = ["send-status-checking", "send-status-waiting", "send-status-checking-short"];
var SEND_STATUS_ROTATE_MS = 3600;

function showSendCompletedDialog(txHash, onClose) {
    sendCompletedLastTxHash = txHash;
    sendCompletedOnClose = (typeof onClose === "function") ? onClose : null;

    document.getElementById("pSendCompletedMessage").textContent =
        (langJson && langJson.langValues && langJson.langValues["send-transaction-send-message-description"]) || "Your transaction has been submitted. It can take upto a minute to process the transaction. You may close this dialog now.";
    document.getElementById("pSendCompletedTxHash").textContent = txHash || "";
    var copyEl = document.getElementById("divSendCompletedCopy");
    var explEl = document.getElementById("divSendCompletedExplorer");
    if (copyEl) copyEl.title = (langJson && langJson.langValues && langJson.langValues["copy"]) || "Copy";
    if (explEl) explEl.title = (langJson && langJson.langValues && langJson.langValues["block-explorer"]) || "Block Explorer";

    setSendCompletedPending();

    var dlg = document.getElementById("modalSendCompleted");
    dlg.style.display = "block";
    dlg.showModal();

    sendCompletedStatusStartTime = Date.now();
    updateSendCompletedStatusText();
    if (sendCompletedStatusRotateId) clearInterval(sendCompletedStatusRotateId);
    sendCompletedStatusRotateId = setInterval(updateSendCompletedStatusText, SEND_STATUS_ROTATE_MS);
    if (sendCompletedPollingId) clearInterval(sendCompletedPollingId);
    sendCompletedPollingId = setInterval(pollSendCompletedStatus, 9000);
    pollSendCompletedStatus();
}

function setSendCompletedPending() {
    document.getElementById("imgSendCompletedStatus").src = "assets/icons/loading.gif";
    document.getElementById("imgSendCompletedStatus").alt = "Loading";
    updateSendCompletedStatusText();
}

function setSendCompletedSucceeded() {
    document.getElementById("imgSendCompletedStatus").src = "assets/svg/checkmark-circle-outline.svg";
    document.getElementById("imgSendCompletedStatus").alt = "Success";
    document.getElementById("spanSendCompletedStatus").textContent =
        (langJson && langJson.langValues && langJson.langValues["send-transaction-succeeded"]) || "Transaction completed successfully.";
}

function setSendCompletedFailed(errorText) {
    document.getElementById("imgSendCompletedStatus").src = "assets/svg/alert-outline.svg";
    document.getElementById("imgSendCompletedStatus").alt = "Failed";
    var base = (langJson && langJson.langValues && langJson.langValues["send-transaction-failed"]) || "Transaction failed.";
    document.getElementById("spanSendCompletedStatus").textContent = errorText ? (base + " " + errorText) : base;
}

function updateSendCompletedStatusText() {
    if (document.getElementById("imgSendCompletedStatus").alt !== "Loading") return;
    var idx = Math.floor((Date.now() - sendCompletedStatusStartTime) / SEND_STATUS_ROTATE_MS) % SEND_STATUS_MESSAGES.length;
    var key = SEND_STATUS_MESSAGES[idx];
    var text = (langJson && langJson.langValues && langJson.langValues[key]) || key;
    document.getElementById("spanSendCompletedStatus").textContent = text;
}

async function pollSendCompletedStatus() {
    if (!sendCompletedLastTxHash || !currentBlockchainNetwork) return;
    try {
        var res = await getTransactionStatusByHash(currentBlockchainNetwork.scanApiDomain, currentWalletAddress, sendCompletedLastTxHash);
        if (res.status === "succeeded") {
            stopSendCompletedTimers();
            setSendCompletedSucceeded();
            await refreshAccountBalance();
        } else if (res.status === "failed") {
            stopSendCompletedTimers();
            setSendCompletedFailed(res.error || "");
        }
    } catch (e) { /* keep polling */ }
}

function stopSendCompletedTimers() {
    if (sendCompletedPollingId) { clearInterval(sendCompletedPollingId); sendCompletedPollingId = null; }
    if (sendCompletedStatusRotateId) { clearInterval(sendCompletedStatusRotateId); sendCompletedStatusRotateId = null; }
}

function closeSendCompletedDialog() {
    stopSendCompletedTimers();
    sendCompletedLastTxHash = null;
    var dlg = document.getElementById("modalSendCompleted");
    dlg.style.display = "none";
    dlg.close();
    var cb = sendCompletedOnClose;
    sendCompletedOnClose = null;
    if (cb) cb();
}

async function copySendCompletedTxHash() {
    if (sendCompletedLastTxHash) await WriteTextToClipboard(sendCompletedLastTxHash);
}

async function openSendCompletedInExplorer() {
    if (sendCompletedLastTxHash) await OpenScanTxn(sendCompletedLastTxHash);
}

document.getElementById("btnSendCompletedOk").onclick = function () { closeSendCompletedDialog(); };
document.getElementById("divSendCompletedCopy").onclick = function () { var el = this; copySendCompletedTxHash().then(function () { el.blur(); }); };
document.getElementById("divSendCompletedExplorer").onclick = function () { var el = this; openSendCompletedInExplorer().then(function () { el.blur(); }); };