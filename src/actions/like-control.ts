import type { Locator } from "playwright";

export const LIKE_CARD = 'div[class*="collect--"]';
export const UNLIKED_ICON = '[class*="rex-favorite-outline--"]';
export const LIKED_ICON = '[class*="rex-favorite-filled--"]';
export const LIKE_BUTTON = `button:has(${UNLIKED_ICON}), button:has(${LIKED_ICON})`;

export async function confirmLike(
  button: Pick<Locator, "locator" | "scrollIntoViewIfNeeded" | "click">,
  settle: () => Promise<void>
): Promise<"already-liked" | "liked"> {
  const unliked = button.locator(UNLIKED_ICON).first();
  const liked = button.locator(LIKED_ICON).first();
  // ROOM initially renders an outline before loading the signed-in like state.
  await settle();
  if (await liked.isVisible()) return "already-liked";
  if (!(await unliked.isVisible())) throw new Error("いいね状態を確認できません");
  await button.scrollIntoViewIfNeeded();
  await settle();
  // Re-check immediately before the click, after scrolling/lazy hydration.
  if (await liked.isVisible()) return "already-liked";
  if (!(await unliked.isVisible())) throw new Error("いいね状態が変わりました。操作を停止します");
  await button.click();
  await liked.waitFor({ state: "visible", timeout: 15000 }).catch(() => {
    throw new Error("いいね結果が不明です。再クリックせず停止します");
  });
  await settle();
  if (!(await liked.isVisible())) throw new Error("いいね状態が維持されませんでした。成功として数えません");
  return "liked";
}
