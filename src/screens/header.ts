// Header chrome (burger menu, network dropdown, gradient brand row), the
// decorative background orbs and the network-row <template>, extracted 1:1
// from the legacy fixture.
import { el } from "../ui/dom";
import type { ScreenModule } from "../ui/screens";
import { OpenUrl } from "../lib/bridge";
import { closeBurgerMenu, lockWallet, showSettingsScreen, showWalletListScreen, toggleBurgerMenu } from "../app/app";
import { showNetworkDialog } from "../app/dialog";
import { DROPDOWN_TEXT, networkStore } from "../app/state";
import { walletDock, walletFullScreen, walletOverlay, walletPopOut } from "../platform/surface";

function buildOrb1(): HTMLElement {
    return el("div", { class: "qs-orb qs-orb-1" });
}

function buildOrb2(): HTMLElement {
    return el("div", { class: "qs-orb qs-orb-2" });
}

// Row template for the settings network list; initApp() captures it via
// byId("tplBlockchainNetworkRow") and clones per network.
function buildNetworkRowTemplate(): HTMLElement {
    const template = el("template", { id: "tplBlockchainNetworkRow" });
    (template as HTMLTemplateElement).content.appendChild(
        el("tr", { class: "network-row" }, [
            el("td", {}, ["[BLOCKCHAIN_NETWORK_ID]"]),
            el("td", {}, ["[BLOCKCHAIN_NETWORK_NAME]"]),
            el("td", {}, ["[BLOCKCHAIN_SCAN_API_URL]"]),
            el("td", {}, ["[BLOCKCHAIN_EXPLORER_API_URL]"]),
            el("td", {}, ["[BLOCKCHAIN_RPC_ENDPOINT_URL]"]),
        ]),
    );
    return template;
}

function burgerItem(id: string, tabindex: string, iconSrc: string, iconAlt: string, langKey: string, label: string, action: () => unknown, extraAttrs: Record<string, string> = {}): HTMLElement {
    return el("div", { class: "burger-item", id, role: "button", tabindex, ...extraAttrs, onclick: () => { closeBurgerMenu(); void action(); } }, [
        el("img", { class: "tab-icon", src: iconSrc, alt: iconAlt }),
        el("div", { class: "tab-name", "data-lang-key": langKey }, [label]),
    ]);
}

// External-site link in the burger menu (opens in a new tab; no icon).
// `langKey` localizes the label; brand-name links omit it.
function burgerLinkItem(id: string, tabindex: string, label: string, url: string, langKey?: string): HTMLElement {
    const labelAttrs: Record<string, string> = { class: "tab-name" };
    if (langKey != null) labelAttrs["data-lang-key"] = langKey;
    return el("div", { class: "burger-item", id, role: "button", tabindex, onclick: () => { closeBurgerMenu(); void OpenUrl(url); } }, [
        el("div", labelAttrs, [label]),
    ]);
}

// Keep the brand (logo + "QuantumSwap" wordmark) centered in the free space
// between the fixed burger button (left) and the fixed network chip (right),
// and shrink the wordmark font just enough to fit that space. Both controls
// overlay the header band, so without this the full-size, viewport-centered
// title paints underneath the chip at narrow sidebar widths.
const TITLE_MIN_FONT_PX = 11;
const TITLE_CLEARANCE_PX = 8;

function fitWalletTitle(): void {
    const title = document.getElementById("divWalletTitle");
    const gradient = document.getElementById("gradient");
    if (title == null || gradient == null) return;
    // Re-measure from the stylesheet size so the title can grow back when the
    // sidebar widens again.
    title.style.fontSize = "";
    const titleRect = title.getBoundingClientRect();
    if (titleRect.width <= 0) return;

    const viewportWidth = document.documentElement.clientWidth;
    let leftEdge = 0;
    let rightEdge = viewportWidth;
    const burger = document.getElementById("burgerMenu");
    if (burger != null && burger.getClientRects().length > 0) {
        leftEdge = Math.max(leftEdge, burger.getBoundingClientRect().right);
    }
    const chip = document.getElementById("divNetworkDropdown");
    if (chip != null && chip.getClientRects().length > 0) {
        rightEdge = Math.min(rightEdge, chip.getBoundingClientRect().left);
    }

    // Pad the flex band by each control's incursion (relative to the band's own
    // box) so justify-content: center centers the brand between the controls,
    // not in the viewport. 20px is the band's stylesheet padding floor.
    const gradientRect = gradient.getBoundingClientRect();
    const padLeft = Math.max(20, leftEdge - gradientRect.left + TITLE_CLEARANCE_PX);
    const padRight = Math.max(20, gradientRect.right - rightEdge + TITLE_CLEARANCE_PX);
    gradient.style.paddingLeft = padLeft + "px";
    gradient.style.paddingRight = padRight + "px";

    // Shrink the wordmark when the brand (logo + flex gap + title) is wider
    // than the free space between the controls. The logo/gap part is computed
    // from the logo's own width plus the band's flex gap — NOT from the live
    // logo->title distance, which collapses to ~0 when the band's flex-wrap
    // moves an overflowing title onto a second row (hidden under the
    // overlapping card) and would make an overflowing title look like it fits.
    const logo = document.getElementById("imgLogo");
    const gap = parseFloat(window.getComputedStyle(gradient).columnGap) || 12;
    const nonTitleWidth = logo != null && logo.getClientRects().length > 0
        ? logo.getBoundingClientRect().width + gap
        : 0;
    const freeWidth = rightEdge - leftEdge - 2 * TITLE_CLEARANCE_PX;
    // Small buffer so sub-pixel rounding can't push the title onto a wrap row.
    const allowedTitleWidth = freeWidth - nonTitleWidth - 4;
    if (titleRect.width > allowedTitleWidth) {
        const baseFontPx = parseFloat(window.getComputedStyle(title).fontSize) || 21;
        const scaledPx = Math.floor((baseFontPx * allowedTitleWidth) / titleRect.width);
        title.style.fontSize = Math.max(TITLE_MIN_FONT_PX, scaledPx) + "px";
    }

    // Safety net: if the title still landed on a wrap row below the logo (the
    // estimate was off, or the band is extremely narrow), step the font down
    // until it rejoins the logo's row or hits the floor.
    if (logo == null || logo.getClientRects().length === 0) return;
    const onWrapRow = () =>
        title.getBoundingClientRect().top >= logo.getBoundingClientRect().bottom - 1;
    let fontPx = parseFloat(window.getComputedStyle(title).fontSize) || 21;
    while (fontPx > TITLE_MIN_FONT_PX && onWrapRow()) {
        fontPx -= 1;
        title.style.fontSize = fontPx + "px";
    }
}

// Re-fit on viewport resizes, once the brand font has loaded, and when the
// burger/chip visibility, chip label, or title text change. The observers watch
// only those nodes (never the title's style attribute, which fitWalletTitle
// itself writes) so a re-fit cannot re-trigger itself.
function watchWalletTitleFit(burgerMenu: HTMLElement, networkDropdown: HTMLElement, title: HTMLElement): void {
    let scheduled = false;
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(() => {
            scheduled = false;
            fitWalletTitle();
        });
    };
    window.addEventListener("resize", schedule);
    if (document.fonts != null) void document.fonts.ready.then(schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(burgerMenu, { attributes: true, attributeFilter: ["style"] });
    observer.observe(networkDropdown, { attributes: true, attributeFilter: ["style"], subtree: true, childList: true, characterData: true });
    observer.observe(title, { childList: true, characterData: true, subtree: true });
    schedule();
}

function buildHeader(): HTMLElement {
    const networkChip = el("span", { class: "networkbox", id: "spnNetwork" }, ["MAINNET" + DROPDOWN_TEXT]);
    networkStore.subscribe(() => {
        const network = networkStore.currentBlockchainNetwork;
        if (network != null) {
            networkChip.textContent = String(network.blockchainName) + DROPDOWN_TEXT;
        }
    });
    const burgerMenu = el("div", { class: "burger-menu", id: "burgerMenu", style: "display:none;" }, [
        el("div", {
            class: "burger-button", id: "burgerButton", role: "button", tabindex: "9", "aria-label": "Menu",
            onclick: () => toggleBurgerMenu(),
            onkeydown: (event: Event) => {
                const key = (event as KeyboardEvent).key;
                if (key === "Enter" || key === " ") {
                    (document.getElementById("burgerButton") as HTMLElement).click();
                }
            },
        }, [el("span", {}), el("span", {}), el("span", {})]),
        el("div", { class: "burger-dropdown", id: "burgerDropdown", style: "display:none;" }, [
            // Extension surface controls. Overlay (anchored action popup) is
            // disabled: it requires action.default_popup, which is incompatible
            // with dock-on-toolbar-click. Hidden, not removed.
            burgerItem("burgerOverlay", "10", "assets/svg/overlay.svg", "Overlay Icon", "overlay", "Overlay", walletOverlay, { style: "display:none;" }),
            burgerItem("burgerPopOut", "11", "assets/svg/open.svg", "Pop out Icon", "pop-out", "Pop out", walletPopOut),
            burgerItem("burgerFullScreen", "12", "assets/svg/expand.svg", "Full screen Icon", "full-screen", "Full screen", walletFullScreen),
            burgerItem("burgerDock", "13", "assets/svg/dock.svg", "Dock Icon", "dock", "Dock", walletDock),
            el("div", { class: "burger-separator" }),
            burgerItem("tab1", "14", "assets/svg/wallet-outline.svg", "Wallets Icon", "wallets", "Wallets", showWalletListScreen),
            burgerItem("tab4", "15", "assets/svg/settings.svg", "Settings Icon", "settings", "Settings", showSettingsScreen),
            el("div", { class: "burger-separator" }),
            // External sites (brand names; not localized, no icons).
            burgerLinkItem("burgerLinkBuilder", "16", "Builder", "https://builder.quantumcoin.org"),
            burgerLinkItem("burgerLinkQuantumSwap", "17", "QuantumSwap", "https://app.quantumswap.com"),
            burgerLinkItem("burgerLinkQuantumCoin", "18", "QuantumCoin", "https://quantumcoin.org"),
            el("div", { class: "burger-separator" }),
            burgerLinkItem("burgerLinkPrivacyPolicy", "19", "Privacy Policy", "https://quantumswap.com/browser-extension-privacy-policy.html", "privacy-policy"),
            el("div", { class: "burger-separator" }),
            burgerItem("burgerLock", "20", "assets/svg/lock-closed-outline.svg", "Lock Icon", "lock", "Lock", lockWallet),
        ]),
    ]);
    const networkDropdown = el("div", { class: "dropdown", id: "divNetworkDropdown", role: "button", tabindex: "1000", style: "display:none;", onclick: () => { void showNetworkDialog(); } }, [
        el("div", { style: "width:fit-content;margin-top:4px;float:left;" }, [networkChip]),
    ]);
    const walletTitle = el("div", { class: "animate-character", id: "divWalletTitle", "data-lang-key": "title" }, ["Title"]);
    watchWalletTitleFit(burgerMenu, networkDropdown, walletTitle);
    return el("div", { style: "margin: -10px;" }, [
        burgerMenu,
        networkDropdown,
        el("div", { class: "gradient", id: "gradient" }, [
            el("div", { class: "logo" }, [
                el("img", { src: "assets/icons/app/dp.png", alt: "QuantumSwap logo", class: "logoimg", id: "imgLogo" }),
            ]),
            el("div", { id: "divCustomReleaseBanner", class: "custom-release-banner", style: "display: none;" }),
            walletTitle,
        ]),
    ]);
}

export const headerModules: ScreenModule[] = [
    { parentId: null, build: buildOrb1 },
    { parentId: null, build: buildOrb2 },
    { parentId: null, build: buildNetworkRowTemplate },
    { parentId: null, build: buildHeader },
];

// The four top-level screen containers the legacy show-functions toggle.
// #divMainContent hosts all wallet screens (home, send, swap, ...).
export const containerModules: ScreenModule[] = [
    { parentId: null, build: () => el("div", { class: "tabs-content", id: "login-content", style: "display: none;" }) },
    { parentId: null, build: () => el("div", { class: "tabs-wallet-content", id: "main-content", style: "display: none;" }, [el("div", { class: "content", id: "divMainContent" })]) },
    { parentId: null, build: () => el("div", { id: "settings-content", class: "tabs-content", style: "display: none;" }) },
    { parentId: null, build: () => el("div", { id: "wallets-content", class: "tabs-content", style: "display: none;" }) },
];
