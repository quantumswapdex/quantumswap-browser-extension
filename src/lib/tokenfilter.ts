"use strict";

// Mirrors the Android wallet's token recognition (RecognizedTokens) and
// stablecoin-impersonator suppression (StablecoinImpersonatorFilter).
// Recognition is by contract address only (not chainId-keyed). Symbol/name
// are only used to detect stablecoin impersonators.
import { RECOGNIZED_TOKEN_CONTRACT_ADDRESSES } from "../platform/token-constants";

// Derived from the single source of truth in src/platform/token-constants.ts
// (Heisen, Y2Q, Lion, Tiger, Cat, panther) so the two lists cannot drift.
export const RECOGNIZED_TOKEN_ADDRESSES = new Set(
    RECOGNIZED_TOKEN_CONTRACT_ADDRESSES.map((address) => address.toLowerCase())
);

export const STABLECOIN_IMPERSONATOR_PATTERNS = [
    "usd", "dai", "tether", "stable", "stablecoin",
    "frax", "fdusd", "lusd", "tusd", "gusd", "pyusd",
    "eurt", "eurc", "eurs",
    "dollar", "euro", "yen", "gbpt", "cny",
    "inr", "rupee", "rupiah",
    // Malicious impersonators (not stablecoins): tokens posing as the
    // chain's own coin or its predecessor project. "dogep" (no space) does not
    // match "doge protocol" as a substring, so both are listed; "quantumcoin"
    // also covers punctuated variants like "quantumcoin:".
    "dogep", "doge protocol", "quantumcoin", "quantum coin"
];

export function isRecognizedToken(contract: string | null | undefined) {
    if (contract == null || contract.length === 0) {
        return false;
    }
    return RECOGNIZED_TOKEN_ADDRESSES.has(contract.toLowerCase());
}

// Fold homoglyph/fullwidth/format-char tricks before matching so an
// impersonator like "ＵＳＤ" (fullwidth), "U\u200bSD" (zero-width) or combining-mark
// variants is still caught. NFKC maps compatibility forms to their canonical
// ASCII-ish equivalents; then combining marks (U+0300–U+036F) and zero-width /
// bidi format chars are stripped so they cannot break up a matched substring.
export function normalizeForImpersonatorMatch(value: string | null | undefined): string {
    if (value == null) return "";
    let s = String(value);
    try { s = s.normalize("NFKC"); } catch { /* NFKC unsupported: use raw */ }
    s = s.replace(/[\u0300-\u036F\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, "");
    return s.toLowerCase();
}

export function impersonatesStablecoin(symbol: string | null | undefined, name: string | null | undefined) {
    const s = normalizeForImpersonatorMatch(symbol);
    const n = normalizeForImpersonatorMatch(name);
    if (s.length === 0 && n.length === 0) {
        return false;
    }
    for (let i = 0; i < STABLECOIN_IMPERSONATOR_PATTERNS.length; i++) {
        const p = STABLECOIN_IMPERSONATOR_PATTERNS[i];
        if (s.length !== 0 && s.includes(p)) {
            return true;
        }
        if (n.length !== 0 && n.includes(p)) {
            return true;
        }
    }
    return false;
}

export function filterStablecoinImpersonators(tokenList: Array<{ contractAddress?: string | null; symbol?: string | null; name?: string | null } | null> | null) {
    const out: Array<{ contractAddress?: string | null; symbol?: string | null; name?: string | null }> = [];
    if (tokenList == null) {
        return out;
    }
    for (let i = 0; i < tokenList.length; i++) {
        const token = tokenList[i];
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
