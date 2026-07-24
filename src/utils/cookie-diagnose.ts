import { createAuthenticatedContext, validateSession } from "../session";
import { notifyCookieExpired } from "../notifiers";

async function diagnoseRoomCookie(): Promise<boolean> {
  const { browser, context } = await createAuthenticatedContext(true);
  try {
    const ok = await validateSession(context);
    console.log(`[diagnose] ROOM_COOKIE: ${ok ? "valid" : "INVALID"}`);
    if (!ok) {
      await notifyCookieExpired();
    }
    return ok;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  const roomOk = await diagnoseRoomCookie();
  // 将来 Phase 1 で diagnoseAffiliateCookie() を追加する
  process.exit(roomOk ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("[diagnose] fatal:", err);
  process.exit(2);
});
