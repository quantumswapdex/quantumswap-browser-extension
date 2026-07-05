const HTTPS = "https://";
const HTTP = "http://";
const ADDRESS_LENGTH_CHECK = 64

// Use HTTP for localhost or any IP address; HTTPS for other domains
const isHttpAllowedDomain = (domain) => {
    if (domain.startsWith("localhost:")) return true;
    return /^(\d{1,3}\.){3}\d{1,3}(:[0-9]{1,5})?$/.test(domain);
};

class AccountDetails {
    constructor(address, nonce, balance) {
        if (address.startsWith("0x") == false) {
            address = "0x" + address
        }
        this.address = address;
        this.nonce = nonce;
        this.balance = balance;
    }
}

class TransactionDetails {
    constructor(hash, createdAt, from, to, value, status) {
        this.hash = hash;
        this.createdAt = createdAt;
        this.from = from;
        this.to = to;
        this.value = value;
        this.status = status;
    }
}

class AccountTokenDetails {
    constructor(tokenBalance, contractAddress, name, symbol) {
        this.tokenBalance = tokenBalance;
        this.contractAddress = contractAddress;
        this.name = name;
        this.symbol = symbol;
    }
}

async function getAccountDetails(scanApiDomain, address) {
    let url = HTTPS;
    if(isHttpAllowedDomain(scanApiDomain)) {
        url = HTTP;
    }
    url = url + scanApiDomain + "/account/" + address;
    let nonce = 0;
    let balance = "0";

    const response = await fetch(url);
    const jsonObj = await response.json();
    const result = jsonObj.result;
    if (result != null) {
        if (result.nonce != null) {
            let tempNonce = parseInt(result.nonce);
            if (Number.isInteger(tempNonce) == true) {
                nonce = tempNonce;
            } else {
                throw new Error(langJson.errors.invalidApiResponse);
            }
        }

        if (result.balance != null) {
            if (isLargeNumber(result.balance) == false) {
                throw new Error(langJson.errors.invalidApiResponse);
            } else {
                balance = result.balance;
            }
        }
    }

    let accountDetails = new AccountDetails(address, nonce, balance);
    return accountDetails;
}

async function getCompletedTransactionDetails(scanApiDomain, address, pageIndex) {
    let result = await getTransactionDetails(scanApiDomain, address, pageIndex, false);
    return result;
}

async function getPendingTransactionDetails(scanApiDomain, address, pageIndex) {
    let result = await getTransactionDetails(scanApiDomain, address, pageIndex, true);
    return result;
}

async function getTransactionDetails(scanApiDomain, address, pageIndex, isPending) {
    let url = HTTPS;
    if(isHttpAllowedDomain(scanApiDomain)) {
        url = HTTP;
    }

    if (isPending) {
        url = url + scanApiDomain + "/account/" + address + "/transactions/pending/" + pageIndex;
    } else {
        url = url + scanApiDomain + "/account/" + address + "/transactions/" + pageIndex;
    }

    const response = await fetch(url);

    const jsonObj = await response.json();
    const result = jsonObj;
    const pageCountString = result.pageCount;

    if (result == null || pageCountString == null) {
        throw new Error("invalid result");
    }

    let pageCount = parseInt(pageCountString);
    if (isNumber(pageCount) == false || pageCount < 0) {
        throw new Error("invalid pageCount");
    }

    if (result.items == null || result.items.length == 0 || pageCount == 0) {
        return null;
    }

    if (pageIndex > pageCount) {
        return  {
            transactionList: null,
            pageCount: pageCount
        };
    }

    var transactionList = [];

    if (Array.isArray(result.items) === false) {
        return null;
    }

    for (var i = 0; i < result.items.length; i++) {
        let txn = result.items[i];

        if (txn.hash == null || txn.hash.length < ADDRESS_LENGTH_CHECK || await IsValidAddress(txn.hash) == false) {
            throw new Error("invalid hash");
        }
        if (txn.from == null || txn.from.length < ADDRESS_LENGTH_CHECK || await IsValidAddress(txn.from) == false) {
            throw new Error("invalid fromAddress");
        }
        if (txn.to != null &&  (txn.to.length < ADDRESS_LENGTH_CHECK || await IsValidAddress(txn.to) == false)) {
            throw new Error("invalid toAddress");
        }

        let txnDate = "";
        if (txn.createdAt == null || isValidDate(txn.createdAt) == false) {
            if(isPending === false) {
                throw new Error("invalid date");
            }
        } else {
            let txnDateString = (txn.createdAt.includes("UTC") || txn.createdAt.endsWith("Z")) ? txn.createdAt : txn.createdAt + 'Z';
            txnDate = new Date(txnDateString);
        }

        if (txn.value == null || isHex(txn.value) == false) {
            throw new Error("invalid value");
        }
        let status = false;
        if (txn.status !== null && txn.status == "0x1") {
            status = true;
        }

        let txnValue = await hexWeiToEthFormatted(txn.value);
        let transactionDetails = new TransactionDetails(txn.hash, txnDate, txn.from, txn.to, txnValue, status);
        transactionList.push(transactionDetails);
    }

    const transactionListDetails = {
        transactionList: transactionList,
        pageCount: pageCount
    }
    
    return transactionListDetails;
}

async function getTransactionStatusByHash(scanApiDomain, address, txHash) {
    if (!txHash || !address) return { status: 'unknown' };
    try {
        const pending = await getTransactionDetails(scanApiDomain, address, 0, true);
        if (pending && pending.transactionList) {
            for (let i = 0; i < pending.transactionList.length; i++) {
                if (pending.transactionList[i].hash === txHash) return { status: 'pending' };
            }
        }
        const completed = await getTransactionDetails(scanApiDomain, address, 0, false);
        if (completed && completed.transactionList) {
            for (let i = 0; i < completed.transactionList.length; i++) {
                const t = completed.transactionList[i];
                if (t.hash === txHash) return { status: t.status ? 'succeeded' : 'failed' };
            }
        }
    } catch (e) {
        return { status: 'unknown', error: (e && e.message) ? e.message : String(e) };
    }
    return { status: 'unknown' };
}

async function listAccountTokens(scanApiDomain, address, pageIndex) {
    let url = HTTPS;
    if(isHttpAllowedDomain(scanApiDomain)) {
        url = HTTP;
    }
    url = url + scanApiDomain + "/account/" + address + "/tokens/" + pageIndex;

    const response = await fetch(url);
    if (response.status === 404) {
        return null;
    }

    const jsonObj = await response.json();
    const result = jsonObj;

    if (result == null) {
        throw new Error("invalid result");
    }

    const pageCountString = result.pageCount;
    if (pageCountString == null) {
        throw new Error("invalid result");
    }

    let pageCount = parseInt(pageCountString);
    if (isNumber(pageCount) === false || pageCount < 0) {
        throw new Error("invalid pageCount");
    }

    if (result.items == null || result.items.length === 0 || pageCount === 0) {
        return null;
    }

    if (pageIndex > pageCount) {
        return  {
            transactionList: null,
            pageCount: pageCount
        };
    }

    var tokenList = [];

    if (Array.isArray(result.items) === false) {
        return null;
    }

    for (var i = 0; i < result.items.length; i++) {
        let token = result.items[i];
        let tokenName = "";
        let tokenSymbol = "";

        if (token.contractAddress == null || token.contractAddress.length < ADDRESS_LENGTH_CHECK || await IsValidAddress(token.contractAddress) === false) {
            throw new Error("invalid contractAddress");
        }

        if (token.tokenBalance == null || isHex(token.tokenBalance) === false) {
            throw new Error("invalid tokenBalance");
        }
        let tokenBalance = await hexWeiToEthFormatted(token.tokenBalance);

        if (token.name !== null && (typeof token.name === 'string' || token.name instanceof String)) {
            tokenName = token.name;
        }

        if (token.symbol !== null && (typeof token.symbol === 'string' || token.symbol instanceof String)) {
            tokenSymbol = token.symbol;
        }

        let tokenDetails = new AccountTokenDetails(tokenBalance, token.contractAddress, tokenName, tokenSymbol);
        tokenList.push(tokenDetails);
    }

    const tokenListDetails = {
        tokenList: tokenList,
        pageCount: pageCount
    }

    return tokenListDetails;
}