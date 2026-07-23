// Single source of truth for the recognized token contract addresses. The
// bridge imports these directly and also exposes the list on `window`
// (see src/bridge/index.js), which loads before every classic UI script, so
// public/js/tokenfilter.js reads the same list instead of duplicating the
// literals. src/lib/tokenfilter.ts derives its recognition set from this list.
import { SWAP_WQ_CONTRACT_ADDRESS } from "./release-constants.js";

export const HEISEN_TOKEN_CONTRACT_ADDRESS =
  "0xe8ea8beb86e714ef2bde0afac17d6e45d1c35e48f312d6dc12c4fdb90d9e8a3d";
export const Y2Q_TOKEN_CONTRACT_ADDRESS =
  "0xa8036870874fbed790ed4d3bbd41b2f390b9858ff021f2993e90c6d1cbb167c7";
// Name/symbol below were read on-chain from the mainnet RPC
// (public.rpc.quantumcoinapi.com); all four have 18 decimals.
export const LION_TOKEN_CONTRACT_ADDRESS = // "Lion" (Lio)
  "0x4015b40b181f2415003f24118b215ce04f276509176eccb10e0c4a9ccbd458d2";
export const TIGER_TOKEN_CONTRACT_ADDRESS = // "Tiger" (tig)
  "0x6ff70c260458c9f448ec7aab008f1611456d58edb12e7795bf88735e1986a6ad";
export const CAT_TOKEN_CONTRACT_ADDRESS = // "Cat" (cat)
  "0x592a8abb1de07bc3797bc3c592fc74c099c5a311ba856fc66fb6d4cfc18c728d";
export const PANTHER_TOKEN_CONTRACT_ADDRESS = // "panther" (pant)
  "0x05fe2265b69d0c70a24075180242736c7389876b8917f38400e6540519e663df";

export const RECOGNIZED_TOKEN_CONTRACT_ADDRESSES = [
  // Beta 2 release's "Wrapped Q" (WQ, 18 decimals, verified on-chain): held as
  // an ERC-20 it should show on the main Tokens tab. Also a swap hop candidate,
  // where the route finder dedupes it against release.wq.
  SWAP_WQ_CONTRACT_ADDRESS,
  HEISEN_TOKEN_CONTRACT_ADDRESS,
  Y2Q_TOKEN_CONTRACT_ADDRESS,
  LION_TOKEN_CONTRACT_ADDRESS,
  TIGER_TOKEN_CONTRACT_ADDRESS,
  CAT_TOKEN_CONTRACT_ADDRESS,
  PANTHER_TOKEN_CONTRACT_ADDRESS,
];
