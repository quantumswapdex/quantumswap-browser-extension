// Swap screen: main form plus the transaction success panel.
import { el } from "../ui/dom";
import type { ScreenModule } from "../ui/screens";
import {
    copySwapSuccessTransactionHash,
    debouncedUpdateFromQuantityFromTo,
    debouncedUpdateToQuantityFromFrom,
    onSwapNextClick,
    flipSwapTokens,
    openSwapTokenPicker,
    onSwapScreenBackClick,
    onSwapSuccessOkClick,
    openSwapSuccessTransactionInExplorer,
    setSwapFromQuantityToBalance,
    setSwapToQuantityToBalance,
    updateSwapScreenInfo,
} from "../app/swap";

const SWAP_PANEL_STYLE = "padding-top: 15px; padding-bottom: 15px; overflow-y: auto; overflow-x: auto; max-height:590px; display: none;";

function buildFlipIcon(): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "#fff");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const [tag, attrs] of [
        ["line", { x1: "8", y1: "20", x2: "8", y2: "5" }],
        ["polyline", { points: "4 9 8 5 12 9" }],
        ["line", { x1: "16", y1: "4", x2: "16", y2: "19" }],
        ["polyline", { points: "12 15 16 19 20 15" }],
    ] as const) {
        const child = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, value);
        svg.appendChild(child);
    }
    return svg;
}

function buildSwapMainPanel(): HTMLElement {
    return el("div", { id: "divSwapScreenInner", class: "roundex-box scrollbar", style: "padding-top: 15px; padding-bottom: 15px; overflow-y: auto; overflow-x: auto; max-height:740px;" }, [
        el("div", { style: "display:flex; align-items:center; justify-content:space-between;" }, [
            el("div", { class: "heading bold", "data-lang-key": "swap" }, ["Swap"]),
            el("div", { id: "divSwapTokenListLoading", style: "display:none; width:30px; height:30px;" }, [
                el("img", { src: "assets/icons/loading.gif", alt: "Loading tokens", style: "width:30px; height:30px;" }),
            ]),
        ]),
        el("div", { class: "divider" }),
        el("div", { class: "input_container", style: "gap:2px;" }, [
            el("div", { class: "heading medium", "data-lang-key": "swap-from-token", style: "margin-top: 3px;" }, ["From token"]),
            el("button", {
                id: "btnSwapFromTokenPicker", class: "token-picker-trigger", type: "button",
                tabindex: "321", onclick: () => openSwapTokenPicker("from"),
            }, ["Select token"]),
            el("div", { class: "selectwrapper", style: "display:none;" }, [
                el("select", { id: "ddlSwapFromToken", class: "selectbox", style: "height:100%; box-sizing:border-box; padding:7px 10px;", tabindex: "321", onchange: () => { void updateSwapScreenInfo(); } }),
            ]),
            el("div", { id: "divSwapFromQuantityBox", style: "display:none;width:100%;" }, [
                el("div", { class: "input_container", style: "margin-top:3px;gap:2px;" }, [
                    el("div", { style: "font-size: 0.85em; color: #372339;" }, [
                        el("span", { "data-lang-key": "balance" }, ["Balance"]),
                        ": ",
                        el("span", { id: "spanSwapFromBalance", role: "button", tabindex: "323", class: "swap-balance-label", style: "cursor:pointer;text-decoration:underline;", onclick: () => setSwapFromQuantityToBalance() }, ["0"]),
                    ]),
                ]),
                el("input", {
                    class: "tab-name qs-input-strong",
                    type: "number", autocomplete: "off", id: "txtSwapFromQuantity", name: "swap_from_quantity",
                    "data-placeholder-key": "swap-from-token-quantity", placeholder: "From token quantity",
                    style: "width:100%;box-sizing:border-box;", tabindex: "326", min: "0", step: "any", oninput: () => debouncedUpdateToQuantityFromFrom(),
                }),
                el("div", { class: "divider" }),
            ]),
        ]),
        el("div", { id: "divSwapFlip", style: "display:none;" }, [
            el("div", { class: "swap-flip" }, [
                el("button", {
                    id: "btnSwapFlipTokens", type: "button", title: "Flip", "aria-label": "Flip tokens",
                    onclick: () => { void flipSwapTokens(); },
                }, [buildFlipIcon()]),
            ]),
        ]),
        el("div", { class: "input_container", style: "gap:2px;" }, [
            el("div", { class: "heading medium", "data-lang-key": "swap-to-token", style: "margin-top: 3px;" }, ["To token"]),
            el("button", {
                id: "btnSwapToTokenPicker", class: "token-picker-trigger", type: "button",
                tabindex: "327", onclick: () => openSwapTokenPicker("to"),
            }, ["Select token"]),
            el("div", { class: "selectwrapper", style: "display:none;" }, [
                el("select", { id: "ddlSwapToToken", class: "selectbox", style: "height:100%; box-sizing:border-box; padding:7px 10px;", tabindex: "327", onchange: () => { void updateSwapScreenInfo(); } }),
            ]),
            el("div", { id: "divSwapToQuantityBox", style: "display:none;width:100%;" }, [
                el("div", { class: "input_container", style: "margin-top:3px;gap:2px;" }, [
                    el("div", { style: "font-size: 0.85em; color: #372339;" }, [
                        el("span", { "data-lang-key": "balance" }, ["Balance"]),
                        ": ",
                        el("span", { id: "spanSwapToBalance", role: "button", tabindex: "329", class: "swap-balance-label", style: "cursor:pointer;text-decoration:underline;", onclick: () => setSwapToQuantityToBalance() }, ["0"]),
                    ]),
                ]),
                el("input", {
                    class: "tab-name qs-input-strong",
                    type: "number", autocomplete: "off", id: "txtSwapToQuantity", name: "swap_to_quantity",
                    "data-placeholder-key": "swap-to-token-quantity", placeholder: "To token quantity",
                    style: "width:100%;box-sizing:border-box;", tabindex: "332", min: "0", step: "any", oninput: () => debouncedUpdateFromQuantityFromTo(),
                }),
                el("div", { class: "divider" }),
            ]),
        ]),
        el("div", { id: "divSwapRoutePath", style: "display: none; margin-top:6px;" }, [
            el("div", { style: "font-size: 0.85em; color: #ffffff; word-break: break-all;" }, [
                el("span", { "data-lang-key": "swap-route" }, ["Route"]),
                ": ",
                el("span", { id: "spanSwapRoutePath" }),
            ]),
        ]),
        el("div", { class: "input_container", style: "margin-top:8px;" }, [
            el("div", { class: "heading medium", "data-lang-key": "slippage" }, ["Slippage"]),
            el("div", { style: "display:flex; align-items:center; gap:8px;" }, [
                el("input", { class: "tab-name qs-input-strong", type: "number", id: "txtSwapSlippage", min: "0", max: "100", step: "0.1", value: "1", style: "width:100%;", tabindex: "333" }),
                el("span", {}, ["%"]),
            ]),
            el("div", { class: "divider" }),
        ]),
        el("div", { style: "display: flex; align-items: center; justify-content: flex-end; gap: 10px;margin-top:10px;" }, [
            el("div", { id: "divSwapQuoteLoading", style: "display: none;" }, [
                el("img", { src: "assets/icons/loading.gif", alt: "Loading", style: "width:30px; height:30px;" }),
            ]),
            el("div", { class: "large_button_container heading large", "data-lang-key": "next", role: "button", tabindex: "334", id: "btnSwapNext", onclick: () => { void onSwapNextClick(); } }, ["Next"]),
        ]),
    ]);
}

function buildSwapSuccessPanel(): HTMLElement {
    return el("div", { id: "divSwapSuccessPanel", class: "roundex-box scrollbar", style: SWAP_PANEL_STYLE }, [
        el("div", { class: "heading bold", "data-lang-key": "swap-succeeded", style: "color: green;" }, ["Swap transaction succeeded."]),
        el("div", { class: "divider" }),
        el("div", { class: "input_container", style: "margin-top:4px; gap:2px;" }, [
            el("div", { class: "heading medium", "data-lang-key": "swap-from-token" }, ["From token"]),
            el("span", { id: "spanSwapSuccessFromTokenDisplay", style: "font-size: 0.9em;" }),
        ]),
        el("div", { class: "input_container", style: "margin-top:4px; gap:2px;" }, [
            el("div", { class: "heading medium", "data-lang-key": "swap-to-token" }, ["To token"]),
            el("span", { id: "spanSwapSuccessToTokenDisplay", style: "font-size: 0.9em;" }),
        ]),
        el("div", { class: "input_container", style: "margin-top:8px; gap:2px;" }, [
            el("div", { class: "heading medium", "data-lang-key": "swap-from-token-quantity" }, ["From token quantity"]),
            el("span", { id: "spanSwapSuccessFromQuantity" }),
        ]),
        el("div", { class: "input_container", style: "margin-top:8px; gap:2px;" }, [
            el("div", { class: "heading medium", "data-lang-key": "swap-to-token-quantity" }, ["To token quantity"]),
            el("span", { id: "spanSwapSuccessToQuantity" }),
        ]),
        el("div", { class: "input_container", style: "margin-top:8px; gap:2px;" }, [
            el("span", { class: "heading medium", "data-lang-key": "gas-fee-spent" }, ["Gas fee spent (coins)"]),
            el("span", { id: "spanSwapSuccessGasFee" }, ["0"]),
        ]),
        el("div", { id: "divSwapSuccessTxHashRow", style: "margin-top:8px; text-align:left;" }, [
            el("div", { style: "display:flex; align-items:center; justify-content:space-between;" }, [
                el("span", { class: "heading medium", "data-lang-key": "transaction-id" }, ["Transaction ID"]),
                el("div", { style: "display:flex; align-items:center; gap:12px;" }, [
                    el("div", { class: "copy-container", role: "button", tabindex: "340", title: "Copy", onclick: () => { void copySwapSuccessTransactionHash(); } }),
                    el("div", { class: "scan-container", role: "button", tabindex: "341", title: "Block Explorer", onclick: () => { void openSwapSuccessTransactionInExplorer(); } }),
                ]),
            ]),
            el("p", { id: "pSwapSuccessTxHash", style: "font-family:monospace; word-break:break-all; margin:2px 0 0;" }),
        ]),
        el("div", { style: "position:sticky; bottom:0; z-index:2; display:flex; justify-content:flex-end; margin-top:20px; padding:10px 0 4px; background:var(--panel, #0b0b12);" }, [
            el("div", { class: "large_button_container heading large", role: "button", tabindex: "342", id: "btnSwapSuccessOk", style: "margin-left: auto;", onclick: () => onSwapSuccessOkClick() }, [
                el("span", { "data-lang-key": "ok" }, ["OK"]),
            ]),
        ]),
    ]);
}

function buildSwapScreen(): HTMLElement {
    return el("div", { class: "center-content home-content", id: "SwapScreen" }, [
        el("div", { class: "center-content-rounded-container", style: "width:93%;" }, [
            el("div", { class: "back-container", role: "button", tabindex: "320", id: "divBackSwapScreen", onclick: () => onSwapScreenBackClick() }),
            buildSwapMainPanel(),
            buildSwapSuccessPanel(),
        ]),
    ]);
}

export const swapScreenModule: ScreenModule = { parentId: "divMainContent", build: buildSwapScreen };
