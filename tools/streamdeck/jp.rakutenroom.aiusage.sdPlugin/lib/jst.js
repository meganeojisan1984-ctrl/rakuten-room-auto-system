"use strict";
/**
 * 日本時間（JST = UTC+9 固定・サマータイムなし）の整形ユーティリティ。
 * Stream Deck 同梱 Node の ICU 有無に依存しないよう Intl を使わず自前計算する。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** @param {Date} date */
function toJstParts(date) {
  const d = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const pad2 = (n) => String(n).padStart(2, "0");

/** 写真と同じ "09/24 18:17" 形式（日本時間） */
function formatJstShort(date) {
  const p = toJstParts(date);
  return `${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "2日3時間" / "4時間12分" / "37分" のような残り時間表記 */
function formatRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0分";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return `${days}日${hours}時間`;
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}分`;
}

module.exports = { JST_OFFSET_MS, toJstParts, formatJstShort, formatRemaining };
