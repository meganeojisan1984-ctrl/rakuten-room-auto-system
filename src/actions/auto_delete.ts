/**
 * auto_delete.ts - 自動投稿削除機能
 * マイページの過去投稿（コレ）を一括削除する
 */
import { createBrowserContext, validateSession } from "../core/browser";
import { randomSleep } from "../utils/helpers";
import { addLog } from "../api/server";

const ROOM_URL = "https://room.rakuten.co.jp";

const SELECTORS = {
  // マイページの投稿アイテム
  myItems: '.room-item, [class*="my-item"], [class*="post-item"]',
  // 削除ボタン
  deleteButton: '[class*="delete"], [aria-label*="削除"], button:has-text("削除"), [title*="削除"]',
  // 確認ダイアログのOKボタン
  confirmButton: 'button:has-text("削除する"), button:has-text("OK"), button:has-text("はい"), [class*="confirm"]',
  // 編集メニュー / 三点メニュー
  menuButton: '[class*="menu"], [class*="more"], button[aria-label*="メニュー"], .btn-more',
};

/**
 * 自動削除実行
 * @param maxDeletes 最大削除件数 (0 = 全件)
 * @param headless ヘッドレス実行フラグ
 */
export async function runAutoDelete(maxDeletes: number = 10, headless: boolean = true): Promise<void> {
  const limitLabel = maxDeletes === 0 ? "全件" : `最大${maxDeletes}件`;
  console.log(`[auto_delete] 自動削除開始 (${limitLabel})`);
  addLog("auto_delete", "info", `自動削除開始 (${limitLabel})`);

  const { browser, context } = await createBrowserContext(headless);
  let deleteCount = 0;

  try {
    if (!(await validateSession(context))) {
      addLog("auto_delete", "error", "セッション無効: Cookie更新が必要です");
      return;
    }

    const page = await context.newPage();

    // マイページへ移動
    await page.goto(`${ROOM_URL}/my`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomSleep(2000, 3000);

    let continueLoop = true;
    while (continueLoop && (maxDeletes === 0 || deleteCount < maxDeletes)) {
      // 投稿アイテムを取得
      const items = await page.locator(SELECTORS.myItems).all();
      if (items.length === 0) {
        console.log("[auto_delete] 削除対象の投稿がありません");
        break;
      }

      let deletedThisPass = 0;
      for (const item of items) {
        if (maxDeletes !== 0 && deleteCount >= maxDeletes) { continueLoop = false; break; }

        try {
          // 三点メニューを開く (存在する場合)
          const menuBtn = item.locator(SELECTORS.menuButton).first();
          const hasMenu = await menuBtn.isVisible().catch(() => false);
          if (hasMenu) {
            await menuBtn.click();
            await randomSleep(500, 1000);
          }

          // 削除ボタンを探してクリック
          const delBtn = item.locator(SELECTORS.deleteButton).first();
          const isVisible = await delBtn.isVisible().catch(() => false);
          if (!isVisible) continue;

          await delBtn.scrollIntoViewIfNeeded();
          await randomSleep(500, 1000);
          await delBtn.click();
          await randomSleep(500, 1500);

          // 確認ダイアログ
          const confirmBtn = page.locator(SELECTORS.confirmButton).first();
          const confirmVisible = await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false);
          if (confirmVisible) {
            await confirmBtn.click();
            await randomSleep(1000, 2000);
          }

          deleteCount++;
          deletedThisPass++;
          console.log(`[auto_delete] 削除: ${deleteCount}件目`);
          await randomSleep(1500, 3000);
        } catch {
          // 失敗した投稿はスキップ
        }
      }

      // このパスで削除できなかったら終了
      if (deletedThisPass === 0) break;

      // 次のページへ or リロード
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await randomSleep(2000, 3000);
    }

    addLog("auto_delete", "info", `削除完了: ${deleteCount}件`);
    console.log(`[auto_delete] 完了: ${deleteCount}件削除`);
  } catch (err) {
    const msg = String(err);
    console.error("[auto_delete] エラー:", msg);
    addLog("auto_delete", "error", msg);
    throw err;
  } finally {
    await browser.close();
  }
}
