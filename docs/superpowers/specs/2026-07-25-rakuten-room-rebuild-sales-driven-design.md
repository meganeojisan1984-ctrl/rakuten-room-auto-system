# 楽天ROOM自動化システム 再構築設計 — 実売駆動 × Instagram 特化ペルソナ

作成: 2026-07-25
対象リポジトリ: `E:\rakuten-room-auto-system`
主対応者: meganeojisan1984

---

## 1. 背景と現状診断

### 1.1 症状
- 実売が伸びない: `sales_reports.json` は 2026-07 に手入力1件（合計約 ¥694）のみ。学習ループを10世代回しているが売上は横ばい。
- GitHub Actions が赤い: `auto-post.yml` / `auto-learn.yml` などが定期的に失敗。ログは Discord に届いていない。
- 投稿ジャンルが分散: `post_history.json` 48件は16ジャンル横断で「◯◯の人」認識が育たない。

### 1.2 根本原因
1. **学習ループの正解ラベルが「いいね数」**。commander は `strategy.json` を likes ベースで更新するが、likes と affiliate reward は相関していない。事実上、目隠しで最適化している。
2. **実売データが1本もフィードバックされていない**。scout → poster の投稿ループが自身の成果を認識できない。
3. **楽天ROOMのシャドーバン圏**: 5投稿/日 × 単発商品貼付 × 定型文は自動判定されやすい典型パターン。
4. **cold audience への配信**: IG/Threads クロス投稿は promoter が `ok: true` を返しても実クリックが不明。フォロワー基盤がないため到達数がゼロに近い。
5. **git push の失敗握り潰し**: 各ワークフローの `git push || true` により競合エラーが sink されている。手前で `npx tsx src/main.ts` 自体がコケた場合のみ Actions が赤くなる（Cookie失効 / Rakuten UI変化 / Playwright timeout）。

## 2. 目的（この再構築で達成すること）

- **G1**: 学習ループの正解ラベルを likes → 実売スコア（reward + click）に差し替える
- **G2**: 楽天アフィリエイト管理画面から日次で実売データを取得し永続化する
- **G3**: 主戦場を Instagram に一本化し、価格帯を分散した 3 候補ペルソナで並行A/B投稿する
- **G4**: 2週間の実売データに基づき勝者ペルソナを自動選択し、投稿頻度を勝者へ集中させる
- **G5**: GitHub Actions を安定化し、失敗を必ず可視化する
- **非目標**: 楽天ROOMの完全撤退 / 新アフィリエイトサービスへの乗り換え / スマホアプリ化

## 3. 決定事項（ブレインストーミングの結論）

| 論点 | 決定 |
|---|---|
| 実売データ取得方法 | 楽天アフィリエイト管理画面 (`affiliate.rakuten.co.jp`) を Cookie ログインで Playwright スクレイピング |
| 主戦場 SNS | Instagram（Threads は Phase 4 まで停止、ROOM は減量継続） |
| 実体験ネタの供給 | 全て AI 生成（画像=Gemini、文=LLM）。マスコットや自撮り無し |
| ペルソナ候補の決め方 | 価格帯を分散した3スロット（低単価高回転 / 中単価 / 高単価） |
| 勝者選定期間 | 2週間 |

## 4. 3候補ペルソナ（初期スロット）

これらは**データに基づく勝者ではなく、価格帯・購買動機の異なる3仮説**である。2週間の実売で優劣を決める。

| slot | ペルソナ名 | 想定価格帯 | ターゲットジャンル例 | IG投稿の切り口 | trackingId |
|---|---|---|---|---|---|
| 0 | **毎月これ買ってる（消耗品リピート）** | ¥500–2,000 | 洗剤・入浴剤・食品ストック・キッチン消耗品 | 「毎月◯本消える定番」「もう他戻れない」 | `slot0-consume` |
| 1 | **一人暮らしQOL上げる家電** | ¥2,000–8,000 | 節約家電・時短ガジェット・生活雑貨 | 「¥3980で生活変わった」「早く買えばよかった」 | `slot1-qol` |
| 2 | **ふるさと納税で得する家計** | ¥10,000–30,000 | 返礼品ランキング上位（肉・海鮮・米・雑貨） | 「還元率◯%」「実質2000円で◯kg」 | `slot2-furusato` |

各スロットは独立した口調・世界観・#タグセット・IGカルーセルデザインを持つ。DB は共通。

## 5. アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ [日次 02:00 JST]                                             │
│   affiliate/sales-scraper.ts                                 │
│     ↓ Playwright + Cookie                                    │
│   affiliate.rakuten.co.jp/rp/mypage/report/               │
│     ↓ CSV/DOM extract                                        │
│   data/sales.sqlite (item×date×click×order×reward)          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ [08/13/21 JST] scout(mode=3-slot, slot=時刻でローテ)          │
│   → 選択されたスロットの genreWeights + trackingId で選定     │
│   → copywriter(persona=slot)                                 │
│   → ig-post-engine(persona=slot)  → Instagram (毎回1本)      │
│   → poster: 1日のうち IG 3本のうち上位2本を楽天ROOM にも展開  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ [23:45 JST] learner (旧: 学習ループ)                          │
│   metrics: 実売DB を JOIN → 各投稿の 24h/7d 実績              │
│   analyst: 4P軸に加え persona-slot 軸で集計                    │
│   commander: sales_score = reward*0.7 + click*0.3            │
│              → strategy.json 第N+1世代                        │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ [2週間ごと 日曜 03:00 JST] evaluator                          │
│   3スロットの累積 reward + roi 比較                           │
│   → persona.activeSlot に勝者を書き込み                       │
│   → 以降 scout は勝者スロット中心に投稿                        │
└─────────────────────────────────────────────────────────────┘
```

## 6. コンポーネント設計

### 6.1 新規モジュール

| モジュール | 責務 | 依存 |
|---|---|---|
| `src/affiliate/sales-scraper.ts` | 楽天アフィリ管理画面を Cookie ログインで巡回し、レポート表を取得 | Playwright, `RAKUTEN_AFFILIATE_COOKIE` (新Secret) |
| `src/affiliate/sales-db.ts` | SQLite (`data/sales.sqlite`) の CRUD。`sales` テーブル: `date, itemCode, trackingId, clicks, orders, reward` | better-sqlite3 |
| `src/persona/persona.ts` | 3スロット定義 + `activeSlot` 管理。JSON: `persona.json` | — |
| `src/ig/ig-post-engine.ts` | ペルソナ準拠 IG 投稿生成（画像+キャプション+固定CTA） | Gemini API, IG Graph API, persona |
| `src/agents/evaluator.ts` | 2週間の slot 別 sales_score を集計 → 勝者を persona.activeSlot に書く | sales-db, persona |
| `src/utils/git-safety.ts` | ワークフロー内 push のリトライ (最大3回、指数バックオフ) | — |
| `src/utils/rakuten-tracking.ts` | trackingId を slot に応じて商品URLに付与 | — |

### 6.2 改修モジュール

| モジュール | 変更内容 |
|---|---|
| `src/agents/scout.ts` | 3スロット並行モードを追加。`persona.activeSlot === 'multi'` の間は 3スロットを均等に、勝者確定後は勝者に集中 |
| `src/agents/copywriter.ts` | プロンプトにペルソナの口調・世界観・NGワードを注入 |
| `src/agents/commander.ts` | 正解ラベルを likes → sales_score に切替。世代番号は継続、`strategy.json` に `sales_gen: true` フラグ追加。likes は補助指標として保持のみ |
| `src/agents/metrics.ts` | 自ROOM likes 取得は残しつつ、実売DBの JOIN 集計を追加 |
| `src/actions/auto_post.ts` | 楽天ROOM 投稿を 1日5→2件に削減。IG に出した3本のうち前日の click 実績上位2本を選び ROOM にも展開 |
| `src/sns.ts` | Threads クロス投稿を停止（Phase 4 まで無効化）。IG は ig-post-engine に委譲 |

### 6.3 削除・停止モジュール

| モジュール | 判断 |
|---|---|
| `src/actions/auto_followback.ts` | Phase 0 で停止（実売寄与測定不可） |
| `src/trend-fetcher.ts` | Phase 0 で停止（scout の新モードに包含） |
| X投稿系 (`X_API_*`) | Phase 0 で無効化。将来 Phase 5 で復活検討 |

## 7. データモデル

### 7.1 `data/sales.sqlite`

```sql
CREATE TABLE sales (
  date        TEXT NOT NULL,           -- YYYY-MM-DD
  item_code   TEXT NOT NULL,
  tracking_id TEXT NOT NULL,           -- slot0-consume / slot1-qol / slot2-furusato
  clicks      INTEGER NOT NULL DEFAULT 0,
  orders      INTEGER NOT NULL DEFAULT 0,
  reward      INTEGER NOT NULL DEFAULT 0,  -- 円
  scraped_at  TEXT NOT NULL,
  PRIMARY KEY (date, item_code, tracking_id)
);
CREATE INDEX idx_sales_date ON sales(date);
CREATE INDEX idx_sales_slot ON sales(tracking_id);
```

### 7.2 `persona.json`

```json
{
  "activeSlot": "multi",           // 'multi' | 'slot0' | 'slot1' | 'slot2'
  "evaluationWindow": 14,          // 日数
  "evaluationStartedAt": "2026-07-27T00:00:00Z",
  "slots": {
    "slot0": {
      "name": "毎月これ買ってる",
      "priceBand": [500, 2000],
      "trackingId": "slot0-consume",
      "genres": ["キッチン消耗品・日用品", "生活必需品・補充消耗品"],
      "tone": "…",
      "hashtags": ["#毎月これ買ってる", "#楽天ROOM", "#買ってよかった"],
      "ngWords": ["最安", "激安"],
      "ctaLine": "定番はプロフのリンクから"
    },
    "slot1": { "name": "一人暮らしQOL上げる家電", "priceBand": [2000, 8000], "trackingId": "slot1-qol", "genres": [...], "tone": "...", "hashtags": [...], "ngWords": [...], "ctaLine": "..." },
    "slot2": { "name": "ふるさと納税で得する家計", "priceBand": [10000, 30000], "trackingId": "slot2-furusato", "genres": [...], "tone": "...", "hashtags": [...], "ngWords": [...], "ctaLine": "..." }
  }
}
```

### 7.3 `strategy.json` （既存を拡張）

- 追加: `salesGen: true`, `activeSlot: string`, `slotWeights: { slot0: number, slot1: number, slot2: number }`
- 既存の `genreWeights` は slot 内でスコープ化: `slotGenreWeights: { slot0: {...}, slot1: {...}, slot2: {...} }`

## 8. GitHub Actions 安定化

### 8.1 直列化

全ての「main へ書き込むジョブ」に `concurrency` を付与:

```yaml
concurrency:
  group: main-writer
  cancel-in-progress: false
```

対象: `auto-post.yml`, `auto-learn.yml`, `auto-like.yml`, `auto-follow.yml`, `auto-delete.yml`, `sales-scrape.yml`（新規）, `evaluate-persona.yml`（新規）

### 8.2 push リトライ

`git push || true` を廃止し、`tools/safe-push.sh` に差し替え:

```bash
for i in 1 2 3; do
  git pull --rebase --autostash origin main && git push && exit 0
  sleep $((i * 5))
done
echo "::error::push failed after 3 retries"
exit 1
```

失敗時はジョブが赤くなり、Discord にも通知される。

### 8.3 通知の必達

`src/notifiers.ts` を経由するエラー通知を、以下タイミングで**必ず**呼ぶ:
- Cookie 失効検知（ROOM / affiliate 双方）
- Playwright timeout / navigation error
- スクレイピング結果 0 行（レポートページの構造変化サイン）
- push リトライ失敗

## 9. ロールアウト計画

| Phase | 期間 | 内容 | 完了判定 |
|---|---|---|---|
| **P0** | Day 0（当日） | git-safety, concurrency, Discord 通知修復, Cookie診断コマンド, 停止対象モジュールの無効化 | Actions が緑で安定、失敗時に必ず Discord 通知 |
| **P1** | Day 1–3 | sales-scraper, sales-db, trackingId 付与, `RAKUTEN_AFFILIATE_COOKIE` Secret 追加 | 実売データが SQLite に3日分入る |
| **P2** | Day 4–7 | persona.json, ig-post-engine, scout 3スロット並行モード, ROOM投稿削減 | IG に3スロット × 1本/日 の投稿が回る |
| **P3** | Day 8–14 | commander の sales_score 切替, analyst 拡張, metrics JOIN。データが薄い日は likes ベースへ自動フォールバック | strategy.json が sales_score で更新される（データ0件の日は fallback ログ） |
| **P4** | Day 15–（2週間経過） | evaluator が勝者を確定, scout が勝者中心に切替 | persona.activeSlot が slotN に固定される |

各 Phase は独立してマージ可能。Phase を跨ぐ依存は明示する。

## 10. エラーハンドリング方針

- **Cookie 失効（affiliate）**: sales-scraper が特定 selector を検出できなかった場合、Discord に「ROOM_AFFILIATE_COOKIE 更新要求」を送信し、以降の scrape ジョブは skip
- **DB 書き込み競合**: SQLite は WAL モード。scrape ジョブは concurrency: sales-writer で直列化
- **持続的な 0 件抽出**: 3日連続で 0件なら commander は sales_gen を一時的にオフにし、旧 likes ベースにフォールバック（暴走防止）
- **勝者選定の不確実性**: 3スロット合計 reward が ¥3000 未満なら evaluation window を +14日 延長

## 11. YAGNI で削るもの / 将来検討

削除:
- Threads 投稿 (Phase 4 まで停止)
- X 投稿 (Phase 5 復活検討)
- auto_followback
- trend-fetcher

将来検討（本 spec の範囲外）:
- LINE 公式アカウントへの誘導
- ふるさと納税の特化サイト連携
- Instagram Reels 動画自動生成（既存 insta_studio との統合）

## 12. 必要な新規 Secret / Vars

| 名前 | 種別 | 用途 |
|---|---|---|
| `RAKUTEN_AFFILIATE_COOKIE` | Secret | affiliate.rakuten.co.jp のログイン Cookie |
| `RAKUTEN_AFFILIATE_URL` | Secret | 直リンクLPのbase URL（trackingId差し替え可） |
| `PERSONA_EVAL_WINDOW_DAYS` | Vars | 勝者選定期間（既定14） |

## 13. 成功指標（KPI）

- P1 完了時: 実売データが3日連続で取得される（0件でも「取得成功」と判定）
- P2 完了時: 3スロット × 少なくとも週20投稿が Instagram に届いている
- P3 完了時: strategy.json の sales_gen フラグが立ち、commander の判断が sales_score 由来である
- P4 完了時: 勝者スロットの日次 reward が P0 時点比 3倍以上

## 14. リスクと緩和

| リスク | 緩和策 |
|---|---|
| 楽天アフィリ側の Cookie 認証仕様変更 | scrape 失敗時は Discord 即通知 + 手動 Cookie 再取得手順を README に追記 |
| Instagram Graph API のレート制限 | 1日3投稿を上限、ig-post-engine 内で 30秒間隔スリープ |
| 勝者ペルソナがどれも赤字 | evaluator が全 slot < ¥3000/2週間 なら stop-loss を発動し、3候補を差し替える提案を Discord に送る |
| Playwright headless の楽天側検知 | User-Agent と viewport をリアル寄りに設定、実行間隔を jitter で分散 |
