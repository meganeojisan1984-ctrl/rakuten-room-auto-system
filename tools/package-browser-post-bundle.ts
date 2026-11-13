/** Package already generated/reviewed local artifacts. Never generates or posts. */
import { readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { validateBrowserPostBundle } from "../src/browser-post-bundle";
function main(args: string[]) {
  if (args.length !== 2) throw new Error("Usage: npm run room:bundle -- <bundle-directory> <metadata.json>");
  const root = path.resolve(args[0]), metadataPath = path.resolve(args[1]);
  if (statSync(metadataPath).size > 64 * 1024) throw new Error("BUNDLE_METADATA_TOO_LARGE");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const names: Record<string, string> = { product: "product.json", prompt: "prompt.txt", caption: "caption.txt", image: metadata.imageFile };
  const files: Record<string, unknown> = {}, hashes: Record<string, string> = {};
  for (const [key, name] of Object.entries(names)) {
    if (typeof name !== "string" || path.isAbsolute(name) || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === "..")) throw new Error("BUNDLE_INPUT_PATH_INVALID");
    const filename = path.join(root, name), size = statSync(filename).size;
    const max = key === "image" ? 8 * 1024 * 1024 : key === "product" ? 256 * 1024 : 64 * 1024;
    if (size <= 0 || size > max) throw new Error("BUNDLE_INPUT_SIZE_INVALID");
    hashes[key] = createHash("sha256").update(readFileSync(filename)).digest("hex");
    files[key] = { path: name, sha256: hashes[key], ...(key === "image" ? { mimeType: metadata.mimeType } : {}) };
  }
  const product = JSON.parse(readFileSync(path.join(root, names.product), "utf8"));
  const manifest = {
    version: 1, id: metadata.id,
    item: { itemCode: product.itemCode, itemName: product.itemName, itemUrl: product.itemUrl, roomCollectUrl: product.roomCollectUrl },
    files, provenance: metadata.provenance,
    review: { reviewer: metadata.review?.reviewer, reviewedAt: metadata.review?.reviewedAt,
      visualFidelity: metadata.review?.visualFidelity, groundedCopy: metadata.review?.groundedCopy,
      productDestination: metadata.review?.productDestination, hashes },
  };
  const destination = path.join(root, "manifest.json");
  writeFileSync(destination, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  try {
    const checked = validateBrowserPostBundle(destination);
    console.log(JSON.stringify({ manifestPath: destination, itemCode: checked.item.itemCode, imageSha256: checked.image.sha256, validated: true, postingAuthorized: false }));
  } catch (error) { unlinkSync(destination); throw error; }
}
try { main(process.argv.slice(2)); }
catch (error) { console.error(error instanceof Error ? error.message : "BUNDLE_PREPARATION_FAILED"); process.exitCode = 1; }
