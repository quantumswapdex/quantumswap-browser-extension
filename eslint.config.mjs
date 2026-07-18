import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// Same security lint policy as the desktop wallet: ban the HTML-injection
// sinks so all DOM construction goes through the safe el()/textContent builder.
const bannedSinkProperties = ["innerHTML", "outerHTML", "insertAdjacentHTML", "write", "writeln"];

export default tseslint.config(
  {
    // examples/ is a standalone demo page (plain browser script, not part of
    // the extension build).
    ignores: [".output/**", ".wxt/**", "node_modules/**", "public/**", "dist/**", "examples/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "entrypoints/**/*.ts", "src/platform/**/*.js", "scripts/**/*.mjs"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-restricted-properties": [
        "error",
        ...bannedSinkProperties.map((property) => ({
          property,
          message: `Use the safe DOM builder (el/textContent) instead of ${property}.`,
        })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Function']",
          message: "new Function() is banned.",
        },
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: "innerHTML assignment is banned; use the safe DOM builder.",
        },
        {
          selector: "AssignmentExpression[left.property.name='outerHTML']",
          message: "outerHTML assignment is banned; use the safe DOM builder.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Vendored QR code library (verbatim port of the legacy qrcode.js, MIT).
    // Style rules are relaxed for it; the security rules above still apply.
    files: ["src/ui/qrcode.ts"],
    rules: {
      // QRBitBuffer/QR8bitByte expose a .write(buffer) method; document.write
      // stays banned via the html-sink properties below.
      "no-restricted-properties": [
        "error",
        ...["innerHTML", "outerHTML", "insertAdjacentHTML"].map((property) => ({
          property,
          message: `Use the safe DOM builder (el/textContent) instead of ${property}.`,
        })),
      ],
      "no-var": "off",
      "prefer-const": "off",
      "prefer-rest-params": "off",
      "no-prototype-builtins": "off",
      "no-useless-escape": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.cjs", "src/platform/**/*.js", "src/platform/**/*.cjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", require: "readonly", module: "readonly", __dirname: "readonly", Buffer: "readonly", window: "readonly", navigator: "readonly", globalThis: "readonly", fetch: "readonly", URL: "readonly", atob: "readonly", btoa: "readonly", TextEncoder: "readonly", TextDecoder: "readonly", crypto: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
