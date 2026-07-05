// Bundles the platform bridge (SDK + WASM + ported IPC handlers + Node polyfills)
// into public/platform-bridge.js as a self-contained IIFE classic script.
//
// Kept separate from WXT/Vite because the legacy wallet UI in public/ uses plain
// global <script> files and must not be transformed by Vite; this bundle is just
// another static asset WXT copies from public/.
import esbuild from "esbuild";
import { polyfillNode } from "esbuild-plugin-polyfill-node";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const watch = process.argv.includes("--watch");
// Sourcemaps are large (~15 MB alongside the embedded WASM); only emit them for
// local dev/watch so production zips stay lean.
const sourcemap = watch || process.argv.includes("--sourcemap");

const netShim = path.join(root, "src", "bridge", "shims", "net.cjs");

// Redirect Node's `net` to our browser shim. Must run before polyfillNode so it
// wins the resolution. `crypto` is no longer aliased: the SDKs provide their
// crypto natively (WASM + Web Crypto) and the handlers use the Web Crypto API.
const aliasPlugin = {
  name: "quantumswap-node-aliases",
  setup(build) {
    build.onResolve({ filter: /^(node:)?net$/ }, () => ({ path: netShim }));
  },
};

const buildOptions = {
  entryPoints: [path.join(root, "src", "bridge", "index.js")],
  bundle: true,
  outfile: path.join(root, "public", "platform-bridge.js"),
  format: "iife",
  platform: "browser",
  target: ["chrome110", "firefox115"],
  sourcemap,
  legalComments: "none",
  // Ensure `global` exists before any bundled module (Go's wasm_exec + SDK use it).
  banner: { js: "globalThis.global = globalThis.global || globalThis;" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    aliasPlugin,
    polyfillNode({
      globals: { buffer: true, process: true },
      polyfills: { crypto: false, fs: "empty", net: "empty" },
    }),
  ],
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("[build-bridge] watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("[build-bridge] wrote public/platform-bridge.js");
}
