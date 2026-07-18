// Send screen, extracted 1:1 from the legacy fixture (offline signing removed:
// the extension does not support offline transaction signing).
import { el } from "../ui/dom";
import type { ScreenModule } from "../ui/screens";
import { showWalletScreen } from "../app/app";
import {
    onSendGasIconClick,
    openSendTokenPicker,
    sendCoins,
    updateInfoSendScreen,
} from "../app/send";

function buildSendScreen(): HTMLElement {
    return el("div", { class: "center-content home-content", id: "SendScreen" }, [
        el("div", { class: "center-content-rounded-container" }, [
            el("div", { class: "back-container", role: "button", tabindex: "300", onclick: () => { void showWalletScreen(); } }),
            el("div", { id: "divSendScreenInner", class: "roundex-box scrollbar", style: "padding-top: 15px; padding-bottom: 15px;overflow-y: auto;overflow-x: auto;" }, [
                el("div", { class: "gas-header-row" }, [
                    el("div", { class: "heading bold", "data-lang-key": "send" }, ["Send"]),
                    el("div", { class: "gas-header-right" }, [
                        el("div", { id: "divSendTokenListLoading", style: "display:none; width:30px; height:30px;" }, [
                            el("img", { src: "assets/icons/loading.gif", alt: "Loading tokens", style: "width:30px; height:30px;" }),
                        ]),
                        el("span", { id: "spanSendGasFee", class: "gas-fee-label" }),
                        el("div", { id: "divSendGasIcon", class: "gas-container", role: "button", tabindex: "301", onclick: () => onSendGasIconClick() }),
                    ]),
                ]),
                el("div", { class: "divider" }),
                el("div", { class: "input_container", id: "divTokenList" }, [
                    el("button", {
                        id: "btnSendTokenPicker", class: "token-picker-trigger", type: "button",
                        tabindex: "303", onclick: () => openSendTokenPicker(),
                    }, ["Select token"]),
                    el("div", { class: "selectwrapper", style: "display:none;" }, [
                        el("select", { id: "ddlCoinTokenToSend", class: "selectbox", tabindex: "303", onchange: () => { void updateInfoSendScreen(); } }, [
                            el("option", { value: "Q" }, ["Q"]),
                        ]),
                    ]),
                    el("div", { id: "divCoinTokenToSend", style: "font-size: small" }, ["0x0000000000000000000000000000000000000000000000000000000000001000"]),
                    el("div", { class: "divider" }),
                ]),
                el("div", { id: "divSendScreenBalanceBox" }, [
                    el("div", { class: "tab-name text-wallet-address", style: "text-align: left; font-weight: 200", "data-lang-key": "balance" }, ["Balance"]),
                    el("div", { class: "heading bold", style: "text-align: left; font-size: 20px; color:green;", id: "divBalanceSendScreen" }),
                    el("div", { class: "divider" }),
                ]),
                el("div", { class: "input_container" }, [
                    el("div", { class: "heading medium", "data-lang-key": "address-to-send" }, ["Address to send to"]),
                    el("input", {
                        class: "tab-name qs-input",
                        autocomplete: "off", id: "txtSendAddress", name: "send_address", "data-placeholder-key": "address-to-send",
                        placeholder: "Address to send to", tabindex: "305",
                    }),
                    el("div", { class: "divider" }),
                ]),
                el("div", { class: "input_container" }, [
                    el("div", { class: "heading medium", "data-lang-key": "quantity-to-send" }, ["Quantity to send"]),
                    el("input", {
                        class: "tab-name qs-input-strong",
                        type: "number", autocomplete: "off", id: "txtSendQuantity", name: "send_quantity", "data-placeholder-key": "quantity-to-send",
                        placeholder: "Quantity to send", tabindex: "306",
                    }),
                    el("div", { class: "divider" }),
                ]),
                el("div", { style: "display: flex; justify-content: flex-end;" }, [
                    el("div", { class: "large_button_container heading large", "data-lang-key": "send", role: "button", tabindex: "310", id: "btnSendCoins", onclick: () => { void sendCoins(); } }, ["Send"]),
                ]),
            ]),
        ]),
    ]);
}

export const sendScreenModules: ScreenModule[] = [
    { parentId: "divMainContent", build: buildSendScreen },
];
