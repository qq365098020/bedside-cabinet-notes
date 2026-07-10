import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/assets", { recursive: true });

await Promise.all([
  copyFile("sw.js", "dist/sw.js"),
  copyFile("manifest.json", "dist/manifest.json"),
  copyFile("version.json", "dist/version.json"),
  copyFile("assets/icon.svg", "dist/assets/icon.svg")
]);
