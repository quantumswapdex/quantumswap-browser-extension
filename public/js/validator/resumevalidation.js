const RESUME_VALIDATION_GAS = 100000;

async function resumeValidation() {
    offlineSignEnabled = await offlineTxnSigningGetDefaultValue();
    let nonceValue = null;
    if (offlineSignEnabled === true) {
        let currentNonce = document.getElementById("txtCurrentNonceValidator").value;
        if (currentNonce == null || currentNonce.length < 1) {
            showWarnAlert(langJson.errors.enterCurrentNonce);
            return false;
        }

        let tempNonce = parseInt(currentNonce);
        if (Number.isInteger(tempNonce) == false || tempNonce < 0) {
            showWarnAlert(langJson.errors.enterCurrentNonce);
            return false;
        }
        nonceValue = String(tempNonce);
    }

    var password = document.getElementById("pwdValidator").value;
    if (password == null || password.length < 2) {
        showWarnAlert(langJson.errors.enterQuantumPassword);
        return false;
    }

    var resolved = resolveGasForTx(RESUME_VALIDATION_GAS);
    var review = {
        asset: langJson.langValues["validator-resume-validation"],
        toAddress: STAKING_CONTRACT_ADDRESS,
        quantityLabelKey: "send-quantity",
        quantityValue: "-",
        gasLimit: resolved.gasLimit,
        gasFee: resolved.gasFee,
        nonce: nonceValue
    };
    showValidatorTransactionReview(review, onResumeValidation);
}

async function onResumeValidation() {
    showLoadingAndExecuteAsync(langJson.langValues.waitWalletOpen, decryptAndUnlockWalletResumeValidation);
}

async function decryptAndUnlockWalletResumeValidation() {
    var password = document.getElementById("pwdValidator").value;
    try {
        let quantumWallet = await walletGetByAddress(password, currentWalletAddress);
        if (quantumWallet == null) {
            hideWaitingBox();
            showWarnAlert(getGenericError());
            return;
        }
        resumeValidationSubmit(quantumWallet);
    }
    catch (error) {
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH) + " " + error)
        return;
    }
    return false;
}

async function resumeValidationSubmit(quantumWallet) {
    offlineSignEnabled = await offlineTxnSigningGetDefaultValue();
    if (offlineSignEnabled === true) {
        await resumeValidationOfflineSign(quantumWallet);
        return;
    }

    updateWaitingBox(langJson.langValues.pleaseWaitSubmit);

    try {
        var result = await submitStakingContract({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            method: "resumeValidation",
            methodArgs: [],
            value: "0",
            gasLimit: parseInt(resolveGasForTx(RESUME_VALIDATION_GAS).gasLimit, 10),
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        });

        if (result && result.success && result.txHash) {
            let currentDate = new Date();
            let pendingTxn = new TransactionDetails(result.txHash, currentDate, quantumWallet.address, STAKING_CONTRACT_ADDRESS, "0", true);
            pendingTransactionsMap.set(quantumWallet.address.toLowerCase() + currentBlockchainNetwork.index.toString(), pendingTxn);

            setTimeout(() => {
                hideWaitingBox();
                showSendCompletedDialog(result.txHash, showWalletScreen);
            }, 1000);
        } else {
            hideWaitingBox();
            showWarnAlert((result && result.error) ? result.error : langJson.errors.invalidApiResponse);
        }
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

async function resumeValidationOfflineSign(quantumWallet) {
    updateWaitingBox(langJson.langValues.pleaseWaitSubmit);
    let currentNonce = document.getElementById("txtCurrentNonceValidator").value;

    try {
        var result = await offlineSignStakingContract({
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            method: "resumeValidation",
            methodArgs: [],
            value: "0",
            gasLimit: parseInt(resolveGasForTx(RESUME_VALIDATION_GAS).gasLimit, 10),
            nonce: parseInt(currentNonce),
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        });

        if (result && result.success && result.txData) {
            hideWaitingBox();
            await showOfflineSignatureDialog(result.txData);
        } else {
            hideWaitingBox();
            showWarnAlert((result && result.error) ? result.error : langJson.errors.unexpectedError);
        }
    }
    catch (error) {
        hideWaitingBox();
        showWarnAlert(langJson.errors.genericError + ' ' + error);
    }
}