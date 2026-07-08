// Test-page driver for the QuantumSwap web3 provider (window.quantumcoin).
// Demonstrates connect -> sign -> send and logs every provider event, including
// the background-emitted `transactionResult` (which fires even if the approval
// popup was closed right after signing).
(function () {
    "use strict";

    var logEl = document.getElementById("log");
    var accountEl = document.getElementById("account");
    var chainEl = document.getElementById("chainId");
    var providerStateEl = document.getElementById("providerState");

    var btnConnect = document.getElementById("btnConnect");
    var btnDisconnect = document.getElementById("btnDisconnect");
    var btnSign = document.getElementById("btnSign");
    var btnSendToken = document.getElementById("btnSendToken");
    var btnSendCoin = document.getElementById("btnSendCoin");

    var connected = false;

    function log(label, data) {
        var line = "[" + new Date().toLocaleTimeString() + "] " + label;
        if (data !== undefined) {
            line += " " + (typeof data === "string" ? data : JSON.stringify(data));
        }
        logEl.textContent += line + "\n";
        logEl.scrollTop = logEl.scrollHeight;
    }

    function setConnected(isConnected, address, chainId) {
        connected = isConnected;
        accountEl.textContent = isConnected && address ? address : "(none)";
        chainEl.textContent = isConnected && chainId != null ? String(chainId) : "(none)";
        btnDisconnect.disabled = !isConnected;
        btnSign.disabled = !isConnected;
        btnSendToken.disabled = !isConnected;
        btnSendCoin.disabled = !isConnected;
        btnConnect.disabled = isConnected;
    }

    function getProvider() {
        return window.quantumcoin;
    }

    function wireEvents(provider) {
        provider.on("connect", function (info) { log("event: connect", info); });
        provider.on("disconnect", function (info) {
            log("event: disconnect", info);
            setConnected(false);
        });
        provider.on("accountsChanged", function (accounts) {
            log("event: accountsChanged", accounts);
            if (!accounts || accounts.length === 0) setConnected(false);
            else setConnected(true, accounts[0], chainEl.textContent);
        });
        provider.on("chainChanged", function (chainId) { log("event: chainChanged", chainId); });
        provider.on("transactionResult", function (result) { log("event: transactionResult", result); });
    }

    function initProvider() {
        var provider = getProvider();
        if (!provider) {
            providerStateEl.textContent = "not found (is the extension installed?)";
            return false;
        }
        providerStateEl.textContent = "ready";
        wireEvents(provider);
        return true;
    }

    btnConnect.addEventListener("click", async function () {
        var provider = getProvider();
        if (!provider) return;
        try {
            log("request: qc_requestAccounts");
            var accounts = await provider.request({ method: "qc_requestAccounts" });
            log("result: accounts", accounts);
            var chainId = await provider.request({ method: "qc_chainId" });
            log("result: chainId", chainId);
            setConnected(true, accounts && accounts[0], chainId);
        } catch (e) {
            log("error: connect", String(e && e.message || e));
        }
    });

    btnDisconnect.addEventListener("click", async function () {
        var provider = getProvider();
        if (!provider) return;
        try {
            log("request: qc_disconnect");
            await provider.request({ method: "qc_disconnect" });
            setConnected(false);
        } catch (e) {
            log("error: disconnect", String(e && e.message || e));
        }
    });

    btnSign.addEventListener("click", async function () {
        var provider = getProvider();
        if (!provider) return;
        var message = document.getElementById("signInput").value;
        try {
            log("request: qc_signMessage", message);
            var signature = await provider.request({ method: "qc_signMessage", params: { message: message } });
            log("result: signature", signature);
            window.alert("Signed Successfully");
        } catch (e) {
            // Includes the "User rejected the request" case raised when the
            // approval popup is closed without signing.
            var reason = String(e && e.message || e);
            log("error: sign", reason);
            window.alert("Sign failed: " + reason);
        }
    });

    btnSendToken.addEventListener("click", async function () {
        var provider = getProvider();
        if (!provider) return;
        var params = {
            contractAddress: document.getElementById("contractInput").value.trim(),
            to: document.getElementById("toInput").value.trim(),
            amount: document.getElementById("amountInput").value.trim()
        };
        try {
            log("request: qc_sendToken", params);
            var res = await provider.request({ method: "qc_sendToken", params: params });
            log("result: sendToken", res);
        } catch (e) {
            log("error: sendToken", String(e && e.message || e));
        }
    });

    btnSendCoin.addEventListener("click", async function () {
        var provider = getProvider();
        if (!provider) return;
        var params = {
            to: document.getElementById("toInput").value.trim(),
            amount: document.getElementById("amountInput").value.trim()
        };
        try {
            log("request: qc_sendCoin", params);
            var res = await provider.request({ method: "qc_sendCoin", params: params });
            log("result: sendCoin", res);
        } catch (e) {
            log("error: sendCoin", String(e && e.message || e));
        }
    });

    // The provider may be injected at document_start (before this script) or
    // announce itself via the quantumcoin#initialized event.
    if (!initProvider()) {
        window.addEventListener("quantumcoin#initialized", function () {
            log("provider announced");
            initProvider();
        });
    }

    log("test page loaded");
})();
