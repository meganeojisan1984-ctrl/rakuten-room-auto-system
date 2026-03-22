# 楽天ROOM 自動化システム

楽天ROOMの投稿・いいね・フォロー・削除を **GitHub Actionsで完全自動化・完全無料** で動かすシステムです。

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
