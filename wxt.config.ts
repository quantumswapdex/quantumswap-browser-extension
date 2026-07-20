import { defineConfig } from "wxt";

// The wallet UI is built from the TypeScript entrypoints (entrypoints/index for
// the wallet surfaces, entrypoints/approve for the dApp approval popup); static
// assets (CSS/fonts/icons/json) live in `public/`. The post-quantum WASM SDK
// bundle is produced by `scripts/build-bridge.mjs` into `public/platform-bridge.js`
// and loaded as the first classic script inside each entrypoint HTML.
export default defineConfig({
  // The default esbuild target lowers object-rest destructuring used by WXT's
  // content-script wrapper below what esbuild can transform. Pin a modern target
  // (object rest is ES2018) so content scripts build.
  vite: () => ({
    build: { target: "es2022" },
  }),
  manifest: ({ browser }) => ({
    name: "QuantumSwap Browser Extension",
    description: "Self-custody QuantumCoin wallet with token swaps, dApp connectivity, and quantum-resistant security.",
    // Icons generated from the Electron app logo (src/assets/svg/quantumswap.svg)
    // by scripts/build-icons.mjs -> public/icon/*.png.
    icons: {
      16: "/icon/16.png",
      32: "/icon/32.png",
      48: "/icon/48.png",
      96: "/icon/96.png",
      128: "/icon/128.png",
    },
    action: {
      // The toolbar click opens the docked surface by default: the Side Panel on
      // Chromium (openPanelOnActionClick, see entrypoints/background.ts) and the
      // sidebar on Firefox (browserAction.onClicked). No default_popup is set so
      // the click is delivered to the extension instead of opening the popup; the
      // other surfaces (Overlay/Pop out/Full screen) stay reachable via the
      // burger menu, subject to each browser's popup support.
      default_title: "QuantumSwap Wallet",
      default_icon: {
        16: "/icon/16.png",
        32: "/icon/32.png",
        48: "/icon/48.png",
        128: "/icon/128.png",
      },
    },
    // Docked surface, opened on demand via the "Dock" menu action.
    ...(browser === "firefox"
      ? {
          sidebar_action: {
            default_panel: "index.html?view=panel",
            default_title: "QuantumSwap Wallet",
            default_icon: "/icon/48.png",
          },
        }
      : {
          side_panel: { default_path: "index.html" },
        }),
    permissions: [
      "clipboardWrite",
      // dApp broker persists connected-sites in chrome.storage.local.
      "storage",
      ...(browser === "firefox" ? [] : ["sidePanel"]),
    ],
    host_permissions: ["http://*/*", "https://*/*"],
    // WASM (Go) is instantiated in the popup; MV3 requires 'wasm-unsafe-eval'.
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "quantumswap-wallet@quantumswap.community",
              strict_min_version: "121.0",
            },
          },
        }
      : {}),
  }),
});
