import { readFileSync, statSync, writeFileSync } from "node:fs";
import { reserveTransaction, beginTransaction, finishTransaction, verifyTransactionReadback } from "../src/browser-post-transaction";
function read(filename: string) {
  if (!filename || statSync(filename).size > 2 * 1024 * 1024) throw new Error("TRANSACTION_INPUT_TOO_LARGE");
  return JSON.parse(readFileSync(filename, "utf8"));
}
try {
  const [command, manifest, snapshot, value, output] = process.argv.slice(2);
  if (!manifest || !snapshot || !value || !["reserve", "begin", "finish", "verify"].includes(command)) throw new Error("Usage: room:transaction <reserve|begin|finish|verify> <manifest> <snapshot.json> <profile-url|request-id|evidence.json|plan.json> [new-output.json]");
  const result = command === "reserve" ? reserveTransaction(manifest, read(snapshot), value)
    : command === "begin" ? beginTransaction(manifest, read(snapshot), value)
    : command === "finish" ? finishTransaction(manifest, read(snapshot), read(value))
    : verifyTransactionReadback(read(value), read(snapshot), manifest);
  if (output) writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  else console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : "TRANSACTION_FAILED"); process.exitCode = 1; }
