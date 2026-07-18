// Typed async wrappers over the IPC APIs exposed by the preload script.
// 1:1 port of the old src/js/bridge.js.

export async function WriteTextToClipboard(text: string): Promise<void> {
    await ClipboardApi.send("ClipboardWriteText", text);
}

export async function OpenUrl(url: string): Promise<boolean> {
    try {
        await ShellApi.send("OpenUrlInShell", url);
    } catch (e) {
        console.log(e);
    }
    return false;
}

export async function GetAppVersion(): Promise<string> {
    return await AppApi.send("AppApiGetVersion", null);
}

export async function GetPackageName(): Promise<string> {
    return await AppApi.send("AppApiGetPackageName", null);
}

export async function ReadFile(seedfile: string): Promise<string | null> {
    return await FileApi.send("FileApiReadFile", seedfile);
}

export async function getLocalStoragePath(): Promise<string> {
    return await LocalStorageApi.send("StorageApiGetPath", null);
}

export async function weiToEther(wei: string): Promise<string> {
    return await FormatApi.send("FormatApiWeiToEther", wei);
}

export async function etherToWei(eth: string): Promise<string> {
    return await FormatApi.send("FormatApiEtherToWei", eth);
}

export function commify(value: string): string {
    const match = value.match(/^(-?)([0-9]*)(\.?)([0-9]*)$/);
    if (!match || (!match[2] && !match[4])) {
        throw new Error(`bad formatted number: ${JSON.stringify(value)}`);
    }

    const neg = match[1];
    const whole = BigInt(match[2] || 0).toLocaleString("en-us");
    const frac = match[4] ? (match[4].match(/^(.*?)0*$/) as RegExpMatchArray)[1] : "0";

    return `${neg}${whole}.${frac}`;
}

export async function weiToEtherFormatted(wei: string): Promise<string> {
    let eth: string = await FormatApi.send("FormatApiWeiToEther", wei);
    eth = commify(eth);

    if (eth.endsWith(".")) {
        eth = eth.substring(0, eth.length - 1);
    }

    return eth;
}

export async function hexWeiToEthFormatted(hex: string): Promise<string> {
    const wei = BigInt(hex).toString();
    return await weiToEtherFormatted(wei);
}

export async function isValidEther(quantity: string): Promise<boolean> {
    return await FormatApi.send("FormatApiIsValidEther", quantity);
}

export async function compareEther(val1: string, val2: string): Promise<number> {
    return await FormatApi.send("FormatApiCompareEther", { num1: val1, num2: val2 });
}

export interface SwapTokenMetadataResult {
    success: boolean;
    contractAddress?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    balance?: string;
    error?: string | null;
}

export async function getSwapTokenMetadata(payload: unknown): Promise<SwapTokenMetadataResult> {
    return await SwapQuoteApi.send("SwapTokenGetMetadata", payload);
}

export async function getSwapQuoteAmountsOut(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapQuoteGetAmountsOut", payload);
}

export async function getSwapQuoteAmountsIn(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapQuoteGetAmountsIn", payload);
}

// Route check result: `exists` is true when a direct pair OR a multi-hop route
// exists. `path` is the address route ([from, ...hops, to]) and `pathSymbols`
// the on-chain symbol per path token (null entries when the lookup failed).
// Symbols are untrusted RPC data; sanitize before display.
export interface SwapCheckPairExistsResult {
    exists: boolean;
    path: string[] | null;
    pathSymbols: (string | null)[] | null;
    error: string | null;
}

export async function getSwapCheckPairExists(payload: unknown): Promise<SwapCheckPairExistsResult> {
    return await SwapQuoteApi.send("SwapQuoteCheckPairExists", payload);
}

export async function getSwapEstimateGas(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapQuoteEstimateGas", payload);
}

export async function getSwapCheckAllowance(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapQuoteCheckAllowance", payload);
}

export async function getSwapEstimateApproveGas(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapQuoteEstimateApproveGas", payload);
}

export async function estimateGas(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("estimateGas", payload);
}

export async function estimateGasFee(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("estimateGasFee", payload);
}

export async function getSwapApproveContractData(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapQuoteGetApproveContractData", payload);
}

export async function getSwapRouterAddress(payload: unknown = {}): Promise<any> {
    return await SwapQuoteApi.send("SwapQuoteGetRouterAddress", payload);
}

export async function getSwapSwapContractData(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapQuoteGetSwapContractData", payload);
}

export async function submitSwapApproval(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapSubmitApproval", payload);
}

export async function submitSwapSwap(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapSubmitSwap", payload);
}

export async function submitSwapRemoveAllowance(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapSubmitRemoveAllowance", payload);
}

export async function submitSwapAddAllowance(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SwapSubmitAddAllowance", payload);
}

export async function submitSendCoins(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SendCoinsSubmit", payload);
}

export async function submitSendTokens(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SendTokensSubmit", payload);
}

// Strict WYSIWYS decode + re-encode verification of a generic dApp transaction.
// Returns { success, kind, method, signature, selector, args, valueDecimal, ... }
// on success, or { success:false, error } on any decode/mismatch failure.
export async function decodeTransaction(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("DecodeTransaction", payload);
}

// Sign + broadcast a generic dApp transaction verbatim (verified `to`/`data`/`value`).
export async function submitSendTransaction(payload: unknown): Promise<any> {
    return await SwapQuoteApi.send("SendTransactionSubmit", payload);
}

// EIP-191 personal-message signing. The signing context defaults per key type
// (derived from the key type). When advancedSigningEnabled is true and no
// explicit signingContext is given, the handler signs with the full ("advanced")
// signing context (wallet.getSigningContext(true)).
export async function signMessage(
    privateKeyBase64: string,
    publicKeyBase64: string,
    message: string,
    signingContext: unknown,
    advancedSigningEnabled: boolean,
): Promise<{ signature: string }> {
    return await CryptoApi.send("SignMessage", {
        privateKey: privateKeyBase64,
        publicKey: publicKeyBase64,
        message: message,
        signingContext: signingContext == null ? null : signingContext,
        advancedSigningEnabled: advancedSigningEnabled === true,
    });
}

// Recover the signer address from an EIP-191 message signature. Returns
// { address }; rejects if the signature does not verify.
export async function verifyMessage(message: string, signature: string): Promise<{ address: string }> {
    return await CryptoApi.send("VerifyMessage", { message: message, signature: signature });
}

export async function cryptoRandomBytes(size: number): Promise<string> {
    return await CryptoApi.send("CryptoRandomBytes", size);
}

export async function walletFromSeed(seedArray: Uint8Array | number[]): Promise<{ address: string; privateKey: string; publicKey: string }> {
    return await CryptoApi.send("WalletFromSeed", { seed: Array.from(seedArray) });
}

export async function walletEncryptJson(privateKeyBase64: string, publicKeyBase64: string, passphrase: string): Promise<string> {
    return await CryptoApi.send("WalletEncryptJson", {
        privateKey: privateKeyBase64,
        publicKey: publicKeyBase64,
        passphrase: passphrase,
    });
}

export async function walletDecryptJson(json: string, passphrase: string): Promise<{ address: string; privateKey: string; publicKey: string; seed: string | null }> {
    return await CryptoApi.send("WalletDecryptJson", { json: json, passphrase: passphrase });
}

export async function computeAddressFromPublicKey(publicKeyBase64: string): Promise<string> {
    return await CryptoApi.send("ComputeAddress", publicKeyBase64);
}

export async function scryptDerive(secret: string, saltBase64: string): Promise<string> {
    return await CryptoApi.send("ScryptDerive", { secret: secret, salt: saltBase64 });
}
