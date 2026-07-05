const STAKING_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000001000";

function getValidatorDefaultGas(selectedValue) {
    if (selectedValue === "newdeposit") return NEW_DEPOSIT_GAS;
    if (selectedValue === "increasedeposit") return INCREASE_DEPOSIT_GAS;
    if (selectedValue === "initiatepartialwithdrawal") return INITIATE_PARTIAL_WITHDRAWAL_GAS;
    if (selectedValue === "completepartialwithdrawal") return COMPLETE_PARTIAL_WITHDRAWAL_GAS;
    if (selectedValue === "pausevalidation") return PAUSE_VALIDATION_GAS;
    if (selectedValue === "resumevalidation") return RESUME_VALIDATION_GAS;
    return null;
}

function getValidatorMethodName(selectedValue) {
    if (selectedValue === "newdeposit") return "newDeposit";
    if (selectedValue === "increasedeposit") return "increaseDeposit";
    if (selectedValue === "initiatepartialwithdrawal") return "initiatePartialWithdrawal";
    if (selectedValue === "completepartialwithdrawal") return "completePartialWithdrawal";
    if (selectedValue === "pausevalidation") return "pauseValidation";
    if (selectedValue === "resumevalidation") return "resumeValidation";
    return null;
}

function getValidatorTxContext() {
    let ddl = document.getElementById("ddlValidatorOptions");
    let selectedValue = ddl ? ddl.value : "none";
    if (selectedValue === "none") return null;
    let validatorAddress = (document.getElementById("txtValidatorAddress").value || "").trim();
    let depositCoins = (document.getElementById("txtValidatorDepositCoins").value || "").trim();
    let defaultGasLimit = getValidatorDefaultGas(selectedValue);
    let methodName = getValidatorMethodName(selectedValue);
    if (defaultGasLimit == null || methodName == null) return null;
    let ctx = { txKind: methodName, defaultGasLimit: defaultGasLimit, methodArgs: [] };
    if (selectedValue === "newdeposit") {
        if (!validatorAddress || !depositCoins) return null;
        ctx.methodArgs = [validatorAddress];
        ctx.value = depositCoins;
    } else if (selectedValue === "increasedeposit") {
        if (!depositCoins) return null;
        ctx.value = depositCoins;
    } else if (selectedValue === "initiatepartialwithdrawal") {
        if (!depositCoins) return null;
        ctx.methodArgs = [depositCoins];
    }
    return ctx;
}

function onValidatorGasIconClick() {
    return onGasIconClick("spanValidatorGasFee", null, getValidatorTxContext);
}

function scheduleValidatorGasEstimation() {
    scheduleGasEstimation(getValidatorTxContext, "divValidatorGasIcon", "spanValidatorGasFee");
}

function attachValidatorGasListeners() {
    var addr = document.getElementById("txtValidatorAddress");
    var qty = document.getElementById("txtValidatorDepositCoins");
    if (addr && !addr.dataset.gasBound) { addr.addEventListener("input", scheduleValidatorGasEstimation); addr.dataset.gasBound = "1"; }
    if (qty && !qty.dataset.gasBound) { qty.addEventListener("input", scheduleValidatorGasEstimation); qty.dataset.gasBound = "1"; }
}

function openValidatorPage() {
    OpenUrl(HTTPS + currentBlockchainNetwork.blockExplorerDomain+"/validator/page");
    return false;
}

async function showValidatorScreen() {
    document.getElementById('ahrefValidatorPage').textContent = currentBlockchainNetwork.blockExplorerDomain+"/validator/page";
    document.getElementById('main-content').style.display = "block";
    document.getElementById('settings-content').style.display = "none";
    document.getElementById('settingsScreen').style.display = "none";
    document.getElementById('networkListScreen').style.display = "none";
    document.getElementById('networkAddScreen').style.display = "none";

    document.getElementById('divNetworkDropdown').style.display = 'none';
    document.getElementById('HomeScreen').style.display = 'none';
    document.getElementById('SendScreen').style.display = 'none';
    document.getElementById('OfflineSignScreen').style.display = 'none';
    document.getElementById('ValidatorScreen').style.display = 'block';
    document.getElementById('gradient').style.height = '116px';

    let ddlValidatorOptions = document.getElementById("ddlValidatorOptions");
    ddlValidatorOptions.value = "none";

    await updateValidatorScreen();

    document.getElementById("ddlValidatorOptions").focus();

    resetCurrentGasConfig();
    attachValidatorGasListeners();
    setGasFeeLabel("spanValidatorGasFee", "");

    return false;
}

async function updateValidatorScreen() {
    document.getElementById("txtValidatorAddress").value = "";
    document.getElementById("txtValidatorDepositCoins").value = "";
    document.getElementById("txtCurrentNonceValidator").value = "";
    document.getElementById("pwdValidator").value = "";
    setGasFeeLabel("spanValidatorGasFee", "");

    document.getElementById("divValidatorAddress").style.display = "none";
    document.getElementById("divValidatorDepositCoins").style.display = "none";
    document.getElementById("divCurrentNonceValidator").style.display = "none";
    document.getElementById("divValidatorScreenPassword").style.display = "none";
    document.getElementById("divValidatorButton").style.display = "none";

    let ddlValidatorOptions = document.getElementById("ddlValidatorOptions");
    let selectedValue = ddlValidatorOptions.value;

    if(selectedValue === "none") {

    } else {
        document.getElementById("divValidatorButton").style.display  = "block";
        document.getElementById("divValidatorScreenPassword").style.display = "block";
        offlineSignEnabled = await offlineTxnSigningGetDefaultValue();

        if (offlineSignEnabled === true) {
            document.getElementById("btnValidation").style.display  = "none";
            document.getElementById("divCurrentNonceValidator").style.display  = "block";
            document.getElementById("btnOfflineValidation").style.display  = "block";
        } else {
            document.getElementById("btnValidation").style.display  = "block";
            document.getElementById("divCurrentNonceValidator").style.display  = "none";
            document.getElementById("btnOfflineValidation").style.display  = "none";
        }

        if(selectedValue === "newdeposit") {
            document.getElementById("divValidatorAddress").style.display = "block";
            document.getElementById("divValidatorDepositCoins").style.display = "block";
        } else if(selectedValue === "increasedeposit") {
            document.getElementById("divValidatorDepositCoins").style.display = "block";
        } else if(selectedValue === "initiatepartialwithdrawal") {
            document.getElementById("divValidatorDepositCoins").style.display = "block";
        } else if(selectedValue === "completepartialwithdrawal") {

        } else if(selectedValue === "pausevalidation") {

        } else if(selectedValue === "resumevalidation") {

        } else {

        }

        resetCurrentGasConfig();
        setGasFeeLabel("spanValidatorGasFee", "");
        scheduleValidatorGasEstimation();
    }
}

function validation() {
    let ddlValidatorOptions = document.getElementById("ddlValidatorOptions");
    let selectedValue = ddlValidatorOptions.value;

    if(selectedValue === "newdeposit") {
        newDeposit();
    } else if(selectedValue === "increasedeposit") {
        increaseDeposit();
    } else if(selectedValue === "initiatepartialwithdrawal") {
        initiatePartialWithdrawal();
    } else if(selectedValue === "completepartialwithdrawal") {
        completePartialWithdrawal();
    } else if(selectedValue === "pausevalidation") {
        pauseValidation();
    } else if(selectedValue === "resumevalidation") {
        resumeValidation();
    } else {

    }
}

async function copyOfflineSignature() {
    await WriteTextToClipboard(document.getElementById('txtOfflineSignature').value);
}