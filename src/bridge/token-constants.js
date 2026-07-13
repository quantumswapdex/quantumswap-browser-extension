// Single source of truth for the recognized token contract addresses (Heisen,
// Y2Q). The bridge imports these directly and also exposes the list on `window`
// (see src/bridge/index.js), which loads before every classic UI script, so
// public/js/tokenfilter.js reads the same list instead of duplicating the
// literals.
export const HEISEN_TOKEN_CONTRACT_ADDRESS =
  "0xe8ea8beb86e714ef2bde0afac17d6e45d1c35e48f312d6dc12c4fdb90d9e8a3d";
export const Y2Q_TOKEN_CONTRACT_ADDRESS =
  "0xa8036870874fbed790ed4d3bbd41b2f390b9858ff021f2993e90c6d1cbb167c7";

export const RECOGNIZED_TOKEN_CONTRACT_ADDRESSES = [
  HEISEN_TOKEN_CONTRACT_ADDRESS,
  Y2Q_TOKEN_CONTRACT_ADDRESS,
];
