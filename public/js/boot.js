// Extracted from the inline <script> at the bottom of index.html.
// MV3 forbids inline scripts, so this must be an external file loaded last.
document.addEventListener('DOMContentLoaded', function () {
    initApp();
});

// SEC-11: never render raw (possibly secret-derived) error text into the UI.
// Log the detail to the console for debugging and show a generic lockup message.
function bootGenericErrorMessage() {
    try {
        return getGenericError("");
    } catch (e) {
        return "An unexpected error occurred.";
    }
}

window.onerror = (message, source, lineno, colno, error) => {
    console.error("window.onerror:", message, source, lineno, colno, error);
    showErrorAndLockup(bootGenericErrorMessage());
};

window.addEventListener("unhandledrejection", event => {
    console.error("unhandledrejection:", event && event.reason);
    showErrorAndLockup(bootGenericErrorMessage());
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
