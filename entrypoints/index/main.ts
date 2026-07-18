// Wallet renderer entry point (mirrors the desktop src/renderer.ts). Mounts
// the hand-written screen modules (header chrome, screen containers, screens
// and dialogs), performs the script-eval-time element bindings of
// dialog.ts/send.ts, and then runs the same startup sequence the legacy
// public/js scripts did.
import { mountScreenModules } from "@/src/ui/screens";
import { containerModules, headerModules } from "@/src/screens/header";
import { dialogModules } from "@/src/dialogs/modals";
import { onboardingScreenModules } from "@/src/screens/onboarding";
import { homeScreenModule } from "@/src/screens/home";
import { sendScreenModules } from "@/src/screens/send";
import { swapScreenModule } from "@/src/screens/swap";
import { receiveScreenModule } from "@/src/screens/receive";
import { transactionsScreenModule } from "@/src/screens/transactions";
import { settingsScreenModules } from "@/src/screens/settings";
import { releaseScreenModules } from "@/src/screens/releases";
import { walletsScreenModules } from "@/src/screens/wallets";
import { initDialogs, showErrorAndLockup } from "@/src/app/dialog";
import { initSend } from "@/src/app/send";
import { initApp, getGenericError, showRestoreWalletLabel } from "@/src/app/app";
import { applyConfiguredTheme } from "@/src/app/theme";
import { initSurfaceView, markActiveSurfaceItem } from "@/src/platform/surface";

async function bootstrap(): Promise<void> {
    // Surface sizing (?view= -> data-view on <html>, drives popup.css) must be
    // set before first paint.
    initSurfaceView();

    // Theme is decided by the platform package name (always the first-party
    // quantum theme in the extension); applied while the body is still empty
    // so there is no unthemed flash.
    await applyConfiguredTheme();

    // Mount order mirrors the legacy body: header chrome first, then the
    // screen containers, then the screens inside them, dialogs last. All of
    // it must be in the DOM before initDialogs()/initApp() run their element
    // bindings, template captures and localization passes.
    mountScreenModules(headerModules);
    mountScreenModules(containerModules);
    mountScreenModules(onboardingScreenModules);
    mountScreenModules([homeScreenModule, ...sendScreenModules, swapScreenModule]);
    mountScreenModules([receiveScreenModule, transactionsScreenModule]);
    mountScreenModules(settingsScreenModules);
    mountScreenModules(releaseScreenModules);
    mountScreenModules(walletsScreenModules);
    mountScreenModules(dialogModules);

    // The item matching the current surface is disabled (burger menu exists now).
    markActiveSurfaceItem();

    // The legacy scripts ran after the static body existed and did their
    // element lookups/bindings at eval time; same order here.
    initDialogs();
    initSend();

    // window.onload in the legacy page; the DOM is fully built at this point.
    document.getElementById("filRestoreWallet")!.addEventListener("change", showRestoreWalletLabel);

    // Enter-key activation for the legacy div[role="button"] controls (kept
    // as divs for pixel fidelity with the old markup).
    document.querySelectorAll<HTMLElement>('[role="button"]').forEach(function (el) {
        el.addEventListener("keypress", function (e: KeyboardEvent) {
            if (e.key === "Enter") {
                el.click();
            }
        });
    });

    // Close the burger dropdown when clicking anywhere outside of it.
    document.addEventListener("click", function (event) {
        const menu = document.getElementById("burgerMenu");
        const dropdown = document.getElementById("burgerDropdown");
        if (!menu || !dropdown || dropdown.style.display !== "block") return;
        if (!menu.contains(event.target as Node)) {
            dropdown.style.display = "none";
        }
    });

    await initApp();
}

// SEC-11: never render raw (possibly secret-derived) error text into the UI.
// Log the detail to the console for debugging and show a generic lockup message.
function bootGenericErrorMessage(): string {
    try {
        return getGenericError("");
    } catch {
        return "An unexpected error occurred.";
    }
}

window.onerror = (message, source, lineno, colno, error) => {
    console.error("window.onerror:", message, source, lineno, colno, error);
    showErrorAndLockup(bootGenericErrorMessage());
};

window.addEventListener("unhandledrejection", (event) => {
    console.error("unhandledrejection:", (event as PromiseRejectionEvent).reason);
    showErrorAndLockup(bootGenericErrorMessage());
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void bootstrap(); });
} else {
    void bootstrap();
}
