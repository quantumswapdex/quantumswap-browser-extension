function isNetworkError(error) {
    let err = error.message.toLowerCase();
    return (err.includes("failed to fetch") || err.includes("timeout") || err.includes("network request failed"));
}
function isLargeNumber(val) {
    var rgx = /^([0-9]+([.][0-9]*)?|[.][0-9]+)$/;
    return Boolean(val.match(rgx));
}

function isValidDate(dateStr) {
    return !isNaN(new Date(dateStr));
}

function isHex(num) {
    return Boolean(num.match(/^0x[0-9a-f]+$/i))
}


function htmlEncode(rawStr) {
    return rawStr.replace(/[\u00A0-\u9999<>\&]/g, i => '&#' + i.charCodeAt(0) + ';')
}

// SEC-18: encoder for values interpolated into an HTML *attribute*, including the
// single-quoted JS-string arguments of the rehydrated on* handlers (e.g.
// onclick="return OpenScanAddress('[FROM]');"). In addition to what htmlEncode
// covers, this also encodes quotes and backtick so RPC/scan-API data cannot break
// out of the attribute or the quoted handler argument and inject markup. Use this
// (not htmlEncode) for any data placed inside an attribute value.
function htmlAttrEncode(rawStr) {
    return String(rawStr).replace(/[\u00A0-\u9999<>\&"'`]/g, i => '&#' + i.charCodeAt(0) + ';')
}

// SEC-14 / item 8: detect Unicode that can be used to spoof what the user reads
// (bidi overrides that visually reorder text, invisible/zero-width joiners, and
// C0/C1 control chars). Returns true when `str` contains any such character, so
// callers can (a) hard-reject dApp-displayed values and (b) hide scam tokens
// whose name/symbol try to disguise themselves.
function containsUnsafeDisplayText(str) {
    if (str == null) return false;
    var s = String(str);
    // U+202A–U+202E: LRE/RLE/PDF/LRO/RLO bidi embedding+override
    // U+2066–U+2069: LRI/RLI/FSI/PDI bidi isolates
    // U+200B–U+200D: zero-width space/non-joiner/joiner
    // U+2060: word joiner; U+FEFF: zero-width no-break space (BOM)
    // U+0000–U+001F (minus \t \n \r): C0 controls; U+007F–U+009F: DEL + C1 controls
    return /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(s);
}