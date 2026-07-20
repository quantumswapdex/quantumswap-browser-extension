// Single source of truth for the swap deployment ("release") contract
// addresses. A release is one on-chain deployment of the three core contracts
// (wrapped Q, factory, router). The built-in "Beta 2" release ships here; the
// bridge exposes the list on `window` (see src/bridge/index.js) so the classic
// UI scripts (public/js/release.js) seed storage from it without duplicating
// the literals. Handlers fall back to these constants when a payload carries
// no release override.
export const SWAP_WQ_CONTRACT_ADDRESS =
  "0x45BD01BE5EF8509D9dA183689eA7Faf647331c54c7C9801dE54c9EDE9Ac44D92";
export const SWAP_FACTORY_CONTRACT_ADDRESS =
  "0x95085766E20fCBf0106dC7037020Ca069e22080DBEF2615551Bab65D59a99754";
export const SWAP_ROUTER_V2_CONTRACT_ADDRESS =
  "0xC3666584A70A707E5e929Ba9871083ED8f9528eCe7a56FdbA485272a645D861e";

// Built-ins ship in code and cannot be removed or edited (mirrors the web
// app's BUILTIN_RELEASES in src/config/releases.ts).
export const BUILTIN_SWAP_RELEASES = [
  {
    id: "beta-2",
    name: "Beta 2",
    wq: SWAP_WQ_CONTRACT_ADDRESS,
    factory: SWAP_FACTORY_CONTRACT_ADDRESS,
    router: SWAP_ROUTER_V2_CONTRACT_ADDRESS,
    builtin: true,
  },
];
