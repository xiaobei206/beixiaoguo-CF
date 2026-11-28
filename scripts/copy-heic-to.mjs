import { access, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(root, "node_modules/heic-to");
const sourceBundle = resolve(packageDir, "dist/iife/heic-to.js");
const sourceLicense = resolve(packageDir, "LICENSE");
const destinationDir = resolve(root, "public/assets/vendor");
const destinationBundle = resolve(destinationDir, "heic-to.js");
const destinationLicense = resolve(destinationDir, "heic-to-LICENSE.txt");

await access(sourceBundle);
const bundleInfo = await stat(sourceBundle);
if (bundleInfo.size < 100_000) {
  throw new Error("heic-to IIFE bundle is unexpectedly small; refusing to publish a possibly empty decoder.");
}
const license = await readFile(sourceLicense, "utf8");
if (!license.includes("GNU LESSER GENERAL PUBLIC LICENSE") || !license.includes("Version 3")) {
  throw new Error("heic-to LGPL-3.0 license could not be verified.");
}
await mkdir(destinationDir, { recursive: true });
await copyFile(sourceBundle, destinationBundle);
await copyFile(sourceLicense, destinationLicense);
console.log("已准备自托管 heic-to 解码器：" + bundleInfo.size + " bytes；同时复制 LGPL-3.0 许可证。");
