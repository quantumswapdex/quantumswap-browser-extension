async function WriteTextToClipboard(text) {
    await ClipboardApi.send('ClipboardWriteText', text);
}

async function OpenUrl(url) {
    (async () => {
        await ClipboardApi.send('OpenUrlInShell', url);
        return false;
    })().catch(e => {
        console.log(e);
    });    

    return false;
}

async function GetAppVersion() {
    let appVersion = await AppApi.send('AppApiGetVersion', null);
    return appVersion;
}

async function ReadFile(seedfile) {
    array = await FileApi.send('FileApiReadFile', seedfile);
    return array;
}

async function getLocalStoragePath() {
    keyStore = await LocalStorageApi.send('StorageApiGetPath', null);
    return keyStore;
}

async function weiToEther(wei) {
    let eth = await FormatApi.send('FormatApiWeiToEther', wei);
    return eth
}

async function etherToWei(eth) {
    let wei = await FormatApi.send('FormatApiEtherToWei', eth);
    return wei
}

function commify(value) {
    const match = value.match(/^(-?)([0-9]*)(\.?)([0-9]*)$/);
    if (!match || (!match[2] && !match[4])) {
        throw new Error(`bad formatted number: ${JSON.stringify(value)}`);
    }

    const neg = match[1];
    const whole = BigInt(match[2] || 0).toLocaleString("en-us");
    const frac = match[4] ? match[4].match(/^(.*?)0*$/)[1] : "0";

    return `${neg}${whole}.${frac}`;
}

async function weiToEtherFormatted(wei) {
    let eth = await FormatApi.send('FormatApiWeiToEther', wei);
    eth = commify(eth);

    if (eth.endsWith(".")) {
        eth = eth.substring(0, eth.length - 1);
    }

    return eth
}

async function hexWeiToEthFormatted(hex) {
    let wei = BigInt(hex).toString();
    let eth = await weiToEtherFormatted(wei);
    return eth;
}

async function isValidEther(quantity) {
    let isValid = await FormatApi.send('FormatApiIsValidEther', quantity);
    return isValid
}

async function compareEther(val1, val2) {
    const compareRequest = {
        num1: val1,
        num2: val2
    }
    let ret = await FormatApi.send('FormatApiCompareEther', compareRequest);
    return ret;
}

async function getSwapQuoteAmountsOut(payload) {
    return await SwapQuoteApi.send('SwapQuoteGetAmountsOut', payload);
}

async function getSwapQuoteAmountsIn(payload) {
    return await SwapQuoteApi.send('SwapQuoteGetAmountsIn', payload);
}

async function getSwapCheckPairExists(payload) {
    return await SwapQuoteApi.send('SwapQuoteCheckPairExists', payload);
}

async function getSwapEstimateGas(payload) {
    return await SwapQuoteApi.send('SwapQuoteEstimateGas', payload);
}

async function getSwapCheckAllowance(payload) {
    return await SwapQuoteApi.send('SwapQuoteCheckAllowance', payload);
}

async function getSwapEstimateApproveGas(payload) {
    return await SwapQuoteApi.send('SwapQuoteEstimateApproveGas', payload);
}

async function estimateGas(payload) {
    return await SwapQuoteApi.send('estimateGas', payload);
}

async function estimateGasFee(payload) {
    return await SwapQuoteApi.send('estimateGasFee', payload);
}

async function getSwapApproveContractData(payload) {
    return await SwapQuoteApi.send('SwapQuoteGetApproveContractData', payload);
}

async function getSwapRouterAddress() {
    return await SwapQuoteApi.send('SwapQuoteGetRouterAddress', {});
}

async function getSwapSwapContractData(payload) {
    return await SwapQuoteApi.send('SwapQuoteGetSwapContractData', payload);
}

async function submitSwapApproval(payload) {
    return await SwapQuoteApi.send('SwapSubmitApproval', payload);
}

async function submitSwapSwap(payload) {
    return await SwapQuoteApi.send('SwapSubmitSwap', payload);
}

async function submitSwapRemoveAllowance(payload) {
    return await SwapQuoteApi.send('SwapSubmitRemoveAllowance', payload);
}

async function submitSwapAddAllowance(payload) {
    return await SwapQuoteApi.send('SwapSubmitAddAllowance', payload);
}

async function submitSendCoins(payload) {
    return await SwapQuoteApi.send('SendCoinsSubmit', payload);
}

async function submitSendTokens(payload) {
    return await SwapQuoteApi.send('SendTokensSubmit', payload);
}

async function offlineSignCoinTransaction(payload) {
    return await SwapQuoteApi.send('OfflineSignCoinTransaction', payload);
}

async function offlineSignTokenTransaction(payload) {
    return await SwapQuoteApi.send('OfflineSignTokenTransaction', payload);
}

async function submitStakingContract(payload) {
    return await SwapQuoteApi.send('StakingContractSubmit', payload);
}

async function offlineSignStakingContract(payload) {
    return await SwapQuoteApi.send('StakingContractOfflineSign', payload);
}

async function cryptoRandomBytes(size) {
    return await CryptoApi.send('CryptoRandomBytes', size);
}

async function walletFromSeed(seedArray) {
    return await CryptoApi.send('WalletFromSeed', { seed: Array.from(seedArray) });
}

async function walletEncryptJson(privateKeyBase64, publicKeyBase64, passphrase) {
    return await CryptoApi.send('WalletEncryptJson', {
        privateKey: privateKeyBase64,
        publicKey: publicKeyBase64,
        passphrase: passphrase
    });
}

async function walletDecryptJson(json, passphrase) {
    return await CryptoApi.send('WalletDecryptJson', { json: json, passphrase: passphrase });
}

async function computeAddressFromPublicKey(publicKeyBase64) {
    return await CryptoApi.send('ComputeAddress', publicKeyBase64);
}

// EIP-191 message signing via quantumcoin.js. Returns { signature } (0x hex blob
// with the public key embedded). signingContext is optional (null => derived
// from the key type). When advancedSigningEnabled is true and no explicit
// signingContext is given, the handler signs with the full ("advanced") signing
// context (wallet.getSigningContext(true)).
async function signMessage(privateKeyBase64, publicKeyBase64, message, signingContext, advancedSigningEnabled) {
    return await CryptoApi.send('SignMessage', {
        privateKey: privateKeyBase64,
        publicKey: publicKeyBase64,
        message: message,
        signingContext: signingContext == null ? null : signingContext,
        advancedSigningEnabled: advancedSigningEnabled === true
    });
}

// Recover the signer address from an EIP-191 message signature. Returns
// { address }; rejects if the signature does not verify.
async function verifyMessage(message, signature) {
    return await CryptoApi.send('VerifyMessage', { message: message, signature: signature });
}

async function scryptDerive(secret, saltBase64) {
    return await CryptoApi.send('ScryptDerive', { secret: secret, salt: saltBase64 });
}