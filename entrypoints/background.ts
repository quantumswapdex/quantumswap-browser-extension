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

// Per-origin connection record. `accounts` is the permitted set the origin may
// use; `activeAddress` is the currently exposed account (null => the docked
// wallet's active account is not in the permitted set, so the origin sees itself
// as disconnected but stays permitted so switching back reconnects).
type ConnectedSite = {
  accounts: string[];
  activeAddress: string | null;
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

  // ---- First-run experience ---------------------------------------------
  // On a fresh install open the wallet docked (Side Panel on Chromium, sidebar
  // on Firefox). Both open() calls normally require a user gesture, so fall back
  // to a full browser tab when the browser rejects the programmatic open.
  if (ext?.runtime?.onInstalled) {
    ext.runtime.onInstalled.addListener((details: any) => {
      if (!details || details.reason !== "install") return;

      const openTabFallback = () => {
        try {
          const p = ext.tabs.create({ url: ext.runtime.getURL("index.html?view=tab") });
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch {
          /* ignore */
        }
      };

      const openDocked = (windowId?: number) => {
        // Chromium: side panel. Firefox: sidebar action.
        if (cr?.sidePanel?.open) {
          try {
            const opts = windowId != null ? { windowId } : {};
            const p = cr.sidePanel.open(opts);
            if (p && typeof p.then === "function") p.then(() => {}).catch(openTabFallback);
            return;
          } catch {
            openTabFallback();
            return;
          }
        }
        if (bx?.sidebarAction?.open) {
          try {
            const p = bx.sidebarAction.open();
            if (p && typeof p.then === "function") p.then(() => {}).catch(openTabFallback);
            else openTabFallback();
            return;
          } catch {
            openTabFallback();
            return;
          }
        }
        openTabFallback();
      };

      try {
        const w = ext.windows?.getCurrent?.();
        if (w && typeof w.then === "function") {
          w.then((win: any) => openDocked(win && win.id)).catch(() => openDocked());
        } else {
          openDocked();
        }
      } catch {
        openDocked();
      }
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

  // Upgrade any legacy single-address record ({ address, chainId, network }) to
  // the per-origin permitted-accounts shape, and defensively normalize partial
  // records. Returns null for a missing/invalid site.
  function normalizeSite(raw: any): ConnectedSite | null {
    if (!raw || typeof raw !== "object") return null;
    if (Array.isArray(raw.accounts)) {
      const accounts = raw.accounts.filter((a: any) => typeof a === "string" && a);
      let activeAddress: string | null =
        typeof raw.activeAddress === "string" && raw.activeAddress ? raw.activeAddress : null;
      if (activeAddress && !accounts.includes(activeAddress)) activeAddress = null;
      return { accounts, activeAddress, chainId: raw.chainId ?? null, network: raw.network ?? null };
    }
    // Legacy shape: a single `address` that was both permitted and active.
    if (typeof raw.address === "string" && raw.address) {
      return { accounts: [raw.address], activeAddress: raw.address, chainId: raw.chainId ?? null, network: raw.network ?? null };
    }
    return null;
  }

  async function getConnectedSites(): Promise<Record<string, ConnectedSite>> {
    const raw = await storageGet(CONNECTED_SITES_KEY);
    const out: Record<string, ConnectedSite> = {};
    if (raw && typeof raw === "object") {
      for (const o of Object.keys(raw)) {
        const s = normalizeSite(raw[o]);
        if (s) out[o] = s;
      }
    }
    return out;
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

  // Emit an event to every tab of a given origin. Prefers any live relay port
  // (keeps working if the tab hasn't been re-scanned), and falls back to
  // tabs.query + tabs.sendMessage for origins whose port was torn down (e.g.
  // after the MV3 service worker was evicted), so a wallet switch still reaches
  // connected pages that aren't mid-request.
  function emitToOrigin(origin: string, event: string, data: any) {
    if (!origin) return;
    const portTabIds = new Set<number>();
    for (const p of ports) {
      const o = p?.sender?.origin || (p?.sender?.url ? new URL(p.sender.url).origin : "");
      if (o === origin) {
        safePost(p, { type: "qc-event", event, data });
        const tid = p?.sender?.tab?.id;
        if (tid != null) portTabIds.add(tid);
      }
    }
    // Also reach same-origin tabs without a live port.
    try {
      const q = ext.tabs.query({ url: origin + "/*" }, (tabs: any[]) => {
        if (!q || typeof q.then !== "function") sendToTabs(tabs);
      });
      if (q && typeof q.then === "function") q.then(sendToTabs).catch(() => {});
    } catch {
      /* tabs API unavailable */
    }

    function sendToTabs(tabs: any[]) {
      if (!Array.isArray(tabs)) return;
      for (const tab of tabs) {
        const tid = tab && tab.id;
        if (tid == null || portTabIds.has(tid)) continue;
        try {
          const p = ext.tabs.sendMessage(tid, { type: "qc-event", event, data });
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch {
          /* tab may be gone */
        }
      }
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
    if (method === "qc_sendTransaction") {
      // Mirrors eth_sendTransaction: optional `to` (absent => contract creation),
      // hex `data`, hex-wei `value`. Cheap shape checks only; the approval page
      // does the authoritative ABI decode + WYSIWYS re-encode verification.
      const toRaw = params.to == null ? "" : String(params.to).trim();
      const dataRaw = params.data == null ? "" : String(params.data).trim();
      if (toRaw !== "") {
        const toErr = checkAddress(toRaw);
        if (toErr) throw new Error(toErr);
      }
      const hasData = dataRaw !== "" && dataRaw !== "0x" && dataRaw !== "0X";
      if (toRaw === "" && !hasData) {
        throw new Error("Invalid transaction: provide a recipient (to) and/or contract data.");
      }
      if (dataRaw !== "" && !/^0x?[0-9a-fA-F]*$/.test(dataRaw)) {
        throw new Error("Invalid transaction data: expected a hex string.");
      }
      const bytes = dataRaw.replace(/^0[xX]/, "");
      if (bytes.length % 2 !== 0) {
        throw new Error("Invalid transaction data: hex string must have an even length.");
      }
      if (params.value != null && String(params.value).trim() !== "") {
        const v = String(params.value).trim();
        try {
          if (BigInt(v) < 0n) throw new Error("negative");
        } catch {
          throw new Error("Invalid transaction value: expected a hex-wei or decimal-wei amount.");
        }
      }
    }
  }

  // ---- read-only JSON-RPC passthrough -----------------------------------
  // Standard EIP-1193 providers forward read-only JSON-RPC calls to the node so
  // dApps can query chain state (balances, receipts, logs, eth_call) through the
  // same provider they sign with. We proxy a strict allowlist of read methods to
  // the connected origin's node RPC via fetch: no popup, no signing, no account
  // unlock. Write/sign methods are intentionally excluded (those go through the
  // qc_* approval flow).
  const READ_RPC_METHODS = new Set<string>([
    "eth_blockNumber",
    "eth_chainId",
    "eth_call",
    "eth_estimateGas",
    "eth_gasPrice",
    "eth_maxPriorityFeePerGas",
    "eth_feeHistory",
    "eth_getBalance",
    "eth_getCode",
    "eth_getStorageAt",
    "eth_getLogs",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
    "eth_getBlockTransactionCountByNumber",
    "eth_getBlockTransactionCountByHash",
    "eth_getTransactionByHash",
    "eth_getTransactionByBlockNumberAndIndex",
    "eth_getTransactionByBlockHashAndIndex",
    "eth_getTransactionCount",
    "eth_getTransactionReceipt",
    "eth_getBlockReceipts",
    "eth_syncing",
    "net_version",
    "net_listening",
    "web3_clientVersion",
  ]);

  // Browsers reach RPC over HTTP(S) only. Mirrors buildSwapRpcUrl in
  // src/bridge/handlers/chain.js: a bare host resolves to https, except
  // localhost / IPv4 literals which default to http.
  function buildRpcUrl(rpcEndpoint: any): string | null {
    if (!rpcEndpoint || typeof rpcEndpoint !== "string") return null;
    const s = rpcEndpoint.trim();
    if (s === "") return null;
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    const isIpAddress = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(s);
    const isLocalhost = /^localhost(:\d+)?$/i.test(s);
    return (isIpAddress || isLocalhost ? "http://" : "https://") + s;
  }

  let rpcIdCounter = 0;

  // Forward one allowlisted read method to the origin's node RPC and return the
  // JSON-RPC `result`. Throws with the node's error message (code preserved when
  // available) on a JSON-RPC error, and on transport/timeout failures. dApp
  // params follow the Ethereum array convention; non-arrays are normalized to [].
  async function rpcPassthrough(method: string, params: any, site: ConnectedSite | null): Promise<any> {
    const endpoint = site && site.network ? buildRpcUrl(site.network.rpcEndpoint) : null;
    if (!endpoint) {
      throw new Error("Not connected: call qc_requestAccounts first.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let resp: any;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++rpcIdCounter,
          method,
          params: Array.isArray(params) ? params : [],
        }),
        signal: controller.signal,
      });
    } catch (e: any) {
      throw new Error(
        e && e.name === "AbortError"
          ? "RPC request timed out"
          : `RPC request failed: ${String((e && e.message) || e)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    let json: any;
    try {
      json = await resp.json();
    } catch {
      throw new Error(`RPC returned a non-JSON response (HTTP ${resp.status})`);
    }
    if (json && json.error) {
      const err: any = new Error((json.error && json.error.message) || "RPC error");
      if (json.error && json.error.code != null) err.code = json.error.code;
      throw err;
    }
    return json ? json.result : undefined;
  }

  async function handleRpc(msg: any, sender: any): Promise<any> {
    const origin = sender?.origin || (sender?.url ? new URL(sender.url).origin : "");
    const tabId = sender?.tab?.id ?? null;
    const params = msg.params || {};
    const sites = await getConnectedSites();
    const site = sites[origin] || null;
    // The effective account exposed to this origin. Null when the origin has no
    // record, or when the docked wallet's active account is not in its permitted
    // set (a "connected but currently on a different wallet" state).
    const active = site ? site.activeAddress : null;
    const notConnectedError = "The active account is not connected to this site. Call qc_requestAccounts first.";

    // Read-only JSON-RPC passthrough (EIP-1193): forward allowlisted read methods
    // to the connected origin's node RPC. Requires a connected site (so we know
    // which network's RPC to use) but no unlocked/active account. eth_chainId /
    // net_version are part of this allowlist and answered by the node.
    if (READ_RPC_METHODS.has(msg.method)) {
      if (!site || !site.network) throw new Error(notConnectedError);
      return rpcPassthrough(msg.method, params, site);
    }

    switch (msg.method) {
      case "eth_requestAccounts":
      case "qc_requestAccounts": {
        if (active) return [active];
        // No record yet, or the current wallet isn't permitted (active is null):
        // open the approval so the user can connect the active account (which adds
        // it to the permitted set).
        const r = await openApproval("qc_requestAccounts", params, origin, tabId);
        return [r.address];
      }
      case "eth_accounts":
      case "qc_accounts":
        return active ? [active] : [];
      case "qc_chainId":
        return active ? site!.chainId : null;
      case "qc_getNetwork":
        return active ? site!.network : null;
      case "qc_signMessage": {
        if (!active) throw new Error(notConnectedError);
        validateRequest("qc_signMessage", params);
        const r = await openApproval("qc_signMessage", { ...params, address: active }, origin, tabId);
        return r.signature;
      }
      case "qc_sendToken": {
        if (!active) throw new Error(notConnectedError);
        validateRequest("qc_sendToken", params);
        return await openApproval(
          "qc_sendToken",
          { ...params, from: active, network: site!.network, chainId: site!.chainId },
          origin,
          tabId,
        );
      }
      case "qc_sendCoin": {
        if (!active) throw new Error(notConnectedError);
        validateRequest("qc_sendCoin", params);
        return await openApproval(
          "qc_sendCoin",
          { ...params, from: active, network: site!.network, chainId: site!.chainId },
          origin,
          tabId,
        );
      }
      case "qc_sendTransaction": {
        if (!active) throw new Error(notConnectedError);
        validateRequest("qc_sendTransaction", params);
        return await openApproval(
          "qc_sendTransaction",
          { ...params, from: active, network: site!.network, chainId: site!.chainId },
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

    // The docked wallet switched active accounts. For each connected origin: if
    // the new address is in the origin's permitted set, expose it; otherwise mark
    // the origin disconnected (activeAddress = null) while KEEPING its permitted
    // set so switching back reconnects. Only origins whose effective active
    // account actually changed are persisted + notified.
    if (msg.type === "qc-active-account-changed") {
      const address = msg.address;
      if (typeof address === "string" && address) {
        getConnectedSites().then((sites) => {
          const updates: { origin: string; accounts: string[] }[] = [];
          for (const o of Object.keys(sites)) {
            const s = sites[o];
            if (!s) continue;
            const nextActive = s.accounts.includes(address) ? address : null;
            if (nextActive !== s.activeAddress) {
              s.activeAddress = nextActive;
              updates.push({ origin: o, accounts: nextActive ? [nextActive] : [] });
            }
          }
          const emit = () => {
            for (const u of updates) emitToOrigin(u.origin, "accountsChanged", u.accounts);
          };
          if (updates.length) storageSet(CONNECTED_SITES_KEY, sites).then(emit);
          else emit();
        });
      }
      sendResponse({ ok: true });
      return;
    }

    // The docked wallet switched networks. Update every connected origin's stored
    // chainId + network (so the read passthrough targets the new node's RPC) and
    // emit the EIP-1193 chainChanged event with a hex chainId (EIP-695).
    if (msg.type === "qc-active-network-changed") {
      const chainIdNum = Number(msg.chainId);
      const network = msg.network ?? null;
      if (Number.isFinite(chainIdNum)) {
        const chainIdHex = "0x" + chainIdNum.toString(16);
        getConnectedSites().then((sites) => {
          const origins = Object.keys(sites);
          for (const o of origins) {
            const s = sites[o];
            if (!s) continue;
            s.chainId = chainIdNum;
            if (network) s.network = network;
          }
          const emit = () => {
            for (const o of origins) emitToOrigin(o, "chainChanged", chainIdHex);
          };
          if (origins.length) storageSet(CONNECTED_SITES_KEY, sites).then(emit);
          else emit();
        });
      }
      sendResponse({ ok: true });
      return;
    }

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
            getConnectedSites().then((sites) => {
              const existing = sites[p.origin];
              const accounts = existing ? existing.accounts.slice() : [];
              if (!accounts.includes(msg.result.address)) accounts.push(msg.result.address);
              const info: ConnectedSite = {
                accounts,
                activeAddress: msg.result.address,
                chainId: msg.result.chainId ?? null,
                network: msg.result.network ?? null,
              };
              return setConnectedSite(p.origin, info).then(() => {
                emitToTab(p.tabId, "connect", { chainId: info.chainId });
                emitToTab(p.tabId, "accountsChanged", [info.activeAddress]);
              });
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
