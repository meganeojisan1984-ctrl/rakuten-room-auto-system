/**
 * sheets.ts - Googleスプレッドシート連携 & 出力整形
 *
 * - 案件ごとに新しいタブ（シート）を作成し、全フローの成果物を書き込む
 * - X投稿/固定ポスト/教育投稿は「コピペ用」列＋ChatGPT画像プロンプト列で並べる
 * - 重複防止用の _dedup タブに過去の投稿テキストを蓄積し、次回生成時に渡す
 * - サービスアカウント未設定時は data/affiliate/output/ にJSON＋テキストを出力（フォールバック）
 */
import fs from "fs";
import path from "path";
import type { CampaignResult } from "./types";

const SHEET_ID = process.env.AFFILIATE_SHEET_ID ?? "";
const DEDUP_TAB = "_dedup";
const INDEX_TAB = "_index";
const OUTPUT_DIR = path.join(process.cwd(), "data", "affiliate", "output");

type Matrix = (string | number)[][];

// ──────────────────────────────────────────────
// Google認証クライアント（googleapis）
// ──────────────────────────────────────────────
interface SheetsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any;
  spreadsheetId: string;
}

function loadCredentials(): Record<string, unknown> | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim().startsWith("{")) {
    try {
      return JSON.parse(json);
    } catch {
      console.warn("[sheets] GOOGLE_SERVICE_ACCOUNT_JSON のパースに失敗");
    }
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file && fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      console.warn("[sheets] 認証ファイルのパースに失敗:", file);
    }
  }
  return null;
}

export function isSheetsConfigured(): boolean {
  return SHEET_ID.length > 0 && loadCredentials() !== null;
}

async function getClient(): Promise<SheetsClient | null> {
  if (!isSheetsConfigured()) return null;
  try {
    // 遅延 import（googleapis 未インストールでも他機能を壊さない）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { google } = require("googleapis");
    const credentials = loadCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials: credentials as object,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const api = google.sheets({ version: "v4", auth });
    return { api, spreadsheetId: SHEET_ID };
  } catch (err) {
    console.warn("[sheets] googleapis の初期化に失敗:", String(err).slice(0, 160));
    return null;
  }
}

// ──────────────────────────────────────────────
// 低レベル操作
// ──────────────────────────────────────────────
async function listTabs(c: SheetsClient): Promise<string[]> {
  const res = await c.api.spreadsheets.get({ spreadsheetId: c.spreadsheetId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.sheets ?? []).map((s: any) => s.properties?.title as string).filter(Boolean);
}

async function ensureTab(c: SheetsClient, title: string): Promise<void> {
  const tabs = await listTabs(c);
  if (tabs.includes(title)) return;
  await c.api.spreadsheets.batchUpdate({
    spreadsheetId: c.spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
}

/** 一意なタブ名を作る（同名があれば連番付与） */
async function uniqueTabName(c: SheetsClient, base: string): Promise<string> {
  const tabs = await listTabs(c);
  const safe = base.replace(/[\[\]:*?/\\]/g, "").slice(0, 80) || "案件";
  if (!tabs.includes(safe)) return safe;
  let i = 2;
  while (tabs.includes(`${safe}_${i}`)) i++;
  return `${safe}_${i}`;
}

async function writeMatrix(c: SheetsClient, tab: string, rows: Matrix): Promise<void> {
  await c.api.spreadsheets.values.update({
    spreadsheetId: c.spreadsheetId,
    range: `'${tab}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

async function appendRows(c: SheetsClient, tab: string, rows: Matrix): Promise<void> {
  if (rows.length === 0) return;
  await c.api.spreadsheets.values.append({
    spreadsheetId: c.spreadsheetId,
    range: `'${tab}'!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

async function readColumnA(c: SheetsClient, tab: string): Promise<string[]> {
  try {
    const res = await c.api.spreadsheets.values.get({
      spreadsheetId: c.spreadsheetId,
      range: `'${tab}'!A:A`,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (res.data.values ?? []).map((r: any[]) => String(r[0] ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// 重複防止: 既出投稿テキストの取得 / 蓄積
// ──────────────────────────────────────────────
export async function getExistingPosts(): Promise<string[]> {
  const c = await getClient();
  if (c) {
    await ensureTab(c, DEDUP_TAB);
    return readColumnA(c, DEDUP_TAB);
  }
  // ローカルフォールバック
  const f = path.join(OUTPUT_DIR, "_dedup.json");
  if (fs.existsSync(f)) {
    try {
      return JSON.parse(fs.readFileSync(f, "utf-8")) as string[];
    } catch {
      return [];
    }
  }
  return [];
}

async function recordPosts(texts: string[]): Promise<void> {
  const clean = texts.filter(Boolean);
  if (clean.length === 0) return;
  const c = await getClient();
  if (c) {
    await ensureTab(c, DEDUP_TAB);
    await appendRows(c, DEDUP_TAB, clean.map((t) => [t]));
    return;
  }
  ensureOutputDir();
  const f = path.join(OUTPUT_DIR, "_dedup.json");
  let existing: string[] = [];
  if (fs.existsSync(f)) {
    try {
      existing = JSON.parse(fs.readFileSync(f, "utf-8")) as string[];
    } catch {
      existing = [];
    }
  }
  fs.writeFileSync(f, JSON.stringify([...existing, ...clean], null, 2), "utf-8");
}

// ──────────────────────────────────────────────
// CampaignResult → 行列（スプレッドシートのレイアウト）
// ──────────────────────────────────────────────
function buildRows(r: CampaignResult): Matrix {
  const rows: Matrix = [];
  const blank = (): void => void rows.push([""]);
  const section = (title: string, header: string[]): void => {
    blank();
    rows.push([`■ ${title}`]);
    rows.push(header);
  };

  // ヘッダー情報
  rows.push([`案件: ${r.offer.name}`]);
  rows.push([`生成日時: ${r.generatedAt}`]);
  rows.push([`指揮官 総合評価: 信憑性 ${r.overallCredibility} / 完成度 ${r.overallCompleteness}`]);
  rows.push([`指揮官 総合所見:`, r.commanderSummary]);
  rows.push([`選定ジャンル:`, r.genres.items.find((g) => g.fitScore)?.genre ?? r.profile.genre]);
  rows.push([`選定ターゲット:`, r.targets.items[0]?.name ?? ""]);
  rows.push([`選定コンセプト:`, r.concepts.items[0]?.concept ?? ""]);

  // 使い方メモ
  blank();
  rows.push(["【使い方】 Xへの投稿は手動です。下の『投稿文』をコピーしてXに貼り付け、『画像プロンプト』をChatGPTに貼って画像を作成してください。"]);

  // フロー1
  section(`①ジャンル候補（${r.genres.items.length}件 / 信憑性${r.genres.review.credibility}・完成度${r.genres.review.completeness}）`,
    ["No", "適合度", "ジャンル", "ターゲット", "悩み", "面談に行きたくなる理由", "Xで伸びるテーマ", "売れる訴求", "注意点"]);
  r.genres.items.forEach((g, i) =>
    rows.push([i + 1, g.fitScore ?? "", g.genre, g.target, g.pain, g.consultReason, g.xTheme, g.appeal, g.caution]));

  // フロー2
  section(`②ターゲット候補（${r.targets.items.length}件 / 信憑性${r.targets.review.credibility}・完成度${r.targets.review.completeness}）`,
    ["No", "適合度", "ターゲット名", "年齢層", "現在の悩み", "理想の未来", "なぜ今すぐ", "刺さる言葉", "刺さらない言葉", "面談誘導の切り口"]);
  r.targets.items.forEach((t, i) =>
    rows.push([i + 1, t.fitScore ?? "", t.name, t.ageRange, t.pain, t.idealFuture, t.whyNow, t.hitWords, t.missWords, t.consultHook]));

  // フロー3
  section(`③アカウントコンセプト（${r.concepts.items.length}件 / 信憑性${r.concepts.review.credibility}・完成度${r.concepts.review.completeness}）`,
    ["No", "適合度", "コンセプト", "プロフィール文", "発信テーマ", "刺さるターゲット", "固定ポスト方向性", "面談への導線", "差別化"]);
  r.concepts.items.forEach((c, i) =>
    rows.push([i + 1, c.fitScore ?? "", c.concept, c.profileText, c.theme, c.audience, c.pinnedDirection, c.consultFunnel, c.differentiation]));

  // フロー4（コピペ用）
  section(`④見込み客を集めるX投稿（${r.collectPosts.items.length}件 / 信憑性${r.collectPosts.review.credibility}・完成度${r.collectPosts.review.completeness}・具体性${r.collectPosts.review.valueConcreteness}）`,
    ["No", "型", "投稿文（コピペ用）", "狙う心理", "面談につながる理由", "画像プロンプト（ChatGPT用）", "投稿状況"]);
  r.collectPosts.items.forEach((p, i) =>
    rows.push([i + 1, p.type, p.text, p.psychology, p.consultLink, p.imagePrompt ?? "", "未投稿"]));

  // フロー5（コピペ用）
  section(`⑤無料面談へ誘導する固定ポスト（${r.pinnedPosts.items.length}件）`,
    ["No", "固定ポスト本文（コピペ用）", "冒頭の狙い", "刺さるターゲット", "誘導できる理由", "改善ポイント", "画像プロンプト（ChatGPT用）", "投稿状況"]);
  r.pinnedPosts.items.forEach((p, i) =>
    rows.push([i + 1, p.text, p.openingAim, p.audience, p.consultReason, p.improvement, p.imagePrompt ?? "", "未投稿"]));

  // フロー6
  section(`⑥DMで無料面談に誘導（${r.dms.items.length}件）`, ["段階", "DM文（コピペ用）"]);
  r.dms.items.forEach((d) => rows.push([d.stage, d.text]));

  // フロー7（コピペ用）
  section(`⑦教育投稿（${r.educationPosts.items.length}件）`,
    ["No", "型", "投稿文（コピペ用）", "投稿の狙い", "起こしたい感情", "面談へのつなげ方", "画像プロンプト（ChatGPT用）", "投稿状況"]);
  r.educationPosts.items.forEach((p, i) =>
    rows.push([i + 1, p.type, p.text, p.aim, p.emotion, p.consultBridge, p.imagePrompt ?? "", "未投稿"]));

  // フロー8
  section("⑧オファー文（改善版）", ["項目", "内容"]);
  const oc = r.offerCopy.items[0];
  if (oc) {
    rows.push(["無料面談の名前", oc.consultName]);
    rows.push(["キャッチコピー", oc.catchCopy]);
    rows.push(["申し込むメリット", oc.applyMerit]);
    rows.push(["申し込まないデメリット", oc.notApplyDemerit]);
    rows.push(["対象者", oc.targetWho]);
    rows.push(["対象外の人", oc.notTargetWho]);
    rows.push(["申込導線の文章（コピペ用）", oc.applyFunnelText]);
    rows.push(["X固定ポスト用 短文（コピペ用）", oc.pinnedShort]);
    rows.push(["DM用 短文（コピペ用）", oc.dmShort]);
    rows.push(["プロフィール用 短文（コピペ用）", oc.profileShort]);
  }

  // フロー9
  section("⑨見込み客 診断ルブリック", ["項目", "内容"]);
  const dg = r.diagnosis.items[0];
  if (dg) {
    rows.push(["見込み度 S/A/B/C 基準", dg.grade]);
    rows.push(["今すぐ面談 / 要教育の見極め", dg.criteria]);
    rows.push(["刺さる訴求", dg.hitAppeal]);
    rows.push(["避けるべき言葉", dg.avoidWords]);
    rows.push(["送るDM文の方針", dg.dmText]);
    rows.push(["最適タイミング", dg.timing]);
    rows.push(["成約可能性の目安", dg.closeProbability]);
    rows.push(["次に取るべきアクション", dg.nextAction]);
  }

  // フロー10
  section(`⑩30日間 X集客ロードマップ（${r.roadmap.items.length}日分）`,
    ["Day", "今日やること", "投稿テーマ", "投稿文の例（コピペ用）", "リプ周り", "DMでやること", "面談への導線", "見るべき数字", "翌日への改善点"]);
  r.roadmap.items.forEach((d) =>
    rows.push([d.day, d.todo, d.postTheme, d.postExample, d.replyStrategy, d.dmTask, d.consultFunnel, d.metricToWatch, d.improvement]));

  // フロー11（長文記事 + X用スレッド・コピペ用）
  blank();
  rows.push([`■ ⑪長文記事（${r.articles.items.length}本 / 具体性${r.articles.review.valueConcreteness}）`]);
  rows.push(["長文はXプレミアム不要。『X用スレッド』を上から順にそのまま連投してください（1ツイート=1行）。note/ブログには『本文』を使用。"]);
  r.articles.items.forEach((a, i) => {
    blank();
    rows.push([`【記事${i + 1}】`, `${a.pattern} / ${a.format}`, `約${a.charCount ?? "-"}字`]);
    rows.push(["タイトル（コピペ用）", a.title]);
    rows.push(["リード", a.lead]);
    rows.push(["カバー画像プロンプト（ChatGPT用）", a.coverImagePrompt ?? ""]);
    rows.push(["note/ブログ本文（コピペ用）", a.body]);
    rows.push(["── X用スレッド（この順に連投）──", "投稿文（コピペ用）"]);
    const n = a.thread.length;
    a.thread.forEach((t, j) => rows.push([`${j + 1}/${n}`, t]));
    rows.push(["CTA（最終ツイート/プロフィール用）", a.cta]);
  });

  return rows;
}

/** 投稿系テキストを収集（重複防止インデックス用） */
function collectPostTexts(r: CampaignResult): string[] {
  return [
    ...r.collectPosts.items.map((p) => p.text),
    ...r.pinnedPosts.items.map((p) => p.text),
    ...r.educationPosts.items.map((p) => p.text),
    ...r.articles.items.map((a) => a.title),
  ].filter(Boolean);
}

// ──────────────────────────────────────────────
// Markdownレポート（スマホのGitHubアプリでそのまま読める形式）
// ──────────────────────────────────────────────
const REPORT_DIR = path.join(process.cwd(), "reports", "affiliate");

export function buildMarkdown(r: CampaignResult): string {
  const L: string[] = [];
  const post = (label: string, text: string, img?: string, extra?: string): void => {
    L.push(`> ${text.replace(/\n/g, "\n> ")}`);
    if (extra) L.push(`\n_${extra}_`);
    if (img) L.push(`\n🖼 画像プロンプト: \`${img}\``);
    L.push("");
  };

  L.push(`# 🎯 ${r.offer.name} — X送客キャンペーン`);
  L.push(`生成: ${r.generatedAt}`);
  L.push(`\n**指揮官 総合評価**: 信憑性 ${r.overallCredibility} / 完成度 ${r.overallCompleteness}`);
  L.push(`\n> ${r.commanderSummary.replace(/\n/g, "\n> ")}`);
  L.push(`\n選定ジャンル: **${r.genres.items.find((g) => g.fitScore)?.genre ?? r.profile.genre}** / 選定ターゲット: **${r.targets.items[0]?.name ?? ""}** / コンセプト: **${r.concepts.items[0]?.concept ?? ""}**`);
  L.push(`\n> 使い方: Xは手動投稿です。各「投稿文」をコピーして投稿し、「画像プロンプト」をChatGPTに貼って画像を作成してください。\n`);

  L.push(`\n## ④ 見込み客を集めるX投稿（${r.collectPosts.items.length}本・具体性${r.collectPosts.review.valueConcreteness}）`);
  r.collectPosts.items.forEach((p, i) => { L.push(`\n### ${i + 1}. [${p.type}]`); post("", p.text, p.imagePrompt, `狙い: ${p.psychology}`); });

  L.push(`\n## ⑤ 固定ポスト（${r.pinnedPosts.items.length}本）`);
  r.pinnedPosts.items.forEach((p, i) => { L.push(`\n### ${i + 1}.`); post("", p.text, p.imagePrompt, p.openingAim); });

  L.push(`\n## ⑥ DM誘導`);
  r.dms.items.forEach((d) => { L.push(`\n**${d.stage}**`); L.push(`> ${d.text.replace(/\n/g, "\n> ")}`); });

  L.push(`\n## ⑦ 教育投稿（${r.educationPosts.items.length}本）`);
  r.educationPosts.items.forEach((p, i) => { L.push(`\n### ${i + 1}. [${p.type}]`); post("", p.text, p.imagePrompt, p.aim); });

  const oc = r.offerCopy.items[0];
  if (oc) {
    L.push(`\n## ⑧ オファー文`);
    L.push(`- **名称**: ${oc.consultName}\n- **キャッチ**: ${oc.catchCopy}\n- **固定用短文**: ${oc.pinnedShort}\n- **DM用短文**: ${oc.dmShort}\n- **プロフ用短文**: ${oc.profileShort}`);
  }

  const dg = r.diagnosis.items[0];
  if (dg) {
    L.push(`\n## ⑨ 見込み客 診断ルブリック`);
    L.push(`- **S/A/B/C基準**: ${dg.grade}\n- **見極め**: ${dg.criteria}\n- **次の行動**: ${dg.nextAction}`);
  }

  L.push(`\n## ⑩ 30日ロードマップ`);
  r.roadmap.items.forEach((d) => L.push(`- **Day${d.day}**: ${d.todo} ｜ 投稿: ${d.postTheme}`));

  L.push(`\n## ⑪ 長文記事（${r.articles.items.length}本）`);
  r.articles.items.forEach((a, i) => {
    L.push(`\n### 記事${i + 1}: ${a.title}  _(${a.pattern} / ${a.format} / 約${a.charCount}字)_`);
    if (a.coverImagePrompt) L.push(`🖼 カバー画像: \`${a.coverImagePrompt}\``);
    L.push(`\n**▼ X用スレッド（この順に連投）**`);
    const n = a.thread.length;
    a.thread.forEach((tw, j) => L.push(`\n**${j + 1}/${n}**\n> ${tw.replace(/\n/g, "\n> ")}`));
    L.push(`\n<details><summary>note/ブログ用 本文</summary>\n\n${a.body}\n\n</details>`);
  });

  return L.join("\n");
}

function writeMarkdown(r: CampaignResult): string {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(REPORT_DIR, `${r.offer.id}-${date}.md`);
  const md = buildMarkdown(r);
  fs.writeFileSync(file, md, "utf-8");
  // GitHubアプリから最新を辿りやすいよう latest も更新
  fs.writeFileSync(path.join(REPORT_DIR, "latest.md"), md, "utf-8");
  return file;
}

// ──────────────────────────────────────────────
// ローカル出力（フォールバック / 常に保存）
// ──────────────────────────────────────────────
function ensureOutputDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function buildPlainText(r: CampaignResult): string {
  const lines: string[] = [];
  for (const row of buildRows(r)) {
    lines.push(row.map((c) => String(c)).join("\t"));
  }
  return lines.join("\n");
}

function writeLocal(r: CampaignResult, tabName: string): string {
  ensureOutputDir();
  const base = `${r.offer.id}-${Date.now()}`;
  const jsonPath = path.join(OUTPUT_DIR, `${base}.json`);
  const txtPath = path.join(OUTPUT_DIR, `${base}.tsv`);
  fs.writeFileSync(jsonPath, JSON.stringify(r, null, 2), "utf-8");
  fs.writeFileSync(txtPath, `# ${tabName}\n${buildPlainText(r)}`, "utf-8");
  return jsonPath;
}

// ──────────────────────────────────────────────
// 公開: 結果をスプレッドシートへ書き出す
// ──────────────────────────────────────────────
export interface WriteResult {
  destination: "google-sheets" | "local";
  tab: string;
  url?: string;
  localPath?: string;
  /** GitHubアプリで読めるMarkdownレポートのパス（常に生成） */
  reportPath?: string;
}

export async function writeCampaign(r: CampaignResult): Promise<WriteResult> {
  const localPath = writeLocal(r, r.offer.name);
  const reportPath = writeMarkdown(r);
  const c = await getClient();

  if (!c) {
    await recordPosts(collectPostTexts(r));
    console.log("[sheets] Google認証が未設定のためローカル＋Markdown出力:", reportPath);
    return { destination: "local", tab: r.offer.name, localPath, reportPath };
  }

  // 案件ごとに新しいタブを作成
  const tab = await uniqueTabName(c, r.offer.name);
  await ensureTab(c, tab);
  await writeMatrix(c, tab, buildRows(r));

  // インデックスタブを更新
  await ensureTab(c, INDEX_TAB);
  await appendRows(c, INDEX_TAB, [[
    r.generatedAt, r.offer.name, tab, r.overallCredibility, r.overallCompleteness,
  ]]);

  // 重複防止インデックスへ投稿を蓄積
  await recordPosts(collectPostTexts(r));

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
  console.log(`[sheets] 書き込み完了: タブ「${tab}」`);
  return { destination: "google-sheets", tab, url, localPath, reportPath };
}
