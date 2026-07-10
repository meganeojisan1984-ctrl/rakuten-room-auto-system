# Instagram/Threads 連携 — 詳細セットアップガイド

ROOM投稿成功後、同じ商品を **Instagram** と **Threads** に自動クロス投稿して認知度を拡大します。
このガイドは手取り足取り、画面のスクリーンショット位置まで詳しく説明します。

---

## 前提条件

- Instagramアカウント（新規作成でも既存でもOK）
- 電話番号（本人確認用）
- 楽天ROOMとは別のメールアドレス推奨（Metaアカウント管理が複数になるため）

所要時間: **約30分**（初回）+ トークン失効時の再発行（**5分**）

---

## Step 1: アカウント開設（初回のみ・15分）

### 1-1. Instagramアカウント作成

1. https://www.instagram.com/ → 画面右下「**アカウントを作成**」（またはナビ右上「**登録**」）
2. **メールアドレス** か **電話番号**で登録
   - 楽天ROOMと同じ名前・プロフィール画像で統一（読者が「あ、同じ人だ」と気づきやすく、信用度向上）
3. ユーザー名: `@rakuten_room_[自分の好きな言葉]` 推奨（例: `@rakuten_room_kurashi`）
   - 後で変更可能ですが、最初に決めておくと楽
4. 本人確認（電話番号またはメール）を完了

**注意**: このアカウントは**ビジネス/クリエイターアカウント**に切り替える必要があります。個人アカウントのままでは自動投稿APIが使えません。

### 1-2. ビジネスアカウントに切り替え

1. Instagramアプリ/ブラウザで **プロフィール画面** を開く
2. 右上の **ハンバーガーメニュー** (☰) → **設定とプライバシー** → **アカウントの種類とツール**
3. 「**プロアカウントに切り替える**」→ **ビジネス** を選択
   - 「クリエイター」でもOKですが、ビジネスの方がマーケティング機能が充実
4. **カテゴリを選択**: 「🛍 ショッピング / 小売」 or 「📚 ブログ / メディア」を推奨
5. **完了**

### 1-3. Threadsアカウント自動作成

1. Threadsアプリを開く（iOS/Android）または https://www.threads.net へアクセス
2. Instagram のログイン画面が出る → 上記で作ったInstagramアカウントでログイン
3. **「Threadsでプロフィールを作成」** → Instagramの情報が自動流用される
4. **完了**

これで、Instagramビジネスアカウント＋Threadsアカウントの準備ができました。

---

## Step 2: Meta開発者アプリの作成（初回のみ・10分）

### 2-1. Meta開発者コンソールへアクセス

1. https://developers.facebook.com/ にアクセス
2. 右上 **「My Apps」** → **「Create App」**（初回）or 既存アプリを編集
3. **App Purpose**: 「**Business**」を選択
4. **App Name**: 
   ```
   楽天ROOM自動投稿システム
   ```
   （わかりやすく。後で変更可能）
5. **App Contact Email**: あなたのメールアドレス
6. **App Type**: 「**Business**」のまま
7. **Create App** をクリック

### 2-2. アプリにInstagram Graph APIを追加

1. アプリダッシュボード左メニュー → **「Add Products」**（または **「+Add Product」**）
2. 検索欄に **「Instagram」** と入力
3. 「**Instagram Graph API**」カード → **「Set Up」** ボタンをクリック
4. 表示された画面で **「Get Started」** をクリック
5. 左メニューに **「Instagram Graph API」** が追加されたことを確認

### 2-3. Facebookページの作成（または既存ページをInstagramと連携）

**2-3-A: ページが無い場合**
1. アプリダッシュボード左メニュー → **「Add Products」**
2. **「Facebook Login」** を検索して **「Set Up」** → 「**Get Started**」
3. 表示される画面の指示に従ってFacebookページを作成
   - ページ名: 「楽天ROOM-[名前]」推奨
   - ページカテゴリ: 「ショップ/小売」
4. 作成後、アプリと自動連携される

**2-3-B: ページが既にある場合**
1. https://www.facebook.com/pages/ でページを開く
2. 左メニュー → **「設定」** → **「Instagram アカウント」**
3. **「アカウントをリンク」** → ビジネスInstagramアカウント（Step 1-2で作ったもの）を選択
4. **「リンク」** をクリック

### 2-4. ビジネスInstagramアカウントのID確認

1. アプリダッシュボード → 左メニュー **「Instagram Graph API」**
2. 左メニュー **「Roles」** → **「Test Users」**
   - または **「Settings」** → **「Basic」** で「App ID」と「App Secret」をコピー（後で必要）

次のステップで **IGユーザーID** を取得するのですが、短期トークンが必要です。

---

## Step 3: Instagram短期トークン取得（毎回・5分）

### 3-1. Graph API エクスプローラーを開く

1. https://developers.facebook.com/tools/explorer/ にアクセス
2. 右上 **「Get Access Token」** をクリック
3. ポップアップで、**Instagramビジネスアカウント** のアカウントでログインするか確認が出る
4. **「許可」** をクリック

### 3-2. 必要な権限を付与

1. トークン取得後、エクスプローラー画面で **「権限」** リンク（または **「Permissions」**）をクリック
2. **以下をチェック**（未チェックならチェック）:
   - ✅ `instagram_basic`
   - ✅ `instagram_content_publish`
   - ✅ `pages_read_engagement`
3. 権限を追加した後、**「Get New Access Token」** をクリック
4. 新しいトークンが生成される

### 3-3. 短期トークンをコピー

1. エクスプローラー上部に表示されている **長い文字列** がアクセストークン
2. **右クリック** → **「コピー」** (or 選択してCtrl+C)
3. 一時的にテキストエディタ等に貼り付けておく

---

## Step 4: 長期トークン生成（短期トークンから・3分）

### 4-1. 短期トークンを長期トークンに交換

ブラウザのアドレスバーに以下を貼り付けます（YOUR_SHORT_LIVED_TOKENとアプリシークレットを置換）:

```
https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_LIVED_TOKEN
```

**置換方法**:
- `YOUR_APP_ID` → Step 2-4で確認したApp ID
- `YOUR_APP_SECRET` → App Settings → **Basic** で「App Secret」表示（「Show」をクリック）
- `YOUR_SHORT_LIVED_TOKEN` → Step 3-3でコピーしたトークン

**例**:
```
https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=1234567890123456&client_secret=abc123def456ghi789&fb_exchange_token=IGABCDef12345...
```

### 4-2. URLをブラウザで実行

1. 上記URLをアドレスバーに貼り付けて **Enter キー**
2. 以下のようなJSON応答が返される:
```json
{
  "access_token": "IGAABCDef123456789...",
  "token_type": "bearer"
}
```
3. **`access_token` の値** をコピー（これが60日有効な**長期トークン**）

**エラー時の対処**:
- **400 Bad Request**: `client_id`/`client_secret` が間違っている
- **401 Unauthorized**: App Secret が間違っている
- **Invalid OAuth Token**: 短期トークンが期限切れ（Step 3 からやり直す）

---

## Step 5: InstagramビジネスアカウントID取得（2分）

### 5-1. Facebookページ ID を取得

1. Graph API エクスプローラー (https://developers.facebook.com/tools/explorer/) を開く
2. **左メニュー** から **最新バージョン** (`v21.0` 推奨) を選択
3. **中央** のクエリボックスに以下を入力:
```
/me/accounts
```
4. **Send** ボタンをクリック
5. 右側に以下のような応答が出る:
```json
{
  "data": [
    {
      "name": "楽天ROOM-[あなた]",
      "category": "Shop/Retail",
      "category_list": [...],
      "access_token": "...",
      "id": "123456789012345"
    }
  ]
}
```
6. **`id` の値**（15〜16桁）をコピー。これが **Facebookページ ID**

### 5-2. InstagramビジネスアカウントID取得

1. エクスプローラーのクエリボックスをクリア
2. 新しいクエリ（Facebookページ ID を YOUR_PAGE_ID に置換）:
```
/YOUR_PAGE_ID?fields=instagram_business_account
```
3. **Send** をクリック
4. 応答例:
```json
{
  "instagram_business_account": {
    "id": "17841400000000001"
  },
  "id": "123456789012345"
}
```
5. **`instagram_business_account.id` の値**（17+ の数字で始まる）をコピー。これが **IG User ID** ✅

---

## Step 6: GitHub Secrets に登録

リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### 登録すべき Secrets:

| Secret 名 | 値 | 取得元 |
|---|---|---|
| `IG_USER_ID` | `17841400000000001` のような数字 | Step 5-2 |
| `IG_ACCESS_TOKEN` | `IGAABCDef123456789...` で始まる長い文字列 | Step 4-2 |
| `ROOM_PROFILE_URL` | `https://room.rakuten.co.jp/room_12345678` のような自分のROOM URL | ブラウザのアドレスバー |

### 登録手順:

1. GitHub リポジトリ → **Settings** タブ
2. 左メニュー → **Secrets and variables** → **Actions**
3. **New repository secret** ボタン
4. **Name**: `IG_USER_ID`
5. **Secret**: Step 5-2の値をペースト
6. **Add secret** をクリック
7. 同じ手順で `IG_ACCESS_TOKEN`と `ROOM_PROFILE_URL`も登録

**確認**:
登録後、**Secrets** リストに3つが表示されていることを確認:
- ✅ IG_USER_ID
- ✅ IG_ACCESS_TOKEN
- ✅ ROOM_PROFILE_URL

---

## Step 7: Threads API トークン取得（5分）

Instagramの`IG_ACCESS_TOKEN`はそのままThreadsでも使えます（Meta のアカウント体系が統一されているため）。

ただし、ThreadsユーザーID は別途取得が必要です:

### 7-1. ThreadsユーザーID取得

1. Graph API エクスプローラー → https://developers.facebook.com/tools/explorer/
2. **バージョン**: `v21.0`
3. **クエリ**:
```
/me?fields=id
```
4. 上部にアクセストークンが入っていることを確認（Step 4-2の長期トークン）
5. **Send** をクリック
6. 応答:
```json
{
  "id": "17841400000000001"
}
```
   このIDが **Threads User ID** です（Instagram IDと同じ場合が多い）

### 7-2. GitHub Secrets に追加登録

| Secret 名 | 値 |
|---|---|
| `THREADS_USER_ID` | Step 7-1 の `id` |
| `THREADS_ACCESS_TOKEN` | `IG_ACCESS_TOKEN` と同じ値 |

---

## トークン失効時の再発行（60日ごと・5分）

Instagram / Threads のアクセストークンは **60日で自動失効** します。

自動投稿ワークフローが失敗して Discord に「**Instagram投稿失敗**」通知が来たら:

1. **Step 3**（短期トークン取得）からやり直す
2. **Step 4**（長期トークン生成）で新トークンをコピー
3. GitHub Secrets の `IG_ACCESS_TOKEN` と `THREADS_ACCESS_TOKEN` を更新
4. 次の投稿ワークフロー実行時に新トークンが使われる

毎月第1日曜 23:00 に Secrets を更新するリマインダーをスマホに設定しておくと便利です。

---

## トラブルシューティング

### Q: 「ビジネスアカウントに切り替えられない」

**原因**: Instagramアカウントが新しすぎる、またはInstagram IDが確認されていない
**対処**: 
1. アカウント作成から**3日以上待つ**
2. Instagram設定 → 「プロフィール情報」で身分証明書を提出（表示されている場合）
3. 24時間待つ

### Q: 「このFacebookページは既にビジネスアカウントに接続されている」

**原因**: 同じFacebookページが別のInstagramアカウントに接続されている
**対処**: 
1. Facebookページ設定 → 「Instagram アカウント」 → 既存の接続を削除
2. 改めて接続

### Q: 「Invalid OAuth Token」とエラーが出る

**原因**: トークンが期限切れ、または App Secret が間違っている
**対処**: 
1. Step 3 からやり直す（新しい短期トークンを取得）
2. Step 4 で長期トークンを再生成

### Q: Instagram投稿は成功するが、Threadsが「User not found」でエラーになる

**原因**: Threads アカウントがまだ作成されていない、または THREADS_USER_ID が間違っている
**対処**: 
1. https://www.threads.net で Threadsアカウントが実際に存在するか確認
2. Step 7-1 のクエリを再実行して正しいIDを取得
3. GitHub Secrets を更新

---

## セットアップ完了の確認

1. GitHub Actions → 「楽天ROOM 自動投稿」ワークフロー → **Run workflow** → **manual run**
2. ワークフロー実行後、Discord に以下のような通知が来ることを確認:
   - ✅ `✅ Instagram投稿成功: 商品名`
   - ✅ `✅ Threads投稿成功: 商品名`
3. 実際にInstagramのプロフィール・Threadsの投稿を確認

これで完了です 🎉

