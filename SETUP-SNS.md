# Instagram / Threads 連携セットアップガイド

> ✅ **2026-07-10 セットアップ完了済み**。実際の構成: Metaアプリ「楽天ROOM自動投稿システム」(ID: 27485403524487512) に **Threads API** + **Instagram API (Instagramログイン方式)** ユースケースを追加し、テスター登録した `meganeojisan.jp` のトークンをユースケース画面の「トークンを生成」で発行。
>
> **🔄 60日ごとのトークン再発行手順(実際の手順)**:
> 1. https://developers.facebook.com/apps/27485403524487512/use_cases/ を開く
> 2. **Threads**: 「Threads APIにアクセス」→ 設定 → ユーザートークン生成ツール → 「アクセストークンを生成」→ コピー
> 3. **Instagram**: 「Instagramでメッセージとコンテンツを管理」→ InstagramログインによるAPI設定 → セクション2 → 「トークンを生成」→ コピー
> 4. GitHub Secrets (`THREADS_ACCESS_TOKEN` / `IG_ACCESS_TOKEN`) を更新 (`gh secret set` またはリポジトリのSettings画面)

ROOM投稿成功後、同じ商品を **Instagram** と **Threads** に自動クロス投稿して認知度を拡大します。

**詳細な手順は [SETUP-SNS-DETAILED.md](SETUP-SNS-DETAILED.md) を参照してください。**
このドキュメントはそのクイックスタートです。

---

## クイックスタート

### 1. アカウント開設（15分）

- Instagram: https://www.instagram.com で新規作成 or 既存アカウント
- ビジネスアカウント切り替え: 設定 → **アカウントの種類とツール** → **プロアカウント（ビジネス）**
- Threads: Threadsアプリで同Instagramアカウントでログイン（自動作成）

### 2. Meta開発者アプリ作成（10分）

- https://developers.facebook.com/apps/create → **Business** 型
- **Add Products** → **Instagram Graph API** を追加
- Facebookページを作成 or 既存ページをInstagramと連携

### 3. トークン取得（10分・60日ごと）

- **Graph API エクスプローラー**: https://developers.facebook.com/tools/explorer/
- 権限: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` をチェック
- **短期トークン** → **長期トークン** に交換（60日有効）
- **IG User ID** 取得（`/me/accounts` クエリで Facebookページ ID → `/[PAGE_ID]?fields=instagram_business_account` でInstagram ID）
- **Threads User ID** = Instagram ID と同じ（`/me?fields=id` クエリで確認）

### 4. GitHub Secrets 登録（5分）

リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret 名 | 値 |
|---|---|
| `IG_USER_ID` | Instagram Business Account ID |
| `IG_ACCESS_TOKEN` | 長期アクセストークン（60日有効） |
| `THREADS_USER_ID` | Threads User ID（=IG User ID） |
| `THREADS_ACCESS_TOKEN` | IG_ACCESS_TOKEN と同じ |
| `ROOM_PROFILE_URL` | 楽天ROOMプロフィールURL |

---

## トークン失効時の再発行（60日ごと）

Discord に「**Instagram投稿失敗**」と通知が来たら:
1. Graph API エクスプローラーで新しい短期トークン取得
2. 長期トークンに交換（Step 3）
3. GitHub Secrets を更新

---

## ローカル実行時

`.env` に同じキーを設定してください。

---

## サポート

詳細な操作画面やトラブルシューティング → [SETUP-SNS-DETAILED.md](SETUP-SNS-DETAILED.md)
