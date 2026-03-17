# Claude Code 向け自動生成・実行指示書

このドキュメントは、Claude Code を使用して「楽天ROOM自動投稿システム」を構築するためのステップバイステップの指示書です。
コード生成を行うAIに対して、このファイルの指示内容を上から順番に実行させてください。

---

## 開発の進め方（AI向けルール）
- 各Stepを実行完了した後に、一度実行・ユニットテスト（最低限の動作確認）を行ってください。
- 実装には TypeScript と Node.js を前提とし、コードは `src` および `tools` ディレクトリに分けて作成してください。
- 外部API（Gemini, 楽天API）の呼び出しや、通知Webhook（Discord等）については、環境変数（`.env`）から設定を読み込むようにしてください。

---

## Step 1: プロジェクトの初期設定とパッケージ導入
1. 必要なパッケージのインストールを実行し、設定ファイルを生成してください。
   - `npm init -y`
   - `npm install playwright axios dotenv @google/generative-ai`
   - `npm install -D typescript @types/node tsx`
   - `npx tsc --init`
   - `npx playwright install chromium`
2. `.env.example` ファイルを作成し、楽天APIキー、**Gemini APIキー**、Webhook URL（Discord等）、ターゲットジャンル設定、Cookie情報などを格納する雛形を用意してください。

## Step 2: 通知モジュールの実装（Discord Webhook等）
**対象ファイル: `src/notifiers.ts`**
1. 環境変数（例: `DISCORD_WEBHOOK_URL`）を用いて、Discord等への通知を送信する関数を実装してください。
2. 投稿成功時の簡易通知、および致命的なエラー（Cookie期限切れ、CAPTCHA遭遇、APIエラー連続発生など）に対する緊急警告通知をサポートしてください。

## Step 3: ローカル補助ツールとセッション管理（Cookie）
**対象ファイル1: `tools/cookie-exporter.ts`**
1. Playwrightを使ってPC上で実際のブラウザ（非ヘッドレス）を立ち上げ、ユーザーが手動で楽天にログインするのを待機するスクリプトを作成してください。
2. ログイン完了を検知したら、ブラウザのCookieを取得し、クリップボードへのコピーまたはJSONファイルへの出力を自動で行うようにしてください。

**対象ファイル2: `src/session.ts`**
1. 環境変数（例: `ROOM_COOKIE`）からJSON形式のCookie配列を読み込む機能を作成してください。
2. Playwrightの `BrowserContext` にCookieを適用するユーティリティを実装してください。
3. Cookieが有効かどうか（ログイン状態が維持されているか）を事前チェック・検証する関数を含めてください。

## Step 4: 楽天APIからの高度な商品取得とフィルタリング
**対象ファイル: `src/fetcher.ts`**
1. 楽天の Item Ranking API / Item Search API を用いて商品を取得する関数を作成してください。
2. 環境変数等で「ターゲットジャンル（例：ふるさと納税、季節家電、1000円ポッキリ）」を切り替えられるようロジックを構成してください。
3. 取得データに対して以下のフィルタリングと抽出を行ってください：
   - 価格条件の適用（指定ジャンルに基づく上限・下限等）。
   - 在庫切れ・販売停止の確実な除外。
   - **ポイントアップ情報**や**クーポン情報**が含まれる場合、それを検知してフラグ付け（優先抽出）する機能の実装。

## Step 5: Gemini 2.0 Flash による無料＆レート制限対応の紹介文生成
**対象ファイル: `src/generator.ts`**
1. `@google/generative-ai` パッケージを利用し、Gemini 2.0 Flash (Free Tier) モデルを呼び出す関数を実装してください。
2. **レート制限対策**: 無料枠のRPM/RPDを考慮し、生成リクエスト間に適切なスリープ（`setTimeout`ベースのウェイト処理）や、429エラー時のリトライ（Exponential Backoff）ロジックを必ず組み込んでください。
3. プロンプトの要件：
   - 購入者の購買意欲を駆り立てるベネフィットを強調。
   - **ポイントアップやクーポンのお得な情報を最優先でアピール。**
   - SNS映えする短めで魅力的な構成、かつ自動投稿を悟らせない自然なトーン。
   - 関連するハッシュタグの付与。

## Step 6: Playwrightによる自動投稿スクリプト
**対象ファイル: `src/poster.ts`**
1. `src/session.ts` を利用し、ヘッドレスブラウザでCookie付きで楽天ROOMにアクセスする関数を作成してください。
2. 以下の手順を実装してください：
   - 事前にCookieの有効性（ログイン状態）を確認し、無効であれば例外をスロー（`src/notifiers.ts`経由で通知）。
   - 商品URLにアクセスし「ROOMに投稿」をクリック。
   - フォームに `src/generator.ts` で生成した紹介文を入力し、投稿ボタンをクリック。
3. CAPTCHA画面への遭遇や、DOM要素が見つからない場合は、エラーをスローし、可能であればブラウザのスクリーンショットを `./error.png` に保存してください。失敗時は直ちにDiscord等に通知を送る処理を組み込んでください。

## Step 7: メインフローの統合
**対象ファイル: `src/main.ts`**
1. 上記のモジュールをすべて統合し、一連のワークフローを実行するエントリーポイントを作成してください。
   - `fetcher` でジャンル考慮・特売優先の商品を取得。
   - `generator` でGeminiを用いて文章作成（レート制限考慮）。
   - `poster` で楽天ROOMへ投稿を実行。
2. 各工程でのエラーは `try/catch` でキャッチし、フローを停止させて `notifiers.ts` からスマホにエラー内容（および必要に応じてCookie更新依頼）を通知するようにしてください。

## Step 8: GitHub Actions の構築
**対象ファイル: `.github/workflows/auto-post.yml`**
1. Node.js環境とPlaywrightブラウザのセットアップを含むワークフローを定義してください。
2. 日本時間の 0:00, 9:00, 12:00, 21:00, 23:00 に該当するUTC時間で cron トリガーを設定してください。
3. リポジトリの Secrets から APIキー、Discord Webhook URL、Cookie情報 を渡し、`npx tsx src/main.ts` が起動するように構成してください。ログに詳細なエラーが出力されるよう設定してください。
