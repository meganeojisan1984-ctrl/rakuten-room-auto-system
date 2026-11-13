import type { BrowserContext } from "playwright";

const ROOM_ORIGIN = "https://room.rakuten.co.jp";

/** Only an explicit ROOM profile is an account identity. /my is a public user. */
export function canonicalRoomProfileUrl(value: string): string {
  const url = new URL(value);
  const match = url.pathname.match(/^\/(room_[A-Za-z0-9_-]+)(?:\/items)?\/?$/);
  if (url.origin !== ROOM_ORIGIN || url.username || url.password || url.search || url.hash || !match) {
    throw new Error("ROOM_EXPECTED_ACCOUNT_INVALID");
  }
  return `${ROOM_ORIGIN}/${match[1]}/items`;
}

export function configuredRoomProfileUrl(env: NodeJS.ProcessEnv = process.env): string {
  return canonicalRoomProfileUrl(env.ROOM_PROFILE_URL || `${ROOM_ORIGIN}/${env.OWN_ROOM_ID || "room_sho_qoltime"}/items`);
}

/** Fixed diagnostic codes only: never leak cookies, redirects, or page content. */
export function roomAccountFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^ROOM_ACCOUNT_NOT_VERIFIED:[a-z_-]+$/.test(message) ? message : "ROOM_ACCOUNT_NOT_VERIFIED:configuration_or_context";
}

/** Require the signed-in header's own visible link to identify the exact user. */
export async function assertRoomAccount(context: Pick<BrowserContext, "newPage">, expectedProfileUrl: string): Promise<void> {
  const expected = canonicalRoomProfileUrl(expectedProfileUrl);
  const probe = await context.newPage();
  let stage = "profile_navigation";
  try {
    const response = await probe.goto(expected, { waitUntil: "domcontentloaded", timeout: 30000 });
    stage = "profile_response";
    if (response && !response.ok()) throw new Error("ROOM_ACCOUNT_PAGE_FAILED");
    stage = "profile_location";
    if (canonicalRoomProfileUrl(probe.url()) !== expected) throw new Error("ROOM_ACCOUNT_PAGE_MISMATCH");
    const mine = probe.getByRole("link", { name: "my ROOM", exact: true });
    stage = "account_header_visibility";
    await mine.waitFor({ state: "visible", timeout: 15000 });
    stage = "account_header_uniqueness";
    if (await mine.count() !== 1 || !await mine.isVisible()) throw new Error("ROOM_ACCOUNT_LINK_AMBIGUOUS");
    stage = "account_header_identity";
    const href = await mine.getAttribute("href");
    if (!href || canonicalRoomProfileUrl(new URL(href, probe.url()).href) !== expected) {
      throw new Error("ROOM_ACCOUNT_MISMATCH");
    }
  } catch {
    throw new Error(`ROOM_ACCOUNT_NOT_VERIFIED:${stage}`);
  } finally {
    await probe.close();
  }
}
