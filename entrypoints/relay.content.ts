// Content relay (ISOLATED world). Bridges the page's injected provider
// (window.postMessage) to the background service worker, and forwards
// background-emitted events back to the page. This is the only side of the pair
// with access to extension APIs.
//
// Transport is a long-lived runtime Port (not one-shot sendMessage): while a
// request is in flight the open port keeps the MV3 service worker alive and
// gives us a durable channel, so results/events still arrive if the approval
// popup outlives a would-be service-worker eviction.
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  main() {
    // Prefer the promise-based `browser` namespace (WXT polyfill / Firefox);
    // fall back to `chrome`.
    const cr = (globalThis as unknown as { browser?: any }).browser
      || (globalThis as unknown as { chrome?: any }).chrome;
    if (!cr?.runtime) return;

    const ORIGIN = window.location.origin;
    let port: any = null;

    function toPage(msg: any) {
      window.postMessage(Object.assign({ __qcdapp: true }, msg), ORIGIN);
    }

    function ensurePort() {
      if (port) return port;
      port = cr.runtime.connect({ name: "qc" });
      port.onMessage.addListener((msg: any) => {
        if (!msg) return;
        if (msg.type === "qc-response") {
          toPage({ dir: "to-page", id: msg.id, ok: msg.ok, result: msg.result, error: msg.error });
        } else if (msg.type === "qc-event") {
          toPage({ dir: "event", event: msg.event, data: msg.data });
        }
      });
      port.onDisconnect.addListener(() => {
        port = null;
      });
      return port;
    }

    // page -> background: forward provider requests over the port.
    window.addEventListener("message", (ev: MessageEvent) => {
      if (ev.source !== window || ev.origin !== ORIGIN) return;
      const d = ev.data;
      if (!d || d.__qcdapp !== true || d.dir !== "to-bg") return;
      try {
        ensurePort().postMessage({ type: "qc-request", id: d.id, method: d.method, params: d.params });
      } catch (e: any) {
        port = null;
        toPage({ dir: "to-page", id: d.id, ok: false, error: String((e && e.message) || e) });
      }
    });

    // Fallback path for background events sent via tabs.sendMessage (e.g. if the
    // port was torn down). Port delivery above is the primary path.
    cr.runtime.onMessage.addListener((msg: any) => {
      if (msg && msg.type === "qc-event") {
        toPage({ dir: "event", event: msg.event, data: msg.data });
      }
    });
  },
});
