// el()-built markup for the dApp approval surface (approve.html). 1:1 port of
// the static body of the legacy public/approve.html: same ids, classes and
// inline styles so styles.css / popup.css / theme.css / approve.css apply
// unchanged. All behavior lives in src/approval/dapp.ts.
import { el } from "../ui/dom";
import type { ScreenModule } from "../ui/screens";

function buildWaitDialog(): HTMLElement {
    return el("dialog", { id: "modalWaitDialog", class: "modal", tabindex: "-1", role: "dialog" }, [
        el("div", { class: "modal-content" }, [
            el("div", { style: "float:left;", id: "divLoadingModalIcon" }, [
                el("img", { src: "assets/icons/loading.gif", style: "width:70px;margin-top:12px;margin-right:10px;", alt: "Loading" }),
            ]),
            el("div", { style: "margin-bottom:10px;" }, [
                el("div", { style: "padding-bottom:20px;" }, [
                    el("p", { id: "pWaitDetails", class: "scrollbar", style: "overflow:auto;", tabindex: "1" }),
                ]),
            ]),
        ]),
    ]);
}

function buildOkDialog(): HTMLElement {
    return el("dialog", { id: "modalOkDialog", class: "modal", tabindex: "-1", role: "dialog" }, [
        el("div", { class: "modal-content" }, [
            el("div", { style: "float:left;display:none;", id: "divSuccess" }, [
                el("img", { src: "assets/svg/checkmark-circle-outline.svg", style: "width:55px;margin-top:12px;", alt: "Success" }),
            ]),
            el("div", { style: "float:left;display:none;", id: "divWarn" }, [
                el("img", { src: "assets/svg/warning-outline.svg", style: "width:55px;margin-top:12px;", alt: "Warning" }),
            ]),
            el("div", { style: "margin-bottom:10px;" }, [
                el("div", { style: "padding-bottom:20px;overflow:auto;" }, [
                    el("p", { id: "pDetails", class: "scrollbar", tabindex: "2" }),
                ]),
                el("div", { style: "display:flex; justify-content:flex-end;" }, [
                    el("button", { class: "close", "data-lang-key": "ok", role: "button", tabindex: "3", id: "divModalOk" }, ["Ok"]),
                ]),
            ]),
        ]),
    ]);
}

function buildSendCompletedDialog(): HTMLElement {
    return el("dialog", { id: "modalSendCompleted", class: "modal", tabindex: "-1", role: "dialog" }, [
        el("div", { class: "modal-content", style: "margin:10% auto; max-width:520px;" }, [
            el("p", { id: "pSendCompletedMessage", style: "margin:0;" }),
            el("div", { style: "margin-top:16px;" }, [
                el("div", { style: "display:flex; align-items:center; justify-content:space-between;" }, [
                    el("label", { "data-lang-key": "transaction-id", style: "font-weight:bold;" }, ["Transaction ID"]),
                    el("div", { style: "display:flex; align-items:center; gap:12px;" }, [
                        el("div", { class: "copy-container", role: "button", id: "divSendCompletedCopy", title: "Copy", tabindex: "5" }),
                        el("div", { class: "scan-container", role: "button", id: "divSendCompletedExplorer", title: "Block Explorer", tabindex: "6" }),
                    ]),
                ]),
                el("p", { id: "pSendCompletedTxHash", style: "font-family:monospace; word-break:break-all; margin-top:4px;" }),
                el("div", { id: "divSendCompletedStatus", style: "display:flex; align-items:center; gap:10px; margin-top:12px;" }, [
                    el("img", { id: "imgSendCompletedStatus", src: "assets/icons/loading.gif", alt: "Loading", style: "width:30px; height:30px; flex-shrink:0;" }),
                    el("span", { id: "spanSendCompletedStatus", style: "font-size:0.9em;" }),
                ]),
            ]),
            el("div", { style: "margin-top:20px; display:flex; justify-content:flex-end;" }, [
                el("button", { class: "proceed", "data-lang-key": "ok", role: "button", tabindex: "4", id: "btnSendCompletedOk" }, ["Ok"]),
            ]),
        ]),
    ]);
}

function buildGasConfigDialog(): HTMLElement {
    return el("dialog", { id: "modalGasConfig", class: "modal", tabindex: "-1", role: "dialog" }, [
        el("div", { class: "modal-content", style: "margin:10% auto; max-width:460px;" }, [
            el("h3", { "data-lang-key": "gas", style: "margin-top:0;" }, ["Gas"]),
            el("div", { class: "input_container", style: "margin-top:10px;" }, [
                el("div", { class: "heading medium", "data-lang-key": "gas-limit" }, ["Gas limit (gas-units)"]),
                el("input", { class: "tab-name", type: "number", min: "0", step: "1", id: "txtGasLimit", style: "text-align: left; width: 100%;", tabindex: "7" }),
            ]),
            el("div", { class: "input_container", style: "margin-top:10px;" }, [
                el("div", { class: "heading medium", "data-lang-key": "gas-fee" }, ["Estimated gas fee (coins)"]),
                el("input", { class: "tab-name", type: "text", id: "txtGasFee", readOnly: true, style: "text-align: left; width: 100%;", tabindex: "8" }),
            ]),
            el("div", { style: "margin-top:20px; display:flex; gap:15px; justify-content:flex-end;" }, [
                el("button", { class: "cancel", "data-lang-key": "cancel", role: "button", tabindex: "9", id: "btnGasConfigCancel" }, ["Cancel"]),
                el("button", { class: "proceed", "data-lang-key": "ok", role: "button", tabindex: "10", id: "btnGasConfigOk" }, ["Ok"]),
            ]),
        ]),
    ]);
}

// Black header banner (logo + title). No burger or network-switch menu on the
// approval surface.
function buildHeader(): HTMLElement {
    return el("div", { class: "gradient", id: "gradient" }, [
        el("div", { class: "logo" }, [
            el("img", { src: "assets/icons/app/dp.png", alt: "QuantumSwap", class: "logoimg", id: "imgLogo" }),
        ]),
        el("div", { class: "animate-character", id: "divWalletTitle", "data-lang-key": "title" }, ["QuantumSwap"]),
    ]);
}

// Spoof Buster gate: shown before any request details render. The words must
// match the user's memorized Spoof Buster Words; a spoofed window cannot know
// them (it cannot read this extension's localStorage). Driven by dapp.ts,
// which also rolls the 1-in-10 training rounds.
function buildSpoofGateCard(): HTMLElement {
    return el("div", { id: "dappSpoofGateRoot", class: "center-content home-content", style: "display:none; margin-top:10px;" }, [
        el("div", { class: "center-content-rounded-container" }, [
            el("div", { class: "roundex-box scrollbar screen-scroll-box" }, [
                el("div", { class: "heading bold", "data-lang-key": "spoof-gate-title" }, ["Check your Spoof Buster Words"]),
                el("div", { class: "divider" }),
                el("div", { class: "heading medium", "data-lang-key": "spoof-gate-desc", style: "text-align:left; white-space:normal; word-break:break-word;" }, [
                    "These should match your Spoof Buster Words. If they don't, this window is fake - close it and try again.",
                ]),
                el("div", { class: "spoof-words-row", id: "dappSpoofWords" }),
                el("div", { style: "margin-top:10px; text-align:left; display:flex; flex-direction:column; gap:8px;" }, [
                    el("label", { class: "tab-label", style: "cursor:pointer;" }, [
                        el("input", { type: "radio", name: "spoof_gate_option", value: "correct", id: "optSpoofCorrect", tabindex: "1" }),
                        el("span", { "data-lang-key": "spoof-gate-correct" }, ["Correct - these are my words"]),
                    ]),
                    el("label", { class: "tab-label", style: "cursor:pointer;" }, [
                        el("input", { type: "radio", name: "spoof_gate_option", value: "incorrect", id: "optSpoofIncorrect", tabindex: "2" }),
                        el("span", { "data-lang-key": "spoof-gate-incorrect" }, ["Incorrect - these are not my words"]),
                    ]),
                ]),
                el("div", { id: "dappSpoofGateStatus", class: "heading medium", style: "margin-top:8px; text-align:left;" }),
                el("div", { style: "display:flex; justify-content:flex-end; margin-top:12px;" }, [
                    el("button", { class: "large_button_container heading large", id: "dappSpoofNextBtn", "data-lang-key": "next", role: "button", tabindex: "3" }, ["Next"]),
                ]),
            ]),
        ]),
    ]);
}

// Redirector / notice card for the dApp-triggered popup: approvals themselves
// run in the side panel; this popup only points the user there.
function buildRedirectCard(): HTMLElement {
    return el("div", { id: "dappRedirectRoot", class: "center-content home-content", style: "display:none; margin-top:10px;" }, [
        el("div", { class: "center-content-rounded-container" }, [
            el("div", { class: "roundex-box scrollbar screen-scroll-box" }, [
                el("div", { class: "heading bold", id: "dappRedirectTitle" }),
                el("div", { class: "divider" }),
                el("div", { class: "heading medium", id: "dappRedirectText", style: "text-align:left; white-space:normal; word-break:break-word;" }),
                // Stacked full-width buttons (one per row): primary action on top.
                el("div", { id: "dappRedirectButtons", style: "display:none; flex-direction:column; gap:12px; margin-top:16px;" }, [
                    el("button", { class: "large_button_container heading large", id: "dappRedirectOpenBtn", "data-lang-key": "spoof-redirect-open-btn", role: "button", tabindex: "1", style: "width:100%; box-sizing:border-box;" }, ["Open side panel & continue"]),
                    el("button", { class: "cancel", id: "dappRedirectRejectBtn", "data-lang-key": "dapp-reject", role: "button", tabindex: "2", style: "width:100%; box-sizing:border-box;" }, ["Reject"]),
                ]),
            ]),
        ]),
    ]);
}

// dApp approval card (styled like the Send screen). Populated by dapp.ts.
function buildApprovalCard(): HTMLElement {
    return el("div", { id: "dappApprovalRoot", class: "center-content home-content", style: "margin-top:10px;" }, [
        el("div", { class: "center-content-rounded-container" }, [
            el("div", { class: "roundex-box scrollbar screen-scroll-box" }, [
                el("div", { class: "gas-header-row" }, [
                    el("div", { class: "heading bold", id: "dappTitle", "data-lang-key": "dapp-connect-title" }, ["Connect Wallet"]),
                    el("div", { class: "gas-header-right", id: "dappGasHeaderRight", style: "display:none;" }, [
                        el("span", { id: "dappGasFee", class: "gas-fee-label" }),
                        el("div", { id: "dappGasIcon", class: "gas-container", role: "button", tabindex: "11" }),
                    ]),
                ]),
                el("div", { class: "divider" }),

                el("div", { class: "heading medium", style: "word-break:break-all; text-align:left;" }, [
                    el("span", { id: "dappOriginLabel", "data-lang-key": "dapp-requested-by" }, ["Requested by:"]),
                    " ",
                    el("span", { id: "dappOrigin", style: "font-weight:700;" }),
                ]),

                el("div", { id: "dappWarning", class: "heading medium", "data-lang-key": "dapp-warning", style: "margin-top:10px; text-align:left;" }, [
                    "Only continue if you trust this site. It is requesting access to your QuantumCoin wallet.",
                ]),

                // Shared account row (mirrors the connect address block) for the
                // sign and send screens. Shown via renderAccountRow().
                el("div", { id: "dappAccountRow", class: "input_container", style: "display:none; margin-top:12px;" }, [
                    el("div", { class: "heading medium", "data-lang-key": "dapp-account", style: "text-align:left;" }, ["Account"]),
                    el("div", { style: "display:flex; flex-direction:row; align-items:center; gap:15px; margin-top:4px;" }, [
                        el("div", { class: "copy-container", id: "dappAccountCopy", role: "button", tabindex: "12", title: "Copy address" }),
                        el("div", { class: "scan-container", id: "dappAccountExplorer", role: "button", tabindex: "13", title: "Open in block explorer" }),
                    ]),
                    el("div", { id: "dappAccountAddress", style: "font-size:0.78em; word-break:break-all; text-align:left; margin-top:6px;" }),
                ]),

                // Connect: choose which account to expose.
                el("div", { id: "dappConnectScreen", class: "input_container", style: "display:none; margin-top:12px;" }, [
                    el("div", { class: "heading medium", "data-lang-key": "dapp-account", style: "text-align:left;" }, ["Account"]),
                    el("div", { style: "display:flex; flex-direction:row; align-items:center; gap:15px; margin-top:4px;" }, [
                        el("div", { class: "copy-container", id: "dappCopyAddr", role: "button", tabindex: "14", title: "Copy address" }),
                        el("div", { class: "scan-container", id: "dappExplorerAddr", role: "button", tabindex: "15", title: "Open in block explorer" }),
                    ]),
                    el("div", { id: "dappSelectedAddress", style: "font-size:0.78em; word-break:break-all; text-align:left; margin-top:6px;" }),
                    el("select", { id: "dappAccountSelect", style: "display:none; width:100%; margin-top:6px; font-size:0.8em;" }),
                ]),

                // Sign: show the message to be signed.
                el("div", { id: "dappSignScreen", style: "display:none; margin-top:12px;" }, [
                    el("div", { id: "dapp-sign-trust-warning", class: "heading medium", "data-lang-key": "dapp-sign-trust-warning", style: "margin-bottom:8px; text-align:left;" }, [
                        "This message is provided by the site. A signature produced here may be reused by the requesting site.",
                    ]),
                    el("div", { class: "heading medium", "data-lang-key": "dapp-message", style: "text-align:left;" }, ["Message"]),
                    el("pre", { id: "dappSignMessage", class: "scrollbar", style: "white-space:pre-wrap; word-break:break-word; max-height:160px; overflow:auto; text-align:left;" }),
                ]),

                // Generic transaction: WYSIWYS-decoded method + params + value.
                // Populated only after the bridge verifies that the decoded details
                // re-encode to the exact calldata being signed.
                el("div", { id: "dappTxScreen", style: "display:none; margin-top:12px; text-align:left;" }, [
                    el("div", { id: "dapp-tx-trust-warning", class: "heading medium", "data-lang-key": "dapp-tx-trust-warning", style: "margin-bottom:8px; word-break:break-word;" }, [
                        "The recipient, method and parameter labels below are provided by the site and may be mislabeled. Only the raw calldata is authoritative.",
                    ]),
                    el("div", { id: "dapp-deploy-warning", class: "heading medium", "data-lang-key": "dapp-deploy-warning", style: "display:none; margin-bottom:8px; word-break:break-word;" }, [
                        "This deploys a new contract. The bytecode is opaque and unverified, and the constructor breakdown shown is chosen by the site.",
                    ]),
                    el("div", { class: "heading medium", id: "dappTxTargetRow", style: "word-break:break-all;" }, [
                        el("span", { id: "dappTxTargetLabel" }),
                        el("span", { id: "dappTxTarget", style: "font-weight:700;" }),
                    ]),
                    el("div", { class: "heading medium" }, [
                        el("span", { "data-lang-key": "dapp-value" }, ["Value"]),
                        ": ",
                        el("span", { id: "dappTxValue", style: "font-weight:700;" }),
                    ]),
                    el("div", { class: "heading medium", id: "dappTxMethodRow", style: "margin-top:6px; word-break:break-all;" }, [
                        el("span", { "data-lang-key": "dapp-method" }, ["Method"]),
                        ": ",
                        el("span", { id: "dappTxMethod", style: "font-weight:700;" }),
                    ]),
                    el("div", { id: "dappTxParams", style: "margin-top:6px;" }),
                    el("div", { class: "heading medium", style: "margin-top:8px;", "data-lang-key": "dapp-calldata" }, ["Calldata"]),
                    el("pre", { id: "dappTxData", class: "scrollbar", style: "white-space:pre-wrap; word-break:break-all; max-height:140px; overflow:auto;" }),
                ]),

                el("div", { class: "divider" }),

                el("div", { id: "dappIAgreeRow", style: "display:none; margin-top:8px; text-align:left;" }, [
                    el("label", { "data-lang-key": "type-i-agree-to-confirm" }, ["Type "]),
                    " ",
                    el("span", { "data-lang-key": "i-agree-literal" }, ["i agree"]),
                    el("label", { "data-lang-key": "type-i-agree-to-confirm-suffix" }, [" to confirm:"]),
                    " ",
                    el("input", { type: "text", id: "txtDappIAgree", tabindex: "16", autocomplete: "off" }),
                ]),
                el("div", { class: "divider" }),
                el("div", { class: "input_container", id: "dappPasswordRow" }, [
                    el("div", { class: "heading medium", "data-lang-key": "dapp-enter-password", style: "text-align:left;" }, ["Enter your wallet password"]),
                    el("div", { style: "width:100%; display:flex; align-items:center; gap:10px;" }, [
                        el("div", { style: "flex:1; min-width:0;" }, [
                            el("input", {
                                class: "tab-name", style: "text-align: left; width: 100%; font-weight: 500; letter-spacing: 0.11em;",
                                type: "password", autocomplete: "off", id: "dappPassword", name: "password",
                                "data-placeholder-key": "dapp-password-placeholder", placeholder: "Enter your wallet password", tabindex: "17",
                            }),
                        ]),
                        el("div", { style: "display:flex; align-items:center;" }, [
                            el("img", { src: "assets/svg/eye-outline.svg", alt: "Show Password", "data-alt-key": "show-password", id: "dappPwdEye", style: "cursor:pointer;width:20px;", role: "button", tabindex: "18" }),
                        ]),
                    ]),
                    el("div", { class: "divider" }),
                ]),

                el("div", { id: "dappStatus", class: "heading medium", style: "margin-top:8px; text-align:left;" }),

                el("div", { style: "display:flex; justify-content:flex-end; gap:15px; margin-top:12px;" }, [
                    el("button", { class: "cancel", id: "dappRejectBtn", "data-lang-key": "dapp-reject", role: "button", tabindex: "19" }, ["Reject"]),
                    el("button", { class: "large_button_container heading large", id: "dappApproveBtn", "data-lang-key": "dapp-approve", role: "button", tabindex: "20" }, ["Approve"]),
                ]),
            ]),
        ]),
    ]);
}

// Ambient background orbs (decorative, matches the web app's violet theme).
function buildOrb1(): HTMLElement { return el("div", { class: "qs-orb qs-orb-1" }); }
function buildOrb2(): HTMLElement { return el("div", { class: "qs-orb qs-orb-2" }); }

export const approvalScreenModules: ScreenModule[] = [
    { parentId: null, build: buildOrb1 },
    { parentId: null, build: buildOrb2 },
    { parentId: null, build: buildWaitDialog },
    { parentId: null, build: buildOkDialog },
    { parentId: null, build: buildSendCompletedDialog },
    { parentId: null, build: buildGasConfigDialog },
    { parentId: null, build: buildHeader },
    { parentId: null, build: buildSpoofGateCard },
    { parentId: null, build: buildRedirectCard },
    { parentId: null, build: buildApprovalCard },
];
