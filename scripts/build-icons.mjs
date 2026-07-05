// Generates the extension toolbar/store icons from the same source logo the
// Electron app uses (src/assets/svg/quantumswap.svg -> app/icon.png), but for
// the browser toolbar the light ring washes out against light toolbars. To fix
// the contrast we composite the ring onto a full-bleed BLACK CIRCLE (the four
// corners of the square stay transparent, so it reads as a circular icon).
//
// The in-app icons (public/assets/icons/app/*) are intentionally NOT touched by
// this script and keep their original transparent look.
//
// Output -> public/icon/*.png (auto-discovered by WXT and referenced in
// wxt.config.ts). Pass `--preview` to write only public/icon/preview-128.png
// (used to get sign-off before overwriting the live icons).
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const svgPath = path.join(root, "public", "assets", "svg", "quantumswap.svg");
const outDir = path.join(root, "public", "icon");

const sizes = [16, 32, 48, 96, 128];
const previewMode = process.argv.includes("--preview");

// Source logo lives in a 280x260 viewBox. Drop its opaque background rect and
// pull out just the inner content (defs + ring + dots) so we can re-place it.
const svg = fs.readFileSync(svgPath, "utf8");
const innerLogo = svg
  .replace(/<rect width="100%" height="100%" fill="#0b0614"\/>/, "")
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .trim();

// Square canvas with a black circle that touches all four edges (transparent
// corners). The 280x260 logo is nested and scaled to 224x208 (same aspect
// ratio) and centered, leaving a comfortable margin inside the black disc.
const LOGO_W = 224;
const LOGO_H = 208;
const LOGO_X = (280 - LOGO_W) / 2; // 28
const LOGO_Y = (280 - LOGO_H) / 2; // 36
const composedSvg = Buffer.from(
  `<svg width="280" height="280" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="140" cy="140" r="140" fill="#000000"/>` +
    `<svg x="${LOGO_X}" y="${LOGO_Y}" width="${LOGO_W}" height="${LOGO_H}" viewBox="0 0 280 260">` +
    innerLogo +
    `</svg>` +
    `</svg>`,
  "utf8",
);

fs.mkdirSync(outDir, { recursive: true });

if (previewMode) {
  const out = path.join(outDir, "preview-128.png");
  await sharp(composedSvg).resize(128, 128).png().toFile(out);
  console.log("wrote", path.relative(root, out).replace(/\\/g, "/"), "128x128 (preview)");
  console.log("[build-icons] preview done");
} else {
  for (const size of sizes) {
    const out = path.join(outDir, `${size}.png`);
    await sharp(composedSvg).resize(size, size).png().toFile(out);
    console.log("wrote", path.relative(root, out).replace(/\\/g, "/"), `${size}x${size}`);
  }
  console.log("[build-icons] done");
}
