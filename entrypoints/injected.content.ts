// Injected provider (MAIN world). Runs in the page's own JS context so it can
// define window.quantumcoin, the EIP-1193-style provider dApps talk to. It has
// NO access to extension APIs; it relays every request to the ISOLATED-world
// relay (entrypoints/relay.content.ts) via window.postMessage, and receives
// responses + background events the same way.
//
// Wire protocol (all messages tagged __qcdapp so we ignore unrelated postMessage
// traffic; targetOrigin is pinned to the page origin):
//   page  -> relay : { __qcdapp, dir:'to-bg',   id, method, params }
//   relay -> page  : { __qcdapp, dir:'to-page',  id, ok, result?, error? }
//   relay -> page  : { __qcdapp, dir:'event',    event, data }
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    const w = window as unknown as { quantumcoin?: unknown };
    if (w.quantumcoin) return;

    const ORIGIN = window.location.origin;
    const callbacks = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
    const listeners: Record<string, Array<(data: any) => void>> = {};
    let seq = 0;

    function emit(event: string, data: any) {
      const list = listeners[event];
      if (!list) return;
      for (const cb of list.slice()) {
        try {
          cb(data);
        } catch (e) {
          // A misbehaving dApp listener must not break event dispatch.
          console.error("[quantumcoin] listener error", e);
        }
      }
    }

    function request(args: { method: string; params?: any }): Promise<any> {
      if (!args || typeof args.method !== "string") {
        return Promise.reject(new Error("request(args) requires a 'method' string"));
      }
      return new Promise((resolve, reject) => {
        const id = `${Date.now()}-${seq++}`;
        callbacks.set(id, { resolve, reject });
        window.postMessage(
          { __qcdapp: true, dir: "to-bg", id, method: args.method, params: args.params ?? null },
          ORIGIN,
        );
      });
    }

    function on(event: string, cb: (data: any) => void) {
      (listeners[event] || (listeners[event] = [])).push(cb);
      return provider;
    }

    function removeListener(event: string, cb: (data: any) => void) {
      const list = listeners[event];
      if (!list) return provider;
      const i = list.indexOf(cb);
      if (i >= 0) list.splice(i, 1);
      return provider;
    }

    function removeAllListeners(event?: string) {
      if (event) delete listeners[event];
      else for (const k of Object.keys(listeners)) delete listeners[k];
      return provider;
    }

    window.addEventListener("message", (ev: MessageEvent) => {
      if (ev.source !== window || ev.origin !== ORIGIN) return;
      const d = ev.data;
      if (!d || d.__qcdapp !== true) return;

      if (d.dir === "to-page") {
        const cb = callbacks.get(d.id);
        if (!cb) return;
        callbacks.delete(d.id);
        if (d.ok) cb.resolve(d.result);
        else cb.reject(new Error(d.error || "request failed"));
      } else if (d.dir === "event") {
        emit(d.event, d.data);
      }
    });

    const provider = {
      isQuantumCoin: true,
      request,
      on,
      addListener: on,
      removeListener,
      off: removeListener,
      removeAllListeners,
      // Convenience wrappers mirroring common dApp expectations.
      enable: () => request({ method: "qc_requestAccounts" }),
    };

    try {
      Object.defineProperty(window, "quantumcoin", { value: provider, configurable: false, writable: false });
    } catch {
      (window as any).quantumcoin = provider;
    }

    // Let dApps that loaded before us know the provider is ready.
    try {
      window.dispatchEvent(new Event("quantumcoin#initialized"));
    } catch {
      /* ignore */
    }
  },
});
