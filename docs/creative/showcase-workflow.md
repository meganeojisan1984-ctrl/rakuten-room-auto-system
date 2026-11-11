# /showcase 商品画像の制作工程

## 対象
楽天ROOM・Instagram・X に掲載する、選定済み商品の画像。/showcase はプロンプト先頭に置く文字列であり、ChatGPT の専用機能、特定モデルの選択、画質向上の保証として扱わない。

参照例の要点は、商品を大きく主役にすること、確認できる細部の寄り、柔らかな光、商品に合う背景、広告写真風の素材感。香水、ピンク、薔薇、SNS 画面や参考例の文言を全商品へ流用しない。

## プロンプト作成
選定済み商品の JSON に itemCode、itemName、itemUrl、imageUrl を入れる。itemCaption、category は任意。商品と画像を先に固定し、後から別の商品を無作為に選び直さない。

```sh
npm run --silent image:prompt -- /absolute/product.json room hero > /absolute/prompt.txt
npm run --silent image:prompt -- /absolute/product.json instagram details
npm run --silent image:prompt -- /absolute/product.json x context
```

このコマンドはローカル JSON を読み、指示文を出力するだけ。AI API、ブラウザ、投稿処理、投稿状態にはアクセスしない。出力先は既存ファイルを上書きしない新規パスにする。

## ブラウザでの制作
1. 実際の商品ページと実物画像を確認する。画像 URL を文字列で渡すだけで画像添付済みとはしない。
2. 商品の実画像とスタイル参考を区別する。商品の形、色、ロゴ、ラベル、部品、個数は実物画像を正とする。
3. 既に承認された ChatGPT ブラウザの画像作成手順で、生成したプロンプトと許可された画像入力を使用する。画像入力・保存・公開に関する未解決の確認は維持する。代わりに画像 API を呼ばない。
4. 商品の同一性、文字、背景小物が付属品に見えないこと、未確認の効果・価格・使用体験が入っていないことを確認する。忠実に再現できなければ商品写真を保持して背景や配置だけを変更する。
5. ダウンロードした画像と実際に使った指示文を同じ商品に紐づける。ROOM や SNS へのアップロード・公開は既存の承認・重複防止・結果確認工程を別途通す。AI 生成画像を実際の使用写真や「オリジナル写真」と偽らない。

## Implementation and live-operation boundary
- Prompt entry: image:prompt -> tools/create-showcase-prompt.ts -> src/product-showcase.ts.
- Artifact entry: room:bundle -> reviewed product/prompt/caption/image hashes and collect destination.
- Transaction entry: room:transaction -> pure GitHub connector CAS plans for reserve/begin/finish and readback verification.
- main and local auto_post fail closed: no AI API, random product, Cookie session or implicit SNS fallback. The existing Mac CUA worker runs the supported protocol; npm does not attach to CUA.
- See [browser posting operations](browser-post-operations.md) for exact state, identity, single-attempt and confirmation gates. The deployed schedule, real image generation and live post must each be verified separately. Implementation/tests alone do not prove production completion.
