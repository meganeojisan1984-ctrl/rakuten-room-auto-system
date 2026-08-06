#!/usr/bin/env bash
# main への push をリトライ付きで実行する。
# 競合時のみ retry し、それ以外のエラー（認証等）は即失敗。
set -euo pipefail

MAX_RETRIES=3

# GitHub Contents API で既にリモートにコミット済みの生成ファイルが
# ローカルに untracked で残っていると rebase が衝突するため事前に除去
clean_generated() {
  local gen_dir="public/generated"
  if [ -d "${gen_dir}" ]; then
    git clean -fd "${gen_dir}" 2>/dev/null || true
    echo "[safe-push] cleaned untracked files in ${gen_dir}"
  fi
}

for i in 1 2 3; do
  clean_generated
  if git pull --rebase --autostash origin main && git push; then
    echo "[safe-push] success on attempt ${i}"
    exit 0
  fi
  wait=$((i * 5))
  echo "[safe-push] attempt ${i}/${MAX_RETRIES} failed, retrying in ${wait}s..."
  sleep "${wait}"
done

echo "::error::[safe-push] failed after ${MAX_RETRIES} retries"
exit 1
