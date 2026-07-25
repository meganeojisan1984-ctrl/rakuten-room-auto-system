# 楽天ROOM 自動化システム

楽天ROOMの投稿・いいね・フォロー・削除を **GitHub Actionsで完全自動化・完全無料** で動かすシステムです。

> 🎯 **X高単価アフィリエイト送客システム**（指揮官＋10エージェントで投稿文・DM・ロードマップ・画像プロンプトを自動生成し、Googleスプレッドシートの案件ごとのタブに書き込む）も同梱しています。詳細は **[AFFILIATE.md](./AFFILIATE.md)** を参照してください。

---

## 🚀 セットアップ手順

### Step 1: GitHubにリポジトリを作成してプッシュ

```bash
cd E:/rakuten-room-auto-system
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/あなたのID/rakuten-room-auto-system.git
git push -u origin main
```

> ⚠️ **`.gitignore`に`.env`が含まれていることを確認**してください（APIキー等が公開されないように）

---

### Step 2: GitHub Secretsを設定

GitHubのリポジトリページ → **Settings → Secrets and variables → Actions → New repository secret**

| Secret名 | 値 | 説明 |
|---|---|---|
| `ROOM_COOKIE` | `.env`の`ROOM_COOKIE`の値 | 楽天ROOMのCookie（最重要） |
| `RAKUTEN_APP_ID` | `.env`の`RAKUTEN_APP_ID`の値 | 楽天API ID |
| `RAKUTEN_ACCESS_KEY` | `.env`の`RAKUTEN_ACCESS_KEY`の値 | 楽天APIキー |
| `GROQ_API_KEY` | `.env`の`GROQ_API_KEY`の値 | Groq API（紹介文生成） |
| `DISCORD_WEBHOOK_URL` | `.env`の`DISCORD_WEBHOOK_URL`の値 | エラー通知先（任意） |
| `X_API_KEY` | `.env`の`X_API_KEY`の値 | X投稿用（任意） |
| `X_API_SECRET` | `.env`の`X_API_SECRET`の値 | X投稿用（任意） |
| `X_ACCESS_TOKEN` | `.env`の`X_ACCESS_TOKEN`の値 | X投稿用（任意） |
| `X_ACCESS_TOKEN_SECRET` | `.env`の`X_ACCESS_TOKEN_SECRET`の値 | X投稿用（任意） |
| `IG_USER_ID` | InstagramビジネスアカウントID | IGクロス投稿用（任意・[SETUP-SNS.md](SETUP-SNS.md)参照） |
| `IG_ACCESS_TOKEN` | Instagram Graph API 長期トークン | IGクロス投稿用（任意） |
| `THREADS_USER_ID` | ThreadsユーザーID | Threadsクロス投稿用（任意） |
| `THREADS_ACCESS_TOKEN` | Threads API 長期トークン | Threadsクロス投稿用（任意） |
| `ROOM_PROFILE_URL` | 楽天ROOMプロフィールURL | SNSからの誘導先（任意） |

> 📣 **Instagram/Threadsクロス投稿**: ROOM投稿成功後、同じ商品を自動でIG・Threadsに展開して認知度を拡大します。
> - クイックスタート: **[SETUP-SNS.md](SETUP-SNS.md)**
> - 詳細（画面スクショ位置まで解説）: **[SETUP-SNS-DETAILED.md](SETUP-SNS-DETAILED.md)**
> 未設定なら自動スキップされます。

---

### Step 3: GitHub Actionsを有効化

リポジトリページ → **Actions タブ** → 「I understand my workflows, go ahead and enable them」をクリック

---

## ⏰ 自動実行スケジュール

| 機能 | 日本時間 | GitHub Actions cron (UTC) |
|---|---|---|
| **自動コレ投稿** | 毎日 8・12・16・20・22時 | `.github/workflows/auto-post.yml` |
| **自動いいね** | 毎日 10:30・19:30 | `.github/workflows/auto-like.yml` |
| **自動フォロー** | 毎日 11:00 | `.github/workflows/auto-follow.yml` |
| **自動削除** | 毎週日曜 3:00 | `.github/workflows/auto-delete.yml` |

> GitHub Actionsのcronは**最大で数分遅延**することがあります

---

## 🔑 Cookieの更新方法

楽天ROOMのCookieは定期的に期限切れになります。切れたらDiscordへ通知が来ます。

```bash
# PCでCookieを取得
npm run export-cookie
```

表示されたJSONを **GitHub Secrets の `ROOM_COOKIE`** に貼り付けて更新してください。

---

## 🖥️ ローカルWebダッシュボード（PCがある時に使う）

PCを起動中にリアルタイム監視・手動実行をしたい場合：

```bash
npm start
# → http://localhost:3000 でダッシュボード表示
```

---

## 📁 ファイル構成

```
rakuten-room-auto-system/
├── .github/workflows/
│   ├── auto-post.yml       # 自動投稿
│   ├── auto-like.yml       # 自動いいね
│   ├── auto-follow.yml     # 自動フォロー
│   └── auto-delete.yml     # 自動削除
├── src/
│   ├── index.ts            # ローカルWebサーバー起動
│   ├── main.ts             # 投稿単独実行（GitHub Actions用）
│   ├── run_like.ts         # いいね単独実行
│   ├── run_follow.ts       # フォロー単独実行
│   ├── run_delete.ts       # 削除単独実行
│   ├── actions/            # 各機能の実装
│   ├── api/                # Express + SQLite
│   ├── core/               # Playwright基盤
│   └── utils/              # ヘルパー関数
├── public/                 # Web UI (HTML/CSS/JS)
├── tools/
│   └── cookie-exporter.ts  # Cookie取得ツール
└── .env                    # ローカル設定（Gitに含めない）
```

---

## 📈 Phase 1: 楽天アフィリエイト実売データ取り込み

Phase 1 では楽天アフィリエイト管理画面から日次で実売データ（クリック数・成果件数・報酬額）を取得し `data/sales.sqlite` に永続化します。

### セットアップ（初回のみ）

1. **Affiliate Cookie を取得**

    ```bash
    npm run export-affiliate-cookie
    ```

    ブラウザが開くので楽天IDでログイン。`affiliate.rakuten.co.jp/` に遷移すると自動でCookieが保存されます。

2. **GitHub Secrets に登録**

    - Name: `RAKUTEN_AFFILIATE_COOKIE`
    - Secret: 手順1の標準出力に出た1行JSON

3. **（任意）レポートURLの上書き**

    デフォルトは `https://affiliate.rakuten.co.jp/rp/mypage/report/`。異なる場合は Variables に `RAKUTEN_AFFILIATE_REPORT_URL` を設定。

### 動作確認

```bash
npm run diagnose        # ROOM + Affiliate Cookie の有効性チェック
npm run scrape-sales    # 昨日のレポートを取得して DB に反映
npm test                # sales-db / report-parser の単体テスト
```

### 自動実行

`.github/workflows/sales-scrape.yml` が毎日 JST 02:00 に発火します。失敗時は Discord に通知＋診断アーティファクトが Actions の Artifacts に上がります。

---

## 🎭 Phase 2: 3ペルソナ並行 × Instagram 特化

Phase 2 では 3 価格帯ペルソナ（低単価高回転 / 中単価QOL / 高単価ふるさと納税）を並行運用します。

### スケジュール（multi モード時）

- JST 08:00 → slot0 (毎月これ買ってる) - ROOM + IG
- JST 13:00 → slot1 (一人暮らしQOL) - IG のみ (SKIP_ROOM=1)
- JST 21:00 → slot2 (ふるさと納税) - ROOM + IG

Net: 3 IG 投稿/日, 2 ROOM 投稿/日

### ペルソナの編集

`src/persona/persona.json` を編集するとその内容が翌回の投稿に反映されます。

- `activeSlot` を `"multi"` から `"slot0"` 等に変更で単一スロット集中（Phase 4 の勝者確定時）
- 各 slot の `hashtags` / `ctaLine` / `ngWords` / `genres` を編集

### slot 別実売の集計

```bash
npx tsx -e "const {loadHistory} = require('./src/agents/store.ts'); const {initDb, getSalesByDateRange} = require('./src/affiliate/sales-db.ts'); const {attributeSlots} = require('./src/attribution/attribute.ts'); const db = initDb(); console.log(attributeSlots(loadHistory(), getSalesByDateRange(db, '2026-07-01', '2026-07-31'))); db.close();"
```

---

## 🧠 Phase 3: 学習ループの正解ラベル切替 (likes → 実売)

Phase 3 で `commander.ts` の戦略更新を「いいね数」から「実売スコア」に切替。

- **sales_score** = `reward * 0.7 + clicks * 0.3`
- 直近14日の `data/sales.sqlite` × `post_history.json` を `itemCodeHash` で JOIN
- 実売データが3件以上あれば sales モード、それ未満なら likes モードに自動フォールバック
- 各世代の `strategy.json` に `salesGen` フラグ / `salesGenSince` / `slotWeights` が記録される

### 挙動確認

```bash
npm run learn
```

Discord に届く司令官デイリーレポートの `**mode**:` 行で `sales` か `likes` かが分かる。
`salesGen: true` の世代は commander の全ての weight 更新が実売由来。

---

## 🏆 Phase 4: 勝者ペルソナ確定 (evaluator)

`evaluator` が `persona.evaluationWindow` (既定14日) 経過後に勝者スロットを判定します。

### 挙動

- **not-yet**: 評価窓未経過。何もしない
- **already-decided**: `activeSlot` が既に "slotN" に確定。何もしない
- **winner-decided**: 勝者が明確 (2位との差 ≥ 20%) → `persona.activeSlot` に上書き → 🏆 Discord 通知
- **keep-multi**: 全 slot が拮抗 (差 < 20%) → multi 継続 → ⚖️ Discord 通知
- **stop-loss**: 総報酬 < ¥3000/14日 → 3候補の差し替えを促す 🚨 Discord 通知（activeSlot は変更しない）

### 手動再評価

```bash
npm run evaluate-persona
```

### 手動 activeSlot 切替

`src/persona/persona.json` を直接編集:

```json
{ "activeSlot": "multi" }  // 全 slot を再評価対象に戻す
```

再度勝者を確定させたい場合は `evaluationStartedAt` を今の時刻に更新して window を再開。

### 自動実行

`.github/workflows/evaluate-persona.yml` が毎週日曜 JST 03:00 に発火します。
