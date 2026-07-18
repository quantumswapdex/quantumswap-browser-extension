// Single source of truth for the swap deployment ("release") contract
// addresses. A release is one on-chain deployment of the three core contracts
// (wrapped Q, factory, router). The built-in "Beta 1" release ships here; the
// bridge exposes the list on `window` (see src/bridge/index.js) so the classic
// UI scripts (public/js/release.js) seed storage from it without duplicating
// the literals. Handlers fall back to these constants when a payload carries
// no release override.
export const SWAP_WQ_CONTRACT_ADDRESS =
  "0x0E49c26cd1ca19bF8ddA2C8985B96783288458754757F4C9E00a5439A7291628";
export const SWAP_FACTORY_CONTRACT_ADDRESS =
  "0xbbF45a1B60044669793B444eD01Eb33e03Bb8cf3c5b6ae7887B218D05C5Cbf1d";
export const SWAP_ROUTER_V2_CONTRACT_ADDRESS =
  "0x41323EF72662185f44a03ea0ad8094a0C9e925aB1102679D8e957e838054aac5";

// Built-ins ship in code and cannot be removed or edited (mirrors the web
// app's BUILTIN_RELEASES in src/config/releases.ts).
export const BUILTIN_SWAP_RELEASES = [
  {
    id: "beta-1",
    name: "Beta 1",
    wq: SWAP_WQ_CONTRACT_ADDRESS,
    factory: SWAP_FACTORY_CONTRACT_ADDRESS,
    router: SWAP_ROUTER_V2_CONTRACT_ADDRESS,
    builtin: true,
  },
];
