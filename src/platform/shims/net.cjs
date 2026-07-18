// Empty stub for `net` / `node:net`. quantumcoin's extra-providers requires it
// for the IPC (named-pipe / unix-socket) provider, which cannot exist in a
// browser. We only ever use HTTP(S) providers, so this is never invoked; the
// stub exists purely so bundling succeeds.
function unavailable() {
  throw new Error("net is not available in the browser extension (IPC/socket RPC is unsupported; use an HTTP(S) rpcEndpoint).");
}

module.exports = {
  Socket: class Socket {
    constructor() {
      unavailable();
    }
  },
  createConnection: unavailable,
  connect: unavailable,
  createServer: unavailable,
  isIP: () => 0,
  isIPv4: () => false,
  isIPv6: () => false,
};
