// Release list and add-release screens (children of #settings-content).
// Port of the browser extension's #releaseListScreen / #releaseAddScreen.
import { el } from "../ui/dom";
import type { ScreenModule } from "../ui/screens";
import { showSettingsScreen, togglePasswordBox } from "../app/app";
import { addRelease, showAddReleaseScreen, showReleasesScreen } from "../app/release";

const RELEASE_INPUT_STYLE = "text-align: left; width: 100%; border: none; outline: none; font-weight: 500; color: black; letter-spacing: 0.11em;";

function buildReleaseListScreen(): HTMLElement {
    return el("div", { class: "content", id: "releaseListScreen", style: "display: none;" }, [
        el("div", { class: "center-content" }, [
            el("div", { class: "center-content-rounded-container", style: "margin-top:15px;" }, [
                el("div", { class: "back-container", role: "button", tabindex: "3", onclick: () => { void showSettingsScreen(); } }),
                el("div", { class: "roundex-box", style: "padding-top: 15px; padding-bottom: 15px;" }, [
                    el("div", {}, [
                        el("div", { class: "heading large", style: "float:left;width:fit-content;", "data-lang-key": "releases" }, ["Releases"]),
                    ]),
                    el("div", { class: "divider" }),
                    el("div", { class: "blocks-content scrollbar", style: "text-align: left; overflow: auto ;max-height:380px;", id: "divReleaseList", tabindex: "1" }, [
                        el("table", { class: "styled-table" }, [
                            el("thead", {}, [
                                el("tr", {}, [
                                    el("th", { "data-lang-key": "active" }, ["Active"]),
                                    el("th", { "data-lang-key": "name" }, ["Name"]),
                                    el("th", { "data-lang-key": "release-wq" }, ["WQ"]),
                                    el("th", { "data-lang-key": "release-factory" }, ["Factory"]),
                                    el("th", { "data-lang-key": "release-router" }, ["Router"]),
                                    el("th", {}),
                                ]),
                            ]),
                            el("tbody", { id: "tbodyReleaseRow" }),
                        ]),
                    ]),
                    el("div", { class: "divider" }),
                    el("div", { style: "align-content:center;" }, [
                        el("a", { href: "#", "data-lang-key": "add-release", tabindex: "2", onclick: (event: Event) => { event.preventDefault(); showAddReleaseScreen(); } }, ["Add Release"]),
                    ]),
                ]),
            ]),
        ]),
    ]);
}

function buildReleaseAddScreen(): HTMLElement {
    return el("div", { class: "content", id: "releaseAddScreen", style: "display: none;" }, [
        el("div", { class: "center-content" }, [
            el("div", { class: "center-content-rounded-container", style: "margin-top:15px;" }, [
                el("div", { class: "back-container", role: "button", tabindex: "3", onclick: () => { void showReleasesScreen(); } }),
                el("div", { class: "roundex-box", style: "padding-top: 15px; padding-bottom: 15px;" }, [
                    el("div", {}, [
                        el("div", { class: "heading large", style: "float:left;width:fit-content;", "data-lang-key": "add-release" }, ["Add Release"]),
                    ]),
                    el("div", { class: "divider" }),
                    el("div", { class: "blocks-content scrollbar", style: "text-align: left; overflow: auto ;" }, [
                        el("div", { class: "input_container" }, [
                            el("div", { class: "heading medium", "data-lang-key": "release-name" }, ["Release Name"]),
                            el("input", { class: "tab-name", style: RELEASE_INPUT_STYLE, type: "text", autocomplete: "off", id: "txtReleaseName", name: "release_name", maxlength: "60", tabindex: "1" }),
                            el("div", { class: "divider" }),
                            el("div", { class: "heading medium", "data-lang-key": "release-wq-address" }, ["WQ Contract Address"]),
                            el("input", { class: "tab-name", style: RELEASE_INPUT_STYLE, type: "text", autocomplete: "off", id: "txtReleaseWq", name: "release_wq", placeholder: "0x...", tabindex: "2" }),
                            el("div", { class: "divider" }),
                            el("div", { class: "heading medium", "data-lang-key": "release-factory-address" }, ["Factory Contract Address"]),
                            el("input", { class: "tab-name", style: RELEASE_INPUT_STYLE, type: "text", autocomplete: "off", id: "txtReleaseFactory", name: "release_factory", placeholder: "0x...", tabindex: "3" }),
                            el("div", { class: "divider" }),
                            el("div", { class: "heading medium", "data-lang-key": "release-router-address" }, ["Router Contract Address"]),
                            el("input", { class: "tab-name", style: RELEASE_INPUT_STYLE, type: "text", autocomplete: "off", id: "txtReleaseRouter", name: "release_router", placeholder: "0x...", tabindex: "4" }),
                            el("div", { class: "divider" }),
                            // Releases are stored encrypted with the wallet main
                            // key, so adding one needs the wallet password.
                            el("div", { class: "heading medium", "data-lang-key": "enter-wallet-password" }, ["Enter Quantum Wallet Password"]),
                            el("div", { style: "width:100%;display:flex;align-items:center;" }, [
                                el("div", { style: "width: 80%;" }, [
                                    el("input", {
                                        class: "tab-name qs-input-strong",
                                        type: "password", autocomplete: "off", id: "pwdAddRelease", name: "password",
                                        "data-placeholder-key": "password", placeholder: "Enter the password", tabindex: "5",
                                    }),
                                ]),
                                el("div", {}, [
                                    el("img", {
                                        src: "assets/svg/eye-outline.svg", alt: "Show Password", class: "qs-eye",
                                        role: "button", tabindex: "6",
                                        onclick: (event: Event) => togglePasswordBox(event.currentTarget as HTMLElement, "pwdAddRelease"),
                                    }),
                                ]),
                            ]),
                            el("div", { class: "divider" }),
                        ]),
                    ]),
                    el("div", { class: "large_button_container heading large", style: "float:right;", "data-lang-key": "add", role: "button", tabindex: "7", onclick: () => addRelease() }, ["Add"]),
                ]),
            ]),
        ]),
    ]);
}

export const releaseScreenModules: ScreenModule[] = [
    { parentId: "settings-content", build: buildReleaseListScreen },
    { parentId: "settings-content", build: buildReleaseAddScreen },
];
