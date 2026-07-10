// dApp approval controller. Loaded only by public/approve.html, which the
// background broker opens as `approve.html?requestId=...`. It bypasses the normal
// wallet boot and drives the Send-styled approval card (#dappApprovalRoot) for
// three request kinds:
//   - qc_requestAccounts : unlock + pick account + sign a login challenge
//   - qc_signMessage     : unlock + EIP-191 sign an arbitrary message
//   - qc_sendToken/Coin  : unlock + broadcast via the existing chain path
//
// Connect/sign results flow back through `qc-approval-result`; sends report the
// broadcast txHash through `qc-approval-txBroadcast` and hand confirmation
// polling to the background so transactionResult fires even if this popup closes.
//
// The page ships a minimal script set (no app.js/dialog.js), so this file is
// self-sufficient: it loads its own lang table, provides the "Please wait…" modal
// helpers and password eye-toggle, and validates incoming requests.
(function () {
    "use strict";

    function ext() {
        return (typeof browser !== "undefined") ? browser : chrome;
    }

    function sendToBackground(msg) {
        return new Promise(function (resolve, reject) {
            try {
                var ret = ext().runtime.sendMessage(msg, function (res) {
                    var err = ext().runtime.lastError;
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

    var REQUEST_ID = new URLSearchParams(location.search).get("requestId") || "";
    var currentNet = null;
    var pendingRequest = null;
    var settled = false;
    var lang = {};

    // Gas config for send approvals (self-contained parity with app.js). `overridden`
    // becomes true once the user edits the values via the Gas dialog, after which the
    // live estimate no longer replaces them.
    var COIN_SEND_GAS = 21000;
    var TOKEN_SEND_GAS = 84000;
    var TX_SEND_GAS = 250000; // default for a generic dApp transaction (contract call/deploy)
    var SWAP_GAS_FEE_RATE = 1000 / 21000;
    var GAS_FEE_DECIMALS = 4;
    var GAS_FEE_UNIT_LABEL = "Q";
    var GAS_ESTIMATE_BUFFER_PERCENT = 10;
    var GAS_NO_BUFFER_PERCENT = 0;
    var dappGasConfig = { gasLimit: null, gasFee: null, overridden: false };
    var dappGasToken = 0;
    var onDappGasConfigOk = null;
    var dappGasConfigFeeRate = null;

    // Connect-screen state:
    //   "ready"  - an address is selected and we can sign on click (Sign & Connect)
    //   "locked" - no shared/unlocked address yet; first click must Unlock
    var connectState = "locked";
    var connectAccounts = null;        // wallets loaded after an in-popup unlock
    var selectedConnectAddress = null; // address currently shown / to be connected

    function el(id) { return document.getElementById(id); }
    function setStatus(text) { var s = el("dappStatus"); if (s) s.textContent = text || ""; }
    function show(id, on) { var e = el(id); if (e) e.style.display = on ? "" : "none"; }
    function errMsg(e) { return (e && e.message) ? e.message : String(e); }

    // Show/hide the "type i agree to confirm" row (parity with the sidebar's
    // transaction-review dialog). Shown before any signing/sending click.
    function showIAgreeRow(on) {
        var r = el("dappIAgreeRow");
        if (r) r.style.display = on ? "" : "none";
    }

    // Returns true when the confirmation textbox matches the required "i agree"
    // literal (trimmed, case-insensitive); otherwise sets the status and returns false.
    function checkIAgree() {
        var input = el("txtDappIAgree");
        var typed = (input && input.value ? input.value : "").trim().toLowerCase();
        var required = t("i-agree-literal", "i agree").toLowerCase();
        if (typed !== required) {
            setStatus(t("must-agree-to-submit", "Please type \"i agree\" to confirm."));
            return false;
        }
        return true;
    }

    // ---- localization ----------------------------------------------------
    // Mirrors app.js: read the same en-us.json and use its `langValues` table.
    function t(key, fallback) {
        var v = lang ? lang[key] : null;
        return (v == null) ? (fallback == null ? key : fallback) : v;
    }

    async function loadLang() {
        try {
            var raw = await ReadFile("./json/en-us.json");
            var parsed = raw ? JSON.parse(raw) : null;
            if (parsed && parsed.langValues) lang = parsed.langValues;
        } catch (e) {
            lang = {};
        }
    }

    // Advanced ("full") signing setting, stored by the wallet under this key
    // (see app.js DEFAULT_ADVANCED_SIGNING_SETTING_KEY). Read directly since the
    // approval page does not load app.js.
    var DAPP_ADVANCED_SIGNING_KEY = "DefaultAdvancedSigningSettingKey";
    async function getAdvancedSigningEnabled() {
        try {
            var v = await storageGetItem(DAPP_ADVANCED_SIGNING_KEY);
            return v === "enabled";
        } catch (e) {
            return false;
        }
    }

    // Read the docked wallet's current address (published to chrome.storage.session).
    // Present only while a wallet is unlocked; used to prefill the default account.
    async function readSessionAddress() {
        try {
            var api = ext();
            if (!api || !api.storage || !api.storage.session) return null;
            var got = api.storage.session.get("qc_current_address");
            if (got && typeof got.then === "function") {
                var o = await got;
                return o ? (o.qc_current_address || null) : null;
            }
            return await new Promise(function (resolve) {
                api.storage.session.get("qc_current_address", function (o) {
                    resolve(o ? (o.qc_current_address || null) : null);
                });
            });
        } catch (e) {
            return null;
        }
    }

    // Populate any data-lang-key / data-placeholder-key / data-alt-key nodes that
    // live inside the approval card + header (scoped so it never touches globals).
    function fillLang() {
        var scope = document;
        scope.querySelectorAll("[data-lang-key]").forEach(function (node) {
            var val = t(node.getAttribute("data-lang-key"), node.textContent);
            if (val != null) node.textContent = val;
        });
        scope.querySelectorAll("[data-placeholder-key]").forEach(function (node) {
            var val = t(node.getAttribute("data-placeholder-key"), node.placeholder);
            if (val != null) node.placeholder = val;
        });
        scope.querySelectorAll("[data-alt-key]").forEach(function (node) {
            var val = t(node.getAttribute("data-alt-key"), node.alt);
            if (val != null) node.alt = val;
        });
    }

    // ---- "Please wait…" modal (self-contained; no dialog.js on this page) --
    function showLoadingAndExecuteAsync(txt, f) {
        var d = el("modalWaitDialog");
        if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch (e) { /* already open */ } } }
        var p = el("pWaitDetails");
        if (p) p.innerText = txt || "";
        // Yield once so the modal paints before the heavy work begins.
        setTimeout(f, 0);
    }
    function updateWaitingBox(txt) { var p = el("pWaitDetails"); if (p) p.innerText = txt || ""; }
    function hideWaitingBox() {
        var d = el("modalWaitDialog");
        if (d) { d.style.display = "none"; if (d.close) { try { d.close(); } catch (e) { /* not open */ } } }
    }

    // ---- post-send status dialog (mirrors index.html modalSendCompleted) ---
    // Self-contained: shows a loading gif + tx hash (copy/scan) and polls the scan
    // API, flipping the status from waiting to success/failure.
    var sendCompletedPollingId = null;
    var sendCompletedStatusRotateId = null;
    var sendCompletedTxHash = null;
    var sendCompletedAddress = null;
    var SEND_STATUS_MESSAGES = ["send-status-checking", "send-status-waiting", "send-status-checking-short"];
    var SEND_STATUS_ROTATE_MS = 3600;
    var SEND_STATUS_POLL_MS = 9000;

    function scanScheme(domain) {
        var httpAllowed = domain.indexOf("localhost:") === 0 || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(domain);
        return httpAllowed ? "http://" : "https://";
    }

    async function fetchTxList(scanApiDomain, address, pending) {
        var base = scanScheme(scanApiDomain) + scanApiDomain + "/account/" + address + "/transactions/";
        var resp = await fetch(pending ? base + "pending/0" : base + "0");
        var json = await resp.json();
        return (json && Array.isArray(json.items)) ? json.items : [];
    }

    function setSendCompletedPending() {
        var img = el("imgSendCompletedStatus");
        if (img) { img.src = "assets/icons/loading.gif"; img.alt = "Loading"; }
    }

    function updateSendCompletedStatusText() {
        var img = el("imgSendCompletedStatus");
        if (!img || img.alt !== "Loading") return;
        var idx = Math.floor(Date.now() / SEND_STATUS_ROTATE_MS) % SEND_STATUS_MESSAGES.length;
        var span = el("spanSendCompletedStatus");
        if (span) span.textContent = t(SEND_STATUS_MESSAGES[idx], "Checking transaction status...");
    }

    function setSendCompletedSucceeded() {
        var img = el("imgSendCompletedStatus");
        if (img) { img.src = "assets/svg/checkmark-circle-outline.svg"; img.alt = "Success"; }
        var span = el("spanSendCompletedStatus");
        if (span) span.textContent = t("send-transaction-succeeded", "Transaction completed successfully.");
    }

    function setSendCompletedFailed(errorText) {
        var img = el("imgSendCompletedStatus");
        if (img) { img.src = "assets/svg/alert-outline.svg"; img.alt = "Failed"; }
        var span = el("spanSendCompletedStatus");
        var base = t("send-transaction-failed", "Transaction failed.");
        if (span) span.textContent = errorText ? (base + " " + errorText) : base;
    }

    function stopSendCompletedTimers() {
        if (sendCompletedPollingId != null) { clearInterval(sendCompletedPollingId); sendCompletedPollingId = null; }
        if (sendCompletedStatusRotateId != null) { clearInterval(sendCompletedStatusRotateId); sendCompletedStatusRotateId = null; }
    }

    function closeSendCompletedDialog() {
        stopSendCompletedTimers();
        var d = el("modalSendCompleted");
        if (d) { d.style.display = "none"; if (d.close) { try { d.close(); } catch (e) { /* not open */ } } }
        closeWindow();
    }

    async function pollSendCompletedStatus() {
        if (!sendCompletedTxHash || !sendCompletedAddress) return;
        var net = networkInfo();
        if (!net || !net.scanApiDomain) return;
        try {
            var pending = await fetchTxList(net.scanApiDomain, sendCompletedAddress, true);
            if (pending.some(function (x) { return x && x.hash === sendCompletedTxHash; })) return; // still pending
            var completed = await fetchTxList(net.scanApiDomain, sendCompletedAddress, false);
            var found = completed.find(function (x) { return x && x.hash === sendCompletedTxHash; });
            if (found) {
                stopSendCompletedTimers();
                if (found.status === "0x1") setSendCompletedSucceeded();
                else setSendCompletedFailed("");
            }
        } catch (e) { /* transient network error; keep polling */ }
    }

    function showSendCompletedDialog(txHash, address) {
        sendCompletedTxHash = txHash;
        sendCompletedAddress = address;

        var msg = el("pSendCompletedMessage");
        if (msg) msg.textContent = t("send-transaction-send-message-description", "Your transaction has been submitted. It can take upto a minute to process the transaction. You may close this dialog now.");
        var hashEl = el("pSendCompletedTxHash");
        if (hashEl) hashEl.textContent = txHash || "";

        var copyBtn = el("divSendCompletedCopy");
        if (copyBtn) { copyBtn.title = t("copy", "Copy"); copyBtn.onclick = function () { try { WriteTextToClipboard(txHash); } catch (e) { /* ignore */ } }; }
        var expBtn = el("divSendCompletedExplorer");
        if (expBtn) {
            expBtn.title = t("block-explorer", "Block Explorer");
            expBtn.onclick = async function () {
                try {
                    var net = networkInfo();
                    if (net && net.blockExplorerDomain) await OpenUrl("https://" + net.blockExplorerDomain + "/txn/" + txHash);
                } catch (e) { /* ignore */ }
            };
        }
        var ok = el("btnSendCompletedOk");
        if (ok) ok.onclick = function () { closeSendCompletedDialog(); };

        setSendCompletedPending();
        var d = el("modalSendCompleted");
        if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch (e) { /* already open */ } } }

        updateSendCompletedStatusText();
        sendCompletedStatusRotateId = setInterval(updateSendCompletedStatusText, SEND_STATUS_ROTATE_MS);
        sendCompletedPollingId = setInterval(pollSendCompletedStatus, SEND_STATUS_POLL_MS);
        pollSendCompletedStatus();
    }

    // ---- password visibility toggle (self-contained) ---------------------
    // Pure UI toggle: flips the input type and swaps the eye icon. Uses mousedown
    // preventDefault so clicking it never blurs the password field (which must not
    // trigger any wallet work).
    function wirePasswordToggle() {
        var eye = el("dappPwdEye");
        var input = el("dappPassword");
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

    function closeWindow() {
        try { window.close(); } catch (e) { /* ignore */ }
    }

    async function loadNetwork() {
        await blockchainNetworksInit();
        var networkMap = await blockchainNetworksList();
        var defaultIndex = await blockchainNetworkGetDefaultIndex();
        var chosen = networkMap.get(defaultIndex);
        if (!chosen) {
            var keys = [...networkMap.keys()].sort(function (a, b) { return a - b; });
            if (keys.length > 0) chosen = networkMap.get(keys[0]);
        }
        currentNet = chosen || null;
    }

    // Load the network on demand (connect/send need it; sign does not) so a slow
    // bridge/WASM call never blocks rendering the approval screen.
    async function ensureNetwork() {
        if (currentNet) return currentNet;
        await loadNetwork();
        return currentNet;
    }

    // The approval popup skips the normal wallet boot, so redirect stray errors
    // to the status line rather than a shared (uninitialized) lockup screen.
    function installErrorGuards() {
        window.__qcApprovalView = true;
        window.onerror = function (message) {
            setStatus(String(message));
            return true;
        };
        window.addEventListener("unhandledrejection", function (event) {
            var reason = event && event.reason;
            setStatus(reason && reason.message ? reason.message : String(reason));
            try { event.preventDefault(); } catch (e) { /* ignore */ }
        });
    }

    function networkInfo() {
        if (!currentNet) return null;
        return {
            name: String(currentNet.blockchainName),
            chainId: parseInt(currentNet.networkId, 10),
            scanApiDomain: currentNet.scanApiDomain,
            blockExplorerDomain: currentNet.blockExplorerDomain,
            rpcEndpoint: currentNet.rpcEndpoint,
            index: currentNet.index
        };
    }

    async function replyResult(result) {
        if (settled) return;
        settled = true;
        await sendToBackground({ type: "qc-approval-result", requestId: REQUEST_ID, approved: true, result: result });
        closeWindow();
    }

    async function replyReject(message) {
        if (settled) return;
        settled = true;
        await sendToBackground({ type: "qc-approval-result", requestId: REQUEST_ID, approved: false, error: message || "User rejected the request" });
        closeWindow();
    }

    async function replyBroadcast(txHash, address) {
        if (settled) return;
        settled = true;
        var net = networkInfo();
        await sendToBackground({
            type: "qc-approval-txBroadcast",
            requestId: REQUEST_ID,
            txHash: txHash,
            scanApiDomain: net ? net.scanApiDomain : null,
            address: address
        });
    }

    // Show a blocking error with only an OK button. Used when a generic
    // transaction fails the mandatory WYSIWYS decode/verify: the calldata and the
    // approve/reject controls are hidden, and the only action (OK, or closing the
    // popup) rejects the request so a tampered/unverifiable tx can never be signed.
    function showErrorOnlyReject(message) {
        var msg = message || t("dapp-tx-verify-failed", "The transaction could not be verified.");
        // Hide every approval control so OK is the sole affordance.
        show("dappApprovalRoot", false);
        var p = el("pDetails");
        if (p) p.textContent = msg;
        var warn = el("divWarn");
        if (warn) warn.style.display = "";
        var succ = el("divSuccess");
        if (succ) succ.style.display = "none";
        var ok = el("divModalOk");
        if (ok) ok.onclick = function () { replyReject(msg).catch(function () { closeWindow(); }); };
        var d = el("modalOkDialog");
        if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch (e) { /* already open */ } } }
    }

    // ---- request validation ----------------------------------------------
    // Belt-and-suspenders: the background broker already early-rejects the same
    // cases before opening this popup. This is the authoritative (SDK-backed)
    // second check for anything that still reaches the approval card.
    function isEthStyleAddress(a) {
        return typeof a === "string" && /^0x?[0-9a-fA-F]{40}$/.test(a.trim());
    }

    async function isQcAddress(a) {
        if (typeof a !== "string") return false;
        var s = a.trim();
        if (!/^0x?[0-9a-fA-F]{64}$/.test(s)) return false;
        try {
            return (await isValidQcAddress(s)) === true;
        } catch (e) {
            // If the bridge is unavailable, fall back to the length/hex check.
            return true;
        }
    }

    async function validateAddressParam(a) {
        if (isEthStyleAddress(a)) {
            return t("dapp-err-incompatible-address", "Incompatible address: QuantumCoin uses 32-byte (64-hex) addresses; received an Ethereum-style 20-byte address.");
        }
        if (!(await isQcAddress(a))) {
            return t("dapp-err-invalid-address", "Invalid QuantumCoin address.");
        }
        return null;
    }

    // Returns an error message string when the request is invalid, else null.
    async function validateApprovalRequest(method, params) {
        if (method === "qc_signMessage") {
            var m = params.message;
            if (typeof m !== "string" || m.length === 0) {
                return t("dapp-err-invalid-message", "Invalid message: expected a non-empty string.");
            }
            return null;
        }
        if (method === "qc_sendToken" || method === "qc_sendCoin") {
            if (method === "qc_sendToken") {
                var contractErr = await validateAddressParam(params.contractAddress);
                if (contractErr) return contractErr;
            }
            var toErr = await validateAddressParam(params.to);
            if (toErr) return toErr;
            var amt = Number(params.amount);
            if (!isFinite(amt) || amt <= 0) {
                return t("dapp-err-invalid-amount", "Invalid amount.");
            }
            return null;
        }
        if (method === "qc_sendTransaction") {
            // Shape-only pre-check (mirrors the background). The authoritative ABI
            // decode + WYSIWYS re-encode verification happens in renderTransaction.
            var toRaw = params.to == null ? "" : String(params.to).trim();
            var dataRaw = params.data == null ? "" : String(params.data).trim();
            if (toRaw !== "") {
                var toErrTx = await validateAddressParam(toRaw);
                if (toErrTx) return toErrTx;
            }
            var hasData = dataRaw !== "" && dataRaw !== "0x" && dataRaw !== "0X";
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
    async function loadAccounts(password) {
        var maxIndex = await walletGetMaxIndex();
        var keys = [];
        for (var i = 0; i <= maxIndex; i++) {
            keys.push(WALLET_KEY_PREFIX + i.toString());
        }
        var jsons = await storageMultiGetSecureItems(password, keys);
        var accounts = [];
        for (var j = 0; j < jsons.length; j++) {
            if (!jsons[j]) continue;
            var w = JSON.parse(jsons[j]);
            accounts.push(new Wallet(w.address, w.privateKey, w.publicKey, w.seed));
        }
        return accounts;
    }

    // ---- flow: connect ---------------------------------------------------
    function buildChallenge(origin, address) {
        var nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
        return "QuantumSwap Connect\n\n"
            + "Site: " + origin + "\n"
            + "Address: " + address + "\n"
            + "Nonce: " + nonce + "\n"
            + "Issued: " + new Date().toISOString();
    }

    async function doConnect(origin, password) {
        var address = selectedConnectAddress;
        if (!address) {
            throw new Error(t("dappNoWallets", "No wallets found or wrong password."));
        }

        // Prefer already-loaded wallets (locked path unlocked them); otherwise
        // load all accounts with a single scrypt (ready path) and pick the target.
        var wallet = null;
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

        var priv = await wallet.getPrivateKey();
        var pub = await wallet.getPublicKey();
        var challenge = buildChallenge(origin, wallet.address);

        var fullSign = await getAdvancedSigningEnabled();
        updateWaitingBox(t("dapp-signing", "Please wait while the request is being signed."));
        var signed = await signMessage(priv, pub, challenge, null, fullSign);
        // Self-check: the recovered signer must match the connecting account.
        var recovered = await verifyMessage(challenge, signed.signature);
        if (!recovered || String(recovered.address).toLowerCase() !== wallet.address.toLowerCase()) {
            throw new Error(t("dappSelfVerifyFailed", "Signature self-verification failed."));
        }

        await ensureNetwork();
        var net = networkInfo();
        await replyResult({ address: wallet.address, chainId: net ? net.chainId : null, network: net });
    }

    // Unlock step for the locked connect path: load the wallets, populate the
    // dropdown, show the default address, and flip the button to Sign & Connect.
    async function unlockConnect(password) {
        var accounts = await loadAccounts(password);
        if (accounts.length === 0) {
            throw new Error(t("dappNoWallets", "No wallets found or wrong password."));
        }
        connectAccounts = accounts;
        var sel = el("dappAccountSelect");
        if (sel) {
            sel.innerHTML = "";
            accounts.forEach(function (w) {
                var opt = document.createElement("option");
                opt.value = w.address;
                opt.textContent = w.address;
                sel.appendChild(opt);
            });
            sel.style.display = (accounts.length > 1) ? "" : "none";
        }
        show("dappConnectScreen", true);
        setSelectedConnectAddress(accounts[0].address);
        connectState = "ready";
        el("dappApproveBtn").textContent = t("dapp-connect", "Sign & Connect");
        showIAgreeRow(true);
        setStatus("");
    }

    function setSelectedConnectAddress(addr) {
        selectedConnectAddress = addr || null;
        var a = el("dappSelectedAddress");
        if (a) a.textContent = addr || "";
    }

    // Shared account row for the sign and send screens (mirrors the connect
    // address block). Fills the address, wires copy + block-explorer icons once,
    // and reveals the row. The current address is read from a module-level var so
    // the once-bound handlers always act on the latest value.
    var accountRowAddress = null;
    function renderAccountRow(address) {
        accountRowAddress = address || null;
        var addrEl = el("dappAccountAddress");
        if (addrEl) addrEl.textContent = accountRowAddress || "";

        var copyBtn = el("dappAccountCopy");
        if (copyBtn && !copyBtn.dataset.bound) {
            copyBtn.dataset.bound = "1";
            copyBtn.addEventListener("click", function () {
                if (!accountRowAddress) return;
                try { WriteTextToClipboard(accountRowAddress); } catch (e) { /* ignore */ }
            });
        }

        var expBtn = el("dappAccountExplorer");
        if (expBtn && !expBtn.dataset.bound) {
            expBtn.dataset.bound = "1";
            expBtn.addEventListener("click", async function () {
                if (!accountRowAddress) return;
                try {
                    await ensureNetwork();
                    var net = networkInfo();
                    if (net && net.blockExplorerDomain) {
                        await OpenUrl("https://" + net.blockExplorerDomain + "/account/" + accountRowAddress);
                    }
                } catch (e) { setStatus(errMsg(e)); }
            });
        }

        show("dappAccountRow", true);
    }

    // ---- flow: sign arbitrary message ------------------------------------
    async function doSign(params, password) {
        var address = params.address;
        var wallet = await walletGetByAddress(password, address);
        if (!wallet) {
            throw new Error(t("dappUnlockFailed", "Could not unlock the connected account (wrong password?)."));
        }
        var priv = await wallet.getPrivateKey();
        var pub = await wallet.getPublicKey();
        var fullSign = await getAdvancedSigningEnabled();
        updateWaitingBox(t("dapp-signing", "Please wait while the request is being signed."));
        var signed = await signMessage(priv, pub, String(params.message == null ? "" : params.message), null, fullSign);
        await replyResult({ signature: signed.signature });
    }

    // ---- gas estimation + config (send approvals) ------------------------
    // Mirrors the sidebar Send screen: show an estimated fee + a gas icon that
    // opens an editable dialog. Uses the same bridge calls (estimateGas /
    // estimateGasFee) available on this page via js/bridge.js.
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

    function setGasFeeLabel(feeValue) {
        var e = el("dappGasFee");
        if (!e) return;
        e.textContent = (feeValue == null || feeValue === "") ? "" : formatGasFeeQ(feeValue);
    }

    function setGasIconPulse(pulsing) {
        var e = el("dappGasIcon");
        if (!e) return;
        if (pulsing) e.classList.add("gas-pulse");
        else e.classList.remove("gas-pulse");
    }

    // Estimate gas limit + fee for the pending send request. Falls back to the
    // hardcoded default gas limit / rate when a network lookup fails.
    async function estimateSendGas(method, params) {
        setGasIconPulse(true);
        setGasFeeLabel("");
        var myToken = ++dappGasToken;
        var isCoin = (method === "qc_sendCoin");
        var defaultGasLimit = isCoin ? COIN_SEND_GAS : TOKEN_SEND_GAS;

        await ensureNetwork();
        if (!currentNet) { setGasIconPulse(false); return; }

        var gasLimit = null;
        try {
            var payload = {
                rpcEndpoint: currentNet.rpcEndpoint,
                chainId: parseInt(currentNet.networkId, 10),
                txKind: isCoin ? "sendCoin" : "sendToken",
                fromAddress: params.from,
                toAddress: params.to,
                amount: String(params.amount),
                bufferPercent: isCoin ? GAS_NO_BUFFER_PERCENT : GAS_ESTIMATE_BUFFER_PERCENT
            };
            if (!isCoin) {
                payload.contractAddress = params.contractAddress;
                payload.fromDecimals = (params.decimals != null) ? params.decimals : 18;
            }
            var est = await estimateGas(payload);
            if (myToken !== dappGasToken) { setGasIconPulse(false); return; }
            if (est && est.success && est.gasLimit) gasLimit = est.gasLimit;
        } catch (e) { /* fall back below */ }

        if (gasLimit == null) gasLimit = String(defaultGasLimit);

        var gasFee = null;
        try {
            var fullSign = await getAdvancedSigningEnabled();
            var feeRes = await estimateGasFee({
                rpcEndpoint: currentNet.rpcEndpoint,
                chainId: parseInt(currentNet.networkId, 10),
                gasLimit: gasLimit,
                keyType: (typeof WALLET_KEY_TYPE_3 !== "undefined") ? WALLET_KEY_TYPE_3 : 3,
                fullSign: fullSign === true
            });
            if (myToken !== dappGasToken) { setGasIconPulse(false); return; }
            if (feeRes && feeRes.success && feeRes.gasFeeEth != null) gasFee = feeRes.gasFeeEth;
        } catch (e) { /* fall back below */ }

        if (gasFee == null) gasFee = (Number(gasLimit) * SWAP_GAS_FEE_RATE);

        if (myToken === dappGasToken && !dappGasConfig.overridden) {
            dappGasConfig.gasLimit = String(gasLimit);
            dappGasConfig.gasFee = String(gasFee);
            dappGasConfig.overridden = false;
            setGasFeeLabel(dappGasConfig.gasFee);
        }
        setGasIconPulse(false);
    }

    // Shared fee lookup: given a resolved gas limit, estimate the fee and (unless
    // the user has overridden the gas) publish it to the gas config + header label.
    async function finalizeGasEstimate(gasLimit, myToken) {
        if (gasLimit == null) { setGasIconPulse(false); return; }
        var gasFee = null;
        try {
            var fullSign = await getAdvancedSigningEnabled();
            var feeRes = await estimateGasFee({
                rpcEndpoint: currentNet.rpcEndpoint,
                chainId: parseInt(currentNet.networkId, 10),
                gasLimit: gasLimit,
                keyType: (typeof WALLET_KEY_TYPE_3 !== "undefined") ? WALLET_KEY_TYPE_3 : 3,
                fullSign: fullSign === true
            });
            if (myToken !== dappGasToken) { setGasIconPulse(false); return; }
            if (feeRes && feeRes.success && feeRes.gasFeeEth != null) gasFee = feeRes.gasFeeEth;
        } catch (e) { /* fall back below */ }

        if (gasFee == null) gasFee = (Number(gasLimit) * SWAP_GAS_FEE_RATE);

        if (myToken === dappGasToken && !dappGasConfig.overridden) {
            dappGasConfig.gasLimit = String(gasLimit);
            dappGasConfig.gasFee = String(gasFee);
            dappGasConfig.overridden = false;
            setGasFeeLabel(dappGasConfig.gasFee);
        }
        setGasIconPulse(false);
    }

    // Estimate gas limit + fee for a generic dApp transaction (verbatim
    // to/data/value). Falls back to the generic default limit on lookup failure.
    async function estimateGenericGas(params) {
        setGasIconPulse(true);
        setGasFeeLabel("");
        var myToken = ++dappGasToken;

        await ensureNetwork();
        if (!currentNet) { setGasIconPulse(false); return; }

        var gasLimit = null;
        try {
            var est = await estimateGas({
                rpcEndpoint: currentNet.rpcEndpoint,
                chainId: parseInt(currentNet.networkId, 10),
                txKind: "sendTransaction",
                fromAddress: params.from,
                to: params.to,
                data: params.data,
                value: params.value,
                bufferPercent: GAS_ESTIMATE_BUFFER_PERCENT
            });
            if (myToken !== dappGasToken) { setGasIconPulse(false); return; }
            if (est && est.success && est.gasLimit) gasLimit = est.gasLimit;
        } catch (e) { /* fall back below */ }

        if (gasLimit == null) gasLimit = String(TX_SEND_GAS);
        await finalizeGasEstimate(gasLimit, myToken);
    }

    // Resolve the gas limit to submit: user override wins, else the estimate,
    // else the hardcoded default for the tx kind.
    function resolveSendGasLimit(defaultGasLimit) {
        if (dappGasConfig.gasLimit != null && dappGasConfig.gasLimit !== "") {
            var gl = parseInt(dappGasConfig.gasLimit, 10);
            if (!isNaN(gl) && gl > 0) return gl;
        }
        return defaultGasLimit;
    }

    function showGasConfigDialog() {
        var limitEl = el("txtGasLimit");
        var feeEl = el("txtGasFee");
        var gl = dappGasConfig.gasLimit;
        var gf = dappGasConfig.gasFee;
        if (limitEl) limitEl.value = (gl != null ? String(gl) : "");
        if (feeEl) feeEl.value = (gf != null ? formatGasFeeNumber(gf) : "");
        var limitNum = parseFloat(gl);
        var feeNum = parseFloat(gf);
        dappGasConfigFeeRate = (!isNaN(limitNum) && limitNum > 0 && !isNaN(feeNum)) ? (feeNum / limitNum) : null;
        var d = el("modalGasConfig");
        if (d) { d.style.display = "block"; if (d.showModal) { try { d.showModal(); } catch (e) { /* already open */ } } }
        setTimeout(function () { if (limitEl) limitEl.focus(); }, 80);
    }

    function closeGasConfigDialog() {
        var d = el("modalGasConfig");
        if (d) { d.style.display = "none"; if (d.close) { try { d.close(); } catch (e) { /* not open */ } } }
    }

    // One-time wiring for the gas icon + dialog buttons.
    function wireGasControls() {
        var icon = el("dappGasIcon");
        if (icon) icon.addEventListener("click", function () {
            if (dappGasConfig.gasLimit == null) {
                // No estimate yet: seed the dialog with the tx-kind default.
                var m = pendingRequest && pendingRequest.method;
                var def = TOKEN_SEND_GAS;
                if (m === "qc_sendCoin") def = COIN_SEND_GAS;
                else if (m === "qc_sendTransaction") def = TX_SEND_GAS;
                dappGasConfig.gasLimit = String(def);
                dappGasConfig.gasFee = String(def * SWAP_GAS_FEE_RATE);
            }
            showGasConfigDialog();
        });

        var limitEl = el("txtGasLimit");
        var feeEl = el("txtGasFee");
        if (limitEl && feeEl && !limitEl.dataset.gasRecomputeBound) {
            limitEl.dataset.gasRecomputeBound = "1";
            limitEl.addEventListener("input", function () {
                if (dappGasConfigFeeRate == null) return;
                var lim = parseFloat(limitEl.value);
                if (isNaN(lim) || lim < 0) return;
                feeEl.value = formatGasFeeNumber(lim * dappGasConfigFeeRate);
            });
        }

        var okBtn = el("btnGasConfigOk");
        if (okBtn) okBtn.addEventListener("click", function () {
            var lEl = el("txtGasLimit");
            var fEl = el("txtGasFee");
            var gasLimit = parseInt((lEl && lEl.value) || "", 10);
            var gasFee = (fEl && fEl.value != null) ? String(fEl.value).trim() : "";
            var feeNum = parseFloat(gasFee);
            if (isNaN(gasLimit) || gasLimit <= 0 || isNaN(feeNum) || feeNum < 0) {
                setStatus(t("invalidValue", "Invalid value"));
                return;
            }
            // Invalidate any in-flight estimate so it can't overwrite the override.
            dappGasToken++;
            dappGasConfig.gasLimit = String(gasLimit);
            dappGasConfig.gasFee = gasFee;
            dappGasConfig.overridden = true;
            setGasFeeLabel(dappGasConfig.gasFee);
            closeGasConfigDialog();
        });

        var cancelBtn = el("btnGasConfigCancel");
        if (cancelBtn) cancelBtn.addEventListener("click", closeGasConfigDialog);
    }

    // ---- flow: send token / coin -----------------------------------------
    async function doSend(method, params, password) {
        var from = params.from;
        var wallet = await walletGetByAddress(password, from);
        if (!wallet) {
            throw new Error(t("dappUnlockFailed", "Could not unlock the sending account (wrong password?)."));
        }

        await ensureNetwork();
        var net = networkInfo();
        if (!net) throw new Error(t("dappNoNetwork", "No blockchain network is configured."));

        var priv = await wallet.getPrivateKey();
        var pub = await wallet.getPublicKey();
        var isCoin = (method === "qc_sendCoin");
        var fullSign = await getAdvancedSigningEnabled();
        var result;

        updateWaitingBox(t("pleaseWaitSubmit", "Please wait while your request is being submitted."));

        if (isCoin) {
            result = await submitSendCoins({
                rpcEndpoint: currentNet.rpcEndpoint,
                chainId: parseInt(currentNet.networkId, 10),
                toAddress: params.to,
                amount: String(params.amount),
                privateKey: priv,
                publicKey: pub,
                gasLimit: resolveSendGasLimit(COIN_SEND_GAS),
                advancedSigningEnabled: fullSign
            });
        } else {
            result = await submitSendTokens({
                rpcEndpoint: currentNet.rpcEndpoint,
                chainId: parseInt(currentNet.networkId, 10),
                toAddress: params.to,
                amount: String(params.amount),
                contractAddress: params.contractAddress,
                fromDecimals: (params.decimals != null) ? params.decimals : 18,
                privateKey: priv,
                publicKey: pub,
                gasLimit: resolveSendGasLimit(TOKEN_SEND_GAS),
                advancedSigningEnabled: fullSign
            });
        }

        if (!result || !result.success || !result.txHash) {
            throw new Error((result && result.error) ? String(result.error) : "Transaction submission failed.");
        }

        // Hand off to background for confirmation polling + transactionResult (so the
        // dApp still gets the result even if this popup is closed), then show the
        // post-send status dialog and poll here to drive its waiting -> completion UI.
        await replyBroadcast(result.txHash, wallet.address);
        hideWaitingBox();
        var approveBtn = el("dappApproveBtn");
        if (approveBtn) approveBtn.disabled = true;
        showSendCompletedDialog(result.txHash, wallet.address);
    }

    // ---- flow: generic transaction (verified to/data/value) --------------
    async function doSendTransaction(params, password) {
        var from = params.from;
        var wallet = await walletGetByAddress(password, from);
        if (!wallet) {
            throw new Error(t("dappUnlockFailed", "Could not unlock the sending account (wrong password?)."));
        }

        await ensureNetwork();
        var net = networkInfo();
        if (!net) throw new Error(t("dappNoNetwork", "No blockchain network is configured."));

        var priv = await wallet.getPrivateKey();
        var pub = await wallet.getPublicKey();
        var fullSign = await getAdvancedSigningEnabled();

        updateWaitingBox(t("pleaseWaitSubmit", "Please wait while your request is being submitted."));

        var result = await submitSendTransaction({
            rpcEndpoint: currentNet.rpcEndpoint,
            chainId: parseInt(currentNet.networkId, 10),
            to: params.to,
            data: params.data,
            value: params.value,
            privateKey: priv,
            publicKey: pub,
            gasLimit: resolveSendGasLimit(TX_SEND_GAS),
            advancedSigningEnabled: fullSign
        });

        if (!result || !result.success || !result.txHash) {
            throw new Error((result && result.error) ? String(result.error) : "Transaction submission failed.");
        }

        await replyBroadcast(result.txHash, wallet.address);
        hideWaitingBox();
        var approveBtn = el("dappApproveBtn");
        if (approveBtn) approveBtn.disabled = true;
        showSendCompletedDialog(result.txHash, wallet.address);
    }

    // ---- unified approve handler -----------------------------------------
    async function runApprove(password) {
        switch (pendingRequest.method) {
            case "qc_requestAccounts":
                await doConnect(pendingRequest.origin || "", password);
                break;
            case "qc_signMessage":
                await doSign(pendingRequest.params || {}, password);
                break;
            case "qc_sendToken":
            case "qc_sendCoin":
                await doSend(pendingRequest.method, pendingRequest.params || {}, password);
                break;
            case "qc_sendTransaction":
                await doSendTransaction(pendingRequest.params || {}, password);
                break;
        }
    }

    function onApprove() {
        var approveBtn = el("dappApproveBtn");

        // Connect + locked: first click unlocks (loads accounts, shows the
        // dropdown). The connect popup requires the "i agree" confirmation like the
        // other flows, checked BEFORE the password so an empty/incorrect
        // confirmation is reported first.
        if (pendingRequest.method === "qc_requestAccounts" && connectState === "locked") {
            if (!checkIAgree()) return;
            var lockPwd = el("dappPassword");
            var lockPassword = lockPwd ? lockPwd.value : "";
            if (!lockPassword) { setStatus(t("dapp-password-required", "Password is required.")); return; }
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
        // confirmation is reported first (mirrors the sidebar transaction-review flow).
        if (!checkIAgree()) return;

        var pwd = el("dappPassword");
        var password = pwd ? pwd.value : "";
        if (!password) { setStatus(t("dapp-password-required", "Password is required.")); return; }
        setStatus("");

        if (approveBtn) approveBtn.disabled = true;
        showLoadingAndExecuteAsync(initialWaitMessage(pendingRequest.method), function () {
            runApprove(password).catch(function (e) {
                hideWaitingBox();
                if (approveBtn) approveBtn.disabled = false;
                setStatus(errMsg(e));
            });
        });
    }

    // Initial "please wait" text shown while the (slow) wallet decrypt runs,
    // before each flow updates it with a step-specific message.
    function initialWaitMessage(method) {
        if (method === "qc_signMessage") return t("dapp-signing", "Please wait while the request is being signed.");
        if (method === "qc_sendToken" || method === "qc_sendCoin" || method === "qc_sendTransaction") return t("pleaseWaitSubmit", "Please wait while your request is being submitted.");
        return t("dapp-connecting", "Please wait while connecting...");
    }

    // ---- rendering -------------------------------------------------------
    // True when at least one wallet has been created/restored in this extension.
    async function hasAnyWallet() {
        try {
            return (await walletGetMaxIndex()) >= 0;
        } catch (e) {
            return false;
        }
    }

    async function renderConnect(origin) {
        el("dappTitle").textContent = t("dapp-connect-title", "Connect Wallet");
        setStatus("");

        // No wallet exists yet: there is nothing to connect. Hide the approval
        // card entirely and present an OK-only error pane; OK (or closing the
        // popup) rejects the request.
        if (!(await hasAnyWallet())) {
            showErrorOnlyReject(t("dapp-no-wallet", "No wallet found. Create or restore a wallet before connecting."));
            return;
        }

        // One-time wiring: dropdown change + copy/explorer icons. These read
        // selectedConnectAddress at click time.
        var sel = el("dappAccountSelect");
        if (sel) sel.addEventListener("change", function () { setSelectedConnectAddress(sel.value); });

        var copyBtn = el("dappCopyAddr");
        if (copyBtn) copyBtn.addEventListener("click", function () {
            if (!selectedConnectAddress) return;
            try { WriteTextToClipboard(selectedConnectAddress); } catch (e) { /* ignore */ }
        });

        var expBtn = el("dappExplorerAddr");
        if (expBtn) expBtn.addEventListener("click", async function () {
            if (!selectedConnectAddress) return;
            try {
                await ensureNetwork();
                var net = networkInfo();
                if (net && net.blockExplorerDomain) {
                    await OpenUrl("https://" + net.blockExplorerDomain + "/account/" + selectedConnectAddress);
                }
            } catch (e) { setStatus(errMsg(e)); }
        });

        // If the docked wallet is unlocked, its current address is shared and we
        // can show it as the default (Sign & Connect, single click). Otherwise the
        // first click must Unlock (which then reveals the account dropdown).
        var sessionAddress = await readSessionAddress();
        if (sessionAddress) {
            connectState = "ready";
            connectAccounts = null;
            show("dappConnectScreen", true);
            if (sel) sel.style.display = "none";
            setSelectedConnectAddress(sessionAddress);
            el("dappApproveBtn").textContent = t("dapp-connect", "Sign & Connect");
            showIAgreeRow(true);
        } else {
            connectState = "locked";
            show("dappConnectScreen", false);
            el("dappApproveBtn").textContent = t("dapp-unlock", "Unlock");
            showIAgreeRow(true);
        }
    }

    function renderSign(origin, params) {
        el("dappTitle").textContent = t("dapp-sign-title", "Sign Message");
        renderAccountRow(params.address);
        show("dappSignScreen", true);
        el("dappSignMessage").textContent = String(params.message == null ? "" : params.message);
        el("dappApproveBtn").textContent = t("dapp-sign", "Sign");
        showIAgreeRow(true);
        setStatus("");
    }

    function renderSend(origin, method, params) {
        var isCoin = (method === "qc_sendCoin");
        el("dappTitle").textContent = isCoin ? t("dapp-sendcoin-title", "Send Coins") : t("dapp-send-title", "Send Tokens");
        renderAccountRow(params.from);
        show("dappSendReviewScreen", true);
        el("dappSendTo").textContent = params.to || "";
        el("dappSendAmount").textContent = String(params.amount == null ? "" : params.amount);
        if (isCoin) {
            show("dappSendContractRow", false);
        } else {
            show("dappSendContractRow", true);
            el("dappSendContract").textContent = params.contractAddress || "";
        }
        el("dappSendJson").textContent = JSON.stringify(
            { method: method, to: params.to, contractAddress: params.contractAddress, amount: params.amount, from: params.from },
            null, 2
        );
        el("dappApproveBtn").textContent = t("dapp-send", "Sign & Send");
        showIAgreeRow(true);
        setStatus("");

        // Show the gas icon/fee (parity with the Send screen) and kick off the
        // live estimate. Errors are non-fatal; the default gas is used on failure.
        dappGasConfig = { gasLimit: null, gasFee: null, overridden: false };
        show("dappGasHeaderRight", true);
        estimateSendGas(method, params).catch(function () { setGasIconPulse(false); });
    }

    // ---- rendering: generic transaction (WYSIWYS) ------------------------
    function formatValueQ(decimalStr) {
        var s = (decimalStr == null || decimalStr === "") ? "0" : String(decimalStr);
        return s + " " + GAS_FEE_UNIT_LABEL;
    }

    // Render the decoded argument list. Values are dApp-influenced (only through
    // the exact signed bytes), so they are set via textContent, never innerHTML.
    function renderTxParams(args) {
        var box = el("dappTxParams");
        if (!box) return;
        box.innerHTML = "";
        if (!args || !args.length) { show("dappTxParams", false); return; }
        show("dappTxParams", true);
        var title = document.createElement("div");
        title.className = "heading medium";
        title.textContent = t("dapp-parameters", "Parameters");
        box.appendChild(title);
        args.forEach(function (a, i) {
            var row = document.createElement("div");
            row.style.cssText = "font-size:0.8em; word-break:break-all; margin-top:4px; padding-left:6px;";
            row.textContent = (a.name || ("arg" + i)) + " (" + (a.type || "") + "): " + (a.value == null ? "" : String(a.value));
            box.appendChild(row);
        });
    }

    // Decode + strictly verify the pending generic transaction before showing any
    // approvable UI. On any decode/mismatch failure, present an OK-only reject
    // dialog so a tampered/unverifiable transaction can never be signed.
    async function renderTransaction(origin, params) {
        el("dappTitle").textContent = t("dapp-tx-title", "Confirm Transaction");
        setStatus(t("dapp-decoding", "Verifying transaction…"));
        el("dappApproveBtn").disabled = true;

        await ensureNetwork();
        var net = networkInfo();
        var decoded;
        try {
            decoded = await decodeTransaction({
                rpcEndpoint: currentNet ? currentNet.rpcEndpoint : null,
                chainId: net ? net.chainId : (params.chainId || 0),
                to: params.to,
                data: params.data,
                value: params.value,
                abi: params.abi,
                bytecode: params.bytecode
            });
        } catch (e) {
            showErrorOnlyReject(errMsg(e));
            return;
        }
        if (!decoded || !decoded.success) {
            showErrorOnlyReject((decoded && decoded.error) ? decoded.error : null);
            return;
        }

        renderAccountRow(params.from);
        show("dappTxScreen", true);
        if (decoded.kind === "deploy") {
            el("dappTxTarget").textContent = t("dapp-contract-creation", "Contract creation");
        } else {
            el("dappTxTarget").textContent = t("dapp-to", "To") + ": " + (decoded.to || "");
        }
        el("dappTxValue").textContent = formatValueQ(decoded.valueDecimal);
        if (decoded.method) {
            show("dappTxMethodRow", true);
            el("dappTxMethod").textContent = decoded.signature || decoded.method;
        } else {
            show("dappTxMethodRow", false);
        }
        renderTxParams(decoded.args);
        el("dappTxData").textContent = params.data || "0x";

        el("dappApproveBtn").textContent = t("dapp-send", "Sign & Send");
        el("dappApproveBtn").disabled = false;
        showIAgreeRow(true);
        setStatus("");

        // Gas controls (parity with the Send screen).
        dappGasConfig = { gasLimit: null, gasFee: null, overridden: false };
        show("dappGasHeaderRight", true);
        estimateGenericGas(params).catch(function () { setGasIconPulse(false); });
    }

    // ---- entry point -----------------------------------------------------
    async function initDappApproval() {
        installErrorGuards();
        document.documentElement.setAttribute("data-view", "approval");

        await loadLang();
        fillLang();
        wirePasswordToggle();
        wireGasControls();

        // Popup title (browser window + header banner) is always "QuantumSwap".
        document.title = "QuantumSwap";
        var titleEl = el("divWalletTitle");
        if (titleEl) titleEl.textContent = t("title", "QuantumSwap");

        setStatus(t("dapp-loading", "Loading request…"));

        el("dappRejectBtn").addEventListener("click", function () {
            replyReject("User rejected the request").catch(function () { closeWindow(); });
        });
        el("dappApproveBtn").addEventListener("click", onApprove);

        try {
            var res = await sendToBackground({ type: "qc-approval-getRequest", requestId: REQUEST_ID });
            if (!res || !res.ok || !res.request) {
                setStatus(t("dapp-request-unavailable", "This request is no longer available."));
                el("dappApproveBtn").disabled = true;
                return;
            }
            pendingRequest = res.request;
            var origin = pendingRequest.origin || "";
            var params = pendingRequest.params || {};
            el("dappOrigin").textContent = origin;

            // Reject incompatible / malformed requests up front: show the message,
            // disable Approve, and don't render the request screen (Reject stays).
            var verr = await validateApprovalRequest(pendingRequest.method, params);
            if (verr) {
                setStatus(verr);
                el("dappApproveBtn").disabled = true;
                return;
            }

            switch (pendingRequest.method) {
                case "qc_requestAccounts":
                    await renderConnect(origin);
                    break;
                case "qc_signMessage":
                    renderSign(origin, params);
                    break;
                case "qc_sendToken":
                case "qc_sendCoin":
                    renderSend(origin, pendingRequest.method, params);
                    break;
                case "qc_sendTransaction":
                    await renderTransaction(origin, params);
                    break;
                default:
                    setStatus("Unsupported request: " + pendingRequest.method);
                    el("dappApproveBtn").disabled = true;
            }
        } catch (e) {
            setStatus(errMsg(e));
        }
    }

    // dapp.js loads only on approve.html, so self-boot on DOM ready.
    window.initDappApproval = initDappApproval;
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { initDappApproval(); });
    } else {
        initDappApproval();
    }
})();
