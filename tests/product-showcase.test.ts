import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildProductShowcasePrompt, parseShowcaseProduct, showcaseScene, type ShowcaseProduct } from "../src/product-showcase";

const product: ShowcaseProduct = {
  itemCode: "sample:one",
  itemName: "収納ボックス 3個セット",
  itemUrl: "https://item.rakuten.co.jp/sample/one/",
  imageUrl: "https://example.com/reference.jpg",
  itemCaption: "洗面台やキッチンの小物収納。<br>幅20cm。",
};
test("all target and shot variants begin with the literal prefix and preserve product identity", () => {
  for (const target of ["room", "instagram", "x"] as const) {
    for (const role of ["hero", "details", "context"] as const) {
      const prompt = buildProductShowcasePrompt(product, { target, role });
      assert.equal(prompt.split("\n")[0], "/showcase");
      const data = JSON.parse(prompt.slice(prompt.indexOf("{")));
      assert.equal(data.itemCode, product.itemCode);
      assert.equal(data.imageUrl, product.imageUrl);
      assert.equal(data.itemUrl, product.itemUrl);
      assert.equal(data.itemName, product.itemName);
      assert.equal(data.itemCaption, "洗面台やキッチンの小物収納。 幅20cm。");
      assert.ok(prompt.includes("形状、輪郭、縦横比、色、ロゴ"));
      assert.ok(prompt.includes("保証するものではない"));
      assert.ok(prompt.includes("実画素"));
    }
  }
});
test("product category changes staging rather than copying perfume props", () => {
  assert.match(showcaseScene(product), /棚やカウンター/);
  assert.match(showcaseScene({ ...product, itemName: "香水", itemCaption: "" }), /香り・成分を確認できる場合だけ/);
  assert.match(showcaseScene({ ...product, itemName: "コーヒー", itemCaption: "" }), /食卓/);
  assert.match(showcaseScene({ ...product, itemName: "ランタン", itemCaption: "" }), /屋外/);
  assert.match(showcaseScene({ ...product, itemName: "ドライヤー", itemCaption: "" }), /コード・ボタン/);
  assert.match(showcaseScene({ ...product, itemName: "ソフトウェア", itemCaption: "" }), /パッケージや画面機能を新作せず/);
  assert.match(showcaseScene({ ...product, itemName: "未分類商品", itemCaption: "" }), /用途が不明なら無地/);
});
test("missing image or product identity and unsupported options fail closed", () => {
  for (const key of ["itemCode", "itemName", "itemUrl", "imageUrl"] as const) {
    assert.throws(() => parseShowcaseProduct({ ...product, [key]: "" }));
  }
  assert.throws(() => parseShowcaseProduct({ ...product, imageUrl: "file:///tmp/test.png" }));
  assert.throws(() => parseShowcaseProduct({ ...product, imageUrl: "https://user:pass@example.com/a" }));
  assert.throws(() => parseShowcaseProduct({ ...product, itemCaption: 123 }));
  assert.throws(() => buildProductShowcasePrompt(product, { target: "other" as never }));
  assert.throws(() => buildProductShowcasePrompt(product, { role: "other" as never }));
});
test("unknown fields and secrets are excluded from the prompt", () => {
  const prompt = buildProductShowcasePrompt({ ...product, apiKey: "do-not-emit" } as ShowcaseProduct);
  assert.ok(!prompt.includes("do-not-emit"));
  assert.ok(!prompt.includes("apiKey"));
});
test("CLI prepares a real prompt without changing input or creating state files", () => {
  const directory = mkdtempSync(join(tmpdir(), "showcase-test-"));
  try {
    const input = join(directory, "product.json");
    const source = JSON.stringify(product);
    writeFileSync(input, source);
    const cli = resolve("tools/create-showcase-prompt.ts");
    const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "--silent", "image:prompt", "--", input, "instagram", "details"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.startsWith("/showcase\n"));
    assert.match(result.stdout, /Instagram、縦長 4:5/);
    assert.match(result.stdout, /見えない裏面・内部構造は生成しない/);
    assert.equal(readFileSync(input, "utf8"), source);
    assert.deepEqual(readdirSync(directory), ["product.json"]);
    const invalid = spawnSync(process.execPath, ["--import", "tsx", cli, input, "unknown"], { encoding: "utf8" });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
