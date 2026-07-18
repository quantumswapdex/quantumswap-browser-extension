// Ported from the swap/send ipcMain.handle handlers in the desktop src/index.js.
// Logic (contract addresses, slippage/deadline math, gas estimation) is preserved
// verbatim. The only removals are the Windows named-pipe / unix-socket ("IPC") RPC
// code paths, which cannot exist in a browser: RPC endpoints are HTTP(S) only here.
import { Initialize, Config } from "quantumcoin/config";
import {
  Wallet,
  Interface,
  parseUnits,
  formatUnits,
  getAddress,
  ZeroAddress,
  getProvider,
} from "quantumcoin";
import {
  QuantumSwapV2Router02,
  QuantumSwapV2Factory,
  IERC20,
} from "quantumswap";
import { RECOGNIZED_TOKEN_CONTRACT_ADDRESSES } from "../token-constants.js";
import {
  SWAP_WQ_CONTRACT_ADDRESS,
  SWAP_FACTORY_CONTRACT_ADDRESS,
  SWAP_ROUTER_V2_CONTRACT_ADDRESS,
} from "../release-constants.js";

function signingOverrides(wallet: any, data: any, base: any) {
  const fullSign = data && data.advancedSigningEnabled === true;
  const out: any = { ...base, signingContext: wallet.getSigningContext(fullSign) };
  // item 5: pin the exact gas price the user approved (the fee shown in the UI is
  // derived from it) so the SDK/node cannot re-fetch a different price between the
  // review screen and broadcast. Single choke point covering every submit handler
  // that routes through signingOverrides.
  if (data && data.gasPriceWei != null && String(data.gasPriceWei) !== "") {
    const gp = toBigInt(data.gasPriceWei);
    if (gp != null && gp > 0n) out.gasPrice = gp;
  }
  return out;
}

function sanitizeSwapError(err: any): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/uniswap/gi, "").trim();
}

// ---- Release (deployment) resolution ----
// Swap payloads may carry `releaseWq` / `releaseFactory` / `releaseRouter` to
// target a user-selected release (custom deployment of the three core
// contracts). Each present field must be a valid address (getAddress throws
// otherwise, and the handler's catch surfaces the error rather than silently
// swapping against the wrong deployment); absent fields fall back to the
// built-in release from src/bridge/release-constants.js.
function resolveSwapReleaseAddresses(data: any) {
  function pick(raw: any, fallback: string): string {
    if (raw == null || typeof raw !== "string" || raw.trim() === "") return fallback;
    return getAddress(raw.trim());
  }
  const d = data && typeof data === "object" ? data : {};
  return {
    wq: pick(d.releaseWq, SWAP_WQ_CONTRACT_ADDRESS),
    factory: pick(d.releaseFactory, SWAP_FACTORY_CONTRACT_ADDRESS),
    router: pick(d.releaseRouter, SWAP_ROUTER_V2_CONTRACT_ADDRESS),
  };
}

// ---- Multi-hop swap routing ----
// When no direct pair exists between the two tokens, a route is searched through
// intermediate hop candidates (the release's wrapped Q + the recognized tokens
// from src/bridge/token-constants.js), with at most SWAP_MAX_INTERMEDIATE_HOPS
// tokens between the from- and to-token.
const SWAP_MAX_INTERMEDIATE_HOPS = 3;
function swapHopCandidateAddresses(release: any): string[] {
  return [release.wq, ...RECOGNIZED_TOKEN_CONTRACT_ADDRESSES];
}

const SWAP_NO_ROUTE_ERROR =
  "No swap route exists between these two tokens: no direct pair and no route through intermediate tokens (max 3 hops).";

// Route + symbol caches. Pairs rarely change, so a short TTL avoids re-querying
// the factory on every debounced quote / gas-estimate while a swap is being set up.
const SWAP_ROUTE_CACHE_TTL_MS = 60000;
const swapRouteCache = new Map<string, { path: string[] | null; at: number }>();
const swapPathSymbolCache = new Map<string, string>();

function mapSwapTokenValue(value: any, release: any): string {
  return value === "Q" ? release.wq : value;
}

async function factoryPairExists(factory: any, tokenA: string, tokenB: string): Promise<boolean> {
  const pairAddr = await factory.getPair(tokenA, tokenB);
  const pairAddrStr =
    typeof pairAddr === "string"
      ? pairAddr
      : pairAddr && pairAddr.toString
        ? pairAddr.toString()
        : String(pairAddr);
  const zeroAddr =
    ZeroAddress || "0x0000000000000000000000000000000000000000000000000000000000000000";
  return !!(pairAddrStr && pairAddrStr !== zeroAddr && pairAddrStr !== "0x" + "0".repeat(64));
}

// Find a router path from `fromAddrRaw` to `toAddrRaw`: the direct pair when it
// exists, otherwise the shortest route (BFS) through the hop candidates, limited
// to SWAP_MAX_INTERMEDIATE_HOPS intermediate tokens. Returns an array of
// checksummed addresses ([from, ...hops, to]) or null when no route exists.
async function findSwapPath(provider: any, chainId: number, fromAddrRaw: string, toAddrRaw: string, release: any): Promise<string[] | null> {
  const fromAddr = getAddress(fromAddrRaw);
  const toAddr = getAddress(toAddrRaw);
  // The factory address is part of the key: each release has its own pair set,
  // so a route cached for one release must never be served for another.
  const cacheKey =
    chainId +
    "|" +
    release.factory.toLowerCase() +
    "|" +
    fromAddr.toLowerCase() +
    "|" +
    toAddr.toLowerCase();
  const cached = swapRouteCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SWAP_ROUTE_CACHE_TTL_MS) return cached.path;

  const factory = QuantumSwapV2Factory.connect(release.factory, provider);
  let path: string[] | null = null;
  if (await factoryPairExists(factory, fromAddr, toAddr)) {
    path = [fromAddr, toAddr];
  } else {
    const seen = new Set([fromAddr.toLowerCase(), toAddr.toLowerCase()]);
    const hops: string[] = [];
    for (const h of swapHopCandidateAddresses(release)) {
      const addr = getAddress(h);
      if (seen.has(addr.toLowerCase())) continue;
      seen.add(addr.toLowerCase());
      hops.push(addr);
    }
    const nodes = [fromAddr, ...hops, toAddr];
    const target = nodes.length - 1;
    // Query every remaining pair among the nodes in parallel (the direct
    // from->to pair was already checked above), then BFS the pair graph.
    const adj: number[][] = nodes.map(() => []);
    const checks: Promise<void>[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (i === 0 && j === target) continue;
        checks.push(
          factoryPairExists(factory, nodes[i], nodes[j]).then((exists) => {
            if (exists) {
              adj[i].push(j);
              adj[j].push(i);
            }
          }),
        );
      }
    }
    await Promise.all(checks);

    const maxEdges = SWAP_MAX_INTERMEDIATE_HOPS + 1;
    const prev = new Array(nodes.length).fill(-1);
    const depth = new Array(nodes.length).fill(-1);
    depth[0] = 0;
    const queue = [0];
    while (queue.length) {
      const cur = queue.shift() as number;
      if (cur === target) break;
      if (depth[cur] >= maxEdges) continue;
      for (const nxt of adj[cur]) {
        if (depth[nxt] !== -1) continue;
        depth[nxt] = depth[cur] + 1;
        prev[nxt] = cur;
        queue.push(nxt);
      }
    }
    if (depth[target] !== -1 && depth[target] <= maxEdges) {
      const idxPath: number[] = [];
      for (let cur = target; cur !== -1; cur = prev[cur]) idxPath.unshift(cur);
      path = idxPath.map((i) => nodes[i]);
    }
  }

  if (swapRouteCache.size > 200) {
    swapRouteCache.delete(swapRouteCache.keys().next().value as string);
  }
  swapRouteCache.set(cacheKey, { path, at: Date.now() });
  return path;
}

// Resolve the router path for a swap between two UI token values ("Q" or a
// contract address). Throws when no route exists so callers surface the error.
async function resolveSwapPath(provider: any, chainId: number, fromTokenValue: any, toTokenValue: any, release: any): Promise<string[]> {
  const path = await findSwapPath(
    provider,
    chainId,
    mapSwapTokenValue(fromTokenValue, release),
    mapSwapTokenValue(toTokenValue, release),
    release,
  );
  if (!path) throw new Error(SWAP_NO_ROUTE_ERROR);
  return path;
}

// On-chain symbol() for each path token, for the UI's route display. A failed
// lookup yields null for that entry (the UI falls back to the address). The raw
// symbol strings are untrusted RPC data: the UI must sanitize before rendering.
async function getSwapPathSymbols(provider: any, chainId: number, path: string[]): Promise<(string | null)[]> {
  return Promise.all(
    path.map(async (addr: string) => {
      const key = chainId + "|" + addr.toLowerCase();
      const cached = swapPathSymbolCache.get(key);
      if (cached !== undefined) return cached;
      let symbol: string | null = null;
      try {
        const s = await IERC20.connect(addr, provider).symbol();
        if (typeof s === "string" && s.trim() !== "") symbol = s;
      } catch {
        /* leave null */
      }
      // Cache only successful lookups: a transient RPC failure must not pin the
      // null (address-fallback) display for the rest of the session.
      if (symbol != null) swapPathSymbolCache.set(key, symbol);
      return symbol;
    }),
  );
}

// Browsers can only reach RPC over HTTP(S); the desktop's local IPC/pipe support
// (isIpcLikeRpc/toNodeIpcPath/expandTildeInIpcPath) is intentionally dropped.
function buildSwapRpcUrl(rpcEndpoint: any): string | null {
  if (!rpcEndpoint || typeof rpcEndpoint !== "string") return null;
  const s = rpcEndpoint.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  const isIpAddress = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(s);
  const isLocalhost = /^localhost(:\d+)?$/i.test(s);
  return (isIpAddress || isLocalhost ? "http://" : "https://") + s;
}

function initRpcUrlForConfig(rpcEndpoint: any): string | undefined {
  if (rpcEndpoint == null || typeof rpcEndpoint !== "string" || !rpcEndpoint.trim()) {
    return undefined;
  }
  return buildSwapRpcUrl(rpcEndpoint) ?? undefined;
}

function createQuantumRpcProvider(rpcEndpoint: any, chainId: number): any {
  if (rpcEndpoint == null || typeof rpcEndpoint !== "string" || !rpcEndpoint.trim())
    return null;
  const endpoint = buildSwapRpcUrl(rpcEndpoint);
  if (!endpoint) return null;
  const provider = getProvider(endpoint, chainId);
  if (provider && Number.isInteger(chainId)) {
    (provider as any).chainId = chainId;
  }
  return provider;
}

function formatLocalRpcConnectionError(_rpcEndpoint: any, err: any): string {
  let msg = err && err.message ? String(err.message) : String(err);
  if (err && err.error && err.error.message && !msg.includes(String(err.error.message))) {
    msg = msg + " " + String(err.error.message);
  }
  return msg;
}

// Strip locale formatting (e.g. commas) so parseUnits gets a valid numeric string
function normalizeAmountString(value: any): string {
  if (value == null) return "0";
  return String(value).replace(/,/g, "").trim() || "0";
}

// ---- generic transaction (WYSIWYS decode/verify) helpers ----
// Normalize an arbitrary hex-data field to a lowercase, 0x-prefixed string.
// Empty / null / "0x" all collapse to "0x" (no calldata).
function normalizeTxDataHex(value: any): string {
  if (value == null) return "0x";
  let s = String(value).trim();
  if (s === "" || s === "0x" || s === "0X") return "0x";
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  return "0x" + s.toLowerCase();
}

function hexDataEquals(a: any, b: any): boolean {
  return normalizeTxDataHex(a) === normalizeTxDataHex(b);
}

// Accept the Ethereum wire form (hex-wei, e.g. "0x16345785d8a0000") and, for
// leniency, a plain decimal-wei string. Returns a BigInt (0n when absent).
// item 22: fail CLOSED — throw on an unparseable value instead of silently
// coercing it to 0n (which would drop/alter the amount being signed). Every
// caller runs inside a try/catch that maps the throw to a { success:false }
// / WYSIWYS verify error, so a malformed value is rejected rather than signed.
function parseHexOrDecimalWei(value: any): bigint {
  if (value == null || value === "") return 0n;
  if (typeof value === "bigint") return value;
  const s = String(value).trim();
  if (s === "") return 0n;
  try {
    return BigInt(s);
  } catch {
    throw new Error("Invalid transaction value: expected a hex-wei or decimal-wei amount.");
  }
}

// Render a decoded ABI value as a human-readable string for the approval UI.
// BigInts, byte arrays, nested arrays and tuples are all handled recursively.
function displayAbiValue(v: any): string {
  if (v == null) return String(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v instanceof Uint8Array) {
    let hex = "0x";
    for (let i = 0; i < v.length; i++) hex += v[i].toString(16).padStart(2, "0");
    return hex;
  }
  if (Array.isArray(v)) return "[" + v.map(displayAbiValue).join(", ") + "]";
  if (typeof v === "object") {
    const named = Object.keys(v).filter((k) => !/^\d+$/.test(k));
    if (named.length) {
      return "(" + named.map((k) => k + ": " + displayAbiValue(v[k])).join(", ") + ")";
    }
    return "(" + Array.from(v).map(displayAbiValue).join(", ") + ")";
  }
  return String(v);
}

// Build the [{ name, type, value }] list the UI renders from an ABI fragment's
// inputs and a decoded (array-like) argument set.
function describeAbiArgs(inputs: any, values: any): { name: string; type: string; value: string }[] {
  const arr = Array.from(values || []);
  const list: { name: string; type: string; value: string }[] = [];
  const inps = Array.isArray(inputs) ? inputs : [];
  for (let i = 0; i < inps.length; i++) {
    const inp = inps[i] || {};
    list.push({
      name: inp.name || "arg" + i,
      type: inp.type || "",
      value: displayAbiValue(arr[i]),
    });
  }
  return list;
}

const WYSIWYS_MISMATCH_ERROR =
  "The transaction could not be safely verified: the human-readable details do not match the raw data that would be signed. Rejecting to protect you from a tampered transaction.";

/** Router compares deadline to block.timestamp; use chain time so local nodes do not hit EXPIRED. */
async function getSwapTxDeadline(provider: any, futureSeconds: any): Promise<bigint> {
  const sec = BigInt(
    Math.max(60, Math.min(86400, Number(futureSeconds) > 0 ? Number(futureSeconds) : 1200)),
  );
  try {
    if (provider && typeof provider.getBlock === "function") {
      const block = await provider.getBlock("latest");
      if (block != null && block.timestamp != null) {
        const ts =
          typeof block.timestamp === "bigint" ? block.timestamp : BigInt(block.timestamp);
        return ts + sec;
      }
    }
  } catch {
    /* fall through */
  }
  return BigInt(Math.floor(Date.now() / 1000)) + sec;
}

function formatSwapRouterRevertError(err: any): string {
  const msg = err && err.message ? String(err.message) : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("expired") && (lower.includes("uniswap") || lower.includes("router"))) {
    return (
      msg +
      "\n\nTip: EXPIRED = swap deadline before chain time. Try again; sync PC clock or check node if it repeats."
    );
  }
  return msg;
}

// ---- Common gas estimation plumbing ----
const GAS_ESTIMATE_BUFFER_PERCENT = 10;
const WEI_PER_ETH = 1000000000000000000n;
const GAS_FEE_FALLBACK_RATE_NUM = 1000 / 21000; // current default rate, used only when network lookup fails
const DEFAULT_WALLET_KEY_TYPE = 3; // keyType 3 (HYBRIDEDMLDSASLHDSA); 5 = HYBRIDEDMLDSASLHDSA5

function toBigInt(value: any): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const s = String(value);
  if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

async function resolveGasPriceWei(provider: any, keyType: any, fullSign: any): Promise<{ gasPriceWei: bigint | null; usedFallback: boolean }> {
  if (provider && typeof provider.getFeeData === "function") {
    const kt = Number.isInteger(keyType) ? keyType : DEFAULT_WALLET_KEY_TYPE;
    try {
      const fd = await provider.getFeeData(kt, fullSign === true);
      if (fd && fd.gasPrice != null) {
        const gp = toBigInt(fd.gasPrice);
        if (gp != null) return { gasPriceWei: gp, usedFallback: false };
      }
    } catch {
      /* fall through to fallback */
    }
  }
  return { gasPriceWei: null, usedFallback: true };
}

function weiToEthString(weiBigInt: bigint | null): string {
  if (weiBigInt == null) return "0";
  const scaled = (weiBigInt * 1000000n) / WEI_PER_ETH; // coins * 1e6
  const num = Number(scaled) / 1000000;
  return String(num);
}

function applyGasBuffer(gasLimitBi: any, percent: any): bigint | null {
  const base = toBigInt(gasLimitBi);
  if (base == null) return null;
  const pct = percent == null ? GAS_ESTIMATE_BUFFER_PERCENT : percent;
  return (base * (100n + BigInt(pct))) / 100n;
}

// Build the unsigned tx request (with `from`) for a given transaction kind, for estimateGas.
async function buildEstimateGasTx(data: any, provider: any): Promise<any> {
  const chainId = Number(data.chainId);
  await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
  const fromAddress = data.fromAddress || data.recipientAddress || null;
  const txKind = data.txKind;

  if (txKind === "sendCoin") {
    const valueWei = parseUnits(normalizeAmountString(data.amount), 18);
    return { to: getAddress(data.toAddress), value: valueWei, from: getAddress(fromAddress) };
  }

  if (txKind === "sendToken") {
    const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
    const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
    const token = IERC20.connect(getAddress(data.contractAddress), provider);
    const tx = await token.populateTransaction.transfer(getAddress(data.toAddress), amountWei);
    return { ...tx, from: getAddress(fromAddress) };
  }

  // Generic dApp-requested transaction (mirrors eth_sendTransaction: hex-wei
  // value, hex data, optional `to` for a plain transfer / contract call, absent
  // `to` for contract creation). The exact `data`/`value`/`to` are estimated
  // as-is; no re-derivation here (that is the WYSIWYS verifier's job).
  if (txKind === "sendTransaction") {
    const tx: any = { from: getAddress(fromAddress) };
    const toAddr = data.toAddress || data.to;
    if (toAddr != null && String(toAddr).trim() !== "") tx.to = getAddress(toAddr);
    const dataHex = normalizeTxDataHex(data.data);
    if (dataHex !== "0x") tx.data = dataHex;
    const valueWei = parseHexOrDecimalWei(data.value);
    if (valueWei !== 0n) tx.value = valueWei;
    return tx;
  }

  if (txKind === "approve") {
    const release = resolveSwapReleaseAddresses(data);
    const tokenAddr = mapSwapTokenValue(data.fromTokenValue, release);
    const spenderAddr = release.router;
    const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
    const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
    const token = IERC20.connect(getAddress(tokenAddr), provider);
    const tx = await token.populateTransaction.approve(getAddress(spenderAddr), amountWei);
    return { ...tx, from: getAddress(fromAddress) };
  }

  if (txKind === "swap") {
    const release = resolveSwapReleaseAddresses(data);
    const router = QuantumSwapV2Router02.connect(release.router, provider);
    const path = await resolveSwapPath(
      provider,
      chainId,
      data.fromTokenValue,
      data.toTokenValue,
      release,
    );
    const fromDecimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
    const toDecimals = typeof data.toDecimals === "number" ? data.toDecimals : 18;
    const toAddress = data.recipientAddress || data.toAddress;
    const deadline = await getSwapTxDeadline(provider, 1200);
    const lastChanged = data.lastChanged === "to" ? "to" : "from";
    const slippagePercent = Math.max(0, Math.min(100, Number(data.slippagePercent) || 1));
    let amountInWei, amountOutMinWei;
    if (lastChanged === "to") {
      const amountOutWei = parseUnits(String(data.amountOut), toDecimals);
      const amountsIn = await router.getAmountsIn(amountOutWei, path);
      amountInWei = Array.isArray(amountsIn) ? amountsIn[0] : amountsIn;
      amountOutMinWei = (amountOutWei * BigInt(100 - slippagePercent)) / 100n;
    } else {
      amountInWei = parseUnits(String(data.amountIn), fromDecimals);
      const amountsOut = await router.getAmountsOut(amountInWei, path);
      const expectedAmountOutWei = Array.isArray(amountsOut)
        ? amountsOut[amountsOut.length - 1]
        : amountsOut;
      amountOutMinWei = (expectedAmountOutWei * BigInt(100 - slippagePercent)) / 100n;
    }
    const tx = await router.populateTransaction.swapExactTokensForTokens(
      amountInWei,
      amountOutMinWei,
      path,
      getAddress(toAddress),
      deadline,
    );
    // item 21: estimate as the wallet/owner (the actual sender), not the swap
    // recipient. `toAddress` is only the funds recipient and may differ from the
    // signer; using it as `from` estimates against the wrong account's state.
    return { ...tx, from: getAddress(fromAddress || toAddress) };
  }

  throw new Error("Unsupported txKind for estimateGas: " + txKind);
}

export default {
  async SwapQuoteGetAmountsOut(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const release = resolveSwapReleaseAddresses(data);
      const router = QuantumSwapV2Router02.connect(release.router, provider);

      const path = await resolveSwapPath(
        provider,
        chainId,
        data.fromTokenValue,
        data.toTokenValue,
        release,
      );

      const fromDecimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const toDecimals = typeof data.toDecimals === "number" ? data.toDecimals : 18;
      const amountInWei = parseUnits(String(data.amountIn), fromDecimals);

      const amounts = await router.getAmountsOut(amountInWei, path);
      const amountOutWei = Array.isArray(amounts) ? amounts[amounts.length - 1] : amounts;
      const amountOut = formatUnits(amountOutWei, toDecimals);

      return { success: true, amountOut };
    } catch (err) {
      return { success: false, error: sanitizeSwapError(err) };
    }
  },

  // Route check: `exists` is true when a direct pair OR a multi-hop route (max
  // SWAP_MAX_INTERMEDIATE_HOPS intermediates) exists. `path` is the address route
  // and `pathSymbols` the on-chain symbol for each path token (null entries when
  // the lookup failed). Symbols are untrusted; the UI sanitizes before display.
  async SwapQuoteCheckPairExists(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { exists: false, path: null, pathSymbols: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider)
        return { exists: false, path: null, pathSymbols: null, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const release = resolveSwapReleaseAddresses(data);
      const path = await findSwapPath(
        provider,
        chainId,
        mapSwapTokenValue(data.fromTokenValue, release),
        mapSwapTokenValue(data.toTokenValue, release),
        release,
      );
      if (!path) return { exists: false, path: null, pathSymbols: null, error: null };

      const pathSymbols = await getSwapPathSymbols(provider, chainId, path);
      return { exists: true, path, pathSymbols, error: null };
    } catch (err) {
      return { exists: false, path: null, pathSymbols: null, error: sanitizeSwapError(err) };
    }
  },

  async SwapQuoteGetAmountsIn(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const release = resolveSwapReleaseAddresses(data);
      const router = QuantumSwapV2Router02.connect(release.router, provider);

      const path = await resolveSwapPath(
        provider,
        chainId,
        data.fromTokenValue,
        data.toTokenValue,
        release,
      );

      const fromDecimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const toDecimals = typeof data.toDecimals === "number" ? data.toDecimals : 18;
      const amountOutWei = parseUnits(String(data.amountOut), toDecimals);

      const amounts = await router.getAmountsIn(amountOutWei, path);
      const amountInWei = Array.isArray(amounts) ? amounts[0] : amounts;
      const amountIn = formatUnits(amountInWei, fromDecimals);

      return { success: true, amountIn };
    } catch (err) {
      return { success: false, error: sanitizeSwapError(err) };
    }
  },

  async SwapQuoteEstimateGas(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { success: false, gasLimit: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, gasLimit: null, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const release = resolveSwapReleaseAddresses(data);
      const router = QuantumSwapV2Router02.connect(release.router, provider);

      const path = await resolveSwapPath(
        provider,
        chainId,
        data.fromTokenValue,
        data.toTokenValue,
        release,
      );
      const fromDecimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const toDecimals = typeof data.toDecimals === "number" ? data.toDecimals : 18;
      const toAddress = data.recipientAddress || data.toAddress;
      if (!toAddress) return { success: false, gasLimit: null, error: "Recipient address required" };
      // item 21: the sender/owner for estimation is the wallet, not the recipient.
      const ownerAddress = data.ownerAddress || data.fromAddress || toAddress;
      const deadline = await getSwapTxDeadline(provider, 1200);
      const lastChanged = data.lastChanged === "to" ? "to" : "from";
      const slippagePercent = Math.max(0, Math.min(100, Number(data.slippagePercent) || 1));

      let amountInWei;
      let amountOutMinWei;
      if (lastChanged === "to") {
        const amountOutWei = parseUnits(String(data.amountOut), toDecimals);
        const amountsIn = await router.getAmountsIn(amountOutWei, path);
        amountInWei = Array.isArray(amountsIn) ? amountsIn[0] : amountsIn;
        amountOutMinWei = (amountOutWei * BigInt(100 - slippagePercent)) / 100n;
      } else {
        amountInWei = parseUnits(String(data.amountIn), fromDecimals);
        const amountsOut = await router.getAmountsOut(amountInWei, path);
        const expectedAmountOutWei = Array.isArray(amountsOut)
          ? amountsOut[amountsOut.length - 1]
          : amountsOut;
        amountOutMinWei = (expectedAmountOutWei * BigInt(100 - slippagePercent)) / 100n;
      }
      const tx = await router.populateTransaction.swapExactTokensForTokens(
        amountInWei,
        amountOutMinWei,
        path,
        getAddress(toAddress),
        deadline,
      );
      const txWithFrom = { ...tx, from: getAddress(ownerAddress) };
      const gasLimit = await provider.estimateGas(txWithFrom);
      const gasLimitStr = typeof gasLimit === "bigint" ? gasLimit.toString() : String(gasLimit);
      return { success: true, gasLimit: gasLimitStr, error: null };
    } catch (err) {
      return { success: false, gasLimit: null, error: formatSwapRouterRevertError(err) };
    }
  },

  async SwapQuoteCheckAllowance(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { success: false, sufficient: false, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, sufficient: false, error: "Invalid RPC endpoint" };
      if (!data.ownerAddress)
        return { success: false, sufficient: false, error: "Owner address required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const release = resolveSwapReleaseAddresses(data);
      const tokenAddr = mapSwapTokenValue(data.fromTokenValue, release);
      const spenderAddr = release.router;
      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const requiredWei = parseUnits(normalizeAmountString(data.requiredAmount), decimals);
      const token = IERC20.connect(getAddress(tokenAddr), provider);
      let allowanceWei;
      if (typeof token.allowance !== "function") {
        allowanceWei = 0n;
      } else {
        try {
          allowanceWei = await token.allowance(
            getAddress(data.ownerAddress),
            getAddress(spenderAddr),
          );
        } catch {
          allowanceWei = 0n;
        }
      }
      const allowanceStr =
        typeof allowanceWei === "bigint" ? allowanceWei.toString() : String(allowanceWei);
      const sufficient =
        (typeof allowanceWei === "bigint" ? allowanceWei : BigInt(allowanceStr)) >= requiredWei;
      return { success: true, sufficient, allowance: allowanceStr, error: null };
    } catch (err) {
      return { success: false, sufficient: false, error: sanitizeSwapError(err) };
    }
  },

  async SwapQuoteEstimateApproveGas(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { success: false, gasLimit: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, gasLimit: null, error: "Invalid RPC endpoint" };
      if (!data.fromAddress) return { success: false, gasLimit: null, error: "From address required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const release = resolveSwapReleaseAddresses(data);
      const tokenAddr = mapSwapTokenValue(data.fromTokenValue, release);
      const spenderAddr = release.router;
      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);

      const token = IERC20.connect(getAddress(tokenAddr), provider);
      const tx = await token.populateTransaction.approve(getAddress(spenderAddr), amountWei);
      const txWithFrom = { ...tx, from: getAddress(data.fromAddress) };
      const gasLimit = await provider.estimateGas(txWithFrom);
      const gasLimitStr = typeof gasLimit === "bigint" ? gasLimit.toString() : String(gasLimit);
      return { success: true, gasLimit: gasLimitStr, error: null };
    } catch (err) {
      return { success: false, gasLimit: null, error: sanitizeSwapError(err) };
    }
  },

  async estimateGas(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { success: false, gasLimit: null, error: "Invalid chain ID" };
      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, gasLimit: null, error: "Invalid RPC endpoint" };

      const tx = await buildEstimateGasTx(data, provider);
      const estimated = await provider.estimateGas(tx);
      const bp = Number.isInteger(data.bufferPercent) ? data.bufferPercent : GAS_ESTIMATE_BUFFER_PERCENT;
      const buffered = bp > 0 ? applyGasBuffer(estimated, bp) : estimated;
      if (buffered == null) return { success: false, gasLimit: null, error: "estimateGas returned no value" };
      return { success: true, gasLimit: buffered.toString(), error: null };
    } catch (err) {
      return { success: false, gasLimit: null, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async estimateGasFee(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return {
          success: false,
          gasFeeEth: null,
          gasPriceWei: null,
          usedFallback: true,
          error: "Invalid chain ID",
        };
      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider)
        return {
          success: false,
          gasFeeEth: null,
          gasPriceWei: null,
          usedFallback: true,
          error: "Invalid RPC endpoint",
        };

      const gasLimitBi = toBigInt(data.gasLimit);
      const resolved = await resolveGasPriceWei(provider, data.keyType, data.fullSign === true);
      if (resolved.usedFallback || resolved.gasPriceWei == null) {
        const fallbackFee = gasLimitBi != null ? Number(gasLimitBi) * GAS_FEE_FALLBACK_RATE_NUM : 0;
        return {
          success: true,
          gasFeeEth: String(fallbackFee),
          gasPriceWei: null,
          usedFallback: true,
          error: null,
        };
      }
      const totalWei = (gasLimitBi != null ? gasLimitBi : 0n) * resolved.gasPriceWei;
      return {
        success: true,
        gasFeeEth: weiToEthString(totalWei),
        gasPriceWei: resolved.gasPriceWei.toString(),
        usedFallback: false,
        error: null,
      };
    } catch (err) {
      const gasLimitBi = toBigInt(data.gasLimit);
      const fallbackFee = gasLimitBi != null ? Number(gasLimitBi) * GAS_FEE_FALLBACK_RATE_NUM : 0;
      return {
        success: false,
        gasFeeEth: String(fallbackFee),
        gasPriceWei: null,
        usedFallback: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async SwapQuoteGetRouterAddress(data: any) {
    try {
      const release = resolveSwapReleaseAddresses(data);
      return { success: true, routerAddress: release.router, error: null };
    } catch (err) {
      return { success: false, routerAddress: null, error: sanitizeSwapError(err) };
    }
  },

  async SwapQuoteGetSwapContractData(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { success: false, dataHex: null, toAddress: null, valueHex: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider)
        return { success: false, dataHex: null, toAddress: null, valueHex: null, error: "Invalid RPC endpoint" };
      const toAddress = data.recipientAddress || data.toAddress;
      if (!toAddress)
        return { success: false, dataHex: null, toAddress: null, valueHex: null, error: "Recipient address required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const release = resolveSwapReleaseAddresses(data);
      const router = QuantumSwapV2Router02.connect(release.router, provider);

      const path = await resolveSwapPath(
        provider,
        chainId,
        data.fromTokenValue,
        data.toTokenValue,
        release,
      );
      const fromDecimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const toDecimals = typeof data.toDecimals === "number" ? data.toDecimals : 18;
      const deadline = await getSwapTxDeadline(provider, 1200);
      const lastChanged = data.lastChanged === "to" ? "to" : "from";
      const slippagePercent = Math.max(0, Math.min(100, Number(data.slippagePercent) || 1));

      let amountInWei;
      let amountOutMinWei;
      if (lastChanged === "to") {
        const amountOutWei = parseUnits(String(data.amountOut), toDecimals);
        const amountsIn = await router.getAmountsIn(amountOutWei, path);
        amountInWei = Array.isArray(amountsIn) ? amountsIn[0] : amountsIn;
        amountOutMinWei = (amountOutWei * BigInt(100 - slippagePercent)) / 100n;
      } else {
        amountInWei = parseUnits(String(data.amountIn), fromDecimals);
        const amountsOut = await router.getAmountsOut(amountInWei, path);
        const expectedAmountOutWei = Array.isArray(amountsOut)
          ? amountsOut[amountsOut.length - 1]
          : amountsOut;
        amountOutMinWei = (expectedAmountOutWei * BigInt(100 - slippagePercent)) / 100n;
      }
      const tx = await router.populateTransaction.swapExactTokensForTokens(
        amountInWei,
        amountOutMinWei,
        path,
        getAddress(toAddress),
        deadline,
      );
      const dataHex = tx && tx.data ? (typeof tx.data === "string" ? tx.data : String(tx.data)) : null;
      if (!dataHex)
        return { success: false, dataHex: null, toAddress: null, valueHex: null, error: "No contract data" };
      const valueHex = tx.value != null && tx.value !== 0n ? "0x" + tx.value.toString(16) : "0x0";
      return { success: true, dataHex, toAddress: release.router, valueHex, error: null };
    } catch (err) {
      return { success: false, dataHex: null, toAddress: null, valueHex: null, error: formatSwapRouterRevertError(err) };
    }
  },

  async SwapSubmitApproval(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txHash: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, txHash: null, error: "Invalid RPC endpoint" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txHash: null, error: "Wallet keys required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes, provider);

      const release = resolveSwapReleaseAddresses(data);
      const tokenAddr = mapSwapTokenValue(data.fromTokenValue, release);
      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
      const gasLimit = Number(data.gasLimit) || 84000;

      const token = IERC20.connect(getAddress(tokenAddr), wallet);
      const tx = await token.approve(
        getAddress(release.router),
        amountWei,
        signingOverrides(wallet, data, { gasLimit }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: sanitizeSwapError(err) };
    }
  },

  async SwapSubmitSwap(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txHash: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, txHash: null, error: "Invalid RPC endpoint" };
      const recipientAddress = data.recipientAddress;
      if (!recipientAddress) return { success: false, txHash: null, error: "Recipient address required" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txHash: null, error: "Wallet keys required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes, provider);

      const release = resolveSwapReleaseAddresses(data);
      const router = QuantumSwapV2Router02.connect(release.router, wallet);
      const path = await resolveSwapPath(
        provider,
        chainId,
        data.fromTokenValue,
        data.toTokenValue,
        release,
      );
      const fromDecimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const toDecimals = typeof data.toDecimals === "number" ? data.toDecimals : 18;
      const deadline = await getSwapTxDeadline(provider, 1200);
      const lastChanged = data.lastChanged === "to" ? "to" : "from";
      const slippagePercent = Math.max(0, Math.min(100, Number(data.slippagePercent) || 1));
      const gasLimit = Number(data.gasLimit) || 200000;

      let amountInWei;
      let amountOutMinWei;
      if (lastChanged === "to") {
        const amountOutWei = parseUnits(String(data.amountOut), toDecimals);
        const amountsIn = await router.getAmountsIn(amountOutWei, path);
        amountInWei = Array.isArray(amountsIn) ? amountsIn[0] : amountsIn;
        amountOutMinWei = (amountOutWei * BigInt(100 - slippagePercent)) / 100n;
      } else {
        amountInWei = parseUnits(String(data.amountIn), fromDecimals);
        const amountsOut = await router.getAmountsOut(amountInWei, path);
        const expectedAmountOutWei = Array.isArray(amountsOut)
          ? amountsOut[amountsOut.length - 1]
          : amountsOut;
        amountOutMinWei = (expectedAmountOutWei * BigInt(100 - slippagePercent)) / 100n;
      }

      const tx = await router.swapExactTokensForTokens(
        amountInWei,
        amountOutMinWei,
        path,
        getAddress(recipientAddress),
        deadline,
        signingOverrides(wallet, data, { gasLimit }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: formatSwapRouterRevertError(err) };
    }
  },

  async SwapSubmitRemoveAllowance(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txHash: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, txHash: null, error: "Invalid RPC endpoint" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txHash: null, error: "Wallet keys required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes, provider);

      const release = resolveSwapReleaseAddresses(data);
      const tokenAddr = mapSwapTokenValue(data.fromTokenValue, release);
      const gasLimit = Number(data.gasLimit) || 84000;

      const token = IERC20.connect(getAddress(tokenAddr), wallet);
      const tx = await token.approve(
        getAddress(release.router),
        0n,
        signingOverrides(wallet, data, { gasLimit }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: sanitizeSwapError(err) };
    }
  },

  async SwapSubmitAddAllowance(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txHash: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, txHash: null, error: "Invalid RPC endpoint" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txHash: null, error: "Wallet keys required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes, provider);

      const release = resolveSwapReleaseAddresses(data);
      const tokenAddr = mapSwapTokenValue(data.fromTokenValue, release);
      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
      const gasLimit = Number(data.gasLimit) || 84000;

      const token = IERC20.connect(getAddress(tokenAddr), wallet);
      const tx = await token.approve(
        getAddress(release.router),
        amountWei,
        signingOverrides(wallet, data, { gasLimit }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: sanitizeSwapError(err) };
    }
  },

  async SendCoinsSubmit(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txHash: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, txHash: null, error: "Invalid RPC endpoint" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txHash: null, error: "Wallet keys required" };
      if (!data.toAddress) return { success: false, txHash: null, error: "Recipient address required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes, provider);

      const valueWei = parseUnits(normalizeAmountString(data.amount), 18);
      const gasLimit = Number(data.gasLimit) || 21000;

      const tx = await wallet.sendTransaction(
        signingOverrides(wallet, data, {
          to: getAddress(data.toAddress),
          value: valueWei,
          gasLimit: gasLimit,
        }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: formatLocalRpcConnectionError(data.rpcEndpoint, err) };
    }
  },

  async SendTokensSubmit(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txHash: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, txHash: null, error: "Invalid RPC endpoint" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txHash: null, error: "Wallet keys required" };
      if (!data.toAddress) return { success: false, txHash: null, error: "Recipient address required" };
      if (!data.contractAddress)
        return { success: false, txHash: null, error: "Token contract address required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes, provider);

      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
      const gasLimit = Number(data.gasLimit) || 84000;

      const token = IERC20.connect(getAddress(data.contractAddress), wallet);
      const tx = await token.transfer(
        getAddress(data.toAddress),
        amountWei,
        signingOverrides(wallet, data, { gasLimit }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: formatLocalRpcConnectionError(data.rpcEndpoint, err) };
    }
  },

  // Strict "what you see is what you sign" decode + re-encode verification for a
  // generic dApp transaction. Uses ONLY the raw `data`/`value`/`to` that will be
  // signed plus the dApp-supplied ABI (+ bytecode for a deployment): it decodes
  // the calldata, then re-encodes the decoded args and requires the result to
  // byte-match the original `data`. Any decode error or mismatch returns
  // { success:false, error } so the UI can reject with an OK-only dialog.
  //
  // IMPORTANT (SEC-12/13/17): the re-encode check only proves the shown ARG VALUES
  // reproduce the exact signed calldata. It does NOT authenticate the human-readable
  // method name, the parameter labels, or the 4-byte selector — those come from the
  // dApp-supplied ABI and are unverified hints. A tampered ABI can still mislabel a
  // function or its parameters (e.g. call the selector "safeTransfer" while it is
  // something else), so the approval UI warns that these labels are site-provided and
  // that only the raw calldata is authoritative.
  async DecodeTransaction(data: any) {
    try {
      const chainId = Number(data.chainId);
      await Initialize(new Config(Number.isInteger(chainId) ? chainId : 0, initRpcUrlForConfig(data.rpcEndpoint)));

      const rawData = normalizeTxDataHex(data.data);
      const valueWei = parseHexOrDecimalWei(data.value);
      const valueWeiHex = "0x" + valueWei.toString(16);
      const valueDecimal = formatUnits(valueWei, 18);
      const toRaw = data.to == null ? "" : String(data.to).trim();
      const isDeploy = toRaw === "";
      const to = isDeploy ? null : toRaw;

      // Plain value transfer: a recipient with no calldata needs no ABI.
      if (!isDeploy && rawData === "0x") {
        return {
          success: true,
          kind: "transfer",
          to,
          method: null,
          signature: null,
          selector: null,
          args: [],
          valueWeiHex,
          valueDecimal,
          error: null,
        };
      }

      // Anything carrying calldata (a contract call, or a deployment) MUST be
      // decodable against a provided ABI; otherwise we cannot honor WYSIWYS.
      let abi = data.abi;
      if (typeof abi === "string") {
        try {
          abi = JSON.parse(abi);
        } catch {
          abi = null;
        }
      }
      if (!Array.isArray(abi) || abi.length === 0) {
        return {
          success: false,
          error:
            "This request includes contract data but no ABI was provided, so it cannot be verified before signing. Rejecting to avoid approving an unverifiable transaction.",
        };
      }
      const iface = new Interface(abi);

      if (!isDeploy) {
        const parsed = iface.parseTransaction({ data: rawData, value: valueWei });
        const reencoded = iface.encodeFunctionData(parsed.fragment, Array.from(parsed.args));
        if (!hexDataEquals(reencoded, rawData)) {
          return { success: false, error: WYSIWYS_MISMATCH_ERROR };
        }
        return {
          success: true,
          kind: "call",
          to,
          method: parsed.name,
          signature: parsed.signature,
          selector: parsed.selector,
          args: describeAbiArgs(parsed.fragment.inputs, parsed.args),
          valueWeiHex,
          valueDecimal,
          error: null,
        };
      }

      // Contract creation: data must be exactly bytecode ++ abi.encode(ctorArgs).
      const bytecode = normalizeTxDataHex(data.bytecode);
      if (bytecode === "0x") {
        return {
          success: false,
          error:
            "Contract creation requires the contract bytecode to verify the transaction. Rejecting to avoid approving an unverifiable deployment.",
        };
      }
      if (!rawData.startsWith(bytecode)) {
        return { success: false, error: WYSIWYS_MISMATCH_ERROR };
      }
      const ctor = typeof iface.getConstructor === "function" ? iface.getConstructor() : null;
      const ctorInputs = ctor && Array.isArray(ctor.inputs) ? ctor.inputs : [];
      const argsHex = "0x" + rawData.slice(bytecode.length);
      let ctorArgs: any[] = [];
      if (ctorInputs.length) {
        // Decode the constructor tail by treating the constructor inputs as a
        // synthetic function's inputs (reuses the hardened calldata decoder).
        const fn = new Interface([{ type: "function", name: "__ctor", inputs: ctorInputs, outputs: [] }]);
        const sel = fn.getSighash("__ctor");
        ctorArgs = fn.decodeFunctionData("__ctor", sel + argsHex.slice(2));
      } else if (argsHex !== "0x") {
        // Trailing bytes with no constructor to account for them => cannot verify.
        return { success: false, error: WYSIWYS_MISMATCH_ERROR };
      }
      const rebuilt = normalizeTxDataHex(bytecode + iface.encodeDeploy(Array.from(ctorArgs)).slice(2));
      if (!hexDataEquals(rebuilt, rawData)) {
        return { success: false, error: WYSIWYS_MISMATCH_ERROR };
      }
      return {
        success: true,
        kind: "deploy",
        to: null,
        method: "constructor",
        signature: "constructor(" + ctorInputs.map((x: any) => x.type).join(",") + ")",
        selector: null,
        args: describeAbiArgs(ctorInputs, ctorArgs),
        valueWeiHex,
        valueDecimal,
        error: null,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  // Sign + broadcast a generic dApp transaction verbatim (the exact `to`/`data`/
  // `value` that were shown and WYSIWYS-verified). Absent `to` => contract
  // creation. Never re-derives calldata.
  async SendTransactionSubmit(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txHash: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, txHash: null, error: "Invalid RPC endpoint" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txHash: null, error: "Wallet keys required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes, provider);

      const dataHex = normalizeTxDataHex(data.data);
      const valueWei = parseHexOrDecimalWei(data.value);
      const gasLimit = Number(data.gasLimit) || 21000;

      const txReq: any = { gasLimit };
      const toRaw = data.to == null ? "" : String(data.to).trim();
      if (toRaw !== "") txReq.to = getAddress(toRaw);
      if (dataHex !== "0x") txReq.data = dataHex;
      if (valueWei !== 0n) txReq.value = valueWei;

      const tx = await wallet.sendTransaction(signingOverrides(wallet, data, txReq));
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: formatLocalRpcConnectionError(data.rpcEndpoint, err) };
    }
  },

  async SwapQuoteGetApproveContractData(data: any) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, dataHex: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, dataHex: null, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const release = resolveSwapReleaseAddresses(data);
      const tokenAddr = mapSwapTokenValue(data.fromTokenValue, release);
      const spenderAddr = release.router;
      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);

      const token = IERC20.connect(getAddress(tokenAddr), provider);
      const tx = await token.populateTransaction.approve(getAddress(spenderAddr), amountWei);
      const dataHex = tx && tx.data ? (typeof tx.data === "string" ? tx.data : String(tx.data)) : null;
      if (!dataHex) return { success: false, dataHex: null, tokenAddress: null, error: "No contract data" };
      return { success: true, dataHex, tokenAddress: tokenAddr, error: null };
    } catch (err) {
      return { success: false, dataHex: null, tokenAddress: null, error: sanitizeSwapError(err) };
    }
  },
};
