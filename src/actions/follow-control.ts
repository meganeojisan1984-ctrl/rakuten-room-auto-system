import type { Page } from "playwright";

// Exact labels exclude the profile's separate follower/following count buttons.
export const FOLLOW_BUTTON_NAME = /^(フォロー|フォローする)$/;
export const FOLLOWING_BUTTON_NAME = /^フォロー中$/;

export async function confirmFollow(
  page: Pick<Page, "getByRole">,
  beforeClick: () => Promise<void> = async () => {}
): Promise<"already-following" | "followed"> {
  const follow = page.getByRole("button", { name: FOLLOW_BUTTON_NAME }).first();
  const following = page.getByRole("button", { name: FOLLOWING_BUTTON_NAME }).first();

  // A missing control is not evidence that this account is already followed.
  await Promise.any([
    follow.waitFor({ state: "visible", timeout: 15000 }),
    following.waitFor({ state: "visible", timeout: 15000 }),
  ]).catch(() => { throw new Error("フォロー状態を確認できません。DBには記録しません。"); });

  if (await following.isVisible()) return "already-following";
  await beforeClick();
  await follow.scrollIntoViewIfNeeded();
  // Click once only. A timeout can mean the request succeeded remotely.
  await follow.click();
  await following.waitFor({ state: "visible", timeout: 15000 }).catch(() => {
    throw new Error("フォロー結果が不明です。再クリックせず停止し、DBには記録しません。");
  });
  return "followed";
}
