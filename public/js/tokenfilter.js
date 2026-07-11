"use strict";

// Mirrors the Android wallet's token recognition (RecognizedTokens) and
// stablecoin-impersonator suppression (StablecoinImpersonatorFilter).
// Recognition is by contract address only (not chainId-keyed). Symbol/name
// are only used to detect stablecoin impersonators.

const RECOGNIZED_TOKEN_ADDRESSES = new Set([
    "0xe8ea8beb86e714ef2bde0afac17d6e45d1c35e48f312d6dc12c4fdb90d9e8a3d", // Heisen
    "0xa8036870874fbed790ed4d3bbd41b2f390b9858ff021f2993e90c6d1cbb167c7"  // Y2Q
]);

const STABLECOIN_IMPERSONATOR_PATTERNS = [
    "usd", "dai", "tether", "stable", "stablecoin",
    "frax", "fdusd", "lusd", "tusd", "gusd", "pyusd",
    "eurt", "eurc", "eurs",
    "dollar", "euro", "yen", "gbpt", "cny",
    "inr", "rupee", "rupiah"
];

function isRecognizedToken(contract) {
    if (contract == null || contract.length === 0) {
        return false;
    }
    return RECOGNIZED_TOKEN_ADDRESSES.has(contract.toLowerCase());
}

// item 9: fold homoglyph/fullwidth/format-char tricks before matching so an
// impersonator like "ＵＳＤ" (fullwidth), "U\u200bSD" (zero-width) or combining-mark
// variants is still caught. NFKC maps compatibility forms to their canonical
// ASCII-ish equivalents; then combining marks (U+0300–U+036F) and zero-width /
// bidi format chars are stripped so they cannot break up a matched substring.
function normalizeForImpersonatorMatch(value) {
    if (value == null) return "";
    let s = String(value);
    try { s = s.normalize("NFKC"); } catch (e) { /* NFKC unsupported: use raw */ }
    s = s.replace(/[\u0300-\u036F\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, "");
    return s.toLowerCase();
}

function impersonatesStablecoin(symbol, name) {
    let s = normalizeForImpersonatorMatch(symbol);
    let n = normalizeForImpersonatorMatch(name);
    if (s.length === 0 && n.length === 0) {
        return false;
    }
    for (let i = 0; i < STABLECOIN_IMPERSONATOR_PATTERNS.length; i++) {
        let p = STABLECOIN_IMPERSONATOR_PATTERNS[i];
        if (s.length !== 0 && s.includes(p)) {
            return true;
        }
        if (n.length !== 0 && n.includes(p)) {
            return true;
        }
    }
    return false;
}

function filterStablecoinImpersonators(tokenList) {
    let out = [];
    if (tokenList == null) {
        return out;
    }
    for (let i = 0; i < tokenList.length; i++) {
        let token = tokenList[i];
        if (token == null) {
            continue;
        }
        if (isRecognizedToken(token.contractAddress)) {
            out.push(token);
            continue;
        }
        if (impersonatesStablecoin(token.symbol, token.name) === false) {
            out.push(token);
        }
    }
    return out;
}
