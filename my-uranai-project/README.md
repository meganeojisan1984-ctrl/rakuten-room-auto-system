# my-uranai-project（占いコンテンツ自動化）

占いSNS（X）× note × LINE × アフィリエイト（A8等）による収益化プロジェクト。

## 収益化フロー
X（集客）→ note（信頼構築・教育）→ LINE（クロージング）→ A8等アフィリエイト案件

## ファイル構成
| ファイル | 役割 |
|---|---|
| `PROJECT_INSTRUCTIONS.md` | 指揮官マニュアル（AIエージェントの役割・制作ルール・コンプラ要件） |
| `content_plan.csv` | コンテンツ案の管理（Phase 1 リサーチの書き出し先） |
| `affiliate_programs.csv` | 提携候補案件と禁止事項の管理（着手前チェック用） |

## 使い方
作業開始時に Phase を指定して指示する。
- Phase 1: リサーチ → `content_plan.csv` に書き出し
- Phase 2: X投稿3案 / note構成1本 / 画像生成プロンプト1セット
- Phase 3: 品質・コンプラの自己レビュー

## 着手前の必須確認
`PROJECT_INSTRUCTIONS.md` の「6. コンプライアンス・凍結回避ルール」を必ず読むこと。
特に **各アフィリエイト案件のSNS/LINE送客可否** を `affiliate_programs.csv` で確認してから誘導設計を行う。
