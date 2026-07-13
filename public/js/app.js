const DATA_LANG_KEY = "data-lang-key";
const DATA_PLACEHOLDER_KEY = "data-placeholder-key";
const DATA_ALT_KEY = "data-alt-key";
var currentInfoStep = 1;
var currentQuizStep = 1;
var STORAGE_PATH = "";
var langJson = "";

var tempPassword = "";
var tempSeedArray;
var currentWallet;
var currentWalletAddress = "";
var specificWalletAddress = "";
var additionalWalletMode = false; //this means first wallet has alredy been created and user is trying to create additional wallet
var revealSeedArray;
var currentSeedBytes = 96;
var isRefreshingConfirmBalance = false;

const ADDRESS_TEMPLATE = "[ADDRESS]";
const SHORT_ADDRESS_TEMPLATE = "[SHORT_ADDRESS]";
const STORAGE_PATH_TEMPLATE = "[STORAGE_PATH]";
const ERROR_TEMPLATE = "[ERROR]";

const BLOCK_EXPLORER_DOMAIN_TEMPLATE = "[BLOCK_EXPLORER_DOMAIN]";
const BLOCK_EXPLORER_ACCOUNT_TEMPLATE = "https://[BLOCK_EXPLORER_DOMAIN]/account/[ADDRESS]"
const BLOCK_EXPLORER_TRANSACTION_TEMPLATE = "https://[BLOCK_EXPLORER_DOMAIN]/txn/[TRANSACTION_HASH]"
const zero_address = "0x0000000000000000000000000000000000000000000000000000000000000000"; // 32 bytes hex

const BLOCKCHAIN_NETWORK_INDEX_TEMPLATE = "[BLOCKCHAIN_NETWORK_INDEX]";
const TAB_INDEX_TEMPLATE = "[TAB_INDEX]";
const BLOCKCHAIN_NETWORK_NAME_TEMPLATE = "[BLOCKCHAIN_NETWORK_NAME]";
const BLOCKCHAIN_NETWORK_ID_TEMPLATE = "[BLOCKCHAIN_NETWORK_ID]";
const BLOCKCHAIN_SCAN_API_DOMAIN_TEMPLATE = "[BLOCKCHAIN_SCAN_API_URL]";
const BLOCKCHAIN_EXPLORER_API_DOMAIN_TEMPLATE = "[BLOCKCHAIN_EXPLORER_API_URL]";
const BLOCKCHAIN_RPC_ENDPOINT_TEMPLATE = "[BLOCKCHAIN_RPC_ENDPOINT_URL]";
const TRANSACTION_HASH_TEMPLATE = "[TRANSACTION_HASH]";

/** String.replaceAll() treats $ in replacements specially; split/join is always literal. */
function replaceTemplateToken(html, token, value) {
    if (!token) {
        return html;
    }
    return html.split(token).join(value);
}

/** Replace only the first occurrence so user-supplied scan/txn/explorer text cannot match a later placeholder. */
function replaceTemplateTokenOnce(html, token, value) {
    if (!token) {
        return html;
    }
    const idx = html.indexOf(token);
    if (idx === -1) {
        return html;
    }
    return html.slice(0, idx) + value + html.slice(idx + token.length);
}

function getBlockchainNetworkRowTemplate() {
    if (blockchainNetworkRowTemplate && blockchainNetworkRowTemplate.indexOf(BLOCKCHAIN_RPC_ENDPOINT_TEMPLATE) !== -1) {
        return blockchainNetworkRowTemplate;
    }
    var tpl = document.getElementById("tplBlockchainNetworkRow");
    if (tpl && tpl.innerHTML && tpl.innerHTML.trim().length > 0) {
        return tpl.innerHTML.trim();
    }
    return blockchainNetworkRowTemplate || "";
}
const DROPDOWN_TEXT = "&#x25BC;";
const DEFAULT_ADVANCED_SIGNING_SETTING_KEY = "DefaultAdvancedSigningSettingKey";
const maxTokenNameLength = 25;
const maxTokenSymbolLength = 6;
const QuantumCoin = "QuantumCoin"

let walletListRowTemplate = "";
let blockchainNetworkOptionItemTemplate = "";
let currentBlockchainNetworkIndex = -1;
let blockchainNetworkRowTemplate = "";
var currentBlockchainNetwork;
var isRefreshingBalance = false;
let initAccountBalanceBackgroundStarted = false;
let currentBalance = "";
let completedTxnInRowTemplate = "";
let completedTxnOutRowTemplate = "";
let failedTxnInRowTemplate = "";
let failedTxnOutRowTemplate = "";
let currentTxnPageIndex = 0;
let currentTxnPageCount = 0;
let pendingTransactions = [];
let balanceNotificationMap = new Map(); //address => balance
let pendingTransactionsMap = new Map(); //address => last made txn
let autoCompleteInitialized = false;
let autoCompleteInitializedRestore = false;
let autoCompleteBoxes = [];
let autoCompleteBoxesRestore = [];
let isFirstTimeAccountRefresh = true;
let currentWalletTokenList = [];
let currentWalletRecognizedTokens = [];
let currentWalletUnrecognizedTokens = [];
let showingUnrecognizedTokens = false;
let currentAccountDetails = null;

function checkDuplicateIds() {
    var nodes = document.querySelectorAll('[id]');
    var idList = new Map();
    var totalNodes = nodes.length;

    for (var i = 0; i < totalNodes; i++) {
        var currentId = nodes[i].id ? nodes[i].id : "undefined";
        if (idList.has(currentId)) {
            throw new Error("duplicate id " + currentId);
        }
        idList.set(currentId);
    }
}

function getGenericError(error) {
    return langJson.errors.error.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH).replace(ERROR_TEMPLATE, error);
}
async function initApp() {
    checkDuplicateIds();

    // Capture row templates BEFORE the first await. csp-rehydrate.js runs on the
    // same DOMContentLoaded tick and strips inline on* attributes from the live
    // DOM; if we captured after awaiting, the templates would lose their onclick
    // handlers and dynamically injected rows (wallets, tokens, txns) would be dead.
    walletListRowTemplate = document.getElementsByClassName("wallet-row")[0].outerHTML;
    blockchainNetworkOptionItemTemplate = document.getElementsByClassName("network-template")[0].outerHTML;
    var tplNetworkRow = document.getElementById("tplBlockchainNetworkRow");
    if (tplNetworkRow && tplNetworkRow.innerHTML.trim().length > 0) {
        blockchainNetworkRowTemplate = tplNetworkRow.innerHTML.trim();
    } else {
        var fallbackRow = document.querySelector("#tbodyNetworkRow tr.network-row");
        blockchainNetworkRowTemplate = fallbackRow ? fallbackRow.outerHTML : "";
    }
    completedTxnInRowTemplate = document.getElementsByClassName("completed-txn-in-row")[0].outerHTML;    
    completedTxnOutRowTemplate = document.getElementsByClassName("completed-txn-out-row")[0].outerHTML;    
    failedTxnInRowTemplate = document.getElementsByClassName("failed-txn-in-row")[0].outerHTML;    
    failedTxnOutRowTemplate = document.getElementsByClassName("failed-txn-out-row")[0].outerHTML;
    tokenListRowTemplate = document.getElementsByClassName("token-list-row")[0].outerHTML;

    var langJsonString = await ReadFile("./json/en-us.json");
    if (langJsonString == null) {
        alert("Error ocurred reading lang json.");
        return;
    }

    langJson = JSON.parse(langJsonString);
    if (langJson == null) {
        alert("Error ocurred parsing json.");
        return;
    }

    let appVersion = await GetAppVersion();
    document.title = langJson.langValues.title + " " + appVersion;

    let seedInit = await initializeSeedWords();
    if (seedInit == false) {
        throw new Error(langJson.errors.seedInitError);
    }

    STORAGE_PATH = await storageGetPath();

    document.getElementById('login-content').style.display = 'none';
    document.getElementById('welcomeScreen').style.display = 'none';

    document.getElementById('main-content').style.display = 'none';
    document.getElementById('settings-content').style.display = 'none';
    document.getElementById('wallets-content').style.display = 'none';
    setWalletMenuEnabled(false);

    //Set all properties of data-lang-key
    var dataLangList = document.querySelectorAll('[' + DATA_LANG_KEY + ']');
    if (dataLangList.length) {
        for (var i = 0; i < dataLangList.length; i++) {
            var langVal = langJson.langValues[dataLangList[i].getAttribute(DATA_LANG_KEY)];
            if (langVal == null) {
                alert("Lang Value not set " + dataLangList[i].getAttribute(DATA_LANG_KEY));
            }
            dataLangList[i].textContent = langVal;
        }
    }

    var dataPlaceholderList = document.querySelectorAll('[' + DATA_PLACEHOLDER_KEY + ']');
    if (dataPlaceholderList.length) {
        for (var i = 0; i < dataPlaceholderList.length; i++) {
            var langVal = langJson.langValues[dataPlaceholderList[i].getAttribute(DATA_PLACEHOLDER_KEY)];
            if (langVal == null) {
                alert("Placeholder Value not set " + dataPlaceholderList[i].getAttribute(DATA_PLACEHOLDER_KEY));
            }
            dataPlaceholderList[i].placeholder = langVal;
        }
    }

    var dataAltList = document.querySelectorAll('[' + DATA_ALT_KEY + ']');
    if (dataAltList.length) {
        for (var i = 0; i < dataAltList.length; i++) {
            var langVal = langJson.langValues[dataAltList[i].getAttribute(DATA_ALT_KEY)];
            if (langVal == null) {
                alert("Alt Value not set " + dataPlaceholderList[i].getAttribute(DATA_ALT_KEY));
            }
            dataAltList[i].alt = langVal;
        }
    }

    let eulaStatus = await isEulaAccepted();
    if (eulaStatus == false) {
        showEula();
        return;
    }

    resumePostEula();
    resizeBoxes();
}

// True when running as the toolbar action popup (the anchored overlay). The
// surface is set by js/surface.js via the ?view= param and mirrored onto
// <html data-view="...">. The overlay is a fixed ~600px box, so screen.height
// (the monitor) is the wrong basis for sizing there.
function isOverlayPopup() {
    return document.documentElement.getAttribute("data-view") === "popup";
}

function resizeBoxes() {
    let maxHeight = "";
    let tokensMaxHeight = "";
    let maxHeightMiddle = "";
    
    if(isOverlayPopup()) {
        // The overlay popup is clamped to ~600px regardless of the monitor, so
        // use the smallest (else-branch) sizing so cards fit within the fold.
        maxHeight = "380px";
        maxHeightMiddle = "400px";
        tokensMaxHeight = "150px";
    } else if(screen.height >= 1024) {
        maxHeight = "520px";
        maxHeightMiddle = "550px";
        tokensMaxHeight = "295px";
    } else if(screen.height >= 960) {
        maxHeight = "515px";
        maxHeightMiddle = "545px";
        tokensMaxHeight = "295px";
    } else if(screen.height >= 900) {
        maxHeight = "500px";
        maxHeightMiddle = "530px";
        tokensMaxHeight = "295px";
    } else if(screen.height >= 800) {
        maxHeight = "450px";
        maxHeightMiddle = "495px";
        tokensMaxHeight = "295px";
    } else if(screen.height >= 768) {
        maxHeight = "430px";
        maxHeightMiddle = "480px";
        tokensMaxHeight = "225px";
    } else if(screen.height >= 720) {
        maxHeight = "380px";
        maxHeightMiddle = "450px";
        tokensMaxHeight = "180px";
    } else {
        maxHeight = "275px";
        maxHeightMiddle = "325px";
        tokensMaxHeight = "60px";
    }

    document.getElementById("divMainScreenTokens").style.maxHeight = tokensMaxHeight;
    let elements = document.getElementsByClassName("roundex-box");
    for(let i =0; i < elements.length;i++){
        elements[i].style.maxHeight  = maxHeight;
    }

    elements = document.getElementsByClassName("roundex-box-middle");
    for(let i =0; i < elements.length;i++){
        elements[i].style.maxHeight  = maxHeightMiddle;
    }
}

async function resumePostEula() {
    let readyStatus = await isMainKeyCreated();
    if (readyStatus == true) {
        showUnlockScreen();
    } else {
        showInfoScreen();
    }

    await blockchainNetworksInit();
    await showBlockchainNetworks();

    await swapReleasesInit();
    await refreshCurrentSwapRelease();
}

// Load the active release into the currentSwapRelease global (release.js) and
// refresh the custom-release banner. Called at boot and after every add/switch.
async function refreshCurrentSwapRelease() {
    let releaseMap = await swapReleasesList();
    let defaultIndex = await swapReleaseGetDefaultIndex();
    const sortedKeys = [...releaseMap.keys()].sort((a, b) => a - b);
    if (sortedKeys.length > 0 && !releaseMap.has(defaultIndex)) {
        defaultIndex = sortedKeys[0];
        await swapReleaseSetDefaultIndex(defaultIndex);
    }
    currentSwapRelease = releaseMap.get(defaultIndex) || null;
    updateCustomReleaseBanner();
}

// Standout banner above the logo, shown only when the active release is not a
// built-in one. The name is user/storage data: it was validated on add, but is
// re-checked here and rendered via textContent only; on failure the banner
// falls back to a generic label instead of the name.
function updateCustomReleaseBanner() {
    var banner = document.getElementById("divCustomReleaseBanner");
    if (!banner) return;
    if (!currentSwapRelease || currentSwapRelease.builtin === true) {
        banner.textContent = "";
        banner.style.display = "none";
        return;
    }
    var prefix = (langJson && langJson.langValues && langJson.langValues["custom-release-banner-prefix"]) || "Custom release: ";
    var name = String(currentSwapRelease.name || "");
    if (name === "" || htmlEncode(name) !== name || containsUnsafeDisplayText(name)) {
        name = "(unnamed)";
    }
    banner.textContent = prefix + name;
    banner.style.display = "block";
}

async function showBlockchainNetworks() {
    let networkMap = await blockchainNetworksList();
    currentBlockchainNetworkIndex = await blockchainNetworkGetDefaultIndex();

    const sortedKeys = [...networkMap.keys()].sort((a, b) => a[0] - b[0]);
    if (sortedKeys.length > 0 && !networkMap.has(currentBlockchainNetworkIndex)) {
        currentBlockchainNetworkIndex = sortedKeys[0];
        await blockchainNetworkSetDefaultIndex(currentBlockchainNetworkIndex);
    }

    var networkListString = "";

    let startTabIndex = 1;

    const sortedNetworkEntries = [...networkMap.entries()].sort((a, b) => a[0] - b[0]);
    for (const [index, networkItem] of sortedNetworkEntries) {
        var networkString = blockchainNetworkOptionItemTemplate;
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_NETWORK_INDEX_TEMPLATE, index.toString());
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_NETWORK_NAME_TEMPLATE, htmlEncode(String(networkItem.blockchainName)));
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_NETWORK_ID_TEMPLATE, htmlEncode(String(networkItem.networkId)));
        networkString = replaceTemplateTokenOnce(networkString, TAB_INDEX_TEMPLATE, startTabIndex.toString());
        startTabIndex = startTabIndex + 1;
        networkListString = networkListString + networkString;
        if (index == currentBlockchainNetworkIndex) {
            document.getElementById("spnNetwork").innerHTML = htmlEncode(String(networkItem.blockchainName)) + DROPDOWN_TEXT;
            document.getElementById("lblNetworkConfirm").textContent = String(networkItem.blockchainName);
            currentBlockchainNetwork = networkItem;
        }
    }
    document.getElementById("divNetworkListDialog").innerHTML = networkListString;
    let selectedNetworkEl = document.getElementById("optNetwork" + currentBlockchainNetworkIndex.toString());
    if (selectedNetworkEl) {
        selectedNetworkEl.checked = true;
    }

    document.getElementById("divCancelNetwork").tabIndex = startTabIndex.toString();
    startTabIndex = startTabIndex + 1;    
    document.getElementById("divOkNetwork").tabIndex = startTabIndex.toString();
}

async function showBlockchainNetworksTable() {
    let networkMap = await blockchainNetworksList();
    currentBlockchainNetworkIndex = await blockchainNetworkGetDefaultIndex();
    var networkListString = "";
    const sortedEntries = [...networkMap.entries()].sort((a, b) => a[0] - b[0]);
    const rowTpl = getBlockchainNetworkRowTemplate();
    for (const [index, networkItem] of sortedEntries) {
        var networkString = rowTpl;
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_NETWORK_INDEX_TEMPLATE, index.toString());
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_NETWORK_NAME_TEMPLATE, htmlEncode(String(networkItem.blockchainName)));
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_NETWORK_ID_TEMPLATE, htmlEncode(String(networkItem.networkId)));
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_SCAN_API_DOMAIN_TEMPLATE, htmlEncode(String(networkItem.scanApiDomain)));
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_EXPLORER_API_DOMAIN_TEMPLATE, htmlEncode(String(networkItem.blockExplorerDomain)));
        let rpcDisplay = networkItem.rpcEndpoint;
        if (rpcDisplay == null || String(rpcDisplay).trim() === "") {
            rpcDisplay = "public.rpc.quantumcoinapi.com";
        }
        networkString = replaceTemplateTokenOnce(networkString, BLOCKCHAIN_RPC_ENDPOINT_TEMPLATE, htmlEncode(String(rpcDisplay)));
        networkListString = networkListString + networkString;
    }
    document.getElementById("tbodyNetworkRow").innerHTML = networkListString;
}

async function saveSelectedBlockchainNetwork() {
    const radioButtons = document.querySelectorAll('input[name="network_option"]');
    let selectedValue = "";
    radioButtons.forEach(function (radioButton) {
        if (radioButton.checked) {
            selectedValue = radioButton.value;
        }
    });
    let result = await blockchainNetworkSetDefaultIndex(selectedValue);
    if (result == false) {
        showWarnAlert(getGenericError(""));
    } else {
        // Best-effort: notify the dApp broker so connected sites get chainChanged
        // and the read passthrough retargets the new network's RPC.
        try {
            let networkMap = await blockchainNetworksList();
            let netItem = networkMap.get(parseInt(selectedValue, 10));
            if (netItem) {
                let chainId = parseInt(netItem.networkId, 10);
                qcNotifyActiveNetworkChanged(chainId, {
                    name: String(netItem.blockchainName),
                    chainId: chainId,
                    scanApiDomain: netItem.scanApiDomain,
                    blockExplorerDomain: netItem.blockExplorerDomain,
                    rpcEndpoint: netItem.rpcEndpoint,
                    index: netItem.index != null ? netItem.index : parseInt(selectedValue, 10)
                });
            }
        } catch (e) { /* non-fatal */ }
        await showBlockchainNetworks();
        document.getElementById("spnAccountBalance").textContent = "";
        currentBalance = "";
        await refreshAccountBalance();
        if (document.getElementById("TransactionsScreen").style.display !== "none") {
            await refreshTransactionList();
        }
    }
}

async function showInfoScreen() {
    document.getElementById('login-content').style.display = 'block';
    document.getElementById('welcomeScreen').style.display = 'block';
    setWalletMenuEnabled(false);

    displayInfoStep == 1;
    displayInfoStep(1);
}

function displayInfoStep(step) {
    if (step >= 1 && step <= langJson.info.length) {
        currentInfoStep = step;
        totalSteps = langJson.info.length;
        var jsonData = langJson.info[ step - 1 ];

        document.getElementById('welcomeText').textContent = langJson.infoStep.replace("[STEP]", step).replace("[TOTAL_STEPS]", totalSteps);
        document.getElementById('divInfoPanelTitle').textContent = jsonData.title;
        document.getElementById('divInfoPanelDetail').textContent = jsonData.desc.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH);
    }
}

function nextInfoStep() {
    if (currentInfoStep < langJson.info.length) {
        currentInfoStep++;
        displayInfoStep(currentInfoStep);
    } else {
        displayQuizStep();
    }
}

function showCreateWalletPasswordScreen() {
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('quizScreen').style.display = 'none';
    document.getElementById('createWalletPasswordScreen').style.display = 'block';
    document.getElementById('pwdPassword').focus();
}

function displayQuizStep() {
    if (currentQuizStep > langJson.quiz.length) {
        showCreateWalletPasswordScreen();
        return;
    }

    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('quizScreen').style.display = 'block';

    totalSteps = langJson.quiz.length;
    var quizData = langJson.quiz[currentQuizStep - 1];

    document.getElementById('divSafetyQuizTitle').textContent = langJson.quizStep.replace("[STEP]", currentQuizStep).replace("[TOTAL_STEPS]", totalSteps);
    document.getElementById('divSafetyQuizSubTitle').textContent = quizData.title;
    document.getElementById('divSafetyQuizQuestion').textContent = quizData.question;

    var quizForm = document.getElementById("quizForm");
    quizForm.innerHTML = "";

    var choiceNode = document.getElementById("lblSafetyQuizChoice");
    let tabIndexStart = 350;
    for (var i = 0; i < quizData.choices.length; i++) {
        let choiceCloneNode = choiceNode.cloneNode(true)
        choiceCloneNode.id = "choice" + i;
        choiceNode.innerHTML = choiceNode.innerHTML.replace(TAB_INDEX_TEMPLATE, (i + tabIndexStart).toString());
        choiceCloneNode.innerHTML = choiceNode.innerHTML + htmlEncode(quizData.choices[i].replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH));
        choiceCloneNode.getElementsByClassName("safety_quiz_option")[0].value = i + 1;
        choiceCloneNode.style.display = "block";
        quizForm.appendChild(choiceCloneNode);
    }
}

function submitQuizForm() {
    const radioButtons = document.querySelectorAll('input[name="quiz_option"]');    
    let selectedValue = "";    
    radioButtons.forEach(function (radioButton) {
        if (radioButton.checked) {
            selectedValue = radioButton.value;
        }
    });
    if (selectedValue !== "") {
        var quizData = langJson.quiz[currentQuizStep - 1];
        if (quizData == null) {
            showWarnAlert(langJson.quizNoChoice);
            return;
        }
        if (selectedValue === quizData.correctChoice.toString()) {
            currentQuizStep = currentQuizStep + 1;
            showAlertAndExecuteOnClose(quizData.afterQuizInfo.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH), displayQuizStep);
        } else {
            showWarnAlert(langJson.quizWrongAnswer);
        }
    } else {
        showWarnAlert(langJson.quizNoChoice);
    }
}

function showWalletPath() {
    showAlert(STORAGE_PATH);
}

function throwMockError() {
    throw new Error("This is a mock error for testing.");
}

function checkNewPassword() {
    const minPasswordLength = 12;

    var password = document.getElementById("pwdPassword").value;
    var retypePassword = document.getElementById("pwdRetypePassword").value;

    if (password == null || password.length < minPasswordLength) {
        showWarnAlert(langJson.errors.passwordSpec);
        return false;
    }

    if (password !== password.trim()) {
        showWarnAlert(langJson.errors.passwordSpace);
        return false;
    }

    if (password !== retypePassword) {
        showWarnAlert(langJson.errors.retypePasswordMismatch);
        return false;
    }

    tempPassword = password;

    showCreateWalletPromptScreen();
}

function showCreateWalletPromptScreen() {
    document.getElementById('optNewWallet').checked = false;
    document.getElementById('optRestoreWalletFromSeed').checked = false;
    document.getElementById('optRestoreWalletFromBackupFile').checked = false;

    document.getElementById('createWalletPasswordScreen').style.display = 'none';
    document.getElementById('createWalletPromptScreen').style.display = 'block';
    document.getElementById('verifyWalletPasswordScreen').style.display = 'none';

    document.getElementById('optNewWallet').focus();
}

async function walletFormSubmitted() {
    const radioButtons = document.querySelectorAll('input[name="wallet_option"]');

    let selectedValue = "";

    radioButtons.forEach(function (radioButton) {
        if (radioButton.checked) {
            selectedValue = radioButton.value;
        }
    });

    if (selectedValue !== "") {
        if (selectedValue === "new_wallet") {
            showWalletTypeScreen();
        } else if (selectedValue === "wallet_from_seed") {
            showRestoreSeedTypeScreen();
        } else if (selectedValue === "restore_wallet_backup_file") {
            showRestoreWalletScreen();
        }
        else {
            showWarnAlert(langJson.errors.wrongAnswer);
        }
    } else {
        showWarnAlert(langJson.errors.selectOption);
    }
}

function showWalletTypeScreen() {
    document.getElementById('createWalletPromptScreen').style.display = 'none';
    document.getElementById('walletTypeScreen').style.display = 'block';
    var radioButtons = document.querySelectorAll('input[name="wallet_type_option"]');
    radioButtons.forEach(function (radioButton) { radioButton.checked = false; });
}

function backFromWalletTypeScreen() {
    document.getElementById('walletTypeScreen').style.display = 'none';
    document.getElementById('createWalletPromptScreen').style.display = 'block';
}

function backFromNewSeedScreen() {
    document.getElementById('newSeedScreen').style.display = 'none';
    showWalletTypeScreen();
}

async function walletTypeFormSubmitted() {
    var radioButtons = document.querySelectorAll('input[name="wallet_type_option"]');
    var selectedValue = "";
    radioButtons.forEach(function (radioButton) {
        if (radioButton.checked) {
            selectedValue = radioButton.value;
        }
    });

    if (selectedValue === "default") {
        currentSeedBytes = 64;
    } else if (selectedValue === "advanced") {
        currentSeedBytes = 72;
    } else {
        showWarnAlert(langJson.errors.selectOption);
        return;
    }

    document.getElementById('walletTypeScreen').style.display = 'none';
    await showNewSeedScreen();
}

function updateSeedRowVisibility(prefix, wordCount) {
    var totalRows = wordCount / 4;
    for (var i = 1; i <= 12; i++) {
        var el = document.getElementById(prefix + i);
        if (el) el.style.display = (i <= totalRows) ? "" : "none";
    }
}

async function showNewSeedScreen() {
    tempSeedArray = await cryptoNewSeed(currentSeedBytes);

    document.getElementById('createWalletPromptScreen').style.display = 'none';
    document.getElementById('walletTypeScreen').style.display = 'none';
    document.getElementById('newSeedScreen').style.display = 'block';
    document.getElementById("divSeedHelp").style.display = "block";
    document.getElementById("divSeedPanel").style.display = "none";
    document.getElementById("divNewSeedButtons").style.display = "none";

    var wordCount = tempSeedArray.length / 2;
    var wordList = await getWordListFromSeedArrayAsync(tempSeedArray);
    for (let i = 0; i < wordCount; i++) {
        document.getElementById("divNewSeed" + i).textContent = wordList[i].toUpperCase();
    }
    updateSeedRowVisibility("newSeedRowHead", wordCount);

    document.getElementById('aRevealSeed').focus();
}

function showRestoreSeedTypeScreen() {
    document.getElementById('createWalletPromptScreen').style.display = 'none';
    document.getElementById('restoreSeedTypeScreen').style.display = 'block';
    var radioButtons = document.querySelectorAll('input[name="seed_length_option"]');
    radioButtons.forEach(function (radioButton) { radioButton.checked = false; });
}

function backFromRestoreSeedTypeScreen() {
    document.getElementById('restoreSeedTypeScreen').style.display = 'none';
    document.getElementById('createWalletPromptScreen').style.display = 'block';
}

function backFromRestoreSeedScreen() {
    document.getElementById('restoreSeedScreen').style.display = 'none';
    showRestoreSeedTypeScreen();
}

function restoreSeedTypeFormSubmitted() {
    var radioButtons = document.querySelectorAll('input[name="seed_length_option"]');
    var selectedValue = "";
    radioButtons.forEach(function (radioButton) {
        if (radioButton.checked) {
            selectedValue = radioButton.value;
        }
    });

    if (selectedValue === "32") {
        currentSeedBytes = 64;
    } else if (selectedValue === "36") {
        currentSeedBytes = 72;
    } else if (selectedValue === "48") {
        currentSeedBytes = 96;
    } else {
        showWarnAlert(langJson.errors.selectOption);
        return;
    }

    document.getElementById('restoreSeedTypeScreen').style.display = 'none';
    showRestoreSeedScreen();
}

function showRestoreSeedScreen() {
    var wordCount = currentSeedBytes / 2;

    document.getElementById('createWalletPromptScreen').style.display = 'none';
    document.getElementById('restoreSeedTypeScreen').style.display = 'none';
    document.getElementById('newSeedScreen').style.display = 'none';
    document.getElementById("divSeedHelp").style.display = "none";
    document.getElementById("divSeedPanel").style.display = "none";
    document.getElementById("divNewSeedButtons").style.display = "none";
    document.getElementById("restoreSeedScreen").style.display = "block";

    for (i = 0; i < SEED_FRIENDLY_INDEX_ARRAY.length; i++) {
        document.getElementById("txtRestoreSeed" + SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase()).textContent = "";
    }

    populateRestoreSeedAutoComplete(wordCount);
}

async function populateRestoreSeedAutoComplete(wordCount) {
    let seedWordList = await getAllSeedWordsAsync();
    if (autoCompleteInitializedRestore == false) {
        for (var i = 0; i < SEED_FRIENDLY_INDEX_ARRAY.length; i++) {
            let box = document.getElementById("txtRestoreSeed" + SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase());
            let myAutoComplete = new AutoCompleteDropdownControl(box);
            box.tabIndex = i + 1;
            myAutoComplete.limitToList = true;
            myAutoComplete.optionValues = seedWordList;
            myAutoComplete.initialize();
            autoCompleteBoxesRestore.push(myAutoComplete);
        }
        autoCompleteInitializedRestore = true;
    } else {
        for (var i = 0; i < autoCompleteBoxesRestore.length; i++) {
            autoCompleteBoxesRestore[i].setSelectedValue('');
            autoCompleteBoxesRestore[i].reset();
        }
    }
    updateSeedRowVisibility("restoreSeedRowHead", wordCount);

    document.getElementById('txtRestoreSeedA1').focus();
}

// SEC-08: warn before writing the seed words to the shared system clipboard
// (same gate as copyRevealSeed; this is the new-wallet creation copy path).
function copyNewSeed() {
    showYesNoConfirm(
        langJson.langValues.revealSeedClipboardWarn,
        function () { doCopyNewSeed().catch(function () { showWarnAlert(getGenericError("")); }); }
    );
}

async function doCopyNewSeed() {
    var wordCount = tempSeedArray.length / 2;
    var wordList = await getWordListFromSeedArrayAsync(tempSeedArray);
    var copyText = SEED_FRIENDLY_INDEX_ARRAY[0].toUpperCase() + " = " + wordList[0].toUpperCase() + "\r\n";
    for (let i = 1; i < wordCount; i++) {
        copyText = copyText + SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase() + " = " + wordList[i].toUpperCase() + "\r\n";
    }
    await WriteTextToClipboard(copyText);
}

// SEC-08: warn before writing the seed words to the shared system clipboard.
function copyRevealSeed() {
    showYesNoConfirm(
        langJson.langValues.revealSeedClipboardWarn,
        function () { doCopyRevealSeed().catch(function () { showWarnAlert(getGenericError("")); }); }
    );
}

async function doCopyRevealSeed() {
    var wordCount = revealSeedArray.length / 2;
    var wordList = await getWordListFromSeedArrayAsync(revealSeedArray);
    var copyText = SEED_FRIENDLY_INDEX_ARRAY[0].toUpperCase() + " = " + wordList[0].toUpperCase() + "\r\n";
    for (let i = 1; i < wordCount; i++) {
        copyText = copyText + SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase() + " = " + wordList[i].toUpperCase() + "\r\n";
    }
    await WriteTextToClipboard(copyText);
}

function showSeedPanel() {
    document.getElementById("divSeedPanel").style.display = "flex";
    document.getElementById("divSeedHelp").style.display = "none";
    document.getElementById("divNewSeedButtons").style.display = "block";
    return false;
}

function showVerifySeedPanel() {
    var wordCount = tempSeedArray.length / 2;

    for (i = 0; i < SEED_FRIENDLY_INDEX_ARRAY.length; i++) {
        document.getElementById("txtSeed" + SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase()).textContent = "";
    }

    document.getElementById('seedVerifyScreen').style.display = 'block';
    document.getElementById('newSeedScreen').style.display = 'none';

    populateVerifySeedAutoComplete(wordCount);
}

async function populateVerifySeedAutoComplete(wordCount) {
    let seedWordList = await getAllSeedWordsAsync();
    if (autoCompleteInitialized == false) {
        for (var i = 0; i < SEED_FRIENDLY_INDEX_ARRAY.length; i++) {
            let box = document.getElementById("txtSeed" + SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase());
            let myAutoComplete = new AutoCompleteDropdownControl(box);
            box.tabIndex = i + 1;
            myAutoComplete.limitToList = true;
            myAutoComplete.optionValues = seedWordList;
            myAutoComplete.initialize();
            autoCompleteBoxes.push(myAutoComplete);
        }
        autoCompleteInitialized = true;
    } else {
        for (var i = 0; i < autoCompleteBoxes.length; i++) {
            autoCompleteBoxes[i].setSelectedValue('');
            autoCompleteBoxes[i].reset();
        }
    }
    updateSeedRowVisibility("verifySeedRowHead", wordCount);
    document.getElementById('txtSeedA1').focus();

    return false;
}

async function verifySeedWords() {
    var wordCount = tempSeedArray.length / 2;
    var seedWords = new Array(wordCount);
    for (i = 0; i < wordCount; i++) {
        var seedWord = document.getElementById("txtSeed" + SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase()).textContent;
        var seedIndexFriedly = SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase();

        if (seedWord === null || seedWord.length < 2) {
            return showWarnAlert(langJson.errors.seedEmpty + seedIndexFriedly);
        }

        seedWord = seedWord.toLowerCase();
        if (await doesSeedWordExistAsync(seedWord) === false) {
            return showWarnAlert(langJson.errors.seedDoesNotExist + seedIndexFriedly);
        }

        if (await verifySeedWordAsync(i, seedWord, tempSeedArray) === false) {
            return showWarnAlert(langJson.errors.seedMismatch + seedIndexFriedly + " " + seedWord.toUpperCase());
        }
    }

    showVerifyWalletPasswordScreen();
}

function showVerifyWalletPasswordScreen() {
    document.getElementById("pwdVerifyWalletPassword").value = "";
    document.getElementById('restoreSeedScreen').style.display = 'none';
    document.getElementById('seedVerifyScreen').style.display = 'none';
    document.getElementById('restoreWalletScreen').style.display = 'none';
    document.getElementById('confirmWalletScreen').style.display = 'none';
    document.getElementById('verifyWalletPasswordScreen').style.display = 'block';
    document.getElementById('pwdVerifyWalletPassword').focus();
}

function verifyWalletPassword() {
    var password = document.getElementById("pwdVerifyWalletPassword").value;
    if (password == null || password.length < 1) {
        showWarnAlert(langJson.errors.enterWalletPassord);
        return false;
    }
    if (additionalWalletMode == false && password !== tempPassword) {
        showWarnAlert(langJson.errors.walletPasswordMismatch);
        return false;
    } else {
        tempPassword = password;
    }
    // SEC-07: the password now lives only in tempPassword for the save/backup
    // flow; remove the cleartext copy from the DOM input.
    document.getElementById("pwdVerifyWalletPassword").value = "";

    showLoadingAndExecuteAsync(langJson.langValues.waitWalletSave, saveWallet);
}

function showBackupWalletScreen() {
    document.getElementById('seedVerifyScreen').style.display = 'none';
    document.getElementById('restoreSeedScreen').style.display = 'none';
    document.getElementById('restoreWalletScreen').style.display = 'none';
    document.getElementById('verifyWalletPasswordScreen').style.display = 'none';
    document.getElementById('backupWalletScreen').style.display = 'block';
}

async function saveWallet() {
    try {
        let walletIndex = await walletGetMaxIndex();
        if (walletIndex == -1) {            
            if (additionalWalletMode == true) {
                hideWaitingBox();
                showErrorAndLockup(getGenericError(""));
                return false;
            }
            let mainKeyStatus = await isMainKeyCreated();
            if (mainKeyStatus == true) {
                hideWaitingBox();
                showErrorAndLockup(getGenericError(""));
                return false;
            }
            await storageCreateMainKey(tempPassword);
        }
        if (currentWallet == null) {
            currentWallet = await walletCreateNewWalletFromSeed(tempSeedArray);
        }

        if (walletDoesAddressExistInCache(currentWallet.address)) {
            hideWaitingBox();
            showWarnAlertAndExecuteOnClose(langJson.errors.walletAddressExists.replace(ADDRESS_TEMPLATE, currentWallet.address), createOrRestoreWallet);
            return false;
        }

        let ret = await walletSave(currentWallet, tempPassword);
        if (ret == false) {
            hideWaitingBox();
            showErrorAndLockup(getGenericError(""));
            return false;
        }

        currentWalletAddress = currentWallet.address;

        hideWaitingBox();
        showAlertAndExecuteOnClose(langJson.langValues.walletSaved, showBackupWalletScreen);
    }
    catch (error) {
        // SEC-11: log the detail; show only the generic message (no raw error).
        console.error("saveWallet failed:", error);
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletPasswordMismatch);
    }
    return true;
}

function saveFile(content, mimeType, filename) {
    const a = document.createElement('a');
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    a.click();
}

async function showWalletScreen() {
    currentWallet = null;
    tempSeedArray = null;
    specificWalletAddress = "";
    tempPassword = "";
    revealSeedArray = null;
    currentBalance = "";
    showingUnrecognizedTokens = false;

    document.getElementById('login-content').style.display = 'none';
    document.getElementById('settings-content').style.display = 'none';
    document.getElementById('wallets-content').style.display = 'none';
    document.getElementById('SendScreen').style.display = 'none';
    document.getElementById('SwapScreen').style.display = 'none';
    document.getElementById('ReceiveScreen').style.display = 'none';
    document.getElementById('TransactionsScreen').style.display = 'none';
    document.getElementById('backupWalletScreen').style.display = 'none';

    document.getElementById('main-content').style.display = 'block';
    document.getElementById('divMainContent').style.display = 'block';
    document.getElementById('HomeScreen').style.display = 'block';
    document.getElementById('divNetworkDropdown').style.display = 'block';
    setWalletMenuEnabled(true);

    document.getElementById('SendScreen').style.display = 'none';
    document.getElementById('SwapScreen').style.display = 'none';
    document.getElementById('ReceiveScreen').style.display = 'none';
    document.getElementById('TransactionsScreen').style.display = 'none';

    document.getElementById('gradient').style.height = '224px';
    document.getElementById('walletAddress').textContent = currentWalletAddress;

    resizeBoxes();
    initRefreshAccountBalanceBackground();

    return false;
}

function removeOptions(selectElement) {
    var i, L = selectElement.options.length - 1;
    for(i = L; i >= 0; i--) {
        selectElement.remove(i);
    }
}

function showReceiveScreen() {
    document.getElementById('HomeScreen').style.display = 'none';
    document.getElementById('ReceiveScreen').style.display = 'block';
    document.getElementById('gradient').style.height = '116px';
    document.getElementById('receiveWalletAddress').innerText = currentWalletAddress;
    loadQRcode(currentWalletAddress);
    document.getElementById('divCopyReceiveScreen').focus();

    return false;
}

async function copyAddressReceiveScreen() {
    await WriteTextToClipboard(currentWalletAddress);   
    return false;
}

function backupCurrentWallet() {
    showLoadingAndExecuteAsync(langJson.langValues.backupWait, encryptAndBackupCurrentWallet);
}

async function encryptAndBackupCurrentWallet() {
    let walletJson = await walletGetAccountJsonFromWallet(currentWallet, tempPassword);

    var isoStr = new Date().toISOString();
    isoStr = isoStr.replaceAll(":", "-");
    var addr = currentWallet.address.toLowerCase()
    if (addr.startsWith("0x") == true) {
        addr = addr.substring(2, addr.length)
    }
    var filename = "UTC--" + isoStr + "--" + addr + ".wallet"
    var mimetype = 'text/javascript'
    saveFile(walletJson, mimetype, filename)

    hideWaitingBox();
    document.getElementById("backupButton").style.display = "none";
    document.getElementById("nextButtonBackupWalletScreen").style.display = "block";
}

async function restoreSeed() {
    var wordCount = currentSeedBytes / 2;
    var seedWords = new Array(wordCount);
    for (i = 0; i < wordCount; i++) {
        var seedWord = document.getElementById("txtRestoreSeed" + SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase()).textContent;
        var seedIndexFriedly = SEED_FRIENDLY_INDEX_ARRAY[i].toUpperCase();

        if (seedWord === null || seedWord.length < 2) {
            return showWarnAlert(langJson.errors.seedEmpty + seedIndexFriedly);
        }

        seedWord = seedWord.toLowerCase();
        if (await doesSeedWordExistAsync(seedWord) === false) {
            return showWarnAlert(langJson.errors.seedDoesNotExist + seedIndexFriedly);
        }

        seedWords[i] = seedWord;
    }

    tempSeedArray = await getSeedArrayFromWordListAsync(seedWords);
    if (tempSeedArray == null) {
        return showToastBox(langJson.errors.wordToSeed);
    }

    await showConfirmWalletScreen();
}

async function showConfirmWalletScreen() {
    document.getElementById('restoreSeedScreen').style.display = 'none';
    document.getElementById('restoreWalletScreen').style.display = 'none';
    document.getElementById('seedVerifyScreen').style.display = 'none';
    document.getElementById('verifyWalletPasswordScreen').style.display = 'none';
    document.getElementById('confirmWalletScreen').style.display = 'block';

    currentWallet = await walletCreateNewWalletFromSeed(tempSeedArray);
    currentWalletAddress = currentWallet.address;
    document.getElementById("confirmWalletAddress").textContent = currentWalletAddress;

    document.getElementById("spnConfirmWalletBalance").textContent = "-";
    await refreshConfirmWalletBalance();
}

async function refreshConfirmWalletBalance() {
    if (isRefreshingConfirmBalance == true) {
        return;
    }
    isRefreshingConfirmBalance = true;

    try {
        document.getElementById("divConfirmWalletLoadingBalance").style.display = "block";
        document.getElementById("spnConfirmWalletBalance").textContent = "-";

        if (currentBlockchainNetwork != null) {
            let accountDetails = await getAccountDetails(currentBlockchainNetwork.scanApiDomain, currentWalletAddress);
            if (accountDetails != null) {
                let balance = await weiToEtherFormatted(accountDetails.balance);
                document.getElementById("spnConfirmWalletBalance").textContent = balance;
            }
        }
    }
    catch (error) {
        document.getElementById("spnConfirmWalletBalance").textContent = "-";
    }
    finally {
        document.getElementById("divConfirmWalletLoadingBalance").style.display = "none";
        isRefreshingConfirmBalance = false;
    }
}

function backFromConfirmWalletScreen() {
    isRefreshingConfirmBalance = false;
    document.getElementById("divConfirmWalletLoadingBalance").style.display = "none";
    document.getElementById('confirmWalletScreen').style.display = 'none';
    document.getElementById('restoreSeedScreen').style.display = 'block';
    return false;
}

function nextFromConfirmWalletScreen() {
    isRefreshingConfirmBalance = false;
    document.getElementById("divConfirmWalletLoadingBalance").style.display = "none";
    showVerifyWalletPasswordScreen();
    return false;
}

async function copyConfirmWalletAddress() {
    await WriteTextToClipboard(currentWalletAddress);
    return false;
}

function restoreWalletFromFile() {
    var walletFile = document.getElementById("filRestoreWallet");
    if (walletFile.files.length == 0) {
        return showWarnAlert(langJson.errors.selectWalletFile);
    }
    var walletPassword = document.getElementById("pwdRestoreWallet").value;
    if (walletPassword == null || walletPassword.length < 1) {
        return showWarnAlert(langJson.errors.enterWalletFilePassword);
    }

    showLoadingAndExecuteAsync(langJson.langValues.walletFileRestoreWait, restoreWalletFileOpen);
}

async function restoreWalletFileOpen() {
    var file_to_read = document.getElementById("filRestoreWallet").files[0];
    var fileread = new FileReader();
    fileread.onload = async function (e) {
        var walletJson = e.target.result;      

        try {            
            let walletDetails = JSON.parse(walletJson);
            if (walletDetails == null) {
                return showWarnAlert(langJson.errors.walletFileOpenError);
            }
            
            var walletPassword = document.getElementById("pwdRestoreWallet").value;
            currentWallet = await walletCreateNewWalletFromJson(walletJson, walletPassword);

            hideWaitingBox();
            showVerifyWalletPasswordScreen();
            return;
        } catch (error) {
            hideWaitingBox();
            return showWarnAlert(langJson.errors.walletFileOpenError);
        }        
    };
    fileread.readAsText(file_to_read);
}

function getShortAddress(address) {
    let shortAddress = "";
    if (address.startsWith("0x") == true) {
        shortAddress = address.substring(2, 7);
    } else {
        shortAddress = address.substring(0, 5);
    }

    shortAddress = shortAddress + "..." + address.substring(address.length - 6, address.length);

    return shortAddress;
}

function showWalletListScreen() {

    document.getElementById('gradient').style.height = '116px';
    document.getElementById('login-content').style.display = "none";
    document.getElementById('main-content').style.display = "none";
    document.getElementById('wallets-content').style.display = "block";
    document.getElementById('settings-content').style.display = "none";
    document.getElementById('WalletsScreen').style.display = "block";
    document.getElementById('revealSeedScreen').style.display = "none";
    document.getElementById('backupSpecificWalletScreen').style.display = "none";
    document.getElementById('divNetworkDropdown').style.display = 'none';

    let walletMap = walletGetCachedAddressToIndexMap();
    let tBody = "";
    let tabIndex = 1;
    for (const [address, index] of walletMap.entries()) {
        
        let shortAddress = getShortAddress(address);
        // item 14: the [ADDRESS] substitution feeds single-quoted inline onclick
        // args (e.g. OpenScanAddress('[ADDRESS]')); attribute-encode it so a
        // malformed address can't break out of the quoted arg. Valid hex addresses
        // are unaffected, and csp-rehydrate reads the decoded attribute value.
        let row = walletListRowTemplate.replaceAll(ADDRESS_TEMPLATE, htmlAttrEncode(address));
        row = row.replaceAll(SHORT_ADDRESS_TEMPLATE, htmlAttrEncode(shortAddress));

        row = row.replace('[SHORT_ADDRESS_TAB_INDEX]', tabIndex.toString());
        tabIndex = tabIndex + 1;

        row = row.replace('[SCAN_TAB_INDEX]', tabIndex.toString());
        tabIndex = tabIndex + 1;

        row = row.replace('[BACKUP_TAB_INDEX]', tabIndex.toString());
        tabIndex = tabIndex + 1;

        row = row.replace('[SEED_TAB_INDEX]', tabIndex.toString());
        tabIndex = tabIndex + 1;

        tBody = tBody + row;
    }   

    document.getElementById("tbodyWallet").innerHTML = tBody;

    document.getElementById("aCreateNewOrRestore").tabIndex = tabIndex.toString();
    tabIndex = tabIndex + 1;
    document.getElementById("backButtonWalletListScreen").tabIndex = tabIndex.toString();

    return false;
}

// Publish the currently-open wallet address to chrome.storage.session so the
// separate dApp approval popup (approve.html) can prefill the default account.
// Only the public address is shared (never the password); the popup still
// requires the password to sign. Session storage is in-memory and shared across
// extension contexts, and is cleared when the browser fully closes.
function qcSessionSetAddress(address) {
    try {
        var api = (typeof browser !== "undefined") ? browser : chrome;
        if (api && api.storage && api.storage.session) {
            api.storage.session.set({ qc_current_address: address });
        }
    } catch (e) { /* non-fatal */ }
}

function qcSessionClearAddress() {
    try {
        var api = (typeof browser !== "undefined") ? browser : chrome;
        if (api && api.storage && api.storage.session) {
            api.storage.session.remove("qc_current_address");
        }
    } catch (e) { /* non-fatal */ }
}

// Tell the dApp broker (background) that the active wallet changed, so it can
// repoint every connected site to the new address and emit accountsChanged.
function qcNotifyActiveAccountChanged(address) {
    try {
        var api = (typeof browser !== "undefined") ? browser : chrome;
        if (api && api.runtime && api.runtime.sendMessage) {
            api.runtime.sendMessage({ type: "qc-active-account-changed", address: address });
        }
    } catch (e) { /* non-fatal */ }
}

// Tell the dApp broker (background) that the active network changed, so it can
// repoint every connected site to the new chainId/RPC and emit the standard
// chainChanged event to connected dApps.
function qcNotifyActiveNetworkChanged(chainId, network) {
    try {
        var api = (typeof browser !== "undefined") ? browser : chrome;
        if (api && api.runtime && api.runtime.sendMessage) {
            api.runtime.sendMessage({ type: "qc-active-network-changed", chainId: chainId, network: network });
        }
    } catch (e) { /* non-fatal */ }
}

async function setWalletAddressAndShowWalletScreen(address) {
    currentWalletAddress = address;
    qcSessionSetAddress(address);
    qcNotifyActiveAccountChanged(address);
    currentBalance = "";
    currentAccountDetails = null;
    document.getElementById("spnAccountBalance").textContent = "";
    document.getElementById("tbodyAccountTokens").innerHTML = "";
    document.getElementById("divAccountTokens").style.display = "none";
    document.getElementById("divTokenTabs").style.display = "none";
    document.getElementById("divRefreshBalance").style.display = "none";
    document.getElementById("divLoadingBalance").style.display = "block";
    await showWalletScreen();
    await refreshAccountBalance();
}

function showSpecificWalletBackupScreen(addr) {
    document.getElementById("pwdBackupSpecificWallet").value = "";
    document.getElementById("WalletsScreen").style.display = "none";
    document.getElementById("revealSeedScreen").style.display = "none";
    document.getElementById("backupSpecificWalletScreen").style.display = "block";
    document.getElementById("divSpecificBackupAddress").textContent = addr;
    
    specificWalletAddress = addr;

    document.getElementById("pwdBackupSpecificWallet").focus();

    return false;
}

function backupSpecificWallet() {
    var password = document.getElementById("pwdBackupSpecificWallet").value;
    if (password == null || password.length < 1) {
        showWarnAlert(langJson.errors.enterWalletPassord)
        return;
    }
    showLoadingAndExecuteAsync(langJson.langValues.backupWait, encryptAndBackupSpecificWallet);
}

async function encryptAndBackupSpecificWallet() {
    var password = document.getElementById("pwdBackupSpecificWallet").value;
    var specificWallet;
    try {
        specificWallet = await walletGetByAddress(password, specificWalletAddress);
        if (specificWallet == null) {
            hideWaitingBox();
            showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH))
            return;
        }
    }
    catch (error) {
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH) + " " + error)
        return;
    }
    let walletJson = await walletGetAccountJsonFromWallet(specificWallet, password);

    var isoStr = new Date().toISOString();
    isoStr = isoStr.replaceAll(":", "-");
    var addr = specificWallet.address.toLowerCase()
    if (addr.startsWith("0x") == true) {
        addr = addr.substring(2, addr.length)
    }
    var filename = "UTC--" + isoStr + "--" + addr + ".wallet"
    var mimetype = 'text/javascript'
    saveFile(walletJson, mimetype, filename)

    hideWaitingBox();
}

function showRevealSeedScreen(addr) {
    for (let i = 0; i < SEED_FRIENDLY_INDEX_ARRAY.length; i++) {
        document.getElementById("divRevealSeed" + i).textContent = "";
    }    
    document.getElementById("pwdRevealSeedScreenPassword").value = "";

    specificWalletAddress = addr;
    document.getElementById("divRevealSeedAddress").textContent = specificWalletAddress;
    document.getElementById("WalletsScreen").style.display = "none";
    document.getElementById("revealSeedScreen").style.display = "block";
    document.getElementById("divRevealSeedHelp").style.display = "block";
    document.getElementById("divRevealSeedPanel").style.display = "none";
    document.getElementById("divCopyRevealSeed").style.display = "none";
    document.getElementById("backupSpecificWalletScreen").style.display = "none";
    document.getElementById("divRevealButton").style.display = "block";

    document.getElementById("pwdRevealSeedScreenPassword").focus();

    return false;
}

function showRevealSeedPanel() {
    var password = document.getElementById("pwdRevealSeedScreenPassword").value;
    if (password == null || password.length < 1) {
        showWarnAlert(langJson.errors.enterWalletPassord)
        return;
    }

    showLoadingAndExecuteAsync(langJson.langValues.waitRevealSeed, revealSeedWallet);

    return false;
}

async function revealSeedWallet() {
    var password = document.getElementById("pwdRevealSeedScreenPassword").value;
    // SEC-07: drop the cleartext password from the DOM as soon as it is captured.
    document.getElementById("pwdRevealSeedScreenPassword").value = "";
    var specificWallet;
    try {
        specificWallet = await walletGetByAddress(password, specificWalletAddress);
        if (specificWallet == null) {
            hideWaitingBox();
            showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH))
            return;
        }
    }
    catch (error) {
        // SEC-11: log the detail; show only the generic wallet-open message.
        console.error("revealSeedWallet failed:", error);
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH))
        return;
    }

    revealSeedArray = specificWallet.getSeedArray();
    if (revealSeedArray == null) {
        hideWaitingBox();
        showWarnAlert(langJson.errors.noSeed);
        return;
    }

    if (specificWallet.address.toLowerCase() !== specificWalletAddress.toLowerCase()) {
        hideWaitingBox();
        showWarnAlert(getGenericError(""));
        return;
    }

    let wordList = await getWordListFromSeedArrayAsync(revealSeedArray);
    if (wordList == null) {
        hideWaitingBox();
        showWarnAlert(getGenericError(""));
        return;
    }

    var wordCount = revealSeedArray.length / 2;
    for (let i = 0; i < wordCount; i++) {
        document.getElementById("divRevealSeed" + i).textContent = wordList[i].toUpperCase();
    }
    updateSeedRowVisibility("revealSeedRowHead", wordCount);

    document.getElementById("divRevealSeedHelp").style.display = "none";
    document.getElementById("divRevealButton").style.display = "none";
    document.getElementById("divRevealSeedPanel").style.display = "block";
    hideWaitingBox();
    document.getElementById("divCopyRevealSeed").style.display = "block";
}

function createOrRestoreWallet() {
    additionalWalletMode = true;
    currentWallet = null;
    tempSeedArray = null;
    specificWalletAddress = "";
    tempPassword = "";
    revealSeedArray = null;

    createOrRestorePromptBack = "wallets";
    document.getElementById('login-content').style.display = 'block';
    document.getElementById('wallets-content').style.display = 'none';
    showCreateWalletPromptScreen();
    return false;
}

function showUnlockScreen() {
    // Wallet is locked here; drop the shared default address for the popup.
    qcSessionClearAddress();
    document.getElementById('unlockScreen').style.display = "block";
    document.getElementById('login-content').style.display = "block";
    document.getElementById('main-content').style.display = "none";
    document.getElementById('settings-content').style.display = "none";
    document.getElementById('wallets-content').style.display = "none";
    setWalletMenuEnabled(false);
    setTimeout(function () {
        var el = document.getElementById('pwdUnlock');
        if (el) { el.focus(); }
    }, 0);
}

function unlockWallet() {
    var password = document.getElementById("pwdUnlock").value;
    if (password == null || password.length < 1) {
        showWarnAlert(langJson.errors.enterWalletPassord)
        return;
    }

    showLoadingAndExecuteAsync(langJson.langValues.waitUnlock, decryptAndUnlockWallet);

    return false;
}

async function decryptAndUnlockWallet() {
    var password = document.getElementById("pwdUnlock").value;
    // SEC-07: drop the cleartext password from the DOM as soon as it is captured.
    document.getElementById("pwdUnlock").value = "";

    try {
        let walletList = await walletLoadAll(password);
        if (walletList == null || walletList.length < 1) {
            hideWaitingBox();
            showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH))
            return;
        }
        let walletReverseMap = walletGetCachedIndexToAddressMap();
        let walletAddress = walletReverseMap.get(0);
        hideWaitingBox();
        document.getElementById("unlockScreen").style.display = "none";
        additionalWalletMode = true;
        setWalletAddressAndShowWalletScreen(walletAddress);
    }
    catch (error) {
        // SEC-11: keep decrypt/error detail out of the UI; log it for debugging.
        console.error("decryptAndUnlockWallet failed:", error);
        hideWaitingBox();
        showWarnAlert(langJson.errors.walletOpenError.replace(STORAGE_PATH_TEMPLATE, STORAGE_PATH))
        return;
    }
    return false;
}

const showRestoreWalletLabel = (event) => {
    const files = event.target.files;
    if (files.length == 0) {
        document.getElementById("divRestoreWalletFilename").textContent = "";
    } else {
        document.getElementById("divRestoreWalletFilename").textContent = files[0].name;
    }
    return;
}

function showRestoreWalletScreen() {
    document.getElementById('createWalletPromptScreen').style.display = 'none';
    document.getElementById('restoreWalletScreen').style.display = 'block';
    document.getElementById("divRestoreWalletFilename").textContent = "";
    document.getElementById("filRestoreWallet").value = '';
    document.getElementById("pwdRestoreWallet").value = '';

    document.getElementById("filRestoreWallet").focus();
}

async function copyAddress() {
    await WriteTextToClipboard(currentWalletAddress);   
}

async function openBlockExplorerAccount() {
    let url = BLOCK_EXPLORER_ACCOUNT_TEMPLATE;
    url = url.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain);
    url = url.replace(ADDRESS_TEMPLATE, currentWalletAddress);

    await OpenUrl(url);
}

function showSettingsScreen() {
    document.getElementById('ahrefWalletPath').focus();
    document.getElementById('gradient').style.height = '116px';
    document.getElementById('login-content').style.display = "none";
    document.getElementById('main-content').style.display = "none";
    document.getElementById('wallets-content').style.display = "none";
    document.getElementById('WalletsScreen').style.display = "none";
    document.getElementById('revealSeedScreen').style.display = "none";
    document.getElementById('backupSpecificWalletScreen').style.display = "none";
    document.getElementById('networkListScreen').style.display = "none";
    document.getElementById('releaseListScreen').style.display = "none";
    document.getElementById('releaseAddScreen').style.display = "none";
    document.getElementById('divNetworkDropdown').style.display = 'none';

    document.getElementById('settings-content').style.display = "block";
    document.getElementById('settingsScreen').style.display = "block";

    return false;
}

// Enable/disable the burger menu's Wallets, Settings and Releases entries. They
// stay grayed out (via the .disabled class) until a wallet is unlocked. The
// surface controls (Pop out / Dock / Full screen) are never gated.
function setWalletMenuEnabled(enabled) {
    ['tab1', 'tab4', 'tab5'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        if (enabled) {
            el.classList.remove('disabled');
        } else {
            el.classList.add('disabled');
        }
    });
}

// Top-left burger menu (Wallets / Settings). Replaces the old bottom tab bar.
function toggleBurgerMenu() {
    var dropdown = document.getElementById('burgerDropdown');
    if (!dropdown) return false;
    dropdown.style.display = (dropdown.style.display === 'block') ? 'none' : 'block';
    return false;
}

function closeBurgerMenu() {
    var dropdown = document.getElementById('burgerDropdown');
    if (dropdown) dropdown.style.display = 'none';
}

// Close the burger dropdown when clicking anywhere outside of it.
document.addEventListener('click', function (event) {
    var menu = document.getElementById('burgerMenu');
    var dropdown = document.getElementById('burgerDropdown');
    if (!menu || !dropdown || dropdown.style.display !== 'block') return;
    if (!menu.contains(event.target)) {
        dropdown.style.display = 'none';
    }
});

function togglePasswordBox(eyeImg, txtBoxId) {
    var txtBox = document.getElementById(txtBoxId);
    if (txtBox.getAttribute('type') == 'password') {
        txtBox.setAttribute('type', 'text');
        eyeImg.src = "assets/svg/eye-off-outline.svg";
    } else {
        txtBox.setAttribute('type', 'password');
        eyeImg.src = "assets/svg/eye-outline.svg";
    }
}

function backFromCreateOrRestoreWallet() {
    document.getElementById('createWalletPromptScreen').style.display = 'none';

    if (additionalWalletMode == true) {
        showWalletListScreen();
    } else {
        showCreateWalletPasswordScreen();
    }
}

function backToCreateWalletPromptScreen() {
    document.getElementById('createWalletPromptScreen').style.display = 'block';
    document.getElementById('walletTypeScreen').style.display = 'none';
    document.getElementById('restoreSeedTypeScreen').style.display = 'none';
    document.getElementById('restoreSeedScreen').style.display = 'none';
    document.getElementById('newSeedScreen').style.display = 'none';
    document.getElementById('restoreWalletScreen').style.display = 'none';
    document.getElementById('optNewWallet').focus();
}

function backToSeedScreen() {
    document.getElementById('seedVerifyScreen').style.display = 'none';
    document.getElementById('newSeedScreen').style.display = 'block';
    document.getElementById("divSeedPanel").style.display = "none";
    document.getElementById("divSeedHelp").style.display = "block";
    document.getElementById("divNewSeedButtons").style.display = "none";
}

function loadQRcode(qrString) {
    const qrcodeElement = document.getElementById("qrcode");
    qrcodeElement.innerHTML = '';
    const qrcode = new QRCode(qrcodeElement, {
        text: qrString,
        width: 260,
        height: 260,
    });
}
async function showNetworksScreen() {
    document.getElementById('settings-content').style.display = "block";
    document.getElementById('settingsScreen').style.display = "none";
    document.getElementById('networkListScreen').style.display = "block";
    document.getElementById('networkAddScreen').style.display = "none";
    await showBlockchainNetworksTable();
}

function showAddNetworkScreen() {
    document.getElementById('networkListScreen').style.display = "none";
    document.getElementById('networkAddScreen').style.display = "block";
    document.getElementById('txtNetworkJSON').focus();
    return false;
}

function buildAddNetworkConfirmDetails() {
    let jsonString = (document.getElementById("txtNetworkJSON").value || "").replace(/^\uFEFF/, "").trim();
    const lv = langJson.langValues;
    if (jsonString.length < 1) {
        return "\n\n" + lv.addNetworkCheckEmpty;
    }
    try {
        let obj = parseNetworkJsonForAdd(jsonString);
        let name = obj && obj.blockchainName != null ? String(obj.blockchainName) : "";
        if (name === "") {
            return "\n\n" + lv.addNetworkCheckMissingName;
        }
        // item 3: also show the RPC endpoint the user is about to trust, so a
        // benign-looking network name can't hide a hostile RPC host.
        let details = "\n\n" + lv.addNetworkNewPrefix + name;
        let rpc = obj && obj.rpcEndpoint != null ? String(obj.rpcEndpoint).trim() : "";
        if (rpc !== "") {
            details += "\n" + (lv.addNetworkRpcPrefix || "RPC endpoint : ") + rpc;
        }
        return details;
    } catch (e) {
        return "\n\n" + lv.addNetworkCheckInvalidJson;
    }
}

function addNetwork() {
    let msg = langJson.langValues.addNetworkWarn + buildAddNetworkConfirmDetails();
    showConfirmAndExecuteOnConfirm(msg, checkAndAddNetwork);
}

async function checkAndAddNetwork() {
    try {
        let jsonString = (document.getElementById("txtNetworkJSON").value || "").replace(/^\uFEFF/, "").trim();
        if (jsonString.length < 1) {
            showWarnAlert(langJson.langValues.invalidNetworkJson);
            return;
        }
        await blockchainNetworkAddNew(jsonString);
        await showBlockchainNetworks();

        showAlertAndExecuteOnClose(langJson.langValues.networkAdded, showNetworksScreen);
    }
    catch (error) {
        showWarnAlert(langJson.errors.invalidNetworkJson + " " + error);
    }
}

// ---- Swap releases (burger menu > Releases) ----

async function showReleasesScreen() {
    document.getElementById('gradient').style.height = '116px';
    document.getElementById('login-content').style.display = "none";
    document.getElementById('main-content').style.display = "none";
    document.getElementById('wallets-content').style.display = "none";
    document.getElementById('WalletsScreen').style.display = "none";
    document.getElementById('revealSeedScreen').style.display = "none";
    document.getElementById('backupSpecificWalletScreen').style.display = "none";
    document.getElementById('settingsScreen').style.display = "none";
    document.getElementById('networkListScreen').style.display = "none";
    document.getElementById('networkAddScreen').style.display = "none";
    document.getElementById('divNetworkDropdown').style.display = 'none';

    document.getElementById('settings-content').style.display = "block";
    document.getElementById('releaseListScreen').style.display = "block";
    document.getElementById('releaseAddScreen').style.display = "none";
    await showSwapReleasesTable();
    return false;
}

// Rows are built with createElement/textContent only: name and addresses are
// storage-backed (user-entered) data and must never reach innerHTML.
async function showSwapReleasesTable() {
    let releaseMap = await swapReleasesList();
    let defaultIndex = await swapReleaseGetDefaultIndex();
    let tbody = document.getElementById("tbodyReleaseRow");
    tbody.textContent = "";
    const sortedEntries = [...releaseMap.entries()].sort((a, b) => a[0] - b[0]);
    const lv = (langJson && langJson.langValues) || {};
    for (const [index, releaseItem] of sortedEntries) {
        let tr = document.createElement("tr");

        let tdActive = document.createElement("td");
        tdActive.style.textAlign = "center";
        tdActive.textContent = (index === defaultIndex) ? "\u2713" : "";
        tr.appendChild(tdActive);

        let tdName = document.createElement("td");
        tdName.textContent = releaseItem.name;
        tr.appendChild(tdName);

        for (const addr of [releaseItem.wq, releaseItem.factory, releaseItem.router]) {
            let td = document.createElement("td");
            td.textContent = getShortAddress(String(addr));
            td.title = String(addr);
            tr.appendChild(td);
        }

        let tdUse = document.createElement("td");
        if (index !== defaultIndex) {
            let useLink = document.createElement("a");
            useLink.href = "#";
            useLink.textContent = lv["use"] || "Use";
            useLink.addEventListener("click", (function (idx) {
                return function (ev) {
                    ev.preventDefault();
                    useRelease(idx);
                    return false;
                };
            })(index));
            tdUse.appendChild(useLink);
        }
        tr.appendChild(tdUse);

        tbody.appendChild(tr);
    }
}

// Switch the active release: persist the new default index, reload
// currentSwapRelease + banner, and reset any in-progress swap state so nothing
// quoted under the previous release survives.
async function useRelease(index) {
    try {
        await swapReleaseSetDefaultIndex(index);
        await refreshCurrentSwapRelease();
        resetSwapScreenStateForReleaseChange();
        await showSwapReleasesTable();
    }
    catch (error) {
        showWarnAlert(String((error && error.message) ? error.message : error));
    }
}

function resetSwapScreenStateForReleaseChange() {
    var fromQty = document.getElementById("txtSwapFromQuantity");
    var toQty = document.getElementById("txtSwapToQuantity");
    if (fromQty) fromQty.value = "";
    if (toQty) toQty.value = "";
    updateSwapRoutePathDisplay(null);
}

function showAddReleaseScreen() {
    document.getElementById('releaseListScreen').style.display = "none";
    document.getElementById('releaseAddScreen').style.display = "block";
    document.getElementById('txtReleaseName').value = "";
    document.getElementById('txtReleaseWq').value = "";
    document.getElementById('txtReleaseFactory').value = "";
    document.getElementById('txtReleaseRouter').value = "";
    document.getElementById('txtReleaseName').focus();
    return false;
}

function addRelease() {
    const lv = langJson.langValues;
    let name = (document.getElementById("txtReleaseName").value || "").trim();
    let details = "";
    if (name !== "" && htmlEncode(name) === name && !containsUnsafeDisplayText(name)) {
        details = "\n\n" + (lv.addReleaseNewPrefix || "New release : ") + name;
    }
    let msg = lv.addReleaseWarn + details;
    showConfirmAndExecuteOnConfirm(msg, checkAndAddRelease);
}

async function checkAndAddRelease() {
    try {
        let name = (document.getElementById("txtReleaseName").value || "").trim();
        let wq = (document.getElementById("txtReleaseWq").value || "").trim();
        let factory = (document.getElementById("txtReleaseFactory").value || "").trim();
        let router = (document.getElementById("txtReleaseRouter").value || "").trim();

        await swapReleaseAddNew(name, wq, factory, router);

        showAlertAndExecuteOnClose(langJson.langValues.releaseAdded, showReleasesScreen);
    }
    catch (error) {
        showWarnAlert(langJson.errors.invalidRelease + " " + error);
    }
}

async function refreshAccountBalance() {
    try {
        if (isRefreshingBalance == true) {
            return;
        }
        isRefreshingBalance = true;

        currentWalletTokenList = [];
        currentWalletRecognizedTokens = [];
        currentWalletUnrecognizedTokens = [];
        document.getElementById('divAccountTokens').style.display = 'none';
        document.getElementById('divTokenTabs').style.display = 'none';
        document.getElementById('tbodyAccountTokens').innerHTML = '';
        document.getElementById("divRefreshBalance").style.display = "none";
        document.getElementById("divLoadingBalance").style.display = "block";
        document.getElementById("spnAccountBalance").textContent = "";
        currentAccountDetails = null;
        let accountDetails = await getAccountDetails(currentBlockchainNetwork.scanApiDomain, currentWalletAddress);
        if (accountDetails != null) {
            currentAccountDetails = accountDetails;
            currentBalance = await weiToEtherFormatted(accountDetails.balance);
            document.getElementById("spnAccountBalance").textContent = currentBalance;
            balanceNotificationMap.set(currentWalletAddress.toLowerCase(), currentBalance);
        }

        await refreshTokenList();

        setTimeout(() => {
            document.getElementById("divRefreshBalance").style.display = "block";
            document.getElementById("divLoadingBalance").style.display = "none";
            isRefreshingBalance = false;
        }, "500");
    }
    catch (error) {
        document.getElementById("divRefreshBalance").style.display = "block";
        document.getElementById("divLoadingBalance").style.display = "none";
        isRefreshingBalance = false;
        if (isNetworkError(error)) {
            showWarnAlert(langJson.errors.internetDisconnected);
        } else {
            { console.error(error); showWarnAlert(langJson.errors.invalidApiResponse); }
        }
    }
}

function buildTokenRowsHtml(tokenList) {
    let tbody = "";
    if (tokenList == null) {
        return tbody;
    }

    for (var i = 0; i < tokenList.length; i++) {
        let token = tokenList[i];
        let tokenRow = tokenListRowTemplate;
        let tokenName = token.name;
        let tokenSymbol = token.symbol;
        let tokenShortContractAddress = getShortAddress(token.contractAddress); //contract address is already verified for correctness in api.js listAccountTokens function

        if (tokenName.length > maxTokenNameLength) {
            tokenName = tokenName.substring(0, maxTokenNameLength - 1);
            tokenName = htmlEncode(tokenName) + "<span style='color:green'>...</span>";
        } else {
            tokenName = htmlEncode(tokenName);
        }

        if (tokenSymbol.length > maxTokenSymbolLength) {
            tokenSymbol = tokenSymbol.substring(0, maxTokenSymbolLength - 1);
            tokenSymbol = htmlEncode(tokenSymbol) + "<span style='color:green'>...</span>";
        } else {
            tokenSymbol = htmlEncode(tokenSymbol);
        }

        tokenRow = tokenRow.replace('[TOKEN_SYMBOL]', tokenSymbol);
        tokenRow = tokenRow.replace('[TOKEN_NAME]', tokenName);
        tokenRow = tokenRow.replace('[TOKEN_CONTRACT]', htmlAttrEncode(token.contractAddress));
        tokenRow = tokenRow.replace('[SHORT_CONTRACT]', tokenShortContractAddress);
        tokenRow = tokenRow.replace('[TOKEN_BALANCE]', token.tokenBalance);

        tbody = tbody + tokenRow;
    }

    return tbody;
}

function setTokenTabActiveStyles() {
    let recognizedBtn = document.getElementById('btnTokensRecognized');
    let unrecognizedBtn = document.getElementById('btnTokensUnrecognized');
    if (recognizedBtn == null || unrecognizedBtn == null) {
        return;
    }
    if (showingUnrecognizedTokens === true) {
        recognizedBtn.style.fontWeight = '400';
        recognizedBtn.style.borderBottom = '2px solid transparent';
        unrecognizedBtn.style.fontWeight = '700';
        unrecognizedBtn.style.borderBottom = '2px solid green';
    } else {
        recognizedBtn.style.fontWeight = '700';
        recognizedBtn.style.borderBottom = '2px solid green';
        unrecognizedBtn.style.fontWeight = '400';
        unrecognizedBtn.style.borderBottom = '2px solid transparent';
    }
}

function renderHomeTokenTab() {
    let unionEmpty = currentWalletRecognizedTokens.length === 0 && currentWalletUnrecognizedTokens.length === 0;

    if (unionEmpty === true) {
        document.getElementById('tbodyAccountTokens').innerHTML = "";
        document.getElementById('divTokenTabs').style.display = 'none';
        document.getElementById('divAccountTokens').style.display = 'none';
        return;
    }

    //Auto-switch to the non-empty tab so the user always sees content.
    if (showingUnrecognizedTokens === true && currentWalletUnrecognizedTokens.length === 0 && currentWalletRecognizedTokens.length !== 0) {
        showingUnrecognizedTokens = false;
    } else if (showingUnrecognizedTokens === false && currentWalletRecognizedTokens.length === 0 && currentWalletUnrecognizedTokens.length !== 0) {
        showingUnrecognizedTokens = true;
    }

    let activeList = showingUnrecognizedTokens === true ? currentWalletUnrecognizedTokens : currentWalletRecognizedTokens;
    document.getElementById('tbodyAccountTokens').innerHTML = buildTokenRowsHtml(activeList);
    document.getElementById('divTokenTabs').style.display = '';
    document.getElementById('divAccountTokens').style.display = '';
    setTokenTabActiveStyles();
}

function selectTokenTab(showUnrecognized) {
    showingUnrecognizedTokens = showUnrecognized === true;
    renderHomeTokenTab();
    return false;
}

async function refreshTokenList() {
    //refresh token list/balance
    let tokenListDetails = await listAccountTokens(currentBlockchainNetwork.scanApiDomain, currentWalletAddress, 1); //todo: pagination
    if (tokenListDetails == null || tokenListDetails.tokenList == null || tokenListDetails.tokenList.length === 0) {
        syncSendScreenTokenList();
        return;
    }

    let safeTokenList = [];
    for (var i = 0; i < tokenListDetails.tokenList.length; i++) {
        let token = tokenListDetails.tokenList[i];
        if (htmlEncode(token.name) !== token.name || htmlEncode(token.symbol) !== token.symbol) {
            continue;
        }
        // item 8: drop tokens whose name/symbol carry spoofing Unicode (bidi
        // overrides, zero-width/format chars) used to disguise scam tokens.
        if (containsUnsafeDisplayText(token.name) || containsUnsafeDisplayText(token.symbol)) {
            continue;
        }
        safeTokenList.push(token);
    }

    //Hard-suppress stablecoin impersonators (recognized contracts bypass), then partition.
    let impersonatorFilteredList = filterStablecoinImpersonators(safeTokenList);
    currentWalletRecognizedTokens = [];
    currentWalletUnrecognizedTokens = [];
    for (var j = 0; j < impersonatorFilteredList.length; j++) {
        let token = impersonatorFilteredList[j];
        if (isRecognizedToken(token.contractAddress) === true) {
            currentWalletRecognizedTokens.push(token);
        } else {
            currentWalletUnrecognizedTokens.push(token);
        }
    }

    currentWalletTokenList = currentWalletRecognizedTokens.concat(currentWalletUnrecognizedTokens);
    renderHomeTokenTab();
    syncSendScreenTokenList();
}

async function initRefreshAccountBalanceBackground() {
    if (initAccountBalanceBackgroundStarted == true) {
        return;
    }
    initAccountBalanceBackgroundStarted = true;
    refreshAccountBalanceBackground();
}

async function refreshAccountBalanceBackground() {
    try {
        if (isRefreshingBalance == true) {
            setTimeout(refreshAccountBalanceBackground, 10.0 * 1000);
            return;
        }
        isRefreshingBalance = true;
        currentWalletTokenList = [];
        currentWalletRecognizedTokens = [];
        currentWalletUnrecognizedTokens = [];
        document.getElementById("divRefreshBalance").style.display = "none";
        document.getElementById("divLoadingBalance").style.display = "block";
        currentAccountDetails = null;
        let accountDetails = await getAccountDetails(currentBlockchainNetwork.scanApiDomain, currentWalletAddress);
        if (accountDetails != null) {
            currentAccountDetails = accountDetails;
            let curAddrLower = currentWalletAddress.toLowerCase();
            let newBalance = await weiToEtherFormatted(accountDetails.balance);

            if (currentBalance !== "" && newBalance !== "0" && newBalance !== currentBalance) {
                if (pendingTransactionsMap.has(curAddrLower + currentBlockchainNetwork.index.toString()) || (balanceNotificationMap.has(curAddrLower) && balanceNotificationMap.get(curAddrLower) !== newBalance)) {
                    showBalanceChangeNotification(newBalance);
                    balanceNotificationMap.set(currentWalletAddress.toLowerCase(), newBalance);
                }
            }

            currentBalance = newBalance;
            document.getElementById("spnAccountBalance").textContent = newBalance;
        }
        await refreshTokenList();
        document.getElementById("divRefreshBalance").style.display = "block";
        document.getElementById("divLoadingBalance").style.display = "none";
        isRefreshingBalance = false;
        isFirstTimeAccountRefresh = false;
        setTimeout(refreshAccountBalanceBackground, 10.0 * 1000);
    }
    catch (error) {
        document.getElementById("divRefreshBalance").style.display = "block";
        document.getElementById("divLoadingBalance").style.display = "none";

        let backoffJitterDelay = Math.random() * (60 - 20) + 20;
        setTimeout(refreshAccountBalanceBackground, backoffJitterDelay * 1000);
        isRefreshingBalance = false;

        if (isFirstTimeAccountRefresh == true) { //Show error only when wallet screen displayed first time after the app is opened
            isFirstTimeAccountRefresh = false;
            if (isNetworkError(error)) {
                showWarnAlert(langJson.errors.internetDisconnected);
            } else {
                { console.error(error); showWarnAlert(langJson.errors.invalidApiResponse); }
            }
        }        
    }
}

function toggleTransactionStatus(index) {
    var add_id = "";
    var rem_id = "";
    var transStatus = "";
    if (index == 0) {
        rem_id = "toggle_trans_status_1";
        add_id = "toggle_trans_status_2";
        transStatus = "completed";

        document.getElementById('divCompleted').classList.remove('disabledhide');
        document.getElementById('divPending').classList.add('disabledhide');

        document.getElementById('divPrevTxnList').style.display = "block";
        document.getElementById('divNextTxnList').style.display = "block";
    } else {
        rem_id = "toggle_trans_status_2";
        add_id = "toggle_trans_status_1";

        transStatus = "pending";

        document.getElementById('divCompleted').classList.add('disabledhide');
        document.getElementById('divPending').classList.remove('disabledhide');

        document.getElementById('divPrevTxnList').style.display = "none";
        document.getElementById('divNextTxnList').style.display = "none";
    }
    var add_el = document.getElementById(add_id);
    var rem_el = document.getElementById(rem_id);

    add_el.classList.add('disabled');
    var children = Array.from(add_el.children);

    children.forEach((innerDiv) => {
        innerDiv.classList.add('disabled');
    });

    rem_el.classList.remove('disabled');
    children = Array.from(rem_el.children);

    children.forEach((innerDiv) => {
        innerDiv.classList.remove('disabled');
    });
}

function showBalanceChangeNotification(value) {
    new Notification(langJson.langValues.balanceChanged, { body: value });
    return false;
}

function getTokenBalance(contactAddress) {
    if(currentWalletTokenList == null) { {
        return null;
    }}
    for(let i = 0;i < currentWalletTokenList.length;i++) {
        if(currentWalletTokenList[i].contractAddress === contactAddress) {
            return currentWalletTokenList[i].tokenBalance;
        }
    }
    return null;
}

function getSwapSymbolFromValue(value) {
    if (!value || value === "Q") return "Q";
    if (currentWalletTokenList == null) return "Q";
    for (let i = 0; i < currentWalletTokenList.length; i++) {
        if (currentWalletTokenList[i].contractAddress === value) {
            return currentWalletTokenList[i].symbol || "Q";
        }
    }
    return "Q";
}

async function getSwapBalanceForSymbol(value) {
    if (!value) return "0";
    if (value === "Q" && currentAccountDetails != null) {
        return await weiToEtherFormatted(currentAccountDetails.balance);
    }
    if (currentWalletTokenList == null) return "0";
    for (let i = 0; i < currentWalletTokenList.length; i++) {
        if (currentWalletTokenList[i].contractAddress === value) {
            return currentWalletTokenList[i].tokenBalance || "0";
        }
    }
    return "0";
}

function getSwapContractAddress(value) {
    return (!value || value === "Q") ? zero_address : value;
}

function updateSwapContractLabels() {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var toValue = document.getElementById("ddlSwapToToken").value;
    var showFromContract = fromValue && fromValue !== "Q";
    var showToContract = toValue && toValue !== "Q";
    document.getElementById("divSwapFromContractRow").style.display = showFromContract ? "flex" : "none";
    document.getElementById("divSwapToContractRow").style.display = showToContract ? "flex" : "none";
    var explorerBase = currentBlockchainNetwork ? BLOCK_EXPLORER_ACCOUNT_TEMPLATE.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain) : "";
    if (showFromContract) {
        var fromAddr = fromValue;
        document.getElementById("aSwapFromContract").textContent = fromAddr;
        document.getElementById("aSwapFromContract").setAttribute("data-contract-address", fromAddr);
        document.getElementById("aSwapFromContract").href = explorerBase.replace(ADDRESS_TEMPLATE, fromAddr);
    }
    if (showToContract) {
        var toAddr = toValue;
        document.getElementById("aSwapToContract").textContent = toAddr;
        document.getElementById("aSwapToContract").setAttribute("data-contract-address", toAddr);
        document.getElementById("aSwapToContract").href = explorerBase.replace(ADDRESS_TEMPLATE, toAddr);
    }
}

async function openSwapFromContractInExplorer() {
    var addr = document.getElementById("aSwapFromContract").getAttribute("data-contract-address") || getSwapContractAddress(document.getElementById("ddlSwapFromToken").value);
    var url = BLOCK_EXPLORER_ACCOUNT_TEMPLATE.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain).replace(ADDRESS_TEMPLATE, addr);
    await OpenUrl(url);
}

async function openSwapToContractInExplorer() {
    var addr = document.getElementById("aSwapToContract").getAttribute("data-contract-address") || getSwapContractAddress(document.getElementById("ddlSwapToToken").value);
    var url = BLOCK_EXPLORER_ACCOUNT_TEMPLATE.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain).replace(ADDRESS_TEMPLATE, addr);
    await OpenUrl(url);
}

async function copySwapFromContractAddress() {
    var addr = getSwapContractAddress(document.getElementById("ddlSwapFromToken").value);
    await WriteTextToClipboard(addr);
}

async function copySwapToContractAddress() {
    var addr = getSwapContractAddress(document.getElementById("ddlSwapToToken").value);
    await WriteTextToClipboard(addr);
}

function formatTokenAmount(weiStr, decimals) {
    if (!weiStr || String(weiStr).trim() === "" || weiStr === "0") return "0";
    var d = Math.max(0, parseInt(decimals, 10) || 18);
    var div = Math.pow(10, d);
    var big = BigInt(String(weiStr).trim());
    var divBig = BigInt(div);
    var intPart = big / divBig;
    var fracPart = big % divBig;
    var fracStr = fracPart.toString().padStart(d, "0").replace(/0+$/, "");
    if (fracStr === "") return intPart.toString();
    return intPart.toString() + "." + fracStr;
}

async function updateSwapFromAllowanceDisplay() {
    var row = document.getElementById("divSwapFromAllowanceRow");
    var span = document.getElementById("spanSwapFromAllowance");
    if (!row || !span) return;
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    if (!fromValue || !currentBlockchainNetwork) {
        row.style.display = "none";
        return;
    }
    try {
        var allowancePayload = applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            fromTokenValue: fromValue,
            ownerAddress: currentWalletAddress,
            requiredAmount: "0",
            fromDecimals: getSwapTokenDecimals(fromValue)
        });
        var result = await getSwapCheckAllowance(allowancePayload);
        if (!result || !result.success || !result.allowance) {
            row.style.display = "none";
            return;
        }
        var allowanceWei = String(result.allowance).trim();
        if (allowanceWei === "" || allowanceWei === "0" || BigInt(allowanceWei) === BigInt(0)) {
            row.style.display = "none";
            return;
        }
        var decimals = getSwapTokenDecimals(fromValue);
        span.textContent = formatTokenAmount(allowanceWei, decimals);
        row.style.display = "block";
    } catch (e) {
        row.style.display = "none";
    }
}

async function updateSwapBalanceLabels() {
    var fromSymbol = document.getElementById("ddlSwapFromToken").value;
    var toSymbol = document.getElementById("ddlSwapToToken").value;
    var fromBal = await getSwapBalanceForSymbol(fromSymbol);
    var toBal = await getSwapBalanceForSymbol(toSymbol);
    document.getElementById("spanSwapFromBalance").textContent = fromBal;
    document.getElementById("spanSwapToBalance").textContent = toBal;
    updateSwapContractLabels();
    await updateSwapFromAllowanceDisplay();
}

function normalizeAmountForNumberInput(value) {
    if (value == null || value === "") return "";
    return String(value).replace(/,/g, "").trim();
}

function setSwapFromQuantityToBalance() {
    (async function () {
        var fromSymbol = document.getElementById("ddlSwapFromToken").value;
        var bal = await getSwapBalanceForSymbol(fromSymbol);
        document.getElementById("txtSwapFromQuantity").value = normalizeAmountForNumberInput(bal);
        updateToQuantityFromFrom();
    })();
    return false;
}

function setSwapToQuantityToBalance() {
    (async function () {
        var toSymbol = document.getElementById("ddlSwapToToken").value;
        var bal = await getSwapBalanceForSymbol(toSymbol);
        document.getElementById("txtSwapToQuantity").value = normalizeAmountForNumberInput(bal);
        updateFromQuantityFromTo();
    })();
    return false;
}

async function showTransactionsScreen() {
    document.getElementById('HomeScreen').style.display = 'none';
    document.getElementById('TransactionsScreen').style.display = 'block';
    document.getElementById('gradient').style.height = '116px';

    document.getElementById('divPrevTxnList').style.display = "block";
    document.getElementById('divNextTxnList').style.display = "block";

    document.getElementById('tbodyComplextedTransactions').innerHTML = '';
    currentTxnPageIndex = 0;
    await refreshTransactionList();

    return false;
}

function showSwapScreen() {
    showYesNoConfirm(langJson.langValues.swapEarlyPhaseWarn, function () {
        openSwapScreen();
    });
    return false;
}

function getSwapDropdownDisplayText(tokenName, tokenSymbol, contractAddress) {
    var namePart = (tokenName || "").substring(0, 25);
    var symbolPart = (tokenSymbol || "").substring(0, 6);
    if (!contractAddress || contractAddress === zero_address) {
        return namePart + " (" + symbolPart + ")";
    }
    var addr = contractAddress;
    var addrPart = addr.length >= 10 ? addr.substring(0, 5) + "..." + addr.slice(-5) : addr;
    return namePart + " (" + symbolPart + ") " + addrPart;
}

function getSwapTokenListFromWallet() {
    var list = [];
    if (SWAP_SHOW_NATIVE_COIN) {
        list.push({ value: "Q", displayText: QuantumCoin + " (Q)" });
    }
    if (currentWalletTokenList != null && currentWalletTokenList.length > 0) {
        for (var i = 0; i < currentWalletTokenList.length; i++) {
            var t = currentWalletTokenList[i];
            if (!t.symbol || !t.name || !t.contractAddress) continue;
            if (htmlEncode(t.name) !== t.name || htmlEncode(t.symbol) !== t.symbol) continue;
            // item 8: exclude tokens with spoofing Unicode in name/symbol.
            if (containsUnsafeDisplayText(t.name) || containsUnsafeDisplayText(t.symbol)) continue;
            if (!SWAP_SHOW_NATIVE_COIN && typeof HEISEN_CONTRACT_ADDRESS !== "undefined" && (t.contractAddress || "").toLowerCase() === (HEISEN_CONTRACT_ADDRESS || "").toLowerCase()) continue;
            list.push({
                value: t.contractAddress,
                displayText: getSwapDropdownDisplayText(t.name, t.symbol, t.contractAddress)
            });
        }
    }
    return list;
}

function populateSwapTokenDropdowns() {
    var swapTokenList = getSwapTokenListFromWallet();
    var ddlFrom = document.getElementById("ddlSwapFromToken");
    var ddlTo = document.getElementById("ddlSwapToToken");
    removeOptions(ddlFrom);
    removeOptions(ddlTo);
    var selectTokenText = (langJson && langJson.langValues && langJson.langValues["select-token"]) ? langJson.langValues["select-token"] : "Select token";
    var optFromPlaceholder = document.createElement("option");
    optFromPlaceholder.value = "";
    optFromPlaceholder.text = selectTokenText;
    ddlFrom.add(optFromPlaceholder);
    var optToPlaceholder = document.createElement("option");
    optToPlaceholder.value = "";
    optToPlaceholder.text = selectTokenText;
    ddlTo.add(optToPlaceholder);
    for (var i = 0; i < swapTokenList.length; i++) {
        var optFrom = document.createElement("option");
        optFrom.text = swapTokenList[i].displayText;
        optFrom.value = swapTokenList[i].value;
        ddlFrom.add(optFrom);
        var optTo = document.createElement("option");
        optTo.text = swapTokenList[i].displayText;
        optTo.value = swapTokenList[i].value;
        ddlTo.add(optTo);
    }
    ddlFrom.selectedIndex = 0;
    ddlTo.selectedIndex = 0;
    updateSwapTokenSymbolCache();
}

function updateSwapTokenSymbolCache() {
    swapTokenSymbolCache = { "Q": "Q" };
    if (currentWalletTokenList != null) {
        for (var i = 0; i < currentWalletTokenList.length; i++) {
            var t = currentWalletTokenList[i];
            if (t.contractAddress && t.symbol) swapTokenSymbolCache[t.contractAddress] = t.symbol;
        }
    }
}

function getSwapCachedSymbol(value) {
    if (!value || value === "Q") return "Q";
    return swapTokenSymbolCache[value] != null ? swapTokenSymbolCache[value] : getSwapSymbolFromValue(value);
}

// Stamp the active release's contract addresses onto a swap bridge payload
// (releaseWq / releaseFactory / releaseRouter). The chain handlers fall back to
// the built-in release when the fields are absent, so a not-yet-loaded
// currentSwapRelease is safe. Returns the payload for chaining.
function applySwapReleaseToPayload(payload) {
    if (!payload) return payload;
    if (currentSwapRelease != null) {
        payload.releaseWq = currentSwapRelease.wq;
        payload.releaseFactory = currentSwapRelease.factory;
        payload.releaseRouter = currentSwapRelease.router;
    }
    return payload;
}

// ---- Multi-hop swap route display ----
// Current route as returned by the route check: array of { address, symbol }.
var swapCurrentRoute = null;
var SWAP_ROUTE_SYMBOL_MAX_LENGTH = 12;

// Display text for one route token. Prefers the wallet's own (already filtered)
// symbol; otherwise the on-chain symbol returned by the route check. Both are
// untrusted, so the value is length-capped and rejected when it contains
// HTML-special or spoofing Unicode characters; the fallback is the shortened
// contract address. Rendered via textContent only (never innerHTML).
function getSwapRouteDisplaySymbol(address, symbol) {
    var addrLower = String(address || "").toLowerCase();
    var candidate = null;
    if (currentWalletTokenList != null) {
        for (var i = 0; i < currentWalletTokenList.length; i++) {
            var t = currentWalletTokenList[i];
            if (t.contractAddress && String(t.contractAddress).toLowerCase() === addrLower && t.symbol) {
                candidate = t.symbol;
                break;
            }
        }
    }
    if (candidate == null && symbol != null) candidate = symbol;
    if (candidate != null) {
        var s = String(candidate).substring(0, SWAP_ROUTE_SYMBOL_MAX_LENGTH).trim();
        if (s !== "" && htmlEncode(s) === s && !containsUnsafeDisplayText(s)) {
            return s;
        }
    }
    var addr = String(address || "");
    return addr.length >= 12 ? addr.substring(0, 6) + "..." + addr.slice(-4) : addr;
}

function updateSwapRoutePathDisplay(route) {
    swapCurrentRoute = (route && route.length >= 2) ? route : null;
    var container = document.getElementById("divSwapRoutePath");
    var span = document.getElementById("spanSwapRoutePath");
    if (!container || !span) return;
    if (!swapCurrentRoute) {
        span.textContent = "";
        container.style.display = "none";
        return;
    }
    var parts = [];
    for (var i = 0; i < swapCurrentRoute.length; i++) {
        parts.push(getSwapRouteDisplaySymbol(swapCurrentRoute[i].address, swapCurrentRoute[i].symbol));
    }
    span.textContent = parts.join(" -> ");
    container.style.display = "block";
}

// Build the { address, symbol } route list from a SwapQuoteCheckPairExists result.
function buildSwapRouteFromCheckResult(result) {
    if (!result || result.exists !== true || !result.path || result.path.length < 2) return null;
    var route = [];
    for (var i = 0; i < result.path.length; i++) {
        route.push({
            address: result.path[i],
            symbol: (result.pathSymbols && result.pathSymbols[i] != null) ? result.pathSymbols[i] : null
        });
    }
    return route;
}

var swapQuantityUpdating = false;
var swapQuoteFromDebounceId = null;
var swapLastChanged = 'from'; // 'from' | 'to' - which quantity the user last edited
var swapQuoteToDebounceId = null;
var SWAP_QUOTE_DEBOUNCE_MS = 400;

function getSwapTokenDecimals(value) {
    if (!value || value === "Q") return 18;
    if (currentWalletTokenList != null) {
        for (var i = 0; i < currentWalletTokenList.length; i++) {
            if (currentWalletTokenList[i].contractAddress === value && currentWalletTokenList[i].decimals != null) {
                return currentWalletTokenList[i].decimals;
            }
        }
    }
    return 18;
}

function getSwapRate(fromValue, toValue) {
    var fromSymbol = getSwapSymbolFromValue(fromValue);
    var toSymbol = getSwapSymbolFromValue(toValue);
    if (fromSymbol === toSymbol) return 1;
    var rates = {
        "Q": { "Y2Q": 2, "hei": 1.5, "DP": 0.8, "USDT": 0.1, "ETH": 0.00005, "WBTC": 0.000002 },
        "Y2Q": { "Q": 0.5, "hei": 0.75, "DP": 0.4, "USDT": 0.05, "ETH": 0.000025, "WBTC": 0.000001 },
        "hei": { "Q": 0.67, "Y2Q": 1.33, "DP": 0.53, "USDT": 0.067, "ETH": 0.000033, "WBTC": 0.0000013 },
        "DP": { "Q": 1.25, "Y2Q": 2.5, "hei": 1.9, "USDT": 0.125, "ETH": 0.0000625, "WBTC": 0.0000025 },
        "USDT": { "Q": 10, "Y2Q": 20, "hei": 15, "DP": 8, "ETH": 0.0005, "WBTC": 0.00002 },
        "ETH": { "Q": 20000, "Y2Q": 40000, "hei": 30000, "DP": 16000, "USDT": 2000, "WBTC": 40 },
        "WBTC": { "Q": 500000, "Y2Q": 1000000, "hei": 750000, "DP": 400000, "USDT": 50000, "ETH": 0.025 }
    };
    var fromRates = rates[fromSymbol];
    if (fromRates && fromRates[toSymbol] != null) return fromRates[toSymbol];
    return 1;
}

function showSwapQuoteLoading(show) {
    var el = document.getElementById("divSwapQuoteLoading");
    if (el) el.style.display = show ? "block" : "none";
}

async function updateToQuantityFromFrom() {
    if (swapQuantityUpdating) return;
    swapLastChanged = 'from';
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var toValue = document.getElementById("ddlSwapToToken").value;
    var fromQtyStr = (document.getElementById("txtSwapFromQuantity").value || "").trim();
    var fromQty = parseFloat(fromQtyStr);

    if (!fromQtyStr || isNaN(fromQty) || fromQty < 0) {
        document.getElementById("txtSwapToQuantity").value = "";
        return;
    }
    if (!fromValue || !toValue || fromValue === toValue) {
        document.getElementById("txtSwapToQuantity").value = "";
        return;
    }
    if (!currentBlockchainNetwork) return;

    swapQuantityUpdating = true;
    showSwapQuoteLoading(true);
    try {
        var payload = applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10) || 123123,
            amountIn: fromQtyStr,
            fromTokenValue: fromValue,
            toTokenValue: toValue,
            fromDecimals: getSwapTokenDecimals(fromValue),
            toDecimals: getSwapTokenDecimals(toValue)
        });
        var result = await getSwapQuoteAmountsOut(payload);
        if (result && result.success && result.amountOut != null) {
            var outStr = String(result.amountOut).replace(/\.?0+$/, "") || result.amountOut;
            document.getElementById("txtSwapToQuantity").value = outStr;
        } else {
            document.getElementById("txtSwapToQuantity").value = "";
            if (result && !result.success && result.error) {
                showWarnAlert(result.error);
            }
        }
    } catch (e) {
        document.getElementById("txtSwapToQuantity").value = "";
        showWarnAlert((e && e.message) ? e.message : String(e));
    } finally {
        showSwapQuoteLoading(false);
        swapQuantityUpdating = false;
    }
}

function debouncedUpdateToQuantityFromFrom() {
    if (swapQuoteFromDebounceId != null) clearTimeout(swapQuoteFromDebounceId);
    swapQuoteFromDebounceId = setTimeout(function () {
        swapQuoteFromDebounceId = null;
        updateToQuantityFromFrom();
    }, SWAP_QUOTE_DEBOUNCE_MS);
}

async function updateFromQuantityFromTo() {
    if (swapQuantityUpdating) return;
    swapLastChanged = 'to';
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var toValue = document.getElementById("ddlSwapToToken").value;
    var toQtyStr = (document.getElementById("txtSwapToQuantity").value || "").trim();
    var toQty = parseFloat(toQtyStr);

    if (!toQtyStr || isNaN(toQty) || toQty < 0) {
        document.getElementById("txtSwapFromQuantity").value = "";
        return;
    }
    if (!fromValue || !toValue || fromValue === toValue) {
        document.getElementById("txtSwapFromQuantity").value = "";
        return;
    }
    if (!currentBlockchainNetwork) return;

    swapQuantityUpdating = true;
    showSwapQuoteLoading(true);
    try {
        var payload = applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            amountOut: toQtyStr,
            fromTokenValue: fromValue,
            toTokenValue: toValue,
            fromDecimals: getSwapTokenDecimals(fromValue),
            toDecimals: getSwapTokenDecimals(toValue)
        });
        var result = await getSwapQuoteAmountsIn(payload);
        if (result && result.success && result.amountIn != null) {
            var inStr = String(result.amountIn).replace(/\.?0+$/, "") || result.amountIn;
            document.getElementById("txtSwapFromQuantity").value = inStr;
        } else {
            document.getElementById("txtSwapFromQuantity").value = "";
            if (result && !result.success && result.error) {
                showWarnAlert(result.error);
            }
        }
    } catch (e) {
        document.getElementById("txtSwapFromQuantity").value = "";
        showWarnAlert((e && e.message) ? e.message : String(e));
    } finally {
        showSwapQuoteLoading(false);
        swapQuantityUpdating = false;
    }
}

function debouncedUpdateFromQuantityFromTo() {
    if (swapQuoteToDebounceId != null) clearTimeout(swapQuoteToDebounceId);
    swapQuoteToDebounceId = setTimeout(function () {
        swapQuoteToDebounceId = null;
        updateFromQuantityFromTo();
    }, SWAP_QUOTE_DEBOUNCE_MS);
}

async function updateSwapScreenInfo() {
    // Runs when either "from" or "to" token dropdown is changed. Find a swap route
    // (direct pair or multi-hop) and show an error when no route exists.
    document.getElementById("txtSwapFromQuantity").value = "";
    document.getElementById("txtSwapToQuantity").value = "";
    updateSwapRoutePathDisplay(null);
    updateSwapBalanceLabels();
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var toValue = document.getElementById("ddlSwapToToken").value;
    if (!fromValue || !toValue || fromValue === toValue) {
        return false;
    }
    if (!currentBlockchainNetwork) return false;
    var pairExists = false;
    try {
        var payload = applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10) || 123123,
            fromTokenValue: fromValue,
            toTokenValue: toValue
        });
        var result = await getSwapCheckPairExists(payload);
        pairExists = result && result.exists === true;
        if (pairExists) {
            updateSwapRoutePathDisplay(buildSwapRouteFromCheckResult(result));
        } else {
            if (result && result.error) {
                showWarnAlert(result.error);
            } else {
                showWarnAlert((langJson && langJson.langValues && langJson.langValues["swap-no-pair"]) || "No swap route exists between these two tokens (max 3 hops)");
            }
            document.getElementById("txtSwapToQuantity").value = "";
        }
    } catch (e) {
        showWarnAlert((e && e.message) ? e.message : String(e));
        document.getElementById("txtSwapToQuantity").value = "";
    }
    if (pairExists) {
        updateToQuantityFromFrom();
    }
    resetCurrentGasConfig();
    setGasFeeLabel("spanSwapGasFee", "");
    scheduleSwapExecuteGasEstimation("divSwapGasIcon", "spanSwapGasFee");
    return false;
}

function openSwapScreen() {
    document.getElementById('divNetworkDropdown').style.display = 'none';
    document.getElementById('HomeScreen').style.display = 'none';
    document.getElementById('SendScreen').style.display = 'none';
    document.getElementById('SwapScreen').style.display = 'block';
    document.getElementById('ReceiveScreen').style.display = 'none';
    document.getElementById('TransactionsScreen').style.display = 'none';
    document.getElementById('gradient').style.height = '116px';

    document.getElementById("divSwapScreenInner").style.display = "block";
    document.getElementById("divSwapConfirmPanel").style.display = "none";
    document.getElementById("divSwapRemoveAllowancePanel").style.display = "none";
    document.getElementById("divSwapAddAllowancePanel").style.display = "none";
    populateSwapTokenDropdowns();
    document.getElementById("txtSwapFromQuantity").value = "";
    document.getElementById("txtSwapToQuantity").value = "";
    updateSwapRoutePathDisplay(null);
    document.getElementById("txtSwapFromQuantity").focus();
    updateSwapBalanceLabels();
    resetCurrentGasConfig();
    setGasFeeLabel("spanSwapGasFee", "");
    attachSwapGasListeners();
    scheduleSwapExecuteGasEstimation("divSwapGasIcon", "spanSwapGasFee");
    return false;
}

function attachSwapGasListeners() {
    var fromQty = document.getElementById("txtSwapFromQuantity");
    var toQty = document.getElementById("txtSwapToQuantity");
    if (fromQty && !fromQty.dataset.gasBound) { fromQty.addEventListener("input", function () { scheduleSwapExecuteGasEstimation("divSwapGasIcon", "spanSwapGasFee"); }); fromQty.dataset.gasBound = "1"; }
    if (toQty && !toQty.dataset.gasBound) { toQty.addEventListener("input", function () { scheduleSwapExecuteGasEstimation("divSwapGasIcon", "spanSwapGasFee"); }); toQty.dataset.gasBound = "1"; }
}

var SWAP_GAS_FEE_RATE = 1000 / 21000;
var SWAP_GAS_HIGH_THRESHOLD = 300000;
var SWAP_SHOW_NATIVE_COIN = false;

// ---- Common gas configuration constants & helpers ----
var GAS_ESTIMATE_BUFFER_PERCENT = 10;
var GAS_NO_BUFFER_PERCENT = 0;
var GAS_ESTIMATE_DEBOUNCE_MS = 2000;
var GAS_FEE_DECIMALS = 4;
var GAS_FEE_UNIT_LABEL = "Q";
// Wallet key type is derived from the public key byte length and drives gas-price
// selection in provider.getFeeData(keyType, fullSign). 3 = HYBRIDEDMLDSASLHDSA, 5 = HYBRIDEDMLDSASLHDSA5.
var WALLET_KEY_TYPE_3 = 3;
var WALLET_KEY_TYPE_5 = 5;
var PUBLIC_KEY_LENGTH_KEYTYPE3 = 1408;
var PUBLIC_KEY_LENGTH_KEYTYPE5 = 2688;
var DEFAULT_WALLET_KEY_TYPE = WALLET_KEY_TYPE_3;

// Derive the current wallet's key type from its public key (base64). The public key
// is held in memory after login (currentWallet.publicKey), so this needs no password.
function getWalletKeyType() {
    try {
        var pubB64 = (currentWallet && currentWallet.publicKey) ? currentWallet.publicKey : null;
        if (!pubB64) return DEFAULT_WALLET_KEY_TYPE;
        var bytes = base64ToBytes(pubB64);
        var len = (bytes && bytes.length) ? bytes.length : 0;
        if (len === PUBLIC_KEY_LENGTH_KEYTYPE5) return WALLET_KEY_TYPE_5;
        if (len === PUBLIC_KEY_LENGTH_KEYTYPE3) return WALLET_KEY_TYPE_3;
        return DEFAULT_WALLET_KEY_TYPE;
    } catch (e) {
        return DEFAULT_WALLET_KEY_TYPE;
    }
}

// Per-screen current gas state. Reset on screen open. `overridden` is true once the
// user edits values via the Gas dialog; the label is then not refetched until the
// transaction context changes again.
// item 5: gasPriceWei pins the exact per-gas-unit price behind the displayed fee
// so the signed tx uses the price the user reviewed (not one re-fetched at submit).
var currentGasConfig = { gasLimit: null, gasFee: null, gasPriceWei: null, overridden: false };
var gasEstimateTimerId = null;
var gasEstimateToken = 0;

// Additional gas-state objects for the swap sub-flows (approve/remove/add use their
// own context so they don't clash with the swap-execute estimate).
var swapApproveGasState = { gasLimit: null, gasFee: null, gasPriceWei: null, overridden: false };

// item 5: derive a decimal-wei per-gas-unit price from a displayed fee (coins) and
// gas limit, for the cases where the node didn't return an exact price (user
// override / RPC fallback). Returns null when it can't be computed.
function computeGasPriceWei(gasFeeEth, gasLimit) {
    var fee = parseFloat(gasFeeEth);
    var gl = parseFloat(gasLimit);
    if (isNaN(fee) || isNaN(gl) || gl <= 0) return null;
    var wei = Math.round((fee * 1e18) / gl);
    if (!isFinite(wei) || wei < 0) return null;
    return String(wei);
}

// Format the gas fee as a number string with no trailing zeros (LSB only).
// Decimals are shown only when present: 110 -> "110", 0.5 -> "0.5", 0.0476 -> "0.0476".
function formatGasFeeNumber(value) {
    var n = parseFloat(value);
    if (isNaN(n)) n = 0;
    var s = n.toFixed(GAS_FEE_DECIMALS);
    if (s.indexOf(".") >= 0) {
        s = s.replace(/0+$/, "");
        if (s.slice(-1) === ".") s = s.slice(0, -1);
    }
    return s;
}

function formatGasFeeQ(value) {
    return formatGasFeeNumber(value) + " " + GAS_FEE_UNIT_LABEL;
}

function setGasFeeLabel(labelId, feeValue) {
    var el = document.getElementById(labelId);
    if (!el) return;
    if (feeValue == null || feeValue === "") {
        el.textContent = "";
        return;
    }
    el.textContent = formatGasFeeQ(feeValue);
}

function setGasIconPulse(iconId, pulsing) {
    var el = document.getElementById(iconId);
    if (!el) return;
    if (pulsing) {
        el.classList.add("gas-pulse");
    } else {
        el.classList.remove("gas-pulse");
    }
}

function resetCurrentGasConfig(state) {
    var s = state || currentGasConfig;
    s.gasLimit = null;
    s.gasFee = null;
    s.gasPriceWei = null;
    s.overridden = false;
    if (gasEstimateTimerId) { clearTimeout(gasEstimateTimerId); gasEstimateTimerId = null; }
    gasEstimateToken++;
    s._token = gasEstimateToken;
}

// Compute the default gas config from a hardcoded gas-limit constant.
function applyDefaultGasConfig(defaultGasLimit, labelId, state) {
    var s = state || currentGasConfig;
    var gasLimit = defaultGasLimit;
    var gasFee = (gasLimit * SWAP_GAS_FEE_RATE);
    s.gasLimit = String(gasLimit);
    s.gasFee = String(gasFee);
    s.gasPriceWei = computeGasPriceWei(gasFee, gasLimit);
    s.overridden = false;
    if (labelId) setGasFeeLabel(labelId, gasFee);
}

// Build the estimateGas IPC payload for a given tx context.
// `ctx` is provided by the calling screen and must include txKind + the relevant fields.
function buildEstimateGasPayload(ctx) {
    if (!currentBlockchainNetwork) return null;
    var payload = {
        rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
        chainId: parseInt(currentBlockchainNetwork.networkId, 10),
        txKind: ctx.txKind,
        fromAddress: currentWalletAddress
    };
    if (ctx.toAddress) payload.toAddress = ctx.toAddress;
    if (ctx.amount != null) payload.amount = ctx.amount;
    if (ctx.contractAddress) payload.contractAddress = ctx.contractAddress;
    if (ctx.fromDecimals != null) payload.fromDecimals = ctx.fromDecimals;
    if (ctx.fromTokenValue) payload.fromTokenValue = ctx.fromTokenValue;
    if (ctx.toTokenValue) payload.toTokenValue = ctx.toTokenValue;
    if (ctx.amountIn != null) payload.amountIn = ctx.amountIn;
    if (ctx.amountOut != null) payload.amountOut = ctx.amountOut;
    if (ctx.lastChanged) payload.lastChanged = ctx.lastChanged;
    if (ctx.slippagePercent != null) payload.slippagePercent = ctx.slippagePercent;
    if (ctx.recipientAddress) payload.recipientAddress = ctx.recipientAddress;
    if (ctx.methodArgs) payload.methodArgs = ctx.methodArgs;
    if (ctx.value != null) payload.value = ctx.value;
    if (ctx.bufferPercent != null) payload.bufferPercent = ctx.bufferPercent;
    // Swap-family estimates run against the active release's contracts.
    if (ctx.txKind === "swap" || ctx.txKind === "approve") applySwapReleaseToPayload(payload);
    return payload;
}

// Schedule a debounced gas estimation. `ctxProvider` returns the tx context (or null to skip),
// `iconId`/`labelId` identify the UI elements. `state` is the gas-state object to update
// (defaults to the global currentGasConfig).
// `onRpcError` (optional) is invoked once if the network gas-price lookup fails (RPC error).
function scheduleGasEstimation(ctxProvider, iconId, labelId, state, onRpcError) {
    var s = state || currentGasConfig;
    if (gasEstimateTimerId) { clearTimeout(gasEstimateTimerId); gasEstimateTimerId = null; }
    gasEstimateToken++;
    s._token = gasEstimateToken;
    if (!s.overridden) {
        setGasIconPulse(iconId, true);
        if (labelId) setGasFeeLabel(labelId, "");
    }
    gasEstimateTimerId = setTimeout(function () {
        gasEstimateTimerId = null;
        runGasEstimation(ctxProvider, iconId, labelId, state, onRpcError);
    }, GAS_ESTIMATE_DEBOUNCE_MS);
}

async function runGasEstimation(ctxProvider, iconId, labelId, state, onRpcError) {
    var s = state || currentGasConfig;
    var myToken = s._token;
    var ctx = (typeof ctxProvider === "function") ? ctxProvider() : ctxProvider;
    if (!ctx || !ctx.txKind || !currentBlockchainNetwork) {
        if (labelId) setGasFeeLabel(labelId, "");
        setGasIconPulse(iconId, false);
        s.gasLimit = null;
        s.gasFee = null;
        s.overridden = false;
        return;
    }

    if (s.overridden) {
        // User has manually overridden; keep their values until context actually changes.
        if (labelId) setGasFeeLabel(labelId, s.gasFee);
        setGasIconPulse(iconId, false);
        return;
    }

    var payload = buildEstimateGasPayload(ctx);
    if (!payload) return;

    setGasIconPulse(iconId, true);
    if (labelId) setGasFeeLabel(labelId, "");

    // Track whether any RPC call failed and the (sanitized at render time) error detail,
    // so the caller can surface a transient toast.
    var rpcError = false;
    var rpcErrorMessage = null;

    var gasLimit = null;
    try {
        var est = await estimateGas(payload);
        if (myToken !== s._token) { setGasIconPulse(iconId, false); return; }
        if (est && est.success && est.gasLimit) {
            gasLimit = est.gasLimit;
        } else {
            rpcError = true;
            if (est && est.error) rpcErrorMessage = est.error;
        }
    } catch (e) {
        rpcError = true;
        rpcErrorMessage = (e && e.message) ? e.message : String(e);
    }

    if (gasLimit == null) {
        // estimateGas failed: fall back to the hardcoded default gas limit.
        gasLimit = ctx.defaultGasLimit ? String(ctx.defaultGasLimit) : null;
        if (gasLimit == null) {
            setGasIconPulse(iconId, false);
            if (rpcError && typeof onRpcError === "function") { onRpcError(rpcErrorMessage); }
            return;
        }
    }

    // Now compute the fee separately via getFeeData(keyType, fullSign).
    var fullSign = await advancedSigningGetDefaultValue();
    var keyType = getWalletKeyType();
    var gasFee = null;
    var gasPriceWei = null; // item 5: exact per-gas-unit price from the node, when available
    try {
        var feeRes = await estimateGasFee({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            gasLimit: gasLimit,
            keyType: keyType,
            fullSign: fullSign === true
        });
        if (myToken !== s._token) { setGasIconPulse(iconId, false); return; }
        if (feeRes && feeRes.success && feeRes.gasFeeEth != null) {
            gasFee = feeRes.gasFeeEth;
            if (feeRes.gasPriceWei != null) gasPriceWei = String(feeRes.gasPriceWei);
            if (feeRes.usedFallback === true) {
                rpcError = true;
                if (feeRes.error) rpcErrorMessage = feeRes.error;
            }
        } else {
            rpcError = true;
            if (feeRes && feeRes.error) rpcErrorMessage = feeRes.error;
        }
    } catch (e) {
        rpcError = true;
        rpcErrorMessage = (e && e.message) ? e.message : String(e);
    }

    if (gasFee == null) {
        // Network fee lookup failed: use the current default rate.
        gasFee = (Number(gasLimit) * SWAP_GAS_FEE_RATE);
        rpcError = true;
    }

    if (myToken === s._token && !s.overridden) {
        s.gasLimit = String(gasLimit);
        s.gasFee = String(gasFee);
        // item 5: prefer the node's exact price; else derive from the shown fee.
        s.gasPriceWei = (gasPriceWei != null) ? gasPriceWei : computeGasPriceWei(gasFee, gasLimit);
        s.overridden = false;
        if (labelId) setGasFeeLabel(labelId, s.gasFee);
        setGasIconPulse(iconId, false);
        if (rpcError && typeof onRpcError === "function") {
            onRpcError(rpcErrorMessage);
        }
    }
}

// Open the Gas config dialog prefilled with the current values; on OK, override.
// `ctxProvider` (optional) is used to gate the default pre-apply: the default
// fee is only applied when the tx context is valid (inputs present), so no fee is
// shown before the required quantity/inputs have been entered.
function onGasIconClick(labelId, state, ctxProvider) {
    var s = state || currentGasConfig;
    if (s.gasLimit == null && typeof ctxProvider === "function") {
        var ctx = ctxProvider();
        if (ctx && ctx.txKind && ctx.defaultGasLimit) {
            applyDefaultGasConfig(ctx.defaultGasLimit, labelId, state);
        }
    }
    showGasConfigDialog({
        gasLimit: s.gasLimit != null ? s.gasLimit : "",
        gasFee: s.gasFee != null ? formatGasFeeNumber(s.gasFee) : "",
        onOk: function (result) {
            // Invalidate any pending/in-flight estimation so its async result can't
            // overwrite this manual override (which would silently reset overridden
            // to false and submit the auto-estimated gas instead of the user's value).
            if (gasEstimateTimerId) { clearTimeout(gasEstimateTimerId); gasEstimateTimerId = null; }
            gasEstimateToken++;
            s._token = gasEstimateToken;
            s.gasLimit = String(result.gasLimit);
            s.gasFee = String(result.gasFee);
            // item 5: pin the price implied by the user's edited fee + limit.
            s.gasPriceWei = computeGasPriceWei(result.gasFee, result.gasLimit);
            s.overridden = true;
            if (labelId) setGasFeeLabel(labelId, s.gasFee);
        }
    });
    return false;
}

// Resolve the gas limit + fee to use for submission/review, falling back to defaults.
// item 5: also returns gasPriceWei (the pinned per-gas-unit price) so submit
// payloads can forward it to the signer.
function resolveGasForTx(defaultGasLimit, state) {
    var s = state || currentGasConfig;
    if (s.gasLimit != null && s.gasLimit !== "") {
        var gl = parseInt(s.gasLimit, 10);
        if (!isNaN(gl) && gl > 0) {
            var fee = s.gasFee != null ? s.gasFee : (gl * SWAP_GAS_FEE_RATE);
            var priceWei = (s.gasPriceWei != null) ? s.gasPriceWei : computeGasPriceWei(fee, gl);
            return { gasLimit: String(gl), gasFee: formatGasFeeQ(fee), gasPriceWei: priceWei };
        }
    }
    var defFee = defaultGasLimit * SWAP_GAS_FEE_RATE;
    return {
        gasLimit: String(defaultGasLimit),
        gasFee: formatGasFeeQ(defFee),
        gasPriceWei: computeGasPriceWei(defFee, defaultGasLimit)
    };
}

// Swap gas defaults (network-failure fallbacks).
var SWAP_DEFAULT_GAS = 200000;
var APPROVE_DEFAULT_GAS = 84000;

function getSwapExecuteTxContext() {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var toValue = document.getElementById("ddlSwapToToken").value;
    var fromQty = (document.getElementById("txtSwapFromQuantity").value || "").trim();
    var toQty = (document.getElementById("txtSwapToQuantity").value || "").trim();
    if (!fromValue || !toValue || !fromQty || !toQty) return null;
    return {
        txKind: "swap",
        fromTokenValue: fromValue,
        toTokenValue: toValue,
        amountIn: fromQty,
        amountOut: toQty,
        lastChanged: (typeof swapLastChanged !== "undefined" ? swapLastChanged : null) || "from",
        slippagePercent: parseFloat(document.getElementById("txtSwapSlippage").value) || 1,
        fromDecimals: getSwapTokenDecimals(fromValue),
        toDecimals: getSwapTokenDecimals(toValue),
        recipientAddress: currentWalletAddress,
        defaultGasLimit: SWAP_DEFAULT_GAS
    };
}

function getSwapApproveTxContext(amount) {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    if (!fromValue) return null;
    return {
        txKind: "approve",
        fromTokenValue: fromValue,
        amount: amount,
        fromDecimals: getSwapTokenDecimals(fromValue),
        defaultGasLimit: APPROVE_DEFAULT_GAS
    };
}

function onSwapGasIconClick() {
    return onGasIconClick("spanSwapGasFee", null, getSwapExecuteTxContext);
}

function onSwapConfirmGasIconClick() {
    return onGasIconClick("spanSwapConfirmGasFee", null, getSwapExecuteTxContext);
}

function onRemoveAllowanceGasIconClick() {
    return onGasIconClick("spanRemoveAllowanceGasFee", swapApproveGasState, function () { return getSwapApproveTxContext("0"); });
}

function onAddAllowanceGasIconClick() {
    return onGasIconClick("spanAddAllowanceGasFee", swapApproveGasState, function () {
        var amt = (document.getElementById("txtAddAllowanceQuantity").value || "").trim();
        if (!amt) return null;
        return getSwapApproveTxContext(amt);
    });
}

function scheduleSwapExecuteGasEstimation(iconId, labelId) {
    scheduleGasEstimation(getSwapExecuteTxContext, iconId, labelId);
}

function setSwapConfirmPanelLoading(show) {
    var loadingEl = document.getElementById("divSwapConfirmLoading");
    var backEl = document.getElementById("divBackSwapScreen");
    var slippageInput = document.getElementById("txtSwapSlippage");
    var btnNext = document.getElementById("btnSwapConfirmNext");
    if (loadingEl) loadingEl.style.display = show ? "block" : "none";
    var disabled = !!show;
    if (backEl) { backEl.style.pointerEvents = disabled ? "none" : ""; backEl.setAttribute("aria-disabled", disabled ? "true" : "false"); }
    if (slippageInput) slippageInput.disabled = disabled;
    if (btnNext) { btnNext.disabled = disabled; btnNext.style.pointerEvents = disabled ? "none" : ""; }
}

async function onSwapNextClick() {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var toValue = document.getElementById("ddlSwapToToken").value;
    var fromQty = (document.getElementById("txtSwapFromQuantity").value || "").trim();
    var toQty = (document.getElementById("txtSwapToQuantity").value || "").trim();
    if (!fromQty || parseFloat(fromQty) <= 0) {
        showWarnAlert((langJson.langValues["swap-from-quantity"] || "From quantity") + " " + (langJson.errors && langJson.errors.invalidValue ? langJson.errors.invalidValue : "is required"));
        return false;
    }
    if (!toQty || parseFloat(toQty) <= 0) {
        showWarnAlert((langJson.langValues["swap-to-quantity"] || "To quantity") + " " + (langJson.errors && langJson.errors.invalidValue ? langJson.errors.invalidValue : "is required"));
        return false;
    }
    if (!fromValue || !toValue || fromValue === toValue) {
        showWarnAlert((langJson && langJson.langValues && langJson.langValues["swap-no-pair"]));
        return false;
    }
    if (!currentBlockchainNetwork) return false;
    var pairExists = false;
    try {
        var payload = applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            fromTokenValue: fromValue,
            toTokenValue: toValue
        });
        var result = await getSwapCheckPairExists(payload);
        pairExists = result && result.exists === true;
        if (!pairExists) {
            updateSwapRoutePathDisplay(null);
            if (result && result.error) {
                showWarnAlert(result.error);
            } else {
                showWarnAlert((langJson && langJson.langValues && langJson.langValues["swap-no-pair"]));
            }
            return false;
        }
        updateSwapRoutePathDisplay(buildSwapRouteFromCheckResult(result));
    } catch (e) {
        showWarnAlert((e && e.message) ? e.message : String(e));
        return false;
    }
    document.getElementById("divSwapScreenInner").style.display = "none";
    setSwapConfirmPanelLoading(true);
    try {
        var allowancePayload = applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            fromTokenValue: fromValue,
            ownerAddress: currentWalletAddress,
            requiredAmount: fromQty,
            fromDecimals: getSwapTokenDecimals(fromValue)
        });
        var allowanceResult = await getSwapCheckAllowance(allowancePayload);
        if (!allowanceResult || !allowanceResult.success) {
            showWarnAlert((allowanceResult && allowanceResult.error) ? allowanceResult.error : "Failed to check approval");
            setSwapConfirmPanelLoading(false);
            document.getElementById("divSwapScreenInner").style.display = "block";
            return false;
        }
        if (allowanceResult.sufficient) {
            swapSuccessFromToken = fromValue;
            swapSuccessToToken = toValue;
            swapSuccessFromBefore = await getSwapBalanceForSymbol(fromValue);
            swapSuccessToBefore = await getSwapBalanceForSymbol(toValue);
            document.getElementById("divSwapConfirmPanel").style.display = "block";
            document.getElementById("divSwapRemoveAllowancePanel").style.display = "none";
            document.getElementById("divSwapAddAllowancePanel").style.display = "none";
            document.getElementById("txtSwapSlippage").value = "1";
            var slippageRow = document.getElementById("divSwapSlippageRow");
            var btnConfirmNext = document.getElementById("btnSwapConfirmNext");
            slippageRow.style.display = "block";
            btnConfirmNext.textContent = (langJson && langJson.langValues && langJson.langValues["swap"]) ? langJson.langValues["swap"] : "Swap";
            // Refresh the gas estimate for the confirm panel using the common gas flow.
            resetCurrentGasConfig();
            setGasFeeLabel("spanSwapConfirmGasFee", "");
            scheduleSwapExecuteGasEstimation("divSwapConfirmGasIcon", "spanSwapConfirmGasFee");
        } else {
            showAddAllowancePanel(fromValue, fromQty, toValue, toQty);
        }
    } catch (e) {
        showWarnAlert((e && e.message) ? e.message : String(e));
        document.getElementById("divSwapScreenInner").style.display = "block";
    }
    setSwapConfirmPanelLoading(false);
    return false;
}

function showAddAllowancePanel(fromValue, fromQty, toValue, toQty) {
    document.getElementById("divSwapConfirmPanel").style.display = "none";
    document.getElementById("divSwapRemoveAllowancePanel").style.display = "none";
    document.getElementById("divSwapAddAllowancePanel").style.display = "block";
    var contractAddr = getSwapContractAddress(fromValue);
    var aEl = document.getElementById("aAddAllowanceContract");
    if (aEl) { aEl.textContent = contractAddr; aEl.setAttribute("data-contract-address", contractAddr); }
    var fromQtyNum = parseFloat(normalizeAmountForNumberInput(fromQty)) || 0;
    var defaultApprovalQty = Math.ceil(fromQtyNum) || 1;
    document.getElementById("txtAddAllowanceQuantity").value = defaultApprovalQty.toString();
    document.getElementById("divAddAllowanceError").style.display = "none";
    document.getElementById("divAddAllowanceError").textContent = "";
    setAddAllowancePanelWaiting(false);
    resetCurrentGasConfig(swapApproveGasState);
    setGasFeeLabel("spanAddAllowanceGasFee", "");
    scheduleGasEstimation(function () {
        var amount = (document.getElementById("txtAddAllowanceQuantity").value || "").trim();
        if (!amount || parseFloat(amount) <= 0) return null;
        return getSwapApproveTxContext(amount);
    }, "divAddAllowanceGasIcon", "spanAddAllowanceGasFee", swapApproveGasState);
}

function showSwapMainPanel() {
    document.getElementById("divSwapConfirmPanel").style.display = "none";
    document.getElementById("divSwapRemoveAllowancePanel").style.display = "none";
    document.getElementById("divSwapAddAllowancePanel").style.display = "none";
    document.getElementById("divSwapScreenInner").style.display = "block";
    updateSwapFromAllowanceDisplay();
    setGasFeeLabel("spanSwapGasFee", "");
    scheduleSwapExecuteGasEstimation("divSwapGasIcon", "spanSwapGasFee");
    return false;
}

function onSwapScreenBackClick() {
    if (document.getElementById("divSwapRemoveAllowancePanel").style.display !== "none" || document.getElementById("divSwapAddAllowancePanel").style.display !== "none" || document.getElementById("divSwapSuccessPanel").style.display !== "none") {
        goToFirstSwapScreen();
        return false;
    }
    if (document.getElementById("divSwapConfirmPanel").style.display !== "none") {
        showSwapMainPanel();
        return false;
    }
    showWalletScreen();
    return false;
}

var swapApprovalPollingId = null;
var swapApprovalStatusRotateId = null;
var swapApprovalStatusStartTime = 0;
var SWAP_APPROVAL_STATUS_MESSAGES = ["swap-approval-status-close-panel", "swap-approval-status-wait", "swap-approval-status-pending", "swap-approval-status-minute"];

function hexToBytes(hexStr) {
    var s = (hexStr || "").replace(/^0x/i, "");
    var bytes = [];
    for (var i = 0; i < s.length; i += 2) {
        bytes.push(parseInt(s.substr(i, 2), 16));
    }
    return bytes;
}

function setSwapConfirmPanelWaitingForApprovalTx(waiting) {
    var slippageInput = document.getElementById("txtSwapSlippage");
    var btnNext = document.getElementById("btnSwapConfirmNext");
    var errDiv = document.getElementById("divSwapConfirmApprovalTxError");
    var disabled = !!waiting;
    if (slippageInput) { slippageInput.disabled = disabled; slippageInput.style.opacity = disabled ? "0.6" : ""; }
    var pwdInput = document.getElementById("pwdSwapConfirm");
    if (pwdInput) { pwdInput.disabled = disabled; pwdInput.style.opacity = disabled ? "0.6" : ""; }
    if (btnNext) { btnNext.disabled = disabled; btnNext.style.pointerEvents = disabled ? "none" : ""; btnNext.style.opacity = disabled ? "0.6" : ""; }
    if (errDiv) { errDiv.style.display = "none"; errDiv.textContent = ""; }
}

async function reloadSwapApprovalContext() {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var fromQty = (document.getElementById("txtSwapFromQuantity").value || "").trim();
    if (!fromQty || !currentBlockchainNetwork) return;
    try {
        var allowancePayload = applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            fromTokenValue: fromValue,
            ownerAddress: currentWalletAddress,
            requiredAmount: fromQty,
            fromDecimals: getSwapTokenDecimals(fromValue)
        });
        var allowanceResult = await getSwapCheckAllowance(allowancePayload);
        if (allowanceResult && allowanceResult.success && allowanceResult.sufficient) {
            document.getElementById("divSwapSlippageRow").style.display = "block";
            var btnConfirmNext = document.getElementById("btnSwapConfirmNext");
            btnConfirmNext.textContent = (langJson && langJson.langValues && langJson.langValues["swap"]) ? langJson.langValues["swap"] : "Swap";
            resetCurrentGasConfig();
            setGasFeeLabel("spanSwapConfirmGasFee", "");
            scheduleSwapExecuteGasEstimation("divSwapConfirmGasIcon", "spanSwapConfirmGasFee");
        }
    } catch (e) { /* ignore */ }
}

// On swap-execute success: show the before/after success panel. On failure: re-enable
// the confirm panel so the user stays on the transaction dialog (closes the status via OK).
function onSwapSubmitCompletedDialogClose() {
    var alt = document.getElementById("imgSendCompletedStatus");
    var status = alt ? alt.alt : "";
    if (status === "Success") {
        (async function () {
            await refreshAccountBalance();
            var fromAfter = await getSwapBalanceForSymbol(swapSuccessFromToken);
            var toAfter = await getSwapBalanceForSymbol(swapSuccessToToken);
            var gasFeeCoins = swapSuccessGasLimit != null ? formatGasFeeQ(swapSuccessGasLimit * SWAP_GAS_FEE_RATE) : "0";
            showSwapSuccessPanel(swapSuccessFromToken, swapSuccessToToken, swapSuccessFromBefore, swapSuccessToBefore, fromAfter, toAfter, gasFeeCoins);
            swapSuccessFromToken = null;
            swapSuccessToToken = null;
            swapSuccessFromBefore = null;
            swapSuccessToBefore = null;
            swapSuccessGasLimit = null;
        })();
    } else {
        setSwapConfirmPanelWaitingForApprovalTx(false);
    }
}

async function submitSwapTransaction(quantumWallet) {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var toValue = document.getElementById("ddlSwapToToken").value;
    var fromQty = (document.getElementById("txtSwapFromQuantity").value || "").trim();
    var toQty = (document.getElementById("txtSwapToQuantity").value || "").trim();
    var slippagePercent = parseFloat(document.getElementById("txtSwapSlippage").value) || 1;
    var resolvedGas = resolveGasForTx(SWAP_DEFAULT_GAS);
    var gas = parseInt(resolvedGas.gasLimit, 10);
    try {
        var result = await submitSwapSwap(applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            fromTokenValue: fromValue,
            toTokenValue: toValue,
            amountIn: fromQty,
            amountOut: toQty,
            lastChanged: swapLastChanged || "from",
            slippagePercent: slippagePercent,
            fromDecimals: getSwapTokenDecimals(fromValue),
            toDecimals: getSwapTokenDecimals(toValue),
            recipientAddress: currentWalletAddress,
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            gasLimit: gas,
            gasPriceWei: resolvedGas.gasPriceWei,
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        }));
        if (!result || !result.success || !result.txHash) {
            setSwapConfirmPanelWaitingForApprovalTx(false);
            showWarnAlert((result && result.error) ? String(result.error) : (langJson.errors.transactionSubmissionFailed || "Transaction submission failed."));
            return;
        }
        swapSuccessGasLimit = gas;
        showSendCompletedDialog(result.txHash, onSwapSubmitCompletedDialogClose);
    } catch (err) {
        setSwapConfirmPanelWaitingForApprovalTx(false);
        showWarnAlert((err && err.message) ? String(err.message) : String(err));
    }
}

async function submitRemoveAllowanceTransaction(quantumWallet) {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var resolvedGas = resolveGasForTx(APPROVE_DEFAULT_GAS, swapApproveGasState);
    var gas = parseInt(resolvedGas.gasLimit, 10);
    try {
        var result = await submitSwapRemoveAllowance(applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            fromTokenValue: fromValue,
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            gasLimit: gas,
            gasPriceWei: resolvedGas.gasPriceWei,
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        }));
        if (!result || !result.success || !result.txHash) {
            setRemoveAllowancePanelWaiting(false);
            showWarnAlert((result && result.error) ? String(result.error) : (langJson.errors.transactionSubmissionFailed || "Transaction submission failed."));
            return;
        }
        showSendCompletedDialog(result.txHash, function () {
            var alt = document.getElementById("imgSendCompletedStatus");
            if (alt && alt.alt === "Success") {
                var msg = (langJson && langJson.langValues && langJson.langValues["remove-allowance-succeeded"]) ? langJson.langValues["remove-allowance-succeeded"] : "Remove allowance succeeded.";
                showAlertAndExecuteOnClose(msg, goToFirstSwapScreen);
            } else {
                setRemoveAllowancePanelWaiting(false);
            }
        });
    } catch (err) {
        setRemoveAllowancePanelWaiting(false);
        showWarnAlert((err && err.message) ? String(err.message) : String(err));
    }
}

async function submitAddAllowanceTransaction(quantumWallet) {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var approvalAmount = (document.getElementById("txtAddAllowanceQuantity").value || "").trim();
    var resolvedGas = resolveGasForTx(APPROVE_DEFAULT_GAS, swapApproveGasState);
    var gas = parseInt(resolvedGas.gasLimit, 10);
    if (!approvalAmount || parseFloat(approvalAmount) <= 0) {
        setAddAllowancePanelWaiting(false);
        showWarnAlert(langJson.errors.approvalQuantityRequired || "Approval quantity is required.");
        return;
    }
    try {
        var result = await submitSwapAddAllowance(applySwapReleaseToPayload({
            rpcEndpoint: currentBlockchainNetwork.rpcEndpoint,
            chainId: parseInt(currentBlockchainNetwork.networkId, 10),
            fromTokenValue: fromValue,
            amount: approvalAmount,
            fromDecimals: getSwapTokenDecimals(fromValue),
            privateKey: await quantumWallet.getPrivateKey(),
            publicKey: await quantumWallet.getPublicKey(),
            gasLimit: gas,
            gasPriceWei: resolvedGas.gasPriceWei,
            advancedSigningEnabled: await advancedSigningGetDefaultValue()
        }));
        if (!result || !result.success || !result.txHash) {
            setAddAllowancePanelWaiting(false);
            showWarnAlert((result && result.error) ? String(result.error) : (langJson.errors.transactionSubmissionFailed || "Transaction submission failed."));
            return;
        }
        showSendCompletedDialog(result.txHash, function () {
            var alt = document.getElementById("imgSendCompletedStatus");
            if (alt && alt.alt === "Success") {
                var msg = (langJson && langJson.langValues && langJson.langValues["add-allowance-succeeded"]) ? langJson.langValues["add-allowance-succeeded"] : "Add allowance succeeded.";
                showAlertAndExecuteOnClose(msg, goToFirstSwapScreen);
            } else {
                setAddAllowancePanelWaiting(false);
            }
        });
    } catch (err) {
        setAddAllowancePanelWaiting(false);
        showWarnAlert((err && err.message) ? String(err.message) : String(err));
    }
}

var swapApprovalLastTxHash = null;
var allowanceConfirmMode = null;
var allowancePanelMode = null;
var swapConfirmTxMode = null;
var swapSuccessFromToken = null;
var swapSuccessToToken = null;
var swapSuccessFromBefore = null;
var swapSuccessToBefore = null;
var swapSuccessGasLimit = null;
var swapTokenSymbolCache = {};

function goToFirstSwapScreen() {
    document.getElementById("divSwapConfirmPanel").style.display = "none";
    document.getElementById("divSwapRemoveAllowancePanel").style.display = "none";
    document.getElementById("divSwapAddAllowancePanel").style.display = "none";
    document.getElementById("divSwapSuccessPanel").style.display = "none";
    document.getElementById("divSwapScreenInner").style.display = "block";
    updateSwapFromAllowanceDisplay();
    setGasFeeLabel("spanSwapGasFee", "");
    scheduleSwapExecuteGasEstimation("divSwapGasIcon", "spanSwapGasFee");
}

function setSwapSuccessSymbolAndLink(container, symbol, explorerUrl, shortAddr) {
    if (!container) return;
    container.textContent = "";
    if (!explorerUrl || !shortAddr) {
        container.textContent = symbol || "Q";
        return;
    }
    container.appendChild(document.createTextNode(symbol + " ("));
    var a = document.createElement("a");
    a.href = "#";
    a.textContent = shortAddr;
    a.style.color = "#0066cc";
    a.style.textDecoration = "underline";
    a.onclick = function () { OpenUrl(explorerUrl); return false; };
    container.appendChild(a);
    container.appendChild(document.createTextNode(")"));
}

function showSwapSuccessPanel(fromToken, toToken, fromBefore, toBefore, fromAfter, toAfter, gasFeeCoins) {
    document.getElementById("divSwapScreenInner").style.display = "none";
    document.getElementById("divSwapConfirmPanel").style.display = "none";
    document.getElementById("divSwapRemoveAllowancePanel").style.display = "none";
    document.getElementById("divSwapAddAllowancePanel").style.display = "none";
    document.getElementById("divSwapSuccessPanel").style.display = "block";

    var explorerBase = currentBlockchainNetwork ? BLOCK_EXPLORER_ACCOUNT_TEMPLATE.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain) : "";
    var fromAddr = getSwapContractAddress(fromToken);
    var toAddr = getSwapContractAddress(toToken);
    var fromSymbol = getSwapCachedSymbol(fromToken);
    var toSymbol = getSwapCachedSymbol(toToken);
    function shortAddr(addr) { return (!addr || addr === zero_address) ? "" : (String(addr).length > 10 ? String(addr).slice(0, 6) + "..." + String(addr).slice(-4) : addr); }
    var fromUrl = (fromAddr && fromAddr !== zero_address && explorerBase) ? explorerBase.replace(ADDRESS_TEMPLATE, fromAddr) : "";
    var toUrl = (toAddr && toAddr !== zero_address && explorerBase) ? explorerBase.replace(ADDRESS_TEMPLATE, toAddr) : "";

    setSwapSuccessSymbolAndLink(document.getElementById("spanSwapSuccessFromTokenDisplay"), fromSymbol, fromUrl, shortAddr(fromAddr));
    setSwapSuccessSymbolAndLink(document.getElementById("spanSwapSuccessToTokenDisplay"), toSymbol, toUrl, shortAddr(toAddr));
    setSwapSuccessSymbolAndLink(document.getElementById("tdSwapSuccessFromName"), fromSymbol, fromUrl, shortAddr(fromAddr));
    setSwapSuccessSymbolAndLink(document.getElementById("tdSwapSuccessToName"), toSymbol, toUrl, shortAddr(toAddr));

    document.getElementById("tdSwapSuccessFromBefore").textContent = fromBefore != null ? String(fromBefore) : "0";
    document.getElementById("tdSwapSuccessFromAfter").textContent = fromAfter != null ? String(fromAfter) : "0";
    document.getElementById("tdSwapSuccessToBefore").textContent = toBefore != null ? String(toBefore) : "0";
    document.getElementById("tdSwapSuccessToAfter").textContent = toAfter != null ? String(toAfter) : "0";
    document.getElementById("spanSwapSuccessGasFee").textContent = gasFeeCoins != null ? String(gasFeeCoins) : "0";
}

function onSwapSuccessOkClick() {
    goToFirstSwapScreen();
    updateSwapBalanceLabels();
    return false;
}

function updateSwapApprovalSubmitStatusText() {
    var idx = Math.floor((Date.now() - swapApprovalStatusStartTime) / 3000) % SWAP_APPROVAL_STATUS_MESSAGES.length;
    var key = SWAP_APPROVAL_STATUS_MESSAGES[idx];
    var text = (langJson && langJson.langValues && langJson.langValues[key]) ? langJson.langValues[key] : key;
    var panelEl = document.getElementById("spanSwapConfirmApprovalStatus");
    if (panelEl) panelEl.textContent = text;
    var removeStatusDiv = document.getElementById("divRemoveAllowanceTxStatus");
    var removeSpan = document.getElementById("spanRemoveAllowanceStatus");
    if (removeSpan && removeStatusDiv && removeStatusDiv.style.display === "flex") removeSpan.textContent = text;
    var addStatusDiv = document.getElementById("divAddAllowanceTxStatus");
    var addSpan = document.getElementById("spanAddAllowanceStatus");
    if (addSpan && addStatusDiv && addStatusDiv.style.display === "flex") addSpan.textContent = text;
    var dialogEl = document.getElementById("pSwapApprovalSubmitStatus");
    if (dialogEl) dialogEl.textContent = text;
}

function setRemoveAllowancePanelWaiting(waiting) {
    var btn = document.getElementById("btnRemoveAllowanceRemove");
    var errDiv = document.getElementById("divRemoveAllowanceError");
    var disabled = !!waiting;
    var pwdInput = document.getElementById("pwdRemoveAllowance");
    if (pwdInput) { pwdInput.disabled = disabled; pwdInput.style.opacity = disabled ? "0.6" : ""; }
    if (btn) { btn.disabled = disabled; btn.style.pointerEvents = disabled ? "none" : ""; btn.style.opacity = disabled ? "0.6" : ""; }
    if (errDiv) { errDiv.style.display = "none"; errDiv.textContent = ""; }
}

function setAddAllowancePanelWaiting(waiting) {
    var qtyInput = document.getElementById("txtAddAllowanceQuantity");
    var maxLink = document.querySelector("#divAddAllowanceQuantityRow a[onclick*='setAddAllowanceQuantityToMax']");
    var btn = document.getElementById("btnAddAllowanceAdd");
    var errDiv = document.getElementById("divAddAllowanceError");
    var disabled = !!waiting;
    if (qtyInput) { qtyInput.disabled = disabled; qtyInput.style.opacity = disabled ? "0.6" : ""; }
    var pwdInput = document.getElementById("pwdAddAllowance");
    if (pwdInput) { pwdInput.disabled = disabled; pwdInput.style.opacity = disabled ? "0.6" : ""; }
    if (maxLink) { maxLink.style.pointerEvents = disabled ? "none" : ""; maxLink.style.opacity = disabled ? "0.6" : ""; }
    if (btn) { btn.disabled = disabled; btn.style.pointerEvents = disabled ? "none" : ""; btn.style.opacity = disabled ? "0.6" : ""; }
    if (errDiv) { errDiv.style.display = "none"; errDiv.textContent = ""; }
}

// Gas fee labels for the allowance panels are now driven by the common gas-estimation
// flow (spanRemoveAllowanceGasFee / spanAddAllowanceGasFee). These are retained as
// no-ops for any legacy callers.
function updateRemoveAllowanceGasFeeLabel() { return; }
function updateAddAllowanceGasFeeLabel() { return; }

async function openRemoveAllowanceContractInExplorer() {
    var addr = getSwapContractAddress(document.getElementById("ddlSwapFromToken").value);
    var url = BLOCK_EXPLORER_ACCOUNT_TEMPLATE.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain).replace(ADDRESS_TEMPLATE, addr);
    await OpenUrl(url);
}

async function openAddAllowanceContractInExplorer() {
    var addr = getSwapContractAddress(document.getElementById("ddlSwapFromToken").value);
    var url = BLOCK_EXPLORER_ACCOUNT_TEMPLATE.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain).replace(ADDRESS_TEMPLATE, addr);
    await OpenUrl(url);
}

function showSwapApprovalTransactionReview(review, mode) {
    allowanceConfirmMode = mode;
    review.requirePassword = false;
    review.submitLabelKey = "submit";
    review.nonce = null;
    review.networkText = txReviewNetworkText();
    review.fromAddress = currentWalletAddress;
    review.onSubmit = function () {
        showLoadingAndExecuteAsync(langJson.langValues.waitWalletOpen, decryptAndUnlockWalletForSwapApproval);
    };
    showTransactionReviewDialog(review);
}

function showSwapExecuteConfirmDialog() {
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    var toValue = document.getElementById("ddlSwapToToken").value;
    var fromAmt = (document.getElementById("txtSwapFromQuantity").value || "").trim();
    var toAmt = (document.getElementById("txtSwapToQuantity").value || "").trim();
    function sym(v) { return v === "Q" ? "Q" : (String(v).length > 10 ? String(v).slice(0, 6) + "..." + String(v).slice(-4) : v); }
    var resolved = resolveGasForTx(SWAP_DEFAULT_GAS);
    // Show the full multi-hop route when one was resolved, otherwise from -> to.
    var assetText = sym(fromValue) + " -> " + sym(toValue);
    if (swapCurrentRoute && swapCurrentRoute.length >= 2) {
        var routeParts = [];
        for (var ri = 0; ri < swapCurrentRoute.length; ri++) {
            routeParts.push(getSwapRouteDisplaySymbol(swapCurrentRoute[ri].address, swapCurrentRoute[ri].symbol));
        }
        assetText = routeParts.join(" -> ");
    }
    var review = {
        asset: assetText,
        contractAddress: getSwapContractAddress(fromValue),
        toAddress: currentWalletAddress,
        quantityLabelKey: "send-quantity",
        quantityValue: fromAmt + " " + sym(fromValue) + " for " + toAmt + " " + sym(toValue),
        gasLimit: resolved.gasLimit,
        gasFee: resolved.gasFee
    };
    showSwapApprovalTransactionReview(review, "swapExecute");
}

async function decryptAndUnlockWalletForSwapApproval() {
    var pwdId = "pwdSwapConfirm";
    if (allowanceConfirmMode === "remove") pwdId = "pwdRemoveAllowance";
    else if (allowanceConfirmMode === "add") pwdId = "pwdAddAllowance";
    var password = (document.getElementById(pwdId).value || "").trim();
    try {
        var quantumWallet = await walletGetByAddress(password, currentWalletAddress);
        if (quantumWallet == null) {
            hideWaitingBox();
            showWarnAlert(getGenericError());
            return;
        }
        hideWaitingBox();
        closeTransactionReviewDialog();
        if (allowanceConfirmMode === "remove") {
            allowanceConfirmMode = null;
            setRemoveAllowancePanelWaiting(true);
            await submitRemoveAllowanceTransaction(quantumWallet);
        } else if (allowanceConfirmMode === "add") {
            allowanceConfirmMode = null;
            setAddAllowancePanelWaiting(true);
            await submitAddAllowanceTransaction(quantumWallet);
        } else if (allowanceConfirmMode === "swapExecute") {
            allowanceConfirmMode = null;
            setSwapConfirmPanelWaitingForApprovalTx(true);
            await submitSwapTransaction(quantumWallet);
        }
    } catch (err) {
        hideWaitingBox();
        showWarnAlert((err && err.message) ? err.message : String(err));
    }
}

function onSwapApprovalSubmitCloseClick() {
    if (typeof swapApprovalPollingId !== "undefined" && swapApprovalPollingId) clearInterval(swapApprovalPollingId);
    swapApprovalPollingId = null;
    if (typeof swapApprovalStatusRotateId !== "undefined" && swapApprovalStatusRotateId) clearInterval(swapApprovalStatusRotateId);
    swapApprovalStatusRotateId = null;
    return false;
}

function onRemoveSwapAllowanceClick() {
    if (!currentBlockchainNetwork) return false;
    var fromValue = document.getElementById("ddlSwapFromToken").value;
    if (!fromValue) return false;
    document.getElementById("divSwapScreenInner").style.display = "none";
    document.getElementById("divSwapConfirmPanel").style.display = "none";
    document.getElementById("divSwapAddAllowancePanel").style.display = "none";
    document.getElementById("divSwapRemoveAllowancePanel").style.display = "block";
    var contractAddr = getSwapContractAddress(fromValue);
    var aEl = document.getElementById("aRemoveAllowanceContract");
    if (aEl) { aEl.textContent = contractAddr; aEl.setAttribute("data-contract-address", contractAddr); }
    document.getElementById("divRemoveAllowanceError").style.display = "none";
    document.getElementById("divRemoveAllowanceError").textContent = "";
    setRemoveAllowancePanelWaiting(false);
    resetCurrentGasConfig(swapApproveGasState);
    setGasFeeLabel("spanRemoveAllowanceGasFee", "");
    scheduleGasEstimation(function () { return getSwapApproveTxContext("0"); }, "divRemoveAllowanceGasIcon", "spanRemoveAllowanceGasFee", swapApproveGasState);
    return false;
}

function onRemoveAllowanceRemoveClick() {
    var password = document.getElementById("pwdRemoveAllowance").value;
    if (password == null || password.length < 2) {
        showWarnAlert(langJson.errors.enterQuantumPassword);
        return false;
    }
    var contractAddr = getSwapContractAddress(document.getElementById("ddlSwapFromToken").value);
    var resolved = resolveGasForTx(APPROVE_DEFAULT_GAS, swapApproveGasState);
    var review = {
        asset: langJson.langValues["remove-allowance-title"] || "Remove allowance",
        contractAddress: contractAddr,
        toAddress: contractAddr,
        quantityLabelKey: "approval-quantity",
        quantityValue: "0",
        gasLimit: resolved.gasLimit,
        gasFee: resolved.gasFee
    };
    showSwapApprovalTransactionReview(review, "remove");
    return false;
}

function setAddAllowanceQuantityToMax() {
    document.getElementById("txtAddAllowanceQuantity").value = "999999999999999999";
    onAddAllowanceQuantityInput();
    return false;
}

function onAddAllowanceQuantityInput() {
    if (!currentBlockchainNetwork) return;
    var amount = (document.getElementById("txtAddAllowanceQuantity").value || "").trim();
    if (!amount || parseFloat(amount) <= 0) return;
    scheduleGasEstimation(function () { return getSwapApproveTxContext(amount); }, "divAddAllowanceGasIcon", "spanAddAllowanceGasFee", swapApproveGasState);
}

function onAddAllowanceAddClick() {
    var password = document.getElementById("pwdAddAllowance").value;
    if (password == null || password.length < 2) {
        showWarnAlert(langJson.errors.enterQuantumPassword);
        return false;
    }
    var contractAddr = getSwapContractAddress(document.getElementById("ddlSwapFromToken").value);
    var approvalQty = (document.getElementById("txtAddAllowanceQuantity").value || "").trim();
    var resolved = resolveGasForTx(APPROVE_DEFAULT_GAS, swapApproveGasState);
    var review = {
        asset: langJson.langValues["add-allowance-title"] || "Add allowance",
        contractAddress: contractAddr,
        toAddress: contractAddr,
        quantityLabelKey: "approval-quantity",
        quantityValue: approvalQty,
        gasLimit: resolved.gasLimit,
        gasFee: resolved.gasFee
    };
    showSwapApprovalTransactionReview(review, "add");
    return false;
}

function onSwapConfirmNextClick() {
    var password = document.getElementById("pwdSwapConfirm").value;
    if (password == null || password.length < 2) {
        showWarnAlert(langJson.errors.enterQuantumPassword);
        return false;
    }
    showSwapExecuteConfirmDialog();
    return false;
}

function executeSwap() {
    return onSwapNextClick();
}

async function refreshTransactionList() {
    return await refreshTransactionListWithContext(false);
}

async function refreshTransactionListWithContext(isPrev) {
    try {
        document.getElementById('divTxnRefreshStatus').style.display = "none";
        document.getElementById('divTxnLoadingStatus').style.display = "block";
        document.getElementById('tbodyPendingTransactions').innerHTML = "";
        document.getElementById('tbodyComplextedTransactions').innerHTML = "";

        await refreshTransactionListInner(false, isPrev);
        await refreshTransactionListInner(true, false);

        setTimeout(() => {
            document.getElementById('divTxnRefreshStatus').style.display = "block";
            document.getElementById('divTxnLoadingStatus').style.display = "none";
        }, "500");

        document.getElementById("divTxnRefreshStatus").focus();
    }
    catch (error) {
        if (isNetworkError(error)) {
            showWarnAlert(langJson.errors.internetDisconnected);
        } else {
            { console.error(error); showWarnAlert(langJson.errors.invalidApiResponse); }
        }

        setTimeout(() => {
            document.getElementById('divTxnRefreshStatus').style.display = "block";
            document.getElementById('divTxnLoadingStatus').style.display = "none";
        }, "500");
    }
}

async function refreshTransactionListInner(isPending, isPrev) {
    let pageIndex = (isPending) ? 0 : currentTxnPageIndex;
    let tableBody = "";
    let currAddressLower = currentWalletAddress.toLowerCase();
    
    let txnListDetails = await getTransactionDetails(currentBlockchainNetwork.scanApiDomain, currentWalletAddress, pageIndex, isPending);
    if (txnListDetails == null || txnListDetails.transactionList == null) {
        if (isPending) {
            tableBody = getPendingTxnRow(currAddressLower);
            document.getElementById('tbodyPendingTransactions').innerHTML = tableBody;
        } else {
            document.getElementById('tbodyComplextedTransactions').innerHTML = "";
            currentTxnPageIndex = 0;                       
        } 
        return;
    }

    for (var i = 0; i < txnListDetails.transactionList.length; i++) {
        let txn = txnListDetails.transactionList[i];
        let txnRow = "";
        if (isPending) {
            txnRow = completedTxnOutRowTemplate;
        } else {
            if (txn.from.toLowerCase() == currentWalletAddress.toLowerCase()) {
                if (txn.status == true) {
                    txnRow = completedTxnOutRowTemplate;
                } else {
                    txnRow = failedTxnOutRowTemplate;
                }
            } else {
                if (txn.status == true) {
                    txnRow = completedTxnInRowTemplate;
                } else {
                    txnRow = failedTxnInRowTemplate;
                }
            }
        }
        txnRow = txnRow.replaceAll("[FROM]", htmlAttrEncode(txn.from));

        if (txn.to != null) { //to address can be null for smart-contract creation transactions
            txnRow = txnRow.replaceAll("[TO]", htmlAttrEncode(txn.to));
            txnRow = txnRow.replaceAll("[SHORT_TO]", getShortAddress(txn.to));
        } else {
            txnRow = txnRow.replaceAll("[TO]", "");
            txnRow = txnRow.replaceAll("[SHORT_TO]", "");
        }        

        txnRow = txnRow.replaceAll("[HASH]", htmlAttrEncode(txn.hash));
        txnRow = txnRow.replaceAll("[SHORT_FROM]", getShortAddress(txn.from));
        
        txnRow = txnRow.replaceAll("[SHORT_HASH]", getShortAddress(txn.hash));
        txnRow = txnRow.replaceAll("[DATE]", htmlEncode(txn.createdAt.toLocaleString()));
        txnRow = txnRow.replaceAll("[VALUE]", htmlEncode(txn.value.toString()));
        tableBody = tableBody + txnRow;

        if (pendingTransactionsMap.has(currAddressLower + currentBlockchainNetwork.index.toString())) { //if txn appears in current transaction list, remove from pending
            let pendingTxn = pendingTransactionsMap.get(currAddressLower + currentBlockchainNetwork.index.toString());
            if (pendingTxn.hash.toLowerCase() === txn.hash.toLowerCase()) {
                pendingTransactionsMap.delete(currAddressLower + currentBlockchainNetwork.index.toString());
            }
        }
    }

    if (!isPending && !isPrev) {
        if (currentTxnPageIndex == 0) {
            currentTxnPageIndex = txnListDetails.pageCount;
        } else {
            currentTxnPageIndex = currentTxnPageIndex + 1;
        }
    }
    currentTxnPageCount = txnListDetails.pageCount;

    if (isPending) {
        tableBody = tableBody + getPendingTxnRow(currAddressLower);
        document.getElementById('tbodyPendingTransactions').innerHTML = tableBody;
    } else {
        document.getElementById('tbodyComplextedTransactions').innerHTML = tableBody;
    }    
}

function getPendingTxnRow(currAddressLower) {
    if (pendingTransactionsMap.has(currAddressLower + currentBlockchainNetwork.index.toString()) == false) {
        return "";
    }
    let pendingTxn = pendingTransactionsMap.get(currAddressLower + currentBlockchainNetwork.index.toString());
    let txnRow = completedTxnOutRowTemplate;
    txnRow = txnRow.replaceAll("[FROM]", htmlAttrEncode(pendingTxn.from));
    txnRow = txnRow.replaceAll("[TO]", htmlAttrEncode(pendingTxn.to));
    txnRow = txnRow.replaceAll("[HASH]", htmlAttrEncode(pendingTxn.hash));
    txnRow = txnRow.replaceAll("[SHORT_FROM]", getShortAddress(pendingTxn.from));
    txnRow = txnRow.replaceAll("[SHORT_TO]", getShortAddress(pendingTxn.to));
    txnRow = txnRow.replaceAll("[SHORT_HASH]", getShortAddress(pendingTxn.hash));
    txnRow = txnRow.replaceAll("[DATE]", htmlEncode(pendingTxn.createdAt.toLocaleString()));
    txnRow = txnRow.replaceAll("[VALUE]", htmlEncode(pendingTxn.value.toString()));
    return txnRow;
}

async function OpenScanAddress(address) {
    let url = BLOCK_EXPLORER_ACCOUNT_TEMPLATE;
    url = url.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain);
    url = url.replace(ADDRESS_TEMPLATE, address);

    await OpenUrl(url);
}

async function OpenScanTxn(hash) {
    let url = BLOCK_EXPLORER_TRANSACTION_TEMPLATE;
    url = url.replace(BLOCK_EXPLORER_DOMAIN_TEMPLATE, currentBlockchainNetwork.blockExplorerDomain);
    url = url.replace(TRANSACTION_HASH_TEMPLATE, hash);

    await OpenUrl(url);
}

async function showPrevTxnPage() {
    if (currentTxnPageIndex > 1) {
        currentTxnPageIndex = currentTxnPageIndex - 1;
    } else if (currentTxnPageIndex == 1) {
        showWarnAlert(langJson.errors.noMoreTxns);
        return;
    } else if (currentTxnPageIndex == 0 && currentTxnPageCount > 0) {
        currentTxnPageIndex = currentTxnPageCount - 1;
    }
    await refreshTransactionListWithContext(true);
}

async function showNextTxnPage() {
    if (currentTxnPageIndex == 0 || currentTxnPageIndex == currentTxnPageCount) {
        showWarnAlert(langJson.errors.noMoreTxns);
        return;
    }
    currentTxnPageIndex = currentTxnPageIndex + 1;
    await refreshTransactionList();
}

async function showHelp() {
    OpenUrl("https://QuantumCoin.org");
    return false;
}

async function openBlockExplorer() {
    OpenUrl(HTTPS + currentBlockchainNetwork.blockExplorerDomain);
    return false;
}

function clickOnEnter(event, object) {
    if (event.keyCode == 13) {
        object.click();
    }
}

async function advancedSigningSetDefaultValue(value) {
    let itemStoreResult = await storageSetItem(DEFAULT_ADVANCED_SIGNING_SETTING_KEY, value);
    if (itemStoreResult != true) {
        throw new Error("advancedSigningSetDefaultValue item store failed");
    }
    return true;
}

async function advancedSigningGetDefaultValue() {
    let value = await storageGetItem(DEFAULT_ADVANCED_SIGNING_SETTING_KEY);
    if (value == null) {
        return false;
    }
    if (value === "enabled") {
        return true;
    }
    return false;
}

async function saveSelectedAdvancedSigningSetting() {
    const radioButtons = document.querySelectorAll('input[name="optAdvancedSigning"]');
    let selectedValue = "";
    radioButtons.forEach(function (radioButton) {
        if (radioButton.checked) {
            selectedValue = radioButton.value;
        }
    });
    let result = await advancedSigningSetDefaultValue(selectedValue);
    if (result == false) {
        showWarnAlert(getGenericError(""));
    }
}
