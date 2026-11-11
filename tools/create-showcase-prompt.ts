/** Offline prompt-only CLI. Does not import the posting or image API pipeline. */
import { readFileSync, statSync } from "node:fs";
import { buildProductShowcasePrompt, parseShowcaseProduct, type ShowcaseRole, type ShowcaseTarget } from "../src/product-showcase";

function main(args: string[]): void {
  const [productPath, target = "room", role = "hero", ...rest] = args;
  if (!productPath || rest.length) throw new Error("Usage: npm run image:prompt -- <product.json> [room|instagram|x] [hero|details|context]");
  if (!["room", "instagram", "x"].includes(target)) throw new Error("SHOWCASE_TARGET_INVALID");
  if (!["hero", "details", "context"].includes(role)) throw new Error("SHOWCASE_ROLE_INVALID");
  const stat = statSync(productPath);
  if (!stat.isFile() || stat.size === 0 || stat.size > 256 * 1024) throw new Error("SHOWCASE_PRODUCT_FILE_INVALID");
  const bytes = readFileSync(productPath);
  if (bytes.length > 256 * 1024) throw new Error("SHOWCASE_PRODUCT_FILE_INVALID");
  const product = parseShowcaseProduct(JSON.parse(bytes.toString("utf8")));
  process.stdout.write(buildProductShowcasePrompt(product, { target: target as ShowcaseTarget, role: role as ShowcaseRole }) + "\n");
}
try { main(process.argv.slice(2)); }
catch (error) { console.error(error instanceof Error ? error.message : "SHOWCASE_PROMPT_FAILED"); process.exitCode = 1; }
