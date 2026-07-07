// The wallet logic (SDK + WASM) runs in the extension page (see
// public/platform-bridge.js), not here. This service worker makes the docked
// surface the default toolbar action:
//   - Chromium: open the Side Panel on action click (openPanelOnActionClick).
//   - Firefox (no sidePanel API): open the sidebar on browserAction click.
// The action has no default_popup, so the toolbar click reaches the extension
// instead of opening the popup overlay.
export default defineBackground(() => {
  const g = globalThis as { chrome?: any; browser?: any };
  const cr = g.chrome;

  if (cr?.sidePanel) {
    cr.sidePanel
      .setOptions({ path: "index.html?view=panel" })
      .catch(() => {});
    cr.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }

  // Firefox: no sidePanel API. Open the sidebar from the toolbar click. The call
  // must run inside the onClicked user-gesture handler for sidebarAction.open().
  const bx = g.browser;
  const browserAction = bx?.action || bx?.browserAction;
  if (bx?.sidebarAction?.open && browserAction?.onClicked) {
    browserAction.onClicked.addListener(() => {
      bx.sidebarAction.open().catch(() => {});
    });
  }
});
