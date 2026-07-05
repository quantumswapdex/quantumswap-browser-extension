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