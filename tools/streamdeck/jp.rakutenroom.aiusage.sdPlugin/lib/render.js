"use strict";
/**
 * キー画像（SVG）の生成。写真のレイアウトを再現する:
 *   1行目: プロバイダ名（アクセント色）
 *   2行目: 枠の種類（週間・残り / 5時間・残り）
 *   3行目: 残り％（大きく）
 *   4行目: リセット（日本時間）
 *   5行目: リセット日時 MM/DD HH:MM
 */

const { formatJstShort } = require("./jst");

const SIZE = 144; // 72px キーの 2x。Stream Deck 側で縮小される

const ACCENTS = {
  codex: "#2ee6d6",
  claude: "#5aa9ff",
  claude_opus: "#c48bff",
};

const WINDOW_LABELS = {
  ja: { "5h": "5時間・残り", weekly: "週間・残り", weekly_opus: "週間Opus・残り" },
  en: { "5h": "5H LEFT", weekly: "WEEKLY LEFT", weekly_opus: "WEEKLY OPUS" },
};

const RESET_LABELS = { ja: "リセット（日本時間）", en: "RESET (JST)" };
const ERROR_LABELS = { ja: "取得失敗", en: "NO DATA" };

// 日本語グリフを持つフォントを OS 横断で指定（Stream Deck の SVG 描画に渡す）
const FONT =
  "'Hiragino Sans','Yu Gothic UI','Yu Gothic','Meiryo','Noto Sans CJK JP','Noto Sans JP','Segoe UI',sans-serif";

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);
}

/** 残量に応じた文字色（少ないほど警告色） */
function valueColor(percent) {
  if (percent == null) return "#7c8b9a";
  if (percent <= 10) return "#ff5f5f";
  if (percent <= 30) return "#ffb020";
  return "#ffffff";
}

/** 文字数に応じてタイトルを縮小し、キー内に収める */
function titleFontSize(label) {
  const len = [...String(label)].length;
  if (len <= 6) return 18;
  if (len <= 9) return 15;
  if (len <= 12) return 12;
  return 10;
}

function text(x, y, content, { size, fill, weight = "400", spacing = 0, opacity = 1 }) {
  return (
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" ` +
    `font-weight="${weight}" fill="${fill}" letter-spacing="${spacing}" opacity="${opacity}">${escapeXml(content)}</text>`
  );
}

/**
 * @param {{provider?: string, label: string, window: string, remainingPercent: number|null,
 *          resetAt: Date|null, lang?: "ja"|"en", accent?: string, error?: string|null,
 *          stale?: boolean}} options
 */
function renderKeySvg(options) {
  const lang = options.lang === "en" ? "en" : "ja";
  const accent = options.accent || ACCENTS[options.provider] || "#5aa9ff";
  const percent = typeof options.remainingPercent === "number" ? Math.round(options.remainingPercent) : null;
  const windowLabel = (WINDOW_LABELS[lang] || WINDOW_LABELS.ja)[options.window] || options.window;
  const value = percent == null ? "--%" : `${percent}%`;
  const resetLine = options.resetAt ? formatJstShort(options.resetAt) : "--/-- --:--";
  const subLine = percent == null ? ERROR_LABELS[lang] : RESET_LABELS[lang];

  // 残量バー（下端）。写真には無いが状態が一目で分かるよう控えめに入れる
  const barWidth = percent == null ? 0 : Math.max(2, Math.round((percent / 100) * 108));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="#141b23"/><stop offset="1" stop-color="#05080c"/></linearGradient></defs>`,
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="20" fill="url(#bg)"/>`,
    `<rect x="1.5" y="1.5" width="${SIZE - 3}" height="${SIZE - 3}" rx="19" fill="none" stroke="${accent}" stroke-opacity="${
      options.stale ? 0.25 : 0.6
    }" stroke-width="3"/>`,
    text(72, 30, options.label, { size: titleFontSize(options.label), fill: accent, weight: "700", spacing: 0.5 }),
    text(72, 49, windowLabel, { size: 13, fill: "#a7b6c4", weight: "500" }),
    text(72, 91, value, { size: 40, fill: valueColor(percent), weight: "700", spacing: -1 }),
    text(72, 109, subLine, { size: 10, fill: "#79899a", weight: "400" }),
    text(72, 127, resetLine, { size: 15, fill: "#e7eff7", weight: "600" }),
    `<rect x="18" y="134" width="108" height="3" rx="1.5" fill="#23303c"/>`,
    barWidth ? `<rect x="18" y="134" width="${barWidth}" height="3" rx="1.5" fill="${accent}"/>` : "",
    options.stale ? `<circle cx="132" cy="12" r="4" fill="#ffb020"/>` : "",
    `</svg>`,
  ].join("");
}

/** Stream Deck の setImage 用 data URI */
function toDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

module.exports = { SIZE, ACCENTS, WINDOW_LABELS, RESET_LABELS, escapeXml, valueColor, renderKeySvg, toDataUri };
