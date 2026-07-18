// Ported from the platform ipcMain.handle handlers (App/Clipboard/Shell/File/Storage path)
// in the desktop src/index.js, mapped to WebExtension / Web APIs.
const ext = (globalThis as any).browser || (globalThis as any).chrome;

export default {
  async AppApiGetVersion() {
    return ext.runtime.getManifest().version;
  },

  // Electron: package.json "name" (drives theme selection in src/app/theme.ts).
  // The extension is a first-party build, so it always reports the quantum
  // theme package name.
  async AppApiGetPackageName() {
    return "quantumswapwallet";
  },

  // Electron: clipboard.writeText -> Web clipboard (requires a user gesture, which
  // the copy buttons provide, plus the "clipboardWrite" permission).
  async ClipboardWriteText(data: any) {
    await navigator.clipboard.writeText(data);
  },

  // Electron: shell.openExternal -> open the URL in a new browser tab.
  // item 23: only open http/https. Reject javascript:/data:/chrome-extension:/
  // file: and other schemes so a caller cannot trigger script execution or
  // navigate to a privileged/local target.
  async OpenUrlInShell(data: any) {
    let parsed: URL;
    try {
      parsed = new URL(String(data));
    } catch {
      throw new Error("OpenUrlInShell: invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("OpenUrlInShell: only http(s) URLs are allowed");
    }
    await ext.tabs.create({ url: parsed.href });
  },

  // Electron: fs.readFileSync(path.join(__dirname, data)) -> fetch a bundled
  // extension resource. Callers pass paths like "./json/en-us.json".
  // item 23: only allow bundled relative paths. Reject absolute paths, parent
  // traversal (`..`), and anything carrying a scheme (`://`) so this cannot be
  // coerced into fetching a resource outside the extension bundle.
  async FileApiReadFile(data: any) {
    const raw = String(data);
    const relative = raw.replace(/^\.\//, "");
    if (relative === ""
        || relative.includes("..")
        || relative.includes("://")
        || relative.charAt(0) === "/"
        || relative.charAt(0) === "\\") {
      throw new Error("FileApiReadFile: invalid path");
    }
    const url = ext.runtime.getURL(relative);
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  },

  // Electron: app.getPath('userData'). There is no filesystem path in an
  // extension; wallets live in the browser's storage. Return a human-readable
  // label shown wherever the UI displays a "storage location" (onboarding quiz,
  // settings "Wallet Path", and the backup/error messages).
  async StorageApiGetPath() {
    return "Browser's Storage";
  },
};
