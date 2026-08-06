#!/usr/bin/env bash
# main への push をリトライ付きで実行する。
# 2つの障害パターンに対応:
#   1. GitHub Contents API で先にコミットされた画像が untracked で残る → git clean
#   2. 複数プロセスが同じ JSON を同時更新 → rebase conflict → reset-and-reapply
set -euo pipefail

MAX_RETRIES=3

clean_generated() {
  if [ -d "public/generated" ]; then
    git clean -fd "public/generated" 2>/dev/null || true
  fi
}

abort_rebase() {
  git rebase --abort 2>/dev/null || true
}

# 現在の HEAD コミットの変更ファイル一覧とメッセージを記録
COMMIT_MSG="$(git log -1 --format='%s')"
SAVE_DIR="$(mktemp -d)"
git diff-tree --no-commit-id --name-only -r HEAD | while IFS= read -r f; do
  if [ -f "$f" ]; then
    mkdir -p "${SAVE_DIR}/$(dirname "$f")"
    cp "$f" "${SAVE_DIR}/${f}"
  fi
done

for i in 1 2 3; do
  abort_rebase
  clean_generated

  # 通常パス: rebase して push
  if git pull --rebase --autostash origin main && git push; then
    echo "[safe-push] success on attempt ${i}"
    rm -rf "${SAVE_DIR}"
    exit 0
  fi

  echo "[safe-push] attempt ${i}/${MAX_RETRIES} rebase failed"
  abort_rebase

  # フォールバック: リモートに合わせてから自分の変更だけ再適用
  git fetch origin main
  git reset --hard origin/main

  if [ -d "${SAVE_DIR}" ] && [ "$(ls -A "${SAVE_DIR}" 2>/dev/null)" ]; then
    cp -r "${SAVE_DIR}/." .
  fi

  git add posted_items.json post_history.json agent_reports.json strategy.json dialogue.json 2>/dev/null || true
  if git diff --staged --quiet; then
    echo "[safe-push] no diff after reapply — nothing to push"
    rm -rf "${SAVE_DIR}"
    exit 0
  fi

  git commit -m "${COMMIT_MSG}"
  if git push origin main; then
    echo "[safe-push] success on attempt ${i} (reset-and-reapply)"
    rm -rf "${SAVE_DIR}"
    exit 0
  fi

  sleep $((i * 5))
done

rm -rf "${SAVE_DIR}"
echo "::error::[safe-push] failed after ${MAX_RETRIES} retries"
exit 1
