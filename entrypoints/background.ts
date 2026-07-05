// The wallet logic (SDK + WASM) runs in the extension page (see
// public/platform-bridge.js), not here. This service worker only configures the
// Side Panel path. The toolbar click opens the "Overlay" (action popup), so
// openPanelOnActionClick is false; the panel is opened on demand by the burger
// menu's "Dock" action. Firefox has no sidePanel API and uses sidebar_action.
export default defineBackground(() => {
  const cr = (globalThis as { chrome?: any }).chrome;
  if (cr?.sidePanel) {
    cr.sidePanel
      .setOptions({ path: "index.html?view=panel" })
      .catch(() => {});
    cr.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => {});
  }
});
