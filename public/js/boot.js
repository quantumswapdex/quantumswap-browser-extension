// Extracted from the inline <script> at the bottom of index.html.
// MV3 forbids inline scripts, so this must be an external file loaded last.
document.addEventListener('DOMContentLoaded', function () {
    initApp();
});

window.onerror = (message, source, lineno, colno, error) => {
    showErrorAndLockup(message);
};

window.addEventListener("unhandledrejection", event => {
    var reason = event.reason;
    var detail = (reason && reason.message) ? String(reason.message) : String(reason);
    showErrorAndLockup(detail);
});

window.onload = function () {
    document.getElementById('filRestoreWallet').addEventListener('change', showRestoreWalletLabel);
}

document.querySelectorAll('[role="button"]').forEach(function (el) {
    el.addEventListener("keypress", function (e) {
        if (e.key === 'Enter') {
            el.click();
        }
    });
});
