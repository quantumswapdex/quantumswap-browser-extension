// Ported from the swap/send/staking/offline-signing ipcMain.handle handlers in the
// desktop src/index.js. Logic (contract addresses, slippage/deadline math, gas
// estimation, staking ABI) is preserved verbatim. The only removals are the
// Windows named-pipe / unix-socket ("IPC") RPC code paths, which cannot exist in a
// browser: RPC endpoints are HTTP(S) only here.
import { Initialize, Config } from "quantumcoin/config";
import {
  Wallet,
  Contract,
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

function signingOverrides(wallet, data, base) {
  const fullSign = data && data.advancedSigningEnabled === true;
  return { ...base, signingContext: wallet.getSigningContext(fullSign) };
}

function sanitizeSwapError(err) {
  const msg = err && err.message ? err.message : String(err);
  return msg.replace(/uniswap/gi, "").trim();
}

const SWAP_WQ_CONTRACT_ADDRESS =
  "0x0E49c26cd1ca19bF8ddA2C8985B96783288458754757F4C9E00a5439A7291628";
const SWAP_FACTORY_CONTRACT_ADDRESS =
  "0xbbF45a1B60044669793B444eD01Eb33e03Bb8cf3c5b6ae7887B218D05C5Cbf1d";
const SWAP_ROUTER_V2_CONTRACT_ADDRESS =
  "0x41323EF72662185f44a03ea0ad8094a0C9e925aB1102679D8e957e838054aac5";

// Browsers can only reach RPC over HTTP(S); the desktop's local IPC/pipe support
// (isIpcLikeRpc/toNodeIpcPath/expandTildeInIpcPath) is intentionally dropped.
function buildSwapRpcUrl(rpcEndpoint) {
  if (!rpcEndpoint || typeof rpcEndpoint !== "string") return null;
  const s = rpcEndpoint.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  const isIpAddress = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(s);
  const isLocalhost = /^localhost(:\d+)?$/i.test(s);
  return (isIpAddress || isLocalhost ? "http://" : "https://") + s;
}

function initRpcUrlForConfig(rpcEndpoint) {
  if (rpcEndpoint == null || typeof rpcEndpoint !== "string" || !rpcEndpoint.trim()) {
    return null;
  }
  return buildSwapRpcUrl(rpcEndpoint);
}

function createQuantumRpcProvider(rpcEndpoint, chainId) {
  if (rpcEndpoint == null || typeof rpcEndpoint !== "string" || !rpcEndpoint.trim())
    return null;
  const endpoint = buildSwapRpcUrl(rpcEndpoint);
  if (!endpoint) return null;
  const provider = getProvider(endpoint, chainId);
  if (provider && Number.isInteger(chainId)) {
    provider.chainId = chainId;
  }
  return provider;
}

function formatLocalRpcConnectionError(rpcEndpoint, err) {
  let msg = err && err.message ? String(err.message) : String(err);
  if (err && err.error && err.error.message && !msg.includes(String(err.error.message))) {
    msg = msg + " " + String(err.error.message);
  }
  return msg;
}

// Strip locale formatting (e.g. commas) so parseUnits gets a valid numeric string
function normalizeAmountString(value) {
  if (value == null) return "0";
  return String(value).replace(/,/g, "").trim() || "0";
}

/** Router compares deadline to block.timestamp; use chain time so local nodes do not hit EXPIRED. */
async function getSwapTxDeadline(provider, futureSeconds) {
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
  } catch (e) {
    /* fall through */
  }
  return BigInt(Math.floor(Date.now() / 1000)) + sec;
}

function formatSwapRouterRevertError(err) {
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

function toBigInt(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const s = String(value);
  if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
  try {
    return BigInt(s);
  } catch (e) {
    return null;
  }
}

async function resolveGasPriceWei(provider, keyType, fullSign) {
  if (provider && typeof provider.getFeeData === "function") {
    const kt = Number.isInteger(keyType) ? keyType : DEFAULT_WALLET_KEY_TYPE;
    try {
      const fd = await provider.getFeeData(kt, fullSign === true);
      if (fd && fd.gasPrice != null) {
        const gp = toBigInt(fd.gasPrice);
        if (gp != null) return { gasPriceWei: gp, usedFallback: false };
      }
    } catch (e) {
      /* fall through to fallback */
    }
  }
  return { gasPriceWei: null, usedFallback: true };
}

function weiToEthString(weiBigInt) {
  if (weiBigInt == null) return "0";
  const scaled = (weiBigInt * 1000000n) / WEI_PER_ETH; // coins * 1e6
  const num = Number(scaled) / 1000000;
  return String(num);
}

function applyGasBuffer(gasLimitBi, percent) {
  const base = toBigInt(gasLimitBi);
  if (base == null) return null;
  const pct = percent == null ? GAS_ESTIMATE_BUFFER_PERCENT : percent;
  return (base * (100n + BigInt(pct))) / 100n;
}

const STAKING_CONTRACT_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000001000";
const STAKING_ABI_JSON = [{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":true,"internalType":"address","name":"oldValidatorAddress","type":"address"},{"indexed":true,"internalType":"address","name":"newValidatorAddress","type":"address"}],"name":"OnChangeValidator","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":false,"internalType":"uint256","name":"withdrawalQuantity","type":"uint256"}],"name":"OnCompletePartialWithdrawal","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":false,"internalType":"uint256","name":"netBalance","type":"uint256"}],"name":"OnCompleteWithdrawal","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":false,"internalType":"uint256","name":"oldBalance","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"newBalance","type":"uint256"}],"name":"OnIncreaseDeposit","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":false,"internalType":"uint256","name":"withdrawalBlock","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"withdrawalQuantity","type":"uint256"}],"name":"OnInitiatePartialWithdrawal","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":true,"internalType":"address","name":"validatorAddress","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"blockNumber","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"blockTime","type":"uint256"}],"name":"OnNewDeposit","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":false,"internalType":"address","name":"validatorAddress","type":"address"}],"name":"OnPauseValidation","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":false,"internalType":"address","name":"validatorAddress","type":"address"}],"name":"OnResumeValidation","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":false,"internalType":"uint256","name":"rewardAmount","type":"uint256"}],"name":"OnReward","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"depositorAddress","type":"address"},{"indexed":false,"internalType":"uint256","name":"slashedAmount","type":"uint256"}],"name":"OnSlashing","type":"event"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"},{"internalType":"uint256","name":"rewardAmount","type":"uint256"}],"name":"addDepositorReward","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"},{"internalType":"uint256","name":"slashAmount","type":"uint256"}],"name":"addDepositorSlashing","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"newValidatorAddress","type":"address"}],"name":"changeValidator","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"completePartialWithdrawal","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"completeWithdrawal","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"}],"name":"didDepositorEverExist","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"validatorAddress","type":"address"}],"name":"didValidatorEverExist","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"}],"name":"doesDepositorExist","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"validatorAddress","type":"address"}],"name":"doesValidatorExist","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"}],"name":"getBalanceOfDepositor","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getDepositorCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"validatorAddress","type":"address"}],"name":"getDepositorOfValidator","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"}],"name":"getDepositorRewards","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"}],"name":"getDepositorSlashings","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"}],"name":"getNetBalanceOfDepositor","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"validatorAddress","type":"address"}],"name":"getStakingDetails","outputs":[{"components":[{"internalType":"address","name":"Depositor","type":"address"},{"internalType":"address","name":"Validator","type":"address"},{"internalType":"uint256","name":"Balance","type":"uint256"},{"internalType":"uint256","name":"NetBalance","type":"uint256"},{"internalType":"uint256","name":"BlockRewards","type":"uint256"},{"internalType":"uint256","name":"Slashings","type":"uint256"},{"internalType":"bool","name":"IsValidationPaused","type":"bool"},{"internalType":"uint256","name":"WithdrawalBlock","type":"uint256"},{"internalType":"uint256","name":"WithdrawalAmount","type":"uint256"},{"internalType":"uint256","name":"LastNilBlockNumber","type":"uint256"},{"internalType":"uint256","name":"NilBlockCount","type":"uint256"}],"internalType":"struct IStakingContract.StakingDetails","name":"","type":"tuple"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"getTotalDepositedBalance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"}],"name":"getValidatorOfDepositor","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"depositorAddress","type":"address"}],"name":"getWithdrawalBlock","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"increaseDeposit","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"initiatePartialWithdrawal","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"validatorAddress","type":"address"}],"name":"isValidationPaused","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"listValidators","outputs":[{"internalType":"address[]","name":"","type":"address[]"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"address","name":"validatorAddress","type":"address"}],"name":"newDeposit","outputs":[],"stateMutability":"payable","type":"function"},{"inputs":[],"name":"pauseValidation","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"validatorAddress","type":"address"}],"name":"resetNilBlock","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"resumeValidation","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[{"internalType":"address","name":"validatorAddress","type":"address"}],"name":"setNilBlock","outputs":[],"stateMutability":"nonpayable","type":"function"}];

const STAKING_ALLOWED_METHODS = [
  "newDeposit",
  "increaseDeposit",
  "initiatePartialWithdrawal",
  "completePartialWithdrawal",
  "pauseValidation",
  "resumeValidation",
];

function prepareStakingMethodArgs(abi, method, rawArgs) {
  const fn = abi.find((f) => f.type === "function" && f.name === method);
  if (!fn || !fn.inputs) return rawArgs || [];
  const args = rawArgs || [];
  return fn.inputs.map((input, i) => {
    const val = args[i];
    if (val == null) return val;
    if (input.type === "address") return getAddress(val);
    if (input.type === "uint256") return parseUnits(normalizeAmountString(String(val)), 18);
    return val;
  });
}

// Build the unsigned tx request (with `from`) for a given transaction kind, for estimateGas.
async function buildEstimateGasTx(data, provider) {
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

  if (txKind === "approve") {
    const tokenAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
    const spenderAddr = SWAP_ROUTER_V2_CONTRACT_ADDRESS;
    const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
    const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
    const token = IERC20.connect(getAddress(tokenAddr), provider);
    const tx = await token.populateTransaction.approve(getAddress(spenderAddr), amountWei);
    return { ...tx, from: getAddress(fromAddress) };
  }

  if (txKind === "swap") {
    const router = QuantumSwapV2Router02.connect(SWAP_ROUTER_V2_CONTRACT_ADDRESS, provider);
    const fromAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
    const toAddr = data.toTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.toTokenValue;
    const path = [getAddress(fromAddr), getAddress(toAddr)];
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
    return { ...tx, from: getAddress(toAddress) };
  }

  // Staking contract methods
  if (STAKING_ALLOWED_METHODS && STAKING_ALLOWED_METHODS.includes(txKind)) {
    const contract = new Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI_JSON, provider);
    const methodArgs = prepareStakingMethodArgs(STAKING_ABI_JSON, txKind, data.methodArgs || []);
    const tx = await contract.populateTransaction[txKind](...methodArgs);
    const out = { ...tx, from: getAddress(fromAddress) };
    if (data.value && data.value !== "0" && data.value !== "0.0") {
      out.value = parseUnits(normalizeAmountString(data.value), 18);
    }
    return out;
  }

  throw new Error("Unsupported txKind for estimateGas: " + txKind);
}

export default {
  async SwapQuoteGetAmountsOut(data) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const router = QuantumSwapV2Router02.connect(SWAP_ROUTER_V2_CONTRACT_ADDRESS, provider);

      const fromAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const toAddr = data.toTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.toTokenValue;
      const path = [getAddress(fromAddr), getAddress(toAddr)];

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

  async SwapQuoteCheckPairExists(data) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { exists: false, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { exists: false, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const factory = QuantumSwapV2Factory.connect(SWAP_FACTORY_CONTRACT_ADDRESS, provider);

      const tokenA = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const tokenB = data.toTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.toTokenValue;
      const pairAddr = await factory.getPair(getAddress(tokenA), getAddress(tokenB));
      const pairAddrStr =
        typeof pairAddr === "string"
          ? pairAddr
          : pairAddr && pairAddr.toString
            ? pairAddr.toString()
            : String(pairAddr);
      const zeroAddr =
        ZeroAddress || "0x0000000000000000000000000000000000000000000000000000000000000000";
      const exists = !!(
        pairAddrStr &&
        pairAddrStr !== zeroAddr &&
        pairAddrStr !== "0x" + "0".repeat(64)
      );

      return { exists, error: null };
    } catch (err) {
      return { exists: false, error: sanitizeSwapError(err) };
    }
  },

  async SwapQuoteGetAmountsIn(data) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const router = QuantumSwapV2Router02.connect(SWAP_ROUTER_V2_CONTRACT_ADDRESS, provider);

      const fromAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const toAddr = data.toTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.toTokenValue;
      const path = [getAddress(fromAddr), getAddress(toAddr)];

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

  async SwapQuoteEstimateGas(data) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { success: false, gasLimit: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, gasLimit: null, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const router = QuantumSwapV2Router02.connect(SWAP_ROUTER_V2_CONTRACT_ADDRESS, provider);

      const fromAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const toAddr = data.toTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.toTokenValue;
      const path = [getAddress(fromAddr), getAddress(toAddr)];
      const fromDecimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const toDecimals = typeof data.toDecimals === "number" ? data.toDecimals : 18;
      const toAddress = data.recipientAddress || data.toAddress;
      if (!toAddress) return { success: false, gasLimit: null, error: "Recipient address required" };
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
      const txWithFrom = { ...tx, from: getAddress(toAddress) };
      const gasLimit = await provider.estimateGas(txWithFrom);
      const gasLimitStr = typeof gasLimit === "bigint" ? gasLimit.toString() : String(gasLimit);
      return { success: true, gasLimit: gasLimitStr, error: null };
    } catch (err) {
      return { success: false, gasLimit: null, error: formatSwapRouterRevertError(err) };
    }
  },

  async SwapQuoteCheckAllowance(data) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { success: false, sufficient: false, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, sufficient: false, error: "Invalid RPC endpoint" };
      if (!data.ownerAddress)
        return { success: false, sufficient: false, error: "Owner address required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const tokenAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const spenderAddr = SWAP_ROUTER_V2_CONTRACT_ADDRESS;
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
        } catch (allowanceErr) {
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

  async SwapQuoteEstimateApproveGas(data) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId))
        return { success: false, gasLimit: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, gasLimit: null, error: "Invalid RPC endpoint" };
      if (!data.fromAddress) return { success: false, gasLimit: null, error: "From address required" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const tokenAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const spenderAddr = SWAP_ROUTER_V2_CONTRACT_ADDRESS;
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

  async estimateGas(data) {
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
      return { success: false, gasLimit: null, error: err && err.message ? err.message : String(err) };
    }
  },

  async estimateGasFee(data) {
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
        error: err && err.message ? err.message : String(err),
      };
    }
  },

  async SwapQuoteGetRouterAddress() {
    return { success: true, routerAddress: SWAP_ROUTER_V2_CONTRACT_ADDRESS, error: null };
  },

  async SwapQuoteGetSwapContractData(data) {
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
      const router = QuantumSwapV2Router02.connect(SWAP_ROUTER_V2_CONTRACT_ADDRESS, provider);

      const fromAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const toAddr = data.toTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.toTokenValue;
      const path = [getAddress(fromAddr), getAddress(toAddr)];
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
      return { success: true, dataHex, toAddress: SWAP_ROUTER_V2_CONTRACT_ADDRESS, valueHex, error: null };
    } catch (err) {
      return { success: false, dataHex: null, toAddress: null, valueHex: null, error: formatSwapRouterRevertError(err) };
    }
  },

  async SwapSubmitApproval(data) {
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

      const tokenAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
      const gasLimit = Number(data.gasLimit) || 84000;

      const token = IERC20.connect(getAddress(tokenAddr), wallet);
      const tx = await token.approve(
        getAddress(SWAP_ROUTER_V2_CONTRACT_ADDRESS),
        amountWei,
        signingOverrides(wallet, data, { gasLimit }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: sanitizeSwapError(err) };
    }
  },

  async SwapSubmitSwap(data) {
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

      const router = QuantumSwapV2Router02.connect(SWAP_ROUTER_V2_CONTRACT_ADDRESS, wallet);
      const fromAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const toAddr = data.toTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.toTokenValue;
      const path = [getAddress(fromAddr), getAddress(toAddr)];
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

  async SwapSubmitRemoveAllowance(data) {
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

      const tokenAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const gasLimit = Number(data.gasLimit) || 84000;

      const token = IERC20.connect(getAddress(tokenAddr), wallet);
      const tx = await token.approve(
        getAddress(SWAP_ROUTER_V2_CONTRACT_ADDRESS),
        0n,
        signingOverrides(wallet, data, { gasLimit }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: sanitizeSwapError(err) };
    }
  },

  async SwapSubmitAddAllowance(data) {
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

      const tokenAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
      const gasLimit = Number(data.gasLimit) || 84000;

      const token = IERC20.connect(getAddress(tokenAddr), wallet);
      const tx = await token.approve(
        getAddress(SWAP_ROUTER_V2_CONTRACT_ADDRESS),
        amountWei,
        signingOverrides(wallet, data, { gasLimit }),
      );
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: sanitizeSwapError(err) };
    }
  },

  async OfflineSignCoinTransaction(data) {
    try {
      if (!data.privateKey || !data.publicKey)
        return { success: false, txData: null, error: "Wallet keys required" };
      if (!data.toAddress) return { success: false, txData: null, error: "Recipient address required" };
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txData: null, error: "Invalid chain ID" };
      const nonce = Number(data.nonce);
      if (!Number.isInteger(nonce) || nonce < 0)
        return { success: false, txData: null, error: "Invalid nonce" };

      await Initialize(null);
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes);

      const valueWei = parseUnits(normalizeAmountString(data.amount), 18);
      const gasLimit = Number(data.gasLimit) || 21000;

      const txData = await wallet.signTransaction(
        signingOverrides(wallet, data, {
          to: getAddress(data.toAddress),
          value: valueWei,
          nonce: nonce,
          chainId: chainId,
          gasLimit: gasLimit,
        }),
      );
      return { success: true, txData: txData, error: null };
    } catch (err) {
      return { success: false, txData: null, error: err && err.message ? err.message : String(err) };
    }
  },

  async OfflineSignTokenTransaction(data) {
    try {
      if (!data.privateKey || !data.publicKey)
        return { success: false, txData: null, error: "Wallet keys required" };
      if (!data.toAddress) return { success: false, txData: null, error: "Recipient address required" };
      if (!data.contractAddress)
        return { success: false, txData: null, error: "Token contract address required" };
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txData: null, error: "Invalid chain ID" };
      const nonce = Number(data.nonce);
      if (!Number.isInteger(nonce) || nonce < 0)
        return { success: false, txData: null, error: "Invalid nonce" };

      await Initialize(null);
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes);

      const decimals = typeof data.fromDecimals === "number" ? data.fromDecimals : 18;
      const amountWei = parseUnits(normalizeAmountString(data.amount), decimals);
      const gasLimit = Number(data.gasLimit) || 84000;

      const token = IERC20.connect(getAddress(data.contractAddress), wallet);
      const txReq = await token.populateTransaction.transfer(
        getAddress(data.toAddress),
        amountWei,
        signingOverrides(wallet, data, { gasLimit }),
      );

      const txData = await wallet.signTransaction(
        signingOverrides(wallet, data, {
          ...txReq,
          nonce: nonce,
          chainId: chainId,
        }),
      );
      return { success: true, txData: txData, error: null };
    } catch (err) {
      return { success: false, txData: null, error: err && err.message ? err.message : String(err) };
    }
  },

  async StakingContractSubmit(data) {
    try {
      if (!data.method || !STAKING_ALLOWED_METHODS.includes(data.method))
        return { success: false, txHash: null, error: "Invalid staking method" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txHash: null, error: "Wallet keys required" };
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txHash: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, txHash: null, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes, provider);

      const contract = new Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI_JSON, wallet);
      const methodArgs = prepareStakingMethodArgs(STAKING_ABI_JSON, data.method, data.methodArgs);
      const gasLimit = Number(data.gasLimit) || 250000;
      const overrides = signingOverrides(wallet, data, { gasLimit });
      if (data.value && data.value !== "0" && data.value !== "0.0") {
        overrides.value = parseUnits(normalizeAmountString(data.value), 18);
      }
      methodArgs.push(overrides);

      const tx = await contract[data.method](...methodArgs);
      return { success: true, txHash: tx.hash, error: null };
    } catch (err) {
      return { success: false, txHash: null, error: err && err.message ? err.message : String(err) };
    }
  },

  async StakingContractOfflineSign(data) {
    try {
      if (!data.method || !STAKING_ALLOWED_METHODS.includes(data.method))
        return { success: false, txData: null, error: "Invalid staking method" };
      if (!data.privateKey || !data.publicKey)
        return { success: false, txData: null, error: "Wallet keys required" };
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, txData: null, error: "Invalid chain ID" };
      const nonce = Number(data.nonce);
      if (!Number.isInteger(nonce) || nonce < 0)
        return { success: false, txData: null, error: "Invalid nonce" };

      await Initialize(null);
      const privBytes = Buffer.from(data.privateKey, "base64");
      const pubBytes = Buffer.from(data.publicKey, "base64");
      const wallet = Wallet.fromKeys(privBytes, pubBytes);

      const contract = new Contract(STAKING_CONTRACT_ADDRESS, STAKING_ABI_JSON, wallet);
      const methodArgs = prepareStakingMethodArgs(STAKING_ABI_JSON, data.method, data.methodArgs);
      const gasLimit = Number(data.gasLimit) || 250000;
      const overrides = signingOverrides(wallet, data, { gasLimit });
      if (data.value && data.value !== "0" && data.value !== "0.0") {
        overrides.value = parseUnits(normalizeAmountString(data.value), 18);
      }
      methodArgs.push(overrides);

      const txReq = await contract.populateTransaction[data.method](...methodArgs);
      const txData = await wallet.signTransaction(
        signingOverrides(wallet, data, { ...txReq, nonce: nonce, chainId: chainId }),
      );
      return { success: true, txData: txData, error: null };
    } catch (err) {
      return { success: false, txData: null, error: err && err.message ? err.message : String(err) };
    }
  },

  async SendCoinsSubmit(data) {
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

  async SendTokensSubmit(data) {
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

  async SwapQuoteGetApproveContractData(data) {
    try {
      const chainId = Number(data.chainId);
      if (!Number.isInteger(chainId)) return { success: false, dataHex: null, error: "Invalid chain ID" };

      const provider = createQuantumRpcProvider(data.rpcEndpoint, chainId);
      if (!provider) return { success: false, dataHex: null, error: "Invalid RPC endpoint" };

      await Initialize(new Config(chainId, initRpcUrlForConfig(data.rpcEndpoint)));
      const tokenAddr = data.fromTokenValue === "Q" ? SWAP_WQ_CONTRACT_ADDRESS : data.fromTokenValue;
      const spenderAddr = SWAP_ROUTER_V2_CONTRACT_ADDRESS;
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
