// Ported from the platform ipcMain.handle handlers (App/Clipboard/Shell/File/Storage path)
// in the desktop src/index.js, mapped to WebExtension / Web APIs.
const ext = globalThis.browser || globalThis.chrome;

export default {
  async AppApiGetVersion() {
    return ext.runtime.getManifest().version;
  },

  // Electron: clipboard.writeText -> Web clipboard (requires a user gesture, which
  // the copy buttons provide, plus the "clipboardWrite" permission).
  async ClipboardWriteText(data) {
    await navigator.clipboard.writeText(data);
  },

  // Electron: shell.openExternal -> open the URL in a new browser tab.
  async OpenUrlInShell(data) {
    await ext.tabs.create({ url: data });
  },

  // Electron: fs.readFileSync(path.join(__dirname, data)) -> fetch a bundled
  // extension resource. Callers pass paths like "./json/en-us.json".
  async FileApiReadFile(data) {
    const relative = String(data).replace(/^\.\//, "");
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
