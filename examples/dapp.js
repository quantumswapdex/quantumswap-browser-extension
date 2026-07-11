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
    var btnDeployToken = document.getElementById("btnDeployToken");
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
        btnDeployToken.disabled = !isConnected;
        btnSendToken.disabled = !isConnected;
        btnSendCoin.disabled = !isConnected;
        btnConnect.disabled = isConnected;
    }

    // ---- minimal Solidity ABI encoder for constructor(string,string,uint256) --
    // The provider exposes only request(); it does not ship an ABI coder, so the
    // dApp builds the deployment calldata itself. This must byte-match the wallet's
    // encoder or the WYSIWYS verification will (correctly) reject the deployment.
    function abiUint256(n) {
        var h = BigInt(n).toString(16);
        return "0".repeat(64 - h.length) + h;
    }
    function padRight32(hex) {
        while (hex.length % 64 !== 0) hex += "0";
        return hex;
    }
    function utf8ToHex(str) {
        var bytes = new TextEncoder().encode(str);
        var hex = "";
        for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
        return { hex: hex, len: bytes.length };
    }
    function abiEncodeString(str) {
        var e = utf8ToHex(str);
        return abiUint256(e.len) + padRight32(e.hex);
    }
    // ABI-encode (string, string, uint256): two dynamic offsets + inline uint,
    // followed by each string's (length, data) tail.
    function encodeErc20ConstructorArgs(name, symbol, supply) {
        var s1 = abiEncodeString(name);
        var s2 = abiEncodeString(symbol);
        var off1 = 96;                    // 3 head words * 32 bytes
        var off2 = 96 + s1.length / 2;    // hex chars / 2 = bytes
        return abiUint256(off1) + abiUint256(off2) + abiUint256(supply) + s1 + s2;
    }

    // ABI for the deployment: only the constructor is needed for the wallet's
    // decode + re-encode verification. Its input types must match the encoding
    // above exactly (string, string, uint256).
    var ERC20_DEPLOY_ABI = [
        {
            type: "constructor",
            inputs: [
                { name: "name_", type: "string" },
                { name: "symbol_", type: "string" },
                { name: "initialSupply_", type: "uint256" }
            ]
        }
    ];

    // Creation bytecode for examples/DemoERC20.sol, compiled with
    // `solc 0.7.6 --optimize --bin`. Constructor is (string,string,uint256), so the
    // page appends abi.encode(name, symbol, supplyWei) to form the deployment data.
    var ERC20_CREATION_BYTECODE = "0x608060405234801561001057600080fd5b506040516108573803806108578339818101604052606081101561003357600080fd5b810190808051604051939291908464010000000082111561005357600080fd5b90830190602082018581111561006857600080fd5b825164010000000081118282018810171561008257600080fd5b82525081516020918201929091019080838360005b838110156100af578181015183820152602001610097565b50505050905090810190601f1680156100dc5780820380516001836020036101000a031916815260200191505b50604052602001805160405193929190846401000000008211156100ff57600080fd5b90830190602082018581111561011457600080fd5b825164010000000081118282018810171561012e57600080fd5b82525081516020918201929091019080838360005b8381101561015b578181015183820152602001610143565b50505050905090810190601f1680156101885780820380516001836020036101000a031916815260200191505b5060405260209081015185519093506101a79250600091860190610210565b5081516101bb906001906020850190610210565b506002819055336000818152600360209081526040808320859055805185815290517fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef929181900390910190a35050506102b1565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282610246576000855561028c565b82601f1061025f57805160ff191683800117855561028c565b8280016001018555821561028c579182015b8281111561028c578251825591602001919060010190610271565b5061029892915061029c565b5090565b5b80821115610298576000815560010161029d565b610597806102c06000396000f3fe608060405234801561001057600080fd5b50600436106100935760003560e01c8063313ce56711610066578063313ce5671461018f57806370a08231146101ad57806395d89b41146101ca578063a9059cbb146101d2578063dd62ed3e146101f557610093565b806306fdde0314610098578063095ea7b31461011557806318160ddd1461014c57806323b872dd14610166575b600080fd5b6100a0610218565b6040805160208082528351818301528351919283929083019185019080838360005b838110156100da5781810151838201526020016100c2565b50505050905090810190601f1680156101075780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b6101386004803603604081101561012b57600080fd5b50803590602001356102a6565b604080519115158252519081900360200190f35b610154610301565b60408051918252519081900360200190f35b6101386004803603606081101561017c57600080fd5b5080359060208101359060400135610307565b6101976103aa565b6040805160ff9092168252519081900360200190f35b610154600480360360208110156101c357600080fd5b50356103af565b6100a06103c1565b610138600480360360408110156101e857600080fd5b508035906020013561041b565b6101546004803603604081101561020b57600080fd5b5080359060200135610431565b6000805460408051602060026001851615610100026000190190941693909304601f8101849004840282018401909252818152929183018282801561029e5780601f106102735761010080835404028352916020019161029e565b820191906000526020600020905b81548152906001019060200180831161028157829003601f168201915b505050505081565b3360008181526004602090815260408083208684528252808320859055805185815290519293869390927f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925928290030190a350600192915050565b60025481565b600083815260046020908152604080832033845290915281205482811015610376576040805162461bcd60e51b815260206004820152601d60248201527f45524332303a20696e73756666696369656e7420616c6c6f77616e6365000000604482015290519081900360640190fd5b60008581526004602090815260408083203384529091529020838203905561039f85858561044e565b506001949350505050565b601281565b60036020526000908152604090205481565b60018054604080516020600284861615610100026000190190941693909304601f8101849004840282018401909252818152929183018282801561029e5780601f106102735761010080835404028352916020019161029e565b600061042833848461044e565b50600192915050565b600460209081526000928352604080842090915290825290205481565b816104a0576040805162461bcd60e51b815260206004820152601f60248201527f45524332303a207472616e7366657220746f207a65726f206164647265737300604482015290519081900360640190fd5b60008381526003602052604090205481811015610504576040805162461bcd60e51b815260206004820152601b60248201527f45524332303a20696e73756666696369656e742062616c616e63650000000000604482015290519081900360640190fd5b600084815260036020908152604080832085850390558583529182902080548501905581518481529151859287927fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef92918290030190a35050505056fea26469706673582212200b2e233de7ebe8fc1822698a61c017381ddb52fc2b71c4c0579326630d294e3664736f6c63430007060033";

    // Convert a whole-token amount (optionally fractional, up to 18 decimals) to
    // 18-decimal base units (wei). Throws on malformed input.
    function tokensToWei(input) {
        var s = String(input == null ? "" : input).trim();
        if (s === "") s = "0";
        if (!/^\d+(\.\d+)?$/.test(s)) {
            throw new Error("Initial supply must be a non-negative number.");
        }
        var parts = s.split(".");
        var whole = parts[0] || "0";
        var frac = parts[1] || "";
        if (frac.length > 18) {
            throw new Error("Initial supply supports at most 18 decimal places.");
        }
        frac = (frac + "0".repeat(18)).slice(0, 18);
        return BigInt(whole) * (10n ** 18n) + BigInt(frac);
    }

    function getProvider() {
        return window.quantumcoin;
    }

    // Return the provider, or surface a visible error (alert + log) and return
    // null when it is missing, so a button click never silently does nothing.
    function requireProvider() {
        var provider = getProvider();
        if (!provider) {
            var msg = "No QuantumCoin web3 provider found. Install/enable the QuantumSwap extension, then reload this page.";
            providerStateEl.textContent = "not found (is the extension installed?)";
            log("error: no provider", msg);
            window.alert(msg);
            return null;
        }
        return provider;
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
        provider.on("transactionResult", function (result) {
            log("event: transactionResult", result);
            var status = result && result.status ? String(result.status) : "unknown";
            var txHash = result && result.txHash ? String(result.txHash) : "";
            if (status === "succeeded") {
                window.alert("Transaction successful\n" + txHash);
            } else if (status === "timeout") {
                window.alert("Transaction still pending (timed out waiting for confirmation)\n" + txHash);
            } else {
                window.alert("Transaction failed (" + status + ")\n" + txHash);
            }
        });
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
        var provider = requireProvider();
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
        var provider = requireProvider();
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
        var provider = requireProvider();
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

    // Poll eth_getTransactionReceipt (via the wallet's read passthrough) until the
    // transaction is mined, or give up after ~2 minutes. Returns the receipt or null.
    async function waitForReceipt(provider, txHash, tries, intervalMs) {
        tries = tries || 40;
        intervalMs = intervalMs || 3000;
        for (var i = 0; i < tries; i++) {
            try {
                var r = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
                if (r) return r;
            } catch (e) {
                log("warn: eth_getTransactionReceipt", String(e && e.message || e));
            }
            await new Promise(function (resolve) { setTimeout(resolve, intervalMs); });
        }
        return null;
    }

    btnDeployToken.addEventListener("click", async function () {
        var provider = requireProvider();
        if (!provider) return;

        var name = document.getElementById("tokenNameInput").value;
        var symbol = document.getElementById("tokenSymbolInput").value;
        var supplyTokens = document.getElementById("tokenSupplyInput").value.trim();

        var supplyWei;
        try {
            supplyWei = tokensToWei(supplyTokens);
        } catch (e) {
            var m = String(e && e.message || e);
            log("error: deploy", m);
            window.alert(m);
            return;
        }

        // data = bytecode ++ abi.encode(name, symbol, supplyWei)
        var argsHex = encodeErc20ConstructorArgs(name, symbol, supplyWei);
        var data = ERC20_CREATION_BYTECODE + argsHex;

        var params = {
            // no `to` => contract creation
            data: data,
            value: "0x0",
            abi: ERC20_DEPLOY_ABI,
            bytecode: ERC20_CREATION_BYTECODE
        };
        try {
            log("request: qc_sendTransaction (deploy ERC20)", {
                name: name,
                symbol: symbol,
                supplyTokens: supplyTokens,
                supplyWei: supplyWei.toString()
            });
            var res = await provider.request({ method: "qc_sendTransaction", params: params });
            log("result: deploy", res);

            var txHash = res && res.txHash ? res.txHash : (typeof res === "string" ? res : null);
            if (txHash) {
                log("info: deploy", "Waiting for the deployment receipt (eth_getTransactionReceipt)…");
                var receipt = await waitForReceipt(provider, txHash);
                if (!receipt) {
                    log("info: deploy", "Timed out waiting for the receipt; check the explorer for " + txHash);
                } else if (receipt.status && receipt.status !== "0x1") {
                    log("result: deploy receipt (failed)", receipt);
                } else if (receipt.contractAddress) {
                    log("result: deploy receipt", { contractAddress: receipt.contractAddress, status: receipt.status });
                    // Bridge step 3 -> step 4: prefill the "Send Tokens" contract field.
                    var contractField = document.getElementById("contractInput");
                    if (contractField) contractField.value = receipt.contractAddress;
                    log("info: deploy", "Token contract address filled into step 4: " + receipt.contractAddress);
                } else {
                    log("result: deploy receipt (no contractAddress)", receipt);
                }
            }
        } catch (e) {
            log("error: deploy", String(e && e.message || e));
        }
    });

    // Left-pad a hex string (no 0x) to a full 32-byte ABI word.
    function padLeft32(hex) {
        var clean = hex.replace(/^0x/i, "");
        return "0".repeat(Math.max(0, 64 - clean.length)) + clean;
    }

    // ERC20 transfer(address,uint256) calldata: selector 0xa9059cbb + recipient
    // word + amount word. The wallet re-encodes this from the supplied `abi` and
    // rejects (WYSIWYS) if it does not byte-match, so token transfers get the same
    // decode-and-verify review as any other qc_sendTransaction.
    var ERC20_TRANSFER_ABI = [
        {
            type: "function",
            name: "transfer",
            stateMutability: "nonpayable",
            inputs: [
                { name: "to", type: "address" },
                { name: "amount", type: "uint256" }
            ],
            outputs: [{ name: "", type: "bool" }]
        }
    ];
    function encodeErc20Transfer(toAddr, amountBig) {
        return "0xa9059cbb" + padLeft32(toAddr) + abiUint256(amountBig);
    }

    // Token transfer is a standard qc_sendTransaction (eth_sendTransaction) to the
    // token contract with ERC20 transfer(...) calldata. The demo token uses 18
    // decimals, matching the deploy step above.
    btnSendToken.addEventListener("click", async function () {
        var provider = requireProvider();
        if (!provider) return;
        var contract = document.getElementById("contractInput").value.trim();
        var to = document.getElementById("toInput").value.trim();
        var amountTokens = document.getElementById("amountInput").value.trim();

        var amountWei;
        try {
            amountWei = tokensToWei(amountTokens);
        } catch (e) {
            var m = String(e && e.message || e);
            log("error: sendToken", m);
            window.alert(m);
            return;
        }

        var params = {
            to: contract,
            data: encodeErc20Transfer(to, amountWei),
            value: "0x0",
            abi: ERC20_TRANSFER_ABI
        };
        try {
            log("request: qc_sendTransaction (ERC20 transfer)", { contract: contract, to: to, amount: amountTokens });
            var res = await provider.request({ method: "qc_sendTransaction", params: params });
            log("result: sendToken", res);
        } catch (e) {
            log("error: sendToken", String(e && e.message || e));
        }
    });

    // Native coin transfer is a standard qc_sendTransaction with `to` + `value`
    // (wei), mirroring eth_sendTransaction. Amount is entered in whole coins.
    btnSendCoin.addEventListener("click", async function () {
        var provider = requireProvider();
        if (!provider) return;
        var to = document.getElementById("toInput").value.trim();
        var amountCoins = document.getElementById("amountInput").value.trim();

        var valueWei;
        try {
            valueWei = tokensToWei(amountCoins);
        } catch (e) {
            var m = String(e && e.message || e);
            log("error: sendCoin", m);
            window.alert(m);
            return;
        }

        var params = {
            to: to,
            value: "0x" + valueWei.toString(16)
        };
        try {
            log("request: qc_sendTransaction (native transfer)", { to: to, amount: amountCoins });
            var res = await provider.request({ method: "qc_sendTransaction", params: params });
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
