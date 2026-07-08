// The wallet logic (SDK + WASM) runs in the extension page (see
// public/platform-bridge.js), not here. This service worker does two things:
//   1. Makes the docked surface the default toolbar action (side panel / sidebar).
//   2. Acts as the dApp broker for the web3 provider: it receives provider
//      requests relayed from content scripts, opens focused approval popups,
//      resolves the page's promise with the signed/broadcast result, and owns
//      post-broadcast confirmation polling so transactionResult events fire even
//      if the approval popup was closed.

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  method: string;
  params: any;
  origin: string;
  tabId: number | null;
};

type ConnectedSite = {
  address: string;
  chainId: number | null;
  network: any;
};

const CONNECTED_SITES_KEY = "qc_connected_sites";

export default defineBackground(() => {
  const g = globalThis as { chrome?: any; browser?: any };
  const cr = g.chrome;
  const bx = g.browser;
  // Prefer the promise-based `browser` namespace (Firefox); fall back to
  // `chrome` (MV3 also returns promises). `cr`/`bx` are kept for the
  // browser-specific surface calls below.
  const ext = bx || cr;

  // ---- Surface behavior (unchanged) -------------------------------------
  if (cr?.sidePanel) {
    cr.sidePanel.setOptions({ path: "index.html?view=panel" }).catch(() => {});
    cr.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }

  const browserAction = bx?.action || bx?.browserAction;
  if (bx?.sidebarAction?.open && browserAction?.onClicked) {
    browserAction.onClicked.addListener(() => {
      bx.sidebarAction.open().catch(() => {});
    });
  }

  if (!ext?.runtime?.onMessage) return;

  // ---- dApp broker ------------------------------------------------------
  const pending = new Map<string, PendingRequest>();
  // Active relay ports (one per connected dApp tab). An open port keeps the
  // service worker alive for the duration of a request and is the durable
  // channel we push responses + events back through.
  const ports = new Set<any>();
  let reqCounter = 0;

  function safePost(port: any, msg: any) {
    try {
      port.postMessage(msg);
    } catch {
      /* port closed */
    }
  }

  function storageGet(key: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        const p = ext.storage.local.get(key);
        if (p && typeof p.then === "function") {
          p.then((o: any) => resolve(o ? o[key] : undefined)).catch(() => resolve(undefined));
        } else {
          ext.storage.local.get(key, (o: any) => resolve(o ? o[key] : undefined));
        }
      } catch {
        resolve(undefined);
      }
    });
  }

  function storageSet(key: string, value: any): Promise<void> {
    return new Promise((resolve) => {
      try {
        const p = ext.storage.local.set({ [key]: value });
        if (p && typeof p.then === "function") p.then(() => resolve()).catch(() => resolve());
        else ext.storage.local.set({ [key]: value }, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  async function getConnectedSites(): Promise<Record<string, ConnectedSite>> {
    const sites = await storageGet(CONNECTED_SITES_KEY);
    return sites && typeof sites === "object" ? sites : {};
  }

  async function setConnectedSite(origin: string, info: ConnectedSite) {
    const sites = await getConnectedSites();
    sites[origin] = info;
    await storageSet(CONNECTED_SITES_KEY, sites);
  }

  async function removeConnectedSite(origin: string) {
    const sites = await getConnectedSites();
    delete sites[origin];
    await storageSet(CONNECTED_SITES_KEY, sites);
  }

  function emitToTab(tabId: number | null, event: string, data: any) {
    if (tabId == null) return;
    // Primary path: push over any live relay port for this tab.
    let sent = false;
    for (const p of ports) {
      if (p?.sender?.tab?.id === tabId) {
        safePost(p, { type: "qc-event", event, data });
        sent = true;
      }
    }
    if (sent) return;
    // Fallback: one-shot message to the tab's relay.
    try {
      const p = ext.tabs.sendMessage(tabId, { type: "qc-event", event, data });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* tab may be gone */
    }
  }

  function openApproval(method: string, params: any, origin: string, tabId: number | null): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${reqCounter++}`;
      pending.set(requestId, { resolve, reject, method, params, origin, tabId });
      const url = ext.runtime.getURL(`approve.html?requestId=${encodeURIComponent(requestId)}`);
      const done = (win?: any) => {
        // If the popup is closed without answering, auto-reject the request.
        const winId = win && win.id;
        if (winId != null && ext.windows?.onRemoved) {
          const onRemoved = (closedId: number) => {
            if (closedId === winId) {
              ext.windows.onRemoved.removeListener(onRemoved);
              const p = pending.get(requestId);
              if (p) {
                pending.delete(requestId);
                p.reject(new Error("User rejected the request"));
              }
            }
          };
          ext.windows.onRemoved.addListener(onRemoved);
        }
      };
      // Detached popup windows aren't subject to the ~800x600 toolbar-popup cap,
      // so a 600x800 approval window is allowed (browser still clamps to screen).
      const width = 600;
      const height = 800;
      // Center the popup over the browser window (fall back to no explicit
      // position if the last-focused window can't be read).
      centeredBounds(width, height)
        .then((pos) => {
          const opts: any = { url, type: "popup", width, height };
          if (pos) { opts.left = pos.left; opts.top = pos.top; }
          try {
            // MV3 chrome and the browser polyfill both return a promise. Only fall
            // back to the callback form when no promise is returned (never both, to
            // avoid opening two popups).
            const created = ext.windows.create(opts, (win: any) => {
              if (!created || typeof created.then !== "function") done(win);
            });
            if (created && typeof created.then === "function") {
              created.then(done).catch((e: any) => { pending.delete(requestId); reject(e); });
            }
          } catch (e) {
            pending.delete(requestId);
            reject(e);
          }
        });
    });
  }

  // Compute a top-left that centers a width x height popup over the currently
  // focused browser window. Resolves null when the window bounds are unavailable.
  function centeredBounds(width: number, height: number): Promise<{ left: number; top: number } | null> {
    return new Promise((resolve) => {
      try {
        const center = (win: any) => {
          if (!win || win.width == null || win.height == null) { resolve(null); return; }
          const left = Math.round((win.left || 0) + (win.width - width) / 2);
          const top = Math.round((win.top || 0) + (win.height - height) / 2);
          resolve({ left: Math.max(0, left), top: Math.max(0, top) });
        };
        const p = ext.windows.getLastFocused(
          { populate: false },
          (win: any) => { if (!p || typeof p.then !== "function") center(win); },
        );
        if (p && typeof p.then === "function") p.then(center).catch(() => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }

  // ---- request validation ----------------------------------------------
  // Reject malformed / incompatible requests before opening any approval popup,
  // so the dApp's provider.request(...) rejects immediately (no popup for junk).
  // Cheap, SDK-free checks; the approval page does an authoritative recheck.
  function isEthStyleAddress(a: any): boolean {
    return typeof a === "string" && /^0x?[0-9a-fA-F]{40}$/.test(a.trim());
  }
  function isQcHexAddress(a: any): boolean {
    return typeof a === "string" && /^0x?[0-9a-fA-F]{64}$/.test(a.trim());
  }
  function checkAddress(a: any): string | null {
    if (isEthStyleAddress(a)) {
      return "Incompatible address: QuantumCoin uses 32-byte (64-hex) addresses; received an Ethereum-style 20-byte address.";
    }
    if (!isQcHexAddress(a)) return "Invalid QuantumCoin address.";
    return null;
  }
  function validateRequest(method: string, params: any) {
    if (method === "qc_signMessage") {
      if (typeof params.message !== "string" || params.message.length === 0) {
        throw new Error("Invalid message: expected a non-empty string.");
      }
      return;
    }
    if (method === "qc_sendToken" || method === "qc_sendCoin") {
      if (method === "qc_sendToken") {
        const e = checkAddress(params.contractAddress);
        if (e) throw new Error(e);
      }
      const toErr = checkAddress(params.to);
      if (toErr) throw new Error(toErr);
      const amt = Number(params.amount);
      if (!isFinite(amt) || amt <= 0) throw new Error("Invalid amount.");
    }
  }

  async function handleRpc(msg: any, sender: any): Promise<any> {
    const origin = sender?.origin || (sender?.url ? new URL(sender.url).origin : "");
    const tabId = sender?.tab?.id ?? null;
    const params = msg.params || {};
    const sites = await getConnectedSites();
    const site = sites[origin];

    switch (msg.method) {
      case "qc_requestAccounts": {
        if (site) return [site.address];
        const r = await openApproval("qc_requestAccounts", params, origin, tabId);
        return [r.address];
      }
      case "qc_accounts":
        return site ? [site.address] : [];
      case "qc_chainId":
        return site ? site.chainId : null;
      case "qc_getNetwork":
        return site ? site.network : null;
      case "qc_signMessage": {
        if (!site) throw new Error("Not connected. Call qc_requestAccounts first.");
        validateRequest("qc_signMessage", params);
        const r = await openApproval("qc_signMessage", { ...params, address: site.address }, origin, tabId);
        return r.signature;
      }
      case "qc_sendToken": {
        if (!site) throw new Error("Not connected. Call qc_requestAccounts first.");
        validateRequest("qc_sendToken", params);
        return await openApproval(
          "qc_sendToken",
          { ...params, from: site.address, network: site.network, chainId: site.chainId },
          origin,
          tabId,
        );
      }
      case "qc_sendCoin": {
        if (!site) throw new Error("Not connected. Call qc_requestAccounts first.");
        validateRequest("qc_sendCoin", params);
        return await openApproval(
          "qc_sendCoin",
          { ...params, from: site.address, network: site.network, chainId: site.chainId },
          origin,
          tabId,
        );
      }
      case "qc_disconnect": {
        await removeConnectedSite(origin);
        emitToTab(tabId, "accountsChanged", []);
        emitToTab(tabId, "disconnect", {});
        return true;
      }
      default:
        throw new Error("Unsupported method: " + msg.method);
    }
  }

  // Provider requests arrive over the long-lived relay port.
  ext.runtime.onConnect.addListener((port: any) => {
    if (port?.name !== "qc") return;
    ports.add(port);
    port.onMessage.addListener((msg: any) => {
      if (!msg || msg.type !== "qc-request") return;
      handleRpc(msg, port.sender)
        .then((result) => safePost(port, { type: "qc-response", id: msg.id, ok: true, result }))
        .catch((e) => safePost(port, { type: "qc-response", id: msg.id, ok: false, error: String((e && e.message) || e) }));
    });
    port.onDisconnect.addListener(() => ports.delete(port));
  });

  // Approval-popup <-> broker messages (short-lived; the popup is an extension
  // page and the originating tab's port keeps the worker alive meanwhile).
  ext.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: (r: any) => void) => {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "qc-approval-getRequest") {
      const p = pending.get(msg.requestId);
      sendResponse(
        p ? { ok: true, request: { method: p.method, params: p.params, origin: p.origin } } : { ok: false, error: "no such request" },
      );
      return; // sync
    }

    if (msg.type === "qc-approval-result") {
      const p = pending.get(msg.requestId);
      if (p) {
        pending.delete(msg.requestId);
        if (msg.approved) {
          if (p.method === "qc_requestAccounts" && msg.result && msg.result.address) {
            const info: ConnectedSite = {
              address: msg.result.address,
              chainId: msg.result.chainId ?? null,
              network: msg.result.network ?? null,
            };
            setConnectedSite(p.origin, info).then(() => {
              emitToTab(p.tabId, "connect", { chainId: info.chainId });
              emitToTab(p.tabId, "accountsChanged", [info.address]);
            });
          }
          p.resolve(msg.result);
        } else {
          p.reject(new Error(msg.error || "User rejected the request"));
        }
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "qc-approval-txBroadcast") {
      const p = pending.get(msg.requestId);
      if (p) {
        pending.delete(msg.requestId);
        p.resolve({ txHash: msg.txHash });
        watchTransaction(p.tabId, msg.txHash, msg.scanApiDomain, msg.address);
      }
      sendResponse({ ok: true });
      return;
    }
  });

  // ---- Background confirmation polling ----------------------------------
  // Owns the tx lifecycle after broadcast so transactionResult fires even if the
  // approval popup is gone. Mirrors the scan-API shape used by public/js/api.js.
  function scanScheme(domain: string): string {
    const httpAllowed = domain.startsWith("localhost:") || /^(\d{1,3}\.){3}\d{1,3}(:[0-9]{1,5})?$/.test(domain);
    return httpAllowed ? "http://" : "https://";
  }

  async function fetchTxList(scanApiDomain: string, address: string, pending: boolean): Promise<any[]> {
    const base = scanScheme(scanApiDomain) + scanApiDomain + "/account/" + address + "/transactions/";
    const url = pending ? base + "pending/0" : base + "0";
    const resp = await fetch(url);
    const json = await resp.json();
    return Array.isArray(json?.items) ? json.items : [];
  }

  function watchTransaction(tabId: number | null, txHash: string, scanApiDomain: string, address: string) {
    if (!txHash || !scanApiDomain || !address) return;
    const startedAt = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000;
    const INTERVAL_MS = 9000;

    const tick = async () => {
      try {
        const completed = await fetchTxList(scanApiDomain, address, false);
        const found = completed.find((t) => t && t.hash === txHash);
        if (found) {
          const status = found.status === "0x1" ? "succeeded" : "failed";
          emitToTab(tabId, "transactionResult", { txHash, status });
          return;
        }
      } catch {
        /* transient network error; keep polling */
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        emitToTab(tabId, "transactionResult", { txHash, status: "timeout" });
        return;
      }
      setTimeout(tick, INTERVAL_MS);
    };

    setTimeout(tick, INTERVAL_MS);
  }
});
