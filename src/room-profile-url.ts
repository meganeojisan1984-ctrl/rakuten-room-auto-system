/** Ensure social post links always lead to a Rakuten ROOM profile's item list. */
export const DEFAULT_ROOM_PROFILE_URL = "https://room.rakuten.co.jp/room_sho_qoltime/items";

export function toRoomItemsUrl(profileUrl: string): string {
  const url = new URL(profileUrl.trim());
  if (url.protocol !== "https:" || url.hostname !== "room.rakuten.co.jp") {
    throw new Error("ROOM_PROFILE_URL must be an HTTPS Rakuten ROOM URL");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!/^\/room_[a-z0-9_-]+(?:\/items)?$/i.test(pathname)) {
    throw new Error("ROOM_PROFILE_URL must point to a Rakuten ROOM profile");
  }
  url.pathname = /\/items$/i.test(pathname) ? pathname : `${pathname}/items`;
  return url.toString();
}
